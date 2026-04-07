# Chapter 10: Ink — React for the Terminal

> **Part IV: The UI Layer**

---

## Overview

Claude Code renders its terminal UI using **React + Ink** — a framework that mounts React component trees to the terminal instead of the browser DOM. Rather than using ncurses, blessed, or raw terminal codes, every UI element is a React component. This is not a thin wrapper: the codebase contains a full custom Ink implementation in `src/ink/` (~40 files).

The primary advantage: the entire Claude Code UI is written using the same React patterns as a web app — components, hooks, context, concurrent rendering. The terminal is just the target renderer.

---

## Entry Points

| File | Role |
|------|------|
| `src/ink.ts` | Public API: re-exports `render()` / `createRoot()`, wraps every tree with `ThemeProvider` |
| `src/ink/root.ts` | Manages `Ink` class instances, keyed by stdout stream |
| `src/ink/ink.tsx` | Core `Ink` class — owns the React root, terminal I/O, layout, frame output |
| `src/ink/reconciler.ts` | React reconciler mapping React elements → `DOMElement`/`TextNode` |
| `src/ink/dom.ts` | Terminal "DOM" nodes; each element owns a Yoga layout node |
| `src/ink/renderer.ts` | Converts the laid-out DOM tree into a 2-D screen buffer |
| `src/ink/render-node-to-output.ts` | Walks the DOM and paints styled text into an `Output` grid |
| `src/ink/log-update.ts` | Diffs new frame against previous, writes minimal ANSI sequences |

---

## The Full Render Pipeline

```
Your React Component
         │
         ▼
src/ink.ts :: render(node)
  └─ Wraps with ThemeProvider
  └─ await Promise.resolve()  (microtask boundary for async startup)
  └─ calls inkRender()
         │
         ▼
src/ink/root.ts :: renderSync(node, opts)
  └─ Creates or reuses an Ink instance keyed by stdout stream
  └─ Registers instance in global instances Map
         │
         ▼
src/ink/ink.tsx :: Ink#render(node)
  └─ Calls React reconciler: updateContainerSync()
         │
         ▼
src/ink/reconciler.ts  (react-reconciler v0.31 host config)
  ├─ createInstance()     → createNode()       (DOMElement + Yoga node)
  ├─ createTextInstance() → createTextNode()   (TextNode, no Yoga)
  ├─ appendChild / insertBefore / removeChild  (mirrors into Yoga tree)
  └─ resetAfterCommit()  → triggers layout + render
         │
         ▼
src/ink/dom.ts  (Virtual DOM)
  ├─ DOMElement  { nodeName, attributes, childNodes, style, yogaNode }
  └─ TextNode    { '#text', nodeValue }
         │
         ▼
src/native-ts/yoga-layout/ (Yoga flexbox, pure TS — no WASM)
  └─ calculateLayout() → computes x/y/width/height for every DOMElement
         │
         ▼
src/ink/renderer.ts :: createRenderer()(frameOptions)
  ├─ Validates computed dimensions
  ├─ Builds Output screen buffer (2-D character grid)
  └─ Calls renderNodeToOutput() to paint each node
         │
         ▼
src/ink/render-node-to-output.ts
  └─ Recursively walks DOMElement tree
  └─ Applies text styles via chalk (colors, bold, italic, etc.)
         │
         ▼
src/ink/log-update.ts :: LogUpdate#render(frame)
  └─ Diffs new frame against prevFrame (character-cell granularity)
  └─ Writes minimal ANSI cursor-move + text sequences to stdout
         └─ Only changed cells are rewritten (incremental blit)
```

This is the critical architectural insight: **only changed terminal cells are rewritten on each render**. React's virtual DOM diffing determines which components changed; Yoga calculates new positions; the log-update module writes only the minimum ANSI escape sequences to update the screen.

---

## Custom React Reconciler (`reconciler.ts`)

Claude Code uses React's `react-reconciler` package with a custom host configuration. This is the same mechanism used by React Native (which renders to native views) and React Three Fiber (which renders to WebGL scenes).

The host config implements:

| Method | What it does |
|--------|-------------|
| `createInstance(type, props)` | Creates a `DOMElement` with a Yoga layout node |
| `createTextInstance(text)` | Creates a `TextNode` (no Yoga layout) |
| `appendChildToContainer(container, child)` | Attaches child to parent's DOM |
| `insertBefore(parent, child, before)` | Ordered insertion |
| `removeChild(parent, child)` | Removes from DOM and Yoga tree |
| `commitUpdate(instance, updatePayload)` | Updates element properties |
| `resetAfterCommit(container)` | Called after every React commit → triggers layout |

The `resetAfterCommit` hook is where the Yoga layout calculation and re-render are triggered. Every time React commits a state change (a hook fires, context updates, etc.), the entire layout is recalculated and the screen is redrawn.

---

## The Virtual DOM (`dom.ts`)

The terminal DOM has two node types:

**`DOMElement`**:
```python
from typing import TypedDict, Union, Optional

class DOMElement(TypedDict, total=False):
    node_name: ElementName               # 'ink-box', 'ink-text', etc.
    attributes: dict[str, object]        # Style props, event handlers
    child_nodes: list[Union['DOMElement', 'TextNode']]
    style: Styles                        # Flexbox + text styles
    yoga_node: Optional[YogaNode]        # Yoga layout node
    # ... internal rendering state
```

**`TextNode`**:
```python
from typing import TypedDict, Literal

class TextNode(TypedDict):
    node_name: Literal['#text']
    node_value: str
    # No Yoga node — text nodes don't participate in layout
```

---

## Custom JSX Host Elements

Ink registers six custom React host elements:

| JSX Element | Component | Purpose |
|-------------|-----------|---------|
| `ink-root` | Root container | Owns the `FocusManager` |
| `ink-box` | `<Box>` | Flexbox layout container |
| `ink-text` | `<Text>` | Leaf text node |
| `ink-virtual-text` | Inline text | No Yoga layout (inline only) |
| `ink-link` | `<Link>` | OSC 8 hyperlink escape sequence |
| `ink-progress` | Progress bar | Primitive progress indicator |
| `ink-raw-ansi` | Raw ANSI | Pre-rendered ANSI string (bypasses text measurement) |

`global.d.ts` declares these in the JSX namespace so TypeScript accepts them as valid JSX elements.

---

## Layout Engine — Yoga (Native TypeScript)

Yoga is Facebook's implementation of the CSS Flexbox layout algorithm for native UI. It is used by React Native for mobile layout and by Claude Code for terminal layout.

**Critical implementation detail**: Claude Code uses a **native TypeScript port** of Yoga (`src/native-ts/yoga-layout/`) rather than the WebAssembly build. This eliminates WASM loading latency (~20-50ms) from startup and removes the WASM parsing overhead.

Yoga properties available in Ink components correspond directly to CSS Flexbox:

| Yoga Property | CSS Equivalent |
|--------------|---------------|
| `flexDirection` | `flex-direction` |
| `alignItems` | `align-items` |
| `justifyContent` | `justify-content` |
| `flexWrap` | `flex-wrap` |
| `flexGrow` | `flex-grow` |
| `flexShrink` | `flex-shrink` |
| `padding` | `padding` |
| `margin` | `margin` |
| `width` / `height` | `width` / `height` |
| `minWidth` / `maxWidth` | `min-width` / `max-width` |
| `position` | `position` (relative/absolute) |

---

## Terminal I/O (`src/ink/termio/`)

The `termio/` directory handles parsing terminal escape sequences from stdin (keyboard input, mouse events, terminal queries):

**`tokenize.ts`** and **`parser.ts`**: Parse the raw byte stream from stdin into structured events. Terminal escape sequences are multi-byte sequences starting with `\x1b` (ESC).

**`ansi.ts`**: Constants for ANSI control characters. Defines the escape sequences for cursor movement, screen clearing, and color codes.

**`csi.ts`** (Control Sequence Introducer): Parses sequences starting with `\x1b[`. This covers cursor movement (`\x1b[A` = up), color codes (`\x1b[31m` = red), and mouse events.

**`sgr.ts`** (Select Graphic Rendition): Parses `\x1b[<n>m` sequences that control text appearance: bold, italic, underline, foreground/background colors, 256-color, truecolor RGB.

**`osc.ts`** (Operating System Commands): Handles `\x1b]` sequences. Used for terminal title setting and hyperlinks (OSC 8: `\x1b]8;;url\x1b\\text\x1b]8;;\x1b\\`).

**`dec.ts`** (DEC terminal sequences): Private mode sequences like `\x1b[?1049h` (alternate screen) and `\x1b[?25l` (hide cursor). The `SHOW_CURSOR` constant is imported in `main.tsx` to restore cursor visibility on exit.

**`esc.ts`**: Simple escape sequences (not CSI or OSC).

---

## Events System (`src/ink/events/`)

Terminal events are dispatched through `emitter.ts` and `dispatcher.ts`:

**`keyboard-event.ts`**: Defines `KeyboardEvent` with properties like `key`, `ctrl`, `meta`, `shift`. The `useInput` hook listens to these events.

**`click-event.ts`**: Mouse click events (requires terminal mouse support). Contains X/Y coordinates.

**`focus-event.ts`**: Focus gain/loss events for interactive elements.

The `FocusManager` (owned by the `ink-root` element) tracks which element has keyboard focus and routes `KeyboardEvent` to the focused element's handler.

---

## Components (`src/ink/components/`)

Base Ink primitives (the lowest layer of the component hierarchy):

**`Box`**: The flexbox container. Every layout in Claude Code is built from nested `Box` elements. Props map directly to Yoga layout properties.

**`Text`**: Text rendering with style props: `color`, `backgroundColor`, `bold`, `italic`, `underline`, `strikethrough`, `dimColor`, `inverse`, `wrap`.

**`ScrollBox`**: A scrollable container. Manages scroll offset state and renders only visible lines, handling large content (like long conversation histories) efficiently.

**`Button`**: Interactive button with focus support, keyboard activation (Enter/Space).

**`Link`**: Renders text as a clickable hyperlink using OSC 8 escape sequences. Only visible in terminals that support OSC 8 (iTerm2, Kitty, Wezterm, etc.).

---

## Hooks (`src/ink/hooks/`)

**`useInput(handler, options)`**: The primary keyboard input hook. Registers a handler called for each key press:
```python
def handle_input(input: str, key: KeyboardEvent) -> None:
    if key.ctrl and input == 'c':
        pass  # handle Ctrl+C
    if key.return_:
        pass  # handle Enter

use_input(handle_input)
```

**`useStdin()`**: Access to raw stdin. Returns `{ stdin, setRawMode, isRawModeSupported }`.

**`useAnimationFrame()`**: Called on each terminal render frame. Used for spinner animations and other timed UI updates.

**`useSelection()`**: Manages selection state (highlight ranges) in text display.

---

## Performance Optimizations

### `optimizer.ts`
Before re-rendering, the optimizer checks if the virtual DOM subtree actually changed. Subtrees with no prop changes can be skipped entirely.

### `node-cache.ts`
`DOMElement` nodes are cached. When React commits an update to an element whose type and key haven't changed, the existing node is reused rather than recreated. This avoids unnecessary Yoga node reconstruction.

### `line-width-cache.ts`
Calculating the display width of a string is expensive for Unicode (some characters are "wide" — 2 columns, some are "narrow" — 1 column, emoji are usually 2). `line-width-cache.ts` caches these measurements so each string is only measured once.

### Incremental Blit
`log-update.ts` diffs the new screen frame against the previous frame. Only cells that changed are rewritten. For a typical Claude Code update (a few new lines streamed in at the bottom), this means writing only those new lines — not the entire terminal screen.

---

## Key Design Decisions (from `ARCHITECTURE.md`)

1. **ThemeProvider injection** — `src/ink.ts` wraps every render call so `ThemedBox`/`ThemedText` components have theme context without requiring manual mounting at each call site.

2. **Instance cache by stdout** — The `instances` Map lets external code (the IDE bridge) look up and pause/resume the correct Ink instance.

3. **Microtask boundary** — `render()` and `createRoot()` both `await Promise.resolve()` before the first render so async startup work (hook state, REPL bridge) settles before the initial paint.

4. **Yoga without WASM** — The native TypeScript Yoga port eliminates WASM loading latency from startup.

5. **Reconciler-driven layout** — `resetAfterCommit()` triggers Yoga layout recalculation after every React commit, keeping layout and React in sync.

---

## Component Layers

```
src/ink/components/              ← Base Ink primitives (Box, Text, ScrollBox, ...)
           │
           ▼
src/components/design-system/   ← Themed wrappers (ThemedBox, ThemedText, ThemeProvider)
           │
           ▼
src/components/                  ← ~140 Claude Code application components
           │
           ▼
src/screens/                     ← Top-level screen components (REPL, Doctor, ...)
```

Application components import `{ Box, Text }` from `src/ink.ts`, which re-exports the themed versions. Lower-level code can import `{ BaseBox, BaseText }` to bypass theming.

---

*Next: [Chapter 11 — Components & Screens](PartIV-The-UI-Layer-11-Components-Screens.md)*
