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
VEVENT/VTODO is identified by its UID.

RFC4791 4.1:
A calendar(==tasklist) is a collection of "objects" (ICS files).
Each ICS file contains ONE task or event ENTIRELY, including maybe multiple entries (same UID):
* older versions of the task 	=> lower SEQUENCE#
* explicit recurrence instances => unique RECURRENCE-IDs

Recurrence rules:
1. Each entry with RRULE/RDATE defines a series of recurrences.
2. Recurrences are implicit.
3. Recurrences inherit SEQUENCE of their creator.
4. Changing RRULE/RDATE increases SEQUENCE, generating a new implicit chain of recurrences.
5. Each recurrence is identified by:
   - It's recurrence chain (base UID + revision SEQUENCE#/rules)
   - It's projected datetime in this chain (RECURRENCE-ID)

6. Recurrences can be INSTANTIATED by uniquely specifying their UID, SEQUENCE and RECURRENCE-ID.
7. Instances can be edited, including their datetime. But:
   - they remain associated with their original recurrence datetime
   - their SEQUENCE cannot be increased or they'll be moved into a new chain

After a chain of recurrences is obsoleted by producing a new base (SEQUENCE++):
8. Instantiated recurrence entries remain.
9. Historical ones remain for history purposes.
10. Future instances are ACTIVE and must produce their effects until manually deleted.

11. Generally you only need to instantiate a recurrence to edit it, or to mark completion.
12. Recurrent TODOs should be considered settled (for the time being) if the LAST recurrence is settled.
  Not all the previous recurrences. That's not an event, so it shouldn't be treated as "multuple instances".

Quirks:
1. Thunderbird increments instance SEQUENCE when editing. Thus producing things like:
     VTODO RRULE=..., SEQUENCE=2
     VTODO RECURRENCE-ID=..., SEQUENCE=4
   We must still consider the first line to be the main one, but when increasing its SEQUENCE,
   we should set it to 5 to avoid recurrence chain clashes.
2. In theory a client can produce several recurrence chains:
     VTODO RRULE=..., SEQUENCE=2                          <-- datetime is now here
     VTODO RECURRENCE-ID=..., SEQUENCE=2                  <-- this is definitely active
                                                          <-- are other implicit SEQUENCE=2 recurrences active?
     VTODO RECURRENCE-ID=... RRULE=..., SEQUENCE=3        <-- once we reach this point, a new sequence starts
   But this is more suited for full-blown calendar events, not TODOs. We don't support this.
3. Like above, the recurrence base can have RECURRENCE-ID itself, we don't care.


Our rules:
1. Only one entry is considered to be "the main one".
2. Only the main entry's recurrence rules (RRULE/RDATE) are in effect.
3. The highest-SEQUENCE entry with recurrence rules is considered "the main one".
4. The highest available SEQUENCE is considered "max-SEQUENCE".
5. All recurrences between base-SEQUENCE and max-SEQUENCE are considered to be base-SEQUENCE-related.
*/


//Parses one calendar "object" (ICS file) into one Task object
BackendDav.prototype.parseTodoObject = function(object) {
	let task = {};
	task.comp = new ICAL.Component(ICAL.parse(object.calendarData));
	task.obj = object;
	task.url = object.url; //to simplify locating it later
	
	let vtodos = task.comp.getAllSubcomponents("vtodo");
	for (var i in vtodos) {
		let vtodo = vtodos[i];
		task.id = task.id || vtodo.getFirstPropertyValue('uid');
		
		//Find max sequence# in the series
		vtodo.sequence = vtodo.getFirstPropertyValue('sequence') || 0;
		if ((task.maxsequence === undefined) || (vtodo.sequence > task.maxsequence)) {
			task.maxsequence = vtodo.sequence;
			task.maxsequenceEntry = vtodo;
		}
		
		//Find the recurrence rules with the highest sequence# (may be <max due to quirks)
		vtodo.hasRecur = vtodo.hasProperty('rrule') || vtodo.hasProperty('rdate');
		if (vtodo.hasRecur && (vtodo.sequence > (task.basesequence || 0))) {
			task.basesequence = vtodo.sequence;
			task.baseEntry = vtodo;
		}
	}
	
	//If there are no entries with recurrence rules, choose max sequence# as the base
	if (!task.baseEntry) {
		task.basesequence = task.maxsequence;
		task.baseEntry = task.maxsequenceEntry;
	}

	//If there's still no base, skip the task data -- nothing to parse
	if (task.baseEntry) {
		task.title = task.baseEntry.getFirstPropertyValue('summary');
		task.notes = task.baseEntry.getFirstPropertyValue('description');
		//Status is complicated. RFC5545, 3.8.1.11: NEEDS-ACTION, COMPLETED, IN-PROCESS, CANCELLED or property missing.
		//Task() only supports "completed" and "needsAction", but we remember "true status" for updates.
		task.statusCode = task.baseEntry.getFirstPropertyValue('status');
		if (task.statusCode=='COMPLETED')
			task.status='completed'
		else
			task.status='needsAction';
		
		//Parent is defined by RELATED-TO[;RELTYPE=PARENT]
		let relations = task.baseEntry.getAllProperties('related-to');
		for (let i=0; i<relations.length; i++) {
			let reltype = relations[i].getParameter('reltype');
			if (reltype && (reltype != 'PARENT'))
				continue; //We only support setting relations via RELTYPE=PARENT
			this.parent = relations[i].getFirstValue(); //No multi-parenting supported
			break;
		}
		
		task.position = undefined;		//TODO
		
		/*
		Datetime field and what they mean:
		  DTSTART   = Event starts
		  DURATION  = From start until end
		  DTEND     = Event ends (should be == START+DURATION), only for VEVENTs
		  DUE       = TODO due (should be == START+DURATION), only for VTODOs
		  COMPLETED = In fact completed.
		Any may be omitted.
		 => due        = 1. DUE?, 2. DTSTART + DURATION?, 3. DTSTART?, 4. not set.
		*/
		task.due = task.baseEntry.getFirstPropertyValue('due');
		if (!task.due) {
			task.due = task.baseEntry.getFirstPropertyValue('dtstart');
			if (task.due) {
				let duration = task.baseEntry.getFirstPropertyValue('duration');
				if (duration)
					task.due.addDuration(duration);
				
			}
		}
		if (task.due)
			task.due = task.due.toJSDate();

		/*
		STATUS==completed, but COMPLETED not set? The time of completion is not known. We want to preserve this in updates.
		But we need some guesswork for recurrences. We'll use DUE as COMPLETED there.
		*/
		task.completed = task.baseEntry.getFirstPropertyValue('completed');
		if (task.completed)
			task.completed = task.completed.toJSDate();
		
		/*
		We also want a special logic for recurring TODOs:
		1. Locate last completed event.
		2. If there are implicit or explicit recurrences after that, the event is DUE on "due" for the FIRST of those.
		E.g.:
		   BASE 12.01 COMPLETED, RECUR monthly.
		   INST 12.03 COMPLETED
		   Today: 14.03.  The TODO is due @ 12.04
		   Today: 15.06.  The TODO is due @ 12.04
		*/
	}
	
	console.log(task);
	if (!task.id)
		log('Warning: Task has no ID');
	return task;
}

//Parses a list of calendar objects (ICS files), each containing multiple VTODO entris
//Returns a map of taskId->Tasks
BackendDav.prototype.parseTodoObjects = function(objects) {
	let tasks = [];
	for (var i=0; i<objects.length; i++) {
		console.log('Object['+i+']');
		console.log(objects[i].calendarData);
		tasks.push(this.parseTodoObject(objects[i]));
	}
	return tasks;
}

//Makes a filtered query to a given tasklist (calendar)
//Returns a map of taskId->Tasks returned
BackendDav.prototype.queryTasklist = function(tasklistId, filters) {
	let calendar = this.findCalendar(tasklistId);
	if (!calendar)
		return Promise.reject("Task list not found: "+tasklistId);
	return dav.listCalendarObjects(calendar, { xhr: this.xhr, filters: filters })
		.then(objects => this.parseTodoObjects(objects));
}

//Returns a set of prop-filters which uniquely identify a task with a given taskId
//Returns null if taskId is invalid
BackendDav.prototype.taskIdSubfilter = function(taskId) {
	return [{
			type: 'prop-filter',
			attrs: { name: 'UID' },
			children: [{
				type: 'text-match',
				attrs: { collation: 'i;octet' },
				value: taskId,
			}],
		}];
}
//Same but for multiple task IDs and returns a complete filter
BackendDav.prototype.taskIdsFilter = function(taskIds) {
	//Compile the set of TODO filters (each is internally AND)
	let vtodos = [];
	for (let i=0; i<taskIds.length; i++) {
		let taskIdFilter = this.taskIdSubfilter(taskIds[i]);
		if (!taskIdFilter)
			return Promise.Reject('Invalid taskId: '+taskId);
		vtodos.push({
			type: 'comp-filter',
			attrs: { name: 'VTODO' },
			children: taskIdFilter,
		});
	}
	
	attrs = {name: 'VCALENDAR'};
	if (vtodos.length > 1)
		attrs.test = 'anyof'; //OR the set of filters
	return [{
		type: 'comp-filter',
		attrs: attrs,
		children: vtodos,
	}];
}

//Populates/updates VTODO object fields based on the given task contents
//If "patch" is set, only updates fields that are present (otherwise considers missing fields deleted).
BackendDav.prototype.updateTodoObject = function(entry, task, patch) {
	this.updateProperty(entry, 'summary', task.title, patch);
	this.updateProperty(entry, 'description', task.notes, patch);
	//this.updateProperty(entry, '?', task.position, patch); //TODO
	
	//Preserve all the related-tos except for the one with reltype=parent
	this.updateProperty(entry, 'related-to', task.parent, patch, (prop) = {
		//We only support setting relations via RELTYPE=PARENT
		let reltype = relations[i].getParameter('reltype');
		return (!reltype || (reltype == 'PARENT'))
	});
	
	if (!patch || (typeof task.status != "undefined")) {
		//Status is complicated -- see the loader
		if (task.status == null) //status removed
			entry.removeProperty('status');
		else
		//Completed status is the same in both systems
		if (task.status == 'completed')
			entry.updatePropertyWithValue('status', 'COMPLETED')
		else
		//IF we have a secret "true status" AND it doesn't contradict us, keep the true one
		if (task.statusCode && (task.statusCode != "COMPLETED"))
			entry.updatePropertyWithValue('status', task.statusCode);
		else
			entry.updatePropertyWithValue('status', 'NEEDS-ACTION');
	}
	
	//There can be a bunch of time properties -- see the loader
	if (!patch || (typeof task.due != "undefined")) {
		if (task.due == null) {
			//Any of these serves as due
			entry.removeProperty('due');
			entry.removeProperty('dtstart');
			//Leave DURATION because it may be useful by itself
		} else {
			//Set all ways of expressing "due" together
			let due = ICAL.Time.fromJSDate(task.due);
			entry.updatePropertyWithValue('due', due);
			let duration = entry.getFirstPropertyValue('duration');
			if (duration) {
				duration.isNegative = true;
				due.addDuration(duration);
			}
			entry.updatePropertyWithValue('dtstart', due);
		}
	}
	this.updateProperty(entry, 'completed', task.completed, patch);
	
	//Update LAST-MODIFIED
	var currentDt = ICAL.Time.now();
	entry.updatePropertyWithValue('last-modified', currentDt);
	//There's also CREATED to be set when creating a new object
	
	//There's also DTSTAMP which is equal to LAST-MODIFIED unless the server compiles data from source,
	//in which case it's the timestamp of the compilation (as opposed to timestamp of the data changes).
	//We don't care about that one. Maybe the server will set it by itself?
	
	//There's also SEQUENCE which you'll have to set by yourself (its mechanics is complicated)
}
/*
Sets or deletes a property on a given ICS entry (todo, event).
	null:		Delete the property
	value: 		Set to this value
In patch mode:
	undefined:	Skip property
Filter:
 	A function to select the target property if there are multiple with a given name.
*/
BackendDav.prototype.updateProperty = function(icsEntry, name, value, patch, filter) {
	if (patch && (typeof value == "undefined"))
		return;
	
	//Find the first matching property
	let props = icsEntry.getAllProperties(name);
	let prop = null;
	for (let i=0; i<properties.length; i++) {
		if (filter && !filter(props[i]))
			continue;
		prop = props[i];
		break;
	}

	//Adjust types
	if (value instanceof Date)
		value = ICAL.Time.fromJSDate(value);

	//Set/remove
	if (!value && prop)
		icsEntry.removeProperty(prop);
	else if (prop)
		prop.setValue(value)
	else
		icsEntry.addPropertyWithValue(name, value);
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

BackendDav.prototype.getAll = function(taskIds, tasklistId) {
	/*
	Uses OR queries:
	  https://tools.ietf.org/id/draft-daboo-caldav-extensions-01.txt
	To query multiple events at the same time.
	
	If ORs are not supported, one alternative is to just request everything
	if the # of todos needed is high enough, otherwise default to one-by-one.
	*/
	if (!tasklistId) tasklistId = this.selectedTaskList;
	let filters = this.taskIdsFilter(taskIds);
	
	return this.queryTasklist(tasklistId, filters)
	.then(tasks => {
		//Unpack the response
		let results = {};
		
		//The query may return less results than needed so check the requested set one by one
		for (let i=0; i<taskIds.length; i++) {
			let j = 0;
			for (; j<tasks.length; j++)
				if (tasks[j].id==taskIds[i]) {
					results[taskIds[i]] = tasks[j];
					break;
				}
			if (j >= tasks.length)
				throw "Task not found: "+taskIds[j];
		}
		return results;
	});
}
//Same but looks in cache first
BackendDav.prototype.getMaybeCached = function(taskIds, tasklistId) {
	let results = {};
	let queryTaskIds = [];
	
	//If this is a selected list we can optimize a bit by looking up in cache
	if (!tasklistId || (tasklistId == this.selectedTaskList)) {
		for (let i=0; i<taskIds.length; i++) {
			let task = taskCache.get(taskIds[i]);
			if (task)
				results[taskIds[i]] = task;
			else
				queryTaskIds.push(taskIds[i]);
		}
		if (queryTaskIds.length > 0)
			console.log('Not all taskIds found in cache, strange; querying');
	} else
		queryTaskIds = taskIds;
	
	if (queryTaskIds.length <= 0)
		return Promise.resolve(results);
	
	//Maybe we should just query everything at this point? It's a single request anyway.
	
	return this.getAll(queryTaskIds, tasklistId)
	.then(tasks => {
		for (let taskId in tasks)
			results[taskId] = tasks[taskId];
		return results;
	});
}


BackendDav.prototype.update = function (task) {
	return this.updateTaskObject(this.selectedTaskList, task, false);
}
//Since we're re-querying the task and patching it on update anyway, makes sense to reimplement patch() directly
BackendDav.prototype.patch = function (task) {
	return this.updateTaskObject(this.selectedTaskList, task, true);
}
/*
Handles both update() and patch()
patch==true:
  The task must only contain .id and the changed fields.
  We'll update it anyway, even if the base entry has changed on the server.
patch==false:
  The task contains the entire task, the server version must not have changed.
*/
BackendDav.prototype.updateTaskObject = function (tasklistId, task, patch) {
	/*
	1. Find the ICS object which hosts this task's "main entry"
	2. Download it entirely
	   It may host other unrelated tasks - in theory
	3. Parse it.
	4. Verify that the entry hasn't been changed.
	5. Adjust the entry
	6. Compile everything back.
	7. Update the ICS object on the server
	*/
	let calendar = this.findCalendar(tasklistId);
	if (!calendar)
		return Promise.reject("Task list not found: "+tasklistId);
	
	console.log(task);
	
	//Verify that baseEntry is defined, or we cannot check that it's still the same on the server
	if (!patch && !task.baseEntry) //Weird
		return Promise.reject("Task has no VTODO entry associated with it");
	
	let filters = this.taskIdsFilter([task.id]);
	let task2 = null;
	
	return dav.listCalendarObjects(calendar, { xhr: this.xhr, filters: filters })
	.then(objects => {
		if (objects.length <= 0)
			return Promise.reject("Task not found: "+task.id);
		if (objects.length > 1)
			return Promise.reject("Task "+task.id+" stored across multiple ICS files on server"); //Prohibited by RFC!
		
		console.log(objects);
		task2 = this.parseTodoObject(objects[0]);
		
		//We need baseEntry to edit
		if (!task2.baseEntry) //Weird
			return Promise.reject("Task is missing VTODO entries on the server");
		
		//Verify that the tasks' main entry is still the same on the server
		//  We could also check recurrence-id because who knows, this could now be a different recurrence from the same generation
		//  But in practice you cannot EDIT a different recurrence into main-ness without changing its SEQUENCE. So phew.
		if (!patch && (task2.basesequence != task.basesequence))
			//Not sure what to do, maybe we should just edit what's there?
			return Promise.reject("Task has been changed on the server, please reload and try again");
		
		//Update the tasks's main entry with task contents
		this.updateTodoObject(task2.baseEntry, task, patch);
		task2.maxsequence += 1;
		task2.maxsequenceEntry = task2.baseEntry;
		task2.basesequence = task2.maxSequence;
		task2.baseEntry.updatePropertyWithValue('sequence', task2.maxsequence);
		
		//Pack everything back
		log(task2.comp);
		task2.obj.calendarData = task2.comp.toString();
		console.log(task2.obj.calendarData);
		
		//Update on server
		dav.updateCalendarObject(task2.obj, { xhr: this.xhr, });
	})
	.then(response => {
		log('Calendar updated');
		taskCache.update(task2); //update cached version
		//TODO: What to do with the task we've been given? Should we update that to match task2
		//TODO: What should this return? Have to define this.
		return response;
	});
}


BackendDav.prototype.newUid = function() {
	//Not perfect but whatever
	//https://stackoverflow.com/a/21963136
    var u='',m='xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx',i=0,rb=Math.random()*0xffffffff|0;
    while(i++<36) {
        var c=m[i-1],r=rb&0xf,v=c=='x'?r:(r&0x3|0x8);
        u+=(c=='-'||c=='4')?c:v.toString(16);rb=i%8==0?Math.random()*0xffffffff|0:rb>>4;
    }
    return u;
}

BackendDav.prototype.insert = function (task, previousId, tasklistId) {
	let calendar = this.findCalendar(tasklistId);
	if (!calendar)
		return Promise.reject("Task list not found: "+tasklistId);
	
	//Init a new VCALENDAR
	let comp = new ICAL.Component('vcalendar');
	comp.updatePropertyWithValue('version', '2.0');
	comp.updatePropertyWithValue('prodid', 'github.com/himselfv/tasks-ig');
	let uid = this.newUid();
	let vtodo = new ICAL.Component('vtodo', comp);
	vtodo.updatePropertyWithValue('uid', uid);
	comp.addSubcomponent(vtodo);
	
	//Fill the normal properties from the task
	this.updateTodoObject(vtodo, task);
	vtodo.updatePropertyWithValue('created', vtodo.getFirstPropertyValue('last-modified'));
	vtodo.updatePropertyWithValue('sequence', 1);
	
	//Compile
	console.log(vtodo);
	let calendarData = comp.toString();
	console.log(calendarData);
	
	//Publish
	return dav.createCalendarObject(calendar, { data: calendarData, filename: uid+'.ics', xhr: this.xhr })
	.then(response => {
		//We need to return a fully functional resulting Task object (with .comp .obj etag etc)
		//We could TRY to add all fields that the standard loader does, but we have nowhere to get dav.Object() and especially its etag.
		//So just requery:
		return this.get(uid);
	});
}

//Deletes multiple tasks from a single task list, non-recursively.
BackendDav.prototype.deleteAll = function (taskIds, tasklistId) {
	let calendar = this.findCalendar(tasklistId);
	if (!calendar)
		return Promise.reject("Task list not found: "+tasklistId);
	
	return this.getMaybeCached(taskIds, tasklistId)
	.then(tasks => {
		let batch = [];
		for (let taskId in tasks) {
			console.assert(tasks[taskId].obj);
			batch.push(dav.deleteCalendarObject(tasks[taskId].obj, { xhr: this.xhr, }));
		}
		return Promise.all(batch);
	}).then(results => {
		//console.log('delete completed');
	});
}
