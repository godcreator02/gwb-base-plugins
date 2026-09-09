import * as React from "react"
import { cn } from "cn"
import { Switch as SwitchPrimitive } from "radix-ui"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "plugins:peer plugins:group/switch plugins:inline-flex plugins:shrink-0 plugins:items-center plugins:rounded-full plugins:border plugins:border-transparent plugins:shadow-xs plugins:transition-all plugins:outline-none plugins:focus-visible:border-ring plugins:focus-visible:ring-[3px] plugins:focus-visible:ring-ring/50 plugins:disabled:cursor-not-allowed plugins:disabled:opacity-50 plugins:data-[size=default]:h-[1.15rem] plugins:data-[size=default]:w-8 plugins:data-[size=sm]:h-3.5 plugins:data-[size=sm]:w-6 plugins:data-[state=checked]:bg-primary plugins:data-[state=unchecked]:bg-input plugins:dark:data-[state=unchecked]:bg-input/80",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "plugins:pointer-events-none plugins:block plugins:rounded-full plugins:bg-background plugins:ring-0 plugins:transition-transform plugins:group-data-[size=default]/switch:size-4 plugins:group-data-[size=sm]/switch:size-3 plugins:data-[state=checked]:translate-x-[calc(100%-2px)] plugins:data-[state=unchecked]:translate-x-0 plugins:dark:data-[state=checked]:bg-primary-foreground plugins:dark:data-[state=unchecked]:bg-foreground"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
