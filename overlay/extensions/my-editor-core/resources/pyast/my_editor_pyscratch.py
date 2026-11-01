"""Run a module leading block in an isolated dictionary before comparing split imports."""
import ast
import builtins

def absolute(module, level, package):
    if not level:
        return module
    base = package.rsplit('.', level - 1)[0] if level > 1 else package
    return '%s.%s' % (base, module) if module else base


class Scratch:
    """Runs the leading block statement by statement in a plain dict namespace, recording failed fallback imports."""

    def __init__(self, name, package, origin):
        self.namespace = {'__name__': name, '__package__': package, '__file__': origin, '__builtins__': builtins, '__spec__': None}
        self.package = package
        self.origin = origin
        self.failures = {}

    def run(self, stmt):
        exec(compile(ast.Module(body=[stmt], type_ignores=[]), self.origin, 'exec'), self.namespace)

    def statement(self, stmt, text):
        if not isinstance(stmt, ast.Try):
            self.run(stmt)
            return
        for inner in stmt.body:
            try:
                self.run(inner)
            except ImportError as error:
                module = absolute(getattr(inner, 'module', None) or inner.names[0].name, getattr(inner, 'level', 0), self.package)
                self.failures[text] = (error, module)
                handler = next((h for h in stmt.handlers if any(isinstance(error, getattr(builtins, n.id)) for n in (
                    h.type.elts if isinstance(h.type, ast.Tuple) else [h.type]))), None)
                if handler is None:
                    raise
                for s in handler.body:
                    self.run(s)
                return
        for s in stmt.orelse:
            self.run(s)


