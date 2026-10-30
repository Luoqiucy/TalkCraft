//! Minimal DLL entry point for the desktop-wide WH_KEYBOARD_LL hook.
//!
//! Windows requires a DLL hook procedure when `SetWindowsHookEx` is installed
//! with `dwThreadId = 0`. Low-level keyboard hooks are called back on the
//! installing thread, so the DLL forwards the callback to TalkCraft's host
//! callback in that same process. The host callback only updates atomics and
//! queues a small event; it does not call the UI or block on I/O.

#[cfg(windows)]
mod windows_hook {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use windows_sys::Win32::{
        Foundation::{LPARAM, LRESULT, WPARAM},
        UI::WindowsAndMessaging::CallNextHookEx,
    };

    type HostCallback = unsafe extern "system" fn(i32, WPARAM, LPARAM) -> LRESULT;
    static HOST_CALLBACK: AtomicUsize = AtomicUsize::new(0);

    /// Registers the callback hosted by TalkCraft.exe.
    ///
    /// # Safety
    /// `callback` must be a valid function pointer for the lifetime of the
    /// installed hook and must use the system ABI declared by `HostCallback`.
    #[no_mangle]
    pub unsafe extern "system" fn talkcraft_set_host_callback(callback: usize) {
        HOST_CALLBACK.store(callback, Ordering::Release);
    }

    /// DLL-resident procedure required by the desktop-wide keyboard hook.
    #[no_mangle]
    pub unsafe extern "system" fn talkcraft_keyboard_hook(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code < 0 {
            return CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam);
        }

        let callback = HOST_CALLBACK.load(Ordering::Acquire);
        if callback == 0 {
            return CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam);
        }

        let callback: HostCallback = std::mem::transmute(callback);
        let result = callback(code, wparam, lparam);
        if result < 0 {
            CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
        } else {
            result
        }
    }
}

#[cfg(windows)]
pub use windows_hook::{talkcraft_keyboard_hook, talkcraft_set_host_callback};

#[cfg(all(test, windows))]
mod tests {
    use super::{talkcraft_keyboard_hook, talkcraft_set_host_callback};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static CALLBACK_COUNT: AtomicUsize = AtomicUsize::new(0);

    unsafe extern "system" fn consume_event(_: i32, _: usize, _: isize) -> isize {
        CALLBACK_COUNT.fetch_add(1, Ordering::Relaxed);
        1
    }

    #[test]
    fn dll_hook_forwards_to_host_and_preserves_consumption_result() {
        CALLBACK_COUNT.store(0, Ordering::Relaxed);
        unsafe {
            talkcraft_set_host_callback(consume_event as *const () as usize);
            let result = talkcraft_keyboard_hook(0, 0, 0);
            talkcraft_set_host_callback(0);
            assert_eq!(result, 1);
        }
        assert_eq!(CALLBACK_COUNT.load(Ordering::Relaxed), 1);
    }
}
