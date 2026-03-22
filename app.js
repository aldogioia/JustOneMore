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
workoutActionButton.addEventListener("click", handleWorkoutAction);

function handleFileImport(event) {
  const [file] = event.target.files;

  if (!file || schedaCorrente) {
    return;
  }

  const reader = new FileReader();

  reader.onload = (loadEvent) => {
    try {
      const parsedData = JSON.parse(loadEvent.target.result);
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
          <div class="accordion-panel" style="max-height: ${isExpanded ? "480px" : "0px"};">
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
        ripetizioni: esercizio.ripetizioni ?? "-"
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
  const historyKey = createHistoryKey(allenamentoAttivo.nome, currentSet.nome, exercise.nome);
  const history = storicoEsercizi[historyKey];
  const showDots = currentSet.esercizi.length > 1;
  const dotsMarkup = currentSet.esercizi
    .map((_, index) => `<span class="slider-dot ${index === allenamentoAttivo.esercizioIndex ? "is-active" : ""}"></span>`)
    .join("");
  const slidesMarkup = currentSet.esercizi
    .map((item, index) => {
      const itemHistory = storicoEsercizi[createHistoryKey(allenamentoAttivo.nome, currentSet.nome, item.nome)];
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
                <strong>${escapeHtml(String(item.ripetizioni))}</strong>
              </div>
            </div>

            <p class="history-box">${itemHistoryMarkup}</p>

            <div class="field-group">
              <label for="repsInput-${index}">Ripetizioni fatte</label>
              <input id="repsInput-${index}" type="number" min="0" inputmode="numeric" placeholder="Es. 10" ${index !== allenamentoAttivo.esercizioIndex ? "disabled" : ""}>
            </div>

            <div class="field-group">
              <label for="weightInput-${index}">Peso usato (kg)</label>
              <input id="weightInput-${index}" type="number" min="0" step="0.5" inputmode="decimal" placeholder="Es. 35" ${index !== allenamentoAttivo.esercizioIndex ? "disabled" : ""}>
            </div>
          </section>
        </article>
      `;
    })
    .join("");

  workoutContent.innerHTML = `
    <div class="workout-content">
      <p class="workout-progress">
        Super serie ${allenamentoAttivo.setIndex + 1} di ${allenamentoAttivo.superSerie.length}
      </p>
      <div class="summary-grid">
        <div class="summary-card">
          <span>Serie corrente</span>
          <strong>${allenamentoAttivo.serieCorrente} / ${currentSet.serieTotali}</strong>
        </div>
        <div class="summary-card">
          <span>Blocco attivo</span>
          <strong>${escapeHtml(currentSet.nome)}</strong>
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
}

function completeSet() {
  if (!allenamentoAttivo || allenamentoAttivo.completato) {
    return;
  }

  const currentSet = allenamentoAttivo.superSerie[allenamentoAttivo.setIndex];
  const exercise = currentSet.esercizi[allenamentoAttivo.esercizioIndex];
  const repsInput = document.getElementById(`repsInput-${allenamentoAttivo.esercizioIndex}`);
  const weightInput = document.getElementById(`weightInput-${allenamentoAttivo.esercizioIndex}`);

  const repsValue = repsInput.value.trim();
  const weightValue = weightInput.value.trim();

  if (!repsValue || !weightValue) {
    statusMessage.textContent = "Inserisci ripetizioni fatte e peso usato prima di completare il set.";
    return;
  }

  const historyKey = createHistoryKey(allenamentoAttivo.nome, currentSet.nome, exercise.nome);
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
    allenamentoAttivo.setIndex += 1;
    allenamentoAttivo.serieCorrente = 1;
    allenamentoAttivo.esercizioIndex = 0;
    statusMessage.textContent = `Set completato. Passa a ${allenamentoAttivo.superSerie[allenamentoAttivo.setIndex].nome}.`;
    renderWorkoutMode();
    persistAppState();
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
  updateFloatingIsland();
}

function handleWorkoutAction() {
  if (!workoutActive || !allenamentoAttivo || allenamentoAttivo.completato) {
    return;
  }

  completeSet();
}

function updateWorkoutActionButton() {
  if (!workoutActive || !allenamentoAttivo || allenamentoAttivo.completato) {
    workoutActions.classList.add("hidden");
    return;
  }

  workoutActions.classList.remove("hidden");
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
    floatingIsland.classList.add("hidden");
    return;
  }

  const currentSet = allenamentoAttivo.superSerie[allenamentoAttivo.setIndex];
  const exercise = currentSet.esercizi[allenamentoAttivo.esercizioIndex];

  floatingIslandExercise.textContent = exercise.nome;
  floatingIslandSeries.textContent = `${allenamentoAttivo.serieCorrente}/${currentSet.serieTotali}`;
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

function animateWorkoutTransition(targetIndex, onComplete) {
  const sliderTrack = document.getElementById("workoutSliderTrack");

  if (!sliderTrack) {
    onComplete();
    return;
  }

  sliderTrack.style.transform = `translateX(-${targetIndex * 100}%)`;
  window.setTimeout(onComplete, 300);
}

async function restoreAppState() {
  const savedState = await loadAppState();

  if (!savedState) {
    updateImportState();
    renderSheet();
    return;
  }

  schedaCorrente = savedState.scheda || null;
  storicoEsercizi = savedState.storico || {};

  if (savedState.workoutState?.allenamentoAttivo && schedaCorrente) {
    allenamentoAttivo = savedState.workoutState.allenamentoAttivo;
    workoutActive = savedState.workoutState.workoutActive === true;
    workoutMinimized = savedState.workoutState.workoutMinimized === true;
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

function createHistoryKey(workoutName, setName, exerciseName) {
  return `${workoutName}::${setName}::${exerciseName}`;
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
