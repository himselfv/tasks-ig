function saveOptions(e) {
	e.preventDefault();
	setSidebarURI(document.querySelector("#sidebar_uri").value)
}

function restoreOptions() {
	getSidebarURI().then(uri => {
		document.querySelector("#sidebar_uri").value = uri;
	}).catch(error => console.error(error));
}

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector("form").addEventListener("submit", saveOptions);