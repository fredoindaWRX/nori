# Desktop orb source

These authored files build `dist/assets/nori-orb-20261108.js`, loaded directly by `dist/index.html`. The React SVG scene is not the only scene shipped in the desktop page.

Before modification, `nori-orb.js`, `orb-scene.js`, and `pieces.js` reproduced the original 605,079-byte bundle exactly: SHA-256 `c66d1c9a4be779d95c4870f5954392d86d317853e9145d13b8336464b45d8c14` with esbuild 0.28.1 and Three 0.185.1. The older r69 directory was read as provenance, not used as the development destination.

Run `node apps/desktop/src/orb/render-profile.test.mjs` from the repository root for focused profile and startup lifecycle tests. `node apps/desktop/src/orb/build.mjs` builds in memory and reports a hash; add `--write` to replace only the generated orb bundle. `NORI_ORB_BUILD_DEPS` may point to an existing dependency directory containing the reviewed esbuild and Three versions. The build never installs dependencies. The current desktop dependency directory does not yet contain that complete build toolchain.

Recognized software renderers retain the 3D scene with a smaller rendering budget and no bloom/composer passes. Hardware and unknown renderers retain the original presentation settings. Shader warmup is deferred, but Three's `compileAsync` includes synchronous work and cannot guarantee a responsive first frame on every driver.

Focused tests and reproducible output do not establish guest or installed-app acceptance. Guest visual and responsiveness checks are maintained separately under `nori-os/scripts/guest_real_20261113/`.
