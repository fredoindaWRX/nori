# NORI Architect

**One dispatcher. Explicit roles. A connected Round Table.**

NORI Architect is NORI's task-graph and worker-dispatch implementation. This
repository is a development fork of CrewAI with a separately implemented NORI
package in `lib/nori-architect`. The package does not import the CrewAI runtime.

## Implemented

- Dependency-ordered tasks, role capability checks, and explicit permission grants.
- Home, Server, and Robotics admission profiles for twelve Knight identities.
- Explicit worker bindings and optional MCP stdio transport.
- Local NORI model-service integration and metadata audit events.
- Failures and unavailable workers reported without silently changing workers.

## Install and verify

Use Python 3.10 or newer in a virtual environment, from this repository:

```sh
python -m pip install './lib/nori-architect[mcp]'
python -m unittest discover -s lib/nori-architect/tests -v
nori-architect --help
```

The base package has no runtime dependencies. The optional MCP extra installs
the pinned MCP SDK. A running NORI model service and separately supplied model
are required for real inference. Installation does not download model weights.
See [configuration and examples](NORI-ARCHITECT.md).

## Development status

Version `0.1.0.dev5` is an early development implementation. Its tests cover task
routing and MCP behavior; they do not establish twelve completed Knights or a
finished operating system. Output is a proposal, not verified truth or executed
action. Sandboxing, resumable graphs, authenticated remote transport, and full
OS integration remain unfinished. This repository does not yet include the NORI
model service or a complete platform installer.

## Attribution

Original CrewAI code remains under its [MIT license](LICENSE); its original
landing page is retained as [README-UPSTREAM.md](README-UPSTREAM.md). NORI's
package has its own [MIT license](lib/nori-architect/LICENSE). See [NOTICE](NOTICE)
for scope. Existing upstream package names remain in retained upstream source;
NORI users should install the NORI package above, not the upstream root project.
