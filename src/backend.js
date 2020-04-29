/*
Task resources and task cache.

Task and tasklist resources are identical to the objects the GS API returns.
Patch resources are identical to GS API patch sets.

https://developers.google.com/tasks/v1/reference/tasks#resource
https://developers.google.com/tasks/v1/reference/tasklists#resource

Even if a backend has nothing to do with GTasks it needs to provide the same resources. At a minimum:
Tasklist: id, title
Task: id, title, parent, position, notes, status, due, completed, deleted
*/

//Lists all registered backend types for the application
//Backend normally self-register when they're available
var backends = [];
function registerBackend(name, ctor) {
	backends.push({'name': name, 'ctor': ctor});
}


//Clones a task resource without preserving its unique IDs
function taskResClone(oldTask) {
	var newTask = Object.assign({}, oldTask);
	delete newTask.id;
	delete newTask.etag;
	delete newTask.selfLink;
	return newTask;
}

//Updates task resource to be completed/non-completed
function taskResSetCompleted(task, completed, completed_when) {
	if (completed) {
		task.status="completed";
		if (!completed_when)
			completed_when = new Date().toISOString();
		task.completed = completed_when;
	}
	else {
		task.status="needsAction";
		task.completed = null;
	}
}
//Normalizes some fields which must be changed in accord
function taskResNormalize(task) {
	if ((task.status == "completed") && !task.completed)
		task.completed = new Date().toISOString();
	if ((task.status == "needsAction") && task.completed)
		delete task.completed;
}

//Updates fields in the resource according to the patch
//Applicable to task resources and tasklist resources
function resourcePatch(res, patch) {
	Object.keys(patch).forEach(function(key){
		if (key == "id") return;
		var val = patch[key];
		if (val == null)
			delete res[key];
		else
			res[key] = val;
	});
}


/*
Task cache is a locally cached subset of task resources.
It's required for some more complicated queries such as getting task children. It's kept up to date by the active backend.
The way its selected defines which tasks can be operated on in this extended sense.

Generally it's advised not to rely on cache and instead deduce all required info from nodes,
so that we can hide it entirely in the backend.
*/


/*
A cache of all tasks in the current selected lists.
We use it to resolve parent/children relationship etc.
*/
var taskCache = {
items : [],
clear : function () {
	this.items = [];
},
//Adds a new task resource to the cached task list
add : function (task) {
	this.items[task.id] = task;
},
delete : function (taskId) {
	delete this.items[taskId];
},
get : function (taskId) {
	return this.items[taskId];
},
update : function (task) {
	this.items[task.id] = task;
},
//Updates given fields in the cached task entry. Same semantics as backend.patch
patch : function (patch) {
	var task = this.items[patch.id];
	if (task)
		resourcePatch(task, patch);
},
}

/*
Detects additions, deletions and edits between two dictionaries
Returns a dict of key => {oldValue, newValue} pairs.
*/
function diffDict(oldDict, newDict, comparer) {
	oldDict = oldDict ? oldDict : {};
	newDict = newDict ? newDict : {};
	var res = {};
	Object.keys(oldDict).forEach(key => {
		let oldValue = oldDict[key];
		let newValue = newDict[key]; //undefined if not present
		if (!newValue || !comparer(oldValue, newValue))
			res[key] = { 'oldValue': oldValue, 'newValue': newValue };
	});
	Object.keys(newDict).forEach(key => {
		let oldValue = oldDict[key];
		if (!oldValue)
			res[key] = { 'oldValue': null, 'newValue': newDict[key] };
	});
	return res;
}


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
Callback.prototype.notify = function(param1, param2, param3) {
	this.observers.forEach(observer => observer(param1, param2, param3));
}


/*
Minimal Task and Tasklist structures.
You may use simple dicts but keep these in mind.
*/
class Tasklist {
	constructor(args) {
		this.id = id;			//Unique for this backend
		this.title = title;
		for (var key in args)
			this[key] = args[key];
	}
}
class Task {
	constructor(args) {
		this.id = undefined;			//Unique for this backend
		this.title = undefined;
		this.parent = undefined;		//Parent task ID or null/undefined
		this.position = undefined;		//Sort order key for items of this parent
		this.notes = undefined;
		this.status = undefined;		//Only "completed" or "needsAction". Other DAV-style statuses potentially supported in the future.
		this.due = undefined;
		this.completed = undefined;		//True or false/null/undefined
		for (var key in args)
			this[key] = args[key];
	}
}


/*
Backend base class.
Implements some functions in the default way in case you don't have more performant overrides
Most functions:
 - return a promise, without error checks
 - accept both taskIds and task objects
*/
function Backend() {
	this.onSignInStatus = new Callback();

	/*
	Notifications.
	Types of notifications the backends can deliver:
	1. TaskList added/renamed/deleted.
	2. Task edited (params unrelated to its position in the list)
	3. Task added/deleted
	4. Task moved to list A, parent B, after entry C.
	*/
	this.onTasklistAdded = new Callback(); // tasklist info
	this.onTasklistEdited = new Callback(); // new tasklist info
	this.onTasklistDeleted = new Callback(); // tasklist id
	this.onTaskAdded = new Callback(); // task info, tasklistId
	this.onTaskEdited = new Callback(); // new task info
	this.onTaskMoved = new Callback(); // task id, {tasklistId, parentId, prevId}
	this.onTaskDeleted = new Callback(); // task id
}

/*
Connection
Implementations must notify onSigningChange subscribers.
*/
//Connect to the backend
Backend.prototype.connect = function() {
	//log("Backend.connect");
	//Automatically consider us signed in
	this.signin();
	return Promise.resolve();
}
//Sign in to the backend with the configured params
Backend.prototype.signin = function() {
	//log("Backend.signin");
	this._signedIn = true;
	this.notifySignInStatus(true);
	return Promise.resolve();
}
//Sign out from the backend
Backend.prototype.signout = function() {
	//log("Backend.signout");
	this._signedIn = false;
	this.notifySignInStatus(false);
	return Promise.resolve();
}
Backend.prototype.isSignedIn = function() {
	return this._signedIn;
}
//Notifies the subscribers about the signin change
Backend.prototype.notifySignInStatus = function(status) {
	this.onSignInStatus.notify(status);
}


/*
Common
*/

//Backend.prototype.reset
//If present, the "Reset account" action will be available.
//Deletes all tasks and tasks lists permanently.


/*
Task lists
*/
//Backend.prototype.tasklistList = function()
//Required. Returns an array of TaskList objects (promise).

//Backend.prototype.tasklistGet = function(tasklistId)
//Required. Retrieves tasklist details.

//Backend.prototype.tasklistAdd = function(title)
//Implement to enable new tasklists creation.

Backend.prototype.tasklistPatch = function(tasklist) {
	//Default: query + update
	return this.tasklistGet(tasklist.id).then(result => {
		resourcePatch(result, tasklist);
		return this.tasklistUpdate(result);
	});
}

//Backend.prototype.tasklistUpdate = function(tasklist)
//Implement to enable editing task list titles.

//Backend.prototype.tasklistDelete = function(tasklistId)
//Caution! Deletes the task list with the given id
//Implement to enable task list deletion.



/*
Tasks
*/

//Backend.prototype.list = function(tasklistId)
//Required. Returns a list of all tasks in a taskslist. See BackendGt for more details.

//Backend.prototype.get/getAll: At least one is required.

//Returns a promise for the given task content
//If tasklistId is not given, selected task list is assumed.
Backend.prototype.get = function(taskId, tasklistId) {
	if (this.getAll == Backend.prototype.getAll)
		throw "Backend: Querying tasks is not implemented";
	//Default: forward to getAll
	return this.getAll([taskId], tasklistId).then(results =>
		results[Object.keys(results)[0]]
	);
}

//Retrieves multiple tasks in a single request. Returns a promise for a taskId -> task map.
//If tasklistId is not given, selected task list is assumed.
Backend.prototype.getAll = function(taskIds, tasklistId) {
	if (this.get == Backend.prototype.get)
		throw "Backend: Querying tasks is not implemented";
	//Default: forward to get() one by one
	var proms = [];
	for (let i=0; i<taskIds.length; i++)
		proms.push(this.get(taskIds[i], tasklistId));
	return Promise.all(proms).then(results => {
		var dict = {};
		results.forEach(item => dict[item.id] = item);
		return dict;
	});
}

//Backend.prototype.update = function (task)
//Required for all intents and purposes, or your tasklist is read-only.

//Updates only the fields mentioned in "task". Fields set to none will be deleted. ID must be set.
//Returns a task-update or task-patch request
Backend.prototype.patch = function (task, allChildrenIds) {
	//Default: query + update
	//log(task);
	return this.get(task.id).then(result => {
		resourcePatch(result, task);
		return this.update(result);
	}).then(result => {
		taskCache.patch(task); //update cached version
		return result;
	});
}

//BackendGTasks.prototype.insert = function (task, previousId, tasklistId)
//Creates a new task on the given tasklist. Inserts it after the given previous task.
//Inserts it under a given parent (in the task object).
//Returns a task resource.
//Required, or you cannot add new tasks.

//Insert, but assumes the current task list
Backend.prototype.insertToCurrentList = function (task, previousId) {
	return this.insert(task, previousId, this.selectedTaskList);
}


//Deletes the task with all children. If tasklistId is not given, assumes current task list.
Backend.prototype.delete = function (taskId, tasklistId) {
	if (taskId && taskId.id) taskId = taskId.id;
	if (!tasklistId) tasklistId = this.selectedTaskList;
	
	ids = [taskId];
	if (tasklistId == this.selectedTaskList) {
		//We need to remove children from cache too, at the very least
		this.getAllChildren(taskId).forEach(child => ids.push(child.id));
		ids.forEach(id => taskCache.delete(id));
	} else {
		//Currently only selected list supports recursive deletion
	}
	return this.deleteAll(ids, tasklistId);
}

//BackendGTasks.prototype.deleteAll = function (taskIds, tasklistId).
//Deletes multiple tasks from a single task list, non-recursively (without traversing their childrne).
//Required for task deletion.

//True if this backend supports task deletion. Same as checking for deleteAll.
Backend.prototype.hasDelete = function() {
	return (this.deleteAll);
}


/*
Moves tasks under a new parent in the same task list (the currently selected one):
  taskIds: taskID or [taskIDs]
Inserts them in the given order after a given task:
  parentId: null == top level
  previousId: null == first position
Updates cache.

If this function is present then all local move functions are expected to work.
  Default:		forward to _moveOne() one by one
  Reimplement 	if you have a better mechanics for batch moves
  Undefine		if your list does NOT support moving tasks
*/
Backend.prototype.move = function(taskIds, newParentId, newPrevId) {
	if (!isArray(taskIds)) taskIds = [taskIds];
	if (parentId && parentId.id) parentId = parentId.id;
	if (previousId && previousId.id) previousId = previousId.id;

	var proms = [];
	taskIds.reverse().forEach(id => {
		proms.push(this._moveOne(id, newParentId, newPrevId));
	});
	return Promise.all(proms);
}
/*
Moves ONE task under a new parent in the same task list.
Updates cache.
  Default:		implemented via editing
  Reimplement	if you want a different approach but to reuse the default _move() batching
*/
Backend.prototype._moveOne = function(taskId, newParentId, newPrevId) {
	if (taskId && taskId.id) taskId = taskId.id;
	
	//By default just update the task parent and choose a sort-order position
	let newPosition = this.choosePosition(newParentId, newPrevId);
	let taskPach = { id: taskId, parent: parentId, position: newPosition, };
	return this.patch(taskPatch);
}
// Moves all children of a given task under a new parent in the same task list,
// inserting them in the existing order after a given task (null = at the top).
Backend.prototype.moveChildren = function (taskId, newParentId, newPrevId) {
	if (taskId && taskId.id) taskId = taskId.id;
	if (newParentId && newParentId.id) newParentId = newParentId.id;
	if (newPrevId && newPrevId.id) newPrevId = newPrevId.id;

	var children = this.getChildren(taskId);
	if (!children || (children.length <= 0))
		return Promise.resolve();
	var childIds = [];
	children.forEach(child => childIds.push(child.id));
	
	//log("backend.moveChildren: from="+taskId+" to="+newParentId+" after="+newPrevId);
	return this.move(childIds, newParentId, newPrevId);
}


//Moves a task with children to a new position in a different task list.
//May change task id.
//BackendGTasks.prototype.moveToList = function (oldTask, newTasklistId, newParentId, newPrevId)
//Implement to allow moving tasks between lists.



/*
Tasks are sorted according to their .position property (required).
On move() the backend changes the .position of the task, but only that task alone.

We provide a default implementation of move() which selects a position between next/prev
and passes that to update().

Override to provide your own selection algorithm, or override move() if your selection
happens on the backend.
*/
Backend.prototype.newUpmostPosition = function(parentId, tasklistId) {
	//Default: always use zero.
	return 0;
}
//Returns a position value that could be used as a new "position" for an entry
//to be inserted as the downmost under the given parent
Backend.prototype.newDownmostPosition = function(parentId, tasklistId) {
	//Default: current time in microseconds since 2001.01.01
	return (new Date() - new Date(2001, 01, 01, 0, 0, 0));
}
//Chooses a new sort-order value for a task under a given parent, after a given previous task.
//If count is given, chooses that number of positions.
Backend.prototype.choosePosition = function(parentId, previousId, tasklistId, count) {
	//TODO: Implement count. Use count in multi-task moves by default
	if (!count) count = 1;
	if (tasklistId && (tasklistId != this.selectedTaskList))
		throw "Currently unsupported for lists other than current";
	//console.log('choosePosition: parent=', parentId, 'previous=', previousId);

	//Choose a new position betweeen previous.position and previous.next.position
	let children = this.getChildren(parentId);
	//console.log(children);
	let prevPosition = null;
	let nextPosition = null;
	let prevIdx = null;
	
	if (!previousId) {
		prevPosition = this.newUpmostPosition();
		prevIdx = -1;
		//Some safeguards: if our "topmost" position is closer than 1000 to the current topmost,
		//why not choose a bit lower?
		//Can't do the same at the bottom as we may overshoot what the next new item is going to get
		if (children.length >= 1) && (children[0].position < prevPosition + 1000)
			prevPosition = children[0].position - 1000;
	} else
		for (prevIdx=0; prevIdx<children.length; prevIdx++) {
			if (children[prevIdx].id != previousId)
				continue;
			prevPosition = children[prevIdx].position;
			break;
		}
	
	if (prevIdx+1 < children.length)
		nextPosition = children[prevIdx+1].position;
	else
		//Otherwise there's no next task; choose midway between prev and now()
		nextPosition = this.newDownmostPosition();
	
	newPosition = Math.floor((nextPosition + prevPosition) / 2);
	//Don't position higher than requested. If we've exhaused the inbetween value space, sorry
	if (newPosition < prevPosition + 1)
		newPosition = prevPosition + 1;
	//console.log('prevPosition', prevPosition, 'nextPosition', nextPosition, 'newPosition', newPosition);
	return newPosition;
}




/*
One task list can be "selected".
This is a rudiment of the time when the backend was tightly integrated with the UI,
and mostly means this will be the default tasklist unless specified, and that tasks from it will be cached.
*/
selectedTaskList : null,
Backend.prototype.selectTaskList = function (tasklistId) {
	if (this.selectedTaskList == tasklistId)
		return Promise.resolve();
	this.selectedTaskList = tasklistId;
	taskCache.clear();
	if (!this.selectedTaskList)
		return Promise.resolve();
	//Reload the cache
	var prom = this.list(this.selectedTaskList);
	prom = prom.then(result => {
		taskCache.clear();
		let tasks = result.items ? result.items : [];
		for (let i = 0; i < tasks.length; i++)
			if (!tasks[i].deleted)
				taskCache.add(tasks[i]);
	});
	return prom;
}
//Returns the nesting level of a task resource, according to local cache
Backend.prototype.getLevel = function (task) {
	var level = 0;
	while (task.parent) {
		level++;
		task = taskCache.get(task.parent);
	}
	return level;
}
//Returns an array of all children tasks of a given task, sorted by their sort order
Backend.prototype.getChildren = function (parentId) {
	if (parentId && parentId.id) parentId = parentId.id; //sometimes we're given the task object instead of id
	var list = [];
	Object.keys(taskCache.items).forEach(key => {
		var task = taskCache.items[key];
		if (!parentId && (task.parent))
			return;
		if ((parentId) && (task.parent != parentId))
			return;
		list.push(task);
	});
	list = list.sort((a, b) => { return a.position - b.position; });
	//log("getChildren("+parentId+"): "+list.length);
	return list;
}
//Returns an array of all children tasks of a given task at any level
Backend.prototype.getAllChildren = function (parentId) {
	if (parentId && parentId.id) parentId = parentId.id; //sometimes we're given the task object instead of id
	var list = [];
	Object.keys(taskCache.items).forEach(function(key){
		var task = taskCache.items[key];
		while (task && (task.parent != parentId))
			task = task.parent ? taskCache.items[task.parent] : null;
			if (task)
				list.push(taskCache.items[key]); //the original match
		});
	//log("getAllChildren("+parentId+"): "+list.length);
	return list;
}
Backend.prototype.getPrevSibling = function (task) {
	var siblings = this.getChildren(task.parent);
	var index = siblings.findIndex(item => item.id == task.id);
	if (!index)
		return null;
	if (index > 0)
		return siblings[index-1];
	return null;
}
Backend.prototype.getLastChild = function (task) {
	var children = this.getChildren(task.id);
	if (children.length > 0)
		return children[children.length-1];
	else
		return null;
}
