import { Prec, type Extension } from '@codemirror/state'
import { vim } from '@replit/codemirror-vim'

/**
 * Vim keybindings, for people who cannot type without them.
 *
 * Applied to prose as well as code. Someone who edits in vim edits everything
 * in vim, and a note is not a special case for them.
 *
 * `Prec.high` because vim has to see a key before the app's own bindings do:
 * without it, `Ctrl+F` opens search rather than paging down, and half the
 * normal-mode keys are swallowed by whatever else claimed them.
 */
export function vimMode(enabled: boolean): Extension {
  return enabled ? Prec.high(vim({ status: true })) : []
}
