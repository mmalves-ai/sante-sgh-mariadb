// Ciclo da carga (ficha do M13, regra 6; cap-06a §6.2, carga em três passos; cap-10 §10.11): preparação,
// validação e comparação na área de preparação; publicação só com aprovação e a senha de novo, em lotes curtos,
// na janela fora do pico, cancelável entre lotes e retomada pelo último lote confirmado. Reimportar o mesmo
// arquivo (mesmo hash já publicado) não grava nada. Um responsável por catálogo de cada vez.
import type { SituacaoCargaCatalogo } from '@sgh/contratos';
import { dentroDaJanela, type JanelaPublicacao } from './janela.js';

/** Transições permitidas (de → para). */
const TRANSICOES: Readonly<Record<SituacaoCargaCatalogo, readonly SituacaoCargaCatalogo[]>> = {
  preparada: ['validada', 'rejeitada'],
  validada: ['comparada', 'rejeitada'],
  comparada: ['aprovada', 'rejeitada'],
  aprovada: ['publicando', 'publicada', 'cancelada', 'falhou'],
  publicando: ['publicando', 'publicada', 'cancelada', 'falhou'],
  falhou: ['publicando', 'publicada', 'cancelada'],
  publicada: [],
  rejeitada: [],
  cancelada: [],
};

export function podeIrPara(de: SituacaoCargaCatalogo, para: SituacaoCargaCatalogo): boolean {
  return TRANSICOES[de].includes(para);
}

/** Situação ao fim da preparação: erro de arquivo rejeita; senão, comparada (os três passos feitos). */
export function situacaoDaPreparacao(errosDoArquivo: number, reimportacao: boolean): SituacaoCargaCatalogo {
  if (errosDoArquivo > 0 || reimportacao) return 'rejeitada';
  return 'comparada';
}

/** Divide os itens a publicar em lotes de até `tamanho` (cada lote: uma transação curta). */
export function planejarLotes<T>(itens: readonly T[], tamanho: number): T[][] {
  if (!Number.isInteger(tamanho) || tamanho < 1) throw new Error('Tamanho de lote inválido.');
  const r: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) r.push(itens.slice(i, i + tamanho));
  return r;
}

/** Próximo lote a publicar (1-based) depois dos já confirmados; null quando todos foram. */
export function proximoLote(total: number, publicados: number): number | null {
  return publicados < total ? publicados + 1 : null;
}

export interface ContextoPublicacao {
  readonly situacao: SituacaoCargaCatalogo;
  /** Responsável pelo catálogo: este sistema ('novo') ou a carga como hoje ('externo'). */
  readonly responsavel: 'novo' | 'externo';
  readonly exigeContrato: boolean;
  readonly contratoVigente: boolean;
  readonly erros: number;
  readonly itensAPublicar: number;
  readonly janela: JanelaPublicacao;
  /** Minutos desde a meia-noite no relógio do estabelecimento. */
  readonly agoraMinutos: number;
  /** Publicar fora da janela (só em desenvolvimento e homologação; produção nunca). */
  readonly ignorarJanela?: boolean;
}

export interface DecisaoPublicacao {
  readonly pode: boolean;
  readonly codigo: string | null;
  readonly motivo: string | null;
}

const nao = (codigo: string, motivo: string): DecisaoPublicacao => ({ pode: false, codigo, motivo });

/** Pode aprovar e publicar? (a mesma decisão é refeita pela operação dentro da transação). */
export function decidirPublicacao(c: ContextoPublicacao): DecisaoPublicacao {
  if (c.responsavel !== 'novo')
    return nao(
      'responsavel-externo',
      'Este catálogo ainda é carregado fora deste sistema: a publicação fica recusada até a passagem do catálogo para o importador (Funcionalidades por estabelecimento).',
    );
  if (c.exigeContrato && !c.contratoVigente)
    return nao(
      'sem-contrato',
      'Sem contrato de dados vigente para este conteúdo (DP-36): a carga não é publicada.',
    );
  if (!['comparada', 'aprovada', 'publicando', 'falhou'].includes(c.situacao))
    return nao('situacao-invalida', 'Só a carga comparada (ou aprovada e ainda não publicada) é publicada.');
  if (c.erros > 0)
    return nao('carga-com-erros', 'A carga tem linhas com erro: corrija o arquivo e envie de novo.');
  if (c.itensAPublicar === 0)
    return nao('sem-efeito', 'Nada a publicar: o arquivo é igual ao que o banco já tem.');
  if (!c.ignorarJanela && !dentroDaJanela(c.janela, c.agoraMinutos))
    return {
      pode: true,
      codigo: 'fora-da-janela',
      motivo: `Fora da janela de publicação (${c.janela.inicio} às ${c.janela.fim}): a carga aprovada é publicada quando a janela abrir.`,
    };
  return { pode: true, codigo: null, motivo: null };
}
