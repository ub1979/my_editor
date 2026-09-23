#!/usr/bin/env python3
"""Generates the my_editor colour themes from one palette.

Paper: dark olive chrome around a cream page (the editor). Night: the same chrome with a dark page.
Palette follows the song_maker (Rafeeq) redesign tokens: olive shell, paper, ink, gold accent.
Run: python3 scripts/gen-themes.py
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'overlay/extensions/my-editor-look/themes'

OLIVE = {950: '#101209', 900: '#151713', 875: '#171a14', 850: '#1a1d17', 825: '#1c2018', 800: '#20241b',
         750: '#23281e', 700: '#262b21', 650: '#2a3024', 600: '#2e3527', 550: '#31382b', 500: '#353d2e',
         450: '#3a4232', 400: '#4a5145', 300: '#5d6356'}
PAPER, PAPER_50, PAPER_LINE = '#f4f2ea', '#f0efe8', '#ded9c9'
INK, INK_700, INK_500, INK_300 = '#1a1c17', '#5d6356', '#7c8376', '#9aa093'
GOLD, GOLD_DEEP, GOLD_LIGHT = '#d9a13b', '#b8862c', '#e8bd6c'
GREEN, GREEN_LIGHT, RED, RED_DEEP = '#7a8a6a', '#7fb083', '#d4735f', '#c2513a'


def chrome() -> dict:
    """Everything outside the page: quiet, dark, one accent."""
    return {
        'foreground': PAPER_50, 'descriptionForeground': INK_300, 'disabledForeground': INK_500,
        'errorForeground': RED, 'icon.foreground': '#b9bdb0', 'focusBorder': GOLD + '99',
        'contrastBorder': '#00000000', 'selection.background': GOLD + '40',
        'widget.border': OLIVE[600], 'widget.shadow': '#00000059', 'sash.hoverBorder': GOLD,
        'textLink.foreground': GOLD_LIGHT, 'textLink.activeForeground': '#f0c67a',
        'textCodeBlock.background': OLIVE[800], 'textBlockQuote.background': OLIVE[825],
        'textBlockQuote.border': OLIVE[450], 'textPreformat.foreground': GOLD_LIGHT,
        'textSeparator.foreground': OLIVE[450],

        'titleBar.activeBackground': OLIVE[900], 'titleBar.activeForeground': '#cfcdbf',
        'titleBar.inactiveBackground': OLIVE[900], 'titleBar.inactiveForeground': INK_500,
        'titleBar.border': OLIVE[900],
        'commandCenter.background': OLIVE[825], 'commandCenter.foreground': INK_300,
        'commandCenter.activeBackground': OLIVE[750], 'commandCenter.activeForeground': PAPER_50,
        'commandCenter.border': OLIVE[650], 'commandCenter.activeBorder': OLIVE[450],
        'commandCenter.inactiveForeground': INK_500, 'commandCenter.inactiveBorder': OLIVE[700],

        'activityBar.background': OLIVE[900], 'activityBar.foreground': GOLD_LIGHT,
        'activityBar.inactiveForeground': INK_500, 'activityBar.border': OLIVE[900],
        'activityBar.activeBorder': GOLD, 'activityBar.activeBackground': '#00000000',
        'activityBarBadge.background': GOLD, 'activityBarBadge.foreground': INK,
        'activityBarTop.foreground': GOLD_LIGHT, 'activityBarTop.inactiveForeground': INK_500,
        'activityBarTop.activeBorder': GOLD, 'activityBarTop.background': OLIVE[850],

        'sideBar.background': OLIVE[850], 'sideBar.foreground': '#d8d6ca', 'sideBar.border': OLIVE[850],
        'sideBarTitle.foreground': INK_300, 'sideBarSectionHeader.background': OLIVE[850],
        'sideBarSectionHeader.foreground': INK_300, 'sideBarSectionHeader.border': OLIVE[700],
        'sideBar.dropBackground': GOLD + '1f',

        'list.activeSelectionBackground': OLIVE[500], 'list.activeSelectionForeground': PAPER,
        'list.activeSelectionIconForeground': GOLD_LIGHT,
        'list.inactiveSelectionBackground': OLIVE[650], 'list.inactiveSelectionForeground': PAPER_50,
        'list.hoverBackground': OLIVE[750], 'list.hoverForeground': PAPER_50,
        'list.focusBackground': OLIVE[600], 'list.focusOutline': GOLD + '80',
        'list.inactiveFocusOutline': '#00000000', 'list.highlightForeground': GOLD_LIGHT,
        'list.focusHighlightForeground': GOLD_LIGHT, 'list.dropBackground': GOLD + '1f',
        'list.errorForeground': RED, 'list.warningForeground': GOLD_LIGHT,
        'tree.indentGuidesStroke': OLIVE[450], 'tree.inactiveIndentGuidesStroke': OLIVE[600],

        'editorGroupHeader.tabsBackground': OLIVE[900], 'editorGroupHeader.tabsBorder': OLIVE[900],
        'editorGroupHeader.noTabsBackground': OLIVE[900], 'editorGroupHeader.border': '#00000000',
        'editorGroup.border': OLIVE[900], 'editorGroup.emptyBackground': OLIVE[950],
        'editorGroup.dropBackground': GOLD + '1a',
        # The margins beside the centred page.
        'editorPane.background': OLIVE[950],
        'tab.inactiveBackground': OLIVE[900], 'tab.inactiveForeground': INK_500,
        'tab.unfocusedInactiveForeground': OLIVE[300], 'tab.border': OLIVE[900],
        'tab.hoverBackground': OLIVE[825], 'tab.hoverForeground': PAPER_50,
        'tab.activeBorderTop': GOLD, 'tab.unfocusedActiveBorderTop': OLIVE[400],
        'tab.activeModifiedBorder': GOLD, 'tab.lastPinnedBorder': OLIVE[450],

        'statusBar.background': OLIVE[900], 'statusBar.foreground': INK_500,
        'statusBar.border': OLIVE[900], 'statusBar.noFolderBackground': OLIVE[900],
        'statusBar.noFolderForeground': INK_500, 'statusBar.focusBorder': GOLD,
        'statusBar.debuggingBackground': GOLD_DEEP, 'statusBar.debuggingForeground': INK,
        'statusBarItem.hoverBackground': OLIVE[750], 'statusBarItem.hoverForeground': PAPER_50,
        'statusBarItem.remoteBackground': OLIVE[900], 'statusBarItem.remoteForeground': GOLD,
        'statusBarItem.prominentBackground': OLIVE[700], 'statusBarItem.errorBackground': RED_DEEP,
        'statusBarItem.warningBackground': GOLD_DEEP, 'statusBarItem.warningForeground': INK,

        'panel.background': OLIVE[875], 'panel.border': OLIVE[700],
        'panelTitle.activeForeground': PAPER_50, 'panelTitle.activeBorder': GOLD,
        'panelTitle.inactiveForeground': INK_500, 'panelSection.border': OLIVE[700],
        'panelSectionHeader.background': OLIVE[850],

        'input.background': OLIVE[800], 'input.border': OLIVE[550], 'input.foreground': PAPER_50,
        'input.placeholderForeground': INK_500, 'inputOption.activeBorder': GOLD,
        'inputOption.activeBackground': GOLD + '33', 'inputOption.activeForeground': PAPER,
        'inputValidation.errorBackground': '#3a2620', 'inputValidation.errorBorder': RED,
        'inputValidation.warningBackground': '#3a3020', 'inputValidation.warningBorder': GOLD,
        'inputValidation.infoBackground': OLIVE[750], 'inputValidation.infoBorder': INK_300,
        'dropdown.background': OLIVE[800], 'dropdown.border': OLIVE[550],
        'dropdown.foreground': PAPER_50, 'dropdown.listBackground': OLIVE[825],
        'checkbox.background': OLIVE[800], 'checkbox.border': OLIVE[450],
        'checkbox.foreground': GOLD_LIGHT,
        'button.background': GOLD, 'button.foreground': INK, 'button.hoverBackground': GOLD_LIGHT,
        'button.border': '#00000000', 'button.separator': INK + '40',
        'button.secondaryBackground': OLIVE[600], 'button.secondaryForeground': PAPER_50,
        'button.secondaryHoverBackground': OLIVE[500],
        'badge.background': GOLD, 'badge.foreground': INK,
        'progressBar.background': GOLD,
        'scrollbar.shadow': '#00000000',
        'scrollbarSlider.background': INK_300 + '26', 'scrollbarSlider.hoverBackground': INK_300 + '40',
        'scrollbarSlider.activeBackground': INK_300 + '59',

        'quickInput.background': OLIVE[825], 'quickInput.foreground': PAPER_50,
        'quickInputTitle.background': OLIVE[800], 'quickInputList.focusBackground': OLIVE[500],
        'quickInputList.focusForeground': PAPER, 'quickInputList.focusIconForeground': GOLD_LIGHT,
        'pickerGroup.foreground': GOLD, 'pickerGroup.border': OLIVE[600],
        'keybindingLabel.background': OLIVE[750], 'keybindingLabel.foreground': '#d8d6ca',
        'keybindingLabel.border': OLIVE[450], 'keybindingLabel.bottomBorder': OLIVE[450],
        'menu.background': OLIVE[825], 'menu.foreground': PAPER_50, 'menu.border': OLIVE[600],
        'menu.selectionBackground': OLIVE[500], 'menu.selectionForeground': PAPER,
        'menu.separatorBackground': OLIVE[600],
        'notifications.background': OLIVE[825], 'notifications.foreground': PAPER_50,
        'notifications.border': OLIVE[600], 'notificationCenterHeader.background': OLIVE[800],
        'notificationToast.border': OLIVE[600], 'notificationLink.foreground': GOLD_LIGHT,
        'notificationsInfoIcon.foreground': INK_300, 'notificationsWarningIcon.foreground': GOLD,
        'notificationsErrorIcon.foreground': RED,

        # Floating tools over the page stay dark, like a toolbar laid on paper.
        'editorWidget.background': OLIVE[825], 'editorWidget.foreground': PAPER_50,
        'editorWidget.border': OLIVE[600], 'editorWidget.resizeBorder': GOLD,
        'editorSuggestWidget.background': OLIVE[825], 'editorSuggestWidget.border': OLIVE[600],
        'editorSuggestWidget.foreground': '#e2dfd2', 'editorSuggestWidget.selectedBackground': OLIVE[500],
        'editorSuggestWidget.selectedForeground': PAPER, 'editorSuggestWidget.highlightForeground': GOLD_LIGHT,
        'editorSuggestWidget.focusHighlightForeground': GOLD_LIGHT,
        'editorHoverWidget.background': OLIVE[825], 'editorHoverWidget.border': OLIVE[600],
        'editorHoverWidget.foreground': '#e2dfd2', 'editorHoverWidget.statusBarBackground': OLIVE[800],
        'debugToolBar.background': OLIVE[825],

        'terminal.background': OLIVE[875], 'terminal.foreground': '#e2dfd2',
        'terminalCursor.foreground': GOLD, 'terminal.selectionBackground': GOLD + '40',
        'terminal.ansiBlack': OLIVE[700], 'terminal.ansiRed': RED, 'terminal.ansiGreen': '#9fbf8a',
        'terminal.ansiYellow': GOLD_LIGHT, 'terminal.ansiBlue': '#9cc2dc', 'terminal.ansiMagenta': '#c9a0b8',
        'terminal.ansiCyan': '#8ccabf', 'terminal.ansiWhite': '#d8d6ca',
        'terminal.ansiBrightBlack': INK_500, 'terminal.ansiBrightRed': '#e39a84',
        'terminal.ansiBrightGreen': '#b8d4a3', 'terminal.ansiBrightYellow': '#f0cf8c',
        'terminal.ansiBrightBlue': '#b9d6ea', 'terminal.ansiBrightMagenta': '#dbb9cd',
        'terminal.ansiBrightCyan': '#a9dcd2', 'terminal.ansiBrightWhite': PAPER,

        'gitDecoration.addedResourceForeground': '#9fbf8a', 'gitDecoration.modifiedResourceForeground': GOLD_LIGHT,
        'gitDecoration.deletedResourceForeground': RED, 'gitDecoration.untrackedResourceForeground': GREEN_LIGHT,
        'gitDecoration.ignoredResourceForeground': OLIVE[300], 'gitDecoration.conflictingResourceForeground': RED,
        'peekView.border': GOLD, 'peekViewTitle.background': OLIVE[800],
        'peekViewTitleLabel.foreground': PAPER_50, 'peekViewTitleDescription.foreground': INK_300,
        'peekViewResult.background': OLIVE[825], 'peekViewResult.fileForeground': PAPER_50,
        'peekViewResult.lineForeground': '#d8d6ca', 'peekViewResult.selectionBackground': OLIVE[500],
        'peekViewResult.matchHighlightBackground': GOLD + '40',
        'welcomePage.background': OLIVE[900], 'walkThrough.embeddedEditorBackground': OLIVE[825],
        'settings.headerForeground': PAPER_50, 'settings.modifiedItemIndicator': GOLD,
        'inlineChat.background': OLIVE[825], 'inlineChat.border': OLIVE[600],
        'inlineChatInput.background': OLIVE[800], 'inlineChatInput.border': OLIVE[550],
        'chat.requestBackground': OLIVE[825], 'chat.requestBorder': OLIVE[650],
        'chat.slashCommandBackground': GOLD + '26', 'chat.slashCommandForeground': GOLD_LIGHT,
        'chat.avatarBackground': OLIVE[650], 'chat.avatarForeground': GOLD_LIGHT,
        'chat.editedFileForeground': GOLD_LIGHT,
    }


def page(paper: bool) -> dict:
    """The editor itself: the page the user writes on."""
    bg = PAPER if paper else OLIVE[850]
    fg = INK if paper else '#e9e6da'
    ink_a = INK if paper else '#e9e6da'
    return {
        'editor.background': bg, 'editor.foreground': fg,
        'editorLineNumber.foreground': '#9a9178' if paper else OLIVE[300],
        'editorLineNumber.activeForeground': '#4a5145' if paper else '#b3b8a8',
        'editorCursor.foreground': GOLD_DEEP if paper else GOLD,
        'editor.selectionBackground': GOLD + ('40' if paper else '38'),
        'editor.inactiveSelectionBackground': GOLD + '26',
        'editor.selectionHighlightBackground': GOLD + '1f',
        'editor.lineHighlightBackground': GOLD + ('12' if paper else '0d'),
        'editor.lineHighlightBorder': '#00000000',
        'editor.wordHighlightBackground': GREEN + '26', 'editor.wordHighlightStrongBackground': GREEN + '40',
        'editor.findMatchBackground': GOLD_LIGHT + ('99' if paper else '66'),
        'editor.findMatchHighlightBackground': GOLD_LIGHT + ('55' if paper else '33'),
        'editor.findRangeHighlightBackground': GOLD + '14', 'editor.rangeHighlightBackground': GOLD + '14',
        'editor.foldBackground': GOLD + '10',
        'editorIndentGuide.background1': ink_a + '14', 'editorIndentGuide.activeBackground1': ink_a + '33',
        'editorWhitespace.foreground': ink_a + '26', 'editorRuler.foreground': PAPER_LINE if paper else OLIVE[600],
        'editorBracketMatch.background': GOLD + '26', 'editorBracketMatch.border': GOLD_DEEP + '80',
        'editorCodeLens.foreground': '#8a826b' if paper else INK_500,
        'editorInlayHint.background': ink_a + '0d', 'editorInlayHint.foreground': INK_500,
        'editorLink.activeForeground': GOLD_DEEP if paper else GOLD_LIGHT,
        'editorGutter.background': bg, 'editorGutter.foldingControlForeground': '#8a826b' if paper else INK_500,
        'editorGutter.addedBackground': GREEN, 'editorGutter.modifiedBackground': GOLD,
        'editorGutter.deletedBackground': RED_DEEP,
        'editorOverviewRuler.border': '#00000000', 'editorOverviewRuler.background': bg,
        'editorStickyScroll.background': '#efece2' if paper else OLIVE[825],
        'editorStickyScrollHover.background': '#e9e5d8' if paper else OLIVE[750],
        'editorGhostText.foreground': '#8a826b' if paper else INK_500,
        'editorError.foreground': RED_DEEP, 'editorWarning.foreground': GOLD_DEEP if paper else GOLD,
        'editorInfo.foreground': '#3f6f82' if paper else '#9cc2dc',
        'editorLightBulb.foreground': GOLD_DEEP,
        'editorUnnecessaryCode.opacity': '#00000088',
        'diffEditor.insertedTextBackground': GREEN_LIGHT + '38', 'diffEditor.removedTextBackground': RED + '38',
        'diffEditor.insertedLineBackground': GREEN_LIGHT + '1f', 'diffEditor.removedLineBackground': RED + '1f',
        'diffEditorGutter.insertedLineBackground': GREEN_LIGHT + '38',
        'diffEditorGutter.removedLineBackground': RED + '38',
        'peekViewEditor.background': '#efece2' if paper else OLIVE[825],
        'peekViewEditorGutter.background': '#efece2' if paper else OLIVE[825],
        'peekViewEditor.matchHighlightBackground': GOLD + '40',
        'breadcrumb.background': bg, 'breadcrumb.foreground': INK_500,
        'breadcrumb.focusForeground': fg, 'breadcrumb.activeSelectionForeground': fg,
        # The active tab is cut from the same page.
        'tab.activeBackground': bg, 'tab.activeForeground': fg,
        'tab.unfocusedActiveBackground': bg,
        'tab.unfocusedActiveForeground': INK_700 if paper else INK_300,
    }


def tokens(paper: bool) -> list:
    c = ({'comment': '#6e6857', 'keyword': '#8a4a14', 'string': '#4a6630', 'number': '#9a3b24',
          'function': '#2d5470', 'type': '#256059', 'punct': '#5d6356', 'attr': '#6b5a1e', 'text': INK}
         if paper else
         {'comment': '#8a917f', 'keyword': '#e8bd6c', 'string': '#aac38f', 'number': '#e39a84',
          'function': '#9cc2dc', 'type': '#8ccabf', 'punct': '#a4aa9c', 'attr': '#d9c28a', 'text': '#e9e6da'})
    rule = lambda scope, color, style=None: {'scope': scope, 'settings': {'foreground': color, **({'fontStyle': style} if style else {})}}
    return [
        rule(['comment', 'punctuation.definition.comment', 'string.comment'], c['comment'], 'italic'),
        rule(['keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.control', 'keyword.operator.new',
              'keyword.operator.expression', 'variable.language.this', 'variable.language.self'], c['keyword']),
        rule(['keyword.operator', 'punctuation', 'meta.brace', 'punctuation.separator', 'punctuation.terminator'], c['punct']),
        rule(['string', 'string.template', 'punctuation.definition.string', 'string.regexp', 'markup.inline.raw'], c['string']),
        rule(['constant.numeric', 'constant.language', 'constant.character', 'constant.other', 'support.constant'], c['number']),
        rule(['entity.name.function', 'support.function', 'meta.function-call entity.name.function'], c['function']),
        rule(['entity.name.type', 'entity.name.class', 'entity.other.inherited-class', 'support.type', 'support.class',
              'entity.name.namespace', 'storage.type.primitive'], c['type']),
        rule(['variable', 'variable.parameter', 'variable.other', 'meta.definition.variable', 'support.variable'], c['text']),
        rule(['entity.name.tag', 'meta.tag.sgml'], c['keyword']),
        rule(['entity.other.attribute-name', 'support.type.property-name', 'meta.object-literal.key'], c['attr']),
        rule(['markup.heading', 'entity.name.section'], c['text'], 'bold'),
        rule(['markup.bold'], c['text'], 'bold'),
        rule(['markup.italic'], c['text'], 'italic'),
        rule(['markup.underline.link', 'string.other.link'], c['keyword']),
        rule(['markup.quote'], c['comment'], 'italic'),
        rule(['markup.list punctuation.definition.list', 'punctuation.definition.heading'], c['keyword']),
        rule(['invalid', 'invalid.illegal'], RED_DEEP),
    ]


def semantic(paper: bool) -> dict:
    return {'parameter': INK_700 if paper else '#cfcdbf', 'property.declaration': INK if paper else '#e9e6da'}


def theme(name: str, paper: bool) -> dict:
    return {
        '$schema': 'vscode://schemas/color-theme',
        'name': name,
        'type': 'dark',
        'semanticHighlighting': True,
        'colors': {**chrome(), **page(paper)},
        'tokenColors': tokens(paper),
        'semanticTokenColors': semantic(paper),
    }


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for file, name, paper in (('paper-color-theme.json', 'my_editor Paper', True),
                              ('night-color-theme.json', 'my_editor Night', False)):
        (OUT / file).write_text(json.dumps(theme(name, paper), indent='\t') + '\n')
        print('wrote', OUT / file)
