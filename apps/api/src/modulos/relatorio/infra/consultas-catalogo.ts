// As consultas do catálogo de relatórios sobre o banco do cliente (M34; ficha, regras 1, 3 e 6; F2.2 lote 04-04).
// SQL LIVRE NÃO ENTRA: cada consulta está aqui, revisada em PR; cada variação (filtro de convênio, de local, régua,
// tipo de conta) é uma variante inteira, fixada na carga do módulo (só constantes, nunca entrada do usuário); os valores
// vão só como parâmetro (`?`) e o estabelecimento da sessão é sempre o primeiro (quando a consulta precisa dele de novo,
// ou do deslocamento do fuso, vem numa tabela derivada de parâmetros `q`, ou repetido depois, pelo contexto).
// O executor confere de novo antes de rodar (SELECT só, sem comentário, sem ponto e vírgula, `?` na conta certa) e roda
// na transação só de leitura do núcleo, com teto de linhas e tempo; acima deles, a mensagem sai em português.
// Fuso: o banco guarda DATETIME em UTC (ADR 0002). Os limites do dia vão ao banco convertidos do dia local para UTC; o
// agrupamento por dia usa CONVERT_TZ com o deslocamento do fuso; a hora mostrada volta ao fuso do estabelecimento.
// Melhoria: o nome do convênio, do motivo, do centro de custo, do item e do local vêm junto (sem a segunda consulta de
// nomes); a internação conta pela data e hora de entrada e de alta reais, sem cancelada; o atendimento, a conta, a
// cirurgia, o exame, a prescrição e o item cancelados ou estornados não contam; a glosa é a glosa registrada no item
// (não a diferença entre cobrado e pago, que confundia pagamento parcial com glosa); as vagas da escala multiplicam as
// vagas por horário; o prontuário devolvido (data de devolução) sai da lista de emprestados.
import { ErroTempoEsgotado, ErroTetoLinhas, type Leitor } from '@sgh/nucleo';
import { ErroRelatorio, type LinhaRelatorio, type ValoresDoRelatorio } from '../tipos.js';
import { deslocamentoTexto, inicioDoDiaEmUtc, textoNoFuso } from './fuso.js';

type Linha = Record<string, unknown>;

/** O contexto da execução: o estabelecimento da sessão, o dia local e o fuso dele. */
export interface ContextoConsulta {
  readonly estabelecimento: number;
  readonly hoje: string;
  readonly fuso: string;
}

export interface ConsultaPropria {
  readonly codigo: string;
  /** As variantes, cada uma um SQL inteiro e literal (sem montagem com entrada do usuário). */
  readonly sql: Readonly<Record<string, string>>;
  readonly variante: (v: ValoresDoRelatorio) => string;
  /** Os parâmetros (`?`) depois do estabelecimento, na ordem do SQL da variante. */
  readonly parametros: (v: ValoresDoRelatorio, variante: string, x: ContextoConsulta) => readonly unknown[];
  readonly mapear: (linhas: readonly Linha[], v: ValoresDoRelatorio, x: ContextoConsulta) => LinhaRelatorio[];
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const numN = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) =>
  v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim();
const centavos = (v: unknown) => Math.round(num(v) * 100) / 100;
const milesimos = (v: unknown) => Math.round(num(v) * 1000) / 1000;
const porMil = (parte: number, total: number) => (total ? Math.round((parte / total) * 1000) / 10 : 0);
const somaDias = (d: string, k: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
const diaSeguinte = (d: string) => somaDias(d, 1);
/** Mês AAAA-MM → o primeiro dia; o fim é exclusivo (o primeiro dia do mês seguinte). */
const mesIni = (m: unknown) => `${String(m)}-01`;
const mesFimExcl = (m: unknown) => {
  const [a, b] = String(m).split('-').map(Number) as [number, number];
  return b === 12 ? `${a + 1}-01-01` : `${a}-${String(b + 1).padStart(2, '0')}-01`;
};
/** Mês AAAA-MM → competência do SUS (AAAAMM). */
const competenciaSus = (m: unknown) => String(m).replace('-', '');
const inteiroOuNulo = (v: ValoresDoRelatorio, campo: string) =>
  v[campo] === undefined || v[campo] === '' ? null : Number(v[campo]);
const conv = (v: ValoresDoRelatorio) => inteiroOuNulo(v, 'convenio');
const ISO = (c: string) => `DATE_FORMAT(${c}, '%Y-%m-%dT%H:%i:%s')`;
/** Limites do período em UTC: [início do dia local, início do dia local seguinte ao fim). */
const periodoUtc = (v: ValoresDoRelatorio, x: ContextoConsulta) => [
  inicioDoDiaEmUtc(String(v['inicio']), x.fuso),
  inicioDoDiaEmUtc(diaSeguinte(String(v['fim'])), x.fuso),
];
const mesesUtc = (v: ValoresDoRelatorio, x: ContextoConsulta) => [
  inicioDoDiaEmUtc(mesIni(v['mesInicio']), x.fuso),
  inicioDoDiaEmUtc(mesFimExcl(v['mesFim']), x.fuso),
];
/** O deslocamento do fuso no início do período (o Brasil não tem horário de verão desde 2019). */
const desloc = (v: ValoresDoRelatorio, x: ContextoConsulta) =>
  deslocamentoTexto(x.fuso, new Date(`${String(v['inicio'] ?? x.hoje)}T12:00:00Z`));
const horaLocal = (v: unknown, x: ContextoConsulta) => textoNoFuso(v, x.fuso)?.slice(11, 16) ?? null;
const duracao = (min: unknown) => {
  const m = numN(min);
  if (m === null || m < 0) return null;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
/** Duas variantes: sem e com o filtro (o filtro é um trecho constante). */
const comFiltro = (antes: string, filtro: string, depois: string) => ({
  todos: `${antes} ${depois}`,
  filtro: `${antes} ${filtro} ${depois}`,
});

/** Internação = há internação ligada ao atendimento; externo = os demais (ambulatório, pronto-socorro, exames). */
const TIPO_ATENDIMENTO = `CASE WHEN EXISTS (SELECT 1 FROM internacao i WHERE i.atendimento_id = a.id
  AND i.excluido_em IS NULL AND i.data_hora_cancelamento IS NULL) THEN 'I' ELSE 'E' END`;

const SQL_POR_CONVENIO = `SELECT a.fonte_pagadora_id AS convenio, fp.nome AS nome, ${TIPO_ATENDIMENTO} AS tipo, COUNT(*) AS n
  FROM atendimento a LEFT JOIN fonte_pagadora fp ON fp.id = a.fonte_pagadora_id
 WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.situacao <> 'cancelado'
   AND a.entrada_em >= ? AND a.entrada_em < ?`;

// ── Faturamento: a conta e os itens válidos (nem estornados nem transferidos) ────────────────────────────────
const ITENS_VALIDOS = `i.excluido_em IS NULL AND i.situacao NOT IN ('estornado', 'transferido')`;
const CONTA_COM_ITENS = `FROM conta_hospitalar c
  JOIN conta_hospitalar_item i ON i.conta_hospitalar_id = c.id AND ${ITENS_VALIDOS}
  LEFT JOIN fonte_pagadora fp ON fp.id = c.fonte_pagadora_id
 WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND c.situacao <> 'cancelada'`;
type Regua = 'competencia' | 'data-do-item';
const CORTE: Readonly<Record<Regua, string>> = {
  competencia: 'AND c.competencia >= ? AND c.competencia < ?',
  'data-do-item': 'AND i.realizado_em >= ? AND i.realizado_em < ?',
};
/** Contas: na competência, cada conta uma vez; pela data do item, a conta conta em cada mês com item. */
const CONTAS: Readonly<Record<Regua, string>> = {
  competencia: 'COUNT(DISTINCT c.id)',
  'data-do-item': "COUNT(DISTINCT c.id, DATE_FORMAT(i.realizado_em, '%Y%m'))",
};
function variantesDaRegua(colunas: (r: Regua) => string, filtro: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const regua of ['competencia', 'data-do-item'] as const) {
    const base = `SELECT c.fonte_pagadora_id AS convenio, fp.nome, ${colunas(regua)} ${CONTA_COM_ITENS} ${filtro} ${CORTE[regua]}`;
    r[regua] = `${base} GROUP BY c.fonte_pagadora_id, fp.nome`;
    r[`${regua}-convenio`] = `${base} AND c.fonte_pagadora_id = ? GROUP BY c.fonte_pagadora_id, fp.nome`;
  }
  return r;
}
const varianteDaRegua = (v: ValoresDoRelatorio) =>
  `${v['regua'] === 'data-do-item' ? 'data-do-item' : 'competencia'}${conv(v) === null ? '' : '-convenio'}`;
const parametrosDaRegua = (v: ValoresDoRelatorio, variante: string, x: ContextoConsulta) => [
  ...(variante.startsWith('data-do-item') ? mesesUtc(v, x) : [mesIni(v['mesInicio']), mesFimExcl(v['mesFim'])]),
  ...(variante.endsWith('-convenio') ? [conv(v)] : []),
];

const SITUACAO_CONTA: Readonly<Record<string, string>> = {
  aberta: 'aberta',
  em_conferencia: 'em conferência',
  em_auditoria: 'em auditoria',
  fechada: 'fechada, não faturada',
};
const SQL_CONTAS_NAO_FECHADAS = `SELECT c.id AS conta, c.natureza, DATE_FORMAT(c.competencia, '%Y-%m') AS competencia,
       c.fonte_pagadora_id AS convenio, ${ISO('a.saida_em')} AS alta, c.situacao, pf.nome
  FROM conta_hospitalar c
  JOIN atendimento a ON a.id = c.atendimento_id
  JOIN paciente p ON p.id = c.paciente_id
  JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
 WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL
   AND c.situacao IN ('aberta', 'em_conferencia', 'em_auditoria', 'fechada')
   AND a.saida_em >= ? AND a.saida_em < ?`;
const TIPO_CONTA: Readonly<Record<string, string>> = {
  todas: '',
  I: "AND c.natureza = 'internacao'",
  E: "AND c.natureza <> 'internacao'",
};
const variantesContas = (): Record<string, string> => {
  const r: Record<string, string> = {};
  for (const [tipo, filtro] of Object.entries(TIPO_CONTA)) {
    r[tipo] = `${SQL_CONTAS_NAO_FECHADAS} ${filtro} ORDER BY a.saida_em, c.id`;
    r[`${tipo}-convenio`] = `${SQL_CONTAS_NAO_FECHADAS} ${filtro} AND c.fonte_pagadora_id = ? ORDER BY a.saida_em, c.id`;
  }
  return r;
};

// ── Estoque: o consumo é o movimento de tipo que gera consumo; a saída soma, a devolução (entrada) desconta ────
const CONSUMO_QTD = "SUM(CASE WHEN t.sentido = 'saida' THEN me.quantidade_estoque ELSE -me.quantidade_estoque END)";
const CONSUMO_VALOR = "SUM(CASE WHEN t.sentido = 'saida' THEN me.valor_total ELSE -me.valor_total END)";
const CONSUMO_BASE = `FROM movimento_estoque me
  JOIN tipo_movimento_estoque t ON t.id = me.tipo_movimento_estoque_id AND t.gera_consumo AND t.sentido <> 'neutro'`;
const CONSUMO_CORTE = 'me.estabelecimento_id = ? AND me.excluido_em IS NULL AND me.competencia >= ? AND me.competencia < ?';

/**
 * Curva ABC (consumo por item): ordem decrescente de valor, percentual acumulado e a classe — A até 80% do valor,
 * B até 95%, C o resto. O item que entra na faixa leva a classe dela (o primeiro item é sempre A). Valor consumido
 * zero ou negativo (só devolução) fica fora.
 */
export function curvaAbc(
  itens: readonly { item: number; nomeItem: string | null; quantidade: number; valor: number }[],
): LinhaRelatorio[] {
  const validos = itens.filter((s) => s.valor > 0).sort((a, b) => b.valor - a.valor || a.item - b.item);
  const total = validos.reduce((a, s) => a + s.valor, 0);
  let antes = 0;
  return validos.map((s) => {
    const classe = antes / total < 0.8 ? 'A' : antes / total < 0.95 ? 'B' : 'C';
    antes += s.valor;
    return {
      classe,
      item: s.item,
      nomeItem: s.nomeItem,
      quantidade: milesimos(s.quantidade),
      valor: centavos(s.valor),
      participacao: porMil(s.valor, total),
      acumulado: porMil(antes, total),
    };
  });
}

/** Vagas do dia da escala = (minutos entre início e fim − minutos do intervalo) ÷ duração, para baixo, × vagas por horário. */
export function vagasDaEscala(e: {
  inicioMin: number;
  fimMin: number;
  intervaloMin: number;
  duracaoMin: number | null;
  vagasPorHorario: number;
}): number | null {
  if (!e.duracaoMin) return null;
  return Math.max(0, Math.floor((e.fimMin - e.inicioMin - e.intervaloMin) / e.duracaoMin)) * e.vagasPorHorario;
}

const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const GRUPO_SAIDA: Readonly<Record<string, string>> = {
  obito: 'óbito',
  transferencia: 'transferência externa',
  evasao: 'evasão ou a pedido',
  a_pedido: 'evasão ou a pedido',
  administrativa: 'encerramento administrativo',
  permanencia: 'permanência',
  alta: 'alta domiciliar',
};

const SQL_ESCALA = `SELECT s.nome AS agenda, e.dia_semana, TIME_FORMAT(e.hora_inicio, '%H:%i') AS inicio,
       TIME_FORMAT(e.hora_fim, '%H:%i') AS fim, TIME_TO_SEC(e.hora_inicio) DIV 60 AS inicio_min,
       TIME_TO_SEC(e.hora_fim) DIV 60 AS fim_min, TIME_FORMAT(e.intervalo_inicio, '%H:%i') AS intervalo_inicio,
       TIME_FORMAT(e.intervalo_fim, '%H:%i') AS intervalo_fim,
       COALESCE(TIME_TO_SEC(TIMEDIFF(e.intervalo_fim, e.intervalo_inicio)) DIV 60, 0) AS intervalo_min,
       COALESCE(e.duracao_horario_minutos, s.duracao_horario_minutos) AS duracao, e.vagas_por_horario,
       (s.ativo AND e.ativo) AS ativa
  FROM agenda_servico s JOIN agenda_escala e ON e.agenda_servico_id = s.id
 WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL
   AND e.vigencia_inicio <= ? AND (e.vigencia_fim IS NULL OR e.vigencia_fim >= ?)`;
const ORDEM_ESCALA = 'ORDER BY s.nome, s.id, e.dia_semana, e.hora_inicio';

const SQL_PRONTUARIOS = `SELECT m.volume_prontuario_id AS conta, ${ISO('m.movimentado_em')} AS saida, o.descricao AS operacao,
       COALESCE(sd.nome, la.descricao, m.responsavel_nome) AS destino,
       (SELECT COALESCE(s2.nome, l2.descricao) FROM movimento_prontuario u
          LEFT JOIN setor_funcional s2 ON s2.id = u.destino_setor_funcional_id
          LEFT JOIN local_arquivo l2 ON l2.id = u.destino_local_arquivo_id
         WHERE u.volume_prontuario_id = m.volume_prontuario_id AND u.excluido_em IS NULL
         ORDER BY u.movimentado_em DESC, u.id DESC LIMIT 1) AS local_atual
  FROM movimento_prontuario m
  JOIN operacao_movimento_prontuario o ON o.id = m.operacao_movimento_prontuario_id
  LEFT JOIN setor_funcional sd ON sd.id = m.destino_setor_funcional_id
  LEFT JOIN local_arquivo la ON la.id = m.destino_local_arquivo_id
 WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL AND m.devolvido_em IS NULL
   AND o.tipo IN ('saida', 'transferencia', 'emprestimo')
   AND m.saida_setor_funcional_id = ? AND m.movimentado_em >= ? AND m.movimentado_em < ?
   AND NOT EXISTS (SELECT 1 FROM movimento_prontuario k
         JOIN operacao_movimento_prontuario ko ON ko.id = k.operacao_movimento_prontuario_id
        WHERE k.volume_prontuario_id = m.volume_prontuario_id AND k.excluido_em IS NULL
          AND (k.movimentado_em > m.movimentado_em OR (k.movimentado_em = m.movimentado_em AND k.id > m.id))
          AND (k.destino_setor_funcional_id = m.saida_setor_funcional_id OR ko.tipo IN ('descarte', 'devolucao')))
 ORDER BY m.movimentado_em, m.id`;

const SQL_PRODUCAO_SUS = `SELECT 'BPA' AS instrumento, ps.codigo_sigtap AS procedimento, COUNT(*) AS registros,
       SUM(it.quantidade) AS quantidade, SUM(it.valor_total) AS valor
  FROM producao_ambulatorial_sus p
  JOIN competencia_sus cs ON cs.id = p.competencia_sus_id
  JOIN producao_ambulatorial_sus_item it ON it.producao_ambulatorial_sus_id = p.id AND it.excluido_em IS NULL
  JOIN procedimento_sigtap ps ON ps.id = it.procedimento_sigtap_id
 WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.situacao <> 'cancelada'
   AND cs.competencia >= ? AND cs.competencia <= ?
 GROUP BY ps.codigo_sigtap
 UNION ALL
SELECT 'AIH', ps.codigo_sigtap, COUNT(*), COUNT(*), SUM(ca.valor_total)
  FROM conta_aih ca
  JOIN competencia_sus cs ON cs.id = ca.competencia_sus_id
  JOIN procedimento_sigtap ps ON ps.id = COALESCE(ca.realizado_procedimento_sigtap_id, ca.solicitado_procedimento_sigtap_id)
 WHERE ca.estabelecimento_id = ? AND ca.excluido_em IS NULL AND ca.situacao NOT IN ('solicitada', 'negada', 'cancelada')
   AND cs.competencia >= ? AND cs.competencia <= ?
 GROUP BY ps.codigo_sigtap
 ORDER BY 1, 2`;

export const CONSULTAS_PROPRIAS: Readonly<Record<string, ConsultaPropria>> = {
  faturamentoPorConvenio: {
    codigo: 'faturamentoPorConvenio',
    sql: variantesDaRegua(
      (r) => `${CONTAS[r]} AS contas, COUNT(*) AS itens, SUM(i.valor_total) AS cobrado, SUM(i.valor_pago) AS pago`,
      '',
    ),
    variante: varianteDaRegua,
    parametros: parametrosDaRegua,
    mapear: (ls) =>
      ls
        .map((x) => ({
          convenio: numN(x['convenio']),
          nomeConvenio: txt(x['nome']),
          contas: num(x['contas']),
          itens: num(x['itens']),
          cobrado: centavos(x['cobrado']),
          pago: centavos(x['pago']),
        }))
        .sort((a, b) => b.cobrado - a.cobrado || num(a.convenio) - num(b.convenio)),
  },
  glosasPorConvenio: {
    codigo: 'glosasPorConvenio',
    sql: variantesDaRegua(
      () =>
        'COUNT(*) AS itens, SUM(i.valor_total) AS cobrado, SUM(i.valor_pago) AS pago, SUM(i.valor_glosado) AS glosa',
      "AND (c.situacao = 'paga' OR i.valor_pago > 0 OR i.valor_glosado > 0)",
    ),
    variante: varianteDaRegua,
    parametros: parametrosDaRegua,
    mapear: (ls) =>
      ls
        .map((x) => {
          const cobrado = centavos(x['cobrado']);
          const glosa = centavos(x['glosa']);
          return {
            convenio: numN(x['convenio']),
            nomeConvenio: txt(x['nome']),
            itensBaixados: num(x['itens']),
            cobradoBaixado: cobrado,
            pagoBaixado: centavos(x['pago']),
            glosa,
            percentualGlosa: cobrado > 0 ? porMil(glosa, cobrado) : null,
          };
        })
        .sort((a, b) => b.glosa - a.glosa || num(a.convenio) - num(b.convenio)),
  },
  contasNaoFechadas: {
    codigo: 'contasNaoFechadas',
    sql: variantesContas(),
    variante: (v) => `${TIPO_CONTA[String(v['tipo'])] === undefined ? 'todas' : String(v['tipo'])}${conv(v) === null ? '' : '-convenio'}`,
    parametros: (v, variante, x) => [...periodoUtc(v, x), ...(variante.endsWith('-convenio') ? [conv(v)] : [])],
    mapear: (ls, _v, x) =>
      ls.map((r) => ({
        conta: numN(r['conta']),
        tipo: r['natureza'] === 'internacao' ? 'Internação' : 'Externa',
        competencia: txt(r['competencia']),
        convenio: numN(r['convenio']),
        alta: textoNoFuso(r['alta'], x.fuso),
        situacao: SITUACAO_CONTA[String(r['situacao'])] ?? txt(r['situacao']),
        paciente: txt(r['nome']),
      })),
  },
  examesPorSetor: {
    codigo: 'examesPorSetor',
    sql: {
      padrao: `SELECT COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id) AS ato, COUNT(*) AS exames,
       SUM(ei.liberado_em IS NOT NULL) AS liberados,
       SUM(ei.situacao IN ('solicitado', 'autorizado', 'agendado', 'coletado', 'em_analise')) AS pendentes
  FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
 WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND ei.excluido_em IS NULL
   AND ei.situacao NOT IN ('cancelado', 'recusado') AND r.solicitado_em >= ? AND r.solicitado_em < ?
 GROUP BY 1 ORDER BY 1`,
    },
    variante: () => 'padrao',
    parametros: (v, _variante, x) => periodoUtc(v, x),
    mapear: (ls) =>
      ls.map((x) => ({
        ato: numN(x['ato']),
        exames: num(x['exames']),
        liberados: num(x['liberados']),
        pendentes: num(x['pendentes']),
      })),
  },
  mapaCirurgicoDia: {
    codigo: 'mapaCirurgicoDia',
    sql: {
      padrao: `SELECT ac.sala_cirurgica_id AS sala, ${ISO('ac.inicio_cirurgia_em')} AS inicio, ${ISO('ac.fim_cirurgia_em')} AS termino,
       TIMESTAMPDIFF(MINUTE, ac.inicio_cirurgia_em, ac.fim_cirurgia_em) AS minutos, cc.descricao AS tipo,
       ac.fonte_pagadora_id AS convenio, ac.atendimento_id
  FROM ato_cirurgico ac JOIN carater_cirurgia cc ON cc.id = ac.carater_cirurgia_id
 WHERE ac.estabelecimento_id = ? AND ac.excluido_em IS NULL AND ac.situacao <> 'cancelado'
   AND COALESCE(ac.inicio_cirurgia_em, ac.entrada_sala_em) >= ?
   AND COALESCE(ac.inicio_cirurgia_em, ac.entrada_sala_em) < ?
 ORDER BY ac.sala_cirurgica_id, COALESCE(ac.inicio_cirurgia_em, ac.entrada_sala_em), ac.id`,
    },
    variante: () => 'padrao',
    parametros: (v, _variante, x) => {
      const dia = String(v['dia']);
      return [inicioDoDiaEmUtc(dia, x.fuso), inicioDoDiaEmUtc(diaSeguinte(dia), x.fuso)];
    },
    mapear: (ls, _v, x) =>
      ls.map((r) => ({
        sala: numN(r['sala']),
        inicio: horaLocal(r['inicio'], x),
        termino: horaLocal(r['termino'], x),
        duracao: duracao(r['minutos']),
        tipo: txt(r['tipo']),
        convenio: numN(r['convenio']),
        atendimento: numN(r['atendimento_id']),
      })),
  },
  cirurgiasPorPeriodo: {
    codigo: 'cirurgiasPorPeriodo',
    sql: {
      padrao: `SELECT DATE_FORMAT(CONVERT_TZ(COALESCE(ac.inicio_cirurgia_em, ac.entrada_sala_em), '+00:00', q.desloc), '%Y-%m-%d') AS dia,
       cc.descricao AS tipo, COUNT(*) AS n
  FROM (SELECT ? AS est, ? AS desloc) q
  JOIN ato_cirurgico ac ON ac.estabelecimento_id = q.est
  JOIN carater_cirurgia cc ON cc.id = ac.carater_cirurgia_id
 WHERE ac.excluido_em IS NULL AND ac.situacao <> 'cancelado'
   AND COALESCE(ac.inicio_cirurgia_em, ac.entrada_sala_em) >= ?
   AND COALESCE(ac.inicio_cirurgia_em, ac.entrada_sala_em) < ?
 GROUP BY 1, 2 ORDER BY 1, 2`,
    },
    variante: () => 'padrao',
    parametros: (v, _variante, x) => [desloc(v, x), ...periodoUtc(v, x)],
    mapear: (ls) => ls.map((x) => ({ dia: txt(x['dia']), tipo: txt(x['tipo']), cirurgias: num(x['n']) })),
  },
  internadosNaData: {
    codigo: 'internadosNaData',
    sql: {
      padrao: `SELECT COALESCE(b.codigo, '') AS unidade, i.atendimento_id, ${ISO('i.data_hora_entrada')} AS entrada,
       i.fonte_pagadora_id, pf.nome
  FROM internacao i
  JOIN paciente p ON p.id = i.paciente_id
  JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
  LEFT JOIN leito_hospitalar lh ON lh.id = i.leito_hospitalar_id
  LEFT JOIN acomodacao ac ON ac.id = lh.acomodacao_id
  LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)
 WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.data_hora_cancelamento IS NULL
   AND i.data_hora_entrada < ? AND (i.data_hora_alta IS NULL OR i.data_hora_alta >= ?)
 ORDER BY unidade, i.data_hora_entrada, i.id`,
    },
    variante: () => 'padrao',
    parametros: (v, _variante, x) => {
      const fim = inicioDoDiaEmUtc(diaSeguinte(String(v['dia'])), x.fuso);
      return [fim, fim];
    },
    mapear: (ls, _v, c) =>
      ls.map((x) => ({
        unidade: txt(x['unidade']),
        atendimento: numN(x['atendimento_id']),
        entrada: textoNoFuso(x['entrada'], c.fuso),
        convenio: numN(x['fonte_pagadora_id']),
        paciente: txt(x['nome']),
      })),
  },
  atendimentosPorDia: {
    codigo: 'atendimentosPorDia',
    sql: {
      padrao: `SELECT DATE_FORMAT(CONVERT_TZ(a.entrada_em, '+00:00', q.desloc), '%Y-%m-%d') AS dia, ${TIPO_ATENDIMENTO} AS tipo,
       COUNT(*) AS n
  FROM (SELECT ? AS est, ? AS desloc) q
  JOIN atendimento a ON a.estabelecimento_id = q.est
 WHERE a.excluido_em IS NULL AND a.situacao <> 'cancelado'
   AND a.entrada_em >= ? AND a.entrada_em < ?
 GROUP BY 1, 2 ORDER BY 1, 2`,
    },
    variante: () => 'padrao',
    parametros: (v, _variante, x) => [desloc(v, x), ...periodoUtc(v, x)],
    mapear: (ls) =>
      ls.map((x) => ({
        dia: txt(x['dia']),
        tipo: x['tipo'] === 'I' ? 'Internação' : 'Externo',
        atendimentos: num(x['n']),
      })),
  },
  censoDiarioPorUnidade: {
    codigo: 'censoDiarioPorUnidade',
    sql: {
      padrao: `SELECT COALESCE(u.descricao, '') AS unidade,
       SUM(i.data_hora_alta IS NULL OR i.data_hora_alta >= q.fim) AS internados,
       SUM(i.data_hora_entrada >= q.ini) AS admissoes,
       SUM(i.data_hora_alta >= q.ini AND i.data_hora_alta < q.fim AND COALESCE(m.tipo_saida, '') <> 'obito') AS altas,
       SUM(i.data_hora_alta >= q.ini AND i.data_hora_alta < q.fim AND m.tipo_saida = 'obito') AS obitos
  FROM (SELECT ? AS est, CAST(? AS DATETIME(3)) AS ini, CAST(? AS DATETIME(3)) AS fim) q
  JOIN internacao i ON i.estabelecimento_id = q.est
  LEFT JOIN unidade_internacao u ON u.id = i.unidade_internacao_id
  LEFT JOIN motivo_saida_hospitalar m ON m.id = i.motivo_saida_hospitalar_id
 WHERE i.excluido_em IS NULL AND i.data_hora_cancelamento IS NULL
   AND i.data_hora_entrada < q.fim AND (i.data_hora_alta IS NULL OR i.data_hora_alta >= q.ini)
 GROUP BY u.id, u.descricao ORDER BY 1`,
    },
    variante: () => 'padrao',
    parametros: (v, _variante, x) => {
      const dia = String(v['dia']);
      return [inicioDoDiaEmUtc(dia, x.fuso), inicioDoDiaEmUtc(diaSeguinte(dia), x.fuso)];
    },
    mapear: (ls) =>
      ls.map((x) => ({
        unidade: txt(x['unidade']),
        internados: num(x['internados']),
        admissoes: num(x['admissoes']),
        altas: num(x['altas']),
        obitos: num(x['obitos']),
      })),
  },
  altasEObitos: {
    codigo: 'altasEObitos',
    sql: {
      padrao: `SELECT COALESCE(u.descricao, '') AS unidade, m.id AS motivo, m.descricao AS nome_motivo, m.tipo_saida,
       COUNT(*) AS n
  FROM internacao i
  LEFT JOIN unidade_internacao u ON u.id = i.unidade_internacao_id
  LEFT JOIN motivo_saida_hospitalar m ON m.id = i.motivo_saida_hospitalar_id
 WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.data_hora_cancelamento IS NULL
   AND i.data_hora_alta >= ? AND i.data_hora_alta < ?
 GROUP BY u.id, u.descricao, m.id, m.descricao, m.tipo_saida ORDER BY 1, 2`,
    },
    variante: () => 'padrao',
    parametros: (v, _variante, x) => periodoUtc(v, x),
    mapear: (ls) =>
      ls.map((x) => ({
        unidade: txt(x['unidade']),
        motivo: numN(x['motivo']),
        nomeMotivo: txt(x['nome_motivo']),
        grupo: GRUPO_SAIDA[String(x['tipo_saida'])] ?? null,
        saidas: num(x['n']),
        obitos: x['tipo_saida'] === 'obito' ? num(x['n']) : 0,
      })),
  },
  producaoPorProfissionalSetor: {
    codigo: 'producaoPorProfissionalSetor',
    sql: {
      padrao: `SELECT i.executante_profissional_id AS profissional, COALESCE(pr.nome_exibicao, pf.nome) AS nome,
       i.setor_funcional_id AS setor, COUNT(*) AS itens, SUM(i.quantidade) AS quantidade, SUM(i.valor_total) AS cobrado
  FROM conta_hospitalar c
  JOIN conta_hospitalar_item i ON i.conta_hospitalar_id = c.id AND ${ITENS_VALIDOS}
  LEFT JOIN profissional pr ON pr.id = i.executante_profissional_id
  LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
 WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND c.situacao <> 'cancelada'
   AND c.competencia >= ? AND c.competencia < ?
 GROUP BY 1, 2, 3 ORDER BY cobrado DESC, 1, 3`,
    },
    variante: () => 'padrao',
    parametros: (v) => [mesIni(v['mesInicio']), mesFimExcl(v['mesFim'])],
    mapear: (ls) =>
      ls.map((x) => ({
        profissional: numN(x['profissional']),
        nomeProfissional: txt(x['nome']),
        setor: numN(x['setor']),
        itens: num(x['itens']),
        quantidade: milesimos(x['quantidade']),
        cobrado: centavos(x['cobrado']),
      })),
  },
  consumoPorCentroCusto: {
    codigo: 'consumoPorCentroCusto',
    sql: {
      padrao: `SELECT me.centro_custo_id AS centro, cc.nome, ${CONSUMO_QTD} AS quantidade, ${CONSUMO_VALOR} AS valor
  ${CONSUMO_BASE}
  LEFT JOIN centro_custo cc ON cc.id = me.centro_custo_id
 WHERE ${CONSUMO_CORTE}
 GROUP BY 1, 2`,
    },
    variante: () => 'padrao',
    parametros: (v) => [mesIni(v['mesInicio']), mesFimExcl(v['mesFim'])],
    mapear: (ls) => {
      const total = ls.reduce((a, x) => a + num(x['valor']), 0);
      return ls
        .map((x) => ({
          centroCusto: numN(x['centro']),
          nomeCentroCusto: txt(x['nome']),
          quantidade: milesimos(x['quantidade']),
          valor: centavos(x['valor']),
          participacao: porMil(num(x['valor']), total),
        }))
        .sort((a, b) => b.valor - a.valor || num(a.centroCusto) - num(b.centroCusto));
    },
  },
  curvaAbcConsumo: {
    codigo: 'curvaAbcConsumo',
    sql: comFiltro(
      `SELECT me.insumo_id AS item, ins.nome, ${CONSUMO_QTD} AS quantidade, ${CONSUMO_VALOR} AS valor
  ${CONSUMO_BASE}
  JOIN insumo ins ON ins.id = me.insumo_id
 WHERE ${CONSUMO_CORTE}`,
      'AND me.local_estoque_id = ?',
      'GROUP BY 1, 2',
    ),
    variante: (v) => (inteiroOuNulo(v, 'local') === null ? 'todos' : 'filtro'),
    parametros: (v, variante) => [
      mesIni(v['mesInicio']),
      mesFimExcl(v['mesFim']),
      ...(variante === 'filtro' ? [inteiroOuNulo(v, 'local')] : []),
    ],
    mapear: (ls) =>
      curvaAbc(
        ls.map((x) => ({
          item: num(x['item']),
          nomeItem: txt(x['nome']),
          quantidade: num(x['quantidade']),
          valor: num(x['valor']),
        })),
      ),
  },
  validadeLote: {
    codigo: 'validadeLote',
    sql: comFiltro(
      `SELECT DATE_FORMAT(li.validade, '%Y-%m-%d') AS validade, li.insumo_id AS item, ins.nome, li.numero_lote AS lote,
       sl.local_estoque_id AS local, le.nome AS nome_local, sl.quantidade
  FROM saldo_lote sl
  JOIN lote_insumo li ON li.id = sl.lote_insumo_id AND li.excluido_em IS NULL
  JOIN insumo ins ON ins.id = li.insumo_id
  JOIN local_estoque le ON le.id = sl.local_estoque_id
 WHERE sl.estabelecimento_id = ? AND sl.excluido_em IS NULL AND sl.quantidade > 0 AND li.validade <= ?`,
      'AND sl.local_estoque_id = ?',
      'ORDER BY li.validade, ins.nome, li.numero_lote, sl.local_estoque_id',
    ),
    variante: (v) => (inteiroOuNulo(v, 'local') === null ? 'todos' : 'filtro'),
    parametros: (v, variante, x) => [
      somaDias(x.hoje, num(v['dias'])),
      ...(variante === 'filtro' ? [inteiroOuNulo(v, 'local')] : []),
    ],
    mapear: (ls, _v, x) =>
      ls.map((r) => {
        const validade = txt(r['validade']);
        const dias = validade ? diasEntre(x.hoje, validade) : null;
        return {
          validade,
          diasParaVencer: dias,
          situacao: dias === null ? null : dias < 0 ? 'vencido' : dias === 0 ? 'vence hoje' : 'a vencer',
          item: numN(r['item']),
          nomeItem: txt(r['nome']),
          lote: txt(r['lote']),
          local: numN(r['local']),
          nomeLocal: txt(r['nome_local']),
          quantidade: milesimos(r['quantidade']),
        };
      }),
  },
  dietasServidas: {
    codigo: 'dietasServidas',
    sql: {
      padrao: `SELECT DATE_FORMAT(CONVERT_TZ(p.vigencia_inicio_em, '+00:00', q.desloc), '%Y-%m-%d') AS dia, md.id AS dieta,
       md.descricao AS nome, COUNT(*) AS dietas, COUNT(DISTINCT p.atendimento_id) AS pacientes
  FROM (SELECT ? AS est, ? AS desloc) q
  JOIN prescricao p ON p.estabelecimento_id = q.est
  JOIN prescricao_item it ON it.prescricao_id = p.id
  JOIN prescricao_item_dieta d ON d.prescricao_item_id = it.id
  JOIN modalidade_dieta md ON md.id = d.modalidade_dieta_id
 WHERE p.excluido_em IS NULL AND it.excluido_em IS NULL AND d.excluido_em IS NULL
   AND p.situacao NOT IN ('rascunho', 'cancelada', 'suspensa') AND p.suspensa_em IS NULL
   AND it.situacao NOT IN ('suspenso', 'suspenso_correcao', 'cancelado') AND it.suspenso_em IS NULL
   AND p.vigencia_inicio_em >= ? AND p.vigencia_inicio_em < ?
 GROUP BY 1, 2, 3 ORDER BY 1, 3`,
    },
    variante: () => 'padrao',
    parametros: (v, _variante, x) => [desloc(v, x), ...periodoUtc(v, x)],
    mapear: (ls) =>
      ls.map((x) => ({
        dia: txt(x['dia']),
        dieta: numN(x['dieta']),
        nomeDieta: txt(x['nome']),
        dietas: num(x['dietas']),
        pacientes: num(x['pacientes']),
      })),
  },
  prontuariosEmprestados: {
    codigo: 'prontuariosEmprestados',
    sql: { padrao: SQL_PRONTUARIOS },
    variante: () => 'padrao',
    parametros: (v, _variante, x) => [num(v['setorSame']), ...periodoUtc(v, x)],
    mapear: (ls, _v, x) =>
      ls.map((r) => {
        const saida = textoNoFuso(r['saida'], x.fuso);
        return {
          conta: numN(r['conta']),
          saidaEm: saida,
          operacao: txt(r['operacao']),
          destino: txt(r['destino']),
          localAtual: txt(r['local_atual']),
          diasFora: saida ? diasEntre(saida.slice(0, 10), x.hoje) : null,
          prontuarios: 1,
        };
      }),
  },
  atendimentosPorConvenio: {
    codigo: 'atendimentosPorConvenio',
    sql: {
      todos: `${SQL_POR_CONVENIO} GROUP BY 1, 2, 3`,
      convenio: `${SQL_POR_CONVENIO} AND a.fonte_pagadora_id = ? GROUP BY 1, 2, 3`,
    },
    variante: (v) => (conv(v) === null ? 'todos' : 'convenio'),
    parametros: (v, variante, x) => {
      const p: unknown[] = periodoUtc(v, x);
      if (variante === 'convenio') p.push(conv(v));
      return p;
    },
    mapear: (ls) => {
      const m = new Map<string, { convenio: number | null; nome: string | null; i: number; e: number }>();
      for (const x of ls) {
        const k = String(x['convenio'] ?? '');
        const s = m.get(k) ?? { convenio: numN(x['convenio']), nome: txt(x['nome']), i: 0, e: 0 };
        if (x['tipo'] === 'I') s.i += num(x['n']);
        else s.e += num(x['n']);
        m.set(k, s);
      }
      const total = [...m.values()].reduce((a, s) => a + s.i + s.e, 0);
      return [...m.values()]
        .sort((a, b) => b.i + b.e - (a.i + a.e) || num(a.convenio) - num(b.convenio))
        .map((s) => ({
          convenio: s.convenio,
          nomeConvenio: s.nome,
          internacoes: s.i,
          externos: s.e,
          atendimentos: s.i + s.e,
          participacao: porMil(s.i + s.e, total),
        }));
    },
  },
  producaoSus: {
    codigo: 'producaoSus',
    sql: { padrao: SQL_PRODUCAO_SUS },
    variante: () => 'padrao',
    parametros: (v, _variante, x) => {
      const de = competenciaSus(v['mesInicio']);
      const ate = competenciaSus(v['mesFim']);
      return [de, ate, x.estabelecimento, de, ate];
    },
    mapear: (ls) =>
      ls.map((x) => ({
        instrumento: txt(x['instrumento']),
        procedimento: txt(x['procedimento']),
        registros: num(x['registros']),
        quantidade: milesimos(x['quantidade']),
        valor: centavos(x['valor']),
      })),
  },
  escalaAgendas: {
    codigo: 'escalaAgendas',
    sql: {
      todas: `${SQL_ESCALA} ${ORDEM_ESCALA}`,
      ativas: `${SQL_ESCALA} AND s.ativo AND e.ativo ${ORDEM_ESCALA}`,
    },
    variante: (v) => (v['situacao'] === 'todas' ? 'todas' : 'ativas'),
    parametros: (_v, _variante, x) => [x.hoje, x.hoje],
    mapear: (ls) =>
      ls.map((x) => {
        const ii = txt(x['intervalo_inicio']);
        const fi = txt(x['intervalo_fim']);
        return {
          agenda: txt(x['agenda']),
          diaSemana: DIAS_DA_SEMANA[num(x['dia_semana']) - 1] ?? null,
          inicio: txt(x['inicio']),
          fim: txt(x['fim']),
          intervalo: ii && fi ? `${ii}–${fi}` : null,
          duracaoMin: numN(x['duracao']),
          vagas: vagasDaEscala({
            inicioMin: num(x['inicio_min']),
            fimMin: num(x['fim_min']),
            intervaloMin: num(x['intervalo_min']),
            duracaoMin: numN(x['duracao']),
            vagasPorHorario: num(x['vagas_por_horario']) || 1,
          }),
          ativa: x['ativa'] === true || num(x['ativa']) === 1 ? 'Sim' : 'Não',
        };
      }),
  },
};

/** Os relatórios do catálogo que já têm consulta sobre o banco próprio. */
export const CODIGOS_COM_CONSULTA_PROPRIA: readonly string[] = Object.keys(CONSULTAS_PROPRIAS);

const PROIBIDO =
  /\b(?:INSERT|UPDATE|DELETE|REPLACE|MERGE|CALL|EXECUTE|ALTER|DROP|CREATE|RENAME|TRUNCATE|GRANT|REVOKE|COMMIT|ROLLBACK|SET|LOCK|HANDLER|LOAD|INTO)\b/i;

/** Regra 1: a consulta do catálogo é um SELECT literal, sem comentário nem ponto e vírgula, com os `?` certos. */
export function conferirSqlDoCatalogo(sql: string, parametros: number): void {
  const t = sql.trim();
  if (!/^SELECT\s/i.test(t))
    throw new ErroRelatorio('consulta', 'Consulta do catálogo que não é SELECT: recusada.');
  if (t.includes(';') || t.includes('--') || t.includes('/*') || t.includes('#'))
    throw new ErroRelatorio('consulta', 'Consulta do catálogo com ponto e vírgula ou comentário: recusada.');
  if (t.includes('${')) throw new ErroRelatorio('consulta', 'Consulta do catálogo montada: recusada.');
  const semLiterais = t.replace(/'(?:[^']|'')*'/g, "''");
  if (PROIBIDO.test(semLiterais))
    throw new ErroRelatorio('consulta', 'Consulta do catálogo com comando de escrita: recusada.');
  const marcas = (semLiterais.match(/\?/g) ?? []).length;
  if (marcas !== parametros)
    throw new ErroRelatorio(
      'consulta',
      `Consulta do catálogo com ${marcas} parâmetro(s) e ${parametros} valor(es): recusada.`,
    );
}

/** Executa o relatório do catálogo com os valores já validados pelo esquema do relatório. */
export async function executarConsultaCatalogo(
  l: Leitor,
  x: ContextoConsulta,
  codigo: string,
  valores: ValoresDoRelatorio,
  o: { readonly teto: number; readonly tempoMaximoMs: number },
): Promise<{ linhas: LinhaRelatorio[]; variante: string }> {
  const c = CONSULTAS_PROPRIAS[codigo];
  if (!c)
    throw new ErroRelatorio(
      'consulta',
      `O relatório ${codigo} ainda não tem consulta sobre o banco deste estabelecimento.`,
    );
  const variante = c.variante(valores);
  const sql = c.sql[variante];
  if (!sql) throw new ErroRelatorio('consulta', `Relatório ${codigo} sem a variante ${variante}.`);
  const parametros = [x.estabelecimento, ...c.parametros(valores, variante, x)];
  conferirSqlDoCatalogo(sql, parametros.length);
  try {
    const brutas = await l.consultar(sql, parametros, { teto: o.teto, tempoMaximoMs: o.tempoMaximoMs });
    return { linhas: c.mapear(brutas, valores, x), variante };
  } catch (e) {
    if (e instanceof ErroTempoEsgotado)
      throw new ErroRelatorio(
        'tempo',
        `O relatório passou do tempo máximo de ${Math.round(o.tempoMaximoMs / 1000)} s e foi cancelado: diminua o período ou use os filtros.`,
      );
    if (e instanceof ErroTetoLinhas)
      throw new ErroRelatorio(
        'teto',
        `O relatório passou do teto de ${o.teto} linhas: diminua o período ou use os filtros.`,
      );
    throw e;
  }
}
