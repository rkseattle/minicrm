# Bundled fonts

## NotoSansCJK-Regular.otf

Fallback font used by `pdfExportService.ts` to render non-Latin (CJK) content in PDF
exports — pdfkit's built-in Standard 14 fonts (Helvetica etc.) have no glyphs for
Chinese/Japanese/Korean scripts, which otherwise render as mojibake. (MINCRM-654)

Subsetted from Google's official Noto Sans CJK Simplified Chinese release, which
shares a common glyph set across all CJK Unified Ideographs, Hiragana, Katakana, and
Hangul Syllables (verified via `getBestCmap()` — Hangul U+AC00 is present in the SC
variant).

License: SIL Open Font License 1.1 — see `NotoSansCJK-LICENSE.txt` in this directory.

### Regenerating

```bash
python3 -m venv /tmp/fontenv && source /tmp/fontenv/bin/activate
pip install fonttools brotli

curl -L -o NotoSansCJKsc-Regular.otf \
  https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf

pyftsubset NotoSansCJKsc-Regular.otf \
  --output-file=NotoSansCJK-Regular.otf \
  --unicodes="U+0020-007E,U+00A0-00FF,U+3000-303F,U+3040-309F,U+30A0-30FF,U+FF00-FFEF,U+4E00-9FFF,U+AC00-D7A3" \
  --layout-features='*' \
  --glyph-names --symbol-cmap --legacy-cmap \
  --notdef-glyph --notdef-outline --recommended-glyphs \
  --name-IDs='*' --name-legacy --name-languages='*'
```

Covers: Basic Latin, Latin-1 Supplement, CJK Symbols/Punctuation, Hiragana, Katakana,
Halfwidth/Fullwidth Forms, CJK Unified Ideographs (common block), Hangul Syllables.
Excludes rarer CJK Extension A–G ideographs to keep the bundled file size reasonable
(~12MB vs. ~16MB unsubsetted).
