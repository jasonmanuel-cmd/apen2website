// Shared Supabase REST (PostgREST) helper for the staff inbox. Server-side only: the service-role key
// bypasses row level security and must never reach the browser. (api/lead.js keeps its own copy on purpose,
// so the public form's code path is untouched.)
const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);

export const supabaseConfig = () => {
  const url = str(process.env.SUPABASE_URL, 300).replace(/\/+$/, '');
  const key = str(process.env.SUPABASE_SERVICE_ROLE_KEY, 600);
  return url && key ? { url, key } : null;
};

export const supabase = async (db, path, init = {}, ms = 5000) => {
  const res = await fetch(`${db.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: db.key,
      // Legacy service_role keys are JWTs and go in both headers; newer sb_secret_ keys go in apikey only.
      ...(db.key.startsWith('eyJ') && { Authorization: `Bearer ${db.key}` }),
      'Content-Type': 'application/json',
      ...init.headers
    },
    signal: AbortSignal.timeout(ms)
  });
  if (!res.ok) throw Object.assign(new Error('Supabase request failed'), { code: `HTTP_${res.status}` });
  return res;
};
