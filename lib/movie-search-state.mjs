export function classifyBilibiliSearch(snapshot, query) {
  let url;
  try { url = new URL(snapshot.url); } catch { return 'unverified'; }
  if (snapshot.blocked) return 'blocked';
  if (url.hostname !== 'search.bilibili.com' || url.pathname !== '/all' ||
      url.searchParams.get('keyword') !== query || snapshot.inputValue !== query) return 'unverified';
  if (snapshot.httpStatus >= 400) return 'failed';
  if (snapshot.resultCount > 0) return 'results';
  return snapshot.empty ? 'empty' : 'unverified';
}
