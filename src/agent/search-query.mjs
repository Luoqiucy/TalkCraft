const compact=value=>String(value||'').replace(/\s+/g,' ').trim();
const folded=value=>compact(value).normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');

// The same brand written another way already identifies the object; appending the
// Chinese name again only lengthens the query.
const brandAliases={苹果:['apple','iphone','ipad','macbook'],apple:['苹果','iphone'],小米:['xiaomi','redmi','红米'],红米:['redmi'],华为:['huawei'],荣耀:['honor'],一加:['oneplus'],理想:['li auto','lixiang'],比亚迪:['byd'],特斯拉:['tesla'],蔚来:['nio'],小鹏:['xpeng']};
// "价格" is already asked for by "售价/多少钱/price".
const fieldAliases={价格:['售价','多少钱','报价','price','价位'],参数:['配置','规格','spec','specs','specifications'],续航:['里程','range','battery life']};
// A query with no Chinese at all was planned for English sources.
const mostlyLatin=value=>/[A-Za-z]/.test(value)&&!/\p{Script=Han}/u.test(value);

// Preserve the model's concise search plan, while restoring identity and scope
// that the user stated explicitly and the planner accidentally omitted.
export function validatePlannedSearchQuery({proposedQuery,resolvedQuestion,request={}}={}){
 let query=compact(proposedQuery);
 if(query.length<2||query.length>4000)query=compact(resolvedQuestion).slice(0,4000);
 if(!query)throw new Error('模型没有提供可用的搜索词');
 const uncertain=(request.entityCandidates||[]).find(candidate=>candidate?.confirmed===false&&candidate?.model);
 if(uncertain&&folded(query)===folded(resolvedQuestion)){
  const candidateQuery=[uncertain.brand||request.brand,uncertain.model,uncertain.category||request.category,...(request.requestedFields||[])].map(compact).filter(Boolean).join(' ');
  if(candidateQuery)query=candidateQuery;
 }
 const constraints=[],latinQuery=mostlyLatin(query);
 const present=(term,aliases=[])=>[term,...aliases].some(item=>folded(item)&&folded(query).includes(folded(item)));
 const addIfMissing=(value,aliases=[])=>{const term=compact(value);if(term&&!present(term,aliases)&&!constraints.some(item=>folded(item)===folded(term)))constraints.push(term);};
 const fromUser=key=>['user','context','context+user'].includes(request.provenance?.[key]);
 // An English query planned for English sources keeps its language; only the model
 // number, which is the same in both, is restored.
 if(!latinQuery){
  if(fromUser('brand')&&request.brand)addIfMissing(request.brand,brandAliases[compact(request.brand).toLowerCase()]||brandAliases[compact(request.brand)]||[]);
  if(fromUser('category')&&request.category)addIfMissing(request.category);
 }
 if(fromUser('explicitModel')&&request.explicitModel)addIfMissing(request.explicitModel);
 if(!latinQuery)for(const field of (request.requestedFields||[]).slice(0,2))addIfMissing(field,fieldAliases[field]||[]);
 if(!latinQuery&&request.timeScope==='latest'&&!/(最新|最新款|最新发布|最新上市|在售|current|latest|newest|release|20\d{2})/i.test(query))addIfMissing('最新');
 if(constraints.length)query=`${query} ${constraints.join(' ')}`;
 return query.slice(0,4000);
}
