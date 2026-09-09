import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "logger:inline-flex logger:shrink-0 logger:items-center logger:justify-center logger:gap-2 logger:rounded-md logger:text-sm logger:font-medium logger:whitespace-nowrap logger:transition-all logger:outline-none logger:focus-visible:border-ring logger:focus-visible:ring-[3px] logger:focus-visible:ring-ring/50 logger:disabled:pointer-events-none logger:disabled:opacity-50 logger:aria-invalid:border-destructive logger:aria-invalid:ring-destructive/20 logger:dark:aria-invalid:ring-destructive/40 logger:[&_svg]:pointer-events-none logger:[&_svg]:shrink-0 logger:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "logger:bg-primary logger:text-primary-foreground logger:hover:bg-primary/90",
        destructive:
          "logger:bg-destructive logger:text-white logger:hover:bg-destructive/90 logger:focus-visible:ring-destructive/20 logger:dark:bg-destructive/60 logger:dark:focus-visible:ring-destructive/40",
        outline:
          "logger:border logger:bg-background logger:shadow-xs logger:hover:bg-accent logger:hover:text-accent-foreground logger:dark:border-input logger:dark:bg-input/30 logger:dark:hover:bg-input/50",
        secondary:
          "logger:bg-secondary logger:text-secondary-foreground logger:hover:bg-secondary/80",
        ghost:
          "logger:hover:bg-accent logger:hover:text-accent-foreground logger:dark:hover:bg-accent/50",
        link: "logger:text-primary logger:underline-offset-4 logger:hover:underline",
      },
      size: {
        default: "logger:h-9 logger:px-4 logger:py-2 logger:has-[>svg]:px-3",
        xs: "logger:h-6 logger:gap-1 logger:rounded-md logger:px-2 logger:text-xs logger:has-[>svg]:px-1.5 logger:[&_svg:not([class*=size-])]:size-3",
        sm: "logger:h-8 logger:gap-1.5 logger:rounded-md logger:px-3 logger:has-[>svg]:px-2.5",
        lg: "logger:h-10 logger:rounded-md logger:px-6 logger:has-[>svg]:px-4",
        icon: "logger:size-9",
        "icon-xs": "logger:size-6 logger:rounded-md logger:[&_svg:not([class*=size-])]:size-3",
        "icon-sm": "logger:size-8",
        "icon-lg": "logger:size-10",
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
