# Paper Workbench

An Electron desktop workspace for academic manuscripts, powered by a locally installed Codex CLI. Each project keeps source-document versions, workflow results, and an inspectable audit trail.

## Workflows

- **Letter to reviewers / editor:** choose an editor cover letter, a point-by-point reviewer response, or a resubmission letter. Set the recipient and use manuscript/reviewer/revision sources; undocumented changes and declarations remain explicit author-confirmation placeholders.

- **Convert to Markdown:** faithfully convert the complete paper, retaining captions in the body, with blank Markdown tables and local figure placeholders. Export a ZIP with editable Markdown and generated SVG placeholder assets.
- **PowerPoint from paper:** create an editable summary-first deck, then examine missing/underreported evidence and overstated claims, with grounded speaker notes and a real `.pptx` export.

- **Select a journal:** research current official journal pages, compare scope and requirements, and draft a submission checklist with source links.
- **Craft an abstract:** draft from supplied findings, using journal requirements, structure, and a word limit.
- **Prepare a revision:** organize reviewer comments into an action plan, response matrix, response letter, and checklist.
- **Prepare a rewrite:** propose substantive text changes, record the rationale, and flag questions requiring author verification.

All seven support additional instructions, explicit source selection, model and reasoning-effort selection, streaming output, cancellation, and a separate record for each attempt. Review generated work before using it.

## Run

Requires Linux x86_64 and a recent [Codex CLI](https://learn.chatgpt.com/docs/app-server) on `PATH` (developed against 0.165.0), with access to a supported model. The CLI is not bundled. Install it with `npm install -g @openai/codex` if needed.

Download the AppImage from GitHub Releases, make it executable, and run it. Systems without FUSE can use `./Paper-Workbench-0.1.0-x86_64.AppImage --appimage-extract-and-run` (substitute the actual downloaded filename). The unpacked Linux tarball is another option; extract it and run `paper-workbench`.

From source (Node.js 24+):

```sh
npm ci
npm start
```

In **Settings**, choose **Sign in with Codex**, open the verification link, and enter the device code. The Codex app server owns authentication, persistence, and refresh; account tokens never enter the renderer. Existing Codex sign-in is reused. Sign-out affects the CLI's managed account and may affect other local Codex clients.

Create a project, add a manuscript, optionally add reviewer comments, guidelines, or notes, then choose a workflow. Project settings hold the target journal and article type. Journal selection enables live web search; other workflows disable it. Executable tools are disabled by configuration, threads use a read-only sandbox, approval policy is `never`, and the client declines server-initiated approval/tool requests.

## Documents and results

Import DOCX, text-based PDF, Markdown, or plain text. Imports extract text, not layout, figures, tracked changes, or comments. Review extracted text before running. Scanned PDFs need OCR outside this app. Source files are identified by SHA-256; extracted text and all saved text versions are retained in the project. Imports do not copy the original binary files.

Each save creates a version. Previous text can be restored as a new version. Sources are explicitly selected per workflow. Oversized context is rejected rather than silently truncated (600,000 characters per complete prompt).

Results can be exported as Markdown, plain text, DOCX, a Markdown ZIP with SVG figure placeholders, or editable PowerPoint. The slide exporter uses the workflow’s numbered slide headings, bullet points, and speaker-note sections, splitting long slides into continuation slides rather than dropping content. DOCX export preserves text and headings; complex Markdown tables and list markers remain text. **Review & save** creates a separate editable supporting document, leaving the original run output unchanged. Use that document's role selector to turn a reviewed rewrite into a manuscript source for later runs. Outputs are proposals; the app never submits to journals or changes your original source files.

## Audit trail

Every project contains:

- `project.json`: project metadata and journal settings.
- `documents/` and `versions/`: current text and immutable version snapshots.
- `runs/`: exact prompt, source IDs/versions/hashes, workflow version, selected and resolved model, reasoning effort, run status and times, Codex thread/turn IDs, usage where emitted, output, and errors.
- `run-events/`: observable Codex protocol activity, including text deltas and tool/search events. Internal reasoning streams and duplicate legacy notifications are omitted. These are observable activity records, not a claim to expose model-internal reasoning or every remote operation.
- `audit.jsonl`: append-only project events linked using SHA-256, including document changes, run requests/completions, reviewed drafts, and exports.

The audit screen verifies the hash chain. A local chain is not an externally signed, tamper-proof ledger: someone with write access can rewrite the whole chain or remove its end. Back up exported archives separately if stronger preservation is needed. Failed, cancelled, and interrupted attempts remain in history; unfinished runs are recovered as interrupted on next start. Partial output is checkpointed once a second.

**Export audit archive** includes the full project, every text version, all runs, exact prompts and outputs, observable events, and audit-chain verification. Archives contain manuscript text and potentially sensitive project material. Source text selected for a run is transmitted to Codex; journal search also transmits search queries. The app has no separate analytics or hosting backend.

By default the library lives in Electron's user-data folder, under `library/` (normally `~/.config/Paper Workbench/library` on Linux). Settings shows the exact location.

## Development and release

```sh
npm run check
npm test
npm run test:ui
npm run package -- --publish never
```

The UI test launches Electron with isolated temporary project storage and a **fake Codex protocol process**, and covers device sign-in, import/versioning, all seven workflows, streaming, cancellation, rendering sanitization, draft adoption, and audit export. It does not spend model tokens. On a headless system use `xvfb-run -a npm run test:ui`. Test screenshots are written to ignored `test-artifacts/`.

The release workflow builds Linux AppImages for version tags. Dependencies are pinned by `package-lock.json`. AppImages are unsigned. macOS and Windows distributions are not built in this release.

Test-only environment overrides: `PAPER_WORKBENCH_DATA`, `PAPER_WORKBENCH_CODEX`, and JSON-array `PAPER_WORKBENCH_CODEX_ARGS`.

An opt-in `npm run test:live` smoke test uses the signed-in Codex account and a synthetic manuscript; unlike the regular tests, it consumes model usage.
