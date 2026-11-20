import { useEffect, useState } from 'react'
import { Check, ClipboardCopy, Download, Upload } from 'lucide-react'
import { Button, Modal, inputCls } from '../../components/ui'
import { errorText } from '../../lib/format'
import { pickFile } from '../../lib/pickFile'
import { useApp } from '../../store/app'
import { useProject } from '../../store/project'

export type MediaTarget = 'clip-image' | 'clip-video' | 'sheet'

const COPY: Record<MediaTarget, { title: string; accept: string; upload: string; done: string }> = {
  'clip-image': { title: 'Gambar klip tanpa API', accept: '.png,.jpg,.jpeg,.webp,image/*', upload: 'Unggah gambar', done: 'Gambar terpasang di klip.' },
  'clip-video': { title: 'Video klip tanpa API', accept: '.mp4,.mov,.webm,video/*', upload: 'Unggah video', done: 'Video terpasang di klip.' },
  sheet: { title: 'Lembar karakter tanpa API', accept: '.png,.jpg,.jpeg,.webp,image/*', upload: 'Unggah lembar', done: 'Lembar karakter terpasang.' }
}

/**
 * Works without a Higgsfield key: shows the prompt to use in any other image or video tool, then takes the file
 * that tool made and attaches it like a generated result.
 */
export function ManualMediaDialog({ target, id, onClose }: { target: MediaTarget | null; id: string; onClose: () => void }) {
  const { flush } = useProject()
  const { toast } = useApp()
  const [info, setInfo] = useState<{ prompt: string; hint: string; imageUrl: string | null } | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!target) return
    setInfo(null)
    setCopied(false)
    void (async () => {
      try {
        await flush()
        setInfo(await window.api.generate.manualPrompt(target, id))
      } catch (e) {
        toast('error', errorText(e))
        onClose()
      }
    })()
  }, [target, id])

  if (!target) return null
  const t = COPY[target]

  const upload = async (): Promise<void> => {
    const file = await pickFile(t.accept)
    if (!file) return
    setBusy(true)
    try {
      await window.api.assets.uploadMedia(target, id, file)
      toast('success', t.done)
      onClose()
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} width={720} title={t.title} subtitle="Buat di tool lain yang kamu punya, lalu unggah hasilnya ke sini.">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">1. Salin prompt ini ke tool pembuat {target === 'clip-video' ? 'video' : 'gambar'}</span>
        <textarea readOnly value={info?.prompt ?? 'Menyiapkan prompt…'} rows={8} className={`${inputCls} scroll-thin resize-none py-3 font-mono text-[12px] leading-relaxed`} aria-label="Prompt" />
        {info && <p className="text-[13px] text-ink-2">{info.hint}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={!info}
            icon={copied ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}
            onClick={() => {
              if (!info) return
              void window.api.app.copyText(info.prompt).then(() => setCopied(true))
            }}
          >
            {copied ? 'Tersalin' : 'Salin prompt'}
          </Button>
          {info?.imageUrl && (
            <a href={info.imageUrl} download className="inline-flex">
              <Button icon={<Download className="size-4" />} tabIndex={-1}>
                Unduh gambar klip (frame awal)
              </Button>
            </a>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">2. Unggah hasilnya</span>
        <p className="text-[13px] text-ink-2">
          {target === 'clip-video' ? 'File MP4, MOV, atau WEBM. Kalau lebih pendek dari klip, frame terakhir ditahan.' : 'File PNG, JPG, atau WEBP.'} Hasil lama tetap tersimpan di riwayat versi.
        </p>
        <div>
          <Button variant="accent" loading={busy} disabled={!info} icon={<Upload className="size-4" />} onClick={() => void upload()}>
            {t.upload}
          </Button>
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={onClose}>Tutup</Button>
      </div>
    </Modal>
  )
}
