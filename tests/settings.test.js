import * as utils from 'utils.js';
utils.importAll(utils);
import * as jestUtils from 'jest-utils.js';
importAll(jestUtils);

//Runs a standalone setting page test. If you're doing this from another test, call testSettingsPage
function testSettings(page, name) {
	test(name, () => {
		if (!page) return; //that's okay
		testSettingsPage(page);
	});
}
exports.testSettings = testSettings;

//Runs all checks on a setting page. To be called from a running test.
function testSettingsPage(entry) {
	expect(typeof entry).toBe('object');
	for (let key in entry)
		testSettingsEntry(entry[key]);
}
exports.testSettingsPage = testSettingsPage;

//Most input type=* types are supported, with some adjustments
let allowedDataTypes = [
	//'button'
	//'checkbox' is replaced by 'bool'
	'bool',
	'color',
	'date',
	'datetime-local',
	'email',
	//'file',
	//'hidden'
	'month',
	'number',
	'password',
	//'radio' is replaced by [option, list]
	//'range' is currently unsupported (no way to set min/max), but in theory perfectly okay
	//'reset'
	//'search'
	//'submit'
	'tel',
	'text',
	'time',
	'url',
	'week',
];

function testSettingsEntry(entry) {
	expect(typeof entry).toBe('object');
	//Only these subkeys are supported
	expect(['title', 'hint', 'type', 'default']).toEqual(expect.arrayContaining(Object.keys(entry)));
	
	if ('title' in entry)
		expect(typeof entry.title).toBe('string');
	if ('hint' in entry)
		expect(typeof entry.hint).toBe('string');
	let type = entry['type'];
	
	if (typeof type == 'undefined')
		type = 'text'; //default
	
	if (Array.isArray(type)) {
		testOptionValues(type);
		if (('default' in entry) && (!!entry.default))
			expect(type).toContain(entry.default);
	} else {
		expect(allowedDataTypes).toContain(type);
		//Basically the possible values are too complicated so won't bother checking for now
	}

}

function testOptionValues(values) {
	expect(Array.isArray(values)).toBe(true);
	for (let i=0; i<values.length; i++)
		expect(typeof values[i]).toBe('string');
	//In theory we can allow numeric options or anything that nicely stringifies really
	//But they have to be REVERSIBLY stringifiable as they go into input value='...'
}