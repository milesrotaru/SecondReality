# Second Reality HD

A browser remake of Future Crew's *Second Reality* (Assembly '93) built from
this repository's released source and data. Every part is re-rendered at the
display's native resolution in WebGL2; the soundtrack is the original S3M
music played by a JavaScript port of the demo's own replayer, and the demo
clock follows the audio, so parts start on the same rows they did in 1993.

`dist/index.html` is the whole thing in one file (about 2 MB). Open it in a
current desktop browser and click *Start the demo*.

Three renderers, chosen on the start screen (or `?mode=p3` / `?mode=hd` /
`?mode=remix`, `#p3` / `#hd` / `#remix`):

- **Pentium III** (default): the demo as a meticulous software renderer on a
  733 MHz Pentium III would draw it. A 640x400 true-colour frame (an exact 2x
  of the 320x200 art, keeping its 4:3 pixel shape) at 70 fps, art shown at
  integer scales copied pixel for pixel, bilinear filtering wherever art is
  scaled or warped, perspective-correct texturing on the plasma cube, no
  anti-aliasing. The frame is scaled to the screen with crisp pixels.
- **Native HD**: every effect evaluated at the display's full resolution, with
  bicubic resampling and multisampled edges.
- **Remix**: the choreography is fixed - music, cuts, syncs, simulations,
  paths, fades - and every part is rebuilt as a 3D scene with modern shaders
  in linear HDR (bloom, ACES tonemapping, grain). The pictures become scenes:
  where the art's palette separates its layers (title, troll, lens face,
  end rings) they are cut from it and rebuilt as sculpted reliefs or solids;
  where a precomputed table hides a 3D setup (the hill scroller's text
  surface, the water scroller's flying strip) a homography fitted to the
  table recovers the camera and plane. Highlights: raytraced glass glenz
  vectors, a raymarched moonscape with a Praxis shock ring, the city flight
  with sun shadows, the water scene raytraced live, the credits showing live
  renders of the remixed parts. The HDR buffer's resolution adapts to the
  GPU's frame rate.

Controls: `←` / `→` previous / next part, `Space` pause, `F` fullscreen,
`M` mute. URL options: `?part=Glenz`, `?t=300` (seconds), `?mute=1`,
`?scale=0.5` (render resolution).

## Building

```sh
npm install                  # esbuild
python3 tools/build_assets.py  # original data -> build/assets.pack
npm run build                # -> dist/index.html
```

For development, serve this directory (`python3 -m http.server 8080`) and open
`index.html`; it loads `src/` as ES modules and the unbundled asset pack.
`node tools/shot.mjs out 120 300` renders exact demo times headlessly.

## How it is put together

- `src/audio/` - S3M loader (including STMIK's pattern scrambling), a
  replayer following STMIK 3.00's effect semantics, row/tick timelines for the
  sync queries the parts made (`dis_musplus`, order/row, music frames), and an
  AudioWorklet that plays the music plan of `MAIN/U2.ASM` (MUSIC0, MUSIC1 at
  Glenz, MUSIC0 from order 18 at the city flight, fade at the end).
- `src/demo.js` - the part order and music restarts of `U2.ASM`. Parts answer
  "when do I start and end" up front, from the music timeline, instead of
  polling the player.
- `src/gfx/visu.js` - the VISU 3D engine for the two ship/city parts: the
  original fixed-point transforms, lighting and palette shading, with
  per-object painter's lists combined with a depth buffer.
- `src/parts/` - one file per part. Each header comment names the source files
  it ports and what the HD version does differently.
- `tools/` - asset extraction from the release (OMF objects, LBM, FC picture
  formats, include-file tables).

HD techniques, briefly: fixed-point and palette tricks are evaluated
analytically per pixel (plasmas, lens refraction, techno interference rings,
the voxel landscape's ray envelope); scatter tables (hill and mirror-ball
scrollers) are inverted offline into per-pixel maps; 70 Hz state machines are
interpolated between retraces; bitmaps are resampled bicubically; palette
fades become exact RGB blends; checkerboard/flicker blends are averaged in
linear light as a CRT would.

## Fidelity notes

Timing and look were checked frame by frame against a DOSBox capture of the
released binary, aligned to it through the soundtrack. The released source is
not quite what shipped; where they disagree the remake follows the binary:

- MNTSCRL starts the hills on row 18 and fades on musplus -14 (source: 0, -11).
- PLZPART runs three plasmas, not five, and parks the cube at distance 350.
- MINVBALL ends at frame ~2225 without the white flash.
- CRED has different texts and pictures on several screens (the released
  `PIC02.LBM` is a "PARTPIC MISSING" placeholder); the 21 pictures in
  `data/cred_pics.png` are cropped losslessly from the capture.
- ENDSCRL uses 25-scanline lines, `[n` spacer lines and a font with more glyphs
  than the released `FONA.INC`; `data/endscrl_font.*` was cut from the capture.

Several of the demo's own quirks are kept on purpose: RAYSCRL's double-speed
red fade (`for pf := 0 to 3`), the voxel ray's `adc ax,-1` drift, the
landscape's jump when the musplus wait is absorbed by the first `waitb`.
The hidden DDSTARS part is not included.

The original demo and its data are Future Crew's, released to the public
domain; see the repository README.
