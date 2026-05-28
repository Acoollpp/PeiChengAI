import { Link } from "@tanstack/react-router"

import { cn } from "@/lib/utils"
import icon from "/assets/images/pace-icon.png"
import logo from "/assets/images/pace-logo.png"

interface LogoProps {
  variant?: "full" | "icon" | "responsive"
  className?: string
  asLink?: boolean
}

export function Logo({
  variant = "full",
  className,
  asLink = true,
}: LogoProps) {
  const fullLogo = logo
  const iconLogo = icon

  const content =
    variant === "responsive" ? (
      <>
        <img
          src={fullLogo}
          alt="沛城科技"
          className={cn(
            "h-7 w-auto group-data-[collapsible=icon]:hidden",
            className,
          )}
        />
        <img
          src={iconLogo}
          alt="沛城科技"
          className={cn(
            "h-4 w-auto hidden group-data-[collapsible=icon]:block",
            className,
          )}
        />
      </>
    ) : (
      <img
        src={variant === "full" ? fullLogo : iconLogo}
        alt="沛城科技"
        className={cn(variant === "full" ? "h-7 w-auto" : "h-4 w-auto", className)}
      />
    )

  if (!asLink) {
    return content
  }

  return <Link to="/">{content}</Link>
}
