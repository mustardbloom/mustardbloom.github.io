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
