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
