/**
 * Polyfill for async iteration of ReadableStream (`values()` and
 * `[Symbol.asyncIterator]`).
 *
 * pdfjs v6 `page.getTextContent()` consumes its stream with
 * `for await (const value of readableStream)`, but Safari < 27 does not
 * implement async iteration on ReadableStream, so every PDF extraction throws
 * `TypeError: undefined is not a function` there. Installing this before
 * pdfjs loads restores it, following the WHATWG Streams semantics on top of
 * `getReader()`.
 *
 * Safe to delete once Safari 27 is the minimum supported browser.
 */

/** Build a WHATWG-style async iterator over a stream's default reader. */
function values({ preventCancel = false } = {}) {
  const reader = this.getReader();
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    reader.releaseLock();
  };

  return {
    async next() {
      if (finished) return { done: true, value: undefined };
      let result;
      try {
        result = await reader.read();
      } catch (err) {
        finish();
        throw err;
      }
      if (result.done) finish();
      return result;
    },
    async return(value) {
      if (!finished) {
        try {
          if (!preventCancel) await reader.cancel(value);
        } finally {
          finish();
        }
      }
      return { done: true, value };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

/**
 * Install async iteration on `ReadableStreamCtor.prototype` when missing.
 * No-op if the constructor is absent or already async-iterable — a native
 * implementation is never overwritten.
 */
export const installReadableStreamAsyncIterator = (ReadableStreamCtor = globalThis.ReadableStream) => {
  const proto = ReadableStreamCtor?.prototype;
  if (!proto || typeof proto[Symbol.asyncIterator] === 'function') return;

  const descriptor = { value: values, writable: true, configurable: true, enumerable: false };
  if (typeof proto.values !== 'function') Object.defineProperty(proto, 'values', descriptor);
  Object.defineProperty(proto, Symbol.asyncIterator, descriptor);
};
