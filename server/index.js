import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { WebSocket, WebSocketServer } from "ws";
import {
  addMessage,
  createSession,
  deleteSession,
  getCachedPageContext,
  getSession,
  getSessionCount,
  listSessions,
  loadSessions,
  updateSession,
} from "./sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3456);
const HOST = process.env.HOST || "127.0.0.1";
const TOOL_ALLOWLIST = new Set([
  "Read",
  "Glob",
  "Grep",
  "Bash",
  "WebSearch",
  "WebFetch",
]);

await loadSessions();

const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
  verifyClient: ({ origin, req }) => {
    const remoteAddress = req.socket.remoteAddress;
    const isLoopback =
      remoteAddress === "127.0.0.1" ||
      remoteAddress === "::1" ||
      remoteAddress === "::ffff:127.0.0.1";
    const allowedOrigin =
      typeof origin === "string" && origin.startsWith("chrome-extension://");

    return isLoopback && allowedOrigin;
  },
});
const activeQueries = new Map();

console.log(`Claude bridge server listening on ws://${HOST}:${PORT}`);

function summarizeSession(session) {
  const lastMessage = session.messages.at(-1) ?? null;

  return {
    id: session.id,
    title: session.title,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    lastMessagePreview: lastMessage?.text?.slice(0, 160) ?? "",
    pageContext: session.pageContext
      ? {
          title: session.pageContext.title,
          url: session.pageContext.url,
          capturedAt: session.pageContext.capturedAt,
        }
      : null,
  };
}

function serializeSessions() {
  return listSessions().map(summarizeSession);
}

function sendJson(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(data) {
  const payload = JSON.stringify(data);

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function broadcastSessions() {
  broadcast({
    type: "sessions",
    sessions: serializeSessions(),
    counts: getSessionCount(),
  });
}

function extractAssistantText(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  let text = "";

  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string") {
      text += block.text;
    }
  }

  return text;
}

function buildPrompt(message, pageContext) {
  const sections = [];

  if (pageContext) {
    sections.push(
      [
        "The user is viewing a webpage. Use the page context when it is relevant.",
        "",
        "Page metadata:",
        `- URL: ${pageContext.url || "(unknown url)"}`,
        `- Title: ${pageContext.title || "(untitled page)"}`,
        "",
        "Extracted page text:",
        pageContext.text || "(no text extracted)",
      ].join("\n"),
    );
  }

  sections.push(`User request: ${message}`);
  return sections.join("\n\n");
}

function buildConversationPrompt(session, message, pageContext) {
  const previousMessages = Array.isArray(session.messages) ? session.messages : [];
  const transcriptMessages =
    previousMessages.at(-1)?.role === "user"
      ? previousMessages.slice(0, -1)
      : previousMessages;
  const recentMessages = transcriptMessages.slice(-12);
  const transcript = recentMessages
    .map((entry) => `${entry.role === "assistant" ? "Assistant" : "User"}: ${entry.text}`)
    .join("\n\n");

  const currentTurnPrompt = buildPrompt(message, pageContext);
  if (!transcript) {
    return currentTurnPrompt;
  }

  return [
    "Continue the conversation below. Preserve context from the earlier turns.",
    "",
    transcript,
    "",
    currentTurnPrompt,
  ].join("\n");
}

function makeTitle(message) {
  const compact = message.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "New chat";
  }

  return compact.length > 60 ? `${compact.slice(0, 57)}...` : compact;
}

function getSessionOrError(ws, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    sendJson(ws, { type: "error", text: "Session not found." });
    return null;
  }
  return session;
}

async function handleChat(ws, data) {
  const message = typeof data.message === "string" ? data.message.trim() : "";
  if (!message) {
    sendJson(ws, { type: "error", text: "Message cannot be empty." });
    return;
  }

  let session = data.sessionId ? getSession(data.sessionId) : null;
  if (!session) {
    session = createSession({
      title: makeTitle(message),
      pageContext: data.pageContext,
    });
  } else if (activeQueries.has(session.id)) {
    sendJson(ws, {
      type: "error",
      sessionId: session.id,
      text: "That session is already generating a reply.",
    });
    return;
  }

  if (data.pageContext) {
    session = updateSession(session.id, { pageContext: data.pageContext }) ?? session;
  }

  addMessage(session.id, "user", message);
  session = getSession(session.id);

  sendJson(ws, {
    type: "chat_start",
    sessionId: session.id,
    session,
  });
  broadcastSessions();

  const conversationPrompt = buildConversationPrompt(
    session,
    message,
    data.pageContext ?? getCachedPageContext(session.id) ?? session.pageContext,
  );
  const queryHandle = query({
    prompt: conversationPrompt,
    options: {
      cwd: PROJECT_ROOT,
      includePartialMessages: true,
      persistSession: false,
      allowedTools: [...TOOL_ALLOWLIST],
      canUseTool: async (toolName) => {
        if (TOOL_ALLOWLIST.has(toolName)) {
          return { behavior: "allow" };
        }

        return {
          behavior: "deny",
          message: `${toolName} is not enabled in Claude Side Panel.`,
        };
      },
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: "claude-side-panel/1.0.0",
      },
    },
  });

  activeQueries.set(session.id, queryHandle);

  let streamedText = "";
  let assistantText = "";
  let resultText = "";
  let seenPartial = false;

  try {
    for await (const sdkMessage of queryHandle) {
      if (
        sdkMessage.type === "stream_event" &&
        sdkMessage.event?.type === "content_block_delta" &&
        sdkMessage.event.delta?.type === "text_delta" &&
        typeof sdkMessage.event.delta.text === "string"
      ) {
        seenPartial = true;
        streamedText += sdkMessage.event.delta.text;
        sendJson(ws, {
          type: "chat_delta",
          sessionId: session.id,
          text: sdkMessage.event.delta.text,
        });
        continue;
      }

      if (sdkMessage.type === "assistant") {
        assistantText = extractAssistantText(sdkMessage.message);
        if (assistantText && !seenPartial) {
          sendJson(ws, {
            type: "chat_result",
            sessionId: session.id,
            text: assistantText,
          });
        }
        continue;
      }

      if (sdkMessage.type === "result") {
        if (sdkMessage.subtype === "success") {
          resultText = sdkMessage.result || resultText;
          if (!seenPartial && !assistantText && resultText) {
            sendJson(ws, {
              type: "chat_result",
              sessionId: session.id,
              text: resultText,
            });
          }
        } else {
          const errorText = sdkMessage.errors?.join("\n") || "Claude request failed.";
          sendJson(ws, {
            type: "error",
            sessionId: session.id,
            text: errorText,
          });
        }
      }
    }

    const finalText = assistantText || streamedText || resultText;
    if (finalText) {
      addMessage(session.id, "assistant", finalText);
    }

    sendJson(ws, { type: "chat_done", sessionId: session.id });
    broadcastSessions();
  } catch (error) {
    const text =
      error?.name === "AbortError"
        ? "Request cancelled."
        : error?.message || "Unexpected Claude Agent SDK error.";

    sendJson(ws, {
      type: error?.name === "AbortError" ? "chat_cancelled" : "error",
      sessionId: session.id,
      text,
    });
  } finally {
    activeQueries.delete(session.id);
  }
}

async function handleCancel(ws, sessionId) {
  if (typeof sessionId !== "string" || !sessionId) {
    sendJson(ws, { type: "error", text: "Missing session ID for cancel request." });
    return;
  }

  const queryHandle = activeQueries.get(sessionId);
  if (!queryHandle) {
    sendJson(ws, { type: "chat_cancelled", sessionId, text: "Nothing to cancel." });
    return;
  }

  await queryHandle.interrupt();
}

wss.on("connection", (ws) => {
  sendJson(ws, {
    type: "sessions",
    sessions: serializeSessions(),
    counts: getSessionCount(),
  });

  ws.on("message", async (raw) => {
    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch {
      sendJson(ws, { type: "error", text: "Invalid JSON payload." });
      return;
    }

    switch (data.type) {
      case "list_sessions":
        sendJson(ws, {
          type: "sessions",
          sessions: serializeSessions(),
          counts: getSessionCount(),
        });
        break;

      case "get_session": {
        const session = getSessionOrError(ws, data.sessionId);
        if (session) {
          sendJson(ws, { type: "session_detail", session });
        }
        break;
      }

      case "delete_session":
        deleteSession(data.sessionId);
        broadcastSessions();
        break;

      case "update_session": {
        const session = updateSession(data.sessionId, data.updates);
        if (!session) {
          sendJson(ws, { type: "error", text: "Session not found." });
          break;
        }

        sendJson(ws, { type: "session_detail", session });
        broadcastSessions();
        break;
      }

      case "chat":
        await handleChat(ws, data);
        break;

      case "cancel":
        await handleCancel(ws, data.sessionId);
        break;

      default:
        sendJson(ws, {
          type: "error",
          text: `Unknown message type: ${String(data.type || "(missing)")}`,
        });
    }
  });
});

wss.on("headers", (_headers, req) => {
  const origin = req.headers.origin || "(missing origin)";
  console.log(`WebSocket client connected from origin: ${origin}`);
});
