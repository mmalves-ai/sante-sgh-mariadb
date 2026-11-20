// Estado do formulário enquanto se digita (regras 5 e 6 da ficha do M22; cap-11 §11.1): as regras em JSON Logic
// avaliadas sobre os valores dos componentes (cmpNNN e cmpNNNItemIndex) e do paciente (idade, sexo). O
// comportamento é o do formulário de origem: SÓ habilita e desabilita (não apaga o valor de campo desabilitado:
// ele continua na resposta, como o Delphi mantém) e calcula; o escore calculado (Braden, Morse) é PROPOSTO e o
// profissional confirma (o valor confirmado vai na mesma coluna que o Delphi gravaria). Obrigatório só o do
// vínculo, e só na finalização; o rascunho aceita incompleto.
import type { CampoRegistro, RespostaRegistro, ValorResposta } from '@sgh/contratos';
import { avaliarRegra, type RegraLogica } from '../regras/json-logic.js';
import { dataParaDias, type Valor } from '../regras/valores.js';
import { valorVazio } from '../gravador/colunas.js';
import { planos } from './visao.js';

export interface Paciente {
  readonly idade: number | null;
  readonly sexo: 'F' | 'M' | null;
}

/** Valor do componente para as regras (número, data em dias, índice escolhido; vazio = 0 e índice -1). */
function valorDoComponente(v: ValorResposta | undefined): { valor: Valor; indice: number } {
  if (!v) return { valor: 0, indice: -1 };
  switch (v.tipo) {
    case 'numero':
      return { valor: v.valor, indice: -1 };
    case 'data':
      return { valor: dataParaDias(v.data), indice: -1 };
    case 'hora':
      return { valor: v.hora, indice: -1 };
    case 'escolha':
      return { valor: v.indice, indice: v.indice };
    case 'multipla':
      return { valor: v.indices.length, indice: v.indices[0] ?? -1 };
    case 'texto': {
      const n = Number(v.texto.replace(',', '.'));
      return { valor: v.texto.trim() !== '' && Number.isFinite(n) ? n : v.texto, indice: -1 };
    }
    default:
      return { valor: 0, indice: -1 };
  }
}

export function contextoDasRespostas(
  campos: readonly CampoRegistro[],
  respostas: readonly RespostaRegistro[],
  paciente: Paciente,
): Record<string, Valor> {
  const porVinculo = new Map(respostas.map((r) => [r.vinculo, r.valor]));
  const valores: Record<string, Valor> = {
    PacienteIdade: paciente.idade,
    PacienteSexo: paciente.sexo,
  };
  for (const c of planos(campos)) {
    if (!c.componente) continue;
    const { valor, indice } = valorDoComponente(porVinculo.get(c.vinculo));
    valores[c.componente] = valor;
    valores[`${c.componente}ItemIndex`] = indice;
  }
  return valores;
}

export interface EstadoFormulario {
  /** Campos desabilitados pela regra (vínculo). */
  readonly desabilitados: ReadonlySet<number>;
  /** Valor proposto pelo cálculo (vínculo → valor), a confirmar pelo profissional. */
  readonly calculados: ReadonlyMap<number, Valor>;
  /** Regras que falharam ao avaliar (o campo fica habilitado e sem cálculo). */
  readonly falhas: number;
}

export function avaliarFormulario(
  campos: readonly CampoRegistro[],
  respostas: readonly RespostaRegistro[],
  paciente: Paciente,
  hoje: string,
): EstadoFormulario {
  const ctx = { valores: contextoDasRespostas(campos, respostas, paciente), hoje };
  const desabilitados = new Set<number>();
  const calculados = new Map<number, Valor>();
  let falhas = 0;
  for (const c of planos(campos)) {
    try {
      if (c.habilitar !== null && c.habilitar !== undefined) {
        const r = avaliarRegra(c.habilitar as RegraLogica, ctx);
        if (r === false) desabilitados.add(c.vinculo);
      }
      if (c.calcular !== null && c.calcular !== undefined) {
        const r = avaliarRegra(c.calcular as RegraLogica, ctx);
        if (r !== null) calculados.set(c.vinculo, typeof r === 'number' ? Math.round(r * 1000) / 1000 : r);
      }
    } catch {
      falhas++;
    }
  }
  return { desabilitados, calculados, falhas };
}

export interface Pendencia {
  readonly vinculo: number;
  readonly titulo: string;
  readonly motivo: 'obrigatorio' | 'confirmar-pre-preenchido';
}

/** O que falta para finalizar: obrigatório do vínculo (habilitado) sem resposta; pré-preenchido sem confirmação. */
export function pendenciasParaFinalizar(
  campos: readonly CampoRegistro[],
  respostas: readonly RespostaRegistro[],
  estado: Pick<EstadoFormulario, 'desabilitados'>,
): Pendencia[] {
  const porVinculo = new Map(respostas.map((r) => [r.vinculo, r]));
  const p: Pendencia[] = [];
  for (const c of planos(campos)) {
    if (c.tipo === 'secao' || c.tipo === 'alergias' || c.tipo === 'sem-campo') continue;
    const r = porVinculo.get(c.vinculo);
    if (c.obrigatorio && !estado.desabilitados.has(c.vinculo) && (!r || valorVazio(r.valor)))
      p.push({ vinculo: c.vinculo, titulo: c.titulo, motivo: 'obrigatorio' });
    if (r && r.autopreenchido && !r.confirmado)
      p.push({ vinculo: c.vinculo, titulo: c.titulo, motivo: 'confirmar-pre-preenchido' });
  }
  return p;
}
