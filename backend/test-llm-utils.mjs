/**
 * 测试 callWithRetry 和 compressConversation
 * 运行: node test-llm-utils.mjs
 */
import { callWithRetry, compressConversation } from './src/llm-utils.js';

// ============================================================
// 测试 callWithRetry
// ============================================================

async function testRetry() {
  console.log('=== 测试 callWithRetry ===\n');

  // 测试 1：成功调用（无重试）
  console.log('--- 测试 1: 成功调用 ---');
  let callCount = 0;
  const result = await callWithRetry(async () => {
    callCount++;
    return 'ok';
  });
  console.log(`  结果: ${result}, 调用次数: ${callCount} (期望 1)\n`);

  // 测试 2：前 2 次失败，第 3 次成功
  console.log('--- 测试 2: 前2次失败，第3次成功 ---');
  callCount = 0;
  const result2 = await callWithRetry(
    async () => {
      callCount++;
      if (callCount < 3) throw new Error('LLM API error 503: overloaded');
      return 'success';
    },
    { baseDelay: 100 },
  );
  console.log(`  结果: ${result2}, 调用次数: ${callCount} (期望 3)\n`);

  // 测试 3：超过最大重试次数，抛出错误
  console.log('--- 测试 3: 超过最大重试次数 ---');
  callCount = 0;
  try {
    await callWithRetry(
      async () => {
        callCount++;
        throw new Error('LLM API error 429: rate limited');
      },
      { maxRetries: 2, baseDelay: 50 },
    );
  } catch (err) {
    console.log(`  抛出错误: ${err.message}, 调用次数: ${callCount} (期望 3)\n`);
  }

  // 测试 4：不可重试的错误，直接抛出
  console.log('--- 测试 4: 不可重试的错误 ---');
  callCount = 0;
  try {
    await callWithRetry(
      async () => {
        callCount++;
        throw new Error('LLM API error 400: bad request');
      },
      { baseDelay: 50 },
    );
  } catch (err) {
    console.log(`  抛出错误: ${err.message}, 调用次数: ${callCount} (期望 1)\n`);
  }

  console.log('=== callWithRetry 测试完成 ===\n');
}

// ============================================================
// 测试 compressConversation
// ============================================================

async function testCompression() {
  console.log('=== 测试 compressConversation ===\n');

  // 模拟 LLM 调用：返回固定摘要
  let summaryInput = '';
  const mockLlmCaller = async (msgs) => {
    // 提取 user 消息的内容作为输入（方便验证）
    summaryInput = msgs.find((m) => m.role === 'user')?.content || '';
    return { content: '用户询问了技术问题，助手给出了详细解答。' };
  };

  // 测试 1：消息较少，不触发压缩
  console.log('--- 测试 1: 消息少于阈值，不压缩 ---');
  const shortMsgs = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好！' },
  ];
  const r1 = await compressConversation(shortMsgs, { llmCaller: mockLlmCaller });
  console.log(`  输入 ${shortMsgs.length} 条, 输出 ${r1.length} 条, 被压缩: ${r1.length < shortMsgs.length}\n`);

  // 测试 2：消息很多，触发压缩
  console.log('--- 测试 2: 消息超过阈值，触发压缩 ---');
  const longMsgs = [
    { role: 'system', content: 'You are a helpful assistant.' },
  ];
  // 生成足够多的消息让 token 超过 4000
  for (let i = 0; i < 30; i++) {
    longMsgs.push({
      role: 'user',
      content: `这是第 ${i + 1} 条用户消息，内容比较长以确保总 token 数超过阈值。我们需要一些额外的文本让这个消息足够大。`.repeat(10),
    });
    longMsgs.push({
      role: 'assistant',
      content: `这是第 ${i + 1} 条助手回复，同样需要一些长度来确保 token 计数准确。这是一个测试用的长回复。`.repeat(10),
    });
  }

  console.log(`  输入 ${longMsgs.length} 条消息`);
  const r2 = await compressConversation(longMsgs, {
    maxTokens: 4000,
    keepRecent: 4,
    llmCaller: mockLlmCaller,
  });
  console.log(`  输出 ${r2.length} 条消息`);
  console.log(`  压缩结果: ${r2.length} 条 (期望: 1 system + 1 summary + 4 recent = 6)`);
  console.log(`  摘要输入前 100 字符: ${summaryInput.slice(0, 100)}...`);

  // 验证结构
  const roles = r2.map((m) => m.role);
  console.log(`  消息角色: [${roles.join(', ')}]\n`);

  // 测试 3：无 system 消息时的压缩
  console.log('--- 测试 3: 无 system 消息 ---');
  const noSystemMsgs = [];
  for (let i = 0; i < 30; i++) {
    noSystemMsgs.push({ role: 'user', content: `这是第${i + 1}个问题，需要足够长的内容来触发压缩机制。`.repeat(1000) });
    noSystemMsgs.push({ role: 'assistant', content: `这是第${i + 1}个回答，同样需要足够长的内容来确保超过阈值。`.repeat(1000) });
  }
  const r3 = await compressConversation(noSystemMsgs, {
    maxTokens: 4000,
    keepRecent: 4,
    llmCaller: mockLlmCaller,
  });
  console.log(`  输入 ${noSystemMsgs.length} 条, 输出 ${r3.length} 条`);
  console.log(`  角色: [${r3.map((m) => m.role).join(', ')}]\n`);

  console.log('=== compressConversation 测试完成 ===');
}

// ============================================================
// 运行所有测试
// ============================================================
await testRetry();
await testCompression();
console.log('\n全部测试完成!');
