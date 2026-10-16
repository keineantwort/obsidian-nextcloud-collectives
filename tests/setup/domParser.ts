// Node has no DOMParser. The plugin uses the browser's DOMParser for WebDAV XML (mobile-safe),
// so tests provide jsdom's implementation as a global. Test-only: jsdom is a devDependency.
import { JSDOM } from 'jsdom';

const { window } = new JSDOM();
globalThis.DOMParser = window.DOMParser;
