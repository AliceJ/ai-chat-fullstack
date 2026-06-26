import { useState, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import SourceCard from './SourceCard';
import './App.css';

export default function App() {
  // ---- Chat mode (RAG) ----
  const {
    messages: chatMessages,
    input: chatInput,
    handleInputChange: chatHandleInputChange,
    handleSubmit: chatHandleSubmit,
    isLoading: chatLoading,
  } = useChat({ api: '/api/chat' });

  // ---- Agent mode ----
  const [isAgentMode, setIsAgentMode] = useState(false);
  const [agentInput, setAgentInput] = useState('');
  const [agentMessages, setAgentMessages] = useState([]);   // 对话历史 (发给 API)
  const [agentDisplay, setAgentDisplay] = useState([]);      // UI 展示事件
  const [agentLoading, setAgentLoading] = useState(false);

  // ---- 共用 ----
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages, agentDisplay]);

  const getSources = (msg) => {
    const ann = msg.annotations?.find((a) => a?.type === 'sources');
    return ann?.sources;
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg('');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) setUploadMsg(`Error: ${data.error}`);
      else setUploadMsg(`Uploaded "${data.filename}" — ${data.chunks} chunks stored`);
    } catch {
      setUploadMsg('Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ---- Agent 提交 ----
  const handleAgentSubmit = async (e) => {
    e.preventDefault();
    const userMsg = agentInput.trim();
    if (!userMsg || agentLoading) return;

    setAgentInput('');

    // 追加用户消息到对话历史和展示列表
    const newConversation = [...agentMessages, { role: 'user', content: userMsg }];
    setAgentMessages(newConversation);
    setAgentDisplay((prev) => [...prev, { type: 'user', content: userMsg }]);
    setAgentLoading(true);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newConversation }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Agent request failed');

      // 将 steps 转换为展示事件
      const newEvents = [];
      for (const step of data.steps) {
        if (step.type === 'assistant_thinking') {
          if (step.tool_calls.length > 0) {
            // 有工具调用 → 显示为思考卡片
            newEvents.push({
              type: 'assistant_thinking',
              round: step.round,
              content: step.content,
            });
          } else {
            // 无工具调用 → 这就是最终回答
            newEvents.push({ type: 'final', content: step.content });
          }
        } else if (step.type === 'tool_result') {
          newEvents.push({
            type: 'tool_call',
            round: step.round,
            name: step.name,
            arguments: step.arguments,
            result: step.result,
          });
        } else if (step.type === 'final') {
          newEvents.push({ type: 'final', content: step.content });
        }
      }

      setAgentDisplay((prev) => [...prev, ...newEvents]);

      // 将最终回答加入对话历史，用于下一轮上下文
      setAgentMessages((prev) => [...prev, { role: 'assistant', content: data.finalContent }]);
    } catch (err) {
      setAgentDisplay((prev) => [...prev, { type: 'error', content: err.message }]);
    } finally {
      setAgentLoading(false);
    }
  };

  const isLoading = isAgentMode ? agentLoading : chatLoading;

  return (
    <div className="app">
      {/* 顶部标题栏 */}
      <header className="header">
        <div className="header-top">
          <h1>AI Chat MVP</h1>
          <div className="header-actions">
            <button
              className={`mode-toggle ${isAgentMode ? 'agent' : 'chat'}`}
              onClick={() => setIsAgentMode(!isAgentMode)}
            >
              {isAgentMode ? 'Agent' : 'Chat'}
            </button>
            <button
              className="upload-btn"
              onClick={() => setShowUpload(!showUpload)}
              title="Upload document"
            >
              +
            </button>
          </div>
        </div>
        {showUpload && (
          <div className="upload-area">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              onChange={handleUpload}
              hidden
            />
            <button
              className="upload-file-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? 'Uploading...' : 'Choose .txt file'}
            </button>
            {uploadMsg && (
              <span className={`upload-msg ${uploadMsg.startsWith('Error') ? 'error' : 'success'}`}>
                {uploadMsg}
              </span>
            )}
          </div>
        )}
      </header>

      {/* 消息列表 */}
      <main className="chat-container" ref={scrollRef}>
        {/* 空状态提示 */}
        {!isAgentMode && chatMessages.length === 0 && (
          <div className="empty-state">
            <p>Ask me anything...</p>
            <p className="empty-hint">Upload a .txt file first to use RAG</p>
          </div>
        )}
        {isAgentMode && agentDisplay.length === 0 && (
          <div className="empty-state">
            <p>Agent Mode</p>
            <p className="empty-hint">I can use tools: get_current_time, calculate</p>
          </div>
        )}

        {/* ---- Chat 模式消息 ---- */}
        {!isAgentMode &&
          chatMessages.map((msg) => (
            <div key={msg.id} className={`message ${msg.role}`}>
              <div className="avatar">{msg.role === 'user' ? 'You' : 'AI'}</div>
              <div className="message-body">
                <div className="content">{msg.content}</div>
                {msg.role === 'assistant' && getSources(msg) && (
                  <SourceCard sources={getSources(msg)} />
                )}
              </div>
            </div>
          ))}

        {/* ---- Agent 模式事件 ---- */}
        {isAgentMode &&
          agentDisplay.map((event, i) => {
            // 用户消息
            if (event.type === 'user') {
              return (
                <div key={i} className="message user">
                  <div className="avatar">You</div>
                  <div className="content">{event.content}</div>
                </div>
              );
            }

            // 最终回答
            if (event.type === 'final') {
              return (
                <div key={i} className="message assistant">
                  <div className="avatar">AI</div>
                  <div className="content">{event.content}</div>
                </div>
              );
            }

            // 错误
            if (event.type === 'error') {
              return (
                <div key={i} className="message assistant">
                  <div className="avatar">AI</div>
                  <div className="content error">{event.content}</div>
                </div>
              );
            }

            // Assistant 思考 (有工具调用时)
            if (event.type === 'assistant_thinking') {
              return (
                <div key={i} className="thinking-card">
                  <div className="thinking-header">
                    <span className="thinking-dot" />
                    <span>Round {event.round} — thinking</span>
                  </div>
                  {event.content && (
                    <div className="thinking-content">{event.content}</div>
                  )}
                </div>
              );
            }

            // 工具调用卡片
            if (event.type === 'tool_call') {
              return (
                <div key={i} className="tool-card">
                  <div className="tool-card-header">
                    <span className="tool-icon">&#128295;</span>
                    <span className="tool-name">{event.name}</span>
                    <span className="tool-round">Round {event.round}</span>
                  </div>
                  {Object.keys(event.arguments).length > 0 && (
                    <div className="tool-card-section">
                      <span className="tool-label">Input</span>
                      <pre className="tool-json">{JSON.stringify(event.arguments, null, 2)}</pre>
                    </div>
                  )}
                  <div className="tool-card-section">
                    <span className="tool-label">Output</span>
                    <pre className="tool-json">{JSON.stringify(event.result, null, 2)}</pre>
                  </div>
                </div>
              );
            }

            return null;
          })}

        {/* 加载动画 */}
        {isLoading && (
          <div className="message assistant">
            <div className="avatar">AI</div>
            <div className="content typing">Thinking...</div>
          </div>
        )}
      </main>

      {/* 底部输入框 */}
      <form
        className="input-form"
        onSubmit={isAgentMode ? handleAgentSubmit : chatHandleSubmit}
      >
        <input
          type="text"
          value={isAgentMode ? agentInput : chatInput}
          onChange={isAgentMode ? (e) => setAgentInput(e.target.value) : chatHandleInputChange}
          placeholder={
            isAgentMode
              ? 'Ask agent (e.g. "What time is it?", "Calculate 2+3*4")'
              : 'Type a message...'
          }
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !(isAgentMode ? agentInput : chatInput).trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
