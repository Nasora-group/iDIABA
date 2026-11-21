-- Sprint 11: close the remaining mutable search_path warning.
-- This trigger function is invoked by PostgreSQL only and must not resolve
-- unqualified objects through a caller-controlled search path.
alter function public.guard_sale_header() set search_path = pg_catalog, public;
