import os
import json
import logging
from typing import List, Optional, Literal
import json
import time
from google import genai
from google.genai import types
from pydantic import BaseModel, Field, ValidationError


# ============================================================
# LOGGING
# ============================================================
GEMINI_MODEL = "gemini-2.5-flash"
logger = logging.getLogger(
    "gemini_parser"
)

logger.setLevel(
    logging.INFO
)


# ============================================================
# PYDANTIC MODELS
# ============================================================

Difficulty = Literal["Easy", "Medium", "Hard"]


class SampleTest(BaseModel):

    input: str

    output: str

    note: Optional[str] = None


class Problem(BaseModel):

    title: Optional[str] = None

    statement: str = Field(
        default="",
        description=(
            "Complete programming "
            "problem statement"
        )
    )

    constraints: Optional[str] = None

    input_spec: Optional[str] = None

    output_spec: Optional[str] = None

    sample_tests: List[SampleTest] = Field(
        default_factory=list
    )

    # A closed set rather than free text, so the value can drive the
    # UI badge directly and never needs normalising downstream.
    difficulty: Difficulty = Field(
        default="Medium",
        description=(
            "Estimated difficulty of the problem: "
            "Easy, Medium or Hard"
        )
    )


class ProblemsResponse(BaseModel):

    problems: List[Problem] = Field(
        default_factory=list
    )


# ============================================================
# GEMINI CONFIGURATION
# ============================================================

def get_gemini_client():

    api_key = os.getenv(
        "GEMINI_API_KEY"
    )

    if not api_key:

        raise RuntimeError(
            "GEMINI_API_KEY is not set "
            "in backend/.env"
        )


    return genai.Client(

        api_key=api_key

    )


# ============================================================
# MIME TYPE HELPER
# ============================================================

def get_correct_mime_type(

    filename: str,

    mime_type: Optional[str]

) -> str:

    extension = (
        filename
        .lower()
        .rsplit(
            ".",
            1
        )[-1]
        if "." in filename
        else ""
    )


    mime_map = {

        "pdf":
            "application/pdf",

        "txt":
            "text/plain",

        "docx":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

        "doc":
            "application/msword",

    }


    if extension in mime_map:

        return mime_map[
            extension
        ]


    if mime_type:

        return mime_type


    return (
        "application/octet-stream"
    )


# ============================================================
# EXTRACTION PROMPT
# ============================================================

EXTRACTION_PROMPT = """
You are an expert programming problem document analyzer.

You are given a document that may contain:

- One programming problem
- Multiple programming problems
- Programming problems mixed with explanations
- Assignments containing multiple questions
- Algorithm questions
- Data structure questions
- Competitive programming problems

Your task is to analyze the ENTIRE document carefully.

IMPORTANT:

Do NOT assume the document contains only one problem.

You must identify EVERY independent programming or algorithmic problem.

Determine the boundaries of problems SEMANTICALLY.

Do NOT split problems simply because you see:

- Example
- Sample Input
- Sample Output
- Constraints
- Explanation

Those sections usually belong to the SAME problem.

Only create a new problem when the document clearly introduces a new independent programming question.

For every problem extract:

1. title
2. complete problem statement
3. constraints
4. input specification
5. output specification
6. all sample input/output test cases
7. difficulty

DIFFICULTY:

Judge how hard the problem is to solve, using the same scale a
competitive-programming or interview-practice site would use.

- "Easy": direct simulation, basic loops, strings or arithmetic.
  A straightforward solution is obvious to most beginners.

- "Medium": needs a standard data structure or a well-known
  technique - sorting, hash maps, two pointers, binary search,
  basic graph traversal, simple dynamic programming.

- "Hard": needs non-obvious insight, an advanced algorithm, heavy
  optimisation, or the careful combination of several techniques.

Judge the problem itself, not how long the document is. If the
document already states a difficulty, use that instead of your own
estimate.

IMPORTANT RULES:

- Preserve the original meaning.
- Do not invent information.
- Do not merge independent problems.
- Do not split examples into separate problems.
- Keep constraints with the correct problem.
- Keep sample tests with the correct problem.
- If information is missing, return null.
- If there are no sample tests, return an empty array.
- Extract ALL independent programming problems.
- Ignore non-programming content such as introductions,
  instructions, grading information, page headers,
  page footers, and unrelated text.

Return ONLY valid JSON.

The JSON MUST exactly follow this structure:

{
  "problems": [
    {
      "title": "string or null",
      "statement": "string",
      "constraints": "string or null",
      "input_spec": "string or null",
      "output_spec": "string or null",
      "sample_tests": [
        {
          "input": "string",
          "output": "string",
          "note": "string or null"
        }
      ],
      "difficulty": "Easy" | "Medium" | "Hard"
    }
  ]
}

DO NOT return markdown.

DO NOT use ```json.

DO NOT explain anything.

Return JSON ONLY.
"""


# ============================================================
# EXTRACT JSON SAFELY
# ============================================================

def extract_json(

    response_text: str

) -> dict:

    response_text = (
        response_text
        .strip()
    )


    # --------------------------------------------
    # DIRECT JSON
    # --------------------------------------------

    try:

        return json.loads(
            response_text
        )

    except json.JSONDecodeError:

        pass


    # --------------------------------------------
    # REMOVE MARKDOWN FENCES
    # --------------------------------------------

    if response_text.startswith(
        "```"
    ):

        lines = (
            response_text
            .splitlines()
        )


        if lines:

            lines = lines[1:]


        if (
            lines
            and
            lines[-1].strip()
            == "```"
        ):

            lines = lines[:-1]


        cleaned = (
            "\n"
            .join(lines)
            .strip()
        )


        try:

            return json.loads(
                cleaned
            )

        except json.JSONDecodeError:

            pass


    # --------------------------------------------
    # FIND FIRST JSON OBJECT
    # --------------------------------------------

    start = response_text.find(
        "{"
    )

    end = response_text.rfind(
        "}"
    )


    if (
        start == -1
        or
        end == -1
        or
        end <= start
    ):

        raise ValueError(
            "Could not find JSON object "
            "in Gemini response"
        )


    candidate = (
        response_text[
            start:end + 1
        ]
    )


    return json.loads(
        candidate
    )


# ============================================================
# PARSE DOCUMENT WITH GEMINI
# ============================================================

async def parse_document_with_gemini(

    file_bytes: bytes,

    filename: str,

    mime_type: Optional[str] = None

) -> ProblemsResponse:

    client = get_gemini_client()


    # --------------------------------------------------------
    # MODEL
    # --------------------------------------------------------

    model_name = os.getenv(

        "GEMINI_MODEL",

        "gemini-2.5-flash"

    )


    # --------------------------------------------------------
    # MIME TYPE
    # --------------------------------------------------------

    correct_mime_type = (
        get_correct_mime_type(

            filename,

            mime_type

        )
    )


    logger.info(

        "Sending document to Gemini: %s",

        filename

    )


    logger.info(

        "Using MIME type: %s",

        correct_mime_type

    )


    try:

        response = (

            client.models.generate_content(

                model=model_name,

                contents=[

                    {

                        "role": "user",

                        "parts": [

                            {

                                "inline_data": {

                                    "mime_type":
                                        correct_mime_type,

                                    "data":
                                        file_bytes

                                }

                            },

                            {

                                "text":
                                    EXTRACTION_PROMPT

                            }

                        ]

                    }

                ],

                config=types.GenerateContentConfig(

                    temperature=0,

                    response_mime_type=
                        "application/json",

                    # Schema-enforced output. This also guarantees
                    # difficulty comes back as one of the three
                    # allowed values instead of free text.
                    response_schema=ProblemsResponse,

                )

            )

        )


    except Exception as e:

        logger.exception(

            "Gemini API request failed"

        )


        raise RuntimeError(

            "Gemini API request failed: "

            f"{str(e)}"

        )


    # ========================================================
    # SCHEMA-PARSED RESULT
    # ========================================================
    #
    # The SDK deserialises straight into ProblemsResponse when the
    # model honours the schema. The manual JSON path below stays as
    # a fallback for the case where .parsed comes back empty.

    parsed_response = getattr(response, "parsed", None)

    if isinstance(parsed_response, ProblemsResponse):

        logger.info(
            "Gemini returned %d problem(s) via schema",
            len(parsed_response.problems),
        )

        return parsed_response


    # ========================================================
    # GET RESPONSE TEXT
    # ========================================================

    response_text = getattr(

        response,

        "text",

        None

    )


    if not response_text:

        raise RuntimeError(

            "Gemini returned an empty response"

        )


    logger.info(

        "Gemini response received "

        "(%d characters)",

        len(response_text)

    )


    # ========================================================
    # PARSE JSON
    # ========================================================

    try:

        data = extract_json(

            response_text

        )


    except Exception as e:

        logger.error(

            "Invalid JSON returned by Gemini:\n%s",

            response_text[:2000]

        )


        raise RuntimeError(

            "Gemini returned invalid JSON: "

            f"{str(e)}"

        )


    # ========================================================
    # VALIDATE RESPONSE
    # ========================================================

    try:

        parsed = ProblemsResponse(

            problems=data.get(

                "problems",

                []

            )

        )


        return parsed


    except ValidationError as e:

        logger.error(

            "Gemini response validation failed: %s",

            str(e)

        )


        raise RuntimeError(

            "Gemini response validation failed: "

            f"{str(e)}"

        )
class HiddenTest(BaseModel):
    input: str
    expected_output: str


class HiddenTestsResponse(BaseModel):
    tests: List[HiddenTest] = Field(default_factory=list)


# ============================================================
# HIDDEN TEST GENERATION
# ============================================================

# Hard ceiling on the characters allowed in a single generated test
# input. Without this the model happily materialises max-constraint
# cases (e.g. n = 1000 integers), which costs tens of thousands of
# output tokens, takes minutes, and frequently truncates mid-string.
MAX_TEST_INPUT_CHARS = 400

# Transient, provider-side failures worth retrying.
_TRANSIENT_MARKERS = (
    "503",
    "UNAVAILABLE",
    "429",
    "RESOURCE_EXHAUSTED",
    "500",
    "INTERNAL",
    "deadline",
    "timeout",
)


def _is_transient(error: Exception) -> bool:
    text = str(error).lower()
    return any(m.lower() in text for m in _TRANSIENT_MARKERS)


def _build_hidden_test_prompt(problem: Problem, count: int) -> str:
    newline = chr(10)

    samples = newline.join(
        "Input:" + newline + t.input
        + newline + "Output:" + newline + t.output
        for t in problem.sample_tests
    ) or "(none provided)"

    return f"""You are an expert competitive-programming test-case generator.

Generate exactly {count} hidden test cases for the problem below.

Title:
{problem.title or "(untitled)"}

Problem Statement:
{problem.statement}

Constraints:
{problem.constraints or "(none stated)"}

Input Specification:
{problem.input_spec or "(none stated)"}

Output Specification:
{problem.output_spec or "(none stated)"}

Sample Tests:
{samples}

RULES:

- Every test must be a VALID input for THIS problem, obeying the stated
  constraints and the exact input format.
- expected_output must be the CORRECT output for its input. Compute it
  carefully. Do not guess.
- SIZE LIMIT: each "input" must be at most {MAX_TEST_INPUT_CHARS}
  characters. Never write out a maximum-sized case literally. To cover
  large/boundary behaviour, use the largest case that still fits the
  size limit.
- Cover a spread: typical cases, the minimum allowed size, edge cases,
  duplicates, negative values, and sorted/reversed orderings where the
  problem makes those meaningful.
- Do not restate the provided sample tests.
- Use real newline characters inside the strings; do not write escape
  sequences literally.
"""


def generate_hidden_tests(
    problem: Problem,
    count: int = 10,
    max_retries: int = 3,
) -> List[HiddenTest]:
    """
    Generate hidden test cases for a reviewed problem.

    Uses Gemini's native structured output (response_schema) so the SDK
    deserialises straight into HiddenTestsResponse. Raises RuntimeError
    with a user-presentable message if generation cannot succeed.
    """

    client = get_gemini_client()

    model_name = os.getenv("GEMINI_MODEL", GEMINI_MODEL)

    prompt = _build_hidden_test_prompt(problem, count)

    config = types.GenerateContentConfig(
        temperature=0.2,
        response_mime_type="application/json",
        response_schema=HiddenTestsResponse,
        # Test generation is a formatting task, not a reasoning task.
        # Thinking here burns latency and output budget for no gain.
        thinking_config=types.ThinkingConfig(thinking_budget=0),
        max_output_tokens=8192,
    )

    last_error: Optional[Exception] = None

    for attempt in range(1, max_retries + 1):

        try:
            logger.info(
                "Generating hidden tests for %r (attempt %d/%d)",
                problem.title,
                attempt,
                max_retries,
            )

            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=config,
            )

            parsed = response.parsed

            # .parsed is None when the model's JSON could not be
            # deserialised against the schema (usually truncation).
            if parsed is None:
                finish = None

                if response.candidates:
                    finish = response.candidates[0].finish_reason

                raise ValueError(
                    "Gemini did not return schema-valid JSON "
                    f"(finish_reason={finish})"
                )

            tests = [
                t for t in parsed.tests
                if t.input.strip() and t.expected_output.strip()
            ]

            if not tests:
                raise ValueError("Gemini returned zero usable tests")

            logger.info(
                "Generated %d hidden tests for %r",
                len(tests),
                problem.title,
            )

            # Fewer tests than requested is a weaker suite, not a
            # failure. Saving 7 good tests beats failing the save.
            return tests[:count]

        except Exception as e:
            last_error = e

            logger.warning(
                "Hidden test generation attempt %d/%d failed: %r",
                attempt,
                max_retries,
                e,
            )

            if attempt == max_retries:
                break

            # Back off on provider-side blips; retry parse failures
            # immediately since a fresh sample usually succeeds.
            if _is_transient(e):
                wait = 2 ** attempt
                logger.info("Gemini unavailable; retrying in %ds", wait)
                time.sleep(wait)

    if last_error is not None and _is_transient(last_error):
        raise RuntimeError(
            "Gemini is temporarily unavailable. "
            "Your problem was not saved - please try again in a moment."
        )

    raise RuntimeError(
        "Could not generate hidden tests for this problem: "
        f"{last_error}"
    )
