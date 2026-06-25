import { useState } from 'react';

/**
 * SourceCard — 展示 RAG 检索到的来源片段
 * props:
 *   sources: Array<{ id, filename, content, score }>
 *     - id:       切片 ID
 *     - filename: 来源文件名
 *     - content:  切片原文内容
 *     - score:    与查询的余弦相似度 (0~1)
 */
export default function SourceCard({ sources }) {
  const [expanded, setExpanded] = useState(false);

  if (!sources || sources.length === 0) return null;

  return (
    <div className="sources-section">
      {/* 折叠按钮 — 点击展开/收起来源列表 */}
      <button
        className="sources-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? 'Hide' : 'Show'} Sources ({sources.length})
      </button>

      {/* 展开后显示每个来源卡片 */}
      {expanded && (
        <div className="sources-list">
          {sources.map((source, i) => (
            <div key={source.id || i} className="source-card">
              <div className="source-header">
                <span className="source-filename">{source.filename}</span>
                <span className="source-score">
                  {Math.round(source.score * 100)}% match
                </span>
              </div>
              <div className="source-content">{source.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
