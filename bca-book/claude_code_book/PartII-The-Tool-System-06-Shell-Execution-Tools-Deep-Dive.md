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
