"""Tests for my_editor's import check, on temporary packages run in a fresh interpreter. Run: python3 -m unittest -v.

Every project also has top-level `my_editor_pycheck.py` and `my_editor_pyast.py` files that would answer instead of the
shipped helpers if the check ran with the project folder first on sys.path.
"""
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
HEADER = '# Split from report.py by my_editor.\n\n'
SHADOWS = {'my_editor_pycheck.py': 'print("my_editor_pycheck: shadowed")\n', 'my_editor_pyast.py': 'raise SystemExit("shadowed helper")\n'}


def run(files, module='pkg.report', pythonpath='{root}'):
    """Writes the files into a temporary folder and runs the check there (`{root}` in `pythonpath` is that folder); returns (exit code, output)."""
    with tempfile.TemporaryDirectory() as root:
        for name, text in dict(SHADOWS, **files).items():
            path = os.path.join(root, name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'w') as handle:
                handle.write(textwrap.dedent(text))
        env = dict(os.environ, PYTHONPATH=pythonpath.replace('{root}', root), PYTHONDONTWRITEBYTECODE='1')
        result = subprocess.run([sys.executable, os.path.join(HERE, 'my_editor_pycheck.py'), module], cwd=root, env=env, capture_output=True, text=True)
        return result.returncode, result.stdout + result.stderr


SPLIT = {
    'pkg/__init__.py': '',
    'pkg/report.py': 'import json\nfrom .rows import parse as parse\n\n\ndef report(x):\n    return parse(x)\n',
    'pkg/rows.py': HEADER + 'import json\n\n\ndef parse(x):\n    return json.loads(x)\n',
}


class ImportCheck(unittest.TestCase):
    def test_a_clean_split_passes(self):
        code, out = run(SPLIT)
        self.assertEqual(code, 0, out)
        self.assertIn('share every object', out)

    def test_the_baseline_passes_without_new_modules(self):
        self.assertEqual(run({'pkg/__init__.py': '', 'pkg/report.py': 'import json\nX = 1\n'})[0], 0)

    def test_a_module_getattr_returning_new_objects_fails(self):
        files = dict(SPLIT, **{
            'lazy.py': 'def __getattr__(name):\n    return object()\n',
            'pkg/report.py': 'import lazy\nfrom lazy import thing\nfrom .rows import parse as parse\n',
            'pkg/rows.py': HEADER + 'from lazy import thing\n\n\ndef parse():\n    return thing\n'})
        code, out = run(files)
        self.assertEqual(code, 1)
        self.assertIn('imports thing from lazy, which only its __getattr__ provides', out)

    def test_a_lazy_package_import_needs_getattr_again(self):
        """Reviewer probe p6: copying `from pkg import old_api` would run the package's __getattr__ (and its warning) again."""
        files = {'pkg/__init__.py': 'import warnings\ndef __getattr__(name):\n    warnings.warn("old", DeprecationWarning)\n    return len\n',
                 'pkg/report.py': 'from pkg import old_api\nfrom .rows import f as f\n',
                 'pkg/rows.py': HEADER + 'from pkg import old_api\n\n\ndef f():\n    return old_api\n'}
        code, out = run(files)
        self.assertEqual(code, 1)
        self.assertIn('which only its __getattr__ provides', out)

    def test_an_attribute_read_when_defined_must_already_be_set(self):
        """Reviewer probe p7: `def f(m=lib.heavy)` would trigger a lazy submodule import at the facade."""
        files = {'lib/__init__.py': 'import importlib\ndef __getattr__(name):\n    return importlib.import_module("lib." + name)\n',
                 'lib/heavy.py': 'X = 1\n', 'pkg/__init__.py': '',
                 'pkg/report.py': 'import lib\nfrom .rows import f as f\n',
                 'pkg/rows.py': HEADER + 'import lib\n\n\ndef f(m=lib.heavy):\n    return m\n'}
        code, out = run(files)
        self.assertEqual(code, 1)
        self.assertIn('reads lib.heavy when defined', out)

    def test_a_fallback_that_failed_half_way_fails(self):
        """Reviewer probe p3: `_speed` runs its top half and then fails, so copying the fallback would run that half again."""
        fallback = 'try:\n    from ._speed import fast\nexcept ImportError:\n    fast = None\n'
        files = {'pkg/__init__.py': '', 'pkg/_speed.py': 'print("top half")\nfrom json import not_here\ndef fast():\n    return 1\n',
                 'pkg/report.py': fallback + 'from .rows import parse as parse\nCHUNK = 10\n',
                 'pkg/rows.py': HEADER + fallback + '\n\ndef parse():\n    return fast\n'}
        code, out = run(files)
        self.assertEqual(code, 1, out)
        self.assertIn('copies a fallback import of pkg._speed that failed with ImportError', out)

    def test_a_fallback_whose_package_failed_half_way_fails(self):
        """Reviewer fixture ic/p2: `pkg.fast` runs its top half, then fails importing `pkg.fast.impl`; the error names the module
        the statement imports, but its parent is no longer loaded, so copying the fallback would run that half again."""
        fallback = 'try:\n    import pkg.fast.impl as fi\nexcept ImportError:\n    fi = None\n'
        files = {'pkg/__init__.py': '', 'pkg/fast/__init__.py': 'print("top half")\nimport pkg.fast.impl\n',
                 'pkg/report.py': fallback + 'from .rows import X as X\n', 'pkg/rows.py': HEADER + fallback + '\n\nX = fi\n'}
        code, out = run(files)
        self.assertEqual(code, 1, out)
        self.assertIn('copies a fallback import of pkg.fast.impl that failed with ModuleNotFoundError', out)

    def test_a_package_that_re_exports_the_module_passes(self):
        """The parent's __init__ imports the original: the leading block is checked when that import reaches it, not as a cycle."""
        code, out = run(dict(SPLIT, **{'pkg/__init__.py': 'from .report import report as report\n'}))
        self.assertEqual(code, 0, out)
        self.assertIn('share every object', out)

    def test_a_re_exporting_package_still_gets_the_checks_before_the_import(self):
        files = {'lazy.py': 'def __getattr__(name):\n    return object()\n', 'pkg/__init__.py': 'from .report import parse\n',
                 'pkg/report.py': 'import lazy\nfrom lazy import thing\nfrom .rows import parse as parse\n',
                 'pkg/rows.py': HEADER + 'from lazy import thing\n\n\ndef parse():\n    return thing\n'}
        code, out = run(files)
        self.assertEqual(code, 1, out)
        self.assertIn('imports thing from lazy, which only its __getattr__ provides', out)

    def test_clean_fallbacks_pass(self):
        """A missing module, and a loaded module that lacks the name (reviewer point 1: `from yaml import CSafeLoader`)."""
        fallback = ('try:\n    from not_installed_anywhere import thing\nexcept ImportError:\n    thing = None\n'
                    'try:\n    from json import CSafeLoader\nexcept ImportError:\n    CSafeLoader = None\n')
        files = {'pkg/__init__.py': '', 'pkg/report.py': fallback + 'from .rows import parse as parse\n',
                 'pkg/rows.py': HEADER + fallback + '\n\ndef parse():\n    return thing, CSafeLoader\n'}
        code, out = run(files)
        self.assertEqual(code, 0, out)

    def test_an_import_that_patches_a_module_between_fails(self):
        files = {'pkg/__init__.py': '', 'patcher.py': 'import os\nos.sep = "patched"\n',
                 'pkg/report.py': 'from os import sep\nimport patcher\nfrom .rows import f as f\n',
                 'pkg/rows.py': HEADER + 'from os import sep\n\n\ndef f():\n    return sep\n'}
        code, out = run(files)
        self.assertEqual(code, 1, out)
        self.assertIn('sep in rows.py is not what the original\'s imports bound', out)

    def test_a_leading_import_cycle_fails_safely(self):
        """Reviewer point 2 and probe p3's cycle: the scratch run is never registered as the original, so a leading import
        that comes back to it imports the real module, and the check fails instead of reading a half-loaded one."""
        files = {'pkg/__init__.py': '', 'pkg/_speed.py': 'from pkg.report import CHUNK\n',
                 'pkg/report.py': 'try:\n    from ._speed import fast\nexcept ImportError:\n    fast = None\nCHUNK = 10\n'}
        code, out = run(files)
        self.assertEqual(code, 1)
        self.assertIn('imports pkg.report back (an import cycle)', out)

    def test_a_module_that_resolves_outside_the_folder_fails(self):
        """The design's import check: a src layout whose package an editable install or PYTHONPATH finds in another folder
        (the user's, not the working copy) fails, so tests never check other code."""
        with tempfile.TemporaryDirectory() as other:
            os.makedirs(os.path.join(other, 'src', 'pkg'))
            for name in ('__init__.py', 'report.py'):
                open(os.path.join(other, 'src', 'pkg', name), 'w').close()
            files = {'src/pkg/__init__.py': '', 'src/pkg/report.py': 'X = 1\n'}
            code, out = run(files, pythonpath=os.path.join(other, 'src'))
            self.assertEqual(code, 1, out)
            self.assertRegex(out, r'pkg\.report resolves to .*, outside this folder, so the check would test other code')
            code, out = run(files, pythonpath=os.path.join('{root}', 'src') + os.pathsep + os.path.join(other, 'src'))
            self.assertEqual(code, 0, out)

    def test_a_module_that_does_not_import_fails_with_its_error(self):
        code, out = run({'pkg/__init__.py': '', 'pkg/report.py': 'import json\nraise RuntimeError("needs settings")\n'})
        self.assertEqual(code, 1)
        self.assertIn('importing pkg.report failed: RuntimeError: needs settings', out)


if __name__ == '__main__':
    unittest.main()
