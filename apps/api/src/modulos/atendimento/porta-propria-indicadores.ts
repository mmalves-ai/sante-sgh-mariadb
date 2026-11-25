// Leitura dos indicadores do atendimento externo sobre o banco do cliente (F3.2, 02-REC linha 30): só contagens e
// marcas de tempo, nunca uma linha por paciente com dado de identificação. O que cada grupo vale é regra do domínio
// (`@sgh/dominio-atendimento`, indicadores-leitura.ts); aqui ficam só as consultas.
// Entram os atendimentos do estabelecimento da sessão com entrada no período, dos tipos do atendimento externo,
// não excluídos e não cancelados (a exclusão é lógica: o cancelado continua no banco e fica fora da conta).
// Tempos do PA (PA: pronto atendimento): a primeira marca de cada etapa em atendimento_etapa_pa. Observação: a
// ocupação do leito, sem contar a troca de leito como observação nova. Internação via PA: pelo desfecho ou pela
// internação nascida da ficha (a admissão informa a ficha do PA como atendimento de origem, e o atendimento da
// internação fica filho dela), uma vez por ficha; a internação excluída não conta.
import {
  gruposDosIndicadores,
  internacoesDoPa,
  observacoesDosIndicadores,
  TIPOS_DOS_INDICADORES,
  tipoAteDoTipo,
} from '@sgh/dominio-atendimento';
import type { Leitor } from '@sgh/nucleo';
import { ETAPA_NO_BANCO } from './porta-propria-etapas.js';
import type { IndicadoresDados } from './tipos.js';

/** O recorte da leitura: o estabelecimento, os instantes do período e o relógio civil do estabelecimento. */
export interface RecorteIndicadores {
  readonly estabelecimento: number;
  /** Início do primeiro dia e fim do último (instantes; o fim é exclusivo). */
  readonly de: Date;
  readonly ate: Date;
  /** Início da janela das visitas de referência do retorno em 72 horas (3 dias antes do período). */
  readonly deVisitas: Date;
  readonly unidade?: number;
  /** "AAAA-MM-DDTHH:MM:SS" do instante no fuso do estabelecimento. */
  readonly civil: (d: Date) => string;
  readonly agora: Date;
}

/** Teto das leituras por atendimento (um ano de um pronto atendimento grande cabe; acima disso, período menor). */
const TETO = 2_000_000;

/** As marcas que os tempos do PA usam (as demais etapas não entram no indicador). */
const ETAPAS_DO_TEMPO = ['chegada', 'abertura', 'atendimentoMedico', 'decisao', 'saida'] as const;
const ETAPA_DO_BANCO: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ETAPA_NO_BANCO).map(([k, v]) => [v, k]),
);

const instante = (v: unknown): Date | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' && v) {
    const d = new Date(`${v.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};
const sim = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 1n;

export async function lerIndicadoresProprios(l: Leitor, r: RecorteIndicadores): Promise<IndicadoresDados> {
  const marcas = TIPOS_DOS_INDICADORES.map(() => '?').join(', ');
  const base = `
      FROM atendimento a
      JOIN categoria_atendimento ca ON ca.id = a.categoria_atendimento_id`;
  const filtro = `
     WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.situacao <> 'cancelado'
       AND ca.codigo IN (${marcas}) AND a.entrada_em >= ? AND a.entrada_em < ?
       ${r.unidade ? 'AND a.unidade_assistencial_id = ?' : ''}`;
  const p = (de: Date): unknown[] => [
    r.estabelecimento,
    ...TIPOS_DOS_INDICADORES,
    de,
    r.ate,
    ...(r.unidade ? [r.unidade] : []),
  ];

  const grupos = await l.consultar(
    `SELECT ca.codigo AS tipo, ca.laboratorio AS lab, (a.especialidade_medica_id IS NULL) AS sem_especialidade,
            ct.codigo_tiss AS carater, COUNT(*) AS n
       ${base}
       LEFT JOIN carater_atendimento_tiss ct ON ct.id = a.carater_atendimento_tiss_id
       ${filtro}
      GROUP BY ca.codigo, ca.laboratorio, (a.especialidade_medica_id IS NULL), ct.codigo_tiss`,
    p(r.de),
    { teto: 5000 },
  );
  const desfechos = await l.consultar(
    `SELECT a.desfecho, ca.codigo AS tipo, COUNT(*) AS n ${base} ${filtro} AND a.desfecho IS NOT NULL
      GROUP BY a.desfecho, ca.codigo`,
    p(r.de),
    { teto: 5000 },
  );
  const etapas = await l.consultar(
    `SELECT a.numero, e.etapa, MIN(e.ocorrida_em) AS em
       ${base}
       JOIN atendimento_etapa_pa e ON e.atendimento_id = a.id AND e.excluido_em IS NULL
       ${filtro} AND ca.codigo = 'pa' AND e.etapa IN (${ETAPAS_DO_TEMPO.map(() => '?').join(', ')})
      GROUP BY a.id, a.numero, e.etapa`,
    [...p(r.de), ...ETAPAS_DO_TEMPO.map((e) => ETAPA_NO_BANCO[e])],
    { teto: TETO },
  );
  const ocupacoes = await l.consultar(
    `SELECT a.numero, o.data_hora_entrada AS entrada, o.data_hora_saida AS saida, o.destino
       ${base}
       JOIN ocupacao_leito_observacao o ON o.atendimento_id = a.id AND o.excluido_em IS NULL
       ${filtro}`,
    p(r.de),
    { teto: TETO },
  );
  const visitas = await l.consultar(
    `SELECT a.paciente_id AS paciente, a.entrada_em AS entrada ${base} ${filtro} AND ca.codigo = 'pa'`,
    p(r.deVisitas),
    { teto: TETO },
  );
  const internacoes = await l.consultar(
    `SELECT x.pelo_desfecho, x.pelo_encaminhamento, COUNT(*) AS n
       FROM (SELECT (a.desfecho <=> 'internacao') AS pelo_desfecho,
                    EXISTS (SELECT 1 FROM atendimento f JOIN internacao i ON i.atendimento_id = f.id
                             WHERE f.pai_atendimento_id = a.id AND f.excluido_em IS NULL
                               AND i.excluido_em IS NULL) AS pelo_encaminhamento
               ${base} ${filtro} AND ca.codigo = 'pa') x
      GROUP BY x.pelo_desfecho, x.pelo_encaminhamento`,
    p(r.de),
    { teto: 10 },
  );

  const porTipo = gruposDosIndicadores(
    grupos.map((g) => ({
      tipo: String(g['tipo']),
      laboratorio: sim(g['lab']),
      semEspecialidade: sim(g['sem_especialidade']),
      caraterTiss: g['carater'] === null || g['carater'] === undefined ? null : String(g['carater']),
      total: Number(g['n']),
    })),
  );
  const iso = (v: unknown): string | null => instante(v)?.toISOString() ?? null;
  return {
    porTipo,
    desfechos: desfechos.map((d) => ({
      desfecho: String(d['desfecho']),
      tipoAte: tipoAteDoTipo(String(d['tipo'])),
      total: Number(d['n']),
    })),
    marcasPa: etapas.flatMap((e) => {
      const em = iso(e['em']);
      const etapa = ETAPA_DO_BANCO[String(e['etapa'])];
      return em && etapa ? [{ cabecalho: String(e['numero']), etapa, em }] : [];
    }),
    observacoes: observacoesDosIndicadores(
      ocupacoes.flatMap((o) => {
        const entrada = iso(o['entrada']);
        return entrada
          ? [
              {
                cabecalho: String(o['numero']),
                entrada,
                saida: iso(o['saida']),
                trocaDeLeito: o['destino'] === 'outro_leito',
              },
            ]
          : [];
      }),
      r.agora.toISOString(),
    ),
    paTotal: grupos.filter((g) => g['tipo'] === 'pa').reduce((t, g) => t + Number(g['n']), 0),
    visitasPa: visitas.flatMap((v) => {
      const d = instante(v['entrada']);
      if (!d) return [];
      const c = r.civil(d);
      return [{ paciente: String(v['paciente']), data: c.slice(0, 10), hora: c.slice(11, 16) }];
    }),
    internacoesPa: internacoesDoPa(
      internacoes.map((i) => ({
        peloDesfecho: sim(i['pelo_desfecho']),
        peloEncaminhamento: sim(i['pelo_encaminhamento']),
        total: Number(i['n']),
      })),
    ),
  };
}

/** O dia seguinte (AAAA-MM-DD) de um dia civil, e o dia de N dias antes. */
export function diaDeslocado(data: string, dias: number): string {
  return new Date(Date.parse(`${data}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}
