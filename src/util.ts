import { List, Map, Set, Record } from 'immutable';
import * as iop from 'interval-operations';

export const TotalRecord = <TProps extends object>(template: TProps): ((v: TProps) => ReturnType<Record.Factory<TProps>>) => Record(template);


export type CalTime = number & { __type: 'CalTime' };
export type Hypertime = number & { __type: 'Hypertime' };
export type RealTime = number & { __type: 'RealTime' };
export const hc2rt = ({ h, c }: { h: Hypertime, c: CalTime }) => { return h + c as RealTime };
export const rh2ct = ({ r, h }: { r: RealTime, h: Hypertime }) => r - h as CalTime;
export const rc2ht = ({ r, c }: { r: RealTime, c: CalTime }) => r - c as Hypertime;

export type TripId = string & { __type: 'TripId' };
export const TripR = TotalRecord({ id: undefined as any as TripId, depart: undefined as any as CalTime, arrive: undefined as any as CalTime });
export type Trip = ReturnType<typeof TripR>;
export type History = Set<TripId>;


export const EventR = TotalRecord({
  tripId: undefined as any as TripId,
  r0: undefined as any as RealTime,
  departH0: undefined as any as Hypertime,
  arriveH0: undefined as any as Hypertime,
});
export type Event = ReturnType<typeof EventR>;

export const BoxR = TotalRecord({
  start: undefined as any as Event,
  rf: undefined as any as RealTime,
});
export type Box = ReturnType<typeof BoxR>;

export function normalizeBoxes(boxes: List<Box>): List<Box> {
  boxes = boxes.sortBy(b => b.start.r0);
  if (boxes.isEmpty()) return List();
  let res: List<Box> = List([boxes.first()!]);
  for (let i = 1; i < boxes.size; i++) {
    const newBox = boxes.get(i)!;
    const prevInd = res.findLastIndex(b =>
      (b.start.tripId === newBox.start.tripId && b.rf === newBox.start.r0)
      || (newBox.start.departH0 <= b.start.arriveH0 && b.start.arriveH0 < newBox.start.departH0 + (newBox.rf - newBox.start.r0))
    );
    if (prevInd !== -1) {
      const prev = res.get(prevInd)!;
      if (prev.start.tripId === newBox.start.tripId && prev.rf === newBox.start.r0) {
        res = res.set(prevInd, prev.set('rf', newBox.rf));
        continue;
      }
    }
    res = res.push(newBox);
  }
  return List(res);
}

export const ChunkR = TotalRecord({
  start: undefined as any as Hypertime,
  end: undefined as any as Hypertime,
  history: undefined as any as History,
});
export type Chunk = ReturnType<typeof ChunkR>;
export function normalizeChunks(chunks: List<Chunk>, noJoinAt?: Set<Hypertime>): List<Chunk> {
  chunks = chunks.sortBy(s => s.start);
  if (chunks.size === 0) throw new Error('no chunks');

  if (chunks.first()!.start !== 0) {
    throw new Error('chunks do not start at 0: first is ' + JSON.stringify(chunks.first()));
  }
  if (chunks.last()!.end !== Infinity) {
    throw new Error('chunks do not end at Infinity: last is ' + JSON.stringify(chunks.last()));
  }
  for (const chunk of chunks) {
    if (chunk.start >= chunk.end) {
      throw new Error('chunks have zero or negative length: ' + JSON.stringify(chunk));
    }
  }

  let res = List<Chunk>([chunks.first()!]);
  for (let i = 1; i < chunks.size; i++) {
    const newChunk = chunks.get(i)!;
    const prev = res.last()!;
    if (newChunk.start !== prev.end) {
      throw new Error('chunks have gaps: ' + JSON.stringify(res));
    }
    if (newChunk.history.equals(prev.history) && !noJoinAt?.has(newChunk.start)) {
      res = res.set(res.size - 1, prev.set('end', newChunk.end));
    } else {
      res = res.push(newChunk);
    }
  };
  return res;
}

export const GodViewR = TotalRecord({
  rules: undefined as any as Map<History, List<Trip>>,
  now: undefined as any as RealTime,
  chunks: undefined as any as List<Chunk>,
  past: undefined as any as List<Box>,
});
export type GodView = ReturnType<typeof GodViewR>;

export function normalizeGodView(gv: GodView): GodView {
  let now = gv.now;

  let chunks = normalizeChunks(gv.chunks, getNonPastEvents(gv).map(e => e.departH0).toSet());

  let past = normalizeBoxes(gv.past);
  for (const b of past) {
    if (b.start.r0 >= b.rf) throw new Error('box has zero or negative length: ' + JSON.stringify(b));
    if (b.rf > now) throw new Error('supposedly-past event is actually in future: ' + JSON.stringify([gv.now, b]));
  }

  // let immediateEvents = normalizeEvents(gv.immediateEvents);
  // for (const e of immediateEvents) {
  //   if (e.r0 !== now) throw new Error('supposedly-active event is not exactly right now: ' + now + " vs " + JSON.stringify(e));
  // }
  // for (const e of immediateEvents) {
  //   const containingChunk = chunks.find(c => c.start <= e.departH0 && e.departH0 < c.end);
  //   if (!containingChunk) throw new Error('immediate event not in any chunk: ' + JSON.stringify(e));
  //   if (containingChunk.history.contains(e.tripId)) throw new Error('event is set to happen in chunk that already has that event in its history: ' + JSON.stringify([e, containingChunk]));
  //   const departHf = e.departH0 + (e.rf - e.r0) as Hypertime;
  //   if (departHf > containingChunk.end) throw new Error('event departure supposedly goes beyond the end of its chunk: ' + JSON.stringify([e, containingChunk]));
  // }

  // let futureEvents = normalizeEvents(gv.futureEvents);
  // for (const e of futureEvents) {
  //   if (e.r0 <= now) throw new Error('supposedly-future event is not in future: ' + JSON.stringify(e));
  // }

  return GodViewR({
    rules: gv.rules,
    now,
    chunks,
    past,
  });
}

export function timeUntilChunkEnd(chunks: List<Chunk>, h0: Hypertime): number {
  if (h0 < 0) return Math.abs(h0);
  const chunk = chunks.find(c => c.start <= h0 && h0 < c.end);
  if (!chunk) throw new Error('no chunk contains ' + h0);
  return chunk.end - h0;
}
export function getNonPastEvents(gv: GodView): List<Event> {
  const res: Event[] = [];
  for (const chunk of gv.chunks) {
    for (const trip of gv.rules.get(chunk.history) ?? []) {
      const r0 = hc2rt({ h: chunk.start, c: trip.depart });
      const arriveH0 = rc2ht({ r: r0, c: trip.arrive });
      if (r0 < gv.now) continue;
      res.push(EventR({ tripId: trip.id, r0, departH0: chunk.start, arriveH0 }));
      if (r0 === gv.now && arriveH0 >= 0) {
        const arrivalChunk = gv.chunks.find(c => c.start <= arriveH0 && arriveH0 < c.end);
        if (!arrivalChunk) throw new Error('no chunk contains ' + arriveH0);
        for (const nextTrip of gv.rules.get(arrivalChunk.history.add(trip.id)) ?? []) {
          const r0 = hc2rt({ h: arriveH0, c: nextTrip.depart });
          const nextArriveH0 = rc2ht({ r: r0, c: nextTrip.arrive });
          if (r0 <= gv.now) continue;
          res.push(EventR({ tripId: nextTrip.id, r0, departH0: chunk.start, arriveH0: nextArriveH0 }));
        }
      }
    }
  }
  return List(res);
}
export function getNextInterestingTime(gv: GodView): RealTime {
  const events = getNonPastEvents(gv);
  return Math.min(...events.flatMap(e => {
    if (e.r0 > gv.now) return [e.r0];
    return [
      gv.now + timeUntilChunkEnd(gv.chunks, e.departH0),
      gv.now + timeUntilChunkEnd(gv.chunks, e.arriveH0),
      ...events.flatMap(e2 => e2.r0 === gv.now && e2.arriveH0 > e.departH0 ? [gv.now + e2.arriveH0 - e.departH0] : []),
    ]
  })) as RealTime;
}

export function evolveChunks(chunks: List<Chunk>, events: List<Event>, dt: number): List<Chunk> {
  if (events.isEmpty()) return chunks;
  const [r0, ...ohno] = Set(events.map(e => e.r0));
  if (ohno.length > 0) throw new Error('multiple r0s: ' + JSON.stringify([r0, ...ohno]));
  return chunks.flatMap(chunk => {
    const arrivals = events.filter(e => chunk.start <= e.arriveH0 && e.arriveH0 < chunk.end);
    let subchunks: Chunk[] = [chunk];
    for (const e of arrivals) {
      subchunks = subchunks.flatMap(subchunk => {
        const overlap = iop.intersection([subchunk.start, subchunk.end], [e.arriveH0, e.arriveH0 + dt]);
        if (!overlap) return subchunk;
        const difference = iop.arrayDifference([[subchunk.start, subchunk.end]], [overlap]);
        return [
          ChunkR({ start: overlap[0] as Hypertime, end: overlap[1] as Hypertime, history: subchunk.history.add(e.tripId) }),
          ...difference.map(([start, end]) => ChunkR({ start: start as Hypertime, end: end as Hypertime, history: subchunk.history })),
        ];
      });
    }
    const departures = events.filter(e => chunk.start <= e.departH0 && e.departH0 < chunk.end);
    for (const e of departures) {
      subchunks = subchunks.flatMap(subchunk => {
        const overlap = iop.intersection([subchunk.start, subchunk.end], [e.departH0, e.departH0 + dt]);
        if (!overlap) return subchunk;
        const difference = iop.arrayDifference([[subchunk.start, subchunk.end]], [overlap]);
        return [
          ChunkR({ start: overlap[0] as Hypertime, end: overlap[1] as Hypertime, history: subchunk.history }),
          ...difference.map(([start, end]) => ChunkR({ start: start as Hypertime, end: end as Hypertime, history: subchunk.history })),
        ];
      });
    }
    return subchunks;
  });

}

export function stepGodView(gv: GodView): GodView {
  gv = normalizeGodView(gv);

  const stepUntil = getNextInterestingTime(gv);
  const dt = stepUntil - gv.now;
  const events = getNonPastEvents(gv);
  const immEvents = events.filter(e => e.r0 === gv.now);
  const immArrivalHypertimes = Set(immEvents.map(e => e.arriveH0));
  const newChunks = evolveChunks(gv.chunks, immEvents.filter(e => !immArrivalHypertimes.has(e.departH0)), dt);


  const newNow = stepUntil;
  const newPast = gv.past.concat(immEvents.map(e => BoxR({
    start: EventR({ tripId: e.tripId, r0: e.r0, departH0: e.departH0, arriveH0: e.arriveH0 }),
    rf: e.r0 + dt as RealTime,
  })));

  return normalizeGodView(GodViewR({
    rules: gv.rules,
    now: newNow,
    chunks: newChunks,
    past: newPast,
  }));
}
