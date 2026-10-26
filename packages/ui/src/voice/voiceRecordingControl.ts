/**
 * 录音资源的定向控制端口（spec §9.8.1）。只保存入口回调，不保存录音状态或音频。
 * Esc 必须先交给真实资源持有者，不能只把 store 改成 idle 而让引擎继续拾音。
 */
const abortByEntry = new Map<string, () => void>();

export function registerVoiceRecordingAbort(entryId: string, abort: () => void): () => void {
  abortByEntry.set(entryId, abort);
  return () => {
    if (abortByEntry.get(entryId) === abort) abortByEntry.delete(entryId);
  };
}

export function requestVoiceRecordingAbort(entryId: string | null): void {
  if (entryId !== null) abortByEntry.get(entryId)?.();
}
