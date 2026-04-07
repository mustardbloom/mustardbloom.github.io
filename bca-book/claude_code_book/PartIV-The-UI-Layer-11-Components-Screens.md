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
