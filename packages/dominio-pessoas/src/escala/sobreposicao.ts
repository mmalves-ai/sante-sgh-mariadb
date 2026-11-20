// Sobreposição de plantões (M52.2): a mesma pessoa não fica em dois plantões ao mesmo tempo, em nenhum vínculo nem
// tipo (D-SOBRE-52), no estabelecimento; e, pela regra 7 (cap-07 §7.1.2, §7.7.1), nem em outro estabelecimento da Rede.
// A consulta à Rede é só leitura e devolve só os intervalos, sem a escala alheia: a recusa não diz o setor nem o nome
// da escala do outro hospital. Se um estabelecimento não respondeu, o plantão entra com o alerta (D-REDE-52).
import { OK, recusar, type Conferencia } from './plantao.js';
import { sobrepoem, type Intervalo } from './tempo.js';

export function conferirSobreposicaoLocal(novo: Intervalo, outros: readonly Intervalo[]): Conferencia {
  return outros.some((o) => sobrepoem(novo, o))
    ? recusar('sobreposicao', 'O colaborador já tem plantão neste horário neste estabelecimento.')
    : OK;
}

export interface PlantoesNaRede {
  /** Os intervalos dos plantões da mesma pessoa nos outros estabelecimentos que responderam. */
  readonly intervalos: readonly Intervalo[];
  /** Quantos estabelecimentos da Rede não responderam agora. */
  readonly semResposta: number;
}

export type ConferenciaRede = Conferencia | { readonly ok: true; readonly alerta: 'rede-nao-conferida' };

export function conferirSobreposicaoRede(novo: Intervalo, rede: PlantoesNaRede): ConferenciaRede {
  if (rede.intervalos.some((o) => sobrepoem(novo, o)))
    return recusar(
      'sobreposicao-rede',
      'O colaborador já tem plantão neste horário em outro estabelecimento da Rede.',
    );
  return rede.semResposta > 0 ? { ok: true, alerta: 'rede-nao-conferida' } : OK;
}
