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
One instance of Tester will be created for every test_* function.
Override to personalize Tester for your purposes.
*/
function Tester(params) {
}
exports.Tester = Tester;

//Use this for additional async initialization
Tester.prototype.init = async function() {
}

//This is a CLASS function -- can be called on an uninitialized backendTester
Tester.prototype.getAllTests = function() {
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

//Class function. Expects params to pass to testerCtor
Tester.run = function(testerCtor, params) {
	describe(testerCtor.name, () => {
		let tester = null;
		
		beforeEach(async () => {
			tester = new testerCtor(params);
			await tester.init();
		});
		
		//Create a fake non-initialized object to call class method getAllTests
		let proto = Object.create(testerCtor.prototype);
		let tests = proto.getAllTests();
		
		//Create tests for all prototype methods
		for (let name in tests) {
			let thisTest = tests[name]; //before we edit name
			if (name.startsWith('test_'))
				name = name.slice(5);
			test(name, () => thisTest.call(tester) );
		}
	});
}
