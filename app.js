// 康复AI · 火柴人姿势分析 — 浏览器端 App（手机/电脑通用，数据存本机）
// 支持：深蹲/弓步蹲/俯卧撑/自定义动作、实时火柴人、数据采集闭环、记录/评估/日程
import { FilesetResolver, PoseLandmarker } from './vision_bundle.mjs';
import { t, getLang, locale, initI18n, onLangChanged } from './i18n.js';
import {
  EXERCISES, analyzeAny, loadCustomExercises, saveCustomExercises,
  customDefault, CUSTOM_JOINTS, angle3, kneeValgus, pickSide, setCustomKey,
  verticalAngle,
} from './analysis.js';
import { healthCheck, buildFeedbackReport, logAiError, aiErrors, aiStats, aiStatsGet, aiFeedbackAdd, aiSessionComment } from './ai.js';

/* ============ 基础工具 ============ */
const $ = (id) => document.getElementById(id);
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};
// ============ 账号系统：本地账号（PBKDF2 加密）+ 按账号分区存储 ============
const accountCurrent = () => LS.get('rehab_current_user', null);
const ukey = (k) => { const u = accountCurrent(); return u ? 'u:' + u + ':' + k : k; };
const sget = (k, d) => LS.get(ukey(k), d);
const sset = (k, v) => LS.set(ukey(k), v);
const sdel = (k) => localStorage.removeItem(ukey(k));
const b64e = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64d = (s) => new Uint8Array([...atob(s)].map((c) => c.charCodeAt(0)));
async function pbkdf2(pass, salt) {
  if (!crypto?.subtle) {   // 非安全环境兜底（简单散列，仅本地体验用）
    let h = 5381;
    const str = pass + ':' + String.fromCharCode(...new Uint8Array(salt));
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return 'djb2:' + h;
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return b64e(bits);
}
const accounts = () => LS.get('rehab_accounts', {});
async function accountRegister(email, pass) {
  const list = accounts();
  if (list[email]) throw new Error(t('acctExists'));
  if (!pass || pass.length < 6) throw new Error(t('acctPassShort'));
  const salt = crypto?.getRandomValues ? crypto.getRandomValues(new Uint8Array(16)) : new Uint8Array(16);
  list[email] = { salt: b64e(salt), hash: await pbkdf2(pass, salt) };
  LS.set('rehab_accounts', list);
}
async function accountLogin(email, pass) {
  const a = accounts()[email];
  if (!a) throw new Error(t('acctNotFound'));
  const hash = await pbkdf2(pass, b64d(a.salt));
  if (hash !== a.hash) throw new Error(t('acctWrongPass'));
  LS.set('rehab_current_user', email);
  LS.set('rehab_guest', false);
  setCustomKey(ukey('rehab_custom_ex'));
}
function accountLogout() {
  localStorage.removeItem('rehab_current_user');
  localStorage.removeItem('rehab_guest');
  setCustomKey(ukey('rehab_custom_ex'));
}
// 删除账号：清除该账号全部分区数据 + 账号条目（Google Play 政策要求提供账号删除入口）
function accountDelete() {
  const u = accountCurrent();
  if (!u) return;
  const prefix = 'u:' + u + ':';
  Object.keys(localStorage).forEach((k) => { if (k.startsWith(prefix)) localStorage.removeItem(k); });
  const list = accounts();
  delete list[u];
  LS.set('rehab_accounts', list);
  localStorage.removeItem('rehab_migrated_to');
  accountLogout();
  localStorage.removeItem('rehab_cloud_session');
  invalidateCustom();
  reloadCollectBuf();                               // 删除账号 → 重载缓冲区（访客空间）
  renderCloud(); renderAuth();
  renderRecords(); renderAssessments(); renderAppts(); renderCustomList(); renderExChips();
  renderProfile(); renderTodayPlan(); renderPlanList(); renderAchievements(); renderCollectCount(); renderGoal();
  toast(t('acctDeleted'));
}
// 首次注册账号时，把本机原有数据迁移进账号空间
function migrateDeviceData(email) {
  if (LS.get('rehab_migrated_to', null)) return;
  const keys = ['rehab_sessions', 'rehab_assessments', 'rehab_appts', 'rehab_custom_ex', 'rehab_collect', 'rehab_plan', 'rehab_plan_done', 'rehab_profile'];
  let any = false;
  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v !== null && localStorage.getItem('u:' + email + ':' + k) === null) {
      localStorage.setItem('u:' + email + ':' + k, v);
      localStorage.removeItem(k);
      any = true;
    }
  }
  if (any) LS.set('rehab_migrated_to', email);
}
const fmtDate = (ts) => new Date(ts).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const APP_VERSION = 'v2.17.6';
const exName = (e) => (e.custom ? e.name : t(e.nameKey));
const exDesc = (e) => (e.custom ? e.desc : t(e.descKey));
const depthTxt = (d) => t('depth' + (d ? d.charAt(0).toUpperCase() + d.slice(1) : 'Ok')) || d;

/* ============ 定制图标组（线稿风格，替代 emoji） ============ */
const ICONS = {
  squat: '<circle cx="12" cy="4.6" r="2.1"/><path d="M12 6.7v5.8M12 12.5 8.6 15.6 10.8 19.6M12 9.6l4.2-.8"/>',
  lunge: '<circle cx="9.8" cy="4.6" r="2.1"/><path d="M9.8 6.7v5.5M9.8 12.2l4.8 2.9 4.6 4.4M9.8 12.2l-4.2 2.3-2.2 4.6M9.8 9l4.4-1"/>',
  pushup: '<circle cx="5.2" cy="9.2" r="2.1"/><path d="M7.3 9.6 16.8 12.4M8.4 10 8.4 16.2M17.9 12.8v-1.5"/>',
  sitstand: '<circle cx="12" cy="4.6" r="2.1"/><path d="M12 6.7v5.8M12 12.5l-3.6 2.8-1.2 3.6M12 12.5l3.6 2.8 1.2 3.6M12 9.5l-4.2-.8M12 9.5l4.2-.8"/><path d="M3.5 20.5h17"/>',
  hiphinge: '<circle cx="13" cy="4.8" r="2.1"/><path d="M13 6.9v4.6M13 11.5l-5.5 1.2M7.5 12.7l1.5 4M7.5 12.7l6.5 2.3M14 15l1 4M13 8.5l-4.5-.5"/>',
  stepup: '<circle cx="11" cy="4.4" r="2.1"/><path d="M11 6.5v4.2M11 10.7l3.6 2.4 1 3.6M11 10.7l-3 2.2-2.8 1M11 8l-4.4-1M11 8l4-1"/><path d="M2.5 20.5h19"/>',
  shoulderraise: '<circle cx="12" cy="4.4" r="2.1"/><path d="M12 6.5v6M12 12.5l-3 4M12 12.5l3 4M12 9l-4-1.2M12 9l4.5 1.8M16.5 10.8l1.5-4.5"/>',
  standing: '<circle cx="12" cy="4.2" r="2.1"/><path d="M12 6.3v5.4M12 8l-4.2-1M12 8l4.2-1M12 11.7v4.6M12 16.3l-3.8-.2M12 16.3l3.8-.2"/>',
  sitting: '<circle cx="12" cy="5.2" r="2.1"/><path d="M12 7.3v3.4M12 8.6l-4-1M12 8.6l4-1M12 10.7l4.2 2.6M16.2 13.3v5M12 10.7l-4.2 2.6M7.8 13.3v5M4 20.5h16"/>',
  custom: '<path d="M12 4.5l1.4 4.1 4.1 1.4-4.1 1.4L12 15.5l-1.4-4.1-4.1-1.4 4.1-1.4Z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7Z"/>',
  play: '<path d="M8.2 5.6v12.8a.7.7 0 0 0 1.1.6l10.2-6.4a.7.7 0 0 0 0-1.2L9.3 5a.7.7 0 0 0-1.1.6Z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.8" y="6.8" width="10.4" height="10.4" rx="2.4" fill="currentColor" stroke="none"/>',
  loader: '<path d="M12 4a8 8 0 1 1-8 8" stroke-width="2.4"/>',
  retry: '<path d="M20 11a8 8 0 1 0-.9 4.4M20 5v6h-6"/>',
  camera: '<path d="M4 8.8A2.2 2.2 0 0 1 6.2 6.6h1.6L9.5 4.4h5l1.7 2.2h1.6A2.2 2.2 0 0 1 20 8.8v7.6a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 16.4Z"/><circle cx="12" cy="12.4" r="3.2"/>',
  image: '<rect x="3.8" y="5.2" width="16.4" height="13.6" rx="2.2"/><circle cx="9.2" cy="10" r="1.5"/><path d="M4.8 17.2l5-4.6 3.6 3.2 2.9-2.6 2.9 2.8"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<circle cx="12" cy="12" r="8.2"/><path d="M12 8.2v4.6M12 15.9h.01"/>',
  record: '<path d="M5 20v-8.5M12 20V4.5M19 20V11M3.8 20h16.4"/>',
  assess: '<rect x="6.5" y="4.2" width="11" height="16.2" rx="2.2"/><path d="M9.4 4.2v-1a1 1 0 0 1 1-1h3.2a1 1 0 0 1 1 1v1M9.2 13.6l2.1 2.1 3.7-4.4"/>',
  schedule: '<rect x="4.2" y="5.8" width="15.6" height="14.4" rx="2.2"/><path d="M4.2 10h15.6M8.4 3.8v3M15.6 3.8v3M8.6 14.5h2M13.4 14.5h2M8.6 17h2"/>',
  sliders: '<path d="M4.5 7.5h15M4.5 16.5h15"/><circle cx="9.5" cy="7.5" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="16.5" r="1.7" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  edit: '<path d="M4 20l.8-3.5L16.5 4.8a1.8 1.8 0 0 1 2.6 0l.1.1a1.8 1.8 0 0 1 0 2.6L7.5 19.2 4 20Z"/>',
  trash: '<path d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7M6.5 7l.8 11.5a2 2 0 0 0 2 2h5.4a2 2 0 0 0 2-2L17.5 7M10 11v6M14 11v6"/>',
  star: '<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8Z"/>',
  medal: '<circle cx="12" cy="9" r="4.5"/><path d="M9.5 13 8 20.5l4-2.2 4 2.2L14.5 13"/>',
  target: '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 5.5H4.5v1A3.5 3.5 0 0 0 8 10M17 5.5h2.5v1A3.5 3.5 0 0 1 16 10M12 14v3M8.5 20h7M10 17h4"/>',
  flame: '<path d="M12 3.5c1 3-2.5 4.5-2.5 8a2.5 2.5 0 0 0 5 0c0-1.5-.5-2.5-.5-2.5 2.5 1 5 3.5 5 6.5a7 7 0 1 1-14 0c0-4.5 4-6.5 7-9.5Z"/>',
  flask: '<path d="M9.5 3.5h5M10.5 3.5v5L5.5 17a2.5 2.5 0 0 0 2.2 3.7h8.6a2.5 2.5 0 0 0 2.2-3.7L13.5 8.5v-5M7.5 14.5h9"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  download: '<path d="M12 4v10m0 0-4-4m4 4 4-4M5 19h14"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.2 6.1M20 5v6h-6"/>',
  bell: '<path d="M6 9.5a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13.5 6 9.5Z"/><path d="M10 18.5a2 2 0 0 0 4 0"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.95A6 6 0 0 1 18 9.7 4 4 0 0 1 17.5 18Z"/>',
};
function icon(name, cls = '') {
  if (name === 'loader-spin') { name = 'loader'; cls = 'spin ' + cls; }
  const d = ICONS[name] || ICONS.custom;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
const fbWrap = (ico, html) => `<span class="fb-ico">${icon(ico)}</span><div class="fb-body">${html}</div>`;
const emptyBox = (ico, key) => `<div class="empty">${icon(ico)}<span>${t(key)}</span></div>`;

/* ============ 火柴人绘制 ============ */
const BODY = '#4ade80', JOINT = '#22d3ee', BAD = '#ef4444', HEAD = '#facc15';
const CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS.map((c) => [c.start, c.end]);
let currentVG = null;

function drawStick(ctx, lms, w, h, mirror) {
  const px = (lm) => { let x = lm.x * w; if (mirror) x = w - x; return [x, lm.y * h]; };
  const vis = (lm) => (lm.visibility ?? 1) >= 0.5;   // 只画可见关节，避免幽灵线条
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = BODY; ctx.lineWidth = Math.max(3, w * 0.008);
  ctx.shadowColor = BODY; ctx.shadowBlur = 8;
  ctx.beginPath();
  for (const [a, b] of CONNECTIONS) {
    if (!vis(lms[a]) || !vis(lms[b])) continue;
    const [x1, y1] = px(lms[a]), [x2, y2] = px(lms[b]);
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  if (vis(lms[0])) {
    const [hx, hy] = px(lms[0]);
    ctx.fillStyle = HEAD; ctx.shadowColor = HEAD;
    ctx.beginPath(); ctx.arc(hx, hy, Math.max(6, w * 0.016), 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < lms.length; i++) {
    if (!vis(lms[i])) continue;
    const [jx, jy] = px(lms[i]);
    const bad = (i === 25 || i === 26) && currentVG?.valgus;
    ctx.fillStyle = bad ? BAD : JOINT; ctx.shadowColor = ctx.fillStyle;
    ctx.beginPath(); ctx.arc(jx, jy, Math.max(2.5, w * 0.006), 0, Math.PI * 2); ctx.fill();
  }
  ctx.shadowBlur = 0;
}

/* ============ 状态 ============ */
const state = {
  running: false, photoMode: false, collectMode: false,
  landmarker: null, videoOn: false,
  counter: null, agg: null, lastTS: 0,
  ex: null, collectBuf: sget('rehab_collect', []),
  cameras: null, pickCam: undefined,
  tab: 'train', statsKey: null, loopScheduled: false,
  autoEx: 'standing', autoVotes: {}, autoVoteN: 0, autoHist: [], autoLast4: [],
};
let _customCache = null;
const customList = () => { if (_customCache === null) _customCache = loadCustomExercises(); return _customCache; };
const invalidateCustom = () => { _customCache = null; };
const getEx = (id) => {
  if (id === 'auto') return EXERCISES[state.autoEx] || EXERCISES.squat;
  return EXERCISES[id] || customList().find((e) => e.id === id);
};
const activeExId = () => LS.get('rehab_active_ex', 'auto');   // 默认智能识别

/* ============ AI 模型加载（多镜像 + 超时保护） ============ */
// jsDelivr 镜像国内访问更快（同仓库文件）；googleapis 作最后兜底
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/xushengqin666-cell/rehab-ai@main';
const GOOGLE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const withTimeout = (p, ms) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error('模型加载超时(网络慢)')), ms)),
]);
async function loadModel() {
  // wasm 运行时：本地优先，失败走 jsDelivr（国内速度快）
  let vision;
  try { vision = await FilesetResolver.forVisionTasks('./wasm'); }
  catch { vision = await FilesetResolver.forVisionTasks(CDN_BASE + '/wasm'); }
  const mk = (modelAssetPath, delegate) => PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath, delegate },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  const urls = ['./pose_landmarker_full.task', CDN_BASE + '/pose_landmarker_full.task', GOOGLE_MODEL_URL];
  let lastErr = null;
  for (const url of urls) {
    try {
      try { return await withTimeout(mk(url, 'GPU'), 90000); }
      catch { return await withTimeout(mk(url, 'CPU'), 90000); }
    } catch (e) { lastErr = e; console.warn('模型加载失败:', url, e); }
  }
  throw new Error(t('modelLoadFail') + (lastErr ? ' — ' + lastErr.message : ''));
}

/* ============ 摄像头（增强版：诊断 / 多设备 / 超时 / 重试） ============ */
function detectCameras() {
  return navigator.mediaDevices.enumerateDevices()
    .then((ds) => ds.filter((d) => d.kind === 'videoinput'))
    .catch(() => []);
}
function cameraErrorText(e) {
  switch (e.name) {
    case 'NotAllowedError': return t('errNotAllowed');
    case 'NotFoundError':
    case 'NoCamera': return t('errNotFound');
    case 'NotReadableError': return t('errNotReadable');
    case 'OverconstrainedError': return t('errOverconstrained');
    case 'SecurityError': return t('errSecurity');
    case 'TimeoutError': return t('errTimeout');
    default: return t('errUnknown', { msg: e.message || e.name || t('permUnknown') });
  }
}
async function openCameraWithTimeout(constraints, ms = 20000) {
  return Promise.race([
    navigator.mediaDevices.getUserMedia(constraints),
    new Promise((_, rej) => setTimeout(() => rej(new DOMException('打开超时', 'TimeoutError')), ms)),
  ]);
}
async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new DOMException('浏览器不支持或非安全环境', 'SecurityError');
  }
  state.cameras = await detectCameras();
  if (!state.cameras.length) throw new DOMException('未检测到摄像头', 'NoCamera');
  const isIRLabel = (s) => /ir|红外/i.test(s || '');
  // 红外摄像头拍出来是全黑的 —— 把非 IR 设备排在前面，并跳过 IR 流
  const devs = state.cameras.filter((c) => c.deviceId).sort((a, b) => (isIRLabel(a.label) ? 1 : 0) - (isIRLabel(b.label) ? 1 : 0));
  const nonIR = devs.filter((d) => !isIRLabel(d.label));
  const candidates = [
    { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },   // 低配设备兜底
    ...devs.map((c) => ({
      video: { deviceId: { exact: c.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    })),
  ];
  let lastErr = null;
  for (const c of candidates) {
    try {
      const stream = await openCameraWithTimeout(c);
      const label = stream.getVideoTracks()[0]?.label || '';
      if (isIRLabel(label) && nonIR.length) {   // 选到了红外摄像头 → 停掉，换下一个候选
        stream.getTracks().forEach((t) => t.stop());
        continue;
      }
      return stream;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
async function bindStream(stream) {
  const video = $('video');
  video.srcObject = stream;
  await new Promise((res, rej) => {
    if (video.readyState >= 1) return res();
    const t = setTimeout(() => {
      video.srcObject = null; stream.getTracks().forEach((x) => x.stop());
      rej(new DOMException('视频初始化超时', 'TimeoutError'));
    }, 6000);
    video.onloadedmetadata = () => { clearTimeout(t); res(); };
  });
  try { await video.play(); } catch { /* 自动播放被拦时等待用户再点 */ }
  state.videoOn = true;
  $('placeholder').classList.add('hidden');
}
function permText(s) {
  return { granted: t('permGranted'), prompt: t('permPrompt'), denied: t('permDenied') }[s] || t('permUnknown');
}
function browserName() {
  return navigator.userAgent.includes('Edg') ? 'Edge' : navigator.userAgent.includes('Chrome') ? 'Chrome' : t('diagOther');
}
function showCameraError(e, modelFail = false) {
  const box = $('cam-retry');
  box.classList.remove('hidden');
  state._lastCamErr = e;
  state._lastCamIsModel = modelFail;
  aiStats(modelFail ? 'modelFail' : 'cameraFail');      // AI 管家记录诊断
  logAiError(modelFail ? 'model' : 'camera', (e && (e.message || e.name)) || 'unknown');
  const cams = state.cameras || [];
  const camBtns = !modelFail && cams.length > 1
    ? `<div class="retry-row">${t('retryCams', { n: cams.length })}${
        cams.map((c, i) => `<button class="btn small" data-cam="${i}"><span class="btn-ico">${icon('camera')}</span>${c.label || t('camLabel', { n: i + 1 })}</button>`).join('')}</div>`
    : '';
  const errText = modelFail ? t('errUnknown', { msg: e.message || e.name }) : cameraErrorText(e);
  box.innerHTML = `
    <div class="retry-card">
      <b>${modelFail ? t('modelFailTitle') : t('retryTitle')}</b>
      <p class="hint">${errText}</p>
      ${camBtns}
      <div class="retry-row">
        <button class="btn primary" id="btn-cam-retry"><span class="btn-ico">${icon('retry')}</span><span>${t('btnRetry')}</span></button>
        <button class="btn" id="btn-cam-photo"><span class="btn-ico">${icon('image')}</span><span>${t('btnUsePhoto')}</span></button>
      </div>
      <p class="hint tiny" id="cam-diag"></p>
    </div>`;
  $('btn-cam-retry').addEventListener('click', () => { box.classList.add('hidden'); toggleStart(); });
  $('btn-cam-photo').addEventListener('click', () => { box.classList.add('hidden'); $('photo-input').click(); });
  box.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => {
    state.pickCam = +b.dataset.cam;
    box.classList.add('hidden');
    toggleStart();
  }));
  const renderDiag = (perm) => {
    $('cam-diag').textContent = t('diag', { n: cams.length, p: permText(perm), b: browserName() });
  };
  let perm = 'unknown';
  renderDiag(perm);
  try {
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'camera' }).then((s) => { perm = s.state; renderDiag(perm); }).catch(() => {});
    }
  } catch { /* ignore */ }
}
function stopCamera() {
  const video = $('video');
  if (video.srcObject) video.srcObject.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  state.videoOn = false;
}
// 手动选择摄像头（黑屏时切换用）
function showCamPicker() {
  const box = $('cam-retry');
  box.classList.remove('hidden');
  state._lastCamErr = null;
  const cams = state.cameras || [];
  box.innerHTML = `
    <div class="retry-card">
      <b>${t('camPickerTitle')}</b>
      <div class="retry-row">${cams.map((c, i) => `<button class="btn small" data-cam="${i}"><span class="btn-ico">${icon('camera')}</span>${c.label || t('camLabel', { n: i + 1 })}</button>`).join('')}</div>
      <p class="hint tiny">${t('camPickerHint')}</p>
    </div>`;
  box.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => {
    state.pickCam = +b.dataset.cam;
    box.classList.add('hidden');
    toggleStart();
  }));
}

/* ============ 智能动作识别（自动分类，无需手动选动作） ============ */
// 两层判断：
//   1) 运动层：髋部近 1.5 秒纵向位移幅度 → 区分「运动」(动态动作) 与「静止」(体态)
//   2) 几何层：动态 → 按关节角度判深蹲/弓步/台阶/搬物/肩上举/俯卧撑；静止 → 站姿/坐姿/俯卧撑支撑/搬物保持
// hist = [{ y, t }] 髋部中点高度历史（t 用 performance.now 同一时间轴）；now 供测试注入
function classifyAuto(lms, hist, now) {
  const L = { shoulder: 11, hip: 23, knee: 25, ankle: 27, elbow: 13, wrist: 15 };
  const R = { shoulder: 12, hip: 24, knee: 26, ankle: 28, elbow: 14, wrist: 16 };
  const ka = (S) => angle3(lms[S.hip], lms[S.knee], lms[S.ankle]);
  const kL = ka(L), kR = ka(R);
  const kneeMin = Math.min(kL, kR), kneeMax = Math.max(kL, kR), kneeDiff = kneeMax - kneeMin;
  const s = pickSide(lms);
  const lean = verticalAngle(lms[s.shoulder], lms[s.hip]);
  const elbow = angle3(lms[s.shoulder], lms[s.elbow], lms[s.wrist]);
  const armRaised = (lms[s.shoulder].y - lms[s.wrist].y) > 0.18;   // 手腕明显高于肩膀
  const wristNearShoulder = Math.abs(lms[s.wrist].x - lms[s.shoulder].x) < 0.18;
  const bodyLow = lms[s.hip].y > 0.58;
  const hipY = (lms[23].y + lms[24].y) / 2;
  const tNow = now === undefined ? performance.now() : now;

  // 静止/运动判定：最近 1.5 秒髋部高度 P90-P10 差 <6% 画面高 → 静止
  // 用百分位差而非 max-min：摄像头噪声/身体自然晃动的个别跳点不会把「静止」误判成「运动」
  const win = (hist || []).filter((h) => h.t > tNow - 1500);
  let yRange = 1;                                        // 样本不足按运动处理（安全：不误判体态）
  if (win.length >= 8) {
    const ys = win.map((h) => h.y).sort((a, b) => a - b);
    yRange = ys[Math.floor(ys.length * 0.9)] - ys[Math.floor(ys.length * 0.1)];
  }

  // —— 俯身类：俯卧撑（手在肩下+髋低） / 搬重物髋铰链 ——
  if (lean > 55 && bodyLow) {
    if (wristNearShoulder && kneeMin > 110) return 'pushup';   // 含平板支撑（直臂）
    return 'hiphinge';
  }
  // —— 静止坐姿：髋在坐高、膝中等弯曲(80–130°)或双腿前伸、躯干较直立 ——
  const legsOut = kneeMin > 150 && Math.abs(lms[s.ankle].y - hipY) < 0.15;   // 腿伸直坐（踝接近髋高）
  if (yRange < 0.06 && hipY > 0.45 && hipY < 0.75 && lean < 25 && ((kneeMin >= 80 && kneeMin <= 130) || legsOut)) return 'sitting';
  // —— 运动：动态动作 ——
  if (yRange >= 0.06) {
    if (kneeDiff > 35) return kneeMax > 150 ? 'stepup' : 'lunge';
    if (kneeMin < 115) return 'squat';          // 深蹲/椅子起坐（屈膝下蹲）
    if (lean > 45) return 'hiphinge';
    if (armRaised && elbow > 150) return 'shoulderraise';
  }
  // —— 静止保持 ——
  if (lean > 45 && kneeMin > 130) return 'hiphinge';   // 搬物静止保持
  if (kneeMin < 115) return 'squat';                   // 深蹲底部保持/椅子起坐停顿
  return 'standing';                                   // 自然站立/行走停顿
}
// 投票裁决：得票率 ≥66% 且最近 4 帧全是赢家 → 返回赢家 id，否则 null（防抖）
function autoSwitchOk(votes, last4) {
  if (!votes || !Object.keys(votes).length) return null;
  const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
  const total = Object.values(votes).reduce((a, b) => a + b, 0);
  const margin = votes[winner] / Math.max(1, total);
  const streakOk = (last4 || []).length >= 4 && last4.every((c) => c === winner);
  return margin >= 0.66 && streakOk ? winner : null;
}

/* ============ 界面：动作选择 + 统计 ============ */
function featureNames(ex) {
  if (ex.id === 'squat') return ['knee', 'hip', 'lean', 'valgus'];
  if (ex.id === 'lunge') return ['frontKnee', 'backKnee', 'lean'];
  if (ex.id === 'pushup') return ['elbow', 'body'];
  if (ex.id === 'sitstand') return ['knee', 'lean', 'valgus'];
  if (ex.id === 'hiphinge') return ['hip', 'knee', 'lean'];
  if (ex.id === 'stepup') return ['knee', 'lean', 'valgus'];
  if (ex.id === 'shoulderraise') return ['arm', 'lean', 'elbow'];
  if (ex.id === 'standing') return ['lean', 'neck', 'shLevel'];
  if (ex.id === 'sitting') return ['lean', 'neck', 'knee'];
  return ex.angles.map((a) => a.key);
}
const exStd = (e) => (e.custom ? t('stdCustom') : t(e.stdKey || 'stdCustom'));
function renderExChips() {
  const custom = customList();
  const ids = ['auto', 'squat', 'lunge', 'pushup', 'sitstand', 'hiphinge', 'stepup', 'shoulderraise', 'standing', 'sitting', ...custom.map((e) => e.id)];
  $('ex-chips').innerHTML = ids.map((id) => {
    const e = id === 'auto' ? { nameKey: 'chipAuto', icon: 'target' } : (EXERCISES[id] || custom.find((x) => x.id === id));
    return `<button class="chip ${id === activeExId() ? 'on' : ''}" data-ex="${id}"><span class="chip-ico">${icon(e.icon)}</span><span>${exName(e)}</span></button>`;
  }).join('') + `<button class="chip plus" id="chip-add"><span class="chip-ico">${icon('plus')}</span><span>${t('chipAdd')}</span></button>`;
  $('ex-chips').querySelectorAll('.chip[data-ex]').forEach((b) =>
    b.addEventListener('click', () => { LS.set('rehab_active_ex', b.dataset.ex); switchEx(); }));
  $('chip-add').addEventListener('click', () => { openCustomForm(null); switchTab('settings'); });
  const ex = getEx(activeExId());
  if (ex) {
    const autoLabel = activeExId() === 'auto' ? `<span class="std">✨ ${t('autoDetected', { name: exName(ex) })}</span><br>` : '';
    $('ex-desc').innerHTML = autoLabel + exDesc(ex) + '<br><span class="std">' + exStd(ex) + '</span>';
  } else {
    $('ex-desc').innerHTML = '';
  }
  renderGoal();
}
// 训练页「今日目标」进度条（与康复计划联动）
function renderGoal() {
  const el = $('goal-line');
  if (!el) return;
  const ex = getEx(activeExId());
  const item = planForToday().find((p) => p.ex === ex.id);
  if (!item) { el.classList.add('hidden'); return; }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const done = sget('rehab_sessions', []).filter((s) => new Date(s.ts) >= today && s.ex === ex.id).reduce((a, s) => a + s.reps, 0);
  const okv = done >= item.reps;
  el.classList.remove('hidden');
  el.classList.toggle('on', okv);
  el.innerHTML = `<span class="goal-ico">${icon(okv ? 'check' : 'target')}</span><span>${t('goalLine', { name: exName(ex), n: item.reps })} · ${t('goalProgress', { d: Math.min(done, item.reps), t: item.reps })}</span>`;
}
function renderChips(res) {
  const ex = getEx(activeExId());
  const hold = !!(ex && ex.rep && ex.rep.hold);
  const chips = res.chips.map((c, i) => `
    <div class="stat"><span class="s-label">${c.k}</span><span class="s-value ${c.cls}" data-stat="${i}">${c.v}</span></div>`).join('');
  $('chips').innerHTML = chips + `
    <div class="stat big"><span class="s-label">${hold ? t('holdLabel') : t('repsLabel')}</span><span class="s-value" id="st-reps">0</span></div>`;
}
// 每帧只改数值，不重建 DOM（移动端省电）
function updateStats(res) {
  const els = $('chips').querySelectorAll('[data-stat]');
  res.chips.forEach((c, i) => {
    const el = els[i];
    if (!el) return;
    if (el.textContent !== String(c.v)) el.textContent = String(c.v);
    const cls = 's-value ' + c.cls;
    if (el.className !== cls) el.className = cls;
  });
}
const renderCollectCount = () => { $('collect-count').textContent = t('collectCount', { n: state.collectBuf.length }); };
// 账号切换后重载采集缓冲区（内存中的 collectBuf 属于上一个账号，必须重读，否则会串数据）
const reloadCollectBuf = () => { state.collectBuf = sget('rehab_collect', []); renderCollectCount(); };
function renderCollectLabels(ex) {
  $('collect-labels').innerHTML = ex.labelSet.map((l) =>
    `<button class="cbtn" data-label="${l}">${t('lb_' + l) || l}</button>`).join('');
  $('collect-labels').querySelectorAll('.cbtn').forEach((b) =>
    b.addEventListener('click', () => {
      const m = state.lastResult;
      if (!m) { toast(t('toastNeedPerson')); return; }
      state.collectBuf.push({ ex: ex.id, feats: m.features, label: b.dataset.label });
      sset('rehab_collect', state.collectBuf);
      renderCollectCount();
      toast(t('toastLabeled', { label: b.dataset.label }));
      scheduleCloudSync();
    }));
}

/* ============ 主分析循环 ============ */
const ctx = $('overlay').getContext('2d');

function resetAgg() {
  const ex = getEx(activeExId());
  state.counter = { state: 'up', reps: 0, ex: ex.id, d: ex.rep.downBelow, u: ex.rep.upAbove, belowT: 0, lastRepTs: 0, confirmMs: 120, minGapMs: 350, holdMs: 0, lastHoldTs: 0, wasBad: false };
  state.autoHist = [];                 // 新会话清空运动历史（避免上一次训练的位移污染静止/运动判定）
  state.agg = { frames: 0, startTS: Date.now(), depth: {}, badFrames: 0, valgusFrames: 0, riskFrames: 0 };
  state.lastResult = null;
  state.statsKey = null;
  state.blackFrames = 0; state.blackWarned = false; state.blackTS = 0; state.blackLum = null;
  state.alarmOn = false; state.alarmTS = 0;
  state.voiceReps = 0; state.voiceTS = 0;
  state.missingFrames = 0;
  const r = $('st-reps'); if (r) r.textContent = '0';
  document.querySelectorAll('#chips [data-stat]').forEach((el) => { el.textContent = '--'; });
  const save = $('btn-save'); if (save) save.disabled = true;
}
// 计数状态机（防抖）：低于阈值需连续 confirmMs，两次计数间隔 ≥ minGapMs
function counterUpdate(c, value, ts = performance.now()) {
  if (c.state === 'up' && value < c.d) {
    if (!c.belowT) c.belowT = ts;
    const held = ts - c.belowT;
    const gap = ts - (c.lastRepTs || 0);
    if (held >= c.confirmMs && gap >= c.minGapMs) c.state = 'down';
  } else if (c.state === 'up') {
    c.belowT = 0;
  } else if (c.state === 'down' && value > c.u) {
    c.state = 'up'; c.reps++; c.lastRepTs = ts; c.belowT = 0;
  }
  return c.reps;
}
// 保持型动作（站姿/坐姿）：只有姿态合格的时间才累计，满 30 秒计 1 次（姿势崩了计时暂停）
function counterHold(ex, res, ts) {
  const c = state.counter;
  const bad = res.depth !== 'ok' || res.msgsIsBad;
  if (c.lastHoldTs && !c.wasBad) c.holdMs += ts - c.lastHoldTs;
  c.lastHoldTs = ts;
  c.wasBad = bad;
  if (c.holdMs >= ex.rep.holdMs) { c.holdMs -= ex.rep.holdMs; c.reps++; }
  return c.reps;
}

// 每帧质量统计：深度类别 / 不合格帧 / 内扣帧（修复：之前保存记录时这些一直是 0）
function recordFrame(res) {
  const a = state.agg;
  a.frames++;
  if (res.depth && res.depth !== 'ok') a.depth[res.depth] = (a.depth[res.depth] || 0) + 1;
  if (res.msgsIsBad) a.badFrames++;
  if (res.metrics && res.metrics.valgus > 0.15) a.valgusFrames++;
  if ((res.riskLevel || 0) >= 2) a.riskFrames++;
}

// 单一调度入口：只在训练页可见且页面在前台时排帧（省电）
function kickLoop() {
  if (state.loopScheduled) return;
  if (!state.running || state.photoMode || state.tab !== 'train' || document.hidden) return;
  state.loopScheduled = true;
  requestAnimationFrame(() => { state.loopScheduled = false; loop(); });
}

// 身体完整性：只检查「正在分析的那一侧」（侧面时另一侧会被身体遮挡，不算缺失）
// 判定：可见度 <0.4 或 坐标出画面边界（贴近边缘 2% 内）→ 认为该部位没照全
function partVisible(lms, i) {
  const lm = lms[i];
  if (!lm) return false;
  const vis = lm.visibility ?? 1;
  const inFrame = lm.x > 0.02 && lm.x < 0.98 && lm.y > 0.02 && lm.y < 0.98;
  return vis >= 0.4 && inFrame;
}
function bodyMissing(lms, ex) {
  const s = pickSide(lms);
  // 坐姿检查：脚常被书桌/办公桌挡住，不把脚踝算作缺失
  const need = [[s.shoulder, 'jShoulder'], [s.hip, 'jHip'], [s.knee, 'jKnee']];
  if (!ex || ex.id !== 'sitting') need.push([s.ankle, 'jAnkle']);
  const miss = new Set();
  for (const [i, k] of need) if (!partVisible(lms, i)) miss.add(t(k));
  return [...miss];
}

// 画面亮度检测：连续 ~3 秒全黑 → 提示切换摄像头（红外摄像头/隐私盖问题）
function checkBlackFrame() {
  const v = $('video');
  if (!state.videoOn || v.readyState < 2 || !v.videoWidth) return;
  const now = performance.now();
  if (now - (state.blackTS || 0) < 500) return;
  state.blackTS = now;
  const c = state.blackCanvas || (state.blackCanvas = document.createElement('canvas'));
  c.width = 48; c.height = 48;
  const cx = c.getContext('2d');
  cx.drawImage(v, 0, 0, 48, 48);
  const d = cx.getImageData(0, 0, 48, 48).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
  const lum = sum / (d.length / 4);
  state.blackLum = Math.round((100 * lum) / 255);
  if (lum < 8) {
    state.blackFrames = (state.blackFrames || 0) + 1;
    if (state.blackFrames >= 6 && !state.blackWarned) {
      state.blackWarned = true;
      const fb = $('feedback');
      fb.innerHTML = fbWrap('alert', t('blackCamHint')) + `<button class="fb-action"><span class="btn-ico">${icon('camera')}</span><span>${t('btnSwitchCam')}</span></button>`;
      fb.className = 'feedback warn';
      fb._last = 'black';
      fb.querySelector('.fb-action').addEventListener('click', () => { toggleStart(); showCamPicker(); });
    }
  } else {
    state.blackFrames = 0;
    if (state.blackWarned) { state.blackWarned = false; $('feedback')._last = null; }
  }
}

function loop() {
  if (!state.running || state.photoMode || state.tab !== 'train' || document.hidden) return;
  const video = $('video');
  if (!state.videoOn || video.readyState < 2) { kickLoop(); return; }
  const ts = performance.now();
  if (ts - state.lastTS < 33) { kickLoop(); return; }
  state.lastTS = ts;
  checkBlackFrame();
  const result = state.landmarker.detectForVideo(video, ts);
  const fb = $('feedback');
  if (!result.landmarks || !result.landmarks.length) {
    drawEmpty();
    if (fb._last !== 'nodetect') {
      fb.innerHTML = fbWrap('alert', t('noPerson'));
      fb.className = 'feedback';
      fb._last = 'nodetect';
    }
    kickLoop();
    return;
  }
  const lms = result.landmarks[0];
  currentVG = kneeValgus(lms);

  const cw = $('overlay').clientWidth, ch = $('overlay').clientHeight;
  if ($('overlay').width !== cw || $('overlay').height !== ch) { $('overlay').width = cw; $('overlay').height = ch; }
  ctx.clearRect(0, 0, cw, ch);
  drawStick(ctx, lms, cw, ch, true);

  // 身体完整性检测：关键部位没照全 → 持续 ~5 帧才提醒（防单帧误判闪烁），并暂停分析
  // 智能识别模式例外：只有脚踝没照到时不暂停（坐姿时脚常在桌下），让投票切到坐姿分析
  const missingParts = bodyMissing(lms, getEx(activeExId()));
  const autoAnkleOnly = activeExId() === 'auto' && missingParts.length === 1 && missingParts[0] === t('jAnkle');
  if (missingParts.length && !autoAnkleOnly) {
    state.missingFrames = (state.missingFrames || 0) + 1;
    if (state.missingFrames < 5) { kickLoop(); return; }
    const msg = fbWrap('alert', t('bodyCutOff', { parts: missingParts.join('、') }) + '<br>' + t('bodyCutOffHint'));
    if (fb._last !== msg) { fb.innerHTML = msg; fb._last = msg; }
    fb.className = 'feedback warn';
    kickLoop();
    return;
  }
  state.missingFrames = 0;

  // 智能识别模式：每帧投票，稳定后自动切换分析引擎（不重置计数）
  // 防抖：得票率 ≥66% 且最近 4 帧连续一致才切换，避免动作交替时来回跳
  if (activeExId() === 'auto') {
    state.autoHist = state.autoHist || [];
    state.autoHist.push({ y: (lms[23].y + lms[24].y) / 2, t: ts });
    if (state.autoHist.length > 90) state.autoHist.shift();
    const cls = classifyAuto(lms, state.autoHist, ts);
    state.autoVotes[cls] = (state.autoVotes[cls] || 0) + 1;
    state.autoVoteN++;
    state.autoLast4 = state.autoLast4 || [];
    state.autoLast4.push(cls);
    if (state.autoLast4.length > 4) state.autoLast4.shift();
    if (state.autoVoteN >= 12) {
      const winner = autoSwitchOk(state.autoVotes, state.autoLast4);
      if (winner && winner !== state.autoEx) {
        const prevHold = (EXERCISES[state.autoEx] || {}).rep?.hold;
        state.autoEx = winner;
        const nex = EXERCISES[winner];
        state.counter.ex = winner;
        if (nex.rep.downBelow != null) { state.counter.d = nex.rep.downBelow; state.counter.u = nex.rep.upAbove; }
        if (nex.rep.hold || prevHold) {
          // 进出保持型动作 → 重新计数（30 秒 1 次，不与动态次数混算）
          state.counter.reps = 0; state.counter.holdMs = 0; state.counter.lastHoldTs = 0; state.voiceReps = 0;
        }
        state.statsKey = null;                       // 统计卡下一帧按新动作重建
        renderExChips();
        renderCollectLabels(getEx('auto'));
      }
      state.autoVotes = {}; state.autoVoteN = 0;
    }
  }
  const ex = getEx(activeExId());
  const res = analyzeAny(lms, ex);
  state.lastResult = res;

  recordFrame(res);
  const reps = ex.rep.hold
    ? counterHold(ex, res, ts)
    : counterUpdate(state.counter, res.repValue, ts);
  if (state.statsKey !== ex.id) { renderChips(res); state.statsKey = ex.id; }
  else updateStats(res);
  $('st-reps').textContent = ex.rep.hold ? String(Math.round((state.counter.holdMs || 0) / 1000)) : String(reps);
  // 语音播报：每 5 次报一次数
  if (reps > 0 && reps % 5 === 0 && reps !== state.voiceReps) {
    state.voiceReps = reps;
    speak(t('voiceRep', { n: reps }));
  }

  // 受伤风险：1=提醒(warn) 2=警报(alarm，声音+震动+闪烁+语音)
  const riskLevel = res.riskLevel || 0;
  if (riskLevel >= 2) {
    if (!state.alarmOn) { state.alarmOn = true; state.alarmTS = ts; alarmBurst(); }
    else if (ts - state.alarmTS > 5000) { state.alarmTS = ts; alarmBurst(); }
  } else {
    state.alarmOn = false;
  }
  const riskMsgs = (res.risk && res.risk.length) ? res.risk : [];
  if (riskMsgs.length) {
    if (riskLevel >= 2 && ts - state.voiceTS > 8000) { state.voiceTS = ts; speak(t('alarmTitle') + '，' + riskMsgs[0]); }
    else if (riskLevel === 1 && ts - state.voiceTS > 8000) { state.voiceTS = ts; speak(riskMsgs[0]); }
  }
  const bodyMsgs = riskMsgs.length ? riskMsgs : (res.badMsgs.length ? res.badMsgs : res.goodMsgs);
  const msg = fbWrap(riskLevel >= 2 ? 'alert' : (res.msgsIsBad ? 'alert' : 'check'),
    (riskLevel >= 2 ? '<b>' + t('alarmTitle') + '</b><br>' : '') + bodyMsgs.join('<br>'));
  if (fb._last !== msg) { fb.innerHTML = msg; fb._last = msg; }
  const cls = 'feedback' + (riskLevel >= 2 ? ' alarm' : res.msgsIsBad ? ' bad' : res.depth !== 'ok' ? ' warn' : '');
  if (fb.className !== cls) fb.className = cls;

  if (state.collectMode) $('collect-feats').textContent = t('collectFeats', { f: res.features.join(', ') });
  if ($('btn-save').disabled && (state.agg.frames >= 30 || state.counter.reps >= 1)) $('btn-save').disabled = false;
  kickLoop();
}
function drawEmpty() { ctx.clearRect(0, 0, $('overlay').width, $('overlay').height); }

/* ============ 受伤风险警报（声音 + 震动） ============ */
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* ignore */ } }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
}
function alarmBurst() {
  if (navigator.vibrate) { try { navigator.vibrate([300, 120, 300]); } catch { /* ignore */ } }
  ensureAudio();
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  for (let i = 0; i < 3; i++) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t0 + i * 0.3);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + i * 0.3 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.3 + 0.18);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0 + i * 0.3);
    o.stop(t0 + i * 0.3 + 0.22);
  }
}

/* ============ 开始 / 停止 / 图片 ============ */
function setStartBtn(key, ico) {
  $('btn-start-label').textContent = t(key);
  $('btn-start-ico').innerHTML = icon(ico || 'play');
}
async function toggleStart() {
  const btn = $('btn-start');
  ensureAudio();   // 用户点击手势内创建音频上下文（警报声用）
  if (state.running) {
    state.running = false; stopCamera(); releaseWake();
    drawEmpty();                                   // 清掉火柴人，避免黑屏上残留
    $('placeholder').classList.remove('hidden');   // 恢复「点击开始分析」占位图
    btn.disabled = false; setStartBtn('btnStart', 'play');
    aiSessionEnd();
    return;
  }
  $('cam-retry').classList.add('hidden');
  try {
    btn.disabled = true;
    let stream;
    if (state.pickCam !== undefined && state.cameras?.[state.pickCam]) {
      const c = state.cameras[state.pickCam];
      setStartBtn('btnOpening', 'loader-spin');
      stream = await openCameraWithTimeout({ video: { deviceId: { exact: c.deviceId } }, audio: false });
    } else {
      setStartBtn('btnDetecting', 'loader-spin');
      stream = await openCamera();
    }
    // 摄像头画面立刻显示（不再被黑色加载遮罩挡住）
    await bindStream(stream);
    state.running = true; state.photoMode = false;
    acquireWake();                               // 训练中屏幕常亮，不自动锁屏
    resetAgg();
    btn.disabled = false;
    setStartBtn('btnStop', 'stop');
    $('stats-box').classList.remove('hidden');
    $('feedback').classList.remove('hidden');
    $('feedback').innerHTML = fbWrap('camera', t('detecting'));
    $('feedback').className = 'feedback';
    $('feedback')._last = null;
    // AI 模型在后台加载：画面可见，只有一个小进度胶囊
    if (!state.landmarker) {
      const t0 = Date.now();
      $('loading').innerHTML = icon('loader-spin') + '<span>' + t('loading') + ' 0s</span>';
      $('loading').classList.remove('hidden');
      const tick = setInterval(() => {
        $('loading').innerHTML = icon('loader-spin') + '<span>' + t('loading') + ' ' + Math.round((Date.now() - t0) / 1000) + 's</span>';
      }, 1000);
      try {
        state.landmarker = await loadModel();
      } catch (e) {
        console.error('模型加载失败:', e);
        stopCamera(); releaseWake(); drawEmpty();
        state.running = false;
        setStartBtn('btnStart', 'play');
        $('placeholder').classList.remove('hidden');
        showCameraError(e, true);   // 摄像头没问题，是模型/网络问题
        return;
      } finally {
        clearInterval(tick);
        $('loading').classList.add('hidden');
      }
    }
    kickLoop();
  } catch (e) {
    console.error(e);
    $('loading').classList.add('hidden');
    btn.disabled = false; setStartBtn('btnStart', 'play');
    state.videoOn = false;
    showCameraError(e);
  }
}
function switchEx() {
  const wasRunning = state.running;
  if (state.running) {
    state.running = false; stopCamera(); releaseWake();
    drawEmpty(); $('placeholder').classList.remove('hidden');
    setStartBtn('btnStart', 'play'); $('btn-start').disabled = false;
  }
  state.photoMode = false;
  renderExChips(); renderCollectLabels(getEx(activeExId()));
  resetAgg();
  if (wasRunning) { $('stats-box').classList.add('hidden'); $('feedback').classList.add('hidden'); }
}

$('btn-start').addEventListener('click', toggleStart);
$('btn-photo').addEventListener('click', () => $('photo-input').click());
$('btn-toggle-collect').addEventListener('click', () => {
  state.collectMode = !state.collectMode;
  $('collect-panel').classList.toggle('hidden', !state.collectMode);
  $('btn-collect-label').textContent = state.collectMode ? t('btnCollectStop') : t('btnCollect');
  renderCollectCount();
});

$('photo-input').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  try {
    if (state.running) { state.running = false; stopCamera(); releaseWake(); drawEmpty(); setStartBtn('btnStart', 'play'); $('btn-start').disabled = false; }
    if (!state.landmarker) {
      $('loading').classList.remove('hidden');
      state.landmarker = await loadModel();
      $('loading').classList.add('hidden');
    }
    state.photoMode = true;
    $('placeholder').classList.add('hidden');
    $('stats-box').classList.remove('hidden');
    $('feedback').classList.remove('hidden');
    const cw = $('overlay').clientWidth, ch = $('overlay').clientHeight;
    $('overlay').width = cw; $('overlay').height = ch;
    ctx.clearRect(0, 0, cw, ch);
    const scale = Math.max(cw / img.width, ch / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    const off = document.createElement('canvas');
    off.width = img.width; off.height = img.height;
    off.getContext('2d').drawImage(img, 0, 0);
    const result = state.landmarker.detectForVideo(off, performance.now());
    resetAgg();
    if (!result.landmarks || !result.landmarks.length) {
      $('feedback').innerHTML = fbWrap('alert', t('photoNoPerson'));
      $('feedback').className = 'feedback warn';
      return;
    }
    const lms = result.landmarks[0];
    currentVG = kneeValgus(lms);
    // 身体完整性：关键部位没照全 → 提醒，不做分析（智能识别模式下仅缺脚踝可放行）
    const missingParts = bodyMissing(lms, getEx(activeExId()));
    const autoAnkleOnly = activeExId() === 'auto' && missingParts.length === 1 && missingParts[0] === t('jAnkle');
    if (missingParts.length && !autoAnkleOnly) {
      $('feedback').innerHTML = fbWrap('alert', t('bodyCutOff', { parts: missingParts.join('、') }) + '<br>' + t('bodyCutOffHint'));
      $('feedback').className = 'feedback warn';
      return;
    }
    // 智能识别模式：照片按「静止体态」分类一次（照片没有运动历史，站姿/坐姿检查才是照片的典型用途）
    if (activeExId() === 'auto') {
      const tN = performance.now();
      const y = (lms[23].y + lms[24].y) / 2;
      state.autoEx = classifyAuto(lms, [0, 1, 2, 3, 4].map((i) => ({ y, t: tN - 1000 + i * 200 })), tN);
    }
    const ex = getEx(activeExId());
    const res = analyzeAny(lms, ex);
    state.lastResult = res;
    drawStick(ctx, lms, cw, ch, false);
    recordFrame(res);
    state.statsKey = ex.id;
    renderChips(res);
    $('feedback').innerHTML = fbWrap(res.msgsIsBad ? 'alert' : 'check', (res.badMsgs.length ? res.badMsgs : res.goodMsgs).join('<br>'));
    $('feedback').className = 'feedback' + (res.msgsIsBad ? ' bad' : '');
    $('btn-save').disabled = false;
  } catch (e) {
    console.error(e);
    $('feedback').innerHTML = fbWrap('alert', t('photoFail', { msg: e.message }));
    $('feedback').className = 'feedback bad';
  }
  ev.target.value = '';
});

/* ============ 保存记录 ============ */
$('btn-save').addEventListener('click', () => {
  const a = state.agg;
  if (!a.frames) return;
  const ex = getEx(activeExId());
  const depthMode = Object.entries(a.depth).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'ok';
  const session = {
    id: uid(), ts: Date.now(), ex: ex.id, exName: exName(ex),
    reps: state.counter.reps,
    dur: Math.max(1, Math.round((Date.now() - a.startTS) / 1000)),
    depth: depthMode,
    badPct: Math.round(100 * a.badFrames / a.frames),
    valgusPct: a.valgusFrames ? Math.round(100 * a.valgusFrames / a.frames) : 0,
    riskPct: a.riskFrames ? Math.round(100 * a.riskFrames / a.frames) : 0,
    collectCount: state.collectBuf.length,
  };
  const list = sget('rehab_sessions', []);
  list.unshift(session);
  sset('rehab_sessions', list);
  // 自动核对今日计划目标：达标即自动打卡
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const tReps = list.reduce((a, s) => (new Date(s.ts) >= t0 && s.ex === ex.id ? a + s.reps : a), 0);
  const tPlan = planForToday().find((p) => p.ex === ex.id);
  if (tPlan && tReps >= tPlan.reps) {
    const dd = planDoneGet();
    const k = todayKeyStr();
    const arr = dd[k] || [];
    if (!arr.includes(ex.id)) {
      arr.push(ex.id);
      dd[k] = arr;
      sset('rehab_plan_done', dd);
      renderTodayPlan();
      toast(t('goalDone'));
      speak(t('goalDone'));
    }
  }
  resetAgg();
  renderRecords();
  renderGoal();
  toast(t('toastSaved'));
  scheduleCloudSync();
});

/* ============ 记录打卡页 ============ */
function renderRecords() {
  const sessions = sget('rehab_sessions', []);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = [...Array(7)].map((_, i) => {
    const d = new Date(today); d.setDate(d.getDate() - (6 - i));
    return { key: d.toDateString(), label: d.toLocaleDateString(locale(), { weekday: 'short' }), reps: 0 };
  });
  for (const s of sessions) {
    const d = new Date(s.ts);
    if (d >= today && d < new Date(today.getTime() + 86400000)) {
      const day = days.find((x) => x.key === d.toDateString());
      if (day) day.reps += s.reps;
    }
  }
  const max = Math.max(1, ...days.map((d) => d.reps));
  const todayKey = today.toDateString();
  $('week-chart').innerHTML = days.map((d) => `
    <div class="bar-wrap ${d.key === todayKey ? 'today' : ''}">
      <div class="bar ${d.reps ? '' : 'zero'}" style="height:${Math.max(4, 100 * d.reps / max)}%"></div>
      <span class="bar-label">${d.label}</span>
    </div>`).join('');
  const totalReps = sessions.reduce((s, x) => s + x.reps, 0);
  const streak = calcStreak(sessions);
  $('summary-line').textContent = sessions.length
    ? t('summaryLine', { n: sessions.length, r: totalReps, s: streak })
    : t('noSessions');
  const list = $('session-list');
  if (!sessions.length) {
    list.innerHTML = emptyBox('record', 'emptyList');
  } else {
    list.innerHTML = sessions.slice(0, 20).map((s) => {
      const builtin = EXERCISES[s.ex];
      const name = builtin ? exName(builtin) : (s.exName || '?');
      return `
      <div class="item">
        <div>
          <div class="t"><span class="t-ico">${icon(builtin ? builtin.icon : 'custom')}</span>${name} · ${fmtDate(s.ts)} · ${t('repsN', { n: s.reps })} · ${s.dur ?? '?'}s · ${depthTxt(s.depth)}</div>
          <div class="d">${t('badFramesPct', { p: s.badPct })}${s.badPct >= 30 ? ' ⚠️' : ''}${s.riskPct ? ' · ' + t('riskFramesPct', { p: s.riskPct }) + ' 🚨' : ''}${s.valgusPct ? ' · ' + t('valgusFramesPct', { p: s.valgusPct }) : ''}${s.collectCount ? ' · ' + t('collectN', { n: s.collectCount }) : ''}</div>
        </div>
        <button class="del" data-id="${s.id}">✕</button>
      </div>`;
    }).join('');
    list.querySelectorAll('.del').forEach((btn) => btn.addEventListener('click', () => {
      sset('rehab_sessions', sessions.filter((s) => s.id !== btn.dataset.id));
      renderRecords();
    }));
  }
  // 统计报表 + 成就
  renderTrends();
  renderDist();
  renderAchievements();
}

/* ============ 评估反馈页 ============ */
$('tab-assess').querySelectorAll('.seg').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    seg.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
  });
});
$('btn-assess').addEventListener('click', () => {
  const answers = {};
  $('tab-assess').querySelectorAll('.seg').forEach((seg) => {
    const on = seg.querySelector('.on');
    answers[seg.dataset.q] = +on.dataset.v;
  });
  const score = ['pain', 'valgus', 'back', 'freq'].reduce((s, k) => s + answers[k], 0);
  const adviceKeys = [];
  if (answers.pain >= 1) adviceKeys.push('advisePain');
  if (answers.valgus >= 1) adviceKeys.push('adviseValgus');
  if (answers.back >= 1) adviceKeys.push('adviseBack');
  if (answers.freq === 0) adviceKeys.push('adviseFreq');
  if (score <= 1) adviceKeys.push('adviseGood');
  const report = { id: uid(), ts: Date.now(), answers, score, adviceKeys };
  const list = sget('rehab_assessments', []);
  list.unshift(report);
  sset('rehab_assessments', list);
  const el = $('assess-result');
  el.innerHTML = `<b>${t('assessScore', { s: score })}</b><br>${adviceKeys.map((k) => t(k)).join('<br>')}`;
  el.classList.remove('hidden');
  renderAssessments();
  scheduleCloudSync();
});
const adviceText = (r) => (r.adviceKeys ? r.adviceKeys.map((k) => t(k)).join(' ') : (r.advice || ''));
function renderAssessments() {
  const list = sget('rehab_assessments', []);
  const el = $('assess-list');
  if (!list.length) { el.innerHTML = emptyBox('assess', 'emptyAssess'); return; }
  el.innerHTML = list.slice(0, 10).map((r) => `
    <div class="item">
      <div>
        <div class="t">${t('assessScoreShort', { t: fmtDate(r.ts), s: r.score })}</div>
        <div class="d">${adviceText(r).replace(/<[^>]+>/g, '').slice(0, 60)}…</div>
      </div>
      <button class="del" data-id="${r.id}">✕</button>
    </div>`).join('');
  el.querySelectorAll('.del').forEach((btn) => btn.addEventListener('click', () => {
    sset('rehab_assessments', list.filter((r) => r.id !== btn.dataset.id));
    renderAssessments();
    scheduleCloudSync();
  }));
  // 评估分数趋势
  const scores = [...list].reverse().slice(-10).map((r) => r.score);
  $('assess-trend').innerHTML = scores.length ? lineChart(scores, '#0e7c66', 'a') : emptyBox('assess', 'emptyAssess');
}

/* ============ 预约日程页 ============ */
$('appt-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const appt = {
    id: uid(), date: $('appt-date').value, time: $('appt-time').value,
    place: $('appt-place').value.trim(), note: $('appt-note').value.trim(),
  };
  const list = sget('rehab_appts', []);
  list.push(appt);
  sset('rehab_appts', list);
  $('appt-form').reset();
  renderAppts();
  toast(t('toastAppt'));
  scheduleCloudSync();
});
function renderAppts() {
  const list = sget('rehab_appts', []).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const el = $('appt-list');
  if (!list.length) { el.innerHTML = emptyBox('schedule', 'emptyAppts'); return; }
  const now = new Date();
  const d2 = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const todayStr = d2(now);
  const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const tomorrowStr = d2(tomorrow);
  el.innerHTML = list.map((a) => {
    // 修复：之前用 < 23:59 比较，导致今天还没到的预约也被标成已过期
    const past = a.date < todayStr || (a.date === todayStr && a.time <= nowTime);
    const tag = past ? `<b style="color:var(--red)">${t('tagPast')}</b>`
      : a.date === todayStr ? `<b style="color:var(--green)">${t('tagToday')}</b>`
      : a.date === tomorrowStr ? `<b style="color:var(--yellow)">${t('tagTomorrow')}</b>` : '';
    return `
    <div class="item" style="${past ? 'opacity:.55' : ''}">
      <div>
        <div class="t"><span class="t-ico">${icon('schedule')}</span>${a.date} ${a.time} · ${a.place}${tag ? ' ' + tag : ''}</div>
        <div class="d">${a.note || t('noNote')}</div>
      </div>
      <button class="del" data-id="${a.id}">✕</button>
    </div>`;
  }).join('');
  el.querySelectorAll('.del').forEach((btn) => btn.addEventListener('click', () => {
    sset('rehab_appts', list.filter((a) => a.id !== btn.dataset.id));
    renderAppts();
    scheduleCloudSync();
  }));
}

/* ============ 设置页：自定义动作 ============ */
let editingCustomId = null;
function renderCustomList() {
  const list = loadCustomExercises();
  const el = $('custom-list');
  if (!list.length) { el.innerHTML = emptyBox('sliders', 'noCustom'); return; }
  el.innerHTML = list.map((e) => `
    <div class="item">
      <div>
        <div class="t"><span class="t-ico">${icon('custom')}</span>${e.name}</div>
        <div class="d">${e.angles.map((a) => a.name).join(' · ')}</div>
      </div>
      <div style="display:flex;gap:4px">
        <button class="mini" data-edit="${e.id}">${icon('edit')}</button>
        <button class="mini del" data-del="${e.id}">${icon('trash')}</button>
      </div>
    </div>`).join('');
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openCustomForm(b.dataset.edit)));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm(t('confirmDelCustom'))) return;
    saveCustomExercises(loadCustomExercises().filter((e) => e.id !== b.dataset.del));
    invalidateCustom();
    renderCustomList(); renderExChips();
    toast(t('toastDeleted'));
  }));
}
const jSel = (id, val) => `<select id="${id}">${CUSTOM_JOINTS.map((j) => `<option value="${j.v}" ${j.v === val ? 'selected' : ''}>${t(j.t)}</option>`).join('')}</select>`;
function openCustomForm(id) {
  editingCustomId = id;
  const ex = id ? loadCustomExercises().find((e) => e.id === id) : customDefault();
  $('cf-title').textContent = id ? t('cfTitleEdit') : t('cfTitleNew');
  $('cf-name').value = ex.name;
  $('cf-desc').value = ex.desc || '';
  // 角度1
  $('cf-a1-name').value = ex.angles[0].name;
  $('cf-a1-type').value = ex.angles[0].type;
  const a1 = ex.angles[0];
  $('cf-a1-a').innerHTML = jSel('cf-a1-a', a1.a);
  $('cf-a1-b').innerHTML = jSel('cf-a1-b', a1.b);
  $('cf-a1-c').innerHTML = jSel('cf-a1-c', a1.c ?? 'knee');
  // 角度2（可无）
  const a2 = ex.angles[1];
  $('cf-a2-name').value = a2?.name || t('fallbackLean');
  $('cf-a2-type').value = a2?.type || 'vertical';
  $('cf-a2-a').innerHTML = jSel('cf-a2-a', a2?.a ?? 'shoulder');
  $('cf-a2-b').innerHTML = jSel('cf-a2-b', a2?.b ?? 'hip');
  // 规则
  $('cf-r1-min').value = ex.rules[0].min ?? '';
  $('cf-r1-max').value = ex.rules[0].max ?? '';
  $('cf-r1-good').value = ex.rules[0].msgGood;
  $('cf-r1-bad').value = ex.rules[0].msgBad;
  const r2 = ex.rules[1];
  $('cf-r2-min').value = r2?.min ?? '';
  $('cf-r2-max').value = r2?.max ?? '';
  $('cf-r2-good').value = r2?.msgGood || '';
  $('cf-r2-bad').value = r2?.msgBad || '';
  // 计次
  $('cf-rep-metric').value = ex.reps.metric;
  $('cf-rep-down').value = ex.reps.downBelow;
  $('cf-rep-up').value = ex.reps.upAbove;
  $('custom-form-card').classList.remove('hidden');
  $('custom-form-card').scrollIntoView({ behavior: 'smooth' });
}
$('cf-cancel').addEventListener('click', () => $('custom-form-card').classList.add('hidden'));
$('cf-save').addEventListener('click', () => {
  const list = loadCustomExercises();
  const base = editingCustomId ? list.find((e) => e.id === editingCustomId) : customDefault();
  const ex = {
    ...base,
    name: $('cf-name').value.trim() || t('fallbackName'),
    desc: $('cf-desc').value.trim() || t('fallbackDesc'),
    angles: [
      { key: 'a1', name: $('cf-a1-name').value.trim() || t('fallbackA1'), type: $('cf-a1-type').value, a: $('cf-a1-a').value, b: $('cf-a1-b').value, c: $('cf-a1-c').value },
      { key: 'a2', name: $('cf-a2-name').value.trim() || t('fallbackA2'), type: $('cf-a2-type').value, a: $('cf-a2-a').value, b: $('cf-a2-b').value },
    ],
    rules: [
      { metric: 'a1', min: $('cf-r1-min').value === '' ? undefined : +$('cf-r1-min').value, max: $('cf-r1-max').value === '' ? undefined : +$('cf-r1-max').value, msgGood: $('cf-r1-good').value || t('fallbackA1Good'), msgBad: $('cf-r1-bad').value || t('fallbackA1Bad') },
      { metric: 'a2', min: $('cf-r2-min').value === '' ? undefined : +$('cf-r2-min').value, max: $('cf-r2-max').value === '' ? undefined : +$('cf-r2-max').value, msgGood: $('cf-r2-good').value || t('fallbackA2Good'), msgBad: $('cf-r2-bad').value || t('fallbackA2Bad') },
    ],
    reps: { metric: $('cf-rep-metric').value, downBelow: +$('cf-rep-down').value || 100, upAbove: +$('cf-rep-up').value || 150 },
  };
  if (editingCustomId) {
    const i = list.findIndex((e) => e.id === editingCustomId);
    list[i] = ex;
  } else list.push(ex);
  saveCustomExercises(list);
  invalidateCustom();
  $('custom-form-card').classList.add('hidden');
  renderCustomList(); renderExChips();
  toast(editingCustomId ? t('toastCustomSaved') : t('toastCustomCreated'));
  scheduleCloudSync();
});

/* ============ 设置页：数据采集导出 ============ */
$('btn-export-collect').addEventListener('click', () => {
  if (!state.collectBuf.length) { toast(t('toastNoCollect')); return; }
  const exIds = [...new Set(state.collectBuf.map((r) => r.ex))];
  let csv = '';
  for (const exId of exIds) {
    const ex = getEx(exId);
    const names = featureNames(ex);
    csv += 'exercise,' + names.join(',') + ',label\n';
    for (const r of state.collectBuf.filter((x) => x.ex === exId)) {
      csv += exId + ',' + r.feats.join(',') + ',' + r.label + '\n';
    }
  }
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${t('fileCollect')}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(t('toastExportCsv'));
});
$('btn-clear-collect').addEventListener('click', () => {
  if (!confirm(t('confirmClearCollect'))) return;
  state.collectBuf = []; sset('rehab_collect', []);
  renderCollectCount();
  toast(t('toastClearedCollect'));
});

/* ============ 设置页：导出 / 导入 / 清空 ============ */
$('btn-export').addEventListener('click', () => {
  const data = {
    app: '康复AI', version: 2, exportedAt: new Date().toISOString(),
    sessions: sget('rehab_sessions', []),
    assessments: sget('rehab_assessments', []),
    appts: sget('rehab_appts', []),
    customExercises: loadCustomExercises(),
    collect: state.collectBuf,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${t('fileBackup')}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(t('toastExportBackup'));
});
$('btn-import').addEventListener('click', () => $('import-input').click());
$('import-input').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.sessions)) throw new Error(t('importFormatErr'));
    sset('rehab_sessions', data.sessions || []);
    sset('rehab_assessments', data.assessments || []);
    sset('rehab_appts', data.appts || []);
    if (Array.isArray(data.customExercises)) { saveCustomExercises(data.customExercises); invalidateCustom(); }
    if (Array.isArray(data.collect)) { state.collectBuf = data.collect; sset('rehab_collect', data.collect); }
    renderRecords(); renderAssessments(); renderAppts(); renderCustomList(); renderExChips();
    toast(t('toastImportOk'));
    scheduleCloudSync();
  } catch (e) { toast(t('toastImportFail', { msg: e.message })); }
  ev.target.value = '';
});
$('btn-clear').addEventListener('click', () => {
  if (!confirm(t('confirmClearAll'))) return;
  ['rehab_sessions', 'rehab_assessments', 'rehab_appts', 'rehab_custom_ex', 'rehab_collect', 'rehab_plan', 'rehab_plan_done', 'rehab_profile'].forEach((k) => sdel(k));
  state.collectBuf = [];
  invalidateCustom();
  renderRecords(); renderAssessments(); renderAppts(); renderCustomList(); renderExChips();
  renderCollectCount(); renderProfile(); renderTodayPlan(); renderPlanList(); renderAchievements(); renderGoal();
  toast(t('toastClearedAll'));
  scheduleCloudSync();
});

/* ============ 导航 ============ */
function switchTab(name) {
  state.tab = name;
  document.querySelectorAll('.bottom-nav button').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  const navBtn = document.querySelector(`.bottom-nav button[data-tab="${name}"]`);
  if (navBtn) navBtn.classList.add('active');
  $('tab-' + name).classList.add('active');
  if (name === 'train') kickLoop();          // 回到训练页立即恢复分析
}
document.querySelectorAll('.bottom-nav button').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
// 切到后台自动暂停分析，回来自动恢复（省电）
document.addEventListener('visibilitychange', () => { if (!document.hidden) kickLoop(); });

/* ============ 端手互通：二维码同步（无服务器 · 数据本地压缩加密传输） ============ */
const SYNC_PREFIX = 'RAS|';
const syncState = { scanning: false, got: [], total: null, last: 0, off: null, showing: false, frameIdx: 0, chunks: [], frameTimer: null };

const bytesToB64 = (buf) => {
  const arr = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < arr.length; i += 0x8000) s += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64ToBytes = (b64) => {
  const s = atob(b64);
  const arr = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
  return arr;
};
const gzipB64 = async (text) => bytesToB64(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const gunzipB64 = async (b64) => new Response(new Blob([b64ToBytes(b64)]).stream().pipeThrough(new DecompressionStream('gzip'))).text();

function makeSyncData(includeCollect = false) {
  const d = {
    app: 'RehabAI', v: 3, ts: Date.now(),
    sessions: sget('rehab_sessions', []),
    assessments: sget('rehab_assessments', []),
    appts: sget('rehab_appts', []),
    customExercises: loadCustomExercises(),
    plan: sget('rehab_plan', []),
    planDone: sget('rehab_plan_done', {}),
    profile: sget('rehab_profile', {}),
  };
  if (includeCollect) d.collect = state.collectBuf;
  return d;
}
// 按 id 合并：双方都保留，同 id 以对方为准；按时间倒序
function mergeSyncData(data) {
  const mergeById = (cur, inc) => {
    const m = new Map(cur.map((x) => [x.id, x]));
    (inc || []).forEach((x) => m.set(x.id, x));
    return [...m.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  };
  sset('rehab_sessions', mergeById(sget('rehab_sessions', []), data.sessions));
  sset('rehab_assessments', mergeById(sget('rehab_assessments', []), data.assessments));
  sset('rehab_appts', mergeById(sget('rehab_appts', []), data.appts));
  if (Array.isArray(data.customExercises) && data.customExercises.length) {
    saveCustomExercises(mergeById(loadCustomExercises(), data.customExercises));
    invalidateCustom();
  }
  if (Array.isArray(data.plan) && data.plan.length) {
    sset('rehab_plan', mergeById(sget('rehab_plan', []), data.plan));
  }
  if (data.planDone && typeof data.planDone === 'object') {
    const cur = sget('rehab_plan_done', {});
    for (const [k, v] of Object.entries(data.planDone)) cur[k] = [...new Set([...(cur[k] || []), ...(v || [])])];
    sset('rehab_plan_done', cur);
  }
  if (data.profile && (data.profile.name || data.profile.injury)) {
    sset('rehab_profile', { ...(sget('rehab_profile', {})), ...data.profile });
  }
  if (Array.isArray(data.collect) && data.collect.length) {
    const seen = new Set(state.collectBuf.map((r) => r.ex + '|' + r.label + '|' + (r.feats || []).join(',')));
    for (const r of data.collect) {
      const k = r.ex + '|' + r.label + '|' + (r.feats || []).join(',');
      if (!seen.has(k)) { state.collectBuf.push(r); seen.add(k); }
    }
    sset('rehab_collect', state.collectBuf);
  }
  return { s: (data.sessions || []).length, a: (data.assessments || []).length, p: (data.appts || []).length, c: (data.customExercises || []).length };
}

/* ---------- 显示二维码（发送端） ---------- */
async function startSyncShow() {
  const data = makeSyncData();
  if (!data.sessions.length && !data.assessments.length && !data.appts.length && !data.customExercises.length) {
    toast(t('qrEmpty'));
    return;
  }
  const b64 = await gzipB64(JSON.stringify(data));
  const SIZE = 1300;
  syncState.chunks = [];
  for (let i = 0; i < b64.length; i += SIZE) syncState.chunks.push(b64.slice(i, i + SIZE));
  syncState.frameIdx = 0;
  syncState.showing = true;
  $('qr-modal').classList.remove('hidden');
  renderQrFrame();
  clearInterval(syncState.frameTimer);
  syncState.frameTimer = setInterval(() => {
    syncState.frameIdx = (syncState.frameIdx + 1) % syncState.chunks.length;
    renderQrFrame();
  }, 1500);
}
function renderQrFrame() {
  const i = syncState.frameIdx;
  const text = SYNC_PREFIX + '|' + i + '|' + syncState.chunks.length + '|' + syncState.chunks[i];
  const qr = window.qrcode(0, 'L');
  qr.addData(text, 'Byte');
  qr.make();
  const canvas = $('qr-canvas');
  const n = qr.getModuleCount();
  const size = 540;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#14181f';
  const cell = size / n;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.isDark(r, c)) ctx.fillRect(c * cell, r * cell, cell + 0.5, cell + 0.5);
  }
  $('qr-page').textContent = t('qrPage', { i: i + 1, n: syncState.chunks.length });
}
function stopSyncShow() {
  syncState.showing = false;
  clearInterval(syncState.frameTimer);
  $('qr-modal').classList.add('hidden');
}

/* ---------- 扫描二维码（接收端） ---------- */
async function startSyncScan() {
  if (syncState.scanning) return;
  try {
    if (state.running) { state.running = false; stopCamera(); releaseWake(); drawEmpty(); setStartBtn('btnStart', 'play'); $('btn-start').disabled = false; }
    if (!state.videoOn) {
      const stream = await openCamera();
      await bindStream(stream);
    }
    state.photoMode = false;
    switchTab('train');
    syncState.scanning = true; syncState.got = []; syncState.total = null; syncState.last = 0;
    $('sync-progress').textContent = t('scanHint');
    $('sync-panel').classList.remove('hidden');
    scanLoop();
  } catch (e) { showCameraError(e); }
}
function scanLoop() {
  if (!syncState.scanning) return;
  requestAnimationFrame(scanLoop);
  const now = performance.now();
  if (now - syncState.last < 150) return;
  syncState.last = now;
  const v = $('video');
  if (!state.videoOn || v.readyState < 2 || !window.jsQR) return;
  const w = 420;
  const h = Math.max(2, Math.round(420 * v.videoHeight / Math.max(1, v.videoWidth)));
  const off = syncState.off || (syncState.off = document.createElement('canvas'));
  off.width = w; off.height = h;
  const octx = off.getContext('2d');
  octx.drawImage(v, 0, 0, w, h);
  const img = octx.getImageData(0, 0, w, h);
  const code = window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
  if (code && code.data && code.data.startsWith(SYNC_PREFIX)) {
    const parts = code.data.split('|');
    const idx = +parts[1], total = +parts[2];
    const payload = parts.slice(3).join('|');
    if (!syncState.total) syncState.total = total;
    if (!syncState.got[idx]) {
      syncState.got[idx] = payload;
      const have = syncState.got.filter(Boolean).length;
      $('sync-progress').textContent = t('scanProgress', { i: have, n: syncState.total });
      if (have === syncState.total) finishSyncScan();
    }
  }
}
async function finishSyncScan() {
  syncState.scanning = false;
  stopCamera(); releaseWake(); drawEmpty();
  $('sync-panel').classList.add('hidden');
  $('placeholder').classList.remove('hidden');
  try {
    const json = await gunzipB64(syncState.got.join(''));
    const data = JSON.parse(json);
    if (!Array.isArray(data.sessions)) throw new Error('bad payload');
    const r = mergeSyncData(data);
    renderRecords(); renderAssessments(); renderAppts(); renderCustomList(); renderExChips();
    toast(t('scanDone', { s: r.s, a: r.a, p: r.p, c: r.c }));
  } catch (e) {
    toast(t('scanError', { msg: e.message }));
  }
}
function cancelSyncScan() {
  syncState.scanning = false;
  stopCamera(); releaseWake(); drawEmpty();
  $('sync-panel').classList.add('hidden');
  $('placeholder').classList.remove('hidden');
  setStartBtn('btnStart', 'play');
}
$('btn-sync-show').addEventListener('click', startSyncShow);
$('btn-sync-scan').addEventListener('click', startSyncScan);
$('btn-sync-cancel').addEventListener('click', cancelSyncScan);
$('qr-close').addEventListener('click', stopSyncShow);

/* ============ 个人资料 ============ */
const profileGet = () => sget('rehab_profile', { name: '', goal: 'knee', injury: '' });
function renderProfile() {
  const p = profileGet();
  $('pf-name').value = p.name || '';
  $('pf-goal').value = p.goal || 'knee';
  $('pf-injury').value = p.injury || '';
}
$('btn-save-profile').addEventListener('click', () => {
  sset('rehab_profile', { name: $('pf-name').value.trim(), goal: $('pf-goal').value, injury: $('pf-injury').value.trim() });
  toast(t('toastProfile'));
  scheduleCloudSync();
});

/* ============ 统计报表（30 天趋势 / 动作分布） ============ */
function lineChart(points, color, uid) {
  const W = 320, H = 72, P = 8;
  const n = points.length;
  const m = Math.max(1, ...points);
  const x = (i) => P + (W - 2 * P) * (i / Math.max(1, n - 1));
  const y = (v) => H - P - (H - 2 * P) * (v / m);
  const path = points.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const area = path + ` L${x(n - 1).toFixed(1)} ${H - P} L${x(0).toFixed(1)} ${H - P} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" class="line-chart" preserveAspectRatio="none">
    <defs><linearGradient id="grad${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".25"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#grad${uid})" stroke="none"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    ${points.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.2" fill="${color}"/>`).join('')}
  </svg>`;
}
function renderTrends() {
  const sessions = sget('rehab_sessions', []);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const reps = new Array(30).fill(0);
  const bad = new Array(30).fill(0);
  const cnt = new Array(30).fill(0);
  for (const s of sessions) {
    const d = new Date(s.ts); d.setHours(0, 0, 0, 0);
    const i = Math.round((today - d) / 86400000);
    if (i >= 0 && i < 30) {
      const idx = 29 - i;
      reps[idx] += s.reps;
      bad[idx] += s.badPct || 0;
      cnt[idx]++;
    }
  }
  const qual = bad.map((b, i) => (cnt[i] ? Math.round(b / cnt[i]) : 0));
  $('trend-chart').innerHTML = lineChart(reps, '#0e7c66', 't');
  $('quality-chart').innerHTML = lineChart(qual, '#d14a4a', 'q');
}
function renderDist() {
  const sessions = sget('rehab_sessions', []);
  const totals = {};
  sessions.forEach((s) => { totals[s.ex] = (totals[s.ex] || 0) + s.reps; });
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  if (!entries.length) { $('dist-chart').innerHTML = emptyBox('record', 'emptyList'); return; }
  const max = entries[0][1];
  $('dist-chart').innerHTML = entries.map(([id, n]) => {
    const e = EXERCISES[id];
    return `<div class="dist-row">
      <span class="dist-name"><span class="t-ico">${icon(e ? e.icon : 'custom')}</span>${e ? exName(e) : id}</span>
      <div class="dist-bar"><div class="dist-fill" style="width:${(100 * n / max).toFixed(1)}%"></div></div>
      <span class="dist-num">${n}</span>
    </div>`;
  }).join('');
}

/* ============ 成就系统 ============ */
function calcStreak(sessions) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    if (sessions.some((s) => new Date(s.ts).toDateString() === d.toDateString())) streak++;
    else if (i > 0) break;
  }
  return streak;
}
const ACHIEVEMENTS = [
  { id: 'first', icon: 'star', nameKey: 'achFirst', descKey: 'achFirstD', test: (x) => x.sessions >= 1 },
  { id: 's10', icon: 'medal', nameKey: 'achS10', descKey: 'achS10D', test: (x) => x.sessions >= 10 },
  { id: 'r100', icon: 'target', nameKey: 'achR100', descKey: 'achR100D', test: (x) => x.reps >= 100 },
  { id: 'r1000', icon: 'trophy', nameKey: 'achR1000', descKey: 'achR1000D', test: (x) => x.reps >= 1000 },
  { id: 'streak7', icon: 'flame', nameKey: 'achStreak7', descKey: 'achStreak7D', test: (x) => x.streak >= 7 },
  { id: 'plan1', icon: 'check', nameKey: 'achPlan1', descKey: 'achPlan1D', test: (x) => x.planDays >= 1 },
  { id: 'plan7', icon: 'medal', nameKey: 'achPlan7', descKey: 'achPlan7D', test: (x) => x.planDays >= 7 },
  { id: 'custom', icon: 'custom', nameKey: 'achCustom', descKey: 'achCustomD', test: (x) => x.customCount >= 1 },
  { id: 'collect', icon: 'flask', nameKey: 'achCollect', descKey: 'achCollectD', test: (x) => x.collectCount >= 50 },
];
function renderAchievements() {
  const sessions = sget('rehab_sessions', []);
  const stats = {
    sessions: sessions.length,
    reps: sessions.reduce((a, s) => a + s.reps, 0),
    streak: calcStreak(sessions),
    planDays: Object.keys(sget('rehab_plan_done', {})).length,
    customCount: customList().length,
    collectCount: state.collectBuf.length,
  };
  $('ach-grid').innerHTML = ACHIEVEMENTS.map((a) => {
    const okv = a.test(stats);
    return `<div class="ach-item ${okv ? 'on' : ''}">
      <div class="ach-ico">${icon(okv ? a.icon : 'lock')}</div>
      <div class="ach-name">${t(a.nameKey)}</div>
      <div class="ach-desc">${t(a.descKey)}</div>
    </div>`;
  }).join('');
}

/* ============ 康复计划 ============ */
const planGet = () => sget('rehab_plan', []);
const planDoneGet = () => sget('rehab_plan_done', {});
const todayKeyStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function planForToday() {
  const day = new Date().getDay();
  return planGet().filter((p) => (p.days || []).includes(day));
}
function renderTodayPlan() {
  const items = planForToday();
  const done = planDoneGet()[todayKeyStr()] || [];
  const el = $('today-plan');
  if (!items.length) { el.innerHTML = emptyBox('check', 'planNone'); return; }
  const doneCount = items.filter((p) => done.includes(p.ex)).length;
  el.innerHTML = items.map((p) => {
    const e = getEx(p.ex);
    const isDone = done.includes(p.ex);
    return `<div class="item">
      <button class="todo-check ${isDone ? 'on' : ''}" data-ex="${p.ex}">${isDone ? icon('check') : ''}</button>
      <div style="flex:1">
        <div class="t"><span class="t-ico">${icon(e ? e.icon : 'custom')}</span>${e ? exName(e) : p.ex} · ${t('repsN', { n: p.reps })}</div>
      </div>
    </div>`;
  }).join('') + `<div class="plan-progress">
      <div class="plan-progress-txt">${t('planProgress', { d: doneCount, t: items.length })}</div>
      <div class="plan-bar"><div class="plan-fill" style="width:${(100 * doneCount / items.length).toFixed(0)}%"></div></div>
    </div>`;
  el.querySelectorAll('.todo-check').forEach((b) => b.addEventListener('click', () => togglePlanDone(b.dataset.ex)));
}
function togglePlanDone(ex) {
  const dd = planDoneGet();
  const k = todayKeyStr();
  const arr = dd[k] || [];
  const i = arr.indexOf(ex);
  if (i >= 0) arr.splice(i, 1); else arr.push(ex);
  dd[k] = arr;
  sset('rehab_plan_done', dd);
  renderTodayPlan();
  renderAchievements();
  renderGoal();
  scheduleCloudSync();
}
function renderPlanList() {
  const list = planGet();
  const el = $('plan-list');
  if (!list.length) { el.innerHTML = emptyBox('sliders', 'planEmpty'); return; }
  el.innerHTML = list.map((p) => {
    const e = getEx(p.ex);
    return `<div class="item">
      <div>
        <div class="t"><span class="t-ico">${icon(e ? e.icon : 'custom')}</span>${e ? exName(e) : p.ex} · ${t('repsN', { n: p.reps })}</div>
        <div class="d">${(p.days || []).map((d) => new Date(2024, 0, 7 + d).toLocaleDateString(locale(), { weekday: 'short' })).join(' · ')}</div>
      </div>
      <button class="mini del" data-plan-del="${p.ex}">${icon('trash')}</button>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-plan-del]').forEach((b) => b.addEventListener('click', () => {
    sset('rehab_plan', planGet().filter((p) => p.ex !== b.dataset.planDel));
    renderPlanList(); renderTodayPlan();
    scheduleCloudSync();
  }));
}
let planEditEx = null;
let planEditDays = new Set([1, 3, 5]);
function renderPlanDayDots() {
  $('plan-days').innerHTML = [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const label = new Date(2024, 0, 7 + d).toLocaleDateString(locale(), { weekday: 'short' });
    return `<button class="plan-day ${planEditDays.has(d) ? 'on' : ''}" data-day="${d}">${label}</button>`;
  }).join('');
  $('plan-days').querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
    const d = +b.dataset.day;
    if (planEditDays.has(d)) planEditDays.delete(d); else planEditDays.add(d);
    renderPlanDayDots();
  }));
}
function renderPlanPick() {
  const all = ['squat', 'lunge', 'pushup', 'sitstand', 'hiphinge', 'stepup', 'shoulderraise', 'standing', 'sitting', ...customList().map((e) => e.id)];
  $('plan-ex-pick').innerHTML = all.map((id) => {
    const e = getEx(id);
    return `<button class="chip ${planEditEx === id ? 'on' : ''}" data-pick="${id}"><span class="chip-ico">${icon(e.icon)}</span><span>${exName(e)}</span></button>`;
  }).join('');
  $('plan-ex-pick').querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    planEditEx = b.dataset.pick;
    renderPlanPick();
  }));
}
$('btn-plan-add').addEventListener('click', () => {
  planEditEx = planEditEx || 'squat';
  renderPlanPick();
  renderPlanDayDots();
  $('plan-editor').classList.remove('hidden');
  $('plan-editor').scrollIntoView({ behavior: 'smooth' });
});
$('btn-plan-cancel').addEventListener('click', () => $('plan-editor').classList.add('hidden'));
$('btn-plan-save').addEventListener('click', () => {
  if (!planEditEx) { toast(t('planPickEx')); return; }
  const reps = Math.max(1, +$('plan-reps').value || 30);
  const days = [...planEditDays].sort();
  const list = planGet();
  const i = list.findIndex((p) => p.ex === planEditEx);
  if (i >= 0) list[i] = { ex: planEditEx, reps, days };
  else list.push({ ex: planEditEx, reps, days });
  sset('rehab_plan', list);
  $('plan-editor').classList.add('hidden');
  renderPlanList(); renderTodayPlan(); renderAchievements();
  toast(t('planAdded'));
  scheduleCloudSync();
});

/* ============ 训练提醒 ============ */
const remGet = () => LS.get('rehab_reminder', { on: false, time: '18:00' });
function renderReminder() {
  const r = remGet();
  $('rem-time').value = r.time || '18:00';
  $('btn-rem-toggle').textContent = r.on ? t('btnRemDisable') : t('btnRemEnable');
  $('btn-rem-toggle').classList.toggle('primary', !r.on);
  $('rem-status').textContent = r.on ? t('remOn', { t: r.time }) : '';
}
$('btn-rem-toggle').addEventListener('click', async () => {
  const r = remGet();
  if (!r.on) {
    if (!('Notification' in window)) { toast(t('remDenied')); return; }
    let perm = Notification.permission;
    if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; } }
    if (perm !== 'granted') { toast(t('remDenied')); return; }
    r.on = true;
    r.time = $('rem-time').value || '18:00';
  } else {
    r.on = false;
  }
  LS.set('rehab_reminder', r);
  renderReminder();
});
$('rem-time').addEventListener('change', () => {
  const r = remGet();
  r.time = $('rem-time').value;
  LS.set('rehab_reminder', r);
  renderReminder();
});
setInterval(() => {
  const r = remGet();
  if (!r.on || !r.time) return;
  const now = new Date();
  const [h, m] = r.time.split(':').map(Number);
  if (now.getHours() === h && now.getMinutes() === m && LS.get('rehab_remind_today') !== now.toDateString()) {
    LS.set('rehab_remind_today', now.toDateString());
    fireReminder();
  }
}, 30000);
function fireReminder() {
  const left = planForToday().filter((p) => !(planDoneGet()[todayKeyStr()] || []).includes(p.ex)).length;
  const msg = left ? t('remindMsgPlan', { n: left }) : t('remindMsg');
  if ('Notification' in window && Notification.permission === 'granted') { try { new Notification(t('appTitle'), { body: msg }); } catch { /* ignore */ } }
  toast(msg);
}
// 补发：今天错过了提醒时间，打开 App 时补一次（不再等到明天）
function reminderCatchUp() {
  const r = remGet();
  if (!r.on || !r.time) return;
  const now = new Date();
  const [h, m] = r.time.split(':').map(Number);
  const due = new Date(now); due.setHours(h, m, 0, 0);
  if (now >= due && LS.get('rehab_remind_today') !== now.toDateString()) {
    LS.set('rehab_remind_today', now.toDateString());
    fireReminder();
  }
}

/* ============ 云同步（Supabase 账号系统） ============ */
// ★ 写死配置位：把 Supabase 项目信息填进这里（如 { url: 'https://xxx.supabase.co', anonKey: 'eyJ...' }），
//   云端同步即刻对所有用户生效，用户界面不会出现任何配置项。填 null 时云端功能待启用。
const CLOUD_HARDCODED = null;
const cloudCfg = () => CLOUD_HARDCODED || LS.get('rehab_cloud', null);
const cloudSession = () => LS.get('rehab_cloud_session', null);
async function cloudReq(path, opts = {}, cfg) {
  const s = cloudSession();
  const res = await fetch(cfg.url.replace(/\/+$/, '') + path, {
    ...opts,
    headers: {
      apikey: cfg.anonKey,
      'Content-Type': 'application/json',
      ...(s && s.access_token ? { Authorization: 'Bearer ' + s.access_token } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try { const j = await res.json(); msg = j.msg || j.message || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}
async function cloudAuth(email, pass, register) {
  const cfg = cloudCfg();
  if (!cfg) throw new Error(t('cloudNotLoggedIn'));
  if (register) {
    await cloudReq('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password: pass }) }, cfg);
  }
  const r = await cloudReq('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password: pass }) }, cfg);
  LS.set('rehab_cloud_session', { access_token: r.access_token, refresh_token: r.refresh_token, uid: r.user?.id, email });
  renderCloud();
}
async function cloudSync() {
  const cfg = cloudCfg();
  const s = cloudSession();
  if (!cfg || !s) throw new Error(t('cloudNotLoggedIn'));
  $('cloud-status').textContent = t('cloudSyncing');
  // 拉取云端全部快照 → 按时间升序合并 → 合并本地 → 写回一条快照
  const rows = await cloudReq(`/rest/v1/userdata?user_id=eq.${s.uid}&select=payload,updated_at&order=updated_at.asc`, {}, cfg);
  for (const row of rows || []) mergeSyncData(row.payload || {});
  const merged = makeSyncData(true);
  await cloudReq('/rest/v1/userdata?on_conflict=id', {
    method: 'POST',
    body: JSON.stringify({ id: s.uid, user_id: s.uid, payload: merged, updated_at: new Date().toISOString() }),
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  }, cfg);
  $('cloud-status').textContent = t('cloudOk');
  renderRecords(); renderAssessments(); renderAppts(); renderCustomList(); renderExChips(); renderProfile();
  renderTodayPlan(); renderPlanList(); renderAchievements(); renderCollectCount(); renderGoal();
}
/* ============ 首次启动引导 + 版本更新检测 ============ */
const OB_STEPS = [
  { ico: 'squat', titleKey: 'obTitle1', textKey: 'obText1' },
  { ico: 'schedule', titleKey: 'obTitle2', textKey: 'obText2' },
  { ico: 'record', titleKey: 'obTitle3', textKey: 'obText3' },
  { ico: 'cloud', titleKey: 'obTitle4', textKey: 'obText4' },
];
let obStep = 0;
function renderOnboard() {
  const s = OB_STEPS[obStep];
  $('ob-ico').innerHTML = icon(s.ico);
  $('ob-title').textContent = t(s.titleKey);
  $('ob-text').textContent = t(s.textKey);
  $('ob-dots').innerHTML = OB_STEPS.map((_, i) => `<span class="ob-dot ${i === obStep ? 'on' : ''}"></span>`).join('');
  $('btn-ob-next').textContent = obStep === OB_STEPS.length - 1 ? t('obStart') : t('obNext');
}
function closeOnboard() {
  LS.set('rehab_onboarded', true);
  $('onboard').classList.add('hidden');
  renderAuth();
}
function showOnboard() {
  if (LS.get('rehab_onboarded', false)) return;
  obStep = 0;
  renderOnboard();
  $('onboard').classList.remove('hidden');
}
$('btn-ob-next').addEventListener('click', () => {
  if (obStep < OB_STEPS.length - 1) { obStep++; renderOnboard(); }
  else closeOnboard();
});
$('btn-ob-skip').addEventListener('click', closeOnboard);
/* ============ 自主更新（自动检查 → 网页版自动重启 / 安卓版下载安装） ============ */
function verCmp(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}
const UPDATE_JSON = 'https://cdn.jsdelivr.net/gh/xushengqin666-cell/rehab-ai@main/latest.json';
const UPDATE_GH = 'https://api.github.com/repos/xushengqin666-cell/rehab-ai/releases/latest';
const UPD_DAY = 86400000;
const updState = { info: null, swReg: null, waiting: false, autoApply: false, applied: false };
// 双源裁决：版本更高者胜；版本相同时优先 jsDelivr 的 APK 链接（国内可下载）
function pickLatest(best, info) {
  if (!info) return best;
  if (!best) return info;
  const c = verCmp(info.version, best.version);
  if (c > 0) return info;
  if (c === 0 && info.apk && info.apk.includes('jsdelivr') && !(best.apk || '').includes('jsdelivr')) return info;
  return best;
}

async function fetchLatest() {
  // 双源并行取最新：jsDelivr（国内可访问，但边缘缓存偶尔陈旧）+ GitHub API（准确，国内可能连不上）
  // 两者都成功时取版本号较大者——CDN 缓存回退不会漏更新
  let best = null;
  const take = (info) => { best = pickLatest(best, info); };
  const jobs = [
    (async () => {
      try {
        const r = await fetch(UPDATE_JSON, { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          if (j && j.version) take({
            version: String(j.version).replace(/^v/, ''),
            apk: j.apk || '',
            releaseUrl: j.releaseUrl || 'https://github.com/xushengqin666-cell/rehab-ai/releases/latest',
            notes: j.notes || '',
            important: !!j.important,
          });
        }
      } catch { /* 忽略 */ }
    })(),
    (async () => {
      try {
        const r = await fetch(UPDATE_GH);
        if (r.ok) {
          const j = await r.json();
          const tag = String(j.tag_name || '').replace(/^v/, '');
          if (tag) {
            const apkAsset = (j.assets || []).find((a) => /\.apk$/i.test(a.name || ''));
            take({ version: tag, apk: apkAsset ? apkAsset.browser_download_url : '', releaseUrl: j.html_url || '', notes: String(j.body || '').split('\n')[0].slice(0, 120), important: false });
          }
        }
      } catch { /* 忽略 */ }
    })(),
  ];
  await Promise.all(jobs);
  return best;
}
const isAndroidNative = () => !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AutoUpdater);

function showUpdateCard(info) {
  const fb = $('feedback');
  fb.classList.remove('hidden');
  fb.innerHTML = fbWrap('download', `
    <b>${t('updTitle', { v: info.version })}</b>
    <div class="hint">${info.notes ? info.notes : t('updDesc')}</div>
    <div class="upd-actions">
      <button id="btn-upd-now" class="btn small primary"><span class="btn-ico">${icon('download')}</span><span>${t('updBtnNow')}</span></button>
      <button id="btn-upd-later" class="btn small"><span>${t('updBtnLater')}</span></button>
    </div>`);
  fb.className = 'feedback';
  fb._last = null;
  $('btn-upd-later').addEventListener('click', () => fb.classList.add('hidden'));
  $('btn-upd-now').addEventListener('click', () => applyUpdate(info, true));
}

async function applyUpdate(info, manual) {
  const btn = $('btn-upd-now');
  if (btn) { btn.disabled = true; btn.querySelector('span').textContent = '…'; }
  if (isAndroidNative()) {                      // 安卓 App：下载 APK 并唤起系统安装
    try {
      if (!info.apk) throw new Error('no apk url');
      const upd = window.Capacitor.Plugins.AutoUpdater;
      try { upd.addListener('progress', (p) => toast(t('updDownloading', { p: p.percent }))); } catch { /* 无进度回调也兼容 */ }
      if (!manual) {
        // 全自动：静默下载 → 空闲时自动唤起安装
        toast(t('updDownloading', { p: 0 }));
        const r = await upd.download({ url: info.apk });
        if (r && r.ready) {
          if (!state.running) { await upd.install({}); return; }
          updState.pendingInstall = true;        // 训练中 → 等空闲再装
          updState.installWatch = setInterval(async () => {
            if (state.running) return;
            clearInterval(updState.installWatch);
            updState.pendingInstall = false;
            try { await upd.install({}); } catch { showUpdateCard(info); }
          }, 4000);
          setTimeout(() => { if (updState.pendingInstall) { clearInterval(updState.installWatch); updState.pendingInstall = false; } }, 600000);
        } else throw new Error('download failed');
        return;
      }
      toast(t('updDownloading', { p: 0 }));
      const r = await upd.downloadAndInstall({ url: info.apk });
      if (r && r.started) {
        toast(t('updInstalling'));
        setTimeout(() => toast(t('updNeedPerm')), 600);
      } else {
        toast(t('updFail'));
        window.open(info.releaseUrl, '_blank');
      }
    } catch {
      toast(t('updFail'));
      if (info.releaseUrl) window.open(info.releaseUrl, '_blank');
    }
    return;
  }
  // 网页版：Service Worker 下载新版本 → 自动切换 → 自动重启
  if (updState.swReg) {
    toast(t('updRestarting'));
    updState.autoApply = true;
    try { await updState.swReg.update(); } catch { /* 忽略 */ }
    setTimeout(() => {                          // 15 秒后仍未切换 → 打开下载页兜底
      if (!updState.applied && info.releaseUrl) window.open(info.releaseUrl, '_blank');
    }, 15000);
  } else if (info.releaseUrl) {
    window.open(info.releaseUrl, '_blank');
  }
}

const updModeGet = () => LS.get('rehab_upd_mode', 'auto');

async function checkUpdate(manual) {
  if (!manual) {
    if (updModeGet() === 'off') return;          // 用户关闭自动更新（手动检查仍可用）
    const last = LS.get('rehab_update_check', 0);
    if (Date.now() - last < UPD_DAY) return;    // 自动检查：每天最多一次
    LS.set('rehab_update_check', Date.now());
  }
  if (manual) toast(t('updChecking'));
  const info = await fetchLatest();
  if (!info) { if (manual) toast(t('updFail')); return; }
  if (verCmp(info.version, APP_VERSION) <= 0) {
    if (manual) toast(t('updLatest', { v: APP_VERSION.replace(/^v/, '') }));
    updState.info = null;
    aiRun();                                     // AI 管家刷新（无更新项）
    return;
  }
  updState.info = info;
  aiRun();                                       // AI 管家感知新版本
  const auto = updModeGet() === 'auto';
  if (!manual && auto && !isAndroidNative() && !state.running) {
    // 网页版空闲时全自动：静默下载 + 自动重启
    try { await applyUpdate(info, false); } catch { /* 下次再试 */ }
    return;
  }
  if (!manual && auto && isAndroidNative()) {
    // 安卓全自动：后台静默下载 → 空闲时唤起安装（不弹卡片）
    try { await applyUpdate(info, false); } catch { /* 下载失败 → 弹卡片兜底 */ showUpdateCard(info); }
    return;
  }
  showUpdateCard(info);
}

/* ============ AI 系统管家：体检 + 建议 + 反馈收集 ============ */
const aiEnv = () => {
  const sessions = sget('rehab_sessions', []);
  const stats = aiStatsGet();
  const distMap = {};
  sessions.forEach((s) => { const k = s.ex || '?'; distMap[k] = (distMap[k] || 0) + (s.reps || 0); });
  const dist = Object.entries(distMap).map(([ex, reps]) => ({ ex, reps }));
  const achStats2 = {
    sessions: sessions.length,
    reps: sessions.reduce((a, s) => a + (s.reps || 0), 0),
    streak: calcStreak(sessions),
    planDays: Object.keys(sget('rehab_plan_done', {})).length,
    customCount: customList().length,
    collectCount: state.collectBuf.length,
  };
  const ach = ACHIEVEMENTS.reduce((a, x) => a + (x.test(achStats2) ? 1 : 0), 0);
  const lastTs = sessions.length ? Math.max(...sessions.map((s) => s.ts || 0)) : 0;
  return {
    version: APP_VERSION,
    platform: isAndroidNative() ? 'Android' : 'Web',
    lang: getLang(),
    latest: updState.info ? updState.info.version : null,
    important: !!(updState.info && updState.info.important),
    sessions,
    streak: calcStreak(sessions),
    achievementsTotal: ACHIEVEMENTS.length,
    achievementsUnlocked: ach,
    dist,
    profile: profileGet(),
    planCount: planGet().length,
    customCount: loadCustomExercises().length,
    errors: aiErrors(),
    cameraFails: stats.cameraFail || 0,
    modelFails: stats.modelFail || 0,
    daysSinceTrain: lastTs ? (Date.now() - lastTs) / 86400000 : null,
  };
};
let aiLast = null;
function aiRun() {
  const env = aiEnv();
  aiLast = healthCheck(env);
  renderAiCard();
  return aiLast;
}
function renderAiCard() {
  const box = $('ai-card');
  if (!box || !aiLast) return;
  const { score, items } = aiLast;
  const cls = score >= 80 ? 'ok' : (score >= 60 ? 'warn' : 'bad');
  box.innerHTML = `
    <div class="ai-head">
      <div class="ai-score ${cls}"><b>${score}</b><span>/100</span></div>
      <div class="ai-meta">
        <b>${t('aiTitle')}</b>
        <span class="hint">${t('aiSub')}</span>
      </div>
    </div>
    <ul class="ai-items">
      ${items.slice(0, 4).map((it) => `<li class="ai-item ${it.level}"><span class="ai-ico">${icon(it.icon)}</span><span>${t(it.key, it.args)}</span></li>`).join('')}
    </ul>
    <div class="upd-actions">
      <button id="btn-ai-check" class="btn small"><span class="btn-ico">${icon('refresh')}</span><span>${t('aiBtnCheck')}</span></button>
      <button id="btn-ai-fb" class="btn small primary"><span class="btn-ico">${icon('custom')}</span><span>${t('aiBtnFeedback')}</span></button>
    </div>`;
  $('btn-ai-check').addEventListener('click', () => { aiRun(); toast(t('aiScore') + ': ' + aiLast.score + '/100'); });
  $('btn-ai-fb').addEventListener('click', openFeedback);
}
function openFeedback() {
  const m = $('fb-modal');
  m.classList.remove('hidden');
  const env = aiEnv();
  const report = buildFeedbackReport(env, fbRating(), $('fb-text').value);
  $('fb-report').textContent = report.body;
  $('fb-title-preview').textContent = report.title;
}
let fbRating = () => {
  let v = 5;
  try { v = JSON.parse(localStorage.getItem('rehab_fb_rating') || '5'); } catch { /* 忽略 */ }
  return v;
};
function renderFbStars() {
  const r = fbRating();
  const box = $('fb-stars');
  box.innerHTML = [1, 2, 3, 4, 5].map((i) => `<button class="fb-star${i <= r ? ' on' : ''}" data-r="${i}">★</button>`).join('');
  box.querySelectorAll('.fb-star').forEach((b) => b.addEventListener('click', () => {
    localStorage.setItem('rehab_fb_rating', b.dataset.r);
    renderFbStars();
    openFeedback();
  }));
}
function submitFeedback() {
  const env = aiEnv();
  const report = buildFeedbackReport(env, fbRating(), $('fb-text').value);
  aiFeedbackAdd({ rating: fbRating(), text: $('fb-text').value, report: report.body });
  const url = 'https://github.com/xushengqin666-cell/rehab-ai/issues/new?title='
    + encodeURIComponent(report.title) + '&body=' + encodeURIComponent(report.body);
  window.open(url, '_blank');
  toast(t('aiFbDone'));
  $('fb-text').value = '';
  $('fb-modal').classList.add('hidden');
}
function copyFeedback() {
  const env = aiEnv();
  const report = buildFeedbackReport(env, fbRating(), $('fb-text').value);
  navigator.clipboard.writeText(report.title + '\n\n' + report.body).then(() => toast(t('aiFbCopied'))).catch(() => toast(t('shareFail')));
}
// 启动后 AI 管家主动提醒一次（仅当有警告级问题）
function aiProactive() {
  const hc = aiRun();
  const warn = hc.items.find((i) => i.level === 'warn');
  if (warn) setTimeout(() => { if (!$('feedback').classList.contains('hidden')) return; toast(t(warn.key, warn.args)); }, 9000);
}
function renderUpdMode() {
  const sel = $('upd-mode');
  if (!sel) return;
  sel.value = updModeGet();
}

/* ============ 训练中屏幕常亮（Screen Wake Lock） ============ */
let wakeLock = null;
async function acquireWake() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* 部分浏览器不支持，忽略 */ }
}
async function releaseWake() {
  try { if (wakeLock) await wakeLock.release(); } catch { /* 忽略 */ }
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.running) acquireWake();   // 切回前台时重新常亮
});

/* ============ 训练结束：AI 小结 ============ */
function aiSessionEnd() {
  const agg = state.agg || {};
  const frames = agg.frames || 0;
  const secs = Math.max(0, Math.round((Date.now() - (agg.startTS || Date.now())) / 1000));
  const reps = (state.counter && state.counter.reps) || 0;
  if (!(reps > 0 || secs >= 30)) return;              // 太短/没计数 → 不打扰
  const quality = frames > 30 ? Math.round((1 - (agg.badFrames || 0) / frames) * 100) : null;
  const comment = aiSessionComment({ reps, quality, riskEvents: agg.riskFrames || 0, seconds: secs }, !!(ex.rep && ex.rep.hold));
  const ex = state.counter && state.counter.ex ? getEx(state.counter.ex) : getEx(activeExId());
  const fb = $('feedback');
  fb.classList.remove('hidden');
  fb.innerHTML = fbWrap('check', `
    <b>${t('aiSessTitle')}</b>
    <div class="hint">${t('aiSessLine', { ex: exName(ex), n: reps, q: quality == null ? '--' : quality })}</div>
    <div class="hint">🤖 ${t(comment.key, comment.args)}</div>`);
  fb.className = 'feedback';
  fb._last = null;
  aiRun();                                            // 训练数据变了 → 重新体检
}

/* ============ PWA：安装到桌面提示 ============ */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (isAndroidNative() || LS.get('rehab_pwa_prompt_closed', 0)) return;
  const fb = $('feedback');
  if (fb && !fb.classList.contains('hidden')) return; // 有更重要的提示时不抢
  fb.classList.remove('hidden');
  fb.innerHTML = fbWrap('download', `
    <b>${t('pwaTitle')}</b>
    <div class="upd-actions">
      <button id="btn-pwa-install" class="btn small primary"><span class="btn-ico">${icon('download')}</span><span>${t('pwaBtn')}</span></button>
      <button id="btn-pwa-later" class="btn small"><span>${t('updBtnLater')}</span></button>
    </div>`);
  fb.className = 'feedback';
  fb._last = null;
  $('btn-pwa-install').addEventListener('click', async () => {
    fb.classList.add('hidden');
    if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; }
  });
  $('btn-pwa-later').addEventListener('click', () => { fb.classList.add('hidden'); LS.set('rehab_pwa_prompt_closed', Date.now()); });
});

function renderCloud() {
  const cfg = cloudCfg();
  const s = cloudSession();
  const localUser = accountCurrent();
  const av = $('account-avatar');
  if (av) av.textContent = ((s && s.email) || localUser || (cfg ? '?' : '☁'))[0].toUpperCase();
  $('cloud-status').textContent = s ? t('cloudLoggedIn', { e: s.email }) : localUser ? t('cloudLoggedIn', { e: localUser }) : (cfg ? t('cloudNotLoggedIn') : t('cloudUnconfigured'));
  $('btn-cloud-sync').classList.toggle('hidden', !s);
  $('btn-cloud-logout').classList.toggle('hidden', !(s || localUser));
  $('btn-open-login').classList.toggle('hidden', !!(s || localUser));
  $('btn-delete-account').classList.toggle('hidden', !localUser);
  // 配置入口默认对用户隐藏：密钥写死后用户永远看不到；
  // 开发模式（?cfg=1）或云端未配置时由下方逻辑控制，普通用户界面保持纯净
}
// 登录屏：未登录账号 → 启动即显示（真实 App 体验）；访客模式跳过后不再打扰
function renderAuth() {
  const show = !accountCurrent() && !cloudSession() && !LS.get('rehab_guest', false);
  $('auth-screen').classList.toggle('hidden', !show);
  if (show) $('auth-status').textContent = '';
}
function showAuth(openConfig = false) {
  $('auth-screen').classList.remove('hidden');
  $('auth-config').classList.toggle('hidden', !openConfig);
  $('auth-form').classList.toggle('hidden', openConfig);
}
async function linkCloudAfterLogin(email, pass) {
  if (!cloudCfg()) return;
  try { await cloudAuth(email, pass, false); }
  catch { try { await cloudAuth(email, pass, true); } catch { /* 云端不可用则静默，本地账号照常 */ } }
}
async function authLogin(register) {
  const email = $('auth-email').value.trim();
  const pass = $('auth-pass').value;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('auth-status').textContent = t('cloudErr', { msg: 'Email' }); return; }
  if (!pass || pass.length < 6) { $('auth-status').textContent = t('acctPassShort'); return; }
  $('auth-status').textContent = t('cloudSyncing');
  try {
    if (register) {
      await accountRegister(email, pass);
      migrateDeviceData(email);
    }
    await accountLogin(email, pass);
    $('auth-screen').classList.add('hidden');
    reloadCollectBuf();                              // 切到新账号 → 重载采集缓冲区
    renderCloud();
    renderRecords(); renderAssessments(); renderAppts(); renderCustomList(); renderExChips();
    renderProfile(); renderTodayPlan(); renderPlanList(); renderAchievements(); renderCollectCount(); renderGoal();
    toast(register ? t('acctRegistered') : t('acctLoggedIn'));
    linkCloudAfterLogin(email, pass);
  } catch (e) {
    $('auth-status').textContent = t('cloudErr', { msg: e.message });
  }
}
// 登录后数据变更 → 4 秒防抖自动同步（像真 App 一样无感）
let cloudSyncTimer = null;
function scheduleCloudSync() {
  if (!cloudCfg() || !cloudSession()) return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => { cloudSync().catch(() => {}); }, 4000);
}
$('btn-open-login').addEventListener('click', () => showAuth(false));
$('btn-config-server').addEventListener('click', () => showAuth(true));
$('btn-auth-cfg-toggle').addEventListener('click', () => {
  const cfgOpen = !$('auth-config').classList.contains('hidden');
  $('auth-config').classList.toggle('hidden', cfgOpen);
  $('auth-form').classList.toggle('hidden', !cfgOpen);
});
$('btn-auth-cfg-save').addEventListener('click', () => {
  const url = $('auth-url').value.trim();
  const anonKey = $('auth-key').value.trim();
  if (!/^(https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?|https:\/\/.+\.supabase\.(co|com))/i.test(url) || !anonKey) { $('auth-status').textContent = t('cloudErr', { msg: 'URL/key' }); return; }
  LS.set('rehab_cloud', { url, anonKey });
  $('auth-config').classList.add('hidden');
  $('auth-form').classList.remove('hidden');
  $('auth-status').textContent = t('toastCloudCfg');
  renderCloud();
});
$('btn-auth-login').addEventListener('click', () => authLogin(false));
$('btn-auth-signup').addEventListener('click', () => authLogin(true));
$('btn-auth-skip').addEventListener('click', () => {
  LS.set('rehab_guest', true);
  $('auth-screen').classList.add('hidden');
});
$('btn-cloud-sync').addEventListener('click', async () => {
  try { await cloudSync(); } catch (e) { $('cloud-status').textContent = t('cloudNotLoggedIn'); toast(t('cloudErr', { msg: e.message })); }
});
$('btn-cloud-logout').addEventListener('click', () => {
  accountLogout();
  localStorage.removeItem('rehab_cloud_session');
  invalidateCustom();
  reloadCollectBuf();                               // 退出账号 → 重载缓冲区（访客空间）
  renderCloud();
  renderRecords(); renderAssessments(); renderAppts(); renderCustomList(); renderExChips();
  renderProfile(); renderTodayPlan(); renderPlanList(); renderAchievements(); renderCollectCount(); renderGoal();
  renderAuth();
  toast(t('toastLogout'));
});
$('btn-delete-account').addEventListener('click', () => {
  const u = accountCurrent();
  if (!u) return;
  if (!confirm(t('acctDeleteConfirm', { e: u }))) return;
  accountDelete();
});

/* ============ 语音播报（系统 TTS，离线可用） ============ */
const voiceEnabled = () => LS.get('rehab_voice', false);
function speak(text) {
  if (!voiceEnabled() || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, ''));
    u.lang = locale() === 'zh-CN' ? 'zh-CN' : 'en-US';
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}
function renderVoice() {
  $('btn-voice-toggle').textContent = voiceEnabled() ? t('btnVoiceDisable') : t('btnVoiceEnable');
  $('btn-voice-toggle').classList.toggle('primary', !voiceEnabled());
  $('voice-status').textContent = voiceEnabled() ? t('voiceOn') : '';
}
$('btn-voice-toggle').addEventListener('click', () => {
  LS.set('rehab_voice', !voiceEnabled());
  renderVoice();
  speak(t('voiceOn'));
});

/* ============ 轻提示 ============ */
function toast(msg) {
  let t = $('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.opacity = 1; t.style.transform = 'translate(-50%, 0)';
  clearTimeout(t._tm);
  t._tm = setTimeout(() => { t.style.opacity = 0; t.style.transform = 'translate(-50%, 12px)'; }, 2200);
}

/* ============ 内置自测（#selftest，供开发/证据用） ============ */
async function selfTest() {
  const out = $('selftest-out');
  const log = (name, ok, detail) => {
    out.innerHTML += `<div class="${ok ? 'st-pass' : 'st-fail'}">${ok ? '✅' : '❌'} ${name} ${detail || ''}</div>`;
    console.log('SELFTEST:', name, ok ? 'PASS' : 'FAIL', detail || '');
  };
  try {
    // 构造正面站姿骨架（肩-髋-膝-踝）
    const mk = (x, y, vis = 1) => ({ x, y, z: 0, visibility: vis });
    const base = () => {
      const lms = new Array(33).fill(null);
      const set = (i, x, y) => { lms[i] = mk(x, y); };
      set(0, 0.5, 0.10);               // 鼻
      set(11, 0.42, 0.22); set(12, 0.58, 0.22);  // 肩
      set(23, 0.44, 0.45); set(24, 0.56, 0.45);  // 髋
      set(25, 0.46, 0.65); set(26, 0.54, 0.65);  // 膝
      set(27, 0.48, 0.85); set(28, 0.52, 0.85);  // 踝
      set(13, 0.40, 0.30); set(14, 0.60, 0.30);  // 肘
      set(15, 0.38, 0.38); set(16, 0.62, 0.38);  // 腕
      for (let i = 0; i < 33; i++) if (!lms[i]) lms[i] = mk(0.5, 0.5, 0);
      return lms;
    };
    // 1. 角度数学
    const p = mk(0, 0), q = mk(0, 1), r = mk(1, 1);
    const ang = angle3(p, q, r);
    log(t('stAngle'), Math.abs(ang - 90) < 0.5, `got ${ang.toFixed(1)}`);
    // 2. 深蹲判定：标准（膝角 ~100）
    let lms = base();
    const res = analyzeAny(lms, EXERCISES.squat);
    log(t('stSquat'), Array.isArray(res.features) && res.features.length === 4, JSON.stringify(res.features));
    // 3. 内扣检测：右膝向内偏移 → valgus
    const vgLms = base(); vgLms[26].x = 0.50;  // 右膝移到髋-踝中点内侧
    const vg = kneeValgus(vgLms);
    log(t('stValgus'), vg.valgus === true, `L${vg.left} R${vg.right}`);
    // 4. 计数状态机（含防抖：需持续低于阈值 + 两次计数最小间隔）
    let c = { state: 'up', reps: 0, d: 100, u: 150, belowT: 0, lastRepTs: 0, confirmMs: 120, minGapMs: 350 };
    counterUpdate(c, 80, 1000); counterUpdate(c, 80, 1150); const mid = c.state; const reps1 = c.reps; // 持续120ms → down
    counterUpdate(c, 160, 1300); const reps2 = c.reps;                                                // → up, reps=1
    counterUpdate(c, 80, 1400); counterUpdate(c, 80, 1530); const mid2 = c.state; const reps3 = c.reps; // 间隔<350ms 不重计
    counterUpdate(c, 160, 1700); counterUpdate(c, 80, 1900); counterUpdate(c, 80, 2040);
    counterUpdate(c, 160, 2200); const repsFinal = c.reps;
    log(t('stCounter'), mid === 'down' && reps1 === 0 && reps2 === 1, `reps=${reps2}`);
    log(t('stDebounce'), mid2 === 'up' && reps3 === 1 && repsFinal === 2, `final reps=${repsFinal}`);
    // 5. 弓步蹲/俯卧撑 能跑通
    const lunge = analyzeAny(base(), EXERCISES.lunge);
    log(t('stLunge'), lunge.features.length === 3, JSON.stringify(lunge.features));
    const pushup = analyzeAny(base(), EXERCISES.pushup);
    log(t('stPushup'), pushup.features.length === 2, JSON.stringify(pushup.features));
    // 6. 自定义动作引擎
    const custom = customDefault();
    const cres = analyzeAny(base(), custom);
    log(t('stCustom'), cres.features.length === 2 && typeof cres.repValue === 'number', JSON.stringify(cres.features));
    // 7. 自定义规则触发
    const c2 = customDefault(); c2.rules[0].max = 50;   // a1(≈128°) 超出 max=50 → bad
    const c2res = analyzeAny(base(), c2);
    log(t('stCustomRule'), c2res.depth === 'bad' && c2res.badMsgs.length > 0, c2res.badMsgs.join('|'));
    // 8. 日常高频动作引擎
    const ss = analyzeAny(base(), EXERCISES.sitstand);
    log(t('stSitStand'), ss.features.length === 3 && typeof ss.repValue === 'number', JSON.stringify(ss.features));
    const hh = analyzeAny(base(), EXERCISES.hiphinge);
    log(t('stHipHinge'), hh.features.length === 3, JSON.stringify(hh.features));
    const su = analyzeAny(base(), EXERCISES.stepup);
    log(t('stStepUp'), su.features.length === 3, JSON.stringify(su.features));
    const sr = analyzeAny(base(), EXERCISES.shoulderraise);
    log(t('stShoulderRaise'), sr.features.length === 3, JSON.stringify(sr.features));
    // 9. 受伤风险警报：弯腰+直腿搬物 → 弓背风险 2 级
    const hh2 = base();
    hh2[11] = mk(0.18, 0.46); hh2[12] = mk(0.20, 0.46);
    const hhRisk = analyzeAny(hh2, EXERCISES.hiphinge);
    log(t('stRiskAlarm'), hhRisk.riskLevel === 2 && hhRisk.risk.length > 0, `level=${hhRisk.riskLevel} ${hhRisk.risk.join('|')}`);
    // 10. 身体完整性检测：右踝不可见 → 提醒缺「踝」；另一侧被遮挡不算缺失（侧面视角不误报）
    const inc = base(); inc[28].visibility = 0;
    const miss = bodyMissing(inc);
    log(t('stBodyCheck'), miss.length === 1 && miss[0] === t('jAnkle'), miss.join(','));
    const side = base(); side[23].visibility = 0; side[25].visibility = 0; side[27].visibility = 0;
    const miss2 = bodyMissing(side);
    log(t('stBodySide'), miss2.length === 0, miss2.join(',') || 'OK');
    // 11. 智能识别分类（5 种合成姿势）
    const mkPose = (mutate) => { const b = base(); mutate(b); return b; };
    const squatP = mkPose((b) => { [23, 24].forEach((i) => { b[i].x = 0.5; b[i].y = 0.55; }); [25, 26].forEach((i) => { b[i].x = 0.62; b[i].y = 0.70; }); });
    const hingeP = mkPose((b) => { [11, 12].forEach((i) => { b[i].x = 0.25; b[i].y = 0.5; }); });
    const pushP = mkPose((b) => {
      [11, 12].forEach((i) => { b[i].x = 0.20; b[i].y = 0.75; });
      [13, 14].forEach((i) => { b[i].x = 0.28; b[i].y = 0.82; });
      [15, 16].forEach((i) => { b[i].x = 0.20; b[i].y = 0.90; });
      [23, 24].forEach((i) => { b[i].x = 0.50; b[i].y = 0.75; });
      [25, 26].forEach((i) => { b[i].x = 0.62; b[i].y = 0.75; });
      [27, 28].forEach((i) => { b[i].x = 0.80; b[i].y = 0.75; });
    });
    const stepP = mkPose((b) => { b[26].x = 0.68; b[26].y = 0.58; });
    const raiseP = mkPose((b) => { b[14].x = 0.58; b[14].y = 0.12; b[16].x = 0.58; b[16].y = 0.03; });
    const autoRes = [classifyAuto(squatP), classifyAuto(hingeP), classifyAuto(pushP), classifyAuto(stepP), classifyAuto(raiseP)];
    log(t('stAutoClass'), autoRes.join(',') === 'squat,hiphinge,pushup,stepup,shoulderraise', autoRes.join(','));
    // 11b. 智能识别·静止姿态：站姿/坐姿（稳定历史 → 静态判定）
    const tN = performance.now();
    const still = (y) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ y, t: tN - 1000 + i * 100 }));
    const sitP = mkPose((b) => {
      [23, 24].forEach((i) => { b[i].x = 0.42; b[i].y = 0.52; });
      [25, 26].forEach((i) => { b[i].x = 0.56; b[i].y = 0.64; });
      [27, 28].forEach((i) => { b[i].x = 0.50; b[i].y = 0.86; });
      [11, 12].forEach((i) => { b[i].x = 0.44; b[i].y = 0.24; });
    });
    const standCls = classifyAuto(base(), still(0.45), tN);
    const sitCls = classifyAuto(sitP, still(0.52), tN);
    log(t('stAutoPosture'), standCls === 'standing' && sitCls === 'sitting', `${standCls},${sitCls}`);
    // 11b2. 噪声晃动下仍判静止（修复「一直显示深蹲」：摄像头噪声+身体微晃不再误判为运动）
    const noisy = (y, amp) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ y: y + amp * (i % 3 - 1), t: tN - 1000 + i * 100 }));
    const standNoisyCls = classifyAuto(base(), noisy(0.45, 0.02), tN);
    const sitNoisyCls = classifyAuto(sitP, noisy(0.52, 0.02), tN);
    log(t('stAutoNoise'), standNoisyCls === 'standing' && sitNoisyCls === 'sitting', `${standNoisyCls},${sitNoisyCls}`);
    // 11c. 站姿/坐姿分析
    const stRes = EXERCISES.standing.analyze(base());
    const stBad = EXERCISES.standing.analyze(mkPose((b) => { [11, 12].forEach((i) => { b[i].x = 0.40; b[i].y = 0.35; }); b[0].x = 0.35; b[0].y = 0.28; }));
    log(t('stStanding'), stRes.depth === 'ok' && stBad.depth === 'bad', `lean=${stRes.metrics.lean.toFixed(1)}/${stBad.metrics.lean.toFixed(1)}`);
    const siRes = EXERCISES.sitting.analyze(sitP);
    const siBadP = mkPose((b) => {
      [23, 24].forEach((i) => { b[i].x = 0.42; b[i].y = 0.52; });
      [25, 26].forEach((i) => { b[i].x = 0.56; b[i].y = 0.64; });
      [27, 28].forEach((i) => { b[i].x = 0.50; b[i].y = 0.86; });
      [11, 12].forEach((i) => { b[i].x = 0.55; b[i].y = 0.40; });
    });
    const siBad = EXERCISES.sitting.analyze(siBadP);
    log(t('stSitting'), siRes.depth === 'ok' && siBad.depth === 'bad', `lean=${siRes.metrics.lean.toFixed(1)}/${siBad.metrics.lean.toFixed(1)}`);
    // 12. 自主更新：版本比较
    const vc = verCmp('2.14.0', '2.13.9') === 1 && verCmp('v2.9.1', '2.10.0') === -1
      && verCmp('2.15.0', 'v2.15.0') === 0 && verCmp('2.3.10', '2.3.9') === 1 && verCmp('1.0', '1.0.1') === -1;
    log(t('stVerCmp'), vc, '5/5');
    // 13. AI 系统管家：体检 + 反馈报告
    const aiGood = healthCheck({ version: 'v2.16.0', latest: null, sessions: [{ ts: Date.now(), reps: 20 }], streak: 1, dist: [{ ex: 'squat', reps: 20 }], profile: { name: 'x', goal: 'knee' }, planCount: 1, errors: [], cameraFails: 0, modelFails: 0, daysSinceTrain: 0 });
    log(t('stAiHealth'), aiGood.score === 100 && aiGood.items.length >= 1, `score=${aiGood.score}`);
    const aiBad = healthCheck({ version: 'v2.16.0', latest: null, sessions: [], streak: 0, dist: [], profile: {}, planCount: 0, errors: [{ t: Date.now(), tag: 'js', msg: 'x' }, { t: Date.now(), tag: 'camera', msg: 'y' }], cameraFails: 3, modelFails: 0, daysSinceTrain: 10 });
    log(t('stAiHealth'), aiBad.score <= 60 && aiBad.items.some((i) => i.level === 'warn'), `score=${aiBad.score} items=${aiBad.items.length}`);
    const rep = buildFeedbackReport({ version: 'v2.16.0', platform: 'Web', lang: 'zh', sessions: [], streak: 0, dist: [], cameraFails: 0, modelFails: 0, errors: [] }, 5, '很好用');
    log(t('stAiReport'), rep.body.includes('v2.16.0') && rep.body.includes('系统体检') && rep.body.includes('很好用'), rep.title);
    // 14. 保持计时器：合格时间才累计 + 连续不合格暂停
    const holdC = { reps: 0, holdMs: 29000, lastHoldTs: tN, wasBad: false };
    const savedCounter = state.counter;
    state.counter = holdC;
    counterHold(EXERCISES.standing, { depth: 'ok', msgsIsBad: false }, tN + 1500);
    const okHold = holdC.reps === 1 && holdC.holdMs === 500;
    counterHold(EXERCISES.standing, { depth: 'bad', msgsIsBad: true }, tN + 1900);
    const h1 = holdC.holdMs;
    counterHold(EXERCISES.standing, { depth: 'bad', msgsIsBad: true }, tN + 2400);
    const pauseHold = holdC.holdMs === h1;
    state.counter = savedCounter;
    log(t('stHoldTimer'), okHold && pauseHold, `reps=${holdC.reps} hold=${holdC.holdMs}`);
    // 15. AI 错误 7 天窗口：老错误不再扣分
    const oldErr = healthCheck({ version: APP_VERSION, latest: null, sessions: [{ ts: Date.now(), reps: 5 }], streak: 1, dist: [{ ex: 'squat', reps: 5 }], profile: { name: 'x', goal: 'knee' }, planCount: 1, errors: [{ t: Date.now() - 8 * 86400000, tag: 'js', msg: 'old' }], cameraFails: 0, modelFails: 0, daysSinceTrain: 0 });
    log(t('stErrWindow'), oldErr.score === 100, `score=${oldErr.score}`);
    // 16. 智能识别投票防抖：66% 票数 + 连续 4 帧
    const v1 = autoSwitchOk({ squat: 10, lunge: 2 }, ['squat', 'squat', 'squat', 'squat']) === 'squat';
    const v2 = autoSwitchOk({ squat: 7, lunge: 5 }, ['lunge', 'squat', 'lunge', 'squat']) === null;
    const v3 = autoSwitchOk({ squat: 10, lunge: 2 }, ['lunge', 'lunge', 'lunge', 'lunge']) === null;
    log(t('stAutoVote'), v1 && v2 && v3, '3 组裁决');
    // 16b. 双源更新裁决：版本高者胜；等版本时保留 jsDelivr 链接
    const p1 = pickLatest(null, { version: '2.17.3', apk: 'https://github.com/x.apk' });
    const p2 = pickLatest(p1, { version: '2.17.3', apk: 'https://cdn.jsdelivr.net/x.apk' });
    const p3 = pickLatest(p2, { version: '2.17.1', apk: 'https://y.apk' });
    const p4 = pickLatest(p2, { version: '2.17.4', apk: 'https://github.com/z.apk' });
    log(t('stPickLatest'), p1.version === '2.17.3' && p2.apk.includes('jsdelivr') && p3.version === '2.17.3' && p4.version === '2.17.4', `${p2.version}/${p4.version}`);
    // 17. 腿伸直坐姿识别 + 体态小结专属文案
    const sitLegs = mkPose((b) => {
      [23, 24].forEach((i) => { b[i].x = 0.42; b[i].y = 0.52; });
      [25, 26].forEach((i) => { b[i].x = 0.55; b[i].y = 0.52; });
      [27, 28].forEach((i) => { b[i].x = 0.66; b[i].y = 0.52; });
      [11, 12].forEach((i) => { b[i].x = 0.44; b[i].y = 0.24; });
    });
    const sitLegsCls = classifyAuto(sitLegs, still(0.52), tN);
    const holdComment = aiSessionComment({ reps: 0, quality: null, riskEvents: 0 }, true);
    log(t('stAutoPosture'), sitLegsCls === 'sitting' && holdComment.key === 'aiSessHoldNone', `${sitLegsCls},${holdComment.key}`);
    out.innerHTML += `<div class="st-pass" style="margin-top:8px;font-weight:800">${t('stAllPass')}</div>`;
    console.log('SELFTEST: ALL PASS');
  } catch (e) {
    out.innerHTML += `<div class="st-fail">${t('stError', { msg: e.message })}</div>`;
    console.log('SELFTEST: ERROR', e);
  }
}

/* ============ 启动 ============ */
initI18n();
setCustomKey(ukey('rehab_custom_ex'));   // 账号分区：自定义动作按当前账号隔离
onLangChanged(() => {
  renderExChips(); renderCollectLabels(getEx(activeExId()));
  renderRecords(); renderAssessments(); renderAppts(); renderCustomList();
  renderCollectCount();
  renderProfile(); renderReminder(); renderCloud();
  renderTodayPlan(); renderPlanList(); renderPlanPick(); renderPlanDayDots();
  renderGoal(); renderVoice(); renderAchievements();   // 成就网格也随语言切换
  aiRun();                                              // AI 管家卡片随语言切换
  setStartBtn(state.running ? 'btnStop' : 'btnStart', state.running ? 'stop' : 'play');
  $('btn-collect-label').textContent = state.collectMode ? t('btnCollectStop') : t('btnCollect');
  $('feedback')._last = null;
  if (state.running) state.statsKey = null;   // 下一帧按新语言重建统计
  if (state._lastCamErr && !$('cam-retry').classList.contains('hidden')) showCameraError(state._lastCamErr, state._lastCamIsModel);
});
renderExChips(); renderCollectLabels(getEx(activeExId())); resetAgg();
renderRecords(); renderAssessments(); renderAppts(); renderCustomList();
renderCollectCount();
renderProfile(); renderReminder(); renderCloud(); renderAuth();
renderTodayPlan(); renderPlanList();
renderVoice();
showOnboard();
setTimeout(reminderCatchUp, 4000);            // 错过提醒时间 → 打开时补一次
// 开发模式：?cfg=1 显示配置入口（普通用户永远看不到；密钥写死后由 CLOUD_HARDCODED 生效）
if (location.search.includes('cfg')) {
  $('btn-auth-cfg-toggle').classList.remove('hidden');
  $('btn-config-server').classList.remove('hidden');
}
$('btn-collect-label').textContent = t('btnCollect');
setStartBtn('btnStart', 'play');
// 登录用户：启动后自动同步一次；自主更新检测（每天一次，空闲时网页版全自动）
if (cloudCfg() && cloudSession()) setTimeout(() => cloudSync().catch(() => {}), 2500);
if (!location.search.includes('updatetest')) setTimeout(() => checkUpdate(false), 6000);
// AI 系统管家：启动体检 + 主动提醒 + 全局异常收集
aiProactive();
// 标题随语言切换（中文 → 康复AI）
const syncTitle = () => { document.title = t('pageTitle'); };
syncTitle();
onLangChanged(syncTitle);
window.addEventListener('error', (ev) => logAiError('js', (ev && (ev.message || ev.type)) || 'unknown'));
window.addEventListener('unhandledrejection', (ev) => logAiError('promise', (ev && ev.reason && (ev.reason.message || String(ev.reason))) || 'unknown'));
renderUpdMode();
$('upd-mode').addEventListener('change', () => { LS.set('rehab_upd_mode', $('upd-mode').value); toast(t('updModeLabel') + ': ' + $('upd-mode').selectedOptions[0].textContent); });
renderFbStars();
$('btn-fb-submit').addEventListener('click', submitFeedback);
$('btn-fb-copy').addEventListener('click', copyFeedback);
$('btn-fb-close').addEventListener('click', () => $('fb-modal').classList.add('hidden'));
$('fb-modal').addEventListener('click', (ev) => { if (ev.target === $('fb-modal')) $('fb-modal').classList.add('hidden'); });
$('fb-text').addEventListener('input', openFeedback);
// 关于：版本号 + 分享
$('about-version').textContent = t('versionLabel', { v: APP_VERSION });
$('btn-check-update').addEventListener('click', () => checkUpdate(true));
$('btn-share').addEventListener('click', async () => {
  const url = location.href;
  try {
    if (navigator.share) {
      await navigator.share({ title: t('appTitle'), text: t('metaDesc'), url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast(t('shareCopied'));
  } catch (e) {
    try { await navigator.clipboard.writeText(url); toast(t('shareCopied')); }
    catch { toast(t('shareFail')); }
  }
});
// PWA：可安装到主屏幕 + 离线可用 + 自主更新（新版就绪 → 自动切换 → 自动重启）
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      updState.swReg = reg;
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        updState.waiting = true;
        nw.addEventListener('statechange', () => {
          if (nw.state !== 'installed' || !navigator.serviceWorker.controller) return;
          if (updState.autoApply) {
            nw.postMessage({ type: 'SKIP_WAITING' });   // 立即接管，马上生效
          } else {
            toast(t('swUpdate'));                        // 有更新但训练中 → 只提示
          }
        });
      });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!updState.autoApply) return;                   // 仅自主更新时自动重启
      updState.applied = true;
      toast(t('updAutoDone', { v: updState.info ? updState.info.version : '' }));
      setTimeout(() => location.reload(), 800);
    });
  });
}
if (location.hash === '#selftest') selfTest();
// 微信内置浏览器不支持摄像头 —— 打开时就提示用系统浏览器
if (/micromessenger/i.test(navigator.userAgent)) {
  const fb = $('feedback');
  fb.classList.remove('hidden');
  fb.innerHTML = fbWrap('alert', t('wechatHint'));
  fb.className = 'feedback warn';
  fb._last = 'wechat';
}
// ?autostart=1 → 页面加载后自动开始分析（测试 / 快捷进入用）
if (location.search.includes('autostart')) setTimeout(() => toggleStart(), 800);
// ?updatetest=1 → 模拟发现新版本（测试更新卡片 UI + AI 管家更新感知，不真实下载）
if (location.search.includes('updatetest')) {
  setTimeout(() => {
    const fake = { version: '9.9.9', apk: '', releaseUrl: 'https://github.com/xushengqin666-cell/rehab-ai/releases/latest', notes: '测试更新说明 TestNotes', important: true };
    updState.info = fake;
    showUpdateCard(fake);
    aiRun();
  }, 800);
}
// ?modeltest=1 → 自检 AI 模型能否加载（wasm/MIME/路径，供部署验证用）
if (location.search.includes('modeltest')) {
  (async () => {
    const out = $('selftest-out');
    const t0 = performance.now();
    try {
      await loadModel();
      out.innerHTML += `<div class="st-pass">✅ model load OK (${Math.round(performance.now() - t0)}ms)</div>`;
      console.log('MODELTEST: PASS');
    } catch (e) {
      out.innerHTML += `<div class="st-fail">❌ model load FAIL: ${e.message}</div>`;
      console.log('MODELTEST: FAIL', e);
    }
  })();
}
// ?alarmtest=1 → 触发一次警报 UI（声音+震动+闪烁），上市验收用
if (location.search.includes('alarmtest')) {
  setTimeout(() => {
    const fb = $('feedback');
    fb.classList.remove('hidden');
    fb.innerHTML = fbWrap('alert', '<b>' + t('alarmTitle') + '</b><br>' + t('riskBackRound'));
    fb.className = 'feedback alarm';
    alarmBurst();
  }, 1000);
}
// ?synctest=1 → 二维码同步编解码/合并自检
if (location.search.includes('synctest')) {
  (async () => {
    const out = $('selftest-out');
    const log = (n, okv, d) => {
      out.innerHTML += `<div class="${okv ? 'st-pass' : 'st-fail'}">${okv ? '✅' : '❌'} ${n} ${d || ''}</div>`;
      console.log('SYNCTEST:', n, okv ? 'PASS' : 'FAIL');
    };
    try {
      const data = { app: 'RehabAI', v: 3, ts: Date.now(), sessions: [{ id: 'a1', ts: 111, reps: 5 }], assessments: [{ id: 'b1', ts: 222, score: 2 }], appts: [], customExercises: [] };
      const b64 = await gzipB64(JSON.stringify(data));
      const back = JSON.parse(await gunzipB64(b64));
      log('gzip 往返编解码', back.sessions?.[0]?.id === 'a1' && back.assessments?.[0]?.id === 'b1');
      const qr = window.qrcode(0, 'L');
      qr.addData(SYNC_PREFIX + '|0|1|' + b64.slice(0, 200), 'Byte');
      qr.make();
      log('二维码生成', qr.getModuleCount() > 10 && qr.isDark(0, 0));
      // 真实往返：画到 canvas 像素 → jsQR 解码
      const cv = document.createElement('canvas');
      const n2 = qr.getModuleCount();
      const S = n2 * 10;
      cv.width = S; cv.height = S;
      const cctx = cv.getContext('2d');
      cctx.fillStyle = '#fff'; cctx.fillRect(0, 0, S, S);
      cctx.fillStyle = '#000';
      for (let r2 = 0; r2 < n2; r2++) for (let c2 = 0; c2 < n2; c2++) if (qr.isDark(r2, c2)) cctx.fillRect(c2 * 10, r2 * 10, 10.5, 10.5);
      const img2 = cctx.getImageData(0, 0, S, S);
      const dec = window.jsQR(img2.data, S, S);
      log('真实二维码 生成→像素→解码', !!dec && dec.data === SYNC_PREFIX + '|0|1|' + b64.slice(0, 200));
      const before = sget('rehab_sessions', []);
      sset('rehab_sessions', [{ id: 'x9', ts: 999, reps: 1 }]);
      mergeSyncData(back);
      const after = sget('rehab_sessions', []);
      sset('rehab_sessions', before);
      log('数据合并(去重+保留双方)', after.length === 2 && after.some((s) => s.id === 'a1'));
      log('jsQR 解码器可用', typeof window.jsQR === 'function');
    } catch (e) {
      log('异常', false, e.message);
    }
  })();
}
