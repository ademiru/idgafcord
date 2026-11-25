import { copyFile } from 'node:fs/promises';
for (const file of ['card.mjs', 'card.css']) await copyFile(new URL('../shared/' + file, import.meta.url), new URL('../ecosystem/public/' + file, import.meta.url));
console.log('Shared card editor prepared for the ecosystem site.');
