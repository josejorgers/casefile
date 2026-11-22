// Crime generation, proof first. For the chosen difficulty we pick a chain of deductions for each pillar of the
// case (the plan), then build the night around it: everyone's timeline, the traces at the scene, the records, the
// lies and the rumours. Finally the whole world is run through the case language: the killer must be provable,
// nobody else may be, and the shortest proof must be as long as the difficulty asks. Otherwise we roll again.
import { CLOCKED, DIFFICULTIES, DRINKS, GUNS, KNIFE_BRANDS, MELEE, RNG, cap, fmtDate, fmtTime, initials, pron, streetName } from './data';
import type { Rng } from './data';
import { analyse, omniscientEvidence } from './logic/analyse';
import { explain, proofLines } from './logic/engine';
import type { ProofNode } from './logic/engine';
import { connections } from './logic/rules';
import { CLAIM_FROM, EVE, MORNING, defaultTimeline, overlay, placeAt, timeline, workSegs } from './story';
import { addContact, addItem, giveGun, moveItem } from './world';
import type {
  Case, Difficulty, DifficultyId, Item, MeansStrat, Motive, MotiveStrat, OppStrat, Person, Plan, PresenceStrat, Seg, World,
} from './types';

export interface CaseCheck { ok: boolean; why: string; cost: number; proof: string[]; tree?: ProofNode }

/** Why generated cases were rejected (for tuning and tests). */
export const rejections: Record<string, number> = {};

export function generateCase(W: World, diffId: DifficultyId): Case | null {
  const D = DIFFICULTIES[diffId];
  const rng = RNG(W.rngState);
  for (let attempt = 0; attempt < 40; attempt++) {
    const snap = structuredClone(W);
    const c = build(W, D, rng);
    if (c) {
      W.cases.push(c);
      const chk = checkCase(W, c);
      if (chk.ok) { c.proof = chk.proof; c.proofTree = chk.tree; c.minCost = chk.cost; W.rngState = rng.state(); return c; }
      const why = chk.why.replace(/ \(.*\)$/, '').replace(/innocent \S+/, 'innocent');
      rejections[why] = (rejections[why] || 0) + 1;
    } else rejections['no victim/killer'] = (rejections['no victim/killer'] || 0) + 1;
    for (const k of Object.keys(W) as (keyof World)[]) (W as unknown as Record<string, unknown>)[k] = snap[k];
  }
  W.rngState = rng.state();
  return null;
}

/** Run the case language over everything in the world. */
export function checkCase(W: World, c: Case): CaseCheck {
  const D = DIFFICULTIES[c.difficulty];
  const db = analyse(W, c, omniscientEvidence(W, c));
  const fail = (why: string): CaseCheck => ({ ok: false, why, cost: 0, proof: [] });
  const wrong = db.all('guilty').find(f => f.args[0] !== c.killer);
  if (wrong) return fail(`innocent ${wrong.args[0]} provable`);
  const g = db.get('guilty', c.killer);
  if (!g) return fail('killer not provable');
  if (g.cost < D.minCost) return fail(`too easy (${g.cost})`);
  const pl = c.plan;
  if (!pl.means && db.get('means', c.killer)) return fail('dropped means is provable');
  if (!pl.presence && db.get('presence', c.killer)) return fail('dropped presence is provable');
  if (!pl.motive.length && db.get('motive', c.killer)) return fail('dropped motive is provable');
  if (!pl.opp && db.get('opportunity', c.killer)) return fail('dropped opportunity is provable');
  if (c.refusers.includes(c.killer) && connections(db, c.killer).length < 2) return fail('no warrant possible');
  const tree = explain(db, g.key)!;
  return { ok: true, why: '', cost: g.cost, proof: proofLines(tree), tree };
}

const seg = (place: string | null, from: number, to: number): Seg => ({ place, from, to });

function build(W: World, D: Difficulty, rng: Rng): Case | null {
  const P = W.people, A = W.addresses;
  W.day += rng.int(1, 3);
  const day = W.day, T = rng.int(1320, 1470); // death between 22:00 and 00:30
  const free = (p: Person) => p.alive && !p.arrested;
  const alive = Object.values(P).filter(free);
  const busy = (p: Person, a: number, b: number) => workSegs(p).some(([x, y]) => x < b && y > a);
  const streetOf = (aid: string) => streetName(W.buildings[A[aid].building].street);
  const occupants = (aid: string) => A[aid].residents.filter(r => free(P[r]));
  const bars = Object.values(A).filter(a => a.biz === 'bar');

  // ---------------- Victim and killer
  let V: Person | null = null, K: Person | null = null, motive: Case['motive'] = 'debt';
  for (const v of rng.shuffle(alive.filter(p => occupants(p.home).length === 1 && !busy(p, T - 120, T + 30)))) {
    const pool = alive.filter(k => k.id !== v.id && k.home !== v.home && !busy(k, T - 200, T + 90));
    if (!pool.length) continue;
    const cow = pool.filter(k => k.work === v.work), fr = pool.filter(k => v.friends.includes(k.id));
    const opts: Case['motive'][] = ['debt', 'jealousy', 'blackmail'];
    if (cow.length) opts.push('grudge', 'grudge');
    motive = rng.pick(opts);
    K = rng.pick(motive === 'grudge' ? cow : (motive === 'debt' && fr.length) ? fr : pool);
    V = v;
    break;
  }
  if (!V || !K) return null;
  const vic = V, kil = K;
  const vh = A[vic.home], kh = A[kil.home];
  const sceneStreet = streetOf(vh.id);
  const kCo = occupants(kh.id).filter(r => r !== kil.id).map(r => P[r]);
  const kPartner = kil.partner && P[kil.partner] && free(P[kil.partner]) && P[kil.partner].home === kil.home ? P[kil.partner] : null;
  const partnerHome = !!kPartner && !busy(kPartner, EVE, MORNING);
  const taken = new Set<string>([vic.id, kil.id]);
  if (kPartner) taken.add(kPartner.id);
  addContact(W, vic, kil); addContact(W, kil, vic);
  const vBook = Object.values(W.items).find(i => i.kind === 'addressbook' && i.data.owner === vic.id)!;

  // ---------------- The plan
  const accompliceOf = () => rng.shuffle(kil.friends.map(id => P[id])).find(a => free(a) && !taken.has(a.id) && a.id !== vic.id
    && occupants(a.home).length === 1 && !busy(a, T - 150, T + 100) && a.home !== vic.home);
  const uniqueIn = (ids: string[]) => ids.filter(id => free(P[id]) || id === vic.id).filter(id => initials(P[id]) === initials(kil)).length === 1;
  const feasible = {
    presence: (s: PresenceStrat) => s !== 'elimination' || keyholderPool().length >= (D.id === 'hard' ? 2 : 1),
    means: (s: MeansStrat) => s !== 'knifeblock' || kCo.length === 0,
    motive: (s: MotiveStrat) => s === 'initialsBook' ? uniqueIn(vBook.data.entries!) : s === 'typed' ? uniqueIn(A[kil.work].employees) : true,
    opp: (s: OppStrat) => ({
      partner: partnerHome,
      timesheet: CLOCKED.includes(A[kil.work].biz!),
      tabTime: true,
      ticket: kCo.length === 0 && streetOf(kh.id) !== sceneStreet,
      payphone: partnerHome && !CLOCKED.includes(A[kil.work].biz!) && streetOf(kil.work) !== sceneStreet,
      accomplice: !!accompliceOf(),
    })[s],
  };
  function keyholderPool() {
    return rng.shuffle([...new Set([...vic.friends, ...A[vic.work].employees])]).map(id => P[id])
      .filter(p => free(p) && !taken.has(p.id) && p.home !== kil.home && !busy(p, T - 120, T + 120));
  }
  const choose = <S>(pool: S[], ok: (s: S) => boolean, fallback: S[]): S | null => {
    for (const s of [...rng.shuffle(pool), ...fallback]) if (ok(s)) return s;
    return null;
  };
  const plan: Plan = {
    presence: choose(D.presence, feasible.presence, ['shoesHome']),
    means: choose(D.means, feasible.means, ['register', 'prints']),
    motive: [],
    opp: choose(D.opp, feasible.opp, ['tabTime']),
    narrow: rng.chance(D.narrow),
  };
  const firstMotive = choose(D.motive, feasible.motive, ['gossip', 'signed']);
  if (firstMotive) plan.motive.push(firstMotive);
  for (let n = rng.int(...D.motiveCount) - 1; n > 0; n--) {
    const m = choose(D.motive.filter(x => x === 'gossip' || !plan.motive.includes(x)), feasible.motive, []);
    if (m) plan.motive.push(m);
  }
  if (rng.chance(D.dropPillar)) {
    const drop = rng.pick(['means', 'presence', 'motive', 'opp'] as const);
    if (drop === 'motive') plan.motive = [];
    else plan[drop] = null;
  }

  // ---------------- The case skeleton
  const weaponType: Case['weaponType'] = plan.means === 'knifeblock' ? 'knife'
    : plan.means === 'prints' ? rng.pick(['knife', 'blunt'] as const)
    : plan.means ? 'gun' : rng.pick(['gun', 'gun', 'knife', 'blunt'] as const);
  const c: Case = {
    id: W.cases.length + 1, difficulty: D.id, day, time: T, victim: vic.id, killer: kil.id, motive, scene: vic.home,
    solved: false, attempts: 0, weaponType, weaponName: '', weapon: null, bullet: null, weaponAtScene: false,
    body: '', wallet: null, shoeprint: null, watch: null, door: '',
    gloves: plan.presence !== 'bloodprint' && plan.means !== 'prints',
    rain: rng.chance(0.75) ? rng.int(1200, 1250) : null,
    plan, timeline: {}, claims: {}, secondLieBar: '', accomplice: null, keyholders: [], locked: plan.presence === 'elimination',
    witnesses: {}, gossip: {}, liars: {}, lovers: {}, refusers: [], silent: [], herrings: [], tabBooks: {}, timesheets: {},
    proof: [], minCost: 0,
  };
  W.weather[day] = c.rain;
  vic.alive = false; vic.diedDay = day;
  const setTl = (p: Person, over: Seg[]) => { c.timeline[p.id] = overlay(c.timeline[p.id] || defaultTimeline(p), over); };
  const homeAt = (pid: string, t: number) => placeAt(W, c, pid, t) === P[pid].home;

  // ---------------- The killer's night, shaped by how their alibi will break
  const arrive = T - rng.int(8, 15), leave = T + rng.int(3, 8), back = leave + rng.int(25, 50);
  let depart = arrive - rng.int(15, 30);
  const ks = (k: string) => kh.spotKeys[k];
  const special: Seg[] = [];
  const kp = pron(kil);
  if (plan.opp === 'partner') {
    c.claims[kil.id] = { place: kh.id, from: CLAIM_FROM, text: `I was home all night with {p:${kPartner!.id}}. We listened to the radio and went to bed around midnight.` };
  } else if (plan.opp === 'timesheet') {
    c.claims[kil.id] = { place: kil.work, from: CLAIM_FROM, text: `I was working late at {a:${kil.work}}. Didn't leave until after one in the morning.` };
  } else if (plan.opp === 'tabTime') {
    // a true alibi for the early evening, stretched past the time of death
    const bar = rng.pick(bars);
    const from = Math.min(depart - 30, T - rng.int(110, 150));
    special.push(seg(bar.id, from, depart));
    c.claims[kil.id] = { place: bar.id, from, text: `I was at {a:${bar.id}} from about ${fmtTime(from - (from % 5))} until well past midnight. Ask the bartender.` };
  } else if (plan.opp === 'ticket') {
    const tt = leave + rng.int(5, 9);
    special.push(seg('st:' + sceneStreet, tt, tt + 1));
    addItem(W, ks('bedroom'), { kind: 'ticket', name: 'Bus ticket', text: `A crumpled bus ticket in the pocket of {p:${kil.id}}'s coat. Route 4 — issued at the ${sceneStreet} stop, ${fmtDate(day)}, ${fmtTime(tt)}.`,
      data: { owner: kil.id, street: sceneStreet, t: tt, day } });
    c.claims[kil.id] = { place: kh.id, from: CLAIM_FROM, text: 'I was home alone all night. Went to bed early.' };
  } else if (plan.opp === 'payphone') {
    const booth = Object.values(A).find(a => a.kind === 'payphone' && streetOf(a.id) === sceneStreet)!;
    const ph = arrive - rng.int(8, 14);
    depart = EVE;
    special.push(seg(booth.id, ph, ph + 2));
    W.calls.push({ from: booth.id, to: kh.id, day, t: ph, dur: 2, by: kil.id });
    c.claims[kil.id] = { place: kil.work, from: CLAIM_FROM, text: `I was at {a:${kil.work}} doing paperwork until after one. Called home to say I'd be late.` };
  } else if (plan.opp === 'accomplice') {
    const acc = accompliceOf()!;
    c.accomplice = acc.id;
    taken.add(acc.id);
    depart = CLAIM_FROM - 15;
    setTl(acc, [seg(rng.pick(bars).id, T - rng.int(80, 120), T + rng.int(60, 90))]);
    c.claims[kil.id] = { place: acc.home, from: CLAIM_FROM, text: `I was at {p:${acc.id}}'s place all evening, {a:${acc.home}}. We played cards until late — ask ${acc.first}.` };
    c.claims[acc.id] = { place: acc.home, from: CLAIM_FROM, text: `I was home all evening. {p:${kil.id}} came over and we played cards until after midnight.` };
  }
  setTl(kil, [seg(null, depart, arrive), seg(null, leave, back), ...special, seg(vh.id, arrive, leave)]);
  setTl(vic, [seg(vh.id, T - 120, MORNING)]);

  // ---------------- Key holders (for a locked door, each needs a record covering the time of death)
  const keyring = Object.values(W.items).find(i => i.kind === 'keylog' && i.data.building === vh.building)!.data.keyring!;
  if (plan.presence === 'elimination') {
    const n = D.id === 'hard' ? rng.int(2, 3) : rng.int(1, 2);
    const kh2 = keyholderPool().slice(0, n);
    for (const p of kh2) {
      taken.add(p.id);
      const narrow = plan.narrow;
      const a = narrow ? rng.int(14, 20) : rng.int(60, 90), b = narrow ? rng.int(12, 18) : rng.int(50, 80);
      setTl(p, [seg(rng.pick(bars).id, T - a, T + b)]);
    }
    keyring[vh.id] = rng.shuffle([kil.id, ...kh2.map(p => p.id)]);
  } else keyring[vh.id] = (keyring[vh.id] || []).filter(id => id !== kil.id && free(P[id]));
  c.keyholders = keyring[vh.id];

  // ---------------- People around the victim
  const neighbors = rng.shuffle(W.buildings[vh.building].addresses.filter(id => id !== vh.id && A[id].kind === 'home').flatMap(occupants)
    .map(id => P[id]).filter(p => !taken.has(p.id)));
  const circle = [...new Set([...vic.friends, ...A[vic.work].employees])].map(id => P[id]).filter(p => free(p) && !taken.has(p.id));

  // ---------------- Red herrings: grievances, and some visited the victim that evening
  const herrings = rng.shuffle(circle).slice(0, rng.int(...D.herrings));
  c.herrings = herrings.map(h => h.id);
  const visitors: Person[] = [];
  for (const h of herrings) {
    taken.add(h.id);
    if (!c.rain || !rng.chance(D.visitRate)) continue;
    const v0 = Math.max(c.rain + 5, CLAIM_FROM) + rng.int(0, 30), v1 = v0 + rng.int(20, 35);
    if (v1 > T - 25 || busy(h, v0 - 30, v1 + 30) || !homeAt(vic.id, v0)) continue;
    setTl(h, [seg(vh.id, v0, v1)]);
    visitors.push(h);
    addItem(W, vh.spotKeys.entrance, { kind: 'shoeprint', name: 'Muddy shoe print', data: { size: h.shoe.size, sole: h.shoe.sole, wear: h.shoe.wear, case: c.id } });
  }

  // ---------------- Innocent liars: each hides something real that can be uncovered
  const poi = new Set([...circle.map(p => p.id), ...c.herrings, ...neighbors.map(p => p.id)]);
  for (const p of rng.shuffle(alive)) {
    if (taken.has(p.id) || p.id === vic.id) continue;
    const part = p.partner && P[p.partner] ? P[p.partner] : null;
    if (part && taken.has(part.id)) continue;
    const rate = poi.has(p.id) ? D.liarRate : D.liarRate / 3;
    if (!rng.chance(rate)) continue;
    const out = T - rng.int(30, 90), bk = T + rng.int(40, 100);
    if (busy(p, out - 60, bk + 30)) continue;
    const lover = rng.shuffle(p.friends.map(id => P[id])).find(l => free(l) && !taken.has(l.id) && l.home !== p.home && l.id !== vic.id
      && occupants(l.home).length === 1 && !busy(l, out - 60, bk + 30));
    if (lover && rng.chance(0.5)) {
      c.liars[p.id] = { secret: 'affair', place: lover.home, lover: lover.id, out, back: bk };
      c.lovers[lover.id] = p.id;
      taken.add(lover.id);
      setTl(p, [seg(lover.home, out, bk)]);
      W.calls.push({ from: p.home, to: lover.home, day, t: out - rng.int(20, 50), dur: rng.int(2, 6), by: p.id });
    } else {
      const bar = rng.pick(bars);
      c.liars[p.id] = { secret: 'bar', place: bar.id, out, back: bk };
      setTl(p, [seg(bar.id, out, bk)]);
    }
    taken.add(p.id);
    if (part) taken.add(part.id);
  }
  // A herring who visited may lie about it, if someone saw them go in
  const sightings: { by: Person; h: Person; t: number }[] = [];
  for (const h of visitors) {
    const v0 = nightOfFirst(h.id, vh.id);
    const by = neighbors.find(n => !taken.has(n.id) && homeAt(n.id, v0) && !sightings.some(s => s.by.id === n.id));
    if (!by) continue;
    sightings.push({ by, h, t: v0 });
    if (v0 >= CLAIM_FROM + 10 && rng.chance(Math.min(1, D.liarRate * 2))) c.liars[h.id] = { secret: 'visit', place: vh.id, out: v0, back: v0 + 30 };
  }
  function nightOfFirst(pid: string, place: string) { return timeline(W, c, pid).find(s => s.place === place)!.from; }

  // ---------------- Early drinkers, so tab books aren't just liars
  for (const b of bars) for (const p of rng.shuffle(alive).slice(0, rng.int(2, 4))) {
    if (taken.has(p.id) || p.id === vic.id) continue;
    const t0 = rng.int(1140, 1230), t1 = t0 + rng.int(30, 80);
    if (busy(p, t0 - 30, t1 + 30)) continue;
    setTl(p, [seg(b.id, t0, t1)]);
    taken.add(p.id);
  }

  // ---------------- The weapon
  const dumpSpot = A[kil.work].spotKeys.alley;
  if (weaponType === 'gun') {
    let gun: Item;
    if (plan.means === 'pawn') {
      const q = rng.pick(alive.filter(p => p.id !== kil.id && p.id !== vic.id));
      const [caliber, model] = rng.pick(GUNS), serial = 'SN-' + rng.int(10000, 99999);
      const pawn = Object.values(A).find(a => a.biz === 'pawnshop')!;
      const bought = -rng.int(250, 900);
      const s = { pid: q.id, day: bought, model, caliber, serial, pawnedAt: pawn.id, pawnDay: bought + rng.int(10, 200) };
      W.gunSales.push(s);
      const ledger = Object.values(W.items).find(i => i.kind === 'pawnledger')!;
      ledger.data.pawns!.push({ what: `${model} ${caliber}`, serial, from: q.id, to: kil.id, dayIn: s.pawnDay, dayOut: Math.min(day - 3, s.pawnDay + rng.int(5, 60)) });
      gun = addItem(W, dumpSpot, { kind: 'weapon', name: `${model} (${caliber})`, text: `A ${caliber} ${model.toLowerCase()}, serial number ${serial}, fished out of the dumpster. It has been fired recently and wiped clean.`,
        data: { weaponType: 'gun', caliber, serial, owner: kil.id, case: c.id }, prints: [] });
    } else {
      gun = kil.gun ? W.items[kil.gun] : giveGun(W, rng, kil);
      const s = W.gunSales.find(x => x.serial === gun.data.serial)!;
      if (plan.means === 'register' || !plan.means) {
        moveItem(W, gun, dumpSpot);
        gun.text = `A ${s.caliber} ${s.model.toLowerCase()}, serial number ${s.serial}, fished out of the dumpster. It has been fired recently.`;
        gun.prints = c.gloves ? [] : [kil.id];
      }
      if (!plan.means) { W.spots[gun.spot].items = W.spots[gun.spot].items.filter(x => x !== gun.id); delete W.items[gun.id]; kil.gun = null; }
    }
    c.caliber = gun.data.caliber;
    c.weaponName = gun.name.replace(/ \(.*\)$/, '');
    if (W.items[gun.id]) c.weapon = gun.id;
    c.bullet = addItem(W, vh.spotKeys.living, { kind: 'bullet', name: `Spent bullet (${gun.data.caliber})`,
      text: `A spent ${gun.data.caliber} bullet dug out of the wall behind the body. The rifling marks are clean enough for a ballistics comparison.`,
      data: { caliber: gun.data.caliber, case: c.id } }).id;
  } else if (plan.means === 'knifeblock') {
    const brand = rng.pick(KNIFE_BRANDS);
    for (const it of Object.values(W.items)) if (it.kind === 'knifeblock' && it.data.brand === brand) it.data.empty = false;
    let block = Object.values(W.items).find(i => i.kind === 'knifeblock' && W.spots[i.spot].addr === kh.id);
    if (!block) block = addItem(W, ks('kitchen'), { kind: 'knifeblock', name: '', data: { owner: kil.id }, prints: [kil.id] });
    block.data.brand = brand; block.data.empty = true; block.name = `Knife block (${brand})`;
    block.text = `A ${brand} knife block on the counter. One slot is empty.`;
    c.weaponName = 'Kitchen knife';
    c.weaponAtScene = true;
    c.weapon = addItem(W, vh.spotKeys.living, { kind: 'weapon', name: 'Kitchen knife (bloodstained)', text: `A ${brand} kitchen knife lying beside the body, smeared with blood. The handle has been wiped clean.`,
      data: { weaponType: 'knife', brand, bloodOf: vic.id, case: c.id, owner: kil.id }, prints: [] }).id;
  } else {
    const name = rng.pick(MELEE[weaponType as 'knife' | 'blunt']);
    c.weaponName = name;
    if (plan.means === 'prints') {
      const hidden = D.id === 'hard' ? dumpSpot : rng.pick([ks('trash'), ks('bedroom'), ks('kitchen'), dumpSpot]);
      const text = hidden === dumpSpot ? `A ${name.toLowerCase()} wrapped in newspaper and thrown in with the garbage. Something dark is crusted along it.`
        : `A ${name.toLowerCase()} wrapped in a dish towel and pushed out of sight. Something dark and dry is crusted along it.`;
      c.weapon = addItem(W, hidden, { kind: 'weapon', name: `${name} (wrapped up)`, text, data: { weaponType, owner: kil.id, bloodOf: vic.id, case: c.id }, prints: [kil.id] }).id;
    }
  }

  // ---------------- The scene
  c.body = addItem(W, vh.spotKeys.living, { kind: 'body', name: 'Body', data: { case: c.id } }).id;
  if (!rng.chance(D.walletStolen)) c.wallet = addItem(W, vh.spotKeys.living, { kind: 'wallet', name: 'Wallet (found on the body)', data: { owner: vic.id, case: c.id }, prints: [vic.id] }).id;
  if (weaponType !== 'gun' && (plan.narrow || rng.chance(0.4))) {
    c.watch = addItem(W, vh.spotKeys.living, { kind: 'watch', name: 'Wristwatch (smashed)', text: `The victim's wristwatch, its face smashed in the struggle. The hands have stopped at ${fmtTime(T)}.`, data: { t: T, case: c.id } }).id;
  }
  c.door = addItem(W, vh.spotKeys.entrance, { kind: 'door', name: 'Front door', data: { case: c.id, locked: c.locked },
    text: c.locked ? "No sign of forced entry. The door was locked with a key from outside when the body was found — the super had to open it with the master key. The victim's own keys hang on the hook inside."
      : 'No sign of forced entry. The door was unlocked when the body was found.' }).id;
  if (plan.presence === 'shoesHome' || plan.presence === 'shoesTag') {
    c.shoeprint = addItem(W, vh.spotKeys.living, { kind: 'shoeprint', name: 'Bloody shoe print',
      data: { size: kil.shoe.size, sole: kil.shoe.sole, wear: kil.shoe.wear, blood: true, case: c.id } }).id;
  }
  if (plan.presence === 'shoesTag') {
    const shoes = Object.values(W.items).find(i => i.kind === 'shoes' && i.data.owner === kil.id)!;
    moveItem(W, shoes, dumpSpot);
    shoes.name = `Shoes, size ${kil.shoe.size} (thrown away)`;
    if (!shoes.data.tag) {
      const ledger = Object.values(W.items).find(i => i.kind === 'repairs')!;
      let tag: string;
      do { tag = String(rng.int(1000, 9999)); } while (ledger.data.repairs!.some(r => r.tag === tag));
      shoes.data.tag = tag;
      ledger.data.repairs!.push({ tag, pid: kil.id, day: -rng.int(5, 200) });
    }
  }
  if (plan.presence === 'bloodprint') W.spots[vh.spotKeys[rng.pick(['entrance', 'living'])]].bloodPrints.push(kil.id);

  // ---------------- Motive sources
  const V1 = vic.first, vp = pron(vic);
  const doc = (spot: string, o: Partial<Item> & { name: string }, m: Partial<Motive>) => addItem(W, spot, { ...o, motive: { suspect: kil.id, victim: vic.id, case: c.id, ...m } });
  const amt = rng.int(8, 60) * 100;
  const made = new Set<MotiveStrat>();
  const gossipers = rng.shuffle([...new Set([...vic.friends, ...A[vic.work].employees, ...neighbors.map(p => p.id)])].map(id => P[id])
    .filter(p => free(p) && p.id !== kil.id && p.id !== kil.partner && p.id !== c.accomplice));
  const say = (p: Person, text: string, m?: Motive) => (c.gossip[p.id] ||= []).push({ text, motive: m });
  const rumour: Record<Case['motive'], string> = {
    debt: `${V1} lent {p:${kil.id}} a lot of money. Last time we talked, ${vp.subj} said ${kil.first} was dodging ${vp.obj} and ${vp.subj} was going to make trouble.`,
    jealousy: `{p:${kil.id}} and ${V1} were together for a while. When ${V1} ended it, ${kil.first} didn't take it well — kept calling, showing up at ${vp.pos} door.`,
    grudge: `There was bad blood at work between ${V1} and {p:${kil.id}}. ${V1} filed a complaint and ${kil.first} got suspended. ${cap(kp.subj)} swore ${vp.subj}'d regret it.`,
    blackmail: `${V1} was flush lately. Said {p:${kil.id}} was "paying for ${vp.pos} silence" and laughed. I didn't want to know.`,
  };
  const threat: Record<Case['motive'], string> = {
    debt: `${V1},\n\nStop asking about the money. Ask again and you'll be sorry.`,
    jealousy: `${V1},\n\nYou think you can just walk away after everything? Nobody leaves me. You'll regret this.`,
    grudge: `${V1},\n\nYou cost me my job. I won't forget it, and neither will you.`,
    blackmail: `${V1},\n\nNot one more dollar. Go to the police and see what happens to you first.`,
  };
  let gi = 0;
  for (const m of plan.motive) {
    if (m !== 'gossip' && made.has(m)) continue;
    made.add(m);
    if (m === 'gossip') { if (gi < gossipers.length) say(gossipers[gi++], rumour[motive], { suspect: kil.id, victim: vic.id, case: c.id }); continue; }
    if (m === 'signed') {
      if (motive === 'debt') doc(vh.spotKeys.desk, { name: 'I.O.U.', text: `I.O.U.\n\nI promise to repay {p:${vic.id}} the sum of $${amt}.00 in full by the end of the month.\n\nSigned, {p:${kil.id}}` }, { ident: 'name', role: 'author' });
      if (motive === 'jealousy') doc(vh.spotKeys.living, { name: 'Threatening letter', text: `${threat.jealousy}\n\n— {p:${kil.id}}` }, { ident: 'name', role: 'author' });
      if (motive === 'grudge') doc(A[vic.work].spotKeys.office, { name: 'Disciplinary memo', text: `INTERNAL MEMO — {a:${vic.work}}\n\nFollowing a formal complaint filed by {p:${vic.id}}, {p:${kil.id}} is suspended without pay pending review.\n\n— Management` }, { ident: 'name', role: 'subject' });
      if (motive === 'blackmail') doc(ks('desk'), { name: 'Anonymous note', text: `Addressed to {p:${kil.id}}:\n\nI know what you did. $500, every Friday, in the usual place. Or the police hear everything. — ${V1}` }, { ident: 'name', role: 'subject' });
    }
    if (m === 'initialsBook') {
      const ini = initials(kil);
      if (motive === 'blackmail' || motive === 'debt') doc(vh.spotKeys.desk, { name: 'Ledger', text: `A small ledger in {p:${vic.id}}'s handwriting:\n\n${ini} — $${motive === 'debt' ? amt : 500} — ${motive === 'debt' ? 'lent, NOT repaid' : 'paid'}\n${ini} — $500 — LATE\n\nAt the bottom: "${motive === 'debt' ? 'Going to make a scene if I have to.' : 'Raise to $1000?'}"` }, { ident: 'initials', role: 'subject' });
      else doc(vh.spotKeys.desk, { name: 'Diary', text: `Diary of {p:${vic.id}}:\n\n"${ini} ${motive === 'grudge' ? 'cornered me in the break room today. Said I ruined their life and that I\'d pay for it.' : 'was outside again last night. I told them it\'s over. I\'m frightened.'}"` }, { ident: 'initials', role: 'subject' });
    }
    if (m === 'typed') {
      const tw = Object.values(W.items).find(i => i.kind === 'typewriter' && i.data.addr === kil.work)!;
      doc(vh.spotKeys.living, { name: 'Typed letter', text: `Typewritten. Looking closely, ${tw.data.defect}.\n\n${threat[motive]}\n\n— ${initials(kil)}`, data: { typed: tw.id } }, { ident: 'initials', role: 'author' });
    }
    if (m === 'hand') {
      const scrawl: Record<Case['motive'], string> = {
        debt: `I know you're telling people about the money. Keep your mouth shut.`,
        jealousy: `I saw you with someone new. Don't think I'll stand by and watch.`,
        grudge: `Everyone at work knows what you did to me. You'll get yours.`,
        blackmail: `This ends now. You've had your last payment.`,
      };
      doc(vh.spotKeys.living, { name: 'Anonymous letter', text: `Handwritten, unsigned:\n\n${scrawl[motive]}`, data: { hand: true, author: kil.id } }, { ident: 'anon', role: 'author' });
      const f = kil.friends.length ? P[rng.pick(kil.friends)] : vic;
      addItem(W, ks('desk'), { name: 'Unsent letter', text: `Handwritten:\n\nDear ${f.first},\n\nSorry I haven't written. Things have been hard lately. I'll explain when I see you.\n\nYours, {p:${kil.id}}`, data: { hand: true, author: kil.id, signed: true }, prints: [kil.id] });
    }
  }
  for (const h of herrings) {
    const hm: Motive = { suspect: h.id, victim: vic.id, case: c.id, weak: true };
    const text = `{p:${h.id}} STILL hasn't paid me back for the car repairs. We had a shouting match about it. Never lending ${pron(h).obj} anything again.`;
    const teller = gossipers.find(g => g.id !== h.id && !c.gossip[g.id]);
    if (rng.chance(0.5) || !teller) addItem(W, vh.spotKeys.desk, { name: 'Note to self', motive: hm, text: `In {p:${vic.id}}'s handwriting:\n\n"${text}"` });
    else say(teller, `${V1} and {p:${h.id}} had a screaming match about money a few days ago. Something about a car.`, hm);
  }

  // ---------------- Phone calls that day, consistent with where everyone was
  const answered = (aid: string, t: number) => t < EVE || A[aid].kind !== 'home' || A[aid].residents.some(r => placeAt(W, c, r, t) === aid);
  {
    const t = rng.int(1110, 1215);
    const from = homeAt(kil.id, t) ? kh.id : placeAt(W, c, kil.id, t) === kil.work ? kil.work : null;
    if (from) W.calls.push({ from, to: vh.id, day, t, dur: answered(vh.id, t) ? rng.int(2, 6) : 0, by: kil.id });
  }
  for (let i = rng.int(1, 3); i > 0; i--) {
    const f = P[rng.pick(vic.friends.length ? vic.friends : [kil.id])];
    if (f.id !== kil.id) W.calls.push({ from: f.home, to: vh.id, day, t: rng.int(600, 1050), dur: rng.int(1, 8) });
  }
  const caller = rng.shuffle(vBook.data.entries!.map(id => P[id])).find(f => f.id !== kil.id && free(f) && homeAt(f.id, T - 16) && homeAt(f.id, T - 10));
  if (caller) {
    const t = T - rng.int(12, 16);
    W.calls.push({ from: caller.home, to: vh.id, day, t, dur: rng.int(3, 5), by: caller.id });
    W.calls.push({ from: caller.home, to: vh.id, day, t: T + rng.int(25, 60), dur: 0, by: caller.id });
  }
  for (const p of alive) if (p.friends.length && rng.chance(0.2)) {
    const q = P[rng.pick(p.friends)], t = rng.int(480, 1050);
    if (q.id !== vic.id) W.calls.push({ from: p.home, to: q.home, day, t, dur: rng.int(1, 12) });
  }

  // ---------------- Records of the night
  for (const a of Object.values(A)) if (a.kind === 'business' && CLOCKED.includes(a.biz!)) {
    c.timesheets[a.id] = addItem(W, a.spotKeys.office, { kind: 'timesheet', name: `Timesheet, ${a.name} — ${fmtDate(day)}`, data: { addr: a.id, day } }).id;
  }
  for (const b of bars) {
    const tabs = Object.entries(c.timeline).flatMap(([pid, segs]) => segs.filter(s => s.place === b.id).map(s => ({ pid, t: s.from, close: s.to, order: rng.pick(DRINKS) })))
      .sort((x, y) => x.t - y.t);
    c.tabBooks[b.id] = addItem(W, b.spotKeys.counter, { kind: 'tabs', name: `Bar tabs, ${b.name} — ${fmtDate(day)}`, data: { addr: b.id, day, tabs } }).id;
  }
  c.secondLieBar = (rng.shuffle(bars).find(b => !(c.timeline[kil.id] || []).some(s => s.place === b.id)) || bars[0]).id;
  for (const a of Object.values(A)) {
    if (a.biz === 'diner') addItem(W, a.spotKeys.counter, { kind: 'paper', name: `Morning paper, ${fmtDate(day + 1)}`, text: '', data: { day } });
  }
  addItem(W, A[W.buildings[vh.building].lobby!].spotKeys.mail, { kind: 'paper', name: `Morning paper, ${fmtDate(day + 1)}`, text: '', data: { day } });

  // ---------------- Neighbours who noticed something
  const atHomeNow = neighbors.filter(n => !c.liars[n.id] && homeAt(n.id, T) && homeAt(n.id, leave + 2));
  if (atHomeNow[0]) (c.witnesses[atHomeNow[0].id] ||= []).push({ kind: 'noise', t: T });
  const seer = atHomeNow[1] || atHomeNow[0];
  if (seer) (c.witnesses[seer.id] ||= []).push({ kind: 'leaving', t: leave + 1, locked: c.locked && D.id !== 'hard' });
  for (const s of sightings) (c.witnesses[s.by.id] ||= []).push({ kind: 'visit', pid: s.h.id, t: s.t });

  // ---------------- Who stonewalls. Anyone whose word the case leans on must talk.
  const mustTalk = new Set<string>([...(kil.partner ? [kil.partner] : []), ...Object.keys(c.lovers), ...Object.keys(c.witnesses), ...c.keyholders]);
  if (c.accomplice) mustTalk.add(c.accomplice);
  for (const pid of Object.keys(c.liars)) { const pt = P[pid].partner; if (pt) mustTalk.add(pt); }
  for (const p of alive) {
    if (p.id === kil.id) { if (rng.chance(D.killerRefusesPrints)) c.refusers.push(p.id); continue; }
    if (rng.chance(D.refuseRate)) c.refusers.push(p.id);
    if (!mustTalk.has(p.id) && !c.liars[p.id] && rng.chance(D.silentRate)) c.silent.push(p.id);
  }
  return c;
}
