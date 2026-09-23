#!/usr/bin/env python3
"""Generates the my_editor file icon theme: calm rounded badges in the Paper palette.

Run: python3 scripts/gen-icons.py
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'overlay/extensions/my-editor-look/icons'
MUTED = '#9aa093'
FONT = "ui-monospace, 'SF Mono', Menlo, monospace"

# id: (label, colour). Labels of one or two characters read at 16px.
BADGES = {
    'ts': ('TS', '#7fa7c9'), 'js': ('JS', '#d9a13b'), 'py': ('PY', '#7fb083'), 'rs': ('RS', '#d4735f'),
    'go': ('GO', '#8ccabf'), 'c': ('C', '#9cc2dc'), 'cpp': ('C+', '#9cc2dc'), 'h': ('H', '#9cc2dc'),
    'java': ('JV', '#e39a84'), 'kt': ('KT', '#c9a0b8'), 'swift': ('SW', '#e39a84'), 'rb': ('RB', '#d4735f'),
    'php': ('PH', '#b3a6d4'), 'cs': ('C#', '#aac38f'), 'sql': ('SQ', '#e8bd6c'), 'vue': ('V', '#7fb083'),
    'svelte': ('S', '#e39a84'), 'lua': ('LU', '#7fa7c9'), 'dart': ('DA', '#8ccabf'), 'r': ('R', '#7fa7c9'),
    'json': ('{}', '#e8bd6c'), 'html': ('<>', '#e39a84'), 'css': ('#', '#9cc2dc'), 'md': ('M', '#b9bdb0'),
    'sh': ('$', '#aac38f'), 'yaml': ('Y', '#b9bdb0'), 'toml': ('T', '#b9bdb0'), 'xml': ('<>', '#b9bdb0'),
    'docker': ('D', '#7fa7c9'), 'npm': ('N', '#d4735f'), 'git': ('G', '#d4735f'), 'env': ('·', '#e8bd6c'),
    'lock': ('L', MUTED), 'license': ('§', '#b9bdb0'), 'readme': ('i', '#e8bd6c'), 'test': ('✓', '#7fb083'),
}

EXTENSIONS = {
    'ts': ['ts', 'mts', 'cts', 'tsx', 'd.ts'], 'js': ['js', 'mjs', 'cjs', 'jsx'], 'py': ['py', 'pyi', 'ipynb'],
    'rs': ['rs'], 'go': ['go'], 'c': ['c'], 'cpp': ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx'], 'h': ['h'],
    'java': ['java'], 'kt': ['kt', 'kts'], 'swift': ['swift'], 'rb': ['rb'], 'php': ['php'], 'cs': ['cs'],
    'sql': ['sql'], 'vue': ['vue'], 'svelte': ['svelte'], 'lua': ['lua'], 'dart': ['dart'], 'r': ['r'],
    'json': ['json', 'jsonc', 'json5'], 'html': ['html', 'htm'], 'css': ['css', 'scss', 'sass', 'less'],
    'md': ['md', 'markdown', 'mdx'], 'sh': ['sh', 'bash', 'zsh', 'fish'], 'yaml': ['yml', 'yaml'],
    'toml': ['toml', 'ini', 'cfg', 'conf'], 'xml': ['xml', 'plist'], 'lock': ['lock'], 'env': ['env'],
    'test': ['test.ts', 'spec.ts', 'test.js', 'spec.js', 'test.tsx', 'spec.tsx'],
}

FILE_NAMES = {
    'npm': ['package.json', 'package-lock.json', '.npmrc'], 'docker': ['Dockerfile', 'docker-compose.yml', 'compose.yaml'],
    'git': ['.gitignore', '.gitattributes', '.gitmodules'], 'env': ['.env', '.env.local', '.env.example', '.env.development'],
    'lock': ['yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'poetry.lock', 'uv.lock'], 'license': ['LICENSE', 'LICENSE.md', 'LICENSE.txt'],
    'readme': ['README.md', 'README', 'readme.md'], 'rs': ['Cargo.toml'], 'go': ['go.mod', 'go.sum'], 'py': ['pyproject.toml', 'requirements.txt'],
}


def badge(label: str, colour: str) -> str:
    size = 7 if len(label) == 1 else 6.2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">'
            f'<rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="{colour}" fill-opacity="0.18" stroke="{colour}" stroke-opacity="0.55"/>'
            f'<text x="8" y="8.4" text-anchor="middle" dominant-baseline="middle" font-family="{FONT}" font-size="{size}" '
            f'font-weight="700" fill="{colour}">{label.replace("<", "&lt;").replace(">", "&gt;")}</text></svg>')


PLAIN_FILE = ('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="' + MUTED + '" stroke-width="1.1" stroke-linejoin="round">'
              '<path d="M4 1.8h5.2L12.5 5v8.2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1Z"/><path d="M9 1.8V5h3.5"/></svg>')
IMAGE = ('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#c9a0b8" stroke-width="1.1" stroke-linejoin="round">'
         '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2.5" fill="#c9a0b8" fill-opacity="0.15"/><circle cx="5.6" cy="6.2" r="1.2"/><path d="m2.5 12 3.8-3.6 2.4 2.2 2-1.6 3 2.8"/></svg>')
FOLDER = ('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#b3aa93" stroke-width="1.1" stroke-linejoin="round">'
          '<path d="M1.8 4.2a1 1 0 0 1 1-1h3.3l1.5 1.6h5.6a1 1 0 0 1 1 1v6.9a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1Z" fill="#b3aa93" fill-opacity="0.12"/></svg>')
FOLDER_OPEN = ('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#d9a13b" stroke-width="1.1" stroke-linejoin="round">'
               '<path d="M1.8 12.2V4.2a1 1 0 0 1 1-1h3.3l1.5 1.6h4.6a1 1 0 0 1 1 1v1.1"/><path d="M1.8 12.2 3.6 7.6a1 1 0 0 1 .9-.6h9.4a.7.7 0 0 1 .7.9l-1.6 4.4a1 1 0 0 1-.9.6H2.6a.8.8 0 0 1-.8-.7Z" fill="#d9a13b" fill-opacity="0.14"/></svg>')


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    definitions = {}
    for key, (label, colour) in BADGES.items():
        (OUT / f'{key}.svg').write_text(badge(label, colour))
        definitions[key] = {'iconPath': f'./{key}.svg'}
    for key, svg in (('_file', PLAIN_FILE), ('_image', IMAGE), ('_folder', FOLDER), ('_folder_open', FOLDER_OPEN)):
        (OUT / f'{key}.svg').write_text(svg)
        definitions[key] = {'iconPath': f'./{key}.svg'}
    extensions = {ext: key for key, exts in EXTENSIONS.items() for ext in exts}
    extensions.update({ext: '_image' for ext in ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif']})
    theme = {
        'iconDefinitions': definitions,
        'file': '_file',
        'folder': '_folder',
        'folderExpanded': '_folder_open',
        'rootFolder': '_folder',
        'rootFolderExpanded': '_folder_open',
        'fileExtensions': extensions,
        'fileNames': {name: key for key, names in FILE_NAMES.items() for name in names},
        'languageIds': {'typescript': 'ts', 'typescriptreact': 'ts', 'javascript': 'js', 'javascriptreact': 'js',
                        'python': 'py', 'rust': 'rs', 'go': 'go', 'c': 'c', 'cpp': 'cpp', 'json': 'json', 'jsonc': 'json',
                        'markdown': 'md', 'html': 'html', 'css': 'css', 'shellscript': 'sh', 'yaml': 'yaml', 'dockerfile': 'docker'},
        'hidesExplorerArrows': False,
    }
    (OUT / 'my_editor-icon-theme.json').write_text(json.dumps(theme, indent='\t') + '\n')
    print(f'wrote {len(definitions)} icons to {OUT}')


if __name__ == '__main__':
    main()
