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

#[cfg(target_os="macos")]
pub struct Guard(std::fs::File);
#[cfg(target_os="macos")]
pub fn acquire()->Result<Option<Guard>,String>{
 use std::os::{fd::AsRawFd,unix::fs::OpenOptionsExt};
 extern "C"{fn flock(fd:i32,operation:i32)->i32;}
 let directory=crate::runtime_paths::state_dir()?;
 std::fs::create_dir_all(&directory).map_err(|_|"无法创建单实例目录")?;
 let file=std::fs::OpenOptions::new().create(true).truncate(false).read(true).write(true).mode(0o600).open(directory.join("desktop.lock")).map_err(|_|"无法打开单实例锁")?;
 if unsafe{flock(file.as_raw_fd(),2|4)}==0{return Ok(Some(Guard(file)));}
 if std::io::Error::last_os_error().kind()==std::io::ErrorKind::WouldBlock{return Ok(None);}
 Err("无法取得Mac单实例锁".into())
}
#[cfg(target_os="macos")]
pub fn show_existing(){
 // Finder/LaunchServices normally activates an existing .app instance.
 // A second command-line launch exits without touching the active backend.
}
