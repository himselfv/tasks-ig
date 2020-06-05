
min.js: js
	.\node_modules\.bin\minify ./build/min/index.js --out-file ./build/min/index.min.js

js: build
	-rm -rf ./build/min/
	.\node_modules\.bin\browserify --standalone index .\build\base\index.js \
                -t [ babelify --presets [ @babel/preset-env ] ] \
                --outfile .\build\min\index.js

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
