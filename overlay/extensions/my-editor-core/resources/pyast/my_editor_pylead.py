"""Leading imports and byte positions for Python source analysis."""
import ast
import io
import tokenize
from my_editor_pyreads import is_import

FALLBACK_ERRORS = frozenset(['ImportError', 'ModuleNotFoundError'])

def line_starts(raw):
    starts = [0]
    for i, byte in enumerate(raw):
        if byte == 10:
            starts.append(i + 1)
    return starts


def comment_lines(text):
    """Line number -> comment text, for lines that hold only a comment."""
    found = {}
    try:
        for tok in tokenize.generate_tokens(io.StringIO(text).readline):
            if tok.type == tokenize.COMMENT and not tok.line[:tok.start[1]].strip():
                found[tok.start[0]] = tok.string
    except (tokenize.TokenError, SyntaxError):
        pass
    return found


def only_imports(body):
    return bool(body) and all(is_import(s) for s in body)


def is_typecheck(test):
    return (isinstance(test, ast.Name) and test.id == 'TYPE_CHECKING'
            or isinstance(test, ast.Attribute) and test.attr == 'TYPE_CHECKING' and isinstance(test.value, ast.Name))


def sys_attr(node, attr):
    if isinstance(node, ast.Subscript):
        node = node.value
    return isinstance(node, ast.Attribute) and node.attr == attr and isinstance(node.value, ast.Name) and node.value.id == 'sys'


def is_platform_test(test):
    """`sys.version_info` against a tuple of ints, `sys.platform` against or `.startswith` a string."""
    if isinstance(test, ast.Compare) and len(test.comparators) == 1:
        right = test.comparators[0]
        if sys_attr(test.left, 'version_info'):
            return isinstance(right, ast.Tuple) and all(isinstance(e, ast.Constant) and isinstance(e.value, int) for e in right.elts)
        return sys_attr(test.left, 'platform') and isinstance(right, ast.Constant) and isinstance(right.value, str)
    return (isinstance(test, ast.Call) and isinstance(test.func, ast.Attribute) and test.func.attr == 'startswith'
            and sys_attr(test.func.value, 'platform') and len(test.args) == 1 and isinstance(test.args[0], ast.Constant))


def if_of_imports(node, test):
    if not (test(node.test) and only_imports(node.body)):
        return False
    rest = node.orelse
    return not rest or only_imports(rest) or len(rest) == 1 and isinstance(rest[0], ast.If) and if_of_imports(rest[0], test)


def fallback_handler(handler):
    names = handler.type.elts if isinstance(handler.type, ast.Tuple) else [handler.type]
    if handler.name or not all(isinstance(n, ast.Name) and n.id in FALLBACK_ERRORS for n in names):
        return False
    return all(is_import(s) or isinstance(s, ast.Pass) or isinstance(s, ast.Assign) and all(isinstance(t, ast.Name) for t in s.targets)
               and isinstance(s.value, ast.Constant) for s in handler.body)


def lead_kind(stmt, first):
    """The leading-block kind of a statement, or None when the block ends before it."""
    if first and isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant) and isinstance(stmt.value.value, str):
        return 'doc'
    if isinstance(stmt, ast.ImportFrom) and stmt.module == '__future__':
        return 'future'
    if is_import(stmt):
        return None if any(a.name == '*' for a in stmt.names) else 'import'
    if isinstance(stmt, ast.If) and not stmt.orelse and if_of_imports(stmt, is_typecheck):
        return 'typecheck'
    if isinstance(stmt, ast.If) and if_of_imports(stmt, lambda test: is_platform_test(test) or is_typecheck(test)):
        return 'compound'
    if (isinstance(stmt, ast.Try) and only_imports(stmt.body) and stmt.handlers and not stmt.finalbody
            and (not stmt.orelse or only_imports(stmt.orelse)) and all(fallback_handler(h) for h in stmt.handlers)):
        return 'compound'
    return None


class Source:
    """The file's bytes with line offsets, for byte spans from line and column numbers."""

    def __init__(self, raw):
        self.raw = raw
        self.starts = line_starts(raw)
        self.lines = raw.split(b'\n')

    def at(self, line, col=0):
        return self.starts[line - 1] + col

    def line_end(self, line):
        return self.starts[line] - 1 if line < len(self.starts) else len(self.raw)

    def char_col(self, line, chars):
        """Byte column of a character column (tokenize counts characters)."""
        return len(self.lines[line - 1].decode('utf-8', 'replace')[:chars].encode('utf-8'))


