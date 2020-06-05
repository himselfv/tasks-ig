'use strict';
/*
Processes manifest.json into ones appropriate for Chrome or Firefox extensions.
*/
const fs = require('fs');

let argv = process.argv;
if (argv.length != 4) {
	console.error('Usage: ', argv[0], argv[1], ' <manifest.json> <mode>');
	console.error('Allowed modes: chrome, firefox');
	return -1;
}
let mode = argv[3].toLowerCase();
if (['chrome', 'firefox'].indexOf(mode) < 0)
	throw Error("Unsupported mode: "+argv[3]);


let rawdata = fs.readFileSync(argv[2], 'utf8');
if (rawdata instanceof Error)
  	throw Error('Cannot read file:', argv[2], ':', rawdata);

//All modes: strip comment lines
function stripCommentLines(data) {
	//Remove all comments -- lines starting with //
	let lines = data.split('\n');
	for (let i=lines.length-1; i>=0; i--) {
		let line = lines[i].trim();
		if (line.startsWith('//'))
			lines.splice(i,1);
	}
	return lines.join('\n');
}
rawdata = stripCommentLines(rawdata)

//Parse as JSON
let manifestJson = JSON.parse(rawdata);

//All modes: update version
//Load package.json
let packageJson = JSON.parse(fs.readFileSync('./package.json'));
manifestJson['version'] = packageJson['version'];

if (mode=='firefox') {
  //Firefox doesn't need these
  delete manifestJson['key'];
  delete manifestJson['content_security_policy'];
  delete manifestJson['oauth2'];
  delete manifestJson['tasks_api_key'];
  manifestJson['permissions'] = manifestJson['permissions'].filter(item => item!='identity');
  //Firefox has a different description
  manifestJson['description'] = "Sidebar task list manager resembling Google Tasks IG with a browser storage backend";
}

//Output
console.log(JSON.stringify(manifestJson, null, "\t"));
