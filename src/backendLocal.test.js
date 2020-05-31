import * as imp1 from './utils.js';
imp1.importAll(imp1);
import * as imp2 from './backend.js';
importAll(imp2);
import * as imp3 from './backendLocal.js';
importAll(imp3);


//Expects initialized and signed-in backend which can be poked
function testBackend(backendCtor, backendInitProc) {
	if (!backendInitProc)
		backendInitProc = async () => {
			let backend = new backendCtor();
			expect(backend.isSignedIn()).toBe(false);
			await backend.init();
			await backend.signin();
			expect(backend.isSignedIn()).toBe(true);
			return backend;
		};
	
	describe(backendCtor.name, () => {
		let backend = null;
		
		beforeEach(async () => {
			backend = await backendInitProc();
		});

		//Returns a disposable tasklist without tasks
		//If the backend does not support tasklistAdd(), such list must be precreated
		//and this function overriden to return it.
		async function newEmptyTasklist() {
			if (!backend.tasklistAdd) {
				//Must have precreated empty task list
				let tasklists = await backend.tasklistList();
				expect(tasklists.length).toBeGreaterThan(0);
				return tasklists[0].id;
			}
			let tasklist = await backend.tasklistAdd('Test list 1');
			expect(tasklist.id).toBeTruthy();
			return tasklist.id;
		}
		
		
		//Demo tasks used in tests
		let TEST_TASK1 = {
			title: 'Task 1',
			notes: 'Task 1 notes 1',
			status: 'completed',
			completed: new Date(2010, 9, 8, 7, 6, 5),
			due: new Date(2012, 10, 9, 8, 7, 6),
		};
		let TEST_TASK2 = {
			title: 'Task 2',
			notes: 'Task 2 notes 2',
			status: 'needsAction',
		};
		let TEST_TASK3 = {
			title: 'Task 3',
			notes: 'Task 3 notes 3',
			status: 'needsAction',
		};
		function verifyTask1(task1) {
			expect(task1.title).toStrictEqual(TEST_TASK1.title);
			expect(task1.notes).toStrictEqual(TEST_TASK1.notes);
			expect(task1.status).toStrictEqual(TEST_TASK1.status);
			expect(task1.completed).toStrictEqual(TEST_TASK1.completed);
			expect(task1.due).toStrictEqual(TEST_TASK1.due);
		}
		function verifyTask2(task2) {
			expect(task2.title).toStrictEqual(TEST_TASK2.title);
			expect(task2.notes).toStrictEqual(TEST_TASK2.notes);
			expect(task2.status).toStrictEqual(TEST_TASK2.status);
			expect(task2.completed).toBeFalsy();
			expect(task2.due).toBeFalsy();
		}
		function verifyTask3(task3) {
			expect(task3.title).toStrictEqual(TEST_TASK3.title);
			expect(task3.notes).toStrictEqual(TEST_TASK3.notes);
			expect(task3.status).toStrictEqual(TEST_TASK3.status);
			expect(task3.completed).toBeFalsy();
			expect(task3.due).toBeFalsy();
		}
		
		
		//Returns a disposable tasklist with 3 disposable tasks in this arrangement:
		//  TEST_TASK1
		//    TEST_TASK3
		//  TEST_TASK2
		//If the backend does not support insert(), this must be precreated.
		async function newDemoTasklist() {
			if (!backend.tasklistAdd || !backend.insert) {
				//Must have precreated task list and tasks
				let tasklists = await backend.tasklistList();
				expect(tasklists.length).toBeGreaterThan(1);
				return tasklists[1].id;
			};
			let list = await backend.tasklistAdd('Test list 2');
			expect(list.id).toBeTruthy();
			let task1 = await backend.insert(TEST_TASK1, null, list.id);
			expect(task1.id).toBeTruthy();
			let task2 = await backend.insert(TEST_TASK2, task1.id, list.id);
			expect(task2.id).toBeTruthy();
			let task1a = await backend.insert(Object.assign({}, TEST_TASK3, {'parent': task1.id}), null, list.id);
			expect(task1a.id).toBeTruthy();
			return list.id;
		}
		

		test('init', async () => {
		});
		
		test('lists', async () => {
			let tasklists = await backend.tasklistList();
			expect(tasklists).toStrictEqual([]);
			
			//TODO: If we have tasklistAdd, try the add+verify, otherwise REQUIRE we have at least one list and play with that
			
			
			//tasklistAdd
			let newList = await backend.tasklistAdd('Abcd');
			tasklists = await backend.tasklistList();
			expect(tasklists.length).toBe(1);
			expect(tasklists[0].title).toStrictEqual('Abcd');
			
			//tasklistAdd
			newList = await backend.tasklistAdd('Test list 2');
			tasklists = await backend.tasklistList();
			expect(tasklists.length).toBe(2);
			expect(tasklists[1].title).toStrictEqual('Test list 2');
			
			if (backend.tasklistUpdate) {
				//tasklistUpdate
				tasklists[0].title = '1abcd1';
				let result = await backend.tasklistUpdate(tasklists[0]);
				expect(result).toStrictEqual(tasklists[0]);
				
				let tasklist = await backend.tasklistGet(tasklists[0].id);
				expect(tasklist).toStrictEqual(tasklists[0]);
				
				//tasklistPatch
				tasklists[0].title = '2abcd2';
				try {
					await backend.tasklistPatch({ 'title': tasklists[0].title });
					expect(false).toBe(true); //should not reach here
				} catch {}
				result = await backend.tasklistPatch({ 'id': tasklists[0].id, 'title': tasklists[0].title });
				expect(result).toStrictEqual(tasklists[0]);
				
				tasklist = await backend.tasklistGet(tasklists[0].id);
				expect(tasklist).toStrictEqual(tasklists[0]);
				
				//List returns the same
				let tasklists2 = await backend.tasklistList();
				expect(tasklists2.length).toBe(2);
				expect(tasklists2).toStrictEqual(tasklists);
			}
			//Otherwise leave as it was
			
			//tasklistGet alone, anyways
			let tasklist = await backend.tasklistGet(tasklists[0].id);
			expect(tasklist).toStrictEqual(tasklists[0]);
			
			//tasklistDelete
			if (backend.tasklistAdd && backend.tasklistDelete) {
				await backend.tasklistDelete(tasklists[0].id);
				
				let tasklists2 = await backend.tasklistList();
				expect(tasklists2.length).toBe(1);
				expect(tasklists2[0]).toStrictEqual(tasklists[1]);
			}
		});
		
		
		//insert() -- before list() because list() may already use insert() to produce non-empty list specimen
		test('insert', async() => {
			if (!backend.insert) return; //Nothing to test
			
			let listId = await newEmptyTasklist();
			
			//Simple insert
			let task1 = await backend.insert(TEST_TASK1, null, listId);
			expect(task1.id).toBeTruthy();
			verifyTask1(task1);
			
			let task2 = await backend.insert(TEST_TASK2, null, listId);
			expect(task2.id).toBeTruthy();
			verifyTask2(task2);
			
			//Let's see if get() gets us the same thing
			//get() is not yet tested so stick to basics
			let task1_copy = await backend.get(task1.id, listId);
			expect(task1_copy).toMatchObject(task1);
			
			//Let's see if list() gets us both tasks -- again, stick to the basics
			let list2 = await backend.list(listId);
			expect(list2.length).toBe(2);
			Tasks.sort(list2);
			expect(list2[0]).toMatchObject(task2); //parent==null => added to the top
			expect(list2[1]).toMatchObject(task1);
			
			//Pass wrong tasklist/previous ids
			expect(async() => { await backend.insert(TEST_TASK2, null, 'clearly wrong tasklist ID'); }).toThrow();
			expect(async() => { await backend.insert(TEST_TASK2, 'clearly wrong previousId', listId); }).toThrow();
			//Parent id
			let task2_proto = Object.assign({}, TEST_TASK2);
			task2_proto.parent = 'clearly wrong parentId';
			expect(async() => { await backend.insert(task2_proto, null, listId); }).toThrow();
			
			//Not testing parent/previousId in full here, happens in move()
			//Not testing the consistency of status/completedDate, it's not super important
		});
		
		//Can happen later but can also happen now
		test('insertMultiple', async() => {
			if (!backend.insert) return; //Nothing to test
			
			let listId = await newEmptyTasklist();
			
			//Just a very simple test
			let task1_proto = TEST_TASK1;
			let task2_proto = TEST_TASK2;
			let task3_proto = TEST_TASK3;
			let results = await backend.insertMultiple({
				'myId1': task1_proto,
				'myId2': task2_proto,
				'myId3': task3_proto,
			}, listId);
			expect(Object.keys(results).length).toBe(3);
			expect(results['myId1'].id).toBeTruthy();
			expect(results['myId2'].id).toBeTruthy();
			expect(results['myId3'].id).toBeTruthy();
			verifyTask1(results['myId1']);
			verifyTask2(results['myId2']);
			verifyTask3(results['myId3']);
			
			//Not testing parent/previousId here, happens in move()
			
			//Inserting nothing should still work
			results = await backend.insertMultiple({}, listId);
			expect(Object.keys(results).length).toBe(0);
			
			//Wrong IDs
			expect(async() => { await backend.insertMultiple({}, 'clearly wrong tasklist ID'); }).toThrow();
		});
		
		
		//list() -- uses insert()
		test('list', async() => {
			//list() is required so not checking for presence
			
			//Empty list
			let listId = await newEmptyTasklist();
			let tasks = await backend.list(listId);
			expect(tasks).toStrictEqual([]);
			
			//List with data
			let list2Id = await newDemoTasklist();
			let tasks2 = await backend.list(list2Id);
			expect(tasks2.length).toBe(3);
			//Sort by title so that we have an idea of what's in what position
			tasks2.sort((a, b) => { return a.title.localeCompare(b.title); });
			verifyTask1(tasks2[0]);
			verifyTask2(tasks2[1]);
			verifyTask3(tasks2[2]);
		});
		
		test('delete', async() => {
			if (!backend.delete) return; //Nothing to test
			//If we don't have insert() we can only run minimal tests on the precreated list
			
			let listId = await newDemoTasklist();
			
			//delete(nothing) should succeed and change nothing
			expect(async() => { await backend.delete([], listId); }).not.toThrow();
			//Null may or may not work, won't test
			
			let tasks = await backend.list(listId);
			expect(tasks.length).toBe(3);
			tasks.sort((a, b) => { return a.title.localeCompare(b.title); });
			
			//Delete a single task
			expect(async() => { await backend.delete(tasks[2].id, listId); }).not.toThrow();
			//Check the list again
			tasks = await backend.list(listId);
			expect(tasks.length).toBe(2);
			tasks.sort((a, b) => { return a.title.localeCompare(b.title); });
			verifyTask1(tasks[0]);
			verifyTask3(tasks[1]);
			
			//Deleting a parent without deleting its child is undefined for now, won't test
			
			//delete(Task object)
			expect(async() => { await backend.delete(tasks[2], listId); }).not.toThrow();
			tasks = await backend.list(listId);
			expect(tasks.length).toBe(1);
			verifyTask1(tasks[0]);
			
			//delete(multiple)
			expect(async() => { await backend.delete([tasks[0]], listId); }).not.toThrow();
			tasks = await backend.list(listId);
			expect(tasks.length).toBe(0);
			
			//Wrong IDs
			expect(async() => { await backend.delete([], 'clearly wrong tasklist ID'); }).toThrow();
			expect(async() => { await backend.delete(['clearly wrong task ID'], listId); }).toThrow();
			
			//We've exhausted things we can delete, need another test
			//Not testing deleteWithChildren(), that'll happen after caching
		});
		
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
		
		test('deleteWithChildren', async () => {
			if (!backend.delete) return; //Nothing to test
			
			let listId = await newDemoTasklist();
			
			//deleteWithChildren needs caching
			let tasks = await backend.selectTaskList(listId);
			
			//delete(nothing) should succeed and change nothing
			expect(async() => { await backend.deleteWithChildren([], listId); }).not.toThrow();
			//Null may or may not work, won't test
			
			//Requery the list, in case empty deletes() broke something
			tasks = await backend.list(listId);
			expect(tasks.length).toBe(3);
			tasks.sort((a, b) => { return a.title.localeCompare(b.title); });
			
			//Delete 1->3
			expect(async() => { await backend.deleteWithChildren(tasks[0].id, listId); }).not.toThrow();
			tasks = await backend.list(listId);
			expect(tasks.length).toBe(1);
			verifyTask2(tasks[0]);
			
			//deleteWithChildren(object) + deleteWithChildren(multiple) in the same test
			expect(async() => { await backend.deleteWithChildren([tasks[0]], listId); }).not.toThrow();
			tasks = await backend.list(listId);
			expect(tasks.length).toBe(0);
			
			//Wrong IDs
			expect(async() => { await backend.deleteWithChildren([], 'clearly wrong tasklist ID'); }).toThrow();
			expect(async() => { await backend.deleteWithChildren(['clearly wrong task ID'], listId); }).toThrow();
		});
	});
}

testBackend(BackendSessionStorage);
testBackend(BackendLocalStorage);
//browser.storage.* is unavailable and otherwise it's ~= BackendLocalStorage
//testBackend(BackendBrowserStorageSync);
//testBackend(BackendBrowserStorageLocal);
