import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")

print("API Key found:", bool(api_key))

client = genai.Client(
    api_key=api_key
)

response = client.models.generate_content(
    model=os.getenv(
        "GEMINI_MODEL",
        "gemini-2.0-flash"
    ),
    contents="Reply with exactly: Gemini connection successful"
)

print(response.text)