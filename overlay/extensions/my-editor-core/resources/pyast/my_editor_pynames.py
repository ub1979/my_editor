"""Binding and import name resolution for one Python source file."""
import ast
from my_editor_pyconstants import BUILTIN_NAMES
from my_editor_pyreads import binds, global_assignments

def normal(name):
    """typing_extensions names count as typing names."""
    return 'typing.' + name[len('typing_extensions.'):] if name and name.startswith('typing_extensions.') else name


class Names:
    """What the file binds: the leading block's imports and every top-level binding, for resolving names by binding."""

    def __init__(self, lead_canon, lead_modules, counts, defined, nodes=None):
        self.lead_canon = lead_canon      # name -> dotted target, None when the binding is conditional or relative
        self.lead_modules = lead_modules  # names bound by `import m` (module objects)
        self.counts = counts              # name -> number of statements that bind it
        self.defined = defined            # non-lead name -> id of the declaration that binds it first
        self.nodes = nodes or {}          # name -> the top-level def or class that binds it

    def canon(self, node):
        """The dotted target of a name or attribute chain resolved by binding, else None."""
        if isinstance(node, ast.Name):
            name = node.id
            if name in self.lead_canon and self.counts.get(name, 0) == 1:
                return normal(self.lead_canon[name])
            if name not in self.counts and name in BUILTIN_NAMES:
                return 'builtins.' + name
            return None
        if isinstance(node, ast.Attribute):
            base = self.canon(node.value)
            return normal(base + '.' + node.attr) if base else None
        return None


def names_of(lead, groups, table):
    """The file's bindings: leading-block targets, statement counts (a compound statement counts once), first definitions."""
    canon, modules, counts, defined, nodes = {}, set(), {}, {}, {}
    for stmt in lead:
        for name in binds(stmt):
            counts[name] = counts.get(name, 0) + 1
            canon[name] = None
        if isinstance(stmt, ast.Import):
            for a in stmt.names:
                local = a.asname or a.name.split('.')[0]
                canon[local] = a.name if a.asname else local
                modules.add(local)
        elif isinstance(stmt, ast.ImportFrom) and stmt.module != '__future__':
            for a in stmt.names:
                canon[a.asname or a.name] = '%s.%s' % (stmt.module, a.name) if not stmt.level else None
    for index, stmts in enumerate(groups):
        for name in set().union(*[binds(s) for s in stmts]):
            counts[name] = counts.get(name, 0) + 1
            defined.setdefault(name, index)
        if isinstance(stmts[0], (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            nodes.setdefault(stmts[0].name, stmts[0])
    for name in global_assignments(table):
        counts[name] = counts.get(name, 0) + 1
    return Names(canon, modules, counts, defined, nodes)
