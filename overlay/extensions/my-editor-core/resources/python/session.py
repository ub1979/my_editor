"""Persistent Python editor session. Run code in one namespace and display a final expression like a notebook."""
import ast as _my_editor_ast
import sys as _my_editor_sys
from my_editor_output import capture as _my_editor_capture


def _my_editor_run(source, filename, run_id=None):
    """Execute statements, then display the final expression through Python's normal REPL display hook."""
    with _my_editor_capture(run_id):
        tree = _my_editor_ast.parse(source, filename, 'exec')
        final = tree.body.pop() if tree.body and isinstance(tree.body[-1], _my_editor_ast.Expr) else None
        namespace = globals()
        namespace['__file__'] = filename
        exec(compile(tree, filename, 'exec'), namespace, namespace)
        if final is not None:
            expression = _my_editor_ast.Expression(final.value)
            _my_editor_sys.displayhook(eval(compile(expression, filename, 'eval'), namespace, namespace))
