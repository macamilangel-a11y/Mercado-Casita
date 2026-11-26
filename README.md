# Despensa

App para saber qué hay en la despensa de la casa. Cualquier persona entra con el link, elige su nombre y puede:

- Ver el stock de cada producto (resaltado cuando está bajo o agotado).
- Registrar con un toque cuando saca un paquete (**Saqué 1**) o con cantidad exacta.
- Registrar cuando llega el mercado (**Compré N**).
- Ver la lista de lo que falta por comprar y quién consume qué.

Todo se sincroniza en tiempo real entre los celulares.

## Puesta en marcha

### 1. Base de datos (Supabase)
1. Crea un proyecto nuevo en supabase.com.
2. En **SQL Editor**, pega y ejecuta `supabase/schema.sql`.
3. En otra consulta, pega y ejecuta `supabase/seed.sql`: carga los 21 productos de tu hoja `Mercado_511_2026.xlsx` con su ubicación, marca y cantidad actual (se asumió contenido en gramos).
4. En **Project Settings → API** copia la *Project URL* y la clave *anon public*.

### 2. Local
```bash
cp .env.example .env   # pega URL y anon key
npm install
npm run dev
```

### 3. Publicar (Vercel)
1. Sube esta carpeta a un repositorio nuevo en GitHub.
2. En Vercel: *Add New → Project* y elige ese repo.
3. En *Environment Variables* agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
4. Deploy. Comparte el link con la casa.

### 4. Instalar en el celular
- **iPhone:** abre el link en Safari → Compartir → *Agregar a pantalla de inicio*.
- **Android:** Chrome → menú → *Instalar app*.

## Cómo funciona
El stock no se guarda como un número suelto: cada entrada o salida es un registro en `movimientos` y el stock es la suma (vista `stock_actual`). Por eso hay historial de quién sacó qué y cuándo, y se puede calcular el consumo.

## Seguridad
No hay login: quien tenga el link puede leer y escribir (las políticas RLS están abiertas a propósito para que toda la casa entre sin fricción). Para una despensa es un riesgo bajo; no compartas el link fuera de la casa. Si luego quieres cerrarlo, se puede añadir un código de la casa o Supabase Auth.

## Ideas para después
Escaneo de código de barras, eliminar o editar productos, fechas de vencimiento, notificación cuando algo llega al mínimo.
