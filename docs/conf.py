# Configuration file for the Sphinx documentation builder.
#
# For the full list of built-in configuration values, see the documentation:
# https://www.sphinx-doc.org/en/master/usage/configuration.html

# -- Project information -----------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#project-information

# Configuration file for the Sphinx documentation builder.
"""Sphinx configuration file for Athena NodeJS SDK documentation."""

import sys
from datetime import datetime, timezone
from pathlib import Path

# Add the project source directory to the Python path
sys.path.insert(0, str(Path("../athena").resolve()))

# Project information
project = "Athena Classifier NodeJS SDK"
copyright = f"{datetime.now(timezone.utc).year}, Crisp"
author = "Crisp Thinking Gorup Ltd."
release = "1.0.0"

js_language = "typescript"
js_source_path = "../src/"
jsdoc_config_path = "../typedoc.json"

# Extensions
extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.napoleon",
    "sphinx.ext.viewcode",
    "sphinx.ext.autosummary",
    "sphinx.ext.inheritance_diagram",
    "sphinx.ext.intersphinx",
    "sphinx.ext.todo",
    "sphinx_ts",
]

# Add any paths that contain templates here, relative to this directory
templates_path = ["_templates"]

# Template configuration
autosummary_generate = True
add_module_names = False
autodoc_typehints = "description"
autodoc_preserve_defaults = True


# List of patterns to ignore when looking for source files
exclude_patterns = [
    "build",
    "Thumbs.db",
    ".DS_Store",
    "**/generated/**",
    "**/tests/**",
    "**/__pycache__/**",
    "**/.pytest_cache/**",
    "**/.mypy_cache/**",
    "**/.ruff_cache/**",
    # Exclude files with duplicate documented objects
    "../src/athena/google/protobuf/empty.ts",
    "../src/athena/athena.ts",
]

# The theme to use for HTML and HTML Help pages
html_theme = "furo"

# Theme options
html_theme_options = {
    "sidebar_hide_name": False,
    "navigation_with_keys": True,
    "source_repository": "https://github.com/crispthinking/athena-nodejs-client/",
    "source_branch": "main",
    "source_directory": "docs/",
    "light_css_variables": {
        "color-sidebar-background": "#f8f9fb",
        "color-brand-primary": "#20539E",
        "color-brand-content": "#20539E",
        "color-foreground-primary": "#4E585F",
        "color-background-primary": "#FEFEFE",
        "color-background-secondary": "#F7F7F7",
        "font-stack": (
            "'Nunito Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', "
            "Helvetica, Arial, sans-serif"
        ),
    },
    "dark_css_variables": {
        "color-brand-primary": "#B6CBE9",
        "color-brand-content": "#B6CBE9",
        "color-foreground-primary": "#D5D5D5",
        "color-background-primary": "#393939",
        "color-background-secondary": "#434343",
        "color-sidebar-background": "#1E1E1E",
        "font-stack": (
            "'Nunito Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', "
            "Helvetica, Arial, sans-serif"
        ),
    },
    "light_logo": "images/logo/Resolver_Lettermark_Main.png",
    "dark_logo": "images/logo/Resolver_Lettermark_White.png",
}

# HTML configuration
html_static_path = ["_static"]
html_favicon = "_static/images/favicon/favicon-32x32.png"
html_css_files = ["css/custom.css"]

# HTML context
html_context = {
    "display_github": True,
    "github_user": "crispthinking",
    "github_repo": "athena-nodejs-client",
    "github_version": "main",
    "conf_py_path": "/docs/",
}

# Intersphinx configuration
intersphinx_mapping = {
    "python": ("https://docs.python.org/3", None),
    "grpc": ("https://grpc.github.io/grpc/python/", None),
    "athena_protobufs": (
        "https://crispthinking.github.io/athena-protobufs/",
        None,
    ),
}

# Create required directories if they don't exist
for path in ["_static", "_templates/autosummary"]:
    path_obj = Path(path)
    path_obj.mkdir(parents=True, exist_ok=True)

# MyST parser configuration
myst_enable_extensions = [
    "deflist",
    "tasklist",
    "colon_fence",
]

# Napoleon settings
napoleon_google_docstring = True
napoleon_numpy_docstring = True
napoleon_include_init_with_doc = True
napoleon_include_private_with_doc = False
napoleon_include_special_with_doc = True
napoleon_use_admonition_for_examples = True
napoleon_use_admonition_for_notes = True
napoleon_use_admonition_for_references = True
napoleon_use_ivar = False
napoleon_use_param = True
napoleon_use_rtype = True
napoleon_type_aliases = None

# AutoDoc settings
autodoc_default_options = {
    "members": True,
    "member-order": "bysource",
    "special-members": "__init__",
    "undoc-members": True,
    "exclude-members": "__weakref__",
    "show-inheritance": True,
}

# Todo extension
todo_include_todos = True

# Output file name
htmlhelp_basename = "AthenaNodeClientdoc"

# -- TypeScript Sphinx Configuration ----------------------------------------

# Directories to scan for TypeScript files (relative to conf.py)
sphinx_ts_src_dirs = ["../src"]

# Patterns for files to exclude from parsing
sphinx_ts_exclude_patterns = [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/node_modules/**",
    "**/*.d.ts",
]

# Whether to include private members in documentation
sphinx_ts_include_private = True

# Whether to include inherited members in class documentation
sphinx_ts_include_inherited = True

# Source linking configuration
sphinx_ts_show_source_links = True
sphinx_ts_source_base_url = "https://github.com/crispthinking/athena-nodejs-client/"
sphinx_ts_source_branch = "main"
