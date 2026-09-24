// 康复AI · 火柴人姿势分析 — 浏览器端 App（手机/电脑通用，数据存本机）
// 支持：深蹲/弓步蹲/俯卧撑/自定义动作、实时火柴人、数据采集闭环、记录/评估/日程
import { FilesetResolver, PoseLandmarker } from './vision_bundle.mjs';
import { t, getLang, locale, initI18n, onLangChanged } from './i18n.js';
import {
  EXERCISES, analyzeAny, loadCustomExercises, saveCustomExercises,
  customDefault, CUSTOM_JOINTS, angle3, kneeValgus, pickSide, setCustomKey,
  verticalAngle,
} from './analysis.js';
import { healthCheck, buildFeedbackReport, logAiError, aiErrors, aiStats, aiStatsGet, aiFeedbackAdd, aiSessionComment, generatePlan } from './ai.js';
import { DEMOS, hasDemo, demoPose, poseOf, figureSvg, demoAngles, clipPut, clipAll, clipDel, clipGet, clipSetForEx, clipForEx, idbAvailable } from './demo.js';

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
const APP_VERSION = 'v2.34.1';
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
  wallsit: '<circle cx="12" cy="4.6" r="2.1"/><path d="M12 6.7v4.2M12 10.9l4.6 3M16.6 13.9v6M12 10.9l-4.6 3M7.4 13.9v6M5 20.5h14"/>',
  plank: '<circle cx="9" cy="4.6" r="2.1"/><path d="M9 6.7l11.2 3.4M9 6.7l-4.2 4.4M9.6 8l3.4 5.2L17.2 20M13 13.2l3.8 6.4"/>',
  bend: '<circle cx="12" cy="4.4" r="2.1"/><path d="M12 6.5v3.6M12 10.1l-3 3.2-1.8 6M12 10.1l3 3.2 1.8 6M12 8.6l-4.4-1.2M12 8.6l4.4-1.2M10 20h4"/>',
  bridge: '<circle cx="6" cy="5" r="2.1"/><path d="M6 7.1v4.8M6 11.9l8.4 1.6 5 3.2M6 11.9l6.8-3.4M12.8 8.5l4.8-2.4"/>',
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
  autoEx: 'standing', autoVotes: {}, autoVoteN: 0, autoHist: [], autoLast4: [], restTimer: null,
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
  const cMain = camConstraints({ facingMode: 'user' });      // v2.30.0：按影像偏好（3:4 竖幅默认，同样距离能看到更多身体）
  const cAny = camConstraints();
  const candidates = [
    { video: cMain, audio: false },
    { video: cAny, audio: false },
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
      await camApplyZoom(stream);   // v2.30.0：设备支持 zoom 时按偏好拉到最广/指定倍数（iOS 不支持则自动跳过）
      camSaveCaps(stream);
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
  // —— 静止坐姿：髋在坐高、膝中等弯曲(80–130°)或双腿前伸、躯干较直立/微前倾(<40°，桌前学习常见) ——
  const legsOut = kneeMin > 150 && Math.abs(lms[s.ankle].y - hipY) < 0.15;   // 腿伸直坐（踝接近髋高）
  if (yRange < 0.06 && hipY > 0.40 && hipY < 0.80 && lean < 40 && ((kneeMin >= 80 && kneeMin <= 130) || legsOut)) return 'sitting';
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
  renderTrainDemo();   // v2.34.0：动作换了，标准示范与录像卡一起换
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
  camGuideUpdate(lms);            // v2.30.0：入镜/距离引导（可关）

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
    $('stats-box').classList.add('hidden');        // v2.20.2：清掉残留统计，不留过期数字
    $('feedback').classList.add('hidden');         // v2.20.2：清掉残留提示，不留旧文案
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
    if (state.restTimer) { clearInterval(state.restTimer); state.restTimer = null; }   // 开始训练自动结束休息计时
    resetAgg();
    await startCountdown();                      // 新增：3-2-1 开始倒计时（对标 NTC/Keep）
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

/* ============ 新增功能（v2.18）：3-2-1 倒计时 / 组间休息 / 久坐提醒 / AI 计划 ============ */
// 3-2-1 开始倒计时：在画面上显示大数字，结束后清屏进入分析
function startCountdown() {
  return new Promise((resolve) => {
    const c = $('overlay');
    const cx = c.getContext('2d');
    const nums = ['3', '2', '1'];
    let i = 0;
    const step = () => {
      if (i >= nums.length) { drawEmpty(); resolve(); return; }
      cx.clearRect(0, 0, c.width, c.height);
      cx.fillStyle = 'rgba(20, 24, 31, .55)';
      cx.fillRect(0, 0, c.width, c.height);
      cx.fillStyle = '#4ade80';
      cx.font = 'bold 72px system-ui, sans-serif';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillText(nums[i], c.width / 2, c.height / 2);
      i++;
      setTimeout(step, 600);
    };
    step();
  });
}
// 组间休息计时器（默认 60 秒，结束响铃 + 提示）
function startRest(seconds = 60) {
  if (state.restTimer) clearInterval(state.restTimer);
  let left = seconds;
  const fb = $('feedback');
  const render = () => {
    fb.classList.remove('hidden');
    fb.innerHTML = fbWrap('check', `<b>${t('restRunning', { s: left })}</b>`);
    fb.className = 'feedback';
    fb._last = 'rest';
  };
  render();
  state.restTimer = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(state.restTimer);
      state.restTimer = null;
      alarmBurst();
      toast(t('restDone'));
      speak(t('restDone'));
      fb._last = null;
    } else {
      render();
    }
  }, 1000);
}
// v2.20.2：训练中先停止分析再进入休息，避免休息倒计时被分析循环覆盖
$('btn-rest').addEventListener('click', () => { if (state.running) toggleStart(); startRest(60); });

// 久坐提醒：按设置间隔（30/45/60 分钟）提醒起身活动
const sedGet = () => LS.get('rehab_sedentary', { on: false, min: 45 });
let sedLastActive = Date.now();
document.addEventListener('click', () => { sedLastActive = Date.now(); }, true);   // 任何操作都算活动
function renderSedentary() {
  const s = sedGet();
  $('sed-interval').value = String(s.min || 45);
  $('btn-sed-toggle').textContent = s.on ? t('sedDisable') : t('sedEnable');
  $('btn-sed-toggle').classList.toggle('primary', !s.on);
  $('sed-status').textContent = s.on ? t('sedStatusOn', { n: s.min }) : '';
}
$('btn-sed-toggle').addEventListener('click', () => {
  const s = sedGet();
  s.on = !s.on;
  LS.set('rehab_sedentary', s);
  sedLastActive = Date.now();
  renderSedentary();
  if (s.on) toast(t('sedStatusOn', { n: s.min }));
});
$('sed-interval').addEventListener('change', () => {
  const s = sedGet();
  s.min = +$('sed-interval').value || 45;
  LS.set('rehab_sedentary', s);
  renderSedentary();
});
setInterval(() => {
  const s = sedGet();
  if (!s.on || document.hidden) return;
  if (Date.now() - sedLastActive >= s.min * 60000) {
    sedLastActive = Date.now();
    toast(t('sedToast'));
    if (navigator.vibrate) { try { navigator.vibrate(200); } catch { /* 忽略 */ } }
  }
}, 30000);

// AI 一键生成康复计划（按个人资料里的康复目标）
$('btn-ai-plan').addEventListener('click', () => {
  const goal = profileGet().goal || 'other';
  const items = generatePlan(goal);
  const list = planGet();
  let added = 0;
  for (const it of items) {
    if (!list.find((p) => p.ex === it.ex)) { list.push(it); added++; }
  }
  sset('rehab_plan', list);
  renderPlanList(); renderTodayPlan(); renderGoal();
  scheduleCloudSync();
  toast(t('aiPlanDone', { n: added }));
  if (added) speak(t('aiPlanDone', { n: added }));
});

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
  // v2.21.6：本周单日最佳
  const bestDay = Math.max(0, ...days.map((d) => d.reps));
  const bestEl = $('week-best');
  if (bestEl) bestEl.textContent = bestDay > 0 ? t('weekBest', { d: bestDay }) : '';
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
      if (!confirm(t('confirmDelSession'))) return;   // v2.21.6：删除前确认，防误删训练记录
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
  const prev = list[0];
  list.unshift(report);
  sset('rehab_assessments', list);
  const gradeKey = score <= 1 ? 'assessGrade0' : score <= 3 ? 'assessGrade1' : 'assessGrade2';   // v2.21.7：结果分级
  let deltaHtml = '';
  if (prev) {
    const d = score - prev.score;
    if (d !== 0) deltaHtml = '<span class="hint tiny">' + t('paHistoryDelta', { v: d < 0 ? t('assessBetter', { d: -d }) : t('assessWorse', { d }) }) + '</span><br>';
  }
  const el = $('assess-result');
  el.innerHTML = `<b>${t('assessScore', { s: score })} · ${t(gradeKey)}</b><br>${deltaHtml}${adviceKeys.map((k) => t(k)).join('<br>')}`;
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
    if (!confirm(t('confirmDelAssess'))) return;   // v2.21.7：删除前确认
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
    const daysUntil = Math.round((new Date(a.date + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 86400000);
    const tag = past ? `<b style="color:var(--red)">${t('tagPast')}</b>`
      : a.date === todayStr ? `<b style="color:var(--green)">${t('tagToday')}</b>`
      : a.date === tomorrowStr ? `<b style="color:var(--yellow)">${t('tagTomorrow')}</b>`
      : `<b style="color:var(--teal)">${t('apptIn', { n: daysUntil })}</b>`;   // v2.21.8：未来预约倒计时
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
    if (!confirm(t('confirmDelAppt'))) return;   // v2.21.8：删除确认
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
  renderStorageSize();   // v2.21.9：采集数据清空后同步刷新「本机数据占用」
  toast(t('toastClearedCollect'));
});

/* ============ 设置页：导出 / 导入 / 清空 ============ */
// v2.21.9：本机数据键清单（备份 / 导入 / 清空共用同一份，新增数据模块时只改这里，防遗漏）
const DATA_KEYS = [
  'rehab_sessions', 'rehab_assessments', 'rehab_appts', 'rehab_custom_ex', 'rehab_collect',
  'rehab_plan', 'rehab_plan_done', 'rehab_profile',
  'rehab_ft_history', 'rehab_pa_history', 'rehab_home_idx',
  'rehab_pain_history',
  'rehab_rom_history',
  'rehab_proms_history',
  'rehab_ai_prefs',
  'rehab_path',
  'rehab_cam_prefs',
];
const bakCount = (a) => (Array.isArray(a) ? a.length : 0);
// v2.21.9：备份内容补全（原缺 计划/计划打卡/个人资料/功能测试/体态报告/运动指数历史）
const bakData = () => ({
  app: '康复AI', version: 3, exportedAt: new Date().toISOString(),
  sessions: sget('rehab_sessions', []),
  assessments: sget('rehab_assessments', []),
  appts: sget('rehab_appts', []),
  customExercises: loadCustomExercises(),
  collect: state.collectBuf,
  plan: sget('rehab_plan', []),
  planDone: sget('rehab_plan_done', {}),
  profile: sget('rehab_profile', {}),
  ftHistory: sget('rehab_ft_history', []),
  paHistory: sget('rehab_pa_history', []),
  homeIdx: sget('rehab_home_idx', []),
  painHistory: sget('rehab_pain_history', []),
  romHistory: sget('rehab_rom_history', []),
  promsHistory: sget('rehab_proms_history', []),
  aiPrefs: sget('rehab_ai_prefs', {}),
  path: sget('rehab_path', null),
  camPrefs: sget('rehab_cam_prefs', {}),
});
$('btn-export').addEventListener('click', () => {
  const data = bakData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${t('fileBackup')}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  sset('rehab_last_backup', Date.now());   // v2.21.9：记录上次导出时间，备份卡显示「上次导出备份」
  renderLastBackup();
  toast(t('toastExportBackup'));
});
$('btn-import').addEventListener('click', () => $('import-input').click());
$('import-input').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.sessions)) throw new Error(t('importFormatErr'));
    // v2.32.0：导入 = 「端手接力」——从手机导出的文件在电脑导入时是**合并**（去重、保留双方数据），不再覆盖本机
    if (!confirm(t('importConfirm', { s: bakCount(data.sessions), a: bakCount(data.assessments), p: bakCount(data.appts), f: bakCount(data.ftHistory), r: bakCount(data.paHistory) }))) {
      ev.target.value = '';
      return;
    }
    const before = { s: sget('rehab_sessions', []).length, p: painHistory().length, r: romHistory().length };
    const m = mergeSyncData(data);   // 与二维码同步共用同一个合并引擎（按 id 去重、双方保留）
    const added = {
      s: Math.max(0, sget('rehab_sessions', []).length - before.s),
      p: Math.max(0, painHistory().length - before.p),
      r: Math.max(0, romHistory().length - before.r),
    };
    refreshAllData();   // 导入后所有依赖模块一起刷新
    toast(t('importMerged', { s: added.s, p: added.p, r: added.r, t: m.s + m.a + m.p + m.c }));
    scheduleCloudSync();
  } catch (e) { toast(t('toastImportFail', { msg: e.message })); }
  ev.target.value = '';
});
$('btn-clear').addEventListener('click', () => {
  if (!confirm(t('confirmClearAll'))) return;
  DATA_KEYS.forEach((k) => sdel(k));   // v2.21.9：清单化，补齐 功能测试/体态报告/运动指数 历史（原实现残留）
  state.collectBuf = [];
  invalidateCustom();
  refreshAllData();
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
  // v2.21.10 全局：切页时同步无障碍状态（aria-current），并把长页面滚动位置复位到顶部
  document.querySelectorAll('.bottom-nav button').forEach((b) => {
    if (b === navBtn) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  try { window.scrollTo(0, 0); } catch { /* ignore */ }
  renderBlockSub();                          // v2.33.0：按所属区块显示子标签栏
  if (name === 'recheck') renderRecheck();   // v2.33.0：进入复评页刷新对比与分析
  if (name === 'train') { kickLoop(); renderTrainToday(); renderTrainDemo(); }   // 回到训练页立即恢复分析 + 刷新今日任务小条 + 标准示范卡
  if (name === 'guide') renderGuide();   // v2.34.0：进入跟练页刷新示范墙
  if (name !== 'posture') paStop();          // v2.19：离开体态页自动停止体态评估（防摄像头占用）
  if (name !== 'ft') ftStop();               // v2.20：离开功能测试页自动停止（防摄像头占用）
  if (name === 'home') { renderHome(); renderCareLoop(); }   // v2.21/v2.31：进入今日页刷新总览与闭环
  if (name !== 'guide') gwStop();            // v2.21：离开跟练页自动结束跟练计时
  if (name === 'settings') renderStorageSize();   // v2.21.9：进入设置页刷新数据占用
  if (name === 'record') renderReport();          // v2.24.0：进入记录页刷新治疗师报告摘要
  if (name === 'schedule') renderPath();          // v2.29.0：进入日程页刷新康复路径
  if (name !== 'posture') romStop();              // v2.26.0：离开体态页自动停止 ROM 测量
  // v2.33.1：进入评估块（体态/功能测试/量表）即刷新其面板 —— 否则导入/二维码同步进来的新数据要重启才看得见
  if (name === 'posture' || name === 'ft' || name === 'assess') {
    renderPaUI(); renderFtUI(); renderRomHistory(); renderRomResult(romHistory()[0] || null);
    renderPromHistory(); renderPain(); renderReport(); renderCareLoop();
  }
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
    app: 'RehabAI', v: 9, ts: Date.now(),
    sessions: sget('rehab_sessions', []),
    assessments: sget('rehab_assessments', []),
    appts: sget('rehab_appts', []),
    customExercises: loadCustomExercises(),
    plan: sget('rehab_plan', []),
    planDone: sget('rehab_plan_done', {}),
    profile: sget('rehab_profile', {}),
    // v2.21.9：补传 功能测试记录 / 体态报告 / 运动指数历史（原来换设备后这三页是空的）
    ftHistory: sget('rehab_ft_history', []),
    paHistory: sget('rehab_pa_history', []),
    homeIdx: sget('rehab_home_idx', []),
    painHistory: sget('rehab_pain_history', []),   // v2.22.0：疼痛记录一并端手互通
    romHistory: sget('rehab_rom_history', []),     // v2.26.0：ROM 测量一并端手互通
    promsHistory: sget('rehab_proms_history', []), // v2.27.0：PROMs 量表一并端手互通
    aiPrefs: sget('rehab_ai_prefs', {}),           // v2.28.0：智能引擎设置一并端手互通
    path: sget('rehab_path', null),                // v2.29.0：康复路径状态一并端手互通
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
  // v2.21.9：三类历史（记录本身无 id，按 项目/类型 + 时间戳 去重；日期型按 d 去重）
  if (Array.isArray(data.ftHistory) && data.ftHistory.length) {
    const m = new Map(ftHistory().map((r) => [r.key + '|' + r.ts, r]));
    data.ftHistory.forEach((r) => { if (r && r.ts) m.set(r.key + '|' + r.ts, r); });
    sset('rehab_ft_history', [...m.values()].sort((a, b) => b.ts - a.ts).slice(0, 60));
  }
  if (Array.isArray(data.paHistory) && data.paHistory.length) {
    const m = new Map(paHistory().map((r) => [r.kind + '|' + r.ts, r]));
    data.paHistory.forEach((r) => { if (r && r.ts) m.set(r.kind + '|' + r.ts, r); });
    sset('rehab_pa_history', [...m.values()].sort((a, b) => b.ts - a.ts).slice(0, 30));
  }
  if (Array.isArray(data.homeIdx) && data.homeIdx.length) {
    const m = new Map(homeIndexHist().map((r) => [r.d, r]));
    data.homeIdx.forEach((r) => { if (r && r.d && !m.has(r.d)) m.set(r.d, r); });
    sset('rehab_home_idx', [...m.values()].sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 30));
  }
  if (Array.isArray(data.painHistory) && data.painHistory.length) {
    painSave(mergeById(painHistory(), data.painHistory));   // 疼痛记录有 id，按 id 合并
  }
  if (Array.isArray(data.romHistory) && data.romHistory.length) {
    romSave(mergeById(romHistory(), data.romHistory));      // v2.26.0：ROM 记录按 id 合并
  }
  if (Array.isArray(data.promsHistory) && data.promsHistory.length) {
    promSave(mergeById(promHistory(), data.promsHistory));  // v2.27.0：PROMs 记录按 id 合并
  }
  if (data.aiPrefs && typeof data.aiPrefs === 'object') {
    sset('rehab_ai_prefs', Object.assign({}, aiPrefs(), data.aiPrefs));   // v2.28.0：智能引擎设置合并
  }
  if (data.path && typeof data.path === 'object') {
    sset('rehab_path', Object.assign({}, pathCfg(), data.path));          // v2.29.0：康复路径合并
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
  if (!data.sessions.length && !data.assessments.length && !data.appts.length && !data.customExercises.length
    && !data.plan.length && !data.ftHistory.length && !data.paHistory.length && !data.homeIdx.length) {
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
    refreshAllData();   // v2.21.9：同步后全模块刷新（原只刷记录/评估/预约/自定义，今日与计划不刷新）
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
  const total = entries.reduce((a, [, n]) => a + n, 0);   // v2.21.6：占比
  $('dist-chart').innerHTML = entries.map(([id, n]) => {
    const e = EXERCISES[id];
    return `<div class="dist-row">
      <span class="dist-name"><span class="t-ico">${icon(e ? e.icon : 'custom')}</span>${e ? exName(e) : id}</span>
      <div class="dist-bar"><div class="dist-fill" style="width:${(100 * n / max).toFixed(1)}%"></div></div>
      <span class="dist-num">${n}<span class="hint tiny" style="display:block">${Math.round(100 * n / total)}%</span></span>
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
  const unlocked = ACHIEVEMENTS.filter((a) => a.test(stats)).length;   // v2.21.6：解锁进度
  const acEl = $('ach-count');
  if (acEl) acEl.textContent = t('achCount', { n: unlocked, t: ACHIEVEMENTS.length });
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
  const wk = new Date(); wk.setHours(0, 0, 0, 0); wk.setDate(wk.getDate() - 6);
  const weekS = sget('rehab_sessions', []).filter((s) => new Date(s.ts) >= wk);
  el.innerHTML = list.map((p) => {
    const e = getEx(p.ex);
    const g = p.reps * (p.days || []).length;                       // v2.21.8：周目标
    const done = weekS.filter((s) => s.ex === p.ex).reduce((a, s) => a + s.reps, 0);
    const pct = Math.min(100, Math.round(100 * done / Math.max(1, g)));
    return `<div class="item">
      <div style="flex:1">
        <div class="t"><span class="t-ico">${icon(e ? e.icon : 'custom')}</span>${e ? exName(e) : p.ex} · ${t('repsN', { n: p.reps })}</div>
        <div class="d">${(p.days || []).map((d) => new Date(2024, 0, 7 + d).toLocaleDateString(locale(), { weekday: 'short' })).join(' · ')}</div>
        <div class="plan-bar" style="margin-top:6px"><div class="plan-fill" style="width:${pct}%"></div></div>
        <div class="hint tiny" style="margin-top:3px">${t('planWeekProg', { d: Math.min(done, g), g })}</div>
      </div>
      <button class="mini del" data-plan-del="${p.ex}">${icon('trash')}</button>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-plan-del]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm(t('confirmDelPlan'))) return;   // v2.21.8：删除确认
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
    painMax: painRecentMax(7),          // v2.22.0：近 7 天最高疼痛（供 AI 管家提示）
    painCount: painHistory().filter((r) => r.ts >= Date.now() - 7 * 86400000).length,
    painSpike: painSpike() ? painSpike().delta : 0,   // v2.23.0：当天训练后疼痛上升 ≥2 分
    promBad: promBadCount(),                          // v2.27.0：重度受限的量表份数
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
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.setAttribute('role', 'status');          // v2.21.10：提示条可被读屏播报
    t.setAttribute('aria-live', 'polite');
    document.body.appendChild(t);
  }
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
    // 11b3. 桌前坐姿（躯干前倾 25–40°）也识别为坐姿（修复「坐着被认成站着」）
    const sitLeanP = mkPose((b) => {
      [23, 24].forEach((i) => { b[i].x = 0.40; b[i].y = 0.52; });
      [25, 26].forEach((i) => { b[i].x = 0.56; b[i].y = 0.64; });
      [27, 28].forEach((i) => { b[i].x = 0.50; b[i].y = 0.86; });
      [11, 12].forEach((i) => { b[i].x = 0.52; b[i].y = 0.36; });
    });
    const sitLeanCls = classifyAuto(sitLeanP, still(0.52), tN);
    log(t('stSitLean'), sitLeanCls === 'sitting', `${sitLeanCls} lean=${EXERCISES.sitting.analyze(sitLeanP).metrics.lean.toFixed(0)}`);
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
    // 16c. AI 一键生成计划（按康复目标）
    const pk = generatePlan('knee');
    const pp = generatePlan('posture');
    const pf2 = generatePlan('fitness');
    const po = generatePlan('other');
    const planOk = pk.some((x) => x.ex === 'squat') && pk.some((x) => x.ex === 'sitstand')
      && pp.some((x) => x.ex === 'standing') && pp.some((x) => x.ex === 'sitting')
      && pf2.length >= 5 && po.length >= 3
      && [pk, pp, pf2, po].every((pl) => pl.every((x) => x.reps > 0 && Array.isArray(x.days) && x.days.length >= 3 && x.days.every((d) => d >= 0 && d <= 6)));
    log(t('stPlanGen'), planOk, `knee=${pk.length} posture=${pp.length} fitness=${pf2.length} other=${po.length}`);
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
    // 18. 全身体态评估引擎（v2.19）：好/坏骨架评分 + 指导性建议
    const paGood = paBuildReport('standing', paEvalStanding(Array(30).fill(base())));
    const paBadLms = (() => { const b = base(); b[0].x = 0.44; b[0].y = 0.14; [11, 12].forEach((i) => { b[i].x = 0.56; b[i].y = 0.31; }); b[11].y = 0.30; return b; })();
    const paBad = paBuildReport('standing', paEvalStanding(Array(30).fill(paBadLms)));
    const paAdviceOk = paBad.priorities.length >= 1 && paBad.priorities.every((i) => i.advice && i.advice.length > 2);
    log(t('stPaStand'), paGood.score >= 80 && paBad.score < 80 && paAdviceOk, `good=${paGood.score} bad=${paBad.score} advice=${paAdviceOk}`);
    // 18b. 单腿站立评价（含保持时间项）
    const paSingleLms = (() => { const b = base(); b[28].y = 0.78; b[26].y = 0.70; return b; })();
    const paSi = paBuildReport('single', paEvalSingle(Array(30).fill(paSingleLms)));
    log(t('stPaSingle'), paSi.items.length >= 4 && paSi.items.some((i) => i.key === 'mSingleHold'), `items=${paSi.items.length}`);
    // 18c. 深蹲评价：右膝内扣 → valgus 项 bad
    const paSqLms = (() => { const b = base(); [23, 24].forEach((i) => { b[i].y = 0.50; }); [25, 26].forEach((i) => { b[i].x = 0.50; b[i].y = 0.68; }); return b; })();
    const paSq = paBuildReport('squat', paEvalSquat(Array(30).fill(paSqLms)));
    const paValgus = paSq.items.find((i) => i.key === 'mSquatValgus');
    log(t('stPaSquat'), paValgus && paValgus.level !== 'good', `valgus=${paValgus ? paValgus.level : '?'}`);
    // 18d. 步频检测：合成 1.83Hz 正弦髋部轨迹 → ≈110 步/分
    paState.steps = []; paState.hipHist = [];
    for (let i = 0; i < 300; i++) { const tt = tN - 10000 + i * 33; paState.hipHist.push({ y: 0.5 + 0.02 * Math.sin(2 * Math.PI * 1.833 * (tt - tN) / 1000), t: tt }); }
    paDetectSteps(tN);
    const paCad = paCadence();
    log(t('stPaWalk'), paCad.cad > 100 && paCad.cad < 120, `cad=${paCad.cad.toFixed(0)} steps=${paState.steps.length}`);
    // 18e. 完整性门控：缺右踝 → 不评价；脚出画 → 不评价
    paState.hipHist = [];
    const paInc = base(); paInc[28].visibility = 0;
    const paGate1 = paCompleteness(paInc, 'standing', tN);
    const paFar = (() => { const b = base(); [27, 28].forEach((i) => { b[i].y = 0.99; }); return b; })();
    const paGate2 = paCompleteness(paFar, 'standing', tN);
    const paGateOk = paGate1.ok === false && paGate1.items.some((i) => i.key === 'body' && !i.ok)
      && paGate2.ok === false && paGate2.items.some((i) => i.key === 'frame' && !i.ok);
    log(t('stPaGate'), paGateOk, `missing=${!paGate1.ok} outframe=${!paGate2.ok}`);
    // 18f. 单腿站立抬起侧识别（v2.21.4：踝更高一侧 = 抬起侧）
    const paLiftLms = (() => { const b = base(); b[28].y = 0.78; b[26].y = 0.70; return b; })();
    const paLiftHold = paEvalSingle(Array(30).fill(paLiftLms)).find((i) => i.key === 'mSingleHold');
    log(t('stPaLift'), paLiftHold && paLiftHold.text.includes(t('paLiftR')), paLiftHold ? paLiftHold.text : '?');
    // 19. 运动功能测试引擎（v2.20）：动态深蹲合成 3 次 → 分割+全指标+评分
    const ftFrames = [];
    const ftSkel = (kneeL, kneeR, vgShift = 0) => {
      const b = base();
      const kneeOf = (hipX, ankleX, angDeg) => {
        const H = { x: hipX, y: 0.52 }, A = { x: ankleX, y: 0.87 };
        const mx = (H.x + A.x) / 2, my = (H.y + A.y) / 2, l = Math.hypot(H.x - A.x, H.y - A.y);
        const d = Math.max(0, Math.min(0.20, (l / 2) / Math.tan((angDeg * Math.PI) / 360)));
        return { x: mx + d, y: my };
      };
      const kL = kneeOf(0.44, 0.46, kneeL), kR = kneeOf(0.56, 0.54, kneeR);
      [23, 24].forEach((i) => { b[i] = mk(0.44 + (i === 24 ? 0.12 : 0), 0.52); });
      b[25] = mk(kL.x + vgShift, kL.y); b[26] = mk(kR.x - vgShift, kR.y);
      b[27] = mk(0.46, 0.87); b[28] = mk(0.54, 0.87);
      return b;
    };
    for (let i = 0; i < 120; i++) {
      const tSec = i / 30;
      const ph = (tSec % 1.2) / 1.2;
      const ang = (x0, x1, a, b) => (ph < x0) ? a : (ph < x1) ? a + (b - a) * Math.sin(((ph - x0) / (x1 - x0)) * Math.PI / 2) : b;
      const kneeL = ang(0.15, 0.6, 172, 96), kneeR = ang(0.15, 0.6, 172, 110);
      const lms = ftSkel(kneeL, kneeR, kneeL < 120 ? 0.02 : 0);
      const m = ftFrameMetrics(lms);
      ftFrames.push({ t: tN - 4000 + i * 33, ...m });
    }
    const ftM = ftAnalyze('squat', ftFrames);
    const ftS = ftScoreMovement('squat', ftM);
    const ftSim = ftSimilarity('squat', ftFrames);
    const ftIss = ftIssues('squat', ftM);
    const ftAsymOk = ftM.asym > 10 && ftM.asym < 45;
    log(t('stFtSquat'), ftM.reps === 3 && ftM.depth > 80 && ftM.depth < 130 && typeof ftS.total === 'number', `reps=${ftM.reps} depth=${ftM.depth.toFixed(0)} score=${ftS.total}`);
    log(t('stFtSym'), ftAsymOk && ftIss.some((i) => i.kb === 'asym' && i.level !== 'good'), `asym=${ftM.asym.toFixed(0)}%`);
    log(t('stFtSim'), ftSim.sim > 0 && ftSim.sim <= 100, `sim=${ftSim.sim}%`);
    const ftValgusIss = ftIss.find((i) => i.kb === 'valgus');
    const ftKb = FT_KB[ftValgusIss && ftValgusIss.level !== 'good' ? 'valgus' : 'asym'];
    log(t('stFtKb'), ftKb && ftKb.ex.length >= 2 && ftKb.caution && ftKb.factor, `ex=${ftKb.ex.length} ${ftKb.problem}`);
    const ftPrev = { depth: 135, asym: 14, valgus: 0.28 };
    const ftNow = { depth: 118, asym: 9, valgus: 0.18 };
    const ftD1 = ftDelta(ftPrev, ftNow, 'depth'), ftD2 = ftDelta(ftPrev, ftNow, 'valgus');
    log(t('stFtVsLast'), ftD1 && ftD1.better === true && ftD2 && ftD2.better === true, `depth↓${ftD1.pct}% valgus↓${ftD2.pct}%`);
    // 19b. 零次数保护：超时/空数据 → 分析、评分、报告项全部安全
    const ftZero = ftAnalyze('squat', []);
    const ftZeroS = ftScoreMovement('squat', ftZero);
    const ftZeroIss = ftIssues('squat', ftZero);
    const ftZeroOk = ftZero.reps === 0 && typeof ftZeroS.total === 'number' && ftZeroIss.length > 0
      && ftZeroIss.every((i) => typeof i.val === 'string' && typeof i.text === 'string');
    log(t('stFtZeroRep'), ftZeroOk, `reps=0 score=${ftZeroS.total} items=${ftZeroIss.length}`);
    // 20. 今日总览与跟练（v2.21）：指数加权 + 课程完整性 + 记录生成
    const hIdx1 = gwCalcIndex(90, null, 50), hIdx2 = gwCalcIndex(80, 70, 100), hIdx3 = gwCalcIndex(null, null, 50);
    const gwProgOk = Object.values(GW_PROGRAMS).every((p) => p.steps.length >= 2 && p.steps.every((s) => s.sets > 0 && ((s.reps > 0) || (s.hold > 0)) && s.cue && s.name && s.icon));
    const gwRec = gwMakeSession(GW_PROGRAMS.knee, 30, 600);
    log(t('stHomeIndex'), hIdx1 === 67 && hIdx2 === 85 && hIdx3 === 50, `${hIdx1}/${hIdx2}/${hIdx3}（期望 67/85/50）`);
    log(t('stGwProg'), gwProgOk && gwRec.id && gwRec.ex === 'guided' && gwRec.reps === 30 && gwRec.dur === 600, `steps ok rec=${gwRec.ex}/${gwRec.reps}×${gwRec.dur}s`);
    // 20b. 跟练难度自适应：进阶（2 级）每节 +2 次，保持类不变
    const gwLvOk = gwStepReps({ reps: 10 }, 1) === 10 && gwStepReps({ reps: 10 }, 2) === 12 && gwStepReps({ hold: 30 }, 2) === 30;
    log(t('stGwLevel'), gwLvOk, `10/12/30 got ${gwStepReps({ reps: 10 }, 1)}/${gwStepReps({ reps: 10 }, 2)}/${gwStepReps({ hold: 30 }, 2)}`);
    // 20c. 功能测试阶段判定：站直/过渡/底部，峰值型（上举）同样成立
    const ftPh1 = ftPhaseOf('squat', 170) === 0 && ftPhaseOf('squat', 130) === 1 && ftPhaseOf('squat', 100) === 2;
    const ftPh2 = ftPhaseOf('arm', 0.02) === 0 && ftPhaseOf('arm', 0.05) === 1 && ftPhaseOf('arm', 0.2) === 2;
    log(t('stFtPhase'), ftPh1 && ftPh2, `squat 170/130/100=${ftPhaseOf('squat', 170)}/${ftPhaseOf('squat', 130)}/${ftPhaseOf('squat', 100)} arm 0.02/0.05/0.2=${ftPhaseOf('arm', 0.02)}/${ftPhaseOf('arm', 0.05)}/${ftPhaseOf('arm', 0.2)}`);
    out.innerHTML += `<div class="st-pass" style="margin-top:8px;font-weight:800">${t('stAllPass')}</div>`;
    console.log('SELFTEST: ALL PASS');
  } catch (e) {
    out.innerHTML += `<div class="st-fail">${t('stError', { msg: e.message })}</div>`;
    console.log('SELFTEST: ERROR', e);
  }
}

/* ============ 新增功能（v2.19）：全身体态评估 ============ */
// 流程：选体态 → 采集（摄像头或演示模式）→ 识别完整性门控（人体/全身可见/画幅/姿势到位/稳定或节律）
//      → 门控全部通过且保持达标时长 → 才开始评价 → 逐项指出不足 + 改进建议 + 综合评分 → 存历史
// 纯新增：不修改任何旧功能逻辑；复用旧函数只调用不修改（loadModel/openCamera/drawStick/icon/toast）
const PA_META = {
  standing: { nameKey: 'paKindStand', guideKey: 'paGuideStand', hold: 6 },
  single: { nameKey: 'paKindSingle', guideKey: 'paGuideSingle', hold: 8 },
  squat: { nameKey: 'paKindSquat', guideKey: 'paGuideSquat', hold: 6 },
  walk: { nameKey: 'paKindWalk', guideKey: 'paGuideWalk', need: 6 },
  run: { nameKey: 'paKindRun', guideKey: 'paGuideRun', need: 8 },
};
const PA_REQUIRED = {
  standing: [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28],
  single: [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28],
  squat: [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28],
  walk: [0, 11, 12, 15, 16, 23, 24, 25, 26],
  run: [0, 11, 12, 15, 16, 23, 24, 25, 26],
};
const paState = {
  active: false, demo: false, kind: 'standing',
  samples: [], hipHist: [], steps: [], stableMs: 0, _lastOkT: 0, lastT: 0, raf: 0,
  videoOn: false, stream: null, report: null, lastGate: null,
};
const paMid = (lms, a, b) => ({ x: (lms[a].x + lms[b].x) / 2, y: (lms[a].y + lms[b].y) / 2 });
const paVis = (lms, i) => (lms[i] && (lms[i].visibility ?? 1) >= 0.5);
const paTorso = (lms) => { const s = paMid(lms, 11, 12), h = paMid(lms, 23, 24); return Math.max(0.12, Math.hypot(s.x - h.x, s.y - h.y)); };
const paMed = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const paMean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const paStd = (arr) => { if (arr.length < 2) return 0; const m = paMean(arr); return Math.sqrt(paMean(arr.map((x) => (x - m) * (x - m)))); };

// 识别完整性门控：人体 → 关键点可见 → 画幅 → 姿势到位 → 稳定/节律
function paCompleteness(lms, kind, ts) {
  const items = [{ key: 'person', ok: !!lms, label: t('paCheckPerson') }];
  if (!lms) return { ok: false, items };
  const req = PA_REQUIRED[kind] || PA_REQUIRED.standing;
  const missing = req.filter((i) => !paVis(lms, i));
  if ((kind === 'walk' || kind === 'run') && !paVis(lms, 27) && !paVis(lms, 28)) missing.push(27, 28);
  items.push({
    key: 'body', ok: !missing.length, label: t('paCheckBody'),
    note: missing.length ? t('paMissing', { parts: missing.map((i) => t('paPart' + i)).join('、') }) : '',
  });
  const xs = [], ys = [];
  for (let i = 0; i < 33; i++) if (paVis(lms, i)) { xs.push(lms[i].x); ys.push(lms[i].y); }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  let frameOk = true, frameHint = '';
  if (maxY > 0.97 || minY < 0.02) { frameOk = false; frameHint = t('paFrameHintFar'); }
  else if (maxY < 0.82 && (maxY - minY) < 0.5) { frameOk = false; frameHint = t('paFrameHintNear'); }
  else if (minX < 0.02 || maxX > 0.98) { frameOk = false; frameHint = t('paFrameHintCenter'); }
  items.push({ key: 'frame', ok: frameOk, label: t('paCheckFrame'), note: frameOk ? '' : frameHint });
  if (kind === 'squat') {
    const ka = Math.min(angle3(lms[23], lms[25], lms[27]), angle3(lms[24], lms[26], lms[28]));
    items.push({ key: 'pose', ok: ka < 165, label: t('paCheckPose'), note: ka < 165 ? '' : t('paPoseSquatHint') });
  } else if (kind === 'single') {
    const lifted = Math.max(lms[27].y, lms[28].y) - Math.min(lms[27].y, lms[28].y) > 0.04;
    items.push({ key: 'pose', ok: lifted, label: t('paCheckPose'), note: lifted ? '' : t('paPoseSingleHint') });
  }
  if (PA_META[kind].hold) {
    const win = paState.hipHist.filter((h) => h.t > ts - 1500);
    let stable = true;
    if (win.length >= 8) {
      const ys2 = win.map((h) => h.y).sort((a, b) => a - b);
      stable = (ys2[Math.floor(ys2.length * 0.9)] - ys2[Math.floor(ys2.length * 0.1)]) < 0.025;
    }
    items.push({ key: 'stable', ok: stable, label: t('paCheckStable'), note: stable ? '' : t('paStableHint') });
  } else {
    items.push({ key: 'rhythm', ok: paState.steps.length >= PA_META[kind].need, label: t('paCheckRhythm'), note: '' });
  }
  return { ok: items.every((i) => i.ok), items };
}
function paResetStable() { paState.stableMs = 0; paState._lastOkT = 0; }

// 步态节律：髋部高度振荡 → 步峰检测 → 步频 + 左右对称
function paDetectSteps(ts) {
  const hist = paState.hipHist.filter((h) => h.t > ts - 10000);
  if (hist.length < 20) return;
  const ys = hist.map((h) => h.y);
  const amp = Math.max(...ys) - Math.min(...ys);
  if (amp < 0.01) { paState.steps = []; return; }
  const mid = paMed(ys);
  const threshold = mid + amp * 0.22;   // 峰须明显高于中位（抗噪声）
  const raw = [];
  for (let i = 2; i < hist.length - 2; i++) {
    if (hist[i].y <= threshold) continue;
    if (hist[i].y < hist[i - 1].y || hist[i].y < hist[i + 1].y) continue;
    raw.push(hist[i].t);
  }
  const merged = [];
  for (const p of raw) {
    if (!merged.length || p - merged[merged.length - 1] > 180) merged.push(p);
    else if (p > merged[merged.length - 1]) merged[merged.length - 1] = p;
  }
  paState.steps = merged;
}
function paCadence() {
  const steps = paState.steps;
  if (steps.length < 2) return { cad: 0, sym: 0 };
  const iv = [];
  for (let i = 1; i < steps.length; i++) iv.push(steps[i] - steps[i - 1]);
  const mean = paMean(iv);
  const cad = 60000 / mean;
  const evens = iv.filter((_, i) => i % 2 === 0), odds = iv.filter((_, i) => i % 2 === 1);
  const me = paMean(evens), mo = paMean(odds);
  const sym = (me && mo) ? Math.abs(me - mo) / ((me + mo) / 2) * 100 : 0;
  return { cad, sym };
}

// 单项评分：good(100) / warn(65) / bad(30)，非良好项必带改进建议
function paItem(key, v, level, fmt, advice, textKey) {
  const texts = { good: key + 'G', warn: key + 'W', bad: key + 'B' };
  return {
    key, level, val: fmt ? fmt(v) : String(v), score: level === 'good' ? 100 : level === 'warn' ? 65 : 30,
    label: t(key), text: t(texts[level], { v: fmt ? fmt(v) : String(v) }),
    advice: level === 'good' ? '' : advice,
  };
}
const paLevelOf = (v, a, b) => (v < a ? 'good' : v < b ? 'warn' : 'bad');

// 五套体态评价（正面/侧面单摄像头 2D 视角下的可靠指标）
function paEvalStanding(smps) {
  const med = (f) => paMed(smps.map(f));
  const items = [];
  items.push(paItem('mStandHead', med((l) => verticalAngle(l[0], paMid(l, 11, 12))), paLevelOf(med((l) => verticalAngle(l[0], paMid(l, 11, 12))), 12, 20), (v) => v.toFixed(0) + '°', t('mStandHeadA')));
  items.push(paItem('mStandShoulder', med((l) => Math.abs(l[11].y - l[12].y) / paTorso(l)), paLevelOf(med((l) => Math.abs(l[11].y - l[12].y) / paTorso(l)), 0.03, 0.06), (v) => (v * 100).toFixed(0) + '%', t('mStandShoulderA')));
  items.push(paItem('mStandTrunk', med((l) => verticalAngle(paMid(l, 11, 12), paMid(l, 23, 24))), paLevelOf(med((l) => verticalAngle(paMid(l, 11, 12), paMid(l, 23, 24))), 8, 15), (v) => v.toFixed(0) + '°', t('mStandTrunkA')));
  items.push(paItem('mStandPelvis', med((l) => Math.abs(l[23].y - l[24].y) / paTorso(l)), paLevelOf(med((l) => Math.abs(l[23].y - l[24].y) / paTorso(l)), 0.03, 0.06), (v) => (v * 100).toFixed(0) + '%', t('mStandPelvisA')));
  items.push(paItem('mStandKnee', med((l) => Math.max(Math.abs(180 - angle3(l[23], l[25], l[27])), Math.abs(180 - angle3(l[24], l[26], l[28])))), paLevelOf(med((l) => Math.max(Math.abs(180 - angle3(l[23], l[25], l[27])), Math.abs(180 - angle3(l[24], l[26], l[28])))), 8, 15), (v) => v.toFixed(0) + '°', t('mStandKneeA')));
  items.push(paItem('mStandWeight', med((l) => Math.abs(paMid(l, 23, 24).x - paMid(l, 27, 28).x) / Math.max(0.05, Math.abs(l[24].x - l[23].x))), paLevelOf(med((l) => Math.abs(paMid(l, 23, 24).x - paMid(l, 27, 28).x) / Math.max(0.05, Math.abs(l[24].x - l[23].x))), 0.3, 0.6), (v) => (v * 100).toFixed(0) + '%', t('mStandWeightA')));
  return items;
}
function paEvalSingle(smps) {
  const items = [];
  const supKnee = smps.map((l) => {
    const isL = l[27].y >= l[28].y;   // 支撑腿 = 踝更低的一侧
    return angle3(l[isL ? 23 : 24], l[isL ? 25 : 26], l[isL ? 27 : 28]);
  });
  const sway = smps.map((l) => paMid(l, 23, 24).x / Math.max(0.05, paTorso(l)));
  const lean = paMed(smps.map((l) => verticalAngle(paMid(l, 11, 12), paMid(l, 23, 24))));
  const pel = paMed(smps.map((l) => Math.abs(l[23].y - l[24].y) / paTorso(l)));
  const kStd = paStd(supKnee);
  items.push(paItem('mSingleKnee', kStd, paLevelOf(kStd, 4, 8), (v) => v.toFixed(0) + '°', t('mSingleKneeA')));
  items.push(paItem('mSinglePelvis', pel, paLevelOf(pel, 0.10, 0.16), (v) => (v * 100).toFixed(0) + '%', t('mSinglePelvisA')));
  items.push(paItem('mSingleTrunk', lean, paLevelOf(lean, 10, 16), (v) => v.toFixed(0) + '°', t('mSingleTrunkA')));
  items.push(paItem('mSingleSway', paStd(sway), paLevelOf(paStd(sway), 0.03, 0.06), (v) => (v * 100).toFixed(0) + '%', t('mSingleSwayA')));
  // v2.21.4：识别抬起的是哪条腿（踝更高的一侧 = 抬起侧）
  const liftRight = smps.reduce((a, l) => a + (l[28].y < l[27].y ? 1 : -1), 0) > 0;
  items.push({ key: 'mSingleHold', level: 'good', val: t('mSingleHoldI', { s: PA_META.single.hold }) + ' · ' + t(liftRight ? 'paLiftR' : 'paLiftL'), score: 100, label: t('mSingleHold'), text: t('mSingleHoldI', { s: PA_META.single.hold }) + ' · ' + t(liftRight ? 'paLiftR' : 'paLiftL'), advice: t('mSingleHoldA') });
  return items;
}
function paEvalSquat(smps) {
  const items = [];
  const kL = smps.map((l) => angle3(l[23], l[25], l[27])), kR = smps.map((l) => angle3(l[24], l[26], l[28]));
  const depth = paMed(smps.map((l) => Math.min(angle3(l[23], l[25], l[27]), angle3(l[24], l[26], l[28]))));
  const depthLv = depth <= 120 ? 'good' : depth <= 140 ? 'warn' : 'bad';
  items.push(paItem('mSquatDepth', depth, depthLv, (v) => v.toFixed(0) + '°', t('mSquatDepthA')));
  const sym = paMed(smps.map((_, i) => Math.abs(kL[i] - kR[i])));
  items.push(paItem('mSquatSym', sym, paLevelOf(sym, 10, 20), (v) => v.toFixed(0) + '°', t('mSquatSymA')));
  const valgus = paMed(smps.map((l) => { const vg = kneeValgus(l); return Math.max(vg.left, vg.right); }));
  items.push(paItem('mSquatValgus', valgus, paLevelOf(valgus, 0.15, 0.30), (v) => (v * 100).toFixed(0) + '%', t('mSquatValgusA')));
  const lean = paMed(smps.map((l) => verticalAngle(paMid(l, 11, 12), paMid(l, 23, 24))));
  const leanLv = lean >= 10 && lean <= 35 ? 'good' : lean <= 50 ? 'warn' : 'bad';
  items.push(paItem('mSquatTrunk', lean, leanLv, (v) => v.toFixed(0) + '°', t('mSquatTrunkA')));
  const wob = paStd(kL);
  items.push(paItem('mSquatHold', wob, paLevelOf(wob, 5, 9), (v) => v.toFixed(0) + '°', t('mSquatHoldA')));
  return items;
}
function paEvalWalk(smps) {
  const items = [];
  const { cad, sym } = paCadence();
  const cadLv = cad >= 100 && cad <= 130 ? 'good' : cad >= 90 && cad <= 140 ? 'warn' : 'bad';
  const lowTxt = cad < 100 ? t('mWalkLow') : t('mWalkHigh');
  items.push({
    key: 'mWalkCadence', level: cadLv, val: cad.toFixed(0), score: cadLv === 'good' ? 100 : cadLv === 'warn' ? 65 : 30,
    label: t('mWalkCadence'),
    text: cadLv === 'good' ? t('mWalkCadenceG', { v: cad.toFixed(0) }) : cadLv === 'warn' ? t('mWalkCadenceW', { v: cad.toFixed(0), low: lowTxt }) : t('mWalkCadenceB', { v: cad.toFixed(0), low: lowTxt }),
    advice: cadLv === 'good' ? '' : t('mWalkCadenceA'),
  });
  items.push(paItem('mWalkSym', sym, paLevelOf(sym, 10, 20), (v) => v.toFixed(0) + '%', t('mWalkSymA')));
  const lean = paMed(smps.map((l) => verticalAngle(paMid(l, 11, 12), paMid(l, 23, 24))));
  items.push(paItem('mWalkTrunk', lean, paLevelOf(lean, 8, 15), (v) => v.toFixed(0) + '°', t('mWalkTrunkA')));
  const xs = smps.map((l) => paMid(l, 23, 24).x / Math.max(0.05, paTorso(l))).sort((a, b) => a - b);
  const sway = xs[Math.floor(xs.length * 0.9)] - xs[Math.floor(xs.length * 0.1)];
  items.push(paItem('mWalkSway', sway, paLevelOf(sway, 0.05, 0.09), (v) => (v * 100).toFixed(0) + '%', t('mWalkSwayA')));
  const armS = smps.map((l) => ((l[15].y + l[16].y) / 2 - (l[23].y + l[24].y) / 2) / paTorso(l)).sort((a, b) => a - b);
  const arm = armS[Math.floor(armS.length * 0.9)] - armS[Math.floor(armS.length * 0.1)];
  const armLv = arm >= 0.06 && arm <= 0.35 ? 'good' : (arm >= 0.02 && arm <= 0.55 ? 'warn' : 'bad');
  const armLow = arm < 0.06 ? t('paSmall') : t('paLarge');
  items.push({
    key: 'mWalkArm', level: armLv, val: (arm * 100).toFixed(0) + '%', score: armLv === 'good' ? 100 : armLv === 'warn' ? 65 : 30,
    label: t('mWalkArm'),
    text: armLv === 'good' ? t('mWalkArmG') : armLv === 'warn' ? t('mWalkArmW', { low: armLow, v: (arm * 100).toFixed(0) + '%' }) : t('mWalkArmB'),
    advice: armLv === 'good' ? '' : t('mWalkArmA'),
  });
  return items;
}
function paEvalRun(smps) {
  const items = [];
  const { cad, sym } = paCadence();
  const cadLv = cad >= 150 && cad <= 190 ? 'good' : cad >= 130 && cad <= 220 ? 'warn' : 'bad';
  items.push(paItem('mRunCadence', cad, cadLv, (v) => v.toFixed(0), t('mRunCadenceA')));
  const ys = smps.map((l) => l[0].y / Math.max(0.05, paTorso(l))).sort((a, b) => a - b);
  const bounce = ys[Math.floor(ys.length * 0.9)] - ys[Math.floor(ys.length * 0.1)];
  items.push(paItem('mRunBounce', bounce, paLevelOf(bounce, 0.12, 0.20), (v) => (v * 100).toFixed(0) + '%', t('mRunBounceA')));
  const lean = paMed(smps.map((l) => verticalAngle(paMid(l, 11, 12), paMid(l, 23, 24))));
  const leanLv = lean >= 5 && lean <= 15 ? 'good' : lean <= 25 ? 'warn' : 'bad';
  items.push(paItem('mRunLean', lean, leanLv, (v) => v.toFixed(0) + '°', t('mRunLeanA')));
  items.push(paItem('mRunSym', sym, paLevelOf(sym, 10, 20), (v) => v.toFixed(0) + '%', t('mRunSymA')));
  const armS = smps.map((l) => ((l[15].y + l[16].y) / 2 - (l[23].y + l[24].y) / 2) / paTorso(l)).sort((a, b) => a - b);
  const arm = armS[Math.floor(armS.length * 0.9)] - armS[Math.floor(armS.length * 0.1)];
  const armLv = arm >= 0.08 && arm <= 0.40 ? 'good' : (arm >= 0.03 && arm <= 0.60 ? 'warn' : 'bad');
  const armLow = arm < 0.08 ? t('paSmall') : t('paLarge');
  items.push({
    key: 'mRunArm', level: armLv, val: (arm * 100).toFixed(0) + '%', score: armLv === 'good' ? 100 : armLv === 'warn' ? 65 : 30,
    label: t('mRunArm'),
    text: armLv === 'good' ? t('mRunArmG') : armLv === 'warn' ? t('mRunArmW', { low: armLow, v: (arm * 100).toFixed(0) + '%' }) : t('mRunArmB'),
    advice: armLv === 'good' ? '' : t('mRunArmA'),
  });
  return items;
}
const PA_EVAL = { standing: paEvalStanding, single: paEvalSingle, squat: paEvalSquat, walk: paEvalWalk, run: paEvalRun };

function paBuildReport(kind, items) {
  const score = Math.round(items.reduce((a, i) => a + i.score, 0) / Math.max(1, items.length));
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
  const priorities = items.filter((i) => i.level !== 'good').sort((a, b) => a.score - b.score);
  // v2.25.0：报告附一张骨架快照（只含火柴人，不含真人照片），供治疗师报告对比
  return { kind, ts: Date.now(), score, grade, items, priorities, demo: paState.demo, snap: paSnapShot() };
}
function paHistory() { return sget('rehab_pa_history', []); }
function paSaveReport(r) {
  const h = paHistory(); h.unshift(r);
  if (h.length > 30) h.length = 30;
  h.forEach((x, i) => { if (i >= 8 && x.snap) delete x.snap; });   // v2.25.0：快照只留最近 8 份
  sset('rehab_pa_history', h);
}

const paItemHtml = (i) => `
  <div class="pa-item">
    <div class="pa-item-head">
      <span class="pa-lv ${i.level}">${t(i.level === 'good' ? 'paGood' : i.level === 'warn' ? 'paWarn' : 'paBad')}</span>
      <span class="pa-item-name">${i.label}</span>
      <span class="pa-item-val">${i.val}</span>
    </div>
    <div class="pa-item-text">${i.text}</div>
    ${i.advice ? `<div class="pa-item-advice"><b>${t('paAdvice')}</b>：${i.advice}</div>` : ''}
  </div>`;
function renderPaReport(r, scroll = true) {
  const el = $('pa-report');
  if (!el) return;
  el.classList.remove('hidden');
  const demoBadge = r.demo ? `<span class="pa-demo-badge">${t('paDemoNote')}</span>` : '';
  el.innerHTML = `
    ${demoBadge}
    <h3>${t('paReportTitle')} · ${t((PA_META[r.kind] || PA_META.standing).nameKey)}</h3>
    <div class="pa-score">
      <div class="pa-score-num">${r.score != null ? r.score : '—'}</div>
      <div>
        <div class="pa-score-grade">${t('paScore')}${r.grade ? ' · ' + t('paGrade' + r.grade) : ''}</div>
        <div class="pa-score-sub">${t('paSafety')}</div>
      </div>
    </div>
    <div class="pa-items">${r.items.map(paItemHtml).join('')}</div>
    <div class="pa-priority">
      <h4 style="margin-bottom:8px">${t('paPriority')}</h4>
      ${r.priorities.length ? '<ul>' + r.priorities.map((i) => `<li><b>${i.label}</b> — ${i.advice}</li>`).join('') + '</ul>' : `<p class="hint">${t('paNoIssue')}</p>`}
    </div>
    <div class="controls"><button class="btn" id="btn-pa-redo"><span>${t('paRedo')}</span></button></div>`;
  $('btn-pa-redo').addEventListener('click', () => { paStop(); el.classList.add('hidden'); paState.report = null; });
  if (scroll) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function renderPaHistory() {
  const el = $('pa-history');
  if (!el) return;
  const h = paHistory();
  if (!h.length) {
    el.innerHTML = `<div class="empty">${icon('standing')}<span>${t('paHistoryEmpty')}</span></div>`;
    return;
  }
  el.innerHTML = h.map((r) => {
    const when = new Date(r.ts);
    const date = when.toLocaleDateString(locale(), { month: 'numeric', day: 'numeric' }) + ' ' + when.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    const kindIcon = { standing: 'standing', single: 'standing', squat: 'squat', walk: 'stepup', run: 'stepup' }[r.kind] || 'standing';
    const meta = PA_META[r.kind] || PA_META.standing;   // v2.33.1：导入/同步来的旧记录可能缺 kind，兜底防整条历史列表崩掉
    const prev = h.find((x) => x.kind === r.kind && x.ts < r.ts);   // v2.21.4：与上次同体态对比
    const canDelta = prev && Number.isFinite(Number(r.score)) && Number.isFinite(Number(prev.score));
    const delta = canDelta ? `<span class="ft-delta ${Number(r.score) >= Number(prev.score) ? 'up' : 'down'}">${t('paHistoryDelta', { v: (Number(r.score) >= Number(prev.score) ? '↑' : '↓') + Math.abs(Number(r.score) - Number(prev.score)) })}</span>` : '';
    return `
    <div class="item">
      <div class="t">${icon(kindIcon)}${t(meta.nameKey)}${r.demo ? ' · ' + t('paBtnDemo') : ''} — ${date} ${delta}</div>
      <div class="d">${t('paScore')} ${r.score != null ? r.score : '—'}${r.grade ? ' · ' + t('paGrade' + r.grade) : ''}${Array.isArray(r.priorities) && r.priorities.length ? ' · ' + r.priorities.length + ' ' + t('paPriority') : ''}</div>
      <div class="controls" style="margin-top:6px"><button class="btn small" data-pa-view="${r.ts}"><span>${t('paView')}</span></button></div>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-pa-view]').forEach((b) => b.addEventListener('click', () => {
    const r = paHistory().find((x) => String(x.ts) === b.dataset.paView);
    if (r) { paState.report = r; renderPaReport(r); }   // 记录当前查看的报告，语言切换时可重渲染
  }));
}
function renderPaChecks(g) {
  const el = $('pa-checks');
  if (!el) return;
  if (!g.items.length) { el.innerHTML = ''; return; }
  el.innerHTML = g.items.map((i) => `
    <div class="pa-check ${i.ok ? 'ok' : 'bad'}">
      <span class="pa-check-dot">${i.ok ? '✓' : '✕'}</span>
      <span>${i.label}</span>
      ${i.note ? `<span class="pa-check-note">${i.note}</span>` : ''}
    </div>`).join('');
}
function setPaStartBtn() { $('btn-pa-start-label').textContent = paState.active ? t('paBtnStop') : t('paBtnStart'); }
function renderPaUI() {
  if (!$('pa-guide')) return;
  $('pa-guide').textContent = t(PA_META[paState.kind].guideKey);
  document.querySelectorAll('.pa-kind').forEach((b) => b.classList.toggle('on', b.dataset.pa === paState.kind));
  if (paState.active && paState.lastGate) renderPaChecks(paState.lastGate);
  if (paState.report && !$('pa-report').classList.contains('hidden')) renderPaReport(paState.report, false);
  renderPaHistory();
  setPaStartBtn();
}

async function paStart(demo = false) {
  if (!$('pa-video')) return;
  if (paState.active) { paStop(); return; }
  // 旧训练会话冲突 → 先停止旧会话（只调用旧函数，不改动）
  if (state.running) { await toggleStart(); }
  paState.active = true; paState.demo = demo;
  paState.samples = []; paState.hipHist = []; paState.steps = [];
  paResetStable(); paState.lastT = 0; paState.report = null;
  $('pa-report').classList.add('hidden');
  $('pa-gate').classList.remove('hidden');
  $('pa-progress-fill').style.width = '0%';
  $('pa-hint').textContent = '';
  renderPaChecks({ items: [] });
  setPaStartBtn();
  if (demo) {
    $('pa-video').classList.add('hidden');
    $('pa-placeholder').classList.remove('hidden');
    $('pa-placeholder-text').textContent = t('paDemoRunning');
  } else {
    $('pa-video').classList.remove('hidden');
    try {
      const stream = await openCamera();
      const v = $('pa-video');
      v.srcObject = stream;
      await new Promise((res, rej) => {
        if (v.readyState >= 1) return res();
        const t0 = setTimeout(() => { v.srcObject = null; stream.getTracks().forEach((x) => x.stop()); rej(new DOMException('视频初始化超时', 'TimeoutError')); }, 6000);
        v.onloadedmetadata = () => { clearTimeout(t0); res(); };
      });
      try { await v.play(); } catch { /* 自动播放被拦 */ }
      paState.stream = stream; paState.videoOn = true;
      $('pa-placeholder').classList.add('hidden');
    } catch (e) {
      paState.active = false; setPaStartBtn();
      $('pa-placeholder-text').textContent = cameraErrorText(e);
      return;
    }
    if (!state.landmarker) {
      const t0 = Date.now();
      $('pa-loading').innerHTML = icon('loader-spin') + '<span>' + t('loading') + ' 0s</span>';
      $('pa-loading').classList.remove('hidden');
      const tick = setInterval(() => {
        $('pa-loading').innerHTML = icon('loader-spin') + '<span>' + t('loading') + ' ' + Math.round((Date.now() - t0) / 1000) + 's</span>';
      }, 1000);
      try { state.landmarker = await loadModel(); }
      catch (e2) { clearInterval(tick); $('pa-loading').classList.add('hidden'); paStop(); toast(t('errUnknown', { msg: e2.message || '' })); return; }
      clearInterval(tick); $('pa-loading').classList.add('hidden');
    }
  }
  requestAnimationFrame(paLoop);
}
function paStop() {
  paState.active = false;
  cancelAnimationFrame(paState.raf);
  if (paState.stream) { paState.stream.getTracks().forEach((tr) => tr.stop()); paState.stream = null; }
  const v = $('pa-video');
  if (v) { v.srcObject = null; v.classList.remove('hidden'); }
  paState.videoOn = false;
  const c = $('pa-overlay');
  if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  const ph = $('pa-placeholder');
  if (ph) { ph.classList.remove('hidden'); $('pa-placeholder-text').textContent = t('paPlaceholderShort'); }
  const gate = $('pa-gate');
  if (gate) gate.classList.add('hidden');          // v2.20.2：手动停止后收起完整性检查面板，不留过期勾选
  paResetStable();
  setPaStartBtn();
}
function paFinish() {
  const kind = paState.kind;
  const smps = paState.samples.slice(-30);
  const r = paBuildReport(kind, PA_EVAL[kind](smps));
  paState.report = r;
  paSaveReport(r);
  paStop();
  renderPaReport(r);
  renderPaHistory();
  $('pa-gate').classList.add('hidden');
  toast(t('paReportTitle'));
}
function paLoop() {
  if (!paState.active) return;
  if (state.tab !== 'posture' || document.hidden) { requestAnimationFrame(paLoop); return; }
  const ts = performance.now();
  if (ts - paState.lastT < 33) { requestAnimationFrame(paLoop); return; }
  paState.lastT = ts;
  let lms = null;
  if (paState.demo) {
    lms = paDemoFrame(paState.kind, ts);
  } else {
    const v = $('pa-video');
    if (!paState.videoOn || v.readyState < 2) { requestAnimationFrame(paLoop); return; }
    const result = state.landmarker.detectForVideo(v, ts);
    if (result.landmarks && result.landmarks.length) lms = result.landmarks[0];
  }
  const c = $('pa-overlay');
  const cw = c.clientWidth, ch = c.clientHeight;
  if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
  const ctx2 = c.getContext('2d');
  ctx2.clearRect(0, 0, cw, ch);
  if (lms) drawStick(ctx2, lms, cw, ch, !paState.demo);   // 真实摄像头镜像，演示不镜像
  const g = paCompleteness(lms, paState.kind, ts);
  paState.lastGate = g;
  renderPaChecks(g);
  if (!lms) { paResetStable(); requestAnimationFrame(paLoop); return; }
  paState.hipHist.push({ y: (lms[23].y + lms[24].y) / 2, t: ts });
  if (paState.hipHist.length > 600) paState.hipHist.shift();
  paState.samples.push(lms);
  if (paState.samples.length > 360) paState.samples.shift();
  const meta = PA_META[paState.kind];
  if (meta.hold) {
    if (g.ok) {
      paState.stableMs += ts - (paState._lastOkT || ts);
      paState._lastOkT = ts;
    } else paResetStable();
    const need = meta.hold * 1000;
    $('pa-progress-fill').style.width = Math.min(100, (paState.stableMs / need) * 100) + '%';
    $('pa-hint').textContent = t('paProgressHold', { s: Math.min(meta.hold, +(paState.stableMs / 1000).toFixed(1)), n: meta.hold });
    if (paState.stableMs >= need) { paFinish(); return; }
  } else {
    paDetectSteps(ts);
    $('pa-progress-fill').style.width = Math.min(100, (paState.steps.length / meta.need) * 100) + '%';
    $('pa-hint').textContent = t('paProgressSteps', { n: Math.min(paState.steps.length, meta.need), m: meta.need })
      + (paState.steps.length >= 4 ? ' · ' + t('paCadenceLive', { c: Math.round(paCadence().cad) }) : '');   // v2.21.4：实时步频
    if (g.ok && paState.steps.length >= meta.need) { paFinish(); return; }
  }
  requestAnimationFrame(paLoop);
}

// 演示模式：模拟姿态骨架（无摄像头跑完整流程；站立带轻微头前倾/躯干前倾，深蹲带轻微内扣，走跑带轻微不对称）
function paDemoFrame(kind, ts) {
  const tSec = ts / 1000;
  const mk = (x, y, vis = 1) => ({ x, y, z: 0, visibility: vis });
  const lms = new Array(33).fill(null);
  const set = (i, x, y) => { lms[i] = mk(x, y); };
  const nz = (a) => a * Math.sin(tSec * 31) * 0.002;
  const fill = () => { for (let i = 0; i < 33; i++) if (!lms[i]) lms[i] = mk(0.5, 0.5, 0); };
  const body = (headX, headY, shY, hipY, kneeY, ankleY, shXL, shXR, hipXL, hipXR, kneeXL, kneeXR, ankXL, ankXR, elbowY, wristY) => {
    set(0, headX, headY);
    set(11, shXL, shY); set(12, shXR, shY);
    set(13, shXL - 0.02, elbowY); set(14, shXR + 0.02, elbowY);
    set(15, shXL - 0.03, wristY); set(16, shXR + 0.03, wristY);
    set(23, hipXL, hipY); set(24, hipXR, hipY);
    set(25, kneeXL, kneeY); set(26, kneeXR, kneeY);
    set(27, ankXL, ankleY); set(28, ankXR, ankleY);
  };
  if (kind === 'standing') {
    body(0.47 + nz(1), 0.12 + nz(1), 0.225 + nz(1), 0.45 + nz(1), 0.66 + nz(1), 0.87 + nz(1), 0.41, 0.59, 0.44, 0.56, 0.455, 0.545, 0.46, 0.54, 0.30, 0.38);
    set(11, mk(0.41, 0.235));       // 轻微高低肩
    set(12, mk(0.59, 0.225));
  } else if (kind === 'single') {
    body(0.5, 0.10, 0.22, 0.45, 0.66, 0.87, 0.41, 0.59, 0.44, 0.56, 0.46, 0.54, 0.47, 0.53, 0.30, 0.37);
    set(28, 0.545, 0.80);      // v2.21.4：抬右腿（修复 mk 嵌套坐标 bug，此前踝 y 为 undefined 导致门控永不通过）
    set(26, 0.55, 0.70);
  } else if (kind === 'squat') {
    body(0.475, 0.16, 0.30, 0.52, 0.68, 0.87, 0.40, 0.60, 0.44, 0.56, 0.475, 0.585, 0.46, 0.555, 0.40, 0.48);
  } else if (kind === 'walk' || kind === 'run') {
    const f = kind === 'walk' ? 1.83 : 2.83;   // 110 / 170 步/分
    const ph = 2 * Math.PI * f * tSec;
    const bounce = kind === 'walk' ? 0.02 : 0.018;
    const hipY = 0.48 + Math.sin(ph) * bounce;
    const step = Math.sin(ph);
    const swingL = Math.sin(ph) * 0.045, swingR = -swingL;
    const armL = -swingL * 0.8, armR = -swingR * 0.8;
    const shX = kind === 'run' ? 0.035 : 0;    // 跑步前倾 8° 左右
    body(0.5 + nz(1), 0.12 + Math.sin(ph) * bounce * 1.15, 0.245 + nz(1), hipY, 0.66 + nz(1), 0.87 + nz(1),
      0.41 - shX, 0.59 - shX, 0.44, 0.56, 0.452 + step * 0.01, 0.548 - step * 0.01,
      0.445 + swingL, 0.555 + swingR, 0.30 + armL, 0.385 + armL);
    // 步行交替步幅（左右脚前后错位由踝/膝体现）
    set(27, mk(0.44 + swingL, 0.87));
    set(28, mk(0.56 + swingR, 0.87));
  }
  fill();
  return lms;
}

/* ============ 新增功能（v2.20）：运动功能测试（动态动作分析 · 运动学引擎 · 知识库 · 长期追踪） ============ */
// 流程：选动作（或 5 项连测）→ 采集整个动作过程 → 运动学引擎（平滑→极值分割→ROM/对称/速度/稳定/一致）
//      → 六维加权评分（静态对称20·排列20·动态25·稳定15·活动度10·一致10）→ 标准模板相似度
//      → 「问题→训练」知识库处方 → 复测自动对比上次进步 → 数字人体档案。纯新增，旧功能零改动。
const FT_MOVES = {
  squat: { name: 'ftMvSquat', guide: 'ftGuideSquat', metric: 'knee', target: 'valley', thr: 25, need: 3, thrLow: 115, thrHigh: 150 },
  lunge: { name: 'ftMvLunge', guide: 'ftGuideLunge', metric: 'knee', target: 'valley', thr: 25, need: 4, thrLow: 115, thrHigh: 150 },
  single: { name: 'ftMvSingle', guide: 'ftGuideSingle', metric: 'knee', target: 'valley', thr: 25, need: 4, thrLow: 115, thrHigh: 150 },
  arm: { name: 'ftMvArm', guide: 'ftGuideArm', metric: 'raise', target: 'peak', thr: 0.10, need: 3, thrLow: 0.03, thrHigh: 0.08 },
  bend: { name: 'ftMvBend', guide: 'ftGuideBend', metric: 'trunk', target: 'valley', thr: 25, need: 2, thrLow: 135, thrHigh: 160 },
};
const FT_ORDER = ['squat', 'lunge', 'single', 'arm', 'bend'];
const ftState = {
  active: false, demo: false, mode: 'single', key: 'squat', queue: [], queueIdx: 0,
  frames: [], lastT: 0, raf: 0, stream: null, videoOn: false, t0: 0,
  lastGate: null, report: null, repState: null, cueLast: null, cueSpokeAt: 0,
  startFrame: null, lastView: null, gapUntil: 0,
};
function ftFrameMetrics(lms) {
  const sh = paMid(lms, 11, 12), hp = paMid(lms, 23, 24), kn = paMid(lms, 25, 26);
  const kL = angle3(lms[23], lms[25], lms[27]), kR = angle3(lms[24], lms[26], lms[28]);
  const vg = kneeValgus(lms);
  return {
    kL, kR, knee: Math.min(kL, kR),
    raise: Math.min(lms[11].y - lms[15].y, lms[12].y - lms[16].y),
    trunk: angle3(kn, hp, sh),
    trunkLean: verticalAngle(sh, hp),
    valgus: Math.max(vg.left, vg.right),
    headLean: verticalAngle(lms[0], sh),
    shoulderDiff: Math.abs(lms[11].y - lms[12].y) / paTorso(lms),
    pelvisDiff: Math.abs(lms[23].y - lms[24].y) / paTorso(lms),
    hipMidX: hp.x / Math.max(0.05, paTorso(lms)),
    hipX: hp.x, hipY: hp.y,
    kneeExt: Math.max(Math.abs(180 - kL), Math.abs(180 - kR)),
    lms,
  };
}
function ftGate(lms) {
  const items = [{ key: 'person', ok: !!lms, label: t('ftCheckPerson') }];
  if (!lms) return { ok: false, items };
  const req = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  const missing = req.filter((i) => !paVis(lms, i));
  items.push({
    key: 'body', ok: !missing.length, label: t('ftCheckBody'),
    note: missing.length ? t('ftMissing', { parts: missing.map((i) => t('paPart' + i)).join('、') }) : '',
  });
  const xs = [], ys = [];
  for (let i = 0; i < 33; i++) if (paVis(lms, i)) { xs.push(lms[i].x); ys.push(lms[i].y); }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  let frameOk = true, frameHint = '';
  if (maxY > 0.97 || minY < 0.02) { frameOk = false; frameHint = t('ftFrameHintFar'); }
  else if (maxY < 0.82 && (maxY - minY) < 0.5) { frameOk = false; frameHint = t('ftFrameHintNear'); }
  else if (minX < 0.02 || maxX > 0.98) { frameOk = false; frameHint = t('ftFrameHintCenter'); }
  items.push({ key: 'frame', ok: frameOk, label: t('ftCheckFrame'), note: frameOk ? '' : frameHint });
  return { ok: items.every((i) => i.ok), items };
}
const ftSmooth = (arr) => { const o = arr.slice(); for (let i = 1; i < arr.length - 1; i++) o[i] = (arr[i - 1] + arr[i] + arr[i + 1]) / 3; return o; };
function ftExtrema(series, target, thr) {
  const rawPeaks = [], rawValleys = [];
  for (let i = 2; i < series.length - 2; i++) {
    const down = series[i] <= series[i - 1] && series[i] <= series[i + 1] && series[i] <= series[i - 2] && series[i] <= series[i + 2]
      && (series[i] < series[i - 2] || series[i] < series[i + 2]);
    const up = series[i] >= series[i - 1] && series[i] >= series[i + 1] && series[i] >= series[i - 2] && series[i] >= series[i + 2]
      && (series[i] > series[i - 2] || series[i] > series[i + 2]);
    if (up && !down) rawPeaks.push(i);
    if (down && !up) rawValleys.push(i);
  }
  const merge = (list, keepLow) => {   // 相邻平台期极值去重（谷留最低、峰留最高）
    const out = [];
    for (const i of list) {
      const last = out[out.length - 1];
      if (last != null && i - last <= 2) {
        const better = keepLow ? series[i] < series[last] : series[i] > series[last];
        if (better) out[out.length - 1] = i;
      } else out.push(i);
    }
    return out;
  };
  const peaks = merge(rawPeaks, false), valleys = merge(rawValleys, true);
  const near = (list, v) => { for (let i = list.length - 1; i >= 0; i--) if (list[i] < v) return list[i]; return null; };
  const nearA = (list, v) => { for (let i = 0; i < list.length; i++) if (list[i] > v) return list[i]; return null; };
  const out = [];
  const src = target === 'valley' ? valleys : peaks;
  const pick = target === 'valley' ? (v, p) => p - v : (v, p) => v - p;
  const oppo = target === 'valley' ? peaks : valleys;
  for (const v of src) {
    const pB = near(oppo, v);
    const pA = nearA(oppo, v);
    const exc = Math.max(pB != null ? pick(series[v], series[pB]) : 0, pA != null ? pick(series[v], series[pA]) : 0);
    if (exc > thr) out.push({ idx: v, pB, pA, exc });
  }
  return out;
}
function ftAnalyze(key, frames) {
  const mv = FT_MOVES[key];
  const sm = ftSmooth(frames.map((f) => f[mv.metric]));
  const ex = ftExtrema(sm, mv.target, mv.thr);
  const reps = ex.slice(0, mv.need);
  const m = { key, reps: reps.length, need: mv.need, ts: Date.now(), issues: [], okItems: [] };
  const roms = [], downMs = [], upMs = [], bottomStd = [], valgusAt = [], trunkAt = [], topStd = [];
  for (const r of reps) {
    const pB = r.pB ?? r.idx, pA = r.pA ?? r.idx;
    roms.push(Math.abs(sm[pB] - sm[r.idx]));
    if (r.pB != null) downMs.push(frames[r.idx].t - frames[r.pB].t);
    if (r.pA != null) upMs.push(frames[r.pA].t - frames[r.idx].t);
    const win = frames.filter((f) => Math.abs(f.t - frames[r.idx].t) < 150);
    bottomStd.push(paStd(win.map((f) => f[mv.metric])));
    valgusAt.push(paMed(win.map((f) => f.valgus)));
    trunkAt.push(paMed(win.map((f) => f.trunkLean)));
    const win2 = frames.filter((f) => Math.abs(f.t - frames[pB].t) < 150);
    topStd.push(paStd(win2.map((f) => f[mv.metric])));
  }
  m.rom = paMed(roms);
  m.downSec = paMed(downMs) / 1000;
  m.upSec = paMed(upMs) / 1000;
  m.stab = paMed(bottomStd);
  m.cons = m.rom ? paStd(roms) / m.rom * 100 : 0;
  m.valgus = paMed(valgusAt);
  m.trunkLean = paMed(trunkAt);
  if (mv.metric === 'knee') {
    m.depth = Math.min(...sm);
    const kLs = ftSmooth(frames.map((f) => f.kL)), kRs = ftSmooth(frames.map((f) => f.kR));
    const dl = Math.min(...kLs), dr = Math.min(...kRs);
    m.asym = Math.abs(dl - dr) / Math.max(10, (dl + dr) / 2) * 100;
    m.asymL = dl; m.asymR = dr;
  } else if (key === 'arm') {
    m.raise = Math.max(...sm);
    const rL = ftSmooth(frames.map((f) => f.lms[11].y - f.lms[15].y)), rR = ftSmooth(frames.map((f) => f.lms[12].y - f.lms[16].y));
    m.asym = Math.abs(Math.max(...rL) - Math.max(...rR));
    m.stab = paMed(topStd);
  } else { // bend
    m.flexion = 180 - Math.min(...sm);
    m.kneeExt = paMed(frames.map((f) => f.kneeExt));
    const xs = frames.map((f) => f.hipMidX).sort((a, b) => a - b);
    m.center = xs[Math.floor(xs.length * 0.9)] - xs[Math.floor(xs.length * 0.1)];
    m.stab = paMed(bottomStd);
  }
  m.cons = Math.min(m.cons, 100);
  // v2.21：动作轨迹（Tempo 式回放）：取第一次动作的关键点路径，13 点采样
  m.traj = null;
  if (reps.length) {
    const r = reps[0];
    const pB = r.pB ?? r.idx, pA = r.pA ?? r.idx;
    const n = 13, pts = [];
    for (let i = 0; i < n; i++) {
      const f = frames[Math.min(frames.length - 1, Math.round(pB + ((pA - pB) * i) / (n - 1)))];
      if (!f) continue;
      if (key === 'arm') pts.push([(f.lms[15].x + f.lms[16].x) / 2, (f.lms[15].y + f.lms[16].y) / 2]);
      else if (key === 'bend') pts.push([(f.lms[11].x + f.lms[12].x) / 2, (f.lms[11].y + f.lms[12].y) / 2]);
      else pts.push([f.hipX, f.hipY]);
    }
    if (pts.length >= 5) m.traj = pts;
  }
  // 零次数/超时保护：所有指标归一化为安全数值，防止报告渲染时 toFixed 崩溃
  const norm = (v, d = 0) => (v == null || Number.isNaN(v)) ? d : v;
  m.rom = norm(m.rom); m.downSec = norm(m.downSec); m.upSec = norm(m.upSec); m.stab = norm(m.stab);
  m.cons = norm(m.cons); m.valgus = norm(m.valgus); m.trunkLean = norm(m.trunkLean);
  m.depth = norm(m.depth, 180); m.asym = norm(m.asym); m.asymL = norm(m.asymL, 180); m.asymR = norm(m.asymR, 180);
  m.raise = norm(m.raise); m.flexion = norm(m.flexion); m.kneeExt = norm(m.kneeExt, 180); m.center = norm(m.center);
  return m;
}
const ftWin = (v, lo, hi, wLo, wHi) => (v >= lo && v <= hi) ? 100 : (v >= wLo && v <= wHi) ? 70 : 35;
const ftBand = (v, goodMax, badMax) => (v < goodMax ? 100 : v < badMax ? 70 : 35);
const ftGood = (v, goodMin, badMin) => (v >= goodMin ? 100 : v >= badMin ? 70 : 35);
function ftScoreMovement(key, m) {
  let S;
  if (key === 'bend') {
    S = {
      sym: ftBand(m.center, 0.05, 0.10),
      align: ftGood(180 - m.kneeExt, 150, 135),
      dyn: ftWin(m.downSec, 1.5, 3.5, 0.9, 5.5),
      stab: ftBand(m.stab, 4, 8),
      rom: ftGood(m.flexion, 60, 40),
      cons: ftBand(m.cons, 12, 25),
    };
  } else if (key === 'arm') {
    S = {
      sym: ftBand(m.asym, 0.04, 0.09),
      align: ftBand(m.trunkLean, 6, 12),
      dyn: ftWin(m.upSec, 0.6, 1.6, 0.3, 2.6),
      stab: ftBand(m.stab, 0.03, 0.06),
      rom: ftGood(m.raise, 0.30, 0.22),
      cons: ftBand(m.cons, 12, 25),
    };
  } else {
    const trunkScore = (m.trunkLean >= 10 && m.trunkLean <= 35) ? 100 : (m.trunkLean <= 50 ? 70 : 35);
    S = {
      sym: ftBand(m.asym, 8, 15),
      align: Math.min(ftBand(m.valgus, 0.15, 0.30), trunkScore),
      dyn: ftWin(m.downSec, 0.6, 1.5, 0.35, 2.2),
      stab: ftBand(m.stab, 4, 8),
      rom: ftGood(m.rom, 40, 25),
      cons: ftBand(m.cons, 12, 25),
    };
  }
  S.total = Math.round(0.2 * S.sym + 0.2 * S.align + 0.25 * S.dyn + 0.15 * S.stab + 0.10 * S.rom + 0.10 * S.cons);
  return S;
}
function ftIssues(key, m) {
  const out = [];
  const push = (kb, level, label, val, text, advice) => out.push({ kb, level, label, val, text, advice });
  const ok = (kb, label, val, text) => out.push({ kb, level: 'good', label, val, text, advice: '' });
  if (key === 'bend') {
    if (m.center > 0.05) push('center', m.center > 0.10 ? 'bad' : 'warn', t('ftMetricCenter'), m.center.toFixed(2), t('ftIssueCenter', { v: m.center.toFixed(2) }), t('ftAdvCenter'));
    else ok('center', t('ftMetricCenter'), m.center.toFixed(2), t('ftIssueCenterOk'));
    if (180 - m.kneeExt > 25) push('kneeBend', (180 - m.kneeExt) > 45 ? 'bad' : 'warn', t('ftMetricKneeExt'), (180 - m.kneeExt).toFixed(0) + '°', t('ftIssueKneeExt', { v: (180 - m.kneeExt).toFixed(0) }), t('ftAdvKneeExt'));
    else ok('kneeBend', t('ftMetricKneeExt'), (180 - m.kneeExt).toFixed(0) + '°', t('ftIssueKneeExtOk'));
    if (m.flexion < 50) push('rom', m.flexion < 35 ? 'bad' : 'warn', t('ftMetricRom'), m.flexion.toFixed(0) + '°', t('ftIssueRom', { v: m.flexion.toFixed(0) }), t('ftAdvRom'));
    else ok('rom', t('ftMetricRom'), m.flexion.toFixed(0) + '°', t('ftIssueRomOk', { v: m.flexion.toFixed(0) }));
    if (m.downSec < 1.2) push('speed', m.downSec < 0.8 ? 'bad' : 'warn', t('ftMetricSpeed'), m.downSec.toFixed(1) + 's', t('ftIssueSpeed', { v: m.downSec.toFixed(1) }), t('ftAdvSpeed'));
    else ok('speed', t('ftMetricSpeed'), m.downSec.toFixed(1) + 's', t('ftIssueSpeedOk', { v: m.downSec.toFixed(1) }));
    if (m.cons > 15) push('cons', m.cons > 25 ? 'bad' : 'warn', t('ftMetricCons'), m.cons.toFixed(0) + '%', t('ftIssueCons', { v: m.cons.toFixed(0) }), t('ftAdvCons'));
    else ok('cons', t('ftMetricCons'), m.cons.toFixed(0) + '%', t('ftIssueConsOk'));
    return out;
  }
  if (key === 'arm') {
    if (m.raise < 0.26) push('arm', m.raise < 0.18 ? 'bad' : 'warn', t('ftMetricRaise'), m.raise.toFixed(2), t('ftIssueRaise', { v: m.raise.toFixed(2) }), t('ftAdvRaise'));
    else ok('arm', t('ftMetricRaise'), m.raise.toFixed(2), t('ftIssueRaiseOk', { v: m.raise.toFixed(2) }));
    if (m.asym > 0.04) push('arm', m.asym > 0.09 ? 'bad' : 'warn', t('ftMetricSym'), m.asym.toFixed(2), t('ftIssueArmSym', { v: m.asym.toFixed(2) }), t('ftAdvSym'));
    else ok('arm', t('ftMetricSym'), m.asym.toFixed(2), t('ftIssueArmSymOk', { v: m.asym.toFixed(2) }));
    if (m.trunkLean > 10) push('trunk', m.trunkLean > 16 ? 'bad' : 'warn', t('ftMetricTrunk'), m.trunkLean.toFixed(0) + '°', t('ftIssueTrunk', { v: m.trunkLean.toFixed(0) }), t('ftAdvTrunk'));
    else ok('trunk', t('ftMetricTrunk'), m.trunkLean.toFixed(0) + '°', t('ftIssueTrunkOk', { v: m.trunkLean.toFixed(0) }));
    if (m.upSec < 0.45 || m.upSec > 1.8) push('speed', m.upSec < 0.3 || m.upSec > 2.4 ? 'bad' : 'warn', t('ftMetricSpeed'), m.upSec.toFixed(1) + 's', t('ftIssueSpeed', { v: m.upSec.toFixed(1) }), t('ftAdvSpeed'));
    else ok('speed', t('ftMetricSpeed'), m.upSec.toFixed(1) + 's', t('ftIssueSpeedOk', { v: m.upSec.toFixed(1) }));
    if (m.cons > 15) push('cons', m.cons > 25 ? 'bad' : 'warn', t('ftMetricCons'), m.cons.toFixed(0) + '%', t('ftIssueCons', { v: m.cons.toFixed(0) }), t('ftAdvCons'));
    else ok('cons', t('ftMetricCons'), m.cons.toFixed(0) + '%', t('ftIssueConsOk'));
    return out;
  }
  if (m.depth > 120) push('depth', m.depth > 140 ? 'bad' : 'warn', t('ftMetricDepth'), m.depth.toFixed(0) + '°', t('ftIssueDepth', { v: m.depth.toFixed(0) }), t('ftAdvDepth'));
  else ok('depth', t('ftMetricDepth'), m.depth.toFixed(0) + '°', t('ftIssueDepthOk', { v: m.depth.toFixed(0) }));
  if (m.asym > 8) push('asym', m.asym > 15 ? 'bad' : 'warn', t('ftMetricSym'), m.asym.toFixed(0) + '%', t('ftIssueSym', { v: m.asym.toFixed(0), l: m.asymL.toFixed(0), r: m.asymR.toFixed(0) }), t('ftAdvSym'));
  else ok('asym', t('ftMetricSym'), m.asym.toFixed(0) + '%', t('ftIssueSymOk', { v: m.asym.toFixed(0) }));
  if (m.valgus > 0.15) push('valgus', m.valgus > 0.30 ? 'bad' : 'warn', t('ftMetricValgus'), m.valgus.toFixed(2), t('ftIssueValgus', { v: m.valgus.toFixed(2) }), t('ftAdvValgus'));
  else ok('valgus', t('ftMetricValgus'), m.valgus.toFixed(2), t('ftIssueValgusOk'));
  if (m.trunkLean > 40) push('trunk', m.trunkLean > 55 ? 'bad' : 'warn', t('ftMetricTrunk'), m.trunkLean.toFixed(0) + '°', t('ftIssueTrunk', { v: m.trunkLean.toFixed(0) }), t('ftAdvTrunk'));
  else ok('trunk', t('ftMetricTrunk'), m.trunkLean.toFixed(0) + '°', t('ftIssueTrunkOk', { v: m.trunkLean.toFixed(0) }));
  if (m.downSec < 0.5 || m.downSec > 1.6) push('speed', m.downSec < 0.35 || m.downSec > 2.2 ? 'bad' : 'warn', t('ftMetricSpeed'), m.downSec.toFixed(1) + 's', t('ftIssueSpeed', { v: m.downSec.toFixed(1) }), t('ftAdvSpeed'));
  else ok('speed', t('ftMetricSpeed'), m.downSec.toFixed(1) + 's', t('ftIssueSpeedOk', { v: m.downSec.toFixed(1) }));
  if (m.stab > 5) push('stab', m.stab > 9 ? 'bad' : 'warn', t('ftMetricStab'), m.stab.toFixed(0) + '°', t('ftIssueStab', { v: m.stab.toFixed(0) }), t('ftAdvStab'));
  else ok('stab', t('ftMetricStab'), m.stab.toFixed(0) + '°', t('ftIssueStabOk'));
  if (m.rom < 30) push('rom', m.rom < 22 ? 'bad' : 'warn', t('ftMetricRom'), m.rom.toFixed(0) + '°', t('ftIssueRom', { v: m.rom.toFixed(0) }), t('ftAdvRom'));
  else ok('rom', t('ftMetricRom'), m.rom.toFixed(0) + '°', t('ftIssueRomOk', { v: m.rom.toFixed(0) }));
  if (m.cons > 15) push('cons', m.cons > 25 ? 'bad' : 'warn', t('ftMetricCons'), m.cons.toFixed(0) + '%', t('ftIssueCons', { v: m.cons.toFixed(0) }), t('ftAdvCons'));
  else ok('cons', t('ftMetricCons'), m.cons.toFixed(0) + '%', t('ftIssueConsOk'));
  return out;
}
// 专业知识库：问题 → 可能因素 → 推荐训练 → 注意事项 → 复测
const FT_KB = {
  valgus: { problem: 'ftMetricValgus', factor: 'ftFactorValgus', ex: ['ftExClam', 'ftExBandWalk', 'ftExBridge', 'ftExStepDown', 'ftExAssist'], caution: 'ftCautionValgus' },
  depth: { problem: 'ftMetricDepth', factor: 'ftFactorDepth', ex: ['ftExWallSquat', 'ftExWallSit'], caution: 'ftCautionDepth' },
  asym: { problem: 'ftMetricSym', factor: 'ftFactorAsym', ex: ['ftExAssist', 'ftExStepDown'], caution: 'ftCautionAsym' },
  trunk: { problem: 'ftMetricTrunk', factor: 'ftFactorTrunk', ex: ['ftExPlank', 'ftExCatCow'], caution: 'ftCautionTrunk' },
  speed: { problem: 'ftMetricSpeed', factor: 'ftFactorSpeed', ex: ['ftExWallSit'], caution: 'ftCautionSpeed' },
  stab: { problem: 'ftMetricStab', factor: 'ftFactorStab', ex: ['ftExWallSit', 'ftExBridge'], caution: 'ftCautionStab' },
  cons: { problem: 'ftMetricCons', factor: 'ftFactorCons', ex: ['ftExWallSquat'], caution: 'ftCautionCons' },
  rom: { problem: 'ftMetricRom', factor: 'ftFactorCons', ex: ['ftExCatCow', 'ftExWallSquat'], caution: 'ftCautionCons' },
  head: { problem: 'mStandHead', factor: 'ftFactorHead', ex: ['ftExAngel', 'ftExPlank'], caution: 'ftCautionHead' },
  shoulder: { problem: 'mStandShoulder', factor: 'ftFactorShoulder', ex: ['ftExScap', 'ftExAngel'], caution: 'ftCautionShoulder' },
  arm: { problem: 'ftMetricRaise', factor: 'ftFactorArm', ex: ['ftExAngel', 'ftExScap'], caution: 'ftCautionArm' },
  kneeBend: { problem: 'ftMetricKneeExt', factor: 'ftFactorKneeBend', ex: ['ftExHam'], caution: 'ftCautionKneeBend' },
  center: { problem: 'ftMetricCenter', factor: 'ftFactorCenter', ex: ['ftExPlank', 'ftExBridge'], caution: 'ftCautionCenter' },
};
// 标准动作模板（时间归一化参考曲线）
function ftRefSeries(key, n = 100) {
  const s = [];
  const rampUp = (x, x0, x1, a, b) => Math.max(a, Math.min(b, a + (b - a) * Math.sin(((x - x0) / (x1 - x0)) * Math.PI / 2)));
  const rampDn = (x, x0, x1, a, b) => Math.max(b, Math.min(a, a + (b - a) * Math.sin(((x - x0) / (x1 - x0)) * Math.PI / 2)));
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    let v = 1;
    if (key === 'arm') {
      v = x < 0.12 ? 0 : x < 0.55 ? rampUp(x, 0.12, 0.55, 0, 1) : x < 0.68 ? 1 : rampDn(x, 0.68, 0.97, 1, 0);
    } else {
      v = x < 0.15 ? 1 : x < 0.50 ? rampDn(x, 0.15, 0.50, 1, 0.30) : x < 0.62 ? 0.30 : x < 0.97 ? rampUp(x, 0.62, 0.97, 0.30, 1) : 1;
    }
    s.push(v);
  }
  return s;
}
function ftSimilarity(key, frames) {
  const mv = FT_MOVES[key];
  const sm = ftSmooth(frames.map((f) => f[mv.metric]));
  const ex = ftExtrema(sm, mv.target, mv.thr).slice(0, mv.need);
  if (!ex.length) return { sim: 0, curve: null, ref: null };
  const ref = ftRefSeries(key);
  const curves = ex.map((r) => {
    const pB = r.pB ?? r.idx, pA = r.pA ?? r.idx;
    const lo = Math.min(sm[pB], sm[r.idx]), hi = Math.max(sm[pB], sm[r.idx]);
    const span = Math.max(1e-6, hi - lo);
    const n = 100, out = [];
    for (let i = 0; i < n; i++) {
      const t0 = pB + ((pA - pB) * i) / (n - 1);
      const i0 = Math.max(0, Math.min(sm.length - 1, Math.floor(t0)));
      const v = (sm[i0] - lo) / span;
      out.push(Math.max(0, Math.min(1, v)));
    }
    return out;
  });
  const user = curves[0].map((_, i) => paMean(curves.map((c) => c[i])));
  const err = paMean(user.map((v, i) => Math.abs(v - ref[i])));
  return { sim: Math.max(0, Math.round(100 * (1 - err))), curve: user, ref };
}
const ftMetricBetterLow = ['depth', 'asym', 'valgus', 'trunkLean', 'downSec', 'upSec', 'stab', 'cons', 'center', 'kneeExt'];
function ftDelta(prevM, m, metric) {
  if (prevM == null || m[metric] == null || prevM[metric] == null || prevM[metric] === 0) return null;
  const pct = Math.round(Math.abs(prevM[metric] - m[metric]) / Math.abs(prevM[metric]) * 100);
  if (pct < 3) return null;
  const better = ftMetricBetterLow.includes(metric) ? m[metric] < prevM[metric] : m[metric] > prevM[metric];
  return { pct, better };
}
function ftHistory() { return sget('rehab_ft_history', []); }
function ftSaveRecord(rec) { const h = ftHistory(); h.unshift(rec); if (h.length > 60) h.length = 60; sset('rehab_ft_history', h); }

// 实时教练：每帧只挑一个最重要的错误（优先级：内扣 > 躯干 > 深度 > 速度 > 对称）
function ftCueFor(key, m) {
  if (key === 'bend') {
    if (m.trunk < 150 && 180 - m.kneeExt > 25) return t('ftIssueKneeExt', { v: (180 - m.kneeExt).toFixed(0) });
    if (m.trunk < 150 && ftState.startFrame && Math.abs(m.hipMidX - ftState.startFrame.hipMidX) > 0.08) return t('ftCueBendCenter');
  } else if (key === 'arm') {
    const armDiff = Math.abs((m.lms[11].y - m.lms[15].y) - (m.lms[12].y - m.lms[16].y));
    if (m.trunkLean > 14) return t('ftIssueTrunk', { v: m.trunkLean.toFixed(0) });
    if (m.raise > 0.02 && armDiff > 0.06) return t('ftCueArmSym', { v: armDiff.toFixed(2) });
  } else {
    if (m.knee < 130 && m.valgus > 0.20) return t('ftIssueValgus', { v: m.valgus.toFixed(2) });
    if (m.knee < 130 && m.trunkLean > 45) return t('ftIssueTrunk', { v: m.trunkLean.toFixed(0) });
    if (m.knee < 150 && m.knee > 120) return t('ftIssueDepth', { v: m.knee.toFixed(0) });
    if (Math.abs(m.kL - m.kR) > 25) {
      const symPct = Math.abs(m.kL - m.kR) / Math.max(10, (m.kL + m.kR) / 2) * 100;
      return t('ftIssueSym', { v: symPct.toFixed(0), l: m.kL.toFixed(0), r: m.kR.toFixed(0) });
    }
  }
  return null;
}
function ftLiveReps(m, ts) {
  const mv = FT_MOVES[ftState.key];
  const v = m[mv.metric];
  const st = ftState.repState;
  if (!st) return 0;
  if (st.phase === 'up' && v < mv.thrLow) st.phase = 'down';
  else if (st.phase === 'down' && v > mv.thrHigh) {
    if (ts - st.lastRepT > 700) { st.count++; st.lastRepT = ts; }
    st.phase = 'up';
  }
  return st.count;
}
// v2.21.3：阶段判定（0 站直/放下 · 1 下降或上升 · 2 底部或顶部），纯函数供自测
function ftPhaseOf(key, v) {
  const mv = FT_MOVES[key];
  if (mv.target === 'peak') return v >= mv.thrHigh ? 2 : v <= mv.thrLow ? 0 : 1;   // 峰值型：高阈=举起，低阈=放下
  return v > mv.thrHigh ? 0 : v < mv.thrLow ? 2 : 1;
}
function renderFtChecks(g) {
  const el = $('ft-checks');
  if (!el) return;
  if (!g.items.length) { el.innerHTML = ''; return; }
  el.innerHTML = g.items.map((i) => `
    <div class="pa-check ${i.ok ? 'ok' : 'bad'}">
      <span class="pa-check-dot">${i.ok ? '✓' : '✕'}</span><span>${i.label}</span>
      ${i.note ? `<span class="pa-check-note">${i.note}</span>` : ''}
    </div>`).join('');
}
function renderFtLive(m, reps, need, ts) {
  const el = $('ft-live-metrics');
  if (!el) return;
  const mv = FT_MOVES[ftState.key];
  const main = mv.metric === 'knee' ? [t('ftLiveKnee'), m.knee.toFixed(0) + '°'] : mv.metric === 'raise' ? [t('ftLiveRaise'), m.raise.toFixed(2)] : [t('ftLiveBend'), m.trunk.toFixed(0) + '°'];
  el.innerHTML = `
    <div class="stat big"><span class="s-label">${main[0]}</span><span class="s-value">${main[1]}</span></div>
    <div class="stat"><span class="s-label">${t('ftLiveTrunk')}</span><span class="s-value">${m.trunkLean.toFixed(0)}°</span></div>
    <div class="stat"><span class="s-label">${t('ftLiveValgus')}</span><span class="s-value">${m.valgus.toFixed(2)}</span></div>
    <div class="stat"><span class="s-label">${t('ftCapturing')}</span><span class="s-value">${Math.min(reps, need)}/${need}</span></div>`;
  const cue = ftCueFor(ftState.key, m);
  const cueEl = $('ft-cue');
  const now = ts || performance.now();
  if (cue && cue !== ftState.cueLast) {
    ftState.cueLast = cue;
    cueEl.innerHTML = icon('alert') + '<span>' + t('ftCueTitle') + '：' + cue + '</span>';
    cueEl.className = 'ft-cue';
    if (!ftState.cueSpokeAt || now - ftState.cueSpokeAt > 3500) { speak(cue); ftState.cueSpokeAt = now; }   // 语音防刷屏
  } else if (!cue && ftState.cueLast !== t('ftCueNone')) {
    ftState.cueLast = t('ftCueNone');
    cueEl.innerHTML = icon('check') + '<span>' + t('ftCueNone') + '</span>';
    cueEl.className = 'ft-cue ok';
  }
  const battPrefix = ftState.mode === 'battery' ? t('ftBatteryProgress', { i: ftState.queueIdx + 1, n: ftState.queue.length }) + ' · ' : '';
  $('ft-hint').textContent = reps >= need ? t('ftAutoDone')
    : reps > 0 ? t('ftRepDone', { n: reps, m: need })
      : battPrefix + t(FT_MOVES[ftState.key].guide);
  // v2.21.3：阶段指示 + 次数进度条
  const subEl = $('ft-live-sub');
  if (subEl) {
    const ph = ftPhaseOf(ftState.key, m[mv.metric]);
    const phaseKey = mv.target === 'peak' ? (ph === 1 ? 'ftPhaseUpL' : ph === 2 ? 'ftPhaseBottomL' : 'ftPhaseIdle') : (ph === 1 ? 'ftPhaseDownL' : ph === 2 ? 'ftPhaseBottomL' : 'ftPhaseIdle');
    subEl.classList.remove('hidden');
    subEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px">
        <span style="flex:none">${t('ftPhase')}：<b>${t(phaseKey)}</b></span>
        <div class="gw-bar" style="flex:1"><div class="gw-bar-fill" style="width:${Math.min(100, (reps / Math.max(1, need)) * 100).toFixed(0)}%"></div></div>
        <span style="flex:none">${Math.min(reps, need)}/${need}</span>
      </div>`;
  }
}
function setFtStartBtn() { $('btn-ft-start-label').textContent = ftState.active ? t('ftBtnStop') : t('ftBtnStart'); }

async function ftStart(kind, demo = false) {
  if (!$('ft-video')) return;
  if (ftState.active) { ftStop(); return; }
  if (state.running) { await toggleStart(); }          // 只调用旧函数，不改动
  ftState.active = true; ftState.demo = demo;
  ftState.mode = kind === 'battery' ? 'battery' : 'single';
  ftState.queue = ftState.mode === 'battery' ? FT_ORDER.slice() : [kind];
  ftState.queueIdx = 0; ftState.key = ftState.queue[0];
  ftState.frames = []; ftState.repState = { phase: 'up', count: 0, lastRepT: 0 };
  ftState.cueLast = null; ftState.cueSpokeAt = 0; ftState.report = null; ftState.lastT = 0; ftState.t0 = performance.now();
  ftState.startFrame = null; ftState.gapUntil = 0;
  $('ft-report').classList.add('hidden');
  $('ft-gate').classList.remove('hidden');
  $('ft-live').classList.remove('hidden');
  renderFtChecks({ items: [] });
  renderFtMoves();
  setFtStartBtn();
  if (demo) {
    $('ft-video').classList.add('hidden');
    $('ft-placeholder').classList.remove('hidden');
    $('ft-placeholder-text').textContent = t('ftDemoNote');
  } else {
    $('ft-video').classList.remove('hidden');
    try {
      const stream = await openCamera();
      const v = $('ft-video');
      v.srcObject = stream;
      await new Promise((res, rej) => {
        if (v.readyState >= 1) return res();
        const t0 = setTimeout(() => { v.srcObject = null; stream.getTracks().forEach((x) => x.stop()); rej(new DOMException('视频初始化超时', 'TimeoutError')); }, 6000);
        v.onloadedmetadata = () => { clearTimeout(t0); res(); };
      });
      try { await v.play(); } catch { /* ignore */ }
      ftState.stream = stream; ftState.videoOn = true;
      $('ft-placeholder').classList.add('hidden');
    } catch (e) {
      ftState.active = false; setFtStartBtn();
      $('ft-placeholder-text').textContent = cameraErrorText(e);
      return;
    }
    if (!state.landmarker) {
      const t0 = Date.now();
      $('ft-loading').innerHTML = icon('loader-spin') + '<span>' + t('loading') + ' 0s</span>';
      $('ft-loading').classList.remove('hidden');
      const tick = setInterval(() => { $('ft-loading').innerHTML = icon('loader-spin') + '<span>' + t('loading') + ' ' + Math.round((Date.now() - t0) / 1000) + 's</span>'; }, 1000);
      try { state.landmarker = await loadModel(); }
      catch (e2) { clearInterval(tick); $('ft-loading').classList.add('hidden'); ftStop(); toast(t('errUnknown', { msg: e2.message || '' })); return; }
      clearInterval(tick); $('ft-loading').classList.add('hidden');
    }
  }
  requestAnimationFrame(ftLoop);
}
function ftStop() {
  ftState.active = false;
  cancelAnimationFrame(ftState.raf);
  if (ftState.stream) { ftState.stream.getTracks().forEach((tr) => tr.stop()); ftState.stream = null; }
  const v = $('ft-video');
  if (v) { v.srcObject = null; v.classList.remove('hidden'); }
  ftState.videoOn = false;
  const c = $('ft-overlay');
  if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  const ph = $('ft-placeholder');
  if (ph) { ph.classList.remove('hidden'); $('ft-placeholder-text').textContent = t('ftPlaceholderShort'); }
  const gate = $('ft-gate'), live = $('ft-live');
  if (gate) gate.classList.add('hidden');          // v2.20.2：手动停止后收起门控与实时面板，不留过期数据
  if (live) live.classList.add('hidden');
  setFtStartBtn();
}
function ftLoop() {
  if (!ftState.active) return;
  if (state.tab !== 'ft' || document.hidden) { requestAnimationFrame(ftLoop); return; }
  const ts = performance.now();
  if (ts - ftState.lastT < 33) { requestAnimationFrame(ftLoop); return; }
  ftState.lastT = ts;
  let lms = null;
  if (ftState.demo) {
    lms = ftDemoFrame(ftState.key, ts);
  } else {
    const v = $('ft-video');
    if (!ftState.videoOn || v.readyState < 2) { requestAnimationFrame(ftLoop); return; }
    const result = state.landmarker.detectForVideo(v, ts);
    if (result.landmarks && result.landmarks.length) lms = result.landmarks[0];
  }
  const c = $('ft-overlay');
  const cw = c.clientWidth, ch = c.clientHeight;
  if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
  const ctx2 = c.getContext('2d');
  ctx2.clearRect(0, 0, cw, ch);
  if (lms) drawStick(ctx2, lms, cw, ch, !ftState.demo);
  const g = ftGate(lms);
  ftState.lastGate = g;
  renderFtChecks(g);
  if (!lms) { requestAnimationFrame(ftLoop); return; }
  if (!g.ok) { requestAnimationFrame(ftLoop); return; }
  const m = ftFrameMetrics(lms);
  if (ftState.gapUntil && ts < ftState.gapUntil) {   // v2.20.2：连测换姿势缓冲期内不采集
    $('ft-hint').textContent = t('ftNext', { name: t(FT_MOVES[ftState.key].name) }) + ' · ' + Math.max(1, Math.ceil((ftState.gapUntil - ts) / 1000));
    requestAnimationFrame(ftLoop);
    return;
  }
  if (!ftState.startFrame) ftState.startFrame = m;
  ftState.frames.push({ t: ts, ...m });
  if (ftState.frames.length > 1800) ftState.frames.shift();
  const reps = ftLiveReps(m, ts);
  renderFtLive(m, reps, FT_MOVES[ftState.key].need, ts);
  const timeout = ts - ftState.t0 > 30000;
  if (reps >= FT_MOVES[ftState.key].need || timeout) {
    if (reps >= FT_MOVES[ftState.key].need) {
      setTimeout(() => { if (ftState.active) ftFinish(ftState.key); }, 700);   // 稳定后再分析
      return;
    }
    ftFinish(ftState.key);
    return;
  }
  requestAnimationFrame(ftLoop);
}
function ftFinish(key) {
  const frames = ftState.frames.slice();
  const m = ftAnalyze(key, frames);
  const S = ftScoreMovement(key, m);
  const { sim, curve, ref } = ftSimilarity(key, frames);
  const issues = ftIssues(key, m);
  const staticSym = ftState.startFrame
    ? { headLean: ftState.startFrame.headLean, shoulderDiff: ftState.startFrame.shoulderDiff, pelvisDiff: ftState.startFrame.pelvisDiff }
    : null;
  const rec = {
    key, ts: Date.now(), demo: ftState.demo, score: S.total, dims: S, m, issues, sim,
    curve: curve || [], ref: ref || [], staticSym, battery: false, traj: m.traj || null,
  };
  ftSaveRecord(rec);
  const isBattery = ftState.mode === 'battery';
  const next = isBattery ? ftState.queue[ftState.queueIdx + 1] : null;
  if (next) {
    ftState.queueIdx++; ftState.key = next;
    ftState.frames = []; ftState.repState = { phase: 'up', count: 0, lastRepT: 0 };
    ftState.cueLast = null; ftState.cueSpokeAt = 0; ftState.t0 = performance.now(); ftState.startFrame = null;
    ftState.lastT = 0;
    ftState.gapUntil = ftState.demo ? 0 : performance.now() + 3000;   // v2.20.2：真人连测换姿势缓冲 3 秒
    renderFtMoves();
    $('ft-hint').textContent = ftState.demo ? t('ftNext', { name: t(FT_MOVES[next].name) }) : t('ftCapturing');
    requestAnimationFrame(ftLoop);
    return;
  }
  if (isBattery) {
    // 聚合 5 项为一条综合记录（六维加权 + 起始站姿静态对称性计入 20%）
    const h2 = ftHistory();
    const parts = FT_ORDER.map((k) => h2.find((r) => r.key === k)).filter(Boolean);
    const n = Math.max(1, parts.length);
    const dims = { sym: 0, align: 0, dyn: 0, stab: 0, rom: 0, cons: 0 };
    parts.forEach((r) => { dims.sym += r.dims.sym; dims.align += r.dims.align; dims.dyn += r.dims.dyn; dims.stab += r.dims.stab; dims.rom += r.dims.rom; dims.cons += r.dims.cons; });
    const st = parts[0] ? parts[0].staticSym : null;
    const symPenalty = st
      ? Math.max(0, Math.min(100, 100 - Math.max(0, (st.headLean - 12)) * 1.2 - Math.max(0, (st.shoulderDiff - 0.03)) * 200 - Math.max(0, (st.pelvisDiff - 0.03)) * 200))
      : dims.sym / n;
    const total = Math.round(0.2 * symPenalty + 0.2 * (dims.align / n) + 0.25 * (dims.dyn / n) + 0.15 * (dims.stab / n) + 0.10 * (dims.rom / n) + 0.10 * (dims.cons / n));
    ftSaveRecord({ key: 'battery', battery: true, ts: Date.now(), demo: ftState.demo, score: total, sim: Math.round(parts.reduce((a, r) => a + r.sim, 0) / n), staticSym: st, m: {} });
  }
  ftStop();
  renderFtReport(isBattery ? 'battery' : key);
  renderFtHistory();
  renderFtProfile();
  $('ft-gate').classList.add('hidden');
  $('ft-live').classList.add('hidden');
  toast(t('ftReportTitle'));
}
function ftDrawCurve(canvas, user, ref) {
  if (!canvas) return;
  const ctx2 = canvas.getContext('2d');
  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 74;
  canvas.width = w; canvas.height = h;
  ctx2.clearRect(0, 0, w, h);
  const plot = (arr, color) => {
    ctx2.strokeStyle = color; ctx2.lineWidth = 2; ctx2.beginPath();
    for (let i = 0; i < arr.length; i++) {
      const x = (i / (arr.length - 1)) * w, y = h - 6 - arr[i] * (h - 12);
      i ? ctx2.lineTo(x, y) : ctx2.moveTo(x, y);
    }
    ctx2.stroke();
  };
  if (ref) plot(ref, '#c9cdd4');
  if (user) plot(user, '#0e7c66');
}
function renderFtReport(mode, scroll = true) {
  const el = $('ft-report');
  if (!el) return;
  el.classList.remove('hidden');
  ftState.lastView = { mode };                       // 语言切换时可按此重渲染
  const h = ftHistory();
  const battery = mode === 'battery';
  const keys = battery ? FT_ORDER : [ftState.key];
  const recs = keys.map((k) => h.find((r) => r.key === k));
  const demo = recs.some((r) => r && r.demo);
  const demoBadge = demo ? `<span class="pa-demo-badge">${t('ftDemoNote')}</span>` : '';
  let body = '';
  if (battery) {
    const rec = h.find((r) => r.battery);
    const total = rec ? rec.score : 0;
    const prevBattery = h.filter((r) => r.battery)[1];
    const vsLast = prevBattery
      ? `<span class="ft-delta ${total >= prevBattery.score ? 'up' : 'down'}">${total >= prevBattery.score ? t('ftImproved', { p: Math.round((total - prevBattery.score) / Math.max(1, prevBattery.score) * 100) }) : t('ftWorse', { p: Math.round((prevBattery.score - total) / Math.max(1, prevBattery.score) * 100) })}</span>`
      : `<span class="hint tiny">${t('ftFirstTest')}</span>`;
    body += `
      <h3>${t('ftBatteryReport')}</h3>
      <div class="pa-score">
        <div class="pa-score-num">${total}</div>
        <div><div class="pa-score-grade">${t('ftScore')} ${vsLast}</div><div class="pa-score-sub">${t('ftScoreWeights')}</div></div>
      </div>
      <div class="pa-items">${keys.map((k) => {
        const r = h.find((x) => x.key === k);
        return r ? `<div class="pa-item"><div class="ft-mv-head"><span class="pa-item-name">${t(FT_MOVES[k].name)}</span><span class="ft-mv-sim">${t('ftSimilarity')} ${r.sim}%</span><span class="ft-mv-score">${r.score}</span></div><div class="pa-item-text">${r.issues.filter((i) => i.level !== 'good').slice(0, 2).map((i) => i.text).join('<br>') || t('ftNoIssue')}</div></div>`
          : `<div class="pa-item"><div class="pa-item-text">${t(FT_MOVES[k].name)} — ${t('ftMore', { n: 1 })}</div></div>`;
      }).join('')}</div>`;
  } else {
    const rec = recs[0];
    if (!rec) {
      body += `<p class="hint">${t('ftProfileNone')}</p>`;
    } else {
      const prev = h.filter((r) => r.key === rec.key && r.ts < rec.ts)[0];
      const vs = prev
        ? `<span class="ft-delta ${rec.score >= prev.score ? 'up' : 'down'}">${rec.score >= prev.score ? t('ftImproved', { p: Math.round((rec.score - prev.score) / Math.max(1, prev.score) * 100) }) : t('ftWorse', { p: Math.round((prev.score - rec.score) / Math.max(1, prev.score) * 100) })}</span>`
        : `<span class="hint tiny">${t('ftFirstTest')}</span>`;
      body += `
        <h3>${t('ftReportTitle')} · ${t(FT_MOVES[rec.key].name)}</h3>
        <div class="pa-score"><div class="pa-score-num">${rec.score}</div><div><div class="pa-score-grade">${t('ftScore')} ${vs}</div><div class="pa-score-sub">${t('ftSafety')}</div></div></div>
        ${rec.m && rec.m.reps === 0 ? `<p class="hint" style="margin-top:10px;color:#b45309">${t('ftNoReps')}</p>` : ''}
        <div class="pa-items"><h4 style="margin-bottom:8px">${t('ftMetrics')}</h4>
          ${rec.issues.map((i) => `
            <div class="pa-item">
              <div class="pa-item-head"><span class="pa-lv ${i.level}">${t(i.level === 'good' ? 'paGood' : i.level === 'warn' ? 'paWarn' : 'paBad')}</span><span class="pa-item-name">${i.label}</span><span class="pa-item-val">${i.val}</span></div>
              <div class="pa-item-text">${i.text}</div>
              ${i.advice ? `<div class="pa-item-advice"><b>${t('paAdvice')}</b>：${i.advice}</div>` : ''}
              ${prev && i.level !== 'good' ? ftDeltaHtml(prev.m, rec.m, i) : ''}
            </div>`).join('')}
        </div>`;
      if (rec.sim) {
        const simGrade = rec.sim >= 85 ? 'A' : rec.sim >= 70 ? 'B' : rec.sim >= 55 ? 'C' : 'D';
        body += `<div class="ft-sim"><div class="ft-sim-head"><span>${t('ftSimilarity')}</span><b>${rec.sim}% · ${t('paGrade' + simGrade)}</b></div><canvas class="ft-curve" id="ft-curve"></canvas>
          <div class="hint tiny" style="margin-top:4px">${t('ftLegendYou')} <span style="color:#0e7c66;font-weight:800">——</span> · ${t('ftLegendStd')} <span style="color:#c9cdd4;font-weight:800">- -</span></div></div>`;
      }
      if (rec.traj && rec.traj.length) {
        body += `<div class="ft-sim"><div class="ft-sim-head"><span>${t('ftTrajTitle')}</span></div><canvas class="ft-traj" id="ft-traj"></canvas>
          <div class="hint tiny" style="margin-top:4px">${t('ftLegendYou')} <span style="color:#0e7c66;font-weight:800">——</span> · ${t('ftLegendStd')} <span style="color:#c9cdd4;font-weight:800">- -</span></div></div>`;
      }
    }
  }
  // 知识库处方（聚合所有非良好问题的 kb，去重）
  const allIssues = recs.flatMap((r) => (r ? r.issues : [])).filter((i) => i.level !== 'good');
  const kbIds = [...new Set(allIssues.map((i) => i.kb))].filter((id) => FT_KB[id]);
  if (kbIds.length) {
    body += `<div class="ft-presc"><h4>${t('ftPrescTitle')}</h4>` + kbIds.map((id) => {
      const kb = FT_KB[id];
      return `<div class="ft-presc-item">
        <div class="ft-presc-prob">${t(kb.problem)}</div>
        <div class="ft-presc-row"><b>${t('ftPrescFactors')}</b>：${t(kb.factor)}</div>
        <div class="ft-presc-row"><b>${t('ftPrescEx')}</b></div>
        <div class="ft-ex-list">${kb.ex.map((e) => `<div class="ft-ex"><b>${t(e)}</b><span>${t(e + 'N')}</span></div>`).join('')}</div>
        <div class="ft-presc-row"><b>${t('ftPrescCaution')}</b>：${t(kb.caution)}</div>
        <div class="ft-presc-row"><b>${t('ftPrescRetest')}</b>：${t('ftRetestCommon')}</div>
      </div>`;
    }).join('') + `</div>`;
  } else {
    body += `<p class="hint" style="margin-top:12px">${t('ftNoIssue')}</p>`;
  }
  el.innerHTML = demoBadge + body + `<div class="controls" style="margin-top:12px"><button class="btn" id="btn-ft-guide"><span>${t('ftGoGuide')}</span></button><button class="btn" id="btn-ft-redo"><span>${t('ftAgain')}</span></button></div>`;
  $('btn-ft-guide').addEventListener('click', () => { switchTab('guide'); });
  $('btn-ft-redo').addEventListener('click', () => { el.classList.add('hidden'); ftStart(mode === 'battery' ? 'battery' : ftState.key, false); });
  const cv = $('ft-curve');
  if (cv) {
    const r = recs[0];
    if (r && r.curve && r.curve.length) ftDrawCurve(cv, r.curve, r.ref || []);
  }
  const tv = $('ft-traj');
  if (tv) {
    const r = recs[0];
    if (r && r.traj && r.traj.length) ftDrawTraj(tv, r.traj, ftRefTraj(r.key));
  }
  if (scroll) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function ftDeltaHtml(prevM, m, issue) {
  const map = { [t('ftMetricDepth')]: 'depth', [t('ftMetricSym')]: 'asym', [t('ftMetricValgus')]: 'valgus', [t('ftMetricTrunk')]: 'trunkLean', [t('ftMetricSpeed')]: 'downSec', [t('ftMetricStab')]: 'stab', [t('ftMetricCons')]: 'cons', [t('ftMetricRom')]: 'rom', [t('ftMetricRaise')]: 'raise', [t('ftMetricCenter')]: 'center', [t('ftMetricKneeExt')]: 'kneeExt' };
  const metric = map[issue.label];
  if (!metric) return '';
  const d = ftDelta(prevM, m, metric);
  if (!d) return '';
  return `<div class="pa-item-advice" style="color:#b45309"><b>${t('ftVsLast')}</b>：${d.better ? t('ftImproved', { p: d.pct }) : t('ftWorse', { p: d.pct })}</div>`;
}
function renderFtMoves() {
  const el = $('ft-moves');
  if (!el) return;
  el.innerHTML = Object.entries(FT_MOVES).map(([k, mv]) => `
    <button class="pa-kind ${ftState.key === k && ftState.mode === 'single' ? 'on' : ''}" data-ft="${k}">
      <span class="pa-kind-ico">${icon(k === 'arm' ? 'shoulderraise' : k === 'bend' ? 'hiphinge' : k === 'lunge' ? 'lunge' : k === 'single' ? 'standing' : 'squat')}</span>
      <span>${t(mv.name)}</span>
    </button>`).join('');
  el.querySelectorAll('[data-ft]').forEach((b) => b.addEventListener('click', () => {
    ftState.key = b.dataset.ft; ftState.mode = 'single';
    $('ft-report').classList.add('hidden');
    renderFtMoves();
  }));
  $('ft-guide').textContent = t(FT_MOVES[ftState.key].guide) + '（' + t('ftTargetN', { n: FT_MOVES[ftState.key].need }) + '）';
  const batBtn = $('btn-ft-battery');
  if (batBtn) batBtn.classList.toggle('on', ftState.mode === 'battery' && ftState.active);
}
function renderFtHistory() {
  const el = $('ft-history');
  if (!el) return;
  const h = ftHistory();
  if (!h.length) { el.innerHTML = `<div class="empty">${icon('record')}<span>${t('ftProfileNone')}</span></div>`; return; }
  el.innerHTML = h.slice(0, 12).map((r) => {
    const when = new Date(r.ts);
    const date = when.toLocaleDateString(locale(), { month: 'numeric', day: 'numeric' }) + ' ' + when.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    return `<div class="item">
      <div class="t">${icon('record')}${r.battery ? t('ftBatteryReport') : t(FT_MOVES[r.key].name)}${r.demo ? ' · ' + t('ftBtnDemo') : ''} — ${date}</div>
      <div class="d">${t('ftScore')} ${r.score} · ${t('ftSimilarity')} ${r.sim}%${r.m ? ' · ' + t('ftRepsDone', { n: r.m.reps, m: r.m.need }) : ''}</div>
      <div class="controls" style="margin-top:6px"><button class="btn small" data-ft-view="${r.ts}"><span>${t('ftView')}</span></button></div>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-ft-view]').forEach((b) => b.addEventListener('click', () => {
    const r = ftHistory().find((x) => String(x.ts) === b.dataset.ftView);
    if (r) { ftState.key = r.key; renderFtReport(r.battery ? 'battery' : r.key); }
  }));
}
function renderFtProfile() {
  const el = $('ft-profile');
  if (!el) return;
  const h = ftHistory();
  if (!h.length) { el.innerHTML = `<p class="hint">${t('ftProfileNone')}</p>`; return; }
  const battery = h.find((r) => r.battery);
  const last = battery || h[0];
  const when = new Date(last.ts);
  const date = when.toLocaleDateString(locale(), { month: 'numeric', day: 'numeric' });
  const sessions = sget('rehab_sessions', []).length;
  const rows = FT_ORDER.map((k) => {
    const r = h.find((x) => x.key === k);
    if (!r) return null;
    const m = r.m;
    const val = k === 'arm' ? (m.raise ? '↑' + m.raise.toFixed(2) : '—') : k === 'bend' ? (m.flexion ? m.flexion.toFixed(0) + '°' : '—') : (m.depth ? m.depth.toFixed(0) + '°' : '—');
    const asym = k === 'arm' ? m.asym.toFixed(2) : k === 'bend' ? m.center.toFixed(2) : m.asym ? m.asym.toFixed(0) + '%' : '—';
    return `<tr><td>${t(FT_MOVES[k].name)}</td><td class="num">${r.score}</td><td class="num">${val}</td><td class="num">${asym}</td><td class="num">${r.sim}%</td></tr>`;
  }).filter(Boolean).join('');
  el.innerHTML = `
    <div class="ft-profile-last">
      <div class="ft-profile-score">${last.score}</div>
      <div class="ft-profile-meta">
        <b>${t('ftProfileLast')}</b>：${date}（${last.battery ? t('ftBatteryReport') : t(FT_MOVES[last.key].name)}）<br>
        ${t('navRecord')}：${sessions} · ${t('ftSafety')}
      </div>
    </div>
    <table class="ft-table">
      <tr><th>${t('ftMetrics')}</th><th class="num">${t('ftScore')}</th><th class="num">${t('ftProfileRom')}</th><th class="num">${t('ftProfileAsym')}</th><th class="num">${t('ftSimilarity')}</th></tr>
      ${rows}
    </table>`;
}
function renderFtUI() {
  renderFtMoves();
  if (ftState.active && ftState.lastGate) renderFtChecks(ftState.lastGate);
  if (ftState.lastView && !$('ft-report').classList.contains('hidden')) renderFtReport(ftState.lastView.mode, false);   // 语言切换时刷新可见报告
  renderFtHistory();
  renderFtProfile();
  setFtStartBtn();
}
// 演示模式：按动作合成整段运动（含轻度缺陷：右腿浅 12° + 轻微内扣），走与真实一致的管线
function ftDemoFrame(key, ts) {
  const tSec = ts / 1000;
  const mk = (x, y, vis = 1) => ({ x, y, z: 0, visibility: vis });
  const lms = new Array(33).fill(null);
  const set = (i, x, y) => { lms[i] = mk(x, y); };
  const fill = () => { for (let i = 0; i < 33; i++) if (!lms[i]) lms[i] = mk(0.5, 0.5, 0); };
  const cycle = { squat: 4.2, lunge: 4.2, single: 5.0, arm: 3.2, bend: 5.5 }[key];
  const ph = (tSec % cycle) / cycle;
  const curve = (x0, x1, hold, a, b) => (ph < x0) ? a : (ph < x0 + hold) ? a + (b - a) * Math.sin(((ph - x0) / hold) * Math.PI / 2) : (ph < x1) ? b : (ph < x1 + hold) ? b + (a - b) * Math.sin(((ph - x1) / hold) * Math.PI / 2) : a;
  let kneeL = 172, kneeR = 172, raise = 0.02, bendAng = 172;
  if (key === 'squat' || key === 'lunge' || key === 'single') {
    kneeL = curve(0.12, 0.55, 0.14, 172, key === 'single' ? 108 : 96);
    kneeR = curve(0.12, 0.55, 0.14, 172, key === 'single' ? 172 : 108);   // 右腿浅 → 不对称 ~12%
  } else if (key === 'arm') {
    raise = curve(0.12, 0.55, 0.14, 0.02, 0.26);
  } else {
    bendAng = curve(0.12, 0.55, 0.16, 172, 88);
  }
  const bendRad = ((180 - bendAng) * Math.PI) / 180;                       // 前屈角（0=直立）
  const kneeOf = (hipX, ankleX, angDeg) => {                               // 由膝角反推膝位置（等腰三角形垂距）
    const H = { x: hipX, y: 0.52 }, A = { x: ankleX, y: 0.87 };
    const mx = (H.x + A.x) / 2, my = (H.y + A.y) / 2, l = Math.hypot(H.x - A.x, H.y - A.y);
    const d = Math.max(0, Math.min(0.20, (l / 2) / Math.tan((angDeg * Math.PI) / 360)));
    return { x: mx + d, y: my };
  };
  const kL = kneeOf(0.44, 0.46, kneeL), kR = kneeOf(0.56, 0.54, kneeR);
  const valgusShift = kneeL < 130 ? 0.02 : 0;                              // 底部轻微内扣
  const shX = 0.5 + 0.23 * Math.sin(bendRad);
  const shY = 0.52 - 0.23 * Math.cos(bendRad);
  set(0, shX + 0.09 * Math.sin(bendRad), shY - 0.09 * Math.cos(bendRad));
  set(11, shX - 0.09, shY); set(12, shX + 0.09, shY);
  set(13, shX - 0.11, shY - raise * 0.55 + (1 - Math.cos(bendRad)) * 0.1);
  set(14, shX + 0.11, shY - raise * 0.55 + (1 - Math.cos(bendRad)) * 0.1);
  set(15, shX - 0.10, shY - raise); set(16, shX + 0.10, shY - raise);
  set(23, 0.44, 0.52); set(24, 0.56, 0.52);
  set(25, kL.x + valgusShift, kL.y); set(26, kR.x - valgusShift, kR.y);
  set(27, 0.46, 0.87); set(28, 0.54, 0.87);
  if (key === 'single') {          // v2.20.2：单腿蹲演示须抬起右腿，否则过不了「姿势到位」门控
    set(28, 0.545, 0.80);
    set(26, 0.55, 0.70);
  }
  fill();
  return lms;
}

/* ============ 新增功能（v2.21）：今日总览 + AI 跟练 + 动作轨迹（对标 Tonal 分数体系/课程、Tempo 轨迹回放） ============ */
// 全部纯新增：不修改旧功能；跟练完成后写入标准 rehab_sessions 记录，自动流入旧有的记录/趋势/成就（数据级串联，旧代码零改动）
const GW_PROGRAMS = {
  knee: {
    name: 'gwKnee', desc: 'gwKneeD', mins: 10, tag: 'knee',
    steps: [
      { name: 'gwStepSquat', icon: 'squat', sets: 3, reps: 10, rest: 30, metro: true, cue: 'gwCueKnee' },
      { name: 'gwStepLunge', icon: 'lunge', sets: 2, reps: 8, rest: 30, metro: true, cue: 'gwCueLunge' },
      { name: 'gwStepWallSit', icon: 'wallsit', sets: 3, hold: 30, rest: 30, metro: false, cue: 'gwCueWall' },
    ],
  },
  posture: {
    name: 'gwPosture', desc: 'gwPostureD', mins: 8, tag: 'posture',
    steps: [
      { name: 'gwStepPlank', icon: 'plank', sets: 3, hold: 30, rest: 25, metro: false, cue: 'gwCuePlank' },
      { name: 'gwStepRaise', icon: 'shoulderraise', sets: 3, reps: 10, rest: 25, metro: true, cue: 'gwCueRaise' },
      { name: 'gwStepBend', icon: 'bend', sets: 2, reps: 8, rest: 25, metro: true, cue: 'gwCueBend' },
    ],
  },
  full: {
    name: 'gwFull', desc: 'gwFullD', mins: 12, tag: 'fitness',
    steps: [
      { name: 'gwStepSquat', icon: 'squat', sets: 3, reps: 12, rest: 30, metro: true, cue: 'gwCueKnee' },
      { name: 'gwStepStepUp', icon: 'stepup', sets: 2, reps: 10, rest: 30, metro: true, cue: 'gwCueStep' },
      { name: 'gwStepHinge', icon: 'hiphinge', sets: 3, reps: 10, rest: 30, metro: true, cue: 'gwCueHinge' },
      { name: 'gwStepBridge', icon: 'bridge', sets: 3, reps: 12, rest: 30, metro: true, cue: 'gwCueBridge' },
    ],
  },
};
const gwState = {
  active: false, progId: null, stepIdx: 0, setIdx: 0, phase: 'idle',
  repN: 0, holdLeft: 0, restLeft: 0, prepLeft: 0, metroTick: 0, metroDown: true,
  repsTotal: 0, startedAt: 0, tick: null, level: 1, beepCtx: null,
  stepReps: 0, lastDone: null,
};
const gwLevel = () => { const ftB = ftHistory().find((r) => r.battery); const s = ftB ? ftB.score : null; return s == null ? 1 : s >= 75 ? 2 : 1; };
// v2.21.2：难度真正生效——进阶（白银+）每节次数 +2，保持类动作时长不变
const gwStepReps = (step, level) => (step.reps ? step.reps + (level - 1) * 2 : step.hold);
const gwCalcIndex = (paS, ftS, consist) => {
  const parts = [];
  if (paS != null) parts.push({ w: 0.3, v: paS });
  if (ftS != null) parts.push({ w: 0.3, v: ftS });
  parts.push({ w: 0.4, v: consist });
  const totW = parts.reduce((a, p) => a + p.w, 0);
  return totW ? Math.round(parts.reduce((a, p) => a + p.w * p.v, 0) / totW) : null;
};
function gwMakeSession(prog, reps, durSec) {
  return { id: 'gw' + Date.now(), ts: Date.now(), ex: 'guided', exName: t(prog.name), reps, dur: durSec, depth: 'ok', badPct: 0 };
}
function gwBeepInit() {
  try { if (!gwState.beepCtx) gwState.beepCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* ignore */ }
}
function gwBeep(freq = 880) {
  const ctx = gwState.beepCtx;
  if (!ctx) return;
  try {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.1);
  } catch { /* ignore */ }
}
function gwStart(progId) {
  if (gwState.active) { gwStop(); return; }
  const prog = GW_PROGRAMS[progId];
  if (!prog) return;
  ensureAudio();
  gwState.active = true; gwState.progId = progId;
  gwState.phase = 'prep';
  gwState.stepIdx = 0; gwState.setIdx = 0; gwState.repN = 0;
  gwState.holdLeft = 0; gwState.restLeft = 0; gwState.prepLeft = 3; gwState.metroTick = 0;
  gwState.repsTotal = 0; gwState.startedAt = performance.now(); gwState.level = gwLevel();
  gwState.lastDone = null;
  gwState.stepReps = gwStepReps(prog.steps[0], gwState.level);
  gwBeepInit();
  speak(t('gwStepOf', { s: 1, S: prog.steps.length }) + ' · ' + t(prog.steps[0].name));
  renderGuide();
  gwState.tick = setInterval(gwTick, 1000);
}
function gwTick() {
  const st = gwState;
  const prog = GW_PROGRAMS[st.progId];
  const step = prog.steps[st.stepIdx];
  if (st.phase === 'prep') {
    st.prepLeft--;
    if (st.prepLeft <= 0) {
      st.phase = step.hold ? 'hold' : 'rep';
      st.holdLeft = step.hold || 0;
      if (step.hold) speak(t('gwHold', { n: step.hold })); else speak(t('gwGo'));
    }
  } else if (st.phase === 'rep') {
    st.metroTick++;
    if (st.metroTick % 2 === 1) {
      st.metroDown = !st.metroDown;
      if (step.metro) gwBeep(st.metroDown ? 660 : 880);
      if (!st.metroDown) {
        st.repN++; st.repsTotal++;
        if (st.repN % 5 === 0 || st.repN >= st.stepReps) speak(t('gwRep', { n: st.repN, m: st.stepReps }));
      }
    }
    if (st.repN >= st.stepReps) {
      st.setIdx++; st.repN = 0; st.metroTick = 0; st.phase = 'rest'; st.restLeft = step.rest;
      speak(t('gwRest', { n: step.rest }));
    }
  } else if (st.phase === 'hold') {
    st.holdLeft--;
    if (st.holdLeft > 0 && st.holdLeft % 10 === 0) gwBeep(1040);
    if (st.holdLeft <= 0) {
      st.repsTotal++; st.setIdx++; st.phase = 'rest'; st.restLeft = step.rest;
      gwBeep(880); speak(t('gwRest', { n: step.rest }));
    }
  } else if (st.phase === 'rest') {
    st.restLeft--;
    if (st.restLeft <= 0) {
      gwBeep(1320);   // 休息结束提示音
      if (st.setIdx >= step.sets) {
        st.setIdx = 0; st.stepIdx++;
        if (st.stepIdx >= prog.steps.length) { gwFinish(true); return; }
        st.phase = 'prep'; st.prepLeft = 3;
        st.stepReps = gwStepReps(prog.steps[st.stepIdx], st.level);
        speak(t('gwStepOf', { s: st.stepIdx + 1, S: prog.steps.length }) + ' · ' + t(prog.steps[st.stepIdx].name));
      } else {
        st.phase = 'prep'; st.prepLeft = 3;
        speak(t('gwGo'));
      }
    }
  }
  renderGuide();
}
function gwTap() {   // 手动 +1（自动计数不准时用手点）
  if (!gwState.active || gwState.phase !== 'rep') return;
  gwState.repN++; gwState.repsTotal++;
  if (gwState.repN >= gwState.stepReps) {
    gwState.setIdx++; gwState.repN = 0; gwState.phase = 'rest';
    const step = GW_PROGRAMS[gwState.progId].steps[gwState.stepIdx];
    gwState.restLeft = step.rest; speak(t('gwRest', { n: step.rest }));
  }
  renderGuide();
}
function gwStop() {
  if (gwState.tick) { clearInterval(gwState.tick); gwState.tick = null; }
  gwState.active = false; gwState.phase = 'idle';
  renderGuide();
}
function gwFinish(completed) {
  const prog = GW_PROGRAMS[gwState.progId];
  const durSec = Math.round((performance.now() - gwState.startedAt) / 1000);
  const reps = gwState.repsTotal;
  if (gwState.tick) { clearInterval(gwState.tick); gwState.tick = null; }
  gwState.active = false; gwState.phase = 'idle';
  if (reps > 0) {
    const rec = gwMakeSession(prog, reps, durSec);
    sset('rehab_sessions', [rec, ...sget('rehab_sessions', [])]);   // 写入标准训练记录：自动流入记录/趋势/成就/热力图
  }
  gwState.lastDone = { completed, progId: gwState.progId, reps, durSec };
  renderGuide();
  if (completed) { renderRecords(); renderHome(); gwBeep(1320); setTimeout(() => gwBeep(1760), 160); toast(t('gwSessionSaved')); }
  else { renderHome(); toast(t('gwFinishEarly')); }
}
function renderGuide() {
  const listEl = $('gw-list');
  const activeEl = $('gw-active');
  const stageEl = $('gw-stage');
  if (!listEl) return;
  renderDemos();   // v2.34.0：示范墙随语言与状态刷新
  if (!gwState.active) {
    const wk = new Date(); wk.setHours(0, 0, 0, 0); wk.setDate(wk.getDate() - 6);
    const gwWeek = sget('rehab_sessions', []).filter((s) => s.ex === 'guided' && new Date(s.ts) >= wk).length;
    let doneCard = '';
    if (gwState.lastDone) {
      const d = gwState.lastDone;
      doneCard = `
      <div class="gw-done">
        <div class="gw-done-ico">${icon(d.completed ? 'check' : 'stop')}</div>
        <div style="flex:1;min-width:0">
          <div class="gw-card-name">${d.completed ? t('gwDone') : t('gwFinishEarly')}</div>
          <div class="gw-card-desc">${t('gwComplete', { n: d.reps, m: Math.max(1, Math.round(d.durSec / 60)) })}${d.reps > 0 ? ' · ' + t('gwSavedCard') : ''}</div>
        </div>
      </div>
      <div class="controls" style="margin-top:8px">
        <button class="btn small" id="gw-again"><span>${t('gwAgain2')}</span></button>
        <button class="btn small" id="gw-home"><span>${t('gwBackHome')}</span></button>
      </div>`;
    }
    const cards = Object.entries(GW_PROGRAMS).map(([id, p]) => {
      const sets = p.steps.reduce((a, s) => a + s.sets, 0);
      return `<div class="gw-card">
        <div class="gw-card-head">
          <span class="gw-card-ico">${icon(p.steps[0].icon)}</span>
          <div style="flex:1;min-width:0">
            <div class="gw-card-name">${t(p.name)}</div>
            <div class="gw-card-desc">${t(p.desc)}<br>${p.steps.length} ${t('gwSections')} · ${sets} ${t('gwSets')}</div>
          </div>
          <span class="hm-lv">${t('gwLv' + gwLevel())}</span>
        </div>
        <div class="controls"><button class="btn primary small" data-gw="${id}"><span>${t('gwStartBtn')}</span></button></div>
      </div>`;
    }).join('');
    listEl.innerHTML = (gwWeek ? `<div class="hint tiny" style="margin:0 0 8px">${t('gwBanner', { n: gwWeek })}</div>` : '') + doneCard + cards;
    listEl.querySelectorAll('[data-gw]').forEach((b) => b.addEventListener('click', () => gwStart(b.dataset.gw)));
    const againBtn = $('gw-again');
    if (againBtn) againBtn.addEventListener('click', () => gwStart(gwState.lastDone.progId));
    const homeBtn = $('gw-home');
    if (homeBtn) homeBtn.addEventListener('click', () => switchTab('home'));
    activeEl.classList.add('hidden');
    return;
  }
  listEl.innerHTML = '';
  activeEl.classList.remove('hidden');
  const prog = GW_PROGRAMS[gwState.progId];
  const step = prog.steps[gwState.stepIdx];
  let big, sub, barPct;
  if (gwState.phase === 'prep') { big = gwState.prepLeft > 0 ? gwState.prepLeft : t('gwGo'); sub = `${t('gwPrep')} · ${t(step.name)}`; barPct = 0; }
  else if (gwState.phase === 'rep') { big = gwState.repN + '/' + gwState.stepReps; sub = `${t('gwSet', { s: gwState.setIdx + 1, S: step.sets })} · ${gwState.metroDown ? t('gwDown') : t('gwUp')}`; barPct = (100 * gwState.repN / Math.max(1, gwState.stepReps)).toFixed(0); }
  else if (gwState.phase === 'hold') { big = gwState.holdLeft; sub = `${t('gwSet', { s: gwState.setIdx + 1, S: step.sets })} · ${t('gwHold', { n: step.hold })}`; barPct = (100 * (1 - gwState.holdLeft / Math.max(1, step.hold))).toFixed(0); }
  else { big = gwState.restLeft; sub = t('gwRest', { n: step.rest }); barPct = (100 * (1 - gwState.restLeft / Math.max(1, step.rest))).toFixed(0); }
  const dots = prog.steps.map((s, i) => `<span class="gw-dot ${i === gwState.stepIdx ? 'on' : ''} ${i < gwState.stepIdx ? 'done' : ''}"></span>`).join('');
  stageEl.innerHTML = `
    <div class="gw-set-line">${t(prog.name)} · ${t('gwLevel')}：${t('gwLv' + gwState.level)}</div>
    <div class="gw-dots">${dots}</div>
    <div class="gw-step-name">${icon(step.icon)} ${t(step.name)}<span class="gw-set-line" style="display:block">${t('gwStepOf', { s: gwState.stepIdx + 1, S: prog.steps.length })}</span></div>
    ${hasDemo(step.icon) ? '<div class="gw-stepdemo" id="gw-step-demo">' + figureSvg(step.icon, { pose: demoPose(step.icon, gwState.phase === 'rest' ? 0 : 0.5), w: 190, h: 178 }) + '<button class="btn small" id="gw-step-look">' + t('dmbLook') + '</button></div>' : ''}
    <div class="gw-big">${big}</div>
    <div class="gw-set-line">${sub}</div>
    <div class="gw-bar"><div class="gw-bar-fill" style="width:${barPct}%"></div></div>
    <span class="gw-pulse ${gwState.metroDown ? '' : 'down'}"></span>
    <div class="gw-cue">${t(step.cue)}</div>
    <div class="controls">
      <button class="btn" id="btn-gw-stop"><span>${t('gwStop')}</span></button>
      <button class="gw-btn-big" id="btn-gw-tap"><span>+1</span></button>
    </div>
    <p class="hint tiny" data-i18n="gwTap">点一下 +1（自动计数不准时用手点）</p>`;
  $('btn-gw-stop').addEventListener('click', () => gwFinish(false));
  $('btn-gw-tap').addEventListener('click', gwTap);
  const gsl = $('gw-step-look');
  if (gsl) gsl.addEventListener('click', () => openDemo(step.icon));   // v2.34.0：边练边看标准示范
}

/* ---- 今日总览：综合运动指数（体态 30% + 功能 30% + 坚持 40%）+ 恢复建议 + 热力图 + 周小结 ---- */
function homeIndex() {
  const pa = paHistory()[0];
  const ftB = ftHistory().find((r) => r.battery) || ftHistory()[0];
  const sessions = sget('rehab_sessions', []);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const from = new Date(today); from.setDate(from.getDate() - 29);
  const days30 = new Set(sessions.filter((s) => new Date(s.ts) >= from).map((s) => new Date(s.ts).toDateString())).size;
  const consist = Math.min(100, Math.round(days30 / 12 * 100));
  const score = gwCalcIndex(pa ? pa.score : null, ftB ? ftB.score : null, consist);
  const level = score == null ? null : score >= 90 ? 4 : score >= 75 ? 3 : score >= 60 ? 2 : 1;
  return { score, level, pa: pa ? pa.score : null, ft: ftB ? ftB.score : null, consist, days30 };
}
function homeIndexHist() { return sget('rehab_home_idx', []); }
function homeRecordIndex(score) {
  const h = homeIndexHist();
  const k = todayKeyStr();
  if (h.length && h[0].d === k) h[0].v = score;
  else { h.unshift({ d: k, v: score }); if (h.length > 30) h.length = 30; }
  sset('rehab_home_idx', h);
}
function homeAdvice(idx) {
  const sessions = sget('rehab_sessions', []);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const trainedToday = sessions.some((s) => new Date(s.ts) >= today);
  if (trainedToday) return { text: t('gwAdvDone'), action: null };
  if (idx.score == null) return { text: t('gwAdvFirst'), action: 'posture' };
  const last = sessions.reduce((m, s) => Math.max(m, s.ts), 0);
  const daysSince = last ? Math.floor((today.getTime() - new Date(new Date(last).toDateString()).getTime()) / 86400000) : 99;
  if (daysSince >= 2) return { text: t('gwAdvRest', { d: daysSince }), action: 'guide' };
  if (idx.score < 60) return { text: t('gwAdvLight'), action: 'guide' };
  return { text: t('gwAdvGo'), action: 'train' };
}
function renderHome() {
  const el = $('home-index');
  if (!el) return;
  const raw = homeIndex();
  // v2.21.9：完全没有数据时（新装 App / 刚「清除全部数据」）按无数据态渲染，
  // 既不显示 0 分卡，也不写入一条空的指数历史（原来清空后会被立刻写回）
  const idx = (raw.pa == null && raw.ft == null && raw.days30 === 0) ? { ...raw, score: null } : raw;
  const advice = homeAdvice(idx);
  if (idx.score == null) {
    el.innerHTML = `
      <p class="hint">${t('homeIndexNone')}</p>
      <div class="controls" style="margin-top:10px">
        <button class="btn small" id="hm-posture"><span>${t('homeQuickPosture')}</span></button>
        <button class="btn small" id="hm-ft"><span>${t('homeQuickFt')}</span></button>
      </div>`;
    $('hm-posture').addEventListener('click', () => switchTab('posture'));
    $('hm-ft').addEventListener('click', () => switchTab('ft'));
  } else {
    homeRecordIndex(idx.score);
    const h = homeIndexHist();
    const prev = h.length > 1 ? h[1] : null;
    const delta = prev ? idx.score - prev.v : null;
    const nextLv = idx.level >= 4 ? null : idx.level + 1;
    const nextThreshold = [0, 60, 75, 90][nextLv] ?? null;
    const toNext = nextLv && nextThreshold != null ? Math.max(1, nextThreshold - idx.score) : null;
    el.innerHTML = `
      <div class="hm-index">
        <div class="hm-score">${idx.score}</div>
        <div>
          <span class="hm-lv">${t('homeLevel')} · ${t('gwLv' + idx.level)}</span>
          ${delta != null ? `<span class="hm-lv" style="margin-left:6px;background:rgba(245,158,11,.15);color:#b45309">${t('homeIdxTrend', { v: delta >= 0 ? t('homeUp', { d: delta }) : t('homeDown', { d: -delta }) })}</span>` : ''}
          <div class="hm-parts">
            ${idx.pa != null ? `<div class="hm-part"><span>${t('paTitle')}</span><b>${idx.pa}</b><div class="hm-bar"><div class="hm-bar-fill" style="width:${idx.pa}%"></div></div></div>` : ''}
            ${idx.ft != null ? `<div class="hm-part"><span>${t('ftTitle')}</span><b>${idx.ft}</b><div class="hm-bar"><div class="hm-bar-fill" style="width:${idx.ft}%"></div></div></div>` : ''}
            <div class="hm-part"><span>${t('homeConsist')}</span><b>${t('homeDays', { d: idx.days30 })}</b><div class="hm-bar"><div class="hm-bar-fill" style="width:${idx.consist}%"></div></div></div>
          </div>
          ${toNext ? `<div class="hint tiny" style="margin-top:6px">${t('homeToNext', { l: t('gwLv' + nextLv), d: toNext })}</div>` : ''}
        </div>
      </div>
      <div class="hm-advice">💡 ${advice.text}${advice.action ? ` <a class="link-btn" id="hm-adv-btn" style="margin-left:6px">${advice.action === 'guide' ? t('homeAdvGuideBtn') : advice.action === 'train' ? t('homeAdvGoBtn') : t('homeQuickPosture')} →</a>` : ''}</div>`;
    if (advice.action) {
      $('hm-adv-btn').addEventListener('click', () => switchTab(advice.action === 'posture' ? 'posture' : advice.action));
    }
  }
  // 今日任务：与日程页同一数据源（planForToday + 按 p.ex 打卡），可一键完成
  const todays = planForToday();
  const doneArr = planDoneGet()[todayKeyStr()] || [];
  const listEl = $('home-today');
  if (!todays.length) {
    listEl.innerHTML = `
      <div class="empty">${icon('schedule')}<span>${t('homeTodayNone')}</span></div>
      <div class="controls" style="margin-top:10px">
        <button class="btn small" id="hm-sched"><span>${t('navSchedule')} →</span></button>
        <button class="btn small" id="hm-guide2"><span>${t('navGuide')} →</span></button>
      </div>`;
    $('hm-sched').addEventListener('click', () => switchTab('schedule'));
    $('hm-guide2').addEventListener('click', () => switchTab('guide'));
  } else {
    const doneCount = todays.filter((p) => doneArr.includes(p.ex)).length;
    listEl.innerHTML = todays.slice(0, 5).map((p) => {
      const e = getEx(p.ex);
      const isDone = doneArr.includes(p.ex);
      return `<div class="item">
        <button class="todo-check ${isDone ? 'on' : ''}" data-hex="${p.ex}">${isDone ? icon('check') : ''}</button>
        <div style="flex:1"><div class="t"><span class="t-ico">${icon(e ? e.icon : 'custom')}</span>${e ? exName(e) : p.ex} · ${t('repsN', { n: p.reps })}</div></div>
      </div>`;
    }).join('') + `<div class="plan-progress">
      <div class="plan-progress-txt">${t('planProgress', { d: doneCount, t: todays.length })}</div>
      <div class="plan-bar"><div class="plan-fill" style="width:${(100 * doneCount / todays.length).toFixed(0)}%"></div></div>
    </div>`;
    listEl.querySelectorAll('.todo-check').forEach((b) => b.addEventListener('click', () => {
      togglePlanDone(b.dataset.hex);   // 旧函数只调用不修改：写计划完成 + 刷新旧日程页
      renderHome();                    // 刷新今日页自身
    }));
  }
  // 30 天热力图 + 汇总
  const sessions = sget('rehab_sessions', []);
  const counts = {};
  sessions.forEach((s) => { const k = new Date(s.ts).toDateString(); counts[k] = (counts[k] || 0) + 1; });
  const cells = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const k = d.toDateString();
    const n = counts[k] || 0;
    const lvl = n >= 3 ? 3 : n >= 2 ? 2 : n >= 1 ? 1 : 0;
    cells.push(`<div class="hm-cell hm${lvl}${i === 0 ? ' today' : ''}" title="${d.toLocaleDateString(locale())} · ${n}"></div>`);
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const from30 = new Date(today); from30.setDate(from30.getDate() - 29);
  const d30 = new Set(sessions.filter((s) => new Date(s.ts) >= from30).map((s) => new Date(s.ts).toDateString())).size;
  const wkStart = new Date(today); wkStart.setDate(wkStart.getDate() - 6);
  const d7 = new Set(sessions.filter((s) => new Date(s.ts) >= wkStart).map((s) => new Date(s.ts).toDateString())).size;
  $('home-heat').innerHTML = cells.join('') + `<div class="hint tiny" style="margin-top:6px">${t('homeHeatSum', { d30, d7 })}</div>`;
  // 本周小结 + 上周对比 + 风险
  const weekS = sessions.filter((s) => new Date(s.ts) >= wkStart);
  const rTotal = weekS.reduce((a, s) => a + (s.reps || 0), 0);
  const qAvg = weekS.length ? Math.round(100 - weekS.reduce((a, s) => a + (s.badPct || 0), 0) / weekS.length) : null;
  const riskN = weekS.reduce((a, s) => a + ((s.riskPct || 0) > 0 ? 1 : 0), 0);
  const wkPrevStart = new Date(wkStart); wkPrevStart.setDate(wkPrevStart.getDate() - 7);
  const weekPrev = sessions.filter((s) => new Date(s.ts) >= wkPrevStart && new Date(s.ts) < wkStart).length;
  const deltaW = weekS.length - weekPrev;
  $('home-week').innerHTML = weekS.length
    ? `<div class="summary-line">${t('homeWeekLine', { n: weekS.length, r: rTotal, q: qAvg })}${riskN ? ' · ' + t('homeRisk', { n: riskN }) : ''}
        <span class="hint tiny" style="display:block">${t('homeWeekDelta', { v: (deltaW >= 0 ? '+' : '') + deltaW })}</span>
        <button class="btn small" id="hm-record" style="margin-top:6px"><span>${t('homeGoRecord')} →</span></button>
      </div>`
    : `<div class="empty">${icon('record')}<span>${t('homeWeekNone')}</span></div>`;
  if ($('hm-record')) $('hm-record').addEventListener('click', () => switchTab('record'));
}

/* ---- 动作轨迹（Tempo 式轨迹回放：你 vs 标准） ---- */
function ftRefTraj(key, n = 13) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const d = Math.sin(t * Math.PI);   // 0→1→0
    if (key === 'arm') pts.push([0.5, 0.36 - 0.30 * d]);
    else if (key === 'bend') pts.push([0.5 + 0.12 * d, 0.30 + 0.20 * d]);
    else pts.push([0.5, 0.46 + 0.06 * d]);
  }
  return pts;
}
function ftDrawTraj(canvas, user, ref) {
  if (!canvas) return;
  const ctx2 = canvas.getContext('2d');
  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 96;
  canvas.width = w; canvas.height = h;
  ctx2.clearRect(0, 0, w, h);
  const all = [...(user || []), ...(ref || [])];
  if (!all.length) return;
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = (x1 - x0) || 1, sy = (y1 - y0) || 1;
  const plot = (arr, color, dash) => {
    ctx2.strokeStyle = color; ctx2.lineWidth = 2;
    ctx2.setLineDash(dash ? [4, 3] : []);
    ctx2.beginPath();
    arr.forEach((p, i) => {
      const x = 14 + ((p[0] - x0) / sx) * (w - 28), y = 10 + ((p[1] - y0) / sy) * (h - 20);
      i ? ctx2.lineTo(x, y) : ctx2.moveTo(x, y);
    });
    ctx2.stroke();
    ctx2.setLineDash([]);
    if (arr.length) {
      const p = arr[0], q = arr[arr.length - 1];
      ctx2.fillStyle = color;
      ctx2.beginPath(); ctx2.arc(14 + ((p[0] - x0) / sx) * (w - 28), 10 + ((p[1] - y0) / sy) * (h - 20), 3.2, 0, Math.PI * 2); ctx2.fill();
      ctx2.fillStyle = '#0e7c66';
      ctx2.beginPath(); ctx2.arc(14 + ((q[0] - x0) / sx) * (w - 28), 10 + ((q[1] - y0) / sy) * (h - 20), 3.2, 0, Math.PI * 2); ctx2.fill();
    }
  };
  if (ref) plot(ref, '#c9cdd4', true);
  if (user) plot(user, '#0e7c66', false);
}

/* ============ 新增功能（v2.21.5）：训练模块细化 ============ */
// 纯新增（不动旧分析循环）：①训练页「今日任务」小条（与日程/今日同源，可一键打卡）
// ②训练时长计时器（画面右上角，轮询 state.running 状态，零侵入）
function renderTrainToday() {
  const el = $('train-today');
  if (!el) return;
  const todays = planForToday();
  const doneArr = planDoneGet()[todayKeyStr()] || [];
  if (!todays.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const doneCount = todays.filter((p) => doneArr.includes(p.ex)).length;
  el.innerHTML = `<h3 style="margin-bottom:8px">${t('homeToday')}</h3>` + todays.slice(0, 5).map((p) => {
    const e = getEx(p.ex);
    const isDone = doneArr.includes(p.ex);
    return `<div class="item">
      <button class="todo-check ${isDone ? 'on' : ''}" data-tex="${p.ex}">${isDone ? icon('check') : ''}</button>
      <div style="flex:1"><div class="t"><span class="t-ico">${icon(e ? e.icon : 'custom')}</span>${e ? exName(e) : p.ex} · ${t('repsN', { n: p.reps })}</div></div>
    </div>`;
  }).join('') + `<div class="plan-progress"><div class="plan-progress-txt">${t('planProgress', { d: doneCount, t: todays.length })}</div><div class="plan-bar"><div class="plan-fill" style="width:${(100 * doneCount / todays.length).toFixed(0)}%"></div></div></div>`;
  el.querySelectorAll('.todo-check').forEach((b) => b.addEventListener('click', () => {
    togglePlanDone(b.dataset.tex);   // 旧函数只调用不修改
    renderTrainToday();
    renderHome();
  }));
}
const trainTimer = { on: false, start: 0, acc: 0 };
function trainTimerTick() {
  const el = $('train-timer');
  if (!el) return;
  const running = !!state.running;
  if (running !== trainTimer.on) {
    if (running) trainTimer.start = performance.now();
    else { trainTimer.acc += performance.now() - trainTimer.start; trainTimer.start = 0; trainTimer.acc = 0; }
    trainTimer.on = running;
  }
  if (running) {
    const s = Math.floor((trainTimer.acc + (performance.now() - trainTimer.start)) / 1000);
    el.textContent = '⏱ ' + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}
setInterval(trainTimerTick, 500);

// v2.21.9：设置页「本机数据占用」（只读统计，纯新增）
// 修复：登录后数据写在账号分区键 u:<邮箱>:rehab_*，原实现只认 'rehab' 前缀 → 已登录时统计偏小
const STG_APP_KEY = /^(u:.*:)?rehab/;
const stgBytes = (s) => { try { return new Blob([s]).size; } catch { return s.length * 2; } };
const stgFmt = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB');
function stgStat() {
  const g = { total: 0, records: 0, collect: 0, custom: 0 };
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !STG_APP_KEY.test(k)) continue;
      const b = stgBytes(k + (localStorage.getItem(k) || ''));
      g.total += b;
      if (k.includes('collect')) g.collect += b;
      else if (k.includes('custom_ex')) g.custom += b;
      else if (/sessions|assessments|appts|ft_history|pa_history|home_idx|plan/.test(k)) g.records += b;
    }
  } catch { /* ignore */ }
  return g;
}
function renderStorageSize() {
  const el = $('storage-size');
  if (!el) return;
  const g = stgStat();
  el.textContent = t('stgSize', { s: stgFmt(g.total) });
  const bd = $('storage-break');
  if (bd) {
    bd.textContent = g.total === 0 ? t('stgNone')
      : t('stgBreak', { r: stgFmt(g.records), c: stgFmt(g.collect), m: stgFmt(g.custom), o: stgFmt(Math.max(0, g.total - g.records - g.collect - g.custom)) });
  }
}
// v2.21.9：备份卡「上次导出备份」提示（≥7 天标黄提醒）
function renderLastBackup() {
  const el = $('last-backup');
  if (!el) return;
  const ts = sget('rehab_last_backup', 0);
  if (!ts) { el.textContent = t('bakNever'); el.classList.remove('warn'); return; }
  const days = Math.floor((Date.now() - ts) / 86400000);
  el.textContent = t(days <= 0 ? 'bakToday' : 'bakDaysAgo', { d: days });
  el.classList.toggle('warn', days >= 7);
}
// v2.21.9：数据被替换/清空/同步后统一刷新全部依赖模块（导入、清空、二维码同步共用）
/* ============ v2.34.0 标准动作示范（图解）+ 示范录像 ============ */
const dmbState = { key: null, playing: false, raf: 0, t0: 0 };
const recState = { rec: null, t0: 0 };
// 跟练课里出现过的动作，按课程顺序去重（跟练是日常最常走的路）
function guideStepKeys() {
  const seen = [];
  Object.values(GW_PROGRAMS).forEach((p) => p.steps.forEach((s) => {
    if (hasDemo(s.icon) && seen.indexOf(s.icon) < 0) seen.push(s.icon);
  }));
  return seen;
}
function dmbName(key) { const e = EXERCISES[key]; return e ? exName(e) : t('dmbUnknown'); }
function dmbAngleChips(key) {
  return demoAngles(key).map((a) => '<span class="dmb-chip">' + t(a.k, { v: a.v }) + '</span>').join('');
}

function openDemo(key) {
  const modal = $('dmb-modal');
  if (!modal || !hasDemo(key)) return;
  dmbState.key = key;
  renderDemoBody();
  modal.classList.remove('hidden');
  $('dmb-close').onclick = closeDemo;
}
function closeDemo() {
  dmbStopPlay();
  const m = $('dmb-modal'); if (m) m.classList.add('hidden');
}
function dmbStopPlay() {
  dmbState.playing = false;
  if (dmbState.raf) { try { cancelAnimationFrame(dmbState.raf); } catch (e) { /* ignore */ } dmbState.raf = 0; }
}
function dmbTick(ts) {
  if (!dmbState.playing) return;
  const big = $('dmb-big');
  if (!big || !dmbState.key) { dmbStopPlay(); return; }
  if (!dmbState.t0) dmbState.t0 = ts;
  const dur = 2800;
  const u = ((ts - dmbState.t0) % dur) / dur;
  const tri = u < 0.5 ? u * 2 : (1 - u) * 2;   // 去-回，像 GIF 一样循环
  big.innerHTML = figureSvg(dmbState.key, { pose: demoPose(dmbState.key, tri), w: 230, h: 250, ghost: true });
  dmbState.raf = requestAnimationFrame(dmbTick);
}
function dmbPlayToggle() {
  if (dmbState.playing) { dmbStopPlay(); renderDemoBody(); return; }
  dmbState.playing = true; dmbState.t0 = 0;
  const b = $('dmb-play'); if (b) b.textContent = t('dmbPause');
  dmbState.raf = requestAnimationFrame(dmbTick);
}

function renderDemoBody() {
  const el = $('dmb-body');
  const key = dmbState.key;
  if (!el || !key) return;
  const d = DEMOS[key];
  const e = EXERCISES[key];
  const frames = d.frames.map((fr) => '<div class="dmb-fr"><div class="dmb-fr-fig">' +
    figureSvg(key, { pose: poseOf(key, fr.p), w: 150, h: 168 }) + '</div><div class="dmb-fr-cap">' + t(fr.key) + '</div></div>').join('');
  const faults = d.faults.map((ft) => '<div class="dmb-fr"><div class="dmb-fr-fig">' +
    figureSvg(key, { pose: poseOf(key, ft.p), w: 150, h: 168, fault: true }) + '</div><div class="dmb-fr-cap bad">' + t(ft.key) + '</div></div>').join('') +
    (d.front ? '<div class="dmb-fr"><div class="dmb-fr-fig">' +
      figureSvg(key, { pose: poseOf(key, d.front.p, 'front'), w: 150, h: 168, fault: true }) + '</div><div class="dmb-fr-cap bad">' + t(d.front.key) + '</div></div>' : '');
  el.innerHTML =
    '<div class="dmb-top"><div class="dmb-big" id="dmb-big">' +
      figureSvg(key, { pose: demoPose(key, 0.5), w: 230, h: 250, ghost: true }) + '</div>' +
      '<div class="dmb-side">' +
        '<div class="dmb-name">' + dmbName(key) + '</div>' +
        (e && e.stdKey ? '<p class="hint">' + t(e.stdKey) + '</p>' : '') +
        '<div class="dmb-angles">' + dmbAngleChips(key) + '</div>' +
        '<div class="controls"><button class="btn small" id="dmb-play">' + t('dmbPlay') + '</button>' +
          '<button class="btn small" id="dmb-rec">' + (recState.rec ? t('dmbRecStop') : t('dmbRec')) + '</button></div>' +
      '</div></div>' +
    '<div class="dmb-sec">' + t('dmbFrames') + '</div><div class="dmb-row">' + frames + '</div>' +
    (e && e.descKey ? '<div class="dmb-sec">' + t('dmbCues') + '</div><p class="hint">' + t(e.descKey) + '</p>' : '') +
    '<div class="dmb-sec">' + t('dmbFaults') + '</div><div class="dmb-row">' + faults + '</div>' +
    '<p class="hint tiny">' + t('dmbRecHint') + '</p>' +
    '<div class="dmb-sec">' + t('dmbClips') + '</div><div id="dmb-clips" class="dmb-clips"></div>';
  const p = $('dmb-play'); if (p) p.addEventListener('click', dmbPlayToggle);
  const rc = $('dmb-rec'); if (rc) rc.addEventListener('click', recToggle);
  renderClips($('dmb-clips'));
}

/* ---- 录像：录的是分析画布（摄像头画面 + 骨架叠加），只存本机 ---- */
async function recToggle() {
  if (recState.rec) { try { recState.rec.stop(); } catch (e) { /* ignore */ } return; }
  const cv = $('overlay');
  if (!cv || typeof cv.captureStream !== 'function' || typeof MediaRecorder === 'undefined') { toast(t('dmbNoRec')); return; }
  try {
    const stream = cv.captureStream(25);
    let mime = 'video/webm';
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) mime = 'video/webm;codecs=vp9';
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    rec.onstop = async () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const durSec = Math.max(1, Math.round((Date.now() - recState.t0) / 1000));
      recState.rec = null;
      if (blob.size > 0 && idbAvailable()) {
        try { await clipPut(blob, { ex: activeExId(), label: dmbName(activeExId()), durSec: durSec }); toast(t('dmbRecSaved', { n: durSec })); }
        catch (e) { toast(t('dmbNoRec')); }
      } else { toast(t('dmbNoRec')); }
      renderTrainDemo();
      if (dmbState.key) renderDemoBody();
    };
    rec.start(1000);
    recState.rec = rec; recState.t0 = Date.now();
    toast(t('dmbRecOn'));
    renderTrainDemo();
  } catch (err) { toast(t('dmbNoRec')); }
}

async function renderClips(host) {
  if (!host) return;
  if (!idbAvailable()) { host.innerHTML = '<p class="hint tiny">' + t('dmbNoIdb') + '</p>'; return; }
  let all = [];
  try { all = await clipAll(); } catch (e) { all = []; }
  if (!all.length) { host.innerHTML = '<p class="hint tiny">' + t('dmbClipEmpty') + '</p>'; return; }
  host.innerHTML = all.map((c) => '<div class="dmb-clip" data-clip="' + c.id + '">' +
    '<div class="dmb-clip-meta"><b>' + (c.label || c.ex || t('dmbClip')) + '</b>' +
      '<span class="hint tiny"> ' + new Date(c.ts).toLocaleString(locale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) +
      ' · ' + c.durSec + 's · ' + Math.max(1, Math.round((c.bytes || 0) / 1048576 * 10) / 10) + 'MB' +
      (c.forEx ? ' · ' + t('dmbDemoFor', { n: dmbName(c.forEx) }) : '') + '</span></div>' +
    '<div class="controls"><button class="btn small" data-clip-play="' + c.id + '">' + t('dmbPlayClip') + '</button>' +
      '<button class="btn small" data-clip-set="' + c.id + '">' + t('dmbSetAsDemo') + '</button>' +
      '<button class="btn small" data-clip-del="' + c.id + '">' + t('dmbDel') + '</button></div>' +
    '<div class="dmb-video" data-clip-host="' + c.id + '"></div></div>').join('');
  host.querySelectorAll('[data-clip-play]').forEach((b) => b.addEventListener('click', async () => {
    const c = await clipGet(b.dataset.clipPlay);
    const box = host.querySelector('[data-clip-host="' + b.dataset.clipPlay + '"]');
    if (!c || !box) return;
    if (box.innerHTML) { box.innerHTML = ''; return; }
    const url = URL.createObjectURL(c.blob);
    box.innerHTML = '<video controls playsinline src="' + url + '"></video>';
  }));
  host.querySelectorAll('[data-clip-set]').forEach((b) => b.addEventListener('click', async () => {
    const ex = dmbState.key || activeExId();
    await clipSetForEx(b.dataset.clipSet, ex);
    toast(t('dmbSetDone', { n: dmbName(ex) }));
    renderClips(host); renderTrainDemo();
  }));
  host.querySelectorAll('[data-clip-del]').forEach((b) => b.addEventListener('click', async () => {
    await clipDel(b.dataset.clipDel); renderClips(host); renderTrainDemo();
  }));
}

/* ---- 跟练页示范墙 ---- */
function renderDemos() {
  const card = $('gw-demos-card');
  if (card) card.classList.toggle('hidden', !!gwState.active);   // 跟练进行中不占屏幕，示范直接显示在训练台
  const el = $('gw-demos');
  if (!el) return;
  const keys = guideStepKeys();
  el.innerHTML = keys.map((k) => '<div class="dmb-cell">' +
    '<div class="dmb-cell-fig">' + figureSvg(k, { pose: demoPose(k, 0.5), w: 150, h: 160 }) + '</div>' +
    '<div class="dmb-fr-cap">' + dmbName(k) + '</div>' +
    '<button class="btn small" data-dmb="' + k + '">' + t('dmbLook') + '</button></div>').join('');
  el.querySelectorAll('[data-dmb]').forEach((b) => b.addEventListener('click', () => openDemo(b.dataset.dmb)));
}
// 验收用钩子：把示范图与录像存取暴露给自动化测试（不影响正常功能）
try {
  window.__rehabDemo = { hasDemo: hasDemo, demoAngles: demoAngles, figureSvg: figureSvg, demoPose: demoPose,
    poseOf: poseOf, DEMOS: DEMOS,
    clipPut: clipPut, clipAll: clipAll, clipDel: clipDel, idb: idbAvailable };
} catch (e) { /* ignore */ }

/* ---- 训练页：当前动作的标准示范 + 录制 ---- */
function renderTrainDemo() {
  const el = $('train-demo');
  if (!el) return;
  const id = activeExId();
  if (!id || id === 'auto') { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const e = EXERCISES[id];
  const has = hasDemo(id);
  el.innerHTML = '<h3>' + t('dmbTrainTitle') + ' · ' + dmbName(id) + '</h3>' +
    (has ? '<div class="dmb-train-fig">' + figureSvg(id, { pose: demoPose(id, 0.5), w: 200, h: 215 }) + '</div>' +
      '<div class="dmb-angles">' + dmbAngleChips(id) + '</div>'
      : '<p class="hint">' + t('dmbNoDemo') + '</p>') +
    (e && e.stdKey ? '<p class="hint">' + t(e.stdKey) + '</p>' : '') +
    '<div class="controls">' + (has ? '<button class="btn small" id="train-demo-look">' + t('dmbLook') + '</button>' : '') +
      '<button class="btn small ' + (recState.rec ? 'primary' : '') + '" id="train-rec">' + (recState.rec ? t('dmbRecStop') : t('dmbRec')) + '</button></div>' +
    '<p class="hint tiny">' + t('dmbRecHint') + '</p>' +
    '<div id="train-clips" class="dmb-clips"></div>';
  const l = $('train-demo-look'); if (l) l.addEventListener('click', () => openDemo(id));
  const rc = $('train-rec'); if (rc) rc.addEventListener('click', recToggle);
  renderClips($('train-clips'));
}

function refreshAllData() {
  renderRecords(); renderAssessments(); renderAppts(); renderCustomList(); renderExChips();
  renderCollectCount(); renderProfile(); renderTodayPlan(); renderPlanList(); renderPlanPick();
  renderAchievements(); renderGoal(); renderHome(); renderTrainToday();
  renderPaUI(); renderFtUI(); renderStorageSize(); renderLastBackup();
  renderPain(); renderPainStrip(); renderReport();   // v2.22.0/v2.24.0：疼痛与报告数据一起刷新
  renderRomHistory(); renderRomResult(romHistory()[0] || null);   // v2.26.0：ROM 数据一起刷新
  renderPromHistory();                                  // v2.27.0：PROMs 数据一起刷新
  renderAiPlan(); renderAiEngine(); renderPath(); renderCareLoop(); renderRecheck();   // v2.28-v2.33：引擎·路径·闭环·复评一起刷新
}

/* ============ v2.33.0 新模块：三块式架构（评估 / 训练 / 复评）+ 肌群分析 ============ */
// 底部导航收敛为 6 个主入口，评估与训练两块用子标签容纳各自的页面；复评页做前后对比与薄弱肌群分析。
const BLOCK_DEF = {
  assess: { label: 'blockAssess', items: [['posture', 'subPosture'], ['ft', 'subFt'], ['assess', 'subAssess']] },
  train: { label: 'blockTrain', items: [['guide', 'subGuide'], ['schedule', 'subSchedule'], ['train', 'subTrain']] },
};
const BLOCK_OF = { posture: 'assess', ft: 'assess', assess: 'assess', guide: 'train', schedule: 'train', train: 'train' };
function renderBlockSub() {
  const el = $('block-sub');
  if (!el) return;
  const cur = state.tab;
  const blk = BLOCK_OF[cur];
  if (!blk) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = `<span class="bs-label">${t(BLOCK_DEF[blk].label)}</span>` +
    BLOCK_DEF[blk].items.map(([k, key]) => `<button class="bs-btn ${cur === k ? 'on' : ''}" data-bs="${k}">${t(key)}</button>`).join('');
  el.querySelectorAll('[data-bs]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.bs)));
}
// 肌群映射：把"问题"翻译成"要练哪块肌肉 + 练什么"
const MUSCLE_MAP = [
  { test: (s) => s.paItems.some((x) => /shoulder|肩/i.test(x)) || s.dims && s.dims.sym != null && s.dims.sym < 80, key: 'gluteMed', ex: ['stepup', 'lunge'] },
  { test: (s) => s.paItems.some((x) => /knee|膝/i.test(x)) || (s.dims && s.dims.align != null && s.dims.align < 75), key: 'quadVmo', ex: ['sitstand', 'squat'] },
  { test: (s) => s.paItems.some((x) => /hip|髋|骨盆|pelvis/i.test(x)), key: 'gluteMax', ex: ['hiphinge', 'bridge'] },
  { test: (s) => s.paItems.some((x) => /back|腰|脊柱|spine/i.test(x)) || (s.dims && s.dims.stab != null && s.dims.stab < 75), key: 'coreDeep', ex: ['plank', 'hiphinge'] },
  { test: (s) => s.paItems.some((x) => /neck|颈|head|头/i.test(x)), key: 'neckDeep', ex: ['shoulderraise', 'standing'] },
  { test: (s) => s.paItems.some((x) => /ankle|踝|foot|足/i.test(x)) || (s.dims && s.dims.rom != null && s.dims.rom < 75), key: 'calfAnkle', ex: ['squat', 'stepup'] },
];
function bodyAnalysis() {
  const s = assessSnapshot();
  const ft = s.ft && s.ft.dims ? s.ft.dims : null;
  const flat = {
    paItems: (s.pa && s.pa.priorities ? s.pa.priorities.map((x) => String(x.label || '')) : []),
    dims: ft,
  };
  const hits = MUSCLE_MAP.filter((m) => m.test(flat));
  const weakRom = ROM_ITEMS.map((it) => ({ it, b: romBaseline(it.key) })).filter((x) => x.b && x.b.last != null)
    .map((x) => ({ it: x.it, last: x.b.last, gap: romTarget(x.it) - x.b.last })).sort((a, b) => b.gap - a.gap)[0];
  const pain = painRecentMax(7);
  const findings = [];
  if (weakRom && weakRom.gap > 0) findings.push({ kind: 'rom', text: t('anRom', { n: t('romItem' + weakRom.it.key.charAt(0).toUpperCase() + weakRom.it.key.slice(1)), v: weakRom.last, g: weakRom.gap }), muscles: weakRom.it.lm === 'shoulder' ? ['shoulderStab'] : ['gluteMax', 'calfAnkle'] });
  if (ft) {
    const order = [['sym', 'ftDimSym'], ['align', 'ftDimAlign'], ['dyn', 'ftDimDyn'], ['stab', 'ftDimStab'], ['rom', 'ftDimRom'], ['cons', 'ftDimCons']];
    let low = null;
    order.forEach(([k, key]) => { const v = Number(ft[k]); if (v != null && (low == null || v < low.v)) low = { k, key, v }; });
    if (low && low.v < 80) findings.push({ kind: 'ft', text: t('anFt', { n: t(low.key), v: Math.round(low.v) }), muscles: low.k === 'sym' ? ['gluteMed'] : low.k === 'stab' ? ['coreDeep'] : ['quadVmo'] });
  }
  if (pain != null && pain >= 4) findings.push({ kind: 'pain', text: t('anPain', { v: pain }), muscles: ['gluteMax'] });
  if (!s.pa && !s.ft && !s.rom && !s.prom) findings.push({ kind: 'none', text: t('anNone'), muscles: [] });
  const muscles = [...new Set([].concat(...findings.map((f) => f.muscles), ...hits.map((m) => m.key)))];
  const ex = [...new Set([].concat(...hits.map((m) => m.ex)))];
  return { findings, muscles, ex };
}
function renderBodyAnalysis() {
  const el = $('body-analysis');
  if (!el) return;
  const a = bodyAnalysis();
  el.innerHTML = `<div class="an-find">${a.findings.map((f) => `<div class="an-item ${f.kind}">• ${f.text}</div>`).join('')}</div>
    ${a.muscles.length ? `<div class="an-cols"><div><b>${t('anMuscles')}</b><ul>${a.muscles.map((m) => `<li>${t('mus' + m.charAt(0).toUpperCase() + m.slice(1))}</li>`).join('')}</ul></div>
    <div><b>${t('anExercises')}</b><ul>${a.ex.map((x) => { const e = getEx(x); return `<li>${e ? exName(e) : x}</li>`; }).join('')}</ul></div></div>
    <div class="controls"><button id="btn-an-plan" class="btn primary">${t('anMakePlan')}</button>
      <button id="btn-an-eval" class="btn">${t('anAskModel')}</button></div>` : ''}`;
  const p = $('btn-an-plan');
  if (p) p.addEventListener('click', () => { loopPlanFromIssues(); switchTab('train'); });
  const e2 = $('btn-an-eval');
  if (e2) e2.addEventListener('click', () => { toast(t('anModelHint')); });
}
function renderRecheck() {
  const el = $('rc-compare');
  if (!el) return;
  const s = assessSnapshot();
  const rom = romHistory();
  const rows = [];
  // 活动度：同项同侧 最近 vs 上一次
  ROM_ITEMS.forEach((it) => {
    const list = rom.filter((r) => r.key === it.key && r.rom != null);
    const now = list[0], prev = list.find((r, i) => i > 0 && r.side === (now && now.side));
    if (now) rows.push({ k: t('romItem' + it.key.charAt(0).toUpperCase() + it.key.slice(1)) + (now.side === 'L' ? ' 左' : ' 右'), now: now.rom + '°', prev: prev ? prev.rom + '°' : '—', d: prev ? now.rom - prev.rom : null, better: prev ? now.rom >= prev.rom : null, unit: '°' });
  });
  // 疼痛：训练前 vs 训练后（越低越好）
  const pairs = painTodayPair();
  if (pairs) rows.push({ k: t('painTitle'), now: pairs.post + '', prev: pairs.pre + '', d: pairs.post - pairs.pre, better: pairs.post <= pairs.pre, unit: '' });
  // 功能测试综合
  const ftAll = ftHistory().filter((r) => r.score != null);
  if (ftAll.length >= 2) rows.push({ k: t('repFt'), now: String(ftAll[0].score), prev: String(ftAll[1].score), d: ftAll[0].score - ftAll[1].score, better: ftAll[0].score >= ftAll[1].score, unit: '' });
  // 体态 / 量表
  const paAll = paHistory();
  if (paAll.length >= 2) rows.push({ k: t('repPa'), now: String(paAll[0].score), prev: String(paAll[1].score), d: paAll[0].score - paAll[1].score, better: paAll[0].score >= paAll[1].score, unit: '' });
  const prAll = promHistory();
  if (prAll.length >= 2 && prAll[0].key === prAll[1].key) rows.push({ k: t(promNameKey(prAll[0].key)), now: String(prAll[0].total), prev: String(prAll[1].total), d: prAll[0].total - prAll[1].total, better: promDef(prAll[0].key).type === 'ratio' ? prAll[0].total <= prAll[1].total : prAll[0].total >= prAll[1].total, unit: '' });
  el.innerHTML = rows.length
    ? rows.map((r) => `<div class="rc-row"><span class="rc-k">${r.k}</span><span class="rc-prev">${r.prev}${r.unit}</span><span class="rc-arrow">→</span><span class="rc-now">${r.now}${r.unit}</span>
        ${r.d == null ? '' : `<span class="rc-d ${r.better ? 'ok' : 'warn'}">${r.d > 0 ? '+' : ''}${r.d}${r.unit}</span>`}</div>`).join('')
    : `<p class="hint tiny">${t('rcNoData')}</p>`;
  const tr = $('rc-trend');
  if (tr) {
    const pts = trend30Points();
    const pain30 = painHistory().slice(0, 30).map((r) => r.v).reverse();
    tr.innerHTML = `<p class="chart-cap">${t('rcTrendTrain')}</p>${lineChart(pts, '#0e7c66', 'rc30')}
      ${pain30.length > 1 ? `<p class="chart-cap">${t('rcTrendPain')}</p>${lineChart(pain30, '#e07a5f', 'rcp')}` : ''}`;
  }
  renderBodyAnalysis();
}
$('btn-rc-report') && $('btn-rc-report').addEventListener('click', () => $('btn-rep-html').click());
$('btn-rc-assess') && $('btn-rc-assess').addEventListener('click', () => switchTab('posture'));
$('btn-rc-trend') && $('btn-rc-trend').addEventListener('click', () => { const e3 = $('rc-trend'); if (e3) e3.scrollIntoView({ behavior: 'smooth' }); });

/* ============ v2.32.0 新模块：端手接力（手机 ⇄ 电脑 数据合并式互通） ============ */
function renderRelayState() {
  const el = $('relay-state');
  if (!el) return;
  const n = sget('rehab_sessions', []).length + paHistory().length + romHistory().length + promHistory().length + painHistory().length;
  const last = LS.get('rehab_last_backup', 0);
  el.textContent = t('relayState', { n, d: last ? new Date(last).toLocaleDateString(locale()) : t('repNone') });
}
// 入口放在今日页最上方：导出 → 传文件 → 导入并合并（与二维码同步共用 mergeSyncData 合并引擎）
$('btn-relay-export') && $('btn-relay-export').addEventListener('click', () => $('btn-export').click());
$('btn-relay-import') && $('btn-relay-import').addEventListener('click', () => $('btn-import').click());
$('btn-relay-qr') && $('btn-relay-qr').addEventListener('click', () => { startSyncShow(); });

/* ============ v2.31.0 新模块：康复闭环（把评估/问题/训练/复评/对比串成一条主线） ============ */
// 解决“各模块各说各话”：所有评估 → 问题清单 → 生成训练计划 → 训练后记疼痛 → 复评 → 前后对比，全部互相调用。
function assessSnapshot() {
  const pa = paHistory()[0] || null;
  const ft = ftHistory().find((r) => r.battery && r.dims) || ftHistory()[0] || null;
  const rom = romHistory()[0] || null;
  const prom = promHistory()[0] || null;
  const ts = Math.max(pa ? pa.ts || 0 : 0, ft ? ft.ts || 0 : 0, rom ? rom.ts || 0 : 0, prom ? prom.ts || 0 : 0);
  return { pa, ft, rom, prom, ts, painMax: painRecentMax(7), painLast: painHistory()[0] || null };
}
// 问题清单：把五类评估的弱项汇总成可执行条目（每条都知道自己来自哪个模块、该练什么）
function issueList() {
  const s = assessSnapshot();
  const out = [];
  const SEV = { bad: 0, warn: 1, info: 2 };
  if (s.pa && Array.isArray(s.pa.priorities)) {
    s.pa.priorities.slice(0, 2).forEach((it) => out.push({
      key: 'pa:' + it.label, src: t('loopSrcPa'), name: it.label, detail: it.advice || it.text || '',
      sev: String(it.level) === 'bad' ? 'bad' : 'warn', go: 'posture',
    }));
  }
  if (s.ft && s.ft.dims) {
    const dims = s.ft.dims;
    const order = ['sym', 'align', 'dyn', 'stab', 'rom', 'cons'];
    const keys = ['ftDimSym', 'ftDimAlign', 'ftDimDyn', 'ftDimStab', 'ftDimRom', 'ftDimCons'];
    let low = null;
    order.forEach((k, i) => { const v = Number(dims[k]); if (v != null && (low == null || v < low.v)) low = { k, v, i }; });
    if (low) out.push({ key: 'ft:' + low.k, src: t('loopSrcFt'), name: t(keys[low.i]), detail: t('loopFtLow', { v: Math.round(low.v) }), sev: low.v < 70 ? 'bad' : 'warn', go: 'ft' });
  }
  const weak = ROM_ITEMS.map((it) => ({ it, b: romBaseline(it.key) })).filter((x) => x.b && x.b.last != null)
    .map((x) => ({ it: x.it, last: x.b.last, gap: romTarget(x.it) - x.b.last })).sort((a, b) => b.gap - a.gap)[0];
  if (weak && weak.gap > 0) out.push({
    key: 'rom:' + weak.it.key, src: t('loopSrcRom'), name: t('romItem' + weak.it.key.charAt(0).toUpperCase() + weak.it.key.slice(1)),
    detail: t('loopRomGap', { v: weak.last, tg: romTarget(weak.it), g: weak.gap }), sev: weak.gap > 20 ? 'bad' : 'warn', go: 'posture',
  });
  const bad = promHistory().find((r) => r.level === 'bad');
  if (bad) out.push({ key: 'prom:' + bad.key, src: t('loopSrcProm'), name: t(promNameKey(bad.key)), detail: t('loopPromBad', { v: bad.total }), sev: 'bad', go: 'assess' });
  if (s.painMax != null && s.painMax >= 4) out.push({
    key: 'pain', src: t('loopSrcPain'), name: t('painTitle'), detail: t('loopPain', { v: s.painMax, p: s.painLast ? t('painPart' + String(s.painLast.part || 'other').replace(/^\w/, (c) => c.toUpperCase()).replace('Lowback', 'LowBack')) : '—' }),
    sev: s.painMax >= 7 ? 'bad' : 'warn', go: 'record',
  });
  return out.sort((a, b) => SEV[a.sev] - SEV[b.sev]);
}
// 闭环五步 + 当前该做的一件事
function careLoop() {
  const s = assessSnapshot();
  const sessions = sget('rehab_sessions', []);
  const todayK = dayKeyOf(Date.now());
  const trainedToday = sessions.some((x) => dayKeyOf(x.ts) === todayK);
  const hasAssess = !!(s.pa || s.ft || s.rom || s.prom);
  const issues = issueList();
  const plan = planGet();
  const romNow = romHistory()[0] || null;
  const romPrev = romHistory().filter((r, i) => i > 0 && romNow && r.key === romNow.key && r.side === romNow.side)[0] || null;
  const painPost = painHistory().filter((r) => r.when === 'post')[0] || null;
  const painPre = painHistory().filter((r) => r.when === 'pre')[0] || null;
  const cmp = {
    rom: romNow && romPrev && romNow.rom != null && romPrev.rom != null ? romNow.rom - romPrev.rom : null,
    pain: painPost && painPre ? painPost.v - painPre.v : null,
    ft: s.ft && s.ft.score != null ? s.ft.score : null,
  };
  const steps = [
    { key: 'assess', done: hasAssess, label: t('loopStepAssess') },
    { key: 'issues', done: issues.length > 0, label: t('loopStepIssues') },
    { key: 'plan', done: plan.length > 0, label: t('loopStepPlan') },
    { key: 'train', done: trainedToday, label: t('loopStepTrain') },
    { key: 'recheck', done: hasAssess && trainedToday && s.ts > (painPost ? 0 : 0) && !!romPrev, label: t('loopStepRecheck') },
  ];
  let next;
  if (!hasAssess) next = { act: 'assess', label: t('loopNextAssess'), go: 'posture' };
  else if (!plan.length) next = { act: 'plan', label: t('loopNextPlan') };
  else if (!trainedToday) next = { act: 'train', label: t('loopNextTrain'), go: 'train' };
  else if (!painHistory().some((r) => r.when === 'post' && dayKeyOf(r.ts) === todayK)) next = { act: 'pain', label: t('loopNextPain') };
  else if (!romPrev) next = { act: 'recheck', label: t('loopNextRecheck'), go: 'posture' };
  else next = { act: 'compare', label: t('loopNextCompare') };
  return { s, steps, issues, next, cmp, trainedToday };
}
// 按问题清单一键生成今日计划（体态/功能测试/ROM/量表/疼痛 → 动作）
function loopPlanFromIssues() {
  const issues = issueList();
  const map = { pa: 'posture', ft: 'fa', rom: 'squat', prom: 'sitstand', pain: 'hiphinge' };
  const plan = planGet();
  const today = new Date().getDay();
  const picks = [];
  issues.slice(0, 3).forEach((it) => {
    const pre = it.key.split(':')[0];
    let ex = 'squat';
    if (pre === 'rom') ex = it.key.split(':')[1] === 'shoulderFlex' || it.key.split(':')[1] === 'shoulderAbd' ? 'shoulderraise' : 'squat';
    else if (pre === 'ft') ex = 'stepup';
    else if (pre === 'prom') ex = 'sitstand';
    else if (pre === 'pain') ex = 'hiphinge';
    else if (pre === 'pa') ex = /shoulder/i.test(it.name) ? 'shoulderraise' : 'hiphinge';
    picks.push(ex);
  });
  if (!picks.length) picks.push('squat');
  picks.forEach((ex, i) => {
    const reps = i === 0 ? 10 : 8;
    const j = plan.findIndex((x) => x.ex === ex && (x.days || []).includes(today));
    if (j >= 0) plan[j] = Object.assign({}, plan[j], { reps });
    else plan.push({ id: 'lp' + Date.now() + ex, ex, reps, days: [today] });
  });
  sset('rehab_plan', plan);
  refreshAllData();
  toast(t('loopPlanDone', { n: picks.length }));
}
function renderCareLoop() {
  const el = $('care-loop');
  if (!el) return;
  const L = careLoop();
  const chips = L.steps.map((x) => `<span class="loop-step ${x.done ? 'on' : ''}">${x.done ? '✓' : '○'} ${x.label}</span>`).join('<span class="loop-arrow">→</span>');
  const issues = L.issues.slice(0, 3).map((it) => `<div class="loop-issue ${it.sev}">
      <span class="loop-tag">${it.src}</span><b>${it.name}</b><span class="loop-detail">${it.detail}</span>
      <button class="link-btn" data-loop-go="${it.go}">${t('loopGo')}</button></div>`).join('');
  const cmp = [];
  if (L.cmp.rom != null) cmp.push(t('loopCmpRom', { v: (L.cmp.rom >= 0 ? '+' : '') + L.cmp.rom }));
  if (L.cmp.pain != null) cmp.push(t('loopCmpPain', { v: (L.cmp.pain >= 0 ? '+' : '') + L.cmp.pain }));
  el.innerHTML = `<div class="loop-steps">${chips}</div>
    <div class="loop-now"><b>${t('loopNow')}</b> ${L.next.label}
      <button id="btn-loop-next" class="btn primary small">${t('loopDo')}</button></div>
    ${issues ? `<div class="loop-issues">${issues}</div>` : `<p class="hint tiny">${t('loopNoIssues')}</p>`}
    ${cmp.length ? `<p class="hint tiny">${t('loopCompare')}：${cmp.join(' · ')}</p>` : ''}`;
  const nb = $('btn-loop-next');
  if (nb) nb.addEventListener('click', () => {
    const a = L.next.act;
    if (a === 'plan') loopPlanFromIssues();
    else if (a === 'pain') openPainModal('post');
    else if (a === 'compare') { renderCareLoop(); toast(t('loopCompareDone')); }
    else if (L.next.go) switchTab(L.next.go);
  });
  el.querySelectorAll('[data-loop-go]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.loopGo)));
}

/* ============ v2.30.0 新模块：影像能力升级（视野自适应 · 距离引导 · 设备能力可视化） ============ */
// 目标：手机不用放很远也能拍全 —— 默认竖幅 3:4（同距离能看到更多身体）、支持 zoom 的设备自动拉到最广、
// 识别不到全身时给出「后退/靠近/抬手机」的具体引导，而不是一句“失败了”。
const CAM_PREFS_DEF = { aspect: '34', follow: true, guide: true, zoom: null, deviceId: null };
const camPrefs = () => Object.assign({}, CAM_PREFS_DEF, sget('rehab_cam_prefs', {}) || {});
const camPrefSet = (patch) => { sset('rehab_cam_prefs', Object.assign(camPrefs(), patch)); renderCamCard(); };
const camCaps = { supported: null, min: null, max: null, zoom: null, w: null, h: null, label: '' };
function camConstraints(extra) {
  const p = camPrefs();
  const size = p.aspect === '169' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 960 }, height: { ideal: 1280 } };
  const base = Object.assign({}, size, p.deviceId ? { deviceId: { exact: p.deviceId } } : {});
  return Object.assign({ video: Object.assign(base, extra || {}), audio: false });
}
async function camApplyZoom(stream) {
  try {
    const track = stream.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== 'function') { camCaps.supported = false; return; }
    const caps = track.getCapabilities();
    if (!caps || !caps.zoom) { camCaps.supported = false; return; }
    const p = camPrefs();
    const want = p.zoom == null ? caps.zoom.min : Math.min(caps.zoom.max, Math.max(caps.zoom.min, Number(p.zoom)));
    await track.applyConstraints({ advanced: [{ zoom: want }] });
    camCaps.supported = true; camCaps.min = caps.zoom.min; camCaps.max = caps.zoom.max; camCaps.zoom = want;
  } catch { camCaps.supported = false; }
}
function camSaveCaps(stream) {
  try {
    const s = stream.getVideoTracks()[0].getSettings ? stream.getVideoTracks()[0].getSettings() : {};
    camCaps.w = s.width || null; camCaps.h = s.height || null;
    camCaps.label = stream.getVideoTracks()[0].label || '';
    renderCamCard();
  } catch { /* ignore */ }
}
// 入镜比例：以头到脚（或肩到踝）的归一化高度估计“离得够不够远”
function camFitInfo(lms) {
  if (!lms) return null;
  const ys = [];
  [0, 11, 12, 23, 24, 27, 28].forEach((i) => { if (lms[i] && (lms[i].visibility ?? 1) > 0.4) ys.push(lms[i].y); });
  if (ys.length < 3) return null;
  const h = Math.max(...ys) - Math.min(...ys);
  return { h, level: h < 0.5 ? 'far' : h > 0.97 ? 'close' : 'ok' };
}
function camGuideUpdate(lms) {
  const el = $('cam-guide');
  if (!el) return;
  if (!camPrefs().guide) { el.classList.add('hidden'); return; }
  const f = camFitInfo(lms);
  el.classList.remove('hidden');
  if (!f) { el.textContent = t('camGuideNone'); el.className = 'cam-guide warn'; return; }
  el.textContent = f.level === 'far' ? t('camGuideFar') : f.level === 'close' ? t('camGuideClose') : t('camGuideOk', { p: Math.round(f.h * 100) });
  el.className = 'cam-guide ' + (f.level === 'ok' ? 'ok' : 'warn');
}
// 自动挑选“最广视野”的摄像头：逐个候选打开，量同一个人在同一位置的入镜高度，取最小者（越小=视野越广）
async function camAutoPickWidest() {
  const btn = $('btn-cam-pick');
  if (btn) btn.disabled = true;
  try {
    const devs = (await detectCameras()).filter((c) => c.deviceId);
    if (devs.length < 2) { toast(t('camPickSingle')); return; }
    if (!state.landmarker) { toast(t('camPickNeedModel')); return; }
    const results = [];
    for (const d of devs) {
      let stream = null;
      try {
        stream = await openCameraWithTimeout({ video: { deviceId: { exact: d.deviceId }, width: { ideal: 960 }, height: { ideal: 1280 } }, audio: false }, 8000);
        const v = document.createElement('video');
        v.playsInline = true; v.muted = true; v.srcObject = stream;
        await v.play().catch(() => {});
        await new Promise((r2) => setTimeout(r2, 1200));
        let best = null;
        for (let i = 0; i < 6; i++) {
          const res = state.landmarker.detectForVideo(v, performance.now());
          if (res && res.landmarks && res.landmarks.length) {
            const f = camFitInfo(res.landmarks[0]);
            if (f && (best == null || f.h < best)) best = f.h;
          }
          await new Promise((r2) => setTimeout(r2, 180));
        }
        results.push({ id: d.deviceId, label: d.label || d.deviceId.slice(0, 6), h: best });
      } catch { /* 该设备打不开就跳过 */ }
      finally { if (stream) stream.getTracks().forEach((x) => x.stop()); }
    }
    const ok = results.filter((r) => r.h != null).sort((a, b) => a.h - b.h);
    if (!ok.length) { toast(t('camPickFail')); return; }
    camPrefSet({ deviceId: ok[0].id });
    toast(t('camPickDone', { l: ok[0].label, n: ok.length }));
  } catch (e) { toast(t('camPickFail')); }
  finally { if (btn) btn.disabled = false; }
}
function renderCamCard() {
  const p = camPrefs();
  const seg = $('cam-aspect');
  if (seg) seg.querySelectorAll('[data-cam-asp]').forEach((b) => {
    b.classList.toggle('on', b.dataset.camAsp === p.aspect);
    b.onclick = () => camPrefSet({ aspect: b.dataset.camAsp });
  });
  const setChk = (id, key) => {
    const el = $(id);
    if (el) { el.checked = !!p[key]; el.onchange = () => camPrefSet({ [key]: el.checked }); }
  };
  setChk('cam-follow', 'follow');
  setChk('cam-guide-chk', 'guide');
  const zr = $('cam-zoom');
  if (zr) {
    if (camCaps.supported) {
      zr.classList.remove('hidden');
      zr.min = camCaps.min; zr.max = camCaps.max; zr.step = '0.1'; zr.value = camCaps.zoom;
      zr.oninput = () => camPrefSet({ zoom: Number(zr.value) });
    } else zr.classList.add('hidden');
  }
  const st = $('cam-status');
  if (st) {
    const parts = [];
    parts.push(t('camStRes', { w: camCaps.w || '—', h: camCaps.h || '—' }));
    parts.push(camCaps.supported ? t('camStZoom', { z: Number(camCaps.zoom).toFixed(1) }) : t('camStNoZoom'));
    parts.push(p.deviceId ? t('camStPicked') : t('camStAuto'));
    st.textContent = parts.join(' · ');
  }
}
$('btn-cam-pick') && $('btn-cam-pick').addEventListener('click', camAutoPickWidest);
$('btn-cam-reset') && $('btn-cam-reset').addEventListener('click', () => { camPrefSet({ zoom: null, deviceId: null }); toast(t('camReset')); });

/* ============ v2.29.0 新模块：康复路径（分阶段 · 条件可改 · 按你的数据推荐） ============ */
// 原则延续：路径只是「起点」，阶段/剂量/进阶条件全部可改；系统按用户自己的数据推荐与提示升级。
const PATHS = [
  { key: 'lowback', ico: 'hiphinge', phases: [
    { ex: [['hiphinge', 8, 2], ['sitstand', 8, 2]] },
    { ex: [['squat', 10, 2], ['stepup', 8, 2]] },
    { ex: [['lunge', 10, 3], ['squat', 12, 3]] },
  ] },
  { key: 'knee', ico: 'squat', phases: [
    { ex: [['sitstand', 8, 2], ['hiphinge', 8, 2]] },
    { ex: [['squat', 10, 2], ['stepup', 10, 2]] },
    { ex: [['lunge', 10, 3], ['squat', 14, 3]] },
  ] },
  { key: 'shoulder', ico: 'shoulderraise', phases: [
    { ex: [['shoulderraise', 10, 2], ['standing', 8, 2]] },
    { ex: [['shoulderraise', 12, 2], ['pushup', 8, 2]] },
    { ex: [['pushup', 10, 3], ['shoulderraise', 15, 3]] },
  ] },
];
const PATH_PHASE_KEYS = ['Acute', 'Recover', 'Strength'];
const PATH_CFG_DEF = { path: null, phase: 0, cond: { painMax: 3, streak: 3, sym: 85 }, autoSuggest: true };
const pathDef = (key) => PATHS.find((p) => p.key === key) || PATHS[1];
const pathCfg = () => {
  const c = sget('rehab_path', null) || {};
  return { path: c.path || null, phase: Number(c.phase) || 0, cond: Object.assign({}, PATH_CFG_DEF.cond, c.cond || {}), autoSuggest: c.autoSuggest !== false, log: c.log || [] };
};
const pathSave = (patch) => { sset('rehab_path', Object.assign(pathCfg(), patch)); renderPath(); renderAiPlan(); };
// 按用户自己的数据推荐路径（疼痛部位优先，其次量表，最后功能测试弱项）
function pathRecommend() {
  const pain = painHistory();
  const part = pain.length ? (pain[0].part || '') : '';
  const PART_KEY = { lowback: 'painPartLowBack', knee: 'painPartKnee', shoulder: 'painPartShoulder', hip: 'painPartHip', ankle: 'painPartAnkle', other: 'painPartOther' };
  if (['lowback', 'knee', 'shoulder'].includes(part)) {
    return { key: part, why: t('pathWhyPain', { n: pain.length, p: t(PART_KEY[part] || 'painPartOther') }) };
  }
  const ph = promHistory();
  if (ph.some((r) => r.key === 'odi')) return { key: 'lowback', why: t('pathWhyProm', { s: t('promOdiT') }) };
  if (ph.some((r) => r.key === 'koos')) return { key: 'knee', why: t('pathWhyProm', { s: t('promKoosT') }) };
  if (ph.some((r) => r.key === 'ndi')) return { key: 'shoulder', why: t('pathWhyProm', { s: t('promNdiT') }) };
  const ft = ftLatestDims();
  if (ft && ft.sym != null && ft.sym < 80) return { key: 'knee', why: t('pathWhySym', { v: Math.round(ft.sym) }) };
  return { key: 'knee', why: t('pathWhyDefault') };
}
// 进阶条件检查（条件值由用户设定）
function pathCheck() {
  const cfg = pathCfg();
  const c = cfg.cond;
  const need = Math.max(1, Number(c.streak) || 3);
  const posts = painHistory().filter((r) => r.when === 'post').slice(0, need);
  const painOk = posts.length >= need && posts.every((r) => r.v <= (Number(c.painMax) || 3));
  const ft = ftLatestDims();
  const sym = ft && ft.sym != null ? Math.round(ft.sym) : null;
  const symNeed = Number(c.sym) || 0;
  const symOk = !symNeed || sym == null ? true : sym >= symNeed;
  return { painOk, symOk, ok: painOk && symOk, posts: posts.length, need, sym, painMax: Number(c.painMax) || 3, symNeed };
}
function pathNext() { const cfg = pathCfg(); return Math.min(2, cfg.phase + 1); }
function renderPath() {
  const list = $('path-pick');
  if (!list) return;
  const cfg = pathCfg();
  const rec = pathRecommend();
  const eff = cfg.path || rec.key;
  $('path-rec').innerHTML = `${t('pathRec')}：<b>${t('path' + rec.key.charAt(0).toUpperCase() + rec.key.slice(1) + 'T')}</b> · ${rec.why}` +
    (cfg.path ? '' : ` <button class="link-btn" id="path-use-rec">${t('pathUseRec')}</button>`);
  const useBtn = $('path-use-rec');
  if (useBtn) useBtn.addEventListener('click', () => { pathSave({ path: rec.key, phase: 0 }); toast(t('pathStarted')); });
  list.innerHTML = PATHS.map((p) => `<button class="pa-kind ${eff === p.key ? 'on' : ''}" data-path="${p.key}">
    <span class="pa-kind-ico">${icon(p.ico)}</span><span>${t('path' + p.key.charAt(0).toUpperCase() + p.key.slice(1) + 'T')}</span></button>`).join('');
  list.querySelectorAll('[data-path]').forEach((b) => b.addEventListener('click', () => {
    pathSave({ path: b.dataset.path, phase: 0 });
    toast(t('pathSwitched'));
  }));
  const pd = pathDef(eff);
  const pi = Math.min(cfg.phase, pd.phases.length - 1);
  const ph = pd.phases[pi];
  const ck = pathCheck();
  const body = $('path-body');
  body.innerHTML = `<div class="path-head">
      <b>${t('pathPhase' + PATH_PHASE_KEYS[pi])}</b>
      <span class="hint tiny">${t('pathPhaseOf', { i: pi + 1, n: pd.phases.length })}</span>
      <span class="rom-lv ${ck.ok ? 'good' : 'warn'}">${ck.ok ? t('pathReady') : t('pathNotYet')}</span>
    </div>
    <div class="list">${ph.ex.map(([ex, reps, sets]) => {
      const e = getEx(ex);
      return `<div class="item"><div><div class="t"><span class="t-ico">${icon(e ? e.icon : 'custom')}</span>${e ? exName(e) : ex}</div>
        <div class="d">${t('pathDose', { s: sets, r: reps })}</div></div></div>`;
    }).join('')}</div>
    <div class="path-cond">
      <div class="hint tiny">${t('pathCondTitle')}</div>
      <label class="ai-tgt"><span>${t('pathCondPain')}</span><input type="number" min="0" max="10" value="${cfg.cond.painMax}" data-cond="painMax"></label>
      <label class="ai-tgt"><span>${t('pathCondStreak')}</span><input type="number" min="1" max="14" value="${cfg.cond.streak}" data-cond="streak"></label>
      <label class="ai-tgt"><span>${t('pathCondSym')}</span><input type="number" min="0" max="100" value="${cfg.cond.sym}" data-cond="sym"></label>
      <label class="ai-tgt"><span>${t('pathAuto')}</span><input type="checkbox" id="path-auto" ${cfg.autoSuggest ? 'checked' : ''} style="width:auto"></label>
    </div>
    <div class="hint tiny">${t('pathStatus', { pain: ck.posts, need: ck.need, max: ck.painMax, sym: ck.sym == null ? '—' : ck.sym, symNeed: ck.symNeed })}</div>
    <div class="controls">
      <button id="btn-path-apply" class="btn primary">${t('pathApply')}</button>
      <button id="btn-path-up" class="btn" ${pi >= pd.phases.length - 1 ? 'disabled' : ''}>${t('pathUp')}</button>
      <button id="btn-path-reset" class="btn">${t('pathReset')}</button>
    </div>
    ${cfg.log && cfg.log.length ? `<p class="hint tiny">${t('pathLog', { n: cfg.log.length, last: new Date(cfg.log[0].ts).toLocaleDateString(locale()) })}</p>` : ''}`;
  body.querySelectorAll('[data-cond]').forEach((inp) => inp.addEventListener('change', () => {
    const cond = Object.assign({}, cfg.cond);
    cond[inp.dataset.cond] = Number(inp.value);
    pathSave({ cond });
  }));
  const auto = $('path-auto');
  if (auto) auto.addEventListener('change', () => pathSave({ autoSuggest: auto.checked }));
  $('btn-path-apply').addEventListener('click', () => {
    const plan = planGet();
    const today = new Date().getDay();
    ph.ex.forEach(([ex, reps]) => {
      const i = plan.findIndex((x) => x.ex === ex && (x.days || []).includes(today));
      if (i >= 0) plan[i] = Object.assign({}, plan[i], { reps });
      else plan.push({ id: 'pa' + Date.now() + ex, ex, reps, days: [today] });
    });
    sset('rehab_plan', plan);
    refreshAllData();
    toast(t('pathApplied'));
  });
  $('btn-path-up').addEventListener('click', () => {
    const ck2 = pathCheck();
    const cfg2 = pathCfg();
    if (!ck2.ok && !confirm(t('pathForceUp'))) return;
    const next = pathNext();
    const log = [{ ts: Date.now(), from: cfg2.phase, to: next, ok: ck2.ok }].concat(cfg2.log || []).slice(0, 20);
    pathSave({ phase: next, log });
    toast(t('pathUpDone', { n: next + 1 }));
  });
  $('btn-path-reset').addEventListener('click', () => { pathSave({ phase: 0 }); toast(t('pathResetDone')); });
}

/* ============ v2.28.0 新模块：自适应智能引擎（个人基线 · 可调规则 · 可学习处方） ============ */
// 设计原则：固定临床标准只作「参考」，主判定一律用用户自己的历史基线；每条规则都可见、可改、可关。
const AI_PREFS_DEF = { painAlarm: 2, intensity: 'std', autoAdapt: true, romTargets: {} };
const aiPrefs = () => Object.assign({}, AI_PREFS_DEF, sget('rehab_ai_prefs', {}) || {});
const aiFeedback = () => LS.get('rehab_ai_feedback', { accepted: 0, ignored: 0 });
const aiLearnAdd = (k) => { const f = aiFeedback(); f[k] = (f[k] || 0) + 1; LS.set('rehab_ai_feedback', f); renderAiPlan(); renderAiEngine(); };   // 注意：ai.js 已导出 aiFeedbackAdd（反馈日志），此处必须用不同名字
const aiPrefSet = (patch) => {
  sset('rehab_ai_prefs', Object.assign(aiPrefs(), patch));
  renderAiEngine(); renderAiPlan(); renderPain();
};
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
// 个人基线：取用户自己的历史中位数/最佳/最近一次（而不是人群常模）
function romBaseline(key, side) {
  const list = romHistory().filter((r) => r.key === key && (!side || r.side === side) && r.rom != null).map((r) => r.rom);
  return list.length ? { n: list.length, med: median(list), best: Math.max(...list), last: list[0] } : null;
}
function painBaseline() {
  const list = painHistory().map((r) => r.v);
  return list.length ? { n: list.length, med: median(list), last: list[0] } : null;
}
function romTarget(it) {
  const t = (aiPrefs().romTargets || {})[it.key];
  const v = Number(t);
  return (t == null || t === '' || Number.isNaN(v) || v <= 0) ? it.norm : v;   // 未设 = 用临床参考值（可覆盖）
}
// 处方引擎：每一步都产出「理由」，可解释、可学习
function aiPrescribe() {
  const p = aiPrefs();
  const f = aiFeedback();
  const spike = painSpike();
  const painMax = painRecentMax(7);
  const pb = painBaseline();
  const ft = ftLatestDims();
  const sym = ft && ft.sym != null ? Math.round(ft.sym) : null;
  const idx = homeIndex();
  const sessions = sget('rehab_sessions', []);
  const d7 = new Set(sessions.filter((s) => s.ts >= Date.now() - 7 * 86400000).map((s) => dayKeyOf(s.ts))).size;
  const weak = ROM_ITEMS.map((it) => ({ it, b: romBaseline(it.key) }))
    .filter((x) => x.b && x.b.last != null)
    .map((x) => ({ it: x.it, b: x.b, gap: romTarget(x.it) - x.b.last }))
    .sort((a, b) => b.gap - a.gap)[0] || null;
  const reasons = [];
  const basis = [
    t('aiBasisPain', { v: painMax == null ? '—' : painMax, a: p.painAlarm }),
    t('aiBasisSym', { v: sym == null ? '—' : sym }),
    t('aiBasisRom', weak ? { n: t('romShort' + weak.it.key.charAt(0).toUpperCase() + weak.it.key.slice(1)), v: weak.b.last, tg: romTarget(weak.it) } : { n: '—', v: '—', tg: '—' }),
    t('aiBasisAdh', { d: d7 }),
    t('aiBasisFeed', { a: f.accepted || 0, i: f.ignored || 0 }),
  ];
  let ex = 'squat', sets = 2, reps = 10, rest = 60, level = gwLevel(), focus = 'strength';
  if (!p.autoAdapt) {
    focus = 'manual';
    reasons.push(t('aiReasonManual'));
  } else {
    if ((spike && spike.delta >= p.painAlarm) || (painMax != null && painMax >= 7)) {
      focus = 'pain'; ex = 'hiphinge'; sets = 1; reps = 8; rest = 90;
      reasons.push(spike && spike.delta >= p.painAlarm
        ? t('aiReasonPainSpike', { d: spike.delta, a: p.painAlarm })
        : t('aiReasonPainHigh', { v: painMax }));
    } else if (sym != null && sym < 80) {
      focus = 'symmetry'; ex = 'stepup'; sets = 2; reps = 8; rest = 60;
      reasons.push(t('aiReasonSym', { v: sym }));
    } else if (weak && weak.gap > 0) {
      focus = 'mobility'; ex = weak.it.lm === 'shoulder' ? 'shoulderraise' : 'squat'; sets = 2; reps = 8; rest = 45;
      reasons.push(t('aiReasonRom', { n: t('romShort' + weak.it.key.charAt(0).toUpperCase() + weak.it.key.slice(1)), v: weak.b.last, tg: romTarget(weak.it), g: weak.gap }));
    } else if (d7 < 2) {
      focus = 'habit'; sets = 1; reps = 8; rest = 45;
      reasons.push(t('aiReasonHabit', { d: d7 }));
    } else {
      focus = 'strength';
      if (idx.score != null && idx.score >= 75) { sets += 1; reps += 2; reasons.push(t('aiReasonProgress', { v: idx.score })); }
      else reasons.push(t('aiReasonKeep', { v: idx.score == null ? '—' : idx.score }));
    }
    if (p.intensity === 'soft') { sets = Math.max(1, sets - 1); rest += 30; reasons.push(t('aiReasonSoft')); }
    if (p.intensity === 'hard') { sets += 1; rest = Math.max(30, rest - 15); reasons.push(t('aiReasonHard')); }
    if ((f.ignored || 0) > (f.accepted || 0)) { sets = Math.max(1, sets - 1); reasons.push(t('aiReasonLearn', { a: f.accepted || 0, i: f.ignored || 0 })); }
  }
  return { ex, sets, reps, rest, level, focus, reasons, basis, spike };
}
function renderAiPlan() {
  const el = $('ai-plan');
  if (!el) return;
  const pr = aiPrescribe();
  const e = getEx(pr.ex);
  el.innerHTML = `<div class="ai-plan-head"><span class="t-ico">${icon(e ? e.icon : 'custom')}</span>
      <b>${e ? exName(e) : pr.ex}</b> · ${t('aiPlanDose', { s: pr.sets, r: pr.reps, rest: pr.rest })}
      <span class="rom-lv ${pr.focus === 'pain' ? 'bad' : pr.focus === 'strength' ? 'good' : 'warn'}">${t('aiFocus' + pr.focus.charAt(0).toUpperCase() + pr.focus.slice(1))}</span></div>
    <div class="ai-plan-reasons">${pr.reasons.map((r) => `<div class="ai-reason">• ${r}</div>`).join('')}</div>
    <details class="ai-basis"><summary class="hint tiny">${t('aiBasisTitle')}</summary>
      ${pr.basis.map((b) => `<div class="hint tiny">· ${b}</div>`).join('')}</details>
    <div class="controls">
      <button id="btn-ai-apply" class="btn primary" data-i18n="${pr.focus === 'pain' ? 'aiApply' : 'aiApply'}">${t('aiApply')}</button>
      <button id="btn-ai-ignore" class="btn">${t('aiIgnore')}</button>
      <button id="btn-ai-tune" class="btn">${t('aiTune')}</button>
    </div>`;
  $('btn-ai-apply').addEventListener('click', aiPlanApply);
  $('btn-ai-ignore').addEventListener('click', aiPlanIgnore);
  $('btn-ai-tune').addEventListener('click', () => { switchTab('settings'); setTimeout(() => $('ai-engine') && $('ai-engine').scrollIntoView({ behavior: 'smooth' }), 120); });
}
function aiPlanApply() {
  const pr = aiPrescribe();
  const plan = planGet();
  const today = new Date().getDay();
  const i = plan.findIndex((x) => x.ex === pr.ex && (x.days || []).includes(today));
  if (i >= 0) plan[i] = Object.assign({}, plan[i], { reps: pr.reps });
  else plan.push({ id: 'ai' + Date.now(), ex: pr.ex, reps: pr.reps, days: [today] });
  sset('rehab_plan', plan);
  aiLearnAdd('accepted');
  refreshAllData();
  toast(t('aiPlanApplied'));
}
function aiPlanIgnore() {
  aiLearnAdd('ignored');
  toast(t('aiPlanIgnored'));
}
function renderAiEngine() {
  const p = aiPrefs();
  const seg = $('ai-intensity');
  if (seg) seg.querySelectorAll('[data-int]').forEach((b) => {
    b.classList.toggle('on', b.dataset.int === p.intensity);
    b.onclick = () => aiPrefSet({ intensity: b.dataset.int });
  });
  const sel = $('ai-pain-alarm');
  if (sel) { sel.value = String(p.painAlarm); sel.onchange = () => aiPrefSet({ painAlarm: Number(sel.value) }); }
  const cb = $('ai-auto-adapt');
  if (cb) { cb.checked = !!p.autoAdapt; cb.onchange = () => aiPrefSet({ autoAdapt: cb.checked }); }
  const tgt = $('ai-rom-targets');
  if (tgt) {
    tgt.innerHTML = ROM_ITEMS.map((it) => `<label class="ai-tgt"><span>${t('romItem' + it.key.charAt(0).toUpperCase() + it.key.slice(1))}</span>
      <input type="number" min="0" max="200" value="${(p.romTargets || {})[it.key] != null ? (p.romTargets || {})[it.key] : ''}" placeholder="${it.norm}" data-tgt="${it.key}"></label>`).join('');
    tgt.querySelectorAll('[data-tgt]').forEach((inp) => inp.addEventListener('change', () => {
      const m = Object.assign({}, p.romTargets || {});
      const v = inp.value === '' ? null : Number(inp.value);
      if (v == null || Number.isNaN(v)) delete m[inp.dataset.tgt]; else m[inp.dataset.tgt] = v;
      aiPrefSet({ romTargets: m });
    }));
  }
  const b = $('ai-baseline');
  if (b) {
    const pb = painBaseline();
    const rows = [];
    ROM_ITEMS.forEach((it) => {
      const rb = romBaseline(it.key);
      if (rb) rows.push(`<div class="rep-row"><span class="k">${t('romShort' + it.key.charAt(0).toUpperCase() + it.key.slice(1))}</span><span class="v">${t('aiBaseRom', { last: rb.last, med: rb.med, best: rb.best, n: rb.n })}</span></div>`);
    });
    if (pb) rows.push(`<div class="rep-row"><span class="k">${t('painTitle')}</span><span class="v">${t('aiBasePain', { med: pb.med, last: pb.last, n: pb.n })}</span></div>`);
    const f = aiFeedback();
    rows.push(`<div class="rep-row"><span class="k">${t('aiEngLearn')}</span><span class="v">${t('aiEngLearnV', { a: f.accepted || 0, i: f.ignored || 0 })}</span></div>`);
    b.innerHTML = rows.join('') || `<p class="hint tiny">${t('aiBaseNone')}</p>`;
  }
}
$('btn-ai-reset') && $('btn-ai-reset').addEventListener('click', () => {
  sset('rehab_ai_prefs', Object.assign({}, AI_PREFS_DEF));
  renderAiEngine(); renderAiPlan(); renderPain();
  toast(t('aiEngResetDone'));
});

/* ============ v2.27.0 新模块：标准化结局量表 PROMs（ODI / NDI / KOOS-12 / EQ-5D-5L） ============ */
// 对标 Physitrack / Hinge Health 的 PROMs 随访：用国际通用量表记录功能受限程度并跟踪变化。
const PROM_DEFS = [
  { key: 'odi', type: 'ratio', opt: 6, max: 5, items: 10 },
  { key: 'ndi', type: 'ratio', opt: 6, max: 5, items: 10 },
  { key: 'koos', type: 'sub', opt: 5, max: 4, subs: [['pain', 4], ['symptom', 1], ['adl', 4], ['sport', 1], ['qol', 2]] },
  { key: 'eq5d', type: 'eq', opt: 5, dims: 5 },
];
const PROM_ITEM_KEYS = {
  odi: Array.from({ length: 10 }, (_, i) => 'promOdiI' + (i + 1)),
  ndi: Array.from({ length: 10 }, (_, i) => 'promNdiI' + (i + 1)),
  koos: Array.from({ length: 12 }, (_, i) => 'promKoosI' + (i + 1)),
  eq5d: Array.from({ length: 5 }, (_, i) => 'promEqD' + (i + 1)),
};
const PROM_SUB_KEYS = { pain: 'promSubPain', symptom: 'promSubSymptom', adl: 'promSubAdl', sport: 'promSubSport', qol: 'promSubQol' };
const promDef = (key) => PROM_DEFS.find((x) => x.key === key) || PROM_DEFS[0];
const promHistory = () => sget('rehab_proms_history', []);
const promSave = (h) => sset('rehab_proms_history', h.slice(0, 40));
const promState = { key: 'odi', answers: [], open: false, vas: 50 };
function promScore(def, answers) {
  if (def.type === 'eq') {
    const dims = answers.slice(0, 5).map((v) => (v == null ? 1 : v + 1));
    const worst = Math.max(...dims);
    return { total: promState.vas, subs: { dims, vas: promState.vas }, band: worst >= 4 ? 'EqWarn' : 'EqOk', level: worst >= 4 ? 'bad' : worst >= 3 ? 'warn' : 'good' };
  }
  if (def.type === 'sub') {
    let idx = 0, sum = 0;
    const subs = {};
    def.subs.forEach(([k, n]) => {
      let s = 0;
      for (let i = 0; i < n; i++) { const v = answers[idx++]; s += (v == null ? 0 : v); }
      subs[k] = Math.max(0, Math.round(100 - (s * 100) / (4 * n)));
      sum += subs[k];
    });
    const total = Math.round(sum / def.subs.length);
    return { total, subs, band: total >= 90 ? 'Exc' : total >= 75 ? 'Good' : total >= 50 ? 'Fair' : 'Poor', level: total >= 75 ? 'good' : total >= 50 ? 'warn' : 'bad' };
  }
  const answered = answers.filter((v) => v != null).length;
  const sum = answers.reduce((a, v) => a + (v == null ? 0 : v), 0);
  const total = Math.round((sum * 100) / (5 * Math.max(1, answered)));
  return { total, subs: { answered }, band: total <= 20 ? 'Min' : total <= 40 ? 'Mod' : total <= 60 ? 'Sev' : total <= 80 ? 'VSev' : 'Bed', level: total <= 20 ? 'good' : total <= 40 ? 'warn' : 'bad' };
}
const promNameKey = (k) => 'prom' + k.charAt(0).toUpperCase() + k.slice(1) + 'T';
function renderPromUI() {
  const el = $('prom-list');
  if (!el) return;
  el.innerHTML = PROM_DEFS.map((d) => `<button class="pa-kind ${promState.key === d.key ? 'on' : ''}" data-prom="${d.key}">
    <span class="pa-kind-ico">${icon('assess')}</span><span>${t(promNameKey(d.key))}</span></button>`).join('');
  el.querySelectorAll('[data-prom]').forEach((b) => b.addEventListener('click', () => {
    promState.key = b.dataset.prom;
    promState.open = false;
    promState.answers = [];
    $('prom-form').classList.add('hidden');
    renderPromUI();
  }));
  $('prom-desc').textContent = t('prom' + promState.key.charAt(0).toUpperCase() + promState.key.slice(1) + 'D');
  $('btn-prom-cancel').classList.toggle('hidden', !promState.open);
  $('btn-prom-start').classList.toggle('hidden', promState.open);
  if (promState.open) renderPromForm();
}
function renderPromForm() {
  const d = promDef(promState.key);
  const keys = PROM_ITEM_KEYS[d.key];
  if (promState.answers.length !== keys.length) promState.answers = new Array(keys.length).fill(null);
  const box = $('prom-form');
  box.classList.remove('hidden');
  box.innerHTML = `<div style="margin-top:10px">` + keys.map((k, qi) => `
    <div class="prom-q">
      <div class="prom-qt">${qi + 1}. ${t(k)}</div>
      <div class="prom-opts">${Array.from({ length: d.opt }, (_, v) => `<button class="prom-opt ${promState.answers[qi] === v ? 'on' : ''}" data-qi="${qi}" data-qv="${v}">${t('promL' + v)}</button>`).join('')}</div>
    </div>`).join('') + (d.type === 'eq' ? `
    <div class="prom-q"><div class="prom-qt">${t('promVas')} · <b id="prom-vas-val">${promState.vas}</b></div>
      <input type="range" id="prom-vas" min="0" max="100" value="${promState.vas}" style="width:100%"></div>` : '')
    + `<div class="controls"><button id="btn-prom-submit" class="btn primary">${t('promSubmit')}</button></div></div>`;
  box.querySelectorAll('[data-qi]').forEach((b) => b.addEventListener('click', () => {
    promState.answers[Number(b.dataset.qi)] = Number(b.dataset.qv);
    renderPromForm();
  }));
  const vas = $('prom-vas');
  if (vas) vas.addEventListener('input', () => { promState.vas = Number(vas.value); $('prom-vas-val').textContent = vas.value; });
  $('btn-prom-submit').addEventListener('click', promSubmit);
}
function promSubmit() {
  const d = promDef(promState.key);
  const keys = PROM_ITEM_KEYS[d.key];
  const answered = promState.answers.filter((v) => v != null).length;
  const need = d.type === 'ratio' ? 8 : keys.length;
  if (answered < need) { toast(t('promNeedAll', { n: need })); return; }
  const sc = promScore(d, promState.answers);
  const rec = { id: uid(), ts: Date.now(), key: d.key, answers: promState.answers.slice(), total: sc.total, subs: sc.subs, band: sc.band, level: sc.level };
  const h = promHistory(); h.unshift(rec); promSave(h);
  promState.open = false;
  $('prom-form').classList.add('hidden');
  renderPromUI();
  renderPromResult(rec);
  renderPromHistory();
  renderReport();
  aiRun();
  toast(t('promDone'));
  scheduleCloudSync();
}
function renderPromResult(rec) {
  const el = $('prom-result');
  if (!el) return;
  if (!rec) { el.classList.add('hidden'); return; }
  const d = promDef(rec.key);
  const prev = promHistory().filter((r) => r.id !== rec.id && r.key === rec.key)[0];
  const delta = prev ? rec.total - prev.total : null;
  const better = d.type === 'ratio' ? delta != null && delta < 0 : delta != null && delta > 0;
  el.classList.remove('hidden');
  el.className = 'prom-result ' + rec.level;
  const isKoos = !!rec.subs && ['pain', 'symptom', 'adl', 'sport', 'qol'].some((k) => rec.subs[k] != null);
  const subTxt = rec.subs && rec.subs.dims
    ? `<span><i>${t('promVas')}</i> <b>${rec.subs.vas}</b></span>`
    : isKoos
      ? Object.entries(rec.subs).map(([k, v]) => `<span><i>${t(PROM_SUB_KEYS[k] || k)}</i> <b>${v}</b></span>`).join('')
      : '';
  el.innerHTML = `<div class="prom-head">${t(promNameKey(rec.key))} · <span class="rom-lv ${rec.level}">${t('promBand' + rec.band)}</span></div>
    <div class="prom-big">${rec.total}${d.type === 'eq' ? ' / 100' : '%'}</div>
    ${subTxt ? `<div class="prom-sub">${subTxt}</div>` : ''}
    ${delta == null ? '' : `<p class="hint tiny ${better ? '' : delta === 0 ? '' : 'warn'}">${t(better ? 'promBetter' : delta === 0 ? 'promSame' : 'promWorse', { d: Math.abs(delta) })}</p>`}
    <p class="hint tiny">${t('promAdvice' + rec.level.charAt(0).toUpperCase() + rec.level.slice(1))}</p>`;
  }
function renderPromHistory() {
  const el = $('prom-history');
  if (!el) return;
  const h = promHistory();
  if (!h.length) { el.innerHTML = emptyBox('assess', 'promNoData'); return; }
  el.innerHTML = h.slice(0, 6).map((r) => `<div class="item">
      <div>
        <div class="t"><span class="t-ico">${icon('assess')}</span>${t(promNameKey(r.key))}
          <span class="rom-lv ${r.level}">${t('promBand' + r.band)}</span></div>
        <div class="d">${new Date(r.ts).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${r.total}${promDef(r.key).type === 'eq' ? ' / 100' : '%'}</div>
      </div>
      <div><button class="mini del" data-promdel="${r.id}">${icon('trash')}</button></div>
    </div>`).join('');
  el.querySelectorAll('[data-promdel]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm(t('confirmDelProm'))) return;
    promSave(promHistory().filter((r) => r.id !== b.dataset.promdel));
    renderPromHistory(); renderReport();
    toast(t('toastDeleted'));
  }));
}
$('btn-prom-start').addEventListener('click', () => {
  promState.open = true;
  promState.answers = [];
  promState.vas = 50;
  renderPromUI();
});
$('btn-prom-cancel').addEventListener('click', () => {
  promState.open = false;
  $('prom-form').classList.add('hidden');
  renderPromUI();
});
// 报告：各量表最近一次结果
function promReportRows() {
  const h = promHistory();
  const rows = [];
  const latest = {};
  h.forEach((r) => { if (!latest[r.key]) latest[r.key] = r; });
  const keys = Object.keys(latest);
  if (keys.length) {
    rows.push({ k: t('repProms'), v: keys.map((k) => `${t(promNameKey(k))} ${latest[k].total}${promDef(k).type === 'eq' ? '' : '%'}`).join(' · '), cls: keys.some((k) => latest[k].level === 'bad') ? 'warn' : keys.every((k) => latest[k].level === 'good') ? 'ok' : '' });
  }
  return rows;
}
function promBadCount() { return promHistory().filter((r) => r.level === 'bad').length; }

/* ============ v2.26.0 新模块：ROM 关节活动度（Range of Motion） ============ */
// 对标专业康复产品的 ROM 测量：单摄像头 → 关键点角度 → 关节最大活动范围 + 左右差异。
const ROM_MS = 6000;                 // 每次测量时长（6 秒，做到最大幅度并保持）
const ROM_IDX = {
  L: { shoulder: 11, elbow: 13, hip: 23, knee: 25, ankle: 27 },
  R: { shoulder: 12, elbow: 14, hip: 24, knee: 26, ankle: 28 },
};
const ROM_ITEMS = [
  { key: 'kneeFlex', lm: 'knee', mode: 'gain', norm: 135, from: 175, to: 45 },
  { key: 'kneeExt', lm: 'knee', mode: 'deficit', norm: 5, from: 160, to: 178 },
  { key: 'shoulderFlex', lm: 'shoulder', mode: 'gain', norm: 160, from: 15, to: 175 },
  { key: 'shoulderAbd', lm: 'shoulder', mode: 'gain', norm: 160, from: 15, to: 175 },
  { key: 'hipFlex', lm: 'hip', mode: 'gain', norm: 110, from: 175, to: 60 },
];
const romItem = (key) => ROM_ITEMS.find((x) => x.key === key) || ROM_ITEMS[0];
const romHistory = () => sget('rehab_rom_history', []);
const romSave = (h) => sset('rehab_rom_history', h.slice(0, 60));
const romAngleAt = (p, a, b) => {
  const v1 = [a.x - p.x, a.y - p.y], v2 = [b.x - p.x, b.y - p.y];
  const d = Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]);
  if (!d) return 0;
  const cos = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / d));
  return (Math.acos(cos) * 180) / Math.PI;
};
function romRawAngle(lm, side, lms) {
  const I = ROM_IDX[side] || ROM_IDX.L;
  try {
    if (lm === 'knee') return romAngleAt(lms[I.knee], lms[I.hip], lms[I.ankle]);
    if (lm === 'hip') return romAngleAt(lms[I.hip], lms[I.shoulder], lms[I.knee]);
    if (lm === 'shoulder') return romAngleAt(lms[I.shoulder], lms[I.hip], lms[I.elbow]);
  } catch { /* 关键点缺失 */ }
  return 0;
}
function romValueOf(it, min, max) {
  if (min == null || max == null) return null;
  if (it.mode === 'deficit') return Math.round(180 - max);            // 伸展缺损（越小越好）
  return Math.round(it.lm === 'shoulder' ? max : 180 - min);          // 屈曲/外展取最大角
}
function romLevel(it, v) {
  if (v == null) return 'none';
  if (it.mode === 'deficit') return v <= 5 ? 'good' : v <= 10 ? 'warn' : 'bad';
  return v >= it.norm ? 'good' : v >= it.norm - 20 ? 'warn' : 'bad';
}
const romState = { active: false, demo: false, key: 'kneeFlex', side: 'L', t0: 0, min: null, max: null, lastT: 0, videoOn: false };
// 演示模式：合成「从起始角匀速到最大角」的骨架帧（测试与无摄像头时可用）
function romDemoFrame(key, ts) {
  const it = romItem(key);
  const elapsed = romState.t0 ? ts - romState.t0 : 0;          // 用本次测量的已用时间，保证 6 秒走完全程
  const p = Math.min(1, Math.max(0, elapsed / ROM_MS));
  const ang = ((it.from + (it.to - it.from) * p) * Math.PI) / 180;
  const mk = (x, y) => ({ x, y, z: 0, visibility: 1 });
  const lms = Array.from({ length: 33 }, () => mk(0.5, 0.5));
  const dir = [Math.sin(ang), -Math.cos(ang)];    // 与「向上」的基准成 ang（膝/髋用）
  const dir2 = [Math.sin(ang), Math.cos(ang)];     // 与「向下」的基准成 ang（肩用）
  if (it.lm === 'knee') {
    const hip = mk(0.5, 0.28), knee = mk(0.5, 0.56);
    lms[23] = lms[24] = hip; lms[25] = lms[26] = knee;
    lms[27] = lms[28] = mk(knee.x + dir[0] * 0.3, knee.y + dir[1] * 0.3);
    lms[11] = lms[12] = mk(0.5, 0.18); lms[13] = lms[14] = mk(0.58, 0.4); lms[15] = lms[16] = mk(0.62, 0.5);
    lms[31] = lms[32] = mk(knee.x + dir[0] * 0.36, knee.y + dir[1] * 0.36);
  } else if (it.lm === 'hip') {
    const sh = mk(0.5, 0.16), hip = mk(0.5, 0.52);
    lms[11] = lms[12] = sh; lms[23] = lms[24] = hip;
    lms[25] = lms[26] = mk(hip.x + dir[0] * 0.3, hip.y + dir[1] * 0.3);
    lms[27] = lms[28] = mk(hip.x + dir[0] * 0.56, hip.y + dir[1] * 0.56);
    lms[13] = lms[14] = mk(0.5, 0.32); lms[15] = lms[16] = mk(0.5, 0.44);
  } else {
    const hip = mk(0.5, 0.78), sh = mk(0.5, 0.36);
    lms[23] = lms[24] = hip; lms[11] = lms[12] = sh;
    lms[13] = lms[14] = mk(sh.x + dir2[0] * 0.28, sh.y + dir2[1] * 0.28);
    lms[15] = lms[16] = mk(sh.x + dir2[0] * 0.52, sh.y + dir2[1] * 0.52);
    lms[25] = lms[26] = mk(0.5, 0.9); lms[27] = lms[28] = mk(0.5, 0.98);
  }
  lms[0] = mk(0.5, 0.1);
  return lms;
}
function romGuide() {
  const it = romItem(romState.key);
  $('rom-guide').textContent = t('romGuide' + it.key.charAt(0).toUpperCase() + it.key.slice(1));
}
function setRomBtn() {
  const el = $('btn-rom-start-label');
  if (el) el.textContent = romState.active ? t('romStop') : t('romStart');
}
function renderRomLive(cur) {
  const el = $('rom-live');
  if (!el) return;
  el.classList.remove('hidden');
  const it = romItem(romState.key);
  const v = romValueOf(it, romState.min, romState.max);
  const pct = romState.t0 ? Math.min(100, Math.round(((performance.now() - romState.t0) / ROM_MS) * 100)) : 0;
  el.innerHTML = `<div class="rom-row"><b>${t('romCurrent')}</b><span class="rom-cur">${cur == null ? '—' : cur.toFixed(0)}°</span>
    <b>${t('romBest')}</b><span class="rom-best">${v == null ? '—' : v + '°'}</span></div>
    <div class="rom-bar"><div class="rom-fill" style="width:${pct}%"></div></div>`;
}
function renderRomResult(rec) {
  const el = $('rom-result');
  if (!el) return;
  if (!rec) { el.classList.add('hidden'); return; }
  const it = romItem(rec.key);
  const prev = romHistory().filter((r) => r.id !== rec.id && r.key === rec.key && r.side === rec.side)[0];
  const diff = prev && prev.rom != null && rec.rom != null ? rec.rom - prev.rom : null;
  el.classList.remove('hidden');
  el.className = 'rom-result ' + rec.level;
  el.innerHTML = `<div class="rom-head">${t('romItem' + it.key.charAt(0).toUpperCase() + it.key.slice(1))} · ${rec.side === 'L' ? t('romSideL') : t('romSideR')}
      <span class="rom-lv ${rec.level}">${t('romLv' + rec.level.charAt(0).toUpperCase() + rec.level.slice(1))}</span></div>
    <div class="rom-big">${it.mode === 'deficit' ? t('romDeficit', { v: rec.rom == null ? '—' : rec.rom }) : t('romRange', { v: rec.rom == null ? '—' : rec.rom })}</div>
    <p class="hint tiny">${t('romDetail', { min: rec.min == null ? '—' : rec.min, max: rec.max == null ? '—' : rec.max, n: it.norm })}</p>
    ${(function () { const b = romBaseline(rec.key, rec.side); if (!b || rec.rom == null) return ''; const d = rec.rom - b.med; return `<p class="hint tiny ${d < 0 ? 'warn' : ''}">${t('romVsBaseline', { v: b.med, d: (d >= 0 ? '+' : '') + d, n: b.n })}</p>`; })()}
    ${diff == null ? '' : `<p class="hint tiny ${diff > 0 ? '' : diff < 0 ? 'warn' : ''}">${t(diff >= 0 ? 'romUp' : 'romDown', { d: Math.abs(diff) })}</p>`}
    <p class="hint tiny">${t('romAdvice' + (rec.level === 'good' ? 'Good' : rec.level === 'bad' ? 'Bad' : 'Warn'))}</p>`;
}
function renderRomHistory() {
  const el = $('rom-history');
  if (!el) return;
  const h = romHistory();
  if (!h.length) { el.innerHTML = emptyBox('assess', 'romNoData'); return; }
  el.innerHTML = h.slice(0, 6).map((r) => {
    const it = romItem(r.key);
    return `<div class="item">
      <div>
        <div class="t"><span class="t-ico">${icon('assess')}</span>${t('romItem' + it.key.charAt(0).toUpperCase() + it.key.slice(1))} · ${r.side === 'L' ? t('romSideL') : t('romSideR')}
          <span class="rom-lv ${r.level}">${t('romLv' + r.level.charAt(0).toUpperCase() + r.level.slice(1))}</span></div>
        <div class="d">${new Date(r.ts).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${t('romDetailShort', { v: r.rom == null ? '—' : r.rom })}</div>
      </div>
      <div><button class="mini del" data-romdel="${r.id}">${icon('trash')}</button></div>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-romdel]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm(t('confirmDelRom'))) return;
    romSave(romHistory().filter((r) => r.id !== b.dataset.romdel));
    renderRomHistory(); renderReport();
    toast(t('toastDeleted'));
  }));
}
function renderRomUI() {
  const el = $('rom-items');
  if (!el) return;
  el.innerHTML = ROM_ITEMS.map((it) => `<button class="pa-kind ${romState.key === it.key ? 'on' : ''}" data-rom="${it.key}">
    <span class="pa-kind-ico">${icon('assess')}</span><span>${t('romItem' + it.key.charAt(0).toUpperCase() + it.key.slice(1))}</span></button>`).join('');
  el.querySelectorAll('[data-rom]').forEach((b) => b.addEventListener('click', () => {
    romState.key = b.dataset.rom;
    if (romState.active) { romStop(); toast(t('romSwitched')); }
    renderRomUI();
  }));
  const seg = $('rom-side');
  if (seg) seg.querySelectorAll('[data-side]').forEach((b) => {
    b.classList.toggle('on', b.dataset.side === romState.side);
    b.onclick = () => {
      romState.side = b.dataset.side;
      if (romState.active) { romStop(); toast(t('romSwitched')); }
      renderRomUI();
    };
  });
  romGuide();
  setRomBtn();
}
async function romStart(demo) {
  if (romState.active) { romStop(); return; }
  if (paState.active) paStop();                       // 与体态评估互斥，防止摄像头占用
  romState.active = true; romState.demo = !!demo;
  romState.t0 = 0; romState.min = null; romState.max = null;
  renderRomResult(null);
  setRomBtn();
  if (demo) {
    $('pa-video').classList.add('hidden');
    $('pa-placeholder').classList.remove('hidden');
    $('pa-placeholder-text').textContent = t('romDemoRunning');
  } else {
    $('pa-video').classList.remove('hidden');
    try {
      const stream = await openCamera();
      const v = $('pa-video');
      v.srcObject = stream;
      await new Promise((res, rej) => {
        if (v.readyState >= 1) return res();
        const t0 = setTimeout(() => rej(new Error('rom camera timeout')), 15000);
        v.onloadedmetadata = () => { clearTimeout(t0); res(); };
      });
      romState.videoOn = true;
    } catch (e) { romState.active = false; setRomBtn(); showCameraError(e); return; }
  }
  renderRomLive(null);
  requestAnimationFrame(romLoop);
}
function romStop() {
  romState.active = false;
  romState.videoOn = false;
  try {
    const v = $('pa-video');
    if (v && v.srcObject) { v.srcObject.getTracks().forEach((x) => x.stop()); v.srcObject = null; }
    const c = $('pa-overlay');
    if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  } catch { /* ignore */ }
  $('rom-live').classList.add('hidden');
  setRomBtn();
}
function romLoop() {
  if (!romState.active) return;
  if (state.tab !== 'posture' || document.hidden) { requestAnimationFrame(romLoop); return; }
  const ts = performance.now();
  if (ts - romState.lastT < 33) { requestAnimationFrame(romLoop); return; }
  romState.lastT = ts;
  if (!romState.t0) romState.t0 = ts;
  const it = romItem(romState.key);
  let lms = null;
  if (romState.demo) lms = romDemoFrame(romState.key, ts);
  else {
    const v = $('pa-video');
    if (!romState.videoOn || v.readyState < 2) { requestAnimationFrame(romLoop); return; }
    const r = state.landmarker ? state.landmarker.detectForVideo(v, ts) : null;
    if (r && r.landmarks && r.landmarks.length) lms = r.landmarks[0];
  }
  const c = $('pa-overlay');
  if (c) {
    const cw = c.clientWidth, ch = c.clientHeight;
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const ctx2 = c.getContext('2d');
    ctx2.clearRect(0, 0, cw, ch);
    if (lms) drawStick(ctx2, lms, cw, ch, !romState.demo);
  }
  let cur = null;
  if (lms) {
    cur = romRawAngle(it.lm, romState.side, lms);
    if (cur > 1 && cur < 180) {
      romState.min = romState.min == null ? cur : Math.min(romState.min, cur);
      romState.max = romState.max == null ? cur : Math.max(romState.max, cur);
    }
  }
  renderRomLive(cur);
  if (ts - romState.t0 >= ROM_MS) { romFinish(); return; }
  requestAnimationFrame(romLoop);
}
function romFinish() {
  const it = romItem(romState.key);
  const min = romState.min == null ? null : Math.round(romState.min);
  const max = romState.max == null ? null : Math.round(romState.max);
  const rom = romValueOf(it, romState.min, romState.max);
  const rec = { id: uid(), ts: Date.now(), key: it.key, side: romState.side, min, max, rom, level: romLevel(it, rom), demo: romState.demo };
  const h = romHistory(); h.unshift(rec); romSave(h);
  romStop();
  renderRomResult(rec);
  renderRomHistory();
  renderReport();
  renderHome();
  toast(t('romDone'));
  scheduleCloudSync();
}
$('btn-rom-start').addEventListener('click', () => { romStart(false); });
$('btn-rom-demo').addEventListener('click', () => { romStart(true); });
// 报告里的 ROM 行 + 左右差异
function romReportRows() {
  const h = romHistory();
  const rows = [];
  const measured = ROM_ITEMS.filter((it) => h.some((r) => r.key === it.key && r.rom != null));
  if (measured.length) {
    rows.push({ k: t('repRom'), v: measured.map((it) => {
      const last = h.find((r) => r.key === it.key && r.rom != null);
      return `${t('romShort' + it.key.charAt(0).toUpperCase() + it.key.slice(1))} ${last.rom}°`;
    }).join(' · '), cls: '' });
    const diffs = [], seen = {};
    h.forEach((r) => { if (r.rom == null) return; seen[r.key] = seen[r.key] || {}; if (!seen[r.key][r.side]) seen[r.key][r.side] = r.rom; });
    Object.entries(seen).forEach(([k, v]) => {
      if (v.L != null && v.R != null) diffs.push(`${t('romShort' + k.charAt(0).toUpperCase() + k.slice(1))} ${Math.abs(v.L - v.R)}°`);
    });
    if (diffs.length) rows.push({ k: t('repRomDiff'), v: diffs.join(' · '), cls: diffs.some((d) => parseInt(d.match(/(\d+)°/)[1], 10) > 10) ? 'warn' : 'ok' });
  }
  return rows;
}

/* ============ v2.25.0 报告升级：体态截图 + 六维雷达 + 30 天趋势 ============ */
// 体态截图：优先存「骨架图」（只含火柴人，不含真人照片，隐私友好），退化到视频帧
function paSnapShot() {
  try {
    const cv = document.createElement('canvas');
    const ov = $('overlay');
    const v = $('pa-video');
    const src = (ov && ov.width > 8 && !ov.classList.contains('hidden')) ? ov : (v && v.videoWidth ? v : null);
    if (!src) return null;
    const sw = src.width || src.videoWidth;
    const sh = src.height || src.videoHeight;
    if (!sw || !sh) return null;
    const w = 240, h = Math.max(2, Math.round(w * sh / sw));
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(src, 0, 0, w, h);
    const url = cv.toDataURL('image/jpeg', 0.6);
    return url && url.length > 400 ? url : null;
  } catch { return null; }
}
// 功能测试六维雷达（对称/排列/动态/稳定/活动度/一致性）
const FT_DIM_ORDER = ['sym', 'align', 'dyn', 'stab', 'rom', 'cons'];
const FT_DIM_KEYS = ['ftDimSym', 'ftDimAlign', 'ftDimDyn', 'ftDimStab', 'ftDimRom', 'ftDimCons'];
function ftLatestDims() {
  const h = ftHistory();
  const rec = h.find((r) => r.battery && r.dims) || h.find((r) => r.dims);
  return rec ? rec.dims : null;
}
function radarSvg(dims, uid) {
  const V = dims || {};
  const W = 220, C = W / 2, R = 76;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / FT_DIM_ORDER.length;
    return [C + Math.cos(a) * r, C + Math.sin(a) * r];
  };
  const ring = (f) => FT_DIM_ORDER.map((_, i) => pt(i, R * f).map((n) => n.toFixed(1)).join(',')).join(' ');
  const vals = FT_DIM_ORDER.map((k) => Math.max(0, Math.min(100, Math.round(Number(V[k]) || 0))));
  const poly = vals.map((v, i) => pt(i, (R * v) / 100).map((n) => n.toFixed(1)).join(',')).join(' ');
  return `<svg viewBox="0 0 ${W} ${W}" class="radar-chart" role="img" aria-label="${t('repRadar')}">
    ${[0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${ring(f)}" fill="none" stroke="#e7e2d7" stroke-width="1"/>`).join('')}
    ${FT_DIM_ORDER.map((_, i) => { const [x, y] = pt(i, R); return `<line x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e7e2d7" stroke-width="1"/>`; }).join('')}
    <polygon points="${poly}" fill="rgba(14,124,102,.18)" stroke="#0e7c66" stroke-width="2"/>
    ${FT_DIM_ORDER.map((_, i) => { const [x, y] = pt(i, R + 14); return `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" font-size="9" fill="#69707c" text-anchor="middle">${t(FT_DIM_KEYS[i])}</text>`; }).join('')}
  </svg>
  <div class="radar-vals">${FT_DIM_ORDER.map((k, i) => `<span class="rv"><i>${t(FT_DIM_KEYS[i])}</i><b>${vals[i]}</b></span>`).join('')}</div>`;
}
// 近 30 天每日训练次数（0 的天也保留，形成连续趋势）
function trend30Points() {
  const sessions = sget('rehab_sessions', []);
  const out = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const k = dayKeyOf(d.getTime());
    out.push(sessions.filter((s) => dayKeyOf(s.ts) === k).reduce((a, s) => a + (s.reps || 0), 0));
  }
  return out;
}
const loadImg = (src) => new Promise((res) => {
  if (!src) return res(null);
  const im = new Image();
  im.onload = () => res(im);
  im.onerror = () => res(null);
  im.src = src;
});
// canvas 版雷达 + 折线（供 PNG 长图使用）
function drawRadarCanvas(c, cx, cy, R, dims) {
  const V = dims || {};
  const n = FT_DIM_ORDER.length;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  c.strokeStyle = '#e7e2d7'; c.lineWidth = 1;
  [0.25, 0.5, 0.75, 1].forEach((f) => {
    c.beginPath();
    for (let i = 0; i <= n; i++) { const [x, y] = pt(i % n, R * f); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke();
  });
  for (let i = 0; i < n; i++) { const [x, y] = pt(i, R); c.beginPath(); c.moveTo(cx, cy); c.lineTo(x, y); c.stroke(); }
  c.beginPath();
  FT_DIM_ORDER.forEach((k, i) => {
    const v = Math.max(0, Math.min(100, Number(V[k]) || 0));
    const [x, y] = pt(i, (R * v) / 100);
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  });
  c.closePath(); c.fillStyle = 'rgba(14,124,102,.18)'; c.fill();
  c.strokeStyle = '#0e7c66'; c.lineWidth = 2; c.stroke();
  c.fillStyle = '#69707c'; c.font = '12px "Microsoft YaHei",system-ui,sans-serif';
  FT_DIM_ORDER.forEach((k, i) => {
    const [x, y] = pt(i, R + 18);
    c.textAlign = 'center';
    c.fillText(`${t(FT_DIM_KEYS[i])} ${Math.round(Number(V[k]) || 0)}`, x, y + 4);
    c.textAlign = 'left';
  });
}
function drawTrendCanvas(c, x, y, w, h, pts) {
  const m = Math.max(1, ...pts);
  const px = (i) => x + (w * i) / Math.max(1, pts.length - 1);
  const py = (v) => y + h - (h * v) / m;
  c.strokeStyle = '#e7e2d7'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(x, y + h); c.lineTo(x + w, y + h); c.stroke();
  c.beginPath();
  pts.forEach((v, i) => (i ? c.lineTo(px(i), py(v)) : c.moveTo(px(i), py(v))));
  c.strokeStyle = '#0e7c66'; c.lineWidth = 2; c.stroke();
  c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath();
  c.fillStyle = 'rgba(14,124,102,.12)'; c.fill();
}

/* ============ v2.24.0 新模块：治疗师报告（一键汇总 + HTML/PDF/图片/摘要） ============ */
// 对标 PhysiApp 的会话级回传：把评估、训练依从性、疼痛与建议汇总成一页可分享的报告。
function buildReportData() {
  const sessions = sget('rehab_sessions', []);
  const from = Date.now() - 30 * 86400000;
  const s30 = sessions.filter((s) => (s.ts || 0) >= from);
  const days = new Set(s30.map((s) => dayKeyOf(s.ts))).size;
  const reps = s30.reduce((a, s) => a + (s.reps || 0), 0);
  const doneKeys = Object.keys(sget('rehab_plan_done', {})).filter((k) => k >= dayKeyOf(from));
  const pairs = painDailyPairs(14).filter((p) => p.pre != null || p.post != null);
  return {
    prof: profileGet(),
    sessions: s30.length, days, reps,
    streak: calcStreak(sessions),
    idx: homeIndex(),
    pa: paHistory()[0] || null,
    ft: ftHistory().find((r) => r.battery) || ftHistory()[0] || null,
    painMax: painRecentMax(30),
    pairs,
    plan: planGet().length,
    planDays: doneKeys.length,
    ai: aiLast,
    spike: painSpike(),
    snap: (paHistory()[0] && paHistory()[0].snap) || null,   // v2.25.0：最新体态骨架快照
    dims: ftLatestDims(),                                    // v2.25.0：功能测试六维
    trend30: trend30Points(),                                // v2.25.0：近 30 天训练趋势
  };
}
function reportRows(r) {
  const rows = [];
  rows.push({ k: t('repPatient'), v: (r.prof.name || t('repAnon')) + (r.prof.goal ? ' · ' + t('goal' + r.prof.goal.charAt(0).toUpperCase() + r.prof.goal.slice(1)) : ''), cls: '' });
  rows.push({ k: t('repIndex'), v: r.idx.score == null ? t('repNone') : r.idx.score + ' · ' + (r.idx.level ? t('gwLv' + r.idx.level) : ''), cls: r.idx.score == null ? '' : r.idx.score >= 75 ? 'ok' : r.idx.score < 60 ? 'warn' : '' });
  rows.push({ k: t('repPa'), v: r.pa ? r.pa.score + ' · ' + t('paGrade' + (r.pa.grade || 'C')) : t('repNone'), cls: '' });
  rows.push({ k: t('repFt'), v: r.ft ? String(r.ft.score) : t('repNone'), cls: '' });
  rows.push({ k: t('repPain'), v: r.painMax == null ? t('repNone') : r.painMax + ' / 10', cls: r.painMax != null && r.painMax >= 7 ? 'warn' : r.painMax != null && r.painMax <= 3 ? 'ok' : '' });
  rows.push({ k: t('repAdherence'), v: t('repAdh', { d: r.days, n: r.sessions, r: r.reps }), cls: r.days >= 12 ? 'ok' : r.days === 0 ? 'warn' : '' });
  rows.push({ k: t('repStreak'), v: t('repDays', { n: r.streak }), cls: '' });
  rows.push({ k: t('repPlan'), v: t('repPlanV', { p: r.plan, d: r.planDays }), cls: '' });
  romReportRows().forEach((x) => rows.push(x));   // v2.26.0：ROM 测量汇总进报告
  promReportRows().forEach((x) => rows.push(x));  // v2.27.0：PROMs 量表结果进报告
  return rows;
}
function reportAdvice(r) {
  const list = [];
  if (r.spike) list.push(t('aiPainSpike', { d: r.spike.delta }));
  else if (r.painMax != null && r.painMax >= 7) list.push(t('aiPainHigh', { v: r.painMax }));
  if (r.idx.score != null && r.idx.score < 60) list.push(t('repAdvLow'));
  if (r.days < 8) list.push(t('repAdvConsist'));
  if (r.ft && r.ft.score < 70) list.push(t('repAdvFt'));
  if (r.ai && r.ai.items) r.ai.items.slice(0, 3).forEach((it) => list.push(t(it.key, it.args)));
  if (!list.length) list.push(t('repAdvGood'));
  return list;
}
function renderReport() {
  const el = $('rep-summary');
  if (!el) return;
  const r = buildReportData();
  el.innerHTML = reportRows(r).map((x) => `<div class="rep-row"><span class="k">${x.k}</span><span class="v ${x.cls}">${x.v}</span></div>`).join('')
    + (r.snap
      ? `<div class="rep-sec"><h4>${t('repSnap')}</h4><img class="rep-snap" src="${r.snap}" alt="${t('repSnap')}"><p class="hint tiny">${t('repSnapNote')}</p></div>`
      : `<div class="rep-sec"><h4>${t('repSnap')}</h4><p class="hint tiny">${t('repSnapNone')}</p></div>`)
    + (r.dims ? `<div class="rep-sec"><h4>${t('repRadar')}</h4>${radarSvg(r.dims, 'reps')}</div>` : '')
    + `<div class="rep-sec"><h4>${t('repTrend30')}</h4>${lineChart(r.trend30, '#0e7c66', 'rep30')}</div>`;
}
function reportSummaryText(r) {
  const L = [t('repTitle') + ' · ' + new Date().toLocaleDateString(locale())];
  reportRows(r).forEach((x) => L.push(`${x.k}：${x.v}`));
  L.push('', t('repSuggest'));
  reportAdvice(r).forEach((a, i) => L.push(`${i + 1}. ${a}`));
  L.push('', t('repDisclaimer'));
  return L.join('\n');
}
function reportHtmlDoc(r) {
  const chartPts = r.pairs.map((p) => (p.post != null ? p.post : p.pre));
  const chart = chartPts.length > 0 ? lineChart(chartPts, '#e07a5f', 'rp') : '';
  const rows = reportRows(r).map((x) => `<tr><th>${x.k}</th><td class="${x.cls}">${x.v}</td></tr>`).join('');
  const snapHtml = r.snap
    ? `<h2>${t('repSnap')}</h2><img src="${r.snap}" alt="${t('repSnap')}" style="width:300px;border-radius:10px"><div class="sub">${t('repSnapNote')}</div>`
    : '';
  const radarHtml = r.dims ? `<h2>${t('repRadar')}</h2>${radarSvg(r.dims, 'rpradar')}` : '';
  const trendHtml = `<h2>${t('repTrend30')}</h2>${lineChart(r.trend30, '#0e7c66', 'rp30')}`;
  const adv = reportAdvice(r).map((a) => `<li>${a}</li>`).join('');
  return `<!doctype html><html lang="${locale()}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t('repTitle')} · ${new Date().toLocaleDateString(locale())}</title>
<style>
body{font-family:-apple-system,"Segoe UI",Roboto,"Helvetica Neue","Microsoft YaHei",sans-serif;max-width:760px;margin:28px auto;padding:0 18px;color:#22262e;line-height:1.65}
h1{font-size:22px;margin:0 0 4px}.sub{color:#69707c;font-size:13px;margin-bottom:18px}
table{border-collapse:collapse;width:100%;margin:14px 0}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #e7e2d7;font-size:14px}
th{color:#69707c;font-weight:600;width:150px}td{font-weight:650}td.ok{color:#0e7c66}td.warn{color:#d14a4a}
h2{font-size:15px;margin:22px 0 6px}.line-chart{width:100%;height:90px}
.radar-chart{width:220px;height:220px;display:block}.radar-vals{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:6px}
.radar-vals .rv{font-size:12px;color:#69707c}.radar-vals .rv i{font-style:normal;margin-right:4px}.radar-vals .rv b{color:#0e7c66}
ul{margin:6px 0 0 18px;padding:0}li{font-size:14px;margin-bottom:6px}
.foot{margin-top:26px;padding-top:12px;border-top:1px solid #e7e2d7;color:#69707c;font-size:12px}
@media print{body{margin:0}}
</style></head><body>
<h1>${t('repTitle')}</h1>
<div class="sub">${t('repSubtitle')} · ${new Date().toLocaleString(locale())}</div>
<table>${rows}</table>
${snapHtml}${radarHtml}${trendHtml}
${chart ? `<h2>${t('repPainTrend')}</h2>${chart}` : ''}
<h2>${t('repSuggest')}</h2><ul>${adv}</ul>
<div class="foot">${t('repPrintTip')}<br>${t('repDisclaimer')}</div>
</body></html>`;
}
function downloadBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function exportReportHtml() {
  const r = buildReportData();
  const name = `${t('fileReport')}-${new Date().toISOString().slice(0, 10)}.html`;
  downloadBlob(name, new Blob([reportHtmlDoc(r)], { type: 'text/html;charset=utf-8' }));
  toast(t('repDone'));
}
async function exportReportPng() {
  const r = buildReportData();
  const snapImg = await loadImg(r.snap);
  const W = 900, H = 1760, S = 2;
  const cv = document.createElement('canvas');
  cv.width = W * S; cv.height = H * S;
  const c = cv.getContext('2d');
  c.scale(S, S);
  c.fillStyle = '#f6f4ef'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#ffffff'; c.fillRect(36, 36, W - 72, H - 72);
  c.fillStyle = '#0e7c66'; c.fillRect(36, 36, W - 72, 6);
  c.fillStyle = '#22262e'; c.font = 'bold 30px "Microsoft YaHei",system-ui,sans-serif';
  c.fillText(t('repTitle'), 68, 110);
  c.fillStyle = '#69707c'; c.font = '16px "Microsoft YaHei",system-ui,sans-serif';
  c.fillText(t('repSubtitle') + ' · ' + new Date().toLocaleString(locale()), 68, 142);
  let y = 200;
  reportRows(r).forEach((x) => {
    c.fillStyle = '#69707c'; c.font = '17px "Microsoft YaHei",system-ui,sans-serif';
    c.fillText(x.k, 68, y);
    c.fillStyle = x.cls === 'warn' ? '#d14a4a' : x.cls === 'ok' ? '#0e7c66' : '#22262e';
    c.font = 'bold 18px "Microsoft YaHei",system-ui,sans-serif';
    const txt = String(x.v);
    c.fillText(txt.length > 44 ? txt.slice(0, 43) + '…' : txt, 260, y);
    c.strokeStyle = '#e7e2d7'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(68, y + 14); c.lineTo(W - 68, y + 14); c.stroke();
    y += 52;
  });
  // v2.25.0：体态骨架截图 + 六维雷达 + 30 天训练趋势
  let y2 = y + 16;
  c.fillStyle = '#0e7c66'; c.font = 'bold 18px "Microsoft YaHei",system-ui,sans-serif';
  c.fillText(t('repSnap'), 68, y2);
  if (snapImg) c.drawImage(snapImg, 68, y2 + 16, 300, Math.round((300 * snapImg.height) / snapImg.width));
  else {
    c.fillStyle = '#69707c'; c.font = '15px "Microsoft YaHei",system-ui,sans-serif';
    c.fillText(t('repSnapNone'), 68, y2 + 38);
  }
  if (r.dims) {
    c.fillStyle = '#0e7c66'; c.font = 'bold 18px "Microsoft YaHei",system-ui,sans-serif';
    c.fillText(t('repRadar'), 470, y2);
    drawRadarCanvas(c, 640, y2 + 160, 110, r.dims);
  }
  y2 += 340;
  c.fillStyle = '#0e7c66'; c.font = 'bold 18px "Microsoft YaHei",system-ui,sans-serif';
  c.fillText(t('repTrend30'), 68, y2);
  drawTrendCanvas(c, 68, y2 + 18, W - 136, 130, r.trend30);
  y = y2 + 200;
  c.fillStyle = '#0e7c66'; c.font = 'bold 18px "Microsoft YaHei",system-ui,sans-serif';
  c.fillText(t('repSuggest'), 68, y + 26);
  y += 62;
  reportAdvice(r).slice(0, 5).forEach((a, i) => {
    c.fillStyle = '#22262e'; c.font = '16px "Microsoft YaHei",system-ui,sans-serif';
    const line = `${i + 1}. ${a}`;
    let rest = line;
    while (rest.length) {
      const cut = rest.slice(0, 42);
      c.fillText(cut, 68, y);
      rest = rest.slice(42);
      y += 26;
    }
    y += 10;
  });
  c.fillStyle = '#69707c'; c.font = '13px "Microsoft YaHei",system-ui,sans-serif';
  c.fillText(t('repDisclaimer'), 68, H - 70);
  cv.toBlob((b) => { if (b) downloadBlob(`${t('fileReport')}-${new Date().toISOString().slice(0, 10)}.png`, b); }, 'image/png');
  toast(t('repDone'));
}
$('btn-rep-html').addEventListener('click', exportReportHtml);
$('btn-rep-png').addEventListener('click', exportReportPng);
$('btn-rep-copy').addEventListener('click', async () => {
  const txt = reportSummaryText(buildReportData());
  try { await navigator.clipboard.writeText(txt); toast(t('repCopyOk')); }
  catch { toast(t('repCopyFail')); }
});

/* ============ v2.23.0 新模块：康复小课堂（患者教育）+ 疼痛上升预警 ============ */
// 对标 PhysioTrack / ReplayRehab：把「问题→训练」补上「为什么会这样、不纠正会怎样、日常注意什么」。
const EDU_CARDS = [
  { id: 'round', ico: 'shoulderraise', go: 'guide', key: 'eduRound' },     // 圆肩 → 体态改善课
  { id: 'valgus', ico: 'squat', go: 'train', key: 'eduValgus' },            // 膝内扣 → 训练页
  { id: 'pelvic', ico: 'bridge', go: 'guide', key: 'eduPelvic' },           // 骨盆前倾 → 体态改善课
  { id: 'fhead', ico: 'standing', go: 'guide', key: 'eduFHead' },           // 头前伸 → 体态改善课
  { id: 'lowback', ico: 'hiphinge', go: 'train', key: 'eduLowBack' },       // 下背痛 → 训练页
];
const eduOpen = {};
function renderEdu() {
  const el = $('edu-list');
  if (!el) return;
  el.innerHTML = EDU_CARDS.map((c) => {
    const open = !!eduOpen[c.id];
    return `<div class="edu-card ${open ? 'on' : ''}">
      <button class="edu-head" data-edu="${c.id}">
        <span class="edu-ico">${icon(c.ico)}</span>
        <span class="edu-t">${t(c.key + 'T')}</span>
        <span class="edu-arrow">${open ? '−' : '+'}</span>
      </button>
      ${open ? `<div class="edu-body">
        <p><b>${t('eduWhy')}</b>${t(c.key + 'Why')}</p>
        <p><b>${t('eduRisk')}</b>${t(c.key + 'Risk')}</p>
        <p><b>${t('eduDaily')}</b>${t(c.key + 'Daily')}</p>
        <button class="btn small" data-edugo="${c.go}">${t('eduGo')} →</button>
      </div>` : ''}
    </div>`;
  }).join('');
  el.querySelectorAll('[data-edu]').forEach((b) => b.addEventListener('click', () => {
    eduOpen[b.dataset.edu] = !eduOpen[b.dataset.edu];
    renderEdu();
  }));
  el.querySelectorAll('[data-edugo]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.edugo)));
}
// 疼痛上升预警：同一天「训练后 − 训练前 ≥ 2 分」→ 建议降强度或暂停该动作
function painTodayPair() {
  const k = dayKeyOf(Date.now());
  const rows = painHistory().filter((r) => dayKeyOf(r.ts) === k);
  const pre = rows.filter((r) => r.when === 'pre').pop();
  const post = rows.filter((r) => r.when === 'post').pop();
  return (pre && post) ? { pre: pre.v, post: post.v, delta: post.v - pre.v } : null;
}
function painSpike() {
  const p = painTodayPair();
  // v2.28.0：阈值不再写死，由「智能引擎」里的设置决定（默认 2 分，可改 1–4 或关闭自动调参）
  const thr = Number(aiPrefs().painAlarm) || 2;
  return (p && p.delta >= thr) ? p : null;
}

/* ============ v2.22.0 新模块：疼痛管理（VAS 0–10 · 训练前后 · 趋势） ============ */
// 对标 PhysiApp / Kaia Health：每次训练前后各记一次疼痛，疼痛变化进入趋势与恢复建议。
const PAIN_MAX = 10;
const painHistory = () => sget('rehab_pain_history', []);
const painSave = (list) => sset('rehab_pain_history', list.slice(0, 120));
function painAdd(when, v, part, note) {
  const h = painHistory();
  h.unshift({ id: uid(), ts: Date.now(), when, v, part: part || 'other', note: note || '' });
  painSave(h);
}
const painLevelOf = (v) => (v <= 3 ? 'good' : v <= 6 ? 'warn' : 'bad');
const painLvKey = (v) => 'painLv' + (v <= 3 ? 'Low' : v <= 6 ? 'Mid' : 'High');
const dayKeyOf = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// 近 N 天：每天取最后一次「训练前 / 训练后」评分，供双线趋势图
function painDailyPairs(days = 14) {
  const h = painHistory();
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const k = dayKeyOf(d.getTime());
    const rows = h.filter((r) => dayKeyOf(r.ts) === k);
    const pre = rows.filter((r) => r.when === 'pre').pop();
    const post = rows.filter((r) => r.when === 'post').pop();
    const any = rows[0];
    out.push({ k, pre: pre ? pre.v : null, post: post ? post.v : null, any: any ? any.v : null });
  }
  return out;
}
// 双线趋势图（纯新增，不动旧 lineChart）
function painChartSvg(pairs) {
  const W = 320, H = 92, P = 10;
  const n = pairs.length;
  const x = (i) => P + (W - 2 * P) * (i / Math.max(1, n - 1));
  const y = (v) => H - P - (H - 2 * P) * (Math.max(0, Math.min(PAIN_MAX, v)) / PAIN_MAX);
  const line = (key, color) => {
    const pts = pairs.map((p, i) => (p[key] == null ? null : { x: x(i), y: y(p[key]) })).filter(Boolean);
    if (!pts.length) return '';
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
      pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.2" fill="${color}"/>`).join('');
  };
  return `<div class="pain-legend"><span class="pl pre">${t('painPre')}</span><span class="pl post">${t('painPost')}</span><span class="pl risk">${t('painRiskLine')}</span></div>
    <svg viewBox="0 0 ${W} ${H}" class="line-chart" preserveAspectRatio="none">
      <line x1="${P}" y1="${y(7).toFixed(1)}" x2="${W - P}" y2="${y(7).toFixed(1)}" stroke="#f0d9d5" stroke-width="1" stroke-dasharray="3 3"/>
      ${line('pre', '#0e7c66')}${line('post', '#e07a5f')}
    </svg>`;
}
// 近 N 天最高疼痛（供今日页建议与 AI 管家）
function painRecentMax(days = 7) {
  const from = Date.now() - days * 86400000;
  const list = painHistory().filter((r) => r.ts >= from);
  return list.length ? Math.max(...list.map((r) => r.v)) : null;
}
function renderPain() {
  const el = $('pain-now');
  if (!el) return;
  const h = painHistory();
  const todayK = dayKeyOf(Date.now());
  const today = h.filter((r) => dayKeyOf(r.ts) === todayK);
  const preT = today.filter((r) => r.when === 'pre').pop();
  const postT = today.filter((r) => r.when === 'post').pop();
  const last = today[0] || h[0] || null;
  el.innerHTML = `<div class="pain-now-row">
    <span class="pain-chip ${preT ? painLevelOf(preT.v) : 'none'}">${t('painPre')} · ${preT ? preT.v : '—'}</span>
    <span class="pain-chip ${postT ? painLevelOf(postT.v) : 'none'}">${t('painPost')} · ${postT ? postT.v : '—'}</span>
    ${preT && postT ? `<span class="pain-delta ${postT.v > preT.v ? 'up' : postT.v < preT.v ? 'down' : ''}">${postT.v > preT.v ? t('painUp', { d: postT.v - preT.v }) : postT.v < preT.v ? t('painDown', { d: preT.v - postT.v }) : t('painSame')}</span>` : ''}
    ${last ? `<span class="hint tiny">${t('painLast', { d: dayKeyOf(last.ts).slice(5), v: last.v })}</span>` : ''}
  </div>`;
  const sp = painSpike();
  if (sp) {
    el.innerHTML += `<div class="pain-spike">${t('painSpikeTip', { d: sp.delta, post: sp.post })}
      <button class="link-btn" id="pain-spike-more">${t('painSpikeBtn')} →</button></div>`;
    const mb = $('pain-spike-more');
    if (mb) mb.addEventListener('click', () => switchTab('posture'));   // 去「康复小课堂」看日常注意与训练
  }
  const chartEl = $('pain-chart');
  if (chartEl) chartEl.innerHTML = painChartSvg(painDailyPairs(14));
  const list = $('pain-list');
  if (!h.length) { if (list) list.innerHTML = emptyBox('alert', 'painNone'); }
  else if (list) {
    list.innerHTML = h.slice(0, 6).map((r) => `
      <div class="item">
        <div>
          <div class="t"><span class="t-ico">${icon('alert')}</span>${r.v} · ${t(r.when === 'pre' ? 'painPre' : r.when === 'post' ? 'painPost' : 'painManual')}
            <span class="pain-lv ${painLevelOf(r.v)}">${t(painLvKey(r.v))}</span></div>
          <div class="d">${new Date(r.ts).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${r.note ? ' · ' + r.note : ''}</div>
        </div>
        <div><button class="mini del" data-paindel="${r.id}">${icon('trash')}</button></div>
      </div>`).join('');
    list.querySelectorAll('[data-paindel]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm(t('confirmDelPain'))) return;
      painSave(painHistory().filter((r) => r.id !== b.dataset.paindel));
      renderPain(); renderPainStrip();
      toast(t('toastDeleted'));
    }));
  }
  // 今日页提示行（与今日总览同源，不改动 renderHome）
  const hp = $('home-pain');
  if (hp) {
    const mx = painRecentMax(7);
    const sp2 = painSpike();
    hp.className = 'hint tiny' + ((sp2 || (mx != null && mx >= 7)) ? ' warn' : '');
    hp.textContent = sp2
      ? t('homePainSpike', { d: sp2.delta, post: sp2.post })
      : mx == null ? t('painNone') : mx >= 7 ? t('homePainHigh', { v: mx }) : t('homePainOk', { v: mx });
  }
}
function renderPainStrip() {
  const el = $('pain-strip');
  if (!el) return;
  const todayK = dayKeyOf(Date.now());
  const h = painHistory().filter((r) => dayKeyOf(r.ts) === todayK);
  const pre = h.filter((r) => r.when === 'pre').pop();
  const post = h.filter((r) => r.when === 'post').pop();
  el.innerHTML = `<button class="pain-mini ${pre ? painLevelOf(pre.v) : ''}" data-pain="pre">${t('painPre')} ${pre ? pre.v : '—'}</button>
    <button class="pain-mini ${post ? painLevelOf(post.v) : ''}" data-pain="post">${t('painPost')} ${post ? post.v : '—'}</button>
    <span class="hint tiny">${t('painStripHint')}</span>`;
  el.querySelectorAll('[data-pain]').forEach((b) => b.addEventListener('click', () => openPainModal(b.dataset.pain)));
}
const painState = { when: 'pre', v: null };
function renderPainScale() {
  const el = $('pain-scale');
  el.innerHTML = Array.from({ length: PAIN_MAX + 1 }, (_, v) => `<button class="pain-btn ${painLevelOf(v)} ${painState.v === v ? 'on' : ''}" data-pv="${v}">${v}</button>`).join('');
  el.querySelectorAll('[data-pv]').forEach((b) => b.addEventListener('click', () => { painState.v = Number(b.dataset.pv); renderPainScale(); }));
}
function openPainModal(when) {
  painState.when = when || 'pre';
  painState.v = null;
  $('pain-modal-title').textContent = t(painState.when === 'pre' ? 'painPickPre' : 'painPickPost');
  $('pain-note').value = '';
  renderPainScale();
  $('pain-modal').classList.remove('hidden');
}
$('btn-pain-pre').addEventListener('click', () => openPainModal('pre'));
$('btn-pain-post').addEventListener('click', () => openPainModal('post'));
$('pain-cancel').addEventListener('click', () => $('pain-modal').classList.add('hidden'));
$('pain-save').addEventListener('click', () => {
  if (painState.v == null) { toast(t('painPickFirst')); return; }
  painAdd(painState.when, painState.v, $('pain-part').value, $('pain-note').value.trim());
  $('pain-modal').classList.add('hidden');
  renderPain(); renderPainStrip(); renderCareLoop();
  aiRun();                              // v2.22.0：疼痛数据 → AI 管家建议即时更新
  toast(t('toastPainSaved', { v: painState.v }));
  scheduleCloudSync();
});

/* ============ v2.21.10 全局：键盘操作、无障碍语义与弹窗焦点 ============ */
const NAV_TABS = ['home', 'train', 'posture', 'ft', 'guide', 'record', 'assess', 'schedule', 'settings'];
const FOCUS_MODALS = ['onboard', 'qr-modal', 'fb-modal'];      // 打开时接管焦点、关闭时归还
const ESC_MODALS = ['qr-modal', 'fb-modal', 'onboard'];        // Esc 可关闭（登录屏不可关，避免误退）
const focusTrap = { prev: null };
// 底部导航按钮的 aria-label 跟随可见文字与语言（中文 →「训练」，英文 →「Train」）
function navLabelSync() {
  document.querySelectorAll('.bottom-nav button').forEach((b) => {
    const lab = b.querySelector('.nav-label');
    if (lab) b.setAttribute('aria-label', lab.textContent.trim());
  });
  const nav = document.querySelector('.bottom-nav');
  if (nav) nav.setAttribute('aria-label', t('navMain'));
}
function modalFocusIn(el) {
  if (!el || el.dataset.a11yFocus === '1') return;
  el.dataset.a11yFocus = '1';
  if (document.activeElement && document.activeElement !== document.body) focusTrap.prev = document.activeElement;
  const target = el.querySelector('input, button, [href], select, textarea');
  if (target) { try { target.focus({ preventScroll: true }); } catch { /* ignore */ } }
}
function modalFocusOut(el) {
  if (el) el.dataset.a11yFocus = '';
  const p = focusTrap.prev;
  focusTrap.prev = null;
  if (p && document.contains(p)) { try { p.focus({ preventScroll: true }); } catch { /* ignore */ } }
}
function closeTopModal() {
  if (syncState.scanning) { cancelSyncScan(); return true; }   // 扫码中：Esc 结束扫码
  for (const id of ESC_MODALS.slice().reverse()) {
    const el = $(id);
    if (!el || el.classList.contains('hidden')) continue;
    if (id === 'qr-modal') stopSyncShow();
    else if (id === 'fb-modal') el.classList.add('hidden');
    else closeOnboard();
    return true;
  }
  return false;
}
const isTypingTarget = (el) => !!(el && el.closest && el.closest('input, textarea, select, [contenteditable="true"]'));
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' || ev.key === 'Esc') { if (closeTopModal()) ev.preventDefault(); return; }
  if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;      // 不抢系统快捷键
  if (isTypingTarget(ev.target)) return;                                 // 输入框里输入数字不切页
  for (const id of ESC_MODALS) { const el = $(id); if (el && !el.classList.contains('hidden')) return; }
  const n = Number(ev.key);
  if (Number.isInteger(n) && n >= 1 && n <= NAV_TABS.length) { switchTab(NAV_TABS[n - 1]); ev.preventDefault(); }
});
// 弹窗显隐 → 自动接管/归还焦点（观察器实现，纯新增，不改动旧的开合逻辑）
const modalObserver = new MutationObserver((list) => {
  list.forEach((m) => {
    const el = m.target;
    if (!el || !el.classList) return;
    if (el.classList.contains('hidden')) modalFocusOut(el);
    else modalFocusIn(el);
  });
});
FOCUS_MODALS.forEach((id) => { const el = $(id); if (el) modalObserver.observe(el, { attributes: true, attributeFilter: ['class'] }); });
// 注意：navLabelSync() 必须等 initI18n() 把可见文字本地化之后再调用（见启动段）

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
  renderSedentary();                                    // 久坐提醒设置随语言切换
  renderPaUI();                                         // 体态评估页随语言切换
  renderFtUI();                                         // 功能测试页随语言切换
  renderHome();                                         // v2.21：今日总览随语言切换
  renderGuide();                                        // v2.21：跟练页随语言切换
  renderTrainToday();                                   // v2.21.5：训练页今日任务小条随语言切换
  renderStorageSize();                                  // v2.21.9：数据占用随语言切换
  renderLastBackup();                                   // v2.21.9：上次备份提示随语言切换
  navLabelSync();                                       // v2.21.10：导航 aria-label 随语言切换
  renderPain(); renderPainStrip();                      // v2.22.0：疼痛卡随语言切换
  renderEdu();                                          // v2.23.0：康复小课堂随语言切换
  renderReport();                                       // v2.24.0：治疗师报告摘要随语言切换
  renderRomUI(); renderRomHistory(); renderRomResult(romHistory()[0] || null);   // v2.26.0：ROM 随语言切换
  renderPromUI(); renderPromHistory();                  // v2.27.0：PROMs 随语言切换
  renderAiPlan(); renderAiEngine();                     // v2.28.0：自适应引擎随语言切换
  renderPath();                                         // v2.29.0：康复路径随语言切换
  renderCamCard();                                      // v2.30.0：影像设置随语言切换
  renderCareLoop();                                     // v2.31.0：康复闭环随语言切换
  renderBlockSub(); renderRecheck();                    // v2.33.0：子标签与复评页随语言切换
  $('about-version').textContent = t('versionLabel', { v: APP_VERSION });   // v2.21.9：关于页版本号随语言切换（原来只设置一次）
  setStartBtn(state.running ? 'btnStop' : 'btnStart', state.running ? 'stop' : 'play');
  $('btn-collect-label').textContent = state.collectMode ? t('btnCollectStop') : t('btnCollect');
  $('feedback')._last = null;
  if (state.running) state.statsKey = null;   // 下一帧按新语言重建统计
  else $('feedback').classList.add('hidden'); // 不训练时反馈条不残留旧语言文案
  if (!$('onboard').classList.contains('hidden')) renderOnboard();        // 引导页随语言切换
  if (!$('fb-modal').classList.contains('hidden')) openFeedback();         // 反馈弹窗报告随语言切换
  if (!$('custom-form-card').classList.contains('hidden')) $('cf-title').textContent = editingCustomId ? t('cfTitleEdit') : t('cfTitleNew');
  renderQrFrame();                                                          // 二维码同步帧（如可见）
  if (state._lastCamErr && !$('cam-retry').classList.contains('hidden')) showCameraError(state._lastCamErr, state._lastCamIsModel);
});
renderExChips(); renderCollectLabels(getEx(activeExId())); resetAgg();
renderRecords(); renderAssessments(); renderAppts(); renderCustomList();
renderCollectCount();
renderProfile(); renderReminder(); renderCloud(); renderAuth();
renderTodayPlan(); renderPlanList();
renderVoice();
renderSedentary();
// v2.19：体态评估页初始化（选择体态 / 开始与演示按钮）
renderPaUI();
document.querySelectorAll('.pa-kind').forEach((b) => b.addEventListener('click', () => {
  paState.kind = b.dataset.pa;
  paState.report = null;
  $('pa-report').classList.add('hidden');
  renderPaUI();
}));
$('btn-pa-start').addEventListener('click', () => { paStart(false); });
$('btn-pa-demo').addEventListener('click', () => { paStart(true); });
// v2.20：功能测试页初始化
renderFtUI();
$('btn-ft-start').addEventListener('click', () => { ftStart(ftState.key, false); });
$('btn-ft-demo').addEventListener('click', () => { ftStart(ftState.key, true); });
$('btn-ft-battery').addEventListener('click', () => { ftStart('battery', false); });
window.__ftBatteryDemo = () => ftStart('battery', true);   // 测试钩子：完整测试演示模式
// v2.21：今日总览 + 跟练初始化
renderHome();
renderGuide();
renderTrainToday();
renderStorageSize();
renderLastBackup();
navLabelSync();                                          // v2.21.10：本地化后再同步导航 aria-label
renderPain(); renderPainStrip();                         // v2.22.0：疼痛卡初始化
renderEdu();                                             // v2.23.0：康复小课堂初始化
renderReport();                                          // v2.24.0：治疗师报告摘要初始化
renderRomUI(); renderRomHistory(); renderRomResult(null); // v2.26.0：ROM 测量初始化
renderPromUI(); renderPromHistory();                     // v2.27.0：PROMs 量表初始化
renderAiPlan(); renderAiEngine();                        // v2.28.0：自适应引擎初始化
renderPath();                                            // v2.29.0：康复路径初始化
renderCamCard();                                         // v2.30.0：影像设置初始化
renderCareLoop();                                        // v2.31.0：康复闭环初始化
renderRelayState();                                      // v2.32.0：端手接力状态
renderBlockSub(); renderRecheck();                        // v2.33.0：三块式架构与复评页初始化
window.__gwSkip = () => gwFinish(true);                   // 测试钩子：直接完成当前跟练
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
