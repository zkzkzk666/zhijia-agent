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
const kbFileInput = $("#kbFileInput");
const sessionSearch = $("#sessionSearch");
const templateSelect = $("#templateSelect");

const STORE_KEY = "zj.sessions.v2";
const SETTINGS_KEY = "zj.settings.v2";
const THEME_KEY = "zj.theme";
const KB_KEY = "zj.kb.v1";

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
    kbTopK: 3,
  },
  roles: {},
  presetTopics: [],
  templates: [],
  kb: [],
  searchFilter: "",
  streaming: false,
  abort: null,
};

const TEMPLATES = [
  {
    id: "none",
    name: "不使用模板",
    prompt: "",
    desc: "使用当前角色默认提示词",
  },
  {
    id: "log-analyze",
    name: "日志分析",
    prompt: "你是一名智驾系统日志分析专家。用户会粘贴日志片段或描述现象。你的职责：\n1. 先概括现象与时间线；\n2. 定位可能的根因（感知/规控/网络/传感器/代码）；\n3. 给出下一步排查步骤和验证方法。\n要求：引用日志中关键行作为证据，不要臆测无依据的结论，可用表格整理关键事件。",
    desc: "粘贴智驾日志，定位问题根因",
  },
  {
    id: "code-review",
    name: "代码评审",
    prompt: "你是一名资深智驾软件工程师，进行严格的代码评审。对用户给出的代码：\n1. 指出正确性问题、边界条件、线程安全与内存风险；\n2. 指出编码规范与可维护性问题；\n3. 给出改进后的代码片段。\n要求：优先关注安全相关缺陷（空指针、数组越界、竞态、未定义行为），逐条列出问题优先级。",
    desc: "评审智驾相关代码",
  },
  {
    id: "odd-design",
    name: "ODD 设计",
    prompt: "你是一名功能安全与产品架构专家。帮助用户设计自动驾驶的运行设计域（ODD）。\n输出应包含：\n1. ODD 范围矩阵（道路类型、速度区间、天气、光照、交通条件、地理围栏）；\n2. 每项条件的量化定义与数据来源；\n3. 超出 ODD 时的降级与退出策略；\n4. 验证与场景化测试建议。",
    desc: "设计运行设计域 ODD",
  },
  {
    id: "sotif",
    name: "SOTIF 危害分析",
    prompt: "你是一名 SOTIF（ISO 21448）专家。帮助用户进行预期功能安全分析。\n输出应包含：\n1. 危害场景识别（HARA 思路）；\n2. 功能不足与触发条件分析；\n3. 风险接受准则与安全措施；\n4. 可验证的测试用例建议。\n强调：区分 ISO 26262 功能安全与 SOTIF 预期功能安全的边界。",
    desc: "预期功能安全分析与验证",
  },
  {
    id: "test-case",
    name: "测试用例生成",
    prompt: "你是一名智驾测试工程师。根据用户描述的功能/场景生成测试用例集。\n每个用例包含：前置条件、操作步骤、期望结果、优先级、边界/异常变体。\n覆盖正常、边界、异常、降级四类情况，输出为 Markdown 表格。",
    desc: "按场景生成结构化测试用例",
  },
  {
    id: "fault-locate",
    name: "故障定位",
    prompt: "你是一名智驾故障排查专家。用户会描述故障现象、相关模块与已有排查结果。\n你的流程：\n1. 建立故障假设清单并排出可能性；\n2. 给出验证每个假设的具体方法（数据/日志/复现手段）；\n3. 缩小范围后给出根因推断；\n4. 输出修复建议与回归验证项。",
    desc: "系统化排查智驾故障",
  },
];

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

function loadKb() {
  try {
    const raw = safeGet(KB_KEY);
    if (raw) state.kb = JSON.parse(raw);
  } catch (e) { state.kb = []; }
}
function saveKb() { safeSet(KB_KEY, JSON.stringify(state.kb)); }

/* ---------- knowledge base ---------- */
function chunkText(text) {
  const paras = text.split(/\r?\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + p).length > 800 && cur) {
      chunks.push(cur);
      cur = p;
    } else {
      cur = cur ? cur + "\n" + p : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

function kbTokenize(s) {
  const words = String(s).toLowerCase().match(/[a-z0-9_]+/g) || [];
  const cjk = String(s).match(/[\u4e00-\u9fa5]/g) || [];
  return new Set([...words, ...cjk]);
}

function kbSearch(query, topK) {
  const tokens = kbTokenize(query);
  if (!tokens.size) return [];
  const scored = [];
  state.kb.forEach((file) => {
    if (!file.enabled) return;
    (file.chunks || []).forEach((chunk) => {
      const ct = kbTokenize(chunk);
      let score = 0;
      tokens.forEach((t) => { if (ct.has(t)) score++; });
      if (score > 0) scored.push({ file: file.name, score, chunk });
    });
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

function kbContextFor(query) {
  const topK = parseInt(state.settings.kbTopK) || 3;
  const hits = kbSearch(query, topK);
  if (!hits.length) return "";
  const lines = hits.map((h, i) => `【来源${i + 1}：${h.file}】\n${h.chunk}`);
  return "\n\n=== 以下为知识库检索到的相关片段，请优先依据它们回答 ===\n" + lines.join("\n\n---\n\n");
}

function renderKb() {
  const el = $("#kbList");
  const count = state.kb.length;
  $("#kbCount").textContent = count ? `(${count})` : "";
  el.innerHTML = "";
  if (!count) {
    el.innerHTML = '<p class="hint">暂无文件</p>';
    return;
  }
  state.kb.forEach((f) => {
    const item = document.createElement("div");
    item.className = "kb-item";
    item.innerHTML = `
      <input type="checkbox" data-act="toggle" ${f.enabled ? "checked" : ""} title="启用/停用" />
      <span class="kb-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span class="kb-size">${f.chunks ? f.chunks.length : 0}段</span>
      <button class="mini danger" data-act="del" title="删除">🗑</button>`;
    item.querySelector('[data-act="toggle"]').onchange = (e) => {
      f.enabled = e.target.checked;
      saveKb();
      toast(f.enabled ? `已启用「${f.name}」` : `已停用「${f.name}」`);
    };
    item.querySelector('[data-act="del"]').onclick = () => {
      if (!confirm(`删除知识库文件「${f.name}」？`)) return;
      state.kb = state.kb.filter((x) => x !== f);
      saveKb();
      renderKb();
      toast("已删除");
    };
    el.appendChild(item);
  });
}

kbFileInput.addEventListener("change", async () => {
  const files = [...kbFileInput.files];
  kbFileInput.value = "";
  for (const file of files) {
    try {
      const text = await file.text();
      const chunks = chunkText(text);
      if (!chunks.length) { toast(`「${file.name}」为空`); continue; }
      state.kb.push({ name: file.name, enabled: true, chunks, size: file.size });
      toast(`已导入「${file.name}」(${chunks.length}段)`);
    } catch (e) {
      toast(`读取「${file.name}」失败：${e.message}`);
    }
  }
  saveKb();
  renderKb();
});

/* ---------- templates ---------- */
function renderTemplates() {
  templateSelect.innerHTML = "";
  TEMPLATES.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    templateSelect.appendChild(opt);
  });
  templateSelect.value = state.settings.templateId || "none";
}
templateSelect.addEventListener("change", () => {
  state.settings.templateId = templateSelect.value;
  saveSettings();
  const t = TEMPLATES.find((x) => x.id === state.settings.templateId);
  toast(t ? `已应用模板：${t.name}` : "已清除模板");
});

function activeTemplate() {
  const id = state.settings.templateId || "none";
  return TEMPLATES.find((x) => x.id === id) || TEMPLATES[0];
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
  downloadText(`${s.title || "session"}.md`, lines.join("\n"), "text/markdown;charset=utf-8");
  toast("已导出 Markdown");
}

function backupAll() {
  const data = {
    app: "zhijia-agent",
    version: 2,
    time: new Date().toISOString(),
    sessions: state.sessions,
    settings: state.settings,
    kb: state.kb,
  };
  downloadText(`zhijia-backup-${Date.now()}.json`, JSON.stringify(data, null, 2), "application/json;charset=utf-8");
  toast("已备份全部数据");
}

function restoreAll(file) {
  file.text().then((text) => {
    try {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.sessions)) throw new Error("格式不正确");
      state.sessions = data.sessions;
      state.activeId = state.sessions[0]?.id || (createSession(), getActive().id);
      if (data.settings) state.settings = { ...state.settings, ...data.settings };
      if (data.kb) state.kb = data.kb;
      saveSessions();
      saveSettings();
      saveKb();
      renderSessions();
      renderMessages();
      renderKb();
      populateModelSelect();
      toast("已恢复备份");
    } catch (e) {
      toast(`恢复失败：${e.message}`);
    }
  });
}

function downloadText(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function getActive() {
  return state.sessions.find((x) => x.id === state.activeId) || state.sessions[0];
}

/* ---------- stats ---------- */
function renderStats() {
  const total = state.sessions.length;
  const msgs = state.sessions.reduce((n, s) => n + s.messages.length, 0);
  $("#statsLine").textContent = `会话 ${total} · 消息 ${msgs}`;
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
  const kw = state.searchFilter.trim().toLowerCase();
  const list = kw
    ? state.sessions.filter((s) => (s.title || "").toLowerCase().includes(kw))
    : state.sessions;
  if (!list.length) {
    container.innerHTML = '<p class="hint">无匹配会话</p>';
  }
  list.forEach((s) => {
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
  renderStats();
}

sessionSearch.addEventListener("input", () => {
  state.searchFilter = sessionSearch.value;
  renderSessions();
});

function renderRoles(roles) {
  const el = $("#roleList");
  el.innerHTML = "";
  Object.entries(roles).forEach(([key, r]) => {
    const btn = document.createElement("button");
    btn.className = "role-chip" + (key === state.settings.role ? " active" : "");
    btn.innerHTML = `${r.icon} ${r.name}`;
    btn.onclick = () => {
      state.settings.role = key;
      state.settings.templateId = "none";
      templateSelect.value = "none";
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
      navigator.clipboard.writeText(bubble.textContent).then(() => toast("已复制"));
    };
    actions.querySelector('[data-act="edit"]').onclick = () => editMessage(row, role, content);
    actions.querySelector('[data-act="delete"]').onclick = () => deleteMessage(row, role, content);
  }

  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return row;
}

function renderBubble(el, text, streaming) {
  if (window.marked) {
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
    s.messages.splice(idx + 1, 1);
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

/* ---------- slash commands ---------- */
function handleCommand(text) {
  const cmd = text.toLowerCase().trim();
  switch (cmd) {
    case "/help":
      appendCommandReply([
        "/help - 显示此帮助",
        "/new - 新建会话",
        "/clear - 清空当前会话",
        "/export - 导出当前会话为 Markdown",
        "/theme - 切换主题",
        "/role - 显示当前角色",
        "/kb - 显示知识库状态",
      ]);
      return true;
    case "/new":
      createSession();
      input.focus();
      return true;
    case "/clear":
      clearSession();
      return true;
    case "/export":
      exportSession();
      return true;
    case "/theme":
      applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
      return true;
    case "/role":
      appendCommandReply(`当前角色：${state.roles[getActive().role]?.name || getActive().role}`);
      return true;
    case "/kb":
      appendCommandReply(state.kb.length
        ? "知识库文件：\n" + state.kb.map((f) => `- ${f.name}（${f.chunks.length}段，${f.enabled ? "启用" : "停用"}）`).join("\n")
        : "知识库为空，点击左侧「上传文件」导入 .txt/.md。");
      return true;
    default:
      return false;
  }
}

function appendCommandReply(text) {
  const s = getActive();
  s.messages.push({ role: "assistant", content: text, time: Date.now(), meta: "command" });
  saveSessions();
  renderMessages();
}

/* ---------- chat ---------- */
async function submit() {
  const text = input.value.trim();
  if (!text || state.streaming) return;

  if (text.startsWith("/") && handleCommand(text)) {
    input.value = "";
    autoResize();
    return;
  }

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

  const lastUserMsg = [...s.messages].reverse().find((m) => m.role === "user");
  const kbCtx = lastUserMsg ? kbContextFor(lastUserMsg.content) : "";
  const template = activeTemplate();
  const systemPrompt = [state.settings.systemPrompt, template.prompt]
    .filter(Boolean)
    .join("\n\n")
    || null;

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
        system_prompt: systemPrompt,
        kb_context: kbCtx,
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
$("#backupBtn").addEventListener("click", backupAll);
$("#restoreBtn").addEventListener("click", () => {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "application/json,.json";
  inp.onchange = () => inp.files[0] && restoreAll(inp.files[0]);
  inp.click();
});

$("#settingsBtn").addEventListener("click", () => {
  $("#setBaseUrl").value = state.settings.baseUrl;
  $("#setApiKey").value = state.settings.apiKey;
  $("#setModel").value = state.settings.model;
  $("#setTemperature").value = state.settings.temperature;
  $("#setMaxTokens").value = state.settings.maxTokens || "";
  $("#setKbTopK").value = state.settings.kbTopK || 3;
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
  state.settings.kbTopK = $("#setKbTopK").value || 3;
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
loadKb();
renderKb();
renderTemplates();
fetchSettings();
renderMessages();
input.focus();
loadLibs().then(() => renderMessages());
