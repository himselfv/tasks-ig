
function initPage() {
	var iframe = document.createElement("iframe");
	iframe.id = "iframe";
	getResultingSidebarURI().then(uri => { iframe.src = uri; });
	document.body.appendChild(iframe);
}

window.addEventListener("load", initPage, false);

brome().runtime.onMessage.addListener((request, sender) => {
	if (request == "sidebarReload") {
		getResultingSidebarURI().then(uri => { document.getElementById('iframe').src = uri; });
		return;
	}
});