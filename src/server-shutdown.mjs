export function installServerShutdown(server,{signals=process,graceMs=3000}={}) {
  if(!Number.isInteger(graceMs)||graceMs<1||graceMs>10000)throw new Error('关闭等待时间无效');
  let pending;
  const cancellable=new Set();
  function track(req,res){
    res.once('finish',()=>{if(pending)setImmediate(()=>server.closeIdleConnections?.());});
    // Cancel inference, not history/audio/config writes which must finish saving.
    if(!['/api/search','/api/process','/api/transcribe'].includes(req.url?.split('?')[0]))return;
    cancellable.add(res);res.once('close',()=>cancellable.delete(res));
  }
  server.on('request',track);
  function stop(){
    if(pending)return pending;
    pending=new Promise(resolve=>{
      const timer=setTimeout(()=>server.closeAllConnections(),graceMs);
      server.close(()=>{clearTimeout(timer);dispose();resolve();});
      for(const res of cancellable)res.destroy();
      server.closeIdleConnections?.();
    });return pending;
  }
  function message(value){if(value?.type==='talkcraft:shutdown')stop().then(()=>{if(signals.connected && typeof signals.disconnect==='function')signals.disconnect();});}
  function dispose(){server.off('request',track);signals.off('SIGINT',stop);signals.off('SIGTERM',stop);signals.off('message',message);signals.off('disconnect',stop);}
  signals.on('SIGINT',stop);signals.on('SIGTERM',stop);
  signals.on('message',message);signals.on('disconnect',stop);
  return {stop,dispose};
}
