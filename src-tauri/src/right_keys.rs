use std::{
    collections::VecDeque,
    sync::{atomic::{AtomicU64, AtomicU8, Ordering}, Mutex, OnceLock},
    time::Instant,
};
use tauri::Manager;

const GUIDE_HOLD_MS: u64 = 650;
const DOUBLE_TAP_MS: u64 = 320;
const ALT_SPACE_ACTION: u32 = 0x1_0000;
const MSG_WM_SYSCOMMAND: u32 = 0x0112;
const MSG_WM_SYSKEYDOWN: u32 = 0x0104;
const MSG_SC_KEYMENU: u32 = 0xf100;
const VK_SPACE_CODE: u16 = 0x20;
const FLAG_RIGHT_CUSTOM: u8 = 1;
const FLAG_RIGHT_SPACE: u8 = 2;
const FLAG_LEFT_SPACE: u8 = 4;
const DIAGNOSTIC_LIMIT: usize = 200;

static SHORTCUT_EDITOR_FOCUSED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
static BINDING_FLAGS: AtomicU8 = AtomicU8::new(0);
static DIAGNOSTIC_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static DIAGNOSTIC_EPOCH: OnceLock<Instant> = OnceLock::new();
static DIAGNOSTICS: OnceLock<Mutex<VecDeque<DiagnosticEntry>>> = OnceLock::new();

#[derive(Clone)]
struct DiagnosticEntry {
    sequence: u64,
    elapsed_ms: u64,
    source: &'static str,
    event: String,
}

fn diagnostic_ring() -> &'static Mutex<VecDeque<DiagnosticEntry>> {
    DIAGNOSTICS.get_or_init(|| Mutex::new(VecDeque::with_capacity(DIAGNOSTIC_LIMIT)))
}

fn record_diagnostic(source: &'static str, event: impl Into<String>) {
    let elapsed_ms = DIAGNOSTIC_EPOCH.get_or_init(Instant::now).elapsed().as_millis() as u64;
    let entry = DiagnosticEntry {
        sequence: DIAGNOSTIC_SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1,
        elapsed_ms,
        source,
        event: event.into(),
    };
    if let Ok(mut entries) = diagnostic_ring().lock() {
        if entries.len() == DIAGNOSTIC_LIMIT {
            entries.pop_front();
        }
        entries.push_back(entry);
    }
}

pub fn set_shortcut_editor_focused(focused: bool) {
    SHORTCUT_EDITOR_FOCUSED.store(focused, Ordering::Relaxed);
}

pub fn update_bindings(bindings: &std::collections::BTreeMap<String, String>) {
    let mut flags = 0;
    if bindings.values().any(|value| is_right_custom(value)) {
        flags |= FLAG_RIGHT_CUSTOM;
    }
    if bindings.values().any(|value| value == "RightAlt+Space") {
        flags |= FLAG_RIGHT_SPACE;
    }
    if bindings.values().any(|value| value == "Alt+Space") {
        flags |= FLAG_LEFT_SPACE;
    }
    BINDING_FLAGS.store(flags, Ordering::Release);
    #[cfg(windows)]
    platform::update_binding_cache(bindings);
}

pub fn record_frontend_diagnostic(event: &str, capture: &str, session_state: &str, busy: bool) -> Result<(), String> {
    const EVENTS: &[&str] = &[
        "action_received",
        "start_requested",
        "start_result",
        "start_result_true",
        "start_result_false",
        "stop_requested",
        "stop_result",
        "stop_result_true",
        "stop_result_false",
        "cancel_requested",
        "cancel_result",
        "cancel_result_true",
        "cancel_result_false",
        "capture_state",
    ];
    const CAPTURES: &[&str] = &["idle", "acquiring", "recording", "stopping", "ready", "error"];
    const SESSION_STATES: &[&str] = &["idle", "acquiring", "recording", "stopping", "ready", "error", "disposed"];
    if !EVENTS.contains(&event) || !CAPTURES.contains(&capture) || !SESSION_STATES.contains(&session_state) {
        return Err("快捷键诊断事件无效".into());
    }
    record_diagnostic("frontend", format!("{event}; capture={capture}; session={session_state}; busy={busy}"));
    Ok(())
}

pub fn record_shortcut_diagnostic(source: &'static str, event: impl Into<String>) {
    record_diagnostic(source, event);
}

#[tauri::command]
pub fn shortcuts_diagnostic_frontend(
    window: tauri::WebviewWindow,
    event: String,
    capture: String,
    session_state: String,
    busy: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("仅工作台可写入快捷键诊断".into());
    }
    record_frontend_diagnostic(&event, &capture, &session_state, busy)
}

#[tauri::command]
pub fn shortcuts_diagnostics(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("仅工作台可读取快捷键诊断".into());
    }
    let events = diagnostic_ring()
        .lock()
        .map_err(|_| "快捷键诊断暂不可用")?
        .iter()
        .cloned()
        .collect::<Vec<_>>();
    let shortcut_state = window
        .state::<crate::shortcuts::ShortcutSettings>();
    let settings = shortcut_state.0.lock().map_err(|_| "快捷键设置暂不可用")?;
    Ok(serde_json::json!({
        "events": events.iter().map(|entry| serde_json::json!({
            "sequence": entry.sequence,
            "elapsed_ms": entry.elapsed_ms,
            "source": entry.source,
            "event": entry.event,
        })).collect::<Vec<_>>(),
        "native": native_metrics(),
        "bindings": settings.bindings,
        "registrationStatus": settings.status,
        "hookStatus": settings.hook_status,
        "capacity": DIAGNOSTIC_LIMIT,
    }))
}

fn native_metrics() -> serde_json::Value {
    #[cfg(windows)]
    {
        platform::metrics()
    }
    #[cfg(not(windows))]
    {
        serde_json::json!({ "available": false })
    }
}

#[derive(Default)]
struct Gesture {
    alt: bool,
    shift: bool,
    space: bool,
    alt_down_ms: u64,
    chord_used: bool,
    guide_sent: bool,
    pending_tap_ms: Option<u64>,
    double_candidate: bool,
}

impl Gesture {
    fn feed(&mut self, key: u32, down: bool, now_ms: u64) -> Option<&'static str> {
        match key {
            ALT_SPACE_ACTION if down => Some("Alt+Space"),
            0xa5 if down => {
                if self.alt {
                    return None;
                }
                let pending = self.pending_tap_ms.take();
                self.double_candidate =
                    pending.is_some_and(|at| now_ms.saturating_sub(at) <= DOUBLE_TAP_MS);
                self.alt = true;
                self.alt_down_ms = now_ms;
                self.chord_used = false;
                self.guide_sent = false;
                if self.space {
                    self.chord_used = true;
                    self.double_candidate = false;
                    return Some("RightAlt+Space");
                }
                if self.shift {
                    self.chord_used = true;
                    self.double_candidate = false;
                    return Some("RightAlt+RightShift");
                }
                if pending.is_some() && !self.double_candidate {
                    return Some("RightAlt");
                }
                None
            }
            0xa5 => {
                if !self.alt {
                    return None;
                }
                self.alt = false;
                let tap = !self.chord_used
                    && !self.guide_sent
                    && now_ms.saturating_sub(self.alt_down_ms) < GUIDE_HOLD_MS;
                self.shift = false;
                self.space = false;
                if !tap {
                    self.double_candidate = false;
                    return None;
                }
                if self.double_candidate {
                    self.double_candidate = false;
                    Some("RightAltDouble")
                } else {
                    self.pending_tap_ms = Some(now_ms);
                    None
                }
            }
            0xa1 => {
                self.shift = down;
                if self.alt && down && !self.chord_used && !self.guide_sent {
                    self.chord_used = true;
                    self.double_candidate = false;
                    self.pending_tap_ms = None;
                    Some("RightAlt+RightShift")
                } else {
                    None
                }
            }
            0x20 => {
                self.space = down;
                if self.alt && down && !self.chord_used && !self.guide_sent {
                    self.chord_used = true;
                    self.double_candidate = false;
                    self.pending_tap_ms = None;
                    Some("RightAlt+Space")
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    fn tick(&mut self, now_ms: u64) -> Option<&'static str> {
        if self.alt
            && !self.chord_used
            && !self.guide_sent
            && now_ms.saturating_sub(self.alt_down_ms) >= GUIDE_HOLD_MS
        {
            self.guide_sent = true;
            self.double_candidate = false;
            self.pending_tap_ms = None;
            return Some("__guide__");
        }
        if !self.alt
            && self
                .pending_tap_ms
                .is_some_and(|at| now_ms.saturating_sub(at) >= DOUBLE_TAP_MS)
        {
            self.pending_tap_ms = None;
            return Some("RightAlt");
        }
        None
    }

    fn reset(&mut self) {
        *self = Self::default();
    }
}

pub fn is_right_custom(value: &str) -> bool {
    matches!(
        value,
        "RightAlt" | "RightAltDouble" | "RightAlt+RightShift" | "RightAlt+Space"
    )
}

#[cfg(windows)]
pub fn is_custom(value: &str) -> bool {
    is_right_custom(value) || value == "Alt+Space"
}

#[cfg(not(windows))]
pub fn is_custom(value: &str) -> bool {
    is_right_custom(value)
}

fn is_alt_space_system_menu(message: u32, wparam: usize, lparam: isize) -> bool {
    message == MSG_WM_SYSCOMMAND
        && (wparam as u32 & 0xfff0) == MSG_SC_KEYMENU
        && (lparam as u16) == VK_SPACE_CODE
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
        mpsc::{self, Receiver, SyncSender, TrySendError},
        OnceLock,
    };
    use tauri::Manager;
    use windows_sys::Win32::Foundation::{FreeLibrary, GetLastError, HMODULE, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    static EVENTS: OnceLock<SyncSender<QueuedInput>> = OnceLock::new();
    static DISPATCHES: OnceLock<SyncSender<DispatchTask>> = OnceLock::new();
    static HOOK_CALLS: AtomicU64 = AtomicU64::new(0);
    static HOOK_MAX_US: AtomicU64 = AtomicU64::new(0);
    static LAST_CALLBACK_MS: AtomicU64 = AtomicU64::new(0);
    static LAST_RELEVANT_KEY_MS: AtomicU64 = AtomicU64::new(0);
    static INJECTED_INPUTS_IGNORED: AtomicU64 = AtomicU64::new(0);
    static EVENT_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    static QUEUED_EVENTS: AtomicU64 = AtomicU64::new(0);
    static DROPPED_EVENTS: AtomicU64 = AtomicU64::new(0);
    static MISSED_EVENTS: AtomicU64 = AtomicU64::new(0);
    static CONSUMER_ACTIVE: AtomicBool = AtomicBool::new(false);
    static CONSUMER_LAST_ACTIVITY_MS: AtomicU64 = AtomicU64::new(0);
    static DISPATCHER_ACTIVE: AtomicBool = AtomicBool::new(false);
    static DISPATCHER_LAST_ACTIVITY_MS: AtomicU64 = AtomicU64::new(0);
    static DISPATCHES_DROPPED: AtomicU64 = AtomicU64::new(0);
    static RESET_REQUIRED: AtomicBool = AtomicBool::new(false);
    static RIGHT_ALT_DOWN: AtomicBool = AtomicBool::new(false);
    static LEFT_ALT_DOWN: AtomicBool = AtomicBool::new(false);
    static RIGHT_SHIFT_DOWN: AtomicBool = AtomicBool::new(false);
    static SPACE_DOWN: AtomicBool = AtomicBool::new(false);
    static RIGHT_GESTURE_HELD: AtomicBool = AtomicBool::new(false);
    static HOOK_INSTALLED: AtomicBool = AtomicBool::new(false);
    static HOOK_DLL_LOADED: AtomicBool = AtomicBool::new(false);
    static HOOK_INSTALL_ERROR: AtomicU64 = AtomicU64::new(0);
    static WINDOW_FILTER_FAILED: AtomicBool = AtomicBool::new(false);
    static BINDING_FLAGS_CACHE: AtomicU8 = AtomicU8::new(0);
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    const WINDOW_SUBCLASS_ID: usize = 0x5443_5348;
    const WINDOW_EVENT_DUP_MS: u64 = 120;

    #[derive(Clone, Copy, Debug)]
    enum ShortcutInput {
        Key {
            key: u32,
            down: bool,
            at_ms: u64,
            from_window: bool,
        },
        AltSpace {
            right_alt: bool,
            left_alt: bool,
            editor_focused: bool,
            at_ms: u64,
            from_window: bool,
        },
        CaptureAltSpace {
            at_ms: u64,
        },
    }

    #[derive(Clone, Copy, Debug)]
    struct QueuedInput {
        sequence: u64,
        input: ShortcutInput,
    }

    #[derive(Clone, Copy, Debug)]
    enum DispatchTask {
        Binding(&'static str),
        CaptureAltSpace,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum ShortcutEffect {
        Binding(&'static str, u64),
        CaptureAltSpace,
    }

    fn now_ms() -> u64 {
        EPOCH.get_or_init(Instant::now).elapsed().as_millis() as u64
    }

    pub fn update_binding_cache(bindings: &std::collections::BTreeMap<String, String>) {
        let mut flags = 0;
        if bindings.values().any(|value| is_right_custom(value)) {
            flags |= FLAG_RIGHT_CUSTOM;
        }
        if bindings.values().any(|value| value == "RightAlt+Space") {
            flags |= FLAG_RIGHT_SPACE;
        }
        if bindings.values().any(|value| value == "Alt+Space") {
            flags |= FLAG_LEFT_SPACE;
        }
        BINDING_FLAGS_CACHE.store(flags, Ordering::Release);
    }

    fn enqueue(input: ShortcutInput, _source: &'static str) {
        let Some(sender) = EVENTS.get() else {
            MISSED_EVENTS.fetch_add(1, Ordering::Relaxed);
            return;
        };
        let sequence = EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1;
        match sender.try_send(QueuedInput { sequence, input }) {
            Ok(()) => {
                QUEUED_EVENTS.fetch_add(1, Ordering::Relaxed);
            }
            Err(TrySendError::Full(_)) => {
                DROPPED_EVENTS.fetch_add(1, Ordering::Relaxed);
                RESET_REQUIRED.store(true, Ordering::Release);
            }
            Err(TrySendError::Disconnected(_)) => {
                MISSED_EVENTS.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    fn foreground_is_talkcraft() -> bool {
        unsafe {
            let foreground = GetForegroundWindow();
            let root = GetAncestor(foreground, GA_ROOT);
            let window = if root.is_null() { foreground } else { root };
            let mut process_id = 0;
            GetWindowThreadProcessId(window, &mut process_id);
            process_id == std::process::id()
        }
    }

    fn callback_duration(started: Instant) {
        HOOK_CALLS.fetch_add(1, Ordering::Relaxed);
        LAST_CALLBACK_MS.store(now_ms(), Ordering::Relaxed);
        let elapsed = started.elapsed().as_micros().min(u64::MAX as u128) as u64;
        let mut old = HOOK_MAX_US.load(Ordering::Relaxed);
        while elapsed > old {
            match HOOK_MAX_US.compare_exchange_weak(old, elapsed, Ordering::Relaxed, Ordering::Relaxed) {
                Ok(_) => break,
                Err(current) => old = current,
            }
        }
    }

    fn binding_for_alt_space(right_alt: bool, left_alt: bool) -> Option<&'static str> {
        let flags = BINDING_FLAGS_CACHE.load(Ordering::Acquire);
        let right = flags & FLAG_RIGHT_SPACE != 0;
        let left = flags & FLAG_LEFT_SPACE != 0;
        if right_alt && right {
            Some("RightAlt+Space")
        } else if left_alt && left {
            Some("Alt+Space")
        } else if right && !left {
            Some("RightAlt+Space")
        } else if left && !right {
            Some("Alt+Space")
        } else {
            None
        }
    }

    fn dispatch_binding(app: &tauri::AppHandle, binding: &'static str) {
        let settings = app.state::<crate::shortcuts::ShortcutSettings>();
        let action = settings
            .0
            .lock()
            .ok()
            .and_then(|state| {
                state
                    .bindings
                    .iter()
                    .find(|(_, value)| value.as_str() == binding)
                    .map(|(action, _)| action.clone())
            });
        let Some(action) = action else {
            record_diagnostic("dispatcher", format!("binding_unmapped; binding={binding}"));
            return;
        };
        let action_for_log = action.clone();
        let scheduler = app.clone();
        let app = app.clone();
        match scheduler.run_on_main_thread(move || {
            // The settings lock was dropped before scheduling; keep window and
            // WebView work on Tauri's main thread, outside the gesture worker.
            crate::output_target::capture(&app);
            if let Some(main) = app.get_webview_window("main") {
                let detail = serde_json::json!({ "action": action, "phase": "toggle" });
                let script = format!(
                    "window.dispatchEvent(new CustomEvent('talkcraft-shortcut',{{detail:{detail}}}));"
                );
                match main.eval(&script) {
                    Ok(()) => record_diagnostic("dispatcher", format!("action_dispatched; binding={binding}; action={action}")),
                    Err(_) => record_diagnostic("dispatcher", format!("action_delivery_failed; binding={binding}; action={action}")),
                }
            } else {
                record_diagnostic("dispatcher", "main_window_unavailable; action_not_delivered");
            }
        }) {
            Ok(()) => record_diagnostic("dispatcher", format!("action_scheduled_on_main; binding={binding}; action={action_for_log}")),
            Err(_) => record_diagnostic("dispatcher", format!("main_thread_schedule_failed; binding={binding}; action={action_for_log}")),
        }
    }

    fn process_input(
        queued: QueuedInput,
        gesture: &mut Gesture,
        last_alt_space_action: &mut Option<u64>,
    ) {
        for effect in process_input_state(queued, gesture, last_alt_space_action) {
            match effect {
                ShortcutEffect::Binding(binding, at_ms) => dispatch(binding, at_ms, last_alt_space_action),
                ShortcutEffect::CaptureAltSpace => dispatch_capture_event(),
            }
        }
    }

    fn process_input_state(
        queued: QueuedInput,
        gesture: &mut Gesture,
        last_alt_space_action: &mut Option<u64>,
    ) -> Vec<ShortcutEffect> {
        let mut effects = Vec::new();
        let QueuedInput { sequence, input } = queued;
        record_diagnostic("consumer", format!("event_dequeued; sequence={sequence}"));
        if RESET_REQUIRED.swap(false, Ordering::AcqRel) {
            gesture.reset();
            record_diagnostic("gesture", "queue_overflow; state_reset");
        }
        let time = match input {
            ShortcutInput::Key { at_ms, .. }
            | ShortcutInput::AltSpace { at_ms, .. }
            | ShortcutInput::CaptureAltSpace { at_ms } => at_ms,
        };
        match input {
            ShortcutInput::Key { key, down, at_ms, from_window } => {
                let source = if from_window { "window" } else { "hook" };
                let key_name = match key {
                    0xa5 => "right_alt",
                    0xa1 => "right_shift",
                    0x20 => "space",
                    _ => "other",
                };
                record_diagnostic(source, format!("key_{key_name}_{}", if down { "down" } else { "up" }));
                if let Some(binding) = gesture.feed(key, down, at_ms) {
                record_diagnostic("gesture", format!("binding_recognized; binding={binding}"));
                    effects.push(ShortcutEffect::Binding(binding, time));
                }
            }
            ShortcutInput::AltSpace { right_alt, left_alt, editor_focused, at_ms, from_window } => {
                let source = if from_window { "window" } else { "hook" };
                record_diagnostic(source, format!("alt_space; right_alt={right_alt}; left_alt={left_alt}; editor={editor_focused}"));
                if editor_focused {
                    effects.push(ShortcutEffect::CaptureAltSpace);
                    return effects;
                }
                if last_alt_space_action.is_some_and(|previous| at_ms.saturating_sub(previous) <= WINDOW_EVENT_DUP_MS) {
                    record_diagnostic("gesture", "duplicate_alt_space_source_suppressed");
                    return effects;
                }
                if let Some(binding) = binding_for_alt_space(right_alt, left_alt) {
                    *last_alt_space_action = Some(at_ms);
                    record_diagnostic("gesture", format!("binding_recognized; binding={binding}"));
                    effects.push(ShortcutEffect::Binding(binding, time));
                } else {
                    record_diagnostic("gesture", "alt_space_not_configured");
                }
            }
            ShortcutInput::CaptureAltSpace { .. } => effects.push(ShortcutEffect::CaptureAltSpace),
        }
        effects
    }

    fn dispatch(binding: &'static str, at_ms: u64, last_alt_space_action: &mut Option<u64>) {
        if matches!(binding, "RightAlt+Space" | "Alt+Space") {
            *last_alt_space_action = Some(at_ms);
        }
        queue_dispatch(DispatchTask::Binding(binding));
    }

    fn dispatch_capture_event() {
        queue_dispatch(DispatchTask::CaptureAltSpace);
    }

    fn queue_dispatch(task: DispatchTask) {
        let Some(sender) = DISPATCHES.get() else {
            DISPATCHES_DROPPED.fetch_add(1, Ordering::Relaxed);
            record_diagnostic("dispatcher", "dispatch_channel_unavailable; action_not_queued");
            return;
        };
        match try_queue_dispatch(sender, task) {
            Ok(()) => record_diagnostic("dispatcher", "action_queued"),
            Err(TrySendError::Full(_)) => {
                DISPATCHES_DROPPED.fetch_add(1, Ordering::Relaxed);
                record_diagnostic("dispatcher", "dispatch_queue_full; action_not_queued");
            }
            Err(TrySendError::Disconnected(_)) => {
                DISPATCHES_DROPPED.fetch_add(1, Ordering::Relaxed);
                record_diagnostic("dispatcher", "dispatch_channel_disconnected; action_not_queued");
            }
        }
    }

    fn try_queue_dispatch(sender: &SyncSender<DispatchTask>, task: DispatchTask) -> Result<(), TrySendError<DispatchTask>> {
        sender.try_send(task)
    }

    fn run_dispatch_task(task: DispatchTask) {
        if let Some(app) = APP.get() {
            match task {
                DispatchTask::Binding("__guide__") => {
                    let scheduler = app.clone();
                    let app = app.clone();
                    match scheduler.run_on_main_thread(move || {
                        match crate::set_aux_visible(&app, "keymap", true) {
                            Ok(()) => record_diagnostic("dispatcher", "shortcut_guide_dispatched"),
                            Err(_) => record_diagnostic("dispatcher", "shortcut_guide_failed"),
                        }
                    }) {
                        Ok(()) => record_diagnostic("dispatcher", "shortcut_guide_scheduled"),
                        Err(_) => record_diagnostic("dispatcher", "shortcut_guide_schedule_failed"),
                    }
                }
                DispatchTask::Binding(binding) => dispatch_binding(app, binding),
                DispatchTask::CaptureAltSpace => {
                    let scheduler = app.clone();
                    let app = app.clone();
                    match scheduler.run_on_main_thread(move || {
                        if let Some(main) = app.get_webview_window("main") {
                            match main.eval("window.dispatchEvent(new CustomEvent('talkcraft-shortcut-capture',{detail:{binding:'Alt+Space'}}));") {
                                Ok(()) => record_diagnostic("dispatcher", "shortcut_capture_event_dispatched"),
                                Err(_) => record_diagnostic("dispatcher", "shortcut_capture_event_failed"),
                            }
                        } else {
                            record_diagnostic("dispatcher", "main_window_unavailable; capture_not_delivered");
                        }
                    }) {
                        Ok(()) => record_diagnostic("dispatcher", "shortcut_capture_scheduled"),
                        Err(_) => record_diagnostic("dispatcher", "shortcut_capture_schedule_failed"),
                    }
                }
            }
        } else {
            record_diagnostic("dispatcher", "application_not_ready; action_not_delivered");
        }
    }

    fn run_dispatcher(receiver: Receiver<DispatchTask>) {
        DISPATCHER_ACTIVE.store(true, Ordering::Release);
        record_diagnostic("dispatcher", "started; queue_capacity=64");
        while let Ok(task) = receiver.recv() {
            DISPATCHER_LAST_ACTIVITY_MS.store(now_ms(), Ordering::Relaxed);
            record_diagnostic("dispatcher", "action_dequeued");
            run_dispatch_task(task);
        }
        DISPATCHER_ACTIVE.store(false, Ordering::Release);
        record_diagnostic("dispatcher", "action_channel_disconnected");
    }

    fn tick_effect(gesture: &mut Gesture, now: u64) -> Option<ShortcutEffect> {
        gesture.tick(now).map(|binding| ShortcutEffect::Binding(binding, now))
    }

    fn process_key_hook(code: i32, wparam: usize, lparam: isize) -> Option<isize> {
        if code < 0 {
            return None;
        }
        let key = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };
        if key.flags & LLKHF_INJECTED != 0 {
            INJECTED_INPUTS_IGNORED.fetch_add(1, Ordering::Relaxed);
            return None;
        }
        let down = wparam == WM_KEYDOWN as usize || wparam == WM_SYSKEYDOWN as usize;
        let up = wparam == WM_KEYUP as usize || wparam == WM_SYSKEYUP as usize;
        if !down && !up {
            return None;
        }

        let vk = key.vkCode;
        if !matches!(vk, 0xa4 | 0xa5 | 0xa1 | 0x20) {
            return None;
        }
        LAST_RELEVANT_KEY_MS.store(now_ms(), Ordering::Relaxed);
        match vk {
            0xa4 => LEFT_ALT_DOWN.store(down, Ordering::Relaxed),
            0xa5 => RIGHT_ALT_DOWN.store(down, Ordering::Relaxed),
            0xa1 => RIGHT_SHIFT_DOWN.store(down, Ordering::Relaxed),
            0x20 => SPACE_DOWN.store(down, Ordering::Relaxed),
            _ => {}
        }

        let flags = BINDING_FLAGS_CACHE.load(Ordering::Acquire);
        let editor = SHORTCUT_EDITOR_FOCUSED.load(Ordering::Relaxed);
        let foreground = if vk == 0x20 || (vk == 0xa5 && down) {
            foreground_is_talkcraft()
        } else {
            false
        };
        let right_enabled = flags & FLAG_RIGHT_CUSTOM != 0;
        let is_right_gesture_key = vk == 0xa5
            || (RIGHT_GESTURE_HELD.load(Ordering::Relaxed) && matches!(vk, 0xa1 | 0x20));

        if vk == 0xa5 {
            RIGHT_GESTURE_HELD.store(down, Ordering::Relaxed);
        }

        // Left Alt+Space is supported only in TalkCraft. The top-level window
        // subclass remains the final native-menu guard if this hook is absent.
        if vk == 0x20
            && down
            && foreground
            && LEFT_ALT_DOWN.load(Ordering::Relaxed)
            && (flags & FLAG_LEFT_SPACE != 0 || editor)
        {
            if editor {
                enqueue(ShortcutInput::CaptureAltSpace { at_ms: now_ms() }, "hook");
            } else {
                enqueue(ShortcutInput::AltSpace {
                    right_alt: false,
                    left_alt: true,
                    editor_focused: false,
                    at_ms: now_ms(),
                    from_window: false,
                }, "hook");
            }
            return Some(1);
        }

        if right_enabled && is_right_gesture_key {
            if editor && foreground {
                return None;
            }
            let at_ms = now_ms();
            if vk == 0xa5 && down {
                // Preserve modifier order: Shift+RightAlt and Space+RightAlt
                // are both valid chords without querying asynchronous state.
                if RIGHT_SHIFT_DOWN.load(Ordering::Relaxed) {
                    enqueue(ShortcutInput::Key { key: 0xa1, down: true, at_ms, from_window: false }, "hook");
                }
                if SPACE_DOWN.load(Ordering::Relaxed) {
                    enqueue(ShortcutInput::Key { key: 0x20, down: true, at_ms, from_window: false }, "hook");
                }
            }
            enqueue(ShortcutInput::Key { key: vk, down, at_ms, from_window: false }, "hook");
            return Some(1);
        }
        None
    }

    unsafe extern "system" fn host_hook_callback(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        let started = Instant::now();
        let result = process_key_hook(code, wparam, lparam).unwrap_or(-1);
        callback_duration(started);
        result
    }

    unsafe extern "system" fn talkcraft_window_subclass(
        hwnd: windows_sys::Win32::Foundation::HWND,
        message: u32,
        wparam: usize,
        lparam: isize,
        _subclass_id: usize,
        _ref_data: usize,
    ) -> isize {
        let space_sys_key = message == MSG_WM_SYSKEYDOWN
            && wparam == VK_SPACE_CODE as usize
            && (RIGHT_ALT_DOWN.load(Ordering::Relaxed)
                || LEFT_ALT_DOWN.load(Ordering::Relaxed)
                || SHORTCUT_EDITOR_FOCUSED.load(Ordering::Relaxed));
        let system_menu = is_alt_space_system_menu(message, wparam, lparam);
        if space_sys_key || system_menu {
            let editor = SHORTCUT_EDITOR_FOCUSED.load(Ordering::Relaxed);
            if editor {
                enqueue(ShortcutInput::CaptureAltSpace { at_ms: now_ms() }, "window");
            } else {
                enqueue(ShortcutInput::AltSpace {
                    right_alt: RIGHT_ALT_DOWN.load(Ordering::Relaxed),
                    left_alt: LEFT_ALT_DOWN.load(Ordering::Relaxed),
                    editor_focused: false,
                    at_ms: now_ms(),
                    from_window: true,
                }, "window");
            }
            return 0;
        }
        DefSubclassProc(hwnd, message, wparam, lparam)
    }

    pub fn install_window_filter(window: &tauri::WebviewWindow) {
        let installed = window.hwnd().ok().is_some_and(|hwnd| unsafe {
            SetWindowSubclass(
                hwnd.0 as windows_sys::Win32::Foundation::HWND,
                Some(talkcraft_window_subclass),
                WINDOW_SUBCLASS_ID,
                0,
            ) != 0
        });
        if !installed {
            WINDOW_FILTER_FAILED.store(true, Ordering::SeqCst);
            record_diagnostic("window", "subclass_install_failed");
        } else {
            record_diagnostic("window", format!("subclass_installed; label={}", window.label()));
        }
    }

    pub fn initialize(app: &tauri::AppHandle) {
        let _ = EPOCH.set(Instant::now());
        let _ = APP.set(app.clone());
        let (sender, receiver) = mpsc::sync_channel::<QueuedInput>(256);
        let _ = EVENTS.set(sender);
        let (dispatch_sender, dispatch_receiver) = mpsc::sync_channel::<DispatchTask>(64);
        let _ = DISPATCHES.set(dispatch_sender);
        std::thread::spawn(move || run_dispatcher(dispatch_receiver));
        std::thread::spawn(move || run_consumer(receiver));

        let listener = app.clone();
        std::thread::spawn(move || unsafe {
            use std::{os::windows::ffi::OsStrExt, path::PathBuf};
            let dll_path: PathBuf = match std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|parent| parent.join("TalkCraftKeyboardHook.dll")))
            {
                Some(path) => path,
                None => {
                    record_diagnostic("hook", "installation_failed; reason=executable_path_unavailable");
                    std::thread::spawn(move || crate::shortcuts::set_hook_status(&listener, "键盘钩子初始化失败，无法定位钩子组件"));
                    return;
                }
            };
            let wide_path = dll_path.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
            let module: HMODULE = LoadLibraryW(wide_path.as_ptr());
            if module.is_null() {
                let error = GetLastError() as u64;
                HOOK_INSTALL_ERROR.store(error, Ordering::Release);
                record_diagnostic("hook", format!("dll_load_failed; win32_error={error}"));
                std::thread::spawn(move || crate::shortcuts::set_hook_status(&listener, "键盘钩子组件加载失败，RightAlt自定义快捷键不可用"));
                return;
            }
            HOOK_DLL_LOADED.store(true, Ordering::Release);
            let callback_setter = GetProcAddress(module, b"talkcraft_set_host_callback\0".as_ptr());
            let hook_entry = GetProcAddress(module, b"talkcraft_keyboard_hook\0".as_ptr());
            let (Some(callback_setter), Some(hook_entry)) = (callback_setter, hook_entry) else {
                let error = GetLastError() as u64;
                HOOK_INSTALL_ERROR.store(error, Ordering::Release);
                record_diagnostic("hook", format!("dll_export_missing; win32_error={error}"));
                FreeLibrary(module);
                HOOK_DLL_LOADED.store(false, Ordering::Release);
                std::thread::spawn(move || crate::shortcuts::set_hook_status(&listener, "键盘钩子组件不完整，RightAlt自定义快捷键不可用"));
                return;
            };
            let set_host_callback: unsafe extern "system" fn(usize) = std::mem::transmute(callback_setter);
            set_host_callback(host_hook_callback as *const () as usize);
            let hook_proc: HOOKPROC = Some(std::mem::transmute(hook_entry));
            // A desktop-wide hook (dwThreadId=0) must use a DLL-resident hook
            // procedure. Passing the executable module can return a handle but
            // leaves the callback path unsupported and silent on real input.
            let handle = SetWindowsHookExW(WH_KEYBOARD_LL, hook_proc, module, 0);
            if handle.is_null() {
                let error = GetLastError() as u64;
                HOOK_INSTALL_ERROR.store(error, Ordering::Release);
                record_diagnostic("hook", format!("installation_failed; win32_error={error}"));
                FreeLibrary(module);
                HOOK_DLL_LOADED.store(false, Ordering::Release);
                std::thread::spawn(move || crate::shortcuts::set_hook_status(&listener, "键盘钩子安装失败，RightAlt自定义快捷键不可用"));
                return;
            }
            HOOK_INSTALLED.store(true, Ordering::Release);
            let status = if WINDOW_FILTER_FAILED.load(Ordering::SeqCst) {
                "窗口菜单拦截安装失败；全局键盘钩子已安装"
            } else {
                "窗口菜单拦截与全局键盘钩子已安装"
            };
            record_diagnostic("hook", "installed_from_dll; waiting_for_callback");
            std::thread::spawn(move || crate::shortcuts::set_hook_status(&listener, status));
            let mut message: MSG = std::mem::zeroed();
            while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            HOOK_INSTALLED.store(false, Ordering::Release);
            UnhookWindowsHookEx(handle);
            FreeLibrary(module);
            HOOK_DLL_LOADED.store(false, Ordering::Release);
            record_diagnostic("hook", "message_loop_stopped");
        });
    }

    fn run_consumer(receiver: Receiver<QueuedInput>) {
        let _ = EPOCH.set(Instant::now());
        CONSUMER_ACTIVE.store(true, Ordering::Release);
        record_diagnostic("consumer", "started; queue_capacity=256");
        let mut gesture = Gesture::default();
        let mut last_alt_space_action = None;
        loop {
            CONSUMER_LAST_ACTIVITY_MS.store(now_ms(), Ordering::Relaxed);
            match receiver.recv_timeout(std::time::Duration::from_millis(25)) {
                Ok(input) => process_input(input, &mut gesture, &mut last_alt_space_action),
                Err(mpsc::RecvTimeoutError::Timeout) => {},
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    record_diagnostic("consumer", "event_channel_disconnected");
                    CONSUMER_ACTIVE.store(false, Ordering::Release);
                    break;
                }
            }
            // Run gesture deadlines even while the input channel stays busy.
            // A stream of repeats or other configured keys must not postpone
            // the single-tap decision indefinitely.
            if let Some(ShortcutEffect::Binding(binding, at_ms)) = tick_effect(&mut gesture, now_ms()) {
                record_diagnostic("gesture", format!("binding_recognized; binding={binding}; source=timer"));
                dispatch(binding, at_ms, &mut last_alt_space_action);
            }
            if gesture.alt && now_ms().saturating_sub(gesture.alt_down_ms) > 30_000 {
                gesture.reset();
                record_diagnostic("gesture", "stale_key_state_timeout; reset");
            }
        }
    }

    pub fn metrics() -> serde_json::Value {
        let callback_count = HOOK_CALLS.load(Ordering::Relaxed);
        let last_callback_ms = LAST_CALLBACK_MS.load(Ordering::Relaxed);
        serde_json::json!({
            "available": true,
            "hookInstalled": HOOK_INSTALLED.load(Ordering::Acquire),
            "hookDllLoaded": HOOK_DLL_LOADED.load(Ordering::Acquire),
            "hookInstallError": HOOK_INSTALL_ERROR.load(Ordering::Acquire),
            "windowFilterFailed": WINDOW_FILTER_FAILED.load(Ordering::Acquire),
            "callbackCount": callback_count,
            "hookCallbackObserved": callback_count > 0,
            "callbackMaxMicros": HOOK_MAX_US.load(Ordering::Relaxed),
            "lastCallbackElapsedMs": last_callback_ms,
            "hookCallbackAgeMs": if callback_count == 0 { serde_json::Value::Null } else { serde_json::json!(now_ms().saturating_sub(last_callback_ms)) },
            "lastRelevantKeyElapsedMs": LAST_RELEVANT_KEY_MS.load(Ordering::Relaxed),
            "injectedInputsIgnored": INJECTED_INPUTS_IGNORED.load(Ordering::Relaxed),
            "eventsQueued": QUEUED_EVENTS.load(Ordering::Relaxed),
            "eventsDropped": DROPPED_EVENTS.load(Ordering::Relaxed),
            "eventsMissed": MISSED_EVENTS.load(Ordering::Relaxed),
            "consumerActive": CONSUMER_ACTIVE.load(Ordering::Acquire),
            "consumerLastActivityMs": CONSUMER_LAST_ACTIVITY_MS.load(Ordering::Relaxed),
            "dispatcherActive": DISPATCHER_ACTIVE.load(Ordering::Acquire),
            "dispatcherLastActivityMs": DISPATCHER_LAST_ACTIVITY_MS.load(Ordering::Relaxed),
            "dispatchesDropped": DISPATCHES_DROPPED.load(Ordering::Relaxed),
        })
    }

    #[cfg(test)]
    mod production_path_tests {
        use super::*;

        fn event(sequence: u64, key: u32, down: bool, at_ms: u64) -> QueuedInput {
            QueuedInput {
                sequence,
                input: ShortcutInput::Key { key, down, at_ms, from_window: false },
            }
        }

        fn apply_and_tick(
            queued: QueuedInput,
            gesture: &mut Gesture,
            last_alt_space_action: &mut Option<u64>,
            now_ms: u64,
        ) -> Vec<ShortcutEffect> {
            let mut effects = process_input_state(queued, gesture, last_alt_space_action);
            if let Some(effect) = tick_effect(gesture, now_ms) {
                effects.push(effect);
            }
            effects
        }

        #[test]
        fn production_input_processor_routes_alt_space_then_single_right_alt_to_stop_action() {
            let mut gesture = Gesture::default();
            let mut last_chord = None;
            let mut actions = Vec::new();
            for cycle in 0..20u64 {
                let start = cycle * 1_000;
                for queued in [
                    event(cycle * 4 + 1, 0xa5, true, start),
                    event(cycle * 4 + 2, 0x20, true, start + 10),
                    event(cycle * 4 + 3, 0x20, false, start + 20),
                    event(cycle * 4 + 4, 0xa5, false, start + 30),
                ] {
                    for effect in apply_and_tick(queued, &mut gesture, &mut last_chord, start + 30) {
                        if let ShortcutEffect::Binding(binding, _) = effect { actions.push(binding); }
                    }
                }
                for queued in [
                    event(cycle * 4 + 1, 0xa5, true, start + 400),
                    event(cycle * 4 + 2, 0xa5, false, start + 420),
                ] {
                    for effect in apply_and_tick(queued, &mut gesture, &mut last_chord, start + 420) {
                        if let ShortcutEffect::Binding(binding, _) = effect { actions.push(binding); }
                    }
                }
                for effect in [tick_effect(&mut gesture, start + 740)] .into_iter().flatten() {
                    if let ShortcutEffect::Binding(binding, _) = effect { actions.push(binding); }
                }
            }
            assert_eq!(actions.iter().filter(|action| **action == "RightAlt+Space").count(), 20);
            assert_eq!(actions.iter().filter(|action| **action == "RightAlt").count(), 20);
            assert_eq!(actions.len(), 40);
        }

        #[test]
        fn tap_deadline_is_checked_while_relevant_events_keep_arriving() {
            let mut gesture = Gesture::default();
            let mut last_chord = None;
            let _ = process_input_state(event(1, 0xa5, true, 0), &mut gesture, &mut last_chord);
            let _ = process_input_state(event(2, 0xa5, false, 20), &mut gesture, &mut last_chord);
            let mut recognized = Vec::new();
            for index in 0..24u64 {
                let at = 40 + index * 20;
                let _ = process_input_state(event(3 + index * 2, 0xa1, true, at), &mut gesture, &mut last_chord);
                if let Some(effect) = tick_effect(&mut gesture, at) { recognized.push(effect); }
                let _ = process_input_state(event(4 + index * 2, 0xa1, false, at + 1), &mut gesture, &mut last_chord);
                if let Some(effect) = tick_effect(&mut gesture, at + 1) { recognized.push(effect); }
            }
            assert_eq!(recognized, vec![ShortcutEffect::Binding("RightAlt", 340)]);
        }

        #[test]
        fn dispatch_enqueue_is_nonblocking_and_reports_full_queue() {
            let (sender, _receiver) = mpsc::sync_channel(1);
            assert!(try_queue_dispatch(&sender, DispatchTask::Binding("RightAlt")).is_ok());
            assert!(matches!(try_queue_dispatch(&sender, DispatchTask::Binding("RightAlt+Space")), Err(TrySendError::Full(_))));
        }
    }
}

#[cfg(windows)]
pub use platform::{initialize, install_window_filter};

#[cfg(not(windows))]
pub fn initialize(_: &tauri::AppHandle) {}

#[cfg(not(windows))]
pub fn install_window_filter(_: &tauri::WebviewWindow) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn complete_alt_space(gesture: &mut Gesture, start: u64, release_alt_first: bool) -> Vec<Option<&'static str>> {
        let mut actions = Vec::new();
        actions.push(gesture.feed(0xa5, true, start));
        actions.push(gesture.feed(0x20, true, start + 10));
        if release_alt_first {
            actions.push(gesture.feed(0xa5, false, start + 20));
            actions.push(gesture.feed(0x20, false, start + 30));
        } else {
            actions.push(gesture.feed(0x20, false, start + 20));
            actions.push(gesture.feed(0xa5, false, start + 30));
        }
        actions
    }

    #[test]
    fn right_alt_single_tap_waits_for_double_window_and_hold_opens_guide() {
        let mut gesture = Gesture::default();
        assert_eq!(gesture.feed(0xa5, true, 0), None);
        assert_eq!(gesture.tick(649), None);
        assert_eq!(gesture.feed(0xa5, false, 649), None);
        assert_eq!(gesture.tick(968), None);
        assert_eq!(gesture.tick(969), Some("RightAlt"));
        assert_eq!(gesture.feed(0xa5, true, 1000), None);
        assert_eq!(gesture.tick(1650), Some("__guide__"));
        assert_eq!(gesture.feed(0xa5, false, 1700), None);
    }

    #[test]
    fn right_alt_double_tap_triggers_prompt_without_single_tap() {
        let mut gesture = Gesture::default();
        assert_eq!(gesture.feed(0xa5, true, 0), None);
        assert_eq!(gesture.feed(0xa5, false, 40), None);
        assert_eq!(gesture.feed(0xa5, true, 150), None);
        assert_eq!(gesture.feed(0xa5, false, 190), Some("RightAltDouble"));
        assert_eq!(gesture.tick(600), None);
    }

    #[test]
    fn twenty_record_stop_cycles_remain_usable_with_both_release_orders() {
        for release_alt_first in [false, true] {
            let mut gesture = Gesture::default();
            let mut now = 0;
            for _ in 0..20 {
                let chord = complete_alt_space(&mut gesture, now, release_alt_first);
                assert_eq!(chord.iter().filter(|event| **event == Some("RightAlt+Space")).count(), 1);
                now += 500;
                assert_eq!(gesture.feed(0xa5, true, now), None);
                assert_eq!(gesture.feed(0xa5, false, now + 20), None);
                assert_eq!(gesture.tick(now + 340), Some("RightAlt"));
                now += 500;
            }
        }
    }

    #[test]
    fn modifier_repeats_do_not_repeat_chord_actions_and_cancel_resets_pending_tap() {
        let mut gesture = Gesture::default();
        assert_eq!(gesture.feed(0xa5, true, 0), None);
        assert_eq!(gesture.feed(0x20, true, 10), Some("RightAlt+Space"));
        assert_eq!(gesture.feed(0x20, true, 15), None);
        assert_eq!(gesture.feed(0x20, false, 20), None);
        assert_eq!(gesture.feed(0xa5, false, 25), None);
        gesture.reset();
        assert_eq!(gesture.tick(1000), None);
    }

    #[test]
    fn native_alt_space_menu_request_matches_only_space_key_menu_message() {
        assert!(is_alt_space_system_menu(MSG_WM_SYSCOMMAND, MSG_SC_KEYMENU as usize, VK_SPACE_CODE as isize));
        assert!(!is_alt_space_system_menu(MSG_WM_SYSCOMMAND, MSG_SC_KEYMENU as usize, 0));
        assert!(!is_alt_space_system_menu(MSG_WM_SYSCOMMAND, 0xF010, VK_SPACE_CODE as isize));
    }

    #[test]
    fn right_alt_release_order_and_mode_toggles_remain_distinct() {
        let mut gesture = Gesture::default();
        assert_eq!(complete_alt_space(&mut gesture, 0, true)[1], Some("RightAlt+Space"));
        assert_eq!(gesture.feed(0xa5, true, 400), None);
        assert_eq!(gesture.feed(0xa5, false, 420), None);
        assert_eq!(gesture.tick(740), Some("RightAlt"));
        assert_eq!(gesture.feed(0xa5, true, 1000), None);
        assert_eq!(gesture.feed(0xa1, true, 1010), Some("RightAlt+RightShift"));
        assert_eq!(gesture.feed(0xa1, false, 1020), None);
        assert_eq!(gesture.feed(0xa5, false, 1030), None);
    }
}
