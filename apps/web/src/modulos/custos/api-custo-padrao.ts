// Cliente da tela "Custo-padrão por procedimento" (/custos/custo-padrao; 07-FIN L140, C2-115): fichas técnicas do
// procedimento, itens com o custo de referência, ativação, inativação e a comparação com o custo apurado. As gravações
// vão com o CSRF e a Idempotency-Key (uma por intenção); Problem Details viram ErroApi com o código da recusa.
import type { ClasseVariacao, SituacaoFichaCusto, TipoItemFicha } from '@sgh/dominio-custos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const C = '/api/custos/fichas-padrao';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export interface FichaGravada {
  id: number;
  versao: number;
}
export interface FichaResumo {
  id: number;
  versao: number;
  procedimento: { id: number; codigo: string; descricao: string };
  descricao: string;
  versaoFicha: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  situacao: SituacaoFichaCusto;
  padrao: boolean;
  custoHonorario: number;
  custoOperacional: number;
  custoTotal: number;
  vigenteHoje: boolean;
}
export interface ItemFicha {
  id: number;
  sequencia: number;
  tipo: TipoItemFicha;
  referencia: number | null;
  codigo: string | null;
  descricao: string;
  unidade: string;
  quantidade: number;
  custoUnitario: number;
  custoTotal: number;
}
export interface FichaDetalhe extends FichaResumo {
  itens: ItemFicha[];
  porTipo: Partial<Record<TipoItemFicha, number>>;
  versoes: {
    id: number;
    versaoFicha: string;
    situacao: SituacaoFichaCusto;
    vigenciaInicio: string;
    vigenciaFim: string | null;
    custoTotal: number;
  }[];
}
export interface OpcaoReferencia {
  id: number;
  codigo: string;
  descricao: string;
  custoUnitario: number | null;
  unidade: string;
}
export interface ProcedimentoOpcao {
  id: number;
  codigo: string;
  descricao: string;
  tempoMinutos: number | null;
}
export interface Comparacao {
  ficha: number;
  competencia: string;
  apuracao: { id: number; numeroVersao: number; situacao: string } | null;
  custoPadrao: number;
  linhas: {
    conta: number;
    numero: string;
    quantidade: number;
    custoApurado: number;
    custoPadrao: number;
    variacao: number;
    variacaoPercentualCent: number | null;
    classe: ClasseVariacao;
  }[];
  totalPadrao: number;
  totalApurado: number;
  variacao: number;
  variacaoPercentualCent: number | null;
  classe: ClasseVariacao;
  contagem: Record<ClasseVariacao, number>;
}
export interface NovaFicha {
  procedimento: number;
  descricao: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  setorFuncional: number | null;
  copiarVigente: boolean;
}
export interface NovoItem {
  versao: number;
  tipo: TipoItemFicha;
  referencia: number | null;
  descricao: string | null;
  quantidade: number;
  custoUnitario: number | null;
}

export const lerFichas = (termo: string, situacao: SituacaoFichaCusto | '') =>
  ler(`${C}${qs({ termo: termo || null, situacao: situacao || null })}`, confiar<FichaResumo[]>());
export const lerFicha = (id: number) => ler(`${C}/${id}`, confiar<FichaDetalhe>());
export const lerProcedimentos = (termo: string) =>
  ler(`${C}/procedimentos${qs({ termo })}`, confiar<ProcedimentoOpcao[]>());
export const lerReferencias = (tipo: TipoItemFicha, termo: string) =>
  ler(`${C}/referencias${qs({ tipo, termo })}`, confiar<OpcaoReferencia[]>());
export const lerComparacao = (id: number, competencia: string) =>
  ler(`${C}/${id}/comparacao${qs({ competencia })}`, confiar<Comparacao>());
export const criarFicha = (e: NovaFicha) => enviar(C, e, confiar<FichaGravada>(), novaChave('c2115.criar'));
export const incluirItem = (id: number, e: NovoItem) =>
  enviar(`${C}/${id}/itens`, e, confiar<FichaGravada>(), novaChave('c2115.item'));
export const retirarItem = (id: number, item: number, versao: number) =>
  enviar(
    `${C}/${id}/itens/${item}/retirada`,
    { versao },
    confiar<FichaGravada>(),
    novaChave('c2115.retirar'),
  );
export const ativarFicha = (id: number, versao: number) =>
  enviar(`${C}/${id}/ativacao`, { versao }, confiar<FichaGravada>(), novaChave('c2115.ativar'));
export const inativarFicha = (id: number, versao: number, motivo: string) =>
  enviar(`${C}/${id}/inativacao`, { versao, motivo }, confiar<FichaGravada>(), novaChave('c2115.inativar'));

/** "12,5", "1.234,5678" ou "12.5" → número com até quatro casas; vazio ou inválido → null. */
export function lerDecimal4(texto: string): number | null {
  const b = texto.trim();
  const t = b.includes(',') ? b.replace(/\./g, '').replace(',', '.') : b;
  if (!/^\d+(\.\d{1,4})?$/.test(t)) return null;
  return Number(t);
}
/** Número com até quatro casas no formato brasileiro. */
export const decimal4 = (v: number): string =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
