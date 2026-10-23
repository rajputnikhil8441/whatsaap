// Admin panel. All writes go through supabase-js with the signed-in admin's JWT;
// Row Level Security in the database is the real gate (this UI is only a client).
import { h } from './dom.js';
import {
  CATEGORIES, categoryLabel, normalizePhone, whatsappLink, formatPhone, slugify, validateSlug,
  normalizeBackup, groupContacts, initials,
} from './lib.js';
import { icon, mark } from './icons.js';

const cfg = window.HUB_CONFIG || {};
const root = document.getElementById('admin');
const nav = document.getElementById('sidenav');
const statusEl = document.getElementById('status');
const BUCKET = 'brand-logos';
const MAX_LOGO_BYTES = 1024 * 1024;
const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('hub-content') : null;

let sb = null;
let user = null;
let statusTimer;

// ---------------------------------------------------------------- helpers
function notify(kind, message) {
  clearTimeout(statusTimer);
  statusEl.className = `status ${kind}`;
  statusEl.textContent = message;
  statusEl.hidden = !message;
  if (kind === 'success') statusTimer = setTimeout(() => notify('', ''), 7000);
}

function friendly(err) {
  const msg = err?.message || 'Something went wrong.';
  if (err?.code === '23505') return 'That value is already in use (slugs must be unique).';
  if (err?.code === '42501' || /row-level security|not authorized/i.test(msg)) {
    return 'You are not authorized to make this change. Sign in again with an administrator account.';
  }
  if (/jwt expired/i.test(msg)) return 'Your session expired. Please sign in again.';
  if (err?.code === '23514') return 'The database rejected a value as invalid. Check the fields and try again.';
  if (/failed to fetch|networkerror/i.test(msg)) return 'Network error. Check your connection and try again.';
  return msg;
}

/** Announce that other open pages should re-fetch (the public site listens). */
const broadcastChange = () => channel?.postMessage('changed');

/** Run an async action on a button: disable it, show progress, report the outcome. */
async function run(button, busyText, action) {
  const original = button ? [...button.childNodes] : [];
  const iconOnly = button?.classList.contains('icon-btn');
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (!iconOnly) button.textContent = busyText;
  }
  notify('info', `${busyText}…`);
  try {
    return await action();
  } catch (err) {
    notify('error', friendly(err));
    return undefined;
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (!iconOnly) button.replaceChildren(...original);
    }
  }
}

/** Square icon button with an accessible name (used for row actions). */
function iconBtn(name, label, onclick, { danger = false, disabled = false } = {}) {
  return h('button', {
    class: `icon-btn${danger ? ' danger' : ''}`, type: 'button', 'aria-label': label, title: label, disabled, onclick,
  }, icon(name, 18));
}

/** Status pill that toggles active/inactive. */
function statusPill(isActive, name, onclick) {
  return h('button', {
    class: `pill ${isActive ? 'on' : 'off'}`, type: 'button',
    'aria-label': `${isActive ? 'Active' : 'Inactive'}. Click to ${isActive ? 'deactivate' : 'activate'} ${name}`,
    title: `Click to ${isActive ? 'deactivate' : 'activate'}`, onclick,
  }, isActive ? 'Active' : 'Inactive');
}

function field(label, input, hint) {
  const err = h('p', { class: 'error', id: `${input.id}-err`, hidden: true });
  const describedBy = [hint && `${input.id}-hint`, `${input.id}-err`].filter(Boolean).join(' ');
  input.setAttribute('aria-describedby', describedBy);
  return h('div', { class: 'field' },
    h('label', { for: input.id }, label), input,
    hint && h('p', { class: 'hint', id: `${input.id}-hint` }, hint), err);
}

function showErrors(form, errors) {
  form.querySelectorAll('.error').forEach((e) => { e.hidden = true; e.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  let first = null;
  for (const [name, message] of Object.entries(errors)) {
    const input = form.elements[name];
    const err = input && form.querySelector(`#${input.id}-err`);
    if (!err) continue;
    err.textContent = message; err.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    first ||= input;
  }
  first?.focus();
  return Object.keys(errors).length === 0;
}

const logoPublicUrl = (path) => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

function thumb(brand) {
  if (!brand.logo_path) return h('div', { class: 'logo logo-fallback', 'aria-hidden': 'true' }, initials(brand.name));
  return h('img', { class: 'logo', src: `${logoPublicUrl(brand.logo_path)}`, alt: `${brand.name} logo`, width: 44, height: 44 });
}

async function removeLogoFile(path) {
  if (path) await sb.storage.from(BUCKET).remove([path]).catch(() => {}); // best effort
}

// ---------------------------------------------------------------- auth + shell
const loadingEl = (text) => h('p', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text);

function emptyState(iconName, title, text, action) {
  return h('div', { class: 'empty-state' }, icon(iconName, 32), h('strong', null, title), h('span', null, text), action);
}

/** Accessible modal confirmation (native <dialog>: focus trap, Esc to cancel). Resolves true on confirm. */
function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': 'dlg-title', 'aria-describedby': 'dlg-msg' },
      danger && h('div', { class: 'warn' }, icon('alert', 22)),
      h('h2', { id: 'dlg-title' }, title),
      h('p', { id: 'dlg-msg' }, message),
      h('form', { method: 'dialog' },
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn-secondary', value: 'cancel', autofocus: true }, 'Cancel'),
          h('button', { class: `btn${danger ? ' btn-danger' : ''}`, value: 'ok' }, confirmLabel))));
    if (typeof dlg.showModal !== 'function') { resolve(window.confirm(message)); return; }
    dlg.addEventListener('close', () => { const ok = dlg.returnValue === 'ok'; dlg.remove(); resolve(ok); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

const shell = document.getElementById('shell');
const sidebar = document.getElementById('sidebar');
const menuBtn = document.getElementById('menu-btn');
const siteLabel = shell.dataset.name || 'Contact Hub';

const brandBlock = () => [mark(36), h('span', { class: 'brand-text' }, h('strong', null, siteLabel), h('small', null, 'Admin Panel'))];

function setMenu(open) {
  sidebar.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
}

/** Sidebar, top bar and mobile menu; shown only while signed in. */
function renderNav(active = '') {
  shell.dataset.auth = user ? 'true' : 'false';
  setMenu(false);
  if (!user) { nav.replaceChildren(); document.getElementById('topuser').replaceChildren(); return; }
  document.getElementById('top-brand').replaceChildren(...brandBlock());
  document.getElementById('side-brand').replaceChildren(...brandBlock());
  menuBtn.replaceChildren(icon('menu', 22));
  document.getElementById('topuser').replaceChildren(h('span', { class: 'avatar' }, icon('user', 18)), h('span', null, user.email));
  const link = (href, key, label, ic) =>
    h('a', { class: 'side-link', href, 'aria-current': active === key ? 'page' : null }, icon(ic, 18), label);
  nav.replaceChildren(
    link('#/', 'dashboard', 'Dashboard', 'dashboard'),
    link('#/brands', 'brands', 'Brands', 'grid'),
    link('#/brand/new', 'new', 'Add Brand', 'plus'),
    h('a', { class: 'side-link', href: '/', target: '_blank', rel: 'noopener' }, icon('external', 18), 'Public site'),
    h('button', { class: 'side-link', type: 'button', onclick: signOut }, icon('logout', 18), 'Sign out'),
    h('p', { class: 'side-user' }, user.email));
}

menuBtn.addEventListener('click', () => setMenu(!sidebar.classList.contains('open')));

async function signOut() {
  await sb.auth.signOut();
  user = null;
  notify('', '');
  route();
}

function renderLogin(message) {
  renderNav();
  const email = h('input', { id: 'login-email', name: 'email', type: 'email', autocomplete: 'username', required: true });
  const password = h('input', { id: 'login-password', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Sign in');
  const form = h('form', {
    class: 'panel login', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      if (!showErrors(form, {
        ...(email.value.trim() ? {} : { email: 'Enter your email address.' }),
        ...(password.value ? {} : { password: 'Enter your password.' }),
      })) return;
      await run(submit, 'Signing in', async () => {
        const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
        if (error) throw new Error(/invalid login/i.test(error.message) ? 'Incorrect email or password.' : error.message);
        if (!(await isAdmin(data.user))) {
          await sb.auth.signOut();
          throw new Error('This account is not an authorized administrator.');
        }
        user = data.user;
        notify('', '');
        route();
      });
    },
  },
  h('div', { class: 'login-brand' }, mark(48)),
  h('h1', null, 'Administrator sign in'),
  message && h('p', { class: 'muted' }, message),
  field('Email', email), field('Password', password), submit);
  root.replaceChildren(form);
  email.focus();
}

async function isAdmin(u) {
  const { data, error } = await sb.from('admin_users').select('user_id').eq('user_id', u.id).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

function renderNotConfigured() {
  root.replaceChildren(h('section', { class: 'panel' },
    h('h1', null, 'Supabase is not configured'),
    h('p', null, 'Set SUPABASE_URL and SUPABASE_ANON_KEY (see .env.example and the README), then rebuild the site.')));
}

// ---------------------------------------------------------------- dashboard
async function renderDashboard() {
  renderNav('dashboard');
  root.replaceChildren(loadingEl('Loading dashboard\u2026'));
  const [b, c] = await Promise.all([
    sb.from('brands').select('id, name, slug, logo_path, is_active, updated_at, contacts(count)').order('updated_at', { ascending: false }),
    sb.from('contacts').select('id, is_active'),
  ]);
  if (b.error || c.error) {
    notify('error', friendly(b.error || c.error));
    root.replaceChildren(emptyState('alert', 'Could not load the dashboard', 'Check your connection and try again.'));
    return;
  }
  const brands = b.data;
  const contacts = c.data;
  const stats = [
    ['grid', 'Total Brands', brands.length, ''],
    ['check', 'Active Brands', brands.filter((x) => x.is_active).length, ''],
    ['phone', 'Total Contacts', contacts.length, 'gold'],
    ['check', 'Active Contacts', contacts.filter((x) => x.is_active).length, 'gold'],
  ];
  const recent = brands.slice(0, 5);
  root.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Dashboard'), h('p', { class: 'muted' }, 'A quick look at the brands and contacts you manage.')),
      h('a', { class: 'btn', href: '#/brand/new' }, icon('plus', 18), 'Add Brand')),
    h('ul', { class: 'stats', 'aria-label': 'Summary' }, stats.map(([ic, label, n, tone]) =>
      h('li', { class: 'stat' }, h('span', { class: `tile ${tone}` }, icon(ic, 22)), h('div', null, h('span', { class: 'num' }, n), h('span', { class: 'lbl' }, label))))),
    h('section', { class: 'panel', 'aria-labelledby': 'recent-h' },
      h('div', { class: 'panel-head' }, h('h2', { id: 'recent-h' }, 'Recent Brands'), h('a', { href: '#/brands', class: 'btn btn-secondary btn-sm' }, 'View all brands')),
      recent.length === 0
        ? emptyState('grid', 'No brands yet', 'Add your first brand to get started.')
        : h('ul', { class: 'table' },
            h('li', { class: 'table-head row-recent', 'aria-hidden': 'true' }, h('span', null, 'Logo'), h('span', null, 'Name'), h('span', null, 'Slug'), h('span', null, 'Status')),
            recent.map((x) => h('li', { class: 'row row-recent' },
              h('div', { class: 'cell-logo' }, thumb(x)),
              h('div', { class: 'cell-name' }, h('strong', null, x.name), h('span', { class: 'slug-sub' }, `/brand/${x.slug}`)),
              h('div', { class: 'cell-slug' }, `/brand/${x.slug}`),
              h('div', { class: 'cell-status' }, h('span', { class: `pill static ${x.is_active ? 'on' : 'off'}` }, x.is_active ? 'Active' : 'Inactive')))))),
  );
}

// ---------------------------------------------------------------- brands list
async function renderBrands() {
  renderNav('brands');
  root.replaceChildren(loadingEl('Loading brands…'));
  const { data: brands, error } = await sb.from('brands').select('*, contacts(count)')
    .order('sort_order').order('name');
  if (error) { notify('error', friendly(error)); root.replaceChildren(h('p', { class: 'empty' }, 'Could not load brands.')); return; }

  async function swap(i, delta) {
    const ids = brands.map((b) => b.id);
    [ids[i], ids[i + delta]] = [ids[i + delta], ids[i]];
    const { error: e } = await sb.rpc('reorder_brands', { p_ids: ids });
    if (e) return notify('error', friendly(e));
    notify('success', 'Brand order saved.');
    broadcastChange();
    renderBrands();
  }

  async function toggle(b, btn) {
    await run(btn, 'Saving', async () => {
      const { data, error: e } = await sb.from('brands').update({ is_active: !b.is_active }).eq('id', b.id).select('id');
      if (e) throw e;
      if (!data?.length) throw new Error('Nothing was updated. You may not have permission.');
      notify('success', `${b.name} is now ${b.is_active ? 'hidden from' : 'visible on'} the public site.`);
      broadcastChange();
      renderBrands();
    });
  }

  async function remove(b, btn) {
    const n = b.contacts?.[0]?.count ?? 0;
    if (!(await confirmDialog({ title: 'Delete brand?', message: `Delete "${b.name}" and its ${n} contact number(s)? This cannot be undone.`, confirmLabel: 'Delete brand' }))) return;
    await run(btn, 'Deleting', async () => {
      const { data, error: e } = await sb.from('brands').delete().eq('id', b.id).select('id');
      if (e) throw e;
      if (!data?.length) throw new Error('Nothing was deleted. You may not have permission.');
      await removeLogoFile(b.logo_path);
      notify('success', `"${b.name}" was deleted.`);
      broadcastChange();
      renderBrands();
    });
  }

  root.replaceChildren(h('section', { class: 'panel' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Brands'), h('p', { class: 'muted' }, 'Manage your brands and their contact information.')),
      h('a', { class: 'btn', href: '#/brand/new' }, icon('plus', 18), 'Add Brand')),
    brands.length === 0
      ? emptyState('grid', 'No brands yet', 'Add your first brand to publish its contact numbers.', h('a', { class: 'btn btn-sm', href: '#/brand/new' }, icon('plus', 16), 'Add Brand'))
      : h('ul', { class: 'table' },
          h('li', { class: 'table-head', 'aria-hidden': 'true' },
            h('span', null, 'Logo'), h('span', null, 'Brand Name'), h('span', null, 'Slug'), h('span', null, 'Status'), h('span', null, 'Actions')),
          brands.map((b, i) => h('li', { class: 'row row-brand' },
            h('div', { class: 'cell-logo' }, thumb(b)),
            h('div', { class: 'cell-name' },
              h('strong', null, b.name),
              h('span', { class: 'slug-sub' }, `/brand/${b.slug} · ${b.contacts?.[0]?.count ?? 0} contact(s)`)),
            h('div', { class: 'cell-slug' }, `/brand/${b.slug} · ${b.contacts?.[0]?.count ?? 0} contact(s)`),
            h('div', { class: 'cell-status' }, statusPill(b.is_active, b.name, (e) => toggle(b, e.currentTarget))),
            h('div', { class: 'cell-actions' },
              iconBtn('up', `Move ${b.name} up`, () => swap(i, -1), { disabled: i === 0 }),
              iconBtn('down', `Move ${b.name} down`, () => swap(i, 1), { disabled: i === brands.length - 1 }),
              h('a', { class: 'icon-btn', href: `#/brand/${b.id}`, 'aria-label': `Edit ${b.name}`, title: `Edit ${b.name}` }, icon('edit', 18)),
              iconBtn('trash', `Delete ${b.name}`, (e) => remove(b, e.currentTarget), { danger: true }))))),
  ));
}

// ---------------------------------------------------------------- brand editor
async function renderBrandEditor(id) {
  renderNav(id === 'new' ? 'new' : 'brands');
  let brand = { name: '', slug: '', description: '', logo_path: null, backup_type: 'none', backup_value: '', is_active: true };
  const isNew = id === 'new';
  if (!isNew) {
    root.replaceChildren(loadingEl('Loading brand…'));
    const { data, error } = await sb.from('brands').select('*').eq('id', id).maybeSingle();
    if (error || !data) {
      notify('error', error ? friendly(error) : 'That brand does not exist.');
      return renderBrands();
    }
    brand = data;
  }

  const name = h('input', { id: 'b-name', name: 'name', type: 'text', maxlength: 80, value: brand.name, required: true });
  const slug = h('input', { id: 'b-slug', name: 'slug', type: 'text', maxlength: 60, value: brand.slug, autocapitalize: 'none', spellcheck: 'false' });
  const desc = h('textarea', { id: 'b-desc', name: 'description', maxlength: 300 }, brand.description);
  const logoInput = h('input', { id: 'b-logo', name: 'logo', type: 'file', accept: Object.keys(LOGO_TYPES).join(',') });
  const removeLogo = h('input', { id: 'b-logo-remove', name: 'removeLogo', type: 'checkbox' });
  const backupType = h('select', { id: 'b-btype', name: 'backupType' },
    [['none', 'None'], ['email', 'Email'], ['telegram', 'Telegram']].map(([v, l]) => h('option', { value: v, selected: v === brand.backup_type }, l)));
  const backupValue = h('input', { id: 'b-bvalue', name: 'backupValue', type: 'text', maxlength: 120, value: brand.backup_value || '', autocapitalize: 'none' });
  const active = h('input', { id: 'b-active', name: 'active', type: 'checkbox', checked: brand.is_active });
  const submit = h('button', { class: 'btn', type: 'submit' }, isNew ? 'Create brand' : 'Save changes');

  const currentBox = h('div', { class: 'logo-current' });
  const fileName = h('span', { class: 'file-name' });
  const currentSrc = () => (brand.logo_path ? logoPublicUrl(brand.logo_path) : null);
  const drawPreview = (src, caption) => currentBox.replaceChildren(
    h('span', { class: 'label' }, caption),
    src ? h('img', { class: 'logo', src, alt: `${name.value || 'Brand'} logo preview` })
        : h('div', { class: 'logo logo-fallback', 'aria-hidden': 'true' }, initials(name.value)));
  drawPreview(currentSrc(), 'Current Logo');
  logoInput.className = 'sr-only';
  logoInput.setAttribute('aria-describedby', 'b-logo-hint b-logo-err');
  logoInput.addEventListener('change', () => {
    const f = logoInput.files[0];
    fileName.textContent = f ? f.name : '';
    drawPreview(f ? URL.createObjectURL(f) : currentSrc(), f ? 'New Logo (not saved yet)' : 'Current Logo');
  });
  const logoErr = h('p', { class: 'error', id: 'b-logo-err', hidden: true });
  const dropzone = h('label', { class: 'dropzone', for: 'b-logo' },
    logoInput, icon('upload', 26),
    h('span', null, h('strong', null, 'Change Logo'), ' – click to upload or drag and drop'),
    h('span', { class: 'hint', id: 'b-logo-hint' }, 'PNG, JPG or WebP (max 1 MB)'),
    fileName);
  ['dragenter', 'dragover'].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); }));
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) { logoInput.files = e.dataTransfer.files; logoInput.dispatchEvent(new Event('change')); }
  });

  let slugTouched = !isNew;
  slug.addEventListener('input', () => { slugTouched = true; });
  name.addEventListener('input', () => { if (!slugTouched) slug.value = slugify(name.value); });

  const form = h('form', {
    class: 'panel', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const errors = {};
      const nameV = name.value.trim();
      const slugV = slug.value.trim();
      if (!nameV) errors.name = 'Enter the brand name.';
      const slugErr = validateSlug(slugV);
      if (slugErr) errors.slug = slugErr;
      const backup = normalizeBackup(backupType.value, backupValue.value);
      if (!backup.ok) errors.backupValue = backup.error;
      const file = logoInput.files[0];
      if (file && !LOGO_TYPES[file.type]) errors.logo = 'Logo must be a PNG, JPEG or WebP image.';
      else if (file && file.size > MAX_LOGO_BYTES) errors.logo = 'Logo must be 1 MB or smaller.';
      if (!showErrors(form, errors)) return;
      if (!isNew && slugV !== brand.slug &&
          !(await confirmDialog({ title: 'Change public URL?', message: `Changing the slug changes the public URL from /brand/${brand.slug} to /brand/${slugV}. Old links will stop working.`, confirmLabel: 'Change URL', danger: false }))) return;

      await run(submit, 'Saving', async () => {
        let newLogo = null;
        try {
          if (file) {
            newLogo = `${crypto.randomUUID()}.${LOGO_TYPES[file.type]}`;
            const { error: upErr } = await sb.storage.from(BUCKET).upload(newLogo, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
            if (upErr) { newLogo = null; throw upErr; }
          }
          const logo_path = newLogo || (removeLogo.checked ? null : brand.logo_path);
          const payload = {
            name: nameV, slug: slugV, description: desc.value.trim(), logo_path,
            backup_type: backup.type, backup_value: backup.value, is_active: active.checked,
          };
          let saved;
          if (isNew) {
            const { data: last } = await sb.from('brands').select('sort_order').order('sort_order', { ascending: false }).limit(1);
            payload.sort_order = (last?.[0]?.sort_order ?? 0) + 1;
            const { data, error } = await sb.from('brands').insert(payload).select().single();
            if (error) throw error;
            saved = data;
          } else {
            const { data, error } = await sb.from('brands').update(payload).eq('id', brand.id).select();
            if (error) throw error;
            if (!data?.length) throw new Error('Nothing was updated. You may not have permission.');
            saved = data[0];
          }
          // Database confirmed: only now clean up and report success.
          if (brand.logo_path && brand.logo_path !== saved.logo_path) await removeLogoFile(brand.logo_path);
          broadcastChange();
          notify('success', `Saved "${saved.name}". The public site now shows the latest data.`);
          if (isNew) location.hash = `#/brand/${saved.id}`;
          else renderBrandEditor(saved.id);
        } catch (err) {
          if (newLogo) await removeLogoFile(newLogo);
          throw err;
        }
      });
    },
  },
  h('div', { class: 'page-head' },
    h('div', null,
      h('a', { class: 'back-link', href: '#/brands' }, icon('arrow-left', 16), 'All brands'),
      h('h1', null, isNew ? 'New brand' : `Edit ${brand.name}`)),
    !isNew && h('a', { class: 'btn btn-secondary btn-sm', href: `/brand/${brand.slug}`, target: '_blank', rel: 'noopener' }, 'View public page', icon('external', 16))),
  h('div', { class: 'row-fields' }, field('Brand name', name), field('URL slug', slug, 'Public address: /brand/your-slug')),
  field('Short description', desc, 'Up to 300 characters, shown on the homepage card.'),
  h('section', { class: 'field', 'aria-labelledby': 'logo-h' },
    h('h2', { id: 'logo-h', class: 'label' }, 'Brand Logo'),
    h('div', { class: 'logo-grid' }, currentBox,
      h('div', null, dropzone, logoErr,
        !isNew && brand.logo_path && h('label', { class: 'check', for: removeLogo.id }, removeLogo, 'Remove current logo')))),
  h('div', { class: 'row-fields' },
    field('Backup contact type (optional)', backupType),
    field('Backup contact', backupValue, 'Email address, or Telegram username such as @yourbrand.')),
  h('label', { class: 'check', for: active.id }, active, 'Active (visible on the public site)'),
  h('div', { class: 'actions' }, submit));

  const parts = [form];
  if (!isNew) {
    parts.push(contactsPanel(brand));
  } else {
    parts.push(h('p', { class: 'hint' }, 'Save the brand first, then add its WhatsApp contact numbers.'));
  }
  root.replaceChildren(...parts);
  name.focus();
}

// ---------------------------------------------------------------- contacts
function contactsPanel(brand) {
  const box = h('section', { class: 'panel', 'aria-labelledby': 'contacts-h' });
  let contacts = [];
  let editing = null;

  async function reload() {
    const { data, error } = await sb.from('contacts').select('*').eq('brand_id', brand.id).order('sort_order');
    if (error) { notify('error', friendly(error)); return; }
    contacts = data;
    draw();
  }

  const after = async (message) => {
    broadcastChange();
    notify('success', message);
    editing = null;
    await reload();
  };

  async function move(group, i, delta) {
    const groups = groupContacts(contacts);
    const g = groups.find((x) => x.value === group.value);
    [g.contacts[i], g.contacts[i + delta]] = [g.contacts[i + delta], g.contacts[i]];
    const ids = groups.flatMap((x) => x.contacts.map((c) => c.id));
    const { error } = await sb.rpc('reorder_contacts', { p_brand: brand.id, p_ids: ids });
    if (error) return notify('error', friendly(error));
    await after('Contact order saved.');
  }

  async function toggle(c, btn) {
    await run(btn, 'Saving', async () => {
      const { data, error } = await sb.from('contacts').update({ is_active: !c.is_active }).eq('id', c.id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Nothing was updated. You may not have permission.');
      await after(`Contact ${c.is_active ? 'hidden from' : 'shown on'} the public page.`);
    });
  }

  async function remove(c, btn) {
    if (!(await confirmDialog({ title: 'Delete contact?', message: `Delete ${formatPhone(c.phone)} (${c.label || categoryLabel(c.category)})? This cannot be undone.`, confirmLabel: 'Delete contact' }))) return;
    await run(btn, 'Deleting', async () => {
      const { data, error } = await sb.from('contacts').delete().eq('id', c.id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Nothing was deleted. You may not have permission.');
      await after('Contact deleted.');
    });
  }

  function form() {
    const c = editing || { category: 'customer_support', label: '', phone: '', is_active: true };
    const category = h('select', { id: 'c-cat', name: 'category' },
      CATEGORIES.map((x) => h('option', { value: x.value, selected: x.value === c.category }, x.label)));
    const label = h('input', { id: 'c-label', name: 'label', type: 'text', maxlength: 80, value: c.label });
    const phone = h('input', { id: 'c-phone', name: 'phone', type: 'tel', autocomplete: 'off', value: c.phone ? formatPhone(c.phone) : '' });
    const activeBox = h('input', { id: 'c-active', name: 'active', type: 'checkbox', checked: c.is_active });
    const linkHint = h('span', null, 'Include the country code, e.g. +44 7700 900123.');
    const submit = h('button', { class: 'btn', type: 'submit' }, editing ? 'Update contact' : 'Add contact');
    const updateHint = () => {
      if (!phone.value.trim()) { linkHint.textContent = 'Include the country code, e.g. +44 7700 900123.'; return; }
      const r = normalizePhone(phone.value);
      linkHint.textContent = r.ok ? `WhatsApp link: ${whatsappLink(r.value)}` : r.error;
    };
    phone.addEventListener('input', updateHint);
    updateHint();
    const f = h('form', {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        const errors = {};
        const p = normalizePhone(phone.value);
        if (!p.ok) errors.phone = p.error;
        if (label.value.trim().length > 80) errors.label = 'Keep the label under 80 characters.';
        if (!showErrors(f, errors)) return;
        await run(submit, 'Saving', async () => {
          const payload = { category: category.value, label: label.value.trim(), phone: p.value, is_active: activeBox.checked };
          if (editing) {
            const { data, error } = await sb.from('contacts').update(payload).eq('id', editing.id).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('Nothing was updated. You may not have permission.');
            await after('Contact updated.');
          } else {
            payload.brand_id = brand.id;
            payload.sort_order = contacts.reduce((m, x) => Math.max(m, x.sort_order), 0) + 1;
            const { data, error } = await sb.from('contacts').insert(payload).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('Nothing was saved. You may not have permission.');
            await after('Contact added.');
          }
        });
      },
    },
    h('h3', null, editing ? 'Edit contact' : 'Add contact'),
    h('div', { class: 'row-fields' }, field('Category', category), field('Label (optional)', label, 'e.g. "Agent 1" or "VIP desk".')),
    field('WhatsApp number', phone, linkHint),
    h('label', { class: 'check', for: activeBox.id }, activeBox, 'Active (visible on the public page)'),
    h('div', { class: 'actions' }, submit,
      editing && h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { editing = null; draw(); } }, 'Cancel')));
    return f;
  }

  function draw() {
    const groups = groupContacts(contacts);
    box.replaceChildren(...[
      h('div', { class: 'panel-head' }, h('h2', { id: 'contacts-h' }, 'WhatsApp contacts')),
      groups.length === 0 && emptyState('phone', 'No contacts yet', 'Add the first WhatsApp number for this brand below.'),
      groups.map((g) => [
        h('h3', { class: 'cat-title' }, g.label),
        h('ul', { class: 'table' }, g.contacts.map((c, i) => {
          const nm = c.label || g.label;
          const who = `${nm} ${formatPhone(c.phone)}`;
          return h('li', { class: 'row row-contact' },
            h('div', { class: 'cell-name' }, h('strong', null, formatPhone(c.phone)), h('span', { class: 'slug-sub' }, nm)),
            h('div', { class: 'cell-status' }, statusPill(c.is_active, who, (e) => toggle(c, e.currentTarget))),
            h('div', { class: 'cell-actions' },
              iconBtn('up', `Move ${who} up`, () => move(g, i, -1), { disabled: i === 0 }),
              iconBtn('down', `Move ${who} down`, () => move(g, i, 1), { disabled: i === g.contacts.length - 1 }),
              iconBtn('edit', `Edit ${who}`, () => { editing = c; draw(); document.getElementById('c-phone')?.focus(); }),
              iconBtn('trash', `Delete ${who}`, (e) => remove(c, e.currentTarget), { danger: true })));
        })),
      ]),
      form(),
    ].flat(Infinity).filter(Boolean));
  }

  box.replaceChildren(loadingEl('Loading contacts…'));
  reload();
  return box;
}

// ---------------------------------------------------------------- routing
async function route() {
  if (!user) return renderLogin();
  const hash = location.hash;
  const m = hash.match(/^#\/brand\/([\w-]+)$/);
  if (m) await renderBrandEditor(m[1]);
  else if (hash === '#/brands') await renderBrands();
  else await renderDashboard();
}

async function init() {
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return renderNotConfigured();
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && user) { user = null; notify('info', 'You have been signed out.'); route(); }
  });
  try {
    const { data } = await sb.auth.getSession();
    if (data.session && (await isAdmin(data.session.user))) user = data.session.user;
    else if (data.session) await sb.auth.signOut();
  } catch (err) {
    notify('error', friendly(err));
  }
  window.addEventListener('hashchange', route);
  route();
}

init();
