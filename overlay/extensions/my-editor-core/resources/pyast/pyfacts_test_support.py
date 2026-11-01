"""Tests for name resolution, purity and reads in my_editor's Python helper. Run: python3 -m unittest -v (in this folder)."""
import ast
import sys
import textwrap
import unittest

import my_editor_pyfacts as pf
import my_editor_pyreads as pr


def parsed(source):
    """The tree, its leading imports, and one group per later statement, with the file's names."""
    tree = ast.parse(textwrap.dedent(source))
    count = next((i for i, s in enumerate(tree.body) if not isinstance(s, (ast.Import, ast.ImportFrom))), len(tree.body))
    groups = [[s] for s in tree.body[count:]]
    return tree, groups, pf.names_of(tree.body[:count], groups, pr.module_table(textwrap.dedent(source), 'm.py'))


def purity(source, name):
    """(definition-time Purity, annotation Purity) of the statement that defines `name`."""
    tree, groups, names = parsed(source)
    index, stmt = next((i, g[0]) for i, g in enumerate(groups) if name in pr.binds(g[0]))
    p, ann = pf.Purity(names, index), pf.Purity(names, index)
    if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
        pf.function_pure(p, ann, stmt, pf.TOP_FUNC)
    elif isinstance(stmt, ast.ClassDef):
        pf.class_pure(p, ann, stmt)
    else:
        p.expr(stmt.value)
    return p, ann


LEAD = 'import os\nimport re\nfrom pathlib import Path\nfrom typing import TypeVar\na = 1\nb = 2\nk = 3\nx = 4\n'


