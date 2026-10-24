import test from 'node:test';
import assert from 'node:assert/strict';
import {movieSearchQuery} from '../lib/movie-query.mjs';
import {parseIntent} from '../lib/intent.mjs';

test('没有指定片名时使用热门电影作为搜索词',()=>{
 for(const command of ['',null,'搜索电影','搜索个热门电影','任何一部电影','帮我搜一部电影','搜索一部热门电影并播放相关视频','find a popular movie','搜索']){
  assert.equal(movieSearchQuery(command),'热门电影',String(command));
 }
});
test('指定片名不受热门榜单限制，保留中文、英文和数字',()=>{
 const cases=[['搜索个流浪地球','流浪地球'],['搜索电影《盗梦空间》','盗梦空间'],['流浪地球','流浪地球'],['肖申克的救赎','肖申克的救赎'],['搜索电影《流浪地球2》','流浪地球2'],['搜索 Blade Runner 2049','Blade Runner 2049'],['search for Spider-Man: Across the Spider-Verse','Spider-Man: Across the Spider-Verse'],['Se7en','Se7en'],['1917','1917'],['帮我在B站搜索电影 流浪地球','流浪地球']];
 for(const [command,expected] of cases)assert.equal(movieSearchQuery(command),expected,command);
});
test('只剥离开头指令，不全局删除标题中的电影或搜索',()=>{
 for(const [command,expected] of [['电影人生','电影人生'],['搜索电影人生','电影人生'],['搜索《搜索》','搜索'],['搜索搜索','搜索'],['电影里的搜索者','电影里的搜索者'],['搜索电影里的搜索者','电影里的搜索者'],['看不见的客人','看不见的客人'],['搜索《电影之神》','电影之神'],['搜索《请以你的名字呼唤我》','请以你的名字呼唤我']]){
  assert.equal(movieSearchQuery(command),expected,command);
 }
});
test('明确搜索中的否定词和会议字样完整保留为关键词',()=>{
 for(const [command,expected] of [['搜索不要抬头','不要抬头'],['搜索会议','会议'],['搜索电影会议','电影会议'],['search for Do Not Look Up','Do Not Look Up']]){
  assert.equal(parseIntent(command).intent,'movie');
  assert.equal(movieSearchQuery(command),expected);
 }
});
test('搜索词提取不负责授权，否定或购买操作先由意图解析拒绝',()=>{
 assert.equal(parseIntent('不要搜索《盗梦空间》').error.code,'AMBIGUOUS_COMMAND');
 assert.equal(parseIntent('帮我买一部手机').error.code,'UNSUPPORTED_INTENT');
 assert.equal(movieSearchQuery('搜索《开会》'),'开会');
 assert.equal(parseIntent('搜索《开会》').intent,'movie');
});
