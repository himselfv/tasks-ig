
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
	if (range.endContainer.nodeType != Node.TEXT_NODE) {
		log("editableGetCaret => in non-text, null");
		return null;
	}
	return range;
}
//Retrieves the caret position in a given editable element, or null.
//Assumes the node only has one child of type Text (typical for editable elements)
function editableGetCaret(node) {
	var range = editableGetSelection(node)
	//log("editableGetCaret => "+range.endOffset);
	return range.endOffset;
}

//Sets focus AND caret position/selection to a given editable element with a text content.
//Assumes the node only has one child of type Text (typical for editable elements)
function editableSetCaret(node, start, end) {
	//log("editableSetCaret(start="+start+", end="+end+")");
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
*/
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
Debug
*/
function log(message) {
	console.log(message);
}