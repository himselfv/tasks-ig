import * as utils from 'utils.js';
utils.importAll(utils);
import * as backendLocalJs from 'backendLocal.js';
import { Tester } from 'jest-utils.js';
import { BackendTester } from 'backend.test.js';

function BackendLocalStorageTester(params) {
	BackendTester.call(this, params);
}
inherit(BackendTester, BackendLocalStorageTester);
BackendLocalStorageTester.prototype.init = async function() {
	BackendTester.prototype.init.call(this);
	//Each tests gets its own namespace (they can run in parallel)
	this.backend.STORAGE_PREFIX = 'tasksIg_backend_'+utils.newGuid().slice(0,8)+'_';
	//reset() just in case
	await this.backend.reset();
}

Tester.run(BackendLocalStorageTester, {'ctor': backendLocalJs.BackendSessionStorage});
Tester.run(BackendLocalStorageTester, {'ctor': backendLocalJs.BackendLocalStorage});
//browser.storage.* is unavailable and otherwise it's ~= BackendLocalStorage
//Tester.run(BackendLocalStorageTester, backendLocalJs.BackendBrowserStorageSync);
//Tester.ru(BackendLocalStorageTester, backendLocalJs.BackendBrowserStorageLocal);
