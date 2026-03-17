# Ramp Side Panel — Chrome Extension

> Inspired by the internal "Ramp Inspect" tool shown in [Inside Ramp, the $32B Company Where AI Agents Run Everything | Geoff Charles](https://www.youtube.com/watch?v=RBqT2PHWdBg) by Peter Yang.

A Chrome extension that adds a **Claude AI chat side panel** alongside any webpage — just like the tool Ramp's team built internally. It connects to your local Claude Code installation, so you don't need a separate API key.

## Demo

https://github.com/user-attachments/assets/demo_video.mov

https://github.com/drhb/ramp-side-panel/assets/demo_video.mov

> *The demo video is in [`assets/demo_video.mov`](assets/demo_video.mov). If the embed above doesn't render, download it directly.*

## How it works

```
Chrome Side Panel  ←→  Local WebSocket Server  ←→  Claude Agent SDK  ←→  Claude Code CLI
```

1. A small **Node.js WebSocket server** runs locally on `localhost:3456`
2. It uses the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) which wraps your local Claude Code CLI
3. The Chrome extension's **side panel** connects to the server via WebSocket
4. A **content script** extracts page text, so Claude can see what you're looking at
5. Claude's response **streams back** in real-time into the panel

**No extra API key needed** — it uses your existing Claude Code authentication.

## Features

- **Sessions list** — browse, filter (Active / Draft / Open / Done), resume past chats
- **Page context** — auto-attaches current page content as a context chip
- **Streaming responses** — Claude's answers stream in real-time with a typing cursor
- **Session management** — change status, go back/forward between sessions
- **Auto-reconnect** — panel reconnects to the server automatically
- **Clean UI** — Ramp Inspect-inspired flat white design with status bar

## Quick Setup

### 1. Install dependencies

```bash
npm run setup
```

### 2. Start the bridge server

```bash
npm run server
```

You should see: `Claude bridge server listening on ws://localhost:3456`

### 3. Load the Chrome extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder from this repo

### 4. Use it

- Click the extension icon in Chrome's toolbar to open the side panel
- Page context auto-attaches (shows the page title as a chip)
- Type your message and press Enter
- Sessions are saved and browsable

## Requirements

- **Node.js 18+**
- **Claude Code CLI** installed and authenticated (`claude` command available in terminal)
- **Chrome 114+**

## Project Structure

```
ramp-side-panel/
├── extension/          # Chrome extension (Manifest V3 + Side Panel API)
│   ├── manifest.json
│   ├── background.js   # Service worker
│   ├── content.js      # Extracts page text
│   ├── sidepanel.html  # Side panel UI
│   ├── sidepanel.css   # Ramp Inspect-style CSS
│   ├── sidepanel.js    # Chat logic + WebSocket client
│   └── icons/
├── server/             # Local bridge server
│   ├── index.js        # WebSocket + Agent SDK integration
│   └── sessions.js     # In-memory session store
├── assets/
│   └── demo_video.mov  # Demo video
├── start-server.sh     # Auto-start helper script
└── package.json
```

## Background

In the video, Geoff Charles (CPO of Ramp) demos an internal tool called **Ramp Inspect** — a Chrome extension side panel powered by Claude that lets their team chat with AI alongside any page in their app. Someone in the comments asked how it was built:

> *"any insight on how this tool was actually made?"* — @stijnbeauprez

This repo is a working example showing how to build the same thing using:
- **Chrome Side Panel API** (Manifest V3)
- **Claude Agent SDK** (connects to your local Claude Code)
- **WebSocket** bridge between the extension and a local Node.js server

It's not Ramp's actual code — it's an open-source recreation of the concept.

## License

MIT
