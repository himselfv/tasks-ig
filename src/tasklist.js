/*
Task entries are HTML representation of tasks in the active task list.

Entries are stored in a flat list and each is assigned a nesting level. These
levels convey their relations.

Usage:
  tasks.clear()
  tasks.appendTasks(null, 0) //load all tasks

Events:
  Subscribe to the events of the list control, most events are routed there.

Custom events (all have .entry property == which entry):
  dragstart/dragend/dragmove -- only fire when the drag actually starts
  titlechanged	-- on typing or paste
  titlefocusout	-- title editing defocused
  editclicked	-- edit command for this entry
  checked 		-- checked state changed for this entry
  keypress 		-- capture for the list, check whether it's for the entry
*/
'use strict';
if (typeof require != 'undefined') {
	require('./utils.js').importSelf();
}
var unit = new Unit((typeof exports != 'undefined') && exports);


//Creates a task tree object in a given base element
function TaskList(where) {
	this.root = where;
	this.dragMgr = new TaskEntryDragMgr(this);
	this.dragMgr.autoShield = true;
	this.dragMgr.dragDelay = 500;
	//Most events are rerouted from the underlying HTMLElement. Some are extended/replaced with custom ones.
	//Rewired events (don't follow the standard ES drag model):
  	//  dragstart/dragmove/dragend
	this.setupEventTarget(this.root);
}
unit.export(TaskList);
AddCustomEventTarget(TaskList);
TaskList.prototype.toString = function() {
	return "TaskList " + this.root.toString();
}


//Clears the task list entirely
TaskList.prototype.clear = function() {
	this.clearFocus();
	nodeRemoveAllChildren(this.root);
}
//Appends a task entry to the end of the list. Does not change its nesting level.
TaskList.prototype.appendEntry = function(entry) {
	return this.root.appendChild(entry.node);
}
//Inserts a task entry before the given task entry or at the bottom. Does not change its nesting level.
TaskList.prototype.insertEntryBefore = function(entry, beforeEntry) {
	if (beforeEntry)
		this.root.insertBefore(entry.node, beforeEntry.node);
	else
		this.appendEntry(entry);
}
//Inserts a task entry after the given task entry or at the top. Does not change its nesting level
TaskList.prototype.insertEntryAfter = function(entry, afterEntry) {
	this.insertEntryBefore(entry, afterEntry ? afterEntry.getNext() : this.first())
}

//Appends a new node for a given task to the end of the list
//Previously: taskListAppend
TaskList.prototype.appendTask = function(task, level) {
	this.appendEntry(this.createEntry(task, level));
}
//Adds all child tasks of a given parent task at a given level, recursively.
// taskRecords: All tasks in the currently selected list (including all the children)
TaskList.prototype.appendTaskChildren = function(parentId, level, taskRecords) {
	//Select all direct children from the list
	let children = [];
	for (let i=0; i<taskRecords.length; i++) {
		let task = taskRecords[i];
		if (!parentId && (task.parent))
			continue;
		if ((parentId) && (task.parent != parentId))
			continue;
		if (!options.showDeleted && task.deleted)
			continue;
		children.push(task);
	}
	//Sort by position
	children = children.sort((a, b) => a.position - b.position);
	//Publish, with recursive children
	this.appendTasksWithChildren(children, level, taskRecords)
}
//Adds all tasks that specify a parent not from this list
TaskList.prototype.appendOrphans = function(taskRecords) {
	//console.debug('appendOrphans', arguments);
	//Convert task records to dict
	let tasks = {};
	for (let i=0; i<taskRecords.length; i++)
		tasks[taskRecords[i].id] = taskRecords[i];
	//Find orphans
	let orphans = [];
	for (let i=0; i<taskRecords.length; i++) {
		let task = taskRecords[i];
		if (!task.parent || (task.parent in tasks))
			continue;
		if (!options.showDeleted && task.deleted)
			continue;
		orphans.push(task);
	}
	//console.debug('appendOrphans: orphans=', orphans);
	//Publish, with recursive children (those are not orphans)
	this.appendTasksWithChildren(orphans, 0, taskRecords);
}
TaskList.prototype.appendTasksWithChildren = function(tasks, level, taskRecords) {
	for (let i=0; i < tasks.length; i++) {
		this.appendTask(tasks[i], level);
		//prevent some dumb endless recursions
		if (!tasks[i].id || (tasks[i].id==tasks[i].parent)) {
			//console.log('TaskList: task ID is weird, preventing recursion');
			continue;
		}
		this.appendTaskChildren(tasks[i].id, level+1, taskRecords); //Add children
	}
}


//Creates a task entry object
//Previously: taskEntryCreate
TaskList.prototype.createEntry = function(task, level) {
	var entry = new TaskEntry(task);
	entry.setLevel(level);
	this.dragMgr.addElement(entry);
	entry.addEventListener("focusin", this.onEntryFocus.bind(this));
	entry.addEventListener("focusout", this.onEntryBlur.bind(this));
	entry.gripCtl.addEventListener("mousedown", this.onEntryDragGripMouseDown.bind(this));
	entry.gripCtl.addEventListener("touchstart", this.onEntryDragGripMouseDown.bind(this));
	entry.titleCtl.addEventListener("blur", this.onEntryTitleFocusOut.bind(this), true);
	return entry;
}

//Previously: taskEntryDelete
TaskList.prototype.delete = function(entry) {
	this.clearFocus(entry); //because we don't clear on blur
	entry.node.remove();
}


//Creates a task entry object
function TaskEntry(task) {
	//Node is a root HTML node of our entry
	this.node = document.createElement("div");
	this.node.className = "task";
	this.node.taskId = task.id;
	this.node.taskEntry = this; //reverse link
	this.node.addEventListener("click", this.onNodeClicked.bind(this));

	//Task entries forward to and extend node's event dispatcher
	this.setupEventTarget(this.node);

	var item = null;

	item = document.createElement("div");
	item.className = "dragGrip";
	this.node.appendChild(item);
	this.gripCtl = item;

	item = document.createElement("input");
	item.type = "checkbox";
	item.className = "taskCheck";
	item.display = "inline";
	item.addEventListener("change", this.onChecked.bind(this));
	this.node.appendChild(item);
	this.checkCtl = item;

	var wrap = document.createElement("div");
	wrap.className="taskWrap";
	this.node.appendChild(wrap)

	item = document.createElement("div");
	item.className = "taskTitle";
	item.contentEditable=true;
	item.addEventListener("input", this.onTitleInput.bind(this));
	item.addEventListener("paste", this.onTitlePaste.bind(this));
	wrap.appendChild(item);
	this.titleCtl = item;

	item = document.createElement("p");
	item.className = "taskNotesShort";
	item.addEventListener("click", this.onEditClicked.bind(this));
	wrap.appendChild(item);
	this.notesCtl = item;

	item = document.createElement("p");
	item.className = "taskDue";
	item.addEventListener("click", this.onEditClicked.bind(this));
	wrap.appendChild(item);
	this.dueCtl = item;

	item = document.createElement("a");
	item.className = "taskEditLink";
	item.appendChild(document.createTextNode(">"));
	item.addEventListener("click", this.onEditClicked.bind(this));
	this.node.appendChild(item);

	this.setTitle(task.title);
	this.setNotes(task.notes);
	this.setDue(task.due);
	this.setCompleted(task.status=="completed");
	this.setDeleted(!!task.deleted)
}
unit.export(TaskEntry);
TaskEntry.prototype.toString = function() {
	return this.node.toString();
}
AddCustomEventTarget(TaskEntry);

//Updates visual representation of a given task with given changes
//Only some changes are reflected. Deletions, moves and nesting changes in general aren't
//Previously: taskEntryPatch
TaskEntry.prototype.patch = function(patch) {
	if ('title' in patch)	this.setTitle(patch.title);
	if ('notes' in patch)	this.setNotes(patch.notes);
	if ('due' in patch)		this.setDue(patch.due);
	if ('status' in patch)	this.setCompleted(patch.status=="completed");
	if ('deleted' in patch)	this.setDeleted(!!patch.deleted);
}
//Same but you can just pass the patch set without the entry object
TaskList.prototype.patchEntry = function(patch, entry) {
	if (!entry) entry = this.find(patch.id);
	entry.patch(patch);
}


//Task nodes are really kept in a flat list. You can iterate through it linearly
TaskList.prototype.first = function() {
	var firstChild = this.root.firstChild;
	return firstChild ? firstChild.taskEntry : null;
}
TaskList.prototype.last = function() {
	var lastChild = this.root.lastChild;
	return lastChild ? lastChild.taskEntry : null;
}
//Returns the task entry just above this one in the list, or null
TaskEntry.prototype.getPrev = function() {
	var prevElement = this.node.previousElementSibling;
	return prevElement ? prevElement.taskEntry : null;
}
TaskEntry.prototype.getNext = function() {
	var nextElement = this.node.nextElementSibling;
	return nextElement ? nextElement.taskEntry : null;
}
//Returns an array of all entries, in the order shown
TaskList.prototype.allEntries = function() {
    var results = [];
    var entry = this.first();
    while(entry != null) {
      results.push(entry);
      entry = entry.getNext();
    }
    return results;
}


/*
Every task has an ID chosen by the backend.
While the backend has not yet created the task, the entry uses PromisedID instead.
Use:
  entry.promiseId( backend.createTask() ); // <<-- pass a promise returning Task resource
  entry.whenHaveId().then(id => doSomethingWithId(id));

Once you've called whenHaveId() you'll get it even if the TaskEntry itself is deleted.
*/

//Returns the taskId associated with the given entry
TaskEntry.prototype.getId = function() {
	return this.node.taskId;
}
TaskEntry.prototype.setId = function(id) {
	this.node.taskId = id;
}
//Returns a task entry with associated task or task id
TaskList.prototype.find = function(taskId) {
	if (taskId && taskId.id) taskId = taskId.id;
	var nodes = this.root.children;
	for (let i = 0; i < nodes.length; i++) {
		if (nodes[i].taskId == taskId)
			return nodes[i].taskEntry;
	}
	return null;
}
/*
Installs a new ID promise based on a task promise
ID promise:
 1. Available in place of ID until it completes
 2. Returns ID when fulfilled
 3. Updates the ID in a task it's assigned to
*/
TaskEntry.prototype.promiseId = function(taskPromise) {
	var idProm = taskPromise.then(task => {
		this.setId(task.id)
		return task.id;
	});
	this.setId(idProm);
	return idProm;
}
//Returns a promise which resolves to a task ID, whether it's already available or not
TaskEntry.prototype.whenHaveId = function() {
	//Promise.resolve(X) works for both promise and value Xes
	return Promise.resolve(this.getId());
}
//Returns a promise to resolve IDs for all entries from a given list.
//If an entry is null, null will be returned as its ID.
function taskEntryNeedIds(entries) {
	var prom = [];
	entries.forEach(entry => {
		if (entry)
			prom.push(entry.whenHaveId());
		else
			prom.push(Promise.resolve(null));
	});
	return Promise.all(prom);
}
unit.export(taskEntryNeedIds);


//True if a given element is a task entry's main node
function elementIsTaskEntryNode(element) {
	return element && Object.prototype.hasOwnProperty.call(element, "taskId");
}
//Returns the task node that contains a given control, or null
function elementGetOwnerTaskNode(element) {
	while (element && !elementIsTaskEntryNode(element))
		element = element.parentNode;
	return element;
}
function elementGetOwnerTaskEntry(element) {
	element = elementGetOwnerTaskNode(element)
	return element ? element.taskEntry : null;
}
unit.export(elementGetOwnerTaskEntry);


//Each entry has an associated nesting level
//Since this is really a flat list, this level defines which nodes are parent and siblings to this one

//Returns nesting level as stored in the node itself
TaskEntry.prototype.getLevel = function() {
	return this.taskNestingLevel ? this.taskNestingLevel : 0;
}
TaskEntry.prototype.setLevel = function(level) {
	var oldLevel = this.taskNestingLevel;
	if (!oldLevel) oldLevel = 0;
	this.node.classList.remove("childlvl-"+oldLevel);
	this.taskNestingLevel = level;
	this.node.classList.add("childlvl-"+level);
	this.node.style.paddingLeft = (level*10) + "px"; /* can also rely purely on CSS */
}
//Increases or decreases the entry's nesting level (recursive == with children)
TaskEntry.prototype.adjustLevel = function(shift, recursive) {
	var allChildren = (recursive) ? (this.getAllChildren()) : [];
	this.setLevel(this.getLevel()+shift);
	allChildren.forEach(child => child.setLevel(child.getLevel()+shift));
}


//Based on its nesting level and its position relative to other nodes,
//the task node may have a parent, two siblings and multiple children.

//Returns a parent node of this node, or null
TaskEntry.prototype.getParent = function() {
	//Parents are always above us
	var level = this.getLevel();
	if (level == 0) return null; //shortcut
	var node = this.node.previousElementSibling;
	while (node) {
		if (node.taskEntry.getLevel() < level)
			return node.taskEntry;
		node = node.previousElementSibling;
	}
	return null;
}
//True if a task node is a child node of a given parent node or that parent node itself
//Previously: taskEntryHasParent
TaskEntry.prototype.isChildOf = function(parent) {
	var entry = this;
	while (entry && (entry != parent))
		entry = entry.getParent();
}

//Previous on the same level
TaskEntry.prototype.getPreviousSibling = function() {
	var level = this.getLevel();
	var node = this.node.previousElementSibling;
	while (node && (node.taskEntry.getLevel() > level))
		node = node.previousElementSibling;
	if (!node || (node.taskEntry.getLevel() < level)) //we're at the top in this parent
  		return null;
	return node.taskEntry;
}
//Next on the same level
TaskEntry.prototype.getNextSibling = function() {
	var level = this.getLevel();
	var node = this.node.nextElementSibling;
	while (node && node.taskEntry.getLevel() > level)
		node = node.nextElementSibling;
	if (!node || (node.taskEntry.getLevel() < level))
		return null;
	return node.taskEntry;
}
//Returns child task nodes recursively up to 'maxlevels' deep, in the order shown
TaskEntry.prototype.getChildren = function(maxlevels) {
	if (!maxlevels) maxlevels = 1;
	var result = [];
	var level = this.getLevel();
	var node = this.node.nextElementSibling;
	while (node && (node.taskEntry.getLevel() > level)) {
		if (node.taskEntry.getLevel() <= level + maxlevels)
			result.push(node.taskEntry);
		node = node.nextElementSibling;
	}
	return result;
}
//Shortcut
TaskEntry.prototype.getAllChildren = function() {
	return this.getChildren(1000);
}
//Returns the last direct child or null
//Previously: getLastChild
TaskEntry.prototype.getLastDirectChild = function(){
	var children = this.getChildren();
	return (children.length > 0) ? children[children.length-1] : null;
}

/*
Moves the node with all of its children and/or updates theirs nesting levels.
newLevel:New nesting level to be applied to this task (and to shift its children accordingly)
Previously: taskEntryMove
*/
TaskEntry.prototype.move = function(newPrev, newLevel) {
	//Get the node's children before it's moved
	var allChildren = this.getAllChildren();
	//Move the node itself
	if (newPrev != this.getPrev())
		if (newPrev)
			newPrev.node.parentNode.insertBefore(this.node, newPrev.node.nextSibling);
		else
			this.node.parentNode.insertBefore(this.node, this.node.parentNode.firstChild);
	//Level adjustment to apply to node and all children
	var levelShift = newLevel - this.getLevel();
	this.setLevel(newLevel);

	//Move its children
	return this.insertEntriesAfter(allChildren, levelShift);
}
//Previously: taskEntryMoveChilren, this==entry_from
TaskEntry.prototype.moveChildren = function(newPrev, levelShift) {
	return newPrev.insertChildren(
		this.getAllChildren(),
		levelShift
	);
}
//Previously: taskEntryInsertChildren, this==insertAfter
TaskEntry.prototype.insertEntriesAfter = function(entries, levelShift) {
	var newNextNode = this.node.nextSibling;
	entries.forEach(entry => {
		this.node.parentNode.insertBefore(entry.node, newNextNode);
		entry.adjustLevel(levelShift);
	    //Wait, why had we been doing this? If we're inserting them in order, newNextNode is going to be the same!
		//newNextNode = entry.node;
	});
	return this;
}


/*
Task entry data contents
Most controls are available as fields (see TaskEntry constructor) so don't need getters
*/
//Returns a given control for the given entry
TaskEntry.prototype.getControl = function(className) {
	var control = this.node.getElementsByClassName(className)[0];
	if (!control)
		throw "Control '"+className+"' not found for taskEntry '"+this.node+'"';
	return control;
}

//Returns the title text of the task, compatible with caret functions
TaskEntry.prototype.getTitle = function() {
	return Editable.getText(this.titleCtl);
}
TaskEntry.prototype.setTitle = function(title) {
	Editable.setText(this.titleCtl, title);
}
//Cleans the title text for saving
function taskEntryNormalizeTitle(title) {
	//Trim the spaces. Loading text with the space later behaves weird in some browsers.
	return title.trim();
}
unit.export(taskEntryNormalizeTitle);
TaskEntry.prototype.setNotes = function(notes) {
	nodeRemoveAllChildren(this.notesCtl);
	if (notes)
		//Trim notes and further ellipsis-trim + single-line with CSS
		this.notesCtl.appendChild(document.createTextNode(notes.substring(0, 200)));
}
TaskEntry.prototype.setDue = function(due) {
	nodeRemoveAllChildren(this.dueCtl);
	if (due) {
		let date = new Date(due);
		this.dueCtl.appendChild(document.createTextNode(date.toDateString()));
	}
}
TaskEntry.prototype.getCompleted = function() {
	return this.checkCtl.checked;
}
TaskEntry.prototype.setCompleted = function(completed) {
	this.checkCtl.checked = completed;
	this.node.classList.toggle("completed", completed);
}
TaskEntry.prototype.setDeleted = function(deleted) {
	this.node.classList.toggle("deleted", deleted);
}

/*
Focus and caret position.
Last focused task node remains "focused"; task operations apply to it.
*/
TaskEntry.prototype.getLength = function() {
	var ret = Editable.getLength(this.titleCtl);
	//console.log("entry.getLength => "+ret);
	return ret;
}
TaskEntry.prototype.getSelection = function() {
	return Editable.getSelection(this.titleCtl);
}
TaskEntry.prototype.getCaret = function() {
	var ret = Editable.getCaret(this.titleCtl);
	//console.log("entry.getCaret => "+ret);
	return ret;
}
TaskEntry.prototype.setCaret = function(start, end) {
	//console.log("entry.setCaret("+start+", "+end+")");
	Editable.setCaret(this.titleCtl, start, end);
}
TaskList.prototype.onEntryFocus = function(event) {
	console.log("entryfocus");
	console.log(event);
	if (this.focusedTaskEntry)
		this.clearFocus(this.focusedTaskEntry);
	this.focusedTaskEntry = event.currentTarget.taskEntry;
	event.currentTarget.classList.add("focused");
	this.focusChanged();
}
TaskList.prototype.onEntryBlur = function(event) {
	//Do nothing -- remember the focus
}
//Removes the focus markings. Only called manually
TaskList.prototype.clearFocus = function(entry) {
	if (!entry || (this.focusedTaskEntry == entry))
		this.focusedTaskEntry = null;
	if (entry)
		entry.node.classList.remove("focused");
	this.focusChanged();
}
TaskList.prototype.focusChanged = function() {
	var event = new CustomEvent("focuschanged");
	this.dispatchEvent(event);
}
//Returns the currently focused taskEntry or null
TaskList.prototype.getFocusedEntry = function() {
	//Check that the remembered entry is still valid -- could've been deleted for any number of reasons
	if (this.focusedTaskEntry && !document.body.contains(this.focusedTaskEntry.node))
		this.clearFocus(this.focusedTaskEntry);
	var caretEntry = elementGetOwnerTaskEntry(getCaretControl());
	//"focusedTaskEntry == null" may happen if we're called from onblur, before next onfocus
	if (caretEntry && (caretEntry != this.focusedTaskEntry) && (this.focusedTaskEntry != null))
		console.log("Focus is different from the active entry!");
	return this.focusedTaskEntry;
}


/*
Task Entry events.
WARNING! All on* functions are called with [this]==event target despite being under TaskEntry
*/
TaskEntry.prototype.onEditClicked = function() {
	var event = new CustomEvent("editclicked", {bubbles: true});
	event.entry = this;
	this.dispatchEvent(event);
}
TaskEntry.prototype.onChecked = function() {
    this.setCompleted(this.checkCtl.checked); //re-style the entry
	var event = new CustomEvent("checked", {bubbles: true});
	event.entry = this;
	this.dispatchEvent(event);
}
TaskEntry.prototype.onNodeClicked = function(event) {
	//node contains more than the title but if the click is on the empty space (usually the title margins), focus the title
	if (event.target == event.currentTarget) {
		var entry = event.target.taskEntry;
		entry.setCaret();
	}
}
//Called to notify the subscribers of the changes in title caused by user
TaskEntry.prototype.titleChanged = function() {
	var event = new CustomEvent("titlechanged", {bubbles: true});
	event.entry = this;
	this.dispatchEvent(event);
}
//Called when the user types in the task title
TaskEntry.prototype.onTitleInput = function() {
	this.titleChanged();
}
TaskEntry.prototype.onTitlePaste = function(event) {
	event.preventDefault(); //do not paste as HTML
	var pasteText = event.clipboardData.getData("text/plain") //as plain text
		.replace('\r','').replace('\n',''); //remove linebreaks for now, though we can also treat them like a "new entry" signals
	//Paste the data at the caret position
	var selection = this.getSelection();
	if (!selection) {
		console.log("caret outside the paste-event control, wut");
		return;
	}
	//Delete any selected text and replace it by pasted text
	var title = this.getTitle();
	title = title.substring(0, selection.startOffset) + pasteText + title.substring(selection.endOffset);
	this.setTitle(title);
	this.setCaret(selection.startOffset + pasteText.length);
	this.titleChanged();
}


/*
Task list events
*/

//Called when the user moves out of the task title. The clients usually want to commit the changes
TaskList.prototype.onEntryTitleFocusOut = function(oldEvent) {
	var event = new CustomEvent("titlefocusout");
	event.entry = oldEvent.currentTarget.taskEntry;
	this.dispatchEvent(event);
};


/*
Dragging:
The list fires three events:
  dragStart(entry)  --- only called when the dragging has actually commenced
  dragMove
  dragEnd

The default drag manager also handles these automatically and drags items,
so you can only handle the 'dragcommit' event if the default drag satisfies you.
*/
//Drag on a grip
TaskList.prototype.onEntryDragGripMouseDown = function(event) {
	this.dragMgr.dragConfigure(elementGetOwnerTaskNode(event.target), event);
	this.dragMgr.startDrag(); //immediately
	event.stopPropagation(); //handled here, don't start the timer
	event.preventDefault();
}
function TaskEntryDragMgr(parent) {
	ItemDragMgr.call(this);
	this.parent = parent;
}
inherit(ItemDragMgr, TaskEntryDragMgr);
TaskEntryDragMgr.prototype.getNodeChildren = function(node) {
	return node.taskEntry.getAllChildren().map(entry => entry.node);
}
TaskEntryDragMgr.prototype.dragStart = function(node) {
	//console.log('TaskEntryDragMgr::dragStart');
	//Notify the subscribers
	var event = new CustomEvent("dragstart");
	event.entry = this.dragNode ? this.dragNode.taskEntry : null;
	if (!this.parent.dispatchEvent(event)) {
		//console.log('TaskEntryDragMgr: not approved, aborting drag');
		return false;
	}
	//Default handling
	return ItemDragMgr.prototype.dragStart.call(this, node);
}
TaskEntryDragMgr.prototype.dragEnd = function(cancelDrag) {
	//console.log('TaskEntryDragMgr::dragEnd');
	//Notify the subscribers
	var event = new CustomEvent("dragend");
	event.entry = this.dragNode ? this.dragNode.taskEntry : null;
	event.cancelDrag = cancelDrag;
	this.parent.dispatchEvent(event);
	
	//Default handling
	if (!this.context) return;
	//We're going to unpack children at a new place so adjust their levels
	var newLevel = cancelDrag ? this.context.oldLevel : this.dragNode.taskEntry.getLevel();
	if (newLevel != this.context.oldLevel) //right now this check looks weird but we might start dragging with children unpacked
		for (let node of this.context.oldChildren.children)
			node.taskEntry.setLevel(node.taskEntry.getLevel() - this.context.oldLevel + newLevel);
	return ItemDragMgr.prototype.dragEnd.call(this, cancelDrag);
}
TaskEntryDragMgr.prototype.dragMove = function(pos) {
	//Notify the subscribers
	var event = new CustomEvent("dragmove");
	event.entry = this.dragNode ? this.dragNode.taskEntry : null;
	event.pos = pos;
	this.parent.dispatchEvent(event);
	//Default handling
	return ItemDragMgr.prototype.dragMove.call(this, pos);
}
TaskEntryDragMgr.prototype.getInsertPoints = function(targetNode) {
	//We don't have spaces between items and entryFromViewportPoint() always returns us something,
	//so we don't have to handle the "between items" case:
	return [targetNode, targetNode.nextElementSibling];
}
TaskEntryDragMgr.prototype.dragMoveBefore = function(node, insertBefore) {
	//Moves the node before the given node or null
	node.parentNode.insertBefore(node, insertBefore);
	let beforeEntry = insertBefore ? insertBefore.taskEntry : null;
	let afterEntry = beforeEntry ? beforeEntry.getPrev() : tasks.last(); //TODO: "tasks"? maybe "parent"
	//Which parent to put this under? Always the same level as the node after us, or before us
	var newLevel = beforeEntry ? beforeEntry.getLevel() : afterEntry ? afterEntry.getLevel() : 0;
	node.taskEntry.setLevel(newLevel);
}
TaskEntryDragMgr.prototype.saveContext = function() {
	var dragEntry = this.dragNode.taskEntry;
	//Remember existing place for simple restoration
	this.context.oldPrev = dragEntry.getPrev();
	this.context.oldLevel = dragEntry.getLevel();
}
TaskEntryDragMgr.prototype.restoreContext = function() {
	var dragEntry = this.dragNode.taskEntry;
	dragEntry.move(this.context.oldPrev, this.context.oldLevel);
}
TaskEntryDragMgr.prototype.dragCommit = function() {
	if (!backend || !backend.move) return;
	let dragEntry = this.dragNode.taskEntry;
	if (this.context.oldPrev == dragEntry.getPrev())
		return;

	//Move the nodes on the backend! We only need to move the parent, but we have to properly select where
	this.parent.dispatchEvent("dragcommit", { entry: dragEntry });
}


//Returns the task entry at a given viewport point { x: int, y: int }
TaskList.prototype.entryFromViewportPoint = function(pt) {
	var entry = this.first();
	var nodeRect = null;
	while (entry) {
		nodeRect = entry.node.getBoundingClientRect();
		//Entries are full-width so only check the Y
		if ((pt.y >= nodeRect.top) && (pt.y < nodeRect.bottom))
  			break;
		entry = entry.getNext();
	}
	return entry;
}