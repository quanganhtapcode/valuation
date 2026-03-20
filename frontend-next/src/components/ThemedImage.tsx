"use client"
import Image from "next/image"
import { cx } from "@/lib/utils"

interface ThemedImageProps extends Omit<React.ComponentPropsWithoutRef<typeof Image>, "src"> {
    lightSrc: string
    darkSrc: string
}

const ThemedImage = ({
    lightSrc,
    darkSrc,
    alt,
    className,
    ...props
}: ThemedImageProps) => {
    return (
        <>
            <Image
                src={lightSrc}
                alt={alt}
                className={cx("dark:hidden", className)}
                {...props}
            />
            <Image
                src={darkSrc}
                alt={alt}
                className={cx("hidden dark:block", className)}
                {...props}
            />
        </>
    )
}

export default ThemedImage
