FROM node:22-alpine AS ui
WORKDIR /ui
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build
FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/
COPY --from=ui /ui/dist ./frontend/dist
ENV DATABASE_URL=sqlite+aiosqlite:////var/data/idiaba.db PYTHONUNBUFFERED=1
EXPOSE 10000
CMD ["sh","-c","cd backend && uvicorn app.main:app --host 0.0.0.0 --port 10000"]
