"use client"
import { useLanguage } from "@/lib/languageContext"
import { RadioGroup, RadioGroupItem } from "@/components/ThemeSwitch"

function ViIcon() { return <span className="text-[11px] font-bold leading-none">VI</span> }
function EnIcon() { return <span className="text-[11px] font-bold leading-none">EN</span> }

export default function LanguageSwitch() {
    const { lang, setLanguage } = useLanguage()

    return (
        <RadioGroup
            value={lang}
            onValueChange={(v) => setLanguage(v as "vi" | "en")}
            className="flex gap-1"
        >
            <RadioGroupItem icon={ViIcon} value="vi" id="lang-vi" aria-label="Switch to Vietnamese" />
            <RadioGroupItem icon={EnIcon} value="en" id="lang-en" aria-label="Switch to English" />
        </RadioGroup>
    )
}
