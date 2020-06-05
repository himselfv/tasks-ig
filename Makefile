
all: min.js ext

min.js: js
	.\node_modules\.bin\minify ./build/min/index.js --out-file ./build/min/index.min.js

js: build
	-rm -rf ./build/min/
	.\node_modules\.bin\browserify --standalone index .\build\base\index.js \
                -t [ babelify --presets [ @babel/preset-env ] ] \
                --outfile .\build\min\index.js

ext: ext-chrome ext-firefox

ext-chrome: build
	rm -rf ./build/ext-chrome
	cp -R ./build/base ./build/ext-chrome
	rm -rf ./build/ext-chrome/*.map
	rm -rf ./build/ext-chrome/config*.js
	node ./manifestgen.js ./src/manifest.json chrome > ./build/ext-chrome/manifest.json
	cp ./_private/ext/key.pem ./build/ext-chrome/
	cd .\build\ext-chrome && zip -r .\..\ext-chrome.zip *

ext-firefox: build
	rm -rf ./build/ext-firefox
	cp -R ./build/base ./build/ext-firefox
	rm -rf ./build/ext-firefox/*.map
	rm -rf ./build/ext-firefox/config*.js
	node ./manifestgen.js ./src/manifest.json firefox > ./build/ext-firefox/manifest.json
	cd .\build\ext-firefox && zip -r .\..\ext-firefox.zip *


build:
	-rm -rf ./build/base/
	npm run build

clean:
	-rm -rf ./build/*
	# Remove unrelated
	-rm -rf ./build/base/dav/ical-readme.txt
	-rm -rf ./build/base/dav/README.md
	# Avoid building with personalized config.jses
	-rm -rf ./build/base/dav/config.js
