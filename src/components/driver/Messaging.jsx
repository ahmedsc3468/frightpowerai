import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import '../../styles/carrier/Messaging.css';
import { getJson, openEventSource, postJson } from '../../api/http';
import { AUTO_REFRESH_MS } from '../../constants/refresh';
import { useUserSettings } from '../../contexts/UserSettingsContext';
import { t } from '../../i18n/translate';

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
  const { settings } = useUserSettings();
  const language = settings?.language || 'English';
  const tr = (key, fallback) => t(language, key, fallback);

  const adminName = tr('messaging.adminName', 'Admin');
  const conversationFallback = tr('messaging.conversationFallback', 'Conversation');
  const avatarAlt = tr('messaging.avatarAlt', 'Avatar');

  const [isDarkMode, setIsDarkMode] = useState(false);
  const [threads, setThreads] = useState([]);
  const [selectedThread, setSelectedThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [adminThreads, setAdminThreads] = useState([]);
  const [unreadSummary, setUnreadSummary] = useState({ total_unread: 0, threads: {}, channels: {} });
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState('');
  const streamRef = React.useRef(null);
  const threadsStreamRef = React.useRef(null);
  const unreadRefreshTimerRef = React.useRef(null);
  const didInitSelectRef = React.useRef(false);
  const loadSeqRef = React.useRef(0);

  const messagesAreaRef = React.useRef(null);
  const messagesEndRef = React.useRef(null);
  const stickToBottomRef = React.useRef(true);
  const pendingInitialScrollRef = React.useRef(false);

  // Payload refs to avoid state updates (and re-renders) when data is unchanged.
  const threadsPayloadRef = React.useRef('');
  const adminThreadsPayloadRef = React.useRef('');
  const unreadPayloadRef = React.useRef('');
  const lastUnreadTotalRef = React.useRef(null);
  const adminMessagesPayloadRef = React.useRef('');

  const [showChatMobile, setShowChatMobile] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 900);
  React.useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 900);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    const detectDark = () => {
      const dashboardRoot = document.querySelector('.dd-driver-dashboard');
      if (dashboardRoot) return dashboardRoot.classList.contains('dark-root');
      return (
        document.body.classList.contains('dark-root') ||
        document.documentElement.classList.contains('dark-root')
      );
    };

    const update = () => setIsDarkMode(detectDark());
    update();

    const dashboardRoot = document.querySelector('.dd-driver-dashboard');
    if (!dashboardRoot) return;
    const observer = new MutationObserver(() => update());
    observer.observe(dashboardRoot, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const msgTheme = {
    muted: isDarkMode ? '#94a3b8' : '#64748b'
  };

  const scrollToBottom = (behavior = 'auto') => {
    try {
      messagesEndRef.current?.scrollIntoView({ block: 'end', behavior });
    } catch {
      // ignore
    }
  };

  // Scroll after the DOM commits; more reliable than requestAnimationFrame right after setState.
  useLayoutEffect(() => {
    if (!pendingInitialScrollRef.current) return;
    if (!selectedThread) return;
    if (threadLoading) return;
    scrollToBottom('auto');
    pendingInitialScrollRef.current = false;
  }, [selectedThread?.id, threadLoading, messages.length]);

  const mergeChronologicalUnique = (primary = [], secondary = []) => {
    const map = new Map();
    [...(primary || []), ...(secondary || [])].forEach((m) => {
      if (!m) return;
      const id = String(m.id || '');
      if (!id) return;
      map.set(id, m);
    });
    const out = Array.from(map.values());
    out.sort((a, b) => Number(a?.created_at || 0) - Number(b?.created_at || 0));
    return out;
  };

  async function refreshThreads() {
    const data = await getJson('/messaging/threads?limit=200', { timeoutMs: 45000, requestLabel: 'GET /messaging/threads?limit=200' });
    const next = data.threads || [];
    const nextPayload = JSON.stringify(next ?? []);
    if (nextPayload !== threadsPayloadRef.current) {
      threadsPayloadRef.current = nextPayload;
      setThreads(next);
      try {
        localStorage.setItem('messaging:driver:threads', JSON.stringify({ ts: Date.now(), threads: next }));
      } catch {
        // ignore
      }
    }
  }

  async function refreshUnread() {
    const data = await getJson('/messaging/unread/summary', { timeoutMs: 30000, requestLabel: 'GET /messaging/unread/summary' });
    const nextSummary = data || { total_unread: 0, threads: {}, channels: {} };
    const nextPayload = JSON.stringify(nextSummary);
    if (nextPayload !== unreadPayloadRef.current) {
      unreadPayloadRef.current = nextPayload;
      setUnreadSummary(nextSummary);
    }
    try {
      const total = Number(nextSummary?.total_unread || 0);
      if (lastUnreadTotalRef.current !== total) {
        lastUnreadTotalRef.current = total;
        window.dispatchEvent(new CustomEvent('messaging:unread', { detail: { total_unread: total } }));
      }
    } catch {
      // ignore
    }
  }

  async function refreshAdminThreads() {
    const channels = await getJson('/messaging/notifications/channels', { timeoutMs: 30000, requestLabel: 'GET /messaging/notifications/channels' });
    const items = (channels.channels || []).map((ch) => {
      const last = ch.last_message || null;
      const lastText = last
        ? (last.title ? `${last.title}: ${last.text || ''}` : (last.text || ''))
        : '';
      return {
        id: `admin:${ch.id}`,
        kind: 'admin_channel',
        channel_id: ch.id,
        title: ch.name || ch.id,
        display_title: ch.name || ch.id,
        last_message: last ? { text: lastText } : null,
        last_message_at: ch.last_message_at || null,
        pinned: true,
      };
    });
    items.sort((a, b) => (b.last_message_at || 0) - (a.last_message_at || 0));
    const nextPayload = JSON.stringify(items ?? []);
    if (nextPayload !== adminThreadsPayloadRef.current) {
      adminThreadsPayloadRef.current = nextPayload;
      setAdminThreads(items);
    }
  }

  async function selectThread(thread) {
    const seq = ++loadSeqRef.current;
    if (streamRef.current) {
      try { streamRef.current.close(); } catch { /* ignore */ }
      streamRef.current = null;
    }
    setSelectedThread(thread);
    setThreadLoading(true);
    setMessages([]);

    pendingInitialScrollRef.current = true;

    // Reset scroll pin when opening a thread.
    stickToBottomRef.current = true;

    if (thread.kind === 'admin_channel') {
      try {
        // Fast: load latest first, then fill.
        const first = await getJson(`/messaging/notifications/channels/${thread.channel_id}/messages?limit=30`, { timeoutMs: 30000, requestLabel: 'GET /messaging/notifications/channel/messages?limit=30' });
        if (loadSeqRef.current !== seq) return;
        setMessages(first.messages || []);
        setThreadLoading(false);
        pendingInitialScrollRef.current = true;

        // Background fill (up to 200)
        getJson(`/messaging/notifications/channels/${thread.channel_id}/messages?limit=200`, { timeoutMs: 30000, requestLabel: 'GET /messaging/notifications/channel/messages?limit=200' })
          .then((full) => {
            if (loadSeqRef.current !== seq) return;
            setMessages((prev) => mergeChronologicalUnique(full?.messages || [], prev || []));
            if (stickToBottomRef.current) requestAnimationFrame(() => scrollToBottom('auto'));
          })
          .catch(() => {});
      } finally {
        if (loadSeqRef.current === seq) setThreadLoading(false);
      }
      try {
        await postJson(`/messaging/notifications/channels/${thread.channel_id}/read`, {});
        refreshUnread().catch(() => {});
      } catch {
        // ignore
      }
      return;
    }

    let data;
    try {
      // Fast: latest messages first (small limit), then fill the rest (up to 200) in background.
      data = await getJson(`/messaging/threads/${thread.id}/messages?limit=30`, { timeoutMs: 30000, requestLabel: 'GET /messaging/thread/messages?limit=30' });
      if (loadSeqRef.current !== seq) return;
      setMessages(data.messages || []);
      setThreadLoading(false);
      pendingInitialScrollRef.current = true;

      getJson(`/messaging/threads/${thread.id}/messages?limit=200`, { timeoutMs: 30000, requestLabel: 'GET /messaging/thread/messages?limit=200' })
        .then((full) => {
          if (loadSeqRef.current !== seq) return;
          setMessages((prev) => mergeChronologicalUnique(full?.messages || [], prev || []));
          if (stickToBottomRef.current) requestAnimationFrame(() => scrollToBottom('auto'));
        })
        .catch(() => {});
    } finally {
      if (loadSeqRef.current === seq) setThreadLoading(false);
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
              next.sort((a, b) => Number(a?.created_at || 0) - Number(b?.created_at || 0));
              return next;
            });
            if (stickToBottomRef.current) requestAnimationFrame(() => scrollToBottom('smooth'));
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

  const filteredAdminThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (adminThreads || []).filter(t => {
      const title = String(t.display_title || t.title || '').toLowerCase();
      const last = String(t.last_message?.text || '').toLowerCase();
      return !q || title.includes(q) || last.includes(q);
    });
  }, [adminThreads, search]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let showedCached = false;
        setError('');
        // Instant UI: try cached threads first.
        try {
          const cached = JSON.parse(localStorage.getItem('messaging:driver:threads') || 'null');
          if (cached?.threads?.length) {
            setThreads(cached.threads);
            showedCached = true;
            setLoading(false);
          } else {
            setLoading(true);
          }
        } catch {
          // ignore
          setLoading(true);
        }
        // Ensure driver has their carrier direct thread available
        postJson('/messaging/driver/threads/my-carrier', {}, { timeoutMs: 30000, requestLabel: 'POST /messaging/driver/threads/my-carrier' }).catch(() => {});
        // Fast initial render: list first (one retry for transient timeouts).
        const attempt = async () => {
          const results = await Promise.allSettled([refreshThreads(), refreshAdminThreads()]);
          const firstErr = results.find(r => r.status === 'rejected')?.reason;
          if (firstErr) throw firstErr;
        };
        try {
          await attempt();
        } catch {
          await new Promise(r => setTimeout(r, 800));
          await attempt();
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || tr('messaging.failedLoad', 'Failed to load messaging'));
      } finally {
        if (!cancelled) setLoading(false);
      }

      // Non-blocking background unread fetch
      refreshUnread().catch(() => {});
    })();
    return () => {
      cancelled = true;
      if (unreadRefreshTimerRef.current) {
        clearTimeout(unreadRefreshTimerRef.current);
        unreadRefreshTimerRef.current = null;
      }
      if (streamRef.current) {
        try { streamRef.current.close(); } catch { /* ignore */ }
        streamRef.current = null;
      }
      if (threadsStreamRef.current) {
        try { threadsStreamRef.current.close(); } catch { /* ignore */ }
        threadsStreamRef.current = null;
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

  // Real-time sidebar updates via SSE (best-effort)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (threadsStreamRef.current) {
          try { threadsStreamRef.current.close(); } catch { /* ignore */ }
          threadsStreamRef.current = null;
        }

        const since = (threads || []).reduce((m, t) => Math.max(m, Number(t.updated_at || 0)), 0);
        const es = await openEventSource('/messaging/threads/stream', { since, limit: 200 });
        threadsStreamRef.current = es;
        es.onmessage = (evt) => {
          if (cancelled) return;
          try {
            const payload = JSON.parse(evt.data);
            if (payload?.type !== 'threads' || !Array.isArray(payload.threads)) return;
            const incoming = payload.threads;
            setThreads((prev) => {
              const map = new Map((prev || []).map(t => [t.id, t]));
              incoming.forEach((t) => {
                if (!t?.id) return;
                map.set(t.id, { ...(map.get(t.id) || {}), ...t });
              });
              const out = Array.from(map.values());
              out.sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));
              return out;
            });

            if (unreadRefreshTimerRef.current) clearTimeout(unreadRefreshTimerRef.current);
            unreadRefreshTimerRef.current = setTimeout(() => {
              refreshUnread().catch(() => {});
            }, 400);
          } catch {
            // ignore
          }
        };
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll admin notifications so broadcasts show up without hard refresh
  useEffect(() => {
    let alive = true;
    const id = setInterval(() => {
      if (!alive) return;
      refreshAdminThreads().catch(() => {});
      refreshUnread().catch(() => {});
      if (selectedThread?.kind === 'admin_channel') {
        getJson(`/messaging/notifications/channels/${selectedThread.channel_id}/messages?limit=200`)
          .then((data) => {
            if (!alive) return;
            const next = data.messages || [];
            const nextPayload = JSON.stringify(next ?? []);
            if (nextPayload !== adminMessagesPayloadRef.current) {
              adminMessagesPayloadRef.current = nextPayload;
              setMessages(next);
            }
          })
          .catch(() => {});
      }
    }, AUTO_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [selectedThread]);

  const handleSend = async () => {
    if (!message.trim() || !selectedThread) return;
    if (selectedThread.kind === 'admin_channel') return;
    if (selectedThread.is_read_only) return;
    const text = message.trim();
    setMessage('');
    await postJson(`/messaging/threads/${selectedThread.id}/messages`, { text });
    postJson(`/messaging/threads/${selectedThread.id}/read`, {}).catch(() => {});
    await refreshThreads();
    refreshUnread().catch(() => {});
    await selectThread({ ...selectedThread });
  };

  const handleSelectChat = (thread) => {
    selectThread(thread);
    if (window.innerWidth <= 640) setShowChatMobile(true);
  };

  const handleBack = () => setShowChatMobile(false);

  return (
    <>
      <header className="messaging-header">
        <div className="header-content">
          <h1>{tr('messaging.title', 'Messaging')}</h1>
          <p className="header-subtitle">{tr('messaging.subtitle', 'Chat with your carrier')}</p>
        </div>
      </header>

      <div className="messaging-root">
        {(!isMobile || !showChatMobile) && (
          <aside className="sidebar">
            <div className="sidebar-header">
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button
                  className="chat-filter-btn"
                  onClick={async () => {
                    try {
                      setError('');
                      setLoading(true);
                      await postJson('/messaging/driver/threads/my-carrier', {});
                      await Promise.all([refreshThreads(), refreshAdminThreads()]);
                    } catch (e) {
                      setError(e?.message || tr('messaging.refreshFailed', 'Refresh failed'));
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  {tr('common.refresh', 'Refresh')}
                </button>
              </div>

              <div className="sidebar-search">
                <i className="fa-solid fa-search"></i>
                <input
                  type="text"
                  placeholder={tr('messaging.searchPlaceholder', 'Search conversations...')}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="chats-list">
              {error && <div style={{ padding: 12, color: '#b91c1c' }}>{error}</div>}
              {loading && <div style={{ padding: 12, opacity: 0.8 }}>{tr('common.loading', 'Loading…')}</div>}

              {!loading && filteredAdminThreads.length > 0 && (
                <div style={{ padding: '8px 20px 4px', fontSize: 12, fontWeight: 800, color: msgTheme.muted }}>
                  {tr('messaging.adminNotifications', 'Admin Notifications')}
                </div>
              )}
              {filteredAdminThreads.map((t) => (
                <div
                  key={t.id}
                  className={`chat-item${selectedThread && selectedThread.id === t.id ? ' active' : ''}`}
                  onClick={() => handleSelectChat(t)}
                >
                  <div className="chat-avatar" style={{ background: '#fee2e2' }}>
                    <div style={{ position: 'relative', width: 36, height: 36 }}>
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {initials(adminName)}
                      </div>
                    </div>
                  </div>
                  <div className="chat-info">
                    <div className="chat-title">{t.display_title || adminName}</div>
                    <div className="chat-last">{t.last_message?.text || tr('messaging.oneWayNotifications', 'One-way notifications')}</div>
                  </div>
                  <div className="chat-meta">
                    <span className="chat-time">{fmtTime(t.last_message_at)}</span>
                    {unreadSummary?.channels?.[t.channel_id]?.has_unread && (!selectedThread || selectedThread.id !== t.id) && (
                      <span className="chat-unread">●</span>
                    )}
                  </div>
                </div>
              ))}

              {!loading && filteredThreads.length === 0 && (
                <div style={{ padding: 12, opacity: 0.8 }}>{tr('messaging.noConversations', 'No conversations yet.')}</div>
              )}

              {filteredThreads.map(t => (
                <div
                  key={t.id}
                  className={`chat-item${selectedThread && selectedThread.id === t.id ? ' active' : ''}`}
                  onClick={() => handleSelectChat(t)}
                >
                  <div className="chat-avatar">
                    <div style={{ position: 'relative', width: 36, height: 36 }}>
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {initials(t.display_title || t.other_display_name || t.title)}
                      </div>
                      {t.other_photo_url && (
                        <img
                          src={t.other_photo_url}
                          alt={avatarAlt}
                          style={{ position: 'absolute', inset: 0, width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }}
                          onError={(e) => { e.currentTarget.remove(); }}
                        />
                      )}
                    </div>
                  </div>
                  <div className="chat-info">
                    <div className="chat-title">{t.display_title || t.other_display_name || t.title || conversationFallback}</div>
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
                  <div style={{ position: 'relative', width: 44, height: 44 }}>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {initials(selectedThread.display_title || selectedThread.other_display_name || selectedThread.title)}
                    </div>
                    {selectedThread.other_photo_url && (
                      <img
                        src={selectedThread.other_photo_url}
                        alt={avatarAlt}
                        style={{ position: 'absolute', inset: 0, width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }}
                        onError={(e) => { e.currentTarget.remove(); }}
                      />
                    )}
                  </div>
                </div>
                <div>
                  <div className="header-title">{selectedThread.display_title || selectedThread.other_display_name || selectedThread.title || conversationFallback}</div>
                </div>
              </div>
              <div className="header-actions">
                <i className="fa-solid fa-ellipsis-v"></i>
              </div>
            </div>

            <div
              className="messages-area"
              ref={messagesAreaRef}
              onScroll={() => {
                const el = messagesAreaRef.current;
                if (!el) return;
                const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
                stickToBottomRef.current = distance < 40;
              }}
            >
              {threadLoading && (
                <div style={{ padding: 16, opacity: 0.85, fontWeight: 700, color: msgTheme.muted }}>
                  {tr('messaging.loadingConversation', 'Loading conversation…')}
                </div>
              )}
              {!threadLoading && messages.length === 0 && (
                <div style={{ padding: 16, opacity: 0.8 }}>
                  {tr('messaging.noMessages', 'No messages yet.')}
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`message-row${m.sender_role === 'driver' ? ' sent' : ''}`}>
                  <div className="message-bubble">
                    {m.title ? <div style={{ fontWeight: 800, marginBottom: 4 }}>{m.title}</div> : null}
                    {m.text}
                  </div>
                  <div className="message-meta">{fmtTime(m.created_at)}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {selectedThread.kind === 'admin_channel' ? (
              <div className="message-input-area" style={{ justifyContent: 'center', opacity: 0.85 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: msgTheme.muted }}>{tr('messaging.adminOneWay', 'Admin notifications are one-way.')}</div>
              </div>
            ) : selectedThread.is_read_only ? (
              <div className="message-input-area" style={{ justifyContent: 'center', opacity: 0.85 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: msgTheme.muted }}>
                  {tr('messaging.chatEnded', 'Chat ended for this load (read-only).')}
                </div>
              </div>
            ) : (
              <div className="message-input-area">
                <input
                  className="message-input"
                  type="text"
                  placeholder={tr('messaging.typeMessage', 'Type your message...')}
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

        {!selectedThread && !loading && (
          <main className="main-chat">
            <div className="messages-area">
              <div style={{ padding: 18, opacity: 0.85, fontWeight: 700, color: msgTheme.muted }}>
                {tr('messaging.selectConversation', 'Select a conversation to start.')}
              </div>
            </div>
          </main>
        )}
      </div>
    </>
  );
}
