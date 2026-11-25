# NORI monorepo map

NORI is one product repository with three deployment editions and a shared local platform. `shared/` is executable NORI-owned code; `packages/knights/` is the stable product contract for the twelve Knights. Reference projects, when retained for license or design review, stay out of the runtime path.

```text
nori/
├── OS/
│   ├── home/                 NORI Home OS edition
│   ├── server/               NORI Server OS edition and A/B updates
│   ├── robotics/             NORI Robotics OS simulation and safety boundary
│   ├── desktop/              NORI desktop experience
│   ├── build/                installer, payload, and virtual-machine verification
│   └── vehicle/              future vehicle integration boundary
├── shared/
│   ├── model-service/        Seth: NORI local model API, registry, and admission
│   ├── orchestration/        Round Table host, dispatch graph, native implementations
│   ├── identity/             enrollment, owner presence, recovery, and provisioning
│   ├── permissions/          policy decisions and entitlement boundaries
│   ├── audit/                append-only local audit events
│   ├── hardware/             compatible-PC discovery and hardware abstraction
│   ├── robotics/             Watchman authority boundary and robotics contracts
│   ├── voice/                voice pipeline and identity enrollment foundation
│   ├── avatar/               particle-avatar experience assets and behavior
│   ├── memory/               persistent local NORI memory
│   ├── knowledge/            private document indexing and retrieval
│   ├── learning/             local learning records and promotion review
│   └── updates/              signed update and rollback foundations
├── packages/
│   └── knights/              stable contract for every NORI Knight
│       ├── manifest.json     roster-wide role, model, tool, knowledge definitions
│       └── {neo..sentinel}/  one package contract per Knight
├── Assets/                   avatar and identity assets
├── Documentation/            product and technical documentation
├── References/               quarantined research/reference material; never runtime
└── Logs/                     test and verification evidence
```

## Knight package contract

Every `packages/knights/<id>/agent.manifest.json` carries exactly four product-facing declarations: the system role and boundaries, the allowed capability, its Seth model route, and its approved knowledge source. The executable implementation is then linked to the matching NORI-native worker under `shared/orchestration/`.

The Round Table runs each edition through one local service process: `shared/orchestration/knight_service.py`. It supplies a common audit stream and one local model service rather than launching twelve unrelated model copies. Home activates the full desktop-oriented set; Server and Robotics use constrained edition profiles.

## Dependency position

Seth is the NORI model runtime. An adapter for an external local engine may be enabled during development, but no OS is defined as requiring Ollama, CrewAI, Letta, or an upstream agent framework. Any retained upstream material must have an approved license record and remains a reference until replaced by NORI-native code.

## Deployment truth

These package contracts and native workers are source foundations. A Knight is operational in a released edition only after it is staged into that edition, provisioned after owner setup, started by the local service manager, and proven through the live Round Table health endpoint.
