# Make a project AI-ready: Python (Stage 2c)

- **Date:** 10 October 2026 (narrowed after an adversarial review the same day)
- **Status:** Design, not built. Needs review before a plan.
- **Builds on:** [AI-ready design](2026-10-07-ai-ready-design.md), *Stage 2a: Go*,
  [TS/JS design](2026-10-09-ai-ready-ts-design.md) (its structure and its review lessons), the `LanguageAdapter`
  interface on branch `ai-ready-go`
- **Replaces for Python:** the general Stage 2 rules (extractor, split, refuse-to-split list, move check, the Python row
  of the commands table, the Python import check). Where this file and the general rules differ, this file wins, and
  the difference is named.

## Version 1 scope

Where the safe choice is unclear, version 1 refuses or skips.

| Project or file | What may move in version 1 |
|---|---|
| A `.py` module inside a regular package (every folder from its `sys.path` root down has `__init__.py`), project interpreter CPython 3.9 to 3.14, no Cython or mypyc build of `.py` files | Functions, classes, literal constants and `type` aliases whose definition-time code is pure (see *What may move*) |
| As above, and a tracked file reads `__module__`, calls `inspect.getmodule`, `inspect.getmembers`, `pyclbr`, or reads `vars(m)`/`m.__dict__` of a project module | Constants only: the project itself looks at where things are defined |
| As above, and the project may pickle by reference: a tracked file or a dependency uses `pickle`, `cPickle`, `_pickle`, `dill`, `cloudpickle`, `joblib`, `shelve`, `jsonpickle`, `copyreg`, `multiprocessing`, `concurrent.futures.ProcessPoolExecutor`, Celery, RQ, Dramatiq, Ray, Dask, `torch.save`/`torch.load`, PyYAML `!!python/` tags or `yaml.unsafe_load`/`yaml.Loader`, or defines `__reduce__`/`__reduce_ex__` | Constants only. Pickle names functions as well as classes by module and qualified name, so a pickle written by the branch names the new module |
| A file whose package `__init__.py` defines `__getattr__` or `__dir__` | Nothing; skipped (a lazy package can run code when a sibling is looked up) |
| A file whose exact path or dotted module name appears in tracked tool config: ruff or flake8 `per-file-ignores`, `[mypy-pkg.mod]` or `[[tool.mypy.overrides]] module`, pyright `include`/`exclude`/`strict`/`ignore`, coverage `omit`/`include`/`source`, pytest `--cov=pkg.mod` | Nothing; skipped (the new files would not get the same treatment) |
| A module not in a package (a top-level module, a script folder), or in a namespace package (no `__init__.py`) | Nothing; skipped (no relative facade is possible, or a name could resolve in another portion) |
| Project interpreter 3.15 or later | Nothing; the run stops with *Python splitting needs Python 3.9 to 3.14 for now.* 3.15 adds lazy imports (PEP 810: `lazy import`, `__lazy_modules__`, a global lazy mode), so "every module the original imports is already loaded at the facade" stops being true. Re-review before enabling |
| Interpreter older than 3.9, PyPy, a pyenv shim, or no interpreter chosen | Nothing; the run stops with a plain message |

Every moved name also needs a **quiet window** (see *Early binding*): only statements on a short stdlib allowlist may
run between the imports and its old place. Most files with top-level calls therefore move only what comes before the
first call.

Every narrowed or skipped file names the reason in the report.

## Goal

Split an oversized `.py` module into focused modules in the same package. Whole top-level definitions move byte for
byte. The original module keeps every name it had, through a facade that imports the moved names back, so no caller,
`import *`, entry point or dotted path changes. The program must behave as before, and the host must be able to show
it without trusting the model.

## Why Python is harder than Go and TS

In Go a move changes nothing a program can see. In TS, functions are hoisted and modules are static. In Python, each
of these can change behavior while `compileall`, the type checker and a thin test suite stay green:

1. **Definitions run.** `def` and `class` are statements, executed in order. Decorators, default values, annotations
   (before 3.14, or always for class bodies under `dataclass`), base classes, metaclasses, `__init_subclass__`,
   `__set_name__` and the whole class body run when the statement is reached. Nothing is hoisted.
2. **Globals are per module.** A moved function reads globals from its new module. Patching, monkeypatching,
   `global` and rebinding the original's attribute no longer reach it.
3. **Module identity.** A moved class or function gets a new `__module__` and `__globals__`. `repr` of a class,
   tracebacks, pickles and anything keyed by module name change.
4. **Imports are statements that run.** A new module repeats some of the original's imports, later and in another
   place. A `from m import n` can call a module `__getattr__`; an import with side effects between the two can make
   the same name mean a different object.
5. **A submodule changes its package.** Importing `pkg.rows` sets the attribute `pkg.rows`, overwriting any `rows`
   the package defined, and `from pkg import *` (no `__all__`) now also exports it. Probed.
6. **Tools find modules by name or folder.** Django, pytest, plugin scanners, `python path/to/file.py`, `-m`,
   `importlib.reload` and `sys.modules` tricks.
7. **The interpreter is the project's.** Grammar, `symtable` and import behavior differ by version, and an editable
   install can make tests run the user's folder instead of the branch.

Each rule below exists to close one of these. When a rule cannot decide, the move is refused.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Parser | A stdlib-only helper (`ast`, `tokenize`, `symtable`) run with the project's own interpreter as `python -I -S` | The project's grammar and scoping exactly; `-I -S` runs no `.pth`, `sitecustomize` or project code |
| Name resolution | `symtable` for every nested scope, `ast` for module-scope expressions. Never hand-rolled scoping | Class scopes, comprehensions (inlined since 3.12), `nonlocal`, PEP 695 annotation scopes |
| Where new files go | The original's folder, same package | Relative imports copied byte for byte resolve the same (`__package__` is the same) |
| The facade | One block right after the original's leading imports: `from .rows import a as a`, one statement per moved name, `_private` included, in ruff's isort order, with a blank line before it and before the next code (two before a def or class) | Keeps every attribute; the redundant alias is the explicit re-export form mypy (`no_implicit_reexport`), pyright and ruff accept (probed: plain `from .rows import a` fails `mypy --strict` for callers). isort never combines aliased imports, so one statement per name is what `ruff check --select I` and black keep (measured with ruff 0.12 and black 24) |
| Facade at each old position instead? | Rejected | It would keep binding times exactly, but imports in the middle of a file fail ruff's default rules (`E402`), so the user's CI would fail on the branch. The quiet window below closes the gap instead, for every moved name |
| Imports in new files | Built by the host from name bindings, copied from the original's statements. The model never writes import lines | Same as TS |
| Unused imports in the original | Kept byte for byte, always | Every imported name is an attribute callers may use |
| A moved definition that uses a name that stays | Refused | It would need an import back into the original, a cycle with the facade. Annotations count as uses (they are evaluated in the new module's globals by `get_type_hints`, `dataclass` and pydantic) |
| Exception classes | Movable like other classes; the module part of their name in tracebacks is disclosed | Refusing them would also pin every function that raises one |
| Decorators | Refused, except a short stdlib allowlist resolved by binding (below) | Most decorators register, wrap or read the module at definition time |
| Characterization tests before splits | Not required, as in Go and TS | The binding, export and import checks prove name resolution; generated tests would not catch the residual risks |
| The verifying check | An import of the original by the project interpreter, through a shipped checker that asserts identity invariants (*Checks per step*). `compileall` is dropped | `compileall` proves only syntax, which a byte-identical move cannot break |
| Formatter | Not enforced, except: when the original was clean under the project's configured `black` or `ruff format`, the new files and the original must stay clean | Same rule as `gofmt` and Prettier |

## The interpreter

**Choosing it.** Once per project, remembered in global storage, changeable with **AI-Ready: Choose Python
Interpreter**. Candidates, in order:

| Source | Found by |
|---|---|
| The user's earlier pick | Global storage |
| A venv in the project folder | `.venv/`, `venv/`, `env/` with `pyvenv.cfg` and `bin/python` (`Scripts\python.exe` on Windows). uv, PDM and in-project Poetry put theirs in `.venv` |
| Poetry, Pipenv, Hatch | Only when their lock or config file exists: `poetry env info --executable`, `pipenv --py`, `hatch env find`, run once without a shell, read-only |
| pyenv | `.python-version` names a version or pyenv-virtualenv present under `~/.pyenv/versions/` (a plain version-like word whose folder, followed through links, stays there); the concrete `~/.pyenv/versions/<v>/bin/python` is used. A shim (`~/.pyenv/shims/…`, asdf or mise shims) is rejected: it picks the version from the current folder and environment at each run |
| Anything else (conda, system Python) | The user picks a file |

A `#!` script is never a candidate (shims and wrappers are scripts). Whatever is chosen is refused when its probed
`sys.executable` resolves to another file (a launcher such as macOS's `/usr/bin/python3`) or when its environment folder
is tracked by git (a `.venv` that came with the repository). With one candidate the user confirms it; with several or
none, a quick pick. The venv belongs to the user's folder (it
is untracked, so the worktree has none). Splits do not install anything: `setup()` returns nothing for Python.

**Running it.** The approved command text never holds a path (paths can have spaces; `splitCommand` refuses them).
Commands start with the interpreter's file name (`python`, `python3.12`), and the adapter's `commandEnv` puts its
`bin` folder first on `PATH` and sets `VIRTUAL_ENV` for a venv (core change: the runner resolves the program against
the command env's `PATH`). The interpreter path is not resolved through symlinks: a venv's `python` is a symlink, and
following it loses the venv. The approval dialog shows the interpreter's full path, its version, `sys.prefix` (so a
wrong venv is visible), the project's `requires-python` (flagged when the interpreter does not satisfy it), and the environment
as the commands get it: `PYTHONPATH` names the new working copy's import roots, not the user's folder (the note is made
before the worktree exists, for the folder the user approves).

**Probing it** (`python -I`, site on, no project code): version, implementation, `sys.stdlib_module_names`
(3.10+; a shipped list for 3.9), installed top-level modules, and whether `pytest`, `pytest_randomly`, `mypy`,
`black` are importable. Version gate as in *Version 1 scope*.

**Where tests import from.** Editable installs point into the user's folder. Probed: setuptools writes a plain `.pth`
path for `src` layouts and an appended meta-path finder for flat ones; in both cases a `PYTHONPATH` entry or the
current folder wins. So `commandEnv` sets `PYTHONPATH` to the worktree's import roots (the worktree, its `src/` when
packages live there, and pytest's `pythonpath` setting), and tests run as `python -m pytest` from the worktree root.
`ready()` (run with `spawnSync` so the interface stays synchronous) then checks with `importlib.util.find_spec` on each
top-level package, without importing it, that every one resolves inside the worktree under the command env.
Otherwise Python splits stop for the run: tests would check the user's folder instead of the branch.

## The parser helper

`resources/pyast/my_editor_pyast.py` ships with the extension, stdlib only, written for 3.9 syntax. It runs as
`python -I -S my_editor_pyast.py <file>` with the storage folder as working directory and prints JSON:

- the file's encoding cookie, BOM, CRLF, shebang, first-comment generated markers, file-level tool comments;
- the **leading block** (below) as a list of statements with UTF-8 byte spans, each import's module, level, names,
  aliases, and the names it binds;
- each top-level statement with an **ID** (its index), kind, the names it binds (a multiset), its span, attached
  comments, decorators (with the binding each resolves to), and whether it is movable and why not;
- per statement, the **global names it reads**: from `symtable` for nested scopes (implicit and declared globals that
  are referenced), from `ast` for module-scope parts (decorators, defaults, bases, keywords, class-level annotations,
  values), plus names inside string annotations and other forward-reference strings (`TypeVar(bound='X')`,
  `cast('X', …)`), parsed with `ast.parse(mode='eval')`; split into **definition-time reads** and **later reads**;
- names it binds or rebinds anywhere: assignments, `global` and `nonlocal`, `del`, `for`/`with` targets, walrus,
  `import` inside functions, augmented assignment, attribute assignment on module objects;
- uses of `__name__`, `__file__` (with its shape), `__module__`, `__doc__`, `__spec__`, `__loader__`,
  `__package__`, `__path__`, `__builtins__`, `__qualname__` at module level, `exec`, `eval`, `globals`, `locals`,
  `vars()`, `dir()`, `sys._getframe`, `inspect.currentframe`/`stack`, `sys.modules[...]`, `__import__`,
  `importlib.import_module`/`reload`, folder scans (below);
- each moved-name candidate's purity facts (below).

Probed on 3.14: `symtable` reports `json`, `str`, `Y` as globals of a nested function, `z` in a method as global (class
scope does not enclose), and PEP 695 type alias values as their own scope. Byte spans are UTF-8 offsets computed from
`lineno`/`col_offset` (which are UTF-8 byte columns in CPython); the host slices with `Buffer` only. Parse errors,
including newer syntax than the interpreter knows and nesting deeper than the helper can walk (`RecursionError`), skip
the file. Import aliases are tokenized per statement and NFKC-normalized as Python binds them.

## Skipped files

Reported, never split:

- **Not a package module:** top-level modules, namespace packages, files whose import name cannot be found from an
  import root (`find_spec(name).origin` must be the file).
- **Entry scripts:** a shebang; `if __name__ == '__main__':` anywhere; `__main__.py`; a file named in any tracked
  text as `python <path>`, `python -m <module>` (Makefile, CI files, Dockerfile, `package.json`, shell scripts,
  `tox.ini`, `noxfile.py`). Probed: a module run with `-m` and also imported exists twice; before the split the two
  copies had different classes (`isinstance` false), after it they share the new module's class (`isinstance` true).
- **Tests and test support:** `test_*.py`, `*_test.py`, anything under `tests/`, `test/`, `testing/`; `conftest.py`;
  modules named in `pytest_plugins`, `-p` options or the `pytest11` entry-point group.
- **Config and framework files:** `setup.py`, `noxfile.py`, `fabfile.py`, `tasks.py` (Invoke), `dodo.py`, `manage.py`,
  `wsgi.py`, `asgi.py`, `settings.py` and `settings/`, `conf.py` (Sphinx), `*.conf.py` (gunicorn), `celeryconfig.py`,
  Alembic `env.py` and `versions/`, Django `migrations/`, `management/commands/`, `templatetags/`, and the Django
  conventional modules `models.py`, `admin.py`, `apps.py`, `urls.py`, `signals.py` in a Django project.
- **Build output, environments and vendored code:** `.venv/`, `venv/`, `site-packages/`, `build/`, `dist/`, `.tox/`,
  `.nox/`, `.eggs/`, `*.egg-info/`, `node_modules/`, `vendor/`, `_vendor/`, `third_party/`.
- **Generated code:** a first comment containing `@generated`, `DO NOT EDIT`, `auto-generated`, `Generated by`;
  `linguist-generated`; `*_pb2.py`, `*_pb2_grpc.py`, `*_rc.py`, a tracked `_version.py` written by setuptools-scm or
  versioneer.
- **Compiled or paired:** a sibling `.pxd` (Cython augments the module), a project that builds `.py` with Cython
  (`cythonize` over `.py`) or mypyc (`mypycify`, `[tool.mypyc]`, `hatch-mypyc`); a sibling `.pyi` stub (the new
  modules would need stubs); Jupytext or cell files (`# %%`, `# COMMAND ----------`, a `jupyter:` header).
- **Bytes:** a BOM, CRLF line endings, a carriage return outside CRLF (Python ends a line there, the host does not), an encoding cookie other than `utf-8`/`utf8`, a line over 1,000 characters,
  a file over 512 KB, a symlink.
- **File-level tool comments new files would need:** `# type: ignore` before the first statement, `# mypy:`,
  `# pyright:`, `# pytype:` file-level comments. Lint directives (`# ruff: noqa`, `# pylint: disable`) do not skip.
- **Namespace access:** `exec`, `eval`, `globals()`, `locals()`, `vars()` and `dir()` without arguments,
  `sys._getframe`, `inspect.currentframe`/`stack`, `sys.modules[__name__]`, a module-level `__getattr__` or `__dir__`
  that reads other module names, or `from x import *`, anywhere in the file.
- **Imports not in one leading block** (below): an import after the first other statement.
- **Reloaded or replaced modules:** any tracked `importlib.reload`/`imp.reload` whose argument is the module or not
  resolvable (probed: `reload` re-runs the facade but not the moved definitions, so they are not re-created); any
  tracked code that deletes or replaces a `sys.modules` entry with a key naming the module, its package, or a
  non-literal key (`patch.dict(sys.modules, …)` with only literal keys for other modules is fine).
- **Found by folder:** any tracked file enumerates the original's folder: `pkgutil.iter_modules`/`walk_packages` on
  the package's `__path__`, `os.listdir`/`scandir`/`glob`/`Path.glob`/`iterdir`/`importlib.resources.files(...)`
  over a path built from `__file__`, `__path__` or a literal naming the folder, or `import_module` with an f-string
  or concatenation whose literal prefix names the package. A non-literal argument matches every folder below its file.
- **Packaging lists by exact path:** `py-modules`, Hatch or Poetry `include` naming the original file (not its folder):
  a new file would be left out of the package.
- **Package-wide `import *`:** a tracked `from <package> import *` when the package's `__init__.py` has no literal
  `__all__` (the new submodule would become a star-exported name; probed).

`__init__.py` is **not** skipped. It follows the same rules, including the quiet window (see *Review*). One difference: the package namespace is
the original's namespace, so splitting `__init__.py` adds one attribute per new file (`pkg.rows`). The file-name rule
keeps it from colliding with any name, and the package-wide `import *` skip keeps star exports the same.

## The leading block

The facade goes after the original's leading block, so every module the original imports at its top is loaded before
any new module runs. The leading block is, from the top: the module docstring, comments, `from __future__` imports,
`import` and `from … import` statements, and these compound statements:

- `if TYPE_CHECKING:` / `if typing.TYPE_CHECKING:` with only imports (and `else:` with only imports);
- `if` on `sys.version_info` compared with a tuple literal, or `sys.platform` compared with or `.startswith` a string,
  with only imports in each branch;
- `try:` with only imports, and `except ImportError`/`ModuleNotFoundError` handlers holding only imports, `pass`, and
  `name = <literal>` assignments.

The block ends at the first other statement. An import after that skips the file. A compound statement with other
code (a `warnings.warn` in a handler) ends the block too.

## What may move

A **declaration** is one top-level statement plus its attached comments: the comment lines directly above it with no
blank line between (`#:` doc comments, `# noqa`, `# type: ignore[...]` on their own line), up to the end of its last
line, so a trailing comment moves with it. A bare string statement on the next line after an assignment (an attribute
docstring) belongs to that assignment. A declaration sharing a line with other code (`;`) is not movable. A group of
`@overload` definitions and their implementation is **one** declaration (probed: `typing.get_overloads` still finds
them when they move together).

**Definition-time code** is what runs when the statement is executed: decorators and their arguments; default values;
parameter and return annotations unless annotations are deferred; a class's bases, keywords, body statements and
class-level annotations (`dataclass` evaluates those even when deferred); an assignment's value and its annotation
unless deferred. Annotations count as **deferred** only when the file has `from __future__ import annotations`, or
the project's `requires-python` lower bound is 3.14 or later. The interpreter used for the run does not decide it:
the code may also run on older versions. With no `requires-python`, annotations are treated as evaluated. Function bodies, method bodies and
lambda bodies run later and do not count. A `type X = …` value and PEP 695 bounds are lazy and do not count.

**Pure** definition-time code is only:

- literals (numbers, strings and bytes without `f`/`t` fields, `True`, `False`, `None`, `...`), unary `-`/`+` on a
  number;
- tuple, list, set and dict displays of pure items, with no `*` or `**`; set items and dict keys must be literals or
  tuples of literals (hashing anything else runs `__hash__`/`__eq__`);
- lambdas with pure defaults;
- **reads** of: a name bound by the leading block and never rebound; a builtin name that the file never binds; a
  definition moved earlier into the same new file; an attribute `m.attr` of a name bound by `import m` (a module
  object), which the import check must confirm is in `vars(m)` right after the leading block (a module `__getattr__`
  can run code);
- **type expressions**: subscripts of builtin generics (`list`, `dict`, `tuple`, `set`, `frozenset`, `type`) or of
  names bound from `typing`, `typing_extensions` or `collections.abc`; `|` between builtins, `None`, those names and
  classes moved to the same file; string annotations (not evaluated, but their names count as uses);
- calls of exactly these, resolved by binding to the stdlib, with pure arguments: `object()`, `frozenset(…)`,
  `re.compile(<literal>[, <flags>])`, `typing.TypeVar`, `ParamSpec`, `TypeVarTuple`, `NewType`,
  `collections.namedtuple(<literal>, <literal>)`, and in class bodies only `dataclasses.field(…)` and `enum.auto()`.

Everything else is not pure: other calls, other attribute reads (properties, descriptors), operators (`__add__`,
comparisons), comprehensions, f-strings with fields, `await`, `yield`, walrus, subscripts other than type expressions.

**Bases and decorators.** A class may move only when every base is: absent; a builtin class (`object`, `int`,
`Exception` and the other builtin exceptions…); a stdlib class resolved by binding from this list: `abc.ABC`,
`enum.Enum`/`IntEnum`/`StrEnum`/`Flag`/`IntFlag`, `typing.NamedTuple`/`TypedDict`/`Protocol`/`Generic[…]`; or a class
moved earlier into the same new file that itself passes these rules and defines no `__init_subclass__`,
`__class_getitem__` or `__set_name__`. The only keyword allowed is `metaclass=abc.ABCMeta`. A class is impure (so neither
movable nor quiet when it stays) when a same-file base defines `__init_subclass__`, when it is an Enum whose class or
same-file Enum base defines `__init__`, `__new__` or `_generate_next_value_` (run for each member), or when its body holds
an imported object or module attribute as a value (`type.__new__` calls its `__set_name__`). So no project or
third-party metaclass, `__init_subclass__` or registry runs. Allowed decorators, resolved by binding to the stdlib
module (a tracked file shadowing that module name at an import root refuses):

| Where | Allowed |
|---|---|
| Top-level function | `functools.cache`, `functools.lru_cache` (bare or literal arguments), `contextlib.contextmanager`, `contextlib.asynccontextmanager`, `typing.overload`, `typing.final` |
| Top-level class | `dataclasses.dataclass` (bare or literal keyword arguments), `functools.total_ordering`, `enum.unique`, `typing.final`, `typing.runtime_checkable` |
| Inside a moved class | the builtins `property`, `staticmethod`, `classmethod` (when the class body does not bind them), `.setter`/`.getter`/`.deleter` of a property in the same body, `functools.cached_property`, `abc.abstractmethod`, `typing.overload`, `typing.override`, `typing.final` |

Probed on 3.14: a `@dataclass` with `from __future__ import annotations` and `k: t.ClassVar[int]` in a new module
still excludes `k`, because the closure copies the `typing as t` import; `get_type_hints` resolves in the new module.
Probed: `TypeVar`, `NewType` and `namedtuple` take the new module's name from the calling frame, consistent with a
class defined there.

| Declaration | Movable when | Why not otherwise |
|---|---|---|
| `def`, `async def` (overloads grouped) | Allowed decorators only; pure definition-time code; never rebound; the name rules | Decorators register or wrap at definition |
| `class` | The bases, decorators and body rules above; body statements are only docstrings, `pass`, `...`, defs and nested classes under the same rules, and plain or annotated assignments with pure values; never rebound | Class bodies, metaclasses and `__init_subclass__` run code |
| `X = <pure>`, `X: T = <pure>` | One plain name target; pure value (and annotation when evaluated); never rebound | Unpacking iterates; other targets assign attributes |
| `type X = …` (3.12+) | The value's names follow the name rules | — |
| Bare annotations (`X: int`), augmented assignments, `del`, imports, `if`/`try`/`for`/`with`/`while`/`match`, expression statements | Never; they stay | Not definitions, or run code |
| Dunder names (`__all__`, `__version__`, `__getattr__`, `__dir__`, `__author__`…) | Never | Module protocol and metadata |
| A name with more than one binding in the file (a conditional fallback, a later redefinition, `del`, a `global` assignment in any function) | Never | The new module and the original would diverge |
| A declaration using `global` or `nonlocal` to a module name | Never | It would assign the new module's global |
| A declaration reading `__name__`, `__module__`, `__doc__`, `__spec__`, `__loader__`, `__package__`, `__path__`, `__builtins__`, `__cached__` | Never | They name the module |
| A declaration reading `__file__` | Only as `os.path.dirname(__file__)`, `os.path.dirname(os.path.abspath(__file__))`, `os.path.dirname(os.path.realpath(__file__))`, `Path(__file__).parent`, `Path(__file__).resolve().parent`, `Path(__file__).absolute().parent` | Same folder, same result; anything else names the file |
| A declaration whose name appears in a Django `migrations/` file | Never | `makemigrations` would serialize the new path |
| A declaration whose docstring (or a docstring inside it) contains `>>>` | Never | Doctest names and collection follow the defining module (`--doctest-modules`, `doctest.testmod`) |
| Any function or class, when any tracked config or code filters warnings by the original's module (`filterwarnings` with `module=`, pytest `filterwarnings` entries over several lines, `-W` options, `PYTHONWARNINGS` in config naming it) | Never | Probed: a filter on `pkg.report` no longer matches a warning raised from the moved function, and a library warning with `stacklevel` is attributed to the caller's module, so not only `warnings.warn` callers are affected |
| A declaration reading a name bound inside a compound leading-block statement (`try`/`except ImportError`, a version or platform `if`) | Only when the import check shows each failed import in that statement raised `ModuleNotFoundError` for exactly the module it names, and every name the statement binds is the same object in both modules | Copying the statement re-runs it; a module that fails halfway would run its top half twice |

**Never rebound.** A moved name must have exactly one binding in the original and must not be assigned from outside:
no `orig.X = …`, `setattr(orig, 'X', …)`, `del orig.X` in any tracked file, through any name or attribute chain that
resolves to the original module. The same holds for every **leading-block name a moved span reads**: exactly one
binding in the leading block (statements binding it in several branches of one compound statement count as one), no
`global` assignment, no `del`, and no other binding anywhere in the file.

## Early binding

The facade binds every moved name right after the leading block, earlier than its old place. With pure definition-time
code nothing about the moved objects changes, but the name now exists earlier. Code running in between could see
that: by catching the `NameError` it used to get, by inspecting the namespace, or by importing the original while it
is still loading (directly, through a cycle, or through a library that imports or calls back). Version 1 does not try
to tell those apart.

**Rule: every moved name needs a quiet window.** Every top-level statement between the leading block and the name's
old place must be quiet. A statement is **quiet** when it is:

- a definition or assignment with pure definition-time code, a docstring, `pass`, an `if TYPE_CHECKING:` block;
- a call (alone or as an assignment's value) whose callee resolves by binding to this stdlib allowlist, with arguments
  that are literals (and `__name__` for `getLogger`): `logging.getLogger`, `re.compile`, `os.environ.get`, `os.getenv`,
  `collections.namedtuple`, `typing.TypeVar`/`NewType`/`ParamSpec`, `object()`. None of these imports a module or calls
  back into code it is given. Warning filters are not quiet: `re.compile` of some patterns warns, and moving it above
  `simplefilter('error')` changes what happens.

Not quiet: any other call, including anything from `importlib`, `runpy`, `pkgutil`, `threading`, `atexit`, `signal`,
`sys.setrecursionlimit`-style hooks, and every project or third-party callee (`Flask(__name__)`, `app.register(…)`);
decorated staying definitions; staying definitions with impure definition-time code; any other compound statement.

So a file whose first statement after the imports is `app = Flask(__name__)` moves nothing defined after it. This is
the main narrowing of version 1.

Import cycles need no rule of their own: with every moved name behind a quiet window, nothing runs between the facade
and the old place that could import the original or read it.

## Names that cross files

For a moved declaration D going to new file N, every global name D reads (at definition time or later, annotations and
forward-reference strings included):

| D reads X, and X… | Result |
|---|---|
| moves to N | Nothing to do. Definition-time reads: X must come earlier in the original |
| moves to another new file M | N gets `from .m import X`. The import graph between new files must have no cycle; the facade imports new files in an order where M comes before N |
| is bound by the leading block | N gets that statement, filtered (below) |
| is a builtin, and the file never binds X | Nothing to do |
| stays, any other case | **Plan rejected:** *declaration 7 (`parse_row`) uses `_row_cache` (8), which stays. Move it to the same file or leave both.* No type-only exception: annotations are evaluated in the new module |

The other direction needs nothing: staying code reads moved names through the facade, which imports **every** moved
name, used or not, so the original's attributes stay the same.

**Patches that would stop working.** For every name X that moved code reads from its own module's globals (moved names
and copied imports both), the plan is rejected when any tracked `.py` or `.pyi` file (patch targets live in code; a
README naming `pkg.report.parse_row` must not block a split, while the folder and script scans still read all text):

- has a string literal `<module>.X` or starting with `<module>.X.` (`patch('pkg.report.requests')`,
  `monkeypatch.setattr('pkg.report.X', …)`, `mocker.patch(…)`), where `<module>` is the original's dotted name;
- calls `patch.object`, `patch.multiple`, `monkeypatch.setattr`, `monkeypatch.delattr`, `setattr` or `delattr` with
  the original module (by a binding or attribute chain) and `'X'`, or with a non-literal name;
- assigns or deletes `<the module>.X`.

And for **every** name moved code reads (not only X), the plan is rejected when any tracked `.py` file:

- builds a string with the original's dotted name as a prefix (an f-string or concatenation starting with
  `'pkg.report.'`, `'%s.%s' % ('pkg.report', …)` with a literal module part);
- uses `patch.object`, `patch.multiple`, `monkeypatch.setattr`, `setattr` or `delattr` on the original module at all,
  whatever the name argument.

Probed: with `helper` and `caller` both moved, `patch('pkg.report.helper')` still reaches staying code but no longer
reaches `caller`; `patch('pkg.report.json')` no longer reaches a moved function using `json`. Both are real behavior
changes for tests that patch a network call away. The message names the file and line.

## Applying a split (host, no AI)

**A new file** is, in order:

1. `# Split from <original basename> by my_editor.` and a blank line;
2. the original's `from __future__` statements, byte for byte (they change how moved code compiles; the move check
   requires every one), then a blank line;
3. its import statements (below), with a blank line wherever the original had one between the statements it copies
   (isort sections), and a blank line before the sibling imports;
4. two blank lines before a def or class, else one (ruff's isort `lines-after-imports`), then the moved spans byte for
   byte in original order, two blank lines apart (PEP 8 and black).

**Import statements in a new file.** For each leading-block statement that binds a name the spans read, in the
original's order:

- `import a.b, c as d` and `from m import x, y as z` are copied filtered to the aliases that bind used names. Every
  piece is copied as text (dots, `as`, parentheses, trailing commas); a parenthesized multi-line statement stays
  multi-line with the kept names on their lines; nothing is renamed. All statements that bind the same name are
  copied, in order.
- `if TYPE_CHECKING:` blocks are copied with their header line and only the kept import lines.
- Other compound statements (`try`/`except ImportError`, version or platform `if`) are copied whole, with the
  imports their conditions need (`sys`).
- Sibling new files: `from .m import X, Y`, names in isort order.

Imports of modules the original never imported are impossible by construction, so no new module loads first. Each copied
import repeats a lookup in `sys.modules` and, for `from m import n`, a `getattr`. A copied `from m import n` is allowed
only when `n` is already in `vars(m)` right after the leading block; otherwise the `getattr` would run `m.__getattr__`
again (a deprecation warning, a lazy load). The verifying check enforces this and proves every result is the same
object (*Checks per step*).

**The original** keeps everything else byte for byte, minus the moved spans; blank lines around a removed span collapse
to the longer of the two runs that bordered it, at most two (core change; Go and TS keep one). The leading block is
unchanged. The facade block follows it, one statement per moved name, sorted the way ruff's isort sorts them (by module,
then CONSTANTS, Classes and the rest, case-insensitively and naturally); each new file imports its own siblings, so the
order does not matter at run time. A blank line goes before the facade unless the leading block ends with a relative
import (the same isort section), and before the next code one blank line, or two when it is a def or class:

```python
from .rows import RowError as RowError
from .rows import _row_cache as _row_cache
from .rows import parse_row as parse_row
```

When a line would exceed the project's line length (black or ruff `line-length`, default 88) it is written the way
black writes it: `from .rows import (`, `name as name,`, `)`. A second split of an already split original sorts its new
statements in with the first facade, which the move check then ignores. `__all__` stays as it is: star imports export
the same names, because they are still bound (probed).

**Imports only moved code used.** They stay in the original (module attributes callers may read), but ruff's default
rules and flake8 then report them (F401) on a file that passed before. So when the project lints with ruff or flake8 (a
`[tool.ruff…]`, `[tool.flake8]` or `[flake8]` section in a top-level pyproject.toml, setup.cfg, tox.ini or .flake8, a
top-level ruff.toml or .ruff.toml, or `ruff` or `flake8` among its dependencies, dev groups or tox `deps`), the split
appends `  # noqa: F401` (two spaces, as black writes inline comments) to the first line of each leading-block import
statement, inside a `TYPE_CHECKING` block or a fallback too, that binds a name the original read before the split and
no longer reads (its staying statements, its leading conditions and the strings in `__all__` count as reads). One such
name is enough, even when the statement binds others still read: both tools report per statement and read the noqa on
its first line (probed with ruff 0.12 and flake8 7; after the closing parenthesis neither does). No suffix on a facade
or `__future__` import, a redundant alias (`x as x`), a line that already names noqa, a line ending in a backslash, or a
line the suffix would push past the line length (black and isort would wrap it; that import is then still reported).
The result stays clean under `ruff check`, `ruff check --select I` and `black --check` (measured with black 24).

## File names

`fileNameProblems(name, original)`:

- `^[a-z_][a-z0-9_]*\.py$`, a valid identifier, not a keyword;
- its stem (ignoring case) is not the stem of any file or folder in the folder;
- not a name bound in the package's `__init__.py` or `__init__.pyi`, and, when the original is `__init__.py`, not a
  name bound in it. Probed: `__init__.py` with `rows = 1`; after `pkg.report` runs `from .rows import …`, `pkg.rows`
  is the module;
- not a stdlib module name, nor an installed top-level module in the interpreter's environment;
- not `__init__`, `__main__`, `conftest`, `setup`, `manage`, `settings`, `models`, `admin`, `apps`, `urls`, `views`,
  `signals`, `tasks`, `serializers`, `wsgi`, `asgi`, and not matched by pytest's `python_files` globs (default
  `test_*.py`, `*_test.py`).

## Move check (Python)

Rules 1, 3 and 5 are the language-neutral ones. Rule 2 and rule 4 get Python parts, and rule 6 is new.

1. Each moved span appears byte-identical in exactly the new file the plan names.
2. The original equals its old bytes minus the moved spans (blank runs collapsed as above), with the facade block as the
   only addition and `  # noqa: F401` exactly on the lines *Imports only moved code used* names, computed again from the
   original as re-parsed after the move (`lineSuffixes`, a core hook: lines of the original that gain a suffix by
   design); a missing, extra or different suffix fails. `importProblems`: the leading block is byte-identical but for
   those suffixes; the facade names exactly the plan's new files
   and, per file, exactly its moved names, each as `name as name`; each new file's imports are a filtered copy of a
   leading-block statement, a whole copied compound statement, a `__future__` copy, or a sibling new-file import.
3. A new file holds only its header comment, `__future__` imports, import statements and moved spans.
4. Same declarations and same names:
   - the declarations of the original and its new files (kind, names, attached comments) are the same multiset before
     and after (`declarationProblems`);
   - the original's top-level bound names are the same set before and after (for `__init__.py`, plus one submodule
     attribute per new file at run time); `__all__` is byte-identical;
   - each new file binds only its moved names, its imports and nothing else.
5. No other tracked file changed.
6. **Bindings are the same.** For every global name read in every moved span and every staying statement, the target
   after the move is the same as before: the same declaration (by its bytes), the same import (absolute module after
   resolving relative levels against the package, and imported name), or the same builtin. A target reached through
   the facade or a sibling import counts as the declaration it traces to.

Rules 2 and 6 run on the files as written and re-parsed from disk by the helper.

## Checks per step

No install. In the worktree, with `commandEnv`: `PATH` (interpreter folder first), `VIRTUAL_ENV`, `PYTHONPATH` (import
roots), `PYTHONDONTWRITEBYTECODE=1`, `PYTHONHASHSEED=0`, `NO_COLOR=1`, `PY_COLORS=0`, `MYPY_CACHE_DIR` in run state.
Nothing is written to the worktree (`__pycache__`, `.pytest_cache`, `.mypy_cache`); probed: `-p no:cacheprovider` and
`PYTHONDONTWRITEBYTECODE` leave none. (`compileall` writes `__pycache__` even with `PYTHONDONTWRITEBYTECODE`, probed;
another reason it is dropped.)

| Label | Command | Verifies | Compared by |
|---|---|---|---|
| `build` | `python <helper folder>/my_editor_pycheck.py <module>`: by path, so the helper's folder (not the project's, as `-m` would put first) is first while the helpers load; `ready()` stops the run when that path has a space | Yes | Exit code and error lines |
| `vet` | `python -m mypy` (its config's `files`, else the top-level packages) when mypy is configured and installed; `basedpyright`/`pyright` when configured and their binary is in the environment (never one that downloads Node) | No | Error lines without positions |
| `test` | `python -m pytest -q -rA -p no:cacheprovider` (plus `-p no:randomly` when pytest-randomly is installed); else `python -m unittest discover -v`; Django without pytest-django: `python manage.py test --verbosity 2` | No | Per-test results, else exit code |

**The verifying check.** The core needs one passing `verifies` check before a split. For Python it is
`my_editor_pycheck`, shipped in `resources/pyast/`, run in a fresh interpreter. It:

1. reads the original's source and, when new modules exist, theirs (the original's facade lines name siblings whose
   first line is the split header for this original);
2. runs the original's **leading block** alone, in a scratch module with the original's `__name__` and
   `__package__`, from a meta-path hook at the moment the import system first looks for the original (so a package
   whose `__init__.py` imports the module is checked in that state, not reported as a cycle; this loads the same
   modules in the same order the real import will, so the real import then finds them loaded). For each
   `try`/`except ImportError` statement it records which import failed and how. It then asserts:
   - every `from m import n` copied into a new module has `n` in `vars(m)`;
   - every `m.attr` that a moved declaration reads at definition time has `attr` in `vars(m)`;
   - every failed import inside a copied compound statement raised `ModuleNotFoundError` whose `name` is exactly the
     module that statement imports (not a module that started and failed halfway), with every package above that name
     still loaded (a package that failed halfway is removed from `sys.modules`);
3. imports the original module by name (this runs the project's import-time code, as tests do);
4. asserts, for each new module, that every name it binds by an import statement, and every name a copied compound
   statement binds, is the **same object** (`is`) as the original's binding of that name (the original keeps every
   import, so it is always there), and that every moved name is the same object in both;
5. exits non-zero with a plain line for any failure.

These facts need the project's code to run, so they cannot be known when the plan is checked. The host's static
rules allow such a move; the import check then fails the step, which is undone with the reason, as any failing check.

**What the import check proves:** the original and every new module import without error under the project
interpreter; no name the new modules import or re-run differs from the original's; nothing a new module imports runs a
module `__getattr__` again; copied fallbacks failed cleanly; the facade re-exports the same objects. **What it does
not prove:** behavior when functions are later called (that is rule 6's static binding check and the tests); behavior
under another interpreter, environment or import order (another entry point importing a different module first);
anything about modules other than the original and its new files; that import-time side effects (files, network,
logging setup) happened exactly once, since it imports in its own process.

It needs no baseline, so it holds after any number of committed steps. At baseline (no new modules yet) it proves the
leading block runs and the module imports. A module that does not import at baseline (missing settings, a service)
has no verifying check, and its split is skipped with the error line, by the existing `noVerifyingCheck`.

`compileall` is not used: the moved bytes are identical, the facade and imports are built by the host, and the
import check compiles the original and every new module anyway.

**Baseline and no tests.** The core runs every check twice on the untouched worktree; a test whose result differs
between the two runs is flaky and excluded. With no test command, splits are offered but not pre-selected, and the
change note says only the move check, the import check and (if any) the type checker ran.

**Test output.** pytest `-rA` summary lines: `PASSED`, `FAILED`, `ERROR`, `XFAIL`, `XPASS` with node IDs; keys are
`<test file> <Class>/<test>/[<param>]`, so the core's `name/` prefix rule finds parametrized tests. `SKIPPED [n]
file:line` lines carry no node ID (probed): a test that changes between skipped and anything else still shows as
missing or new. A collection `ERROR <file>` is keyed `<file> (collection)`. unittest `-v` lines (`test_a
(pkg.tests.TestA.test_a) ... ok`, the shorter pre-3.11 form, `FAIL`, `ERROR`, `skipped`, `expected failure`) keyed by
module and test. Anything else compares by exit code and the change note says so.

**Type checker lines.** mypy's `path:line: error:` is already stripped by `baseline.ts`; pyright's
`path:line:col - error:` is added (core change). The redundant-alias facade keeps `no_implicit_reexport` callers
clean (probed with `mypy --strict`).

## What "unchanged" means

**Shown by** the move check, the import check and the tests:

- every global name in moved and staying code binds to the same definition, import or builtin (rule 6);
- the original binds the same names, `__all__` is the same, and each moved name is the same object through the facade;
- moved definitions run no project or third-party code when defined, and read only stable bindings, so defining them
  earlier, in another module, gives the same objects;
- no module loads first in a new place: new modules import only what the original's leading block already loaded;
- every name a new module imports is the same object the original holds (import check);
- the moved names exist earlier only across quiet statements, which cannot look (*Early binding*).

**What may still differ** (in the change note). `__qualname__` of a top-level definition has no module part and does
not change; only `__module__` and `__globals__` do:

- the module part of a moved class's or function's full name: `__module__`, `repr` of a class
  (`<class 'pkg.rows.C'>`), the last line of a traceback (`pkg.rows.RowError: …`), error-tracker grouping, logging's
  `%(module)s`, `%(filename)s` and `%(lineno)d`, `inspect.getsourcefile`, Sphinx `automodule :members:` (which lists
  only names defined in the module);
- pickles written by this branch name the new module (probed: `pkg.rows C`). They load in this branch and later; old
  pickles still load through the facade; a pickle written here will not load in code from before the split. Projects
  that pickle do not move classes at all (see scope);
- the original module's `__annotations__` no longer lists moved annotated constants;
- the order of names in the original's `__dict__` (facade names come right after the imports); `dir()` and
  `inspect.getmembers` sort and do not change;
- the package gains the new submodules as attributes (`pkg.rows`), which the file-name rule keeps from colliding; when
  the original is `__init__.py`, those attributes are on the original itself;
- under Python 3.15's global lazy-import mode (`-X lazy_imports`, `PYTHON_LAZY_IMPORTS`), which the people running the
  program may turn on, imports load when first used rather than in order. The version gate checks the project's
  interpreter only; how end users run the code is out of reach, and the change note says so.

## Tooling and loaders

| Tool | What it does with a module | Rule |
|---|---|---|
| Django | Imports `models`, `admin`, `apps`, `urls`, `signals`, `management/commands/*`, `templatetags/*` by name or folder; app label from `__module__`; migrations serialize callables by path | Those files and folders skipped; names used in migrations not movable; models never move (base rule) |
| pytest | Collects by `python_files`; loads `conftest.py`, `pytest_plugins`, `pytest11` plugins | Skipped; new names never match the globs |
| Flask, FastAPI, Click, Typer | Register routes and commands by decorator | Decorated definitions stay (decorator rule) |
| Celery | `autodiscover_tasks` imports `tasks`; task name from `__module__` | `tasks` is not a new file name; `@app.task` definitions stay |
| SQLAlchemy, pydantic, attrs | Registries, metaclasses, `__init_subclass__`, decorators | Never move (base and decorator rules) |
| Entry points (`[project.scripts]`, `entry-points`, `setup.cfg`, `setup.py`) | `pkg.report:main` imports the module and reads the attribute | Unchanged through the facade; a `pytest11` module is skipped |
| `importlib.import_module`, Django `import_string`, dotted settings strings | Import and `getattr` | Unchanged through the facade; folder-building forms are a skip (above) |
| mock, monkeypatch | Assign the original's attribute | *Patches that would stop working* |
| Plugin scanners | `pkgutil`, folder listings, `__module__` filters | Folder skip; `__module__` readers narrow the project to constants |

## Add-tests fix (Python)

For a file flagged untested: `test_<stem>_ai.py` in the project's test folder (mirroring the package path when the
project does), else next to the source, matching `python_files`. It may import only the module under test, `pytest`,
`unittest`, `unittest.mock` and the stdlib minus `socket`, `ssl`, `http`, `urllib`, `subprocess`, `asyncio`
subprocess functions and third-party HTTP clients; no remote URL; it must pass twice. Test names are top-level
`test_*` functions and `Test*` classes; failing ones are dropped by span, as in Go. Only the new file may change.

## Components

In `src/aiready/`, each under 400 lines:

| Unit | Job | Interface |
|---|---|---|
| `resources/pyast/my_editor_pyast.py` | Parse one file: leading block, declarations, spans, comments, globals read (symtable), bindings, purity facts, skip facts | `python -I -S my_editor_pyast.py <file>` → JSON |
| `resources/pyast/my_editor_pycheck.py` | The import check and identity invariants | `python <helper folder>/my_editor_pycheck.py <module>` → exit code |
| `pyInterpreter.ts` | Candidates, the user's pick, probe, version gate, `commandEnv` | `pythonFor(root, storage): PyInterpreter \| string` |
| `pyAst.ts` | Run the parser helper, type its output | `pyFileFacts(py, file): PyFacts` |
| `pyProject.ts` | Import roots and module names, scope (pickle, `__module__` readers, Cython/mypyc), frameworks, script references, folder scans, patch strings and assignments, `reload`/`sys.modules`, tool config naming files, packaging lists, test runner, type checker, formatter | `pyProject(root, py, tracked): PyProject` |
| `pyRules.ts` | Skip reasons, purity, movability, early-binding windows, file-name problems (pure) | `pySkipReason(…)`, `pyFileInfoView(…)`, `pyFileNameProblems(…)` |
| `pySplit.ts` | Name rules, patch rejections, new files, import filtering, facade (pure) | `buildPySplit(source, info, plan): SplitResult` |
| `pyMoveCheck.ts` | Rule 2's import part, rule 4 names, rule 6 bindings | `pyImportProblems(…)`, `pySameDeclarations(…)` |
| `pyTests.ts` | pytest `-rA` and unittest `-v` parsing; test names; test-file problems | `parsePyTests(output)`, … |
| `pyPrompts.ts` | Split and test prompts (declarations with `needs`, `_private`, unmovable reasons) | `pySplitPrompt(…)`, `pyTestPrompt(…)` |
| `pyAdapter.ts` | Wire it into `LanguageAdapter` | `createPyAdapter(root, py, tracked)` |

`languages.ts` picks the Python adapter when the root has `pyproject.toml`, `setup.py`, `setup.cfg`,
`requirements*.txt`, `Pipfile` or `manage.py` and neither `go.mod` nor a TS marker (mixed repositories keep their
order until adapters are chosen per file, and the run says which language it chose).

**Changes to the shared core** (small; Go and TS unaffected):

| Change | Why |
|---|---|
| `runCommand` resolves the program against the command env's `PATH` before `process.env.PATH` | The interpreter's folder is chosen per project; its path may have spaces |
| Optional `env` on `CheckCommand`, merged over `commandEnv` (also listed in the TS design, not landed yet) | Only the import check needs the helper's folder on `PYTHONPATH` |
| `moveCheck.ts`: the adapter chooses how blank runs around a removed span collapse (`one`, or `longest` up to two) | Black and ruff need two blank lines between top-level definitions |
| `baseline.ts`: strip `path:line:col - ` like `path:line:col:` | pyright's format |
| `LanguageInfo` for Python: `fixes: ['split', 'tests']` | — |

`unitFiles(file)` returns the original and every file in its folder whose first line is the split header naming it.
`unformatted` runs `black --check` or `ruff format --check` from the environment's `bin` only when the project
configures that formatter.

## Tests

Pure unit tests. Helper tests run with each of Python 3.9, 3.12 and 3.14 that is installed and are skipped (with a
note) for one that is not; the helper accepts `symtable` table types as strings (before 3.13) and as the
`SymbolTableType` enum (3.13+).

- **Interpreter:** `.venv` found; a Poetry project asks `poetry env info`; two candidates ask; 3.15 and 3.8 stop; a
  symlinked venv `python` is not resolved; a path with spaces never reaches the command text.
- **Import roots:** an editable install (both setuptools forms) resolves to the worktree with `PYTHONPATH`; a `src`
  layout; a package that still resolves outside stops the run.
- **Spans:** attached comments move, a detached one stays; trailing comment; an attribute docstring moves with its
  constant; `;` on a line is unmovable; overloads form one declaration; UTF-8 offsets with non-ASCII before a span.
- **Purity:** `1`, `-1`, `'x'`, `(1, 'a')`, `{'a': 1}`, `object()`, `re.compile(r'x', re.I)`, `TypeVar('T')`,
  `list[int]`, `int | None` are pure; `f'{x}'`, `a + b`, `a.b` (not a module), `{k: 1}` with a name key, `[*a]`,
  `frozenset(x())`, `os.environ.get('X')`, `Path('x')`, a comprehension are not.
- **Movability:** a plain function moves; a decorated one (`@app.route`, `@pytest.fixture`, `@attr.s`) does not;
  `@dataclass` and `@lru_cache(maxsize=32)` bound to the stdlib move, the same names bound to a local module do not;
  `class E(Exception)` moves; `class M(BaseModel)`, `class C(metaclass=Meta)`, a body with `x = compute()` do not; a
  base with `__init_subclass__` does not; `global X`, `__name__`, `__doc__`, `__file__` (other than the dirname
  shapes) refuse; a name bound twice, deleted, or assigned from a test refuses; default `def f(x=X)` with `X` an
  import is pure, with `X` a staying constant is rejected by the name rule.
- **Early binding:** any declaration after `register()`, `app = Flask(__name__)`, `threading.Thread(…).start()`,
  `atexit.register(f)`, `importlib.import_module('x')` or `warnings.simplefilter('error')` is refused; one after
  `logger = logging.getLogger(__name__)` moves; one before the first non-quiet statement moves.
- **Narrowed projects:** `multiprocessing`, `ProcessPoolExecutor`, `celery`, `torch.save` or a `!!python/` YAML tag
  anywhere makes functions and classes unmovable; a package `__init__.py` with `__getattr__` skips its modules; a
  `per-file-ignores`, `[mypy-pkg.report]`, pyright `strict` path or coverage `omit` naming the file skips it; a pyenv
  shim is rejected; annotations count as evaluated without `requires-python` and deferred with `>=3.14`.
- **More refusals:** a docstring with `>>>`; a `warnings.warn` caller with `filterwarnings(module='pkg.report')` in a
  test config; a name the leading block binds twice or deletes; an f-string starting `'pkg.report.'` in a test;
  `patch.object(report, 'other')` blocks every name moved code reads.
- **Skipped files:** shebang, main guard, a `python -m` reference in a Makefile, `conftest.py`, `models.py` in a
  Django project, `management/commands/x.py`, CRLF, BOM, a `latin-1` cookie, `# type: ignore` at the top, `exec`,
  `globals()`, `from x import *`, an import after a statement, a `try` with `warnings.warn` in a handler, a sibling
  `.pyi` or `.pxd`, `pkgutil.iter_modules(__path__)` in the package, `importlib.reload(report)` in a test,
  `del sys.modules['pkg.report']`, a namespace package, a top-level module.
- **Name rules:** a moved function using a staying helper is rejected with both IDs; a type-only use of a staying class
  is rejected too; moving both passes; sibling new files import each other without a cycle; a cycle is rejected.
- **Patches:** `patch('pkg.report.helper')` with a moved caller of `helper` is rejected; `patch('pkg.report.json')`
  with a moved user of `json` is rejected; `patch.object(report, name)` with a non-literal name is rejected;
  `patch('pkg.report.helper')` with only staying callers passes.
- **Imports:** filtered `from m import (a, b)` keeps its layout; `import a.b` copied whole; aliases kept; `if
  TYPE_CHECKING:` filtered; `try/except ImportError` copied whole with `sys` when needed; `__future__` first.
- **The original and facade:** every moved name re-imported, `_private` too, as `name as name`; long facades wrapped
  as black does; blank lines collapse to two between definitions; the leading block is unchanged, unused imports kept.
- **File names:** a stem equal to a name in `__init__.py`, an existing module, a stdlib name (`json`), an installed
  package name, `test_x`, `tasks`, a keyword.
- **Move check:** pass on a clean split; fail on an edited body, a dropped facade name, an import the original did not
  have, a facade naming a file outside the plan, a shadowing import (rule 6), a changed `__all__`.
- **Import check:** passes on a clean split; fails when an imported module's `__getattr__` returns a new object each
  time, when a copied `from m import n` needs `m.__getattr__`, when an `m.attr` read at definition time is not in
  `vars(m)`, when a copied `try/except ImportError` caught an `ImportError` other than `ModuleNotFoundError` for its
  own module, and when an import between the original's import and the facade monkeypatches a module attribute.
- **Checks:** pytest `-rA` keys for parametrized and class tests, collection errors, unittest `-v` in both formats;
  pyright and mypy lines compare equal after a move; no `__pycache__` or cache folder appears in the worktree; no
  `push`, `fetch` or `remote` git command.
- **End to end** in a dev host with a real model: a 700-line module in a `src`-layout package with an editable install,
  pytest and mypy (functions, a dataclass, an exception, constants, a patched helper); a flat-layout package with
  unittest; a Django project (helpers move, models and app files do not). Expect checks equal to the baseline, one
  commit per split, the user's folder untouched.

## Out of scope for this version

- Top-level modules, namespace packages, scripts, test files, stubs, notebooks, Cython and mypyc.
- Moving decorated definitions beyond the stdlib allowlist, classes with project or third-party bases or metaclasses,
  and anything with impure definition-time code, even when the order could be proven.
- Moving code that uses the module logger (`logger` stays, so its users stay). This is the most common refusal; a
  later version may move it with a shared-state module.
- Moving anything after a non-allowlisted top-level call, even when the call provably cannot see the original.
- Functions and classes in projects that pickle by reference, use process pools or job queues.
- Rewriting patch targets in tests, updating callers, or adding `__all__`.
- Python 3.15 lazy imports.

## Review: the points most likely to be wrong

Revised after an adversarial review on 10 October 2026, which narrowed: the quiet window to every moved name with a
stdlib-only allowlist of quiet calls; pickling by reference to cover functions, process pools and job queues; copied
`try/except ImportError` and `m.attr` reads to what the import check confirms; lazy packages, doctests, module-keyed
warning filters, tool config naming the file, and annotations read from `requires-python`. What remains:

1. **The quiet-call allowlist.** Each entry is a claim that it imports nothing and calls nothing it is given. A logging
   configuration that installs a custom logger class (`logging.setLoggerClass`) earlier in the program breaks it for
   `getLogger`.
2. **`__init__.py`.** Allowed, under the same quiet window. A partner module that catches `ImportError` from `from pkg
   import x` during package import is the weak spot.
3. **The import check runs the leading block twice in one process** (once in a scratch module, once for real). The
   second run finds every module loaded, but a leading-block import with side effects on the importer (rare) behaves
   differently in the scratch run. The scratch run happens inside a meta-path finder, while the import system holds its
   global lock: a leading import that starts a thread and waits for it to import something would hang until the
   check's timeout.
4. **`__module__` as "may differ"** for projects that neither read it nor pickle. Tracebacks, error-tracker grouping and
   logging's `%(module)s` still change. The narrowing patterns (pickle, pools, queues) may miss a library that pickles
   behind the project's back.
5. **Patch and string detection** is by pattern; a patch target read from config at run time is missed and only the
   tests guard it.
6. **The interpreter.** A wrong pick gives a consistent but wrong baseline. The approval dialog shows the path, version,
   `sys.prefix` and `requires-python`; `ready()` proves imports resolve in the worktree, not that it is the usual
   environment.
7. **Module dict order** changes. Code iterating a module's `__dict__` through a path we do not resolve could register
   things in a different order.
8. **The decorator and stdlib-call allowlists.** The task preferred refusing every decorator; this design allows a short
   stdlib list (`dataclass`, `lru_cache`, `overload`, `TypeVar`, `re.compile`…) resolved by binding, because refusing
   `@dataclass` would pin most modern classes.
9. **End users on Python 3.15** with global lazy imports are out of reach of any check here.

Related: [AI-ready design](2026-10-07-ai-ready-design.md), [TS/JS design](2026-10-09-ai-ready-ts-design.md),
[Stage 2 Go plan](2026-10-09-ai-ready-stage2-go-plan.md).
