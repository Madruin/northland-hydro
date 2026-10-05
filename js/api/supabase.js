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
  // field photos live in the bucket under <project id>/ and are not removed by the table cascade
  const st = sb().storage.from("hydro-field");
  for (;;) { const { data } = await st.list(id, { limit: 1000 }); const paths = (data || []).filter((f) => f.id).map((f) => `${id}/${f.name}`); if (!paths.length) break; const { data: gone, error } = await st.remove(paths); if (error) throw error; if (!gone?.length) break; }
  const { error } = await sb().from("hydro_projects").delete().eq("id", id);
  if (error) throw error;
}
export async function listAnalyses(projectId) {
  const { data, error } = await sb().from("hydro_project_analyses").select("id,project_id,kind,label,pour_lat,pour_lon,state,huc,drainage_area_sqmi,regional_curve_id,regional,created_by,created_at").eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}
export async function getAnalysis(id) {
  const { data, error } = await sb().from("hydro_project_analyses").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}
export async function insertAnalysis(rec) {
  const { data, error } = await sb().from("hydro_project_analyses").insert(rec).select("id").single();
  if (error) throw error;
  return data;
}
export async function deleteAnalysis(id) {
  const { error } = await sb().from("hydro_project_analyses").delete().eq("id", id);
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

// ---- Field records (visits, items, partner access, photos in the private hydro-field bucket) ----
export async function listPartners(projectId) {
  const { data, error } = await sb().from("hydro_project_partners").select("email,added_by,added_at").eq("project_id", projectId).order("email");
  if (error) throw error; return data;
}
export async function addPartner(projectId, email, addedBy = null) {
  const { error } = await sb().from("hydro_project_partners").insert({ project_id: projectId, email: email.trim().toLowerCase(), added_by: addedBy });
  if (error) throw error;
}
export async function removePartner(projectId, email) {
  const { error } = await sb().from("hydro_project_partners").delete().eq("project_id", projectId).eq("email", email);
  if (error) throw error;
}
export async function upsertVisits(rows) {
  if (!rows.length) return; const { error } = await sb().from("hydro_field_visits").upsert(rows, { onConflict: "id" });
  if (error) throw error;
}
export async function upsertFieldItems(rows) {
  if (!rows.length) return; const { error } = await sb().from("hydro_field_items").upsert(rows, { onConflict: "id" });
  if (error) throw error;
}
export async function deleteFieldItems(ids) {
  if (!ids.length) return; const { error } = await sb().from("hydro_field_items").delete().in("id", ids);
  if (error) throw error;
}
export async function listFieldItems(projectId = null) {
  let q = sb().from("hydro_field_items").select("id,project_id,visit_id,kind,name,note,lon,lat,acc,alt,dir,taken_at,geom,photo_file,photo_path,thumb_path,created_by,created_at").order("taken_at", { ascending: false }).limit(5000);
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q; if (error) throw error; return data;
}
export async function listVisits(projectId) {
  const { data, error } = await sb().from("hydro_field_visits").select("*").eq("project_id", projectId).order("visit_date", { ascending: false });
  if (error) throw error; return data;
}
export async function uploadFieldPhoto(path, blob) {
  const { error } = await sb().storage.from("hydro-field").upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
}
export async function removeFieldPhotos(paths) {
  if (!paths.length) return; const { error } = await sb().storage.from("hydro-field").remove(paths);
  if (error) throw error;
}
export async function signedPhotoUrls(paths, seconds = 3600) {
  if (!paths.length) return {}; const { data, error } = await sb().storage.from("hydro-field").createSignedUrls(paths, seconds);
  if (error) throw error; return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}
export async function downloadFieldPhoto(path) {
  const { data, error } = await sb().storage.from("hydro-field").download(path);
  if (error) throw error; return data;
}
