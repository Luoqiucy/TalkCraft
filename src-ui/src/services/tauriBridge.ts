type TauriWindow = Window & { __TAURI__?: { core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> } } };

export function desktopAvailable() { return Boolean((window as TauriWindow).__TAURI__?.core); }

export async function desktopInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const core = (window as TauriWindow).__TAURI__?.core;
  if (!core) throw new Error('此操作需要 TalkCraft 桌面应用');
  return core.invoke<T>(command, args);
}

export async function clipboardWrite(text: string) {
  if (desktopAvailable()) await desktopInvoke('clipboard_write', { text });
  else await navigator.clipboard.writeText(text);
}

export async function exportFile(name: string, bytes: ArrayBuffer) {
  const result = await desktopInvoke<string>('file_export', { name, bytes: Array.from(new Uint8Array(bytes)) });
  if (result !== 'saved' && result !== 'cancelled') throw new Error('导出返回异常');
  return result;
}
