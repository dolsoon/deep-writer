import { useCallback } from 'react';
import type { RefObject } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { useGeneration } from '@/hooks/useGeneration';
import type { CoWriThinkEditorHandle } from '@/components/editor/CoWriThinkEditor';

// --- Hook ---

export function useChat(
  editorHandleRef: RefObject<CoWriThinkEditorHandle | null>,
  goal: string,
) {
  const generation = useGeneration();

  const sendMessage = useCallback(async (text: string) => {
    const store = useChatStore.getState();
    store.addUserMessage(text);
    store.setLoading(true);

    try {
      // Get current document text from editor
      const editor = editorHandleRef.current?.getEditor();
      const document = editor
        ? editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n')
        : '';

      // Build conversation history for API
      const messages = useChatStore.getState().messages
        .map((m) => ({ role: m.role, content: m.content }));

      // Call /api/chat for intent classification + response
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, document, goal }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(
          (errData as Record<string, string>).error || 'Failed to send message.',
        );
      }

      const data = await response.json() as { intent: 'chat' | 'edit'; reply: string };

      // Add assistant reply to chat
      store.addAssistantMessage(data.reply, data.intent);
      store.setLoading(false);

      // If edit intent, trigger smart-edit pipeline.
      // Smart-edit mode compares original vs edited document and creates diffs
      // only for the parts that actually changed.
      if (data.intent === 'edit' && editor) {
        await generation.smartEditRequest(editor, goal, text);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      useChatStore.getState().addAssistantMessage(
        `Sorry, ${message} Please try again.`,
        'chat',
      );
      useChatStore.getState().setLoading(false);
    }
  }, [editorHandleRef, goal, generation]);

  return { sendMessage };
}
