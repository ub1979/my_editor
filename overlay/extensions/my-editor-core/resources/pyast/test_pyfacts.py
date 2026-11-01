"""Values regression tests for the Python helper."""
from pyfacts_test_support import *


class Values(unittest.TestCase):
    def check(self, value, pure):
        p, _ = purity(LEAD + 'Z = %s\n' % value, 'Z')
        self.assertEqual(p.reason is None, pure, '%s: %s' % (value, p.reason))

    def test_pure_values(self):
        for value in ['1', '-1', "'x'", "(1, 'a')", "{'a': 1}", 'object()', "re.compile(r'x', re.I)", "TypeVar('T')", 'list[int]',
                      'int | None', 'a', 'lambda q=1: q * 2', 'frozenset({1, 2})']:
            self.check(value, True)

    def test_impure_values(self):
        for value in ["f'{x}'", 'a + b', 'a.b', '{k: 1}', '[*a]', 'frozenset(x())', "os.environ.get('X')", "Path('x')",
                      '[i for i in range(3)]', 'later', 'a < b', 'a[0]']:
            self.check(value, False)

    def test_operators_and_iteration_over_imported_objects_run_code(self):
        lead = 'import collections\nfrom .things import A, B\nfrom typing import Optional\n'
        for value, pure in [('A | B', False), ('frozenset(B)', False), ("collections.namedtuple('P', B)", False), ('Optional[int] | None', True),
                            ("collections.namedtuple('P', 'a b')", True), ("collections.namedtuple('P', ['a', 'b'])", True),
                            ("frozenset(('a', 'b'))", True), ('int | None', True)]:
            p, _ = purity(lead + 'Z = %s\n' % value, 'Z')
            self.assertEqual(p.reason is None, pure, '%s: %s' % (value, p.reason))

    def test_reads_of_earlier_definitions_need_the_same_file_and_module_attributes_need_the_import_check(self):
        p, _ = purity('import lib\nX = 1\ndef f(m=lib.heavy, x=X):\n    return m\n', 'f')
        self.assertIsNone(p.reason)
        self.assertEqual((p.same_file, p.attr_reads), ({'X'}, {('lib', 'heavy')}))

    def test_a_name_bound_twice_is_not_a_stable_read(self):
        p, _ = purity('import os\nX = 1\nX = 2\ndef f(x=X):\n    return x\n', 'f')
        self.assertIn('binds more than once', p.reason)


if __name__ == "__main__":
    unittest.main()
