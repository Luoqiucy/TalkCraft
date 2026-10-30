use tauri::{Manager,menu::{Menu,MenuItem},tray::{TrayIconBuilder,TrayIconEvent,MouseButton,MouseButtonState}};
fn show_main(app:&tauri::AppHandle){if let Some(main)=app.get_webview_window("main"){let _=main.show();let _=main.unminimize();let _=main.set_focus();}}
pub fn initialize(app:&tauri::AppHandle)->tauri::Result<()>{
 let open=MenuItem::with_id(app,"open","打开工作台",true,None::<&str>)?;
 let hud=MenuItem::with_id(app,"hud","显示 / 隐藏悬浮条",true,None::<&str>)?;
 let exit=MenuItem::with_id(app,"exit","退出程序…",true,None::<&str>)?;
 let direct=MenuItem::with_id(app,"direct-exit","直接退出（中断录音与任务）",true,None::<&str>)?;
 let menu=Menu::with_items(app,&[&open,&hud,&exit,&direct])?;
 let icon=app.default_window_icon().ok_or_else(||tauri::Error::Io(std::io::Error::other("应用图标缺失，无法创建托盘")))?.clone();
 TrayIconBuilder::with_id("talkcraft").icon(icon).tooltip("TalkCraft · 语音助手").menu(&menu).show_menu_on_left_click(false)
 .on_tray_icon_event(|tray,event|{if matches!(event,TrayIconEvent::Click{button:MouseButton::Left,button_state:MouseButtonState::Up,..}){show_main(tray.app_handle());}})
 .on_menu_event(|app,event|match event.id.as_ref(){
  "open"=>show_main(app),
  "hud"=>{if let Some(hud)=app.get_webview_window("hud"){let _=crate::toggle_hud(&hud);}},
  "exit"=>{show_main(app);if let Some(main)=app.get_webview_window("main"){if main.eval("window.dispatchEvent(new CustomEvent('talkcraft-close-request',{detail:{force:true}}));").is_err(){crate::exit_application(app);}}},
  "direct-exit"=>crate::exit_application(app),_=>{}
 }).build(app)?;
 Ok(())
}
