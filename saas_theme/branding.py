import frappe
from frappe.defaults import get_user_default


@frappe.whitelist(allow_guest=True)
def get_company_branding():
    """Return safe company branding for Desk and the public login screen."""

    company = None

    if frappe.session.user != "Guest":
        company = get_user_default("Company")

    company = company or frappe.db.get_single_value(
        "Global Defaults", "default_company"
    )

    if not company:
        return {"company": None, "company_logo": None}

    return {
        "company": company,
        "company_logo": frappe.db.get_value("Company", company, "company_logo"),
    }


# Frappe v16's /desk HTML comes from frappe/www/desk.html. Its initial
# <title> and favicon are rendered *before* any app_include_js controller
# runs. The Desk-only website-context hook below changes that first response
# to the logged-in user's default Company, eliminating the Frappe loading tab.
from html import escape
from urllib.parse import quote, urlsplit


def _safe_public_brand_image(raw):
    """Only return an image that an authenticated Desk page can load safely."""
    if not isinstance(raw, str):
        return None
    value = raw.strip()
    if not value or value.startswith(("//", "\\\\", "\\")):
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme:
            if parsed.scheme.lower() != "https" or not parsed.netloc:
                return None
        elif not value.startswith("/"):
            return None
        path = parsed.path.lower()
        if path.startswith("/private/") or "/private/files/" in path:
            return None
        if path.startswith("/assets/frappe/") and "favicon" in path:
            return None
        return value
    except ValueError:
        return None


def _monogram_favicon(company):
    """Local, self-contained favicon; never share a font or private file."""
    initial = escape((str(company or "P").strip()[:1] or "P").upper(), quote=True)
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        '<rect width="64" height="64" rx="14" fill="#006b74"/>'
        '<path d="M0 49 64 14v50H0z" fill="#00434e" opacity=".38"/>'
        f'<text x="32" y="43" text-anchor="middle" fill="#fff" '
        f'font-size="36" font-weight="700" font-family="Arial,sans-serif">{initial}</text>'
        '</svg>'
    )
    return "data:image/svg+xml," + quote(svg, safe="")


def update_desk_branding_context(context):
    """Set the first-byte Desk tab title/icon, not just the late JS version.

    This is intentionally NOT a website-wide override. Public login, print,
    web forms and other website pages keep their own branding/security.
    Frappe's TemplatePage executes update_website_context *after*
    frappe/www/desk.py has populated context.app_name and favicon.
    """
    path = str(
        getattr(frappe.local, "path", None)
        or getattr(getattr(frappe, "request", None), "path", "")
        or ""
    ).strip("/").split("?", 1)[0].lower()
    if path not in ("desk", "app") and not path.startswith(("desk/", "app/")):
        return
    if frappe.session.user == "Guest":
        return

    try:
        branding = get_company_branding() or {}
    except Exception:
        branding = {}

    company = str(
        branding.get("company")
        or context.get("app_name")
        or "Production ERP"
    ).strip()
    if not company or company.casefold() in ("frappe", "frappe framework"):
        company = "Production ERP"

    logo = _safe_public_brand_image(branding.get("company_logo"))
    # A configured non-Frappe Website favicon is still useful when a company
    # does not have a public Company Logo yet.
    fallback = _safe_public_brand_image(context.get("favicon"))
    context["app_name"] = company
    context["favicon"] = logo or fallback or _monogram_favicon(company)
