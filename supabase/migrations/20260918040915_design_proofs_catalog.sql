-- DesignProAI owns the proof library. Brand/tool are presentation tags;
-- account ownership, never a client-supplied tenant tag, authorizes access.
create table public.design_proofs (
  id uuid primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  brand text not null check (brand in ('designpro', 'weprintwraps')),
  tool text not null check (tool in ('patternpro', 'wallpro')),
  storage_path text not null unique,
  metadata jsonb not null check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  search_text text generated always as (
    id::text || ' ' || coalesce(metadata->>'sourceId', '') || ' ' ||
    coalesce(metadata->>'designId', '') || ' ' || coalesce(metadata->>'generationId', '') || ' ' ||
    coalesce(metadata->>'projectId', '') || ' ' || coalesce(metadata->>'vehicle', '') || ' ' ||
    coalesce(metadata->>'design', '') || ' ' || coalesce(metadata->>'customerName', '') || ' ' ||
    coalesce(metadata->>'quoteNumber', '') || ' ' || coalesce(metadata->>'orderNumber', '')
  ) stored,
  constraint design_proofs_owner_path check (
    storage_path = 'proof-exports/' || owner_user_id::text || '/' || id::text || '/proof.pdf'
  ),
  constraint design_proofs_matching_tags check (
    metadata->>'brand' = brand and metadata->>'tool' = tool
  )
);

create index design_proofs_owner_created on public.design_proofs (owner_user_id, created_at desc, id desc);
create index design_proofs_owner_system on public.design_proofs (owner_user_id, brand, tool, created_at desc);
alter table public.design_proofs enable row level security;
revoke all on public.design_proofs from public, anon, authenticated;
grant select on public.design_proofs to authenticated;
grant select, insert on public.design_proofs to service_role;
create policy design_proofs_owner_read on public.design_proofs for select to authenticated
  using ((select auth.uid()) = owner_user_id);
comment on table public.design_proofs is 'Private, immutable approval PDF exports from DesignProAI apps; WPW is a brand/tenant tag, not an access grant.';
