"""LeadingBlock regression tests for the Python helper."""
from pyast_test_support import *


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


if __name__ == "__main__":
    unittest.main()
