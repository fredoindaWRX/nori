# NORI Knights upstream inventory

These are source foundations under review, not twelve installed workers. The [Architect fork](https://github.com/fredoindaWRX/nori-architect) now exists in the user's account; its NORI implementation is committed locally as `4f04c04` but has not yet been pushed because Git HTTPS authentication is unavailable. Browser sign-in works separately. The other eleven forks remain pending. Root licenses were retrieved at the commits below; nested components, dependencies, trademarks, and NOTICE files remain under review. This inventory alone does not approve a runtime import.

| Knight | Upstream | Root license | Pinned commit |
|---|---|---|---|
| neo | [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | MIT | `2c5ce2fa2dca3aa9c7442ff1c46876c60a794eeb` |
| trinity | [aaif-goose/goose](https://github.com/aaif-goose/goose) | Apache-2.0 | `50666ae0b9a51e260b52b7efbab2e4e020346e94` |
| morpheus | [cline/cline](https://github.com/cline/cline) | Apache-2.0 | `cfe9cadab99617d5013bf89f07b079d105057791` |
| apoc | [browser-use/browser-use](https://github.com/browser-use/browser-use) | MIT | `50f205533fe10ba35b553d2a3689c77b87bd5d0a` |
| oracle | [khoj-ai/khoj](https://github.com/khoj-ai/khoj) | AGPL-3.0 | `ae229ca894c0b80ad84664afcfdde523b5e87057` |
| merovingian | [letta-ai/letta](https://github.com/letta-ai/letta) | Apache-2.0 | `5bcdd177d70fa2b31a754cfcd801e77b2e1ab16a` |
| architect | [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) | MIT | `894898f84c4ac0a89f24bf7bee6c381eb0e67f51` |
| keymaker | [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) | Apache-2.0 | `6f998577d547b1e54ec662dac63583aa11e3b84b` |
| smith | [openinterpreter/openinterpreter](https://github.com/openinterpreter/openinterpreter) | Apache-2.0 | `2885d0d8ba0fd8a036695c5abebbb9524dcca015` |
| tank | [agent0ai/agent-zero](https://github.com/agent0ai/agent-zero) | MIT | `b1cbd1f960a1a5c4482b324dcff4742aa67b7a51` |
| machine | [mudler/LocalAI](https://github.com/mudler/LocalAI) | MIT | `64628da9ddb703ca222944d64059c6b5dcdd7072` |
| sentinel | [openclaw/openclaw](https://github.com/openclaw/openclaw) | MIT | `da762af0e80c9fe6a61422dc5591ab24e5c9a3ce` |

Khoj differs from the proposed MIT/Apache assumption: its captured root license is AGPL-3.0. Its intended distribution and service integration need a compatible design before importing code.

Agent Zero and OpenClaw were classified NOASSERTION by the API; their saved root files contain MIT text. This manual observation does not replace review of their other notices.
