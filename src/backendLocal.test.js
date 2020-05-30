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
			if (backend.tasklistDelete) {
				await backend.tasklistDelete(tasklists[0].id);
				
				let tasklists2 = await backend.tasklistList();
				expect(tasklists2.length).toBe(1);
				expect(tasklists2[0]).toStrictEqual(tasklists[1]);
			}
			
		});
		
	});
}

testBackend(BackendSessionStorage);
testBackend(BackendLocalStorage);

//browser.storage.* is unavailable and otherwise it's ~= BackendLocalStorage
//testBackend(BackendBrowserStorageSync);
//testBackend(BackendBrowserStorageLocal);
