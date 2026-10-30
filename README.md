# Paper Workbench

An Electron desktop workspace for academic manuscripts, powered by a locally installed Codex CLI. Each project keeps source-document versions, workflow results, and an inspectable audit trail.

## Workflows

- **Suggest reviewers:** research source-backed candidates using relevant publications and official profiles. Set a candidate count, author names/affiliations, exclusions, and an optional journal reviewer-policy URL. Record the fit rationale, publication links, and documented/unknown conflicts. Candidates always need author conflict confirmation; the app does not contact them or guess email addresses.

- **Submission preflight:** supply the journal author-instructions URL (or select imported guidelines). Check current official requirements against the manuscript and selected supporting files, with source-linked statuses, submission blockers, and explicit unknowns. Store a default instructions URL in project settings or override it per run. Formatting/metadata and original-file checks cannot be verified from extracted text.

- **Letter to reviewers / editor:** choose an editor cover letter, a point-by-point reviewer response, or a resubmission letter. Set the recipient and use manuscript/reviewer/revision sources; undocumented changes and declarations remain explicit author-confirmation placeholders.

- **Convert to Markdown:** faithfully convert the complete paper, retaining captions in the body, with blank Markdown tables and local figure placeholders. Export a ZIP with editable Markdown and generated SVG placeholder assets.
- **PowerPoint from paper:** create an editable summary-first deck, then examine missing/underreported evidence and overstated claims, with grounded speaker notes and a real `.pptx` export.

- **Select a journal:** research current official journal pages, compare scope and requirements, and draft a submission checklist with source links.
- **Craft an abstract:** draft from supplied findings, using journal requirements, structure, and a word limit.
- **Prepare a revision:** organize reviewer comments into an action plan, response matrix, response letter, and checklist.
- **Prepare a rewrite:** propose substantive text changes, record the rationale, and flag questions requiring author verification.

All nine support additional instructions, explicit source selection, model and reasoning-effort selection, streaming output, cancellation, and a separate record for each attempt. Review generated work before using it.

Use **Create workflow** on the workbench to add your own title, prompt, optional description, and dropdowns. Enter one dropdown per line, such as `Audience | Experts | General readers`; the first option is the default. The selected values are included in the run prompt. You can optionally enable live web research and edit your workflow later. Custom workflows live in the local library and are available to all projects on that computer; changes apply to future runs, while existing runs retain their exact prompt, selected values, and workflow revision. The project audit export contains the run records, but does not back up the editable custom workflow definitions; back up `custom-workflows.json` in the library separately.

## Workflow graph

Open **Workflow graph** in a project to add workflow steps and connect them. An **Order only** connection waits for the earlier step without including its output; a **Pass output** connection also supplies the earlier result as supporting text. Branches and multiple inputs are supported. Steps execute one at a time in dependency order, and independent steps follow their order in the editor. Cycles are rejected. The graph is saved with the project.

Choose the source documents, model and reasoning effort before running. Every step receives the selected document versions, plus outputs from its incoming Pass output connections. Steps use their workflow defaults and project settings; optional per-step instructions can be edited in the graph. A failure, interruption, empty required output, or cancellation stops the remaining steps. Each completed or partial run remains in history with its prompt, output, graph execution ID, and upstream run IDs. Automatic outputs are unreviewed and are passed as supporting material, not saved as new manuscript versions. Graphs run while the application is open and do not resume automatically after a restart.

## Run

Requires Linux x86_64, Windows x64, or macOS (Apple Silicon or Intel) and a recent [Codex CLI](https://learn.chatgpt.com/docs/app-server) on `PATH` (developed against 0.165.0), with access to a supported model. The CLI is not bundled. Install it with `npm install -g @openai/codex` if needed.

Download the AppImage from GitHub Releases, make it executable, and run it. Systems without FUSE can use `./Paper-Workbench-0.1.0-x86_64.AppImage --appimage-extract-and-run` (substitute the actual downloaded filename). The unpacked Linux tarball is another option; extract it and run `paper-workbench`.

On macOS, download the DMG for your processor (`arm64` for Apple Silicon, `x64` for Intel) and drag the app to Applications. The macOS builds are unsigned and not notarized, so macOS may block them; use Privacy & Security settings to allow an app you trust. Finder starts with a limited PATH; common Homebrew and ~/.local/bin locations are included. If Codex was installed elsewhere, launch the app executable from a terminal where `codex` works, for example `"/Applications/Paper Workbench.app/Contents/MacOS/Paper Workbench"`.

On Windows, download the x64 installer (`.exe`) or extract the Windows ZIP and run `Paper Workbench.exe`. The installer offers to open the Codex installation guide, and the app's Settings includes installation steps. Install Node.js and the Codex CLI separately, and check that `codex --version` works in a new terminal. Restart the app after installing Codex or changing PATH. The Windows builds are unsigned, so Windows SmartScreen may show a warning.

From source (Node.js 24+):

```sh
npm ci
npm start
```

In **Settings**, choose **Sign in with Codex**, open the verification link, and enter the device code. The Codex app server owns authentication, persistence, and refresh; account tokens never enter the renderer. Existing Codex sign-in is reused. Sign-out affects the CLI's managed account and may affect other local Codex clients.

Create a project, add a manuscript, optionally add reviewer comments, guidelines, or notes, then choose a workflow. Project settings hold the target journal and article type. Journal selection, submission preflight, and reviewer suggestions enable live web search; other workflows disable it. Executable tools are disabled by configuration, threads use a read-only sandbox, approval policy is `never`, and the client declines server-initiated approval/tool requests.

## Library backup and restore

In **Settings**, choose **Back up library** to create a ZIP containing all projects, extracted document text and versions, workflow graphs, custom workflows, runs and audit records. Backups include manuscript text; keep them somewhere private. They do not contain original imported DOCX/PDF files, Codex credentials or application settings. Save unfinished edits and finish any running workflow before backing up.

On another computer, install Paper Workbench and choose **Restore backup** in Settings. The app validates the archive and project audit chains before asking to replace the current library. Restore replaces the entire library rather than merging projects, and retains the previous library in a separate folder shown after restoring. Sign in to Codex separately on the new computer. Both backup and restore support libraries up to 512 MiB uncompressed and individual files up to 128 MiB.

## App updates

Installed Linux AppImage and Windows versions check GitHub Releases for updates at startup and every six hours. An available update is downloaded in the background; Settings offers **Restart and install update** after it is ready. Save unfinished edits first. The app refuses to install while a workflow or workflow graph is running. To use automatic updates, first install a version that includes this updater; older installations need a manual update. The unpacked Linux archive does not support automatic updates. Automatic updates are disabled on macOS until the app is code-signed; the current macOS releases are unsigned. Windows ZIP users should install the NSIS version to use the updater.

## Documents and results

Import DOCX, text-based PDF, Markdown, or plain text. DOCX tables are extracted as Markdown tables with their cell text and row order; the first row is represented as a Markdown header. Merged cells are marked with span information, but complex layouts, nested tables, and formatting may not transfer faithfully. Imports extract text, not layout, figures, tracked changes, or comments. Review extracted text against the original before running. Scanned PDFs need OCR outside this app. Source files are identified by SHA-256; extracted text and all saved text versions are retained in the project. Imports do not copy the original binary files.

Each save creates a version. Previous text can be restored as a new version. Sources are explicitly selected per workflow. Oversized context is rejected rather than silently truncated (600,000 characters per complete prompt).

Results can be exported as Markdown, plain text, DOCX, a Markdown ZIP with SVG figure placeholders, or editable PowerPoint. The slide exporter uses the workflow’s numbered slide headings, bullet points, and speaker-note sections, splitting long slides into continuation slides rather than dropping content. DOCX export converts standard Markdown tables to editable Word tables; complex formatting, merged cells, and list markers are not preserved. **Review & save** creates a separate editable supporting document, leaving the original run output unchanged. Use that document's role selector to turn a reviewed rewrite into a manuscript source for later runs. Outputs are proposals; the app never submits to journals or changes your original source files.

## Audit trail

Every project contains:

- `project.json`: project metadata and journal settings.
- `workflow-graph.json`: the project’s saved workflow graph.
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

The UI test launches Electron with isolated temporary project storage and a **fake Codex protocol process**, and covers device sign-in, import/versioning, all nine workflows, streaming, cancellation, rendering sanitization, draft adoption, and audit export. It does not spend model tokens. On a headless system use `xvfb-run -a npm run test:ui`. Test screenshots are written to ignored `test-artifacts/`.

The release workflow builds Linux AppImages, unsigned macOS DMG and ZIP files, and an unsigned Windows x64 installer and ZIP for version tags. Dependencies are pinned by `package-lock.json`. macOS builds are not notarized.

Test-only environment overrides: `PAPER_WORKBENCH_DATA`, `PAPER_WORKBENCH_CODEX`, and JSON-array `PAPER_WORKBENCH_CODEX_ARGS`.

An opt-in `npm run test:live` smoke test uses the signed-in Codex account and a synthetic manuscript; unlike the regular tests, it consumes model usage.
