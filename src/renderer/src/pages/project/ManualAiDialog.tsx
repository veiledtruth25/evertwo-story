import { useEffect, useState } from 'react'
import { ClipboardCopy, ExternalLink, Check } from 'lucide-react'
import type { ProjectBundle } from '@shared/types'
import { Button, Modal, inputCls } from '../../components/ui'
import { errorText } from '../../lib/format'
import { useApp } from '../../store/app'
import { useProject } from '../../store/project'

const SITES = [
  { name: 'ChatGPT', url: 'https://chatgpt.com' },
  { name: 'Gemini', url: 'https://gemini.google.com' },
  { name: 'Claude', url: 'https://claude.ai' }
]

/**
 * Works without any API key: the user copies the prompt into an online chat AI, then pastes the JSON reply back.
 * The reply is applied exactly like an API result.
 */
export function ManualAiDialog({
  open,
  onClose,
  kind,
  mode = 'missing',
  onDone
}: {
  open: boolean
  onClose: () => void
  kind: 'script' | 'visuals'
  mode?: 'missing' | 'all'
  onDone: (bundle: ProjectBundle) => void
}) {
  const { project, flush } = useProject()
  const { toast } = useApp()
  const [prompt, setPrompt] = useState('')
  const [reply, setReply] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !project) return
    setReply('')
    setCopied(false)
    setPrompt('')
    void (async () => {
      try {
        await flush()
        setPrompt(await window.api.story.manualPrompt(project.id, kind, mode))
      } catch (e) {
        toast('error', errorText(e))
        onClose()
      }
    })()
  }, [open])

  if (!project) return null

  const copy = async (): Promise<void> => {
    await window.api.app.copyText(prompt)
    setCopied(true)
  }

  const apply = async (): Promise<void> => {
    setBusy(true)
    try {
      const bundle = await window.api.story.manualApply(project.id, kind, mode, reply)
      onDone(bundle)
      onClose()
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={760}
      title={kind === 'script' ? 'Susun naskah tanpa API' : 'Susun visual tanpa API'}
      subtitle="Pakai AI online yang kamu punya, misalnya ChatGPT, Gemini, atau Claude. Tanpa kunci API, tanpa biaya dari aplikasi ini."
    >
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">1. Salin prompt ini ke AI online</span>
        <textarea readOnly value={prompt} rows={7} className={`${inputCls} scroll-thin resize-none py-3 font-mono text-[12px] leading-relaxed`} aria-label="Prompt untuk AI online" />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!prompt} icon={copied ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />} onClick={() => void copy()}>
            {copied ? 'Tersalin' : 'Salin prompt'}
          </Button>
          {SITES.map((s) => (
            <Button key={s.name} icon={<ExternalLink className="size-4" />} onClick={() => void window.api.app.openExternal(s.url)}>
              {s.name}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">2. Tempel balasan AI di sini</span>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={7}
          placeholder='Tempel seluruh balasannya, mulai dari { sampai }'
          className={`${inputCls} scroll-thin resize-none py-3 font-mono text-[12px] leading-relaxed`}
          aria-label="Balasan dari AI online"
        />
        <p className="text-xs text-muted">Kalau AI menambahkan penjelasan atau tanda ```json, tidak apa-apa. Aplikasi mengambil bagian JSON-nya saja.</p>
      </div>
      <div className="flex justify-end gap-2.5">
        <Button onClick={onClose}>Batal</Button>
        <Button variant="primary" loading={busy} disabled={!reply.trim()} onClick={() => void apply()}>
          Terapkan balasan
        </Button>
      </div>
    </Modal>
  )
}
