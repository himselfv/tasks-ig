/*
Various testing backends. Do not include unless you want these.
*/
'use strict';
if (typeof require != 'undefined') {
	require('./utils.js').importSelf();
	importAll(require('./backend.js'));
	importAll(require('./backendLocal.js'));
}
var unit = new Unit((typeof exports != 'undefined') && exports);


function BackendTestBase() {
	Backend.call(this);
}
inheritBackend(Backend, BackendTestBase);
unit.export(BackendTestBase);
//Minimal implementation
BackendTestBase.prototype.tasklistList = function() {
	return Promise.resolve([]);
}

function newTestBackend(baseBackend, newBackend, uiName) {
	if (!options.debug) return; //Without .debug, skip registering these even if the file is included
	inheritBackend(baseBackend, newBackend);
	registerBackend(newBackend, uiName);
	unit.export(newBackend);
}


//Fails init() SOMETIMES.
//SOMETIMES is important, otherwise you'll never be able to even add it (to try what happens when an existing account fails)
function BackendFailInit() {
	BackendTestBase.call(this);
}
newTestBackend(BackendTestBase, BackendFailInit, "Fail init");
BackendFailInit.prototype.init = function() {
	if (Math.random() < 0.5)
		return Promise.reject("Sorry but I failed init()");
	return Promise.resolve();
}


//Never returns from init() promise, SOMETIMES
function BackendNeverInit() {
	BackendTestBase.call(this);
}
newTestBackend(BackendTestBase, BackendNeverInit, "Never init");
BackendNeverInit.prototype.init = function() {
	if (Math.random() < 0.5)
		return new Promise(resolve => {}); //just never return
	return Promise.resolve();
}


//Takes a while to init()
function BackendLongInit() {
	BackendTestBase.call(this);
}
newTestBackend(BackendTestBase, BackendLongInit, "Long init");
BackendLongInit.prototype.init = function() {
	return new Promise(resolve => setTimeout(resolve, 5000));
}


//Tries to load non-existing scripts, should gracefully fail
function BackendFailLoadScripts() {
	BackendTestBase.call(this);
}
newTestBackend(BackendTestBase, BackendFailLoadScripts, "Fail load scripts");
BackendFailLoadScripts.prototype.init = function() {
	return loadScripts({'nonexistingScript': 'nonexistingScript.js'});
}


//Fails signout()
function BackendFailSignout() {
	BackendTestBase.call(this);
}
newTestBackend(BackendTestBase, BackendFailSignout, "Fail sign-out");
BackendFailSignout.prototype.signout = function() {
	return Promise.reject('Sorry, I failed signout');
}



//Loads, but disconnects after a while by itself
function BackendDisconnectsAfterAWhile() {
	BackendTestBase.call(this);
}
newTestBackend(BackendTestBase, BackendDisconnectsAfterAWhile, "Disconnect after a while");
BackendDisconnectsAfterAWhile.prototype.init = function() {
	setTimeout(() => this.signout.bind(this), 5000);
	return Promise.resolve();
}


//Does not register SOMETIMES. Allows you to create an account and then to refresh and discover that its backend has vanished.
if (Math.random() < 0.5) {
	console.log('registered');
	function BackendDoesNotRegister() {
		BackendTestBase.call(this);
	}
	newTestBackend(BackendTestBase, BackendDoesNotRegister, "Does not register");
}


//Presents a lot of settings
function BackendSettingsTest() {
	BackendTestBase.call(this);
}
newTestBackend(BackendTestBase, BackendSettingsTest, "Settings test");
/*
		title: 'Login';	//Optional, default: param id
		hint: null;		//Optional hint
		type: 'text'/'password'/'number'/'bool'/['list', 'of', 'choices']
		default: value;
*/
BackendSettingsTest.prototype.settingsPage = function() {
	return	{
		textTest: { type: 'text', },
		passwordTest: { type: 'password', },
		numberTest: { type: 'number', },
		boolTest: { type: 'bool', },
		listTest: { type: ['Option 1', 'Option 2', 'Option 3'], },
		customTitleTest: { type: 'text', title: 'Custom title', },
		defaultTextTest: { type: 'text', default: 'default text value', },
		defaultPasswordTest: { type: 'password', default: 'default password value', },
		defaultNumberValue: { type: 'number', default: 1234, },
		defaultBoolValue: { type: 'bool', default: true, },
		defaultListValue: { type: ['Option 1', 'Option 2', 'Option 3'], default: 'Option 2', },
		descTest: { type: 'text', hint: 'Setting description, can contain <b>HTML</b> <i>tags</i>.', },
		noneTypeTest: { title: '', hint: 'Null types should have no input fields, only show the title and the description. '
			+'The default value should still be passed.', default: 'noneTypeTestDefaultValue', },
		actuallySignin: {
			type: 'bool',
			hint: 'Set this to true for the backend to accept your signin',
		},
	};
}
BackendSettingsTest.prototype.signin = function(params) {
	console.log('BackendSettingsTest.signin:', params);
	if (!params || !params.actuallySignin) {
		console.log('no');
		return Promise.reject("BackendSettingsTest: Values passed to signin() are available in the console. Set 'actuallySignin' to true to sign in.");
	}
	return this.__proto__.__proto__.signin.call(this, params);
}


//BackendLocalStorage, but read-only
function BackendLocalStorageRO() {
	BackendLocalStorage.call(this);
}
newTestBackend(BackendLocalStorage, BackendLocalStorageRO, "Local Storage (RO)");
BackendLocalStorageRO.prototype.reset = null;
BackendLocalStorageRO.prototype.update = null;
BackendLocalStorageRO.prototype.insert = null;
BackendLocalStorageRO.prototype.delete = null;
BackendLocalStorageRO.prototype._moveOne = null;
BackendLocalStorageRO.prototype.moveToList = null;
BackendLocalStorageRO.prototype.tasklistAdd = null;
BackendLocalStorageRO.prototype.tasklistUpdate = null;
BackendLocalStorageRO.prototype.tasklistDelete = null;


//BackendLocalStorage, read-only but pretends to insert()/update()/delete() etc and fails
function BackendFailEverything() {
	BackendLocalStorageRO.call(this);
}
newTestBackend(BackendLocalStorageRO, BackendFailEverything, "Fail everything");
BackendFailEverything.prototype._fail = function() {
	return Promise.reject('Backend tried but failed');
}
BackendFailEverything.prototype.reset = BackendFailEverything.prototype._fail;
BackendFailEverything.prototype.update = BackendFailEverything.prototype._fail;
BackendFailEverything.prototype.insert = BackendFailEverything.prototype._fail;
BackendFailEverything.prototype.delete = BackendFailEverything.prototype._fail;
BackendFailEverything.prototype._moveOne = BackendFailEverything.prototype._fail;
BackendFailEverything.prototype.moveToList = BackendFailEverything.prototype._fail;
BackendFailEverything.prototype.tasklistAdd = BackendFailEverything.prototype._fail;
BackendFailEverything.prototype.tasklistUpdate = BackendFailEverything.prototype._fail;
BackendFailEverything.prototype.tasklistDelete = BackendFailEverything.prototype._fail;


//This is a weird backend that works over Local Storage but delete() just sets the "deleted" flag (like GTasks does)
//These tasks should still be invisible, but they will remain in LocalStorage until you enable showing deleted tasks
//and manually delete them
function BackendTestDeletedFlag() {
	BackendLocalStorage.call(this);
}
newTestBackend(BackendLocalStorage, BackendTestDeletedFlag, "Test deleted flag");
BackendTestDeletedFlag.prototype.delete = function(taskIds, tasklistId) {
	taskIds = toTaskIds(taskIds);
	
	let batch = [];
	for (let taskId of taskIds)
		batch.push(this.patch({ id: taskId, deleted: true, }));
	return Promise.all(batch);
}
