"use strict";

const DB_NAME = "controlHorarioDB";
const DB_VERSION = 1;
const RECORDS_STORE = "records";
const STORES_STORE = "stores";
const DEFAULT_STORES = ["Antoni de Leyva 10", "Usera"];
const REST_VALUE = "__REST__";
const WHATSAPP_NUMBER = "34652485347";
const REMINDER_HOUR = 23;

let db;
let deferredInstallPrompt = null;
let allRecords = [];
let allStores = [];

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", init);

async function init() {
  db = await openDB();
  await seedStores();
  populateTimeSelects();
  setToday();
  bindEvents();
  await refreshData();
  setupPWA();
  updateNotificationStatus();
  checkReminder();
  setInterval(checkReminder, 60 * 1000);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(RECORDS_STORE)) {
        const records = database.createObjectStore(RECORDS_STORE, { keyPath: "id", autoIncrement: true });
        records.createIndex("date", "date");
        records.createIndex("store", "store");
        records.createIndex("status", "status");
      }

      if (!database.objectStoreNames.contains(STORES_STORE)) {
        database.createObjectStore(STORES_STORE, { keyPath: "id", autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function seedStores() {
  const existing = await requestToPromise(tx(STORES_STORE).getAll());
  if (existing.length) return;

  const transaction = db.transaction(STORES_STORE, "readwrite");
  const store = transaction.objectStore(STORES_STORE);
  DEFAULT_STORES.forEach((name) => store.add({ name }));
  await transactionDone(transaction);
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function populateTimeSelects() {
  const selectIds = ["startTime", "endTime", "breakStart", "breakEnd"];
  const options = ['<option value="">--:--</option>'];

  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      options.push(`<option value="${value}">${value}</option>`);
    }
  }

  selectIds.forEach((id) => $(id).innerHTML = options.join(""));
}

function setToday() {
  const today = localDateISO(new Date());
  $("dateInput").value = today;
  $("todayBadge").textContent = new Intl.DateTimeFormat("es-ES", {
    weekday: "long", day: "numeric", month: "long"
  }).format(new Date());
}

function localDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function bindEvents() {
  $("recordForm").addEventListener("submit", saveRecord);
  $("storeSelect").addEventListener("change", handleStoreMode);
  ["startTime", "endTime", "breakStart", "breakEnd"].forEach((id) => {
    $(id).addEventListener("change", updateCalculation);
  });

  document.querySelectorAll('input[name="breakMode"]').forEach((el) => {
    el.addEventListener("change", () => {
      $("breakFields").classList.toggle("hidden", getRadioValue("breakMode") === "none");
      updateCalculation();
    });
  });

  $("startNowBtn").addEventListener("click", () => setNearestCurrentTime("startTime"));
  $("endNowBtn").addEventListener("click", () => setNearestCurrentTime("endTime"));

  $("addStoreBtn").addEventListener("click", openStoreDialog);
  $("confirmAddStoreBtn").addEventListener("click", addStoreFromDialog);
  $("manageStoresBtn").addEventListener("click", openManageStores);
  $("closeManageStoresBtn").addEventListener("click", () => $("manageStoresDialog").close());

  $("cancelEditBtn").addEventListener("click", resetForm);
  $("clearFiltersBtn").addEventListener("click", clearFilters);

  ["monthFilter", "yearFilter", "storeFilter", "fromFilter", "toFilter"].forEach((id) => {
    $(id).addEventListener("change", render);
  });

  $("exportExcelBtn").addEventListener("click", exportExcel);
  $("exportPdfBtn").addEventListener("click", exportPDF);
  $("backupBtn").addEventListener("click", exportBackup);
  $("restoreInput").addEventListener("change", importBackup);

  $("enableNotificationsBtn").addEventListener("click", enableNotifications);
  $("whatsappBtn").addEventListener("click", openWhatsApp);
  $("installBtn").addEventListener("click", installPWA);
}

async function refreshData() {
  allRecords = await requestToPromise(tx(RECORDS_STORE).getAll());
  allStores = await requestToPromise(tx(STORES_STORE).getAll());
  allRecords.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  allStores.sort((a, b) => a.name.localeCompare(b.name, "es"));

  populateStores();
  populateFilters();
  render();
}

function populateStores() {
  const current = $("storeSelect").value;
  $("storeSelect").innerHTML =
    `<option value="">Selecciona...</option>` +
    allStores.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join("") +
    `<option value="${REST_VALUE}">Descanso (todo el día)</option>`;

  if ([...$("storeSelect").options].some(o => o.value === current)) {
    $("storeSelect").value = current;
  }
}

function populateFilters() {
  const storeCurrent = $("storeFilter").value;
  $("storeFilter").innerHTML =
    `<option value="">Todas</option>` +
    allStores.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join("") +
    `<option value="${REST_VALUE}">Descanso</option>`;
  $("storeFilter").value = storeCurrent;

  const years = [...new Set(allRecords.map(r => Number(r.date.slice(0,4))))].sort((a,b) => b-a);
  const currentYear = $("yearFilter").value;
  $("yearFilter").innerHTML = `<option value="">Todos</option>` +
    years.map(y => `<option value="${y}">${y}</option>`).join("");
  if (years.includes(Number(currentYear))) $("yearFilter").value = currentYear;
}

function handleStoreMode() {
  const isRest = $("storeSelect").value === REST_VALUE;
  $("workFields").classList.toggle("hidden", isRest);
  if (isRest) {
    $("calculatedHours").textContent = "0 h";
    $("calculationDetail").textContent = "Descanso de día completo.";
  } else {
    updateCalculation();
  }
}

function setNearestCurrentTime(selectId) {
  const now = new Date();
  const minutes = Math.round(now.getMinutes() / 15) * 15;
  let hours = now.getHours();
  let mins = minutes;
  if (mins === 60) { hours = (hours + 1) % 24; mins = 0; }
  const value = `${String(hours).padStart(2,"0")}:${String(mins).padStart(2,"0")}`;
  $(selectId).value = value;
  updateCalculation();
}

function minutesFromTime(value) {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function calculateWork() {
  const start = minutesFromTime($("startTime").value);
  const endRaw = minutesFromTime($("endTime").value);
  if (start === null || endRaw === null) return { gross: 0, breakMinutes: 0, net: 0, valid: false };

  let end = endRaw;
  if (end <= start) end += 24 * 60; // permite turnos que crucen medianoche

  const gross = end - start;
  let breakMinutes = 0;

  if (getRadioValue("breakMode") === "withBreak") {
    const bStart = minutesFromTime($("breakStart").value);
    let bEnd = minutesFromTime($("breakEnd").value);

    if (bStart === null || bEnd === null) {
      return { gross, breakMinutes: 0, net: gross, valid: false, breakMissing: true };
    }

    if (bEnd <= bStart) bEnd += 24 * 60;
    breakMinutes = bEnd - bStart;

    if (breakMinutes < 0 || breakMinutes >= gross) {
      return { gross, breakMinutes, net: 0, valid: false, invalidBreak: true };
    }
  }

  return { gross, breakMinutes, net: Math.max(0, gross - breakMinutes), valid: true };
}

function updateCalculation() {
  if ($("storeSelect").value === REST_VALUE) return;

  const c = calculateWork();
  $("calculatedHours").textContent = `${formatHours(c.net / 60)} h`;

  if (!$("startTime").value || !$("endTime").value) {
    $("calculationDetail").textContent = "Selecciona hora de entrada y salida.";
  } else if (c.breakMissing) {
    $("calculationDetail").textContent = "Selecciona el inicio y el fin del descanso.";
  } else if (c.invalidBreak) {
    $("calculationDetail").textContent = "El descanso no puede ser igual o mayor que la jornada.";
  } else {
    const text = c.breakMinutes
      ? `Bruto: ${formatHours(c.gross / 60)} h · Descanso: ${formatHours(c.breakMinutes / 60)} h`
      : `Sin descanso descontado.`;
    $("calculationDetail").textContent = text;
  }
}

async function saveRecord(event) {
  event.preventDefault();

  const id = Number($("recordId").value) || null;
  const date = $("dateInput").value;
  const storeValue = $("storeSelect").value;

  if (!date || !storeValue) return toast("Completa la fecha y la tienda/estado.");

  const isRest = storeValue === REST_VALUE;
  let record;

  if (isRest) {
    const conflicting = allRecords.some(r => r.date === date && r.status === "worked" && r.id !== id);
    if (conflicting && !confirm("Ya hay una jornada trabajada en esa fecha. ¿Quieres registrar también el descanso?")) return;

    record = {
      ...(id ? { id } : {}),
      date,
      store: "Descanso",
      status: "rest",
      shiftType: "single",
      startTime: "",
      endTime: "",
      breakStart: "",
      breakEnd: "",
      breakMinutes: 0,
      workedMinutes: 0,
      notes: $("notesInput").value.trim(),
      updatedAt: new Date().toISOString()
    };
  } else {
    const calc = calculateWork();
    if (!calc.valid) return toast("Revisa las horas y el descanso antes de guardar.");

    const shiftType = getRadioValue("shiftType");
    const sameDayWorked = allRecords.filter(r => r.date === date && r.status === "worked" && r.id !== id);

    if (shiftType === "single" && sameDayWorked.length) {
      return toast("Ya existe una jornada trabajada ese día. Usa “Jornada parcial / varios turnos”.");
    }

    record = {
      ...(id ? { id } : {}),
      date,
      store: storeValue,
      status: "worked",
      shiftType,
      startTime: $("startTime").value,
      endTime: $("endTime").value,
      breakStart: getRadioValue("breakMode") === "withBreak" ? $("breakStart").value : "",
      breakEnd: getRadioValue("breakMode") === "withBreak" ? $("breakEnd").value : "",
      breakMinutes: calc.breakMinutes,
      workedMinutes: calc.net,
      notes: $("notesInput").value.trim(),
      updatedAt: new Date().toISOString()
    };
  }

  const objectStore = tx(RECORDS_STORE, "readwrite");
  await requestToPromise(id ? objectStore.put(record) : objectStore.add(record));
  toast(id ? "Registro actualizado." : "Registro guardado.");
  resetForm();
  await refreshData();
}

function resetForm() {
  $("recordForm").reset();
  $("recordId").value = "";
  setToday();
  $("storeSelect").value = "";
  $("workFields").classList.remove("hidden");
  $("breakFields").classList.add("hidden");
  $("saveBtn").textContent = "Guardar registro";
  $("cancelEditBtn").classList.add("hidden");
  updateCalculation();
}

function getFilteredRecords() {
  const month = Number($("monthFilter").value) || null;
  const year = Number($("yearFilter").value) || null;
  const store = $("storeFilter").value;
  const from = $("fromFilter").value;
  const to = $("toFilter").value;

  return allRecords.filter((r) => {
    const [y, m] = r.date.split("-").map(Number);
    if (month && m !== month) return false;
    if (year && y !== year) return false;
    if (store) {
      if (store === REST_VALUE && r.status !== "rest") return false;
      if (store !== REST_VALUE && r.store !== store) return false;
    }
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    return true;
  });
}

function render() {
  const records = getFilteredRecords();
  renderTable(records);
  renderMetrics(records);
  renderStoreBreakdown(records);
}

function renderTable(records) {
  const tbody = $("recordsTableBody");
  if (!records.length) {
    tbody.innerHTML = `<tr><td class="empty-state" colspan="9">No hay registros para los filtros seleccionados.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map((r) => {
    const breakText = r.breakMinutes ? `${formatHours(r.breakMinutes/60)} h` : "—";
    return `
      <tr>
        <td data-label="Fecha">${formatDate(r.date)}</td>
        <td data-label="Día">${dayName(r.date)}</td>
        <td data-label="Tienda">${escapeHtml(r.store)}</td>
        <td data-label="Entrada">${r.startTime || "—"}</td>
        <td data-label="Salida">${r.endTime || "—"}</td>
        <td data-label="Descanso">${breakText}</td>
        <td data-label="Horas">${formatHours((r.workedMinutes || 0)/60)} h</td>
        <td data-label="Estado"><span class="status-pill ${r.status === "rest" ? "status-rest" : "status-work"}">${r.status === "rest" ? "Descanso" : "Trabajado"}</span></td>
        <td data-label="Acciones">
          <div class="table-actions">
            <button class="btn btn-ghost" onclick="editRecord(${r.id})">Editar</button>
            <button class="btn btn-danger" onclick="deleteRecord(${r.id})">Eliminar</button>
          </div>
        </td>
      </tr>`;
  }).join("");
}

function renderMetrics(records) {
  const worked = records.filter(r => r.status === "worked");
  const rest = records.filter(r => r.status === "rest");
  const uniqueWorkedDays = new Set(worked.map(r => r.date)).size;
  const uniqueRestDays = new Set(rest.map(r => r.date)).size;
  const workedMinutes = worked.reduce((s, r) => s + (r.workedMinutes || 0), 0);
  const breakMinutes = worked.reduce((s, r) => s + (r.breakMinutes || 0), 0);

  $("metricDaysWorked").textContent = uniqueWorkedDays;
  $("metricHoursWorked").textContent = `${formatHours(workedMinutes / 60)} h`;
  $("metricRestDays").textContent = uniqueRestDays;
  $("metricBreakHours").textContent = `${formatHours(breakMinutes / 60)} h`;
  $("metricAverage").textContent = `${formatHours(uniqueWorkedDays ? workedMinutes / 60 / uniqueWorkedDays : 0)} h`;

  const range = getActiveDateRange(records);
  const weekendCounts = countWeekdaysInRange(range.start, range.end);
  $("metricWeekends").textContent = `${weekendCounts.saturdays} sáb · ${weekendCounts.sundays} dom`;
}

function renderStoreBreakdown(records) {
  const worked = records.filter(r => r.status === "worked");
  const map = new Map();

  worked.forEach(r => {
    if (!map.has(r.store)) map.set(r.store, { minutes: 0, days: new Set() });
    const stat = map.get(r.store);
    stat.minutes += r.workedMinutes || 0;
    stat.days.add(r.date);
  });

  const totalMinutes = worked.reduce((s,r) => s + (r.workedMinutes || 0), 0);
  const blocks = [...map.entries()].map(([store, stat]) => `
    <div class="store-stat">
      <span>${escapeHtml(store)}</span>
      <strong>${formatHours(stat.minutes/60)} h</strong>
      <small>${stat.days.size} día(s) trabajado(s)</small>
    </div>
  `);

  blocks.push(`
    <div class="store-stat">
      <span>Total todas las tiendas</span>
      <strong>${formatHours(totalMinutes/60)} h</strong>
      <small>${new Set(worked.map(r => r.date)).size} día(s) trabajado(s)</small>
    </div>
  `);

  $("storeBreakdown").innerHTML = blocks.join("");
}

function getActiveDateRange(records) {
  const from = $("fromFilter").value;
  const to = $("toFilter").value;
  const month = Number($("monthFilter").value) || null;
  const year = Number($("yearFilter").value) || null;

  if (from || to) {
    const dates = records.map(r => r.date).sort();
    return {
      start: from || dates[0] || localDateISO(new Date()),
      end: to || dates[dates.length - 1] || localDateISO(new Date())
    };
  }

  if (year && month) {
    const start = `${year}-${String(month).padStart(2,"0")}-01`;
    const last = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2,"0")}-${String(last).padStart(2,"0")}`;
    return { start, end };
  }

  if (year) return { start: `${year}-01-01`, end: `${year}-12-31` };

  const dates = records.map(r => r.date).sort();
  if (dates.length) return { start: dates[0], end: dates[dates.length - 1] };

  const today = localDateISO(new Date());
  return { start: today, end: today };
}

function countWeekdaysInRange(startISO, endISO) {
  if (!startISO || !endISO || startISO > endISO) return { saturdays: 0, sundays: 0 };
  const start = new Date(`${startISO}T12:00:00`);
  const end = new Date(`${endISO}T12:00:00`);
  let saturdays = 0, sundays = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 6) saturdays++;
    if (d.getDay() === 0) sundays++;
  }
  return { saturdays, sundays };
}

window.editRecord = async function(id) {
  const record = allRecords.find(r => r.id === id);
  if (!record) return;

  $("recordId").value = record.id;
  $("dateInput").value = record.date;
  $("storeSelect").value = record.status === "rest" ? REST_VALUE : record.store;
  $("notesInput").value = record.notes || "";

  setRadio("shiftType", record.shiftType || "single");

  if (record.status === "worked") {
    $("startTime").value = record.startTime || "";
    $("endTime").value = record.endTime || "";
    setRadio("breakMode", record.breakMinutes ? "withBreak" : "none");
    $("breakStart").value = record.breakStart || "";
    $("breakEnd").value = record.breakEnd || "";
  }

  handleStoreMode();
  $("breakFields").classList.toggle("hidden", !(record.breakMinutes > 0));
  $("saveBtn").textContent = "Guardar cambios";
  $("cancelEditBtn").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

window.deleteRecord = async function(id) {
  if (!confirm("¿Eliminar este registro? Esta acción no se puede deshacer.")) return;
  await requestToPromise(tx(RECORDS_STORE, "readwrite").delete(id));
  toast("Registro eliminado.");
  await refreshData();
};

function getRadioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value;
}

function setRadio(name, value) {
  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

function clearFilters() {
  ["monthFilter", "yearFilter", "storeFilter", "fromFilter", "toFilter"].forEach(id => $(id).value = "");
  render();
}

function openStoreDialog() {
  $("newStoreName").value = "";
  $("storeDialog").showModal();
  setTimeout(() => $("newStoreName").focus(), 50);
}

async function addStoreFromDialog(event) {
  event.preventDefault();
  const name = $("newStoreName").value.trim();
  if (!name) return toast("Escribe un nombre para la tienda.");
  if (allStores.some(s => s.name.toLowerCase() === name.toLowerCase())) return toast("Esa tienda ya existe.");

  await requestToPromise(tx(STORES_STORE, "readwrite").add({ name }));
  $("storeDialog").close();
  await refreshData();
  $("storeSelect").value = name;
  toast("Tienda añadida.");
}

function openManageStores() {
  const list = $("storeManagementList");
  list.innerHTML = allStores.map(s => `
    <div class="store-management-row">
      <span>${escapeHtml(s.name)}</span>
      <button class="btn btn-danger" type="button" onclick="removeStore(${s.id})">Eliminar</button>
    </div>
  `).join("") || "<p>No hay tiendas.</p>";
  $("manageStoresDialog").showModal();
}

window.removeStore = async function(id) {
  const store = allStores.find(s => s.id === id);
  if (!store) return;

  const used = allRecords.some(r => r.store === store.name);
  if (used) {
    return toast("No puedes eliminar una tienda que ya tiene registros. Sus datos históricos deben conservarse.");
  }

  if (!confirm(`¿Eliminar la tienda "${store.name}"?`)) return;
  await requestToPromise(tx(STORES_STORE, "readwrite").delete(id));
  await refreshData();
  openManageStores();
};

function buildSummary(records) {
  const worked = records.filter(r => r.status === "worked");
  const rest = records.filter(r => r.status === "rest");
  const workedDays = new Set(worked.map(r => r.date)).size;
  const restDays = new Set(rest.map(r => r.date)).size;
  const totalWorkedMinutes = worked.reduce((s,r) => s + (r.workedMinutes || 0), 0);
  const totalBreakMinutes = worked.reduce((s,r) => s + (r.breakMinutes || 0), 0);
  const breakDates = [...new Set(worked.filter(r => r.breakMinutes > 0).map(r => r.date))].sort();

  const range = getActiveDateRange(records);
  const weekends = countWeekdaysInRange(range.start, range.end);

  const stores = {};
  worked.forEach(r => {
    stores[r.store] = (stores[r.store] || 0) + (r.workedMinutes || 0);
  });

  return {
    workedDays,
    restDays,
    totalWorkedHours: totalWorkedMinutes / 60,
    totalBreakHours: totalBreakMinutes / 60,
    averageHours: workedDays ? (totalWorkedMinutes / 60) / workedDays : 0,
    breakDates,
    saturdays: weekends.saturdays,
    sundays: weekends.sundays,
    stores,
    range
  };
}

function exportExcel() {
  if (typeof XLSX === "undefined") return toast("No se pudo cargar la librería de Excel. Comprueba tu conexión.");

  const records = getFilteredRecords();
  if (!records.length) return toast("No hay registros para exportar.");

  const summary = buildSummary(records);
  const rows = records.map(r => ({
    Fecha: formatDate(r.date),
    Día: dayName(r.date),
    Tienda: r.store,
    Entrada: r.startTime || "",
    Salida: r.endTime || "",
    "Descanso inicio": r.breakStart || "",
    "Descanso fin": r.breakEnd || "",
    "Horas descanso": round2((r.breakMinutes || 0)/60),
    "Horas trabajadas": round2((r.workedMinutes || 0)/60),
    Estado: r.status === "rest" ? "Descanso" : "Trabajado",
    "Tipo jornada": r.status === "worked" ? (r.shiftType === "partial" ? "Parcial" : "Única") : "",
    Observaciones: r.notes || ""
  }));

  const summaryRows = [
    {},
    { Fecha: "RESUMEN" },
    { Fecha: "Total días trabajados", Día: summary.workedDays },
    { Fecha: "Total horas trabajadas", Día: round2(summary.totalWorkedHours) },
    { Fecha: "Total días de descanso", Día: summary.restDays },
    { Fecha: "Total horas de descanso en jornada", Día: round2(summary.totalBreakHours) },
    { Fecha: "Días con descanso en jornada", Día: summary.breakDates.map(formatDate).join(", ") || "Ninguno" },
    { Fecha: "Promedio de horas por día trabajado", Día: round2(summary.averageHours) },
    { Fecha: "Sábados del periodo", Día: summary.saturdays },
    { Fecha: "Domingos del periodo", Día: summary.sundays },
    {},
    { Fecha: "HORAS POR TIENDA" },
    ...Object.entries(summary.stores).map(([store, minutes]) => ({ Fecha: store, Día: round2(minutes/60) })),
    { Fecha: "TOTAL TODAS LAS TIENDAS", Día: round2(summary.totalWorkedHours) }
  ];

  const ws = XLSX.utils.json_to_sheet([...rows, ...summaryRows]);
  ws["!cols"] = [
    {wch:16},{wch:14},{wch:24},{wch:10},{wch:10},{wch:15},{wch:15},
    {wch:16},{wch:18},{wch:14},{wch:15},{wch:34}
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Control Horario");
  XLSX.writeFile(wb, `Control_Horario_${fileDate()}.xlsx`);
}

function exportPDF() {
  if (!window.jspdf?.jsPDF) return toast("No se pudo cargar la librería PDF. Comprueba tu conexión.");

  const records = getFilteredRecords();
  if (!records.length) return toast("No hay registros para exportar.");

  const summary = buildSummary(records);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  doc.setFontSize(18);
  doc.text("CONTROL HORARIO", 14, 16);
  doc.setFontSize(9);
  doc.text(`Periodo: ${formatDate(summary.range.start)} - ${formatDate(summary.range.end)}`, 14, 23);

  const body = records.map(r => [
    formatDate(r.date),
    dayName(r.date),
    r.store,
    r.startTime || "—",
    r.endTime || "—",
    r.breakMinutes ? `${formatHours(r.breakMinutes/60)} h` : "—",
    `${formatHours((r.workedMinutes || 0)/60)} h`,
    r.status === "rest" ? "Descanso" : "Trabajado"
  ]);

  doc.autoTable({
    startY: 29,
    head: [["Fecha","Día","Tienda","Entrada","Salida","Descanso","Horas","Estado"]],
    body,
    styles: { fontSize: 8, cellPadding: 2.3 },
    headStyles: { fillColor: [17,24,39] },
    margin: { left: 14, right: 14 }
  });

  let y = doc.lastAutoTable.finalY + 9;
  if (y > 175) { doc.addPage(); y = 18; }

  doc.setFontSize(12);
  doc.text("Resumen", 14, y);
  y += 7;
  doc.setFontSize(9);

  const summaryLines = [
    `Días trabajados: ${summary.workedDays}`,
    `Horas totales trabajadas: ${formatHours(summary.totalWorkedHours)} h`,
    `Días de descanso: ${summary.restDays}`,
    `Promedio de horas/día: ${formatHours(summary.averageHours)} h`,
    `Horas de descanso dentro de jornada: ${formatHours(summary.totalBreakHours)} h`,
    `Días con descanso: ${summary.breakDates.length ? summary.breakDates.map(formatDate).join(", ") : "Ninguno"}`,
    `Sábados del periodo: ${summary.saturdays} · Domingos del periodo: ${summary.sundays}`
  ];

  summaryLines.forEach(line => { doc.text(line, 14, y); y += 5; });

  y += 3;
  doc.setFontSize(11);
  doc.text("Horas por tienda", 14, y);
  y += 6;
  doc.setFontSize(9);

  Object.entries(summary.stores).forEach(([store, minutes]) => {
    doc.text(`${store}: ${formatHours(minutes/60)} h`, 14, y);
    y += 5;
  });
  doc.setFont(undefined, "bold");
  doc.text(`TOTAL TODAS LAS TIENDAS: ${formatHours(summary.totalWorkedHours)} h`, 14, y);

  doc.save(`Control_Horario_${fileDate()}.pdf`);
}

function exportBackup() {
  const payload = {
    app: "Control Horario",
    version: 1,
    exportedAt: new Date().toISOString(),
    stores: allStores.map(s => ({ name: s.name })),
    records: allRecords.map(({id, ...rest}) => rest)
  };
  downloadBlob(JSON.stringify(payload, null, 2), `Control_Horario_backup_${fileDate()}.json`, "application/json");
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());
    if (!Array.isArray(payload.records) || !Array.isArray(payload.stores)) throw new Error("Formato no válido");

    if (!confirm("La importación reemplazará los datos actuales. ¿Continuar?")) {
      event.target.value = "";
      return;
    }

    const transaction = db.transaction([RECORDS_STORE, STORES_STORE], "readwrite");
    const recordsStore = transaction.objectStore(RECORDS_STORE);
    const storesStore = transaction.objectStore(STORES_STORE);
    recordsStore.clear();
    storesStore.clear();

    payload.stores.forEach(s => storesStore.add({ name: s.name }));
    payload.records.forEach(r => recordsStore.add(r));

    await transactionDone(transaction);
    toast("Copia restaurada correctamente.");
    await refreshData();
  } catch (error) {
    console.error(error);
    toast("No se pudo importar la copia.");
  } finally {
    event.target.value = "";
  }
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function enableNotifications() {
  if (!("Notification" in window)) return toast("Este navegador no admite notificaciones.");
  const permission = await Notification.requestPermission();
  updateNotificationStatus();
  if (permission === "granted") toast("Notificaciones activadas.");
}

function updateNotificationStatus() {
  const el = $("notificationStatus");
  if (!("Notification" in window)) {
    el.textContent = "Este navegador no admite notificaciones.";
  } else if (Notification.permission === "granted") {
    el.textContent = "Notificaciones activadas. Se comprobará el registro a partir de las 23:00.";
  } else if (Notification.permission === "denied") {
    el.textContent = "Notificaciones bloqueadas desde el navegador.";
  } else {
    el.textContent = "Pulsa “Activar notificaciones” para conceder permiso.";
  }
}

async function checkReminder() {
  const now = new Date();
  if (now.getHours() < REMINDER_HOUR) return;

  const today = localDateISO(now);
  const notifiedKey = `controlHorarioNotified:${today}`;
  if (localStorage.getItem(notifiedKey)) return;

  const todayRecords = allRecords.filter(r => r.date === today);
  if (todayRecords.length) return;

  localStorage.setItem(notifiedKey, "1");

  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const registration = await navigator.serviceWorker?.ready;
      if (registration) {
        await registration.showNotification("Control Horario", {
          body: "Hoy aún no has registrado tu jornada o descanso.",
          icon: "icons/icon-192.png",
          badge: "icons/icon-192.png",
          tag: `recordatorio-${today}`,
          data: { url: "./" }
        });
      } else {
        new Notification("Control Horario", { body: "Hoy aún no has registrado tu jornada o descanso." });
      }
    } catch {
      new Notification("Control Horario", { body: "Hoy aún no has registrado tu jornada o descanso." });
    }
  }

  toast("Recordatorio: hoy aún no has registrado tu jornada o descanso.");
}

function openWhatsApp() {
  const today = new Intl.DateTimeFormat("es-ES").format(new Date());
  const text = encodeURIComponent(`Control Horario: recuerda registrar la jornada o descanso del ${today}.`);
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${text}`, "_blank", "noopener");
}

function setupPWA() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(console.error);
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $("installBtn").classList.remove("hidden");
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    $("installBtn").classList.add("hidden");
    toast("Control Horario instalada.");
  });
}

async function installPWA() {
  if (!deferredInstallPrompt) return toast("La instalación no está disponible todavía en este navegador.");
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("installBtn").classList.add("hidden");
}

function formatDate(iso) {
  if (!iso) return "";
  const [y,m,d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES").format(new Date(y, m-1, d));
}

function dayName(iso) {
  const [y,m,d] = iso.split("-").map(Number);
  const name = new Intl.DateTimeFormat("es-ES", { weekday: "long" }).format(new Date(y, m-1, d));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function formatHours(hours) {
  const value = Number(hours || 0);
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(".", ",");
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function fileDate() {
  return localDateISO(new Date()).replaceAll("-", "");
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}