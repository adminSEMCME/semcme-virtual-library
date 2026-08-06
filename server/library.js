import { config } from "./config.js";
import { getLibraryContent } from "./repositories.js";

const SOURCE_URL = config.sourceUrl;
const cache = {
  loadedAt: 0,
  value: null
};

export function clearLibraryCache() {
  cache.loadedAt = 0;
  cache.value = null;
}

function isPasswordProtectedPage(html) {
  return /password protected|protected post|post_password|wp-login\.php\?action=postpass/i.test(html);
}

const fallbackSections = [
  {
    name: "Anesthesia",
    items: [
      {
        title: "City-Wide Grand Rounds Lecture: Evolution in Coronary Stent Technology",
        speaker: "Priya Kumar, MD, FASA",
        date: "December 17, 2025",
        url: "https://semcme.org/semcme-virtual-library/"
      }
    ]
  },
  {
    name: "AI in Medicine Series",
    items: [
      { title: "Session I: Launching the AI Journey: Medicine's Next Chapter Begins Here", speaker: "Saroji Misra, DO, FAAP, FACOFP and David Sengstock, MD, MS", date: "October 15, 2025", url: SOURCE_URL },
      { title: "Session II: Understanding AI: A Look Under the Hood", speaker: "N. Sara Merchawi, PhD", date: "November 5, 2025", url: SOURCE_URL },
      { title: "Session III: Ethics of AI Use in Medicine", speaker: "Ramin Homayouni, PhD", date: "January 21, 2026", url: SOURCE_URL },
      { title: "Session IV: The Future of AI in Healthcare", speaker: "Leland Babitch, MD, MBA and Anupam Sule, MD", date: "February 11, 2026", url: SOURCE_URL }
    ]
  },
  {
    name: "Billing and Coding 101",
    items: [
      { title: "Billing and Coding 101", speaker: "Cathy Barrett, CPC, MSN, MSA, NP", date: "April 10, 2024", url: SOURCE_URL }
    ]
  },
  {
    name: "Chief Resident",
    items: [
      { title: "How to Rock as a Chief Resident and Conflict Navigation and Resolution", speaker: "Saroji Misra, DO, FAAP, FACOFP", date: "April 26, 2024", url: SOURCE_URL },
      { title: "Teaching Your Residents How to Teach", speaker: "Nikhil Goyal, MD, Angela Pugliese, MD and Mansoor Siddiqui, MD", date: "April 26, 2024", url: SOURCE_URL },
      { title: "The Power of Social-Emotional Intelligence", speaker: "Keith Levick, PhD", date: "April 26, 2024", url: SOURCE_URL },
      { title: "Implicit Bias in Health", speaker: "Asha Shajahan, MD, MHSA", date: "April 26, 2024", url: SOURCE_URL },
      { title: "Personality and Leadership Style", speaker: "Stacy Payne, MA", date: "April 26, 2024", url: SOURCE_URL },
      { title: "Giving and Receiving Feedback", speaker: "Hershey Bell, MD, MS, FAAP", date: "May 3, 2023", url: SOURCE_URL },
      { title: "Problems and Problem Solving: Working with Difficult Folks", speaker: "Hershey Bell, MD, MS, FAAP", date: "May 3, 2023", url: SOURCE_URL },
      { title: "Essential Communication Skills for Leaders", speaker: "Simone Brennan, PhD and Susan Egely, PhD", date: "April 26, 2023", url: SOURCE_URL },
      { title: "Leadership and Change Management", speaker: "Hershey Bell, MD, MS, FAAP", date: "May 11, 2022", url: SOURCE_URL }
    ]
  },
  {
    name: "Faculty Development",
    items: [
      { title: "Teaching Your Residents How to Teach", speaker: "Alfred Baylor, MD and Heidi Kromrei, PhD", date: "May 13, 2021", url: SOURCE_URL },
      { title: "Implicit Bias in Health", speaker: "Aisa McCleary-Gaddy, PhD", date: "June 11, 2020", url: SOURCE_URL },
      { title: "Coaching in GME Family Medicine Series: Foundational Coaching Skills for Faculty and Staff - Session 1", speaker: "Jillian Bybee, MD, FAAP, Kristen Jones, LMSW", date: "February 25, 2026", url: SOURCE_URL },
      { title: "The Stanford Learning Model", speaker: "Kelley Skeff, MD, PhD, MACP and colleagues", date: "May 6, 2026", url: SOURCE_URL },
      { title: "Holistic Review in Resident Recruitment and Selection", speaker: "John Norcini, PhD", date: "August 24, 2023", url: SOURCE_URL },
      { title: "Introduction to the Transformative Reflective Process (TRP) - Session 1", speaker: "Linda de Cossart, CBE and colleagues", date: "October 7, 2022", url: SOURCE_URL },
      { title: "Resident As Teachers", speaker: "Amy Guenther, PhD", date: "February 11, 2022", url: SOURCE_URL }
    ]
  },
  {
    name: "Research",
    items: [
      { title: "Key Statistical Concepts in Clinical Research and the P-Value Debate", speaker: "Roderick J. Little, PhD", date: "May 24, 2023", url: SOURCE_URL },
      { title: "How Covid 19 has Changed the World and What the Future Holds", speaker: "Michael T. Osterholm, PhD, MPH", date: "May 25, 2022", url: SOURCE_URL },
      { title: "The Impact of COVID 19: Where We Stand", speaker: "Arnold S. Monto, MD", date: "May 26, 2021", url: SOURCE_URL }
    ]
  },
  {
    name: "Residency Coordinators",
    items: [
      { title: "ACGME Site Visit Preparation", speaker: "Kelly Aronson MBA, C-TAGME and Christina Pusel, MLIS, C-TAGME", date: "January 16, 2026", url: SOURCE_URL },
      { title: "Expanding Your Reach: Building Connections through Committee Participation", speaker: "Natasha Brooks, MHA, C-TAGME, CHPM, CLSSBB", date: "October 17, 2025", url: SOURCE_URL },
      { title: "Establishing Yourself as a Leader: Exploring the Unique Role of Program Administration", speaker: "Bret Stevens, EdD, MBA", date: "October 17, 2023", url: SOURCE_URL },
      { title: "Conflict Resolution: How to engage in effective, difficult conversations", speaker: "Deb Munn, PhD, LP", date: "January 27, 2023", url: SOURCE_URL }
    ]
  },
  {
    name: "Transitional Year",
    items: [
      { title: "Impact of Sleep in Medical Education during Residency", speaker: "Bhavin Dalal, MBBS, MD, DNB, FACP, LEAD (AAMC), FCCP", date: "April 23, 2001", url: SOURCE_URL },
      { title: "Lead to Make a Difference", speaker: "Greg Sears", date: "April 23, 2001", url: SOURCE_URL },
      { title: "Planting the Seeds of Calm", speaker: "Mindstation LLC", date: "April 23, 2000", url: SOURCE_URL }
    ]
  },
  {
    name: "Well-Being",
    items: [
      { title: "1st Annual Barbara Wolf Memorial presentation: The Toll it Takes", speaker: "Heather Kirkpatrick, PhD, ABPP", date: "May 8, 2026", url: SOURCE_URL },
      { title: "Lifestyle Medicine: A New Standard of Care", speaker: "Sarah Elsayed, MD and colleagues", date: "May 1, 2026", url: SOURCE_URL },
      { title: "Advocacy 101", speaker: "Sean Gehle, MBA and Elizabeth Kutter, JD", date: "January 30, 2026", url: SOURCE_URL },
      { title: "Imposter Syndrome in Education", speaker: "Alyssa Stephenson-Famy, MD", date: "October 3, 2025", url: SOURCE_URL },
      { title: "Patient and Physician Impairment: Creating Lasting Change", speaker: "Debra Jay", date: "September 17, 2025", url: SOURCE_URL },
      { title: "Brave Leadership in a Me-First Society", speaker: "Heather Kirkpatrick, PhD, MS and Tonya Vanorder, PhD, MBA", date: "February 12, 2025", url: SOURCE_URL },
      { title: "The Mindful Healthcare Team", speaker: "Michael Kranaret, MD, FACP", date: "January 10, 2025", url: SOURCE_URL },
      { title: "Physician Impairment: A Personal Journey", speaker: "Rishi Menon, MD", date: "September 17, 2024", url: SOURCE_URL }
    ]
  }
];

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function absoluteUrl(value) {
  try {
    return new URL(value, SOURCE_URL).href;
  } catch {
    return SOURCE_URL;
  }
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

function normalizeManagedSections(sections) {
  const normalized = sections
    .map((section) => ({
      name: section.name,
      id: section.slug,
      items: section.items.map((item) => ({
        id: String(item.id),
        title: item.title,
        speaker: item.speaker || "",
        date: item.resource_date || "",
        url: item.url,
        type: item.item_type || "resource",
        embedUrl: videoEmbedUrl(item.url)
      }))
    }))
    .filter((section) => section.items.length);

  return {
    source: "admin",
    sourceUrl: "",
    scrapedAt: new Date().toISOString(),
    sections: normalized,
    totalItems: normalized.reduce((total, section) => total + section.items.length, 0)
  };
}

function parseMeta(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(.*?)\s+[-–—]\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})$/);
  if (!match) return { speaker: normalized, date: "" };
  return { speaker: match[1].trim(), date: match[2].trim() };
}

export function parseRowsFromTable(html) {
  const sections = new Map();
  const rowMatches = [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  let currentSection = "";

  for (const rowMatch of rowMatches) {
    const cells = [...rowMatch[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => match[1]);
    if (cells.length < 2) continue;

    const sectionText = stripTags(cells[0]);
    if (sectionText && !/subject\/topic/i.test(sectionText)) currentSection = sectionText;
    if (!currentSection || /subject\/topic/i.test(currentSection)) continue;

    const itemCell = cells[1];
    const linkMatches = [...itemCell.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    if (!linkMatches.length) continue;
    if (!sections.has(currentSection)) sections.set(currentSection, []);

    linkMatches.forEach((linkMatch, index) => {
      const nextLink = linkMatches[index + 1];
      const detailStart = linkMatch.index + linkMatch[0].length;
      const detailEnd = nextLink?.index ?? itemCell.length;
      const detailMarkup = itemCell.slice(detailStart, detailEnd);
      const meta = parseMeta(stripTags(detailMarkup));
      const item = {
        title: stripTags(linkMatch[2]),
        url: absoluteUrl(decodeEntities(linkMatch[1])),
        speaker: meta.speaker,
        date: meta.date
      };

      if (item.title && item.url) sections.get(currentSection).push(item);
    });
  }

  return [...sections.entries()].map(([name, items]) => ({ name, items }));
}

export function parseLinksFromContent(html) {
  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
  const content = articleMatch ? articleMatch[0] : html;
  const sections = new Map();
  let currentSection = "Virtual Library";

  const tokens = [...content.matchAll(/<(h[1-4]|p|li|a)\b[^>]*>[\s\S]*?<\/\1>/gi)];
  for (const token of tokens) {
    const markup = token[0];
    const tag = token[1].toLowerCase();
    const text = stripTags(markup);
    if (!text || /password protected/i.test(text)) continue;

    if (/^h[1-4]$/.test(tag) && !/semcme virtual library/i.test(text)) {
      currentSection = text;
      continue;
    }

    const linkMatch = markup.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const title = stripTags(linkMatch[2]);
    if (!title) continue;

    const detail = stripTags(markup.replace(linkMatch[0], " "));
    const meta = parseMeta(detail);
    if (!sections.has(currentSection)) sections.set(currentSection, []);
    sections.get(currentSection).push({
      title,
      url: absoluteUrl(decodeEntities(linkMatch[1])),
      speaker: meta.speaker,
      date: meta.date
    });
  }

  return [...sections.entries()].map(([name, items]) => ({ name, items }));
}

function normalizeSections(sections, source = "wordpress") {
  const normalized = sections
    .map((section) => ({
      name: section.name,
      id: section.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      items: section.items.map((item, index) => ({
        id: `${section.name}-${item.title}-${index}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
        title: item.title,
        speaker: item.speaker || "",
        date: item.date || "",
        url: item.url,
        embedUrl: videoEmbedUrl(item.url)
      }))
    }))
    .filter((section) => section.items.length);

  return {
    source,
    sourceUrl: SOURCE_URL,
    scrapedAt: new Date().toISOString(),
    sections: normalized,
    totalItems: normalized.reduce((total, section) => total + section.items.length, 0)
  };
}

export async function fetchWordPressHtml() {
  const userAgent = "SEMCMEVirtualLibrary/1.0 (+https://semcme.org)";
  const response = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": userAgent
    }
  });

  if (!response.ok) throw new Error(`Source returned ${response.status}`);
  let html = await response.text();

  if (isPasswordProtectedPage(html) && config.wordpressPassword) {
    const passwordResponse = await fetch("https://semcme.org/wp-login.php?action=postpass", {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent
      },
      body: new URLSearchParams({
        post_password: config.wordpressPassword,
        Submit: "Submit"
      })
    });
    const setCookieHeaders = passwordResponse.headers.getSetCookie?.() || [];
    const cookies = setCookieHeaders.length ? setCookieHeaders : [passwordResponse.headers.get("set-cookie")].filter(Boolean);
    const cookieHeader = cookies.map((cookie) => cookie.split(";")[0]).join("; ");
    const unlocked = await fetch(SOURCE_URL, {
      headers: {
        Cookie: cookieHeader,
        "User-Agent": userAgent
      }
    });
    if (unlocked.ok) html = await unlocked.text();
  }

  return html;
}

export async function getVirtualLibrary({ force = false } = {}) {
  const maxAgeMs = config.scrapeCacheMinutes * 60 * 1000;
  if (!force && cache.value && Date.now() - cache.loadedAt < maxAgeMs) return cache.value;

  try {
    const managedSections = await getLibraryContent();
    if (managedSections.some((section) => section.items.length)) {
      cache.value = normalizeManagedSections(managedSections);
      cache.loadedAt = Date.now();
      return cache.value;
    }
  } catch (error) {
    if (config.nodeEnv !== "production") {
      console.warn("Admin-managed library content unavailable:", error.message);
    }
  }

  try {
    const html = await fetchWordPressHtml();
    if (isPasswordProtectedPage(html)) {
      throw new Error("WordPress source is password protected.");
    }

    const parsed = parseRowsFromTable(html);
    const sections = parsed.length ? parsed : parseLinksFromContent(html);
    if (!sections.length) throw new Error("No library links found in source page.");

    cache.value = normalizeSections(sections);
  } catch (error) {
    const fallback = normalizeSections(fallbackSections, "fallback");
    fallback.warning = error.message;
    cache.value = fallback;
  }

  cache.loadedAt = Date.now();
  return cache.value;
}
