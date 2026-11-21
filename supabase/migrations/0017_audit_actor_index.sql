-- Cover the nullable audit actor foreign key for efficient user cleanup and audit filtering.
create index if not exists audit_logs_actor_id_idx
  on public.audit_logs(actor_id);
