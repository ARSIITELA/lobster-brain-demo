'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const names = { queued: '排队中', running: '正在执行', waiting_user: '待你操作', succeeded: '已完成', failed: '执行失败', cancelled: '已取消' };
  const activeStatuses = new Set(['queued', 'running', 'waiting_user']);
  const failureNames = {
    INVALID_MEETING_CODE: '会议码格式不正确', MEETING_CODE_INVALID: '会议码格式不正确',
    INVALID_COMMAND: '指令内容不完整', UNSUPPORTED_INTENT: '暂不支持的任务', UNSUPPORTED_COMMAND: '暂不支持的任务',
    BROWSER_UNAVAILABLE: '浏览器暂不可用', BROWSER_NOT_FOUND: '未找到浏览器',
    NETWORK_ERROR: '网络连接失败', NETWORK_TIMEOUT: '网络响应超时',
    APP_NOT_INSTALLED: '未安装腾讯会议', MEETING_NOT_INSTALLED: '未安装腾讯会议',
    LOGIN_REQUIRED: '需要登录', PERMISSION_DENIED: '缺少系统授权', TIMEOUT: '执行超时',
    PLAYBACK_FAILED: '视频未能播放', PLAYBACK_BLOCKED: '视频播放受到限制',
    EXECUTION_FAILED: '执行过程中出现错误', SERVER_RESTARTED: '服务重启中断任务',
    MEETING_APP_MISSING: '未安装腾讯会议', NATIVE_CONFIRMATION_REQUIRED: '需要在电脑上完成会议操作',
    ACCESSIBILITY_REQUIRED: '缺少辅助功能权限', SCREEN_RECORDING_REQUIRED: '缺少屏幕录制权限',
    MEETING_LOGIN_REQUIRED: '腾讯会议需要登录', MEETING_ALREADY_ACTIVE: '电脑已有会议正在进行',
    MEETING_UI_CHANGED: '会议窗口需要人工处理', MEETING_CONFIRMATION_REQUIRED: '会议创建结果待核对',
    MEETING_CODE_UNVERIFIED: '未能读取会议号', MEETING_STATE_UNVERIFIED: '会议状态未能确认',
    MEETING_HELPER_BUILD_FAILED: '会议执行器准备失败', MEETING_JOIN_CONFIRMATION_REQUIRED: '需要在电脑上确认入会',
    MEETING_NATIVE_LAUNCH_FAILED: '会议执行器启动失败', MEETING_NATIVE_RECEIPT_TIMEOUT: '会议执行器尚未返回结果',
    PLATFORM_UNSUPPORTED: '当前系统暂不支持此操作', EMPTY_COMMAND: '未输入指令', COMMAND_TOO_LONG: '指令内容过长',
    BILIBILI_VERIFICATION_REQUIRED: 'B 站需要人工验证', BILIBILI_SEARCH_UNVERIFIED: 'B 站搜索结果未能确认',
    BILIBILI_SEARCH_FAILED: 'B 站搜索未完成', BROWSER_OUTCOME_UNKNOWN: '浏览器连接中断，结果待确认',
    SITE_VERIFICATION_REQUIRED: '网页需要人工验证', MOVIE_SOURCE_UNAVAILABLE: '电影网站暂不可用',
    MOVIE_NOT_IN_SUPPORTED_LIST: '没有找到支持的影片', PLAYBACK_NOT_CONFIRMED: '未能确认视频播放',
    BROWSER_NOT_INSTALLED: '未找到浏览器控制工具', BROWSER_PERMISSION_DENIED: '缺少浏览器控制权限',
    MOVIE_EXECUTION_FAILED: '电影任务执行失败', TASK_TIMEOUT: '任务执行超时', EXECUTION_ERROR: '电脑执行出现错误',
    USER_CANCELLED: '用户取消任务', SEARCH_FAILED: '搜索未完成', NO_RESULTS: '未找到可播放的视频',
    UNSUPPORTED_PLATFORM: '当前系统暂不支持此操作', INVALID_CODE: '配对码不正确'
  };
  let state = { device: {}, tasks: [], metrics: {}, connection: {}, capabilities: {} };
  let selectedId = null;
  let filter = 'all';
  let currentView = 'workspace';
  let lastRender = '';
  let connected = false;
  let authenticated = false;
  let polling = null;
  let eventSource = null;
  let fetchInFlight = false;
  let toastTimer = null;
  let submitting = false;
  let pendingSubmission = null;

  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const count = (value) => number(value).toLocaleString('zh-CN');
  const isMeeting = (task) => /meeting|会议/i.test(`${task.intent || ''} ${task.command || ''}`);
  const statusBadge = (status) => `<span class="status-badge ${escapeHTML(status)}"><span class="status-dot"></span>${escapeHTML(names[status] || status || '状态未知')}</span>`;
  const safeURL = (value) => {
    if (!value || typeof value !== 'string') return '';
    try { const url = new URL(value, location.origin); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
  };
  const dateOf = (value) => { if (value === null || value === undefined || value === '') return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
  const dateTime = (value) => { const date = dateOf(value); return date ? date.toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }) : '时间未记录'; };
  const timeOnly = (value) => { const date = dateOf(value); return date ? date.toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }) : ''; };
  const duration = (ms) => { const seconds = Math.max(0, number(ms) / 1000); return seconds < 60 ? `${seconds.toFixed(seconds < 10 ? 1 : 0)} 秒` : `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`; };
  const taskDuration = (task) => { if (!['succeeded','failed','cancelled'].includes(task.status)) return ''; const start = dateOf(task.startedAt), end = dateOf(task.finishedAt); return start && end ? duration(end - start) : ''; };
  const taskList = () => Array.isArray(state.tasks) ? [...state.tasks].sort((a,b) => (dateOf(b.createdAt)?.getTime() || 0) - (dateOf(a.createdAt)?.getTime() || 0)) : [];

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(path, { credentials:'same-origin', ...options, headers:{ 'Content-Type':'application/json', ...(options.headers || {}) }, signal: options.signal || AbortSignal.timeout(12000) });
    } catch (error) {
      const failure = new Error(error.name === 'TimeoutError' ? '电脑响应超时，请检查服务是否仍在运行。' : '暂时无法连接电脑，请检查网络和电脑上的服务。');
      failure.network = true;
      throw failure;
    }
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) {
      if (response.status === 401 && !path.includes('/pair')) showPair();
      const message = typeof body.error === 'string' ? body.error : body.error?.message;
      const error = new Error(message || body.message || `请求未完成（${response.status}），请稍后重试。`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
  }

  function setConnection(value) {
    connected = value;
    const online = value && state.device?.online !== false;
    const pill = $('#connection-pill');
    pill.classList.toggle('offline', !online);
    pill.innerHTML = `<span class="dot"></span><span>${online ? '电脑已连接' : '电脑连接中断'}</span>`;
    $('#connection-alert').hidden = value;
    $('#device-live').classList.toggle('offline', !online);
    $('#device-live').innerHTML = `<span class="dot"></span>${online ? '在线' : '连接中断'}`;
    $('#profile-device-status').innerHTML = statusBadge(online ? 'succeeded' : 'failed').replace('已完成', '电脑在线').replace('执行失败', '电脑连接中断');
    $('#submit-command').disabled = !value || submitting;
  }

  function showPair() {
    authenticated = false;
    clearInterval(polling);
    polling = null;
    eventSource?.close();
    eventSource = null;
    $('#app').hidden = true;
    $('#loading-screen').hidden = true;
    $('#pair-screen').hidden = false;
  }

  function showApp() {
    authenticated = true;
    $('#pair-screen').hidden = true;
    $('#loading-screen').hidden = true;
    $('#app').hidden = false;
    if (!polling) polling = setInterval(() => refreshState(), 3000);
    if (!eventSource && typeof EventSource !== 'undefined') {
      eventSource = new EventSource('/api/events');
      eventSource.addEventListener('state', (event) => {
        try { acceptState(JSON.parse(event.data)); } catch { /* Polling continues if an event is malformed. */ }
      });
    }
  }

  function acceptState(nextState) {
    state = { ...state, ...nextState };
    setConnection(true);
    const serialized = JSON.stringify(state);
    if (lastRender !== serialized) {
      lastRender = serialized;
      render();
    }
  }

  async function refreshState(notify = false) {
    if (fetchInFlight || !authenticated) return;
    fetchInFlight = true;
    try {
      const data = await api('/api/state');
      acceptState(data);
      if (notify) toast('任务状态已刷新。');
    } catch (error) {
      if (error.status !== 401) setConnection(false);
      if (notify) toast(error.message);
    } finally { fetchInFlight = false; }
  }

  function render() {
    const tasks = taskList();
    if (!selectedId || !tasks.some(task => task.id === selectedId)) selectedId = tasks[0]?.id || null;
    const name = state.device?.name || '当前电脑';
    $('#device-name').textContent = name;
    $('#profile-device-name').textContent = name;
    $('#composer-device').textContent = `在 ${name} 上执行`;
    const running = tasks.filter(task => activeStatuses.has(task.status)).length;
    $('#active-count').textContent = running;
    $('#device-description').textContent = running ? `有 ${running} 个任务尚未完成，请查看任务状态` : '已准备就绪，等待你的下一条指令';
    $('#profile-device-platform').textContent = platformName(state.device?.platform);
    $('#task-total').textContent = `共 ${tasks.length} 个任务`;
    $('#all-count').textContent = tasks.length;
    renderTasks();
    renderDetail();
    renderMetrics();
    renderDevice();
  }

  function platformName(platform) {
    return ({ darwin:'macOS · 本机执行服务', win32:'Windows · 本机执行服务', linux:'Linux · 本机执行服务' })[platform] || `${platform || '本机'} · 单设备演示`;
  }

  function renderTasks() {
    const tasks = taskList().filter(task => filter === 'all' || (filter === 'active' && activeStatuses.has(task.status)) || (filter === 'failed' && ['failed','waiting_user'].includes(task.status)) || task.status === filter);
    if (!tasks.length) {
      $('#task-list').innerHTML = `<div class="empty-state"><span class="empty-icon">${icon('clock')}</span><h3>${filter === 'all' ? '还没有发送过任务' : '这个分类暂时没有任务'}</h3><p>${filter === 'all' ? '在上方输入一句指令，或选择一个示例。任务开始后，你可以在这里查看执行状态。' : '任务状态更新后，符合条件的记录会出现在这里。'}</p></div>`;
      return;
    }
    $('#task-list').innerHTML = tasks.map(task => `<button class="task-row ${task.id === selectedId ? 'selected' : ''}" data-task-id="${escapeHTML(task.id)}" aria-pressed="${task.id === selectedId}"><span class="task-type-icon ${isMeeting(task) ? 'meeting' : ''}">${icon(isMeeting(task) ? 'meeting' : 'play')}</span><span class="task-row-body"><span class="task-row-title">${escapeHTML(task.command)}</span><span class="task-row-meta"><span>${escapeHTML(dateTime(task.createdAt))}</span>${taskDuration(task) ? `<span>${escapeHTML(taskDuration(task))}</span>` : ''}</span></span>${statusBadge(task.status)}</button>`).join('');
  }

  function stepStatus(step) {
    if (['succeeded','completed','complete','done','success'].includes(step.status)) return 'done';
    if (['running','active','in_progress','waiting_user'].includes(step.status)) return 'active';
    if (['failed','error'].includes(step.status)) return 'error';
    return '';
  }

  function renderDetail() {
    const task = taskList().find(item => item.id === selectedId);
    if (!task) {
      $('#task-detail').innerHTML = `<div class="detail-header"><h2>任务详情</h2><span>实时同步</span></div><div class="detail-empty"><div class="detail-empty-mark"><svg aria-hidden="true"><use href="#i-lobster"/></svg></div><h3>等待你的第一个任务</h3><p>电脑会按步骤执行指令，<br>每一步的进度都会显示在这里。</p><div class="detail-example"><div><i></i>确认指令与执行场景</div><div><i></i>查看电脑的执行过程</div><div><i></i>接收结果或需要处理的提示</div></div></div>`;
      return;
    }
    const steps = Array.isArray(task.steps) ? task.steps : [];
    const result = task.result || {};
    const resultURL = safeURL(result.url || result.videoUrl || result.meetingUrl);
    const screenshot = safeURL(result.screenshot || result.screenshotUrl);
    const error = task.error;
    const waiting = task.status === 'waiting_user';
    const search = result.search && typeof result.search === 'object' ? result.search : null;
    const searchDetails = search ? `<p>搜索关键词：${escapeHTML(search.query || result.query || '')}</p>${Number.isFinite(search.resultCount) ? `<p>当前页面读取到的结果：${escapeHTML(search.resultCount)} 条</p>` : ''}${search.verifiedAt ? `<p>核验时间：${escapeHTML(dateTime(search.verifiedAt))}</p>` : ''}<p>${task.status === 'succeeded' && search.verified === true ? '本次完成了搜索，尚未播放视频。' : '搜索结果尚未核验，请查看上方提示。'}</p>` : '';
    const resultLinkLabel = search ? '打开 B 站搜索结果' : '打开结果链接';
    const footnote = task.mode && task.mode !== 'real' ? `此任务为${task.mode === 'simulation' ? '模拟演示' : escapeHTML(task.mode)}模式，结果不代表电脑已执行。` : '任务状态来自电脑执行记录。成功状态以任务的实际完成证据为准。';
    $('#task-detail').innerHTML = `<div class="detail-header"><h2>任务详情</h2><span>${escapeHTML(String(task.id).slice(-8))}</span></div><div class="detail-body"><h3 class="detail-command">${escapeHTML(task.command)}</h3><div class="detail-meta">${statusBadge(task.status)}<span>${escapeHTML(dateTime(task.createdAt))}</span></div><div class="detail-section-label">执行进度</div>${steps.length ? `<ol class="timeline">${steps.map(step => `<li class="${stepStatus(step)}"><span class="step-point">${stepStatus(step) === 'done' ? icon('check') : stepStatus(step) === 'error' ? icon('close') : ''}</span><div class="step-heading"><strong>${escapeHTML(step.label || step.title || '执行步骤')}</strong><time>${escapeHTML(timeOnly(step.time || step.at || step.completedAt))}</time></div>${step.detail ? `<p class="step-detail">${escapeHTML(step.detail)}</p>` : ''}</li>`).join('')}</ol>` : `<p class="step-detail">${task.status === 'queued' ? '任务已进入队列，电脑空闲后将开始执行。' : '尚未收到执行步骤。'}</p>`}${error || waiting ? `<div class="notice ${task.status === 'failed' ? 'error' : ''}"><strong>${waiting ? '需要你在电脑上操作' : '这次任务未能完成'}</strong><p>${escapeHTML(error?.message || result.summary || '请查看电脑上的应用窗口，完成提示的操作后重试。')}</p>${error?.recovery ? `<p class="recovery">${escapeHTML(error.recovery)}</p>` : ''}${error?.code ? `<p class="recovery">问题编号：${escapeHTML(error.code)}</p>` : ''}</div>` : ''}${task.status === 'succeeded' && !result.title && !result.summary ? '<div class="notice success"><strong>任务已完成</strong><p>电脑已报告此任务执行成功。</p></div>' : ''}${result.title || result.summary || resultURL || screenshot ? `<div class="result-card">${screenshot ? `<a href="${escapeHTML(screenshot)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHTML(screenshot)}" alt="任务执行结果截图" loading="lazy"></a>` : ''}<div class="result-card-content"><h3>${escapeHTML(result.title || (waiting ? '当前执行结果' : '任务结果'))}</h3>${result.summary ? `<p>${escapeHTML(result.summary)}</p>` : ''}${result.meetingCode ? `<p>会议码：${escapeHTML(result.meetingCode)}</p>` : ''}${searchDetails}${resultURL ? `<a class="result-link" href="${escapeHTML(resultURL)}" target="_blank" rel="noopener noreferrer">${icon('link')}${escapeHTML(resultLinkLabel)} ${icon('arrow')}</a>` : ''}</div></div>` : ''}<div class="detail-actions">${activeStatuses.has(task.status) ? `<button class="button secondary danger" data-task-action="cancel" data-id="${escapeHTML(task.id)}">${icon('close')}取消任务</button>` : ''}${['failed','cancelled','waiting_user'].includes(task.status) ? `<button class="button secondary" data-task-action="retry" data-id="${escapeHTML(task.id)}">${icon('refresh')}重新执行</button>` : ''}${['succeeded'].includes(task.status) ? `<button class="button secondary" data-reuse="${escapeHTML(task.command)}">再次使用这条指令 ${icon('arrow')}</button>` : ''}</div></div><div class="detail-footnote">${footnote}</div>`;
  }

  function renderMetrics() {
    const metrics = state.metrics || {};
    const total = number(metrics.total);
    const ended = number(metrics.succeeded) + number(metrics.failed) + number(metrics.cancelled);
    const rate = ended ? `${((number(metrics.succeeded) / ended) * 100).toFixed(0)}` : '—';
    const avg = metrics.avgDurationMs == null || ended === 0 ? '—' : (number(metrics.avgDurationMs) / 1000).toFixed(1);
    const cards = [
      ['累计任务', count(total), '个', `成功 ${count(metrics.succeeded)} 次 · 失败 ${count(metrics.failed)} 次`, 'grid'],
      ['已结束任务成功率', rate, rate === '—' ? '' : '%', ended ? `基于 ${count(ended)} 个已结束任务` : '暂无已结束的任务', 'check'],
      ['平均执行时间', avg, avg === '—' ? '' : '秒', metrics.p95DurationMs != null && ended ? `95% 的任务在 ${duration(metrics.p95DurationMs)}内结束` : '任务结束后开始统计', 'clock'],
      ['待用户操作', count(metrics.waiting), '个', `已取消 ${count(metrics.cancelled)} 个任务`, 'info']
    ];
    $('#metric-cards').innerHTML = cards.map(([title,value,unit,description,glyph]) => `<article class="metric-card"><div class="metric-card-top"><span>${escapeHTML(title)}</span>${icon(glyph)}</div><div class="metric-value">${escapeHTML(value)}<small>${escapeHTML(unit)}</small></div><p>${escapeHTML(description)}</p></article>`).join('');
    const days = Array.isArray(metrics.recentDays) ? metrics.recentDays : [];
    const max = Math.max(1, ...days.map(day => number(day.total)));
    $('#trend-chart').innerHTML = days.length && total ? days.slice(-7).map(day => `<div class="chart-column"><div class="chart-bars"><div class="chart-bar" style="height:${Math.max(number(day.total) / max * 130, 2)}px" title="${escapeHTML(day.date)}：提交 ${count(day.total)} 个"><span>${count(day.total)}</span></div><div class="chart-bar success" style="height:${Math.max(number(day.succeeded) / max * 130, 2)}px" title="${escapeHTML(day.date)}：成功 ${count(day.succeeded)} 个"></div></div><span>${escapeHTML(String(day.date || '').slice(5).replace('-', '/'))}</span></div>`).join('') : '<div class="analytics-empty">还没有任务数据。<br>发送第一条指令后，这里会显示实际执行记录。</div>';
    const intents = Array.isArray(metrics.byIntent) ? metrics.byIntent : [];
    $('#intent-stats').innerHTML = intents.length ? intents.map(item => `<div class="intent-stat"><div class="intent-line"><strong>${escapeHTML(item.label || intentLabel(item.intent))}</strong><span>${count(item.total)} 个任务</span></div><div class="intent-progress"><span style="width:${number(item.total) ? Math.min(100, number(item.succeeded)/number(item.total)*100) : 0}%"></span></div><p>已完成 ${count(item.succeeded)} 个，占该场景提交量的 ${number(item.total) ? Math.round(number(item.succeeded)/number(item.total)*100) : 0}%</p></div>`).join('') : '<div class="analytics-empty">尚无场景数据</div>';
    const failures = Array.isArray(metrics.failureReasons) ? metrics.failureReasons : [];
    $('#failure-stats').innerHTML = failures.length ? failures.map(item => `<div class="failure-row"><i></i><span>${escapeHTML(item.label || failureNames[item.code] || item.code || '未分类错误')}</span><strong>${count(item.count)} 次</strong></div>`).join('') : '<div class="analytics-empty">当前没有已记录的异常原因。</div>';
  }

  function intentLabel(intent) {
    return ({ movie:'电影搜索', movie_search:'电影搜索', movie_play:'搜索电影视频', play_movie:'搜索电影视频', join_meeting:'加入腾讯会议', meeting_join:'加入腾讯会议', create_meeting:'创建腾讯会议', meeting_create:'创建腾讯会议', unsupported:'暂不支持的指令', unknown:'未识别的指令' })[intent] || intent || '未分类';
  }

  function renderDevice() {
    const urls = state.connection?.urls;
    let list = Array.isArray(urls) ? urls : urls && typeof urls === 'object' ? Object.values(urls).flat() : [];
    list = list.map(value => typeof value === 'object' ? value.url : value).filter(value => safeURL(value));
    $('#connection-urls').innerHTML = list.length ? [...new Set(list)].map(value => `<div class="connection-url"><a href="${escapeHTML(safeURL(value))}" target="_blank" rel="noopener noreferrer">${escapeHTML(value)}</a><button data-copy="${escapeHTML(value)}" aria-label="复制访问地址">${icon('copy')}</button></div>`).join('') : '<p>服务尚未返回局域网地址，请查看电脑启动终端中显示的访问地址。</p>';
    const caps = state.capabilities;
    const notes = Array.isArray(caps) ? caps.filter(item => typeof item === 'string') : typeof caps === 'object' && caps ? [caps.note, caps.message].filter(value => typeof value === 'string') : [];
    if(caps?.movieSearch && caps.movieSearchProvider === 'bilibili') notes.push('电影任务在 B 站搜索，默认关键词为热门电影，也支持指定片名。完成表示搜索结果已核验，不表示视频已经播放。');
    if(caps?.meetingInstalled) notes.push(caps.meetingCreateVerified?'已检测到腾讯会议，本机已完成自动创建验证。创建前需要辅助功能授权；自动入会尚未接入。':'已检测到腾讯会议。创建流程需要电脑端操作权限；任务会说明实际执行结果。');
    $('#capability-runtime').textContent = notes.join(' ');
  }

  function setView(view) {
    if (!['workspace','analytics','device'].includes(view)) return;
    currentView = view;
    $$('.view').forEach(item => { item.hidden = item.id !== `${view}-view`; });
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
    $('#current-view-label').textContent = ({ workspace:'任务工作台', analytics:'运营数据', device:'设备与连接' })[view];
    history.replaceState(null, '', view === 'workspace' ? location.pathname : `${location.pathname}#${view}`);
    window.scrollTo({ top:0, behavior:'smooth' });
  }

  $('#pair-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = $('#pair-code').value.trim();
    if (!code) return;
    const button = $('#pair-form button');
    button.disabled = true;
    button.innerHTML = `正在连接 ${icon('refresh')}`;
    $('#pair-error').textContent = '';
    try {
      await api('/api/pair', { method:'POST', body:JSON.stringify({ code }) });
      $('#pair-code').value = '';
      showApp();
      await refreshState();
    } catch (error) { $('#pair-error').textContent = error.message; }
    finally { button.disabled = false; button.innerHTML = `<span>连接电脑</span>${icon('arrow')}`; }
  });

  $('#command-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const command = $('#command').value.trim();
    if (!command) { $('#command-error').textContent = '请先输入希望电脑执行的任务。'; return; }
    submitting = true;
    const button = $('#submit-command');
    button.disabled = true;
    button.innerHTML = `正在发送 ${icon('refresh')}`;
    $('#command-error').textContent = '';
    try {
      if (!pendingSubmission || pendingSubmission.command !== command) pendingSubmission = { command, requestId: globalThis.crypto?.randomUUID ? crypto.randomUUID() : `request-${Date.now()}-${Math.random().toString(36).slice(2)}` };
      const requestId = pendingSubmission.requestId;
      const response = await api('/api/tasks', { method:'POST', body:JSON.stringify({ command, requestId }) });
      if (response.task?.id) {
        selectedId = response.task.id;
        if (!state.tasks.some(task => task.id === response.task.id)) state.tasks = [response.task, ...state.tasks];
        render();
      }
      pendingSubmission = null;
      $('#command').value = '';
      filter = 'all';
      $$('.filter').forEach(item => item.classList.toggle('active', item.dataset.filter === filter));
      renderTasks();
      toast('指令已发送，执行进度会自动更新。');
      await refreshState();
      if (innerWidth <= 760) requestAnimationFrame(() => $('#task-detail').scrollIntoView({ behavior:'smooth', block:'start' }));
    } catch (error) { $('#command-error').textContent = error.message; }
    finally { submitting = false; button.disabled = !connected; button.innerHTML = `发送指令 ${icon('arrow')}`; }
  });

  document.addEventListener('click', async (event) => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) { setView(viewButton.dataset.view); return; }
    const example = event.target.closest('[data-command]');
    if (example) { $('#command').value = example.dataset.command; $('#command-error').textContent = ''; $('#command').focus(); return; }
    const reuse = event.target.closest('[data-reuse]');
    if (reuse) { $('#command').value = reuse.dataset.reuse; $('#command').focus(); $('#command').scrollIntoView({ behavior:'smooth', block:'center' }); return; }
    const filterButton = event.target.closest('[data-filter]');
    if (filterButton) { filter = filterButton.dataset.filter; $$('.filter').forEach(item => item.classList.toggle('active', item === filterButton)); renderTasks(); return; }
    const taskButton = event.target.closest('[data-task-id]');
    if (taskButton) { selectedId = taskButton.dataset.taskId; renderTasks(); renderDetail(); if (innerWidth <= 760) $('#task-detail').scrollIntoView({ behavior:'smooth', block:'start' }); return; }
    const action = event.target.closest('[data-task-action]');
    if (action) {
      action.disabled = true;
      try {
        const response = await api(`/api/tasks/${encodeURIComponent(action.dataset.id)}/${action.dataset.taskAction}`, { method:'POST', body:'{}' });
        if (response.task?.id) {
          selectedId = response.task.id;
          const existing = state.tasks.find(task => task.id === response.task.id);
          if (!existing) state.tasks = [response.task, ...state.tasks];
          else if ((dateOf(response.task.updatedAt)?.getTime() || 0) >= (dateOf(existing.updatedAt)?.getTime() || 0)) state.tasks = state.tasks.map(task => task.id === response.task.id ? response.task : task);
          render();
        }
        toast(action.dataset.taskAction === 'cancel' ? '已发送取消请求。' : '已重新提交任务。');
        await refreshState();
      } catch (error) { toast(error.message); }
      finally { action.disabled = false; }
      return;
    }
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(copy.dataset.copy);
        else {
          const input = document.createElement('textarea');
          input.value = copy.dataset.copy; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.append(input); input.select();
          const success = document.execCommand('copy'); input.remove(); if (!success) throw new Error('copy unavailable');
        }
        toast('地址已复制。');
      } catch { toast('浏览器未允许复制，请长按或选中地址进行复制。'); }
    }
  });

  $('#refresh-tasks').addEventListener('click', () => refreshState(true));
  $('#reconnect-button').addEventListener('click', () => refreshState(true));
  $('#command').addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); $('#command-form').requestSubmit(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && authenticated) refreshState(); });
  $('#page-date').textContent = new Date().toLocaleDateString('zh-CN', { month:'long', day:'numeric', weekday:'long' });
  setView(location.hash.slice(1) || 'workspace');

  async function boot() {
    try {
      const health = await api('/api/health');
      if (health.version) $('#version-label').textContent = `v${String(health.version).replace(/^v/, '')}`;
      state.device = health.device || {};
      if (health.paired) { showApp(); await refreshState(); }
      else showPair();
    } catch (error) {
      showPair();
      $('#pair-error').textContent = error.message;
      $('#pair-description').textContent = '请先启动电脑上的龙虾脑服务，再输入启动终端显示的配对码。';
    }
  }
  boot();
})();
