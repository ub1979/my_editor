"""Quiet regression tests for the Python helper."""
from pyast_test_support import *


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


if __name__ == "__main__":
    unittest.main()
