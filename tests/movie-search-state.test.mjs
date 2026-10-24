import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyBilibiliSearch} from '../lib/movie-search-state.mjs';
const query='流浪地球';
const page={url:'https://search.bilibili.com/all?keyword='+encodeURIComponent(query),inputValue:query,resultCount:20,httpStatus:200};
test('B站搜索成功要求实际结果和相同查询词，只有URL变化不能成功',()=>{
 assert.equal(classifyBilibiliSearch(page,query),'results');
 assert.equal(classifyBilibiliSearch({...page,resultCount:0},query),'unverified');
 assert.equal(classifyBilibiliSearch({...page,inputValue:'热门电影'},query),'unverified');
 assert.equal(classifyBilibiliSearch({...page,url:'https://example.com/all?keyword='+encodeURIComponent(query)},query),'unverified');
});
test('明确无结果算搜索完成，验证拦截和HTTP错误不能算成功',()=>{
 assert.equal(classifyBilibiliSearch({...page,resultCount:0,empty:true},query),'empty');
 assert.equal(classifyBilibiliSearch({...page,blocked:true},query),'blocked');
 assert.equal(classifyBilibiliSearch({...page,httpStatus:503},query),'failed');
});
