﻿/*
Task resources and task cache.

Task and tasklist resources are similar to the objects the GS API returns.
Patch resources are similar to GS API patch sets.

https://developers.google.com/tasks/v1/reference/tasks#resource
https://developers.google.com/tasks/v1/reference/tasklists#resource

Even if a backend has nothing to do with GTasks it needs to provide the same resources.
See below for minimal structures.
*/
'use strict';
if (typeof require != 'undefined') {
	require('./utils.js').importSelf();
}
var unit = new Unit((typeof exports != 'undefined') && exports);


//Lists all registered backend types for the application.
//Backend normally self-register when they're available.
var backends = [];
unit.export({ backends });
function registerBackend(ctor, name) {
	if (name)
		ctor.uiName = name;
	backends.push(ctor);
}
unit.export(registerBackend);
/*
A backend must be an object, its constructor correct -- it will be used to recreate it.
  Derived.prototype = Object.create(Base.prototype); //or new Base(), if running Base() breaks nothing
  Derived.prototype.constructor = Derived;
*/
function inheritBackend(fromWhat, what) {
	what.prototype = Object.create(fromWhat.prototype);
	what.prototype.constructor = what;
}
unit.export(inheritBackend);


/*
Minimal Task and Tasklist structures.
You may use simple dicts but keep these in mind.
*/
class Tasklist {
	constructor(args) {
		this.id = undefined;			//Unique for this backend
		this.title = undefined;
		for (var key in args)
			this[key] = args[key];
	}
}
unit.export(Tasklist);
class Task {
	constructor(args) {
		this.id = undefined;			//Unique for this backend
		this.title = undefined;
		this.notes = undefined;
		this.status = undefined;		//CalDAV status in hungarian notation: "completed", "needsAction", "inProcess", "cancelled"
		this.completed = undefined;		//Completion time, or False/null/undefined
		this.due = undefined;			//Due time, or Falsey.
		this.updated = undefined;		//Last update time, or Falsey. Not all backends return this. Backends track this automatically.
		//Not all backends support modifying these directly with update(). Prefer specialized move*() functions:
		this.tasklist = undefined;		//The tasklist this task belongs to
		this.parent = undefined;		//Parent task ID or null/undefined
		this.position = undefined;		//Sort order key for items of this parent
		for (var key in args)
			this[key] = args[key];
	}
}
unit.export(Task);
//Dates and times must be returned as JS Dates, but strings from the clients should be tolerated
Task.parseDate = function(dt) {
	if ((typeof dt == 'undefined') || (dt instanceof Date)) return dt;
	let dto = new Date(dt);
	//Try to preserve the original data if we can't convert it to Date
	if (dto instanceof Date && !isNaN(dto.getTime()))
		return dto;
	console.warn('Cannot convert', dt, 'to JS date');
	return dt;
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

function Tasks() {}
unit.export(Tasks);
//Sorts an array of tasks according to their positions
Tasks.sort = function(tasks) {
	return tasks.sort((a, b) => a.position - b.position);
}
//Converts an array of tasks to an id->task dictionary 
Tasks.dict = function(tasks) {
	let dict = {};
	for (let i in tasks)
		dict[tasks[i].id] = tasks[i];
	return dict;
}


//Clones a task resource without preserving its unique IDs
function taskResClone(oldTask) {
	var newTask = Object.assign({}, oldTask);
	delete newTask.id;
	delete newTask.etag;
	delete newTask.selfLink;
	return newTask;
}
unit.export(taskResClone);

//Updates task resource to be completed/non-completed
//Other status are currently preserved but ignored.
function taskResSetCompleted(task, completed, completed_when) {
	if (completed) {
		task.status="completed";
		if (!completed_when)
			completed_when = new Date(); //now
		task.completed = completed_when;
	}
	else {
		task.status="needsAction";
		task.completed = null;
	}
}
unit.export(taskResSetCompleted);
//Normalizes some fields which should be changed in accord
function taskResNormalize(task) {
	if ((task.status == "completed") && !task.completed)
		task.completed = new Date(); //now
	if ((task.status != "completed") && task.completed)
		delete task.completed;
	//Convert all date fields to Dates
	if (typeof task.due != 'undefined')
		task.due = Task.parseDate(task.due);
	if (typeof task.completed != 'undefined')
		task.completed = Task.parseDate(task.completed);
	if (typeof task.updated != 'undefined')
		task.updated = Task.parseDate(task.updated);
}
unit.export(taskResNormalize);

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
unit.export(resourcePatch)


/*
Some functions can accept both a single task and an array,
and of either Task objects or IDs.
These helpers normalize these things.
*/
function toArray(tasks) {
	if ((typeof tasks == 'undefined') || (tasks==null)) return tasks;
	if (!Array.isArray(tasks))
		tasks = [tasks];
	return tasks;
}
unit.export(toArray);
function toTaskIds(taskIds) {
	if ((typeof taskIds == 'undefined') || (taskIds==null)) return taskIds;
	if (!Array.isArray(taskIds))
		taskIds = [taskIds];
	for (let i=0; i<taskIds.length; i++)
		if (taskIds[i].id) taskIds[i] = taskIds[i].id;
	return taskIds;
}
unit.export(toTaskIds);
function toTaskId(taskId) {
	if (taskId && taskId.id)
		taskId = taskId.id;
	return taskId;
}
unit.export(toTaskId);
//True if a dictionary or an array is empty, or undefined
function isEmpty(list) {
	//Arrays: we can check .length, but for !arrays it might be undefined (!<=0).
	//Checking .keys() works for both.
	return (!list || !Object.keys(list).length);
}
unit.export(isEmpty);
//Same but requires the parameter to be an array
function isArrayEmpty(list) {
	if (list && !Array.isArray(list))
		throw "Array expected, found: "+list;
	return (!list || (list.length <= 0));
}
unit.export(isArrayEmpty);


/*
Detects additions, deletions and edits between two dictionaries
Returns a dict of key => {oldValue, newValue} pairs.
*/
function diffDict(oldDict, newDict, comparer) {
	comparer = comparer || ((a, b) => (a==b)); //The default naive comparer
	oldDict = oldDict || {};
	newDict = newDict || {};
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
			res[key] = { 'oldValue': oldValue, 'newValue': newDict[key] };
	});
	return res;
}
unit.export(diffDict);

//Many backends store dates in variations of ISO8601.
//Parses that if it can, or returns the original value:
function maybeStrToDate(d) {
	if (typeof d == 'string') {
		let date = new Date(d);
		if ((date instanceof Date) && !isNaN(date))
			return date;
	}
	return d;
}
unit.export(maybeStrToDate);


/*
Backend base class.
Implements some functions in the default way in case you don't have more performant overrides

Most functions:
 - return a promise, without error checks
 - accept both taskIds and task objects

All operations are NON-ATOMIC by default. Do not make calls in parallel.
  batch.add(backend.delete(..));  //<-- at this point the first insert() starts to run
  batch.add(backend.delete(..));

ONLY when a function accepts an array can you run it on multiple items at once:
  Promise.all([backend.delete(id1), backend.delete(id2)]);  //FAIL
  backend.delete([id1, id2], ..); //okay
The backend chooses to execute this sequentially or in parallel.

Default implementations sometimes forward [array] requests to singular functions in parallel.
In these cases descendants must:
 - EITHER  Implement those singular functions atomically,
 - OR      Reimplement array functions to sequential calls.
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
	
	//Some backends can retrieve recently deleted tasks (marked .deleted=true).
	//Set this to ask them to do this (more data to transfer):
	this.showDeleted = false;
	
	//Set to assign a custom ui name to this account
	//this.customName = undefined;
}
unit.export(Backend);

//Initialize the backend instance, load any neccessary libraries
Backend.prototype.init = function() {
	//console.debug("Backend.init");
	//Older API compatibility:
	if (this.connect)
		return this.connect();
	return Promise.resolve();
}


/*
Returns a {dict} of parameters to ask from the user before signin(). Example:
	login: {
		title: 'Login';	//Optional, default: param id
		hint: null;		//Optional hint
		type: 'text'/'password'/'number'/'bool'/['list', 'of', 'choices']
		default: value;
	}
These fields will be collected and passed to signin():
   signin({login: value});
*/
Backend.prototype.settingsPage = function() {
	return null;
}


/*
Connection
Implementations must notify onSigningChange subscribers.
*/

//Performs initial connection to the backend source/account given by settings.
//Returns the set of settings/cookies to be stored and reused to restore the connection later.
Backend.prototype.setup = function(settings) {
	//By default simply equivalent to signin, and cookies~=settings
	return this.signin(settings);
}
//Sign in to the backend with the configured params
Backend.prototype.signin = function(params) {
	//By default requires nothing
	//console.debug("Backend.signin");
	this._signedIn = true;
	this.notifySignInStatus(true);
	//Return the same cookies unchanged
	return Promise.resolve(params);
}
//Sign out from the backend
Backend.prototype.signout = function() {
	//console.debug("Backend.signout");
	this._signedIn = false;
	this.notifySignInStatus(false);
	return Promise.resolve();
}
Backend.prototype.isSignedIn = function() {
	return this._signedIn || false;
}
//Notifies the subscribers about the signin change
Backend.prototype.notifySignInStatus = function(status) {
	this.onSignInStatus.notify(this, status);
}
//Automatically chosen UI name for this account (once logged in). Can be overriden by descendants.
Backend.prototype.autoName = function() {
	//By default just returns the backend name. Fall back to this if not logged in / no better ideas.
	return this.constructor.uiName || this.constructor.name;
}
//Customized name for this account or the default UI name
Backend.prototype.uiName = function() {
	return this.customName || this.autoName();
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
	if (!tasklist.id)
		return Promise.reject('Backend.tasklistPatch(): id not specified');
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
Many backends use Task() resources more or less directly.
Tasks moving between backends may have additional properties which need to be stripped
before JSONinfying them or passing to APIs.
Override this to perform any last-minute stripping down, normalization and adjustment
on insert()/update()/patch().
*/
Backend.prototype.TASK_FIELDS = [ //override if your API supports more/less fields
	'id', 'title', 'notes', 'status', 'parent', 'position',
	'updated', 'completed', 'due', 'deleted', 'hidden', 'links'];
Backend.prototype.taskToResource = function(task) {
	//console.debug('Backend.taskToResource', task);
	let taskRes = {};
	//Copy only the GTasks supported fields
	for (let key in task)
		if (this.TASK_FIELDS.indexOf(key) != -1)
			taskRes[key] = task[key];
	//Normalize fields
	taskResNormalize(taskRes);
	//console.debug('Backend.taskToResource -> ', taskRes);
	return taskRes;
}
Backend.prototype.resourceToTask = function(res) {
	if (res instanceof Task)
		return res; //safety: already a Task
	return new Task(res);
}


/*
Tasks
*/

//Backend.prototype.list = function(tasklistId)
//Required. Returns a promise to an array of all tasks in a taskslist. Tasklist ID has to be explicitly given.
//Remember to cache retrieved tasks if you're implementing this.

/*
Returns a promise for the given task or [tasks] content.
If tasklistId is not given, selected task list is assumed.
*/
Backend.prototype.get = function(taskIds, tasklistId) {
	if (!this.getOne && !this.getMultiple)
		throw "Backend: Querying tasks is not implemented";
	//Single task
	if (!Array.isArray(taskIds)) {
		if (this.getOne)
			return this.getOne(taskIds, tasklistId)
			.then(result => {
				this.cache.update(result);
				return result;
			});
		//Forward to many
		return this.getMultiple([taskIds], tasklistId)
			.then(results => {
				this.cache.update(results[taskIds]);
				return results[taskIds]
			});
	}
	//Multiple tasks
	if (this.getMultiple)
		return this.getMultiple(taskIds, tasklistId)
		.then(results => {
			this.cache.update(results);
			return results;
		});
	//Query one by one
	var batch = [];
	for (let i=0; i<taskIds.length; i++)
		batch.push(this.getOne(taskIds[i], tasklistId));
	return Promise.all(batch)
	.then(results => {
		var dict = {};
		results.forEach(item => dict[item.id] = item);
		this.cache.update(dict);
		return dict;
	});
}

//Retrieves one task by its ID. Returns the Task object.
//Backend.prototype.getOne = function(taskId, [tasklistId])

//Retrieves multiple tasks in a single request. Returns a promise for a taskId -> task map.
//If tasklistId is not given, selected task list is assumed.
//Backend.prototype.getMultiple = function(taskIds, [tasklistId])

//Backend.prototype.update = function (task, tasklistId)
//Updates the contents of the task on the server. Missing or null fields will be deleted.
//Returns the new task content (may be adjusted by the server).
//Required, or your tasklist is read-only.

//Updates only the fields present in Task objet. Fields set to null will be deleted. ID must be set.
//Returns a task-update or task-patch request
Backend.prototype.patch = function (task, tasklistId) {
	if (!task.id)
		return Promise.reject('Backend.patch(): id not specified');
	//Default: query + update
	return this.get(task.id, tasklistId)
	.then(result => {
		resourcePatch(result, task);
		return this.update(result, tasklistId);
	}).then(result => {
		this.cache.patch(task); //update cached version
		return result;
	});
}


//Backend.prototype.insert = function (task, previousId, tasklistId)
//Creates a new task on the given tasklist. Inserts it after the given previous task,
//under a given task.parent. Tasklist ID has to be explicitly given.
//Returns a task resource.
//Required, or you cannot add new tasks.

/*
Accepts a _id -> task list.
Inserts all tasks to the target tasklist and returns a _id->insertedTask map.

tasklistId: The tasklist to insert under. Has to be explicitly given.
task.parent: The parent to insert under
task.previousId: Insert after this task.

Tasks are inserted in the order given.
The _id is only used to identify tasks in the results.
*/
Backend.prototype.insertMultiple = function (tasks, tasklistId) {
	//console.debug('Backend.insertMultiple:',arguments);
	//Default: Call insert() multiple times.
	let results = {};
	let batch = [];
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


/*
Deletes a task or [tasks] from a single task list, non-recursively (without traversing their children).
Required for task deletion. The tasks must not have children outside this list.
Tasklist ID has to be explicitly given.

Q: My backend delete()s tasks with children. Is that okay?
A: Yes: The tasks must not have children, so if they have children you're only helping by deleting them.
Q: Can I optimize recursive deletion?
A: Override deleteWithChildren() and forward to delete()
*/
//Backend.prototype.delete = function (taskIds, tasklistId)


//Deletes the task with all children. If tasklistId is not given, assumes current task list.
Backend.prototype.deleteWithChildren = function (taskId, tasklistId) {
	//console.debug('Backend.deleteWithChildren:', arguments);
	taskId = toTaskId(taskId);
	if (!tasklistId) tasklistId = this.selectedTaskList;
	
	let ids = [taskId];
	let prom = null;
	//Currently only selected list supports recursive deletion
	if (tasklistId == this.selectedTaskList) {
		prom = this.getAllChildren(taskId, tasklistId)
		.then(children => {
			children.forEach(child => ids.push(child.id))
			//console.debug('Collected child ids:',ids);
		});
	} else
		prom = Promise.resolve();
	
	return prom
	.then(() => {
		//Remove everything from cache first, the deletion may take a while and people may look into cache
		//Some delete() implementations need cached objects for etags and such so retrieve these from cache and pass directly
		for (let i=0; i<ids.length; i++) {
			ids[i] = this.cache.get(ids[i]) || ids[i];
			this.cache.delete(ids[i].id || ids[i]);
		}
	})
	.then(() => {
		return this.delete(ids, tasklistId);
	});
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
	//console.debug('Backend.move:', arguments);
	taskIds = toArray(taskIds);
	if (newParentId && newParentId.id) newParentId = newParentId.id;
	if (newPrevId && newPrevId.id) newPrevId = newPrevId.id;
	if (!tasklistId) tasklistId = this.selectedTaskList;

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
	if (!tasklistId) tasklistId = this.selectedTaskList;
	
	//By default just update the task parent and choose a sort-order position
	return this.choosePosition(newParentId, newPrevId, tasklistId, taskId)
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
	if (!tasklistId) tasklistId = this.selectedTaskList;

	this.getChildren(taskId, tasklistId)
	.then(children => {
		if (isEmpty(children))
			return;
		//Note: This is super-clumsy if getChildren() is implemented non-cached: we query children, drop their data, then query again in move()->patch()
		var childIds = [];
		children.forEach(child => childIds.push(child.id));
		//console.debug("backend.moveChildren: from="+taskId+" to="+newParentId+" after="+newPrevId);
		return this.move(childIds, newParentId, newPrevId, tasklistId);
	})
}


/*
Tasks are sorted according to their .position property (required).
On move() the backend changes the .position of the task:
 * ideally for that task alone.
 * the frontend can tolerate changes in other tasks too (e.g. linked lists),
   so long as their order stays as requested.

Every backend has their own strategy for assigning positions.
Positions cannot be set by frontends manually and cannot be transferred between backends, only previousId can be used.
Special previousId values:
  null:			Place at the top of the list
  undefined:	Place wherever but preserve the order with multi-inserts (top to bottom).
  				The backend can choose the easiest default placement (topmost, bottommost).

The default update()-based implementation of move() assigns new positions directly by passing them
to insert()/update().

The default implementation of choosePosition():
* Tries to work with any external assignment of numerical positions: 1, 2, 3, 4...;  -1200, 0, 14, 9999...
* But works best when produces its own spaced distribution of positions (less updates)
*/
//Returns a position value that is guaranteed to be topmost => less than any used before
Backend.prototype.newTopmostPosition = function(parentId, tasklistId) {
	return (new Date(2001, 1, 1, 0, 0, 0) - new Date());
}
//Returns a position value that is guaranteed to be downmost => higher than any used before
Backend.prototype.newDownmostPosition = function(parentId, tasklistId) {
	//Default: current time in millioseconds since 2001.01.01
	return (new Date() - new Date(2001, 1, 1, 0, 0, 0));
}
//Chooses a new sort-order value for a task under a given parent, after a given previous task.
Backend.prototype.choosePosition = function(parentId, previousId, tasklistId, taskId) {
	//console.debug('choosePosition: parent=', parentId, 'previous=', previousId, 'taskId', taskId);

	/*
	Make at least undefined and null work for all lists and without further complications
	Thankfully if we just assign each task +-currentMilliseconds that's more or less granular enough,
	and they are really going to be topmost/bottommost in most orderings.
	And if your ordering had things higher/lower than that, that's the price of simplicity.
	
	Otherwise we would need to
	1. Query all the tasks from that list, find the topmost/bottommost
	2. Put additional requirements on multi-insert queries as those may need to become sequential --
	   if they're parallel we risk reusing the same new value.
	3. OR/AND further complicate caching, cache non-current lists, update with chosen position immediately
	   to prevent #2, and somehow track if we have the whole list in the cache or only some of its tasks.
	
	Let's keep it simple. We choose a low enough, granular enough (so that consequent inserts() get different values)
	self incrementing value and that's it.
	null and undefined are used for foreign list inserts, so their main function is just to be sequential.
	It doesn't matter _that_ much that the inserted set is really going to be the absolutely topmost ever
	*/
	if (typeof previousId == 'undefined')
		return Promise.resolve(this.newDownmostPosition());
	if (previousId == null)
		return Promise.resolve(this.newTopmostPosition());
	
	//For all the more compicated jobs we need the children list
	if (tasklistId && (tasklistId != this.selectedTaskList))
		throw "ChoosePosition: Currently unsupported for lists other than current";

	/*
	Note again:
	We try hard to choose positions with plently of space inbetween so that most of the times
	we can find a free position if the task is moved between others.
	But this space can be exhausted by lots of movings, and we also have to support foreign lists
	which can be simply 1,2,3,...
	So if there's not enough space we have to shift the following task positions.
	1. This requires multiple updates (which often cannot be batched, e.g. CalDAV)
	2. With multi-inserts we're screwed.
	
	How screwed are we?
	If inserts run in parallel and several of them do these shifts they may conflict first over
	reassigning positions, then over applying that to backend. Any combination of positions may
	thus be produced.
	Even if we serialize them (and screw performance) we'll still have way too many position updates.
	
	But:
	We in fact only insert() singular tasks between other tasks. Multi-inserts are only used when
	copying/moving "all childrne" to another list. So all multi-inserts are in fact null/undefined-inserts.
	And we only move() singular tasks too (the children don't need explicit moving).
	
	So let's ignore the obvious problems for the sake of simplicity.
	*/

	//Choose a new position betweeen previous.position and previous.next.position
	return this.getChildren(parentId, tasklistId)
	.then(children => {
		//console.debug('choosePosition: children=',children);
		let prevPosition = null;
		let nextPosition = null;
		let prevIdx = null;
		
		if (!previousId) {
			prevPosition = this.newTopmostPosition();
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
		
		//Ensure everything is integer before doing math or comparisons and additions will hopelessly surprise you
		nextPosition = +nextPosition;
		prevPosition = +prevPosition;
		
		let newPosition = Math.floor((nextPosition + prevPosition) / 2);
		//Never position higher than the previous one.
		if (newPosition < prevPosition + 1)
			newPosition = prevPosition + 1;
		//console.debug('prevPosition', prevPosition, 'nextPosition', nextPosition, 'newPosition', newPosition);
		
		//If we've exhaused the inbetween value space, shift
		if (newPosition >= nextPosition)
			return this._positionShiftDown(children, prevIdx+1, taskId)
				.then(() => newPosition);
		else
			return newPosition;
	});
}

/*
Updates position values for multiple sequential sibling tasks starting with #i1,
so that each task's position is strictly > than the previous one.
If #taskId is given, stops before that task. (Usually that's the task being moved, creating a slot at that point)

This is a last-resort effort for tightly-packed sort orders. Try to leave enough space
between positions.
*/
Backend.prototype._positionShiftDown = function(children, i1, taskId) {
	let patches = [];
	let pos = children[i1].position;
	for (let i=i1; i<children.length; i++) {
		if (children[i].id == taskId)
			break;
		if (children[i].position > pos)
			break; //Enough empty space, no further shift needed
		pos = pos + 1;
		children[i].position = pos;
		patches.push(this.patch({ id: children[i].id, position: children[i].position, }))
	}
	if (patches.length <= 0)
		return Promise.resolve();
	else
		return Promise.all(patches);
}


/*
Copies a number of tasks to a new tasklist/backend, giving them new Ids.
  items: taskId -> {
  	parent: new parentId,
  	previous: new previousId,
  	[task: task,]					default: try to get by id
  }
Returns:
  taskId -> insertedTask
 
Reimplement to copy faster/with associated data/history, etc.
To reuse the logic for child traversal, call this.copyChildren() -- example below.
 Q: Can I NOT reuse the logic? My backend already handles recursion.
 A: Sure. You can override copyChildren() too or leave it alone - it'll still work.
*/
Backend.prototype.copyToList = function (items, newTasklistId, newBackend, recursive) {
	console.debug('Backend.copyToList:',arguments);
	if (isEmpty(items)) return Promise.resolve();
	if (!newBackend) newBackend = this;
	
	//Default: Simply duplicate and insert() the tasks.
	//Descendants might have better methods which also copy backend history/associated properties
	
	let newItems = {};
	for (let taskId in items) {
		let item = items[taskId];
		let newTask = item.task || this.cache.get(taskId);
		if (!newTask)
			throw "Backend.copyToList: Task data not found: "+taskId
		newTask = taskResClone(newTask);
		newTask.id = null; //we'll need new ID
		newTask.parent = item.parent;
		newTask.previousId = item.previous;
		newItems[taskId] = newTask;
	}
	
	if (isEmpty(newItems)) {
		console.debug('Backend.copyToList: newItems is empty: ', newItems);
		return Promise.resolve();
	}
	let batch = newBackend.insertMultiple(newItems, newTasklistId);
	if (recursive)
		//insertMultiple() returns a compatible oldId -> newTask dict
		batch = batch.then(results => {
			console.debug('Backend.copyToList: insert results=', results);
			return this.copyChildrenTo(results, newTasklistId, newBackend);
		});

	return batch;
}

/*
For every taskId in "pairs" copies all children of that task to pairs[taskId].id, recursively.
Example:
  copyChildrenTo([oldTask.id: newTask}], newTasklistId);
 
Reimplement if you can optimize: choose children positions all at once etc.
You do not HAVE to reimplement this if your copyToList() already handles recursion. This will still work if called.
*/
Backend.prototype.copyChildrenTo = function (pairs, newTasklistId, newBackend) {
	console.debug('Backend.copyChildrenTo:',arguments);
	if (isEmpty(pairs)) return Promise.resolve();
	if (!newBackend) newBackend = this;
	
	//Query children for every entry
	let oldIds = [];
	let oldBatch = [];
	for (let oldTaskId in pairs) {
		oldIds.push(oldTaskId);
		oldBatch.push(this.getChildren(oldTaskId));
	}
	
	return Promise.all(oldBatch)
	.then(results => {
		console.debug('Backend.copyChildrenTo: oldTasks=', results)
		//Build a batch copyToList request for all children on this nesting level
		let batch = {};
		for (let i=0; i<oldIds.length; i++) {
			let oldTaskId = oldIds[i];
			let children = results[i];
			//Add children backwards so that each new child can be appended "at the top" --
			//otherwise we'd need to know the previous child ID and can't batch.
			children.reverse().forEach(oldChild => {
				//Add request to batch
				let item = {};
				item.task = oldChild; //do not requery the contents
				item.parent = pairs[oldTaskId].id;
				item.previous = null; //add to the top
				batch[oldChild.id] = item;
			});
		}
		
		if (isEmpty(batch)) {
			console.debug('Backend.copyChildrenTo: nothing to copy');
			return Promise.resolve();
		}
		
		//Copy the children and run us recursively on them
		return this.copyToList(batch, newTasklistId, newBackend, true);
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
	console.debug('Backend.moveToList:',arguments);
	if (!newBackend) newBackend = this;
	if (!newTasklistId || (newTasklistId == this.selectedTaskList))
		return Promise.resolve();
	var oldTasklistId = this.selectedTaskList;

	return this.cachedGet(oldTask)
		.then(task => {
			console.debug('Backend.moveToList: queried task=',task);
			oldTask = task;
			let pairs = {}
			pairs[oldTask.id] = { task: oldTask, parent: null, previous: null };
			return this.copyToList(pairs, newTasklistId, newBackend, true);
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
		return Promise.resolve(this.cache.getList(tasklistId));
	this.selectedTaskList = tasklistId;
	this.cache.clear();
	if (!this.selectedTaskList)
		return Promise.resolve([]);
	//Reload the cache
	return this.cacheLoadList(this.selectedTaskList);
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
	this.items = {};
}
unit.export(TaskCache);
TaskCache.prototype.clear = function() {
	this.items = {};
}
//Adds a new task resources to the cached task list
TaskCache.prototype.add = function(tasks) {
	this.update(tasks);
}
//Adds all tasks belonging to a certain tasklist
TaskCache.prototype.addList = function(tasks, tasklistId) {
	for (let i = 0; i < tasks.length; i++) {
		//Skip deleted for now because retrieving clients do not properly check
		if (tasks[i].deleted)
			continue;
		tasks[i].tasklist = tasklistId; //in case it's not set
		this.add(tasks[i]);
	}
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
TaskCache.prototype.values = function() {
	return Object.values(this.items);
}
TaskCache.prototype.get = function (taskId) {
	//console.debug('cache.get:', taskId, this.items);
	return this.items[taskId];
}
//Retrieves all cached tasks belonging to a given tasklist
TaskCache.prototype.getList = function(tasklistId) {
	let items = [];
	for (let id in this.items)
		if (this.items[id].tasklist == tasklistId)
			items.push(this.items[id]);
	return items;
}
TaskCache.prototype.update = function (tasks) {
	//console.debug('cache.update:', arguments);
	if (!Array.isArray(tasks))
		tasks = [tasks];
	for (let i=0; i<tasks.length; i++)
		this.items[tasks[i].id] = tasks[i];
}
//Updates given fields in the cached task entry. Same semantics as backend.patch
TaskCache.prototype.patch = function (patch) {
	//console.debug('cache.patch:', arguments);
	var task = this.items[patch.id];
	if (task)
		resourcePatch(task, patch);
}
//Preloads all tasks from a tasklist into cache
Backend.prototype.cacheLoadList = function(tasklistId) {
	var prom = this.list(tasklistId);
	prom = prom.then(items => {
		this.cache.addList(items || [], tasklistId)
		return items;
	});
	return prom;
}
//Similar to .get(), but can return from cache.
//+ If you pass it a Task object, will simply return that.
Backend.prototype.cachedGet = function(taskIds, tasklistId) {
	//console.debug('cachedGet:', taskIds, tasklistId);
	if (!taskIds) return Promise.resolve();
	let isArray = Array.isArray(taskIds);
	if (!isArray) taskIds = [taskIds];

	let tasks = {};
	let requestIds = [];
	for (let i in taskIds) {
		let taskId = taskIds[i];
		if (taskId.id) {
			tasks[taskId.id] = taskId; //already a task
			continue;
		}
		let task = this.cache.get(taskId);
		if (task)
			tasks[taskId] = task;
		else
			requestIds.push(taskId);
	}
	console.debug('cachedGet: will query:', requestIds);
	let prom = (requestIds.length <= 0) ? Promise.resolve({}) :
		this.get(taskIds, tasklistId);
	return prom.then(results => {
		for (let taskId in results)
			tasks[taskId] = results[taskId];
		if (!isArray)
			return tasks[taskIds[0]];
		return tasks;
	});
}

//Returns an array of all children tasks of a given task, sorted by their sort order
Backend.prototype.getChildren = function (parentId, tasklistId) {
	if (parentId && parentId.id) parentId = parentId.id; //sometimes we're given the task object instead of id
	var list = [];
	for (let key in this.cache.items) {
		var task = this.cache.items[key];
		if (!parentId && (task.parent))
			continue;
		if ((parentId) && (task.parent != parentId))
			continue;
		list.push(task);
	}
	list = list.sort((a, b) => a.position - b.position);
	return Promise.resolve(list);
}
//Returns an array of all children tasks of a given task at any level
Backend.prototype.getAllChildren = function (parentId, tasklistId) {
	if (parentId && parentId.id) parentId = parentId.id; //sometimes we're given the task object instead of id
	var list = [];
	for (let key in this.cache.items) {
		var task = this.cache.items[key];
		while (task && (task.parent != parentId))
			task = task.parent ? this.cache.items[task.parent] : null;
		if (task)
			list.push(this.cache.items[key]); //the original match
	}
	return Promise.resolve(list);
}

//Dummy backend is used in place of misbehaving backends.
//It does nothing and only allows you to sign out/delete it.
function DummyBackend(name, error) {
	Backend.call(this);
	this.error = error; //store for init() reject
	//Pretend to be a backend named "name", otherwise it'll look like "DummyBackend" in UI
	this.__proto__ = Object.create(DummyBackend.prototype);
	this.__proto__.constructor = {}; // not a function, so that we can overwrite .name
	this.__proto__.constructor.name = name;
}
unit.export(DummyBackend);
inheritBackend(Backend, DummyBackend);
DummyBackend.prototype.init = function() { return Promise.reject(this.error); }
DummyBackend.prototype.isSignedIn = function() { return false; }
//Support signout() to let the user remove the permanently bugged out backends
DummyBackend.prototype.signout = function() { return Promise.resolve(); }