import React from "react"
import Image from "next/image"
import { cx } from "@/lib/utils"

export const DatabaseLogo = ({ className }: { className?: string }) => {
    return (
        <div className={cx("flex items-center justify-center", className)}>
            <Image
                src="/quanganh-logo.svg"
                alt="Stock analysis home"
                width={40}
                height={40}
                className="size-9 shrink-0 translate-y-px object-contain md:size-10"
            />
        </div>
    )
}
