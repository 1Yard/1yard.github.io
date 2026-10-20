// Local test stand-in for supabase-js. Runs the real supabase/schema.sql in an
// in-browser Postgres (PGlite) and enforces the real access rules by switching
// to the anon / authenticated roles for every call. Not used by the live site.
import { PGlite } from "https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.2.17/dist/index.js";

const STUBS = `
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, raw_user_meta_data jsonb, password text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`;

const ready = (async () => {
  // Return dates/timestamps as text like Supabase's API does (not JS Date objects).
  const db = new PGlite({ parsers: { 1082: (v) => v, 1114: (v) => new Date(v + "Z").toISOString(), 1184: (v) => new Date(v).toISOString() } });
  await db.exec(STUBS);
  await db.exec(await (await fetch("../supabase/schema.sql", { cache: "no-store" })).text());
  await db.exec(`grant usage on schema public, storage to anon, authenticated;

    grant all on storage.objects to authenticated; alter table storage.objects enable row level security;`);
  if (window.SEED) await window.SEED(db);
  return db;
})();

let session = JSON.parse(sessionStorage.getItem("mock-session") || "null");
const setSession = (s) => { session = s; sessionStorage.setItem("mock-session", JSON.stringify(s)); };

async function run(sql, params = []) {
  const db = await ready;
  await db.query(`select set_config('test.uid', $1, false)`, [session?.user.id || ""]);
  await db.exec(`set role ${session ? "authenticated" : "anon"}`);
  try { return { data: (await db.query(sql, params)).rows, error: null }; }
  catch (e) { return { data: null, error: { message: e.message } }; }
  finally { await db.exec("reset role"); }
}

function table(name) {
  let op = "select", patch = null, filters = [], single = false;
  const q = {
    select() { op = op === "select" ? "select" : op; return q; },
    update(p) { op = "update"; patch = p; return q; },
    delete() { op = "delete"; return q; },
    eq(col, val) { filters.push([col, val]); return q; },
    maybeSingle() { single = true; return q; },
    then(res, rej) { return exec().then(res, rej); },
  };
  const toParam = (v) => (v !== null && typeof v === "object" && (!Array.isArray(v) || (v.length && typeof v[0] === "object")) ? JSON.stringify(v) : v);
  async function exec() {
    const params = [];
    const cond = () => (filters.length ? " where " + filters.map(([c, v]) => { params.push(v); return `${c} = $${params.length}`; }).join(" and ") : "");
    let sql;
    if (op === "update") {
      const sets = Object.entries(patch).map(([k, v]) => { params.push(toParam(v)); return `${k} = $${params.length}`; });
      sql = `update public.${name} set ${sets.join(", ")}${cond()}`;
    } else if (op === "delete") sql = `delete from public.${name}${cond()}`;
    else sql = `select * from public.${name}${cond()}`;
    const r = await run(sql, params);
    if (r.error) return r;
    return { data: single ? r.data[0] || null : r.data, error: null };
  }
  return q;
}

window.supabase = {
  createClient() {
    return {
      from: table,
      async rpc(fn, args = {}) {
        const keys = Object.keys(args);
        const r = await run(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k])));
        return r.error ? r : { data: r.data[0].r, error: null };
      },
      auth: {
        async getSession() { return { data: { session } }; },
        async signOut() { setSession(null); return { error: null }; },
        async signInWithPassword({ email, password }) {
          const db = await ready;
          const u = (await db.query(`select id, email from auth.users where email = $1 and password = $2`, [email, password])).rows[0];
          if (!u) return { data: null, error: { message: "Invalid login credentials" } };
          setSession({ user: u }); return { data: { session }, error: null };
        },
        async signUp({ email, password, options }) {
          const db = await ready;
          try {
            const u = (await db.query(`insert into auth.users (email, password, raw_user_meta_data) values ($1, $2, $3) returning id, email`, [email, password, JSON.stringify(options?.data || {})])).rows[0];
            setSession({ user: u }); return { data: { session, user: u }, error: null };
          } catch (e) { return { data: null, error: { message: "User already registered" } }; }
        },
      },
      storage: {
        from(bucket) {
          return {
            async upload(path) { const r = await run(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, path]); return r.error ? r : { data: { path }, error: null }; },
            async remove(paths) { await run(`delete from storage.objects where bucket_id = $1 and name = any($2)`, [bucket, paths]); return { data: [], error: null }; },
            async createSignedUrl(path) { return { data: { signedUrl: "about:blank#" + path }, error: null }; },
          };
        },
      },
    };
  },
  __ready: ready,
};
