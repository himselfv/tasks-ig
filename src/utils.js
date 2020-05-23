
/*
Application-wide options
Loaded at this point because all scripts may rely on them - more thorough handling in main code.
Note: Before the main code sets default values, all defaults are undefined.
*/
var options = options || {};
function optionsLoad() {
	options = Object.assign({}, getLocalStorageItem("tasksIg_options"), options);
	console.debug('options loaded:', options);
}
function optionsSave() {
	setLocalStorageItem("tasksIg_options", options);
	//Update everything in the UI that depends on options. We are lazy:
	document.location.reload();
}
function optionsSetDefaults(optionSet) {
	for (let key in optionSet)
		if (!(key in options))
			options[key] = optionSet[key].default;
}
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

//Accepts a dictionary ID->src
//Returns a promise that's fulfilled when ALL the given JSs are loaded
function loadScripts(scripts) {
	batch = [];
	Object.keys(scripts).forEach(key => {
		batch.push(loadScript(key, scripts[key]))
	});
	return Promise.all(batch);
}


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


/*
Inheritance
*/
function inherit(fromWhat, what) {
	what.prototype = Object.create(fromWhat.prototype);
	what.prototype.constructor = what;
}


/*
Stores/retrieves local storage entries as JSON
*/
function getLocalStorageItem(key) {
	var data = window.localStorage.getItem(key);
	return (data) ? JSON.parse(data) : null;
}
function setLocalStorageItem(key, value) {
	window.localStorage.setItem(key, JSON.stringify(value));
}


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

function getCaretControl() {
	var sel = window.getSelection();
	if (!sel.rangeCount)
		return null;
	var range = sel.getRangeAt(0);
	return range.commonAncestorContainer;
}

/*
"contentEditable" implementations are weird, e.g. Firefox adds BRs once you delete all text.
Messing with these sometimes leads to even weirder behaviour.

We let the browser do what it wants but:
1. Ignore non-conforming bits
2. Further normalize the text on saving.

We assume our Editable contains at most one TextNode with the text, and ignore the rest.
*/
//Returns the text content of the editable
function editableGetText(node) {
	//We could've narrowed it down to the child TextNode, but this is a safer bet
	//in the off-case that there are multiple of them.
	//And textContent is nice enough to remove tags and line breaks anyway.
	return node.textContent;
}
//Sets the editable text content from the scratch (without preserving any fluff)
function editableSetText(node, text) {
    //Same as removing all children and adding one text node:
    node.textContent = text;
}
//Locates the first and hopefully the only TextNode in the editable
function editableGetTextNode(node) {
	for (let i=0; i<node.childNodes.length; i++)
		if (node.childNodes[i].nodeType == Node.TEXT_NODE)
			return node.childNodes[i];
	//We expect node to have exactly one TextNode child but try to handle the case where it's forgotten too
	return node; //fallback
}
function editableSetCaret(node, start, end) {
	//console.log("editableSetCaret(start="+start+", end="+end+")");
	var range = document.createRange();
    
	var target = editableGetTextNode(node);
	
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


/*
Misc UI
*/

function editableGetLength(node) {
	return editableGetText(node).length;
}
function editableGetSelection(editableNode) {
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
function editableGetCaret(node) {
	var range = editableGetSelection(node);
	if (!range)
		return null;
	if (range.endContainer.nodeType == Node.TEXT_NODE) {
		//Simple case: we're in the text
		//console.log("editableGetCaret => "+range.endOffset);
		return range.endOffset;
	}
		
	//If we're outside the TEXT_NODE but inside the editable, try to return something anyway
	console.log("editableGetCaret => in non-text: type="+range.endContainer.nodeType+", offset="+range.endOffset);
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
		if (editable.childNodes[i-1].nodeType==Node.TEXT_NODE) {
			console.log("editableGetCaret: caret is to the right");
			return editable.childNodes[i-1].textContent.length; //caret is after the end of the text
		}
	}
	console.log("editableGetCaret: caret is to the left/empty text");
	return 0; //caret is before the start of the text or there's no text
}

//Sets focus AND caret position/selection to a given editable element with a text content.
//Assumes the node only has one child of type Text (typical for editable elements)
function element(id) {
	return document.getElementById(id);
}

function nodeHasParent(node, parent) {
	while (node && (node != parent))
		node = node.parentNode;
	return (node == parent);
}

//Does what it says on the tin
function nodeRemoveAllChildren(node) {
	while (node.firstChild)
    	node.removeChild(node.firstChild);
}
function nodeRemoveChildrenByTagName(node, tagName) {
	let elements = node.getElementsByTagName(tagName);
	while (elements.length > 0) //the collection is live
		node.removeChild(elements[elements.length-1]);
}

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
function downloadAsJson(obj, title) {
	return downloadToFile(JSON.stringify(obj), 'application/json', title+'.json');
}

function copyToClipboard(text){
    var dummy = document.createElement("input");
    document.body.appendChild(dummy);
    dummy.value = text;
    dummy.select();
    document.execCommand("copy");
    document.body.removeChild(dummy);
}


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
function linkNew(id, onclick, title) {
	var link = document.createElement("a");
	link.href = '#';
	if (id) link.id = id;
	if (title) link.textContent = title;
	if (onclick) link.addEventListener("click", onclick);
	return link;
}
//Creates a new <li> wrapper around the content
function li(content) {
	let li = document.createElement('li');
	if (typeof content == 'string')
		li.textContent = content;
	else
		li.appendChild(content)
	return li;
}



/*
Custom page object.
Provides a promise which will be resolved (with collected results) or rejected (on cancel).
Clients have to override 'ok' event and page.resolve() if they are satisfied.
*/
//A special rejection object that's returned when the window is cancelled --
//check for it to distinguish from other errors
function FormCancelError() {}

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
if (!options.debug)
	console.debug = () => {}; //Let's be evil; no printing
else if (!console.debug)
	console.debug = () => { console.log.apply(arguments); }
