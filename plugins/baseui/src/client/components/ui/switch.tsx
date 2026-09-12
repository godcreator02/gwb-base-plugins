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
        "baseui:peer baseui:group/switch baseui:inline-flex baseui:shrink-0 baseui:items-center baseui:rounded-full baseui:border baseui:border-transparent baseui:shadow-xs baseui:transition-all baseui:outline-none baseui:focus-visible:border-ring baseui:focus-visible:ring-[3px] baseui:focus-visible:ring-ring/50 baseui:disabled:cursor-not-allowed baseui:disabled:opacity-50 baseui:data-[size=default]:h-[1.15rem] baseui:data-[size=default]:w-8 baseui:data-[size=sm]:h-3.5 baseui:data-[size=sm]:w-6 baseui:data-[state=checked]:bg-primary baseui:data-[state=unchecked]:bg-input baseui:dark:data-[state=unchecked]:bg-input/80",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "baseui:pointer-events-none baseui:block baseui:rounded-full baseui:bg-background baseui:ring-0 baseui:transition-transform baseui:group-data-[size=default]/switch:size-4 baseui:group-data-[size=sm]/switch:size-3 baseui:data-[state=checked]:translate-x-[calc(100%-2px)] baseui:data-[state=unchecked]:translate-x-0 baseui:dark:data-[state=checked]:bg-primary-foreground baseui:dark:data-[state=unchecked]:bg-foreground"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
