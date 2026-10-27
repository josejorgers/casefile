// Document text. Markup: {p:id} person, {a:id} address, {n:555-0000} phone number.
import { clockTimes, fmtDate, fmtHour, fmtTime, hash } from './data';
import { coronerWindow } from './story';
import { K, W, addr, addrName, caseById, fullName, person } from './state';
import type { Item } from './types';

export function docText(it: Item): string {
  const d = it.data, lines: string[] = [];
  switch (it.kind) {
    case 'addressbook':
      lines.push(`Owner: {p:${d.owner}}`, '');
      for (const e of d.entries!) { const p = person(e); lines.push(`{p:${e}}\n    ☎ {n:${addr(p.home).phone}} — {a:${p.home}}`); }
      return lines.join('\n');
    case 'phone': {
      const calls = W.calls.filter(c => c.from === d.addr || c.to === d.addr).sort((a, b) => b.day - a.day || b.t - a.t).slice(0, 18);
      lines.push(`Line {n:${addr(d.addr!).phone}} — recent calls`, '');
      for (const c of calls) {
        const out = c.from === d.addr, other = addr(out ? c.to : c.from);
        lines.push(`${fmtDate(c.day)}  ${fmtTime(c.t)}  ${out ? 'Outgoing to  ' : 'Incoming from'} {n:${other.phone}}  ${c.dur ? `${c.dur} min` : '(no answer)'}`);
      }
      return lines.join('\n');
    }
    case 'staff':
      lines.push(`{a:${d.addr}} — current staff`, '');
      for (const e of addr(d.addr!).employees) {
        const p = person(e);
        if (p.alive && !p.arrested) lines.push(`{p:${e}} — ${p.job} (${fmtHour(p.shift[0])}–${fmtHour(p.shift[1])})`);
      }
      return lines.join('\n');
    case 'timesheet':
      lines.push(`{a:${d.addr}}`, `Clock-in record for ${fmtDate(d.day!)}`, '');
      for (const e of addr(d.addr!).employees) {
        const p = person(e);
        if ((p.diedDay !== undefined && p.diedDay < d.day!) || (p.arrestedDay !== undefined && p.arrestedDay < d.day!)) continue;
        const ct = clockTimes(e, p.shift, d.day!);
        lines.push(`{p:${e}}  IN ${fmtTime(ct.in)}   OUT ${fmtTime(ct.out)}${ct.out >= 1440 ? ' (next day)' : ''}`);
      }
      return lines.join('\n');
    case 'tabs':
      lines.push(`{a:${d.addr}}`, `Tabs on the night of ${fmtDate(d.day!)}`, '');
      for (const t of d.tabs!) lines.push(`${fmtTime(t.t)}–${fmtTime(t.close)}  {p:${t.pid}} — ${t.order}`);
      if (!d.tabs!.length) lines.push('(a quiet night — no tabs)');
      lines.push('', "(Bartender's note: every customer gets a tab, house rule. Opened when they walk in, closed when they leave.)");
      return lines.join('\n');
    case 'mailboxes':
      for (const aid of W.buildings[d.building!].addresses) {
        const a = addr(aid);
        if (a.kind === 'home') lines.push(`Apt ${a.unit}: ${a.residents.map(r => `{p:${r}}`).join(', ')}   → {a:${aid}}`);
      }
      return lines.join('\n');
    case 'keylog':
      lines.push(`Spare keys held for residents of ${W.buildings[d.building!].street}`, '');
      for (const [aid, holders] of Object.entries(d.keyring || {})) lines.push(`Apt ${addr(aid).unit}: ${holders.length ? holders.map(h => `{p:${h}}`).join(', ') : '—'}`);
      lines.push('', 'Master key: kept in the office safe.');
      return lines.join('\n');
    case 'register':
      lines.push('Firearm sales — required by city ordinance', '');
      for (const s of W.gunSales.slice().sort((a, b) => a.day - b.day)) {
        lines.push(`${fmtDate(s.day)} — {p:${s.pid}} — ${s.model} ${s.caliber}, serial ${s.serial}`);
        if (s.pawnedAt) lines.push(`      ↳ ${fmtDate(s.pawnDay!)}: pawned at {a:${s.pawnedAt}}`);
      }
      return lines.join('\n');
    case 'pawnledger':
      lines.push(`{a:${d.addr}} — pawn ledger`, '');
      for (const p of d.pawns!.slice().sort((a, b) => a.dayIn - b.dayIn)) {
        lines.push(`${fmtDate(p.dayIn)} — ${p.what}${p.serial ? ` (serial ${p.serial})` : ''} — pawned by {p:${p.from}}`);
        lines.push(p.to ? `      ↳ ${fmtDate(p.dayOut!)}: sold to {p:${p.to}}` : '      ↳ unredeemed');
      }
      return lines.join('\n');
    case 'repairs':
      lines.push(`{a:${d.addr}} — repair tickets`, '');
      for (const r of d.repairs!.slice().sort((a, b) => a.tag.localeCompare(b.tag))) lines.push(`#${r.tag} — {p:${r.pid}} — ${['resoled', 'new heels', 'stitching', 'stretched'][hash(r.tag) % 4]} (${fmtDate(r.day)})`);
      return lines.join('\n');
    case 'typewriter':
      return `The office typewriter at {a:${d.addr}}. A test line shows ${d.defect}.`;
    case 'knifeblock':
      return it.text || `A ${d.brand} knife block, every slot filled.`;
    case 'paper': {
      const rain = W.weather[d.day!];
      return `THE MORNING STANDARD — ${fmtDate(d.day! + 1)}\n\nWEATHER: ${rain != null ? `After a dry week, rain began at ${fmtTime(rain)} last night and continued past midnight. Streets were muddy by nine.` : 'Dry and clear again last night. More of the same expected today.'}\n\nAlso inside: city council race tightens; harbor strike enters third week.`;
    }
    case 'wallet': {
      const p = person(d.owner!);
      return `Driver's licence\n\nName: {p:${p.id}}\nAddress: {a:${p.home}}\nAge: ${p.age}\nHeight: ${p.look.height}. Hair: ${p.look.hair}. Eyes: ${p.look.eyes}.\n\nAlso inside: $${hash(p.id) % 40 + 3} in bills, a bus pass.`;
    }
    case 'body': {
      const c = caseById(d.case!), p = person(c.victim);
      const wound = { gun: 'a single gunshot wound to the chest', knife: 'multiple stab wounds', blunt: 'severe blunt-force trauma to the head' }[c.weaponType];
      lines.push(`The body of a ${p.gender === 'm' ? 'man' : 'woman'}, around ${Math.round(p.age / 5) * 5}, lying on the living room floor. There is ${wound}.`);
      if (!c.wallet) lines.push('The pockets have been turned out. No wallet, no ID.');
      lines.push(K.victimId[c.id] ? `Identified as {p:${p.id}}.` : 'Identity not yet established.');
      if (K.lab['coroner:' + it.id]) {
        const [a, b] = coronerWindow(c);
        lines.push('', "CORONER'S REPORT", `Cause of death: ${wound}${c.weaponType === 'gun' ? `, ${c.caliber} calibre` : ''}.`);
        if (c.weaponType === 'knife') lines.push('Weapon: a single-edged blade, roughly 15 cm.');
        if (c.weaponType === 'blunt') lines.push('Weapon: a heavy object with a hard edge.');
        lines.push(`Estimated time of death: between ${fmtTime(a)} and ${fmtTime(b)}, night of ${fmtDate(c.day)}.`);
      }
      return lines.join('\n');
    }
    case 'shoeprint':
      return d.blood
        ? `A shoe print in the victim's blood, beside the body. Whoever left it was standing there after the killing.\n\nSize ${d.size}, "${d.sole}" sole pattern, with ${d.wear}.`
        : `A muddy shoe print just inside the door. Mud means wet streets, but when?\n\nSize ${d.size}, "${d.sole}" sole pattern, with ${d.wear}.`;
    case 'shoes':
      return `${d.owner && W.spots[it.spot].addr === person(d.owner).home ? `A worn pair of {p:${d.owner}}'s shoes.` : 'A worn pair of shoes, dumped with the garbage. Dark stains on the soles.'}\n\nSize ${d.size}, "${d.sole}" sole pattern, with ${d.wear}.${d.tag ? `\nA repair tag from {a:${Object.values(W.addresses).find(a => a.biz === 'cobbler')!.id}} is stapled inside the tongue: #${d.tag}.` : ''}`;
    default:
      return it.text;
  }
}

/** Strip markup to plain text (for card previews and selects). */
export function plain(text: string): string {
  return text.replace(/\{(p|a|n):([^}]+)\}/g, (_m, k: string, v: string) => k === 'p' ? fullName(v) : k === 'a' ? addrName(v) : v);
}
