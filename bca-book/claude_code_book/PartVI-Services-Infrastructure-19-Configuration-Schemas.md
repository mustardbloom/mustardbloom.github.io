# Chapter 19: Configuration & Schemas

> **Part VI: Services & Infrastructure**

---

## Overview

Claude Code has a rich, layered configuration system. Understanding it is essential for power users (who want fine-grained control) and developers (who extend or deploy Claude Code). This chapter covers the full settings hierarchy, the Zod v4 schema definitions, migration scripts, and the runtime settings APIs.

---

## The Five-Source Settings Hierarchy

Settings load from five sources in priority order (later sources override earlier ones):

```
Priority (lowest → highest):
┌─────────────────────────────────────────────┐
│  1. userSettings    ~/.claude/settings.json  │
│                                             │
│  2. projectSettings .claude/settings.json   │
│                                             │
│  3. localSettings   .claude/settings.local.json │
│                                             │
│  4. flagSettings    --settings <path>       │
│                                             │
│  5. policySettings  managed-settings.json   │  ← highest priority
└─────────────────────────────────────────────┘
```

```python
# src/utils/settings/constants.py
from typing import Literal

SettingSource = Literal[
    "userSettings",    # User preferences, global
    "projectSettings", # Team-shared, committed to git
    "localSettings",   # Personal project overrides, gitignored
    "flagSettings",    # --settings CLI flag
    "policySettings",  # Enterprise policy (managed-settings.json + drop-ins)
]

SETTING_SOURCES: tuple[SettingSource, ...] = (
    "userSettings",
    "projectSettings",
    "localSettings",
    "flagSettings",
    "policySettings",
)
```

### What Belongs Where

| Source | File | Committed? | Who owns it |
|--------|------|-----------|-------------|
| `userSettings` | `~/.claude/settings.json` | N/A (home dir) | Individual developer |
| `projectSettings` | `.claude/settings.json` | Yes | Team |
| `localSettings` | `.claude/settings.local.json` | No (gitignored) | Individual, per-project |
| `flagSettings` | `<custom path>` | Varies | CI/automation |
| `policySettings` | `managed-settings.json` | N/A (system path) | IT / enterprise admin |

### Merge Behavior

Settings are **merged, not replaced**. Arrays use append semantics unless the policy specifies otherwise. The merge customizer handles special cases like permission rule deduplication and MCP server lists.

```python
# settings.py uses a recursive merge with settings_merge_customizer()
# Arrays are generally appended (allow rules from multiple sources stack)
# Policy settings take final precedence on conflicts
```

### Managed Settings (Enterprise)

`policySettings` loads from two places:
1. **`managed-settings.json`** — base policy file (system-level path, platform-specific)
2. **`managed-settings.d/*.json`** — drop-in directory (sorted alphabetically)

Drop-in files allow separate teams to ship independent policy fragments without coordinating edits to a single admin file. Files are merged in alphabetical order: `10-network.json`, `20-security.json`, etc.

There is also an API-sourced policy from `remoteManagedSettings/` — fetched from Anthropic's API for organization-level configuration.

**Security note**: `projectSettings` (`.claude/settings.json`, committed to the repo) is intentionally excluded from sensitive configuration options like `autoMemoryDirectory`. A malicious repo could otherwise gain silent write access to `~/.ssh` by setting `autoMemoryDirectory: "~/.ssh"`.

### The `--settings` Flag

The `flagSettings` source loads from a path specified with `--settings <file>`. Used for:
- CI/CD environments that need different permissions
- Automation scripts with fixed model selection
- Testing with isolated configuration

---

## `src/utils/settings/types.py` — The Settings Schema

The `SettingsSchema` is defined using **Pydantic v2** with lazy validators for tree-shaking (unused schema branches can be eliminated from the binary).

### Complete Settings Reference

```python
# Major sections of SettingsJson (as a TypedDict):
from typing import TypedDict, Literal, NotRequired

PermissionMode = Literal["default", "acceptEdits", "plan", "auto"]

class PermissionsConfig(TypedDict):
    allow: NotRequired[list[str]]              # Always allow these operations
    deny: NotRequired[list[str]]               # Always deny these operations
    ask: NotRequired[list[str]]                # Always prompt for these
    default_mode: NotRequired[PermissionMode]  # 'default' | 'acceptEdits' | 'plan' | 'auto'
    disable_bypass_permissions_mode: NotRequired[Literal["disable"]]
    additional_directories: NotRequired[list[str]]

class StdioMcpServer(TypedDict):
    command: str                               # stdio server
    args: NotRequired[list[str]]
    env: NotRequired[dict[str, str]]

class RemoteMcpServer(TypedDict):
    url: str                                   # remote server
    api_key: NotRequired[str]

class SettingsJson(TypedDict):
    schema_: NotRequired[str]                  # JSON Schema URL for IDE validation

    # ── Model & API ──────────────────────────────────────────────────────────
    model: NotRequired[str]                    # 'sonnet', 'opus', 'haiku', or full model ID
    small_fast_model: NotRequired[str]         # Override for small/fast model (Haiku)

    # ── Permissions ──────────────────────────────────────────────────────────
    permissions: NotRequired[PermissionsConfig]

    # ── Environment Variables ─────────────────────────────────────────────────
    env: NotRequired[dict[str, str]]           # Injected into every session

    # ── MCP Servers ───────────────────────────────────────────────────────────
    mcp_servers: NotRequired[dict[str, StdioMcpServer | RemoteMcpServer]]

    # ── Plugins ───────────────────────────────────────────────────────────────
    enabled_plugins: NotRequired[dict[str, bool]]
    plugins: NotRequired[list]                 # ExtraKnownMarketplace entries

    # ── Hooks ─────────────────────────────────────────────────────────────────
    hooks: NotRequired["HooksSettings"]        # Pre/post tool-use hooks

    # ── Memory ────────────────────────────────────────────────────────────────
    auto_memory_enabled: NotRequired[bool]
    auto_memory_directory: NotRequired[str]    # Custom path (trusted sources only)

    # ── LSP ───────────────────────────────────────────────────────────────────
    lsp: NotRequired[dict[str, "LspServerConfig"]]

    # ── Behavior ──────────────────────────────────────────────────────────────
    verbose_output: NotRequired[bool]
    auto_updater_status: NotRequired[Literal["enabled", "disabled", "no_binary_found"]]
    preferred_notif_channel: NotRequired[str]
    has_trust_dialog_accepted: NotRequired[bool]

    # ── Session ───────────────────────────────────────────────────────────────
    include_co_authored_by: NotRequired[bool]
    default_flags: NotRequired[list[str]]      # Default CLI flags for every session

    # ── Feature Flags ─────────────────────────────────────────────────────────
    enabled_feature_flags: NotRequired[list[str]]
    disabled_feature_flags: NotRequired[list[str]]

    # ── Custom Commands ───────────────────────────────────────────────────────
    custom_commands: NotRequired[list]

    # ── Enterprise / Cowork ───────────────────────────────────────────────────
    allowed_mcp_servers: NotRequired[list]     # Allowlist for enterprise

    # ── Sandbox (macOS) ───────────────────────────────────────────────────────
    sandbox: NotRequired["SandboxSettings"]
```

### Permission Rule Syntax

Permission rules use a compact string syntax:

```
"Tool"                → Allow/deny all operations for this tool
"Bash(command)"       → Exact match on Bash command
"Bash(git:*)"         → Prefix wildcard — matches 'git status', 'git commit', etc.
"Edit(/src/**)"       → Path glob
"Read"                → Allow all Read operations
"WebFetch(domain.com:*)" → Domain-scoped fetch
```

Rules are validated by `PermissionRuleSchema` and `permissionValidation.py`, which rejects malformed patterns before they reach the permission check.

### Hooks Schema (`src/schemas/hooks.py`)

The hooks schema is in its own file (imported by `types.py`) to avoid circular dependencies:

```python
from typing import TypedDict, NotRequired

class HookCommand(TypedDict):
    type: str                                  # Always 'command'
    command: str                               # Shell command to run
    timeout: NotRequired[int]                  # Timeout in ms

class HookMatcher(TypedDict):
    tool_name: NotRequired[str]                # Which tool name to match

class BashCommandHook(TypedDict):
    matcher: NotRequired[HookMatcher]          # Which tools to match
    hooks: list[HookCommand]                   # Commands to execute

class PromptHook(TypedDict):
    hooks: list[HookCommand]

class HooksSettings(TypedDict):
    pre_tool_use: NotRequired[list[BashCommandHook]]   # Before any tool runs
    post_tool_use: NotRequired[list[BashCommandHook]]  # After any tool runs
    stop: NotRequired[list[PromptHook]]                # End of turn (final response)
    notification: NotRequired[list[BashCommandHook]]   # When a notification is sent
```

Hooks are shell commands that execute in response to events. Their stdout is parsed for special directives (e.g., `{"decision": "deny", "reason": "..."}` from a PreToolUse hook blocks tool execution).

---

## `src/utils/settings/settings.py` — Runtime API

### Loading Settings

```python
from functools import lru_cache
from typing import Optional

# Get merged settings (all sources combined):
def get_initial_settings() -> SettingsJson: ...

# Get settings from a specific source (unmixed):
def get_settings_for_source(source: SettingSource) -> Optional[SettingsJson]: ...

# Get merged settings with validation errors:
def get_settings_deprecated() -> SettingsJson: ...  # Returns merged but may include invalid fields
```

`get_initial_settings()` is memoized — called once at startup, cached for the session. Use `reset_settings_cache()` in tests.

### Writing Settings

```python
from typing import Literal

EditableSettingSource = Literal["userSettings", "projectSettings", "localSettings"]

# Update a specific source (merges with existing, not a full overwrite):
def update_settings_for_source(
    source: EditableSettingSource,  # 'userSettings' | 'projectSettings' | 'localSettings'
    update: dict,                   # Partial SettingsJson
) -> None: ...
```

`EditableSettingSource` excludes `policySettings` and `flagSettings` — policy files can't be edited programmatically (admin-controlled), and flag settings are transient.

### The Settings Cache (`settings_cache.py`)

Settings parsing is expensive (file I/O + JSON parse + schema validation). `settings_cache.py` provides a file-content cache keyed by path:

```python
from typing import Optional

# Cache stores parsed file content; invalidated by file watcher
def get_cached_parsed_file(path: str) -> Optional[SettingsJson]: ...
def set_cached_parsed_file(path: str, content: Optional[SettingsJson]) -> None: ...

# Per-source cache: final merged result per source
def get_cached_settings_for_source(source: SettingSource) -> Optional[SettingsJson]: ...
def set_cached_settings_for_source(source: SettingSource, settings: Optional[SettingsJson]) -> None: ...
```

### Validation (`validation.py`)

All settings files are validated against `SettingsSchema` via Pydantic. Invalid fields are:
- Logged to diagnostics
- **Filtered out** (not rejected) — invalid permission rules are removed silently
- Never exposed as hard errors (would prevent startup on typos)

```python
from dataclasses import dataclass

@dataclass
class SettingsWithErrors:
    settings: SettingsJson
    errors: list[str]

def filter_invalid_permission_rules(settings: SettingsJson) -> SettingsWithErrors: ...
def format_validation_error(error: Exception) -> str: ...
```

### MDM Settings (`mdm/`)

Mobile Device Management (MDM) settings provide an additional enterprise integration:
- **macOS**: reads from `com.anthropic.claudeCode` preference domain via `defaults read`
- **Windows**: reads from `HKCU\Software\Anthropic\Claude Code` registry key

MDM settings are merged into `policySettings` with lower precedence than `managed-settings.json`.

---

## `src/migrations/` — Config Migration Scripts

Migrations run at startup to upgrade stored settings when Claude Code introduces new model names or settings fields. All migrations are **idempotent** — safe to run multiple times.

### Model Alias Migrations

The most common migration type handles model rename/alias changes:

| Migration | From | To | Condition |
|-----------|------|----|-----------|
| `migrateSonnet45ToSonnet46` | `claude-sonnet-4-5-*` | `sonnet` | Pro/Max/Team subscribers on firstParty |
| `migrateSonnet1mToSonnet45` | `sonnet[1m]` | `claude-sonnet-4-5-*[1m]` | Previous migration |
| `migrateFennecToOpus` | `fennec-latest` | `opus` | Ant-only |
| `migrateLegacyOpusToCurrent` | Old Opus IDs | `claude-opus-4-*` | All users |
| `migrateOpusToOpus1m` | `opus` | `opus[1m]` | Context: fast-mode |

### Pattern: All Migrations

```python
def migrate_sonnet45_to_sonnet46() -> None:
    # 1. Check if migration applies (provider check, subscription check)
    if get_api_provider() != "firstParty":
        return
    if not is_pro_subscriber():
        return

    # 2. Read ONLY userSettings (not merged — don't touch project/local pins)
    user_settings = get_settings_for_source("userSettings")
    model = user_settings.get("model") if user_settings else None

    # 3. Check if migration needed (idempotency gate)
    if model != "claude-sonnet-4-5-20250929":
        return

    # 4. Apply the migration
    update_settings_for_source("userSettings", {"model": "sonnet"})

    # 5. Log analytics
    log_event("tengu_sonnet45_to_46_migration", {"from_model": model})
```

Key design decisions:
- Reads `userSettings` specifically (never merged) — avoids promoting project/local pins globally
- Only writes if the value matches the old pattern — idempotent
- Logs telemetry for tracking migration success rates

### Other Migrations

```
migrate_auto_updates_to_settings
    Migrates autoUpdaterStatus from a separate config file to settings.json

migrate_bypass_permissions_accepted_to_settings
    Migrates the bypass-permissions acceptance flag to settings

migrate_enable_all_project_mcp_servers_to_settings
    Migrates per-project MCP server approval state to settings

migrate_repl_bridge_enabled_to_remote_control_at_startup
    Renames legacy field: repl_bridge_enabled → remote_control_at_startup
    (The REPL bridge is now the IDE bridge — field renamed for clarity)

reset_pro_to_opus_default, reset_auto_mode_opt_in_for_default_offer
    Resets model selections when offer terms change
```

---

## `src/utils/settings/apply_settings_change.py`

Handles the **reactive** side of settings changes — what happens when `settings.json` is modified while Claude Code is running:

```python
from typing import Callable

SetAppState = Callable[[dict], None]

# Called from app_state.py's use_settings_change() hook
def apply_settings_change(
    source: SettingSource,
    set_state: SetAppState,
) -> None: ...
```

Effects triggered by settings changes:
1. **Re-read settings from disk** (cache invalidation)
2. **Reapply env vars** (`apply_config_environment_variables()`)
3. **Clear auth caches** (in case API key changed)
4. **Update AppState** with new settings values
5. **Notify external observers** (session metadata sync for CCR/bridge)

### `change_detector.py`

`change_detector.py` implements file watching for settings files. Uses `watchfiles` (or `os`/`asyncio` equivalents) on each settings file path, debouncing rapid changes (editor save-as-you-type produces many intermediate writes).

---

## `src/utils/settings/permission_validation.py`

Validates permission rule strings:

```python
import re
from typing import Optional

def is_valid_permission_rule(rule: str) -> bool:
    """
    Validates the Tool(argument) syntax:
    - Tool name exists in the registered tool set
    - Argument pattern is syntactically valid (balanced parens, no injection vectors)
    - Wildcard placement is legal (only at end of prefix)
    """
    ...

def validate_permission_rule(rule: str) -> Optional[str]:
    """Returns an error message string if invalid, else None."""
    if not is_valid_permission_rule(rule):
        return f"Invalid permission rule format: {rule!r}"
    return None
```

`is_valid_permission_rule()` parses the `Tool(argument)` syntax and validates:
- Tool name exists in the registered tool set
- Argument pattern is syntactically valid (balanced parens, no injection vectors)
- Wildcard placement is legal (only at end of prefix)

Invalid rules are silently filtered on load rather than causing startup failures.

---

## `src/utils/settings/tool_validation_config.py`

Maps tool names to validation configuration for permission rules:

```python
# Which tools support argument-based permission rules
# and what argument patterns are valid for each
TOOL_ARGUMENT_VALIDATORS: dict[str, callable] = {
    # e.g. "Edit": validate_path_glob,
    #      "Bash": validate_command_prefix,
    #      "WebFetch": validate_domain_pattern,
}
```

This prevents permission rules like `Bash(/etc/passwd)` (path argument on a shell tool doesn't make semantic sense) from being accepted.

---

## Practical Configuration Guide

### Setting Up a Project

**`.claude/settings.json`** (committed, shared with team):
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(npm run test)",
      "Bash(git:*)",
      "Edit(.claude/**)"
    ],
    "deny": [
      "Bash(rm -rf:*)"
    ],
    "additionalDirectories": ["/shared/libs"]
  },
  "env": {
    "NODE_ENV": "development"
  }
}
```

**`.claude/settings.local.json`** (gitignored, personal overrides):
```json
{
  "permissions": {
    "defaultMode": "acceptEdits"
  },
  "model": "opus"
}
```

**`~/.claude/settings.json`** (global, all projects):
```json
{
  "autoMemoryEnabled": true,
  "preferredNotifChannel": "iterm2",
  "includeCoAuthoredBy": true
}
```

### Enterprise/Policy Settings

**`managed-settings.json`** (system path, IT-controlled):
```json
{
  "permissions": {
    "deny": ["WebFetch(*)", "WebSearch"],
    "disableBypassPermissionsMode": "disable"
  },
  "mcpServers": {},
  "allowedMcpServers": [
    { "serverName": "internal-tools" }
  ]
}
```

**Drop-in files** (`managed-settings.d/10-model-policy.json`):
```json
{
  "model": "claude-opus-4-6-20251001"
}
```

### Hooks Example

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": { "tool_name": "Bash" },
        "hooks": [
          {
            "type": "command",
            "command": "echo '${CLAUDE_TOOL_INPUT}' | audit-logger",
            "timeout": 5000
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": { "tool_name": "Edit" },
        "hooks": [
          {
            "type": "command",
            "command": "lint-changed-files"
          }
        ]
      }
    ]
  }
}
```

---

## The JSON Schema URL

Every settings file can reference the official JSON Schema for IDE autocompletion:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json"
}
```

This schema is hosted at [SchemaStore](https://github.com/SchemaStore/schemastore/blob/master/src/schemas/json/claude-code-settings.json) and updated when settings fields change. VS Code, JetBrains, and other IDEs use it to provide autocompletion and validation while editing settings files.

---

*Next: [Chapter 20 — Utilities Deep Dive](PartVI-Services-Infrastructure-20-Utilities-Deep-Dive.md)*
