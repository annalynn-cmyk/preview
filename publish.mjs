#!/usr/bin/env node
/**
 * publish.mjs — put a built site (or a single HTML file) into this repo so it can
 * be shared as a link instead of a zip.
 *
 * The problem this solves. GitHub Pages serves this repo from a SUB-PATH:
 *
 *     https://annalynn-cmyk.github.io/preview/
 *
 * A site built for its own domain writes root-absolute references — href="/about-us/",
 * src="/assets/app.css". Those resolve against the ORIGIN, not the sub-path, so dropped
 * in as-is the page reaches for https://annalynn-cmyk.github.io/about-us/ and gets a 404.
 * Every link, stylesheet and image breaks and the site renders naked.
 *
 * So publishing is a copy PLUS a rewrite: every root-absolute reference is re-pointed at
 * /preview/<slug>/. Protocol-relative (//cdn...) and absolute (https://...) references are
 * left alone — they already say where they mean.
 *
 * The patterns below are REGEX LITERALS on purpose. Built as strings via new RegExp(`...`)
 * they need doubled backslashes, and a single missing one turns \s into a literal "s" and
 * the rewrite silently matches nothing — which is exactly how this script failed first run.
 *
 * Usage:
 *   node publish.mjs --from <dir-or-html-file> --slug <name> [--title "..."] [--note "..."]
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Pages project path. Repo `preview` under user `annalynn-cmyk` publishes at
// /preview/ — change this only if the repo is renamed.
const SITE_BASE = '/preview';

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1]; };

const from = arg('from');
const slug = arg('slug');
const title = arg('title') || slug;
const note = arg('note') || '';

if (!from || !slug) {
  console.error('usage: node publish.mjs --from <dir-or-file> --slug <name> [--title "..."] [--note "..."]');
  process.exit(2);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error(`--slug must be lowercase letters, digits and dashes; got "${slug}"`);
  process.exit(2);
}

const src = resolve(from);
if (!existsSync(src)) { console.error(`--from does not exist: ${src}`); process.exit(2); }

const repoRoot = dirname(fileURLToPath(import.meta.url));
const destDir = join(repoRoot, slug);
const base = `${SITE_BASE}/${slug}`;

// Text types we rewrite. Everything else is copied byte-for-byte.
const REWRITE = new Set(['.html', '.htm', '.css', '.xml', '.svg']);

// attr="/path" -> attr="/preview/<slug>/path", but never attr="//host/path".
// `content` is here for og:url / og:image style meta; a content value that is not a
// path is untouched because the pattern requires a single leading slash.
const ATTR_RE = /\b(href|src|action|formaction|poster|srcset|data-src|data-href|content)(\s*=\s*)(["'])\/(?!\/)/gi;
// CSS url(/path) -> url(/preview/<slug>/path)
const CSS_URL_RE = /url\(\s*(["']?)\/(?!\/)/gi;

let filesCopied = 0, filesRewritten = 0, refsRewritten = 0;

function rewrite(text) {
  let n = 0;
  text = text.replace(ATTR_RE, (_m, a, eq, q) => { n++; return `${a}${eq}${q}${base}/`; });
  text = text.replace(CSS_URL_RE, (_m, q) => { n++; return `url(${q}${base}/`; });
  refsRewritten += n;
  return { text, n };
}

function walk(srcPath, dstPath) {
  const st = statSync(srcPath);
  if (st.isDirectory()) {
    mkdirSync(dstPath, { recursive: true });
    for (const entry of readdirSync(srcPath)) {
      if (entry === '.git') continue;
      walk(join(srcPath, entry), join(dstPath, entry));
    }
    return;
  }
  mkdirSync(dirname(dstPath), { recursive: true });
  if (REWRITE.has(extname(srcPath).toLowerCase())) {
    const { text, n } = rewrite(readFileSync(srcPath, 'utf8'));
    writeFileSync(dstPath, text);
    if (n > 0) filesRewritten++;
  } else {
    copyFileSync(srcPath, dstPath);
  }
  filesCopied++;
}

// A clean slate, so a re-publish never leaves the last build's orphans behind.
if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
mkdirSync(destDir, { recursive: true });

if (statSync(src).isDirectory()) walk(src, destDir);
else walk(src, join(destDir, 'index.html'));

// A publish that rewrote nothing is almost always the bug above, not a site that
// happened to use relative paths. Say so loudly rather than shipping a broken copy.
if (refsRewritten === 0) {
  console.warn(`  WARNING: 0 references rewritten. If ${slug} uses root-absolute paths, it will be broken.`);
}

// Record what was published so index.html can be regenerated from fact, not memory.
const manifestPath = join(repoRoot, 'published.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { items: [] };
manifest.items = manifest.items.filter((i) => i.slug !== slug);
manifest.items.push({
  slug, title, note,
  published: new Date().toLocaleDateString('en-CA'),
  files: filesCopied,
  refs: refsRewritten,
  url: `${base}/`,
});
manifest.items.sort((a, b) => a.title.localeCompare(b.title));
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

renderIndex(manifest, repoRoot);

console.log(`published  ${slug}`);
console.log(`  from     ${src}`);
console.log(`  files    ${filesCopied} copied, ${filesRewritten} rewritten`);
console.log(`  refs     ${refsRewritten} root-absolute references re-pointed at ${base}/`);
console.log(`  url      https://annalynn-cmyk.github.io${base}/`);

/**
 * The directory page. Rebuilt from published.json on every publish so the list of
 * links is a record of what is actually in the repo, never a hand-kept list that
 * drifts from it.
 */
function renderIndex(manifest, root) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const cards = manifest.items.map((i) => `      <li class="card">
        <a class="card-link" href="${esc(i.url)}">
          <h2>${esc(i.title)}</h2>
          ${i.note ? `<p class="note">${esc(i.note)}</p>` : ''}
          <p class="meta">
            <span>${i.files.toLocaleString('en-US')} file${i.files === 1 ? '' : 's'}</span>
            <span>published ${esc(i.published)}</span>
          </p>
        </a>
      </li>`).join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Preview builds</title>
<style>
  :root{
    color-scheme: light dark;
    --bg:#fbfaf8; --panel:#ffffff; --ink:#1a1a1a; --muted:#6b6b6b;
    --line:#e5e2dd; --accent:#1c4f8f; --shadow:0 1px 2px rgba(0,0,0,.05), 0 8px 24px rgba(0,0,0,.05);
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#14161a; --panel:#1b1e24; --ink:#eceef1; --muted:#9aa1ac;
      --line:#2a2f37; --accent:#7fb0ef; --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.3);
    }
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:var(--bg); color:var(--ink);
    font:16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    padding: env(safe-area-inset-top,0px) 20px env(safe-area-inset-bottom,0px);
  }
  .wrap{max-width:760px; margin:0 auto; padding-block:56px 72px}
  header{border-bottom:1px solid var(--line); padding-bottom:24px; margin-bottom:8px}
  h1{font-size:26px; letter-spacing:-.02em; margin:0 0 8px}
  .lede{color:var(--muted); margin:0; max-width:56ch}
  ul{list-style:none; margin:32px 0 0; padding:0; display:grid; gap:14px}
  .card{background:var(--panel); border:1px solid var(--line); border-radius:12px; box-shadow:var(--shadow); overflow:hidden}
  .card-link{display:block; padding:20px 22px; text-decoration:none; color:inherit}
  .card-link:hover h2, .card-link:focus-visible h2{color:var(--accent); text-decoration:underline}
  .card-link:focus-visible{outline:2px solid var(--accent); outline-offset:-2px}
  h2{font-size:18px; margin:0 0 6px; letter-spacing:-.01em}
  .note{color:var(--muted); margin:0 0 12px; font-size:14.5px}
  .meta{display:flex; flex-wrap:wrap; gap:6px 16px; margin:0; font-size:13px; color:var(--muted)}
  footer{margin-top:40px; padding-top:20px; border-top:1px solid var(--line); color:var(--muted); font-size:13.5px}
  footer p{margin:0 0 8px; max-width:62ch}
  code{background:var(--bg); border:1px solid var(--line); border-radius:5px; padding:1px 5px; font-size:12.5px}
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Preview builds</h1>
      <p class="lede">Work in progress, published as links instead of zips. Everything here is a
      review copy: unfinished in places, and none of it is live.</p>
    </header>

    <ul>
${cards}
    </ul>

    <footer>
      <p>These pages carry <code>noindex</code>, but the repository is public — treat a link
      as shareable with the team, not as private.</p>
      <p>To add one: <code>node publish.mjs --from &lt;dir&gt; --slug &lt;name&gt; --title "..."</code>,
      then commit and push. This page rebuilds itself from <code>published.json</code>.</p>
    </footer>
  </div>
</body>
</html>
`;
  writeFileSync(join(root, 'index.html'), html);
}
