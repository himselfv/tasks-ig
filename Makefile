
min.js: js
	.\node_modules\.bin\minify ./tmp/index.js --out-file ./tmp/index.min.js

js: build
#	-rm -rf /tmp/index.js
	.\node_modules\.bin\browserify --standalone index .\build\index.js \
                -t [ babelify --presets [ @babel/preset-env ] ] \
                --outfile .\tmp\index.js

build:
	npm run build
#	rm -rf build/
#	.\node_modules\.bin\babel src --out-dir build

