/**
 * 集成测试：真实调用 LLM API，验证重试和压缩
 * 运行前确保 .env 中配置了 DEEPSEEK_API_KEY 和 DEEPSEEK_BASE_URL
 */
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { callWithRetry, compressConversation } from './src/llm-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const API_KEY = process.env.DEEPSEEK_API_KEY;
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'http://model.mify.ai.srv/v1/';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

if (!API_KEY) {
  console.error('请在 .env 中配置 DEEPSEEK_API_KEY');
  process.exit(1);
}

// 真实 LLM 调用
async function callLLM(messages) {
  const resp = await fetch(`${BASE_URL}chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages }),
  });
  if (!resp.ok) throw new Error(`LLM API error ${resp.status}`);
  const data = await resp.json();
  return { content: data.choices[0].message.content };
}

async function testRealRetry() {
  console.log('=== 集成测试: callWithRetry (正常调用) ===\n');
  const result = await callWithRetry(async () => {
    return await callLLM([{ role: 'user', content: '回答一个字: 好' }]);
  }, { baseDelay: 1000 });
  console.log(`  LLM 回复: "${result.content}"\n`);
}

async function testRealRetryFailure() {
  console.log('=== 集成测试: callWithRetry (失败重试) ===\n');

  // 测试 1：错误的 Base URL → 网络错误 → 触发重试
  console.log('--- 测试 1: 错误 URL，验证重试行为 ---');
  let callCount = 0;
  const badUrl = 'http://127.0.0.1:19999/v1/'; // 一个不可能存在的端口
  try {
    await callWithRetry(
      async () => {
        callCount++;
        const resp = await fetch(`${badUrl}chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
          },
          body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'hi' }] }),
        });
        if (!resp.ok) throw new Error(`LLM API error ${resp.status}`);
        return resp.json();
      },
      { maxRetries: 2, baseDelay: 100 },
    );
  } catch (err) {
    console.log(`  错误类型: ${err.constructor.name}`);
    console.log(`  错误信息: ${err.message}`);
    console.log(`  调用次数: ${callCount} (期望 3: 1 首次 + 2 重试)\n`);
  }

  // 测试 2：错误的 API Key → 401 → 不可重试，直接失败
  console.log('--- 测试 2: 错误 API Key，验证不重试 ---');
  callCount = 0;
  try {
    await callWithRetry(
      async () => {
        callCount++;
        const resp = await fetch(`${BASE_URL}chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer sk-fake-key-12345',
          },
          body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'hi' }] }),
        });
        if (!resp.ok) throw new Error(`LLM API error ${resp.status}`);
        return resp.json();
      },
      { baseDelay: 100 },
    );
  } catch (err) {
    console.log(`  错误类型: ${err.constructor.name}`);
    console.log(`  错误信息: ${err.message}`);
    console.log(`  调用次数: ${callCount} (期望 1: 401 不重试)\n`);
  }
}

async function testRealCompression() {
  console.log('=== 集成测试: compressConversation ===\n');

  // 构造一段较长的对话历史
  const messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
  ];
  for (let i = 0; i < 20; i++) {
    messages.push({
      role: 'user',
      content: `第${i + 1}轮：请解释什么是${['递归', '闭包', '事件循环', '虚拟DOM', '微服务'][i % 5]}，并给出实际应用场景和代码示例。`.repeat(20),
    });
    messages.push({
      role: 'assistant',
      content: `第${i + 1}轮回答：这是一个很好的问题。`.repeat(20),
    });
  }

  console.log(`  压缩前: ${messages.length} 条消息`);

  const compressed = await compressConversation(messages, {
    maxTokens: 4000,
    keepRecent: 4,
    llmCaller: async (msgs) => {
      console.log('  [LLM] 正在生成摘要...');
      return await callLLM(msgs);
    },
  });

  console.log(`  压缩后: ${compressed.length} 条消息`);
  console.log(`  消息角色: [${compressed.map((m) => m.role).join(', ')}]\n`);

  // 显示摘要内容
  const summaryMsg = compressed.find((m) => m.content?.startsWith('[对话历史摘要]'));
  if (summaryMsg) {
    console.log(`  摘要内容: ${summaryMsg.content}\n`);
  }
}

await testRealRetry();
await testRealRetryFailure();
await testRealCompression();
console.log('集成测试完成!');
