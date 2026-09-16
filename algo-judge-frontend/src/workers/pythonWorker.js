// =====================================
// PYTHON EXECUTION WORKER
// =====================================
//
// Runs user code with Pyodide OFF the main thread.
//
// This has to be a worker, not a convenience: an infinite loop in
// user code blocks its thread completely. On the main thread that
// freezes the whole tab with no way back. In a worker the page stays
// responsive and the host can terminate the worker to enforce a
// time limit.
//
// Protocol
//   in : { type: "init" }
//        { type: "run", id, code, cases: [{ id, input }] }
//   out: { type: "ready" } | { type: "init_error", message }
//        { type: "result", id, cases: [{ id, stdout, stderr, status }] }

// The Pyodide loader is imported from the package and bundled, but
// the runtime payload it pulls in - pyodide.asm.wasm, the asm module
// and python_stdlib.zip - is fetched at runtime from indexURL.
//
// That split is why public/pyodide/ exists: those files must be
// served as-is, untouched by the bundler, because Pyodide requests
// them itself by name. Only the loader goes through the bundler.

import { loadPyodide } from "pyodide";

const PYODIDE_INDEX_URL = "/pyodide/";

let pyodide = null;
let initPromise = null;


// =====================================
// HARNESS
// =====================================
//
// Wraps each execution so that:
//   - stdin is fed from the test input
//   - stdout/stderr are captured per case
//   - the user's globals are discarded between cases, so state
//     from one test cannot leak into the next
//   - SystemExit is treated as a normal end (sys.exit(0) is common)

const HARNESS = `
import sys, io, traceback

def __algojudge_run(source, stdin_text):
    stdin_buffer = io.StringIO(stdin_text)
    stdout_buffer = io.StringIO()
    stderr_buffer = io.StringIO()

    real_stdin, real_stdout, real_stderr = sys.stdin, sys.stdout, sys.stderr
    sys.stdin, sys.stdout, sys.stderr = stdin_buffer, stdout_buffer, stderr_buffer

    status = "ok"

    # A fresh namespace per case. __name__ is set so that the common
    # "if __name__ == '__main__':" guard fires.
    namespace = {"__name__": "__main__"}

    try:
        exec(compile(source, "solution.py", "exec"), namespace)
    except SystemExit:
        pass
    except BaseException:
        status = "runtime_error"
        traceback.print_exc(file=stderr_buffer)
    finally:
        sys.stdin, sys.stdout, sys.stderr = real_stdin, real_stdout, real_stderr

    return (stdout_buffer.getvalue(), stderr_buffer.getvalue(), status)
`;


async function init() {

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {

    pyodide = await loadPyodide({
      indexURL: PYODIDE_INDEX_URL,
    });

    await pyodide.runPythonAsync(HARNESS);

    return pyodide;

  })();

  return initPromise;

}


self.onmessage = async (event) => {

  const message = event.data;


  // =====================================
  // INIT
  // =====================================

  if (message.type === "init") {

    try {

      await init();

      self.postMessage({ type: "ready" });

    } catch (err) {

      self.postMessage({
        type: "init_error",
        message: String(err?.message || err),
      });

    }

    return;

  }


  // =====================================
  // RUN
  // =====================================

  if (message.type === "run") {

    const { id, code, cases } = message;

    try {

      await init();

    } catch (err) {

      self.postMessage({
        type: "init_error",
        message: String(err?.message || err),
      });

      return;

    }


    const runner = pyodide.globals.get("__algojudge_run");

    const results = [];


    for (const testCase of cases) {

      let stdout = "";
      let stderr;
      let status;

      try {

        const returned = runner(
          code,
          testCase.input ?? ""
        );

        // Python tuple -> JS array, then free the proxy.
        const values = returned.toJs();

        stdout = values[0];
        stderr = values[1];
        status = values[2];

        returned.destroy();

      } catch (err) {

        // A failure here is the harness itself breaking (for example
        // a SyntaxError raised by compile()), not the user's program
        // raising at runtime.
        status = "runtime_error";
        stderr = String(err?.message || err);

      }

      results.push({
        id: testCase.id,
        stdout,
        stderr,
        status,
      });

    }


    runner.destroy();


    self.postMessage({
      type: "result",
      id,
      cases: results,
    });

  }

};
