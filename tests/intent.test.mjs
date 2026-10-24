import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIntent} from '../lib/intent.mjs';

test('搜索指令、裸片名及剩余关键词进入B站搜索，不要求命中榜单',()=>{
 for(const command of ['搜索电影','搜索个热门电影','任何一部电影','搜索个流浪地球','搜索电影《盗梦空间》','流浪地球','肖申克的救赎','Blade Runner 2049','1917','电影人生','搜索','未知片名XYZ']){
  assert.equal(parseIntent(command).intent,'movie',command);
 }
});
test('会议优先，但书名号内的会议文字属于片名',()=>{
 assert.equal(parseIntent('创建一个腾讯会议').intent,'meeting_create');
 assert.equal(parseIntent('搜索电影《会议》').intent,'movie');
 assert.equal(parseIntent('《创建一个腾讯会议》').intent,'movie');
 assert.equal(parseIntent('《会议》然后创建一个腾讯会议').intent,'meeting_create');
});
test('明确的搜索前缀使后续会议或否定字样成为搜索词，分隔后的第二项操作仍拒绝',()=>{
 for(const command of ['搜索不要抬头','搜索会议','搜索电影会议','帮我搜索不要抬头','查找会议','搜不要抬头','search for Do Not Look Up','search for Meeting']){
  assert.equal(parseIntent(command).intent,'movie',command);
 }
 for(const command of ['搜索流浪地球然后删除文件','搜索不要抬头，然后创建一个腾讯会议','搜索流浪地球并播放视频','search for Inception then delete files']){
  assert.equal(parseIntent(command).error?.code,'UNSUPPORTED_INTENT',command);
 }
 assert.equal(parseIntent('不要搜索流浪地球').error.code,'AMBIGUOUS_COMMAND');
 assert.equal(parseIntent('创建一个腾讯会议').intent,'meeting_create');
});
test('明确的非搜索操作不能因为剩余文本规则而执行',()=>{
 for(const command of ['帮我买一部手机','我要买一部手机','我想删除文件','删除文件','请删除电影文件','帮我把文件删除','给小张发邮件','搜索电影并删除文件','安装腾讯会议','重启电脑','下载电影《盗梦空间》','delete all files','search Inception then delete all files']){
  assert.equal(parseIntent(command).error?.code,'UNSUPPORTED_INTENT',command);
 }
 assert.equal(parseIntent('搜索《删除文件》').intent,'movie');
 assert.equal(parseIntent('搜索如何删除文件').intent,'movie');
});
test('空输入与长度限制保留',()=>{
 assert.equal(parseIntent(' ').error.code,'EMPTY_COMMAND');
 assert.equal(parseIntent('电影'.repeat(160)).error.code,'COMMAND_TOO_LONG');
 assert.equal(parseIntent('？！').error.code,'UNSUPPORTED_INTENT');
});
test('会议号支持普通9位与个人10位，1234必须失败',()=>{
 assert.equal(parseIntent('加入腾讯会议，会议码1234').error.code,'INVALID_MEETING_CODE');
 assert.equal(parseIntent('加入腾讯会议 123 456 789').meetingCode,'123456789');
 assert.equal(parseIntent('加入腾讯会议 1234567890').error,undefined);
 assert.equal(parseIntent('加入腾讯会议 １２３４５６７８９').meetingCode,'123456789');
 assert.equal(parseIntent('加入腾讯会议').error.code,'INVALID_MEETING_CODE');
});
test('否定和取消指令不能触发电脑操作，书名号内的否定词保持为数据',()=>{
 for(const command of ['不要搜索流浪地球','不要创建腾讯会议','取消电影播放','停止搜索','别搜索电影','请别帮我搜索电影','不搜索电影','请勿搜索电影','不用搜了','do not search Inception']){
  assert.equal(parseIntent(command).error?.code,'AMBIGUOUS_COMMAND',command);
 }
 assert.equal(parseIntent('搜索《不要抬头》').intent,'movie');
 assert.equal(parseIntent('不要搜索《不要抬头》').error.code,'AMBIGUOUS_COMMAND');
});
