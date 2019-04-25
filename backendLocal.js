/*
Tasks backend based on local storage.
Do not use for anything important! Local storage is highly unpermanent (glorified cookies).

Stores items as:
  PREFIX_tasklists = array of lists
  PREFIX_list_[id] = ordered item id list for list #id
  PREFIX_item_[id] = item data for item #id
*/

function BackendLocal() {
	Backend.call(this);
	this.STORAGE_PREFIX = 'tasksIg_backend_';
}
BackendLocal.prototype = Object.create(Backend.prototype);

function BackendLocalStorage() {
	log("BackendLocalStorage");
	BackendLocal.call(this);
}
BackendLocalStorage.prototype = Object.create(BackendLocal.prototype);

//Pass browser.storage.sync or browser.storage.local
function BackendBrowserStorage(storage) {
	log("BackendBrowserStorage")
	BackendLocal.call(this);
	this.storage = storage;
}
BackendBrowserStorage.prototype = Object.create(BackendLocal.prototype);

function BackendBrowserStorageSync() { BackendBrowserStorage.call(this, (browser || chrome).storage.sync); }
function BackendBrowserStorageLocal() { BackendBrowserStorage.call(this, (browser || chrome).storage.local); }
BackendBrowserStorageSync.prototype = Object.create(BackendBrowserStorage.prototype);
BackendBrowserStorageLocal.prototype = Object.create(BackendBrowserStorage.prototype);

//Self-register
if ((typeof browser != 'undefined') && (browser.storage)) {
	if (browser.storage.sync)
		registerBackend("Browser storage (synced)", BackendBrowserStorageSync);
	if (browser.storage.local)
		registerBackend("Browser storage (local)", BackendBrowserStorageLocal);
} else
	registerBackend("Local storage", BackendLocalStorage);


/*
Local backend can use several actual backends:
- Local storage
- Extension storage (local)
- Extension storage (synced)
All must implement _get, _set, _remove and optionally "reset()".
*/
BackendLocalStorage.prototype._get = function(key) {
	var data = window.localStorage.getItem(this.STORAGE_PREFIX+key);
	//log("_get: "+key+" -> "+data);
	return Promise.resolve((data) ? JSON.parse(data) : null);
}
BackendLocalStorage.prototype._set = function(key, value) {
	//log("_set: "+key+" := "+JSON.stringify(value));
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

BackendBrowserStorage.prototype._get = function(key) {
	//log("get("+JSON.stringify(key)+")");
	return this.storage.get(key)
	.then(results => {
		//log("get -> "+JSON.stringify(results));
		let value = results[key];
		return value ? JSON.parse(value) : null;
	});
}
BackendBrowserStorage.prototype._set = function(key, value) {
	var data = {};
	data[key] = JSON.stringify(value); //complex objects need to be stringified
	//log("set("+JSON.stringify(key)+","+data[key]+")");
	return this.storage.set(data)
	.then(results => {
		//log("set -> "+JSON.stringify(results));
		return results;
	});
}
BackendBrowserStorage.prototype._remove = function(key) {
	//log("remove("+JSON.stringify(key)+")");
	return this.storage.remove(key)
	.then(results => {
		//log("remove -> "+JSON.stringify(results));
		return results;
	});
}
BackendBrowserStorage.prototype.reset = function() {
	//log("remove()");
	return this.storage.clear()
	.then(results => {
		//log("reset -> "+JSON.stringify(results));
		return results;
	});
}


/*
Technical functions
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
BackendLocal.prototype._getList = function(id) {
	return this._get("list_"+id).then(result => result || []);
}
BackendLocal.prototype._setList = function(id, list) {
	//log("_setList: id="+id+", list="+JSON.stringify(list));
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
	//log("_setItem: id="+id+", item="+JSON.stringify(item));
	if (!id || !item) throw "_setItem: id="+id+", item="+item;
	return this._set("item_"+id, item);
}
BackendLocal.prototype._removeItem = function(id) {
	return this._remove("item_"+id);
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
	return this._getList(tasklistId)
	.then(list => this.getAll(list))
	.then(items => {
		items = Object.values(items);
		for (let i=0; i<items.length; i++)
			items[i].position = i;
		//log("list(): returning "+JSON.stringify(items));
		return {'items': items};
	});
}
//Returns a promise for the given task content
BackendLocal.prototype.get = function (taskId) {
	return this._getItem(taskId);
}
BackendLocal.prototype.update = function (task) {
	var prom = this._getList(this.selectedTaskList)
	.then(list => {
		if (!list.includes(task.id)) {
			log("update(): list="+JSON.stringify(list)+", task="+task.id+", not found.");
			return Promise.reject("update(): No such task in the current list");
		}
		taskResNormalize(task);
		taskCache.update(task);
		return this._setItem(task.id, task);
	});
	
	return prom.then(results => task);
}
BackendLocal.prototype.insert = function (task, previousId, tasklistId) {
	var prom = this._getList(tasklistId)
	.then(list => {
		let index = 0;
		if (previousId) {
			index = list.indexOf(previousId);
			if (index < 0)
				return Promise.reject("insert(): No previous task in the current list");
			index += 1;
		}
		task.id = this._newId();
		taskResNormalize(task);
		list.splice(index, 0, task.id);
		//log("insert(): "+JSON.stringify(task));
		if (tasklistId == this.selectedTaskList) {
			//log("insert(): adding to cache");
			taskCache.add(task);
		}
		return Promise.all([
			this._setList(tasklistId, list),
			this._setItem(task.id, task),
		]);
	});
	
	return prom.then(result => task);
}
//Deletes the task with the children
BackendLocal.prototype.deleteAll = function (taskIds, tasklistId) {
	if (!tasklistId) tasklistId = this.selectedTaskList;
	
	//Delete all
	return this._getList(tasklistId)
	.then(list => {
		taskIds.forEach(id => {
			let index = list.indexOf(id);
			if (index < 0)
				return Promise.reject("delete(): No such task in the given list");
			list.splice(index, 1);
			this._removeItem(id);
		});
		return this._setList(tasklistId, list);
	});
}

BackendLocal.prototype.move = function (taskId, parentId, previousId) {
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
		let thisIndex = list.indexOf(taskId);
		if (thisIndex < 0)
			return Promise.reject("move(): No such task in the given list");
		let prevIndex = 0;
		if (previousId) {
			prevIndex = list.indexOf(previousId);
			if (prevIndex < 0)
				return Promise.reject("move(): No given previous task in the given list");
		}
		list.splice(thisIndex, 1);
		list.splice(prevIndex, 0, taskId);
		
		//Update task
		task.parent = parentId;
		taskCache.patch({ //update this tasks's cached data
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
BackendLocal.prototype.moveToList = function (taskId, newTasklistId, newParentId, newPrevId) {
	if (!newTasklistId || (newTasklistId == this.selectedTaskList))
		return this.move(taskId, newParentId, newPrevId);

	if (taskId && taskId.id) taskId = taskId.id;
	var oldTasklistId = this.selectedTaskList;

	log("backend.moveToList: taskId	="+taskId+", newTasklist="+newTasklistId);

	//Collect all children
	var ids = [taskId];
	var children = this.getAllChildren(taskId);
	if (children)
		children.forEach(child => ids.push(child.id));
	//log("moveToList(): ids="+JSON.stringify(ids));

	var task = null;
	var prom = Promise.all([
		this._getList(oldTasklistId),
		this._getList(newTasklistId),
		this._getItem(taskId)
	]).then(results => {
		let oldList = results[0];
		let newList = results[1];
		let task = results[2];

		let newIndex = 0;
		if (newPrevId) {
			newIndex = newList.indexOf(newPrevId);
			if (newIndex < 0)
				return Promise.reject("moveToList(): No such target task in a given list");
		}
		
		//Edit lists
		ids.forEach(taskId => {
			let oldIndex = oldList.indexOf(taskId);
			if (oldIndex < 0)
				return Promise.reject("moveToList(): Task not found in a source list");

			//Remove from old list and add to new
			oldList.splice(oldIndex, 1);
			newList.splice(newIndex, 0, taskId);
			//Increase insert index
			newIndex += 1;
			//log("moveToList(): inserted "+taskId+" at position "+(newIndex-1));
			
			//Remove from the cache
			taskCache.delete({'id': taskId});
		});
		
		//Update the task itself
		task.parent = newParentId;
		
		//Push everything
		return Promise.all([
			this._setList(newTasklistId, newList),
			this._setList(oldTasklistId, oldList),
			this._setItem(taskId, task),
		]);
	});
	
	return prom.then(results => task);
}
