'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { useChatStore, type ChatMessage } from '@/stores/useChatStore';
import { useLoadingStore } from '@/stores/useLoadingStore';

// --- Types ---

interface ChatPanelProps {
  onSendMessage: (text: string) => void;
  disabled?: boolean;
}

interface PastedItem {
  id: number;
  text: string;
  lineCount: number;
  isExpanded: boolean;
}

// --- Constants ---

const PASTE_LINE_THRESHOLD = 10;

// --- Sub-components ---

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <div className="chat-markdown">
            <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        {message.shouldEdit && (
          <span className="mt-1 block text-xs opacity-60">
            Editing document...
          </span>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-800">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-400" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-400" style={{ animationDelay: '0.15s' }} />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-400" style={{ animationDelay: '0.3s' }} />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center">
      <div className="text-sm text-gray-400 dark:text-gray-500">
        <p className="mb-1 font-medium">Start a conversation</p>
        <p className="text-xs">
          Ask questions, brainstorm ideas, get feedback on your writing, or request edits.
        </p>
      </div>
    </div>
  );
}

function PastedItemChip({
  item,
  onToggle,
  onRemove,
}: {
  item: PastedItem;
  onToggle: (id: number) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-sky-900/20">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={() => onToggle(item.id)}
          className="flex flex-1 items-center gap-1.5 text-left text-xs font-medium text-sky-700 hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300"
        >
          <svg
            className={`h-3 w-3 shrink-0 transition-transform ${item.isExpanded ? 'rotate-90' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span>[Pasted text #{item.id} +{item.lineCount} lines]</span>
        </button>
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          className="shrink-0 rounded p-0.5 text-sky-400 transition-colors hover:bg-sky-100 hover:text-sky-600 dark:hover:bg-sky-800 dark:hover:text-sky-300"
          aria-label={`Remove pasted text #${item.id}`}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      {item.isExpanded && (
        <div className="border-t border-sky-200 px-3 py-2 dark:border-sky-800">
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-gray-700 dark:text-gray-300">
            {item.text}
          </pre>
        </div>
      )}
    </div>
  );
}

function ChatInput({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  const [text, setText] = useState('');
  const [pastedItems, setPastedItems] = useState<PastedItem[]>([]);
  const pasteCounterRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const pastedTexts = pastedItems.map((item) => item.text);
    const combined = [...pastedTexts, text.trim()].filter(Boolean).join('\n\n');
    if (!combined || disabled) return;
    onSend(combined);
    setText('');
    setPastedItems([]);
  }, [text, disabled, onSend, pastedItems]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const pastedText = e.clipboardData.getData('text/plain');
      const lines = pastedText.split('\n');
      if (lines.length >= PASTE_LINE_THRESHOLD) {
        e.preventDefault();
        pasteCounterRef.current += 1;
        setPastedItems((prev) => [
          ...prev,
          {
            id: pasteCounterRef.current,
            text: pastedText,
            lineCount: lines.length,
            isExpanded: false,
          },
        ]);
      }
    },
    [],
  );

  const togglePastedItem = useCallback((id: number) => {
    setPastedItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, isExpanded: !item.isExpanded } : item,
      ),
    );
  }, []);

  const removePastedItem = useCallback((id: number) => {
    setPastedItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // Auto-resize textarea to fit content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  return (
    <div className="shrink-0 border-t border-gray-200 px-3 py-3 dark:border-gray-700">
      {pastedItems.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {pastedItems.map((item) => (
            <PastedItemChip
              key={item.id}
              item={item}
              onToggle={togglePastedItem}
              onRemove={removePastedItem}
            />
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Type a message..."
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed outline-none transition-colors placeholder:text-gray-400 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-blue-500"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || (!text.trim() && pastedItems.length === 0)}
          className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600"
          aria-label="Send message"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// --- Main Component ---

export function ChatPanel({ onSendMessage, disabled = false }: ChatPanelProps) {
  const messages = useChatStore((s) => s.messages);
  const isLoading = useChatStore((s) => s.isLoading);
  const isGenerating = useLoadingStore((s) => s.isGenerating);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const inputDisabled = disabled || isLoading || isGenerating;

  return (
    <div className="flex h-full flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Chat
        </span>
      </div>

      {/* Message List */}
      {messages.length === 0 && !isLoading ? (
        <EmptyState />
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
          {messages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} />
          ))}
          {isLoading && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input */}
      <ChatInput onSend={onSendMessage} disabled={inputDisabled} />
    </div>
  );
}
