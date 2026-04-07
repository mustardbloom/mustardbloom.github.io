# Chapter 17: The Service Layer

> **Part VI: Services & Infrastructure**

---

## Overview

The service layer is Claude Code's infrastructure underpinning — everything that isn't user-facing UI or LLM-facing tools. It handles API calls, conversation management, analytics, language server integration, tool execution orchestration, voice, and more.

```
src/services/
├── api/          ← Anthropic API client, retry, error handling, usage
├── compact/      ← Conversation compression (manual, auto, micro)
├── analytics/    ← GrowthBook, DataDog, 1P event logging
├── lsp/          ← Language Server Protocol integration
├── tools/        ← Tool execution orchestration and streaming
├── oauth/        ← OAuth 2.0 authentication flow
├── mcp/          ← MCP client (Chapter 13)
├── plugins/      ← Plugin installation (Chapter 15)
└── ...           ← Voice, VCR, rate limits, notifier, token estimation
```

---

## Part 1: The API Client (`src/services/api/`)

### `client.ts` — Multi-Provider Anthropic Client

The API client creates an `Anthropic` SDK instance configured for the active provider. Claude Code supports five API providers:

| Provider | Auth mechanism | Key env vars |
|----------|---------------|-------------|
| Direct API | `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` |
| Claude.ai (OAuth) | OAuth 2.0 bearer token | OAuth tokens from login |
| AWS Bedrock | AWS credentials | `AWS_REGION`, `CLAUDE_CODE_USE_BEDROCK` |
| GCP Vertex AI | GCP service account | `ANTHROPIC_VERTEX_PROJECT_ID`, `CLOUD_ML_REGION` |
| Azure Foundry | API key or Azure AD | `ANTHROPIC_FOUNDRY_RESOURCE`, `ANTHROPIC_FOUNDRY_API_KEY` |

Region selection for Vertex AI is model-specific:

```
1. VERTEX_REGION_CLAUDE_<MODEL> (model-specific override)
2. CLOUD_ML_REGION (global default)
3. Config default
4. Fallback: us-east5
```

The client is **singleton per session** — created once and reused. It injects the user-agent header (`claude-code/<version>`) and configures proxy support via `getProxyFetchOptions()`.

### `withRetry.ts` — Retry Logic

`withRetry.ts` is the most battle-tested file in the codebase. It wraps API calls with exponential backoff and handles the full taxonomy of error types:

```
┌─────────────┐
│  API call   │
└──────┬──────┘
       │
    error?
       │
  ┌────┴────────────┬──────────────┬──────────────┬──────────────┐
  │                 │              │              │              │
429 (rate limit)  529 (overload) 5xx/network   AbortError     others
  │                 │              │              │              │
retry with        retry if        retry with    don't retry   don't retry
backoff           foreground      backoff
                  query
```

**Key constants:**

```python
DEFAULT_MAX_RETRIES = 10
BASE_DELAY_MS = 500
MAX_529_RETRIES = 3
FLOOR_OUTPUT_TOKENS = 3000  # Never shrink below this on prompt-too-long
```

**529 handling** — 529 (overload) retries only for "foreground query sources" where the user is blocking on the result:

```python
FOREGROUND_529_RETRY_SOURCES = {
    'repl_main_thread',
    'sdk',
    'agent:custom',
    'agent:default',
    'compact',
    'auto_mode',
    # ...
}
```

Background tasks (summaries, suggestions, classifiers) bail immediately on 529 — each retry during a capacity cascade is 3-10x gateway amplification, and the user never sees those fail anyway.

**Persistent retry** (`CLAUDE_CODE_UNATTENDED_RETRY`) — ant-only mode for unattended sessions. Retries 429/529 indefinitely with higher backoff caps (5 minutes max), and sends periodic heartbeat `SystemAPIErrorMessage` yields so the host environment doesn't mark the session idle.

**Fast mode cooldown** — when the fast (Opus) model is rate-limited, `withRetry.ts` triggers a cooldown period and automatically falls back to the standard model.

### `errors.ts` — Error Classification

Errors returned by the API are classified into typed categories:

| Error | Meaning |
|-------|---------|
| `PROMPT_TOO_LONG_ERROR_MESSAGE` | Context window exceeded |
| `API_ERROR_MESSAGE_PREFIX` | Generic API errors |
| `REPEATED_529_ERROR_MESSAGE` | Persistent overload |

`parsePromptTooLongTokenCounts()` extracts actual/limit token counts from prompt-too-long errors:

```
"prompt is too long: 137500 tokens > 135000 maximum"
→ { actualTokens: 137500, limitTokens: 135000 }
```

This drives the auto-compact threshold and context window warning UI.

### `usage.ts` — Rate Limit & Utilization

`fetchUtilization()` calls `GET /api/oauth/usage` to get the user's current rate limit utilization:

```python
from typing import TypedDict, Optional

class Utilization(TypedDict, total=False):
    five_hour: Optional[RateLimit]
    seven_day: Optional[RateLimit]
    seven_day_opus: Optional[RateLimit]
    seven_day_sonnet: Optional[RateLimit]
    extra_usage: Optional[ExtraUsage]
```

This data feeds the rate limit warning display in the REPL header.

### `bootstrap.ts` — Session Initialization

The bootstrap file performs session-start API calls — fetching remote feature flags, user configuration, and other session metadata before the first user interaction.

### `promptCacheBreakDetection.ts` — Cache Health Monitoring

Tracks prompt cache hits/misses. When a cache break is detected (previously-cached content is no longer in cache), `notifyCompaction()` and `notifyCacheDeletion()` update internal state so the micro-compactor knows to adjust its window.

---

## Part 2: The Compaction Service (`src/services/compact/`)

Compaction solves the context window problem: as conversations grow, they eventually exceed the model's context limit. The compaction service provides three strategies.

### Three Compaction Modes

```
Manual compact (/compact command)
    │
    └── compactConversation()
              │
              └── Summarize → truncate → inject boundary marker

Auto compact (background, threshold-based)
    │
    └── checkAutoCompact() → triggered when tokens > threshold
              │
              └── Same compactConversation() flow

Micro compact (time-based tool result trimming)
    │
    └── microCompact() → trims large tool results in-place
              │
              └── Preserves conversation structure, just shrinks content
```

### `compact.ts` — Core Compaction

`compactConversation()` is the main compaction function:

1. **Pre-compact hooks** — allows extensions to run before compaction
2. **Summarization** — runs a forked agent with a summarization prompt to distill the conversation
3. **Boundary injection** — inserts `<compact-boundary>` marker in the message history
4. **Post-compact hooks** — cleanup after compaction
5. **File state cache flush** — resets cached file contents so stale reads don't persist

The compact summary is injected as a user message, providing context for the continuing conversation without the full history.

```python
# create_compact_boundary_message() — the splice point in message history
# Messages before the boundary are dropped from API calls.
# The boundary itself carries the summary of what was before it.
```

### `autoCompact.ts` — Automatic Triggering

Auto-compact fires when token count approaches the context window limit:

```python
# Thresholds (from context window size):
AUTOCOMPACT_BUFFER_TOKENS = 13_000   # Trigger auto-compact this far from limit
WARNING_THRESHOLD_BUFFER_TOKENS = 20_000  # Show warning this far from limit
MANUAL_COMPACT_BUFFER_TOKENS = 3_000  # Reserve for manual compact output
```

**Circuit breaker**: stops retrying after `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3` consecutive failures. Without this, a session permanently over the limit would waste ~250K API calls/day globally (observed in production).

**CLAUDE_CODE_AUTO_COMPACT_WINDOW** — env var override for testing: forces the effective context window to a lower value to trigger auto-compact sooner.

### `microCompact.ts` — Time-Based Tool Result Trimming

Micro-compact is a lighter-weight operation that trims large tool results **in-place** without summarizing the conversation:

```python
COMPACTABLE_TOOLS = {
    FILE_READ_TOOL_NAME,   # Large file reads
    SHELL_TOOL_NAMES,      # Long command outputs
    GREP_TOOL_NAME,
    GLOB_TOOL_NAME,
    WEB_SEARCH_TOOL_NAME,
    WEB_FETCH_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
}
```

Old tool results beyond a configurable time window are replaced with `[Old tool result content cleared]`. Images in tool results are also compacted when they exceed `IMAGE_MAX_TOKEN_SIZE = 2000` tokens.

The `timeBasedMCConfig.ts` provides per-model, dynamically configured thresholds via GrowthBook.

### `grouping.ts` — Compaction Grouping

Groups tool calls for smarter compaction decisions — related tool calls (e.g., a read followed by an edit of the same file) are kept together so the summary doesn't lose the relationship between them.

---

## Part 3: Analytics (`src/services/analytics/`)

### Architecture

```
logEvent('event_name', metadata)
    │
    └── queued until attachAnalyticsSink() called at startup
              │
              ├── GrowthBook experiment tracking
              ├── DataDog metrics
              └── 1P event logging (first-party, Anthropic internal)
```

The `index.ts` module is a **dependency graph leaf** — it imports nothing. Events queue until the sink attaches.

### Type Safety for Analytics Metadata

The codebase enforces strict type safety around what goes into analytics:

```python
from typing import NewType

# Forces developers to verify strings don't contain PII
AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = NewType(
    'AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS', str
)

# Forces developers to declare PII-tagged fields explicitly
AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = NewType(
    'AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED', str
)
```

Usage:
```python
log_event('tengu_tool_use', {
    'tool_name': AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(sanitized_name),
})
```

This type casting requirement makes it impossible to accidentally log sensitive data without explicitly acknowledging it.

`_PROTO_*` keys are special: they're stripped from DataDog and general storage, but the 1P event logger hoists them to proto fields with privileged access controls.

### GrowthBook (`growthbook.ts`) — Feature Flags & Experiments

GrowthBook provides remote feature flags (called "feature gates" and "experiments") that control behavior without requiring a new release:

```python
# Check if a feature is enabled (cached, may be stale)
check_statsig_feature_gate_CACHED_MAY_BE_STALE('tengu_scratch')

# Get a feature value (cached, may be stale)
get_feature_value_CACHED_MAY_BE_STALE('tengu_passport_quail', False)
```

GrowthBook attributes sent for targeting:
```python
from typing import TypedDict, Literal, Optional

class GrowthBookUserAttributes(TypedDict, total=False):
    id: str                         # Device UUID
    session_id: str
    platform: Literal['win32', 'darwin', 'linux']
    organization_uuid: str
    account_uuid: str
    subscription_type: str          # 'claude_pro', 'claude_free', etc.
    first_token_time: float         # First API use timestamp (for cohort analysis)
```

The `_CACHED_MAY_BE_STALE` suffix in function names is a deliberate warning — these check a locally-cached value that may not reflect the latest remote configuration.

### DataDog (`datadog.ts`) — Metrics

DataDog receives aggregated metrics (not individual events). Metrics are buffered and flushed periodically to avoid per-event API overhead.

### First-Party Event Logging

The 1P event logger sends structured events to Anthropic's internal data pipeline. It handles proto-field hoisting, strips PII where appropriate, and manages the BigQuery schema mapping.

**`sinkKillswitch.ts`** — A kill switch that can disable all analytics reporting when triggered remotely.

---

## Part 4: Tool Execution (`src/services/tools/`)

### `toolOrchestration.ts` — Parallel vs. Serial Execution

`runTools()` orchestrates tool call batches from the LLM:

```python
from typing import AsyncGenerator

async def run_tools(
    tool_use_messages: list[ToolUseBlock],
    assistant_messages: list[AssistantMessage],
    can_use_tool: CanUseToolFn,
    tool_use_context: ToolUseContext,
) -> AsyncGenerator[MessageUpdate, None]: ...
```

Tools within a single LLM turn are partitioned by `isConcurrencySafe`:

```
Tool calls in one LLM response
    │
    ├── All concurrency-safe (read-only)?  → runToolsConcurrently()
    │                                           max 10 concurrent
    │                                           (CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY)
    │
    └── Any write-heavy?  → runToolsSerially()
                                one at a time
```

Context modifications from concurrent tools are queued and applied in order after the batch completes, ensuring deterministic context updates.

### `toolExecution.ts` — Per-Tool Execution

`runToolUse()` handles a single tool invocation:

1. **Permission check** — `canUseTool()` gate (hooks into permission system)
2. **Pre-execution hooks** — `executePreToolUseHooks()`
3. **Progress streaming** — tool can yield `ToolProgress` updates during execution
4. **Speculative classifier** — for BashTool, starts a concurrent security classifier
5. **Result handling** — wraps result in `ToolResultBlockParam`
6. **Analytics** — logs tool use with metadata (sanitized tool name, file extension, duration)
7. **Post-execution hooks** — `executePostToolUseHooks()`

**`StreamingToolExecutor.ts`** — Handles tools that stream their output progressively (primarily BashTool for long-running commands). Streams progress updates to the UI while the command runs.

### `toolHooks.ts` — Hook Execution

Manages the execution of user-defined hooks around tool calls:

```python
# Pre-tool-use hook: runs before the tool executes
await execute_pre_tool_use_hooks(tool_name, input)

# Post-tool-use hook: runs after, can modify the result
await execute_post_tool_use_hooks(tool_name, input, output)

# Permission denied hook: runs when a permission check fails
await execute_permission_denied_hooks(tool_name, input)

# Notification hook: runs when a notification is sent
await execute_notification_hooks(notification)
```

Hooks are shell commands defined in `settings.json` and executed via `BashTool`'s sandboxed executor. Hook output can inject additional context into the conversation as `HookResultMessage` attachments.

---

## Part 5: LSP Integration (`src/services/lsp/`)

The Language Server Protocol (LSP) service lets Claude Code query IDE-level intelligence (go-to-definition, diagnostics, hover) without requiring an IDE.

### `LSPServerManager.ts` — Server Lifecycle

`createLSPServerManager()` returns a manager that routes requests to the appropriate LSP server based on file extension:

```python
from typing import Protocol, Optional, Any
from collections.abc import Awaitable

class LSPServerManager(Protocol):
    async def initialize(self) -> None: ...
    async def shutdown(self) -> None: ...
    def get_server_for_file(self, file_path: str) -> Optional[LSPServerInstance]: ...
    async def ensure_server_started(self, file_path: str) -> Optional[LSPServerInstance]: ...
    async def send_request(self, file_path: str, method: str, params: Any) -> Any: ...
    async def open_file(self, file_path: str, content: str) -> None: ...
    async def change_file(self, file_path: str, content: str) -> None: ...
    async def save_file(self, file_path: str) -> None: ...
    async def close_file(self, file_path: str) -> None: ...
    def is_file_open(self, file_path: str) -> bool: ...
```

LSP servers are configured in `settings.json`:

```json
{
  "lsp": {
    "typescript": {
      "command": "typescript-language-server --stdio",
      "extensions": [".ts", ".tsx"]
    }
  }
}
```

### `LSPClient.ts` — Protocol Communication

Implements the JSON-RPC protocol layer. Handles:
- Request/response correlation via sequential request IDs
- Notification dispatch (server → client)
- Connection lifecycle (initialize → ready → shutdown)

### `LSPDiagnosticRegistry.ts` — Diagnostic Aggregation

Aggregates diagnostics (errors, warnings) published by LSP servers. The `LSPTool` (Chapter 8) queries this registry to surface compile errors and type issues in the conversation.

### `passiveFeedback.ts` — Background Diagnostics

Runs periodic diagnostic collection in the background. When the model edits a file, the LSP server's diagnostics for that file are automatically injected into the next conversation turn as context.

---

## Part 6: OAuth (`src/services/oauth/`)

The OAuth service handles the Claude.ai subscriber authentication flow.

### `client.ts` — Token Management

```python
# Token lifecycle:
# 1. Login: initiate OAuth flow, receive authorization code
# 2. Exchange: code → access token + refresh token
# 3. Refresh: use refresh token when access token expires
# 4. Revoke: on logout
```

`isOAuthTokenExpired()` checks expiry before making API calls, avoiding 401 round-trips.

### `auth-code-listener.ts` — Local Callback Server

Starts a local HTTP server on a random port to receive the OAuth authorization code callback from the browser. The redirect URI is `http://localhost:<port>/callback`.

### `crypto.ts` — PKCE

Implements PKCE (Proof Key for Code Exchange) for the OAuth flow:
- Generates a cryptographically random `code_verifier`
- Derives `code_challenge` via SHA-256
- Prevents authorization code interception attacks

---

## Part 7: Voice Services

Three files handle voice input:

### `voice.ts` — Audio Recording

Manages push-to-talk audio recording with multiple fallback backends:

```
1. audio-capture-napi (native, lazy-loaded to avoid startup dlopen delay)
   Platform: macOS (CoreAudio), Linux (ALSA), Windows

2. SoX rec command
   Platform: Linux/macOS with SoX installed

3. arecord (ALSA)
   Platform: Linux
```

Recording parameters: 16kHz, mono (optimized for speech recognition). Silence detection stops recording after 2 seconds of silence below 3% threshold (SoX backend).

The `audio-capture-napi` module is **lazy-loaded on first voice keypress** to avoid a 1-8 second startup freeze from `dlopen`.

### `voiceStreamSTT.ts` — Streaming Speech-to-Text

Streams audio bytes to the Anthropic API's speech-to-text endpoint. Returns a streaming transcript so the user can see text appearing as they speak.

### `voiceKeyterms.ts` — Keyword Detection

Detects specific keywords (wake words, commands) in the audio stream for hands-free interaction.

---

## Part 8: Remaining Services

### `vcr.ts` — API Recording/Replay

The VCR (Video Cassette Recorder) service records API calls to fixture files and replays them in tests:

```python
# Active in TEST_ENV=1 or FORCE_VCR=1 (ant-only)
# Fixture file: fixtures/<name>-<sha1-of-input>.json

from typing import TypeVar, Callable, Awaitable, Any
T = TypeVar('T')

async def with_fixture(
    input: Any,
    fixture_name: str,
    f: Callable[[], Awaitable[T]],
) -> T: ...
```

Fixtures are keyed by SHA1 hash of the input. Cache hit → return stored response. Cache miss → call real API, store result.

This allows tests to run without live API access and makes them deterministic. The VCR is used for token counting (`withTokenCountVCR()`) and API responses.

### `notifier.ts` — Desktop Notifications

`sendNotification()` dispatches notifications through one of several channels:

```python
# Channel selection (from config.preferred_notif_channel):
# 'auto'             → detect best available channel
# 'iterm2'           → iTerm2 OSC escape sequence
# 'iterm2_with_bell' → iTerm2 + terminal bell
# 'kitty'            → Kitty notification protocol
# 'terminal-bell'    → Basic terminal bell (\x07)
# 'system'           → OS notification (osascript/notify-send/PowerShell)
```

Notification hooks run before channel dispatch, allowing custom notification handlers.

### `rateLimitMessages.ts` — Rate Limit Messaging

Central source of truth for all rate limit message strings. The UI components use `isRateLimitErrorMessage()` and `getRateLimitMessage()` rather than hardcoded string patterns:

```python
RATE_LIMIT_ERROR_PREFIXES = [
    "You've hit your",
    "You've used",
    "You're now using extra usage",
    "You're close to",
    "You're out of extra usage",
]
```

### `tokenEstimation.ts` — Offline Token Counting

Provides token count estimates without an API round-trip. Uses `roughTokenCountEstimation()` based on character count approximations. Used when the exact count isn't critical (UI display, early warnings).

For exact counting, `tokenCountWithEstimation()` uses the Anthropic API's token counting endpoint, with VCR caching in test environments.

### `diagnosticTracking.ts` — Session Health

Tracks session health metrics: tool errors, API failures, recovery attempts. Used for internal monitoring and debugging.

### `preventSleep.ts` — System Sleep Prevention

On macOS, prevents system sleep during long-running operations using `caffeinate`. On other platforms, no-op.

### Tips (`src/services/tips/`)

The tips service manages the occasional helpful tips shown in the REPL. It maintains a history of shown tips, respects a minimum interval between tips, and draws from a registry of categorized tips.

### Agent Summary (`src/services/AgentSummary/`)

Generates concise summaries of agent task results for display in the tasks panel and notifications. Uses a side-query to Sonnet with a summary-focused prompt.

### Prompt Suggestion (`src/services/PromptSuggestion/`)

Speculative prompt completion — starts a background inference while the user is typing to precompute likely next prompts. Results are cached and displayed if the user's actual prompt matches the speculation.

### x402 (`src/services/x402/`)

The x402 payment protocol service — handles micropayment negotiation for paid API services. Named after HTTP status code 402 ("Payment Required").

### Settings Sync (`src/services/settingsSync/`)

Syncs settings changes between the CLI process and connected IDE extensions via the bridge (Chapter 14).

---

## How the Service Layer Connects to the Query Engine

```
User input
    │
    ▼
QueryEngine.ts
    │
    ├── api/claude.ts         ← Makes streaming API call
    │        │
    │        └── withRetry.ts ← Wraps with retry logic
    │
    ├── compact/autoCompact.ts ← Checks token threshold each turn
    │
    ├── tools/toolOrchestration.ts ← Runs tool calls in LLM response
    │        │
    │        └── tools/toolExecution.ts ← Executes each tool
    │
    ├── analytics/index.ts    ← Logs events throughout
    │
    └── tokenEstimation.ts    ← Updates token count display
```

The service layer is "invisible infrastructure" — it makes the query engine reliable, observable, and manageable without the query engine needing to know the details of any individual service.

---

*Next: [Chapter 18 — State Management](PartVI-Services-Infrastructure-18-State-Management.md)*
