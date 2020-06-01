import * as utils from 'utils.js';
utils.importAll(utils);
import * as backendGtJs from 'backendGt.js';
import { Tester } from 'jest-utils.js';
import { BackendTester } from 'backend.test.js';
import { BackendSessionStorage } from 'backendLocal.js';

/*
Every GAPI response contains
	status: HTTP status
	error:	-- on error
	result:	-- on success
Batch requests contain:
	result:  [array of GAPI_responses]
Ex. response.result[1].status, response.result[1].result
*/
function gapiWrapError(error) {
	return {
		"status": 503,
		"error": error,
	};
}
//Service fields should not be important in processing but let's replicate them to an extent
function gapiAddServiceFields(result, kind) {
	result.kind = kind;
	result.etag = "1234baka"; //Entries have etags but we don't care
	result.selfLink = "linkSelf"; // --//--
}
/*
Accepts a promise.
Wraps the results as GAPI would, auto-detecting their type. Also wraps the errors
Returns a promise.
*/
function gapiWrap(prom, kind) {
	return prom
	.then(result => {
		let wrappedResult = result;
		if (Array.isArray(result)) {
			wrappedResult = {};
			wrappedResult.items = result;
		}
		if (typeof result == 'object') { //including our custom one
			//enhance the result itself
			gapiAddServiceFields(wrappedResult, kind);
		} //otherwise it's null or undefined or something
		//console.log('wrap: ', result, wrappedResult);
		return {
			"status": 200,
			"result": wrappedResult,
		};
	})
	.catch(error => gapiWrapError(error));
}


//Mock GAPI
function MockGAPI() {
	this.client = new MockGAPIClient(this);
	this.client.tasks = {};
	this.client.tasks.tasklists = new MockGAPITasklists(this);
	this.client.tasks.tasks = new MockGAPITasks(this);
	this.jobs = new JobQueue();
}
//Completes the initialization asynchronously. Normally forward from mockGapi.client.init() which is called by backends
MockGAPI.prototype.init = async function() {
	//Use a session storage backend for mock gapi
	this.backend = new BackendSessionStorage();
	this.backend.STORAGE_PREFIX = 'test_backend_'+utils.newGuid().slice(0,8)+'_';
	await this.backend.init();
	await this.backend.reset();
}
//Serializes the job via the job queue to avoid concurrency issues (GTasks operations are atomic)
//and converts the return results to GTasks standard
//Make sure to pass a function. If you pass a promise then you have already started the operation in parallel
MockGAPI.prototype.wrap = function(fn, kind) {
	return gapiWrap(this.jobs.push(this.jobs.waitCurrentJobsCompleted().then(() => fn())), kind);
}

/*
gapi.client.newBatch
	batch.add, batch.then
This implementation is somewhat flawed because gtasks.batch() is a full blown promise and this is not.
*/
function MockGAPIBatch() {
	this.batch = {};
}
MockGAPIBatch.prototype.add = function(prom, params) {
	if (params && params.id)
		this.batch[params.id] = prom;
	else
		this.batch[Object.keys(this.batch).length] = prom;
}
MockGAPIBatch.prototype.then = function(fn) {
	//Promise.all is suboptimal because it fails at first error
	//while gapi.batch collects all errors and successes
	//Implement as a simple chain
	
	let response = {
		result: {}
	};
	let prom = Promise.resolve()
	for (let key in this.batch) {
		prom = prom.then(() => this.batch[key])
		.then(result => {
			response.result[key] = result;
		})
		.catch(error => {
			response.result[key] = error; //Not sure what to do here
		})
	}
	
	return prom.then(() => fn(response));
}

function MockGAPIClient(gapi) {
	this.gapi = gapi;
}
MockGAPIClient.prototype.init = async function() {
	return this.gapi.init();
}
MockGAPIClient.prototype.newBatch = function() {
	return new MockGAPIBatch();
}

/*
gapi.client.tasks:
	.tasklists.list
	.tasklists.insert
	.tasklists.get
	.tasklists.update
	.tasklists.delete
*/
function MockGAPITasklists(gapi) {
	this.gapi = gapi;
}
MockGAPITasklists.prototype.TasklistResourceFields =
	["kind", "id", "etag", "title", "updated", "selfLink"];
MockGAPITasklists.prototype.list = function(params) {
	expect(['maxResults','pageToken']).toEqual(expect.arrayContaining(Object.keys(params)));
	return this.gapi.wrap(() =>
		this.gapi.backend.tasklistList()
		.then(items => { //Add kind/etag to every tasklist entry
			for (let i in items)
				gapiAddServiceFields(items[i], "tasks#taskList");
			return items;
		}), "tasks#taskLists");
}
MockGAPITasklists.prototype.get = function(params) {
	expect(['tasklist']).toEqual(expect.arrayContaining(Object.keys(params)));
	expect(params.tasklist).toBeDefined();
	expect(Array.isArray(params.tasklist)).toBe(false);
	return this.gapi.wrap(() => this.gapi.backend.tasklistGet(params.tasklist), "tasks#taskList");
}
MockGAPITasklists.prototype.insert = function(params) {
	expect(['resource']).toEqual(expect.arrayContaining(Object.keys(params)));
	expect(this.TasklistResourceFields).toEqual(expect.arrayContaining(Object.keys(params.resource)));
	expect(params.resource).toBeDefined();
	expect(params.resource.title).toBeDefined();
	return this.gapi.wrap(() => this.gapi.backend.tasklistAdd(params.resource.title), "tasks#taskList");
}
MockGAPITasklists.prototype.update = function(params) {
	expect(['tasklist', 'resource']).toEqual(expect.arrayContaining(Object.keys(params)));
	expect(this.TasklistResourceFields).toEqual(expect.arrayContaining(Object.keys(params.resource)));
	expect(params.tasklist).toBeDefined();
	expect(params.resource).toBeDefined();
	expect(params.resource.id).toBeDefined();
	return this.gapi.wrap(() => this.gapi.backend.tasklistUpdate(params.resource, params.tasklist), "tasks#taskList");
}
MockGAPITasklists.prototype.patch = function(params) {
	expect(['tasklist', 'resource']).toEqual(expect.arrayContaining(Object.keys(params)));
	expect(this.TasklistResourceFields).toEqual(expect.arrayContaining(Object.keys(params.resource)));
	expect(params.tasklist).toBeDefined();
	expect(params.resource).toBeDefined();
	expect(params.resource.id).toBeDefined();
	return this.gapi.wrap(() => this.gapi.backend.tasklistPatch(params.resource, params.tasklist), "tasks#taskList");
}
MockGAPITasklists.prototype.delete = function(params) {
	expect(['tasklist']).toEqual(expect.arrayContaining(Object.keys(params)));
	expect(params.tasklist).toBeDefined();
	return this.gapi.wrap(() => this.gapi.backend.tasklistDelete(params.tasklist));
}


/*
gapi.client.tasks:
	.tasks.list  -- incl.paged -- add test
	.tasks.get
	.tasks.update
	.tasks.insert
	.tasks.delete
	.tasks.move
*/
function MockGAPITasks(gapi) {
	this.gapi = gapi;
}
MockGAPITasks.prototype.verifyResource = function(resource) {
	expect(backendGtJs.BackendGTasks.prototype.TASK_FIELDS).toEqual(expect.arrayContaining(Object.keys(resource)));
}
MockGAPITasks.prototype.list = function(params) {
	console.log('MockGAPITasks.lists', params);
	expect(['tasklist','maxResults','pageToken','fields','showCompleted','showDeleted','showHidden',])
		.toEqual(expect.arrayContaining(Object.keys(params)));
	expect(params.tasklist).toBeDefined();
	return this.gapi.wrap(() => this.gapi.backend.list(params.tasklist), "tasks#tasks")
	.then(response => {
		console.log('MockGAPITasks.response', response);
		if (response.result) {
			//Add kind/etag to every task entry
			for (let i in response.result.items)
				gapiAddServiceFields(response.result.items[i], "tasks#task");
		}
		return response;
	});
}
MockGAPITasks.prototype.get = function(params) {
	expect(['tasklist','task']).toEqual(expect.arrayContaining(Object.keys(params)));
	expect(params.tasklist).toBeDefined();
	expect(params.task).toBeDefined();
	expect(Array.isArray(params.task)).toBe(false);
	return this.gapi.wrap(() => this.gapi.backend.get(params.task, params.tasklist), "tasks#task");
}
MockGAPITasks.prototype.insert = function(params) {
	expect(['tasklist','parent','previous','resource']).toEqual(expect.arrayContaining(Object.keys(params)));
	expect(params.tasklist).toBeDefined();
	expect(params.resource).toBeDefined();
	this.verifyResource(params.resource);
	return this.gapi.wrap(() => this.gapi.backend.insert(params.resource, params.previous, params.tasklist), "tasks#task");
}
MockGAPITasks.prototype.update = function(params) {
	expect(['tasklist','task','resource']).toEqual(expect.arrayContaining(Object.keys(params)));
	expect(params.tasklist).toBeDefined();
	expect(params.task).toBeDefined();
	expect(params.resource).toBeDefined();
	this.verifyResource(params.resource);
	return this.gapi.wrap(() => this.gapi.backend.update(params.resource, params.tasklist), "tasks#task");
}
MockGAPITasks.prototype.patch = function(params) {
	expect(['tasklist','task','resource']).toEqual(expect.arrayContaining(Object.keys(params)));
	expect(params.tasklist).toBeDefined();
	expect(params.task).toBeDefined();
	expect(params.resource).toBeDefined();
	this.verifyResource(params.resource);
	return this.gapi.wrap(() => this.gapi.backend.patch(params.resource, params.tasklist), "tasks#task");
}
MockGAPITasks.prototype.delete = function(params) {
	expect(['tasklist','task']).toEqual(expect.arrayContaining(Object.keys(params)));
	expect(params.tasklist).toBeDefined();
	expect(params.task).toBeDefined();
	return this.gapi.wrap(() => this.gapi.backend.delete(params.task, params.tasklist), "");
}
MockGAPITasks.prototype.move = function(params) {
	expect(['tasklist','task','parent','previous']).toEqual(expect.arrayContaining(Object.keys(params)));
	expect(params.tasklist).toBeDefined();
	expect(params.task).toBeDefined();
	return this.gapi.wrap(() => this.gapi.backend.move(params.task, params.parent, params.previous, params.tasklist), "tasks#task");
}



//Innit APIs are too complicated and have binary chrome/non-chrome versions
//so ATM just blank them out in BackendGt instead of mocks: 
// gapi.load
// gapi.client.init
// gapi.auth2.getAuthInstance():
//   .isSignedIn.listen
//   .signIn()
//   .signOut()
//   .isSignedIn.get()
//   .currentUser.get().getBasicProfile().getEmail()


function BackendGTasks() {
	backendGtJs.BackendGTasks.apply(this, arguments);
	this.gapi = new MockGAPI();
}
inherit(backendGtJs.BackendGTasks, BackendGTasks);

BackendGTasks.prototype.init = async function() {
	return await this.gapi.client.init(); //mock gapi init
}
BackendGTasks.prototype.clientLogin = async function() {}
BackendGTasks.prototype.signin = async function() {
	this._initialized = true;
	this.notifySignInStatus(true);
}
BackendGTasks.prototype.signout = function() {
	this.notifySignInStatus(false);
}
BackendGTasks.prototype.notifySignInStatus = function(status) {
	this._signedIn = status;
	backendGtJs.BackendGTasks.apply(this, arguments);
}
BackendGTasks.prototype.isSignedIn = function() {
	return this._signedIn || false;
}
BackendGTasks.prototype.getUserEmail = function() {
	return "no@email";
}


function BackendGTasksTester(params) {
	BackendTester.call(this, params);
}
inherit(BackendTester, BackendGTasksTester);
/*BackendGTasksTester.prototype.init = async function() {
	//BackendGt needs a special initialization
	Tester.prototype.init.call(this);
	this.backend = new this.backendCtor();
	expect(this.backend.isSignedIn()).toBe(false);
	
	//Replace a few functions with mockups
	this.backend.prototype.init = function()

	await this.backend.init();
	await this.backend.signin();
	expect(this.backend.isSignedIn()).toBe(true);
}*/

Tester.run(BackendGTasksTester, {'ctor': BackendGTasks});
