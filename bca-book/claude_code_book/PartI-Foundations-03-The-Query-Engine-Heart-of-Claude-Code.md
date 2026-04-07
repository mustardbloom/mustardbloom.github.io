# Chapter 3: The Query Engine — Heart of Claude Code

> **Part I: Foundations**

---

## What the Query Engine Does

`src/QueryEngine.ts` is approximately **46,000 lines** — the largest and most complex file in the codebase. It is the central orchestrator of every Claude interaction. When you type a message and press Enter, the Query Engine:

1. Assembles the system prompt from tools, context, and memory
2. Manages the conversation history
3. Streams the request to the Anthropic API
4. Processes the response stream (text chunks and tool_use blocks)
5. Executes the tool-call loop — potentially running dozens of tools per turn
6. Tracks token usage and cost
7. Handles errors, retries, and context compaction
8. Yields structured messages back to the REPL or SDK caller

Everything else in Claude Code exists to support this engine or display its output.

---

## The `QueryEngine` Class

The `QueryEngine` is instantiated **once per conversation**. Each user message is a new "turn" within the same engine instance:

```python
from typing import AsyncGenerator, Optional, Union

class QueryEngine:
    def __init__(self, config: 'QueryEngineConfig') -> None:
        self.config: QueryEngineConfig = config
        self.mutable_messages: list[Message] = []          # Conversation history
        self.abort_controller: AbortController = ...       # For cancellation
        self.permission_denials: list[SDKPermissionDenial] = []
        self.total_usage: NonNullableUsage = ...           # Cumulative token counts
        self.read_file_state: FileStateCache = ...         # LRU cache of file reads
        self.discovered_skill_names: set[str] = set()
        self.loaded_nested_memory_paths: set[str] = set()

    async def submit_message(
        self,
        prompt: Union[str, list['ContentBlockParam']],
        options: Optional[dict] = None,  # uuid, is_meta
    ) -> AsyncGenerator['SDKMessage', None]: ...
```

`submitMessage()` is an **async generator**. It yields `SDKMessage` objects as the turn progresses — partial text chunks, tool invocations, tool results, status updates — and returns when the turn is complete. Both the REPL (which renders these to the terminal) and the SDK (which returns them to the caller) consume this generator.

### `QueryEngineConfig`

The configuration object passed to `QueryEngine`:

```python
from typing import TypedDict, Optional, Callable

class QueryEngineConfig(TypedDict, total=False):
    cwd: str                               # Working directory
    tools: Tools                           # Available tools
    commands: list[Command]                # Available slash commands
    mcp_clients: list[MCPServerConnection] # Connected MCP servers
    agents: list[AgentDefinition]          # Available agent types
    can_use_tool: CanUseToolFn             # Permission check function
    get_app_state: Callable[[], AppState]  # State accessor
    set_app_state: Callable                # State updater
    initial_messages: list[Message]        # Pre-loaded conversation
    read_file_cache: FileStateCache        # File read cache
    custom_system_prompt: str             # Override default system prompt
    append_system_prompt: str             # Append to system prompt
    user_specified_model: str             # Model override
    thinking_config: ThinkingConfig
    max_turns: int                        # Turn limit (SDK use)
    max_budget_usd: float                 # Dollar budget cap
    task_budget: dict                     # Token budget cap (total key)
    verbose: bool
    # ... more fields
```

---

## The System Prompt Assembly

Before the first API call, the Query Engine assembles the system prompt:

```python
result = await fetch_system_prompt_parts(
    tools=tools,
    main_loop_model=initial_main_loop_model,
    additional_working_directories=additional_working_directories,
    mcp_clients=mcp_clients,
    custom_system_prompt=custom_system_prompt,
)
default_system_prompt = result['default_system_prompt']
user_context = result['user_context']
system_context = result['system_context']

system_prompt = as_system_prompt([
    *([custom_prompt] if custom_prompt is not None else default_system_prompt),
    *([memory_mechanics_prompt] if memory_mechanics_prompt else []),
    *([append_system_prompt] if append_system_prompt else []),
])
```

The system prompt is built from:

1. **Default system prompt** — Claude's behavior instructions, personality, tool guidance
2. **Tool `prompt()` contributions** — each tool can inject text into the system prompt (e.g., BashTool explains its timeout behavior, FileEditTool explains the uniqueness requirement)
3. **Memory mechanics prompt** — if auto-memory is configured, instructions for using the memory system
4. **Append system prompt** — caller-provided additions (via `--append-system-prompt` or SDK)
5. **User context** — OS, shell, current directory, git status, CLAUDE.md contents

---

## The Tool-Call Loop

This is the core of the Query Engine. After the initial API request, the engine processes the response stream:

```
LOOP:
  1. Send messages to Anthropic API (streaming)
  2. Buffer streaming chunks:
     - text_delta → accumulate into response text
     - tool_use → collect tool name + input JSON
  3. When stream ends:
     a. If response has text only → DONE (exit loop)
     b. If response has tool_use blocks → execute them
  4. For each tool_use block:
     a. Validate tool input against Zod schema
     b. Call wrappedCanUseTool() → check permissions
     c. If denied → record denial, add tool_result with error
     d. If allowed → execute tool.call()
     e. Add tool_result message to conversation
  5. Add all tool results to conversation history
  6. GOTO 1 (continue loop with updated conversation)
```

The loop terminates when:
- The LLM response contains no `tool_use` blocks (`completed`)
- The abort controller fires (`aborted_tools`, `aborted_streaming`)
- Maximum turns are reached (`max_turns`)
- A stop hook halts execution (`stop_hook_prevented`, `hook_stopped`)
- The prompt exceeds the context window (`prompt_too_long`)
- A model error occurs (`model_error`)

### Loop Transitions

`src/query/transitions.ts` defines the typed state machine for the loop:

```python
from typing import Literal
from dataclasses import dataclass

# Terminal transition — the query loop returned.
@dataclass
class Terminal:
    reason: Literal[
        'completed',           # Normal: LLM done with no pending tools
        'blocking_limit',      # Hit a hard limit
        'image_error',         # Image processing failed
        'model_error',         # API error
        'aborted_streaming',   # User pressed Ctrl+C during streaming
        'aborted_tools',       # User pressed Ctrl+C during tool execution
        'prompt_too_long',     # Context window exceeded
        'stop_hook_prevented', # A stop hook blocked completion
        'hook_stopped',        # A hook halted the loop
        'max_turns',           # Turn limit reached
    ]

# Continue transition — the loop will iterate again.
@dataclass
class Continue:
    reason: Literal[
        'tool_use',                    # LLM requested tools
        'reactive_compact_retry',      # Retrying after auto-compaction
        'max_output_tokens_recovery',  # Recovering from output truncation
        'max_output_tokens_escalate',  # Escalating from truncation
        'collapse_drain_retry',        # Draining collapsed tool results
        'stop_hook_blocking',          # Stop hook wants to block
        'token_budget_continuation',   # Budget nudging for continuation
        'queued_command',              # A queued slash command needs processing
    ]
```

These types make the loop's behavior explicit and auditable. When debugging Claude Code behavior, you can trace which transition fired and why.

---

## Streaming Architecture

Claude Code uses **server-sent events streaming** from the Anthropic API. Rather than waiting for the complete response before rendering, it processes chunks as they arrive:

```
API sends:   event: content_block_delta
             data: {"type": "text_delta", "text": "Here is "}

             event: content_block_delta
             data: {"type": "text_delta", "text": "the fix:"}

             event: content_block_start
             data: {"type": "tool_use", "name": "FileEdit", ...}
```

The Query Engine accumulates text deltas and displays them progressively — you see Claude's response appear word by word in the terminal.

Tool use blocks accumulate the input JSON as it streams, then fire the tool call when the block is complete (after the `content_block_stop` event).

---

## Thinking Mode & Token Budget

Claude can engage in "extended thinking" — an internal reasoning process before producing a response. The Query Engine manages this through `ThinkingConfig`:

```python
from typing import Union, Literal
from dataclasses import dataclass, field

@dataclass
class ThinkingDisabled:
    type: Literal['disabled'] = 'disabled'

@dataclass
class ThinkingEnabled:
    type: Literal['enabled'] = 'enabled'
    budget_tokens: int = 0

@dataclass
class ThinkingAdaptive:
    type: Literal['adaptive'] = 'adaptive'  # Decide based on prompt complexity

ThinkingConfig = Union[ThinkingDisabled, ThinkingEnabled, ThinkingAdaptive]
```

The initial thinking config is determined at the start of `submitMessage()`:

```python
initial_thinking_config: ThinkingConfig = (
    thinking_config
    if thinking_config
    else ThinkingAdaptive() if should_enable_thinking_by_default() is not False
    else ThinkingDisabled()
)
```

### Token Budget (`src/query/tokenBudget.ts`)

For extended thinking, the Query Engine must track how many tokens Claude has used in its thinking process. `tokenBudget.ts` manages this:

```python
from dataclasses import dataclass

# Two thresholds control the budget behavior:
COMPLETION_THRESHOLD = 0.9   # 90% spent → consider stopping
DIMINISHING_THRESHOLD = 500  # < 500 new tokens per check → diminishing returns

@dataclass
class BudgetTracker:
    continuation_count: int       # How many times we've continued
    last_delta_tokens: int        # Tokens used since last check
    last_global_turn_tokens: int  # Total tokens at last check
    started_at: float             # Timestamp
```

The `checkTokenBudget()` function decides whether to continue or stop a thinking turn:

```python
def check_token_budget(
    tracker: BudgetTracker,
    agent_id: str | None,
    budget: int | None,
    global_turn_tokens: int,
) -> TokenBudgetDecision:
    if agent_id or budget is None or budget <= 0:
        return {'action': 'stop', 'completion_event': None}

    pct = round((turn_tokens / budget) * 100)
    is_diminishing = (
        tracker.continuation_count >= 3 and
        delta_since_last_check < DIMINISHING_THRESHOLD
    )

    if pct >= COMPLETION_THRESHOLD * 100 or is_diminishing:
        return {'action': 'stop', 'completion_event': {...}}

    return {
        'action': 'continue',
        'nudge_message': get_budget_continuation_message(pct, budget),
        ...
    }
```

When the budget is nearly exhausted or thinking is producing diminishing returns (fewer than 500 new tokens per check after 3 continuations), the engine signals the loop to stop the thinking phase and produce a final response.

---

## Stop Hooks (`src/query/stopHooks.ts`)

Stop hooks are **user-defined scripts** that run after each turn. They can:
- Inspect the turn's output
- Signal that the turn should be retried (e.g., "the tests still fail, keep going")
- Block completion entirely

The stop hook system uses a `StopHookResult` type:

```python
from typing import TypedDict, Optional, Literal

class StopHookResult(TypedDict, total=False):
    decision: Literal['block', 'approve', 'error']
    reason: str
```

Stop hooks integrate with:
- `executeStopHooks()` — runs all registered stop hooks
- `executeTaskCompletedHooks()` — runs when a background task completes
- `executeTeammateIdleHooks()` — runs when a teammate agent goes idle
- Memory extraction (`extractMemoriesModule`) — if `EXTRACT_MEMORIES` flag is on

This is how Claude Code's "hooks" feature works at the query level: hooks are external scripts that participate in the turn lifecycle.

---

## Retry Logic

The Query Engine wraps API calls with retry logic from `src/services/api/withRetry.ts`. The `categorizeRetryableAPIError()` function from `src/services/api/errors.ts` classifies each error:

**Retryable errors** (automatic retry with backoff):
- Rate limit errors (HTTP 429) — wait before retrying
- Transient server errors (HTTP 500, 503)
- Network timeouts
- Connection reset errors

**Fatal errors** (no retry):
- Authentication failures (HTTP 401, 403)
- Invalid request (HTTP 400) — retrying won't fix a bad prompt
- Model not found (HTTP 404)
- Context window exceeded — needs compaction, not retry

The backoff strategy uses exponential backoff with jitter: each retry waits `base * 2^attempt + random_jitter` milliseconds, capped at a maximum wait time. This prevents thundering herd problems when many Claude Code instances hit a rate limit simultaneously.

---

## Token Counting & Cost Tracking

Every API response includes usage data:

```python
{
    'input_tokens': 1234,
    'output_tokens': 567,
    'cache_read_input_tokens': 890,    # Cache hits (cheaper)
    'cache_creation_input_tokens': 123  # Cache misses
}
```

The `accumulateUsage()` function from `src/services/api/claude.ts` adds these to the running total in `this.totalUsage`. The cost tracker (`src/cost-tracker.ts`) maps token counts to dollar amounts using per-model pricing data.

This data surfaces to users via the `/cost` command and the status line.

---

## Context Window Management

The conversation history grows with every turn. At some point it approaches the model's context window limit. The Query Engine handles this through **compaction** — summarizing old messages to free up space.

Compaction is triggered reactively when the API returns a `prompt_too_long` error (reactive compact) or proactively when the context usage exceeds a configured threshold (auto-compact).

The compaction flow:
1. All messages before a recent checkpoint are sent to the LLM with a summarization prompt
2. The LLM produces a compact summary of the conversation so far
3. The old messages are replaced with a single summary message
4. The conversation continues from the summary

The loop transition reason `reactive_compact_retry` marks a turn where compaction was just performed and the original request is being retried.

---

## The `src/query/` Subdirectory

The `src/query/` directory contains modules extracted from the main query loop for clarity:

### `config.ts`
Query configuration constants and defaults — default thinking budget, max retry counts, compaction thresholds.

### `deps.ts`
Dependency injection wiring for the query engine. Collects the injected services (API client, file cache, etc.) and validates they are all present.

### `transitions.ts`
The typed state machine (`Terminal` and `Continue` types) shown above. Keeping these types in their own file prevents circular imports between the query engine and its consumers.

### `tokenBudget.ts`
Token budget tracking for extended thinking, as shown above.

### `stopHooks.ts`
Stop hook execution logic. This file imports the hook runner, memory extraction, and other post-sampling logic that fires after each API response.

---

## How the Query Engine Coordinates with the Tool System

The Query Engine does not directly know about any specific tool. Instead, it receives:

1. A `tools: Tools` array — the list of available tools and their schemas
2. A `canUseTool: CanUseToolFn` — the permission gate function

When a `tool_use` block arrives in the API response:

```python
# Simplified — actual code in query.py (src/query.py)
for tool_use in tool_use_blocks:
    tool = next(t for t in tools if tool_matches_name(t, tool_use.name))

    # 1. Parse and validate the input
    parsed_input = tool.input_schema.parse(tool_use.input)

    # 2. Check permissions
    decision = await wrapped_can_use_tool(
        tool, parsed_input, tool_use_context, assistant_msg, tool_use.id
    )

    if decision.behavior != 'allow':
        # Return a tool_result with the denial reason
        results.append({'type': 'tool_result', 'tool_use_id': tool_use.id, 'content': denial})
        continue

    # 3. Execute
    result = await tool.call(parsed_input, tool_use_context)

    # 4. Format result for API
    results.append({'type': 'tool_result', 'tool_use_id': tool_use.id, 'content': result.data})

# 5. Feed all results back in a single user message
messages.append({
    'role': 'user',
    'content': results  # list of tool_result blocks
})
```

The Query Engine then loops back to step 1 (send to API) with the updated conversation including the tool results.

This design means **tools and the query engine are decoupled**: adding a new tool requires no changes to the query engine. The engine just asks "what tools do you have?" at startup and calls whatever it gets.

---

*Next: [Chapter 4 — Tool Architecture](PartII-The-Tool-System-04-Tool-Architecture.md)*
