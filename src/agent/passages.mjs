import {relevanceTerms} from '../search-orchestrator.mjs';

// Pick the parts of a fetched page that best match the question, so the model sees
// the relevant facts instead of the page opening (navigation, intros, ads).
const escapeRegExp=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

export function splitPassages(text,{maxChunk=360}={}){
  const blocks=String(text||'').split(/\n\s*\n|\n(?=\s*[-*•#|])/u).map(block=>block.replace(/\s+/g,' ').trim()).filter(block=>block.length>=12);
  const chunks=[];
  for(const block of blocks){
    if(block.length<=maxChunk){chunks.push(block);continue;}
    let current='';
    for(const sentence of block.split(/(?<=[。！？；!?;.])\s*/u)){
      if(current&&current.length+sentence.length>maxChunk){chunks.push(current);current='';}
      current+=sentence;
      while(current.length>maxChunk*1.5){chunks.push(current.slice(0,maxChunk));current=current.slice(maxChunk);}
    }
    if(current.trim().length>=12)chunks.push(current.trim());
  }
  return chunks;
}

export function scorePassage(terms,chunk){
  const haystack=chunk.normalize('NFKC').toLowerCase();
  let score=0;
  for(const token of terms.latin)if(new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(token)}(?:$|[^a-z0-9])`).test(haystack))score+=2;
  for(const term of terms.han)if(haystack.includes(term))score+=1;
  // Concrete figures (prices, dates, specs) are what users usually ask the web for.
  if(score>0&&/\d/.test(chunk))score+=0.5;
  return score;
}

export function selectPassages(text,query,{maxPassages=3,maxChars=1100}={}){
  const chunks=splitPassages(text),terms=relevanceTerms(query);
  if(!chunks.length)return '';
  if(!terms.latin.length&&!terms.han.length)return chunks.join('\n').slice(0,maxChars);
  const ranked=chunks.map((chunk,index)=>({chunk,index,score:scorePassage(terms,chunk)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);
  if(!ranked.length)return '';
  const picked=[];let used=0;
  for(const item of ranked){
    if(picked.length>=maxPassages)break;
    if(used+item.chunk.length>maxChars&&picked.length)continue;
    picked.push(item);used+=item.chunk.length;
  }
  // Keep document order so a figure stays next to the heading that explains it.
  return picked.sort((a,b)=>a.index-b.index).map(item=>item.chunk).join(' … ').slice(0,maxChars);
}
