import React, { useEffect, useMemo, useState } from 'react';
import '../../styles/carrier/Messaging.css';
import { getJson, openEventSource, postJson } from '../../api/http';
import { AUTO_REFRESH_MS } from '../../constants/refresh';

function initials(value) {
  const s = String(value || '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase()).join('') || '?';
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Messaging({ initialThreadId = null } = {}) {
  const [threads, setThreads] = useState([]);
  const [selectedThread, setSelectedThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [unreadSummary, setUnreadSummary] = useState({ total_unread: 0, threads: {}, channels: {} });
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState('');
  const streamRef = React.useRef(null);
  const didInitSelectRef = React.useRef(false);

  const [showChatMobile, setShowChatMobile] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 900);
  React.useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 900);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  async function refreshThreads() {
    const data = await getJson('/messaging/threads');
    // list_threads already filters by membership; shipper will only see shipper_carrier_direct
    setThreads(data.threads || []);
  }

  async function refreshCarriers() {
    const data = await getJson('/messaging/shipper/carriers');
    setCarriers(data.carriers || []);
  }

  async function refreshUnread() {
    const data = await getJson('/messaging/unread/summary');
    setUnreadSummary(data || { total_unread: 0, threads: {}, channels: {} });
    try {
      const total = Number(data?.total_unread || 0);
      window.dispatchEvent(new CustomEvent('messaging:unread', { detail: { total_unread: total } }));
    } catch {
      // ignore
    }
  }

  async function selectThread(thread) {
    if (streamRef.current) {
      try { streamRef.current.close(); } catch { /* ignore */ }
      streamRef.current = null;
    }
    setSelectedThread(thread);
    setThreadLoading(true);
    setMessages([]);
    let data;
    try {
      data = await getJson(`/messaging/threads/${thread.id}/messages?limit=100`);
      setMessages(data.messages || []);
    } finally {
      setThreadLoading(false);
    }

    try {
      await postJson(`/messaging/threads/${thread.id}/read`, {});
      refreshUnread().catch(() => {});
    } catch {
      // ignore
    }

    try {
      const lastTs = (data.messages || []).length ? (data.messages[data.messages.length - 1].created_at || 0) : 0;
      const es = await openEventSource(`/messaging/threads/${thread.id}/stream`, { since: lastTs });
      streamRef.current = es;
      es.onmessage = (evt) => {
        try {
          const payload = JSON.parse(evt.data);
          if (payload?.type === 'message' && payload?.message) {
            setMessages((prev) => {
              const next = [...(prev || [])];
              if (!next.find(m => m.id === payload.message.id)) next.push(payload.message);
              return next;
            });
            refreshThreads().catch(() => {});
            postJson(`/messaging/threads/${thread.id}/read`, {}).then(() => refreshUnread().catch(() => {})).catch(() => {});
          }
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore; fallback to manual refresh
    }
  }

  const filteredThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (threads || []).filter(t => {
      const title = String(t.display_title || t.other_display_name || t.title || '').toLowerCase();
      const last = String(t.last_message?.text || '').toLowerCase();
      return !q || title.includes(q) || last.includes(q);
    });
  }, [threads, search]);

  const availableNewCarriers = useMemo(() => {
    const existing = new Set();
    (threads || []).forEach(t => {
      if (t.kind === 'shipper_carrier_direct') {
        const id = t.carrier_id || null;
        if (id) existing.add(id);
      }
    });
    return (carriers || []).filter(c => !existing.has(c.id));
  }, [threads, carriers]);

  React.useEffect(() => {
    if (!newChatOpen) return;
    const onDocClick = () => setNewChatOpen(false);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [newChatOpen]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');
        // Fast initial render: list first.
        const results = await Promise.allSettled([refreshThreads(), refreshCarriers()]);
        const firstErr = results.find(r => r.status === 'rejected')?.reason;
        if (firstErr && !cancelled) setError(firstErr?.message || 'Failed to load messaging');
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load messaging');
      } finally {
        if (!cancelled) setLoading(false);
      }

      // Non-blocking background unread fetch
      refreshUnread().catch(() => {});
    })();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        try { streamRef.current.close(); } catch { /* ignore */ }
        streamRef.current = null;
      }
    };
  }, []);

  // Deep-link support: auto-open a specific thread when navigating from an email.
  useEffect(() => {
    if (didInitSelectRef.current) return;
    const tid = String(initialThreadId || '').trim();
    if (!tid) return;
    if (selectedThread) {
      didInitSelectRef.current = true;
      return;
    }
    const match = (threads || []).find(t => t?.id === tid);
    if (match) {
      didInitSelectRef.current = true;
      setShowChatMobile(true);
      selectThread(match);
    }
  }, [initialThreadId, threads, selectedThread]);

  const handleSend = async () => {
    if (!message.trim() || !selectedThread) return;
    if (selectedThread.is_read_only) return;
    const text = message.trim();
    setMessage('');
    await postJson(`/messaging/threads/${selectedThread.id}/messages`, { text });
    postJson(`/messaging/threads/${selectedThread.id}/read`, {}).catch(() => {});
    await refreshThreads();
    refreshUnread().catch(() => {});
    await selectThread({ ...selectedThread });
  };

  // Lightweight unread refresh (keeps badges current if SSE is disconnected)
  useEffect(() => {
    let alive = true;
    const id = setInterval(() => {
      if (!alive) return;
      refreshUnread().catch(() => {});
    }, AUTO_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const handleSelectChat = (thread) => {
    selectThread(thread);
    if (window.innerWidth <= 640) setShowChatMobile(true);
  };

  const handleBack = () => setShowChatMobile(false);

  return (
    <>
      <header className="messaging-header">
        <div className="header-content">
          <h1>Messaging</h1>
          <p className="header-subtitle">Chat with your carriers</p>
        </div>
      </header>

      <div className="messaging-root">
        {(!isMobile || !showChatMobile) && (
          <aside className="sidebar">
            <div className="sidebar-header">
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <button
                    className="chat-filter-btn"
                    style={{ padding: '6px 10px', borderRadius: 8, width: '100%', textAlign: 'left' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewChatOpen((s) => !s);
                    }}
                    title="Start new chat"
                  >
                    + New chat
                  </button>

                  {newChatOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        left: 0,
                        right: 0,
                        background: 'white',
                        border: '1px solid rgba(0,0,0,0.12)',
                        borderRadius: 10,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                        zIndex: 20,
                        overflow: 'hidden',
                        maxHeight: 300,
                        overflowY: 'auto'
                      }}
                    >
                      <div style={{ padding: '10px 12px', fontWeight: 700, fontSize: 13, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                        Available carriers
                      </div>
                      {availableNewCarriers.length === 0 ? (
                        <div style={{ padding: 12, opacity: 0.75, fontSize: 13 }}>
                          No carriers without chats.
                        </div>
                      ) : (
                        availableNewCarriers.map((c) => (
                          <button
                            key={c.id}
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '10px 12px',
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                              textAlign: 'left'
                            }}
                            onClick={async () => {
                              try {
                                setError('');
                                setNewChatOpen(false);
                                const res = await postJson('/messaging/shipper/threads/direct', { carrier_id: c.id });
                                await refreshThreads();
                                await selectThread(res.thread);
                                if (window.innerWidth <= 640) setShowChatMobile(true);
                              } catch (err) {
                                setError(err?.message || 'Failed to start chat');
                              }
                            }}
                          >
                            {c.profile_picture_url ? (
                              <img src={c.profile_picture_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                            ) : (
                              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                                {initials(c.name || c.email || c.id)}
                              </div>
                            )}
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <div style={{ fontSize: 13, fontWeight: 700 }}>{c.name || c.email || c.id}</div>
                              {c.company_name && <div style={{ fontSize: 12, opacity: 0.75 }}>{c.company_name}</div>}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <button
                  className="chat-filter-btn"
                  onClick={async () => {
                    try {
                      setError('');
                      setLoading(true);
                      await Promise.all([refreshThreads(), refreshCarriers()]);
                    } catch (e) {
                      setError(e?.message || 'Refresh failed');
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  Refresh
                </button>
              </div>

              <div className="sidebar-search">
                <i className="fa-solid fa-search"></i>
                <input
                  type="text"
                  placeholder="Search conversations..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="chats-list">
              {error && <div style={{ padding: 12, color: '#b91c1c' }}>{error}</div>}
              {loading && <div style={{ padding: 12, opacity: 0.8 }}>Loading…</div>}
              {!loading && filteredThreads.length === 0 && (
                <div style={{ padding: 12, opacity: 0.8 }}>No conversations yet.</div>
              )}

              {filteredThreads.map(t => (
                <div
                  key={t.id}
                  className={`chat-item${selectedThread && selectedThread.id === t.id ? ' active' : ''}`}
                  onClick={() => handleSelectChat(t)}
                >
                  <div className="chat-avatar">
                    {t.other_photo_url ? (
                      <img
                        src={t.other_photo_url}
                        alt="avatar"
                        style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : (
                      initials(t.display_title || t.other_display_name || t.title)
                    )}
                  </div>
                  <div className="chat-info">
                    <div className="chat-title">{t.display_title || t.other_display_name || t.title || 'Conversation'}</div>
                    <div className="chat-last">{t.last_message?.text || ''}</div>
                  </div>
                  <div className="chat-meta">
                    <span className="chat-time">{fmtTime(t.last_message_at)}</span>
                    {unreadSummary?.threads?.[t.id]?.has_unread && (!selectedThread || selectedThread.id !== t.id) && (
                      <span className="chat-unread">●</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}

        {((!isMobile && selectedThread) || (isMobile && showChatMobile && selectedThread)) && (
          <main className="main-chat">
            <div className="chat-header">
              {isMobile && (
                <button className="back-btn" onClick={handleBack} style={{ marginRight: 12, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>
                  <i className="fa-solid fa-arrow-left"></i>
                </button>
              )}
              <div className="header-info">
                <div className="header-avatar">
                  {selectedThread.other_photo_url ? (
                    <img
                      src={selectedThread.other_photo_url}
                      alt="avatar"
                      style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : (
                    initials(selectedThread.display_title || selectedThread.other_display_name || selectedThread.title)
                  )}
                </div>
                <div>
                  <div className="header-title">{selectedThread.display_title || selectedThread.other_display_name || selectedThread.title || 'Conversation'}</div>
                </div>
              </div>
              <div className="header-actions">
                <i className="fa-solid fa-ellipsis-v"></i>
              </div>
            </div>

            <div className="messages-area">
              {threadLoading && (
                <div style={{ padding: 16, opacity: 0.85, fontWeight: 700, color: '#64748b' }}>
                  Loading conversation…
                </div>
              )}
              {!threadLoading && messages.length === 0 && (
                <div style={{ padding: 16, opacity: 0.8 }}>
                  No messages yet.
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`message-row${m.sender_role === 'shipper' ? ' sent' : ''}`}>
                  <div className="message-bubble">{m.text}</div>
                  <div className="message-meta">{fmtTime(m.created_at)}</div>
                </div>
              ))}
            </div>

            {selectedThread.is_read_only ? (
              <div className="message-input-area" style={{ justifyContent: 'center', opacity: 0.85 }}>
                <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.9 }}>
                  Chat ended for this load (read-only).
                </div>
              </div>
            ) : (
              <div className="message-input-area">
                <input
                  className="message-input"
                  type="text"
                  placeholder="Type your message..."
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                />
                <button className="send-btn" onClick={handleSend}>
                  <i className="fa-solid fa-paper-plane"></i>
                </button>
              </div>
            )}
          </main>
        )}

        {!isMobile && !selectedThread && !loading && (
          <main className="main-chat">
            <div className="messages-area">
              <div style={{ padding: 18, opacity: 0.85, fontWeight: 700, color: '#64748b' }}>
                Select a conversation to start.
              </div>
            </div>
          </main>
        )}
      </div>
    </>
  );
}
