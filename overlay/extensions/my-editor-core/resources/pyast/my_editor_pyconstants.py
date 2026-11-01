"""Known standard-library purity rules, shared by name and expression analysis."""
import builtins

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

