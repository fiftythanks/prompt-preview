.DEFAULT_GOAL := build
EXTENSION_DIR ?=
RUNTIME_FILES := index.ts contract.ts reviewer.ts protected-text.ts settings.ts review-ui.ts
.PHONY: build install prototype
build:
	mkdir -p dist
	cp $(addprefix src/,$(RUNTIME_FILES)) dist/
install: build
	test -n "$(EXTENSION_DIR)"
	mkdir -p "$(EXTENSION_DIR)"
	cp $(addprefix dist/,$(RUNTIME_FILES)) "$(EXTENSION_DIR)/"
prototype:
	bun run prototype
