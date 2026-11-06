import {parseWeatherQuestion} from './tools/weather.mjs';
import {createAgentToolRegistry} from './tools/registry.mjs';
import {createHash,randomUUID} from 'node:crypto';

const temperature=/-?\d+(?:\.\d+)?\s*(?:℃|°C|摄氏度)/i;
const condition=/(晴|阴|多云|小雨|中雨|大雨|暴雨|阵雨|雷雨|雨夹雪|雪|雾|霾|台风)/;
const timeSensitive=/(今天|今日|明天|明日|现在|当前|此刻|实时|最新|近期|新闻|价格|股价|汇率|赛程|比分|政策|版本|更新|发布|天气|气温)/;
const explicitSearch=/(?:帮(?:我)?|请|麻烦|给我)\s*查(?:一下|一查|查查|找|找一下)?|(?<!检|排|核|审|调|复)查(?:一下|一查|查查|找|找一下)|查询|搜索|检索|联网查|网上查|搜一下|找一下资料|了解一下/;
const productCategoryPatterns=[['充电宝',/充电宝|移动电源|power\s*bank/i],['手机',/手机|smart\s*phones?|iphone|android\s*phones?|pixel\s*phones?|\bphones?\b/i],['汽车',/汽车|车型|新车|车辆|车子|轿车|电动车|suv/i],['平板',/平板电脑|平板|tablet|ipad/i],['电脑',/笔记本电脑|笔记本|电脑|laptop|macbook/i],['耳机',/耳机|耳塞|headphones?|airpods/i],['相机',/相机|摄像机|camera/i],['手表',/智能手表|手表|watch/i],['电视',/电视|电视机|television|smart\s*tv/i],['路由器',/路由器|router/i],['显卡',/显卡|graphics\s*card/i],['芯片',/芯片|处理器|processor|chip/i],['设备',/设备|产品/]];
const productResearch=/(产品|车型|汽车|新车|车子|车辆|轿车|手机|电脑|相机|芯片|设备|型号|充电宝|移动电源|平板|耳机|手表|电视|路由器|显卡).{0,32}(参数|配置|规格|价格|售价|上市|发布|发售|版本|年款|续航|尺寸|电池|动力|性能|效果|评测|怎么样|如何)|(参数|配置|规格|价格|售价|上市|发布|发售|版本|年款|续航|尺寸|电池|动力|性能|效果|评测).{0,32}(产品|车型|汽车|新车|车子|车辆|轿车|手机|电脑|相机|芯片|设备|型号|充电宝|移动电源|平板|耳机|手表|电视|路由器|显卡)|(?:[\p{Script=Han}]{2,8}\s*[A-Za-z]?\d{1,4}(?:\s*(?:Pro|Max|Ultra|Plus))?).{0,18}(?:参数|配置|规格|价格|售价|续航)|(?:详细|完整).{0,8}(参数|数据|配置)|(?:什么样的|存在吗|有没有).{0,8}(车|产品|型号)/iu;
const latestProductCategory=/(?:(?:最新款|最新(?:发布)?|新款|最近发布|今年发布)(?:的)?.{0,12}(?:手机|汽车|电脑|相机|芯片|设备|车型|车子|充电宝|移动电源|平板|耳机|手表|电视|路由器|显卡)|(?:手机|汽车|电脑|相机|芯片|设备|车型|车子|充电宝|移动电源|平板|耳机|手表|电视|路由器|显卡).{0,12}(?:最新款?|新款|最近发布|今年发布|目前在售))/i;
const urlPattern=/https?:\/\/[^\s]+/i;
const sensitiveParam=/(?:^|[_-])(api[_-]?key|access[_-]?(?:token|key)|token|auth(?:orization)?|bearer|secret|signature|sig|credential|password|session|cookie)(?:$|[_-])/i;
export function safeSourceUrl(value){try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return'';for(const key of [...url.searchParams.keys()])if(sensitiveParam.test(key))url.searchParams.delete(key);url.hash='';return url.toString();}catch{return'';}}
const sourceId=value=>'source-'+createHash('sha256').update(value).digest('hex').slice(0,12);
export function presentSource(source){const url=safeSourceUrl(source?.url);if(!url)return null;const snippet=typeof source?.snippet==='string'?source.snippet.trim().slice(0,1200):'';return {...source,url,sourceId:sourceId(url),domain:new URL(url).hostname,evidenceState:source.readStatus==='read'?'read':source.readStatus==='failed'?'read-failed':snippet?'summary':'hit',...(snippet?{snippet}:{})};}

function shanghaiDate(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
function nextDate(date){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
function includesDate(text,date){const [y,m,d]=date.split('-').map(Number),full=[...text.matchAll(/(20\d{2})[-年](\d{1,2})[-月](\d{1,2})(?:日)?/g)].map(match=>`${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`);if(full.length)return full.includes(date);return text.includes(`${m}月${d}日`);}
// Only explicitly verified manufacturer domains are treated as official by hostname.
// A title claiming to be official is not proof when it is hosted elsewhere.
const verifiedManufacturerHosts=new Set(['lixiang.com','apple.com','apple.com.cn','mi.com','oneplus.com','oppo.com','cuktech.com.cn']);
export function verifiedManufacturerSource(source){try{const host=new URL(source?.url).hostname.toLowerCase();return [...verifiedManufacturerHosts].some(domain=>host===domain||host.endsWith(`.${domain}`));}catch{return false;}}
function likelyOfficial(source){try{const host=new URL(source?.url).hostname.toLowerCase();return verifiedManufacturerSource(source)||host.startsWith('ir.')||host.startsWith('investor.')||/(^|\.)(official)\./.test(host);}catch{return false;}}
function categoryMatches(product,text){const entry=productCategoryPatterns.find(([name])=>name===product?.category);return !!entry?.[1].test(String(text||''));}
function explicitModelMatches(model,text){if(!model)return false;const value=String(text||''),tokens=String(model).match(/[A-Za-z]+|\d+/g)||[],numberIndex=tokens.findIndex(token=>/^\d+$/.test(token)),number=tokens[numberIndex];if(!number)return compactProductText(value).includes(compactProductText(model));const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),escaped=escape(number),brand=tokens.slice(0,numberIndex).find(token=>/^[A-Za-z]/.test(token)),suffixes=tokens.slice(numberIndex+1);if(brand&&!new RegExp(`(?:^|[^A-Za-z0-9])${escape(brand)}\\s*[- ]?\\s*${escaped}(?:[^A-Za-z0-9]|$)`,'i').test(value))return false;if(!new RegExp(`(?:^|[^0-9])${escaped}(?:号)?(?:[^0-9]|$)`,'i').test(value))return false;if(!suffixes.length)return true;const at=value.search(new RegExp(`(?:^|[^0-9])${escaped}(?:号)?`,'i')),tail=value.slice(Math.max(0,at),Math.max(0,at)+100),suffixPattern=suffixes.map(escape).join('[\\s-]*');return new RegExp(`(?:^|[^A-Za-z0-9])${suffixPattern}(?:[^A-Za-z0-9]|$)`,'i').test(tail)||(/Ultra/i.test(suffixes.at(-1))&&new RegExp(`${escaped}号.{0,36}Ultra`,'i').test(tail));}
function compactProductText(value){return String(value||'').toLowerCase().replace(/[^\p{Script=Han}a-z0-9]/gu,'');}
function modelDigitsStart(text,digits){const match=new RegExp(`(?:^|[^0-9])(${digits})(?:号)?`).exec(String(text||''));return match?match.index+match[0].lastIndexOf(match[1]):-1;}
function chineseAliasNearModel(brand,text,model){if(!brand||![...brand].every(char=>/\p{Script=Han}/u.test(char))||brand.length<3||!model)return false;const value=String(text||''),digits=model.match(/\d+/)?.[0];if(!digits)return false;const at=modelDigitsStart(value,digits);if(at<0)return false;const before=value.slice(Math.max(0,at-16),at),matches=before.match(/[\p{Script=Han}]{3,8}/gu)||[];return matches.some(candidate=>levenshteinAtMostOne(brand,candidate));}
function levenshteinAtMostOne(left,right){const a=[...left],b=[...right];if(Math.abs(a.length-b.length)>1)return false;let i=0,j=0,edits=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}return edits+(i<a.length||j<b.length?1:0)<=1;}
function nearbyChineseBrandCandidate(product,source){if(!product?.brand||!product?.explicitModel)return'';const text=[source?.title,source?.snippet].filter(Boolean).join('\n'),digits=product.explicitModel.match(/\d+/)?.[0];if(!digits||!explicitModelMatches(product.explicitModel,text)||!categoryMatches(product,text))return'';const at=modelDigitsStart(text,digits);if(at<0)return'';const prefix=text.slice(Math.max(0,at-20),at),words=prefix.match(/[\p{Script=Han}]{3,8}/gu)||[];return words.reverse().find(word=>word!==product.brand&&levenshteinAtMostOne(product.brand,word))||'';}
function productNameCorrections(product,sources){const candidates=new Map();for(const source of sources){const name=nearbyChineseBrandCandidate(product,source);if(!name)continue;const url=safeSourceUrl(source.url);if(!url)continue;const host=new URL(url).hostname.toLowerCase();const item=candidates.get(name)||{name,hosts:new Set(),sourceIds:[]};item.hosts.add(host);const stable=presentSource(source)?.sourceId;if(stable)item.sourceIds.push(stable);candidates.set(name,item);}return [...candidates.values()].filter(item=>item.hosts.size>=2).map(item=>({originalBrand:product.brand,candidateBrand:item.name,confidence:'high',sourceIds:[...new Set(item.sourceIds)].slice(0,4),instruction:'只可作为本次检索的候选规范名；不要改写原始转录或自动写入词典'}));}
// Cross-language product names are identity evidence only; parsing and evidence thresholds stay category/model based.
const brandAliases=[['苹果','apple'],['苹果','iphone'],['小米','xiaomi'],['小米','redmi'],['理想','li auto'],['一加','oneplus'],['酷泰科','酷态科'],['酷泰科','cuktech'],['酷态科','cuktech']];
function productSubjectMatches(product,text){const value=String(text||'');if(product?.explicitModel&&!explicitModelMatches(product.explicitModel,value))return false;if(!product?.explicitModel&&product?.modelCode){const escaped=product.modelCode.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(!new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`,'i').test(value))return false;}const brand=String(product?.brand||'');const normalized=compactProductText(value),brandMatched=!brand||normalized.includes(compactProductText(brand))||brandAliases.some(([from,to])=>compactProductText(brand)===compactProductText(from)&&normalized.includes(compactProductText(to)))||chineseAliasNearModel(brand,value,product?.explicitModel||product?.modelCode);return brandMatched&&(!product?.category||categoryMatches(product,value));}
export function searchSourcePriority(query,source){const product=analyzeProductQuestion(query);if(!product)return 0;const evidence=[source?.title,source?.snippet,source?.url].filter(Boolean).join('\n'),matches=productSubjectMatches(product,evidence),manufacturer=verifiedManufacturerSource(source);return (matches?100:0)+(manufacturer?50:0)+(source?.snippet?1:0);}
export function analyzeProductQuestion(query){
  const namedModel=typeof query==='string'&&/(?:[\p{Script=Han}]{2,8}\s*[A-Za-z]?\d{1,4}(?:\s*(?:Pro\s*Max|Pro|Max|Ultra|Plus|Mini|Air|SE|GT))?|[A-Za-z][A-Za-z0-9-]{2,}\s+\d{1,4}(?:\s*(?:Pro\s*Max|Pro|Max|Ultra|Plus|Mini|Air|SE|GT))?)/iu.test(query);
  if(typeof query!=='string'||!productResearch.test(query)&&!latestProductCategory.test(query)&&!(explicitSearch.test(query)&&namedModel))return null;
  const raw=query.trim(),categoryEntry=productCategoryPatterns.map(([name,pattern])=>({name,match:pattern.exec(raw)})).filter(item=>item.match).sort((a,b)=>a.match.index-b.match.index||b.match[0].length-a.match[0].length)[0];
  let category=categoryEntry?.name||'';const categoryStart=categoryEntry?.match.index??raw.length;
  if(category==='设备'&&!/(明确的设备|该设备|此设备|这款设备)/.test(raw))category='';
  const latest=/(?:最新款|最新(?:发布)?|新款|最近发布|今年发布|目前在售)/i.test(raw),explicitSearchRequested=explicitSearch.test(raw);
  const suffixes='(?:Ultra|Pro\\s*Max|Pro|Max|Plus|Mini|Air|SE|GT|S|X|号|代|款)';
  const westernBrandModel=raw.match(new RegExp(`(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9-]{2,})\\s+(\\d{1,4}(?:\\s+${suffixes})?)(?![A-Za-z0-9])`,'i'));
  let modelMatch=westernBrandModel?{0:westernBrandModel[2],index:westernBrandModel.index+westernBrandModel[1].length+1}:raw.match(new RegExp(`(?<![A-Za-z0-9])(?:([A-Za-z][A-Za-z0-9-]*\\s*[- ]?\\s*\\d{1,4}(?:\\s+${suffixes})?)|(\\d{1,3}(?:\\s*号)?(?:\\s+${suffixes})?))(?![A-Za-z0-9])`,'i'));
  const modelIsYear=!!modelMatch&&/^20\d{2}$/.test(modelMatch[0].trim())&&/^\s*(?:款|年)/.test(raw.slice(modelMatch.index+modelMatch[0].length));
  if(modelIsYear)modelMatch=null;
  let explicitModel=modelMatch?.[0]?.replace(/\s+/g,' ').trim()||'';
  const modelTail=modelMatch?raw.slice(modelMatch.index+modelMatch[0].length):'';
  const noisyModelTail=!!modelMatch&&/^\s*(?:放的|发的|放|发|方|这个用型号|的这个用|的用型号)/.test(modelTail);
  let brand='';
  const cleanPrefix=value=>{let result=value.replace(/^[\s，,。；;：:]+|[\s，,。；;：:]+$/g,'');for(let i=0;i<3;i++)result=result.replace(/^(?:(?:那你|那么你|我最近买了一个|我买了一个|我最近买了|我买了|请问|麻烦|帮我|帮|请|给我|我需要获取|我想了解|我想知道|想了解|想知道|我需要|需要|上网|联网|网上|网络|查询|查找|查(?:询|找)?(?:一下|一查)?|搜(?:索|一下|一搜)?|检索|了解一下|了解|介绍|查看|找到|根据|关于|报道称|报道|新闻里|发布会中|最新的?|新款)\s*)+/i,'').replace(/^20\d{2}\s*款?\s*/,'').replace(/^(?:的|相关|有关)+/,'').replace(/(?:(?:最新|新款|最近|今年)?(?:发布|推出|上市|发售)?(?:最新款?|最新发布|最新|新款|最近发布|今年发布|目前在售)?|相关性|相关|这个新的|新的|这个|该产品|车型|车子|汽车|手机|型号|报道|的|呢)+$/gi,'').trim();return result;};
  let modelLine='';
  if(/\bmacbook\b/i.test(raw)){brand='Apple';modelLine=/\bmacbook\s*pro\b/i.test(raw)?'MacBook Pro':'MacBook';category='电脑';}
  else if(/\biphone\b/i.test(raw)){brand='Apple';modelLine='iPhone';category='手机';}
  else if(/苹果\s*\d{1,2}(?:\s*(?:Pro\s*Max|Pro|Max|Plus|Mini|SE))?/i.test(raw)){brand='苹果';modelLine='iPhone';category='手机';}
  if(!brand&&categoryEntry){let prefix=raw.slice(0,categoryStart).trim();if(westernBrandModel&&westernBrandModel.index<categoryStart)brand=westernBrandModel[1];else if(modelMatch&&modelMatch.index<categoryStart)prefix=prefix.slice(0,modelMatch.index)+prefix.slice(modelMatch.index+modelMatch[0].length);if(!brand)brand=cleanPrefix(prefix);}
  if(!brand&&modelMatch){brand=cleanPrefix(raw.slice(0,modelMatch.index));}
  brand=brand.replace(/[？?，,。；;：:\s]+$/g,'').slice(-32);
  const userModel=explicitModel; if(noisyModelTail)explicitModel='';
  const modelCode=explicitModel.match(/[A-Za-z]+\s*[- ]?\s*\d+/)?.[0].replace(/\s+/g,'').toLowerCase();
  const subject=explicitModel?(/^[\p{Script=Han}]+$/u.test(brand)?`${brand}${modelLine}${explicitModel}`:[brand,modelLine,explicitModel].filter(Boolean).join(' ')):[brand,modelLine,category].filter(Boolean).join('')||category;
  const requestedAspects=[];if(/参数|规格|配置|性能|续航|尺寸|电池|动力|接口|容量|芯片|屏幕|相机/i.test(raw))requestedAspects.push(/参数|规格/.test(raw)?'参数':'配置');if(/价格|售价|多少钱|报价|元起|价格/i.test(raw))requestedAspects.push('价格');if(/效果|怎么样|如何|评测|口碑|好不好|体验/i.test(raw))requestedAspects.push('评价');if(latest)requestedAspects.push('最新型号/发布时间');if(/上市|发布|发售|开售/.test(raw)&&!requestedAspects.includes('最新型号/发布时间'))requestedAspects.push('上市/发布时间');
  const requestedFields=[['价格',/价格|售价|多少钱|报价|元起/],['续航',/续航|里程/],['容量',/容量|毫安时/],['接口',/接口|端口/],['重量',/重量/],['屏幕',/屏幕|显示屏/],['芯片',/芯片|处理器/],['相机',/相机|摄像头/],['电池',/电池/],['充电',/充电(?!宝)|快充/],['动力',/动力|电机|功率|扭矩/]].filter(([,pattern])=>pattern.test(raw)).map(([name])=>name);
  const requestedYear=(raw.match(/20\d{2}(?:款|年)/)||[])[0],region=(raw.match(/中国大陆|中国|美国|欧洲|欧盟|英国|日本|全球/)||[])[0];
  const cleaned=raw.replace(/^(?:(?:请问|麻烦|帮我|帮|请|给我)\s*)?/,'').trim();
  const requestedModel=explicitModel||(!noisyModelTail?userModel:'');
  return {intent:'product-research',tool:'web-search',subject,brand,category,modelLine,explicitModel,modelCode,latest,requestedAspects:[...new Set(requestedAspects)],requestedFields,originalQuestion:raw,searchQuery:cleaned,requestedModel,priceType:/成交|成交价|成交价格/.test(raw)?'transaction':/挂牌|在售/.test(raw)?'listing':/回收价|回收报价/.test(raw)?'buyback':undefined,marketplace:/闲鱼|咸鱼/.test(raw)?'闲鱼':/转转/.test(raw)?'转转':undefined,suspectedCandidates:noisyModelTail&&userModel?[{model:userModel,confirmed:false,source:'user',reason:'型号后存在可能的语音识别噪声'}]:[],needsClarification:noisyModelTail,detailed:/(详细|完整|全部|参数|配置表|规格|数据|性能|配置)/.test(raw),requestedYear,region,ambiguities:noisyModelTail?['型号附近存在疑似语音识别错误，不能将候选型号当作已确认对象']:[]};
}

export function classifyQuestionIntent(query){
  const weather=parseWeatherQuestion(query);if(weather)return {...weather,tool:'weather'};
  const url=query.match(urlPattern)?.[0];if(url)return {intent:'url-read',tool:'webpage',url};
  const product=analyzeProductQuestion(query);if(product)return product;
  if(timeSensitive.test(query)||explicitSearch.test(query))return {intent:'time-sensitive',tool:'web-search'};
  return {intent:'general',tool:'none'};
}

const evidenceFacets=[
  {name:'价格',query:/(价格|售价|多少钱|报价)/,evidence:/(价格|售价|人民币|rmb|万元|元起|¥|￥)/i},
  {name:'续航',query:/(续航|里程|range)/i,evidence:/(续航|里程|cltc|wltp|epa|\d+\s*(?:公里|km))/i},
  {name:'参数配置',query:/(参数|配置|规格|配置表)/,evidence:/(参数|配置|规格|尺寸|轴距|电池|功率|扭矩|版本|trim|dimension|kwh|kw)/i},
  {name:'上市发布',query:/(上市|发布|发售|开售|交付)/,evidence:/(上市|发布|发售|开售|交付|launch|delivery)/i},
  {name:'开放时间',query:/(开放时间|营业时间|几点开门|几点关门)/,evidence:/(开放|营业|开门|闭馆|闭店|\d{1,2}[:：]\d{2})/i},
  {name:'地址地点',query:/(地址|在哪里|怎么去|地点)/,evidence:/(地址|位于|坐落|路|街|号|location)/i},
];
const productFacetPatterns={
  手机:[['芯片',/芯片|处理器|骁龙|天玑|a\d{1,2}\s*(?:pro|bionic)?|processor|chip/i],['屏幕',/屏幕|显示屏|英寸|刷新率|分辨率|display|hz/i],['电池',/电池|容量|mah|续航/i],['充电',/充电|快充|w\s*(?:有线|无线)?/i],['相机',/相机|摄像头|主摄|像素|camera/i],['版本/价格',/版本|售价|价格|元起|rmb|¥|￥/i]],
  汽车:[['版本/年款',/年款|款型|版本|车型|trim/i],['动力',/电机|功率|扭矩|马力|kw|动力/i],['电池',/电池|kwh|千瓦时/i],['续航/标准',/续航|cltc|wltp|epa|公里|km/i],['尺寸',/毫米|mm|轴距|车长|车宽|车高|尺寸/i],['价格',/价格|售价|万元|元起|rmb|¥|￥/i]],
  充电宝:[['容量',/容量|mah|毫安时/i],['总功率/单口功率',/总功率|输出功率|单口|\d+\s*w|瓦/i],['输入',/输入|input|\d+\s*w/i],['接口',/接口|usb[- ]?c|type[- ]?c|端口/i],['重量',/重量|克|g\b/i],['价格',/价格|售价|元|rmb|¥|￥/i]],
};
function productFacetReport(product,text){const patterns=productFacetPatterns[product?.category]||[['核心参数',/参数|配置|规格|型号|性能/i],['量化指标',/\d+(?:\.\d+)?\s*(?:mm|毫米|km|公里|mah|kwh|kw|w|元|万元|%)/i],['价格',/版本|售价|价格|人民币|rmb|万元|元起|¥|￥/i],['续航/标准',/续航|里程|cltc|wltp|epa|\d+\s*(?:公里|km)/i],['版本/配置',/版本|车型|配置|发布|上市/i]];const matched=patterns.filter(([,pattern])=>pattern.test(text)).map(([name])=>name);const requestedMap={价格:['价格'],续航:['续航/标准'],容量:['容量'],接口:['接口'],重量:['重量'],屏幕:['屏幕'],芯片:['芯片'],相机:['相机'],电池:['电池'],充电:['充电'],动力:['动力']};const explicit=(product?.requestedFields||[]).flatMap(field=>requestedMap[field]||[]);if(product?.requestedAspects?.includes('评价'))explicit.push('评价');const specificallyRequested=[...explicit];if(product?.requestedAspects?.some(value=>value==='参数'||value==='配置'))specificallyRequested.push(...patterns.map(([name])=>name));const isMissing=name=>name==='评价'?!/(评测|测试|体验|实测|review|reviewed|口碑)/i.test(text):!matched.includes(name);const missing=specificallyRequested.filter(isMissing);return {available:matched,missing:[...new Set(missing)],requestedMissing:[...new Set(explicit.filter(isMissing))],minimumMet:matched.length>=2};}
const requestNoise=/(?:帮(?:我)?|请|麻烦|给我)?(?:查一下|查一查|查查|查找|查询|搜索|检索|联网查|网上查|搜一下|找一下资料|了解一下)|请问|关于|告诉我|介绍|我想知道|想知道|详细|具体|相关|资料|信息|情况|一下|怎么样|如何|是什么|有哪些|多少|目前|当前|最新|近期|现在|今日|今天|明天|今年|版本|消息|的|呢|吗|和|与|以及/gi;
function compactText(value){return String(value||'').toLowerCase().replace(/[^\p{Script=Han}a-z0-9]+/gu,'');}
// Question words and particles carry no subject identity; they are segment breaks for term matching.
const generalQuestionWords=/什么|哪里|哪儿|哪个|哪些|哪一|怎么|怎样|为什么|为何|多少|是不是|有没有|是否|最近|近来|大概|大约|左右|能不能|可不可以|[了吗呢吧啊呀嘛]/gu;
const escapeRegExp=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function relevanceTerms(value){
  const text=String(value||'').normalize('NFKC').toLowerCase().replace(generalQuestionWords,' ');
  const latin=[...new Set((text.match(/[a-z0-9][a-z0-9.+-]*/g)||[]).map(token=>token.replace(/[.+-]+$/,'')).filter(token=>token.length>=2||/\d/.test(token)))];
  const han=[...new Set((text.match(/\p{Script=Han}+/gu)||[]).flatMap(segment=>{const chars=[...segment];return chars.length<2?[]:chars.slice(0,-1).map((char,index)=>char+chars[index+1]);}))];
  return {latin,han};
}
// Share of subject terms found in evidence. Latin/number tokens weigh double because a
// brand or model token is a stronger identity signal than one Chinese character pair.
export function subjectCoverage(subject,text){
  const terms=relevanceTerms(subject),total=terms.latin.length*2+terms.han.length;if(!total)return 1;
  const haystack=String(text||'').normalize('NFKC').toLowerCase();
  const hits=terms.latin.filter(token=>new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(token)}(?:$|[^a-z0-9])`).test(haystack)).length*2+terms.han.filter(term=>haystack.includes(term)).length;
  return hits/total;
}
function analyzeGeneralQuestion(query){
  const requestedFacets=evidenceFacets.filter(item=>item.query.test(query)),requestedYears=[...new Set(query.match(/20\d{2}/g)||[])],wantsFresh=/(今天|今日|明天|现在|当前|此刻|实时|最新|近期|今年)/.test(query);
  let subject=String(query||'').replace(urlPattern,' ');for(const facet of evidenceFacets)subject=subject.replace(facet.query,' ');const subjectText=subject.replace(requestNoise,' ');subject=compactText(subjectText);
  const modelTokens=[...new Set((String(query).toLowerCase().match(/[a-z]+\s*-?\s*\d+[a-z0-9-]*/g)||[]).map(compactText))];
  return {subject,subjectText,modelTokens,requestedFacets,requestedYears,wantsFresh};
}
function assessGeneralText(query,text){
  const needs=analyzeGeneralQuestion(query),normalized=compactText(text),subjectMatched=!needs.subject||normalized.includes(needs.subject)||needs.modelTokens.some(token=>normalized.includes(token))||subjectCoverage(needs.subjectText,text)>=0.5;
  const matchedFacets=needs.requestedFacets.filter(item=>item.evidence.test(text)).map(item=>item.name),missingFacets=needs.requestedFacets.filter(item=>!item.evidence.test(text)).map(item=>item.name);
  const yearMatched=!needs.requestedYears.length||needs.requestedYears.some(year=>String(text).includes(year)),freshnessMatched=!needs.wantsFresh||needs.requestedYears.length?yearMatched:/(20\d{2}|\d{1,2}月\d{1,2}日|今天|今日|当前|实时|最新|updated|published)/i.test(text);
  return {...needs,subjectMatched,matchedFacets,missingFacets,yearMatched,freshnessMatched};
}
function newsDateFromText(value,now=new Date()){
 const text=String(value||''),today=shanghaiDate(now);let match=text.match(/(20\d{2})[-年/.](\d{1,2})[-月/.](\d{1,2})/);
 if(match){const date=`${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;return Number.isFinite(Date.parse(`${date}T00:00:00Z`))?date:null;}
 match=text.match(/(?:^|\D)(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/u);
 if(match){let year=Number(today.slice(0,4)),month=Number(match[1]),day=Number(match[2]);if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())return null;let date=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;if(date>today){year--;date=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;}return date;}
 match=text.match(/(\d+)\s*(?:hours?|hrs?|小时|分钟|minutes?)\s*ago|(\d+)\s*(?:days?|天)\s*(?:ago|前)/iu);
 if(match||/(?:yesterday|昨天)/iu.test(text)||/(?:day before yesterday|前天)/iu.test(text)){const days=match?.[2]?Number(match[2]):/前天|day before yesterday/iu.test(text)?2:/yesterday|昨天/iu.test(text)?1:0,date=new Date(`${today}T00:00:00Z`);date.setUTCDate(date.getUTCDate()-days);return date.toISOString().slice(0,10);}
 return null;
}
function compactNewsText(value){return String(value||'').toLocaleLowerCase().replace(/[^\p{Script=Han}a-z0-9]/gu,'');}
function assessNewsEvidence(result,request,now){
 const news=request.news||{},subject=String(news.company||request.subject||'').trim(),start=String(news.fromDate||''),end=String(news.toDate||shanghaiDate(now)),sources=Array.isArray(result?.sources)?result.sources:[];
 const aliases={谷歌:['谷歌','google','alphabet'],百度:['百度','baidu'],小米汽车:['小米汽车','xiaomi auto','xiaomi ev'],小米:['小米','xiaomi'],openai:['openai'],微软:['微软','microsoft'],苹果:['苹果','apple']};
 const names=aliases[subject.toLocaleLowerCase()]||aliases[subject]||[subject];
 const relevant=sources.map(source=>{const text=[source?.title,source?.snippet,source?.publishedAt].filter(Boolean).join('\n'),normalized=compactNewsText(text),matched=names.some(name=>normalized.includes(compactNewsText(name))),date=newsDateFromText(source?.publishedAt,now)||newsDateFromText(source?.snippet,now)||newsDateFromText(source?.title,now);return {source,text,matched,date};}).filter(item=>item.matched&&String(item.source?.snippet||'').trim().length>=24);
 const inWindow=relevant.filter(item=>item.date&&(!start||item.date>=start)&&(!end||item.date<=end));
 const synthesis=String(result?.synthesis||''),synthesisMatches=!!subject&&compactNewsText(synthesis).includes(compactNewsText(subject)),synthesisDate=newsDateFromText(synthesis,now),synthesisInWindow=!!(synthesisMatches&&synthesisDate&&(!start||synthesisDate>=start)&&(!end||synthesisDate<=end));
 const sufficient=!!result?.performed&&(inWindow.length>0||synthesisInWindow),reason=sufficient?'取得了对象匹配且发布时间处于请求范围内的新闻资料':!result?.performed?'搜索工具没有返回执行结果':!subject?'没有识别到具体公司或新闻主题':'未取得对象匹配且能核对发布时间的新闻正文或摘要';
 return {intent:request.intent||'company-news',sufficient,reason,subject,subjectMatched:relevant.length>0||synthesisMatches,lookbackDays:news.lookbackDays||7,fromDate:start,toDate:end,matchedSources:inWindow.length,undatedRelevantSources:relevant.filter(item=>!item.date).length,staleRelevantSources:relevant.filter(item=>item.date&&(item.date<start||item.date>end)).length};
}
function sourceReadPriority(query,source,quality,product){
  if(source.readStatus==='read'||source.readStatus==='failed')return null;
  const snippet=String(source.snippet||'').trim(),haystack=[source.title,snippet,source.url].filter(Boolean).join('\n');
  if(product){const subjectHit=productSubjectMatches(product,haystack);if(!snippet)return {score:subjectHit?8:3,reason:subjectHit?'相关来源只有标题或链接，需要读取正文':'搜索命中只有标题，需读取正文核对对象相关性'};if(!subjectHit)return null;const missing=quality?.facets?.requestedMissing||quality?.facets?.missing||[];if(missing.length)return {score:(likelyOfficial(source)?9:6)+Math.min(missing.length,3),reason:`摘要缺少${missing.join('、')}，继续读取可核对正文`};if(snippet.length<180)return {score:likelyOfficial(source)?7:5,reason:'相关摘要较短，需要读取正文确认上下文'};return null;}
  const assessment=assessGeneralText(query,haystack);if(!snippet&&!assessment.subjectMatched)return {score:3,reason:'搜索命中只有标题，需读取后才能核对对象相关性'};if(!assessment.subjectMatched)return null;
  if(!snippet)return {score:8,reason:'相关来源只有标题或链接，需要读取正文'};
  if(assessment.missingFacets.length)return {score:7+assessment.matchedFacets.length,reason:`摘要缺少${assessment.missingFacets.join('、')}，需要读取正文`};
  if(snippet.length<180)return {score:5,reason:'相关摘要过短，需要读取正文确认上下文'};
  if(!assessment.freshnessMatched)return {score:4,reason:'摘要未提供所需时间信息，需要读取正文核对'};
  return null;
}

export function evaluateSearchEvidence(query,result,{now=new Date(),requireOfficialFacetCoverage=false,request}={}){
  if(request?.news&&(request.intent==='company-news'||request.intent==='news-search'))return assessNewsEvidence(result,request,now);
  const parsed=parseWeatherQuestion(query),inferredProduct=analyzeProductQuestion(query),hasStructuredProduct=request?.intent==='product-research'||request?.category||request?.brand||request?.explicitModel;
  const product=hasStructuredProduct?{...(inferredProduct||{}),...request,subject:request.subject||inferredProduct?.subject||[request.brand,request.explicitModel,request.category].filter(Boolean).join(''),latest:request.timeScope==='latest'||inferredProduct?.latest===true,detailed:inferredProduct?.detailed===true,requestedAspects:request.requestedAspects||inferredProduct?.requestedAspects||[],requestedFields:request.requestedFields||inferredProduct?.requestedFields||[],requestedYear:request.requestedYear||inferredProduct?.requestedYear,region:request.region||inferredProduct?.region}:inferredProduct;
  const intent=parsed?'weather':product?'product-research':'general';
  const sourceEvidence=Array.isArray(result?.sources)?result.sources.flatMap(x=>parsed?[x?.snippet]:[x?.title,x?.snippet,x?.publishedAt]):[];
  const evidence=[result?.synthesis,...sourceEvidence].filter(Boolean).join('\n');
  if(!result?.performed)return {intent,sufficient:false,reason:'搜索工具没有返回执行结果'};
  if(!result?.sources?.length)return {intent,sufficient:false,reason:'搜索已执行，但没有可引用来源'};
  if(parsed){
    const today=shanghaiDate(now),expected=parsed.period==='tomorrow'?nextDate(today):today;
    if(!evidence)return {intent,sufficient:false,reason:'天气来源缺少可读取的具体数据',expectedDate:expected};
    if(!includesDate(evidence,expected))return {intent,sufficient:false,reason:`天气证据不是所需日期 ${expected}`,expectedDate:expected};
    if(!temperature.test(evidence))return {intent,sufficient:false,reason:'天气证据缺少具体温度',expectedDate:expected};
    if(!condition.test(evidence))return {intent,sufficient:false,reason:'天气证据缺少天气状况',expectedDate:expected};
    return {intent,sufficient:true,reason:'已取得所需日期、温度、天气状况和真实来源',expectedDate:expected};
  }
  if(product){
    if(!evidence)return {intent,sufficient:false,reason:'产品来源只有URL，缺少可核对的标题或正文',subject:product.subject,subjectConfirmed:false,officialSourceCount:0,coverage:0};
    const sourceSupportsProduct=source=>productSubjectMatches(product,[source?.title,source?.snippet,source?.publishedAt,source?.url].filter(Boolean).join('\n'));
    const matchingSources=(result.sources||[]).filter(sourceSupportsProduct),synthesisRelevant=!!result.synthesis&&productSubjectMatches(product,result.synthesis),scopedText=[...matchingSources.flatMap(source=>[source?.title,source?.snippet,source?.publishedAt]),...(synthesisRelevant?[result.synthesis]:[])].filter(Boolean).join('\n').replace(urlPattern,' '),subjectConfirmed=matchingSources.length>0&&productSubjectMatches(product,scopedText);
    const officialSourceCount=matchingSources.filter(likelyOfficial).length,officialReadableCount=matchingSources.filter(source=>likelyOfficial(source)&&typeof source?.snippet==='string'&&source.snippet.trim().length>=40).length;
    const expectedYear=product.requestedYear?.match(/20\d{2}/)?.[0],yearEvidence=matchingSources.flatMap(source=>[source.title,source.snippet,source.publishedAt]).filter(Boolean).join('\n'),evidenceYears=[...new Set([...yearEvidence.matchAll(/20\d{2}/g)].map(match=>match[0]))],yearMatched=!expectedYear||evidenceYears.includes(expectedYear),hasConflicts=/(口径差异|数据冲突|来源冲突|存在差异|互相矛盾|conflict(?:ing)?)/i.test(scopedText);
    const coverage=[/(上市|发布|launch|delivery|交付|发售)/i,/(价格|售价|price|人民币|rmb|万元)/i,/(尺寸|轴距|长.{0,2}宽.{0,2}高|dimension|wheelbase)/i,/(续航|电池|kwh|cltc|wltp|range)/i,/(功率|扭矩|电机|kw|马力|动力)/i,/(座|版本|配置|trim|standard configuration)/i].filter(pattern=>pattern.test(scopedText)).length;
    const facets=productFacetReport(product,scopedText),latestConfirmed=!product.latest||matchingSources.some(source=>likelyOfficial(source)&&/(最新(?:款|发布|上市)|目前在售|current.{0,30}lineup|latest(?:.{0,24}(?:model|product|lineup))?|newest)/i.test([source.title,source.snippet].filter(Boolean).join('\n'))),officialText=matchingSources.filter(source=>verifiedManufacturerSource(source)).map(source=>source.snippet||'').join('\n');
    const officialCoverage=productFacetPatterns[product.category]?productFacetReport(product,officialText).available.length:[/(?:售价|价格|人民币|rmb|\d+(?:\.\d+)?\s*(?:万元|元)|¥|￥)/i,/(?:尺寸|毫米|mm|轴距|英寸)/i,/(?:电池|容量|mah|kwh)/i,/(?:续航|里程|cltc|wltp|epa|\bkm\b|公里)/i,/(?:功率|扭矩|处理器|芯片|性能|kw|w)/i].filter(pattern=>pattern.test(officialText)).length;
    const details={subject:product.subject,brand:product.brand,category:product.category,explicitModel:product.explicitModel,subjectConfirmed,officialSourceCount,officialReadableCount,coverage,officialCoverage,facets,suspectedCorrections:productNameCorrections(product,matchingSources),latestRequested:product.latest,latestConfirmed,requestedYear:product.requestedYear,expectedYear,evidenceYears,yearMatched,region:product.region,hasConflicts};
    if(!subjectConfirmed)return {intent,sufficient:false,reason:`检索资料没有确认用户原始对象“${product.subject}”，不能替换成相似型号`,...details};
    if(!yearMatched)return {intent,sufficient:false,reason:`资料没有确认用户指定的${expectedYear}年款，不能混用${evidenceYears.length?evidenceYears.join('、')+'年':'未标年款'}参数`,...details};
    if(product.latest&&!latestConfirmed)return {intent,sufficient:false,reason:`已找到“${product.subject}”相关资料，但没有可靠证据证明所列型号是${product.region||'所询范围内'}最新发布或在售款`,...details};
    if(facets.requestedMissing.length)return {intent,sufficient:false,reason:`已确认“${product.subject}”，但用户明确询问的${facets.requestedMissing.join('、')}暂未从可读资料核实`,...details};
    if(product.detailed&&!facets.minimumMet)return {intent,sufficient:false,reason:`已确认“${product.subject}”，目前可靠资料只覆盖少量参数，仍缺${facets.missing.join('、')||'更多具体参数'}`,...details};
    if(product.detailed&&officialSourceCount<1)return {intent,sufficient:false,reason:`已确认“${product.subject}”，但尚未取得厂商产品页、配置表或官方公告，需要限定补查`,...details};
    if(product.detailed&&officialReadableCount<1)return {intent,sufficient:false,reason:`已找到“${product.subject}”的官方链接，但尚未读取到可核对的官方正文，需要继续读取`,...details};
    if(product.detailed&&requireOfficialFacetCoverage&&officialCoverage<2)return {intent,sufficient:false,reason:`已找到“${product.subject}”的厂商摘要，但其中具体参数不足，需要继续查询厂商资料`,...details};
    return {intent,sufficient:true,reason:facets.missing.length?`已确认原始对象“${product.subject}”，可回答已核实部分；仍缺少${facets.missing.join('、')}`:`已确认原始对象“${product.subject}”并取得可引用产品资料`,...details};
  }
  const synthesis=typeof result?.synthesis==='string'?result.synthesis.trim():'',relevantParts=[];
  for(const source of result.sources||[]){const text=[source?.title,source?.snippet,source?.publishedAt,source?.url].filter(Boolean).join('\n');if(assessGeneralText(query,text).subjectMatched&&source?.snippet?.trim())relevantParts.push([source.title,source.snippet,source.publishedAt].filter(Boolean).join('\n'));}
  if(synthesis&&assessGeneralText(query,synthesis).subjectMatched)relevantParts.push(synthesis);
  const relevantEvidence=relevantParts.join('\n'),assessment=assessGeneralText(query,relevantEvidence),readableRelevantEvidence=relevantParts.some(part=>part.length>=24);
  const sufficient=assessment.subjectMatched&&!assessment.missingFacets.length&&assessment.freshnessMatched&&readableRelevantEvidence;
  let reason='已取得与问题对象、时间范围和所需信息相符的可读资料';
  if(!assessment.subjectMatched)reason=`现有资料与问题对象“${assessment.subject||query.slice(0,80)}”的词面重合较少（可能是不同语言或换了说法），需判断来源是否真正对应所问内容，如不对应再补充查询`;
  else if(assessment.missingFacets.length)reason=`现有资料缺少${assessment.missingFacets.join('、')}，需要读取正文或补充查询`;
  else if(!assessment.freshnessMatched)reason='现有资料缺少所需时间范围或信息日期，需要补充查询';
  else if(!readableRelevantEvidence)reason='与问题相关的来源只有标题、URL或过短摘要，需要读取具体网页';
  return {intent,sufficient,reason,subject:assessment.subject,subjectMatched:assessment.subjectMatched,requestedFacets:assessment.requestedFacets.map(item=>item.name),matchedFacets:assessment.matchedFacets,missingFacets:assessment.missingFacets,requestedYears:assessment.requestedYears,freshnessMatched:assessment.freshnessMatched};
}

function mergeUsage(results){const usage={};for(const result of results)for(const [key,value] of Object.entries(result.usage||{}))if(Number.isFinite(value))usage[key]=(usage[key]||0)+value;return usage;}
function mergeSources(results,maxResults){const map=new Map();for(const result of results)for(const raw of result.sources||[]){const source=presentSource(raw);if(!source)continue;const previous=map.get(source.url);if(!previous)map.set(source.url,source);else map.set(source.url,presentSource({...previous,...Object.fromEntries(Object.entries(source).filter(([,value])=>value!==undefined&&value!=='')),title:previous.title||source.title,url:previous.url}));}return [...map.values()].sort((a,b)=>Number(likelyOfficial(b))-Number(likelyOfficial(a))).slice(0,maxResults);}
function evidenceBrandAlias(product,results){if(!product?.modelCode)return'';const escaped=product.modelCode.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp(`\\b([A-Z][A-Za-z]+(?:\\s+[A-Z][A-Za-z]+){0,2})\\s+${escaped}\\b`,'i'),text=results.flatMap(result=>[result.synthesis,...(result.sources||[]).flatMap(source=>[source.title,source.snippet])]).filter(Boolean).join('\n'),match=text.match(pattern),alias=match?.[1]?.trim().replace(/^(?:the|a|an)\s+/i,'');return alias?.slice(0,80)||'';}
export function weatherSynthesis(data){
  const place=[data.location.name,data.location.admin1,data.location.country].filter(Boolean).join('，'),daily=data.forecast;
  const lines=[`结构化天气提供器：Open-Meteo`,`地点：${place}`,`时区：${data.timezone}`,`请求范围：${data.period==='tomorrow'?'明日预报':data.period==='next-seven-days'?'从今天开始的未来七天预报':data.period==='next-days'?`从今天开始的未来${data.forecasts?.length||'多'}天预报`:'当前天气与今日概况'}`];
  if(data.current)lines.push(`实时观测（${data.current.observedAt}）：${data.current.condition}，当前温度 ${data.current.temperature}℃，体感 ${data.current.apparentTemperature}℃，湿度 ${data.current.humidity}%，降水 ${data.current.precipitation} mm，风速 ${data.current.windSpeed} km/h。`);
  const forecasts=Array.isArray(data.forecasts)&&data.forecasts.length?data.forecasts:[daily];for(const item of forecasts)lines.push(`${item.date}预报：${item.condition}，最高 ${item.temperatureMax}℃，最低 ${item.temperatureMin}℃，最高降水概率 ${item.precipitationProbabilityMax}%，最大风速 ${item.windSpeedMax} km/h。`);return lines.join('\n');
}

async function boundedWebSearch(provider,query,{signal,maxResults,now,maxFollowups,registry,taskId,onStatus,maxToolCalls,toolTrace,nextSequence}){
  const queries=[],results=[],readUrls=new Set(),readDecisions=[],followupReasons=[];let toolCalls=0;
  const call=async(name,args)=>{if(toolCalls>=maxToolCalls){onStatus?.({taskId,sequence:nextSequence(),stage:'task',status:'limit',toolCalls,maxToolCalls});const error=new Error('联网工具调用已达到本次上限');error.status=429;throw error;}toolCalls++;const outcome=await registry.execute(name,args,{signal,taskId,onStatus,nextSequence});toolTrace.push({callId:outcome.callId,sequence:toolTrace.length+1,tool:name,status:outcome.status,startedAt:outcome.startedAt,completedAt:outcome.completedAt,elapsedMs:outcome.elapsedMs,input:name==='search_web'?{query:args.query.slice(0,3000)}:{url:safeSourceUrl(args.url)},...(name==='search_web'&&outcome.success?{resultCount:Array.isArray(outcome.data?.sources)?outcome.data.sources.length:0}:{}),...(outcome.error?{error:outcome.error}:{})});return outcome;};
  const combined=()=>({performed:results.some(x=>x.performed),sources:mergeSources(results,maxResults),synthesis:results.map(x=>x.synthesis).filter(Boolean).join('\n\n')});
  const search=async searchQuery=>{signal?.throwIfAborted();queries.push(searchQuery);const outcome=await call('search_web',{query:searchQuery,maxResults});if(!outcome.success)throw new Error(outcome.error);results.push(outcome.data);return outcome.data;};
  const readMissing=async quality=>{if(registry.get('read_webpage')?.enabled!==true||toolCalls>=maxToolCalls)return;const product=analyzeProductQuestion(query),sources=mergeSources(results,maxResults),candidates=sources.filter(source=>!readUrls.has(source.url)).map(source=>({source,decision:sourceReadPriority(query,source,quality,product)})).filter(item=>item.decision).sort((a,b)=>b.decision.score-a.decision.score).slice(0,Math.min(2,maxToolCalls-toolCalls));for(const {source,decision} of candidates){readUrls.add(source.url);readDecisions.push({url:safeSourceUrl(source.url),reason:decision.reason});const outcome=await call('read_webpage',{url:source.url});if(outcome.success){const page=outcome.data;results.push({performed:true,requested:true,sources:[{...source,url:source.url,finalUrl:page.finalUrl||source.url,title:page.title||source.title,snippet:page.text.slice(0,4000),publishedAt:page.publishedAt||source.publishedAt,fetchedAt:page.fetchedAt,readStatus:'read'}],synthesis:`网页读取（${page.finalUrl||source.url}，抓取于${page.fetchedAt}）：\n${page.text.slice(0,8000)}`,elapsedMs:outcome.elapsedMs});}else results.push({performed:false,requested:true,sources:[{...source,readStatus:'failed',readError:outcome.error}],elapsedMs:outcome.elapsedMs});signal?.throwIfAborted();}};
  const initial=await search(query);let quality=evaluateSearchEvidence(query,combined(),{now});
  const parsed=parseWeatherQuestion(query),product=analyzeProductQuestion(query);
  if(initial.performed&&!quality.sufficient&&!product){await readMissing(quality);quality=evaluateSearchEvidence(query,combined(),{now});}
  if(initial.performed&&!quality.sufficient&&product){await readMissing(quality);quality=evaluateSearchEvidence(query,combined(),{now});}
  if(parsed&&!quality.sufficient&&initial.performed){
    const date=quality.expectedDate||shanghaiDate(now),refinements=[`${query.slice(0,2600)}。所需日期是${date}。请查找该日期的具体天气状况、实时温度或最高最低温度、降水、风力和数据发布时间；不要返回旧日期页面。`,`${parsed.location||query.slice(0,500)} ${date} 官方气象 实时观测 今日预报 温度 天气状况`],seen=new Set([query.trim()]);
    for(const refined of refinements.slice(0,maxFollowups)){if(seen.has(refined)||toolCalls>=maxToolCalls)continue;seen.add(refined);followupReasons.push(quality.reason);await search(refined);quality=evaluateSearchEvidence(query,combined(),{now});if(!quality.sufficient)await readMissing(quality);quality=evaluateSearchEvidence(query,combined(),{now});if(quality.sufficient)break;}
  }
  if(product&&!quality.sufficient&&initial.performed){
    const seen=new Set(queries.map(x=>x.trim()));
    for(let attempt=0;attempt<maxFollowups&&!quality.sufficient&&toolCalls<maxToolCalls;attempt++){
      const alias=evidenceBrandAlias(product,results),officialName=[alias,product.explicitModel||product.modelCode].filter(Boolean).join(' '),refined=product.latest&&!quality.latestConfirmed
        ? `继续保留原始查询对象“${product.subject}”。核实${product.region||'用户未指定地区'}范围内${product.brand||''}${product.category||'产品'}最新发布、最新上市与当前在售分别是哪一款。按官方发布日期/开售日期排序，读取厂商最新产品线或公告；型号数字大小、首页顺序和版权年份不能证明最新。给出型号、产品线、地区、日期及官方来源。原始问题：${query.slice(0,1800)}`
        : product.detailed&&quality.facets?.missing?.length
          ? `继续保留原始对象“${product.subject}”，不可替换近似型号。${alias?`资料中出现候选官方英文名称“${officialName}”，仅作为检索词，未由官方资料确认前不得替代原名称。`:''}针对以下缺口补查该对象的官方规格资料：${quality.facets.missing.join('、')}。优先读取厂商产品页、配置表或公告；返回每个字段的原文摘要、版本、地区、发布日期和来源链接。已得到的字段不要重复查询。原始问题：${query.slice(0,1800)}`
          : alias
            ? `严格保留原始对象“${product.subject}”，不要替换为相似型号。首轮资料显示候选英文名称“${officialName}”；核实该别名是否与原型号及品类相符，再查询官方产品页/公告。只记录来源明确支持的事实。原始问题：${query.slice(0,1800)}`
            : `严格保留原始对象“${product.subject}”，不要替换为相似型号。先核实该品牌的官方名称、产品类别和型号关系，再查找官方产品页、发布公告或配置页；返回可读摘要和官方URL。原始问题：${query.slice(0,1800)}`;
      if(seen.has(refined))break;seen.add(refined);followupReasons.push(quality.reason);await search(refined);quality=evaluateSearchEvidence(query,combined(),{now});if(!quality.sufficient&&quality.officialSourceCount>0)await readMissing(quality);quality=evaluateSearchEvidence(query,combined(),{now});
    }
    if(!quality.sufficient&&toolCalls<maxToolCalls){await readMissing(quality);quality=evaluateSearchEvidence(query,combined(),{now});}
  }
  if(!parsed&&!product&&!quality.sufficient&&initial.performed){
    const seen=new Set(queries.map(item=>item.trim()));for(let attempt=0;attempt<maxFollowups&&!quality.sufficient&&toolCalls<maxToolCalls;attempt++){
      const reason=quality.reason,refined=`${query.slice(0,2200)}。首轮资料不足：${reason}。请严格围绕原问题对象、所需时间范围和所问信息补充可核对事实与公开来源，不要返回仅关键词相似但对象无关的资料。`;
      if(seen.has(refined))break;seen.add(refined);followupReasons.push(reason);await search(refined);quality=evaluateSearchEvidence(query,combined(),{now});if(!quality.sufficient)await readMissing(quality);quality=evaluateSearchEvidence(query,combined(),{now});
    }
  }
  const sources=mergeSources(results,maxResults),synthesis=results.map((x,index)=>x.synthesis?`资料${index+1}：\n${x.synthesis}`:'').filter(Boolean).join('\n\n').slice(0,18000),performed=results.some(x=>x.performed),searchResults=results.filter(x=>x.responseModel||x.usage?.webSearchRequests!==undefined||x.status);
  const responseModels=[...new Set(results.map(x=>x.responseModel).filter(Boolean))];
  const reachedLimit=!quality.sufficient&&toolCalls>=maxToolCalls;if(reachedLimit)onStatus?.({taskId,sequence:nextSequence(),stage:'task',status:'limit',toolCalls,maxToolCalls});
  return {taskId,tool:'web-search',performed,requested:results.some(x=>x.requested),status:performed?(sources.length?'searched':'no-results'):'not-invoked',sources,...(synthesis?{synthesis}:{}),usage:mergeUsage(results),elapsedMs:toolTrace.reduce((n,x)=>n+(x.elapsedMs||0),0),attempts:searchResults.length||queries.length,toolCalls,toolTrace,quality,...(reachedLimit?{terminationReason:'call-limit'}:{}),currentDate:shanghaiDate(now),timezone:'Asia/Shanghai',diagnostics:{queries:queries.map(x=>x.slice(0,3000)),readDecisions,followupReasons,requestEndpoint:provider.searchEndpoint||'未记录',requestModel:provider.model||'未记录',responseModels,transport:provider.searchEndpoint?'direct':'未记录',context:{sourceCount:sources.length,synthesisChars:synthesis.length}},capabilities:{structuredWeather:false,webpageRead:registry.get('read_webpage')?.enabled===true}};
}

async function orchestrate(provider,query,{signal,maxResults,weatherTool,now,maxFollowups,registry,taskId,onStatus,maxToolCalls,toolTrace,nextSequence}){
  const intent=classifyQuestionIntent(query),capabilities={structuredWeather:!!weatherTool?.enabled,webpageRead:registry.get('read_webpage')?.enabled===true};
  if(intent.intent==='general')return {taskId,tool:'none',performed:false,requested:false,status:'not-needed',sources:[],elapsedMs:0,attempts:0,toolCalls:0,toolTrace,quality:{intent:'general',sufficient:true,reason:'一般知识无需联网工具'},capabilities};
  if(intent.intent==='url-read'){
    if(registry.get('read_webpage')?.enabled!==true)return {taskId,tool:'webpage',performed:false,requested:false,status:'unsupported-url-read',sources:[],elapsedMs:0,attempts:0,toolCalls:0,toolTrace,quality:{intent:'url-read',sufficient:false,reason:'当前版本没有启用安全网页读取工具'},capabilities};
    const outcome=await registry.execute('read_webpage',{url:intent.url},{signal,taskId,onStatus,nextSequence});toolTrace.push({callId:outcome.callId,sequence:1,tool:'read_webpage',status:outcome.status,startedAt:outcome.startedAt,completedAt:outcome.completedAt,elapsedMs:outcome.elapsedMs,input:{url:safeSourceUrl(intent.url)},...(outcome.error?{error:outcome.error}:{})});
    if(!outcome.success)return {taskId,tool:'webpage',performed:false,requested:true,status:'read-failed',sources:[],elapsedMs:outcome.elapsedMs,attempts:1,toolCalls:1,toolTrace,quality:{intent:'url-read',sufficient:false,reason:outcome.error},capabilities};
    const page=outcome.data,source=presentSource({url:page.finalUrl,title:page.title,snippet:page.text.slice(0,1200),publishedAt:page.publishedAt,fetchedAt:page.fetchedAt,readStatus:'read'});return {taskId,tool:'webpage',performed:true,requested:true,status:'page-read',sources:source?[source]:[],synthesis:`网页正文（抓取于${page.fetchedAt}）：\n${page.text.slice(0,12000)}`,elapsedMs:outcome.elapsedMs,attempts:1,toolCalls:1,toolTrace,quality:{intent:'url-read',sufficient:true,reason:'已安全读取用户指定的公开网页'},currentDate:shanghaiDate(now),timezone:'Asia/Shanghai',capabilities};
  }
  if(intent.intent==='weather'&&weatherTool?.enabled){
    const outcome=await registry.execute('get_weather',{intent},{signal,taskId,onStatus,nextSequence});toolTrace.push({callId:outcome.callId,sequence:1,tool:'get_weather',status:outcome.status,startedAt:outcome.startedAt,completedAt:outcome.completedAt,elapsedMs:outcome.elapsedMs,input:{location:intent.location||'',period:intent.period||''},...(outcome.error?{error:outcome.error}:{})});
    if(outcome.success){const weather=outcome.data;if(['needs-location','ambiguous-location','needs-period'].includes(weather.status))return {taskId,tool:'weather',performed:false,requested:false,status:'needs-input',sources:[],elapsedMs:outcome.elapsedMs,attempts:1,toolCalls:1,toolTrace,quality:{intent:'weather',sufficient:false,reason:weather.question},needsClarification:weather.question,capabilities};if(weather.status==='ok'){const synthesis=weatherSynthesis(weather),sources=(weather.sources||[]).map(presentSource).filter(Boolean);return {taskId,tool:'weather',performed:true,requested:true,status:'weather-data',sources,synthesis,elapsedMs:outcome.elapsedMs,attempts:1,toolCalls:1,toolTrace,quality:{intent:'weather',sufficient:true,reason:'结构化天气数据包含地点、所需日期、天气状况和温度',expectedDate:weather.forecast.date},weather:{provider:weather.provider,period:weather.period,timezone:weather.timezone,location:[weather.location.name,weather.location.admin2,weather.location.admin1,weather.location.country].filter(Boolean).join('，'),observedAt:weather.current?.observedAt,forecastDate:weather.forecast.date,current:weather.current,forecast:weather.forecast,forecasts:weather.forecasts},currentDate:shanghaiDate(now),timezone:'Asia/Shanghai',diagnostics:{queries:[query],requestEndpoint:'https://api.open-meteo.com/v1/forecast',requestModel:'structured-weather',responseModels:[],transport:'direct',context:{sourceCount:sources.length,synthesisChars:synthesis.length}},usage:{},capabilities};}}
    if(typeof provider?.search!=='function')throw new Error(outcome.error||'结构化天气服务不可用');const fallback=await boundedWebSearch(provider,query,{signal,maxResults,now,maxFollowups,registry,taskId,onStatus,maxToolCalls,toolTrace,nextSequence});return {...fallback,tool:'web-search-fallback',fallbackReason:'结构化天气服务不可用，已使用搜索后备',capabilities};
  }
  return boundedWebSearch(provider,query,{signal,maxResults,now,maxFollowups,registry,taskId,onStatus,maxToolCalls,toolTrace,nextSequence});
}

export async function orchestrateSearch(provider,query,{signal,maxResults=8,weatherTool,webpageTool,registry,now=new Date(),maxFollowups=2,maxToolCalls=6,totalTimeoutMs=45000,onStatus,taskId=randomUUID()}={}){
  maxResults=Math.max(1,Math.min(12,Number(maxResults)||8));maxFollowups=Math.max(0,Math.min(2,Number(maxFollowups)||0));maxToolCalls=Math.max(1,Math.min(8,Number(maxToolCalls)||6));totalTimeoutMs=Math.max(1000,Math.min(60000,Number(totalTimeoutMs)||45000));
  const tools=registry||createAgentToolRegistry({provider,weatherTool,webpageTool}),toolTrace=[];let eventSequence=0;const nextSequence=()=>++eventSequence;signal?.throwIfAborted();const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),totalTimeoutMs),combined=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal;
  try{const result=await orchestrate(provider,query,{signal:combined,maxResults,weatherTool,now,maxFollowups,registry:tools,taskId,onStatus,maxToolCalls,toolTrace,nextSequence});onStatus?.({taskId,sequence:nextSequence(),stage:'answering',status:'running',toolCalls:result.toolCalls||toolTrace.length});return {...result,eventCount:eventSequence};}
  catch(error){if(signal?.aborted){onStatus?.({taskId,sequence:nextSequence(),stage:'task',status:'cancelled'});signal.throwIfAborted();}if(deadline.signal.aborted){onStatus?.({taskId,sequence:nextSequence(),stage:'task',status:'timeout',elapsedMs:totalTimeoutMs});const timeout=new Error('联网工具执行超时，已停止后续查询');timeout.status=504;throw timeout;}throw error;}
  finally{clearTimeout(timer);}
}
