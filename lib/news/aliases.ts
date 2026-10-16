/**
 * Acronyms Hawaiʻi outlets use for public bodies and major organizations, expanded to the full names
 * the database stores. The tagger tries an expansion only when the acronym itself appears as a word in
 * the article, and tags only when the expanded name resolves to an entity; an expansion never creates
 * anything. Keep entries unambiguous in a Hawaiʻi news context.
 */
export const ACRONYM_EXPANSIONS: Record<string, string[]> = {
  UH: ['University of Hawaii'],
  HECO: ['Hawaiian Electric', 'Hawaiian Electric Company'],
  HEI: ['Hawaiian Electric Industries'],
  OHA: ['Office of Hawaiian Affairs'],
  DLNR: ['Department of Land and Natural Resources'],
  BLNR: ['Board of Land and Natural Resources'],
  DHHL: ['Department of Hawaiian Home Lands'],
  DOE: ['Hawaii Department of Education', 'Department of Education'],
  DOH: ['Hawaii Department of Health', 'Department of Health'],
  DOT: ['Hawaii Department of Transportation', 'Department of Transportation'],
  DHS: ['Hawaii Department of Human Services', 'Department of Human Services'],
  DCCA: ['Department of Commerce and Consumer Affairs'],
  DBEDT: ['Department of Business, Economic Development and Tourism'],
  PUC: ['Hawaii Public Utilities Commission', 'Public Utilities Commission'],
  HTA: ['Hawaii Tourism Authority'],
  HART: ['Honolulu Authority for Rapid Transportation'],
  HPD: ['Honolulu Police Department'],
  HFD: ['Honolulu Fire Department'],
  MPD: ['Maui Police Department'],
  HIEMA: ['Hawaii Emergency Management Agency'],
  HHFDC: ['Hawaii Housing Finance and Development Corporation'],
  HPHA: ['Hawaii Public Housing Authority'],
  HCDA: ['Hawaii Community Development Authority'],
  HSTA: ['Hawaii State Teachers Association'],
  HGEA: ['Hawaii Government Employees Association'],
  UPW: ['United Public Workers'],
  ILWU: ['International Longshore and Warehouse Union'],
  HMSA: ['Hawaii Medical Service Association'],
  KS: ['Kamehameha Schools'],
  BOH: ['Bank of Hawaii'],
  FHB: ['First Hawaiian Bank'],
  'A&B': ['Alexander & Baldwin'],
  UHERO: ['University of Hawaii Economic Research Organization'],
  OIP: ['Office of Information Practices'],
  CSC: ['Campaign Spending Commission'],
  LUC: ['Land Use Commission'],
}
