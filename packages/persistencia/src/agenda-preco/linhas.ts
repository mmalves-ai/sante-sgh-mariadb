// Conversões puras da persistência do ADR 0009 (linha do banco → forma do contrato), sem banco. As datas chegam como
// texto AAAA-MM-DD (DATE_FORMAT nas consultas), os booleanos como 0/1 e os valores DECIMAL como texto (o pool usa
// decimalAsNumber: false).
import { createHash } from 'node:crypto';
import type {
  CoberturaAgenda,
  Credenciamento,
  PreparoAgenda,
  RegraPrecoParticular,
  RestricaoAgenda,
  SexoAtendido,
  SituacaoRevisaoRegra,
  TrechoTexto,
} from '@sgh/contratos';
import type { Linha } from '@sgh/nucleo';

/** Hash do texto da agenda: os 16 primeiros bytes do SHA-256 do UTF-8, em hexadecimal (o mesmo do banco e do conector). */
export function hashTextoAgenda(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex').slice(0, 32);
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
const bool = (v: unknown): boolean =>
  v === true || v === 1 || v === '1' || (typeof v === 'bigint' && v === 1n);
const boolOuNulo = (v: unknown): boolean | null => (v === null || v === undefined ? null : bool(v));
const txt = (v: unknown): string => String(v);
const txtOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
/** Valor DECIMAL(15,2) em reais (texto do driver) para número com 2 casas. */
const reais = (v: unknown): number => Math.round(Number(v) * 100) / 100;

export function regraPrecoParticularDe(l: Linha): RegraPrecoParticular {
  const alvo = txt(l['alvo']);
  return {
    id: num(l['id']),
    estabelecimentoId: numOuNulo(l['estabelecimento_id']),
    fontePagadoraId: num(l['fonte_pagadora_id']),
    dono:
      l['profissional_id'] !== null && l['profissional_id'] !== undefined
        ? { tipo: 'profissional', profissionalId: num(l['profissional_id']) }
        : { tipo: 'agenda', agendaId: num(l['agenda_servico_id']) },
    alvo:
      alvo === 'item'
        ? { tipo: 'item', itemFaturavelId: num(l['item_faturavel_id']) }
        : alvo === 'grupo'
          ? { tipo: 'grupo', grupoFaturamentoId: num(l['grupo_faturamento_id']) }
          : alvo === 'exame'
            ? { tipo: 'exame' }
            : { tipo: 'consulta' },
    valor: reais(l['valor']),
    prioridade: num(l['prioridade']),
    vigenciaInicio: txt(l['vigencia_inicio']),
    vigenciaFim: txtOuNulo(l['vigencia_fim']),
    situacaoRevisao: txt(l['situacao_revisao']) as SituacaoRevisaoRegra,
    textoOrigemId: numOuNulo(l['texto_origem_agenda_id']),
    observacao: txtOuNulo(l['observacao']),
    ativo: bool(l['ativo']),
    origem: txt(l['origem']) as RegraPrecoParticular['origem'],
    versao: num(l['versao']),
  };
}

export function credenciamentoDe(l: Linha): Credenciamento {
  return {
    id: num(l['id']),
    profissionalId: num(l['profissional_id']),
    profissionalNome: txt(l['profissional_nome']),
    fontePagadoraId: num(l['fonte_pagadora_id']),
    fontePagadoraNome: txt(l['fonte_pagadora_nome']),
    estabelecimentoId: numOuNulo(l['estabelecimento_id']),
    estabelecimentoNome: txtOuNulo(l['estabelecimento_nome']),
    planoId: numOuNulo(l['plano_fonte_pagadora_id']),
    planoNome: txtOuNulo(l['plano_nome']),
    credenciado: bool(l['credenciado']),
    vigenciaInicio: txt(l['vigencia_inicio']),
    vigenciaFim: txtOuNulo(l['vigencia_fim']),
    versao: num(l['versao']),
  };
}

export function coberturaDe(l: Linha): CoberturaAgenda {
  return {
    id: num(l['id']),
    versao: num(l['versao']),
    fontePagadoraId: num(l['fonte_pagadora_id']),
    fontePagadoraNome: txt(l['fonte_pagadora_nome']),
    planoId: numOuNulo(l['plano_fonte_pagadora_id']),
    planoNome: txtOuNulo(l['plano_nome']),
    planoSuperiorId: numOuNulo(l['plano_superior_id']),
    planoSuperiorNome: txtOuNulo(l['plano_superior_nome']),
    aceita: bool(l['aceita']),
    vigenciaInicio: txt(l['vigencia_inicio']),
    vigenciaFim: txtOuNulo(l['vigencia_fim']),
    situacaoRevisao: txt(l['situacao_revisao']) as SituacaoRevisaoRegra,
    textoOrigemId: numOuNulo(l['texto_origem_agenda_id']),
  };
}

export function restricaoDe(l: Linha): RestricaoAgenda {
  return {
    id: num(l['id']),
    versao: num(l['versao']),
    fontePagadoraId: numOuNulo(l['fonte_pagadora_id']),
    fontePagadoraNome: txtOuNulo(l['fonte_pagadora_nome']),
    planoId: numOuNulo(l['plano_fonte_pagadora_id']),
    planoNome: txtOuNulo(l['plano_nome']),
    itemAgendavelId: numOuNulo(l['item_agendavel_id']),
    sexoAtendido: txtOuNulo(l['sexo_atendido']) as SexoAtendido | null,
    idadeMinimaAnos: numOuNulo(l['idade_minima_anos']),
    idadeMaximaAnos: numOuNulo(l['idade_maxima_anos']),
    aceitaRetorno: boolOuNulo(l['aceita_retorno']),
    diasRetorno: numOuNulo(l['dias_retorno']),
    permiteEncaixe: boolOuNulo(l['permite_encaixe']),
    vigenciaInicio: txt(l['vigencia_inicio']),
    vigenciaFim: txtOuNulo(l['vigencia_fim']),
    situacaoRevisao: txt(l['situacao_revisao']) as SituacaoRevisaoRegra,
    textoOrigemId: numOuNulo(l['texto_origem_agenda_id']),
  };
}

export function preparoDe(l: Linha): PreparoAgenda {
  return {
    id: num(l['id']),
    versao: num(l['versao']),
    itemAgendavelId: numOuNulo(l['item_agendavel_id']),
    tipo: txt(l['tipo']) as PreparoAgenda['tipo'],
    descricao: txt(l['descricao']),
    jejumHoras: numOuNulo(l['jejum_horas']),
    vigenciaInicio: txt(l['vigencia_inicio']),
    vigenciaFim: txtOuNulo(l['vigencia_fim']),
    situacaoRevisao: txt(l['situacao_revisao']) as SituacaoRevisaoRegra,
    textoOrigemId: numOuNulo(l['texto_origem_agenda_id']),
  };
}

export function trechoDe(l: Linha): TrechoTexto {
  return {
    inicio: num(l['posicao_inicio']),
    fim: num(l['posicao_fim']),
    interpretado: bool(l['interpretado']),
    tipoRegra: txtOuNulo(l['tipo_regra']) as TrechoTexto['tipoRegra'],
    motivo: txtOuNulo(l['motivo']),
  };
}

/** Booleano do contrato para o parâmetro do banco. */
export const bit = (b: boolean | null): number | null => (b === null ? null : b ? 1 : 0);
export { bool as booleanoDoBanco, reais as reaisDoBanco };
