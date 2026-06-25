// Embedding 服务 — 调用 Ollama 本地 API 生成文本向量
// 模型: nomic-embed-text (768 维), 需提前 `ollama pull nomic-embed-text`

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';

/**
 * 将单条文本转为向量 (float 数组, 维度 768)
 * 调用 Ollama POST /api/embeddings 接口
 */
export async function embedText(text) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama embedding failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.embedding;
}

/**
 * 批量文本向量化 — 按 batchSize 分组并发请求
 * 用于上传文件时一次性生成所有 chunk 的 embedding
 */
export async function embedBatch(texts, batchSize = 64) {
  const all = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await Promise.all(batch.map((t) => embedText(t)));
    all.push(...embeddings);
  }
  return all;
}
