#[cfg(windows)]
pub struct Guard(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl Drop for Guard{fn drop(&mut self){unsafe{windows_sys::Win32::Foundation::CloseHandle(self.0);}}}
#[cfg(windows)]
fn acquire_named(name:&str)->Result<Option<Guard>,String>{
 use windows_sys::Win32::{Foundation::{GetLastError,ERROR_ALREADY_EXISTS,CloseHandle},System::Threading::CreateMutexW};
 let name:Vec<u16>=name.encode_utf16().chain(Some(0)).collect();
 unsafe{let handle=CreateMutexW(std::ptr::null(),0,name.as_ptr());let error=GetLastError();
 if handle.is_null(){return Err(format!("无法检查应用重复启动：{error}"));}
 if error==ERROR_ALREADY_EXISTS{CloseHandle(handle);return Ok(None);}
 Ok(Some(Guard(handle)))}
}
#[cfg(windows)]
pub fn acquire()->Result<Option<Guard>,String>{acquire_named("Local\\TalkCraft.Desktop.SingleInstance.v1")}
#[cfg(windows)]
pub fn show_existing(){
 use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowW,ShowWindow,SetForegroundWindow,SW_RESTORE};
 let title:Vec<u16>="TalkCraft · 桌面助手".encode_utf16().chain(Some(0)).collect();
 unsafe{let window=FindWindowW(std::ptr::null(),title.as_ptr());if !window.is_null(){ShowWindow(window,SW_RESTORE);SetForegroundWindow(window);}}
}
#[cfg(all(test,windows))]
mod tests{use super::*;
 #[test]fn second_instance_rejected_and_lock_released(){let name=format!("Local\\TalkCraft.Test.SingleInstance.{}",std::process::id());let first=acquire_named(&name).unwrap().unwrap();assert!(acquire_named(&name).unwrap().is_none());drop(first);assert!(acquire_named(&name).unwrap().is_some());}
}
