"""Spans regression tests for the Python helper."""
from pyast_test_support import *


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


if __name__ == "__main__":
    unittest.main()
