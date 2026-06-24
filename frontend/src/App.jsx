import { useState, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import './App.css';

export default function App() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/chat',
  });

  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="app">
      <header className="header">
        <h1>AI Chat MVP</h1>
        <p>DeepSeek API + React + Fastify</p>
      </header>

      <main className="chat-container" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <p>Ask me anything...</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="avatar">{msg.role === 'user' ? 'You' : 'AI'}</div>
            <div className="content">{msg.content}</div>
          </div>
        ))}
        {isLoading && (
          <div className="message assistant">
            <div className="avatar">AI</div>
            <div className="content typing">Thinking...</div>
          </div>
        )}
      </main>

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
