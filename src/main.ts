import './style.css';
import { proofTree } from './proof';
import { K, W, setState } from './state';
import type { Knowledge, World } from './types';
import { Board } from './ui/board';
import { SAVE_KEY, beginNewCity, bindInput, refresh, switchTab } from './ui/view';

bindInput();

let loaded = false;
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') as { W: World; K: Knowledge } | null;
  if (s?.W?.cases?.length && s.K) { setState(s.W, s.K); loaded = true; }
} catch { /* no usable save */ }

// Saves from before the explained proof: build it for open cases now, while the world still matches the case.
if (loaded) { for (const c of W.cases) if (!c.solved) proofTree(c); switchTab('location'); refresh(); Board.applyView(); }
else beginNewCity(Math.floor(Math.random() * 1e9));

// Dev-only handle for poking at the hidden truth from the browser console. Stripped from production builds.
if (import.meta.env.DEV) Object.assign(window, { __cf: { get W() { return W; }, get K() { return K; } } });
