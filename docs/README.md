# 📚 Project NetworkNebula — Documentation & Artifacts Hub

Welcome to the centralized documentation and artifacts repository for **Project NetworkNebula**.
All technical specifications, formal engineering documents, architecture guides, and temporary working artifacts are organized here under two explicit lifecycles: **Long-Term (Permanent)** and **Temporary (Artifacts & Scratch)**.

---

## 🗂️ Documentation Structure Overview

```
docs/
├── README.md                            # You are here: Master Documentation Index
│
├── long-term/                           # 🏛️ PERMANENT SPECIFICATIONS & SYSTEM GUIDES
│   ├── architecture/                    # System topology, engineering internals & design
│   │   ├── ARCHITECTURE.md              # System Topology, Hardware Probing & Flowcharts
│   │   ├── SDD.md                       # System Design Document (Formal Software Engineering)
│   │   └── EDD.md                       # Engineering Design Document (Worker Engine & State Machine)
│   │
│   ├── specifications/                  # Formal requirements, scope & auditability
│   │   ├── SRS.md                       # Software Requirements Specification & Use Cases
│   │   ├── SOW.md                       # Scope of Work, Deliverables & Acceptance Criteria
│   │   └── TRACEABILITY.md              # Bidirectional Requirements Traceability Matrix
│   │
│   ├── api/                             # Developer contracts & protocols
│   │   └── API.md                       # REST Contracts, WebSockets & OpenAI-Compatible Gateway
│   │
│   ├── testing/                         # Formal verification & QA procedures
│   │   ├── STP.md                       # Software Test Plan (Strategy & Exit Criteria)
│   │   └── STD.md                       # Software Test Description (Formal Test Cases)
│   │
│   └── product/                         # Strategic direction & capabilities
│       ├── ROADMAP.md                   # Multi-Phase Delivery Roadmap
│       └── SKILLS.md                    # System Capabilities & Agent Hardware Probing
│
└── temp/                                # ⏱️ TEMPORARY ARTIFACTS & EPHEMERAL ASSETS
    ├── README.md                        # Lifecycle & Retention Policy
    ├── execution-plans/                 # Active sprint plans & implementation roadmaps
    │   └── EXEC_PLANS.md                # Task Dispatch & Multi-Worker Payout Hardening
    ├── scratchpad/                      # Local debugging notes, CLI dumps, throwaway scripts
    └── reports/                         # Benchmark logs, profiler traces & test run reports
```

---

## 🏛️ Long-Term Documentation (Permanent)

These documents represent the source of truth for the system architecture, formal software engineering requirements, and public developer contracts:

| Category | Document | Description |
| :--- | :--- | :--- |
| **Architecture** | [`ARCHITECTURE.md`](long-term/architecture/ARCHITECTURE.md) | High-level system architecture, distributed tensor flow, and hardware orchestration. |
| **Architecture** | [`SDD.md`](long-term/architecture/SDD.md) | System Design Document: component decomposition, database schema, and deployment models. |
| **Architecture** | [`EDD.md`](long-term/architecture/EDD.md) | Engineering Design Document: worker engine internals, heartbeat protocols, and state machines. |
| **Specifications** | [`SRS.md`](long-term/specifications/SRS.md) | Software Requirements Specification: functional and non-functional requirements. |
| **Specifications** | [`SOW.md`](long-term/specifications/SOW.md) | Scope of Work: contractual objectives, milestones, and deliverable criteria. |
| **Specifications** | [`TRACEABILITY.md`](long-term/specifications/TRACEABILITY.md) | Bidirectional matrix tracing SOW &rarr; SRS &rarr; SDD &rarr; EDD &rarr; STD. |
| **API** | [`API.md`](long-term/api/API.md) | Complete API reference, error envelopes, and OpenAI drop-in endpoint specifications. |
| **Testing** | [`STP.md`](long-term/testing/STP.md) | Software Test Plan: testing strategy, levels, and entry/exit criteria. |
| **Testing** | [`STD.md`](long-term/testing/STD.md) | Software Test Description: concrete test cases and automated procedures. |
| **Product** | [`ROADMAP.md`](long-term/product/ROADMAP.md) | Architectural and product delivery roadmap across project phases. |
| **Product** | [`SKILLS.md`](long-term/product/SKILLS.md) | Autonomous agent skills, hardware probing, and Ring All-Reduce capabilities. |

---

## ⏱️ Temporary Artifacts & Scratch (Ephemeral)

Working artifacts used during active sprints, debugging, and benchmarking:

| Directory | Purpose | Retention Guideline |
| :--- | :--- | :--- |
| [`temp/execution-plans/`](temp/execution-plans/) | Sprint checklists, rollout plans, and active RFCs (e.g. [`EXEC_PLANS.md`](temp/execution-plans/EXEC_PLANS.md)). | Keep until the corresponding feature/sprint is completed and merged into main specs. |
| [`temp/scratchpad/`](temp/scratchpad/) | Throwaway scripts, curl snippets, temporary debug dumps. | Ephemeral; safe to clear periodically. |
| [`temp/reports/`](temp/reports/) | Benchmark outputs, test execution summaries, profiler traces. | Retain latest benchmark runs; archive older runs as needed. |

See [`temp/README.md`](temp/README.md) for full retention policies.
