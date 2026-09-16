import {
  useParams,
  useNavigate,
} from "react-router-dom";

import {
  useState,
  useEffect,
  useRef,
} from "react";

import { supabase } from "../lib/supabase";

import CodeEditor from "../components/CodeEditor";

import {
  runCases,
  ensureRuntime,
  terminateRuntime,
  outputsMatch,
  normalizeOutput,
  DEFAULT_TIME_LIMIT_MS,
} from "../lib/pythonRunner";


const API_URL = "http://localhost:8000";


const STARTER_CODE = `# Read from standard input, print to standard output.
#
# Example:
#   n = int(input())
#   values = list(map(int, input().split()))
#   print(sum(values))

`;


// =====================================
// DRAFT PERSISTENCE
// =====================================
//
// Losing a half-written solution to an accidental refresh is the
// fastest way to make an editor feel untrustworthy, so drafts are
// kept per problem in localStorage.

function draftKey(problemId) {
  return `algojudge.draft.${problemId}`;
}


function loadDraft(problemId) {
  try {
    return localStorage.getItem(
      draftKey(problemId)
    );
  } catch {
    return null;
  }
}


function saveDraft(problemId, code) {
  try {
    localStorage.setItem(
      draftKey(problemId),
      code
    );
  } catch {
    // Quota or private mode: drafts are a convenience, not a
    // requirement. Editing continues to work.
  }
}


// =====================================
// SAMPLE TESTS
// =====================================

function parseSampleTests(problem) {

  try {

    const raw = problem?.sample_tests;

    if (Array.isArray(raw)) {
      return raw;
    }

    if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }

  } catch (err) {
    console.error(
      "Failed to parse sample tests:",
      err
    );
  }

  return [];

}


// =====================================
// DIFFICULTY COLOURS
// =====================================

const DIFFICULTY_COLORS = {
  Easy: "#22c55e",
  Medium: "#facc15",
  Hard: "#ef4444",
};


// =====================================
// STATUS COLOURS
// =====================================

function statusColor(status) {

  if (status === "Accepted") {
    return "#22c55e";
  }

  if (
    status === "Running" ||
    status === "Pending"
  ) {
    return "#9ca3af";
  }

  return "#ef4444";

}


export default function ProblemSolver() {

  const { id } = useParams();

  const navigate = useNavigate();


  // =====================================
  // PROBLEM
  // =====================================

  const [problem, setProblem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");


  // =====================================
  // EDITOR
  // =====================================

  const [code, setCode] = useState(STARTER_CODE);


  // =====================================
  // EXECUTION
  // =====================================

  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [activeTab, setActiveTab] = useState("tests");

  const [customInput, setCustomInput] = useState("");
  const [customResult, setCustomResult] = useState(null);

  const [sampleResults, setSampleResults] = useState([]);
  const [verdict, setVerdict] = useState(null);
  const [runtimeError, setRuntimeError] = useState("");

  const [runtimeStatus, setRuntimeStatus] =
    useState("loading");

  // Mirrors `code` so the async run handlers always execute the
  // latest text, even if the user keeps typing after clicking Run.
  const codeRef = useRef(code);

  useEffect(() => {
    codeRef.current = code;
  }, [code]);


  const sampleTests = parseSampleTests(problem);

  const busy = running || submitting;


  // =====================================
  // LOAD PROBLEM
  // =====================================

  useEffect(() => {

    async function loadProblem() {

      setLoading(true);
      setError("");

      try {

        const {
          data,
          error: supabaseError,
        } = await supabase
          .from("problems")
          .select("*")
          .eq("id", id)
          .single();

        if (supabaseError) {
          throw supabaseError;
        }

        if (!data) {
          throw new Error("Problem not found.");
        }

        setProblem(data);

        const draft = loadDraft(id);

        setCode(draft || STARTER_CODE);

      } catch (err) {

        console.error(
          "Failed to load problem:",
          err
        );

        setError(
          err.message ||
          "Failed to load problem."
        );

      } finally {

        setLoading(false);

      }

    }

    loadProblem();

  }, [id]);


  // =====================================
  // WARM UP THE PYTHON RUNTIME
  // =====================================
  //
  // Pyodide takes a couple of seconds to boot. Starting it as soon
  // as the page opens means Run is usually instant by the time the
  // user has finished writing something.

  useEffect(() => {

    let cancelled = false;

    ensureRuntime()
      .then(() => {
        if (!cancelled) {
          setRuntimeStatus("ready");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRuntimeStatus("error");
          setRuntimeError(
            err.message ||
            "Python runtime failed to load."
          );
        }
      });

    return () => {
      cancelled = true;

      // Free the interpreter when leaving the page.
      terminateRuntime();
    };

  }, []);


  // =====================================
  // PERSIST DRAFT
  // =====================================

  useEffect(() => {

    if (!id || loading) {
      return;
    }

    const timer = setTimeout(() => {
      saveDraft(id, code);
    }, 400);

    return () => clearTimeout(timer);

  }, [code, id, loading]);


  // =====================================
  // RUN - SAMPLE TESTS
  // =====================================

  async function handleRun() {

    setRunning(true);
    setVerdict(null);
    setRuntimeError("");
    setActiveTab("tests");

    try {

      if (sampleTests.length === 0) {
        setRuntimeError(
          "This problem has no sample tests. Use Custom Input to try your code."
        );
        setActiveTab("custom");
        return;
      }

      const cases = sampleTests.map((test, index) => ({
        id: index,
        input: test.input ?? "",
      }));

      const results = await runCases(
        codeRef.current,
        cases
      );

      setSampleResults(
        results.map((result, index) => {

          const expected =
            sampleTests[index]?.output ?? "";

          let status;

          if (result.status === "timeout") {
            status = "Time Limit Exceeded";
          } else if (result.status === "runtime_error") {
            status = "Runtime Error";
          } else if (
            outputsMatch(result.stdout, expected)
          ) {
            status = "Accepted";
          } else {
            status = "Wrong Answer";
          }

          return {
            index,
            status,
            input: sampleTests[index]?.input ?? "",
            expected,
            actual: result.stdout,
            stderr: result.stderr,
          };

        })
      );

      setRuntimeStatus("ready");

    } catch (err) {

      console.error("Run failed:", err);

      setRuntimeError(
        err.message ||
        "Failed to run your code."
      );

    } finally {

      setRunning(false);

    }

  }


  // =====================================
  // RUN - CUSTOM INPUT
  // =====================================

  async function handleRunCustom() {

    setRunning(true);
    setRuntimeError("");
    setCustomResult(null);
    setActiveTab("custom");

    try {

      const results = await runCases(
        codeRef.current,
        [{ id: 0, input: customInput }]
      );

      const result = results[0];

      setCustomResult({
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      });

      setRuntimeStatus("ready");

    } catch (err) {

      console.error("Run failed:", err);

      setRuntimeError(
        err.message ||
        "Failed to run your code."
      );

    } finally {

      setRunning(false);

    }

  }


  // =====================================
  // SUBMIT - HIDDEN TESTS
  // =====================================
  //
  // The browser runs the hidden inputs; the backend holds the
  // expected outputs and decides the verdict.

  async function handleSubmit() {

    setSubmitting(true);
    setVerdict(null);
    setRuntimeError("");
    setActiveTab("result");

    try {

      const {
        data: sessionData,
      } = await supabase.auth.getSession();

      const token =
        sessionData?.session?.access_token;

      if (!token) {
        throw new Error(
          "You are not signed in. Please sign in again."
        );
      }


      // ---------- fetch hidden inputs ----------

      const testsResponse = await fetch(
        `${API_URL}/problems/${id}/hidden-tests`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!testsResponse.ok) {

        const detail = await testsResponse
          .json()
          .catch(() => null);

        throw new Error(
          detail?.detail ||
          `Could not load hidden tests (status ${testsResponse.status}).`
        );

      }

      const testsData = await testsResponse.json();

      const hiddenTests = testsData.tests || [];

      if (hiddenTests.length === 0) {
        throw new Error(
          "This problem has no hidden tests to submit against."
        );
      }


      // ---------- run them locally ----------

      const results = await runCases(
        codeRef.current,
        hiddenTests.map((test) => ({
          id: test.id,
          input: test.input,
        })),
        DEFAULT_TIME_LIMIT_MS * 2
      );


      // ---------- ask the server to judge ----------

      const judgeResponse = await fetch(
        `${API_URL}/problems/${id}/judge`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            results: results.map((result) => ({
              id: result.id,
              output: result.stdout,
              status: result.status,
            })),
          }),
        }
      );

      if (!judgeResponse.ok) {

        const detail = await judgeResponse
          .json()
          .catch(() => null);

        throw new Error(
          detail?.detail ||
          `Judging failed (status ${judgeResponse.status}).`
        );

      }

      const judgement = await judgeResponse.json();

      setVerdict(judgement);

      // Surface the first failing case's stderr, which the server
      // cannot see but is usually what the user needs.
      const firstError = results.find(
        (result) => result.stderr
      );

      if (firstError) {
        setRuntimeError(firstError.stderr);
      }

      setRuntimeStatus("ready");

    } catch (err) {

      console.error("Submit failed:", err);

      setRuntimeError(
        err.message ||
        "Failed to submit your solution."
      );

    } finally {

      setSubmitting(false);

    }

  }


  // =====================================
  // RESET
  // =====================================

  function handleReset() {

    const confirmed = window.confirm(
      "Reset your code to the starter template? This cannot be undone."
    );

    if (!confirmed) {
      return;
    }

    setCode(STARTER_CODE);

  }


  // =====================================
  // LOADING / ERROR SCREENS
  // =====================================

  if (loading) {
    return (
      <Centered>Loading problem...</Centered>
    );
  }

  if (error) {
    return (
      <Centered>
        <h2>Something went wrong</h2>
        <p style={{ color: "#ef4444" }}>{error}</p>
        <button
          onClick={() => navigate("/")}
          style={buttonStyle("#374151")}
        >
          ← Back to Problems
        </button>
      </Centered>
    );
  }

  if (!problem) {
    return (
      <Centered>
        <h2>Problem not found</h2>
        <button
          onClick={() => navigate("/")}
          style={buttonStyle("#374151")}
        >
          ← Back to Problems
        </button>
      </Centered>
    );
  }


  // =====================================
  // MAIN UI
  // =====================================

  return (

    <div style={shell}>

      {/* ================= HEADER ================= */}

      <header style={header}>

        <button
          onClick={() => navigate("/")}
          style={{
            background: "transparent",
            border: "none",
            color: "#e5e7eb",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          ← Problem List
        </button>

        <strong
          style={{
            fontSize: "15px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {problem.title || "Untitled Problem"}
        </strong>

        <div
          style={{
            display: "flex",
            gap: "10px",
            alignItems: "center",
          }}
        >

          <RuntimeBadge status={runtimeStatus} />

          <button
            onClick={handleReset}
            disabled={busy}
            style={buttonStyle("#374151", busy)}
          >
            Reset
          </button>

          <button
            onClick={handleRun}
            disabled={busy}
            style={buttonStyle("#2563eb", busy)}
          >
            {running ? "Running..." : "▶ Run"}
          </button>

          <button
            onClick={handleSubmit}
            disabled={busy}
            style={buttonStyle("#22c55e", busy)}
          >
            {submitting ? "Judging..." : "Submit"}
          </button>

        </div>

      </header>


      {/* ================= BODY ================= */}

      <div style={body}>

        {/* ---------- DESCRIPTION ---------- */}

        <section style={descriptionPane}>

          <h2 style={{ marginTop: 0, marginBottom: "10px", fontSize: "19px" }}>
            {problem.title || "Untitled Problem"}
          </h2>

          <span
            style={{
              display: "inline-block",
              marginBottom: "20px",
              padding: "3px 12px",
              borderRadius: "999px",
              fontSize: "12px",
              fontWeight: 600,
              color:
                DIFFICULTY_COLORS[problem.difficulty] ||
                DIFFICULTY_COLORS.Medium,
              border: `1px solid ${
                DIFFICULTY_COLORS[problem.difficulty] ||
                DIFFICULTY_COLORS.Medium
              }`,
            }}
          >
            {problem.difficulty || "Medium"}
          </span>

          <Block title="Problem">
            {problem.statement}
          </Block>

          {problem.input_spec && (
            <Block title="Input">
              {problem.input_spec}
            </Block>
          )}

          {problem.output_spec && (
            <Block title="Output">
              {problem.output_spec}
            </Block>
          )}

          {problem.constraints && (
            <Block title="Constraints">
              {problem.constraints}
            </Block>
          )}

          {sampleTests.length > 0 && (
            <>
              <h3 style={blockTitle}>Examples</h3>

              {sampleTests.map((test, index) => (

                <div key={index} style={exampleBox}>

                  <div style={exampleLabel}>
                    Example {index + 1}
                  </div>

                  <div style={exampleLabel}>Input</div>
                  <pre style={pre}>{test.input}</pre>

                  <div style={exampleLabel}>Output</div>
                  <pre style={pre}>{test.output}</pre>

                  {test.note && (
                    <>
                      <div style={exampleLabel}>
                        Explanation
                      </div>
                      <p
                        style={{
                          margin: 0,
                          color: "#9ca3af",
                          fontSize: "13px",
                        }}
                      >
                        {test.note}
                      </p>
                    </>
                  )}

                </div>

              ))}
            </>
          )}

        </section>


        {/* ---------- EDITOR + CONSOLE ---------- */}

        <section style={editorPane}>

          <div style={editorHost}>
            <CodeEditor
              value={code}
              onChange={setCode}
            />
          </div>

          <div style={consolePane}>

            <div style={tabBar}>

              <Tab
                label="Test Cases"
                active={activeTab === "tests"}
                onClick={() => setActiveTab("tests")}
              />

              <Tab
                label="Custom Input"
                active={activeTab === "custom"}
                onClick={() => setActiveTab("custom")}
              />

              <Tab
                label="Result"
                active={activeTab === "result"}
                onClick={() => setActiveTab("result")}
              />

            </div>


            <div style={consoleBody}>

              {runtimeError && (
                <pre style={errorBox}>
                  {runtimeError}
                </pre>
              )}


              {/* ---------- SAMPLE TESTS ---------- */}

              {activeTab === "tests" && (

                sampleResults.length === 0 ? (

                  <Muted>
                    {sampleTests.length === 0
                      ? "This problem has no sample tests."
                      : `Run your code to check it against ${sampleTests.length} sample test(s).`}
                  </Muted>

                ) : (

                  sampleResults.map((result) => (

                    <div key={result.index} style={resultBox}>

                      <div
                        style={{
                          color: statusColor(result.status),
                          fontWeight: 600,
                          marginBottom: "8px",
                        }}
                      >
                        Case {result.index + 1} — {result.status}
                      </div>

                      <div style={exampleLabel}>Input</div>
                      <pre style={pre}>{result.input}</pre>

                      <div style={exampleLabel}>Expected</div>
                      <pre style={pre}>
                        {normalizeOutput(result.expected)}
                      </pre>

                      <div style={exampleLabel}>Your output</div>
                      <pre style={pre}>
                        {normalizeOutput(result.actual) ||
                          "(no output)"}
                      </pre>

                      {result.stderr && (
                        <>
                          <div style={exampleLabel}>Error</div>
                          <pre style={errorBox}>
                            {result.stderr}
                          </pre>
                        </>
                      )}

                    </div>

                  ))

                )

              )}


              {/* ---------- CUSTOM INPUT ---------- */}

              {activeTab === "custom" && (

                <div>

                  <div style={exampleLabel}>
                    Standard input
                  </div>

                  <textarea
                    value={customInput}
                    onChange={(e) =>
                      setCustomInput(e.target.value)
                    }
                    placeholder={"3\n1 2 3"}
                    spellCheck={false}
                    style={textarea}
                  />

                  <button
                    onClick={handleRunCustom}
                    disabled={busy}
                    style={{
                      ...buttonStyle("#2563eb", busy),
                      marginTop: "10px",
                    }}
                  >
                    {running
                      ? "Running..."
                      : "▶ Run with this input"}
                  </button>

                  {customResult && (

                    <div
                      style={{
                        ...resultBox,
                        marginTop: "14px",
                      }}
                    >

                      <div style={exampleLabel}>Output</div>
                      <pre style={pre}>
                        {customResult.stdout ||
                          "(no output)"}
                      </pre>

                      {customResult.status === "timeout" && (
                        <p style={{ color: "#ef4444" }}>
                          Time limit exceeded.
                        </p>
                      )}

                      {customResult.stderr && (
                        <>
                          <div style={exampleLabel}>
                            Error
                          </div>
                          <pre style={errorBox}>
                            {customResult.stderr}
                          </pre>
                        </>
                      )}

                    </div>

                  )}

                </div>

              )}


              {/* ---------- SUBMISSION RESULT ---------- */}

              {activeTab === "result" && (

                verdict ? (

                  <div>

                    <div
                      style={{
                        fontSize: "18px",
                        fontWeight: 700,
                        color: statusColor(verdict.verdict),
                        marginBottom: "6px",
                      }}
                    >
                      {verdict.verdict}
                    </div>

                    <div
                      style={{
                        color: "#9ca3af",
                        marginBottom: "14px",
                      }}
                    >
                      {verdict.passed} / {verdict.total} hidden
                      tests passed
                      {verdict.failed_test_number &&
                        ` — first failure on test ${verdict.failed_test_number}`}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "6px",
                      }}
                    >
                      {verdict.cases.map((testCase) => (
                        <span
                          key={testCase.test_number}
                          title={testCase.status}
                          style={{
                            padding: "4px 9px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            background: "#111827",
                            border: `1px solid ${statusColor(
                              testCase.status
                            )}`,
                            color: statusColor(
                              testCase.status
                            ),
                          }}
                        >
                          {testCase.test_number}
                        </span>
                      ))}
                    </div>

                    <p
                      style={{
                        color: "#6b7280",
                        fontSize: "12px",
                        marginTop: "16px",
                      }}
                    >
                      Hidden test inputs run in your browser; the
                      expected outputs stay on the server.
                    </p>

                  </div>

                ) : (

                  <Muted>
                    Submit to run your solution against the hidden
                    tests.
                  </Muted>

                )

              )}

            </div>

          </div>

        </section>

      </div>

    </div>

  );

}


// =====================================
// SMALL PRESENTATION HELPERS
// =====================================

function Centered({ children }) {
  return (
    <div
      style={{
        ...shell,
        justifyContent: "center",
        alignItems: "center",
        gap: "16px",
      }}
    >
      {children}
    </div>
  );
}


function Muted({ children }) {
  return (
    <p style={{ color: "#6b7280", margin: 0 }}>
      {children}
    </p>
  );
}


function Block({ title, children }) {
  return (
    <>
      <h3 style={blockTitle}>{title}</h3>
      <p
        style={{
          whiteSpace: "pre-wrap",
          lineHeight: 1.65,
          color: "#d1d5db",
          margin: "0 0 18px",
        }}
      >
        {children}
      </p>
    </>
  );
}


function Tab({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "9px 15px",
        background: "transparent",
        border: "none",
        borderBottom: active
          ? "2px solid #2563eb"
          : "2px solid transparent",
        color: active ? "#ffffff" : "#9ca3af",
        cursor: "pointer",
        fontSize: "13px",
      }}
    >
      {label}
    </button>
  );
}


function RuntimeBadge({ status }) {

  const map = {
    loading: ["#9ca3af", "Loading Python..."],
    ready: ["#22c55e", "Python ready"],
    error: ["#ef4444", "Runtime failed"],
  };

  const [color, label] = map[status] || map.loading;

  return (
    <span
      style={{
        fontSize: "12px",
        color,
        display: "flex",
        alignItems: "center",
        gap: "6px",
      }}
    >
      <span
        style={{
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          background: color,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );

}


// =====================================
// STYLES
// =====================================

const shell = {
  minHeight: "100vh",
  height: "100vh",
  background: "#1e1e1e",
  color: "#ffffff",
  fontFamily: "Inter, system-ui, sans-serif",
  display: "flex",
  flexDirection: "column",
};

const header = {
  height: "56px",
  flexShrink: 0,
  borderBottom: "1px solid #333",
  display: "flex",
  alignItems: "center",
  padding: "0 16px",
  gap: "12px",
  justifyContent: "space-between",
};

const body = {
  flex: 1,
  display: "flex",
  minHeight: 0,
  flexWrap: "wrap",
};

const descriptionPane = {
  flex: "1 1 380px",
  minWidth: "320px",
  overflowY: "auto",
  padding: "22px",
  borderRight: "1px solid #333",
};

const editorPane = {
  flex: "1 1 460px",
  minWidth: "320px",
  display: "flex",
  flexDirection: "column",
  minHeight: "420px",
};

const editorHost = {
  flex: "1 1 55%",
  minHeight: "220px",
  overflow: "hidden",
  borderBottom: "1px solid #333",
};

const consolePane = {
  flex: "1 1 45%",
  minHeight: "180px",
  display: "flex",
  flexDirection: "column",
  background: "#181818",
};

const tabBar = {
  display: "flex",
  borderBottom: "1px solid #333",
  flexShrink: 0,
};

const consoleBody = {
  flex: 1,
  overflowY: "auto",
  padding: "14px",
  fontSize: "13px",
};

const blockTitle = {
  fontSize: "13px",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  color: "#9ca3af",
  margin: "0 0 8px",
};

const exampleBox = {
  background: "#181818",
  border: "1px solid #333",
  borderRadius: "6px",
  padding: "12px",
  marginBottom: "12px",
};

const exampleLabel = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  color: "#6b7280",
  marginBottom: "4px",
};

const pre = {
  margin: "0 0 10px",
  padding: "8px 10px",
  background: "#0f0f0f",
  border: "1px solid #2a2a2a",
  borderRadius: "4px",
  fontSize: "12.5px",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  color: "#e5e7eb",
  overflowX: "auto",
};

const errorBox = {
  ...pre,
  color: "#fca5a5",
  borderColor: "#7f1d1d",
};

const resultBox = {
  background: "#111827",
  border: "1px solid #2a2a2a",
  borderRadius: "6px",
  padding: "12px",
  marginBottom: "12px",
};

const textarea = {
  width: "100%",
  minHeight: "90px",
  background: "#0f0f0f",
  color: "#e5e7eb",
  border: "1px solid #333",
  borderRadius: "4px",
  padding: "9px",
  fontSize: "12.5px",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  resize: "vertical",
  boxSizing: "border-box",
};

function buttonStyle(background, disabled = false) {
  return {
    padding: "8px 15px",
    background,
    border: "none",
    borderRadius: "5px",
    color: "#ffffff",
    fontSize: "13px",
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}
