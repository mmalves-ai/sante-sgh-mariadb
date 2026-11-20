// Pré-check-in do portal do paciente (M50, etapa 2; ficha, regra 4; cap-07 §7.6, Pré-check-in): regras puras. O
// paciente propõe o contato e o endereço, envia os documentos e a carteirinha e aceita o termo; NADA vai ao cadastro
// até a recepção conferir. Na conferência, a recepção vê o que muda campo a campo e aprova só o que conferiu no
// documento; os campos aprovados viram a alteração do cadastro do M11 (a mesma receita do balcão).
import {
  CAMPOS_PRECHECKIN,
  type CampoConferencia,
  type CampoPreCheckin,
  DIAS_ANTES_PRECHECKIN,
} from '@sgh/contratos';
import { horarioJaPassou, type Horario, type Relogio, somarDias } from '../tempo.js';
import type { Decisao, EstadoParaPortal } from './regras.js';

type Valor = string | number | null | undefined;
const normal = (v: Valor): string => (v === null || v === undefined ? '' : String(v).trim().toUpperCase());

/** O que muda, campo a campo, entre o cadastro de hoje e o proposto (só os campos que o paciente mandou). */
export function camposParaConferir(
  atual: Partial<Record<CampoPreCheckin, Valor>>,
  proposto: Partial<Record<CampoPreCheckin, string | number>>,
): CampoConferencia[] {
  const r: CampoConferencia[] = [];
  for (const campo of CAMPOS_PRECHECKIN) {
    const p = proposto[campo];
    if (p === undefined) continue;
    const a = atual[campo];
    r.push({ campo, atual: a ?? null, proposto: p, muda: normal(a) !== normal(p) });
  }
  return r;
}

/**
 * A alteração do cadastro (entrada de `cadastro.alterarPaciente`) com só os campos aprovados que mudam. Os campos
 * aprovados que não mudam ficam de fora (a receita recusaria "nenhum campo alterado"); o endereço vai junto: com o
 * CEP aprovado, o logradouro, o número, o complemento e o bairro propostos acompanham (o CEP completa o endereço).
 */
export function alteracaoAprovada(
  campos: readonly CampoConferencia[],
  aprovados: readonly CampoPreCheckin[],
): Partial<Record<CampoPreCheckin, string | number>> {
  const sim = new Set(aprovados);
  if (sim.has('cep')) for (const c of ['logradouro', 'numero', 'complemento', 'bairro'] as const) sim.add(c);
  const r: Partial<Record<CampoPreCheckin, string | number>> = {};
  for (const c of campos) if (sim.has(c.campo) && c.muda) r[c.campo] = c.proposto;
  return r;
}

/** Campos aprovados que não foram propostos: a conferência só aprova o que o paciente mandou. */
export function aprovadosForaDoProposto(
  campos: readonly CampoConferencia[],
  aprovados: readonly CampoPreCheckin[],
): CampoPreCheckin[] {
  const propostos = new Set(campos.map((c) => c.campo));
  return aprovados.filter((a) => !propostos.has(a));
}

/**
 * O paciente pode enviar (ou reenviar) o pré-check-in? Só da marcação aberta, de agenda com o pré-check-in ligado, a
 * partir de 7 dias antes até o horário; o conferido não muda mais.
 */
export function podeEnviarPreCheckin(
  m: Horario & { readonly estado: EstadoParaPortal },
  cfg: { readonly ativa: boolean; readonly precheckin: boolean } | null,
  situacao: 'enviado' | 'conferido' | 'recusado' | 'cancelado' | null,
  r: Relogio,
): Decisao {
  if (situacao === 'conferido')
    return { pode: false, motivo: 'O pré-check-in já foi conferido pela recepção.' };
  if (m.estado !== 'marcada' && m.estado !== 'confirmada')
    return { pode: false, motivo: 'O pré-check-in é só para marcações ainda não atendidas.' };
  if (!cfg || !cfg.ativa || !cfg.precheckin)
    return { pode: false, motivo: 'Esta agenda não tem pré-check-in pelo portal: faça na recepção.' };
  if (horarioJaPassou(m, r)) return { pode: false, motivo: 'O horário já passou.' };
  if (m.data > somarDias(r.hoje, DIAS_ANTES_PRECHECKIN))
    return {
      pode: false,
      motivo: `O pré-check-in abre ${DIAS_ANTES_PRECHECKIN} dias antes do horário.`,
    };
  return { pode: true, motivo: null };
}
