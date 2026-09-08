// Supabase client for the team project watch list. The publishable key is safe to ship:
// every table is behind row-level security keyed to the hydro_members allowlist.
export const SUPABASE_URL = "https://lwbatdclpclwyuglzwgg.supabase.co";
export const SUPABASE_KEY = "sb_publishable_8av9WMOlUWv-zvH6H7hVdg_P0dPRx1D";

let client = null;
export function sb() {
  if (client) return client;
  if (!window.supabase) throw new Error("supabase-js not loaded");
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

export async function session() { const { data } = await sb().auth.getSession(); return data.session; }
export function onAuth(fn) { return sb().auth.onAuthStateChange((_evt, s) => fn(s)); }
export async function signInWithEmail(email) {
  const redirect = location.origin + location.pathname;
  const { error } = await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
  if (error) throw error;
}
export async function verifyOtp(email, token) {
  const { error } = await sb().auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
}
export async function signInWithPassword(email, password) {
  const { error } = await sb().auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function setPassword(password) {
  const { error } = await sb().auth.updateUser({ password });
  if (error) throw error;
}
export async function signOut() { await sb().auth.signOut(); }

export async function isMember() {
  const { data, error } = await sb().rpc("is_hydro_member");
  if (error) return false;
  return !!data;
}
export async function listProjects() {
  const { data, error } = await sb().from("hydro_projects").select("*").order("status").order("name");
  if (error) throw error;
  return data;
}
export async function upsertProject(p) {
  const { data, error } = await sb().from("hydro_projects").upsert(p, { onConflict: "id" }).select().single();
  if (error) throw error;
  return data;
}
export async function deleteProject(id) {
  const { error } = await sb().from("hydro_projects").delete().eq("id", id);
  if (error) throw error;
}
export async function listMembers() {
  const { data, error } = await sb().from("hydro_members").select("*").order("email");
  if (error) throw error;
  return data;
}
export async function addMember(email, display_name) {
  const { error } = await sb().from("hydro_members").insert({ email: email.trim().toLowerCase(), display_name });
  if (error) throw error;
}
