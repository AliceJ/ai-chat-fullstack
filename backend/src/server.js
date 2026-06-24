import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

const openai = createOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || 'http://model.mify.ai.srv/v1/',
});

const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

app.post('/api/chat', async (request, reply) => {
  const { messages } = request.body;

  if (!messages || !Array.isArray(messages)) {
    return reply.code(400).send({ error: 'messages array is required' });
  }

  const result = streamText({
    model: openai(MODEL),
    messages,
  });

  return result.toDataStreamResponse();
  console.log(result.text);
});

app.get('/api/health', async () => ({
  status: 'ok',
  model: MODEL,
}));

const PORT = process.env.PORT || 3001;

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
