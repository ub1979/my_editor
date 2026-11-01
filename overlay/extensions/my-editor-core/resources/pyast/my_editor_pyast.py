"""my_editor's Python parser helper: one file's leading block, declarations, spans, reads and skip facts as JSON.

Usage: python -I -S -B my_editor_pyast.py <file>. Stdlib only, Python 3.9 syntax; offsets are UTF-8 bytes.
"""
import ast
import io
import json
import os
import re
import sys
import tokenize
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import my_editor_pyfacts as pf  # noqa: E402
import my_editor_pyreads as pr  # noqa: E402
from my_editor_pyreads import is_import  # noqa: E402

COOKIE = re.compile(rb'^[ \t\f]*#.*?coding[:=][ \t]*([-\w.]+)')
TOOL = re.compile(r'^#\s*(?:(?:mypy|pyright|pytype)\s*:|type:\s*ignore\s*$)')
CELLS = re.compile(r'^# (?:%%|COMMAND -{10})|^# jupyter:', re.M)
FALLBACK_ERRORS = frozenset(['ImportError', 'ModuleNotFoundError'])


from my_editor_pylead import Source, comment_lines, is_typecheck, lead_kind, line_starts  # noqa: E402


def first_line(stmt):
    return min([stmt.lineno] + [d.lineno for d in getattr(stmt, 'decorator_list', [])])


def alias_spans(src, stmt):
    """Each alias of an import statement as (name, asname, start, end) bytes, found by tokenizing the statement alone.

    Names are NFKC-normalized as Python binds them (`import sys as ſ` binds `s`); the spans stay the source bytes.
    """
    begin = src.at(stmt.lineno, stmt.col_offset)
    raw = src.raw[begin:src.at(stmt.end_lineno, stmt.end_col_offset)]
    starts, lines = line_starts(raw), raw.decode('utf-8').split('\n')
    offset = lambda pos: begin + starts[pos[0] - 1] + len(lines[pos[0] - 1][:pos[1]].encode('utf-8'))
    norm = lambda text: unicodedata.normalize('NFKC', text)
    tokens = [t for t in tokenize.generate_tokens(io.StringIO('\n'.join(lines) + '\n').readline)
              if t.type in (tokenize.NAME, tokenize.OP) and t.string not in '()']
    at = next(i for i, t in enumerate(tokens) if t.string == 'import') + 1
    found = []
    while at < len(tokens):
        first = tokens[at]
        name = norm(first.string)
        at += 1
        while at < len(tokens) and tokens[at].string == '.':
            name += '.' + norm(tokens[at + 1].string)
            at += 2
        end = tokens[at - 1]
        asname = None
        if at < len(tokens) and tokens[at].string == 'as':
            asname = norm(tokens[at + 1].string)
            end = tokens[at + 1]
            at += 2
        found.append({'name': name, 'asname': asname, 'start': offset(first.start), 'end': offset(end.end)})
        at += 1
    return found


def import_facts(src, stmt):
    out = []
    for node in ast.walk(stmt):
        if is_import(node):
            out.append({'kind': 'from' if isinstance(node, ast.ImportFrom) else 'import',
                        'module': getattr(node, 'module', None) or '', 'level': getattr(node, 'level', 0) or 0,
                        'line': node.lineno, 'start': src.at(node.lineno, node.col_offset), 'end': src.at(node.end_lineno, node.end_col_offset),
                        'lineStart': src.at(node.lineno), 'aliases': alias_spans(src, node)})
    return out


def leading_block(src, body):
    lead = []
    for index, stmt in enumerate(body):
        kind = lead_kind(stmt, index == 0)
        if kind is None:
            break
        needs = sorted({n.id for n in ast.walk(stmt.test) if isinstance(n, ast.Name)}) if isinstance(stmt, ast.If) else []
        lead.append({'kind': kind, 'start': src.at(stmt.lineno), 'end': src.line_end(stmt.end_lineno), 'line': stmt.lineno,
                     'endLine': stmt.end_lineno, 'binds': sorted(pr.binds(stmt)), 'needs': needs, 'imports': import_facts(src, stmt),
                     'stmtEnd': src.at(stmt.end_lineno, stmt.end_col_offset)})
    return lead


def group(stmts, names):
    """Top-level statements after the leading block as declarations: overloads and attribute docstrings join their owner."""
    groups = []
    for stmt in stmts:
        prev = groups[-1] if groups else None
        if (prev and isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant) and isinstance(stmt.value.value, str)
                and isinstance(prev[-1], (ast.Assign, ast.AnnAssign)) and stmt.lineno == prev[-1].end_lineno + 1):
            prev.append(stmt)
            continue
        if (prev and isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)) and isinstance(prev[-1], type(stmt))
                and prev[-1].name == stmt.name and any(names.canon(d) == 'typing.overload' for d in prev[-1].decorator_list)):
            prev.append(stmt)
            continue
        groups.append([stmt])
    return groups


def target_names(stmt):
    if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return [stmt.name]
    if isinstance(stmt, ast.Assign):
        return [n.id for t in stmt.targets for n in ast.walk(t) if isinstance(n, ast.Name)]
    if isinstance(stmt, ast.AnnAssign):
        return [stmt.target.id] if isinstance(stmt.target, ast.Name) else []
    if type(stmt).__name__ == 'TypeAlias':
        return [stmt.name.id]
    return sorted(pr.binds(stmt))


def kind_of(stmt):
    if isinstance(stmt, ast.AsyncFunctionDef):
        return 'async def'
    if isinstance(stmt, ast.FunctionDef):
        return 'def'
    if isinstance(stmt, ast.AnnAssign):
        return 'annassign' if stmt.value is not None else 'annotation'
    if type(stmt).__name__ == 'TypeAlias':
        return 'type'
    return 'class' if isinstance(stmt, ast.ClassDef) else type(stmt).__name__.lower()


def quiet_call(stmt, names):
    """A statement that only calls the quiet stdlib allowlist with literal arguments (and `__name__` for getLogger)."""
    if isinstance(stmt, ast.Pass) or isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant):
        return True
    if isinstance(stmt, ast.If) and is_typecheck(stmt.test) and not stmt.orelse:
        return True
    call = stmt.value if isinstance(stmt, ast.Expr) or isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 \
        and isinstance(stmt.targets[0], ast.Name) else None
    if not isinstance(call, ast.Call):
        return False
    target = names.canon(call.func)
    if target not in pf.QUIET_CALLS:
        return False
    args = call.args + [k.value for k in call.keywords if k.arg]
    if len(args) != len(call.args) + len(call.keywords):
        return False
    return all(isinstance(a, ast.Constant) or target == 'logging.getLogger' and isinstance(a, ast.Name) and a.id == '__name__' for a in args)


def purity(stmts, names, index):
    """(definition-time purity, annotation purity) of one declaration."""
    p, ann = pf.Purity(names, index), pf.Purity(names, index)
    stmt = stmts[0]
    if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
        all(pf.function_pure(p, ann, s, pf.TOP_FUNC) for s in stmts)
    elif isinstance(stmt, ast.ClassDef):
        pf.class_pure(p, ann, stmt)
    elif isinstance(stmt, ast.Assign):
        if len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
            p.expr(stmt.value)
        else:
            p.fail('it unpacks or assigns more than one target')
    elif isinstance(stmt, ast.AnnAssign) and stmt.value is not None and isinstance(stmt.target, ast.Name):
        ann.type_part(stmt.annotation)
        p.expr(stmt.value)
    elif type(stmt).__name__ != 'TypeAlias':
        p.fail('it is not a definition, or it runs code')
    return p, ann


def declaration(src, stmts, index, names, tables, comments, floor, future):
    stmt, last = stmts[0], stmts[-1]
    top = first_line(stmt)
    start_line = top
    while start_line - 1 > floor and start_line - 1 in comments:
        start_line -= 1
    if start_line == 1:
        start_line = top  # comments from the first line on are the file's header (shebang, license), not this declaration's
    end_line = last.end_lineno
    before = src.lines[top - 1][:min(stmt.col_offset, *[d.col_offset - 1 for d in getattr(stmt, 'decorator_list', [])] or [stmt.col_offset])]
    after = src.lines[end_line - 1][last.end_col_offset:].strip()
    p, ann = purity(stmts, names, index)
    def_reads, ann_reads = [], []
    for s in stmts:
        d, a = pr.definition_reads(s)
        def_reads += d
        ann_reads += a
    later = [n for line, found, _ in tables if top <= line <= end_line for n in found]
    strings = [n for s in stmts for n in pr.forward_refs(s)] + [n for s in stmts if isinstance(s, ast.AnnAssign) for n in pr.strings_in(s.annotation)]
    docs = pr.docstrings(stmts)
    attached = [comments[line] for line in range(start_line, top)]
    walk = [n for s in stmts for n in ast.walk(s)]
    doc = ast.get_docstring(stmt, clean=True) if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) else None
    return {
        'id': index, 'kind': kind_of(stmt), 'names': target_names(stmt), 'start': src.at(start_line), 'end': src.line_end(end_line),
        'line': start_line, 'lines': end_line - start_line + 1, 'own': not before.strip() and (not after or after.startswith(b'#')),
        'doc': (doc or '').strip().split('\n')[0], 'docText': '\n'.join(attached + docs[:1]),
        'pure': p.reason is None, 'impure': p.reason, 'annImpure': ann.reason, 'quiet': quiet_call(stmt, names),
        'sameFile': sorted(p.same_file), 'annSameFile': sorted(ann.same_file),
        'attrReads': sorted([list(r) for r in p.attr_reads | ann.attr_reads]), 'relies': sorted(p.relies | ann.relies),
        'defReads': sorted(set(def_reads)), 'annReads': sorted(set(ann_reads)), 'reads': sorted(set(def_reads + ann_reads + later + strings)),
        'globalStmt': any(isinstance(n, (ast.Global, ast.Nonlocal)) for n in walk),
        'dunders': sorted({n.id for n in walk if isinstance(n, ast.Name) and n.id in pr.MODULE_DUNDERS}),
        'fileUse': pr.file_use(stmts), 'doctest': any('>>>' in d for d in docs),
        'defines': [s.name for s in stmt.body if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef))] if isinstance(stmt, ast.ClassDef) else [],
        'baseNames': [b.id for b in stmt.bases if isinstance(b, ast.Name) and b.id in p.same_file] if isinstance(stmt, ast.ClassDef) else [],
    }


def byte_facts(raw, text):
    cookie = next((m.group(1).decode() for m in (COOKIE.match(line) for line in raw.split(b'\n')[:2]) if m), None)
    return {'bom': raw.startswith(b'\xef\xbb\xbf'), 'crlf': b'\r\n' in raw, 'cr': b'\r' in raw.replace(b'\r\n', b''), 'cookie': cookie,
            'shebang': raw.startswith(b'#!'),
            'size': len(raw), 'longLine': any(len(line) > 1000 for line in text.split('\n')), 'cells': bool(CELLS.search(text))}


def analyze(raw, filename='<file>'):
    """Everything the host needs about one file, as a JSON-ready dict; only the byte facts and `error` when it does not parse."""
    text = raw.decode('utf-8', 'replace')
    out = dict(byte_facts(raw, text), python=list(sys.version_info[:3]), error=None)
    try:
        out.update(file_facts(raw, text, filename))
    except (SyntaxError, ValueError, RecursionError, MemoryError) as error:
        out['error'] = '%s: %s' % (type(error).__name__, error)  # newer syntax, or nesting deeper than the helper can walk
    return out


def file_facts(raw, text, filename):
    tree = ast.parse(raw, filename)
    table = pr.module_table(text, filename)
    src = Source(raw)
    comments = comment_lines(text)
    first = tree.body[0].lineno if tree.body else len(src.starts)
    lead = leading_block(src, tree.body)
    groups = group(tree.body[len(lead):], pf.Names({}, set(), {}, {}))
    names = pf.names_of(tree.body[:len(lead)], groups, table)
    groups = group(tree.body[len(lead):], names)
    tables = pr.table_reads(table)
    decls = []
    floor = lead[-1]['endLine'] if lead else 0
    future = any(isinstance(s, ast.ImportFrom) and s.module == '__future__' and any(a.name == 'annotations' for a in s.names) for s in tree.body)
    for index, stmts in enumerate(groups):
        decls.append(declaration(src, stmts, index, names, tables, comments, groups[index - 1][-1].end_lineno if index else floor, future))
    has_getattr, getattr_reads = pr.module_getattr(tree, table, names.counts)
    tool = [c for line, c in comments.items() if TOOL.match(c) and (line < first or not c.startswith('# type:'))]
    return {
        'future': future, 'firstComment': next(iter(sorted(comments.items())), (0, ''))[1], 'toolComment': tool[0] if tool else None,
        'namespace': pr.namespace_use(tree, names) or ('a module __getattr__ or __dir__ that reads module names' if getattr_reads else None),
        'mainGuard': pr.main_guard(tree), 'starImport': any(is_import(n) and any(a.name == '*' for a in n.names) for n in ast.walk(tree)),
        'lateImport': pr.late_import(tree.body[len(lead):]), 'moduleGetattr': has_getattr, 'lead': lead,
        'facadeAt': src.line_end(lead[-1]['endLine']) + 1 if lead else decls[0]['start'] if decls else len(raw),
        'decls': decls, 'bindings': names.counts, 'globalAssigned': pr.global_assignments(table),
    }


if __name__ == '__main__':
    with open(sys.argv[1], 'rb') as handle:
        print(json.dumps(analyze(handle.read(), sys.argv[1])))
