# ⏱️ Temporary Artifacts & Scratch Policy

This directory (`docs/temp/`) is reserved for **transient, working, and ephemeral project assets**.

## Directory Taxonomy
1. **`execution-plans/`**:
   - Contains active implementation plans, migration checklists, and sprint roadmaps (e.g., [`EXEC_PLANS.md`](execution-plans/EXEC_PLANS.md)).
   - **Lifecycle:** Active during development. Once milestones are completed, key architectural decisions should be promoted to `docs/long-term/` and the temporary execution plan archived or pruned.
2. **`scratchpad/`**:
   - Temporary notes, draft markdown, curl snippets, or experimental logs.
   - **Lifecycle:** Completely ephemeral. Any developer may clear scratch files without prior approval.
3. **`reports/`**:
   - Benchmark dumps, profiler logs, and automated test execution summaries.
   - **Lifecycle:** Keep latest run; purge historical runs when disk space or clarity dictates.
