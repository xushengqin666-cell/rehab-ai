/* demo.js - v2.34.0 标准动作示范（火柴人关键帧 / 真实阈值标注 / 常见错误对照）+ 示范录像本机存取 */
import { EXERCISES } from './analysis.js';

const R2D = 180 / Math.PI;
const dir = (deg) => { const r = deg / R2D; return [Math.sin(r), -Math.cos(r)]; };
const mv = (p, d, len) => [p[0] + d[0] * len, p[1] + d[1] * len];
const lerp = (a, b, k) => a + (b - a) * k;

const GEO = { ground: 202, ankleX: 72, shin: 46, thigh: 46, trunk: 56, armUp: 30, armLo: 28, headR: 11 };

/* 站立类侧视：小腿前倾 beta、膝关节内角 knee、躯干前倾 lean、手臂角 arm */
function sidePose(o) {
  const g = GEO;
  const beta = o.beta, knee = o.knee, lean = o.lean;
  const A = [o.ankleX != null ? o.ankleX : g.ankleX, o.ground != null ? o.ground : g.ground];
  const K = mv(A, dir(beta), g.shin);
  const H = mv(K, dir(beta + 180 + knee), g.thigh);
  const S = mv(H, dir(lean), g.trunk);
  const head = mv(S, dir(lean), 15);
  const armD = o.arm != null ? o.arm : lean + 72;
  const E = mv(S, dir(armD), g.armUp);
  const W = mv(E, dir(armD - (o.elbow != null ? o.elbow : 12)), g.armLo);
  const rear = o.rear != null ? o.rear : 0;   // 分腿站（弓步）：后脚在踝后 rear 处
  return { kind: 'side', A: A, K: K, H: H, S: S, head: head, E: E, W: W,
    toe: [A[0] + 23, A[1]], heel: [A[0] - 7, A[1]],
    rearToe: rear ? [A[0] - rear + 16, A[1]] : null, rearHeel: rear ? [A[0] - rear - 7, A[1]] : null,
    wall: !!o.wall, ground: A[1], knee: knee, lean: lean };
}
/* 正视：膝间距 kx（越小越内扣）、手臂上举 armUp 度 */
function frontPose(o) {
  const g = GEO;
  const cx = o.cx != null ? o.cx : 110;
  const ky = o.kneeY != null ? o.kneeY : 158;
  const hy = o.hipY != null ? o.hipY : 104;
  const kx = o.kx != null ? o.kx : 26;
  const ax = o.ax != null ? o.ax : 34;
  const S = [cx, hy - 56];
  const H = [cx, hy];
  const head = [cx, S[1] - 15];
  const r = o.armUp != null ? o.armUp : 20;   // 0=垂在体侧, 90=水平, 180=举过头顶
  const armL = mv(S, dir(180 + r), g.armUp);
  const armR = mv(S, dir(180 - r), g.armUp);
  const wL = mv(armL, dir(180 + r + 10), g.armLo);
  const wR = mv(armR, dir(180 - r - 10), g.armLo);
  return { kind: 'front', S: S, H: H, head: head,
    KL: [cx - kx, ky], KR: [cx + kx, ky], AL: [cx - ax, g.ground], AR: [cx + ax, g.ground],
    EL: armL, ER: armR, WL: wL, WR: wR, ground: g.ground, knee: o.knee != null ? o.knee : 172, lean: 0 };
}
/* 俯卧/仰卧类：直接用显式关节 */
function customPose(j) {
  return Object.assign({ kind: 'custom', ground: GEO.ground, knee: 180, lean: 0 }, j);
}

/* 每个动作的标准关键帧：数值直接取自 analysis.js 里应用真正使用的判定阈值 */
export const DEMOS = {
  squat: { view: 'side', frames: [
    { key: 'demoPrep', p: { beta: 5, knee: 172, lean: 6, arm: 78 } },
    { key: 'demoKey', p: { beta: 22, knee: 95, lean: 45, arm: 100 } },
    { key: 'demoBack', p: { beta: 5, knee: 172, lean: 6, arm: 78 } }],
    faults: [{ key: 'dmbFaultShallow', p: { beta: 6, knee: 142, lean: 10, arm: 74 } },
             { key: 'dmbFaultLean', p: { beta: 11, knee: 108, lean: 34, arm: 96 } }],
    front: { key: 'dmbFaultValgus', p: { kx: 8 } } },
  sitstand: { view: 'side', frames: [
    { key: 'demoPrep', p: { beta: 20, knee: 92, lean: 38, arm: 110 } },
    { key: 'demoKey', p: { beta: 6, knee: 170, lean: 4, arm: 80 } },
    { key: 'demoBack', p: { beta: 20, knee: 92, lean: 38, arm: 110 } }],
    faults: [{ key: 'dmbFaultShallow', p: { beta: 12, knee: 130, lean: 30, arm: 84 } },
             { key: 'dmbFaultLean', p: { beta: 16, knee: 96, lean: 36, arm: 92 } }],
    front: { key: 'dmbFaultValgus', p: { kx: 8 } } },
  stepup: { view: 'side', frames: [
    { key: 'demoPrep', p: { beta: 4, knee: 174, lean: 4, arm: 78 } },
    { key: 'demoKey', p: { beta: 22, knee: 88, lean: 30, arm: 96 } },
    { key: 'demoBack', p: { beta: 4, knee: 174, lean: 4, arm: 78 } }],
    faults: [{ key: 'dmbFaultShallow', p: { beta: 6, knee: 140, lean: 10, arm: 74 } },
             { key: 'dmbFaultLean', p: { beta: 12, knee: 100, lean: 33, arm: 96 } }],
    front: { key: 'dmbFaultValgus', p: { kx: 9 } } },
  lunge: { view: 'side', frames: [
    { key: 'demoPrep', p: { beta: 3, knee: 176, lean: 3, arm: 78, rear: 44 } },
    { key: 'demoKey', p: { beta: 20, knee: 94, lean: 26, arm: 92, rear: 44 } },
    { key: 'demoBack', p: { beta: 3, knee: 176, lean: 3, arm: 78, rear: 44 } }],
    faults: [{ key: 'dmbFaultShallow', p: { beta: 6, knee: 138, lean: 8, arm: 74 } },
             { key: 'dmbFaultLean', p: { beta: 14, knee: 104, lean: 30, arm: 92 } }] },
  hiphinge: { view: 'side', frames: [
    { key: 'demoPrep', p: { beta: 6, knee: 166, lean: 6, arm: 172 } },
    { key: 'demoKey', p: { beta: 10, knee: 150, lean: 48, arm: 176 } },
    { key: 'demoBack', p: { beta: 6, knee: 166, lean: 6, arm: 172 } }],
    faults: [{ key: 'dmbFaultShallow', p: { beta: 6, knee: 164, lean: 22, arm: 96 } },
             { key: 'dmbFaultSag', p: { beta: 14, knee: 120, lean: 62, arm: 160 } }] },
  wallsit: { view: 'side', frames: [
    { key: 'demoPrep', p: { beta: 3, knee: 96, lean: 5, arm: 70, wall: true } },
    { key: 'demoKey', p: { beta: 3, knee: 92, lean: 4, arm: 70, wall: true } },
    { key: 'demoBack', p: { beta: 3, knee: 96, lean: 5, arm: 70, wall: true } }],
    faults: [{ key: 'dmbFaultShallow', p: { beta: 8, knee: 130, lean: 12, arm: 72 } }] },
  bend: { view: 'side', frames: [
    { key: 'demoPrep', p: { beta: 6, knee: 168, lean: 6, arm: 170 } },
    { key: 'demoKey', p: { beta: 12, knee: 150, lean: 44, arm: 174 } },
    { key: 'demoBack', p: { beta: 6, knee: 168, lean: 6, arm: 170 } }],
    faults: [{ key: 'dmbFaultSag', p: { beta: 12, knee: 124, lean: 60, arm: 158 } }] },
  shoulderraise: { view: 'front', frames: [
    { key: 'demoPrep', p: { armUp: 20 } },
    { key: 'demoKey', p: { armUp: 150 } },
    { key: 'demoBack', p: { armUp: 20 } }],
    faults: [{ key: 'dmbFaultShallow', p: { armUp: 75 } }] },
  plank: { view: 'custom', frames: [
    { key: 'demoKey', p: { S: [56, 118], H: [128, 150], head: [40, 116], E: [50, 152], W: [46, 182],
      A: [196, 202], K: [166, 176], toe: [206, 202], heel: [190, 202] } }],
    faults: [{ key: 'dmbFaultSag', p: { S: [56, 132], H: [128, 168], head: [40, 130], E: [50, 166], W: [46, 192],
      A: [196, 202], K: [166, 184], toe: [206, 202], heel: [190, 202] } }] },
  bridge: { view: 'custom', frames: [
    { key: 'demoPrep', p: { S: [60, 196], H: [120, 196], head: [40, 190], E: [84, 194], W: [104, 196],
      A: [176, 202], K: [140, 186], toe: [186, 202], heel: [172, 202] } },
    { key: 'demoKey', p: { S: [60, 168], H: [116, 182], head: [40, 162], E: [84, 190], W: [104, 196],
      A: [176, 202], K: [140, 188], toe: [186, 202], heel: [172, 202] } }],
    faults: [{ key: 'dmbFaultShallow', p: { S: [60, 188], H: [118, 194], head: [40, 182], E: [84, 193], W: [104, 196],
      A: [176, 202], K: [140, 188], toe: [186, 202], heel: [172, 202] } }] },
};

/* 取某动作在 t（0..1，跨全部关键帧）处的姿态 */
export function demoParams(key, t) {
  const d = DEMOS[key];
  if (!d) return null;
  const f = d.frames;
  const n = f.length - 1;
  if (n <= 0) return f[0].p;                        // 单帧动作（如平板支撑）
  const tt = Math.max(0, Math.min(1, t == null ? 0 : t));
  const seg = Math.min(n - 1, Math.floor(tt * n));
  const k = tt * n - seg;
  const a = f[seg].p, b = f[seg + 1].p;
  const o = {};
  Object.keys(a).forEach((kk) => {
    const va = a[kk], vb = b[kk];
    if (Array.isArray(va) && Array.isArray(vb)) o[kk] = [lerp(va[0], vb[0], k), lerp(va[1], vb[1], k)];
    else if (typeof va === 'number' && typeof vb === 'number') o[kk] = lerp(va, vb, k);
    else o[kk] = k < 1 ? va : vb;                   // 布尔/字符串类参数（如 wall、rear）不插值
  });
  return o;
}
/* 姿态（二维）+ 三维模型（可多角度）：统一入口，供界面调用 */
export function demoFigure(key, o) {
  const opt = o || {};
  const d = DEMOS[key];
  if (!d) return '';
  let params;
  if (opt.fault === 'front') params = d.front ? d.front.p : null;
  else if (opt.fault === true || typeof opt.fault === 'number') params = d.faults[opt.fault === true ? 0 : opt.fault].p;
  else if (opt.params) params = opt.params;
  else params = (typeof opt.frame === 'string') ? demoParams(key, 0.5) : d.frames[opt.frame || 0].p;
  if (!params) return '';
  const fault = !!opt.fault || opt.faultStyle === true;
  const az = opt.azimuth;
  if (d.view === 'side') {
    const gm = opt.ghost ? build3D(key, opt.ghostParams || d.frames[0].p) : null;
    return figure3d(key, { params: params, azimuth: az != null ? az : 0, w: opt.w, h: opt.h, scale: opt.scale, fault: fault, ghostModel: gm, model: opt.model });
  }
  return figureSvg(key, { pose: poseOf(key, params, opt.forceView), w: opt.w || 220, h: opt.h || 230, fault: fault });
}
export function demoPose(key, t) {
  const o = demoParams(key, t);
  return o ? poseOf(key, o) : null;
}
export function poseOf(key, o, view) {
  const d = DEMOS[key];
  if (!d) return null;
  const v = view || d.view;   // 常见错误对照可强制换视角（如内扣必须用正视）
  if (v === 'front') return frontPose(o);
  if (v === 'custom') return customPose(o);
  return sidePose(o);
}
export function demoKeys() { return Object.keys(DEMOS); }
export function hasDemo(key) { return !!DEMOS[key]; }

/* ---------- 绘制 ---------- */
const NS = 'http://www.w3.org/2000/svg';
const P = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);
function limb(pts, cls) {
  return '<polyline class="' + cls + '" points="' + pts.map(P).join(' ') + '" fill="none"/>';
}
function joint(p, cls) { return '<circle class="' + cls + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.4"/>'; }
function head(p, cls) { return '<circle class="' + cls + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + GEO.headR + '" fill="none"/>'; }
/* v2.34.1：有体块的剪影人形 —— 每段肢体画成上粗下细的多边形，关节补圆，比细线更像教材示范图 */
function seg(p1, p2, w1, w2, cls) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  const a = [p1[0] + nx * w1 / 2, p1[1] + ny * w1 / 2];
  const b = [p2[0] + nx * w2 / 2, p2[1] + ny * w2 / 2];
  const c = [p2[0] - nx * w2 / 2, p2[1] - ny * w2 / 2];
  const d = [p1[0] - nx * w1 / 2, p1[1] - ny * w1 / 2];
  return '<polygon class="' + cls + '" points="' + [a, b, c, d].map(P).join(' ') + '"/>';
}
function chain(pts, widths, cls) {
  let s = '';
  for (let i = 0; i < pts.length - 1; i++) s += seg(pts[i], pts[i + 1], widths[i], widths[i + 1], cls);
  for (let i = 0; i < pts.length; i++) s += disc(pts[i], Math.max(4, widths[i] / 2), cls);
  return s;
}
function disc(p, r, cls) { return '<circle class="' + cls + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + r.toFixed(1) + '"/>'; }
/* 运动方向箭头：从起始位指向到位 */
function arrow(p1, p2, cls) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const L = Math.hypot(dx, dy);
  if (L < 14) return '';
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const base = [p2[0] - ux * 14, p2[1] - uy * 14];
  const l = [base[0] + nx * 6, base[1] + ny * 6];
  const r = [base[0] - nx * 6, base[1] - ny * 6];
  return '<line class="' + cls + '" x1="' + p1[0].toFixed(1) + '" y1="' + p1[1].toFixed(1) + '" x2="' + base[0].toFixed(1) + '" y2="' + base[1].toFixed(1) + '"/>' +
    '<polygon class="' + cls + '-h" points="' + [p2, l, r].map(P).join(' ') + '"/>';
}
/* 角度弧：在顶点 v，两条射线到 a、b 之间画弧 */
function arc(v, a, b, r, cls, label) {
  const a1 = Math.atan2(a[1] - v[1], a[0] - v[0]);
  const a2 = Math.atan2(b[1] - v[1], b[0] - v[0]);
  let d = a2 - a1;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  const s1 = [v[0] + Math.cos(a1) * r, v[1] + Math.sin(a1) * r];
  const e1 = [v[0] + Math.cos(a1 + d) * r, v[1] + Math.sin(a1 + d) * r];
  const sweep = d > 0 ? 1 : 0;
  let out = '<path class="' + cls + '" d="M ' + P(s1) + ' A ' + r + ' ' + r + ' 0 0 ' + sweep + ' ' + P(e1) + '" fill="none"/>';
  if (label) {
    const mid = a1 + d / 2;
    const lp = [v[0] + Math.cos(mid) * (r + 13), v[1] + Math.sin(mid) * (r + 13)];
    out += '<text class="dmb-arc-t" x="' + lp[0].toFixed(1) + '" y="' + lp[1].toFixed(1) + '">' + label + '</text>';
  }
  return out;
}
export function figureSvg(key, o) {
  const opt = o || {};
  const p = opt.pose || demoPose(key, 0);
  if (!p) return '';
  const ghost = opt.ghost ? demoPose(key, opt.ghostAt != null ? opt.ghostAt : 0) : null;
  const cls = opt.fault ? 'dmb-b dmb-fault' : 'dmb-b';
  const jc = opt.fault ? 'dmb-j dmb-fault' : 'dmb-j';
  const hc = opt.fault ? 'dmb-h dmb-fault' : 'dmb-h';
  const w = opt.w || 220, h = opt.h || 230;
  let s = '';
  s += '<svg class="dmb-svg" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMax meet" role="img">';
  s += '<line class="dmb-ground" x1="8" y1="' + (p.ground || GEO.ground) + '" x2="' + (w - 8) + '" y2="' + (p.ground || GEO.ground) + '"/>';
  if (ghost) {
    s += '<g class="dmb-ghost">';
    if (ghost.kind === 'front') {
      s += chain([ghost.AL, ghost.KL, ghost.H, ghost.KR, ghost.AR], [11, 15, 20, 15, 11], 'dmb-b-g');
      s += chain([ghost.H, ghost.S], [24, 27], 'dmb-b-g');
      s += disc(ghost.head, 12, 'dmb-b-g');
    } else {
      s += chain([ghost.A, ghost.K, ghost.H, ghost.S], [10, 15, 21, 18], 'dmb-b-g');
      s += chain([ghost.S, ghost.E, ghost.W], [11, 9, 7], 'dmb-b-g');
      s += disc(ghost.head, 12, 'dmb-b-g');
    }
    s += '</g>';
    if (opt.arrow !== false) s += arrow(ghost.H, p.H, 'dmb-arrow');   // 运动方向：从起始位髋到当前髋
  }
  if (p.kind === 'front') {
    s += chain([p.AL, p.KL, p.H, p.KR, p.AR], [11, 15, 20, 15, 11], cls);
    s += chain([p.H, p.S], [24, 27], cls);
    s += chain([p.S, p.EL, p.WL], [11, 9, 7], cls);
    s += chain([p.S, p.ER, p.WR], [11, 9, 7], cls);
    s += disc(p.head, 12, hc);
  } else {
    s += chain([p.heel, p.toe], [10, 7], cls);
    s += chain([p.A, p.K, p.H, p.S], [10, 15, 21, 18], cls);
    s += chain([p.S, p.E, p.W], [11, 9, 7], cls);
    s += disc(p.head, 12, hc);
    if (!opt.noArc && p.kind === 'side') {
      s += arc(p.K, p.A, p.H, 17, 'dmb-arc', Math.round(p.knee) + String.fromCharCode(176));
      s += arc(p.H, p.K, p.S, 15, 'dmb-arc2', Math.round(p.lean) + String.fromCharCode(176));
    }
  }
  if (opt.label) s += '<text class="dmb-cap" x="' + (w / 2) + '" y="' + (h - 6) + '">' + opt.label + '</text>';
  s += '</svg>';
  return s;
}

/* ---------- 真人示范动图（CDC《Growing Stronger》老年力量训练教材·美国政府作品·公有领域） ----------
   为什么用它：这是康复受众对口的官方标准示范、真人在做、动图能看清全过程，且无版权限制；
   三维人体图继续保留，用于标注应用真正使用的角度阈值与常见错误对照。 */
export const REAL_DEMO = {
  squat: 'demo-media/squat.gif',
  lunge: 'demo-media/lunge.gif',
  stepup: 'demo-media/stepup.gif',
  shoulderraise: 'demo-media/shoulderraise.gif',
  // v2.39.0 追加：按动作模式就近对应（CDC 教材里没有同名动作，取模式最接近的一张，界面上会标明实际动作名）
  bend: 'demo-media/backstretch.gif',        // 体前屈 ← 背部前屈拉伸
  hiphinge: 'demo-media/uprightrow.gif',     // 髋铰链 ← 俯身划船（髋铰链发力模式）
  pushup: 'demo-media/wallpushup.gif',       // 俯卧撑 ← 墙俯卧撑（俯卧撑退阶）
  plank: 'demo-media/plank.jpg',             // 平板支撑 ← 真人照片（公有领域）
  sitstand: 'demo-media/squat.gif',          // 椅子起坐 ← 同一套的扶椅下蹲（CDC 教材里坐站起立即用椅子）
};
// 其余真人示范（可挂到自定义动作或“更多动作”里）
export const REAL_EXTRA = [
  ['wallpushup', '墙俯卧撑'], ['biceps', '臂弯举'], ['chestpress', '胸前推'],
  ['kneeext', '坐姿伸膝'], ['backext', '俯卧背伸'], ['abdominal', '卷腹'],
  ['toestand', '提踵'], ['hipabduction', '髋外展'], ['kneecurl', '俯卧屈膝'],
  ['grip', '握力'], ['fingermarch', '手指爬墙'],
  ['backstretch', '背部拉伸'], ['cheststretch', '胸部拉伸'], ['hamstringstretch', '腘绳肌拉伸'], ['quadstretch', '股四头肌拉伸'],
];
export const realDemo = (key) => REAL_DEMO[key] || '';
export const realExtraSvg = (file) => 'demo-media/' + file + '.gif';
export const CDC_CREDIT = '示范素材：真人实拍，来自 CDC《Growing Stronger》老年人力量训练教材等美国政府公有领域资料（可商用、可离线）';

/* ---------- 三维骨架 + 任意方位角投影（多个角度观察） ---------- */
const LAT = { hip: 11, knee: 12, ankle: 12, shoulder: 17 };
function v3(x, y, z) { return [x, y, z]; }
/* 由侧视姿态构建三维关节：X=前后(前为正) Y=上下(上为正) Z=左右 */
export function build3D(key, params) {
  const p = poseOf(key, params);
  if (!p || p.kind !== 'side') return null;
  const OX = 110, G = p.ground;
  const j = (q) => v3(q[0] - OX, G - q[1], 0);
  const A = j(p.A), K = j(p.K), H = j(p.H), S = j(p.S), E = j(p.E), W = j(p.W), hd = j(p.head);
  const kh = params && params.kx != null ? params.kx : LAT.knee;   // 膝位可内移 → 内扣
  const part = [];
  const hipL = v3(H[0], H[1], LAT.hip), hipR = v3(H[0], H[1], -LAT.hip);
  const kneL = v3(K[0], K[1], kh), kneR = v3(K[0], K[1], -kh);
  const ankL = v3(A[0], A[1], LAT.ankle), ankR = v3(A[0], A[1], -LAT.ankle);
  const shoL = v3(S[0], S[1], LAT.shoulder), shoR = v3(S[0], S[1], -LAT.shoulder);
  const elbL = v3(E[0], E[1], LAT.shoulder - 3), elbR = v3(E[0], E[1], -(LAT.shoulder - 3));
  const wriL = v3(W[0], W[1], LAT.shoulder - 4), wriR = v3(W[0], W[1], -(LAT.shoulder - 4));
  const HIPC = v3(H[0], H[1], 0), SHOC = v3(S[0], S[1], 0);
  const toeL = v3(p.toe[0] - OX, G - p.toe[1], LAT.ankle), toeR = v3(p.toe[0] - OX, G - p.toe[1], -LAT.ankle);
  const heelL = v3(p.heel[0] - OX, G - p.heel[1], LAT.ankle), heelR = v3(p.heel[0] - OX, G - p.heel[1], -LAT.ankle);
  const rearL = p.rearToe ? v3(p.rearToe[0] - OX, G - p.rearToe[1], LAT.ankle) : null;
  const rearR = p.rearToe ? v3(p.rearToe[0] - OX, G - p.rearToe[1], -LAT.ankle) : null;
  const rearHeelL = p.rearHeel ? v3(p.rearHeel[0] - OX, G - p.rearHeel[1], LAT.ankle) : null;
  const rearHeelR = p.rearHeel ? v3(p.rearHeel[0] - OX, G - p.rearHeel[1], -LAT.ankle) : null;
  part.push([ankL, kneL, 7], [kneL, hipL, 9], [ankR, kneR, 7], [kneR, hipR, 9]);
  part.push([heelL, toeL, 5], [heelR, toeR, 5]);
  if (rearL) part.push([rearHeelL, rearL, 5], [rearHeelR, rearR, 5]);
  part.push([hipL, hipR, 10]);                       // 骨盆
  part.push([HIPC, SHOC, 13]);                       // 躯干
  part.push([shoL, elbL, 6], [elbL, wriL, 5], [shoR, elbR, 6], [elbR, wriR, 5]);
  part.push([SHOC, v3(hd[0], hd[1] - 4, 0), 5]);     // 颈
  part.push([shoL, shoR, 7]);                        // 肩带
  return { parts: part, head: hd, ground: G, footL: [heelL, toeL], footR: [heelR, toeR],
    rearL: rearL ? [rearHeelL, rearL] : null, rearR: rearR ? [rearHeelR, rearR] : null,
    wall: p.wall, knee: p.knee, lean: p.lean, hip: HIPC, sho: SHOC, ank: A, kne: K, spt: p };
}
/* 方位角：0=侧面（看到前后方向）  90=正面（看到左右方向） */
export function project3(q, azDeg, ox, oy, scale) {
  const a = azDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const sx = q[0] * c + q[2] * s;
  const dep = -q[0] * s + q[2] * c;
  return { x: ox + sx * scale, y: oy - q[1] * scale, d: dep };
}
export function figure3d(key, o) {
  const opt = o || {};
  const az = opt.azimuth != null ? opt.azimuth : 0;
  const m = opt.model || build3D(key, opt.params || DEMOS[key].frames[0].p);
  if (!m) return '';
  const w = opt.w || 220, h = opt.h || 230;
  const scale = opt.scale || 1;
  const g = project3(v3(0, 0, 0), az, w / 2, m.ground, scale);
  const ox = w / 2, oy = m.ground;
  const body = opt.fault ? 'dmb-body dmb-fault' : 'dmb-body';
  let ghost = null;
  if (opt.ghost && opt.ghostModel) {
    ghost = opt.ghostModel.parts.map((pp) => {
      const a = project3(pp[0], az, ox, oy, scale), b = project3(pp[1], az, ox, oy, scale);
      return { a: a, b: b, r: pp[2], d: (a.d + b.d) / 2 };
    });
  }
  // 按深度排序（远的先画）
  const items = m.parts.map((pp) => {
    const a = project3(pp[0], az, ox, oy, scale), b = project3(pp[1], az, ox, oy, scale);
    return { a: a, b: b, r: pp[2], d: (a.d + b.d) / 2 };
  }).sort((p, q) => p.d - q.d);
  let s = '<svg class="dmb-svg" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMax meet" role="img">';
  s += '<line class="dmb-ground" x1="8" y1="' + oy + '" x2="' + (w - 8) + '" y2="' + oy + '"/>';
  if (m.wall) s += '<rect class="dmb-wall" x="' + (ox - 74 * scale) + '" y="' + (oy - 128 * scale) + '" width="9" height="' + (128 * scale) + '" rx="3"/>';
  if (ghost) {
    for (const it of ghost) {
      const lw = (it.r * 2 * scale).toFixed(1);
      s += '<line class="dmb-ghost-p" x1="' + it.a.x.toFixed(1) + '" y1="' + it.a.y.toFixed(1) + '" x2="' + it.b.x.toFixed(1) + '" y2="' + it.b.y.toFixed(1) + '" stroke-width="' + lw + '" stroke-linecap="round"/>';
    }
  }
  for (const it of items) {
    const lw = (it.r * 2 * scale).toFixed(1);
    s += '<line class="' + body + '" x1="' + it.a.x.toFixed(1) + '" y1="' + it.a.y.toFixed(1) + '" x2="' + it.b.x.toFixed(1) + '" y2="' + it.b.y.toFixed(1) + '" stroke-width="' + lw + '" stroke-linecap="round"/>';
  }
  const hd = project3(m.head, az, ox, oy, scale);
  s += '<circle class="' + (opt.fault ? 'dmb-head dmb-fault' : 'dmb-head') + '" cx="' + hd.x.toFixed(1) + '" cy="' + hd.y.toFixed(1) + '" r="' + (11 * scale).toFixed(1) + '"/>';
  if (m.wall) s += '<text class="dmb-cap" x="' + (ox - 69 * scale) + '" y="' + (oy - 134 * scale) + '">墙</text>';
  s += '</svg>';
  return s;
}
/* 标准角度：直接读 analysis.js 里应用判定用的阈值 */
/* 人体重心与支撑面（用于校验姿势物理上站得稳） */
export function comOf(p) {
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const segs = [[p.head, 0.08], [mid(p.H, p.S), 0.50], [mid(p.S, p.E), 0.05], [mid(p.E, p.W), 0.03], [mid(p.K, p.H), 0.21], [mid(p.A, p.K), 0.13]];
  let x = 0, y = 0;
  for (const [pt, m] of segs) { x += pt[0] * m; y += pt[1] * m; }
  return [x, y];
}
export function supportOf(p) {
  let lo = p.heel[0], hi = p.toe[0];
  if (p.rearHeel) lo = Math.min(lo, p.rearHeel[0]);
  if (p.rearToe) hi = Math.max(hi, p.rearToe[0]);
  return [lo, hi];
}
export function balanceOf(key, params) {
  const p = poseOf(key, params);
  if (!p || p.kind !== 'side') return null;
  const c = comOf(p); const s = supportOf(p);
  return { com: c[0], support: s, margin: Math.min(c[0] - s[0], s[1] - c[0]), wall: !!p.wall };
}
export function demoAngles(key) {
  const e = EXERCISES[key];
  if (!e || !e.rep) return [];
  const out = [];
  if (e.rep.downBelow != null) out.push({ k: 'dmbDownBelow', v: e.rep.downBelow });
  if (e.rep.upAbove != null) out.push({ k: 'dmbUpAbove', v: e.rep.upAbove });
  if (e.rep.hold) out.push({ k: 'dmbHold', v: Math.round((e.rep.holdMs || 0) / 1000) });
  return out;
}

/* ---------- 示范录像：本机 IndexedDB 存取（视频体积大，不能放 localStorage） ---------- */
const DB = 'rehab_demo_v1';
const STORE = 'clips';
export function idbAvailable() { return typeof indexedDB !== 'undefined'; }
function openDB() {
  return new Promise((res, rej) => {
    if (!idbAvailable()) { rej(new Error('no-idb')); return; }
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tr = db.transaction(STORE, mode);
    const st = tr.objectStore(STORE);
    const out = fn(st);
    tr.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    tr.onerror = () => rej(tr.error);
  });
}
export async function clipPut(blob, meta) {
  const m = meta || {};
  const rec = { id: m.id || ('clip-' + Date.now().toString(36)), blob: blob, ts: m.ts || Date.now(),
    ex: m.ex || '', label: m.label || '', durSec: m.durSec || 0, bytes: blob ? blob.size : 0, forEx: m.forEx || '' };
  await tx('readwrite', (st) => st.put(rec));
  return rec;
}
export async function clipAll() {
  const r = await tx('readonly', (st) => st.getAll());
  const arr = r || [];
  return arr.sort((a, b) => b.ts - a.ts);
}
export async function clipDel(id) { await tx('readwrite', (st) => st.delete(id)); }
export async function clipGet(id) { return tx('readonly', (st) => st.get(id)); }
export async function clipSetForEx(id, ex) {
  const rec = await clipGet(id);
  if (!rec) return null;
  rec.forEx = ex;
  await tx('readwrite', (st) => st.put(rec));
  return rec;
}
export async function clipForEx(ex) {
  const all = await clipAll();
  return all.find((c) => c.forEx === ex) || null;
}
