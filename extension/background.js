function handleClick() {
	//Open this extension's sidebar
	if (SidebarUI && SidebarUI.show)
		SidebarUI.show();
	else
		console.log("Tasks: SidebarUI.show not supported");
	/*
	//Open as an URI
	if (browser.sidebarAction)
		browser.sidebarAction.setPanel({panel: getTasksURI()});
		if (browser.sidebarAction.open)
			browser.sidebarAction.open();
	}*/
}
browser.browserAction.onClicked.addListener(handleClick);

browser.menus.create({
  id: "open-sidebar",
  title: "open sidebar",
  contexts: ["all"]
});

browser.menus.onClicked.addListener(() => {
  browser.sidebarAction.open();
});