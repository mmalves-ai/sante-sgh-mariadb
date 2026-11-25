// Programação físico-orçamentária (FPO), tetos financeiros e cotas do SUS no banco do cliente (F7, 06-SUS linha 54). As
// regras são as puras de @sgh/dominio-faturamento (programacao-orcamentaria.ts); aqui ficam a leitura e a gravação.
// Contrato de efeito:
//   - importar a programação: uma linha em `programacao_orcamentaria_sus` (rascunho, forma importada, valor total) e uma
//     em `programacao_orcamentaria_sus_item` por meta, com o grupo ou o procedimento da tabela unificada resolvido pelo
//     código; arquivo com problema ou código inexistente não grava nada;
//   - ativar: a programação passa a vigente e a vigente anterior do mesmo contrato termina na véspera; cancelar só o
//     rascunho (nada apagado);
//   - incluir teto (`teto_financeiro_sus`) ou cota (`cota_procedimento_sus`) e inativar (ativo falso, nada apagado);
//   - remanejar cota: o pedido em `transferencia_cota_sus` (solicitada, com a fotografia da cota); a decisão por outra
//     pessoa; aprovado, a cota de origem perde e a de destino (existente ou nova) ganha, na mesma transação;
//   - a crítica da competência (BPA, APAC e AIH) consulta o saldo: a produção que passa do limite vira crítica.
// A trilha de cada gravação vai pelo executor (mesma transação).
import {
  aplicarRemanejamentoCota,
  apurarSaldosSus,
  conferirDecisaoRemanejamento,
  conferirLimiteSus,
  conferirRemanejamentoCota,
  conferirVigenciaCompetencia,
  criticasDeLimiteSus,
  lerArquivoProgramacao,
  type LimiteSus,
  periodoDaCompetenciaSus,
  type RegistroProducaoSus,
  type SaldoLimiteSus,
  vesperaDe,
} from '@sgh/dominio-faturamento';
import type { TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';
import type { NovaCriticaSus } from './tipos.js';

export const PORTA_PROGRAMACAO_SUS = Symbol('PORTA_PROGRAMACAO_SUS');

const TABELAS = [
  'programacao_orcamentaria_sus',
  'programacao_orcamentaria_sus_item',
  'teto_financeiro_sus',
  'cota_procedimento_sus',
  'transferencia_cota_sus',
];

type Consultor = {
  consultar<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    p?: readonly unknown[],
  ): Promise<T[]>;
};

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const competencia = z.string().regex(/^\d{6}$/);
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const dinheiro = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);

const esquemaImportacao = z
  .object({
    contrato: z.number().int().positive().nullable().default(null),
    descricao: z.string().trim().max(150).nullable().default(null),
    vigenciaInicio: dia,
    vigenciaFim: dia.nullable().default(null),
    conteudo: z.string().min(1).max(2_000_000),
    observacao: z.string().trim().max(500).nullable().default(null),
  })
  .strict();
const esquemaVersao = z.object({ versao: z.number().int().positive() }).strict();
const esquemaLimite = z
  .object({
    tipo: z.enum(['teto', 'cota']),
    instrumento: z.enum(['bpa', 'apac', 'aih', 'raas', 'todos']),
    contrato: z.number().int().positive().nullable().default(null),
    setor: z.number().int().positive().nullable().default(null),
    /** Código IBGE do município de origem do paciente (só na cota). */
    municipio: z
      .string()
      .regex(/^\d{6,7}$/)
      .nullable()
      .default(null),
    procedimento: z.string().nullable().default(null),
    grupo: z.string().nullable().default(null),
    financiamento: z.string().nullable().default(null),
    vigenciaInicio: dia,
    vigenciaFim: dia.nullable().default(null),
    quantidade: z.number().nonnegative().nullable().default(null),
    valor: z.number().nonnegative().nullable().default(null),
    percentualAlerta: z.number().nullable().default(null),
    bloqueia: z.boolean().default(false),
    observacao: z.string().trim().max(500).nullable().default(null),
  })
  .strict();
const esquemaRemanejamento = z
  .object({
    /** A competência (AAAAMM) em que o saldo livre da cota é conferido. */
    competencia,
    tipo: z.enum(['setor', 'municipio']),
    destinoSetor: z.number().int().positive().nullable().default(null),
    destinoMunicipio: z
      .string()
      .regex(/^\d{6,7}$/)
      .nullable()
      .default(null),
    quantidade: z.number().positive().nullable().default(null),
    valor: z.number().positive().nullable().default(null),
    motivo: z.string().max(1000),
  })
  .strict();
const esquemaDecisao = z
  .object({ aprovar: z.boolean(), competencia, versao: z.number().int().positive() })
  .strict();

export interface SaldoLido {
  readonly tipo: LimiteSus['tipo'];
  readonly id: number;
  readonly descricao: string;
  readonly instrumento: string;
  readonly quantidade: number | null;
  readonly valor: number | null;
  readonly consumoQuantidade: number;
  readonly consumoValor: number;
  readonly saldoQuantidade: number | null;
  readonly saldoValor: number | null;
  readonly percentual: number | null;
  readonly situacao: SaldoLimiteSus['situacao'];
  readonly bloqueia: boolean;
  readonly registros: number;
  readonly excedentes: number;
  readonly versao: number | null;
}

const PROC_GRUPO = `LEFT JOIN grupo_sigtap g ON g.id = x.grupo_sigtap_id
  LEFT JOIN procedimento_sigtap p ON p.id = x.procedimento_sigtap_id`;

// O município de origem é o do endereço principal vigente do paciente (só o id sai daqui; nada pessoal vai à tela).
const SQL_BPA = `SELECT it.id, it.quantidade, it.valor_total AS valor, ps.codigo_sigtap AS procedimento,
         fin.codigo_sigtap AS financiamento, COALESCE(it.executante_setor_funcional_id, pa.setor_funcional_id) AS setor,
         (SELECT e2.municipio_ibge_id FROM paciente pc
           JOIN endereco_pessoa e2 ON e2.pessoa_fisica_id = pc.pessoa_fisica_id AND e2.excluido_em IS NULL
            AND (e2.vigencia_fim IS NULL OR e2.vigencia_fim >= CURRENT_DATE)
          WHERE pc.id = it.paciente_id ORDER BY e2.principal DESC, e2.id LIMIT 1) AS municipio, it.conta_hospitalar_id AS conta,
         it.atendimento_id AS atendimento
    FROM competencia_sus cs
    JOIN producao_ambulatorial_sus pa ON pa.competencia_sus_id = cs.id AND pa.excluido_em IS NULL
     AND pa.situacao NOT IN ('cancelada', 'rejeitada')
    JOIN producao_ambulatorial_sus_item it ON it.producao_ambulatorial_sus_id = pa.id AND it.excluido_em IS NULL
    JOIN procedimento_sigtap ps ON ps.id = it.procedimento_sigtap_id
    LEFT JOIN dominio_sigtap fin ON fin.id = ps.financiamento_dominio_sigtap_id
   WHERE cs.estabelecimento_id = ? AND cs.instrumento = 'bpa' AND cs.competencia = ? AND cs.excluido_em IS NULL
   ORDER BY it.data_atendimento, it.id LIMIT 200000`;
const SQL_APAC = `SELECT a.id, 1 AS quantidade, a.valor_apresentado AS valor, ps.codigo_sigtap AS procedimento,
         fin.codigo_sigtap AS financiamento, NULL AS setor, (SELECT e2.municipio_ibge_id FROM paciente pc
           JOIN endereco_pessoa e2 ON e2.pessoa_fisica_id = pc.pessoa_fisica_id AND e2.excluido_em IS NULL
            AND (e2.vigencia_fim IS NULL OR e2.vigencia_fim >= CURRENT_DATE)
          WHERE pc.id = at.paciente_id ORDER BY e2.principal DESC, e2.id LIMIT 1) AS municipio,
         (SELECT MIN(ch.id) FROM conta_hospitalar ch WHERE ch.atendimento_id = a.atendimento_id) AS conta,
         a.atendimento_id AS atendimento
    FROM competencia_sus cs
    JOIN apac a ON a.competencia_sus_id = cs.id AND a.excluido_em IS NULL AND a.situacao NOT IN ('cancelada', 'rejeitada')
    JOIN procedimento_sigtap ps ON ps.id = a.principal_procedimento_sigtap_id
    LEFT JOIN dominio_sigtap fin ON fin.id = ps.financiamento_dominio_sigtap_id
    LEFT JOIN atendimento at ON at.id = a.atendimento_id
   WHERE cs.estabelecimento_id = ? AND cs.instrumento = 'apac' AND cs.competencia = ? AND cs.excluido_em IS NULL
   ORDER BY a.data_inicio, a.id LIMIT 200000`;
const SQL_AIH = `SELECT ca.id, 1 AS quantidade, ca.valor_total AS valor, ps.codigo_sigtap AS procedimento,
         fin.codigo_sigtap AS financiamento, NULL AS setor, (SELECT e2.municipio_ibge_id FROM paciente pc
           JOIN endereco_pessoa e2 ON e2.pessoa_fisica_id = pc.pessoa_fisica_id AND e2.excluido_em IS NULL
            AND (e2.vigencia_fim IS NULL OR e2.vigencia_fim >= CURRENT_DATE)
          WHERE pc.id = ca.paciente_id ORDER BY e2.principal DESC, e2.id LIMIT 1) AS municipio,
         ca.conta_hospitalar_id AS conta, NULL AS atendimento
    FROM competencia_sus cs
    JOIN conta_aih ca ON ca.competencia_sus_id = cs.id AND ca.excluido_em IS NULL
     AND ca.situacao NOT IN ('negada', 'cancelada', 'rejeitada')
    JOIN procedimento_sigtap ps ON ps.id = COALESCE(ca.realizado_procedimento_sigtap_id, ca.solicitado_procedimento_sigtap_id)
    LEFT JOIN dominio_sigtap fin ON fin.id = ps.financiamento_dominio_sigtap_id
   WHERE cs.estabelecimento_id = ? AND cs.instrumento = 'aih' AND cs.competencia = ? AND cs.excluido_em IS NULL
   ORDER BY ca.data_internacao, ca.id LIMIT 200000`;

/** A produção da competência dos três instrumentos (ou de um só), na ordem em que aconteceu. */
async function registrosDaCompetencia(
  l: Consultor,
  est: number,
  comp: string,
  so: 'bpa' | 'apac' | 'aih' | null = null,
): Promise<RegistroProducaoSus[]> {
  const out: RegistroProducaoSus[] = [];
  const fontes: ['bpa' | 'apac' | 'aih', string][] = [
    ['bpa', SQL_BPA],
    ['apac', SQL_APAC],
    ['aih', SQL_AIH],
  ];
  for (const [instrumento, sql] of fontes) {
    if (so && so !== instrumento) continue;
    for (const r of await l.consultar(sql, [est, comp]))
      out.push({
        chave: `${instrumento}:${num(r['id'])}`,
        instrumento,
        procedimento: String(r['procedimento']),
        financiamento: txtOuNull(r['financiamento']),
        setor: numOuNull(r['setor']),
        municipio: numOuNull(r['municipio']),
        quantidade: num(r['quantidade']),
        valor: dinheiro(r['valor']) ?? 0,
        conta: numOuNull(r['conta']),
        atendimento: numOuNull(r['atendimento']),
        item: null,
      });
  }
  return out;
}

/** Os limites em vigor no primeiro dia da competência: a programação vigente (pelo controle do contrato), tetos e cotas. */
async function limitesDaCompetencia(
  l: Consultor,
  est: number,
  inicio: string,
): Promise<(LimiteSus & { versao: number | null })[]> {
  const vigente = `x.vigencia_inicio <= ? AND (x.vigencia_fim IS NULL OR x.vigencia_fim >= ?)`;
  const out: (LimiteSus & { versao: number | null })[] = [];
  for (const r of await l.consultar(
    `SELECT i.id, i.setor_funcional_id, i.quantidade_orcada, i.valor_total_com_incremento, g.codigo_sigtap AS grupo,
            p.codigo_sigtap AS procedimento, fin.codigo_sigtap AS financiamento, x.id AS programacao,
            COALESCE(x.descricao, CONCAT('Programação ', x.id)) AS titulo, cg.controle_teto,
            COALESCE(p.descricao, g.descricao) AS alvo
       FROM programacao_orcamentaria_sus x
       JOIN programacao_orcamentaria_sus_item i ON i.programacao_orcamentaria_sus_id = x.id AND i.excluido_em IS NULL
       LEFT JOIN grupo_sigtap g ON g.id = i.grupo_sigtap_id
       LEFT JOIN procedimento_sigtap p ON p.id = i.procedimento_sigtap_id
       LEFT JOIN dominio_sigtap fin ON fin.id = i.financiamento_dominio_sigtap_id
       LEFT JOIN contrato_gestor_sus cg ON cg.id = x.contrato_gestor_sus_id
      WHERE x.estabelecimento_id = ? AND x.situacao IN ('vigente', 'encerrada') AND x.excluido_em IS NULL
        AND ${vigente}
      ORDER BY x.id, i.sequencia LIMIT 20000`,
    [est, inicio, inicio],
  )) {
    if (txtOuNull(r['controle_teto']) === 'nenhum') continue;
    const valor = dinheiro(r['valor_total_com_incremento']);
    out.push({
      tipo: 'programacao',
      id: num(r['id']),
      instrumento: 'todos',
      setor: numOuNull(r['setor_funcional_id']),
      municipio: null,
      procedimento: txtOuNull(r['procedimento']),
      grupo: r['procedimento'] ? null : txtOuNull(r['grupo']),
      financiamento: txtOuNull(r['financiamento']),
      quantidade: num(r['quantidade_orcada']),
      valor: valor && valor > 0 ? valor : null,
      percentualAlerta: 90,
      bloqueia: txtOuNull(r['controle_teto']) === 'bloqueio',
      descricao:
        `${String(r['titulo'])}: ${String(r['procedimento'] ?? r['grupo'])} ${String(r['alvo'] ?? '')}`.trim(),
      versao: null,
    });
  }
  for (const r of await l.consultar(
    `SELECT x.*, g.codigo_sigtap AS grupo, p.codigo_sigtap AS procedimento, s.nome AS setor_nome
       FROM teto_financeiro_sus x ${PROC_GRUPO}
       LEFT JOIN setor_funcional s ON s.id = x.setor_funcional_id
      WHERE x.estabelecimento_id = ? AND x.ativo AND ${vigente} ORDER BY x.id LIMIT 5000`,
    [est, inicio, inicio],
  ))
    out.push({
      tipo: 'teto',
      id: num(r['id']),
      instrumento: String(r['instrumento']) as LimiteSus['instrumento'],
      setor: numOuNull(r['setor_funcional_id']),
      municipio: null,
      procedimento: txtOuNull(r['procedimento']),
      grupo: txtOuNull(r['grupo']),
      financiamento: txtOuNull(r['codigo_sigtap_financiamento']),
      quantidade: r['quantidade_fisica'] === null ? null : num(r['quantidade_fisica']),
      valor: dinheiro(r['valor_orcamento']),
      percentualAlerta: num(r['percentual_alerta']),
      bloqueia: bool(r['bloqueia_excedente']),
      descricao: [
        'Teto',
        String(r['instrumento']).toUpperCase(),
        txtOuNull(r['codigo_sigtap_financiamento'])
          ? `financiamento ${String(r['codigo_sigtap_financiamento'])}`
          : '',
        txtOuNull(r['procedimento']) ?? txtOuNull(r['grupo']) ?? '',
        txtOuNull(r['setor_nome']) ?? '',
      ]
        .filter(Boolean)
        .join(' · '),
      versao: num(r['versao']),
    });
  for (const r of await l.consultar(
    `SELECT x.*, g.codigo_sigtap AS grupo, p.codigo_sigtap AS procedimento, s.nome AS setor_nome, m.nome AS municipio_nome
       FROM cota_procedimento_sus x ${PROC_GRUPO}
       LEFT JOIN setor_funcional s ON s.id = x.setor_funcional_id
       LEFT JOIN municipio_ibge m ON m.id = x.municipio_ibge_id
      WHERE x.estabelecimento_id = ? AND x.ativo AND ${vigente} ORDER BY x.id LIMIT 5000`,
    [est, inicio, inicio],
  ))
    out.push({
      tipo: 'cota',
      id: num(r['id']),
      instrumento: String(r['instrumento']) as LimiteSus['instrumento'],
      setor: numOuNull(r['setor_funcional_id']),
      municipio: numOuNull(r['municipio_ibge_id']),
      procedimento: txtOuNull(r['procedimento']),
      grupo: txtOuNull(r['grupo']),
      financiamento: null,
      quantidade: num(r['quantidade_cota']),
      valor: dinheiro(r['valor_cota']),
      percentualAlerta: 90,
      bloqueia: false,
      descricao: [
        'Cota',
        String(r['instrumento']).toUpperCase(),
        txtOuNull(r['procedimento']) ?? txtOuNull(r['grupo']) ?? '',
        txtOuNull(r['municipio_nome']) ?? '',
        txtOuNull(r['setor_nome']) ?? '',
      ]
        .filter(Boolean)
        .join(' · '),
      versao: num(r['versao']),
    });
  return out;
}

const saldoLido = (s: SaldoLimiteSus & { limite: LimiteSus & { versao: number | null } }): SaldoLido => ({
  tipo: s.limite.tipo,
  id: s.limite.id,
  descricao: s.limite.descricao,
  instrumento: s.limite.instrumento,
  quantidade: s.limite.quantidade,
  valor: s.limite.valor,
  consumoQuantidade: s.consumoQuantidade,
  consumoValor: s.consumoValor,
  saldoQuantidade: s.saldoQuantidade,
  saldoValor: s.saldoValor,
  percentual: s.percentual,
  situacao: s.situacao,
  bloqueia: s.limite.bloqueia,
  registros: s.registros,
  excedentes: s.excedentes.length,
  versao: s.limite.versao,
});

export class PortaProgramacaoSusPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'faturamento.programacaoSus');
  }

  /** O painel da competência: programações, saldo de cada limite em vigor e remanejamentos. */
  painel(c: ContextoPortaPropria, comp: string) {
    const periodo = periodoDaCompetenciaSus(comp);
    if (!periodo)
      throw recusaRegra('Competência inválida', [
        { campo: 'competencia', mensagem: 'Use a competência AAAAMM.' },
      ]);
    return this.ler(c, 'painel', async (l, est) => {
      const limites = await limitesDaCompetencia(l, est.id, periodo.inicio);
      const registros = await registrosDaCompetencia(l, est.id, comp);
      const saldos = apurarSaldosSus(limites, registros) as (SaldoLimiteSus & {
        limite: LimiteSus & { versao: number | null };
      })[];
      const programacoes = (
        await l.consultar(
          `SELECT x.id, x.descricao, x.contrato_gestor_sus_id, cg.numero_contrato, x.vigencia_inicio, x.vigencia_fim,
                  x.forma_entrada, x.valor_total, x.situacao, x.versao,
                  (SELECT COUNT(*) FROM programacao_orcamentaria_sus_item i
                    WHERE i.programacao_orcamentaria_sus_id = x.id AND i.excluido_em IS NULL) AS itens
             FROM programacao_orcamentaria_sus x
             LEFT JOIN contrato_gestor_sus cg ON cg.id = x.contrato_gestor_sus_id
            WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL
            ORDER BY x.situacao = 'vigente' DESC, x.vigencia_inicio DESC, x.id DESC LIMIT 200`,
          [est.id],
        )
      ).map((r) => ({
        id: num(r['id']),
        descricao: txtOuNull(r['descricao']),
        contrato: numOuNull(r['contrato_gestor_sus_id']),
        contratoNumero: txtOuNull(r['numero_contrato']),
        vigenciaInicio: dataIso(r['vigencia_inicio'])!,
        vigenciaFim: dataIso(r['vigencia_fim']),
        formaEntrada: String(r['forma_entrada']),
        valorTotal: dinheiro(r['valor_total']) ?? 0,
        situacao: String(r['situacao']),
        itens: num(r['itens']),
        versao: num(r['versao']),
      }));
      const remanejamentos = (
        await l.consultar(
          `SELECT t.id, t.cota_procedimento_sus_id, t.tipo_remanejamento, t.quantidade, t.valor, t.motivo, t.situacao,
                  t.solicitado_em, t.decidido_em, t.solicitante_usuario_id, t.versao,
                  so.nome AS origem_setor, sd.nome AS destino_setor, mo.nome AS origem_municipio,
                  md.nome AS destino_municipio
             FROM transferencia_cota_sus t
             JOIN cota_procedimento_sus c ON c.id = t.cota_procedimento_sus_id
             LEFT JOIN setor_funcional so ON so.id = t.origem_setor_funcional_id
             LEFT JOIN setor_funcional sd ON sd.id = t.destino_setor_funcional_id
             LEFT JOIN municipio_ibge mo ON mo.id = t.origem_municipio_ibge_id
             LEFT JOIN municipio_ibge md ON md.id = t.destino_municipio_ibge_id
            WHERE c.estabelecimento_id = ?
            ORDER BY t.situacao = 'solicitada' DESC, t.solicitado_em DESC, t.id DESC LIMIT 200`,
          [est.id],
        )
      ).map((r) => ({
        id: num(r['id']),
        cota: num(r['cota_procedimento_sus_id']),
        tipo: String(r['tipo_remanejamento']),
        origem: txtOuNull(r['origem_setor']) ?? txtOuNull(r['origem_municipio']),
        destino: txtOuNull(r['destino_setor']) ?? txtOuNull(r['destino_municipio']),
        quantidade: r['quantidade'] === null ? null : num(r['quantidade']),
        valor: dinheiro(r['valor']),
        motivo: String(r['motivo']),
        situacao: String(r['situacao']),
        solicitadoEm: String(r['solicitado_em']),
        doUsuario: num(r['solicitante_usuario_id']) === c.usuario,
        versao: num(r['versao']),
      }));
      return {
        competencia: comp,
        periodo,
        programacoes,
        saldos: saldos.map(saldoLido),
        registros: {
          bpa: registros.filter((r) => r.instrumento === 'bpa').length,
          apac: registros.filter((r) => r.instrumento === 'apac').length,
          aih: registros.filter((r) => r.instrumento === 'aih').length,
        },
        remanejamentos,
      };
    });
  }

  /** As metas de uma programação, com o código e a descrição do grupo ou do procedimento. */
  itens(c: ContextoPortaPropria, id: number) {
    return this.ler(c, 'itens', async (l, est) => {
      const x = await l.uma(
        'SELECT id FROM programacao_orcamentaria_sus WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [id, est.id],
      );
      if (!x) throw naoEncontrado('Programação');
      return (
        await l.consultar(
          `SELECT x.sequencia, x.nivel, COALESCE(p.codigo_sigtap, g.codigo_sigtap) AS codigo,
                  COALESCE(p.descricao, g.descricao) AS descricao, x.quantidade_orcada, x.valor_unitario,
                  x.valor_total_com_incremento
             FROM programacao_orcamentaria_sus_item x ${PROC_GRUPO}
            WHERE x.programacao_orcamentaria_sus_id = ? AND x.excluido_em IS NULL ORDER BY x.sequencia LIMIT 20000`,
          [id],
        )
      ).map((r) => ({
        sequencia: num(r['sequencia']),
        nivel: String(r['nivel']),
        codigo: String(r['codigo']),
        descricao: String(r['descricao']),
        quantidade: num(r['quantidade_orcada']),
        valorUnitario: dinheiro(r['valor_unitario']),
        valorTotal: dinheiro(r['valor_total_com_incremento']) ?? 0,
      }));
    });
  }

  /** Contratos com o gestor e setores (para os formulários). */
  opcoes(c: ContextoPortaPropria) {
    return this.ler(c, 'opcoes', async (l, est) => ({
      contratos: (
        await l.consultar(
          `SELECT id, numero_contrato, gestor_nome, controle_teto FROM contrato_gestor_sus
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao IN ('rascunho', 'vigente')
            ORDER BY vigencia_inicio DESC LIMIT 200`,
          [est.id],
        )
      ).map((r) => ({
        id: num(r['id']),
        descricao: `${String(r['numero_contrato'])} · ${String(r['gestor_nome'])}`,
        controleTeto: String(r['controle_teto']),
      })),
      setores: (
        await l.consultar(
          `SELECT id, codigo, nome FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL
            ORDER BY nome LIMIT 1000`,
          [est.id],
        )
      ).map((r) => ({ id: num(r['id']), descricao: `${String(r['nome'])} (${String(r['codigo'])})` })),
    }));
  }

  /** A crítica da competência consulta o saldo: a produção acima do limite vira crítica (com a conta de origem). */
  criticasDaCompetencia(
    c: ContextoPortaPropria,
    instrumento: 'bpa' | 'apac' | 'aih',
    comp: string,
  ): Promise<NovaCriticaSus[]> {
    const periodo = periodoDaCompetenciaSus(comp);
    if (!periodo) return Promise.resolve([]);
    return this.ler(c, 'critica', async (l, est) => {
      const limites = (await limitesDaCompetencia(l, est.id, periodo.inicio)).filter(
        (x) => x.instrumento === 'todos' || x.instrumento === instrumento,
      );
      if (!limites.length) return [];
      // O teto "todos" soma a produção dos três instrumentos; a crítica fica só nos registros deste.
      const registros = await registrosDaCompetencia(l, est.id, comp);
      return criticasDeLimiteSus(apurarSaldosSus(limites, registros), registros)
        .filter((x) => x.conta !== null && x.chave.split(':')[3] === instrumento)
        .map((x) => ({
          chave: x.chave,
          regra: x.regra,
          gravidade: x.gravidade,
          conta: x.conta,
          convenio: null,
          atendimento: x.atendimento,
          item: x.item,
          detalhe: JSON.stringify(x.detalhe),
        }));
    });
  }

  async importar(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; itens: number; valorTotal: number }> {
    const e = entradaValida(esquemaImportacao, entrada);
    const vig = conferirVigenciaCompetencia(e.vigenciaInicio, e.vigenciaFim);
    if (vig.length) throw recusaRegra('Programação recusada', vig);
    const lido = lerArquivoProgramacao(e.conteudo);
    if (lido.problemas.length)
      throw recusaRegra('Arquivo da programação recusado', lido.problemas.slice(0, 20));
    return this.gravar(c, 'faturamento.sus.programacao.importar', TABELAS, async (tx, est) => {
      if (e.contrato !== null) {
        const ct = await tx.uma(
          'SELECT id FROM contrato_gestor_sus WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.contrato, est.id],
        );
        if (!ct) throw naoEncontrado('Contrato com o gestor');
        const igual = await tx.uma(
          `SELECT id FROM programacao_orcamentaria_sus
            WHERE estabelecimento_id = ? AND contrato_gestor_sus_id = ? AND vigencia_inicio = ?`,
          [est.id, e.contrato, e.vigenciaInicio],
        );
        if (igual)
          throw recusaRegra('Programação recusada', [
            {
              campo: 'vigenciaInicio',
              mensagem: `Já existe a programação ${num(igual['id'])} deste contrato a partir desta competência.`,
            },
          ]);
      }
      const resolvidos: {
        grupo: number | null;
        procedimento: number | null;
        financiamento: number | null;
      }[] = [];
      const faltam: { campo: string; mensagem: string }[] = [];
      for (const it of lido.itens) {
        if (it.nivel === 'procedimento') {
          const p = await tx.uma(
            `SELECT id, grupo_sigtap_id, financiamento_dominio_sigtap_id FROM procedimento_sigtap
              WHERE codigo_sigtap = ? ORDER BY id DESC LIMIT 1`,
            [it.codigo],
          );
          if (!p)
            faltam.push({
              campo: 'codigo',
              mensagem: `Linha ${it.linha}: o procedimento ${it.codigo} não existe.`,
            });
          else
            resolvidos.push({
              grupo: null,
              procedimento: num(p['id']),
              financiamento: numOuNull(p['financiamento_dominio_sigtap_id']),
            });
        } else {
          const g = await tx.uma(
            `SELECT id FROM grupo_sigtap WHERE codigo_sigtap = ? ORDER BY vigencia_fim IS NULL DESC, id DESC LIMIT 1`,
            [it.codigo],
          );
          if (!g)
            faltam.push({ campo: 'codigo', mensagem: `Linha ${it.linha}: o grupo ${it.codigo} não existe.` });
          else resolvidos.push({ grupo: num(g['id']), procedimento: null, financiamento: null });
        }
      }
      if (faltam.length) throw recusaRegra('Arquivo da programação recusado', faltam.slice(0, 20));
      const id = await tx.incluir('programacao_orcamentaria_sus', {
        estabelecimento_id: est.id,
        contrato_gestor_sus_id: e.contrato,
        descricao: e.descricao,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        forma_entrada: 'importada',
        processado_em: new Date(),
        valor_total: lido.valorTotal,
        situacao: 'rascunho',
        observacao: e.observacao,
      });
      for (const [i, it] of lido.itens.entries()) {
        const r = resolvidos[i]!;
        await tx.incluir('programacao_orcamentaria_sus_item', {
          programacao_orcamentaria_sus_id: id,
          sequencia: it.sequencia,
          nivel: it.nivel,
          grupo_sigtap_id: r.grupo,
          procedimento_sigtap_id: r.procedimento,
          financiamento_dominio_sigtap_id: r.financiamento,
          quantidade_orcada: it.quantidade,
          valor_unitario: it.valorUnitario,
          valor_total: it.valorTotal,
          percentual_incremento: it.percentualIncremento,
          valor_incremento: it.valorIncremento,
          valor_total_com_incremento: it.valorTotalComIncremento,
        });
      }
      return {
        tabela: 'programacao_orcamentaria_sus',
        id,
        itens: lido.itens.length,
        valorTotal: lido.valorTotal,
      };
    });
  }

  /** O rascunho passa a vigente; a vigente anterior do mesmo contrato termina na véspera. */
  async ativar(
    c: ContextoPortaPropria,
    id: number,
    entrada: unknown,
  ): Promise<{ id: number; encerrada: number | null }> {
    const e = entradaValida(esquemaVersao, entrada);
    return this.gravar(c, 'faturamento.sus.programacao.ativar', TABELAS, async (tx, est) => {
      const x = await tx.uma(
        `SELECT id, contrato_gestor_sus_id, vigencia_inicio, vigencia_fim, situacao FROM programacao_orcamentaria_sus
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [id, est.id],
      );
      if (!x) throw naoEncontrado('Programação');
      if (String(x['situacao']) !== 'rascunho')
        throw recusaRegra('Programação recusada', [
          { campo: 'situacao', mensagem: 'Só o rascunho é ativado.' },
        ]);
      const inicio = dataIso(x['vigencia_inicio'])!;
      const outras = await tx.consultarParaAtualizar<Record<string, unknown>>(
        `SELECT id, vigencia_inicio, vigencia_fim, versao FROM programacao_orcamentaria_sus
          WHERE estabelecimento_id = ? AND contrato_gestor_sus_id <=> ? AND situacao = 'vigente' AND excluido_em IS NULL
            AND id <> ?`,
        [est.id, numOuNull(x['contrato_gestor_sus_id']), id],
      );
      let encerrada: number | null = null;
      for (const o of outras) {
        const oi = dataIso(o['vigencia_inicio'])!;
        const of = dataIso(o['vigencia_fim']);
        if (of !== null && of < inicio) continue;
        if (oi >= inicio)
          throw recusaRegra('Programação recusada', [
            {
              campo: 'vigenciaInicio',
              mensagem: `A programação ${num(o['id'])} já está vigente a partir desta competência ou depois.`,
            },
          ]);
        await tx.alterar('programacao_orcamentaria_sus', num(o['id']), num(o['versao']), {
          vigencia_fim: vesperaDe(inicio),
          situacao: 'encerrada',
        });
        encerrada = num(o['id']);
      }
      await tx.alterar('programacao_orcamentaria_sus', id, e.versao, { situacao: 'vigente' });
      return { tabela: 'programacao_orcamentaria_sus', id, encerrada };
    });
  }

  /** Cancela o rascunho (a linha fica, cancelada). */
  async cancelar(c: ContextoPortaPropria, id: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaVersao, entrada);
    return this.gravar(c, 'faturamento.sus.programacao.cancelar', TABELAS, async (tx, est) => {
      const x = await tx.uma(
        'SELECT situacao FROM programacao_orcamentaria_sus WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [id, est.id],
      );
      if (!x) throw naoEncontrado('Programação');
      if (String(x['situacao']) !== 'rascunho')
        throw recusaRegra('Programação recusada', [
          { campo: 'situacao', mensagem: 'Só o rascunho é cancelado; a vigente termina pela próxima.' },
        ]);
      await tx.alterar('programacao_orcamentaria_sus', id, e.versao, { situacao: 'cancelada' });
      return { tabela: 'programacao_orcamentaria_sus', id };
    });
  }

  /** Inclui um teto ou uma cota, com o grupo, o procedimento e o município resolvidos pelo código. */
  async incluirLimite(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number; tipo: string }> {
    const e = entradaValida(esquemaLimite, entrada);
    const problemas = conferirLimiteSus({ ...e, instrumento: e.instrumento });
    if (e.tipo === 'teto' && e.municipio !== null)
      problemas.push({ campo: 'municipio', mensagem: 'O teto não é por município: use a cota.' });
    if (problemas.length) throw recusaRegra(e.tipo === 'teto' ? 'Teto recusado' : 'Cota recusada', problemas);
    return this.gravar(c, `faturamento.sus.${e.tipo}.incluir`, TABELAS, async (tx, est) => {
      const ref = async (sql: string, p: unknown[], nome: string) => {
        const r = await tx.uma(sql, p);
        if (!r) throw naoEncontrado(nome);
        return num(r['id']);
      };
      const grupo = e.grupo
        ? await ref(
            'SELECT id FROM grupo_sigtap WHERE codigo_sigtap = ? ORDER BY vigencia_fim IS NULL DESC, id DESC LIMIT 1',
            [e.grupo],
            'Grupo da tabela unificada',
          )
        : null;
      const procedimento = e.procedimento
        ? await ref(
            'SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ? ORDER BY id DESC LIMIT 1',
            [e.procedimento],
            'Procedimento da tabela unificada',
          )
        : null;
      const setor = e.setor
        ? await ref(
            'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [e.setor, est.id],
            'Setor',
          )
        : null;
      const municipio = e.municipio
        ? await ref(
            'SELECT id FROM municipio_ibge WHERE codigo_ibge = ? OR LEFT(codigo_ibge, 6) = ? ORDER BY id LIMIT 1',
            [e.municipio, e.municipio.slice(0, 6)],
            'Município',
          )
        : null;
      if (e.contrato !== null)
        await ref(
          'SELECT id FROM contrato_gestor_sus WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.contrato, est.id],
          'Contrato com o gestor',
        );
      if (e.tipo === 'teto') {
        const id = await tx.incluir('teto_financeiro_sus', {
          estabelecimento_id: est.id,
          contrato_gestor_sus_id: e.contrato,
          setor_funcional_id: setor,
          instrumento: e.instrumento,
          codigo_sigtap_financiamento: e.financiamento,
          grupo_sigtap_id: grupo,
          procedimento_sigtap_id: procedimento,
          vigencia_inicio: e.vigenciaInicio,
          vigencia_fim: e.vigenciaFim,
          quantidade_fisica: e.quantidade,
          valor_orcamento: e.valor,
          percentual_alerta: e.percentualAlerta ?? 90,
          bloqueia_excedente: e.bloqueia,
          ativo: true,
          observacao: e.observacao,
        });
        return { tabela: 'teto_financeiro_sus', id, tipo: 'teto' };
      }
      const id = await tx.incluir('cota_procedimento_sus', {
        estabelecimento_id: est.id,
        instrumento: e.instrumento,
        municipio_ibge_id: municipio,
        setor_funcional_id: setor,
        procedimento_sigtap_id: procedimento,
        grupo_sigtap_id: grupo,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        quantidade_cota: e.quantidade,
        quantidade_pactuada: e.quantidade,
        valor_cota: e.valor,
        ativo: true,
      });
      return { tabela: 'cota_procedimento_sus', id, tipo: 'cota' };
    });
  }

  /** Inativa o teto ou a cota (nada apagado). */
  async inativarLimite(
    c: ContextoPortaPropria,
    tipo: 'teto' | 'cota',
    id: number,
    entrada: unknown,
  ): Promise<{ id: number }> {
    const e = entradaValida(esquemaVersao, entrada);
    const tabela = tipo === 'teto' ? 'teto_financeiro_sus' : 'cota_procedimento_sus';
    return this.gravar(c, `faturamento.sus.${tipo}.inativar`, TABELAS, async (tx, est) => {
      const sql =
        tipo === 'teto'
          ? 'SELECT ativo FROM teto_financeiro_sus WHERE id = ? AND estabelecimento_id = ?'
          : 'SELECT ativo FROM cota_procedimento_sus WHERE id = ? AND estabelecimento_id = ?';
      const x = await tx.uma(sql, [id, est.id]);
      if (!x) throw naoEncontrado(tipo === 'teto' ? 'Teto' : 'Cota');
      if (!bool(x['ativo']))
        throw recusaRegra('Inativação recusada', [{ campo: 'ativo', mensagem: 'O limite já está inativo.' }]);
      await tx.alterar(tabela, id, e.versao, { ativo: false });
      return { tabela, id };
    });
  }

  /** Pede o remanejamento de parte do saldo livre da cota (na competência dada) para outro setor ou município. */
  async solicitarRemanejamento(
    c: ContextoPortaPropria,
    cota: number,
    entrada: unknown,
  ): Promise<{ id: number }> {
    const e = entradaValida(esquemaRemanejamento, entrada);
    return this.gravar(c, 'faturamento.sus.cota.remanejar', TABELAS, async (tx, est, usuario) => {
      const { origem, destinoMunicipio } = await this.conferirPedido(tx, est.id, cota, e);
      const agora = new Date();
      const id = await tx.incluir('transferencia_cota_sus', {
        cota_procedimento_sus_id: cota,
        operacao: 'alteracao',
        dados: JSON.stringify({ quantidadeCota: origem.quantidadeCota, valorCota: origem.valorCota }),
        ocorrido_em: agora,
        usuario_id: usuario,
        tipo_remanejamento: e.tipo,
        origem_setor_funcional_id: e.tipo === 'setor' ? origem.setor : null,
        destino_setor_funcional_id: e.tipo === 'setor' ? e.destinoSetor : null,
        origem_municipio_ibge_id: e.tipo === 'municipio' ? origem.municipio : null,
        destino_municipio_ibge_id: e.tipo === 'municipio' ? destinoMunicipio : null,
        quantidade: e.quantidade,
        valor: e.valor,
        motivo: e.motivo.trim(),
        situacao: 'solicitada',
        solicitado_em: agora,
        solicitante_usuario_id: usuario,
      });
      return { tabela: 'transferencia_cota_sus', id };
    });
  }

  /** Aprova (aplica nas cotas) ou recusa o remanejamento; quem pediu não decide. */
  async decidirRemanejamento(
    c: ContextoPortaPropria,
    id: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: string; destino: number | null }> {
    const e = entradaValida(esquemaDecisao, entrada);
    return this.gravar(c, 'faturamento.sus.cota.decidir', TABELAS, async (tx, est, usuario) => {
      const t = await tx.uma(
        `SELECT t.* FROM transferencia_cota_sus t JOIN cota_procedimento_sus c ON c.id = t.cota_procedimento_sus_id
          WHERE t.id = ? AND c.estabelecimento_id = ?`,
        [id, est.id],
      );
      if (!t) throw naoEncontrado('Remanejamento');
      const p = conferirDecisaoRemanejamento(
        String(t['situacao']),
        num(t['solicitante_usuario_id']),
        usuario,
      );
      if (p.length) throw recusaRegra('Decisão recusada', p);
      const agora = new Date();
      if (!e.aprovar) {
        await tx.alterar('transferencia_cota_sus', id, e.versao, {
          situacao: 'recusada',
          decidido_em: agora,
          aprovador_usuario_id: usuario,
        });
        return { tabela: 'transferencia_cota_sus', id, situacao: 'recusada', destino: null };
      }
      const tipo = String(t['tipo_remanejamento']) as 'setor' | 'municipio';
      const cotaId = num(t['cota_procedimento_sus_id']);
      const pedido = {
        competencia: e.competencia,
        tipo,
        destinoSetor: numOuNull(t['destino_setor_funcional_id']),
        destinoMunicipio: null,
        quantidade: t['quantidade'] === null ? null : num(t['quantidade']),
        valor: dinheiro(t['valor']),
        motivo: String(t['motivo']),
      };
      // O saldo é conferido de novo: a produção pode ter crescido desde o pedido.
      const { origem, linha } = await this.conferirPedido(
        tx,
        est.id,
        cotaId,
        pedido,
        numOuNull(t['destino_municipio_ibge_id']),
      );
      const destMun = tipo === 'municipio' ? numOuNull(t['destino_municipio_ibge_id']) : origem.municipio;
      const destSetor = tipo === 'setor' ? pedido.destinoSetor : origem.setor;
      const existente = await tx.uma(
        `SELECT id, quantidade_cota, valor_cota, versao FROM cota_procedimento_sus
          WHERE estabelecimento_id = ? AND instrumento = ? AND municipio_ibge_id <=> ? AND setor_funcional_id <=> ?
            AND procedimento_sigtap_id <=> ? AND grupo_sigtap_id <=> ? AND vigencia_inicio = ? AND ativo`,
        [
          est.id,
          linha['instrumento'],
          destMun,
          destSetor,
          linha['procedimento_sigtap_id'],
          linha['grupo_sigtap_id'],
          linha['vigencia_inicio'],
        ],
      );
      const novos = aplicarRemanejamentoCota(
        { quantidadeCota: origem.quantidadeCota, valorCota: origem.valorCota },
        existente
          ? {
              quantidadeCota: num(existente['quantidade_cota']),
              valorCota: dinheiro(existente['valor_cota']),
            }
          : null,
        pedido,
      );
      await tx.alterar('cota_procedimento_sus', cotaId, num(linha['versao']), {
        quantidade_cota: novos.origem.quantidadeCota,
        valor_cota: novos.origem.valorCota,
      });
      let destino: number;
      if (existente) {
        destino = num(existente['id']);
        await tx.alterar('cota_procedimento_sus', destino, num(existente['versao']), {
          quantidade_cota: novos.destino.quantidadeCota,
          valor_cota: novos.destino.valorCota,
        });
      } else
        destino = await tx.incluir('cota_procedimento_sus', {
          estabelecimento_id: est.id,
          instrumento: linha['instrumento'],
          municipio_ibge_id: destMun,
          setor_funcional_id: destSetor,
          procedimento_sigtap_id: linha['procedimento_sigtap_id'],
          grupo_sigtap_id: linha['grupo_sigtap_id'],
          vigencia_inicio: linha['vigencia_inicio'],
          vigencia_fim: linha['vigencia_fim'],
          quantidade_cota: novos.destino.quantidadeCota,
          valor_cota: novos.destino.valorCota,
          ativo: true,
        });
      await tx.alterar('transferencia_cota_sus', id, e.versao, {
        situacao: 'aprovada',
        decidido_em: agora,
        aprovador_usuario_id: usuario,
        destino_cota_procedimento_sus_id: destino,
      });
      return { tabela: 'transferencia_cota_sus', id, situacao: 'aprovada', destino };
    });
  }

  private async conferirPedido(
    tx: TxOperacao,
    est: number,
    cota: number,
    e: {
      competencia: string;
      tipo: 'setor' | 'municipio';
      destinoSetor: number | null;
      destinoMunicipio: string | null;
      quantidade: number | null;
      valor: number | null;
      motivo: string;
    },
    destinoMunicipioId: number | null = null,
  ) {
    const periodo = periodoDaCompetenciaSus(e.competencia);
    if (!periodo)
      throw recusaRegra('Remanejamento recusado', [
        { campo: 'competencia', mensagem: 'Use a competência AAAAMM.' },
      ]);
    const linhas = await tx.consultarParaAtualizar<Record<string, unknown>>(
      'SELECT * FROM cota_procedimento_sus WHERE id = ? AND estabelecimento_id = ?',
      [cota, est],
    );
    const linha = linhas[0];
    if (!linha) throw naoEncontrado('Cota');
    if (!bool(linha['ativo']))
      throw recusaRegra('Remanejamento recusado', [{ campo: 'ativo', mensagem: 'A cota está inativa.' }]);
    let destinoMunicipio = destinoMunicipioId;
    if (e.destinoMunicipio !== null) {
      const m = await tx.uma(
        'SELECT id FROM municipio_ibge WHERE codigo_ibge = ? OR LEFT(codigo_ibge, 6) = ? ORDER BY id LIMIT 1',
        [e.destinoMunicipio, e.destinoMunicipio.slice(0, 6)],
      );
      if (!m) throw naoEncontrado('Município de destino');
      destinoMunicipio = num(m['id']);
    }
    if (e.destinoSetor !== null) {
      const s = await tx.uma(
        'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.destinoSetor, est],
      );
      if (!s) throw naoEncontrado('Setor de destino');
    }
    const limites = (await limitesDaCompetencia(tx, est, periodo.inicio)).filter(
      (x) => x.tipo === 'cota' && x.id === cota,
    );
    const instrumento = String(linha['instrumento']);
    const registros = await registrosDaCompetencia(
      tx,
      est,
      e.competencia,
      instrumento === 'bpa' || instrumento === 'apac' || instrumento === 'aih' ? instrumento : null,
    );
    const saldo = limites.length ? apurarSaldosSus(limites, registros)[0] : null;
    const origem = {
      setor: numOuNull(linha['setor_funcional_id']),
      municipio: numOuNull(linha['municipio_ibge_id']),
      quantidadeCota: num(linha['quantidade_cota']),
      valorCota: dinheiro(linha['valor_cota']),
      consumoQuantidade: saldo?.consumoQuantidade ?? 0,
      consumoValor: saldo?.consumoValor ?? 0,
    };
    const problemas = conferirRemanejamentoCota(origem, {
      tipo: e.tipo,
      destinoSetor: e.destinoSetor,
      destinoMunicipio,
      origemCompetencia: null,
      destinoCompetencia: null,
      quantidade: e.quantidade,
      valor: e.valor,
      motivo: e.motivo,
    });
    if (problemas.length) throw recusaRegra('Remanejamento recusado', problemas);
    return { origem, destinoMunicipio, linha };
  }
}
