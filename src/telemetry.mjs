// Internal adapter boundary. No browser endpoint can fabricate device state.
export function createTelemetryStore({now=Date.now,staleMs=15000}={}){
 let device,lastSeen;
 function update(value){
  if(!value || !['connected','connecting','disconnected'].includes(value.connection))throw new Error('设备状态无效');
  const name=value.name ?? '无线麦克风';
  if(typeof name!=='string' || !name.trim() || name.length>80)throw new Error('设备名称无效');
  for(const key of ['battery','rssi'])if(value[key]!==undefined && value[key]!==null && (typeof value[key]!=='number' || !Number.isFinite(value[key]) || value[key]<(key==='battery'?0:-120) || value[key]>(key==='battery'?100:0)))throw new Error('设备测量无效');
  device={connection:value.connection,name,battery:value.battery??null,rssi:value.rssi??null};lastSeen=now();
 }
 function read(){
  const stale=device && now()-lastSeen>staleMs;
  const connected=device?.connection==='connected' && !stale;
  return {device:{connection:stale?'disconnected':device?.connection??'disconnected',name:device?.name??'无线麦克风未连接',battery:connected?device.battery:null,rssi:connected?device.rssi:null,stale:!!stale}};
 }
 return {update,read};
}
