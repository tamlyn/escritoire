import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Without this, `text-ui` reads as a colour and removes the element's text colour.
const twMerge = extendTailwindMerge({ extend: { classGroups: { 'font-size': [{ text: ['ui'] }] } } })

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
