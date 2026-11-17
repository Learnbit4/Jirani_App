// Runs your real api.js against the backend: sign-up, go live, nearby, match, chat, errors.
// Usage (PowerShell): $env:EXPO_PUBLIC_API_URL="http://localhost:8000"; node test-api.mjs
// The backend must be running with DEV_OTP=1 so the sign-up code comes back in the response.
import { readFileSync } from 'node:fs';

if (!process.env.EXPO_PUBLIC_API_URL) { console.log('Set EXPO_PUBLIC_API_URL first.'); process.exit(1); }
const src = readFileSync(new URL('./api.js', import.meta.url), 'utf8');
const { api } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  ' + extra)); if (!ok) failed++; };
const rand = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');

async function signup(phone, name) {
  const o = await api('/auth/request-otp', { method: 'POST', body: { phone } });
  if (!o.dev_code) throw new Error('No dev_code: start the backend with DEV_OTP=1');
  const v = await api('/auth/verify-otp', { method: 'POST', body: { phone, code: o.dev_code, first_name: name, confirmed_18: true } });
  return v.token;
}
const fail = async (p) => { try { await p; return null; } catch (e) { return e; } };

try {
  const A = await signup('0712' + rand(), 'Tester'), B = await signup('0722' + rand(), 'Vanessa');
  check('sign-up returns a token', !!A && !!B);

  let e = await fail(api('/nearby', { token: A }));
  check('nearby before going live gives status 403', e && e.status === 403, e && e.message);
  check('error message is readable text', e && typeof e.message === 'string' && e.message.length > 5);

  e = await fail(api('/auth/request-otp', { method: 'POST', body: { phone: '12345' } }));
  check('bad phone number gives status 400', e && e.status === 400, e && e.message);

  e = await fail(api('/nearby'));
  check('request with no token is rejected', e && (e.status === 422 || e.status === 401), e && String(e.status));

  await api('/presence', { method: 'POST', token: A, body: { lat: -1.286, lng: 36.817, note: 'test', drinks: [{ category: 'soda', item: 'Novida', quantity: '1 litre' }] } });
  await api('/presence', { method: 'POST', token: B, body: { lat: -1.283, lng: 36.817, note: 'here', drinks: [{ category: 'alcohol', item: 'KC Pineapple', quantity: 'mzinga (750 ml)' }] } });
  const near = await api('/nearby', { token: A });
  const v = near.find((p) => p.first_name === 'Vanessa');
  check('nearby shows the other live user', !!v);
  check('distance is a range, not a number', v && /^(under|over)/.test(v.distance), v && v.distance);
  check('mixer match flagged', v && v.mixer_match === true);
  check('no raw coordinates in response', v && !('lat' in v) && !('lng' in v) && !('phone' in v));

  const aid = (await api('/nearby', { token: B })).find((p) => p.first_name === 'Tester').user_id;
  const s1 = await api('/swipe', { method: 'POST', token: A, body: { to_user: v.user_id, action: 'like' } });
  const s2 = await api('/swipe', { method: 'POST', token: B, body: { to_user: aid, action: 'like' } });
  check('one-sided like is not a match', s1.matched === false);
  check('mutual like is a match', s2.matched === true);
  check('match appears in /matches', (await api('/matches', { token: A })).some((m) => m.user_id === v.user_id));

  await api('/chat/' + v.user_id, { method: 'POST', token: A, body: { body: 'Habari!' } });
  await api('/chat/' + aid, { method: 'POST', token: B, body: { body: 'Poa' } });
  const chat = await api('/chat/' + v.user_id, { token: A });
  check('chat has both messages in order', chat.messages.length === 2 && chat.messages[0].mine && !chat.messages[1].mine);
  check('chat is open', chat.open === true);

  await api('/block', { method: 'POST', token: A, body: { user_id: v.user_id } });
  e = await fail(api('/chat/' + v.user_id, { token: A }));
  check('chat is closed after a block (403)', e && e.status === 403, e && String(e.status));
} catch (err) {
  console.log('ERROR  ' + err.message); failed++;
}
console.log(failed ? `\n${failed} problem(s).` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
