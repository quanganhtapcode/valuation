import React from "react"
import Image from "next/image"
import { cx } from "@/lib/utils"

export const DatabaseLogo = ({ className }: { className?: string }) => {
    return (
        <div className={cx("flex items-center gap-2", className)}>
            <Image
                src="/favicon-32x32.png"
                alt="Quang Anh logo"
                width={28}
                height={28}
                className="size-7 object-contain"
            />
            <span className="text-lg font-bold text-gray-900 whitespace-nowrap dark:text-gray-50">Quang Anh</span>
        </div>
    )
}
