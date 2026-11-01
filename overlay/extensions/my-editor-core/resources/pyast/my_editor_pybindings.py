"""Names bound by a statement, without descending into runtime function bodies."""
import ast

def defaults(fn):
    return fn.args.defaults + [d for d in fn.args.kw_defaults if d is not None]


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


