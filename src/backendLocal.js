/*
Tasks backend based on local storage / browser storage.
Do not use local storage for anything important! It's highly unpermanent (glorified cookies).
*/

function BackendLocal() {
	Backend.call(this);
	this.STORAGE_PREFIX = 'tasksIg_backend_';
}
BackendLocal.prototype = Object.create(Backend.prototype);
BackendLocal.prototype.constructor = BackendLocal;

function BackendLocalStorage() {
	BackendLocal.call(this);
	window.addEventListener('storage', (event) => this.localStorageChanged(event));
}
BackendLocalStorage.prototype = Object.create(BackendLocal.prototype);
BackendLocalStorage.prototype.constructor = BackendLocalStorage;


//Pass browser.storage.sync or browser.storage.local
function BackendBrowserStorage(areaName) {
	BackendLocal.call(this);
	this.areaName = areaName;
	if (areaName == "sync")
		this.storage = getBrowserStorageSync();
	else if (areaName == "local")
		this.storage = getBrowserStorageLocal();
	getBrowserStorage().onChanged.addListener((changes, areaName_) => this.backendStorageChanged(changes, areaName_));
}
BackendBrowserStorage.prototype = Object.create(BackendLocal.prototype);
BackendBrowserStorage.prototype.constructor = BackendBrowserStorage;

function getBrowserStorage() {
	//Prefer "browser" as it's more standardized and less available (FF provides "chrome" too)
	return (typeof browser != 'undefined') ? browser.storage : (typeof chrome != 'undefined') ? chrome.storage : null;
}
function getBrowserStorageSync() {
	let storage = getBrowserStorage();
	if (!storage) return null;
	return (typeof browser != 'undefined') ? storage.sync : (typeof chrome != 'undefined') ? new ChromeStorageWrapper(storage.sync) : null;
}
function getBrowserStorageLocal() {
	let storage = getBrowserStorage();
	if (!storage) return null;
	return (typeof browser != 'undefined') ? storage.local : (typeof chrome != 'undefined') ? new ChromeStorageWrapper(storage.local) : null;
}

//Chrome storage.* APIs do not return promises but instead use callbacks
function ChromeStorageWrapper(storage) {
	this.storage = storage;
}
ChromeStorageWrapper.prototype.get = function(keys) {
	return new Promise((resolve, reject) => this.storage.get(keys, (items) => {
		if (chrome.runtime.lastError)
			reject(chrome.runtime.lastError);
		resolve(items);
	}));
}
ChromeStorageWrapper.prototype.set = function(keys) {
	return new Promise((resolve, reject) => this.storage.set(keys, () => {
		if (chrome.runtime.lastError)
			reject(chrome.runtime.lastError);
		resolve();
	}));
}
ChromeStorageWrapper.prototype.remove = function(keys) {
	return new Promise((resolve, reject) => this.storage.remove(keys, () => {
		if (chrome.runtime.lastError)
			reject(chrome.runtime.lastError);
		resolve();
	}));
}
ChromeStorageWrapper.prototype.clear = function(keys) {
	return new Promise((resolve, reject) => this.storage.clear(() => {
		if (chrome.runtime.lastError)
			reject(chrome.runtime.lastError);
		resolve();
	}));
}

function BackendBrowserStorageSync() { BackendBrowserStorage.call(this, "sync"); }
function BackendBrowserStorageLocal() { BackendBrowserStorage.call(this, "local"); }
BackendBrowserStorageSync.prototype = Object.create(BackendBrowserStorage.prototype);
BackendBrowserStorageLocal.prototype = Object.create(BackendBrowserStorage.prototype);
BackendBrowserStorageSync.prototype.constructor = BackendBrowserStorageSync;
BackendBrowserStorageLocal.prototype.constructor = BackendBrowserStorageLocal;

//Self-register
if (getBrowserStorageSync())
	registerBackend(BackendBrowserStorageSync, "Browser storage (synced)");
if (getBrowserStorageLocal())
	registerBackend(BackendBrowserStorageLocal, "Browser storage (local)");
else
	registerBackend(BackendLocalStorage, "Local storage");


/*
Local backend can use several actual backends:
- Local storage
- Extension storage (local)
- Extension storage (synced)
All must implement _get, _set, _remove and optionally "reset()".
*/
BackendLocalStorage.prototype._get = function(key) {
	var data = window.localStorage.getItem(this.STORAGE_PREFIX+key);
	//console.log("_get: ", key, " -> ", data);
	return Promise.resolve((data) ? JSON.parse(data) : null);
}
BackendLocalStorage.prototype._set = function(key, value) {
	//console.log("_set: ", key, " := ", value);
	window.localStorage.setItem(this.STORAGE_PREFIX+key, JSON.stringify(value));
	return Promise.resolve();
}
BackendLocalStorage.prototype._remove = function(key) {
	window.localStorage.removeItem(this.STORAGE_PREFIX+key);
	return Promise.resolve();
}
BackendLocalStorage.prototype.reset = function() {
	for (let i=window.localStorage.length-1; i>=0; i--) {
		let key = window.localStorage.key(i);
		if (key.startsWith(this.STORAGE_PREFIX))
			window.localStorage.removeItem(key);
	}
	return Promise.resolve();
}
//Fired when the localStorage contents changes
//https://developer.mozilla.org/en-US/docs/Web/API/StorageEvent
BackendLocalStorage.prototype.localStorageChanged = function(event) {
	if (event.storageArea != window.localStorage)
		return;
	//console.log(event);
	var key = event.key;
	if (!key.startsWith(this.STORAGE_PREFIX))
		return;
	key = key.slice(this.STORAGE_PREFIX.length);
	this.storageChanged(key, event.oldValue, event.newValue);
}

BackendBrowserStorage.prototype._get = function(key) {
	//console.log("get("+JSON.stringify(key)+")");
	return this.storage.get(key)
	.then(results => {
		//console.log("get -> "+JSON.stringify(results));
		let value = results[key];
		return value ? JSON.parse(value) : null;
	});
}
BackendBrowserStorage.prototype._set = function(key, value) {
	var data = {};
	data[key] = JSON.stringify(value); //complex objects need to be stringified
	//console.log("set("+JSON.stringify(key)+","+data[key]+")");
	return this.storage.set(data)
	.then(results => {
		//console.log("set -> "+JSON.stringify(results));
		return results;
	});
}
BackendBrowserStorage.prototype._remove = function(key) {
	//console.log("remove("+JSON.stringify(key)+")");
	return this.storage.remove(key)
	.then(results => {
		//console.log("remove -> "+JSON.stringify(results));
		return results;
	});
}
BackendBrowserStorage.prototype.reset = function() {
	//console.log("remove()");
	return this.storage.clear()
	.then(results => {
		//console.log("reset -> "+JSON.stringify(results));
		return results;
	});
}
BackendBrowserStorage.prototype.backendStorageChanged = function(changes, areaName) {
	if (areaName != this.areaName)
		return;
	//console.log(changes);
	Object.keys(changes).forEach(key => {
		let change = changes[key];
		this.storageChanged(key, change.oldValue, change.newValue);
	});
}



/*
Storage access functions (generic)
Items are stored as:
  PREFIX_tasklists = array of lists (id, title)
  PREFIX_list_[id] = ordered list of (id, parentId) of all tasks from list #id
  PREFIX_item_[id] = item data for item #id
*/
BackendLocal.prototype._newId = function() {
	return new Date().toISOString();
}
BackendLocal.prototype._getTasklists = function() {
	return this._get("tasklists").then(result => result || {});
}
BackendLocal.prototype._setTasklists = function(lists) {
	if (!lists) throw "_setTasklists: lists==undefined";
	return this._set("tasklists", lists);
}
function TasklistEntry(id, parentId) {
	this.id = id;
	this.parentId = parentId;
}
BackendLocal.prototype._getList = function(id) {
	return this._get("list_"+id).then(result => result || []);
}
BackendLocal.prototype._getListIds = function(id) {
	return this._getList(id).then(items => {
		console.log(items);
		let results = [];
		items.forEach(item => results.push(item.id));
		console.log(results);
		return results;
	});
}
BackendLocal.prototype._setList = function(id, list) {
	//console.log("_setList: id="+id+", list="+JSON.stringify(list));
	if (!id || !list) throw "_setList: id="+id+", list="+list;
	return this._set("list_"+id, list);
}
BackendLocal.prototype._removeList = function(id) {
	return this._remove("list_"+id);
}
BackendLocal.prototype._getItem = function(id) {
	return this._get("item_"+id); //null is okay
}
BackendLocal.prototype._setItem = function(id, item) {
	//console.log("_setItem: id="+id+", item="+JSON.stringify(item));
	if (!id || !item) throw "_setItem: id="+id+", item="+item;
	return this._set("item_"+id, item);
}
BackendLocal.prototype._removeItem = function(id) {
	return this._remove("item_"+id);
}

//Converts tasklist contents into "id -> parentId, prevId" dict (calculates prevIds)
function _tasklistToParentPrev(list) {
	var lastChild = {};
	var results = {};
	if (!list)
		return results;
	list.forEach(item => {
		let prevId = lastChild[item.parentId]; //null is okay
		lastChild[item.parentId] = item.id;
		results[item.id] = {
			parentId: item.parentId,
			prevId: prevId
		};
	});
	//console.log(results);
	return results;
}


/*
Task lists
*/
//Returns an array of TaskList objects (promise)
BackendLocal.prototype.tasklistList = function() {
	return this._getTasklists().then(results => Object.values(results));
}
BackendLocal.prototype.tasklistAdd = function(title) {
	var item = null;
	return this._getTasklists()
	.then(lists => {
		item = { 'id': this._newId(), 'title': title, };
		lists[item.id] = item;
		return this._setTasklists(lists);
	})
	.then(results => item);
}
BackendLocal.prototype.tasklistGet = function(tasklistId) {
	return this._getTasklists()
	.then(lists => {
		if (!(tasklistId in lists))
			return Promise.reject("No such task list");
		return lists[tasklistId];
	});
}
BackendLocal.prototype.tasklistUpdate = function(tasklist) {
	return this._getTasklists()
	.then(lists => {
		if (!(tasklist.id in lists))
			return Promise.reject("No such task list");
		lists[tasklist.id] = tasklist;
		return this._setTasklists(lists);
	})
	.then(results => tasklist);
}
//Warning! Deletes the task list with the given id
BackendLocal.prototype.tasklistDelete = function(tasklistId) {
	return this._getTasklists()
	.then(lists => {
		if (!(tasklistId in lists))
			return Promise.reject("No such task list");
		delete lists[tasklistId];
		return Promise.all([
			this._setTasklists(lists),
			this._removeList(tasklistId)
		]);
	});
}

/*
Tasks
*/
BackendLocal.prototype.list = function(tasklistId) {
	return this._getListIds(tasklistId)
	.then(ids => this.get(ids))
	.then(items => {
		items = Object.values(items);
		for (let i=0; i<items.length; i++)
			items[i].position = i;
		//console.log("list(): returning "+JSON.stringify(items));
		return items;
	});
}
//Returns a promise for the given task content
BackendLocal.prototype.getOne = function (taskId, tasklistId) {
	return this._getItem(taskId);
}
BackendLocal.prototype.update = function (task) {
	var prom = this._getListIds(this.selectedTaskList)
	.then(list => {
		if (!list.includes(task.id)) {
			//console.log("update(): list="+JSON.stringify(list)+", task="+task.id+", not found.");
			return Promise.reject("update(): No such task in the current list");
		}
		taskResNormalize(task);
		this.cache.update(task);
		return this._setItem(task.id, task);
	});
	
	return prom.then(results => task);
}
BackendLocal.prototype.insert = function (task, previousId, tasklistId) {
	var prom = this._getList(tasklistId)
	.then(list => {
		let index = 0;
		if (previousId) {
			index = list.findIndex(item => item.id == previousId);
			if (index < 0)
				return Promise.reject("insert(): No previous task in the current list");
			index += 1;
		}
		task.id = this._newId();
		taskResNormalize(task);
		list.splice(index, 0, new TasklistEntry(task.id, task.parent));
		//console.log("insert(): "+JSON.stringify(task));
		if (tasklistId == this.selectedTaskList) {
			//console.log("insert(): adding to cache");
			this.cache.add(task);
		}
		return Promise.all([
			this._setList(tasklistId, list),
			this._setItem(task.id, task),
		]);
	});
	
	return prom.then(result => task);
}

BackendLocal.prototype.delete = function (taskIds, tasklistId) {
	if (!tasklistId) tasklistId = this.selectedTaskList;
	
	//Delete all
	return this._getList(tasklistId)
	.then(list => {
		taskIds.forEach(id => {
			let index = list.findIndex(item => item.id == id);
			if (index < 0)
				return Promise.reject("delete(): No such task in the given list");
			list.splice(index, 1);
			this._removeItem(id);
		});
		return this._setList(tasklistId, list);
	});
}

BackendLocal.prototype._moveOne = function (taskId, parentId, previousId) {
	if (taskId && taskId.id) taskId = taskId.id;
	if (parentId && parentId.id) parentId = parentId.id;
	if (previousId && previousId.id) previousId = previousId.id;

	var task = null;
	var prom = Promise.all([
		this._getList(this.selectedTaskList),
		this._getItem(taskId)
	])
	.then(results => {
		let list = results[0];
		task = results[1];
		
		//Update list
		let thisIndex = list.findIndex(item => item.id == taskId);
		if (thisIndex < 0)
			return Promise.reject("move(): No such task in the given list");
		let newIndex = 0;
		if (previousId) {
			newIndex = list.findIndex(item => item.id == previousId);
			if (newIndex < 0)
				return Promise.reject("move(): No given previous task in the given list");
			newIndex += 1;
		}
		list.splice(thisIndex, 1);
		if (thisIndex <= newIndex)
			newIndex--;
		list.splice(newIndex, 0, new TasklistEntry(taskId, parentId));
		
		//Update task
		task.parent = parentId;
		this.cache.patch({ //update this tasks's cached data
			'id': taskId,
			'parent': parentId,
		});
		
		return Promise.all([
			this._setList(this.selectedTaskList, list),
			this._setItem(taskId, task)
		]);
	});
	
	return prom.then(results => task);
}

//Moves a task with children to a new position in a different task list.
//May change task id.
BackendLocal.prototype.moveToList = function (taskId, newTasklistId, newBackend) {
	if (!newBackend) newBackend = this;
	if (!newTasklistId || (newTasklistId == this.selectedTaskList))
		return Promise.resolve();

	if (taskId && taskId.id) taskId = taskId.id;
	var oldTasklistId = this.selectedTaskList;

	//console.log("backend.moveToList: taskId	="+taskId+", newTasklist="+newTasklistId);

	//Collect all children
	var ids = [taskId];
	var task = null;
	
	var prom = this.getAllChildren(taskId, oldTasklistId)
	.then(children => {
		if (children)
			children.forEach(child => ids.push(child.id));
		return Promise.all([
			this._getList(oldTasklistId),
			this._getList(newTasklistId),
			this._getItem(taskId)
		])
	})
	.then(results => {
		let oldList = results[0];
		let newList = results[1];
		task = results[2];

		let newIndex = 0; //insert at the top
		
		//Edit lists
		ids.forEach(taskId => {
			let oldIndex = oldList.findIndex(item => item.id == taskId);
			if (oldIndex < 0)
				return Promise.reject("moveToList(): Task not found in a source list");

			//Remove from old list and add to new
			tasklistEntry = oldList.splice(oldIndex, 1).shift();
			if (tasklistEntry.id == taskId)
				tasklistEntry.parentId = null; //topmost task is reparented to null
			newList.splice(newIndex, 0, tasklistEntry);
			//Increase insert index
			newIndex += 1;
			//console.log("moveToList(): inserted "+taskId+" at position "+(newIndex-1));
			
			//Remove from the cache
			this.cache.delete({'id': taskId});
		});
		
		//Update the root task itself
		task.parent = null;
		
		//Push everything
		return Promise.all([
			this._setList(newTasklistId, newList),
			this._setList(oldTasklistId, oldList),
			this._setItem(taskId, task),
		]);
	});
	
	return prom.then(results => task);
}


/*
Change tracking
LocalStorage and browser.storage versions both end up here.
  !oldValue => created
  !newValue => deleted
*/
BackendLocal.prototype.storageChanged = function(key, oldValue, newValue) {
	//console.log("storageChanged: "+key);
	//console.log(oldValue);
	//console.log(newValue);
	
	//To avoid duplicates, make sure each notification is only tracked in one way

	//1. Changes to "tasklists" => List added/removed/edited.
	if (key == "tasklists") {
		let changes = diffDict(JSON.parse(oldValue), JSON.parse(newValue), (a, b) => (a.id==b.id)&&(a.title==b.title));
		Object.keys(changes).forEach(tasklistId => {
			let change = changes[tasklistId];
			if (!change.oldValue)
				this.onTasklistAdded.notify(change.newValue);
			else
			if (!change.newValue)
				this.onTasklistDeleted.notify(tasklistId);
			else
				this.onTasklistEdited.notify(change.newValue);
		});
	} else
	
	//2. Add/remove "list_*" => Ignore (better tracked by #1)
	//3. Changes to "list_*" => item moved
	if (key.startsWith("list_")) {
		key = key.slice("list_".length);
		let oldList = _tasklistToParentPrev(JSON.parse(oldValue)); //id->parentId,prevId
		let newList = _tasklistToParentPrev(JSON.parse(newValue));
		let changes = diffDict(oldList, newList, (a,b) => (a.parentId == b.parentId) && (a.prevId == b.prevId));
		Object.keys(changes).forEach(taskId => {
			//The only change we track here is same-list move
			let change = changes[taskId];
			if ((change.oldValue) && (change.newValue))
				this.onTaskMoved.notify(taskId, {tasklistId: key, parentId: change.newValue.parentId, prevId: change.newValue.prevId });
		});
	} else
	
	//4. Add/remove "item_*" => item added/removed
	//5. Changes to "item_*" => item edited
	if (key.startsWith("item_")) {
		key = key.slice("item_".length);
		if (!newValue)
			this.onTaskDeleted.notify(key);
		else
		if (!oldValue) {
			//We have to find the tasklist and that's a promise
			this.taskFindTasklist(key).then(tasklistId => {
				this.onTaskAdded.notify(JSON.parse(newValue), tasklistId);
			});
		} else
			//Maybe only parent has changed but we don't care to check
			this.onTaskEdited.notify(JSON.parse(newValue));
	}
}

//Locates the tasklist the task is in. Returns a promise.
BackendLocal.prototype.taskFindTasklist = function(taskId) {
	var keys = [];
	return this._getTasklists()
	.then(tasklists => {
		keys = Object.keys(tasklists);
		prom = [];
		keys.forEach(key =>
			prom.push(this._getList(key)));
		return Promise.all(prom);
	})
	.then(tasklists => {
		for (let i=0; i<keys.length; i++)
			if (tasklists[i].find(item => item.id==taskId))
				return keys[i];
		return null;
	});
}