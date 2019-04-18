This is a Google Tasks IG client clone written from scratch.

Google Tasks is a service by Google partially integrated in Calendar. It had a separate lightweight JS frontend perfect for a using in a browser sidebar, which had been shut down:

> https://mail.google.com/tasks/ig

This project reimplements everything in that frontend from scratch. It uses Google Tasks API to access Tasks but can support different backends.

### Features
* Pure JS, runs in the browser -- though still needs to be hosted somewhere to access Google APIs, see below.
* Self-hosted
* Works with Google Tasks
* Implements most Google Tasks IG interface features: inline editing, enter-splits, backspace-deletions, tab/shift-tab, keyboard navigation, move to list, task list commands. If something is missing, file a bug.
* Firefox/Chrome/Opera extension to display your Tasks IG instance (or any page really) in a side panel
* LocalStorage backend as a proof of concept. Though I don't recommend storing anything important in it because its glorified cookies.

Once Google shuts down Tasks which they will eventually do because they shut down everything, I might write a CalDAV Tasks backend.

### Caveats

1. You'll need to host this extension somewhere and create API keys from Google. Or find someone who hosts it and use their instance (if you trust them).
  It would be nice to simply run this from extension in the browser, but Google APIs need an origin hostname.

2. If you want to use the browser extension part you might have to sign it somewhere if your browser requires that.


### Attribution
This project uses free icons from various sources. Please see res/readme.txt for attributions.
