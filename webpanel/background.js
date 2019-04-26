brome().browserAction.onClicked.addListener((activeTab) => {
	if (chrome) {
		console.log("we're chrome");
		console.log(chrome);
		//Chrome doesn't support sidebars so just open in a tab
		chrome.tabs.create({ url: "sidebar.html" });
		return;
	}

	//This is only supported by Firefox 57+, and even then, not really
	if (browser.sidebarAction) {
		console.log("sidebarAction");
		//Restore our default sidebar URI
		//if (browser.sidebarAction.setPanel)
		//	browser.sidebarAction.setPanel({panel:null});
		if (browser.sidebarAction.open)
			browser.sidebarAction.open();
	}

	//Older way of showing the sidebar, doesn't work either
	if (SidebarUI && SidebarUI.show) {
		console.log("sidebarUi");
		SidebarUI.show();
	}
});

brome().contextMenus.create({
	id: "tasksig_webpanel_seturl",
	title: "Set Tasks IG URL...",
	contexts: ["browser_action"]
}, () => {
	if (brome().runtime.lastError)
		console.error(brome().runtime.lastError);
});
brome().contextMenus.onClicked.addListener((info, tab) => {
	switch (info.menuItemId) {
	case "tasksig_webpanel_seturl":
		console.log("tasksig_seturl clicked");
		getSidepanelURI().then(uri => {
			let newURI = prompt("Enter new URI to display in a side panel:", uri);
			if (newURI)
				setSidepanelURI(newURI).then(() => notifySidebarReload());
		});
		break;
	}
});