# NORI avatar source assets

These are the user-supplied source assets for NORI's particle-avatar work.
They are retained as source material; the desktop does not display their
original clothing, textures, or likeness as a conventional character model.
Instead, NORI samples their spatial mesh surface into its own ghost-purple
particle field and drives that field with NORI-authored gaze, speech, thinking,
and magnetic-harness behaviour.

## Authoritative inputs

| Asset | Purpose |
| --- | --- |
| `NORI-avatar-source.glb` | Deterministic mesh source for the particle face, skull, neck, shoulders, and thinking-body volume. |
| `NORI-avatar-rigged-source.fbx` | Rigged reference for future authored body motion and animation retargeting. |

The current Unreal desktop includes generated geometry samples in
`C:/Cortana/unreal/NoriDesktop/Source/NoriDesktop/NoriModelSamples.inl`.
Those samples name the GLB above as their source. The original mesh remains
available so later particle-sampler improvements can be reproduced without
depending on the Downloads folder.

## Presentation contract

- Idle and speaking: frame the forward face and upper shoulders; keep real
  spatial depth visible under head turns.
- Speaking: drive only the mouth and jaw region with audio-relative visemes.
- Thinking: pull back to NORI's complete particle body and activate a sparse
  blue-white neuron subset flowing through the head and body.
- The magnetic harness stays an open crown-to-shoulder field. It must not form
  a sphere, a rectangle behind the avatar, or a detached second background.
