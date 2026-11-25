// Lógica da tela das alçadas de aprovação (01-ADM L59), sem Vue: o formulário em texto (como a tela digita), a
// conversão para o corpo da API e a validação na hora pela mesma regra do domínio que o servidor aplica.
import {
  MENSAGEM_ALCADA,
  validarAlcada,
  type LinhaNivelAlcada,
  type RecusaAlcada,
} from '@sgh/dominio-organizacao';
import type { AlcadaApi } from './api-alcadas.js';

export interface NivelForm {
  nivel: number;
  tipo: 'perfil' | 'conta';
  aprovador: string;
  valorMinimo: string;
  valorMaximo: string;
  acumulado: string;
  periodo: string;
  prazoHoras: string;
  obrigatorio: boolean;
}

export interface AlcadaForm {
  id: number | null;
  versao: number | null;
  documento: string;
  descricao: string;
  modo: 'serie' | 'paralelo';
  prazoHoras: string;
  acaoPrazoVencido: 'alertar' | 'escalar' | 'recusar';
  permiteAutoaprovacao: boolean;
  exigeJustificativaRecusa: boolean;
  vigenciaInicio: string;
  vigenciaFim: string;
  niveis: NivelForm[];
}

export const nivelVazio = (nivel: number): NivelForm => ({
  nivel,
  tipo: 'perfil',
  aprovador: '',
  valorMinimo: '0',
  valorMaximo: '',
  acumulado: '',
  periodo: '',
  prazoHoras: '',
  obrigatorio: true,
});

export const formVazio = (hoje: string): AlcadaForm => ({
  id: null,
  versao: null,
  documento: '',
  descricao: '',
  modo: 'serie',
  prazoHoras: '',
  acaoPrazoVencido: 'alertar',
  permiteAutoaprovacao: false,
  exigeJustificativaRecusa: true,
  vigenciaInicio: hoje,
  vigenciaFim: '',
  niveis: [nivelVazio(1)],
});

const txt = (n: number | null): string => (n === null ? '' : String(n));

/** A regra lida vira o formulário de alteração. */
export function formDe(a: AlcadaApi): AlcadaForm {
  return {
    id: a.id,
    versao: a.versao,
    documento: a.documento,
    descricao: a.descricao,
    modo: a.modo === 'paralelo' ? 'paralelo' : 'serie',
    prazoHoras: txt(a.prazoHoras),
    acaoPrazoVencido:
      a.acaoPrazoVencido === 'escalar' || a.acaoPrazoVencido === 'recusar' ? a.acaoPrazoVencido : 'alertar',
    permiteAutoaprovacao: a.permiteAutoaprovacao,
    exigeJustificativaRecusa: a.exigeJustificativaRecusa,
    vigenciaInicio: a.vigenciaInicio,
    vigenciaFim: a.vigenciaFim ?? '',
    niveis: a.niveis.map((n) => ({
      nivel: n.nivel,
      tipo: n.usuario !== null ? 'conta' : 'perfil',
      aprovador: n.usuario ?? n.perfil ?? '',
      valorMinimo: String(n.valorMinimo),
      valorMaximo: txt(n.valorMaximo),
      acumulado: txt(n.valorAcumuladoMaximo),
      periodo: n.periodoAcumulado ?? '',
      prazoHoras: txt(n.prazoHoras),
      obrigatorio: n.obrigatorio,
    })),
  };
}

/** Valor digitado ("1.500,00", "1500.5", "") em número; null quando vazio; NaN quando inválido. */
export function valorDe(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return /^\d+(\.\d{1,2})?$/.test(normal) ? Number(normal) : Number.NaN;
}

const inteiroOuNulo = (s: string): number | null => {
  const t = s.trim();
  return t === '' ? null : /^\d{1,4}$/.test(t) ? Number(t) : Number.NaN;
};

export type ProblemaForm =
  RecusaAlcada | 'documento-obrigatorio' | 'aprovador-obrigatorio' | 'valor-invalido' | 'prazo-invalido';

export const MENSAGEM_FORM: Readonly<Record<ProblemaForm, string>> = {
  ...MENSAGEM_ALCADA,
  'documento-obrigatorio': 'Escolha o tipo de documento que a regra aprova.',
  'aprovador-obrigatorio': 'Escolha o perfil ou a conta que aprova cada linha de nível.',
  'valor-invalido': 'Valores em reais, com até dois decimais (ex.: 1500,00).',
  'prazo-invalido': 'O prazo é um número inteiro de horas, de 1 a 8760.',
};

/** Corpo da API, ou o primeiro problema do formulário (o mesmo que o servidor recusaria). */
export function corpoDe(f: AlcadaForm): { problema: ProblemaForm } | { problema: null; corpo: unknown } {
  if (!f.documento) return { problema: 'documento-obrigatorio' };
  const prazo = inteiroOuNulo(f.prazoHoras);
  if (Number.isNaN(prazo) || prazo === 0 || (prazo !== null && prazo > 8760))
    return { problema: 'prazo-invalido' };
  const niveis = [];
  const linhas: LinhaNivelAlcada[] = [];
  for (const n of f.niveis) {
    if (!n.aprovador.trim()) return { problema: 'aprovador-obrigatorio' };
    const minimo = valorDe(n.valorMinimo) ?? 0;
    const maximo = valorDe(n.valorMaximo);
    const acumulado = valorDe(n.acumulado);
    if ([minimo, maximo, acumulado].some((v) => Number.isNaN(v))) return { problema: 'valor-invalido' };
    const prazoNivel = inteiroOuNulo(n.prazoHoras);
    if (Number.isNaN(prazoNivel) || prazoNivel === 0 || (prazoNivel !== null && prazoNivel > 8760))
      return { problema: 'prazo-invalido' };
    const linha: LinhaNivelAlcada = {
      nivel: n.nivel,
      perfil: n.tipo === 'perfil' ? n.aprovador.trim() : null,
      usuario: n.tipo === 'conta' ? n.aprovador.trim() : null,
      valorMinimo: minimo,
      valorMaximo: maximo,
      valorAcumuladoMaximo: acumulado,
      periodoAcumulado: n.periodo || null,
    };
    linhas.push(linha);
    niveis.push({ ...linha, obrigatorio: n.obrigatorio, prazoHoras: prazoNivel });
  }
  const recusa = validarAlcada({
    descricao: f.descricao,
    vigenciaInicio: f.vigenciaInicio,
    vigenciaFim: f.vigenciaFim || null,
    niveis: linhas,
  });
  if (recusa) return { problema: recusa };
  return {
    problema: null,
    corpo: {
      ...(f.id !== null ? { id: f.id } : {}),
      ...(f.versao !== null ? { versao: f.versao } : {}),
      documento: f.documento,
      descricao: f.descricao.trim(),
      modo: f.modo,
      prazoHoras: prazo,
      acaoPrazoVencido: f.acaoPrazoVencido,
      permiteAutoaprovacao: f.permiteAutoaprovacao,
      exigeJustificativaRecusa: f.exigeJustificativaRecusa,
      vigenciaInicio: f.vigenciaInicio,
      vigenciaFim: f.vigenciaFim || null,
      niveis,
    },
  };
}

/** Faixa legível de uma linha de nível. */
export function faixa(minimo: number, maximo: number | null, moeda: (v: number) => string): string {
  return maximo === null ? `a partir de ${moeda(minimo)}` : `${moeda(minimo)} a ${moeda(maximo)}`;
}
