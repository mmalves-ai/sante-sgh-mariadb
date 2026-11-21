// Regra 3 do M52 (ATO-03, RDC63-06; cap-07 §7.1.1): conselho vencido não entra na escala; o alerta antecede o
// bloqueio. A conferência é feita no DIA DO PLANTÃO (um registro que vence antes do plantão bloqueia aquele plantão,
// ainda que hoje esteja válido). Fica pronta na F1 para a montagem da escala (F2) usar.
// Sem validade informada (o RH ainda não conferiu): o plantão entra com alerta (D-CONS-52, POL-5), porque o outro
// sistema não guarda validade e bloquear tudo no primeiro dia pararia a escala; o alerta aparece para o RH e para o
// coordenador até a conferência.
import { JANELA_ALERTA_CONSELHO_DIAS } from '@sgh/contratos';
import { dataDe } from '../datas.js';
import { situacaoHabilitacao } from '../habilitacao/validade.js';

export interface RegistroDoProfissional {
  readonly registro: number;
  /** Sigla do conselho de classe: CRM, COREN… */
  readonly conselho: string | null;
  readonly ativo: boolean | null;
  readonly validade: string | null;
}

export type ConferenciaConselho =
  | { readonly permitido: true; readonly alerta: null | 'aVencer' | 'semValidade'; readonly registro: number }
  | {
      readonly permitido: false;
      readonly motivo: 'sem-registro' | 'vencido';
      readonly mensagem: string;
    };

/**
 * Confere se o profissional pode entrar no plantão. `conselhoExigido` (ex.: COREN na escala de enfermagem) limita os
 * registros considerados; sem ele, qualquer registro ativo serve. Entre os registros que servem, vale o melhor.
 */
export function conferirConselhoParaPlantao(
  registros: readonly RegistroDoProfissional[],
  inicioPlantao: string,
  opcoes: { readonly conselhoExigido?: string; readonly janelaDias?: number } = {},
): ConferenciaConselho {
  const exigido = opcoes.conselhoExigido?.trim().toUpperCase();
  const candidatos = registros.filter(
    (r) => r.ativo !== false && (!exigido || r.conselho?.trim().toUpperCase() === exigido),
  );
  if (candidatos.length === 0)
    return {
      permitido: false,
      motivo: 'sem-registro',
      mensagem: exigido
        ? `O profissional não tem registro ativo no ${exigido}.`
        : 'O profissional não tem registro ativo no conselho.',
    };
  const dia = dataDe(inicioPlantao);
  const janela = opcoes.janelaDias ?? JANELA_ALERTA_CONSELHO_DIAS;
  const avaliados = candidatos.map((r) => ({ r, s: situacaoHabilitacao(r.validade, dia, janela) }));
  const valido = avaliados.find((a) => a.s.situacao === 'valida');
  if (valido) return { permitido: true, alerta: null, registro: valido.r.registro };
  const aVencer = avaliados.find((a) => a.s.situacao === 'aVencer');
  if (aVencer) return { permitido: true, alerta: 'aVencer', registro: aVencer.r.registro };
  const sem = avaliados.find((a) => a.s.situacao === 'semValidade');
  if (sem) return { permitido: true, alerta: 'semValidade', registro: sem.r.registro };
  return {
    permitido: false,
    motivo: 'vencido',
    mensagem: 'O registro no conselho estará vencido no dia do plantão.',
  };
}
