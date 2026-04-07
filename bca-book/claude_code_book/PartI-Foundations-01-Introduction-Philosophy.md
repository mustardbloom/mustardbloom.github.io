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
