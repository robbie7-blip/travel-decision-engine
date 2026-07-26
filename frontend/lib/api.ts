import type { Itinerary, TripBriefInput } from "./types";

export class ApiError extends Error {}

export async function generateItinerary(brief: TripBriefInput): Promise<Itinerary> {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(brief),
  });

  if (!response.ok) {
    let detail = `Request failed with status ${response.status}.`;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // response body wasn't JSON — keep the generic message
    }
    throw new ApiError(detail);
  }

  return response.json();
}
