#!/usr/bin/env node
"use strict";
/* Runtime smoke test: native Awesomplete UL must escape clipping in both
   modal and expanded-grid overlays, then be restored without cloning. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const code = fs.readFileSync(path.join(__dirname,
	"../saas_theme/public/js/overlay_link_suggestions.js"), "utf8");
new vm.Script(code);

class ClassList {
	constructor() { this.set = new Set(); }
	add(...values) {values.forEach(value => this.set.add(value));}
	remove(...values) {values.forEach(value => this.set.delete(value));}
	contains(value) {return this.set.has(value);}
}
class FakeNode {
	constructor(name = "DIV") {
		this.nodeName=name;
		this.nodeType=name === "#comment" ? 8 : 1;
		this.children=[];
		this.parentNode=null;
		this.isConnected=true;
		this.classList=new ClassList();
		this.attrs={};
		this.style={
			values:{},setProperty(k,v,priority){this.values[k]=[v,priority];},
		};
		this.hidden=false;
		this.scrollHeight=180;
		this.rect={left:90,top:145,bottom:179,right:340,width:250,height:34};
	}
	appendChild(node) {
		if(node.parentNode) node.parentNode.removeChild(node);
		this.children.push(node);node.parentNode=this;node.isConnected=true;
		return node;
	}
	insertBefore(node,marker) {
		if(node.parentNode) node.parentNode.removeChild(node);
		const n=this.children.indexOf(marker);
		assert.ok(n>=0,"marker belongs to parent");
		this.children.splice(n,0,node);node.parentNode=this;node.isConnected=true;
		return node;
	}
	removeChild(node){const n=this.children.indexOf(node);if(n>=0)this.children.splice(n,1);node.parentNode=null;return node;}
	remove(){this.parentNode?.removeChild(this);this.isConnected=false;}
	setAttribute(k,v){this.attrs[k]=v;}
	getAttribute(k){return Object.hasOwn(this.attrs,k)?this.attrs[k]:null;}
	removeAttribute(k){delete this.attrs[k];}
	hasAttribute(k){return Object.hasOwn(this.attrs,k);}
	matches(selector){return this.nodeName==="UL" && (selector.includes("ul")||selector.includes("listbox"));}
	getBoundingClientRect(){return this.rect;}
	contains(node){return this.children.includes(node);}
	querySelector(){return null;}
	get firstElementChild(){return this.children[0] || null;}
}
class HTMLInputElementMock extends FakeNode {
	constructor(surface, type="Link", inline=false){
		super("INPUT");this.surface=surface;this.fieldtype=type;this.inline=inline;
		this.wrapper=null;this.control=null;this.awesomplete=null;
	}
	closest(selector){
		if(selector.includes("form-grid .editable-row"))return this.inline?{isConnected:true}:null;
		if(selector.includes(".modal.show"))return this.surface.nodeName==="MODAL"?this.surface:null;
		if(selector.includes(".form-in-grid"))return this.surface.nodeName==="EDITOR"?this.surface:null;
		if(selector.includes(".frappe-control[data-fieldtype"))return ["Link","Dynamic Link","Autocomplete"].includes(this.fieldtype)?this.control:null;
		if(selector.includes(".awesomplete"))return this.wrapper;
		if(selector.includes(".control-input-wrapper"))return this.control;
		return null;
	}
}
const events=new Map(),queue=[],timeout=[];
const body=new FakeNode("BODY");
const modal=new FakeNode("MODAL");
const editor=new FakeNode("EDITOR");
modal.querySelector=()=>null;
editor.querySelector=()=>null;
modal.rect={left:47,top:32,bottom:600,right:620,width:573,height:568};
editor.rect={left:47,top:10,bottom:685,right:670,width:623,height:675};

function setupField(surface,type="Link",inline=false){
	const control=new FakeNode("CONTROL"),wrapper=new FakeNode("WRAPPER");
	const input=new HTMLInputElementMock(surface,type,inline);
	input.control=control;input.wrapper=wrapper;
	const ul=new FakeNode("UL");
	ul.attrs.id="list-"+type+"-"+surface.nodeName;
	input.attrs["aria-controls"]=ul.attrs.id;
	input.awesomplete=ul;
	wrapper.appendChild(ul);control.appendChild(wrapper);
	surface.appendChild(control);
	return {input,ul,wrapper,control,surface};
}
const dialogField=setupField(modal);
const gridField=setupField(editor,"Dynamic Link");
const nestedExpandedItemField=setupField(editor,"Link",true);
// A true inline cell is outside .form-in-grid and must remain owned by v7.
const inlineField=setupField(new FakeNode("GRID"),"Link",true);
const outside=new HTMLInputElementMock(new FakeNode("NORMAL"),"Link");

const all=[dialogField,gridField,nestedExpandedItemField,inlineField];
const doc={
	body,readyState:"loading",
	documentElement:{clientWidth:900,clientHeight:750},
	activeElement:null,
	addEventListener(name,listener){events.set(name,listener);},
	getElementById(id){return all.find(f=>f.ul.attrs.id===id)?.ul || null;},
	createComment(){return new FakeNode("#comment");},
};
const $=()=>({on(){}});
const win={
	innerWidth:900,innerHeight:750,MutationObserver:class{constructor(cb){this.cb=cb;}observe(){}},
	getComputedStyle(node){return {display:node.hasAttribute("hidden")?"none":"block",visibility:"visible",zIndex:node===modal?"20000":node===editor?"12010":"auto"};},
	addEventListener(name,listener){events.set("window:"+name,listener);},
};
const windowContext={window:win,document:doc,Element:FakeNode,HTMLInputElement:HTMLInputElementMock,
	requestAnimationFrame(fn){queue.push(fn);return queue.length;},
	setTimeout(fn){timeout.push(fn);},queueMicrotask(fn){Promise.resolve().then(fn);},
	console};
vm.runInNewContext(code,windowContext);
assert.equal(win.__stOverlayLinkSuggestions,true);
function flush(){
	for(let pass=0;pass<5 && queue.length;pass++){
		const jobs=queue.splice(0);jobs.forEach(fn=>fn());
	}
}
function signal(name,target){events.get(name)({target});}
async function opened(f){
	doc.activeElement=f.input;
	signal("awesomplete-open",f.input);
	await Promise.resolve();
	flush();
}
async function run(){
	assert.ok(events.has("awesomplete-close"),"close listener registered");
	assert.ok(events.has("focusin"),"focus listener registered");
	assert.ok(events.has("input"),"input listener registered");
	await opened(dialogField);
	assert.equal(dialogField.ul.parentNode,body,"modal UL is body portaled");
	assert.equal(dialogField.ul.style.values["z-index"][0],"20010","popup is above the actual modal");
	assert.equal(dialogField.ul.style.values["position"][0],"fixed");
	assert.equal(dialogField.ul.style.values["left"][1],"important");
	assert.equal(dialogField.ul.style.values["max-height"][0],"300px");
	assert.equal(win.saas_theme.overlay_link_diagnostics().open_portals,1);
	const original=dialogField.ul;
	signal("awesomplete-close",dialogField.input);
	assert.equal(dialogField.ul.parentNode,dialogField.wrapper,"modal UL restored");
	assert.equal(dialogField.wrapper.children[0],original,"same UL (not cloned)");
	assert.equal(win.saas_theme.overlay_link_diagnostics().open_portals,0);
	assert.equal(dialogField.ul.getAttribute("style"),null,"temporary popup positioning must not persist after close");
	await opened(gridField);
	assert.equal(gridField.ul.parentNode,body,"expanded row UL escapes clipped grid body");
	assert.equal(gridField.ul.style.values["z-index"][0],"15020","grid UL is below real dialogs");
	assert.equal(win.saas_theme.overlay_link_diagnostics().surfaces[0],"grid-editor");
	gridField.ul.attrs.hidden="";
	flush();
	signal("awesomplete-close",gridField.input);
	assert.equal(gridField.ul.parentNode,gridField.wrapper,"hidden grid suggestions return to field");
	// The Purchase Invoice Item field can open before Frappe has finished
	// moving the GridRowForm from an editable table row to <body>. It is
	// an expanded child editor despite having an .editable-row ancestor.
	await opened(nestedExpandedItemField);
	assert.equal(nestedExpandedItemField.ul.parentNode,body,
		"Item Link suggestions must be portaled even in the editor's initial nested state");
	const pointer={target:{closest:(selector)=>selector.includes("st-overlay-link-suggestions")?nestedExpandedItemField.ul:null},
		preventDefault(){this.prevented=true;},prevented:false};
	events.get("mousedown")(pointer);
	assert.equal(pointer.prevented,true,"Option press keeps Item input focused");
	assert.equal(doc.activeElement,nestedExpandedItemField.input);
	signal("awesomplete-close",nestedExpandedItemField.input);
	assert.equal(nestedExpandedItemField.ul.parentNode,nestedExpandedItemField.wrapper);
	doc.activeElement=inlineField.input;
	signal("awesomplete-open",inlineField.input);
	await Promise.resolve();flush();
	assert.equal(inlineField.ul.parentNode,inlineField.wrapper,"existing inline-grid popup owner untouched");
	doc.activeElement=outside;
	flush();
	assert.equal(win.saas_theme.overlay_link_diagnostics().open_portals,0);
	console.log("Modal and expanded child-editor dropdown portal runtime checks passed.");
}
run().catch(error=>{console.error(error);process.exitCode=1;});
