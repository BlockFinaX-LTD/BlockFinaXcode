// Passkey Kit uses Node's Buffer interface for credential/XDR conversion.
// Provide Buffer only; use the browser's WebCrypto for passkey ceremonies.
import {Buffer} from 'buffer';
globalThis.Buffer = Buffer;
