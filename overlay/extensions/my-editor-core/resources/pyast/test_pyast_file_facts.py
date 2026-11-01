"""FileFacts regression tests for the Python helper."""
from pyast_test_support import *


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


if __name__ == "__main__":
    unittest.main()
