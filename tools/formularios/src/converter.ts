// pnpm formularios:converter -- --hospital=<código> (M09, regra 2 a 6 da ficha): converte os modelos de
// formulário do legado para a representação do novo e grava docs/marcos/M09/dfm/. Só leitura, uma transação
// curta por modelo (tempo-alvo < 2 s cada). Saída: contagens e tempos, nunca conteúdo de linha.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { converterModelo, relatorioMarkdown, type RepresentacaoFormulario } from '@sgh/dominio-pep';
import { lerDefinicaoFormulario, listarModelosFormulario } from '@sgh/legado';
import { criarNucleo, escolherCodigo, opcoesDe, raiz } from './nucleo.ts';

const opcoes = opcoesDe(process.argv.slice(2));
const pasta = resolve(raiz, opcoes['saida'] ?? 'docs/marcos/M09/dfm');

function nomeArquivo(codigo: string | null, id: number, usados: Set<string>): string {
  const base = (codigo ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-');
  let nome = (base.replace(/^-+|-+$/g, '') || `modelo-${id}`).toLowerCase();
  if (usados.has(nome)) nome = `${nome}-${id}`;
  usados.add(nome);
  return `${nome}.json`;
}

async function principal(): Promise<number> {
  const { nucleo, codigos } = criarNucleo();
  try {
    const cod = escolherCodigo(opcoes['hospital'], codigos);
    const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'formularios-converter' };
    const modelos = await nucleo.lerSomente(ctx, (l) => listarModelosFormulario(l));
    const reps: RepresentacaoFormulario[] = [];
    const arquivos = new Map<number, string>();
    const usados = new Set<string>();
    let maisLento = 0;
    let bytes = 0;
    for (const m of modelos) {
      const inicio = performance.now();
      const def = await nucleo.lerSomente(ctx, (l) => lerDefinicaoFormulario(l, m));
      const ms = performance.now() - inicio;
      maisLento = Math.max(maisLento, ms);
      bytes += def.bytesDfm;
      reps.push(await converterModelo(def));
      arquivos.set(m.id, nomeArquivo(m.codigo, m.id, usados));
    }
    mkdirSync(pasta, { recursive: true });
    for (const f of readdirSync(pasta)) if (f.endsWith('.json')) rmSync(resolve(pasta, f));
    for (const r of reps) {
      writeFileSync(resolve(pasta, arquivos.get(r.modelo.id)!), JSON.stringify(r, null, 2) + '\n');
    }
    const data = new Date().toISOString().slice(0, 10);
    writeFileSync(
      resolve(pasta, 'relatorio.md'),
      relatorioMarkdown(reps, { estabelecimento: cod, data, arquivoDe: (r) => arquivos.get(r.modelo.id)! }),
    );
    const t = reps.reduce(
      (s, r) => ({
        comp: s.comp + r.resumo.componentes,
        map: s.map + r.resumo.componentesMapeados,
        desc: s.desc + r.resumo.classesDesconhecidas,
        fffd: s.fffd + r.resumo.caracteresSubstituicao,
        pend: s.pend + r.resumo.escolhasPendentes,
      }),
      { comp: 0, map: 0, desc: 0, fffd: 0, pend: 0 },
    );
    console.log(
      `[${cod}] ${reps.length} modelos convertidos; componentes ${t.map}/${t.comp}; classes desconhecidas ${t.desc}; ` +
        `U+FFFD ou byte indefinido ${t.fffd}; pendências de escolha ${t.pend}; DFM ${(bytes / 1e6).toFixed(2)} MB; ` +
        `leitura mais lenta ${Math.round(maisLento)} ms por modelo.`,
    );
    console.log(`Gravado em ${pasta} (${reps.length} JSON + relatorio.md).`);
    return 0;
  } finally {
    await nucleo.encerrar();
  }
}

principal().then(
  (c) => process.exit(c),
  (e: unknown) => {
    console.error(`Falhou: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
