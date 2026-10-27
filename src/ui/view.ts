// Panels, modals, inspector and input handling.
import { BUSINESS_TYPES, DIFFICULTIES, MOTIVE_LABEL, cap, esc, fmtDate, fmtTime, pron } from '../data';
import { IDENTIFYING, PILLAR_LABEL, evaluateWarrant, submitCase } from '../da';
import type { Pillar, Verdict, WarrantRuling } from '../da';
import { docText, plain } from '../docs';
import type { ProofNode } from '../logic/engine';
import { QUESTIONS, QUESTION_ORDER, STATEMENT_LABEL, ask, confront, hasWarrant, isLawyered, sid } from '../interview';
import {
  K, W, addCard, addr, addrName, ballistics, bloodTest, bodyPrints, caseById, caseKey, caseOfItem, compareHand, compareType,
  coronerReport, curCase, dustItem, dustSpot, findCard, fullName, itemAddr, knows, log, lookup, newWorld, person, printLabel,
  printWhere, readItem, removeCard, searchSpot, shortAddr, startNewCase, takeItem, visit,
} from '../state';
import type { Card, CardType, DifficultyId, Item, ItemKind, StatementKind } from '../types';
import { Board } from './board';
import type { CardViewModel } from './board';

export const SAVE_KEY = 'casefile.save.v3';
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

type Tab = 'location' | 'directory' | 'report' | 'help';
let tab: Tab = 'location';
let modalCtx: string | null = null;
let modalRender: (() => void) | null = null;
let modalLocked = false;
let lastReport: { case: number; r: Verdict } | null = null;
let lastConfront: Record<string, string> = {};
let warrantRuling: WarrantRuling | null = null;
let confrontReply: { stmt: string; text: string; ok: boolean } | null = null;
let pendingSeed: number | null = null;

const ITEM_TYPE: Record<ItemKind, string> = {
  weapon: 'Weapon', body: 'Body', bullet: 'Ballistic evidence', shoeprint: 'Shoe print', shoes: 'Shoes',
  wallet: 'Personal effects', phone: 'Call log', addressbook: 'Address book', staff: 'Staff roster', timesheet: 'Timesheet',
  mailboxes: 'Mailbox labels', register: 'Gun register', tabs: 'Bar tabs', doc: 'Document',
  paper: 'Newspaper', keylog: 'Key register', door: 'Door', watch: 'Wristwatch', ticket: 'Bus ticket', typewriter: 'Typewriter',
  pawnledger: 'Pawn ledger', repairs: 'Repair ledger', knifeblock: 'Knife block',
};

// ---------- Helpers
function mk(text: string): string {
  return esc(text).replace(/\{(p|a|n):([^}]+)\}/g, (_m, k: string, v: string) => {
    if (k === 'p') return `<span class="ent ent-p" data-ent="p:${v}" title="Pin to board">${esc(fullName(v))}</span>`;
    if (k === 'a') return `<span class="ent ent-a" data-ent="a:${v}" title="Pin to board">${esc(addrName(v))}</span>`;
    return `<span class="ent ent-n" data-ent="n:${v}" title="Look up number">${esc(v)}</span>`;
  }).replace(/\n/g, '<br>');
}
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const live = () => !!W && W.cases.length > 0;

function itemTitle(it: Item): string {
  if (it.kind === 'body') {
    const c = caseOfItem(it.id)!;
    return K.victimId[c.id] ? `Body of ${fullName(c.victim)}` : 'Body (unidentified)';
  }
  if (it.kind === 'phone') return `Call log, ${shortAddr(it.data.addr!)}`;
  return it.name;
}
function labSummary(it: Item): string {
  const out: string[] = [];
  if (it.kind === 'weapon' && it.data.weaponType === 'gun') {
    const res = Object.entries(K.lab).filter(([k]) => k.startsWith(`bal:${it.id}:`)).map(([, v]) => v);
    if (res.includes('match')) out.push('Ballistics: MATCH');
    else if (res.length) out.push('Ballistics: no match');
  }
  if (K.lab['blood:' + it.id]) out.push(it.data.bloodOf ? 'Blood: human' : 'Blood: none');
  for (const [k, v] of Object.entries(K.lab)) {
    const [test, a, b] = k.split(':');
    if ((test === 'type' || test === 'hand') && (a === it.id || b === it.id)) {
      const other = W.items[a === it.id ? b : a];
      out.push(`${test === 'type' ? 'Typeface' : 'Handwriting'} vs ${other.name}: ${v === 'match' ? 'MATCH' : 'no match'}`);
    }
  }
  if (K.itemDusted[it.id]) {
    const ls = (it.prints || []).map(printLabel);
    out.push(ls.length ? 'Prints: ' + ls.join(', ') : 'No prints');
  }
  return out.join(' · ');
}
function cardLabel(c: Card): string { const v = cardView(c); return `${v.title} — ${v.type}`; }

function cardView(c: Card): CardViewModel {
  switch (c.type) {
    case 'person': {
      const p = person(c.ref!), lines: string[] = [];
      if (knows(p.id, 'job')) lines.push(`${p.job} @ ${addr(p.work).name}`);
      if (knows(p.id, 'home')) lines.push(addrName(p.home));
      if (knows(p.id, 'phone')) lines.push(`☎ ${addr(p.home).phone}`);
      if (K.samples[p.id]) lines.push(`Prints on file: ${printLabel(p.id)}`);
      const dead = W.cases.some(cs => cs.victim === p.id && K.victimId[cs.id]);
      if (dead) lines.push('✝ DECEASED');
      if (p.arrested) lines.push('IN CUSTODY');
      return { cls: 'person', type: 'Person', title: fullName(p.id), lines, flag: dead };
    }
    case 'address': {
      const a = addr(c.ref!), cs = W.cases.find(x => x.scene === a.id);
      const type = cs ? `Crime scene · case #${cs.id}` : a.kind === 'business' ? BUSINESS_TYPES[a.biz!].label : a.kind === 'lobby' ? 'Building lobby' : 'Residence';
      return { cls: 'address', type, title: addrName(a.id), lines: [a.phone ? `☎ ${a.phone}` : '', K.visited[a.id] ? '' : 'Not visited yet'], flag: !!cs };
    }
    case 'item': {
      const it = W.items[c.ref!], s = W.spots[it.spot];
      const cls = it.kind === 'weapon' ? 'weapon' : it.kind === 'body' ? 'body' : 'item';
      return { cls, type: ITEM_TYPE[it.kind], title: itemTitle(it), lines: [`${s.name}, ${shortAddr(s.addr)}`, labSummary(it)] };
    }
    case 'print': {
      const blood = (K.printFound[c.ref!] || []).some(l => l.blood);
      return { cls: 'print', type: 'Fingerprint', title: `Print ${printLabel(c.ref!)}`, flag: blood,
        lines: [K.samples[c.ref!] ? `= ${fullName(c.ref!)}` : 'Unidentified', blood ? 'Found IN BLOOD' : '', `Found in ${(K.printFound[c.ref!] || []).length} place(s)`] };
    }
    case 'statement': {
      const st = K.statements[c.ref!];
      const caught = K.confronted[st.id] ? ' · LIE EXPOSED' : '';
      return { cls: 'statement', type: `${STATEMENT_LABEL[st.kind]} · #${st.case}${caught}`, title: fullName(st.pid), lines: [trunc(plain(st.text), 90)], flag: !!K.confronted[st.id] };
    }
    case 'unknown': return { cls: 'unknown', type: 'Unknown person', title: c.title || 'Unknown person', lines: [trunc(c.notes || '', 90)] };
    default: return { cls: 'note', type: 'Note', title: c.title || 'Note', lines: [trunc(c.notes || '', 90)] };
  }
}

function toast(msg: string) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout((toast as unknown as { timer: number }).timer);
  (toast as unknown as { timer: number }).timer = window.setTimeout(() => t.classList.remove('show'), 2200);
}

let saveTimer = 0;
export function save() {
  if (!live()) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ W, K })); } catch { /* storage unavailable */ } }, 300);
}

// ---------- Global render
export function refresh() {
  if (!live()) return;
  renderHeader();
  renderTab();
  Board.render();
  renderInspector();
  modalRender?.();
  save();
}
function renderHeader() {
  const c = curCase();
  $('#caseTitle').innerHTML = `Case #${c.id} — Homicide · ${esc(addrName(c.scene))} · ${fmtDate(c.day)} `
    + `<span class="badge diff-${c.difficulty}">${DIFFICULTIES[c.difficulty].label.toUpperCase()}</span>`
    + (c.solved ? '<span class="badge ok">CLOSED</span>' : '<span class="badge">OPEN</span>');
}
export function switchTab(t: Tab) {
  tab = t;
  document.querySelectorAll<HTMLElement>('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll<HTMLElement>('.tab').forEach(el => { el.hidden = el.id !== 'tab-' + t; });
  renderTab();
}
function renderTab() {
  if (!live()) return;
  if (tab === 'location') renderLocation();
  else if (tab === 'directory') renderDirectory();
  else if (tab === 'report') renderReport();
  else renderHelp();
}

// ---------- Location
function renderLocation() {
  const el = $('#tab-location'), a = addr(K.current), b = W.buildings[a.building];
  const scene = W.cases.find(x => x.scene === a.id);
  const kicker = { business: a.biz ? BUSINESS_TYPES[a.biz].label : '', lobby: 'Apartment building', home: 'Residence', payphone: 'Street payphone' }[a.kind];
  let h = `<div class="loc-h"><div class="kicker">${kicker}`
    + `${scene ? ` <span class="badge red">CRIME SCENE #${scene.id}</span>` : ''}</div>`
    + `<h2>${esc(addrName(a.id))}</h2>${a.phone ? `<div class="sub">☎ ${a.phone}</div>` : ''}`
    + `<div class="row">${findCard('address', a.id) ? '<span class="muted">✓ on board</span>' : `<button data-act="pin-addr" data-id="${a.id}">Pin address to board</button>`}`
    + (a.kind === 'home' ? ` <button data-act="go" data-id="${b.lobby}">Building lobby</button>` : '') + '</div></div>';

  if (a.kind === 'lobby') {
    h += '<div class="sec"><h4>Apartments</h4>';
    for (const id of b.addresses) if (addr(id).kind === 'home') h += `<div class="li"><span>Apt ${addr(id).unit}</span><button data-act="go" data-id="${id}">Knock</button></div>`;
    h += '</div>';
  }

  for (const sid of a.spots) {
    const s = W.spots[sid];
    h += `<div class="spot"><div class="spot-h"><b>${esc(s.name)}</b><span>`
      + (K.searched[sid] ? '' : `<button data-act="search" data-id="${sid}">Search</button>`)
      + (K.dusted[sid] ? '' : ` <button data-act="dust" data-id="${sid}">Dust for prints</button>`) + '</span></div>';
    if (K.searched[sid]) {
      if (!s.items.length) h += '<div class="muted">Nothing of interest.</div>';
      for (const iid of s.items) {
        const it = W.items[iid];
        h += `<div class="li"><span class="${it.kind === 'body' || it.kind === 'weapon' ? 'hot' : ''}">${esc(itemTitle(it))}</span><span>`
          + `<button data-act="examine" data-id="${iid}">Examine</button> `
          + (K.taken[iid] ? '<span class="muted">✓ board</span>' : `<button data-act="take" data-id="${iid}">Take</button>`) + '</span></div>';
      }
    }
    if (K.dusted[sid]) {
      const chips = [...s.bloodPrints.map(p => printChip(p, true)), ...s.prints.map(p => printChip(p))];
      h += `<div class="prints">${chips.length ? chips.join('') : '<span class="muted">No usable prints.</span>'}</div>`;
    }
    h += '</div>';
  }

  if (a.kind === 'home' || a.kind === 'business') {
    const ppl = (a.kind === 'home' ? a.residents : a.employees).filter(id => person(id).alive && !person(id).arrested);
    h += '<div class="sec"><h4>People here</h4>';
    if (!ppl.length) h += '<div class="muted">Nobody answers.</div>';
    for (const pid of ppl) h += `<div class="li"><span>${esc(fullName(pid))}${a.kind === 'business' ? ` <span class="muted">· ${esc(person(pid).job)}</span>` : ''}</span><button data-act="talk" data-id="${pid}">Talk</button></div>`;
    h += '</div>';
  }

  const places = Object.values(K.board.cards).filter(x => x.type === 'address' && x.ref !== a.id);
  if (places.length) {
    h += '<div class="sec"><h4>Places on your board</h4>';
    for (const p of places) h += `<div class="li"><span>${esc(addrName(p.ref!))}</span><button data-act="go" data-id="${p.ref}">Go</button></div>`;
    h += '</div>';
  }
  el.innerHTML = h;
}
function printChip(pid: string, blood = false): string {
  return `<span class="chip${blood ? ' blood' : ''}" data-act="pin-print" data-id="${pid}" title="Pin to board">${blood ? '🩸 ' : ''}Print ${printLabel(pid)}${K.samples[pid] ? ` · ${esc(fullName(pid))}` : ''}</span>`;
}

// ---------- Directory
function renderDirectory() {
  const q = $<HTMLInputElement>('#dirQuery').value.trim().toLowerCase(), out = $('#dirResults');
  if (q.length < 2) { out.innerHTML = '<p class="muted">The city telephone directory lists every resident and business with their number and address. Type at least two characters.</p>'; return; }
  const rows: string[] = [];
  for (const p of Object.values(W.people)) {
    const ph = addr(p.home).phone!;
    if (`${p.first} ${p.last}`.toLowerCase().includes(q) || ph.includes(q)) rows.push(`<div class="dir"><div><b>${esc(fullName(p.id))}</b><br><span class="muted">☎ ${ph} · ${esc(addrName(p.home))}</span></div>`
      + `<div class="btns"><button data-act="dir-person" data-id="${p.id}">Pin person</button><button data-act="dir-addr" data-id="${p.home}" data-pid="${p.id}">Pin address</button></div></div>`);
  }
  for (const a of Object.values(W.addresses)) {
    if (a.kind !== 'business' && a.kind !== 'payphone') continue;
    const name = a.kind === 'payphone' ? 'Payphone' : a.name!, label = a.kind === 'payphone' ? 'Public telephone' : BUSINESS_TYPES[a.biz!].label;
    if (`${name} ${W.buildings[a.building].street}`.toLowerCase().includes(q) || a.phone!.includes(q)) rows.push(`<div class="dir"><div><b>${esc(name)}</b> <span class="muted">(${label})</span><br><span class="muted">☎ ${a.phone} · ${esc(W.buildings[a.building].street)}</span></div>`
      + `<div class="btns"><button data-act="dir-addr" data-id="${a.id}">Pin address</button></div></div>`);
  }
  out.innerHTML = rows.length ? rows.slice(0, 40).join('') + (rows.length > 40 ? '<p class="muted">More results… refine your search.</p>' : '') : '<p class="muted">No listing found.</p>';
}

// ---------- Case report
const DA_STANDARD = `<div class="box"><b>The DA's standard.</b> Charges are filed when at least <b>3 of 4</b> pillars are proven against the suspect, so at least one is <b>Means</b> or <b>Presence</b>, the kind of evidence only the killer can have. The DA reasons only from the cards you submit; how you arrange your board is up to you.
  <ul><li><b>Means</b> — the murder weapon, confirmed by the lab, tied to the suspect: found in their home, their prints on it, its serial number traced through the gun register (and any pawn shop), or the gap it left in their knife block.</li>
  <li><b>Presence</b> — the suspect in the apartment during the killing: prints <i>in blood</i>, shoes that left the bloody print (whose shoes? the bedroom they were found in, or a repair tag), an admission — or, if the door was locked with a key, being the only key holder who can't account for the time of death.</li>
  <li><b>Motive</b> — a document or witness describing a conflict. Initials and anonymous letters count once you show who wrote them: the only match in the victim's address book (for the victim's own notes), the typewriter and staff roster, or a handwriting comparison.</li>
  <li><b>Opportunity</b> — the suspect's account of the night proven false, or the suspect placed near the scene close to the time of death.</li></ul>
  <b>What counts against an account:</b> records (tab books, timesheets, call logs, tickets) and other people's statements that place someone elsewhere. Tab books and timesheets are complete: if someone isn't in them, they weren't there. A friend's word <i>for</i> someone never counts as an alibi.</div>`;

function renderReport() {
  const el = $('#tab-report'), c = curCase(), f = K.form, cards = Object.values(K.board.cards);
  if (c.solved) {
    el.innerHTML = `<div class="closed"><h2>Case #${c.id} closed</h2><p>${esc(fullName(c.killer))} has been charged with the murder of ${esc(fullName(c.victim))}.</p>`
      + `<p class="muted">DA submissions: ${c.attempts}</p><button class="primary" data-act="pick-case">Take the next case</button></div>`
      + proofBox(c.proof);
    return;
  }
  const opts = (filter: (x: Card) => boolean, sel: string | null, placeholder = 'pick a card from your board') => `<option value="">— ${placeholder} —</option>`
    + cards.filter(filter).map(x => `<option value="${x.id}"${x.id === sel ? ' selected' : ''}>${esc(cardLabel(x))}</option>`).join('');
  const isWeapon = (x: Card) => x.type === 'item' && W.items[x.ref!].kind === 'weapon';
  const isEv = (x: Card) => ['item', 'print', 'statement'].includes(x.type) && !f.evidence.includes(x.id);
  let h = `<h2>Case report #${c.id}</h2><p class="muted">Homicide at ${esc(addrName(c.scene))}, night of ${fmtDate(c.day)}. Every field is filled from cards on your board.</p>`
    + `<label>Victim</label><select data-form="victim">${opts(x => x.type === 'person', f.victim)}</select>`
    + `<label>Suspect</label><select data-form="suspect">${opts(x => x.type === 'person', f.suspect)}</select>`
    + `<label>Murder weapon <span class="muted">(Means)</span></label><select data-form="weapon">${opts(isWeapon, f.weapon)}</select>`
    + '<label>Supporting evidence</label><div class="evlist">';
  if (!f.evidence.length) h += '<div class="muted">None yet.</div>';
  f.evidence.forEach((cid, i) => { const x = K.board.cards[cid]; if (x) h += `<div class="li"><span>${esc(cardLabel(x))}</span><button data-act="form-rm" data-i="${i}">✕</button></div>`; });
  h += `</div><select data-form="add">${opts(isEv, null, 'add evidence…')}</select>`
    + '<div class="row"><button class="primary" data-act="submit">Submit to the District Attorney</button></div>' + DA_STANDARD;
  if (lastReport && lastReport.case === c.id) h += `<div class="box warn"><b>Last DA response:</b> ${lastReport.r.count} of 4 pillars.</div>`;
  el.innerHTML = h;
}

/** A derivation as nested bullets: each fact, then what it rests on. */
function proofTree(n: ProofNode, depth = 0): string {
  const kids = n.children.length ? `<ul>${n.children.map(ch => `<li>${proofTree(ch, depth + 1)}</li>`).join('')}</ul>` : '';
  return `<span class="${n.children.length ? '' : 'leaf'}">${esc(n.text)}</span>${kids}`;
}
function proofBox(lines: string[]): string {
  if (!lines.length) return '';
  return `<details class="proof"><summary>The shortest proof that existed</summary><div class="lines">${lines.map(l => {
    const depth = l.length - l.trimStart().length;
    return `<div style="padding-left:${depth * 7}px">${esc(l.trim())}</div>`;
  }).join('')}</div></details>`;
}

function showVerdict(r: Verdict) {
  const c = curCase();
  let h = r.ok ? '<h2 class="ok">CHARGES FILED</h2>' : '<h2 class="bad">INSUFFICIENT EVIDENCE</h2>';
  h += `<p>Victim: ${r.victimOk ? '✔ identified' : '✘ not established'}${r.suspect ? ` · Suspect: <b>${esc(fullName(r.suspect))}</b>` : ''}</p><div class="pillars">`;
  for (const k of Object.keys(PILLAR_LABEL) as Pillar[]) {
    const a = r.pillars[k], ident = IDENTIFYING.includes(k);
    h += `<div class="pillar ${a ? 'yes' : 'no'}"><b>${a ? '✔' : '✘'} ${PILLAR_LABEL[k]}${ident ? ' <span class="tag">identifying</span>' : ''}</b>`
      + (a ? `<div class="tree">${proofTree(a)}</div>` : '<div class="muted">Not proven.</div>') + '</div>';
  }
  h += '</div>';
  if (r.notes.length) h += `<h4>The DA's notes</h4><ul class="notes">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`;
  if (r.ok) {
    const k = person(c.killer);
    h += `<div class="box"><b>What happened.</b> ${esc(fullName(c.killer))} killed ${esc(fullName(c.victim))} at about ${fmtTime(c.time)} with a ${esc(c.weaponName.toLowerCase())}. Motive: ${MOTIVE_LABEL[c.motive]}.`
      + ` ${cap(pron(k).subj)} is now in custody. Submissions to the DA: ${c.attempts}.</div>`
      + proofBox(c.proof)
      + '<div class="row"><button class="primary" data-act="pick-case">Take the next case</button></div>';
  } else h += '<p class="muted">The DA needs 3 of the 4 pillars. Keep investigating.</p>';
  openModal(() => h, null);
}

// ---------- Help
function renderHelp() {
  $('#tab-help').innerHTML = `<h2>How to investigate</h2>
  <p>You are a homicide detective, so there's no rent, no lockpicks and no trespassing. Your job is to build a case the District Attorney will accept. The DA files charges only when the evidence proves it.</p>
  <h4>The loop</h4>
  <ol>
    <li><b>Search</b> each area of a location and <b>Examine</b> what you find. Names, addresses and phone numbers in documents can be clicked to pin them, and numbers open the directory.</li>
    <li><b>Dust for prints.</b> Each person always leaves the same print letter. A print gets a name only after you take a known sample: from the body, or from someone in an interview. Prints <b>in blood</b> were left during the killing; ordinary prints only show someone was there at some point.</li>
    <li><b>Take</b> evidence to pin it. Select a card on the board for lab work: ballistics, blood, dusting a weapon, the coroner's report, and comparing a typed letter with a typewriter or two handwritten documents.</li>
    <li><b>Pin down the time of death.</b> The coroner's estimate is wide. A call the victim answered, a smashed watch, a neighbour who heard the shot: each narrows it. It matters when you need to show where someone was <i>at that moment</i>.</li>
    <li><b>Talk</b> to people. Ask for alibis and who the victim had trouble with. <b>People lie</b> on Normal and Hard, innocent ones included: about affairs, drinking, visits they'd rather hide. Some lie <i>for</i> someone else. <b>Confront</b> a statement with the cards that disprove it (one or several: a call log plus the statement that explains it, say) and see what they say then.</li>
    <li>If someone refuses fingerprints, <b>request a warrant</b>: the judge needs two cards that connect them to the victim.</li>
    <li><b>Travel</b> to any address pinned to your board. Use the <b>Directory</b> to turn names and numbers into addresses.</li>
    <li>Fill in the <b>Case report</b> from board cards and submit it.</li>
  </ol>
  ${DA_STANDARD}
  <h4>Difficulty</h4><ul>${Object.values(DIFFICULTIES).map(d => `<li><b>${d.label}</b> — ${esc(d.blurb)}</li>`).join('')}</ul>
  <h4>Board controls</h4>
  <ul><li>Drag cards; drag the background to pan; scroll to zoom.</li><li>Shift-click a second card (or use "Link to…") to tie a string. Click a string to cut it.</li>
  <li>Double-click a card to open it. Add notes and "unknown person" cards for leads without a name.</li></ul>
  <h4>Case log</h4><div class="log">${K.log.map(l => `<div><span class="muted">${fmtDate(l.day)}</span> ${esc(l.msg)}</div>`).join('')}</div>`;
}

// ---------- Inspector
function renderInspector() {
  const el = $('#inspector'), cid = Board.selected, c = cid ? K.board.cards[cid] : null;
  if (!c || !cid) { el.hidden = true; return; }
  el.hidden = false;
  const v = cardView(c), cs = curCase();
  let h = `<div class="insp-h"><span class="ctype">${esc(v.type)}</span><button class="x" data-act="deselect">×</button></div>`;
  const act = (a: string, label: string, extra = '') => `<button data-act="${a}" ${extra}>${label}</button>`;
  const btns: string[] = [];
  const unknownField = '<span class="muted">unknown</span>';

  if (c.type === 'note' || c.type === 'unknown') h += `<input class="title-in" data-title="${cid}" value="${esc(c.title || '')}" placeholder="${c.type === 'unknown' ? 'Unknown person' : 'Note title'}">`;
  else h += `<h3>${esc(v.title)}</h3>`;

  if (c.type === 'person') {
    const p = person(c.ref!);
    h += '<dl>'
      + `<dt>Phone</dt><dd>${knows(p.id, 'phone') ? addr(p.home).phone : unknownField}</dd>`
      + `<dt>Home</dt><dd>${knows(p.id, 'home') ? mk(`{a:${p.home}}`) : unknownField}</dd>`
      + `<dt>Work</dt><dd>${knows(p.id, 'work') ? mk(`${p.job} at {a:${p.work}}`) : unknownField}</dd>`
      + `<dt>Looks</dt><dd>${knows(p.id, 'look') ? `${p.age}, ${p.look.height}, ${p.look.build} build, ${p.look.hair} hair, ${p.look.eyes} eyes` : '<span class="muted">never met</span>'}</dd>`
      + `<dt>Prints</dt><dd>${K.samples[p.id] ? printChip(p.id) : '<span class="muted">no sample</span>'}</dd>`
      + `<dt>Shoes</dt><dd>${knows(p.id, 'shoes') ? `size ${p.shoe.size}, ${p.shoe.sole} sole, ${p.shoe.wear}` : unknownField}</dd></dl>`;
    if (!knows(p.id, 'home')) btns.push(act('lookup', 'Look up in directory', `data-id="${p.id}"`));
    if (knows(p.id, 'home')) btns.push(act('go', 'Go to home', `data-id="${p.home}"`));
    if (knows(p.id, 'work')) btns.push(act('go', 'Go to workplace', `data-id="${p.work}"`));
    if (!cs.solved) btns.push(act('form-set', 'Name as victim', `data-field="victim" data-id="${cid}"`), act('form-set', 'Name as suspect', `data-field="suspect" data-id="${cid}"`));
  } else if (c.type === 'address') {
    const a = addr(c.ref!);
    h += `<p class="muted">${a.phone ? '☎ ' + a.phone + ' · ' : ''}${K.visited[a.id] ? 'Visited' : 'Not visited yet'}</p>`;
    btns.push(act('go', 'Go here', `data-id="${a.id}"`));
  } else if (c.type === 'item') {
    const it = W.items[c.ref!], s = W.spots[it.spot];
    h += `<p class="muted">Found: ${esc(s.name)}, ${mk(`{a:${s.addr}}`)}</p><div class="doc small">${mk(docText(it))}</div>`;
    if (K.itemDusted[it.id]) h += `<div class="prints">${(it.prints || []).length ? it.prints!.map(p => printChip(p)).join('') : '<span class="muted">No usable prints on it.</span>'}</div>`;
    const lab = labSummary(it);
    if (lab) h += `<p><b>Lab:</b> ${esc(lab)}</p>`;
    if (K.lab['blood:' + it.id] && it.data.bloodOf) {
      const bc = W.cases.find(x => x.victim === it.data.bloodOf)!;
      h += `<p><b>Blood analysis:</b> ${K.victimId[bc.id] ? `matches the victim, ${esc(fullName(it.data.bloodOf))}` : `matches the body found at ${esc(addrName(bc.scene))}`}.</p>`;
    } else if (K.lab['blood:' + it.id]) h += '<p><b>Blood analysis:</b> no blood found.</p>';
    btns.push(act('read', 'Open', `data-id="${it.id}"`));
    if (it.prints && !K.itemDusted[it.id]) btns.push(act('dust-item', 'Dust for prints', `data-id="${it.id}"`));
    if (it.kind === 'weapon' && it.data.weaponType === 'gun') {
      const bullets = Object.values(K.board.cards).filter(x => x.type === 'item' && W.items[x.ref!].kind === 'bullet');
      for (const bc of bullets) if (!K.lab[`bal:${it.id}:${bc.ref}`]) btns.push(act('ballistics', `Ballistics vs ${esc(itemTitle(W.items[bc.ref!]))} (${esc(shortAddr(itemAddr(bc.ref!)))})`, `data-id="${it.id}" data-b="${bc.ref}"`));
      if (!bullets.length) h += '<p class="muted">Pin a bullet to the board to run a ballistics comparison.</p>';
    }
    if (it.kind === 'weapon' && it.data.weaponType !== 'gun' && !K.lab['blood:' + it.id]) btns.push(act('blood', 'Blood analysis', `data-id="${it.id}"`));
    const boardItems = Object.values(K.board.cards).filter(x => x.type === 'item' && x.ref !== it.id).map(x => W.items[x.ref!]);
    if (it.data.typed) {
      const tws = boardItems.filter(o => o.kind === 'typewriter');
      for (const tw of tws) if (!K.lab[`type:${it.id}:${tw.id}`]) btns.push(act('typeface', `Compare typeface with ${esc(tw.name)}`, `data-id="${it.id}" data-b="${tw.id}"`));
      if (!tws.length) h += '<p class="muted">Pin a typewriter to the board to compare the typeface.</p>';
    }
    if (it.data.hand) {
      const docs = boardItems.filter(o => o.data.hand);
      for (const o of docs) if (!K.lab[`hand:${it.id}:${o.id}`] && !K.lab[`hand:${o.id}:${it.id}`]) btns.push(act('handwriting', `Compare handwriting with ${esc(o.name)}`, `data-id="${it.id}" data-b="${o.id}"`));
      if (!docs.length) h += '<p class="muted">Pin another handwritten document to compare the handwriting.</p>';
    }
    if (it.kind === 'body') {
      if (!K.lab['bodyprints:' + it.id]) btns.push(act('bodyprints', 'Take fingerprints from body', `data-id="${it.id}"`));
      if (!K.lab['coroner:' + it.id]) btns.push(act('coroner', "Request coroner's report", `data-id="${it.id}"`));
    }
    if (!cs.solved) {
      if (it.kind === 'weapon') btns.push(act('form-set', 'Name as murder weapon', `data-field="weapon" data-id="${cid}"`));
      if (!K.form.evidence.includes(cid)) btns.push(act('form-add', 'Add to case evidence', `data-id="${cid}"`));
    }
  } else if (c.type === 'print') {
    const pid = c.ref!;
    h += `<p>${K.samples[pid] ? `Matched to known sample of ${mk(`{p:${pid}}`)}.` : 'Not matched to any known sample yet. Ask people for their prints, or get a warrant.'}</p><h4>Found at</h4><ul>`;
    for (const l of K.printFound[pid] || []) h += `<li>${esc(printWhere(l))}</li>`;
    if (!(K.printFound[pid] || []).length) h += '<li class="muted">Only on file.</li>';
    h += '</ul>';
    if (!cs.solved && !K.form.evidence.includes(cid)) btns.push(act('form-add', 'Add to case evidence', `data-id="${cid}"`));
  } else if (c.type === 'statement') {
    const st = K.statements[c.ref!];
    const q = st.kind in QUESTIONS ? QUESTIONS[st.kind as keyof typeof QUESTIONS](caseById(st.case)) : STATEMENT_LABEL[st.kind];
    h += `<p class="muted">Given by ${mk(`{p:${st.pid}}`)} · case #${st.case}</p><p class="q">${esc(q)}</p><div class="doc small">“${mk(st.text)}”</div>`;
    if (K.confronted[st.id]) h += '<p><b>Exposed as a lie.</b></p>';
    if (!cs.solved && !K.form.evidence.includes(cid)) btns.push(act('form-add', 'Add to case evidence', `data-id="${cid}"`));
  }

  h += `<label>Notes</label><textarea data-notes="${cid}" placeholder="Your notes…">${esc(c.notes || '')}</textarea>`;
  btns.push(act('linkmode', Board.linkFrom === cid ? 'Click a card to link…' : 'Link to…'), '<button data-act="remove" class="danger">Remove card</button>');
  h += `<div class="btns">${btns.join('')}</div>`;
  el.innerHTML = h;
}

export function onCardOpen(cid: string) {
  const c = K.board.cards[cid];
  if (!c) return;
  if (c.type === 'item') openDoc(c.ref!);
  else if (c.type === 'address') { visit(c.ref!); switchTab('location'); refresh(); }
}

// ---------- Modals
function openModal(render: () => string, ctx: string | null, locked = false) {
  modalCtx = ctx;
  modalLocked = locked;
  modalRender = () => { $('#modalContent').innerHTML = render(); };
  modalRender();
  $('#modal').hidden = false;
  $('#modal .close').hidden = locked;
}
function closeModal() {
  if (modalLocked) return;
  $('#modal').hidden = true;
  modalRender = null;
  modalCtx = null;
}

function openDoc(iid: string) {
  readItem(iid);
  openModal(() => {
    const it = W.items[iid], s = W.spots[it.spot], tc = findCard('item', iid);
    modalCtx = tc ? tc.id : null;
    return `<div class="kicker">${esc(ITEM_TYPE[it.kind])} · ${esc(s.name)}, ${esc(addrName(s.addr))}</div><h2>${esc(itemTitle(it))}</h2>`
      + `<div class="doc">${mk(docText(it))}</div><div class="row">`
      + (K.taken[iid] ? `<span class="muted">✓ Pinned to your board${it.prints || it.kind === 'body' || it.kind === 'weapon' ? ' — select the card for lab work' : ''}</span>` : `<button class="primary" data-act="take" data-id="${iid}">Take as evidence</button>`)
      + '</div>';
  }, findCard('item', iid)?.id ?? null);
  refreshQuiet();
}

function confrontable(): Card[] {
  const cur = curCase().id;
  return Object.values(K.board.cards).filter(x => x.type === 'item' || (x.type === 'statement' && K.statements[x.ref!].case === cur));
}

function statementBlock(stId: string): string {
  const st = K.statements[stId];
  let h = `<div class="a">${mk(st.text)}</div><div class="a-actions">`
    + (findCard('statement', stId) ? '<span class="muted">✓ statement on board</span>' : `<button data-act="pin-stmt" data-id="${stId}">Pin statement</button>`);
  const canConfront = (st.kind === 'alibi' || st.kind === 'alibi2') && st.said.length > 0 && !K.confronted[stId] && !isLawyered(st.pid) && st.case === curCase().id;
  if (canConfront) h += ` <button data-act="confront" data-id="${stId}">Confront…</button>`;
  if (K.confronted[stId]) h += ' <span class="badge red">LIE EXPOSED</span>';
  h += '</div>';
  if (lastConfront[stId]) h += `<div class="reply">${mk(lastConfront[stId])}</div>`;
  return h;
}

function openInterview(pid: string) {
  openModal(() => {
    const p = person(pid), c = curCase(), pc = findCard('person', pid), lawyered = isLawyered(pid);
    modalCtx = pc ? pc.id : null;
    let h = `<div class="kicker">Interview · ${esc(addrName(K.current))}</div><h2>${esc(fullName(pid))}${lawyered ? ' <span class="badge red">LAWYERED UP</span>' : ''}</h2>`
      + `<p class="muted">${p.age}, ${p.look.height}, ${p.look.build} build, ${p.look.hair} hair, ${p.look.eyes} eyes.</p><div class="qa">`;
    for (const q of QUESTION_ORDER) {
      if ((q === 'victim' || q === 'enemies') && !K.victimId[c.id]) continue;
      const id = `s${c.id}-${pid}-${q}`;
      h += `<div class="q">“${esc(QUESTIONS[q](c))}”</div>`;
      if (q === 'prints') {
        if (K.samples[pid]) h += `<div class="a">${mk(K.answers[id] || 'You already have my prints on file.')}</div><div>${printChip(pid)} <span class="muted">${(K.printFound[pid] || []).length ? `— found in ${K.printFound[pid].length} place(s) you dusted` : '— no match among prints you have lifted so far'}</span></div>`;
        else if (K.answers[id]) {
          h += `<div class="a">${mk(K.answers[id])}</div>`;
          h += hasWarrant(pid) ? `<div><button class="primary" data-act="ask" data-id="${pid}" data-q="prints">Serve the warrant</button></div>`
            : `<div><button data-act="warrant" data-id="${pid}">Request a warrant…</button></div>`;
        } else h += `<div><button data-act="ask" data-id="${pid}" data-q="prints">Ask</button></div>`;
        continue;
      }
      if (q === 'who') {
        h += K.answers[id] ? `<div class="a">${mk(K.answers[id])}</div>` : lawyered ? '<div class="muted">— won\'t answer without a lawyer.</div>' : `<div><button data-act="ask" data-id="${pid}" data-q="who">Ask</button></div>`;
        continue;
      }
      if (K.statements[id]) {
        h += statementBlock(id);
        if (q === 'alibi') for (const k of ['alibi2', 'admission'] as StatementKind[]) {
          const fid = sid(c, pid, k);
          if (K.statements[fid]) h += `<div class="q follow">${k === 'admission' ? 'Under pressure:' : 'Revised story:'}</div>` + statementBlock(fid);
        }
        if (q === 'alibi' && lastConfront[`${id}:lawyer`]) h += `<div class="reply">${mk(lastConfront[`${id}:lawyer`])}</div>`;
      } else h += lawyered ? '<div class="muted">— won\'t answer without a lawyer.</div>' : `<div><button data-act="ask" data-id="${pid}" data-q="${q}">Ask</button></div>`;
    }
    h += `</div><div class="row">${pc ? '<span class="muted">✓ person on board</span>' : `<button data-act="pin-person" data-id="${pid}">Pin person to board</button>`}</div>`;
    return h;
  }, null);
}

function openConfront(stId: string) {
  confrontReply = null;
  openModal(() => {
    const st = K.statements[stId], pid = st.pid;
    let h = `<div class="kicker">Confrontation</div><h2>${esc(fullName(pid))}</h2><div class="doc small">“${mk(st.text)}”</div>`
      + '<p class="muted">Pick the cards that prove this account false. Several cards can work together: a call log and the statement that explains it, a tab book, someone else\'s revised story…</p>';
    if (confrontReply && confrontReply.stmt === stId) {
      h += `<div class="reply">${mk(confrontReply.text)}</div>`;
      if (confrontReply.ok) return h + `<div class="row"><button class="primary" data-act="talk" data-id="${pid}">Back to the interview</button></div>`;
    }
    const cards = confrontable();
    h += '<div class="checklist">' + (cards.length ? cards.map(x => `<label class="check"><input type="checkbox" data-confront-card="${x.id}"> ${esc(cardLabel(x))}</label>`).join('') : '<p class="muted">Your board has no evidence yet.</p>') + '</div>'
      + `<div class="row"><button class="primary" data-act="confront-submit" data-id="${stId}">Confront</button><button data-act="talk" data-id="${pid}">Cancel</button></div>`;
    return h;
  }, null);
}

function openWarrant(pid: string) {
  warrantRuling = null;
  openModal(() => {
    const cards = Object.values(K.board.cards).filter(x => x.type === 'item' || x.type === 'statement');
    let h = `<div class="kicker">Warrant application · fingerprints</div><h2>${esc(fullName(pid))}</h2>`
      + '<p class="muted">The judge will order fingerprints if you show <b>two independent connections</b> between this person and the victim: the victim\'s address book, a call on the day, a motive, a proven lie, matching shoes…</p>';
    if (warrantRuling) {
      h += warrantRuling.granted
        ? `<div class="box"><b>GRANTED.</b><ul>${warrantRuling.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div><div class="row"><button class="primary" data-act="talk" data-id="${pid}">Back to the interview</button></div>`
        : `<div class="box warn"><b>DENIED.</b> ${warrantRuling.reasons.length ? `Only one connection shown: ${esc(warrantRuling.reasons[0])}` : 'No connection to the victim shown.'}`
          + `${warrantRuling.notes.length ? `<ul>${warrantRuling.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div>`;
      if (warrantRuling.granted) return h;
    }
    h += '<div class="checklist">' + (cards.length ? cards.map(x => `<label class="check"><input type="checkbox" data-warrant-card="${x.id}"> ${esc(cardLabel(x))}</label>`).join('') : '<p class="muted">Your board has no evidence yet.</p>') + '</div>'
      + `<div class="row"><button class="primary" data-act="warrant-submit" data-id="${pid}">Ask the judge</button><button data-act="talk" data-id="${pid}">Cancel</button></div>`;
    return h;
  }, null);
}

function openCasePicker(first: boolean) {
  openModal(() => {
    let h = first
      ? '<div class="kicker">A new city</div><h2>Casefile</h2><p>A city of strangers, and a homicide desk with your name on it. Choose how hard your first case should be.</p>'
      : '<div class="kicker">Dispatch is calling</div><h2>Next case</h2><p>How hard should the next case be?</p>';
    h += '<div class="diffs">' + Object.values(DIFFICULTIES).map(d =>
      `<button class="diff diff-${d.id}" data-act="start-case" data-diff="${d.id}"><b>${d.label}</b><span>${esc(d.blurb)}</span></button>`).join('') + '</div>';
    return h;
  }, null, first);
}

function showDispatch() {
  const c = curCase();
  openModal(() => `<div class="kicker">Dispatch · ${fmtDate(c.day + 1)}, 07:12</div><h2>Case #${c.id}: Homicide <span class="badge diff-${c.difficulty}">${DIFFICULTIES[c.difficulty].label.toUpperCase()}</span></h2>
    <p>A neighbour called it in this morning: a body at <b>${esc(addrName(c.scene))}</b>. You're the detective assigned.</p>
    <p>The scene is pinned to your board. Search it, lift prints, identify the victim, then work outward. The DA won't file charges on hunches.</p>
    <div class="row"><button class="primary" data-act="close-modal">Go to the scene</button></div>`, null);
}

// ---------- Input
function refreshQuiet() { Board.render(); renderInspector(); renderTab(); save(); }

function pinNear(type: CardType, ref: string, near?: string | null): Card {
  const existed = !!findCard(type, ref);
  const c = addCard(type, ref, { near });
  if (!existed) toast(`Pinned to board: ${cardView(c).title}`);
  return c;
}

// Which card a newly pinned thing should be tied to, based on where it was clicked.
function contextCard(el: Element): string | null {
  if (el.closest('#modal')) return modalCtx;
  if (el.closest('#inspector')) return Board.selected;
  if (el.closest('#tab-location')) return findCard('address', K.current)?.id ?? null;
  return null;
}

function startCase(diff: DifficultyId) {
  modalLocked = false;
  closeModal();
  if (pendingSeed !== null) {
    newWorld(pendingSeed);
    pendingSeed = null;
    Board.selected = null;
  }
  const c = startNewCase(diff);
  if (!c) { toast('The city has run out of people. Start a new city.'); return; }
  lastReport = null;
  lastConfront = {};
  switchTab('location');
  refresh();
  Board.centerOn(findCard('address', c.scene)!.id);
  save();
  showDispatch();
}

export function beginNewCity(seed: number) {
  pendingSeed = seed;
  openCasePicker(true);
}

function handleAct(a: string, d: DOMStringMap, el: Element) {
  const c = live() ? curCase() : null;
  switch (a) {
    case 'tab': switchTab(d.tab as Tab); return;
    case 'start-case': startCase(d.diff as DifficultyId); return;
    case 'pick-case': modalLocked = false; closeModal(); openCasePicker(false); return;
    case 'new-city':
      if (!confirm('Start over in a brand new city? Your current progress will be lost.')) return;
      beginNewCity(Math.floor(Math.random() * 1e9));
      return;
    case 'close-modal': closeModal(); return;
  }
  if (!c) return;
  switch (a) {
    case 'go': visit(d.id!); closeModal(); switchTab('location'); break;
    case 'pin-addr': pinNear('address', d.id!); break;
    case 'search': searchSpot(d.id!); break;
    case 'dust': {
      dustSpot(d.id!);
      const s = W.spots[d.id!], n = s.prints.length + s.bloodPrints.length;
      toast(s.bloodPrints.length ? 'A fingerprint IN BLOOD!' : n ? `Lifted ${n} fingerprint${n > 1 ? 's' : ''}.` : 'No usable prints.');
      break;
    }
    case 'examine': openDoc(d.id!); return;
    case 'take': { const card = takeItem(d.id!); toast(`Taken: ${cardView(card).title}`); break; }
    case 'talk': openInterview(d.id!); break;
    case 'ask': {
      const ans = ask(d.id!, d.q as Parameters<typeof ask>[1]);
      if (d.q === 'prints' && !ans.refused) toast(`Fingerprints on file: Print ${printLabel(d.id!)}`);
      if (d.q === 'who' && !ans.refused) pinNear('person', d.id!);
      break;
    }
    case 'confront': openConfront(d.id!); return;
    case 'confront-submit': {
      const ids = [...document.querySelectorAll<HTMLInputElement>('[data-confront-card]:checked')].map(x => x.dataset.confrontCard!);
      if (!ids.length) { toast('Pick at least one card to confront them with.'); return; }
      const res = confront(d.id!, ids);
      confrontReply = { stmt: d.id!, text: res.text, ok: res.ok };
      if (res.lawyer) lastConfront[`${sid(c, K.statements[d.id!].pid, 'alibi')}:lawyer`] = res.text;
      if (res.ok) toast(res.lawyer ? 'They want a lawyer.' : 'Caught in a lie!');
      break;
    }
    case 'warrant': openWarrant(d.id!); return;
    case 'warrant-submit': {
      const ids = [...document.querySelectorAll<HTMLInputElement>('[data-warrant-card]:checked')].map(x => x.dataset.warrantCard!);
      warrantRuling = evaluateWarrant(d.id!, ids);
      if (warrantRuling.granted) { K.warrants[caseKey(c, d.id!)] = true; log(`Judge granted a fingerprint warrant for ${fullName(d.id!)}.`); }
      break;
    }
    case 'pin-stmt': { const st = K.statements[d.id!]; pinNear('statement', d.id!, findCard('person', st.pid)?.id); break; }
    case 'pin-person': pinNear('person', d.id!, modalCtx); break;
    case 'pin-print': pinNear('print', d.id!, contextCard(el)); break;
    case 'deselect': Board.linkFrom = null; Board.select(null); return;
    case 'linkmode': Board.linkFrom = Board.selected; toast('Now click the card to link to.'); break;
    case 'remove': if (Board.selected) removeCard(Board.selected); Board.selected = null; break;
    case 'read': openDoc(d.id!); return;
    case 'dust-item': dustItem(d.id!); toast('Item dusted for prints.'); break;
    case 'ballistics': toast(ballistics(d.id!, d.b!) ? 'Ballistics: MATCH!' : 'Ballistics: no match.'); break;
    case 'blood': bloodTest(d.id!); break;
    case 'typeface': toast(compareType(d.id!, d.b!) ? 'Typeface: MATCH!' : 'Typeface: no match.'); break;
    case 'handwriting': toast(compareHand(d.id!, d.b!) ? 'Handwriting: same writer!' : 'Handwriting: different writers.'); break;
    case 'bodyprints': bodyPrints(d.id!); toast(`Prints matched city records: ${fullName(caseOfItem(d.id!)!.victim)}`); break;
    case 'coroner': coronerReport(d.id!); openDoc(d.id!); break;
    case 'lookup': lookup(d.id!); toast('Directory: address and phone found.'); break;
    case 'dir-person': lookup(d.id!); pinNear('person', d.id!); break;
    case 'dir-addr': { const pc = d.pid ? findCard('person', d.pid) : undefined; if (d.pid) lookup(d.pid); pinNear('address', d.id!, pc?.id); break; }
    case 'form-set': (K.form as unknown as Record<string, string | null>)[d.field!] = d.id!; toast(`Case report: ${d.field} set.`); break;
    case 'form-add': if (!K.form.evidence.includes(d.id!)) K.form.evidence.push(d.id!); toast('Added to case evidence.'); break;
    case 'form-rm': K.form.evidence.splice(Number(d.i), 1); break;
    case 'submit': {
      const r = submitCase();
      lastReport = { case: c.id, r };
      showVerdict(r);
      break;
    }
    case 'add-note': Board.select(addCard('note', null, { title: 'Note' }).id); break;
    case 'add-unknown': Board.select(addCard('unknown', null, { title: 'Unknown person' }).id); break;
    case 'center': Board.centerAll(); return;
    case 'clear-board':
      if (!confirm('Remove every card from the board?')) return;
      K.board.cards = {}; K.board.links = []; Board.selected = null;
      K.form = { victim: null, suspect: null, weapon: null, evidence: [] };
      break;
  }
  refresh();
}

function handleEntity(ent: string, el: Element) {
  const k = ent[0], v = ent.slice(2);
  if (k === 'n') {
    switchTab('directory');
    $<HTMLInputElement>('#dirQuery').value = v;
    renderDirectory();
    toast(`Directory: searching ${v}`);
    return;
  }
  pinNear(k === 'p' ? 'person' : 'address', v, contextCard(el));
  refresh();
}

export function bindInput() {
  Board.init({ view: cardView, onSelect: renderInspector, onOpen: onCardOpen, onChange: save });
  document.addEventListener('click', e => {
    const t = e.target as Element;
    const ent = t.closest<HTMLElement>('[data-ent]');
    if (ent) { handleEntity(ent.dataset.ent!, ent); return; }
    const b = t.closest<HTMLElement>('[data-act]');
    if (b && !b.closest('#board')) handleAct(b.dataset.act!, b.dataset, b);
  });
  document.addEventListener('change', e => {
    const s = (e.target as Element).closest<HTMLSelectElement>('[data-form]');
    if (!s) return;
    if (s.dataset.form === 'add') { if (s.value) K.form.evidence.push(s.value); }
    else (K.form as unknown as Record<string, string | null>)[s.dataset.form!] = s.value || null;
    refresh();
  });
  document.addEventListener('input', e => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.notes) { K.board.cards[t.dataset.notes].notes = t.value; Board.render(); save(); }
    if (t.dataset.title) { K.board.cards[t.dataset.title].title = t.value; Board.render(); save(); }
    if (t.id === 'dirQuery') renderDirectory();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#modal').hidden) closeModal(); else { Board.linkFrom = null; Board.select(null); }
  });
  $('#modal').addEventListener('click', e => { if ((e.target as HTMLElement).id === 'modal') closeModal(); });
}
