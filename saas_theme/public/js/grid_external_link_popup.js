/*
 * SaaS Theme — External Link menus over a native Frappe GridRowForm popover.
 *
 * Frappe v16/third-party Link pickers can create search/menu DOM outside
 * their input. A browser top-layer GridRowForm always paints ABOVE those
 * ordinary DOM menus, regardless of z-index (verified in Chromium).
 *
 * Keep the native input, editor, menu, handlers and values in place. When
 * an expanded child-row Link is active, temporarily promote only a
 * geometrically related, visible NON-Awesomplete popup to a second manual
 * popover in the browser top layer. The existing overlay_link_suggestions
 * controller remains the sole owner of Awesomplete ULs and modal popups.
 *
 * On close/navigation/dialog: restore original popover attribute and style.
 */
(() => {
	"use strict";
	if (window.__stGridExternalLinkPopup) return;
	window.__stGridExternalLinkPopup = true;

	const EDITOR = ".form-in-grid.st-v7-grid-editor:popover-open";
	const FIELD = '.frappe-control[data-fieldtype="Link"], ' +
		'.frappe-control[data-fieldtype="Dynamic Link"], ' +
		'.frappe-control[data-fieldtype="Autocomplete"]';
	const CANDIDATES = [
		".link-dropdown", ".link-dropdown-menu", ".link-suggestions",
		".link-search-dropdown", ".link-search-results", ".autocomplete-results",
		".ui-autocomplete", ".es-popover", ".dropdown-menu.show",
		'[role="listbox"]', '[data-popper-placement]'
	].join(", ");
	const POPUP_ROOT = [
		".link-dropdown", ".link-dropdown-menu", ".link-suggestions",
		".link-search-dropdown", ".link-search-results", ".autocomplete-results",
		".ui-autocomplete", ".es-popover", ".dropdown-menu.show",
		'[data-popper-placement]'
	].join(", ");
	const ACTIVE_CLASS = "st-grid-external-link-popup";
	const active = new Map();
	let focusedLink = null;
	let raf = 0;
	let observer = null;

	function isLink(input) {
		return input instanceof HTMLInputElement &&
			input.isConnected &&
			(input.closest(FIELD) ||
				(input.hasAttribute("data-target") && input.closest(".link-field")));
	}

	function editorFor(input) {
		return input?.closest?.(EDITOR) || null;
	}

	function visible(node) {
		if (!node?.isConnected || node.hasAttribute("hidden") ||
			node.classList.contains("hide")) return false;
		const style = window.getComputedStyle(node);
		if (style.visibility === "hidden" || style.display === "none") return false;
		const rect = node.getBoundingClientRect();
		return rect.width > 4 && rect.height > 4;
	}

	function menuRoot(node) {
		const knownRoot = node.closest(POPUP_ROOT);
		if (knownRoot) return knownRoot;
		// Some modern Link pickers wrap the listbox together with an
		// embedded "Search Item…" input and footer. Promote the whole card,
		// not just its options, so search/filter controls stay accessible.
		const parent = node.parentElement;
		if (parent && parent !== document.body &&
			!parent.matches(".awesomplete, .form-in-grid, .frappe-control") &&
			parent.querySelector('input[type="search"], input[placeholder*="Search"], input[placeholder*="search"]')) {
			return parent;
		}
		return node;
	}

	function isOwnedPopup(node, input) {
		if (!node || node === input || node.closest(".modal.show") ||
			node.classList.contains("st-overlay-link-suggestions") ||
			node.classList.contains("st-v7-inline-grid-popup") ||
			node.matches(".awesomplete > ul, .awesomplete > [role='listbox']") ||
			node.closest(".st-overlay-link-suggestions")) return false;
		if (!visible(node)) return false;

		const ownedId = input.getAttribute("aria-controls") ||
			input.getAttribute("aria-owns");
		const controlled = ownedId && document.getElementById(ownedId);
		if (controlled && (node === controlled || node.contains(controlled))) return true;

		const inputRect = input.getBoundingClientRect();
		const rect = node.getBoundingClientRect();
		// An active Item dropdown must be near the field, not an arbitrary
		// page list, sidebar menu or background dropdown.
		const overlap = Math.min(rect.right, inputRect.right) -
			Math.max(rect.left, inputRect.left);
		const nearVertical = Math.min(
			Math.abs(rect.top - inputRect.bottom),
			Math.abs(inputRect.top - rect.bottom)
		);
		return overlap > Math.min(48, inputRect.width * 0.2) &&
			nearVertical < 110 && rect.height < window.innerHeight * 0.85;
	}

	function position(node, meta) {
		if (!meta.input?.isConnected || !visible(node)) return;
		const inputRect = meta.input.getBoundingClientRect();
		const before = meta.initial;
		const w = document.documentElement.clientWidth || window.innerWidth;
		const h = document.documentElement.clientHeight || window.innerHeight;
		const edge = 9;
		const width = Math.min(
			Math.max(inputRect.width, Math.min(before.width, 470)), w - edge * 2
		);
		const left = Math.max(edge, Math.min(inputRect.left, w - width - edge));
		const availableBelow = h - inputRect.bottom - edge * 2;
		const above = inputRect.top - edge * 2;
		const flip = availableBelow < 160 && above > availableBelow;
		const maxHeight = Math.max(90, Math.min(320, flip ? above : availableBelow));
		const top = flip
			? Math.max(edge, inputRect.top - Math.min(before.height, maxHeight) - 4)
			: Math.min(h - edge, inputRect.bottom + 4);
		for (const [prop, value] of Object.entries({
			position: "fixed", left: Math.round(left) + "px",
			top: Math.round(top) + "px", right: "auto", bottom: "auto",
			width: Math.round(width) + "px", "max-width": Math.round(width) + "px",
			"max-height": Math.round(maxHeight) + "px",
			margin: "0", transform: "none", translate: "none",
			"z-index": "15040"
		})) node.style.setProperty(prop, value, "important");
	}

	function restore(node) {
		const meta = active.get(node);
		if (!meta) return;
		active.delete(node);
		try {
			if (node.matches(":popover-open")) node.hidePopover();
		} catch (_) { /* Native picker may have already removed the node. */ }
		if (meta.popover == null) node.removeAttribute("popover");
		else node.setAttribute("popover", meta.popover);
		node.classList.remove(ACTIVE_CLASS);
		if (meta.style == null) node.removeAttribute("style");
		else node.setAttribute("style", meta.style);
	}

	function restoreAll() {
		for (const node of Array.from(active.keys())) restore(node);
		focusedLink = null;
	}

	function promote(node, input) {
		if (active.has(node)) {
			position(node, active.get(node));
			return;
		}
		if (!node.isConnected || typeof node.showPopover !== "function" ||
			typeof node.hidePopover !== "function" || node.matches(":popover-open"))
			return;
		const original = node.getBoundingClientRect();
		const meta = {
			input, style: node.getAttribute("style"),
			popover: node.getAttribute("popover"),
			initial: { width: original.width, height: original.height }
		};
		node.setAttribute("popover", "manual");
		try {
			node.showPopover();
		} catch (_) {
			if (meta.popover == null) node.removeAttribute("popover");
			else node.setAttribute("popover", meta.popover);
			return;
		}
		active.set(node, meta);
		node.classList.add(ACTIVE_CLASS);
		position(node, meta);
	}

	function scan() {
		raf = 0;
		// A real Bootstrap Link Selector should win over the row editor.
		if (document.querySelector(".modal.show:not(:has(.navbar-modal-wrapper))")) {
			restoreAll();
			return;
		}
		const focus = document.activeElement;
		if (isLink(focus) && editorFor(focus)) focusedLink = focus;
		const input = focusedLink;
		if (!input?.isConnected || !editorFor(input)) {
			restoreAll();
			return;
		}

		for (const [node, meta] of Array.from(active.entries())) {
			const popupHasFocus = node.contains(focus);
			if (!visible(node) || (!popupHasFocus && !isOwnedPopup(node, meta.input))) {
				restore(node);
			} else position(node, meta);
		}

		// Do not turn arbitrary menus elsewhere on the page into popovers.
		// A picker must be visibly aligned with this precise Item Link.
		const seen = new Set();
		for (const candidate of document.querySelectorAll(CANDIDATES)) {
			const popup = menuRoot(candidate);
			if (seen.has(popup) || popup.closest(".modal.show")) continue;
			seen.add(popup);
			if (isOwnedPopup(popup, input)) promote(popup, input);
		}
	}

	function schedule() {
		if (!raf) raf = requestAnimationFrame(scan);
	}

	document.addEventListener("focusin", event => {
		if (isLink(event.target) && editorFor(event.target)) {
			focusedLink = event.target;
			schedule();
		} else if (active.size && !Array.from(active.keys()).some(
			node => node.contains(event.target)
		) && !editorFor(event.target)) {
			restoreAll();
		}
	}, true);
	document.addEventListener("input", event => {
		if (event.target === focusedLink || active.size) schedule();
	}, true);
	document.addEventListener("awesomplete-open", schedule, true);
	document.addEventListener("awesomplete-close", schedule, true);
	window.addEventListener("resize", schedule, { passive: true });
	window.addEventListener("scroll", () => { if (active.size) schedule(); },
		{ capture: true, passive: true });

	function observe() {
		if (observer || !document.body || !window.MutationObserver) return;
		observer = new MutationObserver(records => {
			if (!focusedLink && !active.size) return;
			if (records.some(record => {
				if (record.type === "attributes")
					return record.attributeName === "hidden" ||
						(record.attributeName === "class" &&
							!record.target?.classList?.contains(ACTIVE_CLASS));
				return record.addedNodes.length || record.removedNodes.length;
			})) schedule();
		});
		observer.observe(document.body, {
			subtree: true, childList: true, attributes: true,
			attributeFilter: ["class", "hidden"]
		});
	}

	if (typeof window.$ === "function") {
		$(document).on("page-change.st_grid_link_popup", restoreAll);
	}
	window.addEventListener("pagehide", restoreAll);
	if (document.readyState === "loading")
		document.addEventListener("DOMContentLoaded", observe, { once: true });
	else observe();

	window.saas_theme = window.saas_theme || {};
	window.saas_theme.grid_link_popup_diagnostics = () => ({
		visible_external_menus: active.size,
		native_editor_open: Boolean(document.querySelector(EDITOR))
	});
})();
