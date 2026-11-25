// Porta do plantão realizado sobre o banco do cliente (MariaDB, pelo @sgh/nucleo; F2.2 lote 03-04), no modelo que já
// existe, sem tabela paralela:
//   - o realizado É o plantão (o id do realizado é o do plantão): informar grava entrada_registrada_em e
//     saida_registrada_em, situacao 'realizado' e revisado_* (quem registrou e quando);
//   - a decisão grava aprovado_* (quem decidiu, quando e o resultado): aprovado = verdadeiro aprova para pagamento ou
//     repasse; aprovado = falso com aprovado_em preenchido é a recusa, e o plantão volta a 'previsto' para novo registro.
//     Quem decide é outra pessoa (regra no domínio, conferirDecisaoRealizado; e conferida de novo aqui na transação);
//   - a tarifa por hora é a de valor_hora_plantao (regra geral por hora: sem profissional, grupo, especialidade, faixa
//     de horário ou tipo de dia); o valor do realizado aprovado é calculado na leitura pelo domínio (tarifaVigente e
//     valorRealizado), então a tarifa incluída depois vale para o aprovado ainda não lançado, sem passo de "valorar".
// Leituras em transação somente leitura, filtradas pelo estabelecimento da sessão; gravações por ação no Executor
// (gravacao-por-acao.ts: `pessoas.realizado.registrar`, `.decidir`, `.tarifa`), só na tabela da ação.
// Melhoria: o tipo de vínculo vem do vínculo de trabalho (regime trabalhista) ou do profissional (pessoa jurídica ou
// terceiro); o prestador do repasse é o profissional do plantão (id), como no repasse; os instantes ficam em UTC e
// voltam no fuso do estabelecimento; a regra dos quatro olhos vale também na transação (nunca decide quem registrou).
// Lançamento no repasse (`repasse.lancarEvento`, origem `plantao`): uma operação própria do Executor
// (`pessoas.realizado.lancar_repasse`) que, na mesma transação, confere os realizados (aprovados, com valor, não lançados,
// do mesmo profissional e da competência, soma igual ao valor), inclui o lançamento pelo gravador do repasse
// (gravadorEventoRepasse, mesmas validações de evento e favorecido) e liga cada plantão a ele (lancamento_repasse_id e
// lancado_por_usuario_id). Ou tudo, ou nada.
// Estorno do realizado aprovado: o plantão guarda quem estornou, quando e o motivo (estornado_*, motivo_estorno). O
// lançamento negativo (origem `estorno`) é feito pela mesma operação, pelo gravador do repasse (que recusa o que passa do
// original), só quando há realizado estornado e ainda sem o negativo para aquele lançamento; a ligação do negativo ao
// realizado (estorno_lancamento_repasse_id) é a ação do estorno, e o negativo já lançado e não ligado é achado pelo
// original e pela justificativa (conciliação).
// A tarifa incluída grava o tipo de plantão (valor_hora_plantao.tipo_plantao); a tarifa sem tipo vale para todos os
// tipos (lida uma vez por tipo). A fonte do realizado (informado ou ponto) e o motivo da recusa ficam no plantão
// (fonte_realizado e motivo_recusa_realizado) e voltam na leitura.
import {
  esquemaLancarEventoRepasse,
  type LancarEventoRepasseEntrada,
  VINCULOS_PRESTADOR,
} from '@sgh/contratos';
import {
  type RegraPlantaoLida,
  regraPlantaoAplicavel,
  tarifaVigente,
  valorPelaRegraPlantao,
  valorRealizado,
} from '@sgh/dominio-pessoas';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  erroConflitoVersao,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { gravadorEventoRepasse, TABELAS_EVENTO_REPASSE } from '../../repasse/public-api.js';
import type { GravacaoFeita, LiberacaoGravacao, TrilhaDaGravacao } from '../../exames/public-api.js';
import {
  type AcaoGravacao,
  eventoDaTrilha,
  type ExtrasGravacao,
  gravarPorAcao,
} from './gravacao-por-acao.js';
import {
  civilDoUtc,
  contextoDe,
  dataIso,
  fusoDe,
  num,
  numOuNulo,
  texto,
  textoOuNulo,
  utcDoCivil,
  type NucleoEscala,
} from './porta-escala-propria.js';
import type { ContextoRealizado, GravadorRealizado, PortaRealizado } from './porta-realizado.js';
import type { RegistroPlantaoParaRealizado, RegistroRealizado, RegistroTarifaPlantao } from './tipos.js';

/** A receita do repasse que a porta do realizado executa (o lançamento do plantão e o negativo do estorno). */
const OPERACAO_LANCAR_EVENTO = 'repasse.lancarEvento';
const centavos = (v: number) => Math.round(v * 100);

/** Uma operação do Executor por ação da tela do realizado. */
export const ACOES_REALIZADO: Readonly<Record<string, AcaoGravacao>> = {
  'pessoas.realizado.registrado': { nome: 'pessoas.realizado.registrar', tabelas: ['plantao'] },
  'pessoas.realizado.decidido': { nome: 'pessoas.realizado.decidir', tabelas: ['plantao'] },
  'pessoas.realizado.estornado': { nome: 'pessoas.realizado.estornar', tabelas: ['plantao'] },
  'pessoas.tarifa_plantao.gravada': {
    nome: 'pessoas.realizado.tarifa',
    tabelas: ['valor_hora_plantao', 'regra_repasse_plantao'],
  },
};

/** Tipos de plantão do modelo (ck_plantao_tipo): a tarifa sem tipo vale para cada um. */
const TIPOS_PLANTAO = ['presencial', 'sobreaviso', 'diarista'] as const;

const marcas = (k: number) => Array.from({ length: k }, () => '?').join(', ');

const SQL_VINCULO = `LEFT JOIN vinculo_trabalho v ON v.id = (SELECT v2.id FROM vinculo_trabalho v2
     WHERE v2.colaborador_id = p.colaborador_id AND v2.estabelecimento_id = p.estabelecimento_id AND v2.excluido_em IS NULL
     ORDER BY (v2.situacao IN ('ativo','afastado')) DESC, v2.data_admissao DESC, v2.id DESC LIMIT 1)`;

const SQL_PLANTAO = `SELECT p.id, p.escala_id, e.situacao AS estado_escala, e.setor_funcional_id, p.colaborador_id,
  p.profissional_id, col.nome, col.usuario_id, p.tipo, p.inicio_em, p.fim_em, p.situacao, v.id AS vinculo,
  v.regime_trabalhista, pr.recebe_por_pessoa_juridica
  FROM plantao p JOIN escala e ON e.id = p.escala_id
  LEFT JOIN colaborador col ON col.id = p.colaborador_id
  LEFT JOIN profissional pr ON pr.id = p.profissional_id
  ${SQL_VINCULO}
  WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND e.excluido_em IS NULL`;

/** O realizado é o plantão com o horário real registrado (revisado), fora do cancelado. */
const SQL_REALIZADO = `SELECT p.id, p.colaborador_id, p.setor_funcional_id, p.tipo, p.entrada_registrada_em,
  p.saida_registrada_em, p.observacao, p.revisado_em, ur.login AS informado_por, p.revisado_por_usuario_id,
  p.aprovado, p.aprovado_em, ua.login AS decidido_por, p.versao, v.id AS vinculo, p.fonte_realizado,
  p.motivo_recusa_realizado, p.lancamento_repasse_id, ul.login AS lancado_por, p.estornado_em,
  ue.login AS estornado_por, p.motivo_estorno, p.estorno_lancamento_repasse_id, p.escala_id, p.profissional_id,
  p.especialidade_medica_id, p.inicio_em, p.fim_em
  FROM plantao p
  LEFT JOIN usuario ur ON ur.id = p.revisado_por_usuario_id
  LEFT JOIN usuario ua ON ua.id = p.aprovado_por_usuario_id
  LEFT JOIN usuario ul ON ul.id = p.lancado_por_usuario_id
  LEFT JOIN usuario ue ON ue.id = p.estornado_por_usuario_id
  ${SQL_VINCULO}
  WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.situacao <> 'cancelado' AND p.revisado = TRUE
    AND p.entrada_registrada_em IS NOT NULL AND p.saida_registrada_em IS NOT NULL`;

/** A tarifa por hora geral do setor (ou de todos os setores), sem os recortes que a tela do realizado não usa. */
const SQL_TARIFA = `SELECT t.id, t.setor_funcional_id, t.tipo_plantao, t.vigencia_inicio, t.vigencia_fim, t.valor_hora,
  t.versao, u.login AS criado_por_login
  FROM valor_hora_plantao t LEFT JOIN usuario u ON u.id = t.criado_por
  WHERE t.estabelecimento_id = ? AND t.ativo = TRUE AND t.forma_pagamento = 'hora' AND t.profissional_id IS NULL
    AND t.grupo_setor_plantao_id IS NULL AND t.especialidade_medica_id IS NULL AND t.tipo_dia = 'todos'
    AND t.hora_inicio IS NULL AND t.valor_hora IS NOT NULL`;

/** C2-100: as regras de plantão do repasse ativas (todas as vigências; o domínio escolhe a do dia). */
const SQL_REGRA_PLANTAO = `SELECT id, descricao, profissional_id, escala_id, setor_funcional_id, especialidade_medica_id,
  dia_semana, forma_remuneracao, horas_plantao, valor_padrao, valor_fim_semana, valor_feriado, percentual_feriado, fator,
  valor_hora_extra_antes, percentual_hora_extra_antes, valor_hora_extra_depois, percentual_hora_extra_depois,
  tolerancia_minutos, vigencia_inicio, vigencia_fim
  FROM regra_repasse_plantao WHERE estabelecimento_id = ? AND ativo = TRUE`;

/** Os feriados do estabelecimento (e os gerais), fora o ponto facultativo. */
const SQL_FERIADO = `SELECT data FROM feriado WHERE ativo AND NOT ponto_facultativo
  AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`;

const decimalOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function regraPlantaoDe(r: Record<string, unknown>): RegraPlantaoLida {
  return {
    id: num(r['id']),
    descricao: texto(r['descricao']),
    profissional: numOuNulo(r['profissional_id']),
    escala: numOuNulo(r['escala_id']),
    setor: numOuNulo(r['setor_funcional_id']),
    especialidade: numOuNulo(r['especialidade_medica_id']),
    diaSemana: numOuNulo(r['dia_semana']),
    forma: texto(r['forma_remuneracao']) === 'por_hora' ? 'por_hora' : 'por_plantao',
    horasPlantao: decimalOuNulo(r['horas_plantao']),
    valorPadrao: Number(r['valor_padrao']),
    valorFimSemana: decimalOuNulo(r['valor_fim_semana']),
    valorFeriado: decimalOuNulo(r['valor_feriado']),
    percentualFeriado: decimalOuNulo(r['percentual_feriado']),
    fator: decimalOuNulo(r['fator']),
    valorHoraExtraAntes: decimalOuNulo(r['valor_hora_extra_antes']),
    percentualHoraExtraAntes: decimalOuNulo(r['percentual_hora_extra_antes']),
    valorHoraExtraDepois: decimalOuNulo(r['valor_hora_extra_depois']),
    percentualHoraExtraDepois: decimalOuNulo(r['percentual_hora_extra_depois']),
    toleranciaMinutos: num(r['tolerancia_minutos']),
    inicio: dataIso(r['vigencia_inicio']),
    fim: r['vigencia_fim'] === null || r['vigencia_fim'] === undefined ? null : dataIso(r['vigencia_fim']),
  };
}

/** O que dá valor ao realizado aprovado: a regra de plantão (C2-100) e, sem regra, a tarifa geral por hora. */
interface Valoracao {
  readonly tarifas: readonly RegistroTarifaPlantao[];
  readonly regras: readonly RegraPlantaoLida[];
  readonly feriados: ReadonlySet<string>;
}

const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';

function plantaoDe(r: Record<string, unknown>, fuso: string): RegistroPlantaoParaRealizado {
  const pj = verdadeiro(r['recebe_por_pessoa_juridica']);
  const situacao = texto(r['situacao']);
  return {
    plantao: num(r['id']),
    escala: num(r['escala_id']),
    estadoEscala: texto(r['estado_escala']),
    unidade: num(r['setor_funcional_id']),
    vinculo: num(r['vinculo']),
    pessoa: num(r['colaborador_id']),
    nome: texto(r['nome']),
    tipoVinculo:
      r['vinculo'] !== null && r['vinculo'] !== undefined
        ? texto(r['regime_trabalhista'])
        : pj
          ? 'pj'
          : 'terceiro',
    usuario: numOuNulo(r['usuario_id']),
    // O prestador do repasse é o profissional do plantão (id), como no módulo do repasse.
    registro: numOuNulo(r['profissional_id']),
    tipo: texto(r['tipo']),
    inicio: civilDoUtc(r['inicio_em'], fuso),
    fim: civilDoUtc(r['fim_em'], fuso),
    // Para o realizado, o plantão só se divide em cancelado ou não: o estado do realizado é lido à parte.
    situacao: situacao === 'cancelado' ? 'cancelado' : 'previsto',
  };
}

function tarifasDe(rs: readonly Record<string, unknown>[]): RegistroTarifaPlantao[] {
  return rs.flatMap((r) =>
    (r['tipo_plantao'] === null || r['tipo_plantao'] === undefined
      ? TIPOS_PLANTAO
      : [texto(r['tipo_plantao'])]
    ).map((tipo) => ({
      id: num(r['id']),
      tipo,
      unidade: numOuNulo(r['setor_funcional_id']),
      inicio: dataIso(r['vigencia_inicio']),
      fim: r['vigencia_fim'] === null || r['vigencia_fim'] === undefined ? null : dataIso(r['vigencia_fim']),
      valorHora: Number(r['valor_hora']),
      criadoPor: texto(r['criado_por_login']),
    })),
  );
}

function realizadoDe(
  r: Record<string, unknown>,
  fuso: string,
  { tarifas, regras, feriados }: Valoracao,
): RegistroRealizado {
  const inicio = civilDoUtc(r['entrada_registrada_em'], fuso);
  const fim = civilDoUtc(r['saida_registrada_em'], fuso);
  const minutos = Math.round(
    (instante(r['saida_registrada_em']) - instante(r['entrada_registrada_em'])) / 60000,
  );
  const decidido = r['aprovado_em'] !== null && r['aprovado_em'] !== undefined;
  const aprovado = decidido && verdadeiro(r['aprovado']);
  const estornado = aprovado && r['estornado_em'] !== null && r['estornado_em'] !== undefined;
  const situacao: RegistroRealizado['situacao'] = !decidido
    ? 'informado'
    : estornado
      ? 'estornado'
      : aprovado
        ? 'aprovado'
        : 'recusado';
  // C2-100: a regra de plantão mais específica vale antes da tarifa geral por hora.
  const paraRegra = {
    profissional: numOuNulo(r['profissional_id']),
    escala: num(r['escala_id']),
    setor: num(r['setor_funcional_id']),
    especialidade: numOuNulo(r['especialidade_medica_id']),
    previstoInicio: civilDoUtc(r['inicio_em'], fuso),
    previstoFim: civilDoUtc(r['fim_em'], fuso),
    realInicio: inicio,
    realFim: fim,
  };
  const regra = aprovado ? regraPlantaoAplicavel(regras, paraRegra) : null;
  const pr = regra ? valorPelaRegraPlantao(regra, paraRegra, feriados) : null;
  const t =
    aprovado && !pr
      ? tarifaVigente(tarifas, texto(r['tipo']), num(r['setor_funcional_id']), inicio.slice(0, 10))
      : null;
  const v = pr ?? (t ? valorRealizado(minutos, t.valorHora) : null);
  return {
    id: num(r['id']),
    plantao: num(r['id']),
    vinculo: num(r['vinculo']),
    pessoa: num(r['colaborador_id']),
    inicio,
    fim,
    minutos,
    origem: (textoOuNulo(r['fonte_realizado']) ?? 'informado') as RegistroRealizado['origem'],
    observacao: textoOuNulo(r['observacao']),
    situacao,
    informadoPor: texto(r['informado_por']),
    informadoEm: civilDoUtc(r['revisado_em'], fuso),
    decididoPor: decidido ? textoOuNulo(r['decidido_por']) : null,
    decididoEm: decidido ? civilDoUtc(r['aprovado_em'], fuso) : null,
    motivo: decidido && !aprovado ? textoOuNulo(r['motivo_recusa_realizado']) : null,
    tarifa: t?.id ?? null,
    valorHora: t?.valorHora ?? null,
    valor: v?.valor ?? null,
    regraPlantao: pr?.regra ?? null,
    parcelas: v?.parcelas ?? null,
    lancamento: numOuNulo(r['lancamento_repasse_id']),
    lancadoPor: numOuNulo(r['lancamento_repasse_id']) === null ? null : textoOuNulo(r['lancado_por']),
    versao: num(r['versao']),
    estorno: estornado
      ? {
          por: texto(r['estornado_por']),
          em: civilDoUtc(r['estornado_em'], fuso),
          motivo: texto(r['motivo_estorno']),
          lancamento: numOuNulo(r['estorno_lancamento_repasse_id']),
        }
      : null,
  };
}

function instante(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  return Date.parse(`${String(v).replace(' ', 'T').slice(0, 23)}Z`);
}

/** Leituras comuns à transação somente leitura e à de gravação. */
const leitura = {
  async regrasPlantao(l: Leitor, est: number): Promise<RegraPlantaoLida[]> {
    return (await l.consultar(`${SQL_REGRA_PLANTAO} ORDER BY vigencia_inicio, id`, [est])).map(
      regraPlantaoDe,
    );
  },
  async tarifas(l: Leitor, est: number): Promise<RegistroTarifaPlantao[]> {
    return tarifasDe(await l.consultar(`${SQL_TARIFA} ORDER BY t.vigencia_inicio, t.id`, [est]));
  },
  async realizados(
    l: Leitor,
    est: number,
    fuso: string,
    filtro: string,
    params: unknown[],
  ): Promise<RegistroRealizado[]> {
    const valoracao: Valoracao = {
      tarifas: await leitura.tarifas(l, est),
      regras: await leitura.regrasPlantao(l, est),
      feriados: new Set(
        (await l.consultar(SQL_FERIADO, [est], { teto: 5_000 })).map((x) => dataIso(x['data'])),
      ),
    };
    return (
      await l.consultar(`${SQL_REALIZADO} ${filtro} ORDER BY p.entrada_registrada_em, p.id LIMIT 5000`, [
        est,
        ...params,
      ])
    ).map((r) => realizadoDe(r, fuso, valoracao));
  },
  async plantao(
    l: Leitor,
    est: number,
    fuso: string,
    id: number,
  ): Promise<RegistroPlantaoParaRealizado | null> {
    const r = await l.uma(`${SQL_PLANTAO} AND p.id = ?`, [est, id]);
    return r ? plantaoDe(r, fuso) : null;
  },
  async plantoesPorIds(
    l: Leitor,
    est: number,
    fuso: string,
    ids: readonly number[],
  ): Promise<RegistroPlantaoParaRealizado[]> {
    if (ids.length === 0) return [];
    return (
      await l.consultar(`${SQL_PLANTAO} AND p.id IN (${marcas(ids.length)}) ORDER BY p.id`, [est, ...ids])
    ).map((r) => plantaoDe(r, fuso));
  },
  async apuracao(
    l: Leitor,
    est: number,
    competencia: string,
  ): Promise<{ id: number; estado: string } | null> {
    const r = await l.uma(
      `SELECT id, situacao FROM apuracao_repasse
        WHERE estabelecimento_id = ? AND competencia = ? AND tipo_apuracao IN ('plantao','misto')
        ORDER BY id DESC LIMIT 1`,
      [est, `${competencia.slice(0, 7)}-01`],
    );
    return r ? { id: num(r['id']), estado: texto(r['situacao']) } : null;
  },
};

/** A linha do plantão travada para a gravação (estabelecimento da sessão). */
async function travar(tx: TxOperacao, est: number, id: number): Promise<Record<string, unknown> | null> {
  return (
    (
      await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, aprovado, aprovado_em, lancamento_repasse_id, estornado_em,
                estorno_lancamento_repasse_id
           FROM plantao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [id, est],
      )
    )[0] ?? null
  );
}

/** Justificativa do negativo que o serviço lança no estorno: identifica o realizado na conciliação. */
const prefixoEstorno = (id: number) => `Estorno do plantão realizado ${id} (`;

/** O negativo já lançado para o realizado (pelo original e pela justificativa) e ainda não ligado a nenhum plantão. */
async function negativoNaoLigado(
  l: Leitor,
  est: number,
  id: number,
  original: number,
): Promise<number | null> {
  const r = await l.uma(
    `SELECT n.id FROM lancamento_repasse n
      WHERE n.estabelecimento_id = ? AND n.excluido_em IS NULL AND n.situacao <> 'cancelado'
        AND n.tipo_lancamento = 'estorno' AND n.estornado_lancamento_repasse_id = ? AND n.justificativa LIKE ?
        AND NOT EXISTS (SELECT 1 FROM plantao o WHERE o.estorno_lancamento_repasse_id = n.id)
      ORDER BY n.id LIMIT 1`,
    [est, original, `${prefixoEstorno(id).replace(/[%_\\]/g, (c) => `\\${c}`)}%`],
  );
  return r ? num(r['id']) : null;
}

/**
 * O lançamento no repasse sobre a transação do Executor:
 *   - origem `plantao`: confere os realizados e o valor, inclui o lançamento pelo gravador do repasse e liga os plantões;
 *   - origem `estorno`: só quando um realizado estornado do original ainda não tem o negativo; o gravador do repasse
 *     recusa o que passa do original. A ligação ao realizado é a ação seguinte do estorno (ligarEstorno).
 */
async function lancarNoRepasse(tx: TxOperacao, e: LancarEventoRepasseEntrada): Promise<ResultadoOperacao> {
  const est = tx.contexto.estabelecimento;
  const usuario = tx.contexto.usuario;
  if (est === null || est === undefined)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  if (usuario === null || usuario === undefined)
    throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  const repasse = gravadorEventoRepasse(tx);
  const fuso = await fusoDe(tx, est);
  if (e.origem === 'estorno') {
    const pend = await tx.consultarParaAtualizar(
      `SELECT id FROM plantao
        WHERE estabelecimento_id = ? AND excluido_em IS NULL AND lancamento_repasse_id = ?
          AND estornado_em IS NOT NULL AND estorno_lancamento_repasse_id IS NULL`,
      [est, e.estornaDe],
    );
    // O plantão não guarda o valor lançado: o valor do negativo é conferido contra o lançamento original, e não só
    // contra o realizado recalculado pela tarifa vigente (que muda se a tarifa for incluída ou alterada depois).
    const original = await tx.uma(
      `SELECT valor FROM lancamento_repasse
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'`,
      [e.estornaDe, est],
    );
    if (!original)
      throw recusa('sem-estorno-pendente', 'O lançamento original não existe neste estabelecimento.');
    const doOriginal = await leitura.realizados(tx, est, fuso, 'AND p.lancamento_repasse_id = ?', [
      e.estornaDe,
    ]);
    const valorOriginal = centavos(Number(original['valor']));
    // Original de um plantão só: o negativo devolve o valor lançado inteiro. De vários: o recálculo de todos tem de
    // fechar com o lançado, senão a tarifa mudou e o valor de cada plantão no lançamento não é mais conhecido.
    const lancadoDe = (r: RegistroRealizado): number | null =>
      doOriginal.length === 1 ? valorOriginal : r.valor === null ? null : centavos(r.valor);
    if (doOriginal.length > 1 && doOriginal.reduce((t, r) => t + centavos(r.valor ?? 0), 0) !== valorOriginal)
      throw recusa(
        'tarifa-alterada-depois-do-lancamento',
        'O valor recalculado dos plantões não fecha com o lançamento original: estorne pelo repasse.',
      );
    const rs = await leitura.realizados(
      tx,
      est,
      fuso,
      `AND p.id IN (${marcas(Math.max(pend.length, 1))})`,
      pend.length > 0 ? pend.map((r) => num(r['id'])) : [0],
    );
    const alvo = rs.find(
      (r) =>
        lancadoDe(r) !== null &&
        lancadoDe(r) === centavos(-e.valor) &&
        e.justificativa.startsWith(prefixoEstorno(r.id)),
    );
    if (!alvo)
      throw recusa(
        'sem-estorno-pendente',
        'Nenhum realizado estornado deste lançamento espera o negativo com este valor.',
      );
    if ((await negativoNaoLigado(tx, est, alvo.id, e.estornaDe!)) !== null)
      throw recusa(
        'estorno-ja-lancado',
        'O negativo deste realizado já foi lançado: peça o estorno de novo para ligá-lo.',
      );
    const r = await repasse.estornar({
      lancamento: e.estornaDe!,
      data: e.data,
      competencia: e.competencia,
      justificativa: e.justificativa,
      valor: -e.valor,
    });
    return { lancamento: r.lancamento, valor: e.valor, realizado: alvo.id };
  }
  if (e.origem !== 'plantao')
    throw recusa('origem-invalida', 'A porta do realizado só lança plantões e o estorno deles.');
  const ids = [...new Set(e.plantoes)];
  const travados = await tx.consultarParaAtualizar(
    `SELECT id, versao FROM plantao WHERE estabelecimento_id = ? AND excluido_em IS NULL AND id IN (${marcas(ids.length)})`,
    [est, ...ids],
  );
  if (travados.length !== ids.length)
    throw recusa('plantao-inexistente', 'Um dos plantões realizados não existe neste estabelecimento.');
  const rs = await leitura.realizados(tx, est, fuso, `AND p.id IN (${marcas(ids.length)})`, ids);
  const ps = new Map((await leitura.plantoesPorIds(tx, est, fuso, ids)).map((p) => [p.plantao, p]));
  if (rs.length !== ids.length)
    throw recusa('plantao-nao-lancavel', 'Um dos plantões não tem o realizado registrado.');
  for (const r of rs) {
    if (r.situacao !== 'aprovado' || r.lancamento !== null || r.valor === null)
      throw recusa(
        'plantao-nao-lancavel',
        'Um dos plantões realizados não está aprovado, está sem valor ou já foi lançado.',
      );
    const p = ps.get(r.plantao);
    if (
      !p ||
      !(VINCULOS_PRESTADOR as readonly string[]).includes(p.tipoVinculo) ||
      p.registro !== e.profissional
    )
      throw recusa(
        'plantao-de-outro-prestador',
        'Um dos plantões é de outro profissional ou de vínculo que não é de prestador.',
      );
    if (r.inicio.slice(0, 7) !== e.competencia)
      throw recusa('plantao-fora-da-competencia', 'Um dos plantões realizados começa fora da competência.');
  }
  if (rs.reduce((t, r) => t + centavos(r.valor ?? 0), 0) !== centavos(e.valor))
    throw recusa('valor-diferente-dos-plantoes', 'O valor não é a soma dos plantões realizados.');
  const { lancamento } = await repasse.incluir({
    empresa: e.empresa,
    competencia: e.competencia,
    data: e.data,
    previsao: e.previsao,
    evento: e.evento,
    tipo: e.tipo,
    prestador: e.prestador,
    profissional: e.profissional,
    valor: e.valor,
    referente: e.referente,
    justificativa: e.justificativa,
    apuracao: e.apuracao,
    plantoes: e.plantoes,
  });
  const versoes = new Map(travados.map((t) => [num(t['id']), num(t['versao'])]));
  for (const id of ids)
    await tx.alterar('plantao', id, versoes.get(id)!, {
      lancamento_repasse_id: lancamento,
      lancado_por_usuario_id: usuario,
    });
  return { lancamento, valor: e.valor, realizados: ids.length };
}

const operacaoLancarRepasse = definirOperacao<LancarEventoRepasseEntrada, ResultadoOperacao>({
  nome: 'pessoas.realizado.lancar_repasse',
  tabelas: ['plantao', ...TABELAS_EVENTO_REPASSE],
  entrada: esquemaLancarEventoRepasse as never,
  gravar: (tx, e) => lancarNoRepasse(tx, e),
  alvo: (_e, r) => ({ tabela: 'lancamento_repasse', id: num(r['lancamento']) || null }),
});

function gravadorSobre(
  tx: TxOperacao,
  est: number,
  usuario: number,
  fuso: string,
  x: ExtrasGravacao,
): GravadorRealizado {
  const agora = () => new Date();
  const umRealizado = async (id: number) =>
    (await leitura.realizados(tx, est, fuso, 'AND p.id = ?', [id]))[0] ?? null;
  return {
    plantao: (id) => leitura.plantao(tx, est, fuso, id),
    async realizadosDoPlantao(p) {
      const r = await umRealizado(p);
      return r ? [r] : [];
    },
    realizadosDaPessoa: (pessoa, de, ate) =>
      leitura.realizados(
        tx,
        est,
        fuso,
        'AND p.colaborador_id = ? AND p.entrada_registrada_em >= ? AND p.entrada_registrada_em < ? AND (p.aprovado_em IS NULL OR p.aprovado = TRUE)',
        [pessoa, utcDoCivil(de, fuso), utcDoCivil(ate, fuso)],
      ),
    realizado: (id) => umRealizado(id),
    tarifas: () => leitura.tarifas(tx, est),
    regrasPlantao: () => leitura.regrasPlantao(tx, est),
    async incluirRealizado(r) {
      const l = (
        await tx.consultarParaAtualizar(
          `SELECT versao, situacao, aprovado, aprovado_em FROM plantao
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [r.plantao, est],
        )
      )[0];
      if (!l || texto(l['situacao']) === 'cancelado')
        throw recusa('plantao-inexistente', 'O plantão não existe ou foi cancelado.');
      if (l['aprovado_em'] !== null && verdadeiro(l['aprovado'])) throw erroConflitoVersao(['aprovado']);
      // Um realizado em vigor por plantão: o registro novo substitui o informado ou o recusado (a trilha guarda o anterior).
      await tx.alterar('plantao', r.plantao, num(l['versao']), {
        situacao: 'realizado',
        entrada_registrada_em: utcDoCivil(r.inicio, fuso),
        saida_registrada_em: utcDoCivil(r.fim, fuso),
        observacao: r.observacao,
        revisado: true,
        revisado_por_usuario_id: usuario,
        revisado_em: agora(),
        aprovado: false,
        aprovado_por_usuario_id: null,
        aprovado_em: null,
        fonte_realizado: r.origem,
        motivo_recusa_realizado: null,
      });
      x.dados['realizado'] = { minutos: r.minutos };
      return r.plantao;
    },
    async decidirRealizado(d) {
      const l = (
        await tx.consultarParaAtualizar(
          `SELECT versao, revisado, revisado_por_usuario_id, aprovado_em FROM plantao
            WHERE id = ? AND estabelecimento_id = ? AND situacao = 'realizado' AND excluido_em IS NULL`,
          [d.id, est],
        )
      )[0];
      if (!l || !verdadeiro(l['revisado']) || l['aprovado_em'] !== null || num(l['versao']) !== d.versao)
        throw erroConflitoVersao(['versao', 'situacao']);
      // Quatro olhos também na transação: quem registrou não decide.
      if (numOuNulo(l['revisado_por_usuario_id']) === usuario)
        throw recusa(
          'quatro-olhos',
          'Quem registrou o realizado não o aprova: outra pessoa da coordenação decide.',
        );
      const aprova = d.situacao === 'aprovado';
      await tx.alterar('plantao', d.id, d.versao, {
        aprovado: aprova,
        aprovado_por_usuario_id: usuario,
        aprovado_em: agora(),
        // A recusa devolve o plantão a previsto: a coordenação registra de novo.
        ...(aprova ? {} : { situacao: 'previsto', motivo_recusa_realizado: d.motivo }),
      });
      x.dados['decisao'] = { situacao: d.situacao, tarifa: d.tarifa, valorHora: d.valorHora, valor: d.valor };
    },
    async incluirTarifa(t) {
      if (!(TIPOS_PLANTAO as readonly string[]).includes(t.tipo))
        throw recusa(
          'tipo-plantao-invalido',
          'O tipo de plantão da tarifa é presencial, sobreaviso ou diarista.',
        );
      if (t.unidade !== null) {
        const u = await tx.uma('SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ?', [
          t.unidade,
          est,
        ]);
        if (!u) throw recusa('unidade-inexistente', 'O setor da tarifa não existe neste estabelecimento.');
      }
      // Tarifa geral por hora (sem profissional, grupo, especialidade, faixa de horário ou tipo de dia): a que a tela usa.
      return tx.incluir('valor_hora_plantao', {
        estabelecimento_id: est,
        descricao: `Valor da hora do plantão ${t.tipo}`,
        setor_funcional_id: t.unidade,
        tipo_plantao: t.tipo,
        tipo_dia: 'todos',
        forma_pagamento: 'hora',
        valor_hora: t.valorHora,
        vigencia_inicio: t.inicio,
        vigencia_fim: t.fim,
      });
    },
    async encerrarTarifa(t) {
      const l = (
        await tx.consultarParaAtualizar(
          'SELECT versao, vigencia_inicio, vigencia_fim FROM valor_hora_plantao WHERE id = ? AND estabelecimento_id = ?',
          [t.id, est],
        )
      )[0];
      if (!l) throw recusa('tarifa-inexistente', 'A tarifa não existe neste estabelecimento.');
      const fimAtual = l['vigencia_fim'] === null ? null : dataIso(l['vigencia_fim']);
      if (t.fim < dataIso(l['vigencia_inicio']) || (fimAtual !== null && t.fim > fimAtual))
        throw recusa('vigencia-invalida', 'O fim fica antes do início da tarifa ou depois do fim atual.');
      await tx.alterar('valor_hora_plantao', t.id, num(l['versao']), { vigencia_fim: t.fim });
    },
    async incluirRegraPlantao(x) {
      for (const [tabela, id, nome] of [
        ['setor_funcional', x.setor, 'O setor'],
        ['escala', x.escala, 'A escala'],
        ['profissional', x.profissional, 'O profissional'],
      ] as const) {
        if (id === null) continue;
        const sql =
          tabela === 'setor_funcional'
            ? 'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ?'
            : tabela === 'escala'
              ? 'SELECT id FROM escala WHERE id = ? AND estabelecimento_id = ?'
              : 'SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL';
        if (!(await tx.uma(sql, tabela === 'profissional' ? [id] : [id, est])))
          throw recusa(`${tabela}-inexistente`, `${nome} da regra não existe neste estabelecimento.`);
      }
      return tx.incluir('regra_repasse_plantao', {
        estabelecimento_id: est,
        descricao: x.descricao,
        profissional_id: x.profissional,
        escala_id: x.escala,
        setor_funcional_id: x.setor,
        especialidade_medica_id: x.especialidade,
        dia_semana: x.diaSemana,
        forma_remuneracao: x.forma,
        horas_plantao: x.horasPlantao,
        valor_padrao: x.valorPadrao,
        valor_fim_semana: x.valorFimSemana,
        valor_feriado: x.valorFeriado,
        percentual_feriado: x.percentualFeriado,
        fator: x.fator,
        valor_hora_extra_antes: x.valorHoraExtraAntes,
        percentual_hora_extra_antes: x.percentualHoraExtraAntes,
        valor_hora_extra_depois: x.valorHoraExtraDepois,
        percentual_hora_extra_depois: x.percentualHoraExtraDepois,
        tolerancia_minutos: x.toleranciaMinutos,
        vigencia_inicio: x.inicio,
        vigencia_fim: x.fim,
      });
    },
    async encerrarRegraPlantao(x) {
      const l = (
        await tx.consultarParaAtualizar(
          'SELECT versao, vigencia_inicio, vigencia_fim FROM regra_repasse_plantao WHERE id = ? AND estabelecimento_id = ?',
          [x.id, est],
        )
      )[0];
      if (!l) throw recusa('regra-inexistente', 'A regra de plantão não existe neste estabelecimento.');
      const fimAtual = l['vigencia_fim'] === null ? null : dataIso(l['vigencia_fim']);
      if (x.fim < dataIso(l['vigencia_inicio']) || (fimAtual !== null && x.fim > fimAtual))
        throw recusa('vigencia-invalida', 'O fim fica antes do início da regra ou depois do fim atual.');
      await tx.alterar('regra_repasse_plantao', x.id, num(l['versao']), { vigencia_fim: x.fim });
    },
    // O valor do aprovado é calculado na leitura (tarifa vigente no dia): não há aprovado "sem valor" a valorar.
    realizadosSemValor: async () => [],
    plantoesPorIds: (ids) => leitura.plantoesPorIds(tx, est, fuso, ids),
    valorarRealizado: async () => false,
    apuracaoRepasse: (comp) => leitura.apuracao(tx, est, comp),
    async estornarRealizado(e) {
      const l = await travar(tx, est, e.id);
      if (
        !l ||
        l['aprovado_em'] === null ||
        !verdadeiro(l['aprovado']) ||
        l['estornado_em'] !== null ||
        num(l['versao']) !== e.versao
      )
        throw erroConflitoVersao(['versao', 'situacao']);
      await tx.alterar('plantao', e.id, e.versao, {
        estornado_em: agora(),
        estornado_por_usuario_id: usuario,
        motivo_estorno: e.motivo,
      });
      x.dados['estorno'] = { motivo: e.motivo, lancamento: numOuNulo(l['lancamento_repasse_id']) };
    },
    async ligarEstorno(e) {
      const l = await travar(tx, est, e.id);
      if (
        !l ||
        l['estornado_em'] === null ||
        l['lancamento_repasse_id'] === null ||
        l['estorno_lancamento_repasse_id'] !== null
      )
        throw erroConflitoVersao(['situacao']);
      // O negativo tem de estornar o lançamento deste plantão, no mesmo estabelecimento, não estar cancelado nem
      // ligado a outro.
      const neg = await tx.uma(
        `SELECT n.id FROM lancamento_repasse n
          WHERE n.id = ? AND n.estabelecimento_id = ? AND n.excluido_em IS NULL AND n.situacao <> 'cancelado'
            AND n.tipo_lancamento = 'estorno' AND n.estornado_lancamento_repasse_id = ?
            AND NOT EXISTS (SELECT 1 FROM plantao o WHERE o.estorno_lancamento_repasse_id = n.id)`,
        [e.lancamento, est, num(l['lancamento_repasse_id'])],
      );
      if (!neg)
        throw recusa(
          'estorno-inexistente',
          'O lançamento negativo não estorna o lançamento deste plantão ou já está ligado a outro.',
        );
      await tx.alterar('plantao', e.id, num(l['versao']), { estorno_lancamento_repasse_id: e.lancamento });
      x.dados['estorno'] = { lancamento: e.lancamento };
    },
    async desfazerEstorno(id) {
      const l = await travar(tx, est, id);
      if (!l || l['estornado_em'] === null || l['estorno_lancamento_repasse_id'] !== null)
        throw erroConflitoVersao(['situacao']);
      await tx.alterar('plantao', id, num(l['versao']), {
        estornado_em: null,
        estornado_por_usuario_id: null,
        motivo_estorno: null,
      });
      x.dados['estorno'] = { desfeito: true };
    },
    estornoLancado: (e) => negativoNaoLigado(tx, est, e.id, e.original),
  };
}

export class PortaRealizadoPropria implements PortaRealizado {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoEscala,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoRealizado, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c, 'pessoas-realizado'), async (l) =>
      fn(l, est, await fusoDe(l, est)),
    );
  }

  /** As ações da tela e o lançamento no repasse (`repasse.lancarEvento`) gravam. */
  async podeGravar(_c: ContextoRealizado, operacao: string): Promise<LiberacaoGravacao> {
    void operacao;
    return { pode: true, codigo: null, motivo: null };
  }
  /** O lançamento no repasse (plantões ou o negativo do estorno), numa operação própria do Executor. */
  async executar(
    c: ContextoRealizado,
    operacao: string,
    entrada: unknown,
    ctx: ContextoOperacao,
  ): Promise<GravacaoFeita> {
    if (operacao !== OPERACAO_LANCAR_EVENTO)
      throw recusa('operacao-desconhecida', 'A porta do realizado só executa o lançamento no repasse.');
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    const r = await this.executor.executar(operacaoLancarRepasse, c.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
  }
  async gravarSgh<T>(
    c: ContextoRealizado,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorRealizado) => Promise<T>,
  ): Promise<T> {
    const evento = eventoDaTrilha(trilha);
    const acao = evento !== null ? ACOES_REALIZADO[evento] : undefined;
    if (!acao)
      throw new ErroOperacao(
        500,
        'acao-desconhecida',
        'Ação sem operação',
        `A ação ${evento ?? '(sem evento)'} do realizado não tem operação declarada.`,
      );
    return gravarPorAcao(this.executor, c, 'pessoas-realizado', acao, trilha, (tx, est, usuario, fuso, x) =>
      fn(gravadorSobre(tx, est, usuario, fuso, x)),
    );
  }

  relogio(c: ContextoRealizado): Promise<{ hoje: string; agora: string }> {
    return this.ler(c, async (_l, _e, fuso) => {
      const agora = civilDoUtc(new Date(), fuso);
      return { hoje: agora.slice(0, 10), agora };
    });
  }
  plantoes(
    c: ContextoRealizado,
    f: { readonly de: string; readonly ate: string; readonly unidade?: number },
  ): Promise<RegistroPlantaoParaRealizado[]> {
    return this.ler(c, async (l, est, fuso) => {
      const p: unknown[] = [
        est,
        utcDoCivil(`${f.de}T00:00`, fuso),
        utcDoCivil(`${proximoDia(f.ate)}T00:00`, fuso),
      ];
      if (f.unidade !== undefined) p.push(f.unidade);
      return (
        await l.consultar(
          `${SQL_PLANTAO} AND e.situacao IN ('publicada','fechada') AND p.inicio_em >= ? AND p.inicio_em < ?${
            f.unidade !== undefined ? ' AND e.setor_funcional_id = ?' : ''
          } ORDER BY p.inicio_em, p.id LIMIT 2000`,
          p,
        )
      ).map((r) => plantaoDe(r, fuso));
    });
  }
  plantao(c: ContextoRealizado, id: number): Promise<RegistroPlantaoParaRealizado | null> {
    return this.ler(c, (l, est, fuso) => leitura.plantao(l, est, fuso, id));
  }
  plantoesPorIds(c: ContextoRealizado, ids: readonly number[]): Promise<RegistroPlantaoParaRealizado[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.ler(c, (l, est, fuso) => leitura.plantoesPorIds(l, est, fuso, ids));
  }
  realizadosDosPlantoes(c: ContextoRealizado, plantoes: readonly number[]): Promise<RegistroRealizado[]> {
    if (plantoes.length === 0) return Promise.resolve([]);
    return this.ler(c, (l, est, fuso) =>
      leitura.realizados(l, est, fuso, `AND p.id IN (${marcas(plantoes.length)})`, [...plantoes]),
    );
  }
  /** Os aprovados com início real no período [de, ate] (datas civis do estabelecimento). */
  realizadosAprovados(c: ContextoRealizado, de: string, ate: string): Promise<RegistroRealizado[]> {
    return this.ler(c, (l, est, fuso) =>
      leitura.realizados(
        l,
        est,
        fuso,
        'AND p.aprovado = TRUE AND p.aprovado_em IS NOT NULL AND p.estornado_em IS NULL AND p.entrada_registrada_em >= ? AND p.entrada_registrada_em < ?',
        [utcDoCivil(`${dataIso(de)}T00:00`, fuso), utcDoCivil(`${proximoDia(ate)}T00:00`, fuso)],
      ),
    );
  }
  realizado(c: ContextoRealizado, id: number): Promise<RegistroRealizado | null> {
    return this.ler(
      c,
      async (l, est, fuso) => (await leitura.realizados(l, est, fuso, 'AND p.id = ?', [id]))[0] ?? null,
    );
  }
  tarifas(c: ContextoRealizado): Promise<RegistroTarifaPlantao[]> {
    return this.ler(c, (l, est) => leitura.tarifas(l, est));
  }
  regrasPlantao(c: ContextoRealizado): Promise<RegraPlantaoLida[]> {
    return this.ler(c, (l, est) => leitura.regrasPlantao(l, est));
  }
  /** O código do prestador por registro: o registro é o profissional, e o prestador do repasse é o próprio profissional. */
  codigosDosRegistros(c: ContextoRealizado, registros: readonly number[]): Promise<Map<number, number>> {
    if (registros.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l) => {
      const rs = await l.consultar(
        `SELECT id FROM profissional WHERE id IN (${marcas(registros.length)}) AND excluido_em IS NULL`,
        [...registros],
      );
      return new Map(rs.map((r) => [num(r['id']), num(r['id'])]));
    });
  }
  /** A apuração do repasse de plantão da competência ("AAAA-MM") no estabelecimento, ou null. */
  apuracaoRepasse(c: ContextoRealizado, competencia: string): Promise<{ id: number; estado: string } | null> {
    return this.ler(c, (l, est) => leitura.apuracao(l, est, competencia));
  }
}

function proximoDia(data: string): string {
  const d = new Date(`${dataIso(data)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
