const compact=value=>String(value||'').replace(/\s+/g,' ').trim();
const folded=value=>compact(value).normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');

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
 const constraints=[];
 const addIfMissing=value=>{const term=compact(value);if(term&&folded(query).indexOf(folded(term))<0&&!constraints.some(item=>folded(item)===folded(term)))constraints.push(term);};
 if(['user','context','context+user'].includes(request.provenance?.brand)&&request.brand)addIfMissing(request.brand);
 if(['user','context','context+user'].includes(request.provenance?.category)&&request.category)addIfMissing(request.category);
 if(['user','context','context+user'].includes(request.provenance?.explicitModel)&&request.explicitModel)addIfMissing(request.explicitModel);
 for(const field of (request.requestedFields||[]).slice(0,6))addIfMissing(field);
 if(request.timeScope==='latest'&&!/(最新|最新款|最新发布|最新上市|在售|current|latest|newest|release)/i.test(query))addIfMissing('最新');
 if(constraints.length)query=`${query} ${constraints.join(' ')}`;
 return query.slice(0,4000);
}
