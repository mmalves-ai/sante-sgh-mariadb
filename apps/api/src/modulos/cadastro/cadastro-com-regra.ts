// Cadastro e alteração do paciente com a regra de campo do escopo (F3.1, 02-CAD linha 2). A tela que grava (recepção,
// abertura do atendimento, ficha) informa o escopo em que trabalha: módulo de recepção, tipo de atendimento e fonte
// pagadora, pela consulta da rota (?modulo=&tipoAtendimento=&fontePagadora=). Sem escopo, valem as regras gerais do
// estabelecimento e da rede. A regra confere antes de gravar: recusada, nada é gravado.
import { TIPOS_ATENDIMENTO_REGRA, type TipoAtendimentoRegra } from '@sgh/dominio-cadastro';
import type { FichaComplementarPropria } from './ficha-complementar-proprio.js';
import type { ContextoPorta } from './porta.js';

export interface EscopoCadastro {
  readonly modulo: number | null;
  readonly tipoAtendimento: TipoAtendimentoRegra | null;
  readonly fontePagadora: number | null;
}

const idPositivo = (v: unknown): number | null => {
  const n = typeof v === 'string' && /^\d{1,18}$/.test(v) ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** Escopo da consulta da rota; valor inválido ou ausente fica nulo (regra geral). */
export function escopoDaConsulta(q: unknown): EscopoCadastro {
  const o = q && typeof q === 'object' ? (q as Record<string, unknown>) : {};
  const tipo = typeof o['tipoAtendimento'] === 'string' ? o['tipoAtendimento'] : null;
  return {
    modulo: idPositivo(o['modulo']),
    tipoAtendimento:
      tipo && tipo !== 'todos' && (TIPOS_ATENDIMENTO_REGRA as readonly string[]).includes(tipo)
        ? (tipo as TipoAtendimentoRegra)
        : null,
    fontePagadora: idPositivo(o['fontePagadora']),
  };
}

/**
 * Confere a regra de campo do escopo e só então grava (o caminho do POST e do PUT de pacientes). Sem a ficha (porta em
 * memória, sem banco do cliente), não há regra a conferir.
 */
export async function gravarComRegra<T>(
  ficha: FichaComplementarPropria | null,
  c: ContextoPorta,
  dados: Readonly<Record<string, unknown>>,
  modo: 'cadastro' | 'alteracao',
  escopo: EscopoCadastro,
  gravar: () => Promise<T>,
): Promise<T> {
  await ficha?.conferirCampos(c, dados, modo, escopo);
  return gravar();
}
