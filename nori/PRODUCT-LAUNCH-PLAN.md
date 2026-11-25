# NORI product launch plan

This is the working order for turning NORI into a product people can install,
understand, and pay for. It keeps the complete Home, Server, and Robotics
vision intact while giving the team a near-term release target.

Project-continuity note: legacy Cortana and Aoki work is NORI lineage material;
see `Documentation/PRODUCT-LINEAGE.md`. New public-facing work uses N.O.R.I.

## Product promise for the first public release

**NORI Home + Nexus Node** is a private local assistant that runs on a normal
Windows PC, can pair to a second NORI Server machine, and helps the owner
through a fast voice or text conversation without sending ordinary requests to
a paid cloud API.

It is not marketed as an autonomous business manager, vehicle programmer,
medical product, or robotics controller in the first release.

## The release path

### 0. Create one source of truth

Maintain a release board with one owner, one priority list, one definition of
done, and one current build. A feature is either **backlog**, **in progress**,
**verified**, or **released**. Screenshots and ideas are not release evidence.

### 1. Finish the vertical slice before broad features

The first customer-demo flow is:

1. Install NORI Home on a supported Windows PC.
2. Open a polished NORI desktop.
3. Say or type a question.
4. Hear and see a response quickly, with the particle avatar speaking.
5. Pair a NORI Server node with a one-time code.
6. Ask the same question again and show that the Server carried out the local
   model work while Home stayed responsive.
7. Show the history, memory control, device/node status, and audit record.

Every feature that does not improve one of those seven moments is second-wave
work until the vertical slice is demonstrably solid.

### 2. Ship Home as an application before claiming a replacement OS

NORI Home first ships as a signed Windows desktop application plus the NORI
runtime. That makes testing, support, drivers, Steam, Discord, browsers, and
games practical from day one.

The installable NORI Home OS remains a parallel edition, but it is released
only after it proves boot, install, network, graphics, audio, updates, recovery,
and a clean uninstall/rollback path on a supported hardware matrix.

### 3. Ship Server as an appliance-style node

The first Server product is one approved hardware profile with a clear setup
card: connect power and Ethernet, boot NORI Server, scan a pairing code, and
approve the Home node. It must have backups, health checks, remote update
controls, a hardware replacement procedure, and a way to restore from a failed
update.

Support additional PCs after the initial profile is proven. Do not promise that
every PC works until each class has a documented pass result.

### 4. Treat Robotics and Drive as separately validated products

Robotics, vehicle diagnostics, actuator commands, and medical/wearable data
have different consequences from a desktop conversation. Build their adapters
behind explicit capability boundaries, test them with simulators or read-only
hardware first, and release each adapter only with its own supported-device
list, permissions, test results, and recovery procedure.

### 5. Make the product runnable without the developer present

Before an outside tester gets NORI, the release must include:

- a real installer and removal path;
- clear first-run setup and recovery instructions;
- version number, build number, checksums, and release notes;
- automatic diagnostic collection that is opt-in and understandable;
- local logs and a one-click export for support;
- a privacy statement explaining what stays local, what may leave the machine,
  and what the owner can delete;
- a license and complete third-party notices;
- a support contact and a known-issues page.

### 6. Build trust into every release

NORI releases must have a repeatable build, protected signing keys, dependency
inventory, vulnerability response process, release verification, and rollback.
AI features must have a stated purpose, capability boundaries, tested failure
cases, and a way to report and resolve incidents.

### 7. Establish the business foundation before marketing hard

Before paid pilots or hardware rentals:

1. Search the intended product and company names before investing heavily in
   logos, packaging, domains, or advertising.
2. Record authorship and chain of ownership for NORI-written code, art, sound,
   documentation, and model packaging.
3. Keep license evidence for every dependency and asset; do not add a component
   until its redistribution terms are understood.
4. Decide the company structure, bookkeeping, tax workflow, warranty/returns,
   support terms, and the first pilot agreement with appropriate professional
   advice.
5. Build a waitlist and interview prospective users before making inventory.
6. Run a closed pilot with a small number of people, gather consented telemetry
   and direct feedback, then fix the issues they actually encounter.

## Current NORI focus

1. Complete the graphical Home image build and capture a real booted installer.
2. Complete the Home desktop vertical slice: wake/listen, local reply, speech,
   visemes, responsive particle avatar, memory controls, and clear state UI.
3. Complete a paired Home-to-Server test using two disposable virtual machines.
4. Produce the first supported-hardware matrix and one Server appliance setup
   guide.
5. Expand the Knights only when each worker meets NORI's native functionality,
   audit, packaging, failure-recovery, and edition-startup gates.

## What makes the program faster

- Keep one active release milestone at a time.
- Use reusable checks and installers instead of one-off manual fixes.
- Test on disposable virtual machines before physical devices.
- Design the Home, Server, and Robotics layers as one shared runtime with
  edition-specific capabilities.
- Keep a strict difference between **prototype shown**, **feature verified**,
  and **customer release**.
- Bring outside users in early, but only after the installation and recovery
  experience is safe enough for them to use without developer intervention.
# Related product roadmaps

- [NORI Market Intelligence](ROADMAP-MARKET-INTELLIGENCE.md)
- [NORI Ledger and NORI Coin](ROADMAP-NORI-LEDGER.md)
