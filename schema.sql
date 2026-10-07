-- Run this whole file once in Supabase -> SQL Editor

create table if not exists users (
  id bigint primary key,
  name text, username text,
  balance numeric default 0, spent numeric default 0, orders_count int default 0,
  banned boolean default false,
  referred_by bigint, ref_earned numeric default 0,
  created_at timestamptz default now()
);

create table if not exists admins (id bigint primary key);

create table if not exists providers (
  id serial primary key, name text, api_url text, api_key text
);

create table if not exists categories (
  id serial primary key, platform text not null, name text not null,
  active boolean default true
);

create table if not exists services (
  id serial primary key,
  category_id int references categories(id) on delete cascade,
  name text not null, description text default '',
  rate numeric not null,            -- price per 1000
  min int default 10, max int default 10000,
  provider_id int references providers(id) on delete set null,
  provider_service text,            -- service id on provider panel (null = manual order)
  active boolean default true
);

create table if not exists orders (
  id serial primary key,
  user_id bigint, service_id int, service_name text,
  link text, quantity int, charge numeric,
  status text default 'pending',    -- pending / processing / completed / canceled / failed
  provider_id int, provider_order text,
  created_at timestamptz default now()
);

create table if not exists payment_methods (
  id serial primary key, name text, details text, active boolean default true
);

create table if not exists deposits (
  id serial primary key, user_id bigint, method text,
  amount numeric, trx_id text, status text default 'pending',
  created_at timestamptz default now()
);

create table if not exists settings (key text primary key, value text);

create table if not exists sessions (
  uid bigint primary key, state text, data jsonb default '{}'
);

create table if not exists broadcasts (
  id serial primary key, text text, last_id bigint default 0,
  sent int default 0, status text default 'running',
  created_at timestamptz default now()
);

-- Atomic balance helpers
create or replace function spend(uid bigint, amt numeric) returns boolean
language plpgsql as $$
begin
  update users set balance = balance - amt, spent = spent + amt, orders_count = orders_count + 1
  where id = uid and balance >= amt;
  return found;
end $$;

create or replace function refund(uid bigint, amt numeric) returns void
language sql as $$
  update users set balance = balance + amt, spent = greatest(spent - amt, 0),
  orders_count = greatest(orders_count - 1, 0) where id = uid;
$$;

create or replace function add_balance(uid bigint, amt numeric) returns numeric
language sql as $$
  update users set balance = balance + amt where id = uid returning balance;
$$;

-- Lock tables from public access (the bot uses the service_role key, which bypasses RLS)
alter table users enable row level security;
alter table admins enable row level security;
alter table providers enable row level security;
alter table categories enable row level security;
alter table services enable row level security;
alter table orders enable row level security;
alter table payment_methods enable row level security;
alter table deposits enable row level security;
alter table settings enable row level security;
alter table sessions enable row level security;
alter table broadcasts enable row level security;

-- Seed categories (you can edit all of this later from the Admin Panel)
insert into categories (platform, name) values
 ('telegram','Members'), ('telegram','Post Views'),
 ('tiktok','Followers'), ('tiktok','Likes'), ('tiktok','Views'),
 ('facebook','Followers'), ('facebook','Likes'),
 ('instagram','Followers'), ('instagram','Likes'),
 ('youtube','Subscribers'), ('youtube','Views'),
 ('twitter','Followers'), ('twitter','Likes');
