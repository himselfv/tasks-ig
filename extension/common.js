
//Returns the URI of this task instance, taken from extension manifest
function getTasksURI() {
	return browser.runtime.getManifest().content_scripts[0].matches[0];
}
