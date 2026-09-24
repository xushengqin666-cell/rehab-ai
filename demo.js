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
  return { kind: 'side', A: A, K: K, H: H, S: S, head: head, E: E, W: W,
    toe: [A[0] + 17, A[1]], heel: [A[0] - 8, A[1]], ground: A[1], knee: knee, lean: lean };
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
    { key: 'demoPrep', p: { beta: 4, knee: 172, lean: 5, arm: 70 } },
    { key: 'demoKey', p: { beta: 8, knee: 95, lean: 18, arm: 88 } },
    { key: 'demoBack', p: { beta: 4, knee: 172, lean: 5, arm: 70 } }],
    faults: [{ key: 'dmbFaultShallow', p: { beta: 6, knee: 142, lean: 10, arm: 74 } },
             { key: 'dmbFaultLean', p: { beta: 11, knee: 108, lean: 34, arm: 96 } }],
    front: { key: 'dmbFaultValgus', p: { kx: 8 } } },
  sitstand: { view: 'side', frames: [
    { key: 'demoPrep', p: { beta: 14, knee: 92, lean: 14, arm: 78 } },
    { key: 'demoKey', p: { beta: 10, knee: 168, lean: 8, arm: 66 } },
    { key: 'demoBack', p: { beta: 14, knee: 92, lean: 14, arm: 78 } }],
    faults: [{ key: 'dmbFaultShallow', p: { beta: 12, knee: 130, lean: 30, arm: 84 } },
             { key: 'dmbFaultLean', p: { beta: 16, knee: 96, lean: 36, arm: 92 } }],
    front: { key: 'dmbFaultValgus', p: { kx: 8 } } },
  stepup: { view: 'side', frames: [
    { key: 'demoPrep', p: { beta: 4, knee: 174, lean: 6, arm: 70 } },
    { key: 'demoKey', p: { beta: 9, knee: 88, lean: 16, arm: 86 } },
    { key: 'demoBack', p: { beta: 4, knee: 174, lean: 6, arm: 70 } }],
    faults: [{ key: 'dmbFaultShallow', p: { beta: 6, knee: 140, lean: 10, arm: 74 } },
             { key: 'dmbFaultLean', p: { beta: 12, knee: 100, lean: 33, arm: 96 } }],
    front: { key: 'dmbFaultValgus', p: { kx: 9 } } },
  lunge: { view: 'side', frames: [
    { key: 'demoPrep', p: { beta: 2, knee: 176, lean: 4, arm: 70 } },
    { key: 'demoKey', p: { beta: 10, knee: 94, lean: 12, arm: 84 } },
    { key: 'demoBack', p: { beta: 2, knee: 176, lean: 4, arm: 70 } }],
    faults: [{ key: 'dmbFaultShallow', p: { beta: 6, knee: 138, lean: 8, arm: 74 } },
             { key: 'dmbFaultLean', p: { beta: 14, knee: 104, lean: 30, arm: 92 } }] },
  hiphinge: { view: 'side', frames: [
    { key: 'demoPrep', p: { beta: 4, knee: 168, lean: 6, arm: 78 } },
    { key: 'demoKey', p: { beta: 10, knee: 148, lean: 55, arm: 150 } },
    { key: 'demoBack', p: { beta: 4, knee: 168, lean: 6, arm: 78 } }],
    faults: [{ key: 'dmbFaultShallow', p: { beta: 6, knee: 164, lean: 22, arm: 96 } },
             { key: 'dmbFaultSag', p: { beta: 14, knee: 120, lean: 62, arm: 160 } }] },
  wallsit: { view: 'side', frames: [
    { key: 'demoPrep', p: { beta: 12, knee: 96, lean: 14, arm: 70 } },
    { key: 'demoKey', p: { beta: 12, knee: 92, lean: 10, arm: 72 } }, 
    { key: 'demoBack', p: { beta: 12, knee: 96, lean: 14, arm: 70 } }],
    faults: [{ key: 'dmbFaultShallow', p: { beta: 8, knee: 130, lean: 12, arm: 72 } }] },
  bend: { view: 'side', frames: [
    { key: 'demoPrep', p: { beta: 4, knee: 170, lean: 6, arm: 74 } },
    { key: 'demoKey', p: { beta: 8, knee: 152, lean: 48, arm: 146 } },
    { key: 'demoBack', p: { beta: 4, knee: 170, lean: 6, arm: 74 } }],
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
export function demoPose(key, t) {
  const d = DEMOS[key];
  if (!d) return null;
  const f = d.frames;
  const n = f.length - 1;
  if (n <= 0) return poseOf(key, f[0].p);          // 单帧动作（如平板支撑）直接返回该帧
  const tt = Math.max(0, Math.min(1, t == null ? 0 : t));
  const seg = Math.min(n - 1, Math.floor(tt * n));
  const k = tt * n - seg;
  const a = f[seg].p, b = f[seg + 1].p;
  const o = {};
  Object.keys(a).forEach((kk) => {
    const va = a[kk], vb = b[kk];
    o[kk] = (Array.isArray(va) && Array.isArray(vb))
      ? [lerp(va[0], vb[0], k), lerp(va[1], vb[1], k)]   // 关节坐标要逐分量插值
      : lerp(va, vb, k);
  });
  return poseOf(key, o);
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
/* 标准角度：直接读 analysis.js 里应用判定用的阈值 */
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
