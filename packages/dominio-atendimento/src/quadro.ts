// Quadro de acompanhamento do PA (ficha do M20, seção 4): os atendimentos de PA abertos, por etapa (as marcas do novo,
// SGH_PA_ETAPA, e o que se deduz das operações: a abertura, a chamada ao consultório, a observação, o desfecho), na
// ordem de prioridade legal e de chegada; tempo na etapa e total. A cor de risco entra na Fase 5 (M44).
import { COLUNAS_QUADRO_PA, ETAPAS_PA, type EtapaPa, type ColunaQuadroPa } from '@sgh/contratos';

export interface MarcaPa {
  readonly etapa: EtapaPa;
  readonly em: string;
}

export interface AtendimentoPaAberto {
  readonly reg: number;
  /** Chegada: a emissão da senha; sem senha, a abertura da ficha. */
  readonly chegada: string;
  readonly prioridade: '0' | '1' | '2';
  readonly marcas: readonly MarcaPa[];
  /** Em observação agora (leito alocado sem saída). */
  readonly emObservacao: boolean;
}

const ms = (iso: string) => Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);

/** A etapa atual: a marca mais recente (a observação em curso vence as marcas anteriores a ela). */
export function etapaAtual(a: AtendimentoPaAberto): { etapa: EtapaPa; desde: string } {
  const ordenadas = [...a.marcas].sort((x, y) => ms(x.em) - ms(y.em));
  const ultima = ordenadas.at(-1);
  if (a.emObservacao) {
    const obs = [...ordenadas].reverse().find((m) => m.etapa === 'observacao');
    if (obs && (!ultima || ms(obs.em) >= ms(ultima.em) - 1)) return { etapa: 'observacao', desde: obs.em };
    if (!ultima || ultima.etapa === 'observacao') return { etapa: 'observacao', desde: obs?.em ?? a.chegada };
  }
  if (!ultima) return { etapa: 'chegada', desde: a.chegada };
  return { etapa: ultima.etapa, desde: ultima.em };
}

export function colunaDaEtapa(e: EtapaPa): ColunaQuadroPa | 'saida' {
  return (ETAPAS_PA.find((x) => x.codigo === e)?.coluna ?? 'aguardando') as ColunaQuadroPa | 'saida';
}

/** Ordem do quadro: prioridade legal (0 antes de 1 antes de 2), depois a chegada. */
export function ordenarPa<T extends Pick<AtendimentoPaAberto, 'prioridade' | 'chegada' | 'reg'>>(
  itens: readonly T[],
): T[] {
  return [...itens].sort(
    (a, b) => a.prioridade.localeCompare(b.prioridade) || ms(a.chegada) - ms(b.chegada) || a.reg - b.reg,
  );
}

export interface CartaoCalculado<T> {
  readonly item: T;
  readonly etapa: EtapaPa;
  readonly desde: string;
  readonly minutosNaEtapa: number;
  readonly minutosTotal: number;
}

/** Os cartões por coluna (quem já saiu não aparece). */
export function montarQuadro<T extends AtendimentoPaAberto>(
  itens: readonly T[],
  agora: string,
): { codigo: ColunaQuadroPa; rotulo: string; cartoes: CartaoCalculado<T>[] }[] {
  const colunas = COLUNAS_QUADRO_PA.map((c) => ({
    codigo: c.codigo,
    rotulo: c.rotulo,
    cartoes: [] as CartaoCalculado<T>[],
  }));
  for (const item of ordenarPa(itens)) {
    const { etapa, desde } = etapaAtual(item);
    const col = colunaDaEtapa(etapa);
    if (col === 'saida') continue;
    const alvo = colunas.find((c) => c.codigo === col);
    alvo?.cartoes.push({
      item,
      etapa,
      desde,
      minutosNaEtapa: Math.max(0, Math.floor((ms(agora) - ms(desde)) / 60_000)),
      minutosTotal: Math.max(0, Math.floor((ms(agora) - ms(item.chegada)) / 60_000)),
    });
  }
  return colunas;
}

/** A etapa manual pode ser registrada agora? (não depois da decisão nem da saída) */
export function podeRegistrarEtapa(atual: EtapaPa): boolean {
  return atual !== 'decisao' && atual !== 'saida';
}
