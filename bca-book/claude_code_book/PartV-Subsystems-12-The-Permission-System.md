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
