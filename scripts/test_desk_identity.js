#!/usr/bin/env node
"use strict";
/* Desk identity runtime checks with a mocked Frappe v16 shell. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
	path.join(__dirname, "../saas_theme/public/js/desk_identity.js"), "utf8"
);
new vm.Script(source);

const listeners = {};
const jqEvents = {};
const observed = [];
const links = [
	{ rel: "icon", attrs: {href: "/files/company-logo.png", type: "image/png"} },
	{ rel: "shortcut icon", attrs: {href: "/files/company-logo.png", type: "image/png"} },
].map((item) => ({
	rel: item.rel,
	attrs: item.attrs,
	getAttribute(key) { return this.attrs[key] || null; },
	setAttribute(key, value) { this.attrs[key] = value; },
	hasAttribute(key) { return Object.hasOwn(this.attrs, key); },
	removeAttribute(key) { delete this.attrs[key]; },
}));
const head = {
	querySelectorAll(selector) {
		assert.equal(selector, 'link[rel~="icon"]');
		return links;
	},
	appendChild(node) {links.push(node);},
};
const headerClasses = new Set();
const sidebarIconNode = {
	innerHTML: '<svg id="native-app-logo"></svg>',
	closest(selector) {
		assert.equal(selector, ".sidebar-header");
		return { classList: { add(cls) { headerClasses.add(cls); } } };
	},
};
let selectedRail = null;
const doc = {
	head, readyState: "loading", title: "Accounts Dashboard",
	querySelector(selector) {
		if (selector === ".body-sidebar .sidebar-header .header-logo") return sidebarIconNode;
		if (selector === ".st-workspace-rail .st-rail-item.active") return selectedRail;
		throw new Error("Unexpected selector " + selector);
	},
	addEventListener(name, cb) {listeners[name] = cb;},
	createElement(tag) {return {rel: tag, setAttribute(){},getAttribute(){return null;}};},
};
const sidebar = {
	current_module: "Accounts", sidebar_title: "Accounts",
	sidebar_data: {label: "Accounts",header_icon: "accounting"},
};
const frappe = {
	app: { sidebar },
	boot: {
		sysdefaults: {},
		app_name: "Production ERP",
		navbar_settings: {app_logo: "/assets/frappe/images/frappe-favicon.svg"},
		workspace_sidebar_item: {accounts: {header_icon: "accounts-picked"}},
		module_sidebars: {Accounts: {header_icon: "accounts-default"}},
	},
	utils: {icon(name) {return '<svg data-icon="' + name + '"></svg>';}},
	call() {
		return Promise.resolve({
			message: {company: "Production Company",company_logo: "/files/company-logo.png"},
		});
	},
	after_ajax(cb) {jqEvents.after_ajax=cb;},
};
const win = {
	frappe,location:{href:"https://erp.example.test/app/accounts",origin:"https://erp.example.test"},
	addEventListener(name, fn) {listeners["window:"+name] = fn;},
};
function jq(arg) {
	assert.equal(arg, doc);
	return {on(events, fn) {jqEvents[events] = fn;return this;}};
}
win.$ = jq;
let imageUrls = [];
class MockImage {
	set src(url) {
		imageUrls.push(url);
		Promise.resolve().then(() => this.onload?.());
	}
}
class MockMutationObserver {
	constructor(cb) {this.callback=cb;observed.push(this);}
	observe(target, opts) {this.target=target;this.options=opts;}
	disconnect() {this.disconnected=true;}
}
const sandbox = {
	window:win,document:doc,frappe,$:jq,Image:MockImage,
	MutationObserver:MockMutationObserver,URL,Promise,setTimeout,clearTimeout,
	console,
};
vm.runInNewContext(source,sandbox);
assert.equal(win.__st_desk_identity__,true);
const api=win.saasThemeDeskIdentity;
assert.equal(api.safeLogoUrl("/files/logo.png"),"https://erp.example.test/files/logo.png");
assert.equal(api.safeLogoUrl("/private/files/logo.png"),"");
assert.equal(api.safeLogoUrl("javascript:alert(1)"),"");
assert.equal(api.safeLogoUrl("http://external.test/logo.png"),"");
assert.equal(api.safeLogoUrl("https://cdn.example.test/logo.png"),"https://cdn.example.test/logo.png");
assert.ok(api.monogramFavicon("Production").startsWith("data:image/svg+xml,"));

api.syncSidebarIcon();
assert.equal(sidebarIconNode.innerHTML,'<svg data-icon="accounts-picked"></svg>');
assert.ok(headerClasses.has("st-sidebar-selected-icon"));
// The visible selected rail is authoritative when its workspace matches.
selectedRail = {
	dataset:{workspace:"Accounts"},
	querySelector(selector) {assert.equal(selector,".st-rail-icon");return {innerHTML:'<svg id="selected-sidebar-icon"></svg>'};},
};
api.syncSidebarIcon();
assert.equal(sidebarIconNode.innerHTML,'<svg id="selected-sidebar-icon"></svg>');
// The active item can lag a sidebar switch; don't show the old icon.
sidebar.current_module="Stock";
sidebar.sidebar_title="Stock";
sidebar.sidebar_data={label:"Stock",header_icon:"boxes"};
api.syncSidebarIcon();
assert.equal(sidebarIconNode.innerHTML,'<svg data-icon="boxes"></svg>');
sidebar.sidebar_data={label:"Missing",header_icon:null};
sidebar.current_module="Missing";
sidebar.sidebar_title="Missing";
api.syncSidebarIcon();
assert.ok(sidebarIconNode.innerHTML.includes('st-sidebar-workspace-initial'));
assert.ok(sidebarIconNode.innerHTML.includes(">M</span>"));
sidebar.current_module="Accounts";
sidebar.sidebar_title="Accounts";
sidebar.sidebar_data={label:"Accounts",header_icon:"accounting"};

async function main() {
	listeners.DOMContentLoaded();
	assert.equal(links[0].attrs.href, "/files/company-logo.png", (
		"Desk identity must preserve the real server-rendered Company icon until branding resolves"
	));
	assert.ok(source.includes("setFavicon(monogramFavicon("),
		"Frappe-only icon fallback must remain available for older Desk pages");
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.deepEqual(imageUrls,["https://erp.example.test/files/company-logo.png"]);
	assert.equal(doc.title,"Accounts Dashboard · Production Company");
	assert.equal(links[0].attrs.href,"https://erp.example.test/files/company-logo.png");
	assert.equal(links[1].attrs.href,links[0].attrs.href);
	assert.equal(links[0].attrs.type,"image/png");
	assert.ok(observed.some((o) => o.target === head),"tab identity must observe Frappe title/icon overwrites");
	assert.ok(observed.some((o) => o.target === sidebarIconNode),"selected Sidebar icon must observe native refresh");
	assert.ok(Object.keys(jqEvents).some((s) => s.includes("page-change.st_desk_identity")));
	assert.equal(typeof jqEvents.after_ajax,"function");

	// Frappe can change both the tab title and favicon while routing.
	doc.title="Purchase Invoice";
	links[0].setAttribute("href","/assets/frappe/images/frappe-favicon.svg");
	const headObserver = observed.find((o) => o.target === head);
	headObserver.callback([
		{type:"characterData",target:{nodeName:"#text",parentNode:{nodeName:"TITLE"}},addedNodes:[]},
		{type:"attributes",target:{nodeName:"LINK"},addedNodes:[]},
	]);
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(doc.title,"Purchase Invoice · Production Company");
	assert.equal(links[0].attrs.href,"https://erp.example.test/files/company-logo.png");
	assert.equal(doc.title.split("Production Company").length,2,"company suffix must not duplicate");
	doc.title="Frappe";
	headObserver.callback([{type:"characterData",target:{
		nodeName:"#text",parentNode:{nodeName:"TITLE"}},addedNodes:[]}]);
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(doc.title,"Production Company",
		"Frappe's temporary startup placeholder must not appear in branded tab");
	// Two controller evaluations must not add duplicate listeners.
	vm.runInNewContext(source,sandbox);
	assert.equal(observed.filter((o) => o.target === head).length,1);
	console.log("Desk favicon, page title and active Sidebar icon runtime regression checks passed.");
}
main().catch((error) => {console.error(error);process.exitCode=1;});
