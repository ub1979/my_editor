"""Mirror Python block output to the terminal and a private editor results stream."""
import contextlib
import json
import os
import sys
import traceback


def emit(event):
    """Write one complete event; output capture must never prevent code execution."""
    filename = os.environ.get('MY_EDITOR_PYTHON_RESULTS')
    if filename:
        try:
            with open(filename, 'a', encoding='utf-8') as stream:
                stream.write(json.dumps(event) + '\n')
        except OSError:
            pass


class OutputMirror:
    """A text stream that preserves terminal behavior while copying block output."""

    def __init__(self, original, run_id, channel):
        self.original = original
        self.run_id = run_id
        self.channel = channel

    def write(self, text):
        result = self.original.write(text)
        if text:
            emit({'id': self.run_id, 'channel': self.channel, 'text': text})
        return result

    def flush(self):
        self.original.flush()

    def __getattr__(self, name):
        return getattr(self.original, name)


@contextlib.contextmanager
def capture(run_id):
    """Show errors with their block and keep the interactive namespace usable afterward."""
    if run_id is None:
        yield
        return
    emit({'id': run_id, 'started': True})
    failed = False
    with contextlib.redirect_stdout(OutputMirror(sys.stdout, run_id, 'stdout')):
        with contextlib.redirect_stderr(OutputMirror(sys.stderr, run_id, 'stderr')):
            try:
                yield
            except BaseException:
                failed = True
                traceback.print_exc()
            finally:
                emit({'id': run_id, 'done': True, 'failed': failed})
