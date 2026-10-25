/* ============================================================================
 * evidence.js —— 测量依据（Measurement evidence）
 *
 * 本模块把《基于无标记计算机视觉的静态体态定量评估》系统综述中的**测量误差与
 * 最小可检测变化（MDC）**结论，落成 App 可执行的判定规则：
 * 两次测量之间的差异必须先跨过测量误差，才能称为「真实变化」。
 *
 * 综述给出的关键事实（引用见各条 src）：
 * 1. 标准化 2D 矢状面摄影：SEM 0.7–1.3° → MDC95 ≈ 1.9–3.6°（唯一可直接判「真实变化」的量级）。
 * 2. 颅椎角 CVA：MDC 4.96–5.52°。
 * 3. 额状面体表测量误差约 4–8°，**超过轻度畸形常见治疗决策的角度差** →
 *    只能做筛查与粗随访，不能做个体水平变化检测。
 * 4. 膝角跨测角设备一致性界限达 11.36°（Kiatkulanusorn 2023）。
 * 5. 阈值效应：小角度偏差本身不可靠（剔除 <5°/7° 后相关性由 0.51 升至 0.97–0.99）。
 * 6. 信度必须与偏倚、绝对误差、一致性一起解读（COSMIN）。
 *
 * 设计约束：纯数据 + 纯函数，无 DOM、无 i18n 依赖，便于测试。
 * ========================================================================== */

/* 体态评估各指标的测量误差门槛
 * mdc  : 判定「真实变化」的最小差值（大于等于才算变化）
 * unit : '°' 角度 / '%' 比例
 * pol  : 'low' = 越低越好；'band' = 目标区间，看是否更靠近区间
 * src  : 文献来源（作者 + 年份，语言中立）
 * why  : i18n key，解释这条门槛的依据与适用边界
 */
export const EV_METRICS = {
  mStandHead: { mdc: 5.5, unit: '°', pol: 'low', src: 'Gallego-Izquierdo 2020', why: 'evWhyHead' },
  mStandTrunk: { mdc: 3.6, unit: '°', pol: 'low', src: 'Stolinski 2017', why: 'evWhySagittal' },
  mStandKnee: { mdc: 11.4, unit: '°', pol: 'low', src: 'Kiatkulanusorn 2023', why: 'evWhyKnee' },
  mStandShoulder: { mdc: 14, unit: '%', pol: 'low', src: 'Stolinski 2017', why: 'evWhyFrontal' },
  mStandPelvis: { mdc: 14, unit: '%', pol: 'low', src: 'Stolinski 2017', why: 'evWhyFrontal' },
  mStandWeight: { mdc: 14, unit: '%', pol: 'low', src: 'Stolinski 2017', why: 'evWhyFrontal' },
  mSingleKnee: { mdc: 5, unit: '°', pol: 'low', src: 'Fan 2022', why: 'evWhyVariability' },
  mSinglePelvis: { mdc: 14, unit: '%', pol: 'low', src: 'Stolinski 2017', why: 'evWhyFrontal' },
  mSingleTrunk: { mdc: 3.6, unit: '°', pol: 'low', src: 'Stolinski 2017', why: 'evWhySagittal' },
  mSingleSway: { mdc: 14, unit: '%', pol: 'low', src: 'Stolinski 2017', why: 'evWhyFrontal' },
  mSquatDepth: { mdc: 11.4, unit: '°', pol: 'low', src: 'Kiatkulanusorn 2023', why: 'evWhyKnee' },
  mSquatSym: { mdc: 16, unit: '°', pol: 'low', src: 'Kiatkulanusorn 2023', why: 'evWhySym' },
  mSquatValgus: { mdc: 14, unit: '%', pol: 'low', src: 'Stolinski 2017', why: 'evWhyFrontal' },
  mSquatTrunk: { mdc: 3.6, unit: '°', pol: 'band', band: [10, 35], src: 'Stolinski 2017', why: 'evWhyBand' },
  mSquatHold: { mdc: 5, unit: '°', pol: 'low', src: 'Fan 2022', why: 'evWhyVariability' },
};

/** 该指标是否有可用于判定的误差门槛 */
export const hasEvidence = (key) => Object.prototype.hasOwnProperty.call(EV_METRICS, key);

/** 指标门槛（可能为 undefined） */
export const evOf = (key) => EV_METRICS[key] || null;

/**
 * 判定两次测量之间的变化是否为真实变化。
 * @returns {{verdict:'better'|'worse'|'noise', delta:number, mdc:number, unit:string, src:string, whyKey:string}|null}
 */
export function classifyChange(key, now, prev) {
  const m = EV_METRICS[key];
  if (!m || now == null || prev == null || !Number.isFinite(now) || !Number.isFinite(prev)) return null;
  const delta = now - prev;
  const out = { verdict: 'noise', delta, mdc: m.mdc, unit: m.unit, src: m.src, whyKey: m.why };
  if (Math.abs(delta) < m.mdc) return out;           // 未跨过测量误差 → 无法判定为真实变化
  if (m.pol === 'band') {
    const [lo, hi] = m.band;
    const dist = (v) => (v < lo ? lo - v : v > hi ? v - hi : 0);
    out.verdict = dist(now) < dist(prev) ? 'better' : dist(now) > dist(prev) ? 'worse' : 'noise';
    return out;
  }
  out.verdict = (m.pol === 'low' ? delta < 0 : delta > 0) ? 'better' : 'worse';
  return out;
}

/** 逐指标比较两份体态报告（同 kind、含 raw 数值） */
export function compareReports(nowReport, prevReport) {
  if (!nowReport || !prevReport) return [];
  if (nowReport.kind !== prevReport.kind) return [];
  const prevMap = new Map();
  (prevReport.items || []).forEach((it) => {
    if (it && it.key != null && typeof it.raw === 'number') prevMap.set(it.key, it.raw);
  });
  const rows = [];
  (nowReport.items || []).forEach((it) => {
    if (!it || it.key == null || typeof it.raw !== 'number') return;
    if (!prevMap.has(it.key)) return;
    const c = classifyChange(it.key, it.raw, prevMap.get(it.key));
    if (!c) return;
    rows.push({
      key: it.key,
      now: it.raw,
      prev: prevMap.get(it.key),
      unit: c.unit,
      delta: c.delta,
      mdc: c.mdc,
      verdict: c.verdict,
      src: c.src,
      whyKey: c.whyKey,
    });
  });
  // 先显示有真实变化的，再显示在误差内的
  rows.sort((a, b) => (a.verdict === 'noise' ? 1 : 0) - (b.verdict === 'noise' ? 1 : 0));
  return rows;
}

/** 证据来源清单（供「测量依据」卡片展示） */
export const EV_SOURCES = [
  { src: 'Stolinski 2017', key: 'evSrcStolinski' },
  { src: 'Gallego-Izquierdo 2020', key: 'evSrcGallego' },
  { src: 'Kiatkulanusorn 2023', key: 'evSrcKiat' },
  { src: 'Fan 2022', key: 'evSrcFan' },
];

/** 综述的三条总体结论（供卡片与方法说明引用） */
export const EV_PRINCIPLES = ['evPrincipleNoise', 'evPrincipleFrontal', 'evPrincipleThreshold'];
