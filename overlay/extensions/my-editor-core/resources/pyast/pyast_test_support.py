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


