function brome() {
	//Prefer browser as it's standardized (e.g. storage API differs)
	if (typeof browser != 'undefined')
		return browser;
	return chrome;
}

brome().browserAction.onClicked.addListener((activeTab) => {
	if (brome().sidebarAction) { //A sidebar-action supporting browser
		//This is only supported by Firefox 57+, and even then, not really
		if (brome().sidebarAction.open)
			brome().sidebarAction.open();
		else
		//Older way of showing the sidebar, doesn't work either
		if (SidebarUI && SidebarUI.show)
			SidebarUI.show();
		else
			//At least do something
			brome().tabs.create({ url: "index.html" });
	} else
		//A browser that doesn't support sidebars (e.g. Chrome), so just open in a tab
		brome().tabs.create({ url: "index.html" });
});
