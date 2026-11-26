-- Despensa: esquema para Supabase (SQL Editor -> pegar y ejecutar completo)

create table if not exists personas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  created_at timestamptz not null default now()
);

-- Una fila = un producto concreto (producto + marca + tamaño de paquete),
-- igual que las filas de la hoja Mercado_511_2026.
create table if not exists productos (
  id uuid primary key default gen_random_uuid(),
  ubicacion text not null default 'Sin ubicación',   -- Caja 1, Caja 3...
  nombre text not null,                               -- Sal, Fideos, Café...
  marca text not null default '',
  presentacion text not null default 'Bolsa',         -- Bolsa, Caja, Lata...
  contenido_por_paquete numeric not null default 1 check (contenido_por_paquete > 0),
  unidad_contenido text not null default 'g',         -- g, ml, und
  categoria text not null default 'Despensa',
  stock_minimo int not null default 0 check (stock_minimo >= 0),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Cada entrada (+) o salida (-) es un movimiento; el stock (en paquetes) es la suma.
create table if not exists movimientos (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references productos(id) on delete cascade,
  persona_id uuid references personas(id) on delete set null,
  cantidad int not null check (cantidad <> 0),
  tipo text not null check (tipo in ('salida', 'compra', 'ajuste')),
  created_at timestamptz not null default now()
);

create index if not exists movimientos_producto_idx on movimientos (producto_id);
create index if not exists movimientos_fecha_idx on movimientos (created_at desc);

-- stock = paquetes disponibles; contenido_total = stock * contenido_por_paquete
create or replace view stock_actual
with (security_invoker = true) as
select p.id, p.ubicacion, p.nombre, p.marca, p.presentacion,
       p.contenido_por_paquete, p.unidad_contenido, p.categoria,
       p.stock_minimo, p.activo,
       coalesce(sum(m.cantidad), 0)::int as stock,
       coalesce(sum(m.cantidad), 0) * p.contenido_por_paquete as contenido_total
from productos p
left join movimientos m on m.producto_id = p.id
group by p.id;

-- Acceso: sin login, cualquiera con la URL y la anon key de tu proyecto puede leer/escribir.
-- Ver README (sección Seguridad) para endurecerlo.
alter table personas enable row level security;
alter table productos enable row level security;
alter table movimientos enable row level security;

create policy "casa personas" on personas for all to anon, authenticated using (true) with check (true);
create policy "casa productos" on productos for all to anon, authenticated using (true) with check (true);
create policy "casa movimientos" on movimientos for all to anon, authenticated using (true) with check (true);

-- Tiempo real: que todos vean los cambios al instante
alter publication supabase_realtime add table personas, productos, movimientos;
