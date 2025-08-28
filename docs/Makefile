# Minimal makefile for Sphinx documentation
#

# You can set these variables from the command line, and also
# from the environment for the first two.
SPHINXOPTS    ?=
SPHINXBUILD  ?= sphinx-build
SOURCEDIR    = .
BUILDDIR     = build

# Put it first so that "make" without argument is like "make help".
help:
	@uv run $(SPHINXBUILD) -M help "$(SOURCEDIR)" "$(BUILDDIR)" $(SPHINXOPTS) $(O)

.PHONY: help Makefile

# Install dependencies
install:
	uv sync

# Install development dependencies
install-dev:
	uv sync --extra dev

# Lock dependencies
lock:
	uv lock

# Update dependencies
update:
	uv sync --upgrade

# Build HTML documentation
html:
	@uv run $(SPHINXBUILD) -b html "$(SOURCEDIR)" "$(BUILDDIR)/html" $(SPHINXOPTS) $(O)
	@echo
	@echo "Build finished. The HTML pages are in $(BUILDDIR)/html."

# Build documentation and watch for changes
livehtml:
	uv run sphinx-autobuild "$(SOURCEDIR)" "$(BUILDDIR)/html" $(SPHINXOPTS) $(O)

# Clean build directory
clean:
	rm -rf "$(BUILDDIR)"

# Build PDF documentation (requires LaTeX)
latexpdf:
	@uv run $(SPHINXBUILD) -b latex "$(SOURCEDIR)" "$(BUILDDIR)/latex" $(SPHINXOPTS) $(O)
	@echo "Running LaTeX files through pdflatex..."
	$(MAKE) -C "$(BUILDDIR)/latex" all-pdf
	@echo "pdflatex finished; the PDF files are in $(BUILDDIR)/latex."

# Build EPUB documentation
epub:
	@uv run $(SPHINXBUILD) -b epub "$(SOURCEDIR)" "$(BUILDDIR)/epub" $(SPHINXOPTS) $(O)
	@echo
	@echo "Build finished. The epub file is in $(BUILDDIR)/epub."

# Check documentation for common issues
linkcheck:
	@uv run $(SPHINXBUILD) -b linkcheck "$(SOURCEDIR)" "$(BUILDDIR)/linkcheck" $(SPHINXOPTS) $(O)
	@echo
	@echo "Link check complete; look for any errors in the above output " \
	      "or in $(BUILDDIR)/linkcheck/output.txt."

# Check documentation for spelling errors (requires sphinxcontrib-spelling)
spelling:
	@uv run $(SPHINXBUILD) -b spelling "$(SOURCEDIR)" "$(BUILDDIR)/spelling" $(SPHINXOPTS) $(O)
	@echo
	@echo "Spell check complete; look for any errors in the above output " \
	      "or in $(BUILDDIR)/spelling/."

# Build documentation in different formats
all: html epub latexpdf
	@echo "Documentation built in multiple formats."

# Development setup
dev-setup:
	uv sync --extra dev
	@echo "Development environment set up. Use 'make livehtml' for auto-rebuilding docs."

# Sync and build
sync-build: install html
	@echo "Dependencies synced and documentation built."

# Catch-all target: route all unknown targets to Sphinx using the new
# "make mode" option.  $(O) is meant as a shortcut for $(SPHINXOPTS).
%: Makefile
	@uv run $(SPHINXBUILD) -M $@ "$(SOURCEDIR)" "$(BUILDDIR)" $(SPHINXOPTS) $(O)
