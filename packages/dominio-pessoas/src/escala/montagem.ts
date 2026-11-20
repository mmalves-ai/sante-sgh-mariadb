// Montagem da escala (M52.2; ficha, seção 8, regras 3 e 5 a 8): a conferência completa de um plantão antes de gravar,
// na ordem: a forma do plantão; o motivo na escala publicada (regra 8); o vínculo ativo no dia; o conselho no dia do
// plantão (regra 3, o exigido pelo tipo da escala); a sobreposição no estabelecimento; a interjornada do contrato
// (regra 5); o limite semanal do contrato (regra 6); a sobreposição na Rede (regra 7). A API relê tudo dentro da
// transação e chama de novo antes de gravar.
import { CONSELHO_DA_ESCALA, type EstadoEscala, type TipoEscala, type TipoVinculo } from '@sgh/contratos';
import { dataDe, diasEntre } from '../datas.js';
import { conferirConselhoParaPlantao, type RegistroDoProfissional } from './conselho-vencido.js';
import { conferirInterjornada, type RegraDescanso } from './interjornada.js';
import { conferirLimiteSemanal, limiteSemanalEfetivo, type RegraLimite } from './limite-contrato.js';
import { conferirFormaDoPlantao, recusar, type PlantaoProposto, type Recusa } from './plantao.js';
import { conferirMudancaNaEscala } from './publicacao.js';
import { conferirSobreposicaoLocal, conferirSobreposicaoRede, type PlantoesNaRede } from './sobreposicao.js';
import type { Intervalo } from './tempo.js';

export interface ContextoMontagem {
  readonly escala: { readonly competencia: string; readonly tipo: TipoEscala; readonly estado: EstadoEscala };
  readonly vinculo: {
    readonly tipo: TipoVinculo;
    readonly admissao: string;
    readonly desligamento: string | null;
  };
  /** Os registros do conselho do profissional do vínculo, com a validade conferida pelo RH. */
  readonly registros: readonly RegistroDoProfissional[];
  readonly regime: (RegraDescanso & RegraLimite) | null;
  /** As outras jornadas e sobreavisos do MESMO vínculo (qualquer escala), sem o próprio plantão. */
  readonly doVinculo: readonly PlantaoProposto[];
  /** Os outros plantões da MESMA pessoa no estabelecimento (todos os vínculos), sem o próprio plantão. */
  readonly daPessoa: readonly Intervalo[];
  /** Os plantões da pessoa nos outros estabelecimentos da Rede (null: não consultada). */
  readonly rede: PlantoesNaRede | null;
  readonly motivo: string | null;
  readonly janelaDias?: number;
}

export type ResultadoMontagem =
  | {
      readonly ok: true;
      readonly registro: number | null;
      readonly alertaConselho: 'aVencer' | 'semValidade' | null;
      readonly redeNaoConferida: boolean;
      readonly limiteSemanalHoras: number;
    }
  | Recusa;

export function conferirPlantaoNaEscala(p: PlantaoProposto, c: ContextoMontagem): ResultadoMontagem {
  const forma = conferirFormaDoPlantao(p, c.escala.competencia);
  if (!forma.ok) return forma;
  const mudanca = conferirMudancaNaEscala(c.escala.estado, c.motivo);
  if (!mudanca.ok) return mudanca;
  const dia = dataDe(p.inicio);
  if (diasEntre(c.vinculo.admissao, dia) < 0)
    return recusar('antes-da-admissao', 'O plantão é anterior à admissão do colaborador.');
  if (c.vinculo.desligamento !== null && diasEntre(c.vinculo.desligamento, dataDe(p.fim)) > 0)
    return recusar('depois-do-desligamento', 'O colaborador está desligado nesta data.');

  let registro: number | null = null;
  let alertaConselho: 'aVencer' | 'semValidade' | null = null;
  const exigido = CONSELHO_DA_ESCALA[c.escala.tipo];
  if (exigido !== null) {
    const conf = conferirConselhoParaPlantao(c.registros, p.inicio, {
      ...(exigido !== 'qualquer' ? { conselhoExigido: exigido } : {}),
      ...(c.janelaDias !== undefined ? { janelaDias: c.janelaDias } : {}),
    });
    if (!conf.permitido) return recusar(`conselho-${conf.motivo}`, conf.mensagem);
    registro = conf.registro;
    alertaConselho = conf.alerta;
  }

  const local = conferirSobreposicaoLocal(p, c.daPessoa);
  if (!local.ok) return local;
  const inter = conferirInterjornada(p, c.doVinculo, c.regime);
  if (!inter.ok) return inter;
  const limite = limiteSemanalEfetivo(c.regime, c.vinculo.tipo);
  const semanal = conferirLimiteSemanal(p, c.doVinculo, limite);
  if (!semanal.ok) return semanal;
  let redeNaoConferida = c.rede === null;
  if (c.rede) {
    const r = conferirSobreposicaoRede(p, c.rede);
    if (!r.ok) return r;
    redeNaoConferida = 'alerta' in r;
  }
  return { ok: true, registro, alertaConselho, redeNaoConferida, limiteSemanalHoras: limite };
}
