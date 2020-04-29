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

function isChromeExtension() {
	//Note that FF has chrome and chrome.runtime too, and even chrome.runtime.id
	return ((typeof chrome != 'undefined') && chrome.runtime && chrome.runtime.id && (typeof browser == 'undefined'));
}

//Self-register
function backendGtSupported() {
	if (isChromeExtension()) return true;
	if ((typeof GTASKS_CLIENT_ID != 'undefined') && (typeof GTASKS_API_KEY != 'undefined'))
		return true;
	else
		log("BackendGTasks: ClientId / API key not set");
	return false;
}
if (backendGtSupported())
	registerBackend("Google Tasks", BackendGTasks);


/*
Google API initialization
*/
function insertGoogleAPIs() {
	return loadScript('googleAPIscripts', "https://apis.google.com/js/api.js");
}
function gapiLoad() {
	log('loading gapi');
	return new Promise((resolve, reject) => {
		gapi.load('client:auth2', {
			'callback': () => resolve(),
			'onerror': () => { log("gapi load fail"); reject("GAPI client failed to load"); },
		});
	});
}


/*
Connection
*/
BackendGTasks.prototype.connect = function() {
	var prom = insertGoogleAPIs()
	//Load the auth2 library and API client library.
	.then(result => gapiLoad())
	//Initialize the API client library
	.then(result => this.clientLogin())
	.then(result => {
		this._initialized = true;
		if (!isChromeExtension())
			//Listen for sign-in state changes.
			gapi.auth2.getAuthInstance().isSignedIn.listen(updateSigninStatus);
		//Handle the initial sign-in state.
		this.notifySignInStatus(this.isSignedIn());
	});
	return prom;
}
BackendGTasks.prototype.clientLogin = function() {
	if (isChromeExtension()) {
		return this.chromeClientLogin()
	} else {
		return gapi.client.init({
			apiKey: GTASKS_API_KEY,
			discoveryDocs: DISCOVERY_DOCS,
			clientId: GTASKS_CLIENT_ID,
			scope: SCOPES
		});
	};
}
BackendGTasks.prototype.signin = function() {
	if (isChromeExtension())
		return;
	return gapi.auth2.getAuthInstance().signIn();
}
//Call to disconnect from the backend
BackendGTasks.prototype.signout = function() {
	if (isChromeExtension())
		this.chromeSignOut();
	else
		return gapi.auth2.getAuthInstance().signOut();
}
BackendGTasks.prototype.isSignedIn = function() {
	if (isChromeExtension())
		return this.chromeIsSignedIn();
	return (this._initialized) ? (gapi.auth2.getAuthInstance().isSignedIn.get()) : false;
}


/*
Chrome extension have to use its OAuth system -- gapi.client.init->gapi.auth2 won't work
*/
function chromeGetAuthToken() {
	return new Promise((resolve, reject) => chrome.identity.getAuthToken({'interactive': true}, function(token) {
		if (chrome.runtime.lastError)
			reject(chrome.runtime.lastError);
		resolve(token);
	}));
}
BackendGTasks.prototype.chromeClientLogin = function() {
	return chromeGetAuthToken().then(token => {
		this.chromeAuthToken = token;
		gapi.client.setToken({access_token: token});
		//API key is stored in the manifest on chrome
		let tasks_api_key = chrome.runtime.getManifest().tasks_api_key;
		return gapi.client.init({
			apiKey: tasks_api_key,
			discoveryDocs: DISCOVERY_DOCS,
		}); //but no scope or clientId
	});
}
BackendGTasks.prototype.chromeSignIn = function() {
	//Nothing.
	this.notifySignInStatus(true);
}
BackendGTasks.prototype.chromeIsSignedIn = function() {
	//There's no simple way with Chrome to know when the ID expires so just chill
	return !!this.chromeAuthToken;
}
BackendGTasks.prototype.chromeSignOut = function() {
	delete this.chromeAuthToken;
	this.notifySignInStatus(false);
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
//Runs the same query again and again, substituting `nextPageToken` from results as a `pageToken` for the next query.
//Concatenates the `results.items` and returns that. Compatible with `tasklists.list` and `tasks.list`.
BackendGTasks.prototype._listPaged = function(query, params) {
	var items = [];
	var nextPage = function(response) {
		//log("got"+JSON.stringify(response));
		if (!response.result.items) //GTasks may omit items on no results
			return items;
		items = items.concat(response.result.items);
		if ((response.result.items.length < params.maxResults) || !(response.result.nextPageToken))
			return items;
		//Query next page
		params.pageToken = response.result.nextPageToken;
		//log ("running query with "+JSON.stringify(params));
		return query(params).then(response => nextPage(response));
	};
	//Query first page
	//log ("running query with "+JSON.stringify(params));
	return query(params).then(response => nextPage(response));
}


/*
Task lists
*/
//Returns an array of TaskList objects (promise)
BackendGTasks.prototype.tasklistList = function() {
	return this._listPaged(gapi.client.tasks.tasklists.list, {
		'maxResults': 100
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
	return this._listPaged(gapi.client.tasks.tasks.list, {
		'tasklist': tasklistId,
		'maxResults': 100,
		'showCompleted': true,
		'showHidden': false,
		'fields': 'items(id,title,parent,position,notes,status,due,completed),nextPageToken',
	});
}

//Returns a promise for the given task content
BackendGTasks.prototype.get = function (taskId, tasklistId) {
	if (!tasklistId) tasklistId = this.selectedTaskList;
	return gapi.client.tasks.tasks.get({
		'tasklist': tasklistId,
		'task': taskId,
	}).then(response => response.result);
}

//Retrieves multiple tasks in a single request.
//Returns a promise for a taskId -> task map.
BackendGTasks.prototype.getAll = function(taskIds, tasklistId) {
	if (!tasklistId) tasklistId = this.selectedTaskList;
	var batch = gapi.client.newBatch();
	taskIds.forEach(taskId => batch.add(gapi.client.tasks.tasks.get({
		'tasklist': tasklistId,
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
//https://developers.google.com/tasks/v1/reference/tasks/update
BackendGTasks.prototype.update = function (task) {
	return gapi.client.tasks.tasks.update({
		'tasklist': this.selectedTaskList,
		'task': task.id,
		'resource': task
	}).then(response => {
		taskCache.update(task); //update cached version
		return response.result;
	});
}

//Inserts a new task and returns its new Task object
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
//Inserts multiple tasks at once
Backend.prototype.insertMultiple = function (tasks, tasklistId) {
	if (tasks.length <= 0) return Promise.resolve({});
	if (tasks.length == 1) return this.insert(tasks[0], tasks[0].previousId, tasklistId);
	var batch = gapi.client.newBatch();
	for (let _id in tasks) {
		//TODO: Maybe we need to trim the task resource's properties before sending it?
		//  At least .previousId. Maybe others if the task is from elsewhere.
		batch.add(
			gapi.client.tasks.tasks.insert({
				'tasklist': tasklistId,
				'parent': tasks[i].parent,
				'previous': tasks[i].previousId,
				'resource': tasks[i],
			}),
			{ 'id': _id, }
		);
	}
	return batch.then(response => {
		results = {};
		for(let _id in response.result) {
			this.responseCheck(response.result[_id]);
			results[_id] = response.result[_id].result;
		}
		return results;
	});
}


//Deletes multiple tasks at once, without traversing their children.
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


// Moves all given tasks under a new parent in the same task list,
// inserting them in the given order after a given task (null = at the top).
BackendGTasks.prototype._move = function (taskIds, newParentId, newPrevId) {
	//log("backend.moveAll: "+taskIds.length+" items to="+newParentId+" after="+newPrevId);
	if (taskIds.length <= 0)
		return Promise.resolve();

	//Iterate in reverse so that we can insert each child after the same known one
	var jobs = [];
	taskIds.reverse().forEach(id => {
		let req = {
			'tasklist': this.selectedTaskList,
			'task': id,
		};
		if (newParentId) req.parent = newParentId;
		if (newPrevId) req.previous = newPrevId;
		jobs.push(gapi.client.tasks.tasks.move(req));
	})

	//If only one job is requested, avoid batching
	var batch = null;
	if (taskIds.length <= 1)
		batch = jobs[0].then(response => {
			let results = {};
			results[taskIds[0]] = response.result;
			return { result: results };
		});
	else {
		batch = gapi.client.newBatch();
		for (let i=0; i<jobs.length; i++)
			batch.add(jobs[i]);
	}
	
	batch = batch.then(response => {
		//log("backend.move: results here, patching cache");
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
