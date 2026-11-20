// Vigilância diária de gravação em produção (ficha do M38, campo 1; cap-14 §14.2.6): uma vez por dia civil, na
// janela fora do pico (VIGIA_GRAVACAO_JANELA, padrão 03:00-05:00), por estabelecimento configurado, recalcula a
// estrutura de uma amostra das gravações do novo no DIA ANTERIOR (só as operações `liberada` no estabelecimento; na
// onda 0, só a trilha dupla; na onda 1, a estrutura imutável das linhas incluídas, M39) e compara com a referência vigente; grava o resultado em SGH_CFG_COEX_VIGIA e, com
// divergência, o alerta direto na SGH_OUTBOX (mesma transação SGH_). Nenhum valor de linha sai do banco; o log só tem
// códigos e contagens. `pnpm assinatura:vigiar` faz o mesmo para um dia pedido (o agendador da produção).
import { dentroDaJanela, type JanelaPublicacao } from '@sgh/dominio-catalogo';
import {
  CENARIO_DO_TIPO_EVENTO,
  comparacoesDaReferencia,
  type ResultadoVigiaHospital,
  VIGIA_IMUTAVEL,
  vigiarHospitalDia,
} from '@sgh/dominio-config';
import { type Escritor, fonteVigiaLegado, type Leitor, operacoesLiberadas } from '@sgh/legado';

export interface DepsVigiaGravacao {
  readonly rede: string;
  readonly hospitais: readonly string[];
  readonly catalogo: { estado(operacao: string, hospital: string): string | null };
  /** Nomes das operações do protocolo e o grupo (pasta das assinaturas) de cada uma. */
  readonly operacoes: Readonly<Record<string, { readonly grupo: string }>>;
  readonly pastaSrc: string;
  readonly tamanho: number;
  ler<T>(hospital: string, fn: (l: Leitor) => Promise<T>): Promise<T>;
  gravarSgh<T>(hospital: string, fn: (e: Escritor) => Promise<T>): Promise<T>;
  readonly janela: JanelaPublicacao;
  agoraMinutos(): number;
  /** Dia civil (AAAA-MM-DD) de agora; a vigilância é do dia anterior. */
  hoje(): string;
  readonly ultimas: Map<string, string>;
}

export interface ResultadoCicloVigiaGravacao {
  readonly hospital: string;
  readonly situacao: 'fora-da-janela' | 'ja-rodou-hoje' | 'feita' | 'falhou';
  readonly data?: string;
  readonly resultado?: ResultadoVigiaHospital;
  readonly erro?: string;
}

/** O dia anterior a `dia` (AAAA-MM-DD). */
export function diaAnterior(dia: string): string {
  return new Date(Date.parse(`${dia}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** O cenário de referência de cada gravação pelo código da coluna de cenário (o tipo do evento da trilha). */
export function cenarioDoCodigo(operacao: string, codigo: number | null): string | null {
  if (operacao !== 'auditoria.registrarEventoLegado' || codigo === null) return null;
  return CENARIO_DO_TIPO_EVENTO[codigo] ?? null;
}

/** Monta e roda a vigilância de um estabelecimento e dia (o ciclo do worker e a linha de comando usam a mesma). */
export function vigiarUmDia(
  d: Pick<
    DepsVigiaGravacao,
    'rede' | 'catalogo' | 'operacoes' | 'pastaSrc' | 'tamanho' | 'ler' | 'gravarSgh'
  >,
  hospital: string,
  data: string,
  ensaio = false,
): Promise<ResultadoVigiaHospital> {
  const fonte = fonteVigiaLegado({
    ler: (fn) => d.ler(hospital, fn),
    ...(ensaio ? {} : { gravarSgh: <T>(fn: (e: Escritor) => Promise<T>) => d.gravarSgh(hospital, fn) }),
    hospital,
    data,
    rede: d.rede,
    pastaSrc: d.pastaSrc,
    grupoDe: (op) => d.operacoes[op]?.grupo ?? null,
    cenarioDoCodigo,
    comparacoes: comparacoesDaReferencia,
    // M39: as operações da onda 1 (a estrutura que não muda depois da gravação).
    imutavel: VIGIA_IMUTAVEL,
  });
  return vigiarHospitalDia({
    hospital,
    data,
    tamanho: d.tamanho,
    operacoes: operacoesLiberadas(d.catalogo, Object.keys(d.operacoes), hospital),
    ...fonte,
  });
}

/** Um ciclo: roda nos estabelecimentos que ainda não rodaram hoje, dentro da janela. */
export async function cicloVigiaGravacao(d: DepsVigiaGravacao): Promise<ResultadoCicloVigiaGravacao[]> {
  if (!dentroDaJanela(d.janela, d.agoraMinutos()))
    return d.hospitais.map((hospital) => ({ hospital, situacao: 'fora-da-janela' }));
  const hoje = d.hoje();
  const data = diaAnterior(hoje);
  const r: ResultadoCicloVigiaGravacao[] = [];
  for (const hospital of d.hospitais) {
    if (d.ultimas.get(hospital) === hoje) {
      r.push({ hospital, situacao: 'ja-rodou-hoje' });
      continue;
    }
    try {
      const resultado = await vigiarUmDia(d, hospital, data);
      d.ultimas.set(hospital, hoje);
      r.push({ hospital, situacao: 'feita', data, resultado });
    } catch (e) {
      r.push({ hospital, situacao: 'falhou', data, erro: e instanceof Error ? e.name : 'erro' });
    }
  }
  return r;
}
