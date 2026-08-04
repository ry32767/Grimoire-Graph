// Grimoire Graph エンジン(TypeScript)をビルド無しでブラウザに読み込むローダ。
// 各 .ts を fetch → Babel(preset typescript)で型だけ除去 → 相対 import を blob URL に
// 差し替えて動的 import する。ソースは元リポジトリのまま無改変。
const BABEL_URL = 'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js';
const ROOT = new URL('./', import.meta.url);

function ensureBabel() {
  if (window.Babel) return Promise.resolve();
  if (window.__babelLoading) return window.__babelLoading;
  window.__babelLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = BABEL_URL;
    s.onload = res;
    s.onerror = () => rej(new Error('Babel standalone の読み込みに失敗'));
    document.head.appendChild(s);
  });
  return window.__babelLoading;
}

// npm 依存はブラウザ用 ESM CDN に読み替える（元コードは無改変）。
const BARE = { mathjs: 'https://esm.sh/mathjs@14.0.1' };

const cache = new Map();

function resolveSpec(baseUrl, spec) {
  let u = new URL(spec, baseUrl);
  if (!/\.[a-z]+$/.test(u.pathname)) u = new URL(u.href + '.ts');
  return u.href;
}

// 変換結果は localStorage に載せる（初回だけ Babel を回し、2回目以降は即起動）
const CACHE_V = 'gg-ts-v1:';
function cacheGet(url, src) {
  try { const hit = localStorage.getItem(CACHE_V + url);
    if (!hit) return null;
    const o = JSON.parse(hit);
    return o && o.len === src.length ? o.code : null;
  } catch (e) { return null; }
}
function cacheSet(url, src, code) {
  try { localStorage.setItem(CACHE_V + url, JSON.stringify({ len: src.length, code })); } catch (e) { /* quota: 諦める */ }
}

async function build(url) {
  if (cache.has(url)) return cache.get(url);
  const promise = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`engine: ${url} が取得できません (${res.status})`);
    const src = await res.text();
    let code = cacheGet(url, src);
    if (code == null) {
      await ensureBabel();
      code = window.Babel.transform(src, {
        filename: url.replace(/^.*\//, ''),
        presets: [['typescript', { allowDeclareFields: true }]],
        sourceType: 'module',
      }).code;
      cacheSet(url, src, code);
    }

    const specs = new Set();
    const collect = (re) => {
      let m;
      while ((m = re.exec(code))) specs.add(m[1]);
    };
    collect(/\bfrom\s*['"]([^'"]+)['"]/g);
    collect(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    collect(/\bimport\s*['"]([^'"]+)['"]/g);

    const mapped = await Promise.all(
      [...specs].map(async (s) => {
        if (s.startsWith('.')) return [s, await build(resolveSpec(url, s))];
        const cdn = BARE[s.split('/')[0]];
        if (!cdn) throw new Error(`engine: 未対応の依存 "${s}" (${url})`);
        return [s, cdn];
      })
    );
    for (const [spec, blobUrl] of mapped) {
      code = code.split(`'${spec}'`).join(`'${blobUrl}'`).split(`"${spec}"`).join(`"${blobUrl}"`);
    }
    return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  })();
  cache.set(url, promise);
  return promise;
}

const MODULES = {
  battle: 'game/battle.ts',
  turn: 'game/turn.ts',
  enemyAI: 'game/enemyAI.ts',
  functions: 'game/functions.ts',
  recommend: 'game/recommend.ts',
  physics: 'game/physics.ts',
  coords: 'game/coords.ts',
  collision: 'game/collision.ts',
  obstacle: 'game/obstacle.ts',
  carve: 'game/carve.ts',
  orbit: 'game/orbit.ts',
  parry: 'game/parry.ts',
  misfire: 'game/misfire.ts',
  instability: 'game/misfireInstability.ts',
  attribute: 'game/attribute.ts',
  zfields: 'game/zfields.ts',
  loop: 'game/loop.ts',
  status: 'game/status.ts',
  exprFit: 'game/exprFit.ts',
  mathEngine: 'game/mathEngine.ts',
  constants: 'data/constants.ts',
  party: 'data/party.ts',
  stages: 'data/stages.ts',
  builders: 'data/stageBuilders.ts',
  draw: 'render/draw.ts',
  palette: 'render/palette.ts',
  theme: 'render/theme.ts',
  species: 'render/species.ts',
};

window.GrimoireEngineReady = (async () => {
  const entries = await Promise.all(
    Object.entries(MODULES).map(async ([key, rel]) => {
      const blobUrl = await build(new URL(rel, ROOT).href);
      return [key, await import(/* @vite-ignore */ blobUrl)];
    })
  );
  const engine = Object.fromEntries(entries);
  window.GrimoireEngine = engine;
  window.dispatchEvent(new CustomEvent('grimoire-engine-ready', { detail: engine }));
  return engine;
})();

window.GrimoireEngineReady.catch((e) => console.error('[engine]', e));
