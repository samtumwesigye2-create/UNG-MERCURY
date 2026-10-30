import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useAuthActions } from '@convex-dev/auth/react'
import { AuthGate, StaffPanel } from '../components/auth-gate'

export const Route = createFileRoute('/')({ component: () => <AuthGate><MercuryApp /></AuthGate> })

type Stage = 'intake' | 'sort' | 'dispatch'
type View = 'station' | 'control' | 'manifests' | 'exceptions' | 'history' | 'admin'

const stageLabels: Record<Stage, string> = { intake: 'Intake', sort: 'Route to lane', dispatch: 'Dispatch' }

function MercuryApp() {
  const data = useQuery(api.mercury.dashboard)
  const me = useQuery(api.staff.me)
  const isAdmin = me?.staff?.role === 'admin'
  const { signOut } = useAuthActions()
  const seed = useMutation(api.mercury.seed)
  const processScan = useMutation(api.mercury.processScan)
  const createManifest = useMutation(api.mercury.createManifest)
  const updateManifest = useMutation(api.mercury.updateManifest)
  const reportException = useMutation(api.mercury.reportException)
  const resolveException = useMutation(api.mercury.resolveException)
  const createFacility = useMutation(api.mercury.createFacility)
  const createLane = useMutation(api.mercury.createLane)
  const setLaneStatus = useMutation(api.mercury.setLaneStatus)
  const [view, setView] = useState<View>('station')
  const [stage, setStage] = useState<Stage>('intake')
  const [tracking, setTracking] = useState('')
  const [destination, setDestination] = useState('')
  const [message, setMessage] = useState('Scanner ready')
  const [busy, setBusy] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const [selectedFacility, setSelectedFacility] = useState('KLA-01')
  const [operator, setOperator] = useState('MERCURY-STATION-01')
  const [cameraOpen, setCameraOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const history = useQuery(api.mercury.packageHistory, historyQuery ? { trackingNumber: historyQuery } : 'skip')
  const scanRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (isAdmin && data && data.facilities.length === 0) void seed().catch(() => {}) }, [data, seed, isAdmin])
  useEffect(() => { scanRef.current?.focus() }, [stage, view])
  const facility = selectedFacility || data?.facilities[0]?.code || 'KLA-01'
  useEffect(() => { if (data?.facilities.length && !data.facilities.some((f: any) => f.code === selectedFacility)) setSelectedFacility(data.facilities[0].code) }, [data, selectedFacility])
  const openExceptions = data?.exceptions.filter((item: any) => item.status === 'open') ?? []
  const today = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const stats = useMemo(() => ({
    processed: data?.scans.length ?? 0,
    inSort: data?.packages.filter((item: any) => item.status === 'sorted').length ?? 0,
    dispatched: data?.packages.filter((item: any) => item.status === 'dispatched').length ?? 0,
  }), [data])

  async function submitScan(event: React.FormEvent) {
    event.preventDefault()
    if (!tracking.trim()) return
    setBusy(true)
    try {
      const result = await processScan({ trackingNumber: tracking, destinationCode: destination || undefined, stage, facilityCode: facility, operator })
      setMessage(result.laneCode ? `${result.uCode} · Send ${result.trackingNumber} to lane ${result.laneCode}` : `${result.uCode} · ${stageLabels[stage]} complete`)
      setTracking(''); if (stage !== 'intake') setDestination('')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Scan failed') }
    finally { setBusy(false); scanRef.current?.focus() }
  }

  async function startCamera() {
    try {
      const Detector = (window as any).BarcodeDetector
      if (!Detector) { setMessage('Camera barcode detection is not supported on this browser; use a Bluetooth scanner or type the code.'); return }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream; setCameraOpen(true)
      setTimeout(async () => {
        if (!videoRef.current) return
        videoRef.current.srcObject = stream; await videoRef.current.play()
        const detector = new Detector({ formats: ['code_128','code_39','ean_13','ean_8','qr_code','upc_a','upc_e'] })
        const timer = window.setInterval(async () => {
          if (!videoRef.current) return
          try { const codes = await detector.detect(videoRef.current); if (codes[0]?.rawValue) { setTracking(codes[0].rawValue); window.clearInterval(timer); stopCamera(); setMessage('Barcode captured — confirm the scan') } } catch {}
        }, 450)
      }, 100)
    } catch { setMessage('Camera permission was denied or unavailable') }
  }

  function stopCamera() { streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; setCameraOpen(false) }

  async function addFacility() {
    const code = window.prompt('Facility code (example: JIN-01)'); if (!code) return
    const name = window.prompt('Facility name'); if (!name) return
    const city = window.prompt('City') ?? ''
    const address = window.prompt('Address (optional)') ?? ''
    await createFacility({ code, name, city, address: address || undefined }); setMessage(`Facility ${code.toUpperCase()} registered`)
  }

  async function addLane() {
    const code = window.prompt('Lane code'); if (!code) return
    const name = window.prompt('Lane name') ?? code
    const prefix = window.prompt('Destination ZIP/grid prefix'); if (!prefix) return
    const capacity = Number(window.prompt('Lane capacity') ?? '0'); if (!capacity) return
    await createLane({ facilityCode: facility, code, name, destinationPrefix: prefix, capacity }); setMessage(`Lane ${code.toUpperCase()} added`)
  }

  async function newManifest() {
    const destination = window.prompt('Destination facility or route')
    if (!destination) return
    const number = await createManifest({ originFacility: facility, destination })
    setMessage(`Manifest ${number} created`)
  }

  async function newException() {
    const trackingNumber = window.prompt('Tracking number')
    if (!trackingNumber) return
    const description = window.prompt('Describe the issue') ?? 'Manual exception'
    await reportException({ trackingNumber, type: 'processing', severity: 'medium', description, facilityCode: facility })
    setView('exceptions')
  }

  return (
    <main className="app-shell" data-state={data === undefined ? 'loading' : 'ready'}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div><strong>UNG-MERCURY</strong><span>Sortation & Processing</span></div>
        </div>
        <nav>
          {([
            ['station','Scan station','01'], ['control','Control room','02'], ['manifests','Manifests','03'],
            ['exceptions','Exceptions','04'], ['history','Package history','05'], ['admin','Administration','06'],
          ] as [View,string,string][]).map(([id,label,num]) => (
            <button key={id} className={view === id ? 'nav-active' : ''} onClick={() => setView(id)}><span>{num}</span>{label}</button>
          ))}
        </nav>
        <div className="system-links">
          <p>Connected systems</p>
          <span>VECTOR · UGASHIP</span><span>UGAMAP · UGATU</span><span>NEXUS</span>
        </div>
        <div className="system-links">
          <p>Signed in</p>
          <span>{me?.staff?.email}</span><span>{isAdmin ? 'Administrator' : 'Staff'}</span>
          <button className="ghost" onClick={() => void signOut()}>Sign out</button>
        </div>
      </aside>

      <section className="workspace">
        <header>
          <div><p className="eyebrow">National goods flow network</p><h1>{view === 'station' ? 'Processing station' : view.replace('_',' ')}</h1></div>
          <div className="header-meta"><span className="live-dot">LIVE</span><strong>{facility}</strong><small>{today}</small></div>
        </header>

        {view === 'station' && (
          <>
            <div className="stage-strip">
              {(Object.keys(stageLabels) as Stage[]).map((item, index) => <button key={item} onClick={() => setStage(item)} className={stage === item ? 'stage-active' : ''}><span>0{index + 1}</span>{stageLabels[item]}</button>)}
            </div>
            <section className="scan-grid">
              <div className="scan-panel">
                <div className="panel-heading"><div><p className="eyebrow">Active workflow</p><h2>{stageLabels[stage]}</h2></div><span className="scanner-status">● Scanner online</span></div>
                <div className="station-context"><select value={facility} onChange={e=>setSelectedFacility(e.target.value)}>{data?.facilities.map((f:any)=><option key={f._id} value={f.code}>{f.code} — {f.name}</option>)}</select><input value={operator} onChange={e=>setOperator(e.target.value)} placeholder="Operator name" /></div>
                <form onSubmit={submitScan}>
                  <label>Tracking number or barcode</label>
                  <div className="scan-input"><span>▥</span><input ref={scanRef} value={tracking} onChange={e => setTracking(e.target.value)} placeholder="Scan or enter tracking number" autoComplete="off" /></div>
                  {(stage === 'intake' || stage === 'sort') && <><label>Destination ZIP / grid code</label><input className="field" value={destination} onChange={e => setDestination(e.target.value)} placeholder="Auto-filled from UGASHIP when available" /></>}
                  <button type="button" className="camera-button" onClick={startCamera}>▣ Use camera scanner</button>
                  <button className="primary" disabled={busy}>{busy ? 'Processing…' : `Confirm ${stageLabels[stage]}`}</button>
                </form>
                <div className={message.includes('failed') || message.includes('required') || message.includes('No active') ? 'result error' : 'result'}><span>↳</span>{message}</div>
              </div>
              <div className="lane-panel">
                <div className="panel-heading"><div><p className="eyebrow">Live floor</p><h2>Sort lanes</h2></div><span>{data?.lanes.length ?? 0} active</span></div>
                <div className="lanes">
                  {data?.lanes.map((lane: any) => {
                    const pct = Math.round((lane.currentLoad / lane.capacity) * 100)
                    return <article key={lane._id}><div><b>{lane.code}</b><span>{lane.name}</span></div><strong>{lane.currentLoad}<small> / {lane.capacity}</small></strong><div className="meter"><i style={{ width: `${Math.max(2,pct)}%` }} /></div><small>ZIP prefix {lane.destinationPrefix} · {pct}% full</small></article>
                  })}
                </div>
              </div>
            </section>
            <section className="recent">
              <div className="panel-heading"><div><p className="eyebrow">Chain of custody</p><h2>Recent scans</h2></div><button className="ghost" onClick={newException}>Report exception</button></div>
              <div className="table-wrap"><table><thead><tr><th>Time</th><th>Tracking</th><th>Stage</th><th>Lane</th><th>U-Code</th></tr></thead><tbody>
                {data?.scans.slice(0,8).map((scan:any) => <tr key={scan._id}><td>{new Date(scan.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</td><td><b>{scan.trackingNumber}</b></td><td><span className="pill">{scan.stage}</span></td><td>{scan.laneCode ?? '—'}</td><td>{scan.uCode}</td></tr>)}
                {data?.scans.length === 0 && <tr><td colSpan={5} className="empty">Scan the first package to begin processing.</td></tr>}
              </tbody></table></div>
            </section>
          </>
        )}

        {view === 'control' && <section className="view-stack">
          <div className="metrics"><Metric label="Scans recorded" value={stats.processed} hint="Live audit events" /><Metric label="In sort lanes" value={stats.inSort} hint="Awaiting dispatch" /><Metric label="Dispatched" value={stats.dispatched} hint="Released to transport" /><Metric label="Open exceptions" value={openExceptions.length} hint="Needs attention" alert={openExceptions.length > 0} /></div>
          <div className="card"><div className="panel-heading"><div><p className="eyebrow">Network operations</p><h2>Facility status</h2></div></div>{data?.facilities.map((f:any)=><div className="facility-row" key={f._id}><span className="facility-code">{f.code}</span><div><b>{f.name}</b><small>{f.city}</small></div><span className="online">Operational</span></div>)}</div>
        </section>}

        {view === 'manifests' && <section className="card view-card"><div className="panel-heading"><div><p className="eyebrow">Dispatch control</p><h2>Transfer & route manifests</h2></div><button className="primary compact" onClick={newManifest}>New manifest</button></div>
          <div className="manifest-list">{data?.manifests.map((m:any)=><article key={m._id}><span className="manifest-icon">M</span><div><b>{m.manifestNumber}</b><small>{m.originFacility} → {m.destination}</small></div><span className="pill">{m.status}</span><div className="actions">{m.status==='open'&&<button onClick={()=>updateManifest({manifestNumber:m.manifestNumber,action:'close'})}>Close</button>}{m.status==='closed'&&<button onClick={()=>updateManifest({manifestNumber:m.manifestNumber,action:'depart'})}>Depart</button>}{m.status==='in_transit'&&<button onClick={()=>updateManifest({manifestNumber:m.manifestNumber,action:'receive'})}>Receive</button>}</div></article>)}{data?.manifests.length===0&&<p className="empty">No manifests yet.</p>}</div>
        </section>}

        {view === 'exceptions' && <section className="card view-card"><div className="panel-heading"><div><p className="eyebrow">Resolution queue</p><h2>Package exceptions</h2></div><button className="primary compact" onClick={newException}>Report issue</button></div>
          <div className="exception-list">{data?.exceptions.map((item:any)=><article key={item._id}><span className="exception-mark">!</span><div><b>{item.trackingNumber}</b><small>{item.description}</small></div><span className="pill">{item.severity}</span><span>{item.status}</span>{item.status==='open'&&isAdmin&&<button onClick={()=>resolveException({id:item._id as Id<'exceptions'>})}>Resolve</button>}</article>)}{data?.exceptions.length===0&&<p className="empty">No processing exceptions.</p>}</div>
        </section>}

        {view === 'admin' && <section className="card view-card"><div className="panel-heading"><div><p className="eyebrow">Access control</p><h2>Administration</h2></div></div>
          {isAdmin ? <>
            <h3>Who can use MERCURY</h3>
            <p className="empty">Only people on this list can sign in. Staff can scan, dispatch and report issues. Administrators can also manage facilities, lanes, people and resolve exceptions.</p>
            <StaffPanel />
            <h3>Facilities and lanes</h3>
            <div className="actions"><button className="primary compact" onClick={() => addFacility().catch((e: any) => setMessage(e.message))}>Add facility</button><button className="primary compact" onClick={() => addLane().catch((e: any) => setMessage(e.message))}>Add lane to {facility}</button></div>
            <p className="empty">{message}</p>
          </> : <p className="empty">Only MERCURY administrators can open this page.</p>}
        </section>}

        {view === 'history' && <section className="card view-card"><div className="panel-heading"><div><p className="eyebrow">Traceability</p><h2>Package scan history</h2></div></div>
          <div className="history-search"><input className="field" value={historyQuery} onChange={e=>setHistoryQuery(e.target.value)} placeholder="Enter tracking number" /></div>
          <div className="timeline">{history?.map((scan:any)=><article key={scan._id}><i /><div><b>{stageLabels[scan.stage as Stage] ?? scan.stage}</b><span>{scan.facilityCode}{scan.laneCode ? ` · Lane ${scan.laneCode}`:''}</span><small>{new Date(scan.timestamp).toLocaleString()} · {scan.uCode}</small></div></article>)}{historyQuery&&history?.length===0&&<p className="empty">No scans found for this package.</p>}</div>
        </section>}
      </section>
    </main>
  )
}

function Metric({label,value,hint,alert=false}:{label:string,value:number,hint:string,alert?:boolean}) {
  return <article className={alert?'metric metric-alert':'metric'}><p>{label}</p><strong>{value}</strong><span>{hint}</span></article>
}
