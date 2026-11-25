# Nori's face and memory look (owner vision, 2026-11-14)

Wil's reference: the J.A.R.V.I.S. birth / consciousness scene in *Avengers: Age of Ultron* (he shared the
clip and frames). Two things he wants:

## 1. Her orb / face — the consciousness sphere

Not a smooth round ball. A **faceted blue crystalline sphere of light**:
- Layered shells ("her layers") — concentric faceted lattices, depth you can see through.
- A dense web of nodes and filaments, **firing** (pulses running along the connections).
- A hot bright **core** at the center.
- Particles streaming off the surface.
- Blue, electric/icy, alive — reads as a mind thinking, not a logo.

**Quality bar (settled 2026-11-14):** real-time WebGL/Three.js on the GPU, not offline movie render.
Movie-8K is farm-rendered hours per frame; her face must run live at 60fps on the RTX 4080 while she also runs
her models. Target = real engine (depth, additive glow, bloom post, thousands of GPU particles) at the
display's native resolution — looks premium AND moves like her. Previews shown in chat: a flat 2D canvas sketch
(shape lock) then a real WebGL point-sphere (the actual quality path).

## 2. Memory access / data — the data-city dive

When she reaches into memory or pulls data, it should look like **flying through a city of data** — the
JARVIS flythrough: diving forward through an endless field of glowing blue data blocks, light streaking past,
the occasional warm/orange node, accelerating into it. So "recall" is a visible dive, not a spinner.

## Build path (not started; after a stream, since it restarts her)

- Port the look into her real face scene `apps/desktop/src/orb/orb-scene.js` (Three.js). Codex ported the orb
  source there; coordinate on the board before editing it.
- Add bloom/glow post-processing; keep it tuned so it does not starve her models on the 4080.
- The memory-dive is a second mode the face plays while a recall/data task runs (ties to cue recall, R88/R89).
- Keep it a live real-time scene, never a video loop. Install = one Nori restart.

## 3. Recall dives INTO her (2026-11-14)

When she recalls, the camera flies **into the white-hot core** and through it — a white-out — into her **inner space** (the data-city / neural volume from the clip). "Inside" is the highest-detail scene: flying through her memory. So recall isn't a push-in, it's a transition from the orb → inside her mind. Coming back out reverses it. This is the memory-dive, entered through the core.

## 4. The structure is tied to her real system (2026-11-14)

The neurons/nodes/ribbons are not decoration — they map to her **actual memory**. As memories, past exchanges and journal entries are added (the cue corpus, R88/R89 — real vectors), **new nodes appear in the orb**, placed in the region their vector belongs to, so related memories cluster in the same "area" (like the growing structure in the clip). The orb literally grows as she learns. On recall, the node she matched lights and the dive heads toward its cluster. This ties the visual to `learning/experience.jsonl`, the journal, `learning/cue-vectors.json` and `settings/learned-guidance.json`.

**Build note:** in the standalone preview this is simulated with a node count; in her real face it reads her actual memory store so the growth and the clusters are true.

## 5. Settings panel + vivid inner space (2026-11-14)

- Her real app gets a **settings panel to fine-tune the whole face**: colours, density, bloom/glow, dive speed, firing rate, how much it reacts, etc. — alongside her other settings. So the look is dialable, not hard-coded.
- **Inside (the memory dive) is the detail showcase:** very vivid and dense — a real city of memory, highest detail, while holding a high framerate. Keep it on GPU points/instancing so density scales without dropping FPS; reserve the heaviest effects for a quality setting that higher-end GPUs (the 4080) turn up.

## 6. This IS the Nori OS desktop (owner, 2026-11-14)

Wil: "this will be nori os desktop." The orb + dive is not just her avatar — it is the **Nori OS desktop environment itself**, extending `nori-os/docs/DECISION-ORB-DESKTOP-20261112.md`:

- **The desktop at rest** = her orb (her avatar/face), present and alive, with the top auto-hide bar; apps open over it.
- **Diving in (Recall)** = you enter her **data-world**: a navigable 3D space built from her real files and memory. Cubes are real files/memories, laid out by sector (the vector clusters). Up close a cube shows its **actual contents** — an image's thumbnail on its face, a file's name. You look around and **locate files in a sector**; you fly to things. A spatial file/memory browser you walk through inside her.
- So the OS interface = orb desktop ⇄ immersive data-world, one continuous space, driven by her real data.

**Scope / ownership:** this is the Nori OS shell, so it belongs with the OS work (Codex owns nori-os, incl. the M8 orb-desktop and the compositor swap in KIOSK-SHELL.md). The real version reads her actual files and renders thumbnails on the GPU — it cannot be shown in a chat-sandbox preview (no file access, textures blocked); the preview artifact only shows the *look*. Claude's artifact `https://claude.ai/artifact/PW2XLAMLPwT4WiQyXFNt25` is the visual reference to build from.

## Build status (2026-11-15)

Built in source, waiting for install: the crystal sphere (parts 1, 3) and the recall dive with its inner
space (parts 2, 3) are in `apps/desktop/src/orb/crystal-scene.js`, the default face in `nori-orb.js`
(the earlier lattice orb stays as a fallback: `window.noriOrb.face('lattice')`). Try the dive with
Ctrl+Shift+M. The face settings panel (part 5) opens with Ctrl+Shift+F; the same dials are `window.noriOrb.settings({bloom, density,
fireRate, diveSpeed, brightness})`.

Part 4 is built in source too: one node per real memory vector on the sphere (positions and hash prefixes
only reach the page), recalled nodes turn amber, and she dives in and out by herself when a message brings
memories back (panel toggle). The panel includes colour (hue, strength, presets).

The city inside her is real too: one block per memory, districts by meaning (`src/orb/memory-city.js`).
A manual dive tours the districts; a recall flies to the recalled block, which turns amber.

Up close a block shows its label (kind, day, first words), its faces run data, light runs along the links
between memories, glyph rain falls through the districts, and blocks assemble as she flies in. Owner decision
2026-11-15: labels on; the app withholds them from the page whenever OBS is running.

Still to build: files in the city (names, thumbnails), then the Nori OS desktop (part 6).

## Matched against the clip frames (2026-11-15)

The owner's frames are his screenshots in `Pictures\Screenshots` (2026-11-14 194446, 194451, 194457 for the
inside; 194531, 194535, 194553 for the figure). Built from them, in source:

- **Figure** (`src/orb/figure.js`): crumpled see-through membrane with etched lines and bright creases, an
  inner membrane, cracks of light from the core, dashes swirling around her, and orange circuit traces (the
  Ultron figure) while she uses tools.
- **Inside** (`src/orb/city-structure.js`, `city-detail.js`): a canyon of dark solid blocks with small lit
  windows, her memories as lit blocks inside it with labels, orange when recalled, motion streaks on the rush.

Side by side: `docs/reference/nori-vs-clip-20261115.jpg`. It is the same kind of image now, still drawn-looking
next to the film: softer folds, no depth of field, simpler lighting.
