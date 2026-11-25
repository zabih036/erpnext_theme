#!/usr/bin/env python3
"""Frappe v16 /desk initial title and favicon regression without a database.

Unlike an app_include_js-only check, this executes the actual server hook:
the first HTML response must be Company branded before Desk JavaScript loads.
"""
from __future__ import annotations

import ast
import importlib.util
from pathlib import Path
import sys
import types
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
HOOKS = ROOT / "saas_theme" / "hooks.py"

frappe = types.ModuleType("frappe")
frappe.whitelist = lambda **kwargs: (lambda fn: fn)
frappe.session = types.SimpleNamespace(user="staff@example.test")
frappe.local = types.SimpleNamespace(path="desk/buying/purchase-invoice/ACC-PINV-2026-00001")
frappe.request = types.SimpleNamespace(path="/desk/buying/purchase-invoice/ACC-PINV-2026-00001")
current = {"company": "Production Company", "logo": "/files/company-logo.png"}
frappe.db = types.SimpleNamespace(
    get_single_value=lambda doctype, field: current["company"],
    get_value=lambda doctype, name, field: current["logo"],
)
defaults = types.ModuleType("frappe.defaults")
defaults.get_user_default = lambda name: current["company"] if name == "Company" else None
sys.modules["frappe"] = frappe
sys.modules["frappe.defaults"] = defaults
spec = importlib.util.spec_from_file_location(
    "saas_theme_branding_test", ROOT / "saas_theme" / "branding.py"
)
branding = importlib.util.module_from_spec(spec)
spec.loader.exec_module(branding)

assert branding.get_company_branding() == {
    "company": "Production Company",
    "company_logo": "/files/company-logo.png",
}
old_frappe = "/assets/frappe/images/frappe-favicon.svg"
context = {"app_name": "Frappe", "favicon": old_frappe}
branding.update_desk_branding_context(context)
assert context["app_name"] == "Production Company"
assert context["favicon"] == "/files/company-logo.png"

# Untrusted/private Company files must never be requested on the Desk tab.
current["logo"] = "/private/files/company-logo.png"
context = {"app_name": "Frappe", "favicon": old_frappe}
branding.update_desk_branding_context(context)
assert context["favicon"].startswith("data:image/svg+xml,")
assert "<svg " in unquote(context["favicon"])
assert "Frappe" not in context["app_name"]

# Use an intentional Website favicon if Company has no public logo.
context = {"app_name": "Frappe", "favicon": "/files/site-favicon.png"}
branding.update_desk_branding_context(context)
assert context["favicon"] == "/files/site-favicon.png"

for unsafe in (
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///tmp/private",
    "/private/files/secret.png",
    "https://cdn.example.test/private/files/secret.png",
    "//other.example.test/logo.png",
):
    assert branding._safe_public_brand_image(unsafe) is None
assert branding._safe_public_brand_image("https://cdn.example.test/logo.png")
assert branding._safe_public_brand_image("/files/site-logo.png")

# The website-context hook MUST leave login, print and public pages alone.
for route in ("login", "about", "printview", "api/method/login"):
    frappe.local.path = route
    context = {"app_name": "Frappe", "favicon": old_frappe}
    branding.update_desk_branding_context(context)
    assert context == {"app_name": "Frappe", "favicon": old_frappe}

# A Guest context must never leak authenticated company defaults.
frappe.local.path = "desk"
frappe.session.user = "Guest"
context = {"app_name": "Frappe", "favicon": old_frappe}
branding.update_desk_branding_context(context)
assert context["app_name"] == "Frappe"
frappe.session.user = "staff@example.test"

# Even without a selected company, never show "Frappe" on startup.
current.update(company=None, logo=None)
context = {"app_name": "Frappe", "favicon": None}
branding.update_desk_branding_context(context)
assert context["app_name"] == "Production ERP"
assert context["favicon"].startswith("data:image/svg+xml,")

hooks = ast.parse(HOOKS.read_text(encoding="utf8"))
declared = {}
for node in hooks.body:
    if isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name):
                if target.id in ("update_website_context", "app_include_css", "app_include_js"):
                    declared[target.id] = ast.literal_eval(node.value)

assert "saas_theme.branding.update_desk_branding_context" in declared["update_website_context"]
assert "/assets/saas_theme/js/desk_identity.js?v=2" in declared["app_include_js"]
assert "/assets/saas_theme/css/grid_editor_popover.css?v=2" in declared["app_include_css"]

print("Initial /desk HTML Company title/favicon, privacy, route scoping and asset registration passed.")
