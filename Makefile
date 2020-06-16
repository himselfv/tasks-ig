
all: build min ext

build: always
	-rm -rf ./build/base/
	npm run build
	rem Remove unrelated
	-rm -rf ./build/base/dav/ical-readme.txt
	-rm -rf ./build/base/dav/README.md
	rem Avoid building with personalized config.jses
	-rm -rf ./build/base/dav/config.js

min: build
	-rm -rf ./build/min/ ./build/min-tmp/
	.\node_modules\.bin\browserify --standalone index .\build\base\index.js \
                -t [ babelify --presets [ @babel/preset-env ] ] \
                --outfile .\build\min-tmp\index.js
	.\node_modules\.bin\minify ./build/min-tmp/index.js --out-file ./build/min-tmp/index.min.js
	rem Copy the resources
	mkdir ./build/min/
	cp -R ./build/min-tmp/index.min.js ./build/min/index.js
	cp -R ./build/base/res ./build/min/res
	mkdir ./build/min/dav/
	cp ./build/base/dav/*.js ./build/min/dav/
	cp ./build/base/index.html ./build/min/index.html
	cp ./build/base/style.css ./build/min/style.css

ext: ext-chrome ext-firefox

ext-chrome: build
	rm -rf ./build/ext-chrome
	cp -R ./build/base ./build/ext-chrome
	rm -rf ./build/ext-chrome/*.map
	rm -rf ./build/ext-chrome/dav/*.map
	rm -rf ./build/ext-chrome/config*.js
	node ./manifestgen.js ./src/manifest.json chrome > ./build/ext-chrome/manifest.json
	rem Chrome Developer Dashboard does not require keys for 2nd+ upload for now, don't auto-add
	rem cp ./_private/ext/key.pem ./build/ext-chrome/
	rem Chrome extensions need to be just ZIPs on store upload
	cd .\build\ext-chrome && zip -r .\..\ext-chrome.zip *

ext-firefox: build
	rm -rf ./build/ext-firefox
	cp -R ./build/base ./build/ext-firefox
	rm -rf ./build/ext-firefox/*.map
	rm -rf ./build/ext-firefox/dav/*.map
	rm -rf ./build/ext-firefox/config*.js
	node ./manifestgen.js ./src/manifest.json firefox > ./build/ext-firefox/manifest.json
	cd .\build\ext-firefox && zip -r .\..\ext-firefox.xpi *

clean:
	-rm -rf ./build/*

init:
	git submodule update --init --recursive
	npm install

always:
