import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, getDoc, updateDoc, deleteDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as cfg from "./firebase-config.js";
const firebaseConfig = cfg.firebaseConfig, OWNER_NAME = cfg.OWNER_NAME || "Tu amigo", BIZUM_PHONE = cfg.BIZUM_PHONE || "";

if (!firebaseConfig || !firebaseConfig.apiKey || firebaseConfig.apiKey === "TU_API_KEY") {
  document.getElementById('app').innerHTML = '<p style="padding:24px;font-family:sans-serif">Falta configurar Firebase: <b>firebase-config.js</b> debe empezar por <code>export const firebaseConfig = {</code> y llevar tus credenciales reales.</p>';
  throw new Error('firebaseConfig no definido o sin completar');
}
const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app'), modal = $('#modal');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eur = n => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0);
const r2 = n => Math.round(n * 100) / 100;
const today = () => new Date().toLocaleDateString('sv-SE');
const shareLink = (id, p) => `${location.origin}${location.pathname}?shared=${id}&p=${p}`;
function toast(m) { const t = $('#toast'); t.textContent = m; t.style.opacity = 1; setTimeout(() => t.style.opacity = 0, 1800); }
async function copy(t) { try { await navigator.clipboard.writeText(t); toast('Copiado'); } catch { prompt('Copia esto:', t); } }

/* ---------- ROUTER ----------
   Se decide ANTES de tocar la autenticación:
   - ?shared=ID  -> vista pública (no se carga login ni dashboard)
   - resto       -> zona privada protegida por Firebase Auth            */
const params = new URLSearchParams(location.search);
const sharedId = params.get('shared');
if (sharedId) renderShared(sharedId, params.get('p'));
else startPrivate();

if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('service-worker.js'));

/* =====================  VISTA PÚBLICA  ===================== */
async function renderShared(id, p) {
  const ref = doc(db, 'shared', id);
  const wrap = inner => app.innerHTML = `<main class="p-5 min-h-screen flex flex-col justify-center">${inner}</main>`;
  wrap('<p class="text-center text-neutral-500"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando…</p>');
  let d;
  try { const s = await getDoc(ref); if (!s.exists()) throw 0; d = s.data(); }
  catch { return wrap('<div class="bg-white rounded-3xl p-6 text-center"><i class="fa-regular fa-face-frown text-3xl text-neutral-400"></i><h1 class="num text-xl mt-3">Enlace no válido</h1><p class="text-neutral-500 mt-1">Este gasto no existe o se ha eliminado.</p></div>'); }

  const draw = () => {
    const idx = Number(p), sh = d.shares[idx];
    if (!sh) { // sin ?p: elegir quién eres
      return wrap(`<div class="bg-white rounded-3xl p-6"><h1 class="num text-xl">${esc(d.ownerName)} ha registrado un gasto de ${esc(d.concept)}</h1>
        <p class="text-neutral-500 mt-1 mb-4">¿Quién eres?</p>
        ${d.shares.map((s, i) => `<a href="?shared=${esc(id)}&p=${i}" class="btn bg-[#f3f1ec] mb-2 justify-between"><span>${esc(s.name)}</span><span class="num">${eur(s.amount)}</span></a>`).join('')}</div>`);
    }
    wrap(`<div class="bg-white rounded-3xl p-6 shadow-sm">
      <div class="w-12 h-12 rounded-2xl bg-[#14532d] text-white flex items-center justify-center text-xl"><i class="fa-solid fa-receipt"></i></div>
      <h1 class="num text-xl mt-4 leading-snug">${esc(d.ownerName)} ha registrado un gasto de ${esc(d.concept)}.</h1>
      <p class="text-neutral-500 mt-3">Hola ${esc(sh.name)}, tu parte es de</p>
      <p class="num text-5xl font-bold mt-1 ${sh.paid ? 'text-neutral-400 line-through' : ''}">${eur(sh.amount)}</p>
      <p class="text-sm text-neutral-400 mt-1">Total del gasto: ${eur(d.total)}</p>
      ${sh.paid
        ? '<div class="mt-6 rounded-2xl bg-green-100 text-green-800 p-4 font-semibold text-center"><i class="fa-solid fa-circle-check"></i> Marcado como pagado</div>'
        : `<button id="pay" class="btn bg-[#14532d] text-white w-full mt-6"><i class="fa-solid fa-check"></i> Marcar como pagado</button>
           ${d.bizum ? `<div class="mt-4 rounded-2xl bg-[#f3f1ec] p-4 text-sm">
             <p class="font-semibold"><i class="fa-solid fa-mobile-screen"></i> Paga por Bizum al</p>
             <div class="flex items-center justify-between mt-1"><span class="num text-lg">${esc(d.bizum)}</span>
             <button id="cp" class="px-3 py-1.5 rounded-xl bg-white font-semibold">Copiar</button></div>
             <p class="text-neutral-500 mt-2">Concepto sugerido: ${esc(d.concept)}</p></div>` : ''}`}
    </div>`);
    $('#cp')?.addEventListener('click', () => copy(d.bizum));
    $('#pay')?.addEventListener('click', async e => {
      e.currentTarget.disabled = true;
      try {
        const fresh = (await getDoc(ref)).data(); fresh.shares[idx].paid = true;
        await updateDoc(ref, { shares: fresh.shares }); d = fresh; draw();
      } catch { toast('No se pudo actualizar'); e.currentTarget.disabled = false; }
    });
  };
  draw();
}

/* =====================  ZONA PRIVADA  ===================== */
let user = null, items = [], unsub = null;

function startPrivate() {
  onAuthStateChanged(auth, u => {
    unsub?.(); unsub = null; user = u;
    if (!u) { items = []; return renderLogin(); }
    renderDash();
    unsub = onSnapshot(query(collection(db, 'users', u.uid, 'transactions'), orderBy('date', 'desc')),
      snap => { items = snap.docs.map(d => ({ id: d.id, ...d.data() })); paint(); },
      () => toast('Error al leer datos'));
  });
}

function renderLogin() {
  modal.innerHTML = '';
  app.innerHTML = `<main class="p-6 min-h-screen flex flex-col justify-center">
    <h1 class="num text-4xl font-bold">Mis finanzas</h1>
    <p class="text-neutral-500 mt-1 mb-8">Inicia sesión para ver tus movimientos.</p>
    <form id="lf" class="space-y-3">
      <input id="em" type="email" required autocomplete="email" placeholder="Correo electrónico" class="inp">
      <input id="pw" type="password" required autocomplete="current-password" placeholder="Contraseña" class="inp">
      <p id="er" class="text-red-600 text-sm min-h-5"></p>
      <button class="btn bg-[#14532d] text-white w-full">Entrar</button>
    </form></main>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    try { await signInWithEmailAndPassword(auth, $('#em').value.trim(), $('#pw').value); }
    catch { $('#er').textContent = 'Correo o contraseña incorrectos.'; }
  };
}

function renderDash() {
  app.innerHTML = `<main class="px-5 pt-6 pb-36">
    <header class="flex items-center justify-between mb-5">
      <h1 class="num text-xl font-bold">Mis finanzas</h1>
      <div class="flex gap-2">
        <button id="chb" class="h-10 px-4 rounded-full bg-white font-semibold"><i class="fa-solid fa-chart-pie"></i> Gráficos</button>
        <button id="out" class="w-10 h-10 rounded-full bg-white" aria-label="Cerrar sesión"><i class="fa-solid fa-right-from-bracket"></i></button>
      </div>
    </header>
    <section class="rounded-3xl bg-[#14532d] text-white p-6">
      <p class="text-green-100">Balance total</p>
      <p id="bal" class="num text-5xl font-bold mt-1">—</p>
      <div class="flex gap-6 mt-5 text-sm">
        <div><p class="text-green-200"><i class="fa-solid fa-arrow-down"></i> Ingresos del mes</p><p id="inc" class="num text-lg font-semibold">—</p></div>
        <div><p class="text-green-200"><i class="fa-solid fa-arrow-up"></i> Gastos del mes</p><p id="exp" class="num text-lg font-semibold">—</p></div>
      </div>
    </section>
    <h2 class="num font-bold mt-7 mb-3">Movimientos recientes</h2>
    <ul id="list" class="space-y-2"></ul>
  </main>
  <nav class="fixed bottom-0 inset-x-0 max-w-md mx-auto p-4 flex gap-3" style="padding-bottom:calc(1rem + env(safe-area-inset-bottom))">
    <button data-new="expense" class="btn flex-1 bg-neutral-900 text-white shadow-lg"><i class="fa-solid fa-minus"></i> Añadir gasto</button>
    <button data-new="income" class="btn flex-1 bg-white shadow-lg"><i class="fa-solid fa-plus"></i> Añadir ingreso</button>
  </nav>`;
  $('#out').onclick = () => signOut(auth);
  $('#chb').onclick = openCharts;
  app.querySelectorAll('[data-new]').forEach(b => b.onclick = () => openForm(b.dataset.new));
  $('#list').onclick = onListClick;
}

const eff = t => t.type === 'income' ? t.amount : (t.myShare ?? t.amount);

function paint() {
  if (!$('#list')) return;
  const m = today().slice(0, 7);
  let bal = 0, inc = 0, exp = 0;
  for (const t of items) {
    const v = eff(t); bal += t.type === 'income' ? v : -v;
    if (t.date?.slice(0, 7) === m) t.type === 'income' ? inc += v : exp += v;
  }
  $('#bal').textContent = eur(bal); $('#inc').textContent = eur(inc); $('#exp').textContent = eur(exp);
  $('#list').innerHTML = items.length ? items.slice(0, 40).map(t => `
    <li class="bg-white rounded-2xl p-3 flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl flex items-center justify-center ${t.type === 'income' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}"><i class="fa-solid ${t.type === 'income' ? 'fa-arrow-down' : (t.sharedId ? 'fa-user-group' : 'fa-arrow-up')}"></i></div>
      <div class="flex-1 min-w-0"><p class="font-semibold truncate">${esc(t.concept)}</p>
        <p class="text-xs text-neutral-500 truncate">${esc(t.date)}${t.group ? ' · ' + esc(t.group) : ''}${t.sharedId ? ' · dividido' : ''}</p></div>
      <div class="text-right"><p class="num font-bold ${t.type === 'income' ? 'text-green-700' : ''}">${t.type === 'income' ? '+' : '−'}${eur(eff(t))}</p>
        ${t.sharedId ? `<p class="text-xs text-neutral-400">de ${eur(t.amount)}</p>` : ''}</div>
      <div class="flex flex-col gap-1 text-neutral-400">
        ${t.sharedId ? `<button data-share="${t.id}" aria-label="Compartir"><i class="fa-solid fa-share-nodes"></i></button>` : ''}
        <button data-del="${t.id}" aria-label="Borrar"><i class="fa-regular fa-trash-can"></i></button></div>
    </li>`).join('')
    : '<li class="text-center text-neutral-500 py-10">Aún no hay movimientos. Añade tu primer gasto o ingreso.</li>';
}

async function onListClick(e) {
  const sh = e.target.closest('[data-share]'), del = e.target.closest('[data-del]');
  if (sh) return openShare(items.find(t => t.id === sh.dataset.share));
  if (del && confirm('¿Borrar este movimiento?')) {
    const t = items.find(x => x.id === del.dataset.del);
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'transactions', t.id));
      if (t.sharedId) await deleteDoc(doc(db, 'shared', t.sharedId));
    } catch { toast('No se pudo borrar'); }
  }
}

/* ---------- formulario ---------- */
function sheet(html) {
  modal.innerHTML = `<div class="fixed inset-0 z-50 bg-black/40 flex items-end justify-center" id="bd">
    <div class="sheet bg-[#f3f1ec] w-full max-w-md rounded-t-3xl p-5 max-h-[92vh] overflow-y-auto" style="padding-bottom:calc(1.25rem + env(safe-area-inset-bottom))">${html}</div></div>`;
  $('#bd').onclick = e => { if (e.target.id === 'bd') modal.innerHTML = ''; };
}

function openForm(type) {
  const ex = type === 'expense';
  const groups = [...new Set(items.map(t => t.group).filter(Boolean))];
  sheet(`<form id="f" class="space-y-3">
    <h2 class="num text-xl font-bold">${ex ? 'Añadir gasto' : 'Añadir ingreso'}</h2>
    <input id="amt" type="number" inputmode="decimal" step="0.01" min="0.01" required placeholder="Cantidad (€)" class="inp num text-2xl">
    <input id="con" required maxlength="60" placeholder="${ex ? 'Concepto (Gasolina, Comida, Ocio…)' : 'Concepto (Clases, Paga, Bizum…)'}" class="inp">
    <input id="dt" type="date" required value="${today()}" class="inp">
    ${ex ? `<input id="grp" list="gl" maxlength="40" placeholder="Grupo (vacío = individual)" class="inp"><datalist id="gl">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
    <label class="flex items-center justify-between bg-white rounded-2xl p-4 font-semibold">Dividir este gasto<input id="sp" type="checkbox" class="w-6 h-6 accent-[#14532d]"></label>
    <div id="spb" class="hidden space-y-2">
      <input id="np" type="number" inputmode="numeric" min="2" max="20" value="2" class="inp" aria-label="Entre cuántas personas (contigo)">
      <p class="text-xs text-neutral-500">Personas en total, contigo incluido. Parte de cada una: <b id="each" class="num">—</b></p>
      <input id="nm" placeholder="Nombres de tus amigos, separados por comas (opcional)" class="inp">
    </div>` : ''}
    <button class="btn bg-[#14532d] text-white w-full">Guardar</button></form>`);
  if (ex) {
    const upd = () => $('#each').textContent = eur(r2((+$('#amt').value || 0) / (+$('#np').value || 2)));
    $('#sp').onchange = () => { $('#spb').classList.toggle('hidden', !$('#sp').checked); upd(); };
    $('#amt').oninput = $('#np').oninput = upd;
  }
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true;
    try { await save(type); } catch (err) { console.error(err); toast('Error al guardar'); btn.disabled = false; }
  };
}

async function save(type) {
  const amount = r2(+$('#amt').value);
  const data = { type, amount, concept: $('#con').value.trim(), date: $('#dt').value, createdAt: serverTimestamp() };
  let created = null;
  if (type === 'expense') {
    data.group = $('#grp').value.trim();
    if ($('#sp').checked) {
      const n = Math.min(20, Math.max(2, parseInt($('#np').value) || 2));
      const each = r2(amount / n);
      const names = $('#nm').value.split(',').map(s => s.trim()).filter(Boolean);
      const shares = Array.from({ length: n - 1 }, (_, i) => ({ name: names[i] || `Amigo ${i + 1}`, amount: each, paid: false }));
      const ref = await addDoc(collection(db, 'shared'), { ownerUid: user.uid, ownerName: OWNER_NAME, bizum: BIZUM_PHONE, concept: data.concept, total: amount, shares, createdAt: serverTimestamp() });
      Object.assign(data, { sharedId: ref.id, myShare: r2(amount - each * (n - 1)), each, friends: shares.map(s => s.name) });
      created = data;
    }
  }
  const ref = await addDoc(collection(db, 'users', user.uid, 'transactions'), data);
  modal.innerHTML = '';
  if (created) openShare({ id: ref.id, ...data });
  else toast('Guardado');
}

/* ---------- compartir ---------- */
async function openShare(t) {
  let paid = [];
  try { paid = (await getDoc(doc(db, 'shared', t.sharedId))).data().shares.map(s => s.paid); } catch {}
  sheet(`<h2 class="num text-xl font-bold">Compartir "${esc(t.concept)}"</h2>
    <p class="text-neutral-500 text-sm mb-3">Cada amigo tiene su propio enlace con su parte (${eur(t.each)}).</p>
    ${t.friends.map((n, i) => `<div class="bg-white rounded-2xl p-3 mb-2">
      <div class="flex justify-between"><b>${esc(n)}</b><span class="${paid[i] ? 'text-green-700' : 'text-neutral-400'} text-sm">${paid[i] ? '<i class="fa-solid fa-circle-check"></i> Pagado' : 'Pendiente'}</span></div>
      <div class="flex gap-2 mt-2">
        <button data-c="${i}" class="btn flex-1 bg-[#f3f1ec] !py-2"><i class="fa-regular fa-copy"></i> Copiar enlace</button>
        <a target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Hola ${n}, tu parte de "${t.concept}" es ${eur(t.each)}. Míralo y márcalo como pagado aquí: ${shareLink(t.sharedId, i)}`)}" class="btn flex-1 bg-green-600 text-white !py-2"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a>
      </div></div>`).join('')}
    <button id="cl" class="btn w-full bg-neutral-900 text-white mt-2">Listo</button>`);
  modal.querySelectorAll('[data-c]').forEach(b => b.onclick = () => copy(shareLink(t.sharedId, b.dataset.c)));
  $('#cl').onclick = () => modal.innerHTML = '';
}

/* ---------- gráficos ---------- */
function openCharts() {
  const COLORS = ['#14532d', '#d97706', '#0e7490', '#9333ea', '#dc2626', '#65a30d', '#db2777', '#475569'];
  const shift = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const label = ym => { const [y, m] = ym.split('-'); return new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }); };
  const short = ym => new Date(ym.slice(0, 4), ym.slice(5) - 1, 1).toLocaleDateString('es-ES', { month: 'short' });
  const sum = (ym, type) => items.filter(t => t.type === type && t.date?.slice(0, 7) === ym).reduce((s, t) => s + eff(t), 0);
  let mo = today().slice(0, 7);

  sheet('<div id="ch"></div>');
  const draw = () => {
    // Gastos por concepto del mes elegido
    const by = {};
    items.filter(t => t.type === 'expense' && t.date?.slice(0, 7) === mo).forEach(t => {
      const k = t.concept.trim().toLowerCase(); (by[k] ||= { n: t.concept.trim(), v: 0 }).v += eff(t);
    });
    let cats = Object.values(by).sort((a, b) => b.v - a.v);
    if (cats.length > 8) cats = [...cats.slice(0, 7), { n: 'Otros', v: cats.slice(7).reduce((s, c) => s + c.v, 0) }];
    const total = cats.reduce((s, c) => s + c.v, 0);
    let off = 0;
    const segs = cats.map((c, i) => { const p = c.v / total * 100; const s = `<circle r="15.9155" cx="21" cy="21" fill="none" stroke="${COLORS[i]}" stroke-width="6" stroke-dasharray="${p} ${100 - p}" stroke-dashoffset="${-off}"/>`; off += p; return s; }).join('');

    // Ingresos vs gastos, últimos 6 meses
    const months = Array.from({ length: 6 }, (_, i) => shift(mo, i - 5));
    const data = months.map(m => ({ m, i: sum(m, 'income'), e: sum(m, 'expense') }));
    const max = Math.max(1, ...data.flatMap(d => [d.i, d.e]));

    $('#ch').innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <button id="pv" class="w-10 h-10 rounded-full bg-white" aria-label="Mes anterior"><i class="fa-solid fa-chevron-left"></i></button>
        <h2 class="num text-lg font-bold capitalize">${label(mo)}</h2>
        <button id="nx" class="w-10 h-10 rounded-full bg-white" aria-label="Mes siguiente"><i class="fa-solid fa-chevron-right"></i></button>
      </div>
      <div class="bg-white rounded-2xl p-4 mb-3">
        <h3 class="font-semibold mb-3">Gastos por concepto</h3>
        ${total ? `<div class="flex items-center gap-4">
          <svg viewBox="0 0 42 42" class="w-36 h-36 shrink-0" role="img" aria-label="Gráfico de gastos por concepto">
            <g transform="rotate(-90 21 21)">${segs}</g>
            <text x="21" y="22.5" text-anchor="middle" font-size="5" font-weight="700" fill="#1c2b22">${Math.round(total)}€</text></svg>
          <ul class="text-sm space-y-1 min-w-0 flex-1">${cats.map((c, i) => `<li class="flex items-center gap-2"><span class="w-3 h-3 rounded-sm shrink-0" style="background:${COLORS[i]}"></span><span class="truncate flex-1">${esc(c.n)}</span><span class="num">${Math.round(c.v / total * 100)}%</span></li>`).join('')}</ul>
        </div>` : '<p class="text-neutral-500 text-sm py-4 text-center">Sin gastos este mes.</p>'}
      </div>
      <div class="bg-white rounded-2xl p-4 mb-3">
        <h3 class="font-semibold mb-3">Ingresos y gastos (6 meses)</h3>
        <div class="flex items-end gap-2 h-36">${data.map(d => `
          <div class="flex-1 h-full flex flex-col justify-end items-center">
            <div class="flex items-end gap-1 w-full justify-center flex-1">
              <div class="w-3 rounded-t bg-green-600" style="height:${d.i / max * 100}%" title="Ingresos ${eur(d.i)}"></div>
              <div class="w-3 rounded-t bg-orange-500" style="height:${d.e / max * 100}%" title="Gastos ${eur(d.e)}"></div></div>
            <span class="text-xs text-neutral-500 mt-1 capitalize">${short(d.m)}</span></div>`).join('')}</div>
        <p class="text-xs text-neutral-500 mt-3 flex gap-4"><span><span class="inline-block w-2.5 h-2.5 rounded-sm bg-green-600"></span> Ingresos ${eur(data[5].i)}</span><span><span class="inline-block w-2.5 h-2.5 rounded-sm bg-orange-500"></span> Gastos ${eur(data[5].e)}</span></p>
      </div>
      <button id="cl" class="btn w-full bg-neutral-900 text-white">Cerrar</button>`;
    $('#pv').onclick = () => { mo = shift(mo, -1); draw(); };
    $('#nx').onclick = () => { mo = shift(mo, 1); draw(); };
    $('#cl').onclick = () => modal.innerHTML = '';
  };
  draw();
}
