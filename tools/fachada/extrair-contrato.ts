// M58-F4: extrai o contrato da API de integração da Hal-AI (as cinco superfícies OpenAPI do repositório irmão, só
// lido) para packages/contratos/src/integracao/fachada-contrato.json: método, caminho, parâmetros (nome, onde,
// obrigatório, tipo, valores), os campos do corpo e a FORMA de cada resposta de exemplo (chaves e tipos, nunca os
// valores: o exemplo pode trazer nome de pessoa). É a base dos contratos da fachada (cap-12: "os contratos são
// extraídos das especificações OpenAPI das cinco superfícies").
// Uso: node tools/fachada/extrair-contrato.ts [pasta da API original]
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

interface Esquema {
  type?: string;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, unknown>;
}
interface Operacao {
  summary?: string;
  parameters?: { name: string; in: string; required?: boolean; schema?: Esquema }[];
  requestBody?: { content?: Record<string, { schema?: Esquema }> };
  responses?: Record<string, { content?: Record<string, { example?: unknown }> }>;
}

/** A forma de um valor de exemplo: objeto → chaves com a forma; lista → a forma do 1º item; senão o tipo. */
type Forma = string | Forma[] | { [k: string]: Forma };
function forma(v: unknown): Forma {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? [forma(v[0])] : [];
  if (typeof v === 'object')
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, forma(x)]));
  return typeof v;
}

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(
  process.argv[2] ?? process.env['SANTE_API_DIR'] ?? resolve(aqui, '../../../../sante-api'),
);
const exigir = createRequire(join(raiz, 'package.json'));
const docs = {
  atendimento: 'src/openapi.js',
  gestao: 'src/openapi-gestao.js',
  acoes: 'src/openapi-acoes.js',
  auditoria: 'src/openapi-auditoria.js',
} as const;

const operacoes: unknown[] = [];
for (const [superficie, arq] of Object.entries(docs)) {
  const d = exigir(join(raiz, arq)) as { paths?: Record<string, Record<string, Operacao>> };
  for (const [caminho, metodos] of Object.entries(d.paths ?? {}))
    for (const [m, op] of Object.entries(metodos)) {
      if (!['get', 'post'].includes(m)) continue;
      const corpo = op.requestBody?.content?.['application/json']?.schema;
      operacoes.push({
        superficie: caminho.startsWith('/health') ? 'saude' : superficie,
        metodo: m.toUpperCase(),
        caminho,
        resumo: op.summary ?? null,
        parametros: (op.parameters ?? []).map((x) => ({
          nome: x.name,
          em: x.in,
          obrigatorio: Boolean(x.required),
          tipo: x.schema?.type ?? null,
          ...(x.schema?.enum ? { valores: x.schema.enum } : {}),
        })),
        corpo: corpo
          ? { obrigatorios: corpo.required ?? [], campos: Object.keys(corpo.properties ?? {}) }
          : null,
        respostas: Object.fromEntries(
          Object.entries(op.responses ?? {})
            .map(([st, r]) => [st, r.content?.['application/json']?.example] as const)
            .filter(([, ex]) => ex !== undefined)
            .map(([st, ex]) => [st, forma(ex)]),
        ),
      });
    }
}
const versao = (exigir(join(raiz, 'package.json')) as { version: string }).version;
const destino = resolve(aqui, '../../packages/contratos/src/integracao/fachada-contrato.json');
// Grava já no formato do prettier (o portão `prettier --check` do verificar barra o JSON cru).
const texto = await format(JSON.stringify({ versao, operacoes }, null, 2), {
  ...((await resolveConfig(destino)) ?? {}),
  filepath: destino,
});
writeFileSync(destino, texto);
process.stdout.write(`contrato ${versao}: ${operacoes.length} operações -> ${destino}\n`);
