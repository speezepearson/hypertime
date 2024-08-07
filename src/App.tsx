import { useMemo, useState } from 'react';
import { List, Map, Record, Set } from 'immutable';

import './App.css';

type CalTime = number & { __type: 'CalTime' };
type Hypertime = number & { __type: 'Hypertime' };
type RealTime = number & { __type: 'RealTime' };
const hc2rt = ({ h, c }: { h: Hypertime, c: CalTime }) => { return h + c as RealTime };
// const rh2ct = ({ r, h }: { r: RealTime, h: Hypertime }) => r - h as CalTime;
const rc2ht = ({ r, c }: { r: RealTime, c: CalTime }) => r - c as Hypertime;

type TripId = string & { __type: 'TripId' };
const TripR = Record({ nick: undefined as any as TripId, depart: undefined as any as CalTime, arrive: undefined as any as CalTime });
type Trip = ReturnType<typeof TripR>;
type History = Set<TripId>;

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

function App() {
  const [{ rules, tripsById }, setRules] = useState<{ rules: Map<History, List<Trip>>, tripsById: Map<TripId, Trip> }>((parseRuleset(`
    -> a, 1, 3
    a -> b, 5, -2
    a, b -> c, 8, 20; d, 10, -4
  `) as Res<Ruleset> & { type: 'ok' }).val);
  const [hoveredCellInfo, setHoveredCellInfo] = useState<{ r: RealTime, h: Hypertime } | null>(null);

  const { worldStates, arrivalInfos, departureInfos } = useMemo(
    () => simulate(Map(), 0 as RealTime, 100, rules),
    [rules]
  );
  const tripColors = useMemo(() => Map(tripsById.keySeq().sort().map((nick, i) => [nick, COLORS[i % COLORS.length]])), [tripsById]);
  const minRT = useMemo(() => worldStates.keySeq().min()!, [worldStates]);
  const maxRT = useMemo(() => worldStates.keySeq().max()!, [worldStates]);
  const minHT = useMemo(() => worldStates.valueSeq().flatMap(h => h.keySeq()).min()!, [worldStates]);
  const maxHT = useMemo(() => worldStates.valueSeq().flatMap(h => h.keySeq()).max()!, [worldStates]);

  const arrivalMarker = (t: TripId) => <span style={{ color: tripColors.get(t) }}> ⦿ </span>;
  const departureMarker = (t: TripId) => <span style={{ color: tripColors.get(t) }}> x </span>;

  return (
    <>
      <div>
        <RulesetEditor init={{ rules, tripsById }} onChange={(ruleset: Ruleset) => {
          setRules(ruleset);
        }} />
      </div>

      <div>
        Legend:
        <ul>
          {tripsById.keySeq().sort().map((t) => <>
            <li key={`${t}-depart`}> {departureMarker(t)} : {t} leaves </li>
            <li key={`${t}-arrive`}> {(arrivalMarker(t))} : {t} arrives </li>
          </>)}
        </ul>
      </div>

      <div className="grid-container">
        <div className='grid'>
          <div className='grid-row'>
            {range(minRT, maxRT).map(r => <div key={r} className='grid-item'>{r}</div>)}
          </div>
          {range(minHT, maxHT).map(h => <div key={h} className='grid-row'>
            <div className='grid-item'>{h}</div>
            {range(minRT, maxRT).map(r => <div key={r} className='grid-item'
              onMouseEnter={() => setHoveredCellInfo({ r, h })}
              onMouseLeave={() => { if (hoveredCellInfo?.r === r && hoveredCellInfo?.h === h) setHoveredCellInfo(null) }}
            >
              {arrivalInfos.get(r)?.get(h)?.sort().map(t => <span key={t}>{departureMarker(t)}</span>)}
              {departureInfos.get(r)?.get(h)?.sort().map(t => <span key={t}>{arrivalMarker(t)}</span>)}
            </div>)}
          </div>)}
        </div>
      </div>

      {hoveredCellInfo && <div className='hovered-cell-info'>
        <div>RealTime: {hoveredCellInfo.r}</div>
        <div>Hypertime: {hoveredCellInfo.h}</div>
        <div>History: {worldStates.get(hoveredCellInfo.r)?.get(hoveredCellInfo.h)?.sort().map(t => <span key={t} style={{ color: tripColors.get(t) }}>{t}</span>)}</div>
        <div>Departures: {departureInfos.get(hoveredCellInfo.r)?.get(hoveredCellInfo.h)?.sort().map(t => <span key={t} style={{ color: tripColors.get(t) }}>{t}</span>)}</div>
      </div>}
    </>
  )
}

const range = <T extends number>(lo: T, hi: T): T[] => Array.from({ length: hi + 1 - lo }, (_, i) => lo + i as T);

export default App
