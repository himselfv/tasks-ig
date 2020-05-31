import * as imp1 from './utils.js';
imp1.importAll(imp1);
import * as imp2 from './backend.js';
importAll(imp2);
import * as imp3 from './backendLocal.js';
importAll(imp3);


/*
async howto:
	async function is basically a normal function that returns Promise() of what it would have returned.
	that's it
	they're interchangeable
	async function() decoration only matters inside the function. You can pass Promise()-returning function where async function is expected.
	
expect() howto:
1. 	expect() always expects a VALUE (maybe a Promise).
  	async () => {} declares a FUNCTION which may RETURN a promise.
  	So you shouldn't expect(async () => {}). That'l create Expect with a FUNCTION object.
  	You can expect( (async () => {})() ). Here you're CALLING that function. That'll produce a promise object.

2.	toBe()/toEqual()/... study the VALUE inside expect() directly (as a Promise/as a Function, if it is that)
	resolves/rejects family of functions assumes the value is a Promise and studies its result.
	toThrow() assumes the value is a Function, calls it and studies its result.

3.	resolves/rejects.*() family of functions returns promises which you can wait on.
	But you cannot wait on expect() itself.
*/

/*
Normal toThrow() doesn't catch non-Error()-based throws, so we need something better.

Runs the potentially async / Promise-returning function and catches any throws.
Returns the Promise of an expect(error wrapped in CatchResult()) or expect(undefined).
Usage:
	await expectCatch(myFunc).toBeDefined()/toBeUndefined()
*/
function CatchResult(error) {
	this.error = error;
}
exports.CatchResult = CatchResult;
function expectCatch(fn) {
	return expect((async () => {
		try {
			await fn();
			return undefined;
		}
		catch(error) {
			return new CatchResult(error);
		}
	})()).resolves; //this returns a promise
}
exports.expectCatch = expectCatch;

test('Jest helpers', async () => {
	await expectCatch(() => {throw "asd"}).toBeDefined();
	await expectCatch(() => "asd").toBeUndefined();
	//With promises
	await expectCatch(() => Promise.reject("asd") ).toBeDefined();
	await expectCatch(() => Promise.reject() ).toBeDefined();
	await expectCatch(() => Promise.resolve() ).toBeUndefined();
});


/*
One instance of BackendTester will be created for every test_* function.
Override to personalize BackendTester for your Backend's peculiarities.
*/
function BackendTester(params) {
	this.backend = null;
	this.backendCtor = params.ctor;
}
exports.BackendTester = BackendTester;

//Use this for additional async initialization
//The default implementation just creates a backend and signs it in as if it requires no params
BackendTester.prototype.init = async function() {
	this.backend = new this.backendCtor();
	expect(this.backend.isSignedIn()).toBe(false);
	await this.backend.init();
	await this.backend.signin();
	expect(this.backend.isSignedIn()).toBe(true);
}

//This is a CLASS function -- can be called on an uninitialized backendTester
BackendTester.prototype.getAllTests = function() {
	let dict = {};
	function listTestMethods(obj) {
		if (obj == null) return;
		let names = Object.getOwnPropertyNames(obj);
		for (let i=0; i<names.length; i++) {
			let name = names[i];
			if (!name.startsWith('test_'))
				continue;
			if (typeof obj[name] != 'function')
				continue;
			if (name in dict)
				continue; //override is already present
			dict[name] = obj[name];
		}
		listTestMethods(Object.getPrototypeOf(obj));
	}
	listTestMethods(this);
	return dict;
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

BackendTester.prototype.test_lists = async function() {
	let tasklists = await this.backend.tasklistList();
	expect(tasklists).toStrictEqual([]);
	
	//TODO: If we have tasklistAdd, try the add+verify, otherwise REQUIRE we have at least one list and play with that
	
	
	//tasklistAdd
	let newList = await this.backend.tasklistAdd('Abcd');
	tasklists = await this.backend.tasklistList();
	expect(tasklists.length).toBe(1);
	expect(tasklists[0].title).toStrictEqual('Abcd');
	
	//tasklistAdd
	newList = await this.backend.tasklistAdd('Test list 2');
	tasklists = await this.backend.tasklistList();
	expect(tasklists.length).toBe(2);
	expect(tasklists[1].title).toStrictEqual('Test list 2');
	
	if (this.backend.tasklistUpdate) {
		//tasklistUpdate
		tasklists[0].title = '1abcd1';
		let result = await this.backend.tasklistUpdate(tasklists[0]);
		expect(result).toStrictEqual(tasklists[0]);
		
		let tasklist = await this.backend.tasklistGet(tasklists[0].id);
		expect(tasklist).toStrictEqual(tasklists[0]);
		
		//tasklistPatch
		tasklists[0].title = '2abcd2';
		try {
			await this.backend.tasklistPatch({ 'title': tasklists[0].title });
			expect(false).toBe(true); //should not reach here
		} catch {}
		result = await this.backend.tasklistPatch({ 'id': tasklists[0].id, 'title': tasklists[0].title });
		expect(result).toStrictEqual(tasklists[0]);
		
		tasklist = await this.backend.tasklistGet(tasklists[0].id);
		expect(tasklist).toStrictEqual(tasklists[0]);
		
		//List returns the same
		let tasklists2 = await this.backend.tasklistList();
		expect(tasklists2.length).toBe(2);
		expect(tasklists2).toStrictEqual(tasklists);
	}
	//Otherwise leave as it was
	
	//tasklistGet alone, anyways
	let tasklist = await this.backend.tasklistGet(tasklists[0].id);
	expect(tasklist).toStrictEqual(tasklists[0]);
	
	//tasklistDelete
	if (this.backend.tasklistAdd && this.backend.tasklistDelete) {
		await this.backend.tasklistDelete(tasklists[0].id);
		
		let tasklists2 = await this.backend.tasklistList();
		expect(tasklists2.length).toBe(1);
		expect(tasklists2[0]).toStrictEqual(tasklists[1]);
	}
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

//uiName
//settingsPage проверить на корректность параметров -- какой-то стандартный тестер сделать, также и для options

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


//Expects params to pass to backendTesterCtor
function testBackend(backendTesterCtor, params) {
	describe(backendTesterCtor.name, () => {
		let backendTester = null;
		
		beforeEach(async () => {
			backendTester = new backendTesterCtor(params);
			await backendTester.init();
		});
		
		//Create a fake non-initialized object to call class method getAllTests
		let proto = Object.create(backendTesterCtor.prototype);
		let tests = proto.getAllTests();
		
		//Create tests for all prototype methods
		for (let name in tests) {
			let thisTest = tests[name]; //before we edit name
			if (name.startsWith('test_'))
				name = name.slice(5);
			test(name, () => thisTest.call(backendTester) );
			
		}
	});
	
}
exports.testBackend = testBackend;

function BackendTester2(params) {
	BackendTester.call(this, params);
}
inherit(BackendTester, BackendTester2);

testBackend(BackendTester2, {'ctor': BackendSessionStorage});
testBackend(BackendTester2, {'ctor': BackendLocalStorage});
//browser.storage.* is unavailable and otherwise it's ~= BackendLocalStorage
//testBackend(BackendTester, BackendBrowserStorageSync);
//testBackend(BackendTester, BackendBrowserStorageLocal);
