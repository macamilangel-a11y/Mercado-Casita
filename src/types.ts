export type Persona = { id: string; nombre: string }

export type Producto = {
  id: string
  ubicacion: string
  nombre: string
  marca: string
  presentacion: string
  contenido_por_paquete: number
  unidad_contenido: string
  categoria: string
  stock_minimo: number
  activo: boolean
  stock: number
  contenido_total: number
}

export type Movimiento = {
  id: string
  producto_id: string
  persona_id: string | null
  cantidad: number
  tipo: 'salida' | 'compra' | 'ajuste'
  created_at: string
}
