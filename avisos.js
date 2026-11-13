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

let ERRS = {};  // falhas de envio da rodada (aparecem no painel do dono)
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
  (r.responses || []).forEach((x, i) => {
    if (x.success) return;
    const c = String((x.error && x.error.code) || 'erro');
    ERRS[c] = (ERRS[c] || 0) + 1;
    if (TOKEN_RUIM.test(c)) ruins.push(tokens[i]);
  });
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
      const para = a.so ? alvos.filter(x => x[0] === a.so) : alvos;  // "so": teste só no celular do dono
      let n = 0;
      for (let i = 0; i < para.length; i += 10) {
        const r = await Promise.all(para.slice(i, i + 10).map(([uid, tk]) =>
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

// prêmio do mês: lembra o dono no começo do mês e avisa os vencedores quando ele entrega
const PRZ_INI = '2026-11';
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function mesAnterior(dia) {
  const [y, m] = String(dia).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
async function premioMes(deps, meta) {
  const { db } = deps;
  const now = deps.now || Date.now();
  let n = 0;
  try {
    const ant = mesAnterior(diaLocal('America/Sao_Paulo', now));
    const ps = await db.doc('config/premio').get();
    const P = (ps.exists && ps.data()) || {};
    const upd = {};
    const tokens = async id => { const pd = await db.doc('push/' + id).get(); return ((pd.exists && (pd.data() || {}).tk) || []).filter(Boolean); };
    if (P.mes && Array.isArray(P.g) && meta.pw !== P.mes) {
      for (const w of P.g.slice(0, 3)) {
        const lugar = ['1º', '2º', '3º'][(w.p || 1) - 1] || 'top 3';
        try {
          n += await enviar(deps, w.id, await tokens(w.id), '🏆 Você ganhou o prêmio do mês!',
            `Você ficou em ${lugar} no ranking de ${MESES[+P.mes.slice(5, 7) - 1] || P.mes} e ganhou 1 mês de Premium. Parabéns! ⭐`, 'maxws-premio');
        } catch (e) { console.log('falha no aviso do prêmio', e && e.message); }
      }
      upd.pw = P.mes;
    }
    if (ant >= PRZ_INI && P.mes !== ant && meta.pl !== ant) {
      const dq = await db.collection('premium').where('plan', '==', 'dono').limit(1).get();
      const dono = dq.docs[0] && dq.docs[0].id;
      if (dono) {
        try {
          n += await enviar(deps, dono, await tokens(dono), '🏆 O ranking de ' + (MESES[+ant.slice(5, 7) - 1] || ant) + ' fechou!',
            'Toque para ver os 3 primeiros e entregar o prêmio no painel do dono.', 'maxws-premio-dono');
        } catch (e) { console.log('falha no lembrete do prêmio', e && e.message); }
      }
      upd.pl = ant;
    }
    if (Object.keys(upd).length) { await db.doc('meta/avisos').set(upd, { merge: true }); Object.assign(meta, upd); }
  } catch (e) { console.log('falha no prêmio do mês', e && e.message); }
  return n;
}

// indique um amigo: depois de 3 dias de uso do amigo, os dois ganham 7 dias de Premium
async function indicacoes(deps) {
  const { db } = deps;
  const now = deps.now || Date.now();
  let n = 0;
  try {
    const q = await db.collection('refs').where('st', '==', 'pend').get();
    for (const r of q.docs) {
      const R = r.data() || {};
      const u = await db.doc('users/' + r.id).get();
      const logs = (u.exists && (u.data() || {}).logs) || {};
      if (Object.keys(logs).filter(k => (logs[k] || []).length).length < 3) continue;
      for (const id of [R.by, r.id]) {
        if (!id) continue;
        const ps = await db.doc('premium/' + id).get();
        const p = (ps.exists && ps.data()) || null;
        if (p && (p.plan === 'dono' || (p.plan === 'fundador' && !p.until))) continue;
        const on = p && (p.tier || 'premium') === 'premium' && p.until && p.until > now;
        await db.doc('premium/' + id).set({ tier: 'premium', plan: on ? (p.plan || 'mensal') : 'bonus', until: (on ? p.until : now) + 7 * 864e5, name: String((p && p.name) || (id === r.id ? R.name : '') || '').slice(0, 40), t: now }, { merge: true });
        const pd = await db.doc('push/' + id).get();
        const tk = ((pd.exists && (pd.data() || {}).tk) || []).filter(Boolean);
        try { n += await enviar(deps, id, tk, '🎁 Você ganhou 7 dias de Premium!', id === r.id ? 'Presente da sua indicação no MAXWS. Aproveite! ⭐' : 'Seu amigo ' + String(R.name || '').slice(0, 30) + ' já está firme no MAXWS. Valeu por indicar! ⭐', 'maxws-ref'); } catch (e) { console.log('falha aviso indicação', e && e.message); }
      }
      await db.doc('refs/' + r.id).set({ st: 'ok' }, { merge: true });
    }
  } catch (e) { console.log('falha nas indicações', e && e.message); }
  return n;
}

// ---------- v38: 🎁 7 dias de Premium grátis para quem cria conta ----------
const TESTE_DIAS = 7;
async function testes(deps, meta) {
  const { db } = deps;
  const now = deps.now || Date.now();
  let n = 0;
  if (typeof meta.tr !== 'number') { meta.tr = now; return 0; }  // primeira vez: só contas novas daqui para frente
  let ate = meta.tr;
  try {
    const cs = await db.doc('config/teste').get();
    const C = (cs.exists && cs.data()) || {};
    if (!C.on) { meta.tr = now; return 0; }  // o dono não ligou o teste grátis
    const dentro = t => t >= (+C.ini || 0) && (!C.ate || t <= +C.ate);
    const q = await db.collection('signups').where('t', '>', meta.tr - 10 * 60000).get();
    for (const d of q.docs) {
      const s = d.data() || {}, t = +s.t || 0;
      if (!t) continue;
      ate = Math.max(ate, Math.min(t, now));
      if (now - t > TESTE_DIAS * 864e5 || !dentro(t)) continue;
      const ps = await db.doc('premium/' + d.id).get();
      if (ps.exists) continue;  // já tem plano (pago, bônus, dono, bloqueado ou teste antigo)
      await db.doc('premium/' + d.id).set({ tier: 'premium', plan: 'teste', until: t + TESTE_DIAS * 864e5, name: String(s.name || '').slice(0, 40), t: now, src: 'teste' });
      n++;
    }
  } catch (e) { console.log('falha no teste grátis', e && e.message); }
  meta.tr = ate;
  if (n) console.log('MAXWS: teste grátis liberado para', n);
  return n;
}

// ---------- v38: 💰 vendas da Cakto -> Premium liberado sozinho ----------
const CK_API = 'https://api.cakto.com.br/public_api/';
const emOf = v => String(v || '').trim().toLowerCase();
// mensal (33 dias, dá folga para a renovação), anual (366 dias) ou vitalício
function planoDaVenda(o) {
  const nome = String((o.product && o.product.name) || '');
  const amt = parseFloat(o.amount || o.baseAmount || 0) || 0;
  const per = +o.subscription_period || 0;
  if (/vital[ií]cio|fundador/i.test(nome) || (o.type === 'unique' && amt >= 100)) return ['fundador', 0];
  if (per >= 300 || per === 12 || /anual/i.test(nome) || amt >= 60) return ['anual', 366];
  return ['mensal', 33];
}
const ckErr = (msg, code) => Object.assign(new Error(msg), { ck: code });
async function ckToken(deps, cfg, now) {
  const { db } = deps, f = deps.fetch || fetch;
  const ts = await db.doc('dono/caktotk').get();
  const T = (ts.exists && ts.data()) || {};
  if (T.tk && T.id === cfg.id && T.exp > now + 120000) return T.tk;  // reaproveita (o token vale 10 horas)
  const r = await f(CK_API + 'token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.id, client_secret: cfg.sec }).toString()
  });
  if (r.status === 400 || r.status === 401 || r.status === 403) throw ckErr('token ' + r.status, 'chave inválida');
  if (!r.ok) throw ckErr('token ' + r.status, 'Cakto respondeu ' + r.status);
  const k = await r.json();
  if (!k || !k.access_token) throw ckErr('sem token', 'chave inválida');
  await db.doc('dono/caktotk').set({ tk: k.access_token, exp: now + (+k.expires_in || 36000) * 1000, id: cfg.id });
  return k.access_token;
}
async function uidDoEmail(deps, email) {
  const { db, auth } = deps;
  if (!email) return null;
  if (auth) { try { const u = await auth.getUserByEmail(email); if (u && u.uid) return u.uid; } catch (e) { /* sem login com esse e-mail */ } }
  for (const [col, campo] of [['signups', 'email'], ['users', 'mail']]) {
    try { const q = await db.collection(col).where(campo, '==', email).limit(1).get(); if (q.docs.length) return q.docs[0].id; } catch (e) { /* segue */ }
  }
  return null;
}
async function tokensDe(db, id) {
  const pd = await db.doc('push/' + id).get();
  return ((pd.exists && (pd.data() || {}).tk) || []).filter(Boolean);
}
// libera o Premium da compra; não mexe em dono, vitalício ou expulso. Devolve true se liberou.
async function liberarCompra(deps, uid, venda, now) {
  const { db } = deps;
  const ps = await db.doc('premium/' + uid).get();
  const p = (ps.exists && ps.data()) || null;
  if (p && (p.plan === 'dono' || p.kick || (p.plan === 'fundador' && !p.until))) return false;
  const pago = +venda.pago || now;
  let until = null;
  if (venda.plan !== 'fundador') {
    const atual = p && (p.tier || 'premium') === 'premium' && p.plan !== 'teste' && p.until ? +p.until : 0;
    until = Math.max(atual, pago + venda.dias * 864e5);
    if (until <= now) return false;  // venda antiga já vencida
  }
  await db.doc('premium/' + uid).set({ tier: 'premium', plan: venda.plan, until, name: String(venda.name || (p && p.name) || '').slice(0, 40), t: now, src: 'cakto', ord: String(venda.id) });
  return true;
}
async function caktoSync(deps) {
  const { db } = deps;
  const now = deps.now || Date.now();
  const f = deps.fetch || fetch;
  const cs = await db.doc('dono/cakto').get();
  const cfg = (cs.exists && cs.data()) || {};
  if (!cfg.id || !cfg.sec) return null;
  const mr = await db.doc('meta/cakto').get();
  const M = (mr.exists && mr.data()) || {};
  const primeira = typeof M.cur !== 'number';
  const out = { t: now, n: 0, novas: 0, err: '' };
  const avisos = [];
  try {
    const tk = await ckToken(deps, cfg, now);
    const desde = primeira ? now - 30 * 864e5 : M.cur - 15 * 60000;
    let campo = 'updatedAt__gte';
    let url = CK_API + 'orders/?status=paid,refunded,chargedback&' + campo + '=' + encodeURIComponent(new Date(desde).toISOString()) + '&ordering=paidAt&limit=50';
    const pedidos = [];
    for (let pg = 0; url && pg < 10; pg++) {
      let r = await f(url, { headers: { Authorization: 'Bearer ' + tk } });
      if (r.status === 400 && pg === 0 && campo === 'updatedAt__gte') {
        campo = 'paidAt__gte'; url = url.replace('updatedAt__gte', 'paidAt__gte');
        r = await f(url, { headers: { Authorization: 'Bearer ' + tk } });
      }
      if (r.status === 401 || r.status === 403) { try { await db.doc('dono/caktotk').delete(); } catch (e) { /* ok */ } throw ckErr('pedidos ' + r.status, 'chave inválida'); }
      if (!r.ok) throw ckErr('pedidos ' + r.status, 'Cakto respondeu ' + r.status);
      const k = await r.json();
      pedidos.push(...((k && k.results) || []));
      url = (k && k.next) || null;
    }
    for (const o of pedidos) {
      const id = String(o.id || o.refId || '');
      if (!id) continue;
      const st = String(o.status || '');
      const ref = db.doc('pagos/' + id);
      const ant = await ref.get();
      const A = (ant.exists && ant.data()) || null;
      if (A && A.st === st && (A.uid || st !== 'paid')) continue;  // já tratado
      const [plan, dias] = planoDaVenda(o);
      const email = emOf(o.customer && o.customer.email);
      const name = String((o.customer && o.customer.name) || '').slice(0, 40);
      const pago = Date.parse(o.paidAt || o.createdAt || '') || now;
      const uid = (A && A.uid) || await uidDoEmail(deps, email);
      let ok = false;
      if (st === 'paid' && uid) ok = await liberarCompra(deps, uid, { id, plan, dias, pago, name }, now);
      if (st !== 'paid' && uid) {
        const ps = await db.doc('premium/' + uid).get();
        const p = (ps.exists && ps.data()) || null;
        if (p && p.src === 'cakto' && String(p.ord) === id) await db.doc('premium/' + uid).set({ until: now, t: now }, { merge: true });
      }
      await ref.set({ st, email, name, plan, dias, uid: uid || null, ok, pago, amt: String(o.amount || ''), t: now });
      if (!A) out.novas++;
      if (ok) {
        out.n++;
        try { await enviar(deps, uid, await tokensDe(db, uid), '⭐ Seu Premium foi liberado!', 'Obrigado pela compra! Tudo do MAXWS está liberado. Bora evoluir 💜', 'maxws-premium'); } catch (e) { /* ok */ }
      }
      if (!primeira) {
        if (st === 'paid' && !A) avisos.push(ok ? 'Venda nova: ' + (name || email) + ' · Premium ' + (plan === 'fundador' ? 'vitalício' : plan) + ' ✅' : (name || email) + ' pagou, mas não tem conta com ' + email);
        if (st !== 'paid' && (!A || A.st !== st)) avisos.push((st === 'refunded' ? 'Reembolso: ' : 'Contestação: ') + (name || email));
      }
    }
    // quem pagou antes de criar a conta: tenta de novo a cada rodada
    const pq = await db.collection('pagos').where('uid', '==', null).limit(20).get();
    for (const d of pq.docs) {
      const x = d.data() || {};
      if (x.st !== 'paid' || now - (+x.pago || 0) > 40 * 864e5) continue;
      const uid = await uidDoEmail(deps, x.email);
      if (!uid) continue;
      const ok = await liberarCompra(deps, uid, { id: d.id, plan: x.plan || 'mensal', dias: +x.dias || 33, pago: +x.pago || now, name: x.name }, now);
      await db.doc('pagos/' + d.id).set({ uid, ok, t: now }, { merge: true });
      if (ok) {
        out.n++;
        avisos.push((x.name || x.email) + ' criou a conta: Premium liberado ✅');
        try { await enviar(deps, uid, await tokensDe(db, uid), '⭐ Seu Premium foi liberado!', 'Obrigado pela compra! Tudo do MAXWS está liberado. Bora evoluir 💜', 'maxws-premium'); } catch (e) { /* ok */ }
      }
    }
    if (primeira) avisos.push('Liberação automática ligada' + (out.n ? ': ' + out.n + ' liberado' + (out.n === 1 ? '' : 's') : ''));
    out.cur = now;
  } catch (e) {
    out.err = (e && e.ck) || 'sem conexão com a Cakto';
    out.cur = typeof M.cur === 'number' ? M.cur : undefined;
    console.log('MAXWS: Cakto', out.err, e && e.message);
  }
  if (avisos.length) {
    try {
      const dq = await db.collection('premium').where('plan', '==', 'dono').limit(1).get();
      const dono = dq.docs[0] && dq.docs[0].id;
      if (dono) {
        const title = avisos.length === 1 ? '💰 ' + avisos[0] : '💰 ' + avisos.length + ' novidades nas vendas';
        await enviar(deps, dono, await tokensDe(db, dono), title.slice(0, 80), (avisos.length === 1 ? 'Toque para ver no painel do dono.' : avisos.slice(0, 3).join(' · ')).slice(0, 180), 'maxws-vendas');
      }
    } catch (e) { console.log('falha aviso vendas', e && e.message); }
  }
  const salvar = Object.assign({}, out);
  if (salvar.cur === undefined) delete salvar.cur;
  await db.doc('meta/cakto').set(salvar, { merge: true });
  console.log(`MAXWS: Cakto ${out.err ? 'erro: ' + out.err : 'ok'} · vendas novas ${out.novas} · liberados ${out.n}`);
  return out;
}

// expulsar: apaga o login e os dados da pessoa que o dono expulsou (o bloqueio fica guardado)
async function expulsoes(deps) {
  const { db, auth } = deps;
  let n = 0;
  try {
    const q = await db.collection('expulsos').limit(20).get();
    for (const d of q.docs) {
      const id = d.id;
      if (auth) { try { await auth.deleteUser(id); } catch (e) { if (!/user-not-found/.test(String(e && e.code))) console.log('falha ao apagar login', e && e.code); } }
      for (const p of ['users/' + id + '/x/foto', 'users/' + id, 'rank/' + id, 'push/' + id, 'signups/' + id, 'refs/' + id]) { try { await db.doc(p).delete(); } catch (e) { } }
      try {
        const cs = await db.collection('clas').where('m', 'array-contains', id).get();
        for (const c of cs.docs) {
          const C = c.data() || {}, m = (C.m || []).filter(x => x !== id), nm = Object.assign({}, C.nm);
          delete nm[id];
          if (!m.length) await db.doc('clas/' + c.id).delete();
          else await db.doc('clas/' + c.id).update({ m, nm, dono: C.dono === id ? m[0] : C.dono });
        }
      } catch (e) { console.log('falha ao tirar do clã', e && e.message); }
      try { const os = await db.collection('ofp').where('uid', '==', id).get(); for (const o of os.docs) await db.doc('ofp/' + o.id).delete(); } catch (e) { }
      await db.doc('expulsos/' + id).delete();
      n++;
    }
  } catch (e) { console.log('falha nas expulsões', e && e.message); }
  if (n) console.log('MAXWS: contas expulsas', n);
  return n;
}

async function run(deps) {
  const { db } = deps;
  const now = deps.now || Date.now();
  ERRS = {};
  await senhas(deps);
  await expulsoes(deps);
  await indicacoes(deps);
  const na = await avisosTodos(deps);
  const metaRef = db.doc('meta/avisos');
  const ms = await metaRef.get();
  const meta = (ms.exists && ms.data()) || {};
  await premioMes(deps, meta);
  await testes(deps, meta);
  try { await caktoSync(deps); } catch (e) { console.log('falha na Cakto', e && e.message); }
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
      const dow = new Date(hoje + 'T12:00:00Z').getUTCDay();
      const naData = h => !Array.isArray(h.d) || !h.d.length || h.d.length >= 7 || h.d.includes(dow);
      const ativos = habs.filter(h => (!h.c || h.c <= hoje) && naData(h));
      const pend = ativos.filter(h => !feitos.includes(h.id));
      for (const it of itens) {
        try {
          if (it.id === '_bd' || it.id === '_bt' || it.id === '_bn') {
            const m = saudacao(it.id, S, hoje, ativos.length - pend.length, ativos.length);
            enviados += await enviar(deps, uid, tokens, m.title, m.body, 'maxws' + it.id);
          } else if (String(it.id).startsWith('_dk')) {
            const D = S.dark || {};
            if (D.st !== 'on' || !pend.length) continue;
            const n = pend.length;
            enviados += await enviar(deps, uid, tokens, '🖤 Você jurou. Levanta e cumpre.',
              (n === 1 ? 'Falta 1 hábito' : `Faltam ${n} hábitos`) + ` hoje. O toque de recolher é às ${D.rec || '23:00'}.`, 'maxws-dark');
          } else if (it.id === '_ina') {
            const m = sumiu(S, hoje, p.tz, now);
            if (m) enviados += await enviar(deps, uid, tokens, m.title, m.body, 'maxws-sumiu');
          } else if (it.id === '_dia') {
            if (!pend.length) continue;
            const n = pend.length;
            enviados += await enviar(deps, uid, tokens, '🔥 Ainda dá tempo!', (n === 1 ? 'Falta 1 hábito' : `Faltam ${n} hábitos`) + ' hoje. Não quebre sua sequência!', 'maxws-dia');
          } else {
            const h = habs.find(x => String(x.id) === String(it.id));
            if (!h || feitos.includes(h.id) || !naData(h)) continue;
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

  await metaRef.set({ ate: atual, sg, tr: meta.tr, t: now, n: enviados + na, err: ERRS }, { merge: true });
  console.log(`MAXWS: fatias ${slots.length}, contas lidas ${lidos}, notificações enviadas ${enviados + na}`);
  if (Object.keys(ERRS).length) console.log('MAXWS: falhas de envio', JSON.stringify(ERRS));
  return { slots, enviados, lidos, ate: atual, sg, err: ERRS };
}

module.exports = { run, testes, caktoSync, planoDaVenda, senhas, expulsoes, avisosTodos, premioMes, indicacoes, mesAnterior, slotOf, diaLocal, saudacao, sumiu, FRASES };

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
