#!/usr/bin/env python3
"""
Generate claude_code_book.docx with:
  - 3-level TOC: Part (H1) → Chapter (H2) → Section (H3)
  - Word Navigation-pane bookmarks at all 3 levels
  - Proper page breaks between parts and chapters
"""

import os
import re
import subprocess
import tempfile

BOOK_DIR = '/Users/sylvia/Downloads/bca-book/claude_code_book'
OUTPUT   = '/Users/sylvia/Downloads/bca-book/claude_code_book.docx'

PART_LABELS = {
    'PartI':   'Part I: Foundations',
    'PartII':  'Part II: The Tool System',
    'PartIII': 'Part III: The Command System',
    'PartIV':  'Part IV: The UI Layer',
    'PartV':   'Part V: Subsystems',
    'PartVI':  'Part VI: Services & Infrastructure',
}

def get_part_key(filename):
    m = re.match(r'^(Part[IVX]+)', filename)
    return m.group(1) if m else 'Unknown'

def shift_headings(src, by=1):
    """
    Shift markdown heading levels UP by `by` (e.g., # → ##, ## → ###).
    Skips content inside code fences.
    Strips YAML frontmatter.
    """
    # Remove YAML frontmatter
    src = re.sub(r'^---[\s\S]*?---\n', '', src)

    lines = src.split('\n')
    result = []
    in_fence = False

    for line in lines:
        if re.match(r'^(`{3,}|~{3,})', line):
            in_fence = not in_fence
            result.append(line)
            continue

        if not in_fence:
            # Match heading lines: only at the start of line
            m = re.match(r'^(#{1,6})(\s+.*)$', line)
            if m:
                hashes = m.group(1)
                rest   = m.group(2)
                new_level = min(len(hashes) + by, 6)
                line = '#' * new_level + rest

        result.append(line)

    return '\n'.join(result)

# ── collect files grouped by part ────────────────────────────────────────────

files = sorted(f for f in os.listdir(BOOK_DIR) if f.endswith('.md'))

part_order = []
part_groups = {}
for f in files:
    key = get_part_key(f)
    if key not in part_groups:
        part_order.append(key)
        part_groups[key] = []
    part_groups[key].append(f)

# ── build combined markdown ───────────────────────────────────────────────────
# Structure:
#   # Part I: Foundations          ← H1 (top-level bookmark)
#   ## Chapter 1: ...              ← H2 (chapter, shifted from H1)
#   ### What Is Claude Code?       ← H3 (section, shifted from H2)

FRONTMATTER = """\
---
title: "Behind Claude Code: A Deep Dive into the Architecture"
author: "Sylvia"
date: "2026"
---

"""

chunks = [FRONTMATTER]

for key in part_order:
    label = PART_LABELS.get(key, key)

    # Part heading at H1 (level 1 bookmark)
    chunks.append(f'\n# {label}\n\n')

    for filename in part_groups[key]:
        src = open(os.path.join(BOOK_DIR, filename), encoding='utf-8').read()
        shifted = shift_headings(src, by=1)   # H1→H2, H2→H3, etc.

        # Page break before each chapter (pandoc custom-style or div)
        chunks.append('\n\n')
        chunks.append(shifted)
        chunks.append('\n\n')

combined_md = ''.join(chunks)

# Write to a temp file
with tempfile.NamedTemporaryFile(mode='w', suffix='.md',
                                 delete=False, encoding='utf-8') as tf:
    tf.write(combined_md)
    tmp_path = tf.name

print(f'Combined markdown → {tmp_path}  ({len(combined_md):,} chars)')

# ── run pandoc ────────────────────────────────────────────────────────────────

cmd = [
    'pandoc',
    tmp_path,
    '-o', OUTPUT,
    '--from', 'markdown',
    '--to', 'docx',
    '--toc',                       # insert TOC page
    '--toc-depth=3',               # Part → Chapter → Section
    '--highlight-style=tango',
    '--wrap=none',
]

print('Running pandoc…')
print(' '.join(cmd))
result = subprocess.run(cmd, capture_output=True, text=True)

if result.returncode != 0:
    print('STDERR:', result.stderr)
    raise RuntimeError(f'pandoc failed (exit {result.returncode})')

print(f'DOCX written → {OUTPUT}')

# Clean up
os.unlink(tmp_path)
print('Done.')
