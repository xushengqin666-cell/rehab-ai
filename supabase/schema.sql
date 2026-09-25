-- 康复AI · 云端同步后端建表脚本（Supabase）
-- 用法：Supabase 项目 → SQL Editor → 新建查询 → 粘贴本文件全部内容 → Run。
-- 作用：①建 userdata 表（每个账号一行快照）②开启行级权限，任何人只能读写自己那一行
--      ③提供 delete_my_account() 供 App 内「注销账号」真正删除账号与云端数据（应用商店上架必备）

create table if not exists public.userdata (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists userdata_user_id_idx on public.userdata (user_id);
create index if not exists userdata_updated_at_idx on public.userdata (updated_at desc);

-- 行级权限：没有这段，拿到 anon key 的人可以读到别人的数据；上架前必须执行
alter table public.userdata enable row level security;

drop policy if exists "userdata_select_own" on public.userdata;
create policy "userdata_select_own" on public.userdata
  for select using (auth.uid() = user_id);

drop policy if exists "userdata_insert_own" on public.userdata;
create policy "userdata_insert_own" on public.userdata
  for insert with check (auth.uid() = user_id);

drop policy if exists "userdata_update_own" on public.userdata;
create policy "userdata_update_own" on public.userdata
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "userdata_delete_own" on public.userdata;
create policy "userdata_delete_own" on public.userdata
  for delete using (auth.uid() = user_id);

-- 注销账号：客户端用 anon key 删不掉 auth.users，所以用 SECURITY DEFINER 函数代劳，
-- 只允许已登录用户删除「自己」的账号与数据。
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from public.userdata where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- 自检（执行后应各自返回一行结果）：
--   select count(*) from public.userdata;
--   select policyname from pg_policies where tablename = 'userdata';
