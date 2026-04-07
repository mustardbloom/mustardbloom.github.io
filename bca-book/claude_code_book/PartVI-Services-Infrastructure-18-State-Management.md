# Chapter 18: State Management

> **Part VI: Services & Infrastructure**

---

## Overview

Claude Code's state management sits at the intersection of terminal UI (Ink/React) and a non-React event system (the query engine, tool execution). The design uses a **custom observable store** that bridges these two worlds without triggering excessive React re-renders in the terminal.

```
src/state/
├── AppStateStore.ts        ← AppState type + getDefaultAppState()
├── AppState.tsx            ← AppStateProvider component (React tree root)
├── store.ts                ← createStore() — the generic observable store
├── selectors.ts            ← Pure derived-state functions
├── onChangeAppState.ts     ← Side-effects triggered by state changes
└── teammateViewHelpers.ts  ← Team-specific view state helpers

src/context/
├── QueuedMessageContext.tsx   ← Message rendering metadata
├── fpsMetrics.tsx             ← FPS performance metrics
├── mailbox.tsx                ← Teammate mailbox polling
├── modalContext.tsx           ← Slash-command dialog context
├── notifications.tsx          ← In-app notification queue
├── overlayContext.tsx         ← Overlay rendering
├── promptOverlayContext.tsx   ← Prompt overlay (speculative input)
├── stats.tsx                  ← Session statistics
└── voice.tsx                  ← Voice input state (ant-only)
```

---

## The Core Store (`store.ts`)

`createStore<T>()` is a minimal observable state container:

```python
from typing import TypeVar, Generic, Callable, Optional

T = TypeVar('T')

class Store(Generic[T]):
    def get_state(self) -> T: ...
    def set_state(self, updater: Callable[[T], T]) -> None: ...
    def subscribe(self, listener: Callable[[], None]) -> Callable[[], None]: ...

def create_store(
    initial_state: T,
    on_change: Optional[Callable[[dict], None]] = None,
) -> Store[T]:
    state = initial_state
    listeners: set[Callable[[], None]] = set()

    class _Store(Store[T]):
        def get_state(self) -> T:
            return state

        def set_state(self, updater: Callable[[T], T]) -> None:
            nonlocal state
            prev = state
            next_ = updater(prev)
            if next_ is prev:  # ← no-op if reference unchanged
                return
            state = next_
            if on_change:
                on_change({'new_state': next_, 'old_state': prev})
            for listener in listeners:
                listener()

        def subscribe(self, listener: Callable[[], None]) -> Callable[[], None]:
            listeners.add(listener)
            return lambda: listeners.discard(listener)  # ← unsubscribe

    return _Store()
```

**Key behaviors:**
- `setState` takes an **updater function** (not a direct value) — ensures atomic read-modify-write
- **Reference equality guard**: `Object.is(next, prev)` prevents spurious re-renders when no value changed
- `subscribe` returns an unsubscribe function (standard React external store pattern)
- `onChange` is called synchronously after each state change — used for session sync side effects

This is the same pattern as Zustand, Redux, or Jotai atoms, but hand-rolled to avoid dependencies and maintain full control over the update cycle.

---

## `AppStateStore.ts` — The Application State Type

`AppState` is a large flat type covering the entire application's mutable state:

```python
from typing import Optional
from typing_extensions import TypedDict
from typing import Literal

class AppState(TypedDict):
    # Settings & Configuration
    settings: SettingsJson
    verbose: bool
    main_loop_model: ModelSetting
    main_loop_model_for_session: ModelSetting

    # UI State
    status_line_text: Optional[str]
    expanded_view: Literal['none', 'tasks', 'teammates']
    is_brief_only: bool
    footer_selection: Optional[FooterItem]    # footer pill keyboard focus

    # Coordinator/Swarm UI
    selected_ip_agent_index: int
    coordinator_task_index: int
    view_selection_mode: Literal['none', 'selecting-agent', 'viewing-agent']
    show_teammate_message_preview: bool

    # Tool Permissions
    tool_permission_context: ToolPermissionContext

    # Task Management
    tasks: dict[str, TaskState]

    # Agent & Teams
    agent: Optional[str]
    kairos_enabled: bool
    remote_session_url: Optional[str]

    # MCP
    mcp_servers: list[MCPServerConnection]

    # Plugins
    plugins: PluginsState

    # Commands & Skills
    commands: list[Command]

    # Planning
    plan_draft: Optional[AllowedPrompt]

    # Speculation
    speculation_state: SpeculationState

    # Attribution
    attribution: AttributionState

    # ... many more fields
```

`DeepImmutable<T>` is a recursive readonly wrapper — every nested object and array is frozen at the type level, preventing accidental mutation. All state changes must go through `setState()`.

`getDefaultAppState()` creates the initial state from settings, environment, and runtime configuration.

---

## `AppState.tsx` — The React Provider

`AppStateProvider` is the root component that wraps the entire UI tree. It:

1. Creates the `Store<AppState>` instance via `useState(() => createStore(...))`
2. Passes the store down via `AppStoreContext`
3. Sets up settings change listeners via `useSettingsChange()`
4. Validates bypass-permissions mode on mount
5. Wraps children in `MailboxProvider` and `VoiceProvider`

```tsx
// AppState.tsx — provider composition:
<HasAppStateContext.Provider value={true}>
  <AppStoreContext.Provider value={store}>
    <MailboxProvider>
      <VoiceProvider>   {/* ant-only, feature-gated */}
        {children}
      </VoiceProvider>
    </MailboxProvider>
  </AppStoreContext.Provider>
</HasAppStateContext.Provider>
```

**Nesting prevention**: `HasAppStateContext` throws an error if `AppStateProvider` is nested inside itself. This catches accidental double-wrapping in development.

**React Compiler optimization**: The file uses the React Compiler's `_c()` memoization primitives throughout — every JSX element and computed value is memoized at the compiled level, not via manual `useMemo()` calls. This is visible in the compiled output as `$[0]`, `$[1]`, etc. keyed arrays.

### Connecting React to the Store

Components access state via `useSyncExternalStore()`:

```python
# Inside use_app_state() or use_app_store():
# useSyncExternalStore equivalent: subscribe to the store and
# re-render whenever the store notifies listeners.
state = use_sync_external_store(
    store.subscribe,
    store.get_state,
    store.get_state,  # server snapshot (same — no SSR)
)
```

`useSyncExternalStore` is React 18's official hook for integrating external state. It handles:
- Subscribing to store updates
- Providing the current snapshot for rendering
- Tearing-prevention (concurrent mode safe)

### Setting State from Outside React

Non-React code (tool execution, query engine) receives `setAppState` as a callback:

```python
from typing import Callable

SetAppState = Callable[[Callable[['AppState'], 'AppState']], None]
```

This function is passed from the React tree down into the query engine at session initialization time, threading React's state system into non-React code without creating a circular dependency.

```
QueryEngine (non-React)
    │
    └── setAppState(prev => ({ ...prev, tasks: { ...prev.tasks, [id]: task } }))
              │
              └── store.setState() → listeners notified → React re-renders
```

---

## `onChangeAppState.ts` — State Change Side Effects

Every state change fires `onChangeAppState()`. This is the **single choke point** for state-driven side effects:

```python
def on_change_app_state(new_state: AppState, old_state: AppState) -> None:
    # 1. Permission mode sync
    if (new_state['tool_permission_context']['mode']
            != old_state['tool_permission_context']['mode']):
        notify_permission_mode_changed(new_state['tool_permission_context']['mode'])

    # 2. Session metadata sync (for CCR / remote workers)
    if _relevant_session_fields_changed(new_state, old_state):
        notify_session_metadata_changed({
            'permission_mode': to_external_permission_mode(
                new_state['tool_permission_context']['mode']
            ),
            'is_ultraplan_mode': new_state['is_ultraplan_mode'],
        })

    # 3. Model override sync
    if new_state['main_loop_model'] != old_state['main_loop_model']:
        set_main_loop_model_override(new_state['main_loop_model'])

    # 4. Settings persistence
    if new_state['settings'] is not old_state['settings']:
        update_settings_for_source(new_state['settings'])
```

Prior to this architecture, permission mode changes were relayed to CCR/SDK by only 2 of 8+ mutation paths — a known bug where the web UI showed stale mode. `onChangeAppState` fixed this by making state sync automatic on every change, regardless of which code path triggered the mutation.

---

## `selectors.ts` — Pure State Derivations

Selectors compute derived state from `AppState` without mutation:

```python
from typing import Optional, Union
from typing_extensions import TypedDict

# get_viewed_teammate_task() — null-safe lookup
def get_viewed_teammate_task(
    app_state: 'AppState',  # uses only viewing_agent_task_id and tasks
) -> Optional['InProcessTeammateTaskState']:
    ...

# get_active_agent_for_input() — where user input is routed
class ActiveAgentLeader(TypedDict):
    type: Literal['leader']

class ActiveAgentViewed(TypedDict):
    type: Literal['viewed']
    task: 'InProcessTeammateTaskState'

class ActiveAgentNamed(TypedDict):
    type: Literal['named_agent']
    task: 'LocalAgentTaskState'

ActiveAgentForInput = Union[ActiveAgentLeader, ActiveAgentViewed, ActiveAgentNamed]

def get_active_agent_for_input(app_state: 'AppState') -> ActiveAgentForInput:
    ...
```

`getActiveAgentForInput` is used by the input routing logic to direct user messages to the correct agent in swarm mode. The discriminated union type makes exhaustive handling safe.

---

## `src/context/` — React Contexts

The `context/` directory holds **feature-scoped React contexts** that are narrower than `AppState`. Rather than putting everything in the global store, some state lives in dedicated contexts:

### `QueuedMessageContext.tsx`

Provides metadata to message rendering components:

```python
from typing_extensions import TypedDict

class QueuedMessageContextValue(TypedDict):
    is_queued: bool       # Is this message in a queued batch?
    is_first: bool        # Is this the first message in the queue?
    padding_width: int    # Width reduction for container padding
```

Used by `QueuedMessageProvider` to wrap batches of queued messages with consistent layout metadata. Avoids prop-drilling through the message rendering tree.

### `fpsMetrics.tsx`

Provides FPS (frames-per-second) performance metrics to any component:

```python
from typing import Callable, Optional

FpsMetricsGetter = Callable[[], Optional['FpsMetrics']]

# Access:
get_fps_metrics: Optional[FpsMetricsGetter] = use_fps_metrics()
metrics = get_fps_metrics() if get_fps_metrics is not None else None
```

The getter pattern (function rather than direct value) avoids subscribing every consumer to every frame update. Components can choose when to call the getter.

### `modalContext.tsx`

Set by `FullscreenLayout` when rendering slash-command dialogs in the modal slot:

```python
from typing import Optional
from typing_extensions import TypedDict

class ModalCtx(TypedDict):
    rows: int                                   # Available rows in the modal (smaller than terminal)
    columns: int
    scroll_ref: Optional['Ref[Optional[ScrollBoxHandle]]']  # ref to scroll handle, or None
```

Three purposes:
1. **Suppress framing**: `Pane` skips its top divider (the modal already draws one)
2. **Correct pagination**: `Select` components know the actual available rows (not terminal height)
3. **Scroll reset**: Tab switches can reset scroll position via `scrollRef`

```python
# Use inside modals instead of use_terminal_size():
modal_size = use_modal_or_terminal_size(terminal_size)
rows, columns = modal_size['rows'], modal_size['columns']
```

### `notifications.tsx`

In-app notification queue for transient messages (not OS notifications):

```python
# Usage:
notifications = use_notifications()
notifications.add_notification(message="Memory saved", type="success")
```

Notifications automatically dismiss after a timeout. The context handles the queue management so callers don't need to track dismissal themselves.

### `overlayContext.tsx` and `promptOverlayContext.tsx`

**Overlay context**: provides an overlay rendering slot for content that needs to render above the normal UI hierarchy (e.g., permission dialogs, confirmation prompts).

**Prompt overlay context**: provides the speculative input overlay — when speculation is active, a ghost preview of the predicted prompt renders in the input area.

### `stats.tsx`

Session statistics context:

```python
# Token counts, tool use counts, duration
# Displayed in footer pill and /stats command output
```

### `mailbox.tsx`

Provides the teammate mailbox polling context. When in swarm mode, `MailboxProvider` wraps the tree and polls each teammate's inbox at regular intervals.

### `voice.tsx`

Ant-only voice input state. Feature-gated via `feature('VOICE_MODE')`:

```python
# In app_state.py:
if feature('VOICE_MODE'):
    from context.voice import VoiceProvider
else:
    def VoiceProvider(children):  # passthrough in external builds
        return children
```

Voice state includes: recording status, current transcript, STT configuration.

---

## Data Flow

### User Input → State

```
User types in PromptInput
    │
    ▼
REPL.tsx dispatches action
    │
    ▼
store.setState(updater)
    │
    ├── onChangeAppState() (side effects)
    └── listeners notified → useSyncExternalStore triggers re-render
```

### Tool Execution → State

```
QueryEngine calls runTools()
    │
    ▼
toolExecution.ts calls setAppState()
    │
    ▼
Task state updated: tasks[id] = { ...task, status: 'running' }
    │
    ▼
React re-renders TasksPill with new task status
```

### Settings Change → State

```
User edits settings.json (file watcher)
    │
    ▼
useSettingsChange() fires
    │
    ▼
applySettingsChange(source, store.setState)
    │
    ▼
settings field updated in AppState
    │
    ├── onChangeAppState() (re-applies env vars, clears caches)
    └── Components re-render with new settings
```

---

## Performance Considerations

### Immutability and Reference Equality

Every `setState` call must return a **new object reference** if anything changed, or the **same reference** if nothing changed. The `Object.is(next, prev)` guard in `createStore` relies on this.

```python
# Good — new reference only when changed:
def update_task_status(prev: AppState) -> AppState:
    task = prev['tasks'].get(id)
    if task is not None and task.get('status') == new_status:
        return prev  # same reference — no re-render triggered
    return {
        **prev,
        'tasks': {
            **prev['tasks'],
            id: {**prev['tasks'].get(id, {}), 'status': new_status},
        },
    }

store.set_state(update_task_status)

# Bad — always creates new reference even if nothing changed:
store.set_state(lambda prev: {**prev})
```

Spread operators create new object references, so deep spreads are only appropriate when something actually changed.

### Task State — Avoiding Full Re-renders

`AppState.tasks` is a `Record<string, TaskState>`. Updating a single task must spread only the `tasks` map:

```python
store.set_state(lambda prev: {
    **prev,
    'tasks': {
        **prev['tasks'],
        task_id: {**prev['tasks'].get(task_id, {}), **update},
    },
})
```

Only components that read `tasks[taskId]` will re-render — other tasks aren't affected (assuming memoization via `React.memo` or React Compiler's automatic memoization).

### FPS Throttling

The UI renders at most N times per second, controlled by `fpsMetrics.tsx`. This prevents the terminal from flickering during high-frequency state updates (streaming tool output, progress counters).

The FPS throttle works by debouncing `store.subscribe` listener calls — state changes are still applied immediately, but re-renders are batched within a frame window.

---

## State Persistence

Most `AppState` is ephemeral (session-scoped). Persistent state lives elsewhere:
- **Settings** (`settings.json`) — loaded at startup, saved on change via `updateSettingsForSource()`
- **Session metadata** — written to session sidecar for `--resume`
- **Tasks** — task output files on disk; state reconstructed on resume
- **Permission grants** — stored in `toolPermissionContext`, persisted to session

---

*Next: [Chapter 19 — Configuration & Schemas](PartVI-Services-Infrastructure-19-Configuration-Schemas.md)*
