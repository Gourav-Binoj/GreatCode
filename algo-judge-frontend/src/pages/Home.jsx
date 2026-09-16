import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { supabase } from "../lib/supabase";

import {
  loadReviewBatch,
  saveReviewBatch,
} from "../lib/reviewBatch";

import { API_URL } from "../lib/api";

import "../App.css";




export default function Home() {

  const navigate = useNavigate();


  // =====================================
  // STATES
  // =====================================

  const [selectedFile, setSelectedFile] =
    useState(null);

  const [searchQuery, setSearchQuery] =
    useState("");

  // Saved questions from Supabase
  const [questions, setQuestions] =
    useState([]);

  // Extracted questions waiting for review.
  // Seeded from sessionStorage so questions left over from an
  // earlier extraction survive a trip through the review screen.
  const [extractedQuestions, setExtractedQuestions] =
    useState(loadReviewBatch);

  const [user, setUser] =
    useState(null);

  const [loading, setLoading] =
    useState(false);

  const [loadingQuestions, setLoadingQuestions] =
    useState(true);

  const [error, setError] =
    useState("");


  // =====================================
  // LOAD SAVED QUESTIONS
  // =====================================

  async function loadQuestions(userId) {

    if (!userId) {

      setQuestions([]);

      setLoadingQuestions(false);

      return;

    }

    try {

      setLoadingQuestions(true);

      setError("");

      const {
        data,
        error,
      } = await supabase
        .from("problems")
        .select(`
          id,
          title,
          difficulty,
          created_at
        `)
        .eq(
          "user_id",
          userId
        )
        .order(
          "created_at",
          {
            ascending: false,
          }
        );


      if (error) {

        throw error;

      }


      const formattedQuestions =
        (data || []).map(
          (problem) => ({

            id:
              problem.id,

            title:
              problem.title,

            difficulty:
              problem.difficulty ||
              "Medium",

            solved:
              false,

            created_at:
              problem.created_at,

          })
        );


      setQuestions(
        formattedQuestions
      );


    } catch (err) {

      console.error(
        "Failed to load saved questions:",
        err
      );

      setError(
        err.message ||
        "Failed to load saved questions."
      );

    } finally {

      setLoadingQuestions(false);

    }

  }


  // =====================================
  // AUTH INITIALIZATION
  // =====================================

  useEffect(() => {

    async function initialize() {

      setLoadingQuestions(true);


      const {
        data,
        error,
      } =
        await supabase.auth.getSession();


      if (error) {

        console.error(
          "Session error:",
          error
        );

      }


      const currentUser =
        data.session?.user || null;


      setUser(
        currentUser
      );


      if (currentUser) {

        await loadQuestions(
          currentUser.id
        );

      } else {

        setQuestions([]);

        setLoadingQuestions(false);

      }

    }


    initialize();


    // =====================================
    // AUTH LISTENER
    // =====================================

    const {
      data: authListener,
    } =
      supabase.auth.onAuthStateChange(
        async (
          event,
          session
        ) => {

          const currentUser =
            session?.user || null;


          console.log(
            "Auth event:",
            event
          );


          setUser(
            currentUser
          );


          if (currentUser) {

            await loadQuestions(
              currentUser.id
            );

          } else {

            setQuestions([]);

            setLoadingQuestions(false);

          }

        }
      );


    return () => {

      authListener
        .subscription
        .unsubscribe();

    };

  }, []);


  // =====================================
  // GOOGLE SIGN IN
  // =====================================

  async function signInWithGoogle() {

    setError("");


    try {

      const {
        error,
      } =
        await supabase.auth.signInWithOAuth({

          provider:
            "google",

          options: {

            redirectTo:
              window.location.origin,

          },

        });


      if (error) {

        throw error;

      }


    } catch (err) {

      console.error(
        "Google sign in error:",
        err
      );


      setError(

        err.message ||

        "Failed to sign in with Google."

      );

    }

  }


  // =====================================
  // SIGN OUT
  // =====================================

  async function signOut() {

    try {

      const {
        error,
      } =
        await supabase.auth.signOut();


      if (error) {

        throw error;

      }


      setUser(null);

      setQuestions([]);

      setExtractedQuestions([]);

      // Do not leave another user's extracted questions
      // sitting in this tab's storage.
      saveReviewBatch([]);


    } catch (err) {

      console.error(
        "Sign out error:",
        err
      );


      setError(
        err.message ||
        "Failed to sign out."
      );

    }

  }


  // =====================================
  // FILE CHANGE
  // =====================================

  function handleFileChange(event) {

    const file =
      event.target.files?.[0];


    if (!file) {

      return;

    }


    setSelectedFile(
      file
    );


    setError("");

  }


  // =====================================
  // UPLOAD + EXTRACT QUESTIONS
  // =====================================

  async function handleUpload() {

    setError("");


    // =====================================
    // CHECK FILE
    // =====================================

    if (!selectedFile) {

      setError(
        "Please select a file first."
      );

      return;

    }


    // =====================================
    // CHECK USER
    // =====================================

    if (!user) {

      setError(
        "Please sign in before uploading."
      );

      return;

    }


    setLoading(
      true
    );


    try {

      console.log(
        "Uploading file:",
        selectedFile
      );


      // =====================================
      // CREATE FORM DATA
      // =====================================

      const formData =
        new FormData();


      formData.append(
        "file",
        selectedFile
      );


      // =====================================
      // GET ACCESS TOKEN
      // =====================================

      const {
        data: sessionData,
      } =
        await supabase.auth.getSession();


      const token =
        sessionData.session
          ?.access_token;


      if (!token) {

        throw new Error(
          "Authentication token not found. Please sign in again."
        );

      }


      // =====================================
      // SEND FILE TO BACKEND
      // =====================================

      const response =
        await fetch(

          `${API_URL}/upload-file`,

          {

            method:
              "POST",

            headers: {

              Authorization:
                `Bearer ${token}`,

            },

            body:
              formData,

          }

        );


      // =====================================
      // HANDLE BACKEND ERROR
      // =====================================

      if (!response.ok) {

        const errorData =
          await response
            .json()
            .catch(
              () => null
            );


        throw new Error(

          errorData?.detail ||

          `Upload failed with status ${response.status}`

        );

      }


      // =====================================
      // GET RESPONSE
      // =====================================

      const data =
        await response.json();


      console.log(
        "Backend response:",
        data
      );


      // =====================================
      // GET PROBLEMS
      // =====================================

      let problems = [];


      if (
        Array.isArray(
          data.problems
        )
      ) {

        problems =
          data.problems;

      }


      // =====================================
      // FALLBACK SINGLE PROBLEM
      // =====================================

      else if (

        data.title ||

        data.statement

      ) {

        problems =
          [data];

      }


      // =====================================
      // VALIDATE
      // =====================================

      if (
        problems.length === 0
      ) {

        throw new Error(
          "No programming questions were found in this file."
        );

      }


      // =====================================
      // CREATE REVIEW QUESTIONS
      // =====================================

      const reviewQuestions =
        problems.map(
          (
            problem,
            index
          ) => ({

            temp_id:
              `extract-${Date.now()}-${index}`,

            title:
              problem.title ||
              `Question ${index + 1}`,

            statement:
              problem.statement ||
              "",

            constraints:
              problem.constraints ||
              "",

            input_spec:
              problem.input_spec ||
              "",

            output_spec:
              problem.output_spec ||
              "",

            sample_tests:
              problem.sample_tests ||
              [],

            storage_path:

              data.storage_path ||

              problem.storage_path ||

              "",

            difficulty:
              problem.difficulty ||
              "Medium",

          })
        );


      // =====================================
      // STORE FOR REVIEW
      // =====================================

      setExtractedQuestions(
        reviewQuestions
      );

      saveReviewBatch(
        reviewQuestions
      );


      // =====================================
      // CLEAR FILE
      // =====================================

      setSelectedFile(
        null
      );


      console.log(
        "Questions ready for review:",
        reviewQuestions
      );


    } catch (err) {

      console.error(
        "Upload error:",
        err
      );


      setError(

        err.message ||

        "Something went wrong while uploading the file."

      );

    } finally {

      setLoading(
        false
      );

    }

  }


  // =====================================
  // REVIEW QUESTION
  // =====================================

  function reviewQuestion(question) {

    navigate(

      "/review-problem",

      {

        state: {

          problem:
            question,

          isReview:
            true,

        },

      }

    );

  }


  // =====================================
  // OPEN SAVED QUESTION
  // =====================================

  function openQuestion(question) {

    navigate(

      `/problem/${question.id}`

    );

  }


  // =====================================
  // FILTER QUESTIONS
  // =====================================

  const filteredQuestions =
    questions.filter(
      (question) =>

        question.title
          ?.toLowerCase()
          .includes(
            searchQuery.toLowerCase()
          )

    );


  // =====================================
  // UI
  // =====================================

  return (

    <div className="app">


      {/* ===================================== */}
      {/* HEADER */}
      {/* ===================================== */}

      <header className="header">


        {/* LOGO */}

        <div className="logo">

          <span className="logo-icon">

            ⌘

          </span>


          <span className="logo-text">

            GreatCode

          </span>

        </div>


        {/* USER */}

        <div className="header-right">


          {user ? (

            <>

              <span className="welcome-text">

                Welcome,{" "}

                {user.email}

              </span>


              <div className="profile-avatar">

                {user.email
                  ?.charAt(0)
                  ?.toUpperCase() ||
                  "U"}

              </div>


              <button

                onClick={
                  signOut
                }

                style={{

                  marginLeft:
                    "12px",

                  padding:
                    "8px 12px",

                  border:
                    "1px solid #ddd",

                  borderRadius:
                    "6px",

                  cursor:
                    "pointer",

                  background:
                    "white",

                }}

              >

                Sign Out

              </button>

            </>

          ) : (

            <button

              onClick={
                signInWithGoogle
              }

              style={{

                padding:
                  "10px 16px",

                border:
                  "none",

                borderRadius:
                  "8px",

                cursor:
                  "pointer",

                background:
                  "#ffffff",

                color:
                  "#111827",

                fontWeight:
                  "600",

              }}

            >

              Sign in with Google

            </button>

          )}

        </div>


      </header>


      {/* ===================================== */}
      {/* MAIN */}
      {/* ===================================== */}

      <main className="main-container">


        {/* ===================================== */}
        {/* HERO */}
        {/* ===================================== */}

        <section className="hero-section">

          <div className="hero-content">


            <h1>

              Practice. Code. Improve.

            </h1>


            <p>

              Upload programming questions and
              solve them in your own coding
              workspace.

            </p>


            {/* ===================================== */}
            {/* UPLOAD CARD */}
            {/* ===================================== */}

            <div className="upload-card">


              <div className="upload-icon">

                ↑

              </div>


              <h2>

                Upload Programming Questions

              </h2>


              <p>

                Upload PDF, DOCX or TXT files and
                automatically extract programming
                problems.

              </p>


              {/* FILE INPUT */}

              <div className="file-upload-row">


                <label className="file-button">


                  <input

                    type="file"

                    accept=".txt,.pdf,.doc,.docx"

                    onChange={
                      handleFileChange
                    }

                  />


                  Choose File


                </label>


                <span className="file-name">

                  {selectedFile

                    ? selectedFile.name

                    : "No file selected"

                  }

                </span>


              </div>


              {/* ERROR */}

              {error && (

                <div

                  style={{

                    color:
                      "#dc2626",

                    marginTop:
                      "15px",

                    fontSize:
                      "14px",

                  }}

                >

                  {error}

                </div>

              )}


              {/* UPLOAD BUTTON */}

              <button

                className="upload-button"

                onClick={
                  handleUpload
                }

                disabled={
                  loading
                }

              >

                {loading

                  ? "Extracting Questions..."

                  : "Upload & Extract Questions"

                }

              </button>


            </div>


          </div>

        </section>


        {/* ===================================== */}
        {/* EXTRACTED QUESTIONS */}
        {/* ===================================== */}

        {extractedQuestions.length > 0 && (

          <section

            className="questions-section"

            style={{

              marginBottom:
                "40px",

            }}

          >


            <div className="questions-header">


              <div>


                <h2>

                  Extracted Questions

                </h2>


                <p>

                  {extractedQuestions.length}

                  {" "}

                  question(s) extracted.

                  Review and save the questions
                  you want to keep.

                </p>


              </div>


            </div>


            <div className="question-list">


              {extractedQuestions.map(

                (
                  question,
                  index
                ) => (

                  <div

                    key={
                      question.temp_id
                    }

                    className="question-card"

                    onClick={
                      () =>
                        reviewQuestion(
                          question
                        )
                    }

                  >


                    <div className="question-left">


                      <div className="question-number">

                        {index + 1}

                      </div>


                      <div className="question-info">


                        <h3>

                          {question.title}

                        </h3>


                        <span>

                          Extracted — Not saved yet

                        </span>


                      </div>


                    </div>


                    <div className="question-right">


                      <span

                        style={{

                          color:
                            "#f59e0b",

                          fontSize:
                            "14px",

                          fontWeight:
                            "600",

                        }}

                      >

                        Review

                      </span>


                      <span className="arrow">

                        →

                      </span>


                    </div>


                  </div>

                )

              )}


            </div>


          </section>

        )}


        {/* ===================================== */}
        {/* SAVED QUESTIONS */}
        {/* ===================================== */}

        <section className="questions-section">


          {/* HEADER */}

          <div className="questions-header">


            <div>


              <h2>

                Your Questions

              </h2>


              <p>

                {questions.length}

                {" "}

                question(s) saved

              </p>


            </div>


            {/* SEARCH */}

            <div className="search-box">


              <span>

                🔍

              </span>


              <input

                type="text"

                placeholder="Search questions"

                value={
                  searchQuery
                }

                onChange={
                  (event) =>
                    setSearchQuery(
                      event.target.value
                    )
                }

              />


            </div>


          </div>


          {/* QUESTION LIST */}

          <div className="question-list">


            {loadingQuestions ? (

              <div className="empty-state">

                Loading your questions...

              </div>

            ) : filteredQuestions.length === 0 ? (

              <div className="empty-state">


                {!user

                  ? "Please sign in to view and save your questions."

                  : questions.length === 0

                    ? "No saved questions yet. Upload a document and review the extracted questions."

                    : "No questions found."

                }


              </div>

            ) : (

              filteredQuestions.map(

                (
                  question,
                  index
                ) => (

                  <div

                    key={
                      question.id
                    }

                    className="question-card"

                    onClick={
                      () =>
                        openQuestion(
                          question
                        )
                    }

                  >


                    {/* LEFT */}

                    <div className="question-left">


                      <div

                        className={

                          question.solved

                            ? "solved-icon"

                            : "question-number"

                        }

                      >

                        {question.solved

                          ? "✓"

                          : index + 1

                        }

                      </div>


                      <div className="question-info">


                        <h3>

                          {question.title}

                        </h3>


                        <span>

                          Saved Problem

                        </span>


                      </div>


                    </div>


                    {/* RIGHT */}

                    <div className="question-right">


                      <span

                        className={

                          `difficulty ${(
                            question.difficulty ||
                            "medium"
                          ).toLowerCase()}`

                        }

                      >

                        {question.difficulty ||
                          "Medium"}

                      </span>


                      <span className="arrow">

                        →

                      </span>


                    </div>


                  </div>

                )

              )

            )}


          </div>


        </section>


      </main>


    </div>

  );

}