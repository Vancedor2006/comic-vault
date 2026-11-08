#  Comic-Vault

A webcomic hosting platform built to preserve creator-intended reading pacing (LTR, RTL, and Infinite Scroll). I wrote the html and css but I got help from claude with the javascript.

## Development Roadmap

- [x] Phase 1: UI & HTML Skeletons
  - Created responsive semantic HTML templates (`index.html`, `browse.html`, `reader.html`, `upload.html`, `login.html`).
  - Implemented core CSS styling for dark-mode theater reading and file upload dropzones.
- [x] Phase 2: Dynamic Reader Engine & State Management
  - Built `reader.js` engine to lock and render view modes automatically based on comic metadata.
- [x] Phase 3: Supabase Backend Integration
  - PostgreSQL schema, user authentication, and object storage for comic uploads.
