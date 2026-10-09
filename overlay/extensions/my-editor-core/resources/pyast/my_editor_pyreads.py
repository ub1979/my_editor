"""Global reads, bindings and `__file__` forms for my_editor's Python parser helper. Stdlib only, Python 3.9 syntax."""
import ast
import symtable

MODULE_DUNDERS = frozenset(['__name__', '__module__', '__doc__', '__spec__', '__loader__', '__package__', '__path__', '__builtins__',
                            '__cached__'])
FOLDER_FORMS = frozenset(['os.path.dirname(__file__)', 'os.path.dirname(os.path.abspath(__file__))', 'os.path.dirname(os.path.realpath(__file__))',
                          'Path(__file__).parent', 'Path(__file__).resolve().parent', 'Path(__file__).absolute().parent'])


def annotation_nodes(fn):
    a = fn.args
    params = a.posonlyargs + a.args + a.kwonlyargs + [x for x in (a.vararg, a.kwarg) if x]
    return [p.annotation for p in params if p.annotation] + ([fn.returns] if fn.returns else [])


def defaults(fn):
    return fn.args.defaults + [d for d in fn.args.kw_defaults if d is not None]


class Reads(ast.NodeVisitor):
    """Global names read in module-scope code: decorators, defaults, bases, values and class bodies (over-approximated)."""

    def __init__(self):
        self.names = []
        self.strings = []

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            self.names.append(node.id)

    def visit_Lambda(self, node):
        for d in defaults(node):
            self.visit(d)

    def visit_FunctionDef(self, node):
        for d in node.decorator_list + defaults(node):
            self.visit(d)

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node):
        for n in node.decorator_list + node.bases + [k.value for k in node.keywords] + node.body:
            self.visit(n)

    def visit_AnnAssign(self, node):
        self.visit(node.annotation)
        self.strings.extend(strings_in(node.annotation))
        if node.value is not None:
            self.visit(node.value)


def strings_in(node):
    """String constants in an annotation or forward reference, parsed for the names they use."""
    found = []
    for sub in ast.walk(node):
        if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
            try:
                expr = ast.parse(sub.value.strip(), mode='eval')
            except SyntaxError:
                continue
            found.extend(n.id for n in ast.walk(expr) if isinstance(n, ast.Name))
    return found


def forward_refs(stmt):
    """Names in string annotations of nested defs, `bound=`/constraint strings of TypeVar and `cast('X', …)`."""
    found = []
    for node in ast.walk(stmt):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for a in annotation_nodes(node):
                found.extend(strings_in(a))
        elif isinstance(node, ast.AnnAssign):
            found.extend(strings_in(node.annotation))
        elif isinstance(node, ast.Call):
            name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, 'id', '')
            if name == 'cast' and node.args:
                found.extend(strings_in(node.args[0]))
            elif name == 'TypeVar':
                for part in node.args[1:] + [k.value for k in node.keywords if k.arg == 'bound']:
                    found.extend(strings_in(part))
    return found


def class_functions(cls):
    """Methods of a class and of the classes nested in its body, not functions inside method bodies."""
    for stmt in cls.body:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield stmt
        elif isinstance(stmt, ast.ClassDef):
            yield from class_functions(stmt)


def type_params(node):
    """Names of PEP 695 type parameters (3.12+): local to the definition, never module names."""
    return {p.name for p in getattr(node, 'type_params', None) or []}


def definition_reads(stmt):
    """(definition-time reads, annotation reads): module-scope names, with annotations apart because they may be deferred."""
    reads = Reads()
    ann = []
    local = type_params(stmt)
    if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
        reads.visit(stmt)
        for a in annotation_nodes(stmt):
            ann.extend(n.id for n in ast.walk(a) if isinstance(n, ast.Name))
    elif isinstance(stmt, ast.ClassDef):
        reads.visit(stmt)
        for node in class_functions(stmt):
            for a in annotation_nodes(node):
                ann.extend(n.id for n in ast.walk(a) if isinstance(n, ast.Name) and n.id not in type_params(node))
    elif isinstance(stmt, ast.AnnAssign):
        ann.extend(n.id for n in ast.walk(stmt.annotation) if isinstance(n, ast.Name))
        if stmt.value is not None:
            reads.visit(stmt.value)
    elif type(stmt).__name__ != 'TypeAlias':
        reads.visit(stmt)
    return [n for n in reads.names if n not in local], [n for n in ann if n not in local]


def table_reads(top):
    """Line number -> global names referenced by every nested scope (function, class, lambda, annotation, type alias)."""
    by_line = []

    def walk(table):
        for child in table.get_children():
            names = [s.get_name() for s in child.get_symbols() if (s.is_global() or s.is_declared_global()) and s.is_referenced()]
            declared = [s.get_name() for s in child.get_symbols() if s.is_declared_global()]
            by_line.append((child.get_lineno(), names, declared))
            walk(child)
    walk(top)
    return by_line


def module_table(source, filename):
    return symtable.symtable(source, filename, 'exec')


class Binder(ast.NodeVisitor):
    """Names a module-level statement binds or deletes, without entering function or class bodies."""

    def __init__(self):
        self.names = set()

    def visit_Name(self, node):
        if not isinstance(node.ctx, ast.Load):
            self.names.add(node.id)

    def visit_FunctionDef(self, node):
        self.names.add(node.name)
        for n in node.decorator_list + defaults(node):
            self.visit(n)

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node):
        self.names.add(node.name)
        for n in node.decorator_list + node.bases + [k.value for k in node.keywords]:
            self.visit(n)

    def visit_Lambda(self, node):
        for n in defaults(node):
            self.visit(n)

    def visit_Import(self, node):
        for a in node.names:
            self.names.add(a.asname or a.name.split('.')[0])

    visit_ImportFrom = visit_Import

    def visit_ExceptHandler(self, node):
        if node.name:
            self.names.add(node.name)
        self.generic_visit(node)

    def generic_visit(self, node):
        for field in ('name', 'rest'):
            value = getattr(node, field, None)
            if isinstance(value, str) and type(node).__name__.startswith('Match'):
                self.names.add(value)
        super().generic_visit(node)

    def visit_TypeAlias(self, node):
        self.names.add(node.name.id)


def binds(stmt):
    binder = Binder()
    binder.visit(stmt)
    return binder.names


def global_assignments(top):
    """Names a nested scope declares `global` and binds there: assignment, `del`, `def`, `class`, `import`, `except … as`."""
    found = []

    def walk(table):
        for child in table.get_children():
            found.extend(sorted(s.get_name() for s in child.get_symbols() if s.is_declared_global() and (s.is_assigned() or s.is_imported())))
            walk(child)
    walk(top)
    return found


def docstrings(stmts):
    found = []
    for stmt in stmts:
        for node in ast.walk(stmt):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                doc = ast.get_docstring(node, clean=False)
                if doc:
                    found.append(doc)
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant) and isinstance(stmt.value.value, str):
            found.append(stmt.value.value)
    return found


def parents(node):
    out = {}
    for parent in ast.walk(node):
        for child in ast.iter_child_nodes(parent):
            out[child] = parent
    return out


def file_use(stmts):
    """None, 'folder' when every `__file__` is in a folder form, else 'other'."""
    use = None
    for stmt in stmts:
        up = parents(stmt)
        for node in ast.walk(stmt):
            if isinstance(node, ast.Name) and node.id == '__file__':
                chain = []
                at = node
                for _ in range(5):
                    at = up.get(at)
                    if at is None:
                        break
                    chain.append(ast.unparse(at))
                use = 'folder' if any(text in FOLDER_FORMS for text in chain) and use != 'other' else 'other'
    return use


def is_import(stmt):
    return isinstance(stmt, (ast.Import, ast.ImportFrom))


def namespace_use(tree, names):
    """Why the file reads or replaces its own namespace, or None."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            target = names.canon(node.func)
            if target in ('builtins.exec', 'builtins.eval', 'builtins.globals', 'builtins.locals'):
                return '%s()' % target[len('builtins.'):]
            if target in ('builtins.vars', 'builtins.dir') and not node.args:
                return '%s() without arguments' % target[len('builtins.'):]
        if isinstance(node, ast.Attribute) and (node.attr == '_getframe' or node.attr in ('currentframe', 'stack')
                                                and isinstance(node.value, ast.Name) and node.value.id == 'inspect'):
            return ast.unparse(node)
        if (isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Name) and node.slice.id == '__name__'
                and isinstance(node.value, ast.Attribute) and node.value.attr == 'modules'):
            return 'sys.modules[__name__]'
    return None


def module_getattr(tree, table, counts):
    """A module-level `__getattr__` or `__dir__`, and whether it reads other module names."""
    defined = [s for s in tree.body if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef)) and s.name in ('__getattr__', '__dir__')]
    reads = [n for s in defined for line, found, _ in table_reads(table) if line == s.lineno for n in found if n in counts]
    return bool(defined), bool(reads)


def main_guard(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.If) and isinstance(node.test, ast.Compare) and len(node.test.comparators) == 1:
            sides = [node.test.left, node.test.comparators[0]]
            if any(isinstance(s, ast.Name) and s.id == '__name__' for s in sides) and any(
                    isinstance(s, ast.Constant) and s.value == '__main__' for s in sides):
                return True
    return False


def late_import(stmts):
    """The line of an import after the leading block, outside function and class bodies."""
    stack = list(stmts)
    while stack:
        node = stack.pop(0)
        if is_import(node):
            return node.lineno
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda, ast.expr)):
            stack[0:0] = [c for c in ast.iter_child_nodes(node) if isinstance(c, (ast.stmt, ast.excepthandler))
                          or type(c).__name__ == 'match_case']
    return None
