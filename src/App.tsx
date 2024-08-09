import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List, Map, Set } from 'immutable';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import './App.css';
import { CalTime, ChunkR, getNonPastEvents, GodView, GodViewR, History, Hypertime, RealTime, rh2ct, stepGodView, Trip, TripId, TripR } from './util';
import Accordion from '@mui/material/Accordion/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary/AccordionSummary';
import Box from '@mui/material/Box/Box';
import Button from '@mui/material/Button/Button';
import Card from '@mui/material/Card/Card';
import Checkbox from '@mui/material/Checkbox/Checkbox';
import Slider from '@mui/material/Slider/Slider';
import Stack from '@mui/material/Stack/Stack';
import TextField from '@mui/material/TextField/TextField';
import Typography from '@mui/material/Typography/Typography';
import TextareaAutosize from '@mui/material/TextareaAutosize/TextareaAutosize';
import Grid from '@mui/material/Grid/Grid';


type Ruleset = Map<History, List<Trip>>;
type Res<T> = { type: 'ok', val: T } | { type: 'err', err: string };

function parseRuleset(s: string): Res<Ruleset> {

  let tripIds = Set<TripId>();
  let rules: Ruleset = Map();
  for (const line of s.split('\n').map(s => s.trim()).filter(x => x)) {
    const match = /^(.*) *=> *(.*): (-?[0-9.]+) *-> *(-?[0-9.]+)$/.exec(line);
    if (!match) return { type: 'err', err: `expected line of format "$HISTORY -> $TRIP_ID: $DEPART->$ARRIVE"; got ${line}` };
    const [_, historyStr, tripIdStr, departStr, arriveStr] = match.map(s => s.trim());
    if (tripIdStr.includes(';')) return { type: 'err', err: `trip id can't have a semicolon` };
    if (departStr.includes('.') || arriveStr.includes('.')) return { type: 'err', err: `integers only, sorry; floating-point errors are awful` };
    const tripId = tripIdStr as TripId;
    if (tripIds.has(tripId)) return { type: 'err', err: `duplicate trip id ${tripId}` };
    const history = Set(historyStr.split(';').map(s => s.trim()).filter(x => x)) as Set<TripId>;
    const [depart, arrive] = [departStr, arriveStr].map(s => parseInt(s)) as [CalTime, CalTime];
    rules = rules.update(history, List(), ts => ts.push(TripR({ id: tripId, depart, arrive })).sortBy(t => t.depart));
  };

  if (rules.isEmpty()) return { type: 'err', err: 'no rules found; what a boring universe!' };
  return { type: 'ok', val: rules };
}

function RulesetEditor({ init, onChange }: { init?: Ruleset, onChange: (ruleset: Ruleset) => void }) {
  const [textF, setTextF] = useState(() => !init ? '' : init
    .entrySeq()
    .flatMap(([history, trips]) => trips.map(t => `${history.join('; ')} => ${t.id}: ${t.depart}->${t.arrive}`))
    .join('\n')
  );

  const ruleset: Res<Ruleset> = useMemo(() => parseRuleset(textF), [textF]);

  const warnings: List<string> = useMemo(() => {
    if (ruleset.type === 'err') return List();
    const res: string[] = [];

    const definedTrips: Set<TripId> = ruleset.val.valueSeq().flatMap(ts => ts.map(t => t.id)).toSet();
    for (const [history] of ruleset.val) {
      for (const tid of history) {
        if (!definedTrips.has(tid)) res.push(`trip ${tid} mentioned in LHS of rule but never defined on RHS of rule`);
      }
    }

    const tripsById = Map(ruleset.val.valueSeq().flatMap(ts => ts.map(t => [t.id, t])));
    for (const [history, trips] of ruleset.val) {
      if (history.some(tid => !tripsById.has(tid))) continue;
      const latestArrival = history.map(tid => tripsById.get(tid)!).maxBy(t => t.arrive);
      if (!latestArrival) continue;
      for (const t of trips) {
        if (t.depart <= latestArrival.arrive) res.push(`trip ${JSON.stringify(t.id)} departs at ${t.depart}, but depends on ${JSON.stringify(latestArrival.id)} which arrives later, at ${latestArrival.arrive}`);
      }
    }

    return List(res);
  }, [ruleset]);

  const canSubmit = ruleset.type === 'ok';
  const submit = () => {
    if (!canSubmit) return;
    onChange(ruleset.val);
  }

  return <form onSubmit={e => { e.preventDefault(); submit() }}>
    <TextareaAutosize minRows={5} style={{ width: '100%' }} draggable value={textF} onChange={e => setTextF(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) submit(); }}
    />
    <Button variant='contained' sx={{ m: 1 }} type="submit" disabled={!canSubmit}>Update</Button>
    {warnings.map((w, i) => <div key={i} style={{ color: 'red' }}>Warning: {w}</div>)}
    {ruleset.type === 'err' && <div style={{ color: 'red' }}>Error: {ruleset.err}</div>}
  </form>
}

// All these need to be readable against a white background.
const COLORS = ['red', 'green', 'blue', 'purple', 'orange', 'magenta', 'cyan', 'brown', 'black', 'gray'];

function getTripColors(gv: GodView): Map<TripId, string> {
  return Map(gv.past.sortBy(b => b.start.r0).reduce(
    (acc, b) => acc.has(b.start.tripId) ? acc : acc.set(b.start.tripId, COLORS[acc.size % COLORS.length]),
    Map<TripId, string>(),
  ));
}

function getBoxStyles(gv: GodView): Map<TripId, CSSProperties> {
  return getTripColors(gv).mapEntries(([id, color]) => [id, {
    borderLeft: `2px solid ${color}`,
    backgroundColor: `color-mix(in srgb, ${color}, transparent 90%)`,
  }]);
}

function Legend({ gv, onHover }: { gv: GodView, onHover: (t: TripId | null) => void }) {

  const [hoveredTrip, setHoveredTrip] = useState<TripId | null>(null);
  useEffect(() => onHover(hoveredTrip), [hoveredTrip]);

  const boxStyles = useMemo(() => getBoxStyles(gv), [gv]);

  return <Stack direction='column' spacing={1}>
    <Typography>(hover to highlight)</Typography>
    {boxStyles.keySeq().map((id) => <Box key={id} sx={{ pl: '2em' }}>
      <div style={{ transform: 'skew(45deg)', padding: '0.5em 1em', ...boxStyles.get(id), ...hoveredTrip === id ? { outline: '1px dashed black' } : {} }}
        onMouseEnter={() => setHoveredTrip(id)} onMouseLeave={() => setHoveredTrip(null)}
      >
        <Typography sx={{ transform: 'skew(-45deg)' }}>
          {id}
        </Typography>
      </div>
    </Box>)}
  </Stack>

}

function GodViewE({ gv, onHover, highlightedTrip, zeroT, fwd, bak }: {
  gv: GodView,
  onHover: (info: { r: RealTime, h: Hypertime } | null) => void,
  highlightedTrip: TripId | null,
  zeroT: () => void,
  fwd: () => void,
  bak: () => void,
}) {

  const [scale, setScale] = useState(0);
  const pxPerDay = 20 * Math.exp(scale);

  const [showArrows, setShowArrows] = useState(true);
  const [showChunks, setShowChunks] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [gridSpacing, setGridSpacing] = useState(10);

  // Find the color for each trip, assigning each trip's color before before knowing anything about any future trip,
  // so that colors don't change as the user scans forward in time.
  const tripColors = useMemo(() => getTripColors(gv), [gv]);
  const boxStyles = useMemo(() => getBoxStyles(gv), [gv]);

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cb = (e: MouseEvent) => {
      const rect = ref.current!.getBoundingClientRect();
      const r = (e.clientX - rect.left) / pxPerDay as RealTime;
      const h = (e.clientY - rect.top) / pxPerDay as Hypertime;
      onHover({ r, h });
    };
    const refCurrent = ref.current;
    refCurrent?.addEventListener('mousemove', cb);
    return () => refCurrent?.removeEventListener('mousemove', cb);
  }, []);

  const maxHT = gv.past.flatMap(b => [b.start.departH0 + (b.rf - b.start.r0), b.start.arriveH0 + (b.rf - b.start.r0)]).max() ?? 20;

  return <div>

    <Grid container spacing={1}>
      <Grid item xs={12} md={6} lg={4}>
        <Card sx={{ m: 1, p: 1 }}>
          <Stack direction='row' spacing={1} alignItems='center' justifyContent={'center'}>
            <Button variant='outlined' onClick={zeroT}>0</Button>
            <Button variant='outlined' onClick={bak}>←</Button>
            <Typography sx={{ width: '16em', textAlign: 'center' }}>
              Simulating until real time = {gv.now}<br />
              (change: buttons or arrow keys)
            </Typography>
            <Button variant='outlined' onClick={fwd}>→</Button>
          </Stack>
        </Card>
      </Grid>

      <Grid item xs={12} md={6} lg={4}>
        <Accordion sx={{ m: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant='h5'>Debug info</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <ul>
              <li>Future events: <ul>{getNonPastEvents(gv).map((e, i) => <li key={i}>{e.tripId} at {e.r0}</li>)}</ul></li>
              <li>
                <Checkbox checked={showChunks} onChange={e => setShowChunks(e.target.checked)} />
                Chunks: {showChunks && gv.chunks.sortBy(c => c.start).map((c, i) => <span key={i}>({c.start}-{c.end}: {c.history})</span>)}
              </li>
              <li>Events: {gv.past.sortBy(b => b.start.r0).map((b, i) => <span key={i}>({b.start.r0}-{b.rf}: {b.start.tripId} h={b.start.departH0} to {b.start.arriveH0})</span>)}</li>
            </ul>
          </AccordionDetails>
        </Accordion>
      </Grid>

      <Grid item xs={12} md={6} lg={4}>
        <Accordion sx={{ m: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant='h5'>Display settings</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack direction='row' spacing={1} alignItems='center'>
              <Typography>Scale:</Typography>
              <Slider style={{ width: '20em' }} min={-5} max={5} step={0.001} value={scale} onChange={(_, value) => { console.log('hi', value); setScale(value as number) }} />
            </Stack>
            <Stack direction='row' spacing={1} alignItems='center'>
              <Checkbox checked={showArrows} onChange={e => setShowArrows(e.target.checked)} />
              <Typography>Show arrows</Typography>
            </Stack>
            <Stack direction='row' spacing={1} alignItems='center'>
              <Checkbox checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />
              <Typography>Show grid lines every</Typography>
              <TextField type='number' style={{ width: '5em' }} value={gridSpacing} onChange={(e) => setGridSpacing(parseFloat(e.target.value))} />
            </Stack>
          </AccordionDetails>
        </Accordion>
      </Grid>
    </Grid>

    <Box>

      <Box sx={{ p: 4 }}>
        <Box
          ref={ref}
          onMouseLeave={() => onHover(null)}
          style={{ position: 'absolute', width: '100%', height: '100%', overflow: 'scroll' }}
        >

          <div style={{
            position: 'absolute',
            left: `${gv.now * pxPerDay}px`,
            top: 0,
            width: '1px',
            height: `${maxHT * pxPerDay}px`,
            borderLeft: '1px solid color-mix(in srgb, black, transparent 80%)',
          }}>now</div>

          {showChunks && gv.chunks.map((chunk, i) => <div key={i} style={{
            position: 'absolute',
            left: 0,
            width: `${gv.now * pxPerDay}px`,
            top: `${chunk.start * pxPerDay}px`,
            height: `${(chunk.end - chunk.start) * pxPerDay}px`,
            // backgroundColor: 'rgba(0, 0, 0, 0.1)',
            borderBottom: '1px solid gray',
          }}>
            {chunk.start === 0 && 'hypertimes '}{chunk.start}-{chunk.end}
            {/* : {chunk.history.sort().toArray()} */}
          </div>)}

          {showGrid && gridSpacing > 0 && <>
            {Array.from({ length: Math.ceil(gv.now / gridSpacing) }, (_, i) => i * gridSpacing).map(rt => <div key={rt} style={{
              position: 'absolute',
              left: `${rt * pxPerDay}px`,
              width: '1px',
              top: 0,
              height: `${maxHT * pxPerDay}px`,
              borderLeft: '1px solid color-mix(in srgb, black, transparent 90%)',
              color: 'color-mix(in srgb, black, transparent 50%)',
            }}>
              {rt}
            </div>)}
            {Array.from({ length: Math.ceil(maxHT / gridSpacing) }, (_, i) => i * gridSpacing).map(ht => <div key={ht} style={{
              position: 'absolute',
              left: 0,
              width: `${gv.now * pxPerDay}px`,
              top: `${ht * pxPerDay}px`,
              height: '1px',
              borderBottom: '1px solid color-mix(in srgb, black, transparent 90%)',
              color: 'color-mix(in srgb, black, transparent 50%)',
            }}>
              {ht}
            </div>)}
          </>}

          {gv.past.map((box, i) => {
            const dur = (box.rf - box.start.r0);
            const up = box.start.arriveH0 < box.start.departH0;
            const color = tripColors.get(box.start.tripId) ?? 'black';
            return <div key={i}
              style={{
                transform: 'skew(45deg)',
                position: 'absolute',
                left: `${(box.start.r0 + dur / 2) * pxPerDay}px`,
                width: '0',
                top: `${box.start.departH0 * pxPerDay}px`,
                height: `${pxPerDay * dur}px`,
                borderLeft: `1px solid ${color}`,
                color: color,
                display: 'flex', flexDirection: up ? 'row' : 'row-reverse',
                ...highlightedTrip === box.start.tripId ? { outline: '1px dashed #00000088' } : {},
              }}
            >
              {!showArrows ? '' : up ? '↗' : '↙'}
            </div>
          })}

          {gv.past.map((box, i) => {
            const dur = (box.rf - box.start.r0);
            return <div key={i}
              style={{
                transform: 'skew(45deg)',
                position: 'absolute',
                left: `${(box.start.r0 + dur / 2) * pxPerDay}px`,
                width: `${(gv.now - box.start.r0) * pxPerDay}px`,
                top: `${box.start.arriveH0 * pxPerDay}px`,
                height: `${pxPerDay * dur}px`,
                ...boxStyles.get(box.start.tripId),
                ...highlightedTrip === box.start.tripId ? { outline: '2px dashed #00000088' } : {},
              }}
            >
              {/* {box.start.tripId}: r0 {box.start.r0} arr {box.start.arriveH0} dur {box.start.departH0 - box.start.arriveH0} */}
            </div>
          })}
        </Box>
      </Box>
    </Box>
  </div>
}

function App() {
  const [rules, setRules] = useState<Ruleset>((parseRuleset(`
    => Alice goes back to fix her party: 15->4
    Alice goes back to fix her party => Alice tries to go back to the future: 6->16
    Alice goes back to fix her party => Bob goes back to stop Alice: 6->3
    Alice goes back to fix her party; Bob goes back to stop Alice => Charlie goes forward to talk Alice out of her initial jump: 8->14
  `) as Res<Ruleset> & { type: 'ok' }).val);
  useEffect(() => console.log(rules.toJS()), [rules]);
  // debugger;
  const [hoveredCellInfo, setHoveredCellInfo] = useState<{ r: RealTime, h: Hypertime } | null>(null);

  const [showStep, setShowStep] = useState(40);
  const gv0: GodView = useMemo(() => GodViewR({
    now: 0 as RealTime,
    chunks: List([
      ChunkR({ start: 0 as Hypertime, end: Infinity as Hypertime, history: Set() }),
    ]),
    past: List(),
    rules: h => rules.get(h) ?? List(),
  }), [rules]);

  const [gv, setGv] = useState(gv0);
  const gvStepsCache = useRef([gv0]);
  useEffect(() => {
    if (!gv0.equals(gvStepsCache.current[0])) gvStepsCache.current = [gv0];
    const cache = gvStepsCache.current;

    while (showStep >= cache.length - 1) {
      const next = stepGodView(cache[cache.length - 1]);
      if (next.now === Infinity) {
        setGv(cache[cache.length - 1]);
        return;
      }
      cache.push(next);
    }

    setGv(cache[showStep]);
  }, [gv0, showStep]);

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

  const [highlightedTrip, setHighlightedTrip] = useState<TripId | null>(null);

  return (
    <>
      <Typography>
        Welcome to a <a href="https://qntm.org/hypertime">hypertime</a> simulator!
      </Typography>

      <Accordion sx={{ m: 1 }}>
        <AccordionSummary sx={{ maxWidth: '20em' }} expandIcon={<ExpandMoreIcon />}>
          <Typography variant='h4'> Huh? What? </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography>
            I'll assume you've read <a href="https://qntm.org/hypertime">qntm.org/hypertime</a>.
            This simulator shows (roughly) the visualization laid out there: "real" time increases left-to-right, "hypertime" increases top-to-bottom. Lines of constant "calendar time" (e.g. "Jan 1") are diagonal, going down-and-right.
          </Typography>
          <Typography sx={{ mt: 1 }}>
            Core concepts for this simulator that <i>aren't</i> covered by qntm's article:
          </Typography>
          <ul>
            <li>
              <Typography>
                <b>The "ruleset."</b>{' '}
                This is how you describe who travels between hypertimes.
                A single "rule" is of the form: "if [THESE TIME TRAVELLERS] arrive, then [THIS TIME TRAVELLER] will depart." For example:
              </Typography>

              <ul>
                <li>
                  <Typography>
                    "If no time travellers show up in a timeline, then: on Jan 15, Alice will travel back to Jan 4, to prevent the disaster at her birthday party." <br />
                    (In the format recognized by this simulator, this would be written:{' '}
                    <code style={{ backgroundColor: '#eee' }}>&nbsp;{' => Alice goes back to fix her party: 15->4'}</code>.)
                  </Typography>
                </li>
                <li>
                  <Typography>
                    "In timelines where Alice showed up on Jan 4: after stopping the party, Alice tries to go back to the future, leaves on Jan 6, going back to Jan 16."<br />
                    (Written: <code style={{ backgroundColor: '#eee' }}>&nbsp;{'Alice goes back to fix her party => Alice tries to go back to the future: 6->16'}</code>)
                  </Typography>
                </li>
                <li>
                  <Typography>
                    "In timelines where Alice showed up on Jan 4: Bob steals the time-travel device and goes back to Jan 3 to stop her."<br />
                    (Written: <code style={{ backgroundColor: '#eee' }}>&nbsp;{'Alice goes back to fix her party => Bob goes back to stop Alice: 6->3'}</code>)
                  </Typography>
                </li>
                <li>
                  <Typography>
                    "In timelines where Bob showed up on Jan 3, then Alice showed up on Jan 4: Charlie goes forward to talk Alice out of her initial jump, leaving Jan 8, aiming for Jan 14."<br />
                    (Written: <code style={{ backgroundColor: '#eee' }}>&nbsp;{'Alice goes back to fix her party; Bob goes back to stop Alice => Charlie goes forward to talk Alice out of her initial jump: 8->14'}</code>)
                  </Typography>
                </li>
              </ul>
            </li>
          </ul>

          <Typography>
            ...I think that's it.
          </Typography>

          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant='h5'>Weird stuff / bugs / musings</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <ul>
                <li>
                  <Typography>
                    <b>Negative hypertimes don't exist.</b>{' '}
                    If you try to travel to a negative hypertime, you fall off the edge of the universe, never to be heard from again.
                  </Typography>
                  <Typography sx={{ mt: 1 }}>
                    I wish hypertime could extend infinitely in both directions, but I couldn't figure out how to make that work:
                    the simulator needs to start at <i>some</i> (real) time, and there's sort of a bootstrapping issue.
                  </Typography>
                </li>
              </ul>
            </AccordionDetails>
          </Accordion>

        </AccordionDetails >
      </Accordion >

      <Grid container spacing={1}>
        <Grid item xs={12} md={6}>
          <Card sx={{ m: 1, p: 1 }}>
            <Typography variant='h5'> Ruleset editor </Typography>

            <RulesetEditor init={rules} onChange={(ruleset: Ruleset) => {
              setRules(ruleset);
            }} />
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ m: 1, p: 1 }}>
            <Accordion defaultExpanded sx={{ m: 1 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant='h5'>Legend</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack direction='column' spacing={1}>
                  <Legend gv={gv} onHover={setHighlightedTrip} />
                </Stack>
              </AccordionDetails>
            </Accordion>
          </Card>
        </Grid>
      </Grid>

      <GodViewE gv={gv} onHover={setHoveredCellInfo} highlightedTrip={highlightedTrip} zeroT={() => setShowStep(0)} fwd={fwd} bak={bak} />

      {
        hoveredCellInfo && <div className='hovered-cell-info'>
          <div><Typography>RealTime: {hoveredCellInfo.r.toFixed(2)}</Typography></div>
          <div><Typography>Hypertime: {hoveredCellInfo.h.toFixed(2)}</Typography></div>
          <div><Typography>CalTime: {rh2ct(hoveredCellInfo).toFixed(2)}</Typography></div>
        </div>
      }
    </>
  )
}

// function Playground() {
//   const [skew, setSkew] = useState(0);
//   const [r1, setR1] = useState(0);
//   const [h1, setH1] = useState(0);
//   const [r2, setR2] = useState(0);
//   const [h2, setH2] = useState(0);
//   return <div>
//     <input type='range' min={-45} max={45} value={skew} onChange={e => setSkew(parseInt(e.target.value))} /> {skew}deg<br />
//     <input type='range' min={0} max={5} step="any" value={r1} onChange={e => setR1(parseFloat(e.target.value))} /> r={r1}<br />
//     <input type='range' min={0} max={5} step="any" value={h1} onChange={e => setH1(parseFloat(e.target.value))} /> h={h1}<br />
//     <input type='range' min={0} max={5} step="any" value={r2} onChange={e => setR2(parseFloat(e.target.value))} /> r={r2}<br />
//     <input type='range' min={0} max={5} step="any" value={h2} onChange={e => setH2(parseFloat(e.target.value))} /> h={h2}<br />
//     <div style={{ position: 'absolute', width: '10em', height: '10em', outline: '1px solid black' }}>
//       <div style={{ transform: `skew(${skew}deg)`, position: 'absolute', left: `${2 * r1 + Math.tan(skew * Math.PI / 180)}em`, top: `${h1 * pxPerDay}px`, width: '2em', height: '2em', backgroundColor: 'pink' }}></div>
//       <div style={{ transform: `skew(${skew}deg)`, position: 'absolute', left: `${2 * r2 + Math.tan(skew * Math.PI / 180)}em`, top: `${h2 * pxPerDay}px`, width: '2em', height: '2em', backgroundColor: 'pink' }}></div>
//     </div>
//   </div>
// }

export default App
