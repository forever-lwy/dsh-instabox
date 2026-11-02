import {build} from 'esbuild'
import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const directory=fileURLToPath(new URL('../',import.meta.url))
const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'))
const result=await build({
  absWorkingDir:directory,entryPoints:['src/client/index.tsx'],bundle:true,platform:'browser',format:'cjs',target:'es2022',write:false,minify:true,legalComments:'none',
  external:['react','react/jsx-runtime','react-dom','@deepseek-ai/cordis','zod','@deepseek-ai/dsh-client-store','@deepseek-ai/dsh-client-ui-slots','@deepseek-ai/dsh-client-ui-primitives'],
  metafile:true,
})
const inputs=Object.keys(result.metafile.inputs)
if(inputs.some(path=>/instabox-sdk|src\/(api|service|store|tools)\./.test(path)))throw new Error('Host modules must never enter the browser bundle.')
await writeFile(new URL('../lib/client.js',import.meta.url),`window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;${result.outputFiles[0].text}\nreturn module.exports;}});\n`)
console.log('Built browser plugin: lib/client.js')
