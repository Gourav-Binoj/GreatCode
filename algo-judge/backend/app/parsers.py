import os
import re
from pdfplumber import open as pdf_open
import docx

def extract_text_from_file(path, filename):
    ext = filename.lower().split('.')[-1]
    if ext in ("txt", "text"):
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    if ext == "pdf":
        text_parts = []
        with pdf_open(path) as pdf:
            for p in pdf.pages:
                text_parts.append(p.extract_text() or "")
        return "\n".join(text_parts)
    if ext in ("docx", "doc"):
        doc = docx.Document(path)
        return "\n".join([p.text for p in doc.paragraphs])
    # Fallback: try reading as text
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()

def parse_sections(text):
    # Normalize newlines
    text = text.replace("\r\n", "\n")
    # Heuristic: title = first non-empty line
    lines = [ln.strip() for ln in text.split("\n")]
    title = ""
    for ln in lines:
        if ln:
            title = ln
            break

    # Find sample Input/Output pairs
    sample_pattern = re.compile(
        r"Input\s*:?\s*(?P<input>.+?)\n\s*Output\s*:?\s*(?P<output>.+?)(?=(\n\S+\s*:)|\Z)",
        re.IGNORECASE | re.DOTALL,
    )
    samples = []
    for m in sample_pattern.finditer(text):
        inp = m.group("input").strip()
        out = m.group("output").strip()
        samples.append({"input": inp, "output": out})

    # Extract constraints, input spec, output spec via simple regex blocks
    def extract_block(name):
        m = re.search(rf"{name}\s*:?\s*(.+?)(?=(\n\S+\s*:)|\Z)", text, re.IGNORECASE | re.DOTALL)
        return m.group(1).strip() if m else ""

    constraints = extract_block("Constraints")
    input_spec = extract_block("Input")
    output_spec = extract_block("Output")

    # Statement: everything up to first occurrence of Input/Output/Constraints/Example
    stop_match = re.search(r"\n\s*(Input|Output|Constraints|Example|Examples|Sample Input)\s*:?", text, re.IGNORECASE)
    if stop_match:
        statement = text[: stop_match.start()].strip()
        # remove title from statement if it repeats
        if title and statement.startswith(title):
            statement = statement[len(title) :].strip()
    else:
        # fallback: first 400-1000 chars as statement
        statement = text[:1200].strip()

    return {
        "title": title,
        "statement": statement,
        "constraints": constraints,
        "input_spec": text,
        "output_spec": text,
        "sample_tests": samples,
        "raw_text_snippet": text[:2000],
    }