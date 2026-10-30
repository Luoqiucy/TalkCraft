use std::{collections::{BTreeMap, HashSet}, str::FromStr, sync::Mutex};
use tauri::{Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
pub type Bindings = BTreeMap<String, String>;
pub struct Settings {pub bindings: Bindings, pub revision: u64, pub status: String, pub hook_status: String, pub load_error: Option<String>}
pub struct ShortcutSettings(pub Mutex<Settings>);
fn defaults() -> Bindings {[("dictation","RightAlt"),("chat","RightAlt+Space"),("translate","RightAlt+RightShift"),("prompt","RightAltDouble"),("process","Alt+Shift+Enter"),("hud","Alt+Shift+M")].into_iter().map(|(a,b)|(a.into(),b.into())).collect()}
pub fn state() -> ShortcutSettings {ShortcutSettings(Mutex::new(Settings{bindings:defaults(),revision:0,status:"尚未注册".into(),hook_status:"Windows键盘监听正在启动".into(),load_error:None}))}
pub fn validate(input: &Bindings) -> Result<Vec<Shortcut>, String> {
 let expected=defaults();if input.len()!=expected.len()||input.keys().any(|key|!expected.contains_key(key)){return Err("快捷键功能列表无效".into());}
 let mut ids=HashSet::new();let mut custom=HashSet::new();let mut parsed=Vec::new();
 for (action,value) in input {if value.is_empty(){continue;}
 if crate::right_keys::is_custom(value){if !matches!(action.as_str(),"dictation"|"translate"|"chat"|"prompt"){return Err("此特殊组合仅用于录音模式".into());}if !custom.insert(value.clone()){return Err("两个功能不能使用相同快捷键".into());}continue;}
 if value.len()>80{return Err(format!("{}快捷键过长",action));}
 let shortcut=Shortcut::from_str(value).map_err(|_|format!("{}快捷键格式无效",action))?;
 if !ids.insert(shortcut.id()){return Err("两个功能不能使用相同快捷键".into());}parsed.push(shortcut);}
 if custom.contains("Alt+Space")&&custom.contains("RightAlt+Space"){return Err("Alt+Space 与 RightAlt+Space 会同时触发，请为两个功能选择不同组合".into());}
 Ok(parsed)
}
fn path<R:Runtime>(app:&tauri::AppHandle<R>)->Result<std::path::PathBuf,String>{Ok(app.path().app_config_dir().map_err(|_|"无法读取配置目录")?.join("shortcuts.json"))}
pub fn initialize<R:Runtime>(app:&tauri::AppHandle<R>){
 let managed=app.state::<ShortcutSettings>();let mut state=managed.0.lock().unwrap();
 let read=path(app).and_then(|p|match std::fs::read(p){Ok(bytes)=>serde_json::from_slice::<Bindings>(&bytes).map_err(|_|"快捷键文件损坏，请保留文件并检查".into()),Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(defaults()),Err(_)=>Err("无法读取快捷键文件".into())});
 match read.and_then(|mut bindings|{if bindings.get("prompt").is_some_and(|value|value=="Alt+Shift+4"){bindings.insert("prompt".into(),"RightAltDouble".into());}validate(&bindings)?;Ok(bindings)}){Ok(bindings)=>state.bindings=bindings,Err(error)=>{state.load_error=Some(error);return;}}
 crate::right_keys::update_bindings(&state.bindings);
 let mut failed=Vec::new();for(action,value) in &state.bindings {if value.is_empty()||crate::right_keys::is_custom(value){continue;}let shortcut=Shortcut::from_str(value).unwrap();if app.global_shortcut().register(shortcut).is_err(){failed.push(action.clone());crate::right_keys::record_shortcut_diagnostic("global_shortcut",format!("registration_failed; action={action}; binding={value}"));}else{crate::right_keys::record_shortcut_diagnostic("global_shortcut",format!("registered; action={action}; binding={value}"));}}
 state.status=shortcut_status(&state.bindings,&failed);
}
fn shortcut_status(bindings:&Bindings,failed:&[String])->String{
 let mut parts=Vec::new();
 if !failed.is_empty(){parts.push(format!("以下快捷键注册失败（可能被其他应用占用）：{}",failed.join("、")));}
 if bindings.values().any(|value|value=="Alt+Space"){parts.push("Alt+Space 在 TalkCraft 窗口前台时优先触发；其他应用保留 Windows 系统菜单".into());}
 if parts.is_empty(){"全局快捷键已启用".into()}else{parts.join("；")}
}
fn display_status(state:&Settings)->String{if state.hook_status.is_empty(){state.status.clone()}else{format!("{}；{}",state.status,state.hook_status)}}
pub fn set_hook_status<R:Runtime>(app:&tauri::AppHandle<R>,status:&str){if let Ok(mut state)=app.state::<ShortcutSettings>().0.lock(){state.hook_status=status.into();let message=display_status(&state);drop(state);if let Some(main)=app.get_webview_window("main"){let _=main.eval(&format!("window.dispatchEvent(new CustomEvent('talkcraft-shortcuts-status',{{detail:{}}}));",serde_json::to_string(&message).unwrap()));}}}
#[tauri::command]
pub fn shortcuts_read(window:tauri::WebviewWindow)->Result<serde_json::Value,String>{
 if window.label()!="main"{return Err("仅工作台可读取快捷键".into());}
 let managed=window.state::<ShortcutSettings>();let state=managed.0.lock().map_err(|_|"配置正在恢复")?;
 if let Some(error)=&state.load_error{return Err(error.clone());}
 Ok(serde_json::json!({"bindings":state.bindings,"revision":state.revision,"status":display_status(&state)}))
}
#[tauri::command]
pub fn shortcuts_editor_focus(window:tauri::WebviewWindow,focused:bool)->Result<(),String>{
 if window.label()!="main"{return Err("仅工作台可切换快捷键编辑状态".into());}
 crate::right_keys::set_shortcut_editor_focused(focused);
 Ok(())
}
#[tauri::command]
pub fn shortcuts_save(window:tauri::WebviewWindow, bindings:Bindings, revision:u64)->Result<serde_json::Value,String>{
 if window.label()!="main"{return Err("仅工作台可修改快捷键".into());}
 let desired=validate(&bindings)?;let app=window.app_handle();let managed=app.state::<ShortcutSettings>();let mut state=managed.0.lock().map_err(|_|"配置正在恢复")?;
 if let Some(error)=&state.load_error{return Err(error.clone());}if revision!=state.revision{return Err("配置已变化，请重新读取后保存".into());}
 let old=validate(&state.bindings)?;let old_ids:HashSet<_>=old.iter().map(|s|s.id()).collect();
 let mut staged=Vec::new();
 for shortcut in &desired {if old_ids.contains(&shortcut.id()) && app.global_shortcut().is_registered(shortcut.clone()){continue;}
 if app.global_shortcut().register(shortcut.clone()).is_err(){crate::right_keys::record_shortcut_diagnostic("global_shortcut",format!("registration_failed_during_save; binding={}",shortcut));for item in staged{let _=app.global_shortcut().unregister(item);}return Err("快捷键注册失败，可能被其他应用占用；原配置保留".into());}crate::right_keys::record_shortcut_diagnostic("global_shortcut",format!("registered_during_save; binding={}",shortcut));staged.push(shortcut.clone());}
 let saved=(||{let p=path(app)?;std::fs::create_dir_all(p.parent().unwrap()).map_err(|_|"无法创建配置目录")?;let temp=p.with_extension("json.tmp");std::fs::write(&temp,serde_json::to_vec_pretty(&bindings).unwrap()).map_err(|_|"无法写入快捷键配置")?;std::fs::rename(&temp,&p).map_err(|_|"无法保存快捷键配置")?;Ok::<_,String>(())})();
 if let Err(error)=saved{for item in staged{let _=app.global_shortcut().unregister(item);}return Err(error);}
 let ids:HashSet<_>=desired.iter().map(|s|s.id()).collect();for shortcut in old{if !ids.contains(&shortcut.id()){let _=app.global_shortcut().unregister(shortcut.clone());crate::right_keys::record_shortcut_diagnostic("global_shortcut",format!("unregistered_during_save; binding={shortcut}"));}}
 state.bindings=bindings;crate::right_keys::update_bindings(&state.bindings);state.revision+=1;state.status=shortcut_status(&state.bindings,&[]);
 Ok(serde_json::json!({"bindings":state.bindings,"revision":state.revision,"status":display_status(&state)}))
}
fn action_for_shortcut(bindings:&Bindings,shortcut_id:u32)->Option<String>{
 bindings.iter().find_map(|(action,value)|Shortcut::from_str(value).ok().filter(|candidate|candidate.id()==shortcut_id).map(|_|action.clone()))
}
pub fn trigger<R:Runtime>(app:&tauri::AppHandle<R>,shortcut:&Shortcut,event:ShortcutState){
 if event!=ShortcutState::Pressed{crate::right_keys::record_shortcut_diagnostic("global_shortcut",format!("callback_ignored_release; shortcut_id={}",shortcut.id()));return;}
 crate::right_keys::record_shortcut_diagnostic("global_shortcut",format!("callback_pressed; shortcut_id={}",shortcut.id()));
 let managed=app.state::<ShortcutSettings>();let state=managed.0.lock().unwrap();
 let action=action_for_shortcut(&state.bindings,shortcut.id());drop(state);
 if let Some(action)=action{
  crate::right_keys::record_shortcut_diagnostic("global_shortcut",format!("action_matched; action={action}"));
  let scheduler=app.clone();
  let app=app.clone();
  if action=="hud"{
   let schedule=scheduler.run_on_main_thread(move||{if let Some(hud)=app.get_webview_window("hud"){match crate::toggle_hud(&hud){Ok(())=>crate::right_keys::record_shortcut_diagnostic("global_shortcut","hud_action_dispatched"),Err(_)=>crate::right_keys::record_shortcut_diagnostic("global_shortcut","hud_action_failed")}}else{crate::right_keys::record_shortcut_diagnostic("global_shortcut","hud_window_unavailable");}});
   crate::right_keys::record_shortcut_diagnostic("global_shortcut",if schedule.is_ok(){"hud_action_scheduled"}else{"hud_action_schedule_failed"});
   return;
  }
  let action_for_log=action.clone();
  let schedule=scheduler.run_on_main_thread(move||{
   crate::output_target::capture(&app);
   if let Some(main)=app.get_webview_window("main"){
    let detail=serde_json::json!({"action":action});
    let script=format!("window.dispatchEvent(new CustomEvent('talkcraft-shortcut',{{detail:{detail}}}));");
    match main.eval(&script){Ok(())=>crate::right_keys::record_shortcut_diagnostic("global_shortcut",format!("action_dispatched; action={action}")),Err(_)=>crate::right_keys::record_shortcut_diagnostic("global_shortcut",format!("action_delivery_failed; action={action}"))}
   }else{crate::right_keys::record_shortcut_diagnostic("global_shortcut","main_window_unavailable");}
  });
  crate::right_keys::record_shortcut_diagnostic("global_shortcut",if schedule.is_ok(){format!("action_scheduled; action={action_for_log}")}else{format!("action_schedule_failed; action={action_for_log}")});
 }else{crate::right_keys::record_shortcut_diagnostic("global_shortcut",format!("callback_unmapped; shortcut_id={}",shortcut.id()));}
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn global_plugin_callback_maps_registered_shortcuts_back_to_the_saved_action(){let bindings=defaults();for (action,binding) in [("process","Alt+Shift+Enter"),("hud","Alt+Shift+M")]{let parsed=Shortcut::from_str(binding).unwrap();assert_eq!(action_for_shortcut(&bindings,parsed.id()).as_deref(),Some(action));}let unrelated=Shortcut::from_str("Ctrl+Shift+K").unwrap();assert_eq!(action_for_shortcut(&bindings,unrelated.id()),None);}
 #[test]fn custom_bindings_can_be_reassigned_disabled_and_reloaded(){
  let mut v=defaults();v.insert("dictation".into(),"Ctrl+Shift+K".into());v.insert("chat".into(),"RightAlt".into());v.insert("translate".into(),"".into());assert_eq!(validate(&v).unwrap().len(),3);
  let bytes=serde_json::to_vec(&v).unwrap();let reloaded:Bindings=serde_json::from_slice(&bytes).unwrap();assert_eq!(reloaded,v);assert!(validate(&reloaded).is_ok());
  v.insert("prompt".into(),"RightAlt".into());assert!(validate(&v).is_err());
 }
 #[test]fn single_keys_and_combinations_are_supported(){let mut v=defaults();for key in ["A","5","F8","Space","Shift+A","Ctrl+K","Alt+5","Ctrl+Shift+A"]{v.insert("chat".into(),key.into());assert!(validate(&v).is_ok(),"{} should be accepted",key);}}
 #[test]fn defaults_valid(){assert_eq!(validate(&defaults()).unwrap().len(),2);}
 #[test]fn duplicates_aliases_rejected(){let mut v=defaults();v.insert("chat".into(),"RightAlt".into());assert!(validate(&v).is_err());v.insert("dictation".into(),"Ctrl+Shift+A".into());v.insert("chat".into(),"Control+Shift+A".into());assert!(validate(&v).is_err());}
 #[test]fn reserved_alt_space_is_app_scoped_and_cannot_overlap_right_alt_space(){let mut v=defaults();v.insert("chat".into(),"Alt+Space".into());assert!(validate(&v).is_ok());assert_eq!(shortcut_status(&v,&[]),"Alt+Space 在 TalkCraft 窗口前台时优先触发；其他应用保留 Windows 系统菜单");v.insert("dictation".into(),"RightAlt+Space".into());assert!(validate(&v).unwrap_err().contains("同时触发"));}
 #[test]fn shortcut_status_keeps_keyboard_hook_installation_result_visible(){let failed=Settings{bindings:defaults(),revision:0,status:"全局快捷键已启用".into(),hook_status:"键盘钩子安装失败，RightAlt/Alt+Space自定义快捷键不可用".into(),load_error:None};assert!(display_status(&failed).contains("键盘钩子安装失败"));let ready=Settings{hook_status:"Windows全局键盘钩子已安装".into(),..failed};assert!(display_status(&ready).contains("Windows全局键盘钩子已安装"));}
 #[test]fn disable_and_invalid(){let mut v=defaults();v.insert("chat".into(),"".into());assert_eq!(validate(&v).unwrap().len(),2);v.insert("chat".into(),"A".into());assert!(validate(&v).is_ok());v.insert("chat".into(),"Ctrl+InvalidKey".into());assert!(validate(&v).is_err());v.remove("hud");assert!(validate(&v).is_err());}
}

