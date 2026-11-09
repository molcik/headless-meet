import { webcrypto } from 'crypto';

// Node 18 (the version on the Pi) has no global `crypto`. MCP SDK 1.x calls
// crypto.randomUUID() for every request, and its client uses crypto for PKCE.
// Node 20 and later define the global, so this does nothing there.
if (!(globalThis as any).crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}
