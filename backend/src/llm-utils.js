/**
 * LLM 调用工具函数：指数退避重试 + 对话压缩
 */

// ============================================================
// callWithRetry — 指数退避重试封装
// ============================================================

/**
 * 包装异步函数，实现指数退避重试
 * @param {Function} fn - 要重试的异步函数
 * @param {Object} options
 * @param {number} options.maxRetries - 最大重试次数，默认 3
 * @param {number} options.baseDelay - 基础延迟(ms)，默认 1000
 * @param {Function} options.shouldRetry - 判断是否应重试的函数，默认对 429/5xx 和网络错误重试
 * @returns {Promise<*>} fn 的返回值
 */
export async function callWithRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    shouldRetry = defaultShouldRetry,
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= maxRetries || !shouldRetry(err)) {
        throw err;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      const jitter = Math.random() * delay * 0.1;
      console.log(
        `[callWithRetry] attempt ${attempt + 1}/${maxRetries} failed: ${err.message}, retrying in ${Math.round(delay + jitter)}ms`,
      );
      await sleep(delay + jitter);
    }
  }

  throw lastError;
}

function defaultShouldRetry(err) {
  // 网络错误（fetch 失败、连接超时等）
  if (err instanceof TypeError && err.message.includes('fetch')) return true;
  // HTTP 状态码错误：429 限流、5xx 服务端错误
  if (err.message && /LLM API error (429|5\d\d)/.test(err.message)) return true;
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// compressConversation — 对话历史压缩
// ============================================================

const TOKEN_CHAR_RATIO = 3.5; // 粗估 1 token ≈ 3.5 字符（中英混合）

function estimateTokens(text) {
  return Math.ceil(text.length / TOKEN_CHAR_RATIO);
}

function estimateMessagesTokens(messages) {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content || ''), 0);
}

/**
 * 当对话总 token 数超过阈值时，调用 LLM 将早期对话总结为 ≤100 字摘要
 * 保留 system message（如有）和最近 N 条消息不动
 *
 * @param {Array} messages - 完整消息列表
 * @param {Object} options
 * @param {number} options.maxTokens - 超过此 token 数触发压缩，默认 4000
 * @param {number} options.keepRecent - 保留最近几条消息不压缩，默认 4
 * @param {Function} options.llmCaller - 调用 LLM 的函数，接收 messages 数组返回 { content: string }
 * @returns {Array} 压缩后的消息列表
 */
export async function compressConversation(messages, options = {}) {
  const { maxTokens = 4000, keepRecent = 4, llmCaller } = options;

  const totalTokens = estimateMessagesTokens(messages);
  if (totalTokens <= maxTokens) {
    return messages;
  }

  if (!llmCaller) {
    throw new Error('compressConversation requires llmCaller function');
  }

  // 分离 system message 和对话消息
  const systemMsgs = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');

  // 保留最近 N 条，压缩前面的
  const recentCount = Math.min(keepRecent, nonSystem.length);
  const recentMsgs = nonSystem.slice(-recentCount);
  const oldMsgs = nonSystem.slice(0, -recentCount);

  if (oldMsgs.length === 0) return messages;

  // 构造摘要请求
  const conversationText = oldMsgs
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const summaryResult = await llmCaller([
    {
      role: 'system',
      content:
        '你是一个对话摘要助手。将以下对话历史总结为 100 字以内的简短摘要，只保留关键信息和上下文。直接输出摘要，不要前缀。',
    },
    { role: 'user', content: conversationText },
  ]);

  const summary = summaryResult.content;

  // 用一条压缩消息替代所有旧消息
  const compressed = [
    ...systemMsgs,
    {
      role: 'system',
      content: `[对话历史摘要] ${summary}`,
    },
    ...recentMsgs,
  ];

  const newTokens = estimateMessagesTokens(compressed);
  console.log(
    `[compressConversation] ${totalTokens} → ${newTokens} tokens (${oldMsgs.length} messages → 1 summary)`,
  );

  return compressed;
}
