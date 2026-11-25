// Cliente da remuneração variável por faixa e do rateio da equipe (F8, 06-FAT linha 48). As gravações vão com o CSRF
// e a Idempotency-Key (uma por intenção de gravar); a recusa de negócio traz o texto do servidor.
import type { AjusteFaixa, FaixaVariavel, IndicadorVariavel, PeriodoVariavel } from '@sgh/dominio-repasse';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';
import { novaChave } from './api-repasse.js';

const R = '/api/repasse/variavel-faixa';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export type { AjusteFaixa, FaixaVariavel, IndicadorVariavel, PeriodoVariavel };

export interface MembroLido {
  id: number;
  profissional: number | null;
  terceiro: number | null;
  nome: string;
  cota: number;
  chefe: boolean;
  inicio: string;
  fim: string | null;
}

export interface EquipeLida {
  id: number;
  codigo: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  versao: number;
  membros: MembroLido[];
}

export interface RegraLida {
  id: number;
  codigo: string;
  descricao: string;
  profissional: number | null;
  equipe: number | null;
  beneficiario: string;
  indicador: IndicadorVariavel;
  periodo: PeriodoVariavel;
  fonteNome: string | null;
  considerarPacote: boolean;
  percentualPacote: number | null;
  eventoNome: string | null;
  eventoDescontoNome: string | null;
  inicio: string;
  fim: string | null;
  ativo: boolean;
  versao: number;
  faixas: FaixaVariavel[];
}

export interface PainelVariavelFaixa {
  regras: RegraLida[];
  equipes: EquipeLida[];
  eventos: { id: number; codigo: string; nome: string; natureza: string }[];
  fontes: { id: number; nome: string }[];
  apuracoes: { id: number; numero: string; competencia: string; situacao: string }[];
}

export interface SimulacaoVariavelFaixa {
  apuracao: number;
  competencia: string;
  situacao: string;
  regras: {
    regra: number;
    codigo: string;
    descricao: string;
    beneficiario: string;
    indicador: IndicadorVariavel;
    periodoInicio: string;
    periodoFim: string;
    fecha: boolean;
    medida: number;
    base: number;
    faixa: number | null;
    percentual: number;
    valor: number;
    memoria: string;
    partes: { profissional: number | null; nome: string; cota: number; valor: number; lancado: boolean }[];
    pendencias: string[];
  }[];
}

export const lerPainelVariavelFaixa = () => ler(R, confiar<PainelVariavelFaixa>());
export const simularVariavelFaixa = (apuracao: number) =>
  ler(`${R}/simulacao${qs({ apuracao })}`, confiar<SimulacaoVariavelFaixa>());
export const incluirEquipeVariavel = (corpo: unknown) =>
  enviar(`${R}/equipes`, corpo, confiar<{ id: number }>(), novaChave('vf-equipe'));
export const recomporEquipeVariavel = (equipe: number, corpo: unknown) =>
  enviar(`${R}/equipes/${equipe}/recompor`, corpo, confiar<{ id: number }>(), novaChave('vf-recompor'));
export const incluirRegraVariavelFaixa = (corpo: unknown) =>
  enviar(`${R}/regras`, corpo, confiar<{ id: number }>(), novaChave('vf-regra'));
export const encerrarRegraVariavelFaixa = (regra: number, versao: number, fim: string) =>
  enviar(`${R}/regras/${regra}/encerrar`, { versao, fim }, confiar<{ id: number }>(), novaChave('vf-fim'));
export const lancarVariavelFaixa = (apuracao: number) =>
  enviar(
    `${R}/lancar`,
    { apuracao },
    confiar<{ lancamentos: number; credito: number; debito: number; pendencias: string[] }>(),
    novaChave('vf-lancar'),
  );
