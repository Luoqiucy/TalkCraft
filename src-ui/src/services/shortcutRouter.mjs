const recordingModes = new Set(['dictation', 'prompt', 'translate', 'chat']);

// This is the production route used by WorkbenchApp and the recording-lifecycle
// tests. Keep mode selection and the active-session stop/cancel decision here.
export function routeRecordingShortcut(action, { capture, busy, session, start, cancel }) {
  if (!recordingModes.has(action)) return { kind: 'ignored', result: false };
  if (busy) return { kind: 'cancel', result: Boolean(cancel?.()) };
  // The MediaRecorder session changes synchronously before React renders its
  // next capture state. Prefer it to avoid using a stale render snapshot when
  // a second shortcut arrives during that transition.
  const activeState = ['idle', 'acquiring', 'recording', 'stopping', 'ready', 'error', 'disposed'].includes(session?.state)
    ? session.state
    : capture;
  if (activeState === 'recording') return { kind: 'stop', result: Boolean(session?.stop?.()) };
  if (activeState === 'acquiring' || activeState === 'stopping') {
    return { kind: 'cancel', result: Boolean(cancel?.()) };
  }
  return { kind: 'start', result: start?.(action) };
}
