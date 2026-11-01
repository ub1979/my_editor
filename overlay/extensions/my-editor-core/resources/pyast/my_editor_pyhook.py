"""An import interception point with an injected pre-import checker."""
import importlib.machinery
from my_editor_pyabort import Abort

class Hook:
    """A meta-path finder that runs the checks before the import when the import system first looks for the original."""

    def __init__(self, name, before_import):
        self.name = name
        self.before_import = before_import
        self.busy = False
        self.problems = None
        self.state = None

    def find_spec(self, fullname, path=None, target=None):
        if fullname != self.name or self.busy:
            return None  # A leading import that comes back here imports the real module: a cycle, reported below.
        if self.problems is None:
            self.busy = True
            try:
                self.problems, self.state = self.before_import(fullname, importlib.machinery.PathFinder.find_spec(fullname, path))
            finally:
                self.busy = False
        if self.problems:
            raise Abort()
        return None


