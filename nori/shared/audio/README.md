# NORI Neon Circuit sonic identity

This directory contains NORI's original system sound palette. The cues use
procedural synthesis and do not copy samples, melodies, recordings, or branding
from a film, game, operating system, or other product.

`generate_sonic_identity.py` deterministically creates mono PCM16 WAV files at
48 kHz. `cues/sonic-identity.json` maps semantic events to files so Home,
Server, Robotics, the installer, and the desktop can share one stable contract.

The initial palette covers Home and Server startup, owner verification, Knight
dispatch, task completion, a general warning, and a distinct Watchman safe-state
intervention. Spoken startup lines remain separate speech events so voices and
localization can change without rebuilding the sound effects.
