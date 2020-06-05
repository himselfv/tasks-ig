import * as utils from 'utils.js';
utils.importAll(utils);
import * as backendDavJs from 'backendDav.js';
import { Tester } from 'jest-utils.js';
import { BackendTester } from 'backend.test.js';

/*
For this test to run you must set environment variables:
  DAV_SERVER
  DAV_USERNAME
  DAV_PASSWORD
WARNING. All content of the task lists of this user will be deleted.
*/
let haveDavServer = (!!process.env.DAV_SERVER || !!process.env.DAV_USERNAME);
if (!haveDavServer) {
	console.warning(
		"For BackendDav tests to run you must provide a disposable DAV account.\n"
		+"Set environment variables:\n"
		+"  DAV_SERVER\n"
		+"  DAV_USERNAME\n"
		+"  DAV_PASSWORD\n"
		+"WARNING! All content belonging to this DAV account will be lost"
	);
}
test('haveDavServer', () => {
	//Verify that we have a disposable DAV account
	expect(haveDavServer).toBe(true);
});


function BackendDav() {
	backendDavJs.BackendDav.call(this);
}
inherit(backendDavJs.BackendDav, BackendDav);
//Have to override loading scripts which would have been HTML/dynamic
BackendDav.prototype.connect = function() {
	global['dav'] = require('dav/dav.js');
	global['ICAL'] = null; /* or ical.js won't parse */
	ICAL = require('dav/ical.js');
	return Promise.resolve();
}

function BackendDavTester(params) {
	BackendTester.call(this, params);
}
inherit(BackendTester, BackendDavTester);
BackendDavTester.prototype.init = async function() {
	Tester.prototype.init.call(this);
	this.backend = new this.backendCtor();
	expect(this.backend.isSignedIn()).toBe(false);
	await this.backend.init();
	await this.backend.signin({ server: process.env.DAV_SERVER, username: process.env.DAV_USERNAME, password: process.env.DAV_PASSWORD, });
	expect(this.backend.isSignedIn()).toBe(true);
	
	//Restock and clean all task lists
	this._tasklistStock = await this.backend.tasklistList();
	expect(this._tasklistStock).toBeArray();
	for (let list of this._tasklistStock) {
		let items = await this.backend.list(list.id);
		expect(items).toBeArray();
		if (items.length>0)
			await expect(() => this.backend.delete(items, list.id)).not.toFail();
	}
}

if(haveDavServer)
	Tester.run(BackendDavTester, {'ctor': BackendDav});
