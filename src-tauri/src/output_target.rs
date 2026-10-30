use std::sync::Mutex;
use tauri::Manager;
#[derive(Clone, Copy, Default)]
pub struct Target {handle:isize,process:u32,revision:u64}
pub struct OutputTarget(pub Mutex<Target>);
pub fn state()->OutputTarget {OutputTarget(Mutex::new(Target::default()))}
fn usable(handle:isize,original:u32,current:u32,own:u32,exists:bool)->bool{
 handle!=0 && original!=0 && original==current && current!=own && exists
}
#[cfg(windows)]
pub fn capture<R:tauri::Runtime>(app:&tauri::AppHandle<R>){
 use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow,GetWindowThreadProcessId};
 unsafe {let handle=GetForegroundWindow();let mut process=0;GetWindowThreadProcessId(handle,&mut process);
 if usable(handle as isize,process,process,std::process::id(),!handle.is_null()){
  if let Ok(mut target)=app.state::<OutputTarget>().0.lock(){let revision=target.revision.checked_add(1);if let Some(revision)=revision{*target=Target{handle:handle as isize,process,revision};}}
 }}
}
#[cfg(not(windows))]pub fn capture<R:tauri::Runtime>(_:&tauri::AppHandle<R>){}
#[tauri::command]
pub fn output_target(window:tauri::WebviewWindow)->Result<serde_json::Value,String>{
 if window.label()!="main"{return Err("仅工作台可读取目标应用".into());}
 #[cfg(windows)]{
 use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId,IsWindow,GetWindowTextW};
 let target=*window.state::<OutputTarget>().0.lock().map_err(|_|"目标状态不可用")?;
 unsafe {let handle=target.handle as windows_sys::Win32::Foundation::HWND;let mut current=0;GetWindowThreadProcessId(handle,&mut current);
 if !usable(target.handle,target.process,current,std::process::id(),IsWindow(handle)!=0){return Ok(serde_json::json!({"available":false,"reason":"尚未记录有效目标，或目标应用已关闭"}));}
 let mut title=[0u16;256];let len=GetWindowTextW(handle,title.as_mut_ptr(),title.len() as i32).max(0) as usize;
 return Ok(serde_json::json!({"available":true,"title":String::from_utf16_lossy(&title[..len]),"processId":current,"targetRevision":target.revision,"inputImplemented":false}));}
 }
 #[cfg(not(windows))]Ok(serde_json::json!({"available":false,"reason":"本平台目标应用记录尚未接入"}))
}
fn check_revision(actual:u64,expected:u64)->Result<(),String>{
 if expected==0||actual!=expected{return Err("输入目标已变化，请重新检查后准备输出".into());}Ok(())
}
fn execution_ready(target:Target,expected:u64,foreground:isize,current_process:u32,exists:bool)->bool{
 check_revision(target.revision,expected).is_ok()
 && foreground==target.handle
 && usable(target.handle,target.process,current_process,std::process::id(),exists)
}
// Staged execution guard. Reading does not activate any window or inject input.
#[cfg(windows)]
pub fn ready_for_input<R:tauri::Runtime>(app:&tauri::AppHandle<R>,expected:u64)->bool{
 use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow,GetWindowThreadProcessId,IsWindow};
 let state=app.state::<OutputTarget>();
 let Ok(target)=state.0.lock() else{return false;};
 unsafe{let handle=target.handle as windows_sys::Win32::Foundation::HWND;let mut process=0;GetWindowThreadProcessId(handle,&mut process);
 execution_ready(*target,expected,GetForegroundWindow() as isize,process,IsWindow(handle)!=0)}
}
#[cfg(windows)]
pub fn send_to_recorded<R:tauri::Runtime>(app:&tauri::AppHandle<R>,expected:u64,plan:&[crate::output_text::UnicodeEvent])->Result<(),crate::windows_input::InputFailure>{
 crate::windows_input::send_unicode(plan,||ready_for_input(app,expected))
}
fn output_permission(label:&str)->Result<(),String>{
 if label!="main"{return Err("仅工作台可执行文字输出".into());}Ok(())
}
fn input_error(error:crate::windows_input::InputFailure)->String{
 use crate::windows_input::InputFailure;
 match error{
 InputFailure::Empty=>"输出内容为空".into(),
 InputFailure::TargetChanged=>"目标窗口或焦点已变化，未写入文字；请切回已检查的目标窗口".into(),
 InputFailure::Rejected=>"Windows未接受输入，可能受目标应用权限限制；未自动重试，请使用复制文本".into(),
 InputFailure::Partial{sent,total}=>format!("Windows仅接受{sent}/{total}个键盘事件，文字可能不完整；未自动重试，请先检查目标内容，避免重复输入"),
 InputFailure::InvalidCount=>"Windows返回异常输入数量；请检查目标内容，系统不会自动重试".into(),
 }
}
#[tauri::command]
pub fn output_send(window:tauri::WebviewWindow,text:String,target_revision:u64)->Result<serde_json::Value,String>{
 output_permission(window.label())?;
 let plan=crate::output_text::prepare(&text)?;
 #[cfg(windows)]{
 send_to_recorded(window.app_handle(),target_revision,&plan).map_err(input_error)?;
 Ok(serde_json::json!({"acceptedEvents":plan.len(),"utf16Units":plan.len()/2,"targetRevision":target_revision,"status":"submitted"}))
 }
 #[cfg(not(windows))]{let _=(plan,target_revision);Err("本平台文字输入尚未接入，请使用复制文本".into())}
}
#[tauri::command]
pub fn output_send_current(window:tauri::WebviewWindow,text:String)->Result<serde_json::Value,String>{
 output_permission(window.label())?;
 // Do not reuse an old target if the foreground is TalkCraft or no longer valid.
 {let state=window.state::<OutputTarget>();let mut target=state.0.lock().map_err(|_|"目标状态不可用")?;
  *target=Target{handle:0,process:0,revision:target.revision};}
 capture(window.app_handle());
 let target=output_target(window.clone())?;
 if target["available"]!=true{return Err("当前没有有效外部输入窗口；结果已保留，请切回文本输入框后复制".into());}
 output_send(window,text,target["targetRevision"].as_u64().unwrap_or(0))
}
#[tauri::command]
pub fn output_preflight(window:tauri::WebviewWindow,text:String,target_revision:u64)->Result<serde_json::Value,String>{
 if window.label()!="main"{return Err("仅工作台可准备输出".into());}
 let plan=crate::output_text::prepare(&text)?;
 let target=output_target(window.clone())?;
 if target["available"]!=true{return Err("目标窗口不可用，请重新检查".into());}
 check_revision(target["targetRevision"].as_u64().unwrap_or(0),target_revision)?;
 // Check again after preparing, including the native window identity and validity.
 let final_target=output_target(window.clone())?;
 if final_target["available"]!=true{return Err("目标窗口已关闭或失效".into());}
 check_revision(final_target["targetRevision"].as_u64().unwrap_or(0),target_revision)?;
 Ok(serde_json::json!({"targetRevision":target_revision,"title":final_target["title"],"utf16Units":plan.len()/2,"eventCount":plan.len(),"inputImplemented":false}))
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn only_main_can_request_input(){assert!(output_permission("main").is_ok());assert!(output_permission("hud").is_err());assert!(output_permission("unknown").is_err());}
 #[test]fn partial_error_reports_events_and_no_retry(){let text=input_error(crate::windows_input::InputFailure::Partial{sent:3,total:8});assert!(text.contains("3/8个键盘事件"));assert!(text.contains("未自动重试"));assert!(text.contains("避免重复"));}
 #[test]fn errors_do_not_claim_success(){use crate::windows_input::InputFailure;assert!(input_error(InputFailure::TargetChanged).contains("未写入"));assert!(input_error(InputFailure::Rejected).contains("未接受"));assert!(input_error(InputFailure::InvalidCount).contains("异常"));assert!(input_error(InputFailure::Empty).contains("为空"));}
 #[test]fn execution_requires_current_external_foreground_and_revision(){
 let target=Target{handle:123,process:if std::process::id()==42{43}else{42},revision:7};
 assert!(execution_ready(target,7,123,target.process,true));
 assert!(!execution_ready(target,6,123,target.process,true));
 assert!(!execution_ready(target,7,124,target.process,true));
 assert!(!execution_ready(target,7,123,target.process,false));
 assert!(!execution_ready(target,7,123,std::process::id(),true));
 assert!(!execution_ready(target,7,123,target.process+1,true));
 }
 #[test]fn stale_and_unselected_targets_rejected(){assert!(check_revision(4,4).is_ok());assert!(check_revision(5,4).is_err());assert!(check_revision(0,0).is_err());assert!(check_revision(5,0).is_err());}

 #[test]fn external_target_only(){assert!(usable(1,42,42,7,true));assert!(!usable(1,7,7,7,true));assert!(!usable(0,42,42,7,true));assert!(!usable(1,0,0,7,true));}
 #[test]fn closed_or_reused_target_rejected(){assert!(!usable(1,42,42,7,false));assert!(!usable(1,42,99,7,true));}
}
