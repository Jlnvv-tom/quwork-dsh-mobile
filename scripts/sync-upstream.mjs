/**
 * Sync this fork onto the `upstream` remote in one command.
 *
 * Usage:
 *   node scripts/sync-upstream.mjs                       # latest upstream v* tag onto main
 *   node scripts/sync-upstream.mjs --target v0.8.6       # a specific tag or commit
 *   node scripts/sync-upstream.mjs --branch main         # a different base branch
 *   node scripts/sync-upstream.mjs --dry-run             # preview only, no branch/merge
 *
 * The script never pushes and never resolves conflicts: when the merge stops it
 * prints the conflicted files and leaves the merge in progress for you.
 */
import { spawnSync } from 'node:child_process'

const UPSTREAM = 'upstream'
const CONFLICT_HOTSPOTS = [
  'package.json',
  'package-lock.json',
  'cordis.patch.yml',
  'src/plugin.ts',
  'src/brand.ts',
  'src/release-update.ts',
  'apps/mobile/release.json',
  'apps/mobile/android/app/build.gradle.kts',
  'apps/mobile/android/app/src/main/res/values/strings.xml',
]

function parseOptions(argv) {
  const options = { target: undefined, base: 'main', dryRun: false, fetch: true }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--dry-run') options.dryRun = true
    else if (value === '--no-fetch') options.fetch = false
    else if (value === '--target') options.target = argv[++index]
    else if (value === '--branch') options.base = argv[++index]
    else throw new Error(`Unknown argument: ${value}`)
  }
  return options
}

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  if (result.error !== undefined && result.error !== null) throw result.error
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr ?? '').trim()}`)
  }
  return { status: result.status, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() }
}

function fail(message) {
  console.error(`sync-upstream: ${message}`)
  process.exit(1)
}

function latestUpstreamTag() {
  const tags = git(['tag', '--list', 'v*', '--sort=-v:refname']).stdout
  return tags.split('\n').filter(Boolean)[0]
}

function resolveTarget(requested) {
  const candidates = requested === undefined
    ? [latestUpstreamTag(), `${UPSTREAM}/HEAD`, `${UPSTREAM}/main`, `${UPSTREAM}/master`]
    : [requested]
  const found = candidates.filter(Boolean).find(candidate => git(
    ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], { allowFailure: true },
  ).status === 0)
  if (found === undefined) {
    fail(`无法解析目标 ${requested ?? `${UPSTREAM} 默认分支`}：本地没有 ${UPSTREAM} 的引用，请先联网执行 git fetch ${UPSTREAM} --tags`)
  }
  return found
}

function currentBranch() {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout
  return branch === 'HEAD' ? undefined : branch
}

function ensureCleanWorktree() {
  const dirty = git(['status', '--porcelain']).stdout
  if (dirty !== '') fail(`工作区有未提交改动，请先提交或 stash：\n${dirty}`)
}

function preview(base, target) {
  const basePoint = git(['merge-base', base, target]).stdout
  const commits = git(['rev-list', '--count', `${basePoint}..${target}`]).stdout
  console.log(`\n上游改动：${basePoint.slice(0, 7)}..${target}（${commits} 个提交）`)
  console.log(git(['log', '--oneline', '-10', `${basePoint}..${target}`]).stdout || '（无新提交）')
  const stat = git(['diff', '--stat', `${basePoint}..${target}`]).stdout
  if (stat !== '') console.log(`\n${stat}`)
  const hotspots = CONFLICT_HOTSPOTS.filter(file => git(['diff', '--name-only', `${basePoint}..${target}`, '--', file]).stdout !== '')
  if (hotspots.length > 0) console.log(`\n品牌化冲突热点：${hotspots.join('、')}`)
  return basePoint
}

function detectConflicts(base, target) {
  const probe = git(['merge-tree', '--write-tree', '--name-only', base, target], { allowFailure: true })
  if (probe.status === 0) {
    console.log('\n预检：无冲突，可直接执行同步。')
    return
  }
  if (probe.status !== 1) {
    console.log('\n预检：（当前 git 不支持 merge-tree --write-tree，跳过冲突预检）')
    return
  }
  const [tree, ...rest] = probe.stdout.split('\n')
  const files = rest.slice(1).filter(Boolean)
  console.log(`\n预检：预计有 ${files.length} 个文件冲突（tree ${tree?.slice(0, 7)}）`)
  for (const file of files) console.log(`  ${file}`)
}

function main() {
  const options = parseOptions(process.argv.slice(2))
  if (git(['remote'], { allowFailure: true }).stdout.split('\n').includes(UPSTREAM) === false) {
    fail(`缺少 ${UPSTREAM} remote，请先执行 git remote add ${UPSTREAM} https://github.com/saya-ch/dsh-mobile.git`)
  }
  if (!options.dryRun) ensureCleanWorktree()

  if (options.fetch) {
    console.log(`抓取 ${UPSTREAM} 的提交与 tag ...`)
    const fetched = git(['fetch', UPSTREAM, '--tags', '--prune'], { allowFailure: true })
    if (fetched.status !== 0) {
      fail(`抓取 ${UPSTREAM} 失败（${fetched.stderr}）。网络或代理受限时可先手动 fetch，或加 --no-fetch 使用已有的远端引用。`)
    }
  }

  const target = resolveTarget(options.target)

  if (options.dryRun) {
    preview('HEAD', target)
    detectConflicts('HEAD', target)
    console.log('\n（--dry-run：未切换分支、未合并）')
    return
  }

  git(['switch', options.base])
  git(['merge', '--ff-only', `origin/${options.base}`], { allowFailure: true })
  preview('HEAD', target)

  const branch = `sync/${target.replace(/^upstream\//u, '').replace(/[^0-9A-Za-z._-]/gu, '-')}`
  const branchExists = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFailure: true }).status === 0
  if (branchExists) {
    console.log(`\n复用已存在的分支 ${branch}`)
    git(['switch', branch])
    const caughtUp = git(['merge', '--ff-only', options.base], { allowFailure: true })
    if (caughtUp.status !== 0) {
      fail(`分支 ${branch} 与 ${options.base} 已分叉，请先处理它或删除后重试（git branch -D ${branch}）`)
    }
  } else {
    console.log(`\n创建分支 ${branch}（基于 ${options.base}）`)
    git(['switch', '-c', branch])
  }

  const merge = git(['merge', '--no-ff', '--no-edit', target], { allowFailure: true })
  console.log(merge.stdout)
  if (merge.stderr !== '') console.error(merge.stderr)

  if (merge.status !== 0) {
    const conflicted = git(['diff', '--name-only', '--diff-filter=U']).stdout
    console.error(`\n合并停在冲突上（分支 ${branch}）。冲突文件：`)
    for (const file of conflicted.split('\n').filter(Boolean)) console.error(`  ${file}`)
    console.error(`
手工解决后：
  git add <文件> && git merge --continue
放弃本次合并：
  git merge --abort
品牌化冲突通常集中在：${CONFLICT_HOTSPOTS.join('、')}`)
    process.exit(1)
  }

  console.log(`
同步完成：${branch} ← ${target}${currentBranch() === branch ? '' : `（当前分支 ${currentBranch()}）`}

下一步：
  npm ci
  npm run check:dsh-compatibility
  npm run verify
  git push origin ${branch}
  然后把 ${branch} 合回 main`)
}

try {
  main()
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
