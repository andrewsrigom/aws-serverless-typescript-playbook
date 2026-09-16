# Engineering rules

- Keep every scenario independently understandable, with its own source, fixtures, tests, and Terraform entry point.
- Use strict TypeScript and AWS SDK v3. Validate untrusted values; do not conceal invalid data with assertions.
- Verify AWS API and Terraform provider behavior in official documentation before changing integration contracts.
- Run pnpm check and pnpm terraform:check for affected infrastructure; record actual results.
- Do not deploy, publish, create remote repositories, or incur charges without explicit authorization.
- Preserve unrelated changes. Never create or use branches prefixed codex/.
- Keep this repository independent of other playbooks. Documentation and code are English.

## Code readability

- Leave one blank line after the complete import block and between top-level declarations, functions, classes, and types. Keep related imports together.
- Separate logical steps inside functions with one blank line, especially validation, setup, execution, and return. Keep tightly related statements together; do not insert blank lines after every statement.
- Avoid compressed one-line control flow and multiple statements on one line. Follow the language's conventions and preserve existing project formatting.
- Review visual spacing before finishing; a formatter alone does not guarantee these blank lines. Do not manually reformat generated or vendored files.
