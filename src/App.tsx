import { useMemo, useState } from 'react';
import { List, Map, Record, Set } from 'immutable';

type CalTime = number & { __type: 'CalTime' };
type Hypertime = number & { __type: 'Hypertime' };
type RealTime = number & { __type: 'RealTime' };
const hc2rt = ({ h, c }: { h: Hypertime, c: CalTime }) => { return h + c as RealTime };
// const rh2ct = ({ r, h }: { r: RealTime, h: Hypertime }) => r - h as CalTime;
const rc2ht = ({ r, c }: { r: RealTime, c: CalTime }) => r - c as Hypertime;

type TripId = string & { __type: 'TripId' };
const TripR = Record({ nick: '<unset>' as TripId, depart: -1 as CalTime, arrive: -1 as CalTime });
type Trip = ReturnType<typeof TripR>;
type History = Set<TripId>;

type Ruleset = {
  rules: Map<History, List<Trip>>;
  tripsById: Map<string, Trip>;
};
type Res<T> = { type: 'ok', val: T } | { type: 'err', err: string };

function RulesetEditor({ onChange }: { onChange: (ruleset: Ruleset) => void }) {
  const [textF, setTextF] = useState('');

  const ruleLines: Res<List<{ history: Set<TripId>, trips: List<Trip> }>> = useMemo(() => {
    let res = List<{ history: Set<TripId>, trips: List<Trip> }>();

    for (const line of textF.split('\n').map(s => s.trim()).filter(x => x)) {
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
      res = res.push({ history, trips });
    };
    // console.log('got', res.toJS());
    return { type: 'ok', val: res };
  }, [textF]);
  // useEffect(() => console.log('ruleLines', ruleLines.type === 'ok' ? ruleLines.val.toJS() : ''), [ruleLines]);

  const tripsById: Res<Map<TripId, Trip>> = useMemo(() => {
    if (ruleLines.type === 'err') return ruleLines;
    let res = Map<TripId, Trip>();
    for (const { trips } of ruleLines.val) {
      for (const trip of trips) {
        if (res.has(trip.nick)) return { type: 'err', err: `Duplicate nickname: ${trip.nick}` };
        res = res.set(trip.nick, trip);
      }
    }
    return { type: 'ok', val: res };
  }, [ruleLines]);

  const rules: Res<Map<History, List<Trip>>> = useMemo(() => {
    if (ruleLines.type === 'err') return ruleLines;
    if (tripsById.type === 'err') return tripsById;
    let res = Map<History, List<Trip>>();
    for (const { history, trips } of ruleLines.val) {
      if (res.has(history)) return { type: 'err', err: `Duplicate history: ${history.sort().join(', ')}` };
      res = res.set(history, trips);
    }
    return { type: 'ok', val: res };
  }, [ruleLines, tripsById]);
  // useEffect(() => console.log('rules', rules.type === 'ok' ? rules.val.toJS() : ''), [rules]);

  const canSubmit = tripsById.type === 'ok' && rules.type === 'ok';
  const submit = () => {
    if (!canSubmit) return;
    onChange({ rules: rules.val, tripsById: tripsById.val });
  }


  return <form onSubmit={e => { e.preventDefault(); submit() }}>
    <textarea rows={10} style={{ minWidth: '20em' }} value={textF} onChange={e => setTextF(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) submit(); }}
    />
    <button type="submit" disabled={!canSubmit}>Update</button>
    {(() => {
      if (ruleLines.type === 'err') return <div style={{ color: 'red' }}>{ruleLines.err}</div>;
      if (tripsById.type === 'err') return <div style={{ color: 'red' }}>{tripsById.err}</div>;
      if (rules.type === 'err') return <div style={{ color: 'red' }}>{rules.err}</div>;
    })()}
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
  const [{ rules, tripsById }, setRules] = useState<{ rules: Map<History, List<Trip>>, tripsById: Map<string, Trip> }>({ rules: Map(), tripsById: Map() });
  // useEffect(() => console.log('rules', rules.toJS()), [rules]);

  const { worldStates, departureInfos } = useMemo(
    () => simulate(Map(), 0 as RealTime, 100, rules),
    [rules]
  );
  const tripColors = useMemo(() => Map(tripsById.keySeq().sort().map((nick, i) => [nick, COLORS[i % COLORS.length]])), [tripsById]);
  const minRT = useMemo(() => worldStates.keySeq().min()!, [worldStates]);
  const maxRT = useMemo(() => worldStates.keySeq().max()!, [worldStates]);
  const minHT = useMemo(() => worldStates.valueSeq().flatMap(h => h.keySeq()).min()!, [worldStates]);
  const maxHT = useMemo(() => worldStates.valueSeq().flatMap(h => h.keySeq()).max()!, [worldStates]);

  return (
    <>
      <div>
        <RulesetEditor onChange={(ruleset: Ruleset) => {
          setRules(ruleset);
        }} />
        {/* <ul>
          {rules.entrySeq().map(([history, futureTrips]) => (<li key={JSON.stringify([history, futureTrips])}>
            <RuleCreator init={{ history, futureTrips }} tripsByNick={tripsByNick} onCreate={({ history, then }) => {
              setTripsByNick(nicks => nicks.deleteAll(futureTrips.map(t => t.nick)).merge(then.map(t => [t.nick, t])));
              setRules(rules.set(history, then));
            }} />
            <button onClick={() => setRules(rules.delete(history))}>Delete</button>
          </li>))}
          <li>
            <RuleCreator key={JSON.stringify(rules.toJS())}
              tripsByNick={tripsByNick}
              onCreate={({ history, then }) => {
                setTripsByNick(nicks => nicks.merge(then.map(t => [t.nick, t])));
                setRules(rules.set(history, then));
              }} />
          </li>
        </ul> */}
      </div>

      <div style={{ display: 'table' }}>
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th></th>
              {range(minRT, maxRT).map(r => <th key={r}>{r}</th>)}
            </tr>
          </thead>
          <tbody>
            {range(minHT, maxHT).map(h => <tr key={h}>
              <td>{h}</td>
              {range(minRT, maxRT).map(r => <td key={r}
                style={{
                  boxSizing: 'border-box',
                  width: '2em',
                  height: '2em',
                  border: '1px solid black',
                  textAlign: 'center',
                  padding: '0',
                }}
              >
                {/* {rh2ct({ r, h })} */}
                {worldStates.get(r)?.get(h)?.sort().map(t => <span key={t} style={{ color: tripColors.get(t) }}> {t} </span>)}
                {departureInfos.get(r)?.get(h)?.sort().map(t => <span key={t} style={{ color: tripColors.get(t) }}> ⦿ </span>)}
              </td>)}
            </tr>)}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div>Trips: {JSON.stringify(tripsById.toJS())}</div>
        <div>Rules: {JSON.stringify(rules.toJS())}</div>
      </div>
    </>
  )
}

const range = <T extends number>(lo: T, hi: T): T[] => Array.from({ length: hi + 1 - lo }, (_, i) => lo + i as T);

export default App
