# JWord Vanilla Example

Gate 0 Vite demo for the framework-free integration path.

Public API usage:

```ts
import { createEditor } from '@4xian/jword-core';

const host = document.querySelector<HTMLElement>('#jword-editor');
if (host === null) {
  throw new Error('Missing editor host.');
}

const editor = createEditor();
editor.mount(host);

window.addEventListener('beforeunload', () => editor.destroy(), { once: true });
```

Scope:

- Uses `@4xian/jword-core` for the Editor lifecycle.
- Shows the canvas host owned by core.
- Does not use `contenteditable`.
- Does not implement Gate 1 transaction, Gate 2 layout/render, or Gate 3 input behavior.

Commands:

```sh
pnpm --filter @4xian/jword-example-vanilla dev
pnpm --filter @4xian/jword-example-vanilla build
```
