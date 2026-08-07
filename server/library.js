import { originalLibrarySections } from "../data/original-library.js";
import { config } from "./config.js";
import { getLibraryContent } from "./repositories.js";

const cache = {
  loadedAt: 0,
  value: null
};

export function clearLibraryCache() {
  cache.loadedAt = 0;
  cache.value = null;
}

function videoEmbedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "youtube.com" || host === "youtu.be") {
    const id = host === "youtu.be" ? parsed.pathname.slice(1) : parsed.searchParams.get("v");
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }

  if (host === "vimeo.com") {
    const id = parsed.pathname.split("/").filter(Boolean).pop();
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }

  if (host.includes("zoom.us") && parsed.pathname.includes("/rec/")) return url;
  if (/\.(mp4|webm|mov)(\?|$)/i.test(parsed.pathname)) return url;
  return null;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeSections(sections, source) {
  const normalized = sections
    .map((section) => ({
      name: section.name,
      id: section.slug || slugify(section.name),
      items: (section.items || []).map((item, index) => ({
        id: String(item.id || `${section.name}-${item.title}-${index}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
        title: item.title,
        speaker: item.speaker || "",
        date: item.date || item.resource_date || "",
        url: item.url,
        type: item.type || item.itemType || item.item_type || "resource",
        embedUrl: videoEmbedUrl(item.url)
      }))
    }))
    .filter((section) => section.items.length);

  return {
    source,
    scrapedAt: new Date().toISOString(),
    sections: normalized,
    totalItems: normalized.reduce((total, section) => total + section.items.length, 0)
  };
}

function normalizeManagedSections(sections) {
  return normalizeSections(
    sections.map((section) => ({
      name: section.name,
      slug: section.slug,
      items: section.items.map((item) => ({
        id: item.id,
        title: item.title,
        speaker: item.speaker || "",
        date: item.resource_date || "",
        url: item.url,
        type: item.item_type || "resource"
      }))
    })),
    "admin"
  );
}

export function getOriginalLibrary() {
  return normalizeSections(originalLibrarySections, "original");
}

export async function getVirtualLibrary({ force = false } = {}) {
  const maxAgeMs = config.libraryCacheMinutes * 60 * 1000;
  if (!force && cache.value && Date.now() - cache.loadedAt < maxAgeMs) return cache.value;

  try {
    const managedSections = await getLibraryContent();
    if (managedSections.some((section) => section.items.length)) {
      cache.value = normalizeManagedSections(managedSections);
      if (cache.value.totalItems > 0) {
        cache.loadedAt = Date.now();
        return cache.value;
      }
    }
  } catch (error) {
    if (config.nodeEnv !== "production") {
      console.warn("Admin-managed library content unavailable:", error.message);
    }
  }

  cache.value = getOriginalLibrary();
  cache.loadedAt = Date.now();
  return cache.value;
}
