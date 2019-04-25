(chrome||browser).browserAction.onClicked.addListener((activeTab) => {
	console.log("browserAction fired");
	if (chrome) {
		console.log("chrome, creating a tab");
		//Chrome doesn't support sidebars so just open in a tab
		chrome.tabs.create({ url: "index.html" });
		return;
	}

	//This is only supported by Firefox 57+, and even then, not really
	if (browser.sidebarAction) {
		//Restore our default sidebar URI
		//if (browser.sidebarAction.setPanel)
		//	browser.sidebarAction.setPanel({panel:null});
		if (browser.sidebarAction.open)
			browser.sidebarAction.open();
	}

	//Older way of showing the sidebar, doesn't work either
	if (SidebarUI && SidebarUI.show)
		SidebarUI.show();
});
