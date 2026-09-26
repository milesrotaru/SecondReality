// Part order and music restarts exactly as MAIN/U2.ASM runs them.
import alku from './alku.js';
import u2a from './u2a.js';
import pam from './pam.js';
import beglogo from './beglogo.js';
import glenz from './glenz.js';
import tunneli from './tunneli.js';
import techno from './techno.js';
import panic from './panic.js';
import mntscrl from './mntscrl.js';
import lens from './lens.js';
import plz from './plz.js';

export const PARTS = [
  { music: [0, 0] },
  alku,
  u2a,
  pam,
  beglogo,
  { music: [1, 0] },
  glenz,
  tunneli,
  techno,
  panic,
  { waitPlus: true },
  mntscrl,
  lens,
  plz,
];
