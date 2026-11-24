#!/usr/bin/env node
"use strict";
/*
 * Actual portalEditor() regression, not a source-string-only assertion.
 * Real Chromium blurs an input when its parent is moved to document.body.
 * Frappe's ControlLink drops async item search results if it is no longer
 * focused. This harness emulates that DOM behavior and executes the exact
 * portalEditor function extracted from the theme's shipped controller.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const code = fs.readFileSync(path.resolve(__dirname,
	"../saas_theme/public/js/interaction_finish_v2.js"), "utf8");
new vm.Script(code, { filename: "interaction_finish_v2.js" });
const start = code.indexOf("\tfunction portalEditor(editor) {");
const end = code.indexOf("\n\tfunction restoreEditor(editor) {", start);
assert.ok(start >= 0 && end > start, "Native editor portal owner must be present");
const actualPortalEditor = code.slice(start, end);

class FakeElement {
	constructor() {
		this.isConnected = true;
		this.classes = new Set();
		this.classList = {
			add: (name) => this.classes.add(name),
			contains: (name) => this.classes.has(name),
		};
		this.parentNode = null;
		this.focusCalls = 0;
	}
	contains(node) { return node === this.child; }
	closest(selector) {
		assert.equal(selector, ".grid-row");
		return this.owner;
	}
	focus() {}
}
class FakeInput extends FakeElement {
	constructor(document) {
		super();
		this.document = document;
		this.selectionStart = 4;
		this.selectionEnd = 7;
		this.selectionDirection = "forward";
		this.focusOptions = [];
		this.selectionRestored = null;
	}
	focus(options) {
		this.focusCalls += 1;
		this.focusOptions.push(options);
		this.document.activeElement = this;
	}
	setSelectionRange(start, end, direction) {
		this.selectionRestored = [start, end, direction];
	}
}
class FakeTextArea extends FakeInput {}

function runCase({ isFocused, type = FakeInput } = {}) {
	const doc = { activeElement: null, createComment: () => ({kind:"marker"}) };
	const input = new type(doc);
	const owner = new FakeElement();
	const editor = new FakeElement();
	editor.child = input;
	editor.owner = owner;
	const markerHost = {
		markers: [],
		insertBefore(marker, relativeTo) {
			assert.equal(relativeTo, editor);
			this.markers.push(marker);
			marker.parentNode = this;
		},
	};
	editor.parentNode = markerHost;
	const body = {
		moveCount: 0,
		classList: {add(name) {this.last = name;}},
		appendChild(node) {
			assert.equal(node, editor);
			this.moveCount += 1;
			// Chrome/Chromium DOM behavior, verified in headless browser:
			// moving an ancestor of the active input loses focus.
			if (doc.activeElement && node.contains(doc.activeElement)) {
				doc.activeElement = body;
			}
			editor.parentNode = body;
			return node;
		},
	};
	doc.body = body;
	const other = new FakeElement();
	doc.activeElement = isFocused ? input : other;
	let modalSyncs = 0;

	const context = {
		document: doc, Element: FakeElement, HTMLElement: FakeElement,
		HTMLInputElement: FakeInput, HTMLTextAreaElement: FakeTextArea,
		editorPortals: new Map(), GRID_OWNER_CLASS: "st-v7-grid-owner",
		GRID_EDITOR_CLASS: "st-v7-grid-editor", isVisible: () => true,
		syncModalLayers: () => {modalSyncs += 1;}, editor,
	};
	vm.runInNewContext(actualPortalEditor + "\nportalEditor(editor);", context);
	assert.equal(body.moveCount, 1, "Editor moves to body exactly once");
	assert.equal(modalSyncs, 1, "Existing modal stacking synchronization retained");
	assert.equal(context.editorPortals.size, 1, "Existing restore metadata retained");
	assert.ok(editor.classes.has("st-v7-grid-editor"));
	assert.ok(owner.classes.has("st-v7-grid-owner"));
	assert.equal(body.classList.last, "st-v7-grid-editor-open");

	// Re-evaluation must not reparent or refocus an already portaled editor.
	vm.runInNewContext(actualPortalEditor + "\nportalEditor(editor);", context);
	assert.equal(body.moveCount, 1, "Duplicate scans must not move the editor twice");
	if (isFocused) {
		assert.equal(doc.activeElement, input,
			"Item must still be focused so Frappe's async search callback is accepted");
		assert.equal(input.focusCalls, 1,
			"Restore focus only when Chromium loses it during the move");
		assert.equal(input.focusOptions[0].preventScroll, true);
		assert.equal(input.selectionRestored?.join(","), "4,7,forward",
			"Typing caret/range survives the editor move");
	} else {
		assert.equal(doc.activeElement, other, "Unrelated focused control must not change");
		assert.equal(input.focusCalls, 0, "Never steal focus from another control");
	}
}

runCase({isFocused: true});
runCase({isFocused: false});
runCase({isFocused: true,type: FakeTextArea});
assert.ok(!actualPortalEditor.includes("frappe.call("));
assert.ok(!actualPortalEditor.includes("set_value("));
console.log("Expanded Item Link retains focus/caret during v7 editor portal; unfocused views untouched.");
