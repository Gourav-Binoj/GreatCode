// =====================================
// PENDING REVIEW BATCH
// =====================================
//
// One upload can yield several extracted questions. The user
// reviews them one at a time, which means navigating from Home
// to /review-problem and back. Home unmounts on that trip, so a
// plain useState list would come back empty and every question
// the user had not reviewed yet would be silently lost.
//
// sessionStorage is the right scope: it survives navigation and
// page reloads, and clears itself when the tab is closed.

export const REVIEW_BATCH_KEY = "algojudge.pendingReview";


export function loadReviewBatch() {

  try {

    const raw =
      sessionStorage.getItem(
        REVIEW_BATCH_KEY
      );

    if (!raw) {
      return [];
    }

    const parsed =
      JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed
      : [];

  } catch {

    return [];

  }

}


export function saveReviewBatch(questions) {

  try {

    if (
      !questions ||
      questions.length === 0
    ) {

      sessionStorage.removeItem(
        REVIEW_BATCH_KEY
      );

      return;

    }

    sessionStorage.setItem(
      REVIEW_BATCH_KEY,
      JSON.stringify(questions)
    );

  } catch {

    // Storage unavailable (private mode / quota exceeded).
    // Reviewing the current question still works.

  }

}


export function removeFromReviewBatch(tempId) {

  const remaining =
    loadReviewBatch().filter(
      (question) =>
        question.temp_id !== tempId
    );

  saveReviewBatch(remaining);

  return remaining;

}
