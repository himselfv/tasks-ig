import * as utils from 'utils.js';
utils.importAll(utils);


//loadScript/loadScripts
//newGuid
//getLocalStorageItem/setLocalStorageItem
//Callback
//JobQueue

test('urlReadWrite', () => {
	//The URLs can't tell numbers so everything returns as strings
	urlWrite({'a': 10, 'b': 'abcd'});
	expect(urlRead()).toStrictEqual({'a': '10', 'b': 'abcd'});
	expect(urlRead()).toStrictEqual({'a': '10', 'b': 'abcd'}); //second time
	urlWrite(null);
	expect(urlRead()).toStrictEqual(null);

	urlWrite({'b': 'abcd', 'a': 10});
	expect(urlRead()).toStrictEqual({'a': '10', 'b': 'abcd'});
	document.location.href='#';
	expect(urlRead()).toStrictEqual(null);
	
	urlWrite({'a': 10, 'b': 'string&full?of#dangerous/symbols'});
	expect(urlRead()).toStrictEqual({'a': '10', 'b': 'string&full?of#dangerous/symbols'});
	document.location.href='#a=10&b=text%20data';
	expect(urlRead()).toStrictEqual({a: '10', b: 'text data'});
});
