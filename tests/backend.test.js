import * as backendJs from 'backend.js'
for (let key in backendJs)
	global[key] = backendJs[key];

test('toArray', () => {
	expect(toArray(undefined)).toBe(undefined);
	expect(toArray(null)).toBe(null);
	expect(toArray([])).toStrictEqual([]);
	expect(toArray(10)).toStrictEqual([10]);
	expect(toArray("abcd")).toStrictEqual(["abcd"]);
	expect(toArray([10])).toStrictEqual([10]);
	expect(toArray([10,20])).toStrictEqual([10,20]);
});

test('toTaskIds', () => {
	let task1 = { id: 10, };
	let task2 = { id: "asdbsd", };
	expect(toTaskIds(task1)).toStrictEqual([task1.id]);
	expect(toTaskIds([task1,task2])).toStrictEqual([task1.id,task2.id]);
});

test('toTaskId', () => {
	expect(toTaskId(undefined)).toBe(undefined);
	expect(toTaskId(null)).toBe(null);
	expect(toTaskId(10)).toBe(10);
	expect(toTaskId("abcd")).toBe("abcd");
	expect(toTaskId({id:10})).toBe(10);
	expect(toTaskId({id:"abcd"})).toBe("abcd");
});

test('isEmpty', () => {
	expect(isEmpty(undefined)).toBe(true);
	expect(isEmpty(null)).toBe(true);
	expect(isEmpty([])).toBe(true);
	expect(isEmpty({})).toBe(true);
	expect(isEmpty([10])).toBe(false);
	expect(isEmpty({"asd": 10})).toBe(false);
	//Not supported on non-null, non-array inputs
});

test('isArraEmpty', () => {
	expect(isArrayEmpty(undefined)).toBe(true);
	expect(isArrayEmpty(null)).toBe(true);
	expect(isArrayEmpty([])).toBe(true);
	expect(isArrayEmpty([10])).toBe(false);
	//Not supported on non-null, non-array inputs
	expect(() => {backendJs.isArrayEmpty({})}).toThrow();
	expect(() => {backendJs.isArrayEmpty({"asd": 10})}).toThrow();
	expect(() => {backendJs.isArrayEmpty(10)}).toThrow();
	expect(() => {backendJs.isArrayEmpty("asd")}).toThrow();
});

test('diffDict', () => {
	expect(diffDict({}, {})).toStrictEqual({});
	expect(diffDict({'a': 1}, {'a': 1})).toStrictEqual({});
	expect(diffDict({'a': 'abcd'}, {'a': 'abcd'})).toStrictEqual({});
	//This never worked but eventually needs to:
	//expect(diffDict({'a': undefined}, {'a': undefined})).toStrictEqual({});
	//expect(diffDict({'a': null}, {'a': null})).toStrictEqual({});
	//Order is not important
	expect(diffDict({'a': 1, 'b': 2}, {'b': 2, 'a': 1})).toStrictEqual({});
	//Changes
	expect(diffDict({'a': 'abcd', 'b': 1}, {'a': 'abcd', 'b': 2})).toStrictEqual({'b': {'oldValue': 1, 'newValue': 2}});
	//Deletions
	expect(diffDict({'a': 'abcd', 'b': 1}, {'a': 'abcd'})).toStrictEqual({'b': {'oldValue': 1, 'newValue': undefined}});
	//Additions
	expect(diffDict({'a': 'abcd'}, {'a': 'abcd', 'b': 2})).toStrictEqual({'b': {'oldValue': undefined, 'newValue': 2}});
});

//Tasks.sort
//Tasks.dict
//Callback
//TaskCache
//Backend
//DummyBackend