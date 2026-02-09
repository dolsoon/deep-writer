'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useChatStore, type ChatMessage } from '@/stores/useChatStore';
import { useLoadingStore } from '@/stores/useLoadingStore';

// --- Types ---

interface ChatPanelProps {
  onSendMessage: (text: string) => void;
  disabled?: boolean;
}

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
        <div className="whitespace-pre-wrap">{message.content}</div>
        {message.intent === 'edit' && (
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
        <p className="mb-1 font-medium">Ask about your writing</p>
        <p className="text-xs">
          Chat about ideas, ask for feedback, or request edits to your document.
        </p>
      </div>
    </div>
  );
}

function ChatInput({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  const [text, setText] = useState('');

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  }, [text, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="shrink-0 border-t border-gray-200 px-3 py-3 dark:border-gray-700">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your writing or request an edit..."
          disabled={disabled}
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-blue-500"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || !text.trim()}
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
