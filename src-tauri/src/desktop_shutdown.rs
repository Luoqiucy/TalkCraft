use std::{io::{Read,Write},net::{TcpStream,SocketAddr},time::Duration};
pub fn finish_exit(cleanup:impl FnOnce()->Result<(),String>,finish:impl FnOnce(Option<String>)){
 finish(cleanup().err());
}
pub fn ensure_service()->Result<(),String>{
 let address:SocketAddr="127.0.0.1:4317".parse().unwrap();
 if TcpStream::connect_timeout(&address,Duration::from_secs(1)).is_ok(){return verify_service(address);}
 let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
 let mut command=std::process::Command::new("node");command.current_dir(&root).arg(root.join("scripts/asr-file.mjs")).args(["--port","4317"]).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
 #[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
 let mut child=command.spawn().map_err(|_|"无法启动后台服务，请确认Node已安装")?;
 for _ in 0..50 {if child.try_wait().map_err(|_|"无法读取后台启动状态")?.is_some(){return Err("后台启动失败，请检查端口和服务配置".into());}if TcpStream::connect_timeout(&address,Duration::from_millis(100)).is_ok(){return verify_service(address);}std::thread::sleep(Duration::from_millis(100));}
 let _=child.kill();let _=child.wait();Err("后台服务启动超时".into())
}
fn verify_service(address:SocketAddr)->Result<(),String>{
 let mut stream=TcpStream::connect_timeout(&address,Duration::from_millis(300)).map_err(|_|"无法连接后台服务")?;
 stream.set_read_timeout(Some(Duration::from_millis(500))).map_err(|_|"无法读取后台服务状态")?;
 stream.write_all(b"GET /api/status HTTP/1.1\r\nHost: 127.0.0.1:4317\r\nConnection: close\r\n\r\n").map_err(|_|"无法检查后台服务状态")?;
 let mut response=Vec::new();stream.take(8192).read_to_end(&mut response).map_err(|_|"后台服务状态检查超时")?;
 let status=parse_status_response(&response)?;
 if status["desktopService"]!=true{return Err("4317端口被其他服务占用；请先保存录音并正常关闭旧服务，再启动TalkCraft".into());}
 Ok(())
}
fn parse_status_response(response:&[u8])->Result<serde_json::Value,String>{
 if !response.starts_with(b"HTTP/1.1 200 "){return Err("后台服务状态响应无效".into());}
 let offset=response.windows(4).position(|part|part==b"\r\n\r\n").ok_or("后台服务状态响应无效")?+4;
 let mut body=&response[offset..];
 if !body.starts_with(b"{"){
  let line=body.windows(2).position(|part|part==b"\r\n").ok_or("后台服务状态分块无效")?;
  let length=std::str::from_utf8(&body[..line]).ok().and_then(|value|usize::from_str_radix(value.trim(),16).ok()).ok_or("后台服务状态分块无效")?;
  body=body.get(line+2..line+2+length).ok_or("后台服务状态分块不完整")?;
 }
 serde_json::from_slice(body).map_err(|_|"后台服务状态响应无效".into())
}
pub fn stop_service()->Result<(),String>{
 let address:SocketAddr="127.0.0.1:4317".parse().unwrap();
 let stream=match TcpStream::connect_timeout(&address,Duration::from_millis(150)){Ok(stream)=>stream,Err(error) if error.kind()==std::io::ErrorKind::ConnectionRefused=>return Ok(()),Err(_)=>return Err("无法确认后台服务状态，请稍后重试".into())};
 let control=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.local/desktop-service.json");
 let bytes=std::fs::read(control).map_err(|_|"后台服务尚未更新退出控制接口，请更新服务后重试")?;
 let value:serde_json::Value=serde_json::from_slice(&bytes).map_err(|_|"后台服务控制信息无效")?;
 let token=value["token"].as_str().ok_or("后台服务控制信息缺失")?;
 if value["port"]!=4317||token.len()!=36||!token.chars().all(|c|c.is_ascii_hexdigit()||c=='-'){return Err("后台服务控制信息无效".into());}
 request_shutdown(stream,token)
}
fn request_shutdown(mut stream:TcpStream,token:&str)->Result<(),String>{
 stream.set_write_timeout(Some(Duration::from_millis(150))).map_err(|_|"无法设置关闭等待")?;
 write!(stream,"POST /api/desktop-exit HTTP/1.1\r\nHost: 127.0.0.1:4317\r\nX-TalkCraft-Control: {token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").map_err(|_|"后台服务关闭请求失败")?;
 // Acknowledgement means cleanup was accepted, not that disk writes finished.
 // Do not poll the port: Windows connection-refusal probes can be slow.
 let deadline=std::time::Instant::now()+Duration::from_millis(500);
 let mut response=Vec::new();
 while response.len()<512 {
  let remaining=deadline.checked_duration_since(std::time::Instant::now()).ok_or("后台服务关闭响应超时")?;
  stream.set_read_timeout(Some(remaining)).map_err(|_|"无法设置关闭等待")?;
  let mut byte=[0u8;1];
  if stream.read(&mut byte).map_err(|_|"后台服务关闭响应未知")?==0{break;}
  response.push(byte[0]);if byte[0]==b'\n'{break;}
 }
 if response.starts_with(b"HTTP/1.1 200 ")&&response.ends_with(b"\r\n"){Ok(())}else{Err("后台服务未确认关闭请求".into())}
}

#[cfg(test)]mod tests{
 #[test]fn status_parser_accepts_chunked_node_response(){
  let body=b"{\"desktopService\":true}";
  let response=format!("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{}\r\n0\r\n\r\n",body.len(),std::str::from_utf8(body).unwrap());
  assert_eq!(super::parse_status_response(response.as_bytes()).unwrap()["desktopService"],true);
 }
 #[test]fn only_managed_status_is_accepted(){
  use super::verify_service;
  use std::{net::TcpListener,io::{Read,Write}};
  for managed in [false,true]{
   let listener=TcpListener::bind("127.0.0.1:0").unwrap();let address=listener.local_addr().unwrap();
   let worker=std::thread::spawn(move||{let(mut stream,_)=listener.accept().unwrap();let mut request=[0;256];let _=stream.read(&mut request);let body=format!("{{\"desktopService\":{managed}}}");write!(stream,"HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{body}",body.len()).unwrap();});
   assert_eq!(verify_service(address).is_ok(),managed);worker.join().unwrap();
  }
 }
 #[test]fn shutdown_ack_does_not_wait_for_server_eof(){
  use std::{net::{TcpListener,TcpStream},io::{Read,Write},time::{Duration,Instant}};
  let listener=TcpListener::bind("127.0.0.1:0").unwrap();let address=listener.local_addr().unwrap();
  let (release_tx,release_rx)=std::sync::mpsc::channel();
  let worker=std::thread::spawn(move||{let(mut stream,_)=listener.accept().unwrap();let mut request=Vec::new();let mut b=[0;1];while !request.ends_with(b"\r\n\r\n"){stream.read_exact(&mut b).unwrap();request.push(b[0]);}stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\n\r\nClosing").unwrap();let _=release_rx.recv_timeout(Duration::from_secs(2));});
  let start=Instant::now();let result=super::request_shutdown(TcpStream::connect(address).unwrap(),"test-token");let elapsed=start.elapsed();let _=release_tx.send(());worker.join().unwrap();assert!(result.is_ok());assert!(elapsed<Duration::from_secs(1));
 }
 #[test]fn service_failure_never_blocks_application_exit(){let mut exited=false;super::finish_exit(||Err("旧后台控制接口缺失".into()),|warning|{assert!(warning.unwrap().contains("缺失"));exited=true;});assert!(exited);}
 #[test]fn stopped_service_exits_without_warning(){let mut exited=false;super::finish_exit(||Ok(()),|warning|{assert!(warning.is_none());exited=true;});assert!(exited);}
}
