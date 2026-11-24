/* Export Excel + annexe PDF — charte Atelier AOR */
'use strict';

const ARD = '34413C', ORA = 'FD9019';
const SIRET = '487 550 501 00042';
let eMode = 'mois', eFiles = [];

function loadScript(src) {
  return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Chargement ' + src)); document.head.appendChild(s); });
}
async function fetchBytes(url) { return new Uint8Array(await (await fetch(url)).arrayBuffer()); }

/* ---------- Écran export ---------- */
$('#btnExport').onclick = () => {
  const d = new Date();
  if (!$('#eMois').value) {
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    $('#eMois').value = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    $('#eAnnee').value = d.getFullYear();
    $('#eTrim').value = String(Math.floor(d.getMonth() / 3) + 1);
    $('#eDu').value = `${d.getFullYear()}-01-01`; $('#eAu').value = todayISO();
  }
  $('#eResult').hidden = true; show('scrExport'); updateSummary();
};
$$('#seg button').forEach(b => b.onclick = () => {
  eMode = b.dataset.mode;
  $$('#seg button').forEach(x => x.classList.toggle('on', x === b));
  $$('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== eMode);
  updateSummary();
});
['#eMois', '#eTrim', '#eAnnee', '#eDu', '#eAu'].forEach(s => $(s).addEventListener('input', updateSummary));

function period() {
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const last = (y, m) => new Date(y, m, 0).getDate();
  if (eMode === 'mois') {
    const [y, m] = $('#eMois').value.split('-').map(Number); if (!y) return null;
    return { du: `${y}-${String(m).padStart(2, '0')}-01`, au: `${y}-${String(m).padStart(2, '0')}-${last(y, m)}`,
      label: `${MOIS[m - 1]} ${y}`, slug: `${y}-${String(m).padStart(2, '0')}` };
  }
  if (eMode === 'trim') {
    const y = +$('#eAnnee').value, q = +$('#eTrim').value; if (!y) return null;
    const m1 = (q - 1) * 3 + 1, m3 = m1 + 2;
    return { du: `${y}-${String(m1).padStart(2, '0')}-01`, au: `${y}-${String(m3).padStart(2, '0')}-${last(y, m3)}`,
      label: `${q === 1 ? '1er' : q + 'e'} trimestre ${y}`, slug: `${y}-T${q}` };
  }
  const du = $('#eDu').value, au = $('#eAu').value; if (!du || !au || du > au) return null;
  return { du, au, label: `du ${frDate(du)} au ${frDate(au)}`, slug: `${du}_${au}` };
}
function selection(p) {
  return tickets.filter(t => t.date >= p.du && t.date <= p.au)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    .map((t, i) => ({ ...t, n: i + 1 }));
}
function totals(arr) {
  const s = k => Math.round(arr.reduce((a, t) => a + (t[k] || 0), 0) * 100) / 100;
  return { ht: s('ht'), tva: s('tva'), ttc: s('ttc') };
}
function updateSummary() {
  const p = period(); $('#eResult').hidden = true;
  if (!p) { $('#eSummary').textContent = 'Choisis une période valide.'; $('#btnGen').disabled = true; return; }
  const sel = selection(p), T = totals(sel);
  $('#btnGen').disabled = !sel.length;
  $('#eSummary').innerHTML = sel.length
    ? `<b>${sel.length} ticket(s)</b> — ${p.label}<br>Total TTC : <b>${euro(T.ttc)}</b><br>HT : ${euro(T.ht)} · TVA : ${euro(T.tva)}`
    : `Aucun ticket ${p.label.startsWith('du') ? '' : 'en '}${p.label}.`;
}

$('#btnGen').onclick = async () => {
  const p = period(); const sel = selection(p); if (!sel.length) return;
  const b = $('#btnGen'); b.disabled = true; b.textContent = 'Création en cours…';
  try {
    const base = `Depenses_CB_AOR_${p.slug}`;
    const xlsx = new File([await buildExcel(sel, p)], base + '.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const pdf = new File([await buildPDF(sel, p)], base + '_justificatifs.pdf', { type: 'application/pdf' });
    eFiles = [xlsx, pdf]; eFiles.period = p;
    $('#eFiles').innerHTML = eFiles.map(f => `<a href="${URL.createObjectURL(f)}" download="${f.name}">⬇ ${f.name} <small>(${(f.size / 1048576).toFixed(1)} Mo)</small></a>`).join('');
    $('#eResult').hidden = false; $('#eResult').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { console.error(e); toast('Erreur à l\'export : ' + e.message, 5000); }
  b.disabled = false; b.textContent = 'Créer l\'Excel + le PDF';
};
$('#btnShare').onclick = async () => {
  const p = eFiles.period;
  // Android ne laisse pas l'appli remplir le destinataire : on copie l'adresse pour la coller dans « À »
  if (settings.mail && navigator.clipboard) {
    navigator.clipboard.writeText(settings.mail).then(() => toast('Adresse de la comptable copiée : colle-la dans « À »', 4000)).catch(() => {});
  }
  const text = `Bonjour Madame,\n\nVeuillez trouver ci-joint le relevé des dépenses réglées par carte bancaire (${p.label}) : le tableau Excel et les justificatifs en PDF.\n\nBien cordialement,\nReda Ourdani\nAtelier AOR Architecture`;
  const ok = await shareOrDownload(eFiles, `Dépenses carte bancaire — ${p.label}`, text);
  if (ok && settings.mail && !(navigator.canShare && navigator.canShare({ files: eFiles }))) {
    location.href = `mailto:${settings.mail}?subject=${encodeURIComponent('Dépenses carte bancaire — ' + p.label)}&body=${encodeURIComponent(text)}`;
  }
};

/* ---------- Excel ---------- */
async function buildExcel(sel, p) {
  await loadScript('lib/exceljs.min.js');
  const wb = new ExcelJS.Workbook(); wb.creator = 'Atelier AOR Architecture';
  const logoId = wb.addImage({ buffer: await fetchBytes('img/logo.jpg'), extension: 'jpeg' });
  const F = (o = {}) => ({ name: 'Calibri', size: 11, ...o });
  const money = '#,##0.00 "€";-#,##0.00 "€";"–"';
  const thin = { style: 'thin', color: { argb: 'FFD0D4D1' } };

  function header(ws, titre, ncol) {
    ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 72, height: 72 } });
    ws.getRow(1).height = 20; ws.getRow(2).height = 18; ws.getRow(3).height = 18; ws.getRow(4).height = 8;
    ws.getCell('C1').value = titre; ws.getCell('C1').font = F({ size: 15, bold: true, color: { argb: 'FF' + ARD } });
    ws.getCell('C2').value = 'Période : ' + p.label; ws.getCell('C2').font = F({ size: 12, bold: true, color: { argb: 'FF' + ORA } });
    ws.getCell('C3').value = `Atelier AOR Architecture — Reda OURDANI — SIRET ${SIRET}`; ws.getCell('C3').font = F({ size: 9, color: { argb: 'FF6B736F' } });
    for (let c = 1; c <= ncol; c++) ws.getRow(4).getCell(c).border = { bottom: { style: 'medium', color: { argb: 'FF' + ORA } } };
  }
  function thead(ws, rowN, labels) {
    const r = ws.getRow(rowN); r.values = labels; r.height = 22;
    r.eachCell(c => { c.font = F({ bold: true, color: { argb: 'FFFFFFFF' } }); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + ARD } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
  }

  /* Feuille 1 : par date (numéros = annexe PDF) */
  const ws = wb.addWorksheet('Par date', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .4, right: .4, top: .5, bottom: .5, header: .3, footer: .3 } },
    headerFooter: { oddFooter: '&8Atelier AOR Architecture — Dépenses carte bancaire — page &P / &N' } });
  ws.columns = [{ width: 6 }, { width: 11 }, { width: 13 }, { width: 40 }, { width: 12 }, { width: 11 }, { width: 12 }];
  header(ws, 'Dépenses réglées par carte bancaire', 7);
  thead(ws, 6, ['N°', 'Date', 'Catégorie', 'Fournisseur / provenance', 'HT', 'TVA', 'TTC']);
  ws.views = [{ state: 'frozen', ySplit: 6 }];
  const first = 7;
  sel.forEach((t, i) => {
    const r = ws.getRow(first + i);
    r.values = [t.n, dateCell(t.date), CATS[t.cat].label, t.fournisseur, t.ht, t.tva, t.ttc];
    r.eachCell({ includeEmpty: true }, (c, k) => { c.font = F(); c.border = { bottom: thin };
      if (i % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F5F3' } }; });
    r.getCell(1).alignment = { horizontal: 'center' }; r.getCell(2).numFmt = 'dd/mm/yyyy'; r.getCell(2).alignment = { horizontal: 'center' };
    [5, 6, 7].forEach(k => r.getCell(k).numFmt = money);
  });
  const last = first + sel.length - 1, tr = ws.getRow(last + 1), T = totals(sel);
  tr.getCell(4).value = `TOTAL (${sel.length} ticket${sel.length > 1 ? 's' : ''})`;
  ['E', 'F', 'G'].forEach((L, k) => tr.getCell(5 + k).value = { formula: `SUM(${L}${first}:${L}${last})`, result: [T.ht, T.tva, T.ttc][k] });
  tr.eachCell({ includeEmpty: true }, (c, k) => { if (k > 7) return; c.font = F({ bold: true, color: { argb: 'FF' + ARD } });
    c.border = { top: { style: 'medium', color: { argb: 'FF' + ORA } } }; if (k >= 5) c.numFmt = money; });
  tr.getCell(4).alignment = { horizontal: 'right' };
  if (sel.some(t => t.tva == null)) {
    const n = ws.getRow(last + 3).getCell(1); n.value = '« – » : TVA non mentionnée sur le ticket.'; n.font = F({ size: 9, italic: true, color: { argb: 'FF6B736F' } });
  }

  /* Feuille 2 : par catégorie puis date, avec sous-totaux */
  const wc = wb.addWorksheet('Par catégorie', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  wc.columns = [{ width: 6 }, { width: 11 }, { width: 13 }, { width: 40 }, { width: 12 }, { width: 11 }, { width: 12 }];
  header(wc, 'Dépenses carte bancaire — par catégorie', 7);
  let row = 6; const sumRows = [];
  for (const [k, c] of Object.entries(CATS)) {
    const arr = sel.filter(t => t.cat === k); if (!arr.length) continue;
    const h = wc.getRow(row); h.getCell(1).value = c.label.toUpperCase();
    h.getCell(1).font = F({ bold: true, size: 12, color: { argb: 'FF' + ARD } });
    for (let i = 1; i <= 7; i++) h.getCell(i).border = { bottom: { style: 'thin', color: { argb: 'FF' + ORA } } };
    row++; thead(wc, row, ['N°', 'Date', 'Catégorie', 'Fournisseur / provenance', 'HT', 'TVA', 'TTC']); row++;
    const s0 = row;
    arr.forEach(t => { const r = wc.getRow(row++); r.values = [t.n, dateCell(t.date), c.label, t.fournisseur, t.ht, t.tva, t.ttc];
      r.eachCell({ includeEmpty: true }, x => { x.font = F(); x.border = { bottom: thin }; });
      r.getCell(1).alignment = { horizontal: 'center' }; r.getCell(2).numFmt = 'dd/mm/yyyy'; [5, 6, 7].forEach(i => r.getCell(i).numFmt = money); });
    const st = wc.getRow(row), TT = totals(arr); st.getCell(4).value = 'Sous-total ' + c.label; st.getCell(4).alignment = { horizontal: 'right' };
    ['E', 'F', 'G'].forEach((L, i) => { const x = st.getCell(5 + i); x.value = { formula: `SUM(${L}${s0}:${L}${row - 1})`, result: [TT.ht, TT.tva, TT.ttc][i] }; x.numFmt = money; });
    st.eachCell(x => x.font = F({ bold: true, color: { argb: 'FF' + ARD } }));
    sumRows.push(row); row += 2;
  }
  const g = wc.getRow(row); g.getCell(4).value = 'TOTAL GÉNÉRAL'; g.getCell(4).alignment = { horizontal: 'right' };
  ['E', 'F', 'G'].forEach((L, i) => { const x = g.getCell(5 + i); x.value = { formula: sumRows.map(r => L + r).join('+'), result: [T.ht, T.tva, T.ttc][i] }; x.numFmt = money; });
  for (let i = 4; i <= 7; i++) { const x = g.getCell(i); x.font = F({ bold: true, size: 12, color: { argb: 'FFFFFFFF' } }); x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + ARD } }; }

  return await wb.xlsx.writeBuffer();
}
function dateCell(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }

/* ---------- Annexe PDF : tickets à taille réelle ---------- */
async function buildPDF(sel, p) {
  await Promise.all([loadScript('lib/jspdf.umd.min.js'), loadScript('lib/carlito-Regular.js'), loadScript('lib/carlito-Bold.js')]);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('Calibri.ttf', window.FONT_Regular); doc.addFont('Calibri.ttf', 'Calibri', 'normal');
  doc.addFileToVFS('Calibri-Bold.ttf', window.FONT_Bold); doc.addFont('Calibri-Bold.ttf', 'Calibri', 'bold');
  doc.setProperties({ title: `Justificatifs dépenses CB — ${p.label}`, author: 'Atelier AOR Architecture', creator: 'Atelier AOR Architecture' });

  const ard = [0x34, 0x41, 0x3C], ora = [0xFD, 0x90, 0x19], gris = [0x6B, 0x73, 0x6F];
  const entete = await fetchBytes('img/entete.jpg'), logo = await fetchBytes('img/logo.jpg');
  const PW = 210, PH = 297, ML = 10, MR = 10, MB = 14, GAP = 6, CAP = 9;
  const T = totals(sel);

  function firstHeader() {
    const h = PW * 400 / 2400;  // proportion du bandeau
    doc.addImage(entete, 'JPEG', 0, 0, PW, h);
    let y = h + 9;
    doc.setFont('Calibri', 'bold'); doc.setFontSize(15); doc.setTextColor(...ard);
    doc.text('ANNEXE — JUSTIFICATIFS DE DÉPENSES PAR CARTE BANCAIRE', ML, y);
    y += 6; doc.setFontSize(12); doc.setTextColor(...ora); doc.text('Période : ' + p.label, ML, y);
    y += 3; doc.setDrawColor(...ora); doc.setLineWidth(0.6); doc.line(ML, y, PW - MR, y);
    y += 5; doc.setFont('Calibri', 'normal'); doc.setFontSize(10); doc.setTextColor(30, 38, 35);
    doc.text(`${sel.length} ticket${sel.length > 1 ? 's' : ''} — Total TTC ${euroPdf(T.ttc)} (HT ${euroPdf(T.ht)} — TVA ${euroPdf(T.tva)}). ` +
      'Tickets reproduits à taille réelle, classés par date ; les numéros renvoient au tableau Excel.', ML, y, { maxWidth: PW - ML - MR });
    return y + 9;
  }
  function nextHeader() {
    doc.addImage(logo, 'JPEG', ML, 6, 12, 12);
    doc.setFont('Calibri', 'bold'); doc.setFontSize(11); doc.setTextColor(...ard);
    doc.text('Justificatifs de dépenses par carte bancaire', ML + 15, 11);
    doc.setFont('Calibri', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...ora); doc.text('Période : ' + p.label, ML + 15, 15.5);
    doc.setDrawColor(...ora); doc.setLineWidth(0.5); doc.line(ML, 20, PW - MR, 20);
    return 25;
  }

  let top = firstHeader(), cols = [];
  const bottom = PH - MB;
  const newPage = () => { doc.addPage(); top = nextHeader(); cols = []; };
  const usedX = () => cols.length ? cols[cols.length - 1].x + cols[cols.length - 1].w + GAP : ML;

  for (const t of sel) {
    const pcs = t.photos, np = pcs.length;
    for (let k = 0; k < np; k++) {
      const pc = pcs[k];
      const bytes = new Uint8Array(await pc.blob.arrayBuffer());
      // taille réelle ; réduite seulement si la pièce ne tient pas (sur la 1re page, sous le bandeau, si elle est vide)
      const size = availH => { const W0 = pc.largeur || 80, H0 = W0 * pc.h / pc.w;
        const sc = Math.min(1, (PW - ML - MR) / W0, availH / H0); return [W0 * sc, H0 * sc, sc]; };
      let [w, h, scale] = size(bottom - 25 - CAP);
      if (!cols.length && top + h + CAP > bottom) [w, h, scale] = size(bottom - top - CAP);

      // ordre de lecture en colonnes (de haut en bas, puis colonne suivante) :
      // 1) sous la pièce précédente s'il reste la place, 2) une nouvelle colonne, 3) une nouvelle page
      const lastCol = cols[cols.length - 1];
      let col = (lastCol && lastCol.w >= w - 0.5 && lastCol.y + h + CAP <= bottom) ? lastCol : null;
      if (!col) {
        if (usedX() + w <= PW - MR + 0.01 && top + h + CAP <= bottom) { col = { x: usedX(), w, y: top }; cols.push(col); }
        else { newPage(); col = { x: ML, w, y: top }; cols.push(col); }
      }
      const x = col.x, y = col.y;
      doc.addImage(bytes, 'JPEG', x, y, w, h, t.id + '_' + k, 'NONE');   // photo intégrée telle quelle (pas de recompression)
      doc.setDrawColor(200, 204, 201); doc.setLineWidth(0.2); doc.rect(x, y, w, h);
      // légende
      doc.setFont('Calibri', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...ard);
      const l1 = `N° ${t.n}${np > 1 ? ` (${k + 1}/${np})` : ''} — ${frDate(t.date)} — ${euroPdf(t.ttc)} TTC`;
      doc.text(doc.splitTextToSize(l1, w)[0], x, y + h + 3.6);
      doc.setFont('Calibri', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...gris);
      const l2 = `${CATS[t.cat].label} — ${t.fournisseur}` + (scale < 0.999 ? ` (réduit à ${Math.round(scale * 100)} %)` : '');
      doc.text(doc.splitTextToSize(l2, w)[0], x, y + h + 7);
      col.y = y + h + CAP + 3;
    }
  }

  // pied de page
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont('Calibri', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...gris);
    doc.text(`Atelier AOR Architecture — 133 Quai de la Pie, 94100 Saint-Maur-des-Fossés — SIRET ${SIRET}`, ML, PH - 6);
    doc.text(`Page ${i} / ${n}`, PW - MR, PH - 6, { align: 'right' });
  }
  return doc.output('arraybuffer');
}
function euroPdf(v) { return (v == null) ? '–' : v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ | /g, ' ') + ' €'; }
