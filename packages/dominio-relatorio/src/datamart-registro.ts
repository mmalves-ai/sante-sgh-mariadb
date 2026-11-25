// Registro da carga do data mart pela rotina do worker (01-ADM L115; F8): a regra pura de quando a carga do dia é
// devida, de como cada objeto carregado (dimensão ou fato do arquivo pseudonimizado) vira uma etapa com linhas e tempo
// e de qual é a situação final da carga. A gravação (carga_data_mart e carga_data_mart_etapa) é da porta própria do
// worker; a análise ad hoc (tabela dinâmica, cubo, filtros) é da ferramenta de BI ligada ao arquivo só para leitura
// (docs/implantacao/ligacao-bi-data-mart.md): o produto não guarda análises (minimização, LGPD art. 6º, III).
// Melhoria: uma carga por estabelecimento e por dia civil do fuso dele, depois da hora da carga (fora do pico); a
// falha fica registrada com a mensagem sem valores de dados e não se repete a cada hora no mesmo dia.
// Melhoria: o nome do objeto é conferido (minúsculas, sem repetir) e o tipo sai do nome (fato_* é fato), sem lista
// paralela que possa divergir do esquema do arquivo.

/** O assunto da carga do data mart pseudonimizado no registro. */
export const ASSUNTO_CARGA_DATAMART = 'data_mart';
/** A hora local (0 a 23) a partir da qual a carga do dia é devida: fora do pico do hospital. */
export const HORA_CARGA_DATAMART = 2;

export type TipoObjetoCarga = 'dimensao' | 'fato';
export type SituacaoCargaDataMart = 'concluida' | 'concluida_com_rejeicao' | 'falhou';
export type SituacaoEtapaCarga = 'concluida' | 'falhou';

/** O que a carga devolve de cada objeto carregado no arquivo (só contagens e tempo). */
export interface ObjetoCarregado {
  readonly objeto: string;
  readonly linhas: number;
  /** Linhas descartadas pela regra da carga (ex.: sem estabelecimento). */
  readonly rejeitadas?: number;
  readonly duracaoMs: number;
}

export interface EtapaDaCarga {
  readonly sequencia: number;
  readonly tipoObjeto: TipoObjetoCarga;
  readonly objeto: string;
  readonly linhas: number;
  readonly duracaoMs: number;
  readonly situacao: SituacaoEtapaCarga;
}

export interface FechamentoDaCarga {
  readonly situacao: SituacaoCargaDataMart;
  readonly linhasGravadas: number;
  readonly linhasRejeitadas: number;
  readonly mensagemErro: string | null;
  readonly etapas: readonly EtapaDaCarga[];
}

const NOME_OBJETO = /^[a-z][a-z0-9_]{1,99}$/;

/** O tipo do objeto pelo nome: fato_* é fato; o resto (dimensões e o registro da carga no arquivo) é dimensão. */
export function tipoDoObjeto(objeto: string): TipoObjetoCarga {
  return objeto.startsWith('fato_') ? 'fato' : 'dimensao';
}

/**
 * A carga do dia é devida? Só depois da hora da carga no dia civil local e se nenhuma carga (de qualquer situação)
 * começou hoje: a falha do dia não se repete a cada volta; a de amanhã tenta de novo.
 */
export function cargaDevida(e: {
  readonly hoje: string;
  readonly hora: number;
  readonly ultimaIniciadaNoDia: string | null;
  readonly horaDaCarga?: number;
}): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.hoje)) throw new Error('dia local inválido');
  if (e.hora < (e.horaDaCarga ?? HORA_CARGA_DATAMART)) return false;
  return e.ultimaIniciadaNoDia === null || e.ultimaIniciadaNoDia < e.hoje;
}

/**
 * A mensagem de erro sem valores de dados (o registro é lido pelo administrador): o texto entre aspas e as sequências
 * de quatro ou mais dígitos (documento, prontuário, telefone) viram reticências; no máximo 1000 caracteres.
 */
export function mensagemSemValores(erro: unknown): string {
  const bruto = erro instanceof Error ? `${erro.name}: ${erro.message}` : 'falha sem mensagem';
  const limpo = bruto
    .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '…')
    .replace(/\d{4,}/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
  return limpo.length > 1000 ? `${limpo.slice(0, 999)}…` : limpo;
}

/**
 * O fechamento da carga: as etapas na ordem do arquivo, as linhas somadas e a situação (falhou com o erro; com linha
 * rejeitada, concluída com rejeição; senão, concluída). Recusa objeto com nome inválido, repetido ou contagem negativa.
 */
export function fecharCarga(objetos: readonly ObjetoCarregado[], erro: unknown = null): FechamentoDaCarga {
  const vistos = new Set<string>();
  const etapas: EtapaDaCarga[] = objetos.map((o, i) => {
    if (!NOME_OBJETO.test(o.objeto)) throw new Error(`objeto da carga com nome inválido (etapa ${i + 1})`);
    if (vistos.has(o.objeto)) throw new Error(`objeto da carga repetido: ${o.objeto}`);
    vistos.add(o.objeto);
    for (const n of [o.linhas, o.rejeitadas ?? 0, o.duracaoMs])
      if (!Number.isInteger(n) || n < 0) throw new Error(`contagem inválida em ${o.objeto}`);
    return {
      sequencia: i + 1,
      tipoObjeto: tipoDoObjeto(o.objeto),
      objeto: o.objeto,
      linhas: o.linhas,
      duracaoMs: o.duracaoMs,
      situacao: 'concluida',
    };
  });
  const linhasGravadas = objetos.reduce((s, o) => s + o.linhas, 0);
  const linhasRejeitadas = objetos.reduce((s, o) => s + (o.rejeitadas ?? 0), 0);
  if (erro !== null && erro !== undefined)
    return {
      situacao: 'falhou',
      linhasGravadas: 0,
      linhasRejeitadas,
      mensagemErro: mensagemSemValores(erro),
      // O arquivo não foi publicado: as etapas lidas antes da falha ficam como falhas (nada chegou ao BI).
      etapas: etapas.map((e) => ({ ...e, situacao: 'falhou' })),
    };
  return {
    situacao: linhasRejeitadas > 0 ? 'concluida_com_rejeicao' : 'concluida',
    linhasGravadas,
    linhasRejeitadas,
    mensagemErro: null,
    etapas,
  };
}
