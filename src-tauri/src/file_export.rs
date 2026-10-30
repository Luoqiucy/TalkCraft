fn validate_export(name:&str,bytes:&[u8])->Result<(),String>{
 if !name.starts_with("TalkCraft_")||name.len()>200||name.contains(['/', '\\', ':']){return Err("导出文件名无效".into());}
 let matches=if name.ends_with(".wav"){bytes.starts_with(b"RIFF")&&bytes.get(8..12)==Some(b"WAVE".as_slice())}
 else if name.ends_with(".webm"){bytes.starts_with(&[0x1a,0x45,0xdf,0xa3])}
 else if name.ends_with(".m4a"){bytes.get(4..8)==Some(b"ftyp".as_slice())}
 else if name.ends_with(".zip"){bytes.starts_with(b"PK\x03\x04")}else{false};
 if !matches{return Err("文件扩展名与实际容器不符，不能通过改后缀转码".into());}Ok(())
}
#[tauri::command]
pub async fn file_export(window:tauri::WebviewWindow,name:String,bytes:Vec<u8>)->Result<String,String>{
    if window.label()!="main"||bytes.is_empty()||bytes.len()>32*1024*1024{return Err("导出窗口或文件大小无效".into());}
    validate_export(&name,&bytes)?;
    #[cfg(windows)]{
        let owner=window.hwnd().map_err(|e|e.to_string())?.0 as isize;
        return tauri::async_runtime::spawn_blocking(move||save_windows(owner,&name,&bytes)).await.map_err(|e|e.to_string())?;
    }
    #[cfg(not(windows))]{let _=(name,bytes);Err("当前开发版系统保存对话框仅在Windows实现".into())}
}
#[cfg(test)]mod tests{
 #[test]fn cannot_export_renamed_container_or_invalid_path(){assert!(super::validate_export("TalkCraft_test.wav",b"PK\x03\x04data").is_err());assert!(super::validate_export("TalkCraft_../other.zip",b"PK\x03\x04data").is_err());assert!(super::validate_export("TalkCraft_test.zip",b"PK\x03\x04data").is_ok());assert!(super::validate_export("TalkCraft_test.wav",b"RIFF1234WAVEdata").is_ok());}
}
#[cfg(windows)]
fn save_windows(owner:isize,name:&str,bytes:&[u8])->Result<String,String>{
 use windows_sys::Win32::UI::Controls::Dialogs::{GetSaveFileNameW,CommDlgExtendedError,OPENFILENAMEW,OFN_OVERWRITEPROMPT,OFN_PATHMUSTEXIST,OFN_NOCHANGEDIR};
 let mut file=vec![0u16;32768];let initial:Vec<u16>=name.encode_utf16().collect();file[..initial.len()].copy_from_slice(&initial);
 let ext:Vec<u16>=name.rsplit('.').next().unwrap_or("wav").encode_utf16().chain(Some(0)).collect();
 let filter:Vec<u16>="导出文件\0*.*\0\0".encode_utf16().collect();
 let mut dialog:OPENFILENAMEW=unsafe{std::mem::zeroed()};dialog.lStructSize=std::mem::size_of::<OPENFILENAMEW>() as u32;dialog.hwndOwner=owner as _;dialog.lpstrFilter=filter.as_ptr();dialog.lpstrFile=file.as_mut_ptr();dialog.nMaxFile=file.len() as u32;dialog.lpstrDefExt=ext.as_ptr();dialog.Flags=OFN_OVERWRITEPROMPT|OFN_PATHMUSTEXIST|OFN_NOCHANGEDIR;
 unsafe{if GetSaveFileNameW(&mut dialog)==0{let error=CommDlgExtendedError();return if error==0{Ok("cancelled".into())}else{Err(format!("保存对话框失败：{error}"))};}}
 let len=file.iter().position(|&x|x==0).unwrap_or(file.len());let path=String::from_utf16(&file[..len]).map_err(|_|"保存路径无效")?;
 let expected=name.rsplit('.').next().unwrap_or("");if std::path::Path::new(&path).extension().and_then(|x|x.to_str()).map(|x|x.eq_ignore_ascii_case(expected))!=Some(true){return Err(format!("请使用.{expected}扩展名；更改后缀不会转换编码"));}
 std::fs::write(&path,bytes).map_err(|e|format!("导出失败：{e}"))?;Ok("saved".into())
}
