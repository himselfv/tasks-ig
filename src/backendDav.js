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
		return this.signin();
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
	for (var i=0; i< this.account.calendars.length; i++) {
		let calendar = this.account.calendars[i];
		if (calendar.url==tasklistId)
			return calendar;
	}
	return null;
}


/*
Task ordering:
The only even remotely widespread approach is X-APPLE-SORT-ORDER.
  https://github.com/owncloud/tasks/issues/86

By default (if not present) it's the number of seconds between the creation of a task and 20010101T000000Z.
Moving a task assigns it a value between prevTask...nextTask. Midway is a good choice.

Reuse the default backend ordering mechanics to implement X-APPLE-SORT-ORDER
*/
//Converts a datetime to the default associated X-APPLE-SORT-ORDER
//Datetime accepted: Date(), ICAL.Time(), undefined
BackendDav.prototype.datetimeToPosition = function(dt) {
	if (!dt) return 0; //  ¯\_(ツ)_/¯
	if (dt instanceof ICAL.Time)
		dt = dt.toJSDate();
	return (dt - new Date(2001, 01, 01, 0, 0, 0)) / 1000
}
BackendDav.prototype.newTopmostPosition = function(parentId, tasklistId) {
	return -this.datetimeToPosition(new Date()); //minus current time
}
BackendDav.prototype.newDownmostPosition = function(parentId, tasklistId) {
	return this.datetimeToPosition(new Date()); //current time
}
//Otherwise the default choosePosition() is compatible with X-APPLE-SORT-ORDER


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
		//This is standard-compliant and supported by most clients who implement any parenting
		let relations = task.baseEntry.getAllProperties('related-to');
		for (let i=0; i<relations.length; i++) {
			let reltype = relations[i].getParameter('reltype');
			if (reltype && (reltype != 'PARENT'))
				continue; //We only support setting relations via RELTYPE=PARENT
			task.parent = relations[i].getFirstValue(); //No multi-parenting supported
			break;
		}
		
		//Tasks without X-APPLE-SORT-ORDER get implicit .position because the frontend requires it.
		//But store auto-position to later check if the actual position has been changed and needs saving.
		task.position = task.baseEntry.getFirstPropertyValue('x-apple-sort-order');
		if (task.position) {
			//These are ints; try to parse as int, or ordering will be wrong
			let intPosition = parseInt(task.position, 10);
			if (!Number.isNaN(intPosition))
				task.position = intPosition;
		}
		if (!task.position) {
			task.position = this.datetimeToPosition(task.baseEntry.getFirstPropertyValue('created'));
			task.positionAuto = task.position;
		}
		
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
	
	console.log('parsedTodoObject:', task);
	if (!task.id)
		log('Warning: Task has no ID');
	return task;
}

//Parses a list of calendar objects (ICS files), each containing multiple VTODO entris
//Returns a map of taskId->Tasks
BackendDav.prototype.parseTodoObjects = function(objects, tasklistId) {
	let tasks = [];
	for (var i=0; i<objects.length; i++) {
		console.log('Object['+i+']', objects[i].calendarData);
		let task = this.parseTodoObject(objects[i]);
		task.tasklist = tasklistId;
		tasks.push(task);
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
		.then(objects => this.parseTodoObjects(objects, tasklistId));
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
	this.updateProperty(entry, 'related-to', task.parent, patch, (prop) => {
		//We only support setting relations via RELTYPE=PARENT
		let reltype = prop.getParameter('reltype');
		return (!reltype || (reltype == 'PARENT'))
	});
	
	//Only store the position if it differs from auto-generated
	if ((!task.positionAuto || (task.position != task.positionAuto)))
		this.updateProperty(entry, 'x-apple-sort-order', task.position, patch);

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
	for (let i=0; i<props.length; i++) {
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
	else if (value)
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
	return this.queryTasklist(tasklistId, filters);
}

BackendDav.prototype.getMultiple = function(taskIds, tasklistId) {
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
			let task = this.cache.get(taskIds[i]);
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
	
	return this.getMultiple(queryTaskIds, tasklistId)
	.then(tasks => {
		for (let taskId in tasks)
			results[taskId] = tasks[taskId];
		return results;
	});
}


BackendDav.prototype.update = function (task, tasklistId) {
	return this.updateTaskObject(tasklistId || task.tasklist || this.selectedTaskList, task, false);
}
//Since we're re-querying the task and patching it on update anyway, makes sense to reimplement patch() directly
BackendDav.prototype.patch = function (task, tasklistId) {
	return this.updateTaskObject(tasklistId || task.tasklist || this.selectedTaskList, task, true);
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
	
	console.log('updateTaskObject:', task);
	
	//Verify that baseEntry is defined, or we cannot check that it's still the same on the server
	if (!patch && !task.baseEntry) //Weird
		return Promise.reject("Task has no VTODO entry associated with it");
	
	let filters = this.taskIdsFilter([task.id]);
	let task2 = null;
	
	return dav.listCalendarObjects(calendar, { xhr: this.xhr, filters: filters })
	.then(objects => {
		if (isEmpty(objects))
			return Promise.reject("Task not found: "+task.id);
		if (objects.length > 1)
			return Promise.reject("Task "+task.id+" stored across multiple ICS files on server"); //Prohibited by RFC!
		
		console.log('updateTaskObject: preloaded objects=', objects);
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
		console.log('update:', task2.comp);
		task2.obj.calendarData = task2.comp.toString();
		console.log('update.data:', task2.obj.calendarData);
		
		//We want the task2 object itself to reflect changes -- it'll go to cache
		//But we cannot just resourcePatch() it or it'll copy everything, including obsolete task.baseEntry.
		
		//Let's just reparse new baseEntry!
		task2 = this.parseTodoObject(task2.obj);
		task2.tasklist = tasklistId;
		console.log('Reparsed task2:', task2);
		
		//Update on server
		return dav.updateCalendarObject(task2.obj, { xhr: this.xhr, });
	})
	.then(response => {
		console.log('Calendar updated');
		this.cache.update(task2); //update cached version
		return task2;
	});
}


BackendDav.prototype.newUid = function() {
	return newGuid();
}

BackendDav.prototype.insert = function (task, previousId, tasklistId) {
	console.log('BackendDav.insert:',arguments);
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
	
	let prom = null;
	if (typeof previousId == 'undefined') //default position: just don't store it
		prom = Promise.resolve();
	else
		prom = this.choosePosition(task.parent, previousId, tasklistId)
		.then(position => {
			vtodo.updatePropertyWithValue('x-apple-sort-order', position);
		});
	
	var icsData = null;
	
	//Compile
	return prom.then(() => {
		console.log('insert:', vtodo);
		icsData = comp.toString();
		console.log('insert.data: ', icsData);
	})
	//Publish
	.then(() => this.insertTodoObject(calendar, icsData, uid+'.ics'))
	.then(response => {
		//We need to return a fully functional resulting Task object (with .comp .obj etag etc)
		//We could TRY to add all fields that the standard loader does, but we have nowhere to get dav.Object() and especially its etag.
		//So just requery:
		return this.get(uid, tasklistId);
	})
	.then(task => {
		this.cache.add(task);
		return task;
	});
	
}

//Adds an ICS file to a calendar by its content.
BackendDav.prototype.insertTodoObject = function(calendar, data, filename) {
	//a Task can be passed instead of data
	if ((typeof data != "string") && (data.obj)) {
		if (!filename) filename = data.id+'.ics';
		data = data.obj.calendarData;
	}
	return dav.createCalendarObject(calendar, { data: data, filename: filename, xhr: this.xhr })
}

//Deletes multiple tasks from a single task list, non-recursively.
BackendDav.prototype.delete = function (taskIds, tasklistId) {
	if (!Array.isArray(taskIds)) taskIds = [taskIds];
	
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


/*
Moving and copying ICS files between calendars.
1. We try to move/copy the entire file, not only the current task version.
2. When we adjust .parentId, older task revisions still refer to something else which might not
  even be present in the new calendar.
  But this is fine, because you can break older revisions in the same way by just deleting the parent anyway.
*/
BackendDav.prototype.moveToList = function (oldTask, newTasklistId, newBackend) {
	//Optimize moves between DAVs. Other moves => default treatment
	if (newBackend && !(newBackend instanceof BackendDav))
		return Backend.prototype.moveToList(oldTask, newTasklistId, newBackend);
	if (!newBackend) newBackend = this;
	
	/*
	DAV moves are ICS file moves.
	UID, positions and parents do not need to change, except for topmost items parents,
	and we'll do that with local .move() later.
	We can move all children at once.
	*/
	return this.getAllChildren(oldTask, this.selectedTaskList)
	.then(children => {
		children.unshift(oldTask); //add to the front
		return children;
	})
	.then(children => {
		//Foreign DAVs require INSERT there + DELETE here
		if (newBackend != this)
			return this.moveToList_foreignDav(children, newTasklistId, newBackend);
		//Otherwise it's a local move, perform MOVE
		return this.moveToList_localDav(children, newTasklistId);
	})
	.then(() => {
		//In any case, patch the topmost task, remove parentId and assign new position
		return newBackend.patch({ id: toTaskId(oldTask), parent: null, position: newBackend.newDownmostPosition(), }, newTasklistId);
	});
}

//Moves a number of tasks (ICS files) to another calendar on a different DAV server (INSERT + DELETE)
//Do not call directtly.
BackendDav.prototype.moveToList_foreignDav = function(taskIds, newTasklistId, newBackend) {
	console.log('moveToList_foreignDav', arguments);
	if (isArrayEmpty(taskIds)) return Promise.resolve();
	//Requery most recent versions: we're moving by contents so shouldn't rely on cache
	for (let i=0; i<taskIds.length; i++)
		if (taskIds[i].id) taskIds[i] = taskIds[i].id;
	return this.get(taskIds)
	.then(tasks => {
		let batch = [];
		for(let i=0; i<tasks.length; i++)
			batch.push(newBackend.insertTodoObject(tasks[i]));
		return Promise.all(batch);
	})
	.then(results => {
		console.log('Moved to a different DAV list, deleting here');
		//Delete from local list
		this.delete(taskIds);
	});
}

//Moves a number of tasks (ICS files) to another calendar on the same DAV server (MOVE)
//Do not call directly.
BackendDav.prototype.moveToList_localDav = function(tasks, newTasklistId) {
	console.log('moveToList_localDav', arguments);
	if (isArrayEmpty(tasks)) return Promise.resolve();
	
	let newCalendar = this.findCalendar(newTasklistId);
	if (!newCalendar)
		return Promise.reject("Task list not found: "+newTasklistId);
	
	let batch = [];
	for (let i=0; i<tasks.length; i++) {
		//We only need URLs so rely on cache, probably haven't changed and no big deal if we fail
		if (!tasks[i].id) tasks[i] = this.cache.get(tasks[i]);
		let sourceUrl = tasks[i].obj.url;
		let destinationUrl = newCalendar.url + tasks[i].id + '.ics';
		console.log(sourceUrl, ' -> ', destinationUrl);
		batch.push(
			this.davMoveRequest('MOVE', sourceUrl, destinationUrl, { xhr: this.xhr, })
			);
	}
	
	return Promise.all(batch).then(() => {
		//All these tasks are now in the different list; cached objects are invalid
		this.cache.delete(toTaskIds(tasks));
	});
}

//HTTP DAV MOVE or COPY request
BackendDav.prototype.davMoveRequest = function(method, fromUrl, toUrl, options) {
	console.log('davMoveRequest', arguments);
	function transformRequest(xhr) {
		dav.request.setRequestHeaders(xhr, options);
		xhr.setRequestHeader('Destination', toUrl);
	}

	let req = new dav.Request({
		method: method,
		requestData: null,
		transformRequest: transformRequest,
	});
	
	console.log('davMoveRequest: ', req);
	return options.xhr.send(req, fromUrl, { sandbox: options.sandbox });
}