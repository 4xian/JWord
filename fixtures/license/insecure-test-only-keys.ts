/**
 * 职责：提供仓库测试和示例专用的 insecure-test-only Ed25519 密钥 fixture。
 * 边界：只允许测试、demo 和 dry-run smoke 引用，不进入可发布包源码。
 * 协作模块：packages/license 的测试签发 helper、Gate 5/6 示例和发布 dry-run 脚本。
 * 性能/安全约束：这是公开测试私钥，禁止用于真实客户授权或发布环境。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#34-lic-1-license-密码学签名phase-1f-m-l按-d1-执行。
 */

/** RFC 8032 测试 seed，只能用于 insecure-test-only 授权 fixture。 */
export const INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED = 'nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A'

/** RFC 8032 测试公钥，用于核对默认验签 fixture。 */
export const INSECURE_TEST_ONLY_LICENSE_PUBLIC_KEY = '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo'
