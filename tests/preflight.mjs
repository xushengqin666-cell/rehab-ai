// tests/preflight.mjs — 发版前置检查（v2.42.2 新增）
//
// 为什么需要它：这个项目踩过两次同类事故，都是「脚本读写文件时的编码」造成的，
// 而且都要等界面或发版时才暴露：
//   · v2.42.1：用 PowerShell 的 Get-Content -Raw | Set-Content 重写 app.js，
//     中文被按 ANSI 读坏后又写成 UTF-8（双重编码），界面文字变成「ĀšÂ¯ĀÂu」这类乱码。
//   · v2.42.2 之前：tests/finish-release.ps1 存成了无 BOM 的 UTF-8，而本机没有 PowerShell 7
//     （只有 5.1，读 .ps1 时按 ANSI 解码），脚本里的中文项目路径变乱码 → 脚本直接跑不起来。
// 另外版本号分散在三处（latest.json / app.js / sw.js），发版时漏改一处就会出现
// 「关于页显示 2.42.1、更新检查拿 2.42.2」这种对不上的状态。
//
// 本检查做三件事：
//   A. 源文件不得含双重编码乱码，也不得含 U+FFFD（文件被写坏的标志）
//   B. 含非 ASCII 的 .ps1 必须带 UTF-8 BOM（否则 5.1 必坏）
//   C. 版本号三处必须一致，且 latest.json 里的 APK 链接要指向当前版本
//
// 用法：
//   node tests/preflight.mjs              # 检查，退出码 0 = 通过
//   node tests/preflight.mjs --selftest   # 自检：确认这些检查真的能抓到问题
import { readFileSync, existsSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 网页静态资源（会被浏览器直接读，乱码会显示在界面上）+ 仓库内脚本 + 仓库外发版脚本
const WEB_FILES = ['index.html', 'app.js', 'style.css', 'i18n.js', 'demo.js', 'demo.css', 'sw.js',
  'manifest.json', 'privacy.html', 'camtest.html', 'analysis.js', 'ai.js', 'latest.json', 'README.md',
  'DESIGN.md', 'rehab-design-system.css'];
const SCRIPT_FILES = ['tests/preflight.mjs', 'tests/full.mjs', 'tests/keycheck.mjs', 'tests/smoke.mjs',
  'tests/system.mjs', 'tests/cloud-e2e.mjs', 'tests/live-smoke.mjs', 'tests/synctest.mjs', 'tests/st.mjs',
  'tests/mock-supabase.mjs', 'tests/start-servers.ps1', 'tests/finish-release.ps1'];
const EXTRA_PS1 = ['C:\\Users\\User\\.rehab-cap\\build-apk.ps1'];

// ---------------------------------------------------------------- A/B 编码检查
// 双重编码特征：正确的 UTF-8 中文里不会出现这些组合（只在「UTF-8 字节被当成 ANSI/Latin-1 读」时出现）。
// 全部用 \u 转义写，避免本文件自己也含有这些字符而被自己误判。
const MOJIBAKE_SRC = [
  '\\u00C3[\\u0080-\\u00BF]', '\\u00C2[\\u0080-\\u00BF]',            // Ãx / Âx（UTF-8 首字节 C3/C2 被读成 Latin-1）
  '\\u00E2\\u20AC', '\\u00E3\\u20AC',                                // â€ / ã€（E2 80 / E3 80 被读成 Latin-1）
  '\\u00E5[\\u0080-\\u00BF]', '\\u00E6[\\u0080-\\u00BF]',            // 中文 UTF-8 首字节 E5/E6/...
  '\\u00E7[\\u0080-\\u00BF]', '\\u00E4[\\u0080-\\u00BF]',
  '\\u00E8[\\u0080-\\u00BF]', '\\u00E9[\\u0080-\\u00BF]',
].join('|');

// 只认「真的双重编码」：把可疑片段按 Latin-1 还原回字节、再按 UTF-8 解码，能还原出中文才算。
// 这样不会误报 —— 例如 latest.json 的更新说明里就**引用**了乱码样例当反面教材。
// 局限：对「中文被写坏」敏感；纯英文文件里的标点被写坏抓不到（那种文件没有中文，
// 网页资源另有 full.mjs 第 36 节断言把关）。
export function findDoubleEncoded(text) {
  const out = [];
  const re = new RegExp(MOJIBAKE_SRC, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = Math.max(0, m.index - 40);
    const win = text.slice(start, Math.min(text.length, m.index + m[0].length + 40));
    if (/[\u4e00-\u9fff]/.test(win)) continue;            // 上下文里有正常中文 → 不是被写坏的环境
    const restored = Buffer.from(win, 'latin1').toString('utf8');
    if (restored.includes('\uFFFD')) continue;            // 还原不出合法 UTF-8
    if (!/[\u4e00-\u9fff]{2,}/.test(restored)) continue;  // 还原不出中文
    out.push({ index: m.index, hit: m[0], restored: restored.replace(/\s+/g, ' ').slice(0, 50) });
    re.lastIndex = m.index + m[0].length;                 // 同一处只报一次
  }
  return out;
}

const hasBom = (buf) => buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
const hasNonAscii = (buf) => { for (const b of buf) if (b > 127) return true; return false; };

// 用 GBK 解码看看 5.1 会把它读成什么（给出直观证据）
function gbkPreview(buf) {
  try {
    const text = new TextDecoder('gbk').decode(buf);
    const line = text.split(/\r?\n/).find((l) => /\ufffd/.test(l)) || text.split(/\r?\n/).find((l) => l.trim()) || '';
    return line.trim().slice(0, 100);
  } catch { return '(本机 Node 无 GBK 解码器)'; }
}

export function checkEncoding(targets) {
  const errors = [];
  let checked = 0;
  for (const { path, label, ps1 } of targets) {
    if (!existsSync(path)) continue;
    checked++;
    let buf, text;
    try { buf = readFileSync(path); text = buf.toString('utf8'); } catch (e) { errors.push(`${label}：读取失败 ${e.message}`); continue; }
    const hits = findDoubleEncoded(text);
    if (hits.length) {
      errors.push(`${label}：发现 ${hits.length} 处双重编码乱码（原文「${hits[0].hit}」还原后是「${hits[0].restored}」），` +
        `这个文件被「按 ANSI 读 → 按 UTF-8 写」过，中文已损坏`);
    }
    if (text.includes('\uFFFD')) errors.push(`${label}：含 U+FFFD 替换字符（文件已被写坏，不是合法 UTF-8）`);
    if (ps1 && hasNonAscii(buf) && !hasBom(buf)) {
      errors.push(`${label}：含中文但没有 UTF-8 BOM —— 本机只有 PowerShell 5.1，会按 ANSI 解码，` +
        `中文路径/提交信息变乱码并报奇怪的语法错误。5.1 实际会读成：${gbkPreview(buf)}`);
    }
  }
  return { errors, checked };
}

// ---------------------------------------------------------------- C 版本一致性
export function checkVersions(root) {
  const errors = [];
  const read = (p) => readFileSync(join(root, p), 'utf8');
  const pick = (p, re, what) => {
    const m = read(p).match(re);
    if (!m) { errors.push(`${p}：找不到${what}（正则 ${re}）`); return null; }
    return m[1];
  };
  let jver = null;
  try {
    const meta = JSON.parse(read('latest.json'));
    jver = meta.version;
    if (meta.apk && !String(meta.apk).includes(`v${meta.version}.apk`)) {
      errors.push(`latest.json：apk 链接指向的不是当前版本（version=${meta.version}，apk=${meta.apk}）—— ` +
        `安卓端会下载到旧包或 404`);
    }
  } catch (e) { errors.push(`latest.json：解析失败 ${e.message}`); }
  const aver = pick('app.js', /APP_VERSION\s*=\s*'v?([\d.]+)'/, 'APP_VERSION');
  const sver = pick('sw.js', /CACHE\s*=\s*'rehab-v?([\d.]+)'/, 'CACHE 版本');
  const trio = [['latest.json', jver], ['app.js APP_VERSION', aver], ['sw.js CACHE', sver]].filter(([, v]) => v);
  const uniq = [...new Set(trio.map(([, v]) => v))];
  if (uniq.length > 1) {
    errors.push(`版本号三处不一致：${trio.map(([k, v]) => `${k}=${v}`).join(' / ')} —— ` +
      `关于页显示的版本、更新检查拿到的版本、Service Worker 缓存名必须同一个`);
  }
  return { errors, version: uniq.length === 1 ? uniq[0] : null };
}

// ---------------------------------------------------------------- 汇总
export function targets(root) {
  const list = [];
  for (const f of WEB_FILES) list.push({ path: join(root, f), label: f });
  for (const f of SCRIPT_FILES) list.push({ path: join(root, f), label: f, ps1: f.endsWith('.ps1') });
  for (const f of EXTRA_PS1) list.push({ path: f, label: f, ps1: true });
  return list;
}

export function runAll(root) {
  const enc = checkEncoding(targets(root));
  const ver = checkVersions(root);
  return { errors: [...enc.errors, ...ver.errors], checked: enc.checked, version: ver.version };
}

// 自检：确认检查真的能抓到问题（而不是永远返回通过）
if (process.argv.includes('--selftest')) {
  const dir = mkdtempSync(join(tmpdir(), 'preflight-'));
  // 1) 编码：无 BOM 的中文 .ps1、双重编码的 JS、合规的 .ps1
  const badPs1 = join(dir, 'bad.ps1');
  writeFileSync(badPs1, "$ROOT = 'C:\\Users\\User\\Desktop\\项目文件夹'\n", 'utf8');
  const okPs1 = join(dir, 'ok.ps1');
  writeFileSync(okPs1, '\uFEFF' + "$ROOT = 'C:\\Users\\User\\Desktop\\项目文件夹'\n", 'utf8');
  const badJs = join(dir, 'bad.js');
  // 构造双重编码：UTF-8 字节被当作 Latin-1 再编码一次（正是 v2.42.1 事故的产物形态）
  writeFileSync(badJs, `const t = "${Buffer.from('康复AI', 'utf8').toString('latin1')}";\n`, 'utf8');
  const enc = checkEncoding([
    { path: badPs1, label: 'bad.ps1', ps1: true },
    { path: okPs1, label: 'ok.ps1', ps1: true },
    { path: badJs, label: 'bad.js' },
  ]);
  const caughtPs1 = enc.errors.some((e) => e.includes('bad.ps1') && e.includes('没有 UTF-8 BOM'));
  const caughtJs = enc.errors.some((e) => e.includes('bad.js'));
  const noFalsePositive = !enc.errors.some((e) => e.includes('ok.ps1'));

  // 2) 版本：构造三处不一致的仓库，必须被抓到；改成一致后必须通过
  const vdir = join(dir, 'repo');
  mkdirSync(vdir);
  writeFileSync(join(vdir, 'latest.json'), JSON.stringify({ version: '9.9.9', apk: 'https://x/RehabAI-v9.9.9.apk' }), 'utf8');
  writeFileSync(join(vdir, 'app.js'), "const APP_VERSION = 'v1.0.0';\n", 'utf8');
  writeFileSync(join(vdir, 'sw.js'), "const CACHE = 'rehab-v1.0.0';\n", 'utf8');
  const mismatch = checkVersions(vdir).errors.length > 0;
  writeFileSync(join(vdir, 'app.js'), "const APP_VERSION = 'v9.9.9';\n", 'utf8');
  writeFileSync(join(vdir, 'sw.js'), "const CACHE = 'rehab-v9.9.9';\n", 'utf8');
  const aligned = checkVersions(vdir).errors.length === 0;
  writeFileSync(join(vdir, 'latest.json'), JSON.stringify({ version: '9.9.9', apk: 'https://x/RehabAI-v1.0.0.apk' }), 'utf8');
  const badApkLink = checkVersions(vdir).errors.some((e) => e.includes('apk 链接'));

  const checks = { caughtPs1, caughtJs, noFalsePositive, mismatch, aligned, badApkLink };
  console.log('自检：' + Object.entries(checks).map(([k, v]) => `${k}=${v}`).join(' / '));
  const ok = Object.values(checks).every(Boolean);
  console.log(ok ? '自检通过' : '自检失败：前置检查本身有问题');
  process.exit(ok ? 0 : 1);
}

const { errors, checked, version } = runAll(ROOT);
if (errors.length) {
  console.log(`发版前置检查：检查 ${checked} 个文件，发现 ${errors.length} 个问题`);
  for (const e of errors) console.log('FAIL ' + e);
  process.exit(1);
}
console.log(`发版前置检查：${checked} 个文件无乱码、.ps1 编码正确、版本号三处一致（v${version}）`);
process.exit(0);
