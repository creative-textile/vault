const KEY = 'vault:safe-prompt-muted-until';
export const SAFE_PROMPT_MUTE_MS = 24 * 60 * 60 * 1000;

export function isSafePromptMuted(): boolean {
  try { return Number(localStorage.getItem(KEY) || 0) > Date.now(); } catch { return false; }
}
export function muteSafePrompt(): void {
  try { localStorage.setItem(KEY, String(Date.now() + SAFE_PROMPT_MUTE_MS)); } catch { /* storage unavailable */ }
}
