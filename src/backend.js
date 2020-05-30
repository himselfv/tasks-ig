/*
Task resources and task cache.

Task and tasklist resources are similar to the objects the GS API returns.
Patch resources are similar to GS API patch sets.

https://developers.google.com/tasks/v1/reference/tasks#resource
https://developers.google.com/tasks/v1/reference/tasklists#resource

Even if a backend has nothing to do with GTasks it needs to provide the same resources.
See below for minimal structures.
*/
exports = exports || {};
if (require) {
	let utils = require('./utils.js');
	utils.importAll(utils);
}

//Lists all registered backend types for the application.
//Backend normally self-register when they're available.
var backends = [];
exports.backends = backends;
function registerBackend(ctor, name) {
	if (name)
		ctor.uiName = name;
	backends.push(ctor);
}
exports.registerBackend = registerBackend;
/*
A backend must be an object, its constructor correct -- it will be used to recreate it.
  Derived.prototype = Object.create(Base.prototype); //or new Base(), if running Base() breaks nothing
  Derived.prototype.constructor = Derived;
*/
function inheritBackend(fromWhat, what) {
	what.prototype = Object.create(fromWhat.prototype);
	what.prototype.constructor = what;
}
exports.inheritBackend = inheritBackend;


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
//Normalizes some fields which should be changed in accord
function taskResNormalize(task) {
	if ((task.status == "completed") && !task.completed)
		task.completed = new Date(); //now
	if ((task.status != "completed") && task.completed)
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
exports.toArray = toArray;
function toTaskIds(taskIds) {
	if ((typeof taskIds == 'undefined') || (taskIds==null)) return taskIds;
	if (!Array.isArray(taskIds))
		taskIds = [taskIds];
	for (let i=0; i<taskIds.length; i++)
		if (taskIds[i].id) taskIds[i] = taskIds[i].id;
	return taskIds;
}
exports.toTaskIds = toTaskIds;
function toTaskId(taskId) {
	if (taskId && taskId.id)
		taskId = taskId.id;
	return taskId;
}
exports.toTaskId = toTaskId
//True if a dictionary or an array is empty, or undefined
function isEmpty(list) {
	//Arrays: we can check .length, but for !arrays it might be undefined (!<=0).
	//Checking .keys() works for both.
	return (!list || !Object.keys(list).length);
}
exports.isEmpty = isEmpty;
//Same but requires the parameter to be an array
function isArrayEmpty(list) {
	if (list && !Array.isArray(list))
		throw "Array expected, found: "+list;
	return (!list || (list.length <= 0));
}
exports.isArrayEmpty = isArrayEmpty;


/*
Detects additions, deletions and edits between two dictionaries
Returns a dict of key => {oldValue, newValue} pairs.
*/
function diffDict(oldDict, newDict, comparer) {
	comparer = comparer || ((a, b) => { return (a==b)}); //The default naive comparer
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
exports.diffDict = diffDict;


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
exports.Callback = Callback;


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
exports.Backend = Backend;

//Initialize the backend instance, load any neccessary libraries
Backend.prototype.init = function() {
	//console.log("Backend.init");
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
	//console.log("Backend.signin");
	this._signedIn = true;
	this.notifySignInStatus(true);
	//Return the same cookies unchanged
	return Promise.resolve(params);
}
//Sign out from the backend
Backend.prototype.signout = function() {
	//console.log("Backend.signout");
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
//Once logged in, returns the UI name for this account
Backend.prototype.uiName = function() {
	//By default just returns the backend name. Fall back to this if not logged in / no better ideas.
	return this.constructor.uiName || this.constructor.name;
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
	for (key in task)
		if (this.TASK_FIELDS.indexOf(key) != -1)
			taskRes[key] = task[key];
	//Normalize fields
	taskResNormalize(taskRes);
	//console.debug('Backend.taskToResource -> ', taskRes);
	return taskRes;
}


/*
Tasks
*/

//Backend.prototype.list = function(tasklistId)
//Required. Returns a promise to an array of all tasks in a taskslist.
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
		return this.getMultiple(taskIds)
		.then(results => {
			this.cache.update(results);
			return results;
		});
	//Query one by one
	var batch = [];
	for (let i=0; i<taskIds.length; i++)
		batch.push(this.get(taskIds[i], tasklistId));
	return Promise.all(batch)
	.then(results => {
		var dict = {};
		results.forEach(item => dict[item.id] = item);
		this.cache.update(dict);
		return dict;
	});
}

//Retrieves one task by its ID. Returns the Task object.
//Backend.prototype.getOne = function(taskId, tasklistId)

//Retrieves multiple tasks in a single request. Returns a promise for a taskId -> task map.
//If tasklistId is not given, selected task list is assumed.
//Backend.prototype.getMultiple = function(taskIds, tasklistId)

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


//Backend.prototype.insert = function (task, previousId, tasklistId)
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
	//console.log('Backend.insertMultiple:',arguments);
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


/*
Deletes a task or [tasks] from a single task list, non-recursively (without traversing their children).
Required for task deletion. The tasks must not have children outside this list.

Q: My backend delete()s tasks with children. Is that okay?
A: Yes: The tasks must not have children, so if they have children you're only helping by deleting them.
Q: Can I optimize recursive deletion?
A: Override deleteWithChildren() and forward to delete()
*/
//Backend.prototype.delete = function (taskIds, tasklistId)


//Deletes the task with all children. If tasklistId is not given, assumes current task list.
Backend.prototype.deleteWithChildren = function (taskId, tasklistId) {
	//console.debug('Backend.deleteWithChildren:', arguments);
	if (taskId && taskId.id) taskId = taskId.id;
	if (!tasklistId) tasklistId = this.selectedTaskList;
	
	ids = [taskId];
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
	taskIds = toArray(taskIds);
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

	this.getChildren(taskId, this.selectedTaskList)
	.then(children => {
		if (isEmpty(children))
			return;
		//Note: This is super-clumsy if getChildren() is implemented non-cached: we query children, drop their data, then query again in move()->patch()
		var childIds = [];
		children.forEach(child => childIds.push(child.id));
		//console.log("backend.moveChildren: from="+taskId+" to="+newParentId+" after="+newPrevId);
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
		let ret = null;
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
	for (oldTaskId in pairs) {
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
	console.log(this);
	if (!newBackend) newBackend = this;
	if (!newTasklistId || (newTasklistId == this.selectedTaskList))
		return Promise.resolve();
	var oldTasklistId = this.selectedTaskList;

	return this.cachedGet(oldTask)
		.then(task => {
			console.debug('Backend.moveToList: queried task=',task);
			oldTask = task;
			pairs = {}
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
exports.TaskCache = TaskCache;
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
	//console.debug('cache.get:', taskId, this.items);
	return this.items[taskId];
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
	var prom = this.list(this.selectedTaskList);
	prom = prom.then(items => {
		let tasks = items || [];
		for (let i = 0; i < tasks.length; i++)
			if (!tasks[i].deleted)
				this.cache.add(tasks[i]);
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
	list = list.sort((a, b) => { return a.position - b.position; });
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
	console.log(this);
}
exports.DummyBacked = DummyBackend;
inheritBackend(Backend, DummyBackend);
DummyBackend.prototype.init = function() { return Promise.reject(this.error); }
DummyBackend.prototype.isSignedIn = function() { return false; }
//Support signout() to let the user remove the permanently bugged out backends
DummyBackend.prototype.signout = function() { return Promise.resolve(); }