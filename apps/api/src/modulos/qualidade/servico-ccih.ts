// Montagens da CCIH (M48, etapa 3) sobre o que a porta leu: a fila da vigilância ativa, a fila do antimicrobiano
// restrito com a situação da liberação e a revisão devida, os denominadores por setor e o consumo (DDD e DOT). Só
// cálculo: as regras são as puras de @sgh/dominio-qualidade; nenhuma leitura nem gravação aqui.
import type {
  DecisaoAntimicrobiano,
  DenominadorSetor,
  MotivoVigilancia,
  SitioIras,
  TipoDispositivoInvasivo,
} from '@sgh/contratos';
import {
  consolidarSetores,
  consumoAntimicrobianos,
  denominadoresDoSetor,
  diasDeTerapia,
  diasDeUso,
  dispositivoAssociado,
  emPosOperatorio,
  limitesDaCompetencia,
  motivosVigilancia,
  ordenarVigilancia,
  pesoVigilancia,
  revisaoDevida,
  situacaoDaLiberacao,
  teveFebre,
  type RevisaoDevida,
  type SituacaoDaLiberacao,
} from '@sgh/dominio-qualidade';
import type { AntimicrobianoPrescrito, CulturaDoPaciente, DispositivoInvasivoRegistrado, InternadoCcih, IrasRegistrada, ItemAntimicrobianoConfigurado, LiberacaoAntimicrobianoRegistrada, PrecaucaoRegistrada } from './tipos.js';

/** O leito como a tela mostra. */
export const textoLeito = (i: { bloco: string; acomodacao: string; leito: string }) =>
  [i.bloco, i.acomodacao, i.leito].filter(Boolean).join(' · ');

/** O antimicrobiano em uso: vigente agora (não suspenso, vigência não terminada). */
export function emUso(p: AntimicrobianoPrescrito, agora: string): boolean {
  const fim = [p.fimVigencia, p.suspensoEm].filter((x): x is string => x !== null).sort()[0] ?? null;
  return p.inicioVigencia <= agora && (fim === null || fim > agora);
}

/** O início do tratamento: a vigência mais antiga do mesmo item na internação (entre as lidas). */
export function inicioDoTratamento(
  p: AntimicrobianoPrescrito,
  todos: readonly AntimicrobianoPrescrito[],
): string {
  return todos
    .filter((x) => x.reg === p.reg && x.item === p.item)
    .map((x) => x.inicioVigencia)
    .reduce((m, x) => (x < m ? x : m), p.inicioVigencia)
    .slice(0, 10);
}

export interface ItemFilaAntimicrobiano {
  readonly itemPrescricao: number;
  readonly prescricao: number;
  readonly internacao: number;
  readonly item: number;
  readonly nome: string;
  readonly restrito: boolean;
  readonly prescritoEm: string;
  readonly inicioTratamento: string;
  readonly situacao: SituacaoDaLiberacao;
  readonly liberacao: {
    readonly id: number;
    readonly decisao: string;
    readonly diasAutorizados: number | null;
    readonly decididoEm: string;
    readonly decididoPor: string;
    readonly versao: number;
    readonly revisoes: LiberacaoAntimicrobianoRegistrada['revisoes'];
  } | null;
  readonly revisaoDevida: RevisaoDevida | null;
  readonly ficha: number | null;
}

/** A fila do antimicrobiano: os restritos em uso, com a situação, e os já decididos com a revisão devida. */
export function filaAntimicrobianos(e: {
  readonly prescritos: readonly AntimicrobianoPrescrito[];
  readonly liberacoes: readonly LiberacaoAntimicrobianoRegistrada[];
  readonly itens: readonly ItemAntimicrobianoConfigurado[];
  readonly fichas: ReadonlyMap<number, number>;
  readonly agora: string;
  readonly prazoHoras: number;
  readonly incluirNaoRestritos?: boolean;
}): ItemFilaAntimicrobiano[] {
  const restrito = new Set(e.itens.filter((i) => i.restrito).map((i) => i.item));
  const libs = new Map(e.liberacoes.map((l) => [l.itemPrescricao, l]));
  return e.prescritos
    .filter((p) => emUso(p, e.agora) && (e.incluirNaoRestritos || restrito.has(p.item)))
    .map((p) => {
      const l = libs.get(p.itemPrescricao) ?? null;
      const situacao = situacaoDaLiberacao({
        prescritoEm: p.prescritoEm,
        agora: e.agora,
        prazoHoras: e.prazoHoras,
        decisao: (l?.decisao ?? null) as DecisaoAntimicrobiano | null,
      });
      return {
        itemPrescricao: p.itemPrescricao,
        prescricao: p.prescricao,
        internacao: p.reg,
        item: p.item,
        nome: p.nome,
        restrito: restrito.has(p.item),
        prescritoEm: p.prescritoEm,
        inicioTratamento: l?.inicioTratamento ?? inicioDoTratamento(p, e.prescritos),
        situacao,
        liberacao: l
          ? {
              id: l.id,
              decisao: l.decisao,
              diasAutorizados: l.diasAutorizados,
              decididoEm: l.decididoEm,
              decididoPor: l.decididoPor,
              versao: l.versao,
              revisoes: l.revisoes,
            }
          : null,
        revisaoDevida:
          l && l.decisao !== 'naoLiberado'
            ? revisaoDevida({
                inicio: l.inicioTratamento,
                agora: e.agora,
                diasAutorizados: l.diasAutorizados,
                feitas: { d3: l.revisoes.d3 !== null, d7: l.revisoes.d7 !== null },
              })
            : null,
        ficha: e.fichas.get(p.itemPrescricao) ?? l?.ficha ?? null,
      };
    })
    .sort(
      (a, b) =>
        Number(b.situacao.alerta) - Number(a.situacao.alerta) ||
        Number(a.liberacao !== null) - Number(b.liberacao !== null) ||
        a.prescritoEm.localeCompare(b.prescritoEm),
    );
}

export interface ItemVigilancia {
  readonly internacao: number;
  readonly paciente: number | null;
  readonly nome: string;
  readonly prontuario: number;
  readonly setor: string;
  readonly leito: string;
  readonly entrada: string;
  readonly motivos: MotivoVigilancia[];
  readonly peso: number;
  readonly dispositivos: { id: number; tipo: string; dias: number }[];
  readonly antimicrobianos: { nome: string; restrito: boolean; situacao: string; alerta: boolean }[];
  readonly culturas: { id: number; exame: string; data: string; liberado: boolean }[];
  readonly febre: boolean;
  readonly posOperatorio: boolean;
  readonly precaucoes: string[];
  readonly iras: number;
}

/** A fila da vigilância ativa (só quem tem algum motivo), na ordem do peso. */
export function montarVigilancia(e: {
  readonly internados: readonly InternadoCcih[];
  readonly dispositivos: readonly DispositivoInvasivoRegistrado[];
  readonly fila: readonly ItemFilaAntimicrobiano[];
  readonly prescritos: readonly AntimicrobianoPrescrito[];
  readonly culturas: readonly CulturaDoPaciente[];
  readonly cirurgias: readonly { reg: number; data: string }[];
  readonly temperaturas: readonly { paciente: number; valor: number; em: string }[];
  readonly precaucoes: readonly PrecaucaoRegistrada[];
  readonly iras: readonly IrasRegistrada[];
  readonly agora: string;
}): ItemVigilancia[] {
  const hoje = e.agora.slice(0, 10);
  const itens = e.internados.map((i): ItemVigilancia => {
    const disp = e.dispositivos.filter((d) => d.reg === i.reg && d.retiradoEm === null);
    const fila = e.fila.filter((f) => f.internacao === i.reg);
    const emUsoAgora = e.prescritos.filter((p) => p.reg === i.reg && emUso(p, e.agora));
    const culturas = e.culturas.filter((c) => c.reg === i.reg);
    const febre =
      i.paciente !== null &&
      teveFebre(
        e.temperaturas.filter((t) => t.paciente === i.paciente),
        e.agora,
      );
    const posOperatorio = emPosOperatorio(
      e.cirurgias.filter((c) => c.reg === i.reg).map((c) => c.data),
      hoje,
    );
    const precaucoes = e.precaucoes.filter((p) => p.reg === i.reg && p.fimEm === null).map((p) => p.tipo);
    const iras = e.iras.filter((x) => x.reg === i.reg && x.situacao === 'confirmada').length;
    const motivos = motivosVigilancia({
      dispositivosAtivos: disp.length,
      antimicrobianos: emUsoAgora.length,
      restritosSemLiberacao: fila.filter((f) => f.situacao.alerta).length,
      revisoesDevidas: fila.filter((f) => f.revisaoDevida !== null).length,
      culturasRecentes: culturas.length,
      febre,
      posOperatorio,
      precaucoes: precaucoes.length,
      iras,
    });
    const situacaoDe = new Map(fila.map((f) => [f.itemPrescricao, f]));
    return {
      internacao: i.reg,
      paciente: i.paciente,
      nome: i.nome,
      prontuario: i.pront,
      setor: i.bloco,
      leito: textoLeito(i),
      entrada: i.entrada,
      motivos,
      peso: pesoVigilancia(motivos),
      dispositivos: disp.map((d) => ({ id: d.id, tipo: d.tipo, dias: diasDeUso(d, e.agora) })),
      antimicrobianos: emUsoAgora.map((p) => {
        const f = situacaoDe.get(p.itemPrescricao);
        return {
          nome: p.nome,
          restrito: f?.restrito ?? false,
          situacao: f?.situacao.situacao ?? 'liberado',
          alerta: f?.situacao.alerta ?? false,
        };
      }),
      culturas: culturas.map(({ id, exame, data, liberado }) => ({ id, exame, data, liberado })),
      febre,
      posOperatorio,
      precaucoes,
      iras,
    };
  });
  return ordenarVigilancia(itens.filter((x) => x.motivos.length > 0));
}

/** A associação de cada ficha ao dispositivo (só as associadas entram na densidade). */
export function associarIras(
  sitio: SitioIras,
  dispositivos: readonly DispositivoInvasivoRegistrado[],
  dataInfeccao: string,
): number | null {
  return dispositivoAssociado(
    sitio,
    dispositivos.map((d) => ({ ...d, tipo: d.tipo as TipoDispositivoInvasivo })),
    dataInfeccao,
  );
}

/** Os denominadores da competência por setor e o consolidado. */
export function montarDenominadores(e: {
  readonly competencia: string;
  readonly agora: string;
  readonly censo: readonly { setor: string; pacientesDia: number }[];
  readonly dispositivos: readonly DispositivoInvasivoRegistrado[];
  readonly iras: readonly IrasRegistrada[];
  readonly setor?: string;
}): { setores: DenominadorSetor[]; todos: DenominadorSetor } {
  const nomes = [
    ...new Set([
      ...e.censo.map((c) => c.setor),
      ...e.dispositivos.map((d) => d.setor),
      ...e.iras.map((i) => i.setor),
    ]),
  ]
    .filter((s) => !e.setor || s === e.setor)
    .sort();
  const setores = nomes.map((setor) =>
    denominadoresDoSetor({
      setor,
      competencia: e.competencia,
      agora: e.agora,
      pacientesDia: e.censo.find((c) => c.setor === setor)?.pacientesDia ?? 0,
      dispositivos: e.dispositivos
        .filter((d) => d.setor === setor)
        .map((d) => ({ ...d, tipo: d.tipo as TipoDispositivoInvasivo })),
      iras: e.iras
        .filter((i) => i.setor === setor && i.situacao === 'confirmada')
        .map((i) => ({ sitio: i.sitio as SitioIras, setor: i.setor, associada: i.dispositivo !== null })),
    }),
  );
  return { setores, todos: consolidarSetores(setores) };
}

/** O consumo da competência (DDD pelo dispensado, DOT pelas vigências prescritas). */
export function montarConsumo(e: {
  readonly competencia: string;
  readonly dispensado: readonly { item: number; nome: string; unidades: number }[];
  readonly vigencias: readonly AntimicrobianoPrescrito[];
  readonly itens: readonly ItemAntimicrobianoConfigurado[];
  readonly pacientesDia: number;
}) {
  const cfg = new Map(e.itens.map((i) => [i.item, i]));
  const { ate } = limitesDaCompetencia(e.competencia);
  const dot = diasDeTerapia(
    e.vigencias.map((v) => ({
      paciente: v.reg,
      item: v.item,
      de: v.inicioVigencia,
      ate: [v.fimVigencia ?? `${ate}T23:59:59`, v.suspensoEm]
        .filter((x): x is string => x !== null)
        .sort()[0] as string,
    })),
    e.competencia,
  );
  const nomes = new Map([
    ...e.vigencias.map((v) => [v.item, v.nome] as const),
    ...e.dispensado.map((d) => [d.item, d.nome] as const),
  ]);
  const itens = [...new Set([...e.dispensado.map((d) => d.item), ...dot.keys()])].map((item) => ({
    item,
    nome: nomes.get(item) ?? `Item ${String(item)}`,
    atc: cfg.get(item)?.atc ?? null,
    unidades: e.dispensado.find((d) => d.item === item)?.unidades ?? 0,
    dddGramas: cfg.get(item)?.dddGramas ?? null,
    gramasPorUnidade: cfg.get(item)?.gramasPorUnidade ?? null,
  }));
  return consumoAntimicrobianos({ itens, dot, pacientesDia: e.pacientesDia });
}
