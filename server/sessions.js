import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const STORE_PATH = path.join(DATA_DIR, "sessions.json");
const VALID_STATUSES = new Set(["active", "draft", "done"]);

let sessions = [];
let persistQueue = Promise.resolve();
const pageContextCache = new Map();

function clone(value) {
  return structuredClone(value);
}

function normalizePageContext(pageContext) {
  if (!pageContext || typeof pageContext !== "object") {
    return null;
  }

  const url = String(pageContext.url ?? "");
  const title = String(pageContext.title ?? "");
  const text = String(pageContext.text ?? "").slice(0, 20000);
  const capturedAt = pageContext.capturedAt
    ? String(pageContext.capturedAt)
    : new Date().toISOString();

  if (!url && !title && !text) {
    return null;
  }

  return { url, title, text, capturedAt };
}

function pageContextMetadata(pageContext) {
  if (!pageContext) {
    return null;
  }

  return {
    url: pageContext.url,
    title: pageContext.title,
    text: "",
    capturedAt: pageContext.capturedAt,
  };
}

function normalizeMessage(message) {
  return {
    id: String(message.id ?? randomUUID()),
    role: message.role === "assistant" ? "assistant" : "user",
    text: String(message.text ?? ""),
    timestamp: String(message.timestamp ?? new Date().toISOString()),
  };
}

function normalizeSession(session) {
  const createdAt = String(session.createdAt ?? new Date().toISOString());
  const updatedAt = String(session.updatedAt ?? createdAt);
  const status = VALID_STATUSES.has(session.status) ? session.status : "active";
  const normalizedPageContext = normalizePageContext(session.pageContext);

  if (normalizedPageContext?.text) {
    pageContextCache.set(String(session.id ?? ""), normalizedPageContext);
  }

  return {
    id: String(session.id ?? randomUUID()),
    title: String(session.title ?? "New chat"),
    status,
    createdAt,
    updatedAt,
    sdkSessionId: session.sdkSessionId ? String(session.sdkSessionId) : null,
    pageContext: pageContextMetadata(normalizedPageContext),
    messages: Array.isArray(session.messages)
      ? session.messages.map(normalizeMessage)
      : [],
  };
}

function sortSessions() {
  sessions.sort(
    (left, right) =>
      new Date(right.updatedAt).valueOf() - new Date(left.updatedAt).valueOf(),
  );
}

function schedulePersist() {
  persistQueue = persistQueue
    .catch(() => {})
    .then(async () => {
      await mkdir(DATA_DIR, { recursive: true });
      const persistedSessions = sessions.map((session) => ({
        ...session,
        pageContext: pageContextMetadata(session.pageContext),
      }));
      await writeFile(
        STORE_PATH,
        JSON.stringify({ sessions: persistedSessions }, null, 2),
        "utf8",
      );
    })
    .catch((error) => {
      console.error("Failed to persist sessions:", error);
    });

  return persistQueue;
}

function getMutableSession(id) {
  return sessions.find((session) => session.id === id) ?? null;
}

export async function loadSessions() {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.map(normalizeSession)
      : [];
    sortSessions();
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    sessions = [];
  }
}

export function createSession({ title, pageContext } = {}) {
  const createdAt = new Date().toISOString();
  const normalizedPageContext = normalizePageContext(pageContext);
  const session = normalizeSession({
    id: randomUUID(),
    title: title?.trim() || "New chat",
    status: "active",
    createdAt,
    updatedAt: createdAt,
    sdkSessionId: null,
    pageContext: normalizedPageContext,
    messages: [],
  });

  if (normalizedPageContext?.text) {
    pageContextCache.set(session.id, normalizedPageContext);
  }

  sessions.unshift(session);
  void schedulePersist();
  return clone(session);
}

export function getSession(id) {
  const session = getMutableSession(id);
  return session ? clone(session) : null;
}

export function listSessions(filter = "all") {
  const matches =
    !filter || filter === "all"
      ? sessions
      : sessions.filter((session) => session.status === filter);

  return matches.map(clone);
}

export function addMessage(sessionId, role, text) {
  const session = getMutableSession(sessionId);
  if (!session) {
    return null;
  }

  const message = normalizeMessage({
    role,
    text,
    timestamp: new Date().toISOString(),
  });

  session.messages.push(message);
  session.updatedAt = message.timestamp;
  sortSessions();
  void schedulePersist();
  return clone(message);
}

export function updateSession(id, updates = {}) {
  const session = getMutableSession(id);
  if (!session) {
    return null;
  }

  if (typeof updates.title === "string" && updates.title.trim()) {
    session.title = updates.title.trim();
  }

  if (typeof updates.status === "string" && VALID_STATUSES.has(updates.status)) {
    session.status = updates.status;
  }

  if ("sdkSessionId" in updates) {
    session.sdkSessionId = updates.sdkSessionId
      ? String(updates.sdkSessionId)
      : null;
  }

  if ("pageContext" in updates) {
    const normalizedPageContext = normalizePageContext(updates.pageContext);
    session.pageContext = pageContextMetadata(normalizedPageContext);

    if (normalizedPageContext?.text) {
      pageContextCache.set(id, normalizedPageContext);
    } else {
      pageContextCache.delete(id);
    }
  }

  session.updatedAt = new Date().toISOString();
  sortSessions();
  void schedulePersist();
  return clone(session);
}

export function deleteSession(id) {
  const index = sessions.findIndex((session) => session.id === id);
  if (index === -1) {
    return null;
  }

  const [removed] = sessions.splice(index, 1);
  pageContextCache.delete(id);
  void schedulePersist();
  return clone(removed);
}

export function getSessionCount() {
  const counts = { active: 0, draft: 0, done: 0 };

  for (const session of sessions) {
    if (VALID_STATUSES.has(session.status)) {
      counts[session.status] += 1;
    }
  }

  return counts;
}

export function getCachedPageContext(id) {
  const pageContext = pageContextCache.get(id);
  return pageContext ? clone(pageContext) : null;
}
