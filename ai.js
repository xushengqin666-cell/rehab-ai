// ai.js — AI 系统管家：体检评分 + 智能建议 + 反馈报告生成
// 纯本地规则引擎：不联网、不收集视频/姓名/邮箱，只汇总本机已有的技术统计。
// 所有文案走 i18n，中英双语。

const ERR_KEY = 'rehab_ai_errors';
const STAT_KEY = 'rehab_ai_stats';
const FB_KEY = 'rehab_feedback_log';

/* ============ 本地诊断日志（供体检与反馈） ============ */
export function aiErrors() {
  try { return JSON.parse(localStorage.getItem(ERR_KEY) || '[]'); } catch { return []; }
}
export function logAiError(tag, msg) {
  const list = aiErrors();
  list.push({ t: Date.now(), tag: String(tag || 'js'), msg: String(msg || '').slice(0, 300) });
  while (list.length > 50) list.shift();
  localStorage.setItem(ERR_KEY, JSON.stringify(list));
}
export function aiStats(key, n = 1) {
  try {
    const s = JSON.parse(localStorage.getItem(STAT_KEY) || '{}');
    s[key] = (s[key] || 0) + n;
    localStorage.setItem(STAT_KEY, JSON.stringify(s));
  } catch { /* 忽略 */ }
}
export function aiStatsGet() {
  try { return JSON.parse(localStorage.getItem(STAT_KEY) || '{}'); } catch { return {}; }
}
export function aiFeedbackLog() {
  try { return JSON.parse(localStorage.getItem(FB_KEY) || '[]'); } catch { return []; }
}
export function aiFeedbackAdd(entry) {
  const list = aiFeedbackLog();
  list.push({ ...entry, t: Date.now() });
  while (list.length > 20) list.shift();
  localStorage.setItem(FB_KEY, JSON.stringify(list));
}

/* ============ 体检：健康评分 + 建议 ============ */
// env: { version, platform, latest, important, sessions: [{ts, reps}], streak,
//        achievementsTotal, achievementsUnlocked, dist: [{ex, reps}], profile: {name, goal, injury},
//        planCount, customCount, errors, cameraFails, modelFails, daysSinceTrain }
export function healthCheck(env) {
  const e = env || {};
  const items = [];
  let score = 100;

  const errs = e.errors || [];
  const cam = e.cameraFails || 0;
  const model = e.modelFails || 0;
  if (errs.length) score -= Math.min(20, errs.length * 4);
  if (cam) score -= Math.min(15, cam * 3);
  if (model) score -= Math.min(15, model * 5);
  const days = e.daysSinceTrain;
  const noTrain = days === null || days === undefined || days >= 7;
  if (noTrain) score -= 15;
  const prof = e.profile || {};
  const profOk = prof.name || prof.injury || (prof.goal && prof.goal !== 'other');
  if (!profOk) score -= 8;
  if (!(e.planCount || 0)) score -= 5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  // 1) 版本更新（重要度最高）
  if (e.latest && e.version && e.latest !== e.version) {
    items.push({ level: e.important ? 'warn' : 'info', icon: 'download', key: e.important ? 'aiUpdImportant' : 'aiUpdInfo', args: { v: e.latest } });
  }
  // 2) 系统异常
  if (errs.length >= 2) items.push({ level: 'warn', icon: 'alert', key: 'aiErrSuggest', args: { n: errs.length } });
  else if (errs.length === 1) items.push({ level: 'info', icon: 'alert', key: 'aiErrOne', args: {} });
  if (cam >= 2) items.push({ level: 'warn', icon: 'camera', key: 'aiCamTip', args: { n: cam } });
  else if (cam === 1) items.push({ level: 'info', icon: 'camera', key: 'aiCamTip', args: { n: cam } });
  if (model >= 1) items.push({ level: 'warn', icon: 'loader', key: 'aiModelTip', args: {} });
  // 3) 训练习惯
  if (noTrain) items.push({ level: 'info', icon: 'flame', key: 'aiTrainEncourage', args: { n: Math.max(7, Math.floor(days || 0)) } });
  if (e.streak >= 7) items.push({ level: 'praise', icon: 'flame', key: 'aiStreak7', args: { n: e.streak } });
  else if (e.streak >= 3) items.push({ level: 'praise', icon: 'flame', key: 'aiStreak', args: { n: e.streak } });
  // 4) 成就临近
  const total = (e.dist || []).reduce((a, d) => a + (d.reps || 0), 0);
  if (total >= 900 && total < 1000) items.push({ level: 'info', icon: 'medal', key: 'aiNearBadge', args: { n: 1000 - total } });
  // 5) 动作均衡
  const dist = e.dist || [];
  if (dist.length >= 3) {
    const top = dist.reduce((a, b) => (b.reps > a.reps ? b : a), dist[0]);
    const share = Math.round((top.reps / Math.max(1, total)) * 100);
    if (share > 60) items.push({ level: 'info', icon: 'target', key: 'aiVariety', args: { ex: top.ex, p: share } });
  }
  // 6) 资料与计划
  if (!profOk) items.push({ level: 'info', icon: 'sliders', key: 'aiProfile', args: {} });
  if (!e.planCount) items.push({ level: 'info', icon: 'schedule', key: 'aiPlan', args: {} });
  if (!items.length) items.push({ level: 'praise', icon: 'check', key: 'aiAllGood', args: {} });

  return { score, items };
}

/* ============ 训练小结建议（停止分析后 AI 点评） ============ */
// stats: { reps, quality(0-100|null), riskEvents, seconds }
export function aiSessionComment(stats) {
  const s = stats || {};
  if (!(s.reps > 0)) return { key: 'aiSessNone', args: {} };
  if (s.riskEvents >= 3) return { key: 'aiSessRisk', args: { n: s.riskEvents } };
  if (s.quality != null && s.quality < 70) return { key: 'aiSessLowQ', args: { q: Math.round(s.quality) } };
  if (s.reps >= 30) return { key: 'aiSessGreat', args: { n: s.reps } };
  if (s.quality != null && s.quality >= 90) return { key: 'aiSessGood', args: { n: s.reps, q: Math.round(s.quality) } };
  return { key: 'aiSessNice', args: { n: s.reps } };
}

/* ============ 反馈报告（隐私友好：只含技术统计，不含视频/身份） ============ */
export function buildFeedbackReport(env, rating, text) {
  const e = env || {};
  const errors = (e.errors || []).slice(-5).map((x) => {
    const d = new Date(x.t || 0);
    return `- [${d.toISOString().slice(0, 16)}] ${x.tag}: ${x.msg}`;
  });
  const dist = (e.dist || []).map((d) => `- ${d.ex}: ${d.reps} 次`).join('\n') || '- 暂无';
  const hc = e.score != null ? e.score : healthCheck(e).score;
  const body = [
    '### 用户反馈',
    `评分：${'⭐'.repeat(Math.max(1, Math.min(5, rating || 5)))} (${rating || 5}/5)`,
    '',
    `${text || '（无文字说明）'}`,
    '',
    '### 系统体检（AI 管家自动收集，无任何个人信息/视频）',
    `- 版本：${e.version || '?'} · 平台：${e.platform || '?'} · 语言：${e.lang || '?'}`,
    `- 健康评分：${hc}/100`,
    `- 训练次数：${(e.sessions || []).length} · 总次数：${(e.dist || []).reduce((a, d) => a + (d.reps || 0), 0)} · 连续天数：${e.streak || 0}`,
    `- 动作分布：\n${dist}`,
    `- 摄像头异常：${e.cameraFails || 0} · 模型加载失败：${e.modelFails || 0}`,
    `- 最近错误日志：\n${errors.length ? errors.join('\n') : '- 无'}`,
  ].join('\n');
  return {
    title: `[反馈] ${e.version || ''} 康复AI 用户反馈（${e.platform || '?'}）`,
    body,
  };
}
