import {
  useLocation,
  useNavigate,
} from "react-router-dom";

import {
  useState,
} from "react";

import {
  supabase,
} from "../lib/supabase";

import {
  removeFromReviewBatch,
} from "../lib/reviewBatch";

import { API_URL } from "../lib/api";





// =====================================
// DIFFICULTY OPTIONS
// =====================================
//
// Colours match the badges on the problem list, so a question keeps
// the same visual identity from review through to the library.

const DIFFICULTY_OPTIONS = [
  {
    value: "Easy",
    label: "Easy",
    color: "#16a34a",
    tint: "#f0fdf4",
    border: "#bbf7d0",
  },
  {
    value: "Medium",
    label: "Medium",
    color: "#d97706",
    tint: "#fffbeb",
    border: "#fde68a",
  },
  {
    value: "Hard",
    label: "Hard",
    color: "#dc2626",
    tint: "#fef2f2",
    border: "#fecaca",
  },
];


export default function ProblemReview() {

  // ============================================
  // ROUTER
  // ============================================

  const location =
    useLocation();

  const navigate =
    useNavigate();


  // ============================================
  // GET EXTRACTED PROBLEM
  // ============================================

  const initialProblem =
    location.state?.problem;


  // ============================================
  // PROBLEM STATE
  // ============================================

  const [problem, setProblem] =
    useState(
      initialProblem || null
    );


  // ============================================
  // STATES
  // ============================================

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const [success, setSuccess] =
    useState("");


  // ============================================
  // NO PROBLEM FOUND
  // ============================================

  if (!problem) {

    return (

      <div
        style={{
          minHeight:
            "100vh",

          display:
            "flex",

          flexDirection:
            "column",

          alignItems:
            "center",

          justifyContent:
            "center",

          fontFamily:
            "Inter, sans-serif",

          gap:
            "20px",
        }}
      >

        <h2>
          No extracted problem found
        </h2>


        <p
          style={{
            color:
              "#666",
          }}
        >
          Please upload a document and
          extract questions first.
        </p>


        <button
          onClick={() =>
            navigate("/")
          }
          style={{
            padding:
              "10px 20px",

            cursor:
              "pointer",
          }}
        >

          ← Back to Home

        </button>

      </div>

    );

  }


  // ============================================
  // UPDATE PROBLEM FIELD
  // ============================================

  function updateProblem(
    field,
    value
  ) {

    setProblem(
      (previousProblem) => ({

        ...previousProblem,

        [field]:
          value,

      })
    );

  }


  // ============================================
  // UPDATE SAMPLE TEST
  // ============================================

  function updateSampleTest(
    index,
    field,
    value
  ) {

    setProblem(
      (previousProblem) => {

        const updatedTests =
          [
            ...(
              previousProblem
                .sample_tests ||
              []
            ),
          ];


        updatedTests[index] = {

          ...updatedTests[index],

          [field]:
            value,

        };


        return {

          ...previousProblem,

          sample_tests:
            updatedTests,

        };

      }
    );

  }


  // ============================================
  // ADD SAMPLE TEST
  // ============================================

  function addSampleTest() {

    setProblem(
      (previousProblem) => ({

        ...previousProblem,

        sample_tests: [

          ...(
            previousProblem
              .sample_tests ||
            []
          ),

          {

            input:
              "",

            output:
              "",

            note:
              "",

          },

        ],

      })
    );

  }


  // ============================================
  // REMOVE SAMPLE TEST
  // ============================================

  function removeSampleTest(
    index
  ) {

    setProblem(
      (previousProblem) => {

        const updatedTests =
          [
            ...(
              previousProblem
                .sample_tests ||
              []
            ),
          ];


        updatedTests.splice(
          index,
          1
        );


        return {

          ...previousProblem,

          sample_tests:
            updatedTests,

        };

      }
    );

  }


  // ============================================
  // DISCARD QUESTION
  // ============================================

  function discardQuestion() {

    const confirmed =
      window.confirm(
        "Discard this extracted question?"
      );


    if (!confirmed) {

      return;

    }


    // Discarding means this question is handled too,
    // so it must not come back as pending.
    removeFromReviewBatch(
      problem.temp_id
    );


    navigate("/");

  }


  // ============================================
  // SAVE QUESTION
  // ============================================

  async function saveQuestion() {

    setError("");

    setSuccess("");


    // ============================================
    // VALIDATION
    // ============================================

    if (
      !problem.title ||
      problem.title.trim() === ""
    ) {

      setError(
        "Please enter a problem title."
      );

      return;

    }


    if (
      !problem.statement ||
      problem.statement.trim() === ""
    ) {

      setError(
        "Please enter a problem statement."
      );

      return;

    }


    setSaving(true);


    try {

      // ============================================
      // GET AUTH TOKEN
      // ============================================

      const {
        data: sessionData,
      } =
        await supabase.auth.getSession();


      const token =
        sessionData.session
          ?.access_token;


      if (!token) {

        throw new Error(
          "You are not signed in. Please sign in again."
        );

      }


      // ============================================
      // CREATE PAYLOAD
      // ============================================

      const payload = {

        title:
          problem.title.trim(),

        statement:
          problem.statement || "",

        constraints:
          problem.constraints || "",

        input_spec:
          problem.input_spec || "",

        output_spec:
          problem.output_spec || "",

        sample_tests:
          problem.sample_tests || [],

        storage_path:
          problem.storage_path || "",

        difficulty:
          problem.difficulty || "Medium",

      };


      console.log(
        "Saving problem:",
        payload
      );


      // ============================================
      // SEND TO BACKEND
      // ============================================

      const response =
        await fetch(
          `${API_URL}/finalize-problem`,
          {

            method:
              "POST",

            headers: {

              "Content-Type":
                "application/json",

              Authorization:
                `Bearer ${token}`,

            },

            body:
              JSON.stringify(
                payload
              ),

          }
        );


      // ============================================
      // HANDLE ERROR
      // ============================================

      if (!response.ok) {

        const errorData =
          await response
            .json()
            .catch(
              () => null
            );


        throw new Error(

          errorData?.detail ||

          `Failed to save problem. Status: ${response.status}`

        );

      }


      // ============================================
      // RESPONSE
      // ============================================

      const data =
        await response.json();


      console.log(
        "Saved problem response:",
        data
      );


      setSuccess(
        "Question saved successfully!"
      );


      // ============================================
      // DROP THIS ONE FROM THE REVIEW BATCH
      // ============================================
      //
      // Only this question is done. Any other question
      // extracted from the same file must stay pending
      // so the user can still review it.

      const remaining =
        removeFromReviewBatch(
          problem.temp_id
        );


      console.log(
        "Questions still awaiting review:",
        remaining.length
      );


      // ============================================
      // WAIT BRIEFLY
      // THEN GO HOME
      // ============================================

      setTimeout(
        () => {

          navigate(
            "/"
          );

        },
        800
      );


    } catch (err) {

      console.error(
        "Save error:",
        err
      );


      setError(

        err.message ||

        "Something went wrong while saving the question."

      );

    } finally {

      setSaving(
        false
      );

    }

  }


  // ============================================
  // UI
  // ============================================

  return (

    <div
      style={{
        minHeight:
          "100vh",

        background:
          "linear-gradient(160deg, #eef2ff 0%, #f8fafc 45%, #f8fafc 100%)",

        fontFamily:
          "Inter, system-ui, sans-serif",

        padding:
          "30px",
      }}
    >


      {/* ============================================ */}
      {/* HEADER */}
      {/* ============================================ */}

      <div
        style={{
          maxWidth:
            "1000px",

          margin:
            "0 auto 30px auto",

          display:
            "flex",

          justifyContent:
            "space-between",

          alignItems:
            "center",
        }}
      >

        <button
          onClick={() =>
            navigate("/")
          }

          style={{
            background:
              "transparent",

            border:
              "none",

            cursor:
              "pointer",

            fontSize:
              "16px",

            color:
              "#555",
          }}
        >

          ← Back to Questions

        </button>


        <div
          style={{
            fontWeight: 600,
            fontSize: "13px",
            color: "#4338ca",
            background: "#e0e7ff",
            border: "1px solid #c7d2fe",
            borderRadius: "999px",
            padding: "6px 14px",
          }}
        >

          Review Extracted Question

        </div>

      </div>


      {/* ============================================ */}
      {/* MAIN CARD */}
      {/* ============================================ */}

      <div
        className="review-card"
        style={{
          maxWidth:
            "1000px",

          margin:
            "0 auto",

          background:
            "white",

          padding:
            "30px",

          borderRadius:
            "12px",

          boxShadow:
            "0 4px 20px rgba(0,0,0,0.08)",

          // Accent stripe: gives the card an edge of colour without
          // tinting the form fields, which need to stay readable.
          borderTop:
            "4px solid #4f46e5",
        }}
      >


        {/* ============================================ */}
        {/* TITLE */}
        {/* ============================================ */}

        <h1
          style={{
            marginTop:
              0,
          }}
        >

          Review & Edit Question

        </h1>


        <p
          style={{
            color:
              "#666",

            marginBottom:
              "30px",
          }}
        >

          Review the extracted content before
          saving it to your problem collection.

        </p>


        {/* ============================================ */}
        {/* ERROR */}
        {/* ============================================ */}

        {error && (

          <div
            style={{
              background:
                "#fee2e2",

              color:
                "#dc2626",

              padding:
                "12px",

              borderRadius:
                "6px",

              marginBottom:
                "20px",
            }}
          >

            {error}

          </div>

        )}


        {/* ============================================ */}
        {/* SUCCESS */}
        {/* ============================================ */}

        {success && (

          <div
            style={{
              background:
                "#dcfce7",

              color:
                "#16a34a",

              padding:
                "12px",

              borderRadius:
                "6px",

              marginBottom:
                "20px",
            }}
          >

            ✓ {success}

          </div>

        )}


        {/* ============================================ */}
        {/* TITLE */}
        {/* ============================================ */}

        <div
          style={{
            marginBottom:
              "20px",
          }}
        >

          <label>

            <strong>
              Problem Title
            </strong>

          </label>


          <input

            type="text"

            value={
              problem.title || ""
            }

            onChange={
              (event) =>
                updateProblem(
                  "title",
                  event.target.value
                )
            }

            placeholder=
              "Enter problem title"

            style={{
              width:
                "100%",

              padding:
                "12px",

              marginTop:
                "8px",

              border:
                "1px solid #ddd",

              borderRadius:
                "6px",

              fontSize:
                "16px",

              boxSizing:
                "border-box",
            }}

          />

        </div>


        {/* ============================================ */}
        {/* DIFFICULTY */}
        {/* ============================================ */}

        <div
          style={{
            marginBottom: "22px",
          }}
        >

          <label>
            <strong>Difficulty</strong>
          </label>

          <p
            style={{
              margin: "4px 0 10px",
              fontSize: "13px",
              color: "#64748b",
            }}
          >
            Estimated by the AI from the problem text. Change it if
            you disagree.
          </p>

          <div
            style={{
              display: "flex",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >

            {DIFFICULTY_OPTIONS.map((option) => {

              const selected =
                (problem.difficulty || "Medium") === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    updateProblem(
                      "difficulty",
                      option.value
                    )
                  }
                  style={{
                    padding: "9px 20px",
                    borderRadius: "999px",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: 600,
                    transition: "all 0.15s ease",
                    color: selected
                      ? "#ffffff"
                      : option.color,
                    background: selected
                      ? option.color
                      : option.tint,
                    border: `1px solid ${
                      selected ? option.color : option.border
                    }`,
                  }}
                >
                  {option.label}
                </button>
              );

            })}

          </div>

        </div>


        {/* ============================================ */}
        {/* STATEMENT */}
        {/* ============================================ */}

        <div
          style={{
            marginBottom:
              "20px",
          }}
        >

          <label>

            <strong>
              Problem Statement
            </strong>

          </label>


          <textarea

            value={
              problem.statement || ""
            }

            onChange={
              (event) =>
                updateProblem(
                  "statement",
                  event.target.value
                )
            }

            rows={10}

            placeholder=
              "Enter problem statement"

            style={{
              width:
                "100%",

              padding:
                "12px",

              marginTop:
                "8px",

              border:
                "1px solid #ddd",

              borderRadius:
                "6px",

              fontSize:
                "15px",

              lineHeight:
                "1.6",

              boxSizing:
                "border-box",

              resize:
                "vertical",
            }}

          />

        </div>


        {/* ============================================ */}
        {/* CONSTRAINTS + INPUT */}
        {/* ============================================ */}

        <div
          style={{
            display:
              "grid",

            gridTemplateColumns:
              "1fr 1fr",

            gap:
              "20px",

            marginBottom:
              "20px",
          }}
        >


          {/* CONSTRAINTS */}

          <div>

            <label>

              <strong>
                Constraints
              </strong>

            </label>


            <textarea

              value={
                problem.constraints || ""
              }

              onChange={
                (event) =>
                  updateProblem(
                    "constraints",
                    event.target.value
                  )
              }

              rows={6}

              placeholder=
                "Enter constraints"

              style={{
                width:
                  "100%",

                padding:
                  "12px",

                marginTop:
                  "8px",

                border:
                  "1px solid #ddd",

                borderRadius:
                  "6px",

                boxSizing:
                  "border-box",

                resize:
                  "vertical",
              }}

            />

          </div>


          {/* INPUT */}

          <div>

            <label>

              <strong>
                Input Specification
              </strong>

            </label>


            <textarea

              value={
                problem.input_spec || ""
              }

              onChange={
                (event) =>
                  updateProblem(
                    "input_spec",
                    event.target.value
                  )
              }

              rows={6}

              placeholder=
                "Enter input format"

              style={{
                width:
                  "100%",

                padding:
                  "12px",

                marginTop:
                  "8px",

                border:
                  "1px solid #ddd",

                borderRadius:
                  "6px",

                boxSizing:
                  "border-box",

                resize:
                  "vertical",
              }}

            />

          </div>

        </div>


        {/* ============================================ */}
        {/* OUTPUT */}
        {/* ============================================ */}

        <div
          style={{
            marginBottom:
              "30px",
          }}
        >

          <label>

            <strong>
              Output Specification
            </strong>

          </label>


          <textarea

            value={
              problem.output_spec || ""
            }

            onChange={
              (event) =>
                updateProblem(
                  "output_spec",
                  event.target.value
                )
            }

            rows={5}

            placeholder=
              "Enter output format"

            style={{
              width:
                "100%",

              padding:
                "12px",

              marginTop:
                "8px",

              border:
                "1px solid #ddd",

              borderRadius:
                "6px",

              boxSizing:
                "border-box",

              resize:
                "vertical",
            }}

          />

        </div>


        {/* ============================================ */}
        {/* SAMPLE TESTS */}
        {/* ============================================ */}

        <div
          style={{
            marginTop:
              "30px",
          }}
        >

          <div
            style={{
              display:
                "flex",

              justifyContent:
                "space-between",

              alignItems:
                "center",

              marginBottom:
                "20px",
            }}
          >

            <h2>
              Sample Tests
            </h2>


            <button
              type="button"

              onClick={
                addSampleTest
              }

              style={{
                padding:
                  "8px 15px",

                background:
                  "#2563eb",

                color:
                  "white",

                border:
                  "none",

                borderRadius:
                  "6px",

                cursor:
                  "pointer",
              }}
            >

              + Add Sample

            </button>

          </div>


          {/* ============================================ */}
          {/* SAMPLE LIST */}
          {/* ============================================ */}

          {(
            problem.sample_tests ||
            []
          ).length === 0 && (

            <div
              style={{
                padding:
                  "20px",

                background:
                  "#f8fafc",

                borderRadius:
                  "8px",

                color:
                  "#666",

                textAlign:
                  "center",
              }}
            >

              No sample tests extracted.

              <br />

              You can add one manually.

            </div>

          )}


          {(
            problem.sample_tests ||
            []
          ).map(
            (
              sample,
              index
            ) => (

              <div

                key={index}

                style={{
                  border:
                    "1px solid #e5e7eb",

                  borderRadius:
                    "8px",

                  padding:
                    "20px",

                  marginBottom:
                    "20px",

                  background:
                    "#fafafa",
                }}

              >


                {/* SAMPLE HEADER */}

                <div
                  style={{
                    display:
                      "flex",

                    justifyContent:
                      "space-between",

                    marginBottom:
                      "15px",
                  }}
                >

                  <strong>

                    Sample Test{" "}

                    {index + 1}

                  </strong>


                  <button

                    type="button"

                    onClick={
                      () =>
                        removeSampleTest(
                          index
                        )
                    }

                    style={{
                      background:
                        "#fee2e2",

                      color:
                        "#dc2626",

                      border:
                        "none",

                      padding:
                        "6px 12px",

                      borderRadius:
                        "5px",

                      cursor:
                        "pointer",
                    }}

                  >

                    Remove

                  </button>

                </div>


                {/* INPUT */}

                <div
                  style={{
                    marginBottom:
                      "15px",
                  }}
                >

                  <label>

                    <strong>
                      Input
                    </strong>

                  </label>


                  <textarea

                    rows={4}

                    value={
                      sample.input || ""
                    }

                    onChange={
                      (event) =>
                        updateSampleTest(

                          index,

                          "input",

                          event.target.value

                        )
                    }

                    style={{
                      width:
                        "100%",

                      padding:
                        "10px",

                      marginTop:
                        "6px",

                      fontFamily:
                        "monospace",

                      boxSizing:
                        "border-box",

                      border:
                        "1px solid #ddd",

                      borderRadius:
                        "6px",
                    }}

                  />

                </div>


                {/* OUTPUT */}

                <div
                  style={{
                    marginBottom:
                      "15px",
                  }}
                >

                  <label>

                    <strong>
                      Expected Output
                    </strong>

                  </label>


                  <textarea

                    rows={4}

                    value={
                      sample.output || ""
                    }

                    onChange={
                      (event) =>
                        updateSampleTest(

                          index,

                          "output",

                          event.target.value

                        )
                    }

                    style={{
                      width:
                        "100%",

                      padding:
                        "10px",

                      marginTop:
                        "6px",

                      fontFamily:
                        "monospace",

                      boxSizing:
                        "border-box",

                      border:
                        "1px solid #ddd",

                      borderRadius:
                        "6px",
                    }}

                  />

                </div>


                {/* NOTE */}

                <div>

                  <label>

                    Note (Optional)

                  </label>


                  <textarea

                    rows={2}

                    value={
                      sample.note || ""
                    }

                    onChange={
                      (event) =>
                        updateSampleTest(

                          index,

                          "note",

                          event.target.value

                        )
                    }

                    style={{
                      width:
                        "100%",

                      padding:
                        "10px",

                      marginTop:
                        "6px",

                      boxSizing:
                        "border-box",

                      border:
                        "1px solid #ddd",

                      borderRadius:
                        "6px",
                    }}

                  />

                </div>

              </div>

            )
          )}

        </div>


        {/* ============================================ */}
        {/* ACTION BUTTONS */}
        {/* ============================================ */}

        <div
          style={{
            display:
              "flex",

            justifyContent:
              "space-between",

            alignItems:
              "center",

            marginTop:
              "40px",

            paddingTop:
              "25px",

            borderTop:
              "1px solid #e5e7eb",
          }}
        >


          {/* DISCARD */}

          <button

            onClick={
              discardQuestion
            }

            disabled={
              saving
            }

            style={{
              padding:
                "12px 20px",

              background:
                "white",

              border:
                "1px solid #dc2626",

              color:
                "#dc2626",

              borderRadius:
                "6px",

              cursor:
                "pointer",

              fontWeight:
                "600",
            }}

          >

            Discard Question

          </button>


          {/* SAVE */}

          <button

            onClick={
              saveQuestion
            }

            disabled={
              saving
            }

            style={{
              padding:
                "12px 25px",

              background:
                saving
                  ? "#93c5fd"
                  : "#2563eb",

              color:
                "white",

              border:
                "none",

              borderRadius:
                "6px",

              cursor:
                saving
                  ? "not-allowed"
                  : "pointer",

              fontWeight:
                "600",

              fontSize:
                "15px",
            }}

          >

            {saving

              ? "Saving Question..."

              : "Save Question"

            }

          </button>

        </div>

      </div>

    </div>

  );

}