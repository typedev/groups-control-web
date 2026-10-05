# Vendored from Font-Rover font_rover/groups_control/naming.py @ a052428 (Apache-2.0).
# Do not edit here: fix upstream, then run scripts/vendor_sync.py.
# Copyright 2024 Alexander Lubovenko
# Licensed under the Apache License, Version 2.0

"""
Group names for Groups Control: checking a name and finding a free one.

GTK-free. The window works with short names (what follows the side prefix,
``public.kern1.``) and stores full ones.
"""

from __future__ import annotations

from collections.abc import Container


def name_problem(short_name: str, prefix: str, groups: Container[str]) -> str | None:
    """Why a short name cannot become a new group, or None if it can."""
    if not short_name:
        return "The name is empty."
    if any(character.isspace() for character in short_name):
        return "A group name cannot contain spaces."
    if f"{prefix}{short_name}" in groups:
        return f"Group '{short_name}' already exists."
    return None


def free_name(short_name: str, prefix: str, groups: Container[str]) -> str:
    """The short name itself if free, else the first free ``name_2``, ``name_3``…"""
    if f"{prefix}{short_name}" not in groups:
        return short_name
    number = 2
    while f"{prefix}{short_name}_{number}" in groups:
        number += 1
    return f"{short_name}_{number}"
