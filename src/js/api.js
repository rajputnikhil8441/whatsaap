// Read-only public data access. Plain fetch against Supabase's REST API with the
// public (publishable/anon) key only; Row Level Security limits what comes back
// to active brands and active contacts.
import { SAMPLE_BRANDS } from './sample-data.js';

const cfg = window.HUB_CONFIG || {};
export const siteName = cfg.siteName || 'Contact Hub';
export const siteUrl = (cfg.siteUrl || location.origin).replace(/\/+$/, '');
export const isConfigured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);

async function rest(query) {
  // no-store: always revalidate so admin edits show up on the next load.
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${query}`, {
    headers: { apikey: cfg.supabaseAnonKey, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Could not load data (HTTP ${res.status}).`);
  return res.json();
}

export async function listBrands() {
  if (!isConfigured) return SAMPLE_BRANDS.map(({ contacts, ...b }) => b);
  return rest(
    'brands?select=id,slug,name,description,logo_path,backup_type,backup_value,updated_at' +
      '&is_active=eq.true&order=sort_order.asc,name.asc',
  );
}

/** Returns the brand with its contacts, or null if it does not exist / is inactive. */
export async function getBrand(slug) {
  if (!isConfigured) return SAMPLE_BRANDS.find((b) => b.slug === slug) || null;
  const rows = await rest(
    `brands?slug=eq.${encodeURIComponent(slug)}&is_active=eq.true` +
      '&select=id,slug,name,description,logo_path,backup_type,backup_value,updated_at,' +
      'contacts(id,category,label,phone,sort_order)&contacts.order=sort_order.asc&limit=1',
  );
  return rows[0] || null;
}

/** Public URL of a brand logo; the version param busts caches when the brand changes. */
export function logoUrl(brand) {
  if (!brand.logo_path || !isConfigured) return null;
  return `${cfg.supabaseUrl}/storage/v1/object/public/brand-logos/${encodeURIComponent(brand.logo_path)}?v=${encodeURIComponent(brand.updated_at)}`;
}
