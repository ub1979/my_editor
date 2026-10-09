"""my_editor's import check: the original module and the modules split from it import, and share every object.

Usage: python -m my_editor_pycheck <module>, from the project folder, with this folder and the import roots on PYTHONPATH.
It runs the original's leading imports alone in a scratch namespace (never registered in sys.modules), checks what
the new modules copy from them, imports the original, and checks object identity. Stdlib only, Python 3.9 syntax.
"""
import ast
import builtins
import importlib
import importlib.util
import os
import sys

import my_editor_pyast as pa


def absolute(module, level, package):
    if not level:
        return module
    base = package.rsplit('.', level - 1)[0] if level > 1 else package
    return '%s.%s' % (base, module) if module else base


def loaded_cleanly(name):
    """A module that finished loading and has no module `__getattr__`, so a failed `from` import of it fails the same way again."""
    mod = sys.modules.get(name)
    return mod is not None and not getattr(getattr(mod, '__spec__', None), '_initializing', False) and '__getattr__' not in vars(mod)


def clean_failure(error, module):
    """A fallback import failed without running half a module: it (or a parent) is missing, or it is loaded and lacks the name."""
    if isinstance(error, ModuleNotFoundError):
        parts = module.split('.')
        return error.name in ['.'.join(parts[:i]) for i in range(1, len(parts) + 1)]
    return type(error) is ImportError and error.name == module and loaded_cleanly(module)


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


def split_modules(facts, origin):
    """New modules named by the facade: level-1 imports of siblings whose first line is this original's split header."""
    header = '# Split from %s by my_editor.' % os.path.basename(origin)
    found = []
    for item in facts['lead']:
        for imp in item['imports']:
            path = os.path.join(os.path.dirname(origin), '%s.py' % imp['module'])
            if imp['kind'] == 'from' and imp['level'] == 1 and imp['module'] and os.path.isfile(path):
                with open(path, 'rb') as handle:
                    raw = handle.read()
                if raw.split(b'\n', 1)[0].decode('utf-8', 'replace') == header:
                    found.append((imp['module'], path, pa.analyze(raw, path), item))
    return found


def check(name):
    """Plain lines naming each failure; empty when the module passes."""
    spec = importlib.util.find_spec(name)
    if spec is None or not spec.origin or not os.path.isfile(spec.origin):
        return ['%s cannot be found from this folder.' % name]
    origin = spec.origin
    root = os.path.realpath(os.getcwd())
    if not os.path.realpath(origin).startswith(root + os.sep):
        return ['%s resolves to %s, outside this folder, so the check would test other code.' % (name, origin)]
    package = name if os.path.basename(origin) == '__init__.py' else name.rpartition('.')[0]
    with open(origin, 'rb') as handle:
        raw = handle.read()
    facts = pa.analyze(raw, origin)
    if facts['error']:
        return ['%s does not parse: %s' % (name, facts['error'])]
    news = split_modules(facts, origin)
    facade = [item for _, _, _, item in news]
    tree = ast.parse(raw, origin)
    scratch = Scratch(name, package, origin)
    for item, stmt in zip(facts['lead'], tree.body):
        text = raw[item['start']:item['end']].decode('utf-8')
        if item['kind'] != 'doc' and item not in facade:
            scratch.statement(stmt, text)
    if name in sys.modules:
        return ['A leading import of %s imports %s back (an import cycle), so its imports cannot be checked on their own.' % (name, name)]
    problems = []
    for stem, path, new, _ in news:
        where = os.path.basename(path)
        with open(path, 'rb') as handle:
            new_raw = handle.read()
        for item in new['lead']:
            text = new_raw[item['start']:item['end']].decode('utf-8')
            if item['kind'] == 'compound' and text in scratch.failures:
                error, module = scratch.failures[text]
                if not clean_failure(error, module):
                    problems.append('%s copies a fallback import of %s that failed with %s: %s' % (where, module, type(error).__name__, error))
                continue
            for imp in item['imports']:
                module = absolute(imp['module'], imp['level'], package)
                if imp['kind'] != 'from' or module == '__future__' or imp['level'] == 1 and imp['module'] in [s for s, _, _, _ in news]:
                    continue
                mod = sys.modules.get(module)
                if mod is None:
                    if item['kind'] == 'import':
                        problems.append('%s imports from %s, which the original\'s imports did not load.' % (where, module))
                    continue
                for alias in imp['aliases']:
                    if alias['name'] not in vars(mod):
                        problems.append('%s imports %s from %s, which only its __getattr__ provides.' % (where, alias['name'], module))
        for decl in new['decls']:
            for module, attr in decl['attrReads']:
                mod = sys.modules.get(module)
                if mod is None or attr not in vars(mod):
                    problems.append('%s reads %s.%s when defined, which is not set right after the imports.' % (where, module, attr))
    if problems:
        return problems
    original = importlib.import_module(name)
    for stem, path, new, _ in news:
        module = sys.modules.get('%s.%s' % (package, stem))
        if module is None:
            problems.append('%s.%s was not imported by %s.' % (package, stem, name))
            continue
        bound = {n for item in new['lead'] if item['kind'] != 'future' for n in item['binds']}
        moved = {n for decl in new['decls'] for n in decl['names']}
        for n in sorted(bound | moved):
            if n not in vars(module) or n not in vars(original) or vars(module)[n] is not vars(original)[n]:
                problems.append('%s in %s is not the same object as in %s.' % (n, os.path.basename(path), name))
            elif n in bound and n in scratch.namespace and vars(module)[n] is not scratch.namespace[n]:
                problems.append('%s in %s is not what the original\'s imports bound: an import between them changed it.' % (n, os.path.basename(path)))
    return problems


def main(argv):
    if len(argv) != 2:
        print('usage: python -m my_editor_pycheck <module>')
        return 2
    try:
        problems = check(argv[1])
    except Exception as error:  # noqa: BLE001 - any failure of the project's import-time code is the answer
        problems = ['importing %s failed: %s: %s' % (argv[1], type(error).__name__, error)]
    for line in problems:
        print('my_editor_pycheck: %s' % line)
    if not problems:
        print('my_editor_pycheck: %s imports; its split modules share every object.' % argv[1])
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
