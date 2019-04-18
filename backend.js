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
	resourcePatch(task, patch);
},
}


/*
Backend base class.
Implements some functions in the default way in case you don't have more performant overrides
Most functions:
 - return a promise, without error checks
 - accept both taskIds and task objects
*/
function Backend() {
	this.onSignInStatus = [];
}

/*
Connection
Implementations must notify onSigningChange subscribers.
*/
//Connect to the backend
Backend.prototype.connect = function() {
	log("Backend.connect");
	//Automatically consider us signed in
	this.signin();
	return Promise.resolve();
}
//Sign in to the backend with the configured params
Backend.prototype.signin = function() {
	log("Backend.signin");
	this._signedIn = true;
	this.notifySignInStatus(true);
	return Promise.resolve();
}
//Sign out from the backend
Backend.prototype.signout = function() {
	log("Backend.signout");
	this._signedIn = false;
	this.notifySignInStatus(false);
	return Promise.resolve();
}
Backend.prototype.isSignedIn = function() {
	return this._signedIn;
}
//Notifies the subscribers about the signin change
Backend.prototype.notifySignInStatus = function(status) {
	log("Notifying subscribers: SignIn status="+status);
	this.onSignInStatus.forEach(handler => handler(status));
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
Backend.prototype.tasklistPatch = function(tasklist) {
	//Default: query + update
	return this.tasklistGet(tasklist.id).then(result => {
		resourcePatch(result, tasklist);
		return this.tasklistUpdate(result);
	});
}


/*
Tasks
*/
Backend.prototype.get = function(taskId) {
	if (this.getAll == Backend.prototype.getAll)
		throw "Not implemented";
	//Default: forward to getAll
	return this.getAll([taskId]).then(results => results[0]);
}

//Retrieves multiple tasks in a single request. Returns a promise for a taskId -> task map.
Backend.prototype.getAll = function(taskIds) {
	if (this.get == Backend.prototype.get)
		throw "Not implemented";
	//Default: forward to get() one by one
	var proms = [];
	for (let i=0; i<taskIds.length; i++)
		proms.push(this.get(taskId));
	return Promise.all(proms); //this'll naturally return the array of results
}

//Updates only the fields mentioned in "task". Fields set to none will be deleted. ID must be set.
//Returns a task-update or task-patch request
Backend.prototype.patch = function (task, allChildrenIds) {
	//Default: query + update
	log(task);
	return this.get(task.id).then(result => {
		resourcePatch(result, task);
		return this.update(result);
	}).then(result => {
		taskCache.patch(task); //update cached version
		return result;
	});
}
//Insert, but assumes the current task list
Backend.prototype.insertToCurrentList = function (task, previousId) {
	return this.insert(task, previousId, this.selectedTaskList);
}

/*
Deletes the task with all children. If tasklistId is not given, assumes current task list.
*/
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


//Moves a task to a new position in the same task list (currently selected one)
// parentId: null == top level
// previousId: null == first position
Backend.prototype.move = function (taskId, parentId, previousId) {
	if (this.moveAll == Backend.prototype.moveAll)
		throw "Not implemented";
	//Default: forward to moveAll()
	if (taskId && taskId.id) taskId = taskId.id;
	return this.moveAll([taskId], parentId, previousId).then(results => results[0]);
}
// Moves all given tasks under a new parent in the same task list,
// inserting them in the given order after a given task (null = at the top).
Backend.prototype.moveAll = function (taskIds, newParentId, newPrevId) {
	if (this.move == Backend.prototype.move)
		throw "Not implemented";
	//Default: forward to move() one by one
	var proms = [];
	taskIds.reverse().forEach(id => {
		proms.push(this.move(id, newParent, newPrevId));
	});
	return Promise.all();
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
	children.forEach(child => childIds.push(child));
	
	log("backend.moveChildren: from="+taskId+" to="+newParentId+" after="+newPrevId);
	return this.moveAll(childIds, newParentId, newPrevId);
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
	log("getLevel: "+JSON.stringify(task));
	var level = 0;
	while (task.parent) {
		level++;
		task = taskCache.get(task.parent);
	}
	return level;
}
//Returns an array of all children tasks of a given task, sorted by their sort order
Backend.prototype.getChildren = function (parentId) {
	log("getChildren: "+parentId);
	if (parentId && parentId.id) parentId = parentId.id; //sometimes we're given the task object instead of id
	var list = [];
	Object.keys(taskCache.items).forEach(key => {
		log("cached: "+key);
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
