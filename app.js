let schedaCorrente = null;
let storicoEsercizi = {};
let allenamentoAttivo = null;
let workoutActive = false;
let workoutMinimized = false;
let expandedWorkoutIndex = null;
let dbPromise = null;

const DB_NAME = "gymAppDB";
const STORE_NAME = "appState";
const APP_STATE_KEY = "main";

const jsonFileInput = document.getElementById("jsonFileInput");
const fileInputLabel = document.getElementById("fileInputLabel");
const removeSheetButton = document.getElementById("removeSheetButton");
const statusMessage = document.getElementById("statusMessage");
const programName = document.getElementById("programName");
const sheetContent = document.getElementById("sheetContent");
const workoutModal = document.getElementById("workoutModal");
const workoutTitle = document.getElementById("workoutTitle");
const workoutContent = document.getElementById("workoutContent");
const workoutActions = document.getElementById("workoutActions");
const workoutBackButton = document.getElementById("workoutBackButton");
const workoutSkipSetButton = document.getElementById("workoutSkipSetButton");
const workoutActionButton = document.getElementById("workoutActionButton");
const exitWorkoutButton = document.getElementById("exitWorkoutButton");
const minimizeWorkoutButton = document.getElementById("minimizeWorkoutButton");
const floatingIsland = document.getElementById("floatingIsland");
const floatingIslandExercise = document.getElementById("floatingIslandExercise");
const floatingIslandSeries = document.getElementById("floatingIslandSeries");

jsonFileInput.addEventListener("change", handleFileImport);
exitWorkoutButton.addEventListener("click", closeWorkoutMode);
removeSheetButton.addEventListener("click", removeCurrentSheet);
minimizeWorkoutButton.addEventListener("click", minimizeWorkoutMode);
floatingIsland.addEventListener("click", reopenWorkoutMode);
workoutBackButton.addEventListener("click", handleWorkoutBack);
workoutSkipSetButton.addEventListener("click", handleSkipSet);
workoutActionButton.addEventListener("click", handleWorkoutAction);
window.addEventListener("resize", syncAccordionHeights);

function handleFileImport(event) {
  const [file] = event.target.files;

  if (!file || schedaCorrente) {
    return;
  }

  const reader = new FileReader();

  reader.onload = (loadEvent) => {
    try {
      const parsedData = normalizeProgramData(JSON.parse(loadEvent.target.result));
      validateProgram(parsedData);

      schedaCorrente = parsedData;
      storicoEsercizi = {};
      allenamentoAttivo = null;
      workoutActive = false;
      workoutMinimized = false;

      statusMessage.textContent = `Scheda caricata: ${schedaCorrente.nome}`;
      updateImportState();
      renderSheet();
      closeWorkoutMode();
      persistAppState();
    } catch (error) {
      statusMessage.textContent = `Errore importazione: ${error.message}`;
    }
  };

  reader.onerror = () => {
    statusMessage.textContent = "Impossibile leggere il file selezionato.";
  };

  reader.readAsText(file);
}

function validateProgram(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Il file JSON non contiene un oggetto valido.");
  }

  if (!data.nome || !Array.isArray(data.allenamenti)) {
    throw new Error("Formato non valido: servono nome e array allenamenti.");
  }
}

function normalizeProgramData(programData) {
  return {
    ...programData,
    allenamenti: Array.isArray(programData.allenamenti)
      ? programData.allenamenti.map(normalizeWorkoutData)
      : []
  };
}

function normalizeWorkoutData(workoutData) {
  return {
    ...workoutData,
    sets: Array.isArray(workoutData.sets)
      ? workoutData.sets.map(normalizeSetData)
      : []
  };
}

function normalizeSetData(setData) {
  const totalSeries = Math.max(Number(setData.serie) || 0, 0);

  return {
    ...setData,
    serie: totalSeries,
    esercizi: Array.isArray(setData.esercizi)
      ? setData.esercizi.map((exerciseData) => normalizeExerciseData(exerciseData, totalSeries))
      : []
  };
}

function normalizeExerciseData(exerciseData, totalSeries) {
  return {
    ...exerciseData,
    ripetizioni: normalizeRepsArray(exerciseData.ripetizioni, totalSeries)
  };
}

function normalizeRepsArray(rawReps, totalSeries) {
  if (totalSeries <= 0) {
    return [];
  }

  if (Array.isArray(rawReps)) {
    const values = rawReps
      .filter((value) => value !== null && value !== undefined && value !== "");

    if (!values.length) {
      return Array(totalSeries).fill("-");
    }

    while (values.length < totalSeries) {
      values.push(values[values.length - 1]);
    }

    return values
      .slice(0, totalSeries)
      .map((value) => value === "" ? "-" : value);
  }

  const fallbackValue = rawReps !== null && rawReps !== undefined && rawReps !== "" ? rawReps : "-";
  return Array(totalSeries).fill(fallbackValue);
}

function normalizePersistedWorkoutState(workoutState) {
  if (!workoutState || !workoutState.allenamentoAttivo) {
    return null;
  }

  const normalizedWorkout = {
    ...workoutState.allenamentoAttivo,
    superSerie: Array.isArray(workoutState.allenamentoAttivo.superSerie)
      ? workoutState.allenamentoAttivo.superSerie.map((setItem) => ({
        ...setItem,
        esercizi: Array.isArray(setItem.esercizi)
          ? setItem.esercizi.map((exerciseData) => normalizeExerciseData(exerciseData, Number(setItem.serieTotali) || 0))
          : []
      }))
      : [],
    workoutLog: workoutState.allenamentoAttivo.workoutLog || {}
  };

  return {
    allenamentoAttivo: normalizedWorkout,
    workoutActive: workoutState.workoutActive === true,
    workoutMinimized: workoutState.workoutMinimized === true
  };
}

function getTargetReps(exercise, seriesIndex) {
  if (!exercise || !Array.isArray(exercise.ripetizioni) || !exercise.ripetizioni.length) {
    return "-";
  }

  return exercise.ripetizioni[seriesIndex] ?? exercise.ripetizioni[exercise.ripetizioni.length - 1] ?? "-";
}

function formatTargetReps(value) {
  return `${value} reps`;
}

function createWorkoutEntryKey(setName, exerciseName) {
  return `${setName}::${exerciseName}`;
}

function createInitialWorkoutLog(superSerie) {
  const workoutLog = {};

  superSerie.forEach((setItem) => {
    setItem.esercizi.forEach((exercise) => {
      const entryKey = createWorkoutEntryKey(setItem.nome, exercise.nome);
      workoutLog[entryKey] = Array.from({ length: setItem.serieTotali }, () => ({ reps: "", peso: "" }));
    });
  });

  return workoutLog;
}

function getCurrentWorkoutEntry() {
  if (!allenamentoAttivo) {
    return { reps: "", peso: "" };
  }

  const currentSet = allenamentoAttivo.superSerie[allenamentoAttivo.setIndex];
  const exercise = currentSet.esercizi[allenamentoAttivo.esercizioIndex];
  const entryKey = createWorkoutEntryKey(currentSet.nome, exercise.nome);
  const seriesIndex = allenamentoAttivo.serieCorrente - 1;

  if (!allenamentoAttivo.workoutLog) {
    allenamentoAttivo.workoutLog = {};
  }

  if (!Array.isArray(allenamentoAttivo.workoutLog[entryKey])) {
    allenamentoAttivo.workoutLog[entryKey] = Array.from({ length: currentSet.serieTotali }, () => ({ reps: "", peso: "" }));
  }

  if (!allenamentoAttivo.workoutLog[entryKey][seriesIndex]) {
    allenamentoAttivo.workoutLog[entryKey][seriesIndex] = { reps: "", peso: "" };
  }

  return allenamentoAttivo.workoutLog[entryKey][seriesIndex];
}

function normalizeWeightValue(value) {
  const normalizedValue = String(value ?? "").trim().replace(",", ".");

  if (!normalizedValue) {
    return "";
  }

  const numericValue = Number(normalizedValue);
  return Number.isFinite(numericValue) ? numericValue : normalizedValue;
}

function syncCurrentWorkoutInputs() {
  if (!allenamentoAttivo || allenamentoAttivo.completato) {
    return;
  }

  const repsInput = document.getElementById(`repsInput-${allenamentoAttivo.esercizioIndex}`);
  const weightInput = document.getElementById(`weightInput-${allenamentoAttivo.esercizioIndex}`);

  if (!repsInput || !weightInput) {
    return;
  }

  const currentEntry = getCurrentWorkoutEntry();
  currentEntry.reps = repsInput.value.trim();
  currentEntry.peso = normalizeWeightValue(weightInput.value);
}

function persistCurrentWorkoutInputs() {
  syncCurrentWorkoutInputs();
  persistAppState();
}

function isWorkoutAtStart() {
  return Boolean(allenamentoAttivo)
    && allenamentoAttivo.setIndex === 0
    && allenamentoAttivo.serieCorrente === 1
    && allenamentoAttivo.esercizioIndex === 0;
}

function goToPreviousWorkoutStep() {
  if (!allenamentoAttivo || isWorkoutAtStart()) {
    return false;
  }

  if (allenamentoAttivo.esercizioIndex > 0) {
    allenamentoAttivo.esercizioIndex -= 1;
    return true;
  }

  if (allenamentoAttivo.serieCorrente > 1) {
    allenamentoAttivo.serieCorrente -= 1;
    allenamentoAttivo.esercizioIndex = allenamentoAttivo.superSerie[allenamentoAttivo.setIndex].esercizi.length - 1;
    return true;
  }

  if (allenamentoAttivo.setIndex > 0) {
    allenamentoAttivo.setIndex -= 1;
    const previousSet = allenamentoAttivo.superSerie[allenamentoAttivo.setIndex];
    allenamentoAttivo.serieCorrente = previousSet.serieTotali;
    allenamentoAttivo.esercizioIndex = previousSet.esercizi.length - 1;
    return true;
  }

  return false;
}

function attachWorkoutInputListeners() {
  if (!allenamentoAttivo || allenamentoAttivo.completato) {
    return;
  }

  const repsInput = document.getElementById(`repsInput-${allenamentoAttivo.esercizioIndex}`);
  const weightInput = document.getElementById(`weightInput-${allenamentoAttivo.esercizioIndex}`);

  if (repsInput) {
    repsInput.addEventListener("input", persistCurrentWorkoutInputs);
  }

  if (weightInput) {
    weightInput.addEventListener("input", persistCurrentWorkoutInputs);
    weightInput.addEventListener("blur", () => {
      const normalizedValue = normalizeWeightValue(weightInput.value);
      weightInput.value = normalizedValue === "" ? "" : String(normalizedValue);
      persistCurrentWorkoutInputs();
    });
  }
}

function updateImportState() {
  const isLoaded = Boolean(schedaCorrente);

  document.body.classList.toggle("has-sheet", isLoaded);
  jsonFileInput.disabled = isLoaded;
  removeSheetButton.classList.toggle("hidden", !isLoaded);

  if (isLoaded) {
    statusMessage.textContent = "Scheda gia caricata";
  }
}

function initDB() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });

  return dbPromise;
}

async function saveAppState(state) {
  try {
    const db = await initDB();

    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      store.put({
        id: APP_STATE_KEY,
        scheda: state.scheda,
        storico: state.storico,
        workoutState: state.workoutState
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    console.error("Errore salvataggio IndexedDB:", error);
  }
}

async function loadAppState() {
  try {
    const db = await initDB();

    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(APP_STATE_KEY);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? {
          scheda: result.scheda ?? null,
          storico: result.storico ?? {},
          workoutState: result.workoutState ?? null
        } : null);
      };

      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("Errore caricamento IndexedDB:", error);
    return null;
  }
}

async function clearAppState() {
  try {
    const db = await initDB();

    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.delete(APP_STATE_KEY);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    console.error("Errore reset IndexedDB:", error);
  }
}

function getPersistedWorkoutState() {
  if (!workoutActive || !allenamentoAttivo) {
    return null;
  }

  return {
    allenamentoAttivo,
    workoutActive,
    workoutMinimized
  };
}

function persistAppState() {
  return saveAppState({
    scheda: schedaCorrente,
    storico: storicoEsercizi,
    workoutState: getPersistedWorkoutState()
  });
}

function renderSheet() {
  if (!schedaCorrente) {
    programName.textContent = "In attesa di import";
    sheetContent.className = "sheet-content empty-state";
    sheetContent.textContent = "Importa un file JSON per visualizzare la scheda.";
    statusMessage.textContent = "Nessuna scheda caricata.";
    expandedWorkoutIndex = null;
    updateImportState();
    return;
  }

  programName.textContent = schedaCorrente.nome;
  sheetContent.className = "sheet-content";

  if (!schedaCorrente.allenamenti.length) {
    sheetContent.innerHTML = '<div class="empty-state">Nessun allenamento presente nella scheda.</div>';
    return;
  }

  sheetContent.innerHTML = schedaCorrente.allenamenti
    .map((allenamento, workoutIndex) => {
      const isExpanded = expandedWorkoutIndex === workoutIndex;
      const simpleSetsMarkup = (allenamento.sets || [])
        .map((setItem) => {
          const exerciseNames = (setItem.esercizi || [])
            .map((esercizio) => escapeHtml(esercizio.nome || "Esercizio senza nome"))
            .join(" & ");

          return `
            <div class="compact-list__item">
              ${exerciseNames || "Nessun esercizio in questo set"}
            </div>
          `;
        })
        .join("");

      return `
        <article class="workout-card">
          <div class="workout-card__header">
            <button class="accordion-trigger" type="button" onclick="toggleWorkoutDetails(${workoutIndex})">
              <p class="section-label">Allenamento</p>
              <h3>${escapeHtml(allenamento.nome || `Allenamento ${workoutIndex + 1}`)}</h3>
            </button>
            <div class="accordion-actions">
              <button class="workout-button" type="button" onclick="startWorkout(${workoutIndex})">
                Avvia
              </button>
            </div>
          </div>
          <div class="accordion-panel" data-workout-index="${workoutIndex}">
            <div class="accordion-panel__inner">
              <div class="compact-list">
                ${simpleSetsMarkup || '<div class="empty-state">Nessun set disponibile.</div>'}
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  syncAccordionHeights();
}

function startWorkout(workoutIndex) {
  if (!schedaCorrente) {
    return;
  }

  const selectedWorkout = schedaCorrente.allenamenti[workoutIndex];
  const superSerie = (selectedWorkout.sets || [])
    .map((setItem, setIndex) => ({
      nome: `Set ${setIndex + 1}`,
      serieTotali: Number(setItem.serie) || 0,
      esercizi: (setItem.esercizi || []).map((esercizio) => ({
        nome: esercizio.nome || "Esercizio senza nome",
        note: esercizio.note || "",
        ripetizioni: normalizeRepsArray(esercizio.ripetizioni, Number(setItem.serie) || 0)
      }))
    }))
    .filter((setItem) => setItem.serieTotali > 0 && setItem.esercizi.length > 0);

  if (!superSerie.length) {
    statusMessage.textContent = "Questo allenamento non contiene esercizi avviabili.";
    return;
  }

  allenamentoAttivo = {
    nome: selectedWorkout.nome || `Allenamento ${workoutIndex + 1}`,
    setIndex: 0,
    serieCorrente: 1,
    esercizioIndex: 0,
    superSerie,
    workoutLog: createInitialWorkoutLog(superSerie),
    completato: false
  };

  workoutActive = true;
  workoutMinimized = false;
  renderWorkoutMode();
  openWorkoutMode();
  persistAppState();
}

function renderWorkoutMode() {
  if (!allenamentoAttivo) {
    workoutTitle.textContent = "Modalita allenamento";
    workoutContent.innerHTML = "";
    updateWorkoutActionButton();
    updateFloatingIsland();
    return;
  }

  workoutTitle.textContent = allenamentoAttivo.nome;

  if (allenamentoAttivo.completato) {
    workoutContent.innerHTML = `
      <div class="workout-content">
        <div class="workout-current">
          <p class="section-label">Completato</p>
          <h3>Allenamento terminato</h3>
          <p class="exercise-meta">Hai completato tutti gli esercizi di ${escapeHtml(allenamentoAttivo.nome)}.</p>
          <button class="workout-button" type="button" onclick="closeWorkoutMode()">Torna alla scheda</button>
        </div>
      </div>
    `;
    updateWorkoutActionButton();
    updateFloatingIsland();
    persistAppState();
    return;
  }

  const currentSet = allenamentoAttivo.superSerie[allenamentoAttivo.setIndex];
  const exercise = currentSet.esercizi[allenamentoAttivo.esercizioIndex];
  const currentSeriesIndex = allenamentoAttivo.serieCorrente - 1;
  const historyKey = createHistoryKey(allenamentoAttivo.nome, currentSet.nome, exercise.nome, currentSeriesIndex);
  const history = storicoEsercizi[historyKey];
  const targetReps = getTargetReps(exercise, currentSeriesIndex);
  const currentEntry = getCurrentWorkoutEntry();
  const showDots = currentSet.esercizi.length > 1;
  const dotsMarkup = currentSet.esercizi
    .map((_, index) => `<span class="slider-dot ${index === allenamentoAttivo.esercizioIndex ? "is-active" : ""}"></span>`)
    .join("");
  const slidesMarkup = currentSet.esercizi
    .map((item, index) => {
      const itemTargetReps = getTargetReps(item, currentSeriesIndex);
      const itemHistory = storicoEsercizi[createHistoryKey(allenamentoAttivo.nome, currentSet.nome, item.nome, currentSeriesIndex)];
      const itemHistoryMarkup = itemHistory
        ? `Ultima volta: ${escapeHtml(String(itemHistory.peso))} kg x ${escapeHtml(String(itemHistory.ripetizioni))} reps`
        : "Ultima volta: nessun dato disponibile";

      return `
        <article class="workout-slide">
          <section class="workout-current">
            <div>
              <p class="section-label">Focus</p>
              <h3>${escapeHtml(item.nome)}</h3>
              ${item.note ? `<p class="exercise-notes">${escapeHtml(item.note)}</p>` : ""}
            </div>

            <div class="summary-grid">
              <div class="summary-card">
                <span>Serie corrente</span>
                <strong>${allenamentoAttivo.serieCorrente} / ${currentSet.serieTotali}</strong>
              </div>
              <div class="summary-card">
                <span>Ripetizioni target</span>
                <strong>${escapeHtml(formatTargetReps(itemTargetReps))}</strong>
              </div>
            </div>

            <p class="history-box">${itemHistoryMarkup}</p>

            <div class="field-group">
              <label for="repsInput-${index}">Ripetizioni fatte</label>
              <input id="repsInput-${index}" type="number" min="0" inputmode="numeric" placeholder="Es. 10" value="${index === allenamentoAttivo.esercizioIndex ? escapeHtml(String(currentEntry.reps ?? "")) : ""}" ${index !== allenamentoAttivo.esercizioIndex ? "disabled" : ""}>
            </div>

            <div class="field-group">
              <label for="weightInput-${index}">Peso usato (kg)</label>
              <input id="weightInput-${index}" type="number" min="0" step="0.1" inputmode="decimal" placeholder="Es. 35" value="${index === allenamentoAttivo.esercizioIndex ? escapeHtml(String(currentEntry.peso ?? "")) : ""}" ${index !== allenamentoAttivo.esercizioIndex ? "disabled" : ""}>
            </div>
          </section>
        </article>
      `;
    })
    .join("");

  workoutContent.innerHTML = `
    <div class="workout-content">
      <div class="summary-grid">
        <div class="summary-card">
          <span>Set</span>
          <strong>${allenamentoAttivo.setIndex + 1} di ${allenamentoAttivo.superSerie.length}</strong>
        </div>
        <div class="summary-card">
          <span>Serie corrente</span>
          <strong>${allenamentoAttivo.serieCorrente} / ${currentSet.serieTotali}</strong>
        </div>
      </div>
      ${showDots ? `<div class="slider-dots">${dotsMarkup}</div>` : ""}
      <div class="workout-slider">
        <div class="workout-slider__track" id="workoutSliderTrack" style="transform: translateX(-${allenamentoAttivo.esercizioIndex * 100}%);">
          ${slidesMarkup}
        </div>
      </div>
    </div>
  `;

  updateWorkoutActionButton();
  updateFloatingIsland();
  attachWorkoutInputListeners();
}

function completeSet() {
  if (!allenamentoAttivo || allenamentoAttivo.completato) {
    return;
  }

  syncCurrentWorkoutInputs();

  const currentSet = allenamentoAttivo.superSerie[allenamentoAttivo.setIndex];
  const exercise = currentSet.esercizi[allenamentoAttivo.esercizioIndex];
  const repsInput = document.getElementById(`repsInput-${allenamentoAttivo.esercizioIndex}`);
  const weightInput = document.getElementById(`weightInput-${allenamentoAttivo.esercizioIndex}`);

  const repsValue = repsInput.value.trim();
  const weightValue = normalizeWeightValue(weightInput.value);
  const currentSeriesIndex = allenamentoAttivo.serieCorrente - 1;

  if (!repsValue || weightValue === "") {
    statusMessage.textContent = "Inserisci ripetizioni fatte e peso usato prima di completare il set.";
    return;
  }

  const historyKey = createHistoryKey(allenamentoAttivo.nome, currentSet.nome, exercise.nome, currentSeriesIndex);
  storicoEsercizi[historyKey] = {
    ripetizioni: repsValue,
    peso: weightValue
  };

  const isLastExerciseInSet = allenamentoAttivo.esercizioIndex >= currentSet.esercizi.length - 1;
  const isLastSeriesInSet = allenamentoAttivo.serieCorrente >= currentSet.serieTotali;
  const isLastWorkoutSet = allenamentoAttivo.setIndex >= allenamentoAttivo.superSerie.length - 1;

  if (!isLastExerciseInSet) {
    animateWorkoutTransition(allenamentoAttivo.esercizioIndex + 1, () => {
      allenamentoAttivo.esercizioIndex += 1;
      statusMessage.textContent = `Set salvato per ${exercise.nome}. Tocca ora a ${currentSet.esercizi[allenamentoAttivo.esercizioIndex].nome}.`;
      renderWorkoutMode();
      persistAppState();
    });
    return;
  }

  if (!isLastSeriesInSet) {
    animateWorkoutTransition(0, () => {
      allenamentoAttivo.serieCorrente += 1;
      allenamentoAttivo.esercizioIndex = 0;
      statusMessage.textContent = `Super serie completata. Inizia la serie ${allenamentoAttivo.serieCorrente}.`;
      renderWorkoutMode();
      persistAppState();
    });
    return;
  }

  if (!isLastWorkoutSet) {
    animateSetTransition(() => {
      allenamentoAttivo.setIndex += 1;
      allenamentoAttivo.serieCorrente = 1;
      allenamentoAttivo.esercizioIndex = 0;
      statusMessage.textContent = `Set completato. Passa a ${allenamentoAttivo.superSerie[allenamentoAttivo.setIndex].nome}.`;
      renderWorkoutMode();
      persistAppState();
    });
    return;
  }

  allenamentoAttivo.completato = true;
  statusMessage.textContent = `Allenamento ${allenamentoAttivo.nome} completato.`;
  renderWorkoutMode();
  persistAppState();
}

function closeWorkoutMode() {
  allenamentoAttivo = null;
  workoutActive = false;
  workoutMinimized = false;
  workoutModal.classList.add("hidden");
  unlockBodyScroll();
  floatingIsland.classList.add("hidden");
  renderWorkoutMode();
  persistAppState();
}

function minimizeWorkoutMode() {
  if (!allenamentoAttivo || allenamentoAttivo.completato) {
    return;
  }

  workoutMinimized = true;
  workoutModal.classList.add("hidden");
  unlockBodyScroll();
  updateFloatingIsland();
  persistAppState();
}

function reopenWorkoutMode() {
  if (!allenamentoAttivo) {
    return;
  }

  workoutMinimized = false;
  openWorkoutMode();
  persistAppState();
}

function openWorkoutMode() {
  workoutModal.classList.remove("hidden");
  lockBodyScroll();
  updateFloatingIsland();
}

function handleWorkoutAction() {
  if (!workoutActive || !allenamentoAttivo || allenamentoAttivo.completato) {
    return;
  }

  completeSet();
}

function handleWorkoutBack() {
  if (!workoutActive || !allenamentoAttivo || allenamentoAttivo.completato) {
    return;
  }

  syncCurrentWorkoutInputs();

  if (!goToPreviousWorkoutStep()) {
    return;
  }

  renderWorkoutMode();
  persistAppState();
}

function handleSkipSet() {
  if (!workoutActive || !allenamentoAttivo || allenamentoAttivo.completato) {
    return;
  }

  const confirmed = window.confirm("Vuoi saltare tutto il set corrente?");

  if (!confirmed) {
    return;
  }

  syncCurrentWorkoutInputs();

  const isLastWorkoutSet = allenamentoAttivo.setIndex >= allenamentoAttivo.superSerie.length - 1;

  if (isLastWorkoutSet) {
    animateSetTransition(() => {
      allenamentoAttivo.completato = true;
      statusMessage.textContent = `Allenamento ${allenamentoAttivo.nome} completato.`;
      renderWorkoutMode();
      persistAppState();
    });
    return;
  }

  animateSetTransition(() => {
    allenamentoAttivo.setIndex += 1;
    allenamentoAttivo.serieCorrente = 1;
    allenamentoAttivo.esercizioIndex = 0;
    statusMessage.textContent = `Set saltato. Passa a ${allenamentoAttivo.superSerie[allenamentoAttivo.setIndex].nome}.`;
    renderWorkoutMode();
    persistAppState();
  });
}

function updateWorkoutActionButton() {
  if (!workoutActive || !allenamentoAttivo || allenamentoAttivo.completato) {
    workoutActions.classList.add("hidden");
    return;
  }

  workoutActions.classList.remove("hidden");
  workoutBackButton.disabled = isWorkoutAtStart();
  workoutSkipSetButton.disabled = allenamentoAttivo.superSerie.length === 0;
  workoutActionButton.textContent = getWorkoutActionLabel();
}

function getWorkoutActionLabel() {
  if (!allenamentoAttivo) {
    return "Avanti";
  }

  const currentSet = allenamentoAttivo.superSerie[allenamentoAttivo.setIndex];
  const isLastExerciseInSet = allenamentoAttivo.esercizioIndex >= currentSet.esercizi.length - 1;
  const isLastSeriesInSet = allenamentoAttivo.serieCorrente >= currentSet.serieTotali;
  const isLastWorkoutSet = allenamentoAttivo.setIndex >= allenamentoAttivo.superSerie.length - 1;

  if (isLastExerciseInSet && isLastSeriesInSet && isLastWorkoutSet) {
    return "Concludi allenamento";
  }

  if (isLastExerciseInSet && isLastSeriesInSet) {
    return "Prossimo esercizio";
  }

  return "Avanti";
}

function updateFloatingIsland() {
  if (!(workoutActive === true && workoutMinimized === true) || !allenamentoAttivo) {
    document.body.classList.remove("body--floating-active");
    floatingIsland.classList.add("hidden");
    return;
  }

  const currentSet = allenamentoAttivo.superSerie[allenamentoAttivo.setIndex];
  const exercise = currentSet.esercizi[allenamentoAttivo.esercizioIndex];

  floatingIslandExercise.textContent = exercise.nome;
  floatingIslandSeries.textContent = `${allenamentoAttivo.serieCorrente}/${currentSet.serieTotali}`;
  document.body.classList.add("body--floating-active");
  floatingIsland.classList.remove("hidden");
}

function removeCurrentSheet() {
  schedaCorrente = null;
  storicoEsercizi = {};
  expandedWorkoutIndex = null;
  jsonFileInput.value = "";
  closeWorkoutMode();
  renderSheet();
  clearAppState();
}

function toggleWorkoutDetails(workoutIndex) {
  expandedWorkoutIndex = expandedWorkoutIndex === workoutIndex ? null : workoutIndex;
  renderSheet();
}

function syncAccordionHeights() {
  const accordionPanels = document.querySelectorAll(".accordion-panel");

  accordionPanels.forEach((panel) => {
    const panelIndex = Number(panel.dataset.workoutIndex);

    if (panelIndex === expandedWorkoutIndex) {
      panel.style.maxHeight = `${panel.scrollHeight}px`;
    } else {
      panel.style.maxHeight = "0px";
    }
  });
}

function animateWorkoutTransition(targetIndex, onComplete) {
  const sliderTrack = document.getElementById("workoutSliderTrack");

  if (!sliderTrack) {
    onComplete();
    return;
  }

  sliderTrack.style.transform = `translateX(-${targetIndex * 100}%)`;
  window.setTimeout(onComplete, 300);
}

function animateSetTransition(onComplete) {
  const currentContent = workoutContent.querySelector(".workout-content");

  if (!currentContent) {
    onComplete();
    return;
  }

  currentContent.classList.add("is-set-transition-out");

  window.setTimeout(() => {
    onComplete();

    const nextContent = workoutContent.querySelector(".workout-content");

    if (!nextContent) {
      return;
    }

    nextContent.classList.add("is-set-transition-in");
    window.requestAnimationFrame(() => {
      nextContent.classList.remove("is-set-transition-in");
    });
  }, 220);
}

function lockBodyScroll() {
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

  document.body.classList.add("modal-open");
  document.body.style.paddingRight = scrollbarWidth > 0 ? `${scrollbarWidth}px` : "";
}

function unlockBodyScroll() {
  document.body.classList.remove("modal-open");
  document.body.style.paddingRight = "";
}

async function restoreAppState() {
  const savedState = await loadAppState();

  if (!savedState) {
    updateImportState();
    renderSheet();
    return;
  }

  schedaCorrente = savedState.scheda ? normalizeProgramData(savedState.scheda) : null;
  storicoEsercizi = savedState.storico || {};

  const normalizedWorkoutState = normalizePersistedWorkoutState(savedState.workoutState);

  if (normalizedWorkoutState?.allenamentoAttivo && schedaCorrente) {
    allenamentoAttivo = normalizedWorkoutState.allenamentoAttivo;
    workoutActive = normalizedWorkoutState.workoutActive;
    workoutMinimized = normalizedWorkoutState.workoutMinimized;
  } else {
    allenamentoAttivo = null;
    workoutActive = false;
    workoutMinimized = false;
  }

  updateImportState();
  renderSheet();

  if (workoutActive && allenamentoAttivo) {
    renderWorkoutMode();

    if (workoutMinimized) {
      workoutModal.classList.add("hidden");
      updateFloatingIsland();
    } else {
      openWorkoutMode();
    }
  }
}

function createHistoryKey(workoutName, setName, exerciseName, seriesIndex) {
  return `${workoutName}::${setName}::${exerciseName}::${seriesIndex}`;
}

function formatValue(value) {
  return value ?? "-";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

restoreAppState();
