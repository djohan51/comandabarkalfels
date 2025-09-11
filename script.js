/*******************
 * CONFIG & UTILS  *
 *******************/
const USE_FIREBASE = true;     // ✅ tempo real ligado
const fmtBRL = (v)=> (v||0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
const uid    = ()=> Math.random().toString(36).slice(2) + Date.now().toString(36);
const nowStr = ()=> {
  const d = new Date();
  const pad = (n)=> String(n).padStart(2,'0');
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// datas
function parsePtBrDateTime(s){
  if(!s) return null;
  try{
    s = s.replace(",", "");
    const [dpart, tpart="00:00:00"] = s.trim().split(" ");
    const [dd,mm,yyyy] = dpart.split("/").map(x=>parseInt(x,10));
    const [HH=0,MM=0,SS=0] = tpart.split(":").map(x=>parseInt(x,10));
    return new Date(yyyy, (mm-1), dd, HH, MM, SS);
  }catch(e){ return null }
}
function isWithinRange(dateObj, startStr, endStr){
  if(!dateObj) return false;
  let ok = true;
  if(startStr){
    const s = new Date(startStr + "T00:00:00");
    if(dateObj < s) ok = false;
  }
  if(endStr){
    const e = new Date(endStr + "T23:59:59");
    if(dateObj > e) ok = false;
  }
  return ok;
}

/*******************
 * FIREBASE BACKEND
 *******************/
let db = null, auth = null;
let STATE = [];   // espelho da coleção
let unsubscribe = null;

function fbInit(){
  if (!USE_FIREBASE) return;
  db = firebase.firestore();
  auth = firebase.auth();
}

function fbSubscribe(){
  if (!USE_FIREBASE || !db) return;
  if (unsubscribe) unsubscribe();

  unsubscribe = db.collection('comandas')
    .orderBy('createdAt', 'desc')
    .onSnapshot((snap)=>{
      STATE = snap.docs.map(d => {
        const val = d.data() || {};
        // padroniza campos esperados na UI
        return {
          id: d.id,
          cliente: val.cliente || '',
          datetime: val.datetime || '-',
          isFiado: !!val.isFiado,
          paid: !!val.paid,
          paymentMethod: val.paymentMethod || null,
          paymentDate: val.paymentDate || null,
          items: val.items || [],
          total: Number(val.total || 0)
        };
      });
      renderTables();
      // Atualiza relatório se estiver aberto
      if (document.querySelector('#page8')?.style.display !== 'none') {
        renderReport();
      }
    }, (err)=> {
      console.error('Snapshot error', err);
      alert('Erro ao sincronizar com o Firestore: ' + (err?.message || err));
    });
}

async function fbAddComanda(row){
  await db.collection('comandas').add({
    cliente: row.cliente,
    datetime: row.datetime,           // string pt-BR para exibição
    isFiado: row.isFiado,
    paid: false,
    paymentMethod: null,
    paymentDate: null,
    items: [],
    total: Number(row.total || 0),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}
async function fbUpdateComanda(id, patch){
  await db.collection('comandas').doc(id).update(patch);
}
async function fbDeleteComanda(id){
  await db.collection('comandas').doc(id).delete();
}

/*******************
 * DOM HELPERS     *
 *******************/
const $  = (sel)=> document.querySelector(sel);
const $$ = (sel)=> Array.from(document.querySelectorAll(sel));

let backdrop; // modal backdrop ref

function showLogin(){
  $('#loginSection').style.display = 'flex';
  $('#appSection').style.display   = 'none';
}
function showApp(){
  $('#loginSection').style.display = 'none';
  $('#appSection').style.display   = 'block';
  $('#dbMode').textContent         = USE_FIREBASE ? 'Firebase' : 'localStorage';
  renderTables();
  goto(1);
}

/*******************
 * NAVEGAÇÃO       *
 *******************/
function goto(n){
  $$(".page").forEach(p=> { if(p) p.style.display = 'none'; });
  const page = $(`#page${n}`);
  if(page) page.style.display='block';
  if(n!==2 && n!==8) renderTables();   // listas
  if(n===2) updateTotalPreview();      // nova
  if(n===8) renderReport();            // relatório
}

/*******************
 * TABELAS         *
 *******************/
function buildTable(rows){
  if(!rows || !rows.length){
    return `<div class="empty">Nenhuma comanda encontrada.</div>`;
  }
  const thead = `
    <thead><tr>
      <th class="sel-col">Sel</th>
      <th>Cliente</th>
      <th>Data</th>
      <th>Tipo</th>
      <th>Status</th>
      <th>Total</th>
      <th>Ações</th>
    </tr></thead>`;
  const tbody = rows.map(c=>`
    <tr data-id="${c.id}">
      <td class="sel-col"><input type="checkbox" class="rowSel" data-id="${c.id}"></td>
      <td data-label="Cliente">${c.cliente}</td>
      <td data-label="Data">${c.datetime}</td>
      <td data-label="Tipo">${c.isFiado ? 'Fiado' : 'Normal'}</td>
      <td data-label="Status">${c.paid ? '✅ Pago' : '❌ Não Pago'}</td>
      <td data-label="Total" style="text-align:right">${fmtBRL(c.total)}</td>
      <td data-label="Ações">
        ${!c.paid ? `<button class="btn success small" onclick="openPay('${c.id}')">Pagar</button>` : ''}
        <button class="btn outline small" onclick="openDetails('${c.id}')">Detalhes</button>
        <button class="btn danger small" onclick="deleteComanda('${c.id}')">Delete</button>
      </td>
    </tr>
  `).join("");
  return `<div style="overflow:auto"><table>${thead}<tbody>${tbody}</tbody></table></div>`;
}
function matchByName(q){
  q = (q||'').trim().toLowerCase();
  if(!q) return ()=>true;
  return (c)=> (c.cliente||'').toLowerCase().includes(q);
}

function safeSetHTML(sel, html){
  const el = $(sel);
  if(el) el.innerHTML = html;
}
function renderTables(){
  const data = getData();

  // 1) Todas
  {
    const q = $('#searchAll')?.value || '';
    const rows = data.filter(matchByName(q));
    safeSetHTML('#tableAll', buildTable(rows));
  }

  // 3) Fiado (todas)
  {
    const rows = data.filter(c=> c.isFiado === true);
    safeSetHTML('#tableFiado', buildTable(rows));
  }

  // 4) Normais Não Pagas (criação)
  {
    const q = $('#searchUnpaidN')?.value || '';
    let rows = data.filter(c=> c.isFiado === false && !c.paid);
    if(q) rows = rows.filter(matchByName(q));
    const s = $('#dt4Start')?.value || '';
    const e = $('#dt4End')?.value || '';
    if(s || e) rows = rows.filter(c=> isWithinRange(parsePtBrDateTime(c.datetime), s, e));
    safeSetHTML('#tableNormaisNP', buildTable(rows));
  }

  // 5) Normais Pagas (pagamento)
  {
    const q = $('#searchPaidN')?.value || '';
    let rows = data.filter(c=> c.isFiado === false && c.paid);
    if(q) rows = rows.filter(matchByName(q));
    const s = $('#dt5Start')?.value || '';
    const e = $('#dt5End')?.value || '';
    if(s || e) rows = rows.filter(c=> isWithinRange(parsePtBrDateTime(c.paymentDate), s, e));
    safeSetHTML('#tableNormaisP', buildTable(rows));
  }

  // 6) Fiado Não Pagas (criação)
  {
    const q = $('#searchFiadoNP')?.value || '';
    let rows = data.filter(c=> c.isFiado === true && !c.paid);
    if(q) rows = rows.filter(matchByName(q));
    const s = $('#dt6Start')?.value || '';
    const e = $('#dt6End')?.value || '';
    if(s || e) rows = rows.filter(c=> isWithinRange(parsePtBrDateTime(c.datetime), s, e));
    safeSetHTML('#tableFiadoNP', buildTable(rows));
  }

  // 7) Fiado Pagas (pagamento)
  {
    const q = $('#searchFiadoP')?.value || '';
    let rows = data.filter(c=> c.isFiado === true && c.paid);
    if(q) rows = rows.filter(matchByName(q));
    const s = $('#dt7Start')?.value || '';
    const e = $('#dt7End')?.value || '';
    if(s || e) rows = rows.filter(c=> isWithinRange(parsePtBrDateTime(c.paymentDate), s, e));
    safeSetHTML('#tableFiadoP', buildTable(rows));
  }

  applySelectionToAllTables();
}

/*******************
 * NOVA COMANDA    *
 *******************/
function updateTotalPreview(){
  const v = parseFloat($('#valorConsumido')?.value || '0') || 0;
  $('#totalPreview') && ($('#totalPreview').textContent = fmtBRL(v));
}
function saveComanda(isFiado){
  const cliente = $('#clienteInput')?.value.trim();
  const total = parseFloat($('#valorConsumido')?.value || '0') || 0;
  if(!cliente){ alert('Informe o nome do cliente.'); return }
  if(total <= 0){ alert('Informe o valor consumido.'); return }

  const row = { cliente, datetime:nowStr(), items:[], total, isFiado, paid:false, paymentMethod:null, paymentDate:null };

  fbAddComanda(row).then(()=>{
    $('#newForm')?.reset();
    updateTotalPreview();
    // Lista atualiza pelo onSnapshot
    goto(isFiado ? 6 : 4);
  }).catch(e=> alert('Erro ao salvar: '+(e?.message||e)));
}

/*******************
 * MODAL & AÇÕES   *
 *******************/
function openModal(title, bodyHTML, actionsHTML){
  $('#modalTitle') && ($('#modalTitle').textContent = title||'');
  $('#modalBody')  && ($('#modalBody').innerHTML = bodyHTML||'');
  $('#modalActions') && ($('#modalActions').innerHTML = actionsHTML||'');
  if(backdrop) backdrop.style.display = 'flex';
}
function closeModal(){ if(backdrop) backdrop.style.display='none' }

function openPay(id){
  const data = getData();
  const c = data.find(x=> x.id===id);
  if(!c) return;

  openModal('Pagamento',
    `<div class="form">
      <div>Cliente: <strong>${c.cliente}</strong></div>
      <div>Total: <strong>${fmtBRL(c.total)}</strong></div>
      <div class="group">
        <label>Método de pagamento</label>
        <select id="payMethod" class="input">
          <option>Dinheiro</option>
          <option>Pix</option>
          <option>Débito</option>
          <option>Crédito</option>
        </select>
      </div>
    </div>`,
    `<button class="btn" id="btnDoPay">Confirmar</button>
     <button class="btn outline" id="btnCancelPay">Cancelar</button>`
  );
  $('#btnDoPay')?.addEventListener('click', ()=>{
    const method = $('#payMethod')?.value;
    const patch = { paid: true, paymentMethod: method, paymentDate: nowStr() };
    fbUpdateComanda(c.id, patch)
      .then(()=> closeModal())
      .catch(e=> alert('Erro: '+(e?.message||e)));
  });
  $('#btnCancelPay')?.addEventListener('click', closeModal);
}

/* ====== DETALHES (edição de nome/valor/método) ====== */
function openDetails(id){
  const data = getData();
  const c = data.find(x=> x.id===id);
  if(!c) return;

  let body = `
    <div class="form">
      <div class="group">
        <label for="editCliente"><strong>Nome do cliente</strong></label>
        <input id="editCliente" type="text" value="${(c.cliente || '').replace(/"/g,'&quot;')}" />
      </div>
      <div><strong>Tipo:</strong> ${c.isFiado ? 'Fiado' : 'Normal'}</div>
      <div><strong>Criada em:</strong> ${c.datetime}</div>
      <div><strong>Status:</strong> ${c.paid ? '✅ Pago' : '❌ Não Pago'}</div>
  `;

  if(c.paid){
    body += `
      <div><strong>Pago em:</strong> ${c.paymentDate || '-'}</div>
      <div class="group">
        <label for="editTotal"><strong>Editar total (R$)</strong></label>
        <input id="editTotal" type="number" step="0.01" min="0" value="${Number(c.total || 0).toFixed(2)}" />
      </div>
      <div class="group">
        <label for="editMethod"><strong>Editar método de pagamento</strong></label>
        <select id="editMethod" class="input">
          <option ${/dinheiro/i.test(c.paymentMethod||'') ? 'selected' : ''}>Dinheiro</option>
          <option ${/pix/i.test(c.paymentMethod||'') ? 'selected' : ''}>Pix</option>
          <option ${/d[eé]bito/i.test(c.paymentMethod||'') ? 'selected' : ''}>Débito</option>
          <option ${/cr[eé]dito/i.test(c.paymentMethod||'') ? 'selected' : ''}>Crédito</option>
        </select>
      </div>
    `;
  }else{
    body += `<div><strong>Total:</strong> ${fmtBRL(c.total)}</div>`;
  }

  body += `</div>`;

  const actions = `
    <button class="btn" id="btnSaveChanges">Salvar alterações</button>
    <button class="btn outline" id="btnCloseDetails">Fechar</button>
  `;

  openModal('Detalhes da Comanda', body, actions);

  $('#btnCloseDetails')?.addEventListener('click', closeModal);

  $('#btnSaveChanges')?.addEventListener('click', ()=>{
    const newName = ($('#editCliente')?.value || '').trim();
    if(!newName){ alert('Informe um nome de cliente válido.'); return; }

    const patch = { cliente: newName };

    if(c.paid){
      const newTotal  = parseFloat($('#editTotal')?.value || 'NaN');
      const newMethod = ($('#editMethod')?.value || '').trim();
      if(isNaN(newTotal) || newTotal < 0){ alert('Valor inválido.'); return; }
      if(!newMethod){ alert('Selecione um método.'); return; }
      patch.total = newTotal;
      patch.paymentMethod = newMethod;
    }

    fbUpdateComanda(c.id, patch)
      .then(()=> closeModal())
      .catch(e=> alert('Erro: '+(e?.message||e)));
  });
}

/*******************
 * DELETE (1 a 1)  *
 *******************/
function deleteComanda(id){
  if(!confirm('Excluir esta comanda? Esta ação não pode ser desfeita.')) return;
  fbDeleteComanda(id).catch(e=> alert('Erro: '+(e?.message||e)));
}

/*****************************************
 * SELEÇÃO + EXCLUSÃO/PAGAMENTO EM MASSA *
 *****************************************/
const Selected = new Set();

function getVisibleIds(containerId){
  const el = document.getElementById(containerId);
  if(!el) return [];
  return Array.from(el.querySelectorAll('tr[data-id]')).map(tr=> tr.getAttribute('data-id'));
}
function applyRowSelection(containerId){
  const container = document.getElementById(containerId);
  if(!container) return;

  const headRow = container.querySelector('thead tr');
  if(headRow && !headRow.querySelector('th.sel-col')){
    const th = document.createElement('th');
    th.className = 'sel-col';
    th.textContent = 'Sel';
    headRow.insertBefore(th, headRow.firstElementChild);
  }

  container.querySelectorAll('tbody tr').forEach(tr=>{
    const id = tr.getAttribute('data-id');
    if(!id) return;

    if(!tr.querySelector('td.sel-col')){
      const td = document.createElement('td');
      td.className = 'sel-col';
      td.innerHTML = `<input type="checkbox" class="rowSel" data-id="${id}">`;
      tr.insertBefore(td, tr.firstElementChild);
    }

    const cb = tr.querySelector('input.rowSel');
    if(!cb) return;
    cb.checked = Selected.has(id);
    cb.onchange = (e)=>{
      if(e.target.checked) Selected.add(id);
      else Selected.delete(id);
      refreshBulkButtonsState();
      refreshSelectedTotals();
      syncSelectAllBoxes();
    };
  });
}
function refreshBulkButtonsState(){
  const btns = [
    'btnBulkDel1','btnBulkDel3','btnBulkDel4','btnBulkDel5','btnBulkDel6','btnBulkDel7',
    'btnBulkPay4','btnBulkPay6'
  ];
  const hasAny = Selected.size > 0;
  btns.forEach(id=>{
    const b = document.getElementById(id);
    if(b) b.disabled = !hasAny;
  });
}
function syncSelectAllBoxes(){
  const map = {
    'selectAll1': 'tableAll',
    'selectAll3': 'tableFiado',
    'selectAll4': 'tableNormaisNP',
    'selectAll5': 'tableNormaisP',
    'selectAll6': 'tableFiadoNP',
    'selectAll7': 'tableFiadoP',
  };
  Object.entries(map).forEach(([chkId, tableId])=>{
    const cb = document.getElementById(chkId);
    if(!cb) return;
    const visible = getVisibleIds(tableId);
    if(visible.length === 0){ cb.checked = false; return; }
    cb.checked = visible.every(id=> Selected.has(id));
  });
}
function refreshSelectedTotals(){
  const data = getData();
  const ids = Array.from(Selected);
  const totalSel = data.filter(c=> ids.includes(c.id) && !c.paid)
                       .reduce((s,c)=> s + (Number(c.total)||0), 0);
  const el4 = document.getElementById('selectedTotal4');
  if(el4) el4.textContent = fmtBRL(totalSel);
  const el6 = document.getElementById('selectedTotal6');
  if(el6) el6.textContent = fmtBRL(totalSel);
}
function bulkDeleteVisible(tableId){
  const ids = getVisibleIds(tableId).filter(id=> Selected.has(id));
  if(!ids.length){ alert('Selecione ao menos uma comanda.'); return; }
  if(!confirm(`Excluir ${ids.length} comandas selecionadas? Esta ação não pode ser desfeita.`)) return;

  Promise.all(ids.map(id => fbDeleteComanda(id)))
    .catch(e=> alert('Erro: '+(e?.message||e)))
    .finally(()=>{
      ids.forEach(id=> Selected.delete(id));
      refreshBulkButtonsState();
      refreshSelectedTotals();
      syncSelectAllBoxes();
    });
}
function bulkPayVisible(tableId){
  const ids = getVisibleIds(tableId).filter(id=> Selected.has(id));
  if(!ids.length){ alert('Selecione ao menos uma comanda não paga.'); return; }

  const metodo = prompt('Informe o método para todas as selecionadas: Dinheiro, Pix, Débito ou Crédito');
  if(!metodo) return;

  const valid = ['dinheiro','pix','débito','debito','crédito','credito'];
  if(!valid.includes(metodo.trim().toLowerCase())){
    alert('Método inválido. Use: Dinheiro, Pix, Débito ou Crédito.');
    return;
  }

  const patch = { paid:true, paymentMethod:metodo.trim(), paymentDate:nowStr() };
  Promise.all(ids.map(id => fbUpdateComanda(id, patch)))
    .catch(e=> alert('Erro: '+(e?.message||e)))
    .finally(()=>{
      refreshBulkButtonsState();
      refreshSelectedTotals();
      syncSelectAllBoxes();
    });
}
function applySelectionToAllTables(){
  applyRowSelection('tableAll');
  applyRowSelection('tableFiado');
  applyRowSelection('tableNormaisNP');
  applyRowSelection('tableNormaisP');
  applyRowSelection('tableFiadoNP');
  applyRowSelection('tableFiadoP');

  const config = [
    {cb:'selectAll1', table:'tableAll',      delBtn:'btnBulkDel1', payBtn:null},
    {cb:'selectAll3', table:'tableFiado',    delBtn:'btnBulkDel3', payBtn:null},
    {cb:'selectAll4', table:'tableNormaisNP',delBtn:'btnBulkDel4', payBtn:'btnBulkPay4'},
    {cb:'selectAll5', table:'tableNormaisP', delBtn:'btnBulkDel5', payBtn:null},
    {cb:'selectAll6', table:'tableFiadoNP',  delBtn:'btnBulkDel6', payBtn:'btnBulkPay6'},
    {cb:'selectAll7', table:'tableFiadoP',   delBtn:'btnBulkDel7', payBtn:null},
  ];
  config.forEach(({cb, table, delBtn, payBtn})=>{
    const selAll = document.getElementById(cb);
    if(selAll){
      selAll.onchange = ()=>{
        const visible = getVisibleIds(table);
        if(selAll.checked) visible.forEach(id=> Selected.add(id));
        else visible.forEach(id=> Selected.delete(id));
        const cont = document.getElementById(table);
        if(cont){
          cont.querySelectorAll('input.rowSel').forEach(x=>{
            const id = x.getAttribute('data-id');
            x.checked = Selected.has(id);
          });
        }
        refreshBulkButtonsState();
        refreshSelectedTotals();
      };
    }
    const del = document.getElementById(delBtn);
    if(del) del.onclick = ()=> bulkDeleteVisible(table);

    if(payBtn){
      const pay = document.getElementById(payBtn);
      if(pay) pay.onclick = ()=> bulkPayVisible(table);
    }
  });

  refreshBulkButtonsState();
  refreshSelectedTotals();
  syncSelectAllBoxes();
}

/*******************
 * RELATÓRIO       *
 *******************/
function getData(){ return STATE; } // 🔄 origem passa a ser Firestore (STATE)

function renderReport(){
  // (A) Totais por método (pagas)
  const box = $('#reportBox');
  const s = $('#dtRStart')?.value || '';
  const e = $('#dtREnd')?.value || '';
  const dataPaid = getData().filter(c=> c.paid);
  const filteredPaid = (s||e) ? dataPaid.filter(c=> isWithinRange(parsePtBrDateTime(c.paymentDate), s, e)) : dataPaid;

  let dinheiro = 0, pix = 0, cartao = 0, total = 0;
  filteredPaid.forEach(c=>{
    const m = (c.paymentMethod || '').toLowerCase();
    if(m.includes('dinheiro')) dinheiro += c.total;
    else if(m.includes('pix')) pix += c.total;
    else if(m.includes('débito') || m.includes('debito') || m.includes('crédito') || m.includes('credito')) cartao += c.total;
    total += c.total;
  });

  if(box) box.innerHTML = `
    <div style="overflow:auto">
      <table>
        <thead><tr><th>Método</th><th>Valor</th></tr></thead>
        <tbody>
          <tr><td><strong>Dinheiro</strong></td><td style="text-align:right"><strong>${fmtBRL(dinheiro)}</strong></td></tr>
          <tr><td><strong>Pix</strong></td><td style="text-align:right"><strong>${fmtBRL(pix)}</strong></td></tr>
          <tr><td><strong>Cartão (Débito/Crédito)</strong></td><td style="text-align:right"><strong>${fmtBRL(cartao)}</strong></td></tr>
          <tr><td><strong>Total</strong></td><td style="text-align:right"><strong>${fmtBRL(total)}</strong></td></tr>
        </tbody>
      </table>
    </div>`;

  // (B) Consumo por cliente
  const nameQ = ($('#rptName')?.value || '').trim().toLowerCase();
  const cs = $('#dtCStart')?.value || '';
  const ce = $('#dtCEnd')?.value || '';
  const base = document.querySelector('input[name="rptDateBase"]:checked')?.value || 'criacao';

  let dataForClient = getData();
  if(base === 'pagamento'){ dataForClient = dataForClient.filter(c=> c.paid && c.paymentDate); }
  if(nameQ) dataForClient = dataForClient.filter(c=> (c.cliente||'').toLowerCase().includes(nameQ));
  if(cs || ce){
    dataForClient = dataForClient.filter(c=>{
      const d = base === 'criacao' ? parsePtBrDateTime(c.datetime)
                                   : parsePtBrDateTime(c.paymentDate);
      return isWithinRange(d, cs, ce);
    });
  }

  const totalCliente = dataForClient.reduce((s,c)=> s + (Number(c.total)||0), 0);
  const summary = $('#clientReportSummary');
  if(summary){
    summary.textContent =
      nameQ || cs || ce
        ? `Resultado: ${dataForClient.length} comanda(s) • Total consumido: ${fmtBRL(totalCliente)}`
        : 'Dica: informe um nome e/ou intervalo de datas para calcular o total consumido.';
  }

  const tbody = dataForClient.map(c=>`
    <tr>
      <td data-label="Cliente">${c.cliente}</td>
      <td data-label="${base==='criacao' ? 'Criada em' : 'Pago em'}">${base==='criacao' ? c.datetime : (c.paymentDate || '-')}</td>
      <td data-label="Tipo">${c.isFiado ? 'Fiado' : 'Normal'}</td>
      <td data-label="Status">${c.paid ? '✅ Pago' : '❌ Não Pago'}</td>
      <td data-label="Total" style="text-align:right">${fmtBRL(c.total)}</td>
    </tr>
  `).join('');

  const clientBox = $('#clientReportBox');
  if(clientBox){
    clientBox.innerHTML = `
      <div style="overflow:auto">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>${base==='criacao' ? 'Criada em' : 'Pago em'}</th>
              <th>Tipo</th>
              <th>Status</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>${tbody || '<tr><td colspan="5">Nenhuma comanda no filtro.</td></tr>'}</tbody>
        </table>
      </div>`;
  }
}

/*******************
 * BOOTSTRAP       *
 *******************/
window.addEventListener('DOMContentLoaded', ()=>{
  // Modal refs
  backdrop = $('#modalBackdrop');
  $('#btnCloseModal')?.addEventListener('click', closeModal);

  // Firebase init
  fbInit();

  // Auth: login/logout
  $('#btnLogin')?.addEventListener('click', async ()=>{
    const email = $('#loginUser')?.value.trim();
    const pass  = $('#loginPass')?.value;
    if(!email || !pass){ alert('Informe e-mail e senha.'); return; }
    try{
      await auth.signInWithEmailAndPassword(email, pass);
      // onAuthStateChanged cuidará do restante
    }catch(e){
      console.error(e);
      alert('Falha no login: ' + (e?.message || e));
    }
  });

  $('#btnLogout')?.addEventListener('click', async ()=>{
    try{ await auth.signOut(); }catch(e){}
  });

  // Navegação app
  $$('[data-goto]').forEach(b=> b.addEventListener('click', ()=> goto(b.getAttribute('data-goto')) ));

  // Nova comanda
  $('#valorConsumido')?.addEventListener('input', updateTotalPreview);
  $('#btnLimpar')?.addEventListener('click', ()=>{ const i=$('#valorConsumido'); if(i){ i.value=0; updateTotalPreview(); }});
  $('#btnSalvarNormal')?.addEventListener('click', ()=> saveComanda(false));
  $('#btnSalvarFiado')?.addEventListener('click',  ()=> saveComanda(true));

  // Filtros de texto nas listas
  ['searchAll','searchUnpaidN','searchPaidN','searchFiadoNP','searchFiadoP'].forEach(id=>{
    document.getElementById(id)?.addEventListener('input', renderTables);
  });

  // Limpar datas nas listas
  $('#btn4Clear')?.addEventListener('click', ()=>{ ['dt4Start','dt4End'].forEach(id=>{ const el=$('#'+id); if(el) el.value=''; }); renderTables(); });
  $('#btn5Clear')?.addEventListener('click', ()=>{ ['dt5Start','dt5End'].forEach(id=>{ const el=$('#'+id); if(el) el.value=''; }); renderTables(); });
  $('#btn6Clear')?.addEventListener('click', ()=>{ ['dt6Start','dt6End'].forEach(id=>{ const el=$('#'+id); if(el) el.value=''; }); renderTables(); });
  $('#btn7Clear')?.addEventListener('click', ()=>{ ['dt7Start','dt7End'].forEach(id=>{ const el=$('#'+id); if(el) el.value=''; }); renderTables(); });

  // Relatório — Totais por método
  $('#btnRRefresh')?.addEventListener('click', renderReport);
  $('#btnRClear')?.addEventListener('click',  ()=>{ ['dtRStart','dtREnd'].forEach(id=>{ const el=$('#'+id); if(el) el.value=''; }); renderReport(); });

  // Relatório — Consumo por cliente
  $('#btnCSearch')?.addEventListener('click', renderReport);
  $('#btnCClear')?.addEventListener('click',  ()=>{
    ['rptName','dtCStart','dtCEnd'].forEach(id=>{ const el=$('#'+id); if(el) el.value=''; });
    const baseCri = $('#rptBaseCriacao'); if(baseCri) baseCri.checked = true;
    renderReport();
  });
  $('#rptBaseCriacao')?.addEventListener('change', renderReport);
  $('#rptBasePagamento')?.addEventListener('change', renderReport);

  // Observa estado de autenticação
  auth?.onAuthStateChanged(user=>{
    if(user){
      $('#userLabel').textContent = user.email || 'Usuário';
      showApp();
      fbSubscribe();
    }else{
      showLogin();
      if (unsubscribe) unsubscribe();
      STATE = [];
    }
  });
});
