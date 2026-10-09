"""Name resolution, purity and global reads for my_editor's Python parser helper. Stdlib only, Python 3.9 syntax."""
import ast
import builtins

from my_editor_pyreads import annotation_nodes, binds, defaults, global_assignments, type_params

BUILTIN_NAMES = frozenset(dir(builtins))
BUILTIN_CLASSES = frozenset(n for n in BUILTIN_NAMES if isinstance(getattr(builtins, n), type))
TYPING = ('typing.', 'typing_extensions.')
GENERICS = frozenset(['list', 'dict', 'tuple', 'set', 'frozenset', 'type'])
PURE_CALLS = frozenset(['builtins.object', 'builtins.frozenset', 're.compile', 'collections.namedtuple', 'typing.TypeVar',
                        'typing.ParamSpec', 'typing.TypeVarTuple', 'typing.NewType'])
CLASS_CALLS = frozenset(['dataclasses.field', 'enum.auto'])
QUIET_CALLS = frozenset(['logging.getLogger', 're.compile', 'os.environ.get', 'os.getenv', 'collections.namedtuple', 'typing.TypeVar',
                         'typing.NewType', 'typing.ParamSpec', 'builtins.object'])
TOP_FUNC = frozenset(['functools.cache', 'functools.lru_cache', 'contextlib.contextmanager', 'contextlib.asynccontextmanager',
                      'typing.overload', 'typing.final'])
TOP_CLASS = frozenset(['dataclasses.dataclass', 'functools.total_ordering', 'enum.unique', 'typing.final', 'typing.runtime_checkable'])
IN_CLASS = frozenset(['builtins.property', 'builtins.staticmethod', 'builtins.classmethod', 'functools.cached_property',
                      'abc.abstractmethod', 'typing.overload', 'typing.override', 'typing.final'])
CALLABLE_DECORATORS = frozenset(['functools.lru_cache', 'dataclasses.dataclass'])
STD_BASES = frozenset(['abc.ABC', 'enum.Enum', 'enum.IntEnum', 'enum.StrEnum', 'enum.Flag', 'enum.IntFlag', 'typing.NamedTuple',
                       'typing.TypedDict', 'typing.Protocol'])
SUBSCRIPT_BASES = frozenset(['typing.Generic', 'typing.Protocol'])
CLASS_HOOKS = ('__init_subclass__', '__class_getitem__', '__set_name__')
ENUM_HOOKS = ('__init__', '__new__', '_generate_next_value_')
ITERATED = frozenset(['builtins.frozenset', 'collections.namedtuple'])


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


class Purity:
    """Decides whether definition-time code is pure, collecting what the decision relied on."""

    def __init__(self, names, index):
        self.names = names
        self.index = index
        self.reason = None
        self.same_file = set()
        self.attr_reads = set()
        self.relies = set()
        self.params = set()  # PEP 695 type parameters in scope

    def fail(self, why):
        if self.reason is None:
            self.reason = why
        return False

    def rely(self, target):
        self.relies.add(target.split('.')[0])

    def read(self, name):
        names = self.names
        if name in self.params:
            return True
        if name in names.lead_canon or name in names.lead_modules:
            return True if names.counts.get(name, 0) == 1 else self.fail('it reads %s, which the file binds more than once' % name)
        if name not in names.counts:
            return True if name in BUILTIN_NAMES else self.fail('it reads %s, which is not defined in the module' % name)
        if names.defined.get(name, self.index) >= self.index:
            return self.fail('it reads %s before %s is defined' % (name, name))
        if names.counts[name] != 1:
            return self.fail('it reads %s, which the file binds more than once' % name)
        self.same_file.add(name)
        return True

    def literal(self, node):
        if isinstance(node, ast.Constant):
            return True
        if isinstance(node, ast.Tuple):
            return all(self.literal(e) for e in node.elts)
        return isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)) and isinstance(node.operand, ast.Constant)

    def expr(self, node, in_class=False):
        """Pure: literals, displays, lambdas, stable reads, module attributes, type expressions, allowlisted calls."""
        if isinstance(node, ast.Constant):
            return True
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            return isinstance(node.operand, ast.Constant) and isinstance(node.operand.value, (int, float, complex)) or self.fail('an operator runs code')
        if isinstance(node, ast.JoinedStr):
            return all(isinstance(v, ast.Constant) for v in node.values) or self.fail('an f-string with fields runs code')
        if isinstance(node, (ast.Tuple, ast.List)):
            return all(not isinstance(e, ast.Starred) and self.expr(e, in_class) for e in node.elts) or self.fail('unpacking runs code')
        if isinstance(node, ast.Set):
            return all(self.literal(e) for e in node.elts) or self.fail('a set item that is not a literal runs __hash__')
        if isinstance(node, ast.Dict):
            if not all(k is not None and self.literal(k) for k in node.keys):
                return self.fail('a dict key that is not a literal runs __hash__')
            return all(self.expr(v, in_class) for v in node.values)
        if isinstance(node, ast.Lambda):
            return all(self.expr(d, in_class) for d in node.args.defaults + [d for d in node.args.kw_defaults if d is not None])
        if isinstance(node, ast.Name):
            return self.read(node.id)
        if isinstance(node, ast.Attribute):
            return self.attribute(node)
        if isinstance(node, (ast.Subscript, ast.BinOp)):
            return self.type_expr(node)
        if isinstance(node, ast.Call):
            return self.call(node, in_class)
        return self.fail('its definition runs code (%s)' % type(node).__name__)

    def attribute(self, node):
        if isinstance(node.value, ast.Name) and node.value.id in self.names.lead_modules and self.names.counts.get(node.value.id) == 1:
            self.attr_reads.add((self.names.canon(node.value) or node.value.id, node.attr))
            return True
        return self.fail('it reads the attribute %s, which may run code' % ast.unparse(node))

    def type_expr(self, node):
        """Subscripts of builtin generics or typing names, and `|` between types, None and stable class names."""
        if isinstance(node, ast.BinOp):
            if not isinstance(node.op, ast.BitOr):
                return self.fail('an operator runs code')
            return all(self.union_part(side) for side in (node.left, node.right))
        value = node.value
        target = self.names.canon(value)
        generic = isinstance(value, ast.Name) and value.id in GENERICS and target == 'builtins.' + value.id
        if not (generic or (target and target.startswith(TYPING)) or (target or '').startswith('collections.abc.')):
            return self.fail('a subscript of %s runs code' % ast.unparse(value))
        if target and not generic:
            self.rely(target)
        if not (self.attribute(value) if isinstance(value, ast.Attribute) else self.expr(value)):
            return False
        args = node.slice.elts if isinstance(node.slice, ast.Tuple) else [node.slice]
        return all(self.type_part(a) for a in args)

    def union_part(self, node):
        """A side of `|`: None, a builtin class, a typing name, a type subscript or a class from this file, never an imported object."""
        if isinstance(node, ast.Constant) and node.value is None or isinstance(node, (ast.Subscript, ast.BinOp)):
            return self.expr(node)
        target = self.names.canon(node) or ''
        own = isinstance(node, ast.Name) and isinstance(self.names.nodes.get(node.id), ast.ClassDef) or isinstance(node, ast.Name) and node.id in self.params
        typing = target.startswith(TYPING + ('collections.abc.',)) or target.startswith('builtins.') and target[9:] in BUILTIN_CLASSES
        if not (own or typing):
            return self.fail('%s | … may call __or__ of %s' % (ast.unparse(node), ast.unparse(node)))
        if typing and not own and not target.startswith('builtins.'):
            self.rely(target)
        return self.attribute(node) if isinstance(node, ast.Attribute) else self.expr(node)

    def type_part(self, node):
        if isinstance(node, ast.Constant):
            return True
        if isinstance(node, ast.List):
            return all(self.type_part(e) for e in node.elts)
        if isinstance(node, ast.Tuple):
            return all(self.type_part(e) for e in node.elts)
        return self.expr(node)

    def call(self, node, in_class):
        target = self.names.canon(node.func)
        allowed = PURE_CALLS | (CLASS_CALLS if in_class else frozenset())
        if target not in allowed:
            return self.fail('it calls %s' % ast.unparse(node.func))
        self.rely(target)
        if target == 'builtins.object' and (node.args or node.keywords):
            return self.fail('it calls object() with arguments')
        if target == 're.compile' and not (node.args and isinstance(node.args[0], ast.Constant)):
            return self.fail('re.compile needs a literal pattern')
        if any(isinstance(a, ast.Starred) for a in node.args) or any(k.arg is None for k in node.keywords):
            return self.fail('a call with * or ** runs code')
        if target in ITERATED and not all(display(a) for a in node.args[1 if target == 'collections.namedtuple' else 0:] + [k.value for k in node.keywords]):
            return self.fail('%s iterates an argument that is not a literal' % ast.unparse(node.func))
        flags = node.args[1:] if target == 're.compile' else []
        if any(not self.flags(f) for f in flags):
            return False
        rest = node.args if target != 're.compile' else node.args[:1]
        return all(self.expr(a, in_class) for a in rest) and all(self.expr(k.value, in_class) for k in node.keywords)

    def flags(self, node):
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
            return self.flags(node.left) and self.flags(node.right)
        return self.expr(node)

    def decorator(self, node, allowed):
        call = isinstance(node, ast.Call)
        target = self.names.canon(node.func if call else node)
        if target not in allowed:
            return self.fail('it has the decorator %s' % ast.unparse(node))
        self.rely(target)
        if call and (target not in CALLABLE_DECORATORS or node.args and target == 'dataclasses.dataclass'
                     or not all(self.literal(a) for a in node.args) or not all(k.arg and self.literal(k.value) for k in node.keywords)):
            return self.fail('its decorator %s takes arguments that are not literals' % ast.unparse(node))
        return True


def display(node):
    """A literal, or a tuple, list or set display of literals: iterating or hashing it runs no project code."""
    if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
        return all(display(e) for e in node.elts)
    return isinstance(node, ast.Constant) or isinstance(node, ast.UnaryOp) and isinstance(node.operand, ast.Constant)


def scoped(purities, names, check):
    """Runs `check` with PEP 695 type parameters in scope of each Purity."""
    added = [n for n in names if all(n not in p.params for p in purities)]
    for p in purities:
        p.params.update(added)
    try:
        return check()
    finally:
        for p in purities:
            p.params.difference_update(added)


def function_pure(p, ann, fn, allowed, decorators=None):
    """A def is pure when its decorators are allowed and its defaults pure; its annotations decide `ann` (deferrable)."""
    for d in fn.decorator_list if decorators is None else decorators:
        if not p.decorator(d, allowed):
            return False
    if not all(p.expr(d) for d in defaults(fn)):
        return False

    def annotations():
        for node in annotation_nodes(fn):
            ann.type_part(node)
        return True
    return scoped([ann], type_params(fn), annotations)


def ancestors(names, cls, seen=()):
    """The class and its bases defined earlier in this file, nearest first."""
    found = [cls]
    for base in cls.bases:
        node = names.nodes.get(base.id) if isinstance(base, ast.Name) else None
        if isinstance(node, ast.ClassDef) and node not in seen and node is not cls:
            found += ancestors(names, node, tuple(seen) + (cls,))
    return found


def creation_hook(p, cls):
    """Why creating the class runs project code beyond its body: a base's __init_subclass__, or Enum member hooks."""
    chain = ancestors(p.names, cls)
    defines = [(c, {s.name for s in c.body if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef))}) for c in chain]
    hook = next(('%s defines __init_subclass__' % c.name for c, d in defines[1:] if '__init_subclass__' in d), None)
    enum = any((p.names.canon(b) or '').startswith('enum.') for c in chain for b in c.bases)
    found = next(('%s defines %s' % (c.name, h) for c, d in defines for h in ENUM_HOOKS if h in d), None) if enum else None
    return hook and 'its base %s, which runs when the class is defined' % hook or found and 'it is an Enum and %s, which runs for each member' % found


def assigned(stmt):
    return stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]


def settable(p, node):
    """A class-body value whose type may define __set_name__ (run at class creation): an imported object or a module attribute."""
    if isinstance(node, ast.Call):
        return next((s for s in map(lambda a: settable(p, a), node.args + [k.value for k in node.keywords]) if s), None)
    if isinstance(node, ast.Attribute) or isinstance(node, ast.Name) and (node.id in p.names.lead_canon or node.id in p.names.lead_modules):
        return ast.unparse(node)
    return None


def class_pure(p, ann, cls, nested=False):
    """Bases, keywords, decorators and body under the design's class rules."""
    return scoped([p, ann], type_params(cls), lambda: class_rules(p, ann, cls))


def class_rules(p, ann, cls):
    for d in cls.decorator_list:
        if not p.decorator(d, TOP_CLASS):
            return False
    for base in cls.bases:
        target = p.names.canon(base.value if isinstance(base, ast.Subscript) else base)
        if isinstance(base, ast.Subscript):
            if target not in SUBSCRIPT_BASES:
                return p.fail('its base %s is not on the allowed list' % ast.unparse(base))
            p.rely(target)
            if not p.type_expr(base):
                return False
        elif target and (target in STD_BASES or target[len('builtins.'):] in BUILTIN_CLASSES and target.startswith('builtins.')):
            p.rely(target)
        elif isinstance(base, ast.Name) and target is None and p.read(base.id) and base.id in p.same_file:
            continue
        else:
            return p.fail('its base %s may run code when the class is defined' % ast.unparse(base))
    for k in cls.keywords:
        if not (k.arg == 'metaclass' and p.names.canon(k.value) == 'abc.ABCMeta'):
            return p.fail('its keyword %s runs code' % ast.unparse(k))
    hook = creation_hook(p, cls)
    if hook:
        return p.fail(hook)
    local = set()
    props = set()
    for stmt in cls.body:
        if isinstance(stmt, ast.Pass) or isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant):
            continue
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            plain = []
            for d in stmt.decorator_list:
                if isinstance(d, ast.Attribute) and isinstance(d.value, ast.Name) and d.value.id in props and d.attr in ('setter', 'getter', 'deleter'):
                    continue
                if isinstance(d, ast.Name) and d.id in local:
                    return p.fail('its class body binds %s' % d.id)
                plain.append(d)
            if not function_pure(p, ann, stmt, IN_CLASS, plain):
                return False
            if any(p.names.canon(d) == 'builtins.property' for d in stmt.decorator_list):
                props.add(stmt.name)
            local.add(stmt.name)
        elif isinstance(stmt, ast.ClassDef):
            if not class_pure(p, ann, stmt, True):
                return False
            local.add(stmt.name)
        elif isinstance(stmt, (ast.Assign, ast.AnnAssign)) and all(isinstance(t, ast.Name) for t in assigned(stmt)):
            value = stmt.value
            if isinstance(stmt, ast.AnnAssign) and not p.type_part(stmt.annotation) or value is not None and not p.expr(value, True):
                return False
            if value is not None and settable(p, value):
                return p.fail('its class body holds %s, whose __set_name__ may run code' % settable(p, value))
            local.update(t.id for t in assigned(stmt))
        else:
            return p.fail('its class body runs code (%s)' % type(stmt).__name__)
    return True


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
