# Chapter 8: Web, MCP, and Integration Tools — Deep Dive

> **Part II: The Tool System**

---

## WebFetchTool

WebFetchTool fetches content from URLs. It is **read-only** (GET requests only) and has a sophisticated domain security model.

**Input schema:**
```python
from pydantic import BaseModel
from typing import Optional

class WebFetchInput(BaseModel):
    url: str
    prompt: Optional[str] = None  # Extract specific info from the page
```

### Pre-Approved Domains

`src/tools/WebFetchTool/preapproved.ts` defines `PREAPPROVED_HOSTS` — a large set of domains that can be fetched without requiring explicit user permission. This list covers:

- **Anthropic**: `platform.claude.com`, `code.claude.com`, `modelcontextprotocol.io`
- **Language docs**: `docs.python.org`, `developer.mozilla.org`, `go.dev`, `doc.rust-lang.org`, `kotlinlang.org`
- **Framework docs**: `react.dev`, `nextjs.org`, `vuejs.org`, `docs.djangoproject.com`
- **Cloud providers**: `docs.aws.amazon.com`, `cloud.google.com`, `kubernetes.io`
- **Package registries**: `pypi.org`, `npmjs.com`, `crates.io`, `pkg.go.dev`
- **Version control**: `github.com`, `gitlab.com`, `docs.github.com`
- **Databases**: `www.postgresql.org`, `redis.io`, `mongodb.com`

URLs not on this list require user permission, consistent with the general permission model.

**Security boundary**: The pre-approved list applies **only to GET requests in WebFetchTool**. BashTool commands cannot use this list to make network requests — the sandbox system is entirely separate. This prevents data exfiltration through shell commands to "trusted" domains.

### Content Processing

When fetching HTML pages, `utils.ts` converts HTML to readable text:
- Strips HTML tags
- Extracts visible text content
- Handles common encodings
- Returns a size-limited excerpt (context window budget)

### Permission Model

- Pre-approved domains: auto-approved
- Other domains: user prompted once, can be added to always-allow rules

---

## WebSearchTool

WebSearchTool performs web searches and returns summarized results.

**Input schema:**
```python
from pydantic import BaseModel

class WebSearchInput(BaseModel):
    query: str
```

The search results are formatted as a list of title + URL + snippet entries, suitable for the LLM to parse and decide which URLs to fetch with WebFetchTool.

---

## MCPTool — Invoking MCP Server Tools

When Claude Code has connected MCP servers, `MCPTool` is the mechanism for calling their tools.

```
src/tools/MCPTool/
├── MCPTool.ts
├── UI.tsx
├── classifyForCollapse.ts   ← Which MCP tools should collapse in UI
└── prompt.ts
```

**Input schema:**
```python
from pydantic import BaseModel

class MCPToolInput(BaseModel):
    server_name: str   # Name of the MCP server
    tool_name: str     # Tool to call on that server
    arguments: dict    # Tool-specific arguments (dynamic schema)
```

### The Collapse Classification System (`classifyForCollapse.ts`)

MCP tool results can be large. The collapse classifier determines whether to show or hide the result by default in the terminal UI.

The classifier maintains explicit allowlists for well-known MCP servers:

**Search tools** (collapsed with "searched X"):
```python
SEARCH_TOOLS = {
    # Slack
    'slack_search_public', 'slack_search_channels', 'slack_search_users',
    # GitHub
    'search_code', 'search_repositories', 'search_issues',
    # Linear
    'search_documentation',
    # Datadog
    'search_logs', 'search_spans', 'find_slow_spans',
    # Sentry
    'search_events', 'find_organizations', 'find_projects',
    # Notion
    'search',
    # Gmail
    'gmail_search_messages',
    # ... more
}
```

**Read tools** (collapsed with "read X"):
- Calendar: `google_calendar_list_events`
- Drive: `google_drive_list_files`, `google_drive_get_file`
- Slack: `slack_list_channels`, `slack_get_messages`
- Linear: `list_issues`, `get_issue`, `list_projects`
- Sentry: `get_issue`, `get_error_details`
- GitHub: `get_file_contents`, `list_pull_requests`, `get_commit`

**Write tools** (never collapsed — always visible):
- `send_message`, `create_*`, `update_*`, `delete_*`, `post_*`

Unknown tools are **not collapsed** (conservative default) — better to show too much than to hide important output.

---

## ListMcpResourcesTool & ReadMcpResourceTool

MCP servers can expose "resources" in addition to tools. Resources are file-like objects (documents, database records, etc.) that can be listed and read.

**`ListMcpResourcesTool`** — lists available resources:
```python
from pydantic import BaseModel

class ListMcpResourcesInput(BaseModel):
    server_name: str
```
Returns a list of resource URIs and descriptions.

**`ReadMcpResourceTool`** — reads a specific resource:
```python
from pydantic import BaseModel

class ReadMcpResourceInput(BaseModel):
    server_name: str
    uri: str  # Resource URI from ListMcpResourcesTool
```
Returns the resource content (text, JSON, binary, etc.).

---

## McpAuthTool

Handles authentication flows for MCP servers that require auth:

```python
from pydantic import BaseModel
from typing import Literal

class McpAuthInput(BaseModel):
    server_name: str
    action: Literal['authenticate', 'status', 'logout']
```

The authentication flow:
1. `authenticate` — initiates OAuth or other auth flow for the server
2. Opens browser for user to complete auth
3. Stores token in the credential store
4. `status` — checks current auth state
5. `logout` — revokes stored credentials

---

## ToolSearchTool — Deferred Tool Discovery

This tool solves a context window efficiency problem: Claude Code has dozens of tools, but not all of them need to be in the system prompt at all times. Some tools (especially from MCP servers) are loaded "lazily" and need to be discovered on demand.

```python
from pydantic import BaseModel

class ToolSearchInput(BaseModel):
    query: str        # Keywords describing what you need
    max_results: int = 5
```

The `ToolSearchTool` searches the deferred tool registry by query and returns the **full JSON schema** of matching tools. Once the LLM has seen a tool's schema, it can call it directly.

From `constants.ts` in the ToolSearchTool:
- Deferred tools appear as names-only in the system prompt (`<system-reminder>`)
- Until fetched with ToolSearchTool, only the name is known — the tool cannot be invoked
- After fetching, the tool's full schema is available in the conversation

This pattern keeps the system prompt lean while still providing access to the full tool library.

---

## LSPTool — Language Server Protocol

LSPTool integrates with Language Server Protocol (LSP) servers to provide IDE-grade code intelligence.

**Input schema:**
```python
from pydantic import BaseModel
from typing import Literal, Optional

class LSPToolInput(BaseModel):
    operation: Literal[
        'diagnostics',    # Get errors/warnings for a file
        'hover',          # Type info at a position
        'definition',     # Go-to-definition
        'references',     # Find all references
        'completion',     # Code completions
        'rename',         # Rename symbol
    ]
    file_path: str
    line: Optional[int] = None
    character: Optional[int] = None
    new_name: Optional[str] = None  # For rename
```

The LSP service (`src/services/lsp/`) manages language server connections. When `FileEditTool` edits a file, it calls `clearDeliveredDiagnosticsForFile()` to invalidate stale diagnostics — the next `LSPTool` call will fetch fresh ones.

---

## SkillTool — Skill Execution

SkillTool invokes a registered skill by name:

```python
from pydantic import BaseModel
from typing import Optional

class SkillToolInput(BaseModel):
    skill: str                  # Skill name or "plugin:skill" for namespaced skills
    args: Optional[str] = None
```

When SkillTool runs, it:
1. Looks up the skill in the registry
2. Expands the skill's SKILL.md content into a full prompt
3. Injects the prompt into the conversation
4. The turn continues with the skill's instructions active

This is how `/commit`, `/simplify`, and other skills work when invoked via the `SkillTool`.

---

## ScheduleCronTool (CronCreateTool / CronDeleteTool / CronListTool)

The cron tools create, delete, and list scheduled agent triggers. Available when the `AGENT_TRIGGERS` feature flag is active.

**`CronCreateTool`:**
```python
from pydantic import BaseModel

class CronCreateInput(BaseModel):
    schedule: str      # Cron expression (e.g., "0 9 * * 1-5")
    prompt: str        # What the agent should do when triggered
    description: str   # Human-readable description
```

Cron jobs are persisted and will trigger new agent sessions on their schedule.

**`CronDeleteTool`** and **`CronListTool`** manage existing crons.

---

## RemoteTriggerTool

Available when `AGENT_TRIGGERS_REMOTE` is active. Triggers an agent on a remote server:

```python
from pydantic import BaseModel

class RemoteTriggerInput(BaseModel):
    trigger_id: str
    payload: dict
```

Remote triggers differ from crons (which are time-based) — they are event-based triggers that fire when explicitly called.

---

## AskUserQuestionTool

Allows the LLM to ask the user a clarifying question mid-turn:

```python
from pydantic import BaseModel
from typing import Optional

class AskUserQuestionInput(BaseModel):
    question: str
    options: Optional[list[str]] = None  # Multiple choice options
```

Rather than the normal REPL interaction (where the user types at the prompt), `AskUserQuestionTool` inserts a blocking question into the current turn. The turn pauses until the user responds.

**When to use**: The LLM should use this when it genuinely cannot proceed without additional information. The system prompt instructs the LLM to prefer making reasonable assumptions over excessive questioning.

---

## BriefTool

Generates a brief/summary of the current conversation or a piece of work:

```python
from pydantic import BaseModel
from typing import Optional

class BriefInput(BaseModel):
    content: Optional[str] = None  # Content to summarize, or summarize conversation
```

Available when `KAIROS` or `KAIROS_BRIEF` feature flags are active.

---

## ConfigTool — Runtime Configuration

ConfigTool reads and writes Claude Code settings from within a session:

```python
from pydantic import BaseModel
from typing import Any, Literal, Optional

class ConfigToolInput(BaseModel):
    action: Literal['read', 'write']
    key: str
    value: Optional[Any] = None  # For write
```

Settings written via ConfigTool take effect immediately in the current session. This is how the `/config` command's "set" functionality works internally.

---

## Summary: Tool Selection Guide

| Need | Tool |
|------|------|
| Fetch documentation | WebFetchTool (check preapproved domains) |
| Search the web | WebSearchTool |
| Call a connected service (Slack, GitHub, Linear...) | MCPTool |
| Find available integrations | ToolSearchTool |
| Check TypeScript types / errors | LSPTool with `diagnostics` |
| Run a saved workflow | SkillTool |
| Ask user for input | AskUserQuestionTool |
| Schedule recurring work | ScheduleCronTool |

---

*Next: [Chapter 9 — Command Architecture & Complete Command Reference](PartIII-The-Command-System-09-Command-Architecture-Complete-Command-Reference.md)*
