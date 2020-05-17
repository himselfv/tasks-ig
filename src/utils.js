
/*
Load additional JS
*/
//Returns a promise that's fulfilled when the JS is loaded
function loadScript(scriptId, scriptSrc) {
	return new Promise((resolve, reject) => {
		var script = document.getElementById(scriptId);
		if (script && (script.readyState == "complete")) {
			console.log("script already loaded: ", scriptId);
			resolve();
			return;
		}
		if (!script) {
			console.log('inserting script '+scriptSrc);
			script = document.createElement('script');
			script.id = scriptId;
			script.src = scriptSrc;
			script.async = true;
			script.defer = true;
			//Some browsers fire readyStateChange, others onLoad and don't even support readyState
			//We need some indication that the script has finished loading, so reimplement readyState if it's not there
			script.addEventListener("readystatechange", () => { if (script.readyState == 'complete') script.onload(); });
			script.addEventListener("load", () => { if (!script.readyState) script.readyState = "complete"; });
			document.body.append(script);
		}
		console.log(script);
		console.log(script.readyState);
		script.addEventListener("load", () => { console.log('loaded script'); resolve(); } );
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


/*
Debug
*/
function log(message) {
	console.log(message);
}
function dump(value, name) {
	if (name)
		console.log(name+': '+JSON.stringify(value));
	else
		console.log(name);
}