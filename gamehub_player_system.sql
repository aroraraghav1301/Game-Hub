-- Raghav's Game Hub: Player System
-- Run this entire file in Supabase Dashboard > SQL Editor.
-- Uses auth.users UUIDs as permanent account identity. Never expose service_role keys.
-- Safe to re-run: creates missing objects/records without duplicating player accounts.

-- Game analytics: store the display name alongside new play events.
alter table if exists public.game_hub_events add column if not exists name text;

create extension if not exists pgcrypto;

create table if not exists public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  player_id text not null unique default ('GH' || upper(substr(encode(gen_random_bytes(6),'hex'),1,10))),
  display_name text not null default 'Player',
  custom_player_id text unique,
  custom_id_changed_at timestamptz,
  level integer not null default 1 check (level >= 1),
  xp integer not null default 0 check (xp >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.player_profiles
  add column if not exists custom_id_changed_at timestamptz;

create table if not exists public.player_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  lifetime_earned bigint not null default 0 check (lifetime_earned >= 0)
);

create table if not exists public.player_coin_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.player_streaks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_claim_date date
);

create table if not exists public.player_friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  unique(sender_id,receiver_id),
  check(sender_id <> receiver_id)
);

create table if not exists public.player_friends (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,friend_id),
  check(user_id <> friend_id)
);

create table if not exists public.player_badges (
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_key text not null,
  badge_name text not null,
  emoji text not null,
  earned_at timestamptz not null default now(),
  primary key(user_id,badge_key)
);

create or replace function public.create_player_account()
returns trigger language plpgsql security definer set search_path=public
as $$
declare nm text;
begin
 nm := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),'Player');
 insert into public.player_profiles(user_id,display_name) values(new.id,left(nm,30)) on conflict do nothing;
 insert into public.player_wallets(user_id) values(new.id) on conflict do nothing;
 insert into public.player_streaks(user_id) values(new.id) on conflict do nothing;
 return new;
end $$;

drop trigger if exists on_auth_user_created_player on auth.users;
create trigger on_auth_user_created_player after insert on auth.users
for each row execute procedure public.create_player_account();

-- Backfill existing Auth users (for accounts created before this trigger existed).
insert into public.player_profiles(user_id, display_name)
select id, left(coalesce(nullif(trim(raw_user_meta_data->>'display_name'), ''), 'Player'), 30)
from auth.users
on conflict (user_id) do nothing;
insert into public.player_wallets(user_id)
select id from auth.users
on conflict (user_id) do nothing;
insert into public.player_streaks(user_id)
select id from auth.users
on conflict (user_id) do nothing;

alter table public.player_profiles enable row level security;
alter table public.player_wallets enable row level security;
alter table public.player_coin_transactions enable row level security;
alter table public.player_streaks enable row level security;
alter table public.player_friend_requests enable row level security;
alter table public.player_friends enable row level security;
alter table public.player_badges enable row level security;

drop policy if exists "read own profile" on public.player_profiles;
create policy "read own profile" on public.player_profiles for select to authenticated using(auth.uid()=user_id);
drop policy if exists "update own display profile" on public.player_profiles;
create policy "update own display profile" on public.player_profiles for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists "read own wallet" on public.player_wallets;
create policy "read own wallet" on public.player_wallets for select to authenticated using(auth.uid()=user_id);
drop policy if exists "read own transactions" on public.player_coin_transactions;
create policy "read own transactions" on public.player_coin_transactions for select to authenticated using(auth.uid()=user_id);
drop policy if exists "read own streak" on public.player_streaks;
create policy "read own streak" on public.player_streaks for select to authenticated using(auth.uid()=user_id);
drop policy if exists "read incoming requests" on public.player_friend_requests;
create policy "read incoming requests" on public.player_friend_requests for select to authenticated using(auth.uid()=receiver_id or auth.uid()=sender_id);
drop policy if exists "read own friends" on public.player_friends;
create policy "read own friends" on public.player_friends for select to authenticated using(auth.uid()=user_id);
drop policy if exists "read own badges" on public.player_badges;
create policy "read own badges" on public.player_badges for select to authenticated using(auth.uid()=user_id);

-- Public-safe views expose no email addresses.
create or replace view public.player_coin_leaderboard as
select p.display_name, coalesce(p.custom_player_id,p.player_id) as player_id,
       w.balance, p.level
from public.player_profiles p join public.player_wallets w using(user_id);
create or replace view public.player_streak_leaderboard as
select p.display_name, coalesce(p.custom_player_id,p.player_id) as player_id,
       s.current_streak
from public.player_profiles p join public.player_streaks s using(user_id);
create or replace view public.player_badges_public as
select user_id,badge_name,emoji from public.player_badges;
create or replace view public.player_friends_public as
select f.user_id,f.friend_id,p.display_name,coalesce(p.custom_player_id,p.player_id) as player_id
from public.player_friends f join public.player_profiles p on p.user_id=f.friend_id;

grant select on public.player_coin_leaderboard,public.player_streak_leaderboard to authenticated;
grant select on public.player_badges_public,public.player_friends_public to authenticated;

create or replace function public.claim_daily_reward()
returns jsonb language plpgsql security definer set search_path=public
as $$
declare uid uuid:=auth.uid(); st public.player_streaks%rowtype; reward integer:=10; today date:=current_date;
begin
 if uid is null then raise exception 'Please sign in first.'; end if;
 select * into st from public.player_streaks where user_id=uid for update;
 if st.last_claim_date=today then return jsonb_build_object('message','You have already claimed today’s reward.','claimed',false); end if;
 if st.last_claim_date=today-1 then st.current_streak:=st.current_streak+1; else st.current_streak:=1; end if;
 if st.current_streak % 7=0 then reward:=reward+100; end if;
 st.longest_streak:=greatest(st.longest_streak,st.current_streak);st.last_claim_date:=today;
 update public.player_streaks set current_streak=st.current_streak,longest_streak=st.longest_streak,last_claim_date=today where user_id=uid;
 update public.player_wallets set balance=balance+reward,lifetime_earned=lifetime_earned+reward where user_id=uid;
 insert into public.player_coin_transactions(user_id,amount,reason) values(uid,reward,case when reward>10 then 'Daily login + 7-day streak bonus' else 'Daily login reward' end);
 if st.current_streak>=7 then insert into public.player_badges(user_id,badge_key,badge_name,emoji) values(uid,'streak_7','Streak Starter','🔥') on conflict do nothing; end if;
 return jsonb_build_object('message',format('You earned %s coins!',reward),'claimed',true,'coins',reward,'streak',st.current_streak);
end $$;

create or replace function public.set_custom_player_id(requested_id text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare uid uuid:=auth.uid(); st public.player_streaks%rowtype; p public.player_profiles%rowtype; cost integer:=500;
begin
 if uid is null then raise exception 'Please sign in first.'; end if;
 if requested_id !~ '^[A-Za-z0-9_]{3,18}$' then raise exception 'Use 3–18 letters, numbers or underscores.'; end if;
 select * into p from public.player_profiles where user_id=uid for update;
 if lower(requested_id)=lower(p.player_id) then raise exception 'Choose a different ID.'; end if;
 select * into st from public.player_streaks where user_id=uid;
 if p.custom_player_id is null then
   if st.current_streak<5 then raise exception 'A 5-day login streak is required for your first custom ID.'; end if;
 else
   if p.custom_id_changed_at is not null and p.custom_id_changed_at > now()-interval '7 days' then raise exception 'You can change your custom ID once every 7 days.'; end if;
   update public.player_wallets set balance=balance-cost where user_id=uid and balance>=cost;
   if not found then raise exception 'You need 500 coins to change your ID.'; end if;
   insert into public.player_coin_transactions(user_id,amount,reason) values(uid,-cost,'Custom Player ID change');
 end if;
 update public.player_profiles set custom_player_id=requested_id,custom_id_changed_at=now(),updated_at=now() where user_id=uid;
 return jsonb_build_object('message','Custom Player ID saved.','player_id',requested_id);
exception when unique_violation then raise exception 'That Player ID is already taken.';
end $$;

create or replace function public.send_player_friend_request(target_player_id text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare uid uuid:=auth.uid(); target uuid;
begin
 if uid is null then raise exception 'Please sign in first.'; end if;
 select user_id into target from public.player_profiles
 where lower(player_id)=lower(target_player_id) or lower(custom_player_id)=lower(target_player_id) limit 1;
 if target is null then raise exception 'Player ID not found.'; end if;
 if target=uid then raise exception 'You cannot add yourself.'; end if;
 insert into public.player_friend_requests(sender_id,receiver_id) values(uid,target)
 on conflict(sender_id,receiver_id) do update set status='pending',created_at=now();
 return jsonb_build_object('message','Friend request sent.');
end $$;

create or replace function public.respond_player_friend_request(request_id uuid,accept_request boolean)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare uid uuid:=auth.uid(); req public.player_friend_requests%rowtype;
begin
 select * into req from public.player_friend_requests where id=request_id and receiver_id=uid and status='pending' for update;
 if not found then raise exception 'Request not found.'; end if;
 update public.player_friend_requests set status=case when accept_request then 'accepted' else 'declined' end where id=request_id;
 if accept_request then
  insert into public.player_friends(user_id,friend_id) values(req.sender_id,req.receiver_id),(req.receiver_id,req.sender_id) on conflict do nothing;
 end if;
 return jsonb_build_object('message',case when accept_request then 'Friend added.' else 'Request declined.' end);
end $$;

revoke all on function public.claim_daily_reward() from public;
revoke all on function public.set_custom_player_id(text) from public;
revoke all on function public.send_player_friend_request(text) from public;
revoke all on function public.respond_player_friend_request(uuid,boolean) from public;
grant execute on function public.claim_daily_reward() to authenticated;
grant execute on function public.set_custom_player_id(text) to authenticated;
grant execute on function public.send_player_friend_request(text) to authenticated;
grant execute on function public.respond_player_friend_request(uuid,boolean) to authenticated;

-- Prevent clients from directly changing balances, streaks, transactions, friendship edges or badges.
revoke insert,update,delete on public.player_wallets from anon,authenticated;
revoke insert,update,delete on public.player_coin_transactions from anon,authenticated;
revoke insert,update,delete on public.player_streaks from anon,authenticated;
revoke insert,update,delete on public.player_friend_requests from anon,authenticated;
revoke insert,update,delete on public.player_friends from anon,authenticated;
revoke insert,update,delete on public.player_badges from anon,authenticated;
grant select on public.player_profiles,public.player_wallets,public.player_coin_transactions,public.player_streaks,public.player_friend_requests,public.player_friends,public.player_badges to authenticated;
-- Users may edit only their display name through the table API. Custom IDs are RPC-only.
revoke update on public.player_profiles from anon,authenticated;
grant update(display_name) on public.player_profiles to authenticated;
