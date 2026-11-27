@echo off
rem 智驾辅助 Agent 一键启动脚本（Windows）
cd /d %~dp0
if not exist .venv (
  echo [提示] 未发现 .venv，正在使用系统 Python 运行。
)
if exist .env.example if not exist .env (
  copy .env.example .env >nul
  echo [提示] 已从 .env.example 生成 .env，请按需修改其中的 LLM_API_KEY。
)
python backend\run.py
pause
