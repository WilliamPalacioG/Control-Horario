CONTROL HORARIO
===============

Archivos:
- index.html
- styles.css
- app.js
- manifest.webmanifest
- service-worker.js
- icons/icon-192.png
- icons/icon-512.png

Cómo probarla:
1. No abras la aplicación únicamente haciendo doble clic en index.html si quieres usar la PWA.
2. Sírvela desde HTTPS o desde localhost.
3. Ejemplo en un PC con Python instalado:
   python -m http.server 8080
4. Abre:
   http://localhost:8080
5. En Chrome/Edge aparecerá la opción para instalarla cuando el navegador considere que cumple los requisitos.

Datos:
- Los registros se guardan en IndexedDB dentro del navegador/dispositivo.
- La copia JSON permite exportar/restaurar todos los datos.
- Excel usa SheetJS y PDF usa jsPDF + AutoTable desde CDN.

Recordatorio:
- La app comprueba a partir de las 23:00 si no existe ningún registro del día.
- Sin servidor/push, una PWA no puede garantizar una alarma exacta a las 23:00 si el navegador y la app están totalmente cerrados.
- Al volver a abrir la app después de las 23:00, la comprobación se ejecuta.
- El botón WhatsApp abre un mensaje preparado para el número +34 652 485 347; no lo envía automáticamente.

Notas funcionales:
- "Descanso" representa el día completo y registra 0 horas.
- "Jornada única" evita un segundo registro trabajado en la misma fecha.
- "Jornada parcial" permite varios turnos el mismo día.
- Si un turno termina después de medianoche, una hora de salida menor/igual a la entrada se interpreta como día siguiente.
- El descanso dentro de la jornada se descuenta de las horas netas y se incluye en Excel/PDF.

RESPONSIVE V3
=============
- Calendario sin scroll horizontal obligatorio en móvil.
- Historial convertido en tarjetas en pantallas pequeñas.
- Formularios, filtros y botones apilados correctamente.
- Ajustes específicos para tablet, móvil y móviles pequeños.
