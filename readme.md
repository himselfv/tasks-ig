Google Tasks is a service by Google partially integrated in Calendar. It had a separate lightweight JS frontend perfect for a using in a browser sidebar, which had been shut down:

> **https://mail.google.com/tasks/ig**

This project reimplements everything in that frontend from scratch. It uses Google Tasks API to access Tasks but can support different backends.

![Screenshot](docs/screen-features.png)

**[Try it here on GitHub](https://himselfv.github.io/tasks-ig/)** (local storage only)


### Features
* Runs in the browser, locally or self-hosted (for Google Tasks)
* Works with Google Tasks
* Implements most Google Tasks IG interface features: inline editing, enter-splits, backspace-deletions, tab/shift-tab, keyboard navigation, move to list, task list commands. If something is missing, file an issue.
* Async requests, fast UI with neat activity indicator
* Export tasks

Once Google shuts down Tasks which they will eventually do because they shut down everything, I might write a CalDAV Tasks backend.

### Runs as a:

* Chrome extension (on a separate page)
* Firefox/Opera extension (in a sidebar)
* Self-hosted &mdash; on your own domain
* Standalone &mdash; as a local HTML file, or [here on GitHub](https://himselfv.github.io/tasks-ig/)

Different backends are available in each case:

|				| Google Tasks	| Browser (sync)	| Browser (local)	|
|------				|:----:		|:----:			|:----:			|
| Chrome extension (page)	| +		| +			| +			|
| Firefox extension (sidebar)	| 		| +			| +			|
| Self-hosted			| +		| 			| + (less safe)		|
| Self-hosted in sidebar	| +		| 			| + (less safe)		|
| Local file or github		| 		| 			| + (less safe)		|

Browser backends are completely offline. The sync version is synchronized by the browser between your different PCs. The "less safe" versions use Local Storage instead of Extension's Storage and it's easy to reset by cleaning cookies, so I wouldn't store anything important.


### The browser extensions
For now the extensions are only available from here:

**Chrome**: Go to Extensions page and enable "Developer mode". Press "Load unpacked extension" and point it to the folder with Tasks IG.

**Firefox**: Go to `about:debugging`, check "Enable extension debugging" and press "Load temporary extension". Point it to the `manifest.json`


### Self-hosting
**Plan A:**

1. You need a domain.

2. Upload the contents (excluding docs and extension) under some URL on your server.

3. Register new ``application`` in Google API Developer Console and create ``API Key`` and ``OpenID Client`` for it. Add your domain as a trusted domain for the ``application``, and your full URL as an allowed origin for that ``OpenID Client``. You may restrict ``API Key`` too but it's not required and first try without it.

4. Rename ``config-example.js`` to ``config.js`` and insert your API key and Client ID there.

5. Access the URL and press "Authorize with Google". (The local storage version should work from step 2).

It would be nice to simply run this from the browser extension or local files, but Google APIs need an origin hostname.

**Plan B:** Find someone who hosts it and use their instance (if you trust them).


### Local file
Just double-click `index.html` or [access it on Github](https://himselfv.github.io/tasks-ig/).


### Attribution
This project uses free icons from various sources. Please see res/readme.txt for attributions.
