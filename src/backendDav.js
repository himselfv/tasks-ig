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
	let calendar = this.findCalendar(tasklistId);
	if (!calendar)
		return Promise.reject("Task list not found: "+tasklistId);
	let prom = dav.listCalendarObjects(calendar, { xhr: this.xhr, filters: filters })
		.then((objects) => {
			let vtodos = [];
			for (var i=0; i<objects.length; i++) {
				console.log('Object['+i+']');
				console.log(objects[i].calendarData);
				let jcal = ICAL.parse(objects[i].calendarData);
				console.log(jcal);
				let comp = new ICAL.Component(jcal);
				console.log(comp);
				vtodos = vtodos.concat(comp.getAllSubcomponents("vtodo"));
			}
			console.log(vtodos);
			let tasks = [];
			for (var i=0; i<vtodos.length; i++)
				tasks.push(this.vTodoToTask(vtodos[i]));
			console.log(tasks);
			return {'items': tasks};
		});
	return prom;
}

BackendDav.prototype.get = function (taskId) {
	return gapi.client.tasks.tasks.get({
		'tasklist': this.selectedTaskList,
		'task': taskId,
	}).then(response => response.result);
}
