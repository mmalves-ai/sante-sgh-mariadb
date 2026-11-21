// Porta do painel de indicadores de pessoas sobre o banco do cliente (MariaDB, pelo @sgh/nucleo): só leitura. Cada
// fonte (cadastro, ponto, folha, treinamento, SESMT, censo, dimensionamento) é lida na sua própria transação curta
// somente leitura; a que falha vem vazia e entra em `indisponiveis` com o motivo, sem derrubar as outras. Nada se grava
// (a leitura do painel é registrada pelo controlador). Toda leitura filtra o estabelecimento da sessão (por id) e os
// registros excluídos. O apoio (lotações, nomes dos setores e fuso) é lido uma vez, numa transação própria; se ele
// falhar, as fontes que dependem da lotação ficam indisponíveis com o motivo (nunca distribuídas pela lotação errada).
// Tabelas: vinculo_trabalho, lotacao, setor_funcional, cargo, conselho_classe, fechamento_ponto, apuracao_ponto,
// apuracao_ponto_item, tipo_hora, calculo_folha, calculo_folha_item, competencia_folha, rubrica, turma_treinamento,
// presenca_treinamento, comunicacao_acidente, fechamento_censo, unidade_internacao, dimensionamento_enfermagem e
// estabelecimento (fuso).
// Setor do fato (decisão do lote 03-08): o fato do vínculo vai ao setor da LOTAÇÃO VIGENTE NA DATA DO FATO (tabela
//   lotacao, última operação de cada lotação, sem as excluídas): ponto e folha na competência (dia 1º), treinamento na
//   data de fim da turma, acidente na data local do acidente, cadastro no fim do período ou no desligamento, se antes.
//   Horas e valores são rateados pelo percentual das lotações simultâneas; contagens (vínculo, acidente) vão inteiras à
//   lotação principal. Vínculo sem lotação vigente na data cai no setor do cadastro do vínculo (setor_funcional_id).
// Melhoria: ausência do ponto = débitos (atrasos) e faltas, abonadas ou não, somados dos itens da apuração diária dos
//   dias do fechamento (natureza do tipo de hora e destino, lista branca no domínio: apropriacao-indicadores.ts);
//   previstas = Σ minutos previstos da apuração. Fechamento sem apuração diária: previstas = trabalhadas − extras +
//   faltas e ausência = faltas (estimativa pelas horas consolidadas).
// Melhoria: a equipe de enfermagem é a do cargo ligado ao conselho de enfermagem (conselho_classe), não uma marca no
//   vínculo; a hora extra da folha é a rubrica com o adicional `hora_extra`, só proventos de cálculo não cancelado.
// Melhoria: o treinamento soma os minutos cumpridos por presença (a carga da turma quando a presença não registrou
//   minutos), no vínculo do participante ativo na data de fim da turma e na lotação dele nessa data; o acidente conta
//   só a comunicação inicial emitida, no período civil do fuso do estabelecimento (acidente_em é gravado em UTC).
// Melhoria: o censo soma só o fechamento diário fechado; o dimensionamento é o último não cancelado até o fim do
//   período (por setor, direto ou pela unidade de internação); "hoje" é a data no fuso do estabelecimento.
// Melhoria: leitura que passaria do teto vira fonte indisponível com o motivo (nunca um painel truncado em silêncio).
import type { CategoriaScp, FonteIndicadorPessoas } from '@sgh/contratos';
import { type Leitor, type NucleoProprio, recusa } from '@sgh/nucleo';
import type {
  BaseLidaIndicadores,
  ContextoIndicadores,
  PortaIndicadoresPessoas,
  RecorteIndicadores,
} from './porta-indicadores.js';
import {
  contaComoAusencia,
  dataNoFuso,
  horasDoFechamento,
  type IndiceLotacoes,
  indexarLotacoes,
  inicioDoDiaNoFuso,
  setoresNaData,
  setorPrincipalNaData,
  somarPorSetor,
} from './apropriacao-indicadores.js';

export { dataNoFuso } from './apropriacao-indicadores.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoIndicadores = Pick<NucleoProprio, 'lerSomente'>;

type Linha = Record<string, unknown>;
/** Sigla do conselho profissional da enfermagem (catálogo oficial conselho_classe). */
export const CONSELHO_ENFERMAGEM = 'COREN';
/** Rótulo da linha sem lotação (vínculo sem setor). */
export const SEM_LOTACAO = 'Sem lotação';
/** Teto de vínculos lidos por recorte (acima dele a fonte do cadastro fica indisponível, com o motivo). */
export const TETO_VINCULOS_INDICADORES = 100_000;
const TETO_AGRUPADO = 10_000;
export const ORDEM_FONTES: readonly FonteIndicadorPessoas[] = [
  'cadastro',
  'ponto',
  'folha',
  'treinamento',
  'sesmt',
  'censo',
  'dimensionamento',
];

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const setorDe = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const nomeDe = (v: unknown): string => (v === null || v === undefined || v === '' ? SEM_LOTACAO : String(v));
/** DATE do banco (Date à meia-noite UTC ou texto) → "AAAA-MM-DD". */
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
const arred = (n: number, casas = 4) => Math.round(n * 10 ** casas) / 10 ** casas;

/** Dia seguinte de uma data ISO (limite aberto das leituras por instante). */
export function diaSeguinte(data: string): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const motivoDe = (e: unknown): string =>
  `Não foi possível ler esta fonte agora (${e instanceof Error ? e.message : String(e)}).`.slice(0, 300);

// ── SQL (parametrizado; nomes literais) ───────────────────────────────────────────────────────────────────────────

const SITUACOES_PONTO = "('fechado', 'assinado', 'integrado_folha')";

export const SQL_INDICADORES = {
  // Última operação de cada lotação (a tabela guarda o histórico das operações); a excluída sai.
  lotacoes: `SELECT x.vinculo, x.setor, x.inicio, x.fim, x.percentual
    FROM (SELECT l.vinculo_trabalho_id AS vinculo, l.setor_funcional_id AS setor, l.data_inicio AS inicio,
                 l.data_fim AS fim, l.percentual_rateio AS percentual, l.operacao,
                 ROW_NUMBER() OVER (PARTITION BY l.vinculo_trabalho_id, l.setor_funcional_id, l.centro_custo_id,
                                                 l.data_inicio
                                    ORDER BY l.ocorrido_em DESC, l.id DESC) AS ordem
            FROM lotacao l
            JOIN vinculo_trabalho v ON v.id = l.vinculo_trabalho_id
           WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL) x
   WHERE x.ordem = 1 AND x.operacao <> 'exclusao'`,
  nomesSetores: `SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL`,
  vinculos: `SELECT v.id AS vinculo, v.setor_funcional_id AS setor_atual,
         v.data_admissao AS admissao, v.data_desligamento AS desligamento
    FROM vinculo_trabalho v
   WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL AND v.data_admissao <= ?
   ORDER BY v.id`,
  ponto: `SELECT f.id AS fechamento, f.vinculo_trabalho_id AS vinculo, v.setor_funcional_id AS setor_atual,
         f.competencia AS data, f.horas_trabalhadas AS trabalhadas, f.horas_extras AS extras,
         f.horas_falta AS faltas, CASE WHEN cc.sigla = ? THEN 1 ELSE 0 END AS enfermagem,
         COALESCE(ap.dias, 0) AS dias_apurados, COALESCE(ap.minutos_previstos, 0) AS minutos_previstos
    FROM fechamento_ponto f
    JOIN vinculo_trabalho v ON v.id = f.vinculo_trabalho_id
    LEFT JOIN cargo cg ON cg.id = v.cargo_id
    LEFT JOIN conselho_classe cc ON cc.id = cg.conselho_classe_id
    LEFT JOIN (SELECT a.fechamento_ponto_id, COUNT(*) AS dias, SUM(a.minutos_previstos) AS minutos_previstos
                 FROM apuracao_ponto a
                 JOIN fechamento_ponto f2 ON f2.id = a.fechamento_ponto_id
                WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL
                  AND f2.estabelecimento_id = ? AND f2.competencia BETWEEN ? AND ?
                GROUP BY a.fechamento_ponto_id) ap ON ap.fechamento_ponto_id = f.id
   WHERE f.estabelecimento_id = ? AND f.excluido_em IS NULL AND f.situacao IN ${SITUACOES_PONTO}
     AND f.competencia BETWEEN ? AND ?`,
  // tipo_hora é catálogo da rede inteira (sem estabelecimento).
  ausencias: `SELECT a.fechamento_ponto_id AS fechamento, th.natureza, i.destino, SUM(i.minutos) AS minutos
    FROM apuracao_ponto_item i
    JOIN apuracao_ponto a ON a.id = i.apuracao_ponto_id
    JOIN fechamento_ponto f ON f.id = a.fechamento_ponto_id
    JOIN tipo_hora th ON th.id = i.tipo_hora_id
   WHERE f.estabelecimento_id = ? AND f.excluido_em IS NULL AND f.situacao IN ${SITUACOES_PONTO}
     AND f.competencia BETWEEN ? AND ?
     AND a.estabelecimento_id = ? AND a.excluido_em IS NULL AND i.excluido_em IS NULL
   GROUP BY a.fechamento_ponto_id, th.natureza, i.destino`,
  folha: `SELECT c.id AS calculo, c.vinculo_trabalho_id AS vinculo, MAX(v.setor_funcional_id) AS setor_atual,
         MAX(k.ano) AS ano, MAX(k.mes) AS mes, SUM(i.valor) AS valor
    FROM calculo_folha_item i
    JOIN calculo_folha c ON c.id = i.calculo_folha_id
    JOIN competencia_folha k ON k.id = c.competencia_folha_id
    JOIN rubrica r ON r.id = i.rubrica_id
    JOIN vinculo_trabalho v ON v.id = c.vinculo_trabalho_id
   WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND i.excluido_em IS NULL AND k.excluido_em IS NULL
     AND c.situacao <> 'cancelado' AND k.situacao <> 'cancelada'
     AND i.natureza = 'provento' AND r.adicional = 'hora_extra'
     AND (k.ano * 100 + k.mes) BETWEEN ? AND ?
   GROUP BY c.id, c.vinculo_trabalho_id`,
  // O vínculo do participante: o ativo na data de fim da turma; na falta, o último admitido até ela.
  treinamento: `SELECT x.vinculo, MAX(v.setor_funcional_id) AS setor_atual, x.data, SUM(x.minutos) AS minutos
    FROM (SELECT (SELECT v.id FROM vinculo_trabalho v
                   WHERE v.colaborador_id = p.colaborador_id AND v.estabelecimento_id = t.estabelecimento_id
                     AND v.excluido_em IS NULL AND v.data_admissao <= t.data_fim
                   ORDER BY (v.data_desligamento IS NULL OR v.data_desligamento >= t.data_fim) DESC,
                            v.data_admissao DESC, v.id DESC
                   LIMIT 1) AS vinculo,
                 t.data_fim AS data,
                 CASE WHEN p.minutos_cumpridos > 0 THEN p.minutos_cumpridos ELSE t.carga_horaria_minutos END AS minutos
            FROM presenca_treinamento p
            JOIN turma_treinamento t ON t.id = p.turma_treinamento_id
           WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND p.excluido_em IS NULL
             AND t.situacao = 'concluida' AND p.situacao = 'presente' AND t.data_fim BETWEEN ? AND ?) x
    LEFT JOIN vinculo_trabalho v ON v.id = x.vinculo
   GROUP BY x.vinculo, x.data`,
  // acidente_em em UTC: os limites chegam já convertidos do período civil no fuso do estabelecimento.
  acidentes: `SELECT a.vinculo_trabalho_id AS vinculo, v.setor_funcional_id AS setor_atual, a.acidente_em AS em,
         a.houve_afastamento AS afastou
    FROM comunicacao_acidente a
    LEFT JOIN vinculo_trabalho v ON v.id = a.vinculo_trabalho_id
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.tipo = 'inicial'
     AND a.situacao NOT IN ('rascunho', 'cancelada')
     AND a.acidente_em >= ? AND a.acidente_em < ?`,
  censo: `SELECT u.setor_funcional_id AS setor, MAX(s.nome) AS nome_setor, SUM(f.pacientes_dia) AS pacientes_dia
    FROM fechamento_censo f
    JOIN unidade_internacao u ON u.id = f.unidade_internacao_id
    LEFT JOIN setor_funcional s ON s.id = u.setor_funcional_id
   WHERE f.estabelecimento_id = ? AND f.excluido_em IS NULL AND f.situacao = 'fechado'
     AND f.data_referencia BETWEEN ? AND ?
     AND (? IS NULL OR u.setor_funcional_id = ?)
   GROUP BY u.setor_funcional_id`,
  dimensionamento: `SELECT x.setor, x.nome_setor, x.minimos, x.intermediarios, x.alta_dependencia, x.semi_intensivos,
         x.intensivos
    FROM (SELECT COALESCE(d.setor_funcional_id, u.setor_funcional_id) AS setor, s.nome AS nome_setor,
                 d.pacientes_cuidado_minimo AS minimos, d.pacientes_cuidado_intermediario AS intermediarios,
                 d.pacientes_alta_dependencia AS alta_dependencia, d.pacientes_semi_intensivo AS semi_intensivos,
                 d.pacientes_intensivo AS intensivos,
                 ROW_NUMBER() OVER (PARTITION BY COALESCE(d.setor_funcional_id, u.setor_funcional_id)
                                    ORDER BY d.data_referencia DESC, d.id DESC) AS ordem
            FROM dimensionamento_enfermagem d
            LEFT JOIN unidade_internacao u ON u.id = d.unidade_internacao_id
            LEFT JOIN setor_funcional s ON s.id = COALESCE(d.setor_funcional_id, u.setor_funcional_id)
           WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL AND d.situacao <> 'cancelado'
             AND d.data_referencia <= ?) x
   WHERE x.ordem = 1 AND (? IS NULL OR x.setor = ?)`,
  setores: `SELECT id, nome FROM setor_funcional
   WHERE estabelecimento_id = ? AND excluido_em IS NULL AND ativo
   ORDER BY nome, id`,
  fuso: 'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
} as const;

const competenciaNumero = (data: string) => Number(data.slice(0, 4)) * 100 + Number(data.slice(5, 7));
const inicioDoMes = (data: string) => `${data.slice(0, 7)}-01`;
const competenciaData = (ano: unknown, mes: unknown) =>
  `${Number(ano)}-${String(Number(mes)).padStart(2, '0')}-01`;
/** DATETIME do banco (Date em UTC, ou texto "AAAA-MM-DD hh:mm:ss" em UTC) → instante. */
const instante = (v: unknown): Date =>
  v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T').slice(0, 23)}Z`);

type SemHospital<T> = Omit<T, 'hospital'>;
type Base = BaseLidaIndicadores['base'];
type Item<K extends keyof Base> = Base[K] extends readonly (infer X)[] ? SemHospital<X> : never;

/** O apoio das fontes por vínculo: as lotações vigentes indexadas, os nomes dos setores e o fuso. */
interface Apoio {
  readonly lotacoes: IndiceLotacoes;
  readonly nomes: ReadonlyMap<number, string>;
  readonly fuso: string | null;
}

/** Lê cada fonte do recorte isolada: a que falha vem vazia e com o motivo, na ordem das fontes. */
export async function lerBaseIndicadores(
  ler: <T>(fn: (l: Leitor) => Promise<T>) => Promise<T>,
  estabelecimento: number,
  hospital: string,
  r: RecorteIndicadores,
): Promise<BaseLidaIndicadores> {
  const indisponiveis: { fonte: FonteIndicadorPessoas; motivo: string }[] = [];
  const fonte = async <T>(nome: FonteIndicadorPessoas, fn: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await fn();
    } catch (e) {
      indisponiveis.push({ fonte: nome, motivo: motivoDe(e) });
      return [];
    }
  };
  const est = estabelecimento;
  const st = [r.setor, r.setor];
  const agrupado = { teto: TETO_AGRUPADO };
  const porFato = { teto: TETO_VINCULOS_INDICADORES };
  // Uma leitura do apoio, compartilhada; a falha vai para cada fonte que depende dela (com o motivo).
  const apoioP: Promise<{ ok: Apoio } | { erro: unknown }> = ler(async (l) => {
    const lot = await l.consultar(SQL_INDICADORES.lotacoes, [est], porFato);
    const nomes = await l.consultar(SQL_INDICADORES.nomesSetores, [est], porFato);
    const f = await l.uma<{ fuso_horario: string | null }>(SQL_INDICADORES.fuso, [est]);
    return {
      lotacoes: indexarLotacoes(
        lot.map((x: Linha) => ({
          vinculo: Number(x['vinculo']),
          setor: Number(x['setor']),
          inicio: dataIso(x['inicio']) ?? '',
          fim: dataIso(x['fim']),
          percentual: num(x['percentual']),
        })),
      ),
      nomes: new Map(nomes.map((x: Linha) => [Number(x['id']), String(x['nome'])])),
      fuso: f?.fuso_horario ?? null,
    };
  }).then(
    (ok) => ({ ok }),
    (erro: unknown) => ({ erro }),
  );
  const apoio = async (): Promise<Apoio> => {
    const a = await apoioP;
    if ('erro' in a) throw a.erro;
    return a.ok;
  };
  const nomeSetor = (a: Apoio, s: number | null) =>
    s === null ? SEM_LOTACAO : (a.nomes.get(s) ?? `Setor ${s}`);
  /** Soma por setor (rateio pela lotação na data) e devolve as linhas do setor pedido. */
  const porSetor = <K extends string>(
    a: Apoio,
    fatos: readonly {
      vinculo: number | null;
      data: string;
      setorAtual: number | null;
      valores: Record<K, number>;
    }[],
    chaves: readonly K[],
  ) =>
    [
      ...somarPorSetor(
        fatos.map((f) => ({
          setores: setoresNaData(a.lotacoes, f.vinculo, f.data, f.setorAtual),
          valores: f.valores,
        })),
        chaves,
        r.setor,
      ),
    ].map(([setor, v]) => ({ setor, nomeSetor: nomeSetor(a, setor), v }));
  const vinculoDe = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  const [vinculos, ponto, folha, treinamento, acidentes, censo, dimensionamento] = await Promise.all([
    fonte('cadastro', async (): Promise<Item<'vinculos'>[]> => {
      const a = await apoio();
      const ls = await ler((l) => l.consultar(SQL_INDICADORES.vinculos, [est, r.fim], porFato));
      const saida: Item<'vinculos'>[] = [];
      for (const x of ls) {
        const desligamento = dataIso(x['desligamento']);
        const data = desligamento !== null && desligamento < r.fim ? desligamento : r.fim;
        const setor = setorPrincipalNaData(a.lotacoes, Number(x['vinculo']), data, setorDe(x['setor_atual']));
        if (r.setor !== null && setor !== r.setor) continue;
        saida.push({
          setor,
          nomeSetor: nomeSetor(a, setor),
          admissao: dataIso(x['admissao']) ?? '',
          desligamento,
        });
      }
      return saida;
    }),
    fonte('ponto', async (): Promise<Item<'ponto'>[]> => {
      const a = await apoio();
      const de = inicioDoMes(r.inicio);
      const [fechamentos, itens] = await ler(
        async (l) =>
          [
            await l.consultar(
              SQL_INDICADORES.ponto,
              [CONSELHO_ENFERMAGEM, est, est, de, r.fim, est, de, r.fim],
              porFato,
            ),
            await l.consultar(SQL_INDICADORES.ausencias, [est, de, r.fim, est], porFato),
          ] as const,
      );
      const ausencia = new Map<number, number>();
      for (const i of itens)
        if (contaComoAusencia(String(i['natureza']), String(i['destino'])))
          ausencia.set(
            Number(i['fechamento']),
            (ausencia.get(Number(i['fechamento'])) ?? 0) + num(i['minutos']),
          );
      const fatos = fechamentos.map((x: Linha) => {
        const h = horasDoFechamento({
          horasTrabalhadas: num(x['trabalhadas']),
          horasExtras: num(x['extras']),
          horasFalta: num(x['faltas']),
          diasApurados: num(x['dias_apurados']),
          minutosPrevistos: num(x['minutos_previstos']),
          minutosAusencia: ausencia.get(Number(x['fechamento'])) ?? 0,
        });
        return {
          vinculo: vinculoDe(x['vinculo']),
          data: dataIso(x['data']) ?? de,
          setorAtual: setorDe(x['setor_atual']),
          valores: {
            previstas: h.previstas,
            trabalhadas: h.trabalhadas,
            ausencia: h.ausencia,
            extras: h.extras,
            enfermagem: num(x['enfermagem']) ? h.trabalhadas : 0,
          },
        };
      });
      return porSetor(a, fatos, [
        'previstas',
        'trabalhadas',
        'ausencia',
        'extras',
        'enfermagem',
      ] as const).map(({ setor, nomeSetor: n, v }) => ({
        setor,
        nomeSetor: n,
        horasPrevistas: arred(v.previstas),
        horasTrabalhadas: arred(v.trabalhadas),
        horasAusencia: arred(v.ausencia),
        horasExtras: arred(v.extras),
        horasEnfermagem: arred(v.enfermagem),
      }));
    }),
    fonte('folha', async (): Promise<Item<'folhaHorasExtras'>[]> => {
      const a = await apoio();
      const ls = await ler((l) =>
        l.consultar(
          SQL_INDICADORES.folha,
          [est, competenciaNumero(r.inicio), competenciaNumero(r.fim)],
          porFato,
        ),
      );
      const fatos = ls.map((x: Linha) => ({
        vinculo: vinculoDe(x['vinculo']),
        data: competenciaData(x['ano'], x['mes']),
        setorAtual: setorDe(x['setor_atual']),
        valores: { valor: num(x['valor']) },
      }));
      return porSetor(a, fatos, ['valor'] as const).map(({ setor, nomeSetor: n, v }) => ({
        setor,
        nomeSetor: n,
        valorCent: Math.round(v.valor * 100),
      }));
    }),
    fonte('treinamento', async (): Promise<Item<'treinamento'>[]> => {
      const a = await apoio();
      const ls = await ler((l) => l.consultar(SQL_INDICADORES.treinamento, [est, r.inicio, r.fim], porFato));
      const fatos = ls.map((x: Linha) => ({
        vinculo: vinculoDe(x['vinculo']),
        data: dataIso(x['data']) ?? r.fim,
        setorAtual: setorDe(x['setor_atual']),
        valores: { minutos: num(x['minutos']) },
      }));
      return porSetor(a, fatos, ['minutos'] as const).map(({ setor, nomeSetor: n, v }) => ({
        setor,
        nomeSetor: n,
        horas: arred(v.minutos / 60),
      }));
    }),
    fonte('sesmt', async (): Promise<Item<'acidentes'>[]> => {
      const a = await apoio();
      const de = inicioDoDiaNoFuso(r.inicio, a.fuso);
      const ate = inicioDoDiaNoFuso(diaSeguinte(r.fim), a.fuso);
      const ls = await ler((l) => l.consultar(SQL_INDICADORES.acidentes, [est, de, ate], porFato));
      const m = new Map<number | null, { quantidade: number; comAfastamento: number }>();
      for (const x of ls) {
        const data = dataNoFuso(instante(x['em']), a.fuso);
        const setor = setorPrincipalNaData(
          a.lotacoes,
          vinculoDe(x['vinculo']),
          data,
          setorDe(x['setor_atual']),
        );
        if (r.setor !== null && setor !== r.setor) continue;
        const t = m.get(setor) ?? { quantidade: 0, comAfastamento: 0 };
        t.quantidade += 1;
        if (num(x['afastou'])) t.comAfastamento += 1;
        m.set(setor, t);
      }
      return [...m].map(([setor, t]) => ({ setor, nomeSetor: nomeSetor(a, setor), ...t }));
    }),
    fonte('censo', async (): Promise<Item<'censo'>[]> =>
      (await ler((l) => l.consultar(SQL_INDICADORES.censo, [est, r.inicio, r.fim, ...st], agrupado))).map(
        (x) => ({
          setor: setorDe(x['setor']),
          nomeSetor: nomeDe(x['nome_setor']),
          pacientesDia: num(x['pacientes_dia']),
        }),
      ),
    ),
    fonte('dimensionamento', async (): Promise<Item<'dimensionamento'>[]> =>
      (await ler((l) => l.consultar(SQL_INDICADORES.dimensionamento, [est, r.fim, ...st], agrupado))).map(
        (x) => {
          const pacientes: Record<CategoriaScp, number> = {
            minimos: num(x['minimos']),
            intermediarios: num(x['intermediarios']),
            altaDependencia: num(x['alta_dependencia']),
            semiIntensivos: num(x['semi_intensivos']),
            intensivos: num(x['intensivos']),
          };
          return { setor: setorDe(x['setor']), nomeSetor: nomeDe(x['nome_setor']), pacientes };
        },
      ),
    ),
  ]);
  const h = { hospital };
  const ordem = new Map(ORDEM_FONTES.map((f, i) => [f, i]));
  return {
    base: {
      inicio: r.inicio,
      fim: r.fim,
      vinculos: vinculos.map((x) => ({ ...h, ...x })),
      ponto: ponto.map((x) => ({ ...h, ...x })),
      folhaHorasExtras: folha.map((x) => ({ ...h, ...x })),
      treinamento: treinamento.map((x) => ({ ...h, ...x })),
      acidentes: acidentes.map((x) => ({ ...h, ...x })),
      censo: censo.map((x) => ({ ...h, ...x })),
      dimensionamento: dimensionamento.map((x) => ({ ...h, ...x })),
    },
    indisponiveis: indisponiveis.sort((a, b) => (ordem.get(a.fonte) ?? 0) - (ordem.get(b.fonte) ?? 0)),
  };
}

export class PortaIndicadoresPessoasPropria implements PortaIndicadoresPessoas {
  readonly destino = 'banco' as const;

  constructor(
    private readonly nucleo: NucleoIndicadores,
    private readonly relogio: () => Date = () => new Date(),
  ) {}

  private estabelecimento(c: ContextoIndicadores): number {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return c.estabelecimento;
  }

  private ler<T>(c: ContextoIndicadores, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      {
        cliente: c.cliente,
        estabelecimento: c.estabelecimento,
        usuario: c.usuario,
        correlacao: c.correlacao.slice(0, 64),
      },
      fn,
    );
  }

  async hoje(c: ContextoIndicadores): Promise<string> {
    const est = this.estabelecimento(c);
    const r = await this.ler(c, (l) => l.uma<{ fuso_horario: string | null }>(SQL_INDICADORES.fuso, [est]));
    return dataNoFuso(this.relogio(), r?.fuso_horario ?? null);
  }

  async setores(c: ContextoIndicadores): Promise<{ codigo: number; rotulo: string }[]> {
    const est = this.estabelecimento(c);
    const ls = await this.ler(c, (l) => l.consultar(SQL_INDICADORES.setores, [est], { teto: TETO_AGRUPADO }));
    return ls.map((x: Linha) => ({ codigo: Number(x['id']), rotulo: String(x['nome']) }));
  }

  async base(c: ContextoIndicadores, r: RecorteIndicadores): Promise<BaseLidaIndicadores> {
    const est = this.estabelecimento(c);
    return lerBaseIndicadores((fn) => this.ler(c, fn), est, c.hospital, r);
  }
}
