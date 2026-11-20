// Agendamento online do portal do paciente (M50, etapa 2; ficha, regra 3; cap-07 §7.6): regras puras sobre o que cada
// agenda oferece no portal (SGH_AGE_ONLINE_CFG), sobre os horários livres lidos da grade (os mesmos da busca do call
// center) e sobre o que o paciente pode fazer com a marcação. A gravação continua nas receitas do M17 e do M18, que
// reconferem tudo sob a trava (o horário ocupado por outro canal depois da leitura é recusado lá, e aqui só se escolhe
// o próximo livre para oferecer).
import { CONVENIO_PARTICULAR_PORTAL, DIAS_PESQUISA_PORTAL, TETO_HORARIOS_PORTAL } from '@sgh/contratos';
import { diasEntre, type Horario, horarioJaPassou, paraMinutos, type Relogio, somarDias } from '../tempo.js';

export interface ConfigOnline {
  readonly agenda: number;
  readonly ativa: boolean;
  readonly convenios: readonly number[];
  readonly servicos: readonly number[];
  readonly antecedenciaHoras: number;
  readonly horizonteDias: number;
  readonly cancelaAteHoras: number;
  readonly precheckin: boolean;
  readonly valorParticular: number | null;
}

/** Minutos entre o relógio e o horário (negativo: já passou). Datas AAAA-MM-DD e horas HHMM, sem fuso. */
export function minutosAte(h: Horario, r: Relogio): number {
  return diasEntre(r.hoje, h.data) * 1440 + paraMinutos(h.hora) - paraMinutos(r.hhmm);
}

/** A janela de busca do portal para uma agenda: de hoje (ou `de`) até o horizonte configurado. */
export function janelaDoPortal(
  cfg: Pick<ConfigOnline, 'horizonteDias'>,
  r: Relogio,
  de: string | null = null,
) {
  const inicio = de && de > r.hoje ? de : r.hoje;
  const fim = somarDias(r.hoje, cfg.horizonteDias);
  return { de: inicio > fim ? fim : inicio, ate: fim };
}

/**
 * O convênio pode marcar pelo portal nesta agenda? A lista da configuração restringe; vazia, valem os aceitos pela
 * própria agenda (cobertura do M17/M18); a agenda sem lista aceita todos (a regra do legado).
 */
export function convenioLiberado(
  cfg: Pick<ConfigOnline, 'convenios'>,
  daAgenda: readonly number[],
  convenio: number,
): boolean {
  if (cfg.convenios.length > 0 && !cfg.convenios.includes(convenio)) return false;
  return daAgenda.length === 0 || daAgenda.includes(convenio);
}

/** A especialidade (consulta) ou o exame é oferecido pela agenda no portal? null = sem filtro. */
export function servicoLiberado(
  cfg: Pick<ConfigOnline, 'servicos'>,
  daAgenda: readonly number[],
  servico: number | null,
): boolean {
  if (servico === null) return true;
  if (cfg.servicos.length > 0) return cfg.servicos.includes(servico);
  return daAgenda.length === 0 || daAgenda.includes(servico);
}

/** O horário respeita a antecedência mínima e o horizonte da agenda no portal? */
export function horarioDentroDoPortal(
  h: Horario,
  cfg: Pick<ConfigOnline, 'antecedenciaHoras' | 'horizonteDias'>,
  r: Relogio,
): boolean {
  if (horarioJaPassou(h, r)) return false;
  if (minutosAte(h, r) < cfg.antecedenciaHoras * 60) return false;
  return h.data <= somarDias(r.hoje, cfg.horizonteDias);
}

export interface VagaDoPortal extends Horario {
  readonly agenda: number;
}

/**
 * Os horários livres que o portal mostra: só das agendas ativas na configuração, dentro da antecedência e do
 * horizonte de cada uma, em ordem de data e hora, até o teto (200; o resto fica para "ver mais tarde").
 */
export function horariosDoPortal<T extends VagaDoPortal>(
  vagas: readonly T[],
  cfgs: ReadonlyMap<number, ConfigOnline>,
  r: Relogio,
  teto = TETO_HORARIOS_PORTAL,
): { itens: T[]; truncado: boolean } {
  const ok = vagas
    .filter((v) => {
      const c = cfgs.get(v.agenda);
      return c !== undefined && c.ativa && horarioDentroDoPortal(v, c, r);
    })
    .sort((a, b) => a.data.localeCompare(b.data) || a.hora.localeCompare(b.hora) || a.agenda - b.agenda);
  return { itens: ok.slice(0, teto), truncado: ok.length > teto };
}

/**
 * Colisão transparente (regra 3): o horário escolhido acabou de ser ocupado por outro canal; o portal oferece o
 * próximo livre da mesma agenda, relido depois da recusa (o ocupado já não está entre as vagas).
 */
export function proximoOferecido<T extends VagaDoPortal>(
  relidas: readonly T[],
  ocupado: VagaDoPortal,
  cfg: ConfigOnline,
  r: Relogio,
): T | null {
  return (
    horariosDoPortal(
      relidas.filter(
        (v) =>
          v.agenda === ocupado.agenda &&
          (v.data > ocupado.data || (v.data === ocupado.data && v.hora > ocupado.hora)),
      ),
      new Map([[cfg.agenda, cfg]]),
      r,
      1,
    ).itens[0] ?? null
  );
}

export type EstadoParaPortal =
  'marcada' | 'confirmada' | 'chegou' | 'atendida' | 'faltou' | 'transferida' | 'outra';

export interface Decisao {
  readonly pode: boolean;
  readonly motivo: string | null;
}
const sim: Decisao = { pode: true, motivo: null };
const nao = (motivo: string): Decisao => ({ pode: false, motivo });

/**
 * O paciente pode cancelar ou remarcar pelo portal? Só marcação aberta (sem chegada nem atendimento), de agenda
 * liberada no portal, até o prazo da agenda (`cancelaAteHoras` antes do horário). Depois disso, pelo telefone.
 */
export function podeMudarPeloPortal(
  m: Horario & { readonly estado: EstadoParaPortal },
  cfg: Pick<ConfigOnline, 'ativa' | 'cancelaAteHoras'> | null,
  r: Relogio,
): Decisao {
  if (m.estado !== 'marcada' && m.estado !== 'confirmada')
    return nao('Esta marcação já não pode ser mudada pelo portal.');
  if (!cfg || !cfg.ativa) return nao('Esta agenda não aceita mudanças pelo portal: ligue para a central.');
  if (horarioJaPassou(m, r)) return nao('O horário já passou.');
  if (minutosAte(m, r) < cfg.cancelaAteHoras * 60)
    return nao(
      `Pelo portal, só até ${cfg.cancelaAteHoras} hora(s) antes do horário. Para mudar agora, ligue para a central.`,
    );
  return sim;
}

/** Valor cobrado pelo portal: só no particular e só quando a agenda tem o valor configurado. */
export function valorDoPortal(
  cfg: Pick<ConfigOnline, 'valorParticular'> | null,
  convenio: number,
): number | null {
  if (!cfg || cfg.valorParticular === null || convenio !== CONVENIO_PARTICULAR_PORTAL) return null;
  return cfg.valorParticular;
}

/**
 * A pesquisa de satisfação fica aberta depois que o paciente veio (chegada registrada ou atendimento), por 30 dias,
 * uma vez por marcação.
 */
export function pesquisaAberta(
  m: Horario & { readonly estado: EstadoParaPortal },
  respondida: boolean,
  r: Relogio,
): boolean {
  if (respondida || (m.estado !== 'atendida' && m.estado !== 'chegou')) return false;
  const dias = diasEntre(m.data, r.hoje);
  return dias >= 0 && dias <= DIAS_PESQUISA_PORTAL;
}
