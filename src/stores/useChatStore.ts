import { create } from 'zustand';
import { nanoid } from 'nanoid';

// --- Types ---

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  intent?: 'chat' | 'edit';
}

interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
}

interface ChatActions {
  addUserMessage: (content: string) => string;
  addAssistantMessage: (content: string, intent: 'chat' | 'edit') => string;
  setLoading: (loading: boolean) => void;
  clearMessages: () => void;
}

type ChatStore = ChatState & ChatActions;

// --- Store ---

export const useChatStore = create<ChatStore>()((set) => ({
  messages: [],
  isLoading: false,

  addUserMessage: (content: string): string => {
    const id = nanoid();
    set((prev) => ({
      messages: [...prev.messages, {
        id,
        role: 'user' as const,
        content,
        timestamp: Date.now(),
      }],
    }));
    return id;
  },

  addAssistantMessage: (content: string, intent: 'chat' | 'edit'): string => {
    const id = nanoid();
    set((prev) => ({
      messages: [...prev.messages, {
        id,
        role: 'assistant' as const,
        content,
        timestamp: Date.now(),
        intent,
      }],
    }));
    return id;
  },

  setLoading: (loading: boolean) => {
    set({ isLoading: loading });
  },

  clearMessages: () => {
    set({ messages: [], isLoading: false });
  },
}));
