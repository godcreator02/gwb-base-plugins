import * as React from "react"
import { cn } from "cn"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  container,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
  /** 浮层挂哪。不给就是 radix 缺省（body）；多桌面下该指 args.shell.portal，浮层才跟着本桌走 */
  container?: HTMLElement
}) {
  return (
    <DropdownMenuPrimitive.Portal container={container}>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "hello:z-50 hello:max-h-(--radix-dropdown-menu-content-available-height) hello:min-w-[8rem] hello:origin-(--radix-dropdown-menu-content-transform-origin) hello:overflow-x-hidden hello:overflow-y-auto hello:rounded-md hello:border hello:bg-popover hello:p-1 hello:text-popover-foreground hello:shadow-md hello:data-[side=bottom]:slide-in-from-top-2 hello:data-[side=left]:slide-in-from-right-2 hello:data-[side=right]:slide-in-from-left-2 hello:data-[side=top]:slide-in-from-bottom-2 hello:data-[state=closed]:animate-out hello:data-[state=closed]:fade-out-0 hello:data-[state=closed]:zoom-out-95 hello:data-[state=open]:animate-in hello:data-[state=open]:fade-in-0 hello:data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "hello:relative hello:flex hello:cursor-default hello:items-center hello:gap-2 hello:rounded-sm hello:px-2 hello:py-1.5 hello:text-sm hello:outline-hidden hello:select-none hello:focus:bg-accent hello:focus:text-accent-foreground hello:data-[disabled]:pointer-events-none hello:data-[disabled]:opacity-50 hello:data-[inset]:pl-8 hello:data-[variant=destructive]:text-destructive hello:data-[variant=destructive]:focus:bg-destructive/10 hello:data-[variant=destructive]:focus:text-destructive hello:dark:data-[variant=destructive]:focus:bg-destructive/20 hello:[&_svg]:pointer-events-none hello:[&_svg]:shrink-0 hello:[&_svg:not([class*=size-])]:size-4 hello:[&_svg:not([class*=text-])]:text-muted-foreground hello:data-[variant=destructive]:*:[svg]:text-destructive!",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        "hello:relative hello:flex hello:cursor-default hello:items-center hello:gap-2 hello:rounded-sm hello:py-1.5 hello:pr-2 hello:pl-8 hello:text-sm hello:outline-hidden hello:select-none hello:focus:bg-accent hello:focus:text-accent-foreground hello:data-[disabled]:pointer-events-none hello:data-[disabled]:opacity-50 hello:[&_svg]:pointer-events-none hello:[&_svg]:shrink-0 hello:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="hello:pointer-events-none hello:absolute hello:left-2 hello:flex hello:size-3.5 hello:items-center hello:justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="hello:size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "hello:relative hello:flex hello:cursor-default hello:items-center hello:gap-2 hello:rounded-sm hello:py-1.5 hello:pr-2 hello:pl-8 hello:text-sm hello:outline-hidden hello:select-none hello:focus:bg-accent hello:focus:text-accent-foreground hello:data-[disabled]:pointer-events-none hello:data-[disabled]:opacity-50 hello:[&_svg]:pointer-events-none hello:[&_svg]:shrink-0 hello:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      {...props}
    >
      <span className="hello:pointer-events-none hello:absolute hello:left-2 hello:flex hello:size-3.5 hello:items-center hello:justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="hello:size-2 hello:fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "hello:px-2 hello:py-1.5 hello:text-sm hello:font-medium hello:data-[inset]:pl-8",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("hello:-mx-1 hello:my-1 hello:h-px hello:bg-border", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "hello:ml-auto hello:text-xs hello:tracking-widest hello:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "hello:flex hello:cursor-default hello:items-center hello:gap-2 hello:rounded-sm hello:px-2 hello:py-1.5 hello:text-sm hello:outline-hidden hello:select-none hello:focus:bg-accent hello:focus:text-accent-foreground hello:data-[inset]:pl-8 hello:data-[state=open]:bg-accent hello:data-[state=open]:text-accent-foreground hello:[&_svg]:pointer-events-none hello:[&_svg]:shrink-0 hello:[&_svg:not([class*=size-])]:size-4 hello:[&_svg:not([class*=text-])]:text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="hello:ml-auto hello:size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        "hello:z-50 hello:min-w-[8rem] hello:origin-(--radix-dropdown-menu-content-transform-origin) hello:overflow-hidden hello:rounded-md hello:border hello:bg-popover hello:p-1 hello:text-popover-foreground hello:shadow-lg hello:data-[side=bottom]:slide-in-from-top-2 hello:data-[side=left]:slide-in-from-right-2 hello:data-[side=right]:slide-in-from-left-2 hello:data-[side=top]:slide-in-from-bottom-2 hello:data-[state=closed]:animate-out hello:data-[state=closed]:fade-out-0 hello:data-[state=closed]:zoom-out-95 hello:data-[state=open]:animate-in hello:data-[state=open]:fade-in-0 hello:data-[state=open]:zoom-in-95",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
