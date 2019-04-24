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

function BackendLocalStore() {
	log("BackendLocalStore");
	BackendLocal.call(this);
}
BackendLocalStore.prototype = Object.create(BackendLocal.prototype);

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


/*
Local backend can use several actual backends:
- Local storage
- Extension storage (local)
- Extension storage (synced)
All must implement _get, _set, _remove and optionally "reset()".
*/
BackendLocalStore.prototype._get = function(key) {
	var data = window.localStorage.getItem(this.STORAGE_PREFIX+key);
	return Promise.resolve((data) ? JSON.parse(data) : null);
}
BackendLocalStore.prototype._set = function(key, value) {
	window.localStorage.setItem(this.STORAGE_PREFIX+key, JSON.stringify(value));
	return Promise.resolve();
}
BackendLocalStore.prototype._remove = function(key) {
	window.localStorage.removeItem(this.STORAGE_PREFIX+key);
	return Promise.resolve();
}
BackendLocalStore.prototype.reset = function() {
	for (let i=window.localStorage.length-1; i>=0; i--) {
		let key = window.localStorage.key(i);
		if (key.startsWith(this.STORAGE_PREFIX))
			window.localStorage.removeItem(key);
	}
	return Promise.resolve();
}

BackendBrowserStorage.prototype._get = function(key) {
	//TODO: Maybe we need to parse the results further
	return this.storage.get(key);
}
BackendBrowserStorage.prototype._set = function(key, value) {
	//TODO: Maybe we need to JSON.stringify the value after all (if it's not an array)
	return this.storage.set(key, value);
}
BackendBrowserStorage.prototype._remove = function(key) {
	return this.storage.remove(key);
}
BackendBrowserStorage.prototype.reset = function() {
	return this.storage.clear();
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
	log("_setList: id="+id+", list="+JSON.stringify(list));
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
	log("_setItem: id="+id+", item="+JSON.stringify(item));
	if (!id || !item) throw "_setItem: id="+id+", item="+item;
	return this._set("item_"+id, item);
}
BackendLocal.prototype._removeItem = function(id) {
	return this.remove("item_"+id);
}


/*
Task lists
*/
//Returns an array of TaskList objects (promise)
BackendLocal.prototype.tasklistList = function() {
	return Promise.resolve(Object.values(this._getTasklists()));
}
BackendLocal.prototype.tasklistAdd = function(title) {
	var lists = this._getTasklists();
	var item = {
		'id': this._newId(),
		'title': title,
	};
	lists[item.id] = item;
	this._setTasklists(lists);
	return Promise.resolve(item);
}
BackendLocal.prototype.tasklistGet = function(tasklistId) {
	var lists = this._getTasklists();
	if (!(tasklistId in lists))
		return Promise.reject("No such task list");
	return Promise.resolve(lists[tasklistId]);
}
BackendLocal.prototype.tasklistUpdate = function(tasklist) {
	var lists = this._getTasklists();
	if (!(tasklist.id in lists))
		return Promise.reject("No such task list");
	lists[tasklist.id] = tasklist;
	this._setTasklists(lists);
	return Promise.resolve(tasklist);
}
//Warning! Deletes the task list with the given id
BackendLocal.prototype.tasklistDelete = function(tasklistId) {
	var lists = this._getTasklists();
	if (!(tasklistId in lists))
		return Promise.reject("No such task list");
	delete lists[tasklistId];
	this._setTasklists(lists);
	this._removeList(tasklistId);
	return Promise.resolve();
}

/*
Tasks
*/
BackendLocal.prototype.list = function(tasklistId) {
	var list = this._getList(tasklistId);
	var items = [];
	for (let i=0; i<list.length; i++) {
		let item = this._getItem(list[i]);
		item.position = i;
		items.push(item);
	}
	log("list(): returning "+JSON.stringify(items));
	return Promise.resolve({
	  'items': items,
	});
}
//Returns a promise for the given task content
BackendLocal.prototype.get = function (taskId) {
	return Promise.resolve(this._getItem(taskId));
}
BackendLocal.prototype.update = function (task) {
	var list = this._getList(this.selectedTaskList);
	if (!list.includes(task.id)) {
		log("update(): list="+JSON.stringify(list)+", task="+task.id+", not found.");
		return Promise.reject("update(): No such task in the current list");
	}
	taskResNormalize(task);
	this._setItem(task.id, task);
	taskCache.update(task);
	return Promise.resolve(task);
}
BackendLocal.prototype.insert = function (task, previousId, tasklistId) {
	var list = this._getList(tasklistId);
	var index = 0;
	if (previousId) {
		index = list.indexOf(previousId);
		if (index < 0)
			return Promise.reject("insert(): No previous task in the current list");
		index += 1;
	}
	task.id = this._newId();
	taskResNormalize(task);
	list.splice(index, 0, task.id);
	this._setList(tasklistId, list);
	this._setItem(task.id, task);
	log("insert(): "+JSON.stringify(task));
	if (tasklistId == this.selectedTaskList) {
		log("insert(): adding to cache");
		taskCache.add(task);
	}
	return Promise.resolve(task);
}
//Deletes the task with the children
BackendLocal.prototype.deleteAll = function (taskIds, tasklistId) {
	if (!tasklistId) tasklistId = this.selectedTaskList;
	
	//Delete all
	var list = this._getList(tasklistId);
	ids.forEach(id => {
		let index = list.indexOf(id);
		if (index < 0)
			return Promise.reject("delete(): No such task in the given list");
		list.splice(index, 1);
		this._removeItem(id);
	});
	this._setList(tasklistId, list);
	
	return Promise.resolve();
}

BackendLocal.prototype.move = function (taskId, parentId, previousId) {
	if (taskId && taskId.id) taskId = taskId.id;
	if (parentId && parentId.id) parentId = parentId.id;
	if (previousId && previousId.id) previousId = previousId.id;

	var list = this._getList(this.selectedTaskList);
	var thisIndex = list.indexOf(taskId);
	if (thisIndex < 0)
		return Promise.reject("move(): No such task in the given list");
	var prevIndex = 0;
	if (previousId) {
		prevIndex = list.indexOf(previousId);
		if (prevIndex < 0)
			return Promise.reject("move(): No given previous task in the given list");
	}
	list.splice(thisIndex, 1);
	list.splice(prevIndex, 0, taskId);
	this._setList(this.selectedTaskList, list);
	
	var task = this._getItem(taskId);
	task.parent = parentId;
	this._setItem(taskId, task);
	
	taskCache.patch({ //update this tasks's cached data
		'id': taskId,
		'parent': parentId,
	});
	
	return Promise.resolve(task);
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
	log("moveToList(): ids="+JSON.stringify(ids));

	var oldList = this._getList(oldTasklistId);

	var newList = this._getList(newTasklistId);
	var newIndex = 0;
	if (newPrevId) {
		newIndex = newList.indexOf(newPrevId);
		if (newIndex < 0)
			return Promise.reject("moveToList(): No such target task in a given list");
	}

	ids.forEach(taskId => {
		let oldIndex = oldList.indexOf(taskId);
		if (oldIndex < 0)
			return Promise.reject("moveToList(): Task not found in a source list");

		//Remove from old list and add to new
		oldList.splice(oldIndex, 1);
		newList.splice(newIndex, 0, taskId);
		//Increase insert index
		newIndex += 1;
		log("moveToList(): inserted "+taskId+" at position "+(newIndex-1));
		
		//Remove from the cache
		taskCache.delete({ 'id': taskId });
	});

	this._setList(newTasklistId, newList);
	this._setList(oldTasklistId, oldList);
	
	//Update the task itself
	var task = this._getItem(taskId);
	task.parent = newParentId;
	this._setItem(taskId, task);
	
	return Promise.resolve(task);
}
