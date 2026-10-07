// ============================================================
//  SOCIO BOOSTER  -  Telegram SMM Bot  (@Socio_Booster_Bot)
//  Cloudflare Workers + Supabase.  Single file, no dependencies.
// ============================================================
import { IDS, FB } from './emoji.js';

let ENV, SET = null, ADM = null;
const CUR = '৳';
const PLATFORMS = [
  ['telegram', 'Telegram'], ['tiktok', 'TikTok'], ['facebook', 'Facebook'],
  ['instagram', 'Instagram'], ['youtube', 'YouTube'], ['twitter', 'Twitter / X']
];
const PNAME = Object.fromEntries(PLATFORMS);
const DEFAULTS = {
  welcome_text: 'Welcome to <b>Socio Booster</b>!\nBoost your social media in seconds. Fast, cheap and reliable.',
  support_username: '',
  how_order: '1. Tap <b>Get Service</b>\n2. Choose platform, category and service\n3. Send your link and quantity\n4. Confirm the order. Done!',
  how_deposit: '1. Tap <b>Deposit</b>\n2. Choose a payment method\n3. Send money to the shown number\n4. Submit the amount and Transaction ID\n5. Your balance is added after admin approval.',
  ref_percent: '5', min_deposit: '50', maintenance: 'off'
};
const SETKEYS = {
  welcome_text: 'Welcome Text', support_username: 'Support Username (without @)',
  how_order: 'How to Order Text', how_deposit: 'How to Deposit Text',
  ref_percent: 'Referral Bonus %', min_deposit: 'Minimum Deposit', maintenance: 'Maintenance (on / off)'
};
const ST = { pending: '⏳', processing: '🔄', completed: '✅', canceled: '❌', failed: '⚠️' };

// ---------------- helpers: emoji / buttons ----------------
const E = k => IDS[k] ? `<tg-emoji emoji-id="${IDS[k]}">${FB[k] || '•'}</tg-emoji>` : (FB[k] || '');
const B = (label, key, data, style) => {
  const b = IDS[key] ? { text: label, icon_custom_emoji_id: IDS[key] } : { text: `${FB[key] || ''} ${label}`.trim() };
  if (style) b.style = style;
  if (data !== undefined) b.callback_data = data;
  return b;
};
const ik = rows => ({ inline_keyboard: rows });
const rk = rows => ({ keyboard: rows, resize_keyboard: true, is_persistent: true });
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = n => `${(+n || 0).toFixed(2)}${CUR}`;
const norm = t => (t || '').toLowerCase().replace(/[^a-z]/g, '');
const back = (to, label = 'Back') => [B(label, 'back', to)];

// ---------------- helpers: telegram ----------------
const stripEmoji = s => s.replace(/<tg-emoji[^>]*>(.*?)<\/tg-emoji>/g, '$1');
async function tg(method, params = {}) {
  const call = p => fetch(`https://api.telegram.org/bot${ENV.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p)
  }).then(r => r.json());
  let r = await call(params);
  // If premium emoji is rejected, retry with normal emoji so the bot never breaks
  if (!r.ok && /emoji|button|entit/i.test(r.description || '')) {
    const p = { ...params };
    if (p.text) p.text = stripEmoji(p.text);
    if (p.reply_markup) p.reply_markup = JSON.parse(JSON.stringify(p.reply_markup).replace(/"icon_custom_emoji_id":"\d+",?/g, '').replace(/,}/g, '}'));
    r = await call(p);
  }
  return r;
}
const send = (chat, text, kb) => tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: kb });
async function show(c, text, kb) {
  if (!c.mid) return send(c.chat, text, kb);
  const r = await tg('editMessageText', { chat_id: c.chat, message_id: c.mid, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: kb });
  if (!r.ok && !/not modified/i.test(r.description || '')) return send(c.chat, text, kb);
  return r;
}

// ---------------- helpers: database (Supabase REST) ----------------
async function sb(path, method = 'GET', body, prefer = 'return=representation') {
  const r = await fetch(`${ENV.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: ENV.SUPABASE_KEY, Authorization: `Bearer ${ENV.SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`DB ${r.status}: ${t}`);
  return t ? JSON.parse(t) : null;
}
const q = (t, query) => sb(`${t}?${query}`);
const one = async (t, query) => (await q(t, query + '&limit=1'))[0];
const ins = async (t, row) => (await sb(t, 'POST', row))[0];
const upd = (t, query, patch) => sb(`${t}?${query}`, 'PATCH', patch);
const del = (t, query) => sb(`${t}?${query}`, 'DELETE');
const rpc = (fn, args) => sb(`rpc/${fn}`, 'POST', args);
const upsert = (t, row, key) => sb(`${t}?on_conflict=${key}`, 'POST', row, 'resolution=merge-duplicates,return=representation');

async function S() {
  if (!SET) { SET = { ...DEFAULTS }; (await q('settings', 'select=*')).forEach(r => SET[r.key] = r.value); }
  return SET;
}
async function admins() {
  if (!ADM) ADM = [+ENV.OWNER_ID, ...(await q('admins', 'select=id')).map(x => +x.id)];
  return ADM;
}
const isAdmin = async id => (await admins()).includes(+id);
const isOwner = id => +id === +ENV.OWNER_ID;
const getSt = uid => one('sessions', `uid=eq.${uid}&select=*`);
const setSt = (uid, state, data = {}) => upsert('sessions', { uid, state, data }, 'uid');
const clearSt = uid => del('sessions', `uid=eq.${uid}`);
async function notifyAdmins(text, kb) {
  for (const id of await admins()) await send(id, text, kb).catch(() => { });
}

// ---------------- entry points ----------------
export default {
  async fetch(req, env, ctx) {
    ENV = env;
    const url = new URL(req.url);
    if (url.pathname === `/setup/${env.WEBHOOK_SECRET}`) {
      const w = await tg('setWebhook', { url: `${url.origin}/hook/${env.WEBHOOK_SECRET}`, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
      await tg('setMyCommands', { commands: [{ command: 'start', description: 'Open main menu' }, { command: 'cancel', description: 'Cancel current action' }] });
      return new Response(JSON.stringify(w));
    }
    if (req.method === 'POST' && url.pathname === `/hook/${env.WEBHOOK_SECRET}`) {
      const update = await req.json();
      ctx.waitUntil(handle(update).catch(e => console.log('ERR', e.stack || e)));
      return new Response('ok');
    }
    return new Response('Socio Booster is running.');
  },
  async scheduled(_ev, env, ctx) {
    ENV = env;
    ctx.waitUntil(cron().catch(e => console.log('CRON ERR', e.stack || e)));
  }
};

async function handle(u) {
  SET = null; ADM = null;
  const m = u.message, cb = u.callback_query;
  const from = (m || cb)?.from;
  if (!from || from.is_bot) return;
  if (m && m.chat.type !== 'private') return;
  const c = { uid: from.id, chat: m ? m.chat.id : cb.message.chat.id, mid: cb ? cb.message.message_id : null, cb: cb?.id };
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'User';

  let user = await one('users', `id=eq.${c.uid}&select=*`);
  if (!user) {
    let ref = null;
    const mm = (m?.text || '').match(/^\/start\s+(?:ref_)?(\d+)/);
    if (mm && +mm[1] !== c.uid && await one('users', `id=eq.${mm[1]}&select=id`)) ref = +mm[1];
    user = await ins('users', { id: c.uid, name, username: from.username || null, referred_by: ref });
    if (ref) send(ref, `${E('invite')} A new user joined using your referral link!`).catch(() => { });
  } else if (user.name !== name || user.username !== (from.username || null)) {
    upd('users', `id=eq.${c.uid}`, { name, username: from.username || null });
    user.name = name; user.username = from.username || null;
  }
  const admin = await isAdmin(c.uid);
  c.admin = admin;
  if (user.banned && !admin) return send(c.chat, `${E('no')} You are banned from using this bot.`);
  if ((await S()).maintenance === 'on' && !admin) return send(c.chat, `${E('warn')} The bot is under maintenance. Please try again later.`);

  if (cb) { tg('answerCallbackQuery', { callback_query_id: cb.id }); return onCallback(c, cb.data, user); }
  return onMessage(c, m, user);
}

// ---------------- main menu ----------------
function mainKb(admin) {
  const rows = [
    [B('Profile', 'profile', undefined, 'primary'), B('Get Service', 'service', undefined, 'success')],
    [B('Deposit', 'deposit', undefined, 'primary'), B('Refer', 'refer', undefined, 'primary')],
    [B('Support', 'support', undefined, 'primary'), B('Price & Info', 'price', undefined, 'primary')]
  ];
  if (admin) rows.push([B('Admin Panel', 'admin', undefined, 'danger')]);
  return rk(rows);
}
async function home(c) {
  await send(c.chat, `${E('bolt')} ${(await S()).welcome_text}`, mainKb(c.admin));
}

async function onMessage(c, m, user) {
  const t = (m.text || '').trim();
  if (t.startsWith('/')) {
    const cmd = t.split(/[ @]/)[0].toLowerCase();
    if (cmd === '/start') { await clearSt(c.uid); return home(c); }
    if (cmd === '/cancel') { await clearSt(c.uid); return send(c.chat, `${E('ok')} Cancelled.`, mainKb(c.admin)); }
    if (cmd === '/admin' && c.admin) { await clearSt(c.uid); return adminHome(c); }
  }
  const menu = { profile, getservice: getService, deposit: depositMenu, refer, support, priceinfo: priceMenu };
  const k = norm(t);
  if (menu[k]) { await clearSt(c.uid); return menu[k](c, user); }
  if (k === 'adminpanel' && c.admin) { await clearSt(c.uid); return adminHome(c); }
  const st = await getSt(c.uid);
  if (st) return onState(c, t, st, user);
  return send(c.chat, `${E('info')} Please use the menu buttons below.`, mainKb(c.admin));
}

// ---------------- user screens ----------------
async function profile(c, user) {
  user = await one('users', `id=eq.${c.uid}&select=*`);
  const txt = `${E('balance')} <b>User Profile</b>\n━━━━━━━━━━━━━━\n` +
    `${E('user')} Name: <b>${esc(user.name)}</b>\n${E('id')} User ID: <code>${user.id}</code>\n` +
    `${E('username')} Username: ${user.username ? '@' + esc(user.username) : '-'}\n━━━━━━━━━━━━━━\n` +
    `${E('balance')} Balance: <b>${money(user.balance)}</b>\n${E('spent')} Total Spent: <b>${money(user.spent)}</b>\n` +
    `${E('orders')} Total Orders: <b>${user.orders_count}</b>`;
  return show(c, txt, ik([[B('Track Orders', 'track', 'tr', 'success'), B('Invite Friends', 'invite', 'inv', 'success')], [B('Deposit', 'deposit', 'dep', 'success')]]));
}
async function getService(c) {
  const rows = [];
  for (let i = 0; i < PLATFORMS.length; i += 2)
    rows.push(PLATFORMS.slice(i, i + 2).map(([k, n]) => B(`${n} Service`, k, `p:${k}`, 'primary')));
  return show(c, `${E('service')} <b>Select Your Service</b>\n━━━━━━━━━━━━━━\n${E('ok')} Choose any platform service below`, ik(rows));
}
async function support(c) {
  const u = (await S()).support_username;
  const kb = u ? ik([[{ ...B('Contact Support', 'support', undefined, 'success'), url: `https://t.me/${u.replace('@', '')}` }]]) : undefined;
  return show(c, `${E('support')} <b>Support</b>\n━━━━━━━━━━━━━━\n${u ? 'Need help? Tap the button below to contact our support team.' : 'Support is not set yet. Please try again later.'}`, kb);
}
async function refer(c, user) {
  const s = await S();
  const [{ count }] = [{ count: (await q('users', `referred_by=eq.${c.uid}&select=id`)).length }];
  user = await one('users', `id=eq.${c.uid}&select=*`);
  const me = (await tg('getMe')).result.username;
  return show(c, `${E('refer')} <b>Refer & Earn</b>\n━━━━━━━━━━━━━━\nEarn <b>${s.ref_percent}%</b> of every deposit your friends make!\n\n` +
    `${E('link')} Your link:\n<code>https://t.me/${me}?start=ref_${c.uid}</code>\n\n` +
    `${E('users')} Referrals: <b>${count}</b>\n${E('gift')} Total earned: <b>${money(user.ref_earned)}</b>`, ik([[B('Back', 'back', 'home')]]));
}
async function priceMenu(c) {
  const rows = PLATFORMS.map(([k, n]) => [B(`${n} Service Price`, k, `pp:${k}`, 'success')]);
  rows.push([B('How to Order', 'service', 'ho', 'primary')], [B('How to Deposit', 'deposit', 'hd', 'primary')]);
  return show(c, `${E('price')} <b>Service Price Menu</b>\n\nSelect a category below.`, ik(rows));
}
async function depositMenu(c) {
  const pm = await q('payment_methods', 'active=eq.true&order=id&select=*');
  if (!pm.length) return show(c, `${E('warn')} No payment method is available right now.`, ik([[B('Back', 'back', 'home')]]));
  const s = await S();
  return show(c, `${E('deposit')} <b>Deposit</b>\n━━━━━━━━━━━━━━\nMinimum deposit: <b>${money(s.min_deposit)}</b>\nChoose a payment method:`,
    ik([...pm.map(p => [B(p.name, 'payment', `pm:${p.id}`, 'primary')]), [B('Back', 'back', 'home')]]));
}

// ---------------- user callbacks ----------------
async function onCallback(c, data, user) {
  const p = data.split(':');
  if (p[0] === 'a') { if (!c.admin) return; return adminCb(c, p); }
  switch (p[0]) {
    case 'home': await clearSt(c.uid); return show(c, `${E('bolt')} Main menu`, ik([[B('Get Service', 'service', 'gs', 'success'), B('Profile', 'profile', 'pf', 'primary')]]));
    case 'pf': return profile(c, user);
    case 'gs': return getService(c);
    case 'inv': return refer(c, user);
    case 'dep': return depositMenu(c);
    case 'pr': return priceMenu(c);
    case 'x': await clearSt(c.uid); return show(c, `${E('ok')} Cancelled.`);
    case 'ho': return show(c, `${E('service')} <b>How to Order</b>\n━━━━━━━━━━━━━━\n${(await S()).how_order}`, ik([[B('Back', 'back', 'pr')]]));
    case 'hd': return show(c, `${E('deposit')} <b>How to Deposit</b>\n━━━━━━━━━━━━━━\n${(await S()).how_deposit}`, ik([[B('Back', 'back', 'pr')]]));
    case 'pp': {
      const cats = await q('categories', `platform=eq.${p[1]}&active=eq.true&order=id&select=name,services(name,rate,min,max,active)`);
      let t = `${E(p[1])} <b>${PNAME[p[1]]} Service Price</b>\n━━━━━━━━━━━━━━\n`;
      for (const ct of cats) {
        const sv = ct.services.filter(x => x.active);
        if (!sv.length) continue;
        t += `\n<b>${esc(ct.name)}</b>\n` + sv.map(x => `• ${esc(x.name)}: <b>${money(x.rate)}</b> / 1000 (min ${x.min}, max ${x.max})`).join('\n') + '\n';
      }
      if (t.length < 120) t += '\nNo services available yet.';
      return show(c, t.slice(0, 4000), ik([[B('Back', 'back', 'pr')]]));
    }
    case 'p': { // platform -> categories
      const cats = await q('categories', `platform=eq.${p[1]}&active=eq.true&order=id&select=*`);
      const rows = cats.map(x => [B(x.name, 'category', `c:${x.id}`, 'primary')]);
      rows.push([B('Back', 'back', 'gs')]);
      return show(c, `${E(p[1])} <b>${PNAME[p[1]]}</b>\nChoose a category:`, ik(rows));
    }
    case 'c': { // category -> services
      const ct = await one('categories', `id=eq.${p[1]}&select=*`);
      const sv = await q('services', `category_id=eq.${p[1]}&active=eq.true&order=id&select=id,name,rate`);
      const rows = sv.map(x => [B(`${x.name} | ${money(x.rate)}/1K`, 'star', `s:${x.id}`, 'primary')]);
      rows.push([B('Back', 'back', `p:${ct.platform}`)]);
      return show(c, `${E('category')} <b>${esc(ct.name)}</b>\n${sv.length ? 'Choose a service:' : 'No services here yet.'}`, ik(rows));
    }
    case 's': { // service detail
      const s = await one('services', `id=eq.${p[1]}&select=*,categories(platform)`);
      if (!s) return;
      return show(c, `${E('star')} <b>${esc(s.name)}</b>\n━━━━━━━━━━━━━━\n${E('money')} Price: <b>${money(s.rate)}</b> / 1000\n${E('qty')} Min: <b>${s.min}</b>  |  Max: <b>${s.max}</b>\n` +
        (s.description ? `\n${esc(s.description)}\n` : ''),
        ik([[B('Order Now', 'service', `o:${s.id}`, 'success')], [B('Back', 'back', `c:${s.category_id}`)]]));
    }
    case 'o': {
      await setSt(c.uid, 'order_link', { sid: +p[1] });
      return show(c, `${E('link')} <b>Send your link</b>\nPaste the profile / post / channel link now.`, ik([[B('Cancel', 'no', 'x', 'danger')]]));
    }
    case 'oc': return placeOrder(c);
    case 'tr': {
      const o = await q('orders', `user_id=eq.${c.uid}&order=id.desc&limit=10&select=*`);
      const t = o.length ? o.map(x => `${ST[x.status] || '•'} <b>#${x.id}</b> ${esc(x.service_name)}\n    Qty: ${x.quantity} | ${money(x.charge)} | ${x.status}`).join('\n\n') : 'You have no orders yet.';
      return show(c, `${E('track')} <b>Your Last Orders</b>\n━━━━━━━━━━━━━━\n${t}`, ik([[B('Back', 'back', 'pf')]]));
    }
    case 'pm': {
      const pm = await one('payment_methods', `id=eq.${p[1]}&select=*`);
      await setSt(c.uid, 'dep_amount', { pm: pm.name });
      return show(c, `${E('payment')} <b>${esc(pm.name)}</b>\n━━━━━━━━━━━━━━\n${esc(pm.details)}\n\n${E('money')} Send the money, then type the <b>amount</b> you sent:`, ik([[B('Cancel', 'no', 'x', 'danger')]]));
    }
  }
}

// ---------------- conversation states ----------------
async function onState(c, t, st, user) {
  const d = st.data || {};
  const num = x => { const n = parseFloat(String(x).replace(/,/g, '')); return isFinite(n) ? n : NaN; };
  const cancelKb = ik([[B('Cancel', 'no', 'x', 'danger')]]);
  switch (st.state) {
    // ----- user order flow -----
    case 'order_link': {
      if (!/^(https?:\/\/|@)\S+/i.test(t)) return send(c.chat, `${E('warn')} Please send a valid link.`, cancelKb);
      await setSt(c.uid, 'order_qty', { ...d, link: t });
      const s = await one('services', `id=eq.${d.sid}&select=min,max`);
      return send(c.chat, `${E('qty')} <b>Send quantity</b>\nMin: ${s.min} | Max: ${s.max}`, cancelKb);
    }
    case 'order_qty': {
      const s = await one('services', `id=eq.${d.sid}&select=*`);
      const n = Math.floor(num(t));
      if (!(n >= s.min && n <= s.max)) return send(c.chat, `${E('warn')} Quantity must be between ${s.min} and ${s.max}.`, cancelKb);
      const charge = +(s.rate * n / 1000).toFixed(4);
      await setSt(c.uid, 'order_confirm', { ...d, qty: n });
      return send(c.chat, `${E('orders')} <b>Confirm Order</b>\n━━━━━━━━━━━━━━\nService: <b>${esc(s.name)}</b>\nLink: ${esc(d.link)}\nQuantity: <b>${n}</b>\nTotal: <b>${money(charge)}</b>\nYour balance: ${money(user.balance)}`,
        ik([[B('Confirm', 'ok', 'oc', 'success'), B('Cancel', 'no', 'x', 'danger')]]));
    }
    // ----- deposit flow -----
    case 'dep_amount': {
      const n = num(t), s = await S();
      if (!(n >= +s.min_deposit)) return send(c.chat, `${E('warn')} Minimum deposit is ${money(s.min_deposit)}. Send a valid amount.`, cancelKb);
      await setSt(c.uid, 'dep_trx', { ...d, amount: n });
      return send(c.chat, `${E('id')} Now send your <b>Transaction ID</b>:`, cancelKb);
    }
    case 'dep_trx': {
      const dep = await ins('deposits', { user_id: c.uid, method: d.pm, amount: d.amount, trx_id: t.slice(0, 80) });
      await clearSt(c.uid);
      await send(c.chat, `${E('wait')} <b>Deposit request #${dep.id} submitted!</b>\nAmount: ${money(d.amount)}\nYou will be notified after admin approval.`, mainKb(c.admin));
      return notifyAdmins(`${E('deposit')} <b>New Deposit #${dep.id}</b>\nUser: <a href="tg://user?id=${c.uid}">${esc(user.name)}</a> (<code>${c.uid}</code>)\nMethod: ${esc(d.pm)}\nAmount: <b>${money(d.amount)}</b>\nTrxID: <code>${esc(t)}</code>`,
        ik([[B('Approve', 'ok', `a:da:${dep.id}`, 'success'), B('Reject', 'no', `a:dr:${dep.id}`, 'danger')]]));
    }
  }
  if (!c.admin) return;
  return adminState(c, t, st, num);
}

async function placeOrder(c) {
  const st = await getSt(c.uid);
  if (!st || st.state !== 'order_confirm') return show(c, `${E('warn')} Session expired. Please start again.`);
  const d = st.data;
  await clearSt(c.uid);
  const s = await one('services', `id=eq.${d.sid}&select=*`);
  if (!s || !s.active) return show(c, `${E('warn')} This service is no longer available.`);
  const charge = +(s.rate * d.qty / 1000).toFixed(4);
  if (!(await rpc('spend', { uid: c.uid, amt: charge })))
    return show(c, `${E('warn')} <b>Insufficient balance.</b>\nPlease deposit first.`, ik([[B('Deposit', 'deposit', 'dep', 'success')]]));
  const o = await ins('orders', { user_id: c.uid, service_id: s.id, service_name: s.name, link: d.link, quantity: d.qty, charge, status: 'pending', provider_id: s.provider_id });
  if (s.provider_id && s.provider_service) {
    try {
      const pv = await one('providers', `id=eq.${s.provider_id}&select=*`);
      const r = await provider(pv, { action: 'add', service: s.provider_service, link: d.link, quantity: d.qty });
      if (!r.order) throw new Error(r.error || 'Provider error');
      await upd('orders', `id=eq.${o.id}`, { provider_order: String(r.order), status: 'processing' });
    } catch (e) {
      await rpc('refund', { uid: c.uid, amt: charge });
      await upd('orders', `id=eq.${o.id}`, { status: 'failed' });
      notifyAdmins(`${E('warn')} <b>Order #${o.id} failed</b> (user refunded)\n${esc(e.message)}`);
      return show(c, `${E('warn')} Sorry, the order could not be placed right now. Your balance was refunded. Please try again later.`);
    }
  } else {
    notifyAdmins(`${E('orders')} <b>New MANUAL order #${o.id}</b>\n${esc(s.name)}\nLink: ${esc(d.link)}\nQty: ${d.qty} | ${money(charge)}`,
      ik([[B('Open', 'orders', `a:ov:${o.id}`, 'primary')]]));
  }
  return show(c, `${E('ok')} <b>Order placed!</b>\n━━━━━━━━━━━━━━\nOrder ID: <b>#${o.id}</b>\nService: ${esc(s.name)}\nQuantity: ${d.qty}\nCharged: ${money(charge)}`,
    ik([[B('Track Orders', 'track', 'tr', 'success')]]));
}

async function provider(p, params) {
  const r = await fetch(p.api_url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ key: p.api_key, ...params }) });
  return r.json();
}

// ---------------- ADMIN PANEL ----------------
async function adminHome(c) {
  return show(c, `${E('admin')} <b>Admin Panel</b>\n━━━━━━━━━━━━━━\nControl everything from here.`, ik([
    [B('Statistics', 'stats', 'a:stats', 'primary'), B('Users', 'users', 'a:users', 'primary')],
    [B('Services', 'service', 'a:svc', 'primary'), B('Orders', 'orders', 'a:ord', 'primary')],
    [B('Deposits', 'deposit', 'a:dep', 'primary'), B('Payment Methods', 'payment', 'a:pay', 'primary')],
    [B('Providers (API)', 'provider', 'a:prov', 'primary'), B('Settings & Texts', 'settings', 'a:set', 'primary')],
    [B('Broadcast', 'broadcast', 'a:bc', 'primary'), B('Admins', 'admin', 'a:adm', 'primary')],
    [B('Help', 'help', 'a:help', 'success')]
  ]));
}
const AB = [B('Admin Panel', 'back', 'a:home')];

async function adminCb(c, p) {
  const [, act, x, y] = p;
  switch (act) {
    case 'home': await clearSt(c.uid); return adminHome(c);
    case 'help': return show(c, ADMIN_HELP, ik([AB]));
    case 'stats': {
      const [u, o, d, rev] = await Promise.all([q('users', 'select=id,balance'), q('orders', 'select=status,charge'), q('deposits', 'status=eq.pending&select=id'), q('deposits', 'status=eq.approved&select=amount')]);
      const cnt = s => o.filter(z => z.status === s).length;
      return show(c, `${E('stats')} <b>Statistics</b>\n━━━━━━━━━━━━━━\nUsers: <b>${u.length}</b>\nTotal user balance: <b>${money(u.reduce((a, z) => a + +z.balance, 0))}</b>\nTotal deposited: <b>${money(rev.reduce((a, z) => a + +z.amount, 0))}</b>\nSales: <b>${money(o.filter(z => !['canceled', 'failed'].includes(z.status)).reduce((a, z) => a + +z.charge, 0))}</b>\n\nOrders: ${o.length}\n⏳ Pending: ${cnt('pending')}  🔄 Processing: ${cnt('processing')}\n✅ Completed: ${cnt('completed')}  ❌ Canceled: ${cnt('canceled')}  ⚠️ Failed: ${cnt('failed')}\n\nPending deposits: <b>${d.length}</b>`, ik([AB]));
    }
    // ----- users -----
    case 'users': await setSt(c.uid, 'a_user_search'); return show(c, `${E('users')} <b>Users</b>\nSend a <b>User ID</b> or <b>@username</b> to find a user.`, ik([AB]));
    case 'u': return userView(c, x);
    case 'ub': { // balance / ban actions: a:ub:<id>:<op>
      if (y === 'ban') { const u = await one('users', `id=eq.${x}&select=banned`); await upd('users', `id=eq.${x}`, { banned: !u.banned }); return userView(c, x); }
      await setSt(c.uid, 'a_bal', { id: x, op: y });
      if (y === 'msg') return show(c, `${E('edit')} Send the message to deliver to this user:`, ik([[B('Cancel', 'no', `a:u:${x}`)]]));
      return show(c, `${E('money')} Send the amount to ${y === 'add' ? '<b>add to</b>' : '<b>deduct from</b>'} this user's balance:`, ik([[B('Cancel', 'no', `a:u:${x}`)]]));
    }
    // ----- services -----
    case 'svc': return show(c, `${E('service')} <b>Services</b>\nChoose a platform:`, ik([...PLATFORMS.map(([k, n]) => [B(n, k, `a:sp:${k}`, 'primary')]), AB]));
    case 'sp': {
      const cats = await q('categories', `platform=eq.${x}&order=id&select=*`);
      return show(c, `${E(x)} <b>${PNAME[x]}</b> categories`, ik([...cats.map(k => [B(`${k.active ? '' : '(off) '}${k.name}`, 'category', `a:sc:${k.id}`, 'primary')]), [B('Add Category', 'plus', `a:cadd:${x}`, 'success')], [B('Back', 'back', 'a:svc')]]));
    }
    case 'cadd': await setSt(c.uid, 'cat_add', { platform: x }); return show(c, `${E('plus')} Send the new <b>category name</b> (e.g. Followers):`, ik([[B('Cancel', 'no', `a:sp:${x}`)]]));
    case 'sc': {
      const ct = await one('categories', `id=eq.${x}&select=*`);
      const sv = await q('services', `category_id=eq.${x}&order=id&select=id,name,rate,active`);
      return show(c, `${E('category')} <b>${esc(ct.name)}</b> (${PNAME[ct.platform]})\nStatus: ${ct.active ? 'ON' : 'OFF'}`, ik([
        ...sv.map(s => [B(`${s.active ? '' : '(off) '}${s.name} | ${money(s.rate)}`, 'star', `a:sv:${s.id}`, 'primary')]),
        [B('Add Service', 'plus', `a:sadd:${x}`, 'success')],
        [B('Toggle ON/OFF', 'settings', `a:ct:${x}`), B('Delete', 'trash', `a:cd:${x}`, 'danger')],
        [B('Back', 'back', `a:sp:${ct.platform}`)]]));
    }
    case 'ct': { const k = await one('categories', `id=eq.${x}&select=active`); await upd('categories', `id=eq.${x}`, { active: !k.active }); return adminCb(c, ['a', 'sc', x]); }
    case 'cd': { const k = await one('categories', `id=eq.${x}&select=platform`); await del('categories', `id=eq.${x}`); return adminCb(c, ['a', 'sp', k.platform]); }
    case 'sadd': await setSt(c.uid, 'sv_name', { cat: +x }); return show(c, `${E('plus')} <b>Add Service (1/5)</b>\nSend the service <b>name</b>:`, ik([[B('Cancel', 'no', `a:sc:${x}`)]]));
    case 'sv': {
      const s = await one('services', `id=eq.${x}&select=*`);
      const pv = s.provider_id ? `Provider #${s.provider_id} / service ${s.provider_service}` : 'Manual (no API)';
      return show(c, `${E('star')} <b>${esc(s.name)}</b>\nID: ${s.id}\nPrice/1000: <b>${money(s.rate)}</b>\nMin: ${s.min} | Max: ${s.max}\nOrder type: ${esc(pv)}\nDescription: ${esc(s.description || '-')}\nStatus: ${s.active ? 'ON' : 'OFF'}`, ik([
        [B('Name', 'edit', `a:se:${x}:name`), B('Price', 'edit', `a:se:${x}:rate`)],
        [B('Min', 'edit', `a:se:${x}:min`), B('Max', 'edit', `a:se:${x}:max`)],
        [B('Provider', 'provider', `a:se:${x}:prov`), B('Description', 'edit', `a:se:${x}:description`)],
        [B('Toggle ON/OFF', 'settings', `a:st:${x}`), B('Delete', 'trash', `a:sd:${x}`, 'danger')],
        [B('Back', 'back', `a:sc:${s.category_id}`)]]));
    }
    case 'se': await setSt(c.uid, 'sv_edit', { id: x, field: y }); return show(c, `${E('edit')} Send the new value for <b>${y}</b>${y === 'prov' ? '\n\nFormat: <code>providerId serviceId</code>  (example: <code>1 2045</code>)\nSend <code>0</code> for manual orders.' : ''}${y === 'rate' ? '\n(price per 1000)' : ''}`, ik([[B('Cancel', 'no', `a:sv:${x}`)]]));
    case 'st': { const s = await one('services', `id=eq.${x}&select=active`); await upd('services', `id=eq.${x}`, { active: !s.active }); return adminCb(c, ['a', 'sv', x]); }
    case 'sd': { const s = await one('services', `id=eq.${x}&select=category_id`); await del('services', `id=eq.${x}`); return adminCb(c, ['a', 'sc', s.category_id]); }
    // ----- orders -----
    case 'ord': {
      const rows = ['pending', 'processing', 'completed', 'canceled', 'failed'].map(s => [B(`${s[0].toUpperCase() + s.slice(1)} orders`, 'orders', `a:ol:${s}`, 'primary')]);
      return show(c, `${E('orders')} <b>Orders</b>\nChoose a status:`, ik([...rows, [B('Find by Order ID', 'users', 'a:of')], AB]));
    }
    case 'of': await setSt(c.uid, 'a_order_find'); return show(c, 'Send the order ID:', ik([[B('Cancel', 'no', 'a:ord')]]));
    case 'ol': {
      const o = await q('orders', `status=eq.${x}&order=id.desc&limit=15&select=id,service_name,quantity,charge`);
      return show(c, `${E('orders')} <b>${x} orders</b> (latest 15)`, ik([...o.map(z => [B(`#${z.id} ${z.service_name} x${z.quantity}`, 'orders', `a:ov:${z.id}`, 'primary')]), [B('Back', 'back', 'a:ord')]]));
    }
    case 'ov': return orderView(c, x);
    case 'os': await setOrderStatus(x, y); return orderView(c, x);
    // ----- deposits -----
    case 'dep': {
      const d = await q('deposits', 'status=eq.pending&order=id&limit=20&select=*');
      return show(c, `${E('deposit')} <b>Pending deposits</b> (${d.length})`, ik([...d.map(z => [B(`#${z.id} | ${money(z.amount)} | ${z.method}`, 'money', `a:dv:${z.id}`, 'primary')]), AB]));
    }
    case 'dv': {
      const d = await one('deposits', `id=eq.${x}&select=*`);
      return show(c, `${E('deposit')} <b>Deposit #${d.id}</b>\nUser: <code>${d.user_id}</code>\nMethod: ${esc(d.method)}\nAmount: <b>${money(d.amount)}</b>\nTrxID: <code>${esc(d.trx_id)}</code>\nStatus: ${d.status}`,
        ik(d.status === 'pending' ? [[B('Approve', 'ok', `a:da:${d.id}`, 'success'), B('Reject', 'no', `a:dr:${d.id}`, 'danger')], [B('Back', 'back', 'a:dep')]] : [[B('Back', 'back', 'a:dep')]]));
    }
    case 'da': case 'dr': {
      const d = await one('deposits', `id=eq.${x}&select=*`);
      if (d.status !== 'pending') return show(c, `${E('info')} Deposit #${x} is already ${d.status}.`, ik([[B('Back', 'back', 'a:dep')]]));
      if (act === 'da') {
        await upd('deposits', `id=eq.${x}`, { status: 'approved' });
        await rpc('add_balance', { uid: d.user_id, amt: d.amount });
        send(d.user_id, `${E('ok')} <b>Deposit approved!</b>\n${money(d.amount)} has been added to your balance.`).catch(() => { });
        const u = await one('users', `id=eq.${d.user_id}&select=referred_by`);
        const pct = +(await S()).ref_percent;
        if (u?.referred_by && pct > 0) {
          const bonus = +(d.amount * pct / 100).toFixed(2);
          await rpc('add_balance', { uid: u.referred_by, amt: bonus });
          const r = await one('users', `id=eq.${u.referred_by}&select=ref_earned`);
          await upd('users', `id=eq.${u.referred_by}`, { ref_earned: +r.ref_earned + bonus });
          send(u.referred_by, `${E('gift')} Referral bonus <b>${money(bonus)}</b> received!`).catch(() => { });
        }
      } else {
        await upd('deposits', `id=eq.${x}`, { status: 'rejected' });
        send(d.user_id, `${E('no')} <b>Deposit #${x} was rejected.</b>\nContact support if you think this is a mistake.`).catch(() => { });
      }
      return show(c, `${E('ok')} Deposit #${x} ${act === 'da' ? 'approved' : 'rejected'}.`, ik([[B('Pending deposits', 'deposit', 'a:dep')], AB]));
    }
    // ----- payment methods -----
    case 'pay': {
      const pm = await q('payment_methods', 'order=id&select=*');
      return show(c, `${E('payment')} <b>Payment Methods</b>`, ik([...pm.map(z => [B(`${z.active ? '' : '(off) '}${z.name}`, 'payment', `a:pv:${z.id}`, 'primary')]), [B('Add Method', 'plus', 'a:padd', 'success')], AB]));
    }
    case 'pv': {
      const z = await one('payment_methods', `id=eq.${x}&select=*`);
      return show(c, `${E('payment')} <b>${esc(z.name)}</b>\n${esc(z.details)}\nStatus: ${z.active ? 'ON' : 'OFF'}`, ik([[B('Toggle ON/OFF', 'settings', `a:pt:${x}`), B('Delete', 'trash', `a:pd:${x}`, 'danger')], [B('Back', 'back', 'a:pay')]]));
    }
    case 'pt': { const z = await one('payment_methods', `id=eq.${x}&select=active`); await upd('payment_methods', `id=eq.${x}`, { active: !z.active }); return adminCb(c, ['a', 'pv', x]); }
    case 'pd': await del('payment_methods', `id=eq.${x}`); return adminCb(c, ['a', 'pay']);
    case 'padd': await setSt(c.uid, 'pm_name'); return show(c, `${E('plus')} Send the method <b>name</b> (e.g. bKash):`, ik([[B('Cancel', 'no', 'a:pay')]]));
    // ----- providers -----
    case 'prov': {
      const pv = await q('providers', 'order=id&select=id,name');
      return show(c, `${E('provider')} <b>Providers (SMM panel APIs)</b>`, ik([...pv.map(z => [B(`#${z.id} ${z.name}`, 'provider', `a:pw:${z.id}`, 'primary')]), [B('Add Provider', 'plus', 'a:vadd', 'success')], AB]));
    }
    case 'pw': {
      const z = await one('providers', `id=eq.${x}&select=*`);
      return show(c, `${E('provider')} <b>#${z.id} ${esc(z.name)}</b>\nAPI: ${esc(z.api_url)}`, ik([[B('Check Balance', 'money', `a:pb:${x}`, 'success'), B('Delete', 'trash', `a:pdel:${x}`, 'danger')], [B('Back', 'back', 'a:prov')]]));
    }
    case 'pb': {
      const z = await one('providers', `id=eq.${x}&select=*`);
      const r = await provider(z, { action: 'balance' }).catch(e => ({ error: e.message }));
      return show(c, `${E('money')} Provider balance: <b>${esc(r.balance ?? r.error)} ${esc(r.currency || '')}</b>`, ik([[B('Back', 'back', `a:pw:${x}`)]]));
    }
    case 'pdel': await del('providers', `id=eq.${x}`); return adminCb(c, ['a', 'prov']);
    case 'vadd': await setSt(c.uid, 'pv_name'); return show(c, `${E('plus')} Send a <b>name</b> for the provider:`, ik([[B('Cancel', 'no', 'a:prov')]]));
    // ----- settings -----
    case 'set': {
      const s = await S();
      return show(c, `${E('settings')} <b>Settings & Texts</b>\nTap an item to edit it.`, ik([...Object.entries(SETKEYS).map(([k, n]) => [B(`${n}`, 'edit', `a:sk:${k}`, 'primary')]), AB]));
    }
    case 'sk': {
      const s = await S();
      await setSt(c.uid, 'set_val', { key: x });
      return show(c, `${E('edit')} <b>${SETKEYS[x]}</b>\n\nCurrent:\n<code>${esc(s[x]) || '-'}</code>\n\nSend the new value (HTML like &lt;b&gt;bold&lt;/b&gt; is allowed in texts):`, ik([[B('Cancel', 'no', 'a:set')]]));
    }
    // ----- broadcast -----
    case 'bc': await setSt(c.uid, 'bc_text'); return show(c, `${E('broadcast')} <b>Broadcast</b>\nSend the message to deliver to ALL users (HTML allowed):`, ik([AB]));
    case 'bcs': {
      const st = await getSt(c.uid);
      if (st?.state !== 'bc_confirm') return;
      await ins('broadcasts', { text: st.data.text });
      await clearSt(c.uid);
      return show(c, `${E('ok')} Broadcast started. It is sent in the background (about 30 users per minute).`, ik([AB]));
    }
    // ----- admins -----
    case 'adm': {
      const r = await q('admins', 'select=id');
      return show(c, `${E('admin')} <b>Admins</b>\nOwner: <code>${ENV.OWNER_ID}</code>\n${r.map(z => `• <code>${z.id}</code>`).join('\n') || 'No extra admins.'}`,
        ik(isOwner(c.uid) ? [[B('Add Admin', 'plus', 'a:aadd', 'success')], ...r.map(z => [B(`Remove ${z.id}`, 'trash', `a:arem:${z.id}`, 'danger')]), AB] : [AB]));
    }
    case 'aadd': if (!isOwner(c.uid)) return; await setSt(c.uid, 'adm_add'); return show(c, 'Send the new admin\'s Telegram User ID:', ik([[B('Cancel', 'no', 'a:adm')]]));
    case 'arem': if (!isOwner(c.uid)) return; await del('admins', `id=eq.${x}`); return adminCb(c, ['a', 'adm']);
  }
}

async function userView(c, id) {
  const u = await one('users', `id=eq.${id}&select=*`);
  if (!u) return show(c, 'User not found.', ik([AB]));
  return show(c, `${E('user')} <b>${esc(u.name)}</b>\nID: <code>${u.id}</code>\nUsername: ${u.username ? '@' + esc(u.username) : '-'}\nBalance: <b>${money(u.balance)}</b>\nSpent: ${money(u.spent)} | Orders: ${u.orders_count}\nReferred by: ${u.referred_by || '-'}\nBanned: <b>${u.banned ? 'YES' : 'no'}</b>`, ik([
    [B('Add Balance', 'plus', `a:ub:${id}:add`, 'success'), B('Deduct', 'no', `a:ub:${id}:sub`, 'danger')],
    [B(u.banned ? 'Unban' : 'Ban', 'warn', `a:ub:${id}:ban`, 'danger'), B('Message', 'support', `a:ub:${id}:msg`, 'primary')],
    AB]));
}
async function orderView(c, id) {
  const o = await one('orders', `id=eq.${id}&select=*`);
  if (!o) return show(c, 'Order not found.', ik([AB]));
  return show(c, `${E('orders')} <b>Order #${o.id}</b> ${ST[o.status] || ''} ${o.status}\nUser: <code>${o.user_id}</code>\nService: ${esc(o.service_name)}\nLink: ${esc(o.link)}\nQty: ${o.quantity} | ${money(o.charge)}\nProvider order: ${o.provider_order || '-'}`, ik([
    [B('Processing', 'wait', `a:os:${id}:processing`), B('Completed', 'ok', `a:os:${id}:completed`, 'success')],
    [B('Cancel + Refund', 'no', `a:os:${id}:canceled`, 'danger')], [B('Back', 'back', `a:ol:${o.status}`)]]));
}
async function setOrderStatus(id, status) {
  const o = await one('orders', `id=eq.${id}&select=*`);
  if (!o || o.status === status) return;
  const dead = ['canceled', 'failed'];
  if (dead.includes(status) && !dead.includes(o.status)) await rpc('refund', { uid: o.user_id, amt: o.charge });
  if (!dead.includes(status) && dead.includes(o.status)) await rpc('spend', { uid: o.user_id, amt: o.charge }); // un-refund
  await upd('orders', `id=eq.${id}`, { status });
  const msg = { completed: `${E('ok')} <b>Order #${id} completed!</b>`, canceled: `${E('no')} <b>Order #${id} was canceled</b> and ${money(o.charge)} was refunded.`, processing: `${E('wait')} Order #${id} is now processing.` }[status];
  if (msg) send(o.user_id, msg).catch(() => { });
}

// ---------------- admin conversation states ----------------
async function adminState(c, t, st, num) {
  const d = st.data || {}, ok = m => send(c.chat, `${E('ok')} ${m}`, ik([AB]));
  const bad = m => send(c.chat, `${E('warn')} ${m}`);
  switch (st.state) {
    case 'a_user_search': {
      const u = /^\d+$/.test(t) ? await one('users', `id=eq.${t}&select=id`) : await one('users', `username=ilike.${encodeURIComponent(t.replace('@', ''))}&select=id`);
      if (!u) return bad('User not found. Try again.');
      await clearSt(c.uid);
      return userView({ ...c, mid: null }, u.id);
    }
    case 'a_bal': {
      await clearSt(c.uid);
      if (d.op === 'msg') { const r = await send(d.id, t); return ok(r.ok ? 'Message sent.' : 'Could not deliver (user blocked the bot).'); }
      const n = num(t); if (!(n > 0)) return bad('Send a valid positive number.');
      const nb = await rpc('add_balance', { uid: d.id, amt: d.op === 'add' ? n : -n });
      send(d.id, `${E('money')} Your balance was ${d.op === 'add' ? 'increased' : 'decreased'} by <b>${money(n)}</b>.\nNew balance: <b>${money(nb)}</b>`).catch(() => { });
      return ok(`Done. New balance: ${money(nb)}`);
    }
    case 'a_order_find': { await clearSt(c.uid); return orderView({ ...c, mid: null }, parseInt(t)); }
    case 'cat_add': await ins('categories', { platform: d.platform, name: t }); await clearSt(c.uid); return ok('Category added.');
    case 'sv_name': await setSt(c.uid, 'sv_rate', { ...d, name: t }); return send(c.chat, `<b>Add Service (2/5)</b>\nSend the <b>price per 1000</b> (number):`);
    case 'sv_rate': { const n = num(t); if (!(n >= 0)) return bad('Send a number.'); await setSt(c.uid, 'sv_min', { ...d, rate: n }); return send(c.chat, '<b>Add Service (3/5)</b>\nSend the <b>minimum</b> quantity:'); }
    case 'sv_min': { const n = parseInt(t); if (!(n > 0)) return bad('Send a number.'); await setSt(c.uid, 'sv_max', { ...d, min: n }); return send(c.chat, '<b>Add Service (4/5)</b>\nSend the <b>maximum</b> quantity:'); }
    case 'sv_max': { const n = parseInt(t); if (!(n >= d.min)) return bad('Max must be >= min.'); await setSt(c.uid, 'sv_prov', { ...d, max: n }); return send(c.chat, '<b>Add Service (5/5)</b>\nSend <code>providerId serviceId</code> (example <code>1 2045</code>) for API orders, or <code>0</code> for manual orders:'); }
    case 'sv_prov': {
      const [pid, sid] = t.split(/\s+/);
      await ins('services', { category_id: d.cat, name: d.name, rate: d.rate, min: d.min, max: d.max, provider_id: +pid > 0 ? +pid : null, provider_service: +pid > 0 ? sid : null });
      await clearSt(c.uid); return ok('Service added.');
    }
    case 'sv_edit': {
      let patch = {};
      if (d.field === 'rate') { const n = num(t); if (!(n >= 0)) return bad('Send a number.'); patch.rate = n; }
      else if (d.field === 'min' || d.field === 'max') { const n = parseInt(t); if (!(n > 0)) return bad('Send a number.'); patch[d.field] = n; }
      else if (d.field === 'prov') { const [pid, sid] = t.split(/\s+/); patch = +pid > 0 ? { provider_id: +pid, provider_service: sid } : { provider_id: null, provider_service: null }; }
      else patch[d.field] = t;
      await upd('services', `id=eq.${d.id}`, patch); await clearSt(c.uid); return ok('Service updated.');
    }
    case 'pm_name': await setSt(c.uid, 'pm_det', { name: t }); return send(c.chat, 'Now send the <b>payment details</b> (number, instructions...):');
    case 'pm_det': await ins('payment_methods', { name: d.name, details: t }); await clearSt(c.uid); return ok('Payment method added.');
    case 'pv_name': await setSt(c.uid, 'pv_url', { name: t }); return send(c.chat, 'Send the provider <b>API URL</b> (example https://yourpanel.com/api/v2):');
    case 'pv_url': await setSt(c.uid, 'pv_key', { ...d, url: t }); return send(c.chat, 'Send the provider <b>API key</b>:');
    case 'pv_key': { const r = await ins('providers', { name: d.name, api_url: d.url, api_key: t }); await clearSt(c.uid); return ok(`Provider added with ID <b>${r.id}</b>.`); }
    case 'set_val': await upsert('settings', { key: d.key, value: t }, 'key'); await clearSt(c.uid); return ok('Saved.');
    case 'bc_text': await setSt(c.uid, 'bc_confirm', { text: t }); return send(c.chat, `${E('broadcast')} <b>Preview:</b>\n\n${t}`, ik([[B('Send to all', 'ok', 'a:bcs', 'success'), B('Cancel', 'no', 'a:home', 'danger')]]));
    case 'adm_add': { if (!isOwner(c.uid) || !/^\d+$/.test(t)) return bad('Send a numeric Telegram ID.'); await upsert('admins', { id: +t }, 'id'); await clearSt(c.uid); return ok('Admin added.'); }
  }
}

// ---------------- background jobs (cron every minute) ----------------
async function cron() {
  const min = new Date().getUTCMinutes();
  if (min % 5 === 0) return syncOrders();
  return runBroadcast();
}
async function runBroadcast() {
  const b = await one('broadcasts', 'status=eq.running&order=id&select=*');
  if (!b) return;
  const users = await q('users', `id=gt.${b.last_id}&order=id&limit=30&select=id`);
  let sent = b.sent;
  for (const u of users) { const r = await send(u.id, b.text); if (r.ok) sent++; }
  const last = users.length ? users[users.length - 1].id : b.last_id;
  const done = users.length < 30;
  await upd('broadcasts', `id=eq.${b.id}`, { last_id: last, sent, status: done ? 'done' : 'running' });
  if (done) send(ENV.OWNER_ID, `${E('ok')} Broadcast #${b.id} finished. Delivered to ${sent} users.`).catch(() => { });
}
async function syncOrders() {
  const orders = await q('orders', 'status=eq.processing&provider_order=not.is.null&order=id&limit=12&select=*');
  const byProv = {};
  orders.forEach(o => (byProv[o.provider_id] ||= []).push(o));
  for (const [pid, list] of Object.entries(byProv)) {
    const pv = await one('providers', `id=eq.${pid}&select=*`);
    if (!pv) continue;
    const res = await provider(pv, { action: 'orders', orders: list.map(o => o.provider_order).join(',') }).catch(() => null);
    if (!res) continue;
    for (const o of list) {
      const s = String(res[o.provider_order]?.status || '').toLowerCase();
      if (s === 'completed' || s === 'partial') await setOrderStatus(o.id, 'completed');
      else if (s === 'canceled' || s === 'cancelled' || s === 'refunded') await setOrderStatus(o.id, 'canceled');
    }
  }
}

// ---------------- Admin Help (Bangla) ----------------
const ADMIN_HELP = `<b>❓ Admin Help (বাংলায়)</b>
━━━━━━━━━━━━━━
<b>📊 Statistics:</b> মোট ইউজার, সেলস, ডিপোজিট ও অর্ডারের হিসাব দেখা যায়।

<b>👥 Users:</b> User ID অথবা @username দিয়ে ইউজার খুঁজুন। সেখান থেকে ব্যালেন্স Add/Deduct, Ban/Unban এবং সরাসরি মেসেজ পাঠানো যায়।

<b>🛒 Services:</b> প্ল্যাটফর্ম → Category → Service এভাবে সাজানো। নতুন Category ও Service Add করা যায়, দাম/Min/Max/নাম/ডেসক্রিপশন Edit করা যায়, ON/OFF বা Delete করা যায়। Price হলো প্রতি ১০০০ এর দাম।

<b>🔌 Providers (API):</b> আপনার SMM প্যানেলের API URL ও Key দিয়ে Provider যোগ করুন। Provider যোগ করলে একটি ID পাবেন (যেমন 1)। Service Add করার সময় <code>1 2045</code> লিখলে অর্ডার অটো ওই প্যানেলে চলে যাবে (2045 = প্যানেলের service id)। <code>0</code> লিখলে অর্ডার Manual হবে এবং আপনি নিজে Orders থেকে Completed/Cancel করবেন।

<b>📦 Orders:</b> স্ট্যাটাস অনুযায়ী অর্ডার দেখুন। Cancel + Refund চাপলে ইউজার ব্যালেন্স ফেরত পাবে। API অর্ডারের স্ট্যাটাস প্রতি ৫ মিনিটে অটো আপডেট হয়।

<b>💳 Deposits:</b> ইউজার ডিপোজিট রিকোয়েস্ট করলে আপনি নোটিফিকেশন পাবেন। Approve করলে ব্যালেন্স অটো যোগ হবে এবং Referral বোনাস চলে যাবে। Reject করলে ইউজারকে জানানো হবে।

<b>💳 Payment Methods:</b> bKash/Nagad ইত্যাদির নাম ও নাম্বার/নির্দেশনা এখান থেকে যোগ, ON/OFF বা Delete করুন।

<b>⚙️ Settings & Texts:</b> Welcome text, Support username, How to Order/Deposit টেক্সট, Referral %, Minimum Deposit, Maintenance mode (on/off) এখান থেকেই বদলান। কোড চেঞ্জ করা লাগবে না।

<b>📢 Broadcast:</b> সব ইউজারকে মেসেজ পাঠান। ব্যাকগ্রাউন্ডে প্রতি মিনিটে প্রায় ৩০ জনকে যায়, শেষ হলে Owner কে জানানো হয়।

<b>🛠 Admins:</b> শুধু Owner নতুন Admin যোগ বা বাদ দিতে পারবেন।

<b>টিপস:</b> কোনো কাজ মাঝপথে বাতিল করতে /cancel লিখুন। Admin Panel খুলতে /admin লিখুন।`;
