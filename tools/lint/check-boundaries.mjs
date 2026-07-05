import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const coreRoot = join('packages', 'core')
const coreSourceRoot = join(coreRoot, 'src')
const boundaryPolicy = JSON.parse(readFileSync(join(scriptDir, 'core-boundary-policy.json'), 'utf8'))
const forbiddenImports = boundaryPolicy.coreForbiddenImports
const topLevelDomGlobals = new Set(boundaryPolicy.coreTopLevelDomGlobals)
const sourceFileExtensions = new Set(['.ts', '.tsx', '.js', '.mjs'])
const failures = []

function listWorkspaceRoots() {
  const workspaceFile = 'pnpm-workspace.yaml'

  if (!existsSync(workspaceFile)) {
    return ['packages', 'examples', 'tools'].filter((root) => existsSync(root))
  }

  const workspaceSource = readFileSync(workspaceFile, 'utf8')
  const patterns = [...workspaceSource.matchAll(/^\s*-\s*["']?([^"'\n]+)["']?\s*$/gmu)]
    .map((match) => match[1] ?? '')
    .filter((pattern) => pattern.length > 0)

  return [...new Set(patterns.flatMap((pattern) => expandWorkspacePattern(pattern)))]
}

function expandWorkspacePattern(pattern) {
  if (!pattern.includes('*')) {
    return existsSync(pattern) ? [pattern] : []
  }

  const [parent = '', rest = ''] = pattern.split('*')
  const normalizedParent = parent.endsWith('/') || parent.endsWith('\\')
    ? parent.slice(0, -1)
    : parent

  if (rest !== '' || !existsSync(normalizedParent)) {
    return []
  }

  return readdirSync(normalizedParent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(normalizedParent, entry.name))
}

function listFiles(dir) {
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
        return []
      }
      return listFiles(next)
    }
    return entry.isFile() ? [next] : []
  })
}

function listSourceFiles(dir) {
  return listFiles(dir).filter((file) => sourceFileExtensions.has(extname(file)))
}

function isForbiddenImport(specifier) {
  return forbiddenImports.some((blocked) => specifier === blocked || specifier.startsWith(`${blocked}/`))
}

function readScriptKind(file) {
  if (file.endsWith('.tsx')) {
    return ts.ScriptKind.TSX
  }
  if (file.endsWith('.jsx')) {
    return ts.ScriptKind.JSX
  }
  if (file.endsWith('.js') || file.endsWith('.mjs')) {
    return ts.ScriptKind.JS
  }

  return ts.ScriptKind.TS
}

function parseSourceFile(file, source) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, readScriptKind(file))
}

function readStringLiteralText(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined
}

function collectModuleSpecifiers(file, source) {
  const sourceFile = parseSourceFile(file, source)
  const specifiers = []

  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      const specifier = readStringLiteralText(node.moduleSpecifier)
      if (specifier !== undefined) {
        specifiers.push(specifier)
      }
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      const firstArgument = node.arguments[0]
      const specifier = firstArgument === undefined ? undefined : readStringLiteralText(firstArgument)
      if (specifier !== undefined) {
        specifiers.push(specifier)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return specifiers
}

function collectTopLevelDomReferences(file, source) {
  const sourceFile = parseSourceFile(file, source)
  const references = []

  for (const statement of sourceFile.statements) {
    inspectTopLevelNode(sourceFile, statement, references)
  }

  return references
}

function inspectTopLevelNode(sourceFile, node, references) {
  if (isDeclarationOnlyNode(node)) {
    return
  }

  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (declaration.initializer !== undefined) {
        inspectValueNode(sourceFile, declaration.initializer, references)
      }
    }
    return
  }

  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    inspectClassStaticMembers(sourceFile, node, references)
    return
  }

  if (ts.isFunctionDeclaration(node)) {
    return
  }

  if (ts.isEnumDeclaration(node)) {
    for (const member of node.members) {
      if (member.initializer !== undefined) {
        inspectValueNode(sourceFile, member.initializer, references)
      }
    }
    return
  }

  if (ts.isExportAssignment(node)) {
    inspectValueNode(sourceFile, node.expression, references)
    return
  }

  if (ts.isExpressionStatement(node)) {
    inspectValueNode(sourceFile, node.expression, references)
  }
}

function isDeclarationOnlyNode(node) {
  return ts.isImportDeclaration(node) ||
    ts.isExportDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isModuleDeclaration(node) ||
    isTypeOnlyVariableStatement(node)
}

function isTypeOnlyVariableStatement(node) {
  return ts.isVariableStatement(node) && node.declarationList.declarations.every((declaration) =>
    declaration.initializer === undefined
  )
}

function inspectValueNode(sourceFile, node, references) {
  if (ts.isTypeNode(node)) {
    return
  }

  if (
    ts.isFunctionLike(node) ||
    ts.isImportDeclaration(node) ||
    ts.isExportDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  ) {
    return
  }

  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    inspectClassStaticMembers(sourceFile, node, references)
    return
  }

  if (ts.isIdentifier(node) && topLevelDomGlobals.has(node.text)) {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    references.push({
      name: node.text,
      line: location.line + 1
    })
    return
  }

  if (ts.isPropertyAccessExpression(node)) {
    inspectValueNode(sourceFile, node.expression, references)
    return
  }

  if (ts.isPropertyAssignment(node)) {
    if (ts.isComputedPropertyName(node.name)) {
      inspectValueNode(sourceFile, node.name.expression, references)
    }
    inspectValueNode(sourceFile, node.initializer, references)
    return
  }

  if (ts.isShorthandPropertyAssignment(node)) {
    inspectValueNode(sourceFile, node.name, references)
    return
  }

  if (ts.isVariableDeclaration(node)) {
    if (node.initializer !== undefined) {
      inspectValueNode(sourceFile, node.initializer, references)
    }
    return
  }

  ts.forEachChild(node, (child) => {
    inspectValueNode(sourceFile, child, references)
  })
}

function inspectClassStaticMembers(sourceFile, node, references) {
  for (const member of node.members) {
    if (member.kind === ts.SyntaxKind.ClassStaticBlockDeclaration) {
      for (const statement of member.body.statements) {
        inspectTopLevelNode(sourceFile, statement, references)
      }
      continue
    }

    const isStatic = ts.canHaveModifiers(member) && (ts.getModifiers(member) ?? []).some((modifier) =>
      modifier.kind === ts.SyntaxKind.StaticKeyword
    )

    if (!isStatic || !ts.isPropertyDeclaration(member) || member.initializer === undefined) {
      continue
    }

    inspectValueNode(sourceFile, member.initializer, references)
  }
}

for (const sourceRoot of listWorkspaceRoots()) {
  for (const file of listFiles(sourceRoot)) {
    const isTestFile = /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file)
    const isInSourceDirectory = /(?:^|[/\\])src[/\\]/u.test(file)

    if (isTestFile && isInSourceDirectory) {
      failures.push(`${file}: 测试文件必须放在 test/ 或 tests/ 目录，不能放在 src/ 源码目录。`)
    }
  }
}

for (const file of listSourceFiles(coreSourceRoot)) {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file)) {
    continue
  }

  const source = readFileSync(file, 'utf8')
  for (const specifier of collectModuleSpecifiers(file, source)) {
    if (isForbiddenImport(specifier)) {
      failures.push(`${file}: forbidden core import '${specifier}'`)
    }
  }

  for (const reference of collectTopLevelDomReferences(file, source)) {
    failures.push(`${file}:${reference.line}: possible top-level DOM access '${reference.name}'`)
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('core boundary scan passed.')
