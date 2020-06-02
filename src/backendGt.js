/*
Task backend based on Google Tasks.
Supported globals: GTASKS_CLIENT_ID, GTASKS_API_KEY, otherwise will ask via UI.
*/
if (typeof exports == 'undefined')
	exports = {};
if (typeof require != 'undefined') {
	let utils = require('./utils.js');
	utils.importAll(utils);
	utils.importAll('./backend.js')
}

function BackendGTasks() {
	Backend.call(this);
}
inherit(Backend, BackendGTasks);
exports.BackendGTasks = BackendGTasks;

// Array of API discovery doc URLs for APIs used by the quickstart
var DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/tasks/v1/rest"];

// Authorization scopes required by the API; multiple scopes can be included, separated by spaces.
var SCOPES = "https://www.googleapis.com/auth/tasks.readonly https://www.googleapis.com/auth/tasks";

function isChromeExtension() {
	//Note that FF has chrome and chrome.runtime too, and even chrome.runtime.id
	return ((typeof chrome != 'undefined') && chrome.runtime && chrome.runtime.id && (typeof browser == 'undefined'));
}

//Self-register
registerBackend(BackendGTasks, "Google Tasks");


/*
Google API initialization
*/
function insertGoogleAPIs() {
	return loadScript('googleAPIscripts', "https://apis.google.com/js/api.js");
}
function gapiLoad() {
	console.log('loading gapi');
	return new Promise((resolve, reject) => {
		gapi.load('client:auth2', {
			'callback': () => resolve(gapi),
			'onerror': () => { console.log("gapi load fail"); reject("GAPI client failed to load"); },
		});
	});
}
//GAPI returns errors as Object{ error: string }, we want direct strings
function gapiUnwrapError(error) {
	return (!!error && !!error.error) ? error.error : error;
}
BackendGTasks.prototype.init = function() {
	//Please use this.gapi everywhere instead of global gapi. This helps with mock testing.
	return insertGoogleAPIs()
		//Load the auth2 library and API client library.
		.then(result => {
			this.gapi = gapi; //available now
			return gapiLoad();
		})
		.catch(error => { throw gapiUnwrapError(error); });
}


/*
Connection
*/
BackendGTasks.prototype.getHardcodedParams = function() {
	if ((typeof GTASKS_CLIENT_ID != 'undefined') && (GTASKS_CLIENT_ID != '')
		&& (typeof GTASKS_API_KEY != 'undefined') && (GTASKS_API_KEY != ''))
	{
		return {
			clientId: GTASKS_CLIENT_ID,
			apiKey: GTASKS_API_KEY,
		}
	}
	return null;
}
BackendGTasks.prototype.settingsPage = function() {
	//Chrome extensions does not need ClientID/API Key
	if (isChromeExtension()) return null;
	
	//If hardcoded via JS, use the values
	if (this.getHardcodedParams())
	{
		console.log('BackendGt: Using hardcoded ClientID/API Key');
		return null;
	}
	
	//Otherwise provide the UI
	return {
		intro: {
			title: '',
			hint: 'Google requires a Client ID and API Key for your Tasks-IG instance to access Tasks programmatically.'
				+ 'See:<ul>'
				+ '<li><a href=https://developers.google.com/tasks/firstapp>How to register</a></li>'
				+ '<li><a href=https://console.developers.google.com/cloud-resource-manager>Developer console</a></li></ul>'
				+'Or use Tasks-IG instance from someone who already did.',
		},
		clientId: {
			title: 'Client ID',
			type: 'text',
		},
		apiKey: {
			title: 'API Key',
			type: 'text',
		},
	};
}

BackendGTasks.prototype.clientLogin = function(params) {
	if (isChromeExtension()) {
		return this.chromeClientLogin();
	} else {
		//Nb: Make sure not to return hardcoded params from signin()
		if (!params || (!params.clientId && !params.apiKey))
			params = this.getHardcodedParams();
		if (!params || !params.clientId || !params.apiKey)
			return Promise.reject("Google ClientID or API Key not set");
		
		return this.gapi.client.init({
			discoveryDocs: DISCOVERY_DOCS,
			clientId: params.clientId,
			apiKey: params.apiKey,
			scope: SCOPES
		});
	};
}
BackendGTasks.prototype.signin = function(params) {
	//Initialize the API client library
	return this.clientLogin(params)
	.then(result => {
		this._initialized = true;
		if (!isChromeExtension())
			//Listen for sign-in state changes.
			this.gapi.auth2.getAuthInstance().isSignedIn.listen(this.notifySignInStatus);
		//Handle the initial GAPI sign-in state -- GAPI remembers after we signed in once
		let isSignedIn = this.isSignedIn();
		this.notifySignInStatus(isSignedIn);
		if (!isSignedIn && !isChromeExtension()) //Chrome has no explicit sign-in
			return this.gapi.auth2.getAuthInstance().signIn();
	})
	.catch(error => { throw gapiUnwrapError(error); })
	//Return the params passed
	.then(() => params);
}
//Call to disconnect from the backend
BackendGTasks.prototype.signout = function() {
	if (isChromeExtension())
		this.chromeSignOut();
	else
		return this.gapi.auth2.getAuthInstance().signOut();
}
BackendGTasks.prototype.notifySignInStatus = function(status) {
	//Try to retrieve the chrome user info for account naming. Do it here, before people are notified of signin.
	let prom = null;
	if (!status)
		prom = Promise.resolve(null)
	else
		prom = this.getUserEmail();
	prom.then(userEmail => {
		this.userEmail = userEmail; //maybe undefined
		//inherited notification
		Backend.prototype.notifySignInStatus.call(this, status);
	});
}
BackendGTasks.prototype.isSignedIn = function() {
	if (isChromeExtension())
		return this.chromeIsSignedIn();
	return (this._initialized) ? (this.gapi.auth2.getAuthInstance().isSignedIn.get()) : false;
}
//Retrieves email/userId of the currently signed in user, to use in UI. Called after every sign in.
BackendGTasks.prototype.getUserEmail = function() {
	if (!this.isSignedIn())
		return Promise.resolve();
	if (isChromeExtension())
		return this.chromeGetUserEmail();
	//Standalone GTasks:
	//  https://developers.google.com/identity/sign-in/web/people
	let auth2 = this.gapi.auth2.getAuthInstance();
	let profile = auth2.currentUser.get().getBasicProfile();
	if (profile)
		return Promise.resolve(profile.getEmail());
	return Promise.resolve();
}
BackendGTasks.prototype.uiName = function() {
	let uiName = Backend.prototype.uiName.call(this);
	if (this.isSignedIn() && !!this.userEmail)
		uiName = uiName + ' ('+this.userEmail+')';
	return uiName;
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
		this.gapi.client.setToken({access_token: token});
		//API key is stored in the manifest on chrome
		let tasks_api_key = chrome.runtime.getManifest().tasks_api_key;
		return this.gapi.client.init({
			apiKey: tasks_api_key,
			discoveryDocs: DISCOVERY_DOCS,
		}); //but no scope or clientId
	})
}
//Retrieves the chrome user email. Delivers either the userinfo or null.
//  https://developer.chrome.com/apps/identity#method-getProfileUserInfo
//Querying chrome user info requires identity.email manifest permission, otherwise empty object will be returned
BackendGTasks.prototype.chromeGetUserEmail = function() {
	return new Promise((resolve, reject) => {
		if (!chrome.identity.getProfileUserInfo)
			resolve(); //API not supported, skip
		console.log('BackendGTasks: will try to get chrome user info');
		chrome.identity.getProfileUserInfo(null, (userinfo) => {
			console.log('BackendGTasks: got chrome user info', userinfo);
			if (!!userinfo && !!userinfo.email)
				resolve(userinfo.email);
			else
				resolve();
		});
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
	if (!response.status || (response.status < 200) || (response.status > 299))
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
	var nextPage = (response) => { //lambda, to bind "this"
		this.responseCheck(response);
		//console.log("got"+JSON.stringify(response));
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
	return this._listPaged(
		this.gapi.client.tasks.tasklists.list.bind(this.gapi.client.tasks.tasklists),
	{
		'maxResults': 100
	});
}
BackendGTasks.prototype.tasklistAdd = function(title) {
	var tasklist = {
		'title': title,
	};
	//"request body" is passed as "resource" param
	return this.gapi.client.tasks.tasklists.insert({
		'resource': tasklist,
	}).then(response => {
		this.responseCheck(response);
		return response.result;
	});
}
BackendGTasks.prototype.tasklistGet = function(tasklistId) {
	return this.gapi.client.tasks.tasklists.get({
		'tasklist': tasklistId,
	}).then(response => {
		this.responseCheck(response);
		return response.result;
	});
}
BackendGTasks.prototype.tasklistUpdate = function(tasklist) {
	//"request body" is passed as "resource" param
	return this.gapi.client.tasks.tasklists.update({
		'tasklist': tasklist.id,
		'resource': tasklist
	}).then(response => {
		this.responseCheck(response);
		return response.result;
	});
}
//Warning! Deletes the task list with the given id
BackendGTasks.prototype.tasklistDelete = function(tasklistId) {
	return this.gapi.client.tasks.tasklists.delete({
		'tasklist': tasklistId,
	}).then(response => {
		this.responseCheck(response);
		return response.result;
	});
}


/*
Tasks
*/
//Task()s are similar to GTasks Task resources, but may contain additional fields --
//this has to be cleaned up before sending
//https://developers.google.com/tasks/v1/reference/tasks#resource
BackendGTasks.prototype.TASK_FIELDS = [
	'kind', 'id', 'etag', 'selfLink', 'title', 'notes', 'status', 'parent', 'position',
	'updated', 'completed', 'due', 'deleted', 'hidden', 'links'];

//Works with patch()es and full update()s:
BackendGTasks.prototype.taskToResource = function(task) {
	let taskRes = Backend.prototype.taskToResource.call(this, task);
	//GTasks only supports "completed" and "needsAction"
	if ((typeof taskRes.status != 'undefined') && (taskRes.status != 'completed'))
		taskRes.status = 'needsAction';
	//GTasks requires time to be in a particular format:
	if (taskRes.completed instanceof Date)
		taskRes.completed = taskRes.completed.toISOString();
	if (taskRes.due instanceof Date)
		taskRes.due = taskRes.due.toISOString();
	return taskRes;
}
BackendGTasks.prototype.resourceToTask = function(res) {
	let task = Backend.prototype.resourceToTask.call(this, res);
	//Dates are in ISO so the default  parser works
	task.completed = maybeStrToDate(task.completed);
	task.due = maybeStrToDate(task.due);
	task.updated = maybeStrToDate(task.updated);
	return task;
}

BackendGTasks.prototype.list = function(tasklistId) {
	return this._listPaged(
		this.gapi.client.tasks.tasks.list.bind(this.gapi.client.tasks.tasks),
	{
		'tasklist': tasklistId,
		'maxResults': 100,
		'showCompleted': true,
		'showHidden': false,
		'fields': 'items(id,title,parent,position,notes,status,due,completed),nextPageToken',
	});
}

//Returns a promise for the given task content
BackendGTasks.prototype.getOne = function (taskId, tasklistId) {
	if (!tasklistId) tasklistId = this.selectedTaskList;
	return this.gapi.client.tasks.tasks.get({
		'tasklist': tasklistId,
		'task': taskId,
	}).then(response => {
		this.responseCheck(response);
		return this.resourceToTask(response.result);
	});
}

//Retrieves multiple tasks in a single request.
//Returns a promise for a taskId -> task map.
BackendGTasks.prototype.getMultiple = function(taskIds, tasklistId) {
	if (!tasklistId) tasklistId = this.selectedTaskList;
	var batch = this.gapi.client.newBatch();
	taskIds.forEach(taskId => batch.add(this.gapi.client.tasks.tasks.get({
		'tasklist': tasklistId,
		'task': taskId,
	})));
	return batch.then(response => {
		//Unpack the response
	    let results = {};
		Object.keys(response.result).forEach(respId => {
			let thisResponse = response.result[respId];
			this.responseCheck(thisResponse);
			results[thisResponse.result.id] = this.resourceToTask(thisResponse.result);
		});
		return results;
	});
}

//Returns a task-update request
//https://developers.google.com/tasks/v1/reference/tasks/update
BackendGTasks.prototype.update = function (task, tasklistId) {
	if (!tasklistId) tasklistId = this.selectedTaskList;
	return this.gapi.client.tasks.tasks.update({
		'tasklist': tasklistId,
		'task': task.id,
		'resource': this.taskToResource(task)
	}).then(response => {
		this.responseCheck(response);
		this.cache.update(task); //update cached version
		return this.resourceToTask(response.result);
	});
}

//Inserts a new task and returns its new Task object
BackendGTasks.prototype.insert = function (task, previousId, tasklistId) {
	//console.log("backend.insert: tasklist="+tasklistId+", parent="+task.parent+", prev="+previousId);
	//console.log(task);
	if (!tasklistId) tasklistId = this.selectedTaskList;
	return this.gapi.client.tasks.tasks.insert({
		'tasklist': tasklistId,
		'parent': task.parent,
		'previous': previousId,
		'resource': this.taskToResource(task)
	}).then(response => {
		this.responseCheck(response);
		if (tasklistId == this.selectedTaskList)
			this.cache.add(response.result); //Add task resource to cache
		return this.resourceToTask(response.result);
	});
}
//Inserts multiple tasks at once
BackendGTasks.prototype.insertMultiple = function (tasks, tasklistId) {
	if (tasks.length <= 0) return Promise.resolve({});
	if (tasks.length == 1) return this.insert(tasks[0], tasks[0].previousId, tasklistId);
	var batch = this.gapi.client.newBatch();
	for (let _id in tasks) {
		batch.add(
			this.gapi.client.tasks.tasks.insert({
				'tasklist': tasklistId,
				'parent': tasks[_id].parent,
				'previous': tasks[_id].previousId,
				'resource': this.taskToResource(tasks[_id]),
			}),
			{ 'id': _id, }
		);
	}
	return batch.then(response => {
		let results = {};
		for(let _id in response.result) {
			this.responseCheck(response.result[_id]);
			results[_id] = this.resourceToTask(response.result[_id].result);
			if (tasklistId == this.selectedTaskList)
				this.cache.add(response.result[_id].result);
		}
		return results;
	});
}


//Deletes multiple tasks at once, without traversing their children.
BackendGTasks.prototype.delete = function (taskIds, tasklistId) {
	taskIds = toTaskIds(taskIds);
	var batch = this.gapi.client.newBatch();
	taskIds.forEach(id => {
		batch.add(this.gapi.client.tasks.tasks.delete({
			'tasklist': tasklistId,
			'task': id,
		}));
	});
	return batch.then(response => {
		this.batchResponseCheck(response);
		//console.log("backend.delete() success");
		return response;
	});
}


// Moves all given tasks under a new parent in the same task list,
// inserting them in the given order after a given task (null = at the top).
BackendGTasks.prototype.move = function (taskIds, newParentId, newPrevId) {
	//console.log("backend.moveAll: "+taskIds.length+" items to="+newParentId+" after="+newPrevId);
	taskIds = toArray(taskIds);
	if (isEmpty(taskIds))
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
		jobs.push(this.gapi.client.tasks.tasks.move(req));
	})

	//If only one job is requested, avoid batching
	var batch = null;
	if (taskIds.length <= 1)
		batch = jobs[0].then(response => {
			let results = {};
			results[taskIds[0]] = response;
			return { result: results };
		});
	else {
		batch = this.gapi.client.newBatch();
		for (let i=0; i<jobs.length; i++)
			batch.add(jobs[i]);
	}
	
	batch = batch.then(response => {
		//console.debug("backend.move: results here, patching cache");
		Object.keys(response.result).forEach(oldId => {
			let thisResponse = response.result[oldId];
			this.responseCheck(thisResponse);
			this.cache.patch({ //update this tasks's cached data
				'id': thisResponse.result.id,
				'parent': newParentId,
				'position': thisResponse.result.position,
				'etag': thisResponse.result.etag,
				'updated': thisResponse.result.updated,
			});
		});
	});
	return batch;
}
