-- OPTIONAL sample data so the public site is not empty before real content exists.
-- Everything here is clearly fictional: the phone numbers use the reserved
-- 555-01xx fictional range and the brands have no logos.
-- Delete these brands from /admin (or `delete from public.brands where slug like 'sample-%';`)
-- as soon as real brands are added.

with b as (
  insert into public.brands (slug, name, description, backup_type, backup_value, sort_order)
  values
    ('sample-brand-one', 'Sample Brand One (demo)',
     'SAMPLE DATA - placeholder brand. Replace with a real brand in the admin panel.',
     'email', 'support@example.com', 1),
    ('sample-brand-two', 'Sample Brand Two (demo)',
     'SAMPLE DATA - placeholder brand. Replace with a real brand in the admin panel.',
     'telegram', 'sample_support_demo', 2)
  on conflict (slug) do nothing
  returning id, slug
)
insert into public.contacts (brand_id, category, label, phone, sort_order)
select b.id, c.category, c.label, c.phone, c.ord
from b
join (values
  ('sample-brand-one', 'customer_support', 'Sample agent',   '15550100101', 1),
  ('sample-brand-one', 'deposits',         'Sample deposits','15550100102', 2),
  ('sample-brand-one', 'withdrawals',      'Sample payouts', '15550100103', 3),
  ('sample-brand-two', 'customer_support', 'Sample agent',   '15550100201', 1),
  ('sample-brand-two', 'general',          'Sample general', '15550100202', 2)
) as c(slug, category, label, phone, ord) on c.slug = b.slug;
