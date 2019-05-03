List of extensions to build:

1. Chrome: Tasks IG Main
2. Firefox: Tasks IG Main
3. Firefox: Tasks IG Sidebar

FF and Chrome extensions have to be compiled separately. Source ``manifest.json`` should be loadable in developer mode in both and contain maximum amount of data:

* Chrome requires stable ``key`` so that the extension works with Google Tasks

## BUILDING
### COMMON
* Increase version number and commit
* Rename config.example.js => config.js
* Remove params related to Google API

### FIREFOX
* Adjust the description (Google Tasks is unavailable in Firefox)
* Remove ``content_security_policy`` (not required without GT and will trigger checks)
* Remove ``oauth`` and ``tasks_api_key`` as they're not needed
* Remove ``permission: identity``
* Remove ``key`` as Firefox doesn't need it
* Pack to ZIP, publish:
  https://addons.mozilla.org/en-US/developers/

### CHROME
* Remove all comments!
* Put the key file in the folder as ``key.pem``
* No need to delete ``gecko`` params
* No need to delete ``key``
* Pack to ZIP, publish:
  https://chrome.google.com/webstore/developer/dashboard/


### FIREFOX WEBPANEL
* Just pack the ZIP right from the source.


## FIREFOX EXTENSIONS
https://addons.mozilla.org/en-US/developers/

An extension must have UUID: ``applications\gecko\id`` - [Source](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings).
This can either be an email-like thing or a GUID. A GUID is better as less is implied.

https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Package_your_extension_


## CHROME AND EXTENSION KEYS
Every extension has ``id``, ``key`` and a ``secret key`` (``key.pem``). Only the last one is the true key. It should be kept private and secure, the rest are generated from it.

To specify your extension's key:

* When packing the extension with Chrome: Point to ``key.pem`` => all keys will automatically be correct.
* When publishing to Chrome Store: Include ``key.pem`` in the ZIP => all keys will automatically be correct.
* When debugging: Put ``key`` directly in the ``manifest.json``. This is safe to publish as it's only a derivative of ``key.pem``.

To generate the keys initially, pack the extension with Chrome, save the generated ``pem`` and find the ``key`` (folder name in ``AppData/Chrome/Default/Extensions``). [See here](https://stackoverflow.com/a/21500707).


## CHROME AND GOOGLE TASK APIS
``gapi.client.init`` authorization won't work from Chrome extension. ``init()`` will hang without returning. This is well known, [they won't fix](https://github.com/google/google-api-javascript-client/issues/64).

You can only authorize through the browser APIs:

* https://developer.chrome.com/apps/tut_oauth
* https://developer.chrome.com/apps/identity#method-getAuthToken
* https://developer.chrome.com/apps/app_identity#update_manifest

Authorize the extension:

1. Generate a permanent key for the extension (see above). Store the ``key.pem`` securely. You don't have to publish to Chrome Store yet.
2. Create an OAuthID for the extension's ID (e.g. ``nemjdegnmkepopaeifiolicbkgldjokn``)
3. Add APIKey restriction for web address ``chrome-extension://nemjdegnmkepopaeifiolicbkgldjokn``

Configure the extension:

1. Add to manifest:
    * ``permissions: 'identity'``
    * ``oauth2\client_id``
    * ``oauth2\scopes``
2. ``chrome.identity.getAuthToken({interactive: true}, token => { /*handle token*/ })``
3. ``gapi.client.setToken(token)``

Optional:

4. Store ``api_key`` in the manifest, read: ``chrome.runtime.getManifest().my_api_key``.

  Note: APIKey can be made public but it should be restricted so that it can only be used from the given referers.


## CHROME, SELF-HOSTED EXTENSIONS AND UPDATE_URL
**Windows**: Chrome will not accept self-hosted extensions no matter what. All extensions, even installed manually through registry, must be present in Chrome Store.

**Linux**: Chrome might accept self-hosted extensions (some docs permit that) but it might require hosting them on some domain and having ``update_url``s.

https://developer.chrome.com/apps/autoupdate#update_manifest
An extension must have ``update_url``:
```
  "update_url": "http://myhost.com/mytestextension/updates.xml",
```
This file must contain the latest version link (and any number of older ones):
```
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'>
    <updatecheck codebase='http://myhost.com/mytestextension/mte_v2.crx' version='2.0' />
  </app>
</gupdate>
```
In theory you can host all of this even on Github.
