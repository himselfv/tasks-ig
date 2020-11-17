# Tasks IG hosting setup

#### Speed up self-hosted version

* Enable etags and set long timeout for caching of all js/css/resources to avoid repeated requests
* Compile Tasks IG with `make min` and host minified version: all JS merged into a single file (harder to debug).
* Merge all CSS files into one (and adjust index.html)


#### <a name="cors"></a>CalDAV and CORS
If your Tasks IG instance is hosted on a different server than your CalDAV, requests to CalDAV are [cross-origin](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS). [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) is a dubious browser security measure where a server must explicitly agree to receive the request before the browsers will even let the page send it.

It's a mess that browsers created and only the server side can fix. You have to configure CORS on CalDAV side:

* Return 200 on OPTIONS even when unauthenticated
* All requests are made with NO `withCredentials`. We'll try to stick to that as allowing `withCredentials` is a security hole.
* Set `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers` to `*`.
* `Access-Control-Expose-Headers` needs at least `WWW-Authenticate, etag`
* Respond to `Access-Control-Request-Headers` dynamically and return `Access-Control-Allow-Headers:` with requested headers specifically; the browsers won't be satisfied with '*' for some headers even in non-`withCredentials` mode.
* `Access-Control-Max-Age: 600` to cache at least some OPTION requests.

Here's a **[sample CORS .htaccess config](hosting-cors-htaccess-example.txt)** that works. [Here's another discussion with examples](https://github.com/perry-mitchell/webdav-client/issues/116).


#### Speed up CalDAV
1. Disable Service Discovery and provide a direct URL in account settings => -1 request.
2. If you're using HTTPS DAV Link, switch your server from Digest to Basic auth => -1 request. Digest auth unavoidably starts with a 403. Warning: For non-encrypted HTTP DAV, Basic auth is unsafe.
3. Place Tasks on the same server as your CalDAV instance - this removes CORS entirely (up to 2x the number of requests). _Protocol_, _host_ and _port_ all need to match. If you're using HTTPS for CalDAV (as you should), use HTTPS for Tasks too.


### <a name="gtasks"></a>Google Tasks
Google only allows third-party apps to access Tasks either [from a Chrome extension](../readme.md#extensions), or from your own domain if you configure Google API keys.

To configure Google Tasks on a hosted version:

1. You need a domain. Google API requires having an origin hostname.

2. Upload the contents (excluding docs and extension) under some URL on your server.

3. Register new ``application`` in Google API Developer Console and create ``API Key`` and ``OpenID Client`` for it. Add your domain as a trusted domain for the ``application``, and your full URL as an allowed origin for that ``OpenID Client``. You may restrict ``API Key`` too but it's not required and first try without it.

4. Rename ``config-example.js`` to ``config.js`` and insert your API key and Client ID there.

5. Access the URL and press "Authorize with Google". (The local storage version should work from step 2).
