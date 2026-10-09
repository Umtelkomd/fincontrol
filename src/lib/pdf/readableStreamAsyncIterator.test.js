import { describe, expect, it, vi } from 'vitest';
import { installReadableStreamAsyncIterator } from './readableStreamAsyncIterator';

/**
 * Minimal ReadableStream stand-in whose prototype lacks async iteration (like
 * Safari < 27). Each instance's getReader() returns a scripted reader: `steps`
 * are consumed by read() in order — a value yields a chunk, an Error rejects.
 */
const makeFakeStreamCtor = () => {
  function FakeStream(steps) {
    this.steps = [...steps];
    this.reader = {
      read: vi.fn(async () => {
        if (this.steps.length === 0) return { done: true, value: undefined };
        const step = this.steps.shift();
        if (step instanceof Error) throw step;
        return { done: false, value: step };
      }),
      releaseLock: vi.fn(),
      cancel: vi.fn(async () => {}),
    };
    this.getReader = vi.fn(() => this.reader);
  }
  return FakeStream;
};

describe('installReadableStreamAsyncIterator', () => {
  it('makes streams iterable with for await over every chunk', async () => {
    const FakeStream = makeFakeStreamCtor();
    installReadableStreamAsyncIterator(FakeStream);
    const stream = new FakeStream(['a', 'b', 'c']);

    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks).toEqual(['a', 'b', 'c']);
    expect(stream.reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(stream.reader.cancel).not.toHaveBeenCalled();
  });

  it('cancels the stream and releases the lock on break', async () => {
    const FakeStream = makeFakeStreamCtor();
    installReadableStreamAsyncIterator(FakeStream);
    const stream = new FakeStream(['a', 'b', 'c']);

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
      break;
    }

    expect(chunks).toEqual(['a']);
    expect(stream.reader.cancel).toHaveBeenCalledTimes(1);
    expect(stream.reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('does not cancel on break when values({ preventCancel: true })', async () => {
    const FakeStream = makeFakeStreamCtor();
    installReadableStreamAsyncIterator(FakeStream);
    const stream = new FakeStream(['a', 'b']);

    for await (const chunk of stream.values({ preventCancel: true })) {
      expect(chunk).toBe('a');
      break;
    }

    expect(stream.reader.cancel).not.toHaveBeenCalled();
    expect(stream.reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('rethrows read errors and releases the lock', async () => {
    const FakeStream = makeFakeStreamCtor();
    installReadableStreamAsyncIterator(FakeStream);
    const boom = new Error('boom');
    const stream = new FakeStream(['a', boom]);

    const chunks = [];
    await expect(async () => {
      for await (const chunk of stream) chunks.push(chunk);
    }).rejects.toBe(boom);

    expect(chunks).toEqual(['a']);
    expect(stream.reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('leaves an existing native iterator untouched', () => {
    const FakeStream = makeFakeStreamCtor();
    const native = function nativeIterator() {};
    FakeStream.prototype[Symbol.asyncIterator] = native;

    installReadableStreamAsyncIterator(FakeStream);

    expect(FakeStream.prototype[Symbol.asyncIterator]).toBe(native);
    expect(FakeStream.prototype.values).toBeUndefined();
  });

  it('is a no-op when no ReadableStream constructor exists', () => {
    expect(() => installReadableStreamAsyncIterator(null)).not.toThrow();
  });
});
