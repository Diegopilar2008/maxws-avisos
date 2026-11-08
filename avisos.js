// MAXWS · robô de notificações
// Roda no GitHub a cada 5 minutos: procura quem tem lembrete agora e manda a notificação pelo Firebase.
'use strict';

const STEP = 5 * 60000;          // fatias de 5 minutos
const MAX_ATRASO = 45 * 60000;   // se o GitHub atrasar, ainda manda avisos de até 45 min atrás
const URL = 'https://max-ws.web.app/';
const TOKEN_RUIM = /registration-token-not-registered|invalid-registration-token|invalid-argument|mismatched-credential/;

const slotOf = t => Math.floor((t % 864e5) / STEP);  // 0..287, em UTC (igual ao app)
function diaLocal(tz, t) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  } catch (e) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  }
}

async function enviar({ fcm, db, FieldValue }, uid, tokens, title, body, tag) {
  if (!tokens.length) return 0;
  const r = await fcm.sendEachForMulticast({
    tokens,
    webpush: {
      notification: { title, body, icon: URL + 'icon-192.png', badge: URL + 'icon-192.png', tag, renotify: true },
      fcmOptions: { link: URL }
    }
  });
  const ruins = [];
  (r.responses || []).forEach((x, i) => { if (!x.success && TOKEN_RUIM.test(String(x.error && x.error.code))) ruins.push(tokens[i]); });
  if (ruins.length) {
    await db.doc('push/' + uid).set({ tk: FieldValue.arrayRemove(...ruins) }, { merge: true });
    ruins.forEach(t => { const i = tokens.indexOf(t); if (i >= 0) tokens.splice(i, 1); });
  }
  return r.successCount || 0;
}

async function run(deps) {
  const { db } = deps;
  const now = deps.now || Date.now();
  const metaRef = db.doc('meta/avisos');
  const ms = await metaRef.get();
  const meta = (ms.exists && ms.data()) || {};
  const atual = Math.floor(now / STEP) * STEP;
  let ultimo = typeof meta.ate === 'number' ? meta.ate : atual - STEP;
  if (atual - ultimo > MAX_ATRASO) ultimo = atual - MAX_ATRASO;
  const slots = [];
  for (let t = ultimo + STEP; t <= atual; t += STEP) slots.push(slotOf(t));
  let enviados = 0, lidos = 0;

  // 1) lembretes dos hábitos e aviso das 20h
  if (slots.length) {
    const q = await db.collection('push').where('sl', 'array-contains-any', slots.slice(-30)).get();
    for (const d of q.docs) {
      const p = d.data() || {}, uid = d.id, tokens = (p.tk || []).filter(Boolean);
      const itens = (p.it || []).filter(x => slots.includes(x.s));
      if (!tokens.length || !itens.length) continue;
      const us = await db.doc('users/' + uid).get(); lidos++;
      if (!us.exists) continue;
      const S = us.data() || {}, hoje = diaLocal(p.tz, now), feitos = (S.logs || {})[hoje] || [], habs = S.habits || [];
      const pend = habs.filter(h => !feitos.includes(h.id) && (!h.c || h.c <= hoje));
      for (const it of itens) {
        try {
          if (it.id === '_dia') {
            if (!pend.length) continue;
            const n = pend.length;
            enviados += await enviar(deps, uid, tokens, '🔥 Ainda dá tempo!', (n === 1 ? 'Falta 1 hábito' : `Faltam ${n} hábitos`) + ' hoje. Não quebre sua sequência!', 'maxws-dia');
          } else {
            const h = habs.find(x => String(x.id) === String(it.id));
            if (!h || feitos.includes(h.id)) continue;
            enviados += await enviar(deps, uid, tokens, '⏰ ' + (h.e ? h.e + ' ' : '') + h.n, 'Hora do seu hábito! Toque para marcar como feito.', 'maxws-' + h.id);
          }
        } catch (e) { console.log('falha ao enviar para', uid, e && e.message); }
      }
    }
  }

  // 2) aviso para o dono quando alguém se cadastra
  let sg = typeof meta.sg === 'number' ? meta.sg : now;
  if (typeof meta.sg === 'number') {
    const novos = await db.collection('signups').where('t', '>', meta.sg).get();
    if (novos.docs.length) {
      sg = Math.max(sg, ...novos.docs.map(x => +(x.data() || {}).t || 0));
      const dq = await db.collection('premium').where('plan', '==', 'dono').limit(1).get();
      const dono = dq.docs[0] && dq.docs[0].id;
      const pd = dono ? await db.doc('push/' + dono).get() : null;
      const tokens = ((pd && pd.exists && pd.data().tk) || []).filter(Boolean);
      if (tokens.length) {
        const nomes = novos.docs.map(x => String((x.data() || {}).name || 'Alguém').slice(0, 30));
        const title = novos.docs.length === 1 ? '🆕 ' + nomes[0] + ' se cadastrou no MAXWS' : '🆕 ' + novos.docs.length + ' pessoas se cadastraram no MAXWS';
        try { enviados += await enviar(deps, dono, tokens, title, 'Toque para ver no painel do dono.', 'maxws-cadastro'); } catch (e) { console.log('falha aviso dono', e && e.message); }
      }
    }
  }

  await metaRef.set({ ate: atual, sg, t: now, n: enviados }, { merge: true });
  console.log(`MAXWS: fatias ${slots.length}, contas lidas ${lidos}, notificações enviadas ${enviados}`);
  return { slots, enviados, lidos, ate: atual, sg };
}

module.exports = { run, slotOf, diaLocal };

if (require.main === module) {
  const { initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const { getMessaging } = require('firebase-admin/messaging');
  if (!process.env.FIREBASE_SA) { console.error('Falta o segredo FIREBASE_SA no GitHub.'); process.exit(1); }
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SA)) });
  run({ db: getFirestore(), fcm: getMessaging(), FieldValue })
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}
