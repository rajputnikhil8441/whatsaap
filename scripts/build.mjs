// Dependency-free static build: copies src/ to dist/, injects PUBLIC configuration,
// and writes robots.txt + sitemap.xml. Only public values are ever written to dist/.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv(file = join(root, '.env')) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const escapeXml = escapeHtml;

/** Refuse keys that are secrets: the service-role key must never reach the browser. */
export function assertPublicKey(key) {
  if (!key) return;
  if (key.startsWith('sb_secret_')) throw new Error('SUPABASE_ANON_KEY looks like a SECRET key. Use the publishable/anon key only.');
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (payload.role === 'service_role') throw new Error('SUPABASE_ANON_KEY is a service_role key. Never use it in the frontend; use the anon/publishable key.');
    } catch (e) {
      if (e.message.includes('service_role')) throw e;
    }
  }
}

async function fetchBrandsForSitemap(url, key) {
  const res = await fetch(`${url}/rest/v1/brands?select=slug,updated_at&is_active=eq.true&order=sort_order.asc`, {
    headers: { apikey: key },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Canonical production origin. Used when SITE_URL is missing or points at localhost. */
export const PRODUCTION_URL = 'https://whatsapp-link.com';
const LOCAL_URL = 'http://localhost:8080';

function isLocalHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0' || /^127(\.\d{1,3}){3}$/.test(h);
}

/**
 * Public site URL used for canonical links, Open Graph, robots.txt and sitemap.xml.
 * - Missing/blank, or a localhost address -> PRODUCTION_URL, so a deploy that forgot SITE_URL
 *   never publishes localhost URLs. A real, non-local SITE_URL is always honoured.
 * - localDev (`npm run dev` passes --local) keeps http://localhost:8080 / an explicit localhost value.
 * - A malformed value (not http/https) is an error.
 */
export function resolveSiteUrl(raw, { localDev = false } = {}) {
  const value = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!value) return { url: localDev ? LOCAL_URL : PRODUCTION_URL, fallback: true };
  if (!/^https?:\/\//i.test(value)) throw new Error('SITE_URL must start with http:// or https://');
  let hostname;
  try { hostname = new URL(value).hostname; } catch { throw new Error('SITE_URL is not a valid URL'); }
  if (isLocalHost(hostname) && !localDev) return { url: PRODUCTION_URL, fallback: true };
  return { url: value, fallback: false };
}

export async function build({ outDir = join(root, 'dist'), env = { ...loadEnv(), ...process.env }, log = console.log, localDev = false } = {}) {
  const supabaseUrl = (env.SUPABASE_URL || '').replace(/\/+$/, '');
  const supabaseAnonKey = env.SUPABASE_ANON_KEY || '';
  const { url: siteUrl, fallback: siteUrlFallback } = resolveSiteUrl(env.SITE_URL, { localDev });
  // Do not read SITE_NAME: Netlify reserves it and sets it to the project name on every build.
  const siteName = env.SITE_TITLE || 'WhatsApp Contact Hub';

  if (siteUrlFallback && !localDev) log(`note: SITE_URL is missing or points to localhost; using ${PRODUCTION_URL} for canonical URLs, Open Graph and sitemap.xml.`);
  if (supabaseUrl && !/^https?:\/\//.test(supabaseUrl)) throw new Error('SUPABASE_URL must start with https://');
  assertPublicKey(supabaseAnonKey);

  rmSync(outDir, { recursive: true, force: true });
  cpSync(join(root, 'src'), outDir, { recursive: true });

  // Fill %SITE_URL% / %SITE_NAME% (template tokens, not env vars) placeholders in every html file.
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  for (const file of walk(outDir).filter((f) => f.endsWith('.html'))) {
    writeFileSync(file, readFileSync(file, 'utf8')
      .replaceAll('%SITE_URL%', escapeHtml(siteUrl))
      .replaceAll('%SITE_NAME%', escapeHtml(siteName))
      .replaceAll('%YEAR%', String(new Date().getFullYear())));
  }

  const config = { supabaseUrl, supabaseAnonKey, siteUrl, siteName };
  mkdirSync(join(outDir, 'js'), { recursive: true });
  writeFileSync(join(outDir, 'js', 'config.js'),
    `window.HUB_CONFIG = ${JSON.stringify(config).replace(/</g, '\\u003c')};\n`);

  writeFileSync(join(outDir, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${siteUrl}/sitemap.xml\n`);

  let brands = [];
  if (supabaseUrl && supabaseAnonKey) {
    try {
      brands = await fetchBrandsForSitemap(supabaseUrl, supabaseAnonKey);
    } catch (err) {
      log(`warning: could not read brands for sitemap.xml (${err.message}); sitemap lists the homepage only.`);
    }
  } else {
    log('note: SUPABASE_URL / SUPABASE_ANON_KEY not set; site will run in sample-data preview mode.');
  }
  const urls = [{ loc: `${siteUrl}/` }, ...brands.map((b) => ({ loc: `${siteUrl}/brand/${b.slug}`, lastmod: b.updated_at }))];
  writeFileSync(join(outDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${escapeXml(u.lastmod)}</lastmod>` : ''}</url>`).join('\n') +
    `\n</urlset>\n`);

  // Hosting files (SPA rewrites + headers) live in /hosting and go to the dist root.
  for (const f of ['_redirects', '_headers']) cpSync(join(root, 'hosting', f), join(outDir, f));

  log(`built ${outDir} (${urls.length} sitemap url(s)).`);
  return { outDir, config, urls };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build({ localDev: process.argv.includes('--local') }).catch((err) => { console.error(`build failed: ${err.message}`); process.exit(1); });
}
