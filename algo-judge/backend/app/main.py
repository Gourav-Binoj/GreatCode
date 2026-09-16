import os
import time
import urllib.parse
from pathlib import Path
from typing import List, Optional
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool


# ============================================================
# LOAD ENVIRONMENT VARIABLES
# ============================================================

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"

load_dotenv(dotenv_path=ENV_PATH, override=True)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")


# ============================================================
# IMPORTS AFTER ENV LOAD
# ============================================================

from .supabase_client import supabase
from .gemini_parser import (
    Problem,
    parse_document_with_gemini,
    generate_hidden_tests,
)


# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(
    title="Algo-Judge AI Problem Parser"
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# VERIFY SUPABASE TOKEN
# ============================================================

async def verify_supabase_token(bearer_token: str | None):

    if not SUPABASE_URL:
        raise HTTPException(
            status_code=500,
            detail="SUPABASE_URL not configured on the server"
        )

    if not SUPABASE_ANON_KEY:
        raise HTTPException(
            status_code=500,
            detail="SUPABASE_ANON_KEY not configured on the server"
        )

    if not bearer_token:
        raise HTTPException(
            status_code=401,
            detail="Missing Authorization token"
        )

    url = f"{SUPABASE_URL}/auth/v1/user"

    headers = {
        "Authorization": f"Bearer {bearer_token}",
        "apikey": SUPABASE_ANON_KEY,
    }

    try:

        async with httpx.AsyncClient() as client:

            resp = await client.get(
                url,
                headers=headers,
                timeout=10.0
            )

    except httpx.RequestError as e:

        raise HTTPException(
            status_code=500,
            detail=f"Could not verify authentication token: {str(e)}"
        )

    if resp.status_code != 200:

        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token"
        )

    return resp.json()


# ============================================================
# GET BEARER TOKEN
# ============================================================

def extract_bearer_token(
    authorization: str | None
) -> str | None:

    if not authorization:
        return None

    if not authorization.lower().startswith("bearer "):
        return None

    return authorization.split(
        " ",
        1
    )[1].strip()


# ============================================================
# UPLOAD + AI PARSE
# ============================================================

@app.post("/upload-file")
async def upload_file(

    file: UploadFile = File(...),

    authorization: str | None = Header(None),

):

    # --------------------------------------------------------
    # GET TOKEN
    # --------------------------------------------------------

    token = extract_bearer_token(
        authorization
    )


    # --------------------------------------------------------
    # VERIFY USER
    # --------------------------------------------------------

    user_info = await verify_supabase_token(
        token
    )

    user_id = user_info.get("id")

    if not user_id:

        raise HTTPException(
            status_code=401,
            detail="Could not determine authenticated user"
        )


    # --------------------------------------------------------
    # VALIDATE FILE NAME
    # --------------------------------------------------------

    filename = file.filename or "uploaded_file"

    suffix = Path(
        filename
    ).suffix.lower()


    allowed_extensions = {
        ".pdf",
        ".txt",
        ".docx",
        ".doc",
    }


    if suffix not in allowed_extensions:

        raise HTTPException(
            status_code=400,
            detail=(
                "Unsupported file type. "
                "Allowed: PDF, TXT, DOCX, DOC"
            )
        )


    # --------------------------------------------------------
    # READ FILE
    # --------------------------------------------------------

    contents = await file.read()

    if not contents:

        raise HTTPException(
            status_code=400,
            detail="Uploaded file is empty"
        )


    # --------------------------------------------------------
    # FILE SIZE LIMIT
    # --------------------------------------------------------

    MAX_FILE_SIZE = 10 * 1024 * 1024

    if len(contents) > MAX_FILE_SIZE:

        raise HTTPException(
            status_code=413,
            detail="File too large (max 10MB)"
        )


    # --------------------------------------------------------
    # SAVE ORIGINAL FILE TO SUPABASE STORAGE
    # --------------------------------------------------------

    safe_filename = urllib.parse.quote(
        filename,
        safe=""
    )

    storage_path = (
        f"{user_id}/"
        f"{int(time.time())}_"
        f"{safe_filename}"
    )


    try:

        supabase.storage.from_(
            "uploads"
        ).upload(

            path=storage_path,

            file=contents,

            file_options={
                "content-type": (
                    file.content_type
                    or "application/octet-stream"
                ),

                "upsert": "false",
            },

        )


    except Exception as e:

        raise HTTPException(

            status_code=500,

            detail=(
                "Storage upload failed: "
                f"{str(e)}"
            )

        )


    # --------------------------------------------------------
    # SEND DOCUMENT TO GEMINI
    # --------------------------------------------------------

    try:

        parsed_response = await parse_document_with_gemini(

            file_bytes=contents,

            filename=filename,

            mime_type=file.content_type

        )


    except Exception as e:

        raise HTTPException(

            status_code=500,

            detail=(
                "AI document parsing failed: "
                f"{str(e)}"
            )

        )


    # --------------------------------------------------------
    # CONVERT PYDANTIC MODELS TO DICTS
    # --------------------------------------------------------

    problems = [

        problem.model_dump()

        for problem in parsed_response.problems

    ]


    # --------------------------------------------------------
    # RETURN PROBLEMS
    # --------------------------------------------------------

    return {

        "ok": True,

        "filename": filename,

        "storage_path": storage_path,

        "storage_bucket": "uploads",

        "problem_count": len(problems),

        "problems": problems,

    }


# ============================================================
# FINALIZE SINGLE PROBLEM
# ============================================================
@app.post("/finalize-problem")
async def finalize_problem(
    payload: dict,
    authorization: Optional[str] = Header(default=None),
):
    """
    Save a reviewed problem and generate its hidden test cases.
    """

    token = extract_bearer_token(authorization)

    if not token:
        raise HTTPException(
            status_code=401,
            detail="Missing Authorization bearer token",
        )

    # ---------------------------------------------------------
    # 1. Verify logged-in user
    # ---------------------------------------------------------

    user = await verify_supabase_token(token)

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired authentication token",
        )

    user_id = user.get("id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Could not determine authenticated user",
        )

    # ---------------------------------------------------------
    # 2. Validate required fields
    # ---------------------------------------------------------

    title = (payload.get("title") or "").strip()
    statement = payload.get("statement") or ""
    constraints = payload.get("constraints") or ""
    input_spec = payload.get("input_spec") or ""
    output_spec = payload.get("output_spec") or ""
    sample_tests = payload.get("sample_tests") or []
    storage_path = payload.get("storage_path") or ""

    # Reviewer's choice wins; the model's estimate is only the default
    # the review screen was seeded with.
    difficulty = (payload.get("difficulty") or "Medium").strip().title()

    if difficulty not in ("Easy", "Medium", "Hard"):
        difficulty = "Medium"

    if not title:
        raise HTTPException(
            status_code=400,
            detail="Problem title is required",
        )

    # ---------------------------------------------------------
    # 3. Build Problem object for hidden-test generation
    # ---------------------------------------------------------

    try:
        problem_for_tests = Problem(
            title=title,
            statement=statement,
            constraints=constraints,
            input_spec=input_spec,
            output_spec=output_spec,
            sample_tests=sample_tests,
            difficulty=difficulty,
        )
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid problem data: {str(e)}",
        )

    # ---------------------------------------------------------
    # 4. Generate hidden tests
    # ---------------------------------------------------------

    try:
        print(f"Generating hidden tests for: {title}")

        # generate_hidden_tests is synchronous and network-bound. Calling
        # it directly would block the event loop for the whole Gemini
        # round-trip (plus retry backoff), freezing every other request.
        hidden_tests = await run_in_threadpool(
            generate_hidden_tests,
            problem_for_tests,
            count=10,
        )

        print(
            f"Generated {len(hidden_tests)} hidden tests "
            f"for: {title}"
        )

    except Exception as e:
        print("Hidden test generation failed:", repr(e))

        # generate_hidden_tests already raises a user-presentable
        # message; 503 tells the frontend this is worth retrying.
        message = str(e)

        is_upstream = "temporarily unavailable" in message.lower()

        raise HTTPException(
            status_code=503 if is_upstream else 502,
            detail=message,
        )

    # ---------------------------------------------------------
    # 5. Save problem
    # ---------------------------------------------------------

    insert_obj = {
        "user_id": user_id,
        "title": title,
        "statement": statement,
        "constraints": constraints or None,
        "input_spec": input_spec or None,
        "output_spec": output_spec or None,
        "sample_tests": sample_tests,
        "storage_path": storage_path or None,
        "difficulty": difficulty,
    }

    try:
        result = (
            supabase
            .table("problems")
            .insert(insert_obj)
            .execute()
        )

        # PostgREST returns a LIST of inserted rows (returning=representation).
        rows = result.data or []

        if not rows:
            raise Exception("Supabase returned no saved problem")

        saved_problem = rows[0]

        problem_id = saved_problem["id"]

        print(f"Problem saved successfully: {problem_id}")

    except Exception as e:
        print("Problem save failed:", repr(e))

        message = str(e)

        # Point at the migration instead of leaking a raw PostgREST
        # error, which is otherwise baffling. PostgREST words this
        # two different ways: "does not exist" when it reaches
        # Postgres, and PGRST204 "Could not find ... in the schema
        # cache" when it rejects the insert before that.
        if "difficulty" in message and (
            "does not exist" in message
            or "schema cache" in message
        ):
            raise HTTPException(
                status_code=500,
                detail=(
                    "The 'difficulty' column is missing from the "
                    "problems table. Run the migration in "
                    "backend/migrations/001_add_difficulty.sql."
                ),
            )

        raise HTTPException(
            status_code=500,
            detail=f"Failed to save problem: {message}",
        )

    # ---------------------------------------------------------
    # 6. Save hidden tests
    # ---------------------------------------------------------

    test_rows = [
        {
            "problem_id": problem_id,
            "input": test.input,
            "expected_output": test.expected_output,
            "is_hidden": True,
        }
        for test in hidden_tests
    ]

    try:
        supabase.table("problem_tests").insert(test_rows).execute()

        print(
            f"Saved {len(test_rows)} hidden tests "
            f"for problem {problem_id}"
        )

    except Exception as e:
        print("Hidden test database insert failed:", repr(e))

        # Remove the problem if hidden tests could not be saved.
        try:
            (
                supabase
                .table("problems")
                .delete()
                .eq("id", problem_id)
                .execute()
            )
        except Exception as cleanup_error:
            print(
                "Cleanup failed:",
                repr(cleanup_error)
            )

        raise HTTPException(
            status_code=500,
            detail=f"Failed to save hidden tests: {str(e)}",
        )

    # ---------------------------------------------------------
    # 7. Return saved problem
    # ---------------------------------------------------------

    return {
        "ok": True,
        "problem": saved_problem,
        "hidden_test_count": len(hidden_tests),
    }
# ============================================================
# GET ALL SAVED PROBLEMS
# ============================================================

@app.get("/problems")
async def get_problems(
    authorization: str | None = Header(None),
):

    # --------------------------------------------------------
    # GET TOKEN
    # --------------------------------------------------------

    token = None

    if (
        authorization
        and authorization.lower().startswith("bearer ")
    ):
        token = authorization.split(
            " ",
            1
        )[1].strip()


    # --------------------------------------------------------
    # VERIFY USER
    # --------------------------------------------------------

    user_info = await verify_supabase_token(token)

    user_id = user_info.get("id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Could not determine authenticated user"
        )


    # --------------------------------------------------------
    # FETCH USER PROBLEMS
    # --------------------------------------------------------

    try:

        result = (
            supabase
            .table("problems")
            .select(
                """
                id,
                title,
                statement,
                constraints,
                input_spec,
                output_spec,
                sample_tests,
                storage_path,
                created_at
                """
            )
            .eq(
                "user_id",
                user_id
            )
            .order(
                "created_at",
                desc=True
            )
            .execute()
        )


        return {
            "ok": True,
            "problems": result.data or []
        }


    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch problems: {str(e)}"
        )

# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():

    return {

        "ok": True,

        "message": (
            "Algo-Judge AI Parser is running"
        )

    }
 # ============================================================
# GET SINGLE PROBLEM
# ============================================================

@app.get("/problems/{problem_id}")
async def get_problem(
    problem_id: str,
    authorization: str | None = Header(None),
):

    # --------------------------------------------------------
    # GET TOKEN
    # --------------------------------------------------------

    token = None

    if (
        authorization
        and authorization.lower().startswith("bearer ")
    ):
        token = authorization.split(
            " ",
            1
        )[1].strip()


    # --------------------------------------------------------
    # VERIFY USER
    # --------------------------------------------------------

    user_info = await verify_supabase_token(token)

    user_id = user_info.get("id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Could not determine authenticated user"
        )


    # --------------------------------------------------------
    # FETCH PROBLEM
    # --------------------------------------------------------

    try:

        result = (
            supabase
            .table("problems")
            .select("*")
            .eq(
                "id",
                problem_id
            )
            .eq(
                "user_id",
                user_id
            )
            .single()
            .execute()
        )


        return {
            "ok": True,
            "problem": result.data
        }


    except Exception:

        raise HTTPException(
            status_code=404,
            detail="Problem not found"
        )

# ============================================================
# JUDGE SUPPORT
# ============================================================
#
# Execution happens in the browser (Pyodide). The backend's job is
# to hold the answer key: hidden INPUTS are handed out so the client
# can run them, but expected_output never leaves the server. The
# client posts back what its run produced and the comparison is done
# here.
#
# This is not tamper-proof - a determined user can post fabricated
# outputs - but it keeps hidden tests genuinely hidden, and it is the
# seam where real sandboxed server-side execution drops in later.


def _normalize_output(text: str) -> str:
    """
    Judge-style comparison: ignore trailing whitespace per line and
    trailing blank lines. Must stay in sync with normalizeOutput()
    in the frontend's pythonRunner.js.
    """

    lines = str(text or "").replace("\r\n", "\n").split("\n")

    return "\n".join(line.rstrip() for line in lines).rstrip("\n")


async def _require_owned_problem(problem_id: str, authorization):
    """
    Resolve the caller and confirm they own this problem.
    Returns (user_id, problem_row).
    """

    token = extract_bearer_token(authorization)

    user_info = await verify_supabase_token(token)

    user_id = user_info.get("id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Could not determine authenticated user",
        )

    try:
        result = (
            supabase
            .table("problems")
            .select("id,title,sample_tests")
            .eq("id", problem_id)
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load problem: {str(e)}",
        )

    rows = result.data or []

    if not rows:
        raise HTTPException(
            status_code=404,
            detail="Problem not found",
        )

    return user_id, rows[0]


@app.get("/problems/{problem_id}/hidden-tests")
async def get_hidden_test_inputs(
    problem_id: str,
    authorization: Optional[str] = Header(default=None),
):
    """
    Hidden test INPUTS only, so the client can execute them.
    expected_output is deliberately not selected.
    """

    await _require_owned_problem(problem_id, authorization)

    try:
        result = (
            supabase
            .table("problem_tests")
            .select("id,input")
            .eq("problem_id", problem_id)
            .eq("is_hidden", True)
            .order("created_at")
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load hidden tests: {str(e)}",
        )

    tests = result.data or []

    return {
        "ok": True,
        "count": len(tests),
        "tests": [
            {"id": t["id"], "input": t["input"]}
            for t in tests
        ],
    }


@app.post("/problems/{problem_id}/judge")
async def judge_submission(
    problem_id: str,
    payload: dict,
    authorization: Optional[str] = Header(default=None),
):
    """
    Compare client-produced outputs against the stored expected
    outputs and return a verdict.

    Expected payload:
      { "results": [ { "id": <test id>,
                       "output": "...",
                       "status": "ok" | "runtime_error" | "timeout" } ] }
    """

    await _require_owned_problem(problem_id, authorization)

    submitted = payload.get("results")

    if not isinstance(submitted, list):
        raise HTTPException(
            status_code=400,
            detail="Expected a 'results' array",
        )

    try:
        result = (
            supabase
            .table("problem_tests")
            .select("id,input,expected_output")
            .eq("problem_id", problem_id)
            .eq("is_hidden", True)
            .order("created_at")
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load hidden tests: {str(e)}",
        )

    expected_rows = result.data or []

    if not expected_rows:
        raise HTTPException(
            status_code=409,
            detail="This problem has no hidden tests to judge against",
        )

    by_id = {
        str(item.get("id")): item
        for item in submitted
        if isinstance(item, dict)
    }

    cases = []
    passed = 0
    verdict = "Accepted"
    first_failed = None

    for index, row in enumerate(expected_rows):

        test_id = str(row["id"])

        client_result = by_id.get(test_id)

        # A test the client never reported back cannot be a pass.
        if client_result is None:
            case_status = "Missing"
        else:
            run_status = client_result.get("status") or "ok"

            if run_status == "timeout":
                case_status = "Time Limit Exceeded"
            elif run_status == "runtime_error":
                case_status = "Runtime Error"
            elif _normalize_output(
                client_result.get("output")
            ) == _normalize_output(row["expected_output"]):
                case_status = "Accepted"
            else:
                case_status = "Wrong Answer"

        if case_status == "Accepted":
            passed += 1
        elif first_failed is None:
            first_failed = index + 1
            verdict = case_status

        cases.append({
            "test_number": index + 1,
            "status": case_status,
        })

    return {
        "ok": True,
        "verdict": verdict,
        "passed": passed,
        "total": len(expected_rows),
        "failed_test_number": first_failed,
        "cases": cases,
    }
