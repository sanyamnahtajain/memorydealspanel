import { describe, expect, it } from "vitest";

import {
  isVideoSlideActive,
  MAX_VIDEOS_PER_PRODUCT,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_MB,
  isAcceptedVideoType,
  rejectVideo,
  videoExtensionForType,
} from "./video";

const file = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: "clip.mp4",
  type: "video/mp4",
  size: 1_000_000,
  ...over,
});

describe("accepted types", () => {
  it("takes what phones and laptops actually produce", () => {
    expect(isAcceptedVideoType("video/mp4")).toBe(true);
    expect(isAcceptedVideoType("video/webm")).toBe(true);
    // iPhone .mov — dropping this would reject most of the owner's uploads.
    expect(isAcceptedVideoType("video/quicktime")).toBe(true);
  });

  it("refuses everything else, including images and disguised files", () => {
    expect(isAcceptedVideoType("image/jpeg")).toBe(false);
    expect(isAcceptedVideoType("application/pdf")).toBe(false);
    expect(isAcceptedVideoType("video/x-msvideo")).toBe(false);
    expect(isAcceptedVideoType("")).toBe(false);
  });

  it("maps to a sane extension, defaulting rather than throwing", () => {
    expect(videoExtensionForType("video/mp4")).toBe("mp4");
    expect(videoExtensionForType("video/webm")).toBe("webm");
    expect(videoExtensionForType("video/quicktime")).toBe("mov");
    expect(videoExtensionForType("nonsense")).toBe("mp4");
  });
});

describe("rejectVideo", () => {
  it("accepts a normal clip", () => {
    expect(rejectVideo(file(), 0)).toBeNull();
  });

  it("rejects a wrong type", () => {
    expect(rejectVideo(file({ type: "image/png" }), 0)?.reason).toBe("type");
  });

  it("rejects an oversized clip and says how big it was", () => {
    const rejection = rejectVideo(file({ size: MAX_VIDEO_BYTES + 1 }), 0);
    expect(rejection?.reason).toBe("size");
    expect(rejection?.message).toContain(`${MAX_VIDEO_MB}MB`);
  });

  it("accepts a clip exactly at the ceiling — the limit is inclusive", () => {
    expect(rejectVideo(file({ size: MAX_VIDEO_BYTES }), 0)).toBeNull();
  });

  it("rejects once the product is full, BEFORE looking at the file", () => {
    // Count is checked first so a full product gives the useful message even
    // when the picked file is also the wrong type.
    const rejection = rejectVideo(
      file({ type: "image/png" }),
      MAX_VIDEOS_PER_PRODUCT,
    );
    expect(rejection?.reason).toBe("count");
  });
});

describe("isVideoSlideActive — only the on-screen clip may play", () => {
  // 3 photos then 2 clips: slides 0,1,2 are photos; 3 and 4 are the clips.
  const videoStart = 3;

  it("is true only for the clip whose own slide is showing", () => {
    expect(isVideoSlideActive(0, 3, videoStart)).toBe(true);
    expect(isVideoSlideActive(1, 4, videoStart)).toBe(true);
    expect(isVideoSlideActive(1, 3, videoStart)).toBe(false);
    expect(isVideoSlideActive(0, 4, videoStart)).toBe(false);
  });

  it("is false for every clip while a PHOTO is showing", () => {
    // The regression this guards: swiping from a playing clip back to a photo
    // must stop the audio.
    for (const photo of [0, 1, 2]) {
      expect(isVideoSlideActive(0, photo, videoStart)).toBe(false);
      expect(isVideoSlideActive(1, photo, videoStart)).toBe(false);
    }
  });

  it("handles a product with no photos at all (clips start at slide 0)", () => {
    expect(isVideoSlideActive(0, 0, 0)).toBe(true);
    expect(isVideoSlideActive(1, 0, 0)).toBe(false);
  });
});
