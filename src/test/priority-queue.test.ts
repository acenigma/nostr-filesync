import { describe, it, expect } from 'vitest';
import { PriorityQueue, priorityForFile } from '../services/priorityQueue';

describe('PriorityQueue', () => {
  it('orders by priority then enqueue time', () => {
    const q = new PriorityQueue<string>();
    q.enqueue({ id: 'a', priority: 'background', data: 'a', enqueuedAt: 1 });
    q.enqueue({ id: 'b', priority: 'metadata', data: 'b', enqueuedAt: 2 });
    q.enqueue({ id: 'c', priority: 'small-file', data: 'c', enqueuedAt: 3 });
    q.enqueue({ id: 'd', priority: 'metadata', data: 'd', enqueuedAt: 4 });
    expect(q.dequeue()?.id).toBe('b');
    expect(q.dequeue()?.id).toBe('d');
    expect(q.dequeue()?.id).toBe('c');
    expect(q.dequeue()?.id).toBe('a');
  });

  it('peek does not remove', () => {
    const q = new PriorityQueue<number>();
    q.enqueue({ id: 'x', priority: 'metadata', data: 1, enqueuedAt: 0 });
    expect(q.peek()?.data).toBe(1);
    expect(q.size()).toBe(1);
  });

  it('remove by id', () => {
    const q = new PriorityQueue<number>();
    q.enqueue({ id: 'x', priority: 'background', data: 1, enqueuedAt: 0 });
    q.enqueue({ id: 'y', priority: 'background', data: 2, enqueuedAt: 1 });
    expect(q.remove('x')).toBe(true);
    expect(q.size()).toBe(1);
    expect(q.remove('x')).toBe(false);
  });

  it('clear empties the queue', () => {
    const q = new PriorityQueue<number>();
    q.enqueue({ id: 'a', priority: 'metadata', data: 1, enqueuedAt: 0 });
    q.enqueue({ id: 'b', priority: 'metadata', data: 2, enqueuedAt: 1 });
    q.clear();
    expect(q.size()).toBe(0);
  });

  it('onChange listener fires on enqueue/dequeue/clear/remove', () => {
    const q = new PriorityQueue<number>();
    let count = 0;
    q.onChange(() => count++);
    q.enqueue({ id: 'a', priority: 'metadata', data: 1, enqueuedAt: 0 });
    expect(count).toBe(1);
    q.dequeue();
    expect(count).toBe(2);
    q.enqueue({ id: 'b', priority: 'metadata', data: 1, enqueuedAt: 0 });
    q.remove('b');
    expect(count).toBe(4);
    q.clear();
    expect(count).toBe(5);
  });

  it('snapshot returns copy', () => {
    const q = new PriorityQueue<number>();
    q.enqueue({ id: 'a', priority: 'metadata', data: 1, enqueuedAt: 0 });
    const snap = q.snapshot();
    expect(snap.length).toBe(1);
    q.clear();
    expect(snap.length).toBe(1);
  });
});

describe('priorityForFile', () => {
  it('user-requested overrides size', () => {
    expect(priorityForFile(1024, true)).toBe('user-requested');
    expect(priorityForFile(10 * 1024 * 1024, true)).toBe('user-requested');
  });

  it('small files get small-file priority', () => {
    expect(priorityForFile(1024, false)).toBe('small-file');
    expect(priorityForFile(31 * 1024, false)).toBe('small-file');
  });

  it('larger files get background', () => {
    expect(priorityForFile(100 * 1024, false)).toBe('background');
    expect(priorityForFile(1024 * 1024, false)).toBe('background');
  });
});
