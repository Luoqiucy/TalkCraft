import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePlannedSearchQuery} from '../src/agent/search-query.mjs';

// Executed queries from saved history: the planner's query got the user's object
// appended again ("…款的苹果 手机 最新"), also to English queries.
const apple={brand:'苹果',category:'手机',requestedFields:['价格','参数','屏幕'],timeScope:'latest',provenance:{brand:'context',category:'context'}};
test('品牌已用别名出现时不重复追加，英文查询不拼中文词',()=>{
 assert.equal(validatePlannedSearchQuery({proposedQuery:'iPhone 17 Pro Max 闲鱼 价格 行情',resolvedQuestion:'它在闲鱼上的价格',request:apple}),'iPhone 17 Pro Max 闲鱼 价格 行情 手机 参数 最新');
 assert.equal(validatePlannedSearchQuery({proposedQuery:'Apple iPhone latest model 2026 specifications',resolvedQuestion:'最新款的苹果手机',request:apple}),'Apple iPhone latest model 2026 specifications');
});
test('仍补回规划遗漏的用户对象，字段最多补两个且认同义词',()=>{
 assert.equal(validatePlannedSearchQuery({proposedQuery:'最新款 售价',resolvedQuestion:'最新款的苹果手机多少钱',request:apple}),'最新款 售价 苹果 手机 参数');
 const model={brand:'Tesla',explicitModel:'Model 3',provenance:{brand:'user',explicitModel:'user'}};
 assert.equal(validatePlannedSearchQuery({proposedQuery:'Tesla used price',resolvedQuestion:'特斯拉 model 3 闲鱼挂牌价',request:model}),'Tesla used price Model 3');
});
