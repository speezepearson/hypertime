import { useEffect, useMemo, useState } from 'react';
import { List, Map, Set } from 'immutable';

import './App.css';
import { CalTime, ChunkR, GodView, GodViewR, hc2rt, History, Hypertime, rc2ht, RealTime, stepGodView, Trip, TripId, TripR } from './util';


type Ruleset = {
  rules: Map<History, List<Trip>>;
  tripsById: Map<TripId, Trip>;
};
type Res<T> = { type: 'ok', val: T } | { type: 'err', err: string };

function parseRuleset(s: string): Res<Ruleset> {

  let ruleLines: List<{ history: Set<TripId>, trips: List<Trip> }> = List();
  for (const line of s.split('\n').map(s => s.trim()).filter(x => x)) {
    const [historyStr, futureStr] = line.split('->').map(s => s.trim());
    if (futureStr === undefined) return { type: 'err', err: 'Format: $HISTORY -> $FUTURE' };
    const history = Set(historyStr.split(',').map(s => s.trim()).filter(x => x)) as Set<TripId>;
    let trips = List<Trip>();
    // console.log({ line, futureStr });
    for (const tripS of futureStr.split(';').map(s => s.trim()).filter(x => x)) {
      // console.log('   ', tripS);
      const match = /^(.*), *(-?[0-9]+) *, *(-?[0-9]+) *$/.exec(tripS);
      if (!match) return { type: 'err', err: 'Format: $NICK,$DEPART,ARRIVE; $NICK,$DEPART,ARRIVE; ...' };
      const [_, nick, departS, arriveS] = match.map(s => s.trim());
      if (arriveS === undefined) return { type: 'err', err: 'Format: $NICK,$DEPART,$ARRIVE; $NICK,$DEPART,$ARRIVE; ...' };
      const [depart, arrive] = [departS, arriveS].map(s => parseInt(s)) as [CalTime, CalTime];
      trips = trips.push(TripR({ nick: nick as TripId, depart, arrive }));
    };
    ruleLines = ruleLines.push({ history, trips });
  };

  let tripsById: Map<TripId, Trip> = Map();
  for (const { trips } of ruleLines) {
    for (const trip of trips) {
      if (tripsById.has(trip.nick)) return { type: 'err', err: `Duplicate nickname: ${trip.nick}` };
      tripsById = tripsById.set(trip.nick, trip);
    }
  }

  let rules: Map<History, List<Trip>> = Map();
  for (const { history, trips } of ruleLines) {
    if (rules.has(history)) return { type: 'err', err: `Duplicate history: ${history.sort().join(', ')}` };
    rules = rules.set(history, trips);
  }

  return { type: 'ok', val: { rules, tripsById } };
}

function RulesetEditor({ init, onChange }: { init?: Ruleset, onChange: (ruleset: Ruleset) => void }) {
  const [textF, setTextF] = useState(() => !init ? '' : init.rules
    .entrySeq()
    .map(([history, trips]) => `${history.join(', ')} -> ${trips.map(t => `${t.nick},${t.depart},${t.arrive}`).join('; ')}`)
    .join('\n')
  );

  const ruleset: Res<Ruleset> = useMemo(() => parseRuleset(textF), [textF]);

  const canSubmit = ruleset.type === 'ok';
  const submit = () => {
    if (!canSubmit) return;
    onChange(ruleset.val);
  }

  return <form onSubmit={e => { e.preventDefault(); submit() }}>
    <textarea rows={10} style={{ minWidth: '20em' }} value={textF} onChange={e => setTextF(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) submit(); }}
    />
    <button type="submit" disabled={!canSubmit}>Update</button>
    {ruleset.type === 'err' && <div style={{ color: 'red' }}>{ruleset.err}</div>}
  </form>
}

type WorldState = Map<Hypertime, History>;

function simulate(startWS: WorldState, startT: RealTime, nSteps: number, rules: Map<History, List<Trip>>): {
  worldStates: Map<RealTime, WorldState>,
  arrivalInfos: Map<RealTime, Map<Hypertime, Set<TripId>>>,
  departureInfos: Map<RealTime, Map<Hypertime, Set<TripId>>>,
} {
  let worldStates: Map<RealTime, WorldState> = Map([[startT, startWS]]);
  let arrivalInfos: Map<RealTime, Map<Hypertime, Set<TripId>>> = Map();
  let departureInfos: Map<RealTime, Map<Hypertime, Set<TripId>>> = Map();
  for (let r = startT + 1 as RealTime; r < startT + nSteps; r++) {
    const last = worldStates.get(r - 1 as RealTime)!;
    let next: WorldState = Map();
    const htMin = last.keySeq().concat(arrivalInfos.get(r)?.keySeq() ?? []).min() ?? (0 as Hypertime);
    const htMax = 1 + (last.keySeq().concat(arrivalInfos.get(r)?.keySeq() ?? []).max() ?? (0 as Hypertime));
    for (let h = htMin; h <= htMax; h++) {
      const oldHistory: History = last.get(h, Set());
      next = next.set(h, oldHistory.union(arrivalInfos.get(r)?.get(h) ?? []));
      if (h === 24 && (r == 17)) { debugger }
      const departures = (rules.get(oldHistory) ?? List()).filter(t => r === hc2rt({ h, c: t.depart }));
      for (const t of departures) {
        const toHT = rc2ht({ r, c: t.arrive });
        // console.log('departure', t.nick, 'from h', h, 'c', t.depart, 'to h', toHT);
        departureInfos = departureInfos.update(r, Map(), m => m.update(h, Set(), s => s.add(t.nick)));
        arrivalInfos = arrivalInfos.update(r + 1 as RealTime, Map(), m => m.update(toHT, Set(), s => s.add(t.nick)));
      }
      // console.log(JSON.stringify([last.get(h), next.get(h)]))
    }
    worldStates = worldStates.set(r, next);
  }
  return { worldStates, arrivalInfos, departureInfos };
}

// All these need to be readable against a white background.
const COLORS = ['red', 'green', 'blue', 'purple', 'orange', 'magenta', 'cyan', 'brown', 'black', 'gray'];

function GodViewE({ gv }: { gv: GodView }) {
  return <>
    <ul>
      <li>Now: {gv.now}</li>
      <li>Chunks: {gv.chunks.sortBy(c => c.start).map((c, i) => <span key={i}>({c.start}-{c.end}: {c.history})</span>)}</li>
      <li>Events: {gv.pastEvents.sortBy(e => e.r0).map((e, i) => <span key={i}>({e.r0}: {e.tripId} h={e.departH0} to {e.arriveH0})</span>)}</li>
    </ul>

    <div style={{ position: 'absolute', width: '10em', height: '10em' }}>
      {gv.chunks.map((chunk, i) => <div key={i} style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: `${chunk.start * 2}em`,
        height: `${(chunk.end - chunk.start) * 2}em`,
        backgroundColor: 'rgba(0, 0, 0, 0.1)',
        borderBottom: '1px solid black',
      }}>
        {chunk.start}-{chunk.end}:
        {chunk.history.sort().toArray()}
      </div>)}

    </div>
  </>
}

function App() {
  const [{ rules, tripsById }, setRules] = useState<{ rules: Map<History, List<Trip>>, tripsById: Map<TripId, Trip> }>((parseRuleset(`
    -> a, 5, 3
    
  `) as Res<Ruleset> & { type: 'ok' }).val);
  const [hoveredCellInfo, setHoveredCellInfo] = useState<{ r: RealTime, h: Hypertime } | null>(null);

  const gv0: GodView = useMemo(() => GodViewR({
    now: 0 as RealTime,
    chunks: List([ChunkR({ start: 0 as Hypertime, end: Infinity as Hypertime, history: Set() })]),
    pastEvents: List(),
    rules,
  }), [rules]);
  const gvSteps: List<GodView> = useMemo(() => {
    let res = List([gv0]);
    for (let i = 0; i < 20; i++) {
      res = res.push(stepGodView(res.last()!));
    }
    return res;
  }, [gv0]);
  useEffect(() => console.log(gvSteps.toJS()), [gvSteps]);

  const [showStep, setShowStep] = useState(0);
  useEffect(() => console.log(showStep), [showStep]);
  useEffect(() => {
    const cb = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setShowStep(s => Math.min(s + 1, gvSteps.size - 1));
      if (e.key === 'ArrowLeft') setShowStep(s => Math.max(s - 1, 0));
    };
    window.addEventListener('keydown', cb);
    return () => window.removeEventListener('keydown', cb);
  }, [])

  const { worldStates, arrivalInfos, departureInfos } = useMemo(
    () => simulate(Map(), 0 as RealTime, 100, rules),
    [rules]
  );
  const tripColors = useMemo(() => Map(tripsById.keySeq().sort().map((nick, i) => [nick, COLORS[i % COLORS.length]])), [tripsById]);

  return (
    <>
      <div>
        <RulesetEditor init={{ rules, tripsById }} onChange={(ruleset: Ruleset) => {
          setRules(ruleset);
        }} />
      </div>

      <GodViewE gv={gvSteps.get(showStep)!} />

      {hoveredCellInfo && <div className='hovered-cell-info'>
        <div>RealTime: {hoveredCellInfo.r}</div>
        <div>Hypertime: {hoveredCellInfo.h}</div>
        <div>History: {worldStates.get(hoveredCellInfo.r)?.get(hoveredCellInfo.h)?.sort().map(t => <span key={t} style={{ color: tripColors.get(t) }}>{t}</span>)}</div>
        <div>Departures: {departureInfos.get(hoveredCellInfo.r)?.get(hoveredCellInfo.h)?.sort().map(t => <span key={t} style={{ color: tripColors.get(t) }}>{t}</span>)}</div>
      </div>}
    </>
  )
}

export default App
