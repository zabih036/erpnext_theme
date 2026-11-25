#!/usr/bin/env node
"use strict";
/*
 * The real theme companion must promote an external searchable Link menu
 * above Frappe's native top-layer GridRowForm, without replacing the
 * picker/input or exposing normal Supplier dropdowns to the new behavior.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(
	path.join(__dirname, "../saas_theme/public/js/grid_external_link_popup.js"), "utf8"
);
new vm.Script(src);

class Classes {
	constructor() { this.items=new Set(); }
	add(v) {this.items.add(v);}
	remove(v) {this.items.delete(v);}
	contains(v) {return this.items.has(v);}
}
class Node {
	constructor(name, rect={left:100,top:160,width:440,height:260}) {
		this.name=name;
		this.isConnected=true;
		this.classList=new Classes();
		this.attributes={};
		this.rect={...rect,right:rect.left+rect.width,bottom:rect.top+rect.height};
		this.style={
			values:{},
			setProperty(k,v){this.values[k]=v;},
			getPropertyValue(k){return this.values[k] || "";},
		};
		this.parentNode=null;
		this.open=false;
		this.children=[];
	}
	getAttribute(k){return Object.hasOwn(this.attributes,k)?this.attributes[k]:null;}
	setAttribute(k,v){this.attributes[k]=v;}
	hasAttribute(k){return Object.hasOwn(this.attributes,k);}
	removeAttribute(k){delete this.attributes[k];}
	matches(sel) {
		if(sel===":popover-open")return this.open;
		if(sel.includes(".awesomplete >"))return false;
		if(sel.includes(".frappe-control"))return false;
		return false;
	}
	closest(sel) {
		if(sel.includes(".modal.show"))return null;
		if(sel.includes(".st-overlay-link-suggestions"))return null;
		if(this.name==="choice" && sel.includes(".link-dropdown"))return this.owner;
		if(this.name==="search" && sel.includes(".link-dropdown"))return this.owner;
		if(this.name==="item" && sel.includes(".form-in-grid.st-v7-grid-editor"))return editor;
		if(this.name==="item" && sel.includes(".frappe-control"))return field;
		if(this.name==="supplier" && sel.includes(".frappe-control"))return field;
		return null;
	}
	querySelector(sel) {
		if(sel.includes("input[type=") && this.name==="menu")return search;
		return null;
	}
	contains(child){return this===child || this.children.includes(child);}
	getBoundingClientRect(){return this.rect;}
	showPopover(){
		assert.equal(this.getAttribute("popover"),"manual");
		this.open=true;
	}
	hidePopover(){this.open=false;}
}

class Input extends Node {}
const editor=new Node("editor",{left:50,top:12,width:800,height:650});
editor.open=true;
const field=new Node("field");
const input=new Input("item",{left:100,top:120,width:440,height:38});
input.attributes["data-target"]="Item";
const supplier=new Input("supplier",{left:100,top:120,width:440,height:38});
const menu=new Node("menu");
menu.classList.add("link-dropdown");
const choice=new Node("choice");
const search=new Input("search");
search.owner=menu;choice.owner=menu;
menu.children=[choice,search];
const body=new Node("body");
menu.parentNode=body;
let rootMenuVisible=true, openModal=false, currentFocus=null;
const listeners=new Map(), winListeners=new Map(), frames=[];
const doc={
	body,readyState:"complete",documentElement:{clientWidth:1200,clientHeight:750},
	get activeElement(){return currentFocus;},
	getElementById(id){return id==="item-options"?choice:null;},
	querySelector(selector) {
		if(selector.includes(".modal.show"))return openModal?new Node("modal"):null;
		if(selector.includes(".form-in-grid"))return editor.open?editor:null;
		return null;
	},
	querySelectorAll(selector) {
		if(selector.includes(".link-dropdown"))return rootMenuVisible?[menu,choice]:[];
		return [];
	},
	addEventListener(name,fn){listeners.set(name,fn);}
};
input.attributes["aria-controls"]="item-options";
const win={
	innerWidth:1200,innerHeight:750,
	MutationObserver:class{constructor(cb){this.cb=cb;} observe(){}},
	getComputedStyle(node){
		return {display:node===menu && !rootMenuVisible?"none":"block",visibility:"visible"};
	},
	addEventListener(name,fn){winListeners.set(name,fn);},
};
const $=()=>({on(){}});
const ctx={window:win,document:doc,HTMLInputElement:Input,
	MutationObserver:win.MutationObserver,
	requestAnimationFrame(fn){frames.push(fn);return frames.length;},
	console, setTimeout, clearTimeout};
vm.runInNewContext(src,ctx);

function flush(){
	for(let i=0;i<8 && frames.length;i++){
		const jobs=frames.splice(0);
		jobs.forEach(fn=>fn());
	}
}
function focus(node){
	currentFocus=node;
	listeners.get("focusin")({target:node});
	flush();
}
assert.equal(win.__stGridExternalLinkPopup,true);
assert.equal(menu.parentNode,body);
assert.equal(menu.open,false);
focus(supplier);
assert.equal(menu.open,false,"Normal Supplier form links untouched");

focus(input);
assert.equal(menu.open,true,"External Item picker promoted to browser top layer");
assert.equal(menu.parentNode,body,"Native provider popup must never be moved or cloned");
assert.equal(menu.getAttribute("popover"),"manual");
assert.equal(menu.style.values["position"],"fixed");
assert.equal(menu.style.values["left"],"100px");
assert.equal(menu.style.values["top"],"162px");
assert.ok(menu.classList.contains("st-grid-external-link-popup"));
assert.equal(win.saas_theme.grid_link_popup_diagnostics().visible_external_menus,1);

focus(search);
assert.equal(menu.open,true,"Embedded Search Item input may receive focus without closing popup");
assert.equal(menu.parentNode,body);

rootMenuVisible=false;
winListeners.get("resize")();
flush();
assert.equal(menu.open,false,"Picker restores when provider hides result menu");
assert.equal(menu.hasAttribute("popover"),false);
assert.equal(menu.classList.contains("st-grid-external-link-popup"),false);

rootMenuVisible=true;
focus(input);
assert.equal(menu.open,true);
openModal=true;
winListeners.get("resize")();flush();
assert.equal(menu.open,false,"Link Selector/Advanced Search dialog takes precedence");

openModal=false;
focus(input);
assert.equal(menu.open,true);
winListeners.get("pagehide")();
assert.equal(menu.open,false,"Route/teardown restores provider popup");
assert.equal(menu.hasAttribute("popover"),false);
assert.equal(menu.parentNode,body);

const css=fs.readFileSync(
	path.join(__dirname, "../saas_theme/public/css/link_control_polish.css"), "utf8"
);
for(const token of [
	".st-grid-external-link-popup:popover-open",
	".link-btn[style*=\"display: none\"]",
	".btn-open, .btn-clear",
	"padding-inline-end: 72px",
	"inset-inline-end: 6px",
	"pointer-events: auto !important",
	'[data-fieldtype="Dynamic Link"]'
]) assert.ok(css.includes(token), "Scoped input/picker styling missing: "+token);
console.log("External Item Link popup top-layer, native DOM, Supplier isolation, search focus, and teardown passed.");
