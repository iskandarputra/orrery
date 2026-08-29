/**
 * The settings panes.
 *
 * One file each: a 736-line module where every pane lived meant that adding a
 * checkbox touched the same file as every other pane, and two people adding
 * settings collided every time.
 */
export { GeneralSection } from './general'
export { EditorSection } from './editor'
export { MarkdownSection } from './markdown'
export { NotesSection } from './notes'
export { LanguageServersSection } from './language-servers'
export { AiSection } from './ai'
export { AppearanceSection } from './appearance'
export { KeybindingsSection } from './keybindings'
export { AboutSection } from './about'
