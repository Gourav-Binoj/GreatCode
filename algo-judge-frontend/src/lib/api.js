// =====================================
// BACKEND API BASE URL
// =====================================
//
// Single source of truth for where the FastAPI backend lives.
//
// Set VITE_API_URL at build time:
//   local dev  -> http://localhost:8000   (see .env)
//   production -> the deployed Render URL (set in Vercel)
//
// Vite inlines import.meta.env at BUILD time, not at runtime, so
// changing this value in Vercel requires a redeploy to take effect.

const configured = import.meta.env.VITE_API_URL;


// Falling back keeps `npm run dev` working for anyone who has not
// created a .env yet, rather than failing with requests to the
// literal string "undefined/upload-file".
const FALLBACK = "http://localhost:8000";


if (!configured && import.meta.env.PROD) {

  // A production build pointing at localhost would fail for every
  // visitor, so make the misconfiguration loud rather than silent.
  console.error(
    "VITE_API_URL is not set. This production build cannot reach " +
    "the backend. Set it in the Vercel project environment " +
    "variables and redeploy."
  );

}


// Trailing slashes are stripped so callers can always write
// `${API_URL}/upload-file` without producing a double slash.
export const API_URL =
  (configured || FALLBACK).replace(/\/+$/, "");
