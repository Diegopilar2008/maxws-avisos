// MAXWS · robô de notificações
// Roda no GitHub a cada 5 minutos: procura quem tem lembrete agora e manda a notificação pelo Firebase.
'use strict';

const STEP = 5 * 60000;          // fatias de 5 minutos
const MAX_ATRASO = 45 * 60000;   // se o GitHub atrasar, ainda manda avisos de até 45 min atrás
const URL = 'https://max-ws.web.app/';
const TOKEN_RUIM = /registration-token-not-registered|invalid-registration-token|invalid-argument|mismatched-credential/;

const slotOf = t => Math.floor((t % 864e5) / STEP);  // 0..287, em UTC (igual ao app)

// frases das mensagens do dia (uma diferente por dia, para cada período)
const FRASES = {
  bd: [
    'Disciplina é escolher o que você quer mais, não o que quer agora.',
    'Pequenos passos todos os dias vencem grandes planos adiados.',
    'Hoje é um bom dia para cumprir o que você prometeu a si mesmo.',
    'Comece pelo mais simples. O resto vem no embalo.',
    'Seu eu do futuro agradece cada hábito de hoje.',
    'Não espere vontade. Comece e a vontade aparece.',
    'Um dia de cada vez, um hábito de cada vez.',
    'Acordar e cumprir: é assim que se constrói uma vida nova.',
    'Quem se supera hoje domina o amanhã.',
    'A sua sequência começa com a primeira coisa que você faz hoje.',
    'Constância é o superpoder de quem não desiste.',
    'O dia é seu. Faça ele valer a pena.',
    'Você não precisa ser o melhor, precisa ser melhor que ontem.',
    'Levanta, faz e confia no processo.'
  ],
  bt: [
    'Metade do dia já foi. A outra metade é a sua chance.',
    'Ainda dá tempo de fazer o dia de hoje contar.',
    'Consistência supera intensidade.',
    'Não precisa ser perfeito, precisa ser constante.',
    'Pausa rápida, respira e volta com tudo.',
    'Cada hábito concluído é um tijolo na sua nova versão.',
    'Foco no processo. O resultado vem.',
    'Feito é melhor que perfeito.',
    'A tarde também é lugar de vitória.',
    'Quem continua quando cansa é quem chega lá.',
    'Seu objetivo não tira folga. Nem você.',
    'Mais um passo agora vale mais que dez amanhã.',
    'Ninguém vê o esforço de hoje, mas todo mundo vê o resultado depois.',
    'Termine o que começou. Você consegue.'
  ],
  bn: [
    'Descansar também faz parte da evolução.',
    'Amanhã é uma nova chance de ser constante.',
    'Orgulhe-se de cada passo dado hoje.',
    'O sono de quem cumpriu o dia é o melhor sono.',
    'Errou hoje? Amanhã você recomeça mais forte.',
    'Cada dia cumprido é um degrau a mais.',
    'Desligue a tela, recarregue as energias e volte com tudo.',
    'A disciplina de hoje é a liberdade de amanhã.',
    'Você é feito do que repete todos os dias.',
    'Agradeça pelo dia e prepare o de amanhã.',
    'Grandes mudanças são feitas de dias comuns bem vividos.',
    'Boa noite. Amanhã a sequência continua.',
    'Quem planeja a noite ganha a manhã.',
    'Você foi mais longe hoje do que imagina.'
  ]
};
const fraseDo = (tipo, hoje) => {
  const L = FRASES[tipo], [y, m, d] = hoje.split('-').map(Number);
  return L[Math.floor(Date.UTC(y, m - 1, d) / 864e5) % L.length];
};
const primeiroNome = n => String(n || '').trim().split(/\s+/)[0].slice(0, 20);

// texto das mensagens de bom dia, boa tarde e boa noite
function saudacao(id, S, hoje, feitosN, total) {
  const nome = primeiroNome(S.name), oi = nome ? ', ' + nome : '';
  if (id === '_bd') {
    return {
      title: '☀️ Bom dia' + oi + '! Bora evoluir 💪',
      body: (total ? `Hoje são ${total} ${total === 1 ? 'hábito' : 'hábitos'} te esperando. ` : '') + fraseDo('bd', hoje)
    };
  }
  if (id === '_bt') {
    const st = !total ? '' : feitosN >= total ? `Você já fez todos os ${total} hábitos de hoje! 🏆 ` : `Você já fez ${feitosN} de ${total} hábitos. Bora completar! `;
    return { title: '🌤️ Boa tarde' + oi + '!', body: st + fraseDo('bt', hoje) };
  }
  const st = !total ? '' : feitosN >= total ? `Dia completo: ${total} de ${total} hábitos! 🔥 ` : `Hoje você fez ${feitosN} de ${total} hábitos. `;
  return { title: '🌙 Boa noite' + oi + '!', body: st + fraseDo('bn', hoje) };
}

// aviso para quem não abriu o app no dia (null = abriu hoje, não manda)
function sumiu(S, hoje, tz, now) {
  if (S.vis && diaLocal(tz, S.vis) === hoje) return null;
  const nome = primeiroNome(S.name), dias = S.vis ? Math.floor((now - S.vis) / 864e5) : 0;
  return {
    title: '📲 ' + (nome ? nome + ', b' : 'B') + 'ora ter disciplina em dia!',
    body: (dias >= 2 ? `Faz ${dias} dias que você não aparece. ` : 'Você ainda não abriu o MAXWS hoje. ') +
      'Marque seus hábitos e tenha mais foco nas suas finanças 💰'
  };
}
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
      headers: { Urgency: 'high', TTL: '86400' },
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

// senha nova pedida pelo dono no painel (conta com número ou e-mail que esqueceu a senha)
async function senhas({ db, auth }) {
  if (!auth) return 0;
  let n = 0;
  try {
    const rs = await db.collection('resets').limit(20).get();
    for (const d of rs.docs) {
      const pw = String((d.data() || {}).pw || '');
      try {
        if (pw.length >= 6 && pw.length <= 64) { await auth.updateUser(d.id, { password: pw }); n++; }
      } catch (e) { console.log('falha na senha nova', e && (e.code || e.message)); }
      await db.doc('resets/' + d.id).delete();
    }
  } catch (e) { console.log('falha ao ler pedidos de senha', e && e.message); }
  if (n) console.log('MAXWS: senhas novas aplicadas', n);
  return n;
}

// aviso para todos (o dono escreve no painel; sai na hora ou no horário agendado)
async function avisosTodos(deps) {
  const { db } = deps;
  const now = deps.now || Date.now();
  let total = 0;
  try {
    const q = await db.collection('avisos').where('st', '==', 'pend').get();
    const prontos = q.docs.filter(d => +((d.data() || {}).at || 0) <= now + 60000);
    if (!prontos.length) return 0;
    const ps = await db.collection('push').get();
    const alvos = ps.docs.map(d => [d.id, ((d.data() || {}).tk || []).filter(Boolean)]).filter(x => x[1].length);
    for (const d of prontos) {
      const a = d.data() || {};
      await db.doc('avisos/' + d.id).set({ st: 'env' }, { merge: true });  // marca antes: nunca manda 2 vezes
      let n = 0;
      for (let i = 0; i < alvos.length; i += 10) {
        const r = await Promise.all(alvos.slice(i, i + 10).map(([uid, tk]) =>
          enviar(deps, uid, tk, String(a.ti || 'MAXWS').slice(0, 60), String(a.tx || '').slice(0, 180), 'maxws-aviso-' + d.id)
            .catch(e => { console.log('falha no aviso para', uid, e && e.message); return 0; })));
        n += r.reduce((x, y) => x + y, 0);
      }
      await db.doc('avisos/' + d.id).set({ st: 'ok', n, fim: Date.now() }, { merge: true });
      total += n;
    }
  } catch (e) { console.log('falha no aviso para todos', e && e.message); }
  if (total) console.log('MAXWS: aviso para todos enviado para', total, 'celulares');
  return total;
}

async function run(deps) {
  const { db } = deps;
  const now = deps.now || Date.now();
  await senhas(deps);
  await avisosTodos(deps);
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
      const ativos = habs.filter(h => !h.c || h.c <= hoje);
      const pend = ativos.filter(h => !feitos.includes(h.id));
      for (const it of itens) {
        try {
          if (it.id === '_bd' || it.id === '_bt' || it.id === '_bn') {
            const m = saudacao(it.id, S, hoje, ativos.length - pend.length, ativos.length);
            enviados += await enviar(deps, uid, tokens, m.title, m.body, 'maxws' + it.id);
          } else if (it.id === '_ina') {
            const m = sumiu(S, hoje, p.tz, now);
            if (m) enviados += await enviar(deps, uid, tokens, m.title, m.body, 'maxws-sumiu');
          } else if (it.id === '_dia') {
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

module.exports = { run, senhas, avisosTodos, slotOf, diaLocal, saudacao, sumiu, FRASES };

if (require.main === module) {
  const { initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const { getMessaging } = require('firebase-admin/messaging');
  const { getAuth } = require('firebase-admin/auth');
  if (!process.env.FIREBASE_SA) { console.error('Falta o segredo FIREBASE_SA no GitHub.'); process.exit(1); }
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SA)) });
  run({ db: getFirestore(), fcm: getMessaging(), auth: getAuth(), FieldValue })
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}
