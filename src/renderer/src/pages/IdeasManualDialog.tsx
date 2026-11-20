import { useEffect, useState } from 'react'
import { Check, ClipboardCopy, ExternalLink } from 'lucide-react'
import type { TrendingIdeas } from '@shared/types'
import { Button, Modal, inputCls } from '../components/ui'
import { errorText } from '../lib/format'
import { useApp } from '../store/app'

const SITES = [
  { name: 'ChatGPT', url: 'https://chatgpt.com' },
  { name: 'Gemini', url: 'https://gemini.google.com' },
  { name: 'Claude', url: 'https://claude.ai' }
]

/** Ideas without the app's own model: copy the prompt into an online chat AI, paste its JSON reply back. */
export function IdeasManualDialog({ open, onClose, language, onDone }: { open: boolean; onClose: () => void; language: string; onDone: (ideas: TrendingIdeas) => void }) {
  const { toast } = useApp()
  const [prompt, setPrompt] = useState('')
  const [reply, setReply] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setReply('')
    setCopied(false)
    setPrompt('')
    window.api.ideas
      .manualPrompt(language)
      .then(setPrompt)
      .catch((e) => {
        toast('error', errorText(e))
        onClose()
      })
  }, [open])

  const apply = async (): Promise<void> => {
    setBusy(true)
    try {
      onDone(await window.api.ideas.manualApply(language, reply))
      onClose()
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} width={760} title="Cari ide tanpa API" subtitle="Pakai AI online yang kamu punya. Prompt-nya sudah memuat topik yang sedang trending kalau Google Trends terjangkau.">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">1. Salin prompt ini ke AI online</span>
        <textarea readOnly value={prompt} rows={7} className={`${inputCls} scroll-thin resize-none py-3 font-mono text-[12px] leading-relaxed`} aria-label="Prompt untuk AI online" />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={!prompt}
            icon={copied ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}
            onClick={() => void window.api.app.copyText(prompt).then(() => setCopied(true))}
          >
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
          placeholder="Tempel seluruh balasannya, mulai dari { sampai }"
          className={`${inputCls} scroll-thin resize-none py-3 font-mono text-[12px] leading-relaxed`}
          aria-label="Balasan dari AI online"
        />
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
