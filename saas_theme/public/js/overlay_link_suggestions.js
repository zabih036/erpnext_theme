/*
 * Restore Link suggestions in Frappe v16 dialogs and expanded grid editors.
 *
 * WHY: Awesomplete owns its <ul> inside the field. The theme's expanded
 * child-row sheet clips its .grid-form-body (overflow-y:auto/x:hidden) and
 * accordion sections (overflow:hidden); Bootstrap dialogs similarly have
 * independently scrolling .modal-body. A high z-index INSIDE either clipped
 * subtree cannot show the list above the sheet/dialog.
 *
 * Only for Link/Dynamic Link/Autocomplete inputs inside a visible modal
 * (except Awesome Bar) or expanded grid editor: temporarily move the SAME
 * Awesomplete <ul> to <body> and position above the owning surface. On
 * close/route change, return it to its ORIGINAL place with the native
 * listeners, aria attributes and per-field instance unchanged.
 *
 * Do not touch inline editable grid popups: interaction_finish_v2.js owns
 * their independent portal lifecycle.
 */
(() => {
	"use strict";

	if (window.__stOverlayLinkSuggestions) return;
	window.__stOverlayLinkSuggestions = true;

	const PORTAL_CLASS = "st-overlay-link-suggestions";
	const GRID_SELECTOR = ".form-in-grid.st-v7-grid-editor, .form-in-grid.st-grid-row-portal, .grid-row-open .form-in-grid";
	const FIELD_SELECTOR = '.frappe-control[data-fieldtype="Link"], .frappe-control[data-fieldtype="Dynamic Link"], .frappe-control[data-fieldtype="Autocomplete"]';
	const portals = new Map();
	let frame = 0;
	let observer;

	function surfaceFor(input) {
		const dialog = input?.closest?.(".modal.show");
		if (dialog) {
			// Awesome Bar has its own Frappe popup/stacking contract.
			if (dialog.querySelector(".navbar-modal-wrapper")) return null;
			return { element: dialog, dialog: true };
		}
		const editor = input?.closest?.(GRID_SELECTOR);
		return editor ? { element: editor, dialog: false } : null;
	}

	function eligibleInput(input) {
		if (!(input instanceof HTMLInputElement) || !input.isConnected) return false;
		if (!input.closest(FIELD_SELECTOR)) return false;
		// An expanded GridRowForm can still be nested beneath .editable-row
		// during the first Frappe paint, before interaction_finish_v2 portals
		// its editor to <body>. Do not reject its Item Link as an inline cell.
		const surface = surfaceFor(input);
		if (!surface) return false;
		// Only truly inline grid cells belong to the existing v7 popup owner.
		if (input.closest(".form-grid .editable-row") && !input.closest(".form-in-grid")) {
			return false;
		}
		return true;
	}

	function ownList(input) {
		const wrapper = input.closest(".awesomplete");
		const controlled = input.getAttribute("aria-controls");
		const list = controlled && document.getElementById(controlled);
		if (list?.matches?.("ul, [role='listbox']") &&
			(wrapper?.contains(list) || portals.get(list)?.input === input)) return list;
		// Frappe creates Awesomplete while the GridRowForm is rendered. A
		// list can be a direct child of its wrapper, or a sibling placed in
		// the field's control-input area during the first focus cycle.
		const candidates = [
			...(wrapper ? Array.from(wrapper.children) : []),
			...Array.from(input.closest(".link-field, .control-input")?.querySelectorAll(
				".awesomplete > ul, .awesomplete > [role='listbox']"
			) || []),
		];
		return candidates.find(node => node.matches?.("ul, [role='listbox']")) || null;
	}

	function open(list) {
		if (!list || !list.isConnected || list.hasAttribute("hidden") ||
			list.classList.contains("hide")) return false;
		const computed = window.getComputedStyle(list);
		return computed.display !== "none" && computed.visibility !== "hidden";
	}

	function px(input, property, value) {
		input.style.setProperty(property, value, "important");
	}

	function position(list, meta) {
		const { input, surface } = meta;
		if (!input.isConnected || !surface.element?.isConnected || !open(list)) return;
		const inputRect = input.getBoundingClientRect();
		if (!inputRect.width || !inputRect.height) return;
		const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
		const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
		const margin = 10, gap = 5;
		const field = input.closest(".control-input-wrapper, .control-input, .link-field");
		const anchorRect = field?.getBoundingClientRect?.();
		const rect = anchorRect?.width >= inputRect.width && anchorRect?.height < 130
			? anchorRect : inputRect;
		const width = Math.max(1, Math.min(
			Math.max(190, Math.round(rect.width)), viewportWidth - margin * 2
		));
		const left = Math.max(margin, Math.min(Math.round(rect.left), viewportWidth - width - margin));
		const below = viewportHeight - rect.bottom - gap - margin;
		const above = rect.top - gap - margin;
		const flip = below < 150 && above > below;
		const available = Math.max(60, flip ? above : below);
		const maxHeight = Math.min(300, Math.floor(available));
		const top = flip
			? Math.max(margin, Math.round(rect.top - gap - Math.min(list.scrollHeight || 300, maxHeight)))
			: Math.round(rect.bottom + gap);

		const stacking = Number.parseInt(window.getComputedStyle(surface.element).zIndex, 10);
		const z = surface.dialog
			? Math.max(20010, (Number.isFinite(stacking) ? stacking : 20000) + 10)
			: 15020; // Above the 12010 grid editor, below normal dialogs (19990+).
		px(list, "position", "fixed");
		px(list, "top", top + "px");
		px(list, "left", left + "px");
		px(list, "right", "auto");
		px(list, "bottom", "auto");
		px(list, "width", width + "px");
		px(list, "min-width", width + "px");
		px(list, "max-width", width + "px");
		px(list, "max-height", maxHeight + "px");
		px(list, "z-index", String(z));
		px(list, "transform", "none");
		px(list, "translate", "none");
	}

	function restore(list) {
		const meta = portals.get(list);
		if (!meta) return;
		portals.delete(list);
		list.classList.remove(PORTAL_CLASS, "st-overlay-from-modal");
		if (meta.marker.parentNode === meta.parent) {
			meta.parent.insertBefore(list, meta.marker);
		} else if (meta.parent.isConnected) {
			meta.parent.appendChild(list);
		} else {
			list.remove();
		}
		meta.marker.remove();
		if (meta.style === null) list.removeAttribute("style");
		else list.setAttribute("style", meta.style);
	}

	function portal(input) {
		if (!eligibleInput(input)) return;
		const list = ownList(input);
		if (!list || !open(list)) return;
		const surface = surfaceFor(input);
		if (!surface) return;
		const known = portals.get(list);
		if (known) {
			if (known.input !== input || known.surface.element !== surface.element) {
				restore(list);
			} else {
				position(list, known);
				return;
			}
		}
		if (!list.parentNode) return;
		const marker = document.createComment("st-overlay-native-awesomplete");
		const parent = list.parentNode;
		const style = list.getAttribute("style");
		parent.insertBefore(marker, list);
		const meta = { input, surface, parent, marker, style };
		portals.set(list, meta);
		list.classList.add(PORTAL_CLASS);
		if (surface.dialog) list.classList.add("st-overlay-from-modal");
		document.body.appendChild(list);
		position(list, meta);
	}

	function update() {
		frame = 0;
		for (const [list, meta] of Array.from(portals)) {
			if (!meta.input.isConnected || !meta.surface.element?.isConnected ||
				!open(list) || !surfaceFor(meta.input)) {
				restore(list);
			} else {
				position(list, meta);
			}
		}
		const focused = document.activeElement;
		if (eligibleInput(focused)) portal(focused);
		// The expanded child editor can be portaled to body between the
		// native focus event and the asynchronous search_link response.
		// Re-check its focused Link input after that transition as well;
		// do not depend solely on an awesomplete-open event arriving later.
		if (!eligibleInput(focused)) {
			const editor = document.querySelector(
				"body > .form-in-grid.st-v7-grid-editor, body > .form-in-grid.st-grid-row-portal"
			);
			const focusedLink = editor?.querySelector("input:focus");
			if (eligibleInput(focusedLink)) portal(focusedLink);
		}
	}

	function schedule() {
		if (frame) return;
		frame = requestAnimationFrame(update);
	}

	function clearAll() {
		for (const list of Array.from(portals.keys())) restore(list);
	}

	document.addEventListener("awesomplete-open", event => {
		if (eligibleInput(event.target)) {
			// Open event may fire while the original field code is still running.
			queueMicrotask(schedule);
			schedule();
		}
	}, true);

	document.addEventListener("awesomplete-close", event => {
		for (const [list, meta] of Array.from(portals)) {
			if (meta.input === event.target) restore(list);
		}
	}, true);

	document.addEventListener("focusin", event => {
		if (eligibleInput(event.target)) schedule();
	}, true);

	document.addEventListener("input", event => {
		if (eligibleInput(event.target)) schedule();
	}, true);

	window.addEventListener("scroll", () => {
		if (portals.size) schedule();
	}, { capture: true, passive: true });
	window.addEventListener("resize", () => {
		if (portals.size) schedule();
	}, { passive: true });

	document.addEventListener("keydown", event => {
		if (event.key === "Escape") schedule();
	}, true);

	// On a portaled list the input is in the editor but the option is
	// under body. Keep the input focused through pointer selection so
	// Frappe's async search callback and native Awesomplete click handler
	// can complete. Do not stop propagation or replace selection events.
	document.addEventListener("mousedown", event => {
		if (event.target?.closest?.("body > ." + PORTAL_CLASS)) {
			event.preventDefault();
		}
	}, true);

	// Native open/close can change [hidden] asynchronously; also restores
	// lists when a modal or editor is destroyed without a close event.
	function observe() {
		if (observer || !document.body || !window.MutationObserver) return;
		observer = new MutationObserver(records => {
			if (portals.size) {
				for (const [list, meta] of Array.from(portals)) {
					if (!list.isConnected || !meta.input.isConnected ||
						!meta.surface.element.isConnected || list.hasAttribute("hidden")) {
						restore(list);
					}
				}
			}
			if (records.some(record => {
				const target = record.target;
				if (record.type === "attributes") {
					return target?.matches?.("ul, [role='listbox']") &&
						(target.closest?.(".awesomplete") || portals.has(target));
				}
				return Array.from(record.addedNodes || []).some(node =>
					node.nodeType === 1 && (
						node.matches?.(".awesomplete, .modal.show, .form-in-grid, ul[role='listbox']") ||
						node.querySelector?.(".awesomplete, ul[role='listbox']")
					)
				);
			})) schedule();
		});
		observer.observe(document.body, {
			subtree: true, childList: true, attributes: true,
			attributeFilter: ["hidden"],
		});
	}

	if (typeof window.$ === "function") {
		$(document).on("page-change.st_overlay_link_selector", clearAll);
	}
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", observe, { once: true });
	} else observe();

	// Non-mutating browser-console diagnostics.
	window.saas_theme = window.saas_theme || {};
	window.saas_theme.overlay_link_diagnostics = () => ({
		open_portals: portals.size,
		surfaces: Array.from(portals.values()).map(meta =>
			meta.surface.dialog ? "modal" : "grid-editor"
		),
	});
})();
