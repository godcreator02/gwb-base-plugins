import * as React from "react"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "logger:h-9 logger:w-full logger:min-w-0 logger:rounded-md logger:border logger:border-input logger:bg-transparent logger:px-3 logger:py-1 logger:text-base logger:shadow-xs logger:transition-[color,box-shadow] logger:outline-none logger:selection:bg-primary logger:selection:text-primary-foreground logger:file:inline-flex logger:file:h-7 logger:file:border-0 logger:file:bg-transparent logger:file:text-sm logger:file:font-medium logger:file:text-foreground logger:placeholder:text-muted-foreground logger:disabled:pointer-events-none logger:disabled:cursor-not-allowed logger:disabled:opacity-50 logger:md:text-sm logger:dark:bg-input/30",
        "logger:focus-visible:border-ring logger:focus-visible:ring-[3px] logger:focus-visible:ring-ring/50",
        "logger:aria-invalid:border-destructive logger:aria-invalid:ring-destructive/20 logger:dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
