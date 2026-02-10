import { useSettingsStore } from '@/stores/useSettingsStore';

// --- API Headers ---

export function getApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const apiKey = useSettingsStore.getState().openaiApiKey;
  if (apiKey) {
    headers['x-openai-api-key'] = apiKey;
  }
  return headers;
}
