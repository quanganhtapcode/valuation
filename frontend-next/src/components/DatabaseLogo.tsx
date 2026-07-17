import React from "react"
import Image from "next/image"
import { cx } from "@/lib/utils"

export const DatabaseLogo = ({ className }: { className?: string }) => {
    return (
        <div className={cx("flex items-center", className)}>
            <Image
                src="/quanganh-logo.svg"
                alt="Stock analysis home"
                width={28}
                height={28}
                className="size-7 shrink-0 rounded-md object-contain"
            />
        </div>
    )
}
