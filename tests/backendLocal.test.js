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
	//LocalStorage works cleaner with reset() between tests
	await this.backend.reset();
}

Tester.run(BackendLocalStorageTester, {'ctor': backendLocalJs.BackendSessionStorage});
Tester.run(BackendLocalStorageTester, {'ctor': backendLocalJs.BackendLocalStorage});
//browser.storage.* is unavailable and otherwise it's ~= BackendLocalStorage
//Tester.run(BackendLocalStorageTester, backendLocalJs.BackendBrowserStorageSync);
//Tester.ru(BackendLocalStorageTester, backendLocalJs.BackendBrowserStorageLocal);
