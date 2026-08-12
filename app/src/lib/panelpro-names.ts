// Centralized display names for the PanelProStudio tool. Reference these instead
// of hard-coding the strings so the UI name can't silently regress (a stray
// "Gemini" literal in this file would now conflict with these usages on merge
// rather than quietly revert the labels).
export const PANELPROSTUDIO = "PanelProStudio";      // the tool / board name
export const PANELPRO_EXTRACT = "PanelPro Extract";  // the extracted flat-panel artwork / uploads
