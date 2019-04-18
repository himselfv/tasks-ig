function injectStyles() {
	var iframe = document.createElement("iframe");
	iframe.src = getTasksURI();
	document.body.appendChild(iframe);
    var cssLink = document.createElement("link");
    cssLink.href = chrome.extension.getURL('tasks.css');
    cssLink.rel = "stylesheet"; 
    cssLink.type = "text/css"; 
    iframe.document.head.appendChild(cssLink);
}

window.addEventListener("load", injectStyles, false);