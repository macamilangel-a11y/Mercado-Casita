import { useCallback, useEffect, useMemo, useState } from 'react'
import { configured, supabase } from './supabase'
import type { Movimiento, Persona, Producto } from './types'

type Tab = 'despensa' | 'falta' | 'historial'
const PERSONA_KEY = 'despensa.persona_id'

export default function App() {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [movs, setMovs] = useState<Movimiento[]>([])
  const [personaId, setPersonaId] = useState<string | null>(() => localStorage.getItem(PERSONA_KEY))
  const [tab, setTab] = useState<Tab>('despensa')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [p, s, m] = await Promise.all([
      supabase.from('personas').select('id,nombre').order('nombre'),
      supabase.from('stock_actual').select('*').eq('activo', true).order('nombre').order('marca'),
      supabase.from('movimientos').select('*').order('created_at', { ascending: false }).limit(500),
    ])
    const err = p.error ?? s.error ?? m.error
    if (err) setError(err.message)
    else setError(null)
    setPersonas((p.data as Persona[]) ?? [])
    setProductos((s.data as Producto[]) ?? [])
    setMovs((m.data as Movimiento[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!configured) return
    void load()
    const ch = supabase
      .channel('despensa')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => void load())
      .subscribe()
    return () => void supabase.removeChannel(ch)
  }, [load])

  const persona = personas.find((p) => p.id === personaId) ?? null

  const elegirPersona = (id: string) => {
    localStorage.setItem(PERSONA_KEY, id)
    setPersonaId(id)
  }

  const registrar = async (prod: Producto, cantidad: number, tipo: Movimiento['tipo']) => {
    if (!persona) return
    // actualización optimista para que se sienta inmediato
    setProductos((prev) =>
      prev.map((x) =>
        x.id === prod.id
          ? { ...x, stock: x.stock + cantidad, contenido_total: (x.stock + cantidad) * x.contenido_por_paquete }
          : x,
      ),
    )
    const { error: e } = await supabase
      .from('movimientos')
      .insert({ producto_id: prod.id, persona_id: persona.id, cantidad, tipo })
    if (e) setError(e.message)
    void load()
  }

  if (!configured) return <Setup />
  if (loading) return <div className="center">Cargando…</div>
  if (!persona) return <Picker personas={personas} onPick={elegirPersona} onError={setError} reload={load} error={error} />

  return (
    <div className="app">
      <header>
        <h1>Despensa</h1>
        <button className="who" onClick={() => { localStorage.removeItem(PERSONA_KEY); setPersonaId(null) }}>
          {persona.nombre} ⇄
        </button>
      </header>
      {error && <div className="error" onClick={() => setError(null)}>{error}</div>}
      <main>
        {tab === 'despensa' && <Despensa productos={productos} onMove={registrar} reload={load} onError={setError} />}
        {tab === 'falta' && <Falta productos={productos} />}
        {tab === 'historial' && <Historial movs={movs} productos={productos} personas={personas} />}
      </main>
      <nav>
        {(['despensa', 'falta', 'historial'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'despensa' ? 'Despensa' : t === 'falta' ? `Falta (${productos.filter(bajo).length})` : 'Historial'}
          </button>
        ))}
      </nav>
    </div>
  )
}

const bajo = (p: Producto) => p.stock <= p.stock_minimo
const nombreCompleto = (p: Pick<Producto, 'nombre' | 'marca'>) => (p.marca ? `${p.nombre} · ${p.marca}` : p.nombre)
const fmt = (n: number) => new Intl.NumberFormat('es-CO').format(n)

function Setup() {
  return (
    <div className="center col">
      <h1>Falta conectar Supabase</h1>
      <p>Crea un archivo <code>.env</code> con <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> (ver README).</p>
    </div>
  )
}

function Picker(props: {
  personas: Persona[]
  onPick: (id: string) => void
  onError: (m: string) => void
  reload: () => Promise<void>
  error: string | null
}) {
  const [nombre, setNombre] = useState('')
  const crear = async () => {
    const n = nombre.trim()
    if (!n) return
    const { data, error } = await supabase.from('personas').insert({ nombre: n }).select('id').single()
    if (error) return props.onError(error.message)
    await props.reload()
    props.onPick(data.id)
  }
  return (
    <div className="center col">
      <h1>¿Quién eres?</h1>
      {props.error && <div className="error">{props.error}</div>}
      <div className="chips">
        {props.personas.map((p) => (
          <button key={p.id} className="chip" onClick={() => props.onPick(p.id)}>{p.nombre}</button>
        ))}
      </div>
      <div className="row">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre" />
        <button className="primary" onClick={crear}>Agregar</button>
      </div>
    </div>
  )
}

function Despensa(props: {
  productos: Producto[]
  onMove: (p: Producto, cantidad: number, tipo: Movimiento['tipo']) => Promise<void>
  reload: () => Promise<void>
  onError: (m: string) => void
}) {
  const [q, setQ] = useState('')
  const [ubi, setUbi] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [nuevo, setNuevo] = useState(false)

  const ubicaciones = useMemo(
    () => [...new Set(props.productos.map((p) => p.ubicacion))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })),
    [props.productos],
  )

  const grupos = useMemo(() => {
    const f = q.trim().toLowerCase()
    const list = props.productos.filter(
      (p) =>
        (!ubi || p.ubicacion === ubi) &&
        (!f || `${p.nombre} ${p.marca} ${p.categoria} ${p.ubicacion}`.toLowerCase().includes(f)),
    )
    const map = new Map<string, Producto[]>()
    for (const p of list) map.set(p.categoria, [...(map.get(p.categoria) ?? []), p])
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [props.productos, q, ubi])

  return (
    <>
      <div className="row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto o marca…" />
        <button className="primary" onClick={() => setNuevo(!nuevo)}>{nuevo ? '×' : '+ Nuevo'}</button>
      </div>
      {ubicaciones.length > 1 && (
        <div className="filters">
          <button className={ubi === null ? 'on' : ''} onClick={() => setUbi(null)}>Todo</button>
          {ubicaciones.map((u) => (
            <button key={u} className={ubi === u ? 'on' : ''} onClick={() => setUbi(ubi === u ? null : u)}>{u}</button>
          ))}
        </div>
      )}
      {nuevo && (
        <NuevoProducto
          categorias={[...new Set(props.productos.map((p) => p.categoria))]}
          ubicaciones={ubicaciones}
          onDone={() => { setNuevo(false); void props.reload() }}
          onError={props.onError}
        />
      )}
      {props.productos.length === 0 && <p className="muted">Aún no hay productos. Agrega el primero con “+ Nuevo”.</p>}
      {grupos.map(([cat, items]) => (
        <section key={cat}>
          <h2>{cat}</h2>
          {items.map((p) => (
            <ProductoRow key={p.id} p={p} abierto={abierto === p.id} toggle={() => setAbierto(abierto === p.id ? null : p.id)} onMove={props.onMove} />
          ))}
        </section>
      ))}
    </>
  )
}

function ProductoRow(props: {
  p: Producto
  abierto: boolean
  toggle: () => void
  onMove: (p: Producto, cantidad: number, tipo: Movimiento['tipo']) => Promise<void>
}) {
  const { p } = props
  const [n, setN] = useState(1)
  const estado = p.stock <= 0 ? 'agotado' : bajo(p) ? 'bajo' : ''
  return (
    <div className={`item ${estado}`}>
      <div className="line">
        <div className="info" onClick={props.toggle}>
          <strong>{nombreCompleto(p)}</strong>
          <span className="muted">
            {p.stock} {p.presentacion.toLowerCase()}{p.stock === 1 ? '' : 's'} de {fmt(p.contenido_por_paquete)} {p.unidad_contenido}
            {' '}· total {fmt(p.contenido_total)} {p.unidad_contenido}
          </span>
          <span className="muted">{p.ubicacion} · mín. {p.stock_minimo}</span>
        </div>
        <button className="take" disabled={p.stock <= 0} onClick={() => void props.onMove(p, -1, 'salida')}>Saqué 1</button>
      </div>
      {props.abierto && (
        <div className="more">
          <div className="stepper">
            <button onClick={() => setN(Math.max(1, n - 1))}>−</button>
            <span>{n}</span>
            <button onClick={() => setN(n + 1)}>+</button>
          </div>
          <button onClick={() => { void props.onMove(p, -Math.min(n, Math.max(p.stock, 0)) || -1, 'salida'); props.toggle() }} disabled={p.stock <= 0}>Saqué {n}</button>
          <button className="primary" onClick={() => { void props.onMove(p, n, 'compra'); setN(1); props.toggle() }}>Compré {n}</button>
        </div>
      )}
    </div>
  )
}

function NuevoProducto(props: { categorias: string[]; ubicaciones: string[]; onDone: () => void; onError: (m: string) => void }) {
  const [nombre, setNombre] = useState('')
  const [marca, setMarca] = useState('')
  const [ubicacion, setUbicacion] = useState('')
  const [categoria, setCategoria] = useState('Despensa')
  const [presentacion, setPresentacion] = useState('Bolsa')
  const [contenido, setContenido] = useState(500)
  const [unidad, setUnidad] = useState('g')
  const [minimo, setMinimo] = useState(0)
  const [inicial, setInicial] = useState(1)

  const guardar = async () => {
    if (!nombre.trim() || contenido <= 0) return
    const { data, error } = await supabase
      .from('productos')
      .insert({
        nombre: nombre.trim(),
        marca: marca.trim(),
        ubicacion: ubicacion.trim() || 'Sin ubicación',
        categoria: categoria.trim() || 'Despensa',
        presentacion: presentacion.trim() || 'Bolsa',
        contenido_por_paquete: contenido,
        unidad_contenido: unidad.trim() || 'g',
        stock_minimo: minimo,
      })
      .select('id')
      .single()
    if (error) return props.onError(error.message)
    if (inicial > 0) {
      const { error: e2 } = await supabase.from('movimientos').insert({ producto_id: data.id, cantidad: inicial, tipo: 'ajuste' })
      if (e2) return props.onError(e2.message)
    }
    props.onDone()
  }

  return (
    <div className="card col">
      <div className="row">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Producto (ej. Arroz)" />
        <input value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Marca" />
      </div>
      <div className="row">
        <label>Ubicación<input list="ubis" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Caja 1" /></label>
        <label>Categoría<input list="cats" value={categoria} onChange={(e) => setCategoria(e.target.value)} /></label>
      </div>
      <datalist id="cats">{props.categorias.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="ubis">{props.ubicaciones.map((u) => <option key={u} value={u} />)}</datalist>
      <div className="row">
        <label>Presentación<input value={presentacion} onChange={(e) => setPresentacion(e.target.value)} /></label>
        <label>Contenido<input type="number" min={1} value={contenido} onChange={(e) => setContenido(Number(e.target.value))} /></label>
        <label>Unidad<input value={unidad} onChange={(e) => setUnidad(e.target.value)} /></label>
      </div>
      <div className="row">
        <label>Paquetes hoy<input type="number" min={0} value={inicial} onChange={(e) => setInicial(Number(e.target.value))} /></label>
        <label>Mínimo<input type="number" min={0} value={minimo} onChange={(e) => setMinimo(Number(e.target.value))} /></label>
      </div>
      <button className="primary" onClick={guardar}>Guardar producto</button>
    </div>
  )
}

function Falta({ productos }: { productos: Producto[] }) {
  const lista = productos.filter(bajo).sort((a, b) => a.stock - b.stock)
  if (lista.length === 0) return <p className="muted">Todo está por encima del mínimo. 🎉</p>
  return (
    <>
      <p className="muted">Productos en o bajo su mínimo. Sugerido = lo necesario para quedar con mínimo + 1.</p>
      {lista.map((p) => (
        <div key={p.id} className={`item ${p.stock <= 0 ? 'agotado' : 'bajo'}`}>
          <div className="line">
            <div className="info">
              <strong>{nombreCompleto(p)}</strong>
              <span className="muted">{p.ubicacion} · hay {p.stock}, mín. {p.stock_minimo}</span>
            </div>
            <span className="badge">Comprar {Math.max(p.stock_minimo + 1 - p.stock, 1)}</span>
          </div>
        </div>
      ))}
    </>
  )
}

function Historial({ movs, productos, personas }: { movs: Movimiento[]; productos: Producto[]; personas: Persona[] }) {
  const prod = (id: string) => {
    const p = productos.find((x) => x.id === id)
    return p ? nombreCompleto(p) : '(eliminado)'
  }
  const pers = (id: string | null) => personas.find((p) => p.id === id)?.nombre ?? '—'

  const resumen = useMemo(() => {
    const desde = Date.now() - 30 * 24 * 3600 * 1000
    const salidas = movs.filter((m) => m.tipo === 'salida' && new Date(m.created_at).getTime() >= desde)
    const porProd = new Map<string, number>()
    const porPersona = new Map<string, number>()
    for (const m of salidas) {
      porProd.set(m.producto_id, (porProd.get(m.producto_id) ?? 0) + -m.cantidad)
      const k = m.persona_id ?? '—'
      porPersona.set(k, (porPersona.get(k) ?? 0) + -m.cantidad)
    }
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    return { prod: top(porProd), persona: top(porPersona) }
  }, [movs])

  return (
    <>
      <section>
        <h2>Más consumidos (30 días)</h2>
        {resumen.prod.length === 0 && <p className="muted">Sin salidas registradas todavía.</p>}
        {resumen.prod.map(([id, n]) => <div className="stat" key={id}><span>{prod(id)}</span><strong>{n}</strong></div>)}
      </section>
      <section>
        <h2>Quién saca más (30 días)</h2>
        {resumen.persona.map(([id, n]) => <div className="stat" key={id}><span>{pers(id === '—' ? null : id)}</span><strong>{n}</strong></div>)}
      </section>
      <section>
        <h2>Últimos movimientos</h2>
        {movs.slice(0, 60).map((m) => (
          <div className="stat" key={m.id}>
            <span>
              <strong className={m.cantidad < 0 ? 'neg' : 'pos'}>{m.cantidad > 0 ? '+' : ''}{m.cantidad}</strong> {prod(m.producto_id)}
              <span className="muted"> · {pers(m.persona_id)}</span>
            </span>
            <span className="muted">{new Date(m.created_at).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
      </section>
    </>
  )
}
