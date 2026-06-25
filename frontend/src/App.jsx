import { useState, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import SourceCard from './SourceCard';
import './App.css';

export default function App() {
  // useChat: Vercel AI SDK 的 React hook, 封装了消息状态、流式输入、自动滚动等
  // api 指向后端 /api/chat 端点
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/chat',
  });

  const [uploading, setUploading] = useState(false);   // 文件上传中状态
  const [uploadMsg, setUploadMsg] = useState('');       // 上传结果提示 (成功/失败)
  const [showUpload, setShowUpload] = useState(false);  // 展开/收起上传区域
  const fileInputRef = useRef(null);                    // 隐藏的 file input 引用
  const scrollRef = useRef(null);                       // 聊天容器滚动引用

  // 消息更新时自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  /**
   * 从 assistant 消息的 annotations 中提取 sources
   * annotations 是 Vercel AI SDK StreamData 机制附带的结构化数据
   */
  const getSources = (msg) => {
    const ann = msg.annotations?.find((a) => a?.type === 'sources');
    return ann?.sources;
  };

  /**
   * 文件上传处理 — 选择 .txt 文件后 POST 到 /api/upload
   * 上传成功后显示切片数量, 失败显示错误信息
   */
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

      if (!res.ok) {
        setUploadMsg(`Error: ${data.error}`);
      } else {
        setUploadMsg(`Uploaded "${data.filename}" — ${data.chunks} chunks stored`);
      }
    } catch (err) {
      setUploadMsg('Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="app">
      {/* 顶部标题栏 + 上传按钮 */}
      <header className="header">
        <div className="header-top">
          <h1>AI Chat MVP</h1>
          <button
            className="upload-btn"
            onClick={() => setShowUpload(!showUpload)}
            title="Upload document"
          >
            +
          </button>
        </div>
        {/* 上传区域 — 点击 + 展开 */}
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

      {/* 聊天消息列表 */}
      <main className="chat-container" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <p>Ask me anything...</p>
            <p className="empty-hint">Upload a .txt file first to use RAG</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="avatar">{msg.role === 'user' ? 'You' : 'AI'}</div>
            <div className="message-body">
              <div className="content">{msg.content}</div>
              {/* assistant 消息下方展示检索到的来源片段 */}
              {msg.role === 'assistant' && getSources(msg) && (
                <SourceCard sources={getSources(msg)} />
              )}
            </div>
          </div>
        ))}
        {/* 加载中的占位动画 */}
        {isLoading && (
          <div className="message assistant">
            <div className="avatar">AI</div>
            <div className="content typing">Thinking...</div>
          </div>
        )}
      </main>

      {/* 底部输入框 */}
      <form className="input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="Type a message..."
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
