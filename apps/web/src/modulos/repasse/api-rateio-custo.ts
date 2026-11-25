// Cliente da tela de rateio do repasse por setor e custos do prestador (F8, 06-FAT linha 49). As gravações vão com o
// CSRF e a Idempotency-Key (uma por intenção de gravar); a recusa de negócio traz o texto do servidor.
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';
import { novaChave } from './api-repasse.js';

const R = '/api/repasse/rateio-custos';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export interface TipoDesconto {
  id: number;
  codigo: string;
  descricao: string;
  natureza: string;
  forma: 'informado' | 'valor_fixo' | 'percentual';
  valorPadrao: number | null;
  percentualPadrao: number | null;
  ativo: boolean;
  versao: number;
}

export interface CustoPrestador {
  id: number;
  profissional: number;
  profissionalNome: string | null;
  tipo: number;
  tipoDescricao: string;
  centroCusto: number | null;
  centroNome: string | null;
  descricao: string;
  natureza: string;
  forma: 'valor' | 'percentual';
  valor: number | null;
  percentual: number | null;
  faixaInicial: number | null;
  faixaFinal: number | null;
  frequencia: 'mensal' | 'por_apuracao' | 'unica';
  inicio: string;
  fim: string | null;
  versao: number;
}

export interface RegraRateio {
  id: number;
  descricao: string;
  profissional: number | null;
  profissionalNome: string | null;
  grupoRepasse: number | null;
  grupoDescricao: string | null;
  base: 'repasse' | 'custo';
  inicio: string;
  fim: string | null;
  versao: number;
  setores: {
    setor: number;
    setorNome: string;
    centroCusto: number;
    centroNome: string | null;
    percentual: number;
  }[];
}

export interface PainelRateioCusto {
  tipos: TipoDesconto[];
  custos: CustoPrestador[];
  regras: RegraRateio[];
  setores: { id: number; nome: string; centroCusto: number | null; centroNome: string | null }[];
  centros: { id: number; nome: string }[];
  grupos: { id: number; descricao: string }[];
  apuracoes: { id: number; numero: string; competencia: string; situacao: string }[];
}

export interface RateioApuracao {
  apuracao: { id: number; competencia: string; situacao: string };
  rateavel: boolean;
  gravado: {
    profissional: number;
    profissionalNome: string | null;
    setor: number;
    setorNome: string;
    valor: number;
  }[];
  totaisPorSetor: { setor: number; setorNome: string; valor: number }[];
  simulado: { profissional: number; setor: number; regra: number; base: string; valor: number }[];
  pendencias: { profissional: number; motivo: 'sem-regra' | 'sem-valor' }[];
}

export const lerPainelRateioCusto = (profissional: number | null) =>
  ler(`${R}${qs({ profissional: profissional ?? undefined })}`, confiar<PainelRateioCusto>());
export const lerRateioApuracao = (apuracao: number) =>
  ler(`${R}/apuracao/${apuracao}`, confiar<RateioApuracao>());
export const incluirTipoDesconto = (corpo: unknown) =>
  enviar(`${R}/tipos`, corpo, confiar<{ id: number }>(), novaChave('tipo-desconto'));
export const situacaoTipoDesconto = (id: number, versao: number, ativo: boolean) =>
  enviar(`${R}/tipos/${id}/situacao`, { versao, ativo }, confiar<{ id: number }>(), novaChave('tipo-sit'));
export const incluirCustoPrestador = (corpo: unknown) =>
  enviar(`${R}/custos`, corpo, confiar<{ id: number }>(), novaChave('custo-prestador'));
export const incluirRegraRateio = (corpo: unknown) =>
  enviar(`${R}/regras`, corpo, confiar<{ id: number }>(), novaChave('regra-rateio'));
export const encerrarRateioCusto = (tipo: 'custo' | 'rateio', id: number, versao: number, fim: string) =>
  enviar(`${R}/${tipo}/${id}/encerrar`, { versao, fim }, confiar<{ id: number }>(), novaChave('rateio-fim'));
export const ratearApuracao = (apuracao: number) =>
  enviar(
    `${R}/ratear`,
    { apuracao },
    confiar<{ gravadas: number; excluidas: number; pendencias: RateioApuracao['pendencias'] }>(),
    novaChave('ratear'),
  );
