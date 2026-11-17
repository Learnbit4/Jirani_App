// Set EXPO_PUBLIC_API_URL to your laptop's LAN address, e.g. http://192.168.1.20:8000
const BASE = process.env.EXPO_PUBLIC_API_URL;

export async function api(path, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('Cannot reach the server. Check your internet connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data.detail;
    const msg = typeof d === 'string' ? d : 'Check your details and try again.';
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}
