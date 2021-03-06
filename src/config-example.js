/*
Options are set from the UI but the defaults can be changed:
*/
options = options || {};
options.noMergeByDelete = false; //Disable: Merge the next task into this one by Delete button
options.noMergeByBackspace = false; //Disable: Merge this task into the previous one by Backspace button
options.singleClickAdd = false; //Add new task with a single click on the empty space - as it had been in GTasks. Double click always works.
options.debug = false; //Enables debug backends and more logging

/*
GTasks backend: Client ID and API key from the Developer Console
Register your app here:
https://console.developers.google.com/cloud-resource-manager
See here how:
https://developers.google.com/tasks/firstapp

var GTASKS_CLIENT_ID = '';
var GTASKS_API_KEY = '';
*/
