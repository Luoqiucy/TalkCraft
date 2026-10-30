use std::path::{Path,PathBuf};

fn bundle_resources(executable:&Path)->Option<PathBuf>{
    let macos=executable.parent()?;
    let contents=macos.parent()?;
    if macos.file_name()? != "MacOS" || contents.file_name()? != "Contents" {return None;}
    Some(contents.join("Resources"))
}

pub fn backend_root()->Result<PathBuf,String>{
    #[cfg(target_os="macos")]
    if let Some(resources)=bundle_resources(&std::env::current_exe().map_err(|_|"无法确定应用位置")?){
        let root=resources.join("backend");
        if !root.join("scripts/asr-file.mjs").is_file(){return Err("应用后台资源缺失，请重新下载完整Mac开发版".into());}
        return Ok(root);
    }
    Ok(Path::new(env!("CARGO_MANIFEST_DIR")).join(".."))
}

pub fn node_binary()->Result<PathBuf,String>{
    #[cfg(target_os="macos")]
    if let Some(resources)=bundle_resources(&std::env::current_exe().map_err(|_|"无法确定应用位置")?){
        let node=resources.join("node/bin/node");
        if !node.is_file(){return Err("应用Node运行时缺失，请重新下载完整Mac开发版".into());}
        return Ok(node);
    }
    Ok(PathBuf::from("node"))
}

pub fn state_dir()->Result<PathBuf,String>{
    #[cfg(target_os="macos")]
    {return std::env::var_os("HOME").filter(|home|!home.is_empty()).map(|home|PathBuf::from(home).join("Library/Application Support/TalkCraft/runtime")).ok_or_else(||"无法确定Mac用户数据目录".into());}
    #[cfg(not(target_os="macos"))]
    Ok(backend_root()?.join(".local"))
}

#[cfg(test)]mod tests{
    #[test]fn bundle_location_survives_move_and_spaces(){
        let path=std::path::Path::new("/Applications/My Apps/TalkCraft.app/Contents/MacOS/TalkCraft");
        assert_eq!(super::bundle_resources(path).unwrap(),std::path::Path::new("/Applications/My Apps/TalkCraft.app/Contents/Resources"));
        assert!(super::bundle_resources(std::path::Path::new("/tmp/target/debug/talkcraft-desktop")).is_none());
    }
}
