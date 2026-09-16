// =====================================
// PYTHON RUNNER
// =====================================
//
// Main-thread side of the Pyodide worker. Owns the worker lifecycle
// and enforces the time limit.
//
// Enforcing a timeout is the reason the worker exists. Pyodide runs
// user code synchronously, so a `while True:` loop cannot be
// interrupted from inside — the only way out is terminating the
// worker. That costs the ~2s startup on the next run, which is the
// right trade for not hanging the tab.

export const DEFAULT_TIME_LIMIT_MS = 5000;

// Pyodide boots the CPython runtime and unpacks the stdlib, which is
// slow on a cold cache and must not be charged against the user's
// time limit.
const INIT_TIMEOUT_MS = 60000;


let worker = null;
let readyPromise = null;
let nextRunId = 1;


function createWorker() {

  // Module worker: Vite's dev server only supports module workers,
  // and the worker imports the Pyodide loader as an ES module.
  return new Worker(
    new URL(
      "../workers/pythonWorker.js",
      import.meta.url
    ),
    { type: "module" }
  );

}


// =====================================
// WARM UP
// =====================================
//
// Safe to call early (e.g. when the solver page mounts) so the
// runtime is already loaded by the time the user hits Run.

export function ensureRuntime() {

  if (readyPromise) {
    return readyPromise;
  }

  readyPromise = new Promise((resolve, reject) => {

    try {
      worker = createWorker();
    } catch (err) {
      reject(err);
      return;
    }

    const timer = setTimeout(() => {
      reject(
        new Error(
          "Python runtime took too long to load."
        )
      );
    }, INIT_TIMEOUT_MS);


    function onMessage(event) {

      if (event.data.type === "ready") {
        cleanup();
        resolve(worker);
      }

      if (event.data.type === "init_error") {
        cleanup();
        reject(
          new Error(
            event.data.message ||
            "Failed to start the Python runtime."
          )
        );
      }

    }


    function onError(err) {
      cleanup();
      reject(
        new Error(
          err.message ||
          "Failed to start the Python runtime."
        )
      );
    }


    function cleanup() {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    }


    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);

    worker.postMessage({ type: "init" });

  });


  // A failed boot must not be cached, or every later run reuses the
  // rejection and the user can never retry.
  readyPromise.catch(() => {
    readyPromise = null;
    worker = null;
  });


  return readyPromise;

}


// =====================================
// TERMINATE
// =====================================

export function terminateRuntime() {

  if (worker) {
    worker.terminate();
  }

  worker = null;
  readyPromise = null;

}


// =====================================
// RUN CASES
// =====================================
//
// Resolves to one result per case, in the order given:
//   { id, stdout, stderr, status }
//
// status: "ok" | "runtime_error" | "timeout"
//
// The time limit covers the whole batch. On timeout the worker is
// terminated and every case is reported as "timeout", because once
// the runtime is gone there is no way to know how far it got.

export async function runCases(
  code,
  cases,
  timeLimitMs = DEFAULT_TIME_LIMIT_MS
) {

  if (!cases || cases.length === 0) {
    return [];
  }

  const activeWorker = await ensureRuntime();

  const runId = nextRunId++;


  return new Promise((resolve, reject) => {

    const timer = setTimeout(() => {

      cleanup();

      // Only a terminate can stop a spinning interpreter.
      terminateRuntime();

      resolve(
        cases.map((testCase) => ({
          id: testCase.id,
          stdout: "",
          stderr: "",
          status: "timeout",
        }))
      );

    }, timeLimitMs);


    function onMessage(event) {

      const data = event.data;

      if (
        data.type === "result" &&
        data.id === runId
      ) {
        cleanup();
        resolve(data.cases);
      }

      if (data.type === "init_error") {
        cleanup();
        reject(
          new Error(
            data.message ||
            "Python runtime failed."
          )
        );
      }

    }


    function onError(err) {
      cleanup();
      reject(
        new Error(
          err.message ||
          "Python runtime crashed."
        )
      );
    }


    function cleanup() {
      clearTimeout(timer);
      activeWorker.removeEventListener("message", onMessage);
      activeWorker.removeEventListener("error", onError);
    }


    activeWorker.addEventListener("message", onMessage);
    activeWorker.addEventListener("error", onError);

    activeWorker.postMessage({
      type: "run",
      id: runId,
      code,
      cases,
    });

  });

}


// =====================================
// OUTPUT COMPARISON
// =====================================
//
// Judge-style comparison: trailing whitespace on each line and
// trailing blank lines are ignored, since they are invisible to the
// user and almost never meaningful. Everything else must match.

export function normalizeOutput(text) {

  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");

}


export function outputsMatch(actual, expected) {

  return (
    normalizeOutput(actual) ===
    normalizeOutput(expected)
  );

}
