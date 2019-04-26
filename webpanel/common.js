function brome() {
	if (typeof chrome != 'undefined')
		return chrome;
	return browser;
}
function isChrome() {
	return (typeof chrome != 'undefined');
}

function storage() {
	return brome().storage.local;
}

/* Chrome's storage API doesn't use promises */
function chromeGet(key) {
	return new Promise((resolve, reject) => storage().get(key, (items) => {
		if (chrome.runtime.lastError)
			reject(chrome.runtime.lastError);
		resolve(items[key]);
	}));
}
function chromeSet(keys) {
	return new Promise((resolve, reject) => storage().set(keys, () => {
		if (chrome.runtime.lastError)
			reject(chrome.runtime.lastError);
		resolve();
	}));
}

//Does not auto-stringify/destringify atm
function storageGet(key) {
	if (isChrome())
		return chromeGet(key);
	else
		return this.storage.get(key).then(results => results[key]);
}
function storageSet(key, value) {
	var data = {};
	data[key] = value;
	return this.storage.set(data);
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
		console.log(uri);
		return uri;
	});
}

function notifySidebarReload() {
	browser.runtime.sendMessage("sidebarReloadURI");
}
