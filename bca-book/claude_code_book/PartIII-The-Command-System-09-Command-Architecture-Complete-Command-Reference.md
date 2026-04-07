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
