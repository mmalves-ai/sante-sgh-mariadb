// Cliente das premissas e cenários do orçamento empresarial (C1-125): os cenários (cadastrar, alterar, ativar e
// desativar), as premissas da versão (incluir, alterar, retirar), a escolha do cenário da versão e a projeção. As
// gravações vão com o CSRF e a Idempotency-Key (uma por intenção); Problem Details viram ErroApi com o código da recusa.
import type {
  CenarioOrcamentoEntrada,
  PremissaOrcamentoEntrada,
  ProjecaoCenarioOrcamento,
  TendenciaCenarioOrcamento,
  TipoPremissaOrcamento,
} from '@sgh/dominio-financeiro';
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const O = '/api/financeiro/orcamento';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export interface CenarioOrcamentoVisao {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly tendencia: TendenciaCenarioOrcamento;
  readonly ajusteCentesimos: number;
  readonly ativo: boolean;
  readonly versao: number;
}

export interface PremissaOrcamentoVisao extends PremissaOrcamentoEntrada {
  readonly id: number;
  readonly sequencia: number;
  readonly tipo: TipoPremissaOrcamento;
  readonly versao: number;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
}

export interface PremissasDaVersao {
  readonly versaoId: number;
  readonly versaoRegistro: number;
  readonly situacao: string;
  readonly editavel: boolean;
  readonly cenario: CenarioOrcamentoVisao | null;
  readonly projecao: ProjecaoCenarioOrcamento | null;
  readonly premissas: PremissaOrcamentoVisao[];
}

export const lerCenariosOrcamento = () =>
  ler(`${O}/cenarios`, confiar<{ cenarios: CenarioOrcamentoVisao[] }>());
export const criarCenarioOrcamento = (e: CenarioOrcamentoEntrada & { ativo: boolean }) =>
  enviar(`${O}/cenarios`, e, confiar<{ id: number }>(), novaChave('orc.cenario.criar'));
export const alterarCenarioOrcamento = (
  id: number,
  e: CenarioOrcamentoEntrada & { ativo: boolean; versao: number },
) => enviar(`${O}/cenarios/${id}`, e, confiar<{ versao: number }>(), novaChave('orc.cenario.alterar'));
export const lerPremissasVersao = (id: number) =>
  ler(`${O}/versoes/${id}/premissas`, confiar<PremissasDaVersao>());
export const incluirPremissaOrcamento = (id: number, e: PremissaOrcamentoEntrada) =>
  enviar(
    `${O}/versoes/${id}/premissas`,
    e,
    confiar<{ id: number; sequencia: number }>(),
    novaChave('orc.premissa.incluir'),
  );
export const alterarPremissaOrcamento = (
  id: number,
  premissa: number,
  e: PremissaOrcamentoEntrada & { versao: number },
) =>
  enviar(
    `${O}/versoes/${id}/premissas/${premissa}`,
    e,
    confiar<{ versao: number }>(),
    novaChave('orc.premissa.alterar'),
  );
export const retirarPremissaOrcamento = (id: number, premissa: number, versao: number) =>
  enviar(
    `${O}/versoes/${id}/premissas/${premissa}/retirada`,
    { versao },
    confiar<{ retirada: true }>(),
    novaChave('orc.premissa.retirar'),
  );
export const escolherCenarioVersao = (id: number, versao: number, cenario: number | null) =>
  enviar(
    `${O}/versoes/${id}/cenario`,
    { versao, cenario },
    confiar<{ versao: number }>(),
    novaChave('orc.versao.cenario'),
  );

/** "4,50" → 450 (centésimos de ponto percentual); vazio → null; inválido → NaN (a validação aponta). */
export function centesimosDoTexto(t: string): number | null {
  const s = t.trim().replace(/\./g, '').replace(',', '.').replace('%', '');
  if (s === '') return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  return Math.round(Number(s) * 100);
}
/** "1.825,5" → 1825.5; vazio → null; inválido → NaN. */
export function numeroDoTexto(t: string): number | null {
  const s = t.trim().replace(/\./g, '').replace(',', '.');
  if (s === '') return null;
  if (!/^-?\d+(\.\d{1,4})?$/.test(s)) return Number.NaN;
  return Number(s);
}
/** 450 → "4,50%". */
export const percentualTexto = (c: number | null): string =>
  c === null ? '' : `${c < 0 ? '-' : ''}${(Math.abs(c) / 100).toFixed(2).replace('.', ',')}%`;
