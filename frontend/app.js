const $ = (sel) => document.querySelector(sel);

const messagesEl = $("#messages");
const welcomeEl = $("#welcome");
const form = $("#chatForm");
const input = $("#input");
const sendBtn = $("#sendBtn");
const statusDot = $("#statusDot");
const statusText = $("#statusText");

const state = {
  messages: [],
  baseUrl: localStorage.getItem("zj.baseUrl") || "",
  apiKey: localStorage.getItem("zj.apiKey") || "",
  model: localStorage.getItem("zj.model") || "",
  streaming: false,
};

let markedReady = false;
if (window.marked) {
  marked.setOptions({ breaks: true, gfm: true });
  markedReady = true;
}

async function fetchSettings() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();
    if (!state.baseUrl) state.baseUrl = data.base_url;
    if (!state.model) state.model = data.model;
    if (!state.apiKey && data.has_api_key) {
      setStatus(true, "服务端已配置 API Key，可直接使用");
    }
    renderPresetTopics(data.preset_topics || []);
    setStatus(data.has_api_key, data.has_api_key ? "已连接" : "请配置 API Key");
    $("#setBaseUrl").value = state.baseUrl;
    $("#setModel").value = state.model;
  } catch (e) {
    setStatus(false, "无法获取服务端配置");
  }
}

function setStatus(online, text) {
  statusDot.classList.toggle("online", online);
  statusText.textContent = text;
}

function renderPresetTopics(topics) {
  const targets = [$("#presetTopics"), $("#welcomeTopics")];
  targets.forEach((el) => {
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

function addMessage(role, content) {
  welcomeEl.style.display = "none";
  const row = document.createElement("div");
  row.className = `message ${role}`;
  row.innerHTML = `
    <div class="avatar">${role === "user" ? "👤" : "🧭"}</div>
    <div class="bubble"></div>
  `;
  row.querySelector(".bubble").textContent = content;
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return row.querySelector(".bubble");
}

function renderBubble(el, text) {
  if (markedReady) {
    el.innerHTML = marked.parse(text);
  } else {
    el.textContent = text;
  }
}

function autoResize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 150) + "px";
}

async function submit() {
  const text = input.value.trim();
  if (!text || state.streaming) return;

  addMessage("user", text);
  state.messages.push({ role: "user", content: text });
  input.value = "";
  autoResize();
  sendBtn.disabled = true;
  state.streaming = true;

  const bubble = addMessage("assistant", "…");
  let full = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: state.messages,
        base_url: state.baseUrl || null,
        api_key: state.apiKey || null,
        model: state.model || null,
      }),
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

      const lines = buffer.split("\n\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const data = JSON.parse(payload);
          if (data.error) throw new Error(data.error);
          full += data.delta || "";
          renderBubble(bubble, full + "▍");
          messagesEl.scrollTop = messagesEl.scrollHeight;
        } catch (e) {
          if (!payload.startsWith("[DONE]")) throw e;
        }
      }
    }

    renderBubble(bubble, full);
  } catch (e) {
    renderBubble(bubble, `⚠️ 请求失败：${e.message}`);
  }

  state.messages.push({ role: "assistant", content: full });
  state.streaming = false;
  sendBtn.disabled = false;
  input.focus();
}

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

$("#settingsBtn").addEventListener("click", () => {
  $("#settingsModal").classList.remove("hidden");
});

$("#modalCancel").addEventListener("click", () => {
  $("#settingsModal").classList.add("hidden");
});

$("#modalSave").addEventListener("click", () => {
  state.baseUrl = $("#setBaseUrl").value.trim();
  state.apiKey = $("#setApiKey").value.trim();
  state.model = $("#setModel").value.trim();
  localStorage.setItem("zj.baseUrl", state.baseUrl);
  localStorage.setItem("zj.apiKey", state.apiKey);
  localStorage.setItem("zj.model", state.model);
  $("#settingsModal").classList.add("hidden");
  setStatus(!!state.apiKey, state.apiKey ? "已连接（浏览器配置）" : "将使用服务端配置");
});

fetchSettings();
input.focus();
