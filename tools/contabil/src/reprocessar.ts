// `pnpm contabil:reprocessar -- --periodo=AAAA-MM [--hospital=<cod>] [--empresa=<n>]` (M54.1; ficha, regra 2 e
// critério de aceite; Desvio da fase, convencoes.md §13): lê os fatos da competência, o plano, o de-para da exportação e
// as regras publicadas DUAS vezes (duas transações de leitura independentes), aplica as regras em cada leitura e compara
// os lançamentos gerados: "idêntico" quando a segunda execução dá os mesmos lançamentos da primeira (mesma chave,
// partidas, valores, centros de custo, históricos e data) e, desde a F2 (M54.2), quando a derivação dá as mesmas
// partidas dos lançamentos GRAVADOS dos fatos contabilizados (a primeira execução de verdade). Só leitura: nada é gravado (a gravação das situações é a da
// tela, com a senha). Imprime só contagens e totais; sai com 1 quando difere, 2 quando a competência passa do teto.
import { resolve } from 'node:path';
import { conferirExecucoes, type ResultadoConferencia } from '@sgh/dominio-contabil';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerPeriodoContabil,
  NucleoLegado,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';

// A conferência é a do domínio (a mesma da integração na cópia); reexportada para o teste e quem já a usava daqui.
export {
  aplicarLeitura,
  conferirExecucoes,
  type LeituraDoPeriodo,
  type ResultadoConferencia,
} from '@sgh/dominio-contabil';

/** O mesmo teto da conferência da API (TETO_FATOS_COMPETENCIA). */
export const TETO_FATOS = 20_000;

export function opcoesDe(argv: readonly string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const a of argv) {
    const m = /^--([a-z][a-z0-9-]*)=(.*)$/.exec(a);
    if (m?.[1] && m[2] !== undefined) o[m[1]] = m[2];
  }
  return o;
}

/** Linha do relatório (só contagens e totais em centavos com as parcelas). */
export function relatorio(cod: string, empresa: number, periodo: string, r: ResultadoConferencia): string {
  const t = (x: { debitos: number; creditos: number }) => `D ${x.debitos} = C ${x.creditos}`;
  return [
    `[${cod}] empresa ${empresa}, competência ${periodo}: ${r.fatos} fatos${r.parcial ? ' (parcial: acima do teto)' : ''}`,
    `  lançamentos: 1ª ${r.lancamentos.primeira}, 2ª ${r.lancamentos.segunda}; iguais ${r.iguais}, diferentes ${r.diferentes}`,
    `  totais (centavos): 1ª ${t(r.totais.primeira)}; 2ª ${t(r.totais.segunda)}`,
    ...(r.gravado
      ? [
          `  frente ao gravado: ${r.gravado.comparados} fatos contabilizados; iguais ${r.gravado.iguais}, diferentes ${r.gravado.diferentes}, sem lançamento ${r.gravado.semLancamento}`,
        ]
      : []),
    `  resultado: ${r.identico ? 'IDÊNTICO' : r.parcial ? 'NÃO CONFERIDO (parcial)' : 'DIFERENTE'}`,
  ].join('\n');
}

async function principal(argv: readonly string[]): Promise<number> {
  const o = opcoesDe(argv);
  const periodo = o['periodo'] ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) {
    console.error('Uso: pnpm contabil:reprocessar -- --periodo=AAAA-MM [--hospital=<cod>] [--empresa=<n>]');
    return 64;
  }
  const raiz = resolve(import.meta.dirname, '../../..');
  const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
  const codigos = lerCodigos(env);
  const cod = o['hospital'] ?? codigos[0];
  if (!cod || !codigos.includes(cod)) {
    console.error(`Estabelecimento fora de ESTABELECIMENTOS (${codigos.join(', ') || 'nenhum'}).`);
    return 64;
  }
  const empresa = Math.max(1, Math.trunc(Number(o['empresa'] ?? 1)) || 1);
  const nucleo = new NucleoLegado({
    env,
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
    aviso: (m, c) => console.warn(`[aviso] ${m} ${JSON.stringify(c)}`),
  });
  try {
    const ler = () =>
      nucleo.lerSomente({ rede: nucleo.rede, hospital: cod, traceId: 'contabil-reprocessar' }, (l) =>
        lerPeriodoContabil(l, cod, empresa, periodo, TETO_FATOS),
      );
    const primeira = await ler();
    const segunda = await ler();
    const r = conferirExecucoes(primeira, segunda);
    console.log(relatorio(cod, empresa, periodo, r));
    return r.identico ? 0 : r.parcial ? 2 : 1;
  } finally {
    await nucleo.encerrar();
  }
}

if (import.meta.main) {
  principal(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: unknown) => {
      console.error(`[contabil:reprocessar] ${e instanceof Error ? e.message : 'erro'}`);
      process.exit(70);
    },
  );
}
