// analysis.js — 动作分析引擎：深蹲 / 弓步蹲 / 俯卧撑 / 自定义动作
// 所有角度/规则与 Python 版 rehab-ai 保持一致；提示语通过 i18n 中英双语输出
import { t } from './i18n.js';

/* ============ 基础数学 ============ */
export function angle3(a, b, c) {          // 三点夹角（度），顶点 b
  const ax = a.x - b.x, ay = a.y - b.y, cx = c.x - b.x, cy = c.y - b.y;
  const dot = ax * cx + ay * cy, la = Math.hypot(ax, ay), lb = Math.hypot(cx, cy);
  if (!la || !lb) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / (la * lb)))) * 180 / Math.PI;
}
export function verticalAngle(a, b) {      // a->b 与竖直方向夹角
  const vx = b.x - a.x, vy = b.y - a.y, len = Math.hypot(vx, vy);
  if (!len) return 0;
  return Math.acos(Math.min(1, Math.abs(vy) / len)) * 180 / Math.PI;
}
export function pickSide(lms) {
  const vr = lms[26].visibility ?? 1, vl = lms[25].visibility ?? 1;
  return vr >= vl
    ? { hip: 24, knee: 26, ankle: 28, shoulder: 12, elbow: 14, wrist: 16 }
    : { hip: 23, knee: 25, ankle: 27, shoulder: 11, elbow: 13, wrist: 15 };
}
export function kneeValgus(lms) {
  const hL = lms[23], hR = lms[24], kL = lms[25], kR = lms[26], aL = lms[27], aR = lms[28];
  const hipWidth = Math.abs(hR.x - hL.x);
  const frontal = hipWidth > 0.05;
  if (hipWidth < 1e-4) return { left: 0, right: 0, valgus: false, frontal };
  const midL = (hL.x + aL.x) / 2, midR = (hR.x + aR.x) / 2;
  const offL = (kL.x - midL) / hipWidth, offR = (midR - kR.x) / hipWidth;
  return { left: +offL.toFixed(2), right: +offR.toFixed(2), valgus: frontal && (offL > 0.15 || offR > 0.15), frontal };
}
// 自定义关节引用 → 实际 landmark 索引
const JOINT_REF = {
  shoulder: (lms) => { const s = pickSide(lms); return lms[s.shoulder]; },
  elbow: (lms) => { const s = pickSide(lms); return lms[s.elbow]; },
  wrist: (lms) => { const s = pickSide(lms); return lms[s.wrist]; },
  hip: (lms) => { const s = pickSide(lms); return lms[s.hip]; },
  knee: (lms) => { const s = pickSide(lms); return lms[s.knee]; },
  ankle: (lms) => { const s = pickSide(lms); return lms[s.ankle]; },
  shoulderMid: (lms) => ({ x: (lms[11].x + lms[12].x) / 2, y: (lms[11].y + lms[12].y) / 2 }),
  hipMid: (lms) => ({ x: (lms[23].x + lms[24].x) / 2, y: (lms[23].y + lms[24].y) / 2 }),
  nose: (lms) => lms[0],
};

/* ============ 通用分析 ============ */
// ex 结构（自定义动作）:
// { id, name, icon, angles:[{key,name,type:'angle'|'vertical',a,b,c}],
//   rules:[{metric,min?,max?,msgGood,msgBad}],
//   reps:{metric,downBelow,upAbove}, labelSet:[...] }
export function analyzeGeneric(lms, ex) {
  const metrics = {};
  for (const ang of ex.angles) {
    if (ang.type === 'vertical') metrics[ang.key] = verticalAngle(JOINT_REF[ang.a](lms), JOINT_REF[ang.b](lms));
    else metrics[ang.key] = angle3(JOINT_REF[ang.a](lms), JOINT_REF[ang.b](lms), JOINT_REF[ang.c](lms));
  }
  const goodMsgs = [], badMsgs = [];
  let depth = 'ok';
  for (const r of ex.rules) {
    const v = metrics[r.metric];
    const bad = (r.min !== undefined && v < r.min) || (r.max !== undefined && v > r.max);
    if (bad) { badMsgs.push(r.msgBad); depth = 'bad'; } else goodMsgs.push(r.msgGood);
  }
  const chips = ex.angles.map((ang) => {
    const v = metrics[ang.key];
    const r = ex.rules.find((x) => x.metric === ang.key);
    const bad = r && ((r.min !== undefined && v < r.min) || (r.max !== undefined && v > r.max));
    return { k: ang.name, v: `${Math.round(v)}°`, cls: bad ? 'bad' : 'ok' };
  });
  return {
    metrics, depth, goodMsgs, badMsgs, chips,
    features: ex.angles.map((ang) => +metrics[ang.key].toFixed(1)),
    repValue: metrics[ex.reps.metric],
    labelSet: ex.labelSet,
  };
}

/* ============ 深蹲（与 Python squat_checker 一致 + 内扣） ============ */
export function analyzeSquat(lms) {
  const s = pickSide(lms);
  const knee = angle3(lms[s.hip], lms[s.knee], lms[s.ankle]);
  const hipA = angle3(lms[s.shoulder], lms[s.hip], lms[s.knee]);
  const lean = verticalAngle(lms[s.shoulder], lms[s.hip]);
  const vg = kneeValgus(lms);
  const depth = knee > 125 ? 'shallow' : knee < 90 ? 'deep' : 'ok';
  const leanState = lean > 25 ? 'lean' : 'ok';
  const msgs = [];
  msgs.push(depth === 'shallow' ? t('sqShallow')
            : depth === 'deep' ? t('sqDeep') : t('sqDepthOk'));
  msgs.push(leanState === 'lean' ? t('sqLeanBad') : t('sqBackOk'));
  if (!vg.frontal) msgs.push(t('sqValgusSide'));
  else msgs.push(vg.valgus ? t('sqValgusBad') : t('sqValgusOk'));
  const valgusFeat = vg.frontal ? Math.max(vg.left, vg.right) : 0;
  return {
    metrics: { knee, hipA, lean, valgus: valgusFeat, vgL: vg.left, vgR: vg.right },
    depth, goodMsgs: [], badMsgs: msgs, msgsIsBad: vg.valgus || leanState === 'lean',
    chips: [
      { k: t('chipKnee'), v: `${Math.round(knee)}°`, cls: depth === 'ok' ? 'ok' : depth === 'shallow' ? 'warn' : 'bad' },
      { k: t('chipLean'), v: `${Math.round(lean)}°`, cls: leanState === 'ok' ? 'ok' : 'bad' },
      { k: t('chipDepth'), v: { ok: t('depthOk'), shallow: t('depthShallow'), deep: t('depthDeep') }[depth], cls: depth === 'ok' ? 'ok' : 'warn' },
      { k: t('chipValgus'), v: vg.frontal ? (vg.valgus ? t('valgusIn', { l: vg.left, r: vg.right }) : t('valgusOkVal')) : t('valgusSideVal'), cls: vg.valgus ? 'bad' : (vg.frontal ? 'ok' : 'warn') },
    ],
    features: [+knee.toFixed(1), +hipA.toFixed(1), +lean.toFixed(1), +valgusFeat.toFixed(2)],
    repValue: knee,
    labelSet: ['good', 'shallow', 'deep', 'lean', 'valgus'],
  };
}

/* ============ 弓步蹲 ============ */
export function analyzeLunge(lms) {
  const L = { hip: 23, knee: 25, ankle: 27, shoulder: 11 }, R = { hip: 24, knee: 26, ankle: 28, shoulder: 12 };
  const aL = angle3(lms[L.hip], lms[L.knee], lms[L.ankle]);
  const aR = angle3(lms[R.hip], lms[R.knee], lms[R.ankle]);
  // 前腿 = 膝盖弯得更深的那条（侧面视角）
  const front = aL < aR ? L : R, back = aL < aR ? R : L;
  const frontKnee = Math.min(aL, aR), backKnee = Math.max(aL, aR);
  const lean = verticalAngle(lms[front.shoulder], lms[front.hip]);
  const depth = frontKnee > 110 ? 'shallow' : frontKnee < 75 ? 'deep' : 'ok';
  const msgs = [];
  msgs.push(depth === 'shallow' ? t('luShallow')
            : depth === 'deep' ? t('luDeep') : t('luDepthOk'));
  msgs.push(backKnee > 140 ? t('luBackStraight') : t('luBackOk'));
  msgs.push(lean > 25 ? t('sqLeanBad') : t('sqBackOk'));
  return {
    metrics: { frontKnee, backKnee, lean },
    depth, goodMsgs: [], badMsgs: msgs, msgsIsBad: depth !== 'ok' || lean > 25,
    chips: [
      { k: t('chipFrontKnee'), v: `${Math.round(frontKnee)}°`, cls: depth === 'ok' ? 'ok' : 'warn' },
      { k: t('chipBackKnee'), v: `${Math.round(backKnee)}°`, cls: backKnee > 140 ? 'warn' : 'ok' },
      { k: t('chipLean'), v: `${Math.round(lean)}°`, cls: lean > 25 ? 'bad' : 'ok' },
    ],
    features: [+frontKnee.toFixed(1), +backKnee.toFixed(1), +lean.toFixed(1)],
    repValue: frontKnee,
    labelSet: ['good', 'frontShallow', 'frontDeep', 'lean'],
  };
}

/* ============ 俯卧撑 ============ */
export function analyzePushup(lms) {
  const s = pickSide(lms);
  const elbow = angle3(lms[s.shoulder], lms[s.elbow], lms[s.wrist]);
  // 身体直线度：肩-髋-踝 三点夹角（越接近 180° 越直）
  const body = angle3(lms[s.shoulder], lms[s.hip], lms[s.ankle]);
  const bodyLean = Math.abs(180 - body);
  const depth = elbow > 120 ? 'shallow' : elbow < 70 ? 'deep' : 'ok';
  const msgs = [];
  msgs.push(depth === 'shallow' ? t('puShallow')
            : depth === 'deep' ? t('puDeep') : t('puDepthOk'));
  msgs.push(bodyLean > 15 ? t('puSag') : t('puBodyOk'));
  return {
    metrics: { elbow, body: bodyLean },
    depth, goodMsgs: [], badMsgs: msgs, msgsIsBad: depth !== 'ok' || bodyLean > 15,
    chips: [
      { k: t('chipElbow'), v: `${Math.round(elbow)}°`, cls: depth === 'ok' ? 'ok' : 'warn' },
      { k: t('chipBody'), v: t('chipBodyOff', { n: Math.round(bodyLean) }), cls: bodyLean > 15 ? 'bad' : 'ok' },
    ],
    features: [+elbow.toFixed(1), +bodyLean.toFixed(1)],
    repValue: elbow,
    labelSet: ['good', 'shallow', 'sag'],
  };
}

/* ============ 内置动作注册表 ============ */
export const EXERCISES = {
  squat: { id: 'squat', nameKey: 'exSquat', icon: '🦵', analyze: analyzeSquat,
           rep: { downBelow: 100, upAbove: 150 }, descKey: 'exSquatDesc',
           labelSet: ['good', 'shallow', 'deep', 'lean', 'valgus'] },
  lunge: { id: 'lunge', nameKey: 'exLunge', icon: '🚶', analyze: analyzeLunge,
           rep: { downBelow: 100, upAbove: 150 }, descKey: 'exLungeDesc',
           labelSet: ['good', 'frontShallow', 'frontDeep', 'lean'] },
  pushup: { id: 'pushup', nameKey: 'exPushup', icon: '💪', analyze: analyzePushup,
            rep: { downBelow: 100, upAbove: 160 }, descKey: 'exPushupDesc',
            labelSet: ['good', 'shallow', 'sag'] },
};

/* ============ 自定义动作 ============ */
export const CUSTOM_JOINTS = [
  { v: 'shoulder', t: 'jShoulder' }, { v: 'elbow', t: 'jElbow' }, { v: 'wrist', t: 'jWrist' },
  { v: 'hip', t: 'jHip' }, { v: 'knee', t: 'jKnee' }, { v: 'ankle', t: 'jAnkle' },
  { v: 'shoulderMid', t: 'jShoulderMid' }, { v: 'hipMid', t: 'jHipMid' }, { v: 'nose', t: 'jNose' },
];
export function customDefault() {
  return {
    id: 'custom-' + Date.now().toString(36),
    name: t('customDefaultName'), icon: '⭐', custom: true,
    angles: [
      { key: 'a1', name: t('fallbackA1'), type: 'angle', a: 'hip', b: 'knee', c: 'ankle' },
      { key: 'a2', name: t('fallbackLean'), type: 'vertical', a: 'shoulder', b: 'hip' },
    ],
    rules: [
      { metric: 'a1', min: 90, max: 125, msgGood: t('cgA1Good'), msgBad: t('cgA1Bad') },
      { metric: 'a2', min: 0, max: 25, msgGood: t('cgA2Good'), msgBad: t('cgA2Bad') },
    ],
    reps: { metric: 'a1', downBelow: 100, upAbove: 150 },
    labelSet: ['good', 'bad'],
    desc: t('customDefaultDesc'),
  };
}
export function loadCustomExercises() {
  try { return JSON.parse(localStorage.getItem('rehab_custom_ex')) ?? []; }
  catch { return []; }
}
export function saveCustomExercises(list) { localStorage.setItem('rehab_custom_ex', JSON.stringify(list)); }

// 统一入口：给定动作 id/自定义对象，返回分析结果
export function analyzeAny(lms, ex) {
  if (ex.custom) return analyzeGeneric(lms, ex);
  return ex.analyze(lms);
}
