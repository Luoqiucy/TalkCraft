#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use tauri::Manager;
mod shortcuts;
mod right_keys;
mod output_target;
mod output_text;
mod windows_input;
mod single_instance;
mod desktop_shutdown;
mod tray;
mod clipboard;
mod file_export;
mod external_links;
mod runtime_paths;
static EXIT_REQUESTED:std::sync::atomic::AtomicBool=std::sync::atomic::AtomicBool::new(false);

fn startup_error(message:&str){
    if let Ok(directory)=runtime_paths::state_dir(){let _=std::fs::create_dir_all(&directory);let _=std::fs::write(directory.join("startup-error.txt"),message);}
    eprintln!("TalkCraft 启动失败：{message}");
    #[cfg(windows)]unsafe{
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW,MB_ICONERROR,MB_OK};
        let title:Vec<u16>="TalkCraft 启动失败".encode_utf16().chain(Some(0)).collect();
        let body:Vec<u16>=message.encode_utf16().chain(Some(0)).collect();
        MessageBoxW(std::ptr::null_mut(),body.as_ptr(),title.as_ptr(),MB_OK|MB_ICONERROR);
    }
}

fn close_hides_window(label:&str)->bool{matches!(label,"main"|"hud"|"keymap"|"chat")}
fn panel_can_open_main(requester:&str,panel:&str)->bool{requester==panel&&matches!(panel,"keymap"|"chat")}
pub fn set_aux_visible<R:tauri::Runtime>(app:&tauri::AppHandle<R>,label:&str,visible:bool)->Result<(),tauri::Error>{
    if !matches!(label,"keymap"|"chat"){return Ok(());}
    if let Some(panel)=app.get_webview_window(label){if visible{panel.center().and_then(|_|panel.show()).and_then(|_|panel.set_focus())}else{panel.hide()}}else{Ok(())}
}
pub fn set_hud_visible<R:tauri::Runtime>(hud:&tauri::WebviewWindow<R>,visible:bool)->Result<(),tauri::Error>{
    hud.eval(if visible{"document.documentElement.dataset.hudPaused='false';"}else{"document.documentElement.dataset.hudPaused='true';"})?;
    if visible{hud.show()}else{hud.hide()}
}
pub fn toggle_hud<R:tauri::Runtime>(hud:&tauri::WebviewWindow<R>)->Result<(),tauri::Error>{set_hud_visible(hud,!hud.is_visible()?)}
#[tauri::command]
fn desktop_exit(window:tauri::WebviewWindow)->Result<(),String>{
    if window.label()!="main"{return Err("仅工作台可退出软件".into());}
    exit_application(window.app_handle());Ok(())
}
fn set_exit_windows_visible(app:&tauri::AppHandle,visible:bool){
    for window in app.webview_windows().values(){if visible{let _=window.show();}else{let _=window.hide();}}
}
#[tauri::command]
fn desktop_prepare_exit(window:tauri::WebviewWindow)->Result<(),String>{
    if window.label()!="main"{return Err("仅工作台可准备退出".into());}
    set_exit_windows_visible(window.app_handle(),false);Ok(())
}
#[tauri::command]
fn desktop_restore_after_exit_failure(window:tauri::WebviewWindow)->Result<(),String>{
    if window.label()!="main"{return Err("仅工作台可恢复退出界面".into());}
    window.show().map_err(|error|error.to_string())?;window.set_focus().map_err(|error|error.to_string())
}
pub fn exit_application(app:&tauri::AppHandle){
    if EXIT_REQUESTED.swap(true,std::sync::atomic::Ordering::SeqCst){return;}
    // Hide immediately after the user confirms exit; keep WebViews alive until
    // the authenticated shutdown request is acknowledged.
    set_exit_windows_visible(app,false);
    let app=app.clone();std::thread::spawn(move||{
        desktop_shutdown::finish_exit(desktop_shutdown::stop_service,|warning|{
        if let Some(error)=warning{
            if let Ok(directory)=runtime_paths::state_dir(){let _=std::fs::create_dir_all(&directory);let _=std::fs::write(directory.join("last-exit-warning.txt"),format!("应用退出，后台关闭未确认：{error}"));}
        }
        // A legacy or unavailable service must never trap the user in the app.
        app.exit(0);
        });
    });
}
#[tauri::command]
fn desktop_minimize(window:tauri::WebviewWindow)->Result<(),String>{if window.label()!="main"{return Err("仅工作台可最小化".into());}window.hide().map_err(|e|e.to_string())}
#[tauri::command]
fn hud_interactive(window:tauri::WebviewWindow,interactive:bool)->Result<(),String>{if window.label()!="hud"{return Err("仅悬浮窗可切换交互".into());}window.set_focusable(interactive).map_err(|e|e.to_string())}

fn valid_hud_regions(regions:&[Vec<f64>])->bool{
    !regions.is_empty()&&regions.len()<=8&&regions.iter().all(|r|r.len()==5&&r.iter().all(|v|v.is_finite())&&r[0]>=0.0&&r[1]>=0.0&&r[2]>r[0]&&r[3]>r[1]&&r[2]<=2000.0&&r[3]<=2000.0&&r[4]>=0.0&&r[4]<=100.0)
}
#[tauri::command]
fn hud_hit_regions(window:tauri::WebviewWindow,regions:Vec<Vec<f64>>)->Result<(),String>{
    if window.label()!="hud"{return Err("仅悬浮窗可设置命中区域".into());}
    if !valid_hud_regions(&regions){return Err("悬浮窗命中区域无效".into());}
    #[cfg(windows)]unsafe{
        use windows_sys::Win32::Graphics::Gdi::{CombineRgn,CreateRectRgn,CreateRoundRectRgn,DeleteObject,SetWindowRgn,RGN_OR};
        let scale=window.scale_factor().map_err(|e|e.to_string())?;
        let combined=CreateRectRgn(0,0,0,0);if combined.is_null(){return Err("无法创建悬浮窗命中区域".into());}
        for r in regions{
            let px=|v:f64|(v*scale).round() as i32;
            let part=CreateRoundRectRgn(px(r[0]),px(r[1]),px(r[2]),px(r[3]),px(r[4]),px(r[4]));
            if part.is_null(){DeleteObject(combined);return Err("无法创建悬浮窗局部区域".into());}
            CombineRgn(combined,combined,part,RGN_OR);DeleteObject(part);
        }
        let hwnd=window.hwnd().map_err(|e|e.to_string())?;
        if SetWindowRgn(hwnd.0 as windows_sys::Win32::Foundation::HWND,combined,1)==0{DeleteObject(combined);return Err("无法应用悬浮窗命中区域".into());}
    }
    Ok(())
}

#[tauri::command]
fn hud_window(window: tauri::WebviewWindow, action: String) -> Result<(), String> {
    if window.label() != "main" && window.label() != "hud" {
        return Err("不允许的窗口".into());
    }
    let hud = window.app_handle().get_webview_window("hud").ok_or("悬浮窗未创建")?;
    match action.as_str() {
        "show" => set_hud_visible(&hud,true),
        "toggle" => toggle_hud(&hud),
        "hide" => set_hud_visible(&hud,false),
        "drag" if window.label() == "hud" => hud.start_dragging(),
        "main" => {
            let main = window.app_handle().get_webview_window("main").ok_or("工作台未打开")?;
            main.show().and_then(|_| main.unminimize()).and_then(|_| main.set_focus())
        },
        "compact" => hud.set_size(tauri::LogicalSize::new(480.0, 52.0)),
        "expand" => hud.set_size(tauri::LogicalSize::new(480.0, 132.0)),
        _ => return Err("不允许的悬浮窗操作".into()),
    }.map_err(|error| error.to_string())
}

#[tauri::command]
fn panel_window(window:tauri::WebviewWindow,panel:String,action:String)->Result<(),String>{
    if !matches!(window.label(),"main"|"hud"|"keymap"|"chat")||!matches!(panel.as_str(),"keymap"|"chat"){return Err("不允许的独立窗口操作".into());}
    let target=window.app_handle().get_webview_window(&panel).ok_or("独立窗口未创建")?;
    match action.as_str(){"show"=>set_aux_visible(window.app_handle(),&panel,true),"hide"=>set_aux_visible(window.app_handle(),&panel,false),"drag" if window.label()==panel=>target.start_dragging(),"main" if panel_can_open_main(window.label(),&panel)=>{let main=window.app_handle().get_webview_window("main").ok_or("工作台未打开")?;main.show().and_then(|_|main.unminimize()).and_then(|_|main.set_focus())},_=>return Err("不允许的独立窗口操作".into())}.map_err(|error|error.to_string())
}

fn main() {
    #[cfg(any(windows,target_os="macos"))]
    let _instance = match single_instance::acquire() {
        Ok(Some(guard)) => guard,
        Ok(None) => {single_instance::show_existing(); return;},
        Err(error) => {startup_error(&error);return;},
    };
    let application=tauri::Builder::default()
        .on_window_event(|window,event|{
            if let tauri::WindowEvent::CloseRequested{api,..}=event{
                if close_hides_window(window.label()){
                    api.prevent_close();
                    if window.label()=="main"{if let Some(main)=window.app_handle().get_webview_window("main"){let _=main.eval("window.dispatchEvent(new Event('talkcraft-close-request')); ");}}
                    else{let _=window.hide();}
                }
            }
        })
        .manage(shortcuts::state())
        .manage(output_target::state())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
            shortcuts::trigger(app, shortcut, event.state());
        }).build())
        .setup(|app| {
            desktop_shutdown::ensure_service().map_err(std::io::Error::other)?;
            shortcuts::initialize(app.handle());
            right_keys::initialize(app.handle());
            for config in &app.config().app.windows {
                let builder=tauri::WebviewWindowBuilder::from_config(app.handle(), config)?;
                #[cfg(windows)]let builder=builder.additional_browser_args("--autoplay-policy=no-user-gesture-required");
                #[cfg(target_os="macos")]let builder=if config.label=="hud"{builder.visible(false)}else{builder};
                let window=builder
                    .initialization_script(format!("window.__TALKCRAFT_SESSION__={};window.__TALKCRAFT_FLUID__=true;", std::process::id()))
                    .build()?;
                right_keys::install_window_filter(&window);
            }
            tray::initialize(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![file_export::file_export, external_links::open_external_url, hud_window, panel_window, hud_interactive, hud_hit_regions, clipboard::clipboard_write, desktop_prepare_exit, desktop_restore_after_exit_failure, desktop_exit, desktop_minimize, shortcuts::shortcuts_read, shortcuts::shortcuts_editor_focus, shortcuts::shortcuts_save, right_keys::shortcuts_diagnostics, right_keys::shortcuts_diagnostic_frontend, output_target::output_target, output_target::output_preflight, output_target::output_send, output_target::output_send_current, output_text::output_preview])
        .build(tauri::generate_context!());
    match application{
        Ok(application)=>application.run(|_app,_event|{
            #[cfg(target_os="macos")]
            match _event{
                tauri::RunEvent::ExitRequested{api,..} if !EXIT_REQUESTED.load(std::sync::atomic::Ordering::SeqCst)=>{
                    api.prevent_exit();
                    if let Some(main)=_app.get_webview_window("main"){let _=main.show();let _=main.set_focus();let _=main.eval("window.dispatchEvent(new CustomEvent('talkcraft-close-request',{detail:{force:true}}));");}
                },
                tauri::RunEvent::Reopen{..}=>{if let Some(main)=_app.get_webview_window("main"){let _=main.show();let _=main.set_focus();}},
                _=>{}
            }
        }),
        Err(error)=>startup_error(&error.to_string())
    }
}

#[cfg(test)]mod lifecycle_tests{
    #[test]fn close_preserves_reusable_windows(){for label in ["main","hud","keymap","chat"]{assert!(super::close_hides_window(label));}assert!(!super::close_hides_window("other"));}
    #[test]fn hud_regions_are_bounded(){assert!(super::valid_hud_regions(&[vec![10.0,20.0,210.0,70.0,25.0]]));assert!(!super::valid_hud_regions(&[]));assert!(!super::valid_hud_regions(&[vec![0.0,0.0,3000.0,10.0,2.0]]));assert!(!super::valid_hud_regions(&[vec![20.0,0.0,10.0,10.0,2.0]]));}
    #[test]fn independent_panel_may_restore_main_only_for_itself(){assert!(super::panel_can_open_main("chat","chat"));assert!(!super::panel_can_open_main("hud","chat"));assert!(!super::panel_can_open_main("chat","keymap"));}
}


