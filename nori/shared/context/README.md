# NORI Context Graph

The context graph is NORI's local memory-and-context layer. It connects the
operator profile, active projects, tasks, rules, decisions, learned notes and
session closeouts in one durable JSON graph under `runtime-data/context-graph`.

Every prompt activates `GLOBAL` plus only the domains whose prompt or path
keywords match. Injected items are fingerprinted per conversation and are not
repeated unless they change or a long-session refresh bracket is reached.

`*end` is handled by the Nori work-session runtime. It closes the current
conversation, records completed and blocked work in a durable closeout, and
allows the next session to start from current graph state.

The CLI is available with `python -m nori.nori_context` from `C:\Nori`:

```powershell
python -m nori.nori_context project add nori --path C:\Nori
python -m nori.nori_context domain add carousel --prompt-keyword carousel
python -m nori.nori_context rule add --domain carousel --text "Use 1080 x 1350 frames"
python -m nori.nori_context session start my-session --prompt "Work on a carousel"
python -m nori.nori_context session end my-session
```
