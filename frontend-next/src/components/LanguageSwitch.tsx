"use client"
import { useLanguage } from "@/lib/languageContext"
import { RadioGroup, RadioGroupItem } from "@/components/ThemeSwitch"
import { usePathname, useRouter } from "next/navigation"
import { localizedPath } from "@/lib/localePath"

function ViIcon() { return <span className="text-[11px] font-bold leading-none">VI</span> }
function EnIcon() { return <span className="text-[11px] font-bold leading-none">EN</span> }

export default function LanguageSwitch() {
    const { lang, setLanguage } = useLanguage()
    const pathname = usePathname()
    const router = useRouter()

    const changeLanguage = (value: string) => {
        const next = value as "vi" | "en"
        setLanguage(next)
        router.replace(localizedPath(pathname, next))
    }

    return (
        <RadioGroup
            value={lang}
            onValueChange={changeLanguage}
            className="flex gap-1"
        >
            <RadioGroupItem icon={ViIcon} value="vi" id="lang-vi" aria-label="Switch to Vietnamese" />
            <RadioGroupItem icon={EnIcon} value="en" id="lang-en" aria-label="Switch to English" />
        </RadioGroup>
    )
}
