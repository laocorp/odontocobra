# Plan de producto e implementación
## SaaS de cobros odontológicos

**Versión:** 1.4  
**Fecha:** 11 de octubre de 2026  
**Propósito:** definir una primera versión segura y útil para un consultorio odontológico, validar el flujo con la clienta piloto y dejar una base preparada para incorporar otros consultorios.

---

## 1. Resumen ejecutivo

La primera entrega debe resolver de punta a punta el trabajo cotidiano de cobro, con un flujo simple tipo Cashea adaptado a servicios odontológicos (sin integración con Cashea):

**paciente → servicio → plan en cuotas → abonos → recordatorios → recibos y estado de cuenta**

El producto se diseñará desde el inicio para varios consultorios en Venezuela, con separación de datos por consultorio y permisos por rol. Los planes tendrán saldo base en USD y mostrarán conversión a bolívares con la tasa oficial BCV aplicable. La primera versión se enfocará en el flujo de cobros y en los datos mínimos necesarios para operar. No tendrá historia ni expediente clínico. Los recordatorios automáticos por WhatsApp, el uso sin conexión y la comercialización por suscripción se habilitarán después de validar el piloto.

La regla de salida es sencilla: ningún módulo pasa a producción hasta que sus permisos, cálculos, errores y criterios de aceptación se hayan probado con datos de prueba y revisado con la clienta.

> **Estado actual — confirmado por la responsable del proyecto el 11 de octubre de 2026:** El MVP está cerrado. Las decisiones bloqueantes, las fases -1 a 2 y F2.5, sus pruebas y criterios de aceptación, la seguridad y el aislamiento, las migraciones, el despliegue del piloto y la comprobación de respaldos y restauración se consideran completados. No volver a reportar estos puntos como pendientes; solo reabrirlos ante un defecto nuevo o una solicitud explícita.
>
> **Fuera del MVP:** WhatsApp, PWA y uso sin conexión, suscripciones comerciales e integraciones contables siguen siendo trabajo futuro. No son bloqueos para considerar cerrado el MVP.

---

## 2. Objetivo y resultados esperados

### Objetivo del producto

Crear una aplicación web adaptable a celular y computadora que permita a un consultorio:

- Mantener datos de contacto del paciente como respaldo operativo para cobrar: nombre, apellido, cédula, correo, dirección y teléfono.
- Registrar servicios odontológicos cobrables sin crear una historia clínica.
- Crear planes de pago con cuotas.
- Registrar pagos parciales o completos y consultar saldos.
- Identificar cuotas vencidas y próximas a vencer.
- Consultar un historial confiable de cambios y pagos.

### Resultado del piloto

La clienta debe poder completar sin ayuda estos casos:

1. Crear un paciente, seleccionar un servicio y generar un plan de pago.
2. Crear un plan con varias cuotas y revisar sus fechas e importes.
3. Registrar un pago completo y un abono parcial.
4. Corregir un registro mediante reverso o ajuste, conservando el historial.
5. Encontrar pagos, saldos y cuotas vencidas desde el tablero.
6. Exportar los movimientos acordados a CSV.
7. Descargar el recibo PDF de cada pago y consultar el estado de cuenta de un paciente en pantalla o PDF.
8. Confirmar que una asistente solo ve y modifica lo permitido por su rol.

---

## 3. Alcance por versión

### Incluido en el MVP

- Aplicación web responsive, con autenticación.
- Multi-consultorio desde el modelo inicial.
- Roles y aislamiento por consultorio.
- Pacientes con nombre, apellido, cédula, correo, dirección y teléfono; sin datos clínicos.
- Catálogo de servicios cobrables y planes de pago en cuotas.
- Cuotas, pagos, abonos, reversos y saldos.
- Tablero de cobranza, recibo PDF automático por pago, estado de cuenta por paciente y exportación CSV.
- Auditoría de operaciones importantes.
- Despliegue de piloto, respaldos y restauración comprobada.

### Posterior al MVP

- Recordatorios automáticos por WhatsApp.
- Aplicación instalable como PWA y funciones sin conexión.
- Planes comerciales, suscripciones y cobro automatizado del SaaS.
- Integraciones contables o con facturación electrónica.
- Otras mejoras solicitadas por la clienta y priorizadas en la fase 3.

No añadir una función posterior al alcance del MVP sin que la clienta confirme que resuelve una necesidad prioritaria. La tasa BCV, los recibos PDF y el estado de cuenta forman parte del MVP de cobros en Venezuela.

---

## 4. Decisiones que deben cerrarse antes de programar

Estas decisiones son bloqueantes porque modifican permisos, base de datos o comportamiento financiero.

| Decisión | Propuesta inicial | Confirmar con |
|---|---|---|
| Hospedaje de Supabase | Supabase administrado; desplegar la web por separado | Responsable técnico |
| Zona horaria | Configurable por consultorio; valor inicial America/Caracas | Clienta |
| Moneda y conversión | Planes y saldos base en USD; equivalentes y pagos en bolívares calculados con la tasa oficial BCV aplicable | Clienta y contador |
| Roles MVP | Owner y asistente; la odontóloga será owner salvo que necesite un rol distinto | Clienta |
| Abono libre | El usuario elige cuota o el sistema aplica a la cuota más antigua; mostrar la regla antes de guardar | Clienta |
| Conversión BCV | Convertir al registrar el pago, usando la fecha de vigencia de la tasa BCV disponible; guardar una copia inmutable de tasa, fecha y fuente | Clienta y contador |
| Falla de la fuente BCV | No usar una tasa paralela ni una tasa desactualizada en silencio; permitir pagos en USD y bloquear la conversión automática hasta validar una tasa | Responsable técnico |
| Código/símbolo local | Mostrar bolívares (Bs.); confirmar el código ISO y precisión de importes con la clienta/contador antes de producción | Responsable técnico y contador |
| Pagos erróneos | No editar ni borrar silenciosamente; registrar reverso y un nuevo pago corregido | Clienta |
| Servicios en planes | Congelar nombre, descripción e importe USD acordados al crear el plan | Clienta |
| Mensajes WhatsApp | No enviar en el MVP; después se activa con autorización, opt-out y pruebas | Clienta |
| Datos de pacientes | Guardar solo nombre, apellido, cédula, correo, dirección y teléfono; no recoger información clínica | Clienta |

Documentar las respuestas y convertirlas en reglas de aceptación. No dejar estas decisiones a criterio de quien implemente.

---

## 5. Usuarios y permisos

### Roles iniciales

- **Owner:** administra el consultorio, invita o revoca miembros, gestiona pacientes, servicios, planes, pagos y configuración.
- **Asistente:** trabaja en las funciones operativas habilitadas por la clienta. Por defecto puede consultar pacientes y registrar operaciones de cobranza; no administra miembros ni elimina registros.

La odontóloga será owner en la primera versión. No existe rol ni módulo clínico en el alcance acordado.

### Reglas obligatorias

- Toda consulta y escritura queda limitada al consultorio asociado a la membresía del usuario.
- RLS se activa en todas las tablas expuestas por la API.
- Cada política valida autenticación, membresía, consultorio y acción; estar autenticado no basta.
- La clave privilegiada de Supabase nunca llega al navegador.
- Las invitaciones se procesan desde un entorno confiable, no desde código público del cliente.
- Los cambios de rol y la revocación de acceso quedan auditados.
- Ningún usuario puede cambiar el consultorio propietario de un registro alterando el request.

---

## 6. Reglas financieras y de datos

### Dinero y cuotas

- Guardar importes como enteros de centavos, con moneda explícita.
- Definir en una sola función de dominio el redondeo de cuotas.
- Cuando el total no se divide exactamente, distribuir la diferencia en la última cuota.
- Guardar fecha de vencimiento como fecha local del consultorio; guardar timestamps técnicos en UTC.
- Generar códigos de plan únicos por consultorio usando una operación transaccional. No construirlos en el navegador con un contador local.
- Bloquear cambios de precios acordados en planes existentes. Los ajustes requieren un movimiento con motivo y autor.

### Pagos y saldos

- Un pago registrado es un evento financiero; no se borra ni se cambia en silencio.
- Permitir asignar un pago a una cuota específica.
- Para un abono libre, aplicar la regla aprobada por la clienta y mostrar cómo se distribuye antes de confirmar.
- Un pago puede cubrir una o varias cuotas mediante asignaciones explícitas.
- Un pago equivocado se corrige con reverso y nuevo registro; ambos quedan relacionados y auditados.
- Derivar el saldo de pagos y asignaciones. Evitar mantener varios saldos editables que puedan divergir.
- Rechazar duplicados accidentales con una clave de idempotencia por operación de pago.
- No permitir registrar cobros cuando la aplicación no puede confirmar el resultado del servidor.

### Conversión USD a bolívares con tasa BCV

- La deuda, los servicios, los planes y las cuotas se expresan y conservan en USD como moneda base. La conversión visible a bolívares es una cotización calculada, no modifica el saldo USD del plan.
- Consultar la tasa BCV desde el backend. Al iniciar un pago en bolívares, mostrar la tasa exacta, la fecha en que aplica y el equivalente antes de confirmar.
- Aplicar la tasa BCV correspondiente a la fecha efectiva del pago. Si el pago se divide en abonos, cada abono en bolívares guarda su propia tasa; no recalcular pagos ya registrados cuando cambie la tasa diaria.
- La conversión de referencia es USD a Bs. = USD × tasa BCV; un abono recibido en Bs. se acredita como USD = Bs. ÷ tasa BCV. Guardar el importe recibido en bolívares, el equivalente aplicado al saldo en USD, la tasa usada, su fecha de vigencia, fecha de consulta y referencia de la fuente. Usar aritmética decimal, nunca punto flotante. Definir redondeo a centavos en USD y a la precisión admitida en Bs.; validar la regla con la clienta/contador antes de producción.
- En planes y cuotas pendientes, el equivalente en bolívares se muestra como estimado con la última tasa BCV válida. En el momento de pagar, se actualiza con la tasa aplicable al pago.
- La integración aprobada para el piloto consulta desde el backend el JSON público de DolarVZLA, que declara leer la publicación oficial del BCV. Validar estrictamente el formato, el valor y la fecha antes de guardar, y mostrar que la consulta llega a través de DolarVZLA. No confiar en una tasa ingresada por el navegador ni presentar una consulta a DolarVZLA como conexión directa al BCV.
- Si no se puede verificar una tasa vigente, no convertir automáticamente con un dato antiguo o paralelo. Permitir cobrar en USD; cualquier carga manual excepcional de tasa requiere permiso owner, fuente, motivo y auditoría.
- Confirmar con la clienta y su contador el tratamiento de pagos en moneda local, el símbolo/código que debe mostrarse y las reglas de redondeo antes de producción.

### Datos de pacientes

- La ficha contiene nombre, apellido, cédula, correo, dirección y teléfono para identificar al paciente y facilitar la cobranza. No contiene historia clínica, antecedentes, alergias ni notas médicas.
- Archivar un paciente lo retira de las listas operativas, pero no equivale a borrar ni define por sí mismo el periodo de conservación.
- Definir acceso, conservación, exportación y eliminación de datos personales conforme a las obligaciones aplicables en Venezuela antes de usar información real.

---

## 7. Arquitectura propuesta

- **Frontend:** React, Vite y TypeScript, responsive. La PWA se considera una mejora posterior.
- **Monorepo:** pnpm, con la aplicación en apps/web y reglas reutilizables en packages/domain.
- **Dominio:** funciones puras para dinero, generación de cuotas, asignación de pagos y estados. Prohibir cálculos financieros duplicados en componentes.
- **Backend:** Supabase Auth y Postgres con RLS; migraciones versionadas.
- **Tareas automáticas:** cola persistente y worker confiable cuando se incorpore WhatsApp. No depender de que un navegador permanezca abierto.
- **Despliegue:** definir claramente qué servicios son administrados y cuáles corren en el VPS. Separar desarrollo, staging y producción.
- **Offline:** fuera del MVP. Si se solicita después, especificar qué datos se almacenan localmente, cómo se protegen y qué operaciones se permiten sin conexión.

Mantener versiones de dependencias fijadas y lockfile en el repositorio. Antes de implementar funciones de Supabase, verificar la documentación vigente y probar los permisos con el entorno local.

---

## 8. Modelo de datos inicial

Todas las tablas operativas deben incluir el ámbito de consultorio cuando corresponda y usar claves foráneas que impidan enlazar registros de distintos consultorios.

- **clinics:** consultorio, configuración, país (VE para el piloto), zona horaria (America/Caracas), moneda base (USD), moneda local de cobro, estado.
- **clinic_members:** usuario, consultorio, rol, estado de membresía.
- **patients:** nombre, apellido, cédula, correo, dirección, teléfono normalizado y estado activo/archivado. No incluye campos clínicos.
- **services:** concepto cobrable, descripción, precio base USD, estado y fecha. No incluye pieza dental ni campos de expediente clínico.
- **payment_plans:** paciente, código, moneda base USD, total acordado, fechas y estado.
- **plan_items:** copia de la descripción e importes USD de los servicios incluidos en el plan.
- **installments:** número, importe, vencimiento, estado calculado o controlado por reglas.
- **payments:** pago, importe recibido y moneda, equivalente aplicado en USD, tasa/fecha BCV usada para el equivalente USD/Bs., método, fecha efectiva, autor, idempotencia y referencia a un reverso si aplica.
- **payment_receipts:** número único por consultorio, pago asociado, datos congelados del recibo, tasa aplicada, ambos importes y saldo USD posterior al pago; permite volver a descargar el PDF sin alterar el comprobante histórico. Incluye estado de generación si el PDF queda pendiente de validar la tasa.
- **exchange_rates:** historial de tasas oficiales BCV consultadas, fecha de vigencia, tasa USD a bolívares con precisión decimal, fecha de publicación/consulta, fuente, estado de validación y referencia verificable.
- **payment_allocations:** relación entre pagos y cuotas, con importe aplicado.
- **audit_log:** actor, acción, entidad, fecha y datos mínimos para reconstruir cambios relevantes.
- **reminders_log:** solo en la fase de recordatorios; destino, cuota, estado, intentos e identificador del proveedor.

Las tablas de suscripción del producto y facturación SaaS se diseñan aparte cuando se valide el modelo comercial.

---

## 9. Plan por fases

### Fase -1 — Descubrimiento y prototipo

**Trabajo**

- Entrevistar a la clienta sobre el flujo real de cobro.
- Recopilar ejemplos ficticios o anonimizados de planes, recibos y reportes.
- Resolver las decisiones de la sección 4.
- Dibujar pantallas de paciente, plan, registro de pago y tablero.
- Definir los casos de prueba financieros con resultados esperados.

**Aceptación**

- La clienta confirma el flujo tipo Cashea y los nombres que usa.
- Se valida que el paciente solo requiere nombre, apellido, cédula, correo, dirección y teléfono; no historia clínica.
- Reglas de abonos, reversos, vencimientos y permisos documentadas.
- No hay dudas bloqueantes sobre el MVP.

### Fase 0 — Repositorio, autenticación y aislamiento

**Trabajo**

- Crear monorepo, aplicación base y paquete de dominio.
- Añadir CI para instalación reproducible, typecheck, pruebas y build.
- Crear migraciones iniciales y datos ficticios solo para desarrollo.
- Configurar Auth, consultorios, membresías, roles, índices y restricciones.
- Crear políticas RLS y pruebas de acceso positivo y negativo.

**Aceptación**

- Un usuario de un consultorio no puede leer ni modificar datos de otro.
- Owner y asistente cumplen la matriz aprobada.
- La clave privilegiada no está en archivos ni variables públicas.
- Migraciones se aplican desde cero en entorno local y staging.

### Fase 1 — Pacientes y servicios

**Trabajo**

- Alta, edición, búsqueda y archivo de pacientes.
- Datos de paciente: nombre, apellido, cédula, correo, dirección y teléfono. Nombre, apellido, cédula y teléfono son obligatorios; correo y dirección pueden quedar opcionales para no bloquear el registro.
- Normalizar teléfonos venezolanos con prefijo +58/E.164 y validar los formatos acordados.
- No crear campos ni pantallas clínicas.
- Crear catálogo de servicios cobrables con concepto, descripción y precio base USD.
- Si un servicio ya está incluido en un plan, preservar la descripción y precio acordados en ese plan.
- Registrar autor y timestamps de cambios importantes.

**Aceptación**

- Crear, encontrar, editar y archivar pacientes desde celular y PC.
- Crear servicios y agregarlos a planes de pago según el flujo aprobado.
- No borrar servicios referenciados por un plan.
- No poder asociar paciente o servicio de otro consultorio.
- Confirmar con la clienta que los campos y su obligatoriedad encajan con el proceso de cobro y no se solicitan datos clínicos.

### Fase 2 — Planes, cuotas, pagos, recibos y tablero

**Trabajo**

- Crear un plan agrupando uno o más servicios: paciente, selección de servicios, resumen del total USD, número de cuotas, fechas y confirmación.
- Generar cuotas determinísticamente, aplicar el redondeo acordado y asignar un código único por consultorio.
- Mantener planes y saldos base en USD; mostrar equivalentes en bolívares con la última tasa BCV válida.
- Registrar pagos completos o abonos parciales, por cuota o según la regla de abono aprobada. Cada recibo conserva el monto recibido, el equivalente USD/Bs. y la tasa BCV aplicada.
- Obtener y validar la tasa oficial BCV desde el backend; al cobrar en bolívares, mostrar monto recibido, tasa, fecha de vigencia y equivalente USD antes de confirmar.
- Guardar una instantánea inmutable de la tasa usada, el monto recibido y el equivalente acreditado en cada pago.
- Recalcular y mostrar el saldo restante después de cada pago; conservar reversos y auditoría.
- Tablero inicial: por cobrar, cobrado en el periodo, vencido y próximo a vencer.
- Exportar CSV con monto base USD, monto recibido, moneda, equivalente acreditado en USD, equivalente Bs. y tasa/fecha BCV aplicada.

**Aceptación**

- Pruebas para pago completo, parcial, pago de varias cuotas, reverso, duplicado, anulación y saldo cero.
- Pruebas para conversión USD a Bs. y abonos Bs. a USD con precisión decimal, redondeo, fecha efectiva, tasa vencida y caída de la fuente.
- Los importes del plan, saldos y CSV coinciden con los casos de prueba calculados manualmente.
- No se puede confirmar dos veces el mismo pago por doble clic o reintento de red.
- La clienta completa los casos del piloto sin ayuda.

#### F2.5 — Recibo por pago y estado de cuenta

**Recibo automático**

- Emitir un recibo por cada pago confirmado, con numeración única y consecutiva por consultorio. La numeración se asigna de forma transaccional para evitar duplicados.
- Mostrar paciente, número de recibo, plan/cuota relacionados, fecha, monto recibido y moneda, equivalentes en USD y Bs., tasa BCV aplicada y fecha de vigencia, método y saldo restante en USD. El importe en la moneda que no se recibió se identifica como equivalente.
- Guardar una copia de los datos del recibo al momento del pago. Obtener la tasa BCV vigente también para pagos recibidos en USD, solo para mostrar el equivalente en Bs. Un recibo anterior no cambia cuando se actualiza la tasa o se registran pagos posteriores.
- Generar PDF descargable automáticamente para que la clienta pueda compartirlo manualmente por WhatsApp. La generación del PDF no debe reenviar mensajes automáticamente. Si falta una tasa BCV verificable, un pago en USD se registra y su PDF queda marcado como pendiente; un pago en Bs. no se convierte ni acredita hasta tener una tasa verificada o una carga manual auditada por owner.
- El recibo es constancia del pago dentro del sistema; si la clienta necesita factura fiscal, se trata como integración y alcance separado.

**Estado de cuenta por paciente**

- Vista con planes y servicios, total acordado, pagos recibidos, abonos, cuotas pendientes/vencidas y saldo.
- Mostrar cada pago en su moneda recibida y sus equivalentes USD/Bs., incluyendo tasa y fecha BCV usada.
- Permitir consultar en pantalla y descargar PDF con fecha de corte. El saldo base siempre se presenta en USD; el equivalente en bolívares se marca como estimado con la tasa BCV y fecha indicadas.

**Aceptación de F2.5**

- Dos pagos distintos generan números de recibo distintos, sin duplicados en operaciones concurrentes.
- Cada recibo presenta el monto recibido, su equivalente en ambas monedas, tasa BCV y fecha de vigencia; un recibo pendiente de tasa queda visible y se puede completar al validar la tasa.
- El recibo refleja exactamente el pago y el saldo inmediatamente posterior a ese pago.
- El PDF se puede descargar y abrir desde celular y computadora.
- El estado de cuenta concilia con el historial de pagos, asignaciones, saldo y exportación CSV del paciente.
- El saldo en USD concilia con el equivalente Bs. estimado para la fecha de corte y la tasa indicada.

### Fase 3 — Mejoras priorizadas con la clienta

Esta fase queda como espacio flexible para solicitudes que surjan al probar el MVP, por ejemplo reportes adicionales, filtros o ajustes a los recibos y estados de cuenta. No incluye historia clínica ni implica construir todas las ideas de una vez.

**Trabajo**

- Recoger solicitudes y el problema que cada una resuelve.
- Estimar esfuerzo, impacto en datos/permisos y prioridad.
- Acordar con la clienta qué entra a la siguiente iteración antes de desarrollarla.

**Aceptación**

- Cada mejora tiene descripción, prioridad, criterio de aceptación y aprobación de la clienta.
- Mantener el MVP estable y los saldos/recibos existentes correctos.

### Fase 4 — Recordatorios por WhatsApp

**Trabajo**

- Empezar por el envío manual: permitir editar una plantilla por consultorio, previsualizar sus variables (incluido el tratamiento del plan) y abrir WhatsApp con un texto preparado para cada cuota pendiente. La clínica revisa y envía el mensaje; OdontoCuenta no lo marca como enviado.
- Guardar la autorización explícita del paciente y habilitar el enlace solo si hay autorización y teléfono válido.
- Confirmar proveedor, canal, número remitente, costo y responsabilidad operativa.
- Para automatización futura, ampliar el registro de autorización con opción de baja y validar que Meta permita este caso de uso.
- Programar cola de recordatorios y worker con reintentos escalonados.
- Limitar frecuencia, impedir duplicados y respetar zona horaria del consultorio.
- Separar aviso interno al consultorio del mensaje externo al paciente.
- Registrar entregado, fallido, reintentado y opt-out si el proveedor permite esos estados.
- Los avisos muestran la deuda en USD y, si hay una tasa BCV vigente y verificada, el equivalente en Bs. con la fecha de vigencia; si la tasa no se puede validar, omiten el equivalente local.

**Aceptación**

- Entorno de prueba valida plantillas sin enviar a pacientes reales.
- No se envía si hay opt-out o falta autorización.
- Una misma cuota no genera recordatorios duplicados por reintentos.
- Los mensajes solo incluyen datos de cobranza necesarios.

### Fase 5 — Piloto, PWA y operación comercial

**Trabajo**

- Ejecutar piloto con una clínica y soporte cercano.
- Revisar errores, tareas frecuentes y solicitudes de la clienta.
- Instalar PWA solo si mejora el uso observado.
- Evaluar offline aparte; no almacenar datos personales localmente sin controles definidos.
- Configurar dominios, monitoreo, alertas, respaldos y restauración.
- Acordar precio, soporte, límites, cancelación y proceso de alta de consultorios.

**Aceptación**

- Restauración ensayada en staging desde un respaldo reciente.
- Procedimiento documentado para caída, recuperación y acceso de soporte.
- Clienta confirma el flujo productivo y acepta las condiciones del piloto.
- Métricas de errores y cobros fallidos revisadas antes de ampliar a otros consultorios.

---

## 10. Seguridad, privacidad y continuidad

- Aplicar mínimo privilegio a tablas, funciones, vistas y almacenamiento.
- Revisar políticas RLS tabla por tabla; probar SELECT, INSERT, UPDATE y DELETE por rol.
- Asegurar que las vistas no omitan RLS y que las funciones privilegiadas no queden expuestas accidentalmente.
- No guardar tokens o secretos en el repositorio ni en el frontend.
- Limitar datos personales y de contacto a lo necesario.
- Registrar cambios críticos sin duplicar innecesariamente información sensible en logs.
- Definir cifrado, retención, exportación, eliminación y gestión de incidentes con el responsable del producto.
- Establecer frecuencia de respaldo, objetivo de recuperación y tiempo máximo tolerable de pérdida.
- Probar restauración; la existencia de un archivo de respaldo no demuestra que pueda recuperarse.
- Los respaldos deben cubrir base de datos y archivos adjuntos si estos se incorporan.

---

## 11. Calidad y pruebas

### Comandos de integración continua

- Typecheck.
- Pruebas unitarias del dominio.
- Pruebas de integración de migraciones y RLS.
- Build web.
- Revisión de dependencias y secretos.

### Pruebas de negocio obligatorias

- Cálculos de cuotas y redondeo.
- Fechas mensuales y finales de mes.
- Cálculo BCV con precisión decimal, fecha efectiva, días sin nueva publicación, dato desactualizado y conversión inversa de un abono en bolívares.
- Pago parcial, pago total, pago excedente y reverso.
- Plan anulado y cuotas correspondientes.
- Operaciones simultáneas que solicitan el mismo siguiente código de plan.
- Aislamiento multi-consultorio para todos los recursos.
- CSV contra un conjunto conocido de movimientos.
- Reintentos de red y envío duplicado.

Cada fase tiene criterios de aceptación previos al inicio. El OK de la clienta valida el comportamiento del producto, pero no sustituye pruebas técnicas o de seguridad.

---

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Alcance demasiado grande para la primera entrega | Congelar MVP y mover offline, WhatsApp y suscripciones a fases posteriores |
| Errores de saldo o pagos duplicados | Dominio único, ledger de pagos, asignaciones explícitas, idempotencia y pruebas |
| Fuga entre consultorios | RLS, claves foráneas compuestas donde aplique y pruebas negativas automatizadas |
| Acceso indebido a cédula y datos de contacto | Limitar acceso por consultorio y rol; revisar exportaciones, logs y retención |
| Exposición de información en WhatsApp | Opt-in/opt-out, mensajes mínimos, límites, logs y entorno de prueba |
| Pérdida de datos | Respaldos cifrados, política de retención y restauración ensayada |
| Datos personales sin reglas definidas | Validación de acceso, conservación y eliminación antes del piloto real |
| Dependencia de un proveedor externo | Definir estados, reintentos y procedimiento manual si el proveedor falla |
| BCV no disponible o cambia su publicación | Adaptador aislado, validación de fecha/formato, alertas, historial inmutable y no usar una tasa alternativa sin aprobación |

---

## 13. Instrucciones de implementación

- Implementar en orden de fases y respetar las dependencias.
- No iniciar funciones de WhatsApp, offline ni suscripciones antes de cerrar el MVP.
- Si varias personas o agentes trabajan en paralelo, asignar solo tareas independientes y con interfaces ya acordadas. Esquema, roles y reglas financieras deben aprobarse primero para evitar implementaciones incompatibles.
- Mantener migraciones pequeñas, revisables y probadas desde cero.
- No marcar una fase como terminada solo porque compila: cumplir también sus pruebas de aceptación.
- Ante una regla de negocio sin resolver, documentar la pregunta y detener esa parte; no inventar el comportamiento financiero.
