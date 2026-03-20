import { cx } from "@/lib/utils"

export const Badge = ({
    children,
    className,
    ...props
}: React.ComponentPropsWithoutRef<"span">) => {
    return (
        <span
            className={cx(
                "inline-flex items-center gap-x-2.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-500",
                className,
            )}
            {...props}
        >
            {children}
        </span>
    )
}
