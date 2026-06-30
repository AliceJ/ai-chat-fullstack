import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// 在所有 import 之前加载 .env 环境变量
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { streamText, StreamData } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { initDB, insertDocument, insertChunks, searchSimilar, deleteDocumentsByFilename } from './db.js';
import { embedText, embedBatch } from './embeddings.js';
import { runAgent } from './agent.js';
import { callWithRetry, compressConversation } from './llm-utils.js';

const app = Fastify({ logger: true });

// 注册 CORS 中间件 — 允许前端跨域请求
await app.register(cors, { origin: true });

// 注册 multipart 中间件 — 支持文件上传, 限制 5MB
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });

// AI 聊天客户端 — 使用 Vercel AI SDK 的 OpenAI 适配器,
// 指向 .env 中配置的 DeepSeek 兼容端点
const openai = createOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || 'http://model.mify.ai.srv/v1/',
});

const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

// 初始化 SQLite 数据库 (建表/加载已有数据)
await initDB();

// ============================================================
// POST /api/upload — 上传 .txt 文件, 切片后存入向量数据库
// ============================================================
app.post('/api/upload', async (request, reply) => {
  // 从 multipart 表单中读取文件内容
  const parts = request.parts();
  let fileData = null;
  let filename = 'unknown.txt';

  for await (const part of parts) {
    if (part.type === 'file') {
      filename = part.filename || 'unknown.txt';
      const chunks = [];
      for await (const chunk of part.file) {
        chunks.push(chunk);
      }
      fileData = Buffer.concat(chunks).toString('utf-8');
    }
  }

  if (!fileData) {
    return reply.code(400).send({ error: 'No file uploaded' });
  }

  if (!filename.endsWith('.txt')) {
    return reply.code(400).send({ error: 'Only .txt files are supported' });
  }

  // 使用 LangChain 的 RecursiveCharacterTextSplitter 切片
  // chunkSize=500 字符, chunkOverlap=50 确保相邻片段有重叠, 避免语义断裂
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });

  const docs = await splitter.createDocuments([fileData]);
  const texts = docs.map((d) => d.pageContent);

  if (texts.length === 0) {
    return reply.code(400).send({ error: 'File is empty or could not be split' });
  }

  // 批量生成 embedding 向量 (调用 Ollama)
  const embeddings = await embedBatch(texts);

  // 同名文件重复上传时, 先删旧数据再插入新数据
  deleteDocumentsByFilename(filename);
  const docId = insertDocument(filename);
  insertChunks(docId, texts, embeddings);

  return { docId, filename, chunks: texts.length };
});

// ============================================================
// POST /api/chat — RAG 增强的流式对话
// 流程: 用户问题 → embedding → 向量检索 Top3 → 注入 prompt → 流式回复
// ============================================================
app.post('/api/chat', async (request, reply) => {
  const { messages } = request.body;

  if (!messages || !Array.isArray(messages)) {
    return reply.code(400).send({ error: 'messages array is required' });
  }

  // 取最后一条用户消息作为检索查询
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  const query = lastUserMsg?.content || '';

  let sources = [];
  let contextText = '';

  if (query) {
    try {
      // 将用户问题转为向量, 在数据库中检索最相似的 3 个片段
      const queryEmbedding = await embedText(query);
      sources = searchSimilar(queryEmbedding, 3);

      // 将检索到的片段拼接为上下文文本, 注入 system prompt
      if (sources.length > 0) {
        contextText = sources
          .map((s, i) => `[Source ${i + 1}] (${s.filename})\n${s.content}`)
          .join('\n\n---\n\n');
      }
    } catch (err) {
      // RAG 检索失败时不阻断对话, 降级为无上下文的纯对话模式
      app.log.error({ err }, 'RAG retrieval failed, proceeding without context');
    }
  }

  // 有检索结果时, 构造带 <context> 的 system message
  const systemMessage = contextText
    ? {
        role: 'system',
        content: `You are a helpful assistant. Answer based on the following context when relevant. If the context doesn't contain enough information, use your general knowledge.\n\n<context>\n${contextText}\n</context>`,
      }
    : null;

  const fullMessages = systemMessage ? [systemMessage, ...messages] : messages;

  // 对话历史压缩：超过 4000 token 时自动总结早期轮次
  const compressedMessages = await compressConversation(fullMessages, {
    llmCaller: async (msgs) => {
      const result = await callWithRetry(async () => {
        const resp = await fetch(`${process.env.DEEPSEEK_BASE_URL || 'http://model.mify.ai.srv/v1/'}chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          },
          body: JSON.stringify({ model: MODEL, messages: msgs }),
        });
        if (!resp.ok) throw new Error(`LLM API error ${resp.status}`);
        return resp.json();
      });
      return { content: result.choices[0].message.content };
    },
  });

  // 使用 Vercel AI SDK 的 StreamData 机制, 将 sources 作为 annotation 随流式回复一起发送
  // 前端通过 msg.annotations 读取, 无需额外请求
  const data = new StreamData();

  if (sources.length > 0) {
    data.appendMessageAnnotation({
      type: 'sources',
      sources: sources.map((s) => ({
        id: s.id,
        filename: s.filename,
        content: s.content,
        score: s.score,
      })),
    });
  }

  const result = streamText({
    model: openai(MODEL),
    messages: compressedMessages,
    // 流式回复结束后关闭 StreamData, 确保 annotation 数据完整发送
    onFinish() {
      data.close();
    },
  });

  // 将 StreamData 绑定到流式响应, 前端 useChat 会自动解析 annotations
  const response = result.toDataStreamResponse({ data });

  return new Response(response.body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Vercel-AI-Data-Stream': 'v1',
    },
  });
});

// 健康检查端点 — 返回当前使用的模型名
app.get('/api/health', async () => ({
  status: 'ok',
  model: MODEL,
}));

// ============================================================
// POST /api/agent — Agent 模式: 工具调用循环
// 流程: 用户消息 → LLM 判断是否需要工具 → 执行工具 → 追加结果 → 再请求 LLM → 循环最多 3 轮
// ============================================================
app.post('/api/agent', async (request, reply) => {
  const { messages } = request.body;

  if (!messages || !Array.isArray(messages)) {
    return reply.code(400).send({ error: 'messages array is required' });
  }

  try {
    // 对话历史压缩：超过 4000 token 时自动总结早期轮次
    const compressed = await compressConversation(messages, {
      llmCaller: async (msgs) => {
        const result = await callWithRetry(async () => {
          const resp = await fetch(`${process.env.DEEPSEEK_BASE_URL || 'http://model.mify.ai.srv/v1/'}chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({ model: MODEL, messages: msgs }),
          });
          if (!resp.ok) throw new Error(`LLM API error ${resp.status}`);
          return resp.json();
        });
        return { content: result.choices[0].message.content };
      },
    });

    const { finalContent, steps } = await runAgent({
      messages: compressed,
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || 'http://model.mify.ai.srv/v1/',
      model: MODEL,
    });

    return { finalContent, steps };
  } catch (err) {
    app.log.error({ err }, 'Agent loop failed');
    return reply.code(500).send({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
