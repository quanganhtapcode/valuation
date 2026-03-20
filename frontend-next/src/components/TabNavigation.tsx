import React from "react"
import {
    NavigationMenu,
    NavigationMenuList,
    NavigationMenuItem,
    NavigationMenuLink,
    navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu"
import { cx } from "@/lib/utils"

const TabNavigation = React.forwardRef<
    React.ElementRef<typeof NavigationMenu>,
    React.ComponentPropsWithoutRef<typeof NavigationMenu>
>(({ className, children, ...props }, ref) => (
    <NavigationMenu
        ref={ref}
        className={cx("justify-start max-w-full overflow-x-auto", className)}
        {...props}
    >
        <NavigationMenuList className="w-full justify-start space-x-2">
            {children}
        </NavigationMenuList>
    </NavigationMenu>
))
TabNavigation.displayName = "TabNavigation"

const TabNavigationLink = React.forwardRef<
    React.ElementRef<typeof NavigationMenuLink>,
    React.ComponentPropsWithoutRef<typeof NavigationMenuLink> & { active?: boolean }
>(({ className, children, active, ...props }, ref) => (
    <NavigationMenuItem>
        <NavigationMenuLink
            ref={ref}
            active={active}
            className={cx(
                navigationMenuTriggerStyle(),
                "cursor-pointer",
                active && "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-50",
                className
            )}
            {...props}
        >
            {children}
        </NavigationMenuLink>
    </NavigationMenuItem>
))
TabNavigationLink.displayName = "TabNavigationLink"

export { TabNavigation, TabNavigationLink }
