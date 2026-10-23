import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, assertPublicKey, resolveSiteUrl, PRODUCTION_URL } from '../scripts/build.mjs';

const jwt = (role) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`;

test('assertPublicKey rejects secret keys', () => {
  assert.throws(() => assertPublicKey(jwt('service_role')), /service_role/);
  assert.throws(() => assertPublicKey('sb_secret_abc'), /SECRET/);
  assert.doesNotThrow(() => assertPublicKey(jwt('anon')));
  assert.doesNotThrow(() => assertPublicKey('sb_publishable_abc'));
});

test('build writes config, robots, sitemap and fills placeholders', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'hub-'));
  try {
    const logs = [];
    await build({ outDir, env: { SITE_URL: 'https://example.com/', SITE_TITLE: 'Hub "A"' }, log: (m) => logs.push(m) });
    const config = readFileSync(join(outDir, 'js/config.js'), 'utf8');
    assert.match(config, /"siteUrl":"https:\/\/example.com"/);
    assert.doesNotMatch(config, /service_role/);
    const robots = readFileSync(join(outDir, 'robots.txt'), 'utf8');
    assert.match(robots, /Disallow: \/admin/);
    assert.match(robots, /Sitemap: https:\/\/example.com\/sitemap.xml/);
    assert.match(readFileSync(join(outDir, 'sitemap.xml'), 'utf8'), /<loc>https:\/\/example.com\/<\/loc>/);
    const index = readFileSync(join(outDir, 'index.html'), 'utf8');
    assert.match(index, /rel="canonical" href="https:\/\/example.com\/"/);
    assert.doesNotMatch(index, /%SITE_/);
    assert.match(readFileSync(join(outDir, 'admin/index.html'), 'utf8'), /noindex/);
    for (const f of ['_redirects', '_headers', 'vendor/supabase.js', 'css/styles.css']) assert.ok(existsSync(join(outDir, f)), f);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('build refuses a service-role key and a bad SITE_URL', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'hub-'));
  try {
    await assert.rejects(build({ outDir, env: { SUPABASE_URL: 'https://a.supabase.co', SUPABASE_ANON_KEY: jwt('service_role') }, log() {} }), /service_role/);
    await assert.rejects(build({ outDir, env: { SITE_URL: 'ftp://x' }, log() {} }), /SITE_URL/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('public pages expose no admin entry point and default branding is exact', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'hub-'));
  try {
    await build({ outDir, env: {}, log() {} });
    const index = readFileSync(join(outDir, 'index.html'), 'utf8');
    assert.match(index, /WhatsApp Contact Hub/);
    // Public HTML and the scripts it loads must never link to /admin or mention signing in.
    const publicFiles = [join(outDir, 'index.html'), ...['public.js', 'api.js', 'dom.js', 'icons.js', 'lib.js', 'sample-data.js'].map((f) => join(outDir, 'js', f))];
    for (const f of publicFiles) {
      const text = readFileSync(f, 'utf8');
      assert.doesNotMatch(text, /\/admin|admin login|sign in|log in/i, f);
      // icons.js legitimately defines a shared "dashboard" glyph; no other public file may mention one.
      if (!f.endsWith('icons.js')) assert.doesNotMatch(text, /dashboard/i, f);
    }
    // The admin shell stays reachable at /admin and is marked noindex.
    assert.ok(readdirSync(join(outDir, 'admin')).includes('index.html'));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('build ignores Netlify\'s reserved SITE_NAME (the project name) and keeps the exact branding', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'hub-'));
  try {
    await build({ outDir, env: { SITE_NAME: 'courageous-blancmange-c78896' }, log() {} });
    const index = readFileSync(join(outDir, 'index.html'), 'utf8');
    const admin = readFileSync(join(outDir, 'admin/index.html'), 'utf8');
    const config = readFileSync(join(outDir, 'js/config.js'), 'utf8');
    for (const text of [index, admin, config]) assert.doesNotMatch(text, /courageous-blancmange/);
    assert.match(index, /<span>WhatsApp Contact Hub<\/span>/);
    assert.match(index, /<title>WhatsApp Contact Hub - /);
    assert.match(config, /"siteName":"WhatsApp Contact Hub"/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('PRODUCTION_URL is the real production origin', () => {
  assert.equal(PRODUCTION_URL, 'https://whatsapp-link.com');
});

test('resolveSiteUrl falls back to production when SITE_URL is missing or blank', () => {
  for (const v of [undefined, null, '', '   ']) {
    assert.deepEqual(resolveSiteUrl(v), { url: PRODUCTION_URL, fallback: true }, JSON.stringify(v));
  }
});

test('resolveSiteUrl falls back to production when SITE_URL points at localhost', () => {
  for (const v of [
    'http://localhost:8080', 'http://localhost', 'https://localhost:3000/', 'http://LOCALHOST:8080',
    'http://127.0.0.1:8080', 'http://127.1.2.3', 'http://[::1]:8080', 'http://0.0.0.0:8080', 'http://app.localhost:5173',
  ]) {
    assert.deepEqual(resolveSiteUrl(v), { url: PRODUCTION_URL, fallback: true }, v);
  }
});

test('resolveSiteUrl honours a real SITE_URL and strips trailing slashes', () => {
  assert.deepEqual(resolveSiteUrl('https://example.com/'), { url: 'https://example.com', fallback: false });
  assert.deepEqual(resolveSiteUrl(' https://staging.example.com// '), { url: 'https://staging.example.com', fallback: false });
  assert.equal(resolveSiteUrl('https://whatsapp-link.com').fallback, false);
  // lookalikes are NOT local
  assert.equal(resolveSiteUrl('https://localhost.example.com').url, 'https://localhost.example.com');
  assert.equal(resolveSiteUrl('https://127.example.com').url, 'https://127.example.com');
});

test('resolveSiteUrl rejects malformed values', () => {
  for (const v of ['ftp://x', 'not a url', 'whatsapp-link.com', 'javascript:alert(1)']) {
    assert.throws(() => resolveSiteUrl(v), /SITE_URL/, v);
  }
});

test('resolveSiteUrl keeps localhost for local development (--local)', () => {
  assert.deepEqual(resolveSiteUrl(undefined, { localDev: true }), { url: 'http://localhost:8080', fallback: true });
  assert.deepEqual(resolveSiteUrl('http://localhost:3000/', { localDev: true }), { url: 'http://localhost:3000', fallback: false });
  assert.equal(resolveSiteUrl('https://example.com', { localDev: true }).url, 'https://example.com');
});

for (const [label, env] of [['SITE_URL missing', {}], ['SITE_URL blank', { SITE_URL: '' }], ['SITE_URL is localhost', { SITE_URL: 'http://localhost:8080' }]]) {
  test(`production build uses ${PRODUCTION_URL} in every SEO file when ${label}`, async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'hub-'));
    const logs = [];
    try {
      await build({ outDir, env, log: (m) => logs.push(m) });
      const index = readFileSync(join(outDir, 'index.html'), 'utf8');
      const config = readFileSync(join(outDir, 'js/config.js'), 'utf8');
      const robots = readFileSync(join(outDir, 'robots.txt'), 'utf8');
      const sitemap = readFileSync(join(outDir, 'sitemap.xml'), 'utf8');
      assert.match(index, /<link rel="canonical" href="https:\/\/whatsapp-link\.com\/">/);
      assert.match(index, /<meta property="og:url" content="https:\/\/whatsapp-link\.com\/">/);
      assert.match(config, /"siteUrl":"https:\/\/whatsapp-link\.com"/);
      assert.match(robots, /Sitemap: https:\/\/whatsapp-link\.com\/sitemap\.xml/);
      assert.match(sitemap, /<loc>https:\/\/whatsapp-link\.com\/<\/loc>/);
      for (const [name, text] of Object.entries({ index, config, robots, sitemap })) {
        assert.doesNotMatch(text, /localhost|127\.0\.0\.1/, `${name} must not mention localhost`);
      }
      assert.ok(logs.some((m) => /using https:\/\/whatsapp-link\.com/.test(m)), 'logs the fallback');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
}

test('a real SITE_URL is used as given in canonical, Open Graph, robots and sitemap', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'hub-'));
  try {
    await build({ outDir, env: { SITE_URL: 'https://staging.example.com/' }, log() {} });
    assert.match(readFileSync(join(outDir, 'index.html'), 'utf8'), /rel="canonical" href="https:\/\/staging\.example\.com\/"/);
    assert.match(readFileSync(join(outDir, 'robots.txt'), 'utf8'), /Sitemap: https:\/\/staging\.example\.com\/sitemap\.xml/);
    assert.match(readFileSync(join(outDir, 'sitemap.xml'), 'utf8'), /<loc>https:\/\/staging\.example\.com\/<\/loc>/);
    assert.doesNotMatch(readFileSync(join(outDir, 'index.html'), 'utf8'), /whatsapp-link\.com/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('local development build (--local) keeps localhost URLs', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'hub-'));
  try {
    await build({ outDir, env: {}, localDev: true, log() {} });
    assert.match(readFileSync(join(outDir, 'index.html'), 'utf8'), /rel="canonical" href="http:\/\/localhost:8080\/"/);
    assert.match(readFileSync(join(outDir, 'js/config.js'), 'utf8'), /"siteUrl":"http:\/\/localhost:8080"/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
