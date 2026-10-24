function unsupported(){return {intent:'unknown',error:{code:'UNSUPPORTED_INTENT',message:'这个 Demo 暂时不能执行这条操作指令。',recovery:'目前支持在 B 站搜索电影关键词，以及加入或创建腾讯会议。'}};}
const POLITE=/^(?:(?:请你|请|麻烦你|麻烦|帮我|给我|替我|我想要|我想|我要|能否|可以|能不能)\s*)+/;
const OTHER_ACTION='(?:删除|删掉|移除|清空|格式化|安装|卸载|下载|上传|发送|发邮件|发消息|转账|付款|支付|购买|买|订购|下单|关机|重启|关闭|运行|执行|复制|移动|重命名|修改|编辑|创建文件|新建文件|保存文件|打开文件)';
const unsupportedAction=new RegExp(`^(?:${OTHER_ACTION})|(?:然后|并且|并|再|[，,；;])\\s*(?:(?:请|帮我)\\s*)?${OTHER_ACTION}`);
const searchPrefix=/^(?:(?:请你|请|麻烦你|麻烦|帮我|给我|为我|替我|我想要|我想|我要|能否|可以|能不能)\s*)*(?:(?:在|到)(?:B站|哔哩哔哩|bilibili|电脑上|电脑|浏览器里|浏览器中)\s*)?(?:搜索一下|搜索|搜一下|查找|搜)/i;
const searchPrefixEN=/^(?:please\s+)?search(?:\s+for)?(?:\s+|$)/i;
const followingOperation=new RegExp(`(?:然后|并且|并|再|[，,；;。]|\\b(?:and then|then|and)\\b)\\s*(?:(?:请|帮我|给我|不要|别再|请勿|不|do not|don't)\\s*)*(?:${OTHER_ACTION}|创建|新建|发起|预约|加入|进入|开会|开始会议|搜索|查找|播放|打开|观看|取消|停止|delete\\b|remove\\b|create\\b|join\\b|search\\b|play\\b|install\\b|buy\\b|send\\b|stop\\b|cancel\\b)`,'i');
export function parseIntent(command) {
 const text=String(command??'').normalize('NFKC').trim();
 if(!text)return {intent:'unknown',error:{code:'EMPTY_COMMAND',message:'请输入要让电脑执行的任务。',recovery:'例如：搜索电影《流浪地球》，或直接输入片名。'}};
 if(text.length>300)return {intent:'unknown',error:{code:'COMMAND_TOO_LONG',message:'这条指令超过了 300 个字符。',recovery:'请缩短为一个具体任务。'}};
 // Book-title text is search data, so 《会议》 and 《不要抬头》 are not commands.
 const controls=text.replace(/《[^》]*》/g,'').trim();
 // After an explicit leading search verb, unquoted words are search data too.
 // A separate second operation is still rejected rather than silently ignored.
 if(searchPrefix.test(controls)||searchPrefixEN.test(controls))return followingOperation.test(controls)?unsupported():{intent:'movie'};
 if(/不要|别再|请勿|不用|无需|不需要|禁止|取消|停止/.test(controls)||/^(?:请\s*)?别/.test(controls)||/(?:^|[，,。])\s*(?:不想|不再|不|勿)\s*(?:搜|找|查|播|放|开|创|加|进)/.test(controls)||/\b(?:do\s+not|don't|cancel|stop)\b/i.test(controls))return {intent:'unknown',error:{code:'AMBIGUOUS_COMMAND',message:'这条指令包含停止或否定操作，系统没有开始执行。',recovery:'取消已有任务请使用任务详情中的取消按钮；新任务请说明需要执行的动作。'}};
 const actionText=controls.replace(POLITE,'');
 if(unsupportedAction.test(actionText)||/^(?:把|将).{1,80}(?:删除|删掉|移除|清空|发送|移动|重命名|修改)/.test(actionText)||/^(?:给|向).{1,40}(?:发送|发邮件|发消息|转账)/.test(actionText)||/(?:^|\b(?:and then|then|and)\s+)(?:delete|remove|install|uninstall|download|upload|buy|purchase|send|pay|format|reboot|shutdown|restart)\b/i.test(actionText))return unsupported();
 if(/腾讯会议|会议|开会/.test(controls)){
  if(/创建|新建|发起|开一个|开始|预约/.test(controls))return {intent:'meeting_create'};
  const digits=controls.match(/(?:会议码|会议号|号码|加入|进入)?\s*([0-9][0-9\s-]{2,18}[0-9])/);
  const code=digits?.[1].replace(/[\s-]/g,'')??'';
  if(![9,10].includes(code.length))return {intent:'meeting_join',meetingCode:code,error:{code:'INVALID_MEETING_CODE',message:code?`会议码 ${code} 不完整。腾讯会议普通会议号为 9 位，个人会议号为 10 位。`:'没有找到完整的腾讯会议号。',recovery:'请补充 9 位或 10 位会议号后重新提交。'}};
  return {intent:'meeting_join',meetingCode:code};
 }
 // Remaining readable text is treated as a Bilibili keyword, including bare titles.
 // This predictable fallback does not validate that the keyword names a real film.
 if(/[\p{L}\p{N}]/u.test(text))return {intent:'movie'};
 return unsupported();
}
export const labels={movie:'B站电影搜索',meeting_join:'加入会议',meeting_create:'创建会议',unknown:'未支持的任务'};
