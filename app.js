// 康复AI · 火柴人姿势分析 — 浏览器端 App（手机/电脑通用，数据存本机）
// 支持：深蹲/弓步蹲/俯卧撑/自定义动作、实时火柴人、数据采集闭环、记录/评估/日程
import { FilesetResolver, PoseLandmarker } from './vision_bundle.mjs';
import { t, getLang, locale, initI18n, onLangChanged } from './i18n.js';
import {
  EXERCISES, analyzeAny, loadCustomExercises, saveCustomExercises,
  customDefault, CUSTOM_JOINTS, angle3, kneeValgus, pickSide,
} from './analysis.js';

/* ============ 基础工具 ============ */
const $ = (id) => document.getElementById(id);
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};
const fmtDate = (ts) => new Date(ts).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const exName = (e) => (e.custom ? e.name : t(e.nameKey));
const exDesc = (e) => (e.custom ? e.desc : t(e.descKey));
const depthTxt = (d) => t('depth' + (d ? d.charAt(0).toUpperCase() + d.slice(1) : 'Ok')) || d;

/* ============ 定制图标组（线稿风格，替代 emoji） ============ */
const ICONS = {
  squat: '<circle cx="12" cy="4.6" r="2.1"/><path d="M12 6.7v5.8M12 12.5 8.6 15.6 10.8 19.6M12 9.6l4.2-.8"/>',
  lunge: '<circle cx="9.8" cy="4.6" r="2.1"/><path d="M9.8 6.7v5.5M9.8 12.2l4.8 2.9 4.6 4.4M9.8 12.2l-4.2 2.3-2.2 4.6M9.8 9l4.4-1"/>',
  pushup: '<circle cx="5.2" cy="9.2" r="2.1"/><path d="M7.3 9.6 16.8 12.4M8.4 10 8.4 16.2M17.9 12.8v-1.5"/>',
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
  ex: null, collectBuf: LS.get('rehab_collect', []),
  cameras: null, pickCam: undefined,
  tab: 'train', statsKey: null, loopScheduled: false,
};
let _customCache = null;
const customList = () => { if (_customCache === null) _customCache = loadCustomExercises(); return _customCache; };
const invalidateCustom = () => { _customCache = null; };
const getEx = (id) => EXERCISES[id] || customList().find((e) => e.id === id);
const activeExId = () => LS.get('rehab_active_ex', 'squat');

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
  const candidates = [
    { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },   // 低配设备兜底
    ...state.cameras.filter((c) => c.deviceId).map((c) => ({
      video: { deviceId: { exact: c.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    })),
  ];
  let lastErr = null;
  for (const c of candidates) {
    try { return await openCameraWithTimeout(c); } catch (e) { lastErr = e; }
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

/* ============ 界面：动作选择 + 统计 ============ */
function featureNames(ex) {
  if (ex.id === 'squat') return ['knee', 'hip', 'lean', 'valgus'];
  if (ex.id === 'lunge') return ['frontKnee', 'backKnee', 'lean'];
  if (ex.id === 'pushup') return ['elbow', 'body'];
  return ex.angles.map((a) => a.key);
}
function renderExChips() {
  const custom = customList();
  const ids = ['squat', 'lunge', 'pushup', ...custom.map((e) => e.id)];
  $('ex-chips').innerHTML = ids.map((id) => {
    const e = EXERCISES[id] || custom.find((x) => x.id === id);
    return `<button class="chip ${id === activeExId() ? 'on' : ''}" data-ex="${id}"><span class="chip-ico">${icon(e.icon)}</span><span>${exName(e)}</span></button>`;
  }).join('') + `<button class="chip plus" id="chip-add"><span class="chip-ico">${icon('plus')}</span><span>${t('chipAdd')}</span></button>`;
  $('ex-chips').querySelectorAll('.chip[data-ex]').forEach((b) =>
    b.addEventListener('click', () => { LS.set('rehab_active_ex', b.dataset.ex); switchEx(); }));
  $('chip-add').addEventListener('click', () => { openCustomForm(null); switchTab('settings'); });
  const ex = getEx(activeExId());
  $('ex-desc').textContent = ex ? exDesc(ex) : '';
}
function renderChips(res) {
  const chips = res.chips.map((c, i) => `
    <div class="stat"><span class="s-label">${c.k}</span><span class="s-value ${c.cls}" data-stat="${i}">${c.v}</span></div>`).join('');
  $('chips').innerHTML = chips + `
    <div class="stat big"><span class="s-label">${t('repsLabel')}</span><span class="s-value" id="st-reps">0</span></div>`;
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
function renderCollectLabels(ex) {
  $('collect-labels').innerHTML = ex.labelSet.map((l) =>
    `<button class="cbtn" data-label="${l}">${t('lb_' + l) || l}</button>`).join('');
  $('collect-labels').querySelectorAll('.cbtn').forEach((b) =>
    b.addEventListener('click', () => {
      const m = state.lastResult;
      if (!m) { toast(t('toastNeedPerson')); return; }
      state.collectBuf.push({ ex: ex.id, feats: m.features, label: b.dataset.label });
      LS.set('rehab_collect', state.collectBuf);
      renderCollectCount();
      toast(t('toastLabeled', { label: b.dataset.label }));
    }));
}

/* ============ 主分析循环 ============ */
const ctx = $('overlay').getContext('2d');

function resetAgg() {
  const ex = getEx(activeExId());
  state.counter = { state: 'up', reps: 0, ex: ex.id, d: ex.rep.downBelow, u: ex.rep.upAbove, belowT: 0, lastRepTs: 0, confirmMs: 120, minGapMs: 350 };
  state.agg = { frames: 0, startTS: Date.now(), depth: {}, badFrames: 0, valgusFrames: 0 };
  state.lastResult = null;
  state.statsKey = null;
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

// 每帧质量统计：深度类别 / 不合格帧 / 内扣帧（修复：之前保存记录时这些一直是 0）
function recordFrame(res) {
  const a = state.agg;
  a.frames++;
  if (res.depth && res.depth !== 'ok') a.depth[res.depth] = (a.depth[res.depth] || 0) + 1;
  if (res.msgsIsBad) a.badFrames++;
  if (res.metrics && res.metrics.valgus > 0.15) a.valgusFrames++;
}

// 单一调度入口：只在训练页可见且页面在前台时排帧（省电）
function kickLoop() {
  if (state.loopScheduled) return;
  if (!state.running || state.photoMode || state.tab !== 'train' || document.hidden) return;
  state.loopScheduled = true;
  requestAnimationFrame(() => { state.loopScheduled = false; loop(); });
}

function loop() {
  if (!state.running || state.photoMode || state.tab !== 'train' || document.hidden) return;
  const video = $('video');
  if (!state.videoOn || video.readyState < 2) { kickLoop(); return; }
  const ts = performance.now();
  if (ts - state.lastTS < 33) { kickLoop(); return; }
  state.lastTS = ts;
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
  const ex = getEx(activeExId());
  const res = analyzeAny(lms, ex);
  state.lastResult = res;

  const cw = $('overlay').clientWidth, ch = $('overlay').clientHeight;
  if ($('overlay').width !== cw || $('overlay').height !== ch) { $('overlay').width = cw; $('overlay').height = ch; }
  ctx.clearRect(0, 0, cw, ch);
  drawStick(ctx, lms, cw, ch, true);

  recordFrame(res);
  const reps = counterUpdate(state.counter, res.repValue, ts);
  if (state.statsKey !== ex.id) { renderChips(res); state.statsKey = ex.id; }
  else updateStats(res);
  $('st-reps').textContent = String(reps);

  const msgs = res.badMsgs.length ? res.badMsgs : res.goodMsgs;
  const msg = fbWrap(res.msgsIsBad ? 'alert' : 'check', msgs.join('<br>'));
  if (fb._last !== msg) { fb.innerHTML = msg; fb._last = msg; }
  const cls = 'feedback' + (res.msgsIsBad ? ' bad' : res.depth !== 'ok' ? ' warn' : '');
  if (fb.className !== cls) fb.className = cls;

  if (state.collectMode) $('collect-feats').textContent = t('collectFeats', { f: res.features.join(', ') });
  if ($('btn-save').disabled && (state.agg.frames >= 30 || state.counter.reps >= 1)) $('btn-save').disabled = false;
  kickLoop();
}
function drawEmpty() { ctx.clearRect(0, 0, $('overlay').width, $('overlay').height); }

/* ============ 开始 / 停止 / 图片 ============ */
function setStartBtn(key, ico) {
  $('btn-start-label').textContent = t(key);
  $('btn-start-ico').innerHTML = icon(ico || 'play');
}
async function toggleStart() {
  const btn = $('btn-start');
  if (state.running) { state.running = false; stopCamera(); btn.disabled = false; setStartBtn('btnStart', 'play'); return; }
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
        stopCamera();
        state.running = false;
        setStartBtn('btnStart', 'play');
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
  if (state.running) { state.running = false; stopCamera(); setStartBtn('btnStart', 'play'); $('btn-start').disabled = false; }
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
    if (state.running) { state.running = false; stopCamera(); setStartBtn('btnStart', 'play'); $('btn-start').disabled = false; }
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
    collectCount: state.collectBuf.length,
  };
  const list = LS.get('rehab_sessions', []);
  list.unshift(session);
  LS.set('rehab_sessions', list);
  resetAgg();
  renderRecords();
  toast(t('toastSaved'));
});

/* ============ 记录打卡页 ============ */
function renderRecords() {
  const sessions = LS.get('rehab_sessions', []);
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
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    if (sessions.some((s) => new Date(s.ts).toDateString() === d.toDateString())) streak++;
    else if (i > 0) break;
  }
  $('summary-line').textContent = sessions.length
    ? t('summaryLine', { n: sessions.length, r: totalReps, s: streak })
    : t('noSessions');
  const list = $('session-list');
  if (!sessions.length) { list.innerHTML = emptyBox('record', 'emptyList'); return; }
  list.innerHTML = sessions.slice(0, 20).map((s) => {
    const builtin = EXERCISES[s.ex];
    const name = builtin ? exName(builtin) : (s.exName || '?');
    return `
    <div class="item">
      <div>
        <div class="t"><span class="t-ico">${icon(builtin ? builtin.icon : 'custom')}</span>${name} · ${fmtDate(s.ts)} · ${t('repsN', { n: s.reps })} · ${s.dur ?? '?'}s · ${depthTxt(s.depth)}</div>
        <div class="d">${t('badFramesPct', { p: s.badPct })}${s.badPct >= 30 ? ' ⚠️' : ''}${s.valgusPct ? ' · ' + t('valgusFramesPct', { p: s.valgusPct }) : ''}${s.collectCount ? ' · ' + t('collectN', { n: s.collectCount }) : ''}</div>
      </div>
      <button class="del" data-id="${s.id}">✕</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.del').forEach((btn) => btn.addEventListener('click', () => {
    LS.set('rehab_sessions', sessions.filter((s) => s.id !== btn.dataset.id));
    renderRecords();
  }));
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
  const list = LS.get('rehab_assessments', []);
  list.unshift(report);
  LS.set('rehab_assessments', list);
  const el = $('assess-result');
  el.innerHTML = `<b>${t('assessScore', { s: score })}</b><br>${adviceKeys.map((k) => t(k)).join('<br>')}`;
  el.classList.remove('hidden');
  renderAssessments();
});
const adviceText = (r) => (r.adviceKeys ? r.adviceKeys.map((k) => t(k)).join(' ') : (r.advice || ''));
function renderAssessments() {
  const list = LS.get('rehab_assessments', []);
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
    LS.set('rehab_assessments', list.filter((r) => r.id !== btn.dataset.id));
    renderAssessments();
  }));
}

/* ============ 预约日程页 ============ */
$('appt-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const appt = {
    id: uid(), date: $('appt-date').value, time: $('appt-time').value,
    place: $('appt-place').value.trim(), note: $('appt-note').value.trim(),
  };
  const list = LS.get('rehab_appts', []);
  list.push(appt);
  LS.set('rehab_appts', list);
  $('appt-form').reset();
  renderAppts();
  toast(t('toastAppt'));
});
function renderAppts() {
  const list = LS.get('rehab_appts', []).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
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
    LS.set('rehab_appts', list.filter((a) => a.id !== btn.dataset.id));
    renderAppts();
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
  state.collectBuf = []; LS.set('rehab_collect', []);
  renderCollectCount();
  toast(t('toastClearedCollect'));
});

/* ============ 设置页：导出 / 导入 / 清空 ============ */
$('btn-export').addEventListener('click', () => {
  const data = {
    app: '康复AI', version: 2, exportedAt: new Date().toISOString(),
    sessions: LS.get('rehab_sessions', []),
    assessments: LS.get('rehab_assessments', []),
    appts: LS.get('rehab_appts', []),
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
    LS.set('rehab_sessions', data.sessions || []);
    LS.set('rehab_assessments', data.assessments || []);
    LS.set('rehab_appts', data.appts || []);
    if (Array.isArray(data.customExercises)) { saveCustomExercises(data.customExercises); invalidateCustom(); }
    if (Array.isArray(data.collect)) { state.collectBuf = data.collect; LS.set('rehab_collect', data.collect); }
    renderRecords(); renderAssessments(); renderAppts(); renderCustomList(); renderExChips();
    toast(t('toastImportOk'));
  } catch (e) { toast(t('toastImportFail', { msg: e.message })); }
  ev.target.value = '';
});
$('btn-clear').addEventListener('click', () => {
  if (!confirm(t('confirmClearAll'))) return;
  ['rehab_sessions', 'rehab_assessments', 'rehab_appts', 'rehab_custom_ex', 'rehab_collect'].forEach((k) => localStorage.removeItem(k));
  state.collectBuf = [];
  invalidateCustom();
  renderRecords(); renderAssessments(); renderAppts(); renderCustomList(); renderExChips();
  renderCollectCount();
  toast(t('toastClearedAll'));
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
    out.innerHTML += `<div class="st-pass" style="margin-top:8px;font-weight:800">${t('stAllPass')}</div>`;
    console.log('SELFTEST: ALL PASS');
  } catch (e) {
    out.innerHTML += `<div class="st-fail">${t('stError', { msg: e.message })}</div>`;
    console.log('SELFTEST: ERROR', e);
  }
}

/* ============ 启动 ============ */
initI18n();
onLangChanged(() => {
  renderExChips(); renderCollectLabels(getEx(activeExId()));
  renderRecords(); renderAssessments(); renderAppts(); renderCustomList();
  renderCollectCount();
  setStartBtn(state.running ? 'btnStop' : 'btnStart', state.running ? 'stop' : 'play');
  $('btn-collect-label').textContent = state.collectMode ? t('btnCollectStop') : t('btnCollect');
  $('feedback')._last = null;
  if (state.running) state.statsKey = null;   // 下一帧按新语言重建统计
  if (state._lastCamErr && !$('cam-retry').classList.contains('hidden')) showCameraError(state._lastCamErr, state._lastCamIsModel);
});
renderExChips(); renderCollectLabels(getEx(activeExId())); resetAgg();
renderRecords(); renderAssessments(); renderAppts(); renderCustomList();
renderCollectCount();
$('btn-collect-label').textContent = t('btnCollect');
setStartBtn('btnStart', 'play');
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
