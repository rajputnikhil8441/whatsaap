// Pure helpers shared by the public site, the admin panel and the tests.
// No DOM or network access in this file.

export const CATEGORIES = [
  { value: 'customer_support', label: 'Customer Support', hint: 'Help with accounts and general questions' },
  { value: 'deposits', label: 'Deposits', hint: 'Questions about deposits' },
  { value: 'withdrawals', label: 'Withdrawals', hint: 'Questions about withdrawals' },
  { value: 'general', label: 'General Enquiries', hint: 'Other questions and enquiries' },
];

export const categoryLabel = (value) =>
  (CATEGORIES.find((c) => c.value === value) || { label: value }).label;

/**
 * Normalise a user-typed phone number to the digits-only international format
 * that wa.me links (and the database constraint) expect.
 * Accepts "+44 7700 900123", "(44) 7700-900123", "0044 7700 900123".
 * Rejects national-format numbers (leading 0) because the country code is unknown.
 */
export function normalizePhone(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, error: 'Enter a phone number.' };
  if (!/^[+\d\s().-]+$/.test(raw)) {
    return { ok: false, error: 'Use only digits, plus, spaces, dashes or brackets.' };
  }
  if (raw.indexOf('+') > 0 || (raw.match(/\+/g) || []).length > 1) {
    return { ok: false, error: 'A plus sign is only allowed at the start.' };
  }
  let digits = raw.replace(/\D/g, '');
  if (!raw.startsWith('+') && digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) {
    return { ok: false, error: 'Include the country code (for example +44…), not a local number starting with 0.' };
  }
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    return { ok: false, error: 'A full international number has 8 to 15 digits including the country code.' };
  }
  return { ok: true, value: digits };
}

export const whatsappLink = (digits) => `https://wa.me/${String(digits).replace(/\D/g, '')}`;

export const formatPhone = (digits) => `+${String(digits).replace(/\D/g, '')}`;

export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export function validateSlug(slug) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 2 || slug.length > 60) {
    return 'Use 2-60 lowercase letters, numbers and single hyphens (e.g. my-brand).';
  }
  return null;
}

/** Validate/normalise the optional backup channel. */
export function normalizeBackup(type, value) {
  if (!type || type === 'none') return { ok: true, type: 'none', value: null };
  const v = String(value ?? '').trim();
  if (type === 'email') {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || v.length > 120) {
      return { ok: false, error: 'Enter a valid email address.' };
    }
    return { ok: true, type, value: v };
  }
  if (type === 'telegram') {
    const handle = v.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '').replace(/^@/, '').replace(/\/+$/, '');
    if (!/^[A-Za-z0-9_]{5,32}$/.test(handle)) {
      return { ok: false, error: 'Enter a Telegram username (5-32 letters, numbers or underscores).' };
    }
    return { ok: true, type, value: handle };
  }
  return { ok: false, error: 'Unknown backup channel type.' };
}

export function backupInfo(type, value) {
  if (type === 'email' && value) {
    return { label: 'Email', text: value, href: `mailto:${value}` };
  }
  if (type === 'telegram' && value) {
    return { label: 'Telegram', text: `@${value}`, href: `https://t.me/${encodeURIComponent(value)}` };
  }
  return null;
}

/** Route a pathname to a view. Trailing slashes are ignored. */
export function matchRoute(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { name: 'home' };
  const m = path.match(/^\/brand\/([a-z0-9-]+)$/);
  if (m) return { name: 'brand', slug: m[1] };
  return { name: 'notfound' };
}

export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
}

/** Group contacts by category, keeping the configured category order. */
export function groupContacts(contacts) {
  return CATEGORIES.map((cat) => ({
    ...cat,
    contacts: contacts
      .filter((c) => c.category === cat.value)
      .sort((a, b) => a.sort_order - b.sort_order),
  })).filter((g) => g.contacts.length > 0);
}

/** Case-insensitive brand search: every word must appear in the name or description. */
export function filterBrands(brands, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return brands;
  return brands.filter((b) => {
    const haystack = `${b.name} ${b.description ?? ''}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}
