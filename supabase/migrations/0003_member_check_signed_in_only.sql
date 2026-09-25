-- is_member() only makes sense for signed-in users (the access rules call it).
-- Anonymous visitors don't need it, so they can't call it.
revoke execute on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;
