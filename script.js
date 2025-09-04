/*****************
 * STATE & UTILS *
 *****************/
const LS_SESSION_KEY = 'comandas_session_user';
const LS_DATA_KEY    = 'comandas_data';
const LS_SEEDED      = 'comandas_seeded';

const logins = [
  { user:'lucaskalfels', pass:'barecancha' },
  { user:'ADM',          pass:'djohan24' }
];

const fmtBRL = (n)=> n.toLocaleString('pt-BR',{style:'currency', currency:'BRL'});
const nowStr = ()=> new Date().toLocaleString('pt-BR');
const uid    = ()=> Math.random().toString(36).slice(2) + Date.now().toString(36);

/** ===============================
 *  FIREBASE (sincronização cloud)
 *  =============================== */
const USE_FIREBASE = (typeof firebase !== 'undefined') && (typeof window.FIREBASE_CONFIG !== 'undefined');
let FB = { app:null, auth:null, db:null, user:null, unsub:null };

if (USE_FIREBASE) {
  FB.app = firebase.initializeApp(window.FIREBASE_CONFIG);
  FB.auth = firebase.auth();
  FB.db   = firebase.firestore();

  // Mantém sessão entre recargas
  FB.auth.setPersistence('local');

  // Observa mudanças de autenticação
  FB.auth.onAuthStateChanged(u => {
    FB.user = u || null;
    if (u) {
      // espelha usuário logado para a UI atual (código existente usa LS_SESSION_KEY)
      localStorage.setItem(LS_SESSION_KEY, u.email || u.uid);
      startRealtimeSync();
      if (typeof ensureSession === 'function') ensureSession();
    } else {
      localStorage.removeItem(LS_SESSION_KEY);
      stopRealtimeSync();
      if (typeof ensureSession === 'function') ensureSession();
    }
  });
}

// Caminho na nuvem: users/{uid}/comandas
function coll() {
  return FB.db.collection('users').doc(FB.user.uid).collection('comandas');
}

// Listener em tempo real -> atualiza localStorage e re-renderiza
function startRealtimeSync(){
  if(!USE_FIREBASE || !FB.user) return;
  if(FB.unsub) FB.unsub();
  FB.unsub = coll().onSnapshot(snap=>{
    const arr = [];
    snap.forEach(doc => arr.push(doc.data()));
    localStorage.setItem(LS_DATA_KEY, JSON.stringify(arr));
    if (typeof renderAll === 'function') renderAll();
  });
}
function stopRealtimeSync(){
  if(FB.unsub){ FB.unsub(); FB.unsub = null; }
}

const getData = ()=> { try{ return JSON.parse(localStorage.getItem(LS_DATA_KEY)) || [] }catch{ return [] } };
const setData = (arr)=>{
  // 1) salva local para resposta imediata e uso offline
  localStorage.setItem(LS_DATA_KEY, JSON.stringify(arr));

  // 2) se Firebase estiver ativo, sincroniza com a nuvem (upsert por id)
  if (USE_FIREBASE && FB.user) {
    const batch = FB.db.batch();
    arr.forEach(item=>{
      if (!item.id) item.id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const ref = coll().doc(item.id);
      batch.set(ref, item, { merge:true });
    });
    batch.commit().catch(err=>console.error('[SYNC] Erro ao gravar:', err));
  }
};

let currentPage = 1;

// Seleções APENAS nas páginas 4 e 6
const selectedMap = {
  4: new Set(),
  6: new Set(),
};

function seedIfEmpty(){
  if(localStorage.getItem(LS_SEEDED)) return;
  const sample = [
    {
      id: uid(), cliente:'João Santos', datetime: nowStr(),
      items:[{name:'Coca-Cola', price:6, qty:2},{name:'Amendoim', price:2, qty:1}],
      total: 6*2 + 2*1, isFiado:false, paid:false, paymentMethod:null, paymentDate: null
    },
    {
      id: uid(), cliente:'Ana Paula', datetime: nowStr(),
      items:[{name:'Amendoim', price:2, qty:3}],
      total: 2*3, isFiado:false, paid:true, paymentMethod:'Pix', paymentDate: nowStr()
    },
    {
      id: uid(), cliente:'Carlos Pereira', datetime: nowStr(),
      items:[{name:'Coca-Cola', price:6, qty:1}],
      total: 6, isFiado:true, paid:false, paymentMethod:null, paymentDate: null
    },
    {
      id: uid(), cliente:'Mariana (vizinha)', datetime: nowStr(),
      items:[{name:'Coca-Cola', price:6, qty:3},{name:'Amendoim', price:2, qty:2}],
      total: 6*3+2*2, isFiado:true, paid:true, paymentMethod:'Dinheiro', paymentDate: nowStr()
    },
  ];
  setData(sample);
  localStorage.setItem(LS_SEEDED,'1');
}

function migrateData(arr){
  let changed = false;
  for(const c of arr){
    if(c.paid && !('paymentDate' in c)){ c.paymentDate = nowStr(); changed = true; }
    if(!c.paid && !('paymentDate' in c)){ c.paymentDate = null; changed = true; }
  }
  return changed;
}

function ensureSession(){
  const u = localStorage.getItem(LS_SESSION_KEY);
  const logged = !!u;
  document.getElementById('loginSection').style.display = logged ? 'none' : '';
  document.getElementById('appSection').style.display   = logged ? '' : 'none';
  if(logged){
    const label = document.getElementById('userLabel');
    if(label) label.textContent = u;
    renderAll(); goto(1);
  }
}

/*******************
 * LOGIN / LOGOUT  *
 *******************/
document.getElementById('btnLogin').addEventListener('click', async ()=>{
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value.trim();

  if (USE_FIREBASE) {
    try {
      await FB.auth.signInWithEmailAndPassword(u, p);
      // onAuthStateChanged cuida do resto
    } catch (e) {
      alert('Falha no login: ' + (e?.message || e));
    }
    return;
  }

  // Fallback local (sem nuvem)
  const valid = (typeof logins !== 'undefined') && logins.find(l=> l.user===u && l.pass===p);
  if(valid){
    localStorage.setItem(LS_SESSION_KEY, u);
    if (typeof seedIfEmpty === 'function') seedIfEmpty();
    if (typeof ensureSession === 'function') ensureSession();
  }else{
    alert('Credenciais inválidas.');
  }
});

document.getElementById('btnLogout').addEventListener('click', async ()=>{
  if (USE_FIREBASE && FB.auth.currentUser) {
    await FB.auth.signOut();
  } else {
    localStorage.removeItem(LS_SESSION_KEY);
    if (typeof ensureSession === 'function') ensureSession();
  }
});

/*******************
 * NAVIGATION      *
 *******************/
document.querySelectorAll('[data-goto]').forEach(btn=>{
  btn.addEventListener('click', ()=> goto(parseInt(btn.getAttribute('data-goto'))));
});

function goto(n){
  currentPage = n;
  document.querySelectorAll('.page').forEach(p=> p.style.display='none');
  const el = document.getElementById('page'+n);
  if(el){ el.style.display='block' }

  document.querySelectorAll('.nav .btn').forEach(b=> b.classList.remove('primary'));
  const act = document.querySelector(`.nav .btn[data-goto="${n}"]`);
  if(act) act.classList.add('primary');

  if(n!==2) renderTables();
  if(n===2) updateTotalPreview();
}

/*******************
 * BUSCA (helpers) *
 *******************/
function getQuery(id){
  return (document.getElementById(id)?.value || '').trim().toLowerCase();
}
function matchByName(q){
  return (c)=> c.cliente.toLowerCase().includes(q);
}

/*******************
 * RENDER TABLES   *
 *******************/
function renderAll(){
  renderTables();
}

// Atualiza painéis (total selecionado + botão) para 4 e 6
function updateSelectionPanels(){
  [4,6].forEach(page=>{
    const totalSpan = document.getElementById('selectedTotal'+page);
    const btn = document.getElementById('btnBulkPay'+page);
    if(!totalSpan || !btn) return;
    const data = getData();
    let sum = 0;
    for(const id of selectedMap[page]){
      const c = data.find(x=>x.id===id);
      if(c && !c.paid) sum += c.total;
    }
    totalSpan.textContent = fmtBRL(sum);
    btn.disabled = sum <= 0;
  });
}

function renderTables(){
  const data = getData();

  const qAll      = getQuery('searchAll');
  const qPaid     = getQuery('searchPaid');
  const qUnpaid   = getQuery('searchUnpaid');
  const qFiadoNP  = getQuery('searchFiadoNP');
  const qFiadoP   = getQuery('searchFiadoP');

  // 1) Todas
  const allRows = qAll ? data.filter(matchByName(qAll)) : data;
  buildTable('tableAll', allRows);

  // 3) Fiado (todas)
  buildTable('tableFiado', data.filter(c=>c.isFiado));

  // 5) Pagas (normal + fiado) — SEM seleção
  let paidRows = data.filter(c=> c.paid);
  if(qPaid) paidRows = paidRows.filter(matchByName(qPaid));
  buildTable('tableNormaisP', paidRows);

  // 4) Não pagas (normal + fiado) — COM seleção
  let unpaidRows = data.filter(c=> !c.paid);
  if(qUnpaid) unpaidRows = unpaidRows.filter(matchByName(qUnpaid));
  buildSelectableTable(4, 'tableNormaisNP', unpaidRows, {allowSelectUnpaidOnly:true});

  // 6) Fiado não pagas — COM seleção
  let fiadoNP = data.filter(c=> c.isFiado && !c.paid);
  if(qFiadoNP) fiadoNP = fiadoNP.filter(matchByName(qFiadoNP));
  buildSelectableTable(6, 'tableFiadoNP', fiadoNP, {allowSelectUnpaidOnly:true});

  // 7) Fiado pagas — SEM seleção
  let fiadoP = data.filter(c=> c.isFiado && c.paid);
  if(qFiadoP) fiadoP = fiadoP.filter(matchByName(qFiadoP));
  buildTable('tableFiadoP', fiadoP);

  // master checkbox listeners (selecionar todas) APENAS 4 e 6
  [4,6].forEach(page=>{
    const selAll = document.getElementById('selectAll'+page);
    if(selAll){
      selAll.onchange = ()=>{
        const check = selAll.checked;
        const table = document.getElementById(page===4 ? 'tableNormaisNP' : 'tableFiadoNP');
        if(!table) return;
        const boxes = table.querySelectorAll('input[type="checkbox"][data-row-check]');
        boxes.forEach(b=>{
          if(!b.disabled){
            b.checked = check;
            const id = b.getAttribute('data-id');
            if(check) selectedMap[page].add(id); else selectedMap[page].delete(id);
          }
        });
        updateSelectionPanels();
      };
    }
  });

  // Atualiza totals
  updateSelectionPanels();
}

function buildTable(containerId, rows){
  const container = document.getElementById(containerId);
  if(!container) return;
  if(!rows || rows.length===0){
    container.innerHTML = `<div class="empty">Nenhuma comanda encontrada.</div>`;
    return;
  }
  let html = `<div style="overflow:auto"><table><thead><tr>
    <th>Cliente</th><th>Data/Hora</th><th>Total</th><th>Status</th><th>Ações</th>
  </tr></thead><tbody>`;
  for(const c of rows){
    const tagFiado = c.isFiado ? ` <span class="chip">Fiado</span>` : '';
    const status = c.paid ? `<span class="badge paid">✅ Pago</span>` : `<span class="badge unpaid">❌ Não pago</span>`;
    html += `<tr>
      <td data-label="Cliente"><strong>${escapeHtml(c.cliente)}</strong>${tagFiado}</td>
      <td data-label="Data/Hora">${c.datetime}</td>
      <td data-label="Total"><strong>${fmtBRL(c.total)}</strong></td>
      <td data-label="Status">${status}</td>
      <td data-label="Ações">
        ${!c.paid ? `<button class="btn success small" onclick="openPay('${c.id}')">Pagar</button>` : ''}
        <button class="btn outline small" onclick="openDetails('${c.id}')">Detalhes</button>
      </td>
    </tr>`;
  }
  html += `</tbody></table></div>`;
  container.innerHTML = html;
}

function buildSelectableTable(page, containerId, rows, {allowSelectUnpaidOnly}={}){
  const container = document.getElementById(containerId);
  if(!container) return;
  const visibleIds = new Set(rows.map(r=>r.id));
  for(const id of Array.from(selectedMap[page])){
    if(!visibleIds.has(id)) selectedMap[page].delete(id);
  }

  if(!rows || rows.length===0){
    container.innerHTML = `<div class="empty">Nenhuma comanda encontrada.</div>`;
    return;
  }

  let html = `<div style="overflow:auto"><table><thead><tr>
    <th>Sel.</th><th>Cliente</th><th>Data/Hora</th><th>Total</th><th>Status</th><th>Ações</th>
  </tr></thead><tbody>`;
  for(const c of rows){
    const canSelect = allowSelectUnpaidOnly ? !c.paid : true;
    const checked = selectedMap[page].has(c.id) ? 'checked' : '';
    const disabled = canSelect ? '' : 'disabled';
    const tagFiado = c.isFiado ? ` <span class="chip">Fiado</span>` : '';
    const status = c.paid ? `<span class="badge paid">✅ Pago</span>` : `<span class="badge unpaid">❌ Não pago</span>`;

    html += `<tr>
      <td data-label="Sel.">
        <input type="checkbox" data-row-check data-id="${c.id}" ${checked} ${disabled} />
      </td>
      <td data-label="Cliente"><strong>${escapeHtml(c.cliente)}</strong>${tagFiado}</td>
      <td data-label="Data/Hora">${c.datetime}</td>
      <td data-label="Total"><strong>${fmtBRL(c.total)}</strong></td>
      <td data-label="Status">${status}</td>
      <td data-label="Ações">
        ${!c.paid ? `<button class="btn success small" onclick="openPay('${c.id}')">Pagar</button>` : ''}
        <button class="btn outline small" onclick="openDetails('${c.id}')">Detalhes</button>
      </td>
    </tr>`;
  }
  html += `</tbody></table></div>`;
  container.innerHTML = html;

  // Listeners dos checkboxes da tabela
  container.querySelectorAll('input[type="checkbox"][data-row-check]').forEach(ch=>{
    ch.onchange = ()=>{
      const id = ch.getAttribute('data-id');
      if(ch.checked) selectedMap[page].add(id); else selectedMap[page].delete(id);
      updateSelectionPanels();
      const selAll = document.getElementById('selectAll'+page);
      if(selAll && !ch.checked && selAll.checked) selAll.checked = false;
    };
  });

  // Botão pagar selecionadas
  const bulkBtn = document.getElementById('btnBulkPay'+page);
  if(bulkBtn){
    bulkBtn.onclick = ()=> openBulkPay(page);
  }
}

function escapeHtml(s){ return (s||'').replace(/[&<>"]/g, m=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }

/*******************
 * CRIAR COMANDA   *
 *******************/
const qtyCocaEl = document.getElementById('qtyCoca');
const qtyAmenEl = document.getElementById('qtyAmendoim');

if(qtyCocaEl) qtyCocaEl.addEventListener('input', updateTotalPreview);
if(qtyAmenEl) qtyAmenEl.addEventListener('input', updateTotalPreview);

function changeQty(which, delta){
  const el = which==='coca' ? qtyCocaEl : qtyAmenEl;
  const v = Math.max(0, (parseInt(el.value||'0') + delta));
  el.value = v; updateTotalPreview();
}

function updateTotalPreview(){
  const total = 6*parseInt(qtyCocaEl.value||'0') + 2*parseInt(qtyAmenEl.value||'0');
  document.getElementById('totalPreview').textContent = fmtBRL(total);
}

document.getElementById('btnLimpar')?.addEventListener('click', ()=>{
  if(qtyCocaEl) qtyCocaEl.value = 0; 
  if(qtyAmenEl) qtyAmenEl.value=0; 
  updateTotalPreview();
});

document.getElementById('btnSalvarNormal')?.addEventListener('click', ()=> saveComanda(false));
document.getElementById('btnSalvarFiado')?.addEventListener('click', ()=> saveComanda(true));

function saveComanda(isFiado){
  const cliente = document.getElementById('clienteInput').value.trim();
  const qC = parseInt(qtyCocaEl.value||'0');
  const qA = parseInt(qtyAmenEl.value||'0');
  if(!cliente){ alert('Informe o nome do cliente.'); return }
  if(qC===0 && qA===0){ alert('Selecione ao menos 1 item.'); return }

  const items = [];
  if(qC>0) items.push({name:'Coca-Cola', price:6, qty:qC});
  if(qA>0) items.push({name:'Amendoim', price:2, qty:qA});
  const total = items.reduce((s,i)=> s + i.price*i.qty, 0);

  const data = getData();
  data.unshift({ id:uid(), cliente, datetime:nowStr(), items, total, isFiado, paid:false, paymentMethod:null, paymentDate:null });
  setData(data);

  document.getElementById('newForm').reset();
  if(qtyCocaEl) qtyCocaEl.value=0; 
  if(qtyAmenEl) qtyAmenEl.value=0; 
  updateTotalPreview();

  renderAll(); goto(isFiado?6:4);
}

/*******************
 * MODAL / PAGAMENTOS
 *******************/
const backdrop = document.getElementById('modalBackdrop');
const modalBody = document.getElementById('modalBody');
const modalActions = document.getElementById('modalActions');
const modalTitle = document.getElementById('modalTitle');

document.getElementById('btnCloseModal').addEventListener('click', closeModal);
backdrop.addEventListener('click', (e)=>{ if(e.target===backdrop) closeModal() });

function openPay(id){
  const data = getData();
  const c = data.find(x=>x.id===id);
  if(!c) return;

  modalTitle.textContent = `Pagamento — ${c.cliente}${c.isFiado?' (Fiado)':''}`;
  modalBody.innerHTML = `
    <div class="grid">
      <div class="row between">
        <div><strong>Total</strong><br>${fmtBRL(c.total)}</div>
        <div><strong>Status</strong><br><span class="badge ${c.paid?'paid':'unpaid'}">${c.paid?'✅ Pago':'❌ Não pago'}</span></div>
      </div>
      <div class="radio-row">
        ${['Débito','Crédito','Pix','Dinheiro'].map((opt,i)=>`
          <label class="radio-card"><input type="radio" name="payopt" value="${opt}" ${i===0?'checked':''}/> ${opt}</label>
        `).join('')}
      </div>
    </div>`;

  modalActions.innerHTML = `
    <button class="btn outline" onclick="closeModal()">Cancelar</button>
    <button class="btn success" onclick="confirmSinglePay('${c.id}')">Confirmar pagamento</button>`;
  openModal();
}

function confirmSinglePay(id){
  const method = document.querySelector('input[name="payopt"]:checked')?.value;
  if(!method){ alert('Escolha uma forma de pagamento.'); return }
  const data = getData();
  const idx = data.findIndex(x=>x.id===id);
  if(idx<0) return;
  data[idx].paid = true;
  data[idx].paymentMethod = method;
  data[idx].paymentDate = nowStr();          // grava data/hora do pagamento
  setData(data);
  closeModal();
  renderTables();
}

// Abrir modal para pagar selecionadas (páginas 4 e 6)
function openBulkPay(page){
  const data = getData();
  const ids = Array.from(selectedMap[page]);
  const rows = ids.map(id=> data.find(c=>c && c.id===id)).filter(Boolean).filter(c=> !c.paid);
  if(rows.length===0){ alert('Nenhuma comanda selecionada para pagamento.'); return; }
  const total = rows.reduce((s,c)=> s + c.total, 0);

  modalTitle.textContent = `Pagamento em lote — ${rows.length} comandas`;
  modalBody.innerHTML = `
    <div class="grid">
      <div><strong>Itens selecionados:</strong></div>
      <div class="empty" style="text-align:left">
        <ul style="margin:0; padding-left:18px">
          ${rows.map(c=>`<li>${escapeHtml(c.cliente)} ${c.isFiado?'(Fiado)':''} — ${fmtBRL(c.total)}</li>`).join('')}
        </ul>
      </div>
      <div class="row between">
        <div class="total">Total selecionado: <strong>${fmtBRL(total)}</strong></div>
      </div>
      <div class="radio-row">
        ${['Débito','Crédito','Pix','Dinheiro'].map((opt,i)=>`
          <label class="radio-card"><input type="radio" name="payopt-bulk" value="${opt}" ${i===0?'checked':''}/> ${opt}</label>
        `).join('')}
      </div>
    </div>`;
  modalActions.innerHTML = `
    <button class="btn outline" onclick="closeModal()">Cancelar</button>
    <button class="btn success" onclick="confirmBulkPay(${page})">Confirmar pagamento</button>`;
  openModal();
}

function confirmBulkPay(page){
  const method = document.querySelector('input[name="payopt-bulk"]:checked')?.value;
  if(!method){ alert('Escolha uma forma de pagamento.'); return }
  const data = getData();
  const ids = Array.from(selectedMap[page]);

  let any = false;
  for(const id of ids){
    const idx = data.findIndex(x=>x.id===id);
    if(idx>=0 && !data[idx].paid){
      data[idx].paid = true;
      data[idx].paymentMethod = method;
      data[idx].paymentDate = nowStr();      // grava data/hora do pagamento em lote
      any = true;
    }
  }
  if(!any){ alert('Nada para pagar.'); return; }

  setData(data);
  selectedMap[page].clear();
  closeModal();
  renderTables();
  const selAll = document.getElementById('selectAll'+page);
  if(selAll) selAll.checked = false;
}

function openDetails(id){
  const data = getData();
  const c = data.find(x=>x.id===id);
  if(!c) return;
  modalTitle.textContent = `Detalhes — ${c.cliente}${c.isFiado?' (Fiado)':''}`;
  const itemsHtml = c.items.map(i=>`
    <tr><td>${escapeHtml(i.name)}</td><td style="text-align:center">${i.qty}</td><td style="text-align:right">${fmtBRL(i.price)}</td><td style="text-align:right">${fmtBRL(i.price*i.qty)}</td></tr>
  `).join('');
  modalBody.innerHTML = `
    <div class="grid">
      <div class="row" style="gap:12px; align-items:center">
        <span class="chip">Criada em: ${c.datetime}</span>
        <span class="chip">Status: ${c.paid? '✅ Pago' : '❌ Não pago' }</span>
        ${c.paid ? `<span class="chip">Forma: ${c.paymentMethod}</span>` : ''}
        ${c.paid ? `<span class="chip">Pago em: ${c.paymentDate || '-'}</span>` : ''}
      </div>
      <div style="overflow:auto">
        <table style="border-spacing:0">
          <thead>
            <tr><th style="text-align:left;padding:8px">Produto</th><th style="text-align:center;padding:8px">Qtd</th><th style="text-align:right;padding:8px">Preço</th><th style="text-align:right;padding:8px">Subtotal</th></tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>
      </div>
      <div class="row" style="justify-content:flex-end"><div class="total">Total: ${fmtBRL(c.total)}</div></div>
    </div>`;
  modalActions.innerHTML = `<button class="btn" onclick="closeModal()">Fechar</button>`;
  openModal();
}

function openModal(){ backdrop.style.display='flex' }
function closeModal(){ backdrop.style.display='none' }

/*******************
 * BOOTSTRAP       *
 *******************/
(function init(){
  // Conectar inputs de busca para re-renderizar
  ['searchAll','searchPaid','searchUnpaid','searchFiadoNP','searchFiadoP'].forEach(id=>{
    document.getElementById(id)?.addEventListener('input', renderTables);
  });

  // Conectar botões de pagar selecionadas (APENAS páginas 4 e 6)
  [4,6].forEach(page=>{
    document.getElementById('btnBulkPay'+page)?.addEventListener('click', ()=> openBulkPay(page));
  });

  // Migração (caso tenha dados antigos sem paymentDate)
  const data = getData();
  if(migrateData(data)) setData(data);

  ensureSession();
})();
s