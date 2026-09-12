import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "baseui:inline-flex baseui:shrink-0 baseui:items-center baseui:justify-center baseui:gap-2 baseui:rounded-md baseui:text-sm baseui:font-medium baseui:whitespace-nowrap baseui:transition-all baseui:outline-none baseui:focus-visible:border-ring baseui:focus-visible:ring-[3px] baseui:focus-visible:ring-ring/50 baseui:disabled:pointer-events-none baseui:disabled:opacity-50 baseui:aria-invalid:border-destructive baseui:aria-invalid:ring-destructive/20 baseui:dark:aria-invalid:ring-destructive/40 baseui:[&_svg]:pointer-events-none baseui:[&_svg]:shrink-0 baseui:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "baseui:bg-primary baseui:text-primary-foreground baseui:hover:bg-primary/90",
        destructive:
          "baseui:bg-destructive baseui:text-white baseui:hover:bg-destructive/90 baseui:focus-visible:ring-destructive/20 baseui:dark:bg-destructive/60 baseui:dark:focus-visible:ring-destructive/40",
        outline:
          "baseui:border baseui:bg-background baseui:shadow-xs baseui:hover:bg-accent baseui:hover:text-accent-foreground baseui:dark:border-input baseui:dark:bg-input/30 baseui:dark:hover:bg-input/50",
        secondary:
          "baseui:bg-secondary baseui:text-secondary-foreground baseui:hover:bg-secondary/80",
        ghost:
          "baseui:hover:bg-accent baseui:hover:text-accent-foreground baseui:dark:hover:bg-accent/50",
        link: "baseui:text-primary baseui:underline-offset-4 baseui:hover:underline",
      },
      size: {
        default: "baseui:h-9 baseui:px-4 baseui:py-2 baseui:has-[>svg]:px-3",
        xs: "baseui:h-6 baseui:gap-1 baseui:rounded-md baseui:px-2 baseui:text-xs baseui:has-[>svg]:px-1.5 baseui:[&_svg:not([class*=size-])]:size-3",
        sm: "baseui:h-8 baseui:gap-1.5 baseui:rounded-md baseui:px-3 baseui:has-[>svg]:px-2.5",
        lg: "baseui:h-10 baseui:rounded-md baseui:px-6 baseui:has-[>svg]:px-4",
        icon: "baseui:size-9",
        "icon-xs": "baseui:size-6 baseui:rounded-md baseui:[&_svg:not([class*=size-])]:size-3",
        "icon-sm": "baseui:size-8",
        "icon-lg": "baseui:size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
