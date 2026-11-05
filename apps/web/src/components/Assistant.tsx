import { useContext, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { MessageCircle, Send, Sparkles, X, RotateCcw, Headset } from 'lucide-react';
import { api, post } from '../api';
import { UserContext } from '../App';
import { Modal } from './UI';
import './assistant.css';

type Source = { id: string; title: string; source: string };
type Action = { type: 'navigate' | 'handoff'; tab?: string; label: string };
type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  intent?: string;
  sources?: Source[];
  actions?: Action[];
  mode?: string;
};
type ChatResponse = {
  conversationId: string;
  mode: string;
  handoffSuggested: boolean;
  message: ChatMessage;
};
type HandoffTicket = {
  id: string;
  status: string;
  reason: string;
  resolution?: string;
  createdAt?: string;
};
type Conversation = {
  conversation: { id: string; projectId: string | null; title: string };
  messages: ChatMessage[];
};

const INTENT_LABELS: Record<string, string> = {
  chat: '闲聊',
  general: '日常',
  weather: '天气',
  knowledge: '知识',
  design: '设计',
  budget: '预算',
  construction: '施工',
  handoff: '人工',
};

const QUICK_PROMPTS = [
  '卫生间防水做多高？',
  '我家装修预算怎么分配？',
  '现代简约风怎么配色？',
  '施工现场要注意哪些验收节点？',
  '今天天气怎么样？',
  '有什么好吃的？',
];

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
};

function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={index}>{part.slice(2, -2)}</strong>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

export default function Assistant({
  projectId,
  onNavigate,
}: {
  projectId?: string;
  onNavigate?: (tab: string) => void;
}) {
  const user = useContext(UserContext);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [ticket, setTicket] = useState<HandoffTicket | null>(null);
  const [tickets, setTickets] = useState<HandoffTicket[]>([]);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const storageKey = 'jianspace-assistant:' + (projectId || 'global');

  useEffect(() => {
    let cancelled = false;
    const saved = localStorage.getItem(storageKey);
    if (!saved) return;
    api<Conversation>('/assistant/conversations/' + saved)
      .then((data) => {
        if (cancelled) return;
        setConversationId(saved);
        setMessages(data.messages);
      })
      .catch(() => localStorage.removeItem(storageKey));
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [open, messages, busy]);

  async function send(text = input) {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    setError('');
    setBusy(true);
    setMessages((current) => [
      ...current,
      { id: 'local-' + Date.now(), role: 'user', content: message },
    ]);
    try {
      const result = await post<ChatResponse>('/assistant/chat', {
        message,
        projectId,
        conversationId,
      });
      setConversationId(result.conversationId);
      localStorage.setItem(storageKey, result.conversationId);
      setMessages((current) => [...current, result.message]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '小筑暂时无法回答，请稍后重试或转人工。');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    localStorage.removeItem(storageKey);
    setConversationId(null);
    setMessages([]);
    setTicket(null);
    setError('');
  }

  async function submitHandoff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setHandoffBusy(true);
    setError('');
    try {
      const created = await post<HandoffTicket>('/assistant/handoffs', {
        conversationId,
        projectId,
        reason: String(data.get('reason') || ''),
        detail: String(data.get('detail') || ''),
        contact: String(data.get('contact') || ''),
      });
      setTicket(created);
      setTickets((current) => [created, ...current]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工单提交失败，请稍后重试。');
    } finally {
      setHandoffBusy(false);
    }
  }

  async function loadTickets() {
    try {
      const data = await api<{ items: HandoffTicket[] }>('/assistant/handoffs');
      setTickets(data.items);
    } catch {
      setTickets([]);
    }
  }

  const last = messages[messages.length - 1];
  const showHandoff = !busy && (last?.actions || []).some((action) => action.type === 'handoff');

  return (
    <>
      {!open && (
        <button className="assistant-fab" onClick={() => setOpen(true)} aria-label="打开小筑家装助手">
          <MessageCircle size={18} />
          小筑
        </button>
      )}
      {open && (
        <section className="assistant-panel" aria-label="小筑家装助手">
          <header className="assistant-head">
            <div className="assistant-identity">
              <span className="assistant-avatar">筑</span>
              <div>
                <strong>小筑</strong>
                <small>
                  {projectId ? '项目助手 · 家装管家' : '家装管家'}
                  {last?.mode === 'ai' ? ' · AI 模式' : last ? ' · 知识库模式' : ''}
                </small>
              </div>
            </div>
            <div className="assistant-head-actions">
              <button
                className="icon-button"
                aria-label="转人工顾问"
                onClick={() => {
                  setTicket(null);
                  setHandoffOpen(true);
                  void loadTickets();
                }}
              >
                <Headset size={16} />
              </button>
              <button className="icon-button" aria-label="新对话" onClick={reset}>
                <RotateCcw size={16} />
              </button>
              <button className="icon-button" aria-label="关闭小筑" onClick={() => setOpen(false)}>
                <X size={17} />
              </button>
            </div>
          </header>

          <div className="assistant-messages" ref={listRef}>
            {!messages.length && (
              <div className="assistant-welcome">
                <Sparkles size={20} />
                <p>
                  我是小筑。可以问装修知识、预算区间、设计和施工避坑；涉及结构安全或我答不好的问题，会转给人工顾问。
                </p>
                <div className="assistant-quick">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button key={prompt} onClick={() => void send(prompt)}>
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message) => (
              <article key={message.id} className={'assistant-message ' + message.role}>
                {message.role !== 'user' && (
                  <div className="assistant-message-meta">
                    <span>小筑</span>
                    {message.intent && <em>{INTENT_LABELS[message.intent] || message.intent}</em>}
                    {message.mode === 'human' && <em>人工</em>}
                    {message.mode === 'ai' && <em>AI</em>}
                  </div>
                )}
                <div className="assistant-bubble">
                  {message.content.split('\n').map((line, index) =>
                    line ? (
                      <p key={index}>
                        <Rich text={line} />
                      </p>
                    ) : (
                      <br key={index} />
                    ),
                  )}
                </div>
                {!!message.sources?.length && (
                  <details className="assistant-sources">
                    <summary>依据 {message.sources.length} 条</summary>
                    {message.sources.map((source) => (
                      <p key={source.id}>
                        <strong>{source.title}</strong>
                        <small>{source.source}</small>
                      </p>
                    ))}
                  </details>
                )}
                {!!message.actions?.length && (
                  <div className="assistant-actions">
                    {message.actions.map((action) =>
                      action.type === 'navigate' && action.tab && onNavigate ? (
                        <button
                          key={action.label}
                          onClick={() => {
                            onNavigate(action.tab!);
                            setOpen(false);
                          }}
                        >
                          {action.label}
                        </button>
                      ) : action.type === 'handoff' ? (
                        <button
                          key={action.label}
                          onClick={() => {
                            setTicket(null);
                            setHandoffOpen(true);
                            void loadTickets();
                          }}
                        >
                          {action.label}
                        </button>
                      ) : null,
                    )}
                  </div>
                )}
              </article>
            ))}
            {busy && <p className="assistant-typing">小筑正在整理资料…</p>}
            {error && <p className="assistant-error" role="alert">{error}</p>}
          </div>

          {showHandoff && (
            <button
              className="assistant-handoff-cta"
              onClick={() => {
                setTicket(null);
                setHandoffOpen(true);
                void loadTickets();
              }}
            >
              <Headset size={15} />
              转人工顾问
            </button>
          )}

          <form
            className="assistant-input"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              maxLength={2000}
              rows={2}
              placeholder="问小筑：材料、预算、施工或设计…"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button aria-label="发送" disabled={busy || !input.trim()}>
              <Send size={17} />
            </button>
          </form>
          <p className="assistant-foot">
            小筑是辅助工具，不替代设计师、监理或当地规范。涉及结构安全请转人工并咨询专业人员。
          </p>
        </section>
      )}

      {handoffOpen && (
        <Modal title="转人工顾问" onClose={() => setHandoffOpen(false)}>
          {ticket ? (
            <div className="assistant-ticket">
              <h3>工单已创建</h3>
              <p>
                工单号 <code>{ticket.id.slice(0, 8)}</code> · 状态{' '}
                {STATUS_LABELS[ticket.status] || ticket.status}
              </p>
              <p>人工顾问会通过你留下的联系方式跟进；对话记录与项目信息已一并提交。</p>
              <button className="button primary full" onClick={() => setHandoffOpen(false)}>
                知道了
              </button>
            </div>
          ) : (
            <form onSubmit={submitHandoff}>
              <p className="muted">
                描述具体问题后可提交工单。小筑会把当前对话、项目信息和联系方式一并交给人工顾问。
              </p>
              <label>
                问题类型
                <select name="reason" defaultValue="施工问题">
                  <option>施工问题</option>
                  <option>预算与报价</option>
                  <option>设计与方案</option>
                  <option>平台使用</option>
                  <option>投诉与纠纷</option>
                  <option>其他</option>
                </select>
              </label>
              <label>
                联系方式
                <input
                  name="contact"
                  maxLength={254}
                  defaultValue={user?.email || ''}
                  placeholder="邮箱或手机号"
                />
              </label>
              <label>
                问题说明
                <textarea
                  name="detail"
                  maxLength={2000}
                  placeholder="例如：卫生间闭水试验后楼下出现渗水，想确认责任与处理步骤"
                />
              </label>
              {!!tickets.length && (
                <details className="assistant-ticket-list">
                  <summary>我的工单（{tickets.length}）</summary>
                  {tickets.map((item) => (
                    <p key={item.id}>
                      #{item.id.slice(0, 8)} · {item.reason} ·{' '}
                      {STATUS_LABELS[item.status] || item.status}
                      {item.resolution ? '：' + item.resolution : ''}
                    </p>
                  ))}
                </details>
              )}
              <div className="modal-actions">
                <button type="button" className="button ghost" onClick={() => setHandoffOpen(false)}>
                  取消
                </button>
                <button className="button primary" disabled={handoffBusy}>
                  {handoffBusy ? '正在提交…' : '提交工单'}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
