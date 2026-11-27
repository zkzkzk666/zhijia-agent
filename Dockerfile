# 智驾辅助 Agent - 容器化部署
# 构建:  docker build -t zhijia-agent .
# 运行:  docker run -p 8000:8000 --env-file .env zhijia-agent
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY frontend ./frontend

EXPOSE 8000

CMD ["python", "backend/run.py"]
