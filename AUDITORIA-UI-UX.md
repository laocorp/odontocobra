# Auditoría de diseño y experiencia de OdontoCuenta

**Estado: revisión visual completada; build/typecheck pendientes · Fecha: 11 de octubre de 2026**

Se recorrieron las siete secciones principales en modo claro y oscuro, a 375, 768 y 1440 px; después del último ajuste se volvió a escanear cada ruta a 1440 px en ambos temas. Se abrieron formularios principales sin guardar cambios. Este documento separa lo observado en navegador de las comprobaciones que no se pudieron ejecutar desde el terminal.

## Evaluación actual

| Dimensión ECC | Puntaje provisional | Evidencia y trabajo pendiente |
| --- | ---: | --- |
| Coherencia de color | 8/10 | Después del último ajuste, el escaneo de las siete rutas en ambos temas no encontró tonos verdes visibles. Se corrigió una capa antigua de estilos oscuros en `App.tsx` que aún teñía el fondo de verde. Permanecen declaraciones heredadas ocultas por los tokens y la capa final; conviene centralizarlas en los estilos de marca. |
| Jerarquía tipográfica | 8/10 | Los controles de formulario se ajustaron a 14 px en escritorio y 16 px en móvil; metadatos y etiquetas pequeñas quedan en 12 px como mínimo en las vistas recorridas. Las iniciales de avatar quedan excluidas. |
| Ritmo de espaciado | 7/10 | Dashboard, tablas y formularios revisados en teléfono, tableta y escritorio sin desbordamiento horizontal. No se hizo una comparación pixel a pixel con una guía visual aprobada. |
| Consistencia de componentes | 7/10 | Se ajustaron reglas de SVG, iconos de perfil y formularios; aún conviven hojas base, de marca y reglas de componentes en App.tsx. |
| Adaptación de pantalla | 8/10 | Sin overflow a 375, 768 y 1440 px en las rutas recorridas. Se abrieron modales de paciente, plan, pago y servicio en móvil. |
| Modo claro y oscuro | 8/10 | Se verificaron las siete secciones en ambos temas; después del ajuste no se detectaron tonos verdes en la interfaz visible. El icono del perfil contrasta 5,18:1 en claro y 11,60:1 en oscuro. |
| Movimiento | 7/10 | La precarga contempla movimiento reducido; no se midieron todas las transiciones en esta pasada. |
| Accesibilidad | 9/10 | Lighthouse dio 100 en accesibilidad, buenas prácticas y SEO en instantánea del dashboard móvil. Se nombraron los controles que Chrome había marcado sin nombre; la consola quedó sin errores ni avisos tras corregir claves React. |
| Densidad de información | 8/10 | El dashboard prioriza saldo, acciones, vencimientos y movimientos; las tablas mantienen desplazamiento local en móvil sin ampliar la página. |
| Pulido y estados | 8/10 | Se revisaron perfil, alertas, formularios, precarga, navegación móvil y estados vacíos. No se guardaron cambios en los datos de la cuenta. |

## Hallazgos confirmados

### Colores residuales

El escaneo de las siete rutas en claro y oscuro no encontró acentos verdes visibles, incluidos los estados de éxito y las superficies revisadas. Se detectó que un bloque oscuro antiguo dentro de `App.tsx` seguía imponiendo un fondo verde carbón; se añadió una capa final cálida para el fondo, superficies, controles, estados, iconos y hover. Hay declaraciones históricas verde/teal todavía presentes en reglas heredadas de `App.tsx` y CSS base. No aparecen en las rutas y estados inspeccionados, pero se deben retirar o migrar a los estilos de marca para que no vuelvan a filtrarse al cambiar el orden de CSS.

### Campos de formulario

Chrome avisó que varios campos visibles no tenían nombre ni identificador. Se añadieron nombres derivados de sus etiquetas a los controles, búsquedas, filtros, autorización de WhatsApp y controles dinámicos para añadir servicio a un plan. La pasada posterior no encontró controles visibles sin nombre en las vistas inspeccionadas.

Los campos de `Configuración` ahora tienen etiquetas explícitas enlazadas a sus controles mediante `for`/`id`; los campos de fecha también exponen un nombre accesible. Se separó el rótulo informativo de la moneda base porque no acompaña un control editable. Al abrir Configuración otra vez, Chrome no registró avisos de etiquetas.

### SVG y botones

Se ajustó el icono del perfil para que use un oro de alto contraste en tema claro y un oro claro en tema oscuro. Medición del perfil: 5,18:1 en claro y 11,60:1 en oscuro. Los iconos usan `currentColor` donde corresponde. Lighthouse dio 100 en accesibilidad para el dashboard móvil revisado.

### Tamaños de texto

Se elevaron a 12 px varios metadatos, etiquetas, enlaces secundarios, títulos de campos y ayudas. El residual menor de 12 px en las inspecciones correspondió a iniciales decorativas de avatares.

## QA que sí se ejecutó

- Rutas Inicio, Pacientes, Planes de pago, Pagos, Servicios, Reportes y Configuración: recorridas en claro y oscuro. Tras la corrección final se escanearon las siete rutas a 1440 px; no apareció verde y no hubo overflow horizontal. Inicio y el formulario de abono se comprobaron en móvil de 375 px tras el cambio, sin overflow; el modal de abono conserva desplazamiento interno para llegar a sus acciones.
- Formularios de paciente, pago, plan y servicio: abiertos en móvil; entradas de texto a 16 px y sin guardar.
- Configuración y plantilla de WhatsApp en móvil: controles a 16 px, foco dorado y sin desbordamiento horizontal; campos de configuración con etiquetas explícitas.
- Perfil y alertas: menú/estado vacío comprobados en móvil. Iconos del perfil medidos a 5,18:1 (claro) y 11,60:1 (oscuro). El modal del recibo se revisó en claro y oscuro, sin recorte ni overflow dentro de la aplicación.
- Lighthouse en snapshot del dashboard móvil: accesibilidad 100, buenas prácticas 100, SEO 100; el único fallo fue la recomendación `llms.txt`, que no aplica al área privada.
- Consola después de recargar: sin errores de aplicación; solo mensajes informativos de Vite/React.
- No se crearon, editaron ni eliminaron pacientes, pagos ni otros datos durante esta revisión.

## Pendiente de verificación

El terminal integrado sigue devolviendo `helper_unknown_error: setup refresh had errors`, así que no se pudieron ejecutar `pnpm build`, `pnpm typecheck`, `pnpm test` ni verificar migraciones. El recibo se inspeccionó en la aplicación, pero no se abrió el diálogo del navegador ni se imprimió una hoja física en esta pasada. El resultado de “sin verde” describe las rutas y estados visibles inspeccionados en runtime; faltan migrar las declaraciones de color heredadas a los estilos de marca para cerrar la limpieza a nivel de código fuente.
