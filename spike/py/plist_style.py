"""Style-preserving plist writer for groups.plist / kerning.plist (spike).

fontTools' plistlib always writes its own style: single-quoted XML
declaration, unindented root dict, sorted keys. A UFO saved by another editor
then becomes a whole-file diff after one edit. This writer copies the
original file's style instead:

- the header (XML declaration, DOCTYPE, `<plist>` line) and trailer verbatim;
- the root indent and the indent unit; the newline sequence;
- empty containers as `<array/>` or `<array></array>`, as the file uses them;
- key order: existing keys keep their original order at every level; new keys
  go to their sorted position if that level was sorted, else to the end.

Only the value types that appear in these two files are supported:
dict, list/tuple, str, int, float, bool.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from xml.sax.saxutils import escape

from fontTools.misc import plistlib


@dataclass
class PlistStyle:
    header: str = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
        '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0">\n'
    )
    trailer: str = "</plist>\n"
    base: str = ""
    unit: str = "\t"
    newline: str = "\n"
    self_closing_empty: bool = True
    # Original key order per path ("" = root, "<key>" = nested dict).
    order: dict[str, list[str]] = field(default_factory=dict)

    @classmethod
    def from_bytes(cls, data: bytes | None) -> "PlistStyle":
        if not data:
            return cls()
        text = data.decode("utf-8")
        newline = "\r\n" if "\r\n" in text else "\n"
        m = re.search(r"^([ \t]*)<dict>", text, re.M)
        if m is None:
            return cls(newline=newline)
        header = text[: m.start()]
        base = m.group(1)
        end = text.rfind("</dict>")
        trailer = text[end + len("</dict>") :].lstrip("\r\n")
        m_child = re.search(r"^([ \t]*)<key>", text[m.end() :], re.M)
        unit = m_child.group(1)[len(base) :] if m_child else "\t"
        self_closing = not re.search(r"<array>\s*</array>|<dict>\s*</dict>", text)
        order: dict[str, list[str]] = {}
        root = plistlib.loads(data)
        order[""] = list(root.keys())
        for key, value in root.items():
            if isinstance(value, dict):
                order[key] = list(value.keys())
        return cls(header, trailer, base, unit, newline, self_closing, order)

    # -- writing --------------------------------------------------------------

    def dumps(self, obj: dict) -> bytes:
        lines: list[str] = []
        self._write(obj, self.base, "", lines, top=True)
        nl = self.newline
        header = self.header.replace("\r\n", "\n").replace("\n", nl)
        trailer = self.trailer.replace("\r\n", "\n").replace("\n", nl)
        return (header + nl.join(lines) + nl + trailer).encode("utf-8")

    def _ordered_keys(self, d: dict, path: str) -> list[str]:
        orig = self.order.get(path)
        if orig is None:
            return sorted(d.keys())
        if orig == sorted(orig):
            return sorted(d.keys())
        present = set(d.keys())
        keys = [k for k in orig if k in present]
        known = set(keys)
        keys += sorted(k for k in d.keys() if k not in known)
        return keys

    def _write(self, value, indent: str, path: str, lines: list[str], top=False):
        inner = indent + self.unit
        if isinstance(value, dict):
            if not value and self.self_closing_empty:
                lines.append(f"{indent}<dict/>")
                return
            lines.append(f"{indent}<dict>")
            for key in self._ordered_keys(value, path):
                lines.append(f"{inner}<key>{escape(key)}</key>")
                self._write(value[key], inner, key if top else path, lines)
            lines.append(f"{indent}</dict>")
        elif isinstance(value, (list, tuple)):
            if not value and self.self_closing_empty:
                lines.append(f"{indent}<array/>")
                return
            lines.append(f"{indent}<array>")
            for item in value:
                self._write(item, inner, path, lines)
            lines.append(f"{indent}</array>")
        elif isinstance(value, bool):
            lines.append(f"{indent}<{'true' if value else 'false'}/>")
        elif isinstance(value, int):
            lines.append(f"{indent}<integer>{value}</integer>")
        elif isinstance(value, float):
            lines.append(f"{indent}<real>{repr(value)}</real>")
        elif isinstance(value, str):
            lines.append(f"{indent}<string>{escape(value)}</string>")
        else:
            raise TypeError(f"unsupported plist value {value!r}")
