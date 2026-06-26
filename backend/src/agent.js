/**
 * OpenAI Function Calling 标准工具定义 + Agent 循环
 */

// ============================================================
// 工具定义 — 遵循 OpenAI Function Calling 规范
// ============================================================
export const tools = [
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: '获取当前日期和时间，返回 ISO 格式时间和时区信息',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: '执行数学计算，支持加减乘除、括号和取余',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '数学表达式，例如 "2 + 3 * 4"、"(10 - 5) / 2"、"100 % 7"',
          },
        },
        required: ['expression'],
      },
    },
  },
];

// ============================================================
// 工具执行器
// ============================================================
export const toolExecutors = {
  get_current_time: () => ({
    time: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }),

  calculate: ({ expression }) => {
    // 安全校验：只允许数字和基本运算符
    if (!/^[\d\s\+\-\*\/\(\)\.\%]+$/.test(expression)) {
      throw new Error('表达式包含不允许的字符，只允许数字和 +, -, *, /, %, 括号');
    }
    const result = new Function('return ' + expression)();
    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('表达式未得到有效数字结果');
    }
    return { expression, result };
  },
};

// ============================================================
// runAgent — 最多执行 3 轮工具调用的 Agent 循环
// ============================================================
export async function runAgent({ messages, apiKey, baseURL, model }) {
  const steps = [];
  const conversation = [...messages];
  const MAX_ROUNDS = 3;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    // 请求 LLM，带上 tools 定义
    const response = await fetch(`${baseURL}chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: conversation,
        tools,
        tool_choice: 'auto',
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`LLM API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const assistantMsg = data.choices[0].message;

    // 记录本轮 assistant 思考
    steps.push({
      type: 'assistant_thinking',
      round,
      content: assistantMsg.content,
      tool_calls: assistantMsg.tool_calls || [],
    });

    // 没有工具调用 → 返回最终文本
    if (!assistantMsg.tool_calls?.length) {
      return { finalContent: assistantMsg.content, steps };
    }

    // 将 assistant 消息（含 tool_calls）加入对话
    conversation.push(assistantMsg);

    // 逐个执行工具调用，将结果追加到对话
    for (const tc of assistantMsg.tool_calls) {
      const fnName = tc.function.name;
      let args;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      let result;
      try {
        result = toolExecutors[fnName](args);
      } catch (err) {
        result = { error: err.message };
      }

      steps.push({
        type: 'tool_result',
        round,
        tool_call_id: tc.id,
        name: fnName,
        arguments: args,
        result,
      });

      conversation.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  // 达到最大轮次，不带 tools 再请求一次获取最终回答
  const finalResp = await fetch(`${baseURL}chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages: conversation }),
  });

  const finalData = await finalResp.json();
  const finalContent = finalData.choices[0].message.content;
  steps.push({ type: 'final', round: MAX_ROUNDS + 1, content: finalContent });

  return { finalContent, steps };
}
