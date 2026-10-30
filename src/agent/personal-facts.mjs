const foodGroups={
 fruit:['香蕉','苹果','橙子','橘子','葡萄','草莓','西瓜','梨','桃子','芒果','蓝莓','猕猴桃','火龙果','柚子','菠萝','樱桃','荔枝','龙眼','柠檬','榴莲'],
 beverage:['咖啡','茶','奶茶','牛奶','豆浆','气泡水','可乐','果汁','饮料','绿茶','红茶','乌龙茶']
};

export function memoryTerms(value) {
  const output = [];
  for (const match of String(value || '').toLocaleLowerCase().matchAll(/[\p{Script=Han}]{2,}|[a-z0-9][a-z0-9._+-]{1,}/giu)) {
    const token = match[0];
    if (/^[\p{Script=Han}]+$/u.test(token)) for (let index = 0; index < token.length - 1; index++) output.push(token.slice(index, index + 2));
    else output.push(token);
  }
  return [...new Set(output)];
}

export function derivePersonalFact(content) {
  const text = String(content || '');
  for (const [group, terms] of Object.entries(foodGroups)) {
    const object = terms.find(term => text.includes(term));
    if (!object) continue;
    const predicate = /不喜欢|不再喜欢/u.test(text) ? 'dislikes-eating' : /喜欢|偏好|爱吃/u.test(text) ? (group==='beverage'?'likes-drinking':'likes-eating') : /爱喝/u.test(text) ? 'likes-drinking' : /喝|饮用/u.test(text) ? 'drinks' : /吃|食用/u.test(text) ? 'eats' : 'mentions';
    const frequency = /偶尔|有时/u.test(text) ? 'occasional' : /每天|经常|通常/u.test(text) ? 'regular' : 'unspecified';
    return { domain: `food.${group}`, predicate, object, frequency, confirmed: true };
  }
  if (/(?:回答|回复|解释|说明|步骤).{0,8}(?:简短|简洁|精简|详细|展开)|(?:简短|简洁|精简|详细|展开).{0,8}(?:回答|回复|解释|说明|步骤)/u.test(text)) return { domain: 'communication.style', predicate: /详细|展开/u.test(text) ? 'prefers-detailed' : 'prefers-brief', object: /详细|展开/u.test(text) ? 'detailed' : 'brief', confirmed: true };
  const city = text.match(/(?:默认(?:所在)?(?:城市|地区|地点)|我(?:常住|住在|来自))\s*(?:是|为|在)?\s*([\p{Script=Han}]{2,10})/u);
  if (city) return { domain: 'location.default', predicate: 'default-city', object: city[1], confirmed: true };
  const project = text.match(/(?:我(?:正在|目前)?(?:做|开发|负责|参与)(?:的)?项目(?:是|叫|为)?|项目名称(?:是|叫|为)?)\s*([\p{Script=Han}A-Za-z0-9_-]{2,40})/u);
  if (project) return { domain: 'work.project', predicate: 'works-on', object: project[1], confirmed: true };
  const term = text.match(/(?:专有词|术语|产品名|项目名)(?:是|叫|为|：|:)\s*([\p{Script=Han}A-Za-z0-9_-]{2,40})/u);
  if (term) return { domain: 'language.term', predicate: 'uses-term', object: term[1], confirmed: true };
  return null;
}

function queryDomain(text) {
  if (/水果|果物|吃什么|吃哪些|爱吃/u.test(text)) return 'food.fruit';
  if (/饮品|饮料|喝什么|喝哪些/u.test(text)) return 'food.beverage';
  if (/回答风格|回复风格|怎么回答|回答偏好|表达风格/u.test(text)) return 'communication.style';
  if (/我的项目|做什么项目|项目背景|项目名称|负责什么/u.test(text)) return 'work.project';
  if (/默认城市|默认地区|住在哪里|常住地|所在地/u.test(text)) return 'location.default';
  if (/专有词|个人词典|术语|产品名/u.test(text)) return 'language.term';
  return '';
}

export function scorePersonalMemory(content, reason, query) {
  const queryText = String(query || ''), fact = derivePersonalFact(`${content || ''} ${reason || ''}`);
  const terms = memoryTerms(queryText), entryTerms = memoryTerms(`${content || ''} ${reason || ''}`);
  const domain = queryDomain(queryText), lexical = domain&&fact?.domain!==domain?0:entryTerms.filter(word => terms.includes(word)).length;
  const preferenceQuery = /喜欢|偏好|爱吃|想要/u.test(queryText), behaviorQuery = /平时|通常|经常|偶尔|吃哪些|吃什么|喝哪些|喝什么/u.test(queryText);
  let semantic = 0;
  if (domain && fact?.domain === domain) {
    semantic += 2;
    if (preferenceQuery) semantic += /prefers-|likes-eating|likes-drinking|dislikes-eating/u.test(fact.predicate) ? 4 : -2;
    if (behaviorQuery && ['occasional','regular'].includes(fact.frequency)) semantic += 1;
  }
  if (preferenceQuery && fact?.predicate === 'eats' && fact.frequency === 'occasional') semantic -= 1;
  return { score: lexical + semantic, fact };
}
