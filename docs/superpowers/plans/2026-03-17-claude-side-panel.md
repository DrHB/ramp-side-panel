# Claude Side Panel Chrome Extension — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension with a Ramp Inspect-style side panel that lets you chat with Claude (via Claude Agent SDK) about any webpage — with sessions management, page context chips, a polished UI, and auto-connect on open.

**Architecture:** A local Node.js WebSocket server bridges the Chrome extension to Claude Code via the Agent SDK. The server supports multiple sessions (conversations) and must be started locally by the user or a helper script; the extension auto-connects/reconnects when the panel opens. The Chrome extension has two views: a **Sessions list** (browse/filter past chats) and a **Chat view** (active conversation). A content script extracts page text. Messages flow: Side Panel → WebSocket → Local Server → Agent SDK → Claude Code CLI → back.

**Tech Stack:** Chrome Extension (Manifest V3, Side Panel API), Node.js, WebSocket (`ws`), `@anthropic-ai/claude-agent-sdk`, vanilla HTML/CSS/JS for the panel UI.

## Review Corrections

- Chrome extensions cannot directly launch an arbitrary local Node.js process without an additional native messaging host. During execution, treat server startup as manual via `npm run server` or `./start-server.sh`; only connection/reconnection is automatic from the panel.
- Use the currently published Claude Agent SDK version and install its peer dependency: `@anthropic-ai/claude-agent-sdk@^0.2.77` plus `zod`.
- Current SDK streaming requires `includePartialMessages: true` and handling `stream_event` text deltas (`content_block_delta` / `text_delta`), rather than assuming streamed text arrives only inside `assistant` messages.
- To make multi-turn sessions actually resume the same Claude conversation, persist the Claude SDK `session_id` alongside local session metadata and pass it back via `resume` on later turns.
- This workspace may not be a git repository. Commit steps remain useful checkpoints, but execution should skip them unless `git init` has been run first.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Browser                        │
│                                                          │
│  ┌──────────────┐   chrome.runtime    ┌───────────────┐ │
│  │ Content Script│ ◄──────────────► │  Background SW │ │
│  │ (page text)   │    messages        │  (coordinator) │ │
│  └──────────────┘                     └───────┬───────┘ │
│                                               │         │
│  ┌──────────────────────────────────────┐     │         │
│  │         Side Panel                    │     │         │
│  │                                       │     │         │
│  │  ┌─ Sessions View ────────────────┐  │     │         │
│  │  │  [Active] [Draft] [Open] [Done]│  │  chrome      │
│  │  │  Session 1 — Feb 13 · Draft    │◄─┼──runtime     │
│  │  │  Session 2 — Feb 11 · Open     │  │     │         │
│  │  └────────────────────────────────┘  │     │         │
│  │                                       │     │         │
│  │  ┌─ Chat View ────────────────────┐  │     │         │
│  │  │  Messages...                   │  │     │         │
│  │  │  ┌─────────────────────────┐   │  │     │         │
│  │  │  │ 📎 "PageTitle" ×       │   │  │     │         │
│  │  │  │ Ask or build anything   │   │  │     │         │
│  │  │  │         🎤 📎 📌 ↑     │   │  │     │         │
│  │  │  └─────────────────────────┘   │  │     │         │
│  │  │  ─────────────────────────────  │  │     │         │
│  │  │  claude opus 4.6    build agent │  │     │         │
│  │  └────────────────────────────────┘  │     │         │
│  └──────────────────────────────────────┘     │         │
└───────────────────────────────────────────────┼─────────┘
                                                │
               WebSocket (ws://localhost:3456)   │
                                                ▼
┌──────────────────────────────────────┐
│        Local Node.js Server          │
│  ┌─────────────────────────────┐     │
│  │  WebSocket Server (ws)      │     │
│  │  Session manager (in-memory)│     │
│  │  ↕                          │     │
│  │  Agent SDK query() per      │     │
│  │  session (resume support)   │     │
│  │  ↕                          │     │
│  │  Claude Code CLI subprocess │     │
│  └─────────────────────────────┘     │
└──────────────────────────────────────┘
```

## UI Mockup (Ramp Inspect Style)

### Sessions View (default when opened)
```
┌─────────────────────────────────────┐
│ Sessions                    View on web ↗ │
├─────────────────────────────────────┤
│ (Active)  ↕  3 Draft  1 Open  Done │
├─────────────────────────────────────┤
│                                     │
│ Analyze homepage performance        │
│ Mar 17, 2026 · ↕ Active            │
│                                     │
│ Review checkout flow bugs           │
│ Mar 16, 2026 · ↕ Draft             │
│                                     │
│ Summarize API documentation         │
│ Mar 15, 2026 · ↕ Done              │
│                                     │
│                                     │
│                                     │
│                                     │
│                                     │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ 📎 "Current Page Title" ×      │ │
│ │ Ask or build anything           │ │
│ │                    🎤 📎 📌 ↑  │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ claude opus 4.6          build agent│
└─────────────────────────────────────┘
```

### Chat View (inside a session)
```
┌─────────────────────────────────────┐
│ ← Back    Session Title        •••  │
├─────────────────────────────────────┤
│                                     │
│ You: Summarize this page            │
│                                     │
│ Claude: This page contains...       │
│ The main sections are:              │
│ 1. Overview...                      │
│ 2. Details...                       │
│                                     │
│                                     │
│                                     │
│                                     │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ 📎 "Page Title" ×              │ │
│ │ Ask or build anything           │ │
│ │                    🎤 📎 📌 ↑  │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ claude opus 4.6          build agent│
└─────────────────────────────────────┘
```

## File Structure

```
ramp-side-panel/
├── server/
│   ├── package.json
│   ├── index.js               # WebSocket server + Agent SDK + session mgmt
│   └── sessions.js            # In-memory session store
│
├── extension/
│   ├── manifest.json
│   ├── background.js          # Service worker: opens panel, relays messages
│   ├── content.js             # Extracts page text
│   ├── sidepanel.html         # Main HTML shell
│   ├── sidepanel.css          # All styles (Ramp Inspect aesthetic)
│   ├── sidepanel.js           # App logic: views, WebSocket, rendering
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
│
├── package.json               # Root: scripts to install & start server
└── README.md
```

---

## Chunk 1: Local Server with Session Support

### Task 1: Initialize the server project

**Files:**
- Create: `server/package.json`

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "claude-side-panel-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "ws": "^8.19.0",
    "zod": "^4.3.6",
    "@anthropic-ai/claude-agent-sdk": "^0.2.77"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd server && npm install`
Expected: `node_modules/` created, `package-lock.json` generated.

- [ ] **Step 3: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "chore: initialize server project with ws and claude-agent-sdk"
```

---

### Task 2: Build the session store

**Files:**
- Create: `server/sessions.js`

- [ ] **Step 1: Write `server/sessions.js`**

```js
// In-memory session store
// Each session: { id, title, status, createdAt, messages[], pageContext }

let sessions = [];
let nextId = 1;

export function createSession({ title, pageContext }) {
  const session = {
    id: String(nextId++),
    title: title || "New chat",
    status: "active",   // active | draft | done
    createdAt: new Date().toISOString(),
    messages: [],        // { role: "user"|"assistant", text, timestamp }
    pageContext: pageContext || null,
  };
  sessions.unshift(session);
  return session;
}

export function getSession(id) {
  return sessions.find((s) => s.id === id) || null;
}

export function listSessions(filter) {
  if (!filter || filter === "all") return sessions;
  return sessions.filter((s) => s.status === filter);
}

export function addMessage(sessionId, role, text) {
  const session = getSession(sessionId);
  if (!session) return null;
  const msg = { role, text, timestamp: new Date().toISOString() };
  session.messages.push(msg);
  return msg;
}

export function updateSession(id, updates) {
  const session = getSession(id);
  if (!session) return null;
  Object.assign(session, updates);
  return session;
}

export function deleteSession(id) {
  sessions = sessions.filter((s) => s.id !== id);
}

export function getSessionCount() {
  const counts = { active: 0, draft: 0, done: 0 };
  for (const s of sessions) {
    if (counts[s.status] !== undefined) counts[s.status]++;
  }
  return counts;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/sessions.js
git commit -m "feat: add in-memory session store"
```

---

### Task 3: Build the WebSocket + Agent SDK bridge server

**Files:**
- Create: `server/index.js`

- [ ] **Step 1: Write `server/index.js`**

```js
import { WebSocketServer } from "ws";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  createSession,
  getSession,
  listSessions,
  addMessage,
  updateSession,
  deleteSession,
  getSessionCount,
} from "./sessions.js";

const PORT = process.env.PORT || 3456;
const wss = new WebSocketServer({ port: PORT });

console.log(`Claude bridge server listening on ws://localhost:${PORT}`);

// Track active agent queries per session so we can cancel
const activeQueries = new Map();

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

wss.on("connection", (ws) => {
  console.log("Client connected");

  // Send initial session list on connect
  send(ws, {
    type: "sessions",
    sessions: listSessions(),
    counts: getSessionCount(),
  });

  ws.on("message", async (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      send(ws, { type: "error", text: "Invalid JSON" });
      return;
    }

    switch (data.type) {
      // --- Session management ---
      case "list_sessions": {
        send(ws, {
          type: "sessions",
          sessions: listSessions(data.filter),
          counts: getSessionCount(),
        });
        break;
      }

      case "get_session": {
        const session = getSession(data.sessionId);
        if (session) {
          send(ws, { type: "session_detail", session });
        } else {
          send(ws, { type: "error", text: "Session not found" });
        }
        break;
      }

      case "delete_session": {
        deleteSession(data.sessionId);
        send(ws, {
          type: "sessions",
          sessions: listSessions(),
          counts: getSessionCount(),
        });
        break;
      }

      case "update_session": {
        updateSession(data.sessionId, data.updates);
        send(ws, {
          type: "sessions",
          sessions: listSessions(),
          counts: getSessionCount(),
        });
        break;
      }

      // --- Chat ---
      case "chat": {
        const { message, sessionId, pageContext } = data;

        // Create or get session
        let session;
        if (sessionId) {
          session = getSession(sessionId);
        }
        if (!session) {
          // Auto-title from the first message (first 60 chars)
          const title = message.length > 60
            ? message.slice(0, 57) + "..."
            : message;
          session = createSession({ title, pageContext });
        }

        // Update page context if provided
        if (pageContext) {
          updateSession(session.id, { pageContext });
        }

        // Add user message
        addMessage(session.id, "user", message);

        // Build prompt with page context
        let prompt = message;
        if (pageContext) {
          prompt = [
            "The user is viewing a webpage. Here is the page context:",
            "",
            "---",
            `URL: ${pageContext.url}`,
            `Title: ${pageContext.title}`,
            "",
            "Page content (truncated):",
            (pageContext.text || "(no text extracted)").slice(0, 15000),
            "---",
            "",
            `User's question: ${message}`,
          ].join("\n");
        }

        // Notify: session created/updated + streaming started
        send(ws, {
          type: "chat_start",
          sessionId: session.id,
          session,
        });
        broadcast({
          type: "sessions",
          sessions: listSessions(),
          counts: getSessionCount(),
        });

        // Run the agent
        const abortController = new AbortController();
        activeQueries.set(session.id, abortController);

        let fullResponse = "";

        try {
          for await (const msg of query({
            prompt,
            options: {
              allowedTools: [
                "Read", "Glob", "Grep", "Bash",
                "WebSearch", "WebFetch",
              ],
              permissionMode: "default",
            },
          })) {
            if (abortController.signal.aborted) break;

            // Stream assistant text
            if (msg.type === "assistant" && msg.message?.content) {
              for (const block of msg.message.content) {
                if (block.type === "text" && block.text) {
                  fullResponse += block.text;
                  send(ws, {
                    type: "chat_delta",
                    sessionId: session.id,
                    text: block.text,
                  });
                }
              }
            }

            // Final result
            if ("result" in msg && msg.result) {
              if (!fullResponse) {
                fullResponse = msg.result;
              }
              send(ws, {
                type: "chat_result",
                sessionId: session.id,
                text: msg.result,
              });
            }
          }

          // Save assistant message
          if (fullResponse) {
            addMessage(session.id, "assistant", fullResponse);
          }

          send(ws, { type: "chat_done", sessionId: session.id });

        } catch (err) {
          if (err.name !== "AbortError") {
            console.error("Agent SDK error:", err);
            send(ws, {
              type: "error",
              sessionId: session.id,
              text: err.message,
            });
          }
        } finally {
          activeQueries.delete(session.id);
        }
        break;
      }

      case "cancel": {
        const controller = activeQueries.get(data.sessionId);
        if (controller) {
          controller.abort();
          activeQueries.delete(data.sessionId);
        }
        break;
      }

      default:
        send(ws, { type: "error", text: `Unknown message type: ${data.type}` });
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});
```

- [ ] **Step 2: Test the server starts**

Run: `cd server && node index.js`
Expected: `Claude bridge server listening on ws://localhost:3456`
Kill with Ctrl+C after confirming.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: add WebSocket bridge server with sessions and Agent SDK"
```

---

## Chunk 2: Chrome Extension — Scaffold

### Task 4: Create extension manifest, background script, and content script

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/background.js`
- Create: `extension/content.js`

- [ ] **Step 1: Create `extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Claude Side Panel",
  "version": "1.0.0",
  "description": "Chat with Claude alongside any webpage",
  "permissions": ["sidePanel", "activeTab", "tabs"],
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"]
    }
  ],
  "action": {
    "default_title": "Open Claude Side Panel"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 2: Create `extension/background.js`**

```js
// Open side panel when the extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Relay messages between content script and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getPageContent") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { type: "extractContent" },
          (response) => {
            sendResponse(
              response || {
                url: tabs[0].url,
                title: tabs[0].title,
                text: "",
              }
            );
          }
        );
      } else {
        sendResponse({ url: "", title: "", text: "" });
      }
    });
    return true;
  }
});
```

- [ ] **Step 3: Create `extension/content.js`**

```js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "extractContent") {
    const text = extractPageText();
    sendResponse({
      url: window.location.href,
      title: document.title,
      text: text,
    });
  }
  return true;
});

function extractPageText() {
  const clone = document.body.cloneNode(true);
  const removeTags = [
    "script", "style", "noscript", "svg", "img",
    "video", "audio", "iframe",
  ];
  removeTags.forEach((tag) => {
    clone.querySelectorAll(tag).forEach((el) => el.remove());
  });

  const text = clone.innerText || clone.textContent || "";
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .slice(0, 20000);
}
```

- [ ] **Step 4: Generate placeholder icons**

```bash
cd extension && mkdir -p icons
python3 -c "
import struct, zlib
def make_png(size, r, g, b):
    raw = b''
    for _ in range(size):
        raw += b'\x00' + bytes([r, g, b]) * size
    compressed = zlib.compress(raw)
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    idat = chunk(b'IDAT', compressed)
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend
for s in [16, 48, 128]:
    open(f'icons/icon{s}.png', 'wb').write(make_png(s, 217, 119, 6))
"
```

- [ ] **Step 5: Commit**

```bash
git add extension/manifest.json extension/background.js extension/content.js extension/icons/
git commit -m "feat: add extension scaffold with manifest, background, content script, icons"
```

---

## Chunk 3: Side Panel UI — Ramp Inspect Style

### Task 5: Build the side panel HTML

**Files:**
- Create: `extension/sidepanel.html`

- [ ] **Step 1: Write `extension/sidepanel.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude</title>
  <link rel="stylesheet" href="sidepanel.css">
</head>
<body>
  <div id="app" class="app">

    <!-- ===== Sessions View ===== -->
    <div id="sessionsView" class="view">
      <!-- Header -->
      <div class="panel-header">
        <span class="panel-title">Sessions</span>
        <div class="header-actions">
          <button id="newSessionBtn" class="btn-text" title="New session">+ New</button>
        </div>
      </div>

      <!-- Filter tabs -->
      <div class="filter-tabs">
        <button class="filter-tab active" data-filter="all">All</button>
        <button class="filter-tab" data-filter="active">Active <span class="tab-count" id="countActive"></span></button>
        <button class="filter-tab" data-filter="draft">Draft <span class="tab-count" id="countDraft"></span></button>
        <button class="filter-tab" data-filter="done">Done <span class="tab-count" id="countDone"></span></button>
      </div>

      <!-- Session list -->
      <div id="sessionList" class="session-list">
        <!-- Populated dynamically -->
        <div class="empty-state">
          <p>No sessions yet</p>
          <p class="empty-sub">Start a conversation below</p>
        </div>
      </div>

      <!-- Input area (always visible) -->
      <div class="input-container">
        <div id="contextChip" class="context-chip" style="display:none">
          <span class="chip-icon">↗</span>
          <span id="contextChipText" class="chip-text"></span>
          <button id="removeContextBtn" class="chip-remove">×</button>
        </div>
        <div class="input-wrapper">
          <textarea
            id="messageInput"
            placeholder="Ask or build anything"
            rows="1"
          ></textarea>
          <div class="input-actions">
            <button class="input-action-btn" id="attachBtn" title="Attach page context">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            <button class="input-action-btn" id="pinBtn" title="Pin page context">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2L12 22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </button>
            <button class="btn-send" id="sendBtn" title="Send">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"/>
                <polyline points="5 12 12 5 19 12"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Status bar -->
      <div class="status-bar">
        <span class="status-model">claude opus 4.6</span>
        <span id="connectionDot" class="connection-dot disconnected"></span>
        <span class="status-mode">build agent</span>
      </div>
    </div>

    <!-- ===== Chat View ===== -->
    <div id="chatView" class="view" style="display:none">
      <!-- Chat header -->
      <div class="panel-header">
        <button id="backBtn" class="btn-back" title="Back to sessions">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <span id="chatTitle" class="panel-title chat-title">Session</span>
        <div class="header-actions">
          <select id="sessionStatus" class="status-select">
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="done">Done</option>
          </select>
        </div>
      </div>

      <!-- Messages -->
      <div id="chatMessages" class="chat-messages"></div>

      <!-- Chat input area -->
      <div class="input-container">
        <div id="chatContextChip" class="context-chip" style="display:none">
          <span class="chip-icon">↗</span>
          <span id="chatContextChipText" class="chip-text"></span>
          <button id="chatRemoveContextBtn" class="chip-remove">×</button>
        </div>
        <div class="input-wrapper">
          <textarea
            id="chatInput"
            placeholder="Ask or build anything"
            rows="1"
          ></textarea>
          <div class="input-actions">
            <button class="input-action-btn" id="chatAttachBtn" title="Attach page context">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            <button class="btn-send" id="chatSendBtn" title="Send">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"/>
                <polyline points="5 12 12 5 19 12"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Status bar -->
      <div class="status-bar">
        <span class="status-model">claude opus 4.6</span>
        <span id="chatConnectionDot" class="connection-dot disconnected"></span>
        <span class="status-mode">build agent</span>
      </div>
    </div>

  </div>

  <script src="sidepanel.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add extension/sidepanel.html
git commit -m "feat: add side panel HTML with sessions and chat views"
```

---

### Task 6: Build the side panel CSS (Ramp Inspect aesthetic)

**Files:**
- Create: `extension/sidepanel.css`

- [ ] **Step 1: Write `extension/sidepanel.css`**

Full Ramp-inspired stylesheet with:
- Clean white background, subtle borders
- Pill-shaped filter tabs with counts
- Session list items with title, date, status badge
- Context chip (like the "Bill PayBills2 IssuesRec" tag)
- Bottom input with action icons
- Status bar footer ("claude opus 4.6 / build agent")
- Smooth transitions between views

```css
/* === Reset & Base === */
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: #1a1a1a;
  background: #fff;
  height: 100vh;
  overflow: hidden;
}

.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.view {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

/* === Panel Header === */
.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid #eee;
  flex-shrink: 0;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  flex: 1;
}

.chat-title {
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-text {
  background: none;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  color: #555;
  cursor: pointer;
  font-family: inherit;
}
.btn-text:hover { background: #f5f5f5; color: #1a1a1a; }

.btn-back {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: #666;
  display: flex;
  align-items: center;
}
.btn-back:hover { color: #1a1a1a; }

.status-select {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 11px;
  font-family: inherit;
  color: #555;
  background: #fff;
  cursor: pointer;
}

/* === Filter Tabs === */
.filter-tabs {
  display: flex;
  gap: 6px;
  padding: 10px 16px;
  border-bottom: 1px solid #eee;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.filter-tab {
  background: none;
  border: 1px solid #e0e0e0;
  border-radius: 20px;
  padding: 4px 12px;
  font-size: 12px;
  color: #666;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
.filter-tab:hover { background: #f5f5f5; }
.filter-tab.active {
  background: #1a1a1a;
  color: #fff;
  border-color: #1a1a1a;
}

.tab-count {
  font-size: 11px;
  opacity: 0.7;
}

/* === Session List === */
.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.session-item {
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid #f5f5f5;
  transition: background 0.1s;
}
.session-item:hover { background: #fafafa; }

.session-item-title {
  font-size: 13px;
  font-weight: 500;
  color: #1a1a1a;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-item-meta {
  font-size: 11px;
  color: #999;
  display: flex;
  align-items: center;
  gap: 6px;
}

.session-status-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 500;
}
.badge-active { background: #ecfdf5; color: #065f46; }
.badge-draft { background: #f5f5f5; color: #666; }
.badge-done { background: #eff6ff; color: #1e40af; }

.empty-state {
  padding: 40px 16px;
  text-align: center;
  color: #999;
}
.empty-sub { font-size: 12px; margin-top: 4px; }

/* === Chat Messages === */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.msg {
  font-size: 13px;
  line-height: 1.6;
}

.msg-user {
  padding: 0 0 12px 0;
  border-bottom: 1px solid #f0f0f0;
}

.msg-user .msg-label {
  font-size: 11px;
  font-weight: 600;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.msg-user .msg-text {
  color: #1a1a1a;
}

.msg-assistant .msg-label {
  font-size: 11px;
  font-weight: 600;
  color: #D97706;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.msg-assistant .msg-text {
  color: #333;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.msg-assistant .msg-text code {
  background: #f0f0f0;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: "SF Mono", Monaco, monospace;
  font-size: 12px;
}

.msg-assistant .msg-text pre {
  background: #1a1a1a;
  color: #e5e5e5;
  padding: 10px 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
  font-family: "SF Mono", Monaco, monospace;
  font-size: 12px;
  line-height: 1.4;
}

.msg-assistant .msg-text pre code {
  background: none;
  padding: 0;
  color: inherit;
}

.msg-streaming .msg-text::after {
  content: "▊";
  animation: blink 0.8s step-end infinite;
  color: #D97706;
}

@keyframes blink {
  50% { opacity: 0; }
}

/* === Input Area === */
.input-container {
  padding: 8px 12px;
  border-top: 1px solid #eee;
  flex-shrink: 0;
}

.context-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #f5f5f5;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 3px 8px;
  margin-bottom: 6px;
  font-size: 12px;
  color: #555;
}

.chip-icon { font-size: 11px; }
.chip-text {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip-remove {
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
  line-height: 1;
}
.chip-remove:hover { color: #333; }

.input-wrapper {
  border: 1px solid #e0e0e0;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
  transition: border-color 0.15s;
}
.input-wrapper:focus-within {
  border-color: #bbb;
}

.input-wrapper textarea {
  width: 100%;
  border: none;
  padding: 10px 12px 4px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.4;
  resize: none;
  outline: none;
  max-height: 120px;
  min-height: 32px;
  background: transparent;
}

.input-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 2px 6px 6px;
  gap: 2px;
}

.input-action-btn {
  background: none;
  border: none;
  padding: 6px;
  cursor: pointer;
  color: #bbb;
  border-radius: 6px;
  display: flex;
  align-items: center;
}
.input-action-btn:hover { color: #666; background: #f5f5f5; }

.btn-send {
  background: #1a1a1a;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.btn-send:hover { background: #333; }
.btn-send:disabled { background: #ddd; cursor: not-allowed; }

/* === Status Bar === */
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  border-top: 1px solid #eee;
  font-size: 11px;
  color: #999;
  flex-shrink: 0;
  background: #fafafa;
}

.status-model {
  font-family: "SF Mono", Monaco, monospace;
  font-size: 11px;
}

.status-mode {
  font-family: "SF Mono", Monaco, monospace;
  font-size: 11px;
}

.connection-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}
.connection-dot.connected { background: #22c55e; }
.connection-dot.disconnected { background: #ef4444; }
.connection-dot.connecting { background: #f59e0b; }
```

- [ ] **Step 2: Commit**

```bash
git add extension/sidepanel.css
git commit -m "feat: add Ramp Inspect-style CSS"
```

---

### Task 7: Build the side panel JavaScript

**Files:**
- Create: `extension/sidepanel.js`

- [ ] **Step 1: Write `extension/sidepanel.js`**

```js
const WS_URL = "ws://localhost:3456";

// --- State ---
let ws = null;
let sessions = [];
let currentSessionId = null;
let currentFilter = "all";
let isStreaming = false;
let pageContext = null;
let streamingMsgEl = null;

// --- DOM refs ---
const sessionsView = document.getElementById("sessionsView");
const chatView = document.getElementById("chatView");
const sessionList = document.getElementById("sessionList");
const chatMessages = document.getElementById("chatMessages");
const chatTitle = document.getElementById("chatTitle");
const sessionStatus = document.getElementById("sessionStatus");

// Sessions view elements
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const contextChip = document.getElementById("contextChip");
const contextChipText = document.getElementById("contextChipText");
const removeContextBtn = document.getElementById("removeContextBtn");

// Chat view elements
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatContextChip = document.getElementById("chatContextChip");
const chatContextChipText = document.getElementById("chatContextChipText");
const chatRemoveContextBtn = document.getElementById("chatRemoveContextBtn");

// Connection dots
const connectionDot = document.getElementById("connectionDot");
const chatConnectionDot = document.getElementById("chatConnectionDot");

// Filter tabs
const filterTabs = document.querySelectorAll(".filter-tab");
const countActive = document.getElementById("countActive");
const countDraft = document.getElementById("countDraft");
const countDone = document.getElementById("countDone");

// =====================
// WebSocket
// =====================

function connect() {
  updateConnectionStatus("connecting");
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    updateConnectionStatus("connected");
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleMessage(data);
  };

  ws.onclose = () => {
    updateConnectionStatus("disconnected");
    isStreaming = false;
    setTimeout(connect, 3000);
  };

  ws.onerror = () => {};
}

function send(data) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function updateConnectionStatus(status) {
  const dots = [connectionDot, chatConnectionDot];
  dots.forEach((dot) => {
    dot.className = `connection-dot ${status}`;
  });
}

// =====================
// Message Handler
// =====================

function handleMessage(data) {
  switch (data.type) {
    case "sessions":
      sessions = data.sessions;
      updateCounts(data.counts);
      renderSessions();
      break;

    case "session_detail":
      renderChatHistory(data.session);
      break;

    case "chat_start":
      currentSessionId = data.sessionId;
      isStreaming = true;
      showChatView(data.session);
      // Create streaming message element
      streamingMsgEl = appendChatMessage("assistant", "", true);
      break;

    case "chat_delta":
      if (streamingMsgEl) {
        const textEl = streamingMsgEl.querySelector(".msg-text");
        textEl.textContent += data.text;
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
      break;

    case "chat_result":
      // If we haven't streamed anything, show the result
      if (streamingMsgEl) {
        const textEl = streamingMsgEl.querySelector(".msg-text");
        if (!textEl.textContent.trim()) {
          textEl.textContent = data.text;
        }
      }
      break;

    case "chat_done":
      isStreaming = false;
      if (streamingMsgEl) {
        streamingMsgEl.classList.remove("msg-streaming");
        streamingMsgEl = null;
      }
      // Refresh sessions list
      send({ type: "list_sessions", filter: currentFilter });
      break;

    case "error":
      isStreaming = false;
      if (streamingMsgEl) {
        streamingMsgEl.classList.remove("msg-streaming");
        const textEl = streamingMsgEl.querySelector(".msg-text");
        textEl.textContent = `Error: ${data.text}`;
        textEl.style.color = "#dc2626";
        streamingMsgEl = null;
      }
      break;
  }
}

// =====================
// Sessions View
// =====================

function renderSessions() {
  const filtered = currentFilter === "all"
    ? sessions
    : sessions.filter((s) => s.status === currentFilter);

  if (filtered.length === 0) {
    sessionList.innerHTML = `
      <div class="empty-state">
        <p>No sessions${currentFilter !== "all" ? ` (${currentFilter})` : ""}</p>
        <p class="empty-sub">Start a conversation below</p>
      </div>`;
    return;
  }

  sessionList.innerHTML = filtered
    .map((s) => {
      const date = new Date(s.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const badgeClass = `badge-${s.status}`;
      return `
        <div class="session-item" data-id="${s.id}">
          <div class="session-item-title">${escapeHtml(s.title)}</div>
          <div class="session-item-meta">
            <span>${date}</span>
            <span>·</span>
            <span class="session-status-badge ${badgeClass}">${s.status}</span>
          </div>
        </div>`;
    })
    .join("");

  // Click handlers
  sessionList.querySelectorAll(".session-item").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.id;
      currentSessionId = id;
      send({ type: "get_session", sessionId: id });
      const session = sessions.find((s) => s.id === id);
      if (session) showChatView(session);
    });
  });
}

function updateCounts(counts) {
  countActive.textContent = counts.active || "";
  countDraft.textContent = counts.draft || "";
  countDone.textContent = counts.done || "";
}

// =====================
// Chat View
// =====================

function showChatView(session) {
  sessionsView.style.display = "none";
  chatView.style.display = "flex";
  chatTitle.textContent = session.title;
  sessionStatus.value = session.status;
  currentSessionId = session.id;
  renderChatHistory(session);
}

function showSessionsView() {
  chatView.style.display = "none";
  sessionsView.style.display = "flex";
  currentSessionId = null;
  send({ type: "list_sessions", filter: currentFilter });
}

function renderChatHistory(session) {
  chatMessages.innerHTML = "";
  if (session.messages) {
    session.messages.forEach((m) => {
      appendChatMessage(m.role, m.text);
    });
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendChatMessage(role, text, streaming = false) {
  const el = document.createElement("div");
  el.className = `msg msg-${role}${streaming ? " msg-streaming" : ""}`;
  el.innerHTML = `
    <div class="msg-label">${role === "user" ? "You" : "Claude"}</div>
    <div class="msg-text">${escapeHtml(text)}</div>`;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return el;
}

// =====================
// Page Context
// =====================

async function fetchPageContext() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "getPageContent" }, (response) => {
      resolve(response || null);
    });
  });
}

async function attachPageContext() {
  try {
    pageContext = await fetchPageContext();
    if (pageContext?.title) {
      showContextChip(pageContext.title);
    }
  } catch {
    pageContext = null;
  }
}

function showContextChip(title) {
  // Show in whichever view is active
  const chips = [
    [contextChip, contextChipText],
    [chatContextChip, chatContextChipText],
  ];
  chips.forEach(([chip, text]) => {
    chip.style.display = "inline-flex";
    text.textContent = `"${title}"`;
  });
}

function removePageContext() {
  pageContext = null;
  [contextChip, chatContextChip].forEach((c) => (c.style.display = "none"));
}

// =====================
// Send Message
// =====================

function sendFromSessionsView() {
  const text = messageInput.value.trim();
  if (!text || isStreaming) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  send({
    type: "chat",
    message: text,
    sessionId: null, // new session
    pageContext,
  });

  messageInput.value = "";
  messageInput.style.height = "32px";
}

function sendFromChatView() {
  const text = chatInput.value.trim();
  if (!text || isStreaming) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  // Show user message immediately
  appendChatMessage("user", text);

  send({
    type: "chat",
    message: text,
    sessionId: currentSessionId,
    pageContext,
  });

  chatInput.value = "";
  chatInput.style.height = "32px";
}

// =====================
// Event Listeners
// =====================

// Filter tabs
filterTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    filterTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentFilter = tab.dataset.filter;
    renderSessions();
  });
});

// New session button
document.getElementById("newSessionBtn").addEventListener("click", () => {
  messageInput.focus();
});

// Back button
document.getElementById("backBtn").addEventListener("click", showSessionsView);

// Session status change
sessionStatus.addEventListener("change", () => {
  if (currentSessionId) {
    send({
      type: "update_session",
      sessionId: currentSessionId,
      updates: { status: sessionStatus.value },
    });
  }
});

// Send buttons
sendBtn.addEventListener("click", sendFromSessionsView);
chatSendBtn.addEventListener("click", sendFromChatView);

// Enter to send
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendFromSessionsView();
  }
});
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendFromChatView();
  }
});

// Auto-resize textareas
[messageInput, chatInput].forEach((el) => {
  el.addEventListener("input", () => {
    el.style.height = "32px";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  });
});

// Attach buttons
document.getElementById("attachBtn").addEventListener("click", attachPageContext);
document.getElementById("chatAttachBtn").addEventListener("click", attachPageContext);

// Remove context
removeContextBtn.addEventListener("click", removePageContext);
chatRemoveContextBtn.addEventListener("click", removePageContext);

// =====================
// Helpers
// =====================

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// =====================
// Init
// =====================

// Auto-attach page context on open
attachPageContext();

// Connect to server
connect();
```

- [ ] **Step 2: Commit**

```bash
git add extension/sidepanel.js
git commit -m "feat: add side panel JS with sessions, chat, and page context"
```

---

## Chunk 4: Root Config & Auto-Start

### Task 8: Root package.json, README, and auto-start script

**Files:**
- Create: `package.json` (root)
- Create: `README.md`
- Create: `start-server.sh`

- [ ] **Step 1: Write root `package.json`**

```json
{
  "name": "claude-side-panel",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "server": "cd server && node index.js",
    "install:server": "cd server && npm install",
    "setup": "npm run install:server && echo 'Ready! Run: npm run server'"
  }
}
```

- [ ] **Step 2: Write `start-server.sh`** (auto-start helper)

```bash
#!/bin/bash
# Auto-start the Claude bridge server if not already running
PORT=3456

if lsof -i :$PORT -sTCP:LISTEN -t > /dev/null 2>&1; then
  echo "Server already running on port $PORT"
else
  echo "Starting Claude bridge server..."
  cd "$(dirname "$0")/server"
  node index.js &
  echo "Server started (PID: $!)"
fi
```

- [ ] **Step 3: Make it executable**

Run: `chmod +x start-server.sh`

- [ ] **Step 4: Write `README.md`**

```markdown
# Claude Side Panel

A Chrome extension that adds a Ramp Inspect-style Claude AI chat panel
alongside any webpage. Connects to your local Claude Code — no separate
API key needed.

## Quick Setup

1. **Install dependencies:**
   ```
   npm run setup
   ```

2. **Start the bridge server:**
   ```
   npm run server
   ```
   Or use the auto-start script: `./start-server.sh`

3. **Load the Chrome extension:**
   - Open `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked" → select the `extension/` folder

4. **Use it:**
   - Click the extension icon to open the side panel
   - Page context auto-attaches (the chip shows the page title)
   - Type your message and press Enter
   - Sessions are saved and browsable

## Features

- **Sessions list** — browse, filter (Active/Draft/Done), resume past chats
- **Page context** — auto-attaches current page content as a context chip
- **Streaming** — Claude's response streams in real-time
- **Auto-reconnect** — reconnects to server automatically

## Requirements

- Node.js 18+
- Claude Code CLI installed and authenticated
- Chrome 114+
```

- [ ] **Step 5: Commit**

```bash
git add package.json start-server.sh README.md
git commit -m "docs: add setup scripts and README"
```

---

## Chunk 5: End-to-End Testing

### Task 9: Manual end-to-end test

- [ ] **Step 1: Start the server**

Run: `npm run server`
Expected: `Claude bridge server listening on ws://localhost:3456`

- [ ] **Step 2: Load the extension in Chrome**

Open `chrome://extensions/` → Developer mode → Load unpacked → `extension/` folder.
Confirm no errors.

- [ ] **Step 3: Open the side panel**

Click extension icon. Expected:
- Side panel opens on right
- Green connection dot in status bar
- Sessions view visible (empty initially)
- Page context chip auto-attached with current page title
- Status bar shows "claude opus 4.6" and "build agent"

- [ ] **Step 4: Test new chat from sessions view**

Type "Hello, what can you do?" in the input and press Enter.
Expected:
- Transitions to chat view
- User message appears labeled "YOU"
- Claude's response streams in labeled "CLAUDE"
- Blinking cursor while streaming
- Session appears in sessions list when done

- [ ] **Step 5: Test back button and sessions list**

Click back arrow. Expected:
- Returns to sessions view
- New session appears in list with correct title, date, "Active" badge

- [ ] **Step 6: Test page context**

Navigate to a content-heavy page, reopen panel, verify:
- Context chip shows the page title
- Ask "Summarize this page" — Claude should reference page content

- [ ] **Step 7: Test filter tabs**

Click Draft/Done tabs, verify filtering works. Change a session status via the dropdown.

- [ ] **Step 8: Test disconnection**

Stop server → dot turns red. Restart → auto-reconnects, dot turns green.

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "feat: complete Claude side panel extension v1.0"
```
