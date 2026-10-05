"""Style-preserving plist writer: unchanged content round-trips byte for byte."""

from __future__ import annotations

from fontTools.misc import plistlib

from gcweb.plist_style import PlistStyle

APPLE_STYLE = b"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
\t<dict>
\t\t<key>public.kern1.O</key>
\t\t<array>
\t\t\t<string>O</string>
\t\t\t<string>D</string>
\t\t</array>
\t\t<key>public.kern1.A</key>
\t\t<array/>
\t</dict>
</plist>
"""

FONTTOOLS_STYLE = b"""<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>A</key>
  <dict>
    <key>V</key>
    <integer>-50</integer>
    <key>W</key>
    <real>-12.5</real>
  </dict>
</dict>
</plist>
"""


def roundtrip(data: bytes) -> bytes:
    return PlistStyle.from_bytes(data).dumps(plistlib.loads(data))


def test_unchanged_roundtrip_is_identical():
    assert roundtrip(APPLE_STYLE) == APPLE_STYLE
    assert roundtrip(FONTTOOLS_STYLE) == FONTTOOLS_STYLE


def test_crlf_is_kept():
    data = APPLE_STYLE.replace(b"\n", b"\r\n")
    assert roundtrip(data) == data


def test_unsorted_level_appends_new_keys_and_keeps_order():
    style = PlistStyle.from_bytes(APPLE_STYLE)
    obj = plistlib.loads(APPLE_STYLE)
    obj["public.kern1.B"] = ["B"]
    keys = list(plistlib.loads(style.dumps(obj)).keys())
    assert keys == ["public.kern1.O", "public.kern1.A", "public.kern1.B"]


def test_sorted_level_inserts_in_order():
    style = PlistStyle.from_bytes(FONTTOOLS_STYLE)
    obj = plistlib.loads(FONTTOOLS_STYLE)
    obj["A"]["T"] = -30
    assert list(plistlib.loads(style.dumps(obj))["A"].keys()) == ["T", "V", "W"]


def test_escaping():
    style = PlistStyle()
    out = plistlib.loads(style.dumps({"a&b": ["<x>"]}))
    assert out == {"a&b": ["<x>"]}


def test_no_original_file_uses_default_style():
    out = PlistStyle.from_bytes(None).dumps({"public.kern1.A": ["A"]})
    assert out.startswith(b'<?xml version="1.0" encoding="UTF-8"?>\n')
    assert b"\t<key>public.kern1.A</key>" in out
