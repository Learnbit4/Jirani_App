import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, Switch, Alert, Share,
  ActivityIndicator, StyleSheet, useColorScheme, StatusBar, BackHandler,
} from 'react-native';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { api } from './api';

const CATS = {
  alcohol: {
    label: 'Alcohol',
    qty: ['1 tot', '250 ml', '350 ml', '500 ml', 'mzinga (750 ml)', '1 litre', 'crate'],
    items: ['Tusker', 'White Cap', 'Guinness', 'Pilsner', 'Balozi', 'Hunters Gold', 'Smirnoff Vodka',
      'KC Pineapple', 'KC Coconut', 'Chrome Vodka', 'Gilbeys Gin', 'Johnnie Walker', 'Jack Daniel’s',
      'Captain Morgan', 'Viceroy', 'Kenya Cane', 'Black & White', 'Other alcohol'],
  },
  wine: {
    label: 'Wine',
    qty: ['1 glass', '750 ml bottle', '1 litre box', '2 bottles'],
    items: ['Four Cousins', 'Drostdy-Hof', 'Nederburg', 'Cellar Cask', 'Robertson', 'Other wine'],
  },
  soda: {
    label: 'Soda / juice',
    qty: ['300 ml', '500 ml', '1 litre', '2 litres', 'crate'],
    items: ['Coca-Cola', 'Fanta', 'Sprite', 'Stoney', 'Novida', 'Predator', 'Minute Maid',
      'Delmonte juice', 'Soda water', 'Tonic water', 'Other soda or juice'],
  },
};
const LIGHT = { bg: '#eef3f1', card: '#ffffff', ink: '#12302a', mute: '#5d746d', line: '#d3e0db', acc: '#0f5a48', onAcc: '#ffffff', gold: '#e0a21b', warn: '#b42318' };
const DARK = { bg: '#0c1b17', card: '#142923', ink: '#e6f2ee', mute: '#92aca4', line: '#244038', acc: '#3ecf9f', onAcc: '#06241b', gold: '#f2b73a', warn: '#ff8a7a' };

export default function App() {
  const t = useColorScheme() === 'dark' ? DARK : LIGHT;
  const s = styles(t);
  const [screen, setScreen] = useState('boot');
  const [token, setToken] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', adult: false, code: '' });
  const [cat, setCat] = useState('alcohol');
  const [pick, setPick] = useState({ item: null, qty: null });
  const [drinks, setDrinks] = useState([]);
  const [note, setNote] = useState('');
  const [tab, setTab] = useState('nearby');
  const [people, setPeople] = useState([]);
  const [matches, setMatches] = useState([]);
  const [places, setPlaces] = useState({});
  const [chat, setChat] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    SecureStore.getItemAsync('token').then((tk) => {
      if (tk) { setToken(tk); setScreen('drinks'); } else setScreen('signup');
    });
  }, []);

  const run = async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const call = async (path, opts = {}) => {
    try { return await api(path, { ...opts, token }); }
    catch (e) {
      if (e.status === 401) { await SecureStore.deleteItemAsync('token'); setToken(null); setScreen('signup'); }
      throw e;
    }
  };

  const requestOtp = () => run(async () => {
    if (!/^[A-Za-z][A-Za-z ’'-]{1,20}$/.test(form.name.trim())) throw new Error('Enter your first name (letters only).');
    if (!form.adult) throw new Error('You must confirm you are 18 or older.');
    const r = await api('/auth/request-otp', { method: 'POST', body: { phone: form.phone } });
    if (r.dev_code) Alert.alert('Dev code', r.dev_code);
    setScreen('otp');
  });
  const verify = () => run(async () => {
    const r = await api('/auth/verify-otp', {
      method: 'POST',
      body: { phone: form.phone, code: form.code.trim(), first_name: form.name.trim(), confirmed_18: form.adult },
    });
    await SecureStore.setItemAsync('token', r.token);
    setToken(r.token); setScreen('location');
  });
  const askLocation = () => run(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') throw new Error('Location is needed to show people near you. Turn it on in your phone settings.');
    setScreen('drinks');
  });

  const addDrink = () => {
    if (!pick.item || !pick.qty) return setErr('Choose a drink and a quantity.');
    if (drinks.length >= 5) return setErr('You can list up to 5 drinks.');
    setErr(''); setDrinks([...drinks, { category: cat, item: pick.item, quantity: pick.qty }]);
    setPick({ item: null, qty: null });
  };
  const loadNearby = async () => {
    try { setPeople(await call('/nearby')); }
    catch (e) { if (e.status === 403) setScreen('drinks'); throw e; }
  };
  const loadMatches = async () => setMatches(await call('/matches'));
  const goLive = () => run(async () => {
    if (!drinks.length) throw new Error('Add at least one drink first.');
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') throw new Error('Location is turned off for this app.');
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    await call('/presence', { method: 'POST', body: { lat: pos.coords.latitude, lng: pos.coords.longitude, note: note.trim() || null, drinks } });
    await loadNearby(); await loadMatches(); setTab('nearby'); setScreen('discover');
  });
  const goOffline = () => run(async () => { await call('/presence', { method: 'DELETE' }); setScreen('drinks'); });
  const swipe = (p, action) => run(async () => {
    setPeople((l) => l.filter((x) => x.user_id !== p.user_id));
    try {
      const r = await call('/swipe', { method: 'POST', body: { to_user: p.user_id, action } });
      if (r.matched) { await loadMatches(); setTab('matches'); Alert.alert('It’s a match', 'You and ' + p.first_name + ' both want to share.'); }
    } catch (e) { if (e.status !== 404) throw e; }
  });
  const safety = (p, after) => Alert.alert(p.first_name, 'What would you like to do?', [
    { text: 'Block', onPress: () => run(async () => { await call('/block', { method: 'POST', body: { user_id: p.user_id } }); setPeople((l) => l.filter((x) => x.user_id !== p.user_id)); if (after) after(); }) },
    { text: 'Report', style: 'destructive', onPress: () => run(async () => { await call('/report', { method: 'POST', body: { user_id: p.user_id, reason: 'Reported from the app' } }); setPeople((l) => l.filter((x) => x.user_id !== p.user_id)); if (after) after(); }) },
    { text: 'Cancel', style: 'cancel' },
  ]);
  const shareMeetup = (m) => {
    const place = (places[m.user_id] || '').trim();
    if (!place) return setErr('Name a public place first.');
    setErr('');
    Share.share({ message: `Meeting ${m.first_name} at ${place}. I’ll message when I’m home. Sent from Cheers Nearby.` });
  };

  const signOut = async () => {
    await SecureStore.deleteItemAsync('token');
    setToken(null); setDrinks([]); setPeople([]); setMatches([]); setChat(null); setErr('');
    setForm({ name: '', phone: '', adult: false, code: '' });
    setScreen('signup');
  };
  // Android back button: go back inside the app instead of closing it.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'chat') { setScreen('discover'); return true; }
      if (screen === 'otp') { setScreen('signup'); return true; }
      if (screen === 'discover') { setScreen('drinks'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [screen]);
  const openChat = (m) => run(async () => {
    const r = await call('/chat/' + m.user_id);
    setChat({ id: m.user_id, name: m.first_name, msgs: r.messages, open: r.open });
    setDraft(''); setScreen('chat');
  });
  const sendChat = () => run(async () => {
    const body = draft.trim();
    if (!body) return;
    await call('/chat/' + chat.id, { method: 'POST', body: { body } });
    setDraft('');
    const r = await call('/chat/' + chat.id);
    setChat({ ...chat, msgs: r.messages, open: r.open });
  });
  // Poll for new messages every 4 seconds while the chat screen is open.
  useEffect(() => {
    if (screen !== 'chat' || !chat) return undefined;
    const timer = setInterval(async () => {
      try {
        const r = await api('/chat/' + chat.id, { token });
        setChat((c) => (c ? { ...c, msgs: r.messages, open: r.open } : c));
      } catch (e) { /* ignore: next tick retries */ }
    }, 4000);
    return () => clearInterval(timer);
  }, [screen, chat && chat.id, token]);

  const Btn = ({ label, onPress, alt, small }) => (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={busy}
      style={[s.btn, alt && s.alt, small && s.small, busy && { opacity: 0.6 }]}>
      <Text style={[s.btnText, alt && { color: t.ink }]}>{label}</Text>
    </Pressable>
  );
  const Chip = ({ label, on, onPress }) => (
    <Pressable onPress={onPress} style={[s.chip, on && { backgroundColor: t.ink, borderColor: t.ink }]}>
      <Text style={{ color: on ? t.bg : t.ink, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
  const Err = () => (err ? <Text style={s.err} accessibilityRole="alert">{err}</Text> : null);

  let body;
  if (screen === 'boot') body = <ActivityIndicator color={t.acc} />;
  else if (screen === 'signup') body = (<>
    <Text style={s.h1}>Cheers Nearby</Text>
    <Text style={s.p}>See who’s nearby with a drink to share.</Text>
    <Text style={s.label}>First name</Text>
    <TextInput style={s.input} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} autoComplete="given-name" />
    <Text style={s.label}>Phone number</Text>
    <TextInput style={s.input} value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" placeholder="0712 345 678" placeholderTextColor={t.mute} />
    <Text style={s.mute}>Used to check you’re a real person. Never shown to other users.</Text>
    <View style={s.row}><Switch value={form.adult} onValueChange={(v) => setForm({ ...form, adult: v })} />
      <Text style={[s.p, { flex: 1, marginLeft: 10 }]}>I am 18 or older. Kenya’s legal drinking age is 18.</Text></View>
    <Err /><Btn label="Send code" onPress={requestOtp} />
  </>);
  else if (screen === 'otp') body = (<>
    <Text style={s.h1}>Enter your code</Text>
    <Text style={s.p}>We sent a 6-digit code to {form.phone}.</Text>
    <TextInput style={s.input} value={form.code} onChangeText={(v) => setForm({ ...form, code: v })} keyboardType="number-pad" maxLength={6} autoComplete="sms-otp" />
    <Err /><Btn label="Verify" onPress={verify} /><Btn alt label="Change number" onPress={() => setScreen('signup')} />
  </>);
  else if (screen === 'location') body = (<>
    <Text style={s.h1}>Turn on location</Text>
    <Text style={s.p}>We use your location only to sort people by distance.</Text>
    <View style={s.safe}><Text style={s.p}>Others see a range like “under 500 m”, never an exact distance, a map pin or a street. Your location is hidden when your 2-hour status ends.</Text></View>
    <Err /><Btn label="Allow location" onPress={askLocation} />
  </>);
  else if (screen === 'drinks') body = (<>
    <Text style={s.h1}>What do you have?</Text>
    <View style={s.wrap}>{Object.keys(CATS).map((k) => <Chip key={k} label={CATS[k].label} on={cat === k} onPress={() => { setCat(k); setPick({ item: null, qty: null }); }} />)}</View>
    <Text style={s.label}>Drink</Text>
    <View style={s.wrap}>{CATS[cat].items.map((i) => <Chip key={i} label={i} on={pick.item === i} onPress={() => setPick({ ...pick, item: i })} />)}</View>
    <Text style={s.label}>Quantity</Text>
    <View style={s.wrap}>{CATS[cat].qty.map((q) => <Chip key={q} label={q} on={pick.qty === q} onPress={() => setPick({ ...pick, qty: q })} />)}</View>
    <Btn alt label="Add this drink" onPress={addDrink} />
    {drinks.map((d, i) => (
      <View key={i} style={[s.box, s.rowBetween]}>
        <Text style={s.p}><Text style={{ fontWeight: '700' }}>{d.item}</Text>{'\n'}{d.quantity}</Text>
        <Btn small alt label="Remove" onPress={() => setDrinks(drinks.filter((_, j) => j !== i))} />
      </View>))}
    <Text style={s.label}>One-line note (optional)</Text>
    <TextInput style={s.input} value={note} onChangeText={setNote} maxLength={60} placeholder="here till 9 pm" placeholderTextColor={t.mute} />
    <Text style={s.mute}>Your status lasts 2 hours, then disappears.</Text>
    <Err /><Btn label="Go live for 2 hours" onPress={goLive} />
    <Btn alt label="My matches" onPress={() => run(async () => { await loadMatches(); setPeople([]); setTab('matches'); setScreen('discover'); })} />
    <Btn alt label="Sign out" onPress={signOut} />
  </>);
  else if (screen === 'chat' && chat) body = (<>
    <View style={s.rowBetween}>
      <Btn small alt label="Back" onPress={() => { setErr(''); setScreen('discover'); run(loadMatches); }} />
      <Btn small alt label="Report or block" onPress={() => safety({ user_id: chat.id, first_name: chat.name }, () => setScreen('discover'))} />
    </View>
    <Text style={s.h1}>{chat.name}</Text>
    <Text style={s.mute}>Chats close 24 hours after a match. Meet in a public place.</Text>
    {chat.msgs.length === 0 && <Text style={s.p}>No messages yet. Say hello.</Text>}
    {chat.msgs.map((m) => (
      <View key={m.id} style={[s.bubble, m.mine ? s.mine : s.theirs]}>
        <Text style={{ color: m.mine ? t.onAcc : t.ink, fontSize: 16 }}>{m.body}</Text>
      </View>))}
    <Err />
    {chat.open ? (<>
      <TextInput style={[s.input, { marginTop: 14 }]} value={draft} onChangeText={setDraft} maxLength={500} placeholder="Write a message" placeholderTextColor={t.mute} multiline />
      <Btn label="Send" onPress={sendChat} />
    </>) : <Text style={s.err}>This chat has closed.</Text>}
  </>);
  else body = (<>
    <View style={s.rowBetween}><Text style={s.h1}>Nearby</Text><Btn small alt label="Refresh" onPress={() => run(loadNearby)} /></View>
    <View style={s.wrap}><Chip label={`Nearby (${people.length})`} on={tab === 'nearby'} onPress={() => setTab('nearby')} />
      <Chip label={`Matches (${matches.length})`} on={tab === 'matches'} onPress={() => { setTab('matches'); run(loadMatches); }} /></View>
    <Err />
    {tab === 'nearby' && (people.length === 0
      ? <View style={s.box}><Text style={s.p}>No one else is nearby right now. Check back later.</Text></View>
      : (() => { const p = people[0]; return (
        <View style={s.box}>
          <View style={s.rowBetween}><Text style={s.name}>{p.first_name}</Text><Btn small alt label="Report or block" onPress={() => safety(p)} /></View>
          <Text style={s.p}>{p.distance}{p.mixer_match ? '  ·  Mixer match: you could share' : ''}</Text>
          {p.drinks.map((d, i) => <Text key={i} style={s.drink}>{d.quantity} of {d.item}</Text>)}
          {p.note ? <Text style={s.mute}>{p.note}</Text> : null}
          <Btn alt label="Pass" onPress={() => swipe(p, 'pass')} /><Btn label="Invite to share" onPress={() => swipe(p, 'like')} />
        </View>); })())}
    {tab === 'matches' && (matches.length === 0
      ? <View style={s.box}><Text style={s.p}>No matches yet. Invite someone from Nearby.</Text></View>
      : matches.map((m) => (
        <View key={m.user_id} style={s.box}>
          <Text style={s.name}>{m.first_name}</Text>
          <View style={s.safe}><Text style={s.p}>Meet in public. Pick a bar or restaurant with other people around, and tell a friend where you’ll be.</Text></View>
          <TextInput style={s.input} value={places[m.user_id] || ''} onChangeText={(v) => setPlaces({ ...places, [m.user_id]: v })} placeholder="Name of a public place" placeholderTextColor={t.mute} />
          <Btn label="Message" onPress={() => openChat(m)} />
          <Btn alt label="Share meetup with a friend" onPress={() => shareMeetup(m)} />
        </View>)))}
    <Btn alt label="End my status now" onPress={goOffline} />
  </>);

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <StatusBar barStyle={t.bg === DARK.bg ? 'light-content' : 'dark-content'} />
      {body}
    </ScrollView>
  );
}

const styles = (t) => StyleSheet.create({
  page: { padding: 18, paddingTop: (StatusBar.currentHeight || 0) + 16, paddingBottom: 48 },
  h1: { fontFamily: 'serif', fontSize: 30, color: t.ink, marginBottom: 6 },
  name: { fontFamily: 'serif', fontSize: 28, color: t.ink },
  p: { fontSize: 16, color: t.ink, marginVertical: 4 },
  mute: { fontSize: 14, color: t.mute, marginVertical: 4 },
  label: { fontWeight: '700', color: t.ink, marginTop: 14, marginBottom: 4 },
  input: { borderWidth: 1.5, borderColor: t.line, borderRadius: 10, padding: 12, fontSize: 16, color: t.ink, backgroundColor: t.card },
  btn: { backgroundColor: t.acc, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 12 },
  alt: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: t.line },
  small: { paddingVertical: 8, paddingHorizontal: 12, marginTop: 0 },
  btnText: { color: t.onAcc, fontWeight: '700', fontSize: 16 },
  chip: { borderWidth: 1.5, borderColor: t.line, borderRadius: 99, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: t.card },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', marginVertical: 14 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  box: { backgroundColor: t.card, borderWidth: 1.5, borderColor: t.line, borderRadius: 12, padding: 14, marginVertical: 10 },
  safe: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.acc, borderRadius: 12, padding: 10, marginVertical: 10 },
  drink: { fontSize: 20, fontWeight: '700', color: t.ink, marginTop: 8 },
  bubble: { maxWidth: '80%', borderRadius: 14, padding: 10, marginVertical: 4 },
  mine: { alignSelf: 'flex-end', backgroundColor: t.acc },
  theirs: { alignSelf: 'flex-start', backgroundColor: t.card, borderWidth: 1.5, borderColor: t.line },
  err: { color: t.warn, fontWeight: '600', marginTop: 10 },
});
