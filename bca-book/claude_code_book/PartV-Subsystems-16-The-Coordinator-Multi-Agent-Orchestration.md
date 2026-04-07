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
