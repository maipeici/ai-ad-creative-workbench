import fs from 'node:fs'
import path from 'node:path'

/** Seed missing files only. Existing projects, facts and uploads belong to the user. */
export function initializeRuntimeData({ runtimeDir, seedDir }) {
  fs.mkdirSync(path.join(runtimeDir, 'media'), { recursive: true })
  for (const name of ['assets.json', 'product-facts.json']) {
    const destination = path.join(runtimeDir, name)
    if (fs.existsSync(destination)) continue
    try {
      fs.copyFileSync(path.join(seedDir, name), destination, fs.constants.COPYFILE_EXCL)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
  try {
    fs.writeFileSync(path.join(runtimeDir, 'projects.json'), '[]\n', { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
}
