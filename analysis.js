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
  // 统一风险分级：1 = 提醒，2 = 警报
  const risk = []; let riskLevel = 0;
  if (vg.frontal && valgusFeat > 0.25) { riskLevel = 2; risk.push(t('riskValgusSevere')); }
  else if (vg.valgus) { riskLevel = 1; risk.push(t('riskValgus')); }
  if (lean > 35) { riskLevel = 2; risk.push(t('riskLeanSevere')); }
  else if (lean > 25) riskLevel = Math.max(riskLevel, 1);
  if (knee < 60) { riskLevel = 2; risk.push(t('riskKneeDeep')); }
  return {
    metrics: { knee, hipA, lean, valgus: valgusFeat, vgL: vg.left, vgR: vg.right },
    depth, goodMsgs: [], badMsgs: msgs, msgsIsBad: vg.valgus || leanState === 'lean',
    risk, riskLevel,
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
  const risk = []; let riskLevel = 0;
  if (frontKnee < 55) { riskLevel = 2; risk.push(t('riskKneeDeep')); }
  if (lean > 35) { riskLevel = 2; risk.push(t('riskLeanSevere')); }
  else if (lean > 25) riskLevel = Math.max(riskLevel, 1);
  return {
    metrics: { frontKnee, backKnee, lean },
    depth, goodMsgs: [], badMsgs: msgs, msgsIsBad: depth !== 'ok' || lean > 25,
    risk, riskLevel,
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
  const risk = []; let riskLevel = 0;
  if (bodyLean > 25) { riskLevel = 2; risk.push(t('riskBackRound')); }
  else if (bodyLean > 15) riskLevel = Math.max(riskLevel, 1);
  if (elbow < 50) { riskLevel = 2; risk.push(t('riskKneeDeep')); }
  return {
    metrics: { elbow, body: bodyLean },
    depth, goodMsgs: [], badMsgs: msgs, msgsIsBad: depth !== 'ok' || bodyLean > 15,
    risk, riskLevel,
    chips: [
      { k: t('chipElbow'), v: `${Math.round(elbow)}°`, cls: depth === 'ok' ? 'ok' : 'warn' },
      { k: t('chipBody'), v: t('chipBodyOff', { n: Math.round(bodyLean) }), cls: bodyLean > 15 ? 'bad' : 'ok' },
    ],
    features: [+elbow.toFixed(1), +bodyLean.toFixed(1)],
    repValue: elbow,
    labelSet: ['good', 'shallow', 'sag'],
  };
}

/* ============ 椅子起坐（一天最高频动作） ============ */
export function analyzeSitStand(lms) {
  const s = pickSide(lms);
  const knee = angle3(lms[s.hip], lms[s.knee], lms[s.ankle]);
  const lean = verticalAngle(lms[s.shoulder], lms[s.hip]);
  const vg = kneeValgus(lms);
  const depth = knee > 130 ? 'shallow' : knee < 80 ? 'deep' : 'ok';
  const msgs = [];
  msgs.push(depth === 'shallow' ? t('ssShallow')
            : depth === 'deep' ? t('ssDeep') : t('ssDepthOk'));
  msgs.push(lean > 30 ? t('sqLeanBad') : t('sqBackOk'));
  if (!vg.frontal) msgs.push(t('sqValgusSide'));
  else msgs.push(vg.valgus ? t('sqValgusBad') : t('sqValgusOk'));
  const valgusFeat = vg.frontal ? Math.max(vg.left, vg.right) : 0;
  const risk = []; let riskLevel = 0;
  if (vg.frontal && valgusFeat > 0.25) { riskLevel = 2; risk.push(t('riskValgusSevere')); }
  else if (vg.valgus) { riskLevel = 1; risk.push(t('riskValgus')); }
  if (lean > 40) { riskLevel = 2; risk.push(t('riskLeanSevere')); }
  else if (lean > 30) riskLevel = Math.max(riskLevel, 1);
  if (knee < 65) { riskLevel = 2; risk.push(t('riskKneeDeep')); }
  return {
    metrics: { knee, lean, valgus: valgusFeat },
    depth, goodMsgs: [], badMsgs: msgs, msgsIsBad: vg.valgus || lean > 30 || depth !== 'ok',
    risk, riskLevel,
    chips: [
      { k: t('chipKnee'), v: `${Math.round(knee)}°`, cls: depth === 'ok' ? 'ok' : depth === 'shallow' ? 'warn' : 'bad' },
      { k: t('chipLean'), v: `${Math.round(lean)}°`, cls: lean > 30 ? 'bad' : 'ok' },
      { k: t('chipDepth'), v: { ok: t('depthOk'), shallow: t('depthShallow'), deep: t('depthDeep') }[depth], cls: depth === 'ok' ? 'ok' : 'warn' },
      { k: t('chipValgus'), v: vg.frontal ? (vg.valgus ? t('valgusIn', { l: vg.left, r: vg.right }) : t('valgusOkVal')) : t('valgusSideVal'), cls: vg.valgus ? 'bad' : (vg.frontal ? 'ok' : 'warn') },
    ],
    features: [+knee.toFixed(1), +lean.toFixed(1), +valgusFeat.toFixed(2)],
    repValue: knee,
    labelSet: ['good', 'shallow', 'deep', 'lean', 'valgus'],
  };
}

/* ============ 搬重物·髋铰链（背部安全重点） ============ */
export function analyzeHipHinge(lms) {
  const s = pickSide(lms);
  const hipA = angle3(lms[s.shoulder], lms[s.hip], lms[s.knee]);
  const knee = angle3(lms[s.hip], lms[s.knee], lms[s.ankle]);
  const lean = verticalAngle(lms[s.shoulder], lms[s.hip]);
  const depth = hipA > 140 ? 'shallow' : hipA < 75 ? 'deep' : 'ok';
  const msgs = [];
  msgs.push(depth === 'shallow' ? t('hhShallow')
            : depth === 'deep' ? t('hhDeep') : t('hhDepthOk'));
  msgs.push(lean > 60 && knee > 160 ? t('hhStraightLegs') : t('hhKneeOk'));
  const risk = []; let riskLevel = 0;
  if (lean > 60 && hipA < 100 && knee > 150) { riskLevel = 2; risk.push(t('riskBackRound')); }
  else if (lean > 45 && knee > 140) { riskLevel = 1; risk.push(t('riskBackRoundWarn')); }
  if (knee < 60) { riskLevel = 2; risk.push(t('riskKneeDeep')); }
  return {
    metrics: { hipA, knee, lean },
    depth, goodMsgs: [], badMsgs: msgs, msgsIsBad: depth !== 'ok' || riskLevel > 0,
    risk, riskLevel,
    chips: [
      { k: t('chipHip'), v: `${Math.round(hipA)}°`, cls: depth === 'ok' ? 'ok' : 'warn' },
      { k: t('chipKnee'), v: `${Math.round(knee)}°`, cls: knee < 70 ? 'bad' : 'ok' },
      { k: t('chipBack'), v: riskLevel === 2 ? t('riskBackRound') : riskLevel === 1 ? t('riskBackRoundWarn') : t('backOkVal'), cls: riskLevel === 2 ? 'bad' : riskLevel === 1 ? 'warn' : 'ok' },
    ],
    features: [+hipA.toFixed(1), +knee.toFixed(1), +lean.toFixed(1)],
    repValue: hipA,
    labelSet: ['good', 'shallow', 'deep', 'sag'],
  };
}

/* ============ 上台阶（楼梯/台阶） ============ */
export function analyzeStepUp(lms) {
  const L = { hip: 23, knee: 25, ankle: 27, shoulder: 11 }, R = { hip: 24, knee: 26, ankle: 28, shoulder: 12 };
  const aL = angle3(lms[L.hip], lms[L.knee], lms[L.ankle]);
  const aR = angle3(lms[R.hip], lms[R.knee], lms[R.ankle]);
  const work = aL < aR ? L : R;
  const knee = Math.min(aL, aR);
  const lean = verticalAngle(lms[work.shoulder], lms[work.hip]);
  const vg = kneeValgus(lms);
  const depth = knee > 115 ? 'shallow' : knee < 70 ? 'deep' : 'ok';
  const msgs = [];
  msgs.push(depth === 'shallow' ? t('suShallow')
            : depth === 'deep' ? t('suDeep') : t('suDepthOk'));
  msgs.push(lean > 25 ? t('riskSway') : t('sqBackOk'));
  if (!vg.frontal) msgs.push(t('sqValgusSide'));
  else msgs.push(vg.valgus ? t('sqValgusBad') : t('sqValgusOk'));
  const valgusFeat = vg.frontal ? Math.max(vg.left, vg.right) : 0;
  const risk = []; let riskLevel = 0;
  if (knee < 60) { riskLevel = 2; risk.push(t('riskKneeDeep')); }
  if (lean > 35) { riskLevel = 2; risk.push(t('riskLeanSevere')); }
  else if (lean > 25) riskLevel = Math.max(riskLevel, 1);
  if (vg.frontal && valgusFeat > 0.25) { riskLevel = 2; risk.push(t('riskValgusSevere')); }
  else if (vg.valgus) riskLevel = Math.max(riskLevel, 1);
  return {
    metrics: { knee, lean, valgus: valgusFeat },
    depth, goodMsgs: [], badMsgs: msgs, msgsIsBad: depth !== 'ok' || lean > 25 || vg.valgus,
    risk, riskLevel,
    chips: [
      { k: t('chipFrontKnee'), v: `${Math.round(knee)}°`, cls: depth === 'ok' ? 'ok' : 'warn' },
      { k: t('chipLean'), v: `${Math.round(lean)}°`, cls: lean > 25 ? 'bad' : 'ok' },
      { k: t('chipValgus'), v: vg.frontal ? (vg.valgus ? t('valgusIn', { l: vg.left, r: vg.right }) : t('valgusOkVal')) : t('valgusSideVal'), cls: vg.valgus ? 'bad' : (vg.frontal ? 'ok' : 'warn') },
    ],
    features: [+knee.toFixed(1), +lean.toFixed(1), +valgusFeat.toFixed(2)],
    repValue: knee,
    labelSet: ['good', 'shallow', 'deep', 'lean', 'valgus'],
  };
}

/* ============ 肩上举（高处取物） ============ */
export function analyzeShoulderRaise(lms) {
  const s = pickSide(lms);
  const arm = verticalAngle(lms[s.shoulder], lms[s.wrist]);
  const elbow = angle3(lms[s.shoulder], lms[s.elbow], lms[s.wrist]);
  const lean = verticalAngle(lms[s.shoulder], lms[s.hip]);
  const depth = arm < 120 ? 'shallow' : 'ok';
  const msgs = [];
  msgs.push(depth === 'shallow' ? t('srShallow') : t('srOk'));
  msgs.push(lean > 15 ? t('riskCompensate') : t('sqBackOk'));
  const risk = []; let riskLevel = 0;
  if (lean > 25) { riskLevel = 2; risk.push(t('riskCompensateSevere')); }
  else if (lean > 15) riskLevel = Math.max(riskLevel, 1);
  if (elbow < 90) { riskLevel = 2; risk.push(t('riskElbowBend')); }
  else if (elbow < 120) riskLevel = Math.max(riskLevel, 1);
  return {
    metrics: { arm, lean, elbow },
    depth, goodMsgs: [], badMsgs: msgs, msgsIsBad: depth !== 'ok' || lean > 15,
    risk, riskLevel,
    chips: [
      { k: t('chipArm'), v: `${Math.round(arm)}°`, cls: depth === 'ok' ? 'ok' : 'warn' },
      { k: t('chipLean'), v: `${Math.round(lean)}°`, cls: lean > 15 ? 'bad' : 'ok' },
      { k: t('chipElbow'), v: `${Math.round(elbow)}°`, cls: elbow < 120 ? 'warn' : 'ok' },
    ],
    features: [+arm.toFixed(1), +lean.toFixed(1), +elbow.toFixed(1)],
    repValue: arm,
    labelSet: ['good', 'shallow', 'bad'],
  };
}

/* ============ 站姿检查（日常体态，保持 30 秒计 1 次） ============ */
export function analyzeStanding(lms) {
  const s = pickSide(lms);
  const lean = verticalAngle(lms[s.shoulder], lms[s.hip]);
  const knee = angle3(lms[s.hip], lms[s.knee], lms[s.ankle]);
  const hipW = Math.abs(lms[24].x - lms[23].x);
  const frontal = hipW > 0.10;
  const neck = angle3(lms[0], lms[s.shoulder], lms[s.hip]);   // 颈-躯干角：180°=头正
  const shLevel = frontal ? Math.abs(lms[11].y - lms[12].y) : 0;
  const leanBad = lean > 12;
  const headBad = !frontal && neck < 155;                     // 侧面才能看头前伸
  const shBad = frontal && shLevel > 0.05;                    // 高低肩
  const good = [], bad = [];
  (leanBad ? bad : good).push(leanBad ? t('stLeanBad') : t('stLeanOk'));
  (headBad ? bad : good).push(headBad ? t('stHeadFwd') : t('stHeadOk'));
  (shBad ? bad : good).push(shBad ? t('stShoulderLvl') : t('stShoulderOk'));
  const depth = (leanBad || headBad || shBad) ? 'bad' : 'ok';
  const risk = []; let riskLevel = 0;
  if (lean > 30) { riskLevel = 2; risk.push(t('riskLeanSevere')); }
  else if (lean > 20) riskLevel = 1;
  return {
    metrics: { lean, neck, knee, shLevel },
    depth, goodMsgs: good, badMsgs: bad, msgsIsBad: depth === 'bad',
    risk, riskLevel,
    chips: [
      { k: t('chipLean'), v: `${Math.round(lean)}°`, cls: leanBad ? 'bad' : 'ok' },
      { k: t('chipNeck'), v: frontal ? '--' : `${Math.round(neck)}°`, cls: headBad ? 'bad' : 'ok' },
      { k: t('chipShoulderLvl'), v: frontal ? (shBad ? t('shBad') : t('shOk')) : '--', cls: shBad ? 'bad' : 'ok' },
    ],
    features: [+lean.toFixed(1), +neck.toFixed(1), +(frontal ? shLevel * 100 : 0).toFixed(1)],
    repValue: lean,
    labelSet: ['good', 'bad'],
  };
}

/* ============ 坐姿检查（久坐办公/学习，保持 30 秒计 1 次） ============ */
export function analyzeSitting(lms) {
  const s = pickSide(lms);
  const lean = verticalAngle(lms[s.shoulder], lms[s.hip]);
  const knee = angle3(lms[s.hip], lms[s.knee], lms[s.ankle]);
  const hipW = Math.abs(lms[24].x - lms[23].x);
  const frontal = hipW > 0.10;
  const neck = angle3(lms[0], lms[s.shoulder], lms[s.hip]);
  const slouch = lean > 18;
  const headBad = !frontal && neck < 155;
  const curlBad = knee < 65;                                  // 蜷腿
  const good = [], bad = [];
  (slouch ? bad : good).push(slouch ? t('siSlouch') : t('siGood'));
  (headBad ? bad : good).push(headBad ? t('siHeadFwd') : t('stHeadOk'));
  (curlBad ? bad : good).push(curlBad ? t('siKneeCurl') : t('siKneeOk'));
  const depth = (slouch || headBad || curlBad) ? 'bad' : 'ok';
  const risk = []; let riskLevel = 0;
  if (lean > 32) { riskLevel = 2; risk.push(t('riskSlouchSevere')); }
  else if (lean > 22) riskLevel = 1;
  return {
    metrics: { lean, neck, knee },
    depth, goodMsgs: good, badMsgs: bad, msgsIsBad: depth === 'bad',
    risk, riskLevel,
    chips: [
      { k: t('chipLean'), v: `${Math.round(lean)}°`, cls: slouch ? 'bad' : 'ok' },
      { k: t('chipNeck'), v: frontal ? '--' : `${Math.round(neck)}°`, cls: headBad ? 'bad' : 'ok' },
      { k: t('chipKnee'), v: `${Math.round(knee)}°`, cls: curlBad ? 'warn' : 'ok' },
    ],
    features: [+lean.toFixed(1), +neck.toFixed(1), +knee.toFixed(1)],
    repValue: lean,
    labelSet: ['good', 'bad'],
  };
}

/* ============ 内置动作注册表 ============ */
export const EXERCISES = {
  squat: { id: 'squat', nameKey: 'exSquat', icon: 'squat', analyze: analyzeSquat,
           rep: { downBelow: 100, upAbove: 150 }, descKey: 'exSquatDesc', stdKey: 'exSquatStd',
           labelSet: ['good', 'shallow', 'deep', 'lean', 'valgus'] },
  lunge: { id: 'lunge', nameKey: 'exLunge', icon: 'lunge', analyze: analyzeLunge,
           rep: { downBelow: 100, upAbove: 150 }, descKey: 'exLungeDesc', stdKey: 'exLungeStd',
           labelSet: ['good', 'frontShallow', 'frontDeep', 'lean'] },
  pushup: { id: 'pushup', nameKey: 'exPushup', icon: 'pushup', analyze: analyzePushup,
            rep: { downBelow: 100, upAbove: 160 }, descKey: 'exPushupDesc', stdKey: 'exPushupStd',
            labelSet: ['good', 'shallow', 'sag'] },
  sitstand: { id: 'sitstand', nameKey: 'exSitStand', icon: 'sitstand', analyze: analyzeSitStand,
              rep: { downBelow: 115, upAbove: 165 }, descKey: 'exSitStandDesc', stdKey: 'exSitStandStd',
              labelSet: ['good', 'shallow', 'deep', 'lean', 'valgus'] },
  hiphinge: { id: 'hiphinge', nameKey: 'exHipHinge', icon: 'hiphinge', analyze: analyzeHipHinge,
              rep: { downBelow: 120, upAbove: 160 }, descKey: 'exHipHingeDesc', stdKey: 'exHipHingeStd',
              labelSet: ['good', 'shallow', 'deep', 'sag'] },
  stepup: { id: 'stepup', nameKey: 'exStepUp', icon: 'stepup', analyze: analyzeStepUp,
            rep: { downBelow: 105, upAbove: 160 }, descKey: 'exStepUpDesc', stdKey: 'exStepUpStd',
            labelSet: ['good', 'shallow', 'deep', 'lean', 'valgus'] },
  shoulderraise: { id: 'shoulderraise', nameKey: 'exShoulderRaise', icon: 'shoulderraise', analyze: analyzeShoulderRaise,
                   rep: { downBelow: 40, upAbove: 140 }, descKey: 'exShoulderRaiseDesc', stdKey: 'exShoulderRaiseStd',
                   labelSet: ['good', 'shallow', 'bad'] },
  standing: { id: 'standing', nameKey: 'exStanding', icon: 'standing', analyze: analyzeStanding,
              rep: { hold: true, holdMs: 30000 }, descKey: 'exStandingDesc', stdKey: 'exStandingStd',
              labelSet: ['good', 'bad'] },
  sitting: { id: 'sitting', nameKey: 'exSitting', icon: 'sitting', analyze: analyzeSitting,
             rep: { hold: true, holdMs: 30000 }, descKey: 'exSittingDesc', stdKey: 'exSittingStd',
             labelSet: ['good', 'bad'] },
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
    name: t('customDefaultName'), icon: 'custom', custom: true,
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
// 自定义动作按账号分区存储（多账号隔离）；app.js 切换账号时调用 setCustomKey
let CUSTOM_KEY = 'rehab_custom_ex';
export function setCustomKey(k) { CUSTOM_KEY = k; }
export function loadCustomExercises() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY)) ?? []; }
  catch { return []; }
}
export function saveCustomExercises(list) { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); }

// 统一入口：给定动作 id/自定义对象，返回分析结果
export function analyzeAny(lms, ex) {
  if (ex.custom) return analyzeGeneric(lms, ex);
  return ex.analyze(lms);
}
