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
function findBackend(name) {
	return backends.find(item => { return item.name == name; });
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
		this.notes = undefined;
		this.status = undefined;		//Only "completed" or "needsAction". Other DAV-style statuses potentially supported in the future.
		this.due = undefined;
		this.completed = undefined;		//True or false/null/undefined
		//Not all backends support modifying these directly with update(). Prefer specialized move*() functions:
		this.tasklist = undefined;		//The tasklist this task belongs to
		this.parent = undefined;		//Parent task ID or null/undefined
		this.position = undefined;		//Sort order key for items of this parent
		for (var key in args)
			this[key] = args[key];
	}
}
/*
Q: What if my backend's task.ids are unique only to tasklist?
A: Prepend them with tasklistId and your moveToList() will be changing task.ids (allowed).

Q: What if my backend has no unique IDs for tasks?
A: Keep everything in memory and assign temporary IDs on the fly.

Q: What if my backend requires specifying BOTH tasklistId and taskId on requests?
   While taskIds might be unique, I have nowhere to get tasklistId beforehand.
A: The backend API should require explicit tasklistId everywhere where this might be a problem.
   E.g.: get(taskId) must also require tasklistId.
*/


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
	
	this.cache = new TaskCache();
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


//Backend.prototype.update = function (task, tasklistId)
//Updates the contents of the task on the server. Missing or null fields will be deleted.
//Returns the new task content (may be adjusted by the server).
//Required, or your tasklist is read-only.

//Updates only the fields present in Task objet. Fields set to null will be deleted. ID must be set.
//Returns a task-update or task-patch request
Backend.prototype.patch = function (task, tasklistId) {
	//Default: query + update
	return this.get(task.id).then(result => {
		resourcePatch(result, task);
		return this.update(result, tasklistId);
	}).then(result => {
		this.cache.patch(task); //update cached version
		return result;
	});
}


//BackendGTasks.prototype.insert = function (task, previousId, tasklistId)
//Creates a new task on the given tasklist. Inserts it after the given previous task.
//Inserts it under a given parent (in the task object).
//Returns a task resource.
//Required, or you cannot add new tasks.

/*
Accepts a _id -> task,previousId list.
Inserts all tasks to the target tasklist and returns a _id->insertedTask map.

task.parent: The parent to insert under
task.previousId: Insert after this task.

Tasks are inserted in the order given.
The _id is only used to identify tasks in the results.
*/
Backend.prototype.insertMultiple = function (tasks, tasklistId) {
	//Default: Call insert() multiple times.
	results = {};
	batch = [];
	for (let _id in tasks) {
		batch.push(
			this.insert(tasks[_id], tasks[_id].previousId, tasklistId).
			then(newTask => {
				results[_id] = newTask;
			})
		);
	}
	return Promise.all(batch).then(() => {
		return results;
	});
}


//Deletes the task with all children. If tasklistId is not given, assumes current task list.
Backend.prototype.delete = function (taskId, tasklistId) {
	if (taskId && taskId.id) taskId = taskId.id;
	if (!tasklistId) tasklistId = this.selectedTaskList;
	
	ids = [taskId];
	let prom = null;
	//Currently only selected list supports recursive deletion
	if (tasklistId == this.selectedTaskList) {
		prom = this.getAllChildren(taskId, tasklistId)
		.then(children => {
			children.forEach(child => ids.push(child.id))
		});
	} else
		prom = Promise.resolve();
	
	return prom
	.then({
		//We need to remove everything from cache too
		ids.forEach(id => this.cache.delete(id));
	})
	.then(this.deleteAll(ids, tasklistId));

}

//BackendGTasks.prototype.deleteAll = function (taskIds, tasklistId).
//Deletes multiple tasks from a single task list, non-recursively (without traversing their children).
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
Backend.prototype.move = function(taskIds, newParentId, newPrevId, tasklistId) {
	if (!Array.isArray(taskIds)) taskIds = [taskIds];
	if (newParentId && newParentId.id) newParentId = newParentId.id;
	if (newPrevId && newPrevId.id) newPrevId = newPrevId.id;

	var proms = [];
	taskIds.reverse().forEach(id => {
		proms.push(this._moveOne(id, newParentId, newPrevId, tasklistId));
	});
	return Promise.all(proms);
}
/*
Moves ONE task under a new parent in the same task list.
Updates cache.
  Default:		implemented via editing
  Reimplement	if you want a different approach but to reuse the default _move() batching
*/
Backend.prototype._moveOne = function(taskId, newParentId, newPrevId, tasklistId) {
	if (taskId && taskId.id) taskId = taskId.id;
	
	//By default just update the task parent and choose a sort-order position
	return this.choosePosition(newParentId, newPrevId, tasklistId)
	.then(newPosition => {
		let taskPatch = { id: taskId, parent: newParentId, position: newPosition, };
		return this.patch(taskPatch, tasklistId);
	});
}
// Moves all children of a given task under a new parent in the same task list,
// inserting them in the existing order after a given task (null = at the top).
Backend.prototype.moveChildren = function (taskId, newParentId, newPrevId, tasklistId) {
	if (taskId && taskId.id) taskId = taskId.id;
	if (newParentId && newParentId.id) newParentId = newParentId.id;
	if (newPrevId && newPrevId.id) newPrevId = newPrevId.id;

	this.getChildren(taskId, this.selectedTaskList)
	.then(children => {
		if (!children || (children.length <= 0))
			return;
		//Note: This is super-clumsy if getChildren() is implemented non-cached: we query children, drop their data, then query again in move()->patch()
		var childIds = [];
		children.forEach(child => childIds.push(child.id));
		//log("backend.moveChildren: from="+taskId+" to="+newParentId+" after="+newPrevId);
		return this.move(childIds, newParentId, newPrevId, tasklistId);
	})
}


/*
Tasks are sorted according to their .position property (required).
On move() the backend changes the .position of the task, ideally that task alone.

The frontend can tolerate backends which change other tasks too (e.g. linked lists),
but it'll only know new .positions on reload.

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
	return this.getChildren(parentId, tasklistId)
	.then(children => {
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
			if ((children.length >= 1) && (children[0].position < prevPosition + 1000))
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
	});
}




/*
Copies a number of tasks to a new tasklist/backend, giving them new Ids.
  items: taskId -> {
  	parent: new parentId,
  	[task: task,]					default: try to get by id
  	[previous: new previousId,]		default: insert topmost
  }
Returns:
  taskId -> insertedTask
*/
Backend.prototype.copyTo = function (items, newTasklistId, newBackend) {
	if (!items || (items.length <= 0)) return Promise.resolve();
	if (!newBackend) newBackend = this;
	
	//Default: Simply duplicate and insert() the tasks.
	//Descendants might have better methods which also copy backend history/associated properties
	
	let newItems = {};
	for (let taskId in items) {
		let item = items[taskId];
		let newTask = item.task || this.cache.get(taskId);
		if (!newTask)
			throw "copy: Task data not found: "+taskId
		newTask = taskResClone(newTask);
		newTask.id = null; //we'll need new ID
		newTask.parent = item.parent;
		newTask.previousId = item.previous;
		newItems[taskId] = newTask;
	}
	
	let batch = newBackend.insertMultiple(newItems);
/*	if (recursive)
		batch = batch.then(results => {
			//insert returns the final form of the task
			let pairs = [{'from': oldTask, 'to': response}];
			return this.copyChildrenTo(pairs, newTasklistId, newBackend);
		});
*/
	return batch;
}


/*
Copies a task with children to a given position in a different task list.
The copies will have new IDs.

  Default: Copy the tasks. The default implementation is pretty universal.

The tasks may come from another backend! Ignore any properties except for standard ones.
*/
Backend.prototype.copyToList = function (oldTask, newTasklistId, newParentId, newPrevId, oldBackend) {
	if (!oldBackend) oldBackend = this;
	var newTask = taskResClone(oldTask);
	newTask.parent = newParentId;
	var prom = this.insert(newTask, newPrevId, newTasklistId)
		.then(response => {
			//insert returns the final form of the task
			let pairs = [{'from': oldTask, 'to': response}];
			return this.batchCopyChildren(pairs, newTasklistId, oldBackend);
		});
	return prom;
}

/*
Builds a batch promise that for every pair in "pairs" copies all children of pair.from to pair.to,
recursively.
Example:
  copyChildrenTo([{'from': oldTask, 'to': newTask}], newTasklistId);
Copies all children of oldTask under newTask, recursively.
*/
Backend.prototype.copyChildrenTo = function (pairs, newTasklistId, newBackend) {
	if (!pairs || (pairs.length <= 0)) return Promise.resolve();
	if (!newBackend) newBackend = this;

	var pairs_new = [];
	var batch = {};

	//Build a batch request for all children on this nesting level
	pairs.forEach(pair => {
		//Get all source children
		let children = oldBackend.getChildren(pair.from);
		//Add children backwards so that each new child can be appended "at the top" --
		//otherwise we'd need to know the previous child ID and can't batch.
		children.reverse().forEach(oldChild => {
			//Add request to batch
			let item = {};
			item.task = oldChild;
			item.parent = pair.to.id;
			item.previous = null; //add to the top
			batch[oldChild.id] = item;
			//Add as a new pair entry
			pairs_new.push({ 'from': oldChild, 'to': null });
		});
	});

	if (batch.length<=0)
		return Promise.resolve();
	return this.copyTo(batch, newTasklistId, newBackend) //not recursive
	.then(results => {
		//Now that we have a response, update a shared variable pairs_new with generated children ids,
		//and return a new promise to copy the next nested level
		for (let oldId in results) {
			let pair = pairs_new.find(item => { return item.from.id == oldId; });
			if (!pair)
				log("can't find pair for id = "+oldId);
			pair.to = results[oldId];
		}
		return this.copyChildrenTo(pairs_new, newTasklistId, newBackend);
	});
}

/*
Moves a task with children from *currently selected* task list to a different task list and/or backend.
May change task ids.

  Default:		copy the task subtree + delete the original one
  Reimplement	if you have better options (can preserve the IDs, move associated history/info etc)
				Fall back to default implementation if move()ing to unknown backends!

Moved task will always appear at the top/bottom of the list. Won't do local positioning. Foreign task list may be not cached.
If you're sure, position with newBackend.move() manually.
*/
Backend.prototype.moveToList = function (oldTask, newTasklistId, newBackend) {
	if (!newBackend) newBackend = this;
	if (!newTasklistId || (newTasklistId == this.selectedTaskList))
		return Promise.resolve();
	var oldTasklistId = this.selectedTaskList;

	return this.cachedGet(oldTask)
		.then(task => {
			oldTask = task;
			return this.copyToList(oldTask, newTasklistId, newBackend))
		})
		.then(response => this.delete(oldTask, oldTasklistId));
}


/*
One task list can be "selected".
This will be the default tasklist unless specified (a rudiment from the past).
Some operations only work on selected task list -- see caching below.
*/
Backend.prototype.selectTaskList = function (tasklistId) {
	if (this.selectedTaskList == tasklistId)
		return Promise.resolve();
	this.selectedTaskList = tasklistId;
	this.cache.clear();
	if (!this.selectedTaskList)
		return Promise.resolve();
	//Reload the cache
	return this.cacheLoadList(this.selecedTaskList);
}


/*
Task caching.

Some convenience functions cannot be effectively implemented on most backends
without querying the entire list on which they work:
- Getting all children, recursively
- Getting the entire chain of parents

A compromise: We provide convenience functions but they only work on
a "currently selected list", which is cached.

If your backend can implement these efficiently, please do!
We may switch away from cache to preloading the entire lists by default one day.

Backends: Remember to update changed tasks!
*/
function TaskCache() {
	this.items = [];
}
TaskCache.prototype.clear = function() {
	this.items = [];
}
//Adds a new task resources to the cached task list
TaskCache.prototype.add = function(tasks) {
	this.update(tasks);
}
TaskCache.prototype.delete = function (taskIds) {
	if (!Array.isArray(taskIds))
		taskIds = [taskIds];
	for (let i=0; i<taskIds.length; i++)
		delete this.items[taskIds[i]];
}
//Deletes all tasks from a given tasklist from the cache
TaskCache.prototype.deleteList = function (tasklistId) {
	for (let key in this.items)
		if (this.items[key].tasklist == tasklistId)
			delete this.items[key];
}
TaskCache.prototype.get = function (taskId) {
	return this.items[taskId];
}
TaskCache.prototype.update = function (tasks) {
	if (!Array.isArray(tasks))
		tasks = [tasks];
	for (let i=0; i<tasks.length; i++)
		this.items[tasks[i].id] = tasks[i];
}
//Updates given fields in the cached task entry. Same semantics as backend.patch
TaskCache.prototype.patch = function (patch) {
	var task = this.items[patch.id];
	if (task)
		resourcePatch(task, patch);
}
//Preloads all tasks from a tasklist into cache
Backend.prototype.cacheLoadList(tasklistId) {
	var prom = this.list(this.selectedTaskList);
	prom = prom.then(items => {
		let tasks = items || [];
		for (let i = 0; i < tasks.length; i++)
			if (!tasks[i].deleted)
				this.cache.add(tasks[i]);
	});
	return prom;
}
//Similar to .getAll(), but can return from cache.
//+ If you pass it a Task object, will simply return that.
Backend.prototype.cachedGet(taskIds, tasklistId) {
	let isArray = Array.isArray(taskIds);
	if (!isArray) taskIds = [taskIds];

	let tasks = {};
	let requestIds = [];
	for (let taskId in taskIds) {
		if (taskId.id) {
			tasks{taskId.id} = taskId; //already a task
			continue;
		}
		let task = this.cache.get(taskId);
		if (task)
			tasks[taskId] = task;
		else
			requestIds.push(taskId);
	}
	let prom = (requestIds.length <= 0) ? Promise.resolve({}) :
		this.getAll(taskIds, tasklistId);
	return prom.then(results => {
		for (let taskId in results)
			tasks[taskId] = results[taskId];
		if (!isArray)
			return tasks{taskIds[0]};
		return tasks;
	});
}

//Returns an array of all children tasks of a given task, sorted by their sort order
Backend.prototype.getChildren = function (parentId, tasklistId) {
	if (parentId && parentId.id) parentId = parentId.id; //sometimes we're given the task object instead of id
	var list = [];
	Object.keys(this.cache.items).forEach(key => {
		var task = this.cache.items[key];
		if (!parentId && (task.parent))
			return;
		if ((parentId) && (task.parent != parentId))
			return;
		list.push(task);
	});
	list = list.sort((a, b) => { return a.position - b.position; });
	return Promise.resolve(list);
}
//Returns an array of all children tasks of a given task at any level
Backend.prototype.getAllChildren = function (parentId, tasklistId) {
	if (parentId && parentId.id) parentId = parentId.id; //sometimes we're given the task object instead of id
	var list = [];
	Object.keys(this.cache.items).forEach(function(key){
		var task = this.cache.items[key];
		while (task && (task.parent != parentId))
			task = task.parent ? this.cache.items[task.parent] : null;
			if (task)
				list.push(this.cache.items[key]); //the original match
		});
	return Promise.resolve(list);
}

