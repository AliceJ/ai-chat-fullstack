# AI MVP — Full Stack Chat Demo

React + Vercel AI SDK frontend, Node.js + Fastify backend, DeepSeek API.

## Quick Start

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env and add your DeepSeek API key
```

### 2. Run with Docker

```bash
docker compose up --build
```

### 3. Open

- Frontend: http://localhost:5173
- Backend health: http://localhost:3001/api/health

## Local Development (without Docker)

**Backend:**

```bash
cd backend
npm install
cp ../.env.example ../.env   # edit with your API key
npm run dev
```

**Frontend (in another terminal):**

```bash
cd frontend
npm install
npm run dev
```

## Project Structure

```
.
├── backend/
│   ├── src/server.js      # Fastify server + DeepSeek proxy
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx        # Chat UI with useChat hook
│   │   ├── App.css
│   │   └── main.jsx
│   ├── vite.config.js
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
├── .env.example
└── README.md
```

## Tech Stack

| Layer    | Tech                        |
| -------- | --------------------------- |
| Frontend | React 19, Vite, @ai-sdk/react |
| Backend  | Fastify 5, OpenAI SDK       |
| AI       | DeepSeek API (OpenAI-compatible) |
| Infra    | Docker Compose              |

## Environment Variables

| Variable         | Default                   | Description          |
| ---------------- | ------------------------- | -------------------- |
| DEEPSEEK_API_KEY | (required)                | Your DeepSeek key    |
| DEEPSEEK_BASE_URL| https://api.deepseek.com/v1 | API base URL     |
| DEEPSEEK_MODEL   | deepseek-chat             | Model name           |
| PORT             | 3001                      | Backend port         |
