import { createFileRoute } from '@tanstack/react-router'
import { EditorView } from '@/editor/EditorView'

export const Route = createFileRoute('/')({ component: EditorView })
