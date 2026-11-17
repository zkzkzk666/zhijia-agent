# 智驾辅助 Agent (Zhijia Agent)

面向智能驾驶（智驾）领域的 AI 辅助工具：Web 聊天界面 + 可配置的 OpenAI 兼容大模型接口。

## 功能

- 智驾领域专家级系统提示词：感知、融合定位、规控、测试数据、功能安全（ISO 26262 / SOTIF / ODD）、工程实践
- 简洁 Web 聊天界面，流式输出（SSE），Markdown 渲染，常用话题一键提问
- 接口配置灵活：服务端 `.env` 或浏览器端设置，兼容任意 OpenAI 兼容接口（DeepSeek、Qwen、vLLM、Ollama 等）
- 纯 Python + 静态前端，无构建步骤，克隆即可运行

## 快速开始

```bash
git clone <repo-url>
cd zhijia-agent

# 1. 安装依赖
pip install -r requirements.txt

# 2. 配置接口（可跳过，也可在浏览器端配置）
cp .env.example .env
# 编辑 .env 填入 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL

# 3. 启动
python backend/run.py
```

打开浏览器访问 <http://127.0.0.1:8000> 即可使用。

若不想改 `.env`，可直接在页面右上角「⚙️ 接口设置」里填入 Base URL / API Key / 模型，配置保存在浏览器本地。

## 项目结构

```
zhijia-agent/
├── backend/
│   ├── run.py            # 启动入口
│   └── app/
│       ├── main.py       # FastAPI 应用与路由
│       ├── config.py     # 环境变量配置
│       ├── llm.py        # OpenAI 兼容流式调用
│       └── prompt.py     # 智驾系统提示词与预设话题
├── frontend/
│   ├── index.html        # 页面
│   ├── style.css         # 样式
│   └── app.js            # 聊天交互与流式渲染
├── requirements.txt
└── .env.example
```

## 接口说明

### POST /api/chat

请求体：

```json
{
  "messages": [{ "role": "user", "content": "AEB 标定要点有哪些？" }],
  "base_url": "https://api.deepseek.com/v1",
  "api_key": "sk-xxx",
  "model": "deepseek-chat"
}
```

返回 `text/event-stream` 流式响应，每行 `data: {"delta": "..."}`，结束为 `data: [DONE]`。

### GET /api/settings

返回服务端默认配置（Base URL、模型、预设话题）与是否已配置 API Key。

## 安全提示

- API Key 支持在浏览器端配置并仅存于浏览器 `localStorage`，服务端 `.env` 中的 Key 不会返回给前端。
- 生产环境如需公网部署，建议自行加反向代理鉴权，当前默认仅监听本机。
