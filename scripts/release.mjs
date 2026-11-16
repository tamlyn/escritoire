import { execFileSync } from 'node:child_process'

const today = new Date()
const tag = `v${today.getFullYear()}.${today.getMonth() + 1}.${today.getDate()}`

try {
  execFileSync('git', ['tag', tag], { stdio: 'inherit' })
} catch (error) {
  process.exit(error.status || 1)
}

console.log(`Created ${tag} at HEAD. To publish: git push origin ${tag}`)
