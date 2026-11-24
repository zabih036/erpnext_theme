/*
 * SaaS Theme — Desk tab identity and active Sidebar icon (Frappe v16)
 *
 * Frappe's desk.js installs its own favicon at startup. With the native Dock
 * deliberately disabled by this theme, SidebarHeader.get_header_logo() can
 * also display the app logo rather than the selected Sidebar's icon.
 *
 * Work with the existing Frappe/ERPNext data and markup, never patch its
 * navigation, title cache, Sidebar or login handlers.
 */
(function () {
	"use strict";

	if (typeof window === "undefined" || !window.frappe) return;
	if (window.__st_desk_identity__) return;
	window.__st_desk_identity__ = true;

	const state = {
		company: "",
		iconUrl: "",
		headerNode: null,
		headerObserver: null,
		headObserver: null,
		brandingPromise: null,
		pendingSidebar: null,
		pendingHead: null,
	};

	function normalize(value) {
		return String(value || "").trim().toLocaleLowerCase();
	}

	/* Company Logo may reference a public Frappe File, a public /assets/
	   resource or a HTTPS image. Never turn private File URLs into public
	   browser requests. Relative and HTTP URLs must stay on this site. */
	function safeLogoUrl(raw) {
		if (!raw || typeof raw !== "string") return "";
		const value = raw.trim();
		if (!value || /^(?:data|javascript|blob|file):/i.test(value)) return "";
		try {
			const url = new URL(value, window.location.href);
			if (!["http:", "https:"].includes(url.protocol)) return "";
			if (url.protocol !== "https:" && url.origin !== window.location.origin) return "";
			if (/^\/private\//i.test(url.pathname) || /\/(?:private\/files|private\/backups)\//i.test(url.pathname)) return "";
			return url.href;
		} catch (_) {
			return "";
		}
	}

	function monogramFavicon(name) {
		const first = String(name || "P").trim().charAt(0).toUpperCase() || "P";
		const letter = first.replace(/&/g, "&amp;").replace(/</g, "&lt;")
			.replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
			+ '<rect width="64" height="64" rx="15" fill="#006b74"/>'
			+ '<path d="M0 51c18-20 31-15 64-40v53H0z" fill="#00434e" opacity=".5"/>'
			+ '<text x="32" y="44" font-family="Arial, sans-serif" font-size="37" font-weight="750" text-anchor="middle" fill="white">'
			+ letter + '</text></svg>';
		return "data:image/svg+xml," + encodeURIComponent(svg);
	}

	function setFavicon(url) {
		if (!url || !document.head) return;
		state.iconUrl = url;
		const mime = /^data:image\/svg\+xml/i.test(url) || /\.svg(?:[?#]|$)/i.test(url)
			? "image/svg+xml" : /\.ico(?:[?#]|$)/i.test(url) ? "image/x-icon"
			: /\.png(?:[?#]|$)/i.test(url) ? "image/png" : "";
		const existing = Array.from(document.head.querySelectorAll('link[rel~="icon"]'));
		if (!existing.length) {
			const link = document.createElement("link");
			link.rel = "icon";
			document.head.appendChild(link);
			existing.push(link);
		}
		existing.forEach((link) => {
			if (link.getAttribute("href") !== url) link.setAttribute("href", url);
			if (mime && link.getAttribute("type") !== mime) link.setAttribute("type", mime);
			if (!mime && link.hasAttribute("type")) link.removeAttribute("type");
		});
	}

	function syncTabTitle() {
		const company = state.company;
		if (!company) return;
		const suffix = " · " + company;
		let current = String(document.title || "").trim();
		if (!current || current === company || current.endsWith(suffix)) return;
		// Keep Frappe's page title (e.g. Accounts Dashboard). Only replace
		// its generic branding suffix, if present.
		current = current.replace(/\s+[-|·]\s+Frappe(?: Framework)?$/i, "").trim();
		document.title = current + suffix;
	}

	function syncHead() {
		syncTabTitle();
		if (state.iconUrl) setFavicon(state.iconUrl);
	}

	function queueHead() {
		if (state.pendingHead != null) return;
		state.pendingHead = setTimeout(() => {
			state.pendingHead = null;
			syncHead();
		}, 0);
	}

	function startHeadObserver() {
		if (state.headObserver || !document.head || typeof MutationObserver !== "function") return;
		state.headObserver = new MutationObserver((records) => {
			if (records.some((record) =>
				record.target?.nodeName === "TITLE" ||
				(record.type === "characterData" && record.target?.parentNode?.nodeName === "TITLE") ||
				record.target?.nodeName === "LINK" ||
				Array.from(record.addedNodes || []).some((node) =>
					node.nodeName === "TITLE" || node.nodeName === "LINK"
				)
			)) queueHead();
		});
		state.headObserver.observe(document.head, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: ["href"],
		});
	}

	async function loadImage(url) {
		if (!url) return false;
		if (typeof Image === "undefined") return false;
		return new Promise((resolve) => {
			const image = new Image();
			image.onload = () => resolve(true);
			image.onerror = () => resolve(false);
			image.src = url;
		});
	}

	async function loadBranding() {
		if (state.brandingPromise) return state.brandingPromise;
		state.brandingPromise = (async () => {
			let company = "";
			let logo = "";
			try {
				const response = await frappe.call({
					method: "saas_theme.branding.get_company_branding",
					type: "GET",
				});
				company = String(response?.message?.company || "").trim();
				logo = safeLogoUrl(response?.message?.company_logo);
			} catch (_) {
				// Brand lookup is optional. Never prevent Desk startup.
			}

			const fallback = String(frappe.boot?.sysdefaults?.company || "").trim();
			state.company = company || fallback;
			const siteLogo = safeLogoUrl(frappe.boot?.navbar_settings?.app_logo);
			const candidate = logo || (
				/\/assets\/frappe\/(?:images\/|.*favicon)/i.test(siteLogo) ? "" : siteLogo
			);
			const fallbackName = state.company || String(frappe.boot?.app_name || "Production");
			state.iconUrl = candidate && await loadImage(candidate)
				? candidate
				: monogramFavicon(fallbackName);
			syncHead();
			return state;
		})();
		return state.brandingPromise;
	}

	function currentSidebarIcon() {
		const sidebar = frappe.app?.sidebar;
		if (!sidebar) return "";
		const moduleName = String(sidebar.current_module || sidebar.sidebar_title || "").trim();
		const sideName = String(sidebar.sidebar_data?.label || sidebar.sidebar_title || moduleName).trim();
		if (!moduleName && !sideName) return "";

		// Reuse the EXACT icon displayed in the selected custom Workspace
		// rail when available, rather than inferring a different app logo.
		const selected = document.querySelector(".st-workspace-rail .st-rail-item.active");
		const selectedName = String(selected?.dataset?.workspace || "").trim();
		const selectedMark = selected?.querySelector?.(".st-rail-icon");
		if (selectedMark && selectedMark.innerHTML && (
			normalize(selectedName) === normalize(sideName) ||
			normalize(selectedName) === normalize(moduleName)
		)) return selectedMark.innerHTML;

		const custom = frappe.boot?.workspace_sidebar_item || {};
		const moduleData = frappe.boot?.module_sidebars?.[moduleName] || {};
		const configured = custom[normalize(sideName)] || custom[normalize(moduleName)] || {};
		const name = configured.header_icon || sidebar.sidebar_data?.header_icon ||
			moduleData.header_icon || frappe.get_module_icon?.(moduleName);
		if (typeof name === "string" && name && typeof frappe.utils?.icon === "function") {
			try {
				const icon = frappe.utils.icon(name, "md", "", "", "", true);
				if (icon) return icon;
			} catch (_) {
				// An invalid custom icon must not break the page header.
			}
		}
		// Match the Sidebar rail's own letter fallback when no icon has been
		// configured. Never leave the previous app's logo in the active header.
		const initial = String(sideName || moduleName).charAt(0).toUpperCase()
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
		return '<span class="st-sidebar-workspace-initial" aria-hidden="true">' + initial + '</span>';
	}

	function bindHeaderObserver(node) {
		if (state.headerNode === node) return;
		state.headerObserver?.disconnect();
		state.headerNode = node;
		state.headerObserver = null;
		if (node && typeof MutationObserver === "function") {
			state.headerObserver = new MutationObserver(() => queueSidebar());
			state.headerObserver.observe(node, { childList: true });
		}
	}

	function syncSidebarIcon() {
		const node = document.querySelector(".body-sidebar .sidebar-header .header-logo");
		bindHeaderObserver(node);
		if (!node) return;
		const icon = currentSidebarIcon();
		if (!icon) return;
		if (node.innerHTML !== icon) node.innerHTML = icon;
		node.closest(".sidebar-header")?.classList.add("st-sidebar-selected-icon");
	}

	function queueSidebar() {
		if (state.pendingSidebar != null) return;
		state.pendingSidebar = setTimeout(() => {
			state.pendingSidebar = null;
			syncSidebarIcon();
		}, 35);
	}

	function start() {
		startHeadObserver();
		// Replace Frappe's startup favicon immediately, before the optional
		// company-branding request finishes. A valid public logo wins later.
		setFavicon(monogramFavicon(
			frappe.boot?.sysdefaults?.company || frappe.boot?.app_name || "Production"
		));
		loadBranding();
		syncSidebarIcon();

		// Frappe re-renders the header when changing module/page; update
		// after its native SidebarHeader.refresh() has finished.
		if (typeof window.$ === "function") {
			$(document).on(
				"sidebar_setup.st_desk_identity page-change.st_desk_identity " +
				"desktop_screen.st_desk_identity toolbar_setup.st_desk_identity",
				queueSidebar
			);
			if (typeof frappe.after_ajax === "function") frappe.after_ajax(queueSidebar);
		}
		window.addEventListener("pageshow", () => {
			syncHead();
			queueSidebar();
		});
	}

	window.saasThemeDeskIdentity = {
		syncHead, syncSidebarIcon, currentSidebarIcon, safeLogoUrl, monogramFavicon,
	};
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", start, { once: true });
	} else {
		start();
	}
})();
