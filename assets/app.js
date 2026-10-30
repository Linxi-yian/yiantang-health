/* 中医问诊与健康管理 —— 应用逻辑层
 * 纯前端 + localStorage 持久化，无外部依赖
 */

const STORE_KEY = 'tcm_health_v1';

/* ---------------- 工具函数 ---------------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const pad = n => (n < 10 ? '0' + n : '' + n);
const fmtDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const todayKey = () => fmtDate(new Date());
const dayOfYear = d => Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
const parseKey = k => { const p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
const shiftDay = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return fmtDate(d); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- 状态 ---------------- */
/* 月经周期：默认 30 天，允许 20–40 天，可由相邻两次经期开始日期自动推算
   （声明须在 DEFAULT_STATE 之前，供默认值引用） */
const PERIOD_CYCLE_DEFAULT = 30, PERIOD_CYCLE_MIN = 20, PERIOD_CYCLE_MAX = 40;

const DEFAULT_STATE = {
  version: 1,
  /* 最近一次真实数据修改时间：用于刷新 / 多端同步时判断哪一侧更新，旧数据默认按 0 兼容。 */
  _updatedAt: 0,
  profile: { name: '', gender: '', age: '', height: '' },
  /* 登录用户：{ name, gender: female|male|other, age, since }；未登录为 null */
  user: null,
  /* 本机数据归属的昵称：换人登录时据此清空上一位用户的个性化数据，做到同机不同用户互不影响 */
  owner: '',
  /* 用户主动选择「放弃登录」：此后不再自动弹登录窗；仍可随时从右上角入口登录 */
  guestSkip: false,
  /* 历次生成记录：只追加不覆盖。type: report / plan / menu */
  history: [],
  assessment: null,
  plan: null,
  habits: { list: [], logs: {} },
  records: {},
  /* weight.form：最近一次提交过的体重方案表单（用于下次进入时预填） */
  weight: { goal: '', plan: null, planAt: '', form: null },
  recipeSeed: 0,
  /* 食谱逐项「换一换」的选择记录：{ '日期': { breakfast: 序号, ... } } */
  menuPicks: {},
  /* 经期记录（仅女性可见）：{ 'YYYY-MM-DD': { day, flow, sore, pain, painLevel, start } }
     day 为经期第几天，start 由 day 反推的经期开始日期
     cycle 为月经周期天数；cycleMan 为 true 表示用户手动改过，不再自动回填 */
  period: { logs: {}, cycle: PERIOD_CYCLE_DEFAULT, cycleMan: false },
  /* 饮食画像：口味偏好 / 忌口与过敏 / 慢性病与饮食限制，驱动食谱个性化与去重 */
  diet: { likes: [], avoids: [], chronic: [], avoidText: '' }
};

/* 经期选项：出血量 / 不适感 / 疼痛程度（value, 文案） */
const PERIOD_DAYS = [1, 2, 3, 4, 5, 6, 7];
const PERIOD_FLOW = [['little', '偏少'], ['normal', '中等'], ['much', '偏多'], ['heavy', '很多']];
const PERIOD_SORE = [['none', '没有'], ['mild', '轻微'], ['clear', '明显'], ['severe', '严重']];
const PERIOD_PAIN_LEVEL = [['mild', '轻微'], ['clear', '明显'], ['severe', '剧烈']];
/* 严重程度权重：出血量 0.4 + 不适 0.3 + 痛经 0.3 */
const PERIOD_FLOW_W = { little: 1, normal: 2, much: 3, heavy: 4 };
const PERIOD_SORE_W = { none: 0, mild: 1, clear: 2, severe: 3 };
const PERIOD_PAIN_W = { mild: 1, clear: 2, severe: 3 };

/* 打卡热力图可选时间范围 */
const HEAT_RANGES = [30, 60, 90];

/* 体重管理：BMI 分级采用中国成人标准（《中国成人超重和肥胖症预防控制指南》，
   BMI < 18.5 偏瘦 / 18.5–23.9 正常 / 24.0–27.9 超重 / ≥ 28 肥胖）。 */
const BMI_BANDS = [
  { max: 18.5, label: '偏瘦', color: '#8A9CB5', advice: '重在健脾益气、增进摄入，不宜再刻意少吃' },
  { max: 24.0, label: '正常', color: '#7C9A6B', advice: '维持当前饮食与运动节奏，以体质调养为主' },
  { max: 28.0, label: '超重', color: '#C98A3C', advice: '以控油控糖 + 有氧运动为主，每周减重 0.5 kg 左右为宜' },
  { max: 999, label: '肥胖', color: '#A6432E', advice: '建议在医师指导下制定减重计划，避免过快减重与极端节食' }
];
const WM_TIPS = {
  pinghe: '体型稳定者重在维持：规律三餐、每周 150 分钟中等强度运动，体重波动控制在 2 kg 以内。',
  qixu: '气虚者减重忌猛：少食多餐、主食不可全断，宜八段锦、快走等缓运动，避免大汗伤气。',
  yangxu: '阳虚者代谢偏弱：忌生冷与代餐冷饮，宜温热饮食配合日间运动，晨起晒背 15 分钟有助于提升代谢。',
  yinxu: '阴虚者易虚火：忌辛辣烧烤与熬夜，减重宜缓，可配百合、银耳、麦冬等滋阴食材。',
  tanshi: '痰湿是体重管理的核心体质：控精制碳水与甜饮，宜薏苡仁、冬瓜、陈皮化痰湿，运动以出汗有氧为主。',
  shire: '湿热者先清后补：少油炸辛辣与酒，宜绿豆、苦瓜、薏米，配合中等强度有氧，忌暴汗后立即进补。',
  xueyu: '血瘀者重在通：久坐是主要诱因，建议每小时起身活动，饮食可配山楂、玫瑰、黑木耳，配合有氧与拉伸。',
  qiyu: '气郁者常情绪性进食：先调情绪节律，规律作息 + 户外运动，可饮玫瑰花、陈皮，避免夜间进食。',
  tebing: '特禀者先稳过敏与肠胃：记录饮食与症状关联，减重方案宜温和，忌盲目尝试代餐与断食。'
};

let state = load();
let ui = {
  page: 'home', assessStep: 0, answers: {}, skipped: {},
  metric: 'weight', menuOffset: 0, focusNo: 0,
  mineTab: 'all', mineId: null, modal: null,
  /* 体重方案生成：草稿表单 + 生成中 / 成功 / 失败三态 */
  wmForm: null, wmBusy: false, wmErr: '', wmStateErr: '', wmOk: '', wmBad: '',
  /* 打卡热力图时间范围：30 / 60 / 90 天 */
  heatRange: 30,
  /* 经期：草稿表单（仅女性）与日历查看月份 */
  period: null, periodMonth: '', periodErr: '',
  /* 身体档案：进入页面时仅今日记录与趋势默认展开；身体历史在今日记录内按需展开 */
  archiveOpen: { record: true, trend: true, shape: false, weight: false, periodRecord: false, periodCalendar: false, tcm: false, wm: false },
  archiveHistoryOpen: false,
  /* 登录弹窗：二次确认层是否展开；是否临时放行「未登录时关闭登录弹窗」 */
  loginAsk: false, allowCloseLogin: false,
  authMode: 'register', authBusy: false, authNotice: '', recovery: null,
  authDraft: { nickname: '', age: '', recoveryCode: '' }
};

/* 云端账号同步：云端为主，本机保留临时缓存；旧版未配置账号时继续使用本地模式。 */
const CLOUD_SYNC = { ready: false, revision: 0, timer: 0, busy: false, dirty: false };
function cloudOn() { return typeof EYAuth !== 'undefined' && EYAuth.enabled && EYAuth.enabled(); }
function cloudUser() { return cloudOn() && EYAuth.signedIn() ? EYAuth.user() : null; }
function personalDataScore(s) {
  if (!s) return 0;
  const count = x => x && typeof x === 'object' ? Object.keys(x).length : 0;
  return (s.assessment ? 20 : 0) + (s.plan ? 10 : 0) + ((s.history || []).length * 8) +
    (count(s.records) * 4) + (count(s.period && s.period.logs) * 3) +
    (count(s.habits && s.habits.logs) * 2) + ((s.habits && s.habits.list) || []).length +
    (s.weight && (s.weight.goal || s.weight.plan) ? 3 : 0) +
    (s.profile && s.profile.height ? 1 : 0) +
    (s.diet && ((s.diet.likes || []).length || (s.diet.avoids || []).length || (s.diet.chronic || []).length || s.diet.avoidText) ? 2 : 0);
}
function hasPersonalData(s) {
  return personalDataScore(s) > 0;
}
function latestAssessmentFromHistory(source) {
  const reports = ((source && source.history) || []).filter(x => x && x.type === 'report' && x.primary && CONSTITUTIONS[x.primary]);
  let latest = null, latestTime = -Infinity, latestIndex = -1;
  reports.forEach((item, index) => {
    const stamp = +item.ts || Date.parse(item.at || '') || index;
    if (stamp > latestTime || (stamp === latestTime && index > latestIndex)) {
      latest = item; latestTime = stamp; latestIndex = index;
    }
  });
  if (!latest) return null;
  const data = latest.data || {};
  return {
    assessment: {
      date: latest.at || data.date || todayKey(),
      primary: latest.primary,
      verdictText: data.verdictText || latest.title || CONSTITUTIONS[latest.primary].name,
      summary: data.summary || '',
      scores: data.scores && typeof data.scores === 'object' ? data.scores : {},
      secondary: Array.isArray(data.secondary) ? data.secondary.filter(id => CONSTITUTIONS[id]) : [],
      tendencies: Array.isArray(data.tendencies) ? data.tendencies.filter(id => CONSTITUTIONS[id]) : []
    },
    extra: data.extra && typeof data.extra === 'object' ? JSON.parse(JSON.stringify(data.extra)) : null
  };
}
function restoreLatestAssessment(source) {
  const latest = latestAssessmentFromHistory(source);
  if (!latest) return false;
  source.assessment = latest.assessment;
  if (latest.extra) source.extra = latest.extra;
  return true;
}
function mergeCloudState(local, remote) {
  const l = local || {}, r = remote || {};
  const localStamp = +l._updatedAt || 0, remoteStamp = +r._updatedAt || 0;
  const localWins = localStamp > remoteStamp || (localStamp === remoteStamp && personalDataScore(l) > personalDataScore(r));
  const newer = localWins ? l : r, older = localWins ? r : l;
  const out = Object.assign(JSON.parse(JSON.stringify(DEFAULT_STATE)), JSON.parse(JSON.stringify(older || {})), JSON.parse(JSON.stringify(newer || {})));
  out.profile = Object.assign({}, (older && older.profile) || {}, (newer && newer.profile) || {});
  const hist = [].concat((newer && newer.history) || [], (older && older.history) || []), seen = {};
  out.history = hist.filter(x => x && x.id && !seen[x.id] && (seen[x.id] = true));
  out.records = Object.assign({}, (older && older.records) || {}, (newer && newer.records) || {});
  out.period = Object.assign({}, (older && older.period) || {}, (newer && newer.period) || {});
  out.period.logs = Object.assign({}, (older && older.period && older.period.logs) || {}, (newer && newer.period && newer.period.logs) || {});
  out.menuPicks = Object.assign({}, (older && older.menuPicks) || {}, (newer && newer.menuPicks) || {});
  out.habits = Object.assign({}, (older && older.habits) || {}, (newer && newer.habits) || {});
  out.habits.list = [].concat((newer && newer.habits && newer.habits.list) || [], (older && older.habits && older.habits.list) || []).filter((x, i, a) => x && x.id && a.findIndex(y => y.id === x.id) === i);
  out.habits.logs = Object.assign({}, (older && older.habits && older.habits.logs) || {}, (newer && newer.habits && newer.habits.logs) || {});
  out.weight = Object.assign({}, (older && older.weight) || {}, (newer && newer.weight) || {});
  out.diet = Object.assign({}, (older && older.diet) || {}, (newer && newer.diet) || {});
  out._updatedAt = Math.max(localStamp, remoteStamp);
  return out;
}
function reconcileCloudState(local, remote, currentId) {
  const r = remote && typeof remote === 'object' ? remote : {};
  if (r.owner && currentId && r.owner !== currentId) {
    const err = new Error('云端数据归属异常，已停止覆盖本机数据');
    err.code = 'state_owner_mismatch';
    throw err;
  }
  const localSameAccount = !!(local && currentId && local.owner === currentId);
  const base = localSameAccount && hasPersonalData(local) ? mergeCloudState(local, r) : Object.assign(JSON.parse(JSON.stringify(DEFAULT_STATE)), JSON.parse(JSON.stringify(r)));
  base.owner = currentId || base.owner || '';
  restoreLatestAssessment(base);
  return base;
}
function applyCloudIdentity(target, activeUser, current) {
  if (!target || !activeUser) return;
  target.user = Object.assign({}, target.user || {}, activeUser);
  target.owner = (current && current.id) || activeUser.id || target.owner || '';
  target.profile = Object.assign({}, target.profile || {}, {
    name: activeUser.name || (target.profile || {}).name || '',
    gender: activeUser.gender === 'female' ? '女' : activeUser.gender === 'male' ? '男' : (target.profile || {}).gender || '',
    age: activeUser.age ? String(activeUser.age) : (target.profile || {}).age || ''
  });
}
function stateDataFingerprint(source) {
  const s = source || {};
  return JSON.stringify({
    version: s.version || 1, profile: s.profile || {}, history: s.history || [], assessment: s.assessment || null,
    plan: s.plan || null, habits: s.habits || {}, records: s.records || {}, weight: s.weight || {},
    recipeSeed: s.recipeSeed || 0, menuPicks: s.menuPicks || {}, period: s.period || {}, diet: s.diet || {}
  });
}
function claimLegacyLocalState(source, currentId, nickname) {
  const local = JSON.parse(JSON.stringify(source || DEFAULT_STATE));
  if (currentId && nickname && local.owner === nickname && local.owner !== currentId) local.owner = currentId;
  return local;
}
async function hydrateCloudState(initialScroll) {
  if (!cloudUser() || typeof EYCloud === 'undefined') return;
  const activeUser = state.user ? JSON.parse(JSON.stringify(state.user)) : null;
  const currentAtStart = cloudUser();
  const localBefore = claimLegacyLocalState(state, currentAtStart && currentAtStart.id, activeUser && activeUser.name);
  try {
    const current = cloudUser();
    const row = await EYCloud.getState();
    if (row && row.state) {
      const remoteBefore = Object.assign(JSON.parse(JSON.stringify(DEFAULT_STATE)), JSON.parse(JSON.stringify(row.state)));
      state = reconcileCloudState(localBefore, row.state, current && current.id);
      applyCloudIdentity(state, activeUser, current);
      CLOUD_SYNC.revision = +row.revision || 0;
      CLOUD_SYNC.ready = true;
      save({ touch: false, cloud: false });
      if (stateDataFingerprint(state) !== stateDataFingerprint(remoteBefore)) {
        CLOUD_SYNC.dirty = true;
        await saveCloudNow();
      }
    } else {
      state = reconcileCloudState(localBefore, {}, current && current.id);
      applyCloudIdentity(state, activeUser, current);
      CLOUD_SYNC.revision = 0;
      CLOUD_SYNC.ready = true;
      save({ touch: false, cloud: false });
      CLOUD_SYNC.dirty = true;
      await saveCloudNow();
    }
    CLOUD_SYNC.ready = true;
    rebuildQuestions(); syncUserEntry();
    render(initialScroll == null ? { top: true } : { scroll: initialScroll });
  } catch (e) {
    const current = cloudUser();
    if (current && localBefore.owner && localBefore.owner !== current.id) {
      state = Object.assign(JSON.parse(JSON.stringify(DEFAULT_STATE)), { user: activeUser, owner: current.id });
      applyCloudIdentity(state, activeUser, current);
    }
    toast(e && e.code === 'state_owner_mismatch' ? e.message : '云端数据暂时无法同步，请检查网络后重试');
  }
}
function queueCloudSave() {
  if (!CLOUD_SYNC.ready || !cloudUser() || typeof EYCloud === 'undefined') return;
  CLOUD_SYNC.dirty = true;
  clearTimeout(CLOUD_SYNC.timer);
  CLOUD_SYNC.timer = setTimeout(saveCloudNow, 500);
}
async function saveCloudNow() {
  if (!CLOUD_SYNC.ready || !cloudUser() || typeof EYCloud === 'undefined') return false;
  if (CLOUD_SYNC.busy) { CLOUD_SYNC.dirty = true; return false; }
  CLOUD_SYNC.busy = true;
  try {
    do {
      CLOUD_SYNC.dirty = false;
      const snapshot = JSON.parse(JSON.stringify(state));
      CLOUD_SYNC.revision = await EYCloud.putState(snapshot, CLOUD_SYNC.revision);
    } while (CLOUD_SYNC.dirty);
    return true;
  }
  catch (e) { CLOUD_SYNC.dirty = true; toast('本次修改尚未同步到云端'); return false; }
  finally { CLOUD_SYNC.busy = false; }
}
async function flushCloudSave() {
  clearTimeout(CLOUD_SYNC.timer);
  if (!CLOUD_SYNC.ready || !cloudUser() || typeof EYCloud === 'undefined') return false;
  const wasBusy = CLOUD_SYNC.busy;
  CLOUD_SYNC.dirty = true;
  for (let i = 0; CLOUD_SYNC.busy && i < 20; i++) await new Promise(resolve => setTimeout(resolve, 50));
  if (CLOUD_SYNC.busy) return false;
  if (wasBusy && !CLOUD_SYNC.dirty) return true;
  return saveCloudNow();
}

/* ---------------- 登录态与专项题库 ---------------- */
function isLogin() { return !!(state.user && state.user.name); }
function genderKey() { return (state.user && (state.user.gender === 'female' || state.user.gender === 'male')) ? state.user.gender : ''; }
/* 经期相关的一切（板块、入口、字段、文案）只对女性用户开放 */
function isFemale() { return genderKey() === 'female'; }
function ageNum() { const n = +((state.user && state.user.age) || 0); return (n > 0 && n < 130) ? n : 0; }
function ageBandOf(age) {
  const n = age === undefined ? ageNum() : age;
  if (!n) return '';
  if (n < 18) return 'teen';
  if (n < 45) return 'young';
  if (n < 60) return 'mid';
  return 'senior';
}

/* 基础卷 45 题（33 核心 + 12 补充，其中 1 道为条件题）+ 按性别 / 年龄动态追加的专项题（总题量恒 ≤ 51） */
let ACTIVE_QUESTIONS = null;
/* 条件题：仅当 cond.no 那道题的作答里含 cond.vals 中任一选项值时才出现
   （例如勾了「睡眠不好」之后，才追问睡眠的具体表现） */
function condMet(q) {
  const c = q.cond;
  if (!c) return true;
  const v = ui.answers[c.no];
  if (!Array.isArray(v) || !v.length) return false;
  for (let i = 0; i < c.vals.length; i++) { if (v.indexOf(c.vals[i]) > -1) return true; }
  return false;
}
function buildQuestionSet() {
  const base = QUESTIONS.filter(condMet);
  let hIdx = base.length;
  for (let i = 0; i < base.length; i++) { if ((base[i].g || 'CORE') === 'H') { hIdx = i; break; } }
  const head = base.slice(0, hIdx), tail = base.slice(hIdx);
  const g = genderKey(), band = ageBandOf();
  const mid = [];
  if (g && GENDER_QUESTIONS[g]) mid.push.apply(mid, GENDER_QUESTIONS[g]);
  if (band && AGE_QUESTIONS[band]) mid.push.apply(mid, AGE_QUESTIONS[band]);
  return head.concat(mid, tail);
}
function questions() { return ACTIVE_QUESTIONS || (ACTIVE_QUESTIONS = buildQuestionSet()); }
function rebuildQuestions() { ACTIVE_QUESTIONS = buildQuestionSet(); }
function estMinutes(total) { return Math.max(1, Math.round((total || questions().length) * 8 / 54)); }
function specialCount() {
  let n = 0;
  if (genderKey() && GENDER_QUESTIONS[genderKey()]) n += GENDER_QUESTIONS[genderKey()].length;
  const b = ageBandOf();
  if (b && AGE_QUESTIONS[b]) n += AGE_QUESTIONS[b].length;
  return n;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_STATE));
    const s = JSON.parse(raw);
    const merged = Object.assign(JSON.parse(JSON.stringify(DEFAULT_STATE)), s);
    if (!Array.isArray(merged.history)) merged.history = [];
    if (!Array.isArray(merged.habits && merged.habits.list)) merged.habits = { list: [], logs: {} };
    if (!merged.menuPicks || typeof merged.menuPicks !== 'object') merged.menuPicks = {};
    /* 体重方案：旧版为「粘贴导入」的外部 JSON，结构不兼容，清空后按新的本地生成流程重来 */
    if (!merged.weight || typeof merged.weight !== 'object') merged.weight = { goal: '', plan: null, planAt: '', form: null };
    if (merged.weight.plan && merged.weight.plan.v !== 1) { merged.weight.plan = null; merged.weight.planAt = ''; }
    if (merged.weight.form && typeof merged.weight.form !== 'object') merged.weight.form = null;
    /* 经期记录：老数据没有该字段，补齐后不影响既有内容 */
    if (!merged.period || typeof merged.period !== 'object' || !merged.period.logs || typeof merged.period.logs !== 'object') {
      merged.period = { logs: {} };
    }
    /* 月经周期：老数据补齐默认值 */
    if (typeof merged.period.cycle !== 'number' || !isFinite(merged.period.cycle)) merged.period.cycle = PERIOD_CYCLE_DEFAULT;
    if (typeof merged.period.cycleMan !== 'boolean') merged.period.cycleMan = false;
    /* 饮食画像：老数据补齐空结构 */
    if (!merged.diet || typeof merged.diet !== 'object') merged.diet = { likes: [], avoids: [], chronic: [], avoidText: '' };
    ['likes', 'avoids', 'chronic'].forEach(f => { if (!Array.isArray(merged.diet[f])) merged.diet[f] = []; });
    if (typeof merged.diet.avoidText !== 'string') merged.diet.avoidText = '';
    /* 性别仅保留「男 / 女」两项，历史数据中的其他取值清空后需重新选择 */
    if (merged.user && merged.user.gender !== 'female' && merged.user.gender !== 'male') {
      merged.user.gender = '';
      merged.profile.gender = '';
    }
    /* 数据归属：老数据没有该字段，按当前登录昵称补齐（未登录则留空，页面保持占位态） */
    if (typeof merged.owner !== 'string') merged.owner = (merged.user && merged.user.name) || '';
    /* 放弃登录标记：老数据没有该字段，按 false 补齐（默认仍会弹登录窗） */
    if (typeof merged.guestSkip !== 'boolean') merged.guestSkip = false;
    return merged;
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
}
/* 登录态兜底标记（cookie）
   localStorage 按「协议 + 主机 + 端口」隔离，端口或协议一变就读不到（例如本地预览端口随机、http/https 混用）；
   cookie 不区分端口、只按主机 + path=/ 共享，因此多写一份，启动时若 localStorage 读不到可据此自动恢复登录。
   只存昵称/性别/年龄三项，不含任何测评与推荐内容。 */
const LOGIN_MARK = 'tcm_health_user';
function writeLoginMark(u) {
  try {
    if (!u || !u.name) { clearLoginMark(); return; }
    const v = encodeURIComponent(JSON.stringify({ n: u.name, g: u.gender || '', a: u.age || '' }));
    document.cookie = LOGIN_MARK + '=' + v + ';path=/;max-age=315360000;samesite=lax';
  } catch (e) { /* cookie 不可用时静默：localStorage 仍是主存储 */ }
}
function readLoginMark() {
  try {
    const m = document.cookie.match(/(?:^|;\s*)tcm_health_user=([^;]*)/);
    if (!m) return null;
    const o = JSON.parse(decodeURIComponent(m[1]));
    if (!o || !o.n) return null;
    if (o.g !== 'female' && o.g !== 'male') return null;
    const a = +o.a; if (!(a > 0 && a < 130)) return null;
    return { n: String(o.n), g: o.g, a: a };
  } catch (e) { return null; }
}
function clearLoginMark() {
  try { document.cookie = LOGIN_MARK + '=;path=/;max-age=0;samesite=lax'; } catch (e) { /* 忽略 */ }
}

/* 保存失败要让用户看见：否则「以为登录成功、下次打开却没有」无法解释 */
let SAVE_WARN = '';
function save(options) {
  const opts = options || {};
  SAVE_WARN = '';
  if (opts.touch !== false) state._updatedAt = Date.now();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { console.warn('保存失败', e); SAVE_WARN = 'local'; }
  if (isLogin()) writeLoginMark(state.user); else clearLoginMark();
  if (opts.cloud !== false) queueCloudSave();
}

/* 导入备份只接受应用导出的基本结构，并修复会进入 HTML 属性或数值运算的字段。 */
function normalizeImportedState(input) {
  const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
  if (!isObject(input)) throw new Error('备份内容必须是对象');
  const next = JSON.parse(JSON.stringify(DEFAULT_STATE));
  Object.keys(DEFAULT_STATE).forEach(k => { if (Object.prototype.hasOwnProperty.call(input, k)) next[k] = input[k]; });
  if (Object.prototype.hasOwnProperty.call(input, 'extra')) next.extra = input.extra;
  if (!isObject(next.profile) || !isObject(next.weight) || !isObject(next.habits)) throw new Error('备份结构不完整');
  if (!Array.isArray(next.history) || next.history.length > 5000) throw new Error('历史记录格式不正确');
  if (!isObject(next.records) || !isObject(next.period) || !isObject(next.diet)) throw new Error('记录格式不正确');
  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const numeric = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  Object.keys(next.records).forEach(k => {
    const r = next.records[k];
    if (!validDate(k) || !isObject(r)) throw new Error('身体记录格式不正确');
    [['weight', 0, 300], ['sleep', 0, 24], ['energy', 0, 5], ['mood', 0, 5], ['bodyfat', 0, 100]].forEach(([f, lo, hi]) => {
      if (r[f] !== undefined && r[f] !== '' && !numeric(r[f], lo, hi)) throw new Error('身体记录数值不正确');
    });
    ['stool', 'tongue', 'note'].forEach(f => {
      if (r[f] !== undefined && (typeof r[f] !== 'string' || r[f].length > 2000)) throw new Error('身体记录文本不正确');
    });
    if (r.bedtime !== undefined && r.bedtime !== '' && (typeof r.bedtime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.bedtime))) throw new Error('入睡时间格式不正确');
    if (r.symptoms !== undefined && (!Array.isArray(r.symptoms) || r.symptoms.some(x => typeof x !== 'string' || x.length > 100))) throw new Error('身体记录症状格式不正确');
  });
  if (!Array.isArray(next.habits.list) || !isObject(next.habits.logs)) throw new Error('习惯记录格式不正确');
  next.habits.list.forEach(h => {
    if (!isObject(h) || typeof h.id !== 'string' || !/^[\w-]{1,80}$/.test(h.id) || typeof h.text !== 'string' || h.text.length > 200) throw new Error('习惯条目格式不正确');
  });
  const originalHistoryCount = next.history.length;
  next.history = next.history.filter(r => {
    if (!isObject(r) || !['report', 'plan', 'menu', 'wplan'].includes(r.type) || typeof r.id !== 'string' || !/^[\w-]{1,80}$/.test(r.id)) return false;
    if (!validDate(r.at) || (r.primary && !CONSTITUTIONS[r.primary]) || typeof r.title !== 'string' || !isObject(r.data)) return false;
    if (r.type === 'menu' && (!Array.isArray(r.data.days) || r.data.days.length > 7 || r.data.days.some(d => !isObject(d) || !validDate(d.date) || ['breakfast', 'lunch', 'dinner', 'drink', 'fruit', 'supplement', 'supplementTime'].some(f => d[f] !== undefined && typeof d[f] !== 'string')))) return false;
    return true;
  });
  next._importSkippedHistory = originalHistoryCount - next.history.length;
  if (next.user !== null && (!isObject(next.user) || typeof next.user.name !== 'string' || next.user.name.length > 20 || !['female', 'male'].includes(next.user.gender) || !numeric(+next.user.age, 1, 120))) throw new Error('用户资料格式不正确');
  if (typeof next.profile.name !== 'string' || next.profile.name.length > 20 || typeof next.profile.gender !== 'string' || typeof next.profile.age !== 'string') throw new Error('档案资料格式不正确');
  if (next.assessment !== null && (!isObject(next.assessment) || !CONSTITUTIONS[next.assessment.primary] || !isObject(next.assessment.scores) ||
      !CONSTITUTION_ORDER.every(id => isObject(next.assessment.scores[id]) && numeric(next.assessment.scores[id].conv, 0, 100)) ||
      !Array.isArray(next.assessment.secondary) || next.assessment.secondary.some(id => !CONSTITUTIONS[id]) ||
      !Array.isArray(next.assessment.tendencies) || next.assessment.tendencies.some(id => !CONSTITUTIONS[id]))) throw new Error('测评结果格式不正确');
  if (next.profile.height !== '' && !/^\d{1,3}(\.\d)?$/.test(String(next.profile.height))) throw new Error('身高格式不正确');
  Object.keys(next.period.logs || {}).forEach(k => { if (!validDate(k) || !isObject(next.period.logs[k])) throw new Error('经期记录格式不正确'); });
  if (!Array.isArray(next.diet.likes) || !Array.isArray(next.diet.avoids) || !Array.isArray(next.diet.chronic) || typeof next.diet.avoidText !== 'string') throw new Error('饮食画像格式不正确');
  if (next.weight.goal !== '' && !/^\d{1,3}(\.\d)?$/.test(String(next.weight.goal))) throw new Error('目标体重格式不正确');
  if (next.weight.form !== null && !isObject(next.weight.form)) throw new Error('体重表单格式不正确');
  return next;
}

/* 跨域旧站迁移：备份只补充当前账号的数据，绝不能替换已登录账号的身份与归属。 */
function mergeImportedAccountState(currentState, input, currentId, activeUser) {
  const imported = normalizeImportedState(input);
  const skippedHistory = imported._importSkippedHistory || 0;
  delete imported._importSkippedHistory;
  const live = currentState || JSON.parse(JSON.stringify(DEFAULT_STATE));
  const accountUser = activeUser || live.user || null;
  const accountName = String((accountUser && accountUser.name) || '').trim();
  const sameName = value => String(value || '').trim().toLocaleLowerCase() === accountName.toLocaleLowerCase();
  const backupName = String((imported.user && imported.user.name) || (imported.profile && imported.profile.name) || '').trim();
  const backupOwner = String(imported.owner || '').trim();
  if (accountName && backupName && !sameName(backupName)) {
    const err = new Error('备份属于其他账号，未执行导入'); err.code = 'import_account_mismatch'; throw err;
  }
  if (currentId && backupOwner && backupOwner !== currentId && !sameName(backupOwner)) {
    const err = new Error('备份的数据归属与当前账号不一致，未执行导入'); err.code = 'import_owner_mismatch'; throw err;
  }
  const bound = JSON.parse(JSON.stringify(imported));
  bound.owner = currentId || live.owner || accountName;
  bound.user = accountUser ? JSON.parse(JSON.stringify(accountUser)) : null;
  const merged = mergeCloudState(live, bound);
  const unionText = (a, b) => Array.from(new Set([].concat(a || [], b || []).filter(x => typeof x === 'string' && x.trim())));
  merged.diet = Object.assign({}, imported.diet || {}, live.diet || {}, merged.diet || {});
  merged.diet.likes = unionText(live.diet && live.diet.likes, imported.diet && imported.diet.likes);
  merged.diet.avoids = unionText(live.diet && live.diet.avoids, imported.diet && imported.diet.avoids);
  merged.diet.chronic = unionText(live.diet && live.diet.chronic, imported.diet && imported.diet.chronic);
  if (!merged.diet.avoidText && imported.diet) merged.diet.avoidText = imported.diet.avoidText || '';
  if (!merged.profile.height && imported.profile) merged.profile.height = imported.profile.height || '';
  if (!merged.weight.goal && imported.weight) merged.weight.goal = imported.weight.goal || '';
  if (!merged.weight.plan && imported.weight) merged.weight.plan = imported.weight.plan || null;
  if (!merged.assessment && imported.assessment) merged.assessment = imported.assessment;
  if (!merged.plan && imported.plan) merged.plan = imported.plan;
  merged.owner = currentId || live.owner || accountName;
  merged.user = accountUser ? JSON.parse(JSON.stringify(accountUser)) : null;
  if (accountUser) applyCloudIdentity(merged, accountUser, currentId ? { id: currentId } : null);
  restoreLatestAssessment(merged);
  merged._updatedAt = Date.now();
  merged._importSkippedHistory = skippedHistory;
  return merged;
}

function extraSafetyNotes(extra) {
  const x = extra || {};
  const health = Array.isArray(x[39]) && x[39].some(v => +v < 9);
  const severe = +x[44] >= 4;
  const freeText = String(x[45] || '');
  const mentionsRisk = /过敏|备孕|怀孕|孕期|哺乳|服药|用药|慢病|手术/.test(freeText);
  const notes = [];
  if (health || mentionsRisk) notes.push('你提到健康、过敏或用药相关情况。药膳、补充剂与运动安排请先让医生或药师结合你的情况核对；本工具无法判断药物与食物的相互作用。');
  if (severe) notes.push('你选择的困扰持续较久或已明显影响日常，建议尽快寻求专业评估；本方案仅作生活方式参考。');
  return notes;
}

/* ---------------- 体质判定 ---------------- */
function computeResult(answers) {
  const scores = {};
  SCORE_RULES.forEach(rule => {
    let raw = 0;
    rule.items.forEach(no => { raw += (+answers[no] || 1); });
    const conv = clamp(((raw - rule.items.length) / (rule.items.length * 4)) * 100, 0, 100);
    scores[rule.id] = { raw, conv: Math.round(conv * 10) / 10, verdict: biasedVerdict(conv) };
  });

  let pRaw = 0;
  PEACEFUL.items.forEach(no => {
    let v = +answers[no] || 1;
    if (PEACEFUL.reverse.indexOf(no) > -1) v = 6 - v;
    pRaw += v;
  });
  const pConv = clamp(((pRaw - PEACEFUL.items.length) / (PEACEFUL.items.length * 4)) * 100, 0, 100);
  const othersMax = Math.max.apply(null, BIASED_ORDER.map(id => scores[id].conv));
  let pVerdict = '否';
  if (pConv >= 60 && othersMax < 30) pVerdict = '是';
  else if (pConv >= 60 && othersMax < 40) pVerdict = '基本是';
  scores.pinghe = { raw: pRaw, conv: Math.round(pConv * 10) / 10, verdict: pVerdict };

  const confirmed = BIASED_ORDER.filter(id => scores[id].conv >= 40).sort((a, b) => scores[b].conv - scores[a].conv);
  const tendencies = BIASED_ORDER.filter(id => scores[id].conv >= 30 && scores[id].conv < 40).sort((a, b) => scores[b].conv - scores[a].conv);

  let primary, verdictText;
  if (pVerdict === '是') {
    primary = 'pinghe';
    verdictText = '平和质';
  } else if (pVerdict === '基本是') {
    primary = 'pinghe';
    verdictText = '基本是平和质' + (tendencies.length ? '，有' + tendencies.map(id => CONSTITUTIONS[id].name).join('、') + '倾向' : '');
  } else {
    const pool = confirmed.length ? confirmed : tendencies;
    if (!pool.length) {
      primary = 'pinghe';
      verdictText = '各项偏颇均不显著，接近平和质（建议两周后复测）';
    } else {
      primary = pool[0];
      verdictText = CONSTITUTIONS[primary].name;
    }
  }

  const secondary = confirmed.filter(id => id !== primary);
  const tend = tendencies.filter(id => id !== primary);

  return {
    date: todayKey(),
    answers: Object.assign({}, answers),
    scores,
    primary,
    secondary,
    tendencies: tend,
    verdictText,
    summary: buildSummary(primary, secondary, tend, scores)
  };
}

function biasedVerdict(conv) {
  if (conv >= 40) return '是';
  if (conv >= 30) return '倾向是';
  return '否';
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function buildSummary(primary, secondary, tend, scores) {
  const c = CONSTITUTIONS[primary];
  let s = '您的体质判定为「' + c.name + '」，' + c.tagline + '。';
  if (secondary.length) {
    s += '同时兼夹' + secondary.map(id => CONSTITUTIONS[id].name).join('、') + '，调理时以' + c.name + '为主、兼顾兼夹体质。';
  } else if (tend.length) {
    s += '并有' + tend.map(id => CONSTITUTIONS[id].name).join('、') + '倾向，宜提前干预防其发展。';
  } else {
    s += '其余体质维度均不显著，调理方向明确。';
  }
  s += ' 建议按下方方案坚持 4 至 8 周后复测，观察转化分变化。';
  return s;
}

/* ---------------- 习惯 ---------------- */
function ensureHabits() {
  if (state.habits.list.length) return;
  const cid = state.assessment ? state.assessment.primary : 'pinghe';
  const list = COMMON_HABITS.map(h => Object.assign({ source: 'common' }, h))
    .concat((HABITS[cid] || HABITS.pinghe).slice(0, 6).map(h => Object.assign({ source: cid }, h)));
  state.habits.list = list;
  save();
}
/* 复测后补充新体质的习惯：保留既有清单、自定义项与打卡记录，不清除历史 */
function mergeHabits(cid) {
  const cur = Array.isArray(state.habits.list) ? state.habits.list : [];
  const seen = {};
  cur.forEach(h => { if (h && h.text) seen[h.text] = 1; });
  const add = (HABITS[cid] || HABITS.pinghe).slice(0, 6)
    .filter(h => !seen[h.text])
    .map(h => Object.assign({ source: cid }, h));
  state.habits.list = cur.concat(add);
}
/* 习惯 CRUD：修改只换文字（保留打卡记录），删除会连历史记录一起清除 */
function habitById(id) {
  const L = state.habits.list || [];
  for (let i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
  return null;
}
function habitLogCount(id) {
  let n = 0;
  const logs = state.habits.logs || {};
  Object.keys(logs).forEach(k => { if ((logs[k] || []).indexOf(id) > -1) n++; });
  return n;
}
function addHabit(text, tag) {
  state.habits.list = state.habits.list || [];
  state.habits.list.push({
    id: 'u' + Date.now(), text: text, tag: tag || 'routine',
    freq: 'daily', why: '自定义习惯', custom: true
  });
  save();
}
function editHabit(id, text, tag) {
  const it = habitById(id);
  if (!it) return false;
  it.text = text;
  if (tag) it.tag = tag;
  save();
  return true;
}
function deleteHabit(id) {
  state.habits.list = (state.habits.list || []).filter(h => h.id !== id);
  const logs = state.habits.logs || {};
  Object.keys(logs).forEach(k => {
    const arr = (logs[k] || []).filter(x => x !== id);
    if (arr.length) logs[k] = arr; else delete logs[k];
  });
  save();
}
/* 每条习惯的「修改 / 删除」操作（首页与习惯页共用） */
function habitOpsHtml(id) {
  return '<span class="habit-ops">' +
    '<button class="op" data-action="habit-edit" data-id="' + id + '">修改</button>' +
    '<button class="op del" data-action="habit-del" data-id="' + id + '">删除</button>' +
    '</span>';
}

function todayDone() { return state.habits.logs[todayKey()] || []; }
function toggleHabit(id) {
  const k = todayKey();
  const arr = state.habits.logs[k] || (state.habits.logs[k] = []);
  const i = arr.indexOf(id);
  if (i > -1) arr.splice(i, 1); else arr.push(id);
  if (!arr.length) delete state.habits.logs[k];
  save();
}
function streakDays() {
  const list = state.habits.list;
  if (!list.length) return 0;
  const target = Math.max(1, Math.round(list.length * 0.5));
  let n = 0, k = todayKey();
  if ((state.habits.logs[k] || []).length < target) k = shiftDay(k, -1);
  while ((state.habits.logs[k] || []).length >= target) { n++; k = shiftDay(k, -1); }
  return n;
}
function doneRate(key) {
  const list = state.habits.list;
  if (!list.length) return 0;
  return (state.habits.logs[key] || []).length / list.length;
}

/* ---------------- 食谱 ----------------
 * 五个推荐位：早 / 午 / 晚 / 茶 / 果
 * 每一位可单独「换一换」，只改动该位的序号，其余位不受影响
 */
const MENU_SLOTS = [
  { key: 'breakfast',  arr: 'breakfast',   mark: '早', cls: '' },
  { key: 'lunch',      arr: 'lunch',       mark: '午', cls: '' },
  { key: 'dinner',     arr: 'dinner',      mark: '晚', cls: '' },
  { key: 'drink',      arr: 'drinks',      mark: '茶', cls: 'tea' },
  { key: 'fruit',      arr: 'fruits',      mark: '果', cls: 'fruit' }
];
/* 女性经期：该日是否落在已记录的经期区间内 */
function periodOnDay(key) { return isFemale() && typeof periodDayMap()[key] === 'number'; }
/* 食材是否偏寒凉（菜名包含寒凉关键词即判定） */
function isColdFood(name) {
  const s = String(name || '');
  for (let i = 0; i < COLD_FOOD_KEYS.length; i++) if (s.indexOf(COLD_FOOD_KEYS[i]) > -1) return true;
  return false;
}
/* 一周内同一道餐食最多出现 2 次；候选池低于此值时该上限可能无法同时满足，
   因此在筛选后会自动从通用菜池补齐到 MIN_POOL（= ceil(7 / 2)） */
const MAX_DISH_PER_WEEK = 2;
const MIN_POOL = 4;

/* ---------------- 食材解析 ----------------
 * 从菜名里解析出食材（长词优先、已命中区间不重复计入），供同日去重使用
 */
function ingHits(name) {
  const s = String(name || '');
  const cover = new Array(s.length);
  const hits = [];
  for (let i = 0; i < INGREDIENT_LEX.length; i++) {
    const kw = INGREDIENT_LEX[i][0], cn = INGREDIENT_LEX[i][1];
    let from = 0, at;
    while ((at = s.indexOf(kw, from)) > -1) {
      let free = true;
      for (let j = at; j < at + kw.length; j++) { if (cover[j]) { free = false; break; } }
      if (free) {
        for (let j = at; j < at + kw.length; j++) cover[j] = true;
        hits.push({ k: kw, n: cn, i: at });
      }
      from = at + 1;
    }
  }
  hits.sort((a, b) => a.i - b.i);
  return hits;
}
function ingsOf(name) {
  const h = ingHits(name), seen = {}, out = [];
  for (let i = 0; i < h.length; i++) { if (!seen[h[i].n]) { seen[h[i].n] = 1; out.push(h[i].n); } }
  return out;
}
/* 烹饪方式：用于同一天内尽量错开做法 */
function methodOf(name) {
  const s = String(name || '');
  for (let i = 0; i < METHOD_KEYS.length; i++) if (s.indexOf(METHOD_KEYS[i]) > -1) return METHOD_KEYS[i];
  for (let i = 0; i < FORM_KEYS.length; i++) if (s.indexOf(FORM_KEYS[i]) > -1) return FORM_KEYS[i];
  return '';
}
/* 词尾形态（饭 / 粥 / 面 / 羹 / 糊 / 汤）：替换食材时保留，避免出现「红薯饭饭」 */
function formOf(kw) {
  const c = String(kw || '').slice(-1);
  return ('饭粥面羹糊汤'.indexOf(c) > -1) ? c : '';
}

/* ---------------- 饮食画像 ----------------
 * 忌口与偏好：本页填写的「饮食画像」与身体管理方案表单取并集
 */
function dietAll() {
  const d = (state.diet && typeof state.diet === 'object') ? state.diet : {};
  const f = (state.weight && state.weight.form && typeof state.weight.form === 'object') ? state.weight.form : {};
  const uniq = arr => { const s = {}, o = []; (arr || []).forEach(x => { if (x && !s[x]) { s[x] = 1; o.push(x); } }); return o; };
  return {
    likes: uniq((d.likes || []).concat(f.likes || [])),
    avoids: uniq((d.avoids || []).concat(f.avoids || [])),
    chronic: uniq(d.chronic || []),
    avoidText: String(d.avoidText || f.avoidText || '')
  };
}
/* 需要避开的关键词（忌口 + 慢病 + 自由填写 + 偏好型排除） */
function dietBanKeys() {
  const d = dietAll();
  let keys = [];
  d.avoids.forEach(a => { keys = keys.concat(DIET_AVOID_RULES[a] || []); });
  d.chronic.forEach(c => { keys = keys.concat(DIET_CHRONIC_RULES[c] || []); });
  d.likes.forEach(l => { keys = keys.concat(DIET_LIKE_FILTER[l] || []); });
  String(d.avoidText || '').split(/[、,，;；\s]+/).forEach(t => { if (t.trim()) keys.push(t.trim()); });
  const seen = {}, out = [];
  keys.forEach(k => { if (k && !seen[k]) { seen[k] = 1; out.push(k); } });
  return out;
}
/* 分级的排除规则：hard = 过敏与忌口（最硬），mid = 慢病饮食限制，soft = 口味偏好 */
function dietBanGroups() {
  const d = dietAll();
  const uniq = arr => { const s = {}, o = []; arr.forEach(k => { if (k && !s[k]) { s[k] = 1; o.push(k); } }); return o; };
  let hard = [], mid = [], soft = [];
  d.avoids.forEach(a => { hard = hard.concat(DIET_AVOID_RULES[a] || []); });
  String(d.avoidText || '').split(/[、,，;；\s]+/).forEach(t => { if (t.trim()) hard.push(t.trim()); });
  d.chronic.forEach(c => { mid = mid.concat(DIET_CHRONIC_RULES[c] || []); });
  d.likes.forEach(l => { soft = soft.concat(DIET_LIKE_FILTER[l] || []); });
  hard = uniq(hard); mid = uniq(mid); soft = uniq(soft);
  return { hard: hard, mid: mid, soft: soft, all: uniq(hard.concat(mid).concat(soft)) };
}
function dietHit(name, keys) {
  const s = String(name || '');
  for (let i = 0; i < keys.length; i++) if (s.indexOf(keys[i]) > -1) return true;
  return false;
}
/* 偏好加分：命中的关键词越多，排在同档候选越前 */
function dietBoostScore(name) {
  const d = dietAll();
  const s = String(name || '');
  let n = 0;
  d.likes.forEach(l => {
    (DIET_LIKE_BOOST[l] || []).forEach(k => { if (s.indexOf(k) > -1) n++; });
  });
  return n;
}

/* ---------------- 候选池 ---------------- */
function dedupeByName(arr) {
  const seen = {}, out = [];
  arr.forEach(it => {
    if (!it || !it.name || seen[it.name]) return;
    seen[it.name] = 1; out.push(it);
  });
  return out;
}
function nameIn(arr, name) {
  for (let i = 0; i < arr.length; i++) if (arr[i].name === name) return true;
  return false;
}
/* 体质专属菜 + 通用菜池（按食性筛选），用于丰富食材、品类与做法 */
function basePool(cid, slotKey) {
  const r = RECIPES[cid] || RECIPES.pinghe;
  let arrKey = slotKey;
  MENU_SLOTS.forEach(s => { if (s.key === slotKey) arrKey = s.arr; });
  const own = (r[arrKey] && r[arrKey].length) ? r[arrKey].slice() : [];
  const ok = CONST_TASTE_OK[cid] || CONST_TASTE_OK.pinghe;
  const common = (COMMON_DISHES[arrKey] || []).filter(it => !it.t || ok.indexOf(it.t) > -1);
  return dedupeByName(own.concat(common));
}
/* 当日可用候选：经期 / 忌口 / 慢病 / 偏好逐层筛选，并保证候选数不低于 MIN_POOL */
function menuArr(cid, slotKey, key) {
  let arr = basePool(cid, slotKey);
  if (!arr.length) arr = [{ name: '—', note: '暂无候选数据' }];

  /* ① 经期（仅女性）：剔除寒凉；整档偏寒凉时用温性菜兜底 */
  if (key && periodOnDay(key)) {
    let warm = arr.filter(it => !isColdFood(it.name));
    if (warm.length < MIN_POOL) warm = warm.concat((PERIOD_WARM[slotKey] || []).filter(it => !isColdFood(it.name)));
    arr = dedupeByName(warm);
    if (!arr.length) arr = (PERIOD_WARM[slotKey] || []).slice();
  }

  /* ② 忌口 / 慢病 / 偏好：命中即排除。多条规则冲突导致候选不足时逐级放宽，
     顺序为「口味偏好 → 慢病限制」，过敏与忌口始终不放宽；放宽后给出提示 */
  const g = dietBanGroups();
  if (g.all.length) {
    const levels = [
      { keys: g.all, relax: '' },
      { keys: g.hard.concat(g.mid), relax: '口味偏好' },
      { keys: g.hard, relax: '口味偏好与慢病限制' }
    ];
    let kept = [], relax = '';
    for (let i = 0; i < levels.length; i++) {
      kept = arr.filter(it => !dietHit(it.name, levels[i].keys));
      relax = levels[i].relax;
      if (kept.length >= MIN_POOL) break;
    }
    if (kept.length < MIN_POOL) {
      basePool('pinghe', slotKey).forEach(it => {
        if (kept.length >= MIN_POOL) return;
        if (dietHit(it.name, g.hard) || nameIn(kept, it.name)) return;
        kept.push(it);
      });
    }
    if (kept.length) {
      arr = dedupeByName(kept);
      if (relax) arr = arr.map(it => Object.assign({}, it, {
        caution: (it.caution ? it.caution + '；' : '') + '当前忌口下可选项不足，已放宽' + relax + '，请重点核对其中不适食材'
      }));
    } else {
      arr = arr.map(it => Object.assign({}, it, {
        caution: (it.caution ? it.caution + '；' : '') + '当前忌口与慢病限制下没有完全避开的可选项，已保留最接近的一项，请自行替换其中不适食材'
      }));
    }
  }
  if (!arr.length) arr = [{ name: '—', note: '当前限制条件下暂无可推荐项，可减少忌口或慢病限制后再试' }];
  return arr;
}

/* ---------------- 同日食材去重 + 周内餐食去重 ---------------- */
/* 该项与当日已用食材冲突时，按营养/功能相近的食材替换；无法替换返回 null */
function substituteItem(it, used, noCold, ban) {
  let name = String(it.name || '');
  const notes = [];
  let guard = 0;
  while (guard++ < 12) {
    const hits = ingHits(name);
    const bad = hits.filter(h => used[h.n]);
    if (!bad.length) break;
    let moved = false;
    for (let i = 0; i < bad.length && !moved; i++) {
      const h = bad[i];
      const subs = SUBSTITUTES[h.n] || [];
      for (let j = 0; j < subs.length; j++) {
        const s = subs[j];
        if (used[s.n]) continue;
        /* 经期不引入寒凉食材；忌口与慢病限制同样适用于替换进来的食材 */
        if (noCold && isColdFood(s.n)) continue;
        if (ban && ban.length && dietHit(s.w || s.n, ban)) continue;
        const w = s.w || s.n;
        const fm = formOf(h.k);
        const rep = (fm && w.indexOf(fm) < 0) ? (w + fm) : w;
        const trial = name.split(h.k).join(rep);
        const after = ingsOf(trial);
        let dup = false; const self = {};
        for (let k = 0; k < after.length; k++) {
          if (used[after[k]] || self[after[k]]) { dup = true; break; }
          self[after[k]] = 1;
        }
        if (dup) continue;
        notes.push('当日已安排' + h.n + '，改用营养相近的' + s.n + '替换');
        name = trial;
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  if (!notes.length) return null;
  const out = Object.assign({}, it);
  out.name = name;
  out.note = (it.note ? it.note + '　' : '') + '（' + notes.join('；') + '）';
  out.sub = true;
  return out;
}
/* 不冲突直接返回；冲突则尝试替换，替换不了返回 null */
function resolveItem(it, used, noCold, ban) {
  const bad = ingHits(it.name).filter(h => used[h.n]);
  if (!bad.length) return { it: it, swapped: false };
  const sub = substituteItem(it, used, noCold, ban);
  return sub ? { it: sub, swapped: true } : null;
}
/* 起始序号：用户「换一换」优先，否则由日期确定性推导（同一天稳定、次日自动轮换） */
function menuPickStart(cid, key, slotKey) {
  const st = (state.menuPicks || {})[key];
  if (st && typeof st[slotKey] === 'number') return st[slotKey];
  const base = dayOfYear(parseKey(key)) + (state.recipeSeed || 0) + (ui.menuOffset || 0);
  let salt = 0;
  MENU_SLOTS.forEach((s, i) => { if (s.key === slotKey) salt = i * 2 + 1; });
  return base + salt;
}
/* 生成一天的五项推荐：
 * ① 同一食材当天只用一次，冲突时按营养相近替换
 * ② 同一道餐食一周内不超过 2 次
 * ③ 同一天尽量错开烹饪方式、优先命中口味偏好
 * ④ 所有规则冲突导致无解时，保留最接近的一项并给出说明，绝不返回空
 */
function dayPlan(cid, key, dishCount) {
  const out = {}, used = {}, methods = {};
  const noCold = !!periodOnDay(key);
  const ban = dietBanGroups().all;
  MENU_SLOTS.forEach(s => {
    const arr = menuArr(cid, s.key, key);
    const n = arr.length;
    const start = menuPickStart(cid, key, s.key);
    const hasPick = !!((state.menuPicks || {})[key] && typeof ((state.menuPicks || {})[key][s.key]) === 'number');
    const list = [];
    for (let i = 0; i < n; i++) {
      const idx = (((start + i) % n) + n) % n;
      const nm = arr[idx].name;
      const m = methodOf(nm);
      list.push({
        it: arr[idx], idx: idx, dist: i,
        cnt: dishCount[nm] || 0,
        mUsed: (m && methods[m]) ? 1 : 0,
        boost: dietBoostScore(nm),
        pick: (hasPick && i === 0) ? 0 : 1
      });
    }
    list.sort((a, b) => (a.pick - b.pick) || (a.cnt - b.cnt) || (b.boost - a.boost) || (a.mUsed - b.mUsed) || (a.dist - b.dist));

    let chosen = null, forced = null, methodClash = null;
    /* 第一轮优先「当日还没用过的烹饪方式」，第二轮放宽，保证做法不单一又不至于选不出菜 */
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.cnt >= MAX_DISH_PER_WEEK) { if (!forced) forced = { c: c, why: 'week' }; continue; }
      const rs = resolveItem(c.it, used, noCold, ban);
      if (!rs) { if (!forced) forced = { c: c, why: 'ing' }; continue; }
      if (!c.mUsed) { chosen = { it: rs.it, idx: c.idx, swapped: rs.swapped }; break; }
      if (!methodClash) methodClash = { it: rs.it, idx: rs.idx, swapped: rs.swapped };
    }
    if (!chosen && methodClash) chosen = methodClash;
    if (!chosen) {
      const fb = forced || { c: list[0], why: 'ing' };
      const sub = substituteItem(fb.c.it, used, noCold, ban);
      const note = fb.why === 'week'
        ? '（本周该餐次的可选菜品都已排满两次，为保证每餐都有安排保留了这一项，建议点「换一换」或适当放宽忌口）'
        : '（当日候选均含已安排的食材且无可替换项，已保留最接近的一项，请按实际情况调整）';
      chosen = {
        it: sub || Object.assign({}, fb.c.it, {
          note: (fb.c.it.note ? fb.c.it.note + '　' : '') + note, forced: true
        }),
        idx: fb.c.idx, swapped: !!sub, forced: true
      };
    }
    out[s.key] = chosen;
    ingsOf(chosen.it.name).forEach(x => { used[x] = 1; });
    const m = methodOf(chosen.it.name);
    if (m) methods[m] = 1;
    dishCount[chosen.it.name] = (dishCount[chosen.it.name] || 0) + 1;
  });
  return out;
}
/* 七日计划缓存：同一窗口内只算一次，保证「周内 ≤2 次」在全周口径上成立 */
let WP = { cid: '', start: '', sig: '', days: {} };
/* 影响配餐的上下文指纹：饮食画像、经期记录、登录性别、身体管理方案、逐项选择任一变化都要重算 */
function wpSig() {
  const d = dietAll();
  const p = state.period || {};
  return JSON.stringify([
    d.likes, d.avoids, d.chronic, d.avoidText, genderKey(),
    Object.keys(p.logs || {}).length, Object.keys(periodDayMap()).length, p.cycle || 0,
    (state.weight && state.weight.plan && state.weight.plan.v === 1) ? 1 : 0,
    state.menuPicks || {}, state.recipeSeed || 0, ui.menuOffset || 0
  ]);
}
function weekPlanFor(cid, startKey) {
  const sig = wpSig();
  if (WP.cid === cid && WP.start === startKey && WP.sig === sig && WP.days) return WP.days;
  const days = {}, cnt = {};
  for (let i = 0; i < 7; i++) {
    const k = shiftDay(startKey, i);
    days[k] = dayPlan(cid, k, cnt);
  }
  WP = { cid: cid, start: startKey, sig: sig, days: days };
  return WP.days;
}
/* 单日计划：必须走 weekPlanFor，否则会命中「指纹已变但未重算」的旧缓存（经期 / 忌口改了今日菜单却不变） */
function dayPlanFor(cid, key) {
  const start = shiftDay(todayKey(), ui.menuOffset || 0);
  const days = weekPlanFor(cid, start);
  if (days && days[key]) return days[key];
  return dayPlan(cid, key, {});
}
function menuFor(cid, key, off) {
  const start = shiftDay(todayKey(), (off !== undefined ? off : (ui.menuOffset || 0)));
  const days = weekPlanFor(cid, start);
  const plan = days[key] || dayPlan(cid, key, {});
  const out = {};
  MENU_SLOTS.forEach(s => { out[s.key] = plan[s.key].it; });
  return out;
}
/* 换一换：只推进这一位的序号，其余位由去重引擎重新决定 */
function menuSwap(cid, key, slotKey) {
  const arr = menuArr(cid, slotKey, key);
  const n = arr.length;
  if (n <= 1) return false;
  let cur = 0;
  if (WP.cid === cid && WP.days && WP.days[key] && WP.days[key][slotKey]) cur = WP.days[key][slotKey].idx || 0;
  else cur = (((menuPickStart(cid, key, slotKey) % n) + n) % n);
  state.menuPicks = state.menuPicks || {};
  state.menuPicks[key] = state.menuPicks[key] || {};
  state.menuPicks[key][slotKey] = ((cur + 1) % n + n) % n;
  WP = { cid: '', start: '', sig: '', days: {} };
  save();
  return true;
}

/* ---------------- 图表 ---------------- */
function barsSvg(scores, highlight) {
  const rowH = 30, w = 600, labelW = 76, barW = 380;
  const h = CONSTITUTION_ORDER.length * rowH + 30;
  let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" aria-label="九种体质转化分条形图">';
  s += '<line x1="' + (labelW + barW + 8) + '" y1="8" x2="' + (labelW + barW + 8) + '" y2="' + (h - 22) + '" stroke="#C9C2B4" stroke-width="0.5" stroke-dasharray="3 3"/>';
  s += '<line x1="' + (labelW + barW * 0.3 + 8) + '" y1="8" x2="' + (labelW + barW * 0.3 + 8) + '" y2="' + (h - 22) + '" stroke="#DDD6C6" stroke-width="0.5" stroke-dasharray="3 3"/>';
  CONSTITUTION_ORDER.forEach((id, i) => {
    const c = CONSTITUTIONS[id];
    const v = scores[id] ? scores[id].conv : 0;
    const y = 14 + i * rowH;
    const bw = Math.max(2, (v / 100) * barW);
    const on = id === highlight;
    s += '<text x="0" y="' + (y + 12) + '" font-size="12" fill="' + (on ? c.color : '#6B6357') + '" font-weight="' + (on ? 600 : 400) + '">' + c.name + '</text>';
    s += '<rect x="' + labelW + '" y="' + y + '" width="' + barW + '" height="14" rx="7" fill="#EFEAE0"/>';
    s += '<rect x="' + labelW + '" y="' + y + '" width="' + bw + '" height="14" rx="7" fill="' + c.color + '" opacity="' + (on ? 1 : 0.55) + '"/>';
    s += '<text x="' + (labelW + barW + 14) + '" y="' + (y + 12) + '" font-size="12" fill="' + (on ? c.color : '#8A8172') + '">' + v.toFixed(1) + '</text>';
  });
  s += '<text x="' + (labelW + barW * 0.3 + 8) + '" y="' + (h - 8) + '" font-size="11" fill="#A39A88" text-anchor="middle">30</text>';
  s += '<text x="' + (labelW + barW + 8) + '" y="' + (h - 8) + '" font-size="11" fill="#A39A88" text-anchor="middle">100</text>';
  s += '</svg>';
  return s;
}

function lineSvg(records, metric) {
  const keys = Object.keys(records).sort().slice(-14);
  const pts = keys.map(k => ({ k, v: +records[k][metric] })).filter(p => p.v > 0);
  const w = 600, h = 220, padL = 40, padB = 28, padT = 16;
  let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" aria-label="健康指标趋势折线图">';
  if (pts.length < 2) {
    s += '<text x="' + (w / 2) + '" y="' + (h / 2) + '" font-size="13" fill="#A39A88" text-anchor="middle">至少记录两天数据才会生成趋势</text></svg>';
    return s;
  }
  const vals = pts.map(p => p.v);
  let min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
  if (max - min < 1) { max += 1; min -= 1; }
  const innerW = w - padL - 20, innerH = h - padT - padB;
  const X = i => padL + (pts.length === 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
  const Y = v => padT + innerH - ((v - min) / (max - min)) * innerH;
  for (let g = 0; g <= 3; g++) {
    const y = padT + (g / 3) * innerH;
    s += '<line x1="' + padL + '" y1="' + y + '" x2="' + (w - 20) + '" y2="' + y + '" stroke="#EDE6D8" stroke-width="0.5"/>';
    s += '<text x="' + (padL - 6) + '" y="' + (y + 4) + '" font-size="10" fill="#A39A88" text-anchor="end">' + (max - (g / 3) * (max - min)).toFixed(1) + '</text>';
  }
  let d = '';
  pts.forEach((p, i) => { d += (i ? ' L ' : 'M ') + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1); });
  s += '<path d="' + d + '" fill="none" stroke="#A6432E" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>';
  pts.forEach((p, i) => {
    s += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="3" fill="#FFF" stroke="#A6432E" stroke-width="1.5"/>';
  });
  pts.forEach((p, i) => {
    if (i % Math.ceil(pts.length / 6) === 0 || i === pts.length - 1) {
      s += '<text x="' + X(i).toFixed(1) + '" y="' + (h - 10) + '" font-size="10" fill="#A39A88" text-anchor="middle">' + p.k.slice(5) + '</text>';
    }
  });
  s += '</svg>';
  return s;
}

/* 打卡热力图：支持 30 / 60 / 90 天三档，列数随天数自适应 */
function heatRange() { return HEAT_RANGES.indexOf(+ui.heatRange) > -1 ? +ui.heatRange : 30; }
function heatSvg(days) {
  const n = heatRange();
  const cell = 22, gap = 5;
  const cols = n <= 30 ? 10 : 15;
  const rows = Math.ceil(n / cols);
  const w = cols * (cell + gap), h = rows * (cell + gap) + 18;
  let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" aria-label="近 ' + n + ' 天打卡热力图">';
  const end = todayKey();
  const start = shiftDay(end, -(n - 1));
  for (let i = 0; i < n; i++) {
    const k = shiftDay(start, i);
    const r = doneRate(k);
    const col = i % cols, row = Math.floor(i / cols);
    const x = col * (cell + gap), y = row * (cell + gap);
    const alpha = r === 0 ? 0 : 0.25 + r * 0.75;
    s += '<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" rx="4" fill="' + (r ? '#7C9A6B' : '#E6E0D2') + '" fill-opacity="' + alpha.toFixed(2) + '" stroke="#D8D0BE" stroke-width="0.5"><title>' + k + ' 完成 ' + Math.round(r * 100) + '%</title></rect>';
  }
  s += '<text x="0" y="' + (h - 2) + '" font-size="10" fill="#A39A88">' + start.slice(5) + '</text>';
  s += '<text x="' + w + '" y="' + (h - 2) + '" font-size="10" fill="#A39A88" text-anchor="end">' + end.slice(5) + '</text>';
  s += '</svg>';
  return s;
}
/* 时间范围切换：标题随选项变化，一眼看出看的是哪一段 */
/* 把原热力图的完成度明暗映射为与页面一致的棕咖色系。 */
const heatSvgBase = heatSvg;
heatSvg = function (days) {
  const palette = ['#F3ECE3', '#E2CEBB', '#C9A27F', '#A87350', '#7C4932'];
  return heatSvgBase(days).replace(/(<rect\b[^>]*\bfill=")#([0-9a-f]{6})("[^>]*>)/gi, function (_, a, hex, b) {
    const n = parseInt(hex, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, bl = n & 255;
    const light = (r * 299 + g * 587 + bl * 114) / 255000;
    const idx = light > 0.93 ? 0 : (light > 0.82 ? 1 : (light > 0.68 ? 2 : (light > 0.52 ? 3 : 4)));
    return a + palette[idx] + b;
  });
};

function heatRangeHtml() {
  const n = heatRange();
  return '<div class="heat-top"><div class="chips pick">' + HEAT_RANGES.map(d =>
    '<button class="chip pickable' + (n === d ? ' on' : '') + '" data-action="heat-range" data-v="' + d + '">近 ' + d + ' 天</button>').join('') +
    '</div><span class="muted small">共 ' + n + ' 天，每天一格</span></div>';
}

function ringSvg(done, total) {
  const pct = total ? done / total : 0;
  const r = 44, c = 2 * Math.PI * r;
  const s = '<svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="今日打卡完成度 ' + Math.round(pct * 100) + '%">' +
    '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="#E6E0D2" stroke-width="10"/>' +
    '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="#A6432E" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + (c * pct).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 60 60)"/>' +
    '<text x="60" y="56" font-size="26" font-weight="500" fill="#2B2622" text-anchor="middle">' + Math.round(pct * 100) + '%</text>' +
    '<text x="60" y="76" font-size="11" fill="#8A8172" text-anchor="middle">' + done + ' / ' + total + ' 项</text>' +
    '</svg>';
  return s;
}

/* ============ 滚动位置管理（集中式，全站唯一入口） ============
 * 规则
 *   1. 页内操作（提交 / 筛选 / 排序 / 分页 / 展开收起 / 打卡 / 换一换 / 删除 …）→ 停在原处；
 *   2. 刷新、前进后退 → 恢复刷新前的页面与位置；
 *   3. 切换导航页（go）与首次打开 → 回到顶部；
 *   4. 横竖屏切换、窗口尺寸变化 → 按已记录位置校正（超出新视口上限则截断到底部）。
 * 实现要点
 *   - 取位置 / 恢复位置全部收在 render() 一处，页面视图函数无需关心；
 *   - 滚动监听用 rAF 节流写 SP.pos（按页面分键），不做逐帧计算；
 *   - 恢复 = 同步滚动一次 + 双 rAF 校正一次，覆盖异步渲染与延迟布局（图片 / 字体）；
 *   - 恢复期间置 restoring 标记，滚动监听不写入，避免自触发抖动；
 *   - 异步任务（如体重方案生成）用 spLock() 锁定点击瞬间的位置，任务完成重绘后按锁定值恢复。
 */
const SP_KEY = 'tcm_scroll_v1';
const SP_PAGES = ['home', 'assess', 'plan', 'habits', 'recipes', 'archive', 'mine', 'about'];
const SP = { pos: {}, cur: 0, page: 'home', lock: null, restoring: false, raf: 0, storeTimer: 0, lastUser: 0 };

function spRaf(fn) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
  if (typeof setTimeout === 'function') return setTimeout(fn, 16);
  return 0;
}
function spCancel(id) {
  if (!id) return;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else if (typeof clearTimeout === 'function') clearTimeout(id);
}
function spMax() {
  try {
    const de = document.documentElement || {};
    const h = Math.max(de.scrollHeight || 0, (document.body && document.body.scrollHeight) || 0);
    return Math.max(0, h - (window.innerHeight || de.clientHeight || 0));
  } catch (e) { return 0; }
}
/* 布局尚未完成时上限为 0，此时不截断，交给随后的 rAF 校正 */
function spClamp(y) {
  const n = Math.round(+y || 0);
  if (n < 0) return 0;
  const m = spMax();
  return m > 0 ? Math.min(n, m) : n;
}
function spLive() {
  try {
    const y = window.scrollY;
    if (typeof y === 'number') return Math.max(0, y);
    const de = document.documentElement || {};
    return Math.max(0, window.pageYOffset || de.scrollTop || 0);
  } catch (e) { return 0; }
}
/* 恢复用的位置：显式指定 > 异步锁定值 > 当前实时位置 */
function spPick(arg) {
  if (typeof arg === 'number') return arg;
  if (typeof SP.lock === 'number') return SP.lock;
  return spLive();
}
function spGo(y) {
  const t = spClamp(y);
  try { window.scrollTo(0, t); } catch (e) { /* 忽略 */ }
  return t;
}
/* 恢复：瞬时定位（behavior 为默认 auto，不做平滑动画，避免抖动）+ 双 rAF 校正 */
function spApply(y) {
  const want = spClamp(spPick(y));
  SP.restoring = true;
  SP.cur = want; SP.pos[SP.page] = want;
  spGo(want);
  spCancel(SP.raf);
  SP.raf = spRaf(() => {
    SP.raf = spRaf(() => {
      SP.raf = 0;
      const t = spClamp(want);
      if (Math.abs(spLive() - t) > 1) spGo(t);
      SP.cur = t; SP.pos[SP.page] = t;
      SP.restoring = false;
    });
  });
}
/* 异步任务：点击瞬间锁定，任务完成重绘后按锁定值恢复，避免期间位置丢失 */
function spLock() { SP.lock = spLive(); return SP.lock; }
function spUnlock() { SP.lock = null; }

function spStore() {
  try {
    if (typeof sessionStorage === 'undefined' || !sessionStorage) return;
    sessionStorage.setItem(SP_KEY, JSON.stringify({ p: SP.page, y: spClamp(SP.pos[SP.page] || 0) }));
  } catch (e) { /* 无痕模式 / 配额不足：静默降级 */ }
}
function spStoreSoon() {
  if (SP.storeTimer) return;
  SP.storeTimer = setTimeout(() => { SP.storeTimer = 0; spStore(); }, 250);
}
function spRead() {
  try {
    if (typeof sessionStorage === 'undefined' || !sessionStorage) return null;
    const raw = sessionStorage.getItem(SP_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o.y !== 'number' || SP_PAGES.indexOf(o.p) < 0) return null;
    return { p: o.p, y: o.y };
  } catch (e) { return null; }
}
function spClear() {
  try { if (typeof sessionStorage !== 'undefined' && sessionStorage) sessionStorage.removeItem(SP_KEY); } catch (e) { /* 忽略 */ }
}

/* 启动：区分「首次打开」与「刷新 / 前进后退」，返回首屏应恢复的位置 */
function spBoot() {
  /* 关掉浏览器自带的滚动恢复，避免与页面内恢复互相打架 */
  try {
    if (typeof history !== 'undefined' && history && 'scrollRestoration' in history) history.scrollRestoration = 'manual';
  } catch (e) { /* 忽略 */ }
  let type = '';
  try {
    if (typeof performance !== 'undefined' && performance && performance.getEntriesByType) {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav && nav.type) type = nav.type;
    }
    if (!type && typeof performance !== 'undefined' && performance && performance.navigation) {
      type = ['navigate', 'reload', 'back_forward', 'reserved'][performance.navigation.type] || 'navigate';
    }
  } catch (e) { type = ''; }
  const saved = spRead();
  const isReturn = !!saved && (type === 'reload' || type === 'back_forward');
  if (!isReturn) { spClear(); return 0; }
  /* 刷新后回到原页面，位置恢复才有意义（同一标签页内有效，新开标签仍从顶部开始） */
  ui.page = saved.p;
  SP.page = saved.p;
  SP.pos[saved.p] = saved.y;
  SP.cur = saved.y;
  return saved.y;
}

/* 一次性注册：滚动记录 / 尺寸变化校正 / 卸载前落盘 */
function spInit() {
  let raf = 0;
  window.addEventListener('scroll', () => {
    if (SP.restoring || raf) return;
    raf = spRaf(() => {
      raf = 0;
      if (SP.restoring) return;
      const y = spLive();
      SP.cur = y; SP.pos[SP.page] = y;
      SP.lastUser = Date.now();
      spStoreSoon();
    });
  }, { passive: true });

  let rt = 0;
  const onResize = () => {
    if (rt) clearTimeout(rt);
    rt = setTimeout(() => {
      rt = 0;
      /* 用户此刻正在滚动就不打断，避免把人拽回旧位置 */
      if (SP.lastUser && Date.now() - SP.lastUser < 150) { SP.pos[SP.page] = spLive(); return; }
      const want = spClamp(spPick());
      if (Math.abs(spLive() - want) <= 1) { SP.pos[SP.page] = want; return; }
      spApply(want);
      spStore();
    }, 160);
  };
  window.addEventListener('resize', onResize);
  /* 横竖屏切换：等视口稳定后再校正，避免期间多次跳动 */
  window.addEventListener('orientationchange', () => {
    if (rt) clearTimeout(rt);
    rt = setTimeout(onResize, 260);
  });

  const persistCloudOnHide = () => { spStore(); if (CLOUD_SYNC.dirty) saveCloudNow(); };
  window.addEventListener('pagehide', persistCloudOnHide);
  window.addEventListener('beforeunload', persistCloudOnHide);
  if (document.addEventListener) {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistCloudOnHide(); });
  }
}

/* ---------------- 页面渲染 ---------------- */
/* opts: { top: true } 回到顶部（切换页面）；{ scroll: y } 指定恢复到某位置（异步任务） */
/* 未登录时仅开放这两个页面：其余页面一律回首页，保证个性化内容不出现在登录前 */
const GUEST_PAGES = ['home', 'about'];
function render(opts) {
  opts = opts || {};
  const app = $('#app');
  if (!isLogin() && GUEST_PAGES.indexOf(ui.page) < 0) ui.page = 'home';
  /* 重绘前先取位置：DOM 替换后位置会失效 */
  const y = opts.top ? 0 : spPick(opts.scroll);
  ensureHabits();
  app.innerHTML = ({
    home: viewHome, assess: viewAssess, plan: viewPlan,
    habits: viewHabits, recipes: viewRecipes, archive: viewArchive,
    mine: viewMine, about: viewAbout
  })[ui.page]();
  /* 体质测评 / 调理方案 不作为独立导航项，归属「首页」高亮；个人中心不占导航项，不高亮 */
  const navKey = (ui.page === 'assess' || ui.page === 'plan') ? 'home' : ui.page;
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.page === navKey));
  /* 未登录时置灰需要登录后才能使用的导航项 */
  const guest = !isLogin();
  $$('#nav a').forEach(a => {
    const locked = guest && GUEST_PAGES.indexOf(a.dataset.page) < 0;
    a.classList.toggle('dim', locked);
    if (locked) a.setAttribute('title', '登录后可用'); else a.removeAttribute('title');
  });
  SP.page = ui.page;
  bind();
  if (ui.focusNo) {
    /* 锚点定位优先（跳到未作答 / 出错的题目），定位后同步记录新位置 */
    const target = $('.qitem[data-qno="' + ui.focusNo + '"]', app);
    ui.focusNo = 0;
    if (target && target.scrollIntoView) {
      target.scrollIntoView({ block: 'center' });
      SP.cur = spLive(); SP.pos[SP.page] = SP.cur;
    } else {
      spApply(y);
    }
  } else {
    spApply(y);
  }
}

function go(page) {
  if (page === 'archive' && ui.page !== 'archive') {
    ui.archiveOpen = { record: true, trend: true, shape: false, weight: false, periodRecord: false, periodCalendar: false, tcm: false, wm: false };
    ui.archiveHistoryOpen = false;
  }
  ui.page = page;
  render({ top: true });
}

/* 首页：五大区块（体质测评 / 调理方案 / 习惯打卡 / 每日食谱 / 时令提示）
   体质测评与调理方案仅在此处入口，导航中不再单列 */
const HOME_DIMS = [['routine', '作息'], ['diet', '饮食'], ['exercise', '运动'], ['emotion', '情志']];

function viewHome() {
  /* 未登录：只展示默认占位内容，不读取任何个性化数据 */
  const guest = !isLogin();
  const a = guest ? null : state.assessment;
  const cid = a ? a.primary : null;
  const c = cid ? CONSTITUTIONS[cid] : null;

  if (guest) {
    return '<section class="hero">' +
      '<div class="hero-mark">養</div>' +
      '<div class="hero-text">' +
      '<h1>易安堂 · 中医体质辨识与健康管理</h1>' +
      '<p>依据国家标准 GB/T 46939—2025《中医体质分类与判定》，' + questions().length + ' 题融合问卷辨识九种体质，生成个性化调理、打卡与食谱方案</p>' +
      '<p class="hero-meta">' + questions().length + ' 题 · 约 ' + estMinutes() + ' 分钟 · 登录后云端长期保存</p>' +
      '</div></section>' +
      '<section class="panel"><h2>登录后开始</h2>' +
      '<p class="muted">首次使用填写昵称、性别和年龄即可注册。测评、方案、记录和食谱会与账号绑定；更换设备时可使用昵称和恢复码取回。</p>' +
      (state.guestSkip ? '<p class="muted small">你已选择跳过登录，当前只能浏览首页与「关于」：体质测评、调理方案、每日食谱、习惯打卡与身体档案需要登录后才能使用。随时可点右上角「登录」补上。</p>' : '') +
      '<div class="hc-actions"><button class="btn" data-action="login-open">登录 / 开始使用</button>' +
      '<button class="btn small ghost" data-action="go" data-page="about">关于本站</button></div></section>';
  }

  let h = '<section class="hero">' +
    '<div class="hero-mark">' + (c ? c.seal : '養') + '</div>' +
    '<div class="hero-text">' +
    '<h1>' + (c ? '您好，' + esc(state.profile.name || '') + '　您的体质是「<span class="hero-constitution">' + esc(c.name) + '</span>」' : '易安堂 · 中医体质辨识与健康管理') + '</h1>' +
    '<p>' + (c ? esc(c.tagline) : '依据国家标准 GB/T 46939—2025《中医体质分类与判定》，' + questions().length + ' 题融合问卷辨识九种体质，生成个性化调理、打卡与食谱方案') + '</p>' +
    (a ? '<p class="hero-meta">最近测评 ' + a.date + '　·　' + esc(a.verdictText) + '</p>' : '<p class="hero-meta">' + questions().length + ' 题 · 约 ' + estMinutes() + ' 分钟 · ' + (cloudOn() ? '账号数据云端同步' : '数据仅存本机') + '</p>') +
    '</div></section>';

  h += '<section class="grid-2">' + assessCardHtml(a, c) + planCardHtml(a) + '</section>';
  h += '<section class="grid-2">' + habitsCardHtml() + recipeCardHtml(cid) + '</section>';
  h += seasonCardHtml();
  return h;
}

/* —— 区块一：体质测评（未测 → 开始测评；已测 → 体质报告 + 再测一次） —— */
function assessCardHtml(a, c) {
  let h = '<div class="panel hcard"><h2>体质测评</h2>';
  if (!a) {
    h += '<div class="hc-empty">' +
      '<div class="hc-mark ghost">養</div>' +
      '<p class="muted">尚未进行体质测评。' + questions().length + ' 题融合问卷（33 题体质判定核心 + 12 题生活与需求补充' + (isLogin() ? ' + ' + specialCount() + ' 题性别年龄专项' : '') + '），约 <span class="assessment-emphasis">' + estMinutes() + ' 分钟</span>，测评时会用到<span class="assessment-emphasis">镜子</span>，自动计算转化分并判定九种体质。</p>' +
      '</div>' +
      '<div class="hc-actions"><button class="btn" data-action="go" data-page="assess">开始体质测评</button></div>';
  } else {
    h += '<div class="hc-top">' +
      '<div class="hc-seal" style="--c:' + c.color + '">' + c.seal + '</div>' +
      '<div class="hc-info"><b>' + esc(a.verdictText) + '</b>' +
      '<span class="muted small">' + esc(c.tagline) + '</span>' +
      '<em class="muted small">最近测评 ' + a.date + '</em></div></div>';
    h += '<div class="chips">';
    (a.secondary || []).forEach(k => { h += '<span class="chip solid">兼夹 · ' + CONSTITUTIONS[k].name + '</span>'; });
    (a.tendencies || []).forEach(k => { h += '<span class="chip">倾向 · ' + CONSTITUTIONS[k].name + '</span>'; });
    h += '</div>';
    h += '<div class="hc-actions">' +
      '<button class="btn" data-action="report">体质报告</button>' +
      '<button class="btn ghost" data-action="retake">再测一次</button></div>';
  }
  return h + '</div>';
}

/* —— 区块二：调理方案（未测评 → 提示；已测评未生成 → 定制方案；已生成 → 我的方案） —— */
function planCardHtml(a) {
  let h = '<div class="panel hcard"><h2>调理方案</h2>';
  if (!a) {
    h += '<div class="hc-empty">' +
      '<div class="hc-mark ghost">方</div>' +
      '<p class="muted">需先完成体质测评，才能为您定制作息、饮食、运动、情志四维调理方案。</p>' +
      '</div>' +
      '<div class="hc-actions"><button class="btn" data-action="go" data-page="assess">先去测评</button></div>';
  } else if (!state.plan || !state.plan.at) {
    h += '<div class="hc-empty">' +
      '<div class="hc-mark">方</div>' +
      '<p class="muted">测评已完成（' + a.date + '），可依据「' + CONSTITUTIONS[a.primary].name + '」生成专属调理方案：四时起居、饮食宜忌、运动处方、情志调摄与药膳穴位。</p>' +
      '</div>' +
      '<div class="hc-actions"><button class="btn" data-action="plan-make">定制方案</button></div>';
  } else {
    const c = CONSTITUTIONS[a.primary];
    h += '<div class="hc-empty">' +
      '<div class="hc-seal" style="--c:' + c.color + '">' + c.seal + '</div>' +
      '<p class="muted">已生成「' + c.name + '」专属调理方案：三个体质分别说清，再合成作息、运动、习惯、饮食、情绪五维统一安排，并按三阶段循序渐进。</p>' +
      '</div>';
    h += '<ul class="hc-list">';
    HOME_DIMS.forEach(function (d) {
      h += '<li><b>' + d[1] + '</b><span>' + esc(c.plan[d[0]].summary) + '</span></li>';
    });
    h += '</ul>';
    h += '<em class="muted small">生成于 ' + esc(state.plan.at) + '</em>';
    h += '<div class="hc-actions"><button class="btn" data-action="plan-view">我的方案</button></div>';
  }
  return h + '</div>';
}

/* —— 区块三：习惯打卡（首页即可勾选） —— */
function habitsCardHtml() {
  const todayArr = todayDone();
  const total = state.habits.list.length;
  let h = '<div class="panel hcard"><h2>习惯打卡</h2>';
  if (!total) {
    h += '<div class="hc-empty"><div class="hc-mark ghost">習</div>' +
      '<p class="muted">暂无习惯清单，完成体质测评后会自动生成一套易执行的打卡项。</p></div>' +
      '<div class="hc-actions"><button class="btn ghost" data-action="go" data-page="habits">去设置习惯</button></div>';
    return h + '</div>';
  }
  h += '<div class="ring-row">' + ringSvg(todayArr.length, total) +
    '<div class="ring-side"><p class="big">' + streakDays() + ' <span>天连续达标</span></p>' +
    '<p class="muted small">坚持是最好的补药，连续记录比单日满分更重要</p></div></div>';
  h += '<ul class="quick">';
  state.habits.list.slice(0, 5).forEach(function (it) {
    const on = todayArr.indexOf(it.id) > -1;
    h += '<li class="' + (on ? 'on' : '') + '">' +
      '<button class="check" data-action="toggle" data-id="' + it.id + '" title="打卡">' + (on ? '✓' : '') + '</button>' +
      '<span class="q-text">' + esc(it.text) + '</span>' +
      habitOpsHtml(it.id) + '</li>';
  });
  h += '</ul>';
  h += '<div class="hc-actions">' +
    '<button class="btn small" data-action="habit-add">添加习惯</button>' +
    '<button class="btn small ghost" data-action="go" data-page="habits">全部习惯（' + total + ' 项）</button></div>';
  return h + '</div>';
}

/* —— 区块四：每日食谱（今日三餐） —— */
function recipeCardHtml(cid) {
  const key = todayKey();
  const use = cid || 'pinghe';
  let h = '<div class="panel hcard"><h2>每日食谱</h2>';
  h += '<p class="muted small">' + key + ' · ' +
    (cid ? '按「' + CONSTITUTIONS[cid].name + '」与时令推荐，含三餐、茶饮、水果与营养素' : '完成体质测评后将按体质定制，当前为通用平和质推荐') + '</p>';
  h += menuHtml(use, key);
  h += '<div class="hc-actions"><button class="btn small ghost" data-action="go" data-page="recipes">七日食谱与饮食宜忌</button></div>';
  return h + '</div>';
}

/* —— 区块五：时令提示（随月份自动更换） —— */
const MONTH_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const SEASON_CN = ['冬', '冬', '春', '春', '春', '夏', '夏', '夏', '秋', '秋', '秋', '冬'];
function seasonCardHtml() {
  const m = new Date().getMonth() + 1;
  return '<section class="panel"><h2>时令提示</h2>' +
    '<div class="season-row">' +
    '<div class="season-mark">' + SEASON_CN[m - 1] + '</div>' +
    '<div><p>' + (SEASON_TIPS[m] || '') + '</p>' +
    '<em class="season-tag">时令更迭 · ' + MONTH_CN[m - 1] + '月 · 提示随月份自动更换</em></div>' +
    '</div>' +
    '<div class="note">时节养生要点与您的体质方案合并执行，无需单独设置。</div></section>';
}

/* 五项推荐逐条渲染，每项带独立的「换一换」按钮；替换过的项给出原因 */
function menuHtml(cid, key) {
  const plan = dayPlanFor(cid, key);
  let h = '<ul class="menu">';
  MENU_SLOTS.forEach(function (s) {
    const p = plan[s.key] || { it: { name: '—', note: '' } };
    const it = p.it;
    const fixed = menuArr(cid, s.key, key).length <= 1;
    h += '<li class="mi">' +
      '<span class="mt' + (s.cls ? ' ' + s.cls : '') + '">' + s.mark + '</span>' +
      '<div class="mi-body"><b>' + esc(it.name) + '</b>' +
      (it.note ? '<em' + (it.sub || it.forced ? ' class="mi-sub"' : '') + '>' + esc(it.note) + '</em>' : '') +
      (it.time ? '<i class="mi-time">建议摄入：' + esc(it.time) + '</i>' : '') +
      (it.caution ? '<i class="mi-warn">' + esc(it.caution) + '</i>' : '') +
      '</div>' +
      '<button class="swap" data-action="menu-swap" data-slot="' + s.key + '" data-key="' + key + '" title="' + (fixed ? '此项为安全提示，无需更换' : '只换这一项') + '"' + (fixed ? ' disabled' : '') + '>换一换</button>' +
      '</li>';
  });
  return h + '</ul>';
}

function recordCardHtml(key, r) {
  return '<div class="rec-head"><b>' + key + '</b></div>' +
    '<div class="chips">' +
    (r.weight ? '<span class="chip">体重 ' + r.weight + ' kg</span>' : '') +
    (r.sleep ? '<span class="chip">睡眠 ' + r.sleep + ' h</span>' : '') +
    (r.energy ? '<span class="chip">精力 ' + '●'.repeat(r.energy) + '</span>' : '') +
    (r.mood ? '<span class="chip">情绪 ' + '●'.repeat(r.mood) + '</span>' : '') +
    (r.stool ? '<span class="chip">大便 ' + esc(r.stool) + '</span>' : '') +
    (r.tongue ? '<span class="chip">舌 ' + esc(r.tongue) + '</span>' : '') +
    '</div>' +
    ((r.symptoms && r.symptoms.length) ? '<div class="chips">' + r.symptoms.map(s => '<span class="chip warn">' + esc(s) + '</span>').join('') + '</div>' : '') +
    (r.note ? '<p class="muted">' + esc(r.note) + '</p>' : '');
}

/* --- 评估页（融合问卷 45 题：五级量表 / 单选 / 多选 / 排序 / 简答；其中 1 道为条件追问） --- */
const Q_PER_PAGE = 6;

function qType(q) { return q.type || 'scale'; }
function qGroup(q) { return q.g || 'CORE'; }
function qByNo(n) { const L = questions(); for (let i = 0; i < L.length; i++) if (L[i].no === +n) return L[i]; return null; }
function requiredCount() { let n = 0; questions().forEach(q => { if (!q.optional) n++; }); return n; }
function answeredCount() { let n = 0; questions().forEach(q => { if (isAnswered(q)) n++; }); return n; }

function isAnswered(q) {
  if (ui.skipped[q.no]) return true;
  const v = ui.answers[q.no];
  if (qType(q) === 'text') return typeof v === 'string' && v.trim() !== '';
  if (qType(q) === 'multi' || qType(q) === 'rank') return Array.isArray(v) && v.length > 0;
  return +v > 0;
}

function groupMeta(g) {
  if (g === 'S') {
    const k = genderKey();
    if (k && SPECIAL_GROUP_META.S[k]) return SPECIAL_GROUP_META.S[k];
    return { no: '十', title: '分性别专项', sub: '按你的性别加载' };
  }
  if (g === 'T') {
    const b = ageBandOf();
    if (b && SPECIAL_GROUP_META.T[b]) return SPECIAL_GROUP_META.T[b];
    return { no: '十一', title: '这个年纪要多留意', sub: '按你的年龄段加载' };
  }
  return GROUP_META[g] || GROUP_META.CORE;
}
function groupHeaderHtml(g) {
  const m = groupMeta(g);
  return '<li class="qgroup"><span class="qg-no">' + m.no + '</span>' +
    '<div><b>' + esc(m.title) + '</b><em>' + esc(m.sub) + '</em></div></li>';
}

function questionHtml(q, idx) {
  const v = ui.answers[q.no];
  const t = qType(q);
  let h = '<li class="qitem' + (isAnswered(q) ? ' done' : '') + ' q-' + t + '" data-qno="' + q.no + '">' +
    '<div class="qtext"><span class="qno">' + idx + '</span>' + esc(q.text) +
    (q.hint ? '<em>' + esc(q.hint) + '</em>' : '') + '</div>';

  if (t === 'scale') {
    /* 五级选项文字按题取「具象锚点」（频次型 / 程度型）；数值仍是 1–5，计分与判定完全不变 */
    const labels = (q.scale && typeof SCALE_ANCHORS !== 'undefined' && SCALE_ANCHORS[q.scale]) ? SCALE_ANCHORS[q.scale] : SCALE_LABELS;
    h += '<div class="opts">';
    labels.forEach((lb, i) => {
      const val = i + 1;
      h += '<button class="opt' + (v === val ? ' on' : '') + '" data-action="answer" data-no="' + q.no + '" data-v="' + val + '">' +
        '<b>' + val + '</b><span>' + lb + '</span></button>';
    });
    h += '</div>';
  } else if (t === 'single') {
    h += '<div class="opts pick">';
    q.options.forEach((o, i) => {
      const val = i + 1;
      h += '<button class="pick' + (v === val ? ' on' : '') + '" data-action="answer" data-no="' + q.no + '" data-v="' + val + '">' +
        '<i>' + val + '</i><span>' + esc(o) + '</span></button>';
    });
    h += '</div>';
  } else if (t === 'multi') {
    const arr = Array.isArray(v) ? v : [];
    h += '<div class="opts pick">';
    q.options.forEach((o, i) => {
      const val = i + 1;
      h += '<button class="pick' + (arr.indexOf(val) > -1 ? ' on' : '') + '" data-action="multi" data-no="' + q.no + '" data-v="' + val + '">' +
        '<i>' + val + '</i><span>' + esc(o) + '</span></button>';
    });
    h += '</div>' + multiHintHtml(q, arr);
  } else if (t === 'rank') {
    const arr = Array.isArray(v) ? v : [];
    h += '<div class="rank-box">';
    if (!arr.length) h += '<em class="muted small">还没排。点下面的选项，先点的排第一。</em>';
    arr.forEach((val, i) => {
      h += '<span class="rank-chip" data-action="unrank" data-no="' + q.no + '" data-v="' + val + '">' +
        '<b>' + (i + 1) + '</b>' + esc(q.options[val - 1]) + '<i>×</i></span>';
    });
    h += '</div><div class="opts pick">';
    q.options.forEach((o, i) => {
      const val = i + 1;
      h += '<button class="pick' + (arr.indexOf(val) > -1 ? ' on' : '') + '" data-action="rank" data-no="' + q.no + '" data-v="' + val + '">' +
        '<i>' + val + '</i><span>' + esc(o) + '</span></button>';
    });
    h += '</div><div class="qside"><button class="btn tiny ghost" data-action="skipq" data-no="' + q.no + '">我不想排顺序</button></div>';
  } else if (t === 'text') {
    h += '<textarea class="qinput" data-no="' + q.no + '" rows="2" maxlength="200" placeholder="' + esc(q.placeholder || '') + '">' +
      esc(typeof v === 'string' ? v : '') + '</textarea>';
    h += '<div class="qside"><button class="btn tiny ghost" data-action="skipq" data-no="' + q.no + '">跳过这题</button>' +
      '<span class="muted small">这道题可跳过，不影响判定</span></div>';
  }
  return h + '</li>';
}

function multiHintHtml(q, arr) {
  if (!q.max) return '<div class="qside pick-hint" data-hint="' + q.no + '"><span class="muted small">可多选</span></div>';
  const left = q.max - arr.length;
  const txt = arr.length >= q.max ? '已选满 ' + q.max + ' 项，想换就先点掉一个' : '还可选择 ' + left + ' 项';
  return '<div class="qside pick-hint" data-hint="' + q.no + '"><span class="muted small">' + txt + '</span></div>';
}

function viewAssess() {
  if (state.assessment && !ui.retake) return viewResult();
  const per = Q_PER_PAGE;
  const list = questions();
  const total = list.length;
  const pages = Math.ceil(total / per);
  const step = Math.min(Math.max(ui.assessStep, 0), pages - 1);
  const start = step * per;
  const need = requiredCount();
  const done = answeredCount();

  let h = '<section class="panel"><div class="q-head">' +
    '<a class="crumb" href="#" data-action="go" data-page="home">返回首页</a>' +
    '<h2>聊一聊，把体质和习惯一起问清楚</h2>' +
    '<p class="muted">共 ' + total + ' 题：' + need + ' 题必答（含 33 题体质判定核心），最后一题可跳过。凭第一反应作答，约 ' + estMinutes(total) + ' 分钟。</p>' +
    (isLogin()
      ? '<p class="muted small">已按你的性别与年龄补入 ' + specialCount() + ' 道专项题（标在「十 / 十一」两组里）。</p>'
      : '<p class="muted small"><a class="link" href="#" data-action="login-open">登录后</a>会再补 ' + '入若干道按性别、年龄区分的专项题。</p>') +
    '<div class="progress"><i style="width:' + Math.round((done / need) * 100) + '%"></i></div>' +
    '<p class="muted small q-count">第 ' + (step + 1) + ' / ' + pages + ' 组　已答 ' + done + ' / ' + need + ' 题</p>' +
    '</div>';
  h += '<ul class="qlist">';
  for (let i = start; i < Math.min(start + per, total); i++) {
    const q = list[i];
    if (i === start || qGroup(list[i - 1]) !== qGroup(q)) h += groupHeaderHtml(qGroup(q));
    h += questionHtml(q, i + 1);
  }
  h += '</ul>';
  h += '<div class="qfoot">' +
    (step > 0 ? '<button class="btn ghost" data-action="step" data-d="-1">上一组</button>' : '<span></span>') +
    (step < pages - 1 ? '<button class="btn" data-action="step" data-d="1">下一组</button>'
      : '<button class="btn" data-action="submit" aria-disabled="' + String(done < need) + '">提交并判定</button>') +
    '</div>';
  h += '</section>';
  return h;
}

/* 作答后刷新进度条、计数与提交按钮（不整页重绘，避免滚动跳位） */
function updateProgress() {
  const app = $('#app');
  const need = requiredCount(), done = answeredCount();
  const p = $('.progress i', app);
  if (p) p.style.width = Math.round((done / need) * 100) + '%';
  const counter = $('.q-count', app);
  if (counter) counter.textContent = counter.textContent.replace(/已答 \d+ \/ \d+ 题/, '已答 ' + done + ' / ' + need + ' 题');
  const btn = $('[data-action="submit"]', app);
  /* 提交按钮始终可点击：漏答时由提交逻辑定位到第一道未答题。 */
  if (btn) {
    btn.disabled = false;
    btn.setAttribute('aria-disabled', String(done < need));
  }
}

/* 补充题作答结果（no 34–45），不计入体质分值，用于后续方案个性化 */
function collectExtra() {
  const o = {};
  questions().forEach(q => {
    if (q.no <= 33) return;
    const v = ui.answers[q.no];
    if (v === undefined || v === null) return;
    if (typeof v === 'string' && v.trim() === '') return;
    if (Array.isArray(v) && !v.length) return;
    o[q.no] = v;
  });
  return o;
}

function viewResult() {
  const a = state.assessment;
  const c = CONSTITUTIONS[a.primary];
  let h = '<section class="panel result">' +
    '<a class="crumb" href="#" data-action="go" data-page="home">返回首页</a>' +
    '<div class="result-head" style="--c:' + c.color + '">' +
    '<div class="seal">' + c.seal + '</div>' +
    '<div><h2>判定结果：' + esc(a.verdictText) + '</h2>' +
    '<p class="muted">' + c.tagline + '</p>' +
    '<div class="chips">' +
    (a.secondary.length ? a.secondary.map(id => '<span class="chip solid">兼夹 · ' + CONSTITUTIONS[id].name + '</span>').join('') : '') +
    (a.tendencies.length ? a.tendencies.map(id => '<span class="chip">倾向 · ' + CONSTITUTIONS[id].name + '</span>').join('') : '') +
    '</div></div></div>';

  h += '<div class="chart-wrap">' + barsSvg(a.scores, a.primary) + '</div>';
  h += '<p class="note">' + esc(a.summary) + '</p>';
  extraSafetyNotes(state.extra).forEach(t => { h += '<p class="note warn">' + esc(t) + '</p>'; });

  h += '<h3>体质特征</h3><dl class="profile">' +
    '<div><dt>形体特征</dt><dd>' + esc(c.profile.physique) + '</dd></div>' +
    '<div><dt>常见表现</dt><dd>' + esc(c.profile.common) + '</dd></div>' +
    '<div><dt>心理特征</dt><dd>' + esc(c.profile.mind) + '</dd></div>' +
    '<div><dt>发病倾向</dt><dd>' + esc(c.profile.tendency) + '</dd></div>' +
    '<div><dt>适应能力</dt><dd>' + esc(c.profile.adapt) + '</dd></div>' +
    '</dl>';

  h += '<div class="result-foot">' +
    '<button class="btn" data-action="go" data-page="plan">生成我的调理方案</button>' +
    '<button class="btn ghost" data-action="retake">重新测评</button>' +
    '</div>';
  h += '<p class="note">本判定依据标准量表自评得分，最终体质判定须由中医师结合面诊、舌诊、脉诊核对核心特征后确认。</p>';
  h += '</section>';
  return h;
}

/* --- 方案页 ---
 * 结构：① 主体质 + 最多 2 个兼顾体质，各自给简要建议
 *       ② 综合三者后输出统一方案（日常作息 / 运动 / 行为习惯 / 饮食起居 / 情绪调节）
 *       ③ 三阶段循序渐进安排
 */
function planIds(a) {
  return [a.primary].concat(a.secondary || [], a.tendencies || []).slice(0, 3);
}
/* 某一维度合并后的统一要点：主线在前、兼顾在后，去重后取前 6 条 */
function planDimPoints(ids, dim) {
  if (dim === 'habit') {
    const out = [], seen = {};
    ids.forEach(function (id, i) {
      const L = (typeof HABITS !== 'undefined' && HABITS[id]) ? HABITS[id] : [];
      L.slice(0, i === 0 ? 4 : 2).forEach(function (h) {
        if (seen[h.text]) return;
        seen[h.text] = 1;
        out.push(h.text);
      });
    });
    return out.slice(0, 6);
  }
  const out = [], seen = {};
  ids.forEach(function (id) {
    const c = CONSTITUTIONS[id];
    if (!c || !c.plan || !c.plan[dim]) return;
    c.plan[dim].points.forEach(function (t) {
      const k = t.replace(/\s+/g, '');
      if (seen[k]) return;
      seen[k] = 1;
      out.push(t);
    });
  });
  return out.slice(0, 6);
}
function planFoodList(ids, kind) {
  const out = [], seen = {};
  ids.forEach(function (id) {
    const c = CONSTITUTIONS[id];
    if (!c || !c.plan || !c.plan.diet) return;
    (c.plan.diet[kind] || []).forEach(function (t) { if (!seen[t]) { seen[t] = 1; out.push(t); } });
  });
  return out;
}
/* 合并体质食材时以“慎食”为安全优先级，避免同一种食物同时出现在宜食与慎食。 */
function planFoodLists(ids) {
  const avoid = planFoodList(ids, 'avoid');
  const suitable = planFoodList(ids, 'suitable').filter(function (food) {
    const key = String(food).replace(/\s+/g, '');
    return !avoid.some(function (rule) {
      return String(rule).replace(/\s+/g, '').indexOf(key) > -1;
    });
  });
  return { suitable: suitable, avoid: avoid };
}
/* 阶段建议中的时间、次数和明确禁忌需要醒目，但其余正文保持常规字重。 */
function stageTextHtml(text) {
  const important = /(\d{1,2}:\d{2}|(?:第\s*)?\d+\s*(?:至|–|-)\s*\d+\s*(?:分钟|小时|次|项|周|天|种)|\d+\s*(?:分钟|小时|次|项|周|天)(?:内|以上)?|每天|每周|每次|手机不进卧室|戒掉夜宵与含糖饮料|不设强度要求|连续两天内补回)/g;
  return String(text).split(important).map(function (part, i) {
    return i % 2 ? '<strong>' + esc(part) + '</strong>' : esc(part);
  }).join('');
}
/* 依据体质标签自动识别冲突，给出调和原则 */
function planConflictNotes(ids) {
  if (ids.length < 2) return [];
  const tags = {};
  ids.forEach(function (id) {
    const t = PLAN_TEMPER[id] || {};
    Object.keys(t).forEach(function (k) { tags[k] = (tags[k] || 0) + t[k]; });
  });
  const notes = [];
  PLAN_CONFLICTS.forEach(function (r) {
    const a = r.when[0], b = r.when[1];
    if (b === null) { if (tags[a]) notes.push(r.text); }
    else if (tags[a] && tags[b]) notes.push(r.text);
  });
  return notes;
}
/* 第一步：三个体质各自简要建议 */
function planBriefHtml(a, ids) {
  let h = '<div class="briefs">';
  ids.forEach(function (id, i) {
    const c = CONSTITUTIONS[id];
    if (!c) return;
    const sc = (a && a.scores) ? a.scores[id] : null;
    const pts = [];
    ['routine', 'exercise', 'diet', 'emotion'].forEach(function (d) {
      if (c.plan[d] && c.plan[d].points && c.plan[d].points[0]) pts.push(c.plan[d].points[0]);
    });
    h += '<div class="brief' + (i === 0 ? ' main' : '') + '" style="--c:' + c.color + '">' +
      '<div class="brief-head"><span class="brief-seal">' + c.seal + '</span>' +
      '<div><h4>' + (i === 0 ? '主体质' : '兼顾 ' + i) + ' · ' + c.name + '</h4>' +
      '<p class="muted small">' + (sc ? '转化分 ' + sc.conv.toFixed(1) + '　·　判定「' + sc.verdict + '」' : '历史记录') + '</p></div></div>' +
      '<p class="lead">' + esc(c.principle) + '</p>' +
      '<ul>' + pts.slice(0, 3).map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>' +
      ((c.plan.diet && c.plan.diet.avoid && c.plan.diet.avoid[0]) ? '<p class="avoid">这一项最该避开：' + esc(c.plan.diet.avoid[0]) + '</p>' : '') +
      '</div>';
  });
  return h + '</div>';
}
/* 第二步 + 第三步：统一方案主体（页面与历史详情共用） */
function planBodyHtml(a, ids, bare) {
  const main = CONSTITUTIONS[ids[0]] || CONSTITUTIONS.pinghe;
  const open = bare ? '<div class="pblock">' : '<section class="panel">';
  const close = bare ? '</div>' : '</section>';
  let h = '';

  h += open + '<h2 class="plan-step-title">第一步 · 三个体质分别怎么说</h2>' +
    '<p class="muted">先看清楚各自的短板，再合成一套不打架的方案。共取 1 个主体质 + 最多 2 个兼顾体质。</p>' +
    planBriefHtml(a, ids) + close;

  const notes = planConflictNotes(ids);
  h += open + '<h2 class="plan-step-title">第二步 · 综合后的统一方案</h2>' +
    '<p class="muted">以「' + main.name + '」为主轴，把' +
    (ids.length > 1 ? ids.slice(1).map(i => CONSTITUTIONS[i].name).join('、') : '其') +
    '的要点并入同一套安排，按五个生活场景分别落地。</p>';
  if (notes.length) {
    h += '<div class="conflict"><h4>注意！冲突调和原则</h4><ul>' +
      notes.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></div>';
  }

  PLAN_DIMS.forEach(function (d) {
    const pts = planDimPoints(ids, d.key);
    const lead = (main.plan[d.key] && main.plan[d.key].summary) ? main.plan[d.key].summary : '';
    h += '<div class="udim" style="--c:' + main.color + '">' +
      '<div class="udim-head"><span class="dim-icon">' + d.icon + '</span>' +
      '<h4>' + d.label + '</h4><em>' + esc(lead) + '</em></div>' +
      '<ul>' + pts.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>';
    if (d.key === 'diet') {
      const food = planFoodLists(ids);
      h += '<div class="food"><div><b>宜食</b><p>' + food.suitable.join('、') + '</p></div>' +
        '<div><b>慎食</b><p>' + food.avoid.join('、') + '</p></div></div>';
    }
    h += '</div>';
  });
  h += close;

  h += open + '<h2 class="plan-step-title">第三步 · 分阶段循序渐进</h2>' +
    '<p class="muted">每个阶段只做当阶段的事，做稳了再进下一阶段，比一次性全改更容易坚持。</p>';
  PLAN_STAGES.forEach(function (st) {
    h += '<div class="stage">' +
      '<div class="stage-head"><span class="stage-no">' + st.no + '</span>' +
      '<div><h4>' + st.span + ' · ' + st.title + '</h4><p class="muted small">' + esc(st.sub) + '</p></div></div>' +
      '<p class="stage-goal">阶段目标：' + esc(st.goal) + '</p>' +
      '<ul class="stage-dim">' + PLAN_DIMS.map(function (d) {
        return '<li><b><i class="stage-label-line">' + esc(d.label.slice(0, 2)) + '</i><i class="stage-label-line">' + esc(d.label.slice(2)) + '</i></b><span>' + stageTextHtml(st.dim[d.key]) + '</span></li>';
      }).join('') + '</ul>' +
      '<p class="stage-check">阶段自查：' + esc(st.check) + '</p>' +
      '</div>';
  });
  h += close;
  return h;
}

function viewPlan() {
  if (!state.assessment) return emptyState('请先完成体质测评', 'assess');
  const a = state.assessment;
  const ids = planIds(a);
  const dropped = (a.secondary || []).length + (a.tendencies || []).length - (ids.length - 1);

  let h = '<section class="panel plan-summary"><a class="crumb" href="#" data-action="go" data-page="home">返回首页</a>' +
    '<h2 class="plan-title">我的调理方案</h2>' +
    '<p class="plan-verdict"><span class="plan-verdict-lead">以「<strong>' + CONSTITUTIONS[a.primary].name + '</strong>」为主体质' +
    (ids.length > 1 ? '，兼顾' + ids.slice(1).map(i => CONSTITUTIONS[i].name).join('、') : '') +
    '。</span><span class="plan-verdict-detail">方案分两步输出：先看三个体质各自怎么说，再合成一份统一方案，并按三阶段推进，建议执行 4 至 8 周后复测。</span></p>' +
    (dropped > 0 ? '<p class="note">另有 ' + dropped + ' 项偏颇体质转化分较低，本轮暂不纳入，以免建议相互冲突；待主导体质改善后再行评估。</p>' : '') +
    extraSafetyNotes(state.extra).map(t => '<p class="note warn">' + esc(t) + '</p>').join('') +
    '</section>';

  h += planBodyHtml(a, ids);

  h += '<section class="panel"><h2 class="therapy-section-title">药膳与穴位</h2><div class="therapy">';
  ids.forEach(id => {
    const c = CONSTITUTIONS[id];
    h += '<div class="therapy-item" style="--c:' + c.color + '"><h4 class="therapy-title">' + c.name + '　<span class="muted small">' + esc(c.principle) + '</span></h4>' +
      '<div class="two-col"><div><b>药膳参考</b><ul>' + c.therapy.recipes.map(r => '<li><b>' + esc(r.name) + '</b><em>' + esc(r.use) + '</em></li>').join('') + '</ul></div>' +
      '<div><b>常用穴位</b><ul>' + c.therapy.acupoints.map(p => '<li><b>' + esc(p.name) + '</b><em>' + esc(p.how) + '</em></li>').join('') + '</ul></div></div></div>';
  });
  h += '</div><p class="note">药膳与穴位仅供参考，慢性病患者、孕期、哺乳期及正在服药者请先咨询中医师。</p></section>';
  return h;
}

/* --- 习惯页 --- */
function viewHabits() {
  const done = todayDone();
  const list = state.habits.list;
  let h = '<section class="panel"><h2>今日打卡</h2>' +
    '<div class="ring-row">' + ringSvg(done.length, list.length) +
    '<div class="ring-side"><p class="big">' + streakDays() + ' <span>天连续</span></p>' +
    '<p class="muted">达标线为当日完成一半以上。点击条目即可打卡。</p></div></div></section>';

  /* 宽屏（横屏 / 页面放大）时清单分左右两列、每列自上而下排列；窄屏保持单列 */
  h += '<section class="panel"><h2>习惯清单</h2><ul class="habits cols">';
  if (!list.length) h += '<li class="muted">还没有习惯，点下方「添加习惯」创建第一条。</li>';
  list.forEach(item => {
    const on = done.indexOf(item.id) > -1;
    const t = TAG_META[item.tag] || TAG_META.routine;
    h += '<li class="habit' + (on ? ' on' : '') + '">' +
      '<button class="check" data-action="toggle" data-id="' + item.id + '" aria-pressed="' + on + '">' + (on ? '✓' : '') + '</button>' +
      '<div class="habit-body"><b>' + esc(item.text) + '</b><em>' + esc(item.why || '') + '</em></div>' +
      '<span class="tag" style="--c:' + t.color + '">' + t.label + '</span>' +
      habitOpsHtml(item.id) +
      '</li>';
  });
  h += '</ul>';
  h += '<div class="add-row">' +
    '<button class="btn small" data-action="habit-add">＋ 添加习惯</button>' +
    '<span class="muted small habit-manage-tip">提示：修改只换说法、打卡记录全部保留；删除会连同该习惯的历史打卡记录一起清除，请谨慎操作！</span>' +
    '</div>';
  h += '</section>';

  /* 打卡记录：可切换近 30 / 60 / 90 天，标题随范围变化 */
  h += '<section class="panel heat-panel"><h2>打卡热力图 · 近 ' + heatRange() + ' 天</h2>' +
    heatRangeHtml() +
    '<div class="heat-wrap">' + heatSvg() + '</div>' +
    '<p class="muted small">颜色越深表示当日完成率越高。空白即当日未打卡。</p></section>';
  return h;
}

/* --- 食谱页 --- */
/* ---------------- 配餐依据与营养比例 ----------------
 * 推荐同时参考四类依据：① 体质报告 ② 当前时令节气 ③ 调理方案「饮食起居」
 * ④ 身体管理方案「饮食建议」；营养比例在此基础上按个人情况动态增减。
 */
const NUTRI_BASE = { carb: 55, protein: 18, fat: 27 };
const NUTRI_META = [
  { k: 'carb', label: '碳水', color: '#C98A3C', kcalPerG: 4 },
  { k: 'protein', label: '蛋白', color: '#A6432E', kcalPerG: 4 },
  { k: 'fat', label: '脂肪', color: '#7C9A6B', kcalPerG: 9 }
];
/* 体质对营养比例的影响方向 */
const NUTRI_BY_TYPE = {
  tanshi: { d: [-5, 5, 0], why: '痰湿质：下调精制碳水、提高蛋白占比，减少血糖波动与困倦' },
  shire: { d: [-5, 5, 0], why: '湿热质：控糖控油，蛋白以鱼虾豆制品等清爽来源为主' },
  qixu: { d: [-3, 3, 0], why: '气虚质：主食不可全断，蛋白少量多次补充以护脾气' },
  yangxu: { d: [-3, 3, 0], why: '阳虚质：提高蛋白与温热性食材占比，减少生冷沙拉类' },
  yinxu: { d: [-3, 0, 3], why: '阴虚质：适度提高优质脂肪（坚果、深海鱼），缓解燥象' },
  xueyu: { d: [-2, 2, 0], why: '血瘀质：蛋白配合深色蔬果，减少油炸与反式脂肪' },
  qiyu: { d: [-2, 2, 0], why: '气郁质：稳定碳水（粗细各半）有助情绪平稳，避免暴食' },
  tebing: { d: [0, 0, 0], why: '特禀质：以低致敏、易消化为先，比例维持基础值不做大幅调整' }
};
function currentWeightKg() {
  const logs = weightLogs();
  if (logs.length) return logs[logs.length - 1].kg;
  const f = state.weight && state.weight.form;
  const w = f ? +f.weight : 0;
  return w > 0 ? w : 0;
}
/* 每日热量基准：优先用身体管理方案，其次按 Mifflin-St Jeor 估算，都没有则返回 0 */
function baseKcal() {
  const p = (state.weight && state.weight.plan && state.weight.plan.v === 1) ? state.weight.plan : null;
  if (p && p.nutri && p.nutri.kcal > 0) return p.nutri.kcal;
  const cm = +state.profile.height || 0, w = currentWeightKg(), age = ageNum();
  const g = genderKey();
  if (cm > 0 && w > 0 && age > 0 && g) {
    const bmr = 10 * w + 6.25 * cm - 5 * age + (g === 'male' ? 5 : -161);
    return Math.round(bmr * 1.375);
  }
  return 0;
}
/* 营养比例：以身体管理方案（或基础比例）为底，按体质 / 年龄 / 时令 / 经期动态增减 */
function nutritionProfile() {
  const a = state.assessment;
  const cid = a ? a.primary : 'pinghe';
  const p = (state.weight && state.weight.plan && state.weight.plan.v === 1) ? state.weight.plan : null;
  let r = { carb: NUTRI_BASE.carb, protein: NUTRI_BASE.protein, fat: NUTRI_BASE.fat };
  if (p && p.nutri && p.nutri.kcal > 0) {
    const pc = p.nutri.carb * 4, pp = p.nutri.protein * 4, pf = p.nutri.fat * 9;
    const sum = pc + pp + pf;
    if (sum > 0) r = { carb: Math.round(pc / sum * 100), protein: Math.round(pp / sum * 100), fat: 0 };
    r.fat = 100 - r.carb - r.protein;
  }
  const adj = [];
  const shift = (dC, dP, dF, why) => { r.carb += dC; r.protein += dP; r.fat += dF; if (why) adj.push(why); };

  const byType = NUTRI_BY_TYPE[cid];
  if (byType && (byType.d[0] || byType.d[1] || byType.d[2])) shift(byType.d[0], byType.d[1], byType.d[2], byType.why);
  const band = ageBandOf();
  if (band === 'senior') shift(-5, 5, 0, '年过六十：提高蛋白至防肌少水平，相应下调主食');
  else if (band === 'teen') shift(-3, 3, 0, '未成年 / 青年期：保证蛋白与钙的摄入，主食粗细搭配');
  const mon = new Date().getMonth() + 1;
  if (mon === 11 || mon === 12 || mon === 1) shift(-2, 0, 2, '冬令闭藏：适当提高优质脂肪与温热食材，减少生冷');
  else if (mon >= 6 && mon <= 8) shift(2, 0, -2, '暑湿当令：清淡为主，略增碳水、减少油腻');
  if (periodOnDay(todayKey())) shift(-2, 2, 0, '经期：提高蛋白与含铁食材占比，暂避寒凉生冷');

  NUTRI_META.forEach(m => { r[m.k] = clamp(r[m.k], 10, 70); });
  const sum2 = r.carb + r.protein + r.fat;
  NUTRI_META.forEach(m => { r[m.k] = Math.round(r[m.k] / sum2 * 1000) / 10; });

  const kcal = baseKcal();
  const grams = {};
  if (kcal > 0) NUTRI_META.forEach(m => { grams[m.k] = Math.round(kcal * r[m.k] / 100 / m.kcalPerG); });
  return { ratio: r, grams: grams, kcal: kcal, adj: adj, hasPlan: !!p, cid: cid, inPeriod: periodOnDay(todayKey()) };
}
/* 四类配餐依据 */
function recipeBasis(cid) {
  const c = CONSTITUTIONS[cid] || CONSTITUTIONS.pinghe;
  const mon = new Date().getMonth() + 1;
  const a = state.assessment;
  /* ③ 调理方案：取主体质 + 兼顾体质的「饮食起居」要点 */
  const ids = a ? (planIds(a) || [a.primary]) : [cid];
  const names = [], lines = [];
  ids.slice(0, 3).forEach(id => {
    const cc = CONSTITUTIONS[id];
    if (!cc || !cc.plan || !cc.plan.diet) return;
    names.push(cc.name);
    (cc.plan.diet.points || []).slice(0, 1).forEach(t => lines.push(t));
  });
  /* ④ 身体管理方案：热量目标与忌口替换 */
  const p = (state.weight && state.weight.plan && state.weight.plan.v === 1) ? state.weight.plan : null;
  let wmText = '尚未生成。生成后，营养比例会直接采用方案里的每日热量与蛋白目标。';
  if (p) {
    const kcalLine = ((p.diet || []).filter(x => x.t === '每天吃多少')[0] || {}).l || [];
    wmText = (kcalLine[0] || '') + ' 方案里的蛋白与碳水目标已并入下方比例条，并按体质、时令与经期做了微调。';
  }
  /* ⑤ 忌口与偏好：来自「饮食画像」与身体管理方案表单 */
  const d = dietAll();
  const dk = dietBanKeys();
  const dSel = d.likes.concat(d.avoids).concat(d.chronic);
  const dietText = dSel.length || String(d.avoidText || '').trim()
    ? '已排除 ' + dSel.join('、') + (String(d.avoidText || '').trim() ? '、' + String(d.avoidText).trim() : '') +
      '（共 ' + dk.length + ' 条匹配规则）；同一食材当天只用一次，冲突时按营养相近替换。'
    : '未设置偏好与忌口。设置后命中的食材与做法会被自动排除。';
  return [
    { k: '体质报告', v: c.name, d: c.plan.diet.summary },
    { k: '时令节气', v: mon + ' 月', d: SEASON_TIPS[mon] || '' },
    { k: '调理方案 · 饮食起居', v: names.join(' + ') || c.name, d: lines.join('；') || c.plan.diet.points[0] },
    { k: '身体管理方案 · 饮食', v: p ? '已生成' : '未生成', d: wmText },
    { k: '忌口 · 偏好 · 慢病', v: dSel.length ? dSel.length + ' 项' : '未设置', d: dietText }
  ];
}
/* 营养比例条 + 克数 + 动态调整说明 */
function nutritionHtml(cid) {
  const n = nutritionProfile();
  let h = '<div class="nutri-basis">' + recipeBasis(cid).map(b =>
    '<div class="nb"><b>' + esc(b.k) + '</b><span>' + esc(b.v) + '</span><p>' + esc(b.d) + '</p></div>').join('') + '</div>';

  h += '<div class="nbar">';
  NUTRI_META.forEach(m => { h += '<i style="width:' + n.ratio[m.k] + '%;background:' + m.color + '"></i>'; });
  h += '</div><div class="nbar-legend">';
  NUTRI_META.forEach(m => {
    h += '<span><i style="background:' + m.color + '"></i>' + m.label + ' ' + n.ratio[m.k] + '%' +
      (n.grams[m.k] ? '　' + n.grams[m.k] + ' g' : '') + '</span>';
  });
  h += '</div>';
  h += '<p class="muted small">' + (n.kcal > 0
    ? '按每日 ' + n.kcal + ' kcal' + (n.hasPlan ? '（取自身体管理方案）' : '（按身高体重活动量估算）') + '换算克数。'
    : '补充身高、体重、年龄后，这里会给出具体克数。') + '</p>';
  h += '<ul class="plain">' + n.adj.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>';
  if (n.inPeriod) h += '<p class="pd-saved">当前处于经期：今日食谱已自动避开寒凉、生冷食材。是否需要补铁请依据检查结果咨询医务人员。</p>';
  return h;
}

/* —— 饮食画像：口味偏好 / 忌口与过敏 / 慢性病与饮食限制 —— */
function dietGroupHtml(title, field, list, hint) {
  const sel = dietAll()[field] || [];
  return '<div class="diet-group"><b>' + title + '</b><div class="chips">' +
    list.map(v => '<button type="button" class="chip pickable' + (sel.indexOf(v) > -1 ? ' on' : '') +
      '" data-action="diet-tag" data-f="' + field + '" data-v="' + esc(v) + '">' + esc(v) + '</button>').join('') +
    '</div>' + (hint ? '<p class="muted small">' + hint + '</p>' : '') + '</div>';
}
function dietProfileHtml() {
  const d = dietAll();
  const ban = dietBanKeys();
  const total = d.likes.length + d.avoids.length + d.chronic.length;
  let h = '<p class="muted">勾选后立即作用于今日与未来七日的配餐：命中的食材与做法会被排除，候选不足时自动用营养成分相近的食材替换。</p>';
  h += dietGroupHtml('口味偏好', 'likes', DIET_TAGS.likes,
    '「素食为主」「清淡少油」会直接排除对应食材与做法；「无肉不欢」让含优质蛋白的荤菜优先。');
  h += dietGroupHtml('忌口与过敏', 'avoids', DIET_TAGS.avoids,
    '例如选「海鲜过敏」后，鱼、虾、蟹、贝、海带、紫菜一律不会出现在推荐里。');
  h += dietGroupHtml('慢性病与饮食限制', 'chronic', DIET_TAGS.chronic,
    '仅作饮食参考，不能替代医嘱；已确诊者请以主治医师的方案为准。');
  h += '<div class="diet-group"><b>其他忌口（自由填写）</b>' +
    '<div class="fm-row"><input class="diet-input" type="text" value="' + esc(d.avoidText) +
    '" placeholder="多个请用顿号分隔，例如：香菜、韭菜、羊肉"></div>' +
    '<p class="muted small">填写的词与上面的标签一起参与排除。</p></div>';
  h += '<div class="qfoot"><span class="muted small">' +
    (total || String(d.avoidText || '').trim()
      ? '已生效 ' + total + ' 项标签、' + ban.length + ' 条排除规则'
      : '当前未设置偏好与忌口，按体质与时令默认配餐') + '</span>' +
    (total ? '<button class="btn small ghost" data-action="diet-clear">清空</button>' : '') + '</div>';
  return h;
}

function viewRecipes() {
  if (!state.assessment) return emptyState('请先完成体质测评', 'assess');
  const cid = state.assessment.primary;
  const c = CONSTITUTIONS[cid];
  /* 宽屏（横屏 / 页面放大）时，「今日食谱」与「未来七日预览」左右并排；窄屏自动回到单列 */
  let h = '<div class="pair">';

  const basis = recipeBasis(cid);
  const wmOn = !!(state.weight && state.weight.plan && state.weight.plan.v === 1);
  h += '<section class="panel"><h2>今日食谱 · ' + c.name + '</h2>' +
    '<p class="muted">已综合五类依据生成：' + basis.map(b => esc(b.k) + '（' + esc(b.v) + '）').join('　·　') + '。</p>' +
    '<p class="muted small">' + esc(SEASON_TIPS[new Date().getMonth() + 1]) + (wmOn ? '' : '　·　未生成身体管理方案时按体质与估算热量配餐，生成后会自动改用方案目标。') + '</p>' +
    (periodOnDay(todayKey()) ? '<p class="pd-saved">经期模式：今日推荐已避开寒凉、生冷食材。是否需要补铁请依据检查结果咨询医务人员。</p>' : '') +
    '<div class="rcp-actions"><button class="btn small ghost" data-action="menu-offset" data-d="-1">前一天</button>' +
    '<button class="btn small" data-action="menu-offset" data-d="0">回到今天</button>' +
    '<button class="btn small ghost" data-action="menu-offset" data-d="1">后一天</button></div>' +
    menuHtml(cid, shiftDay(todayKey(), ui.menuOffset || 0)) + '</section>';

  h += '<section class="panel"><h2>未来七日食谱预览</h2><div class="week">';
  for (let i = 0; i < 7; i++) {
    const k = shiftDay(todayKey(), i + (ui.menuOffset || 0));
    const m = menuFor(cid, k);
    h += '<div class="day"><div class="day-head">' + ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parseKey(k).getDay()] + ' · ' + k.slice(5) + '</div>' +
      '<p><span>早</span>' + esc(m.breakfast.name) + '</p>' +
      '<p><span>午</span>' + esc(m.lunch.name) + '</p>' +
      '<p><span>晚</span>' + esc(m.dinner.name) + '</p>' +
      '<p class="tea"><span>茶</span>' + esc(m.drink.name) + '</p>' +
      '<p class="fruit"><span>果</span>' + esc(m.fruit.name) + '</p></div>';
  }
  h += '</div></section>';

  h += '</div>';

  h += '<section class="panel"><h2>饮食画像 · 决定食谱怎么配</h2>' + dietProfileHtml() + '</section>';

  h += '<section class="panel"><h2>配餐依据与营养比例</h2>' + nutritionHtml(cid) + '</section>';

  h += '<section class="panel"><h2>饮食宜忌</h2><div class="food big-food">' +
    '<div><b>宜食</b><p>' + c.plan.diet.suitable.join('、') + '</p></div>' +
    '<div><b>慎食</b><p>' + c.plan.diet.avoid.join('、') + '</p></div></div>' +
    '<p class="note">食谱按体质与时令轮换生成，实际请结合个人过敏史、慢病饮食医嘱调整。</p></section>';

  h += '<section class="panel"><h2>营养素补充说明</h2>' +
    '<ul class="plain">' +
    '<li>水果与补剂按体质寒热与营养需求匹配，每天「果」「补」各一项，可点「换一换」单选更换。</li>' +
    '<li>补剂标注的摄入时间为一般建议，脂溶性维生素随餐服用吸收更好，钙与镁宜分次并避开咖啡与茶。</li>' +
    '<li>已确诊慢病、正在服药、孕期哺乳期或计划手术者，补充任何营养素前请先咨询医师或药师。</li>' +
    '<li>优先从食物中获取：膳食均衡时不必额外补充，补剂只用于弥补确有不足的部分。</li>' +
    '</ul></section>';
  return h;
}

/* --- 记录页 --- */
/* ---------------- 体重管理（对接微脉体重管理 Connector） ---------------- */
function weightLogs() {
  return Object.keys(state.records)
    .map(k => ({ k: k, kg: +state.records[k].weight || 0, fat: +state.records[k].bodyfat || 0 }))
    .filter(p => p.kg > 0)
    .sort((a, b) => (a.k < b.k ? -1 : 1));
}
function bmiOf(kg, cm) {
  const m = (+cm || 0) / 100;
  return (kg > 0 && m > 0) ? kg / (m * m) : 0;
}
function bmiBand(v) { return BMI_BANDS.filter(b => v < b.max)[0] || BMI_BANDS[BMI_BANDS.length - 1]; }
function idealRange(cm) {
  const m = (+cm || 0) / 100;
  return m ? [18.5 * m * m, 23.9 * m * m] : [0, 0];
}
function emptyTrendSvg(metric, goal) {
  const w = 600, h = 220, padL = 54, padR = 20, padT = 18, padB = 42;
  const meta = (typeof ARCHIVE_METRIC !== 'undefined' && ARCHIVE_METRIC[metric]) || ['体重', 'kg'];
  const innerW = w - padL - padR, innerH = h - padT - padB;
  let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" aria-label="' + esc(meta[0]) + '趋势坐标图">';
  for (let i = 0; i <= 4; i++) {
    const y = padT + i * innerH / 4;
    s += '<line x1="' + padL + '" y1="' + y + '" x2="' + (w - padR) + '" y2="' + y + '" stroke="#E7DED0" stroke-width="0.8"/>';
  }
  s += '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (h - padB) + '" stroke="#8C806E"/>';
  s += '<line x1="' + padL + '" y1="' + (h - padB) + '" x2="' + (w - padR) + '" y2="' + (h - padB) + '" stroke="#8C806E"/>';
  s += '<text x="' + ((padL + w - padR) / 2) + '" y="' + (h - 12) + '" font-size="11" fill="#6A6255" text-anchor="middle">日期（记录日期）</text>';
  s += '<text x="16" y="' + (padT + innerH / 2) + '" font-size="11" fill="#6A6255" text-anchor="middle" transform="rotate(-90 16 ' + (padT + innerH / 2) + ')">' + esc(meta[0]) + '（' + esc(meta[1]) + '）</text>';
  if (metric === 'weight' && +goal > 0) {
    const gy = padT + innerH / 2;
    s += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (w - padR) + '" y2="' + gy + '" stroke="#7C9A6B" stroke-width="1.2" stroke-dasharray="6 4"/>';
    s += '<text x="' + (w - padR - 4) + '" y="' + (gy - 7) + '" font-size="10" fill="#6F8D60" text-anchor="end">目标体重 ' + (+goal).toFixed(1) + ' kg</text>';
  }
  s += '<text x="' + (padL + innerW / 2) + '" y="' + (padT + innerH / 2 + 24) + '" font-size="13" fill="#A39A88" text-anchor="middle">至少记录两天数据才会生成趋势</text></svg>';
  return s;
}
function weightLineSvg(logs, goal) {
  const w = 600, h = 220, padL = 40, padB = 28, padT = 16;
  let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" aria-label="体重趋势折线图">';
  if (logs.length < 2) {
    return emptyTrendSvg('weight', goal);
  }
  const vals = logs.map(p => p.kg).concat(goal > 0 ? [goal] : []);
  let min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
  const pad2 = Math.max(0.6, (max - min) * 0.15);
  min -= pad2; max += pad2;
  const innerW = w - padL - 20, innerH = h - padT - padB;
  const X = i => padL + (i / (logs.length - 1)) * innerW;
  const Y = v => padT + innerH - ((v - min) / (max - min)) * innerH;
  for (let g = 0; g <= 3; g++) {
    const y = padT + (g / 3) * innerH;
    s += '<line x1="' + padL + '" y1="' + y + '" x2="' + (w - 20) + '" y2="' + y + '" stroke="#EDE6D8" stroke-width="0.5"/>';
    s += '<text x="' + (padL - 6) + '" y="' + (y + 4) + '" font-size="10" fill="#A39A88" text-anchor="end">' + (max - (g / 3) * (max - min)).toFixed(1) + '</text>';
  }
  if (goal > 0) {
    s += '<line x1="' + padL + '" y1="' + Y(goal).toFixed(1) + '" x2="' + (w - 20) + '" y2="' + Y(goal).toFixed(1) + '" stroke="#7C9A6B" stroke-width="1" stroke-dasharray="5 4"/>';
    s += '<text x="' + (w - 24) + '" y="' + (Y(goal) - 6).toFixed(1) + '" font-size="10" fill="#7C9A6B" text-anchor="end">目标 ' + goal.toFixed(1) + ' kg</text>';
  }
  let d = '';
  logs.forEach((p, i) => { d += (i ? ' L ' : 'M ') + X(i).toFixed(1) + ' ' + Y(p.kg).toFixed(1); });
  s += '<path d="' + d + '" fill="none" stroke="#A6432E" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>';
  logs.forEach((p, i) => {
    s += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.kg).toFixed(1) + '" r="3" fill="#FFF" stroke="#A6432E" stroke-width="1.5"><title>' + p.k + '　' + p.kg.toFixed(1) + ' kg</title></circle>';
  });
  logs.forEach((p, i) => {
    if (i % Math.ceil(logs.length / 6) === 0 || i === logs.length - 1) {
      s += '<text x="' + X(i).toFixed(1) + '" y="' + (h - 10) + '" font-size="10" fill="#A39A88" text-anchor="middle">' + p.k.slice(5) + '</text>';
    }
  });
  s += '</svg>';
  return s;
}

function wmProfileText() {
  const logs = weightLogs();
  const last = logs.length ? logs[logs.length - 1] : null;
  const curr = last ? last.kg : 0;
  const cm = +state.profile.height || 0;
  const bmi = bmiOf(curr, cm);
  const a = state.assessment;
  const c = a ? CONSTITUTIONS[a.primary] : null;
  const sec = (a && a.secondary && a.secondary.length) ? a.secondary.map(s => CONSTITUTIONS[s].name).join('、') : '无';
  const recent = logs.slice(-10).map(p => p.k + ' ' + p.kg.toFixed(1) + 'kg').join('；');
  const habits = (state.habits.list || []).map(x => x.text || x.name || '').filter(Boolean).slice(0, 8).join('、');
  const L = [];
  L.push('【基本信息】姓名：' + (state.profile.name || '未填写') + '，性别：' + (state.profile.gender || '未填写') + '，年龄：' + (state.profile.age || '未填写') + ' 岁，身高：' + (cm || '未填写') + ' cm。');
  L.push('【体重现状】当前体重：' + (curr ? curr.toFixed(1) + ' kg（记录于 ' + last.k + '）' : '尚无记录') + '，BMI：' + (bmi ? bmi.toFixed(1) + '（' + bmiBand(bmi).label + '）' : '无法计算') + '。');
  L.push('【中医体质】主导体质：' + (c ? c.name + '（转化分 ' + a.scores[a.primary].conv.toFixed(1) + '，判定：' + a.verdictText + '）' : '尚未测评') + '；兼夹体质：' + sec + '。');
  if (cm) { const r = idealRange(cm); L.push('【理想体重区间】按 BMI 18.5–23.9 计算为 ' + r[0].toFixed(1) + '–' + r[1].toFixed(1) + ' kg。'); }
  L.push('【目标】目标体重：' + (state.weight.goal ? state.weight.goal + ' kg' : '请依据评估给出合理目标与周期') + '。');
  if (recent) L.push('【近期体重记录】' + recent + '。');
  if (habits) L.push('【当前习惯】' + habits + '。');
  L.push('【诉求】请基于以上信息与目标方向生成一份成人个体化体重管理方案：先判断适合减脂减重、维持塑形还是增重增肌，再给出对应的每日热量与三大营养素目标、分阶段计划、饮食与运动安排、复盘频率，以及需要暂停方案并就医的安全边界。');
  return L.join('\n');
}

/* 安全边界文案随「当前」用户性别显示：历史方案里可能存着按另一性别生成的措辞 */
function wmSafetyText(s) {
  const t = String(s || '');
  return isFemale() ? t.replace('内分泌失调', '月经紊乱') : t.replace('月经紊乱', '内分泌失调');
}

function frag(x) {
  if (x == null) return '';
  if (Array.isArray(x)) return x.map(frag).join('');
  return String(x).split(/\n+/).filter(t => t.trim()).map(t => '<p>' + esc(t.trim()) + '</p>').join('');
}
/* 体重方案中将日期、数值、单位和安全边界加粗，便于快速扫读。 */
function wmEmphasis(text) {
  const safe = esc(text == null ? '' : String(text));
  const important = /(\d{4}-\d{2}-\d{2}|(?:\d+(?:\.\d+)?\s*(?:→|至|–|-)\s*)?\d+(?:\.\d+)?\s*(?:kg|kcal|周|次|分钟|小时|天|ml|g|%)(?:以上|以内|左右)?|不推荐|停止当前方案并就医|停止训练并就医|请先咨询医师|不低于|不超过|健康下限|避免反弹)/g;
  return safe.replace(important, '<strong>$1</strong>');
}
/* 新版本地生成的方案（v:1）走结构化渲染；旧版导入的外部 JSON 走通用兜底 */
function wmPlanHtml(plan) {
  const d = (plan && plan.data && typeof plan.data === 'object') ? plan.data : plan;
  if (!d || typeof d !== 'object') return '';
  if (d.v !== 1) return wmLegacyPlanHtml(d);
  let h = '';
  h += '<div class="wgrid">' + (d.metrics || []).map(m =>
    '<div class="wcard"><em>' + esc(m.k) + '</em><b>' + esc(m.v) + '</b><i>' + esc(m.n || '') + '</i></div>').join('') + '</div>';
  h += '<div class="wm-sec"><h4>一、目标与周期</h4>' +
    '<p class="muted small">' + wmEmphasis(d.title || '') + '　·　生成于 ' + wmEmphasis(d.at || '—') + '</p>' +
    (d.stages || []).map(s => '<div class="wm-block"><b>' + wmEmphasis(s.name) + '</b><p>' + wmEmphasis(s.text) + '</p></div>').join('') +
    '</div>';
  h += '<div class="wm-sec"><h4>二、饮食建议</h4>' + (d.diet || []).map(sec =>
    '<div class="wm-block"><b>' + wmEmphasis(sec.t) + '</b>' + (sec.l || []).map(x => '<p>' + wmEmphasis(x) + '</p>').join('') + '</div>').join('') + '</div>';
  h += '<div class="wm-sec"><h4>三、运动安排</h4><ul class="plain">' +
    (d.exercise || []).map(x => '<li>' + wmEmphasis(x) + '</li>').join('') + '</ul></div>';
  h += '<div class="wm-sec"><h4>四、注意事项</h4><ul class="plain">' +
    (d.caution || []).map(x => '<li>' + wmEmphasis(x) + '</li>').join('') + '</ul>' +
    '<div class="wm-safe"><b>什么时候该停</b><p>' + wmEmphasis(wmSafetyText(d.safety)) + '</p></div></div>';
  return h;
}

function wmLegacyPlanHtml(d) {
  let h = '';
  if (d.status) h += '<p class="wm-status">状态：' + esc(d.status) + (d.message ? '　·　' + esc(d.message) : '') + '</p>';
  const metrics = d.metrics || d.profile || {};
  const mk = Object.keys(metrics).filter(k => metrics[k] != null && typeof metrics[k] !== 'object');
  if (mk.length) {
    h += '<div class="wgrid">' + mk.slice(0, 8).map(k =>
      '<div class="wcard"><em>' + esc(k) + '</em><b>' + esc(String(metrics[k])) + '</b></div>').join('') + '</div>';
  }
  if (d.safety_boundary) h += '<div class="wm-safe"><b>安全边界</b>' + frag(d.safety_boundary) + '</div>';
  const phases = d.phases || d.timeline || [];
  if (Array.isArray(phases) && phases.length) {
    h += '<h3>分阶段计划</h3>';
    phases.forEach(p => {
      h += '<div class="wm-block"><b>' + esc(p.name || p.title || p.phase || '阶段') + '</b>' +
        frag(p.content || p.detail || p.desc || p.goals || '') + '</div>';
    });
  }
  const secs = d.sections || [];
  if (Array.isArray(secs) && secs.length) {
    h += '<h3>方案章节</h3>';
    secs.forEach(s => {
      h += '<div class="wm-block"><b>' + esc(s.title || s.name || s.key || '章节') + '</b>' +
        frag(s.content || s.text || s.advice || s.items || '') + '</div>';
    });
  }
  const ck = d.checklist || d.weekly_review || [];
  if (Array.isArray(ck) && ck.length) {
    h += '<h3>执行清单</h3><ul class="plain">' + ck.map(x => '<li>' + esc(typeof x === 'string' ? x : (x.text || x.item || JSON.stringify(x))) + '</li>').join('') + '</ul>';
  }
  if (d.meal_analysis) h += '<h3>餐食分析</h3>' + frag(d.meal_analysis);
  return h || '<p class="muted">未能识别方案结构，请确认导入的是连接器返回的 JSON。</p>';
}

/* 体重管理表单：只自动补齐空值，用户后续修改的内容始终优先。 */
function wmAutofillForm(form) {
  const f = Object.assign({}, form || {});
  const logs = weightLogs();
  const last = logs.length ? state.records[logs[logs.length - 1].k] || {} : {};
  const profile = state.profile || {}, user = state.user || {}, assessment = state.assessment || {};
  const constitution = assessment.primary && CONSTITUTIONS[assessment.primary] ? CONSTITUTIONS[assessment.primary].name : '';
  const diet = state.diet || {};
  const extra = state.extra && typeof state.extra === 'object' ? state.extra : {};
  const questionPool = (typeof QUESTIONS !== 'undefined' ? QUESTIONS.slice() : [])
    .concat(typeof GENDER_QUESTIONS !== 'undefined' && GENDER_QUESTIONS.female ? GENDER_QUESTIONS.female : [])
    .concat(typeof GENDER_QUESTIONS !== 'undefined' && GENDER_QUESTIONS.male ? GENDER_QUESTIONS.male : []);
  const extraText = Object.keys(extra).slice(0, 12).map(function (no) {
    const q = questionPool.filter(function (item) { return String(item.no) === String(no); })[0];
    const raw = extra[no], vals = Array.isArray(raw) ? raw : [raw];
    const shown = vals.map(function (v) {
      const idx = +v;
      return q && q.options && idx > 0 && q.options[idx - 1] ? q.options[idx - 1] : String(v || '');
    }).filter(Boolean).join('、');
    return shown ? (q ? q.text + '：' : '') + shown : '';
  }).filter(Boolean).join('；');
  const context = [
    constitution ? '体质：' + constitution : '',
    extraText ? '问卷补充：' + extraText : '',
    last.symptoms && last.symptoms.length ? '近期不适：' + last.symptoms.join('、') : '',
    diet.avoids && diet.avoids.length ? '忌口/过敏：' + diet.avoids.join('、') : '',
    diet.chronic && diet.chronic.length ? '慢病限制：' + diet.chronic.join('、') : '',
    diet.avoidText ? '其他忌口：' + diet.avoidText : '',
    last.note ? '最近备注：' + last.note : ''
  ].filter(Boolean).join('；');
  Object.keys(f).forEach(function (k) {
    if (f[k] !== '' && f[k] !== null && f[k] !== undefined) return;
    const n = k.toLowerCase();
    let v = '';
    if (/height|stature/.test(n)) v = profile.height || '';
    else if (/age/.test(n)) v = profile.age || user.age || '';
    else if (/gender|sex/.test(n)) v = profile.gender || user.gender || '';
    else if (/target|goal/.test(n)) v = (state.weight && state.weight.goal) || '';
    else if (/weight|current/.test(n)) v = last.weight || '';
    else if (/sleep/.test(n)) v = last.sleep || '';
    else if (/energy/.test(n)) v = last.energy || '';
    else if (/mood|emotion/.test(n)) v = last.mood || '';
    else if (/constitution|tcm/.test(n)) v = constitution;
    else if (/health|condition|history|note|remark|risk/.test(n)) v = context;
    if (v !== '') f[k] = v;
  });
  return f;
}
const wmDefaultFormBase = typeof wmDefaultForm === 'function' ? wmDefaultForm : null;
if (wmDefaultFormBase) wmDefaultForm = function () { return wmAutofillForm(wmDefaultFormBase()); };
const wmFormBase = typeof wmForm === 'function' ? wmForm : null;
if (wmFormBase) wmForm = function () { return wmAutofillForm(wmFormBase.apply(this, arguments)); };

/* --- 身体档案页（原「身体记录」+「身材管理」合并为一个板块） --- */
const ARCHIVE_METRIC = { weight: ['体重', 'kg'], sleep: ['睡眠时长', '小时'], energy: ['精力', '分'], mood: ['情绪', '分'] };

function archivePanel(key, title, content) {
  const open = !!(ui.archiveOpen && ui.archiveOpen[key]);
  const bodyId = 'archivePanel-' + key;
  return '<section class="panel archive-panel' + (open ? '' : ' is-collapsed') + '" data-archive-key="' + key + '">' +
    '<div class="archive-panel-head"><h2>' + esc(title) + '</h2>' +
    '<button type="button" class="archive-toggle" data-action="archive-toggle" data-key="' + key + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="' + bodyId + '">' +
    '<span>' + (open ? '收起' : '展开') + '</span><i aria-hidden="true"></i></button></div>' +
    '<div class="archive-panel-body" id="' + bodyId + '"' + (open ? '' : ' hidden') + '>' + content + '</div></section>';
}

function viewArchive() {
  let h = '';
  if (ui.wmForm) ui.wmForm = wmAutofillForm(ui.wmForm);
  /* 记录与趋势纵向排列，各自占满可用宽度；表单本身在宽屏使用两列。 */
  h += '<div class="archive-stack">' +
    archivePanel('record', '今日身体记录', archiveFormHtml()) +
    archivePanel('trend', '趋势追踪', archiveTrendHtml()) +
    '</div>';
  h += '<div class="archive-stack">' +
    archivePanel('shape', '身材管理', archiveShapeHtml()) +
    archivePanel('weight', '体重趋势', archiveWeightTrendHtml()) +
    '</div>';
  /* 经期模块位于「体重趋势」与「中医体质视角」之间，且仅女性用户可见 */
  if (isFemale()) h += periodSectionHtml();
  h += archivePanel('tcm', '中医体质视角下的体重管理', archiveTcmHtml()) +
    archivePanel('wm', '身材管理方案', archiveWmHtml());
  return h;
}

/* 每日身体情况录入表单 */
function archiveFormHtml() {
  const k = ui.recordDate || todayKey();
  const r = state.records[k] || {};
  /* 「月经不调」只对女性用户提供 */
  const SYMPTOMS = ['疲乏', '怕冷', '口干', '口苦', '腹胀', '便溏', '便秘', '失眠', '多梦', '头晕', '心悸', '胸闷', '易怒', '焦虑', '鼻塞', '皮肤瘙痒', '自汗']
    .concat(isFemale() ? ['月经不调'] : []);
  let h = '<div class="date-row"><button class="btn small ghost" data-action="date" data-d="-1">←</button>' +
    '<input type="date" id="recDate" value="' + k + '" data-action="datepick">' +
    '<button class="btn small ghost" data-action="date" data-d="1">→</button>' +
    '<button class="btn small" data-action="date" data-d="today">今天</button></div>';
  h += '<div class="form">' +
    '<label>体重（kg）<input type="number" step="0.1" id="f_weight" value="' + (r.weight || '') + '" placeholder="例：62.5"></label>' +
    '<label>睡眠时长<select id="f_sleep"><option value="">请选择</option>' +
    [[1.5, '1～2h'], [2.5, '2～3h'], [3.5, '3～4h'], [4.5, '4～5h'], [5.5, '5～6h'], [6.5, '6～7h'], [7.5, '7～8h'], [8.5, '8～9h'], [9.5, '9～10h'], [10.5, '10h以上']].map(function (o) {
      return '<option value="' + o[0] + '"' + (+r.sleep === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('') + '</select></label>' +
    '<label>入睡时间<input type="time" id="f_bedtime" value="' + (r.bedtime || '') + '"></label>' +
    '<label>精力 1-10<input class="wellness-range" type="range" id="f_energy" min="1" max="10" value="' + (r.energy || 5) + '"><output>' + (r.energy || 5) + '</output></label>' +
    '<label>情绪 1-10<input class="wellness-range" type="range" id="f_mood" min="1" max="10" value="' + (r.mood || 5) + '"><output>' + (r.mood || 5) + '</output></label>' +
    '<label>大便<select id="f_stool">' + ['', '成形', '黏滞', '干燥', '溏稀'].map(v => '<option' + (r.stool === v ? ' selected' : '') + ' value="' + v + '">' + (v || '请选择') + '</option>').join('') + '</select></label>' +
    '<label>舌象<select id="f_tongue">' + ['', '淡红苔薄白', '淡白苔白', '舌红少苔', '紫暗有瘀点', '舌胖苔厚腻', '舌红苔黄腻'].map(v => '<option' + (r.tongue === v ? ' selected' : '') + ' value="' + v + '">' + (v || '请选择') + '</option>').join('') + '</select></label>' +
    '</div>';
  h += '<div class="sym"><b>不适症状（可多选）</b><div class="chips pick">' +
    SYMPTOMS.map(s => '<button class="chip pickable' + ((r.symptoms || []).indexOf(s) > -1 ? ' on' : '') + '" data-action="symptom" data-v="' + s + '">' + s + '</button>').join('') +
    '</div></div>';
  h += '<label class="full">备注<textarea id="f_note" rows="2" placeholder="今日特殊感受、饮食异常、情绪事件等">' + esc(r.note || '') + '</textarea></label>';
  h += '<div class="qfoot"><button type="button" class="btn small ghost" data-action="archive-history-toggle" aria-expanded="' + (ui.archiveHistoryOpen ? 'true' : 'false') + '" aria-controls="archiveRecordHistory">' +
    (ui.archiveHistoryOpen ? '收起历史记录' : '查看历史记录') + '</button><button class="btn" data-action="saverec">保存今日记录</button></div>';
  h += '<div class="archive-inline-history" id="archiveRecordHistory" aria-live="polite"' + (ui.archiveHistoryOpen ? '' : ' hidden') + '>' +
    '<h3>历史身体记录</h3><div class="archive-history-scroll">' + archiveHistoryHtml() + '</div></div>';
  return h;
}

/* 睡眠 / 精力 / 情绪 / 体重 趋势 */
function archiveTrendHtml() {
  const count = Object.keys(state.records).filter(k => +(state.records[k] || {})[ui.metric] > 0).length;
  let h = '<div class="chips pick trend-picks">' + Object.keys(ARCHIVE_METRIC).map(m =>
    '<button class="chip pickable' + (ui.metric === m ? ' on' : '') + '" data-action="metric" data-v="' + m + '">' + ARCHIVE_METRIC[m][0] + '</button>').join('') + '</div>';
  h += '<div class="chart-wrap">' + (count < 2 ? emptyTrendSvg(ui.metric, 0) : lineSvg(state.records, ui.metric)) + '</div>';
  h += '<p class="muted small">单位：' + ARCHIVE_METRIC[ui.metric][1] + '　·　显示最近 14 条有效记录</p>';
  return h;
}

/* 身材管理：BMI 指标卡 + 分级建议 + 目标进度 + 身高 / 目标设置 */
function archiveShapeHtml() {
  const logs = weightLogs();
  const last = logs.length ? logs[logs.length - 1] : null;
  const first = logs.length ? logs[0] : null;
  const curr = last ? last.kg : 0;
  const cm = +state.profile.height || 0;
  const bmi = bmiOf(curr, cm);
  const band = bmi ? bmiBand(bmi) : null;
  const rng = idealRange(cm);
  const goal = +state.weight.goal || 0;

  let h = '<div class="wgrid">' +
    '<div class="wcard"><em>当前体重</em><b>' + (curr ? curr.toFixed(1) + ' <span>kg</span>' : '—') + '</b>' +
    '<i>' + (last ? last.k : '暂无记录') + '</i></div>' +
    '<div class="wcard"><em>BMI</em><b>' + (bmi ? bmi.toFixed(1) : '—') + '</b>' +
    '<i>' + (band ? band.label : '需填身高') + '</i></div>' +
    '<div class="wcard"><em>目标体重</em><b>' + (goal ? goal.toFixed(1) + ' <span>kg</span>' : '—') + '</b>' +
    '<i>' + (goal && curr ? '还差 ' + Math.abs(curr - goal).toFixed(1) + ' kg' : '未设置') + '</i></div>' +
    '<div class="wcard"><em>累计变化</em><b>' + (logs.length > 1 ? ((curr - first.kg) > 0 ? '+' : '') + (curr - first.kg).toFixed(1) + ' <span>kg</span>' : '—') + '</b>' +
    '<i>' + (first ? '自 ' + first.k + ' 起' : '需两次记录') + '</i></div>' +
    '</div>';

  if (band) h += '<p class="wm-band" style="border-left-color:' + band.color + '"><b>' + band.label + '</b>' + esc(band.advice) +
    (rng[0] ? '　理想体重区间 ' + rng[0].toFixed(1) + '–' + rng[1].toFixed(1) + ' kg。' : '') + '</p>';

  if (goal && first && logs.length > 1 && first.kg !== goal) {
    const pct = clamp((first.kg - curr) / (first.kg - goal), 0, 1);
    h += '<div class="wprog"><div class="wprog-bar"><i style="width:' + Math.round(pct * 100) + '%"></i></div>' +
      '<span>目标进度 ' + Math.round(pct * 100) + '%　（起始 ' + first.kg.toFixed(1) + ' kg → 目标 ' + goal.toFixed(1) + ' kg）</span></div>';
  }

  h += '<h3>档案设置</h3><div class="form">' +
    '<label>身高（cm）<input type="number" step="0.5" id="w_height" value="' + (state.profile.height || '') + '" placeholder="例：168"></label>' +
    '<label>目标体重（kg）<input type="number" step="0.1" id="w_goal" value="' + (state.weight.goal || '') + '" placeholder="例：60"></label>' +
    '</div><div class="qfoot"><span class="muted small">身高与目标体重同时用于计算 BMI、理想区间与进度。</span>' +
    '<button class="btn small" data-action="saveprofile">保存档案</button></div>';
  return h;
}

/* 体重折线 + 近期统计 + 记录列表 */
function archiveWeightTrendHtml() {
  const logs = weightLogs();
  const goal = +state.weight.goal || 0;
  let h = '<div class="chart-wrap">' + weightLineSvg(logs, goal) + '</div>';
  if (!logs.length) return h + '<p class="muted small">在「今日身体记录」中录入至少两天体重数据即可生成趋势。</p>';
  const curr = logs[logs.length - 1].kg;
  const recent = logs.slice(-5);
  const avg = recent.reduce((s, p) => s + p.kg, 0) / recent.length;
  const prev = logs.length > 1 ? logs[logs.length - 2].kg : null;
  h += '<p class="muted small">近 ' + recent.length + ' 次平均 ' + avg.toFixed(1) + ' kg' +
    (prev ? '　·　较上次 ' + ((curr - prev) > 0 ? '+' : '') + (curr - prev).toFixed(1) + ' kg' : '') +
    '　·　共 ' + logs.length + ' 条记录</p>';
  h += '<div class="hist">' + logs.slice().reverse().slice(0, 20).map(p =>
    '<div class="hist-item"><b>' + p.k + '</b><span>' + p.kg.toFixed(1) + ' kg' + (p.fat ? '　体脂 ' + p.fat.toFixed(1) + '%' : '') + '</span>' +
    '<button class="del" data-action="delw" data-k="' + p.k + '">删除</button></div>').join('') + '</div>';
  return h;
}

/* ================= 经期模块（仅女性用户可见） =================
 * 记录只针对「今天」：填了「今天是经期第几天」后反推开始日期，
 * 并把「开始日 → 记录日」整段同步到经期日历，用红色圆点标记，颜色越深表示当日越不适。
 */
function periodLogs() { return (state.period && state.period.logs) || {}; }
function periodStartOf(k, day) { return shiftDay(k, -((+day || 1) - 1)); }

/* 综合严重程度 0–1：出血量 0.4 + 不适感 0.3 + 痛经 0.3 */
function periodSeverity(r) {
  const flow = (PERIOD_FLOW_W[r.flow] || 0) / 4;
  const sore = (PERIOD_SORE_W[r.sore] || 0) / 3;
  const pain = r.pain === 'yes' ? (PERIOD_PAIN_W[r.painLevel] || 1) / 3 : 0;
  return clamp(flow * 0.4 + sore * 0.3 + pain * 0.3, 0, 1);
}
/* 由重到深：最深 #962A1C → 最浅 #E4A89B（保留最低可见度，避免浅到看不见） */
function periodColor(t) {
  const a = [150, 42, 28], b = [228, 168, 155];
  const v = 0.18 + clamp(t, 0, 1) * 0.82;
  return 'rgb(' + a.map((x, i) => Math.round(x + (b[i] - x) * (1 - v))).join(',') + ')';
}
/* 把每条记录展开成经期区间：{ 'YYYY-MM-DD': 严重程度 } */
function periodDayMap() {
  const map = {};
  const logs = periodLogs();
  Object.keys(logs).sort().forEach(k => {
    const r = logs[k] || {};
    const sev = periodSeverity(r);
    const start = r.start || periodStartOf(k, r.day);
    let cur = start, guard = 0;
    while (cur <= k && guard++ < 40) {
      if (!(cur in map) || map[cur] < sev) map[cur] = sev;
      cur = shiftDay(cur, 1);
    }
  });
  return map;
}
/* 表单草稿：优先用今日已保存的记录回填 */
function periodDraft() {
  if (ui.period) return ui.period;
  const r = periodLogs()[todayKey()];
  ui.period = r
    ? { day: r.day || '', flow: r.flow || '', sore: r.sore || '', pain: r.pain || '', painLevel: r.painLevel || '' }
    : { day: '', flow: '', sore: '', pain: '', painLevel: '' };
  return ui.period;
}
function pdChips(act, opts, val) {
  return '<div class="chips pick">' + opts.map(o =>
    '<button class="chip pickable' + (val === o[0] ? ' on' : '') + '" data-action="' + act + '" data-v="' + o[0] + '">' + o[1] + '</button>').join('') + '</div>';
}
function pdField(title, inner) {
  return '<div class="pd-field"><b>' + title + '</b>' + inner + '</div>';
}

/* ---- 月经周期：自动推算 + 手动修改 + 下次预计 ---- */
/* 各次经期的开始日期（去重后升序） */
function periodStarts() {
  const logs = periodLogs(), set = {};
  Object.keys(logs).forEach(k => {
    const r = logs[k] || {};
    const s = r.start || periodStartOf(k, r.day);
    if (s) set[s] = 1;
  });
  return Object.keys(set).sort();
}
/* 相邻两次开始日期的间隔平均值（只取 20–40 天的合理区间），不足两条记录返回 0 */
function periodAutoCycle() {
  const s = periodStarts();
  if (s.length < 2) return 0;
  const gaps = [];
  for (let i = 1; i < s.length; i++) {
    const g = Math.round((parseKey(s[i]) - parseKey(s[i - 1])) / 86400000);
    if (g >= PERIOD_CYCLE_MIN && g <= PERIOD_CYCLE_MAX) gaps.push(g);
  }
  if (!gaps.length) return 0;
  return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
}
function periodCycleOk() {
  const n = +((state.period && state.period.cycle));
  return n >= PERIOD_CYCLE_MIN && n <= PERIOD_CYCLE_MAX && Math.floor(n) === n;
}
function periodCycle() { return periodCycleOk() ? +state.period.cycle : PERIOD_CYCLE_DEFAULT; }
/* 未手动改过且有两次以上记录时自动回填；返回是否发生变化 */
function periodSyncCycle() {
  if (!state.period || state.period.cycleMan) return false;
  const auto = periodAutoCycle();
  if (auto > 0 && +state.period.cycle !== auto) { state.period.cycle = auto; return true; }
  return false;
}
/* 下一次经期预计：最近一次开始日期 + 当前周期天数 */
function periodNext() {
  const s = periodStarts();
  if (!s.length) return null;
  const last = s[s.length - 1], cyc = periodCycle();
  const next = shiftDay(last, cyc);
  return {
    last: last, cycle: cyc, next: next, count: s.length, auto: periodAutoCycle(),
    days: Math.round((parseKey(next) - parseKey(todayKey())) / 86400000)
  };
}
function periodNextText() {
  const nx = periodNext();
  if (!nx) return '还没有经期记录。填写后这里会按「最近一次开始日期 + 周期天数」推算下次预计日期。';
  const tail = nx.days > 0 ? '还有 ' + nx.days + ' 天' : (nx.days === 0 ? '就在今天' : '已推迟 ' + (-nx.days) + ' 天，若本次已来潮请在左侧补记');
  let t = '最近一次开始于 ' + nx.last + '，周期 ' + nx.cycle + ' 天，预计下次经期 ' + nx.next + '（' + tail + '）。';
  if (nx.auto > 0) t += '周期由 ' + nx.count + ' 次记录自动推算（相邻两次开始日期的间隔），可手动修改。';
  else t += '再记录一次后，会自动按相邻两次的间隔推算周期。';
  return t;
}

/* 经期记录（左） */
function periodRecordHtml() {
  const d = periodDraft();
  const saved = periodLogs()[todayKey()];
  /* 未手动改过周期时，先按已有记录回填一次 */
  if (periodSyncCycle()) save();
  const auto = periodAutoCycle();
  const cycRaw = (state.period && state.period.cycle !== undefined && state.period.cycle !== '') ? state.period.cycle : PERIOD_CYCLE_DEFAULT;
  const cycHint = state.period && state.period.cycleMan
    ? '已手动设置为 ' + cycRaw + ' 天，点「按记录重算」可恢复自动推算。'
    : (auto > 0 ? '已根据 ' + periodStarts().length + ' 次记录自动推算为 ' + auto + ' 天，可手动修改。'
      : '记录满 2 次后，会按相邻两次经期开始日期的间隔自动推算，也可随时手动填写。');
  let h = '<p class="muted">只在来经期的当天填写，非经期不必记录。填好「今天是第几天」会自动推出本次经期的开始日期，并同步到右侧日历。</p>';
  if (saved) {
    h += '<p class="pd-saved">今日已记录：经期第 ' + esc(saved.day) + ' 天　·　本次开始于 ' + esc(saved.start || periodStartOf(todayKey(), saved.day)) + '</p>';
  }
  h += pdField('今天是经期第几天',
    '<div class="chips pick">' + PERIOD_DAYS.map(n =>
      '<button class="chip pickable' + (+d.day === n ? ' on' : '') + '" data-action="pd-day" data-v="' + n + '">' + n + '</button>').join('') + '</div>' +
    '<label class="pd-input">或直接输入<input type="number" min="1" max="7" step="1" class="pdinput" data-f="day" value="' + esc(d.day) + '" placeholder="1–7"></label>');
  h += pdField('出血量', pdChips('pd-flow', PERIOD_FLOW, d.flow));
  h += pdField('不适感（疲惫、酸痛等）', pdChips('pd-sore', PERIOD_SORE, d.sore));
  h += pdField('是否痛经', pdChips('pd-pain', [['no', '否'], ['yes', '是']], d.pain));
  /* 只有选「是」才追加疼痛程度 */
  if (d.pain === 'yes') h += pdField('疼痛程度', pdChips('pd-painlevel', PERIOD_PAIN_LEVEL, d.painLevel));
  h += pdField('周期',
    '<div class="pd-cycle-row"><label class="pd-cycle"><input type="number" inputmode="numeric" min="' + PERIOD_CYCLE_MIN + '" max="' + PERIOD_CYCLE_MAX + '" step="1" class="pdinput" data-f="cycle" value="' + esc(cycRaw) + '"><span>天</span></label>' +
    '<button class="btn small ghost" data-action="pd-cycle-auto">按记录重算</button></div>' +
    '<p class="muted small">' + esc(cycHint) + '</p>' +
    '');
  if (ui.periodErr) h += '<p class="pd-err">' + esc(ui.periodErr) + '</p>';
  h += '<div class="qfoot"><span class="muted small">' + (cloudOn() ? '保存后同步到账号，可在其他设备恢复。' : '数据仅存本机，换设备不会同步。') + '</span>' +
    '<span class="pd-ops">' +
    (saved ? '<button class="btn small danger" data-action="delperiod">删除今日记录</button>' : '') +
    '<button class="btn" data-action="saveperiod">保存经期记录</button></span></div>';
  return h;
}

/* 经期日历（右） */
function shiftMonth(km, n) {
  const d = new Date(+km.slice(0, 4), +km.slice(5, 7) - 1 + n, 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}
function periodCalendarHtml() {
  const map = periodDayMap();
  const nx = periodNext();
  const mk = ui.periodMonth || todayKey().slice(0, 7);
  const y = +mk.slice(0, 4), m = +mk.slice(5, 7);
  const lead = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const tk = todayKey();

  let h = '<div class="date-row period-month-nav"><button class="btn small ghost" data-action="pcal-month" data-d="-1">←</button>' +
    '<b class="pcal-title">' + y + ' 年 ' + m + ' 月</b>' +
    '<button class="btn small ghost" data-action="pcal-month" data-d="1">→</button>' +
    '<button class="btn small" data-action="pcal-month" data-d="0">本月</button></div>';
  h += '<div class="pcal"><div class="pcal-head">' +
    ['日', '一', '二', '三', '四', '五', '六'].map(w => '<span>' + w + '</span>').join('') + '</div><div class="pcal-grid">';
  for (let i = 0; i < lead; i++) h += '<div class="pcal-cell empty"></div>';
  for (let i = 1; i <= days; i++) {
    const k = mk + '-' + pad(i);
    const sev = map[k];
    const on = typeof sev === 'number';
    const isNext = !!(nx && k === nx.next && !on);
    h += '<div class="pcal-cell' + (on ? ' on' : '') + (isNext ? ' next' : '') + (k === tk ? ' today' : '') + '">' +
      '<span class="pdot"' + (on ? ' style="background:' + periodColor(sev) + '"' : '') +
      ' title="' + k + (on ? '　经期　不适程度 ' + Math.round(sev * 100) + '%' : isNext ? '　预计下次经期' : '') + '">' + i + '</span></div>';
  }
  h += '</div></div>';
  h += '<p class="pcal-legend">颜色越深表示当日越不适：' +
    [1, 0.55, 0.1].map(t => '<i style="background:' + periodColor(t) + '"></i>').join('') +
    '<span>由重到轻</span>' +
    (nx ? '<i class="pd-next-dot"></i><span>预计下次经期</span>' : '') + '</p>';
  const n = Object.keys(map).length;
  h += '<p class="muted small">' + (n ? '已根据记录标记 ' + n + ' 个经期日。' : '还没有经期记录，在左侧填写后这里会自动标红。') + '</p>';
  h += '<p class="pcal-next">' + esc(periodNextText()) + '</p>';
  return h;
}

/* 经期板块：记录与日历上下排列，各自使用完整页面宽度。 */
function periodSectionHtml() {
  return '<div class="period-stack">' +
    archivePanel('periodRecord', '经期记录', periodRecordHtml()) +
    archivePanel('periodCalendar', '经期日历', periodCalendarHtml()) +
    '</div>';
}

/* 校验：缺哪一项就提示哪一项 */
function periodValidate(d) {
  const day = +d.day;
  if (!d.day || !(day >= 1 && day <= 7) || Math.floor(day) !== day) return { ok: false, msg: '请填写今天是经期第几天，需为 1–7 的整数' };
  if (!d.flow) return { ok: false, msg: '请选择出血量程度' };
  if (!d.sore) return { ok: false, msg: '请选择不适感程度' };
  if (!d.pain) return { ok: false, msg: '请选择是否痛经' };
  if (d.pain === 'yes' && !d.painLevel) return { ok: false, msg: '请选择疼痛程度' };
  return { ok: true, msg: '' };
}
function periodSave() {
  const d = periodDraft();
  const v = periodValidate(d);
  if (!v.ok) { ui.periodErr = v.msg; render(); toast(v.msg); return; }
  if (!periodCycleOk()) {
    const m = '请填写周期，需为 ' + PERIOD_CYCLE_MIN + '–' + PERIOD_CYCLE_MAX + ' 之间的整数（天）';
    ui.periodErr = m; render(); toast(m); return;
  }
  const day = +d.day;
  const k = todayKey();
  const start = periodStartOf(k, day);
  state.period = state.period || { logs: {} };
  state.period.logs = state.period.logs || {};
  state.period.logs[k] = { day: day, flow: d.flow, sore: d.sore, pain: d.pain, painLevel: d.pain === 'yes' ? d.painLevel : '', start: start };
  /* 记满两次后按相邻开始日期自动回填周期（手动改过则保留用户输入） */
  periodSyncCycle();
  ui.periodErr = '';
  ui.period = null;
  ui.periodMonth = k.slice(0, 7);
  save(); render();
  toast('已记录：经期第 ' + day + ' 天（本次开始于 ' + start + '）');
}

/* 中医体质视角 */
function archiveTcmHtml() {
  const a = state.assessment;
  const cid = a ? a.primary : null;
  const c = cid ? CONSTITUTIONS[cid] : null;
  if (!c) {
    return '<p class="muted">完成体质测评后，这里会给出与您体质匹配的体重管理要点。</p>' +
      '<button class="btn small" data-action="go" data-page="assess">去测评</button>';
  }
  return '<p class="wm-band tcm-band" style="border-left-color:' + c.color + '"><b>' + esc(c.name) + '</b>' + esc(WM_TIPS[cid] || '') + '</p>' +
    '<p class="note">中医认为「肥人多痰湿、瘦人多虚火」，体重管理须与体质同调：痰湿、气虚质以健脾化湿、缓步有氧为先；阴虚、气郁质忌峻下与过度节食。本节为养生参考，不替代医师诊断。</p>';
}

/* ================= 体重管理方案：页面内一步生成 =================
 * 体重分类：国家卫健委《体重管理指导原则（2024 年版）》成人 BMI 标准；
 * 健康增重：NHS 建议在平衡膳食基础上每天增加约 300–500 kcal，并配合力量训练；
 * 增肌训练：CDC / ACSM 建议每周至少 2 天肌力训练；训练人群蛋白质按 1.4–2.0 g/kg/天范围取中值；
 * 减重：每天约 500 kcal 缺口，但不低于基础代谢、不低于男 1500 / 女 1200 kcal。
 */
const WM_ACTIVITY = [
  { id: 'sed', label: '久坐：办公室为主，几乎不运动', f: 1.2 },
  { id: 'light', label: '轻度活跃：每周 1–3 次轻量活动', f: 1.375 },
  { id: 'mod', label: '中度活跃：每周 3–5 次中等强度运动', f: 1.55 },
  { id: 'high', label: '高度活跃：体力工作或几乎天天训练', f: 1.725 }
];
const WM_GOALS = [
  { id: 'auto', label: '自动判断（按当前与目标体重）' },
  { id: 'lose', label: '减脂减重' },
  { id: 'keep', label: '维持塑形' },
  { id: 'muscle', label: '增重增肌' }
];
const WM_DAYS = ['0 天：先从日常活动开始', '1 天', '2 天', '3 天', '4 天', '5 天', '6 天', '7 天'];
const WM_LIKES = ['清淡少油', '无肉不欢', '主食偏多', '甜饮奶茶', '重口味偏咸', '夜宵习惯', '素食为主', '外卖为主'];
const WM_AVOIDS = ['海鲜过敏', '牛羊肉不碰', '辛辣忌口', '乳制品不耐', '坚果过敏', '豆制品忌口'];
const WM_LIKE_TIP = {
  '清淡少油': '少油是对的，但别把蛋白一起砍掉：每天保证上面的蛋白质量，主食可以用粗粮替换一半。',
  '无肉不欢': '优先鱼虾、禽肉、瘦肉，红肉每周不超过 3 次，烹饪前去掉可见脂肪与皮。',
  '主食偏多': '主食先减 1/3，且先减精米白面：一半换成燕麦、糙米、红薯、玉米，饱腹感更好。',
  '甜饮奶茶': '甜饮奶茶是最容易让热量超标的一项：每周不超过 1 杯，选无糖或少糖，日常换成白水、无糖茶、黑咖啡。',
  '重口味偏咸': '重盐会让体重「虚高」（水肿）：用醋、柠檬、葱姜蒜与香辛料替代一部分盐，每天盐不超过 5 g。',
  '夜宵习惯': '把夜宵换成无糖酸奶、小番茄或黄瓜，并安排在睡前 2 小时前吃完；晚间热量最容易囤积。',
  '素食为主': '重点关注蛋白与微量元素：豆制品 + 蛋奶搭配，必要时补充维生素 B12 与铁。',
  '外卖为主': '点单时备注「少油少盐」，主食减半、另加一份青菜，汤汁和酱料单独放、不拌饭。'
};
const WM_AVOID_TIP = {
  '海鲜过敏': '蛋白来源换成禽肉、瘦肉与豆制品，外食注意酱料里可能含海鲜成分。',
  '牛羊肉不碰': '用鸡肉、鱼、豆制品替代，同时注意补铁（瘦肉、菠菜 + 富含维 C 的水果一起吃）。',
  '辛辣忌口': '用葱姜蒜、少量花椒提味，避开辣酱、火锅底料与重辣预制菜，外食优先清蒸、炖煮。',
  '乳制品不耐': '改用无乳糖奶、豆浆或燕麦奶；补钙靠豆腐、深绿色蔬菜、小鱼干。',
  '坚果过敏': '烹饪用普通植物油即可，避开坚果酱、坚果碎点缀与含坚果的烘焙食品。',
  '豆制品忌口': '植物蛋白用藜麦、蛋奶与瘦肉补足，注意膳食纤维也要跟上（全谷 + 蔬菜）。'
};

/* 表单草稿：优先用上次提交过的内容，否则从登录资料 / 档案 / 最近体重预填 */
function wmDefaultForm() {
  const logs = weightLogs();
  const last = logs.length ? logs[logs.length - 1] : null;
  let g = '';
  if (state.user && (state.user.gender === 'female' || state.user.gender === 'male')) g = state.user.gender;
  else if (state.profile.gender === '男') g = 'male';
  else if (state.profile.gender === '女') g = 'female';
  const age = (state.user && state.user.age) ? String(state.user.age) : (state.profile.age || '');
  return {
    gender: g, age: age,
    height: state.profile.height ? String(state.profile.height) : '',
    weight: last ? last.kg.toFixed(1) : '',
    target: state.weight.goal ? String(state.weight.goal) : '',
    goalMode: 'auto', activity: 'sed', days: '3',
    likes: [], avoids: [], avoidText: ''
  };
}
function wmForm() {
  if (!ui.wmForm) {
    ui.wmForm = Object.assign(wmDefaultForm(), state.weight.form || {});
    if (!Array.isArray(ui.wmForm.likes)) ui.wmForm.likes = [];
    if (!Array.isArray(ui.wmForm.avoids)) ui.wmForm.avoids = [];
  }
  return ui.wmForm;
}
function wmAct(id) { return WM_ACTIVITY.filter(a => a.id === id)[0] || WM_ACTIVITY[0]; }
function wmGoal(id) { return WM_GOALS.some(g => g.id === id) ? id : 'auto'; }
/* 用户一改输入就撤掉上一次的报错提示，避免提示与当前内容不符 */
function wmClearErr() {
  if (!ui.wmErr && !ui.wmBad && !ui.wmStateErr) return;
  ui.wmErr = ''; ui.wmStateErr = ''; ui.wmBad = '';
  const e = $('#wmErr');
  if (e) { e.hidden = true; e.textContent = ''; }
  const stateErr = $('.wm-state.err');
  if (stateErr) stateErr.remove();
  $$('.bad').forEach(x => x.classList.remove('bad'));
}

/* 目标体重填写时即时检查健康区间，避免用户点生成后才看到可预防的问题。 */
function wmLiveTargetCheck() {
  const f = wmForm();
  const h = +f.height, t = +f.target;
  let msg = '';
  if (isFinite(h) && h >= 100 && h <= 250 && isFinite(t) && t >= 30 && t <= 300) {
    const tb = bmiOf(t, h), rng = idealRange(h);
    if (tb < 18.5) {
      msg = '目标体重对应的 BMI 只有 ' + tb.toFixed(1) + '，已属偏瘦，不建议作为减重目标；按身高 ' + h + ' cm 计算，健康区间约 ' + rng[0].toFixed(1) + '–' + rng[1].toFixed(1) + ' kg，请修改目标体重。';
    } else if (tb >= 28) {
      msg = '目标体重对应的 BMI 为 ' + tb.toFixed(1) + '，仍在肥胖区间；建议先定到健康区间（' + rng[0].toFixed(1) + '–' + rng[1].toFixed(1) + ' kg）内，请修改目标体重。';
    }
  }
  ui.wmErr = msg;
  ui.wmStateErr = '';
  ui.wmBad = msg ? 'wm_target' : '';
  const e = $('#wmErr'), input = $('#wm_target');
  if (e) { e.hidden = !msg; e.textContent = msg; }
  if (input) input.classList.toggle('bad', !!msg);
}

/* 校验：缺项或格式错误都给出可执行的明确提示 */
function wmValidate(f) {
  const num = v => (v === '' || v == null) ? NaN : +v;
  const inRange = (v, lo, hi) => { const n = num(v); return (isFinite(n) && n >= lo && n <= hi) ? Math.round(n * 10) / 10 : NaN; };
  if (f.gender !== 'female' && f.gender !== 'male') return { ok: false, id: 'wm_gender', msg: '请选择性别：男 / 女。' };
  const age = inRange(f.age, 14, 100);
  if (!isFinite(age)) return { ok: false, id: 'wm_age', msg: '请填写年龄，需为 14–100 之间的数字（周岁）。' };
  const h = inRange(f.height, 100, 250);
  if (!isFinite(h)) return { ok: false, id: 'wm_height', msg: '请填写身高，需为 100–250 之间的数字（cm）。' };
  const w = inRange(f.weight, 30, 300);
  if (!isFinite(w)) return { ok: false, id: 'wm_weight', msg: '请填写当前体重，需为 30–300 之间的数字（kg）。' };
  const t = inRange(f.target, 30, 300);
  if (!isFinite(t)) return { ok: false, id: 'wm_target', msg: '请填写目标体重，需为 30–300 之间的数字（kg）。' };
  const tb = bmiOf(t, h), rng = idealRange(h);
  if (tb < 18.5) {
    return { ok: false, id: 'wm_target', msg: '目标体重对应的 BMI 只有 ' + tb.toFixed(1) + '，已属偏瘦，不建议作为减重目标；按身高 ' + h + ' cm 计算，健康区间约 ' + rng[0].toFixed(1) + '–' + rng[1].toFixed(1) + ' kg。' };
  }
  if (tb >= 28) {
    return { ok: false, id: 'wm_target', msg: '目标体重对应的 BMI 为 ' + tb.toFixed(1) + '，仍在肥胖区间；建议先定到 ' + (23.9 * (h / 100) * (h / 100)).toFixed(1) + ' kg（BMI 正常上限）左右。' };
  }
  const goalMode = wmGoal(f.goalMode);
  if (goalMode === 'lose' && t >= w - 0.5) {
    return { ok: false, id: 'wm_target', msg: '你选择了“减脂减重”，目标体重应低于当前体重至少 0.5 kg；如希望体重不变，请改选“维持塑形”。' };
  }
  if (goalMode === 'keep' && Math.abs(t - w) >= 0.5) {
    return { ok: false, id: 'wm_target', msg: '你选择了“维持塑形”，目标体重应与当前体重接近（相差小于 0.5 kg）。' };
  }
  if (goalMode === 'muscle' && t < w - 0.5) {
    return { ok: false, id: 'wm_target', msg: '你选择了“增重增肌”，目标体重不应低于当前体重；如要减脂，请改选“减脂减重”。' };
  }
  if (!WM_ACTIVITY.some(a => a.id === f.activity)) return { ok: false, id: 'wm_activity', msg: '请选择日常活动量，用于估算每日消耗。' };
  const d = inRange(f.days, 0, 7);
  if (!isFinite(d)) return { ok: false, id: 'wm_days', msg: '请选择每周能安排的运动天数（0–7 天）。' };
  return {
    ok: true,
    form: {
      gender: f.gender, age: Math.round(age), height: h, weight: w, target: t, goalMode: goalMode,
      activity: f.activity, days: Math.round(d),
      likes: (f.likes || []).slice(), avoids: (f.avoids || []).slice(),
      avoidText: String(f.avoidText || '').trim()
    }
  };
}

function wmConstitutionTip() {
  const a = state.assessment;
  if (a && WM_TIPS[a.primary]) return '你的主导体质是' + CONSTITUTIONS[a.primary].name + '：' + WM_TIPS[a.primary];
  return '还没做体质测评，先按通用原则执行：三餐定时、每餐七分饱、每晚睡够 7 小时。做完测评后这里会换成贴合你体质的饮食要点。';
}

/* 依据表单生成结构化方案 */
function buildWeightPlan(f) {
  const male = f.gender === 'male';
  const h = +f.height, w = +f.weight, tgt = +f.target, age = +f.age, days = +f.days;
  const act = wmAct(f.activity);
  const bmi = bmiOf(w, h), tbmi = bmiOf(tgt, h);
  const band = bmiBand(bmi), tband = bmiBand(tbmi), rng = idealRange(h);
  const bmr = Math.round(10 * w + 6.25 * h - 5 * age + (male ? 5 : -161));
  const tdee = Math.round(bmr * act.f);
  const diff = Math.round((tgt - w) * 10) / 10;
  const goalMode = wmGoal(f.goalMode);
  const inferred = diff <= -0.5 ? 'lose' : (diff >= 0.5 ? 'muscle' : 'keep');
  const intent = goalMode === 'auto' ? inferred : goalMode;
  const mode = intent === 'lose' ? 'lose' : (intent === 'muscle' && diff >= 0.5 ? 'gain' : 'keep');
  const muscleFocus = intent === 'muscle';

  const floorKcal = male ? 1500 : 1200;
  let kcal = tdee, slowNote = '';
  if (mode === 'lose') {
    kcal = Math.round(tdee - 500);
    const low = Math.max(bmr, floorKcal);
    if (kcal < low) { kcal = low; slowNote = '热量已按健康下限取 ' + low + ' kcal（不低于基础代谢），减重会慢一些，不要再往下压。'; }
  } else if (mode === 'gain') { kcal = Math.round(tdee + 350); }

  const refW = mode === 'lose' ? tgt : w;
  const protein = Math.round(refW * (muscleFocus ? 1.6 : (mode === 'lose' ? 1.5 : 1.2)));
  const fat = Math.round(kcal * 0.27 / 9);
  const carb = Math.max(60, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const perWeek = mode === 'lose' ? Math.min(0.5, Math.max(0.25, Math.round(w * 0.0075 * 10) / 10)) : 0.25;
  let weeks = mode === 'keep' ? 4 : Math.ceil(Math.abs(diff) / perWeek);
  weeks = Math.max(4, Math.min(52, weeks));

  const s1 = 2, s3 = weeks >= 8 ? 4 : (weeks >= 6 ? 2 : 0), s2 = Math.max(1, weeks - s1 - s3);
  const stageN = [s1, s2, s3];
  const stageName = ['启动期', '推进期', '巩固期'];
  const stageText = mode === 'lose' ? [
    '先用两周把三餐时间、份量和称重习惯固定下来，运动量维持原样，别一上来又少吃又猛练。',
    '按热量缺口与运动安排执行，每周复盘一次：体重看两周平均，体型看腰围，状态看精力与睡眠。',
    '把每日热量回调 100–200 kcal 到维持水平，体重稳定 4 周以上再考虑下一轮，避免反弹。'
  ] : muscleFocus ? [
    '先用两周固定三餐与加餐、补足蛋白质，并熟悉力量动作；不要靠甜饮、油炸食品突击增重。',
    '按目标热量执行，力量训练逐步增加次数或阻力；每 2–4 周结合体重、腰围和训练表现复盘一次。',
    '达到目标后把热量逐步调回维持水平，继续力量训练 4 周以上，让新增体重更稳定。'
  ] : [
    '先用两周固定三餐、睡眠与称重条件，记录体重和腰围的自然波动。',
    '热量保持在日常消耗附近，以力量训练和规律活动改善体型；每两周看一次平均趋势。',
    '维持当前饮食与活动节奏，若体重连续两周偏离目标，再小幅调整每日 100–200 kcal。'
  ];
  const stages = [];
  for (let i = 0; i < 3; i++) {
    if (stageN[i] <= 0) continue;
    const from = stageN.slice(0, i).reduce((a, b) => a + b, 0) + 1;
    stages.push({ name: stageName[i] + '（第 ' + from + '–' + (from + stageN[i] - 1) + ' 周）', text: stageText[i] });
  }

  const mealRatio = mode === 'gain' ? [0.25, 0.35, 0.3] : [0.3, 0.4, 0.3];
  const mKcal = mealRatio.map(r => Math.round(kcal * r / 10) * 10);
  const headLine = '每日目标约 ' + kcal + ' kcal（基础代谢 ' + bmr + ' × 活动系数 ' + act.f + '，日常消耗约 ' + tdee + ' kcal）' +
    (mode === 'lose' ? '，相当于每天留出约 500 kcal 缺口。' : mode === 'gain' ? '，相当于每天多摄入约 350 kcal。' : '，吃到消耗量即可维持目前体重。');
  const diet = [];
  diet.push({
    t: '每天吃多少', l: [headLine].concat([
      '三餐分配：早餐约 ' + mKcal[0] + ' kcal、午餐约 ' + mKcal[1] + ' kcal、晚餐约 ' + mKcal[2] + ' kcal；' +
      (mode === 'gain' ? '其余约 10% 安排为 1–2 次加餐，放在两餐之间或训练后。' : '加餐放在上午或下午，尽量别留到睡前。')
    ]).concat(slowNote ? [slowNote] : [])
  });
  const mealGuide = mode === 'gain' ? [
    '早餐：蛋奶或豆制品 + 足量主食 + 一份蔬果；吃不下大份量时，可拆成早餐和上午加餐。',
    '午餐和晚餐：每餐保证一掌心蛋白、一拳以上主食和蔬菜，不要为了“清淡”把主食与脂肪一起砍掉。',
    '加餐优先牛奶 / 无糖酸奶、鸡蛋、全麦面包、坚果或豆制品；有忌口时按下方替换建议执行。',
    '每日额外热量来自营养密度高的正常食物，不靠奶茶、蛋糕和油炸食品凑热量。'
  ] : muscleFocus ? [
    '三餐都安排蛋白质，训练前后的一餐同时保留主食，帮助训练与恢复。',
    '每餐以蔬菜、优质蛋白和粗细搭配主食为基础，不用极端低碳，也不用额外堆高热量。',
    '训练后 2 小时内正常吃一餐；来不及正餐时，可先用奶 / 豆浆搭配鸡蛋或全麦面包。',
    '体重保持稳定的同时，若训练重量或次数提高、腰围不快速增加，就说明方向基本合适。'
  ] : [
    '早餐：一份蛋白（鸡蛋 1–2 个 / 无糖豆浆 250 ml）+ 一份主食（燕麦、全麦面包或杂粮粥）+ 一份蔬果。',
    '午餐：半盘蔬菜 + 一掌心蛋白（瘦肉、鱼虾、禽肉或豆制品）+ 一拳主食（粗细粮各半）。',
    '晚餐：蔬菜为主 + 半掌心蛋白 + 半拳主食，尽量在睡前 3 小时吃完。',
    '每天烹饪油控制在 2–3 白瓷勺（约 25–30 g），盐不超过 5 g；先吃菜和蛋白、最后吃主食，更耐饿。'
  ];
  diet.push({ t: '每餐怎么搭', l: mealGuide });
  diet.push({
    t: '三大营养素', l: [
      '蛋白质约 ' + protein + ' g/天（' + (muscleFocus ? '按约 1.6 g/kg 计算，分到三餐与加餐' : mode === 'lose' ? '减重期用来保护肌肉' : '用于日常维持与恢复') + '）、脂肪约 ' + fat + ' g/天、碳水约 ' + carb + ' g/天。',
      '蛋白来源优先：鱼虾、鸡胸、瘦牛猪、蛋、豆制品、低脂奶；每天饮水 1500–2000 ml。'
    ]
  });
  const muscleLikeTip = {
    '清淡少油': '保持清淡，同时用奶 / 豆浆、鸡蛋、全谷主食和适量植物油补足能量与蛋白质。',
    '无肉不欢': '优先鱼虾、禽肉和瘦肉，分散到三餐；不要用肥肉和加工肉代替增肌所需的优质蛋白。',
    '主食偏多': '把主食均匀分到三餐和训练前后，并确保每餐同时有蛋白质，避免只吃主食。',
    '甜饮奶茶': '增重也不靠奶茶和甜饮；优先牛奶、无糖酸奶、豆浆等同时提供蛋白质的饮品。',
    '重口味偏咸': WM_LIKE_TIP['重口味偏咸'],
    '夜宵习惯': '若晚间训练后饥饿，可在睡前 1–2 小时加一份奶 / 豆浆配鸡蛋或全麦面包，避免油炸夜宵。',
    '素食为主': '用豆制品、蛋奶、豆类与全谷组合补足蛋白质；严格素食者注意维生素 B12、铁和钙。',
    '外卖为主': '每餐主动加一份蛋白和主食，少选只有蔬菜的轻食；酱汁仍分开放，避免靠油盐凑热量。'
  };
  const likeTips = (f.likes || []).map(x => (muscleFocus ? muscleLikeTip[x] : WM_LIKE_TIP[x])).filter(Boolean);
  diet.push({
    t: '按你的偏好调整',
    l: likeTips.length ? likeTips : ['没有勾选偏好，先按上面的通用搭配吃一周，再回来补充偏好，方案会更贴合。']
  });
  const avTips = (f.avoids || []).map(x => WM_AVOID_TIP[x]).filter(Boolean)
    .concat(f.avoidText ? ['其他禁忌：' + f.avoidText + '——执行时以这条优先，避开相关食材。'] : []);
  diet.push({
    t: '忌口与替换',
    l: avTips.length ? avTips : ['没有填写忌口；若吃完出现腹胀、皮疹或肠胃不适，先剔除那类食物。']
  });
  diet.push({ t: '结合你的体质', l: [wmConstitutionTip()] });

  const ex = [];
  if (days <= 0) {
    ex.push('这一阶段先不安排专门训练：每餐后散步 10–15 分钟，目标每天 7000 步左右。');
    ex.push('两周后若能腾出时间，把「每周可运动天数」改到 2–3 天再生成一次，方案会自动加上训练安排。');
  } else if (muscleFocus) {
    ex.push('力量训练 ' + Math.min(days, 3) + ' 次/周，每次约 30–45 分钟：深蹲、髋铰链、推、拉与核心动作覆盖主要肌群。');
    if (days === 1) ex.push('你目前只能安排 1 天，先把这一次练完整；条件允许后逐步增加到每周至少 2 天。');
    ex.push('每个动作先做 2–3 组，每组保留 2–3 次余力；动作稳定后再逐步增加次数、阻力或重量。');
    if (days >= 3) ex.push('另安排 1–2 次 20–30 分钟轻中等强度有氧，帮助心肺恢复，不用追求大量消耗。');
    ex.push('相同肌群训练间隔至少 48 小时；疼痛、动作明显变形或恢复不足时，先减量而不是硬撑。');
  } else {
    ex.push('有氧 ' + Math.min(days, 4) + ' 次/周，每次 30–45 分钟：快走、慢跑、骑车、游泳任选，强度以「能说话但不能唱歌」为准。');
    if (days >= 3) ex.push('力量训练 2 次/周，每次约 20 分钟：深蹲、箭步蹲、俯卧撑（或弹力带划船）、平板支撑各 2–3 组，用来保住肌肉。');
    if (days >= 5) ex.push('一周里至少留 1 天完全休息，避免连续高强度造成疲劳堆积。');
    ex.push('日常活动：每天 6000–8000 步，久坐每小时起身活动 3–5 分钟。');
  }
  ex.push('运动后拉伸 5–10 分钟；气虚、阳虚体质以微微出汗为度，不要追求大汗。');
  if (act.id === 'high') ex.push('你日常活动量已经很大，训练以恢复为主，别再额外堆量，重点保证睡眠与蛋白质摄入。');

  const caution = [
    '称重方式：每周固定 2–3 次，晨起空腹、如厕后、用同一台秤；看两周的平均趋势，别被单日波动影响。',
    mode === 'lose'
      ? '减重节奏：每周体重下降控制在 ' + (Math.round(w * 0.005 * 10) / 10) + '–' + (Math.round(w * 0.01 * 10) / 10) + ' kg；下降过快多半伴随水分与肌肉流失，反弹风险更高。'
      : muscleFocus
        ? '增肌判断：每 2–4 周一起看平均体重、腰围和训练重量 / 次数；若腰围快速增加而力量没有进步，先把每日热量下调 100–200 kcal。'
        : '维持判断：允许日常水分造成的小幅波动；若两周平均体重持续偏离目标，再把每日热量调整 100–200 kcal。',
    '每天睡够 7 小时；睡眠不足会影响食欲调节、训练恢复与体重管理效果。',
    mode === 'lose'
      ? '不推荐：全天断食、用代餐替代全部正餐、泻药或利尿剂、每天低于 1000 kcal 的极端节食。'
      : muscleFocus
        ? '不推荐：靠奶茶、蛋糕和油炸食品突击增重，盲目使用增肌粉或来路不明的激素类产品。'
        : '不推荐：因单日体重变化突然节食或暴食，也不要用泻药、利尿剂干预体重。',
    '本方案按健康成人（14–100 岁）的一般原则生成，是养生参考，不替代医师诊疗。'
  ];
  if (band.label === '偏瘦') caution.unshift('你当前 BMI 为 ' + bmi.toFixed(1) + '（偏瘦），本方案以健康增重和增肌为主，不建议继续减重；若近期非主动变瘦，请先就医排查原因。');
  if (tband.label === '超重') caution.unshift('目标体重对应 BMI 仍偏高，建议先把阶段性目标定到健康区间（' + rng[0].toFixed(1) + '–' + rng[1].toFixed(1) + ' kg）以内。');
  const safetyLead = mode === 'lose'
    ? '出现头晕心慌、持续乏力、明显脱发、失眠加重或' + (isFemale() ? '月经紊乱' : '内分泌异常') + '，请停止当前方案并就医。'
    : muscleFocus
      ? '出现胸痛、晕厥、异常气短、关节锐痛，或体重在短期内异常快速变化，请停止训练并就医。'
      : '出现头晕心慌、持续乏力、食欲明显改变或体重无明显原因持续变化，请停止当前方案并就医。';
  const safety = safetyLead + ' 孕期 / 哺乳期、BMI < 18.5、糖尿病或高血压等慢病、肾功能异常或正在服药者，请先咨询医师再执行。';

  const metrics = [
    { k: '当前 BMI', v: bmi.toFixed(1), n: band.label },
    { k: '每日热量', v: kcal + '', n: 'kcal' },
    { k: mode === 'lose' ? '需要减' : mode === 'gain' ? '需要增' : '维持', v: Math.abs(diff).toFixed(1) + ' kg', n: mode === 'keep' ? '体重不变' : '约 ' + weeks + ' 周' },
    mode === 'lose'
      ? { k: '每周速度', v: '−' + perWeek.toFixed(2) + ' kg', n: '建议上限' }
      : { k: '复盘周期', v: muscleFocus ? '2–4 周' : '2 周', n: muscleFocus ? '体重 + 腰围 + 力量' : '看平均趋势' },
    { k: '蛋白质', v: protein + ' g', n: '每天' },
    { k: '目标 BMI', v: tbmi.toFixed(1), n: tband.label }
  ];
  const title = muscleFocus
    ? '增重增肌方案 · ' + w.toFixed(1) + (mode === 'gain' ? ' → ' + tgt.toFixed(1) + ' kg' : ' kg 附近塑形') + '（约 ' + weeks + ' 周）'
    : mode === 'keep'
      ? '维持塑形方案 · 维持 ' + w.toFixed(1) + ' kg（' + weeks + ' 周）'
      : '减脂减重方案 · ' + w.toFixed(1) + ' → ' + tgt.toFixed(1) + ' kg（约 ' + weeks + ' 周）';

  return {
    v: 1, at: todayKey(), ts: Date.now(), mode: mode, intent: intent, title: title, weeks: weeks,
    summary: { bmi: bmi, band: band.label, kcal: kcal, weeks: weeks, delta: diff, current: w, target: tgt },
    metrics: metrics, stages: stages, diet: diet, exercise: ex, caution: caution, safety: safety,
    /* 三大营养素目标（g/天），供每日食谱换算营养比例 */
    nutri: { kcal: kcal, protein: protein, fat: fat, carb: carb },
    form: {
      gender: f.gender, age: age, height: h, weight: w, target: tgt, goalMode: goalMode,
      activity: act.id, activityLabel: act.label, days: days,
      likes: (f.likes || []).slice(), avoids: (f.avoids || []).slice(), avoidText: f.avoidText || ''
    },
    context: wmProfileText()
  };
}

/* 生成成功后写入历史：个人中心列表自动出现这条记录 */
function pushWeightPlan(p) {
  if (!Array.isArray(state.history)) state.history = [];
  const rec = {
    id: histId('w'), type: 'wplan', at: p.at, ts: Date.now(),
    title: p.title, primary: (state.assessment && state.assessment.primary) || '',
    data: p
  };
  state.history.push(rec);
  save();
  return rec;
}

/* 表单区 + 状态反馈 + 结果区 */
function archiveWmHtml() {
  const f = wmForm();
  const busy = !!ui.wmBusy, bad = ui.wmBad || '';
  const bc = id => (bad === id ? ' bad' : '');
  let h = '<p class="wm-lead"><b>这是什么：</b>按你填的身体数据，当场算出一份能照着做的体重管理方案——每天吃多少、怎么动、多久见效、什么情况要停下。</p>' +
    '<p class="muted small"><b>怎么用：</b>把下面的信息填一次（缺项或填错会明确提示）→ 点「生成方案」→ 照着执行。已替掉原先「复制档案 → 粘贴导入」的多步操作；每次生成都会留档到「我的」，可在那里查看、导出或删除。方案在你本机计算，数据不上传。</p>';

  h += '<div class="wm-grid">' +
    '<div class="fm-row"><span>性别</span><div class="fm-seg" id="wm_gender">' +
    [['female', '女'], ['male', '男']].map(p =>
      '<button type="button" class="seg' + (f.gender === p[0] ? ' on' : '') + '" data-action="wm-gender" data-v="' + p[0] + '">' + p[1] + '</button>').join('') +
    '</div></div>' +
    '<label class="fm-row"><span>年龄</span><input type="number" inputmode="numeric" id="wm_age" class="wminput' + bc('wm_age') + '" data-f="age" value="' + esc(f.age) + '" placeholder="周岁，例：32"></label>' +
    '<label class="fm-row"><span>身高</span><input type="number" step="0.5" id="wm_height" class="wminput' + bc('wm_height') + '" data-f="height" value="' + esc(f.height) + '" placeholder="cm，例：168"></label>' +
    '<label class="fm-row"><span>当前体重</span><input type="number" step="0.1" id="wm_weight" class="wminput' + bc('wm_weight') + '" data-f="weight" value="' + esc(f.weight) + '" placeholder="kg，例：62.5"></label>' +
    '<label class="fm-row"><span>目标体重</span><input type="number" step="0.1" id="wm_target" class="wminput' + bc('wm_target') + '" data-f="target" value="' + esc(f.target) + '" placeholder="kg，例：58"></label>' +
    '<label class="fm-row"><span>管理方向</span><select id="wm_goalMode" class="wminput' + bc('wm_goalMode') + '" data-f="goalMode">' +
    WM_GOALS.map(g => '<option value="' + g.id + '"' + (wmGoal(f.goalMode) === g.id ? ' selected' : '') + '>' + esc(g.label) + '</option>').join('') +
    '</select></label>' +
    '<label class="fm-row"><span>活动量</span><select id="wm_activity" class="wminput' + bc('wm_activity') + '" data-f="activity">' +
    WM_ACTIVITY.map(a => '<option value="' + a.id + '"' + (f.activity === a.id ? ' selected' : '') + '>' + esc(a.label) + '</option>').join('') +
    '</select></label>' +
    '<label class="fm-row"><span>可运动</span><select id="wm_days" class="wminput' + bc('wm_days') + '" data-f="days">' +
    WM_DAYS.map((t, i) => '<option value="' + i + '"' + (+f.days === i ? ' selected' : '') + '>每周 ' + t + '</option>').join('') +
    '</select></label>' +
    '</div>';

  h += '<div class="wm-sub"><b>饮食偏好</b>（可多选，选得越准方案越贴合）</div><div class="chips pick">' +
    WM_LIKES.map(v => '<button type="button" class="chip pickable' + ((f.likes || []).indexOf(v) > -1 ? ' on' : '') +
      '" data-action="wmchip" data-f="likes" data-v="' + esc(v) + '">' + v + '</button>').join('') + '</div>';
  h += '<div class="wm-sub"><b>忌口与过敏</b>（可多选）</div><div class="chips pick">' +
    WM_AVOIDS.map(v => '<button type="button" class="chip pickable' + ((f.avoids || []).indexOf(v) > -1 ? ' on' : '') +
      '" data-action="wmchip" data-f="avoids" data-v="' + esc(v) + '">' + v + '</button>').join('') + '</div>';
  h += '<label class="wm-other">其他忌口或要避开的食物（选填）' +
    '<textarea id="wm_avoidText" class="wminput" data-f="avoidText" rows="2" placeholder="例：不吃香菜、对芒果过敏">' + esc(f.avoidText || '') + '</textarea></label>';

  h += '<p class="fm-err" id="wmErr"' + (ui.wmErr ? '' : ' hidden') + '>' + esc(ui.wmErr) + '</p>';
  h += '<div class="wm-go">' +
    '<button class="btn go" data-action="wmgen"' + (busy ? ' disabled' : '') + '>' + (busy ? '生成中…' : '生成方案') + '</button>' +
    '<span class="muted small">' + (busy ? '正在计算，请稍候' : '填完点一下就出方案，约 1 秒') + '</span></div>';

  if (busy) h += '<div class="wm-state busy"><i class="spin"></i>正在根据你的数据生成方案…</div>';
  else if (ui.wmStateErr || (ui.wmErr && !ui.wmBad)) h += '<div class="wm-state err">' + esc(ui.wmStateErr || ui.wmErr) + '</div>';
  else if (ui.wmOk) h += '<div class="wm-state ok">' + esc(ui.wmOk) + '</div>';

  if (state.weight.plan) h += wmResultHtml(state.weight.plan);
  return h;
}

function wmResultHtml(p) {
  let h = '<div class="wm-res"><div class="wm-res-head"><h3>最新方案' + (p.at ? '（' + esc(p.at) + '）' : '') + '</h3>' +
    '<div class="wm-res-ops">' +
    '<button class="btn small ghost" data-action="wm-export">导出方案</button>' +
    '<button class="btn small" data-action="go" data-page="mine">在「我的」里管理</button>' +
    '</div></div>' + wmPlanHtml(p);
  h += isLogin()
    ? '<p class="muted small">这份方案已同步到「我的」记录列表，可在那里查看、导出或删除（删除需二次确认）。</p>'
    : '<p class="muted small">方案已生成并留档；<button class="btn tiny" data-action="login-open">登录</button> 后可在「我的」里统一查看、导出与删除。</p>';
  h += '</div>';
  return h;
}

/* 点击「生成方案」：先校验，再异步生成，状态分 生成中 / 成功 / 失败 */
function wmGenerate() {
  /* 异步生成：先锁定点击瞬间的位置，生成中 / 成功 / 失败各次重绘都按它恢复 */
  spLock();
  const f = wmForm();
  const read = id => { const el = $('#' + id); return el ? el.value : ''; };
  const draft = {
    gender: f.gender, age: read('wm_age'), height: read('wm_height'), weight: read('wm_weight'),
    target: read('wm_target'), goalMode: read('wm_goalMode'), activity: read('wm_activity'), days: read('wm_days'),
    likes: f.likes || [], avoids: f.avoids || [], avoidText: read('wm_avoidText')
  };
  const v = wmValidate(draft);
  ui.wmForm = Object.assign({}, draft, { likes: (draft.likes || []).slice(), avoids: (draft.avoids || []).slice() });
  ui.wmOk = ''; ui.wmStateErr = '';
  if (!v.ok) {
    ui.wmBusy = false; ui.wmBad = v.id; ui.wmErr = v.msg;
    render();
    const el = $('#' + v.id);
    if (el) {
      if (el.focus) { try { el.focus(); } catch (e) { /* 忽略 */ } }
      if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    }
    /* 校验失败要跳到出错字段，这里记下新位置并解锁，后续重绘跟随实时位置 */
    SP.cur = spLive(); SP.pos[SP.page] = SP.cur;
    spUnlock();
    toast(v.msg);
    return;
  }
  ui.wmBad = ''; ui.wmErr = ''; ui.wmBusy = true;
  state.weight.form = JSON.parse(JSON.stringify(ui.wmForm));
  save();
  render();
  setTimeout(() => {
    let plan = null;
    try { plan = buildWeightPlan(v.form); } catch (e) { plan = null; }
    if (!plan) {
      ui.wmBusy = false; ui.wmOk = ''; ui.wmErr = '生成过程中数据异常，请检查填写内容后重试。';
      ui.wmStateErr = ui.wmErr;
      render(); spUnlock(); toast('生成失败，请重试');
      return;
    }
    state.weight.plan = plan;
    state.weight.planAt = plan.at;
    state.weight.goal = String(v.form.target);
    if (v.form.height) state.profile.height = String(v.form.height);
    const rec = pushWeightPlan(plan);
    ui.wmBusy = false;
    ui.wmOk = '已生成 · ' + plan.at + '　·　已同步到「我的」（' + HIST_META.wplan.label + '，共 ' +
      (state.history || []).filter(r => r.type === 'wplan').length + ' 份）';
    save(); render(); spUnlock();
    toast('方案已生成：约 ' + plan.weeks + ' 周' + (rec ? '，已同步到个人中心' : ''));
  }, 620);
}

/* 全部历史记录 */
function archiveHistoryHtml() {
  const all = Object.keys(state.records).sort().reverse();
  if (!all.length) return '<p class="muted">暂无记录。</p>';
  return '<div class="hist">' + all.slice(0, 30).map(kk => '<div class="hist-item">' + recordCardHtml(kk, state.records[kk]) +
    '<button class="del" data-action="delrec" data-k="' + kk + '">删除</button></div>').join('') + '</div>';
}

function viewAbout() {
  return '<section class="panel"><h2>关于与数据来源</h2>' +
    '<h3>评估依据</h3><ul class="plain">' +
    '<li>GB/T 46939—2025《中医体质分类与判定》推荐性国家标准，国家市场监督管理总局、国家标准化管理委员会发布，国家中医药管理局组织起草，2026 年 4 月 1 日实施。</li>' +
    '<li>《国家基本公共卫生服务规范（第三版）》体质判定标准表：33 题记录表与判定条件（本工具体质判定核心部分）。</li>' +
    '<li>中华中医药学会《中医体质分类与判定》（王琦九种体质学说）。</li>' +
    '</ul>' +
    '<h3>问卷构成</h3><ul class="plain">' +
    '<li>基础卷 ' + QUESTIONS.length + ' 题：33 题体质判定核心（五级量表，参与计分）+ 12 题生活与需求补充（单选 / 多选 / 排序 / 简答，不计入体质分值；其中 1 道选题后才追问）。</li>' +
    '<li>补充题覆盖来意与期待、怕热出汗与睡眠、作息与三餐、既往健康与用药、饮食偏好、调理接受度、困扰优先级七个方面。</li>' +
    '<li>登录后按性别与年龄追加专项题（女性 5 题 / 男性 2 题 / 年龄段 1 题），同样不计入体质分值，当前共 ' + questions().length + ' 题，任何情况下不超过 60 题。</li>' +
    '<li>登录后的数据与账号 ID 绑定并同步到云端，本机同时保留缓存；网站更新不会清除历史数据。</li>' +
    '</ul>' +
    '<h3>计分与判定</h3><ul class="plain">' +
    '<li>每题五级评分：没有 1 分、很少 2 分、有时 3 分、经常 4 分、总是 5 分。</li>' +
    '<li>原始分 = 各条目分值之和；转化分 =（原始分 − 条目数）÷（条目数 × 4）× 100。</li>' +
    '<li>偏颇体质：转化分 ≥ 40 为「是」，30 至 39 为「倾向是」，&lt; 30 为「否」。</li>' +
    '<li>平和质：转化分 ≥ 60 且其他八种体质均 &lt; 30 为「是」；均 &lt; 40 为「基本是」。</li>' +
    '<li>平和质条目 2、4、5、13 需反向计分（1→5，2→4，3→3，4→2，5→1）。</li>' +
    '</ul>' +
    '<h3>免责声明</h3>' +
    '<p class="note">本工具用于健康自测与养生参考，不构成医疗诊断，也不能替代医师的面诊、舌诊、脉诊与必要的实验室检查。体质最终判定应由注册中医师结合四诊信息确认。若出现明显不适、急性症状、持续失眠或情绪低落超过两周，请及时就医。孕期、哺乳期、慢性病患者及正在服药者，药膳与穴位方案请先咨询医师。</p>' +
    '<h3>数据说明</h3>' +
    '<p class="note">登录后的基本信息、测评、报告、方案、身体档案、打卡和食谱会同步到云端，并保留本机缓存。主动退出不会删除云端数据；只有执行删除操作才会移除相应记录。仍建议定期导出个人备份。</p>' +
    '<div class="qfoot"><button class="btn small" data-action="export">导出数据</button>' +
    '<button class="btn small ghost" data-action="import">导入数据</button>' +
    '<button class="btn small danger" data-action="reset">清空全部数据</button></div>' +
    '<input type="file" id="fileIn" accept="application/json" hidden>' +
    '</section>';
}

function emptyState(text, page) {
  return '<section class="panel empty"><p>' + esc(text) + '</p><button class="btn" data-action="go" data-page="' + page + '">去测评</button></section>';
}
/* 未登录占位：登录前不展示任何个性化内容 */
function guestState(text) {
  return '<section class="panel empty"><p>' + esc(text || '请先登录后查看') + '</p>' +
    '<button class="btn" data-action="login-open">登录 / 开始使用</button></section>';
}

/* ================= 弹窗（登录 / 删除习惯确认 / 习惯编辑） ================= */
function openModal(kind, data) { ui.modal = kind; ui.modalData = data || null; renderModal(); }
function closeModal() {
  /* 登录弹窗在未登录（首次访问 / 退出后）时默认不可关闭：关闭后页面只剩占位内容，无法继续使用。
     唯一例外：用户在二次确认中主动选择「放弃登录」（由 giveUpLogin 临时放行） */
  if (ui.modal === 'login' && !isLogin() && !ui.allowCloseLogin) return;
  ui.modal = null; ui.modalData = null;
  ui.loginAsk = false;
  const host = $('#modalHost');
  if (host) { host.innerHTML = ''; host.hidden = true; }
}
/* 放弃登录：写入本机标记，此后不再自动弹窗；二次确认层与登录弹窗一起关闭 */
function giveUpLogin() {
  if (isLogin()) { ui.loginAsk = false; closeModal(); return; }
  state.guestSkip = true;
  ui.loginAsk = false;
  ui.allowCloseLogin = true;   /* 临时放行，关完立刻收回 */
  save();
  closeModal();
  ui.allowCloseLogin = false;
  syncUserEntry();
  render({ top: true });
  toast('已跳过登录，随时可点右上角「登录」补上');
}
function renderModal() {
  const host = $('#modalHost');
  if (!host) return;
  if (!ui.modal) { host.innerHTML = ''; host.hidden = true; return; }
  let html = '';
  if (ui.modal === 'login') html = loginModalHtml();
  else if (ui.modal === 'habit-del') html = habitDelModalHtml();
  else if (ui.modal === 'habit-edit') html = habitEditModalHtml();
  else if (ui.modal === 'hist-del') html = histDelModalHtml();
  host.innerHTML = html;
  host.hidden = false;
  /* 二次确认层展开时不要聚焦背后的输入框 */
  const f = ui.loginAsk ? null : ($('#lg_name') || $('#hb_text'));
  if (f) f.focus();
}

/* 删除习惯二次确认：明确告知历史打卡记录会一并删除 */
function habitDelModalHtml() {
  const id = (ui.modalData || {}).id;
  const it = habitById(id);
  if (!it) return '';
  const n = habitLogCount(it.id);
  return '<div class="modal-mask" data-action="modal-close"></div>' +
    '<div class="modal sm" role="dialog" aria-modal="true" aria-label="删除习惯">' +
    '<div class="modal-head"><h2>删除习惯</h2>' +
    '<button class="modal-x" type="button" data-action="modal-close" aria-label="关闭">×</button></div>' +
    '<p class="del-text">确定删除「<b>' + esc(it.text) + '</b>」吗？</p>' +
    '<p class="del-warn">删除后，这条习惯的<b>全部历史打卡记录（累计 ' + n + ' 天）将一并删除</b>，且无法恢复。</p>' +
    '<p class="muted small">如果只是想换个说法，请改用「修改」——修改会保留已积累的打卡记录。</p>' +
    '<div class="qfoot"><span class="muted small">删除不可撤销</span><span class="qfoot-btns">' +
    '<button class="btn ghost" type="button" data-action="modal-close">取消</button>' +
    '<button class="btn danger" type="button" data-action="habit-del-yes" data-id="' + it.id + '">确认删除</button>' +
    '</span></div></div>';
}

/* 删除历史记录二次确认：明确告知删除后不可恢复（导出可另行保存） */
function histDelModalHtml() {
  const rec = histById((ui.modalData || {}).id);
  if (!rec) return '';
  const m = HIST_META[rec.type] || HIST_META.report;
  return '<div class="modal-mask" data-action="modal-close"></div>' +
    '<div class="modal sm" role="dialog" aria-modal="true" aria-label="删除记录">' +
    '<div class="modal-head"><h2>删除这条记录</h2>' +
    '<button class="modal-x" type="button" data-action="modal-close" aria-label="关闭">×</button></div>' +
    '<p class="del-text">确定删除「<b>' + esc(rec.title) + '</b>」吗？</p>' +
    '<p class="del-warn">这是' + esc(m.label) + '，生成于 ' + esc(rec.at) + '。<b>删除后不可恢复</b>。</p>' +
    '<p class="muted small">如果只是想留个备份，请先「取消」并用「导出」保存成文件，再回来删除。</p>' +
    '<div class="qfoot"><span class="muted small">删除不可撤销</span><span class="qfoot-btns">' +
    '<button class="btn ghost" type="button" data-action="modal-close">取消</button>' +
    '<button class="btn danger" type="button" data-action="hist-del-yes" data-id="' + esc(rec.id) + '">确认删除</button>' +
    '</span></div></div>';
}

/* 习惯编辑 / 新建：修改只替换文字，打卡记录随 id 保留 */
function habitEditModalHtml() {
  const d = ui.modalData || {};
  const isNew = !d.id;
  let tagHtml = '';
  if (isNew) {
    tagHtml = '<div class="fm-row"><span>分类</span><select id="hb_tag">' +
      Object.keys(TAG_META).map(k =>
        '<option value="' + k + '"' + ((d.tag || 'routine') === k ? ' selected' : '') + '>' + TAG_META[k].label + '</option>').join('') +
      '</select></div>';
  }
  return '<div class="modal-mask" data-action="modal-close"></div>' +
    '<div class="modal sm" role="dialog" aria-modal="true" aria-label="' + (isNew ? '添加习惯' : '修改习惯') + '">' +
    '<div class="modal-head"><h2>' + (isNew ? '添加习惯' : '修改习惯') + '</h2>' +
    '<button class="modal-x" type="button" data-action="modal-close" aria-label="关闭">×</button></div>' +
    '<div class="fm">' +
    '<label class="fm-row"><span>习惯内容</span>' +
    '<input type="text" id="hb_text" maxlength="40" value="' + esc(d.text || '') + '" placeholder="例如：睡前揉腹 5 分钟"></label>' +
    tagHtml +
    '</div>' +
    '<p class="fm-err" id="hbErr" hidden></p>' +
    '<p class="muted small">' + (isNew ? '添加后即可在首页与习惯页打卡。' : '保存后替换原习惯文字，这条习惯已积累的打卡记录会全部保留。') + '</p>' +
    '<div class="qfoot"><span class="muted small">最多 40 字</span><span class="qfoot-btns">' +
    '<button class="btn ghost" type="button" data-action="modal-close">取消</button>' +
    '<button class="btn" type="button" data-action="habit-edit-save" data-id="' + esc(d.id || '') + '">保存</button>' +
    '</span></div></div>';
}

function submitHabitEdit() {
  const el = $('#habitEditBtn') || $('[data-action="habit-edit-save"]');
  const id = el ? el.dataset.id : '';
  const text = (($('#hb_text') || {}).value || '').trim();
  const tag = (($('#hb_tag') || {}).value || 'routine');
  const err = $('#hbErr');
  const fail = m => { if (err) { err.textContent = m; err.hidden = false; } };
  if (!text) return fail('请填写习惯内容');
  if (id) { editHabit(id, text, tag); toast('习惯已修改，打卡记录保留'); }
  else { addHabit(text, tag); toast('已添加新习惯'); }
  closeModal();
  render();
}

function loginModalHtml() {
  if (cloudOn()) return cloudLoginModalHtml();
  const u = state.user || {};
  const g = ui.tmpGender != null ? ui.tmpGender : (u.gender || '');
  const on = isLogin();
  /* 未登录时也允许从右上角关闭，但必须先经过二次确认（loginAskHtml）；已登录（修改资料）直接关闭 */
  return (on ? '<div class="modal-mask" data-action="modal-close"></div>' : '<div class="modal-mask"></div>') +
    '<div class="modal" role="dialog" aria-modal="true" aria-label="登录">' +
    '<div class="modal-head"><h2>' + (on ? '修改资料' : '登录') + '</h2>' +
    '<button class="modal-x" type="button" data-action="' + (on ? 'modal-close' : 'login-ask') + '" aria-label="关闭">×</button></div>' +
    '<p class="muted">填三项就好：昵称、性别、年龄。登录后我们会按性别与年龄补上对应的专项题，并为你单独留档历次生成的报告与方案。</p>' +
    '<p class="muted small">昵称、性别、年龄与后续测评、方案、食谱全部只保存在当前设备的浏览器里，不上传服务器；清除浏览器数据即回到默认状态。</p>' +
    '<div class="fm">' +
    '<label class="fm-row"><span>昵称</span><input type="text" id="lg_name" maxlength="20" value="' + esc(u.name || '') + '" placeholder="怎么称呼你？"></label>' +
    '<div class="fm-row"><span>性别</span><div class="fm-seg">' +
    [['female', '女'], ['male', '男']].map(p =>
      '<button type="button" class="seg' + (g === p[0] ? ' on' : '') + '" data-action="pick-gender" data-v="' + p[0] + '">' + p[1] + '</button>').join('') +
    '</div></div>' +
    '<label class="fm-row"><span>年龄</span><input type="number" id="lg_age" min="1" max="120" value="' + esc(u.age || '') + '" placeholder="周岁，例：32"></label>' +
    '</div>' +
    '<p class="fm-err" id="lgErr" hidden></p>' +
    '<div class="qfoot"><span class="muted small">信息只存在本机浏览器</span><span class="qfoot-btns">' +
    (on ? '<button class="btn ghost" type="button" data-action="modal-close">取消</button>' : '') +
    '<button class="btn" type="button" data-action="login-submit">' + (on ? '保存' : '登录') + '</button>' +
    '</span></div>' +
    /* 点右上角关闭时的二次确认层：叠在登录弹窗之上，放弃后两层一起消失 */
    (ui.loginAsk ? loginAskHtml() : '') +
    '</div>';
}

function cloudLoginModalHtml() {
  const restore = ui.authMode === 'restore';
  const recovery = ui.authMode === 'recovery' && ui.recovery;
  const profile = isLogin() && !recovery;
  const busy = ui.authBusy;
  const draft = ui.authDraft || { nickname: '', age: '', recoveryCode: '' };
  if (recovery) {
    return '<div class="modal-mask"></div>' +
      '<div class="modal recovery-modal" role="dialog" aria-modal="true" aria-label="保存账号恢复码">' +
      '<div class="modal-head"><h2>注册成功，请保存恢复码</h2></div>' +
      '<div class="recovery-alert"><b>恢复码相当于账号密码</b><p>更换设备、清除浏览器数据或主动退出后，需要用它恢复账号和全部历史数据。请勿分享；丢失后无法找回。</p></div>' +
      '<p class="muted small">账号昵称：' + esc(ui.recovery.nickname) + '</p>' +
      '<div class="recovery-code" id="recoveryCode" aria-label="恢复码">' + esc(ui.recovery.code) + '</div>' +
      '<div class="qfoot auth-foot"><button class="btn ghost" type="button" data-action="recovery-copy">复制恢复码</button>' +
      '<button class="btn" type="button" data-action="recovery-done">我已保存，进入网站</button></div>' +
      '</div>';
  }
  if (profile) {
    const u = state.user || {}, g = ui.tmpGender != null ? ui.tmpGender : (u.gender || '');
    return '<div class="modal-mask" data-action="modal-close"></div>' +
      '<div class="modal" role="dialog" aria-modal="true" aria-label="修改基本信息">' +
      '<div class="modal-head"><h2>修改基本信息</h2><button class="modal-x" type="button" data-action="modal-close" aria-label="关闭">×</button></div>' +
      '<p class="muted">性别和年龄会影响专项题与个性化建议；昵称是账号标识，注册后不能直接修改。</p>' +
      '<div class="fm">' +
      '<label class="fm-row"><span>昵称</span><input type="text" id="lg_name" maxlength="20" value="' + esc(u.name || '') + '" disabled></label>' +
      '<div class="fm-row"><span>性别</span><div class="fm-seg">' +
      [['female', '女'], ['male', '男']].map(p => '<button type="button" class="seg' + (g === p[0] ? ' on' : '') + '" data-action="pick-gender" data-v="' + p[0] + '">' + p[1] + '</button>').join('') +
      '</div></div>' +
      '<label class="fm-row"><span>年龄</span><input type="number" id="lg_age" min="1" max="120" value="' + esc(u.age || '') + '" placeholder="周岁，例：32"></label>' +
      '</div><p class="fm-err" id="lgErr" hidden></p>' +
      '<div class="qfoot"><span class="muted small">资料与账号同步保存</span><span class="qfoot-btns">' +
      '<button class="btn ghost" type="button" data-action="modal-close">取消</button>' +
      '<button class="btn" type="button" data-action="login-submit"' + (busy ? ' disabled' : '') + '>' + (busy ? '保存中…' : '保存') + '</button>' +
      '</span></div></div>';
  }
  return '<div class="modal-mask"></div>' +
    '<div class="modal" role="dialog" aria-modal="true" aria-label="' + (restore ? '恢复已有账号' : '首次使用') + '">' +
    '<div class="modal-head"><h2>' + (restore ? '恢复已有账号' : '首次使用即注册') + '</h2>' +
    '<button class="modal-x" type="button" data-action="login-ask" aria-label="关闭">×</button></div>' +
    (ui.authNotice ? '<p class="muted small">' + esc(ui.authNotice) + '</p>' : '') +
    '<p class="muted">' + (restore ? '输入注册时的昵称和恢复码，即可取回全部历史数据。' : '只需填写昵称、性别和年龄。昵称不能与其他用户重复，注册后会自动生成恢复码。') + '</p>' +
    '<div class="fm">' +
    '<label class="fm-row"><span>昵称</span><input type="text" id="lg_name" maxlength="20" autocomplete="username" value="' + esc(draft.nickname) + '" placeholder="怎么称呼你？"></label>' +
    (restore ? '<label class="fm-row"><span>恢复码</span><input type="text" id="lg_recovery" maxlength="40" autocomplete="current-password" value="' + esc(draft.recoveryCode) + '" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"></label>' :
      '<div class="fm-row"><span>性别</span><div class="fm-seg">' +
      [['female', '女'], ['male', '男']].map(p => '<button type="button" class="seg' + (ui.tmpGender === p[0] ? ' on' : '') + '" data-action="pick-gender" data-v="' + p[0] + '">' + p[1] + '</button>').join('') +
      '</div></div><label class="fm-row"><span>年龄</span><input type="number" id="lg_age" min="1" max="120" value="' + esc(draft.age) + '" placeholder="周岁，例：32"></label>') +
    '</div>' +
    '<p class="fm-err" id="lgErr" hidden></p>' +
    '<div class="qfoot auth-foot"><span class="muted small">云端长期保存，可跨设备恢复</span><span class="qfoot-btns">' +
    '<button class="btn ghost" type="button" data-action="' + (restore ? 'auth-mode-register' : 'auth-mode-restore') + '">' + (restore ? '首次使用' : '恢复已有账号') + '</button>' +
    '<button class="btn" type="button" data-action="login-submit"' + (busy ? ' disabled' : '') + '>' + (busy ? '处理中…' : (restore ? '恢复账号' : '注册并开始')) + '</button>' +
    '</span></div>' +
    (ui.loginAsk ? loginAskHtml() : '') + '</div>';
}

/* 放弃登录的二次确认：明确列出不登录会缺失什么，避免用户误点后不知道代价 */
function loginAskHtml() {
  return '<div class="modal-ask" role="alertdialog" aria-modal="true" aria-label="确认放弃登录">' +
    '<h3>确定要跳过登录吗？</h3>' +
    '<p class="muted">不登录也能浏览首页介绍与「关于」，但以下内容会打折扣：</p>' +
    '<ul class="ask-list">' +
    '<li><b>题目不全面</b>：问卷只有 ' + QUESTIONS.length + ' 道基础题，缺按性别、年龄追加的' + (specialCount() || 6) + ' 道专项题</li>' +
    '<li><b>报告与方案针对性缺失</b>：无法结合你的性别、年龄做校正，调理建议只能给通用版</li>' +
    '<li><b>食谱不个性化</b>：不会按体质、时令、忌口与经期配餐，只给通用搭配</li>' +
    '<li><b>记录存不下来</b>：打卡、身体档案、经期与历次报告都无法保存，刷新即丢</li>' +
    '</ul>' +
    '<p class="muted small">随时可点右上角「登录」补上，已做的操作不会丢。</p>' +
    '<div class="qfoot"><span class="muted small">填三项，约 10 秒</span><span class="qfoot-btns">' +
    '<button class="btn" type="button" data-action="login-ask-back">返回登录</button>' +
    '<button class="btn ghost danger" type="button" data-action="login-ask-give-up">仍要跳过</button>' +
    '</span></div></div>';
}

function submitLogin() {
  if (cloudOn()) return submitCloudLogin();
  const name = ($('#lg_name') || {}).value || '';
  const age = ($('#lg_age') || {}).value || '';
  const gender = ui.tmpGender != null ? ui.tmpGender : ((state.user || {}).gender || '');
  const err = $('#lgErr');
  const fail = m => { if (err) { err.textContent = m; err.hidden = false; } };
  if (!name.trim()) return fail('请填写昵称');
  if (gender !== 'female' && gender !== 'male') return fail('请选择性别');
  const n = +age;
  if (!age || !n || n < 1 || n > 120) return fail('请填写 1–120 之间的年龄');
  const nm = name.trim();
  /* 同一台设备换了人登录：清空上一位用户的个性化数据，做到同机不同用户互不影响。
     昵称比较先归一化（去空格、统一大小写），避免「多打一个空格 / 大小写不同」被误判成换人 */
  const normKey = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, '');
  const prevOwner = state.owner || ((state.user && state.user.name) || '');
  const switched = !!(prevOwner && normKey(prevOwner) !== normKey(nm));
  if (switched) {
    if (!confirm('这台设备目前保存着「' + prevOwner + '」的个人数据。为避免误删，系统会先下载一份完整备份，再清空当前数据并切换到「' + nm + '」。继续吗？')) return;
    exportJson('易安堂-切换用户前备份-' + todayKey() + '.json', state);
    resetPersonalData();
  }
  state.owner = nm;
  state.guestSkip = false;
  ui.loginAsk = false;
  state.user = { name: nm, gender: gender, age: n, since: (state.user && state.user.since) || todayKey() };
  state.profile.name = state.user.name;
  state.profile.gender = gender === 'female' ? '女' : '男';
  state.profile.age = String(n);
  ui.tmpGender = null;
  /* 性别可能变化，经期草稿一并重置（数据仍保留，再次进入时按新性别决定是否展示） */
  ui.period = null; ui.periodErr = '';
  rebuildQuestions();
  save();
  const warn = SAVE_WARN;
  closeModal();
  syncUserEntry();
  if (warn) toast('登录成功，但本机浏览器不允许保存数据（可能处于无痕模式），刷新后需要重新登录');
  else toast(switched ? ('已切换为「' + nm + '」，本机原「' + prevOwner + '」的数据已清空') : '已登录，点右上角「我的」查看历史记录');
  render();
}

function cloudIdentity(data, nickname) {
  const u = (data && data.user) || (typeof EYAuth !== 'undefined' && EYAuth.user && EYAuth.user()) || {};
  const meta = u.user_metadata || {};
  return { name: meta.nickname || nickname || '用户', gender: meta.gender || '', age: +meta.age || '', since: todayKey(), id: u.id || '' };
}

async function submitCloudLogin() {
  const fail = m => { const err = $('#lgErr'); if (err) { err.textContent = m; err.hidden = false; } };
  if (isLogin()) return submitCloudProfile();
  const nickname = String((($('#lg_name') || {}).value || '')).trim();
  ui.authDraft = ui.authDraft || {};
  ui.authDraft.nickname = nickname;
  if (!nickname || nickname.length > 20) return fail('请填写 1–20 个字符的昵称');
  if (ui.authMode === 'restore') {
    const recoveryCode = String((($('#lg_recovery') || {}).value || '')).trim();
    ui.authDraft.recoveryCode = recoveryCode;
    if (!recoveryCode) return fail('请填写恢复码');
    ui.authBusy = true; renderModal();
    try {
      const data = await EYAuth.signInNickname(nickname, recoveryCode);
      state.user = cloudIdentity(data, nickname);
      state.guestSkip = false; CLOUD_SYNC.ready = false;
      const profile = await EYCloud.getProfile();
      if (!profile || !profile.nickname) throw new Error('账号资料不存在或尚未完成初始化');
      state.user.name = profile.nickname; state.user.gender = profile.gender; state.user.age = +profile.age;
      state.profile.name = profile.nickname; state.profile.gender = profile.gender === 'female' ? '女' : '男'; state.profile.age = String(profile.age);
      await hydrateCloudState();
      ui.authBusy = false; ui.authMode = 'register'; ui.authNotice = '';
      ui.authDraft = { nickname: '', age: '', recoveryCode: '' };
      closeModal(); syncUserEntry(); render(); toast('账号已恢复，历史数据同步完成');
    } catch (e) {
      ui.authBusy = false; renderModal(); fail(e.message || '账号恢复失败，请检查昵称和恢复码');
    }
    return;
  }
  const age = +((($('#lg_age') || {}).value || ''));
  ui.authDraft.age = age ? String(age) : '';
  const gender = ui.tmpGender || '';
  if (!['female', 'male'].includes(gender)) return fail('请选择性别');
  if (!Number.isInteger(age) || age < 1 || age > 120) return fail('请填写 1–120 之间的年龄');
  ui.authBusy = true; renderModal();
  try {
    const result = await EYAuth.signUpNickname(nickname, gender, age);
    state.user = cloudIdentity({ user: result.user }, nickname);
    state.user.gender = gender; state.user.age = age;
    state.profile.name = nickname; state.profile.gender = gender === 'female' ? '女' : '男'; state.profile.age = String(age);
    state.guestSkip = false; CLOUD_SYNC.ready = false;
    await EYCloud.upsertProfile({ nickname: nickname, gender: gender, age: age, account_kind: 'nickname' });
    await hydrateCloudState();
    ui.authBusy = false; ui.tmpGender = null; ui.authNotice = '';
    ui.authDraft = { nickname: '', age: '', recoveryCode: '' };
    ui.recovery = { nickname: nickname, code: result.recoveryCode };
    ui.authMode = 'recovery'; renderModal(); syncUserEntry(); render();
  } catch (e) {
    ui.authBusy = false; renderModal();
    fail(e.message || '注册失败，请稍后重试');
  }
}

async function submitCloudProfile() {
  const name = String((state.user && state.user.name) || '').trim();
  const age = +((($('#lg_age') || {}).value || ''));
  const gender = ui.tmpGender != null ? ui.tmpGender : ((state.user || {}).gender || '');
  const fail = m => { const err = $('#lgErr'); if (err) { err.textContent = m; err.hidden = false; } };
  if (!name || name.length > 20) return fail('请填写 1–20 个字符的昵称');
  if (!['female', 'male'].includes(gender)) return fail('请选择性别');
  if (!Number.isInteger(age) || age < 1 || age > 120) return fail('请填写 1–120 之间的年龄');
  ui.authBusy = true; renderModal();
  try {
    state.user = Object.assign({}, state.user || {}, { name: name, gender: gender, age: age });
    state.profile.name = name; state.profile.gender = gender === 'female' ? '女' : '男'; state.profile.age = String(age);
    state.owner = state.user.id; state.guestSkip = false; ui.tmpGender = null;
    await EYCloud.upsertProfile({ nickname: name, gender: gender, age: age, account_kind: 'nickname' });
    save();
    ui.authBusy = false; ui.authMode = 'register'; ui.authNotice = '';
    closeModal(); syncUserEntry(); render(); toast('基本信息已保存');
  } catch (e) {
    ui.authBusy = false; renderModal(); fail(e.message || '资料保存失败，请稍后重试');
  }
}

/* 换人登录：清空上一位用户留在本机的个性化数据（只影响本设备，不上传任何数据） */
function resetPersonalData() {
  state.assessment = null;
  state.extra = null;
  state.plan = null;
  state.history = [];
  state.habits = { list: [], logs: {} };
  state.records = {};
  state.period = { logs: {}, cycle: PERIOD_CYCLE_DEFAULT, cycleMan: false };
  state.weight = { goal: '', plan: null, planAt: '', form: null };
  state.diet = { likes: [], avoids: [], chronic: [], avoidText: '' };
  state.menuPicks = {};
  state.recipeSeed = 0;
  ui.menuOffset = 0; ui.retake = false; ui.mineId = null;
  ui.period = null; ui.periodErr = '';
}

async function logout() {
  if (cloudOn() && cloudUser()) {
    if (!confirm('退出当前账号？云端历史数据会继续保留，但下次登录必须使用昵称和恢复码。请确认已经保存恢复码。')) return;
    await flushCloudSave();
    try { await EYAuth.signOut(); } catch (e) { /* 即使远端退出失败，也清除本机会话 */ }
    CLOUD_SYNC.ready = false; CLOUD_SYNC.revision = 0;
    resetPersonalData(); state.user = null; state.owner = ''; state.guestSkip = false;
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    ui.authMode = 'restore'; ui.recovery = null;
    rebuildQuestions(); syncUserEntry(); go('home'); toast('已退出账号，云端数据仍会保留'); openModal('login');
    return;
  }
  if (!confirm('退出登录后入口将回到「登录」状态。历史记录会保留在本机，用同一昵称重新登录即可看到。确定退出？')) return;
  state.user = null;
  ui.period = null; ui.periodErr = '';
  clearLoginMark();
  rebuildQuestions();
  save();
  syncUserEntry();
  go('home');
  toast('已退出登录');
}

function syncUserEntry() {
  const btn = $('#userEntry'), txt = $('#ueText');
  if (!btn || !txt) return;
  const on = isLogin();
  txt.textContent = on ? '我的' : '登录';
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-label', on ? '进入个人中心' : '登录');
  const av = $('.ue-avatar', btn);
  if (av) av.textContent = '';
}

/* ================= 历史记录（只追加，不覆盖） ================= */
const HIST_META = {
  report: { label: '体质报告', color: '#A6432E', icon: '報' },
  plan:   { label: '调理方案', color: '#7C9A6B', icon: '方' },
  menu:   { label: '七日食谱', color: '#C98A3C', icon: '膳' },
  wplan:  { label: '体重方案', color: '#B08F4A', icon: '衡' }
};

function histId(t) { return t + Date.now().toString(36) + '_' + ((state.history || []).length); }

function pushReport(a) {
  state.history.push({
    id: histId('r'), type: 'report', at: a.date, ts: Date.now(),
    title: a.verdictText, primary: a.primary,
    data: {
      verdictText: a.verdictText, summary: a.summary, scores: a.scores,
      secondary: a.secondary || [], tendencies: a.tendencies || [], extra: state.extra || {}
    }
  });
  save();
}
function pushPlan(a) {
  const ids = [a.primary].concat(a.secondary || [], a.tendencies || []).slice(0, 3);
  state.history.push({
    id: histId('p'), type: 'plan', at: todayKey(), ts: Date.now(),
    title: CONSTITUTIONS[a.primary].name + ' · 四维调理方案', primary: a.primary,
    data: { ids: ids }
  });
  save();
}
function pushMenu(a) {
  const cid = a.primary, days = [];
  for (let i = 0; i < 7; i++) {
    const k = shiftDay(todayKey(), i);
    const m = menuFor(cid, k, 0);
    days.push({
      date: k,
      breakfast: m.breakfast.name, lunch: m.lunch.name, dinner: m.dinner.name,
      drink: m.drink.name, fruit: m.fruit.name
    });
  }
  state.history.push({
    id: histId('m'), type: 'menu', at: todayKey(), ts: Date.now(),
    title: CONSTITUTIONS[cid].name + ' · 七日食谱', primary: cid,
    data: { days: days }
  });
  save();
}
function histById(id) {
  const L = state.history || [];
  for (let i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
  return null;
}
function exportJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* 列表里的关键信息摘要：体重方案直接给出目标 / 周期 / 每日热量 */
function histBrief(r) {
  const s = r && r.data && r.data.summary;
  if (!s || r.type !== 'wplan') return '';
  return '目标 ' + Number(s.target).toFixed(1) + ' kg　·　约 ' + s.weeks + ' 周　·　每日 ' + s.kcal + ' kcal';
}

function histDetailHtml(rec) {
  const d = rec.data || {};
  if (rec.type === 'report') {
    const c = CONSTITUTIONS[rec.primary] || CONSTITUTIONS.pinghe;
    let h = '<div class="hist-head" style="--c:' + c.color + '"><span class="hist-seal">' + c.seal + '</span>' +
      '<div><h3>' + esc(rec.title) + '</h3><p class="muted">' + esc(c.tagline) + '</p></div></div>';
    h += '<div class="chart-wrap">' + barsSvg(d.scores || {}, rec.primary) + '</div>';
    h += '<p class="note">' + esc(d.summary || '') + '</p>';
    extraSafetyNotes(d.extra).forEach(t => { h += '<p class="note warn">' + esc(t) + '</p>'; });
    if ((d.secondary || []).length) h += '<p class="muted small">兼夹体质：' + d.secondary.map(i => CONSTITUTIONS[i].name).join('、') + '</p>';
    if ((d.tendencies || []).length) h += '<p class="muted small">倾向体质：' + d.tendencies.map(i => CONSTITUTIONS[i].name).join('、') + '</p>';
    h += '<h3>体质特征</h3><dl class="profile">' +
      '<div><dt>形体特征</dt><dd>' + esc(c.profile.physique) + '</dd></div>' +
      '<div><dt>常见表现</dt><dd>' + esc(c.profile.common) + '</dd></div>' +
      '<div><dt>发病倾向</dt><dd>' + esc(c.profile.tendency) + '</dd></div>' +
      '</dl>';
    return h;
  }
  if (rec.type === 'plan') {
    const ids = (d.ids && d.ids.length ? d.ids : [rec.primary]).slice(0, 3);
    return '<h3>' + esc(rec.title) + '</h3>' + planBodyHtml(null, ids, true);
  }
  if (rec.type === 'wplan') {
    const f = d.form || {};
    let h = '<h3>' + esc(rec.title) + '</h3>';
    const chips = [];
    if (f.gender) chips.push(f.gender === 'male' ? '男' : '女');
    if (f.age) chips.push(f.age + ' 岁');
    if (f.height) chips.push(f.height + ' cm');
    if (f.weight) chips.push('当前 ' + f.weight.toFixed(1) + ' kg');
    if (f.target) chips.push('目标 ' + f.target.toFixed(1) + ' kg');
    if (f.activityLabel) chips.push(f.activityLabel.split('：')[0]);
    if (chips.length) h += '<div class="chips">' + chips.map(c => '<span class="chip">' + esc(c) + '</span>').join('') + '</div>';
    if ((f.likes && f.likes.length) || (f.avoids && f.avoids.length) || f.avoidText) {
      h += '<p class="muted small">偏好：' + esc((f.likes || []).join('、') || '未填') +
        '　·　忌口：' + esc((f.avoids || []).concat(f.avoidText ? [f.avoidText] : []).join('、') || '未填') + '</p>';
    }
    return h + wmPlanHtml(rec.data || d);
  }
  /* menu */
  let h = '<h3>' + esc(rec.title) + '</h3><div class="week">';
  (d.days || []).forEach(day => {
    h += '<div class="day"><div class="day-head">' + ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parseKey(day.date).getDay()] + ' · ' + day.date.slice(5) + '</div>' +
      '<p><span>早</span>' + esc(day.breakfast) + '</p>' +
      '<p><span>午</span>' + esc(day.lunch) + '</p>' +
      '<p><span>晚</span>' + esc(day.dinner) + '</p>' +
      '<p class="tea"><span>茶</span>' + esc(day.drink) + '</p>' +
      (day.fruit ? '<p class="fruit"><span>果</span>' + esc(day.fruit) + '</p>' : '') +
      (day.supplement ? '<p class="supp"><span>补</span>' + esc(day.supplement) +
        (day.supplementTime ? '<em>' + esc(day.supplementTime) + '</em>' : '') + '</p>' : '') +
      '</div>';
  });
  h += '</div><p class="note">这份食谱是生成当天的快照，之后的推荐会随时令与日期轮换。</p>';
  return h;
}

function viewMine() {
  if (!isLogin()) {
    return '<section class="panel"><h2>个人中心</h2>' +
      '<p class="muted">还没有登录。登录后可以按性别与年龄补上专项题，并单独留档历次生成的报告、方案与食谱。</p>' +
      '<div class="qfoot"><span></span><button class="btn" data-action="login-open">立即登录</button></div></section>';
  }
  const u = state.user;
  const all = (state.history || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const tab = ui.mineTab || 'all';
  const list = tab === 'all' ? all : all.filter(r => r.type === tab);

  let h = '<section class="panel mine-head"><a class="crumb" href="#" data-action="go" data-page="home">返回首页</a>' +
    '<div class="mine-card">' +
    '<span class="mine-avatar">' + esc((u.name || '').slice(0, 1) || '養') + '</span>' +
    '<div class="mine-info"><h2>' + esc(u.name) + '</h2>' +
    '<p class="muted">' + (u.gender === 'female' ? '女' : u.gender === 'male' ? '男' : '未透露性别') +
    '　·　' + (u.age || '—') + ' 岁　·　' + AGE_BAND_LABEL[ageBandOf(u.age)] + '</p>' +
    '<p class="muted small">登录于 ' + esc(u.since || '—') + '　·　累计留档 ' + all.length + ' 条</p></div>' +
    '<div class="mine-acts"><button class="btn small ghost" data-action="login-open">修改资料</button>' +
    '<button class="btn small danger" data-action="logout">退出登录</button></div>' +
    '</div></section>';

  if (ui.mineId) {
    const rec = histById(ui.mineId);
    if (!rec) { ui.mineId = null; return viewMine(); }
    h += '<section class="panel"><a class="crumb" href="#" data-action="mine-back">返回列表</a>' +
      '<p class="muted small">' + HIST_META[rec.type].label + '　·　生成于 ' + esc(rec.at) + '</p>' +
      histDetailHtml(rec) +
      '<div class="qfoot"><span></span><span class="qfoot-btns">' +
      '<button class="btn small ghost" data-action="mine-back">返回列表</button>' +
      '<button class="btn small" data-action="mine-export" data-id="' + rec.id + '">导出这条</button>' +
      '</span></div></section>';
    return h;
  }

  h += '<section class="panel"><h2>我的记录</h2>' +
    '<div class="chips pick">' +
    [['all', '全部 ' + all.length]].concat(Object.keys(HIST_META).map(t =>
      [t, HIST_META[t].label + ' ' + all.filter(r => r.type === t).length])).map(p =>
      '<button class="chip pickable' + (tab === p[0] ? ' on' : '') + '" data-action="mine-tab" data-v="' + p[0] + '">' + p[1] + '</button>').join('') +
    '</div>';

  if (state.assessment) {
    h += '<div class="qfoot" style="margin:14px 0 0"><span class="muted small">再生成一份会作为新记录追加，不会覆盖已有内容。</span>' +
      '<button class="btn small" data-action="mine-menu">按当前体质生成七日食谱</button></div>';
  }

  if (!list.length) {
    h += '<p class="muted" style="margin-top:16px">还没有这一类的记录。完成一次体质测评后，报告、方案与七日食谱会自动留档。</p></section>';
    return h;
  }

  h += '<ul class="hist-list">';
  list.forEach(r => {
    const m = HIST_META[r.type] || HIST_META.report;
    h += '<li class="hist-item" style="--c:' + m.color + '">' +
      '<span class="hist-icon">' + m.icon + '</span>' +
      '<div class="hist-main"><b>' + esc(r.title) + '</b>' +
      '<span class="muted small">' + m.label + '　·　生成日期 ' + esc(r.at) +
      (histBrief(r) ? '　·　' + esc(histBrief(r)) : '') + '</span></div>' +
      '<div class="hist-ops">' +
      '<button class="btn tiny" data-action="mine-view" data-id="' + r.id + '">查看</button>' +
      '<button class="btn tiny ghost" data-action="mine-export" data-id="' + r.id + '">导出</button>' +
      '<button class="btn tiny danger" data-action="mine-del" data-id="' + r.id + '">删除</button>' +
      '</div></li>';
  });
  h += '</ul>';
  h += '<div class="qfoot"><span class="muted small">导出为 JSON 文件，可用于备份或交给医师参考。</span>' +
    '<button class="btn small ghost" data-action="mine-export-all">导出全部记录</button></div>';
  h += '</section>';
  return h;
}

const AGE_BAND_LABEL = { teen: '青少年', young: '青年', mid: '中年', senior: '老年', '': '—' };

/* ---------------- 事件 ---------------- */
function bind() {
  const app = $('#app');
  /* #app 常驻 DOM，事件委托只在首次绑定：否则每次 render 都会再叠一层监听，
     一次点击被处理多次（多选反复开关、翻页一次跳多组、打卡点了没反应）。 */
  if (!app.dataset.bound) {
  app.dataset.bound = '1';
    app.addEventListener('click', async e => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const act = el.dataset.action;

      if (act === 'archive-toggle') {
        const key = el.dataset.key;
        if (!ui.archiveOpen) ui.archiveOpen = {};
        const open = !ui.archiveOpen[key];
        ui.archiveOpen[key] = open;
        const panel = el.closest('.archive-panel');
        const body = panel ? $('.archive-panel-body', panel) : null;
        if (panel) panel.classList.toggle('is-collapsed', !open);
        if (body) body.hidden = !open;
        el.setAttribute('aria-expanded', open ? 'true' : 'false');
        const label = $('span', el);
        if (label) label.textContent = open ? '收起' : '展开';
        return;
      }

      if (act === 'archive-history-toggle') {
        ui.archiveHistoryOpen = !ui.archiveHistoryOpen;
        const history = $('#archiveRecordHistory', app);
        if (history) history.hidden = !ui.archiveHistoryOpen;
        el.setAttribute('aria-expanded', ui.archiveHistoryOpen ? 'true' : 'false');
        el.textContent = ui.archiveHistoryOpen ? '收起历史记录' : '查看历史记录';
        return;
      }

      if (act === 'go') { go(el.dataset.page); return; }

      /* 五级量表 / 单选：点选即写入，就地更新样式 */
      if (act === 'answer') {
        const no = +el.dataset.no;
        ui.answers[no] = +el.dataset.v;
        delete ui.skipped[no];
        const item = el.closest('.qitem');
        if (item) {
          item.classList.add('done');
          $$('.opt,.pick', item).forEach(b => b.classList.toggle('on', b === el));
        }
        updateProgress();
        return;
      }

      /* 多选：勾选/取消，超出上限时忽略并给出提示 */
      if (act === 'multi') {
        const no = +el.dataset.no, val = +el.dataset.v;
        const q = qByNo(no);
        let arr = Array.isArray(ui.answers[no]) ? ui.answers[no].slice() : [];
        const at = arr.indexOf(val);
        if (at > -1) arr.splice(at, 1);
        else if (q && q.max && arr.length >= q.max) {
          const hint = $('.pick-hint[data-hint="' + no + '"] .small', app);
          if (hint) hint.textContent = '最多选 ' + q.max + ' 项，想换就先点掉一个';
          return;
        } else arr.push(val);
        arr.sort((a, b) => a - b);
        ui.answers[no] = arr;
        if (arr.length) delete ui.skipped[no];
        /* 有别的条件题依赖这一题（如「睡眠不好」触发睡眠追问）：选项一变就重算题集并整页重绘 */
        if (QUESTIONS.some(x => x.cond && x.cond.no === no)) {
          rebuildQuestions();
          ui.focusNo = no;
          render({ scroll: window.scrollY });
          return;
        }
        const item = el.closest('.qitem');
        if (item) {
          item.classList.toggle('done', isAnswered(q));
          $$('.pick', item).forEach(b => b.classList.toggle('on', arr.indexOf(+b.dataset.v) > -1));
        }
      if (q && q.max) {
        const nx = $('.pick-hint[data-hint="' + no + '"] .small', app);
        if (nx) nx.textContent = arr.length >= q.max ? '已选满 ' + q.max + ' 项，想换就先点掉一个' : '还可选择 ' + (q.max - arr.length) + ' 项';
      }
        updateProgress();
        return;
      }

      /* 排序：按点击顺序入列，再点移除 */
      if (act === 'rank') {
        const no = +el.dataset.no, val = +el.dataset.v;
        const q = qByNo(no);
        let arr = Array.isArray(ui.answers[no]) ? ui.answers[no].slice() : [];
        const at = arr.indexOf(val);
        if (at > -1) arr.splice(at, 1);
        else if (q && q.max && arr.length >= q.max) arr = arr.slice(0, q.max - 1).concat([val]);
        else arr.push(val);
        ui.answers[no] = arr;
        if (arr.length) delete ui.skipped[no];
        ui.focusNo = no;
        /* 有别的条件题依赖这一题（如「睡眠不好」触发睡眠追问）：顺序一变就重算题集 */
        if (QUESTIONS.some(x => x.cond && x.cond.no === no)) rebuildQuestions();
        render();
        return;
      }

      if (act === 'unrank') {
        const no = +el.dataset.no, val = +el.dataset.v;
        let arr = Array.isArray(ui.answers[no]) ? ui.answers[no].slice() : [];
        const at = arr.indexOf(val);
        if (at > -1) arr.splice(at, 1);
        ui.answers[no] = arr;
        ui.focusNo = no;
        if (QUESTIONS.some(x => x.cond && x.cond.no === no)) rebuildQuestions();
        render();
        return;
      }

      /* 简答 / 排序题的显式跳过 */
      if (act === 'skipq') {
        const no = +el.dataset.no;
        ui.skipped[no] = true;
        if (qType(qByNo(no)) === 'text') ui.answers[no] = '';
        ui.focusNo = no;
        if (QUESTIONS.some(x => x.cond && x.cond.no === no)) rebuildQuestions();
        render();
        return;
      }

      if (act === 'step') {
        ui.assessStep = Math.max(0, ui.assessStep + (+el.dataset.d));
        render({ top: true });
        return;
      }

      if (act === 'submit') {
        if (answeredCount() < requiredCount()) {
          const list = questions();
          const missing = list.findIndex(q => !isAnswered(q));
          if (missing > -1) {
            ui.assessStep = Math.floor(missing / Q_PER_PAGE);
            ui.focusNo = list[missing].no;
            render();
            toast('请先完成标记的未作答题目');
          }
          return;
        }
        const a = computeResult(ui.answers);
        state.assessment = a;
        state.extra = collectExtra();
        /* 只补充新体质的习惯，不清除既有清单与打卡历史 */
        mergeHabits(a.primary);
        state.plan = { at: todayKey() };
        /* 历次内容一律追加，不覆盖历史 */
        pushReport(a); pushPlan(a); pushMenu(a);
        ui.retake = false;
        ui.assessStep = 0;
        save();
        if (cloudOn() && !(await flushCloudSave())) toast('测评已保存在本机，但云端同步尚未完成，请保持网络后重试');
        go('plan');
        return;
      }

      /* 再测一次：清空作答并进入量表（历史记录保留） */
      if (act === 'retake') {
        ui.retake = true; ui.answers = {}; ui.skipped = {}; ui.assessStep = 0;
        rebuildQuestions();   /* 作答清空后，条件题（如睡眠追问）要跟着退出题集 */
        go('assess');
        return;
      }

      /* 体质报告：已有结果时进入结果页 */
      if (act === 'report') { ui.retake = false; go('assess'); return; }

      /* 定制方案：标记已生成后进入方案页（方案与食谱按新记录追加） */
      if (act === 'plan-make') {
        if (!state.assessment) { go('assess'); return; }
        state.plan = { at: todayKey() };
        pushPlan(state.assessment); pushMenu(state.assessment);
        save();
        if (cloudOn() && !(await flushCloudSave())) toast('方案已保存在本机，但云端同步尚未完成，请保持网络后重试');
        go('plan');
        return;
      }

      /* ---- 登录 / 个人中心 ---- */
      if (act === 'login-open') { openModal('login'); return; }
      if (act === 'logout') { logout(); return; }

      if (act === 'mine-tab') { ui.mineTab = el.dataset.v; ui.mineId = null; render(); return; }
      if (act === 'mine-view') { ui.mineId = el.dataset.id; render(); return; }
      if (act === 'mine-back') { ui.mineId = null; render(); return; }

      /* 删除走页面内二次确认弹窗，不用系统 confirm，风格与习惯删除一致 */
      if (act === 'mine-del') {
        const rec = histById(el.dataset.id);
        if (!rec) return;
        openModal('hist-del', { id: rec.id });
        return;
      }

      if (act === 'mine-export') {
        const rec = histById(el.dataset.id);
        if (!rec) return;
        exportJson('易安堂-' + HIST_META[rec.type].label + '-' + rec.at + '.json', rec);
        toast('已导出该记录');
        return;
      }

      if (act === 'mine-export-all') {
        if (!(state.history || []).length) { toast('还没有可导出的记录'); return; }
        exportJson('易安堂-全部记录-' + todayKey() + '.json', { user: state.user, history: state.history });
        toast('已导出全部记录');
        return;
      }

      if (act === 'mine-menu') {
        if (!state.assessment) { go('assess'); return; }
        pushMenu(state.assessment);
        ui.mineTab = 'menu';
        render();
        toast('已追加一份新的七日食谱');
        return;
      }

      /* 我的方案：直接查看既有方案 */
      if (act === 'plan-view') { go('plan'); return; }

      if (act === 'toggle') { toggleHabit(el.dataset.id); render(); return; }

      /* 习惯：添加 / 修改 / 删除（删除走二次确认弹窗） */
      if (act === 'habit-add') { openModal('habit-edit', { id: '', text: '', tag: 'routine' }); return; }
      if (act === 'habit-edit') {
        const it = habitById(el.dataset.id);
        if (!it) return;
        openModal('habit-edit', { id: it.id, text: it.text, tag: it.tag });
        return;
      }
      if (act === 'habit-del') {
        const it = habitById(el.dataset.id);
        if (!it) return;
        openModal('habit-del', { id: it.id });
        return;
      }

      /* 食谱：只换这一项，其余推荐位不动 */
      if (act === 'menu-swap') {
        const cid = state.assessment ? state.assessment.primary : 'pinghe';
        const k = el.dataset.key || todayKey();
        if (menuSwap(cid, k, el.dataset.slot)) { render(); toast('已更换这一项'); }
        else toast('这一项目前只有这一种推荐');
        return;
      }

      /* 饮食画像：口味偏好 / 忌口 / 慢病标签，点击即生效并重算配餐 */
      if (act === 'diet-tag') {
        const f = el.dataset.f, v = el.dataset.v;
        state.diet = state.diet || { likes: [], avoids: [], chronic: [], avoidText: '' };
        if (!Array.isArray(state.diet[f])) state.diet[f] = [];
        const i = state.diet[f].indexOf(v);
        if (i > -1) state.diet[f].splice(i, 1); else state.diet[f].push(v);
        WP = { cid: '', start: '', sig: '', days: {} };
        save(); render();
        toast(i > -1 ? '已取消「' + v + '」' : '已应用「' + v + '」，食谱已重算');
        return;
      }

      if (act === 'diet-clear') {
        state.diet = { likes: [], avoids: [], chronic: [], avoidText: '' };
        WP = { cid: '', start: '', sig: '', days: {} };
        save(); render();
        toast('已清空饮食画像');
        return;
      }

      if (act === 'menu-offset') {
        const d = +el.dataset.d;
        ui.menuOffset = d === 0 ? 0 : (ui.menuOffset || 0) + d;
        render();
        return;
      }

      if (act === 'date') {
        const d = el.dataset.d;
        ui.recordDate = d === 'today' ? todayKey() : shiftDay(ui.recordDate || todayKey(), +d);
        render();
        return;
      }

      if (act === 'symptom') {
        const k = ui.recordDate || todayKey();
        const r = state.records[k] || (state.records[k] = {});
        const arr = r.symptoms || (r.symptoms = []);
        const i = arr.indexOf(el.dataset.v);
        if (i > -1) arr.splice(i, 1); else arr.push(el.dataset.v);
        save();
        el.classList.toggle('on');
        return;
      }

      if (act === 'metric') { ui.metric = el.dataset.v; render(); return; }

      /* 打卡热力图：切换 30 / 60 / 90 天 */
      if (act === 'heat-range') { ui.heatRange = +el.dataset.v; render(); return; }

      /* ---- 经期（仅女性用户可见） ---- */
      if (act === 'pd-day') { periodDraft().day = +el.dataset.v; ui.periodErr = ''; render(); return; }
      if (act === 'pd-flow') { periodDraft().flow = el.dataset.v; ui.periodErr = ''; render(); return; }
      if (act === 'pd-sore') { periodDraft().sore = el.dataset.v; ui.periodErr = ''; render(); return; }
      if (act === 'pd-pain') {
        const d = periodDraft();
        d.pain = el.dataset.v;
        if (d.pain !== 'yes') d.painLevel = '';
        ui.periodErr = ''; render();
        return;
      }
      if (act === 'pd-painlevel') { periodDraft().painLevel = el.dataset.v; ui.periodErr = ''; render(); return; }
      if (act === 'saveperiod') { periodSave(); return; }

      /* 周期恢复自动推算：清掉手动标记后按已有记录重算 */
      if (act === 'pd-cycle-auto') {
        state.period = state.period || { logs: {} };
        state.period.cycleMan = false;
        const auto = periodAutoCycle();
        state.period.cycle = auto > 0 ? auto : PERIOD_CYCLE_DEFAULT;
        ui.periodErr = '';
        save(); render();
        toast(auto > 0 ? '已按记录重算：周期 ' + auto + ' 天' : '记录不足两次，已恢复默认 ' + PERIOD_CYCLE_DEFAULT + ' 天');
        return;
      }
      if (act === 'delperiod') {
        if (periodLogs()[todayKey()]) {
          delete state.period.logs[todayKey()];
          ui.period = null; ui.periodErr = '';
          save(); render(); toast('已删除今日经期记录');
        }
        return;
      }
      if (act === 'pcal-month') {
        const d = +el.dataset.d;
        ui.periodMonth = d === 0 ? '' : shiftMonth(ui.periodMonth || todayKey().slice(0, 7), d);
        render();
        return;
      }

      if (act === 'saverec') {
        const k = ui.recordDate || todayKey();
        const prev = state.records[k] || {};
        const rec = {
          weight: +$('#f_weight').value || 0,
          sleep: +$('#f_sleep').value || 0,
          bedtime: $('#f_bedtime').value || '',
          energy: +$('#f_energy').value || 0,
          mood: +$('#f_mood').value || 0,
          stool: $('#f_stool').value || '',
          tongue: $('#f_tongue').value || '',
          symptoms: prev.symptoms || [],
          note: $('#f_note').value || ''
        };
        state.records[k] = rec;
        save();
        render();
        toast('已保存 ' + k + ' 的记录');
        return;
      }

      if (act === 'delrec') {
        delete state.records[el.dataset.k];
        save(); render();
        return;
      }

      if (act === 'saveprofile') {
        state.profile.height = $('#w_height').value || '';
        state.weight.goal = $('#w_goal').value || '';
        save(); render(); toast('档案已保存');
        return;
      }

      if (act === 'delw') {
        const r = state.records[el.dataset.k];
        if (r) { delete r.weight; delete r.bodyfat; }
        save(); render();
        return;
      }

      /* ---- 体重方案：页面内一步生成 ---- */
      if (act === 'wm-gender') {
        wmForm().gender = el.dataset.v;
        $$('[data-action="wm-gender"]', app).forEach(b => b.classList.toggle('on', b === el));
        wmClearErr();
        return;
      }

      if (act === 'wmchip') {
        const key = el.dataset.f, val = el.dataset.v;
        const f = wmForm();
        const arr = f[key] || (f[key] = []);
        const i = arr.indexOf(val);
        if (i > -1) arr.splice(i, 1); else arr.push(val);
        el.classList.toggle('on', i === -1);
        return;
      }

      if (act === 'wmgen') { wmGenerate(); return; }

      if (act === 'wm-export') {
        const p = state.weight.plan;
        if (!p) { toast('还没有生成方案'); return; }
        exportJson('易安堂-体重管理方案-' + (p.at || todayKey()) + '.json', p);
        toast('方案已导出为 JSON 文件');
        return;
      }

      if (act === 'export') {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'tcm-health-' + todayKey() + '.json';
        a.click();
        return;
      }

      if (act === 'import') { $('#fileIn').click(); return; }

      if (act === 'reset') {
        if (!confirm('将清空体质测评、打卡、食谱与全部身体记录，且不可恢复。确定继续？')) return;
        const accountUser = state.user ? Object.assign({}, state.user) : null;
        const accountOwner = state.owner || '';
        const accountProfile = state.profile ? {
          name: state.profile.name || '', gender: state.profile.gender || '', age: state.profile.age || '', height: ''
        } : { name: '', gender: '', age: '', height: '' };
        state = JSON.parse(JSON.stringify(DEFAULT_STATE));
        state.user = accountUser; state.owner = accountOwner; state.profile = accountProfile;
        clearLoginMark();
        ui.answers = {}; ui.skipped = {}; ui.assessStep = 0; ui.retake = false; ui.menuOffset = 0;
        ui.mineId = null; ui.mineTab = 'all'; ui.tmpGender = null;
        ui.heatRange = 30; ui.period = null; ui.periodMonth = ''; ui.periodErr = '';
        rebuildQuestions(); syncUserEntry();
        save(); go('home');
        return;
      }
    });

    /* 体重方案表单：实时写入草稿，不重绘（保证报错重绘后已填内容不丢） */
    const wmSync = e => {
      const el = e.target;
      if (!el || !el.classList || !el.classList.contains('wminput')) return;
      wmForm()[el.dataset.f] = el.value;
      if (el.dataset.f === 'target' || el.dataset.f === 'height') wmLiveTargetCheck();
      else wmClearErr();
    };
    app.addEventListener('input', wmSync);
    app.addEventListener('change', wmSync);

    /* 经期「第几天」数字输入：实时写入草稿，不重绘，避免打断输入 */
    const pdSync = e => {
      const el = e.target;
      if (!el || !el.classList || !el.classList.contains('pdinput')) return;
      if (el.dataset.f === 'cycle') {
        state.period = state.period || { logs: {} };
        state.period.cycle = el.value === '' ? '' : +el.value;
        state.period.cycleMan = true;
        ui.periodErr = '';
        save();
        return;
      }
      const d = periodDraft();
      d[el.dataset.f] = el.value;
      ui.periodErr = '';
      if (el.dataset.f === 'day') {
        $$('[data-action="pd-day"]', app).forEach(b => b.classList.toggle('on', +b.dataset.v === +el.value));
      }
    };
    app.addEventListener('input', pdSync);
    app.addEventListener('change', pdSync);

    /* 饮食画像自由填写：实时写入不重绘，失焦后重算配餐 */
    const dietSync = e => {
      const el = e.target;
      if (!el || !el.classList || !el.classList.contains('diet-input')) return;
      state.diet = state.diet || { likes: [], avoids: [], chronic: [], avoidText: '' };
      state.diet.avoidText = el.value;
      save();
    };
    app.addEventListener('input', dietSync);
    app.addEventListener('change', e => {
      const el = e.target;
      if (el && el.classList && el.classList.contains('diet-input')) {
        WP = { cid: '', start: '', days: {} };
        render();
      }
    });

    /* 简答输入：实时写入，不重绘 */
    app.addEventListener('input', e => {
      const el = e.target;
      if (!el || !el.classList || !el.classList.contains('qinput')) return;
      const no = +el.dataset.no;
      ui.answers[no] = el.value;
      if (el.value.trim() !== '') delete ui.skipped[no];
      const item = el.closest('.qitem');
      if (item) item.classList.toggle('done', isAnswered(qByNo(no)));
      updateProgress();
    });
  }

  const datePick = $('#recDate');
  if (datePick) datePick.addEventListener('change', e => { ui.recordDate = e.target.value; render(); });

  const wDate = $('#wDate');
  if (wDate) wDate.addEventListener('change', e => { ui.wDate = e.target.value || todayKey(); render(); });

  const fileIn = $('#fileIn');
  if (fileIn) fileIn.addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast('备份文件不能超过 10 MB'); e.target.value = ''; return; }
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        const s = JSON.parse(rd.result);
        const account = cloudUser();
        if (cloudOn() && !account) throw new Error('请先登录需要接收数据的账号，再执行导入');
        const activeUser = state.user ? JSON.parse(JSON.stringify(state.user)) : null;
        const merged = mergeImportedAccountState(state, s, (account && account.id) || state.owner || '', activeUser);
        const skippedHistory = merged._importSkippedHistory || 0;
        delete merged._importSkippedHistory;
        if (!confirm('将把备份数据合并到当前账号。现有记录不会被整库替换，重复记录会自动去除。继续吗？')) { e.target.value = ''; return; }
        exportJson('易安堂-导入前自动备份-' + todayKey() + '.json', state);
        state = merged;
        rebuildQuestions(); syncUserEntry();
        save(); render();
        const synced = !cloudOn() || await flushCloudSave();
        const baseMsg = skippedHistory ? '数据已安全合并，已跳过 ' + skippedHistory + ' 条无效历史记录' : '数据已安全合并到当前账号';
        toast(synced ? baseMsg : baseMsg + '；本机已保存，但云端同步尚未完成');
      } catch (err) { toast(err && err.message ? err.message : '备份格式或数据内容不正确，未导入'); }
      e.target.value = '';
    };
    rd.readAsText(f);
  });

  $$('input[type=range]').forEach(r => {
    const out = r.parentElement.querySelector('output');
    if (out) r.addEventListener('input', () => { out.textContent = r.value; });
  });
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2200);
}

async function bootCloudAuth(initialScroll) {
  if (!cloudOn()) return false;
  if (typeof EYAuth.ensureSession === 'function') await EYAuth.ensureSession();
  const u = cloudUser();
  if (u) {
    state.user = cloudIdentity({ user: u });
    CLOUD_SYNC.ready = false;
    try {
      const profile = await EYCloud.getProfile();
      if (profile && profile.nickname && ['female', 'male'].includes(profile.gender) && (+profile.age >= 1 && +profile.age <= 120)) {
        state.user.name = profile.nickname; state.user.gender = profile.gender; state.user.age = +profile.age;
        await hydrateCloudState(initialScroll);
      } else {
        await EYAuth.signOut();
        state.user = null; state.owner = ''; resetPersonalData();
        ui.authMode = 'register'; ui.authNotice = '账号资料不完整，请重新注册';
        render(initialScroll == null ? { top: true } : { scroll: initialScroll }); openModal('login'); return true;
      }
    } catch (e) { toast('账号已登录，但云端数据暂时无法读取'); }
    syncUserEntry(); render();
    return true;
  }
  state.user = null;
  syncUserEntry();
  ui.authMode = 'register';
  render(initialScroll == null ? { top: true } : { scroll: initialScroll });
  if (!state.guestSkip) openModal('login');
  return false;
}

async function checkForUpdate() {
  try {
    if (typeof EYAuth !== 'undefined' && EYAuth.preview && EYAuth.preview()) return;
    const cfg = window.EY_CONFIG || {};
    const url = cfg.APP_VERSION_URL || './version.json';
    const res = await fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const remote = await res.json();
    const key = 'tcm_health_app_version';
    const local = localStorage.getItem(key);
    if (local && remote.version && local !== remote.version) {
      toast('发现新版本：' + (remote.message || '请刷新页面更新'));
    }
    if (remote.version) localStorage.setItem(key, String(remote.version));
  } catch (e) { /* 更新提示失败不影响正常使用 */ }
}

/* ---------------- 启动 ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  /* 刷新 / 前进后退 → 恢复原页面与原位置；首次打开 → 从顶部开始 */
  const bootY = spBoot();
  spInit();

  $$('#nav a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); go(a.dataset.page); }));

  /* 右上角 / 左上角登录入口：未登录弹窗，已登录进个人中心 */
  const entry = $('#userEntry');
  if (entry) entry.addEventListener('click', () => { if (isLogin()) go('mine'); else openModal('login'); });

  /* 弹窗独立于 #app，单独委托 */
  const host = $('#modalHost');
  if (host) {
    host.addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const act = el.dataset.action;
      if (act === 'modal-close') { closeModal(); return; }
      if (act === 'pick-gender') {
        ui.tmpGender = el.dataset.v;
        $$('.seg', host).forEach(b => b.classList.toggle('on', b === el));
        const err = $('#lgErr'); if (err) err.hidden = true;
        return;
      }
      if (act === 'login-submit') { submitLogin(); return; }
      if (act === 'auth-mode-register' || act === 'auth-mode-restore') {
        ui.authMode = act === 'auth-mode-restore' ? 'restore' : 'register';
        ui.authNotice = ''; ui.loginAsk = false; renderModal(); return;
      }
      if (act === 'recovery-copy') {
        const code = ui.recovery && ui.recovery.code;
        if (!code) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(() => toast('恢复码已复制')).catch(() => toast('复制失败，请手动记录恢复码'));
        } else toast('当前浏览器不支持自动复制，请手动记录恢复码');
        return;
      }
      if (act === 'recovery-done') {
        ui.recovery = null; ui.authMode = 'register'; closeModal(); syncUserEntry(); render(); toast('注册完成，已保持登录'); return;
      }
      /* 登录弹窗右上角 × → 先弹二次确认层；返回登录 → 收起确认层；仍要跳过 → 两层一起关 */
      if (act === 'login-ask') { ui.loginAsk = true; renderModal(); return; }
      if (act === 'login-ask-back') { ui.loginAsk = false; renderModal(); return; }
      if (act === 'login-ask-give-up') { giveUpLogin(); return; }
      if (act === 'habit-edit-save') { submitHabitEdit(); return; }
      if (act === 'habit-del-yes') {
        const id = el.dataset.id;
        deleteHabit(id);
        closeModal();
        render();
        toast('已删除该习惯及其打卡记录');
        return;
      }
      if (act === 'hist-del-yes') {
        const id = el.dataset.id;
        state.history = (state.history || []).filter(r => r.id !== id);
        if (ui.mineId === id) ui.mineId = null;
        closeModal();
        save();
        render();
        toast('已删除该记录');
        return;
      }
    });
    host.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.target.id === 'lg_name' || e.target.id === 'lg_age' || e.target.id === 'lg_recovery')) { submitLogin(); }
      if (e.key === 'Enter' && e.target.id === 'hb_text') { submitHabitEdit(); }
      /* Esc：确认层开着时先收起确认层，再按一次才关弹窗 */
      if (e.key === 'Escape') { if (ui.loginAsk) { ui.loginAsk = false; renderModal(); } else closeModal(); }
    });
  }

  /* 云端账号优先；未配置云端时才启用旧版本机 cookie 兜底。 */
  if (cloudOn()) {
    bootCloudAuth(bootY);
  } else {
  /* 兜底恢复：localStorage 因 origin（协议/端口）变化读不到登录态时，用 cookie 标记自动补回，
     避免「明明登录过、换个入口打开又要重新登录」。只恢复昵称/性别/年龄三项，测评与方案仍在原 origin。 */
  if (!isLogin() && !state.guestSkip) {
    const mk = readLoginMark();
    if (mk) {
      state.user = { name: mk.n, gender: mk.g, age: mk.a, since: todayKey() };
      state.owner = mk.n;
      state.profile.name = mk.n;
      state.profile.gender = mk.g === 'female' ? '女' : '男';
      state.profile.age = String(mk.a);
      rebuildQuestions();
      save();
      syncUserEntry();
      render({ top: true });
      toast('已从本机登录记录恢复：' + mk.n);
    }
  }

  syncUserEntry();
  render({ scroll: bootY });
  /* 首次访问（新设备 / 清除浏览器数据后）与退出登录后再次访问：自动弹出登录弹窗；
     登录前页面只展示默认占位内容，不读取任何个性化数据。
     用户曾主动选择「放弃登录」（guestSkip）则不再打扰，可随时从右上角入口登录 */
  if (!isLogin() && !state.guestSkip) openModal('login');
  }
  /* 存储不可用时必须让用户看见，否则「登录了却没记住」无从解释 */
  if (SAVE_WARN) toast('本机浏览器不允许保存数据（可能处于无痕模式），登录状态刷新后会丢失');
  checkForUpdate();
});
