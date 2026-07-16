type FieldLabel = { vi: string; en: string }
type FieldMap = Record<string, FieldLabel>

let cachedMap: FieldMap | null = null

export async function getFieldCodes(): Promise<FieldMap> {
    if (cachedMap) return cachedMap

    try {
        const res = await fetch("/vci_field_codes.json")
        if (!res.ok) return {}
        const data = await res.json()
        const map: FieldMap = {}
        // NOTE contains the detailed disclosures used by the Financials → Notes tab.
        // Keeping it in the same map lets the UI use the source's English labels
        // instead of falling back to the Vietnamese curated labels.
        for (const section of ["BALANCE_SHEET", "INCOME_STATEMENT", "CASH_FLOW", "NOTE"] as const) {
            for (const entry of (data[section] ?? []) as Array<{ field: string; titleVi: string; titleEn: string }>) {
                if (entry.field) {
                    map[entry.field] = { vi: entry.titleVi, en: entry.titleEn }
                }
            }
        }
        cachedMap = map
        return map
    } catch {
        return {}
    }
}
