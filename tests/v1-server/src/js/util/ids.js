/** Short unique id with a readable prefix, e.g. "a" for assessments, "p" for photos. */
export const uid = (prefix = "") => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const deepClone = (value) => JSON.parse(JSON.stringify(value));

/** Identifies this open tab, so the app can tell its own saves from other devices'. */
export const SESSION_ID = uid("s");
