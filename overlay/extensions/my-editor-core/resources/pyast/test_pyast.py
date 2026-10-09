"""Tests for my_editor's Python parser helper (one file's JSON). Run: python3 -m unittest -v (in this folder)."""
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

import my_editor_pyast as pa

HERE = os.path.dirname(os.path.abspath(__file__))


def facts(source):
    return pa.analyze(textwrap.dedent(source).encode('utf-8'))


def decl(source, name):
    return next(d for d in facts(source)['decls'] if name in d['names'])


def text(source, name):
    raw = textwrap.dedent(source).encode('utf-8')
    d = decl(source, name)
    return raw[d['start']:d['end']].decode('utf-8')


class Spans(unittest.TestCase):
    def test_attached_comment_moves_and_detached_one_stays(self):
        src = 'import os\n\n# Detached.\n\n# Attached.\ndef f():\n    pass  # trailing\n'
        self.assertEqual(text(src, 'f'), '# Attached.\ndef f():\n    pass  # trailing')
        self.assertEqual(decl(src, 'f')['docText'], '# Attached.')

    def test_attribute_docstring_moves_with_its_constant(self):
        src = 'X = 1\n"""The X."""\ndef f():\n    pass\n'
        self.assertEqual(text(src, 'X'), 'X = 1\n"""The X."""')
        self.assertEqual(len(facts(src)['decls']), 2)

    def test_a_statement_sharing_a_line_is_not_its_own(self):
        self.assertEqual([d['own'] for d in facts('import os\nX = 1; Y = 2\n')['decls']], [False, False])

    def test_overloads_are_one_declaration(self):
        src = ('from typing import overload\n\n@overload\ndef f(x: int) -> int: ...\n@overload\ndef f(x: str) -> str: ...\n'
               'def f(x):\n    return x\n')
        found = facts(src)['decls']
        self.assertEqual((len(found), found[0]['pure'], found[0]['lines']), (1, True, 6))

    def test_offsets_are_utf8_bytes(self):
        self.assertEqual(text('import os\nNAME = "café ünïcode"\nY = 1\n', 'Y'), 'Y = 1')

    def test_the_file_header_comment_stays_and_a_comment_after_it_attaches(self):
        self.assertEqual(text('# Copyright.\nX = 1\n', 'X'), 'X = 1')
        self.assertEqual(facts('# Copyright.\n\nX = 1\n')['facadeAt'], len('# Copyright.\n\n'))
        new = '# Split from report.py by my_editor.\n\n\n# How amounts are shown.\nCURRENCY = "EUR"\n'
        self.assertEqual(text(new, 'CURRENCY'), '# How amounts are shown.\nCURRENCY = "EUR"')
        self.assertEqual(facts(new)['facadeAt'], new.index('# How'))


class LeadingBlock(unittest.TestCase):
    def test_kinds(self):
        found = facts('"""Doc."""\nfrom __future__ import annotations\nimport os\nfrom typing import TYPE_CHECKING\nif TYPE_CHECKING:\n'
                      '    from json import dumps\ntry:\n    import yaml\nexcept ImportError:\n    yaml = None\nimport sys\n'
                      'if sys.version_info >= (3, 11):\n    import tomllib\nelse:\n    import tomli as tomllib\nX = 1\n')
        self.assertEqual([i['kind'] for i in found['lead']], ['doc', 'future', 'import', 'import', 'typecheck', 'compound', 'import', 'compound'])
        self.assertEqual(found['lead'][-1]['needs'], ['sys'])
        typed = facts('from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    from a import b\nelse:\n    from c import b\n')
        self.assertEqual(typed['lead'][1]['kind'], 'compound')
        self.assertTrue(found['future'])
        self.assertEqual(found['decls'][0]['names'], ['X'])

    def test_a_handler_with_other_code_ends_the_block(self):
        found = facts('import os\ntry:\n    import yaml\nexcept ImportError:\n    import warnings\n    warnings.warn("no yaml")\nimport json\n')
        self.assertEqual(([i['kind'] for i in found['lead']], found['lateImport']), (['import'], 3))

    def test_alias_spans_per_statement_with_normalized_names(self):
        """Reviewer fixture b1: two imports on one line, and NFKC: `import sys as ſ` binds `s`."""
        src = 'import a; import b as c\nimport os, \\\n    sys as \u017f\n'
        found = facts(src)['lead']
        spans = [[(x['name'], x['asname'], src.encode()[x['start']:x['end']].decode()) for x in imp['aliases']] for item in found for imp in item['imports']]
        self.assertEqual(spans, [[('a', None, 'a')], [('b', 'c', 'b as c')], [('os', None, 'os'), ('sys', 's', 'sys as \u017f')]])

    def test_alias_spans(self):
        src = 'from m import (\n    a,\n    b as c,  # why\n)\n'
        imp = facts(src)['lead'][0]['imports'][0]
        self.assertEqual([(x['name'], x['asname'], src.encode()[x['start']:x['end']].decode()) for x in imp['aliases']],
                         [('a', None, 'a'), ('b', 'c', 'b as c')])


class Declarations(unittest.TestCase):
    def test_module_names_and_file(self):
        self.assertTrue(decl('X = 1\ndef f():\n    global X\n    X = 2\n', 'f')['globalStmt'])
        self.assertEqual(decl('def f():\n    return __name__, __doc__\n', 'f')['dunders'], ['__doc__', '__name__'])
        self.assertEqual(decl('import os\ndef f():\n    return os.path.dirname(__file__)\n', 'f')['fileUse'], 'folder')

    def test_doctest_and_class_hooks(self):
        self.assertTrue(decl('def f():\n    """\n    >>> f()\n    """\n', 'f')['doctest'])
        src = 'class B:\n    def __init_subclass__(cls):\n        pass\nclass C(B):\n    pass\n'
        self.assertEqual((decl(src, 'C')['baseNames'], decl(src, 'B')['defines']), (['B'], ['__init_subclass__']))

    def test_reads_and_import_check_facts(self):
        found = decl('import lib\nfrom typing import Optional\nX = 1\ndef f(m=lib.heavy, x=X) -> Optional[int]:\n    return "Row"\n', 'f')
        self.assertEqual((found['sameFile'], found['attrReads'], found['annReads']), (['X'], [['lib', 'heavy']], ['Optional', 'int']))
        self.assertEqual(found['relies'], ['typing'])

    def test_bindings_count_every_statement_and_global_assignment(self):
        found = facts('import os\nX = 1\nX = 2\ndef f():\n    global X\n    X = 3\n')
        self.assertEqual((found['bindings']['X'], found['globalAssigned']), (3, ['X']))


class Quiet(unittest.TestCase):
    """Early binding: only allowlisted stdlib calls with literal arguments are quiet (reviewer probes p1 and p2, reviewer point 3)."""

    def quiet(self, src):
        return facts('import atexit\nimport importlib\nimport logging\nimport threading\nimport warnings\n' + src)['decls'][0]['quiet']

    def test_not_quiet(self):
        """Warning filters are not quiet (reviewer fixture a1: re.compile can warn, and moving it above simplefilter('error') changes that)."""
        for src in ["warnings.filterwarnings('ignore')\n", "warnings.simplefilter('default')\n", 'register()\n', 'app = Flask(__name__)\n',
                    'threading.Thread(target=print).start()\n', 'atexit.register(print)\n',
                    "importlib.import_module('pkg.plug')\n", 'logging.raiseExceptions = False\n', "logging.getLogger('x').error('%s', 1)\n",
                    "warnings.filterwarnings('ignore', category=DeprecationWarning)\n", 'logging.getLogger(name)\n',
                    "warnings.filterwarnings(__name__)\n", 'try:\n    CONFIG = 1\nexcept Exception:\n    CONFIG = 2\n']:
            self.assertFalse(self.quiet(src), src)

    def test_quiet(self):
        for src in ['logger = logging.getLogger(__name__)\n', '"""Doc."""\n', 'pass\n']:
            self.assertTrue(self.quiet(src), src)


class FileFacts(unittest.TestCase):
    def test_namespace_and_entry_facts(self):
        self.assertEqual(facts('exec("x = 1")\n')['namespace'], 'exec()')
        self.assertTrue(facts('from os.path import *\n')['starImport'])
        self.assertTrue(facts('if __name__ == "__main__":\n    pass\n')['mainGuard'])
        self.assertTrue(facts('#!/usr/bin/env python\nX = 1\n')['shebang'])
        self.assertEqual(facts('def __getattr__(name):\n    return CACHE[name]\nCACHE = {}\n')['namespace'],
                         'a module __getattr__ or __dir__ that reads module names')

    def test_bytes_and_tool_comments(self):
        self.assertTrue(pa.analyze(b'\xef\xbb\xbfX = 1\n')['bom'])
        self.assertTrue(pa.analyze(b'X = 1\r\n')['crlf'])
        self.assertEqual([pa.analyze(raw)['cr'] for raw in [b'X = 1\rY = 2\n', b'X = 1\r\n', b'X = 1\n']], [True, False, False])
        self.assertEqual(pa.analyze(b'# -*- coding: latin-1 -*-\nX = 1\n')['cookie'], 'latin-1')
        self.assertEqual(facts('# type: ignore\nX = 1\n')['toolComment'], '# type: ignore')
        self.assertEqual(facts('X = 1\n# mypy: strict\n')['toolComment'], '# mypy: strict')
        self.assertIsNone(facts('X = 1  # type: ignore\n')['toolComment'])
        self.assertTrue(facts('# %%\nX = 1\n')['cells'])

    def test_a_parse_error_is_reported(self):
        self.assertTrue(facts('def (:\n')['error'].startswith('SyntaxError'))

    def test_deep_nesting_is_a_parse_error(self):
        """Reviewer fixture e1: an expression deep enough to exhaust the recursion limit skips the file instead of crashing."""
        error = facts('import os\nX = (' + ' + '.join(['1'] * 5000) + ')\n')['error']
        self.assertTrue(error.startswith(('RecursionError', 'MemoryError')), error)

    def test_the_command_line_prints_json_isolated(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'm.py')
            with open(path, 'w') as handle:
                handle.write('import os\nX = 1\n')
            out = subprocess.run([sys.executable, '-I', '-S', '-B', os.path.join(HERE, 'my_editor_pyast.py'), path], capture_output=True, text=True, cwd=folder)
            self.assertEqual(json.loads(out.stdout)['decls'][0]['names'], ['X'])


if __name__ == '__main__':
    unittest.main()
