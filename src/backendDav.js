/*
Tasks backend based on CalDAV VTODOs.
Requires
* davlambda\ 		 -> github.com\lambdabaa\dav
* davlambda-digest\	 -> github.com\himselfv\davlambda-digest

Requires globals:
  DAV_SERVER = url
If your server needs auth:
  DAV_USERNAME = login
  DAV_PASSWORD = password
  DAV_AUTH = basic/digest [default: basic]
*/

function BackendDav() {
	Backend.call(this);
	this.STORAGE_PREFIX = 'tasksIg_backend_';
}
BackendDav.prototype = Object.create(Backend.prototype);


//Self-register
function backendDavSupported() {
	if (typeof DAV_SERVER != 'undefined')
		return true;
	else
		log("BackendDAV: DAV_SERVER not set");
	return false;
}
if (backendDavSupported())
	registerBackend("CalDAV", BackendDav);


/*
Initialization
*/
function insertDavAPIs() {
	//We assume that this script (with its dependencies) is on the same level as index.html
	//To be more change-proof we could locate our <script> tag and extract our relative path.
	return loadScripts({
		'davlambda': 'davlambda/dav.js',
		'cryptojs': 'davlambda-digest/crypto.js',
		'dijest-ajax': 'davlambda-digest/digest-ajax.js',
	}).then(result => loadScripts({
		'dav-transport-digest': 'davlambda-digest/transport-digest.js',
		'ical.js': 'ical/ical.js',
	}));
}
BackendDav.prototype.connect = function() {
	log("BackendDav.login");
	var prom = insertDavAPIs()
	.then(result => {
		//Automatically sign in.
		this.signin();
	});
	return prom;
}

BackendDav.prototype.signin = function() {
	log("BackendDav.signin");
	
	var credentials = new dav.Credentials({
		username: DAV_USERNAME,
		password: DAV_PASSWORD
	});
	if ((typeof DAV_AUTH != 'undefined') && (DAV_AUTH === "digest"))
		this.xhr = new DavDigestTransport(credentials);
	else
		this.xhr = new DavBasicAuthTransport(credentias)
	
	return dav.createAccount({ server: DAV_SERVER, xhr: this.xhr })
		.catch(error =>
			this.signout() //delete created objects
			.then(result => {throw error;}) //rethrow
		)
		.then(account => {
			this.account = account;
			this._signedIn = true;
			this.notifySignInStatus(true);
		});
}

//Sign out from the backend
BackendDav.prototype.signout = function() {
	delete this.account;
	delete this.xhr;
	if (this._signedIn === true) {
		this._signedIn = false;
		this.notifySignInStatus(false);
	}
	return Promise.resolve();
}


/*
Tasklists.
*/
//TODO: Reload the tasklist list and the tasklist details on every query.
//      Will be even more important if we add editing.

//Returns an array of TaskList objects (promise)
BackendDav.prototype.tasklistList = function() {
	if (!this.account)
		return Promise.reject("Not logged in");
	entries = [];
	this.account.calendars.forEach(function(calendar) {
		console.log('Found calendar named ' + calendar.displayName);
		entries.push({id: calendar.url, title: calendar.displayName});
	});
	return Promise.resolve(entries);
}
BackendDav.prototype.tasklistGet = function(tasklistId) {
	if (!this.account)
		return Promise.reject("Not logged in");
	let calendar = this.findCalendar(tasklistId);
	if (calendar)
		return Promise.resolve({id: calendar.url, title: calendar.displayName});
	return Promise.reject("Task list not found");
}

BackendDav.prototype.findCalendar = function(tasklistId) {
	console.log("looking for "+tasklistId);
	for (var i=0; i< this.account.calendars.length; i++) {
		let calendar = this.account.calendars[i];
		console.log("trying "+calendar.url);
		if (calendar.url==tasklistId)
			return calendar;
	}
	console.log("nothing found");
	return null;
}


/*
Tasks service functions
*/
BackendDav.prototype.vTodoToTask = function(vtodo) {
	return {
		id: vtodo.getFirstPropertyValue('uid')+'\\'+vtodo.getFirstPropertyValue('created'),
		title: vtodo.getFirstPropertyValue('summary'),
		parent: undefined,		//TODO
		position: undefined,	//TODO
		notes: vtodo.getFirstPropertyValue('description'),
		status: vtodo.getFirstPropertyValue('status'),
		due: undefined,			//TODO
		completed: undefined,	//TODO
	};
}


//Makes a filtered query to a given tasklist (calendar)
//Returns a list of Task objects returned
BackendDav.prototype.queryTasklist = function(tasklistId, filters) {
	let calendar = this.findCalendar(tasklistId);
	if (!calendar)
		return Promise.reject("Task list not found: "+tasklistId);
	return dav.listCalendarObjects(calendar, { xhr: this.xhr, filters: filters })
		.then(objects => {
			let tasks = [];
			for (var i=0; i<objects.length; i++) {
				console.log('Object['+i+']');
				console.log(objects[i].calendarData);
				let comp = new ICAL.Component(ICAL.parse(objects[i].calendarData));
				let vtodos = comp.getAllSubcomponents("vtodo");
				for (var j=0; j<vtodos.length; j++) {
					let task = this.vTodoToTask(vtodos[j]);
					//Our task will additionally store icsId to simplify finding it later
					task.icsUrl = comp.url;
					tasks.push(task);
				}
			}
			return tasks;
		});
}

//Returns a set of prop-filters which uniquely identify a task with a given taskId
//Returns null if taskId is invalid
BackendDav.prototype.taskIdFilter = function(taskId) {
	taskIdParts = taskId.split('\\');
	console.log(taskIdParts);
	if (taskIdParts.length != 2)
		return null;
	return [/*{
			type: 'prop-filter',
			attrs: { name: 'UID' },
			children: [{
				type: 'text-match',
				attrs: { collation: 'i;octet' },
				value: taskIdParts[0],
			}],
		},*/
		{
			type: 'prop-filter',
			attrs: { name: 'created' },
			children: [{
				type: 'text-match',
				/*attrs: { collation: 'i;octet' }*/
				value: taskIdParts[1],
			}],
		}];
}


/*
Tasks
*/
BackendDav.prototype.list = function(tasklistId) {
	let filters = [{
		type: 'comp-filter',
		attrs: { name: 'VCALENDAR' },
		children: [{
			type: 'comp-filter',
			attrs: { name: 'VTODO' }
		}]
	}];
	return this.queryTasklist(tasklistId, filters)
		.then(tasks => {
			//This function's return is a bit more complicated
			return {'items': tasks};
		});
}

BackendDav.prototype.get = function (taskId) {
	//Split the id
	taskIdFilter = this.taskIdFilter(taskId);
	if (!taskIdFilter)
		return Promise.reject("Invalid taskId");
	let filters = [{
		type: 'comp-filter',
		attrs: { name: 'VCALENDAR' },
		children: [{
			type: 'comp-filter',
			attrs: { name: 'VTODO' },
			children: taskIdFilter,
		}]
	}];

	return this.queryTasklist(this.selectedTaskList, filters)
		.then(tasks => {
			if (tasks.length < 1)
				return Promise.reject("Task not found");
			if (tasks.length > 1)
				return Promise.reject("Multiple tasks match the given taskId!");
			return tasks[0];
		});
}
