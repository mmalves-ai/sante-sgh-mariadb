// Vigia diária das tabelas vazias no worker (M14, regra 14; ficha, seção 4; correção do M14): uma vez por dia
// civil, na janela fora do pico (VIGIA_VAZIAS_JANELA, padrão 02:00-05:00), por estabelecimento configurado:
// lista as tabelas do banco fora das povoadas da matriz (o retrato versionado tools/matriz/dados/
// populadas.<cod>.json), faz o FIRST 1 de cada (READ ONLY) e grava a situação em SGH_CFG_TABELA_VAZIA na
// transação SGH_ do núcleo; a que passou a ter dados ganha o aviso na SGH_OUTBOX (e-mail à TI e ao responsável
// técnico). Só nomes e contagens: nenhuma linha das tabelas vigiadas sai. O CLI `pnpm matriz:vazias` fica para o
// desenvolvimento (cópia, com a trava).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dentroDaJanela, type JanelaPublicacao } from '@sgh/dominio-catalogo';
import {
  type Escritor,
  gravarVigia,
  type Leitor,
  type ResultadoVigiaVazias,
  tabelasComLinha,
  tabelasForaDaLista,
} from '@sgh/legado';

export interface DepsVigiaVazias {
  readonly rede: string;
  readonly hospitais: readonly string[];
  /** As tabelas povoadas da matriz do estabelecimento (null: sem retrato, a vigia não roda nele). */
  povoadas(hospital: string): ReadonlySet<string> | null;
  ler<T>(hospital: string, fn: (l: Leitor) => Promise<T>): Promise<T>;
  gravarSgh<T>(hospital: string, fn: (e: Escritor) => Promise<T>): Promise<T>;
  readonly janela: JanelaPublicacao;
  agoraMinutos(): number;
  /** Dia civil (AAAA-MM-DD) de agora. */
  hoje(): string;
  /** Último dia em que a vigia rodou em cada estabelecimento (memória do processo). */
  readonly ultimas: Map<string, string>;
}

export interface ResultadoCicloVazias {
  readonly hospital: string;
  readonly situacao: 'fora-da-janela' | 'ja-rodou-hoje' | 'sem-retrato' | 'feita' | 'falhou';
  readonly resultado?: ResultadoVigiaVazias;
  readonly erro?: string;
}

/** Um ciclo: roda a vigia nos estabelecimentos que ainda não a rodaram hoje, dentro da janela. */
export async function cicloVigiaVazias(d: DepsVigiaVazias): Promise<ResultadoCicloVazias[]> {
  if (!dentroDaJanela(d.janela, d.agoraMinutos()))
    return d.hospitais.map((hospital) => ({ hospital, situacao: 'fora-da-janela' }));
  const hoje = d.hoje();
  const r: ResultadoCicloVazias[] = [];
  for (const hospital of d.hospitais) {
    if (d.ultimas.get(hospital) === hoje) {
      r.push({ hospital, situacao: 'ja-rodou-hoje' });
      continue;
    }
    const povoadas = d.povoadas(hospital);
    if (!povoadas) {
      r.push({ hospital, situacao: 'sem-retrato' });
      continue;
    }
    try {
      const { vazias, comDados } = await d.ler(hospital, async (l) => {
        const fora = await tabelasForaDaLista(l, povoadas);
        const com = await tabelasComLinha(l, fora);
        return { vazias: fora.filter((t) => !com.includes(t)), comDados: com };
      });
      const resultado = await d.gravarSgh(hospital, (e) =>
        gravarVigia(e, { rede: d.rede, hospital, vazias, comDados }),
      );
      d.ultimas.set(hospital, hoje);
      r.push({ hospital, situacao: 'feita', resultado });
    } catch (e) {
      r.push({ hospital, situacao: 'falhou', erro: e instanceof Error ? e.name : 'erro' });
    }
  }
  return r;
}

/** Retrato das povoadas de um estabelecimento (null quando não há o arquivo do estabelecimento). */
export function lerPovoadas(pasta: string, hospital: string): ReadonlySet<string> | null {
  if (!/^[a-z0-9]{1,10}$/.test(hospital)) return null;
  try {
    const j = JSON.parse(readFileSync(resolve(pasta, `populadas.${hospital}.json`), 'utf8')) as {
      tabelas?: unknown;
    };
    return Array.isArray(j.tabelas) ? new Set(j.tabelas.map(String)) : null;
  } catch {
    return null;
  }
}

/** Dia civil no fuso do Brasil (UTC−3). */
export function diaCivil(d = new Date()): string {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}
