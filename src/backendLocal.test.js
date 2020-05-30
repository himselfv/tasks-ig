
import * as imp1 from './utils.js';
imp1.importAll(imp1);
import * as imp2 from './backend.js';
importAll(imp2);
import * as imp3 from './backendLocal.js';
importAll(imp3);

function testBackend(backendCtor) {
	describe(backendCtor.name, () => {
		test('init', () => {
			let backend = new BackendSessionStorage();
			expect(backend.isSignedIn()).toBe(false);
		});
	});
}

testBackend(BackendSessionStorage);