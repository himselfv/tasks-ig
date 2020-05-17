/*
Various testing backends. Do not include unless you want these.
*/

function BackendTestBase() {
	Backend.call(this);
}
inheritBackend(Backend, BackendTestBase);
//Minimal implementation
BackendTestBase.prototype.tasklistList = function() {
	return Promise.resolve([]);
}

function newTestBackend(baseBackend, newBackend, uiName) {
	if (!options.debug) return; //Without .debug, skip registering these even if the file is included
	inheritBackend(baseBackend, newBackend);
	registerBackend(newBackend, uiName);
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


//Takes a while to signin()
function BackendLongSignin() {
	BackendTestBase.call(this);
}
newTestBackend(BackendTestBase, BackendLongSignin, "Long sign-in");
BackendLongSignin.prototype.init = function() {
	return new Promise(resolve => setTimeout(resolve, 5000));
}


//Loads, but disconnects after a while by itself
function BackendDisconnectsAfterAWhile() {
	BackendTestBase.call(this);
}
newTestBackend(BackendTestBase, BackendDisconnectsAfterAWhile, "Disconnect after a while");
BackendDisconnectsAfterAWhile.prototype.init = function() {
	setTimeout(() => { this.signout(); }, 5000);
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
