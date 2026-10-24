// This extracts search terms; it does not claim to recognize whether a term is a film.
const DEFAULT_QUERY='热门电影';
const GENERIC_ZH=/^(?:(?:任何|任意|随便|随意|随机|当前|现在|最近|最新|今天|本周|这周|热门|热映|热播|流行|好看|相关|电影|影片|视频|预告片|预告|排行榜|榜单|一下|一部|一个|1部|1个|部|个|的)\s*)+$/u;
const GENERIC_EN=/^(?:(?:a|an|one|any|some|the|popular|trending|latest|recent|new|movie|movies|film|films|trailer|trailers|video|videos)\s*)+$/i;
const ZH_ACTION=/^(?:(?:请你|请|麻烦你|麻烦|帮我|给我|为我|替我|我想要|我想|我要|能否|可以|能不能)\s*)*(?:(?:在|到)(?:B站|哔哩哔哩|bilibili|电脑上|电脑|浏览器里|浏览器中)\s*)?(?:搜索一下|搜索|搜一下|查找|找一下|查询|查一下|查看|看看|播放|观看|推荐|打开|搜|找|查|看(?=\s|一部|一个|部|个|电影|影片))\s*/i;
const EN_ACTION=/^(?:please\s+)?(?:search(?:\s+for)?|find|look\s+for|show|play|open)(?:\s+(?:me|for\s+me))?\s+/i;
export function movieSearchQuery(command){
 const text=String(command??'').normalize('NFKC').trim();
 if(!text)return DEFAULT_QUERY;
 const titles=[...text.matchAll(/《([^》]+)》/g)].map(m=>m[1].trim()).filter(Boolean);
 if(titles.length)return titles.join(' ');
 let query=text;
 const action=query.match(ZH_ACTION)||query.match(EN_ACTION);
 if(action){
  query=query.slice(action[0].length).trim();
  query=query.replace(/^(?:一部|一个|1部|1个|部|个)\s*/,'');
  // A separated category label is syntax; an attached word can be part of a title.
  query=query.replace(/^(?:电影|影片)(?:\s+|[：:])\s*/,'');
  // Legacy requests are now search-only. Only a distinct trailing video action is removed.
  query=query.replace(/(?:[，,]\s*|(?:并且|然后|并|再)\s*)(?:播放|打开|观看)(?:它的|其|相关|电影|的)*视频[。！？!?]*$/,'').trim();
 }
 query=query.replace(/^[\s：:，,]+|[\s。！？!?]+$/g,'').trim();
 return !query||GENERIC_ZH.test(query)||GENERIC_EN.test(query)?DEFAULT_QUERY:query;
}
