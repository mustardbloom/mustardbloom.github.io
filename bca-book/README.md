# The Claude Code Bible

Complete source-code walkthrough and mastery guide for Claude Code.

This repository is a book-length, markdown-first guide to how Claude Code actually works under the hood. It is aimed at two audiences:

- Developers who want to understand the architecture, tools, subsystems, and patterns behind a modern coding agent
- Power users who want a precise mental model of Claude Code's commands, modes, permissions, and workflows

Rather than treating coding agents as opaque products, this book breaks the system into concrete layers: query orchestration, tool execution, shell integration, file editing, agent spawning, MCP, UI rendering, permissions, memory, configuration, and infrastructure.

## What this repo contains

- `claude_code_book/`: the manuscript, split into 20 chapters
- `README.md`: this overview
- `LICENSE`: MIT license

## Reading guide

Choose a path based on what you need:

- New to Claude Code: start with Chapters 1, 2, and 3
- Building on top of Claude Code: focus on Chapters 2, 3, 4, 13, and 14
- Writing tools or commands: read Chapters 4, 5, 6, 7, 8, and 9
- Debugging behavior or performance: read Chapters 3, 12, 17, and 18
- Learning the terminal UI internals: read Chapters 10 and 11
- Understanding team, plugin, and enterprise workflows: read Chapters 12, 13, 15, 16, and 19

## Book structure

The manuscript is organized into six parts:

### Part I: Foundations

- Chapter 1: introduction, philosophy, and mental model
- Chapter 2: architecture and startup pipeline
- Chapter 3: the query engine and tool-call loop

### Part II: The Tool System

- Chapter 4: tool architecture
- Chapter 5: filesystem tools
- Chapter 6: shell and execution tools
- Chapter 7: agent and orchestration tools
- Chapter 8: web, MCP, and integration tools

### Part III: The Command System

- Chapter 9: command architecture and command reference

### Part IV: The UI Layer

- Chapter 10: Ink and terminal rendering
- Chapter 11: components and screens

### Part V: Subsystems

- Chapter 12: permission system
- Chapter 13: MCP integration
- Chapter 14: IDE bridge integration
- Chapter 15: memory, skills, plugins, and tasks
- Chapter 16: coordinator and multi-agent orchestration

### Part VI: Services and Infrastructure

- Chapter 17: service layer
- Chapter 18: state management
- Chapter 19: configuration and schemas
- Chapter 20: utilities deep dive

## Files

```text
.
├── README.md
├── LICENSE
└── claude_code_book/
    ├── PartI-Foundations-01-Introduction-Philosophy.md
    ├── PartI-Foundations-02-Architecture-Deep-Dive.md
    ├── PartI-Foundations-03-The-Query-Engine-Heart-of-Claude-Code.md
    ├── PartII-The-Tool-System-04-Tool-Architecture.md
    ├── PartII-The-Tool-System-05-File-System-Tools-Deep-Dive.md
    ├── PartII-The-Tool-System-06-Shell-Execution-Tools-Deep-Dive.md
    ├── PartII-The-Tool-System-07-Agent-Orchestration-Tools-Deep-Dive.md
    ├── PartII-The-Tool-System-08-Web-MCP-and-Integration-Tools-Deep-Dive.md
    ├── PartIII-The-Command-System-09-Command-Architecture-Complete-Command-Reference.md
    ├── PartIV-The-UI-Layer-10-Ink-React-for-the-Terminal.md
    ├── PartIV-The-UI-Layer-11-Components-Screens.md
    ├── PartV-Subsystems-12-The-Permission-System.md
    ├── PartV-Subsystems-13-MCP-Model-Context-Protocol-Integration.md
    ├── PartV-Subsystems-14-The-Bridge-IDE-Integration.md
    ├── PartV-Subsystems-15-Memory-Skills-Plugins-Tasks.md
    ├── PartV-Subsystems-16-The-Coordinator-Multi-Agent-Orchestration.md
    ├── PartVI-Services-Infrastructure-17-The-Service-Layer.md
    ├── PartVI-Services-Infrastructure-18-State-Management.md
    ├── PartVI-Services-Infrastructure-19-Configuration-Schemas.md
    └── PartVI-Services-Infrastructure-20-Utilities-Deep-Dive.md
```

## How to use this repo

1. Start with [`claude_code_book/PartI-Foundations-01-Introduction-Philosophy.md`](./claude_code_book/PartI-Foundations-01-Introduction-Philosophy.md).
2. Read linearly if you want full coverage, or use the reading guide above to jump by topic.
3. Use the later chapters as reference material when you need details on a specific subsystem.

## Why this exists

Claude Code is a dense system with a large surface area. This repo exists to make that system legible. The goal is not just to explain features, but to explain implementation decisions, internal boundaries, and the operational model that makes the product work.

## License

MIT
