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

const STORE_KEY = "zj.sessions.v2";
const SETTINGS_KEY = "zj.settings.v2";

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

let markedReady = false;
if (window.marked) {
  marked.setOptions({ breaks: true, gfm: true });
  markedReady = true;
}
if (window.hljs) {
  hljs.configure({ languages: [] });
}

/* ---------- persistence ---------- */

function loadSessions() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) state.sessions = JSON.parse(raw);
  } catch (e) {
    state.sessions = [];
  }
  if (!state.sessions.length) createSession();
  state.activeId = state.sessions[0].id;
}

function saveSessions() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state.sessions));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) state.settings = { ...state.settings, ...JSON.parse(raw) };
  } catch (e) { /* ignore */ }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

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
  state.streaming = false;
  if (state.abort) state.abort.abort();
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

function getActive() {
  return state.sessions.find((x) => x.id === state.activeId) || state.sessions[0];
}

function activeMessages() {
  return getActive().messages;
}

/* ---------- rendering ---------- */

function setStatus(online, text) {
  statusDot.classList.toggle("online", online);
  statusText.textContent = text;
}

function renderSessions() {
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
      </span>
    `;
    item.onclick = (e) => {
      const act = e.target.closest("button")?.dataset.act;
      if (act === "rename") { e.stopPropagation(); renameSession(s.id); return; }
      if (act === "delete") { e.stopPropagation(); deleteSession(s.id); return; }
      switchSession(s.id);
    };
    container.appendChild(item);
  });
  const old = $(".sessions");
  if (old) old.remove();
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
      chip.onclick = () => {
        input.value = t;
        submit();
      };
      el.appendChild(chip);
    });
  });
}

function renderMessages() {
  messagesEl.innerHTML = "";
  const msgs = activeMessages();
  if (!msgs.length) {
    welcomeEl.style.display = "flex";
    sessionTitleEl.textContent = getActive().title;
    return;
  }
  welcomeEl.style.display = "none";
  msgs.forEach((m) => appendMessageDom(m.role, m.content, m.error, false));
  sessionTitleEl.textContent = getActive().title;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendMessageDom(role, content, error, streaming) {
  const row = document.createElement("div");
  row.className = `message ${role}`;
  const avatar = role === "user" ? "👤" : "🧭";
  row.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div class="bubble"></div>
  `;
  const bubble = row.querySelector(".bubble");
  if (error) bubble.classList.add("error");
  renderBubble(bubble, content, streaming);
  if (!streaming) {
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    actions.innerHTML = `
      <button class="mini" data-act="copy" title="复制">📋</button>
      <button class="mini" data-act="regenerate" title="重新生成">↻</button>
    `;
    if (role === "assistant") {
      row.appendChild(actions);
      row.querySelector('[data-act="copy"]').onclick = () => {
        navigator.clipboard.writeText(bubble.textContent).then(() => {
          actions.querySelector('[data-act="copy"]').textContent = "✓";
          setTimeout(() => (actions.querySelector('[data-act="copy"]').textContent = "📋"), 1200);
        });
      };
      row.querySelector('[data-act="regenerate"]').onclick = () => regenerateLast();
    }
  }
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return { row, bubble };
}

function renderBubble(el, text, streaming) {
  if (markedReady) {
    const html = marked.parse(text);
    el.innerHTML = html + (streaming ? '<span class="cursor">▍</span>' : "");
    el.querySelectorAll("pre code").forEach((block) => {
      if (window.hljs) hljs.highlightElement(block);
      const copyBtn = document.createElement("button");
      copyBtn.className = "code-copy mini";
      copyBtn.textContent = "复制";
      copyBtn.onclick = () => navigator.clipboard.writeText(block.textContent);
      const pre = block.parentElement;
      pre.style.position = "relative";
      pre.appendChild(copyBtn);
    });
  } else {
    el.textContent = text;
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ---------- chat ---------- */

async function submit() {
  const text = input.value.trim();
  if (!text || state.streaming) return;

  const s = getActive();
  s.messages.push({ role: "user", content: text });
  if (s.title === "新会话") s.title = text.slice(0, 20);
  sessionTitleEl.textContent = s.title;
  saveSessions();
  renderSessions();

  appendMessageDom("user", text);
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

  const { row, bubble } = appendMessageDom("assistant", "", false, true);
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
        try {
          const data = JSON.parse(payload);
          if (data.error) throw new Error(data.error);
          full += data.delta || "";
          renderBubble(bubble, full, true);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        } catch (e) {
          throw e;
        }
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
      s.messages.push({ role: "assistant", content: full });
      saveSessions();
      renderMessages();
    } else {
      // failed or empty: remove the placeholder
      row.remove();
    }
    input.focus();
  }
}

stopBtn.addEventListener("click", () => {
  if (state.abort) state.abort.abort();
});

/* ---------- events ---------- */

form.addEventListener("submit", (e) => {
  e.preventDefault();
  submit();
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
  autoResize();
});

function autoResize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 150) + "px";
}

$("#newChatBtn").addEventListener("click", () => {
  createSession();
  input.focus();
});

$("#settingsBtn").addEventListener("click", () => {
  $("#setBaseUrl").value = state.settings.baseUrl;
  $("#setApiKey").value = state.settings.apiKey;
  $("#setModel").value = state.settings.model;
  $("#setTemperature").value = state.settings.temperature;
  $("#setMaxTokens").value = state.settings.maxTokens || "";
  $("#setSystemPrompt").value = state.settings.systemPrompt;
  $("#settingsModal").classList.remove("hidden");
});

$("#modalCancel").addEventListener("click", () => {
  $("#settingsModal").classList.add("hidden");
});

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
});

/* ---------- init ---------- */

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

loadSessions();
loadSettings();
fetchSettings();
renderMessages();
input.focus();
