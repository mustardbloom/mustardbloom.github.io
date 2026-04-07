---
layout: default
title: "Harness Engineering of Coding Agents: Behind Claude Code"
author: "Sylvia"
date: "2026"
---

\newpage

# Author's Note

This book grew out of curiosity. I wanted to understand how Claude Code actually works — not at the surface level of "it reads files and runs commands," but at the level of how decisions are made, how tools are designed, how state flows through the system, and how the pieces fit together into something that feels coherent.

What you'll find here is a practical, honest account of Claude Code's internals: its query engine, tool system, permission model, MCP integration, UI layer, and the services and subsystems that hold everything together. The code examples throughout have been written in Python to keep things readable and accessible, even though the real implementation is in TypeScript. The goal was always clarity over completeness.

This is not official documentation and I make no claim to have captured every detail perfectly. It is an attempt to build a useful mental model — one that I hope makes you a more effective user and collaborator with Claude Code.

— Sylvia, 2026

\newpage

# Table of Contents

## Part I: Foundations

- Chapter 1: Introduction & Philosophy
- Chapter 2: Architecture Deep Dive
- Chapter 3: The Query Engine — Heart of Claude Code

## Part II: The Tool System

- Chapter 4: Tool Architecture
- Chapter 5: File System Tools — Deep Dive
- Chapter 6: Shell & Execution Tools — Deep Dive
- Chapter 7: Agent & Orchestration Tools — Deep Dive
- Chapter 8: Web, MCP, and Integration Tools — Deep Dive

## Part III: The Command System

- Chapter 9: Command Architecture & Complete Command Reference

## Part IV: The UI Layer

- Chapter 10: Ink — React for the Terminal
- Chapter 11: Components & Screens

## Part V: Subsystems

- Chapter 12: The Permission System
- Chapter 13: MCP (Model Context Protocol) Integration
- Chapter 14: The Bridge — IDE Integration
- Chapter 15: Memory, Skills, Plugins & Tasks
- Chapter 16: The Coordinator — Multi-Agent Orchestration

## Part VI: Services & Infrastructure

- Chapter 17: The Service Layer
- Chapter 18: State Management
- Chapter 19: Configuration & Schemas
- Chapter 20: Utilities Deep Dive

\newpage

# Part I: Foundations

# Chapter 1: Introduction & Philosophy

> **Part I: Foundations**

---

## What Is Claude Code?

Claude Code is a terminal-native AI coding assistant built by Anthropic. Unlike browser-based or IDE-embedded tools, it runs directly in your terminal as a single binary CLI application — and it is architecturally far more than a thin wrapper around an LLM API.

At its core, Claude Code is a **full React application rendered to the terminal**. It uses a custom fork of [Ink](https://github.com/vadimdemedes/ink) (React for the terminal) to power a fully reactive UI with components, hooks, and state management — all outputting to stdout. This is not an ncurses application or a simple print loop. It is React.

But the UI is just the surface. Claude Code's real innovation is its **agentic architecture**: an autonomous agent loop that can read and write files, execute shell commands, search the web, invoke Language Server Protocol diagnostics, spawn sub-agents, call external MCP servers, and orchestrate multi-agent teams — all driven by an LLM that decides what to do next.

When you type a message, it does not simply send your text to an API and print the response. It enters a **tool-call loop**:

1. Your message is sent to the Anthropic Claude API
2. Claude may respond with text, or with a request to use a tool (e.g., "read this file", "run this command")
3. Claude Code executes the tool
4. The result is fed back to Claude
5. Claude may call more tools, or produce a final response
6. Steps 2–5 repeat until Claude is done

This loop is the heartbeat of the system. Everything else — the UI, the permission system, the MCP integration, the command system — exists to support it.

---

## Design Philosophy

### Terminal-Native

The decision to build a terminal-native tool was deliberate. Developers already live in the terminal. Git, compilers, test runners, build systems, package managers, SSH sessions, Docker — all terminal. An AI assistant that speaks the same language, in the same environment, with the same files and processes directly accessible, is far more useful than one that requires copying code between windows.

Terminal-native also means **no installation beyond a single binary**. No browser extension, no IDE plugin required (though both exist as optionals). Claude Code can run on a remote server over SSH, in a Docker container, in a CI pipeline. It goes where you go.

### React-Based CLI

Using React to build a CLI is unusual but powerful. It brings:

- **Declarative UI** — the terminal output is a function of application state, not imperative print calls
- **Component reuse** — the `StructuredDiff` component that shows file edits is reused everywhere diffs appear
- **Hooks for side effects** — keyboard input, MCP connection status, permission prompts all use React hooks
- **Concurrent rendering** — React's concurrent mode enables smooth streaming text display without blocking the input loop
- **React Compiler** — the codebase uses React Compiler (the new auto-memoization compiler) for optimized re-renders

The Ink renderer translates the React virtual DOM into terminal escape codes, computing only the diff between the current and previous screen state before writing to stdout.

### Agent-Loop Architecture

The agent loop is the defining architectural choice. Instead of a one-shot "send prompt, get response" model, Claude Code maintains a **conversation with tools**. The LLM is an active participant that decides what information it needs, fetches it via tools, and iterates until it has a complete answer.

This means Claude Code can:
- Read a file, notice a bug, search for related code, fix it, run the tests, and report — all in one turn
- Spawn a sub-agent to handle a parallel subtask while continuing the main task
- Ask for permission before a dangerous operation, then proceed when granted
- Maintain context across hundreds of tool calls within a single conversation

### Tool-First Design

Claude Code can only affect the external world through **tools**. Every file read, every shell command, every web search — all mediated by a tool with a defined schema, permission model, and result type. The LLM cannot directly write to disk or execute arbitrary code; it must go through the tool system.

This design enables:
- **Permission gating** — before any tool runs, `checkPermissions()` is called
- **Auditability** — every tool call is visible in the terminal
- **Extensibility** — new capabilities are new tools; they plug into the existing loop
- **Safety** — the blast radius of any LLM error is bounded by what the tools allow

---

## How It Compares to Other Tools

### GitHub Copilot

Copilot is primarily an **inline autocomplete** tool. It predicts the next line or block as you type, within your IDE. It has no file system access, no shell access, no conversation. It answers the question "what comes next in this file?"

Claude Code answers a different question: "accomplish this goal." It can refactor an entire codebase, migrate a database schema, fix a failing test suite, write and run code, and iterate until the task is done.

| Dimension | Copilot | Claude Code |
|-----------|---------|-------------|
| Interaction model | Inline autocomplete | Conversational agent loop |
| File access | None (IDE reads it) | Full read/write |
| Shell access | None | Full bash/shell |
| Context | Current file only | Entire codebase |
| Autonomy | Zero | High (tool loop) |

### Cursor

Cursor is an IDE fork (based on VS Code) with Claude/GPT deeply embedded in the editing experience. It offers inline chat, code generation, and multi-file edits within the IDE's GUI.

Claude Code is **terminal-native and GUI-free** by default. This matters for:
- Remote servers (no GUI available)
- CI/CD pipelines
- Developers who prefer terminal over IDE
- Situations requiring full shell power

Cursor's AI features are IDE-dependent; Claude Code's are environment-independent. Claude Code also has an IDE bridge that connects to VS Code and JetBrains for those who want GUI features.

| Dimension | Cursor | Claude Code |
|-----------|--------|-------------|
| Environment | VS Code GUI | Terminal (+ optional IDE bridge) |
| Shell access | Limited | Full |
| Multi-agent | No | Yes (coordinator mode) |
| MCP integration | Limited | Deep (client + server) |
| Runs on remote server | No | Yes |

### Aider

Aider is the closest spiritual ancestor — also terminal-based, also conversational, also capable of multi-file edits. The key differences:

- **Architecture**: Aider is a Python application without the React/Ink UI layer; Claude Code is TypeScript with a React terminal UI
- **Tool model**: Aider uses a patch-based approach for file edits; Claude Code uses a generalized tool system with ~40 distinct tools
- **Extensibility**: Claude Code's MCP integration, plugin system, and skill system offer more extensibility
- **Multi-agent**: Claude Code has coordinator mode, sub-agents, and team management; Aider is single-agent

### ChatGPT Code Interpreter / Claude.ai

These are browser-based, sandboxed environments. Code runs in an isolated container with no access to your actual file system, your real git repositories, or your local services. They are useful for isolated computation but cannot interact with a real project.

Claude Code operates on **your actual file system**, in **your actual shell**, with access to all your local tools, services, and environment. The tradeoff is that it requires explicit permission management (the permission system exists precisely because the stakes are real).

---

## The Mental Model

Before diving into code, internalize this pipeline:

```
┌─────────────────────────────────────────────────────────────┐
│                    User Types a Message                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│          CLI Parser (Commander.js in src/main.tsx)           │
│  • Parses flags: --model, --permission-mode, --print, etc.  │
│  • Routes to REPL mode, print mode, init mode, MCP mode     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│             REPL (src/screens/REPL.tsx via Ink)              │
│  • Captures keystroke input via useInput()                  │
│  • Maintains conversation message list in React state       │
│  • Renders messages, tool calls, streaming text             │
└──────────────────────────┬──────────────────────────────────┘
                           │  User submits message
                           ▼
┌─────────────────────────────────────────────────────────────┐
│            Query Engine (src/QueryEngine.ts ~46K lines)      │
│  • Assembles system prompt + conversation history           │
│  • Sends to Anthropic API (streaming)                       │
│  • Receives streaming chunks: text tokens + tool_use blocks │
└──────────────────────────┬──────────────────────────────────┘
                           │  LLM requests a tool
                           ▼
┌─────────────────────────────────────────────────────────────┐
│          Tool Execution Loop (inside QueryEngine)            │
│  1. Look up tool by name in registry                        │
│  2. Validate input against Zod schema                       │
│  3. Call checkPermissions() — may prompt user               │
│  4. Execute tool.call() — actual implementation             │
│  5. Format result as tool_result message                    │
│  6. Append to conversation, send back to API                │
│  7. Repeat until LLM sends no more tool_use blocks          │
└──────────────────────────┬──────────────────────────────────┘
                           │  Final text response
                           ▼
┌─────────────────────────────────────────────────────────────┐
│         Ink Renderer (src/ink/ custom React renderer)        │
│  • React virtual DOM diff → terminal escape codes           │
│  • Only changed lines rewritten to stdout                   │
│  • Colors via Chalk, layout via Yoga flexbox                │
└─────────────────────────────────────────────────────────────┘
```

Every interaction follows this path. The complexity of any feature — multi-agent orchestration, MCP integration, plan mode, voice input — lives within specific nodes of this pipeline, not outside it.

---

## Key Concepts Glossary

**Agent / sub-agent** — Claude Code is itself an "agent" (an LLM-driven entity that uses tools to accomplish goals). A *sub-agent* is a child agent spawned via `AgentTool`, with its own isolated context and tool loop, running in parallel or sequence.

**Tool** — A discrete capability the LLM can invoke: `FileReadTool`, `BashTool`, `WebFetchTool`, etc. Each tool has an input schema, permission model, and implementation. Tools are how Claude Code interacts with the world; the LLM cannot take action without them.

**Command** — A user-facing slash command (`/commit`, `/model`, `/mcp`) typed into the REPL. Commands can generate LLM prompts, run local logic, or render UI. They are invoked by the *user*, not the LLM.

**REPL** — The interactive Read-Eval-Print Loop that is the main Claude Code interface. It captures user input, displays messages, and streams responses.

**Turn** — One complete cycle of user input → LLM response (including all tool calls within that response). A turn may involve dozens of tool calls before producing a final text response.

**Context window** — The maximum number of tokens that can be in a single API request (conversation history + system prompt + tool definitions). When the context window approaches its limit, *compaction* is triggered.

**Compaction** — The process of summarizing the conversation history to free up context window space. The oldest messages are replaced with an AI-generated summary, preserving the essential facts while reducing token count.

**MCP (Model Context Protocol)** — A standard protocol for connecting LLMs to external tool servers. Claude Code can both *consume* tools from MCP servers and *expose* its own tools as an MCP server.

**Permission mode** — Controls how strictly Claude Code checks before executing potentially dangerous operations. Modes: `default` (ask for each dangerous operation), `plan` (read-only planning phase), `bypassPermissions` (auto-approve everything), `auto` (ML-based classifier).

**Skill** — A named, reusable workflow bundled as a prompt + tool configuration. Invoked via `SkillTool` or by name in the REPL. Claude Code ships with 16 bundled skills.

**Plugin** — An installable extension that can contribute new tools, commands, and behaviors. Different from skills (which are prompts); plugins are code.

**Bridge** — The subsystem connecting the Claude Code CLI to IDE extensions (VS Code, JetBrains). The IDE renders the UI; the CLI handles the LLM and tools.

**Coordinator** — The multi-agent orchestration subsystem. The coordinator agent divides work among a team of worker agents and synthesizes their results.

**Feature flag** — Runtime flags controlled by `feature('FLAG_NAME')` from `bun:bundle`. Inactive flags are stripped entirely at build time (dead-code elimination). Used for gradual rollouts and Anthropic-internal features.

---

## Who Built This and Why

Claude Code was built by Anthropic to give developers a genuinely autonomous coding partner — not an autocomplete engine, but an agent that can plan, execute, iterate, and deliver. The decision to build it as a terminal application reflects a belief that the terminal is the natural home of serious software development: it is scriptable, composable, SSH-capable, and environment-independent.

The source code you are reading in this book is the complete implementation of that vision: a production AI coding assistant handling streaming LLM responses, permission-gated tool execution, real-time terminal UI, multi-agent coordination, MCP integration, IDE bridging, memory management, voice input, and much more — all in TypeScript, running on Bun, architected as a React application.

That is what the following chapters systematically explain.

---

*Next: [Chapter 2 — Architecture Deep Dive](PartI-Foundations-02-Architecture-Deep-Dive.md)*


\newpage

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


\newpage

# Chapter 3: The Query Engine — Heart of Claude Code

> **Part I: Foundations**

---

## What the Query Engine Does

`src/QueryEngine.ts` is approximately **46,000 lines** — the largest and most complex file in the codebase. It is the central orchestrator of every Claude interaction. When you type a message and press Enter, the Query Engine:

1. Assembles the system prompt from tools, context, and memory
2. Manages the conversation history
3. Streams the request to the Anthropic API
4. Processes the response stream (text chunks and tool_use blocks)
5. Executes the tool-call loop — potentially running dozens of tools per turn
6. Tracks token usage and cost
7. Handles errors, retries, and context compaction
8. Yields structured messages back to the REPL or SDK caller

Everything else in Claude Code exists to support this engine or display its output.

---

## The `QueryEngine` Class

The `QueryEngine` is instantiated **once per conversation**. Each user message is a new "turn" within the same engine instance:

```python
from typing import AsyncGenerator, Optional, Union

class QueryEngine:
    def __init__(self, config: 'QueryEngineConfig') -> None:
        self.config: QueryEngineConfig = config
        self.mutable_messages: list[Message] = []          # Conversation history
        self.abort_controller: AbortController = ...       # For cancellation
        self.permission_denials: list[SDKPermissionDenial] = []
        self.total_usage: NonNullableUsage = ...           # Cumulative token counts
        self.read_file_state: FileStateCache = ...         # LRU cache of file reads
        self.discovered_skill_names: set[str] = set()
        self.loaded_nested_memory_paths: set[str] = set()

    async def submit_message(
        self,
        prompt: Union[str, list['ContentBlockParam']],
        options: Optional[dict] = None,  # uuid, is_meta
    ) -> AsyncGenerator['SDKMessage', None]: ...
```

`submitMessage()` is an **async generator**. It yields `SDKMessage` objects as the turn progresses — partial text chunks, tool invocations, tool results, status updates — and returns when the turn is complete. Both the REPL (which renders these to the terminal) and the SDK (which returns them to the caller) consume this generator.

### `QueryEngineConfig`

The configuration object passed to `QueryEngine`:

```python
from typing import TypedDict, Optional, Callable

class QueryEngineConfig(TypedDict, total=False):
    cwd: str                               # Working directory
    tools: Tools                           # Available tools
    commands: list[Command]                # Available slash commands
    mcp_clients: list[MCPServerConnection] # Connected MCP servers
    agents: list[AgentDefinition]          # Available agent types
    can_use_tool: CanUseToolFn             # Permission check function
    get_app_state: Callable[[], AppState]  # State accessor
    set_app_state: Callable                # State updater
    initial_messages: list[Message]        # Pre-loaded conversation
    read_file_cache: FileStateCache        # File read cache
    custom_system_prompt: str             # Override default system prompt
    append_system_prompt: str             # Append to system prompt
    user_specified_model: str             # Model override
    thinking_config: ThinkingConfig
    max_turns: int                        # Turn limit (SDK use)
    max_budget_usd: float                 # Dollar budget cap
    task_budget: dict                     # Token budget cap (total key)
    verbose: bool
    # ... more fields
```

---

## The System Prompt Assembly

Before the first API call, the Query Engine assembles the system prompt:

```python
result = await fetch_system_prompt_parts(
    tools=tools,
    main_loop_model=initial_main_loop_model,
    additional_working_directories=additional_working_directories,
    mcp_clients=mcp_clients,
    custom_system_prompt=custom_system_prompt,
)
default_system_prompt = result['default_system_prompt']
user_context = result['user_context']
system_context = result['system_context']

system_prompt = as_system_prompt([
    *([custom_prompt] if custom_prompt is not None else default_system_prompt),
    *([memory_mechanics_prompt] if memory_mechanics_prompt else []),
    *([append_system_prompt] if append_system_prompt else []),
])
```

The system prompt is built from:

1. **Default system prompt** — Claude's behavior instructions, personality, tool guidance
2. **Tool `prompt()` contributions** — each tool can inject text into the system prompt (e.g., BashTool explains its timeout behavior, FileEditTool explains the uniqueness requirement)
3. **Memory mechanics prompt** — if auto-memory is configured, instructions for using the memory system
4. **Append system prompt** — caller-provided additions (via `--append-system-prompt` or SDK)
5. **User context** — OS, shell, current directory, git status, CLAUDE.md contents

---

## The Tool-Call Loop

This is the core of the Query Engine. After the initial API request, the engine processes the response stream:

```
LOOP:
  1. Send messages to Anthropic API (streaming)
  2. Buffer streaming chunks:
     - text_delta → accumulate into response text
     - tool_use → collect tool name + input JSON
  3. When stream ends:
     a. If response has text only → DONE (exit loop)
     b. If response has tool_use blocks → execute them
  4. For each tool_use block:
     a. Validate tool input against Zod schema
     b. Call wrappedCanUseTool() → check permissions
     c. If denied → record denial, add tool_result with error
     d. If allowed → execute tool.call()
     e. Add tool_result message to conversation
  5. Add all tool results to conversation history
  6. GOTO 1 (continue loop with updated conversation)
```

The loop terminates when:
- The LLM response contains no `tool_use` blocks (`completed`)
- The abort controller fires (`aborted_tools`, `aborted_streaming`)
- Maximum turns are reached (`max_turns`)
- A stop hook halts execution (`stop_hook_prevented`, `hook_stopped`)
- The prompt exceeds the context window (`prompt_too_long`)
- A model error occurs (`model_error`)

### Loop Transitions

`src/query/transitions.ts` defines the typed state machine for the loop:

```python
from typing import Literal
from dataclasses import dataclass

# Terminal transition — the query loop returned.
@dataclass
class Terminal:
    reason: Literal[
        'completed',           # Normal: LLM done with no pending tools
        'blocking_limit',      # Hit a hard limit
        'image_error',         # Image processing failed
        'model_error',         # API error
        'aborted_streaming',   # User pressed Ctrl+C during streaming
        'aborted_tools',       # User pressed Ctrl+C during tool execution
        'prompt_too_long',     # Context window exceeded
        'stop_hook_prevented', # A stop hook blocked completion
        'hook_stopped',        # A hook halted the loop
        'max_turns',           # Turn limit reached
    ]

# Continue transition — the loop will iterate again.
@dataclass
class Continue:
    reason: Literal[
        'tool_use',                    # LLM requested tools
        'reactive_compact_retry',      # Retrying after auto-compaction
        'max_output_tokens_recovery',  # Recovering from output truncation
        'max_output_tokens_escalate',  # Escalating from truncation
        'collapse_drain_retry',        # Draining collapsed tool results
        'stop_hook_blocking',          # Stop hook wants to block
        'token_budget_continuation',   # Budget nudging for continuation
        'queued_command',              # A queued slash command needs processing
    ]
```

These types make the loop's behavior explicit and auditable. When debugging Claude Code behavior, you can trace which transition fired and why.

---

## Streaming Architecture

Claude Code uses **server-sent events streaming** from the Anthropic API. Rather than waiting for the complete response before rendering, it processes chunks as they arrive:

```
API sends:   event: content_block_delta
             data: {"type": "text_delta", "text": "Here is "}

             event: content_block_delta
             data: {"type": "text_delta", "text": "the fix:"}

             event: content_block_start
             data: {"type": "tool_use", "name": "FileEdit", ...}
```

The Query Engine accumulates text deltas and displays them progressively — you see Claude's response appear word by word in the terminal.

Tool use blocks accumulate the input JSON as it streams, then fire the tool call when the block is complete (after the `content_block_stop` event).

---

## Thinking Mode & Token Budget

Claude can engage in "extended thinking" — an internal reasoning process before producing a response. The Query Engine manages this through `ThinkingConfig`:

```python
from typing import Union, Literal
from dataclasses import dataclass, field

@dataclass
class ThinkingDisabled:
    type: Literal['disabled'] = 'disabled'

@dataclass
class ThinkingEnabled:
    type: Literal['enabled'] = 'enabled'
    budget_tokens: int = 0

@dataclass
class ThinkingAdaptive:
    type: Literal['adaptive'] = 'adaptive'  # Decide based on prompt complexity

ThinkingConfig = Union[ThinkingDisabled, ThinkingEnabled, ThinkingAdaptive]
```

The initial thinking config is determined at the start of `submitMessage()`:

```python
initial_thinking_config: ThinkingConfig = (
    thinking_config
    if thinking_config
    else ThinkingAdaptive() if should_enable_thinking_by_default() is not False
    else ThinkingDisabled()
)
```

### Token Budget (`src/query/tokenBudget.ts`)

For extended thinking, the Query Engine must track how many tokens Claude has used in its thinking process. `tokenBudget.ts` manages this:

```python
from dataclasses import dataclass

# Two thresholds control the budget behavior:
COMPLETION_THRESHOLD = 0.9   # 90% spent → consider stopping
DIMINISHING_THRESHOLD = 500  # < 500 new tokens per check → diminishing returns

@dataclass
class BudgetTracker:
    continuation_count: int       # How many times we've continued
    last_delta_tokens: int        # Tokens used since last check
    last_global_turn_tokens: int  # Total tokens at last check
    started_at: float             # Timestamp
```

The `checkTokenBudget()` function decides whether to continue or stop a thinking turn:

```python
def check_token_budget(
    tracker: BudgetTracker,
    agent_id: str | None,
    budget: int | None,
    global_turn_tokens: int,
) -> TokenBudgetDecision:
    if agent_id or budget is None or budget <= 0:
        return {'action': 'stop', 'completion_event': None}

    pct = round((turn_tokens / budget) * 100)
    is_diminishing = (
        tracker.continuation_count >= 3 and
        delta_since_last_check < DIMINISHING_THRESHOLD
    )

    if pct >= COMPLETION_THRESHOLD * 100 or is_diminishing:
        return {'action': 'stop', 'completion_event': {...}}

    return {
        'action': 'continue',
        'nudge_message': get_budget_continuation_message(pct, budget),
        ...
    }
```

When the budget is nearly exhausted or thinking is producing diminishing returns (fewer than 500 new tokens per check after 3 continuations), the engine signals the loop to stop the thinking phase and produce a final response.

---

## Stop Hooks (`src/query/stopHooks.ts`)

Stop hooks are **user-defined scripts** that run after each turn. They can:
- Inspect the turn's output
- Signal that the turn should be retried (e.g., "the tests still fail, keep going")
- Block completion entirely

The stop hook system uses a `StopHookResult` type:

```python
from typing import TypedDict, Optional, Literal

class StopHookResult(TypedDict, total=False):
    decision: Literal['block', 'approve', 'error']
    reason: str
```

Stop hooks integrate with:
- `executeStopHooks()` — runs all registered stop hooks
- `executeTaskCompletedHooks()` — runs when a background task completes
- `executeTeammateIdleHooks()` — runs when a teammate agent goes idle
- Memory extraction (`extractMemoriesModule`) — if `EXTRACT_MEMORIES` flag is on

This is how Claude Code's "hooks" feature works at the query level: hooks are external scripts that participate in the turn lifecycle.

---

## Retry Logic

The Query Engine wraps API calls with retry logic from `src/services/api/withRetry.ts`. The `categorizeRetryableAPIError()` function from `src/services/api/errors.ts` classifies each error:

**Retryable errors** (automatic retry with backoff):
- Rate limit errors (HTTP 429) — wait before retrying
- Transient server errors (HTTP 500, 503)
- Network timeouts
- Connection reset errors

**Fatal errors** (no retry):
- Authentication failures (HTTP 401, 403)
- Invalid request (HTTP 400) — retrying won't fix a bad prompt
- Model not found (HTTP 404)
- Context window exceeded — needs compaction, not retry

The backoff strategy uses exponential backoff with jitter: each retry waits `base * 2^attempt + random_jitter` milliseconds, capped at a maximum wait time. This prevents thundering herd problems when many Claude Code instances hit a rate limit simultaneously.

---

## Token Counting & Cost Tracking

Every API response includes usage data:

```python
{
    'input_tokens': 1234,
    'output_tokens': 567,
    'cache_read_input_tokens': 890,    # Cache hits (cheaper)
    'cache_creation_input_tokens': 123  # Cache misses
}
```

The `accumulateUsage()` function from `src/services/api/claude.ts` adds these to the running total in `this.totalUsage`. The cost tracker (`src/cost-tracker.ts`) maps token counts to dollar amounts using per-model pricing data.

This data surfaces to users via the `/cost` command and the status line.

---

## Context Window Management

The conversation history grows with every turn. At some point it approaches the model's context window limit. The Query Engine handles this through **compaction** — summarizing old messages to free up space.

Compaction is triggered reactively when the API returns a `prompt_too_long` error (reactive compact) or proactively when the context usage exceeds a configured threshold (auto-compact).

The compaction flow:
1. All messages before a recent checkpoint are sent to the LLM with a summarization prompt
2. The LLM produces a compact summary of the conversation so far
3. The old messages are replaced with a single summary message
4. The conversation continues from the summary

The loop transition reason `reactive_compact_retry` marks a turn where compaction was just performed and the original request is being retried.

---

## The `src/query/` Subdirectory

The `src/query/` directory contains modules extracted from the main query loop for clarity:

### `config.ts`
Query configuration constants and defaults — default thinking budget, max retry counts, compaction thresholds.

### `deps.ts`
Dependency injection wiring for the query engine. Collects the injected services (API client, file cache, etc.) and validates they are all present.

### `transitions.ts`
The typed state machine (`Terminal` and `Continue` types) shown above. Keeping these types in their own file prevents circular imports between the query engine and its consumers.

### `tokenBudget.ts`
Token budget tracking for extended thinking, as shown above.

### `stopHooks.ts`
Stop hook execution logic. This file imports the hook runner, memory extraction, and other post-sampling logic that fires after each API response.

---

## How the Query Engine Coordinates with the Tool System

The Query Engine does not directly know about any specific tool. Instead, it receives:

1. A `tools: Tools` array — the list of available tools and their schemas
2. A `canUseTool: CanUseToolFn` — the permission gate function

When a `tool_use` block arrives in the API response:

```python
# Simplified — actual code in query.py (src/query.py)
for tool_use in tool_use_blocks:
    tool = next(t for t in tools if tool_matches_name(t, tool_use.name))

    # 1. Parse and validate the input
    parsed_input = tool.input_schema.parse(tool_use.input)

    # 2. Check permissions
    decision = await wrapped_can_use_tool(
        tool, parsed_input, tool_use_context, assistant_msg, tool_use.id
    )

    if decision.behavior != 'allow':
        # Return a tool_result with the denial reason
        results.append({'type': 'tool_result', 'tool_use_id': tool_use.id, 'content': denial})
        continue

    # 3. Execute
    result = await tool.call(parsed_input, tool_use_context)

    # 4. Format result for API
    results.append({'type': 'tool_result', 'tool_use_id': tool_use.id, 'content': result.data})

# 5. Feed all results back in a single user message
messages.append({
    'role': 'user',
    'content': results  # list of tool_result blocks
})
```

The Query Engine then loops back to step 1 (send to API) with the updated conversation including the tool results.

This design means **tools and the query engine are decoupled**: adding a new tool requires no changes to the query engine. The engine just asks "what tools do you have?" at startup and calls whatever it gets.

---

*Next: [Chapter 4 — Tool Architecture](PartII-The-Tool-System-04-Tool-Architecture.md)*


\newpage


# Part II: The Tool System

# Chapter 4: Tool Architecture

> **Part II: The Tool System**

---

## What Is a Tool?

In Claude Code, a **tool** is the only way the LLM can affect the external world. The LLM cannot write files, execute commands, or access the internet directly — it must request a tool call. Every tool is:

- A **TypeScript module** in `src/tools/{ToolName}/`
- Self-contained with its own implementation, UI rendering, and permission logic
- Registered in `src/tools.ts` and discovered by the Query Engine
- Defined using the `buildTool()` factory from `src/Tool.ts`

There are approximately **40 tools** in the current codebase, some gated behind feature flags.

---

## `src/Tool.ts` — The Base Interface

`Tool.ts` is one of the largest files at ~29,000 lines. Most of that bulk is the `ToolUseContext` type — an enormous object that gives every tool access to the full runtime environment.

### `ToolUseContext` — What Every Tool Receives

When a tool's `call()` method is invoked, it receives a `ToolUseContext` with:

```python
from typing import TypedDict, Optional, Callable

class ToolUseContextOptions(TypedDict, total=False):
    commands: list[Command]           # Available slash commands
    debug: bool
    main_loop_model: str              # Current model
    tools: Tools                      # All available tools
    verbose: bool
    thinking_config: ThinkingConfig
    mcp_clients: list[MCPServerConnection]
    mcp_resources: dict[str, list[ServerResource]]
    is_non_interactive_session: bool
    agent_definitions: AgentDefinitionsResult
    max_budget_usd: float
    custom_system_prompt: str
    append_system_prompt: str
    refresh_tools: Callable[[], Tools]  # Get updated tools (e.g., after MCP connects)

class ToolUseContext(TypedDict, total=False):
    options: ToolUseContextOptions
    abort_controller: AbortController   # For cancellation
    read_file_state: FileStateCache     # LRU cache of file reads
    get_app_state: Callable[[], AppState]   # Read global state
    set_app_state: Callable             # Mutate global state
    set_tool_jsx: SetToolJSXFn          # Render custom UI
    add_notification: Callable          # Add a notification
    append_system_message: Callable     # Append UI-only message
    send_os_notification: Callable      # OS-level notification
    set_in_progress_tool_use_ids: Callable
    set_response_length: Callable
    update_file_history_state: Callable
    update_attribution_state: Callable
    agent_id: AgentId                   # Set only for sub-agents
    agent_type: str                     # Agent type name
    # ... many more fields
```

This context is the tool's window into the world. Tools access conversation state, settings, file caches, and rendering functions all through this object.

### `ToolPermissionContext`

The permission subsystem has its own context type:

```python
from dataclasses import dataclass, field
from typing import Optional

@dataclass(frozen=True)
class ToolPermissionContext:
    mode: PermissionMode                        # default | plan | bypassPermissions | auto
    additional_working_directories: dict[str, AdditionalWorkingDirectory] = field(default_factory=dict)
    always_allow_rules: ToolPermissionRulesBySource = field(default_factory=dict)
    always_deny_rules: ToolPermissionRulesBySource = field(default_factory=dict)
    always_ask_rules: ToolPermissionRulesBySource = field(default_factory=dict)
    is_bypass_permissions_mode_available: bool = False
    is_auto_mode_available: Optional[bool] = None
    should_avoid_permission_prompts: Optional[bool] = None
    await_automated_checks_before_dialog: Optional[bool] = None
    pre_plan_mode: Optional[PermissionMode] = None  # Permission mode before entering plan mode

def get_empty_tool_permission_context() -> ToolPermissionContext:
    return ToolPermissionContext(
        mode='default',
        additional_working_directories={},
        always_allow_rules={},
        always_deny_rules={},
        always_ask_rules={},
        is_bypass_permissions_mode_available=False,
    )
```

`DeepImmutable<>` ensures permission context cannot be mutated by tools — only the permission system itself can update it.

---

## `src/tools.ts` — Tool Registration

`tools.ts` is the tool registry. It imports all tools and assembles the `Tools` array that is passed to the Query Engine:

```python
import os
import importlib

from tools.bash_tool.bash_tool import BashTool
from tools.file_edit_tool.file_edit_tool import FileEditTool
from tools.file_read_tool.file_read_tool import FileReadTool
# ... ~35 more imports

# Feature-gated tools (stripped if flag is off):
SleepTool = (
    importlib.import_module('.tools.sleep_tool.sleep_tool').SleepTool
    if feature('PROACTIVE') or feature('KAIROS') else None
)

# Anthropic-internal tools (only for USER_TYPE === 'ant'):
REPLTool = (
    importlib.import_module('.tools.repl_tool.repl_tool').REPLTool
    if os.environ.get('USER_TYPE') == 'ant' else None
)

# Circular dependency broken with lazy import:
def get_team_create_tool():
    return importlib.import_module('.tools.team_create_tool.team_create_tool').TeamCreateTool
```

### Tool Presets

```python
from typing import Literal
TOOL_PRESETS: tuple[Literal['default'], ...] = ('default',)
```

Currently one preset (`default`). The `getTools()` function assembles the tool list based on context:

- Runtime environment (REPL vs SDK)
- Feature flags
- `USER_TYPE` environment variable (Anthropic-internal tools)
- Platform (PowerShellTool only on Windows/when configured)
- Agent type (some tools restricted in sub-agents)

### Tool Allowlists for Sub-Agents

`tools.ts` exports constants that control which tools sub-agents can use:

```python
from constants.tools import (
    ALL_AGENT_DISALLOWED_TOOLS,     # Tools no sub-agent can use
    CUSTOM_AGENT_DISALLOWED_TOOLS,  # Tools custom agents can't use
    ASYNC_AGENT_ALLOWED_TOOLS,      # Tools background agents can use
    COORDINATOR_MODE_ALLOWED_TOOLS, # Tools coordinator workers get
)
```

This is how Claude Code enforces that a sub-agent spawned for "code review" can't start spawning its own sub-agents or modifying configuration.

---

## The `buildTool()` Factory Pattern

Every tool uses `buildTool()` from `src/Tool.ts`. Here is the complete interface:

```python
from pydantic import BaseModel
from typing import Optional, Any

class MyToolInput(BaseModel):
    param1: str   # Description of param1
    param2: int = 10

MyTool = build_tool(
    # Identity
    name='MyTool',
    aliases=['my_tool'],          # Alternative names the LLM can use
    description='What this tool does for the LLM',

    # Input schema (Pydantic)
    input_schema=MyToolInput,

    # Main implementation — called when LLM uses this tool
    async def call(
        args,           # Validated, typed input
        context,        # ToolUseContext
        can_use_tool,   # Permission function
        parent_message, # The assistant message that triggered this call
        on_progress,    # Callback for streaming progress updates
    ):
        # Execute the tool
        return {
            'data': result,
            'new_messages': [...],  # Optional: inject messages into conversation
        },

    # Permission check — called BEFORE call()
    async def check_permissions(input, context) -> PermissionResult:
        # Return {'behavior': 'allow'} or {'behavior': 'deny', 'reason': ...}
        # or {'behavior': 'ask', 'prompt': 'Show this to user'}
        pass,

    # Concurrency safety — can this run in parallel with other tools?
    is_concurrency_safe=lambda input: True,

    # Read-only flag — does this tool modify state?
    is_read_only=lambda input: False,

    # System prompt contribution — injected into every API request
    prompt=lambda options: 'Instructions for the LLM about how to use MyTool...',

    # Terminal rendering — how invocation looks in the REPL
    render_tool_use_message=lambda input, options: f'Using MyTool with {input.param1}',

    # Terminal rendering — how the result looks in the REPL
    render_tool_result_message=lambda content, progress_messages, options: f'Result: {content}',
)
```

### Directory Structure Per Tool

Each tool is a self-contained directory:

```
src/tools/MyTool/
├── MyTool.ts         # Main implementation (or .tsx if it has JSX)
├── UI.tsx            # Terminal rendering (renderToolUseMessage, renderToolResultMessage)
├── prompt.ts         # System prompt contribution
├── types.ts          # Input/output TypeScript types
├── utils.ts          # Tool-specific helpers
├── constants.ts      # Constants (tool name, limits, etc.)
└── index.ts          # Re-exports
```

Not every tool has all files. Simple tools may have just `ToolName.ts`. Complex tools like BashTool have 15+ files:

```
src/tools/BashTool/
├── BashTool.tsx
├── UI.tsx
├── bashCommandHelpers.ts
├── bashPermissions.ts
├── bashSecurity.ts
├── commandSemantics.ts
├── commentLabel.ts
├── destructiveCommandWarning.ts
├── modeValidation.ts
├── pathValidation.ts
├── prompt.ts
├── readOnlyValidation.ts
├── sedEditParser.ts
├── sedValidation.ts
├── shouldUseSandbox.ts
└── utils.ts
```

---

## Tool Lifecycle

### 1. Registration at Startup

`getTools()` in `tools.ts` is called once during initialization. The resulting `Tools` array is passed to the `QueryEngineConfig`.

### 2. System Prompt Injection

Before every API call, `fetchSystemPromptParts()` calls each tool's `prompt()` method and assembles their contributions into the system prompt. This is how the LLM "knows" about tools — the system prompt contains instructions for each one.

For example, `BashTool.prompt()` explains the timeout behavior, why you should use `run_in_background` for long commands, and how output is truncated. `FileEditTool.prompt()` explains the `old_string` uniqueness requirement.

### 3. LLM Requests Tool Use

The LLM response includes `tool_use` blocks:

```json
{
  "type": "tool_use",
  "id": "toolu_01234",
  "name": "BashTool",
  "input": {
    "command": "npm test",
    "description": "Run test suite"
  }
}
```

### 4. Input Validation

The Query Engine calls `tool.inputSchema.parse(toolUse.input)`. If validation fails, a `tool_result` with the Zod error message is returned to the LLM, which can then correct its input.

### 5. Permission Check

`wrappedCanUseTool()` is called, which invokes the permission system:

```python
result = await can_use_tool(tool, input, tool_use_context, assistant_msg, tool_use.id)
```

The permission system checks:
1. Is `bypassPermissions` mode active? → allow
2. Does an `alwaysAllowRule` match? → allow
3. Does an `alwaysDenyRule` match? → deny
4. Does `tool.checkPermissions()` report a problem? → ask user
5. Is `plan` mode active for a write operation? → deny

### 6. Execution

If permitted, `tool.call(input, context, ...)` runs. The tool performs its work (reading a file, running a command, etc.) and returns a result.

### 7. Result Rendering

Two rendering calls happen:
- `renderToolUseMessage()` — displayed when the tool is invoked (before completion)
- `renderToolResultMessage()` — displayed after the tool completes with its output

Both return React components rendered by Ink to the terminal.

### 8. Feed Back to LLM

The result is formatted as a `tool_result` message and appended to the conversation. The loop continues.

---

## Key Design Principles

### Tools Declare Their Own Permissions

Rather than a central permission table, each tool's `checkPermissions()` method contains its own logic. BashTool knows which commands are dangerous; FileEditTool knows which paths are off-limits. This keeps permission logic co-located with the tool implementation.

### Tools Are Context-Agnostic

A tool implementation does not know whether it is running in the REPL, the SDK, a sub-agent, or a coordinator. The `ToolUseContext` abstracts all of this. This is why the same `BashTool` code runs identically in interactive and headless modes.

### Circular Dependencies Are Broken With Lazy Require

Several tools would create import cycles if imported directly. The pattern used throughout `tools.ts`:

```python
import importlib

# Lazy import to break circular dependency: tools.py → TeamCreateTool → ... → tools.py
def get_team_create_tool():
    return importlib.import_module('.tools.team_create_tool.team_create_tool').TeamCreateTool
```

The tool is not imported until `getTeamCreateTool()` is first called, breaking the cycle.

---

*Next: [Chapter 5 — File System Tools — Deep Dive](PartII-The-Tool-System-05-File-System-Tools-Deep-Dive.md)*


\newpage

# Chapter 5: File System Tools — Deep Dive

> **Part II: The Tool System**

---

## Overview

The file system tools are the most-used tools in Claude Code. They are how Claude reads your code, makes changes, and searches for information. Understanding their exact behavior — including edge cases and limitations — is essential for effective use and for understanding why Claude makes the choices it does.

All file system tools live in `src/tools/` with the structure:

| Tool | Directory |
|------|-----------|
| FileReadTool | `src/tools/FileReadTool/` |
| FileWriteTool | `src/tools/FileWriteTool/` |
| FileEditTool | `src/tools/FileEditTool/` |
| GlobTool | `src/tools/GlobTool/` |
| GrepTool | `src/tools/GrepTool/` |
| NotebookEditTool | `src/tools/NotebookEditTool/` |
| TodoWriteTool | `src/tools/TodoWriteTool/` |

---

## FileReadTool

**Input schema:**
```python
from pydantic import BaseModel
from typing import Optional

class FileReadInput(BaseModel):
    file_path: str                  # Absolute path
    offset: Optional[int] = None   # Start line (1-indexed)
    limit: Optional[int] = None    # Max lines to read
```

### Text Files

Text files are read using `readFileSyncWithMetadata()` (from `src/utils/fileRead.ts`), which:
- Detects the file encoding (UTF-8, Latin-1, etc.)
- Detects line endings (LF vs CRLF)
- Returns the content with line numbers in `cat -n` format: `1\t<line>`

The `cat -n` format is deliberate — line numbers allow Claude to reference specific lines precisely, and they are used when constructing `FileEditTool` inputs.

### Line Range Support

The `offset` and `limit` parameters enable reading slices of large files:

```python
# Read lines 100-200:
FileReadInput(file_path='/src/query_engine.py', offset=100, limit=100)
```

This is critical for QueryEngine.ts (~46K lines) and other large files. Claude Code's own documentation recommends using `offset` and `limit` rather than reading an entire large file.

### Image Support

When a file is detected as an image (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, etc.), `imageProcessor.ts` base64-encodes it and returns it as a vision input block to the LLM:

```json
{
  "type": "image",
  "source": {
    "type": "base64",
    "media_type": "image/png",
    "data": "iVBORw0KGgoAAAANSUhEUgAA..."
  }
}
```

This is why Claude Code can analyze screenshots, UI mockups, and diagrams.

### PDF Support

PDFs are passed directly to the API using the files API or as base64 content. The LLM can then extract text from the PDF content.

### Jupyter Notebook Support

`.ipynb` files are rendered specially. Rather than showing raw JSON, `FileReadTool` formats the notebook as readable cell output, including code cells, markdown cells, and output cells.

### File Size Limits

`src/tools/FileReadTool/limits.ts` contains size limits:
- Files exceeding certain sizes get truncation warnings
- Binary files (non-text) are rejected unless they are recognized image formats
- Extremely large files prompt the user to use `offset`/`limit`

### Permission Model

`FileReadTool` is **read-only** (`isReadOnly: true`). It requires permission to read files outside the current working directory or in sensitive locations (e.g., `~/.ssh/`, `/etc/`). Within the project directory, reads are generally auto-approved.

---

## FileWriteTool

**Input schema:**
```python
from pydantic import BaseModel

class FileWriteInput(BaseModel):
    file_path: str   # Absolute path
    content: str     # Complete new file content
```

FileWriteTool **replaces the entire file**. It is used for:
- Creating new files that don't exist yet
- Complete rewrites of small files
- Generating new files from scratch

For partial edits of existing files, `FileEditTool` is always preferred — it is safer (only the changed portion is modified), produces cleaner diffs, and reduces the chance of accidentally removing content.

### Write Flow

1. Validate that `file_path` is an absolute path
2. Check write permissions via `checkWritePermissionForTool()`
3. Detect existing file encoding (to preserve it)
4. Write using `writeTextContent()` (from `src/utils/file.ts`)
5. Notify VS Code via `notifyVscodeFileUpdated()` (if IDE bridge is active)
6. Track edit in file history (if enabled)

### Permission Model

Write operations require explicit user approval unless an `alwaysAllow` rule covers the path. In `default` mode, writing outside the project directory always prompts.

---

## FileEditTool — The Most Important Tool

FileEditTool is the tool Claude Code uses for **surgical file modifications** — editing specific parts of a file without rewriting the entire content.

**Input schema** (from `src/tools/FileEditTool/types.ts`):
```python
from pydantic import BaseModel

class FileEditInput(BaseModel):
    file_path: str              # Absolute path to file
    old_string: str             # The exact text to replace
    new_string: str             # The text to replace it with
    replace_all: bool = False   # Replace all occurrences
```

### The String Replacement Model

The edit mechanism is deceptively simple: find `old_string` in the file, replace it with `new_string`. But the devil is in the details:

**Uniqueness requirement**: By default (`replace_all: false`), `old_string` must appear **exactly once** in the file. If it appears 0 times, the edit fails. If it appears 2+ times, the edit fails with an ambiguity error. This is a safety feature — it prevents accidentally modifying the wrong occurrence.

**Why this design?** Alternative approaches (line number-based edits, AST-based edits) are either fragile (line numbers change as the file is edited) or complex (AST requires language-specific parsers). String replacement is language-agnostic and works on any text file. The uniqueness requirement compensates for the lack of structural awareness.

**`replace_all: true`**: For cases where you intentionally want to replace every occurrence (renaming a variable, updating an import path), `replace_all` bypasses the uniqueness check.

### The Fuzzy Matching System

`findActualString()` in `utils.ts` handles cases where `old_string` doesn't exactly match the file contents due to:
- Whitespace normalization (trailing spaces, tab/space differences)
- Quote style differences (`'` vs `"`)
- Line ending differences (CRLF vs LF)

`preserveQuoteStyle()` ensures that when Claude replaces a string with different quote styles, the original quote style is preserved where possible.

### The Edit Process

```
1. Read file with readFileSyncWithMetadata()
2. Check file modification time (detect concurrent edits)
3. Find old_string in file content
   - Exact match first
   - Fuzzy match fallback (whitespace normalization)
4. Validate uniqueness (unless replace_all)
5. Perform replacement → new content
6. Write new content with writeTextContent()
7. Compute structured patch (unified diff)
8. Fetch git diff for display
9. Track edit in file history
10. Notify VS Code (if bridge active)
11. Clear LSP diagnostics for file (stale after edit)
12. Activate conditional skills for edited paths
13. Check for team memory secrets in edited content
```

Steps 11–13 demonstrate the deep integration between FileEditTool and other Claude Code subsystems.

### Output

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class FileEditOutput:
    file_path: str
    old_string: str
    new_string: str
    original_file: str          # Full file before edit
    structured_patch: list[Hunk]  # Unified diff format
    user_modified: bool         # Did user modify the proposed edit?
    replace_all: bool
    git_diff: Optional[GitDiff] = None  # Git-level diff (if git repo)
```

The `structuredPatch` and `gitDiff` are used by `StructuredDiff` component to render the diff in the terminal.

### `FILE_UNEXPECTEDLY_MODIFIED_ERROR`

If the file's modification time changed between when Claude read it and when it tries to edit it, FileEditTool throws `FILE_UNEXPECTEDLY_MODIFIED_ERROR`. This protects against race conditions — if you manually edited the file in your editor while Claude was planning its edit, the edit fails rather than silently clobbering your change.

---

## GlobTool

**Input schema:**
```python
from pydantic import BaseModel
from typing import Optional

class GlobInput(BaseModel):
    pattern: str                  # Glob pattern (e.g., "**/*.py")
    path: Optional[str] = None    # Directory to search in
```

GlobTool finds files matching a glob pattern, sorted by **modification time** (most recently modified first). This sorting is intentional: Claude typically wants to look at recently changed files, and the most recently modified file is usually the most relevant.

**Pattern examples:**
- `**/*.ts` — all TypeScript files recursively
- `src/**/*.tsx` — all TSX files under src/
- `*.{json,yaml}` — JSON and YAML files in current directory
- `**/test*.ts` — test files anywhere in the tree

**Implementation**: Uses [fast-glob](https://github.com/mrmlnc/fast-glob) under the hood, which is built on micromatch for pattern matching and efficiently traverses large directory trees. Respects `.gitignore` by default.

**Permission model**: Read-only. No special permissions required within the project directory.

---

## GrepTool

GrepTool is built on **ripgrep** (`rg`) — the fastest file content search tool available. It supports full regex syntax and offers multiple output modes.

**Input schema:**
```python
from pydantic import BaseModel
from typing import Literal, Optional

class GrepInput(BaseModel):
    pattern: str                  # Regex pattern
    path: Optional[str] = None    # Directory/file to search
    glob: Optional[str] = None    # File filter (e.g., "*.py")
    type: Optional[str] = None    # File type (e.g., "ts", "py")
    output_mode: Literal[
        'files_with_matches',  # Default: just file paths
        'content',             # Show matching lines
        'count',               # Count matches per file
    ] = 'files_with_matches'
    case_insensitive: Optional[bool] = None   # -i: Case insensitive
    line_numbers: Optional[bool] = None       # -n: Show line numbers
    after_context: Optional[int] = None       # -A: Lines after match
    before_context: Optional[int] = None      # -B: Lines before match
    context: Optional[int] = None             # -C: Context lines (before and after)
    head_limit: int = 250                     # Limit output
    offset: Optional[int] = None             # Skip first N results
    multiline: Optional[bool] = None         # Match across lines
```

**Why ripgrep?** `rg` is 10–100x faster than `grep` for large codebases. It automatically respects `.gitignore`, skips binary files, and uses SIMD-accelerated regex matching. For a codebase like Claude Code's own source (~528K lines), `rg` returns results in milliseconds.

**Output modes:**

`files_with_matches` (default): Returns just file paths. Most efficient for "which files contain X?" queries.

`content`: Returns the matching lines with optional context. Used when you need to see the actual matches:
```
src/QueryEngine.ts:184:export class QueryEngine {
src/QueryEngine.ts:209:  async *submitMessage(
```

`count`: Returns match counts per file. Useful for "how many times is X used?"

**`head_limit` and `offset`**: For searches that return thousands of matches, `head_limit` (default 250) prevents overwhelming the context window. `offset` enables pagination.

---

## NotebookEditTool

NotebookEditTool edits Jupyter notebooks (`.ipynb` files). Notebooks are JSON files with a specific structure:

```json
{
  "cells": [
    {
      "cell_type": "code",
      "source": ["import pandas as pd\n"],
      "outputs": [...]
    }
  ],
  "metadata": { "kernelspec": {...} }
}
```

Rather than treating notebooks as raw JSON, NotebookEditTool understands the cell structure. It can:
- Edit cell source code
- Replace a cell with new content
- Add new cells
- Delete cells
- Preserve cell outputs (unless the cell source changes)

**Input schema:**
```python
from pydantic import BaseModel
from typing import Literal, Optional

class NotebookEditInput(BaseModel):
    notebook_path: str
    cell_number: int                              # 0-indexed cell to edit
    new_source: str                               # New source code for the cell
    cell_type: Optional[Literal['code', 'markdown']] = None
```

The tool handles the complexity of JSON serialization, preserving metadata, and maintaining the notebook's structural integrity.

---

## TodoWriteTool

TodoWriteTool provides structured task tracking within a conversation. Unlike the OS-level task system (background agents, etc.), these todos are **UI-level annotations** — they make Claude's work plan visible and trackable.

**Input schema:**
```python
from pydantic import BaseModel
from typing import Literal

class TodoItem(BaseModel):
    id: str
    content: str
    status: Literal['pending', 'in_progress', 'completed']
    priority: Literal['high', 'medium', 'low']

class TodoWriteInput(BaseModel):
    todos: list[TodoItem]
```

Todos persist in the conversation state and are rendered in the terminal. The pattern of use:
1. Claude creates todos at the start of a complex task
2. Marks them `in_progress` as it works on each
3. Marks them `completed` as it finishes
4. The user can see progress in real-time in the UI

The todos are not persisted to disk — they live in the `AppState` for the current session only.

---

## Shared File System Utilities

These utilities in `src/utils/` support all file tools:

**`src/utils/file.ts`**:
- `writeTextContent()` — writes content with correct line endings
- `getFileModificationTime()` — for modification time checks
- `findSimilarFile()` — fuzzy file name suggestions when file not found
- `FILE_NOT_FOUND_CWD_NOTE` — message shown when a file isn't found

**`src/utils/fileRead.ts`**:
- `readFileSyncWithMetadata()` — reads file with encoding and line ending detection

**`src/utils/fileHistory.ts`**:
- Tracks all file edits in the session for undo/redo support
- `fileHistoryEnabled()` — checks if history tracking is on
- `fileHistoryTrackEdit()` — records an edit event

**`src/utils/fileStateCache.ts`**:
- LRU cache of file reads within a session
- Prevents re-reading the same file multiple times per turn
- Shared across all file tools via `ToolUseContext.readFileState`

---

*Next: [Chapter 6 — Shell & Execution Tools — Deep Dive](PartII-The-Tool-System-06-Shell-Execution-Tools-Deep-Dive.md)*


\newpage

# Chapter 6: Shell & Execution Tools — Deep Dive

> **Part II: The Tool System**

---

## Overview

The shell execution tools give Claude Code the ability to run real commands in your environment. This is the most powerful — and most dangerous — category of tools. Understanding their exact behavior, constraints, and security model is essential both for using Claude Code effectively and for understanding how its safety model works.

---

## BashTool

BashTool is the most complex tool in the codebase. Its directory contains 18 files:

```
src/tools/BashTool/
├── BashTool.tsx               # Main implementation
├── UI.tsx                     # Terminal rendering
├── bashCommandHelpers.ts      # Command parsing helpers
├── bashPermissions.ts         # Permission rule matching
├── bashSecurity.ts            # Security validation
├── commandSemantics.ts        # Read/write/search classification
├── commentLabel.ts            # Command comment extraction
├── destructiveCommandWarning.ts
├── modeValidation.ts
├── pathValidation.ts
├── prompt.ts                  # System prompt contribution
├── readOnlyValidation.ts
├── sedEditParser.ts           # Parse sed-style edits
├── sedValidation.ts
├── shouldUseSandbox.ts
├── toolName.ts
└── utils.ts
```

### Input Schema

```python
from pydantic import BaseModel
from typing import Optional

class BashToolInput(BaseModel):
    command: str
    description: str                  # Required human-readable description
    timeout: Optional[float] = None   # Timeout in milliseconds
    run_in_background: bool = False
```

The `description` field is mandatory and must clearly explain what the command does. This serves both as documentation and as the text shown in the permission prompt — "Run `rm -rf node_modules`" tells the user very little, but "Remove node_modules to force clean reinstall" explains the intent.

### Command Execution

Commands execute via `exec()` from `src/utils/Shell.ts`, which spawns a child process:

- Commands run in a **new shell process** — there is no persistent shell state between calls
- Environment variables set in one BashTool call are **not** available in the next
- Working directory is reset to the project root between calls (unless changed with `cd` within a single call)
- stdout and stderr are captured separately

This stateless model is a deliberate safety choice. A persistent shell would allow commands to accumulate state (environment variables, directory changes, function definitions) that could make behavior unpredictable and harder to audit.

### Timeout Handling

Defaults come from `src/utils/timeouts.ts`:

- **Default timeout**: A configured value (typically 2 minutes for interactive, longer for background)
- **Maximum timeout**: A hard cap above which no command can run
- **`run_in_background`**: Bypasses the foreground timeout entirely

When a command times out:
1. The process is sent SIGTERM
2. If it doesn't exit, SIGKILL is sent
3. The truncated output collected so far is returned with a timeout error message

### The `run_in_background` Parameter

Long-running commands should use `run_in_background: true`:

```python
# Bad: blocks the turn for 10 minutes, may timeout
BashToolInput(command='npm run build:full', description='Full build')

# Good: registers as a background task, notifies when done
BashToolInput(command='npm run build:full', description='Full build', run_in_background=True)
```

Background tasks are managed by `LocalShellTask` from `src/tasks/LocalShellTask/`. The task:
1. Registers in the task list (visible via `/tasks`)
2. Runs asynchronously
3. Notifies via `markTaskNotified()` when it completes

The system prompt (from `BashTool/prompt.ts`) explicitly instructs the LLM about when to use this parameter:

> "You can use the `run_in_background` parameter to run the command in the background. Only use this if you don't need the result immediately and are OK being notified when the command completes later."

### Command Classification: Search, Read, List, or Write?

`commandSemantics.ts` classifies commands to determine whether they should be **collapsed** in the UI (hidden behind a "show details" toggle):

```python
# These commands collapse automatically in the UI:
BASH_SEARCH_COMMANDS = {'find', 'grep', 'rg', 'ag', ...}
BASH_READ_COMMANDS = {'cat', 'head', 'tail', 'jq', 'awk', ...}
BASH_LIST_COMMANDS = {'ls', 'tree', 'du'}

# These are "semantic neutral" — don't affect classification
BASH_SEMANTIC_NEUTRAL_COMMANDS = {'echo', 'printf', 'true', ...}

# For pipelines, ALL parts must be search/read for collapse to apply
# Example: `ls dir && echo "---" && ls dir2` → collapsed (all neutral/list)
# Example: `cat file.py | python -m lint` → NOT collapsed (lint is not read/search)
```

This classification means simple read operations (listing files, reading output, searching) don't clutter the terminal, while commands that actually do things (build, test, deploy) are always shown.

### Sandboxing

`shouldUseSandbox.ts` determines if a command should run in a sandbox. On macOS, Claude Code can use `sandbox-exec` to restrict what the command can access:

```python
def should_use_sandbox(command: str, context: ToolUseContext) -> bool:
    # ... logic based on command, platform, settings
    pass
```

The sandbox restricts:
- Network access (no unexpected outbound connections)
- File system writes (to a limited set of paths)
- Process creation (some subprocess spawning blocked)

The `dangerouslyDisableSandbox` flag (accessible via settings) bypasses this for commands that legitimately need these capabilities.

### Permission Model

BashTool has the most sophisticated permission system of any tool. `bashPermissions.ts` handles rule matching:

```python
# Permission rule format:
# Bash(git *)        → matches any git command
# Bash(npm test)     → matches exactly 'npm test'
# Bash(rm /tmp/*)    → matches rm with /tmp/ prefix
def bash_tool_has_permission(
    command: str,
    rules: ToolPermissionRulesBySource,
) -> bool: ...

# Extracts the "prefix" from a rule for wildcard matching
def permission_rule_extract_prefix(rule: str) -> str: ...

# Checks if a command has any 'cd' that changes directory
def command_has_any_cd(command: str) -> bool: ...
```

Additionally, `destructiveCommandWarning.ts` identifies particularly dangerous commands (like `rm -rf /`) and shows extra warnings.

### Output Handling

BashTool uses `EndTruncatingAccumulator` to handle large outputs:
- Normal output: streamed to terminal as it arrives
- Output > size limit: truncated with a message indicating how many bytes were cut
- Image output: detected (`isImageOutput()`) and rendered inline via base64 if the terminal supports it

Output containing terminal escape codes from the command is rendered with those codes intact — colored test output, progress bars, etc. all display correctly.

---

## PowerShellTool

PowerShellTool is a Windows-specific variant that executes PowerShell commands instead of bash. It has the same conceptual model as BashTool but with platform-specific adjustments:

- Uses `powershell.exe` or `pwsh.exe` (PowerShell Core) to execute
- Command syntax validation adapted for PowerShell (no sed, grep → Select-String, etc.)
- Enabled conditionally via `isPowerShellToolEnabled()` in `src/utils/shell/shellToolUtils.ts`

On non-Windows platforms, PowerShellTool is not registered in the tool list.

---

## REPLTool

REPLTool provides **persistent session execution** — unlike BashTool where each command runs in a fresh shell, REPLTool maintains state across multiple calls.

> **Important**: REPLTool is an Anthropic-internal tool, gated behind `USER_TYPE === 'ant'` in `tools.ts`. It is not available in public Claude Code builds.

The key difference from BashTool:

| | BashTool | REPLTool |
|--|---------|---------|
| State persistence | None (new process each call) | Persists across calls |
| Shell setup | Standard environment | Can set up environment once, reuse |
| Use case | Individual commands | Long-running sessions, environment setup |
| Performance | Fresh start each time | Faster subsequent calls (no startup) |

**REPL session management** (`REPLTool/` directory):
- Sessions are created on first use
- A session is identified by type (Python, Node.js, etc.) and optionally a session name
- Multiple named sessions can run simultaneously
- Sessions are automatically cleaned up when the turn ends or the conversation is reset

---

## The Sandbox Architecture

The sandboxing system lives in `src/utils/sandbox/`:

```
src/utils/sandbox/
├── sandbox-adapter.ts    # Platform abstraction layer
├── ...                   # Platform-specific implementations
```

`SandboxManager` (used by BashTool) provides a unified interface:
- **macOS**: Uses `sandbox-exec` with a Scheme policy file that restricts filesystem and network access
- **Linux**: Uses process isolation via container-style restrictions (when available)
- **Windows**: Limited sandboxing support

The key insight from `preapproved.ts` (WebFetchTool): the sandbox and WebFetch preapproved domains are **intentionally separate**:

> "SECURITY WARNING: These preapproved domains are ONLY for WebFetch (GET requests only). The sandbox system deliberately does NOT inherit this list for network restrictions, as arbitrary network access (POST, uploads, etc.) to these domains could enable data exfiltration."

This means even if a domain is on the WebFetch whitelist, BashTool commands cannot access it through the sandbox without explicit permission. This prevents a class of attack where a malicious LLM uses shell commands to exfiltrate data to a domain that WebFetch is allowed to access.

---

*Next: [Chapter 7 — Agent & Orchestration Tools — Deep Dive](PartII-The-Tool-System-07-Agent-Orchestration-Tools-Deep-Dive.md)*


\newpage

# Chapter 7: Agent & Orchestration Tools — Deep Dive

> **Part II: The Tool System**

---

## Overview

The orchestration tools are what makes Claude Code genuinely multi-agent. They allow the LLM to spawn child agents, create teams of parallel workers, coordinate work across agents, isolate experiments in git worktrees, and manage complex multi-step workflows. These tools are responsible for Claude Code's ability to tackle tasks that would be too large or complex for a single agent.

---

## AgentTool — Sub-Agent Spawning

AgentTool is the most complex tool in the codebase. Its directory has 15+ files:

```
src/tools/AgentTool/
├── AgentTool.tsx        # Main implementation
├── UI.tsx               # Terminal rendering
├── agentColorManager.ts # Color assignment for agents
├── agentDisplay.ts      # How agent output is displayed
├── agentMemory.ts       # Agent memory scoping
├── agentMemorySnapshot.ts
├── agentToolUtils.ts    # Helper functions
├── built-in/            # Built-in agent definitions
├── builtInAgents.ts     # Registry of built-in agents
├── constants.ts
├── forkSubagent.ts      # Fork-based sub-agent mode
├── loadAgentsDir.ts     # Load agent definitions from disk
├── prompt.ts            # System prompt contribution
├── resumeAgent.ts       # Resume a paused agent
└── runAgent.ts          # Core agent execution loop
```

### Input Schema

```python
from pydantic import BaseModel
from typing import Literal, Optional

class AgentToolInput(BaseModel):
    description: str                          # What this agent should do
    prompt: str                               # The task prompt for the agent
    subagent_type: Optional[str] = None       # Specialization (e.g., 'general-purpose', 'Explore')
    run_in_background: bool = False
    isolation: Optional[Literal['worktree']] = None  # Run in isolated git worktree
```

### How Sub-Agents Are Spawned

When `AgentTool.call()` runs, it:

1. **Creates an agent ID** — a UUID used to track this agent throughout its lifecycle
2. **Selects a model** — via `getAgentModel()` (may differ from the parent's model)
3. **Assembles tools** — via `assembleToolPool()`, filtering by the agent type's allowed tools
4. **Builds system prompt** — sub-agents get a specialized system prompt via `buildEffectiveSystemPrompt()`
5. **Executes** — via `runAgent()` in `runAgent.ts`, which creates a `QueryEngine` for the sub-agent
6. **Returns result** — the sub-agent's final message is returned to the parent

This is the same QueryEngine used by the REPL — sub-agents are not "lite" versions; they are full Claude Code instances running nested inside the parent.

### Agent Memory Scoping (`agentMemory.ts`)

Sub-agents have their own memory scoping. The `AgentMemoryScope` determines where the agent's persistent memory lives:

```python
from typing import Literal
AgentMemoryScope = Literal['user', 'project', 'local']
```

- **`user` scope**: `~/.claude/agent-memory/<agentType>/` — shared across projects
- **`project` scope**: `<cwd>/.claude/agent-memory/<agentType>/` — committed to VCS, shared with team
- **`local` scope**: `<cwd>/.claude/agent-memory-local/<agentType>/` — local only, not committed

This lets different agent types maintain their own knowledge stores that persist across sessions. The "Explore" agent type, for example, can cache its findings about a codebase between sessions.

```python
def get_agent_memory_dir(agent_type: str, scope: AgentMemoryScope) -> str:
    if scope == 'project':
        return join(get_cwd(), '.claude', 'agent-memory', sanitize_agent_type_for_path(agent_type))
    elif scope == 'local':
        return get_local_agent_memory_dir(sanitize_agent_type_for_path(agent_type))
    elif scope == 'user':
        return join(get_memory_base_dir(), 'agent-memory', sanitize_agent_type_for_path(agent_type))
```

### Built-In Agent Types

`built-in/` contains definitions for the default agent types. Each agent has:

```python
from typing import TypedDict, Optional

class AgentDefinition(TypedDict, total=False):
    agentType: str             # Identifier (e.g., 'general-purpose', 'Explore')
    description: str           # Human-readable description
    whenToUse: str             # When to spawn this type
    tools: list[str]           # Tool allowlist (empty = all tools)
    disallowedTools: list[str] # Tool denylist
    memoryScope: AgentMemoryScope
```

The `formatAgentLine()` function (from `prompt.ts`) renders each agent's definition for the system prompt:

```
- general-purpose: General-purpose agent for researching complex questions, searching for code (Tools: All tools)
- Explore: Fast agent for exploring codebases. (Tools: All tools except AgentTool, BashTool, ...)
```

### Background Agents

When `run_in_background: true`, the agent:
- Runs as a `LocalAgentTask` in the task system
- Shows progress via `emitTaskProgress()` 
- Auto-backgrounds after `getAutoBackgroundMs()` (120 seconds by default when enabled)
- Notifies the parent via `enqueueAgentNotification()` when complete

### Worktree Isolation

When `isolation: 'worktree'` is set, `createAgentWorktree()` creates a temporary git worktree for the agent. If the agent makes no changes, the worktree is automatically cleaned up. If it does make changes, the worktree branch is returned so the parent can review and merge.

This is the safe way to let an agent experiment without affecting your working tree.

### Remote Agents

For agents that should run on a remote server (not locally), `checkRemoteAgentEligibility()` and `registerRemoteAgentTask()` handle the remote execution path. This enables true distributed agent execution.

---

## SendMessageTool

`SendMessageTool` enables **inter-agent communication** — passing messages between agents running simultaneously.

**Input schema:**
```python
from pydantic import BaseModel

class SendMessageInput(BaseModel):
    to: str       # Agent ID or agent type name to message
    message: str  # The message content
```

Use cases:
- A coordinator agent broadcasting instructions to worker agents
- A worker agent reporting status back to a parent
- Agents requesting information from a sibling agent

The routing mechanism uses the agent ID system to find the target agent's message queue and deliver the message.

---

## TeamCreateTool & TeamDeleteTool

Teams are groups of agents working together under a coordinator. `TeamCreateTool` spawns a team of agents simultaneously:

**`TeamCreateTool` input:**
```python
from pydantic import BaseModel

class TeammateInput(BaseModel):
    agentType: str
    description: str
    prompt: str

class TeamCreateInput(BaseModel):
    description: str       # What the team is for
    teammates: list[TeammateInput]
```

When a team is created:
1. Each teammate is spawned as an `InProcessTeammateTask`
2. They share access to the same project context
3. The coordinator can send them messages via `SendMessageTool`
4. `TeamDeleteTool` cleans up all agents in the team

Teams are the mechanism behind `COORDINATOR_MODE` — the coordinator creates a team and orchestrates their work.

---

## EnterPlanModeTool & ExitPlanModeTool

Plan mode is a **read-only workflow mode**. When the LLM enters plan mode:

1. All write operations are blocked (no file edits, no shell commands)
2. The LLM can read files, search code, and reason about the problem
3. When it's ready, it uses `ExitPlanModeTool` to present a plan and return to normal mode

**Why this exists**: Complex tasks benefit from a "think first, act second" approach. In plan mode, Claude can thoroughly understand the codebase before making any changes, reducing the chance of mistakes.

The permission mode transitions:
```
default → plan (via EnterPlanModeTool)
plan → default (via ExitPlanModeTool)
```

The original permission mode before entering plan is saved in `toolPermissionContext.prePlanMode` and restored on exit.

`ExitPlanModeV2Tool` is an updated version with a structured output format that includes the plan as a required field, ensuring the LLM always presents a clear plan when exiting.

---

## EnterWorktreeTool & ExitWorktreeTool

Git worktrees allow multiple working trees of the same repository to exist simultaneously. Claude Code uses this for **experiment isolation**:

**Workflow:**
```
1. EnterWorktreeTool — creates a new git worktree at a temp path
2. Agent works in the isolated worktree (different branch)
3. ExitWorktreeTool — either:
   a. Merges changes back to original branch, or
   b. Discards the worktree (if nothing useful was done)
```

From `src/utils/worktree.ts`:
- `createAgentWorktree()` — creates the worktree with a unique branch name
- `hasWorktreeChanges()` — checks if any changes were made
- `removeAgentWorktree()` — cleans up the worktree

This is also how `AgentTool` with `isolation: 'worktree'` works internally.

---

## SleepTool

SleepTool pauses the agent for a specified duration:

**Input schema:**
```python
from pydantic import BaseModel

class SleepInput(BaseModel):
    duration_ms: float
```

Available only when `PROACTIVE` or `KAIROS` feature flags are active. Use cases:
- Waiting for an external process to complete
- Rate limiting repeated polling operations
- Scheduling pauses in long-running autonomous workflows

---

## SyntheticOutputTool

`SyntheticOutputTool` is a special tool that enables **structured output** from agents. When the LLM uses this tool, it provides its final answer in a validated JSON format rather than as free text.

This is used when an SDK caller provides a `jsonSchema` to `QueryEngineConfig`:
- The Query Engine registers structured output enforcement
- The LLM must call `SyntheticOutputTool` with output conforming to the schema
- This guarantees machine-readable, validated output from the agent

The `SYNTHETIC_OUTPUT_TOOL_NAME` constant is referenced throughout the codebase as a sentinel value for structured output mode.

---

## The `src/tools/shared/` Directory

Utilities shared across orchestration tools:

**`spawnMultiAgent.ts`** — the `spawnTeammate()` function used by team spawning:

```python
async def spawn_teammate(
    agent_definition: AgentDefinition,
    prompt: str,
    context: ToolUseContext,
) -> None: ...
```

**`gitOperationTracking.ts`** — `trackGitOperations()` monitors git operations performed by agents:
- Records which files were modified
- Tracks commits made by sub-agents
- Used for conflict detection in team scenarios

---

*Next: [Chapter 8 — Web, MCP, and Integration Tools — Deep Dive](PartII-The-Tool-System-08-Web-MCP-and-Integration-Tools-Deep-Dive.md)*


\newpage

# Chapter 8: Web, MCP, and Integration Tools — Deep Dive

> **Part II: The Tool System**

---

## WebFetchTool

WebFetchTool fetches content from URLs. It is **read-only** (GET requests only) and has a sophisticated domain security model.

**Input schema:**
```python
from pydantic import BaseModel
from typing import Optional

class WebFetchInput(BaseModel):
    url: str
    prompt: Optional[str] = None  # Extract specific info from the page
```

### Pre-Approved Domains

`src/tools/WebFetchTool/preapproved.ts` defines `PREAPPROVED_HOSTS` — a large set of domains that can be fetched without requiring explicit user permission. This list covers:

- **Anthropic**: `platform.claude.com`, `code.claude.com`, `modelcontextprotocol.io`
- **Language docs**: `docs.python.org`, `developer.mozilla.org`, `go.dev`, `doc.rust-lang.org`, `kotlinlang.org`
- **Framework docs**: `react.dev`, `nextjs.org`, `vuejs.org`, `docs.djangoproject.com`
- **Cloud providers**: `docs.aws.amazon.com`, `cloud.google.com`, `kubernetes.io`
- **Package registries**: `pypi.org`, `npmjs.com`, `crates.io`, `pkg.go.dev`
- **Version control**: `github.com`, `gitlab.com`, `docs.github.com`
- **Databases**: `www.postgresql.org`, `redis.io`, `mongodb.com`

URLs not on this list require user permission, consistent with the general permission model.

**Security boundary**: The pre-approved list applies **only to GET requests in WebFetchTool**. BashTool commands cannot use this list to make network requests — the sandbox system is entirely separate. This prevents data exfiltration through shell commands to "trusted" domains.

### Content Processing

When fetching HTML pages, `utils.ts` converts HTML to readable text:
- Strips HTML tags
- Extracts visible text content
- Handles common encodings
- Returns a size-limited excerpt (context window budget)

### Permission Model

- Pre-approved domains: auto-approved
- Other domains: user prompted once, can be added to always-allow rules

---

## WebSearchTool

WebSearchTool performs web searches and returns summarized results.

**Input schema:**
```python
from pydantic import BaseModel

class WebSearchInput(BaseModel):
    query: str
```

The search results are formatted as a list of title + URL + snippet entries, suitable for the LLM to parse and decide which URLs to fetch with WebFetchTool.

---

## MCPTool — Invoking MCP Server Tools

When Claude Code has connected MCP servers, `MCPTool` is the mechanism for calling their tools.

```
src/tools/MCPTool/
├── MCPTool.ts
├── UI.tsx
├── classifyForCollapse.ts   ← Which MCP tools should collapse in UI
└── prompt.ts
```

**Input schema:**
```python
from pydantic import BaseModel

class MCPToolInput(BaseModel):
    server_name: str   # Name of the MCP server
    tool_name: str     # Tool to call on that server
    arguments: dict    # Tool-specific arguments (dynamic schema)
```

### The Collapse Classification System (`classifyForCollapse.ts`)

MCP tool results can be large. The collapse classifier determines whether to show or hide the result by default in the terminal UI.

The classifier maintains explicit allowlists for well-known MCP servers:

**Search tools** (collapsed with "searched X"):
```python
SEARCH_TOOLS = {
    # Slack
    'slack_search_public', 'slack_search_channels', 'slack_search_users',
    # GitHub
    'search_code', 'search_repositories', 'search_issues',
    # Linear
    'search_documentation',
    # Datadog
    'search_logs', 'search_spans', 'find_slow_spans',
    # Sentry
    'search_events', 'find_organizations', 'find_projects',
    # Notion
    'search',
    # Gmail
    'gmail_search_messages',
    # ... more
}
```

**Read tools** (collapsed with "read X"):
- Calendar: `google_calendar_list_events`
- Drive: `google_drive_list_files`, `google_drive_get_file`
- Slack: `slack_list_channels`, `slack_get_messages`
- Linear: `list_issues`, `get_issue`, `list_projects`
- Sentry: `get_issue`, `get_error_details`
- GitHub: `get_file_contents`, `list_pull_requests`, `get_commit`

**Write tools** (never collapsed — always visible):
- `send_message`, `create_*`, `update_*`, `delete_*`, `post_*`

Unknown tools are **not collapsed** (conservative default) — better to show too much than to hide important output.

---

## ListMcpResourcesTool & ReadMcpResourceTool

MCP servers can expose "resources" in addition to tools. Resources are file-like objects (documents, database records, etc.) that can be listed and read.

**`ListMcpResourcesTool`** — lists available resources:
```python
from pydantic import BaseModel

class ListMcpResourcesInput(BaseModel):
    server_name: str
```
Returns a list of resource URIs and descriptions.

**`ReadMcpResourceTool`** — reads a specific resource:
```python
from pydantic import BaseModel

class ReadMcpResourceInput(BaseModel):
    server_name: str
    uri: str  # Resource URI from ListMcpResourcesTool
```
Returns the resource content (text, JSON, binary, etc.).

---

## McpAuthTool

Handles authentication flows for MCP servers that require auth:

```python
from pydantic import BaseModel
from typing import Literal

class McpAuthInput(BaseModel):
    server_name: str
    action: Literal['authenticate', 'status', 'logout']
```

The authentication flow:
1. `authenticate` — initiates OAuth or other auth flow for the server
2. Opens browser for user to complete auth
3. Stores token in the credential store
4. `status` — checks current auth state
5. `logout` — revokes stored credentials

---

## ToolSearchTool — Deferred Tool Discovery

This tool solves a context window efficiency problem: Claude Code has dozens of tools, but not all of them need to be in the system prompt at all times. Some tools (especially from MCP servers) are loaded "lazily" and need to be discovered on demand.

```python
from pydantic import BaseModel

class ToolSearchInput(BaseModel):
    query: str        # Keywords describing what you need
    max_results: int = 5
```

The `ToolSearchTool` searches the deferred tool registry by query and returns the **full JSON schema** of matching tools. Once the LLM has seen a tool's schema, it can call it directly.

From `constants.ts` in the ToolSearchTool:
- Deferred tools appear as names-only in the system prompt (`<system-reminder>`)
- Until fetched with ToolSearchTool, only the name is known — the tool cannot be invoked
- After fetching, the tool's full schema is available in the conversation

This pattern keeps the system prompt lean while still providing access to the full tool library.

---

## LSPTool — Language Server Protocol

LSPTool integrates with Language Server Protocol (LSP) servers to provide IDE-grade code intelligence.

**Input schema:**
```python
from pydantic import BaseModel
from typing import Literal, Optional

class LSPToolInput(BaseModel):
    operation: Literal[
        'diagnostics',    # Get errors/warnings for a file
        'hover',          # Type info at a position
        'definition',     # Go-to-definition
        'references',     # Find all references
        'completion',     # Code completions
        'rename',         # Rename symbol
    ]
    file_path: str
    line: Optional[int] = None
    character: Optional[int] = None
    new_name: Optional[str] = None  # For rename
```

The LSP service (`src/services/lsp/`) manages language server connections. When `FileEditTool` edits a file, it calls `clearDeliveredDiagnosticsForFile()` to invalidate stale diagnostics — the next `LSPTool` call will fetch fresh ones.

---

## SkillTool — Skill Execution

SkillTool invokes a registered skill by name:

```python
from pydantic import BaseModel
from typing import Optional

class SkillToolInput(BaseModel):
    skill: str                  # Skill name or "plugin:skill" for namespaced skills
    args: Optional[str] = None
```

When SkillTool runs, it:
1. Looks up the skill in the registry
2. Expands the skill's SKILL.md content into a full prompt
3. Injects the prompt into the conversation
4. The turn continues with the skill's instructions active

This is how `/commit`, `/simplify`, and other skills work when invoked via the `SkillTool`.

---

## ScheduleCronTool (CronCreateTool / CronDeleteTool / CronListTool)

The cron tools create, delete, and list scheduled agent triggers. Available when the `AGENT_TRIGGERS` feature flag is active.

**`CronCreateTool`:**
```python
from pydantic import BaseModel

class CronCreateInput(BaseModel):
    schedule: str      # Cron expression (e.g., "0 9 * * 1-5")
    prompt: str        # What the agent should do when triggered
    description: str   # Human-readable description
```

Cron jobs are persisted and will trigger new agent sessions on their schedule.

**`CronDeleteTool`** and **`CronListTool`** manage existing crons.

---

## RemoteTriggerTool

Available when `AGENT_TRIGGERS_REMOTE` is active. Triggers an agent on a remote server:

```python
from pydantic import BaseModel

class RemoteTriggerInput(BaseModel):
    trigger_id: str
    payload: dict
```

Remote triggers differ from crons (which are time-based) — they are event-based triggers that fire when explicitly called.

---

## AskUserQuestionTool

Allows the LLM to ask the user a clarifying question mid-turn:

```python
from pydantic import BaseModel
from typing import Optional

class AskUserQuestionInput(BaseModel):
    question: str
    options: Optional[list[str]] = None  # Multiple choice options
```

Rather than the normal REPL interaction (where the user types at the prompt), `AskUserQuestionTool` inserts a blocking question into the current turn. The turn pauses until the user responds.

**When to use**: The LLM should use this when it genuinely cannot proceed without additional information. The system prompt instructs the LLM to prefer making reasonable assumptions over excessive questioning.

---

## BriefTool

Generates a brief/summary of the current conversation or a piece of work:

```python
from pydantic import BaseModel
from typing import Optional

class BriefInput(BaseModel):
    content: Optional[str] = None  # Content to summarize, or summarize conversation
```

Available when `KAIROS` or `KAIROS_BRIEF` feature flags are active.

---

## ConfigTool — Runtime Configuration

ConfigTool reads and writes Claude Code settings from within a session:

```python
from pydantic import BaseModel
from typing import Any, Literal, Optional

class ConfigToolInput(BaseModel):
    action: Literal['read', 'write']
    key: str
    value: Optional[Any] = None  # For write
```

Settings written via ConfigTool take effect immediately in the current session. This is how the `/config` command's "set" functionality works internally.

---

## Summary: Tool Selection Guide

| Need | Tool |
|------|------|
| Fetch documentation | WebFetchTool (check preapproved domains) |
| Search the web | WebSearchTool |
| Call a connected service (Slack, GitHub, Linear...) | MCPTool |
| Find available integrations | ToolSearchTool |
| Check TypeScript types / errors | LSPTool with `diagnostics` |
| Run a saved workflow | SkillTool |
| Ask user for input | AskUserQuestionTool |
| Schedule recurring work | ScheduleCronTool |

---

*Next: [Chapter 9 — Command Architecture & Complete Command Reference](PartIII-The-Command-System-09-Command-Architecture-Complete-Command-Reference.md)*


\newpage


# Part III: The Command System

# Chapter 9: Command Architecture & Complete Command Reference

> **Part III: The Command System**

---

## Commands vs Tools

Before diving in, understand the fundamental distinction:

| | Tools | Commands |
|--|-------|---------|
| **Who invokes** | The LLM | The user (via `/name`) |
| **How invoked** | `tool_use` blocks in API response | Typed in REPL as `/command-name` |
| **Purpose** | Give the LLM capabilities | Give the user capabilities |
| **Examples** | `BashTool`, `FileEditTool`, `WebFetchTool` | `/commit`, `/model`, `/doctor` |

Commands are the **user's interface** to Claude Code. They do not go through the LLM tool loop. They either inject a prompt directly, run local logic, or render UI.

---

## Command Architecture

### Registration: `src/commands.ts` (758 lines)

`commands.ts` imports all command modules and exports `getCommands()` — the function that assembles the full command list. Like `tools.ts`, it uses feature flags for conditional loading:

```python
import importlib

# Feature-gated commands:
voice_command = (
    importlib.import_module('.commands.voice').default
    if feature('VOICE_MODE') else None
)

bridge = (
    importlib.import_module('.commands.bridge').default
    if feature('BRIDGE_MODE') else None
)

buddy = (
    importlib.import_module('.commands.buddy').default
    if feature('BUDDY') else None
)
```

And Anthropic-internal commands:
```python
import os
import importlib

agents_platform = (
    importlib.import_module('.commands.agents_platform').default
    if os.environ.get('USER_TYPE') == 'ant' else None
)
```

Commands also come from **skills** and **plugins**:
```python
# Commands from skill directories:
skill_dir_commands = get_skill_dir_commands()

# Commands from bundled skills:
bundled_skill_commands = get_bundled_skills()

# Commands from installed plugins:
plugin_commands = get_plugin_commands()
```

This means any skill (in `~/.claude/skills/` or a project's `.claude/skills/`) automatically becomes a slash command.

### The Three Command Types

```python
from typing import Union

Command = Union[
    PromptCommand,      # Calls LLM with a formatted prompt
    LocalCommand,       # Runs in-process, returns text
    LocalJSXCommand,    # Runs in-process, returns UI component
]
```

**`PromptCommand`** — the most common type:
```python
from dataclasses import dataclass
from typing import Any

@dataclass
class CommitCommand:
    type: str = 'prompt'
    name: str = 'commit'
    description: str = 'Create a git commit with an AI-generated message'
    progress_message: str = 'generating commit message'
    allowed_tools: list[str] = None  # ['Bash(git *)']
    source: str = 'builtin'

    async def get_prompt_for_command(self, args: Any, context: Any) -> list[dict]:
        return [{'type': 'text', 'text': '...'}]  # list[ContentBlockParam]
```
When invoked, the `getPromptForCommand()` result is sent to the LLM as a user message. The LLM responds with text and optionally uses the `allowedTools`.

**`LocalCommand`** — runs synchronously, no LLM:
```python
from dataclasses import dataclass
from typing import Any

@dataclass
class CostCommand:
    type: str = 'local'
    name: str = 'cost'
    description: str = 'Display token usage and estimated cost'
    source: str = 'builtin'

    async def call(self, args: Any, context: Any) -> dict:
        return {'type': 'text', 'text': format_cost_summary()}
```

**`LocalJSXCommand`** — renders a UI component:
```python
from dataclasses import dataclass
from typing import Any, Callable

@dataclass
class DoctorCommand:
    type: str = 'local-jsx'
    name: str = 'doctor'
    description: str = 'Run environment diagnostics'
    source: str = 'builtin'

    async def call(self, args: Any, set_tool_jsx: Callable, context: Any):
        return DoctorScreen()  # UI component rendered to the terminal
```

---

## Complete Command Reference

There are **102 command files/directories** in `src/commands/`. Here is a complete reference, grouped by category.

---

### Git & Version Control

**`/commit`** (PromptCommand, `commit.ts`)
Generates a git commit message from staged changes using the LLM, then runs `git commit`. Uses `Bash(git *)` tool. The commit message follows the repository's existing style.

**`/commit-push-pr`** (PromptCommand, `commit-push-pr.ts`)
Combines `/commit` + `git push` + GitHub PR creation in one step. Requires `gh` CLI.

**`/branch`** (directory)
Create or switch git branches. Asks the LLM to suggest an appropriate branch name based on the task.

**`/diff`** (directory)
View staged/unstaged changes or compare against a ref. Supports filtering by file pattern.

**`/pr_comments`** (directory)
Fetch and display PR review comments from GitHub. Can optionally address them automatically.

**`/rewind`** (directory)
Revert to a previous git state. Shows a list of recent commits to choose from.

---

### Code Quality

**`/review`** (PromptCommand, `review.ts`)
AI-powered code review of staged or unstaged changes. Checks for bugs, security issues, style inconsistencies, and missing tests. Can be run with specific focus areas as arguments.

**`/security-review`** (PromptCommand, `security-review.ts`)
Security-focused code review. Looks specifically for OWASP top 10 vulnerabilities, injection risks, authentication issues, and data exposure.

**`/advisor`** (PromptCommand, `advisor.ts`)
Architectural advice and design feedback. Use for high-level decisions: "should I use Redis or Postgres for this?", "how should I structure this service?"

**`/bughunter`** (PromptCommand, `bughunter/`)
Autonomously searches for potential bugs in the codebase. Uses a systematic approach to check edge cases, error handling, and common bug patterns.

---

### Session & Context Management

**`/compact`** (LocalJSXCommand, `compact/`) — **Important**
Manually triggers conversation compaction. Useful when approaching context limits or wanting to clean up a long conversation while preserving key facts.

Options:
- `/compact` — standard compaction (summarizes all but the most recent messages)
- `/compact [instruction]` — with custom instructions: "keep all code snippets", "focus on the authentication changes"

**`/context`** (LocalJSXCommand, `context/`)
Visualizes the current context: which CLAUDE.md files are loaded, how many tokens are used, what files are in context.

**`/resume`** (LocalJSXCommand, `resume/`)
Shows a list of previous conversation sessions to restore. Restores the full conversation history.

**`/session`** (directory)
Session management: list all sessions, switch between them, delete old sessions, rename the current session.

**`/share`** (directory)
Share the current conversation via a link (requires claude.ai subscription).

**`/export`** (directory)
Export the conversation to a markdown or JSON file.

**`/summary`** (directory)
Generate an AI-written summary of the current session.

**`/clear`** (directory)
Clear the conversation history without ending the session. Starts fresh with a clean context.

---

### Configuration & Settings

**`/config`** (LocalJSXCommand, `config/`) — **Important**
Opens the full configuration UI. Browse and edit all settings interactively:
- Model selection
- Permission modes
- Theme and appearance
- Privacy settings
- MCP server configuration

```
/config                 # Open config UI
/config set key value   # Set a specific value
/config get key         # Read a specific value
```

**`/permissions`** (LocalJSXCommand, `permissions/`) — **Important**
Manage permission rules. The interactive UI shows all current rules (always-allow, always-deny, always-ask) and lets you add, edit, or remove them.

```
/permissions           # Open permissions UI
/permissions list      # List all rules
/permissions add "Bash(git *)" allow   # Add an allow rule
```

**`/model`** (LocalJSXCommand, `model/`) — **Important**
Switch the active model interactively. Shows available models with context window sizes and pricing. Can also be set non-interactively:

```
/model                        # Open model selector
/model claude-opus-4-6        # Switch directly
/model claude-sonnet-4-6      # Switch to Sonnet
```

**`/theme`** (directory)
Change the terminal color theme. Options include light, dark, and various named themes.

**`/vim`** (directory)
Toggle vim mode for REPL input. In vim mode, the input field supports Normal, Insert, and Visual modes.

**`/effort`** (directory)
Adjust the response effort level. Higher effort = more thorough (and slower, more expensive) responses. Lower effort = faster, more concise responses.

**`/fast`** (directory)
Toggle fast mode. Enables more concise responses optimized for speed over thoroughness.

**`/keybindings`** (directory)
View and customize keyboard shortcuts. Opens the keybindings editor.

**`/output-style`** (directory)
Change how responses are formatted: concise, detailed, technical, etc.

**`/privacy-settings`** (directory)
Manage data privacy settings: telemetry, conversation logging, feedback sharing.

---

### Memory & Knowledge

**`/memory`** (directory) — **Important**
Manage the persistent memory system. CLAUDE.md files are Claude Code's long-term memory:

```
/memory                  # Open memory manager UI
/memory add              # Add a new memory
/memory edit             # Edit existing memories
/memory show             # Show current CLAUDE.md contents
```

The memory system has three tiers:
1. `~/.claude/CLAUDE.md` — user-level, applies everywhere
2. `.claude/CLAUDE.md` — project-level, committed to VCS
3. `.claude/settings.local.json` — local overrides, not committed

**`/add-dir`** (directory)
Add additional directories to the project context. Useful for monorepos where Claude Code should be aware of sibling projects.

**`/files`** (directory)
List files currently in context. Shows which files Claude Code has read and is tracking.

---

### MCP & Plugins

**`/mcp`** (LocalJSXCommand, `mcp/`) — **Important**
Comprehensive MCP server management:

```
/mcp                     # Open MCP dashboard
/mcp list                # List connected servers
/mcp add <name> <cmd>    # Add a stdio server
/mcp add-json <config>   # Add from JSON config
/mcp remove <name>       # Remove a server
/mcp status              # Check connection status
/mcp restart <name>      # Restart a server
```

The dashboard shows:
- Connected/disconnected servers
- Available tools from each server
- Authentication status
- Error messages

**`/plugin`** (directory)
Install, remove, and manage plugins:

```
/plugin install <name>   # Install from marketplace
/plugin list             # List installed plugins
/plugin remove <name>    # Uninstall
/plugin info <name>      # Show plugin details
```

**`/reload-plugins`** (directory)
Reload all plugins without restarting Claude Code. Use after updating plugin code.

**`/skills`** (directory)
View and manage skills:

```
/skills                  # List all available skills
/skills show <name>      # Show a skill's SKILL.md
```

---

### Authentication

**`/login`** (directory)
Authenticate with Anthropic. Opens browser for OAuth flow.

**`/logout`** (directory)
Sign out and clear stored credentials.

**`/oauth-refresh`** (directory)
Manually refresh OAuth tokens (usually automatic).

---

### Tasks & Agents

**`/tasks`** (LocalJSXCommand, `tasks/`) — **Important**
Manage background tasks:

```
/tasks                   # Open task manager UI
/tasks list              # List running/completed tasks
/tasks stop <id>         # Stop a running task
/tasks output <id>       # View task output
```

Shows both shell tasks (`run_in_background: true` bash commands) and agent tasks (background sub-agents).

**`/agents`** (directory)
Manage sub-agents: view running agents, check their status, send messages.

**`/plan`** (directory)
Enter planning mode (same as `EnterPlanModeTool` but user-initiated):

```
/plan                    # Enter plan mode
```

In plan mode, Claude Code will research and plan before executing.

**`/ultraplan`** (PromptCommand, `ultraplan.tsx`, feature flag `ULTRAPLAN`)
Generate a highly detailed execution plan before starting work. More thorough than `/plan`.

---

### Diagnostics & Status

**`/doctor`** (LocalJSXCommand, `doctor/`)
Runs a comprehensive environment diagnostic:
- API connectivity
- Authentication status
- Tool availability (ripgrep, git, etc.)
- MCP server connections
- File system permissions
- Node.js/Bun version

**`/status`** (directory)
Shows current session status: model, conversation turn count, token usage, permission mode.

**`/stats`** (directory)
Detailed session statistics: response times, token counts per turn, cost breakdown.

**`/cost`** (LocalCommand, `cost/`)
Displays cumulative token usage and estimated cost for the current session.

**`/version`** (LocalCommand, `version.ts`)
Shows Claude Code version string.

---

### Installation & Setup

**`/install`** (LocalJSXCommand, `install.tsx`)
Install or update Claude Code. Shows current version and available updates.

**`/upgrade`** (directory)
Upgrade to the latest version.

**`/init`** (LocalCommand, `init.ts`)
Initialize a project: creates `CLAUDE.md` with discovered project information (stack, conventions, etc.).

**`/onboarding`** (directory)
Runs the first-time setup wizard for new users.

**`/terminalSetup`** (directory)
Configure terminal-specific features (font, color support, mouse support).

---

### IDE & Desktop Integration

**`/bridge`** (directory, feature flag `BRIDGE_MODE`)
Manage IDE bridge connections. Shows connection status, allows reconnection.

**`/ide`** (directory)
Open current project in VS Code or the configured IDE.

**`/desktop`** (directory)
Hand off the session to the Claude Code desktop app.

**`/mobile`** (directory)
Hand off to the mobile app.

**`/teleport`** (directory)
Transfer the current session to another machine or device.

---

### Miscellaneous

**`/help`** (directory)
Shows help and lists all available commands.

**`/exit`** (directory)
Exit Claude Code gracefully.

**`/copy`** (directory)
Copy the last response to clipboard.

**`/feedback`** (directory)
Send feedback to Anthropic.

**`/release-notes`** (directory)
View the changelog for the current version.

**`/voice`** (directory, feature flag `VOICE_MODE`)
Toggle voice input mode. When active, speech is transcribed to text.

**`/x402`** (directory)
x402 payment protocol integration. Handles micropayment flows for premium features.

**`/stickers`** (Easter egg)
Displays ASCII art stickers. 🎉

**`/good-claude`** (Easter egg)
Praise Claude. Returns a positive response.

---

### Debug & Internal Commands

These commands are primarily for debugging and Anthropic-internal use:

| Command | Purpose |
|---------|---------|
| `/ant-trace` | Anthropic-internal tracing |
| `/ctx_viz` | Context visualization debug view |
| `/debug-tool-call` | Replay/debug a specific tool call |
| `/heapdump` | Heap dump for memory analysis |
| `/mock-limits` | Mock rate limits for testing |
| `/reset-limits` | Reset rate limit counters |
| `/break-cache` | Invalidate caches |
| `/perf-issue` | Report a performance issue |
| `/btw` | "By the way" interjection — inject a message mid-stream |
| `/thinkback` | Replay Claude's thinking process |
| `/thinkback-play` | Animated thinking replay |
| `/hooks` | Manage hook scripts |

---

## How Commands Are Displayed in the REPL

The help system (`/help`) categorizes commands and shows descriptions. Commands from skills show up with their `description` field from `SKILL.md`. Plugin commands show up with the plugin's name as prefix.

Tab completion in the REPL prefix-matches command names. Type `/co` and see `/commit`, `/compact`, `/config`, `/context`, `/copy`, `/cost`, `/color`.

---

*Next: [Chapter 10 — Ink — React for the Terminal](PartIV-The-UI-Layer-10-Ink-React-for-the-Terminal.md)*


\newpage


# Part IV: The UI Layer

# Chapter 10: Ink — React for the Terminal

> **Part IV: The UI Layer**

---

## Overview

Claude Code renders its terminal UI using **React + Ink** — a framework that mounts React component trees to the terminal instead of the browser DOM. Rather than using ncurses, blessed, or raw terminal codes, every UI element is a React component. This is not a thin wrapper: the codebase contains a full custom Ink implementation in `src/ink/` (~40 files).

The primary advantage: the entire Claude Code UI is written using the same React patterns as a web app — components, hooks, context, concurrent rendering. The terminal is just the target renderer.

---

## Entry Points

| File | Role |
|------|------|
| `src/ink.ts` | Public API: re-exports `render()` / `createRoot()`, wraps every tree with `ThemeProvider` |
| `src/ink/root.ts` | Manages `Ink` class instances, keyed by stdout stream |
| `src/ink/ink.tsx` | Core `Ink` class — owns the React root, terminal I/O, layout, frame output |
| `src/ink/reconciler.ts` | React reconciler mapping React elements → `DOMElement`/`TextNode` |
| `src/ink/dom.ts` | Terminal "DOM" nodes; each element owns a Yoga layout node |
| `src/ink/renderer.ts` | Converts the laid-out DOM tree into a 2-D screen buffer |
| `src/ink/render-node-to-output.ts` | Walks the DOM and paints styled text into an `Output` grid |
| `src/ink/log-update.ts` | Diffs new frame against previous, writes minimal ANSI sequences |

---

## The Full Render Pipeline

```
Your React Component
         │
         ▼
src/ink.ts :: render(node)
  └─ Wraps with ThemeProvider
  └─ await Promise.resolve()  (microtask boundary for async startup)
  └─ calls inkRender()
         │
         ▼
src/ink/root.ts :: renderSync(node, opts)
  └─ Creates or reuses an Ink instance keyed by stdout stream
  └─ Registers instance in global instances Map
         │
         ▼
src/ink/ink.tsx :: Ink#render(node)
  └─ Calls React reconciler: updateContainerSync()
         │
         ▼
src/ink/reconciler.ts  (react-reconciler v0.31 host config)
  ├─ createInstance()     → createNode()       (DOMElement + Yoga node)
  ├─ createTextInstance() → createTextNode()   (TextNode, no Yoga)
  ├─ appendChild / insertBefore / removeChild  (mirrors into Yoga tree)
  └─ resetAfterCommit()  → triggers layout + render
         │
         ▼
src/ink/dom.ts  (Virtual DOM)
  ├─ DOMElement  { nodeName, attributes, childNodes, style, yogaNode }
  └─ TextNode    { '#text', nodeValue }
         │
         ▼
src/native-ts/yoga-layout/ (Yoga flexbox, pure TS — no WASM)
  └─ calculateLayout() → computes x/y/width/height for every DOMElement
         │
         ▼
src/ink/renderer.ts :: createRenderer()(frameOptions)
  ├─ Validates computed dimensions
  ├─ Builds Output screen buffer (2-D character grid)
  └─ Calls renderNodeToOutput() to paint each node
         │
         ▼
src/ink/render-node-to-output.ts
  └─ Recursively walks DOMElement tree
  └─ Applies text styles via chalk (colors, bold, italic, etc.)
         │
         ▼
src/ink/log-update.ts :: LogUpdate#render(frame)
  └─ Diffs new frame against prevFrame (character-cell granularity)
  └─ Writes minimal ANSI cursor-move + text sequences to stdout
         └─ Only changed cells are rewritten (incremental blit)
```

This is the critical architectural insight: **only changed terminal cells are rewritten on each render**. React's virtual DOM diffing determines which components changed; Yoga calculates new positions; the log-update module writes only the minimum ANSI escape sequences to update the screen.

---

## Custom React Reconciler (`reconciler.ts`)

Claude Code uses React's `react-reconciler` package with a custom host configuration. This is the same mechanism used by React Native (which renders to native views) and React Three Fiber (which renders to WebGL scenes).

The host config implements:

| Method | What it does |
|--------|-------------|
| `createInstance(type, props)` | Creates a `DOMElement` with a Yoga layout node |
| `createTextInstance(text)` | Creates a `TextNode` (no Yoga layout) |
| `appendChildToContainer(container, child)` | Attaches child to parent's DOM |
| `insertBefore(parent, child, before)` | Ordered insertion |
| `removeChild(parent, child)` | Removes from DOM and Yoga tree |
| `commitUpdate(instance, updatePayload)` | Updates element properties |
| `resetAfterCommit(container)` | Called after every React commit → triggers layout |

The `resetAfterCommit` hook is where the Yoga layout calculation and re-render are triggered. Every time React commits a state change (a hook fires, context updates, etc.), the entire layout is recalculated and the screen is redrawn.

---

## The Virtual DOM (`dom.ts`)

The terminal DOM has two node types:

**`DOMElement`**:
```python
from typing import TypedDict, Union, Optional

class DOMElement(TypedDict, total=False):
    node_name: ElementName               # 'ink-box', 'ink-text', etc.
    attributes: dict[str, object]        # Style props, event handlers
    child_nodes: list[Union['DOMElement', 'TextNode']]
    style: Styles                        # Flexbox + text styles
    yoga_node: Optional[YogaNode]        # Yoga layout node
    # ... internal rendering state
```

**`TextNode`**:
```python
from typing import TypedDict, Literal

class TextNode(TypedDict):
    node_name: Literal['#text']
    node_value: str
    # No Yoga node — text nodes don't participate in layout
```

---

## Custom JSX Host Elements

Ink registers six custom React host elements:

| JSX Element | Component | Purpose |
|-------------|-----------|---------|
| `ink-root` | Root container | Owns the `FocusManager` |
| `ink-box` | `<Box>` | Flexbox layout container |
| `ink-text` | `<Text>` | Leaf text node |
| `ink-virtual-text` | Inline text | No Yoga layout (inline only) |
| `ink-link` | `<Link>` | OSC 8 hyperlink escape sequence |
| `ink-progress` | Progress bar | Primitive progress indicator |
| `ink-raw-ansi` | Raw ANSI | Pre-rendered ANSI string (bypasses text measurement) |

`global.d.ts` declares these in the JSX namespace so TypeScript accepts them as valid JSX elements.

---

## Layout Engine — Yoga (Native TypeScript)

Yoga is Facebook's implementation of the CSS Flexbox layout algorithm for native UI. It is used by React Native for mobile layout and by Claude Code for terminal layout.

**Critical implementation detail**: Claude Code uses a **native TypeScript port** of Yoga (`src/native-ts/yoga-layout/`) rather than the WebAssembly build. This eliminates WASM loading latency (~20-50ms) from startup and removes the WASM parsing overhead.

Yoga properties available in Ink components correspond directly to CSS Flexbox:

| Yoga Property | CSS Equivalent |
|--------------|---------------|
| `flexDirection` | `flex-direction` |
| `alignItems` | `align-items` |
| `justifyContent` | `justify-content` |
| `flexWrap` | `flex-wrap` |
| `flexGrow` | `flex-grow` |
| `flexShrink` | `flex-shrink` |
| `padding` | `padding` |
| `margin` | `margin` |
| `width` / `height` | `width` / `height` |
| `minWidth` / `maxWidth` | `min-width` / `max-width` |
| `position` | `position` (relative/absolute) |

---

## Terminal I/O (`src/ink/termio/`)

The `termio/` directory handles parsing terminal escape sequences from stdin (keyboard input, mouse events, terminal queries):

**`tokenize.ts`** and **`parser.ts`**: Parse the raw byte stream from stdin into structured events. Terminal escape sequences are multi-byte sequences starting with `\x1b` (ESC).

**`ansi.ts`**: Constants for ANSI control characters. Defines the escape sequences for cursor movement, screen clearing, and color codes.

**`csi.ts`** (Control Sequence Introducer): Parses sequences starting with `\x1b[`. This covers cursor movement (`\x1b[A` = up), color codes (`\x1b[31m` = red), and mouse events.

**`sgr.ts`** (Select Graphic Rendition): Parses `\x1b[<n>m` sequences that control text appearance: bold, italic, underline, foreground/background colors, 256-color, truecolor RGB.

**`osc.ts`** (Operating System Commands): Handles `\x1b]` sequences. Used for terminal title setting and hyperlinks (OSC 8: `\x1b]8;;url\x1b\\text\x1b]8;;\x1b\\`).

**`dec.ts`** (DEC terminal sequences): Private mode sequences like `\x1b[?1049h` (alternate screen) and `\x1b[?25l` (hide cursor). The `SHOW_CURSOR` constant is imported in `main.tsx` to restore cursor visibility on exit.

**`esc.ts`**: Simple escape sequences (not CSI or OSC).

---

## Events System (`src/ink/events/`)

Terminal events are dispatched through `emitter.ts` and `dispatcher.ts`:

**`keyboard-event.ts`**: Defines `KeyboardEvent` with properties like `key`, `ctrl`, `meta`, `shift`. The `useInput` hook listens to these events.

**`click-event.ts`**: Mouse click events (requires terminal mouse support). Contains X/Y coordinates.

**`focus-event.ts`**: Focus gain/loss events for interactive elements.

The `FocusManager` (owned by the `ink-root` element) tracks which element has keyboard focus and routes `KeyboardEvent` to the focused element's handler.

---

## Components (`src/ink/components/`)

Base Ink primitives (the lowest layer of the component hierarchy):

**`Box`**: The flexbox container. Every layout in Claude Code is built from nested `Box` elements. Props map directly to Yoga layout properties.

**`Text`**: Text rendering with style props: `color`, `backgroundColor`, `bold`, `italic`, `underline`, `strikethrough`, `dimColor`, `inverse`, `wrap`.

**`ScrollBox`**: A scrollable container. Manages scroll offset state and renders only visible lines, handling large content (like long conversation histories) efficiently.

**`Button`**: Interactive button with focus support, keyboard activation (Enter/Space).

**`Link`**: Renders text as a clickable hyperlink using OSC 8 escape sequences. Only visible in terminals that support OSC 8 (iTerm2, Kitty, Wezterm, etc.).

---

## Hooks (`src/ink/hooks/`)

**`useInput(handler, options)`**: The primary keyboard input hook. Registers a handler called for each key press:
```python
def handle_input(input: str, key: KeyboardEvent) -> None:
    if key.ctrl and input == 'c':
        pass  # handle Ctrl+C
    if key.return_:
        pass  # handle Enter

use_input(handle_input)
```

**`useStdin()`**: Access to raw stdin. Returns `{ stdin, setRawMode, isRawModeSupported }`.

**`useAnimationFrame()`**: Called on each terminal render frame. Used for spinner animations and other timed UI updates.

**`useSelection()`**: Manages selection state (highlight ranges) in text display.

---

## Performance Optimizations

### `optimizer.ts`
Before re-rendering, the optimizer checks if the virtual DOM subtree actually changed. Subtrees with no prop changes can be skipped entirely.

### `node-cache.ts`
`DOMElement` nodes are cached. When React commits an update to an element whose type and key haven't changed, the existing node is reused rather than recreated. This avoids unnecessary Yoga node reconstruction.

### `line-width-cache.ts`
Calculating the display width of a string is expensive for Unicode (some characters are "wide" — 2 columns, some are "narrow" — 1 column, emoji are usually 2). `line-width-cache.ts` caches these measurements so each string is only measured once.

### Incremental Blit
`log-update.ts` diffs the new screen frame against the previous frame. Only cells that changed are rewritten. For a typical Claude Code update (a few new lines streamed in at the bottom), this means writing only those new lines — not the entire terminal screen.

---

## Key Design Decisions (from `ARCHITECTURE.md`)

1. **ThemeProvider injection** — `src/ink.ts` wraps every render call so `ThemedBox`/`ThemedText` components have theme context without requiring manual mounting at each call site.

2. **Instance cache by stdout** — The `instances` Map lets external code (the IDE bridge) look up and pause/resume the correct Ink instance.

3. **Microtask boundary** — `render()` and `createRoot()` both `await Promise.resolve()` before the first render so async startup work (hook state, REPL bridge) settles before the initial paint.

4. **Yoga without WASM** — The native TypeScript Yoga port eliminates WASM loading latency from startup.

5. **Reconciler-driven layout** — `resetAfterCommit()` triggers Yoga layout recalculation after every React commit, keeping layout and React in sync.

---

## Component Layers

```
src/ink/components/              ← Base Ink primitives (Box, Text, ScrollBox, ...)
           │
           ▼
src/components/design-system/   ← Themed wrappers (ThemedBox, ThemedText, ThemeProvider)
           │
           ▼
src/components/                  ← ~140 Claude Code application components
           │
           ▼
src/screens/                     ← Top-level screen components (REPL, Doctor, ...)
```

Application components import `{ Box, Text }` from `src/ink.ts`, which re-exports the themed versions. Lower-level code can import `{ BaseBox, BaseText }` to bypass theming.

---

*Next: [Chapter 11 — Components & Screens](PartIV-The-UI-Layer-11-Components-Screens.md)*


\newpage

# Chapter 11: Components & Screens

> **Part IV: The UI Layer**

---

## Architecture Overview

The Claude Code UI has three layers:

```
src/screens/          ← 3 top-level full-screen modes
src/components/       ← ~140 application-level components
src/ink/components/   ← Base Ink primitives (Box, Text, ScrollBox...)
```

Application code imports from `src/ink.ts` which re-exports themed wrappers. Every visible element in Claude Code — the prompt input, message history, tool call displays, permission dialogs, settings UI — is a React component in this tree.

---

## Screens (`src/screens/`)

Three full-screen modes exist:

### `REPL.tsx` — The Main Interface

This is the primary screen that users interact with. It:

- Renders the conversation message list (all user/assistant/tool messages)
- Shows the prompt input at the bottom
- Streams assistant responses in real-time
- Displays tool calls as they execute (with permission prompts when needed)
- Handles keyboard shortcuts (Ctrl+C to interrupt, Esc to cancel, etc.)
- Shows the sidebar overlays (config, settings, MCP manager)
- Manages the overall layout: message area + input area

`REPL.tsx` is where virtually all user-facing React state lives. It uses the `AppState` store and numerous React contexts (notifications, FPS, modal state, etc.).

The REPL renders into an Ink `<Box>` with vertical flex layout:
```
┌─────────────────────────────────────────────────┐
│  Message history (scrollable)                    │
│  • User messages                                 │
│  • Assistant responses (streaming)               │
│  • Tool use blocks (collapsible)                 │
│  • Tool result blocks                            │
│  • Permission prompts (when needed)             │
├─────────────────────────────────────────────────┤
│  Prompt input (fixed at bottom)                 │
│  > |                                            │
└─────────────────────────────────────────────────┘
```

### `Doctor.tsx` — Environment Diagnostics

The `/doctor` command screen. Runs a series of checks:
- API connectivity and authentication
- Tool availability (ripgrep, git, Node.js, Bun)
- MCP server connection status
- File system permissions
- Configuration validity
- IDE bridge status

Each check renders as a pass/fail indicator with diagnostic details. Uses the `DiagnosticsDisplay` component.

### `ResumeConversation.tsx` — Session Restore

The `/resume` command screen. Shows a list of previous conversation sessions with:
- Session name (or auto-generated title)
- Date/time
- Turn count and token usage
- Preview of the last message

Selecting a session loads its full conversation history into the REPL.

---

## Core Components

### `PromptInput` / `BaseTextInput`

The text input at the bottom of the REPL. Features:
- **Multi-line input**: Shift+Enter adds new lines
- **History navigation**: Up/Down arrows cycle through previous inputs
- **Slash command autocomplete**: Typing `/` shows matching commands
- **@ file references**: `@filename` attaches file content
- **Paste handling**: Large pastes are handled gracefully
- **Vim mode**: Full Normal/Insert/Visual mode when enabled via `useVimInput`
- **Emoji**: Built-in emoji picker

The input is implemented with `useTextInput` hook (from `src/hooks/useTextInput.ts`) which manages cursor position, selection, undo history, and character insertion.

### Message Rendering

Different message types render differently:

**User messages**: The user's input text, styled with a colored prefix. Attached files shown as expandable blocks.

**Assistant text responses**: Streamed text, rendered with markdown-like formatting. Code blocks are syntax-highlighted via `HighlightedCode`.

**Tool use blocks**: Show the tool being called with its arguments. Collapsible — search/read operations hide by default, write/shell operations always visible. Shows spinner while running.

**Tool result blocks**: The tool's output. Large outputs are truncated with an expand option. File diffs shown via `StructuredDiff`.

**System messages**: Informational messages (context compaction notice, model switch notification, etc.).

### `StructuredDiff`

Renders unified diffs in the terminal with syntax highlighting. Shows:
- File name and edit type (modified/added)
- Line-level diff with `+`/`-` indicators
- Color-coded: red for removed, green for added
- Syntax highlighting within the diff context

### `HighlightedCode`

Syntax-highlighted code blocks. Uses `chalk` for terminal colors with language detection. The language is either specified in the code block or inferred from content patterns.

### `Spinner`

Animated loading indicator. Uses `useAnimationFrame` hook for smooth animation. Multiple styles (dots, line, etc.) are available.

### `AgentProgressLine`

Shows progress for running sub-agents:
```
◉ Agent [general-purpose] searching codebase... (23s, 12 tool calls)
```
Color-coded by agent instance (each agent gets a unique color from `agentColorManager`).

### `CoordinatorAgentStatus`

When coordinator mode is active, shows the team of agents and their current status. Each agent is a row showing type, current task, and completion state.

---

## Design System (`src/components/design-system/`)

Themed wrappers over Ink primitives:

**`ThemeProvider`**: Provides the current theme to all components via React context. Themes define colors for text, backgrounds, borders, success/warning/error states.

**`ThemedBox`** and **`ThemedText`**: Wrappers around `Box` and `Text` that accept semantic color names (`'success'`, `'warning'`, `'error'`, `'muted'`) that resolve to the current theme's actual colors.

Available themes include `dark`, `light`, `solarized`, and others selectable via `/theme`.

---

## Permission UI (`src/components/permissions/`)

When a tool requires permission, a `PermissionRequest` component renders in the REPL:

```
┌──────────────────────────────────────────────────────┐
│ ⚠️  Approval needed                                   │
│                                                      │
│ Run command:  rm -rf node_modules                    │
│ Description:  Remove node_modules for clean install  │
│                                                      │
│ [Yes] [No] [Always allow] [Always deny]              │
└──────────────────────────────────────────────────────┘
```

Permission responses:
- **Yes**: Allow this once
- **No**: Deny this once
- **Always allow**: Add an `alwaysAllow` rule for this pattern
- **Always deny**: Add an `alwaysDeny` rule

The `PermissionRequest` component receives a `ToolUseConfirm` object from the permission queue and resolves the promise when the user decides.

---

## Settings UI (`src/components/Settings/`)

The `/config` command renders a full-screen settings browser. Settings are organized into categories (model, permissions, appearance, advanced). Each setting shows:
- Current value
- Description
- Allowed values or range
- Keyboard shortcut to edit

---

## Task Components (`src/components/tasks/`)

**`TaskList`**: Shows running and completed background tasks. Each task shows:
- Task type (shell, agent, remote)
- Current status (running/completed/failed)
- Duration
- Output preview

---

*Next: [Chapter 12 — The Permission System](PartV-Subsystems-12-The-Permission-System.md)*


\newpage


# Part V: Subsystems

# Chapter 12: The Permission System

> **Part V: Subsystems**

---

## Why the Permission System Exists

Claude Code can read files, write files, execute shell commands, delete content, and interact with external services. These capabilities are powerful — and potentially destructive. Without a permission system, a poorly-phrased prompt or a hallucinating LLM could `rm -rf` your project, push code to production, or leak credentials.

The permission system is the **safety layer between the LLM's tool requests and the actual execution**. Every tool call passes through it before anything happens.

---

## The Four Permission Modes

Controlled via `src/utils/permissions/PermissionMode.ts`:

### `default` (the standard mode)
The LLM's tool requests are individually evaluated:
- Read-only operations (file reads, globs, searches) → auto-approved
- Write operations (file edits, writes, deletes) → prompts user
- Shell commands → prompts user unless covered by an allow rule
- Previously approved patterns (rules) → auto-approved

### `plan` (read-only planning mode)
All write operations are **blocked** regardless of rules. The LLM can read, search, and reason, but cannot modify anything. Used during the planning phase of complex tasks.

When exiting plan mode (`ExitPlanModeTool`), the previous mode is restored from `toolPermissionContext.prePlanMode`.

### `bypassPermissions` (auto-approve everything)
All permission checks are skipped. Every tool call is auto-approved. Intended for:
- Trusted automated environments (CI/CD)
- Users who understand the risks and want maximum autonomy

**Warning**: This mode is genuinely dangerous. Only use it when you fully trust the task and the LLM's behavior.

### `auto` (ML-based classifier, experimental)
An ML classifier automatically decides whether to approve or deny each tool call based on the command's semantics and the current task context. More nuanced than simple rules but requires the classifier service to be available.

---

## Permission Handlers (`src/hooks/toolPermission/handlers/`)

Three handler implementations cover different execution contexts:

**`interactiveHandler.ts`** — for REPL sessions
- Renders the permission prompt in the terminal via the `PermissionRequest` component
- User sees the tool call, description, and options (Yes/No/Always/Deny)
- Supports "Always allow" → creates an `alwaysAllow` rule
- Supports "Always deny" → creates an `alwaysDeny` rule

**`coordinatorHandler.ts`** — for coordinator workers
- Workers in coordinator mode have automated permission checks
- Permission prompts bubble up to the coordinator, not the user directly
- `awaitAutomatedChecksBeforeDialog` allows the classifier to pre-check before showing dialog

**`swarmWorkerHandler.ts`** — for background swarm agents
- Background agents that can't show UI
- Permissions that would require UI prompts are **auto-denied** (via `shouldAvoidPermissionPrompts`)
- The agent can only do operations covered by its pre-configured rules

---

## `PermissionContext.ts` — The Core Handler

`PermissionContext.ts` in `src/hooks/toolPermission/` is the main permission decision engine. It:

1. Receives the tool call, input, and current `ToolPermissionContext`
2. Checks `bypassPermissions` mode → immediate allow
3. Checks `alwaysDenyRules` → immediate deny
4. Checks `alwaysAllowRules` → immediate allow
5. Calls the tool's `checkPermissions()` → may return deny/allow/ask
6. If `ask` and interactive → queues a `ToolUseConfirm` in the permission queue
7. User responds → decision is recorded
8. If "always allow/deny" → creates a persistent rule via `persistPermissionUpdates()`

### Approval and Rejection Sources

```python
from typing import Union, Literal, Optional
from dataclasses import dataclass

@dataclass
class ApprovalByHook:
    type: Literal['hook'] = 'hook'
    permanent: Optional[bool] = None   # Pre-sampling hook approved it

@dataclass
class ApprovalByUser:
    type: Literal['user'] = 'user'
    permanent: bool = False             # User explicitly approved

@dataclass
class ApprovalByClassifier:
    type: Literal['classifier'] = 'classifier'  # ML classifier approved

PermissionApprovalSource = Union[ApprovalByHook, ApprovalByUser, ApprovalByClassifier]

@dataclass
class RejectionByHook:
    type: Literal['hook'] = 'hook'               # Hook rejected it

@dataclass
class RejectionByUserAbort:
    type: Literal['user_abort'] = 'user_abort'   # User pressed Ctrl+C

@dataclass
class RejectionByUserReject:
    type: Literal['user_reject'] = 'user_reject'
    has_feedback: bool = False                    # User said No

PermissionRejectionSource = Union[RejectionByHook, RejectionByUserAbort, RejectionByUserReject]
```

---

## Permission Rules

Rules are stored in `.claude/settings.json` (project) or `~/.claude/settings.json` (user):

```json
{
  "permissions": {
    "allow": [
      "Bash(git *)",
      "Bash(npm test)",
      "Bash(npm run *)",
      "FileEdit(/src/*)",
      "FileRead(*)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(sudo *)"
    ]
  }
}
```

### Rule Format

Rules follow the pattern `ToolName(pattern)`:

| Rule | Meaning |
|------|---------|
| `Bash(git *)` | Any bash command starting with `git` |
| `Bash(npm test)` | Exactly `npm test` |
| `FileEdit(/src/*)` | Edit any file under `/src/` |
| `FileRead(*)` | Read any file |
| `WebFetch(https://docs.python.org/*)` | Fetch any URL under that path |
| `Agent(*)` | Spawn any sub-agent |
| `Bash(*)` | **Any bash command** (dangerous) |

### Wildcard Matching

Patterns use `*` as a wildcard (matches any sequence of characters). The matching function is `matchWildcardPattern()` from `src/utils/permissions/shellRuleMatching.ts`.

For BashTool, `permissionRuleExtractPrefix()` extracts the "prefix" portion of the command for efficient rule evaluation.

### Rule Precedence

1. **`deny` rules** take precedence over `allow` rules
2. More specific rules take precedence over wildcards
3. Project rules override user rules (project is more specific to context)

### Rule Sources

Rules can come from multiple sources (tracked in `ToolPermissionRulesBySource`):
- User settings file
- Project settings file
- Enterprise/MDM policy

The `strippedDangerousRules` field in `ToolPermissionContext` records any enterprise rules that were too permissive and were stripped.

---

## Permission Logging (`permissionLogging.ts`)

Every permission decision is logged to:
1. **Analytics** (`logEvent`) — for usage analytics and improvement
2. **OpenTelemetry** (`logOTelEvent`) — for tracing
3. **Code edit metrics** — for code editing tools (Edit, Write, NotebookEdit), the language is detected from the file path and recorded

```python
CODE_EDITING_TOOLS = ['Edit', 'Write', 'NotebookEdit']

# For code edit tools, the language is extracted from the file extension
# and sent with the permission decision for language-specific analytics
if is_code_editing_tool(tool.name):
    file_path = tool.get_path and tool.get_path(parsed_input)
    language = await get_language_name(file_path)
```

This data is how Anthropic understands which operations users approve most frequently, informing decisions about what should be auto-approved vs. always prompted.

---

## How Permissions Flow Through Tool Execution

Complete flow from LLM tool request to execution:

```
1. LLM response includes tool_use block
       ↓
2. Query Engine calls wrappedCanUseTool(tool, input, context, ...)
       ↓
3. PermissionContext.ts receives the call
       ↓
4. Check permission mode:
   • bypassPermissions → ALLOW immediately
   • plan + write op → DENY immediately
       ↓
5. Check alwaysDenyRules:
   • Rule matches → DENY immediately, record denial
       ↓
6. Check alwaysAllowRules:
   • Rule matches → ALLOW immediately, record approval
       ↓
7. Call tool.checkPermissions(input, context):
   • Returns { behavior: 'allow' } → ALLOW
   • Returns { behavior: 'deny', reason } → DENY
   • Returns { behavior: 'ask', prompt } → continue to step 8
       ↓
8. Check shouldAvoidPermissionPrompts (background agents):
   • True → DENY (can't show UI)
       ↓
9. Queue ToolUseConfirm in permission queue (React state)
       ↓
10. REPL renders PermissionRequest component
        ↓
11. User responds: Yes / No / Always / Deny
        ↓
12. If "Always allow" → create rule, persist to settings file
    If "Always deny" → create rule, persist to settings file
        ↓
13. Log the decision (analytics + OTel)
        ↓
14. Return decision to Query Engine
        ↓
15. If ALLOW: tool.call() executes
    If DENY: tool_result with rejection message returned to LLM
```

---

## The `ToolPermissionContext` in Practice

The `ToolPermissionContext` (from `Tool.ts`) is built once at session start and passed through to every tool call:

```python
tool_permission_context = ToolPermissionContext(
    mode='default',
    additional_working_directories={},
    always_allow_rules={
        'user': ['FileRead(*)', 'GlobTool(*)', 'GrepTool(*)'],
        'project': ['Bash(npm test)', 'Bash(npm run lint)'],
    },
    always_deny_rules={
        'user': ['Bash(rm -rf /)'],
    },
    always_ask_rules={},
    is_bypass_permissions_mode_available=False,  # Set True for paid plans
)
```

The `isBypassPermissionsModeAvailable` flag determines whether the user can activate `bypassPermissions` mode. It is gated by subscription type.

---

*Next: [Chapter 13 — MCP (Model Context Protocol) Integration](PartV-Subsystems-13-MCP-Model-Context-Protocol-Integration.md)*


\newpage

# Chapter 13: MCP (Model Context Protocol) Integration

> **Part V: Subsystems**

---

## What Is MCP?

The **Model Context Protocol** is an open standard created by Anthropic for connecting LLMs to external tools and data sources. It defines:

- A standardized JSON-RPC 2.0 protocol
- Tool definitions with JSON Schema inputs
- Resource discovery and access
- Authentication flows
- Transport options (stdio, SSE, HTTP)

Claude Code is one of the most complete MCP implementations: it acts as both an MCP **client** (consuming tools from servers) and an MCP **server** (exposing its own tools to other clients).

---

## Transport Types

The MCP client (`src/services/mcp/client.ts`) supports three transport types:

**`StdioClientTransport`**: Launches a local process and communicates via stdin/stdout. Most common for local MCP servers:
```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    }
  }
}
```

**`SSEClientTransport`**: Server-Sent Events over HTTP. For servers that support long-lived HTTP connections. Used for claude.ai-hosted MCP servers.

**`StreamableHTTPClientTransport`**: Modern HTTP-based transport with streaming support. The newest transport type in the MCP spec.

**`InProcessTransport`** (custom): Claude Code's own in-process transport (`src/services/mcp/InProcessTransport.ts`). Used when Claude Code needs to connect to an MCP server running in the same process.

**`SdkControlTransport`**: Used for the SDK bridge integration (`SdkControlTransport.ts`).

---

## `client.ts` — The MCP Client

`client.ts` is the core MCP client implementation. It:

1. **Connects to MCP servers** — creates a `Client` from `@modelcontextprotocol/sdk` with the appropriate transport
2. **Discovers tools** — calls `listTools()` to get all tools the server exposes
3. **Discovers resources** — calls `listResources()` to get available resources
4. **Builds tool wrappers** — creates `MCPTool` instances for each discovered server tool
5. **Handles auth** — creates `McpAuthTool` instances for servers requiring authentication

When an MCP server is connected, its tools appear in the LLM's system prompt as callable tools, indistinguishable from native Claude Code tools from the LLM's perspective.

### Tool Discovery

```python
# client.ts calls list_tools() to discover server tools
tools_result: ListToolsResult = await client.list_tools()

# Each server tool becomes an MCPTool instance:
mcp_tools = [
    create_mcp_tool_for(server_tool, server_name, client)
    for server_tool in tools_result.tools
]
```

The created `MCPTool` instances are added to the tool registry and included in the system prompt.

---

## `MCPConnectionManager.tsx` — Connection Lifecycle

`MCPConnectionManager` manages the full lifecycle of MCP server connections:

- **Initial connection** at startup for configured servers
- **Reconnection** with backoff on transient failures
- **Status tracking**: connected, connecting, disconnected, error
- **Health monitoring**: periodic checks if the connection is still alive
- **Graceful shutdown**: clean disconnection on session end

The `useManageMCPConnections` hook provides the React interface to this manager, used by the REPL and `/mcp` command to display connection status.

---

## Authentication (`auth.ts`, `xaa.ts`, `xaaIdpLogin.ts`, `oauthPort.ts`)

MCP servers can require authentication. Claude Code supports:

**OAuth 2.0 flow** (via `oauthPort.ts`):
1. Claude Code opens a local HTTP server on a random port to receive the OAuth callback
2. Opens the browser to the MCP server's authorization URL
3. Receives the auth code callback
4. Exchanges the code for an access token
5. Stores the token in the secure credential store

**XAA (Claude.ai's auth system)** (`xaa.ts`, `xaaIdpLogin.ts`):
Special authentication for claude.ai-hosted MCP servers. Uses Anthropic's identity provider.

**Token refresh** (`checkAndRefreshOAuthTokenIfNeeded`):
OAuth tokens have expiry. The client automatically refreshes tokens before they expire.

---

## Configuration (`config.ts`, `envExpansion.ts`, `normalization.ts`)

MCP servers are configured in `~/.claude/settings.json` or `.claude/settings.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "slack": {
      "type": "sse",
      "url": "https://mcp.example.com/slack/sse",
      "headers": {
        "Authorization": "Bearer ${SLACK_API_TOKEN}"
      }
    }
  }
}
```

**`envExpansion.ts`**: Expands `${ENV_VAR}` references in MCP server configurations. This allows secrets to come from environment variables rather than being hardcoded in settings files.

**`normalization.ts`**: Normalizes the server configuration format. Different config versions and formats are unified into a canonical representation before use.

---

## Channel System (`channelPermissions.ts`, `channelAllowlist.ts`, `channelNotification.ts`)

Claude.ai-hosted MCP servers use "channels" — named groupings of capabilities. The channel system manages:

**`channelPermissions.ts`**: What operations each channel is authorized to perform. Prevents MCP servers from exceeding their declared scope.

**`channelAllowlist.ts`**: Which channels are allowed for this user/session. Admin-controlled allowlisting for enterprise deployments.

**`channelNotification.ts`**: Notifications about channel events (connection, disconnection, capability changes).

---

## The Official Registry (`officialRegistry.ts`)

At startup, Claude Code prefetches the list of Anthropic-approved MCP servers:

```python
import httpx

async def prefetch_official_mcp_urls() -> None:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            'https://api.anthropic.com/mcp-registry/v0/servers?version=latest&visibility=commercial',
            timeout=5.0
        )
    # Builds a set[str] of normalized official URLs
```

This registry is used to:
- Display official servers in the `/mcp` add UI
- Mark servers as "official" vs user-configured in the status display
- Apply different trust levels to official vs unknown servers

The prefetch is fire-and-forget — startup doesn't wait for it.

---

## Claude.ai Integration (`claudeai.ts`, `vscodeSdkMcp.ts`)

**`claudeai.ts`**: Handles the connection to claude.ai's hosted MCP infrastructure. When Claude Code is used through claude.ai (browser or desktop app), it may receive MCP server configurations from the cloud service.

**`vscodeSdkMcp.ts`**: The VS Code extension SDK uses this transport to expose VS Code-specific tools (file context, editor operations, diff display) to Claude Code. Implements `notifyVscodeFileUpdated()` which is called by `FileEditTool` after every edit.

---

## Claude Code as an MCP Server (`src/entrypoints/mcp.ts`)

When launched with the MCP server entrypoint, Claude Code exposes its own tools via the MCP protocol:

```bash
# Run Claude Code as an MCP server (stdio transport)
claude --mcp
```

Any MCP-compatible client (another AI agent, a different Claude Code instance, etc.) can then connect and use Claude Code's full tool suite: file operations, shell execution, web fetch, etc.

This enables powerful patterns:
- A parent Claude Code instance spawning child instances via MCP
- Other AI agents using Claude Code as a "coding sub-agent"
- IDE extensions using Claude Code as a tool provider

---

## Practical MCP Usage

### Adding a Server

```
/mcp add-json '{"type":"stdio","command":"npx","args":["@modelcontextprotocol/server-github"]}'
```

Or interactively:
```
/mcp add
```

### Checking Status

```
/mcp              # Dashboard with all servers
/mcp status       # Quick status check
```

### Debugging

If a server fails to connect:
1. Check `/mcp` for error messages
2. Try `/mcp restart <server-name>`
3. Check the server's log output
4. Verify environment variables are set

---

*Next: [Chapter 14 — The Bridge — IDE Integration](PartV-Subsystems-14-The-Bridge-IDE-Integration.md)*


\newpage

# Chapter 14: The Bridge — IDE Integration

> **Part V: Subsystems**

---

## What the Bridge Is

The bridge is a **bidirectional communication layer** connecting Claude Code's CLI to IDE extensions (VS Code, JetBrains). It allows:
- The IDE to send context (open files, selections, editor state) to Claude Code
- Claude Code to display diffs in the IDE's native diff viewer
- Permission prompts to appear in the IDE's UI rather than the terminal
- Sessions started in the IDE to share state with the terminal

The bridge is gated behind the `BRIDGE_MODE` feature flag and is stripped from non-IDE builds.

---

## Architecture

```
┌──────────────────────┐         ┌─────────────────────────┐
│   VS Code Extension  │◄───────►│   Bridge Layer           │
│   (or JetBrains)     │  JWT    │   src/bridge/            │
│                      │  Auth   │                         │
│  - UI rendering      │         │  - Session management   │
│  - File watching     │         │  - Message routing      │
│  - Diff display      │         │  - Permission proxy     │
└──────────────────────┘         └──────────┬──────────────┘
                                            │
                                            ▼
                                  ┌──────────────────────┐
                                  │  Claude Code Core    │
                                  │  (QueryEngine, Tools) │
                                  └──────────────────────┘
```

---

## `src/bridge/` — File Overview

The bridge directory has 30+ files:

| File | Purpose |
|------|---------|
| `bridgeMain.ts` | Main bridge loop — starts the bidirectional channel |
| `bridgeMessaging.ts` | Message protocol serialization/deserialization |
| `bridgeApi.ts` | API surface exposed to the IDE extension |
| `bridgeConfig.ts` | Bridge configuration (port, timeouts, etc.) |
| `replBridge.ts` | Connects the REPL session to the bridge channel |
| `initReplBridge.ts` | Initialization of the REPL bridge |
| `jwtUtils.ts` | JWT authentication between CLI and IDE |
| `trustedDevice.ts` | Device trust verification |
| `workSecret.ts` | Workspace-scoped secret for authentication |
| `sessionRunner.ts` | Manages session execution via bridge |
| `createSession.ts` | Creates new bridge sessions |
| `inboundMessages.ts` | Handles messages from the IDE |
| `inboundAttachments.ts` | File/content attachments from IDE |
| `bridgePermissionCallbacks.ts` | Routes permission prompts to IDE |
| `bridgePointer.ts` | Connection pointer/discovery |
| `codeSessionApi.ts` | Code session API for IDE |
| `replBridgeHandle.ts` | Handle for controlling the REPL bridge |
| `replBridgeTransport.ts` | Transport layer for bridge messages |
| `capacityWake.ts` | Wakes up dormant bridge connections |

---

## Authentication (`jwtUtils.ts`, `trustedDevice.ts`, `workSecret.ts`)

Even for local connections (IDE extension → local CLI), authentication is required. This prevents malicious local processes from impersonating the IDE extension.

**JWT authentication** (`jwtUtils.ts`):
- The CLI generates a JWT signed with a workspace-scoped secret
- The IDE extension presents this JWT to authenticate
- Short-lived tokens prevent replay attacks

**Workspace secret** (`workSecret.ts`):
- A secret key scoped to the current workspace (project directory)
- Generated on first use, stored securely
- Shared between the CLI and the IDE extension through secure IPC

**Device trust** (`trustedDevice.ts`):
- Persistent trust for known devices
- New devices must complete an authentication handshake

---

## Message Protocol (`bridgeMessaging.ts`)

The bridge uses a JSON-based message protocol over the transport. Message types include:

**From IDE to CLI:**
- `user_input` — text entered in the IDE's Claude panel
- `file_attachment` — file content attached to the conversation
- `cursor_position` — current cursor position in the editor
- `selected_text` — text selected in the editor
- `abort` — cancel the current operation

**From CLI to IDE:**
- `assistant_response` — text chunk from Claude
- `tool_use` — a tool being called (for display)
- `tool_result` — the result of a tool call
- `permission_request` — request permission from the user
- `diff_preview` — show a file diff in the IDE's diff viewer
- `status_update` — session status changes

Each message has a `type`, `session_id`, and `payload`. The serialization handles the various TypeScript union types via discriminated union dispatch.

---

## Session Management (`sessionRunner.ts`, `createSession.ts`)

### Session Creation

When the IDE extension initiates a conversation:

1. `createSession()` allocates a new session ID and registers it
2. `sessionRunner.ts` creates a `QueryEngine` instance for this session
3. The session is registered in the session store
4. A confirmation is sent back to the IDE

### Session Persistence

Sessions created via the bridge are stored the same way as REPL sessions — they can be resumed with `/resume` in either the terminal or the IDE.

### Session Cleanup

When the IDE closes or the connection drops:
1. The session is marked as "backgrounded"
2. Any in-progress tool calls are allowed to complete
3. The session state is persisted for potential resume
4. The bridge connection is closed

---

## Inbound Message Handling (`inboundMessages.ts`, `inboundAttachments.ts`)

**`inboundMessages.ts`**: Dispatches incoming IDE messages to the appropriate handler. Converts IDE-specific message formats to Claude Code's internal message types.

**`inboundAttachments.ts`**: Handles file content attachments. When the IDE attaches an open file's content, it:
- Validates the file path is within the project
- Converts the content to the appropriate message format
- Attaches metadata (file type, encoding)

---

## Permission Proxying (`bridgePermissionCallbacks.ts`)

One of the bridge's critical functions is routing permission prompts. In terminal mode, permissions are shown in the terminal. In bridge (IDE) mode, they must appear in the IDE's UI.

`bridgePermissionCallbacks.ts` implements the `BridgePermissionCallbacks` interface:
- Sends permission requests to the IDE as `permission_request` messages
- Waits for the IDE's response
- Returns the decision to the permission system

This is referenced in `AppStateStore.ts`:
```python
from typing import Optional
bridge_permission_callbacks: Optional[BridgePermissionCallbacks] = None
```

When set (bridge mode is active), permission prompts are routed to the IDE instead of the terminal.

---

## IDE Integration Features

### Diff Display

When `FileEditTool` makes a change, the bridge sends a `diff_preview` message to the IDE. The extension displays the diff in VS Code's native diff viewer, making the change visible inline before the user accepts or rejects it.

The `notifyVscodeFileUpdated()` function (called by `FileEditTool` and `FileWriteTool`) triggers this flow.

### Context Injection

The IDE extension continuously monitors:
- The active editor file
- The cursor position and selection
- Recently opened files

This context is sent as `file_attachment` messages and injected into the conversation as context. This is how Claude Code "knows" what you're looking at in the IDE without you having to explicitly say "look at this file."

### Inline Chat

In VS Code, the Claude panel supports inline chat (selecting code, asking Claude about it). The selected text is sent as `selected_text` with position metadata, and the response can be applied directly to the selection.

---

## The `BRIDGE_MODE` Feature Flag

The entire bridge subsystem is gated:

```python
import importlib

bridge = (
    importlib.import_module('.commands.bridge').default
    if feature('BRIDGE_MODE') else None
)
```

In the standard CLI build (no IDE), all bridge code is stripped. This keeps the terminal-only binary lean.

When `BRIDGE_MODE` is active:
- `bridgeMain.ts` starts the bridge listener
- Bridge-specific commands (`/bridge`, `/bridge-kick`) are registered
- Permission callbacks are wired to the bridge
- VS Code file update notifications are active

---

*Next: [Chapter 15 — Memory, Skills, Plugins & Tasks](PartV-Subsystems-15-Memory-Skills-Plugins-Tasks.md)*


\newpage

# Chapter 15: Memory, Skills, Plugins & Tasks

> **Part V: Subsystems**

---

## Overview

This chapter covers four interconnected subsystems that make Claude Code extensible, persistent, and parallelizable:

- **Memory** — file-based persistence across conversations
- **Skills** — prompt-driven capabilities bundled with the CLI
- **Plugins** — user-installable feature packages
- **Tasks** — the five task types that power background execution

---

## Part 1: The Memory System

Claude Code's memory is not a database or vector store — it's a **directory of markdown files** on disk. This design makes it inspectable, version-controllable, and writable by both Claude and the user.

### Architecture

```
~/.claude/
└── projects/
    └── <sanitized-project-root>/
        └── memory/           ← auto memory (private)
            ├── MEMORY.md     ← entrypoint index (200-line cap)
            ├── user_role.md  ← individual memory files
            ├── feedback_*.md
            ├── project_*.md
            └── team/         ← team memory (shared, TEAMMEM feature)
                ├── MEMORY.md
                └── *.md
```

The project root is sanitized and hashed so that different projects get separate memory directories. All worktrees of the same git repo share one memory directory (via `findCanonicalGitRoot()`).

### `src/memdir/` — Core Memory Modules

| File | Purpose |
|------|---------|
| `memdir.ts` | Builds the memory system prompt, manages MEMORY.md truncation, ensures directory exists |
| `paths.ts` | Resolves auto-memory path, handles env overrides, validates paths |
| `memoryTypes.ts` | The four-type taxonomy and prompt text constants |
| `memoryScan.ts` | Scans memory files and formats the manifest for the relevance selector |
| `findRelevantMemories.ts` | Asks Sonnet to select the most relevant memories for a given query |
| `memoryAge.ts` | Staleness calculation and freshness warning text |
| `teamMemPaths.ts` | Team memory path resolution, symlink-safe path validation |
| `teamMemPrompts.ts` | Combined private+team memory prompt builder |

### The Four Memory Types

Memory files use YAML frontmatter with a `type` field constrained to:

```markdown
---
name: User's preferred language
description: User prefers TypeScript over JavaScript
type: user
---

User prefers TypeScript for all new code.
```

| Type | What It Stores | When to Save |
|------|---------------|--------------|
| `user` | Role, expertise, preferences | When learning about the user |
| `feedback` | Behavioral corrections and confirmations | When the user corrects or validates an approach |
| `project` | Ongoing work, decisions, deadlines | When project context is revealed |
| `reference` | Pointers to external systems | When learning where to find information |

The taxonomy explicitly excludes: code patterns, git history, file structure, and anything derivable from the codebase.

### MEMORY.md — The Entrypoint Index

`MEMORY.md` is a special file: it's **always loaded into the system prompt**, capped at 200 lines and 25,000 bytes (`MAX_ENTRYPOINT_LINES`, `MAX_ENTRYPOINT_BYTES` in `memdir.ts`).

```python
# truncate_entrypoint_content() in memdir.py
# 1. Line-truncate first (natural boundary)
# 2. Byte-truncate at last newline before cap
# 3. Append warning identifying which cap fired
```

If MEMORY.md exceeds either cap, the model receives a warning:

> WARNING: MEMORY.md is 47 days old and 312 lines (limit: 200). Only part of it was loaded.

Each entry in MEMORY.md is a one-line pointer to a topic file:
```markdown
- [User Preferences](user_preferences.md) — prefers TypeScript, concise responses
- [Project Context](project_context.md) — rewriting auth middleware for compliance
```

### Memory Path Resolution

`paths.ts` resolves the auto-memory directory in this priority order:

1. `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` env var (Cowork override)
2. `autoMemoryDirectory` in `settings.json` (user/policy/local only — NOT project settings, for security)
3. `~/.claude/projects/<sanitized-git-root>/memory/`

Memory can be disabled via:
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`
- `CLAUDE_CODE_SIMPLE=1` (bare mode)
- `autoMemoryEnabled: false` in `settings.json`

```python
import os

# is_auto_memory_enabled() in paths.py
def is_auto_memory_enabled() -> bool:
    if is_env_truthy(os.environ.get('CLAUDE_CODE_DISABLE_AUTO_MEMORY')): return False
    if is_env_truthy(os.environ.get('CLAUDE_CODE_SIMPLE')): return False
    settings = get_initial_settings()
    if settings.auto_memory_enabled is not None: return settings.auto_memory_enabled
    return True
```

### Finding Relevant Memories

Not all memory files are injected every turn — that would flood the context window. Instead, `findRelevantMemories.ts` implements a **selective relevance system**:

```
User query
    │
    ▼
scanMemoryFiles()         ← reads frontmatter from all memory files
    │
    ▼
selectRelevantMemories()  ← asks claude-sonnet to pick up to 5 relevant files
    │
    ▼
Inject selected files     ← as <system-reminder> attachments with freshness note
```

The selector prompt tells Sonnet to be discerning:

> "Only include memories that you are certain will be helpful based on their name and description. Be selective."

It also instructs Sonnet NOT to select API reference/docs for tools that were recently used — if Claude just called a tool, it already knows how to use it.

### Memory Freshness

`memoryAge.ts` provides staleness warnings for memories older than 1 day:

```python
# Attached to every injected memory file older than 1 day:
f"This memory is {d} days old. Memories are point-in-time observations, \
not live state — claims about code behavior or file:line citations may \
be outdated. Verify against current code before asserting as fact."
```

This guards against a real failure mode: Claude citing a stale memory about a function's location as if it were current fact.

### Auto-Extract Memories (`src/services/extractMemories/`)

The `extractMemories.ts` service runs **at the end of every complete query loop** (when the model produces a final response with no pending tool calls). It uses the forked agent pattern:

```
End of turn
    │
    ▼
feature('EXTRACT_MEMORIES') && isExtractModeActive()?
    │
    ▼  yes
runForkedAgent()          ← perfect fork, shares parent's prompt cache
    │
    ▼
Extract agent analyzes conversation transcript
    │
    ▼
Writes new/updated memory files to auto-memory dir
    │
    ▼
Creates system message: "Memory saved: user_role.md"
```

The fork shares the parent's prompt cache (via `createCacheSafeParams()`), making it essentially free in terms of additional API cost for the prefill.

### Session Memory (`src/services/SessionMemory/`)

Session Memory is a separate, lighter-weight system that maintains a **single markdown file per session** summarizing the current conversation. It runs periodically rather than at end-of-turn:

- Activates after the conversation reaches a minimum threshold of tool calls
- Runs every N tool calls (configurable)
- Uses `runForkedAgent()` with a concise summarization prompt
- Stores output at `~/.claude/projects/<project>/session_memory.md`

Unlike auto-memory (which persists across sessions), session memory is scoped to the current conversation and helps with mid-session context management.

### Team Memory Sync (`src/services/teamMemorySync/`)

When the `TEAMMEM` feature flag is active, the team memory subsystem syncs the `memory/team/` directory with a server API:

```
Session start
    │
    ▼
GET /api/claude_code/team_memory?repo=owner/repo
    │
    ├── 404: no server data → local wins, push if present
    └── 200: server data → delta pull (server wins per-key)
              │
              ▼
         Pull: overwrite local files with server content
         Push: upload keys whose content hash differs from serverChecksums
```

Key behaviors:
- **Server wins**: during pull, server content overwrites local
- **Delta push**: only changed files are uploaded
- **No deletions**: deleting a local file does not propagate; the next pull restores it
- **Secret scanning**: `secretScanner.ts` and `teamMemSecretGuard.ts` prevent API keys and credentials from being written to shared memory

### KAIROS — Assistant Mode Memory

When the `KAIROS` feature is active (long-running assistant sessions), the memory model changes:

Instead of maintaining `MEMORY.md` as a live index, the agent **appends to a date-named daily log**:

```
~/.claude/projects/<project>/memory/logs/YYYY/MM/YYYY-MM-DD.md
```

A separate `/dream` skill (the `autoDream` service) runs nightly to distill these logs into topic files + MEMORY.md. This append-only pattern avoids concurrent write conflicts in perpetual sessions.

### Security

Path traversal is a primary concern for a system that writes arbitrary filenames to disk. `teamMemPaths.ts` implements multiple defense layers:

```python
# validate_team_mem_key() — two-pass validation:
# Pass 1: os.path.normpath() eliminates .. segments (fast rejection)
# Pass 2: realpath_deepest_existing() resolves symlinks on deepest existing ancestor
#         → is_real_path_within_team_dir() compares canonical filesystem paths
```

Null bytes, URL-encoded traversals, Unicode normalization attacks (fullwidth `／`), and backslash separators are all explicitly rejected.

---

## Part 2: The Skills System

Skills are **prompt-driven capabilities** packaged as slash commands. Unlike tools (which execute code), skills inject a curated prompt into the conversation and let the LLM do the work.

### Architecture

```
src/skills/
├── bundledSkills.ts    ← BundledSkillDefinition type, registration registry
├── loadSkillsDir.ts    ← Loads skills from ~/.claude/skills/ and .claude/skills/
├── mcpSkillBuilders.ts ← Dependency-graph leaf for MCP skill discovery
└── bundled/
    ├── index.ts        ← initBundledSkills() — registers all bundled skills
    ├── loop.ts         ← /loop — recurring prompt scheduler
    ├── remember.ts     ← /remember — memory review and organization
    ├── simplify.ts     ← /simplify — code quality review agent
    ├── verify.ts       ← /verify — post-change verification
    ├── debug.ts        ← /debug — session debug log reader
    ├── updateConfig.ts ← /update-config — settings.json editor
    ├── keybindings.ts  ← /keybindings-help — keybinding customization
    ├── skillify.ts     ← /skillify — converts prompts to skills
    ├── batch.ts        ← /batch — multi-task executor
    ├── stuck.ts        ← /stuck — unstuck guidance
    ├── loremIpsum.ts   ← /lorem-ipsum — placeholder text
    └── ... (feature-gated: claudeApi, loop, scheduleRemoteAgents, etc.)
```

### `BundledSkillDefinition`

```python
from typing import TypedDict, Optional, Callable, Literal
from collections.abc import Awaitable

class BundledSkillDefinition(TypedDict, total=False):
    name: str
    description: str
    aliases: list[str]
    when_to_use: str              # Shown in SkillTool's description
    argument_hint: str            # E.g. "[interval] <prompt>"
    allowed_tools: list[str]      # Constrain which tools are available
    model: str                    # Override the model for this skill
    disable_model_invocation: bool  # Skill returns prompt, no auto-invoke
    user_invocable: bool          # Shows in /help and SkillTool listing
    is_enabled: Callable[[], bool]  # Runtime gate (e.g. feature flag check)
    hooks: HooksSettings          # Skill-scoped hooks
    context: Literal['inline', 'fork']  # Inline: same agent; fork: new agent
    agent: str                    # Named agent definition to use
    files: dict[str, str]         # Reference files extracted to disk
    get_prompt_for_command: Callable[[str, ToolUseContext], Awaitable[list[ContentBlockParam]]]
```

The `getPromptForCommand` function is the skill's core — it receives the user's arguments and returns prompt content blocks.

### Skill Registration

All bundled skills are registered at startup via `initBundledSkills()` in `src/skills/bundled/index.ts`. Feature-gated skills are wrapped with `feature()` guards and lazy-loaded via `require()`:

```python
import importlib

# Avoids importing KAIROS code in non-KAIROS builds
if feature('KAIROS') or feature('KAIROS_DREAM'):
    register_dream_skill = importlib.import_module('.dream').register_dream_skill
    register_dream_skill()
```

### `loadSkillsDir.ts` — Disk-Based Skills

Users and projects can define custom skills as markdown files:

**Disk skill format** (`.claude/skills/my-skill.md`):

```markdown
---
name: my-skill
description: Does something useful
whenToUse: When the user wants to do X
argumentHint: [optional-args]
allowedTools: [Read, Grep]
---

# My Skill

You are doing X. The user asked for: {{args}}

Steps:
1. ...
```

`loadSkillsDir.ts` scans:
1. `~/.claude/skills/` — user-level skills
2. `.claude/skills/` — project-level skills

Skills are loaded by parsing the markdown frontmatter (`parseFrontmatterFields`) and creating `Command` objects that behave identically to bundled skills.

### `mcpSkillBuilders.ts` — MCP Skill Discovery

MCP servers can provide skills. The `mcpSkillBuilders.ts` module is a **dependency-graph leaf** — it imports nothing (only types), avoiding circular dependencies. It holds a registry that `loadSkillsDir.ts` registers into at module init:

```python
# Registered by load_skills_dir.py at module init
# Used by MCP client (client.py → mcp_skills.py → get_mcp_skill_builders())
def get_mcp_skill_builders() -> MCPSkillBuilders:
    if not builders:
        raise RuntimeError('MCP skill builders not registered')
    return builders
```

### Key Bundled Skills Deep Dive

**`/loop`** — Recurring scheduler  
Parses `[interval] <prompt>` → converts to cron expression → calls `ScheduleCronTool` → immediately executes the prompt once. Supports `5m`, `2h`, `1d` intervals with automatic rounding. Gated behind `AGENT_TRIGGERS`.

**`/simplify`** — Three-agent code review  
Launches three parallel sub-agents via `AgentTool`: (1) Code reuse reviewer, (2) Code quality reviewer, (3) Efficiency reviewer. Each receives the full `git diff`. Parent waits for all three, aggregates findings, applies fixes.

**`/remember`** — Memory landscape review  
Reviews auto-memory entries and classifies each as: promote to CLAUDE.md, promote to CLAUDE.local.md, promote to team memory, or stay in auto-memory. Presents proposals for user approval before making any changes. Ant-only (`USER_TYPE === 'ant'`).

**`/update-config`** — Settings editor  
Generates a live JSON schema from the `SettingsSchema` Zod definition at invocation time, ensuring the schema is always current. Uses this as context to edit `settings.json`.

**`/debug`** — Session diagnostics  
Tails the debug log (last 64KB), enables debug logging if not already active. Uses `disableModelInvocation: true` — returns just the prompt, requiring explicit `/debug` invocation.

---

## Part 3: The Plugin System

Plugins extend Claude Code with marketplace-installable packages. Unlike skills (single prompt files), plugins can bundle skills, hooks, and MCP server configurations.

### Architecture

```
src/
├── plugins/
│   ├── builtinPlugins.ts     ← Built-in plugin registry (user-toggleable)
│   └── bundled/
│       └── index.ts          ← initBuiltinPlugins() (scaffolding for now)
└── services/plugins/
    ├── PluginInstallationManager.ts  ← Background marketplace installer
    ├── pluginCliCommands.ts          ← CLI plugin subcommands
    └── pluginOperations.ts           ← Pure install/uninstall/enable/disable ops
```

Plugin utilities live in `src/utils/plugins/` (covered in Chapter 20).

### Built-in vs. Installed Plugins

**Built-in plugins** (`builtinPlugins.ts`):
- Shipped with the CLI binary
- Have IDs of the form `name@builtin`
- Appear in the `/plugin` UI under "Built-in"
- User-toggleable (persisted to `enabledPlugins` in `settings.json`)
- Can provide skills, hooks, and MCP server configs

**Installed plugins** (`pluginOperations.ts`):
- Downloaded from a marketplace (GitHub repo, zip archive)
- Scoped: `user`, `project`, or `local`
- Install logic: resolve → download → extract → cache → register

```python
from typing import TypedDict, Optional, Callable

class BuiltinPluginDefinition(TypedDict, total=False):
    name: str
    description: str
    version: str
    default_enabled: bool                    # Default on/off
    is_available: Callable[[], bool]         # Runtime availability check
    skills: list[BundledSkillDefinition]
    hooks: HooksSettings
    mcp_servers: dict[str, MCPServerConfig]
```

### Plugin Lifecycle

```
CLI startup
    │
    ├── initBuiltinPlugins()  ← registers built-in plugin definitions
    │
    └── performBackgroundPluginInstallations()
              │
              ├── diffMarketplaces()  ← compare declared vs. materialized
              ├── reconcileMarketplaces()  ← install missing/updated
              │
              ├── new installs → auto-refresh plugins (fix cache miss)
              └── updates only → set needsRefresh, notify user for /reload-plugins
```

The background installer runs asynchronously and maps progress to `AppState.plugins.installationStatus` for display in the UI.

### Plugin Scopes

| Scope | Config source | Who it applies to |
|-------|-------------|-------------------|
| `user` | `~/.claude/settings.json` | This user, all projects |
| `project` | `.claude/settings.json` | All contributors to this project |
| `local` | `.claude/settings.local.json` | This user, this project only |
| `managed` | `managed-settings.json` | Enterprise policy (read-only) |

`pluginOperations.ts` validates that the requested scope is within `VALID_INSTALLABLE_SCOPES` (`['user', 'project', 'local']`) — `managed` plugins can only be installed via enterprise policy.

### Plugin Security

- **Policy blocking**: `isPluginBlockedByPolicy()` checks enterprise blocklists
- **Dependency resolution**: `dependencyResolver.ts` prevents install of plugins whose dependencies are blocked
- **Path validation**: plugin directories are validated for containment before writes
- **Secret scanning**: team memory secret guard also applies to plugin-written memory

---

## Part 4: The Task System

Tasks are the mechanism by which Claude Code runs work **outside the main conversation loop**. Each task type has a distinct execution model.

### Task Architecture

```
src/tasks/
├── types.ts                    ← TaskState union type
├── Task.ts (root)              ← Task interface, TaskStateBase, createTaskStateBase
├── LocalShellTask/             ← Background bash commands
├── LocalAgentTask/             ← Background sub-agents
├── RemoteAgentTask/            ← Cloud-hosted remote agents
├── InProcessTeammateTask/      ← In-process team members (AsyncLocalStorage)
├── LocalMainSessionTask.ts     ← Main session as a task
├── DreamTask/                  ← Memory consolidation agent
└── pillLabel.ts                ← Status pill display labels
```

### Task State Union

```python
from typing import Union

TaskState = Union[
    LocalShellTaskState,
    LocalAgentTaskState,
    RemoteAgentTaskState,
    InProcessTeammateTaskState,
    LocalWorkflowTaskState,
    MonitorMcpTaskState,
    DreamTaskState,
]
```

All task states extend `TaskStateBase`:

```python
from typing import TypedDict, Literal, Optional

class TaskStateBase(TypedDict, total=False):
    id: str             # Unique task ID ("shell-abc123", "agent-def456")
    type: str           # Discriminant
    status: Literal['pending', 'running', 'completed', 'failed', 'killed']
    description: str    # Human-readable label for the UI pill
    notified: bool      # Has a completion notification been sent?
    is_backgrounded: bool
```

### `LocalShellTask` — Background Bash

The most common task type. Created when `BashTool` runs a command that should execute in the background (user backgrounded, or long-running detected).

**Key behaviors:**

1. **Stall watchdog** — watches the output file for growth; if output stops and the last line matches interactive-prompt patterns (`(y/n)`, `Press Enter`, etc.), sends a notification to the model:

```
"Background command 'npm install' appears to be waiting for interactive input"
```

2. **Output to disk** — stdout/stderr written to `~/.claude/tasks/<id>/output.txt`; the model reads this via `TaskOutput` tool rather than buffering in memory.

3. **Kill handling** — `killShellTasks.ts` sends SIGTERM then SIGKILL with a grace period; clean kill vs. timeout kill affects the notification message.

4. **Task deduplication** — `notified` flag prevents double-notification if both the task and `TaskStopTool` try to close it simultaneously.

### `LocalAgentTask` — Background Sub-Agent

Represents a sub-agent spawned by `AgentTool`. The agent runs in the same process but with its own `AbortController`, message history, and tool context.

**Progress tracking** (`LocalAgentTask.tsx`):

```python
from dataclasses import dataclass

@dataclass
class ProgressTracker:
    tool_use_count: int
    latest_input_tokens: int       # Cumulative per-turn (keep latest)
    cumulative_output_tokens: int  # Per-turn (sum)
    recent_activities: list[ToolActivity]  # Last 5 tool uses, for UI display
```

Token accounting is non-trivial: the Claude API reports `input_tokens` cumulatively per turn (includes all prior context), while `output_tokens` is per-turn only. The tracker handles this correctly.

**Notification XML** — when a sub-agent completes, it emits structured XML:

```xml
<task-notification>
  <task-id>agent-abc123</task-id>
  <tool-use-id>toolu_xyz</tool-use-id>
  <output-file>/path/to/output.txt</output-file>
  <status>completed</status>
  <summary>Agent completed: refactored 3 files</summary>
</task-notification>
```

The parent agent receives this in its next turn as a pending notification, reads the output file, and continues.

**Worktree support** — agents spawned with `EnterWorktreeTool` emit additional XML:

```xml
<worktree>
  <worktree-path>/tmp/worktree-xyz</worktree-path>
  <worktree-branch>claude/agent-xyz</worktree-branch>
</worktree>
```

### `RemoteAgentTask` — Cloud-Hosted Agent

Remote agents run on Anthropic's infrastructure (via the Teleport API). They're used for:
- Long-running background work that should survive terminal close
- `ultraplan` tasks (multi-phase planning)
- `ultrareview` tasks (security/bug review)
- `autofix-pr` and `background-pr` tasks

**Polling architecture:**

```
registerRemoteAgentTask()
    │
    ├── persist metadata to session sidecar (survives --resume)
    │
    └── pollRemoteSessionEvents() loop
              │
              ├── fetchSession() → check session status
              ├── completionChecker? → type-specific completion logic
              ├── parse <remote-review-progress> tags for ultrareview
              └── archive session on terminal status
```

Remote task types have pluggable completion checkers registered via `registerCompletionChecker()` — PR-related tasks check the PR status via GitHub API.

The `RemoteAgentTaskState` carries rich metadata:

```python
from typing import TypedDict, Optional, Literal

class ReviewProgress(TypedDict, total=False):  # For ultrareview
    stage: Literal['finding', 'verifying', 'synthesizing']
    bugs_found: int
    bugs_verified: int
    bugs_refuted: int

class RemoteAgentTaskState(TaskStateBase, total=False):
    remote_task_type: RemoteTaskType  # 'remote-agent' | 'ultraplan' | etc.
    session_id: str                   # Teleport session ID
    todo_list: TodoList               # Live task list from the remote agent
    log: list[SDKMessage]             # Streamed messages
    review_progress: ReviewProgress
    ultraplan_phase: Literal['needs_input', 'plan_ready']
```

### `InProcessTeammateTask` — In-Process Team Member

Teammates created by the coordinator (Chapter 16) that run **in the same Node.js process** using `AsyncLocalStorage` for isolation. Unlike `LocalAgentTask` (which spawns a fully independent agent), teammates:

- Have team-aware identity (`agentName@teamName`)
- Support plan mode approval flow (can pause and request human review)
- Maintain a capped message history for the "zoomed view" UI
- Can be shut down gracefully via `requestTeammateShutdown()`

The in-process model means teammates share the process's event loop — they don't have their own OS processes. `AsyncLocalStorage` provides context isolation so each teammate sees its own tool permissions, state, and conversation history.

### `DreamTask` — Memory Consolidation Agent

The Dream task represents the `autoDream` background agent that runs in KAIROS mode to consolidate daily memory logs into structured topic files.

```
DreamPhase: 'starting' → 'updating'
```

Phase transitions when the first Edit/Write tool call is observed in the agent's output. The task tracks:
- `sessionsReviewing`: how many day-logs are being consolidated
- `filesTouched`: paths seen in Edit/Write calls (incomplete — only tool-mediated writes)
- `turns`: agent's assistant responses (tool calls collapsed to counts)

When the dream is killed or fails, `rollbackConsolidationLock()` rewinds the lock mtime so the next session knows consolidation didn't complete.

### Task UI — Pills and Background Indicator

Tasks appear in the footer as colored "pill" badges. `pillLabel.ts` maps task states to display labels:

```
LocalShellTask  → "bash: npm install"
LocalAgentTask  → "agent: Refactoring auth (23 tools, 14k tokens)"
RemoteAgentTask → "ultraplan: Phase 2/4"
DreamTask       → "dreaming: reviewing 3 sessions"
```

The background tasks indicator (Shift+Down to expand) shows all currently running `BackgroundTaskState` tasks. `isBackgroundTask()` filters out foreground tasks (those with `isBackgrounded === false`).

---

## How These Four Systems Connect

The Memory, Skills, Plugins, and Task systems form a coherent extension layer:

```
Plugin          →  provides Skills + Hooks + MCP servers
Skill           →  injects Prompt, may spawn Tasks (via AgentTool)
Task            →  runs work, may write to Memory
Memory          →  persists state across sessions for future Skills/Tasks
```

A concrete example:
1. User installs plugin that provides `/daily-standup` skill
2. `/daily-standup` is invoked, spawning a `LocalAgentTask`
3. Agent completes its work, writes findings to memory
4. Next session, memory is loaded, `/daily-standup` picks up where it left off

---

*Next: [Chapter 16 — The Coordinator — Multi-Agent Orchestration](PartV-Subsystems-16-The-Coordinator-Multi-Agent-Orchestration.md)*


\newpage

# Chapter 16: The Coordinator — Multi-Agent Orchestration

> **Part V: Subsystems**

---

## What Is the Coordinator?

The coordinator is Claude Code's **orchestration mode** — a specialized system prompt and toolset that turns one Claude instance into a manager directing a team of worker agents. Rather than doing implementation work itself, the coordinator:

- Breaks tasks into parallel research and implementation workstreams
- Spawns workers via `AgentTool`
- Synthesizes findings from worker reports
- Continues workers with refined instructions
- Manages the full task lifecycle to completion

This is gated behind the `COORDINATOR_MODE` feature flag and activated by setting `CLAUDE_CODE_COORDINATOR_MODE=1`.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Coordinator (Leader)                                        │
│  CLAUDE_CODE_COORDINATOR_MODE=1                              │
│                                                              │
│  AgentTool → spawn Worker                                    │
│  SendMessageTool → continue Worker                           │
│  TaskStopTool → kill Worker                                  │
│                                                              │
│  Worker results arrive as <task-notification> user messages  │
└──────────────┬───────────────────────────────────────────────┘
               │ spawns
    ┌──────────┼──────────┬──────────┐
    ▼          ▼          ▼          ▼
 Worker-1   Worker-2   Worker-3   Worker-N
 (research) (research) (implement) (verify)
    │          │          │          │
    └──────────┴──────────┴──────────┘
               All run in parallel
```

Workers are standard Claude Code sub-agents (`subagent_type: 'worker'`). They have full access to the standard toolset (Read, Edit, Bash, Glob, Grep, etc.) but do NOT have `AgentTool` themselves — workers cannot spawn further sub-workers.

---

## `src/coordinator/coordinatorMode.ts`

This single file is the entire coordinator subsystem. It contains three exported functions:

### `isCoordinatorMode()`

```python
import os

def is_coordinator_mode() -> bool:
    if feature('COORDINATOR_MODE'):
        return is_env_truthy(os.environ.get('CLAUDE_CODE_COORDINATOR_MODE'))
    return False
```

Checked at startup and in `QueryEngine.ts` to determine whether coordinator-mode system prompt sections should be added.

### `matchSessionMode()`

When resuming a session (`--resume`), the stored session mode may differ from the current environment. This function reconciles them:

```python
from typing import Literal, Optional

def match_session_mode(
    session_mode: Optional[Literal['coordinator', 'normal']],
) -> Optional[str]: ...
```

If the stored session was a coordinator session but `CLAUDE_CODE_COORDINATOR_MODE` is not set (or vice versa), it flips the env var to match. Returns a warning string shown to the user if a switch was required.

### `getCoordinatorUserContext()`

Injects a `workerToolsContext` section into the user context when in coordinator mode:

```python
from typing import Optional, Sequence

def get_coordinator_user_context(
    mcp_clients: Sequence[dict],  # each dict has 'name' key
    scratchpad_dir: Optional[str] = None,
) -> dict[str, str]: ...
```

The injected text tells the coordinator what tools its workers have access to:

```
Workers spawned via the Agent tool have access to these tools: Bash, Edit, Glob, Grep, 
Read, TodoWrite, WebFetch, WebSearch, ... (full list, alphabetically sorted)

Workers also have access to MCP tools from connected MCP servers: server1, server2

Scratchpad directory: /path/to/scratchpad
Workers can read and write here without permission prompts.
```

If `CLAUDE_CODE_SIMPLE=1` (bare mode), workers only get `Bash`, `Read`, and `Edit` — the minimal toolset.

The **scratchpad directory** is a shared working space gated by the `tengu_scratch` feature flag. Workers can read/write here without permission prompts, enabling durable cross-worker knowledge sharing (research findings, intermediate results, coordination state).

### `getCoordinatorSystemPrompt()`

Returns the full coordinator system prompt — a ~400-line document that defines the coordinator's role, tools, task workflow, worker prompt writing discipline, and example session. This is injected as a system prompt section via `QueryEngine.ts` when coordinator mode is active.

---

## The Coordinator System Prompt

The coordinator system prompt is the heart of Chapter 16. Here is what it defines:

### 1. Role

> "You are a **coordinator**. Your job is to help the user achieve their goal, direct workers to research, implement, and verify code changes, synthesize results, and communicate with the user."

Critically: every message from the coordinator goes to the user. Worker results (`<task-notification>` XML) are internal signals, not conversation partners. The coordinator never thanks or acknowledges workers.

### 2. Tool Set

| Tool | Purpose |
|------|---------|
| `AgentTool` | Spawn a new worker |
| `SendMessageTool` | Continue an existing worker (by task-id) |
| `TaskStopTool` | Kill a running worker |
| `subscribe_pr_activity` / `unsubscribe_pr_activity` | GitHub PR event subscription (if available) |

The coordinator is explicitly told: **do not use one worker to check on another**. Workers notify when done.

### 3. Worker Result Format

Worker completions arrive as user-role messages containing XML:

```xml
<task-notification>
  <task-id>agent-a1b2c3</task-id>
  <status>completed</status>
  <summary>Agent "Investigate auth bug" completed</summary>
  <result>Found null pointer in src/auth/validate.ts:42...</result>
  <usage>
    <total_tokens>14203</total_tokens>
    <tool_uses>23</tool_uses>
    <duration_ms>45123</duration_ms>
  </usage>
</task-notification>
```

The `<task-id>` is the agent ID to use with `SendMessageTool` for continuation.

### 4. Task Workflow Phases

```
Research (parallel workers)
    │
    ▼  coordinator synthesizes
Synthesis (coordinator only)
    │
    ▼
Implementation (workers, sequential per file set)
    │
    ▼
Verification (workers, independent)
```

**Parallelism is the superpower.** The prompt explicitly states: "Launch independent workers concurrently whenever possible — don't serialize work that can run simultaneously."

**Read-only tasks** (research, exploration) run in parallel freely.  
**Write-heavy tasks** (implementation) run one at a time per file set to avoid conflicts.  
**Verification** can run alongside implementation on different areas.

### 5. The Synthesis Requirement

The most important directive in the coordinator prompt is the **synthesis mandate**:

> "When workers report research findings, **you must understand them before directing follow-up work**. Read the findings. Identify the approach. Then write a prompt that proves you understood by including specific file paths, line numbers, and exactly what to change."

Anti-pattern (lazy delegation):
```
AgentTool({ prompt: "Based on your findings, fix the auth bug" })
```

Good (synthesized spec):
```
AgentTool({ prompt: "Fix the null pointer in src/auth/validate.ts:42. 
The user field on Session is undefined when the session expires but the 
token remains cached. Add a null check before user.id access — if null, 
return 401 with 'Session expired'. Commit and report the hash." })
```

### 6. Continue vs. Spawn Decision

After synthesis, the coordinator chooses whether to continue an existing worker or spawn fresh:

| Situation | Action |
|-----------|--------|
| Research explored exactly the files needing edits | **Continue** (worker has context) |
| Research was broad, implementation is narrow | **Spawn fresh** (avoid noise) |
| Correcting a failure | **Continue** (worker knows what it tried) |
| Verifying code another worker wrote | **Spawn fresh** (fresh eyes, no implementation bias) |
| Approach was entirely wrong | **Spawn fresh** (wrong-approach context pollutes retry) |
| Unrelated task | **Spawn fresh** |

---

## The Swarm System (`src/utils/swarm/`)

While `coordinatorMode.ts` handles the LLM-facing prompt, the actual multi-agent infrastructure lives in `src/utils/swarm/`. This is where teammates are spawned, tracked, and communicated with.

### Three Execution Backends

```
src/utils/swarm/backends/
├── types.ts         ← PaneBackend + TeammateExecutor interfaces
├── detection.ts     ← Detect tmux / iTerm2 environment
├── registry.ts      ← Backend registration and selection
├── TmuxBackend.ts   ← Terminal pane management via tmux
├── ITermBackend.ts  ← Terminal pane management via iTerm2 AppleScript
└── InProcessBackend.ts ← In-process execution via AsyncLocalStorage
```

| Backend | Execution model | When used |
|---------|----------------|-----------|
| `tmux` | New tmux pane, separate process | User is inside tmux, or tmux available |
| `iterm2` | New iTerm2 split pane, separate process | User is in iTerm2 with `it2` CLI installed |
| `in-process` | Same Node.js process, AsyncLocalStorage isolation | No terminal multiplexer available; coordinator mode |

**Backend detection** (`detection.ts`):
- Checks `ORIGINAL_USER_TMUX` (the `TMUX` env var captured at module load, before `Shell.ts` can override it)
- Checks `TERM_PROGRAM === 'iTerm.app'` or `ITERM_SESSION_ID` presence
- **Does NOT** run `tmux display-message` as a fallback — that command succeeds if any tmux server is running, not just if the current process is inside tmux

### Team Files

Each multi-agent team has a **team file** on disk:

```
~/.claude/teams/<sanitized-team-name>/config.json
```

```python
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class TeamMember:
    agent_id: str              # "researcher@my-team"
    name: str                  # "researcher"
    joined_at: float
    tmux_pane_id: str
    cwd: str
    agent_type: Optional[str] = None
    model: Optional[str] = None
    color: Optional[str] = None
    plan_mode_required: Optional[bool] = None
    worktree_path: Optional[str] = None    # Git worktree path if isolated
    session_id: Optional[str] = None
    backend_type: Optional[BackendType] = None  # 'tmux' | 'iterm2' | 'in-process'
    is_active: Optional[bool] = None       # False when idle, true when processing
    mode: Optional[PermissionMode] = None  # Current permission mode

@dataclass
class TeamFile:
    name: str
    created_at: float
    lead_agent_id: str
    members: list[TeamMember] = field(default_factory=list)
    description: Optional[str] = None
    lead_session_id: Optional[str] = None
    hidden_pane_ids: Optional[list[str]] = None
    team_allowed_paths: Optional[list[TeamAllowedPath]] = None  # Files all teammates can edit without prompts
```

The team file is the **coordination state**. The leader and all teammates read it. Permission mode changes, activity status, and worktree paths all flow through this file.

### Agent Identity

Teammates have identity in the format `agentName@teamName`:

```
researcher@security-audit
implementer@security-audit
verifier@security-audit
```

The `TEAM_LEAD_NAME` is `'team-lead'` — this is how the leader registers itself.

### Spawning a Teammate

`spawnUtils.ts` builds the CLI flags propagated to spawned teammates:

```python
def build_inherited_cli_flags(options) -> str:
    # Propagates:
    # - --dangerously-skip-permissions (if leader has bypass mode, unless plan_mode_required)
    # - --model (if explicitly set on CLI)
    # - --settings (if custom settings path)
    # - --plugin-dir (for inline plugins)
    # - --teammate-mode (to match the leader's mode)
    # - --chrome / --no-chrome (if overridden)
    pass
```

Environment variables forwarded to spawned processes include API provider configuration (`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`), proxy settings (`HTTPS_PROXY`, etc.), and the CCR marker (`CLAUDE_CODE_REMOTE`).

**Teammate default model**: `getHardcodedTeammateModelFallback()` returns Claude Opus 4.6 (the most capable model). This ensures workers have the intelligence needed for complex implementation tasks.

### Git Worktree Isolation

For work that touches files, teammates can be given **isolated git worktrees**:

```
Main repository checkout (leader)
    └── .git/worktrees/
        ├── worker-researcher/ (branch: claude/researcher-abc)
        ├── worker-implementer/ (branch: claude/implementer-def)
        └── worker-verifier/ (branch: claude/verifier-ghi)
```

This prevents file-write conflicts between workers operating on the same codebase simultaneously. Each worker sees the same repo state (at branch creation time) but writes to its own isolated working tree.

After work is complete, the coordinator merges the worker branches using standard git operations, resolving any conflicts.

Worktree cleanup:

```python
# destroy_worktree() in team_helpers.py:
# 1. Read .git file to find main repo path
# 2. git worktree remove --force <path>
# 3. Fallback: shutil.rmtree
```

Worktrees are also cleaned up on session exit via `cleanupSessionTeams()`, which runs via `gracefulShutdown`.

### Permission Synchronization

The `permissionSync.ts` and `leaderPermissionBridge.ts` modules handle permission propagation between leader and teammates:

- When the leader grants a permission (e.g., "allow Bash(git:*) for this session"), that grant is broadcast to all active teammates
- When a teammate encounters an unlisted permission and `allowPermissionPrompts` is true, the request is forwarded to the leader's UI for approval
- Permission mode changes (e.g., switching a teammate from `default` to `acceptEdits`) are written to the team file via `setMemberMode()`

### The Mailbox System

Teammates communicate via **file-based mailboxes**:

```
~/.claude/tasks/<team-name>/<agent-id>/inbox/
```

Messages written to the inbox are polled by the recipient. `sendMessage()` in the InProcessBackend writes to `writeToMailbox()` and the teammate's `useInboxPoller` hook picks it up.

This architecture works uniformly across all backends — whether the recipient is an in-process teammate, a tmux pane, or a remote agent, the message delivery mechanism is always file-based.

---

## The In-Process Backend in Detail

For the coordinator mode (no terminal multiplexer), the `InProcessBackend` runs teammates in the same Node.js process:

```python
# spawn_in_process_teammate() flow:
# 1. Create TeammateContext via create_teammate_context()
#    - Includes isolated AgentId, tool context, abort controller
# 2. Register InProcessTeammateTask in AppState.tasks
# 3. Call start_in_process_teammate() — runs the agent loop
#    via contextvars, completely isolated from the leader
# 4. Return {'success': ..., 'agent_id': ..., 'task_id': ..., 'abort_controller': ...}
```

**AsyncLocalStorage isolation**: each in-process teammate gets its own `AsyncLocalStorage` store containing its agent identity, tool permissions, and conversation history. This prevents cross-agent context bleeding despite sharing the same Node.js event loop.

**Shared resources**: unlike tmux-spawned processes, in-process teammates share the parent's API client connection pool, MCP server connections, and module cache — making spawn much faster (no process startup overhead).

### Plan Mode in Teams

When `planModeRequired: true` is set on a teammate:

1. Teammate enters `plan` permission mode automatically on spawn
2. Before any file writes, teammate must call `ExitPlanModeTool`
3. Exit plan mode requires **leader approval** via the UI
4. Leader sees the proposed plan and can approve/reject

This provides a human-in-the-loop checkpoint for implementation work in automated pipelines.

---

## Practical Patterns

### Pattern 1: Parallel Research

```
Research Phase:
  Worker-A: "Investigate src/auth/ — find where sessions can be null"
  Worker-B: "Find all test files for auth — report coverage gaps"
  Worker-C: "Check git log on src/auth/ — what changed recently?"

All three run concurrently. Coordinator waits for all, then synthesizes.
```

### Pattern 2: Sequential Implementation with Parallel Verification

```
Implementation Phase:
  Worker-D: "Implement fix in src/auth/validate.ts:42"
           (sequential — touching files)

Verification Phase (after Worker-D done):
  Worker-E: "Run auth tests and typecheck"
  Worker-F: "Test edge cases: expired token, null user, concurrent sessions"

Both verification workers run concurrently.
```

### Pattern 3: Continue vs. Spawn

```
Worker-A reports: "Found null pointer in validate.ts:42"

// Good: continue Worker-A — it already has validate.ts loaded
SendMessageTool({ 
  to: "agent-a1b", 
  message: "Fix the null pointer at line 42. Add null check..." 
})

// Also good: spawn fresh Worker-B for verification
// (shouldn't carry implementation assumptions)
AgentTool({
  subagent_type: "worker",
  prompt: "Verify fix in src/auth/validate.ts. Run tests..."
})
```

### Pattern 4: Large-Scale Refactor with Worktrees

```
# Create isolated worktrees for concurrent implementation:
Worker-A: worktree "claude/auth-refactor-a" → handles src/auth/
Worker-B: worktree "claude/auth-refactor-b" → handles src/middleware/
Worker-C: worktree "claude/auth-refactor-c" → handles tests/

# After all workers complete:
# Leader merges branches, resolves conflicts
# Coordinator reports final diff to user
```

---

## Session Persistence

The coordinator session mode is stored in the session sidecar. On `--resume`:

```python
match_session_mode('coordinator')  # Flips env var if needed
# Returns warning: "Entered coordinator mode to match resumed session."
```

All team metadata (team files, task state, worktree paths) persists on disk and is restored when the session resumes. Remote agents (via Teleport) can survive terminal close entirely.

---

## Key Design Decisions

**Why not recursive spawning?** Workers cannot spawn further workers. This keeps the coordination graph shallow (one level) and prevents runaway resource consumption. Complex sub-delegation is handled via `SendMessageTool` continuation instead.

**Why file-based mailboxes?** File-based communication works uniformly across in-process, tmux, and remote backends without requiring IPC mechanisms specific to any one backend.

**Why Opus 4.6 for workers?** Workers handle the actual implementation — the hard part. Using the most capable model ensures quality. The coordinator (handling higher-level reasoning) also runs on the user's configured model, defaulting to the same.

**Why AsyncLocalStorage for in-process isolation?** Node.js AsyncLocalStorage provides implicit context propagation without requiring every function to thread a context parameter through. Each async call tree in the teammate inherits its own context automatically.

---

*Next: [Chapter 17 — The Service Layer](PartVI-Services-Infrastructure-17-The-Service-Layer.md)*


\newpage


# Part VI: Services & Infrastructure

# Chapter 17: The Service Layer

> **Part VI: Services & Infrastructure**

---

## Overview

The service layer is Claude Code's infrastructure underpinning — everything that isn't user-facing UI or LLM-facing tools. It handles API calls, conversation management, analytics, language server integration, tool execution orchestration, voice, and more.

```
src/services/
├── api/          ← Anthropic API client, retry, error handling, usage
├── compact/      ← Conversation compression (manual, auto, micro)
├── analytics/    ← GrowthBook, DataDog, 1P event logging
├── lsp/          ← Language Server Protocol integration
├── tools/        ← Tool execution orchestration and streaming
├── oauth/        ← OAuth 2.0 authentication flow
├── mcp/          ← MCP client (Chapter 13)
├── plugins/      ← Plugin installation (Chapter 15)
└── ...           ← Voice, VCR, rate limits, notifier, token estimation
```

---

## Part 1: The API Client (`src/services/api/`)

### `client.ts` — Multi-Provider Anthropic Client

The API client creates an `Anthropic` SDK instance configured for the active provider. Claude Code supports five API providers:

| Provider | Auth mechanism | Key env vars |
|----------|---------------|-------------|
| Direct API | `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` |
| Claude.ai (OAuth) | OAuth 2.0 bearer token | OAuth tokens from login |
| AWS Bedrock | AWS credentials | `AWS_REGION`, `CLAUDE_CODE_USE_BEDROCK` |
| GCP Vertex AI | GCP service account | `ANTHROPIC_VERTEX_PROJECT_ID`, `CLOUD_ML_REGION` |
| Azure Foundry | API key or Azure AD | `ANTHROPIC_FOUNDRY_RESOURCE`, `ANTHROPIC_FOUNDRY_API_KEY` |

Region selection for Vertex AI is model-specific:

```
1. VERTEX_REGION_CLAUDE_<MODEL> (model-specific override)
2. CLOUD_ML_REGION (global default)
3. Config default
4. Fallback: us-east5
```

The client is **singleton per session** — created once and reused. It injects the user-agent header (`claude-code/<version>`) and configures proxy support via `getProxyFetchOptions()`.

### `withRetry.ts` — Retry Logic

`withRetry.ts` is the most battle-tested file in the codebase. It wraps API calls with exponential backoff and handles the full taxonomy of error types:

```
┌─────────────┐
│  API call   │
└──────┬──────┘
       │
    error?
       │
  ┌────┴────────────┬──────────────┬──────────────┬──────────────┐
  │                 │              │              │              │
429 (rate limit)  529 (overload) 5xx/network   AbortError     others
  │                 │              │              │              │
retry with        retry if        retry with    don't retry   don't retry
backoff           foreground      backoff
                  query
```

**Key constants:**

```python
DEFAULT_MAX_RETRIES = 10
BASE_DELAY_MS = 500
MAX_529_RETRIES = 3
FLOOR_OUTPUT_TOKENS = 3000  # Never shrink below this on prompt-too-long
```

**529 handling** — 529 (overload) retries only for "foreground query sources" where the user is blocking on the result:

```python
FOREGROUND_529_RETRY_SOURCES = {
    'repl_main_thread',
    'sdk',
    'agent:custom',
    'agent:default',
    'compact',
    'auto_mode',
    # ...
}
```

Background tasks (summaries, suggestions, classifiers) bail immediately on 529 — each retry during a capacity cascade is 3-10x gateway amplification, and the user never sees those fail anyway.

**Persistent retry** (`CLAUDE_CODE_UNATTENDED_RETRY`) — ant-only mode for unattended sessions. Retries 429/529 indefinitely with higher backoff caps (5 minutes max), and sends periodic heartbeat `SystemAPIErrorMessage` yields so the host environment doesn't mark the session idle.

**Fast mode cooldown** — when the fast (Opus) model is rate-limited, `withRetry.ts` triggers a cooldown period and automatically falls back to the standard model.

### `errors.ts` — Error Classification

Errors returned by the API are classified into typed categories:

| Error | Meaning |
|-------|---------|
| `PROMPT_TOO_LONG_ERROR_MESSAGE` | Context window exceeded |
| `API_ERROR_MESSAGE_PREFIX` | Generic API errors |
| `REPEATED_529_ERROR_MESSAGE` | Persistent overload |

`parsePromptTooLongTokenCounts()` extracts actual/limit token counts from prompt-too-long errors:

```
"prompt is too long: 137500 tokens > 135000 maximum"
→ { actualTokens: 137500, limitTokens: 135000 }
```

This drives the auto-compact threshold and context window warning UI.

### `usage.ts` — Rate Limit & Utilization

`fetchUtilization()` calls `GET /api/oauth/usage` to get the user's current rate limit utilization:

```python
from typing import TypedDict, Optional

class Utilization(TypedDict, total=False):
    five_hour: Optional[RateLimit]
    seven_day: Optional[RateLimit]
    seven_day_opus: Optional[RateLimit]
    seven_day_sonnet: Optional[RateLimit]
    extra_usage: Optional[ExtraUsage]
```

This data feeds the rate limit warning display in the REPL header.

### `bootstrap.ts` — Session Initialization

The bootstrap file performs session-start API calls — fetching remote feature flags, user configuration, and other session metadata before the first user interaction.

### `promptCacheBreakDetection.ts` — Cache Health Monitoring

Tracks prompt cache hits/misses. When a cache break is detected (previously-cached content is no longer in cache), `notifyCompaction()` and `notifyCacheDeletion()` update internal state so the micro-compactor knows to adjust its window.

---

## Part 2: The Compaction Service (`src/services/compact/`)

Compaction solves the context window problem: as conversations grow, they eventually exceed the model's context limit. The compaction service provides three strategies.

### Three Compaction Modes

```
Manual compact (/compact command)
    │
    └── compactConversation()
              │
              └── Summarize → truncate → inject boundary marker

Auto compact (background, threshold-based)
    │
    └── checkAutoCompact() → triggered when tokens > threshold
              │
              └── Same compactConversation() flow

Micro compact (time-based tool result trimming)
    │
    └── microCompact() → trims large tool results in-place
              │
              └── Preserves conversation structure, just shrinks content
```

### `compact.ts` — Core Compaction

`compactConversation()` is the main compaction function:

1. **Pre-compact hooks** — allows extensions to run before compaction
2. **Summarization** — runs a forked agent with a summarization prompt to distill the conversation
3. **Boundary injection** — inserts `<compact-boundary>` marker in the message history
4. **Post-compact hooks** — cleanup after compaction
5. **File state cache flush** — resets cached file contents so stale reads don't persist

The compact summary is injected as a user message, providing context for the continuing conversation without the full history.

```python
# create_compact_boundary_message() — the splice point in message history
# Messages before the boundary are dropped from API calls.
# The boundary itself carries the summary of what was before it.
```

### `autoCompact.ts` — Automatic Triggering

Auto-compact fires when token count approaches the context window limit:

```python
# Thresholds (from context window size):
AUTOCOMPACT_BUFFER_TOKENS = 13_000   # Trigger auto-compact this far from limit
WARNING_THRESHOLD_BUFFER_TOKENS = 20_000  # Show warning this far from limit
MANUAL_COMPACT_BUFFER_TOKENS = 3_000  # Reserve for manual compact output
```

**Circuit breaker**: stops retrying after `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3` consecutive failures. Without this, a session permanently over the limit would waste ~250K API calls/day globally (observed in production).

**CLAUDE_CODE_AUTO_COMPACT_WINDOW** — env var override for testing: forces the effective context window to a lower value to trigger auto-compact sooner.

### `microCompact.ts` — Time-Based Tool Result Trimming

Micro-compact is a lighter-weight operation that trims large tool results **in-place** without summarizing the conversation:

```python
COMPACTABLE_TOOLS = {
    FILE_READ_TOOL_NAME,   # Large file reads
    SHELL_TOOL_NAMES,      # Long command outputs
    GREP_TOOL_NAME,
    GLOB_TOOL_NAME,
    WEB_SEARCH_TOOL_NAME,
    WEB_FETCH_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
}
```

Old tool results beyond a configurable time window are replaced with `[Old tool result content cleared]`. Images in tool results are also compacted when they exceed `IMAGE_MAX_TOKEN_SIZE = 2000` tokens.

The `timeBasedMCConfig.ts` provides per-model, dynamically configured thresholds via GrowthBook.

### `grouping.ts` — Compaction Grouping

Groups tool calls for smarter compaction decisions — related tool calls (e.g., a read followed by an edit of the same file) are kept together so the summary doesn't lose the relationship between them.

---

## Part 3: Analytics (`src/services/analytics/`)

### Architecture

```
logEvent('event_name', metadata)
    │
    └── queued until attachAnalyticsSink() called at startup
              │
              ├── GrowthBook experiment tracking
              ├── DataDog metrics
              └── 1P event logging (first-party, Anthropic internal)
```

The `index.ts` module is a **dependency graph leaf** — it imports nothing. Events queue until the sink attaches.

### Type Safety for Analytics Metadata

The codebase enforces strict type safety around what goes into analytics:

```python
from typing import NewType

# Forces developers to verify strings don't contain PII
AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = NewType(
    'AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS', str
)

# Forces developers to declare PII-tagged fields explicitly
AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = NewType(
    'AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED', str
)
```

Usage:
```python
log_event('tengu_tool_use', {
    'tool_name': AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(sanitized_name),
})
```

This type casting requirement makes it impossible to accidentally log sensitive data without explicitly acknowledging it.

`_PROTO_*` keys are special: they're stripped from DataDog and general storage, but the 1P event logger hoists them to proto fields with privileged access controls.

### GrowthBook (`growthbook.ts`) — Feature Flags & Experiments

GrowthBook provides remote feature flags (called "feature gates" and "experiments") that control behavior without requiring a new release:

```python
# Check if a feature is enabled (cached, may be stale)
check_statsig_feature_gate_CACHED_MAY_BE_STALE('tengu_scratch')

# Get a feature value (cached, may be stale)
get_feature_value_CACHED_MAY_BE_STALE('tengu_passport_quail', False)
```

GrowthBook attributes sent for targeting:
```python
from typing import TypedDict, Literal, Optional

class GrowthBookUserAttributes(TypedDict, total=False):
    id: str                         # Device UUID
    session_id: str
    platform: Literal['win32', 'darwin', 'linux']
    organization_uuid: str
    account_uuid: str
    subscription_type: str          # 'claude_pro', 'claude_free', etc.
    first_token_time: float         # First API use timestamp (for cohort analysis)
```

The `_CACHED_MAY_BE_STALE` suffix in function names is a deliberate warning — these check a locally-cached value that may not reflect the latest remote configuration.

### DataDog (`datadog.ts`) — Metrics

DataDog receives aggregated metrics (not individual events). Metrics are buffered and flushed periodically to avoid per-event API overhead.

### First-Party Event Logging

The 1P event logger sends structured events to Anthropic's internal data pipeline. It handles proto-field hoisting, strips PII where appropriate, and manages the BigQuery schema mapping.

**`sinkKillswitch.ts`** — A kill switch that can disable all analytics reporting when triggered remotely.

---

## Part 4: Tool Execution (`src/services/tools/`)

### `toolOrchestration.ts` — Parallel vs. Serial Execution

`runTools()` orchestrates tool call batches from the LLM:

```python
from typing import AsyncGenerator

async def run_tools(
    tool_use_messages: list[ToolUseBlock],
    assistant_messages: list[AssistantMessage],
    can_use_tool: CanUseToolFn,
    tool_use_context: ToolUseContext,
) -> AsyncGenerator[MessageUpdate, None]: ...
```

Tools within a single LLM turn are partitioned by `isConcurrencySafe`:

```
Tool calls in one LLM response
    │
    ├── All concurrency-safe (read-only)?  → runToolsConcurrently()
    │                                           max 10 concurrent
    │                                           (CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY)
    │
    └── Any write-heavy?  → runToolsSerially()
                                one at a time
```

Context modifications from concurrent tools are queued and applied in order after the batch completes, ensuring deterministic context updates.

### `toolExecution.ts` — Per-Tool Execution

`runToolUse()` handles a single tool invocation:

1. **Permission check** — `canUseTool()` gate (hooks into permission system)
2. **Pre-execution hooks** — `executePreToolUseHooks()`
3. **Progress streaming** — tool can yield `ToolProgress` updates during execution
4. **Speculative classifier** — for BashTool, starts a concurrent security classifier
5. **Result handling** — wraps result in `ToolResultBlockParam`
6. **Analytics** — logs tool use with metadata (sanitized tool name, file extension, duration)
7. **Post-execution hooks** — `executePostToolUseHooks()`

**`StreamingToolExecutor.ts`** — Handles tools that stream their output progressively (primarily BashTool for long-running commands). Streams progress updates to the UI while the command runs.

### `toolHooks.ts` — Hook Execution

Manages the execution of user-defined hooks around tool calls:

```python
# Pre-tool-use hook: runs before the tool executes
await execute_pre_tool_use_hooks(tool_name, input)

# Post-tool-use hook: runs after, can modify the result
await execute_post_tool_use_hooks(tool_name, input, output)

# Permission denied hook: runs when a permission check fails
await execute_permission_denied_hooks(tool_name, input)

# Notification hook: runs when a notification is sent
await execute_notification_hooks(notification)
```

Hooks are shell commands defined in `settings.json` and executed via `BashTool`'s sandboxed executor. Hook output can inject additional context into the conversation as `HookResultMessage` attachments.

---

## Part 5: LSP Integration (`src/services/lsp/`)

The Language Server Protocol (LSP) service lets Claude Code query IDE-level intelligence (go-to-definition, diagnostics, hover) without requiring an IDE.

### `LSPServerManager.ts` — Server Lifecycle

`createLSPServerManager()` returns a manager that routes requests to the appropriate LSP server based on file extension:

```python
from typing import Protocol, Optional, Any
from collections.abc import Awaitable

class LSPServerManager(Protocol):
    async def initialize(self) -> None: ...
    async def shutdown(self) -> None: ...
    def get_server_for_file(self, file_path: str) -> Optional[LSPServerInstance]: ...
    async def ensure_server_started(self, file_path: str) -> Optional[LSPServerInstance]: ...
    async def send_request(self, file_path: str, method: str, params: Any) -> Any: ...
    async def open_file(self, file_path: str, content: str) -> None: ...
    async def change_file(self, file_path: str, content: str) -> None: ...
    async def save_file(self, file_path: str) -> None: ...
    async def close_file(self, file_path: str) -> None: ...
    def is_file_open(self, file_path: str) -> bool: ...
```

LSP servers are configured in `settings.json`:

```json
{
  "lsp": {
    "typescript": {
      "command": "typescript-language-server --stdio",
      "extensions": [".ts", ".tsx"]
    }
  }
}
```

### `LSPClient.ts` — Protocol Communication

Implements the JSON-RPC protocol layer. Handles:
- Request/response correlation via sequential request IDs
- Notification dispatch (server → client)
- Connection lifecycle (initialize → ready → shutdown)

### `LSPDiagnosticRegistry.ts` — Diagnostic Aggregation

Aggregates diagnostics (errors, warnings) published by LSP servers. The `LSPTool` (Chapter 8) queries this registry to surface compile errors and type issues in the conversation.

### `passiveFeedback.ts` — Background Diagnostics

Runs periodic diagnostic collection in the background. When the model edits a file, the LSP server's diagnostics for that file are automatically injected into the next conversation turn as context.

---

## Part 6: OAuth (`src/services/oauth/`)

The OAuth service handles the Claude.ai subscriber authentication flow.

### `client.ts` — Token Management

```python
# Token lifecycle:
# 1. Login: initiate OAuth flow, receive authorization code
# 2. Exchange: code → access token + refresh token
# 3. Refresh: use refresh token when access token expires
# 4. Revoke: on logout
```

`isOAuthTokenExpired()` checks expiry before making API calls, avoiding 401 round-trips.

### `auth-code-listener.ts` — Local Callback Server

Starts a local HTTP server on a random port to receive the OAuth authorization code callback from the browser. The redirect URI is `http://localhost:<port>/callback`.

### `crypto.ts` — PKCE

Implements PKCE (Proof Key for Code Exchange) for the OAuth flow:
- Generates a cryptographically random `code_verifier`
- Derives `code_challenge` via SHA-256
- Prevents authorization code interception attacks

---

## Part 7: Voice Services

Three files handle voice input:

### `voice.ts` — Audio Recording

Manages push-to-talk audio recording with multiple fallback backends:

```
1. audio-capture-napi (native, lazy-loaded to avoid startup dlopen delay)
   Platform: macOS (CoreAudio), Linux (ALSA), Windows

2. SoX rec command
   Platform: Linux/macOS with SoX installed

3. arecord (ALSA)
   Platform: Linux
```

Recording parameters: 16kHz, mono (optimized for speech recognition). Silence detection stops recording after 2 seconds of silence below 3% threshold (SoX backend).

The `audio-capture-napi` module is **lazy-loaded on first voice keypress** to avoid a 1-8 second startup freeze from `dlopen`.

### `voiceStreamSTT.ts` — Streaming Speech-to-Text

Streams audio bytes to the Anthropic API's speech-to-text endpoint. Returns a streaming transcript so the user can see text appearing as they speak.

### `voiceKeyterms.ts` — Keyword Detection

Detects specific keywords (wake words, commands) in the audio stream for hands-free interaction.

---

## Part 8: Remaining Services

### `vcr.ts` — API Recording/Replay

The VCR (Video Cassette Recorder) service records API calls to fixture files and replays them in tests:

```python
# Active in TEST_ENV=1 or FORCE_VCR=1 (ant-only)
# Fixture file: fixtures/<name>-<sha1-of-input>.json

from typing import TypeVar, Callable, Awaitable, Any
T = TypeVar('T')

async def with_fixture(
    input: Any,
    fixture_name: str,
    f: Callable[[], Awaitable[T]],
) -> T: ...
```

Fixtures are keyed by SHA1 hash of the input. Cache hit → return stored response. Cache miss → call real API, store result.

This allows tests to run without live API access and makes them deterministic. The VCR is used for token counting (`withTokenCountVCR()`) and API responses.

### `notifier.ts` — Desktop Notifications

`sendNotification()` dispatches notifications through one of several channels:

```python
# Channel selection (from config.preferred_notif_channel):
# 'auto'             → detect best available channel
# 'iterm2'           → iTerm2 OSC escape sequence
# 'iterm2_with_bell' → iTerm2 + terminal bell
# 'kitty'            → Kitty notification protocol
# 'terminal-bell'    → Basic terminal bell (\x07)
# 'system'           → OS notification (osascript/notify-send/PowerShell)
```

Notification hooks run before channel dispatch, allowing custom notification handlers.

### `rateLimitMessages.ts` — Rate Limit Messaging

Central source of truth for all rate limit message strings. The UI components use `isRateLimitErrorMessage()` and `getRateLimitMessage()` rather than hardcoded string patterns:

```python
RATE_LIMIT_ERROR_PREFIXES = [
    "You've hit your",
    "You've used",
    "You're now using extra usage",
    "You're close to",
    "You're out of extra usage",
]
```

### `tokenEstimation.ts` — Offline Token Counting

Provides token count estimates without an API round-trip. Uses `roughTokenCountEstimation()` based on character count approximations. Used when the exact count isn't critical (UI display, early warnings).

For exact counting, `tokenCountWithEstimation()` uses the Anthropic API's token counting endpoint, with VCR caching in test environments.

### `diagnosticTracking.ts` — Session Health

Tracks session health metrics: tool errors, API failures, recovery attempts. Used for internal monitoring and debugging.

### `preventSleep.ts` — System Sleep Prevention

On macOS, prevents system sleep during long-running operations using `caffeinate`. On other platforms, no-op.

### Tips (`src/services/tips/`)

The tips service manages the occasional helpful tips shown in the REPL. It maintains a history of shown tips, respects a minimum interval between tips, and draws from a registry of categorized tips.

### Agent Summary (`src/services/AgentSummary/`)

Generates concise summaries of agent task results for display in the tasks panel and notifications. Uses a side-query to Sonnet with a summary-focused prompt.

### Prompt Suggestion (`src/services/PromptSuggestion/`)

Speculative prompt completion — starts a background inference while the user is typing to precompute likely next prompts. Results are cached and displayed if the user's actual prompt matches the speculation.

### x402 (`src/services/x402/`)

The x402 payment protocol service — handles micropayment negotiation for paid API services. Named after HTTP status code 402 ("Payment Required").

### Settings Sync (`src/services/settingsSync/`)

Syncs settings changes between the CLI process and connected IDE extensions via the bridge (Chapter 14).

---

## How the Service Layer Connects to the Query Engine

```
User input
    │
    ▼
QueryEngine.ts
    │
    ├── api/claude.ts         ← Makes streaming API call
    │        │
    │        └── withRetry.ts ← Wraps with retry logic
    │
    ├── compact/autoCompact.ts ← Checks token threshold each turn
    │
    ├── tools/toolOrchestration.ts ← Runs tool calls in LLM response
    │        │
    │        └── tools/toolExecution.ts ← Executes each tool
    │
    ├── analytics/index.ts    ← Logs events throughout
    │
    └── tokenEstimation.ts    ← Updates token count display
```

The service layer is "invisible infrastructure" — it makes the query engine reliable, observable, and manageable without the query engine needing to know the details of any individual service.

---

*Next: [Chapter 18 — State Management](PartVI-Services-Infrastructure-18-State-Management.md)*


\newpage

# Chapter 18: State Management

> **Part VI: Services & Infrastructure**

---

## Overview

Claude Code's state management sits at the intersection of terminal UI (Ink/React) and a non-React event system (the query engine, tool execution). The design uses a **custom observable store** that bridges these two worlds without triggering excessive React re-renders in the terminal.

```
src/state/
├── AppStateStore.ts        ← AppState type + getDefaultAppState()
├── AppState.tsx            ← AppStateProvider component (React tree root)
├── store.ts                ← createStore() — the generic observable store
├── selectors.ts            ← Pure derived-state functions
├── onChangeAppState.ts     ← Side-effects triggered by state changes
└── teammateViewHelpers.ts  ← Team-specific view state helpers

src/context/
├── QueuedMessageContext.tsx   ← Message rendering metadata
├── fpsMetrics.tsx             ← FPS performance metrics
├── mailbox.tsx                ← Teammate mailbox polling
├── modalContext.tsx           ← Slash-command dialog context
├── notifications.tsx          ← In-app notification queue
├── overlayContext.tsx         ← Overlay rendering
├── promptOverlayContext.tsx   ← Prompt overlay (speculative input)
├── stats.tsx                  ← Session statistics
└── voice.tsx                  ← Voice input state (ant-only)
```

---

## The Core Store (`store.ts`)

`createStore<T>()` is a minimal observable state container:

```python
from typing import TypeVar, Generic, Callable, Optional

T = TypeVar('T')

class Store(Generic[T]):
    def get_state(self) -> T: ...
    def set_state(self, updater: Callable[[T], T]) -> None: ...
    def subscribe(self, listener: Callable[[], None]) -> Callable[[], None]: ...

def create_store(
    initial_state: T,
    on_change: Optional[Callable[[dict], None]] = None,
) -> Store[T]:
    state = initial_state
    listeners: set[Callable[[], None]] = set()

    class _Store(Store[T]):
        def get_state(self) -> T:
            return state

        def set_state(self, updater: Callable[[T], T]) -> None:
            nonlocal state
            prev = state
            next_ = updater(prev)
            if next_ is prev:  # ← no-op if reference unchanged
                return
            state = next_
            if on_change:
                on_change({'new_state': next_, 'old_state': prev})
            for listener in listeners:
                listener()

        def subscribe(self, listener: Callable[[], None]) -> Callable[[], None]:
            listeners.add(listener)
            return lambda: listeners.discard(listener)  # ← unsubscribe

    return _Store()
```

**Key behaviors:**
- `setState` takes an **updater function** (not a direct value) — ensures atomic read-modify-write
- **Reference equality guard**: `Object.is(next, prev)` prevents spurious re-renders when no value changed
- `subscribe` returns an unsubscribe function (standard React external store pattern)
- `onChange` is called synchronously after each state change — used for session sync side effects

This is the same pattern as Zustand, Redux, or Jotai atoms, but hand-rolled to avoid dependencies and maintain full control over the update cycle.

---

## `AppStateStore.ts` — The Application State Type

`AppState` is a large flat type covering the entire application's mutable state:

```python
from typing import Optional
from typing_extensions import TypedDict
from typing import Literal

class AppState(TypedDict):
    # Settings & Configuration
    settings: SettingsJson
    verbose: bool
    main_loop_model: ModelSetting
    main_loop_model_for_session: ModelSetting

    # UI State
    status_line_text: Optional[str]
    expanded_view: Literal['none', 'tasks', 'teammates']
    is_brief_only: bool
    footer_selection: Optional[FooterItem]    # footer pill keyboard focus

    # Coordinator/Swarm UI
    selected_ip_agent_index: int
    coordinator_task_index: int
    view_selection_mode: Literal['none', 'selecting-agent', 'viewing-agent']
    show_teammate_message_preview: bool

    # Tool Permissions
    tool_permission_context: ToolPermissionContext

    # Task Management
    tasks: dict[str, TaskState]

    # Agent & Teams
    agent: Optional[str]
    kairos_enabled: bool
    remote_session_url: Optional[str]

    # MCP
    mcp_servers: list[MCPServerConnection]

    # Plugins
    plugins: PluginsState

    # Commands & Skills
    commands: list[Command]

    # Planning
    plan_draft: Optional[AllowedPrompt]

    # Speculation
    speculation_state: SpeculationState

    # Attribution
    attribution: AttributionState

    # ... many more fields
```

`DeepImmutable<T>` is a recursive readonly wrapper — every nested object and array is frozen at the type level, preventing accidental mutation. All state changes must go through `setState()`.

`getDefaultAppState()` creates the initial state from settings, environment, and runtime configuration.

---

## `AppState.tsx` — The React Provider

`AppStateProvider` is the root component that wraps the entire UI tree. It:

1. Creates the `Store<AppState>` instance via `useState(() => createStore(...))`
2. Passes the store down via `AppStoreContext`
3. Sets up settings change listeners via `useSettingsChange()`
4. Validates bypass-permissions mode on mount
5. Wraps children in `MailboxProvider` and `VoiceProvider`

```tsx
// AppState.tsx — provider composition:
<HasAppStateContext.Provider value={true}>
  <AppStoreContext.Provider value={store}>
    <MailboxProvider>
      <VoiceProvider>   {/* ant-only, feature-gated */}
        {children}
      </VoiceProvider>
    </MailboxProvider>
  </AppStoreContext.Provider>
</HasAppStateContext.Provider>
```

**Nesting prevention**: `HasAppStateContext` throws an error if `AppStateProvider` is nested inside itself. This catches accidental double-wrapping in development.

**React Compiler optimization**: The file uses the React Compiler's `_c()` memoization primitives throughout — every JSX element and computed value is memoized at the compiled level, not via manual `useMemo()` calls. This is visible in the compiled output as `$[0]`, `$[1]`, etc. keyed arrays.

### Connecting React to the Store

Components access state via `useSyncExternalStore()`:

```python
# Inside use_app_state() or use_app_store():
# useSyncExternalStore equivalent: subscribe to the store and
# re-render whenever the store notifies listeners.
state = use_sync_external_store(
    store.subscribe,
    store.get_state,
    store.get_state,  # server snapshot (same — no SSR)
)
```

`useSyncExternalStore` is React 18's official hook for integrating external state. It handles:
- Subscribing to store updates
- Providing the current snapshot for rendering
- Tearing-prevention (concurrent mode safe)

### Setting State from Outside React

Non-React code (tool execution, query engine) receives `setAppState` as a callback:

```python
from typing import Callable

SetAppState = Callable[[Callable[['AppState'], 'AppState']], None]
```

This function is passed from the React tree down into the query engine at session initialization time, threading React's state system into non-React code without creating a circular dependency.

```
QueryEngine (non-React)
    │
    └── setAppState(prev => ({ ...prev, tasks: { ...prev.tasks, [id]: task } }))
              │
              └── store.setState() → listeners notified → React re-renders
```

---

## `onChangeAppState.ts` — State Change Side Effects

Every state change fires `onChangeAppState()`. This is the **single choke point** for state-driven side effects:

```python
def on_change_app_state(new_state: AppState, old_state: AppState) -> None:
    # 1. Permission mode sync
    if (new_state['tool_permission_context']['mode']
            != old_state['tool_permission_context']['mode']):
        notify_permission_mode_changed(new_state['tool_permission_context']['mode'])

    # 2. Session metadata sync (for CCR / remote workers)
    if _relevant_session_fields_changed(new_state, old_state):
        notify_session_metadata_changed({
            'permission_mode': to_external_permission_mode(
                new_state['tool_permission_context']['mode']
            ),
            'is_ultraplan_mode': new_state['is_ultraplan_mode'],
        })

    # 3. Model override sync
    if new_state['main_loop_model'] != old_state['main_loop_model']:
        set_main_loop_model_override(new_state['main_loop_model'])

    # 4. Settings persistence
    if new_state['settings'] is not old_state['settings']:
        update_settings_for_source(new_state['settings'])
```

Prior to this architecture, permission mode changes were relayed to CCR/SDK by only 2 of 8+ mutation paths — a known bug where the web UI showed stale mode. `onChangeAppState` fixed this by making state sync automatic on every change, regardless of which code path triggered the mutation.

---

## `selectors.ts` — Pure State Derivations

Selectors compute derived state from `AppState` without mutation:

```python
from typing import Optional, Union
from typing_extensions import TypedDict

# get_viewed_teammate_task() — null-safe lookup
def get_viewed_teammate_task(
    app_state: 'AppState',  # uses only viewing_agent_task_id and tasks
) -> Optional['InProcessTeammateTaskState']:
    ...

# get_active_agent_for_input() — where user input is routed
class ActiveAgentLeader(TypedDict):
    type: Literal['leader']

class ActiveAgentViewed(TypedDict):
    type: Literal['viewed']
    task: 'InProcessTeammateTaskState'

class ActiveAgentNamed(TypedDict):
    type: Literal['named_agent']
    task: 'LocalAgentTaskState'

ActiveAgentForInput = Union[ActiveAgentLeader, ActiveAgentViewed, ActiveAgentNamed]

def get_active_agent_for_input(app_state: 'AppState') -> ActiveAgentForInput:
    ...
```

`getActiveAgentForInput` is used by the input routing logic to direct user messages to the correct agent in swarm mode. The discriminated union type makes exhaustive handling safe.

---

## `src/context/` — React Contexts

The `context/` directory holds **feature-scoped React contexts** that are narrower than `AppState`. Rather than putting everything in the global store, some state lives in dedicated contexts:

### `QueuedMessageContext.tsx`

Provides metadata to message rendering components:

```python
from typing_extensions import TypedDict

class QueuedMessageContextValue(TypedDict):
    is_queued: bool       # Is this message in a queued batch?
    is_first: bool        # Is this the first message in the queue?
    padding_width: int    # Width reduction for container padding
```

Used by `QueuedMessageProvider` to wrap batches of queued messages with consistent layout metadata. Avoids prop-drilling through the message rendering tree.

### `fpsMetrics.tsx`

Provides FPS (frames-per-second) performance metrics to any component:

```python
from typing import Callable, Optional

FpsMetricsGetter = Callable[[], Optional['FpsMetrics']]

# Access:
get_fps_metrics: Optional[FpsMetricsGetter] = use_fps_metrics()
metrics = get_fps_metrics() if get_fps_metrics is not None else None
```

The getter pattern (function rather than direct value) avoids subscribing every consumer to every frame update. Components can choose when to call the getter.

### `modalContext.tsx`

Set by `FullscreenLayout` when rendering slash-command dialogs in the modal slot:

```python
from typing import Optional
from typing_extensions import TypedDict

class ModalCtx(TypedDict):
    rows: int                                   # Available rows in the modal (smaller than terminal)
    columns: int
    scroll_ref: Optional['Ref[Optional[ScrollBoxHandle]]']  # ref to scroll handle, or None
```

Three purposes:
1. **Suppress framing**: `Pane` skips its top divider (the modal already draws one)
2. **Correct pagination**: `Select` components know the actual available rows (not terminal height)
3. **Scroll reset**: Tab switches can reset scroll position via `scrollRef`

```python
# Use inside modals instead of use_terminal_size():
modal_size = use_modal_or_terminal_size(terminal_size)
rows, columns = modal_size['rows'], modal_size['columns']
```

### `notifications.tsx`

In-app notification queue for transient messages (not OS notifications):

```python
# Usage:
notifications = use_notifications()
notifications.add_notification(message="Memory saved", type="success")
```

Notifications automatically dismiss after a timeout. The context handles the queue management so callers don't need to track dismissal themselves.

### `overlayContext.tsx` and `promptOverlayContext.tsx`

**Overlay context**: provides an overlay rendering slot for content that needs to render above the normal UI hierarchy (e.g., permission dialogs, confirmation prompts).

**Prompt overlay context**: provides the speculative input overlay — when speculation is active, a ghost preview of the predicted prompt renders in the input area.

### `stats.tsx`

Session statistics context:

```python
# Token counts, tool use counts, duration
# Displayed in footer pill and /stats command output
```

### `mailbox.tsx`

Provides the teammate mailbox polling context. When in swarm mode, `MailboxProvider` wraps the tree and polls each teammate's inbox at regular intervals.

### `voice.tsx`

Ant-only voice input state. Feature-gated via `feature('VOICE_MODE')`:

```python
# In app_state.py:
if feature('VOICE_MODE'):
    from context.voice import VoiceProvider
else:
    def VoiceProvider(children):  # passthrough in external builds
        return children
```

Voice state includes: recording status, current transcript, STT configuration.

---

## Data Flow

### User Input → State

```
User types in PromptInput
    │
    ▼
REPL.tsx dispatches action
    │
    ▼
store.setState(updater)
    │
    ├── onChangeAppState() (side effects)
    └── listeners notified → useSyncExternalStore triggers re-render
```

### Tool Execution → State

```
QueryEngine calls runTools()
    │
    ▼
toolExecution.ts calls setAppState()
    │
    ▼
Task state updated: tasks[id] = { ...task, status: 'running' }
    │
    ▼
React re-renders TasksPill with new task status
```

### Settings Change → State

```
User edits settings.json (file watcher)
    │
    ▼
useSettingsChange() fires
    │
    ▼
applySettingsChange(source, store.setState)
    │
    ▼
settings field updated in AppState
    │
    ├── onChangeAppState() (re-applies env vars, clears caches)
    └── Components re-render with new settings
```

---

## Performance Considerations

### Immutability and Reference Equality

Every `setState` call must return a **new object reference** if anything changed, or the **same reference** if nothing changed. The `Object.is(next, prev)` guard in `createStore` relies on this.

```python
# Good — new reference only when changed:
def update_task_status(prev: AppState) -> AppState:
    task = prev['tasks'].get(id)
    if task is not None and task.get('status') == new_status:
        return prev  # same reference — no re-render triggered
    return {
        **prev,
        'tasks': {
            **prev['tasks'],
            id: {**prev['tasks'].get(id, {}), 'status': new_status},
        },
    }

store.set_state(update_task_status)

# Bad — always creates new reference even if nothing changed:
store.set_state(lambda prev: {**prev})
```

Spread operators create new object references, so deep spreads are only appropriate when something actually changed.

### Task State — Avoiding Full Re-renders

`AppState.tasks` is a `Record<string, TaskState>`. Updating a single task must spread only the `tasks` map:

```python
store.set_state(lambda prev: {
    **prev,
    'tasks': {
        **prev['tasks'],
        task_id: {**prev['tasks'].get(task_id, {}), **update},
    },
})
```

Only components that read `tasks[taskId]` will re-render — other tasks aren't affected (assuming memoization via `React.memo` or React Compiler's automatic memoization).

### FPS Throttling

The UI renders at most N times per second, controlled by `fpsMetrics.tsx`. This prevents the terminal from flickering during high-frequency state updates (streaming tool output, progress counters).

The FPS throttle works by debouncing `store.subscribe` listener calls — state changes are still applied immediately, but re-renders are batched within a frame window.

---

## State Persistence

Most `AppState` is ephemeral (session-scoped). Persistent state lives elsewhere:
- **Settings** (`settings.json`) — loaded at startup, saved on change via `updateSettingsForSource()`
- **Session metadata** — written to session sidecar for `--resume`
- **Tasks** — task output files on disk; state reconstructed on resume
- **Permission grants** — stored in `toolPermissionContext`, persisted to session

---

*Next: [Chapter 19 — Configuration & Schemas](PartVI-Services-Infrastructure-19-Configuration-Schemas.md)*


\newpage

# Chapter 19: Configuration & Schemas

> **Part VI: Services & Infrastructure**

---

## Overview

Claude Code has a rich, layered configuration system. Understanding it is essential for power users (who want fine-grained control) and developers (who extend or deploy Claude Code). This chapter covers the full settings hierarchy, the Zod v4 schema definitions, migration scripts, and the runtime settings APIs.

---

## The Five-Source Settings Hierarchy

Settings load from five sources in priority order (later sources override earlier ones):

```
Priority (lowest → highest):
┌─────────────────────────────────────────────┐
│  1. userSettings    ~/.claude/settings.json  │
│                                             │
│  2. projectSettings .claude/settings.json   │
│                                             │
│  3. localSettings   .claude/settings.local.json │
│                                             │
│  4. flagSettings    --settings <path>       │
│                                             │
│  5. policySettings  managed-settings.json   │  ← highest priority
└─────────────────────────────────────────────┘
```

```python
# src/utils/settings/constants.py
from typing import Literal

SettingSource = Literal[
    "userSettings",    # User preferences, global
    "projectSettings", # Team-shared, committed to git
    "localSettings",   # Personal project overrides, gitignored
    "flagSettings",    # --settings CLI flag
    "policySettings",  # Enterprise policy (managed-settings.json + drop-ins)
]

SETTING_SOURCES: tuple[SettingSource, ...] = (
    "userSettings",
    "projectSettings",
    "localSettings",
    "flagSettings",
    "policySettings",
)
```

### What Belongs Where

| Source | File | Committed? | Who owns it |
|--------|------|-----------|-------------|
| `userSettings` | `~/.claude/settings.json` | N/A (home dir) | Individual developer |
| `projectSettings` | `.claude/settings.json` | Yes | Team |
| `localSettings` | `.claude/settings.local.json` | No (gitignored) | Individual, per-project |
| `flagSettings` | `<custom path>` | Varies | CI/automation |
| `policySettings` | `managed-settings.json` | N/A (system path) | IT / enterprise admin |

### Merge Behavior

Settings are **merged, not replaced**. Arrays use append semantics unless the policy specifies otherwise. The merge customizer handles special cases like permission rule deduplication and MCP server lists.

```python
# settings.py uses a recursive merge with settings_merge_customizer()
# Arrays are generally appended (allow rules from multiple sources stack)
# Policy settings take final precedence on conflicts
```

### Managed Settings (Enterprise)

`policySettings` loads from two places:
1. **`managed-settings.json`** — base policy file (system-level path, platform-specific)
2. **`managed-settings.d/*.json`** — drop-in directory (sorted alphabetically)

Drop-in files allow separate teams to ship independent policy fragments without coordinating edits to a single admin file. Files are merged in alphabetical order: `10-network.json`, `20-security.json`, etc.

There is also an API-sourced policy from `remoteManagedSettings/` — fetched from Anthropic's API for organization-level configuration.

**Security note**: `projectSettings` (`.claude/settings.json`, committed to the repo) is intentionally excluded from sensitive configuration options like `autoMemoryDirectory`. A malicious repo could otherwise gain silent write access to `~/.ssh` by setting `autoMemoryDirectory: "~/.ssh"`.

### The `--settings` Flag

The `flagSettings` source loads from a path specified with `--settings <file>`. Used for:
- CI/CD environments that need different permissions
- Automation scripts with fixed model selection
- Testing with isolated configuration

---

## `src/utils/settings/types.py` — The Settings Schema

The `SettingsSchema` is defined using **Pydantic v2** with lazy validators for tree-shaking (unused schema branches can be eliminated from the binary).

### Complete Settings Reference

```python
# Major sections of SettingsJson (as a TypedDict):
from typing import TypedDict, Literal, NotRequired

PermissionMode = Literal["default", "acceptEdits", "plan", "auto"]

class PermissionsConfig(TypedDict):
    allow: NotRequired[list[str]]              # Always allow these operations
    deny: NotRequired[list[str]]               # Always deny these operations
    ask: NotRequired[list[str]]                # Always prompt for these
    default_mode: NotRequired[PermissionMode]  # 'default' | 'acceptEdits' | 'plan' | 'auto'
    disable_bypass_permissions_mode: NotRequired[Literal["disable"]]
    additional_directories: NotRequired[list[str]]

class StdioMcpServer(TypedDict):
    command: str                               # stdio server
    args: NotRequired[list[str]]
    env: NotRequired[dict[str, str]]

class RemoteMcpServer(TypedDict):
    url: str                                   # remote server
    api_key: NotRequired[str]

class SettingsJson(TypedDict):
    schema_: NotRequired[str]                  # JSON Schema URL for IDE validation

    # ── Model & API ──────────────────────────────────────────────────────────
    model: NotRequired[str]                    # 'sonnet', 'opus', 'haiku', or full model ID
    small_fast_model: NotRequired[str]         # Override for small/fast model (Haiku)

    # ── Permissions ──────────────────────────────────────────────────────────
    permissions: NotRequired[PermissionsConfig]

    # ── Environment Variables ─────────────────────────────────────────────────
    env: NotRequired[dict[str, str]]           # Injected into every session

    # ── MCP Servers ───────────────────────────────────────────────────────────
    mcp_servers: NotRequired[dict[str, StdioMcpServer | RemoteMcpServer]]

    # ── Plugins ───────────────────────────────────────────────────────────────
    enabled_plugins: NotRequired[dict[str, bool]]
    plugins: NotRequired[list]                 # ExtraKnownMarketplace entries

    # ── Hooks ─────────────────────────────────────────────────────────────────
    hooks: NotRequired["HooksSettings"]        # Pre/post tool-use hooks

    # ── Memory ────────────────────────────────────────────────────────────────
    auto_memory_enabled: NotRequired[bool]
    auto_memory_directory: NotRequired[str]    # Custom path (trusted sources only)

    # ── LSP ───────────────────────────────────────────────────────────────────
    lsp: NotRequired[dict[str, "LspServerConfig"]]

    # ── Behavior ──────────────────────────────────────────────────────────────
    verbose_output: NotRequired[bool]
    auto_updater_status: NotRequired[Literal["enabled", "disabled", "no_binary_found"]]
    preferred_notif_channel: NotRequired[str]
    has_trust_dialog_accepted: NotRequired[bool]

    # ── Session ───────────────────────────────────────────────────────────────
    include_co_authored_by: NotRequired[bool]
    default_flags: NotRequired[list[str]]      # Default CLI flags for every session

    # ── Feature Flags ─────────────────────────────────────────────────────────
    enabled_feature_flags: NotRequired[list[str]]
    disabled_feature_flags: NotRequired[list[str]]

    # ── Custom Commands ───────────────────────────────────────────────────────
    custom_commands: NotRequired[list]

    # ── Enterprise / Cowork ───────────────────────────────────────────────────
    allowed_mcp_servers: NotRequired[list]     # Allowlist for enterprise

    # ── Sandbox (macOS) ───────────────────────────────────────────────────────
    sandbox: NotRequired["SandboxSettings"]
```

### Permission Rule Syntax

Permission rules use a compact string syntax:

```
"Tool"                → Allow/deny all operations for this tool
"Bash(command)"       → Exact match on Bash command
"Bash(git:*)"         → Prefix wildcard — matches 'git status', 'git commit', etc.
"Edit(/src/**)"       → Path glob
"Read"                → Allow all Read operations
"WebFetch(domain.com:*)" → Domain-scoped fetch
```

Rules are validated by `PermissionRuleSchema` and `permissionValidation.py`, which rejects malformed patterns before they reach the permission check.

### Hooks Schema (`src/schemas/hooks.py`)

The hooks schema is in its own file (imported by `types.py`) to avoid circular dependencies:

```python
from typing import TypedDict, NotRequired

class HookCommand(TypedDict):
    type: str                                  # Always 'command'
    command: str                               # Shell command to run
    timeout: NotRequired[int]                  # Timeout in ms

class HookMatcher(TypedDict):
    tool_name: NotRequired[str]                # Which tool name to match

class BashCommandHook(TypedDict):
    matcher: NotRequired[HookMatcher]          # Which tools to match
    hooks: list[HookCommand]                   # Commands to execute

class PromptHook(TypedDict):
    hooks: list[HookCommand]

class HooksSettings(TypedDict):
    pre_tool_use: NotRequired[list[BashCommandHook]]   # Before any tool runs
    post_tool_use: NotRequired[list[BashCommandHook]]  # After any tool runs
    stop: NotRequired[list[PromptHook]]                # End of turn (final response)
    notification: NotRequired[list[BashCommandHook]]   # When a notification is sent
```

Hooks are shell commands that execute in response to events. Their stdout is parsed for special directives (e.g., `{"decision": "deny", "reason": "..."}` from a PreToolUse hook blocks tool execution).

---

## `src/utils/settings/settings.py` — Runtime API

### Loading Settings

```python
from functools import lru_cache
from typing import Optional

# Get merged settings (all sources combined):
def get_initial_settings() -> SettingsJson: ...

# Get settings from a specific source (unmixed):
def get_settings_for_source(source: SettingSource) -> Optional[SettingsJson]: ...

# Get merged settings with validation errors:
def get_settings_deprecated() -> SettingsJson: ...  # Returns merged but may include invalid fields
```

`get_initial_settings()` is memoized — called once at startup, cached for the session. Use `reset_settings_cache()` in tests.

### Writing Settings

```python
from typing import Literal

EditableSettingSource = Literal["userSettings", "projectSettings", "localSettings"]

# Update a specific source (merges with existing, not a full overwrite):
def update_settings_for_source(
    source: EditableSettingSource,  # 'userSettings' | 'projectSettings' | 'localSettings'
    update: dict,                   # Partial SettingsJson
) -> None: ...
```

`EditableSettingSource` excludes `policySettings` and `flagSettings` — policy files can't be edited programmatically (admin-controlled), and flag settings are transient.

### The Settings Cache (`settings_cache.py`)

Settings parsing is expensive (file I/O + JSON parse + schema validation). `settings_cache.py` provides a file-content cache keyed by path:

```python
from typing import Optional

# Cache stores parsed file content; invalidated by file watcher
def get_cached_parsed_file(path: str) -> Optional[SettingsJson]: ...
def set_cached_parsed_file(path: str, content: Optional[SettingsJson]) -> None: ...

# Per-source cache: final merged result per source
def get_cached_settings_for_source(source: SettingSource) -> Optional[SettingsJson]: ...
def set_cached_settings_for_source(source: SettingSource, settings: Optional[SettingsJson]) -> None: ...
```

### Validation (`validation.py`)

All settings files are validated against `SettingsSchema` via Pydantic. Invalid fields are:
- Logged to diagnostics
- **Filtered out** (not rejected) — invalid permission rules are removed silently
- Never exposed as hard errors (would prevent startup on typos)

```python
from dataclasses import dataclass

@dataclass
class SettingsWithErrors:
    settings: SettingsJson
    errors: list[str]

def filter_invalid_permission_rules(settings: SettingsJson) -> SettingsWithErrors: ...
def format_validation_error(error: Exception) -> str: ...
```

### MDM Settings (`mdm/`)

Mobile Device Management (MDM) settings provide an additional enterprise integration:
- **macOS**: reads from `com.anthropic.claudeCode` preference domain via `defaults read`
- **Windows**: reads from `HKCU\Software\Anthropic\Claude Code` registry key

MDM settings are merged into `policySettings` with lower precedence than `managed-settings.json`.

---

## `src/migrations/` — Config Migration Scripts

Migrations run at startup to upgrade stored settings when Claude Code introduces new model names or settings fields. All migrations are **idempotent** — safe to run multiple times.

### Model Alias Migrations

The most common migration type handles model rename/alias changes:

| Migration | From | To | Condition |
|-----------|------|----|-----------|
| `migrateSonnet45ToSonnet46` | `claude-sonnet-4-5-*` | `sonnet` | Pro/Max/Team subscribers on firstParty |
| `migrateSonnet1mToSonnet45` | `sonnet[1m]` | `claude-sonnet-4-5-*[1m]` | Previous migration |
| `migrateFennecToOpus` | `fennec-latest` | `opus` | Ant-only |
| `migrateLegacyOpusToCurrent` | Old Opus IDs | `claude-opus-4-*` | All users |
| `migrateOpusToOpus1m` | `opus` | `opus[1m]` | Context: fast-mode |

### Pattern: All Migrations

```python
def migrate_sonnet45_to_sonnet46() -> None:
    # 1. Check if migration applies (provider check, subscription check)
    if get_api_provider() != "firstParty":
        return
    if not is_pro_subscriber():
        return

    # 2. Read ONLY userSettings (not merged — don't touch project/local pins)
    user_settings = get_settings_for_source("userSettings")
    model = user_settings.get("model") if user_settings else None

    # 3. Check if migration needed (idempotency gate)
    if model != "claude-sonnet-4-5-20250929":
        return

    # 4. Apply the migration
    update_settings_for_source("userSettings", {"model": "sonnet"})

    # 5. Log analytics
    log_event("tengu_sonnet45_to_46_migration", {"from_model": model})
```

Key design decisions:
- Reads `userSettings` specifically (never merged) — avoids promoting project/local pins globally
- Only writes if the value matches the old pattern — idempotent
- Logs telemetry for tracking migration success rates

### Other Migrations

```
migrate_auto_updates_to_settings
    Migrates autoUpdaterStatus from a separate config file to settings.json

migrate_bypass_permissions_accepted_to_settings
    Migrates the bypass-permissions acceptance flag to settings

migrate_enable_all_project_mcp_servers_to_settings
    Migrates per-project MCP server approval state to settings

migrate_repl_bridge_enabled_to_remote_control_at_startup
    Renames legacy field: repl_bridge_enabled → remote_control_at_startup
    (The REPL bridge is now the IDE bridge — field renamed for clarity)

reset_pro_to_opus_default, reset_auto_mode_opt_in_for_default_offer
    Resets model selections when offer terms change
```

---

## `src/utils/settings/apply_settings_change.py`

Handles the **reactive** side of settings changes — what happens when `settings.json` is modified while Claude Code is running:

```python
from typing import Callable

SetAppState = Callable[[dict], None]

# Called from app_state.py's use_settings_change() hook
def apply_settings_change(
    source: SettingSource,
    set_state: SetAppState,
) -> None: ...
```

Effects triggered by settings changes:
1. **Re-read settings from disk** (cache invalidation)
2. **Reapply env vars** (`apply_config_environment_variables()`)
3. **Clear auth caches** (in case API key changed)
4. **Update AppState** with new settings values
5. **Notify external observers** (session metadata sync for CCR/bridge)

### `change_detector.py`

`change_detector.py` implements file watching for settings files. Uses `watchfiles` (or `os`/`asyncio` equivalents) on each settings file path, debouncing rapid changes (editor save-as-you-type produces many intermediate writes).

---

## `src/utils/settings/permission_validation.py`

Validates permission rule strings:

```python
import re
from typing import Optional

def is_valid_permission_rule(rule: str) -> bool:
    """
    Validates the Tool(argument) syntax:
    - Tool name exists in the registered tool set
    - Argument pattern is syntactically valid (balanced parens, no injection vectors)
    - Wildcard placement is legal (only at end of prefix)
    """
    ...

def validate_permission_rule(rule: str) -> Optional[str]:
    """Returns an error message string if invalid, else None."""
    if not is_valid_permission_rule(rule):
        return f"Invalid permission rule format: {rule!r}"
    return None
```

`is_valid_permission_rule()` parses the `Tool(argument)` syntax and validates:
- Tool name exists in the registered tool set
- Argument pattern is syntactically valid (balanced parens, no injection vectors)
- Wildcard placement is legal (only at end of prefix)

Invalid rules are silently filtered on load rather than causing startup failures.

---

## `src/utils/settings/tool_validation_config.py`

Maps tool names to validation configuration for permission rules:

```python
# Which tools support argument-based permission rules
# and what argument patterns are valid for each
TOOL_ARGUMENT_VALIDATORS: dict[str, callable] = {
    # e.g. "Edit": validate_path_glob,
    #      "Bash": validate_command_prefix,
    #      "WebFetch": validate_domain_pattern,
}
```

This prevents permission rules like `Bash(/etc/passwd)` (path argument on a shell tool doesn't make semantic sense) from being accepted.

---

## Practical Configuration Guide

### Setting Up a Project

**`.claude/settings.json`** (committed, shared with team):
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(npm run test)",
      "Bash(git:*)",
      "Edit(.claude/**)"
    ],
    "deny": [
      "Bash(rm -rf:*)"
    ],
    "additionalDirectories": ["/shared/libs"]
  },
  "env": {
    "NODE_ENV": "development"
  }
}
```

**`.claude/settings.local.json`** (gitignored, personal overrides):
```json
{
  "permissions": {
    "defaultMode": "acceptEdits"
  },
  "model": "opus"
}
```

**`~/.claude/settings.json`** (global, all projects):
```json
{
  "autoMemoryEnabled": true,
  "preferredNotifChannel": "iterm2",
  "includeCoAuthoredBy": true
}
```

### Enterprise/Policy Settings

**`managed-settings.json`** (system path, IT-controlled):
```json
{
  "permissions": {
    "deny": ["WebFetch(*)", "WebSearch"],
    "disableBypassPermissionsMode": "disable"
  },
  "mcpServers": {},
  "allowedMcpServers": [
    { "serverName": "internal-tools" }
  ]
}
```

**Drop-in files** (`managed-settings.d/10-model-policy.json`):
```json
{
  "model": "claude-opus-4-6-20251001"
}
```

### Hooks Example

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": { "tool_name": "Bash" },
        "hooks": [
          {
            "type": "command",
            "command": "echo '${CLAUDE_TOOL_INPUT}' | audit-logger",
            "timeout": 5000
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": { "tool_name": "Edit" },
        "hooks": [
          {
            "type": "command",
            "command": "lint-changed-files"
          }
        ]
      }
    ]
  }
}
```

---

## The JSON Schema URL

Every settings file can reference the official JSON Schema for IDE autocompletion:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json"
}
```

This schema is hosted at [SchemaStore](https://github.com/SchemaStore/schemastore/blob/master/src/schemas/json/claude-code-settings.json) and updated when settings fields change. VS Code, JetBrains, and other IDEs use it to provide autocompletion and validation while editing settings files.

---

*Next: [Chapter 20 — Utilities Deep Dive](PartVI-Services-Infrastructure-20-Utilities-Deep-Dive.md)*


\newpage

# Chapter 20: Utilities Deep Dive

> **Part VI: Services & Infrastructure**

---

## Overview

`src/utils/` is Claude Code's shared machinery layer. If `QueryEngine.ts`, `Tool.ts`, and the service layer are the visible architecture, `utils/` is the mechanical substrate underneath them: shell parsing, git inspection, permission matching, message normalization, model selection, plugin loading, swarm coordination, settings I/O, and hundreds of small runtime helpers.

This directory is enormous:

- **565 files total**
- **298 top-level utility files**
- **267 files spread across focused subdirectories**

That shape tells you something important about Claude Code's design philosophy: the product is not built around a few giant frameworks. Instead, it is built around many narrowly scoped utilities that are composed into tools, commands, screens, and services.

For developers, this chapter explains which utility modules are foundational and which are feature-specific. For power users, it explains why Claude Code behaves the way it does when parsing shell commands, selecting models, loading plugins, evaluating permissions, or coordinating teammate agents.

---

## Mental Model

You can think of `src/utils/` as six layers:

| Layer | Examples | Why it exists |
|---|---|---|
| Parsing | `bash/`, `shell/`, `mcp/`, `messages/` | Turn messy real-world input into structured data |
| Policy | `permissions/`, `sandbox/`, `settings/` | Decide what is allowed, denied, or requires approval |
| Environment | `git/`, `github/`, `memory/`, `shell/` | Reflect the host machine, repo, and session state |
| Product logic | `model/`, `suggestions/`, `plugins/`, `swarm/` | Implement Claude Code-specific behavior |
| Serialization | `messages.ts`, `messages/mappers.ts`, `json.ts` | Move data safely between UI, SDK, and API layers |
| Glue | top-level files like `context.ts`, `queryHelpers.ts`, `toolSearch.ts`, `sessionRestore.ts` | Connect the rest of the app without creating circular dependencies |

The rest of this chapter follows the required utility groups first, then zooms back out to the top-level utility landscape.

---

## `bash/` — Command Parsing And Shell Semantics

This is one of the most important utility clusters because Claude Code must reason about shell commands before it can safely run them. The directory has **23 files** and splits into three responsibilities: parsing, analysis, and reconstruction.

### Core files

| File | Role |
|---|---|
| `bashParser.ts` | Tree-sitter-backed parser bootstrap and native/WASM integration |
| `parser.ts` | High-level command parsing API used by the rest of the app |
| `ast.ts` | AST walking and security-oriented command analysis |
| `commands.ts` | Command segmentation, redirection extraction, shell-structure helpers |
| `ParsedCommand.ts` | Parsed-command model and derived helpers |
| `ShellSnapshot.ts` | Captures shell state and context for command execution |
| `treeSitterAnalysis.ts` | Rich structural inspection of parsed commands |
| `shellQuote.ts`, `shellQuoting.ts` | Safe quoting and argument escaping |
| `prefix.ts`, `shellPrefix.ts` | Prefix detection and command prefix rules |
| `shellCompletion.ts` | Shell-aware completion helpers |
| `heredoc.ts` | Heredoc parsing and handling |
| `specs/*.ts` | Special-case command specs like `timeout`, `nohup`, `srun`, `pyright` |

### `parser.ts` — the public shell parser

`parser.ts` is the front door. It exposes `ensureInitialized()`, `parseCommand()`, and `parseCommandRaw()`, and it deliberately treats parsing as a security boundary.

Key behaviors:

- Commands over `MAX_COMMAND_LENGTH` are rejected early.
- Tree-sitter is feature-gated with `bun:bundle` flags such as `TREE_SITTER_BASH`.
- Parsing distinguishes between:
  - parser unavailable
  - parse succeeded
  - parse attempted but aborted (`PARSE_ABORTED`)
- The `PARSE_ABORTED` sentinel is explicitly fail-closed, so the caller does not silently fall back to a weaker parser after a timeout or parser panic.

That last point matters. Claude Code does not treat shell parsing as just a UX improvement. It treats it as a safety primitive.

### `bashParser.ts` and `ast.ts`

These files are the heavy machinery:

- `bashParser.ts` is the tree-sitter integration layer.
- `ast.ts` walks the resulting syntax tree to classify command structure and detect dangerous constructs.

This cluster is why Claude Code can reason about:

- command substitutions
- pipelines
- redirections
- declaration commands like `export` and `local`
- heredocs
- shell complexity that should trigger a safer approval path

### `commands.ts`

`commands.ts` complements the AST parser with pragmatic command handling:

- extract output redirections for permission messaging
- split compound shell operations
- support approval messaging that refers to the meaningful subcommands rather than raw shell text

This file is heavily used by permission logic. The reason permission prompts can say "these parts require approval" instead of dumping raw shell syntax is that `commands.ts` already segmented the command.

### `specs/`

The `specs` directory is a policy escape hatch for commands whose syntax is awkward enough to deserve custom handling. `timeout`, `sleep`, `nohup`, `srun`, and `pyright` all have special parsing rules because generic token logic is not always enough.

### Why power users should care

When Claude Code insists on a permission prompt for a seemingly harmless shell command, the deciding factor is often not the literal string. It is the parsed structure in `bash/`: substitutions, redirections, prefixes, and shell operators.

---

## `git/` And `github/` — Repository State Without Excess Subprocesses

The utility layer here is intentionally small:

- `git/` has **3 files**
- `github/` has **1 file**

But the files are high leverage.

### `git/gitFilesystem.ts`

This is the star of the cluster. It reads Git state directly from the filesystem rather than spawning `git` for every query.

It handles:

- resolving real `.git` directories, including worktrees and submodules
- parsing `HEAD`
- resolving refs via loose files and `packed-refs`
- validating branch names and SHAs before they flow into shell or UI contexts
- watching git state with a `GitHeadWatcher`-style file watcher

This is classic Claude Code engineering: avoid expensive subprocesses when a direct read is faster, but add strict validation because `.git` is just text on disk and can be tampered with.

Security-conscious details in this file include:

- `isSafeRefName()` rejects traversal, shell metacharacters, and malformed components
- `isValidGitSha()` accepts only full SHA-1 or SHA-256 hashes
- detached HEAD and symref cases are normalized before downstream use

### `git/gitConfigParser.ts`

This file parses git config values without needing shell-outs. It supports utilities that need repository or user git metadata but do not want the cost or fragility of invoking `git config`.

### `git/gitignore.ts`

This file supports edits to `.gitignore`, especially from settings and plugin flows. It is a narrow helper, but it matters because Claude Code frequently needs to create local support files that should stay out of version control.

### `github/ghAuthStatus.ts`

The GitHub-specific utility surface is deliberately tiny. `ghAuthStatus.ts` exists to answer one narrow question: is the GitHub CLI authenticated and usable? The rest of GitHub integration lives higher up in commands, services, and tools.

---

## `sandbox/` — Bridging Claude Code Rules To Sandbox Runtime

This cluster has only **2 files**, but `sandbox-adapter.ts` is nearly 1,000 lines and extremely important.

### `sandbox/sandbox-adapter.ts`

This file is the adapter between Claude Code's settings and permission model and the external `@anthropic-ai/sandbox-runtime` package.

It does four jobs:

1. Converts Claude Code settings into sandbox runtime config.
2. Resolves Claude Code-specific path semantics.
3. Maps permission rules into filesystem and network restrictions.
4. Connects sandbox violations back into the Claude Code UI and settings model.

The key architectural point is that sandboxing is not a separate system bolted on the side. It is derived from the same policy inputs that drive permission prompts:

- `permissions.allow`
- `permissions.deny`
- `sandbox.network.allowedDomains`
- `sandbox.filesystem.*`
- managed policy settings

### Path resolution semantics

The adapter carefully distinguishes two path languages:

- permission-rule paths like `Edit(/foo/**)` where `/` means settings-relative
- sandbox filesystem settings where `/` means a true absolute path

That distinction exists because the two systems evolved with different user expectations. `sandbox-adapter.ts` preserves backward compatibility while fixing ambiguous behavior.

### `sandbox-ui-utils.ts`

This is a tiny presentation helper layer for sandbox UI rendering. The real logic is in the adapter; this file exists to keep display formatting out of policy code.

---

## `permissions/` — The Real Policy Engine

This is one of the deepest utility subdirectories in the entire codebase:

- **24 files**
- several files over **1,400 lines**

If Chapter 12 explained the permission subsystem end-to-end, this directory is the detailed rule engine beneath it.

### The core files

| File | Role |
|---|---|
| `permissions.ts` | Main permission evaluation pipeline |
| `filesystem.ts` | Path normalization, protected files, file-rule matching |
| `permissionSetup.ts` | Assemble permission context from settings and session state |
| `yoloClassifier.ts` | Classifier-assisted auto-approval / YOLO mode logic |
| `permissionsLoader.ts` | Load rules from settings sources |
| `permissionRuleParser.ts` | Parse rule strings into structured values |
| `shellRuleMatching.ts` | Match shell commands against wildcard/prefix rules |
| `pathValidation.ts` | Normalize and validate filesystem paths |
| `PermissionMode.ts` | Permission mode definitions and display helpers |
| `PermissionUpdate*.ts` | Session/user/project rule mutation and persistence |
| `denialTracking.ts` | Track repeated denials and fallback behavior |
| `dangerousPatterns.ts` | High-risk command and path patterns |
| `bypassPermissionsKillswitch.ts` | Safety brake for bypass mode |

### `permissions.ts`

This file evaluates whether a tool use should be:

- allowed
- denied
- escalated to a user prompt
- routed through classifier or hook logic first

Its imports tell the story:

- tool names from Bash, PowerShell, REPL, Agent
- MCP naming helpers
- sandbox manager
- settings constants
- hook execution
- analytics and token-cost reporting
- denial tracking and classifier support

That means permission evaluation is not just a pure lookup table. It is the convergence point for:

- user settings
- enterprise policy
- current permission mode
- hook decisions
- classifier output
- tool-specific semantics
- session mutation and persistence

### Permission request messaging

`createPermissionRequestMessage()` is a good example of the file's role. It translates raw rule reasons into user-facing explanations:

- classifier blocked it
- hook blocked it
- a rule matched
- a subcommand inside a compound command needs approval
- current mode requires a prompt
- sandbox override is needed

This is why Claude Code's permission UI usually gives specific reasons rather than generic "needs approval" text.

### `filesystem.ts`

This file is the path-security counterpart to shell parsing. It knows about:

- dangerous files like `.gitconfig`, shell rc files, `.mcp.json`
- dangerous directories like `.git`, `.vscode`, `.idea`, `.claude`
- path normalization for case-insensitive filesystems
- skill-scoped edit suggestions under `.claude/skills/...`
- Windows UNC path risk checks
- path expansion and POSIX-style matching rules

It is careful about both UX and attack surface. Example: it can suggest a narrowly scoped permission rule for editing a single skill directory instead of granting broad `.claude/**` access.

### Classifier integration

Files like `bashClassifier.ts`, `classifierDecision.ts`, `classifierShared.ts`, and `yoloClassifier.ts` show that Claude Code's permission system is no longer only static pattern matching. It can also use learned or heuristic classification to decide whether a command deserves automatic approval, denial, or an explicit prompt.

That is one reason the permission system feels more adaptive than a plain allowlist/denylist engine.

---

## `messages/` And `messages.ts` — Conversation Serialization

The chapter requirement names `messages/`, but in practice the real cluster is:

- `src/utils/messages.ts`
- `src/utils/messages/mappers.ts`
- `src/utils/messages/systemInit.ts`

Together they normalize the conversation into the shapes needed by:

- the Anthropic API
- the SDK
- local transcript storage
- terminal UI rendering
- tool result handling

### `messages.ts`

This is a broad utility module for message creation, normalization, synthetic messages, rejection text, interruption text, tool pairing, and API formatting.

A few notable details:

- It imports many tool names directly because message semantics depend on tool identity.
- It contains canonical rejection/interruption strings used across the app.
- It handles memory hints, tool references, embedded-tool normalization, image validation, and diagnostic message synthesis.

This is one of the places where Claude Code's "agent UX" is actually authored. The user experiences the result as polished system messages, but that polish lives in utility code.

### `messages/mappers.ts`

This file translates between internal message objects and SDK-facing message schemas.

Important responsibilities:

- map compact-boundary metadata
- normalize assistant messages for SDK consumers
- convert local command output into assistant-shaped messages for compatibility
- preserve session IDs and UUIDs across boundaries

This is a compatibility layer. Without it, SDK clients, mobile viewers, and session-ingress flows would drift from the CLI's internal message format.

### `messages/systemInit.ts`

This file builds the initial system-message state and startup transcript scaffolding. It keeps bootstrapping details separate from the large general-purpose `messages.ts`.

---

## `model/` — Model Selection, Capabilities, And Product Policy

This cluster has **16 files**. It does much more than map aliases.

### Core files

| File | Role |
|---|---|
| `model.ts` | Main model resolution logic |
| `modelOptions.ts` | Available model options for UI and config |
| `modelCapabilities.ts` | Feature/capability metadata |
| `modelAllowlist.ts` | Restrict user-selectable models |
| `modelStrings.ts` | Canonical model IDs and string constants |
| `configs.ts` | Configuration bundles |
| `bedrock.ts` | AWS Bedrock provider-specific behavior |
| `providers.ts` | API provider selection |
| `validateModel.ts` | Validation and rejection of unsupported choices |
| `aliases.ts` | Short aliases like `sonnet`, `opusplan`, etc. |

### `model.ts`

This is the center of model policy. It decides:

- the main loop model
- the small/fast model
- default Sonnet, Opus, and Haiku variants
- how plan mode changes model selection
- how subscriber tier changes defaults
- when 1M-context variants apply

Its priority chain is explicit:

1. runtime override from `/model`
2. startup override from `--model`
3. `ANTHROPIC_MODEL`
4. saved settings
5. built-in default

That ordering is exactly the kind of detail power users care about.

### Product policy encoded in utilities

This cluster also encodes business and rollout policy:

- Max and Team Premium default to Opus
- other users default to Sonnet
- third-party providers may lag behind first-party model defaults
- Anthropic-internal builds can include ant-only model codenames that Bun strips in production builds

So `model/` is not just a technical mapping. It is where runtime choice, provider support, entitlement, and feature rollout meet.

---

## `memory/` — Minimal, Intentional Shared Types

This directory has only **2 files**:

- `types.ts`
- `versions.ts`

That small size is revealing. Most memory logic lives elsewhere (`memdir/`, extraction services, session memory services), while `utils/memory/` exists mostly to centralize shared type/version contracts.

This is a recurring Claude Code pattern: keep complex behavior in the feature subsystem, and keep `utils/` responsible for the cross-cutting pieces that multiple subsystems need.

---

## `mcp/` — Input Validation For MCP Interaction

This utility cluster is also small:

- `dateTimeParser.ts`
- `elicitationValidation.ts`

### `elicitationValidation.ts`

This file validates MCP elicitation inputs against MCP schemas. It supports:

- enums and multi-select enums
- strings with format constraints like email, URI, date, and date-time
- numeric ranges
- booleans
- natural-language date parsing via `dateTimeParser.ts`

This is a nice example of Claude Code's product polish. MCP servers can ask the user structured questions, and this utility layer ensures those answers are validated consistently before they go back over the protocol.

### `dateTimeParser.ts`

This file powers more forgiving date and time entry, so MCP interactions can accept human-friendly input like "tomorrow at 3pm" rather than only rigid ISO strings.

---

## `shell/` — Cross-Tool Shell Abstraction

If `bash/` understands shell syntax, `shell/` understands shell products and execution policy. This directory has **10 files**.

### Core files

| File | Role |
|---|---|
| `readOnlyCommandValidation.ts` | Shared read-only validation maps for BashTool and PowerShellTool |
| `bashProvider.ts` | Bash-specific provider implementation |
| `powershellProvider.ts` | PowerShell-specific provider implementation |
| `powershellDetection.ts` | Detect Windows PowerShell availability |
| `resolveDefaultShell.ts` | Decide which shell to use |
| `shellProvider.ts` | Common provider interface |
| `prefix.ts`, `specPrefix.ts` | Prefix and rule helpers |
| `shellToolUtils.ts` | Small shared helpers |
| `outputLimits.ts` | Output caps for shell tools |

### `readOnlyCommandValidation.ts`

This file is critical to Claude Code's "safe read-only shell command" experience. It contains detailed allowlists for commands like:

- `git diff`
- `git log`
- many other git subcommands
- selected external commands

Each command entry specifies:

- safe flags
- expected argument types
- whether `--` ends option parsing
- callbacks for additional danger detection

The comments in this file are unusually security-focused. They document real parser-differential hazards where a flag that looks harmless to Claude Code's validator could be interpreted differently by the underlying binary.

This is the main reason Claude Code can treat some shell commands as read-only with confidence instead of requiring blanket approval for all shell usage.

### Provider abstraction

The provider files make BashTool and PowerShellTool share as much logic as possible without pretending the shells are identical. That is why shell behavior feels consistent across platforms while still respecting real differences in quoting and command syntax.

---

## `plugins/` — Plugin Discovery, Installation, And Marketplace Plumbing

This is the largest required utility subdirectory:

- **44 files**
- `pluginLoader.ts` alone is over **3,300 lines**
- `marketplaceManager.ts` is over **2,600 lines**

The plugin subsystem in Chapter 15 depends heavily on these utilities.

### Major utility groups

| Group | Files | Purpose |
|---|---|---|
| Loading | `pluginLoader.ts`, `validatePlugin.ts`, `schemas.ts` | Parse and validate plugin structure |
| Marketplace | `marketplaceManager.ts`, `marketplaceHelpers.ts`, `officialMarketplace*.ts` | Discover and cache marketplaces |
| Installation | `headlessPluginInstall.ts`, `pluginInstallationHelpers.ts`, `pluginAutoupdate.ts` | Install/update plugin payloads |
| State | `installedPluginsManager.ts`, `pluginOptionsStorage.ts`, `refresh.ts` | Persist installed state |
| Extensions | `loadPluginCommands.ts`, `loadPluginAgents.ts`, `loadPluginHooks.ts`, `loadPluginOutputStyles.ts` | Materialize plugin-provided features |
| Integration | `mcpPluginIntegration.ts`, `lspPluginIntegration.ts`, `mcpbHandler.ts` | Connect plugins to other subsystems |

### `pluginLoader.ts`

This file is the authoritative loader. It handles:

- discovery from settings, marketplace references, and session-only plugin dirs
- manifest validation
- duplicate-name detection
- hook loading
- enabled/disabled state
- cache path construction
- seed cache probing
- zip-cache integration

It also shows careful attention to path safety: plugin IDs, marketplaces, and versions are sanitized before they become cache paths.

### `marketplaceManager.ts`

This file manages marketplace declarations and cached marketplace state under `~/.claude/plugins/`.

Important concepts:

- **declared marketplaces** are user intent
- **known marketplaces** are materialized cached state
- the official marketplace can be implicitly declared when enabled plugins reference it
- offline cache behavior is first-class, not an afterthought

This is a good example of Claude Code splitting "desired state" from "downloaded state", which makes reconciliation and recovery much simpler.

### `installedPluginsManager.ts`

This file maintains the installed set and supports in-memory/session plugin scenarios. It is the runtime registry layer that other parts of Claude Code query.

### Why this matters for power users

If a plugin seems to "exist in settings but not actually load," the answer is usually in this utility stack:

- declaration vs cache state mismatch
- validation failure
- marketplace fetch failure
- policy blocklist
- startup check failure

---

## `settings/` — Configuration Runtime API

Chapter 19 covered the schema model. `src/utils/settings/` is the runtime engine that loads, merges, caches, validates, and writes settings.

This directory has **19 files** plus an `mdm/` subdirectory with **3** more.

### Key files

| File | Role |
|---|---|
| `settings.ts` | Main load/merge/write API |
| `types.ts` | Zod-backed settings schema |
| `validation.ts` | Error formatting and validation helpers |
| `changeDetector.ts` | Detect settings changes at runtime |
| `settingsCache.ts` | Parsed-file and source-level caches |
| `constants.ts` | source ordering and metadata |
| `permissionValidation.ts` | Validate permission-rule syntax |
| `toolValidationConfig.ts` | Tool-specific config validation rules |
| `validationTips.ts` | User-facing remediation hints |
| `managedPath.ts` | System paths for enterprise/managed settings |
| `mdm/settings.ts` | MDM/HKCU policy integration |

### `settings.ts`

This is one of the most consequential utility files in the app. It handles:

- loading managed settings and drop-ins
- parsing and caching files
- merging all active sources
- filtering invalid permission rules before full schema validation
- returning structured validation errors instead of simply throwing
- updating specific editable sources

It is intentionally conservative. Notice two recurring themes:

- cache aggressively, but clone cached objects before returning them
- tolerate partial corruption where possible, especially for permission rules

That makes Claude Code resilient to real-world config drift instead of acting like a brittle config parser.

### `changeDetector.ts`

This file powers live settings refresh behavior. It lets long-lived sessions notice when settings changed underneath them.

### `mdm/`

The `mdm` utilities are the platform-specific enterprise hook. They let managed environments inject policy from OS-level configuration systems instead of only from user-editable files.

---

## `suggestions/` — Prompt And Command Assistance

This directory has **5 files**, but it directly shapes the REPL experience.

### Files

- `commandSuggestions.ts`
- `directoryCompletion.ts`
- `shellHistoryCompletion.ts`
- `skillUsageTracking.ts`
- `slackChannelSuggestions.ts`

### `commandSuggestions.ts`

This file uses `Fuse.js` to provide slash-command search and completion.

Important design choices:

- command names are weighted more heavily than descriptions
- aliases and segmented command parts (`:`, `_`, `-`) are searchable
- the Fuse index is cached by the identity of the commands array
- it supports slash commands both at the start of input and mid-input

This is why command completion feels responsive even though Claude Code exposes a very large command surface.

### `directoryCompletion.ts` and `shellHistoryCompletion.ts`

These files support path and command-history suggestions in the prompt input. They are small but directly tied to day-to-day usability.

### `skillUsageTracking.ts`

This utility helps rank skill suggestions based on actual usage patterns, making skill discovery adaptive rather than static.

---

## `swarm/` — Utility Layer For Multi-Agent Team Execution

This directory has **22 files**, plus **10 backend files**. It is the runtime utility side of the multi-agent system.

### Major groups

| Group | Files | Purpose |
|---|---|---|
| Runner | `inProcessRunner.ts`, `spawnInProcess.ts`, `spawnUtils.ts` | Launch and manage teammate agents |
| Permission sync | `permissionSync.ts`, `leaderPermissionBridge.ts` | Route worker approvals through the leader |
| Layout/team | `teamHelpers.ts`, `teammateLayoutManager.ts`, `teammateInit.ts` | Model and arrange the team |
| Connectivity | `reconnection.ts`, `constants.ts` | Handle session recovery and defaults |
| Prompting | `teammatePromptAddendum.ts`, `It2SetupPrompt.tsx` | Swarm-specific prompt and UX additions |
| Backends | `TmuxBackend.ts`, `ITermBackend.ts`, `InProcessBackend.ts`, registry/detection files | Multiple execution environments |

### `inProcessRunner.ts`

This is the most important file in the cluster. It wraps `runAgent()` for in-process teammates and provides:

- context isolation via `AsyncLocalStorage`
- progress tracking
- idle notification back to the leader
- permission-routing logic
- cleanup on abort or completion

The key insight is that swarm mode does not just "start another agent." It also recreates all the surrounding control planes:

- permission decisions
- mailbox communication
- state updates
- compaction thresholds
- SDK event emission

### Backend abstraction

The `backends/` directory shows that swarm execution is transport-agnostic:

- in-process backend
- tmux backend
- iTerm backend

That means the "team" abstraction is portable across different terminal environments. The backend decides where teammates run; the rest of the utility layer keeps the coordination model consistent.

---

## The Top-Level Utility Sea

The required subdirectories matter, but they are not the whole story. There are **298 top-level files directly under `src/utils/`**. They fall into recurring patterns.

### 1. Session And Runtime Glue

Representative files:

- `sessionRestore.ts`
- `sessionStart.ts`
- `sessionStorage.ts`
- `sessionEnvironment.ts`
- `sessionTitle.ts`
- `queryContext.ts`
- `queryHelpers.ts`
- `toolSearch.ts`
- `toolPool.ts`
- `toolResultStorage.ts`

These files wire together long-lived session state without bloating the higher-level services.

### 2. Filesystem And IO Helpers

Representative files:

- `file.ts`
- `fileRead.ts`
- `fileReadCache.ts`
- `fsOperations.ts`
- `tempfile.ts`
- `ripgrep.ts`
- `glob.ts`
- `readFileInRange.ts`
- `readEditContext.ts`

These utilities support the file tools, diff rendering, and context gathering.

### 3. Environment And Platform Detection

Representative files:

- `env.ts`
- `envUtils.ts`
- `platform.ts`
- `cwd.ts`
- `which.ts`
- `windowsPaths.ts`
- `xdg.ts`
- `findExecutable.ts`

These keep platform branching out of feature code.

### 4. Presentation Helpers

Representative files:

- `format.ts`
- `markdown.ts`
- `hyperlink.ts`
- `theme.ts`
- `textHighlighting.ts`
- `highlightMatch.tsx`
- `status.tsx`
- `staticRender.tsx`

These are the micro-foundations for the terminal UI and exported output.

### 5. Reliability And Instrumentation

Representative files:

- `debug.ts`
- `log.ts`
- `diagLogs.ts`
- `startupProfiler.ts`
- `queryProfiler.ts`
- `headlessProfiler.ts`
- `telemetry/*`
- `warningHandler.ts`

Claude Code instruments itself heavily. These utilities make that observability available without contaminating business logic with direct logger calls everywhere.

### 6. Auth, Security, And Identity

Representative files:

- `auth.ts`
- `secureStorage/*`
- `sessionIngressAuth.ts`
- `jwtUtils`-adjacent helpers in bridge land
- `privacyLevel.ts`
- `sanitization.ts`

These utilities sit below the user-visible auth flows and above the raw storage or OS primitives.

### 7. Feature-Specific Support Islands

Representative groups:

- `claudeInChrome/`
- `computerUse/`
- `deepLink/`
- `teleport/`
- `processUserInput/`
- `task/`
- `todo/`
- `ultraplan/`

These are utility islands created when a product feature became large enough to deserve its own local toolbox but not large enough to justify an entirely separate top-level subsystem.

---

## Design Patterns Repeated Across `src/utils/`

Several patterns show up again and again.

### 1. Fail-closed security defaults

Examples:

- `bash/parser.ts` returns `PARSE_ABORTED` rather than silently downgrading
- `gitFilesystem.ts` validates refs and SHAs
- `permissions/filesystem.ts` normalizes case and rejects traversal
- `readOnlyCommandValidation.ts` documents parser-differential hazards

Claude Code utilities assume hostile input is possible even from "local" sources.

### 2. Path and string normalization before policy checks

This is everywhere:

- path expansion
- POSIX conversion
- case normalization
- tool-name normalization
- message normalization

Because rules are only meaningful if both sides of the match use the same representation.

### 3. Policy and UX are intentionally coupled

The utility layer does not stop at making a decision. It also generates:

- readable permission explanations
- suggestion text
- completion rankings
- marketplace/source display strings
- model labels

Claude Code wants internal policy decisions to be explainable at the terminal.

### 4. `bun:bundle` feature gating

Utilities frequently use `feature(...)` to:

- strip ant-only code
- gate experimental parser support
- compile out optional behavior

That keeps the production binary smaller and lets the same source tree support internal and external variants.

### 5. Utility modules as anti-circular-dependency buffers

Many of these files exist because direct imports between tools, services, and UI components would create cycles. Utilities provide the neutral zone:

- a shared parser
- a shared message mapper
- a shared settings cache
- a shared plugin registry
- a shared swarm permission bridge

This is a major architectural reason the codebase remains navigable despite its size.

---

## What To Read First

If you want to understand Claude Code behavior quickly, these are the most valuable utility files:

1. `src/utils/permissions/permissions.ts`
2. `src/utils/permissions/filesystem.ts`
3. `src/utils/bash/parser.ts`
4. `src/utils/shell/readOnlyCommandValidation.ts`
5. `src/utils/model/model.ts`
6. `src/utils/settings/settings.ts`
7. `src/utils/messages.ts`
8. `src/utils/plugins/pluginLoader.ts`
9. `src/utils/plugins/marketplaceManager.ts`
10. `src/utils/swarm/inProcessRunner.ts`
11. `src/utils/git/gitFilesystem.ts`
12. `src/utils/sandbox/sandbox-adapter.ts`

Those files explain a disproportionate amount of the product's real-world behavior.

---

## Takeaways

`src/utils/` is not a junk drawer. It is where Claude Code's operational intelligence lives.

The big subsystems rely on it for:

- shell understanding
- git and repo introspection
- permission and sandbox enforcement
- message serialization
- model selection
- plugin loading
- dynamic settings
- teammate orchestration

If `QueryEngine.ts` is the heart of Claude Code, `src/utils/` is the connective tissue and nervous system. It is where the codebase turns abstract product ideas like "safe shell access," "adaptive permissions," "plugin marketplaces," and "multi-agent teamwork" into concrete, reusable mechanisms.

For developers, mastering `src/utils/` means understanding how Claude Code stays coherent across tools, services, and UI surfaces. For power users, it explains why the product behaves consistently even while juggling terminals, filesystems, plugins, models, policies, and teams of agents.


\newpage

