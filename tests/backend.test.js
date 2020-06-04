import * as utils from 'utils.js';
utils.importAll(utils);
import * as backendJs from 'backend.js';
importAll(backendJs);
import * as jestUtils from 'jest-utils.js';
importAll(jestUtils);
import * as settingsTest from 'settings.test.js';

/*
See for ready-made matchers:
  https://github.com/jest-community/jest-extended#passmessage
*/

test('toArray', () => {
	expect(toArray(undefined)).toBe(undefined);
	expect(toArray(null)).toBe(null);
	expect(toArray([])).toStrictEqual([]);
	expect(toArray(10)).toStrictEqual([10]);
	expect(toArray("abcd")).toStrictEqual(["abcd"]);
	expect(toArray([10])).toStrictEqual([10]);
	expect(toArray([10,20])).toStrictEqual([10,20]);
});

test('toTaskIds', () => {
	let task1 = { id: 10, };
	let task2 = { id: "asdbsd", };
	expect(toTaskIds(task1)).toStrictEqual([task1.id]);
	expect(toTaskIds([task1,task2])).toStrictEqual([task1.id,task2.id]);
});

test('toTaskId', () => {
	expect(toTaskId(undefined)).toBe(undefined);
	expect(toTaskId(null)).toBe(null);
	expect(toTaskId(10)).toBe(10);
	expect(toTaskId("abcd")).toBe("abcd");
	expect(toTaskId({id:10})).toBe(10);
	expect(toTaskId({id:"abcd"})).toBe("abcd");
});

test('isEmpty', () => {
	expect(isEmpty(undefined)).toBe(true);
	expect(isEmpty(null)).toBe(true);
	expect(isEmpty([])).toBe(true);
	expect(isEmpty({})).toBe(true);
	expect(isEmpty([10])).toBe(false);
	expect(isEmpty({"asd": 10})).toBe(false);
	//Not supported on non-null, non-array inputs
});

test('isArraEmpty', () => {
	expect(isArrayEmpty(undefined)).toBe(true);
	expect(isArrayEmpty(null)).toBe(true);
	expect(isArrayEmpty([])).toBe(true);
	expect(isArrayEmpty([10])).toBe(false);
	//Not supported on non-null, non-array inputs
	expect(() => {backendJs.isArrayEmpty({})}).toThrow();
	expect(() => {backendJs.isArrayEmpty({"asd": 10})}).toThrow();
	expect(() => {backendJs.isArrayEmpty(10)}).toThrow();
	expect(() => {backendJs.isArrayEmpty("asd")}).toThrow();
});

test('diffDict', () => {
	expect(diffDict({}, {})).toStrictEqual({});
	expect(diffDict({'a': 1}, {'a': 1})).toStrictEqual({});
	expect(diffDict({'a': 'abcd'}, {'a': 'abcd'})).toStrictEqual({});
	//This never worked but eventually needs to:
	//expect(diffDict({'a': undefined}, {'a': undefined})).toStrictEqual({});
	//expect(diffDict({'a': null}, {'a': null})).toStrictEqual({});
	//Order is not important
	expect(diffDict({'a': 1, 'b': 2}, {'b': 2, 'a': 1})).toStrictEqual({});
	//Changes
	expect(diffDict({'a': 'abcd', 'b': 1}, {'a': 'abcd', 'b': 2})).toStrictEqual({'b': {'oldValue': 1, 'newValue': 2}});
	//Deletions
	expect(diffDict({'a': 'abcd', 'b': 1}, {'a': 'abcd'})).toStrictEqual({'b': {'oldValue': 1, 'newValue': undefined}});
	//Additions
	expect(diffDict({'a': 'abcd'}, {'a': 'abcd', 'b': 2})).toStrictEqual({'b': {'oldValue': undefined, 'newValue': 2}});
});

test('Tasks.sort', () => {
	let list = Tasks.sort([
		{id: 1, position: 1000},
		{id: 2, position: -254},
		{id: 3, position: 0},
		{id: 4, position: 1001},
		{id: 5, position: -0.01},
	]);
	expect(list.length).toBe(5);
	expect(list[0].id).toBe(2);
	expect(list[1].id).toBe(5);
	expect(list[2].id).toBe(3);
	expect(list[3].id).toBe(1);
	expect(list[4].id).toBe(4);
	
	expect(Tasks.sort([])).toStrictEqual([]);
	//No position no problem, still sort somewhere
	expect(Tasks.sort([{id: 'abcd'}])).toStrictEqual([{id: 'abcd'}]);
});

test('Tasks.dict', () => {
	let list = Tasks.dict([
		{id: 'a', position: 1000},
		{id: 'b', position: -254},
		{id: 'c', position: 0},
		{id: 'd', position: 1001},
		{id: 'e', position: -0.01},
	]);
	expect(typeof list).toBe('object');
	expect(Object.keys(list).length).toBe(5);
	expect(list['a'].position).toBe(1000);
	expect(list['b'].position).toBe(-254);
	expect(list['c'].position).toBe(0);
	expect(list['d'].position).toBe(1001);
	expect(list['e'].position).toBe(-0.01);
	
	expect(Tasks.dict([])).toStrictEqual({});
});

//resourcePatch -- especially the behavior with nulls/undefineds. Support undefineds?

test('DummyBackend', async () => {
	let dummy = new DummyBackend('abcd', 'my error text');
	//The only things we want from DummyBackend are:
	//1. to return the assigned name/uiName,
	expect(dummy.constructor).toBeDefined();
	expect(dummy.constructor.name).toBe('abcd');
	expect(dummy.uiName()).toBe('abcd');
	//2. to reject init() with the error passed to it
	await expectCatch(() => dummy.init()).toStrictEqual(new CatchResult('my error text'));
	//3. to successfully signout()
	await expect(() => dummy.signout()).not.toFail();
});


/*
Task comparison
In most requests, task1.toStrictEqual(task2) should be replaced with comparing only the main properties:
  expect(task1).toMatchTask(task2);

All Task fields can be grouped into:
0. 'id'.
1. Data fields that only change by user request. Normally we known what these should be at any point.
*/
var TASK_DATA_FIELDS = ['title', 'notes', 'status', 'completed', 'due'];
/*
2. Service fields that change somewhat unpredictably in response to non-direct commands (move, other updates).
  Usually we ignore these for simplicity but sometimes we CAN expect these to match too.
*/
var TASK_SERVICE_FIELDS =  ['parent', 'position', 'tasklist', 'updated', 'deleted', 'hidden'];
/*
3. Private fields that are different between backends:
     'kind', 'etag', 'selfLink', 'links'
   We don't care about these.
*/
var TaskExpect = {};
//Matches Task.id and data fields
TaskExpect.toMatchTask = function(received, other) {
	if (typeof other != 'object') throw Error("Expected argument to be a Task");
	if (typeof received != 'object')
		return { pass: false, message: () => 'Expected received to be object', };
	if (received.id != other.id)
		return { pass: false, message: () => 'IDs don\'t match: '+String(received.id)+' != '+String(other.id) };
	return TaskExpect.toMatchTaskData.call(this, received, other);
}
//Matches Task data fields, without ID
TaskExpect.toMatchTaskData = function(received, other) {
	if (typeof other != 'object') throw Error("Expected argument to be a Task");
	if (typeof received != 'object')
		return { pass: false, message: () => 'Expected received to be object', };
	let message = '';
	for (let field in TASK_DATA_FIELDS)
		if (received[field] != other[field])
			message += 'received.'+field+'='+String(received[field])+' != '+String(other[field])+'=other.'+field+"\n";
	return { pass: !message, message: () => message || 'All Task data fields match' };
}
//Matches Task.id, data and service fields
TaskExpect.toMatchTaskStrictly = function(received, other) {
	let result = TaskExpect.toMatchTask.call(this, received, other);
	if (!result.pass)
		return result;
	let message = '';
	for (let field in TASK_SERVICE_FIELDS)
		if (received[field] != other[field])
			message += 'received.'+field+'='+String(received[field])+' != '+String(other[field])+'=other.'+field+"\n";
	return { pass: !message, message: () => message || 'All Task data and service fields match' };
}
//ALL fields listed in patch must be the same in the received task
TaskExpect.toMatchPatch = function(received, other) {
	if (typeof other != 'object') throw Error("Expected argument to be a Task patch");
	if (typeof received != 'object')
		return { pass: false, message: () => 'Expected received to be object', };
	let message = '';
	for (let field in other)
		if (received[field] != other[field])
			message += 'received.'+field+'='+String(received[field])+' != '+String(other[field])+'=other.'+field+"\n";
	return { pass: !message, message: () => message || 'All Task fields match the patch' };
}
TaskExpect.toMatchTaskArray = function(received, other) {
	if (!Array.isArray(other)) throw Error("Expected argument to be an array, got "+String(other));
	if (!Array.isArray(received))
		return { pass: false, message: () => 'Expected received to be an array, got '+String(received) };
	received = received.sort((a,b) => String(a.id).localeCompare(String(b.id)));
	other = other.sort((a,b) => String(a.id).localeCompare(String(b.id)));
	let pass = true;
	if (received.length != other.length)
		pass = false;
	else
		for (let i in received) {
			let tmp = TaskExpect.toMatchTask(received[i], other[i]);
			if (!tmp.pass) {
				pass = false;
				break
			}
		}
	if (!pass)
		return { pass: false, message: () => "Arrays don\'t match:\nreceived="+String(received)+"\nexpected="+String(other) };
	else
		return { pass: true, message: () => 'Arrays match' };
}
expect.extend(TaskExpect);


/*
TaskCache tests
*/
test('TaskCache', () => {
	let cache = new TaskCache();
	expect(cache.values()).toStrictEqual([]);
	
	let task1 = Object.assign({id: 'id1'}, BackendTester.prototype.TEST_TASK1);
	let task2 = Object.assign({id: 'id2'}, BackendTester.prototype.TEST_TASK2);
	let task3 = Object.assign({id: 'id3'}, BackendTester.prototype.TEST_TASK3);
	
	//Add
	cache.add(task1);
	expect(cache.values()).toMatchTaskArray([task1]);
	cache.add(task2);
	expect(cache.values()).toMatchTaskArray([task1,task2]);
	
	//Update
	task1.title = 'New task1 title';
	cache.update(task1);
	cache.update(task2);
	expect(cache.values()).toMatchTaskArray([task1,task2]);
	
	//Patch
	let task2_patch = { id: task2.id, title: 'New task2 title' };
	cache.patch(task2_patch);
	task2.title = task2_patch.title;
	expect(cache.values()).toMatchTaskArray([task1,task2]);
	
	//Get
	expect(cache.get(task1.id)).toMatchTask(task1);
	expect(cache.get(task2.id)).toMatchTask(task2);
	
	//Delete
	cache.delete(task1.id);
	expect(cache.get(task1.id)).toBeUndefined();
	expect(cache.values()).toMatchTaskArray([task2]);

	//Clear
	cache.clear();
	expect(cache.values()).toStrictEqual([]);
	
	//Multi-add, multi-update, multi-delete
	cache.add([task2,task3,task1]);
	expect(cache.values()).toMatchTaskArray([task1,task2,task3]);
	
	task2.title = 'Better task2 title';
	task3.title = 'Better task3 title';
	cache.update([task2, task3]);
	expect(cache.values()).toMatchTaskArray([task1,task2,task3]);
	
	cache.delete([task1.id, task2.id]);
	expect(cache.values()).toMatchTaskArray([task3]);
	
	cache.clear();
	expect(cache.values()).toStrictEqual([]);
	
	//Tasklist bookkeeping
	cache.addList([task1, task2], 'list1');
	cache.addList([task3], 'list2');
	expect(cache.values()).toMatchTaskArray([task1,task2,task3]); //cache may add bookkeeping fields but those aren't checked
	
	expect(cache.getList('list2')).toMatchTaskArray([task3]);
	expect(cache.getList('list1')).toMatchTaskArray([task1,task2]);
	
	cache.deleteList('list1');
	expect(cache.values()).toMatchTaskArray([task3]);
});



/*
One instance of BackendTester will be created for every test_* function.
Override to personalize BackendTester for your Backend's peculiarities.
*/
function BackendTester(params) {
	jestUtils.Tester.call(this, params);
	this.backend = null;
	this.backendCtor = params.ctor;
}
inherit(jestUtils.Tester, BackendTester);
exports.BackendTester = BackendTester;

//Use this for additional async initialization
//The default implementation just creates a backend and signs it in as if it requires no params
BackendTester.prototype.init = async function() {
	jestUtils.Tester.prototype.init.call(this);
	this.backend = new this.backendCtor();
	expect(this.backend.isSignedIn()).toBe(false);
	await this.backend.init();
	await this.backend.signin();
	expect(this.backend.isSignedIn()).toBe(true);
}

//TODO: In most requests, crash and burn on tasklist==undefined, when selected tasklist is also undefined

//Demo tasks used in tests
BackendTester.prototype.TEST_TASK1 = {
	title: 'Task 1',
	notes: 'Task 1 notes 1',
	status: 'completed',
	completed: new Date(2010, 9, 8, 7, 6, 5),
	due: new Date(2012, 10, 9, 8, 7, 6),
};
BackendTester.prototype.TEST_TASK2 = {
	title: 'Task 2',
	notes: 'Task 2 notes 2',
	status: 'needsAction',
};
BackendTester.prototype.TEST_TASK3 = {
	title: 'Task 3',
	notes: 'Task 3 notes 3',
	status: 'needsAction',
};
BackendTester.prototype.verifyTask1 = function(task1) {
	expect(task1).toMatchTaskData(this.TEST_TASK1);
}
BackendTester.prototype.verifyTask2 = function(task2) {
	expect(task2).toMatchTaskData(this.TEST_TASK2);
}
BackendTester.prototype.verifyTask3 = function(task3) {
	expect(task3).toMatchTaskData(this.TEST_TASK3);
}

//Returns a disposable tasklist without tasks
//If the backend does not support tasklistAdd(), such list must be precreated
//and this function overriden to return it.
BackendTester.prototype.newEmptyTasklist = async function() {
	if (!this.backend.tasklistAdd) {
		//Must have precreated empty task list
		let tasklists = await this.backend.tasklistList();
		expect(tasklists.length).toBeGreaterThan(0);
		return tasklists[0].id;
	}
	let tasklist = await this.backend.tasklistAdd('Test list 1');
	expect(tasklist.id).toBeTruthy();
	return tasklist.id;
}

//Returns a disposable tasklist with 3 disposable tasks in this arrangement:
//  TEST_TASK1
//    TEST_TASK3
//  TEST_TASK2
//If the backend does not support insert(), this must be precreated.
BackendTester.prototype.newDemoTasklist = async function() {
	if (!this.backend.tasklistAdd || !this.backend.insert) {
		//Must have precreated task list and tasks
		let tasklists = await this.backend.tasklistList();
		expect(tasklists.length).toBeGreaterThan(1);
		return tasklists[1].id;
	};
	let list = await this.backend.tasklistAdd('Test list 2');
	expect(list.id).toBeTruthy();
	let task1 = await this.backend.insert(this.TEST_TASK1, null, list.id);
	expect(task1.id).toBeTruthy();
	let task2 = await this.backend.insert(this.TEST_TASK2, task1.id, list.id);
	expect(task2.id).toBeTruthy();
	let task1a = await this.backend.insert(Object.assign({}, this.TEST_TASK3, {'parent': task1.id}), null, list.id);
	expect(task1a.id).toBeTruthy();
	return list.id;
}

//Anything beginning with test_* will become a test, in the order declared

BackendTester.prototype.test_init = async function() {
	//Nothing.
}

BackendTester.prototype.test_uiName = function() {
	//uiName() must at least not fail and not be async.
	//Simple default implementation works so this just verifies that no overrode it with a broken one
	let uiName = this.backend.uiName();
	expect(typeof uiName).toBe('string');
}

BackendTester.prototype.test_settingsPage = async function() {
	if (!this.backend.settingsPage) return;
	let page = this.backend.settingsPage();
	settingsTest.testSettingsPage(page);
}

BackendTester.prototype.test_tasklistList = async function() {
	//tasklistList() and tasklistGet() must always be defined
	//We don't know if tasklistAdd() is available so run basic tests with what we have
	
	let list1Id = await this.newEmptyTasklist();
	let list2Id = await this.newDemoTasklist();
	
	let tasklists = await this.backend.tasklistList();
	let list1 = tasklists.find(list => list.id == list1Id);
	expect(list1).toBeDefined();
	let list2 = tasklists.find(list => list.id == list2Id);
	expect(list2).toBeDefined();
	
	let list1_get = await this.backend.tasklistGet(list1Id);
	expect(list1_get).toStrictEqual(list1);
	let list2_get = await this.backend.tasklistGet(list2Id);
	expect(list2_get).toStrictEqual(list2);
}
BackendTester.prototype.test_tasklistAdd = async function() {
	if (!this.backend.tasklistAdd) return;
	
	let newList = await this.backend.tasklistAdd('Abcd');
	let tasklists = await this.backend.tasklistList();
	expect(tasklists.length).toBe(1);
	expect(tasklists[0].title).toStrictEqual('Abcd');
	
	newList = await this.backend.tasklistAdd('Test list 2');
	tasklists = await this.backend.tasklistList();
	expect(tasklists.length).toBe(2);
	expect(tasklists[1].title).toStrictEqual('Test list 2');
}
	
BackendTester.prototype.test_tasklistUpdate = async function() {
	if (!this.backend.tasklistUpdate) return;

	let list1Id = await this.newEmptyTasklist();
	let list2Id = await this.newDemoTasklist();
	let tasklists1 = await this.backend.tasklistList();
	let list1 = tasklists1.find(list => list.id == list1Id);
	expect(list1).toBeDefined();

	//tasklistUpdate
	list1.title = '1abcd1';
	let result = await this.backend.tasklistUpdate(list1);
	expect(result).toStrictEqual(list1);
	
	let list1_copy = await this.backend.tasklistGet(list1.id);
	expect(list1_copy).toStrictEqual(list1);
	
	//tasklistPatch
	list1.title = '2abcd2';
	//Do not accept patches without IDs:
	await expect(() => this.backend.tasklistPatch({ 'title': list1.title }) ).toFail();
	result = await this.backend.tasklistPatch({ 'id': list1.id, 'title': list1.title });
	expect(result).toStrictEqual(list1);
	
	list1_copy = await this.backend.tasklistGet(list1.id);
	expect(list1_copy).toStrictEqual(list1);
	
	//List returns the same
	let tasklists2 = await this.backend.tasklistList();
	expect(tasklists2).toStrictEqual(tasklists1);
}

BackendTester.prototype.test_tasklistDelete = async function() {
	if (!this.backend.tasklistDelete) return; //Nothing to test
	
	let list1Id = await this.newEmptyTasklist();
	let list2Id = await this.newDemoTasklist();
	
	let tasklists1 = await this.backend.tasklistList();
	expect(tasklists1.find(list => list.id == list1Id)).toBeDefined();
	expect(tasklists1.find(list => list.id == list2Id)).toBeDefined();
	
	//Delete list1
	await expect(() => this.backend.tasklistDelete(list1Id)).not.toFail();
	let tasklists2 = await this.backend.tasklistList();
	expect(tasklists2.length).toBe(tasklists1.length - 1);
	expect(tasklists2.find(list => list.id == list1Id)).toBeUndefined();
	expect(tasklists2.find(list => list.id == list2Id)).toBeDefined();
	
	//Delete list1 again -- should fail
	await expect(() => this.backend.tasklistDelete(list1Id)).toFail();
	//Cannot retrieve list1 anymore
	await expect(() => this.backend.tasklistGet(list1Id)).toFail();
	
	//Delete list2
	await expect(() => this.backend.tasklistDelete(list2Id)).not.toFail();
	tasklists2 = await this.backend.tasklistList();
	expect(tasklists2.length).toBe(tasklists1.length - 2);
	expect(tasklists2.find(list => list.id == list2Id)).toBeUndefined();
	
	//Verify that the rest of the lists stayed the same
	expect(tasklists1).toEqual(expect.arrayContaining(tasklists2));
}

//insert() -- before list() because list() may already use insert() to produce non-empty list specimen
BackendTester.prototype.test_insert = async function() {
	if (!this.backend.insert) return; //Nothing to test
	
	let listId = await this.newEmptyTasklist();
	
	//Simple insert
	let task1 = await this.backend.insert(this.TEST_TASK1, null, listId);
	expect(task1.id).toBeTruthy();
	this.verifyTask1(task1);
	
	let task2 = await this.backend.insert(this.TEST_TASK2, null, listId);
	expect(task2.id).toBeTruthy();
	this.verifyTask2(task2);
	
	//Let's see if get() gets us the same thing
	//get() is not yet tested so stick to basics
	let task1_copy = await this.backend.get(task1.id, listId);
	expect(task1_copy).toMatchTask(task1);
	
	//Let's see if list() gets us both tasks -- again, stick to the basics
	let list2 = await this.backend.list(listId);
	expect(list2.length).toBe(2);
	Tasks.sort(list2);
	expect(list2[0]).toMatchTask(task2); //parent==null => added to the top
	expect(list2[1]).toMatchTask(task1);
	
	//Pass wrong tasklist/previous ids
	await expect(() => this.backend.insert(this.TEST_TASK2, null, 'clearly wrong tasklist ID') ).toFail();
	await expect(() => this.backend.insert(this.TEST_TASK2, 'clearly wrong previousId', listId) ).toFail();
	//Parent id
	/* OK, not all backends care about this so disabling for now
	let task2_proto = Object.assign({}, this.TEST_TASK2);
	task2_proto.parent = 'clearly wrong parentId';
	await expect(() => this.backend.insert(task2_proto, null, listId) ).toFail();
	*/
	
	//Not testing parent/previousId in full here, happens in move()
	//Not testing the consistency of status/completedDate, it's not super important
}

//Can happen later but can also happen now
BackendTester.prototype.test_insertMultiple = async function() {
	if (!this.backend.insert) return; //Nothing to test
	
	let listId = await this.newEmptyTasklist();
	
	//Just a very simple test
	let results = await this.backend.insertMultiple({
		'myId1': this.TEST_TASK1,
		'myId2': this.TEST_TASK2,
		'myId3': this.TEST_TASK3,
	}, listId);
	expect(Object.keys(results).length).toBe(3);
	expect(results['myId1'].id).toBeTruthy();
	expect(results['myId2'].id).toBeTruthy();
	expect(results['myId3'].id).toBeTruthy();
	this.verifyTask1(results['myId1']);
	this.verifyTask2(results['myId2']);
	this.verifyTask3(results['myId3']);
	
	//Not testing parent/previousId here, happens in move()
	
	//Inserting nothing should still work
	results = await this.backend.insertMultiple({}, listId);
	expect(Object.keys(results).length).toBe(0);
	
	//Wrong IDs
	await expect(() => this.backend.insertMultiple({'myId4':{}}, 'clearly wrong tasklist ID') ).toFail();
}

//list() -- uses insert()
BackendTester.prototype.test_list = async function()  {
	//list() is required so not checking for its presence
	
	//Empty list
	let listId = await this.newEmptyTasklist();
	let tasks = await this.backend.list(listId);
	expect(tasks).toStrictEqual([]);
	
	//List with data
	let list2Id = await this.newDemoTasklist();
	let tasks2 = await this.backend.list(list2Id);
	expect(tasks2.length).toBe(3);
	//Sort by title so that we have an idea of what's in what position
	tasks2.sort((a, b) => { return a.title.localeCompare(b.title); });
	this.verifyTask1(tasks2[0]);
	this.verifyTask2(tasks2[1]);
	this.verifyTask3(tasks2[2]);
}

BackendTester.prototype.test_delete = async function() {
	if (!this.backend.delete) return; //Nothing to test
	//We might not have insert() so only run tests on the precreated list
	
	let listId = await this.newDemoTasklist();
	
	//delete(nothing) should succeed and change nothing
	await expect(() => this.backend.delete([], listId) ).not.toFail();
	//Null may or may not work, won't test
	
	let tasks = await this.backend.list(listId);
	expect(tasks.length).toBe(3);
	tasks.sort((a, b) => { return a.title.localeCompare(b.title); });
	
	//Delete a single task
	await expect(() => this.backend.delete(tasks[1].id, listId) ).not.toFail();
	//Check the list again
	tasks = await this.backend.list(listId);
	expect(tasks.length).toBe(2);
	tasks.sort((a, b) => { return a.title.localeCompare(b.title); });
	this.verifyTask1(tasks[0]);
	this.verifyTask3(tasks[1]);
	
	//Deleting a parent without deleting its child is undefined for now, won't test
	
	//Wrong IDs
	//Pass something valid as IDs because [] may return [] without checking tasklistId
	await expect(() => this.backend.delete([tasks[0]], 'clearly wrong tasklist ID') ).toFail();
	await expect(() => this.backend.delete(['clearly wrong task ID'], listId) ).toFail();
	
	//delete(Task object)
	await expect(() => this.backend.delete(tasks[1], listId) ).not.toFail();
	tasks = await this.backend.list(listId);
	expect(tasks.length).toBe(1);
	this.verifyTask1(tasks[0]);
	
	//We've exhausted things we can delete, need another test
	//Not testing deleteWithChildren(), that'll happen after caching
}

BackendTester.prototype.test_deleteMultiple = async function() {
	if (!this.backend.delete) return; //Nothing to test
	
	//delete() but with multiple items
	//Test it not only with [array_of_one] but with actual multiple items to verify atomicity of parallel deletions (if implemented)
	
	let listId = await this.newDemoTasklist();
	let tasks = await this.backend.list(listId);
	expect(tasks.length).toBe(3);
	tasks.sort((a, b) => { return a.title.localeCompare(b.title); }); //sort to avoid accidentally delete()ing parents with children
	
	//delete(multiple)
	await expect(() => this.backend.delete([tasks[1], tasks[2]], listId) ).not.toFail();
	let tasks2 = await this.backend.list(listId);
	expect(tasks2.length).toBe(1); //if atomicity is broken this is going to be 2 or list() itself is going to break
	expect(tasks2[0].title).toStrictEqual(tasks[0].title); //the only one left; but position etc might have changed
}

//We will separately test getOne/getMultiple even though get() relies on them,
//because who knows how get() could be overriden
BackendTester.prototype.test_getOne = async function() {
	if (!this.backend.getOne) return;
	
	let listId = await this.newDemoTasklist();
	let tasks = await this.backend.list(listId);
	expect(tasks.length).toBeGreaterThanOrEqual(2);
	
	//get by id
	let task1 = await this.backend.getOne(tasks[0].id, listId);
	expect(task1).toStrictEqual(tasks[0]);
	
	//get by Task
	let task2 = await this.backend.getOne(tasks[1], listId);
	expect(task2).toStrictEqual(tasks[1]);
	
	//Crash and burn on bad input
	await expect(() => this.backend.getOne(tasks[0].id, 'clearly wrong tasklistId')).toFail();
	await expect(() => this.backend.getOne('clearly wrong taskId', listId)).toFail();
	await expect(() => this.backend.getOne([], listId)).toFail();
	await expect(() => this.backend.getOne()).toFail();
}
BackendTester.prototype.test_getMultiple = async function() {
	if (!this.backend.getMultiple) return;
	//getMultiple returns an id->task dict
	
	let listId = await this.newDemoTasklist();
	let tasks = await this.backend.list(listId);
	expect(tasks.length).toBeGreaterThanOrEqual(2);
	
	//get by id
	let tasks1 = await this.backend.getMultiple([tasks[0].id], listId);
	expect(typeof tasks1).toBe('object');
	tasks1 = Object.values(tasks1); //easier to us
	expect(tasks1.length).toBe(1);
	expect(tasks1[0]).toStrictEqual(tasks[0]);
	
	//get by Task
	let tasks2 = await this.backend.getMultiple([tasks[1], tasks[0]], listId);
	expect(typeof tasks2).toBe('object');
	tasks2 = Object.values(tasks2);
	expect(tasks2.length).toBe(2);
	expect(tasks2[0]).toStrictEqual(tasks[1]);
	expect(tasks2[1]).toStrictEqual(tasks[0]);
	
	//get nothing
	let tasks3 = await this.backend.getMultiple([], listId);
	expect(typeof tasks3).toBe('object');
	tasks3 = Object.values(tasks3);
	expect(tasks3.length).toBe(0);
	
	//Crash and burn on bad input
	await expect(() => this.backend.getMultiple([tasks[0].id], 'clearly wrong tasklistId')).toBeDefined();
	await expect(() => this.backend.getMultiple(['clearly wrong taskId'], listId)).toBeDefined();
	await expect(() => this.backend.getMultiple()).toBeDefined();
}

BackendTester.prototype.test_get = async function() {
	//Do not require (getOne||getMultiple) here cause backends can override get()
	//entirely independently
	
	let listId = await this.newDemoTasklist();
	let tasks = await this.backend.list(listId);
	expect(tasks.length).toBeGreaterThanOrEqual(2);
	
	//get by single id
	let task1 = await this.backend.get(tasks[0].id, listId);
	expect(task1).toStrictEqual(tasks[0]);
	
	//get by Task
	let task2 = await this.backend.get(tasks[1], listId);
	expect(task2).toStrictEqual(tasks[1]);
	
	//get by multiple ids/objects
	let tasks3 = await this.backend.get([tasks[1].id, tasks[0]], listId);
	expect(typeof tasks3).toBe('object');
	tasks3 = Object.values(tasks3);
	expect(tasks3.length).toBe(2);
	expect(tasks3[0]).toStrictEqual(tasks[1]);
	expect(tasks3[1]).toStrictEqual(tasks[0]);
	
	//get nothing
	let tasks4 = await this.backend.get([], listId);
	expect(typeof tasks4).toBe('object');
	tasks4 = Object.values(tasks4);
	expect(tasks4.length).toBe(0);
	
	//Crash and burn on bad input
	await expect(() => this.backend.get([tasks[0].id], 'clearly wrong tasklistId')).toFail();
	await expect(() => this.backend.get(['clearly wrong taskId'], listId)).toFail();
	await expect(() => this.backend.get()).toFail();
}

BackendTester.prototype.test_update = async function() {
	if (!this.backend.update) return;
	
	let listId = await this.newDemoTasklist();
	let tasks = await this.backend.list(listId);
	expect(tasks.length).toBeGreaterThanOrEqual(2);
	
	//Find TEST_TASK1
	let idx = tasks.findIndex(task => task.title == this.TEST_TASK1.title);
	expect(idx).toBeGreaterThanOrEqual(0);
	this.verifyTask1(tasks[idx]);
	
	//Convert to TEST_TASK2 in all but id
	//We're going over keys from both sources so that if one leaves something undefined that's still applied
	for (let key in Object.assign({}, this.TEST_TASK1, this.TEST_TASK2))
		tasks[idx][key] = this.TEST_TASK2[key];
	this.verifyTask2(tasks[idx]);
	
	//Update
	let result = await this.backend.update(tasks[idx], listId);
	this.verifyTask2(result);
	
	//Other fields must've remained the same but it's hard to expect().toStrictEqual()
	//because the backend can change them arbitrarily
	//So we're only checking that the fields we've changed have been changed.
	
	let task_copy = await this.backend.get(tasks[idx].id, listId);
	this.verifyTask2(task_copy);
	
	//Crash and burn on bad input
	await expect(() => this.backend.update(tasks[idx], 'clearly wrong tasklistId')).toFail();
	await expect(() => this.backend.update({id: 'clearly wrong id'}, listId)).toFail();
	await expect(() => this.backend.update({title: 'Task with no id'}, listId)).toFail();
	await expect(() => this.backend.update()).toFail();
}

BackendTester.prototype.test_patch = async function() {
	if (!this.backend.update) return;
	
	let listId = await this.newDemoTasklist();
	let tasks = await this.backend.list(listId);
	expect(tasks.length).toBeGreaterThanOrEqual(2);
	
	//Find TEST_TASK1
	let idx = tasks.findIndex(task => task.title == this.TEST_TASK1.title);
	expect(idx).toBeGreaterThanOrEqual(0);
	this.verifyTask1(tasks[idx]);
	
	//Create a patch from that to TEST_TASK2
	let patch = {id: tasks[idx].id};
	for (let key in Object.assign({}, this.TEST_TASK1, this.TEST_TASK2)) {
		patch[key] = this.TEST_TASK2[key];
		if (typeof patch[key] == 'undefined')
			patch[key] = null; //currently patch() is peculiar about this
	}
	this.verifyTask2(patch);
	
	//Update
	let result = await this.backend.patch(patch, listId);
	this.verifyTask2(result);
	
	let task_copy = await this.backend.get(patch.id, listId);
	this.verifyTask2(task_copy);
	
	//Crash and burn on bad input
	await expect(() => this.backend.patch(tasks[idx], 'clearly wrong tasklistId')).toFail();
	await expect(() => this.backend.patch({id: 'clearly wrong id'}, listId)).toFail();
	await expect(() => this.backend.patch({title: 'Task with no id'}, listId)).toFail();
	await expect(() => this.backend.patch()).toFail();
}

BackendTester.prototype.test_selectTaskList = async function() {
	let list1Id = await this.newEmptyTasklist();
	let list2Id = await this.newDemoTasklist();
	
	let tasks1 = await this.backend.list(list1Id);
	let tasks2 = await this.backend.list(list2Id);
	expect(tasks2.length).toBeGreaterThan(0);
	
	//No list selected nor explicitly given => functions should fail
	//But won't check. Some backends auto-guess lists from task IDs and while not required that's not punishable?
	
	//Select non-existing => fail
	await expect(() => this.backend.selectTaskList('clearly wrong list id')).toFail();
	
	//Select no list => return []
	expect(await this.backend.selectTaskList(null)).toStrictEqual([]);
	expect(await this.backend.selectTaskList(undefined)).toStrictEqual([]);
	expect(this.backend.selectedTaskList).toBeFalsy();
	
	//Select a list
	await expect(() => this.backend.selectTaskList(list2Id)).not.toFail();
	expect(this.backend.selectedTaskList).toBe(list2Id);
	
	//Select it again, this time get the results
	//Also checks that the second "select" still returns the list and not skips everything entirely
	expect(await this.backend.selectTaskList(list2Id)).toMatchTaskArray(tasks2);
	expect(this.backend.selectedTaskList).toBe(list2Id);
	
	//THESE functions do not auto-substitute the tasklist and MUST fail without explicit one even when one is selected
	//Test this to avoid feature creep where some backends do substitute and clients start to rely on that
	await expect(() => this.backend.list()).toFail();
	if (this.backend.insert)
		await expect(() => this.backend.insert(this.TEST_TASK1, null)).toFail();
	if (this.backend.insertMultiple)
		await expect(() => this.backend.insertMultiple({'id1':this.TEST_TASK1}, null)).toFail();
	if (this.backend.delete)
		await expect(() => this.backend.delete(tasks2[0])).toFail();
	//No checks with explicit task lists, this is checked in their personal tests
	
	//Explicit list given AND WRONG => should fail, even if the selected one would be correct.
	//This is a requirement.
	await expect(() => this.backend.get(tasks2[0], list1Id)).toFail();
	if (this.backend.getOne)
		await expect(() => this.backend.getOne(tasks2[0], list1Id)).toFail();
	if (this.backend.getMultiple)
		await expect(() => this.backend.getMultiple([tasks2[0]], list1Id)).toFail();
	if (this.backend.update)
		await expect(() => this.backend.update(tasks2[0], list1Id)).toFail();
	if (this.backend.patch)
		await expect(() => this.backend.patch(tasks2[0], list1Id)).toFail();

	//No explicit list given, and the selected one is wrong for a task? Again, dubious,
	//but we don't test nor punish backends that guess the correct list instead.

	//Now the successful changes part. Default list selected => should be used
	expect(await this.backend.get(tasks2[0].id)).toMatchTask(tasks2[0]);
	if (this.backend.getOne)
		expect(await this.backend.getOne(tasks2[0].id)).toMatchTask(tasks2[0]);
	if (this.backend.getMultiple)
		expect(await this.backend.getMultiple([tasks2[0].id])).toMatchTaskArray([tasks2[0]]);
	if (this.backend.update) {
		expect(await this.backend.update(tasks2[0])).toMatchTask(tasks2[0]);
		expect(await this.backend.get(tasks2[0].id)).toMatchTask(tasks2[0]);
	}
	if (this.backend.patch) {
		expect(await this.backend.patch(tasks2[0])).toMatchTask(tasks2[0]);
		expect(await this.backend.get(tasks2[0].id)).toMatchTask(tasks2[0]);
	}

	/*
	moveToList/copyToList/copyChildrenTo have no auto-substitution at all
	so are just normally tested in their turn
	
	TODO:	deleteWithChildren -- supports auto-tasklistId
	
	TODO: 	move, _moveOne, moveChildren
	These are weird: many descendants only support them on a selected list,
	and sometimes don't even check if the explicit one is given!
	In any case, the base move/_moveOne implementations support all tasklists so that happens too.
	moveChildren doesn't, even in the base version.

	So. We need some kind of rule.
	1. Those HAVE to work for the currently selected list.
	2. They HAVE to accept it both explicitly and via substitution. (Though it's the same thing)
	3. They HAVE to fail if given an explicit one that doesn't match the selected one, which they want.
	4. But they MAY succeed for other explicit lists.
	*/
}

BackendTester.prototype.test_cacheUpdates = async function() {
	//Test that all operations correctly update cache
	//Currently only the selected list is cached (or at least that's the only one that's required and checked)
	let list1Id = await this.newEmptyTasklist();
	let list2Id = await this.newDemoTasklist();
	
	expect(await this.backend.list(list1Id)).toStrictEqual([]);
	
	
	//In all tests specify the list explicitly EVEN THOUGH the same list should be selected
	//Because the auto-substitution is tested elsewhere and this is an interesting corner case,
	//what if the backend fails to update the cache on explicitly passed lists.
	
	//First the insertion, so select the empty list
	expect(await this.backend.selectTaskList(list1Id)).toStrictEqual([]);
	if (this.backend.insert) {
		let task1 = await this.backend.insert(this.TEST_TASK1, null, list1Id);
		expect(task1).toMatchTaskData(this.TEST_TASK1);
		expect(this.backend.cache.get(task1.id)).toMatchTask(task1);
	}
	if (this.backend.insertMultiple) {
		let tasks2 = await this.backend.insertMultiple({'id2': this.TEST_TASK2}, list1Id);
		expect(tasks2).toBeObject;
		let task2 = tasks2['id2'];
		expect(task2).toMatchTask(this.TEST_TASK2);
		expect(this.backend.cache.get(task2.id)).toMatchTask(task2);
	}
	
	//Now the changes, select the populated one
	let tasks2 = await this.backend.selectTaskList(list2Id);
	expect(tasks2).toBeArray();
	expect(tasks2.length).toBeGreaterThan(0);
	let task2 = tasks2[0];
	expect(this.backend.cache.get(task2.id)).toMatchTask(task2);
	if (this.backend.update) {
		//copy to avoid accidentally writing to cached object by ourselves
		let task2a = Object.assign({}, task2, { title: 'New task2 title' });
		let task2b = await this.backend.update(task2a, list2Id);
		expect(task2b).toMatchTask(task2a);
		expect(this.backend.cache.get(task2.id)).toMatchTask(task2a);
	}
	if (this.backend.patch) {
		let task2patch = { id: task2.id, title: 'Better task2 title' };
		let task2b = await this.backend.patch(task2patch, list2Id);
		expect(task2b).toMatchPatch(task2patch);
		expect(this.backend.cache.get(task2.id)).toMatchPatch(task2patch);
	}
	if (this.backend.delete) {
		await expect(() => this.backend.delete(task2.id, list2Id)).not.toFail();
		expect(this.backend.cache.get(task2.id)).toBeUndefined();
	}
	/*
	TODO: move, _moveOne, moveChildren
	TODO: deleteWithChildren
	TODO: moveToList (deletes from this list anyway)
	*/
}


//cachedGet
//getChildren
//getAllChildren
//move/_moveOne
//moveChildren
//moveToList
//copyToList
//choosePosition


BackendTester.prototype.test_deleteWithChildren = async function() {
	if (!this.backend.delete) return; //Nothing to test
	
	let listId = await this.newDemoTasklist();
	
	//ATM deleteWithChildren only supports passing one task at a time
	
	//deleteWithChildren needs caching
	let tasks = await this.backend.selectTaskList(listId);
	expect(tasks.length).toBe(3);
	tasks.sort((a, b) => { return a.title.localeCompare(b.title); });
	
	//Delete 1->3
	await expect(() => this.backend.deleteWithChildren(tasks[0].id, listId) ).not.toFail();
	tasks = await this.backend.list(listId);
	expect(tasks.length).toBe(1);
	this.verifyTask2(tasks[0]);
	
	//deleteWithChildren(object)
	await expect(() => this.backend.deleteWithChildren(tasks[0], listId) ).not.toFail();
	tasks = await this.backend.list(listId);
	expect(tasks.length).toBe(0);
	
	//Wrong IDs
	await expect(() => this.backend.deleteWithChildren([], 'clearly wrong tasklist ID') ).toFail();
	await expect(() => this.backend.deleteWithChildren('clearly wrong task ID', listId) ).toFail();
}

//move/_moveOne
//moveToList