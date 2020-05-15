/*
Security considerations in some contexts require:
 * No inline JS in HTML
 * No inline onclick= handlers.
*/
var options = options || {}; //see config.js
var accounts = [];

var startPage = document.getElementById('startPage');
var listPage = document.getElementById('listPage');
var editorPage = document.getElementById('editorPage');
var settingsPage = document.getElementById('settingsPage');

var mainmenu = null;
var taskmenu = null;

function initUi() {
	window.addEventListener("beforeunload", handleBeforeUnload);
	
	element('listSelectBox').addEventListener("change", selectedTaskListChanged);

	mainmenu = dropdownInit('mainmenu');
	mainmenu.button.title = "Task list action";
	mainmenu.add('menuReloadBtn', reloadTaskLists, "Reload");
	mainmenu.add('listAddBtn', tasklistAdd, "Add list...");
	mainmenu.add('listRenameBtn', tasklistRename, "Rename list...");
	mainmenu.add('listDeleteBtn', tasklistDelete, "Delete list");
	mainmenu.add('accountResetBtn', accountReset, "Reset account");
	mainmenu.add('signoutBtn', handleSignoutClick, "Sign Out");
	
	element('listContent').addEventListener("click", tasklistClick);
	element('listContent').addEventListener("dblclick", tasklistDblClick);
	
	element('listFooter').insertBefore(buttonNew("taskAddBtn", taskEntryAddClicked, "Add task"), element('taskmenu'));
	element('listFooter').insertBefore(buttonNew("taskDeleteBtn", taskEntryDeleteFocusedClicked, "Delete task"), element('taskmenu'));
	
	taskmenu = dropdownInit('taskmenu');
	taskmenu.button.title = "Task actions";
	taskmenu.button.classList.add("button");
	taskmenu.add("taskTabBtn", taskEntryTabFocused, "�> Tab");
	taskmenu.add("taskShiftTabBtn", taskEntryShiftTabFocused, "<� Shift-Tab");
	taskmenu.addSeparator();
	taskmenu.add("taskCopyJSON", taskEntryCopyJSON, "Copy JSON");
	taskmenu.add("taskExportToFile", taskEntryExportToFile, "Export to file...");
	taskmenu.add("taskEditFocused", taskEntryEditFocusedClicked, "Edit");
	taskmenu.add("taskDeleteRecursive", taskEntryDeleteRecursiveFocusedClicked, "Delete w/children");
	taskmenu.addSeparator();
	taskmenu.add("tasksExportAllToFile", taskEntryExportAllToFile, "Export all to file...");
	taskmenu.add("", tasklistReloadSelected, "Refresh");
	
    tasklistInit();
    editorInit();
    accountsLoad();
}


/*
Initializes a new backend instance from a given constructor.
Used both when loading an existing account or creating a new one.
*/
function backendInit(backendCtor) {
	if (typeof backendCtor == 'string') {
		let constructor = window[backendCtor]; //a way to call function by string name
		if (!constructor)
			return Promise.reject("Backend not found: "+backendCtor);
		backendCtor = constructor;
	}

	console.log("Using backend: ", backendCtor.name);

	backend = new backendCtor();
	if (!backend)
		return Promise.reject("Cannot create backend "+backendCtor.name);
	backend.onSignInStatus.push(updateSigninStatus);
	registerChangeNotifications(backend);
	backendActionsUpdate();
	return backend.init().then(() => backend);
}


/*
Account list
Possible backends self-register in backends.js/backends.
Account configuration is stored in localstorage; we try to load all accounts automatically.
*/
//Loads the current list of accounts and tries to activate each
function accountsLoad() {
	accounts = [];
	
	//Each entry is a backend with a few additional properties:
	//  id = Unique ID of this backend instance
	//  error = Exception that led to the backend failing to initialize or signin
	//  tasklists = Current list of task lists (to simplify reloading the combined list)
	
	//Contains an ordered list of account IDs
	var accountList = getLocalStorageItem("tasksIg_accounts") || [];
	for (let i in accountList) {
		if (!accountList[i]) continue;
		
		let accountData = getLocalStorageItem("tasksIg_account_"+accountList[i]) || {};
		//Each entry has:
		//  backendName
		//  params: any account params
		
		//Temporary use as account object until Backend is initialized
		accountData.id = accountList[i]
		accountData.initialized = false;
		accountData.ui = {};
		let accountNo = accounts.length;
		accounts.push(accountData);

		backendInit(accountData.backendName)
		.then(backend => {
			//TODO: Do not use accountNo, it can be changed by moveUp/moveDown while it's being initialized
			//Once backend is initialized, store it instead
			accounts[accountNo] = backend;
			backend.id = accountData.id;
			backend.ui = accountData.ui;
			backend.initialized = true;
			return backend.signin(accountData.params));
		}
		.catch(error => {
			accounts[accountNo].error = error;
			updateSigninStatus(accounts[accountNo], false);
		});
		
	}
	
	accountListChanged();
}
//Account must have .id and its prototype be based on the backend class
function accountAdd(account, params) {
	var accountData = {};
	accountData.backendName = account.prototype.functionName; //TODO: How?
	accountData.params = params;
	setLocalStorageItem("tasksIg_account_"+account.id, accountData);
	
	var accountList = getLocalStorageItem("tasksIg_accounts") || [];
	accountList.push(a)
	setLocalStorageItem("tasksIg_accounts", accountList);

	accounts.push(account); //this one should already be signin in
	accountListChanged();
}
//Deletes the account by its id.
function accountDelete(id) {
	//TODO: We don't sign out here ATM, maybe we should? We should then accept "account" instead
	
	window.localStorage.removeItem("tasksIg_account_"+id);
	
	var accountList = getLocalStorageItem("tasksIg_accounts") || [];
	let i = accountList.findIndex(item => (item==entry));
    accountList.splice(i, 1);
	setLocalStorageItem("tasksIg_accounts", accountList);
	accountListChanged();
}
//Switches places for accounts #i and #j in the ordered account list
function accountSwap(i, j) {
	//TODO: more index-safe inserts/deletions, perhaps with slices?
	
	var accountList = getLocalStorageItem("tasksIg_accounts") || [];
	var tmp = accountList[i];
	accountList[i] = accountList[j];
	accountList[j] = tmp;
	setLocalStorageItem("tasksIg_accounts", accountList);
	
	//Also switch the loaded account slots
	//Note that the switching may happen even while we're waiting for account to be initialized,
	//so accounts indexes should not be considered stable for any lengthy time
	tmp = accountList[i];
	accountList[i] = accountList[j];
	accountList[j] = tmp;
	accountListChanged(); //the order has changed
}
function accountMoveUp(i) { if (i >= 0) return accountSwap(i, i-1); }
function accountMoveDown(i) { return accountSwap(i, i+1); }

//Called when the account list changes either due to initial loading, or addition/deletion/reordering
function accountListChanged() {
	//If we have no accounts at all, show account addition page,
	//otherwise do nothing and wait for backends to initialize
	if (accounts.keys().length <= 0) {
		editorCancel();
		tasklistClear();
		backendSelectionShow({ cancellable: false; });
	};
	
	backendListCancel(); //if present
	reloadTaskLists(); //if e.g. the order of the lists has changed
}


/*
Backend selection page
*/
function backendSelectionShow() {
	//Create activation buttons
	document.getElementById('startPrompt').textContent = 
		(backends.length > 0) ? "Access tasks in:"
		: "No backends available, see error log for details";
	backends.forEach(item => {
		let btn = document.createElement("button");
		btn.textContent = item.name;
		btn.associatedBackend = item;
		btn.onclick = handleBackendClicked;
		startPage.appendChild(btn);
	});
	startPage.classList.remove("hidden");
}
function backendSelectionCancel() {
	startPage.classList.add("hidden");
}
function handleBackendClicked(event) {
	backendClass = event.target.associatedBackend;
	console.log("Authorizing with ", backendClass);
	backendInit(backendClass.ctor)
	.then(backend => {
		if (!backend.settingsPage)
			return backend.setup({});
		settings = backend.settingsPage();
		if (!settings)
			return backend.setup({});
		settingsPage = settingsPageShow(settings, backendClass.name);
		settingsPage.addEventListener('ok', function(event) {
			return backend.setup(event.results)
			.then(backendResults => {
				settingsPage.resolve(backendResults);
			})
			.catch(error => {
				//Cannot connect => leave settings page open
				//Special error handling because these errors are planned
				console.log('Backend.setup() error: ', error);
				window.alert(error);
				settingsPage.reenable();
			});
		});
		return settingsPage.waitResult();
	})
	.then(setupResults => {
		accountsAdd(backend, setupResults);
	})
	.catch(error => {
		//Usually "Cancelled", don't show to user
		console.log('Could not configure backend:', error);
		return null;
	});
}



/*
Settings page
Activate with settingsPageShow(), then check the data in 'ok' event handler
and close with close().
*/
function settingsPageShow(settings, backendName) {
	//We could've created the page from scratch but we'll reuse the precreated one
	//console.log('settingsPageShow');
	
	if (!backendName)
		backendName = 'Connection';
	let pageTitle = document.getElementById('settingsPageTitle');
	pageTitle.textContent = backendName + ' settings:';
	
	settingsPageReload(settings);
	settingsPage.classList.remove("hidden");
	
	//Clients can wait for the page to be either OK'd or Cancelled
	settingsPage.waitResult = function() { return settingsPage.promise };
	
	//Calling either of these closes the page
	settingsPage.promise = new Promise((_resolve, _reject) => {
		settingsPage.resolve = _resolve;
		settingsPage.reject = _reject;
	});
	//Cleanup
	settingsPage.promise
	.catch(() => {})
	.then(() => {
		settingsPage.promise = null; //prevent further access
		settingsPage.resolve = null;
		settingsPage.reject = null;
		settingsPageClose();
	});
	
	let btnOk = document.getElementById('settingsOk');
	let btnCancel = document.getElementById('settingsCancel');
	
	//Clicking OK temporarily disables the page while event handlers try the new settings
	//Event handlers should reenable() the page if an attempt resulted in neither Success nor final Cancel.
	settingsPage.disable = function() {
		btnOk.disabled = true;
		//Cancel button is always available
	};
	settingsPage.reenable = function() {
		btnOk.disabled = false;
	}
	settingsPage.reenable(); //enable for starters
	
	btnOk.onclick = function() {
		//Disable the OK button for the time being
		settingsPage.disable();
		//Call events
		let event = new CustomEvent('ok');
		event.results = settingsPageCollectResults();
		settingsPage.dispatchEvent(event);
		//We're disabled until someone reenables us
		//Event handles have to call resolve() explicitly because they might need to wait
	}
	btnCancel.onclick = function() {
		let event = new CustomEvent('cancel');
		settingsPage.dispatchEvent(event);
		settingsPage.reject("Cancelled");
	}

	return settingsPage;
}
function settingsPageClose() {
	//console.log('settingsPageClose');
	settingsPageReload({});
	settingsPage.classList.add("hidden");
}
function settingsPageReload(settings) {
	//console.log('settingsPageReload:', settings);
	let content = document.getElementById('settingsContent');
	while (content.firstChild) {
		content.removeChild(content.lastChild);
	}
	for (let key in settings) {
		let param = settings[key];
		
		let row = document.createElement("div");
		row.classList.add("settingsRow");
		content.appendChild(row);
		
		let paramName = document.createElement("label");
		paramName.id = 'settingsLabel-'+key;
		paramName.textContent = ('title' in param) ? (param.title)
			: (key[0].toUpperCase() + key.slice(1));	//key + capitalize first letter
		paramName.htmlFor = 'settingsValue-'+key;
		
		let paramValue = null;
		if (['text', 'number', 'password', 'date', 'time', 'url', 'email'].includes(param.type)) {
			paramValue = document.createElement('input');
			paramValue.type = param.type;
		}
		else if (param.type == 'datetime') {
			paramValue = document.createElement('input');
			paramValue.type = 'datetime-local';
		}
		else if (param.type == 'book') {
			paramValue = document.createElement('input');
			paramValue.type = 'checkbox';
		}
		else if (Array.isArray(param.type)) {
			paramValue = document.createElement('select');
			for (let i=0; i<param.type.length; i++) {
				let option = document.createElement('option');
				option.value = param.type[i];
				option.textContent = param.type[i];
				paramValue.append(option);
			}
		}
		
		if (paramValue) {
			paramValue.id = 'settingsValue-'+key;
			paramValue.dataId = key;
			if ('default' in param)
				paramValue.value = param.default;
		}
		
		//console.log(paramName);
		//console.log(paramValue);
		if (param.type == 'bool') {
			row.appendChild(paramValue);
			row.appendChild(paramName);
		} else {
			row.appendChild(paramName);
			if (paramValue)
				row.appendChild(paramValue);
		}
		
		if ('hint' in param) {
			let hintText = document.createElement("p");
			hintText.innerHTML = param.hint;
			hintText.classList += 'settingsHintText';
			row.append(hintText);
		}
	}
}
function settingsPageCollectResults() {
	let results = {};
	let content = document.getElementById('settingsContent');
	let inputs = content.getElementsByTagName('input');
	for (let i=0; i<inputs.length; i++)
		results[inputs[i].dataId] = inputs[i].value;
	inputs = content.getElementsByTagName('select');
	for (let i=0; i<inputs.length; i++)
		results[inputs[i].dataId] = inputs[i].value;
	//console.log(results);
	return results;
}


/*
Account list page
*/
function handleSignoutClick(event) {
	backend.signout().catch(handleError);
	backend = null;
	window.localStorage.removeItem("tasksIg_ui_backend");
	window.localStorage.removeItem("tasksIg_ui_backendParams");
}

// Called when the signed in status changes, whether after a button click or automatically
function updateSigninStatus(account, isSignedIn) {
	//TODO: Reload this account's tasklist + reload the tasklistList
	
	//If we're on the list from this account, switch away
	//If we're editing a task from this account, cancel
	
	reloadTaskLists(); //in any case
}
function backendActionsUpdate() {
	element("accountResetBtn").classList.toggle("hidden", !backend.reset);
	tasklistActionsUpdate();
}



/*
Common activity and error handling.
*/
var hadErrors = false;
function printError(msg) {
	log(msg);
	if (typeof msg != 'string')
		msg = JSON.stringify(msg);
	var popup = document.getElementById('errorPopup');
	var popupText = popup.innerText;
	if (popupText != '') popupText = popupText + '\r\n';
	popup.innerText = (popupText+msg);
	popup.classList.remove("hidden");
	document.getElementById('activityIndicator').classList.add('error');
	hadErrors = true;
}
function handleError(reason) {
	if (reason.result) {
		if (reason.result.error)
			printError('Error: ' + reason.result.error.message);
		else
			printError(reason.result);
	}
	else
		printError(reason);
}

//Pass any promises to track their execution + catch errors.
var jobCount = 0;
var jobs = [];
var idlePromises = [];
function pushJob(prom) {
	jobCount += 1;
	jobs.push(prom);
	//log("job added, count="+jobCount);
	document.getElementById('activityIndicator').classList.add('working');
	prom.then(result => {
		jobCount -= 1;
		let index = jobs.indexOf(prom);
		if (index >= 0)
			jobs.splice(index, 1);
		//log("job completed, count="+jobCount);
		if (jobCount <= 0) {
			document.getElementById('activityIndicator').classList.remove('working');
			while ((idlePromises.length > 0) && (jobCount <= 0))
				idlePromises.splice(0, 1)();
		}
	});
	prom.catch(handleError);
	return prom;
}
//Returns a promise that fires only when NO jobs are remaining in the queue
//=> all queued actions have completed AND no new actions are pending.
function waitIdle() {
	if (jobCount <= 0)
		return Promise.resolve();
	else
		return new Promise((resolve, reject) => { idlePromises.push(resolve); })
}
//Same but recevies a function pointer
function addIdleJob(job) {
	if (jobCount <= 0) {
		job(); //synchronously
		return Promise.resolve(); //if anyone expects us to
	}
	waitIdle().then(() => job());
}
//Returns a promise that fires when all operations queued AT THE MOMENT OF THE REQUEST have completed.
//New operations may be queued by the time it fires.
function waitCurrentJobsCompleted() {
	return Promise.all(jobs);
}

function handleBeforeUnload(event) {
	//Show the confirmation popup if the changes are still pending
	//These days most browsers ignore the message contents + only show the popup if you have interacted with the page
	var message = ""; //empty string! not null!
	if (hadErrors)
		message = "Some changes to your tasks might have failed.";
	else if ((jobCount >= 1) || (idlePromises.length > 0))
		message = "Some changes to your tasks are still pending. If you close the page now they may be lost";
	if (message) { //two ways of requesting confirmation:
		event.preventDefault();
		event.returnValue = message;
	}
	return message;
}


/*
Change notifications
Since we update the UI without waiting for the backend to confirm changes,
we cannot react to change notifications immediately.
1. That might be callbacks for our own actions (backends should not send them but they may)
2. Local state of things might be ahead of the server:
      Locally:  A->B-> [currently transmitting] ->C->D-> [visible in UI]
      Server notifies: B->F  [can't and shouldn't react!]

Therefore we only mark changed items for review and update them when our state fully
catches up with the server.
By that time things might've changed further so we'll need to requery everything then.
*/
function registerChangeNotifications(backend) {
	backend.onTasklistAdded.push((tasklist) => {
		reportedChanges.tasklists = true;
		addIdleJob(processReportedChanges);
	});
	backend.onTasklistEdited.push((tasklist) => {
		reportedChanges.tasklists = true;
		addIdleJob(processReportedChanges);
	});
	backend.onTasklistDeleted.push((tasklist) => {
		reportedChanges.tasklists = true;
		addIdleJob(processReportedChanges);
	});
	backend.onTaskAdded.push((task, tasklistId) => {
		reportedChanges.tasks.push(task.id);
		addIdleJob(processReportedChanges);
	});
	backend.onTaskEdited.push((task) => {
		reportedChanges.tasks.push(task.id);
		addIdleJob(processReportedChanges);
	});
	backend.onTaskDeleted.push((taskId) => {
		reportedChanges.tasks.push(taskId);
		addIdleJob(processReportedChanges);
	});
	backend.onTaskMoved.push((taskId, where) => {
		reportedChanges.tasks.push(taskId);
		addIdleJob(processReportedChanges);
	});
}
var reportedChanges = {
	tasklists: false,
	tasks: []
}
function processReportedChanges() {
	var prom = Promise.resolve();
	if (reportedChanges.tasklists)
		prom = prom.then(results => tasklistBoxesReload()); //TODO: Does not return a promise!
	let selectedList = selectedTaskList();
	if (!selectedList)
		reportedChanges.tasks = []; //no list active, we don't care
	if (reportedChanges.tasks.length > 0) {
		/*
		We have to requery the current list to see
		1. Which tasks now go after which
		2. Which tasks have been moved elsewhere
		But comparing two task trees is cumbersome so do it the dumb way for now:
		  Just reload everything + try to preserve focus.
		*/
		prom = prom.then(results => tasklistReloadSelected());
	}
	pushJob(prom);
}


/*
Task list selection box
*/
var listSelectBox = document.getElementById('listSelectBox');

//Starts the task list reload process for all accounts. The UI will be updated dynamically
function reloadTaskLists() {
	for (let i in accounts)
		reloadAccountTaskLists(accounts[i]);
}
//Reloads the task lists for the specified account and updates the UI (the rest of the lists are not reloaded)
function reloadAccountTaskLists(account) {
	let prom = null;
	if (!account.initialized || !account.isSignedIn)
		prom = Promise.Resolve([]);
	} else
		prom = backend.tasklistList();
	
	prom.then(taskLists => {
		account.ui.tasklists = [];
		tasklistBoxReload();
	});
	return prom;
}
function tasklistBoxReload() {
	var oldSelection = listSelectBox.value;
	nodeRemoveAllChildren(listSelectBox); //clear the list
	for (let i in accounts) {
		let account = accounts[i];
		if (!account)
			continue;
		
		if (!account.initialized || !account.is !account.ui || !account.ui.tasklists) {
			//Add a "grayed line" representing the account and it's problems
			let option = document.createElement("option");
			option.text = account.id;
			if (account.error)
				option.text = option.text+': '+account.error;
			option.accountId = account.id;
			option.value = "";
			option.classList.add("grayed");
			listSelectBox.add(option);
			continue;
		}
		
		for (let j in account.ui.tasklists) {
			let tasklist = account.ui.tasklists[j];
			let option = document.createElement("option");
			option.value = {account: account, list: tasklist.id};
			option.text = tasklist.title;
			listSelectBox.add(option);
		}
	}
	
	if (accounts.length <= 0) {
		let option = document.createElement("option");
		option.hidden = true;
		option.text = "Create a new acount from the menu...";
		option.value = "";
		listSelectBox.add(option);
		listSelectBox.classList.add("grayed");
	} else {
		listSelectBox.classList.remove("grayed");
	}
	
	listSelectBox.value = oldSelection;
	if ((listSelectBox.selectedIndex < 0) && (listSelectBox.length > 0)) {
		listSelectBox.selectedIndex = 0;
		return selectedTaskListChanged(); //in this case we have to
	}
}

//Backend for the currently selected list. Only set if the backend is initialized.
var backend = null;

//Compatibility. Returns the currently selected task list ID (in the currently selected account)
function selectedTaskListId() {
	let selection = listSelectBox.value;
	return (!!selection) ? selection.tasklist : null;
}
function selectedTaskListTitle() {
	return listSelectBox.options[listSelectBox.selectedIndex].text;
}
//Returns the { account: account, tasklist: tasklist } structure or null.
function selectedTaskList() {
	return listSelectBox.value;
}
//Selects the { account: account, tasklist: tasklist } entry.
//noNotify: Do not call changed() -- we're simply restoring the control state
function setSelectedTaskList(tasklist, noNotify) {
	if (listSelectBox.value == tasklist)
		return; //nothing to change
	listSelectBox.value = tasklist;
	selectedTaskListChanged(); //Won't get called automatically
}
function selectedTaskListChanged() {
	tasklist = selectedTaskList();
	if (!!tasklist && !!tasklist.backend)
		backend = tasklistId.backend;
	else
		backend = null;
	tasklistActionsUpdate();
	return tasklistReloadSelected();
}
//Update available tasklist actions depending on the selected tasklist and available backend functions
function tasklistActionsUpdate() {
	var tasklist = selectedTaskList();
	element("listAddBtn").classList.toggle("hidden",    !backend || !backend.tasklistAdd);
	element("listRenameBtn").classList.toggle("hidden", !backend || !backend.tasklistUpdate || !tasklist);
	element("listDeleteBtn").classList.toggle("hidden", !backend || !backend.tasklistDelete || !tasklist);
	element("tasksExportAllToFile").classList.toggle("hidden", !tasklist);
	tasksActionsUpdate();
}





/*
Task list
Most procedures here update both the backend and the UI.

Task entry and backend synchronization rules:
1. Update the UI first, post to backend later
2. Backend requests are processed more or less in order so eventually they catch up
3. Rely on the UI for current state

The only thing that we need back from backend are new task IDs.
So everywhere instead of task IDs we should use promises to have task IDs. Even if task nodes
are by then deleted, promises should still be fulfilled if anyone holds them.

Note: any data that we don't have stored locally in the nodes we should only update synchronously.
(See: taskMerge, editorOpen)
*/

var tasks = null;

  function tasklistInit() {
    tasks = new TaskList(document.getElementById('listContent'));
    tasks.addEventListener("focuschanged", tasksFocusChanged);
    tasks.addEventListener("dragstart", taskEntryDragStart);
    tasks.addEventListener("dragend", taskEntryDragEnd);
    tasks.addEventListener("dragmove", taskEntryDragMove);
    tasks.addEventListener("titlechanged", taskEntryTitleChanged);
    tasks.addEventListener("titlefocusout", taskEntryTitleFocusOut);
    tasks.addEventListener("editclicked", taskEntryEditClicked);
    tasks.addEventListener("checked", taskEntryChecked);
    tasks.addEventListener("keydown", taskListKeyDown, {capture: true});
  }
  
  function tasklistClear() {
    if (backend)
      backend.selectTaskList(null); //clear the cache
    tasks.clear();
  }
  
  //Reloads the currently selected task list. Tries to preserve focus. Returns a promise.
  function tasklistReloadSelected() {
	console.log('tasklistReloadSelected');
  	var oldFocus = tasks.getFocusedEntry();
  	if (oldFocus)
      oldFocus = { id: oldFocus.getId(), pos: oldFocus.getCaret() };
  	
    backend.selectTaskList(null); //clear the cache
    var selectedValue = selectedTaskList();
    if (!selectedValue) {
      tasks.clear();
      tasksFocusChanged();
      return Promise.resolve();
    }
    
    log('Loading list: '+selectedValue);
    return backend.selectTaskList(selectedValue)
    .then(taskRecords => {
      tasks.clear();
      tasks.appendTaskChildren(null, 0, taskRecords);
      //Sometimes tasks get orphaned due to bugs; show these at root (better than eternally keeping them hidden)
      tasks.appendOrphans(taskRecords);
      if (oldFocus) {
      	  let focusTask = tasks.find(oldFocus.id);
      	  if (focusTask)
      	  	  focusTask.setCaret(oldFocus.pos);
      } else
      	tasksFocusChanged();
    });
  }
  
  //Called when the focused task changes
  function tasksFocusChanged() {
    tasksActionsUpdate();
  }
  //Updates available task actions depending on the selected task and backend functionality
  function tasksActionsUpdate() {
  	var entry = tasks.getFocusedEntry();
  	element("taskAddBtn").classList.toggle("hidden", !backend || !backend.insert);
  	element("taskDeleteBtn").classList.toggle("hidden", !backend || !backend.delete || !entry);
  	element("taskTabBtn").classList.toggle("hidden", !backend || !backend.move || !entry);
  	element("taskShiftTabBtn").classList.toggle("hidden", !backend || !backend.move ||!entry);
  	element("taskDeleteBtn").classList.toggle("hidden", !backend || !backend.delete || !entry);
  	element("taskCopyJSON").classList.toggle("hidden", !entry);
  	element("taskExportToFile").classList.toggle("hidden", !entry);
  	element("taskEditFocused").classList.toggle("hidden", !backend || !backend.update || !entry);
  	element("taskDeleteRecursive").classList.toggle("hidden", !backend || !backend.move ||!entry);
  }


  /*
  Task entry / task list commands
  */
  function taskEntryEdit(entry) {
    taskEntryTitleCommitNow(entry); //commit any pending changes
    entry.whenHaveId().then(taskId => editorOpen(taskId));
  }
  //Called when the editor button for the entry had been clicked
  function taskEntryEditClicked(event) {
    if (!event.entry) return;
    taskEntryEdit(event.entry)
  }
  //Called when the edit button is clicked for the focused task
  function taskEntryEditFocusedClicked() {
    taskEntryEdit(tasks.getFocusedEntry());
  }
  
  //Called when the task entry checkbox has been checked/unchecked
  function taskEntryChecked(event) {
    var patch = {};
    taskResSetCompleted(patch, event.entry.getCompleted());
    var job = taskEntryNeedIds([event.entry])
    	.then(ids => {
      		patch.id = ids[0];
      		return backend.patch(patch);
    	});
    pushJob(job);
  }

  function taskEntryAddClicked(event) {
    taskEntryTitleCommitNow(); //commit any pending changes
    var newEntry = taskNewInCurrentList({}, null, null);
    newEntry.setCaret(0); //move focus to it
  }
  function taskEntryDeleteFocusedClicked(event) {
    var focusedEntry = tasks.getFocusedEntry();
    if (!focusedEntry)
      return;
    taskDelete(focusedEntry, false);
  }
  function taskEntryDeleteRecursiveFocusedClicked(event) {
    var focusedEntry = tasks.getFocusedEntry();
    if (!focusedEntry)
      return;
    taskDelete(focusedEntry, true);
  }
  function taskEntryExportToFile(event) {
    var focusedEntry = tasks.getFocusedEntry();
    if (!focusedEntry)
      return;
    var job = taskEntryNeedIds([focusedEntry])
    	.then(ids => backend.get(ids[0]))
    	.then(result => downloadAsJson(result, focusedEntry.getTitle()));
    pushJob(job);
  }
  function taskEntryCopyJSON(event) {
    var focusedEntry = tasks.getFocusedEntry();
    if (!focusedEntry)
      return;
    //We can't query the data properly; clipboard access won't work in some browsers unless we call it immediately
    //We can't even do taskEntryNeedIds()
    var taskId = focusedEntry.getId();
    if (taskId.hasOwnProperty("taskId"))
      return; //can't query cache with promised IDs
    let task = backend.cache.get(taskId);
    copyToClipboard(JSON.stringify(task));
  }
  function taskEntryExportAllToFile() {
    var entries = tasks.allEntries();
    var job = taskEntryNeedIds(entries)
    	.then(ids => backend.get(ids))
    	.then(result => downloadAsJson(result, selectedTaskListTitle()));
    pushJob(job);
  }
  
  //Returns tasklist-relative Y offset of the last task in the list
  function tasklistLastTaskY(event) {
    var lastTask = tasks.last();
    return lastTask ? relativeBoundingRect(lastTask.node, lastTask.node.parentNode).bottom : -1;
  }
  function tasklistClick(event) {
    if (!options.singleClickAdd)
      return;
    if (!selectedTaskList())
      return;
    if (event.offsetY <= tasklistLastTaskY())
      return;
    taskEntryAddClicked(event);
  }
  function tasklistDblClick(event) {
    if (event.offsetY <= tasklistLastTaskY())
      return;
    if (!selectedTaskList())
      return;
    taskEntryAddClicked(event);
  }


  /*
  Entry keyboard handling
  */
  function taskListKeyDown(event) {
    //This captures all TaskList keypresses so filter it
    var entry = elementGetOwnerTaskEntry(event.target);
    if (!entry) return; //not in an entry
    //log(event);
    
    if (event.ctrlKey) {
      if (event.key=="ArrowUp") {
        event.preventDefault();
        taskMoveEntryUp(entry);
      } else if (event.key=="ArrowDown") {
        event.preventDefault();
        taskMoveEntryDown(entry);
      }
      return;
    }
    
    if (event.key=="Tab") {
      event.preventDefault();
      if (event.shiftKey)
        taskEntryShiftTab(entry);
      else
        taskEntryTab(entry);
    }
    
    if (event.shiftKey)
      return; //Do not do most of normal handling with shift
    
    //Normal keys
    if (event.key=="ArrowUp") {
      let prev = entry.getPrev();
      if (prev) {
        prev.setCaret(entry.getCaret());
        event.preventDefault();
      }
    } else if (event.key=="ArrowDown") {
      let next = entry.getNext();
      if (next) {
        next.setCaret(entry.getCaret());
        event.preventDefault();
      }
    } else if (event.key=="ArrowLeft") {
      let caretPos = entry.getCaret();
      if (caretPos === 0) {
        let prev = entry.getPrev();
        if (prev) {
          prev.setCaret(prev.getLength());
          event.preventDefault();
        }
      }
    } else if (event.key=="ArrowRight") {
      let caretPos = entry.getCaret();
      if (caretPos === entry.getLength()) {
        let next = entry.getNext();
        if (next) {
          next.setCaret(0);
          event.preventDefault();
        }
      }
    } else if (event.key=="Enter") {
      event.preventDefault(); //we don't accept returns in titles any way
      var caretPos = entry.getCaret();
      taskNewSplit(entry, caretPos);
    } else if (event.key=="Delete") {
      //If we're at the end, delete the next entry and merge its title and notes into this one.
      var caretPos = entry.getCaret();
      if (!options.noMergeByDelete && (caretPos == entry.getLength()) && window.getSelection().isCollapsed) {
        event.preventDefault();
        taskMergeForward(entry);
      }
    } else if (event.key=="Backspace") {
      //If we're at the beginning, delete this entry and merge its title and notes into the previous one.
      var caretPos = entry.getCaret();
      if (options.noMergeByBackspace && (caretPos == 0) && window.getSelection().isCollapsed) {
        event.preventDefault();
        taskMergeBackward(entry);
      }
    }
  }


  /*
  Title editing
  */
  var taskEntryTitleCommitEntry = null; //only one entry can be waiting for commit
  var taskEntryTitleCommitTimer = null;

  //Called when the user changes the task title (by typing in or pasting)
  function taskEntryTitleChanged(event) {
    //Commit any changes for other entries
    if ((taskEntryTitleCommitEntry) && (taskEntryTitleCommitEntry != event.entry))
      taskEntryTitleCommitNow();
    taskEntryTitleCommitEntry = event.entry;
    //Cancel the timer for current entry and reset it
    taskEntryTitleTriggerClear();
    taskEntryTitleCommitTimer = setTimeout(taskEntryTitleCommitNow, 2000);
    timeoutPromiseSet();
  }
  //Called when the user moves out of the task title
  function taskEntryTitleFocusOut(event) {
    //log("taskEntryTitleFocusOut: "+event.entry);
    taskEntryTitleCommitNow(event.entry);
  }
  function taskEntryTitleTriggerClear() {
    //log("taskEntryTitleTriggerClear");
    if (taskEntryTitleCommitTimer) {
      clearTimeout(taskEntryTitleCommitTimer);
      taskEntryTitleCommitTimer = null;
    }
  }
  //Commits any pending changes for list entries.
  //If an entry is given, commits only pending changes to that entry.
  function taskEntryTitleCommitNow(entry) {
    if (!entry)
      entry = taskEntryTitleCommitEntry;
    else if (entry != taskEntryTitleCommitEntry)
      return;
    
    log("taskEntryTitleCommitNow");
    taskEntryTitleTriggerClear();
    if (!entry) {
      timeoutPromiseResolve();
      return;
    }
    
    var patch = {};
    patch.title = taskEntryNormalizeTitle(entry.getTitle());
    //log('newText: "'+patch.title+'"');
    taskEntryTitleCommitEntry = null;
    
    var job = taskEntryNeedIds([entry])
    	.then(ids => {
    	  patch.id = ids[0];
    	  return backend.patch(patch);
    	});
    pushJob(job);
    
    timeoutPromiseResolve();
  }
  
  //We need to keep the UI "busy" during the timeout so pass a promise
  var timeoutPromiseResolveProc = null; //function to call on timer abort/completion
  function timeoutPromiseSet() {
    if (!timeoutPromiseResolveProc)
      pushJob(new Promise((resolve, reject) => {
        timeoutPromiseResolveProc = resolve; //will be called from commit
      }));
  }
  function timeoutPromiseResolve() {
    //Resolve the timeout promise
    if (timeoutPromiseResolveProc) {
      timeoutPromiseResolveProc();
      timeoutPromiseResolveProc = null;
    }
  }


  /*
  Drag handling
  */
  var dragContext = {}; //stores some things temporarily while dragging

  //Starts the drag
  function taskEntryDragStart(event) {
  	if (!backend || !backend.move) return;
	
    //Cancel any text selection that might be going on due to not capturing that initial mouse click
    document.activeElement.blur();
    resetSelection();
    
    //Configure node for dragging
    var dragEntry = event.entry;
    var dragNode = event.entry.node;
    dragNode.classList.add("dragging");
    
    //To prevent mouse cursor from changing over unrelated elements + to avoid interaction with them,
    //we need to shield the page while dragging
    dragContext.shield = document.createElement("div");
    dragContext.shield.classList.add("dragging");
    dragContext.shield.style.position = "fixed";
    dragContext.shield.style.left = "0px";
    dragContext.shield.style.right = "0px";
    dragContext.shield.style.top = "0px";
    dragContext.shield.style.bottom = "0px";
    dragContext.shield.style.zIndex = 10;
    document.body.appendChild(dragContext.shield);
    
    //Remember existing place for simple restoration
    //We need previous sibling because next sibling might well be our child
    dragContext.oldPrev = dragEntry.getPrev();
    dragContext.oldLevel = dragEntry.getLevel();
    
    //Hide all children
    dragContext.oldChildren = document.createElement("div");
    dragContext.oldChildren.style.display = "none";
    var childEntries = dragEntry.getAllChildren();
    childEntries.forEach(entry => { //move to offsite in the same order
      dragContext.oldChildren.insertBefore(entry.node, null);
    });
  }
  
  //Ends the drag and commits the move
  function taskEntryDragEnd(event) {
  	if (!backend || !backend.move) return;
  	
    var dragEntry = event.entry;
    var dragNode = event.entry.node;
    var cancelDrag = event.cancelDrag;
    
    if (event.cancelDrag)
      //Move the node back to where it were
      dragEntry.move(dragContext.oldPrev, dragContext.oldLevel);
    
    var newLevel = cancelDrag ? dragContext.oldLevel : dragEntry.getLevel();
    
    //Unhide all children + move to where the parent is + adjust level
    let nextNode = dragNode.nextElementSibling;
    for (let i=0; i < dragContext.oldChildren.children.length;) { //don't increment, stay at 0
      let node = dragContext.oldChildren.children[i];
      dragNode.parentNode.insertBefore(node, nextNode);
      if (newLevel != dragContext.oldLevel)
        node.taskEntry.setLevel(node.taskEntry.getLevel() - dragContext.oldLevel + newLevel); //warning, likes to add as strings
    }
    
    //Remove the shield
    document.body.removeChild(dragContext.shield);
    delete dragContext.shield;
    
    //restore backed up properties
    dragNode.classList.remove("dragging");
    
    //find where we have moved
    if (!cancelDrag && (dragContext.oldPrev != dragEntry.getPrev())) {
      //Move the nodes on the backend! We only need to move the parent, but we have to properly select where
      var newParent = dragEntry.getParent();
      var newPrev = dragEntry.getPreviousSibling();
      var job = taskEntryNeedIds([dragEntry, newParent, newPrev])
      	.then(ids => backend.move(ids[0], ids[1], ids[2]));
      pushJob(job);
    }
  }
  
  //Called each time the mouse moves while dragging. Receives the mouse windowX/windowY coordinates.
  function taskEntryDragMove(event) {
  	if (!backend || !backend.move) return;
  	
    //Move the node to a new place in the same parent list, tentatively
    var pos = event.pos;
    var dragEntry = event.entry;
    
    //We can't use elementFromPoint as that would just give us the shield,
    //and hiding the shield temporarily is too slow and makes the cursor flicker.
    var targetEntry = tasks.entryFromViewportPoint(pos, nodeRect);
    if (!targetEntry || (targetEntry == dragEntry))
      return; //leave the dragged node where it is
    var nodeRect = targetEntry.node.getBoundingClientRect();
    
    //Whether we move it above or before the node depends on where the node is now
    var dragNodeRect = dragEntry.node.getBoundingClientRect();
    var insertAfter = (dragNodeRect.top < nodeRect.top);
    
    /*
    Nodes may be of different heights so we risk causing infinite switch sequence:
       D    N    D
       N -> N -> N -> ...
       N    D    N
    Only move if the pointer is in the top (bottom) dragNodeHeight of the target node.
    */
    if (insertAfter) {
      if (pos.y < nodeRect.bottom - dragNodeRect.height)
        return;
    } else {
      if (pos.y > nodeRect.top + dragNodeRect.height)
        return;
    }
    
    var beforeEntry = (insertAfter) ? targetEntry.getNext() : targetEntry;
    var afterEntry = (insertAfter) ? targetEntry : targetEntry.getPrev();
    tasks.insertEntryBefore(dragEntry, beforeEntry); //though all nodes have the same parent HTML element!
      
    //Which parent to put this under? Always the same level as the node after us, or before us
    var newLevel = beforeEntry ? beforeEntry.getLevel() : afterEntry ? afterEntry.getLevel() : 0;
    dragEntry.setLevel(newLevel);
  }


  /*
  Tab:
    Make the entry the child of it's immediate previous sibling.
    Add it to the end.
  */
  function taskEntryTab(entry) {
    //log("taskEntryTab");
    if (!backend || !backend.move) return;
    taskEntryTitleCommitNow(entry); //commit any pending changes
    
    //Find immediate previous sibling on the same task level
    var prevEntry = entry.getPreviousSibling();
    if (!prevEntry) {
      log("Already first sibling, can't shift right");
      return; //if we're the first sibling, can't Tab->
    }
    
    var prevEntryLastChild = prevEntry.getLastDirectChild(); //null is OK
    
    //Update nesting
    entry.adjustLevel(+1, true); //recursive
    
    //Post to the backend
    var job = taskEntryNeedIds([entry, prevEntry, prevEntryLastChild])
    	.then(ids => backend.move(ids[0], ids[1], ids[2]));
    pushJob(job);
  }
  
  /*
  Shift-Tab:
    Move the entry to the same level as it's parent. Add it after that parent.
    Visually update with all of its children.
    Make following siblings into children of this entry.
  */
  function taskEntryShiftTab(entry) {
    //log("taskEntryShiftTab");
   	if (!backend || !backend.move) return;
    taskEntryTitleCommitNow(entry); //commit any pending changes
    
    if (entry.getLevel() <= 0) {
      log("Already top element, can't tab up");
      return;
    }
    var parentEntry = entry.getParent();
    var newParentEntry = parentEntry.getParent();
    
    //Query siblings now while the task is still in place
    let lastChild = entry.getLastDirectChild();
    let siblings = parentEntry.getChildren();
    
    //Visually update the entry and all of its children.
    entry.adjustLevel(-1, true); //recursive
    
    //Move the entry to the same level as it's parent, after that parent
    var entryId = null; //to be filled by promise
    var lastChildId = null;
    var job = taskEntryNeedIds([entry, newParentEntry, parentEntry, lastChild])
    	.then(ids => {
    		entryId = ids[0];
    		lastChildId = ids[3];
    		return backend.move(ids[0], ids[1], ids[2])
    	});

    //Append consequent siblings to the end of the children
    let i = siblings.findIndex(item => (item==entry));
    siblings.splice(0, i+1);
    if (siblings.length >= 1)
    	job = job.then(result => taskEntryNeedIds(siblings))
    		.then(siblingIds => backend.move(siblingIds, entryId, lastChildId));
    pushJob(job);
  }

  function taskEntryTabFocused() {
    var focusedEntry = tasks.getFocusedEntry();
    if (focusedEntry) taskEntryTab(focusedEntry);
  }
  function taskEntryShiftTabFocused() {
    var focusedEntry = tasks.getFocusedEntry();
    if (focusedEntry) taskEntryShiftTab(focusedEntry);
  }

  //Moves the entry to before the entry above it, on the same level as the entry above it.
  function taskMoveEntryUp(entry) {
  	if (!backend || !backend.move) return;
    //Find the entry_above
    var entry_above = entry.getPrev();
    if (!entry_above) return; //nowhere to move
    
    var oldCaret = entry.getCaret();
    
    //Move this entry to the same level as entry_above, just before it
    //Entry list in the UI is flat so newPrevEntry may be entirely unrelated but that's okay
    var newLevel = entry_above.getLevel();
    var newPrevEntry = entry_above.getPrev();
    var newPrevSibling = entry_above.getPreviousSibling(); //take note before we break it
    entry.move(newPrevEntry, newLevel); //with all child_tasks
    entry.setCaret(oldCaret); //preserve focus
    
    //On the backend do the same but "task before" is going to be an actual "previous sibling" this time (maybe null)
    var newParent = entry_above.getParent();
    var job = taskEntryNeedIds([entry, newParent, newPrevSibling])
    	.then(ids => backend.move(ids[0], ids[1], ids[2]));
    pushJob(job);
  }

  //Moves the entry to after the entry below it, on the same level as the entry below it.
  function taskMoveEntryDown(entry) {
  	if (!backend || !backend.move) return;
    /*
      No, it's more complicated.
        A         B         B
        B    ->    A   ->    C
         C         C         A
      In other words, IF the entry below has children, we move into it as its first child.
      
    */
    
    //We move the whole subtree, so we need the next node on the same level as a target
    var entry_below = entry.getNextSibling();
    if (!entry_below) return; //nowhere to move
    
    var oldCaret = entry.getCaret();
    
    //Are we moving below or "below + into children"?
    var newParent = null;
    var newLevel = entry_below.getLevel();
    var newPrevSibling = null;
    if (entry_below.getAllChildren().length > 0) {
      newParent = entry_below;
      newLevel += 1;
      newPrevSibling = null;
    } else {
      newParent = entry_below.getParent();
      newPrevSibling = entry_below;
    }
    
    //Update nesting level and move the location of this_task's node and all of its child_tasks.
    entry.move(entry_below, newLevel);
    entry.setCaret(oldCaret); //preserve focus
    
    //Move the entry on the backend
    var job = taskEntryNeedIds([entry, newParent, newPrevSibling])
    	.then(ids => backend.move(ids[0], ids[1], ids[2]));
    pushJob(job);
  }


  /*
  Merge another entry with all of its contents and children into the given one
  */
  function taskMerge(entry_to, entry_what) {
    //log("taskMerge");
    if (!backend || !backend.update || !backend.move || !backend.delete) return;
    if (!entry_to || !entry_what) return;
    
    var mergePos = entry_to.getTitle().length;
    
    //Figure how to move children:
    //- Merging our own child? Place its children in its place
    //- Merging someone else? Place their children to the end of our list
    var newPrevEntry = null; //Last child at any level, to move nodes after it
    var newPrevChild = null; //Last direct child for actual move later
    if (entry_what.getParent() == entry_to) {
      newPrevEntry = entry_what.getPrev();
      newPrevChild = entry_what.getPreviousSibling();
    } else {
      let targetChildren = entry_to.getAllChildren();
      newPrevEntry = (targetChildren.length>0) ? targetChildren[targetChildren.length-1] : entry_to; 
      newPrevChild = entry_to.getLastDirectChild();
    }
    
    //We don't have some data at hand (Notes, Due) so we have to query the backend first
    //Otherwise if we leave the function and the user opens the editor while our promise here is waiting to GET() data,
    //they're going to see old unmerged Notes.
    
    var entryToId = null;
    var entryWhatId = null;
    var newPrevChildId = null;
    var job = taskEntryNeedIds([entry_to, entry_what, newPrevChild])
    .then(ids => {
    	entryToId = ids[0];
    	entryWhatId = ids[1];
    	newPrevChildId = ids.splice(2, 1)[0]; //don't query this one
    	return backend.get(ids)
    })
    .then(results => {
      //log("have entry data");
      task_to = results[entryToId];
      task_what = results[entryWhatId];
      
      //Now that we have everything, first update the UI
      //Move children
      var allChildren = entry_what.getAllChildren();
      newPrevEntry.insertEntriesAfter(allChildren, entry_to.getLevel() - entry_what.getLevel());
      
      //Patch entry_to and delete entry_what
      var patch_to = {
        id: entryToId,
        title: taskEntryNormalizeTitle(entry_to.getTitle() + entry_what.getTitle()),
        notes: [task_to.notes, task_what.notes].filter(Boolean).join('\r\n'), //join non-empty parts
      };
      tasks.delete(entry_what);
      entry_to.patch(patch_to);
      entry_to.setCaret(mergePos);
      
      //Now produce calls to the backend
      //TODO: We could do both updates batched
      return backend.patch(patch_to)
        .then(response => {
          //log("patched entry to");
          //Move children first!
          return backend.moveChildren(entryWhatId, entryToId, newPrevChildId);
        }).then(response => {
          //log("moved children")
          return backend.deleteWithChildren(entryWhatId);
        });
    });
    pushJob(job);
  }
  
  //Merges the next entry into this one
  function taskMergeForward(entry) {
    //log("taskMergeForward");
    var entry_after = entry.getNext(); //at any level
    if (!entry_after) return;
    return taskMerge(entry, entry_after);
  }
  
  function taskMergeBackward(entry) {
    //log("taskMergeBackward");
    var entry_before = entry.getPrev(); //at any level
    if (!entry_before) return;
    return taskMerge(entry_before, entry);
  }


  //Adds a new task to the current list, after and with the same parent as the given task.
  //Creates a taskEntry representation for it.
  function taskNewInCurrentList(newTask, parentEntry, prevEntry) {
  	if (!backend || !backend.insert) return;
    //if no parent is given the node will be added by default to the end of the list
    if (!prevEntry)
      prevEntry = tasks.last();
    //log(prevEntry);
    
    //Insert new task entry
    var level = parentEntry ? (parentEntry.getLevel()+1) : 0;
    var newEntry = tasks.createEntry(newTask, level);
    tasks.insertEntryAfter(newEntry, prevEntry);
    
    var job = taskEntryNeedIds([parentEntry, prevEntry])
    	.then(ids => {
    	  newTask.parent = ids[0];
    	  return backend.insert(newTask, ids[1], backend.selectedTaskList);
    	});
    pushJob(job);

    newEntry.promiseId(job); //set temporary promised ID
    return newEntry;
  }
  
  //Create new entry on the same level and after a given one, splitting the part of the title after the caret into it
  function taskNewSplit(prevEntry, caretPos) {
  	if (!backend || !backend.update)
  	  return Promise.reject("Not implemented");
  	let children = prevEntry.getChildren();
  	if (children && (children.length > 0) && !backend.move)
  		return Promise.reject("Not implemented");
    taskEntryTitleCommitNow(); //commit any pending changes
    
    let prevTitle = prevEntry.getTitle();
    if (caretPos === null)
      caretPos = prevTitle.length;
    
    var parentEntry = prevEntry.getParent();
    
    let newTaskReq = { //new task to create
      'title': prevTitle.substring(caretPos) //the rest of the string
    };
    let prevPatch = { //old task to trim
      'title': prevTitle.substring(0, caretPos)
    };
    
    var newEntry = taskNewInCurrentList(newTaskReq, parentEntry, prevEntry);
    newEntry.setCaret(0); //move focus to it
    if (prevPatch.title != prevTitle)
      prevEntry.patch(prevPatch);
    
    //TODO: Move all children of the original task visually here? Or are they automatically where they need to be?
    
    //Once the backend request completes and we have the ID, update the old task
    var newTaskId = null; //must be var -- promise will put value here
    var prevTaskId = null;
    var job = taskEntryNeedIds([newEntry, prevEntry])
   	.then(ids => {
   		newTaskId = ids[0]; //Store in a shared context for later promise
  		prevTaskId = ids[1];
   		prevPatch.id = ids[1];
   		if (prevPatch.title != prevTitle) { //trim the previous one
     		backend.cache.patch(prevPatch);
     		return backend.patch(prevPatch);
    	}; //else no update needed
    });
    //Move all children of the original task to the new task
    job = job.then(response => {
      //log("running backend.moveChildren")
      return backend.moveChildren(prevTaskId, newTaskId, null);
    });
    return pushJob(job);
  }

  /*
  Moves all children of the task out of it.
  Makes the first child their new parent.
  */
  function taskLiberateChildren(entry) {
    //log("taskLiberateChildren:");
    //log(entry);
    var children = entry.getChildren();
    if (!children || (children.length <= 0))
      return Promise.resolve();
    
  	if (!backend || !backend.move)
  	  return Promise.reject("Not implemented");
    
    var entryParent = entry.getParent();
    
    //Of the child tasks select the top one
    var firstChild = children.splice(0, 1)[0];
    //log("taskLiberateChildren: Making this one new parent:");
    //log(firstChild);
    
    //This entry is the only one that's visually changing nesting level
    firstChild.adjustLevel(-1, false); //non-recursive
    
    var firstChildId = null; //shared between promises
    var childIds = null;
    var job = taskEntryNeedIds([entry, entryParent, firstChild].concat(children))
   	.then(ids => {
   		childIds = ids.splice(3);
   		firstChildId = ids[2];
   		//Move it to this task's parent, under this task.
   		return backend.move(firstChildId, ids[1], ids[0]);
   	})
   	.then(result => backend.move(childIds, firstChildId, null));
    return pushJob(job);
  }

  /*
  Deletes the task. Liberates the children.
  recursive: Kill the children too
  */
  function taskDelete(entry, recursive) {
  	if (!backend || !backend.delete)
  	  return Promise.reject("Not implemented");
    taskEntryTitleCommitNow(); //commit any pending changes
    
    var job = null;
    if (!recursive) {
      //Move the children outside parent first
      job = taskLiberateChildren(entry);
    } else {
      //Delete the UI entries for all children
      entry.getAllChildren().forEach(child => tasks.delete(child));
      job = Promise.resolve();
    }
    
    //Find next entry to focus:
    //* either the new liberated parent or the next sibling
    //* or the previous sibling (but not their child)
    //* or the parent
    let nextEntry = entry.getNextSibling() || entry.getPreviousSibling() || entry.getParent();
    //All null? => top level, no siblings => no other nodes to focus, sorry
    
    //BEFORE DELETION, copy the ID promise
    var whenTaskId = entry.whenHaveId();
    
    //Delete the node itself
    tasks.delete(entry);
    if (nextEntry)
      nextEntry.setCaret();
    
    //Delete the task on the backend
    job = Promise.all([job, whenTaskId])
    	.then(response => backend.deleteWithChildren(response[1]));
    return pushJob(job);
  }

  //Edits the task properties unrelated to its position in the list
  function taskPatch(patch) {
    tasks.patchEntry(patch); //Update the task UI node
    var job = backend.patch(patch);
    return pushJob(job);
  }

  //Moves the task and all of its children to a different tasklist
  function taskMoveToList(entry, newTaskListId) {
    //Warning! This function has to play nice to taskPatchMoveToList and only use cached task data.
    
    var whenTaskId = entry.whenHaveId(); //before we .delete() it
    
    //Delete the nodes first, THEN move the task:
    //responsible UI + we won't have children lists after we delete the local tasks
    entry.getAllChildren().forEach(child => tasks.delete(child));
    tasks.delete(entry);
    
    var job = whenTaskId
    	.then(taskId => backend.moveToList(taskId, newTaskListId));
    return pushJob(job);
  }

  //Edits the task and immediately moves it and all of its children to a different tasklist
  //WARNING: At the moment, all IDs must be explicitly set
  function taskPatchMoveToList(patch, newTaskListId) {
    //To avoid a pointless update of the task in the original list we play unfair:
    //1. Update the current task locally
    //2. Post it to another list and delete from this one
    backend.cache.patch(patch); //patch locally
    return taskMoveToList(tasks.find(patch.id), newTaskListId);
  }


  /*
  Tasklist and account actions
  */
  
  function tasklistAdd() {
  	if (!backend || !backend.tasklistAdd) return;
    var title = prompt("Enter a name for the new task list:", "");
    if (!title)
      return;
    
    var newTasklistId = null;
    var job = backend.tasklistAdd(title)
    .then(result => {
      newTasklistId = result.id;
      return tasklistBoxesReload()
    }).then(response => {
      setSelectedTaskList(newTasklistId);
    });
    pushJob(job);
  }
  
  function tasklistRename() {
  	if (!backend || !backend.tasklistUpdate) return;
    var oldTitle = selectedTaskListTitle();
    var title = prompt("Enter new name for this task list:", oldTitle);
    if (!title || (title == oldTitle))
      return;
    var patch = {
      'id': selectedTaskList(),
      'title': title,
    };
    var job = backend.tasklistPatch(patch)
    	.then(result => tasklistBoxesReload());
    pushJob(job);
  }
  
  function tasklistDelete() {
  	if (!backend || !backend.tasklistDelete) return;
    if (tasks.first() != null) {
      window.alert("This task list is not empty. Please delete all tasks before deleting the task list.");
      return;
    }
    var tasklistId = selectedTaskList();
    var title = selectedTaskListTitle();
    if (!confirm('Are you SURE you want to delete task list "'+title+'"?'))
      return;
    var job = backend.tasklistDelete(tasklistId)
    .then(result => tasklistBoxesReload())
    .then(response => selectedTaskListChanged());
    pushJob(job);
  }
  
  function accountReset() {
  	if (!backend || !backend.reset) return;
    if (!confirm('WARNING. This will delete all your tasks and task lists and RESET your account. Do you want to continue?'))
      return;
    if (!confirm('Are you SURE you want to delete ALL your task lists and tasks?'))
      return;
    var job = backend.reset()
    	.then(() => reloadTaskLists());
    pushJob(job);
  }



/*
Editor
*/
var editor = document.getElementById("editor");
var editorTaskList = document.getElementById("editorTaskList");
var editorSaveBtn = document.getElementById("editorSave");
var editorCancelBtn = document.getElementById("editorCancel");
var editorDeleteBtn = document.getElementById("editorDelete");
var editorTaskId = null;
var editorListPageBackup = {}; //overwritten properties of listPage

function editorInit() {
	editorTaskList.onchange = editorTaskListChanged;
	editorSaveBtn.onclick = editorSaveClose;
	editorCancelBtn.onclick = editorCancel;
	editorDeleteBtn.onclick = editorDelete;
}

//Show the editor
function editorOpen(taskId) {
	if (!taskId) return;
	log("Opening editor for task "+taskId);

	//Title edits sometimes are not yet commited even though we've sent the request
	var job = waitCurrentJobsCompleted()
	//Load the task data into the editor
	.then(results => backend.get(taskId))
	.then(task => {
		if (!task) {
			log("Failed to load the requested task for editing");
			editorTaskId = null;
			return;
		}
		editorTaskListBoxReload();
		document.getElementById("editorTaskTitle").innerText = task.title;
		document.getElementById("editorTaskTitleBox").checked = (task.completed != null);
		document.getElementById("editorTaskTitleP").classList.toggle("completed", task.completed != null);
		document.getElementById("editorTaskList").value = selectedTaskList();
		document.getElementById("editorTaskDate").valueAsDate = (task.due) ? (new Date(task.due)) : null;
		document.getElementById("editorTaskNotes").value = (task.notes) ? task.notes : "";
		document.getElementById("editorMoveNotice").style.display = "none";

		editorTaskId = taskId;

		editorListPageBackup.display = listPage.style.display;
		listPage.style.display = "none";
		editorPage.classList.remove("hidden");
	});
	pushJob(job);
}

function editorTaskListBoxReload() {
	nodeRemoveAllChildren(editorTaskList);
	for (let i in accounts) {
		let account = accounts[i];
		if (!account || !account.ui || !account.ui.tasklists)
			continue;
		for (let j in account.ui.tasklists) {
			let tasklist = account.ui.tasklists[j];
			let option = document.createElement("option");
			option.accountId = account.id;
			option.value = tasklist.id;
			option.text = tasklist.title;
			editorTaskList.add(option);
		}
}
}
//Called when the user selects a new list to move task to
function editorTaskListChanged() {
	if (!editorTaskId) return;
	if (document.getElementById("editorTaskList").value != selectedTaskList())
		document.getElementById("editorMoveNotice").style.display = "block";
	else
		document.getElementById("editorMoveNotice").style.display = "none";
}

//Save the task data currently in the editor
function editorSaveClose() {
	if (!editorTaskId) {
		editorCancel();
		return;
	}

	var patch = { "id": editorTaskId };
	taskResSetCompleted(patch, document.getElementById("editorTaskTitleBox").checked);
	patch.due = document.getElementById("editorTaskDate").valueAsDate; //null is fine!
	patch.notes = document.getElementById("editorTaskNotes").value;

	var job = null;

	var newTaskList = document.getElementById("editorTaskList").value;
	if (newTaskList == selectedTaskList())
		//Simple version, just edit the task
		job = taskPatch(patch);
	else
		//Complicated version, edit and move
		job = taskPatchMoveToList(patch, newTaskList);

	job = job.then(response => editorCancel());
	pushJob(job);
}

//Close the editor
function editorCancel() {
	log("Closing the editor");
	editorPage.classList.add("hidden");
	listPage.style.display = editorListPageBackup.display;
	editorTaskId = null;
	document.getElementById("editorMoveNotice").style.display = "none";
}

function editorDelete() {
	if (!editorTaskId)
		return;
	pushJob(
		taskDelete(tasks.find(editorTaskId))
		.then(response => editorCancel())
	);
}


/*
Currently this is called on load so index.js should be the last script in the list.
*/
initUi();
