"""my_editor's import check: the original module and the modules split from it import, and share every object.

Usage: python <this folder>/my_editor_pycheck.py <module>, from the project folder, with the import roots on PYTHONPATH. Run
by path, so this folder (not the project's) comes first while the helpers load. A meta-path hook runs the original's
leading imports alone in a scratch namespace (never registered in sys.modules) at the moment the import system reaches
the original, so a package that imports it from its __init__.py is checked in that state, not reported as a cycle. Then
the real import runs and object identity is checked. Stdlib only, Python 3.9 syntax.
"""
import ast
import builtins
import importlib
import importlib.machinery
import os
import sys

import my_editor_pyast as pa
from my_editor_pyscratch import Scratch, absolute
from my_editor_pyabort import Abort
from my_editor_pyhook import Hook


def loaded_cleanly(name):
    """A module that finished loading and has no module `__getattr__`, so a failed `from` import of it fails the same way again."""
    mod = sys.modules.get(name)
    return mod is not None and not getattr(getattr(mod, '__spec__', None), '_initializing', False) and '__getattr__' not in vars(mod)


def clean_failure(error, module):
    """A fallback import failed without running half a module: it (or a parent) is missing while every package above it is
    loaded (a package that failed half way is no longer in sys.modules), or it is loaded and lacks the name."""
    if isinstance(error, ModuleNotFoundError):
        parts = module.split('.')
        name = error.name or ''
        above = ['.'.join(name.split('.')[:i]) for i in range(1, name.count('.') + 1)]
        return name in ['.'.join(parts[:i]) for i in range(1, len(parts) + 1)] and all(p in sys.modules for p in above)
    return type(error) is ImportError and error.name == module and loaded_cleanly(module)


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


def before_import(name, spec):
    """(problems, state): the leading block run alone, what new modules copy from it, and their reads when defined."""
    if spec is None or not spec.origin or not os.path.isfile(spec.origin):
        return ['%s cannot be found from this folder.' % name], None
    origin = spec.origin
    root = os.path.realpath(os.getcwd())
    if not os.path.realpath(origin).startswith(root + os.sep):
        return ['%s resolves to %s, outside this folder, so the check would test other code.' % (name, origin)], None
    package = name if os.path.basename(origin) == '__init__.py' else name.rpartition('.')[0]
    with open(origin, 'rb') as handle:
        raw = handle.read()
    facts = pa.analyze(raw, origin)
    if facts['error']:
        return ['%s does not parse: %s' % (name, facts['error'])], None
    news = split_modules(facts, origin)
    facade = [item for _, _, _, item in news]
    tree = ast.parse(raw, origin)
    scratch = Scratch(name, package, origin)
    for item, stmt in zip(facts['lead'], tree.body):
        text = raw[item['start']:item['end']].decode('utf-8')
        if item['kind'] != 'doc' and item not in facade:
            scratch.statement(stmt, text)
    if name in sys.modules:
        return ['A leading import of %s imports %s back (an import cycle), so its imports cannot be checked on their own.' % (name, name)], None
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
    return problems, (news, scratch, package)


def check(name):
    """Plain lines naming each failure; empty when the module passes."""
    hook = Hook(name, before_import)
    sys.meta_path.insert(0, hook)
    try:
        importlib.import_module(name)
    except Abort:
        pass
    except ModuleNotFoundError as error:
        if hook.problems is None and error.name and (name + '.').startswith(error.name + '.'):
            return ['%s cannot be found from this folder.' % name]
        raise
    finally:
        sys.meta_path.remove(hook)
    if hook.problems:
        return hook.problems
    if hook.state is None:
        return ['%s was imported before the check could look at it.' % name]
    news, scratch, package = hook.state
    original = sys.modules[name]
    problems = []
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
        print('usage: python my_editor_pycheck.py <module>')
        return 2
    if sys.path and os.path.realpath(sys.path[0]) == os.path.dirname(os.path.realpath(__file__)):
        sys.path[0] = os.getcwd()  # As under `python -m pytest`: the project folder first, now that the helpers are loaded.
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
