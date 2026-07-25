import { readFileSync } from 'node:fs'

import js from '@eslint/js'
import globals from 'globals'
import stylistic from '@stylistic/eslint-plugin'
import tseslint from 'typescript-eslint'

const boundaryPolicy = JSON.parse(readFileSync(new URL('./tools/lint/core-boundary-policy.json', import.meta.url), 'utf8'))
const corePathPattern = /(?:^|[/\\])packages[/\\]core(?:[/\\]|$)/u
const coreForbiddenImports = boundaryPolicy.coreForbiddenImports
const domIdentifiers = new Set(boundaryPolicy.coreTopLevelDomGlobals)

function isCoreFile(filename) {
  return corePathPattern.test(filename)
}

function inspectTopLevelNode(node, report, visited = new Set()) {
  if (!node || typeof node !== 'object' || visited.has(node)) {
    return
  }
  visited.add(node)

  if (
    node.type?.startsWith('TS') ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression' ||
    (node.type === 'FunctionDeclaration' && node.id) ||
    node.type === 'TSInterfaceDeclaration' ||
    node.type === 'TSTypeAliasDeclaration' ||
    node.type === 'ImportDeclaration' ||
    node.type === 'ExportAllDeclaration'
  ) {
    return
  }

  if (node.type === 'ExportNamedDeclaration') {
    if (node.declaration !== null && node.declaration !== undefined) {
      inspectTopLevelNode(node.declaration, report, visited)
    }
    return
  }

  if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
    inspectClassStaticNodes(node, report, visited)
    return
  }

  if (node.type === 'Identifier' && domIdentifiers.has(node.name)) {
    report(node, node.name)
    return
  }

  for (const [key, value] of Object.entries(node)) {
    if (
      key === 'parent' ||
      key === 'loc' ||
      key === 'range' ||
      key === 'tokens' ||
      key === 'comments'
    ) {
      continue
    }
    if (Array.isArray(value)) {
      for (const child of value) {
        inspectTopLevelNode(child, report, visited)
      }
      continue
    }
    inspectTopLevelNode(value, report, visited)
  }
}

function inspectClassStaticNodes(node, report, visited) {
  for (const member of node.body?.body ?? []) {
    if (member.type === 'StaticBlock') {
      inspectTopLevelNode(member, report, visited)
      continue
    }
    if (
      member.static === true &&
      (member.type === 'PropertyDefinition' || member.type === 'AccessorProperty') &&
      member.value !== null &&
      member.value !== undefined
    ) {
      inspectTopLevelNode(member.value, report, visited)
    }
  }
}

const jwordRules = {
  rules: {
    'file-header': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Require a leading file header comment in TypeScript files.'
        },
        schema: []
      },
      create(context) {
        return {
          Program(node) {
            const sourceText = context.sourceCode.text
            if (/^\s*(?:\/\*|\/\/)/u.test(sourceText)) {
              return
            }
            context.report({
              node,
              message:
                'TypeScript files must start with a file header comment covering responsibility, boundary, collaborators, constraints, and specs.'
            })
          }
        }
      }
    },
    'no-core-top-level-dom': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Block top-level DOM access inside packages/core.'
        },
        schema: []
      },
      create(context) {
        if (!isCoreFile(context.filename)) {
          return {}
        }
        return {
          Program(node) {
            for (const statement of node.body) {
              inspectTopLevelNode(statement, (badNode, name) => {
                context.report({
                  node: badNode,
                  message: `Core must not access DOM global '${name}' at top level. Move runtime DOM work behind mount().`
                })
              })
            }
          }
        }
      }
    },
    'no-core-forbidden-imports': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Block forbidden package imports inside packages/core.'
        },
        schema: []
      },
      create(context) {
        if (!isCoreFile(context.filename)) {
          return {}
        }
        function reportForbiddenImport(node, source) {
          if (typeof source !== 'string') {
            return
          }
          const isForbidden = coreForbiddenImports.some(
            (blocked) => source === blocked || source.startsWith(`${blocked}/`)
          )
          if (isForbidden) {
            context.report({
              node,
              message: `Core must not import '${source}'. Keep core framework-agnostic and free of docx/pdf/collab/demo dependencies.`
            })
          }
        }

        return {
          ImportDeclaration(node) {
            reportForbiddenImport(node, node.source.value)
          },
          ExportNamedDeclaration(node) {
            reportForbiddenImport(node, node.source?.value)
          },
          ExportAllDeclaration(node) {
            reportForbiddenImport(node, node.source?.value)
          },
          ImportExpression(node) {
            reportForbiddenImport(node, node.source?.value)
          }
        }
      }
    }
  }
}

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '**/dist/**',
      'coverage/**',
      '**/coverage/**',
      'playwright-report/**',
      'test-results/**',
      'logs/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'quotes': ['error', 'single', { 'avoidEscape': true }],
      'comma-dangle': ['error', 'never'],
      'semi': ['error', 'never']
    }
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      },
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      '@stylistic': stylistic,
      'jword-boundaries': jwordRules
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      'quotes': ['error', 'single', { 'avoidEscape': true }],
      'comma-dangle': ['error', 'never'],
      'semi': ['error', 'never'],
      '@stylistic/member-delimiter-style': [
        'error',
        {
          'multiline': {
            'delimiter': 'none',
            'requireLast': false
          },
          'singleline': {
            'delimiter': 'comma',
            'requireLast': false
          }
        }
      ],
      'jword-boundaries/file-header': 'error',
      'jword-boundaries/no-core-top-level-dom': 'error',
      'jword-boundaries/no-core-forbidden-imports': 'error'
    }
  }
)
