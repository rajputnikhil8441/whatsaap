-- Multi-Brand Customer Contact Hub: schema, Row Level Security, Storage policies.
-- Run once in the Supabase SQL editor (or via `supabase db push`).

-- ---------------------------------------------------------------------------
-- Administrators
-- ---------------------------------------------------------------------------
-- Membership in this table is what makes an Auth user an administrator.
-- There are deliberately NO insert/update/delete policies: rows can only be
-- added from the SQL editor / service role (see README "First administrator").
create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

drop policy if exists "Users can read their own admin row" on public.admin_users;
create policy "Users can read their own admin row"
  on public.admin_users for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Brands
-- ---------------------------------------------------------------------------
create table if not exists public.brands (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique
               check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 60),
  name         text not null check (char_length(name) between 1 and 80),
  description  text not null default '' check (char_length(description) <= 300),
  logo_path    text check (logo_path is null or char_length(logo_path) <= 200),
  backup_type  text not null default 'none' check (backup_type in ('none', 'email', 'telegram')),
  backup_value text check (backup_value is null or char_length(backup_value) <= 120),
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint brands_backup_consistent check (
    (backup_type = 'none' and backup_value is null)
    or (backup_type = 'email' and backup_value ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
    or (backup_type = 'telegram' and backup_value ~ '^[A-Za-z0-9_]{5,32}$')
  )
);

create index if not exists brands_active_sort_idx on public.brands (is_active, sort_order, name);

-- ---------------------------------------------------------------------------
-- Contacts (WhatsApp numbers)
-- ---------------------------------------------------------------------------
create table if not exists public.contacts (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references public.brands (id) on delete cascade,
  category   text not null
             check (category in ('customer_support', 'deposits', 'withdrawals', 'general')),
  label      text not null default '' check (char_length(label) <= 80),
  -- Digits only, including country code, no "+": exactly what wa.me expects.
  phone      text not null check (phone ~ '^[1-9][0-9]{7,14}$'),
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contacts_brand_idx on public.contacts (brand_id, sort_order);

-- Keep updated_at fresh (public pages use it to bust logo caches).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists brands_set_updated_at on public.brands;
create trigger brands_set_updated_at before update on public.brands
  for each row execute function public.set_updated_at();

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.brands   enable row level security;
alter table public.contacts enable row level security;

-- Least privilege at the privilege layer too: visitors can only SELECT.
revoke all on public.brands, public.contacts, public.admin_users from anon, authenticated;
grant select on public.brands, public.contacts to anon;
grant select, insert, update, delete on public.brands, public.contacts to authenticated;
grant select on public.admin_users to authenticated;

drop policy if exists "Public can read active brands" on public.brands;
create policy "Public can read active brands"
  on public.brands for select
  to anon, authenticated
  using (is_active);

drop policy if exists "Admins manage brands" on public.brands;
create policy "Admins manage brands"
  on public.brands for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Public can read active contacts of active brands" on public.contacts;
create policy "Public can read active contacts of active brands"
  on public.contacts for select
  to anon, authenticated
  using (
    is_active
    and exists (select 1 from public.brands b where b.id = contacts.brand_id and b.is_active)
  );

drop policy if exists "Admins manage contacts" on public.contacts;
create policy "Admins manage contacts"
  on public.contacts for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Reordering helpers (SECURITY INVOKER: RLS still applies, plus explicit check)
-- ---------------------------------------------------------------------------
create or replace function public.reorder_brands(p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.brands b
     set sort_order = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
   where b.id = o.id;
end;
$$;

create or replace function public.reorder_contacts(p_brand uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.contacts c
     set sort_order = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
   where c.id = o.id and c.brand_id = p_brand;
end;
$$;

revoke all on function public.reorder_brands(uuid[]) from public, anon;
revoke all on function public.reorder_contacts(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_brands(uuid[]) to authenticated;
grant execute on function public.reorder_contacts(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: public-read bucket for logos, admin-only writes
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-logos', 'brand-logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins can read logo objects" on storage.objects;
create policy "Admins can read logo objects"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'brand-logos' and (select public.is_admin()));

drop policy if exists "Admins can upload logos" on storage.objects;
create policy "Admins can upload logos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'brand-logos' and (select public.is_admin()));

drop policy if exists "Admins can update logos" on storage.objects;
create policy "Admins can update logos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'brand-logos' and (select public.is_admin()))
  with check (bucket_id = 'brand-logos' and (select public.is_admin()));

drop policy if exists "Admins can delete logos" on storage.objects;
create policy "Admins can delete logos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'brand-logos' and (select public.is_admin()));
