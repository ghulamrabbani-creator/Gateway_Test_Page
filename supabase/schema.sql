-- Already applied to Supabase project geidea-test-shop (yyjuhrtglygwuwcmdjck). Kept here for reference / rebuilds.
-- RLS is on with no policies on purpose: only the server (service-role key) can read or write.
create table app_config (id int primary key default 1 check (id = 1), data jsonb not null default '{}'::jsonb, updated_at timestamptz default now());
insert into app_config (id) values (1);
create table credentials (env text primary key check (env in ('test','staging','production')), public_key text, api_password_enc text, updated_at timestamptz default now());
create table orders (id uuid primary key default gen_random_uuid(), ref text unique not null, env text not null, route text not null default 'geidea', operation text not null, amount numeric(12,2) not null, currency text not null, status text not null default 'Created', detailed_status text, geidea_order_id text, session_id text, customer jsonb, options jsonb, token_id text, agreement_id text, agreement_type text, captured numeric(12,2) default 0, refunded numeric(12,2) default 0, last_order jsonb, created_by text, created_at timestamptz default now(), updated_at timestamptz default now());
create index orders_created_idx on orders (created_at desc);
create index orders_gid_idx on orders (geidea_order_id);
create table api_logs (id bigserial primary key, order_ref text, action text not null, env text, method text, url text, req_headers jsonb, req_body jsonb, status int, res_body jsonb, duration_ms int, error text, created_by text, created_at timestamptz default now());
create index api_logs_ref_idx on api_logs (order_ref, created_at);
create table callbacks (id bigserial primary key, order_ref text, geidea_order_id text, status text, amount numeric(12,2), currency text, payload jsonb, dedupe_key text unique, duplicate_count int default 0, received_at timestamptz default now(), last_seen_at timestamptz default now());
create index callbacks_received_idx on callbacks (received_at desc);
create table tokens (id bigserial primary key, env text not null, token_id text, agreement_id text, agreement_type text, usage text not null, card jsonb, status text not null default 'PENDING', source text not null, order_ref text, created_by text, created_at timestamptz default now());
alter table app_config enable row level security; alter table credentials enable row level security; alter table orders enable row level security;
alter table api_logs enable row level security; alter table callbacks enable row level security; alter table tokens enable row level security;
