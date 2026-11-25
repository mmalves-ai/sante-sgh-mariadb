// Habilitações, serviços e classificações SUS do estabelecimento e regras por tipo de prestador (F7, 06-SUS linha 61),
// no banco do cliente. As regras são as puras de @sgh/dominio-faturamento (estabelecimento-sus.ts); aqui ficam a leitura
// e a gravação. Contrato de efeito:
//   - habilitação: uma linha em `habilitacao_estabelecimento` (habilitação do catálogo, portaria, vigência por
//     competência, leitos); a habilitação que o catálogo do estabelecimento ainda não tem entra em `habilitacao_sus`
//     a partir da tabela unificada (código, descrição e versão da fonte); encerrar grava o fim da vigência com a versão
//     lida (nada apagado);
//   - conciliação com o cadastro nacional: as que faltam entram, as que saíram se encerram na véspera da competência,
//     tudo numa transação; sem `aplicar`, só a prévia;
//   - serviço e classificação: uma linha em `servico_classificacao_estabelecimento` (próprio ou terceirizado com o
//     prestador); encerrar grava o fim da vigência;
//   - regra por tipo de prestador: uma linha em `regra_prestador_sus` (do estabelecimento ou geral); encerrar grava o fim;
//   - regra do serviço automático: uma linha em `regra_servico_classificacao_sus`; inativar grava `ativo` falso.
// A lista vigente que a crítica da competência usa sai de `habilitacoesCadastradas`. A trilha vai pelo executor.
import {
  conciliarHabilitacoesCnes,
  type ConciliacaoCnes,
  conferirHabilitacaoEstabelecimento,
  conferirRegraPrestador,
  conferirRegraServicoClassificacao,
  conferirServicoEstabelecimento,
  diasDaCompetenciaSus,
  fimDoMesSus,
  type HabilitacaoEstabelecimentoVigencia,
  normalHabilitacao,
  type RegrasDaCriticaSus,
} from '@sgh/dominio-faturamento';
import { type TxOperacao } from '@sgh/nucleo';
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

export const PORTA_ESTABELECIMENTO_SUS = Symbol('PORTA_ESTABELECIMENTO_SUS');

const TABELAS = [
  'habilitacao_estabelecimento',
  'habilitacao_sus',
  'servico_classificacao_estabelecimento',
  'regra_prestador_sus',
  'regra_servico_classificacao_sus',
];

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const idOuNulo = id.nullable().default(null);
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const txt = (v: unknown): string => String(v ?? '');

const esquemaHabilitacao = z
  .object({
    codigo: z.string().trim().min(1).max(6),
    numeroPortaria: z.string().trim().max(60).nullable().default(null),
    dataPortaria: dia.nullable().default(null),
    vigenciaInicio: dia,
    vigenciaFim: dia.nullable().default(null),
    leitosHabilitados: z.number().int().nullable().default(null),
    observacao: z.string().trim().max(500).nullable().default(null),
  })
  .strict();
const esquemaEncerrar = z.object({ vigenciaFim: dia, versao: id }).strict();
const esquemaVersao = z.object({ versao: id }).strict();
const esquemaConciliacao = z
  .object({
    competencia: z.string().regex(/^\d{6}$/),
    habilitacoes: z
      .array(
        z
          .object({
            codigo: z.string().trim().min(1).max(6),
            vigenciaInicio: dia.nullable().optional(),
            vigenciaFim: dia.nullable().optional(),
            numeroPortaria: z.string().trim().max(60).nullable().optional(),
            dataPortaria: dia.nullable().optional(),
            leitosHabilitados: z.number().int().nullable().optional(),
          })
          .strict(),
      )
      .max(500),
    aplicar: z.boolean().default(false),
  })
  .strict();
const esquemaServico = z
  .object({
    servicoClassificacao: id,
    caracteristica: z.enum(['proprio', 'terceirizado']).default('proprio'),
    prestadorExterno: idOuNulo,
    vigenciaInicio: dia,
    vigenciaFim: dia.nullable().default(null),
  })
  .strict();
const esquemaRegraPrestador = z
  .object({
    geral: z.boolean().default(false),
    tipoPrestador: id,
    naturezaJuridica: idOuNulo,
    procedimentoCodigo: z
      .string()
      .regex(/^\d{10}$/)
      .nullable()
      .default(null),
    grupo: idOuNulo,
    servicoClassificacao: idOuNulo,
    instrumento: idOuNulo,
    permitido: z.boolean().default(true),
    vigenciaInicio: dia,
    vigenciaFim: dia.nullable().default(null),
  })
  .strict();
const esquemaRegraServico = z
  .object({
    servicoClassificacao: id,
    procedimentoCodigo: z
      .string()
      .regex(/^\d{10}$/)
      .nullable()
      .default(null),
    grupo: idOuNulo,
    setor: idOuNulo,
    local: idOuNulo,
    urgencia: z.boolean().default(false),
    prioridade: z.number().int().default(100),
  })
  .strict();

type Linha = Record<string, unknown>;
type Opcao = { id: number; codigo: string; descricao: string };

export interface HabilitacaoEstabelecimentoLida {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly numeroPortaria: string | null;
  readonly dataPortaria: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly leitosHabilitados: number | null;
  readonly observacao: string | null;
  readonly vigente: boolean;
  readonly versao: number;
}

export interface CadastroSusEstabelecimento {
  readonly habilitacoes: readonly HabilitacaoEstabelecimentoLida[];
  readonly servicos: readonly {
    id: number;
    servicoClassificacao: number;
    codigo: string;
    descricao: string;
    caracteristica: string;
    prestadorExterno: number | null;
    prestadorNome: string | null;
    vigenciaInicio: string;
    vigenciaFim: string | null;
    vigente: boolean;
    versao: number;
  }[];
  readonly regrasPrestador: readonly {
    id: number;
    geral: boolean;
    tipoPrestador: string;
    naturezaJuridica: string | null;
    procedimento: string | null;
    grupo: string | null;
    servicoClassificacao: string | null;
    instrumento: string | null;
    permitido: boolean;
    vigenciaInicio: string;
    vigenciaFim: string | null;
    vigente: boolean;
    versao: number;
  }[];
  readonly regrasServico: readonly {
    id: number;
    servicoClassificacao: string;
    procedimento: string | null;
    grupo: string | null;
    setor: string | null;
    local: string | null;
    urgencia: boolean;
    prioridade: number;
    ativo: boolean;
    versao: number;
  }[];
}

export interface OpcoesCadastroSus {
  readonly tiposPrestador: readonly Opcao[];
  readonly instrumentos: readonly Opcao[];
  readonly naturezas: readonly Opcao[];
  readonly servicos: readonly Opcao[];
  readonly servicosSigtap: readonly Opcao[];
  readonly grupos: readonly Opcao[];
  readonly prestadores: readonly Opcao[];
  readonly setores: readonly Opcao[];
  readonly locais: readonly Opcao[];
}

const MSG_GERAL = {
  campo: 'geral',
  mensagem:
    'A regra geral vale para todos os estabelecimentos do cliente: criar ou encerrar uma pede a permissão de administração do cliente (faturamento.regraPrestadorGeral.editar).',
};

const VIGENTE = (a: string) =>
  `(${a}.vigencia_inicio <= CURRENT_DATE AND (${a}.vigencia_fim IS NULL OR ${a}.vigencia_fim >= CURRENT_DATE))`;
const opcao = (r: Linha): Opcao => ({
  id: num(r['id']),
  codigo: txt(r['codigo']),
  descricao: txt(r['descricao']),
});

export class PortaEstabelecimentoSusPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'faturamento.susEstabelecimento');
  }

  /** O cadastro SUS do estabelecimento: habilitações, serviços, regras por tipo de prestador e do serviço automático. */
  listar(c: ContextoPortaPropria): Promise<CadastroSusEstabelecimento> {
    return this.ler(c, 'listar', async (l, est) => {
      const habs = await l.consultar(
        `SELECT he.*, hs.codigo_cnes, hs.descricao, ${VIGENTE('he')} AS vigente
           FROM habilitacao_estabelecimento he JOIN habilitacao_sus hs ON hs.id = he.habilitacao_sus_id
          WHERE he.estabelecimento_id = ? AND he.excluido_em IS NULL
          ORDER BY vigente DESC, hs.codigo_cnes, he.vigencia_inicio DESC LIMIT 1000`,
        [est.id],
      );
      const servs = await l.consultar(
        `SELECT se.*, sc.codigo_servico_cnes, sc.codigo_classificacao_cnes, sc.descricao_servico, sc.descricao,
                ee.nome AS prestador_nome, ${VIGENTE('se')} AS vigente
           FROM servico_classificacao_estabelecimento se
           JOIN servico_classificacao sc ON sc.id = se.servico_classificacao_id
           LEFT JOIN estabelecimento_externo ee ON ee.id = se.estabelecimento_externo_id
          WHERE se.estabelecimento_id = ? AND se.excluido_em IS NULL AND se.ativo
          ORDER BY vigente DESC, sc.codigo_servico_cnes, sc.codigo_classificacao_cnes LIMIT 1000`,
        [est.id],
      );
      const regras = await l.consultar(
        `SELECT r.*, tp.descricao AS tipo_desc, nj.descricao AS natureza_desc, ps.codigo_sigtap AS proc_cod,
                g.codigo_sigtap AS grupo_cod, CONCAT(scs.codigo_sigtap_servico, '/', scs.codigo_sigtap_classificacao) AS serv_cod,
                ins.descricao AS instr_desc, ${VIGENTE('r')} AS vigente
           FROM regra_prestador_sus r
           JOIN dominio_sigtap tp ON tp.id = r.tipo_prestador_dominio_sigtap_id
           LEFT JOIN natureza_juridica nj ON nj.id = r.natureza_juridica_id
           LEFT JOIN procedimento_sigtap ps ON ps.id = r.procedimento_sigtap_id
           LEFT JOIN grupo_sigtap g ON g.id = r.grupo_sigtap_id
           LEFT JOIN servico_classificacao_sigtap scs ON scs.id = r.servico_classificacao_sigtap_id
           LEFT JOIN dominio_sigtap ins ON ins.id = r.instrumento_dominio_sigtap_id
          WHERE r.estabelecimento_id = ? OR r.estabelecimento_id IS NULL
          ORDER BY vigente DESC, r.vigencia_inicio DESC, r.id DESC LIMIT 1000`,
        [est.id],
      );
      const automaticas = await l.consultar(
        `SELECT r.*, CONCAT(scs.codigo_sigtap_servico, '/', scs.codigo_sigtap_classificacao) AS serv_cod,
                ps.codigo_sigtap AS proc_cod, g.codigo_sigtap AS grupo_cod, sf.nome AS setor_nome, la.descricao AS local_desc
           FROM regra_servico_classificacao_sus r
           JOIN servico_classificacao_sigtap scs ON scs.id = r.servico_classificacao_sigtap_id
           LEFT JOIN procedimento_sigtap ps ON ps.id = r.procedimento_sigtap_id
           LEFT JOIN grupo_sigtap g ON g.id = r.grupo_sigtap_id
           LEFT JOIN setor_funcional sf ON sf.id = r.setor_funcional_id
           LEFT JOIN local_atendimento la ON la.id = r.local_atendimento_id
          WHERE r.estabelecimento_id = ?
          ORDER BY r.ativo DESC, r.prioridade, r.id LIMIT 1000`,
        [est.id],
      );
      return {
        habilitacoes: habs.map((r) => ({
          id: num(r['id']),
          codigo: txt(r['codigo_cnes']),
          descricao: txt(r['descricao']),
          numeroPortaria: txtOuNull(r['numero_portaria']),
          dataPortaria: dataIso(r['data_portaria']),
          vigenciaInicio: dataIso(r['vigencia_inicio'])!,
          vigenciaFim: dataIso(r['vigencia_fim']),
          leitosHabilitados: numOuNull(r['leitos_habilitados']),
          observacao: txtOuNull(r['observacao']),
          vigente: bool(r['vigente']),
          versao: num(r['versao']),
        })),
        servicos: servs.map((r) => ({
          id: num(r['id']),
          servicoClassificacao: num(r['servico_classificacao_id']),
          codigo: `${txt(r['codigo_servico_cnes'])}/${txt(r['codigo_classificacao_cnes'])}`,
          descricao: `${txt(r['descricao_servico'])}: ${txt(r['descricao'])}`,
          caracteristica: txt(r['caracteristica']),
          prestadorExterno: numOuNull(r['estabelecimento_externo_id']),
          prestadorNome: txtOuNull(r['prestador_nome']),
          vigenciaInicio: dataIso(r['vigencia_inicio'])!,
          vigenciaFim: dataIso(r['vigencia_fim']),
          vigente: bool(r['vigente']),
          versao: num(r['versao']),
        })),
        regrasPrestador: regras.map((r) => ({
          id: num(r['id']),
          geral: r['estabelecimento_id'] === null,
          tipoPrestador: txt(r['tipo_desc']),
          naturezaJuridica: txtOuNull(r['natureza_desc']),
          procedimento: txtOuNull(r['proc_cod']),
          grupo: txtOuNull(r['grupo_cod']),
          servicoClassificacao: txtOuNull(r['serv_cod']),
          instrumento: txtOuNull(r['instr_desc']),
          permitido: bool(r['permitido']),
          vigenciaInicio: dataIso(r['vigencia_inicio'])!,
          vigenciaFim: dataIso(r['vigencia_fim']),
          vigente: bool(r['vigente']),
          versao: num(r['versao']),
        })),
        regrasServico: automaticas.map((r) => ({
          id: num(r['id']),
          servicoClassificacao: txt(r['serv_cod']),
          procedimento: txtOuNull(r['proc_cod']),
          grupo: txtOuNull(r['grupo_cod']),
          setor: txtOuNull(r['setor_nome']),
          local: txtOuNull(r['local_desc']),
          urgencia: bool(r['urgencia']),
          prioridade: num(r['prioridade']),
          ativo: bool(r['ativo']),
          versao: num(r['versao']),
        })),
      };
    });
  }

  /** As habilitações cadastradas (código e vigência), para a crítica da competência no lugar do parâmetro de texto. */
  habilitacoesCadastradas(c: ContextoPortaPropria): Promise<HabilitacaoEstabelecimentoVigencia[]> {
    return this.ler(c, 'habilitacoes', async (l, est) =>
      (
        await l.consultar(
          `SELECT he.id, hs.codigo_cnes, he.vigencia_inicio, he.vigencia_fim
             FROM habilitacao_estabelecimento he JOIN habilitacao_sus hs ON hs.id = he.habilitacao_sus_id
            WHERE he.estabelecimento_id = ? AND he.excluido_em IS NULL LIMIT 2000`,
          [est.id],
        )
      ).map((r) => ({
        id: num(r['id']),
        codigo: txt(r['codigo_cnes']),
        vigenciaInicio: dataIso(r['vigencia_inicio'])!,
        vigenciaFim: dataIso(r['vigencia_fim']),
      })),
    );
  }

  /**
   * As regras que a crítica do BPA, da APAC e da AIH aplica (06-SUS linha 61): as por tipo de prestador do estabelecimento
   * e as gerais, as do serviço automático, os grupos SIGTAP com o código e os instrumentos de registro pelo código
   * oficial; o tipo de prestador do estabelecimento sai do código do parâmetro e a natureza jurídica, do cadastro.
   */
  regrasDaCritica(c: ContextoPortaPropria, codigoTipoPrestador: string): Promise<RegrasDaCriticaSus> {
    return this.ler(c, 'regras-critica', async (l, est) => {
      const tipo = codigoTipoPrestador.trim()
        ? await l.consultar(
            "SELECT id FROM dominio_sigtap WHERE lista = 'tipo_prestador' AND codigo_sigtap = ? ORDER BY id DESC LIMIT 1",
            [codigoTipoPrestador.trim()],
          )
        : [];
      const natureza = await l.consultar('SELECT natureza_juridica_id FROM estabelecimento WHERE id = ?', [
        est.id,
      ]);
      const prestador = await l.consultar(
        `SELECT id, estabelecimento_id, tipo_prestador_dominio_sigtap_id, natureza_juridica_id, procedimento_sigtap_id,
                grupo_sigtap_id, servico_classificacao_sigtap_id, instrumento_dominio_sigtap_id, permitido,
                vigencia_inicio, vigencia_fim
           FROM regra_prestador_sus
          WHERE estabelecimento_id = ? OR estabelecimento_id IS NULL LIMIT 5000`,
        [est.id],
      );
      const servico = await l.consultar(
        `SELECT id, servico_classificacao_sigtap_id, procedimento_sigtap_id, grupo_sigtap_id, setor_funcional_id,
                local_atendimento_id, urgencia, prioridade, ativo
           FROM regra_servico_classificacao_sus WHERE estabelecimento_id = ? LIMIT 5000`,
        [est.id],
      );
      const grupos = await l.consultar(
        `SELECT g.id, g.codigo_sigtap FROM grupo_sigtap g
          WHERE g.id IN (SELECT grupo_sigtap_id FROM regra_prestador_sus
                          WHERE grupo_sigtap_id IS NOT NULL AND (estabelecimento_id = ? OR estabelecimento_id IS NULL))
             OR g.id IN (SELECT grupo_sigtap_id FROM regra_servico_classificacao_sus
                          WHERE grupo_sigtap_id IS NOT NULL AND estabelecimento_id = ?)`,
        [est.id, est.id],
      );
      const instrumentos = await l.consultar(
        "SELECT id, codigo_sigtap FROM dominio_sigtap WHERE lista = 'instrumento_registro' ORDER BY id",
      );
      return {
        estabelecimento: est.id,
        tipoPrestador: tipo[0] ? num(tipo[0]['id']) : null,
        naturezaJuridica: natureza[0] ? numOuNull(natureza[0]['natureza_juridica_id']) : null,
        prestador: prestador.map((r) => ({
          id: num(r['id']),
          estabelecimento: numOuNull(r['estabelecimento_id']),
          tipoPrestador: num(r['tipo_prestador_dominio_sigtap_id']),
          naturezaJuridica: numOuNull(r['natureza_juridica_id']),
          procedimento: numOuNull(r['procedimento_sigtap_id']),
          grupo: numOuNull(r['grupo_sigtap_id']),
          servicoClassificacao: numOuNull(r['servico_classificacao_sigtap_id']),
          instrumento: numOuNull(r['instrumento_dominio_sigtap_id']),
          permitido: bool(r['permitido']),
          vigenciaInicio: dataIso(r['vigencia_inicio'])!,
          vigenciaFim: dataIso(r['vigencia_fim']),
        })),
        servico: servico.map((r) => ({
          id: num(r['id']),
          servicoClassificacao: num(r['servico_classificacao_sigtap_id']),
          procedimento: numOuNull(r['procedimento_sigtap_id']),
          grupo: numOuNull(r['grupo_sigtap_id']),
          setor: numOuNull(r['setor_funcional_id']),
          local: numOuNull(r['local_atendimento_id']),
          urgencia: bool(r['urgencia']),
          prioridade: num(r['prioridade']),
          ativo: bool(r['ativo']),
        })),
        grupos: grupos.map((r) => ({ id: num(r['id']), codigo: txt(r['codigo_sigtap']) })),
        instrumentos: Object.fromEntries(instrumentos.map((r) => [txt(r['codigo_sigtap']), num(r['id'])])),
      };
    });
  }

  /** As listas do formulário (catálogos oficiais vigentes e cadastros do estabelecimento). */
  opcoes(c: ContextoPortaPropria): Promise<OpcoesCadastroSus> {
    return this.ler(c, 'opcoes', async (l, est) => {
      const dominio = async (lista: string) =>
        (
          await l.consultar(
            `SELECT id, codigo_sigtap AS codigo, descricao FROM dominio_sigtap d
              WHERE lista = ? AND ${VIGENTE('d')} ORDER BY codigo_sigtap LIMIT 200`,
            [lista],
          )
        ).map(opcao);
      return {
        tiposPrestador: await dominio('tipo_prestador'),
        instrumentos: await dominio('instrumento_registro'),
        naturezas: (
          await l.consultar(
            `SELECT id, codigo_concla AS codigo, descricao FROM natureza_juridica WHERE ativo ORDER BY codigo_concla LIMIT 500`,
          )
        ).map(opcao),
        servicos: (
          await l.consultar(
            `SELECT id, CONCAT(codigo_servico_cnes, '/', codigo_classificacao_cnes) AS codigo,
                    CONCAT(descricao_servico, ': ', descricao) AS descricao
               FROM servico_classificacao ORDER BY codigo_servico_cnes, codigo_classificacao_cnes LIMIT 2000`,
          )
        ).map(opcao),
        servicosSigtap: (
          await l.consultar(
            `SELECT id, CONCAT(codigo_sigtap_servico, '/', codigo_sigtap_classificacao) AS codigo,
                    CONCAT(descricao_servico, ': ', descricao) AS descricao
               FROM servico_classificacao_sigtap s WHERE ${VIGENTE('s')}
              ORDER BY codigo_sigtap_servico, codigo_sigtap_classificacao LIMIT 2000`,
          )
        ).map(opcao),
        grupos: (
          await l.consultar(
            `SELECT id, codigo_sigtap AS codigo, descricao FROM grupo_sigtap g
              WHERE ${VIGENTE('g')} AND CHAR_LENGTH(codigo_sigtap) <= 4 ORDER BY codigo_sigtap LIMIT 500`,
          )
        ).map(opcao),
        prestadores: (
          await l.consultar(
            `SELECT id, COALESCE(codigo_cnes, '') AS codigo, nome AS descricao FROM estabelecimento_externo
              ORDER BY nome LIMIT 1000`,
          )
        ).map(opcao),
        setores: (
          await l.consultar(
            `SELECT id, codigo, nome AS descricao FROM setor_funcional WHERE estabelecimento_id = ?
              ORDER BY nome LIMIT 1000`,
            [est.id],
          )
        ).map(opcao),
        locais: (
          await l.consultar(
            `SELECT id, codigo, descricao FROM local_atendimento WHERE estabelecimento_id = ? ORDER BY descricao LIMIT 1000`,
            [est.id],
          )
        ).map(opcao),
      };
    });
  }

  async incluirHabilitacao(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaHabilitacao, entrada);
    return this.gravar(c, 'faturamento.sus.habest.incluir', TABELAS, async (tx, est) => {
      const id = await this.gravarHabilitacao(tx, est.id, e);
      return { tabela: 'habilitacao_estabelecimento', id };
    });
  }

  /** Resolve a habilitação no catálogo (trazendo-a da tabela unificada quando falta), confere e grava. */
  private async gravarHabilitacao(
    tx: TxOperacao,
    est: number,
    e: z.infer<typeof esquemaHabilitacao>,
  ): Promise<number> {
    if (!/^\d{1,6}$/.test(e.codigo))
      throw recusaRegra('Habilitação recusada', [
        { campo: 'codigo', mensagem: 'O código tem de 1 a 6 dígitos.' },
      ]);
    const cod = Number(e.codigo);
    let cat = await tx.uma(
      'SELECT id, exige_leitos FROM habilitacao_sus WHERE CAST(codigo_cnes AS UNSIGNED) = ? ORDER BY id LIMIT 1',
      [cod],
    );
    if (!cat) {
      const oficial = await tx.uma(
        `SELECT codigo_habilitacao, descricao, versao_fonte FROM habilitacao_sigtap
          WHERE tipo = 'habilitacao' AND CAST(codigo_habilitacao AS UNSIGNED) = ?
          ORDER BY vigencia_inicio DESC LIMIT 1`,
        [cod],
      );
      if (!oficial)
        throw recusaRegra('Habilitação recusada', [
          { campo: 'codigo', mensagem: `A habilitação ${e.codigo} não está na tabela oficial carregada.` },
        ]);
      const novo = await tx.incluir('habilitacao_sus', {
        codigo_cnes: txt(oficial['codigo_habilitacao']),
        descricao: txt(oficial['descricao']),
        exige_leitos: false,
        versao_fonte: txtOuNull(oficial['versao_fonte']),
      });
      cat = { id: novo, exige_leitos: false };
    }
    const existentes = (
      await tx.consultarParaAtualizar<Linha>(
        `SELECT id, vigencia_inicio, vigencia_fim FROM habilitacao_estabelecimento
          WHERE estabelecimento_id = ? AND habilitacao_sus_id = ? AND excluido_em IS NULL`,
        [est, num(cat['id'])],
      )
    ).map((r) => ({
      id: num(r['id']),
      codigo: e.codigo,
      vigenciaInicio: dataIso(r['vigencia_inicio'])!,
      vigenciaFim: dataIso(r['vigencia_fim']),
    }));
    const p = conferirHabilitacaoEstabelecimento(
      { ...e, exigeLeitos: bool(cat['exige_leitos']) },
      existentes,
    );
    if (p.length) throw recusaRegra('Habilitação recusada', p);
    return tx.incluir('habilitacao_estabelecimento', {
      estabelecimento_id: est,
      habilitacao_sus_id: num(cat['id']),
      numero_portaria: e.numeroPortaria,
      data_portaria: e.dataPortaria,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
      leitos_habilitados: e.leitosHabilitados,
      observacao: e.observacao,
    });
  }

  /** Encerra a habilitação no último dia da competência dada (com a versão lida; nada apagado). */
  async encerrarHabilitacao(
    c: ContextoPortaPropria,
    alvo: number,
    entrada: unknown,
  ): Promise<{ id: number }> {
    const e = entradaValida(esquemaEncerrar, entrada);
    return this.gravar(c, 'faturamento.sus.habest.encerrar', TABELAS, async (tx, est) => {
      const atual = await tx.uma(
        `SELECT vigencia_inicio, vigencia_fim FROM habilitacao_estabelecimento
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [alvo, est.id],
      );
      if (!atual) throw naoEncontrado('Habilitação do estabelecimento');
      this.conferirFim(dataIso(atual['vigencia_inicio'])!, dataIso(atual['vigencia_fim']), e.vigenciaFim);
      await tx.alterar('habilitacao_estabelecimento', alvo, e.versao, { vigencia_fim: e.vigenciaFim });
      return { tabela: 'habilitacao_estabelecimento', id: alvo };
    });
  }

  private conferirFim(inicio: string, fimAtual: string | null, fim: string): void {
    const p = [];
    if (fim !== fimDoMesSus(fim))
      p.push({ campo: 'vigenciaFim', mensagem: 'A vigência termina no último dia da competência.' });
    if (fim < inicio) p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência é anterior ao início.' });
    if (fimAtual !== null && fim > fimAtual)
      p.push({ campo: 'vigenciaFim', mensagem: 'Já encerrada antes: inclua uma nova vigência.' });
    if (p.length) throw recusaRegra('Encerramento recusado', p);
  }

  /** Concilia com a lista do cadastro nacional da competência; sem `aplicar`, devolve só a prévia. */
  async conciliarCnes(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<ConciliacaoCnes & { aplicada: boolean }> {
    const e = entradaValida(esquemaConciliacao, entrada);
    if (!diasDaCompetenciaSus(e.competencia))
      throw recusaRegra('Conciliação recusada', [
        { campo: 'competencia', mensagem: 'Competência inválida.' },
      ]);
    if (!e.aplicar) {
      const atuais = await this.habilitacoesCadastradas(c);
      return {
        ...conciliarHabilitacoesCnes(
          atuais.map((a) => ({ ...a, id: a.id ?? 0 })),
          e.habilitacoes,
          e.competencia,
        ),
        aplicada: false,
      };
    }
    return this.gravar(c, 'faturamento.sus.habest.conciliar', TABELAS, async (tx, est) => {
      const atuais = (
        await tx.consultarParaAtualizar<Linha>(
          `SELECT he.id, he.versao, hs.codigo_cnes, he.vigencia_inicio, he.vigencia_fim
             FROM habilitacao_estabelecimento he JOIN habilitacao_sus hs ON hs.id = he.habilitacao_sus_id
            WHERE he.estabelecimento_id = ? AND he.excluido_em IS NULL`,
          [est.id],
        )
      ).map((r) => ({
        id: num(r['id']),
        versao: num(r['versao']),
        codigo: txt(r['codigo_cnes']),
        vigenciaInicio: dataIso(r['vigencia_inicio'])!,
        vigenciaFim: dataIso(r['vigencia_fim']),
      }));
      const plano = conciliarHabilitacoesCnes(atuais, e.habilitacoes, e.competencia);
      for (const x of plano.encerrar) {
        const a = atuais.find((y) => y.id === x.id)!;
        await tx.alterar('habilitacao_estabelecimento', a.id, a.versao, { vigencia_fim: x.vigenciaFim });
      }
      let ultimo: number | null = null;
      for (const x of plano.incluir)
        ultimo = await this.gravarHabilitacao(tx, est.id, {
          codigo: normalHabilitacao(x.codigo).padStart(4, '0'),
          numeroPortaria: x.numeroPortaria ?? null,
          dataPortaria: x.dataPortaria ?? null,
          vigenciaInicio: x.vigenciaInicio,
          vigenciaFim: x.vigenciaFim,
          leitosHabilitados: x.leitosHabilitados ?? null,
          observacao: `Conciliação com o cadastro nacional, competência ${e.competencia}`,
        });
      return { tabela: 'habilitacao_estabelecimento', id: ultimo, ...plano, aplicada: true };
    });
  }

  async incluirServico(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaServico, entrada);
    return this.gravar(c, 'faturamento.sus.servest.incluir', TABELAS, async (tx, est) => {
      if (!(await tx.uma('SELECT id FROM servico_classificacao WHERE id = ?', [e.servicoClassificacao])))
        throw naoEncontrado('Serviço e classificação');
      if (
        e.prestadorExterno !== null &&
        !(await tx.uma('SELECT id FROM estabelecimento_externo WHERE id = ?', [e.prestadorExterno]))
      )
        throw naoEncontrado('Prestador externo');
      const existentes = (
        await tx.consultarParaAtualizar<Linha>(
          `SELECT id, servico_classificacao_id, vigencia_inicio, vigencia_fim, ativo
             FROM servico_classificacao_estabelecimento
            WHERE estabelecimento_id = ? AND servico_classificacao_id = ? AND excluido_em IS NULL`,
          [est.id, e.servicoClassificacao],
        )
      ).map((r) => ({
        id: num(r['id']),
        servicoClassificacao: num(r['servico_classificacao_id']),
        vigenciaInicio: dataIso(r['vigencia_inicio'])!,
        vigenciaFim: dataIso(r['vigencia_fim']),
        ativo: bool(r['ativo']),
      }));
      const p = conferirServicoEstabelecimento(e, existentes);
      if (p.length) throw recusaRegra('Serviço recusado', p);
      const id = await tx.incluir('servico_classificacao_estabelecimento', {
        estabelecimento_id: est.id,
        servico_classificacao_id: e.servicoClassificacao,
        caracteristica: e.caracteristica,
        estabelecimento_externo_id: e.prestadorExterno,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        ativo: true,
      });
      return { tabela: 'servico_classificacao_estabelecimento', id };
    });
  }

  async encerrarServico(c: ContextoPortaPropria, alvo: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaEncerrar, entrada);
    return this.gravar(c, 'faturamento.sus.servest.encerrar', TABELAS, async (tx, est) => {
      const atual = await tx.uma(
        `SELECT vigencia_inicio, vigencia_fim FROM servico_classificacao_estabelecimento
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [alvo, est.id],
      );
      if (!atual) throw naoEncontrado('Serviço do estabelecimento');
      this.conferirFim(dataIso(atual['vigencia_inicio'])!, dataIso(atual['vigencia_fim']), e.vigenciaFim);
      await tx.alterar('servico_classificacao_estabelecimento', alvo, e.versao, {
        vigencia_fim: e.vigenciaFim,
      });
      return { tabela: 'servico_classificacao_estabelecimento', id: alvo };
    });
  }

  private async procedimento(tx: TxOperacao, codigo: string | null): Promise<number | null> {
    if (codigo === null) return null;
    const p = await tx.uma(
      'SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ? ORDER BY vigencia_inicio DESC LIMIT 1',
      [codigo],
    );
    if (!p) throw naoEncontrado('Procedimento da tabela unificada');
    return num(p['id']);
  }

  /**
   * Inclui a regra por tipo de prestador. A regra geral (sem estabelecimento) vale para todos os estabelecimentos do
   * cliente: só com `podeGeral` (a permissão `faturamento.regraPrestadorGeral.editar`, conferida no controller).
   */
  async incluirRegraPrestador(
    c: ContextoPortaPropria,
    entrada: unknown,
    podeGeral = false,
  ): Promise<{ id: number }> {
    const e = entradaValida(esquemaRegraPrestador, entrada);
    if (e.geral && !podeGeral) throw recusaRegra('Regra recusada', [MSG_GERAL]);
    return this.gravar(c, 'faturamento.sus.regraprest.incluir', TABELAS, async (tx, est) => {
      const tipo = await tx.uma("SELECT id FROM dominio_sigtap WHERE id = ? AND lista = 'tipo_prestador'", [
        e.tipoPrestador,
      ]);
      if (!tipo) throw naoEncontrado('Tipo de prestador');
      if (
        e.instrumento !== null &&
        !(await tx.uma("SELECT id FROM dominio_sigtap WHERE id = ? AND lista = 'instrumento_registro'", [
          e.instrumento,
        ]))
      )
        throw naoEncontrado('Instrumento de registro');
      const procedimento = await this.procedimento(tx, e.procedimentoCodigo);
      const p = conferirRegraPrestador({ ...e, procedimento });
      if (p.length) throw recusaRegra('Regra recusada', p);
      const id = await tx.incluir('regra_prestador_sus', {
        estabelecimento_id: e.geral ? null : est.id,
        tipo_prestador_dominio_sigtap_id: e.tipoPrestador,
        natureza_juridica_id: e.naturezaJuridica,
        procedimento_sigtap_id: procedimento,
        grupo_sigtap_id: e.grupo,
        servico_classificacao_sigtap_id: e.servicoClassificacao,
        instrumento_dominio_sigtap_id: e.instrumento,
        permitido: e.permitido,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
      });
      return { tabela: 'regra_prestador_sus', id };
    });
  }

  async encerrarRegraPrestador(
    c: ContextoPortaPropria,
    alvo: number,
    entrada: unknown,
    podeGeral = false,
  ): Promise<{ id: number }> {
    const e = entradaValida(esquemaEncerrar, entrada);
    return this.gravar(c, 'faturamento.sus.regraprest.encerrar', TABELAS, async (tx, est) => {
      const atual = await tx.uma(
        `SELECT vigencia_inicio, vigencia_fim, estabelecimento_id FROM regra_prestador_sus
          WHERE id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)`,
        [alvo, est.id],
      );
      if (!atual) throw naoEncontrado('Regra por tipo de prestador');
      if (atual['estabelecimento_id'] === null && !podeGeral)
        throw recusaRegra('Regra recusada', [MSG_GERAL]);
      this.conferirFim(dataIso(atual['vigencia_inicio'])!, dataIso(atual['vigencia_fim']), e.vigenciaFim);
      await tx.alterar('regra_prestador_sus', alvo, e.versao, { vigencia_fim: e.vigenciaFim });
      return { tabela: 'regra_prestador_sus', id: alvo };
    });
  }

  async incluirRegraServico(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaRegraServico, entrada);
    return this.gravar(c, 'faturamento.sus.regraserv.incluir', TABELAS, async (tx, est) => {
      if (
        !(await tx.uma('SELECT id FROM servico_classificacao_sigtap WHERE id = ?', [e.servicoClassificacao]))
      )
        throw naoEncontrado('Serviço e classificação da tabela unificada');
      if (
        e.setor !== null &&
        !(await tx.uma('SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ?', [
          e.setor,
          est.id,
        ]))
      )
        throw naoEncontrado('Setor');
      if (
        e.local !== null &&
        !(await tx.uma('SELECT id FROM local_atendimento WHERE id = ? AND estabelecimento_id = ?', [
          e.local,
          est.id,
        ]))
      )
        throw naoEncontrado('Local de atendimento');
      const procedimento = await this.procedimento(tx, e.procedimentoCodigo);
      const p = conferirRegraServicoClassificacao({ ...e, procedimento });
      if (p.length) throw recusaRegra('Regra recusada', p);
      const id = await tx.incluir('regra_servico_classificacao_sus', {
        estabelecimento_id: est.id,
        servico_classificacao_sigtap_id: e.servicoClassificacao,
        procedimento_sigtap_id: procedimento,
        grupo_sigtap_id: e.grupo,
        setor_funcional_id: e.setor,
        local_atendimento_id: e.local,
        urgencia: e.urgencia,
        prioridade: e.prioridade,
        ativo: true,
      });
      return { tabela: 'regra_servico_classificacao_sus', id };
    });
  }

  async inativarRegraServico(
    c: ContextoPortaPropria,
    alvo: number,
    entrada: unknown,
  ): Promise<{ id: number }> {
    const e = entradaValida(esquemaVersao, entrada);
    return this.gravar(c, 'faturamento.sus.regraserv.inativar', TABELAS, async (tx, est) => {
      const atual = await tx.uma(
        'SELECT ativo FROM regra_servico_classificacao_sus WHERE id = ? AND estabelecimento_id = ?',
        [alvo, est.id],
      );
      if (!atual) throw naoEncontrado('Regra do serviço automático');
      if (!bool(atual['ativo']))
        throw recusaRegra('Regra recusada', [{ campo: 'ativo', mensagem: 'A regra já está inativa.' }]);
      await tx.alterar('regra_servico_classificacao_sus', alvo, e.versao, { ativo: false });
      return { tabela: 'regra_servico_classificacao_sus', id: alvo };
    });
  }
}
