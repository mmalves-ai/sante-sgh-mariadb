import vue from '@vitejs/plugin-vue';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Loopback por padrão (convencoes.md §10): web 5300; /api vai para a API em 3300. WEB_PORTA e API_PORTA trocam as
// portas (E2E de um worktree enquanto o dev do dono segue no ar nas portas padrão).
// Dev do dono na porta externa da VM (regra do dono, 23/10/2026): WEB_ESCUTA=0.0.0.0 abre o web (nome sem _HOST: a trava de saídas confere toda chave *_HOST) (a API segue
// em loopback, atrás do proxy) e WEB_HTTPS_CERT/WEB_HTTPS_CHAVE servem em HTTPS, porque o cookie da sessão é
// sempre Secure (M05, regra 8) e o navegador só o aceita em https fora do localhost.
const portaWeb = Number(process.env['WEB_PORTA'] ?? 5300);
const portaApi = Number(process.env['API_PORTA'] ?? 3300);
// xfwd: o proxy põe o endereço de quem pediu no X-Forwarded-For (a API confia só no salto do loopback; M49.3): o
// limite de taxa e a origem mascarada do verificador público e o endereço da estação na trilha são os do visitante.
const api = { '/api': { target: `http://127.0.0.1:${portaApi}`, changeOrigin: false, xfwd: true } };
const hostWeb = process.env['WEB_ESCUTA'] ?? '127.0.0.1';
const certificado = process.env['WEB_HTTPS_CERT'];
const chave = process.env['WEB_HTTPS_CHAVE'];
const https =
  certificado && chave ? { cert: readFileSync(certificado), key: readFileSync(chave) } : undefined;
const raiz = resolve(import.meta.dirname, '../..');
// Fora do loopback (rede local), o servidor de desenvolvimento não pode entregar o repositório pelo /@fs/ (regras 5 e
// 8): só o web, os pacotes e as dependências; o resto (dump/, referencias/, docs/, .tmp/, certs/, tools/, *.sql) é
// recusado. O caminho preferido pela rede é o bundle construído (vite preview), que só serve o dist (subir-login.sh).
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(hostWeb);
const fsRede = {
  strict: true,
  allow: [import.meta.dirname, resolve(raiz, 'packages'), resolve(raiz, 'node_modules')],
  deny: [
    // padrão do Vite (repetido porque a lista substitui a padrão)
    '.env',
    '.env.*',
    '*.{crt,pem}',
    '**/.git/**',
    // material interno e dados fora do git
    '*.key',
    '*.sql',
    '*.dmp',
    '**/dump/**',
    '**/referencias/**',
    '**/docs/**',
    '**/.tmp/**',
    '**/certs/**',
    '**/tools/**',
  ],
};
const versaoDe = (arquivo: string) =>
  (JSON.parse(readFileSync(resolve(raiz, arquivo), 'utf8')) as { version: string }).version;

function identificacao(): string {
  const versao = versaoDe('package.json');
  try {
    const git = (...a: string[]) =>
      execFileSync('git', a, { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const commit = git('rev-parse', '--short=12', 'HEAD').trim();
    return `${versao}+${commit}${git('status', '--porcelain').trim() ? '-dirty' : ''}`;
  } catch {
    return `${versao}+build.${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  }
}

export default defineConfig({
  root: import.meta.dirname,
  // Nunca carregar arquivos .env (o da raiz é do legado; regra 1.8).
  envDir: false,
  plugins: [vue()],
  resolve: { tsconfigPaths: true },
  define: {
    __SGH_WEB_VERSAO__: JSON.stringify(identificacao()),
    __SGH_OPENVUE__: JSON.stringify(versaoDe('node_modules/openvue/package.json')),
    __SGH_VUE__: JSON.stringify(versaoDe('node_modules/vue/package.json')),
  },
  server: {
    host: hostWeb,
    port: portaWeb,
    strictPort: true,
    proxy: api,
    ...(https ? { https } : {}),
    ...(loopback ? {} : { fs: fsRede }),
  },
  // O preview só serve o bundle (dist): é o modo usado pela rede (subir-login.sh, WEB_MODO=preview).
  preview: { host: hostWeb, port: portaWeb, strictPort: true, proxy: api, ...(https ? { https } : {}) },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1500 },
});
