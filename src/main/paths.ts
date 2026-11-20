import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Everything the server writes (database, projects, models, exports) lives under one folder, mounted as a volume. */
export function dataDir(): string {
  const dir = resolve(process.env.DATA_DIR ?? join(process.cwd(), 'data'))
  mkdirSync(dir, { recursive: true })
  return dir
}

export function dbPath(): string {
  return join(dataDir(), 'studio.db')
}

export function projectsRoot(): string {
  const dir = join(dataDir(), 'projects')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function projectDir(projectId: string): string {
  const dir = join(projectsRoot(), projectId)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Finished MP4 files. The browser downloads them from here; the server never writes outside the data folder. */
export function exportsDir(): string {
  const dir = join(dataDir(), 'exports')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Absolute path of an asset stored relative to its project folder. */
export function assetAbsPath(projectId: string, localPath: string): string {
  return join(projectsRoot(), projectId, localPath)
}

export function resourcesDir(): string {
  return resolve(process.env.RESOURCES_DIR ?? join(process.cwd(), 'resources'))
}

export function fontsDir(): string {
  return join(resourcesDir(), 'fonts')
}

/** URL the browser uses for a stored asset (served by the /media route in server.ts). */
export function assetUrl(projectId: string, localPath: string): string {
  const rel = `${projectId}/${localPath}`.split(/[\\/]/).map(encodeURIComponent).join('/')
  return `/media/asset/${rel}`
}

/** FFmpeg comes from the system (the Docker image installs it); FFMPEG_PATH overrides for local setups. */
export function ffmpegBin(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg'
}
