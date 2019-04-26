function brome() {
	//"chrome" is defined both on Chrome and FF but "browser" only on FF
	//"browser" is more standard-neutral too so prefer that
	if (typeof browser != 'undefined')
		return browser;
	return chrome;
}

/*
chrome.storage API is based on callbacks while browser.storage is on promises
FF provides chrome.storage too but I'm not sure whether on callbacks and not inclined to figure
*/
function isFfStorage() {
	return (typeof browser != 'undefined');
}
function storage() {
	if (isFfStorage())
		return browser.storage.local; //can also be sync
	else
		return chrome.storage.local;
}
//Does not auto-stringify/destringify atm
function storageGet(key) {
	if (isFfStorage())
		return storage().get(key).then(results => results[key]);
	else
		return new Promise((resolve, reject) => storage().get(key, (items) => {
			if (chrome.runtime.lastError)
				reject(chrome.runtime.lastError);
			resolve(items[key]);
		}));
}
function storageSet(key, value) {
	var data = {};
	data[key] = value;
	if (isFfStorage())
		return storage().set(data);
	else
		return new Promise((resolve, reject) => storage().set(data, () => {
			if (chrome.runtime.lastError)
				reject(chrome.runtime.lastError);
			resolve();
		}));
}

function getSidebarURI() {
	return storageGet("sidebar_uri");
}
function setSidebarURI(uri) {
	return storageSet("sidebar_uri", uri);
}
function getResultingSidebarURI() {
	return getSidebarURI().then(uri => {
		if (!uri) uri = brome().runtime.getManifest().default_sidebar_url;
		return uri;
	});
}

function notifySidebarReload() {
	brome().runtime.sendMessage("sidebarReload");
}
