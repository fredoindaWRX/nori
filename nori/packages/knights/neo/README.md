# Neo — NORI Software Engineer

Neo is the first NORI Knight package. It writes, debugs, tests, and prepares production code inside an approved repository workspace.

- [`agents/neo.py`](agents/neo.py) provides the optional CrewAI adapter and the NORI `NeoAgent` class.
- [`prompts/neo.md`](prompts/neo.md) is Neo’s system prompt and hard boundaries.
- [`tools/neo_tools.py`](tools/neo_tools.py) provides bounded local MCP-shaped code, file, Git, and terminal tools.
- [`tests/test_neo.py`](tests/test_neo.py) validates the package contract.

The development route is `ollama/devstral` at `127.0.0.1:11434`. NORI does not require Ollama in a shipped OS: Seth remains the product model-service boundary. The optional CrewAI adapter only constructs when CrewAI is installed; the native local tool contract remains functional without it.
