const WS_URL = "ws://localhost:3456";
const RECONNECT_DELAY_MS = 3000;

const state = {
  ws: null,
  reconnectTimer: null,
  connectionStatus: "disconnected",
  sessions: [],
  currentFilter: "all",
  currentSessionId: null,
  pageContext: null,
  contextPinned: false,
  isStreaming: false,
  streamingMessageNode: null,
};

const refs = {
  sessionsView: document.getElementById("sessionsView"),
  chatView: document.getElementById("chatView"),
  sessionList: document.getElementById("sessionList"),
  chatMessages: document.getElementById("chatMessages"),
  chatTitle: document.getElementById("chatTitle"),
  chatMeta: document.getElementById("chatMeta"),
  sessionStatus: document.getElementById("sessionStatus"),
  messageInput: document.getElementById("messageInput"),
  chatInput: document.getElementById("chatInput"),
  sendBtn: document.getElementById("sendBtn"),
  chatSendBtn: document.getElementById("chatSendBtn"),
  attachBtn: document.getElementById("attachBtn"),
  chatAttachBtn: document.getElementById("chatAttachBtn"),
  pinBtn: document.getElementById("pinBtn"),
  chatPinBtn: document.getElementById("chatPinBtn"),
  newSessionBtn: document.getElementById("newSessionBtn"),
  backBtn: document.getElementById("backBtn"),
  filterTabs: Array.from(document.querySelectorAll(".filter-tab")),
  countActive: document.getElementById("countActive"),
  countDraft: document.getElementById("countDraft"),
  countDone: document.getElementById("countDone"),
  contextChip: document.getElementById("contextChip"),
  contextChipText: document.getElementById("contextChipText"),
  chatContextChip: document.getElementById("chatContextChip"),
  chatContextChipText: document.getElementById("chatContextChipText"),
  removeContextBtn: document.getElementById("removeContextBtn"),
  chatRemoveContextBtn: document.getElementById("chatRemoveContextBtn"),
  connectionDot: document.getElementById("connectionDot"),
  connectionLabel: document.getElementById("connectionLabel"),
  chatConnectionDot: document.getElementById("chatConnectionDot"),
  chatConnectionLabel: document.getElementById("chatConnectionLabel"),
};

function isSocketReady() {
  return state.ws?.readyState === WebSocket.OPEN;
}

function sendPacket(payload) {
  if (!isSocketReady()) {
    return false;
  }

  state.ws.send(JSON.stringify(payload));
  return true;
}

function setConnectionStatus(status) {
  state.connectionStatus = status;

  const label =
    status === "connected"
      ? "connected"
      : status === "connecting"
        ? "connecting"
        : "offline";

  const className = `connection-dot is-${status}`;
  for (const dot of [refs.connectionDot, refs.chatConnectionDot]) {
    dot.className = className;
  }

  refs.connectionLabel.textContent = label;
  refs.chatConnectionLabel.textContent = label;
  updateComposerState();
}

function scheduleReconnect() {
  if (state.reconnectTimer) {
    window.clearTimeout(state.reconnectTimer);
  }

  state.reconnectTimer = window.setTimeout(() => {
    connect();
  }, RECONNECT_DELAY_MS);
}

function connect() {
  if (
    state.ws &&
    (state.ws.readyState === WebSocket.OPEN ||
      state.ws.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  setConnectionStatus("connecting");

  const socket = new WebSocket(WS_URL);
  state.ws = socket;

  socket.addEventListener("open", () => {
    if (state.ws !== socket) {
      return;
    }

    if (state.reconnectTimer) {
      window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    setConnectionStatus("connected");
    sendPacket({ type: "list_sessions" });
  });

  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    handleServerMessage(data);
  });

  socket.addEventListener("close", () => {
    if (state.ws !== socket) {
      return;
    }

    state.ws = null;
    state.isStreaming = false;
    finishStreamingMessage();
    setConnectionStatus("disconnected");
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    setConnectionStatus("disconnected");
  });
}

function handleServerMessage(data) {
  switch (data.type) {
    case "sessions":
      state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
      updateCounts(data.counts ?? {});
      renderSessions();
      syncActiveSessionSummary();
      break;

    case "session_detail":
      if (data.session) {
        showChatView(data.session);
      }
      break;

    case "chat_start":
      state.currentSessionId = data.sessionId;
      state.isStreaming = true;
      showChatView(data.session);
      state.streamingMessageNode = appendChatMessage(
        {
          role: "assistant",
          text: "",
          timestamp: new Date().toISOString(),
        },
        { streaming: true },
      );
      updateComposerState();
      break;

    case "chat_delta":
      updateStreamingMessage(data.text || "");
      break;

    case "chat_result":
      if (state.streamingMessageNode) {
        const body = state.streamingMessageNode.querySelector(".message-body");
        state.streamingMessageNode.dataset.rawText = data.text || "";
        renderMessageText(body, data.text || "");
      } else {
        appendChatMessage({
          role: "assistant",
          text: data.text || "",
          timestamp: new Date().toISOString(),
        });
      }
      scrollMessagesToBottom();
      break;

    case "chat_done":
      state.isStreaming = false;
      finishStreamingMessage();
      updateComposerState();
      sendPacket({ type: "list_sessions" });
      break;

    case "chat_cancelled":
      state.isStreaming = false;
      finishStreamingMessage();
      appendChatMessage({
        role: "error",
        text: data.text || "Request cancelled.",
        timestamp: new Date().toISOString(),
      });
      updateComposerState();
      break;

    case "error":
      state.isStreaming = false;
      finishStreamingMessage();
      appendChatMessage({
        role: "error",
        text: data.text || "Unexpected error.",
        timestamp: new Date().toISOString(),
      });
      updateComposerState();
      break;

    default:
      break;
  }
}

function updateCounts(counts) {
  refs.countActive.textContent = counts.active || "";
  refs.countDraft.textContent = counts.draft || "";
  refs.countDone.textContent = counts.done || "";
}

function renderSessions() {
  const sessions =
    state.currentFilter === "all"
      ? state.sessions
      : state.sessions.filter((session) => session.status === state.currentFilter);

  if (!sessions.length) {
    const scopeLabel =
      state.currentFilter === "all" ? "sessions" : `${state.currentFilter} sessions`;

    refs.sessionList.innerHTML = `
      <div class="empty-state">
        <p class="empty-state-title">No ${escapeHtml(scopeLabel)} yet</p>
        <p class="empty-state-copy">Open the page context below and start the first conversation.</p>
      </div>
    `;
    return;
  }

  refs.sessionList.innerHTML = sessions
    .map((session) => {
      const preview = session.lastMessagePreview || "No messages yet";
      const pageTitle = session.pageContext?.title || session.pageContext?.url || "";

      return `
        <button class="session-item" type="button" data-session-id="${escapeHtml(session.id)}">
          <div class="session-item-top">
            <p class="session-item-title">${escapeHtml(session.title)}</p>
            <span class="session-status is-${escapeHtml(session.status)}">${escapeHtml(session.status)}</span>
          </div>
          <p class="session-item-preview">${escapeHtml(preview)}</p>
          <div class="session-item-meta">
            <span>${escapeHtml(formatDateLabel(session.updatedAt || session.createdAt))}</span>
            <span class="session-item-page">${escapeHtml(pageTitle)}</span>
          </div>
        </button>
      `;
    })
    .join("");

  refs.sessionList.querySelectorAll("[data-session-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const sessionId = button.dataset.sessionId;
      if (!sessionId) {
        return;
      }

      state.currentSessionId = sessionId;
      sendPacket({ type: "get_session", sessionId });
    });
  });
}

function syncActiveSessionSummary() {
  if (!state.currentSessionId) {
    return;
  }

  const summary = state.sessions.find(
    (session) => session.id === state.currentSessionId,
  );
  if (!summary) {
    return;
  }

  refs.chatTitle.textContent = summary.title;
  refs.chatMeta.textContent =
    summary.pageContext?.title || formatDateLabel(summary.updatedAt || summary.createdAt);
  refs.sessionStatus.value = summary.status;
}

function showSessionsView() {
  refs.sessionsView.hidden = false;
  refs.chatView.hidden = true;
  sendPacket({ type: "list_sessions" });
}

function showChatView(session) {
  refs.sessionsView.hidden = true;
  refs.chatView.hidden = false;
  state.currentSessionId = session.id;
  refs.chatTitle.textContent = session.title;
  refs.chatMeta.textContent =
    session.pageContext?.title || formatDateLabel(session.updatedAt || session.createdAt);
  refs.sessionStatus.value = session.status;
  renderChatHistory(session);
}

function renderChatHistory(session) {
  refs.chatMessages.innerHTML = "";

  if (!Array.isArray(session.messages) || !session.messages.length) {
    refs.chatMessages.innerHTML = `
      <div class="chat-empty">
        Claude is ready. Ask about the page, request a summary, or continue the task.
      </div>
    `;
    return;
  }

  for (const message of session.messages) {
    appendChatMessage(message);
  }

  scrollMessagesToBottom();
}

function appendChatMessage(message, { streaming = false } = {}) {
  const article = document.createElement("article");
  const role = message.role === "assistant" ? "assistant" : message.role === "error" ? "error" : "user";
  const label = role === "assistant" ? "Claude" : role === "error" ? "Status" : "You";
  const timestamp = message.timestamp ? formatTimeLabel(message.timestamp) : "";

  article.className = `chat-message is-${role}${streaming ? " is-streaming" : ""}`;
  article.dataset.rawText = message.text || "";
  article.innerHTML = `
    <div class="chat-message-head">
      <span class="chat-message-role">${escapeHtml(label)}</span>
      <span class="chat-message-time">${escapeHtml(timestamp)}</span>
    </div>
    <div class="message-body"></div>
  `;

  const body = article.querySelector(".message-body");
  renderMessageText(body, message.text || "");

  const emptyState = refs.chatMessages.querySelector(".chat-empty");
  if (emptyState) {
    emptyState.remove();
  }

  refs.chatMessages.append(article);
  scrollMessagesToBottom();
  return article;
}

function updateStreamingMessage(delta) {
  if (!state.streamingMessageNode) {
    state.streamingMessageNode = appendChatMessage(
      {
        role: "assistant",
        text: "",
        timestamp: new Date().toISOString(),
      },
      { streaming: true },
    );
  }

  const nextText = `${state.streamingMessageNode.dataset.rawText || ""}${delta}`;
  state.streamingMessageNode.dataset.rawText = nextText;
  const body = state.streamingMessageNode.querySelector(".message-body");
  renderMessageText(body, nextText);
  scrollMessagesToBottom();
}

function finishStreamingMessage() {
  if (!state.streamingMessageNode) {
    return;
  }

  state.streamingMessageNode.classList.remove("is-streaming");
  state.streamingMessageNode = null;
}

function renderMessageText(element, text) {
  element.innerHTML = renderRichText(text);
}

function renderRichText(text) {
  if (!text) {
    return "<p></p>";
  }

  const blocks = [];
  const codeBlockPattern = /```([a-z0-9_-]+)?\n?([\s\S]*?)```/gi;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockPattern.exec(text)) !== null) {
    const precedingText = text.slice(lastIndex, match.index);
    if (precedingText.trim()) {
      blocks.push(...renderParagraphs(precedingText));
    }

    const language = match[1] ? ` data-lang="${escapeHtml(match[1])}"` : "";
    const code = escapeHtml(match[2].replace(/\n$/, ""));
    blocks.push(`<pre><code${language}>${code}</code></pre>`);
    lastIndex = codeBlockPattern.lastIndex;
  }

  const trailingText = text.slice(lastIndex);
  if (trailingText.trim()) {
    blocks.push(...renderParagraphs(trailingText));
  }

  return blocks.join("") || `<p>${renderInline(text)}</p>`;
}

function renderParagraphs(text) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${renderInline(paragraph)}</p>`);
}

function renderInline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

function normalizePageContext(pageContext) {
  if (!pageContext || typeof pageContext !== "object") {
    return null;
  }

  const title = String(pageContext.title ?? "");
  const url = String(pageContext.url ?? "");
  const text = String(pageContext.text ?? "");
  if (!title && !url && !text) {
    return null;
  }

  return {
    title,
    url,
    text,
    capturedAt: String(pageContext.capturedAt ?? new Date().toISOString()),
  };
}

function renderContextChips() {
  const context = state.pageContext;
  const chipText = context?.title || context?.url || "Current page";

  for (const chip of [refs.contextChip, refs.chatContextChip]) {
    chip.classList.toggle("is-hidden", !context);
    chip.classList.toggle("is-pinned", state.contextPinned && Boolean(context));
  }

  refs.contextChipText.textContent = chipText;
  refs.chatContextChipText.textContent = chipText;

  refs.pinBtn.classList.toggle("is-active", state.contextPinned);
  refs.chatPinBtn.classList.toggle("is-active", state.contextPinned);
  refs.pinBtn.setAttribute("aria-pressed", String(state.contextPinned));
  refs.chatPinBtn.setAttribute("aria-pressed", String(state.contextPinned));
}

async function refreshPageContext(force = false) {
  if (state.contextPinned && !force) {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({ type: "getPageContent" });
    state.pageContext = normalizePageContext(response);
    renderContextChips();
  } catch {
    state.pageContext = null;
    renderContextChips();
  }
}

function removePageContext() {
  state.pageContext = null;
  state.contextPinned = false;
  renderContextChips();
}

function toggleContextPin() {
  state.contextPinned = !state.contextPinned;
  renderContextChips();
}

function resizeTextarea(textarea) {
  textarea.style.height = "34px";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 136)}px`;
}

function updateComposerState() {
  const canSend = isSocketReady() && !state.isStreaming;
  refs.sendBtn.disabled = !canSend || !refs.messageInput.value.trim();
  refs.chatSendBtn.disabled = !canSend || !refs.chatInput.value.trim();
}

function submitNewSessionMessage() {
  const text = refs.messageInput.value.trim();
  if (!text || state.isStreaming || !isSocketReady()) {
    return;
  }

  sendPacket({
    type: "chat",
    message: text,
    pageContext: state.pageContext,
  });

  refs.messageInput.value = "";
  resizeTextarea(refs.messageInput);
  updateComposerState();
}

function submitChatMessage() {
  const text = refs.chatInput.value.trim();
  if (!text || state.isStreaming || !isSocketReady()) {
    return;
  }

  appendChatMessage({
    role: "user",
    text,
    timestamp: new Date().toISOString(),
  });

  sendPacket({
    type: "chat",
    message: text,
    sessionId: state.currentSessionId,
    pageContext: state.pageContext,
  });

  refs.chatInput.value = "";
  resizeTextarea(refs.chatInput);
  updateComposerState();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateLabel(value) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeLabel(value) {
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function scrollMessagesToBottom() {
  refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
}

refs.filterTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    refs.filterTabs.forEach((button) => button.classList.remove("is-active"));
    tab.classList.add("is-active");
    state.currentFilter = tab.dataset.filter || "all";
    renderSessions();
  });
});

refs.messageInput.addEventListener("input", () => {
  resizeTextarea(refs.messageInput);
  updateComposerState();
});

refs.chatInput.addEventListener("input", () => {
  resizeTextarea(refs.chatInput);
  updateComposerState();
});

refs.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submitNewSessionMessage();
  }
});

refs.chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submitChatMessage();
  }
});

refs.sendBtn.addEventListener("click", submitNewSessionMessage);
refs.chatSendBtn.addEventListener("click", submitChatMessage);
refs.attachBtn.addEventListener("click", () => void refreshPageContext(true));
refs.chatAttachBtn.addEventListener("click", () => void refreshPageContext(true));
refs.pinBtn.addEventListener("click", toggleContextPin);
refs.chatPinBtn.addEventListener("click", toggleContextPin);
refs.removeContextBtn.addEventListener("click", removePageContext);
refs.chatRemoveContextBtn.addEventListener("click", removePageContext);
refs.backBtn.addEventListener("click", showSessionsView);

refs.newSessionBtn.addEventListener("click", () => {
  state.currentSessionId = null;
  showSessionsView();
  refs.messageInput.focus();
});

refs.sessionStatus.addEventListener("change", () => {
  if (!state.currentSessionId) {
    return;
  }

  sendPacket({
    type: "update_session",
    sessionId: state.currentSessionId,
    updates: { status: refs.sessionStatus.value },
  });
});

window.addEventListener("focus", () => {
  void refreshPageContext(false);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void refreshPageContext(false);
  }
});

renderSessions();
renderContextChips();
resizeTextarea(refs.messageInput);
resizeTextarea(refs.chatInput);
updateComposerState();
void refreshPageContext();
connect();
