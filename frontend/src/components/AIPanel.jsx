import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiApi } from '../services/api';

export default function AIPanel({ showAI, onCloseAI }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [messages, setMessages] = useState([
    {
      role: 'bot',
      text: 'Hi! I can help verify interactions, suggest alternatives, and summarize clinical notes.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [inputVal, setInputVal] = useState('');
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [sending, setSending] = useState(false);

  const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Load conversations when panel opens
  useEffect(() => {
    if (!showAI) return;
    aiApi.getConversations()
      .then((res) => {
        const convos = res?.data?.conversations || res?.data || [];
        setConversations(Array.isArray(convos) ? convos : []);
      })
      .catch(() => { });
  }, [showAI]);

  useEffect(() => {
    if (!showAI) return undefined;

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [showAI]);

  const visibleConversations = useMemo(() => {
    return [...conversations]
      .sort((a, b) => {
        const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
        const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
        return bTime - aTime;
      })
      .filter((conv) => conv.id !== activeConversationId)
      .slice(0, 2);
  }, [activeConversationId, conversations]);

  const sendMsg = async () => {
    const text = inputVal.trim();
    if (!text || sending) return;

    setMessages((prev) => [...prev, { role: 'user', text, time: now() }]);
    setInputVal('');
    setSending(true);

    try {
      let convId = activeConversationId;
      if (!convId) {
        const newChatRes = await aiApi.newChat(text.slice(0, 50));
        convId = newChatRes?.data?.conversation?.id || newChatRes?.data?.id;
        setActiveConversationId(convId);
      }

      const res = await aiApi.sendMessage(convId, text);
      const aiResponse = res?.data?.response || res?.data?.message?.content || res?.data?.content || 'I received your message.';
      setMessages((prev) => [...prev, { role: 'bot', text: aiResponse, time: now() }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'bot', text: `Sorry, I encountered an error: ${err.message}`, time: now() }]);
    } finally {
      setSending(false);
    }
  };

  const handleSelectConversation = async (conv) => {
    setActiveConversationId(conv.id);
    try {
      const res = await aiApi.getMessages(conv.id);
      const msgs = res?.data?.messages || res?.data || [];
      const formatted = (Array.isArray(msgs) ? msgs : []).map(m => ({
        role: m.role === 'user' ? 'user' : 'bot',
        text: m.content || m.text || '',
        time: '',
      }));
      if (formatted.length > 0) setMessages(formatted);
    } catch {
      // keep existing messages
    }
  };

  return (
    <aside className={`ai-panel ${showAI ? 'ai-panel--open' : 'ai-panel--hidden'}`} id="aiPanel" aria-label="DoseGPT Assistant">
      <div className="ai-panel__header">
        <div className="ai-panel__title-group">
          <span className="ai-panel__avatar" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 40 40" fill="none">
              <rect x="0" y="0" width="16" height="16" fill="currentColor" />
              <rect x="20" y="0" width="20" height="8" fill="currentColor" />
              <rect x="20" y="12" width="20" height="8" fill="currentColor" />
              <rect x="0" y="20" width="16" height="8" fill="currentColor" />
              <rect x="0" y="32" width="16" height="8" fill="currentColor" />
              <rect x="20" y="24" width="20" height="16" fill="currentColor" />
            </svg>
          </span>
          <span className="ai-panel__name">DoseGPT</span>
          <span className="ai-panel__online" aria-label="Online"></span>
        </div>
        <button className="ai-panel__close-btn" type="button" aria-label="Close DoseGPT panel" onClick={onCloseAI}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <div className="ai-panel__section">
        <div className="ai-panel__section-head">
          <span className="ai-panel__section-label">CHAT HISTORY</span>
          <button
            type="button"
            className="ai-panel__open-full"
            onClick={() => { onCloseAI?.(); navigate('/chatbot'); }}
          >
            Open full chat
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M7 17L17 7" />
              <path d="M17 7H7v10" />
            </svg>
          </button>
        </div>
        <div className="ai-history" aria-label="Chat history">
          {visibleConversations.length === 0 ? (
            <div style={{ padding: '8px 12px', color: '#94a3b8', fontSize: 12 }}>No conversations yet</div>
          ) : (
            visibleConversations.map((conv) => (
              <button
                key={conv.id}
                className={`ai-history__item ${activeConversationId === conv.id ? 'ai-history__item--active' : ''}`}
                type="button"
                onClick={() => handleSelectConversation(conv)}
              >
                <span className="ai-history__label">{conv.title || `Chat #${conv.id}`}</span>
                <span className="ai-history__time">{conv.created_at ? new Date(conv.created_at).toLocaleDateString() : ''}</span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="ai-panel__divider"></div>

      <div className="ai-chat" aria-live="polite" aria-atomic="false" aria-label="AI conversation">
        {messages.map((msg, i) => (
          <div key={`${msg.time}-${i}`} className={`ai-msg ${msg.role === 'user' ? 'ai-msg--user' : 'ai-msg--bot'}`}>
            <div className="ai-msg__bubble">{msg.text}</div>
            {msg.time && <div className="ai-msg__time">{msg.time}</div>}
          </div>
        ))}
        {sending && (
          <div className="ai-msg ai-msg--bot">
            <div className="ai-msg__bubble">Thinking...</div>
          </div>
        )}
      </div>

      <form
        className="ai-panel__input-form"
        onSubmit={(event) => {
          event.preventDefault();
          sendMsg();
        }}
      >
        <label htmlFor="aiChatInput" className="sr-only">
          Ask DoseGPT about medications
        </label>
        <input
          ref={inputRef}
          id="aiChatInput"
          type="text"
          className="ai-panel__input"
          placeholder="Ask DoseGPT about medications..."
          autoComplete="off"
          value={inputVal}
          onChange={(event) => setInputVal(event.target.value)}
          disabled={sending}
        />
        <button type="submit" className="ai-panel__send-btn" aria-label="Send message" disabled={sending}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </aside>
  );
}
