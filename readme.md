Google Tasks is a service by Google partially integrated in Calendar. It had a separate lightweight JS frontend perfect for a using in a browser sidebar, which had been shut down:

> **https://mail.google.com/tasks/ig**

This project reimplements everything in that frontend from scratch. It uses Google Tasks API to access Tasks but can support different backends.

![Screenshot](docs/screen-features.png)


### Features
* Runs in the browser -- though still needs to be hosted somewhere to access Google APIs, see below.
* Self-hosted
* Works with Google Tasks
* Implements most Google Tasks IG interface features: inline editing, enter-splits, backspace-deletions, tab/shift-tab, keyboard navigation, move to list, task list commands. If something is missing, file a bug.
* Async requests -- fast UI
* Firefox/Chrome/Opera extension to display your instance (or any page) in a side panel
* LocalStorage backend as a proof of concept. Though I don't recommend storing anything important in it because it's glorified cookies.

Once Google shuts down Tasks which they will eventually do because they shut down everything, I might write a CalDAV Tasks backend.


### How to run this

**Plan A:**

1. You need a domain.

2. Upload the contents (excluding docs and extension) under some URL on your server.

3. Register new ``application`` in Google API Developer Console and create ``API Key`` and ``OpenID Client`` for it. Add your domain as a trusted domain for the ``application``, and your full URL as an allowed origin for that ``OpenID Client``. You may restrict ``API Key`` too but it's not required and first try without it.

4. Rename ``config-example.js`` to ``config.js`` and insert your API key and Client ID there.

5. Access the URL and press "Authorize with Google". (The local storage version should work from step 2).

It would be nice to simply run this from the browser extension or local files, but Google APIs need an origin hostname.

**Plan B:** Find someone who hosts it and use their instance (if you trust them).


### How to install the browser extension

See [extension/readme.md](extension/readme.md). Adjust the URL in the manifest. You might have to sign it somewhere if your browser requires that.


### Attribution
This project uses free icons from various sources. Please see res/readme.txt for attributions.
