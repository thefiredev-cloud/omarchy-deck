// Native-proof adapter only. Serve the git-archived production frontend through its own synthetic QA backend.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [sourceRoot, port] = process.argv.slice(2);
const { startMockDeck } = await import(pathToFileURL(path.resolve(sourceRoot, 'qa/mock-deck.mjs')).href);
await startMockDeck(Number(port));
console.log('Synthetic QA backend for the archived production frontend; loopback only');
