#[tauri::command]
pub fn clipboard_write(window:tauri::WebviewWindow,text:String)->Result<(),String>{
 if !matches!(window.label(),"main"|"hud"){return Err("不允许写入剪贴板".into());}
 if text.is_empty()||text.len()>2_000_000||text.contains('\0'){return Err("复制文本为空、过长或包含无效字符".into());}
 #[cfg(windows)]unsafe{
  use windows_sys::Win32::System::{DataExchange::{OpenClipboard,CloseClipboard,EmptyClipboard,SetClipboardData},Memory::{GlobalAlloc,GlobalLock,GlobalUnlock,GMEM_MOVEABLE}};
  use windows_sys::Win32::Foundation::GlobalFree;
  let owner=window.hwnd().map_err(|e|e.to_string())?.0 as _;
  let units:Vec<u16>=text.encode_utf16().chain(Some(0)).collect();let memory=GlobalAlloc(GMEM_MOVEABLE,units.len()*2);
  if memory.is_null(){return Err("剪贴板内存申请失败".into());}
  let pointer=GlobalLock(memory) as *mut u16;if pointer.is_null(){GlobalFree(memory);return Err("剪贴板内存不可用".into());}
  std::ptr::copy_nonoverlapping(units.as_ptr(),pointer,units.len());GlobalUnlock(memory);
  if OpenClipboard(owner)==0 {GlobalFree(memory);return Err("剪贴板正被其他程序使用，请重试".into());}
  let ok=EmptyClipboard()!=0&&!SetClipboardData(13,memory as _).is_null();CloseClipboard();if !ok{GlobalFree(memory);return Err("复制失败，请重试".into());}Ok(())
 }
 #[cfg(not(windows))]{let _=text;Err("本平台原生复制尚未接入".into())}
}
