import { h, setMeta } from './dom.js';
import { listBrands, getBrand, logoUrl, siteName, siteUrl, isConfigured } from './api.js';
import { matchRoute, groupContacts, whatsappLink, formatPhone, backupInfo, initials } from './lib.js';
import { icon, mark, CATEGORY_ICONS } from './icons.js';

const app = document.getElementById('app');
const REFRESH_MS = 60_000;
let lastSnapshot = null;

function logo(brand, size) {
  const url = logoUrl(brand);
  const fallback = () => h('div', { class: `logo logo-${size} logo-fallback`, 'aria-hidden': 'true' }, initials(brand.name));
  if (!url) return fallback();
  const img = h('img', {
    class: `logo logo-${size}`, src: url, alt: `${brand.name} logo`,
    width: size === 'lg' ? 72 : 64, height: size === 'lg' ? 72 : 64, loading: size === 'lg' ? 'eager' : 'lazy', decoding: 'async',
  });
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

const sampleBanner = () =>
  isConfigured ? null : h('p', { class: 'notice', role: 'note' }, 'Preview mode: showing clearly labelled SAMPLE data because Supabase is not configured yet.');

function heroArt() {
  return h('div', { class: 'hero-art', 'aria-hidden': 'true' },
    h('span', { class: 'bubble' }, icon('chat', 18)),
    mark(150),
    h('span', { class: 'badge' }, icon('shield', 24)));
}

function renderHome(brands) {
  setMeta({
    title: `${siteName} - Find your brand's customer support contacts`,
    description: 'Choose your brand to find its official customer support WhatsApp numbers for support, deposits, withdrawals and general enquiries.',
    canonical: `${siteUrl}/`,
  });
  const content = [
    sampleBanner(),
    h('section', { class: 'hero' },
      h('div', null,
        h('h1', null, 'Find Official ', h('span', { class: 'accent' }, 'WhatsApp'), ' Contacts for Our Brands'),
        h('p', null, 'Choose your brand below to get the latest and official WhatsApp contact numbers.')),
      heroArt()),
  ];
  if (brands.length === 0) {
    content.push(h('p', { class: 'empty' }, 'No brands are listed yet. Please check back soon.'));
  } else {
    content.push(
      h('ul', { class: 'cards', 'aria-label': 'Brands' },
        brands.map((b) =>
          h('li', { class: 'card' },
            logo(b, 'md'),
            h('div', { class: 'card-body' },
              h('h2', null, b.name),
              h('p', { class: 'muted' }, b.description || 'Official contact numbers'),
              h('a', { class: 'btn btn-block', href: `/brand/${b.slug}`, 'data-link': '', 'aria-label': `View WhatsApp Contacts for ${b.name}` },
                'View WhatsApp Contacts', icon('arrow-right', 16)))))),
    );
  }
  content.push(
    h('aside', { class: 'banner' },
      icon('shield', 40),
      h('div', null,
        h('h2', null, 'Official Contacts'),
        h('p', null, 'This website lists the latest WhatsApp contact numbers published for each brand. Please always use the numbers listed here.'))));
  app.replaceChildren(...content.filter(Boolean));
}

function contactRow({ iconName, title, sub, button }) {
  return h('li', { class: 'contact' },
    h('span', { class: 'tile' }, icon(iconName, 22)),
    h('div', { class: 'contact-text' }, h('strong', null, title), h('span', { class: 'sub' }, sub)),
    button);
}

function renderBrand(brand) {
  const groups = groupContacts(brand.contacts || []);
  setMeta({
    title: `${brand.name} - Customer support contacts | ${siteName}`,
    description: (brand.description || `Customer support WhatsApp contacts for ${brand.name}.`).slice(0, 160),
    canonical: `${siteUrl}/brand/${brand.slug}`,
    image: logoUrl(brand) || undefined,
  });
  const backup = backupInfo(brand.backup_type, brand.backup_value);
  const rows = groups.flatMap((g) => g.contacts.map((c) => {
    const name = c.label || g.label;
    return contactRow({
      iconName: CATEGORY_ICONS[g.value],
      title: g.label,
      sub: [c.label, formatPhone(c.phone)].filter(Boolean).join(' · '),
      button: h('a', {
        class: 'btn btn-wa', href: whatsappLink(c.phone), target: '_blank', rel: 'noopener noreferrer',
        'aria-label': `Chat on WhatsApp with ${name} (${brand.name}), opens in a new tab`,
      }, icon('chat', 18), 'Chat on WhatsApp'),
    });
  }));
  if (backup) {
    rows.push(contactRow({
      iconName: backup.label === 'Email' ? 'mail' : 'send',
      title: `Backup contact (${backup.label})`,
      sub: backup.text,
      button: h('a', {
        class: 'btn btn-secondary', href: backup.href, rel: 'noopener noreferrer', target: backup.label === 'Telegram' ? '_blank' : null,
        'aria-label': `${backup.label === 'Email' ? 'Send email to' : 'Open Telegram for'} ${brand.name}`,
      }, backup.label === 'Email' ? 'Send email' : 'Open Telegram'),
    }));
  }
  app.replaceChildren(...[
    sampleBanner(),
    h('div', { class: 'page-card' },
      h('a', { class: 'back', href: '/', 'data-link': '' }, icon('arrow-left', 18), 'Back to Home'),
      h('header', { class: 'brand-head' },
        logo(brand, 'lg'),
        h('div', null,
          h('h1', null, brand.name),
          h('p', { class: 'eyebrow' }, 'Official WhatsApp Contacts'),
          brand.description && h('p', { class: 'muted' }, brand.description))),
      rows.length === 0
        ? h('p', { class: 'empty' }, 'No contact numbers are available for this brand right now.')
        : h('div', null, h('h2', { class: 'sr-only' }, 'Contact numbers'), h('ul', { class: 'contacts' }, rows)),
      h('aside', { class: 'important' },
        h('span', { class: 'tile' }, icon('megaphone', 22)),
        h('div', null,
          h('h2', null, 'Important'),
          h('p', null, 'Always contact this brand through the numbers listed on this page, and never share passwords or one-time codes over chat.')))),
  ].filter(Boolean));
}

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

/** Fetch the current route's data; re-render only when it changed (or when forced). */
async function load({ force = false, silent = false } = {}) {
  const route = matchRoute(location.pathname);
  if (route.name === 'notfound') {
    lastSnapshot = null;
    return renderNotFound();
  }
  if (!silent) app.setAttribute('aria-busy', 'true');
  if (!silent && !app.firstElementChild) app.replaceChildren(h('p', { class: 'loading' }, 'Loading…'));
  try {
    const data = route.name === 'home' ? await listBrands() : await getBrand(route.slug);
    const snapshot = `${location.pathname}|${JSON.stringify(data)}`;
    if (!force && snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;
    if (route.name === 'home') renderHome(data);
    else if (data) renderBrand(data);
    else renderNotFound();
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
  load().then(() => document.getElementById('app').focus({ preventScroll: true }));
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', () => { lastSnapshot = null; load(); });

// Keep pages fresh: on tab focus, bfcache restore, admin saves in another tab, and a slow poll.
const refresh = () => load({ silent: true });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) refresh(); });
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS);
if ('BroadcastChannel' in window) new BroadcastChannel('hub-content').onmessage = refresh;

load();
