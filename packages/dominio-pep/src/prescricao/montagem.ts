// Montagem da gravação de um item (o que a aplicação entrega ao adaptador): do item da tela ao lançamento com o
// tipo do cadastro, o número de doses, os horários previstos (grade da unidade, âncoras relativas, horários da dieta,
// "iniciar agora"), o kit de materiais do medicamento, as etapas da solução e a integração com o estoque pela regra
// medida na cópia (por item: o produto que sai do estoque — medicamento fora de "a critério" e "se necessário",
// solução fora de "a critério"; dieta, cuidado e glicemia só com produto no item; jejum, dieta livre, ventilação e
// hemoterapia não). Pura: os cadastros chegam já lidos.
import { type ItemPrescricao, PLANO_DO_TIPO } from '@sgh/contratos';
import {
  dosesNoPeriodo,
  frequencia as frequenciaDe,
  NATUREZAS_A_CRITERIO,
  SEM_FREQUENCIA,
} from './catalogo.js';
import { horariosPrevistos } from './horarios-previstos.js';
import { DIA, localDe, minLocal, minutoDoDia } from './tempo.js';
import type { Periodo } from './vigencia.js';

export interface KitMontado {
  readonly produto: number;
  readonly quantidade: number;
  readonly unidade: string;
}

export interface ContextoMontagem {
  readonly vigencia: Periodo;
  readonly agora: string;
  /** Grade da unidade por número de doses (HH:MM). */
  readonly grade: ReadonlyMap<number, readonly string[]>;
  /** Âncoras relativas (id → HH:MM). */
  readonly relativos: ReadonlyMap<number, string>;
  /** Horários da dieta do cadastro (HH:MM ativos), quando a dieta tem horário próprio. */
  readonly horariosDieta: (dieta: number) => readonly string[];
  /** Kit de materiais do medicamento que casa com o produto, a via, a unidade e a dose (vazio sem kit). */
  readonly kit: (produto: number, via: string, unidade: string, dose: number) => readonly KitMontado[];
  /** Retrato do CID da justificativa do não padronizado. */
  readonly retratoCid: (cid: string) => number | null;
  /** mL/h por unidade de velocidade de infusão (ausente: mL/h). */
  readonly mlPorHora?: (unidadeInfusao: number) => number | null;
}

const CLASSE_DA_DIETA = {
  jejum: 'jejum',
  'dieta-livre': 'livre',
  'dieta-oral': 'oral',
  'dieta-enteral': 'enteral',
} as const;

export interface HorarioMontado {
  readonly dataHora: string;
  readonly relativo: number | null;
}

export type DetalheMontado =
  | {
      tipo: 'medicamento';
      produto: number;
      dose: number;
      unidade: string;
      agora: boolean;
      naoAjustar: boolean;
      tempoInfusaoMinutos: number | null;
      naoPadronizado: { justificativa: string; htcid: number } | null;
      justificativaAlergia: string | null;
      seNecessario: number[];
      intervaloMinimoMinutos: number | null;
      doseMaxima: { dose: number; periodoHoras: number } | null;
      kit: KitMontado[];
    }
  | {
      tipo: 'procedimento';
      procedimento: number;
      agora: boolean;
      naoAjustar: boolean;
      seNecessario: number[];
      faixas: { de: number; ate: number; produto: number; dose: number; unidade: string; via: string }[];
    }
  | {
      tipo: 'dieta';
      classe: 'jejum' | 'livre' | 'oral' | 'enteral';
      dieta: number;
      viaDieta: number | null;
      quantidade: number | null;
      unidade: string | null;
      tipoInfusao: number | null;
      velocidade: number | null;
      unidadeInfusao: number | null;
      caracteristicas: { caracteristica: number; resposta: string }[];
      /** Composição por refeição (03-PEP L112), na ordem da tela; `substitui` é a posição do titular. */
      refeicoes: {
        refeicao: number;
        alimento: number;
        quantidade: number;
        unidade: number | null;
        medidaCaseira: number | null;
        quantidadeMedidaCaseira: number | null;
        substitui: number | null;
        percentualDiario: number | null;
        calorias: number | null;
      }[];
    }
  | {
      tipo: 'solucao';
      unidade: string;
      tipoInfusao: number;
      agora: boolean;
      naoAjustar: boolean;
      componentes: { produto: number; dose: number; unidade: string; principal: boolean; etapa: number }[];
      etapas: {
        etapa: number;
        inicio: string;
        fim: string;
        velocidade: number;
        unidadeInfusao: number;
        volume: number;
      }[];
    }
  | {
      tipo: 'vmi';
      viaAerea: number;
      modo: number;
      unidade: string;
      frequenciaRespiratoria: number | null;
      peep: number | null;
      volumeCorrente: number | null;
      pressao: number | null;
      unidadePressao: number | null;
      fio2: number | null;
      unidadeFio2: number | null;
      tempoInspiratorio: number | null;
      tempoExpiratorio: number | null;
    }
  | {
      tipo: 'vni';
      viaAerea: number;
      modo: number;
      pressaoInspiratoria: number | null;
      unidadePressaoInspiratoria: number | null;
      pressaoExpiratoria: number | null;
      pressaoSuporte: number | null;
      duracaoMinutos: number | null;
      fio2: number | null;
      unidadeFio2: number | null;
    }
  | {
      tipo: 'hemoterapia';
      ato: number;
      codigo: string;
      dose: number;
      unidade: string;
      tipoInfusao: number;
      indicacao: string | null;
      agora: boolean;
    };

export interface ItemMontado {
  chave: string;
  plano: number;
  numDose: number;
  frequencia: number | null;
  via: string | null;
  observacao: string | null;
  integracaoEstoque: boolean;
  detalhe: DetalheMontado;
  horarios: HorarioMontado[];
}

/** Unidades de ventilação e hemoterapia que a tela não pede (os padrões do cadastro, lidos pela aplicação). */
export interface PadroesMontagem {
  readonly unidadeVolume: string;
  readonly unidadePressao: number | null;
  readonly unidadeFio2: number | null;
  readonly tipoInfusaoHemoterapia: number;
  readonly unidadeHemoterapia: string;
}

export class ErroMontagem extends Error {
  override readonly name = 'ErroMontagem';
}

export function montarItem(i: ItemPrescricao, c: ContextoMontagem, p: PadroesMontagem): ItemMontado {
  const d = i.detalhe;
  const idFreq = 'frequencia' in d ? d.frequencia : null;
  const f = frequenciaDe(idFreq);
  if (!f) throw new ErroMontagem(`Frequência fora das oferecidas no item ${i.chave}.`);
  const base = { vigencia: c.vigencia, agora: c.agora, grade: c.grade };
  const observacao = i.observacaoEnfermagem?.trim() ? i.observacaoEnfermagem : null;
  const aCriterio = NATUREZAS_A_CRITERIO.includes(f.natureza);
  const comum = {
    chave: i.chave,
    plano: PLANO_DO_TIPO[d.tipo],
    frequencia: f === SEM_FREQUENCIA ? null : f.id,
    observacao,
  };
  const previstos = (extra: {
    iniciarAgora?: boolean;
    primeiroHorario?: string | null;
    relativos?: number[];
  }) =>
    horariosPrevistos({
      ...base,
      frequencia: f,
      iniciarAgora: extra.iniciarAgora ?? false,
      primeiroHorario: extra.primeiroHorario ?? null,
      relativos: (extra.relativos ?? []).map((id) => {
        const h = c.relativos.get(id);
        if (!h) throw new ErroMontagem(`Horário relativo desconhecido no item ${i.chave}.`);
        return { id, horario: h };
      }),
    }).map((h) => ({ dataHora: h.dataHora, relativo: h.relativo }));
  switch (d.tipo) {
    case 'medicamento': {
      const kit = [...c.kit(d.item.produto, d.via, d.unidade, d.dose)];
      // "Se necessário" não tem horário fixo pendente: a dose é registrada quando a condição ocorre.
      const horarios = d.seNecessario
        ? []
        : previstos({
            iniciarAgora: d.iniciarAgora,
            primeiroHorario: d.primeiroHorario ?? null,
            relativos: d.relativos,
          });
      const np = d.item.naoPadronizado;
      const htcid = np ? c.retratoCid(np.cid) : null;
      if (np && htcid === null)
        throw new ErroMontagem(`CID da justificativa sem retrato no item ${i.chave}.`);
      return {
        ...comum,
        numDose: dosesNoPeriodo(f, d.relativos.length),
        via: d.via,
        integracaoEstoque: !aCriterio && !d.seNecessario,
        detalhe: {
          tipo: 'medicamento',
          produto: d.item.produto,
          dose: d.dose,
          unidade: d.unidade,
          agora: d.iniciarAgora,
          naoAjustar: d.naoAjustar,
          tempoInfusaoMinutos: d.tempoInfusaoMinutos ?? null,
          naoPadronizado: np && htcid !== null ? { justificativa: np.justificativa, htcid } : null,
          justificativaAlergia:
            i.decisoes
              .filter((x) => x.alerta.startsWith('alergia:') && x.decisao === 'mantido')
              .map((x) => x.justificativa?.trim() ?? '')
              .filter(Boolean)
              .join('; ')
              .slice(0, 255) || null,
          seNecessario: d.seNecessario?.motivos ?? [],
          intervaloMinimoMinutos: d.seNecessario
            ? Math.round(d.seNecessario.intervaloMinimoHoras * 60)
            : null,
          doseMaxima: d.seNecessario?.doseMaxima ?? null,
          kit,
        },
        horarios,
      };
    }
    case 'procedimento':
    case 'glicemia': {
      const glicemia = d.tipo === 'glicemia';
      return {
        ...comum,
        numDose: dosesNoPeriodo(f, d.tipo === 'procedimento' ? d.relativos.length : 0),
        via: null,
        integracaoEstoque: false,
        detalhe: {
          tipo: 'procedimento',
          procedimento: d.procedimento,
          agora: d.iniciarAgora,
          naoAjustar: d.naoAjustar,
          seNecessario: d.tipo === 'procedimento' ? (d.seNecessario?.motivos ?? []) : [],
          faixas: glicemia
            ? d.faixas.map((x) => ({
                de: x.de,
                ate: x.ate,
                produto: x.produto,
                dose: x.dose,
                unidade: x.unidade,
                via: x.via,
              }))
            : [],
        },
        horarios:
          d.tipo === 'procedimento' && d.seNecessario
            ? []
            : previstos({
                iniciarAgora: d.iniciarAgora,
                primeiroHorario: d.tipo === 'procedimento' ? (d.primeiroHorario ?? null) : null,
                relativos: d.tipo === 'procedimento' ? d.relativos : [],
              }),
      };
    }
    case 'jejum':
    case 'dieta-livre':
    case 'dieta-oral':
    case 'dieta-enteral': {
      const proprios = c.horariosDieta(d.dieta);
      const horarios =
        proprios.length > 0 && f === SEM_FREQUENCIA
          ? horariosDaGrade(proprios, c.vigencia, c.agora)
          : previstos({});
      const enteral = d.tipo === 'dieta-enteral' ? d : null;
      return {
        ...comum,
        numDose: f === SEM_FREQUENCIA ? 1 : dosesNoPeriodo(f, 0),
        via: d.via ?? null,
        integracaoEstoque: false,
        detalhe: {
          tipo: 'dieta',
          classe: CLASSE_DA_DIETA[d.tipo],
          dieta: d.dieta,
          viaDieta: enteral?.viaDieta ?? null,
          // Jejum e dieta livre não têm quantidade: nulo, nunca o 0.
          quantidade: d.tipo === 'dieta-oral' || d.tipo === 'dieta-enteral' ? d.quantidade : null,
          unidade: enteral?.unidade ?? null,
          tipoInfusao: enteral?.tipoInfusao ?? null,
          velocidade: enteral?.velocidade ?? null,
          unidadeInfusao: enteral?.unidadeInfusao ?? null,
          caracteristicas: d.caracteristicas.map((k) => ({
            caracteristica: k.caracteristica,
            resposta: k.resposta ?? '',
          })),
          refeicoes: d.refeicoes.map((r) => ({ ...r })),
        },
        horarios,
      };
    }
    case 'solucao': {
      // Cada componente na etapa que a tela indicou (sem indicação: a primeira). As etapas correm em sequência a
      // partir do início do item, cada uma com a duração do seu volume na velocidade digitada (volume = velocidade ×
      // tempo); a conferência do domínio recusa a etapa que sair da vigência.
      const primeiraEtapa = d.etapas[0]?.etapa ?? 1;
      const etapaDe = (cp: { etapa?: number | undefined }) => cp.etapa ?? primeiraEtapa;
      let cursor = Math.max(minLocal(c.vigencia.inicio), minLocal(c.agora));
      const etapas = d.etapas.map((e) => {
        const volume = d.componentes
          .filter((cp) => cp.principal && etapaDe(cp) === e.etapa)
          .reduce((s, cp) => s + cp.dose, 0);
        const fator = c.mlPorHora?.(e.unidadeInfusao) ?? 1;
        const minutos = Math.max(1, Math.round((volume / (e.velocidade * fator)) * 60));
        const a = cursor;
        cursor += minutos;
        return {
          etapa: e.etapa,
          inicio: localDe(a),
          fim: localDe(cursor),
          velocidade: e.velocidade,
          unidadeInfusao: e.unidadeInfusao,
          volume,
        };
      });
      return {
        ...comum,
        numDose: dosesNoPeriodo(f, 0),
        via: d.via,
        integracaoEstoque: !aCriterio,
        detalhe: {
          tipo: 'solucao',
          unidade: d.unidade ?? 'ML',
          tipoInfusao: d.tipoInfusao ?? 1,
          agora: d.iniciarAgora,
          naoAjustar: d.naoAjustar,
          componentes: d.componentes.map((cp) => ({
            produto: cp.produto,
            dose: cp.dose,
            unidade: cp.unidade,
            principal: cp.principal,
            etapa: etapaDe(cp),
          })),
          etapas,
        },
        horarios: [],
      };
    }
    case 'vmi':
      return {
        ...comum,
        numDose: f === SEM_FREQUENCIA ? 1 : dosesNoPeriodo(f, 0),
        via: null,
        integracaoEstoque: false,
        detalhe: {
          tipo: 'vmi',
          viaAerea: d.viaAerea,
          modo: d.modo,
          unidade: p.unidadeVolume,
          // Parâmetro não prescrito fica nulo (sem sentinela 0 nem tempo inventado).
          frequenciaRespiratoria: d.frequenciaRespiratoria ?? null,
          peep: d.peep ?? null,
          volumeCorrente: d.volumeCorrente ?? null,
          pressao: d.pressaoInspiratoria ?? null,
          unidadePressao: d.pressaoInspiratoria === undefined ? null : p.unidadePressao,
          fio2: d.fio2 ?? null,
          unidadeFio2: d.fio2 === undefined ? null : p.unidadeFio2,
          tempoInspiratorio: d.tempoInspiratorio ?? null,
          tempoExpiratorio: d.tempoExpiratorio ?? null,
        },
        horarios: previstos({}),
      };
    case 'vni':
      return {
        ...comum,
        numDose: f === SEM_FREQUENCIA ? 1 : dosesNoPeriodo(f, 0),
        via: null,
        integracaoEstoque: false,
        detalhe: {
          tipo: 'vni',
          viaAerea: d.viaAerea,
          modo: d.modo,
          pressaoInspiratoria: d.pressaoInspiratoria ?? null,
          unidadePressaoInspiratoria: d.pressaoInspiratoria === undefined ? null : p.unidadePressao,
          pressaoExpiratoria: d.pressaoExpiratoria ?? null,
          pressaoSuporte: d.pressaoSuporte ?? null,
          duracaoMinutos: d.duracaoMinutos ?? null,
          fio2: d.fio2 ?? null,
          unidadeFio2: d.fio2 === undefined ? null : p.unidadeFio2,
        },
        horarios: previstos({}),
      };
    case 'hemoterapia':
      return {
        ...comum,
        numDose: dosesNoPeriodo(f, 0),
        via: null,
        integracaoEstoque: false,
        detalhe: {
          tipo: 'hemoterapia',
          ato: d.hemocomponente.ato,
          codigo: d.hemocomponente.codigo,
          dose: d.dose,
          unidade: d.unidade || p.unidadeHemoterapia,
          tipoInfusao: p.tipoInfusaoHemoterapia,
          indicacao: d.indicacao,
          agora: d.iniciarAgora,
        },
        horarios: previstos({ iniciarAgora: d.iniciarAgora }),
      };
  }
}

/** Os horários próprios (da dieta) no período: cada hora (HH:MM) uma vez, a partir do momento da prescrição. */
export function horariosDaGrade(horas: readonly string[], v: Periodo, agora: string): HorarioMontado[] {
  const ini = minLocal(v.inicio);
  const fim = minLocal(v.fim);
  const desde = Math.max(ini, minLocal(agora));
  const r = new Set<number>();
  for (const h of horas) {
    const mdd = minutoDoDia(h);
    let t = Math.floor(ini / DIA) * DIA + mdd;
    if (t < ini) t += DIA;
    if (t >= desde && t <= fim) r.add(t);
  }
  return [...r].sort((a, b) => a - b).map((t) => ({ dataHora: localDe(t), relativo: null }));
}

/** O kit de materiais que casa com o medicamento (produto, via, unidade, faixa de dose e tipo de atendimento). */
export function kitQueCasa(
  kits: readonly {
    readonly produto: number;
    readonly doseDe: number;
    readonly doseAte: number;
    readonly unidade: string;
    readonly via: string;
    readonly tipoAtendimento: string | null;
    readonly itens: readonly KitMontado[];
  }[],
  pedido: { produto: number; via: string; unidade: string; dose: number; tipoAtendimento: string },
): KitMontado[] {
  const igual = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
  const casa = kits.filter(
    (k) =>
      k.produto === pedido.produto &&
      igual(k.via, pedido.via) &&
      igual(k.unidade, pedido.unidade) &&
      pedido.dose >= k.doseDe &&
      (k.doseAte <= 0 || pedido.dose <= k.doseAte) &&
      // Tipo do atendimento do kit: vazio ou 'A' (todos; DEFAULT da coluna, 279 de 282 no pc) vale para qualquer.
      (!k.tipoAtendimento ||
        k.tipoAtendimento.trim() === '' ||
        igual(k.tipoAtendimento, 'A') ||
        igual(k.tipoAtendimento, pedido.tipoAtendimento)),
  );
  // Só um kit pode casar; com dois, o mais específico (faixa menor; sem limite de dose é a maior) vale.
  const faixa = (k: { doseDe: number; doseAte: number }) =>
    k.doseAte <= 0 ? Infinity : k.doseAte - k.doseDe;
  casa.sort((a, b) => faixa(a) - faixa(b));
  return casa[0] ? casa[0].itens.map((x) => ({ ...x })) : [];
}
