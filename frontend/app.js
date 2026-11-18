const $ = (sel) => document.querySelector(sel);

const messagesEl = $("#messages");
const welcomeEl = $("#welcome");
const form = $("#chatForm");
const input = $("#input");
const sendBtn = $("#sendBtn");
const stopBtn = $("#stopBtn");
const statusDot = $("#statusDot");
const statusText = $("#statusText");
const modelSelect = $("#modelSelect");
const sessionTitleEl = $("#sessionTitle");
const themeToggle = $("#themeToggle");

const STORE_KEY = "zj.sessions.v2";
const SETTINGS_KEY = "zj.settings.v2";
const THEME_KEY = "zj.theme";

const state = {
  sessions: [],
  activeId: null,
  settings: {
    baseUrl: "",
    apiKey: "",
    model: "",
    temperature: 0.7,
    maxTokens: null,
    systemPrompt: "",
    role: "general",
  },
  roles: {},
  presetTopics: [],
  streaming: false,
  abort: null,
};

if (window.marked) {
  marked.setOptions({ breaks: true, gfm: true });
}
if (window.hljs) {
  hljs.configure({ languages: [] });
}

/* ---------- CDN loader (multi-mirror fallback) ---------- */
function loadScript(urls, check) {
  return new Promise((resolve) => {
    if (check()) return resolve(true);
    let i = 0;
    const tryNext = () => {
      if (i >= urls.length) return resolve(false);
      const s = document.createElement("script");
      s.src = urls[i++];
      s.onload = () => resolve(true);
      s.onerror = tryNext;
      document.head.appendChild(s);
    };
    tryNext();
  });
}

const CDN_MIRRORS = {
  marked: [
    "https://cdn.jsdelivr.net/npm/marked@15/marked.min.js",
    "https://unpkg.com/marked@15/marked.min.js",
    "https://fastly.jsdelivr.net/npm/marked@15/marked.min.js",
  ],
  hljs: [
    "https://cdn.jsdelivr.net/npm/highlight.js@11/highlight.min.js",
    "https://unpkg.com/highlight.js@11/highlight.min.js",
    "https://fastly.jsdelivr.net/npm/highlight.js@11/highlight.min.js",
  ],
};

async function loadLibs() {
  const okMarked = await loadScript(CDN_MIRRORS.marked, () => !!window.marked);
  const okHljs = await loadScript(CDN_MIRRORS.hljs, () => !!window.hljs);
  if (okMarked) marked.setOptions({ breaks: true, gfm: true });
  if (okHljs) hljs.configure({ languages: [] });
  return { okMarked, okHljs };
}

/* ---------- theme ---------- */
function safeGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, val); } catch (e) { /* ignore */ }
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
  safeSet(THEME_KEY, theme);
  let css = document.getElementById("hljs-css");
  if (!css) {
    css = document.createElement("link");
    css.id = "hljs-css";
    css.rel = "stylesheet";
    document.head.appendChild(css);
  }
  css.href = theme === "dark"
    ? "https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github-dark.min.css"
    : "https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github.min.css";
}
function initTheme() {
  const saved = safeGet(THEME_KEY);
  let prefersDark = false;
  try { prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { /* ignore */ }
  applyTheme(saved || (prefersDark ? "dark" : "light"));
}
themeToggle.addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

/* ---------- persistence ---------- */
function loadSessions() {
  try {
    const raw = safeGet(STORE_KEY);
    if (raw) state.sessions = JSON.parse(raw);
  } catch (e) { state.sessions = []; }
  if (!state.sessions.length) createSession();
  state.activeId = state.sessions[0].id;
}
function saveSessions() { safeSet(STORE_KEY, JSON.stringify(state.sessions)); }

function loadSettings() {
  try {
    const raw = safeGet(SETTINGS_KEY);
    if (raw) state.settings = { ...state.settings, ...JSON.parse(raw) };
  } catch (e) { /* ignore */ }
}
function saveSettings() { safeSet(SETTINGS_KEY, JSON.stringify(state.settings)); }

/* ---------- sessions ---------- */
function createSession() {
  const s = {
    id: "s" + Date.now() + Math.random().toString(16).slice(2, 6),
    title: "新会话",
    role: state.settings.role,
    messages: [],
    createdAt: Date.now(),
  };
  state.sessions.unshift(s);
  state.activeId = s.id;
  saveSessions();
  renderSessions();
  renderMessages();
  return s;
}

function switchSession(id) {
  state.activeId = id;
  if (state.streaming) { state.abort?.abort(); state.streaming = false; }
  renderSessions();
  renderMessages();
}

function deleteSession(id) {
  if (state.sessions.length <= 1) {
    const s = getActive();
    s.title = "新会话";
    s.messages = [];
    s.role = state.settings.role;
    saveSessions();
    renderSessions();
    renderMessages();
    return;
  }
  const idx = state.sessions.findIndex((x) => x.id === id);
  state.sessions = state.sessions.filter((x) => x.id !== id);
  state.activeId = state.sessions[Math.max(0, idx - 1)].id;
  saveSessions();
  renderSessions();
  renderMessages();
}

function renameSession(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  const title = prompt("重命名会话", s.title);
  if (title) {
    s.title = title.trim() || "新会话";
    saveSessions();
    renderSessions();
  }
}

function clearSession() {
  const s = getActive();
  if (!s.messages.length) return;
  if (!confirm("确定清空当前会话的全部消息？")) return;
  s.messages = [];
  s.title = "新会话";
  saveSessions();
  renderSessions();
  renderMessages();
  toast("已清空当前会话");
}

function exportSession() {
  const s = getActive();
  if (!s.messages.length) return toast("当前会话没有消息");
  const lines = [`# ${s.title}`, "", `> 导出时间：${new Date().toLocaleString("zh-CN")}`, "> 角色：" + (state.roles[s.role]?.name || s.role), ""];
  s.messages.forEach((m) => {
    lines.push(m.role === "user" ? "## 👤 用户" : "## 🧭 智驾 Agent", "", m.content, "");
  });
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${s.title || "session"}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("已导出 Markdown");
}

function getActive() {
  return state.sessions.find((x) => x.id === state.activeId) || state.sessions[0];
}

/* ---------- rendering ---------- */
function setStatus(online, text) {
  statusDot.classList.toggle("online", online);
  statusText.textContent = text;
}

function renderSessions() {
  document.querySelector(".sessions")?.remove();
  const container = document.createElement("div");
  container.className = "sessions";
  state.sessions.forEach((s) => {
    const item = document.createElement("div");
    item.className = "session-item" + (s.id === state.activeId ? " active" : "");
    item.innerHTML = `
      <span class="session-title-text">${escapeHtml(s.title || "新会话")}</span>
      <span class="session-actions">
        <button class="mini" data-act="rename" title="重命名">✎</button>
        <button class="mini danger" data-act="delete" title="删除">🗑</button>
      </span>`;
    item.onclick = (e) => {
      const act = e.target.closest("button")?.dataset.act;
      if (act === "rename") { e.stopPropagation(); renameSession(s.id); return; }
      if (act === "delete") { e.stopPropagation(); deleteSession(s.id); return; }
      switchSession(s.id);
    };
    container.appendChild(item);
  });
  $("#newChatBtn").after(container);
}

function renderRoles(roles) {
  const el = $("#roleList");
  el.innerHTML = "";
  Object.entries(roles).forEach(([key, r]) => {
    const btn = document.createElement("button");
    btn.className = "role-chip" + (key === state.settings.role ? " active" : "");
    btn.innerHTML = `${r.icon} ${r.name}`;
    btn.onclick = () => {
      state.settings.role = key;
      saveSettings();
      renderRoles(roles);
      const s = getActive();
      s.role = key;
      saveSessions();
      toast(`已切换为「${r.name}」`);
    };
    el.appendChild(btn);
  });
}

function renderPresetTopics(topics) {
  [$("#presetTopics"), $("#welcomeTopics")].forEach((el) => {
    if (!el) return;
    el.innerHTML = "";
    topics.forEach((t) => {
      const chip = document.createElement("button");
      chip.className = "topic-chip";
      chip.textContent = t;
      chip.onclick = () => { input.value = t; submit(); };
      el.appendChild(chip);
    });
  });
}

function renderMessages() {
  messagesEl.innerHTML = "";
  const msgs = getActive().messages;
  sessionTitleEl.textContent = getActive().title;
  if (!msgs.length) {
    welcomeEl.style.display = "flex";
    return;
  }
  welcomeEl.style.display = "none";
  msgs.forEach((m) => appendMessageDom(m.role, m.content, m.error, m.time, false));
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function appendMessageDom(role, content, error, ts, streaming) {
  const row = document.createElement("div");
  row.className = `message ${role}`;
  const avatar = role === "user" ? "👤" : "🧭";
  row.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div class="msg-body">
      <div class="bubble${error ? " error" : ""}"></div>
      <div class="msg-meta">
        <span class="msg-time">${streaming ? "" : fmtTime(ts || Date.now())}</span>
        <span class="msg-actions"></span>
      </div>
    </div>`;
  const bubble = row.querySelector(".bubble");
  const actions = row.querySelector(".msg-actions");

  if (streaming) {
    renderBubble(bubble, content, true);
  } else {
    renderBubble(bubble, content, false);
    actions.innerHTML = `
      ${role === "assistant" ? '<button class="mini" data-act="regenerate" title="重新生成">↻</button>' : ""}
      <button class="mini" data-act="copy" title="复制">📋</button>
      <button class="mini" data-act="edit" title="编辑重发">✎</button>
      <button class="mini danger" data-act="delete" title="删除">🗑</button>`;

    if (role === "assistant") {
      actions.querySelector('[data-act="regenerate"]').onclick = () => regenerateLast();
    }
    actions.querySelector('[data-act="copy"]').onclick = () => {
      navigator.clipboard.writeText(bubble.textContent).then(() => {
        toast("已复制");
      });
    };
    actions.querySelector('[data-act="edit"]').onclick = () => editMessage(row, role, content);
    actions.querySelector('[data-act="delete"]').onclick = () => deleteMessage(row, role, content);
  }

  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return row;
}

function renderBubble(el, text, streaming) {
  if (markedReady()) {
    const html = marked.parse(text || "");
    el.innerHTML = html + (streaming ? '<span class="cursor">▍</span>' : "");
    el.querySelectorAll("pre code").forEach((block) => {
      if (window.hljs) hljs.highlightElement(block);
      const pre = block.parentElement;
      if (!pre.querySelector(".code-copy")) {
        const copyBtn = document.createElement("button");
        copyBtn.className = "code-copy";
        copyBtn.textContent = "复制";
        copyBtn.onclick = () => navigator.clipboard.writeText(block.textContent).then(() => toast("已复制代码"));
        pre.appendChild(copyBtn);
      }
    });
  } else {
    el.textContent = text;
  }
}

function markedReady() {
  return !!window.marked;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ---------- message edit / delete ---------- */
function editMessage(row, role, content) {
  const s = getActive();
  const idx = s.messages.findIndex((m) => m.role === role && m.content === content);
  if (idx === -1) return;
  const newText = prompt("编辑这条消息", content);
  if (newText === null) return;
  s.messages[idx] = { role, content: newText, time: Date.now() };
  if (role === "user" && s.messages[idx + 1]?.role === "assistant") {
    s.messages.splice(idx + 1, 1); // 删除随后的回答
  }
  saveSessions();
  renderMessages();
  if (role === "user") toast("已更新并重新发送");
}

function deleteMessage(row, role, content) {
  const s = getActive();
  const idx = s.messages.findIndex((m) => m.role === role && m.content === content);
  if (idx === -1) return;
  s.messages.splice(idx, 1);
  saveSessions();
  renderMessages();
}

/* ---------- chat ---------- */
async function submit() {
  const text = input.value.trim();
  if (!text || state.streaming) return;

  const s = getActive();
  s.messages.push({ role: "user", content: text, time: Date.now() });
  if (s.title === "新会话") s.title = text.slice(0, 20);
  sessionTitleEl.textContent = s.title;
  saveSessions();
  renderSessions();
  appendMessageDom("user", text, false, Date.now(), false);
  input.value = "";
  autoResize();
  welcomeEl.style.display = "none";

  await sendToLLM(s);
}

async function regenerateLast() {
  const s = getActive();
  const msgs = s.messages;
  if (!msgs.length || msgs[msgs.length - 1].role !== "assistant") return;
  msgs.pop();
  saveSessions();
  renderMessages();
  await sendToLLM(s);
}

async function sendToLLM(s) {
  if (state.streaming) return;
  state.streaming = true;
  sendBtn.disabled = true;
  stopBtn.classList.remove("hidden");
  form.classList.add("streaming");

  const row = appendMessageDom("assistant", "", false, Date.now(), true);
  const bubble = row.querySelector(".bubble");
  let full = "";
  const controller = new AbortController();
  state.abort = controller;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: s.messages,
        base_url: state.settings.baseUrl || null,
        api_key: state.settings.apiKey || null,
        model: state.settings.model || null,
        role: s.role || state.settings.role || "general",
        system_prompt: state.settings.systemPrompt || null,
        temperature: parseFloat(state.settings.temperature) || 0.7,
        max_tokens: state.settings.maxTokens ? parseInt(state.settings.maxTokens) : null,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop();
      for (const line of parts) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        const data = JSON.parse(payload);
        if (data.error) throw new Error(data.error);
        full += data.delta || "";
        renderBubble(bubble, full, true);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") {
      bubble.classList.add("error");
      renderBubble(bubble, `⚠️ 请求失败：${e.message}`);
    }
  } finally {
    state.streaming = false;
    state.abort = null;
    sendBtn.disabled = false;
    stopBtn.classList.add("hidden");
    form.classList.remove("streaming");
    if (full) {
      s.messages.push({ role: "assistant", content: full, time: Date.now() });
      saveSessions();
      renderMessages();
    } else {
      row.remove();
    }
    input.focus();
  }
}

stopBtn.addEventListener("click", () => { state.abort?.abort(); });

/* ---------- events ---------- */
form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  autoResize();
});
function autoResize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 150) + "px";
}

$("#newChatBtn").addEventListener("click", () => { createSession(); input.focus(); });
$("#clearSessionBtn").addEventListener("click", clearSession);
$("#exportBtn").addEventListener("click", exportSession);

$("#settingsBtn").addEventListener("click", () => {
  $("#setBaseUrl").value = state.settings.baseUrl;
  $("#setApiKey").value = state.settings.apiKey;
  $("#setModel").value = state.settings.model;
  $("#setTemperature").value = state.settings.temperature;
  $("#setMaxTokens").value = state.settings.maxTokens || "";
  $("#setSystemPrompt").value = state.settings.systemPrompt;
  $("#settingsModal").classList.remove("hidden");
});
$("#modalClose").addEventListener("click", () => $("#settingsModal").classList.add("hidden"));
$("#modalCancel").addEventListener("click", () => $("#settingsModal").classList.add("hidden"));
$("#modalSave").addEventListener("click", () => {
  state.settings.baseUrl = $("#setBaseUrl").value.trim();
  state.settings.apiKey = $("#setApiKey").value.trim();
  state.settings.model = $("#setModel").value.trim();
  state.settings.temperature = $("#setTemperature").value || 0.7;
  state.settings.maxTokens = $("#setMaxTokens").value || null;
  state.settings.systemPrompt = $("#setSystemPrompt").value.trim();
  saveSettings();
  $("#settingsModal").classList.add("hidden");
  const hasKey = !!state.settings.apiKey;
  setStatus(hasKey, hasKey ? "已连接（浏览器配置）" : "将使用服务端配置");
  populateModelSelect();
  toast("设置已保存");
});

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2000);
}

/* ---------- model select ---------- */
function populateModelSelect() {
  const model = state.settings.model;
  modelSelect.innerHTML = "";
  const options = ["gpt-4o-mini", "deepseek-chat", "qwen-plus", "gpt-4o"];
  const known = options.includes(model) ? [] : [model];
  [...known, ...options].forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    opt.selected = m === model;
    modelSelect.appendChild(opt);
  });
  modelSelect.value = model;
}
modelSelect.addEventListener("change", () => {
  state.settings.model = modelSelect.value;
  saveSettings();
});

/* ---------- init ---------- */
async function fetchSettings() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();
    state.roles = data.roles || {};
    state.presetTopics = data.preset_topics || [];
    if (!state.settings.baseUrl) state.settings.baseUrl = data.base_url;
    if (!state.settings.model) state.settings.model = data.model;
    if (data.has_api_key) {
      setStatus(true, "服务端已配置 API Key");
    } else if (!state.settings.apiKey) {
      setStatus(false, "请配置 API Key");
    } else {
      setStatus(true, "已连接（浏览器配置）");
    }
    renderRoles(state.roles);
    renderPresetTopics(state.presetTopics);
    populateModelSelect();
  } catch (e) {
    setStatus(false, "无法获取服务端配置");
  }
}

initTheme();
loadSessions();
loadSettings();
fetchSettings();
renderMessages();
input.focus();
loadLibs().then(() => renderMessages());
