import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List, Map, Set } from 'immutable';

import './App.css';
import { CalTime, ChunkR, getNextInterestingTime, getNonPastEvents, GodView, GodViewR, hc2rt, History, Hypertime, rc2ht, RealTime, rh2ct, stepGodView, Trip, TripId, TripR } from './util';


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
    for (const tripS of futureStr.split(';').map(s => s.trim()).filter(x => x)) {
      const match = /^(.*), *(-?[0-9.]+) *, *(-?[0-9.]+) *$/.exec(tripS);
      if (!match) return { type: 'err', err: 'Format: $ID,$DEPART,ARRIVE; $ID,$DEPART,ARRIVE; ...' };
      const [_, id, departS, arriveS] = match.map(s => s.trim());
      if (arriveS === undefined) return { type: 'err', err: 'Format: $ID,$DEPART,$ARRIVE; $ID,$DEPART,$ARRIVE; ...' };
      const [depart, arrive] = [departS, arriveS].map(s => parseFloat(s)) as [CalTime, CalTime];
      trips = trips.push(TripR({ id: id as TripId, depart, arrive }));
    };
    ruleLines = ruleLines.push({ history, trips });
  };

  let tripsById: Map<TripId, Trip> = Map();
  for (const { trips } of ruleLines) {
    for (const trip of trips) {
      if (tripsById.has(trip.id)) return { type: 'err', err: `Duplicate id: ${trip.id}` };
      tripsById = tripsById.set(trip.id, trip);
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
    .map(([history, trips]) => `${history.join(', ')} -> ${trips.map(t => `${t.id},${t.depart},${t.arrive}`).join('; ')}`)
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

// All these need to be readable against a white background.
const COLORS = ['red', 'green', 'blue', 'purple', 'orange', 'magenta', 'cyan', 'brown', 'black', 'gray'];

const PX_PER_DAY = 20;
function GodViewE({ gv, tripColors, onHover }: { gv: GodView, tripColors: Map<TripId, string>, onHover: (info: { r: RealTime, h: Hypertime } | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cb = (e: MouseEvent) => {
      const rect = ref.current!.getBoundingClientRect();
      const r = (e.clientX - rect.left) / PX_PER_DAY as RealTime;
      const h = (e.clientY - rect.top) / PX_PER_DAY as Hypertime;
      onHover({ r, h });
    };
    const refCurrent = ref.current;
    refCurrent?.addEventListener('mousemove', cb);
    return () => refCurrent?.removeEventListener('mousemove', cb);
  }, []);

  return <>
    <details><summary>Debug info (t={gv.now}, next={getNextInterestingTime(gv)})</summary>
      <ul>
        <li>Future events: <ul>{getNonPastEvents(gv).map((e, i) => <li key={i}>{e.tripId} at {e.r0}</li>)}</ul></li>
        <li>Chunks: {gv.chunks.sortBy(c => c.start).map((c, i) => <span key={i}>({c.start}-{c.end}: {c.history})</span>)}</li>
        <li>Events: {gv.past.sortBy(b => b.start.r0).map((b, i) => <span key={i}>({b.start.r0}-{b.rf}: {b.start.tripId} h={b.start.departH0} to {b.start.arriveH0})</span>)}</li>
      </ul>
    </details>

    <div style={{ position: 'absolute', width: '100%', height: '100%', overflow: 'scroll' }} ref={ref}>

      <div style={{
        position: 'absolute',
        left: `${gv.now * PX_PER_DAY}px`,
        top: 0,
        width: '1px',
        height: '100%',
        borderLeft: '2px dashed black',
      }}></div>

      {gv.chunks.map((chunk, i) => <div key={i} style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: `${chunk.start * PX_PER_DAY}px`,
        height: `${(chunk.end - chunk.start) * PX_PER_DAY}px`,
        // backgroundColor: 'rgba(0, 0, 0, 0.1)',
        borderBottom: '1px solid gray',
      }}>
        h={chunk.start}-{chunk.end}
        {/* : {chunk.history.sort().toArray()} */}
      </div>)}

      {gv.past.map((box, i) => {
        const dur = (box.rf - box.start.r0);
        const up = box.start.arriveH0 < box.start.departH0;
        const color = tripColors.get(box.start.tripId) ?? 'black';
        return <div key={i} style={{
          transform: 'skew(45deg)',
          position: 'absolute',
          left: `${(box.start.r0 + dur / 2) * PX_PER_DAY}px`,
          width: '0',
          top: `${box.start.departH0 * PX_PER_DAY}px`,
          height: `${PX_PER_DAY * dur}px`,
          color: color,
          borderLeft: `1px dashed ${color}`,
          display: 'flex', flexDirection: up ? 'row' : 'row-reverse',
        }}>
          {up ? '↗' : '↙'}
        </div>
      })}

      {gv.past.map((box, i) => {
        const dur = (box.rf - box.start.r0);
        return <div key={i} style={{
          transform: 'skew(45deg)',
          position: 'absolute',
          left: `${(box.start.r0 + dur / 2) * PX_PER_DAY}px`,
          width: '100%',
          top: `${box.start.arriveH0 * PX_PER_DAY}px`,
          height: `${PX_PER_DAY * dur}px`,
          backgroundColor: 'rgba(0, 0, 0, 0.1)',
          borderLeft: `2px solid ${tripColors.get(box.start.tripId) ?? 'black'}`,
        }}>
          {/* {box.start.tripId}: r0 {box.start.r0} arr {box.start.arriveH0} dur {box.start.departH0 - box.start.arriveH0} */}
        </div>
      })}
    </div>
  </>
}

function App() {
  const [{ rules, tripsById }, setRules] = useState<{ rules: Map<History, List<Trip>>, tripsById: Map<TripId, Trip> }>((parseRuleset(`
    -> a, 10, 2
    a -> b, 15, 8
    a, b -> c, 18, 30; d, 20, 6
      `) as Res<Ruleset> & { type: 'ok' }).val);
  const [hoveredCellInfo, setHoveredCellInfo] = useState<{ r: RealTime, h: Hypertime } | null>(null);

  const [showStep, setShowStep] = useState(20);
  const gv0: GodView = useMemo(() => GodViewR({
    now: 0 as RealTime,
    chunks: List([ChunkR({ start: 0 as Hypertime, end: Infinity as Hypertime, history: Set() })]),
    past: List(),
    rules,
  }), [rules]);
  const [gvSteps, setGvSteps] = useState(List([gv0]));
  useEffect(() => setGvSteps(List([gv0])), [gv0]);
  useEffect(() => setGvSteps(cur => {
    if (showStep <= 0) return List([gv0]);
    if (showStep < cur.size) return cur.slice(0, showStep + 1);
    while (showStep >= cur.size) {
      cur = cur.push(stepGodView(cur.last()!));
    }
    if (showStep !== cur.size - 1) throw new Error('showStep !== cur.size - 1');
    return cur;
  }), [rules, gv0, showStep]);

  const fwd = useCallback(() => {
    setShowStep(step => step + 1);
  }, [setShowStep])
  const bak = useCallback(() => {
    setShowStep(step => Math.max(0, step - 1));
  }, [setShowStep]);
  useEffect(() => {
    const cb = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); fwd(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); bak(); }
    };
    window.addEventListener('keydown', cb);
    return () => window.removeEventListener('keydown', cb);
  }, [fwd, bak]);

  const tripColors = useMemo(() => Map(tripsById.keySeq().sort().map((id, i) => [id, COLORS[i % COLORS.length]])), [tripsById]);

  return (
    <>
      {showStep} / {gvSteps.size}
      {/* <Playground /> */}
      <div>
        <RulesetEditor init={{ rules, tripsById }} onChange={(ruleset: Ruleset) => {
          setRules(ruleset);
        }} />
      </div>

      <div>
        Legend:
        <ul>
          {tripColors.entrySeq().sortBy(([id]) => id).map(([id, color]) => <li key={id} style={{ color }}>{id}</li>)}
        </ul>
      </div>

      <GodViewE gv={gvSteps.last()!} tripColors={tripColors} onHover={setHoveredCellInfo} />

      {hoveredCellInfo && <div className='hovered-cell-info'>
        <div>RealTime: {hoveredCellInfo.r.toFixed(2)}</div>
        <div>Hypertime: {hoveredCellInfo.h.toFixed(2)}</div>
        <div>CalTime: {rh2ct(hoveredCellInfo).toFixed(2)}</div>
      </div>}
    </>
  )
}

function Playground() {
  const [skew, setSkew] = useState(0);
  const [r1, setR1] = useState(0);
  const [h1, setH1] = useState(0);
  const [r2, setR2] = useState(0);
  const [h2, setH2] = useState(0);
  return <div>
    <input type='range' min={-45} max={45} value={skew} onChange={e => setSkew(parseInt(e.target.value))} /> {skew}deg<br />
    <input type='range' min={0} max={5} step="any" value={r1} onChange={e => setR1(parseFloat(e.target.value))} /> r={r1}<br />
    <input type='range' min={0} max={5} step="any" value={h1} onChange={e => setH1(parseFloat(e.target.value))} /> h={h1}<br />
    <input type='range' min={0} max={5} step="any" value={r2} onChange={e => setR2(parseFloat(e.target.value))} /> r={r2}<br />
    <input type='range' min={0} max={5} step="any" value={h2} onChange={e => setH2(parseFloat(e.target.value))} /> h={h2}<br />
    <div style={{ position: 'absolute', width: '10em', height: '10em', outline: '1px solid black' }}>
      <div style={{ transform: `skew(${skew}deg)`, position: 'absolute', left: `${2 * r1 + Math.tan(skew * Math.PI / 180)}em`, top: `${h1 * PX_PER_DAY}px`, width: '2em', height: '2em', backgroundColor: 'pink' }}></div>
      <div style={{ transform: `skew(${skew}deg)`, position: 'absolute', left: `${2 * r2 + Math.tan(skew * Math.PI / 180)}em`, top: `${h2 * PX_PER_DAY}px`, width: '2em', height: '2em', backgroundColor: 'pink' }}></div>
    </div>
  </div>
}

export default App
