// A refusal (missing attestation, unsupported request): the runner exits 2 and nothing is rendered.
export class RefusalError extends Error {
  constructor(code, message) { super(message); this.name = 'RefusalError'; this.code = code; }
}
