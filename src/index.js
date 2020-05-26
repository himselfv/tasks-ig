/*
Security considerations in some contexts require:
 * No inline JS in HTML
 * No inline onclick= handlers.
*/
var accounts = [];

var listPage = document.getElementById('listPage');

var mainmenu = null;
var taskmenu = null;

function initUi() {
	window.addEventListener("beforeunload", handleBeforeUnload);
	
	console.log('initUi:options:', options);
	if (options.uiMaxWidth && (options.uiMaxWidth > 0))
		document.body.style.maxWidth = options.uiMaxWidth+'px';
	
	element('listSelectBox').addEventListener("change", selectedTaskListChanged);

	mainmenu = dropdownInit('mainmenu');
	mainmenu.button.title = "Task list action";
	mainmenu.add('menuReloadBtn', reloadAllAccountsTaskLists, "Reload");
	mainmenu.add('listAddBtn', tasklistAdd, "Add list...");
	mainmenu.add('listRenameBtn', tasklistRename, "Rename list...");
	mainmenu.add('listDeleteBtn', tasklistDelete, "Delete list");
	//This is a dangerous nuke account option; hide it from general users:
	if (options.debug)
		mainmenu.add('accountResetBtn', accountReset, "Reset account");
	mainmenu.addSeparator();
	mainmenu.add('accountsBtn', accountsPageOpen, "Accounts...");
	mainmenu.add('optionsBtn', optionsPageOpen, "Options...");
	
	element('listContent').addEventListener("click", tasklistClick);
	element('listContent').addEventListener("dblclick", tasklistDblClick);
	
	element('listFooter').insertBefore(buttonNew("taskAddBtn", taskEntryAddClicked, "Add task"), element('taskmenu'));
	element('listFooter').insertBefore(buttonNew("taskDeleteBtn", taskEntryDeleteFocusedClicked, "Delete task"), element('taskmenu'));
	
	taskmenu = dropdownInit('taskmenu');
	taskmenu.button.title = "Task actions";
	taskmenu.button.classList.add("button");
	taskmenu.add("taskTabBtn", taskEntryTabFocused, "—> Tab");
	taskmenu.add("taskShiftTabBtn", taskEntryShiftTabFocused, "<— Shift-Tab");
	taskmenu.addSeparator();
	taskmenu.add("taskCopyJSON", taskEntryCopyJSON, "Copy JSON");
	taskmenu.add("taskExportToFile", taskEntryExportToFile, "Export to file...");
	taskmenu.add("taskEditFocused", taskEntryEditFocusedClicked, "Edit");
	taskmenu.add("taskDeleteRecursive", taskEntryDeleteRecursiveFocusedClicked, "Delete w/children");
	taskmenu.addSeparator();
	taskmenu.add("tasksExportAllToFile", taskEntryExportAllToFile, "Export all to file...");
	taskmenu.add("", tasklistReloadSelected, "Refresh");
	
    tasklistInit();
    accountsLoad();
}


/*
Tasks IG options
*/
var optionSet = {
	showAccountsInCombo: {
		type: 'bool', default: true,
		title: 'Group lists by accounts',
		hint: 'Group tasklists by accounts instead of showing them as a single list', },
	accountsClickable: {
		type: 'bool',
		title: 'Make accounts clickable',
		hint: 'Make account entries in tasklist combobox clickable -- shows a page with a few account actions when you click on them', },
	uiMaxWidth: {
		type: 'number', default: 400,
		title: 'UI max width',
		hint: 'Limit the UI to this width. Set to 0 to expand to all available horizontal space', },
	mergeByDelete: {
		type: 'bool', default: true,
		title: 'Merge by Delete',
		hint: 'Merge the next task into the selected by pressing Delete', },
	mergeByBackspace: {
		type: 'bool', default: true,
		title: 'Merge by Backspace',
		hint: 'Merge the selected task into the previous one by pressing Backspace', },
	singleClickAdd: {
		type: 'bool',
		title: 'Single-click add',
		hint: 'Add new task with a single click on the empty space - as it had been in GTasks. Double click always works', },
	urlTrack: {
		type: 'bool', default: true,
		title: 'URL selection permanence',
		hint: 'Reflect the selected task list in the URL - you can copy the URL and it\'ll open on the same tasklist/account. The URLs are uglier though', },
	debug: {
		type: 'bool',
		title: 'Debug',
		hint: 'Enables debug backends and more logging', },
};
function optionsPageOpen() {
	console.debug('options:', options);
	let optionsPage = new SettingsPage('Options', optionSet, options);
	optionsPage.addEventListener('ok', function(event) {
		options = event.results;
		optionsSave();
		optionsPage.resolve();
	});
}
optionsSetDefaults(optionSet);


/*
Common activity and error handling.
*/
var hadErrors = false;
function printError(msg) {
	console.log(msg);
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
	//console.log("job added, count="+jobCount);
	document.getElementById('activityIndicator').classList.add('working');
	prom.then(result => {
		jobCount -= 1;
		let index = jobs.indexOf(prom);
		if (index >= 0)
			jobs.splice(index, 1);
		//console.log("job completed, count="+jobCount);
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
function waitCurrentJobsCompleted() {
	return Promise.all(jobs);
}

function addIdleJob(job) {
	if (jobCount <= 0) {
		job(); //synchronously
		return Promise.resolve(); //if anyone expects us to
	}
	waitIdle().then(() => job());
}
//Returns a promise that fires when all operations queued AT THE MOMENT OF THE REQUEST have completed.
//New operations may be queued by the time it fires.
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
		prom = prom.then(results => reloadAccountTaskLists(backend));
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
Creates a new backend instance from a given constructor. Returns immediately.
Used both when loading an existing account or creating a new one.
*/
function backendCreate(backendCtor) {
	if (typeof backendCtor == 'string') {
		let constructor = window[backendCtor]; //a way to call function by string name
		if (!constructor)
			throw "Backend not found: "+backendCtor;
		backendCtor = constructor;
	}

	console.log("Initializing backend: ", backendCtor.name);

	backend = new backendCtor();
	if (!backend)
		throw "Cannot create backend "+backendCtor.name;
	
	//We store a few additional runtime properties with each account,
	//under account.ui.
	backend.ui = {};
	backend.onSignInStatus.push(accountSigninStateChanged);
	registerChangeNotifications(backend);
	return backend;
}
function backendCreateDummy(backendName, error) {
	let backend = new DummyBackend(backendName, error);
	backend.error = error;
	backend.ui = {};
	return backend;
}


/*
Account list
Possible backends self-register in backends.js/backends.
Account configuration is stored in localstorage; we try to load all accounts automatically.
*/
//Loads the current list of accounts and tries to activate each
function accountsLoad() {
	console.log('accountsLoad');
	accounts = [];
	
	//Each entry is a backend with a few additional properties:
	//  id = Unique ID of this backend instance
	//  error = Exception that led to the backend failing to initialize or signin
	//  ui.tasklists = Current list of task lists (to simplify reloading the combined list)
	
	//Contains an ordered list of account IDs
	var accountList = getLocalStorageItem("tasksIg_accounts") || [];
	console.debug('accountsLoad: list=', accountList);
	for (let i in accountList) {
		if (!accountList[i]) continue;
		
		let accountData = getLocalStorageItem("tasksIg_account_"+accountList[i]) || {};
		//console.debug('accountsLoad: account#',i,' = ',accountData);
		//Each entry has:
		//  backendName
		//  params: any account params
		
		let account = null;
		let error = 'Cannot create backend: '+accountData.backendName;
		try {
			account = backendCreate(accountData.backendName);
		} catch (err) {
			error = err;
		}
		if (!account)
			account = backendCreateDummy(accountData.backendName, error);
		account.id = accountList[i]; //copy the id
		accounts.push(account);
		account.init()
		.then(() => {
			return account.signin(accountData.params);
		})
		.catch(error => {
			account.error = error;
			accountSigninStateChanged(account, false);
		});
		
	}
	
	//Trigger full task lists request
	reloadAllAccountsTaskLists();
	//Also react right now to provide at least some ui (the accounts in "loading" stage/"no accounts found")
	accountListChanged();
}
//Permanently adds a new account based on its Backend() object and signin() params.
//Assign it an .id
function accountAdd(account, params) {
	console.log('accountAdd', arguments);
	if (!account || !account.constructor || !account.constructor.name) {
		console.error('accountAdd: invalid account object: ', account);
		retrun;
	}
	//console.debug('accountAdd: constructor=', account.constructor);
	
	account.id = newGuid();
	
	//Store the account data
	var accountData = {};
	accountData.backendName = account.constructor.name;
	accountData.params = params;
	setLocalStorageItem("tasksIg_account_"+account.id, accountData);
	//console.debug('accountAdd: accountData=', accountData);
	
	//Store the account ID in the permanent account list
	var accountList = getLocalStorageItem("tasksIg_accounts") || [];
	accountList.push(account.id);
	setLocalStorageItem("tasksIg_accounts", accountList);
	//console.debug('accountAdd: accountList=', accountList);

	//Add to runtime list
	accounts.push(account); //signin() should already be initiated
	//The account might already have tasklists cached -- don't requery
	//E.g. it notified of signinChanged(true) from init() and we already did reloadAccountTaskLists() to it.
	if (!Array.isArray(account.ui.tasklists))
		reloadAccountTaskLists(account);
	accountListChanged();
}
//Deletes the account by its id.
function accountDelete(id) {
	//NB: account.signout() if you can before passing it here, to close any session cookies
	console.log('accountDelete:', id);
	
	//Delete the account data
	window.localStorage.removeItem("tasksIg_account_"+id);
	
	//Delete from the permanent list
	var accountList = getLocalStorageItem("tasksIg_accounts") || [];
	let i = accountList.findIndex(item => (item==id));
    accountList.splice(i, 1);
	setLocalStorageItem("tasksIg_accounts", accountList);
	
	//Delete from runtime list
	i = accounts.findIndex(item => (item.id==id));
	if (i >= 0) {
		accounts.splice(i, 1);
		accountListChanged();
	}
}
//Switches places for accounts #i and #j in the ordered account list
function accountSwap(i, j) {
	var accountList = getLocalStorageItem("tasksIg_accounts") || [];
	if (!Number.isInteger(i) || !Number.isInteger(j) || (i < 0)  || (j < 0) || (i >= accountList.length) || (j >= accountList.Length)) {
		console.error('accountSwap: invalid arguments: ', arguments);
		return;
	}
	
	var tmp = accountList[i];
	accountList[i] = accountList[j];
	accountList[j] = tmp;
	setLocalStorageItem("tasksIg_accounts", accountList);
	
	//Also switch the loaded account slots
	tmp = accounts[i];
	accounts[i] = accounts[j];
	accounts[j] = tmp;
	accountListChanged(); //the order has changed
}
//Returns a runtime account object based on its ID
function accountFind(id) {
	let i = accounts.findIndex(item => (item.id==id));
	return (i >= 0) ? accounts[i] : null;
}

//Called when the _runtime_ account list changes either due to initial loading, or addition/deletion/reordering
function accountListChanged() {
	console.debug('accountsListChanged; accounts=', accounts);
	//Hide task list while we have no accounts at all - looks cleaner
	listPage.classList.toggle("hidden", (Object.keys(accounts).length <= 0));
	//If we have no accounts at all, show account addition page,
	//otherwise do nothing and wait for backends to initialize
	if (Object.keys(accounts).length <= 0) {
		editor.cancel();
		tasks.clear();
		//Start the "add account" sequence
		StartNewAccountUi({ hasCancel: false, });
		//Since new accounts can't arrive except from its completion, there's no need to manually abort it in "else"
		console.debug('accountListChanged: no accounts, tasklistBoxReload() to empty');
	}
	//Don't reloadAllAccountsTaskLists() here: most accounts are fine.
	//Whoever is adding/changing individual accounts must trigger their reloadAccountTaskList() if needed.
	//Reload the combo though -- the order of the lists could've changed
	tasklistBox.reload();
}
// Called when the signed in status changes, whether after a button click or automatically
function accountSigninStateChanged(account, isSignedIn) {
	console.log('accountSigninStateChanged:', isSignedIn, account);
	
	//Request new task lists (null, if !signedIn)
	reloadAccountTaskLists(account);

	//When signing off:
	//  If we're on the list from this account, switch away -- will happen automatically from reloadAccountTaskLists()
	//  TODO:	If we're editing a task from this account, cancel

	//Do the accountStateChanged right now because the sign in state changed
	//Once we get the tasklist registry we're going to do this another time
	accountStateChanged(account);
}
//Called when the account init/signin status or the _cached_ tasklist registry changes
function accountStateChanged(account) {
	console.debug('accountStateChanged:', account);
	let oldSelected = selectedTaskList();
	
	//Things to update:
	// 1. Account's own combobox entry
	// 2. Account's tasklist comobobox entries
	tasklistBox.reload();
	let newSelected = selectedTaskList();
	
	// 3. Account's accountPage, if it's open
	// 4. Account actions in page menu, if it's the currently selected account
	//If tasklistbox reloading switched pages, everything refreshed anyway
	if ((String(newSelected) == String(oldSelected)) && (newSelected.account == account))
		if (!newSelected.tasklist)
			//Account-wide page is open, update it
			//We don't need to recheck if it's appropriate, tasklistBox.reload() would have done that.
			accountPageReload(newSelected);
		else
			//We don't need to reload the tasks themselves, account state doesn't influence that directly
			//But the available actions might have changed
			accountActionsUpdate();
}


/*
Account list page
Allows to add, remove, reorder accounts, in the future perhaps reorder/hide task lists inside accounts.
*/
function accountsPageOpen() {
	new AccountsPage();
}
function AccountsPage() {
	CustomPage.call(this, document.getElementById('accountListPage'));
	
	this.content = document.getElementById('accountList');
	this.content.onchange = () => { this.updateAccountActions(); };
	
	document.getElementById('accountListClose').onclick = () => { this.cancelClick(); };
	document.getElementById('accountListAdd').onclick = () => { this.addClick();};
	document.getElementById('accountListEditSettings').onclick = () => { this.editSettingsClick();};
	document.getElementById('accountListDelete').onclick = () => { this.deleteClick();};
	document.getElementById('accountListReset').onclick = () => { this.resetClick();};
	document.getElementById('accountListMoveUp').onclick = () => { this.moveUpClick();};
	document.getElementById('accountListMoveDown').onclick = () => { this.moveDownClick();};
	
	document.getElementById('accountListReset').classList.toggle('hidden', !options.debug);
	
	this.page.classList.remove('hidden');
	this.reload();
}
inherit(CustomPage, AccountsPage);
AccountsPage.prototype.close = function() {
	console.debug('AccountsPage.close');
	this.page.classList.add("hidden");
}
AccountsPage.prototype.reload = function() {
	nodeRemoveAllChildren(this.content);
	for (let i in accounts)
		this.content.appendChild(this.entryFromAccount(accounts[i]));
	//We could try to restore the selection but we atm don't do reloads while open
	this.updateAccountActions();
}
AccountsPage.prototype.entryFromAccount = function(account) {
	let item = document.createElement('option');
	item.value = account.id;
	item.textContent = account.uiName();
	return item;
}
AccountsPage.prototype.updateAccountActions = function() {
	let selectedId = this.content.value;
	console.debug('AccountsPage.updateAccountActions', selectedId);
	document.getElementById('accountListEditSettings').disabled = (!selectedId);
	document.getElementById('accountListDelete').disabled = (!selectedId);
	document.getElementById('accountListReset').disabled = (!selectedId || !options.debug || !accounts[this.content.selectedIndex].reset);
	document.getElementById('accountListMoveUp').disabled = (!selectedId || (this.content.selectedIndex <= 0));
	document.getElementById('accountListMoveDown').disabled = (!selectedId || (this.content.selectedIndex >= this.content.options.length-1));
}
AccountsPage.prototype.moveUpClick = function() {
	let index = this.content.selectedIndex;
	if ((index <= 0) || (index > this.content.options.length-1))
		return;
	//First move the visuals
	this.content.insertBefore(this.content.options[index], this.content.options[index-1]);
	//Now the accounts
	accountSwap(index, index-1);
	this.updateAccountActions(); //Positions have changed
}
AccountsPage.prototype.moveDownClick = function() {
	let index = this.content.selectedIndex;
	if ((index < 0) || (index >= this.content.options.length-1))
		return;
	//First move the visuals
	this.content.insertBefore(this.content.options[index+1], this.content.options[index]);
	//Now the accounts
	accountSwap(index+1, index);
	this.updateAccountActions(); //Positions have changed
}
AccountsPage.prototype.addClick = function() {
	StartNewAccountUi({ hasCancel:true, })
	.then(account => {
		let item = this.entryFromAccount(account);
		//Currently new accounts always go to the end of the list:
		this.content.appendChild(item);
		this.updateAccountActions(); //The one above may now moveDown
	});
}
AccountsPage.prototype.editSettingsClick = function() {
	accountEditSettings()
	.then(() => {
		//Editing the account must not change it's place in the list, but may change available actions
		//If we ever support editing account ui names, we'll have to do reload/restore the selection here
		this.updateAccountActions();
	});
}
AccountsPage.prototype.deleteClick = function() {
	let index = this.content.selectedIndex;
	if ((index < 0) || (index > this.content.options.length-1))
		return;
	
	let account = accounts[index];
	if (!confirm('Do you really want to sign out of the account '+account.uiName()+' and forget about it?'))
		return;
	
	let doDelete = true;
	account.signout()
	.catch(error => {
		if (!confirm('Cannot properly sign out of the account "'+account.uiName()+"\":\r\n\""+error+"\"\r\n\r\nForget it anyway?"))
			doDelete = false;
	})
	.then(() => {
		if (doDelete) {
			accountDelete(account.id);
			this.content.options[index].remove();
			this.updateAccountActions(); //onchanged() won't get called automatically
		}
		//If this had been our last account, close this dialog.
		//The "new account setup" will probably automatically pop up once the UI learns about no accounts,
		//and this dialog should not remain open underneath.
		if (this.content.options.length == 0) {
			console.log('AccountsPage: no accounts left, cancelling the page');
			this.reject(new FormCancelError());
		}
	});
}
AccountsPage.prototype.resetClick = function() {
	let index = this.content.selectedIndex;
	if ((index < 0) || (index > this.content.options.length-1))
		return;
	accountReset(accounts[index]);
}
//Used both from AccountsPage (for specific account) and from main menu (no param)
function accountReset(account) {
	if (!account) account = backend;
	if (!account || !account.reset) return;
	if (!confirm("WARNING. This will delete all your tasks and task lists and RESET this account:\r\n\r\n"
		+ account.uiName()+"\r\n\r\n"
		+'Do you want to continue?'))
		return;
	if (!confirm('Are you SURE you want to delete ALL your task lists and tasks in account "'+account.uiName()+'"?'))
	return;
	var job = account.reset()
		.then(() => reloadAccountTaskLists(account));
	pushJob(job);
}
//Opens the account settings page, lets the user edit, try to apply and then save the settings
function accountEditSettings(account) {
	//TODO: Implement.
	//TODO: Return a Page prototype to wait on
	return Promise.resolve();
}


/*
Backend selection page
*/
function BackendSelectPage(params) {
	console.debug('BackendSelectPage()', params);
	CustomPage.call(this, document.getElementById('backendSelectPage'));
	
	this.hasCancel = params.hasCancel;
	this.prompt = params.prompt;
	
	this.reenable();
	this.reload();
	this.page.classList.remove("hidden");
}
inherit(CustomPage, BackendSelectPage);
BackendSelectPage.prototype.reload = function() {
	document.getElementById('backendSelectPrompt').textContent = 
		(backends.length > 0) ? this.prompt
		: "No backends available, see error log for details";
	
	nodeRemoveChildrenByTagName(this.page, 'button');
	backends.forEach(item => {
		let btn = document.createElement("button");
		btn.textContent = item.uiName || item.name;
		btn.associatedBackend = item;
		btn.onclick = () => { this.backendClicked(btn); };
		this.page.appendChild(btn);
	});
	
	if (this.hasCancel) {
		let sep = document.createElement("p");
		sep.classList.add("backendSelectSeparator");
		this.page.appendChild(sep);
		let btn = document.createElement("button");
		btn.textContent = 'Cancel';
		btn.onclick = () => { this.cancelClick(); };
		this.page.appendChild(btn);
	}
}
BackendSelectPage.prototype.close = function() {
	this.page.classList.add("hidden");
}
BackendSelectPage.prototype.backendClicked = function(btn) {
	backendClass = btn.associatedBackend;
	console.log("Setting up backend", backendClass);
	this.disable();
	let backend = backendCreate(backendClass);
	backend.init()
	.then(() => {
		console.debug('Backend initialized');
		if (!backend.settingsPage)
			return backend.setup({});
		let settings = backend.settingsPage();
		if (!settings)
			return backend.setup({});
		settingsPage = new BackendSettingsPage(backend.uiName(), settings);
		settingsPage.addEventListener('ok', function(event) {
			//Disable the OK button for the time being
			settingsPage.disable();
			return backend.setup(event.results)
			.then(backendResults => {
				settingsPage.resolve(backendResults);
			})
			.catch(error => {
				//Cannot connect => leave settings page open
				//Special error handling because these errors are planned
				console.log('Backend.setup() error:', error);
				window.alert(error);
				settingsPage.reenable();
			});
		});
		return settingsPage.waitResult();
	})
	.then(setupResults => {
		//console.debug('Backend.setup() success; params:', setupResults);
		accountAdd(backend, setupResults);
		this.okClick(backend); //for now just run the default completion routine
		//TODO: maybe split this into a "backend selection" which will run okClicked() over the selected backend
		//  + "add backend process" which will handle that to open settings etc and conditionally resolve()?
	})
	.catch(error => {
		//For configuration-form scenarios we can also get here when the user cancels the form
		console.log('Could not configure backend:', error);
		if (!(error instanceof FormCancelError))
			window.alert(error);
		this.reenable();
		return null;
	});
}
//Disables everything on this page while we process the user command
BackendSelectPage.prototype.disable = function() {
	for (let i=0; i<this.page.children.length; i++)
		this.page.children[i].disabled=true;
}
//Reenables everything on this page
BackendSelectPage.prototype.reenable = function() {
	for (let i=0; i<this.page.children.length; i++)
		this.page.children[i].disabled=false;
}

/*
New account UI
*/

//Opens new account creation UI. Returns the promise that's resolved with new account, or rejected on cancel.
function StartNewAccountUi(params) {
	params.prompt = "Access tasks in:";
	let addBackendPage = new BackendSelectPage(params);
	
	addBackendPage.addEventListener('ok', (event) => {
		//console.debug('addBackendPage.ok:', event);
		addBackendPage.resolve(event.results);
	});
	return addBackendPage.waitResult();
}



/*
Settings page
Activate with new SettingsPage(), then check the data in 'ok' event handler
and close with close().
*/
function SettingsPage(titleText, settings, values) {
	console.log('SettingsPage()', arguments);
	//We could've created the page from scratch but we'll reuse the precreated one
	CustomPage.call(this, document.getElementById('settingsPage'));
	this.btnOk = document.getElementById('settingsOk');
	this.btnCancel = document.getElementById('settingsCancel');
	this.btnOk.onclick = () => this.okClick();
	this.btnCancel.onclick = () => this.cancelClick();
	this.content = document.getElementById('settingsContent');
	
	let pageTitle = document.getElementById('settingsPageTitle');
	pageTitle.textContent = titleText;
	
	this.reload(settings);
	if (values)
		this.setValues(values);
	this.page.classList.remove("hidden");
	this.reenable(); //enable for starters
}
inherit(CustomPage, SettingsPage);
//Clicking OK temporarily disables the page while event handlers try the new settings
//Event handlers should reenable() the page if an attempt resulted in neither Success nor final Cancel.
SettingsPage.prototype.disable = function() {
	this.btnOk.disabled = true;
	//Cancel button is always available
};
SettingsPage.prototype.reenable = function() {
	this.btnOk.disabled = false;
}
SettingsPage.prototype.close = function() {
	//console.debug('SettingsPage.close()');
	this.reload({});
	this.page.classList.add("hidden");
}
//Reloads settings list for the page
SettingsPage.prototype.reload = function(settings) {
	//console.debug('SettingsPage.reload:', settings);
	nodeRemoveAllChildren(this.content);
	for (let key in settings) {
		let param = settings[key];
		let row = document.createElement("div");
		row.classList.add("settingsRow");
		this.content.appendChild(row);
		
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
		else if (param.type == 'bool') {
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
				if (param.type == 'bool')
					paramValue.checked = param.default;
				else
					paramValue.value = param.default;
		}
		
		//console.debug(paramName);
		//console.debug(paramValue);
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
//Sets option values. Leaves the non-mentioned values as is.
SettingsPage.prototype.setValues = function(values) {
	let inputs = this.content.getElementsByTagName('input');
	for (let i=0; i<inputs.length; i++) {
		if (!inputs[i].dataId) continue;
		let value = values[inputs[i].dataId];
		if (typeof value == 'undefined')
			continue;
		console.log('setting', inputs[i].dataId, 'to', value);
		if (inputs[i].type == 'checkbox')
			inputs[i].checked = value;
		else
			inputs[i].value = value;
	}
	inputs = this.content.getElementsByTagName('input');
	for (let i=0; i<inputs.length; i++) {
		if (!inputs[i].dataId) continue;
		let value = values[inputs[i].dataId];
		if (typeof value == 'undefined')
			continue;
		console.log('setting', inputs[i].dataId, 'to', value);
		inputs[i].value = value;
	}
}
//Collects and verifies option values
SettingsPage.prototype.collectResults = function() {
	let results = {};
	let inputs = this.content.getElementsByTagName('input');
	for (let i=0; i<inputs.length; i++)
	{
		let value = null;
		if (inputs[i].type == 'checkbox')
			value = inputs[i].checked;
		else
			value = inputs[i].value;
		results[inputs[i].dataId] = value;
	}
	inputs = this.content.getElementsByTagName('select');
	for (let i=0; i<inputs.length; i++)
		results[inputs[i].dataId] = inputs[i].value;
	//console.debug('SettingsPage.collectResults:', results);
	return results;
}

/*
Backend settings page
*/
function BackendSettingsPage(backendName, settings, values) {
	console.log('BackendSettingsPage:', arguments);
	if (!backendName)
		backendName = 'Connection';
	SettingsPage.call(this, backendName+' settings:', settings, values);
}
inherit(SettingsPage, BackendSettingsPage);


/*
Task lists reloading
Each account has a cached ui.tasklists[] that's filled by reloadAccountTaskLists().
Task list boxes reload by these caches.
*/
//Starts the task list reload process for all accounts. The UI will be updated dynamically
function reloadAllAccountsTaskLists() {
	console.debug('reloadAllAccountsTaskLists');
	for (let i in accounts)
		reloadAccountTaskLists(accounts[i]);
	if (accounts.length <= 0) {
		console.debug('reloadAllAccontsTaskLists: No accounts, tasklistBox.reload() to empty');
		tasklistBox.reload(); //no accounts => no one will trigger visuals
	}
}
//Reloads the task lists for the specified account and updates the UI (the rest of the lists are not reloaded)
function reloadAccountTaskLists(account) {
	console.debug('reloadAccountTaskLists:', account);
	let prom = null;
	if (!account.isSignedIn()) {
		console.debug('Not initialized/not signed in, no lists');
		prom = Promise.resolve(null); //Not empty []; "not yet loaded".
		//Note: we load tasklits, account signs out, signs in again -
		// we want tasklists to be null until we load them for the first time again
	} else
		prom = account.tasklistList();
	
	prom.then(tasklists => {
		//Optimize away some obvious cases of nothing changed
		if (!account.ui.tasklits && !tasklists)
			return; //but if it's "null -> []" or "[] -> null", we should transition
		if (Array.isArray(account.ui.tasklists) && isEmpty(account.ui.tasklists) && Array.isArray(tasklists) && isEmpty(tasklists))
			return;
		account.ui.tasklists = tasklists;
		console.log('reloadAccountTaskLists: new lists available for account', account);
		accountStateChanged(account);
	});
	return prom;
}


/*
Task list selection box
Each entry's .value is a JSON.stringify({ account: accountId, tasklist: tasklistId }).
*/
//Note: You can't compare these as objects. For easy comparison compare as String(a) == String(b)
function TaskListHandle(account, tasklist) {
	this.account = account;
	this.tasklist = tasklist;
}
TaskListHandle.prototype.toString = function() {
	let account = this.account;
	if (!!account && !(typeof account == 'string')) //just in case we're already given the ID
		account = account.id;
	return JSON.stringify({account: account, tasklist: this.tasklist});
}
TaskListHandle.fromString = function(value) {
	if (!value)
		return null;
	value = JSON.parse(value);
	//Convert account ID to account object
	if (!!value.account)
		value.account = accountFind(value.account);
	return new TaskListHandle(value.account, value.tasklist);
}
//The box itself
function TaskListBox(boxElement) {
	if (!boxElement)
		boxElement = document.createElement('select');
	boxElement.classList.add('taskListBox');
	this.box = boxElement;
	this.showAccounts = options.showAccountsInCombo;
	this.selectAccounts = options.accountsClickable;
	this.selectFailedAccounts = false;
}
TaskListBox.prototype.reload = function() {
	console.debug('tasklistBoxReload');
	var oldSelection = this.box.value;

	nodeRemoveAllChildren(this.box); //clear the list
	
	for (let i in accounts) {
		let account = accounts[i];
		if (!account)
			continue;
		console.debug('tasklistBoxReload: account=', account, 'signedIn=', account.isSignedIn(), 'ui=', account.ui);
		
		//Add a "grayed line" representing the account
		let option = document.createElement("option");
		option.text = account.uiName();
		option.classList.add("optionAccount");
		option.value = String(new TaskListHandle(account.id, undefined));
		if (!this.selectAccounts)
			option.disabled = true; //Normally can't select this
		
		if (!account.isSignedIn() || !account.ui || !account.ui.tasklists || isArrayEmpty(account.ui.tasklists)) {
			if (this.selectFailedAccounts)
				option.disabled = false; //No task lists => make the account always selectable
			if (account.error)
				option.text = option.text+' (error)';
			else if (!account.isSignedIn())
				option.text = option.text+' (signing in)';
			else if (!!account.ui && !!account.ui.tasklists && isArrayEmpty(account.ui.tasklists))
				option.text = option.text+' (no lists)';
			option.classList.add("grayed");
			this.box.add(option);
			continue;
		} else
		//Otherwise add account entry if the options tell us so
		if (this.showAccounts)
			this.box.add(option);
		
		for (let j in account.ui.tasklists) {
			let tasklist = account.ui.tasklists[j];
			let option = document.createElement("option");
			option.value = String(new TaskListHandle(account.id,  tasklist.id));
			option.text = tasklist.title;
			if (this.showAccounts)
				option.classList.add('offset');
			this.box.add(option);
		}
	}
	
	if (accounts.length <= 0) {
		let option = document.createElement("option");
		option.hidden = true;
		option.text = "No accounts";
		option.value = "";
		this.box.add(option);
		this.box.classList.add("grayed");
	} else {
		this.box.classList.remove("grayed");
	}
	
	//Select the same item as before, if possible -- but do not trigger changed()
	this.box.value = oldSelection;
}
//Returns the { account: account, tasklist: tasklist } structure or null.
TaskListBox.prototype.selected = function() {
	let value = this.box.value;
	if (!!value)
		value = TaskListHandle.fromString(value);
	return value;
}
TaskListBox.prototype.selectedTitle = function() {
	return this.box.options[this.box.selectedIndex].text;
}
//Selects the { account: accountId, tasklist: tasklistId } entry.
//noNotify: Do not call changed() -- we're simply restoring the control state
TaskListBox.prototype.setSelected = function(tasklist, noNotify) {
	console.debug('setSelectedTaskList:', arguments);
	tasklist = String(tasklist);
	if (this.box.value == tasklist)
		return; //nothing to change
	this.box.value = tasklist;
	this.changed(); //Won't get called automatically
}
TaskListBox.prototype.changed = function() {
	this.box.dispatchEvent(new Event('change'));
}


/*
Main task list selection box
Tries to select the best available replacement if the exact list is temporarily unavailable
*/
function MainTaskListBox(boxElement) {
	TaskListBox.call(this, boxElement);
	this.selectFailedAccounts = true;
	this.box.addEventListener('change', () => { this._handleChanged(); })
}
inherit(TaskListBox, MainTaskListBox);
MainTaskListBox.prototype.reload = function() {
	let oldSelection = this.box.value;
	TaskListBox.prototype.reload.call(this);

	//Try to restore the selection or choose the best substitution:
	//1. Start with whatever was selected
	let newSelection = oldSelection;

	//2. If the URI gives us something else, prefer that.
	//   Normally the URI tracks the current selection and we only temporarily deviate from that while the account is loaded
	//   Note: We ALWAYS follow the URL, but we only update it if urlTrack is enabled.
	let urlState = urlReadState();
	if (urlState)
		newSelection = urlState;
	
	//Try to apply either the URL or the old selection (when no URL instructions)
	this.box.value = String(newSelection); //may be string, may be structure
	if ((this.box.selectedIndex >= 0) && (!this.box.options[this.box.selectedIndex].disabled)) { //That worked.
		//Do not call changed() if simply restored what was there
		if (String(oldSelection) != String(newSelection))
			//NB: A simple changed() works here too!
			//  But IN FACT we only get here by following the URI command so optimize a bit
			this.changedSkipUrl();
		return;
	}

	/*
	Could not select the best option, try substitutes:
	2. First non-disabled item for the same account, INCLUDING the account itself
	3. First non-disabled item in the list
	4. Nothing (-1)
	*/
	console.debug('tasklistBox.reload: Selection', String(newSelection), 'is lost, selecting a substitute');
	if (typeof newSelection == 'string')
		newSelection = TaskListHandle.fromString(newSelection); //parse the selection string

	let newIndex = -1;
	let firstNonDisabledIndex = -1;
	for (let i=0; i<this.box.options.length; i++) {
		let option = this.box.options[i];
		if (option.disabled || !option.value)
			continue;
		if (firstNonDisabledIndex < 0)
			firstNonDisabledIndex = i;
		if (!newSelection || !newSelection.account)
			break; //found the first entry; no point in iterating further
		let handle = TaskListHandle.fromString(option.value);
		if (!!handle && (handle.account == newSelection.account)) {
			newIndex = i;
			break;
		}
	}
	console.debug('newIndex:', newIndex, 'firstNonDisabledIndex:', firstNonDisabledIndex, 'base sel:', newSelection);
	if (newIndex < 0)
		newIndex = firstNonDisabledIndex;
	this.box.selectedIndex = newIndex; //may even be -1
	
	/*
	URL permanency rules:
	1. Anything (tasklist or account page in any state) is permanent if selected manually by user.
	2. Task list substitutions are permanent. We don't want the user yanked out of the list when the URL match loads.
	3. Account page substitutions are:
	  - Transient when "Loading..." - don't change the URL.
	  - Permanent when loaded (but can only remain selected if that's enabled in options).
	  - Permanent/transient when errored, doesn't matter.
	*/
	let resultSelection = this.selected();
	if (String(oldSelection) == String(resultSelection))
		return; //Nothing in fact changed, somehow
	if (!resultSelection || !resultSelection.account) {
		this.changedSkipUrl(); //Nothing is now selected -- don't make this permanent
		return;
	}
	if (resultSelection.tasklist) {
		this.changed(); //Task lists are always permanent
		return;
	}
	if (!resultSelection.account.ui || !resultSelection.account.ui.tasklists || !!resultSelection.account.error) {
		this.changedSkipUrl(); //Not yet loaded, the substitution is transient
		return;
	}
	this.changed(); //Otherwise permanent
}
MainTaskListBox.prototype.changedSkipUrl = function() {
	this.skipUrl = true;
	this.changed();
}
MainTaskListBox.prototype._handleChanged = function() {
	if (this.skipUrl) {
		this.skipUrl = false;
		return;
	}
	if (options.urlTrack)
		urlSaveState(this.selected());
	else
		//ALWAYS write something to the URL, or if someone passes us params we'll apply them again and again
		urlSaveState(null);
}
var tasklistBox = new MainTaskListBox(document.getElementById('listSelectBox'));

//Save/restore the selected task list via the URL
function urlSaveState(selected) {
	let state = {};
	if (!!selected && !!selected.account) {
		state['a'] = selected.account.id;
		if (!!selected.tasklist)
			state['l'] = selected.tasklist;
	}
	urlWrite(state);
}
function urlReadState() {
	let data = urlRead();
	if (!data || !('a' in data))
		return null; //nothing useful
	let account = accountFind(data['a']) || data['a']; //resolve account if possible
	let selected = new TaskListHandle(account, data['l']);
	return selected;
}


//Backend for the currently selected list. Only set if the backend is initialized.
var backend = null;

function selectedTaskList(){ return tasklistBox.selected(); }
function selectedTaskListTitle() { return tasklistBox.selectedTitle(); }
function setSelectedTaskList(tasklist, noNotify) { return tasklistBox.setSelected(tasklist, noNotify); }
//Called when the selected task list had been chagned
function selectedTaskListChanged() {
	console.debug('selectedTaskListChanged');
	tasklist = selectedTaskList();
	if (!!tasklist && !!tasklist.account)
		backend = tasklist.account;
	else
		backend = null;
	accountActionsUpdate();
	tasklistActionsUpdate();
	return tasklistReloadSelected();
}
//Update available tasklist actions depending on the selected tasklist and available backend functions
function tasklistActionsUpdate() {
	var tasklist = selectedTaskList();
	console.debug('tasklistActionsUpdate:', tasklist, backend);
	element("listAddBtn").classList.toggle("hidden",    !backend || !backend.tasklistAdd);
	element("listRenameBtn").classList.toggle("hidden", !backend || !backend.tasklistUpdate || !tasklist);
	element("listDeleteBtn").classList.toggle("hidden", !backend || !backend.tasklistDelete || !tasklist);
	element("tasksExportAllToFile").classList.toggle("hidden", !tasklist);
	tasksActionsUpdate();
}
//Update available account actions depending on the selected account/tasklist and its state and available functions
function accountActionsUpdate() {
	console.debug('accountActionsUpdate', backend);
	let accountResetBtn = element("accountResetBtn");
	if (accountResetBtn) //missing in non-debug
		accountResetBtn.classList.toggle("hidden", !backend || !backend.reset);
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
(See: taskMerge, editor.open)
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

//Reloads the currently selected task list. Tries to preserve focus. Returns a promise.
function tasklistReloadSelected() {
	console.debug('tasklistReloadSelected');
	var oldFocus = tasks.getFocusedEntry();
	if (oldFocus)
		oldFocus = { id: oldFocus.getId(), pos: oldFocus.getCaret() };

	tasks.clear();
	
	var selected = selectedTaskList();
	if (!backend || !selected) {
		console.debug('tasklistReloadSelected: no tasklist entry selected');
		return Promise.resolve();
	}

	console.debug('Loading list: ', selected);
	if (backend.selectTaskList)
		backend.selectTaskList(null); //clear the cache
	

	//If no specific tasklist is selected, hide this list
	tasks.root.classList.toggle('hidden', !selected.tasklist);
	//Show/hide the account-wide page accordingly
	accountPageReload(selected);
	if (!selected.tasklist)
		return Promise.resolve();

	return backend.selectTaskList(selected.tasklist)
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
//Shows/hides and reloads contents for the "account-wide page" (no specific tasklist selected)
function accountPageReload(selected) {
	if (typeof selected == 'undefined')
		selected = selectedTaskList();
	
	let messages = document.getElementById('listMessages');
	nodeRemoveAllChildren(messages);

	//If what's selected is not an "account-wide page", we're not concerned
	if (!selected || !selected.account || !!selected.tasklist) {
		messages.classList.add('hidden');
		return;
	}
	messages.classList.remove('hidden');
	
	let account = selected.account;
	if (account.error) {
		messages.innerHTML = 'Could not initialize the backend '+selected.account.uiName()
			+'.<br />Error: '+account.error;
		messages.appendChild(li(linkNew(null, accountEditSettings, 'Change account settings')));
	}
	else if (!account.isSignedIn() || !account.ui || !account.ui.tasklists)
		messages.innerHTML = 'Signing in...<br />If this takes too long, perhaps there are problems';
	else {
		//Task lists
		let listP = document.createElement('p');
		if (isArrayEmpty(account.ui.tasklists))
			listP.textContent = 'No task lists in this account.';
		else {
			listP.textContent = "Task lists:";
			for (let j in account.ui.tasklists) {
				let tasklist = account.ui.tasklists[j];
				listP.appendChild(li(
					linkNew(null, () => {
						setSelectedTaskList(new TaskListHandle(account.id, tasklist.id))
					}, tasklist.title)
				));
			}
		}
		
		//"Add task list"
		if (!!account.tasklistAdd)
			listP.appendChild(li(linkNew(null, tasklistAdd, 'Add a task list')));
		else
			listP.appendChild(li("Task lists cannot be added to this account."));
		messages.appendChild(listP);
		
		//Actions
		let actionsP = document.createElement('p');
		actionsP.appendChild(li(linkNew(null, accountEditSettings, 'Change account settings')));
		if (options.debug && account.reset)
			actionsP.appendChild(linkNew(null, accountReset, 'Reset account'));
		messages.appendChild(actionsP);
	}
}

//Called when the focused task changes
function tasksFocusChanged() {
	console.debug('tasksFocusChanged');
	tasksActionsUpdate();
}
//Updates available task actions depending on the selected task and backend functionality
function tasksActionsUpdate() {
	console.debug('tasksActionUpdate');
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
    entry.whenHaveId().then(taskId => editor.open(taskId));
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
    //console.log(event);
    
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
      if (!options.noMergeByBackspace && (caretPos == 0) && window.getSelection().isCollapsed) {
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
    //console.log("taskEntryTitleFocusOut: "+event.entry);
    taskEntryTitleCommitNow(event.entry);
  }
  function taskEntryTitleTriggerClear() {
    //console.log("taskEntryTitleTriggerClear");
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
    
    console.log("taskEntryTitleCommitNow");
    taskEntryTitleTriggerClear();
    if (!entry) {
      timeoutPromiseResolve();
      return;
    }
    
    var patch = {};
    patch.title = taskEntryNormalizeTitle(entry.getTitle());
    //console.log('newText: "'+patch.title+'"');
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
    //console.log("taskEntryTab");
    if (!backend || !backend.move) return;
    taskEntryTitleCommitNow(entry); //commit any pending changes
    
    //Find immediate previous sibling on the same task level
    var prevEntry = entry.getPreviousSibling();
    if (!prevEntry) {
      console.log("Already first sibling, can't shift right");
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
    //console.log("taskEntryShiftTab");
   	if (!backend || !backend.move) return;
    taskEntryTitleCommitNow(entry); //commit any pending changes
    
    if (entry.getLevel() <= 0) {
      console.log("Already top element, can't tab up");
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
    //console.log("taskMerge");
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
      //console.log("have entry data");
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
          //console.log("patched entry to");
          //Move children first!
          return backend.moveChildren(entryWhatId, entryToId, newPrevChildId);
        }).then(response => {
          //console.log("moved children")
          return backend.deleteWithChildren(entryWhatId);
        });
    });
    pushJob(job);
  }
  
  //Merges the next entry into this one
  function taskMergeForward(entry) {
    //console.log("taskMergeForward");
    var entry_after = entry.getNext(); //at any level
    if (!entry_after) return;
    return taskMerge(entry, entry_after);
  }
  
  function taskMergeBackward(entry) {
    //console.log("taskMergeBackward");
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
    //console.log(prevEntry);
    
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
      //console.log("running backend.moveChildren")
      return backend.moveChildren(prevTaskId, newTaskId, null);
    });
    return pushJob(job);
  }

  /*
  Moves all children of the task out of it.
  Makes the first child their new parent.
  */
  function taskLiberateChildren(entry) {
    //console.log("taskLiberateChildren:");
    //console.log(entry);
    var children = entry.getChildren();
    if (!children || (children.length <= 0))
      return Promise.resolve();
    
  	if (!backend || !backend.move)
  	  return Promise.reject("Not implemented");
    
    var entryParent = entry.getParent();
    
    //Of the child tasks select the top one
    var firstChild = children.splice(0, 1)[0];
    //console.log("taskLiberateChildren: Making this one new parent:");
    //console.log(firstChild);
    
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
  function taskMoveToList(entry, newTasklist) {
  	console.log('taskMoveToList', entry, newTasklist);
    //If we're given a (account, list) object, split it
    if (!!newTasklist.account) {
        newBackend = newTasklist.account;
        newTasklist = newTasklist.tasklist;
    } else
    	newBackend = null;
    
    var whenTaskId = entry.whenHaveId(); //before we .delete() it
    
    //Delete the nodes first, THEN move the task:
    //responsible UI + we won't have children lists after we delete the local tasks
    entry.getAllChildren().forEach(child => tasks.delete(child));
    tasks.delete(entry);
    
    var job = whenTaskId
    .then(taskId => {
    	console.log('taskPatchMoveToList: moving', taskId, 'to newList=', newTasklist, ', newBackend=', newBackend);
    	console.log('current backend:', backend);
    	backend.moveToList(taskId, newTasklist, newBackend);
    });
    return pushJob(job);
  }

  //Edits the task and immediately moves it and all of its children to a different tasklist
  function taskPatchMoveToList(patch, newTasklist) {
    //Previously this function tried to optimize by only patching the cache,
    //and then expecting that backend.moveToList() is a copy+delete, and it uses data from cache.
    //Both assumptions are wrong in general case, so no optimization:
    console.log('taskPatchMoveToList', patch, newTasklist);
    return taskPatch(patch)
    .then(() => taskMoveToList(tasks.find(patch.id), newTasklist));
  }


/*
Tasklist and account actions
*/

function tasklistAdd() {
	if (!backend || !backend.tasklistAdd) return;
	var title = prompt("Enter a name for the new task list in '"+backend.uiName()+"':", "");
	if (!title)
		return;

	var newTasklistId = null;
	var job = backend.tasklistAdd(title)
	.then(result => {
		newTasklistId = result.id;
		return reloadAccountTaskLists(backend)
	})
	.then(response => {
		setSelectedTaskList(new TaskListHandle(backend, newTasklistId));
	});
	pushJob(job);
}

function tasklistRename() {
	if (!backend || !backend.tasklistUpdate) return;
	var oldTitle = selectedTaskListTitle();
	var title = prompt("Enter new name for this task list:", oldTitle);
	if (!title || (title == oldTitle))
		return;
	var tasklist = selectedTaskList();
	if (!tasklist || !tasklist.tasklist) return;
	var patch = {
		'id': tasklist.tasklist,
		'title': title,
	};
	var job = backend.tasklistPatch(patch)
		.then(result => reloadAccountTaskLists(backend));
	pushJob(job);
}

function tasklistDelete() {
	if (!backend || !backend.tasklistDelete) return;
	if (tasks.first() != null) {
		window.alert("This task list is not empty. Please delete all tasks before deleting the task list.");
		return;
	}

	var tasklist = selectedTaskList();
	if (!tasklist || !tasklist.tasklist) return;
	var title = selectedTaskListTitle();
	if (!confirm('Are you SURE you want to delete task list "'+title+'"?'))
		return;
	var job = tasklist.account.tasklistDelete(tasklist.tasklist)
	.then(result => reloadAccountTaskLists(tasklist.account));
	pushJob(job);
}



/*
Editor page
*/
function Editor() {
	this.page = document.getElementById("editorPage");
	this.taskListBox = new TaskListBox(document.getElementById("editorTaskList"));
	this.taskListBox.selectAccounts = false; //whatever the options say
	this.taskListBox.selectFailedAcconts = false;
	this.saveBtn = document.getElementById("editorSave");
	this.saveCopyBtn = document.getElementById("editorSaveCopy");
	this.cancelBtn = document.getElementById("editorCancel");
	this.deleteBtn = document.getElementById("editorDelete");
	this.taskId = null;
	this.listPageBackup = {}; //overwritten properties of listPage
	
	//Preserve proper "this" by lambdas
	this.taskListBox.box.onchange = () => { this.taskListChanged(); };
	this.saveBtn.onclick = () => { this.saveClose(); };
	this.saveCopyBtn.onclick = () => { this.saveCopyClose(); }
	this.cancelBtn.onclick = () => { this.cancel(); };
	this.deleteBtn.onclick = () => { this.deleteBtnClick(); };
}

//Show the editor
Editor.prototype.open = function(taskId) {
	if (!taskId) return;
	console.log("Opening editor for task "+taskId);

	//Title edits sometimes are not yet commited even though we've sent the request
	var job = waitCurrentJobsCompleted()
	//Load the task data into the editor
	.then(results => backend.get(taskId))
	.then(task => {
		if (!task) {
			console.log("Failed to load the requested task for editing");
			this.taskId = null;
			return;
		}
		this.taskListBox.reload();
		document.getElementById("editorTaskTitle").innerText = task.title;
		document.getElementById("editorTaskTitleBox").checked = (task.completed != null);
		document.getElementById("editorTaskTitleP").classList.toggle("completed", task.completed != null);
		document.getElementById("editorTaskDate").valueAsDate = (task.due) ? (new Date(task.due)) : null;
		document.getElementById("editorTaskNotes").value = (task.notes) ? task.notes : "";
		this.taskListBox.setSelected(selectedTaskList());

		this.taskId = taskId;
		
		this.taskListChanged(); //update move notices

		this.listPageBackup.display = listPage.style.display;
		listPage.style.display = "none";
		this.page.classList.remove("hidden");
	});
	pushJob(job);
}
//Called when the user selects a new list to move task to
Editor.prototype.taskListChanged = function() {
	//console.debug('taskListChanged');
	if (!this.taskId) return;
	let oldTaskList = selectedTaskList();
	let newTaskList = this.taskListBox.selected();
	//console.debug('taskListChanged: new=', newTaskList, ', old=', oldTaskList);
	document.getElementById("editorSaveCopy").classList.toggle('hidden', String(newTaskList) == String(oldTaskList));
	document.getElementById("editorMoveNotice").classList.toggle('hidden', String(newTaskList) == String(oldTaskList));
	document.getElementById("editorMoveBackendNotice").classList.toggle('hidden', newTaskList.account == oldTaskList.account);
}
//Retrieves a patch based on the changes in the editor
Editor.prototype.getPatch = function() {
	var patch = { "id": this.taskId };
	taskResSetCompleted(patch, document.getElementById("editorTaskTitleBox").checked);
	patch.due = document.getElementById("editorTaskDate").valueAsDate; //null is fine!
	patch.notes = document.getElementById("editorTaskNotes").value;
	return patch;
}
//Save the task data currently in the editor
Editor.prototype.saveClose = function() {
	if (!this.taskId) {
		this.cancel();
		return;
	}

	var patch = this.getPatch();
	var job = null;

	var newList = this.taskListBox.selected();
	if (String(newList) == String(selectedTaskList()))
		//Simple version, just edit the task
		job = taskPatch(patch);
	else
		//Complicated version, edit and move
		job = taskPatchMoveToList(patch, newList);

	job = job.then(response => this.cancel());
	pushJob(job);
}
//Save the data currently in the editor as a copy in another list
Editor.prototype.saveCopyClose = function() {
	if (!this.taskId) {
		this.cancel();
		return;
	}
	
	var patch = this.getPatch();
	var newList = this.taskListBox.selected();
	if (!newList || !newList.account || !newList.tasklist)
		return;
	
	//Get the current version of the task
	let job = backend.get(this.taskId)
	.then(task => {
		//Patch the task in memory. Let's hope copyToList uses this. (Otherwise we should copy and THEN edit)
		resourcePatch(task, patch);
		//Copy recursively
		let items = {};
		items[task.id] = { task: task };
		return backend.copyToList(items, newList.tasklist, newList.account, true);
	});
	job = job.then(response => this.cancel());
	pushJob(job);
}

//Close the editor
Editor.prototype.cancel = function() {
	console.log("Closing the editor");
	this.page.classList.add("hidden");
	listPage.style.display = this.listPageBackup.display;
	this.taskId = null;
}

Editor.prototype.deleteBtnClick = function() {
	if (!this.taskId)
		return;
	pushJob(
		taskDelete(tasks.find(this.taskId))
		.then(response => this.cancel())
	);
}

var editor = new Editor();


/*
Currently this is called on load so index.js should be the last script in the list.
*/
initUi();
