import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const looseVersionPattern = /^[~^]/u
const semverPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u
const failures = []

if (packageJson.packageManager !== 'pnpm@9.14.2') {
  failures.push('packageManager must stay pnpm@9.14.2 for this Gate 0 pass.')
}

for (const section of dependencySections) {
  const dependencies = packageJson[section] ?? {}
  for (const [name, version] of Object.entries(dependencies)) {
    if (typeof version !== 'string') {
      failures.push(`${section}.${name} must be a string version.`)
      continue
    }
    if (looseVersionPattern.test(version)) {
      failures.push(`${section}.${name} uses a loose version: ${version}`)
      continue
    }
    if (!semverPattern.test(version)) {
      failures.push(`${section}.${name} must use an exact semver version: ${version}`)
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('package dependency versions are exact.')
