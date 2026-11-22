import { MenuIcon } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { isDesktop } from './api'
import { RemoteAccessDialog } from './remote/RemoteAccessDialog'

/** The header's menu, for what is used too rarely to earn a place in the bar. */
export function AppMenu() {
  // Outside the menu's content, which unmounts as the menu closes.
  const [dialog, setDialog] = useState<'remote' | 'about' | null>(null)
  const close = () => setDialog(null)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Menu"
          className="hover:bg-accent text-muted-foreground hover:text-foreground data-[state=open]:bg-selected data-[state=open]:text-foreground flex size-7 items-center justify-center rounded-sm [-webkit-app-region:no-drag]"
        >
          <MenuIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {isDesktop && <DropdownMenuItem onSelect={() => setDialog('remote')}>Remote access</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => setDialog('about')}>About Escritoire</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === 'remote' && <RemoteAccessDialog onClose={close} />}
      {dialog === 'about' && <AboutDialog onClose={close} />}
    </>
  )
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => open || onClose()}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Escritoire</DialogTitle>
          {/* Release versions are dates, so several builds can share one. */}
          <DialogDescription>
            Version {__APP_VERSION__}, built {__BUILD_TIME__}
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
