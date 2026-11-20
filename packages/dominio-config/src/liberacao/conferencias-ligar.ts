// Conferências ao LIGAR uma chave de liberação (M08, M36, M40 a M42, M44 e M58-F5), extraídas da tela "Chaves de
// liberação" (apps/api, liberacao.controller.ts) no M61 para que a API e o comando de terminal
// `pnpm liberacao:ligar-tudo` usem as MESMAS regras: em produção, a autorização do dono e a operação `liberada` no
// catálogo; a farmácia (prescrição eletrônica em uso) e a entrada UTF-8 (conversão verificada) em todo ambiente; o
// critério do setor das ondas 2, 3 e 4 fora de dev/ci; os pré-requisitos do recurso; e a fonte única de cor do PA.
// Puras: os avaliadores que leem o banco chegam de fora; sem avaliador, a regra recusa (falha fechada). Desligar nunca
// passa por aqui. Devolvem a recusa (com o código do problema) em vez de lançar: a API a converte no problema HTTP, o
// comando a registra como pendência e segue com as outras chaves.
import {
  CHAVE_CLASSIFICACAO_EXTERNA,
  CHAVE_ENTRADA_UTF8,
  CHAVE_LIBERACAO_CLASSIFICACAO,
  CODIGO_CRITERIO_ONDA_2_INCOMPLETO,
  CODIGO_CRITERIO_ONDA_3_INCOMPLETO,
  CODIGO_CRITERIO_ONDA_4_INCOMPLETO,
  CODIGO_ENTRADA_UTF8_SEM_CONVERSAO,
  CODIGO_FARMACIA_SEM_PRESCRICAO,
  type EscopoLiberacao,
  recursoDesligado,
} from '@sgh/contratos';
import { setoresOnda2DaChave } from '../onda2/onda2.js';
import { chaveExigePrescricao, setoresOnda3DaChave } from '../onda3/onda3.js';
import { setoresOnda4DaChave } from '../onda4/onda4.js';
import type { ChaveAtual } from './lote.js';
import { decidirChave, type PrerequisitoRegistrado } from './prerequisito-chave.js';

export type TipoChaveLiberacao = 'recurso' | 'operacao';

/** A recusa de ligar, com o problema que a API devolve (tipo, status, título, detalhe e código). */
export interface RecusaLigar {
  readonly problema:
    'operacao-bloqueada' | 'entrada-invalida' | 'recusa-de-negocio' | 'prerequisito-pendente';
  readonly status: 400 | 409;
  readonly titulo: string;
  readonly motivo: string;
  readonly codigo: string | null;
}

/** O que falta para ligar (null: pode). Lê o banco do estabelecimento; quem chama já sabe qual. */
export type AvaliadorLigar = (tipo: TipoChaveLiberacao, chave: string) => Promise<string | null>;

export interface AvaliadoresLigar {
  /** M40 a M42: o critério do setor das ondas 2, 3 e 4 (módulo de coexistência). */
  readonly criterioSetor: AvaliadorLigar | null;
  /** M41, regra 1: a prescrição eletrônica em uso nas unidades atendidas (módulo do estoque). */
  readonly regraFarmacia: AvaliadorLigar | null;
  /** M58-F5, regra 6: a conversão para UTF-8 autorizada, executada e verificada (módulo de coexistência). */
  readonly regraEntradaUtf8: (() => Promise<string | null>) | null;
}

const ehObra = (ambiente: string) => ambiente === 'dev' || ambiente === 'ci';

/** Em produção, ligar exige a autorização registrada do dono; a operação, ainda, `liberada` no catálogo (M36). */
export function conferirLigarEmProducao(p: {
  readonly ambiente: string;
  readonly tipo: TipoChaveLiberacao;
  /** O estado efetivo da operação no estabelecimento (lido só quando preciso). */
  readonly estadoEfetivo: () => string | null;
  readonly referenciaAutorizacao: string | null | undefined;
}): RecusaLigar | null {
  if (p.ambiente !== 'producao') return null;
  if (p.tipo === 'operacao' && p.estadoEfetivo() !== 'liberada')
    return {
      problema: 'operacao-bloqueada',
      status: 409,
      titulo: 'Operação não liberada',
      motivo: 'Em produção, só liga operação liberada no catálogo.',
      codigo: null,
    };
  if (!p.referenciaAutorizacao)
    return {
      problema: 'entrada-invalida',
      status: 400,
      titulo: 'Autorização obrigatória',
      motivo: 'Em produção, ligar exige a linha de autorização do dono (ESTADO.md › Autorizações).',
      codigo: null,
    };
  return null;
}

/**
 * As regras de negócio ao ligar: a farmácia e a entrada UTF-8 em todo ambiente; fora de dev/ci, o critério do setor
 * das ondas 2, 3 e 4 (uma chave de mais de um setor usa o avaliador, que decide; D-CHAVE-40).
 */
export async function conferirRegrasDeLigar(p: {
  readonly ambiente: string;
  readonly tipo: TipoChaveLiberacao;
  readonly chave: string;
  readonly nomesOperacoes: () => readonly string[];
  readonly avaliadores: AvaliadoresLigar;
}): Promise<RecusaLigar | null> {
  const { tipo, chave, avaliadores: a } = p;
  if (chaveExigePrescricao(chave)) {
    const motivo = a.regraFarmacia
      ? await a.regraFarmacia(tipo, chave)
      : 'a regra da farmácia (prescrição eletrônica em uso nas unidades atendidas) não pôde ser conferida agora.';
    if (motivo)
      return {
        problema: 'recusa-de-negocio',
        status: 409,
        titulo: 'Prescrição eletrônica ainda não em uso',
        motivo,
        codigo: CODIGO_FARMACIA_SEM_PRESCRICAO,
      };
  }
  if (tipo === 'recurso' && chave === CHAVE_ENTRADA_UTF8) {
    const motivo = a.regraEntradaUtf8
      ? await a.regraEntradaUtf8()
      : 'a conversão do banco para UTF-8 não pôde ser conferida agora.';
    if (motivo)
      return {
        problema: 'recusa-de-negocio',
        status: 409,
        titulo: 'Conversão para UTF-8 não verificada',
        motivo,
        codigo: CODIGO_ENTRADA_UTF8_SEM_CONVERSAO,
      };
  }
  if (ehObra(p.ambiente)) return null;
  const nomes = p.nomesOperacoes();
  const onda2 = setoresOnda2DaChave(tipo, chave, nomes).length > 0;
  const onda3 = !onda2 && setoresOnda3DaChave(tipo, chave, nomes).length > 0;
  const onda4 = !onda2 && !onda3 && setoresOnda4DaChave(tipo, chave, nomes).length > 0;
  if (!onda2 && !onda3 && !onda4) return null;
  const motivo = a.criterioSetor
    ? await a.criterioSetor(tipo, chave)
    : 'o critério de liberação do setor não pôde ser conferido agora.';
  if (!motivo) return null;
  return {
    problema: 'recusa-de-negocio',
    status: 409,
    titulo: 'Critério de liberação incompleto',
    motivo,
    codigo: onda2
      ? CODIGO_CRITERIO_ONDA_2_INCOMPLETO
      : onda3
        ? CODIGO_CRITERIO_ONDA_3_INCOMPLETO
        : CODIGO_CRITERIO_ONDA_4_INCOMPLETO,
  };
}

/** Pré-requisitos do recurso (sobre o estado relido na transação): ligar com falta é recusado. */
export function conferirPrerequisitosDeLigar(
  chave: string,
  registrados: readonly PrerequisitoRegistrado[],
  agora: Date,
): RecusaLigar | null {
  const rec = recursoDesligado(chave);
  if (!rec) return null;
  const d = decidirChave(true, rec.prerequisitos, registrados, agora);
  if (d.permitido) return null;
  return {
    problema: 'prerequisito-pendente',
    status: 409,
    titulo: 'Pré-requisito pendente',
    motivo: d.mensagem,
    codigo: 'prerequisito-pendente',
  };
}

export interface ChaveComNome extends ChaveAtual {
  readonly chave: string;
  readonly tipo: TipoChaveLiberacao;
}

/**
 * M44, regra 6 (uma fonte de cor no PA por estabelecimento e escopo): ligar a externa onde a própria está ligada é
 * recusado; ligar a própria com a externa ligada nos mesmos escopos (ou no estabelecimento inteiro) pede desligar a
 * externa na MESMA transação, antes dela.
 */
export function conferirFonteUnicaDeCor(
  chaves: readonly ChaveComNome[],
  pedido: { readonly chave: string; readonly escopo: EscopoLiberacao; readonly valores: readonly string[] },
): { readonly recusa: RecusaLigar | null; readonly desligarExterna: boolean } {
  const ligada = (chave: string) =>
    chaves.some(
      (c) =>
        c.chave === chave &&
        c.tipo === 'recurso' &&
        c.ligada === true &&
        ((c.escopo === 'hospital' && c.valor === '*') ||
          (c.escopo === pedido.escopo && pedido.valores.includes(c.valor))),
    );
  if (pedido.chave === CHAVE_CLASSIFICACAO_EXTERNA && ligada(CHAVE_LIBERACAO_CLASSIFICACAO))
    return {
      recusa: {
        problema: 'recusa-de-negocio',
        status: 409,
        titulo: 'Uma fonte de cor no pronto atendimento',
        motivo:
          'A classificação de risco própria está ligada aqui: desligue-a antes de ligar a classificação externa.',
        codigo: 'fonte-de-cor-unica',
      },
      desligarExterna: false,
    };
  return {
    recusa: null,
    desligarExterna: pedido.chave === CHAVE_LIBERACAO_CLASSIFICACAO && ligada(CHAVE_CLASSIFICACAO_EXTERNA),
  };
}
