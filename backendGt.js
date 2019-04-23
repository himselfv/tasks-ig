/*
Implements task backend based on Google Tasks.
Currently that's the only backend but functions should be neutral enough that it's possible to implement another one later.

Requires globals:
  var GTASKS_CLIENT_ID
  var GTASKS_API_KEY

*/
function BackendGTasks() {
	Backend.call(this);
}
BackendGTasks.prototype = Object.create(Backend.prototype);

// Array of API discovery doc URLs for APIs used by the quickstart
var DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/tasks/v1/rest"];

// Authorization scopes required by the API; multiple scopes can be included, separated by spaces.
var SCOPES = "https://www.googleapis.com/auth/tasks.readonly https://www.googleapis.com/auth/tasks";

/*
Connection
*/
BackendGTasks.prototype.connect = function() {
	//Load the auth2 library and API client library.
	var prom = new Promise((resolve, reject) => {
		gapi.load('client:auth2', {
		  'callback': () => resolve(),
		  'onerror': () => reject("GAPI client failed to load"),
		});
	})
	.then(result =>
		//Initialize the API client library
		gapi.client.init({
			apiKey: GTASKS_API_KEY,
			clientId: GTASKS_CLIENT_ID,
			discoveryDocs: DISCOVERY_DOCS,
			scope: SCOPES
		})
	)
	.then(result => {
		this._initialized = true;
		//Listen for sign-in state changes.
		gapi.auth2.getAuthInstance().isSignedIn.listen(updateSigninStatus);
		//Handle the initial sign-in state.
		this.notifySignInStatus(gapi.auth2.getAuthInstance().isSignedIn.get());
	});
	return prom;
}
BackendGTasks.prototype.signin = function() {
	return gapi.auth2.getAuthInstance().signIn();
}
//Call to disconnect from the backend
BackendGTasks.prototype.signout = function() {
	return gapi.auth2.getAuthInstance().signOut();
}
Backend.prototype.isSignedIn = function() {
	return (this._initialized) ? (gapi.auth2.getAuthInstance().isSignedIn.get()) : false;
}


/*
Common
*/
//Checks one part of a batch-response and throws if it's an error
BackendGTasks.prototype.responseCheck = function (response) {
	if (response.status != 200)
		throw response;
}

BackendGTasks.prototype.batchResponseCheck = function (response) {
	Object.keys(response.result).forEach(id => {
		this.responseCheck(response.result[id]);
	});
}


/*
Task lists
*/
//Returns an array of TaskList objects (promise)
BackendGTasks.prototype.tasklistList = function() {
	return gapi.client.tasks.tasklists.list({
		'maxResults': 100
	}).then(response => {
		return response.result.items;
	});
}
BackendGTasks.prototype.tasklistAdd = function(title) {
	var tasklist = {
		'title': title,
	};
	//"request body" is passed as "resource" param
	return gapi.client.tasks.tasklists.insert({
		'resource': tasklist,
	}).then(response => {
		return response.result;
	});
}
BackendGTasks.prototype.tasklistGet = function(tasklistId) {
	return gapi.client.tasks.tasklists.get({
		'tasklist': tasklistId,
	}).then(response => {
		return response.result;
	});
}
BackendGTasks.prototype.tasklistUpdate = function(tasklist) {
	//"request body" is passed as "resource" param
	return gapi.client.tasks.tasklists.update({
		'tasklist': tasklist.id,
		'resource': tasklist
	});
}
//Warning! Deletes the task list with the given id
BackendGTasks.prototype.tasklistDelete = function(tasklistId) {
	return gapi.client.tasks.tasklists.delete({
		'tasklist': tasklistId,
	});
}


/*
Tasks
*/
BackendGTasks.prototype.list = function(tasklistId) {
	return gapi.client.tasks.tasks.list({
		'tasklist': tasklistId,
		'maxResults': 100,
		'showCompleted': true,
		'showHidden': false,
		'fields': 'items(id,title,parent,position,notes,status,due,completed)',
	}).then(response => response.result);
}

//Returns a promise for the given task content
BackendGTasks.prototype.get = function (taskId) {
	return gapi.client.tasks.tasks.get({
		'tasklist': this.selectedTaskList,
		'task': taskId,
	}).then(response => response.result);
}

//Retrieves multiple tasks in a single request.
//Returns a promise for a taskId -> task map.
BackendGTasks.prototype.getAll = function(taskIds) {
	var batch = gapi.client.newBatch();
	taskIds.forEach(taskId => batch.add(gapi.client.tasks.tasks.get({
		'tasklist': this.selectedTaskList,
		'task': taskId,
	})));
	return batch.then(response => {
		//Unpack the response
	    let results = {};
		Object.keys(response.result).forEach(respId => {
			let thisResponse = response.result[respId];
			this.responseCheck(thisResponse);
			results[thisResponse.result.id] = thisResponse.result
		});
		return results;
	});
}

//Returns a task-update request
BackendGTasks.prototype.update = function (task) {
	//log(task);
	//"request body" is passed as "resource" param
	return gapi.client.tasks.tasks.update({
		'tasklist': this.selectedTaskList,
		'task': task.id,
		'resource': task
	}).then(response => {
		taskCache.update(task); //update cached version
		return response;
	});
}

//Creates a new task on the given tasklist. Inserts it after the given previous task.
//Inserts it under a given parent (in the task object).
//Returns a task resource.
BackendGTasks.prototype.insert = function (task, previousId, tasklistId) {
	//log("backend.insert: tasklist="+tasklistId+", parent="+task.parent+", prev="+previousId);
	//log(task);
	return gapi.client.tasks.tasks.insert({
		'tasklist': tasklistId,
		'parent': task.parent,
		'previous': previousId,
		'resource': task
	}).then(response => {
		if (tasklistId == this.selectedTaskList)
			taskCache.add(response.result); //Add task resource to cache
		return response.result;
	});
}

//Deletes multiple tasks from a single task list, non-recursively.
BackendGTasks.prototype.deleteAll = function (taskIds, tasklistId) {
	var batch = gapi.client.newBatch();
	taskIds.forEach(id => {
		batch.add(gapi.client.tasks.tasks.delete({
			'tasklist': tasklistId,
			'task': id,
		}));
	});
	return batch.then(response => {
		//log("backend.deleteAll() success");
		return response;
	});
}


//Moves a task to a new position in the same task list (currently selected one)
// parentId: null == top level
// previousId: null == first position
BackendGTasks.prototype.move = function (taskId, parentId, previousId) {
	if (taskId && taskId.id) taskId = taskId.id;
	if (parentId && parentId.id) parentId = parentId.id;
	if (previousId && previousId.id) previousId = previousId.id;

	var req = {
		'tasklist': this.selectedTaskList,
		'task': taskId,
	};
	if (parentId) req.parent = parentId;
	if (previousId) req.previous = previousId;
	//log("backend.move");
	//log(req);
	return gapi.client.tasks.tasks.move(req).then(response => {
		taskCache.patch({ //update this tasks's cached data
			'id': taskId,
			'parent': parentId,
			'position': response.result.position,
		});
		return response;
	});
}

// Moves all given tasks under a new parent in the same task list,
// inserting them in the given order after a given task (null = at the top).
BackendGTasks.prototype.moveAll = function (taskIds, newParentId, newPrevId) {
	//log("backend.moveAll: "+taskIds.length+" items to="+newParentId+" after="+newPrevId);
	if (taskIds.length <= 0)
		return Promise.resolve();

	var batch = gapi.client.newBatch();
	//Iterate in reverse so that we can insert each child after the same known one
	taskIds.reverse().forEach(id => {
		let req = {
			'tasklist': this.selectedTaskList,
			'task': id,
		};
		if (newParentId) req.parent = newParentId;
		if (newPrevId) req.previous = newPrevId;
		batch.add(gapi.client.tasks.tasks.move(req));
	})
	batch = batch.then(response => {
		//log("backend.moveAll: results here, patching cache");
		Object.keys(response.result).forEach(oldId => {
			let thisResponse = response.result[oldId];
			this.responseCheck(thisResponse);
			taskCache.patch({ //update this tasks's cached data
				'id': thisResponse.result.id,
				'parent': newParentId,
				'position': thisResponse.result.position,
			});
		});
	});
	return batch;
}



/*
Builds a batch promise that for every pair in "pairs" copies all children of pair.from to pair.to,
recursively.
Example:
  batchCopyChildren([{'from': oldTask, 'to': newTask}], newTasklistId);
Copies all children of oldTask under newTask, recursively.
*/
BackendGTasks.prototype.batchCopyChildren = function (pairs, newTasklistId) {
	if (!pairs || (pairs.length <= 0)) return Promise.resolve();

	var pairs_new = [];

	var batch = null; //won't be created unless needed

	//Build a batch request for all children on this nesting level
	pairs.forEach(pair => {
		//Get all source children
		let children = this.getChildren(pair.from);
		//Add children backwards so that each new child can be appended "at the top" --
		//otherwise we'd need to know the previous child ID and can't batch.
		children.reverse().forEach(oldChild => {
			let newChild = taskResClone(oldChild);
			newChild.parent = pair.to.id;
			//Add as a new pair entry
			pairs_new.push({ 'from': oldChild, 'to': null });
			//Create batch on first need
			if (!batch)
				batch = gapi.client.newBatch();
			//Add request to batch
			batch.add(
				gapi.client.tasks.tasks.insert({
					'tasklist': newTasklistId,
					'parent': pair.to.id,
					'previous': null, //add to the top
					'resource': newChild,
				}),
				{ 'id': oldChild.id, }
			);
		});
	});

	if (!batch)
		return Promise.resolve();

	batch = batch.then(response => {
		//Now that we have a response, update a shared variable pairs_new with generated children ids,
		//and return a new promise to copy the next nested level

		Object.keys(response.result).forEach(oldId => {
			let thisResponse = response.result[oldId];
			//If any of the requests is rejected for any reason, abort
			this.responseCheck(thisResponse);
			let pair = pairs_new.find(item => { return item.from.id == oldId; });
			if (!pair)
				log("can't find pair for id = "+oldId);
			pair.to = thisResponse.result;
		});

		return this.batchCopyChildren(pairs_new, newTasklistId);
	});

	return batch;
}

//Copies a task with children to a given position in a different task list
BackendGTasks.prototype.copyToList = function (oldTask, newTasklistId, newParentId, newPrevId) {
	//log("backend.copyToList: oldTask="+oldTask.id+", newTasklistId="+newTasklistId);
	var newTask = taskResClone(oldTask);
	newTask.parent = newParentId;
	var prom = this.insert(newTask, newPrevId, newTasklistId)
		.then(response => {
			//insert returns the final form of the task
			let pairs = [{'from': oldTask, 'to': response.result}];
			return this.batchCopyChildren(pairs, newTasklistId);
		});
	return prom;
}

//Moves a task with children to a new position in a different task list.
//May change task id.
BackendGTasks.prototype.moveToList = function (oldTask, newTasklistId, newParentId, newPrevId) {
	if (!newTasklistId || (newTasklistId == this.selectedTaskList))
		return this.move(oldTask, newParentId, newPrevId);

	if (oldTask && !(oldTask.id)) oldTask = taskCache.get(oldTask);
	var oldTasklistId = this.selectedTaskList;

	//log("backend.moveToList: oldTask="+oldTask+", newTasklist="+newTasklistId);

	//There's no such function in Tasks API so we have to copy the task subtree + delete the original one
	return this.copyToList(oldTask, newTasklistId, newParentId, newPrevId)
		.then(response => {
			//log("copied!");
			return this.delete(oldTask, oldTasklistId);
		});
}
