# {{title}}

{{description}}

## Develop

```bash
npm install                    # dependencies, for the tests
npm test                       # runs the plugin against a fake Volumio
npx volumio-plugin check .     # the checks the store runs on every submission
```

`volumio-plugin.json` describes the plugin: edit it, never `package.json`'s name or version. The package for Volumio is built from it.
