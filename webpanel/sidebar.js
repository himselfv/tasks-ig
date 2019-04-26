
function injectStyles() {
	var iframe = document.createElement("iframe");
	getResultingSidebarURI().then(uri => { iframe.src = uri; });
	document.body.appendChild(iframe);
}

window.addEventListener("load", injectStyles, false);

brome().runtime.onMessage.addListener((request, sender) => {
	console.log("sidebar: on message");
	if (request == "sidebarReload") {
		console.log("asked to reload");
		Location.reload();
		return;
	}
});