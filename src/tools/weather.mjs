export class WeatherToolError extends Error {constructor(message,status=502){super(message);this.status=status;}}
const weatherPattern=/(天气|气温|温度|下雨|降雨|降雪|风力|湿度|空气质量|紫外线|穿衣指数)/i;
const tomorrowPattern=/(明天|明日|翌日)/;
const dayAfterPattern=/后天/;
const currentPattern=/(现在|当前|此刻|实时|今天|今日)/;
const futureWeekPattern=/(?:未来|接下来|今后|后面)(?:一周|七天|7天)|这一周|这周|本周/;
const futureMonthPattern=/(?:未来|接下来|今后|后面)(?:一个月|一月|30天|30日)|未来30天/;
const ambiguousWeekPattern=/最近(?:一周|七天|7天)/;
const maxBody=512*1024;

function targetWeatherDate(query,now){
  const match=String(query||'').match(/(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)/);
  if(!match)return undefined;const [,explicitYear,month,day]=match,baseYear=Number(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric'}).format(now)),year=Number(explicitYear||baseYear),m=Number(month),d=Number(day);
  if(m<1||m>12||d<1||d>new Date(Date.UTC(year,m,0)).getUTCDate())return undefined;
  return `${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

export function parseWeatherQuestion(query,{now=new Date()}={}){
  if(typeof query!=='string'||!weatherPattern.test(query))return null;
  const numericDays=query.match(/([2-7])\s*天/),days=numericDays?Number(numericDays[1]):undefined;
  const targetDate=targetWeatherDate(query,now);
  const period=ambiguousWeekPattern.test(query)?'ambiguous-week':futureMonthPattern.test(query)?'next-month':futureWeekPattern.test(query)||days===7?'next-seven-days':days?'next-days':targetDate?'specific-date':dayAfterPattern.test(query)?'day-after-tomorrow':tomorrowPattern.test(query)?'tomorrow':'current-today';
  let location=query.trim()
    .replace(/https?:\/\/\S+/gi,' ')
    .replace(/(?:(?:20\d{2})\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*(?:日|号)/g,' ')
    .replace(/(请问|麻烦|帮我|查一下|查询|告诉我|想知道|看看|那|那么)/g,' ')
    .replace(/(帮|请|并(?:且|显示)?|同时|然后|显示|给我|一下)/g,' ')
    .replace(/从(?:今天|今日|现在)到(?:接下来|未来|今后|后面)?\s*[2-7]\s*天/g,' ')
    .replace(/从(?:今天|今日|现在)到/g,' ')
    .replace(/[2-7]\s*天/g,' ')
    .replace(/(后天|明天|明日|翌日|今天|今日|现在|当前|此刻|实时|最近|未来|接下来|今后|后面|这一周|这周|本周|一个月|一月|30天|30日|一周|七天|7天|未来(?:一|1)天)/g,' ')
    .replace(/(的)?(天气预报|天气|气温|温度|下雨|降雨|降雪|风力|湿度|空气质量|紫外线|穿衣指数)/g,' ')
    .replace(/(是什么样|什么样|会不会|将会|会|将|怎么样|如何|怎样|多少|情况|呢|吗|呀|啊|？|\?|。|，|,|、|；|;|\s+)/g,' ')
    .replace(/\s+/g,' ').trim().replace(/^(?:的\s*)+|(?:\s*的)+$/g,'').trim();
  const parts=location.split(' ').filter(Boolean);location=parts.filter((part,index)=>parts.indexOf(part)===index).join(' ');
  if(location.length<2)location='';
  return {intent:'weather',period,location,timezone:'Asia/Shanghai',...(period==='next-days'?{days}:{}),...(targetDate?{targetDate}:{})};
}

function weatherLabel(code){
  if(code===0)return'晴';if([1,2].includes(code))return'晴间多云';if(code===3)return'阴或多云';if([45,48].includes(code))return'雾';
  if([51,53,55,56,57].includes(code))return'毛毛雨';if([61,63,65,66,67,80,81,82].includes(code))return'雨';
  if([71,73,75,77,85,86].includes(code))return'雪';if([95,96,99].includes(code))return'雷暴';return`天气代码${code}`;
}
function shanghaiDate(now){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
function nextDate(date){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
function finite(value){return typeof value==='number'&&Number.isFinite(value);}
function locationCandidates(requested){
  const values=[requested.trim()],withoutCountry=requested.replace(/^(?:中国|中华人民共和国)/,'').trim(),city=withoutCountry.match(/(?:.+?(?:省|自治区|特别行政区))?(.{2,12}?)(?:市|自治州)$/)?.[1];
  values.push(withoutCountry);if(city)values.push(city);if(/.{2,12}[市区县]$/.test(withoutCountry))values.push(withoutCountry.slice(0,-1));
  const terminal=withoutCountry.match(/(?:省|市|自治区)([^省市]{2,12})[市县区]?$/)?.[1]?.replace(/[市县区]$/,'');
  if(terminal)values.push(terminal);
  // 连写地名的末级候选必须通过上级行政区核验，不能直接丢弃用户限定。
  const stem=withoutCountry.replace(/[市县区]$/,'');
  if(/^[\p{Script=Han}]{4,20}$/u.test(stem))for(let offset=2;offset<=stem.length-2;offset++)values.push(stem.slice(offset));
  return [...new Set(values.filter(value=>value.length>=2))].slice(0,8);
}

function matchesAdministrativeContext(requested,place){
  const compact=value=>String(value||'').replace(/中华人民共和国/g,'中国').replace(/特别行政区|自治区|自治州|省|市|县|区|\s/g,'');
  const query=compact(requested),name=compact(place.name);
  if(!name||!query.endsWith(name))return false;
  const parent=query.slice(0,-name.length);
  if(!parent)return true;
  const hierarchy=[place.country,place.admin1,place.admin2,place.admin3,place.admin4].map(compact).filter(Boolean).join('');
  return hierarchy.includes(parent);
}

async function fetchJson(url,{signal,timeoutMs,fetchImpl}){
  signal?.throwIfAborted();const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),timeoutMs);const combined=signal?AbortSignal.any([signal,timeout.signal]):timeout.signal;
  try{
    const response=await fetchImpl(url,{redirect:'error',signal:combined,headers:{Accept:'application/json'}});
    if(!response.ok){await response.body?.cancel();throw new WeatherToolError('结构化天气服务暂时不可用',response.status===429?429:502);}
    const reader=response.body?.getReader();if(!reader)throw new WeatherToolError('天气服务没有返回内容');
    const chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBody){await reader.cancel();throw new WeatherToolError('天气服务返回内容过大');}chunks.push(value);}
    combined.throwIfAborted();const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new WeatherToolError('天气服务返回格式错误');}
  }
  catch(error){if(signal?.aborted)signal.throwIfAborted();if(timeout.signal.aborted)throw new WeatherToolError('天气查询超时',504);if(error instanceof WeatherToolError)throw error;throw new WeatherToolError('无法连接结构化天气服务');}finally{clearTimeout(timer);}
}

// GeoNames feature codes: capital, provincial seat, prefecture seat, county seat, township.
const featureRank=place=>({PPLC:5,PPLA:4,PPLA2:3,PPLA3:2,PPLA4:1})[place?.feature_code]||0;
// A village-level match with no population is often a namesake of the city the user
// meant ("荥阳" returns only a village in Yunnan; "周口" only townships, while "周口市"
// finds the city).
const weakPlace=place=>!place||!((place.population||0)>0)&&featureRank(place)<3;
function chooseLocation(requested,results){
  const valid=(Array.isArray(results)?results:[]).filter(x=>typeof x?.name==='string'&&finite(x.latitude)&&finite(x.longitude)&&typeof x.timezone==='string');
  if(!valid.length)return {error:'没有找到该地点，请补充城市或行政区名称'};
  // 城市行政后缀不应使同名小聚落挤掉真正的城市候选。
  const normalizeName=value=>value.trim().toLocaleLowerCase().replace(/[市县区]$/u,'');
  const exact=valid.filter(x=>normalizeName(x.name)===normalizeName(requested));const candidates=exact.length?exact:valid;
  candidates.sort((a,b)=>featureRank(b)-featureRank(a)||(b.population||0)-(a.population||0));
  if(candidates.length>1){const a=candidates[0],b=candidates[1],sameArea=a.country_code===b.country_code&&a.admin1===b.admin1;if(!sameArea&&featureRank(a)===featureRank(b)&&(a.population||0)<Math.max(1,(b.population||0))*5)return {ambiguous:candidates.slice(0,3).map(x=>[x.name,x.admin1,x.country].filter(Boolean).join('，'))};}
  return {location:candidates[0]};
}

export function createOpenMeteoWeatherTool({fetchImpl=fetch,timeoutMs=10000,now=()=>new Date()}={}){
  return {id:'open-meteo',enabled:true,
    async query(intent,{signal}={}){
      if(Array.isArray(intent?.locations)&&intent.locations.length>1)return {status:'needs-location',question:`已识别到${intent.locations.slice(0,2).join('和')}两个地点；当前天气查询一次支持一个地点，请选择其中一个城市。`,locations:intent.locations.slice(0,2)};
      if(!intent?.location&&!intent?.coordinates)return {status:'needs-location',question:'请告诉我需要查询哪个城市或地区的天气，或允许TalkCraft使用当前位置。'};
      if(intent.period==='ambiguous-week')return {status:'needs-period',question:`你想查询${intent.location}过去七天的历史天气，还是从今天开始的未来七天天气？`};
      if(intent.period==='next-month')return {status:'unsupported-range',provider:'open-meteo',location:{name:intent.location},question:'当前天气服务不提供未来一个月的逐日预报；可以查询未来七天，或查看气候统计。'};
      const started=Date.now();
      let geocode,places,selected,coordinates=null,lowConfidence=false;
      const supplied=intent.coordinates;
      if(supplied&&Number.isFinite(supplied.latitude)&&Number.isFinite(supplied.longitude)&&Math.abs(supplied.latitude)<=90&&Math.abs(supplied.longitude)<=180)coordinates={latitude:Math.round(supplied.latitude*100)/100,longitude:Math.round(supplied.longitude*100)/100};
      if(coordinates)selected={location:{name:'当前位置附近',admin1:'',admin2:'',country:'',country_code:'CN',timezone:'Asia/Shanghai',...coordinates}};
      else{
       for(const name of locationCandidates(intent.location)){geocode=new URL('https://geocoding-api.open-meteo.com/v1/search');geocode.search=new URLSearchParams({name,count:'10',language:'zh',format:'json'}).toString();places=await fetchJson(geocode,{signal,timeoutMs,fetchImpl});const results=name===intent.location&&!/[\p{Script=Han}]/u.test(intent.location)?places.results:(places.results||[]).filter(place=>matchesAdministrativeContext(intent.location,place));selected=chooseLocation(name,results);if(!selected.error)break;}
       if(selected.error)return {status:'needs-location',question:selected.error};
       if(selected.ambiguous)return {status:'ambiguous-location',question:`“${intent.location}”可能指多个地点，请选择：${selected.ambiguous.join('；')}。`,options:selected.ambiguous};
       // Only a weak namesake came back for a bare name: the city form often exists
       // under "X市"/"X县". This costs at most two extra lookups and only in that case.
       if(weakPlace(selected.location)&&/^[\p{Script=Han}]{2,4}$/u.test(intent.location)){
        for(const name of [`${intent.location}市`,`${intent.location}县`]){const url=new URL('https://geocoding-api.open-meteo.com/v1/search');url.search=new URLSearchParams({name,count:'10',language:'zh',format:'json'}).toString();let retry;try{retry=chooseLocation(name,(await fetchJson(url,{signal,timeoutMs,fetchImpl})).results);}catch(error){if(signal?.aborted)throw error;break;}if(retry.location&&!weakPlace(retry.location)){selected=retry;geocode=url;break;}}
       }
       if(weakPlace(selected.location)&&!/[省市县区]/u.test(intent.location))lowConfidence=true;
      }
      const place=selected.location,timezone=coordinates?'Asia/Shanghai':place.country_code==='CN'?'Asia/Shanghai':place.timezone;
      const requestedDays=intent.period==='next-seven-days'?7:intent.period==='next-days'?intent.days:intent.period==='day-after-tomorrow'?3:2;
      if(!Number.isInteger(requestedDays)||requestedDays<2||requestedDays>7)throw new WeatherToolError('天气预报范围必须为2至7天',400);
      const today=shanghaiDate(now());let targetOffset=0;
      if(intent.targetDate){const offset=(Date.parse(`${intent.targetDate}T00:00:00Z`)-Date.parse(`${today}T00:00:00Z`))/86400000;if(!Number.isInteger(offset)||offset<0||offset>15)return {status:'date-out-of-range',provider:'open-meteo',timezone,location:{name:place.name,admin1:place.admin1||'',admin2:place.admin2||'',country:place.country||''},requestedDate:intent.targetDate,question:`${intent.targetDate}不在当前可查询的未来天气范围内。`};targetOffset=offset;}
      const forecastDays=Math.max(requestedDays,targetOffset+1),forecast=new URL('https://api.open-meteo.com/v1/forecast');forecast.search=new URLSearchParams({latitude:String(place.latitude),longitude:String(place.longitude),timezone,current:'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',forecast_days:String(forecastDays)}).toString();
      const data=await fetchJson(forecast,{signal,timeoutMs,fetchImpl});const expected=intent.targetDate||(intent.period==='tomorrow'?nextDate(today):intent.period==='day-after-tomorrow'?nextDate(nextDate(today)):today),index=data?.daily?.time?.indexOf(expected);
      if(!Array.isArray(data?.daily?.time)||index<0)throw new WeatherToolError('天气服务没有返回所需日期的数据');
      const makeDaily=i=>({date:data.daily.time[i],condition:weatherLabel(data.daily.weather_code?.[i]),weatherCode:data.daily.weather_code?.[i],temperatureMax:data.daily.temperature_2m_max?.[i],temperatureMin:data.daily.temperature_2m_min?.[i],precipitationProbabilityMax:data.daily.precipitation_probability_max?.[i],windSpeedMax:data.daily.wind_speed_10m_max?.[i]}),daily=makeDaily(index),forecasts=['next-seven-days','next-days'].includes(intent.period)?data.daily.time.slice(0,requestedDays).map((_,offset)=>makeDaily(offset)):undefined;
      if(!finite(daily.temperatureMax)||!finite(daily.temperatureMin))throw new WeatherToolError('天气服务返回的预报数据不完整');
      if(forecasts&&(forecasts.length!==requestedDays||forecasts.some(item=>!finite(item.temperatureMax)||!finite(item.temperatureMin))))throw new WeatherToolError('天气服务没有返回完整的多日预报');
      let current;
      if(intent.period==='current-today'){
        if(typeof data?.current?.time!=='string'||!data.current.time.startsWith(today)||!finite(data.current.temperature_2m))throw new WeatherToolError('天气服务返回的实时观测数据缺失或日期不符');
        current={observedAt:data.current.time,condition:weatherLabel(data.current.weather_code),weatherCode:data.current.weather_code,temperature:data.current.temperature_2m,apparentTemperature:data.current.apparent_temperature,humidity:data.current.relative_humidity_2m,precipitation:data.current.precipitation,windSpeed:data.current.wind_speed_10m};
      }
      return {status:'ok',provider:'open-meteo',period:intent.period,timezone,location:{name:place.name,admin1:place.admin1||'',admin2:place.admin2||'',country:place.country||'',...(coordinates?{}:{latitude:place.latitude,longitude:place.longitude})},...(lowConfidence?{locationConfidence:'low'}:{}),...(intent.targetDate?{requestedDate:intent.targetDate}:{}),...(current?{current}:{}),forecast:daily,...(forecasts?{forecasts}:{}),elapsedMs:Date.now()-started,sources:coordinates?[{title:'Open-Meteo Weather Forecast API',url:'https://open-meteo.com/en/docs'}]:[{title:'Open-Meteo Weather Forecast API',url:forecast.href},{title:'Open-Meteo Geocoding API / GeoNames',url:geocode.href}]};
    }};
}
