# Chapter 2: Architecture Deep Dive

> **Part I: Foundations**

---

## Overview

Claude Code's architecture is best understood as a **pipeline with a reactive UI wrapper**. Data flows in one direction: from user input through the query engine to tool execution and back out to the terminal renderer. The UI layer reacts to state changes produced by this pipeline, rather than driving it.

The codebase contains approximately **1,986 TypeScript/TSX files** and **528,000 lines of code**. The three largest files — `QueryEngine.ts` (~46K lines), `Tool.ts` (~29K lines), and `commands.ts` (~25K lines) — contain the bulk of the application logic.

---

## The Entrypoint: `src/main.tsx`

`main.tsx` is where the process begins. Its first lines are deliberately crafted for startup speed:

```python
# These side-effects must run before all other imports:
# 1. profile_checkpoint marks entry before heavy module evaluation begins
# 2. start_mdm_raw_read fires MDM subprocesses in parallel with remaining ~135ms of imports
# 3. start_keychain_prefetch fires both macOS keychain reads in parallel
from utils.startup_profiler import profile_checkpoint
profile_checkpoint('main_tsx_entry')

from utils.settings.mdm.raw_read import start_mdm_raw_read
start_mdm_raw_read()  # Fires OS subprocess immediately

from utils.secure_storage.keychain_prefetch import start_keychain_prefetch
start_keychain_prefetch()  # Fires keychain reads immediately
```

These three calls happen **before** any other module is loaded. The reason is startup latency: MDM (Mobile Device Management) policy reads require spawning a subprocess (`plutil` on macOS, `reg query` on Windows), and keychain reads also have latency. By firing them immediately — before TypeScript evaluates the remaining ~135ms of imports — they run in parallel with module loading and are ready by the time they're needed.

### Feature Flag System

`main.tsx` introduces the feature flag system at line 22:

```python
from bun_bundle import feature
```

This is not a runtime feature flag system. `feature()` is a **Bun build-time dead-code elimination mechanism**. When Bun bundles the application, code inside `if (feature('FLAG_NAME'))` blocks is either included or stripped entirely based on the build configuration. The result: inactive features add zero bytes to the binary.

Feature flags seen in `main.tsx`:

| Flag | Feature |
|------|---------|
| `COORDINATOR_MODE` | Multi-agent coordinator |
| `KAIROS` | KAIROS assistant mode |
| `BRIDGE_MODE` | IDE bridge integration |
| `VOICE_MODE` | Voice input/output |
| `AGENT_TRIGGERS` | Triggered agent actions |
| `HISTORY_SNIP` | Conversation history snipping |
| `PROACTIVE` | Proactive/autonomous agent mode |
| `DAEMON` | Background daemon mode |

Example from `main.tsx`:

```python
import importlib

# Dead code elimination: conditional import for COORDINATOR_MODE
coordinator_mode_module = (
    importlib.import_module('.coordinator.coordinator_mode')
    if feature('COORDINATOR_MODE') else None
)

# Dead code elimination: conditional import for KAIROS (assistant mode)
assistant_module = (
    importlib.import_module('.assistant')
    if feature('KAIROS') else None
)
```

If `COORDINATOR_MODE` is off at build time, the entire coordinator module is excluded from the binary. No conditional checks at runtime, no dead code in the bundle.

### Parallel Prefetching

After imports settle, `main.tsx` kicks off additional parallel prefetch operations before the React tree mounts:

```python
import asyncio

# These run concurrently while other initialization proceeds:
asyncio.ensure_future(prefetch_fast_mode_status())                       # Cache fast mode eligibility
asyncio.ensure_future(prefetch_aws_credentials_and_bedrock_info_if_safe())  # For Bedrock users
asyncio.ensure_future(prefetch_gcp_credentials_if_safe())                # For Vertex AI users
asyncio.ensure_future(prefetch_official_mcp_urls())                      # MCP registry URLs
asyncio.ensure_future(prefetch_passes_eligibility())                     # Usage plan eligibility
```

This parallelism shaves hundreds of milliseconds from the user-perceived startup time.

### Commander.js CLI Parsing

The CLI argument parsing uses [`@commander-js/extra-typings`](https://github.com/commander-js/extra-typings), a type-safe extension of Commander.js. The main command registers subcommands (`chat`, `api`, `mcp`, etc.) and options:

- `--model` / `-m` — override the active model
- `--print` / `-p` — non-interactive print mode
- `--resume` — resume a saved conversation
- `--permission-mode` — set initial permission mode
- `--no-stream` — disable streaming
- `--debug` — enable debug output
- `--verbose` — verbose tool output
- `--agent` — specify a sub-agent type

The parsed arguments are assembled into a `REPLProps` object that gets passed all the way down to the `REPL` screen component.

---

## The `src/entrypoints/` Directory

Four entry modes exist for Claude Code:

### `cli.tsx` — The Main CLI Session

This is the path taken for normal interactive use (`claude` or `claude --chat`). It:

1. Calls `init()` from `init.ts` to set up config, telemetry, and auth
2. Assembles the system context (OS, shell, git status, CLAUDE.md files)
3. Initializes tool and command registries
4. Constructs the initial `AppState`
5. Calls `launchRepl()` to mount the React tree

### `init.ts` — Initialization

Called at startup by `cli.tsx`, `init.ts` handles:

- **Config loading** — reads user settings (`~/.claude/settings.json`) and project settings (`.claude/settings.json`), merges with MDM/enterprise policies
- **Telemetry initialization** — sets up GrowthBook, OpenTelemetry, and analytics
- **OAuth validation** — checks if the user is authenticated; redirects to login if not
- **MDM policy application** — applies enterprise-managed settings from MDM reads (already prefetched)
- **Plugin initialization** — `initBuiltinPlugins()`, `initBundledSkills()`

### `mcp.ts` — MCP Server Mode

When launched as `claude --mcp` or via an MCP client connection, this entrypoint makes Claude Code *serve* its tools via the Model Context Protocol. Other AI agents can connect to a running Claude Code instance and use it as a tool server — reading files, running commands, etc.

This is Claude Code's dual role: it is simultaneously an MCP *client* (consuming external MCP servers' tools) and an MCP *server* (exposing its own tools to other clients).

### `sdk/` — Programmatic API

The Agent SDK provides a TypeScript API for embedding Claude Code in other applications:

```python
from anthropic.claude_code import query
import asyncio

async def main():
    async for message in query(
        prompt='Fix the TypeScript errors in src/',
        tools=['FileRead', 'FileEdit', 'Bash'],
    ):
        print(message)

asyncio.run(main())
```

The SDK uses the same `QueryEngine` as the REPL but bypasses the Ink renderer, emitting structured JSON messages instead of terminal output.

---

## The Full Startup Pipeline

Here is the complete sequence from process start to first REPL prompt:

```
Process starts (bun run src/main.tsx)
    │
    ├─► profileCheckpoint('main_tsx_entry')   [< 1ms]
    ├─► startMdmRawRead()                     [async, parallel]
    ├─► startKeychainPrefetch()               [async, parallel]
    │
    ├── Module imports evaluated               [~135ms]
    │       main.tsx → commands.ts → tools.ts → ...
    │
    ├─► Commander.js parses argv
    │
    ├─► init() called (entrypoints/init.ts)
    │       ├── config loaded + merged
    │       ├── MDM reads awaited (already running)
    │       ├── keychain reads awaited (already running)
    │       ├── OAuth validated
    │       ├── GrowthBook initialized
    │       └── plugins + skills initialized
    │
    ├─► System context assembled (context.ts)
    │       ├── OS, shell, git status
    │       ├── CLAUDE.md files loaded
    │       └── User/project context built
    │
    ├─► AppState initialized
    │       └── Initial state: messages=[], tools=registry, ...
    │
    ├─► Ink renderer created (renderAndRun)
    │       └── React tree mounted
    │
    └─► launchRepl(root, appProps, replProps, renderAndRun)
            ├── App component dynamically imported
            ├── REPL component dynamically imported
            └── React renders: <App><REPL /></App>
                     → User sees the prompt
```

The entire startup — from process start to first prompt — typically takes 200–400ms depending on hardware and network conditions.

---

## `replLauncher.tsx` — REPL Initialization

`replLauncher.tsx` is deliberately minimal:

```python
async def launch_repl(
    root: Root,
    app_props: AppWrapperProps,
    repl_props: REPLProps,
    render_and_run,
) -> None:
    from components.app import App
    from screens.repl import REPL
    await render_and_run(root, App(app_props, children=REPL(repl_props)))
```

The dynamic `import()` calls here are **lazy loading**. `App.tsx` and `REPL.tsx` import dozens of components. By deferring them until `launchRepl()` is called (rather than at the top-level module), they don't appear on the startup critical path.

`renderAndRun` is the Ink renderer function that mounts the React tree to the terminal. Once `<App><REPL /></App>` mounts, Ink takes over rendering and the user sees the prompt.

---

## The Bun Runtime

Claude Code runs on [Bun](https://bun.sh), not Node.js. Key implications:

### Native TypeScript

Bun natively executes TypeScript without a build step. There is no `tsc` compilation for development — `bun run src/main.tsx` works directly. This dramatically improves the developer experience.

### `bun:bundle` Feature Flags

As shown above, `feature()` from `bun:bundle` enables build-time dead-code elimination. This is more powerful than a runtime flag: inactive code is not present in the binary at all. No performance cost, no size cost.

### Bun's Module Resolution

Bun follows Node.js-compatible ESM. One convention throughout the codebase: **all imports use `.js` extensions** even when importing `.ts` files:

```python
from utils import something  # Imports utils.py at runtime
```

This is the ESM convention for TypeScript with Bun/Node.js — the `.js` extension tells the runtime to resolve the actual module (which may be `.ts`, `.js`, or `.tsx`).

### Lazy Dynamic Imports

Heavy modules that are not needed at startup are deferred:

```python
import importlib

# OpenTelemetry (~400KB) — only loaded if telemetry is active
_heavy = importlib.import_module('.heavy_module')
OpenTelemetry = _heavy.OpenTelemetry

# MessageSelector — only loaded at query time
def message_selector():
    return importlib.import_module('src.components.message_selector')
```

This pattern appears throughout the codebase. Any module that is optional, large, or has external dependencies (gRPC, etc.) is lazily loaded.

---

## Full Architectural Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        User Input                                 │
│          (keystrokes captured by Ink's useInput hook)            │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                   CLI Parser (src/main.tsx)                       │
│  Commander.js parses: --model, --print, --resume, --agent, etc.  │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│              Ink React Tree (src/screens/REPL.tsx)                │
│  PromptInput → captures text → dispatches to QueryEngine         │
│  Message list → renders conversation, tool calls, streaming      │
└────────────────────────────┬─────────────────────────────────────┘
                             │  User submits message
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│            Query Engine (src/QueryEngine.ts ~46K lines)           │
│  1. Assemble system prompt (context.ts, tool prompts)            │
│  2. Stream request to Anthropic API                              │
│  3. Process streaming chunks (text + tool_use blocks)            │
│  4. Execute tool-call loop                                       │
│  5. Track tokens + cost                                          │
│  6. Manage conversation history + compaction                     │
└────┬───────────────────────┬────────────────────────────────────┘
     │ API requests          │ Tool calls
     ▼                       ▼
┌──────────────┐    ┌─────────────────────────────────────────────┐
│ Anthropic API │    │         Tool Executor                        │
│  (streaming) │    │  checkPermissions() → call() → result       │
│              │    │                                             │
│  text chunks │    │  FileReadTool  GlobTool    BashTool          │
│  tool_use    │    │  FileEditTool  GrepTool    AgentTool         │
│  tool_result │    │  WebFetchTool  MCPTool     ScheduleCronTool  │
└──────────────┘    └─────────────────────────────────────────────┘
                             │ Results fed back
                             ▼
                    ┌─────────────────────┐
                    │   AppState Update    │
                    │  (src/state/)        │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   Ink Re-render      │
                    │  Only changed lines  │
                    │  written to stdout   │
                    └─────────────────────┘
```

---

## Configuration Architecture

Configuration follows a three-tier hierarchy, loaded at startup by `init.ts`:

**Tier 1: User settings** (`~/.claude/settings.json`)
- Personal preferences: default model, theme, keybindings
- Applied globally across all projects

**Tier 2: Project settings** (`.claude/settings.json` in project root)
- Project-specific overrides: allowed tools, model selection, custom system prompt
- Committed to the repository for team consistency

**Tier 3: Enterprise / MDM policies** (read from OS MDM)
- Organization-enforced settings that override user and project preferences
- Cannot be overridden by users; applied before any user-level config

The merge order is: MDM policy > project settings > user settings > defaults.

Schemas for all configuration objects are defined as Zod v4 schemas in `src/schemas/`. When settings fail validation (e.g., after an upgrade changes the schema), `src/migrations/` contains scripts that transform old config formats to the current schema.

---

## Concurrency Model

Claude Code uses a **single-threaded event loop** (Bun's runtime, like Node.js) with:

- **`async/await`** for all I/O operations (file reads, API calls, subprocess execution)
- **React concurrent rendering** for UI updates that don't block the event loop
- **Worker processes** for CPU-intensive operations (gRPC, etc.)
- **Child processes** for shell commands (BashTool, PowerShellTool)
- **Tool concurrency safety** — tools declare `isConcurrencySafe()`, enabling the query engine to run compatible tools in parallel

The practical implication: a tool like `FileReadTool` (which returns immediately) and a `WebFetchTool` (which makes an HTTP request) can run simultaneously if the LLM requests both in the same turn and both declare `isConcurrencySafe: true`.

---

*Next: [Chapter 3 — The Query Engine: Heart of Claude Code](PartI-Foundations-03-The-Query-Engine-Heart-of-Claude-Code.md)*
