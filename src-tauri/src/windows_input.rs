use crate::output_text::UnicodeEvent;
#[derive(Debug,PartialEq)]
pub enum InputFailure {Empty,TargetChanged,Rejected,Partial{sent:usize,total:usize},InvalidCount}
fn guarded_submit(total:usize,check:impl FnOnce()->bool,send:impl FnOnce()->usize)->Result<(),InputFailure>{
 if total==0{return Err(InputFailure::Empty);}
 if !check(){return Err(InputFailure::TargetChanged);}
 // Exactly one submission; a partial result must never trigger a replay.
 classify(send(),total)
}
pub fn classify(sent:usize,total:usize)->Result<(),InputFailure>{
 if total==0{return Err(InputFailure::Empty);}
 if sent>total{return Err(InputFailure::InvalidCount);}
 if sent==total{return Ok(());}
 if sent==0{return Err(InputFailure::Rejected);}
 Err(InputFailure::Partial{sent,total})
}
#[cfg(windows)]
pub fn native_events(plan:&[UnicodeEvent])->Vec<windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT>{
 use windows_sys::Win32::UI::Input::KeyboardAndMouse::{INPUT,INPUT_0,KEYBDINPUT,INPUT_KEYBOARD,KEYEVENTF_UNICODE,KEYEVENTF_KEYUP};
 plan.iter().map(|event|INPUT{r#type:INPUT_KEYBOARD,Anonymous:INPUT_0{ki:KEYBDINPUT{wVk:0,wScan:event.unit,dwFlags:KEYEVENTF_UNICODE|if event.key_up{KEYEVENTF_KEYUP}else{0},time:0,dwExtraInfo:0}}}).collect()
}
// The main-only output command supplies the recorded-target/foreground guard.
#[cfg(windows)]
pub fn send_unicode(plan:&[UnicodeEvent],check:impl FnOnce()->bool)->Result<(),InputFailure>{
 if plan.is_empty(){return Err(InputFailure::Empty);}
 let events=native_events(plan);
 guarded_submit(events.len(),check,||unsafe{windows_sys::Win32::UI::Input::KeyboardAndMouse::SendInput(events.len() as u32,events.as_ptr(),std::mem::size_of::<windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT>() as i32) as usize})
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn changed_target_never_submits(){assert_eq!(guarded_submit(4,||false,||panic!("must not send")),Err(InputFailure::TargetChanged));assert_eq!(guarded_submit(0,||panic!("must not check"),||panic!("must not send")),Err(InputFailure::Empty));}
 #[test]fn partial_submission_runs_once(){let mut calls=0;let result=guarded_submit(4,||true,||{calls+=1;1});assert_eq!(result,Err(InputFailure::Partial{sent:1,total:4}));assert_eq!(calls,1);assert_eq!(guarded_submit(4,||true,||4),Ok(()));}
 #[test]fn outcomes_do_not_hide_partial_results(){assert_eq!(classify(4,4),Ok(()));assert_eq!(classify(0,4),Err(InputFailure::Rejected));assert_eq!(classify(1,4),Err(InputFailure::Partial{sent:1,total:4}));assert_eq!(classify(3,4),Err(InputFailure::Partial{sent:3,total:4}));assert_eq!(classify(0,0),Err(InputFailure::Empty));assert_eq!(classify(5,4),Err(InputFailure::InvalidCount));}
 #[cfg(windows)]#[test]fn unicode_events_preserve_units_without_virtual_return_or_tab(){
 use windows_sys::Win32::UI::Input::KeyboardAndMouse::{INPUT_KEYBOARD,KEYEVENTF_UNICODE,KEYEVENTF_KEYUP};
 let plan=crate::output_text::prepare("中文🎙\n\t").unwrap();let native=native_events(&plan);assert_eq!(native.len(),plan.len());
 for (event,input) in plan.iter().zip(&native){assert_eq!(input.r#type,INPUT_KEYBOARD);let key=unsafe{input.Anonymous.ki};assert_eq!(key.wVk,0);assert_eq!(key.wScan,event.unit);assert_eq!(key.dwFlags,KEYEVENTF_UNICODE|if event.key_up{KEYEVENTF_KEYUP}else{0});}
 }
}
