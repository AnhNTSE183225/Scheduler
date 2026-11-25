# Scheduler — Agent Engineering Constitution

This project strictly adheres to `c:\GIT\TECHSTACK\VIBE_CODING_RULES.md`:
- **Backend:** Rust (`Axum` + `Tokio` + `SQLx` SQLite WAL + `Mimalloc`), cascading YAML config (`config/default.yaml` + `config/prod.yaml`), release profile (`opt-level = 3`, `lto = "fat"`), structured JSON tracing into VictoriaLogs.
- **Frontend:** SolidJS + Vite + Tailwind CSS v4 + PWA (Service Worker + Web Push) + WAAPI animations. Never destructure component props.
- **Architecture:** Strict SOLID 4-layer separation (Transport/View -> Services/Stores -> Models -> Repositories/API) and End-to-End Deterministic FSM (`status` discriminant, zero scattered boolean flags).
- **Lifecycle:** Use root `build.ps1` / `start.ps1` / `stop.ps1` for full-stack Windows execution (frontend + backend + VictoriaLogs), and standalone `backend/{build,start,stop}.{ps1,sh}` for backend-only Windows/Linux execution. Always run `.\build.ps1` after code edits and `.\stop.ps1` after verification audits.
- **Code Hygiene:** Zero compiler or typecheck warnings allowed in project crates (`cargo test`, `cargo build --release`, and `tsc --noEmit` must all build cleanly without warnings).
