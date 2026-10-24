import { h, setMeta } from './dom.js';
import { listBrands, getBrand, logoUrl, siteName, siteUrl, isConfigured } from './api.js';
import { matchRoute, groupContacts, whatsappLink, formatPhone, backupInfo, initials, filterBrands } from './lib.js';
import { icon, mark, CATEGORY_ICONS } from './icons.js';

const app = document.getElementById('app');
const REFRESH_MS = 60_000;
let lastSnapshot = null;
const ui = { query: '', cat: 'all', slug: null }; // search text / active category filter

// ------------------------------------------------------------------ shared bits
function logo(brand, size, eager = false) {
  const url = logoUrl(brand);
  const fallback = () => h('div', { class: `logo logo-${size} logo-fallback`, 'aria-hidden': 'true' }, initials(brand.name));
  if (!url) return fallback();
  const px = 64;  // CSS sets the real size (56px on phones); attributes just reserve space
  const img = h('img', {
    class: `logo logo-${size}`, src: url, alt: `${brand.name} logo`, width: px, height: px,
    loading: size === 'lg' || eager ? 'eager' : 'lazy', decoding: 'async',
  });
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

const sampleBanner = () =>
  isConfigured ? null : h('p', { class: 'notice', role: 'note' }, 'Preview mode: showing clearly labelled SAMPLE data because Supabase is not configured yet.');

/** Brief confirmation announced to screen readers and shown on a button. */
function flash(button, doneLabel, doneIcon) {
  const original = [...button.childNodes];
  button.replaceChildren(icon(doneIcon, 16), doneLabel);
  setTimeout(() => button.replaceChildren(...original), 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts or denied permission: a temporary selection + execCommand.
    const ta = h('textarea', { 'aria-hidden': 'true', readonly: true, tabindex: '-1', style: null }, text);
    ta.className = 'sr-only';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

// ------------------------------------------------------------------ home
function brandCards(brands) {
  if (brands.length === 0) {
    return h('p', { class: 'empty', role: 'status' },
      ui.query ? `No brands match “${ui.query}”.` : 'No brands are listed yet. Please check back soon.');
  }
  return h('ul', { class: 'cards', 'aria-label': 'Brands' },
    brands.map((b, i) =>
      h('li', { class: 'card' },
        logo(b, 'md', i < 8),
        h('div', { class: 'card-body' },
          h('h2', null, b.name),
          h('p', { class: 'muted' }, b.description || 'Contact numbers published by this brand.')),
        h('a', { class: 'btn btn-wa', href: `/brand/${b.slug}`, 'data-link': '', 'aria-label': `View WhatsApp Contacts for ${b.name}` },
          h('span', { class: 'btn-text' }, 'View WhatsApp Contacts'), icon('arrow-right', 16)))));
}

function renderHome(brands) {
  setMeta({
    title: `${siteName} - Find your brand's customer support contacts`,
    description: 'Choose your brand to find its official customer support WhatsApp numbers for support, deposits, withdrawals and general enquiries.',
    canonical: `${siteUrl}/`,
  });

  const count = h('span', { class: 'count', 'aria-live': 'polite' });
  const grid = h('div', { id: 'brand-grid' });
  const draw = () => {
    const shown = filterBrands(brands, ui.query);
    grid.replaceChildren(brandCards(shown));
    count.textContent = ui.query ? `${shown.length} of ${brands.length} brands` : `${brands.length} ${brands.length === 1 ? 'brand' : 'brands'}`;
  };

  const input = h('input', {
    id: 'brand-search', type: 'search', name: 'q', placeholder: 'Search brands…', autocomplete: 'off',
    value: ui.query, enterkeyhint: 'search',
  });
  input.addEventListener('input', () => { ui.query = input.value.trim(); draw(); });
  const form = h('form', {
    class: 'search', role: 'search', onsubmit: (e) => {
      e.preventDefault();
      ui.query = input.value.trim();
      draw();
      const top = document.getElementById('brands')?.getBoundingClientRect().top ?? 0;
      if (top > window.innerHeight * 0.6) document.getElementById('brands').scrollIntoView({ behavior: 'smooth' });
    },
  },
  h('label', { class: 'search-field', for: 'brand-search' }, h('span', { class: 'sr-only' }, 'Search brands'), icon('search', 20), input),
  h('button', { class: 'btn', type: 'submit' }, 'Search'));
  draw();

  app.replaceChildren(...[
    sampleBanner(),
    h('section', { class: 'hero' },
      h('div', { class: 'hero-copy' },
        h('p', { class: 'eyebrow' }, icon('sparkle', 14), 'WhatsApp contact directory'),
        h('h1', null, 'Your Trusted Hub for ', h('span', { class: 'accent' }, 'Official WhatsApp'), ' Contacts'),
        h('p', { class: 'lead' }, 'Find the latest WhatsApp, Telegram and email contacts published by each brand, all in one place.'),
        form,
        h('ul', { class: 'hero-points' },
          ['Managed by each brand', 'Always up to date', 'Easy to search'].map((t) => h('li', null, icon('check', 16), t)))),
      h('div', { class: 'hero-art', 'aria-hidden': 'true' },
        h('div', { class: 'glow' }),
        h('div', { class: 'plate' }, mark(104)),
        h('span', { class: 'chip a' }, icon('chat', 24)),
        h('span', { class: 'chip b' }, icon('sparkle', 24)),
        h('span', { class: 'chip c' }, icon('send', 24)))),
    h('section', { class: 'section', id: 'brands', 'aria-labelledby': 'brands-h' },
      h('div', { class: 'section-head' },
        h('div', null, h('h2', { id: 'brands-h' }, 'Brands'), h('p', { class: 'muted' }, 'Choose your brand to see its WhatsApp contact numbers.')),
        count),
      grid),
    h('section', { class: 'section about', id: 'about', 'aria-labelledby': 'about-h' },
      h('h2', { id: 'about-h' }, 'About this directory'),
      h('p', null, 'This website is an independent directory. Each brand manages and publishes its own contact details, and we do not operate, verify or guarantee any brand’s services.'),
      h('ul', { class: 'features' },
        [
          ['phone', 'Direct contacts', 'WhatsApp numbers open a chat in one tap.', ''],
          ['sparkle', 'Always current', 'Numbers are read live, so updates appear right away.', 'gold'],
          ['search', 'Quick to find', 'Search by brand name and jump straight to its contacts.', ''],
        ].map(([ic, title, text, cls]) =>
          h('li', null, h('span', { class: `tile ${cls}` }, icon(ic, 22)), h('div', null, h('strong', null, title), h('span', null, text)))))),
  ].filter(Boolean));
}

// ------------------------------------------------------------------ brand page
function renderBrand(brand) {
  if (ui.slug !== brand.slug) { ui.slug = brand.slug; ui.cat = 'all'; }
  const groups = groupContacts(brand.contacts || []);
  const backup = backupInfo(brand.backup_type, brand.backup_value);
  setMeta({
    title: `${brand.name} - Customer support contacts | ${siteName}`,
    description: (brand.description || `Customer support WhatsApp contacts for ${brand.name}.`).slice(0, 160),
    canonical: `${siteUrl}/brand/${brand.slug}`,
    image: logoUrl(brand) || undefined,
  });

  // One entry per contact (and the optional backup channel), tagged with its filter category.
  const entries = groups.flatMap((g) => g.contacts.map((c) => {
    const name = c.label || g.label;
    return {
      cat: g.value,
      node: h('li', { class: 'contact-card', dataset: { cat: g.value } },
        h('span', { class: 'tile' }, icon(CATEGORY_ICONS[g.value], 22)),
        h('div', { class: 'contact-text' }, h('strong', null, g.label), h('span', { class: c.label ? 'sub' : 'sub hint' }, c.label || g.hint)),
        h('div', { class: 'value' }, icon('chat', 18), formatPhone(c.phone)),
        h('a', {
          class: 'btn btn-wa', href: whatsappLink(c.phone), target: '_blank', rel: 'noopener noreferrer',
          'aria-label': `Chat on WhatsApp with ${name} (${brand.name}), opens in a new tab`,
        }, 'Chat on WhatsApp', icon('arrow-right', 16))),
    };
  }));
  if (backup) {
    const isMail = backup.label === 'Email';
    const copyBtn = isMail && h('button', {
      class: 'btn btn-secondary', type: 'button', 'aria-label': `Copy email address for ${brand.name}`,
      onclick: async (e) => { const btn = e.currentTarget; const ok = await copyText(backup.text); flash(btn, ok ? 'Copied' : 'Copy failed', ok ? 'check' : 'alert'); },
    }, icon('copy', 16), 'Copy Email');
    entries.push({
      cat: 'backup',
      node: h('li', { class: 'contact-card', dataset: { cat: 'backup' } },
        h('span', { class: 'tile gold' }, icon(isMail ? 'mail' : 'send', 22)),
        h('div', { class: 'contact-text' }, h('strong', null, isMail ? 'Email Support' : 'Telegram Support'), h('span', { class: 'sub hint' }, 'Backup contact channel')),
        h('div', { class: 'value' }, h('a', { href: backup.href, rel: 'noopener noreferrer', target: isMail ? null : '_blank' }, backup.text)),
        h('div', { class: 'btn-group' },
          h('a', {
            class: 'btn btn-outline', href: backup.href, rel: 'noopener noreferrer', target: isMail ? null : '_blank',
            'aria-label': `${isMail ? 'Send email to' : 'Open Telegram for'} ${brand.name}`,
          }, isMail ? 'Send email' : 'Open Telegram'),
          copyBtn)),
    });
  }

  const filters = [{ value: 'all', label: 'All Contacts', n: entries.length }]
    .concat(groups.map((g) => ({ value: g.value, label: g.label, n: g.contacts.length })))
    .concat(backup ? [{ value: 'backup', label: backup.label === 'Email' ? 'Email' : 'Telegram', n: 1 }] : []);
  if (!filters.some((f) => f.value === ui.cat)) ui.cat = 'all';

  const heading = h('h2', { id: 'contacts-h' });
  const list = h('ul', { class: 'contact-cards', 'aria-labelledby': 'contacts-h' }, entries.map((e) => e.node));
  const empty = h('p', { class: 'empty', hidden: true }, 'No contacts in this category.');
  const status = h('span', { class: 'status-live', role: 'status' });
  const buttons = filters.map((f) => h('button', {
    class: 'cat', type: 'button', 'aria-pressed': 'false', dataset: { cat: f.value },
    onclick: () => { ui.cat = f.value; apply(); },
  }, h('span', null, f.label), h('span', { class: 'n' }, f.n)));
  function apply() {
    let visible = 0;
    for (const e of entries) {
      const show = ui.cat === 'all' || ui.cat === e.cat;
      e.node.hidden = !show;
      if (show) visible += 1;
    }
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.cat === ui.cat));
    const active = filters.find((f) => f.value === ui.cat);
    heading.textContent = active.label;
    empty.hidden = visible > 0;
    status.textContent = `${visible} contact${visible === 1 ? '' : 's'} shown`;
  }

  const share = h('button', {
    class: 'btn btn-secondary btn-sm', type: 'button',
    onclick: async (e) => {
      const url = `${siteUrl}/brand/${brand.slug}`;
      const btn = e.currentTarget;
      if (navigator.share) { try { await navigator.share({ title: brand.name, url }); } catch { /* user cancelled */ } return; }
      const ok = await copyText(url);
      flash(btn, ok ? 'Link copied' : 'Copy failed', ok ? 'check' : 'alert');
    },
  }, icon('share', 16), 'Share');

  app.replaceChildren(...[
    sampleBanner(),
    h('div', { class: 'crumb-row' },
      h('nav', { class: 'breadcrumb', 'aria-label': 'Breadcrumb' },
        h('ol', null,
          h('li', null, h('a', { href: '/', 'data-link': '' }, 'Home')), h('li', { 'aria-hidden': 'true' }, icon('chevron', 14)),
          h('li', null, h('a', { href: '/#brands', 'data-link': '' }, 'Brands')), h('li', { 'aria-hidden': 'true' }, icon('chevron', 14)),
          h('li', { 'aria-current': 'page' }, brand.name))),
      share),
    h('header', { class: 'brand-hero' },
      logo(brand, 'lg'),
      h('div', null,
        h('p', { class: 'tag' }, 'WhatsApp contacts'),
        h('h1', null, brand.name),
        brand.description && h('p', { class: 'muted' }, brand.description))),
    entries.length === 0
      ? h('p', { class: 'empty', style: null }, 'No contact numbers are available for this brand right now.')
      : h('div', { class: 'layout' },
          entries.length > 1 && h('nav', { class: 'cats', 'aria-label': 'Contact categories' }, buttons),
          h('section', { 'aria-labelledby': 'contacts-h' },
            h('div', { class: 'main-head' },
              h('div', null, heading, h('p', { class: 'muted' }, `Contact details published for ${brand.name}.`))),
            list, empty, status,
            h('aside', { class: 'note' },
              h('span', { class: 'tile gold' }, icon('alert', 20)),
              h('div', null,
                h('h2', null, 'Note'),
                h('p', null, `These are the contact details published for ${brand.name}. We do not operate, verify or guarantee any brand’s services. Never share passwords or one-time codes over chat.`))))),
  ].filter(Boolean));
  if (entries.length) apply();
}

// ------------------------------------------------------------------ states
function renderNotFound() {
  setMeta({ title: `Page not found | ${siteName}`, description: 'This page does not exist.', robots: 'noindex' });
  app.replaceChildren(
    h('section', { class: 'intro' },
      h('h1', null, 'Brand not found'),
      h('p', null, 'This brand does not exist or is not currently listed.'),
      h('a', { class: 'btn', href: '/', 'data-link': '' }, 'See all brands')));
}

function renderError(message) {
  setMeta({ title: `Something went wrong | ${siteName}`, description: 'Contacts could not be loaded.', robots: 'noindex' });
  app.replaceChildren(
    h('section', { class: 'intro', role: 'alert' },
      h('h1', null, 'We couldn’t load the contacts'),
      h('p', null, message),
      h('button', { class: 'btn', type: 'button', onclick: () => load({ force: true }) }, 'Try again')));
}

// ------------------------------------------------------------------ routing + refresh
function markNav() {
  const route = matchRoute(location.pathname);
  document.querySelectorAll('#site-nav a').forEach((a) => {
    const here = a.getAttribute('href') === '/' && route.name === 'home' && !location.hash;
    if (here) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

function scrollToHash() {
  if (!location.hash) return;
  document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
}

/** Fetch the current route's data; re-render only when it changed (or when forced). */
async function load({ force = false, silent = false } = {}) {
  const route = matchRoute(location.pathname);
  markNav();
  if (route.name === 'notfound') {
    lastSnapshot = null;
    return renderNotFound();
  }
  if (!silent) app.setAttribute('aria-busy', 'true');
  if (!silent && !app.firstElementChild) {
    app.replaceChildren(h('p', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Loading…'));
  }
  try {
    const data = route.name === 'home' ? await listBrands() : await getBrand(route.slug);
    const snapshot = `${location.pathname}|${JSON.stringify(data)}`;
    if (!force && snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;
    const hadSearchFocus = document.activeElement?.id === 'brand-search';
    if (route.name === 'home') renderHome(data);
    else if (data) renderBrand(data);
    else renderNotFound();
    if (hadSearchFocus) document.getElementById('brand-search')?.focus();
  } catch (err) {
    // A failed background refresh must not wipe a page that is already showing.
    if (!silent) renderError('Please check your connection and try again.');
  } finally {
    app.removeAttribute('aria-busy');
  }
}

function navigate(url) {
  history.pushState({}, '', url);
  lastSnapshot = null;
  window.scrollTo(0, 0);
  closeMenu();
  load().then(() => {
    if (location.hash) scrollToHash();
    else document.getElementById('app').focus({ preventScroll: true });
  });
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', () => { lastSnapshot = null; load().then(scrollToHash); });

// mobile menu
const menuBtn = document.getElementById('menu-btn');
const siteNav = document.getElementById('site-nav');
function closeMenu() { siteNav.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); }
menuBtn.addEventListener('click', () => {
  const open = !siteNav.classList.contains('open');
  siteNav.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

// Keep pages fresh: on tab focus, bfcache restore, admin saves in another tab, and a slow poll.
const refresh = () => load({ silent: true });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) refresh(); });
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS);
if ('BroadcastChannel' in window) new BroadcastChannel('hub-content').onmessage = refresh;

load().then(scrollToHash);
