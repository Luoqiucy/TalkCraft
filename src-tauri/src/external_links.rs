fn valid_external_url(value: &str) -> Result<tauri::Url, String> {
    if value.len() > 4096 { return Err("链接过长，无法打开".into()); }
    let parsed = tauri::Url::parse(value).map_err(|_| "来源链接无效".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("仅允许打开无凭据的网页链接".into());
    }
    Ok(parsed)
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let target = valid_external_url(&url)?;
    #[cfg(windows)] {
        use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
        let verb: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
        let wide: Vec<u16> = target.as_str().encode_utf16().chain(Some(0)).collect();
        let result = unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), wide.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) };
        if result as isize <= 32 { return Err("系统默认浏览器未能打开链接".into()); }
    }
    #[cfg(not(windows))] {
        let program = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(program).arg(target.as_str()).spawn().map_err(|_| "系统默认浏览器未能打开链接".to_string())?;
    }
    Ok(())
}

#[cfg(test)] mod tests {
    use super::valid_external_url;
    #[test] fn permits_public_web_links_only() {
        assert!(valid_external_url("https://example.com/article?q=weather").is_ok());
        for value in ["javascript:alert(1)", "file:///etc/hosts", "https://user:pass@example.com", "not a url"] {
            assert!(valid_external_url(value).is_err(), "{value}");
        }
    }
}
