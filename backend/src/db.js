// SQLite 数据库层 — 存储文档切片及其 embedding 向量
// 使用 sql.js (WASM 版 SQLite), 无需 native 编译
// 向量检索采用内存中遍历 + 余弦相似度计算 (适合 MVP 规模)

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../data/chat.db');

let db;

/**
 * 初始化 SQLite 数据库
 * - 若 data/chat.db 已存在则加载, 否则创建新库
 * - 建表: documents (文档元信息) + chunks (文本片段 + embedding BLOB)
 * - 建索引: chunks.doc_id 加速 JOIN 查询
 */
export async function initDB() {
  const SQL = await initSqlJs();

  if (existsSync(DB_PATH)) {
    const buf = readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  // 文档表: 记录上传的文件名和时间
  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 切片表: 存储文本片段和对应的 embedding 向量 (以 BLOB 存储 Float32)
  db.run(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id)');

  saveDB();
  return db;
}

/** 将内存中的 SQLite 数据库持久化到磁盘 */
export function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(DB_PATH, buffer);
}

/** 插入一条文档记录, 返回自增 ID */
export function insertDocument(filename) {
  db.run('INSERT INTO documents (filename) VALUES (?)', [filename]);
  const result = db.exec('SELECT last_insert_rowid() as id');
  return result[0].values[0][0];
}

/**
 * 按文件名删除文档及其所有切片
 * 上传同名文件时先删旧数据再插入新数据, 避免重复
 */
export function deleteDocumentsByFilename(filename) {
  db.run(
    'DELETE FROM chunks WHERE doc_id IN (SELECT id FROM documents WHERE filename = ?)',
    [filename]
  );
  db.run('DELETE FROM documents WHERE filename = ?', [filename]);
  saveDB();
}

/**
 * 批量插入切片 — 将文本和对应的 embedding 一起写入 chunks 表
 * embedding 以 Float32Array → Buffer 的方式序列化为 BLOB
 */
export function insertChunks(docId, chunks, embeddings) {
  const stmt = db.prepare('INSERT INTO chunks (doc_id, content, embedding) VALUES (?, ?, ?)');
  for (let i = 0; i < chunks.length; i++) {
    const blob = Buffer.from(new Float32Array(embeddings[i]).buffer);
    stmt.run([docId, chunks[i], blob]);
  }
  stmt.free();
  saveDB();
}

/**
 * 余弦相似度 — 衡量两个向量的方向一致性
 * 返回值范围 [-1, 1], 越接近 1 表示越相似
 */
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 向量检索 — 遍历所有切片, 计算与 queryEmbedding 的余弦相似度
 * 返回 topK 个最相似的结果 (去重后)
 *
 * 注意: 全表扫描适合 MVP 规模 (万级 chunk)
 * 生产环境应使用 HNSW/IVF 等近似最近邻索引
 */
export function searchSimilar(queryEmbedding, topK = 3) {
  const rows = db.exec(`
    SELECT c.id, c.content, c.embedding, c.doc_id, d.filename
    FROM chunks c
    JOIN documents d ON c.doc_id = d.id
  `);

  if (!rows.length) return [];

  // 遍历每一行, 将 BLOB 反序列化为 Float32 数组后计算相似度
  const results = [];
  for (const row of rows[0].values) {
    const [id, content, embeddingBlob, docId, filename] = row;
    const embArray = Array.from(new Float32Array(
      embeddingBlob.buffer.slice(embeddingBlob.byteOffset, embeddingBlob.byteOffset + embeddingBlob.byteLength)
    ));
    const score = cosineSimilarity(queryEmbedding, embArray);
    results.push({ id, content, docId, filename, score });
  }

  // 按相似度降序排列
  results.sort((a, b) => b.score - a.score);

  // 去重: 相同内容只保留一条 (避免重复切片干扰结果)
  const seen = new Set();
  const deduped = [];
  for (const r of results) {
    if (seen.has(r.content)) continue;
    seen.add(r.content);
    deduped.push(r);
  }

  return deduped.slice(0, topK);
}
