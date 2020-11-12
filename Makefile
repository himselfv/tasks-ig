
all: build min ext

build: always
	-rm -rf ./build/base/
	npm run build
#	Remove unrelated
	-rm -rf ./build/base/dav/ical-readme.txt
	-rm -rf ./build/base/dav/README.md
#	Avoid building with personalized config.jses
	-rm -rf ./build/base/dav/config.js

min: build
	-rm -rf ./build/min/ ./build/min-tmp/
	.\node_modules\.bin\browserify --standalone index .\build\base\index.js \
                -t [ babelify --presets [ @babel/preset-env ] ] \
                --outfile .\build\min-tmp\index.js
	.\node_modules\.bin\minify ./build/min-tmp/index.js --keepFnName --out-file ./build/min-tmp/index.min.js
#	Copy the resources
	mkdir ./build/min/
	cp -R ./build/min-tmp/index.min.js ./build/min/index.js
	cp ./src/index.html ./build/min/index.html
#	Add +1 space before index.js to distinguish it from the rest
	sed -i -e 's/src=\"index\.js/\x20\0/' ./build/min/index.html
	sed -i -e 's/src=\"config\.js/\x20\0/' ./build/min/index.html
#	Remove the rest of JSes
	sed -i -e '/\^<script\x20src=.*/d' ./build/min/index.html
	mkdir ./build/min/dav/
	cp ./src/dav/*.js ./build/min/dav/
	cp -R ./src/res ./build/min/res
	cp -R ./src/style ./build/min/style
	cp ./src/*.css ./build/min/


ext: ext-chrome ext-firefox

ext-chrome: build
	rm -rf ./build/ext-chrome
	cp -R ./build/base ./build/ext-chrome
	rm -rf ./build/ext-chrome/*.map
	rm -rf ./build/ext-chrome/dav/*.map
	rm -rf ./build/ext-chrome/config*.js
	node ./manifestgen.js ./src/manifest.json chrome > ./build/ext-chrome/manifest.json
# 	Chrome Developer Dashboard does not require keys for 2nd+ upload for now, don't auto-add
# 	cp ./_private/ext/key.pem ./build/ext-chrome/
#	Chrome extensions need to be just ZIPs on store upload
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

init: update

update:
	git submodule update --init --recursive
	npm update
# 	Import compiled versions runtime dependencies into this repo
	cp -f ./node_modules/ical.js/build/ical.min.js ./src/dav/ical.js
	cp -f ./node_modules/dav/dav.min.js ./src/dav/dav.js

always:
