#!/usr/bin/env python3
"""
llm_parser_fixed.py

Single-file corrected parser for extracting programming problems
from documents and calling a Gemini LLM (google.genai) for structured
JSON extraction.

Features / fixes:
- Robust, clearer split patterns using re.MULTILINE.
- Balanced-brace JSON extraction (handles noisy LLM output).
- Better extract_section and sample test extraction regexes.
- Optional PDF text extraction helper (PyPDF2).
- Improved retry/backoff for LLM calls.
- CLI: parse a PDF or a text file and print results (JSON).
"""

from __future__ import annotations

import os
import re
import json
import time
import logging
import argparse
from typing import List, Optional, Tuple, Dict, Any

from pydantic import BaseModel, Field, ValidationError

# Optional dependency for PDF extraction
try:
    from PyPDF2 import PdfReader
except Exception:
    PdfReader = None  # type: ignore

# Gemini SDK
try:
    from google import genai
    from google.genai import types
except Exception:
    genai = None
    types = None

# ------------------------------------------------------------
# Logging
# ------------------------------------------------------------
logger = logging.getLogger("llm_parser")
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

# ------------------------------------------------------------
# Configuration (env)
# ------------------------------------------------------------
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

if not GEMINI_API_KEY:
    logger.warning("GEMINI_API_KEY is not configured. LLM calls will fail until provided.")

# ------------------------------------------------------------
# Data models (pydantic)
# ------------------------------------------------------------
class SampleTest(BaseModel):
    input: str
    output: str
    note: Optional[str] = None


class Problem(BaseModel):

    title: Optional[str] = Field(
        default=None,
        description="Short title of the problem"
    )

    statement: str = Field(
        default="",
        description="Complete problem statement"
    )

    constraints: Optional[str] = None

    input_spec: Optional[str] = None

    output_spec: Optional[str] = None

    sample_tests: List[SampleTest] = Field(
        default_factory=list
    )

    # Hidden test cases used by the code judge
    hidden_tests: List[SampleTest] = Field(
        default_factory=list
    )

    pages: List[Dict[str, Any]] = Field(
        default_factory=list
    )

    raw_chunk: Optional[str] = None

# ------------------------------------------------------------
# Split patterns (compiled once)
# ------------------------------------------------------------
SPLIT_PATTERNS = [
    r"^\s*Problem\s+\d+\s*[:.\-]?",     # Problem 1:
    r"^\s*Question\s+\d+\s*[:.\-]?",    # Question 1:
    r"^\s*Q\s*\d+\s*[:.\-]?",           # Q1:
    r"^\s*\d+\)\s+",                    # 1) Question
    r"^\s*\d+\.\s+",                    # 1. Question
]

# Build combined regex with multiline mode
split_regex = re.compile("|".join(f"(?:{p})" for p in SPLIT_PATTERNS), re.IGNORECASE | re.MULTILINE)


# ------------------------------------------------------------
# Document splitting
# ------------------------------------------------------------
def split_into_chunks(full_text: str) -> List[Tuple[int, int, str]]:
    """
    Split the full document into candidate problem chunks.
    Returns list of (start_char, end_char, chunk_text).
    """
    if not full_text:
        return []

    text = full_text.replace("\r\n", "\n")
    matches = list(split_regex.finditer(text))

    if not matches:
        # no clear headings -> treat entire text as one chunk
        return [(0, len(text), text.strip())]

    starts = [m.start() for m in matches]

    # if the first match is deep into the document, keep intro as a chunk
    if starts and starts[0] > 500:
        starts.insert(0, 0)

    chunks: List[Tuple[int, int, str]] = []
    for idx, start in enumerate(starts):
        end = starts[idx + 1] if idx + 1 < len(starts) else len(text)
        chunk = text[start:end].strip()
        if len(chunk) >= 30:
            chunks.append((start, end, chunk))

    if not chunks:
        chunks.append((0, len(text), text.strip()))

    return chunks


# ------------------------------------------------------------
# Prompt template (unchanged in spirit)
# ------------------------------------------------------------
PROMPT_TEMPLATE = """You are an expert programming problem extraction system.

Your task is to extract EXACTLY ONE programming problem from the text provided.

Return ONLY valid JSON.

Do not include Markdown or explanations. The JSON MUST follow exactly this structure:

{{
  "title": "string or null",
  "statement": "string",
  "constraints": "string or null",
  "input_spec": "string or null",
  "output_spec": "string or null",
  "sample_tests": [
    {{
      "input": "string",
      "output": "string",
      "note": "string or null"
    }}
  ],
  "pages": []
}}

RULES:
1. Extract information ONLY from the provided text.
2. Do NOT invent missing information.
3. Use null where the field is not present.
4. Keep sample input and output EXACTLY as written.
5. Remove repeated headers/footers.
6. If the text does NOT contain a valid programming problem, still extract useful info but do NOT invent anything.

TEXT TO PARSE:
--------------------
{chunk_text}
--------------------

Return ONLY the JSON object.
"""


def build_prompt_for_chunk(chunk_text: str, max_chars: int = 25000) -> str:
    if len(chunk_text) > max_chars:
        chunk_text = chunk_text[:max_chars]
    return PROMPT_TEMPLATE.format(chunk_text=chunk_text)


# ------------------------------------------------------------
# Gemini client and calls (with backoff)
# ------------------------------------------------------------
def get_gemini_client():
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is missing in environment.")
    if genai is None:
        raise RuntimeError("google-genai SDK not installed (google.genai).")
    return genai.Client(api_key=GEMINI_API_KEY)


def call_gemini(prompt: str, max_retries: int = 2, model: str = GEMINI_MODEL) -> str:
    """
    Call Gemini model; returns raw text output.
    """
    client = get_gemini_client()
    last_err = None
    for attempt in range(max_retries + 1):
        try:
            logger.info("Calling Gemini model: %s (attempt %d)", model, attempt + 1)
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    response_mime_type="application/json"
                )
            )
            # response may provide text attribute or as dictionary
            text = getattr(response, "text", None)
            if text is None:
                # try stringifying response
                text = str(response)
            if not text:
                raise RuntimeError("Gemini returned empty response")
            return text
        except Exception as exc:
            last_err = exc
            wait = 1 + attempt * 2
            logger.warning("Gemini attempt %d failed: %s (backoff %ds)", attempt + 1, exc, wait)
            time.sleep(wait)
    raise RuntimeError(f"Gemini requests failed after retries: {last_err}")


# ------------------------------------------------------------
# Robust JSON extraction from LLM text
# ------------------------------------------------------------
def _balanced_json_extract(text: str) -> Optional[str]:
    """
    Find the first balanced JSON object in text by scanning braces.
    Returns JSON substring or None.
    """
    if not text:
        return None
    # find first '{'
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if ch == "\\" and not escape:
            escape = True
            continue
        if ch == '"' and not escape:
            in_string = not in_string
        if not in_string:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    candidate = text[start:i + 1]
                    # quick validate
                    try:
                        json.loads(candidate)
                        return candidate
                    except Exception:
                        # continue scanning to next potential end
                        pass
        escape = False
    return None


def extract_json_from_text(text: str) -> str:
    """
    Clean LLM output and extract valid JSON object string.
    Raises ValueError if cannot find parsable JSON.
    """
    if not text:
        raise ValueError("Empty LLM response")

    cleaned = text.strip()

    # Remove leading/trailing triple-backtick blocks if present
    # Handles ```json ... ``` or ``` ... ```
    if cleaned.startswith("```"):
        # remove leading fence
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        # remove trailing fence
        cleaned = re.sub(r"\s*```$", "", cleaned)
        cleaned = cleaned.strip()

    # If the whole cleaned string is valid JSON, return it
    try:
        json.loads(cleaned)
        return cleaned
    except Exception:
        pass

    # Try balanced-brace extraction
    candidate = _balanced_json_extract(cleaned)
    if candidate:
        return candidate

    # Fallback: try to find first line that looks like JSON start and end by regex
    brace_match = re.search(r"\{[\s\S]*\}", cleaned)
    if brace_match:
        candidate = brace_match.group(0)
        try:
            json.loads(candidate)
            return candidate
        except Exception:
            pass

    raise ValueError("Could not extract valid JSON from LLM response")


# ------------------------------------------------------------
# Section & sample extraction helpers
# ------------------------------------------------------------
HEADER_NEXT = r"(?:\n\s*(?:Input|Output|Constraints|Example|Sample|Notes|Note|Explanation)\b\s*:?)"

def extract_section(text: str, section_name: str) -> Optional[str]:
    """
    Extract a named section (Input, Output, Constraints, etc.)
    Returns the captured content (trimmed) or None.
    """
    if not text:
        return None
    pattern = re.compile(
        rf"(?is)^\s*{re.escape(section_name)}\s*:?\s*(.+?)(?={HEADER_NEXT}|\n\s*\n|$)",
        re.IGNORECASE | re.MULTILINE,
    )
    m = pattern.search(text)
    if not m:
        return None
    value = m.group(1).strip()
    return value or None


def extract_sample_tests(text: str) -> List[SampleTest]:
    """
    Extract sample test pairs of Input/Output found in text.
    Returns a list of SampleTest objects.
    """
    samples: List[SampleTest] = []
    if not text:
        return samples

    # Normalize common separators and ensure labels have consistent form
    # We search for repeated Input ... Output ... blocks.
    pattern = re.compile(
        r"(?is)(?:Sample\s*(?:Input)?\s*:?\s*|^)\bInput\b\s*:?\s*(?P<input>.+?)\s*\bOutput\b\s*:?\s*(?P<output>.+?)(?=(?:\n\s*\bInput\b|\n\s*$))",
        re.IGNORECASE | re.DOTALL,
    )

    for m in pattern.finditer(text):
        inp = m.group("input").strip()
        out = m.group("output").strip()
        if inp or out:
            samples.append(SampleTest(input=inp, output=out))

    # If none matched, try a simpler pair search (Input: ... Output: ... once)
    if not samples:
        simple = re.search(r"(?is)\bInput\b\s*:?\s*(.+?)\s*\bOutput\b\s*:?\s*(.+)", text)
        if simple:
            inp = simple.group(1).strip()
            out = simple.group(2).strip()
            samples.append(SampleTest(input=inp, output=out))

    return samples


# ------------------------------------------------------------
# Parsing single chunk via LLM
# ------------------------------------------------------------
def parse_single_chunk_with_llm(chunk_text: str, retries: int = 1) -> Problem:
    prompt = build_prompt_for_chunk(chunk_text)
    last_err = None
    for attempt in range(retries + 1):
        try:
            raw = call_gemini(prompt)
            logger.info("LLM returned %d chars", len(raw))
            json_text = extract_json_from_text(raw)
            data = json.loads(json_text)

            # Normalize sample_tests and pages
            if data.get("sample_tests") is None:
                data["sample_tests"] = []

            problem = Problem(
                title=data.get("title"),
                statement=data.get("statement") or "",
                constraints=data.get("constraints"),
                input_spec=data.get("input_spec"),
                output_spec=data.get("output_spec"),
                sample_tests=data.get("sample_tests") or [],
                pages=data.get("pages") or [],
                raw_chunk=chunk_text[:4000],
            )
            return problem
        except (ValueError, json.JSONDecodeError, ValidationError) as err:
            last_err = err
            logger.warning("Parsing/validation failed (attempt %d): %s", attempt + 1, err)
            time.sleep(1)
        except Exception as err:
            last_err = err
            logger.exception("LLM call failed: %s", err)
            time.sleep(1)

    raise RuntimeError(f"Failed to parse chunk after retries: {last_err}")


# ------------------------------------------------------------
# Fallback heuristic parser (no LLM)
# ------------------------------------------------------------
def heuristic_fallback(chunk_text: str, start: int, end: int) -> Problem:
    lines = [ln.strip() for ln in chunk_text.splitlines() if ln.strip()]
    title = lines[0] if lines else None

    constraints = extract_section(chunk_text, "Constraints")
    input_spec = extract_section(chunk_text, "Input")
    output_spec = extract_section(chunk_text, "Output")
    samples = extract_sample_tests(chunk_text)

    statement = chunk_text
    if title and statement.startswith(title):
        statement = statement[len(title):].strip()

    return Problem(
        title=title,
        statement=statement,
        constraints=constraints,
        input_spec=input_spec,
        output_spec=output_spec,
        sample_tests=samples,
        pages=[{"start_char": start, "end_char": end}],
        raw_chunk=chunk_text[:4000],
    )


# ------------------------------------------------------------
# Parse list of chunks
# ------------------------------------------------------------
def parse_chunks_via_llm(chunks: List[Tuple[int, int, str]]) -> List[Problem]:
    results: List[Problem] = []
    for idx, (start, end, chunk) in enumerate(chunks):
        logger.info("Parsing chunk %d/%d", idx + 1, len(chunks))
        try:
            problem = parse_single_chunk_with_llm(chunk)
            if not problem.pages:
                problem.pages = [{"start_char": start, "end_char": end}]
            results.append(problem)
        except Exception as exc:
            logger.warning("LLM parsing failed for chunk %d: %s. Using heuristic fallback.", idx + 1, exc)
            problem = heuristic_fallback(chunk, start, end)
            results.append(problem)
    return results


# ------------------------------------------------------------
# Simple PDF text extractor (PyPDF2)
# ------------------------------------------------------------
def extract_text_from_pdf(path: str) -> Tuple[str, List[str]]:
    if PdfReader is None:
        raise RuntimeError("PyPDF2 is not installed. Install with 'pip install PyPDF2' to extract PDFs.")
    reader = PdfReader(path)
    pages_text: List[str] = []
    for p in reader.pages:
        try:
            pages_text.append(p.extract_text() or "")
        except Exception:
            pages_text.append("")
    full_text = "\n\n".join(pages_text)
    return full_text, pages_text


# ------------------------------------------------------------
# CLI entrypoint
# ------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Parse problems from PDF or text and optionally call Gemini.")
    parser.add_argument("--pdf", "-p", help="Path to PDF file to parse")
    parser.add_argument("--text", "-t", help="Path to plain text file to parse")
    parser.add_argument("--no-llm", action="store_true", help="Do not call LLM; use heuristic fallback only")
    parser.add_argument("--llm-retries", type=int, default=1, help="LLM call retries per chunk")
    args = parser.parse_args()

    if not args.pdf and not args.text:
        parser.error("Provide either --pdf or --text")

    if args.pdf:
        full_text, pages = extract_text_from_pdf(args.pdf)
    else:
        with open(args.text, "r", encoding="utf-8") as fh:
            full_text = fh.read()
        pages = []

    chunks = split_into_chunks(full_text)
    logger.info("Document split into %d chunks", len(chunks))

    if args.no_llm:
        problems = []
        for start, end, chunk in chunks:
            problems.append(heuristic_fallback(chunk, start, end))
    else:
        # set retries via CLI to each parse call
        problems = []
        for start, end, chunk in chunks:
            try:
                problems.append(parse_single_chunk_with_llm(chunk, retries=args.llm_retries))
            except Exception:
                logger.warning("Falling back for one chunk due to LLM failure.")
                problems.append(heuristic_fallback(chunk, start, end))

    # Print JSON array of problems
    out = [p.dict() for p in problems]
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()