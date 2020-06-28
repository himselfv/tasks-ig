'use strict';

/*
NodeJS / pureJS export support
Usage:
  var myApi = new Unit((typeof exports != 'undefined') && exports);
  myApi.export({ functionName, varName, varName });
  myApi.export(functionName); //not for vars

Prefer exporting like this instead of
  myApi.exports.exportName = exportName
Because the former one automatically checks that the object exists
and automatically uses its name (less chance for error).
*/

//Pass 
function Unit(module_exports) {
	this.exports = module_exports || {};
}
Unit.prototype.export = function(fn) {
	if (typeof fn == 'undefined')
		throw Error('Cannot export undefined');
	if (typeof fn == 'function')
		this.exports[fn.name] = fn;
	else
	if (typeof fn == 'object')
		for(let key in fn)
			this.exports[key] = fn[key];
	else
		throw Error('Unit.export() cannot export '+String(fn));
}

var utils = new Unit((typeof exports != 'undefined') && exports);
utils.export(Unit);


/*
require() module and make its exports global.
Pass either filename or an already imported exports dict (preferred).

Example:
if (typeof require != 'undefined') {
	require('./utils.js').importSelf();
	importAll(utils);
	importAll(require('./backend.js'));
	importAll(require('./backendLocal.js'));
}
*/
function importAll(imp) {
	if (typeof imp == 'string') //filename
		imp = require(imp);
	for (let key in imp)
		global[key] = imp[key];
}
utils.export(importAll);
function importSelf() {
	importAll(exports);
	return this;
}
utils.export(importSelf);


/*
Application-wide options
Loaded at this point because all scripts may rely on them - more thorough handling in main code.
Note: Before the main code sets default values, all defaults are undefined.
*/
var options = options || {};
utils.export({ options });
function optionsLoad() {
	options = Object.assign({}, options, getLocalStorageItem("tasksIg_options"));
}
utils.export(optionsLoad);
function optionsSave() {
	setLocalStorageItem("tasksIg_options", options);
	//Update everything in the UI that depends on options. We are lazy:
	document.location.reload();
}
utils.export(optionsSave);
function optionsSetDefaults(optionSet) {
	for (let key in optionSet)
		if (!(key in options))
			options[key] = optionSet[key].default;
}
utils.export(optionsSetDefaults);
optionsLoad();


/*
Load additional JS
*/
//Loads a script and installs a number of compatibility hacks.
//Wait for onload/onerror or check readyState/errorMessage.
function insertScript(scriptId, scriptSrc) {
	console.debug('inserting script '+scriptSrc);
	let script = document.createElement('script');
	script.id = scriptId;
	script.src = scriptSrc;
	script.async = true;
	script.defer = true;
	
	//Some browsers fire readyStateChange but not onLoad
	script.handleReadyStateChange = () => {
		if (script.readyState != 'complete') return;
		script.onload();
	};
	script.addEventListener("readystatechange", script.handleReadyStateChange);
	
	script.handleLoad = () => {
		script.finalizeLoad();
	};
	script.addEventListener("load", script.handleLoad);
	
	//onerror works in SOME browsers, and often only for FILE LOADING errors, parsing errors might not get reported
	script.handleLoadError = () => {
		//The late comers want a way to find out about errors => provide errorMessage
		//If we get here from window.error then errorMessage is already set -- preserve it
		if (!script.errorMessage)
			script.errorMessage = "Cannot load script "+scriptSrc;
		script.finalizeLoad();
	};
	script.addEventListener("error", script.handleLoadError, true);
	
	//Hackish way to detect parsing errors
	//  https://developer.mozilla.org/en-US/docs/Web/API/ErrorEvent
	//Notes:
	// * loaded() may still get called even if the file had processing errors
	// * may even be called BEFORE window.onerror(), in which case there's nothing we can do
	script.handleWindowError = (error) => {
		if (!(error instanceof ErrorEvent))
			return;
		//Many browsers will expand script.src to the full path but let's be a bit permissive
		if (!error.filename.endsWith(script.src))
			return;
		console.debug(scriptSrc, ': parsing error:', error);
		script.errorMessage = scriptSrc + ': ' + error.message;
		script.dispatchEvent(new CustomEvent('error'));
		script.finalizeLoad(); //handleError does this but let's be safe
	}
	window.addEventListener('error', script.handleWindowError, true);
	
	script.finalizeLoad = () => {
		//Some browsers don't support readyState at all, fake it to indicate that the script has finished loading
		if (!script.readyState)
			script.readyState = "complete";
		script.removeEventListener("readystatechange", script.handleReadyStateChange);
		script.removeEventListener("load", script.handleLoad);
		script.removeEventListener("error", script.handleLoadError);
		window.removeEventListener('error', script.handleWindowError, true);
	}
	
	document.body.append(script);
	return script;
}

//Returns a promise that's fulfilled when the JS is loaded
function loadScript(scriptId, scriptSrc) {
	return new Promise((resolve, reject) => {
		var script = document.getElementById(scriptId);
		if (script && (script.readyState == "complete")) {
			if (!script.errorMessage) {
				console.debug('script already loaded:', scriptId);
				resolve();
			}
			else {
				console.log('script load already failed:', scriptId);
				reject(script.errorMessage);
			}
			return;
		}
		if (!script)
			script = insertScript(scriptId, scriptSrc);
		console.debug(script);
		script.addEventListener("load", () => {
			console.debug('loaded script', script);
			resolve();
		});
		script.addEventListener("error", () => { 
			console.debug('script load error', script, script.errorMessage);
			reject(script.errorMessage);
		});
	});
}
utils.export(loadScript);

//Accepts a dictionary ID->src
//Returns a promise that's fulfilled when ALL the given JSs are loaded
function loadScripts(scripts) {
	let batch = [];
	Object.keys(scripts).forEach(key => {
		batch.push(loadScript(key, scripts[key]))
	});
	return Promise.all(batch);
}
utils.export(loadScripts);


/*
Creates a new GUID. Not perfect but whatever
https://stackoverflow.com/a/21963136
*/
function newGuid() {
    var u='',m='xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx',i=0,rb=Math.random()*0xffffffff|0;
    while(i++<36) {
        var c=m[i-1],r=rb&0xf,v=c=='x'?r:(r&0x3|0x8);
        u+=(c=='-'||c=='4')?c:v.toString(16);rb=i%8==0?Math.random()*0xffffffff|0:rb>>4;
    }
    return u;
}
utils.export(newGuid);


/*
Inheritance
*/
function inherit(fromWhat, what) {
	what.prototype = Object.create(fromWhat.prototype);
	what.prototype.constructor = what;
}
utils.export(inherit);


/*
Stores/retrieves local storage entries as JSON
*/
function getLocalStorageItem(key) {
	var data = window.localStorage.getItem(key);
	return (data) ? JSON.parse(data) : null;
}
utils.export(getLocalStorageItem);
function setLocalStorageItem(key, value) {
	window.localStorage.setItem(key, JSON.stringify(value));
}
utils.export(setLocalStorageItem);


/*
Callback class
*/
function Callback() {
	this.observers = [];
}
Callback.prototype.subscribe = function(f) {
	this.observers.push(f);
}
Callback.prototype.push = function(f) {
	this.observers.push(f);
}
Callback.prototype.unsubscribe = function(f) {
	this.observers = this.observers.filter(subscriber => subscriber !== f);
}
Callback.prototype.notify = function() {
	this.observers.forEach(observer => observer.apply(this, arguments));
}
utils.export(Callback);


//allSettled polyfill
if (typeof Promise.allSettled == 'undefined')
	Promise.allSettled = function(batch) {
		let batch2 = [];
		for (let prom of batch)
			batch2.push(prom
			.then(result => ({ status: 'fulfilled', value: result, }))
			.catch(error => ({ status: 'rejected', reason: error, }))
			);
		return Promise.all(batch2);
	}


/*
Job queue
Tracks unrelated promises so that you always know whether you have any outstanding ones.
Allows to serialize them so that they are executed sequentially.
*/
function JobQueue() {
	this.count = 0;
	this.jobs = [];
	this.idlePromises = [];
	this.onChanged = new Callback();
	this.onError = new Callback();
}
utils.export(JobQueue);
//Pass any promises to track their execution + catch errors.
JobQueue.prototype.push = function(prom) {
	this.count += 1;
	this.jobs.push(prom);
	//console.log("job added, count="+this.count);
	this.onChanged.notify();
	prom
	//Catch any errors
	.catch((error) => this.onError.notify(error))
	//In any case, remove it from the list
	.then(result => {
		this.count -= 1;
		let index = this.jobs.indexOf(prom);
		if (index >= 0)
			this.jobs.splice(index, 1);
		//console.log("job completed, count="+this.count);
		if (this.count <= 0) {
			this.onChanged.notify();
			while ((this.idlePromises.length > 0) && (this.count <= 0))
				this.idlePromises.splice(0, 1)();
		}
	})
	;
	return prom;
}
//Returns a promise that fires only when NO jobs are remaining in the queue
//=> all queued actions have completed AND no new actions are pending.
JobQueue.prototype.waitIdle = function() {
	if (this.count <= 0)
		return Promise.resolve();
	else
		return new Promise((resolve, reject) => { this.idlePromises.push(resolve); })
}
JobQueue.prototype.addIdleJob = function(job) {
	this.waitIdle().then(() => job());
}
//Returns a promise that fires when all operations queued AT THE MOMENT OF THE REQUEST have completed SUCCESSFULLY.
//New operations may be queued by the time it fires.
//Note: If any of the currently queued jobs fails, your promise also fails.
JobQueue.prototype.waitCurrentJobsCompleted = function() {
	return Promise.all(this.jobs);
}
//Same, but all promises queued at the moment of the request are SETTLED (resolved or rejected)
JobQueue.prototype.waitCurrentJobsSettled = function() {
	return Promise.allSettled(this.jobs);
}
//Queues a function to run only after the current jobs have settled (resolved or rejected)
//Returns a promise for that function's result
JobQueue.prototype.queueIndependentJob = function(fn) {
	let job = this.waitCurrentJobsSettled()
		.then(() => fn());
	this.push(job);
	return job;
}



/*
Saves/reads params in the URL's #anchor part
Please use URI compatible key names at least.
*/
function urlWrite(dict) {
	let url = '';
	if (dict)
		for (let key in dict)
			url = url + ((url.length <= 0)?'#':'&') + key + '=' + encodeURIComponent(dict[key]);
	if (url=='') url='#';
	document.location.href = url;
}
utils.export(urlWrite);
function urlRead() {
	let data = document.location.href;
	let hashIdx = data.indexOf('#');
	if (hashIdx >= 0)
		data = data.slice(hashIdx+1);
	else
		data = "";
	if (!data || (data.length <= 0))
		return null; //nothing is selected
	
	let parts = data.split('&');
	data = {};
	for (let i in parts) {
		let nameVal = parts[i].split('=');
		if (!nameVal || !nameVal.length || (nameVal.length != 2)) {
			console.debug('Weird URI component:', parts[i]);
			continue;
		}
		data[nameVal[0]] = decodeURIComponent(nameVal[1]);
	}
	console.debug('url data:', data);
	return data;
}
utils.export(urlRead);



/*
Focus, caret and selection
https://developer.mozilla.org/en-US/docs/Web/API/Selection

A selection may contain several ranges but it's reasonable to assume max == 1,
as almost no browsers support more, and specs require at most one range.

As we work with text-based editables, whatever the browser puts inside, it's reasonable
to require that start and end be the children of the editable root.
If needed, we could trim the selection's start/end if it's outside.

Even with text nodes, browsers often add trash tags. We'll approach this two-fold:
1. Only consider the first TEXT node the content of the editable.
2. Remove such tags from the node on saving and from time to time.
*/

function resetSelection() {
	window.getSelection().removeAllRanges();
	var sel = window.getSelection ? window.getSelection() : document.selection;
	if (sel)
    	if (sel.removeAllRanges) {
        	sel.removeAllRanges();
    	} else if (sel.empty) {
        	sel.empty();
	    }
}
utils.export(resetSelection);

function getCaretControl() {
	var sel = window.getSelection();
	if (!sel.rangeCount)
		return null;
	var range = sel.getRangeAt(0);
	return range.commonAncestorContainer;
}
utils.export(getCaretControl);

/*
"contentEditable" implementations are weird, e.g. Firefox adds BRs once you delete all text.
Messing with these sometimes leads to even weirder behaviour.

We let the browser do what it wants but:
1. Ignore non-conforming bits
2. Further normalize the text on saving.

We assume our Editable contains at most one TextNode with the text, and ignore the rest.
*/
function Editable() {}; //easier to export, has name
utils.export(Editable);
//Returns the text content of the editable
Editable.getText = function(node) {
	//We could've narrowed it down to the child TextNode, but this is a safer bet
	//in the off-case that there are multiple of them.
	//And textContent is nice enough to remove tags and line breaks anyway.
	return node.textContent;
}
//Sets the editable text content from the scratch (without preserving any fluff)
Editable.setText = function(node, text) {
    //Same as removing all children and adding one text node:
    node.textContent = text;
}
//Locates the first and hopefully the only TextNode in the editable
Editable.getTextNode = function(node) {
	for (let i=0; i<node.childNodes.length; i++)
		if (node.childNodes[i].nodeType == Node.TEXT_NODE)
			return node.childNodes[i];
	//We expect node to have exactly one TextNode child but try to handle the case where it's forgotten too
	return node; //fallback
}
Editable.setCaret = function(node, start, end) {
	//console.log("editableSetCaret(start="+start+", end="+end+")");
	var range = document.createRange();
    
	var target = Editable.getTextNode(node);
	
	//Try to perform the closest selection to what had been asked
	var content = target.textContent; //geared towards text nodes
	if (start && (start > content.length))
		start = content.length;
	if (end && (end > content.length))
		end = content.length;
	//(start or end < 0) || (end < start) == your own damn fault
	
	range.setStart(target, start);
	if (end)
		range.setEnd(target, end);
	else
		range.collapse(true); //set end == start
   
	var sel = window.getSelection();
	sel.removeAllRanges();
	sel.addRange(range);
}
Editable.getLength = function(node) {
	return Editable.getText(node).length;
}
Editable.getSelection = function(editableNode) {
	var sel = window.getSelection();
	if (!sel.rangeCount)
		return null;
	var range = sel.getRangeAt(0);
	if (!nodeHasParent(range.commonAncestorContainer, editableNode))
		return null;
	return range;
}
//Retrieves the caret position in a given editable element, or null.
//Assumes the node only has one child of type Text (typical for editable elements)
Editable.getCaret = function(node) {
	var range = Editable.getSelection(node);
	if (!range)
		return null;
	if (range.endContainer.nodeType == Node.TEXT_NODE) {
		//Simple case: we're in the text
		//console.log("Editable.getCaret => "+range.endOffset);
		return range.endOffset;
	}
		
	//If we're outside the TEXT_NODE but inside the editable, try to return something anyway
	console.log("Editable.getCaret => in non-text: type="+range.endContainer.nodeType+", offset="+range.endOffset);
	//Go to the top level
	let container = range.endContainer;
	let offset = range.endOffset;
	while (container != node) {
		offset = container.parentNode.childNodes.values().indexOf(container);
		container = container.parentNode;
	}
	
	//Now figure whether the text is to the left or to the right
	let i = range.endOffset;
	while (i >= 1) {
		if (container.childNodes[i-1].nodeType==Node.TEXT_NODE) {
			console.log("Editable.getCaret: caret is to the right");
			return container.childNodes[i-1].textContent.length; //caret is after the end of the text
		}
	}
	console.log("Editable.getCaret: caret is to the left/empty text");
	return 0; //caret is before the start of the text or there's no text
}


/*
Misc UI
*/

//Sets focus AND caret position/selection to a given editable element with a text content.
//Assumes the node only has one child of type Text (typical for editable elements)
function element(id) {
	return document.getElementById(id);
}
utils.export(element);

function nodeHasParent(node, parent) {
	while (node && (node != parent))
		node = node.parentNode;
	return (node == parent);
}
utils.export(nodeHasParent);

//Does what it says on the tin
function nodeRemoveAllChildren(node) {
	while (node.firstChild)
    	node.removeChild(node.firstChild);
}
utils.export(nodeRemoveAllChildren);
function nodeRemoveChildrenByTagName(node, tagName) {
	let elements = node.getElementsByTagName(tagName);
	while (elements.length > 0) //the collection is live
		node.removeChild(elements[elements.length-1]);
}
utils.export(nodeRemoveChildrenByTagName);

//Returns getBoundingClientRect(), only relative not to the offsetParent but to a given parent node
//Pass null to retrieve the absolute bounding rect
function relativeBoundingRect(element, base) {
	//Either the element belongs to the same offsetParent as the base,
	//or its offsetParent belongs to the same offsetParent as the base,
	//or so on.
    var baseOffsetParent = base ? base.offsetParent : null;
	
	var rect = { top: 0, left: 0, bottom: 0, right: 0 };
    if (element) {
    	// DOMRect is read-only so write our own structure
    	let thisRect = element.getBoundingClientRect();
		rect.top = thisRect.top;
		rect.left = thisRect.left;
		rect.bottom = thisRect.bottom;
		rect.right = thisRect.right;
    }
    
	while (element.offsetParent && (element.offsetParent != baseOffsetParent)) {
		element = element.offsetParent;
		let parentRect = element.getBoundingClientRect();
		rect.left += parentRect.left;
		rect.top += parentRect.top;
		rect.right += parentRect.left;
		rect.bottom += parentRect.top;
	}
	
	if (base) {
	  var baseRect = base.getBoundingClientRect();
	  rect.left -= baseRect.left;
	  rect.top -= baseRect.top;
	  rect.right -= baseRect.left;
	  rect.bottom -= baseRect.top;
	}
	
	return rect;
}
utils.export(relativeBoundingRect);

function downloadToFile(data, type, filename) {
	//https://stackoverflow.com/a/30832210/360447
	var file = new Blob([data], {type: type});
	if (window.navigator.msSaveOrOpenBlob) { // IE10+
		window.navigator.msSaveOrOpenBlob(file, filename);
		return;
	}
    // Others
	var a = document.createElement("a"),
	url = URL.createObjectURL(file);
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	setTimeout(function() {
		document.body.removeChild(a);
		window.URL.revokeObjectURL(url);
	}, 0);
}
utils.export(downloadToFile);
function downloadAsJson(obj, title) {
	return downloadToFile(JSON.stringify(obj), 'application/json', title+'.json');
}
utils.export(downloadAsJson);

function copyToClipboard(text){
    var dummy = document.createElement("input");
    document.body.appendChild(dummy);
    dummy.value = text;
    dummy.select();
    document.execCommand("copy");
    document.body.removeChild(dummy);
}
utils.export(copyToClipboard);


/*
Dropdown menus

Initializes the dropdown menu in a given HTML element:
  element
  string => find element by id
  null => create a new element
Returns the created element.
*/
function dropdownInit(root) {
	if (typeof root == 'string')
		root = document.getElementById(root);
	else if (!root)
		root = document.createElement("div");
	root.classList.add("dropdown");
	
	var item = document.createElement("span");
	item.className = "dropbtn";
	item.addEventListener("click", dropdownClick);
	root.appendChild(item);
	root.button = item;
	
	item = document.createElement("div");
	item.className = "dropdown-content";
	root.appendChild(item);
	root.menu = item;
	
	root.clear = dropdownClear;
	root.add = dropdownAdd;
	root.addSeparator = dropdownAddSeparator;
	return root;
}
utils.export(dropdownInit);
function dropdownClear() {
	nodeRemoveAllChildren(this.menu);
}
function dropdownAdd(id, onclick, text) {
	var item = document.createElement('a');
	item.id = id;
	item.textContent = text;
	item.addEventListener("click", onclick);
	this.menu.appendChild(item);
	return item;
}
function dropdownAddSeparator(id) {
	var item = document.createElement('span');
	item.id = id;
	item.className = "menu-separator";
	this.menu.appendChild(item);
	return item;
}
function dropdownGetButton(element) {
	return element.getElementsByClassName("dropbtn")[0];
}
function dropdownGetContent(element) {
	return element.getElementsByClassName("dropdown-content")[0];
}
function dropdownClick(event) {
	dropdownGetContent(event.target.parentNode).classList.toggle("show");
}
window.addEventListener("click", (event) => {
	var dropdowns = document.getElementsByClassName("dropdown-content");
	for (let i=0; i<dropdowns.length; i++) {
		let thisButton = dropdownGetButton(dropdowns[i].parentNode);
		if ((event.target != thisButton) && dropdowns[i].classList.contains('show'))
			dropdowns[i].classList.remove('show');
	}
});

/*
Buttons
*/
function buttonNew(id, onclick, title) {
	var button = document.createElement("a");
	button.classList.add("button");
	button.id = id;
	button.title = title;
	button.addEventListener("click", onclick);
	return button;
}
utils.export(buttonNew);
function linkNew(id, onclick, title) {
	var link = document.createElement("a");
	link.href = '#';
	if (id) link.id = id;
	if (title) link.textContent = title;
	if (onclick) link.addEventListener("click", onclick);
	return link;
}
utils.export(linkNew);
//Creates a new <li> wrapper around the content
function li(content) {
	let li = document.createElement('li');
	if (typeof content == 'string')
		li.textContent = content;
	else
		li.appendChild(content)
	return li;
}
utils.export(li);


/*
Splitters and dragging
*/

function createDragShield() {
	let shield = document.createElement("div");
    shield.classList.add("dragging");
    shield.style.position = "fixed";
    shield.style.left = "0px";
    shield.style.right = "0px";
    shield.style.top = "0px";
    shield.style.bottom = "0px";
    shield.style.zIndex = 10;
    document.body.appendChild(shield);
    return shield;
}
utils.export(createDragShield);


/*
Drag manager. Implements custom dragging of an object.
*/
function DragMgr(element) {
	document.addEventListener("mousemove", (event) => this.onDocumentDragMouseMove(event));
	document.addEventListener("mouseup", (event) => this.onDocumentDragMouseUp(event));
	document.addEventListener("touchmove", (event) => this.onDocumentDragMouseMove(event));
	document.addEventListener("touchend", (event) => this.onDocumentDragMouseUp(event));
	document.addEventListener("touchcancel", (event) => this.onDocumentDragTouchCancel(event));
	if (element)
		this.addElement(element);
}
utils.export(DragMgr);
//Registers another element to be managed by this drag manager
DragMgr.prototype.addElement = function(element) {
	element.addEventListener("dragstart", (event) => { return false; }); //disable native drag
	element.addEventListener("mousedown", (event) => this.onDragMouseDown(event));
	element.addEventListener("mousemove", (event) => this.onDragMouseMove(event));
	element.addEventListener("mouseup", (event) => this.onDragMouseUp(event));
	element.addEventListener("touchstart", (event) => this.onDragMouseDown(event));
	element.addEventListener("touchmove", (event) => this.onDragMouseMove(event));
	element.addEventListener("touchend", (event) => this.onDragMouseUp(event));
	element.addEventListener("touchcancel", (event) => this.onDragTouchCancel(event));
}

DragMgr.prototype.dragConfigure = function(entry, event) {
	this.dragEntry = entry; //element to which the event have bubbled

	//calculate true offset relative to taskEntry
	var trueOffset = (event.touches) ? 
		{ x: event.touches[0].offsetX, y: event.touches[0].offsetY } :
		{ x: event.offsetX, y: event.offsetY };
	var target = event.target;
	while (target && (target!=this.dragEntry)) {
		trueOffset.x += target.offsetLeft;
		trueOffset.y += target.offsetTop;
		target = target.offsetParent;
	}

	this.dragOffsetPos = trueOffset;
}
//Drag anywhere and hold
DragMgr.prototype.onDragMouseDown = function(event) {
	this.dragConfigure(event.currentTarget, event)
	this.startDrag(); //immediately
	event.stopPropagation(); //prevent selection and drag handling on lower levels
	event.preventDefault();
}
DragMgr.prototype.onDragMouseUp = function(event) {
	this.endDrag(false);
}
DragMgr.prototype.onDragTouchCancel = function(event) {
	this.endDrag(true); //cancel
}
DragMgr.prototype.onDragMouseMove = function(event) {
	if (this.dragging)
		//Dragging, ignore mouse move events for the node itself
		event.preventDefault();
}
DragMgr.prototype.onDocumentDragMouseMove = function(event) {
	if (this.dragging) {
		if (event.touches)
			this.dragMove({x:event.touches[0].clientX, y:event.touches[0].clientY});
		else
			this.dragMove({x:event.clientX, y:event.clientY});
		event.preventDefault();
	}
}
DragMgr.prototype.onDocumentDragMouseUp = function(event) {
	//Mouseup is not required to fire, and does not fire under some conditions,
	//when the mouse is released outside the dragged element's borders.
	//This is a fallback:
	if (this.dragging || this.dragEntry)
		this.onDragMouseUp(event);
}
DragMgr.prototype.onDocumentDragTouchCancel = function(event) {
	if (this.dragging || this.dragEntry)
		this.onDragTouchCancel(event);
}
//Starts the drag
DragMgr.prototype.startDrag = function() {
	//From now on we're dragging
	this.dragging = true;
	
	this.dragStart(this.dragEntry);

	//Move first time now that it's in position:absolute
	let r = this.dragEntry.getBoundingClientRect();
	this.dragMove({
		x: r.left + this.dragOffsetPos.x,
		y: r.top + this.dragOffsetPos.y,
	});
}
//Ends the drag and commits the move
DragMgr.prototype.endDrag = function(cancelDrag) {
	if (!this.dragging) { //not yet dragging => nothing to restore
		this.dragEntry = null;
		return;
	}

	this.dragging = false;
	if (!this.dragEntry) return;

	this.dragEnd(cancelDrag);

	this.dragEntry = null;
}
//The following functions are meant to be overriden by clients.
DragMgr.prototype.dragStart = function() {
}
DragMgr.prototype.dragEnd = function(cancelDrag) {
}
//Called each time the mouse moves while dragging. Receives the mouse windowX/windowY coordinates.
DragMgr.prototype.dragMove = function(pos) {
}



function TimeoutDragMgr(element) {
	DragMgr.call(this, element);
}
inherit(DragMgr, TimeoutDragMgr);
utils.export(TimeoutDragMgr);
TimeoutDragMgr.prototype.dragConfigure = function(entry, event) {
	this.dragStartTimerAbort();
	DragMgr.prototype.dragConfigure.call(this, entry, event);
}

TimeoutDragMgr.prototype.dragStartTimerAbort = function() {
	if (this.dragStartTimer)
		clearTimeout(this.dragStartTimer);
	this.dragStartTimer = null;
}
TimeoutDragMgr.prototype.onEntryDragMouseDown = function(event) {
	this.dragConfigure(event.currentTarget, event)
	this.dragStartTimer = setTimeout(this.dragStart, 500);
}
TimeoutDragMgr.prototype.onEntryDragMouseUp = function(event) {
	this.dragStartTimerAbort();
	DragMgr.prototype.onEntryDragMouseUp.call(this, event);
}
TimeoutDragMgr.prototype.onEntryDragTouchCancel = function(event) {
	this.dragStartTimerAbort();
	DragMgr.prototype.onEntryDragTouchCancel.call(this, event);
}
TimeoutDragMgr.prototype.onEntryDragMouseMove = function(event) {
	if (!this.dragging)
		//Mouse moved before timer fired, abort timer
		this.dragStartTimerAbort();
	DragMgr.prototype.onEntryDragMouseMove.call(this, event);
}
TimeoutDragMgr.prototype.startDrag = function() {
	this.dragStartTimerAbort();
	DragMgr.prototype.startDrag.call(this, event);
}

function TaskDragMgr(element) {
	TimeoutDragMgr.call(this, element);
}
inherit(TimeoutDragMgr, TaskDragMgr);
utils.export(TaskDragMgr);
TaskDragMgr.prototype.dragStart = function() {
	//Notify the subscribers
	//We leave most of the drag handling outside for now
	var event = new CustomEvent("dragstart");
	event.entry = this.dragEntry;
	this.dispatchEvent(event);
}
TaskDragMgr.prototype.dragEnd = function(cancelDrag) {
	//Notify the subscribers
	var event = new CustomEvent("dragend");
	event.entry = this.dragEntry;
	event.cancelDrag = cancelDrag;
	this.dispatchEvent(event);
}
TaskDragMgr.prototype.dragMove = function(pos) {
	//Notify the subscribers
	var event = new CustomEvent("dragmove");
	event.entry = this.dragEntry;
	event.pos = pos;
	this.dispatchEvent(event);
}


/*
Splitter element.
 * Saves and restores widths
 * Vertical or horizontal
TODO:
 * Detects which element to the left or to the right should be resized
 
For width-saving to work:
 1. Pass ID for this particular element (or set ID for the HTML element)
 2. Set static Splitter.ID_BASE - so that different pages don't clash.
*/
function Splitter(element, id) {
	this.box = element;
	if (this.box) {
		this.autoDetectDirection();
	} else {
		this.box = document.createElement('div');
	}
	
	//For size saving and loading an ID must be passed
	this.id = id ? id : this.box.id;
	this.sizeLoad();
	
	//Dragging and resizing
	this.dragMgr = new DragMgr(this.box);
	this.dragMgr.dragStart = () => { this.dragStart(); }
	this.dragMgr.dragEnd = (cancelDrag) => { this.dragEnd(cancelDrag); }
	this.dragMgr.dragMove = (pos) => { this.dragMove(pos); }

}
utils.export(Splitter);
Splitter.ID_BASE = 'splitter_';
//Automatically detects whether we are vertical or horizontal.
Splitter.prototype.autoDetectDirection = function() {
	let style = window.getComputedStyle(this.box.parentElement);
	console.log(this.box.parentElement, style.flexDirection);
	if (style.flexDirection=='row')
		this.setDirection('V');
	else if (style.flexDirection=='column')
		this.setDirection('H');
	else
		this.setDirection(null);
	//Which element do we grow?
	let prev = this.box.previousElementSibling;
	let prevStyle = prev ? window.getComputedStyle(prev) : null;
	let next = this.box.nextElementSibling;
	let nextStyle = next ? window.getComputedStyle(next) : null;
	if (!prevStyle || !nextStyle)
		this.growElement = null;
	else if (!nextStyle.flexGrow)
		this.growElement = next;
	else
		this.growElement = prev;
	console.log(prevStyle.flexGrow, nextStyle.flexGrow);
	console.log(this.growElement);
}
//H = ---; V = |.
Splitter.prototype.setDirection = function(value) {
	this.style = value;
	this.box.classList.toggle('splitter', true);
	this.box.classList.toggle('splitterV', (this.style=='V'));
	this.box.classList.toggle('splitterH', (this.style=='H'));
}
//Saves and restores user-defined width of the panel. The base element must have id.
Splitter.prototype.sizeSave = function() {
	if (!this.id || !this.growElement) return;
	console.log('Saving size:', this.id, this.growElement.offsetWidth, this.growElement.clientWidth);
	setLocalStorageItem(Splitter.ID_BASE+this.id+".width", this.growElement.offsetWidth);
}
Splitter.prototype.sizeLoad = function() {
	if (!this.id || !this.growElement) return;
	let width = Number(getLocalStorageItem(Splitter.ID_BASE+this.id+".width"));
	console.log('Restoring size:', this.box.id, width);
	if (width)
		this.growElement.style.width = width+'px';
}
Splitter.prototype.dragStart = function() {
	console.log('dragStart');
	if (!this.growElement)
		return;
	this.dragStartWidth = this.growElement.style.width;
	//To prevent mouse cursor from changing over unrelated elements + to avoid interaction with them,
	//we need to shield the page while dragging
	this.dragShield = createDragShield();
}
Splitter.prototype.dragMove = function(pos) {
	console.log('dragMove', pos);
	this.growElement.style.width = pos.x + 'px';
}
Splitter.prototype.dragEnd = function(cancelDrag) {
	console.log('dragEnd', cancelDrag);
	if (cancelDrag && (typeof this.dragStartWidth != 'undefined')) {
		this.growElement.style.width = this.dragStartWidth;
		delete this.dragStartWidth;
	} else
		this.sizeSave();
	//Remove the shield
	if (this.dragShield) {
		document.body.removeChild(this.dragShield);
		delete this.dragShield;
	}
}







/*
Custom page object.
Provides a promise which will be resolved (with collected results) or rejected (on cancel).
Clients have to override 'ok' event and page.resolve() if they are satisfied.
*/
//A special rejection object that's returned when the window is cancelled --
//check for it to distinguish from other errors
function FormCancelError() {}
utils.export(FormCancelError);

function CustomPage(pageElement) {
	//The HTML base element can be created from scratch or reused
	this.page = pageElement;
	
	//Dummy element to use its EventTarget.
	//We don't want to use this.page's event target as this.page might be permanent
	//and handlers attached to this CustomPage() will remain after CustomPage() destructs.
	this.eventTarget = document.createElement('div');
	
	//Calling either of these closes the page
	this.promise = new Promise((_resolve, _reject) => {
		this.resolve = _resolve;
		this.reject = _reject;
	});

	//Cleanup
	this.promise
	.catch(() => {})
	.then(() => {
		this.promise = null; //prevent further access
		this.resolve = null;
		this.reject = null;
		this.close();
	});
}
utils.export(CustomPage);
//Clients can wait for the page to be either OK'd or Cancelled
CustomPage.prototype.waitResult = function() {
	return this.promise;
};
CustomPage.prototype.addEventListener = function() {
	this.eventTarget.addEventListener.apply(this.eventTarget, arguments);
}
CustomPage.prototype.removeEventListener = function() {
	this.eventTarget.removeEventListener.apply(this.eventTarget, arguments);
}
//Clients can subscribe to events which the descendants can raise
CustomPage.prototype.dispatchEvent = function(name, args) {
	let event = new CustomEvent(name);
	for (let key in args)
		event[key] = args[key];
	this.eventTarget.dispatchEvent(event);
}
//Two predefined events are OK and Cancel, you only have to raise these as handlers
CustomPage.prototype.okClick = function(results) {
	//Either pass the results or override the collection proc
	if (!results) results = this.collectResults();
	this.dispatchEvent('ok', { results: results, });
}
//Override to verify input and collect it for passing outside
CustomPage.prototype.collectResults = function() {
	return null;
}
CustomPage.prototype.cancelClick = function() {
	this.dispatchEvent('cancel');
	//Automatically rejects the form with FormCancelError
	this.reject(new FormCancelError());
}
//Closes the page when it's completed or cancelled. Override to provide.
CustomPage.prototype.close = function() {
}


/*
Debug
*/
if (options && !options.debug)
	console.debug = () => {}; //Let's be evil; no printing
else if (!console.debug)
console.debug = function () { console.log.apply(this, arguments); }
