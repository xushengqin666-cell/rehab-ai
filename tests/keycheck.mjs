// keycheck.mjs — i18n 覆盖率自检：
// 1) 代码中所有 t('key') 与 HTML data-i18n 用到的 key，必须在 zh/en 词典中都存在
// 2) zh 与 en 词典 key 必须一一对应（防漏翻译）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const used = new Set();
// JS: t('key') / t("key") / t(`key`)
for (const f of ['app.js', 'analysis.js', 'ai.js']) {
  const src = read(f);
  for (const m of src.matchAll(/\bt\(\s*['"`]([A-Za-z0-9_]+)['"`]/g)) used.add(m[1]);
}
// HTML: data-i18n / data-i18n-ph
for (const m of read('index.html').matchAll(/data-i18n(?:-ph)?="([A-Za-z0-9_]+)"/g)) used.add(m[1]);

const i18n = read('i18n.js');
const section = (name) => {
  const start = i18n.indexOf(`${name}: {`);
  if (start < 0) return new Set();
  const end = i18n.indexOf('\n  },', start);
  const seg = i18n.slice(start, end < 0 ? i18n.length : end);
  const keys = new Set();
  for (const m of seg.matchAll(/([A-Za-z0-9_]+)\s*:\s*['"`]/g)) keys.add(m[1]);
  // 过滤 JS 关键词误命中（switch 等结构不存在于词典内）
  ['function', 'export', 'const', 'let', 'return', 'if', 'for', 'switch', 'case', 'default'].forEach((k) => keys.delete(k));
  return keys;
};
const zh = section('zh');
const en = section('en');

const missingZh = [...used].filter((k) => !zh.has(k) && !['depth', 'lb_'].includes(k));
const missingEn = [...used].filter((k) => !en.has(k) && !['depth', 'lb_'].includes(k));
const onlyZh = [...zh].filter((k) => !en.has(k) && !['depth', 'lb_', 'retry'].includes(k));
const onlyEn = [...en].filter((k) => !zh.has(k) && !['depth', 'lb_', 'retry'].includes(k));

console.log(`已用 key: ${used.size} | zh 词典: ${zh.size} | en 词典: ${en.size}`);
console.log('缺失 zh 翻译:', missingZh.length ? missingZh.join(', ') : '无');
console.log('缺失 en 翻译:', missingEn.length ? missingEn.join(', ') : '无');
console.log('仅 zh 存在(漏 en):', onlyZh.length ? onlyZh.join(', ') : '无');
console.log('仅 en 存在(漏 zh):', onlyEn.length ? onlyEn.join(', ') : '无');

const bad = missingZh.length + missingEn.length + onlyZh.length + onlyEn.length;
console.log(bad ? 'KEYCHECK: FAIL' : 'KEYCHECK: PASS');
process.exit(bad ? 1 : 0);
