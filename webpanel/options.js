function saveOptions(e) {
	e.preventDefault();
	setSidebarURI(document.getElementById("sidebar_uri").value)
		.then(() => notifySidebarReload())
		.catch(error => console.error(error));
}

function restoreOptions() {
	getResultingSidebarURI().then(uri => {
		document.querySelector("#sidebar_uri").value = uri || "";
	}).catch(error => console.error(error));
}

document.addEventListener("DOMContentLoaded", restoreOptions);
document.getElementById("sidebar_uri_submit").addEventListener("click", saveOptions);
