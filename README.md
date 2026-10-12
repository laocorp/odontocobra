# OdontoCuenta

Plataforma web de cobros odontológicos basada en USD, con gestión de pacientes, tratamientos facturables, planes de pago, abonos y recibos.

## Desarrollo local

Requisitos: Node.js 22.12 o superior dentro de la rama 22.x, pnpm 11 y Docker Desktop (para Supabase local). El campo `engines.node` del `package.json` raíz fija Node 22 para Nixpacks/Dokploy, que de otro modo puede elegir Node 18 por defecto.

1. Copia `.env.example` a `.env.local` y configura un proyecto Supabase de desarrollo.
2. `pnpm install`
3. `pnpm dev`

Para usar Supabase local: inicia Docker Desktop, ejecuta `pnpm supabase:start`, copia el API URL y la publishable/anon key que muestra el CLI a `.env.local`, luego `pnpm db:reset`.

Para conectar Supabase Cloud, pon la URL y la clave publicable del proyecto elegido en `.env.local`. Antes de desplegar las migraciones, confirma que ese proyecto está dedicado a OdontoCuenta y usa `pnpm exec supabase link --project-ref <project-ref>` seguido de `pnpm db:push`. El repo no está enlazado a ningún proyecto cloud. No reutilices los proyectos de otras apps.

No se conectó ni modificó ningún proyecto cloud existente. La aplicación usa solamente la URL y la clave publicable del proyecto que se configure. Nunca uses `service_role` en el navegador.

## Estructura

- `apps/web`: aplicación React responsive.
- `packages/domain`: reglas monetarias y de pagos compartidas.
- `supabase/migrations`: esquema y políticas RLS versionadas.

Los datos de demostración usan pacientes ficticios y viven en memoria en el navegador. Con Supabase configurado, la app pide iniciar sesión y carga los datos del consultorio asociado al usuario. La primera cuenta crea la clínica y queda como propietaria. Los montos de planes y cuotas se guardan en centavos USD; la última cuota absorbe el residuo. Los pagos se asignan a cuotas y conservan un número de recibo y una copia inmutable de sus datos. La aplicación almacena datos de contacto y cobro, no historias clínicas.

Para crear el esquema en el proyecto cloud, enlaza Supabase CLI al `project-ref` y ejecuta `pnpm exec supabase db push`. Esto aplica las migraciones locales pendientes, incluida la tabla `clinic_members`; la conexión del navegador en `.env` por sí sola no crea tablas ni aplica migraciones.

## Despliegue en Dokploy

La web es una SPA de Vite y usa Supabase Cloud para autenticación y datos. En Dokploy crea una **Application** conectada a este repositorio y configura:

- Build type: **Nixpacks**.
- Build path: raíz del repositorio (`/`).
- Build command: `pnpm build`.
- Publish directory: `apps/web/dist`.
- Habilita el fallback de SPA para que las rutas de React Router abran directamente.
- Dominio: puerto de contenedor `80`; activa HTTPS en Dokploy.

Define estas variables en la aplicación de Dokploy antes del build, porque Vite las inserta en los archivos estáticos:

| Variable | Valor |
| --- | --- |
| `VITE_SUPABASE_URL` | URL del proyecto Supabase de OdontoCuenta, por ejemplo `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clave publicable (`sb_publishable_...`) de ese mismo proyecto |

Son valores públicos para el navegador. **No** agregues `SUPABASE_SERVICE_ROLE_KEY`, claves `secret`, ni credenciales de base de datos a Dokploy para esta SPA. Las funciones de Supabase reciben sus secretos de Supabase, no del contenedor web.

Antes de abrir la app en producción, en el proyecto de Supabase dedicado a OdontoCuenta:

1. Aplica las migraciones con `pnpm exec supabase link --project-ref <project-ref>` y `pnpm db:push`.
2. Despliega `bcv-rate` e `invite-clinic-member` con `pnpm exec supabase functions deploy bcv-rate` y `pnpm exec supabase functions deploy invite-clinic-member`.
3. En **Authentication → URL Configuration**, configura el dominio de producción como **Site URL** y agrégalo a **Redirect URLs**.
4. Verifica el inicio de sesión, registro, invitaciones, registro de pagos y carga de la tasa antes de usar la app.

Al hacer push a la rama configurada en Dokploy, conecta el despliegue automático por webhook o vuelve a desplegar desde la aplicación. La URL y la clave `VITE_` deben existir en el entorno de build para que una nueva compilación las incorpore. No reutilices un proyecto Supabase de otra aplicación.

## Tasa BCV

La función `supabase/functions/bcv-rate` consulta el JSON público de [DolarVZLA](https://www.dolarvzla.com/settings/api), que publica la tasa oficial del [BCV](https://www.bcv.org.ve/). Valida el formato, el valor y la fecha de la tasa antes de guardarla; no consulta el proveedor desde el navegador. La función también verifica la sesión y la membresía del consultorio, y registra el historial y la auditoría. Un pago en VES solo se habilita con una tasa BCV vigente o una tasa manual para ese día. La carga manual requiere rol owner, motivo y auditoría. Si DolarVZLA no responde o la fecha de la tasa no aplica, se puede cobrar en USD y la conversión en VES queda bloqueada.

La persona propietaria administra invitaciones y revocaciones de asistentes desde **Configuración → Equipo y permisos**. `supabase/functions/invite-clinic-member` valida la sesión y el rol antes de usar la clave de servicio; configura un proveedor de correo en Supabase Auth para que los enlaces de invitación lleguen a sus destinatarios.

Después de aplicar las migraciones, despliega las funciones en el proyecto enlazado con `pnpm exec supabase functions deploy bcv-rate` y `pnpm exec supabase functions deploy invite-clinic-member`. Supabase proporciona las claves de servidor a las funciones; no copies una clave `service_role` o `secret` a la configuración pública de la web.

## Interfaz y temas

La interfaz usa la identidad visual de la odontóloga: oro claro, crema, taupe y carbón. Los temas claro y oscuro se definen principalmente en `apps/web/src/brand.css` y `apps/web/src/brand-theme.css`; al añadir componentes, reutiliza esos tokens y evita acentos verdes o verde azulado. Mantén las reglas de tema en esas hojas compartidas y no agregues una nueva capa de overrides inline a `App.tsx`. Los SVG deben heredar un color legible (`currentColor`) en ambos temas. Los controles de texto usan 14 px como mínimo en escritorio y 16 px en móvil. La revisión de pantallas vigente está en [AUDITORIA-UI-UX.md](AUDITORIA-UI-UX.md).

## Verificación de cambios de interfaz

Inicia `pnpm dev` y revisa la vista modificada en modo claro y oscuro, además de anchos móvil (375 px), tableta (768 px) y escritorio (1440 px). Comprueba contraste de texto e iconos, foco visible, nombres accesibles de los controles, ausencia de desbordamiento horizontal y consola del navegador. Abre los formularios afectados sin guardar cambios sobre datos reales. Los scripts raíz disponibles son `pnpm build`, `pnpm typecheck` y `pnpm test`; usa los que correspondan al cambio.
