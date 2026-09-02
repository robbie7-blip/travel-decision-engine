import Image from "next/image";
import { DestinationBanner } from "./DestinationBanner";
import { getDestinationPhoto } from "@/lib/destinations";

/** Picks a real photo when one has been fetched onto disk (see
 * scripts/fetch-destination-photos.mjs), falling back to the generated
 * banner otherwise - same call signature either way, so callers don't need
 * to know which one they're getting. */
export function DestinationHero({
  city,
  slug,
  compact = false,
  eyebrow = "DESTINATION GUIDE",
}: {
  city: string;
  slug: string;
  compact?: boolean;
  eyebrow?: string;
}) {
  const photo = getDestinationPhoto(slug);
  if (!photo) {
    return <DestinationBanner city={city} slug={slug} compact={compact} eyebrow={eyebrow} />;
  }

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: compact ? "1200 / 480" : "1200 / 420",
        borderRadius: compact ? 10 : 14,
        overflow: "hidden",
      }}
    >
      <Image
        src={photo.src}
        alt={`${city}`}
        fill
        style={{ objectFit: "cover" }}
        sizes={compact ? "(max-width: 700px) 100vw, 320px" : "(max-width: 800px) 100vw, 780px"}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          // Darkens both ends so the eyebrow label and city name stay
          // legible regardless of how bright the photo is at either edge
          // (a clear sky behind the label was unreadable without this).
          background:
            "linear-gradient(to bottom, rgba(20,16,10,0.45) 0%, rgba(20,16,10,0) 22%, rgba(20,16,10,0) 45%, rgba(20,16,10,0.65) 100%)",
        }}
      />
      {!compact && (
        <div
          className="font-ui"
          style={{
            position: "absolute",
            top: 24,
            left: 28,
            fontSize: 12,
            letterSpacing: "0.15em",
            color: "rgba(255,253,248,0.8)",
          }}
        >
          {eyebrow}
        </div>
      )}
      <div
        className="font-display"
        style={{
          position: "absolute",
          left: compact ? 18 : 30,
          bottom: compact ? 14 : 22,
          right: 16,
          fontWeight: 600,
          fontSize: compact ? 26 : 46,
          lineHeight: 1.1,
          color: "#fffdf8",
        }}
      >
        {city}
      </div>
    </div>
  );
}
