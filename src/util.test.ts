import { List, Map, Set } from 'immutable';
import { describe, expect, test } from 'vitest';
import { CalTime, Chunk, ChunkR, EventR, getNonPastEvents, GodViewR, Hypertime, normalizeChunks, normalizeEvents, RealTime, TripId, TripR } from './util';

const mkTrip = (args: { nick: string, depart: number, arrive: number }) => TripR({
  nick: args.nick as TripId,
  depart: args.depart as CalTime,
  arrive: args.arrive as CalTime,
});
type LazyTrip = Parameters<typeof mkTrip>[0];
const mkEvent = (args: { tripId: string, r0: number, rf: number, departH0: number, arriveH0: number }) => EventR({
  tripId: args.tripId as TripId,
  r0: args.r0 as RealTime,
  rf: args.rf as RealTime,
  departH0: args.departH0 as Hypertime,
  arriveH0: args.arriveH0 as Hypertime,
});
type LazyEvent = Parameters<typeof mkEvent>[0];
const mkChunk = (args: { start: number, end: number, history: string[] }) => ChunkR({
  start: args.start as Hypertime,
  end: args.end as Hypertime,
  history: Set(args.history as TripId[]),
});
type LazyChunk = Parameters<typeof mkChunk>[0];
const mkGodView = (args: { rules: [string[], LazyTrip[]][], now: number, chunks: LazyChunk[], pastEvents: LazyEvent[] }) => GodViewR({
  now: args.now as RealTime,
  chunks: List(args.chunks.map(mkChunk)),
  pastEvents: List(args.pastEvents.map(mkEvent)),
  rules: Map(args.rules.map(([history, trips]) => [Set(history as TripId[]), List(trips.map(mkTrip))]))
});
type LazyGodView = Parameters<typeof mkGodView>[0];

describe('normalizeEvents', () => {
  describe("computes lineups correctly", () => {
    const e0 = mkEvent({ tripId: 'a', r0: 0, rf: 1, departH0: 0, arriveH0: 10 });
    test.each([
      [mkEvent({ tripId: 'a', r0: 1, rf: 7, departH0: 1, arriveH0: 11 }), mkEvent({ tripId: 'a', r0: 0, rf: 7, departH0: 0, arriveH0: 10 })],
      [mkEvent({ tripId: 'b', r0: 1, rf: 7, departH0: 1, arriveH0: 11 }), undefined],
      [mkEvent({ tripId: 'a', r0: 2, rf: 7, departH0: 1, arriveH0: 11 }), undefined],
      [mkEvent({ tripId: 'a', r0: 1, rf: 7, departH0: 2, arriveH0: 12 }), undefined],
    ])(`%#`, (e1, expectCombined) => {
      const input = List([e0, e1]);
      const output = normalizeEvents(input);
      if (expectCombined === undefined) {
        expect(Set(output)).toStrictEqual(Set(input));
      } else {
        expect(output).toStrictEqual(List([expectCombined]));
      }
    });
  });
});

describe('normalizeChunks', () => {
  test('err on empty list', () => {
    expect(
      () => normalizeChunks(List<Chunk>()),
    ).toThrow(
      new Error('no chunks'),
    );
  });
  test('noop on single chunk', () => {
    expect(normalizeChunks(
      List([mkChunk({ start: 0, end: Infinity, history: ['a', 'b'] })]),
    )).toStrictEqual(
      List([mkChunk({ start: 0, end: Infinity, history: ['a', 'b'] })]),
    );
  });
  test('combines adjacent chunks with same history', () => {
    expect(normalizeChunks(
      List([mkChunk({ start: 0, end: 5, history: ['a'] }), mkChunk({ start: 5, end: Infinity, history: ['a'] })]),
    )).toStrictEqual(
      List([mkChunk({ start: 0, end: Infinity, history: ['a'] })]),
    );
  });
  test('does not combine adjacent chunks with different histories', () => {
    expect(normalizeChunks(
      List([mkChunk({ start: 0, end: 5, history: ['a'] }), mkChunk({ start: 5, end: Infinity, history: ['b'] })]),
    )).toStrictEqual(
      List([mkChunk({ start: 0, end: 5, history: ['a'] }), mkChunk({ start: 5, end: Infinity, history: ['b'] })]),
    );
  });
  test('combines many out-of-order chunks', () => {
    expect(normalizeChunks(
      List([mkChunk({ start: 0, end: 5, history: [] }), mkChunk({ start: 20, end: Infinity, history: [] }), mkChunk({ start: 5, end: 20, history: [] })]),
    )).toStrictEqual(
      List([mkChunk({ start: 0, end: Infinity, history: [] })]),
    );
  });
  test('sorts chunks', () => {
    expect(normalizeChunks(
      List([mkChunk({ start: 0, end: 5, history: ['a'] }), mkChunk({ start: 20, end: Infinity, history: ['c'] }), mkChunk({ start: 5, end: 20, history: ['b'] })]),
    )).toStrictEqual(
      List([mkChunk({ start: 0, end: 5, history: ['a'] }), mkChunk({ start: 5, end: 20, history: ['b'] }), mkChunk({ start: 20, end: Infinity, history: ['c'] })]),
    );
  });
});

describe('getNonPastEvents', () => {
  test('no events for empty universe', () => {
    expect(getNonPastEvents(mkGodView(
      { rules: [], now: 0, pastEvents: [], chunks: [{ start: 0, end: Infinity, history: [] }] },
    ))).toStrictEqual(
      List(),
    );
  });
  test('includes a simple immediate event', () => {
    expect(getNonPastEvents(mkGodView(
      { rules: [[[], [{ nick: 'a', depart: 3, arrive: 1 }]]], now: 0, pastEvents: [], chunks: [{ start: 0, end: Infinity, history: [] }] },
    ))).toStrictEqual(
      List([mkEvent({ tripId: 'a', r0: 3, rf: Infinity, departH0: 0, arriveH0: 2 })]),
    );
  });
  test('includes a simple future event', () => {
    expect(getNonPastEvents(mkGodView(
      { rules: [[[], [{ nick: 'a', depart: 3, arrive: 5 }]]], now: 0, pastEvents: [], chunks: [{ start: 0, end: Infinity, history: [] }] },
    ))).toStrictEqual(
      List([mkEvent({ tripId: 'a', r0: 3, rf: Infinity, departH0: 0, arriveH0: -2 })]),
    );
  });
  test('ignores past events', () => {
    expect(getNonPastEvents(mkGodView(
      { rules: [[[], [{ nick: 'a', depart: -1, arrive: 3 }]]], now: 0, pastEvents: [], chunks: [{ start: 0, end: Infinity, history: [] }] },
    ))).toStrictEqual(
      List(),
    );
  });
});