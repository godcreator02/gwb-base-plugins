import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "hello:inline-flex hello:shrink-0 hello:items-center hello:justify-center hello:gap-2 hello:rounded-md hello:text-sm hello:font-medium hello:whitespace-nowrap hello:transition-all hello:outline-none hello:focus-visible:border-ring hello:focus-visible:ring-[3px] hello:focus-visible:ring-ring/50 hello:disabled:pointer-events-none hello:disabled:opacity-50 hello:aria-invalid:border-destructive hello:aria-invalid:ring-destructive/20 hello:dark:aria-invalid:ring-destructive/40 hello:[&_svg]:pointer-events-none hello:[&_svg]:shrink-0 hello:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "hello:bg-primary hello:text-primary-foreground hello:hover:bg-primary/90",
        destructive:
          "hello:bg-destructive hello:text-white hello:hover:bg-destructive/90 hello:focus-visible:ring-destructive/20 hello:dark:bg-destructive/60 hello:dark:focus-visible:ring-destructive/40",
        outline:
          "hello:border hello:bg-background hello:shadow-xs hello:hover:bg-accent hello:hover:text-accent-foreground hello:dark:border-input hello:dark:bg-input/30 hello:dark:hover:bg-input/50",
        secondary:
          "hello:bg-secondary hello:text-secondary-foreground hello:hover:bg-secondary/80",
        ghost:
          "hello:hover:bg-accent hello:hover:text-accent-foreground hello:dark:hover:bg-accent/50",
        link: "hello:text-primary hello:underline-offset-4 hello:hover:underline",
      },
      size: {
        default: "hello:h-9 hello:px-4 hello:py-2 hello:has-[>svg]:px-3",
        xs: "hello:h-6 hello:gap-1 hello:rounded-md hello:px-2 hello:text-xs hello:has-[>svg]:px-1.5 hello:[&_svg:not([class*=size-])]:size-3",
        sm: "hello:h-8 hello:gap-1.5 hello:rounded-md hello:px-3 hello:has-[>svg]:px-2.5",
        lg: "hello:h-10 hello:rounded-md hello:px-6 hello:has-[>svg]:px-4",
        icon: "hello:size-9",
        "icon-xs": "hello:size-6 hello:rounded-md hello:[&_svg:not([class*=size-])]:size-3",
        "icon-sm": "hello:size-8",
        "icon-lg": "hello:size-10",
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
