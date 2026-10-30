// Pure planning only: this module never invokes SendInput or sends Return/Tab keys.
#[derive(Debug, PartialEq)]
pub struct UnicodeEvent {pub unit:u16,pub key_up:bool}
pub const MAX_OUTPUT_UNITS:usize=32000;
pub fn prepare(text:&str)->Result<Vec<UnicodeEvent>,String>{
 if text.trim().is_empty(){return Err("没有可输入的文字".into());}
 if text.chars().any(|c|c.is_control()&&!matches!(c,'\n'|'\r'|'\t')){return Err("文字包含不支持的控制字符，请先编辑".into());}
 // A pasted/typed paragraph must not duplicate its line break for CRLF.
 let normalized=text.replace("\r\n","\n").replace('\r',"\n");
 let units:Vec<_>=normalized.encode_utf16().collect();
 if units.len()>MAX_OUTPUT_UNITS{return Err("输入文字最多32000个UTF-16单元".into());}
 Ok(units.into_iter().flat_map(|unit|[UnicodeEvent{unit,key_up:false},UnicodeEvent{unit,key_up:true}]).collect())
}
#[tauri::command]
pub fn output_preview(window:tauri::WebviewWindow,text:String)->Result<serde_json::Value,String>{
 if window.label()!="main"{return Err("仅工作台可准备文字输出".into());}
 let plan=prepare(&text)?;
 Ok(serde_json::json!({"utf16Units":plan.len()/2,"eventCount":plan.len(),"inputImplemented":false}))
}
#[cfg(test)]mod tests{use super::*;
 fn units(text:&str)->Vec<u16>{prepare(text).unwrap().chunks_exact(2).map(|pair|{assert_eq!(pair[0].unit,pair[1].unit);assert!(!pair[0].key_up);assert!(pair[1].key_up);pair[0].unit}).collect()}
 #[test]fn chinese_and_emoji_preserved(){let text="下午3点 AI 🎙️";assert_eq!(units(text),text.encode_utf16().collect::<Vec<_>>());}
 #[test]fn line_breaks_normalized(){assert_eq!(units("目标\r\n约束\r输出\n\t缩进"),"目标\n约束\n输出\n\t缩进".encode_utf16().collect::<Vec<_>>());}
 #[test]fn whitespace_preserved(){assert_eq!(units("  内容  "),"  内容  ".encode_utf16().collect::<Vec<_>>());}
 #[test]fn empty_controls_and_oversize_rejected(){for value in [""," \n\t","hello\0world","文字\u{1b}","文字\u{7f}"]{assert!(prepare(value).is_err());}assert!(prepare(&"字".repeat(MAX_OUTPUT_UNITS)).is_ok());assert!(prepare(&"字".repeat(MAX_OUTPUT_UNITS+1)).is_err());assert!(prepare(&"🎙".repeat(MAX_OUTPUT_UNITS/2)).is_ok());assert!(prepare(&"🎙".repeat(MAX_OUTPUT_UNITS/2+1)).is_err());}
}
