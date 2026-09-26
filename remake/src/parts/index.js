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
import minvball from './minvball.js';
import rayscrl from './rayscrl.js';
import sinfld from './sinfld.js';
import jplogo from './jplogo.js';
import u2e from './u2e.js';
import endlogo from './endlogo.js';
import cred from './cred.js';
import endscrl from './endscrl.js';
import u2end from './u2end.js';

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
  minvball,
  rayscrl,
  sinfld,
  jplogo,
  { music: [0, 18] },
  u2e,
  endlogo,
  cred,
  endscrl,
  u2end,
];
