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
