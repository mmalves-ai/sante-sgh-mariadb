// Módulo de recepção da abertura do atendimento (F3.1, 02-CAD linha 2). A regra de campo do cadastro vale no módulo
// de recepção em que o paciente entra; a tela não precisa informá-lo. Como no mercado, o módulo vem do CANAL DE
// ENTRADA: a agenda (consulta marcada), a urgência (pronto atendimento), a internação (admissão), os exames (SADT) e
// a demanda espontânea do guichê. Regra pura: quem lê o banco entrega os módulos de cada fonte e o domínio escolhe.
//
// Ordem (a fonte mais concreta vale):
//   1. o local de atendimento em que a recepção abre (a tela o manda: o guichê ou a sala);
//   2. o local da origem registrada: o horário da agenda da marcação, ou o local da senha chamada;
//   3. o módulo informado à parte (a tela que trabalha num módulo fixo);
//   4. o canal de entrada e o guichê que o usuário ocupa na sessão: nos canais de atendimento próprio (urgência,
//      internação e exames) vale o módulo do canal, porque o ato decide (quem interna no balcão do guichê está
//      internando); na agenda e na demanda espontânea vale o guichê da sessão, e o canal só na falta dele.
// Nenhuma fonte com módulo: nulo, e só valem as regras de todos os módulos.
import type { TipoAtendimentoRegra } from './regras-campo.js';

export const CANAIS_ENTRADA = ['agenda', 'urgencia', 'internacao', 'exames', 'demanda'] as const;
export type CanalEntrada = (typeof CANAIS_ENTRADA)[number];

/** Canais em que o ato decide o módulo (o do canal vale sobre o guichê ocupado na sessão). */
const CANAIS_DO_ATO: readonly CanalEntrada[] = ['urgencia', 'internacao', 'exames'];

/** O canal de entrada pelo tipo de atendimento da regra e pela origem (marcação da agenda). */
export function canalDaAbertura(o: {
  readonly tipoAtendimento: TipoAtendimentoRegra | null;
  readonly marcacao?: boolean;
}): CanalEntrada {
  if (o.tipoAtendimento === 'urgencia') return 'urgencia';
  if (o.tipoAtendimento === 'internacao') return 'internacao';
  if (o.tipoAtendimento === 'externo') return 'exames';
  return o.marcacao ? 'agenda' : 'demanda';
}

export type FonteModulo = 'local' | 'marcacao' | 'senha' | 'informado' | 'canal' | 'guiche';

/** Os módulos que cada fonte traz (nulo: a fonte não existe ou não tem módulo). */
export interface FontesModuloAbertura {
  readonly canal: CanalEntrada;
  readonly local?: number | null;
  readonly marcacao?: number | null;
  readonly senha?: number | null;
  readonly informado?: number | null;
  readonly doCanal?: number | null;
  readonly guiche?: number | null;
}

export interface ModuloDaAbertura {
  readonly modulo: number | null;
  /** De onde o módulo veio (nulo: nenhuma fonte trouxe módulo). */
  readonly fonte: FonteModulo | null;
}

const valido = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0;

/** O módulo de recepção que vale na abertura, pela ordem das fontes. */
export function moduloDaAbertura(f: FontesModuloAbertura): ModuloDaAbertura {
  const finais: readonly FonteModulo[] = CANAIS_DO_ATO.includes(f.canal)
    ? ['canal', 'guiche']
    : ['guiche', 'canal'];
  const valor: Readonly<Record<FonteModulo, number | null | undefined>> = {
    local: f.local,
    marcacao: f.marcacao,
    senha: f.senha,
    informado: f.informado,
    canal: f.doCanal,
    guiche: f.guiche,
  };
  for (const fonte of ['local', 'marcacao', 'senha', 'informado', ...finais] as const) {
    const v = valor[fonte];
    if (valido(v)) return { modulo: v, fonte };
  }
  return { modulo: null, fonte: null };
}

/** Erros do canal de entrada declarado num módulo de recepção (lista vazia: válido; nulo é aceito). */
export function errosDoCanal(canal: string | null | undefined): string[] {
  if (canal === null || canal === undefined || canal === '') return [];
  return (CANAIS_ENTRADA as readonly string[]).includes(canal) ? [] : ['canal-invalido'];
}
