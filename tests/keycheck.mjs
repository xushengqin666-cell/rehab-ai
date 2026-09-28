// keycheck.mjs — i18n 覆盖率自检（v2.42.2 重写解析方式）
//
// 检查内容：
//   1) 代码里 t('key')、HTML 里 data-i18n="key" 用到的 key，必须在 zh / en 两本词典里都存在
//   2) 拼接出来的动态 key（t('romItem' + …)）按其「前缀」校验：词典里必须有同前缀的展开项
//   3) zh 与 en 的 key 集合必须一一对应（防漏翻译）
//
// 为什么重写：老版本全靠正则「刮」文本，有两类系统性误报，导致它长期是 FAIL 状态，
// 而当时的发版脚本又没检查它的退出码，所以谁都没发现（v2.42.2 加上退出码校验后才暴露）：
//   · 拼接前缀被当成独立 key：t('romItem' + it.key…) 刮出「romItem」报成缺失翻译，
//     可词典里真正存在的是展开后的 romItemKneeFlex 这类 key；
//   · 译文里的冒号被当成 key 分隔符：en 词典 'Do now:' 那行刮出一个并不存在的 key「now」。
// 现在词典改为从 i18n.js 的对象字面量直接求值（key 集合精确），代码侧则严格区分
// 「完整字面量 key」与「拼接前缀」，两类都能正确判定。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// ---------- 1) 精确取出 zh / en 两本词典 ----------
// 从 `const DICT = {` 起做「字符串感知」的花括号配对，避免被 '{n}' 这类插值占位符骗到，
// 然后把对象字面量当纯数据求值（i18n.js 里有 document/navigator 用法，不能直接 import）。
function extractDict() {
  const src = read('i18n.js');
  const at = src.indexOf('const DICT = {');
  if (at < 0) throw new Error('i18n.js 里找不到 `const DICT = {`');
  const start = src.indexOf('{', at);
  let depth = 0, quote = null, i = start;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('i18n.js 的 DICT 括号没有配平（文件可能被写坏了）');
  const DICT = new Function('return (' + src.slice(start, i + 1) + ');')();
  if (!DICT.zh || !DICT.en) throw new Error('i18n.js 的 DICT 里缺少 zh 或 en 词典');
  return { zh: new Set(Object.keys(DICT.zh)), en: new Set(Object.keys(DICT.en)) };
}

// ---------- 2) 代码里用到的 key ----------
const staticKeys = new Set();   // 完整字面量：t('key') / t('key', {...})
const dynPrefixes = new Set();  // 拼接前缀：t('romItem' + …)
const scanJs = (f) => {
  const src = read(f);
  for (const m of src.matchAll(/\bt\(\s*(['"`])([A-Za-z0-9_]+)\1\s*[,)]/g)) staticKeys.add(m[2]);
  for (const m of src.matchAll(/\bt\(\s*(['"`])([A-Za-z0-9_]+)\1\s*\+/g)) dynPrefixes.add(m[2]);
};
['app.js', 'analysis.js', 'ai.js'].forEach(scanJs);
for (const m of read('index.html').matchAll(/data-i18n(?:-ph)?="([A-Za-z0-9_]+)"/g)) staticKeys.add(m[1]);

const { zh, en } = extractDict();
const hasPrefix = (dict, p) => { for (const k of dict) if (k.startsWith(p)) return true; return false; };

// 有意「不翻译」的前缀：必须写明理由，且每次运行都会打印出来（不做静默忽略）。
// 目前为空 —— v2.43.1 已给数据采集标签（lb_*）补上中英词条，不再需要豁免。
// 将来要豁免时写在这里，例如：lb_: '理由…'
const INTENTIONAL_PREFIX_FALLBACK = {};

// 同一串既当完整 key 又当前缀时，以「完整 key」为准（前缀就不用再单独要求了）
for (const k of staticKeys) dynPrefixes.delete(k);

const intentional = Object.keys(INTENTIONAL_PREFIX_FALLBACK);
const missingZh = [...staticKeys].filter((k) => !zh.has(k)).sort();
const missingEn = [...staticKeys].filter((k) => !en.has(k)).sort();
const badPrefixZh = [...dynPrefixes].filter((p) => !intentional.includes(p) && !hasPrefix(zh, p)).sort();
const badPrefixEn = [...dynPrefixes].filter((p) => !intentional.includes(p) && !hasPrefix(en, p)).sort();
const onlyZh = [...zh].filter((k) => !en.has(k)).sort();
const onlyEn = [...en].filter((k) => !zh.has(k)).sort();

console.log(`已用 key: ${staticKeys.size}（另有 ${dynPrefixes.size} 个拼接前缀）| zh 词典: ${zh.size} | en 词典: ${en.size}`);
if (intentional.length) {
  for (const p of intentional) console.log(`有意保留原文的前缀: ${p}* —— ${INTENTIONAL_PREFIX_FALLBACK[p]}`);
}
console.log('缺失 zh 翻译:', missingZh.length ? missingZh.join(', ') : '无');
console.log('缺失 en 翻译:', missingEn.length ? missingEn.join(', ') : '无');
console.log('前缀在 zh 词典里没有展开:', badPrefixZh.length ? badPrefixZh.join(', ') : '无');
console.log('前缀在 en 词典里没有展开:', badPrefixEn.length ? badPrefixEn.join(', ') : '无');
console.log('仅 zh 存在(漏 en):', onlyZh.length ? onlyZh.join(', ') : '无');
console.log('仅 en 存在(漏 zh):', onlyEn.length ? onlyEn.join(', ') : '无');

const bad = missingZh.length + missingEn.length + badPrefixZh.length + badPrefixEn.length + onlyZh.length + onlyEn.length;
console.log(bad ? 'KEYCHECK: FAIL' : 'KEYCHECK: PASS');
process.exit(bad ? 1 : 0);
