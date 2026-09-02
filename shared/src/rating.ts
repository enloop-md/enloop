import { z } from "zod";

/**
 * A tester's opinion of a step or of a whole case, one to five stars. Most
 * steps get none: the rating exists for the outliers — the step that was a
 * pleasure to execute and the one that was a chore — so that the next case
 * written for this project can be shaped by what its own testers thought
 * rather than by the contract alone. `null` everywhere means "not rated",
 * which is the ordinary state and says nothing.
 */
export const RATING_MAX = 5;

export const ratingSchema = z.number().int().min(1).max(RATING_MAX);

export type Rating = z.infer<typeof ratingSchema>;

/** One word per star count, for the places a row of stars does not fit. */
export const RATING_WORDS: Record<number, string> = {
  1: "bad",
  2: "poor",
  3: "fair",
  4: "good",
  5: "excellent",
};

/** `★★★★☆` — the same five glyphs everywhere a rating is printed. */
export function ratingStars(rating: number): string {
  const filled = Math.max(0, Math.min(RATING_MAX, Math.round(rating)));
  return "★".repeat(filled) + "☆".repeat(RATING_MAX - filled);
}

/** `★★★★☆ 4/5 (good)` — for reports and feedback files. */
export function describeRating(rating: number): string {
  const word = RATING_WORDS[rating];
  return `${ratingStars(rating)} ${rating}/${RATING_MAX}${word ? ` (${word})` : ""}`;
}

/** Four and five stars: the step is one to write the next ones like. */
export function isExemplaryRating(rating: number): boolean {
  return rating >= 4;
}

/** One and two stars: the step is one to rewrite and not to repeat. */
export function isPoorRating(rating: number): boolean {
  return rating <= 2;
}
