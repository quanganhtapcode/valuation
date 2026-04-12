// <component_path>src/components/ui/DropdownMenu.tsx</component_path>
// <component_code>
// Tremor DropdownMenu [v0.0.0]

import * as React from "react"
import * as DropdownMenuPrimitives from "@radix-ui/react-dropdown-menu"

import { cx } from "@/lib/utils"

const DropdownMenu = DropdownMenuPrimitives.Root

const DropdownMenuTrigger = DropdownMenuPrimitives.Trigger

const DropdownMenuGroup = DropdownMenuPrimitives.Group

const DropdownMenuPortal = DropdownMenuPrimitives.Portal

const DropdownMenuSub = DropdownMenuPrimitives.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitives.RadioGroup

const DropdownMenuSubTrigger = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitives.SubTrigger>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitives.SubTrigger> & { inset?: boolean }
>(({ className, inset, children, ...props }, ref) => (
    <DropdownMenuPrimitives.SubTrigger
        ref={ref}
        className={cx(
            "flex cursor-default select-none items-center rounded-tremor-small px-2 py-1.5 text-sm outline-none focus:bg-tremor-background-muted data-[state=open]:bg-tremor-background-muted dark:focus:bg-dark-tremor-background-muted dark:data-[state=open]:bg-dark-tremor-background-muted",
            inset && "pl-8",
            className,
        )}
        {...props}
    >
        {children}
    </DropdownMenuPrimitives.SubTrigger>
))
DropdownMenuSubTrigger.displayName =
    DropdownMenuPrimitives.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitives.SubContent>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitives.SubContent>
>(({ className, ...props }, ref) => (
    <DropdownMenuPrimitives.SubContent
        ref={ref}
        className={cx(
            "z-50 min-w-[8rem] overflow-hidden rounded-tremor-small border border-tremor-border bg-tremor-background p-1 text-tremor-content-semistrong shadow-tremor-dropdown data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:border-dark-tremor-border dark:bg-dark-tremor-background dark:text-dark-tremor-content-semistrong dark:shadow-dark-tremor-dropdown",
            className,
        )}
        {...props}
    />
))
DropdownMenuSubContent.displayName =
    DropdownMenuPrimitives.SubContent.displayName

const DropdownMenuContent = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitives.Content>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitives.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
    <DropdownMenuPrimitives.Portal>
        <DropdownMenuPrimitives.Content
            ref={ref}
            sideOffset={sideOffset}
            className={cx(
                "z-50 min-w-[8rem] overflow-hidden rounded-tremor-small border border-tremor-border bg-tremor-background p-1 text-tremor-content-semistrong shadow-tremor-dropdown data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:border-dark-tremor-border dark:bg-dark-tremor-background dark:text-dark-tremor-content-semistrong dark:shadow-dark-tremor-dropdown",
                className,
            )}
            {...props}
        />
    </DropdownMenuPrimitives.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitives.Content.displayName

const DropdownMenuItem = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitives.Item>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitives.Item> & {
        shortcut?: string
    }
>(({ className, shortcut: _shortcut, ...props }, ref) => (
    <DropdownMenuPrimitives.Item
        ref={ref}
        className={cx(
            "relative flex cursor-default select-none items-center rounded-tremor-small px-2 py-1.5 text-sm outline-none transition-colors focus:bg-tremor-background-muted focus:text-tremor-content-strong data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-dark-tremor-background-muted dark:focus:text-dark-tremor-content-strong",
            className,
        )}
        {...props}
    />
))
DropdownMenuItem.displayName = DropdownMenuPrimitives.Item.displayName

const DropdownMenuCheckboxItem = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitives.CheckboxItem>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitives.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
    <DropdownMenuPrimitives.CheckboxItem
        ref={ref}
        className={cx(
            "relative flex cursor-default select-none items-center rounded-tremor-small py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-tremor-background-muted focus:text-tremor-content-strong data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-dark-tremor-background-muted dark:focus:text-dark-tremor-content-strong",
            className,
        )}
        checked={checked}
        {...props}
    >
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
            <DropdownMenuPrimitives.ItemIndicator>
                {/* <CheckIcon className="h-4 w-4" aria-hidden="true" /> */}
                <svg
                    width="15"
                    height="15"
                    viewBox="0 0 15 15"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                >
                    <path
                        d="M11.4669 3.72684C11.7558 3.91574 11.8369 4.30308 11.648 4.59198L7.39799 11.092C7.29783 11.2452 7.13556 11.3467 6.95402 11.3699C6.77247 11.3931 6.58989 11.3355 6.45446 11.2124L3.70446 8.71241C3.44905 8.48022 3.43023 8.08494 3.66242 7.82953C3.89461 7.57412 4.28989 7.55529 4.5453 7.78749L6.75292 9.79441L10.6018 3.90792C10.7907 3.61902 11.178 3.53795 11.4669 3.72684Z"
                        fill="currentColor"
                        fillRule="evenodd"
                        clipRule="evenodd"
                    ></path>
                </svg>
            </DropdownMenuPrimitives.ItemIndicator>
        </span>
        {children}
    </DropdownMenuPrimitives.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName =
    DropdownMenuPrimitives.CheckboxItem.displayName

const DropdownMenuRadioItem = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitives.RadioItem>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitives.RadioItem>
>(({ className, children, ...props }, ref) => (
    <DropdownMenuPrimitives.RadioItem
        ref={ref}
        className={cx(
            "relative flex cursor-default select-none items-center rounded-tremor-small py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-tremor-background-muted focus:text-tremor-content-strong data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-dark-tremor-background-muted dark:focus:text-dark-tremor-content-strong",
            className,
        )}
        {...props}
    >
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
            <DropdownMenuPrimitives.ItemIndicator>
                <div className="size-2 rounded-full bg-tremor-content-strong dark:bg-dark-tremor-content-strong" />
            </DropdownMenuPrimitives.ItemIndicator>
        </span>
        {children}
    </DropdownMenuPrimitives.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitives.RadioItem.displayName

const DropdownMenuLabel = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitives.Label>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitives.Label> & {
        inset?: boolean
    }
>(({ className, inset, ...props }, ref) => (
    <DropdownMenuPrimitives.Label
        ref={ref}
        className={cx(
            "px-2 py-1.5 text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong",
            inset && "pl-8",
            className,
        )}
        {...props}
    />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitives.Label.displayName

const DropdownMenuSeparator = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitives.Separator>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitives.Separator>
>(({ className, ...props }, ref) => (
    <DropdownMenuPrimitives.Separator
        ref={ref}
        className={cx(
            "-mx-1 my-1 h-px bg-tremor-border dark:bg-dark-tremor-border",
            className,
        )}
        {...props}
    />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitives.Separator.displayName

const DropdownMenuShortcut = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
    return (
        <span
            className={cx(
                "ml-auto text-xs tracking-widest text-tremor-content-subtle dark:text-dark-tremor-content-subtle",
                className,
            )}
            {...props}
        />
    )
}
DropdownMenuShortcut.displayName = "DropdownMenuShortcut"

const DropdownMenuIconWrapper = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
    return (
        <span
            className={cx(
                "mr-2 text-tremor-content-subtle dark:text-dark-tremor-content-subtle",
                className,
            )}
            {...props}
        />
    )
}
DropdownMenuIconWrapper.displayName = "DropdownMenuIconWrapper"

export {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuCheckboxItem,
    DropdownMenuRadioItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuGroup,
    DropdownMenuPortal,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuRadioGroup,
    DropdownMenuIconWrapper,
}
// </component_code>
