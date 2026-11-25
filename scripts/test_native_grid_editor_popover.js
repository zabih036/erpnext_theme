#!/usr/bin/env node
"use strict";
/**
 * Execute the shipped v7 portalEditor / restoreEditor / scanEditors /
 * syncModalLayers functions against a model of the Frappe GridRowForm DOM.
 *
 * Critical invariant: browser top-layer popovers promote a node visually
 * WITHOUT reparenting it, so Frappe's Item input stays focused and its
 * native parent-grid ancestry, validation and event delegation remain intact.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
	path.join(__dirname, "../saas_theme/public/js/interaction_finish_v2.js"), "utf8"
);
new vm.Script(source);
function extract(start, end) {
	const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
	assert.ok(from >= 0 && to > from, "Frappe editor function boundary changed: " + start);
	return source.slice(from, to);
}

const functions = [
	extract("\tfunction isVisible(element) {", "\n\t/* Expanded child editor:"),
	extract("\tfunction portalEditor(editor) {", "\n\t/* Link Selector from a child-row editor"),
	extract("\tfunction syncModalLayers() {", "\n\t/* Inline editable-grid Link popup."),
].join("\n");

class FakeClassList {
	constructor(values = []) {this.values=new Set(values);}
	contains(v) {return this.values.has(v);}
	add(v) {this.values.add(v);}
	remove(v) {this.values.delete(v);}
}
class FakeStyle {
	constructor() {this.values={};}
	setProperty(name, value) {this.values[name]=value;}
	removeProperty(name) {delete this.values[name];}
	getPropertyValue(name) {return this.values[name] || "";}
}
class FakeElement {
	constructor() {
		this.isConnected=true;
		this.classList=new FakeClassList();
		this.style=new FakeStyle();
		this.attributes={};
		this.hidden=false;
		this.open=false;
	}
	getAttribute(name) {return Object.hasOwn(this.attributes,name)?this.attributes[name]:null;}
	setAttribute(name,value) {this.attributes[name]=value;}
	removeAttribute(name) {delete this.attributes[name];}
	matches(sel) {return sel===":popover-open" && this.open;}
	showPopover() {
		assert.equal(this.getAttribute("popover"),"manual");
		this.open=true;
		this.calls++;
	}
	hidePopover() {this.open=false;this.hideCalls++;}
	closest(selector) {return selector===".grid-row"?this.owner:null;}
}
const originalRowParent={name:"native-grid-row",isConnected:true};
const editor=new FakeElement();editor.owner=new FakeElement();
editor.owner.classList.add("grid-row-open");
editor.parentNode=originalRowParent;
editor.calls=0;editor.hideCalls=0;
const input=new FakeElement();input.type="text";
const body={
	moves:0,
	classList:new FakeClassList(),
	appendChild(){this.moves++;throw Error("Editor must never move from Frappe's grid-row DOM");},
};
let currentModals=[];
const doc={
	body,
	activeElement:input,
	querySelectorAll(selector) {
		if (selector===".grid-row.grid-row-open .form-in-grid") return [editor];
		if (selector==="body > .modal-backdrop.show") return [];
		if (selector==="body > .modal.show, body > .modal.fade.show") return currentModals;
		throw Error("Unexpected native query: " + selector);
	},
};
const context={
	Element:FakeElement,HTMLElement:FakeElement,HTMLInputElement:FakeElement,
	HTMLTextAreaElement:FakeElement,document:doc,
	window:{getComputedStyle: e => ({
		display: e.style.getPropertyValue("visibility")==="hidden"?"none":"block",
		visibility: e.style.getPropertyValue("visibility") || "visible",
	})},
	editorPortals:new Map(),GRID_OWNER_CLASS:"st-v7-grid-owner",
	GRID_EDITOR_CLASS:"st-v7-grid-editor",GRID_POPUP_CLASS:"st-v7-inline-grid-popup",
};
vm.runInNewContext(functions+"\nportalEditor(editor);", {...context,editor});

assert.equal(editor.open,true,"Expanded editor enters native top layer");
assert.equal(editor.calls,1,"Editor is promoted only once");
assert.equal(editor.parentNode,originalRowParent,"Native Frappe GridRowForm ancestry preserved");
assert.equal(body.moves,0,"Never detach Item input from grid row");
assert.equal(doc.activeElement,input,"Focused Item stays focused");
assert.equal(editor.closest(".grid-row"),editor.owner);
assert.equal(editor.getAttribute("popover"),"manual");
assert.equal(context.editorPortals.size,1);
assert.ok(editor.owner.classList.contains("st-v7-grid-owner"));

vm.runInNewContext(functions+"\nscanEditors();", {...context,editor});
assert.equal(editor.calls,1,"Repeated DOM observer passes must not re-open editor");

currentModals=[{querySelector(){return null;}}];
vm.runInNewContext(functions+"\nsyncModalLayers();", {...context,editor});
assert.equal(editor.open,false,"Advanced Search modal outranks editor popover");
assert.equal(editor.style.getPropertyValue("visibility"),"hidden");
assert.equal(editor.hideCalls,1);
vm.runInNewContext(functions+"\nscanEditors();", {...context,editor});
assert.equal(context.editorPortals.size,1,"Temporary dialog must not tear down the open row");

currentModals=[];
vm.runInNewContext(functions+"\nsyncModalLayers();", {...context,editor});
assert.equal(editor.open,true,"Editor reopens when Link Selector dialog closes");
assert.equal(editor.calls,2);
assert.equal(editor.style.getPropertyValue("visibility"),"");
assert.equal(doc.activeElement,input);
assert.equal(body.moves,0);

vm.runInNewContext(functions+"\nrestoreEditor(editor);", {...context,editor});
assert.equal(editor.open,false);
assert.equal(editor.getAttribute("popover"),null);
assert.equal(editor.parentNode,originalRowParent);
assert.equal(context.editorPortals.size,0);
assert.equal(body.classList.contains("st-v7-grid-editor-open"),false);

// Presentation is deliberately scoped: no global form/grid input changes.
const css = fs.readFileSync(path.join(__dirname,
	"../saas_theme/public/css/grid_editor_popover.css"), "utf8");
for (const token of [
	".grid-row.grid-row-open", ".form-in-grid.st-v7-grid-editor:popover-open",
	"ul.st-overlay-link-suggestions:popover-open", "overflow: visible !important",
	"@media (max-width: 767px)",
]) assert.ok(css.includes(token),"Popover presentation missing: "+token);

console.log("GridRowForm stays in native DOM, keeps Item focus, handles modal layering and teardown.");
