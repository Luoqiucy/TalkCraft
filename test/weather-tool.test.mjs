import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOpenMeteoWeatherTool,parseWeatherQuestion} from '../src/tools/weather.mjs';

const fixed=()=>new Date('2026-09-19T04:00:00Z');
test('时间修饰词与地点分离，七天范围不退化成今天',()=>{
 for(const [text,location,period] of [
  ['最近北京天气怎么样？','北京','current-today'],
  ['最近江苏省南京市的天气怎么样？','江苏省南京市','current-today'],
  ['张家港这一周的天气怎么样？','张家港','next-seven-days'],
  ['张家港未来一周天气','张家港','next-seven-days'],
  ['张家港最近一周天气','张家港','ambiguous-week'],
  ['未来一周的南京的天气怎么样？','南京','next-seven-days']
 ]){const intent=parseWeatherQuestion(text);assert.equal(intent.location,location);assert.equal(intent.period,period);}
});
test('口语时间范围不混入张家港地点，三天请求保留天数',()=>{
 const week=parseWeatherQuestion('从今天到接下来7天，张家港天气怎么样？');
 assert.equal(week.location,'张家港');assert.equal(week.period,'next-seven-days');
 const three=parseWeatherQuestion('未来张家港3天的天气怎么样？');
 assert.equal(three.location,'张家港');assert.equal(three.period,'next-days');assert.equal(three.days,3);
});
test('最近一周先澄清过去或未来，不发网络请求',async()=>{
 const tool=createOpenMeteoWeatherTool({fetchImpl:async()=>assert.fail('不应请求网络')});
 assert.equal((await tool.query(parseWeatherQuestion('张家港最近一周天气'))).status,'needs-period');
});
test('省市名称查询无结果时尝试城市名称，未来七天保留所有日期',async()=>{
 const calls=[],daily={time:[],weather_code:[],temperature_2m_max:[],temperature_2m_min:[]};
 for(let day=19;day<=25;day++){daily.time.push(`2026-09-${day}`);daily.weather_code.push(3);daily.temperature_2m_max.push(day);daily.temperature_2m_min.push(15);}
 const tool=createOpenMeteoWeatherTool({now:fixed,fetchImpl:async input=>{
  const url=new URL(input);calls.push(url);
  return Response.json(url.hostname.includes('geocoding')?{results:url.searchParams.get('name')==='南京'?[place]:[]}:{daily});
 }});
 const result=await tool.query(parseWeatherQuestion('江苏省南京市未来一周天气'));
 assert.equal(result.status,'ok');assert.equal(result.forecasts.length,7);assert.equal(result.forecasts[6].date,'2026-09-25');assert.equal(result.current,undefined);
 assert.equal(calls[0].searchParams.get('name'),'江苏省南京市');assert.equal(calls[1].searchParams.get('name'),'南京');assert.equal(calls[2].searchParams.get('forecast_days'),'7');
});
const place={name:'南京',latitude:32.0617,longitude:118.7778,timezone:'Asia/Shanghai',country_code:'CN',country:'中国',admin1:'江苏',population:9000000};
test('同名聚落不能仅因逐字匹配优先于带市后缀的城市',async()=>{
 const u=upstream({places:{results:[{...place,name:'张家港',admin1:'四川',population:undefined,latitude:31.29308,longitude:104.31815},{...place,name:'张家港市',admin1:'江苏',population:1432044,latitude:31.865,longitude:120.53889}]}});
 const result=await createOpenMeteoWeatherTool({fetchImpl:u.fetchImpl,now:fixed}).query(parseWeatherQuestion('张家港天气'));
 assert.equal(result.location.name,'张家港市');assert.equal(result.location.admin1,'江苏');assert.equal(result.location.longitude,120.53889);
});
const forecast={current:{time:'2026-09-19T12:00',temperature_2m:26.1,relative_humidity_2m:80,apparent_temperature:28.2,precipitation:0,weather_code:3,wind_speed_10m:8.5},daily:{time:['2026-09-19','2026-09-20'],weather_code:[3,61],temperature_2m_max:[28,25],temperature_2m_min:[22,20],precipitation_probability_max:[20,70],wind_speed_10m_max:[18,20]}};
test('连写行政区定位末级城市且核验上级，不丢弃苏州限定',async()=>{
 for(const location of ['苏州张家港市','苏州市张家港市','江苏省苏州市张家港市','江苏苏州张家港']){
  const calls=[];const tool=createOpenMeteoWeatherTool({now:fixed,fetchImpl:async input=>{
   const url=new URL(input);calls.push(url);return Response.json(url.hostname.includes('geocoding')?{results:url.searchParams.get('name')==='张家港'?[{...place,name:'张家港市',admin2:'苏州市',longitude:120.53889},{...place,name:'张家港',admin1:'四川',admin2:'德阳市',population:99000000}]:[]} : forecast);
  }});
  const r=await tool.query({location,period:'current-today'});assert.equal(r.status,'ok',location);assert.equal(r.location.admin2,'苏州市');assert.equal(r.location.longitude,120.53889);assert.ok(calls.length<=9);
 }
});
test('行政区冲突或缺失不能用另一地区天气冒充',async()=>{
 for(const admin2 of ['德阳市','']){
  const tool=createOpenMeteoWeatherTool({now:fixed,fetchImpl:async input=>{const u=new URL(input);assert.ok(u.hostname.includes('geocoding'),'不应查询错误坐标');return Response.json({results:[{...place,name:'张家港市',admin2}]});}});
  assert.equal((await tool.query({location:'苏州张家港市',period:'current-today'})).status,'needs-location');
 }
});
function upstream({places={results:[place]},weather=forecast}={}){const calls=[];return {calls,fetchImpl:async url=>{calls.push(String(url));const data=String(url).includes('geocoding-api')?places:weather;return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});}};}
test('天气问题提取地点和当前/明日范围，缺地点不猜测',()=>{assert.deepEqual(parseWeatherQuestion('南京的天气怎么样？'),{intent:'weather',period:'current-today',location:'南京',timezone:'Asia/Shanghai'});assert.equal(parseWeatherQuestion('南京明天天气').period,'tomorrow');assert.equal(parseWeatherQuestion('今天天气怎么样').location,'');assert.equal(parseWeatherQuestion('解释蓝牙'),null);});
test('南京当前天气区分实时观测与今日预报并固定上海时区',async()=>{const u=upstream(),tool=createOpenMeteoWeatherTool({fetchImpl:u.fetchImpl,now:fixed});const result=await tool.query(parseWeatherQuestion('南京天气怎么样'));assert.equal(result.status,'ok');assert.equal(result.timezone,'Asia/Shanghai');assert.equal(result.current.temperature,26.1);assert.equal(result.current.observedAt,'2026-09-19T12:00');assert.equal(result.forecast.temperatureMax,28);assert.equal(result.forecast.temperatureMin,22);assert.equal(result.forecast.date,'2026-09-19');assert.equal(u.calls.length,2);assert.match(u.calls[1],/timezone=Asia%2FShanghai/);assert.match(u.calls[1],/current=/);assert.match(u.calls[1],/daily=/);});
test('南京明天天气只选择明日预报，不用今日或当前温度冒充',async()=>{const u=upstream(),result=await createOpenMeteoWeatherTool({fetchImpl:u.fetchImpl,now:fixed}).query(parseWeatherQuestion('南京明天天气'));assert.equal(result.period,'tomorrow');assert.equal(result.current,undefined);assert.equal(result.forecast.date,'2026-09-20');assert.equal(result.forecast.temperatureMax,25);});
test('后天天气读取第三天预报，不误用今日数据',async()=>{
 const daily={time:['2026-09-19','2026-09-20','2026-09-21'],weather_code:[3,61,0],temperature_2m_max:[28,25,27],temperature_2m_min:[22,20,19]};
 const u=upstream({weather:{daily}}),result=await createOpenMeteoWeatherTool({fetchImpl:u.fetchImpl,now:fixed}).query(parseWeatherQuestion('南京后天天气'));
 assert.equal(result.period,'day-after-tomorrow');assert.equal(result.forecast.date,'2026-09-21');assert.equal(result.current,undefined);assert.match(u.calls[1],/forecast_days=3/);
});
test('完整口语问句不会把会字混入天气地点',()=>{
 const intent=parseWeatherQuestion('后天张家港天气会怎么样？');
 assert.equal(intent.location,'张家港');assert.equal(intent.period,'day-after-tomorrow');
});
test('具体月日与周范围分开解析，确定当前年份的目标日期',()=>{
 const now=fixed();
 const exact=parseWeatherQuestion('张家港市10月3号的天气怎么样？',{now});
 assert.equal(exact.location,'张家港市');assert.equal(exact.period,'specific-date');assert.equal(exact.targetDate,'2026-10-03');
 const week=parseWeatherQuestion('帮我查询一下张家港，张家港这周的天气，并且帮我显示一下10月3号的天气是什么样的。',{now});
 assert.equal(week.location,'张家港');assert.equal(week.period,'next-seven-days');assert.equal(week.targetDate,'2026-10-03');
});
test('指定日期与七天预报共用一次天气请求，目标日来自真实逐日数据',async()=>{
 const daily={time:[],weather_code:[],temperature_2m_max:[],temperature_2m_min:[],precipitation_probability_max:[],wind_speed_10m_max:[]};
 for(let offset=0;offset<15;offset++){const date=new Date(Date.UTC(2026,8,19+offset)).toISOString().slice(0,10);daily.time.push(date);daily.weather_code.push(61);daily.temperature_2m_max.push(25+offset);daily.temperature_2m_min.push(18);daily.precipitation_probability_max.push(60);daily.wind_speed_10m_max.push(12);}
 const u=upstream({weather:{daily}}),intent=parseWeatherQuestion('南京这周天气，并显示10月3号天气',{now:fixed()}),result=await createOpenMeteoWeatherTool({fetchImpl:u.fetchImpl,now:fixed}).query(intent);
 assert.equal(result.status,'ok');assert.equal(result.period,'next-seven-days');assert.equal(result.requestedDate,'2026-10-03');assert.equal(result.forecast.date,'2026-10-03');assert.equal(result.forecast.temperatureMax,39);assert.equal(result.forecasts.length,7);assert.match(u.calls[1],/forecast_days=15/);
});
test('无地点不请求网络；实际歧义时要求选择',async()=>{let calls=0;const tool=createOpenMeteoWeatherTool({fetchImpl:async()=>{calls++;throw Error();},now:fixed});assert.equal((await tool.query(parseWeatherQuestion('今天天气'))).status,'needs-location');assert.equal(calls,0);const ambiguous=upstream({places:{results:[{...place,name:'Springfield',country:'美国',country_code:'US',admin1:'A',population:10000},{...place,name:'Springfield',country:'加拿大',country_code:'CA',admin1:'B',population:9000}]}});const result=await createOpenMeteoWeatherTool({fetchImpl:ambiguous.fetchImpl,now:fixed}).query({location:'Springfield',period:'current-today'});assert.equal(result.status,'ambiguous-location');assert.equal(ambiguous.calls.length,1);});
test('旧日期或不完整天气数据拒绝，不能标记获取成功',async()=>{for(const weather of [{...forecast,daily:{...forecast.daily,time:['2025-09-19','2025-09-20']}},{...forecast,current:{...forecast.current,time:'2025-09-19T12:00'}}]){const u=upstream({weather});await assert.rejects(createOpenMeteoWeatherTool({fetchImpl:u.fetchImpl,now:fixed}).query(parseWeatherQuestion('南京天气')),/所需日期|日期不符/);}});
test('天气服务失败、超时和用户取消均停止且不伪造结果',async()=>{const failed=createOpenMeteoWeatherTool({fetchImpl:async()=>new Response('{}',{status:503}),now:fixed});await assert.rejects(failed.query(parseWeatherQuestion('南京天气')),/暂时不可用/);const wait=(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));await assert.rejects(createOpenMeteoWeatherTool({fetchImpl:wait,timeoutMs:10,now:fixed}).query(parseWeatherQuestion('南京天气')),/超时/);const controller=new AbortController(),pending=createOpenMeteoWeatherTool({fetchImpl:wait,now:fixed}).query(parseWeatherQuestion('南京天气'),{signal:controller.signal});controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');});

// Shapes of real Open-Meteo geocoding answers from 2026-11 (GeoNames, language=zh).
const geo=(name,admin1,admin2,feature_code,population,latitude=30,longitude=110)=>({name,admin1,admin2,feature_code,population,latitude,longitude,timezone:'Asia/Shanghai',country_code:'CN',country:'中国'});
function geocoder(byName){const calls=[];return {calls,fetchImpl:async input=>{const url=new URL(input);calls.push(url.searchParams.get('name')||'forecast');return Response.json(url.hostname.includes('geocoding')?{results:byName[url.searchParams.get('name')]||[]}:forecast);}};}
test('县城优先于同名村庄，不再把“固安”当成需要选择的歧义地点',async()=>{
 const u=geocoder({固安:[geo('固安','河北省','廊坊市','PPLA3',0,39.43,116.29),geo('固安','黑龙江','哈尔滨市','PPL',0,45.8,126.6)]});
 const result=await createOpenMeteoWeatherTool({fetchImpl:u.fetchImpl,now:fixed}).query({location:'固安',period:'current-today'});
 assert.equal(result.status,'ok');assert.equal(result.location.admin1,'河北省');
});
test('裸地名只找到乡镇时改查“X市”，周口取河南周口市',async()=>{
 const u=geocoder({周口:[geo('周口','四川','南充市','PPLA3',0),geo('周口','广西','玉林市','PPL',0),geo('周口','河南','洛阳市','PPL',0)],周口市:[geo('周口市','河南','周口市','PPLA2',505171,33.61,114.65)]});
 const result=await createOpenMeteoWeatherTool({fetchImpl:u.fetchImpl,now:fixed}).query({location:'周口',period:'current-today'});
 assert.equal(result.status,'ok');assert.equal(result.location.name,'周口市');assert.equal(result.location.admin1,'河南');assert.equal(result.locationConfidence,undefined);
 assert.deepEqual(u.calls.slice(0,2),['周口','周口市']);
});
test('只有同名村庄时仍给数据但标记地点可信度低，好的城市匹配不多发请求',async()=>{
 const weak=geocoder({荥阳:[geo('荥阳','云南','保山市','PPL',0,25.29,98.5)]});
 const result=await createOpenMeteoWeatherTool({fetchImpl:weak.fetchImpl,now:fixed}).query({location:'荥阳',period:'current-today'});
 assert.equal(result.status,'ok');assert.equal(result.locationConfidence,'low');assert.deepEqual(weak.calls,['荥阳','荥阳市','荥阳县','forecast']);
 const strong=geocoder({郑州:[geo('郑州','河南','郑州市','PPLA',6650532)]});
 await createOpenMeteoWeatherTool({fetchImpl:strong.fetchImpl,now:fixed}).query({location:'郑州',period:'current-today'});
 assert.deepEqual(strong.calls,['郑州','forecast']);
});
