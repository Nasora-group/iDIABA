import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Runs every migration on a real in-memory PostgreSQL (PGlite) with a minimal
 * Supabase-like auth stub, then exercises multi-company isolation, roles,
 * invitations and quotas exactly as the RLS policies would enforce them.
 */
type User = { id: string; email: string };

const MIGRATIONS = path.resolve(__dirname, "../../supabase/migrations");
let db: PGlite;
let A: User, B: User, C: User;
let T: string; // A's company
let token: string;

async function as<R>(user: User, fn: () => Promise<R>): Promise<R> {
  await db.exec(`select set_config('request.jwt.claim.sub','${user.id}',false), set_config('request.jwt.claim.email','${user.email}',false); set role authenticated;`);
  try { return await fn(); } finally { await db.exec("reset role;"); }
}
async function addUser(email: string, workspace?: string): Promise<User> {
  const meta = workspace
    ? { full_name: email.split("@")[0], workspace_name: workspace, workspace_slug: workspace.toLowerCase().replace(/\W+/g, "-") }
    : { full_name: email.split("@")[0] };
  const { rows } = await db.query<{ id: string }>(`insert into auth.users(email,raw_user_meta_data) values($1,$2::jsonb) returning id`, [email, JSON.stringify(meta)]);
  return { id: rows[0].id, email };
}
const roleOf = async (tenant: string, user: User) =>
  (await db.query<{ role: string }>(`select role from public.tenant_memberships where tenant_id=$1 and user_id=$2`, [tenant, user.id])).rows[0]?.role;
const setPlan = (code: string) =>
  db.exec(`update public.tenant_subscriptions set plan_id=(select id from public.subscription_plans where code='${code}') where tenant_id='${T}'`);

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true), 'email', current_setting('request.jwt.claim.email', true), 'app_metadata', '{}'::jsonb) $$;
    grant usage on schema auth, public to authenticated, anon;
  `);
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
  A = await addUser("a@x.com", "Alpha Shop");
  B = await addUser("b@x.com");
  C = await addUser("c@x.com");
  T = (await db.query<{ id: string }>(`select id from public.tenants where created_by=$1`, [A.id])).rows[0].id;
});
afterAll(async () => { await db?.close(); });

describe("invitations", () => {
  it("owner creates an invitation with a normalised e-mail and a 64-char token", async () => {
    token = await as(A, async () => (await db.query<{ t: string }>(`select public.create_invitation($1,'B@X.com ','cashier') t`, [T])).rows[0].t);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });
  it("rejects duplicates, invalid e-mails and non-members", async () => {
    await setPlan("pro");
    await expect(as(A, () => db.query(`select public.create_invitation($1,'b@x.com','viewer')`, [T]))).rejects.toThrow(/déjà en attente/);
    await expect(as(A, () => db.query(`select public.create_invitation($1,'nope','viewer')`, [T]))).rejects.toThrow(/invalide/);
    await expect(as(C, () => db.query(`select public.create_invitation($1,'z@x.com','viewer')`, [T]))).rejects.toThrow(/Droits insuffisants/);
  });
  it("hides invitations (and their tokens) from non-admins and blocks direct writes", async () => {
    expect((await as(B, () => db.query(`select * from public.tenant_invitations`))).rows).toHaveLength(0);
    expect((await as(A, () => db.query(`select * from public.tenant_invitations where tenant_id=$1`, [T]))).rows).toHaveLength(1);
    await expect(as(A, () => db.query(`insert into public.tenant_invitations(tenant_id,email,invited_by) values($1,'q@x.com',$2)`, [T, A.id]))).rejects.toThrow(/permission denied/);
  });
  it("only the invited e-mail can accept, once", async () => {
    const mine = (await as(B, () => db.query<{ tenant_name: string; role: string; email_matches: boolean }>(`select * from public.get_invitation_preview($1)`, [token]))).rows[0];
    expect(mine).toMatchObject({ tenant_name: "Alpha Shop", role: "cashier", email_matches: true });
    expect((await as(C, () => db.query<{ email_matches: boolean }>(`select * from public.get_invitation_preview($1)`, [token]))).rows[0].email_matches).toBe(false);
    await expect(as(C, () => db.query(`select public.accept_invitation($1)`, [token]))).rejects.toThrow(/autre adresse/);
    await expect(as(B, () => db.query(`select public.accept_invitation('zzz')`))).rejects.toThrow(/introuvable/);
    const joined = await as(B, async () => (await db.query<{ t: string }>(`select public.accept_invitation($1) t`, [token])).rows[0].t);
    expect(joined).toBe(T);
    expect(await roleOf(T, B)).toBe("cashier");
    await expect(as(B, () => db.query(`select public.accept_invitation($1)`, [token]))).rejects.toThrow(/déjà été utilisée/);
  });
  it("counts members and pending invitations against the plan's user quota", async () => {
    await setPlan("trial"); // 2 users max, A + B already
    await expect(as(A, () => db.query(`select public.create_invitation($1,'c@x.com','viewer')`, [T]))).rejects.toThrow(/Limite d'utilisateurs/);
    await setPlan("pro");
  });
});

describe("tenant isolation and role-based writes (RLS)", () => {
  it("a stranger sees no company, no member and only their own profile", async () => {
    expect((await as(C, () => db.query(`select id from public.tenants`))).rows).toHaveLength(0);
    expect((await as(C, () => db.query(`select id from public.tenant_memberships`))).rows).toHaveLength(0);
    expect((await as(C, () => db.query(`select id from public.profiles`))).rows).toHaveLength(1);
  });
  it("co-members see each other's profile (names on tickets)", async () => {
    expect((await as(B, () => db.query(`select id from public.profiles`))).rows).toHaveLength(2);
  });
  it("a cashier cannot create catalogue products, an owner can, a stranger cannot read them", async () => {
    const insert = `insert into public.products(tenant_id,name,sku,unit,sale_price) values($1,'Riz 5kg','RIZ-5',$2,1000)`;
    await expect(as(B, () => db.query(insert, [T, "kg"]))).rejects.toThrow(/row-level security/);
    await as(A, () => db.query(insert, [T, "kg"]));
    expect((await as(A, () => db.query(`select id from public.products`))).rows).toHaveLength(1);
    expect((await as(C, () => db.query(`select id from public.products`))).rows).toHaveLength(0);
  });
  it("a stranger cannot insert data into someone else's company", async () => {
    await expect(as(C, () => db.query(`insert into public.products(tenant_id,name,sku,unit,sale_price) values($1,'Hack','HACK-1','kg',1)`, [T]))).rejects.toThrow(/row-level security/);
  });
  it("members cannot modify memberships directly", async () => {
    await expect(as(B, () => db.query(`update public.tenant_memberships set role='owner' where user_id=$1`, [B.id]))).rejects.toThrow(/permission denied/);
  });
});

describe("team management", () => {
  it("only owners/admins can list the team (with e-mails)", async () => {
    const members = (await as(A, () => db.query<{ email: string }>(`select * from public.list_tenant_members($1)`, [T]))).rows;
    expect(members.map((m) => m.email).sort()).toEqual(["a@x.com", "b@x.com"]);
    await expect(as(B, () => db.query(`select * from public.list_tenant_members($1)`, [T]))).rejects.toThrow(/Droits insuffisants/);
  });
  it("admins cannot touch owners or invite owners/admins", async () => {
    await as(A, () => db.query(`select public.set_member_role($1,$2,'admin')`, [T, B.id]));
    expect(await roleOf(T, B)).toBe("admin");
    await expect(as(B, () => db.query(`select public.create_invitation($1,'c@x.com','owner')`, [T]))).rejects.toThrow(/Seul un propriétaire/);
    await expect(as(B, () => db.query(`select public.set_member_role($1,$2,'viewer')`, [T, A.id]))).rejects.toThrow(/Seul un propriétaire/);
    await expect(as(B, () => db.query(`select public.remove_member($1,$2)`, [T, A.id]))).rejects.toThrow(/Seul un propriétaire/);
  });
  it("a company always keeps at least one owner", async () => {
    await expect(as(A, () => db.query(`select public.set_member_role($1,$2,'admin')`, [T, A.id]))).rejects.toThrow(/au moins un propriétaire/);
    await expect(as(A, () => db.query(`select public.remove_member($1,$2)`, [T, A.id]))).rejects.toThrow(/au moins un propriétaire/);
  });
  it("ownership can be handed over, then the previous owner can leave", async () => {
    await as(A, () => db.query(`select public.set_member_role($1,$2,'owner')`, [T, B.id]));
    await as(A, () => db.query(`select public.set_member_role($1,$2,'viewer')`, [T, A.id]));
    expect(await roleOf(T, A)).toBe("viewer");
    await as(A, () => db.query(`select public.remove_member($1,$2)`, [T, A.id]));
    expect(await roleOf(T, A)).toBeUndefined();
  });
  it("records membership and invitation changes in the audit trail", async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int n from public.audit_logs where tenant_id=$1 and entity in ('tenant_memberships','tenant_invitations')`, [T]);
    expect(rows[0].n).toBeGreaterThanOrEqual(6);
  });
});

describe("several companies per account", () => {
  it("lets an account own several companies, each with its own trial, capped at 5 created", async () => {
    const created: string[] = [];
    for (let i = 0; i < 4; i++) {
      created.push(await as(A, async () => (await db.query<{ t: string }>(`select public.create_tenant($1,$2) t`, [`Extra ${i}`, `extra-${i}`])).rows[0].t));
    }
    expect((await as(A, () => db.query(`select id from public.tenants`))).rows).toHaveLength(4);
    const { rows } = await db.query<{ n: number }>(`select count(*)::int n from public.tenant_subscriptions where tenant_id = any($1::uuid[])`, [created]);
    expect(rows[0].n).toBe(4);
    await expect(as(A, () => db.query(`select public.create_tenant('Sixth','sixth')`))).rejects.toThrow(/Limite de 5/);
  });
  it("keeps companies invisible to each other's members", async () => {
    const visible = (await as(A, () => db.query<{ id: string }>(`select id from public.tenants`))).rows.map((r) => r.id);
    expect(visible).not.toContain(T);
  });
});
