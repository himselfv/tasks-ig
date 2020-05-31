import * as utils from 'utils.js';
utils.importAll(utils);
import * as imp2 from 'backend.js';
importAll(imp2);
import * as imp3 from 'backendLocal.js';
importAll(imp3);
import * as jestUtils from 'jest-utils.js';
importAll(jestUtils);
import * as settingsTest from 'settings.test.js';


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
	expect(task1.title).toStrictEqual(this.TEST_TASK1.title);
	expect(task1.notes).toStrictEqual(this.TEST_TASK1.notes);
	expect(task1.status).toStrictEqual(this.TEST_TASK1.status);
	expect(task1.completed).toStrictEqual(this.TEST_TASK1.completed);
	expect(task1.due).toStrictEqual(this.TEST_TASK1.due);
}
BackendTester.prototype.verifyTask2 = function(task2) {
	expect(task2.title).toStrictEqual(this.TEST_TASK2.title);
	expect(task2.notes).toStrictEqual(this.TEST_TASK2.notes);
	expect(task2.status).toStrictEqual(this.TEST_TASK2.status);
	expect(task2.completed).toBeFalsy();
	expect(task2.due).toBeFalsy();
}
BackendTester.prototype.verifyTask3 = function(task3) {
	expect(task3.title).toStrictEqual(this.TEST_TASK3.title);
	expect(task3.notes).toStrictEqual(this.TEST_TASK3.notes);
	expect(task3.status).toStrictEqual(this.TEST_TASK3.status);
	expect(task3.completed).toBeFalsy();
	expect(task3.due).toBeFalsy();
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
	await expectCatch(() => this.backend.tasklistPatch({ 'title': list1.title }) ).toBeDefined();
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
	await expectCatch(() => this.backend.tasklistDelete(list1Id)).toBeUndefined();
	let tasklists2 = await this.backend.tasklistList();
	expect(tasklists2.length).toBe(tasklists1.length - 1);
	expect(tasklists2.find(list => list.id == list1Id)).toBeUndefined();
	expect(tasklists2.find(list => list.id == list2Id)).toBeDefined();
	
	//Delete list1 again -- should fail
	await expectCatch(() => this.backend.tasklistDelete(list1Id)).toBeDefined();
	//Cannot retrieve list1 anymore
	await expectCatch(() => this.backend.tasklistGet(list1Id)).toBeDefined();
	
	//Delete list2
	await expectCatch(() => this.backend.tasklistDelete(list2Id)).toBeUndefined();
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
	expect(task1_copy).toMatchObject(task1);
	
	//Let's see if list() gets us both tasks -- again, stick to the basics
	let list2 = await this.backend.list(listId);
	expect(list2.length).toBe(2);
	Tasks.sort(list2);
	expect(list2[0]).toMatchObject(task2); //parent==null => added to the top
	expect(list2[1]).toMatchObject(task1);
	
	//Pass wrong tasklist/previous ids
	await expectCatch(() => this.backend.insert(this.TEST_TASK2, null, 'clearly wrong tasklist ID') ).toBeDefined();
	await expectCatch(() => this.backend.insert(this.TEST_TASK2, 'clearly wrong previousId', listId) ).toBeDefined();
	//Parent id
	/* OK, not all backends care about this so disabling for now
	let task2_proto = Object.assign({}, this.TEST_TASK2);
	task2_proto.parent = 'clearly wrong parentId';
	await expectCatch(() => this.backend.insert(task2_proto, null, listId) ).toBeDefined();
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
	await expectCatch(() => this.backend.insertMultiple({'myId4':{}}, 'clearly wrong tasklist ID') ).toBeDefined();
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
	//If we don't have insert() we can only run minimal tests on the precreated list
	
	let listId = await this.newDemoTasklist();
	
	//delete(nothing) should succeed and change nothing
	await expectCatch(() => this.backend.delete([], listId) ).toBeUndefined();
	//Null may or may not work, won't test
	
	let tasks = await this.backend.list(listId);
	expect(tasks.length).toBe(3);
	tasks.sort((a, b) => { return a.title.localeCompare(b.title); });
	
	//Delete a single task
	await expectCatch(() => this.backend.delete(tasks[1].id, listId) ).toBeUndefined();
	//Check the list again
	tasks = await this.backend.list(listId);
	expect(tasks.length).toBe(2);
	tasks.sort((a, b) => { return a.title.localeCompare(b.title); });
	this.verifyTask1(tasks[0]);
	this.verifyTask3(tasks[1]);
	
	//Deleting a parent without deleting its child is undefined for now, won't test
	
	//delete(Task object)
	await expectCatch(() => this.backend.delete(tasks[1], listId) ).toBeUndefined();
	tasks = await this.backend.list(listId);
	expect(tasks.length).toBe(1);
	this.verifyTask1(tasks[0]);
	
	//delete(multiple)
	await expectCatch(() => this.backend.delete([tasks[0]], listId) ).toBeUndefined();
	tasks = await this.backend.list(listId);
	expect(tasks.length).toBe(0);
	
	//Wrong IDs
	await expectCatch(() => this.backend.delete([], 'clearly wrong tasklist ID') ).toBeDefined();
	await expectCatch(() => this.backend.delete(['clearly wrong task ID'], listId) ).toBeDefined();
	
	//We've exhausted things we can delete, need another test
	//Not testing deleteWithChildren(), that'll happen after caching
}

//get/getOne/getMultiple
//update
//patch

//move/_moveOne
//moveToList
//selectTaskList
//cachedGet
//getChildren
//getAllChildren
//deleteWithChildren

BackendTester.prototype.test_deleteWithChildren = async function() {
	if (!this.backend.delete) return; //Nothing to test
	
	let listId = await this.newDemoTasklist();
	
	//ATM deleteWithChildren only supports passing one task at a time
	
	//deleteWithChildren needs caching
	let tasks = await this.backend.selectTaskList(listId);
	expect(tasks.length).toBe(3);
	tasks.sort((a, b) => { return a.title.localeCompare(b.title); });
	
	//Delete 1->3
	await expectCatch(() => this.backend.deleteWithChildren(tasks[0].id, listId) ).toBeUndefined();
	tasks = await this.backend.list(listId);
	expect(tasks.length).toBe(1);
	this.verifyTask2(tasks[0]);
	
	//deleteWithChildren(object)
	await expectCatch(() => this.backend.deleteWithChildren(tasks[0], listId) ).toBeUndefined();
	tasks = await this.backend.list(listId);
	expect(tasks.length).toBe(0);
	
	//Wrong IDs
	await expectCatch(() => this.backend.deleteWithChildren([], 'clearly wrong tasklist ID') ).toBeDefined();
	await expectCatch(() => this.backend.deleteWithChildren('clearly wrong task ID', listId) ).toBeDefined();
}


function BackendLocalStorageTester(params) {
	BackendTester.call(this, params);
}
inherit(BackendTester, BackendLocalStorageTester);
BackendLocalStorageTester.prototype.init = async function() {
	BackendTester.prototype.init.call(this);
	//LocalStorage works cleaner with reset() between tests
	await this.backend.reset();
}

Tester.run(BackendLocalStorageTester, {'ctor': BackendSessionStorage});
Tester.run(BackendLocalStorageTester, {'ctor': BackendLocalStorage});
//browser.storage.* is unavailable and otherwise it's ~= BackendLocalStorage
//testBackend(BackendLocalStorageTester, BackendBrowserStorageSync);
//testBackend(BackendLocalStorageTester, BackendBrowserStorageLocal);
