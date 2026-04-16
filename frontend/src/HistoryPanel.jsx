import { useState, useEffect, useCallback } from 'react';

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:8000' : '/_/backend';

const EMOTION_EMOJI = {
  angry: '😠', disgust: '🤢', fear: '😨',
  happy: '😄', sad: '😢', surprise: '😲',
  neutral: '😐', contempt: '😒',
};

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function FaceSummaryChip({ face }) {
  const emoji = EMOTION_EMOJI[(face.emotion || '').toLowerCase()] || '😶';
  const genderColor = face.gender?.toLowerCase() === 'female' ? '#f472b6' : '#60a5fa';
  return (
    <div className="history-face-chip" style={{ borderColor: genderColor + '44' }}>
      <span style={{ fontSize: '1rem' }}>{emoji}</span>
      <div>
        <div style={{ color: genderColor, fontWeight: 700, fontSize: '0.75rem' }}>
          {face.gender || '?'} · {face.age != null ? `${face.age}y` : '?'}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.68rem' }}>
          {face.emotion || 'Unknown'}
        </div>
      </div>
    </div>
  );
}

export default function HistoryPanel({ isOpen, onClose, onReplay }) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter,  setFilter]  = useState('all'); // all | image | webcam

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/history`);
      const data = await res.json();
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) fetchHistory();
  }, [isOpen, fetchHistory]);

  const clearHistory = async () => {
    await fetch(`${API_BASE}/history`, { method: 'DELETE' });
    setItems([]);
  };

  const filtered = filter === 'all' ? items : items.filter(i => i.source === filter);

  if (!isOpen) return null;

  return (
    <div className="history-overlay" onClick={onClose}>
      <div className="history-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="history-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="card-icon">📜</div>
            <div>
              <div className="card-title">Analysis History</div>
              <div className="card-subtitle">{items.length} records stored this session</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-ghost btn-sm" id="refresh-history-btn" onClick={fetchHistory}>🔄</button>
            <button className="btn btn-danger btn-sm" id="clear-history-btn" onClick={clearHistory}>🗑 Clear</button>
            <button className="btn btn-ghost btn-sm" id="close-history-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ padding: '8px 20px 0' }}>
          <div className="mode-tabs" style={{ marginBottom: 0 }}>
            {['all','image','webcam'].map(f => (
              <button
                key={f}
                className={`mode-tab ${filter === f ? 'active' : ''}`}
                id={`history-filter-${f}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? '🌐 All' : f === 'image' ? '🖼 Images' : '📷 Webcam'}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="history-content">
          {loading && (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              <div style={{ color: 'var(--cyan)', fontSize: '0.85rem' }}>Loading history…</div>
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <div className="empty-title">No history yet</div>
              <p className="empty-text">Analyze an image or use the webcam to build your history.</p>
            </div>
          )}

          {!loading && filtered.map((item, idx) => (
            <div key={item.id} className="history-item" id={`history-item-${idx}`}>
              {/* Thumbnail */}
              <div className="history-thumb-wrap">
                <img
                  src={`data:image/jpeg;base64,${item.thumbnail}`}
                  alt={`Analysis ${item.id}`}
                  className="history-thumb"
                />
                <div className="history-thumb-badge">
                  {item.source === 'webcam' ? '📷' : '🖼'}
                </div>
              </div>

              {/* Info */}
              <div className="history-item-info">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span className="history-item-id">#{item.id}</span>
                  <span className="history-item-time">{formatTime(item.timestamp)}</span>
                </div>

                <div className="history-item-stats">
                  <span className="hist-stat">👤 {item.face_count} face{item.face_count !== 1 ? 's' : ''}</span>
                  <span className="hist-stat">⚡ {item.processing_time_ms}ms</span>
                  <span className={`hist-stat source-badge ${item.source}`}>{item.source}</span>
                </div>

                <div className="history-faces-row">
                  {item.faces_summary.map((f, i) => (
                    <FaceSummaryChip key={i} face={f} />
                  ))}
                  {item.faces_summary.length === 0 && (
                    <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem' }}>No faces detected</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
