"use client"

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
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "plugins:z-50 plugins:max-h-(--radix-dropdown-menu-content-available-height) plugins:min-w-[8rem] plugins:origin-(--radix-dropdown-menu-content-transform-origin) plugins:overflow-x-hidden plugins:overflow-y-auto plugins:rounded-md plugins:border plugins:bg-popover plugins:p-1 plugins:text-popover-foreground plugins:shadow-md plugins:data-[side=bottom]:slide-in-from-top-2 plugins:data-[side=left]:slide-in-from-right-2 plugins:data-[side=right]:slide-in-from-left-2 plugins:data-[side=top]:slide-in-from-bottom-2 plugins:data-[state=closed]:animate-out plugins:data-[state=closed]:fade-out-0 plugins:data-[state=closed]:zoom-out-95 plugins:data-[state=open]:animate-in plugins:data-[state=open]:fade-in-0 plugins:data-[state=open]:zoom-in-95",
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
        "plugins:relative plugins:flex plugins:cursor-default plugins:items-center plugins:gap-2 plugins:rounded-sm plugins:px-2 plugins:py-1.5 plugins:text-sm plugins:outline-hidden plugins:select-none plugins:focus:bg-accent plugins:focus:text-accent-foreground plugins:data-[disabled]:pointer-events-none plugins:data-[disabled]:opacity-50 plugins:data-[inset]:pl-8 plugins:data-[variant=destructive]:text-destructive plugins:data-[variant=destructive]:focus:bg-destructive/10 plugins:data-[variant=destructive]:focus:text-destructive plugins:dark:data-[variant=destructive]:focus:bg-destructive/20 plugins:[&_svg]:pointer-events-none plugins:[&_svg]:shrink-0 plugins:[&_svg:not([class*=size-])]:size-4 plugins:[&_svg:not([class*=text-])]:text-muted-foreground plugins:data-[variant=destructive]:*:[svg]:text-destructive!",
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
        "plugins:relative plugins:flex plugins:cursor-default plugins:items-center plugins:gap-2 plugins:rounded-sm plugins:py-1.5 plugins:pr-2 plugins:pl-8 plugins:text-sm plugins:outline-hidden plugins:select-none plugins:focus:bg-accent plugins:focus:text-accent-foreground plugins:data-[disabled]:pointer-events-none plugins:data-[disabled]:opacity-50 plugins:[&_svg]:pointer-events-none plugins:[&_svg]:shrink-0 plugins:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="plugins:pointer-events-none plugins:absolute plugins:left-2 plugins:flex plugins:size-3.5 plugins:items-center plugins:justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="plugins:size-4" />
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
        "plugins:relative plugins:flex plugins:cursor-default plugins:items-center plugins:gap-2 plugins:rounded-sm plugins:py-1.5 plugins:pr-2 plugins:pl-8 plugins:text-sm plugins:outline-hidden plugins:select-none plugins:focus:bg-accent plugins:focus:text-accent-foreground plugins:data-[disabled]:pointer-events-none plugins:data-[disabled]:opacity-50 plugins:[&_svg]:pointer-events-none plugins:[&_svg]:shrink-0 plugins:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      {...props}
    >
      <span className="plugins:pointer-events-none plugins:absolute plugins:left-2 plugins:flex plugins:size-3.5 plugins:items-center plugins:justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="plugins:size-2 plugins:fill-current" />
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
        "plugins:px-2 plugins:py-1.5 plugins:text-sm plugins:font-medium plugins:data-[inset]:pl-8",
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
      className={cn("plugins:-mx-1 plugins:my-1 plugins:h-px plugins:bg-border", className)}
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
        "plugins:ml-auto plugins:text-xs plugins:tracking-widest plugins:text-muted-foreground",
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
        "plugins:flex plugins:cursor-default plugins:items-center plugins:gap-2 plugins:rounded-sm plugins:px-2 plugins:py-1.5 plugins:text-sm plugins:outline-hidden plugins:select-none plugins:focus:bg-accent plugins:focus:text-accent-foreground plugins:data-[inset]:pl-8 plugins:data-[state=open]:bg-accent plugins:data-[state=open]:text-accent-foreground plugins:[&_svg]:pointer-events-none plugins:[&_svg]:shrink-0 plugins:[&_svg:not([class*=size-])]:size-4 plugins:[&_svg:not([class*=text-])]:text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="plugins:ml-auto plugins:size-4" />
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
        "plugins:z-50 plugins:min-w-[8rem] plugins:origin-(--radix-dropdown-menu-content-transform-origin) plugins:overflow-hidden plugins:rounded-md plugins:border plugins:bg-popover plugins:p-1 plugins:text-popover-foreground plugins:shadow-lg plugins:data-[side=bottom]:slide-in-from-top-2 plugins:data-[side=left]:slide-in-from-right-2 plugins:data-[side=right]:slide-in-from-left-2 plugins:data-[side=top]:slide-in-from-bottom-2 plugins:data-[state=closed]:animate-out plugins:data-[state=closed]:fade-out-0 plugins:data-[state=closed]:zoom-out-95 plugins:data-[state=open]:animate-in plugins:data-[state=open]:fade-in-0 plugins:data-[state=open]:zoom-in-95",
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
