#!/usr/bin/env python3
"""Regression guard for child editor positioning and Link options."""
import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
css = (ROOT / "saas_theme/public/css/grid_editor_popover.css").read_text()
hooks = ast.parse((ROOT / "saas_theme/hooks.py").read_text())
assets = {}
for node in hooks.body:
    if isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id in ("app_include_css", "app_include_js"):
                assets[target.id] = ast.literal_eval(node.value)

selector = "body .grid-row.grid-row-open > .form-in-grid.st-v7-grid-editor:popover-open"
assert selector + " {" in css
rule = css.split(selector + " {", 1)[1].split("}", 1)[0]
assert re.search(r"\bleft:\s*50%\s*!important", rule)
assert "right: auto !important;" in rule
assert "transform: translateX(-50%) !important;" in rule
assert "width: min(1180px, calc(100vw - 32px)) !important;" in rule
assert not re.search(r"\binset(?:-inline(?:-start|-end)?)?\s*:", rule), (
    "Logical inset overrides physical left:50% and shifts the editor off-screen"
)

for token in (
    ".awesomplete > ul.st-overlay-link-suggestions:popover-open",
    ".link-field .link-btn:not([style*=\"display\"])",
    '.link-field .link-btn[style*="display: none"]',
    '.link-field .link-btn > a[style*="display: none"]',
    ".form-section:has(> .section-head.collapsible) {",
    "box-shadow: none !important;",
    "overflow: visible !important;",
    "@media (max-width: 767px)",
):
    assert token in css, token
assert "/assets/saas_theme/css/grid_editor_popover.css?v=2" in assets["app_include_css"]
assert "/assets/saas_theme/js/desk_identity.js?v=2" in assets["app_include_js"]
assert assets["app_include_js"].index(
    "/assets/saas_theme/js/interaction_finish_v2.js?v=12"
) < assets["app_include_js"].index(
    "/assets/saas_theme/js/overlay_link_suggestions.js?v=3"
)
print("Centered editor, Item Link controls, card styling, and native popup ownership passed.")
