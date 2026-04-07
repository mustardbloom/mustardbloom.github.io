# Chapter 5: File System Tools — Deep Dive

> **Part II: The Tool System**

---

## Overview

The file system tools are the most-used tools in Claude Code. They are how Claude reads your code, makes changes, and searches for information. Understanding their exact behavior — including edge cases and limitations — is essential for effective use and for understanding why Claude makes the choices it does.

All file system tools live in `src/tools/` with the structure:

| Tool | Directory |
|------|-----------|
| FileReadTool | `src/tools/FileReadTool/` |
| FileWriteTool | `src/tools/FileWriteTool/` |
| FileEditTool | `src/tools/FileEditTool/` |
| GlobTool | `src/tools/GlobTool/` |
| GrepTool | `src/tools/GrepTool/` |
| NotebookEditTool | `src/tools/NotebookEditTool/` |
| TodoWriteTool | `src/tools/TodoWriteTool/` |

---

## FileReadTool

**Input schema:**
```python
from pydantic import BaseModel
from typing import Optional

class FileReadInput(BaseModel):
    file_path: str                  # Absolute path
    offset: Optional[int] = None   # Start line (1-indexed)
    limit: Optional[int] = None    # Max lines to read
```

### Text Files

Text files are read using `readFileSyncWithMetadata()` (from `src/utils/fileRead.ts`), which:
- Detects the file encoding (UTF-8, Latin-1, etc.)
- Detects line endings (LF vs CRLF)
- Returns the content with line numbers in `cat -n` format: `1\t<line>`

The `cat -n` format is deliberate — line numbers allow Claude to reference specific lines precisely, and they are used when constructing `FileEditTool` inputs.

### Line Range Support

The `offset` and `limit` parameters enable reading slices of large files:

```python
# Read lines 100-200:
FileReadInput(file_path='/src/query_engine.py', offset=100, limit=100)
```

This is critical for QueryEngine.ts (~46K lines) and other large files. Claude Code's own documentation recommends using `offset` and `limit` rather than reading an entire large file.

### Image Support

When a file is detected as an image (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, etc.), `imageProcessor.ts` base64-encodes it and returns it as a vision input block to the LLM:

```json
{
  "type": "image",
  "source": {
    "type": "base64",
    "media_type": "image/png",
    "data": "iVBORw0KGgoAAAANSUhEUgAA..."
  }
}
```

This is why Claude Code can analyze screenshots, UI mockups, and diagrams.

### PDF Support

PDFs are passed directly to the API using the files API or as base64 content. The LLM can then extract text from the PDF content.

### Jupyter Notebook Support

`.ipynb` files are rendered specially. Rather than showing raw JSON, `FileReadTool` formats the notebook as readable cell output, including code cells, markdown cells, and output cells.

### File Size Limits

`src/tools/FileReadTool/limits.ts` contains size limits:
- Files exceeding certain sizes get truncation warnings
- Binary files (non-text) are rejected unless they are recognized image formats
- Extremely large files prompt the user to use `offset`/`limit`

### Permission Model

`FileReadTool` is **read-only** (`isReadOnly: true`). It requires permission to read files outside the current working directory or in sensitive locations (e.g., `~/.ssh/`, `/etc/`). Within the project directory, reads are generally auto-approved.

---

## FileWriteTool

**Input schema:**
```python
from pydantic import BaseModel

class FileWriteInput(BaseModel):
    file_path: str   # Absolute path
    content: str     # Complete new file content
```

FileWriteTool **replaces the entire file**. It is used for:
- Creating new files that don't exist yet
- Complete rewrites of small files
- Generating new files from scratch

For partial edits of existing files, `FileEditTool` is always preferred — it is safer (only the changed portion is modified), produces cleaner diffs, and reduces the chance of accidentally removing content.

### Write Flow

1. Validate that `file_path` is an absolute path
2. Check write permissions via `checkWritePermissionForTool()`
3. Detect existing file encoding (to preserve it)
4. Write using `writeTextContent()` (from `src/utils/file.ts`)
5. Notify VS Code via `notifyVscodeFileUpdated()` (if IDE bridge is active)
6. Track edit in file history (if enabled)

### Permission Model

Write operations require explicit user approval unless an `alwaysAllow` rule covers the path. In `default` mode, writing outside the project directory always prompts.

---

## FileEditTool — The Most Important Tool

FileEditTool is the tool Claude Code uses for **surgical file modifications** — editing specific parts of a file without rewriting the entire content.

**Input schema** (from `src/tools/FileEditTool/types.ts`):
```python
from pydantic import BaseModel

class FileEditInput(BaseModel):
    file_path: str              # Absolute path to file
    old_string: str             # The exact text to replace
    new_string: str             # The text to replace it with
    replace_all: bool = False   # Replace all occurrences
```

### The String Replacement Model

The edit mechanism is deceptively simple: find `old_string` in the file, replace it with `new_string`. But the devil is in the details:

**Uniqueness requirement**: By default (`replace_all: false`), `old_string` must appear **exactly once** in the file. If it appears 0 times, the edit fails. If it appears 2+ times, the edit fails with an ambiguity error. This is a safety feature — it prevents accidentally modifying the wrong occurrence.

**Why this design?** Alternative approaches (line number-based edits, AST-based edits) are either fragile (line numbers change as the file is edited) or complex (AST requires language-specific parsers). String replacement is language-agnostic and works on any text file. The uniqueness requirement compensates for the lack of structural awareness.

**`replace_all: true`**: For cases where you intentionally want to replace every occurrence (renaming a variable, updating an import path), `replace_all` bypasses the uniqueness check.

### The Fuzzy Matching System

`findActualString()` in `utils.ts` handles cases where `old_string` doesn't exactly match the file contents due to:
- Whitespace normalization (trailing spaces, tab/space differences)
- Quote style differences (`'` vs `"`)
- Line ending differences (CRLF vs LF)

`preserveQuoteStyle()` ensures that when Claude replaces a string with different quote styles, the original quote style is preserved where possible.

### The Edit Process

```
1. Read file with readFileSyncWithMetadata()
2. Check file modification time (detect concurrent edits)
3. Find old_string in file content
   - Exact match first
   - Fuzzy match fallback (whitespace normalization)
4. Validate uniqueness (unless replace_all)
5. Perform replacement → new content
6. Write new content with writeTextContent()
7. Compute structured patch (unified diff)
8. Fetch git diff for display
9. Track edit in file history
10. Notify VS Code (if bridge active)
11. Clear LSP diagnostics for file (stale after edit)
12. Activate conditional skills for edited paths
13. Check for team memory secrets in edited content
```

Steps 11–13 demonstrate the deep integration between FileEditTool and other Claude Code subsystems.

### Output

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class FileEditOutput:
    file_path: str
    old_string: str
    new_string: str
    original_file: str          # Full file before edit
    structured_patch: list[Hunk]  # Unified diff format
    user_modified: bool         # Did user modify the proposed edit?
    replace_all: bool
    git_diff: Optional[GitDiff] = None  # Git-level diff (if git repo)
```

The `structuredPatch` and `gitDiff` are used by `StructuredDiff` component to render the diff in the terminal.

### `FILE_UNEXPECTEDLY_MODIFIED_ERROR`

If the file's modification time changed between when Claude read it and when it tries to edit it, FileEditTool throws `FILE_UNEXPECTEDLY_MODIFIED_ERROR`. This protects against race conditions — if you manually edited the file in your editor while Claude was planning its edit, the edit fails rather than silently clobbering your change.

---

## GlobTool

**Input schema:**
```python
from pydantic import BaseModel
from typing import Optional

class GlobInput(BaseModel):
    pattern: str                  # Glob pattern (e.g., "**/*.py")
    path: Optional[str] = None    # Directory to search in
```

GlobTool finds files matching a glob pattern, sorted by **modification time** (most recently modified first). This sorting is intentional: Claude typically wants to look at recently changed files, and the most recently modified file is usually the most relevant.

**Pattern examples:**
- `**/*.ts` — all TypeScript files recursively
- `src/**/*.tsx` — all TSX files under src/
- `*.{json,yaml}` — JSON and YAML files in current directory
- `**/test*.ts` — test files anywhere in the tree

**Implementation**: Uses [fast-glob](https://github.com/mrmlnc/fast-glob) under the hood, which is built on micromatch for pattern matching and efficiently traverses large directory trees. Respects `.gitignore` by default.

**Permission model**: Read-only. No special permissions required within the project directory.

---

## GrepTool

GrepTool is built on **ripgrep** (`rg`) — the fastest file content search tool available. It supports full regex syntax and offers multiple output modes.

**Input schema:**
```python
from pydantic import BaseModel
from typing import Literal, Optional

class GrepInput(BaseModel):
    pattern: str                  # Regex pattern
    path: Optional[str] = None    # Directory/file to search
    glob: Optional[str] = None    # File filter (e.g., "*.py")
    type: Optional[str] = None    # File type (e.g., "ts", "py")
    output_mode: Literal[
        'files_with_matches',  # Default: just file paths
        'content',             # Show matching lines
        'count',               # Count matches per file
    ] = 'files_with_matches'
    case_insensitive: Optional[bool] = None   # -i: Case insensitive
    line_numbers: Optional[bool] = None       # -n: Show line numbers
    after_context: Optional[int] = None       # -A: Lines after match
    before_context: Optional[int] = None      # -B: Lines before match
    context: Optional[int] = None             # -C: Context lines (before and after)
    head_limit: int = 250                     # Limit output
    offset: Optional[int] = None             # Skip first N results
    multiline: Optional[bool] = None         # Match across lines
```

**Why ripgrep?** `rg` is 10–100x faster than `grep` for large codebases. It automatically respects `.gitignore`, skips binary files, and uses SIMD-accelerated regex matching. For a codebase like Claude Code's own source (~528K lines), `rg` returns results in milliseconds.

**Output modes:**

`files_with_matches` (default): Returns just file paths. Most efficient for "which files contain X?" queries.

`content`: Returns the matching lines with optional context. Used when you need to see the actual matches:
```
src/QueryEngine.ts:184:export class QueryEngine {
src/QueryEngine.ts:209:  async *submitMessage(
```

`count`: Returns match counts per file. Useful for "how many times is X used?"

**`head_limit` and `offset`**: For searches that return thousands of matches, `head_limit` (default 250) prevents overwhelming the context window. `offset` enables pagination.

---

## NotebookEditTool

NotebookEditTool edits Jupyter notebooks (`.ipynb` files). Notebooks are JSON files with a specific structure:

```json
{
  "cells": [
    {
      "cell_type": "code",
      "source": ["import pandas as pd\n"],
      "outputs": [...]
    }
  ],
  "metadata": { "kernelspec": {...} }
}
```

Rather than treating notebooks as raw JSON, NotebookEditTool understands the cell structure. It can:
- Edit cell source code
- Replace a cell with new content
- Add new cells
- Delete cells
- Preserve cell outputs (unless the cell source changes)

**Input schema:**
```python
from pydantic import BaseModel
from typing import Literal, Optional

class NotebookEditInput(BaseModel):
    notebook_path: str
    cell_number: int                              # 0-indexed cell to edit
    new_source: str                               # New source code for the cell
    cell_type: Optional[Literal['code', 'markdown']] = None
```

The tool handles the complexity of JSON serialization, preserving metadata, and maintaining the notebook's structural integrity.

---

## TodoWriteTool

TodoWriteTool provides structured task tracking within a conversation. Unlike the OS-level task system (background agents, etc.), these todos are **UI-level annotations** — they make Claude's work plan visible and trackable.

**Input schema:**
```python
from pydantic import BaseModel
from typing import Literal

class TodoItem(BaseModel):
    id: str
    content: str
    status: Literal['pending', 'in_progress', 'completed']
    priority: Literal['high', 'medium', 'low']

class TodoWriteInput(BaseModel):
    todos: list[TodoItem]
```

Todos persist in the conversation state and are rendered in the terminal. The pattern of use:
1. Claude creates todos at the start of a complex task
2. Marks them `in_progress` as it works on each
3. Marks them `completed` as it finishes
4. The user can see progress in real-time in the UI

The todos are not persisted to disk — they live in the `AppState` for the current session only.

---

## Shared File System Utilities

These utilities in `src/utils/` support all file tools:

**`src/utils/file.ts`**:
- `writeTextContent()` — writes content with correct line endings
- `getFileModificationTime()` — for modification time checks
- `findSimilarFile()` — fuzzy file name suggestions when file not found
- `FILE_NOT_FOUND_CWD_NOTE` — message shown when a file isn't found

**`src/utils/fileRead.ts`**:
- `readFileSyncWithMetadata()` — reads file with encoding and line ending detection

**`src/utils/fileHistory.ts`**:
- Tracks all file edits in the session for undo/redo support
- `fileHistoryEnabled()` — checks if history tracking is on
- `fileHistoryTrackEdit()` — records an edit event

**`src/utils/fileStateCache.ts`**:
- LRU cache of file reads within a session
- Prevents re-reading the same file multiple times per turn
- Shared across all file tools via `ToolUseContext.readFileState`

---

*Next: [Chapter 6 — Shell & Execution Tools — Deep Dive](PartII-The-Tool-System-06-Shell-Execution-Tools-Deep-Dive.md)*
