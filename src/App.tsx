import { useCallback, useEffect, useMemo, useState } from 'react'
import { configured, supabase } from './supabase'
import type { Movimiento, Persona, Producto } from './types'

type Tab = 'inicio' | 'falta' | 'historial'
const CATEGORIAS_BASE = ['Mercado', 'Aseo personal', 'Aseo']
const PRESENTACIONES_BASE = ['Bolsa', 'Caja', 'Botella', 'Lata', 'Frasco', 'Tarro', 'Tubo', 'Paquete', 'Unidad']
const UNIDADES = ['g', 'kg', 'ml', 'L', 'und']
const OTRA = '__otra__'
type Opciones = { categorias: string[]; ubicaciones: string[]; presentaciones: string[] }
const unicos = (xs: string[]) => [...new Set(xs.filter(Boolean))]
// Si ya existe una categoría igual (sin importar mayúsculas), usa esa escritura para no duplicar
const canonico = (v: string, lista: string[]) => {
  const t = v.trim()
  return lista.find((x) => x.toLowerCase() === t.toLowerCase()) ?? t
}
const PERSONA_KEY = 'despensa.persona_id'
const PIN_KEY = 'despensa.admin_pin'
// Contexto del modo admin: solo existe cuando Maki ya ingresó el PIN correcto
type Admin = { pin: string; personaId: string; opciones: Opciones; reload: () => Promise<void>; onError: (m: string) => void }

export default function App() {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [movs, setMovs] = useState<Movimiento[]>([])
  const [personaId, setPersonaId] = useState<string | null>(() => localStorage.getItem(PERSONA_KEY))
  const [tab, setTab] = useState<Tab>('inicio')
  const [categoria, setCategoria] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pin, setPin] = useState<string | null>(() => sessionStorage.getItem(PIN_KEY))
  const [pidePin, setPidePin] = useState(false)

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

  const opciones: Opciones = {
    categorias: unicos([...CATEGORIAS_BASE, ...productos.map((p) => p.categoria)]),
    ubicaciones: unicos(productos.map((p) => p.ubicacion)).sort((a, b) => a.localeCompare(b, 'es', { numeric: true })),
    presentaciones: unicos([...PRESENTACIONES_BASE, ...productos.map((p) => p.presentacion)]),
  }

  const esMaki = persona.nombre.trim().toLowerCase() === 'maki'
  const admin: Admin | null =
    esMaki && pin ? { pin, personaId: persona.id, opciones, reload: load, onError: setError } : null

  const salirAdmin = () => {
    sessionStorage.removeItem(PIN_KEY)
    setPin(null)
  }

  return (
    <div className="app">
      <header>
        <h1>Mercado 511</h1>
        <div className="hdr-right">
          {esMaki && !pin && <button className="who" onClick={() => setPidePin(!pidePin)}>🔒 Admin</button>}
          {admin && <button className="who admin-on" onClick={salirAdmin}>Admin ✓ salir</button>}
          <button
            className="who"
            onClick={() => {
              localStorage.removeItem(PERSONA_KEY)
              salirAdmin()
              setPersonaId(null)
            }}
          >
            {persona.nombre} ⇄
          </button>
        </div>
      </header>
      {error && <div className="error" onClick={() => setError(null)}>{error}</div>}
      {esMaki && !pin && pidePin && (
        <div className="padded">
          <PinCard
            onOk={(v) => { sessionStorage.setItem(PIN_KEY, v); setPin(v); setPidePin(false); setError(null) }}
            onError={setError}
            onClose={() => setPidePin(false)}
          />
        </div>
      )}
      <main>
        {tab === 'inicio' && categoria === null && <Categorias productos={productos} onPick={setCategoria} onMove={registrar} admin={admin} />}
        {tab === 'inicio' && categoria !== null && (
          <Despensa
            admin={admin}
            categoria={categoria}
            opciones={opciones}
            productos={productos.filter((p) => p.categoria === categoria)}
            onBack={() => setCategoria(null)}
            onMove={registrar}
            reload={load}
            onError={setError}
          />
        )}
        {tab === 'falta' && <Falta productos={productos} />}
        {tab === 'historial' && <Historial movs={movs} productos={productos} personas={personas} admin={admin} />}
      </main>
      <nav>
        {(['inicio', 'falta', 'historial'] as Tab[]).map((t) => (
          <button
            key={t}
            className={tab === t ? 'on' : ''}
            onClick={() => {
              if (t === 'inicio') setCategoria(null)
              setTab(t)
            }}
          >
            {t === 'inicio' ? 'Inicio' : t === 'falta' ? `Falta (${productos.filter(bajo).length})` : 'Historial'}
          </button>
        ))}
      </nav>
    </div>
  )
}

const bajo = (p: Producto) => p.stock <= p.stock_minimo
const nombreCompleto = (p: Pick<Producto, 'nombre' | 'marca'>) => (p.marca ? `${p.nombre} · ${p.marca}` : p.nombre)
const fmt = (n: number) => new Intl.NumberFormat('es-CO').format(n)

function PinCard(props: { onOk: (pin: string) => void; onError: (m: string) => void; onClose: () => void }) {
  const [v, setV] = useState('')
  const entrar = async () => {
    if (!v) return
    const { data, error } = await supabase.rpc('admin_check', { p_pin: v })
    if (error) return props.onError(error.message)
    if (!data) return props.onError('PIN incorrecto')
    props.onOk(v)
  }
  return (
    <div className="card col">
      <strong>Modo admin</strong>
      <div className="row">
        <input type="password" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void entrar()} placeholder="PIN de administrador" />
        <button className="primary" onClick={() => void entrar()}>Entrar</button>
        <button onClick={props.onClose}>×</button>
      </div>
    </div>
  )
}

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

function Categorias(props: {
  productos: Producto[]
  onPick: (c: string) => void
  onMove: (p: Producto, cantidad: number, tipo: Movimiento['tipo']) => Promise<void>
  admin: Admin | null
}) {
  const { productos } = props
  const [nueva, setNueva] = useState('')
  const [q, setQ] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const nombres = unicos([...CATEGORIAS_BASE, ...productos.map((p) => p.categoria)])
  const f = q.trim().toLowerCase()
  const resultados = f
    ? productos.filter((p) => `${p.nombre} ${p.marca} ${p.categoria} ${p.ubicacion}`.toLowerCase().includes(f))
    : []
  const paquetes = productos.reduce((s, p) => s + p.stock, 0)
  const porReponer = productos.filter(bajo).length

  return (
    <>
      <div className="kpis">
        <div><strong>{productos.length}</strong><span className="muted">productos</span></div>
        <div><strong>{paquetes}</strong><span className="muted">paquetes</span></div>
        <div className={porReponer > 0 ? 'warn' : ''}><strong>{porReponer}</strong><span className="muted">por reponer</span></div>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar un producto en toda la casa…" />
      {f ? (
        <section>
          <h2>Resultados</h2>
          {resultados.length === 0 && <p className="muted">Nada coincide con “{q}”.</p>}
          {resultados.map((p) => (
            <ProductoRow key={p.id} p={p} abierto={abierto === p.id} toggle={() => setAbierto(abierto === p.id ? null : p.id)} onMove={props.onMove} admin={props.admin} />
          ))}
        </section>
      ) : (
        <>
          <h2>¿De qué categoría vas a sacar?</h2>
          <div className="tiles">
            {nombres.map((c) => {
              const items = productos.filter((p) => p.categoria === c)
              const bajos = items.filter(bajo).length
              return (
                <button key={c} className="tile" onClick={() => props.onPick(c)}>
                  <strong>{c}</strong>
                  <span className="muted">{items.length} {items.length === 1 ? 'producto' : 'productos'}</span>
                  {bajos > 0 && <span className="badge">{bajos} por reponer</span>}
                </button>
              )
            })}
          </div>
          <h2>Otra categoría</h2>
          <div className="row">
            <input value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Nombre (ej. Mascotas)" />
            <button className="primary" onClick={() => nueva.trim() && props.onPick(canonico(nueva, nombres))}>Crear</button>
          </div>
        </>
      )}
    </>
  )
}

function Combo(props: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const [otra, setOtra] = useState(false)
  const opts = unicos([...props.options, ...(props.value && !otra ? [props.value] : [])])
  return (
    <label>
      {props.label}
      <select
        value={otra ? OTRA : props.value}
        onChange={(e) => {
          if (e.target.value === OTRA) {
            setOtra(true)
            props.onChange('')
          } else {
            setOtra(false)
            props.onChange(e.target.value)
          }
        }}
      >
        {!otra && props.value === '' && <option value="" disabled>Elegir…</option>}
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value={OTRA}>+ Otra…</option>
      </select>
      {otra && (
        <input autoFocus value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={`Escribe la nueva (${props.label.toLowerCase()})`} />
      )}
    </label>
  )
}

function Despensa(props: {
  admin: Admin | null
  categoria: string
  opciones: Opciones
  onBack: () => void
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
    for (const p of list) map.set(p.ubicacion, [...(map.get(p.ubicacion) ?? []), p])
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [props.productos, q, ubi])

  return (
    <>
      <div className="crumb">
        <button onClick={props.onBack}>← Categorías</button>
        <strong>{props.categoria}</strong>
      </div>
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
          opciones={props.opciones}
          categoriaInicial={props.categoria}
          onDone={() => { setNuevo(false); void props.reload() }}
          onError={props.onError}
        />
      )}
      {props.productos.length === 0 && <p className="muted">Aún no hay productos. Agrega el primero con “+ Nuevo”.</p>}
      {grupos.map(([cat, items]) => (
        <section key={cat}>
          <h2>{cat}</h2>
          {items.map((p) => (
            <ProductoRow key={p.id} p={p} abierto={abierto === p.id} toggle={() => setAbierto(abierto === p.id ? null : p.id)} onMove={props.onMove} admin={props.admin} />
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
  admin: Admin | null
}) {
  const { p, admin } = props
  const [n, setN] = useState(1)
  const [editando, setEditando] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const estado = p.stock <= 0 ? 'agotado' : bajo(p) ? 'bajo' : ''

  const eliminar = async () => {
    if (!admin) return
    const { error } = await supabase.rpc('admin_eliminar_producto', { p_pin: admin.pin, p_id: p.id })
    if (error) return admin.onError(error.message)
    void admin.reload()
  }

  return (
    <div className={`item ${estado}`}>
      <div className="line">
        <div className="info" onClick={props.toggle}>
          <strong>{nombreCompleto(p)}</strong>
          <span className="muted">
            {p.stock} {p.presentacion.toLowerCase()}{p.stock === 1 ? '' : 's'} de {fmt(p.contenido_por_paquete)} {p.unidad_contenido}
            {' '}· total {fmt(p.contenido_total)} {p.unidad_contenido}
          </span>
          <span className="muted">{p.categoria} · {p.ubicacion} · mín. {p.stock_minimo}</span>
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
      {props.abierto && admin && (
        <div className="admin-row">
          <button onClick={() => setEditando(!editando)}>{editando ? 'Cerrar edición' : 'Editar producto'}</button>
          {confirmar ? (
            <>
              <button className="danger" onClick={() => void eliminar()}>Sí, eliminar</button>
              <button onClick={() => setConfirmar(false)}>No</button>
            </>
          ) : (
            <button onClick={() => setConfirmar(true)}>Eliminar producto</button>
          )}
        </div>
      )}
      {props.abierto && admin && editando && (
        <NuevoProducto
          editar={p}
          admin={admin}
          opciones={admin.opciones}
          categoriaInicial={p.categoria}
          onDone={() => { setEditando(false); void admin.reload() }}
          onError={admin.onError}
        />
      )}
    </div>
  )
}

function NuevoProducto(props: {
  opciones: Opciones
  categoriaInicial: string
  onDone: () => void
  onError: (m: string) => void
  editar?: Producto
  admin?: Admin | null
}) {
  const ed = props.editar
  const [nombre, setNombre] = useState(ed?.nombre ?? '')
  const [marca, setMarca] = useState(ed?.marca ?? '')
  const [ubicacion, setUbicacion] = useState(ed?.ubicacion ?? '')
  const [categoria, setCategoria] = useState(ed?.categoria ?? props.categoriaInicial)
  const [presentacion, setPresentacion] = useState(ed?.presentacion ?? 'Bolsa')
  const [contenido, setContenido] = useState(ed?.contenido_por_paquete ?? 500)
  const [unidad, setUnidad] = useState(ed?.unidad_contenido ?? 'g')
  const [minimo, setMinimo] = useState(ed?.stock_minimo ?? 0)
  const [inicial, setInicial] = useState(ed?.stock ?? 1)

  const guardar = async () => {
    if (!nombre.trim() || contenido <= 0) return props.onError('Escribe el nombre del producto y un contenido mayor a 0')
    if (!ubicacion.trim() || !categoria.trim()) return props.onError('Elige la categoría y la ubicación')
    const campos = {
      nombre: nombre.trim(),
      marca: marca.trim(),
      ubicacion: ubicacion.trim() || 'Sin ubicación',
      categoria: canonico(categoria, props.opciones.categorias) || 'Mercado',
      presentacion: presentacion.trim() || 'Bolsa',
      contenido_por_paquete: contenido,
      unidad_contenido: unidad.trim() || 'g',
      stock_minimo: minimo,
    }

    if (ed && props.admin) {
      const { error } = await supabase.rpc('admin_editar_producto', {
        p_pin: props.admin.pin,
        p_id: ed.id,
        p_nombre: campos.nombre,
        p_marca: campos.marca,
        p_ubicacion: campos.ubicacion,
        p_categoria: campos.categoria,
        p_presentacion: campos.presentacion,
        p_contenido: campos.contenido_por_paquete,
        p_unidad: campos.unidad_contenido,
        p_minimo: campos.stock_minimo,
      })
      if (error) return props.onError(error.message)
      const delta = inicial - ed.stock
      if (delta !== 0) {
        const { error: e2 } = await supabase
          .from('movimientos')
          .insert({ producto_id: ed.id, persona_id: props.admin.personaId, cantidad: delta, tipo: 'ajuste' })
        if (e2) return props.onError(e2.message)
      }
      return props.onDone()
    }

    const { data, error } = await supabase.from('productos').insert(campos).select('id').single()
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
        <Combo label="Categoría" value={categoria} options={props.opciones.categorias} onChange={setCategoria} />
        <Combo label="Ubicación" value={ubicacion} options={props.opciones.ubicaciones} onChange={setUbicacion} />
      </div>
      <div className="row">
        <Combo label="Presentación" value={presentacion} options={props.opciones.presentaciones} onChange={setPresentacion} />
        <label>Contenido<input type="number" min={1} value={contenido} onChange={(e) => setContenido(Number(e.target.value))} /></label>
        <Combo label="Unidad" value={unidad} options={UNIDADES} onChange={setUnidad} />
      </div>
      <div className="row">
        <label>{ed ? 'Paquetes reales hoy' : 'Paquetes hoy'}<input type="number" min={0} value={inicial} onChange={(e) => setInicial(Number(e.target.value))} /></label>
        <label>Mínimo<input type="number" min={0} value={minimo} onChange={(e) => setMinimo(Number(e.target.value))} /></label>
      </div>
      <button className="primary" onClick={() => void guardar()}>{ed ? 'Guardar cambios' : 'Guardar producto'}</button>
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
              <span className="muted">{p.categoria} · {p.ubicacion} · hay {p.stock}, mín. {p.stock_minimo}</span>
            </div>
            <span className="badge">Comprar {Math.max(p.stock_minimo + 1 - p.stock, 1)}</span>
          </div>
        </div>
      ))}
    </>
  )
}

const TIPOS: { id: Movimiento['tipo']; label: string }[] = [
  { id: 'salida', label: 'Salidas' },
  { id: 'compra', label: 'Compras' },
  { id: 'ajuste', label: 'Ajustes' },
]

function Historial({ movs, productos, personas, admin }: { movs: Movimiento[]; productos: Producto[]; personas: Persona[]; admin: Admin | null }) {
  const [quien, setQuien] = useState<string | null>(null) // id de persona, o 'sin' = sin persona
  const [tipo, setTipo] = useState<Movimiento['tipo'] | null>(null)

  const prod = (id: string) => {
    const p = productos.find((x) => x.id === id)
    return p ? nombreCompleto(p) : '(eliminado)'
  }
  const pers = (id: string | null) => personas.find((p) => p.id === id)?.nombre ?? 'Carga inicial'
  const haySinPersona = movs.some((m) => m.persona_id === null)

  const filtrados = useMemo(
    () =>
      movs.filter(
        (m) =>
          (quien === null || (quien === 'sin' ? m.persona_id === null : m.persona_id === quien)) &&
          (tipo === null || m.tipo === tipo),
      ),
    [movs, quien, tipo],
  )

  const resumen = useMemo(() => {
    const desde = Date.now() - 30 * 24 * 3600 * 1000
    const salidas = filtrados.filter((m) => m.tipo === 'salida' && new Date(m.created_at).getTime() >= desde)
    const porProd = new Map<string, number>()
    const porPersona = new Map<string, number>()
    for (const m of salidas) {
      porProd.set(m.producto_id, (porProd.get(m.producto_id) ?? 0) + -m.cantidad)
      const k = m.persona_id ?? '—'
      porPersona.set(k, (porPersona.get(k) ?? 0) + -m.cantidad)
    }
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    const salieron = filtrados.filter((m) => m.cantidad < 0).reduce((s, m) => s - m.cantidad, 0)
    const entraron = filtrados.filter((m) => m.cantidad > 0).reduce((s, m) => s + m.cantidad, 0)
    return { prod: top(porProd), persona: top(porPersona), salieron, entraron }
  }, [filtrados])

  return (
    <>
      <h2>Filtrar</h2>
      <div className="filters">
        <button className={quien === null ? 'on' : ''} onClick={() => setQuien(null)}>Todos</button>
        {personas.map((p) => (
          <button key={p.id} className={quien === p.id ? 'on' : ''} onClick={() => setQuien(quien === p.id ? null : p.id)}>{p.nombre}</button>
        ))}
        {haySinPersona && (
          <button className={quien === 'sin' ? 'on' : ''} onClick={() => setQuien(quien === 'sin' ? null : 'sin')}>Carga inicial</button>
        )}
      </div>
      <div className="filters">
        <button className={tipo === null ? 'on' : ''} onClick={() => setTipo(null)}>Todo tipo</button>
        {TIPOS.map((t) => (
          <button key={t.id} className={tipo === t.id ? 'on' : ''} onClick={() => setTipo(tipo === t.id ? null : t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="kpis">
        <div><strong>{filtrados.length}</strong><span className="muted">movimientos</span></div>
        <div><strong>{resumen.salieron}</strong><span className="muted">paquetes salieron</span></div>
        <div><strong>{resumen.entraron}</strong><span className="muted">paquetes entraron</span></div>
      </div>

      <section>
        <h2>Más consumidos (30 días)</h2>
        {resumen.prod.length === 0 && <p className="muted">Sin salidas en este filtro.</p>}
        {resumen.prod.map(([id, n]) => <div className="stat" key={id}><span>{prod(id)}</span><strong>{n}</strong></div>)}
      </section>
      {quien === null && (
        <section>
          <h2>Quién saca más (30 días)</h2>
          {resumen.persona.map(([id, n]) => <div className="stat" key={id}><span>{pers(id === '—' ? null : id)}</span><strong>{n}</strong></div>)}
        </section>
      )}
      <section>
        <h2>Movimientos{filtrados.length > 100 ? ' (últimos 100)' : ''}</h2>
        {filtrados.length === 0 && <p className="muted">No hay movimientos con ese filtro.</p>}
        {filtrados.slice(0, 100).map((m) => (
          <MovRow key={m.id} m={m} producto={prod(m.producto_id)} persona={pers(m.persona_id)} admin={admin} />
        ))}
      </section>
    </>
  )
}

function MovRow(props: { m: Movimiento; producto: string; persona: string; admin: Admin | null }) {
  const { m, admin } = props
  const [edit, setEdit] = useState(false)
  const [valor, setValor] = useState(Math.abs(m.cantidad))
  const [confirmar, setConfirmar] = useState(false)

  const guardar = async () => {
    if (!admin || valor <= 0) return
    const nueva = (m.cantidad < 0 ? -1 : 1) * valor
    const { error } = await supabase.rpc('admin_editar_movimiento', { p_pin: admin.pin, p_id: m.id, p_cantidad: nueva })
    if (error) return admin.onError(error.message)
    setEdit(false)
    void admin.reload()
  }
  const borrar = async () => {
    if (!admin) return
    const { error } = await supabase.rpc('admin_borrar_movimiento', { p_pin: admin.pin, p_id: m.id })
    if (error) return admin.onError(error.message)
    void admin.reload()
  }

  return (
    <div className="mov">
      <div className="stat">
        <span>
          <strong className={m.cantidad < 0 ? 'neg' : 'pos'}>{m.cantidad > 0 ? '+' : ''}{m.cantidad}</strong> {props.producto}
          <span className="muted"> · {props.persona}</span>
        </span>
        <span className="muted">{new Date(m.created_at).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      {admin && (
        <div className="admin-row">
          {edit ? (
            <>
              <input type="number" min={1} value={valor} onChange={(e) => setValor(Number(e.target.value))} />
              <button className="primary" onClick={() => void guardar()}>Guardar</button>
              <button onClick={() => setEdit(false)}>Cancelar</button>
            </>
          ) : confirmar ? (
            <>
              <span className="muted">¿Eliminar este movimiento?</span>
              <button className="danger" onClick={() => void borrar()}>Sí, eliminar</button>
              <button onClick={() => setConfirmar(false)}>No</button>
            </>
          ) : (
            <>
              <button onClick={() => setEdit(true)}>Editar cantidad</button>
              <button onClick={() => setConfirmar(true)}>Eliminar</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
