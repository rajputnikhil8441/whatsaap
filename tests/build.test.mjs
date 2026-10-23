import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, assertPublicKey } from '../scripts/build.mjs';

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
    await build({ outDir, env: { SITE_URL: 'https://example.com/', SITE_NAME: 'Hub "A"' }, log: (m) => logs.push(m) });
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
