// Laudos específicos e sessões da APAC no banco do cliente (F7, 06-SUS linha 56). As regras são as puras de
// @sgh/dominio-faturamento (apac-laudos-especificos.ts); aqui ficam a leitura e a gravação. A APAC da tela é o laudo
// (laudo_apac); a versão vista é a do laudo, que sobe a cada gravação.
// Contrato de efeito:
//   - gravar o laudo complementar: uma linha em laudo_apac_oncologia, _auditiva, _medicamento ou _odontologia (a
//     não excluída de maior sequência é alterada; sem ela, entra na sequência seguinte) e o tipo do laudo passa à
//     família do complemento (catálogo tipo_laudo_apac; sem o tipo, recusa catalogo-incompleto sem gravar);
//   - retirar o complemento: a linha fica marcada como excluída (registro clínico nunca é apagado) e o laudo volta
//     ao tipo "outro";
//   - registrar a sessão: recusa o procedimento de outra família que a do autorizado e a repetição (mesma data e
//     mesmo procedimento já registrados na autorização); senão, uma linha em apac_sessao, na APAC da competência da sessão (apac, aberta); sem ela, a APAC
//     da competência nasce aberta (inicial na primeira competência da validade, continuidade depois, ligada à
//     anterior), na competência de APAC do estabelecimento (aberta ou criada aberta); competência fechada recusa;
//   - cancelar a sessão: marcada como excluída com a versão vista (nunca apagada), só na APAC ainda aberta.
// A trilha de cada gravação vai pelo executor (mesma transação).
import {
  familiaDoLaudoEspecifico,
  familiaLaudoDoProcedimento,
  LAUDOS_ESPECIFICOS_APAC,
  type ComplementoApac,
  type LaudoAuditivaApac,
  type LaudoEspecificoApac,
  type LaudoMedicamentoApac,
  type LaudoOdontologiaApac,
  type LaudoOncologiaApac,
  laudoEspecificoDaFamilia,
  CAUSAS_AUDITIVAS,
  MARCAS_ODONTOLOGIA,
  problemasDaSessao,
  problemasDoComplemento,
} from '@sgh/dominio-faturamento';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
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

export const PORTA_APAC_COMPLEMENTOS = Symbol('PORTA_APAC_COMPLEMENTOS');

const TABELA_DO_LAUDO = {
  oncologia: 'laudo_apac_oncologia',
  auditiva: 'laudo_apac_auditiva',
  medicamento: 'laudo_apac_medicamento',
  odontologia: 'laudo_apac_odontologia',
} as const satisfies Record<LaudoEspecificoApac, string>;

const TABELAS = [
  'laudo_apac',
  'laudo_apac_oncologia',
  'laudo_apac_auditiva',
  'laudo_apac_medicamento',
  'laudo_apac_odontologia',
  'apac',
  'apac_sessao',
  'competencia_sus',
];

// Uma consulta literal por tabela (o gerador de privilégios lê a tabela no texto).
const SQL_ATUAL: Record<LaudoEspecificoApac, string> = {
  oncologia:
    'SELECT * FROM laudo_apac_oncologia WHERE laudo_apac_id = ? AND excluido_em IS NULL ORDER BY sequencia DESC LIMIT 1',
  auditiva:
    'SELECT * FROM laudo_apac_auditiva WHERE laudo_apac_id = ? AND excluido_em IS NULL ORDER BY sequencia DESC LIMIT 1',
  medicamento: `SELECT m.*, ps.codigo_sigtap AS medicamento_codigo FROM laudo_apac_medicamento m
      JOIN procedimento_sigtap ps ON ps.id = m.procedimento_sigtap_id
     WHERE m.laudo_apac_id = ? AND m.excluido_em IS NULL ORDER BY m.sequencia DESC LIMIT 1`,
  odontologia:
    'SELECT * FROM laudo_apac_odontologia WHERE laudo_apac_id = ? AND excluido_em IS NULL ORDER BY sequencia DESC LIMIT 1',
};
const SQL_PROXIMA: Record<LaudoEspecificoApac, string> = {
  oncologia: 'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM laudo_apac_oncologia WHERE laudo_apac_id = ?',
  auditiva: 'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM laudo_apac_auditiva WHERE laudo_apac_id = ?',
  medicamento:
    'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM laudo_apac_medicamento WHERE laudo_apac_id = ?',
  odontologia:
    'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM laudo_apac_odontologia WHERE laudo_apac_id = ?',
};

type Linha = Record<string, unknown>;
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const boolOuNull = (v: unknown): boolean | null => (v === null || v === undefined ? null : bool(v));
const cid = (c: string | null): string | null => (c ? c.replace('.', '').trim().toUpperCase() : null);
const hojeNo = (fuso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date());

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const diaN = dia.nullable().default(null);
const idN = z.number().int().positive().nullable().default(null);
const textoN = (max: number) => z.string().trim().max(max).nullable().default(null);
const cidN = z
  .string()
  .trim()
  .max(7)
  .nullable()
  .default(null)
  .transform((v) => (v ? v : null));

const esquemaOncologia = z
  .object({
    tipoTratamento: z.enum(['quimioterapia', 'radioterapia']),
    localizacaoPrimaria: idN,
    topografiaCid: idN,
    estadiamentoTnm: textoN(20),
    grauHistopatologico: textoN(10),
    dataDiagnostico: diaN,
    dataIdentificacaoPatologica: diaN,
    linfonodosInvadidos: z.boolean().nullable().default(null),
    metastase: z.boolean().default(false),
    metastaseLocal: idN,
    finalidade: idN,
    esquema: idN,
    areaIrradiada: idN,
    camposInsercao: z.number().int().min(0).max(999).nullable().default(null),
    dataInicioTratamento: diaN,
    continuidadeTratamento: z.boolean().default(false),
    tratamentoAnterior: z.boolean().default(false),
    tipoTratamentoAnterior: idN,
    inicioTratamentoAnterior: diaN,
    fimTratamentoAnterior: diaN,
    observacao: textoN(2000),
  })
  .strict();
const esquemaAuditiva = z
  .object({
    cidCausaBasica: cidN,
    cidCausaAssociada: cidN,
    justificativa: idN,
    dificuldadeAuditiva: z.boolean().default(false),
    ouvidoDireito: z.boolean().default(false),
    ouvidoEsquerdo: z.boolean().default(false),
    evolucao: z.enum(['flutuante', 'estavel', 'progressiva']).nullable().default(null),
    zumbido: z.boolean().default(false),
    tontura: z.boolean().default(false),
    causas: z.array(z.enum(CAUSAS_AUDITIVAS)).max(CAUSAS_AUDITIVAS.length).default([]),
    outrasCausas: textoN(200),
    examesRealizados: textoN(4000),
    aparelhoIndicado: textoN(150),
    acompanhamento: textoN(500),
  })
  .strict();
const quantidade = z.number().min(0).max(99999).nullable().default(null);
const esquemaMedicamento = z
  .object({
    medicamento: z.string().trim().min(10).max(14),
    cidPrincipal: cidN,
    cidSecundario: cidN,
    pesoKg: z.number().nullable().default(null),
    alturaCm: z.number().int().nullable().default(null),
    dosePrescrita: textoN(100),
    quantidades: z.tuple([quantidade, quantidade, quantidade]),
    periodoInicio: diaN,
    periodoFim: diaN,
  })
  .strict();
const esquemaOdontologia = z
  .object({
    anomaliaCraniofacial: z.boolean().default(false),
    descricaoAnomalia: textoN(500),
    marcas: z.array(z.enum(MARCAS_ODONTOLOGIA)).max(MARCAS_ODONTOLOGIA.length).default([]),
    justificativaTrocaAparelho: textoN(500),
    especificacaoDentes: textoN(500),
    quantidadeImplantes: z.number().int().nullable().default(null),
    condicaoBucal: textoN(500),
    tratamentoProposto: textoN(4000),
  })
  .strict();
const ESQUEMA_DO_LAUDO = {
  oncologia: esquemaOncologia,
  auditiva: esquemaAuditiva,
  medicamento: esquemaMedicamento,
  odontologia: esquemaOdontologia,
} as const;
const esquemaVersao = z.object({ versao: z.number().int().positive() }).strict();
const esquemaSessao = z
  .object({
    versao: z.number().int().positive(),
    data: dia,
    procedimento: z.string().trim().max(14).default(''),
    quantidade: z.number().positive().max(9999).default(1),
    comparecimento: z.enum(['compareceu', 'faltou', 'falta_justificada']).default('compareceu'),
    modalidade: z.enum(['hemodialise', 'dpa', 'dpac', 'capd', 'dpi']).nullable().default(null),
    kits: z.number().nullable().default(null),
  })
  .strict();

export function laudoDaRota(t: string): LaudoEspecificoApac {
  if (!(LAUDOS_ESPECIFICOS_APAC as readonly string[]).includes(t)) throw naoEncontrado('Laudo complementar');
  return t as LaudoEspecificoApac;
}

/** As colunas de cada complemento. */
function colunas(c: ComplementoApac, medicamentoId: number | null): Linha {
  switch (c.laudo) {
    case 'oncologia': {
      const o = c.dados;
      return {
        tipo_tratamento: o.tipoTratamento,
        localizacao_primaria_dominio_sus_id: o.localizacaoPrimaria,
        topografia_cid_termo_terminologia_id: o.topografiaCid,
        estadiamento_tnm: o.estadiamentoTnm,
        grau_histopatologico: o.grauHistopatologico,
        data_diagnostico: o.dataDiagnostico,
        data_identificacao_patologica: o.dataIdentificacaoPatologica,
        linfonodos_regionais_invadidos: o.linfonodosInvadidos,
        metastase: o.metastase,
        metastase_local_dominio_sus_id: o.metastaseLocal,
        finalidade_dominio_sus_id: o.finalidade,
        esquema_dominio_sus_id: o.esquema,
        area_irradiada_dominio_sus_id: o.areaIrradiada,
        campos_insercao: o.camposInsercao,
        data_inicio_tratamento: o.dataInicioTratamento,
        continuidade_tratamento: o.continuidadeTratamento,
        tratamento_anterior: o.tratamentoAnterior,
        tratamento_anterior_dominio_sus_id: o.tipoTratamentoAnterior,
        data_inicio_tratamento_anterior: o.inicioTratamentoAnterior,
        data_fim_tratamento_anterior: o.fimTratamentoAnterior,
        observacao: o.observacao,
      };
    }
    case 'auditiva': {
      const o = c.dados;
      const causas: Linha = {};
      for (const k of CAUSAS_AUDITIVAS) causas[k] = o.causas.includes(k);
      return {
        codigo_cid10_causa_basica: cid(o.cidCausaBasica),
        codigo_cid10_causa_associada: cid(o.cidCausaAssociada),
        justificativa_dominio_sus_id: o.justificativa,
        dificuldade_auditiva: o.dificuldadeAuditiva,
        ouvido_direito: o.ouvidoDireito,
        ouvido_esquerdo: o.ouvidoEsquerdo,
        evolucao: o.evolucao,
        zumbido: o.zumbido,
        tontura: o.tontura,
        ...causas,
        outras_causas: o.outrasCausas,
        exames_realizados: o.examesRealizados,
        aparelho_indicado: o.aparelhoIndicado,
        acompanhamento: o.acompanhamento,
      };
    }
    case 'medicamento': {
      const o = c.dados;
      return {
        procedimento_sigtap_id: medicamentoId,
        codigo_cid10_principal: cid(o.cidPrincipal),
        codigo_cid10_secundario: cid(o.cidSecundario),
        peso_kg: o.pesoKg,
        altura_cm: o.alturaCm,
        dose_prescrita: o.dosePrescrita,
        quantidade_mes_1: o.quantidades[0],
        quantidade_mes_2: o.quantidades[1],
        quantidade_mes_3: o.quantidades[2],
        periodo_inicio: o.periodoInicio,
        periodo_fim: o.periodoFim,
      };
    }
    case 'odontologia': {
      const o = c.dados;
      const marcas: Linha = {};
      for (const k of MARCAS_ODONTOLOGIA) marcas[k] = o.marcas.includes(k);
      return {
        anomalia_craniofacial: o.anomaliaCraniofacial,
        descricao_anomalia: o.descricaoAnomalia,
        ...marcas,
        justificativa_troca_aparelho: o.justificativaTrocaAparelho,
        especificacao_dentes: o.especificacaoDentes,
        quantidade_implantes: o.quantidadeImplantes,
        condicao_bucal: o.condicaoBucal,
        tratamento_proposto: o.tratamentoProposto,
      };
    }
  }
}

function dadosDaLinha(l: LaudoEspecificoApac, x: Linha): ComplementoApac['dados'] {
  switch (l) {
    case 'oncologia':
      return {
        tipoTratamento: String(x['tipo_tratamento']) as 'quimioterapia' | 'radioterapia',
        localizacaoPrimaria: numOuNull(x['localizacao_primaria_dominio_sus_id']),
        topografiaCid: numOuNull(x['topografia_cid_termo_terminologia_id']),
        estadiamentoTnm: txtOuNull(x['estadiamento_tnm']),
        grauHistopatologico: txtOuNull(x['grau_histopatologico']),
        dataDiagnostico: dataIso(x['data_diagnostico']),
        dataIdentificacaoPatologica: dataIso(x['data_identificacao_patologica']),
        linfonodosInvadidos: boolOuNull(x['linfonodos_regionais_invadidos']),
        metastase: bool(x['metastase']),
        metastaseLocal: numOuNull(x['metastase_local_dominio_sus_id']),
        finalidade: numOuNull(x['finalidade_dominio_sus_id']),
        esquema: numOuNull(x['esquema_dominio_sus_id']),
        areaIrradiada: numOuNull(x['area_irradiada_dominio_sus_id']),
        camposInsercao: numOuNull(x['campos_insercao']),
        dataInicioTratamento: dataIso(x['data_inicio_tratamento']),
        continuidadeTratamento: bool(x['continuidade_tratamento']),
        tratamentoAnterior: bool(x['tratamento_anterior']),
        tipoTratamentoAnterior: numOuNull(x['tratamento_anterior_dominio_sus_id']),
        inicioTratamentoAnterior: dataIso(x['data_inicio_tratamento_anterior']),
        fimTratamentoAnterior: dataIso(x['data_fim_tratamento_anterior']),
        observacao: txtOuNull(x['observacao']),
      } satisfies LaudoOncologiaApac;
    case 'auditiva':
      return {
        cidCausaBasica: txtOuNull(x['codigo_cid10_causa_basica']),
        cidCausaAssociada: txtOuNull(x['codigo_cid10_causa_associada']),
        justificativa: numOuNull(x['justificativa_dominio_sus_id']),
        dificuldadeAuditiva: bool(x['dificuldade_auditiva']),
        ouvidoDireito: bool(x['ouvido_direito']),
        ouvidoEsquerdo: bool(x['ouvido_esquerdo']),
        evolucao: txtOuNull(x['evolucao']) as LaudoAuditivaApac['evolucao'],
        zumbido: bool(x['zumbido']),
        tontura: bool(x['tontura']),
        causas: CAUSAS_AUDITIVAS.filter((k) => bool(x[k])),
        outrasCausas: txtOuNull(x['outras_causas']),
        examesRealizados: txtOuNull(x['exames_realizados']),
        aparelhoIndicado: txtOuNull(x['aparelho_indicado']),
        acompanhamento: txtOuNull(x['acompanhamento']),
      } satisfies LaudoAuditivaApac;
    case 'medicamento': {
      const q = (k: string) => (x[k] === null || x[k] === undefined ? null : Number(x[k]));
      return {
        medicamento: String(x['medicamento_codigo'] ?? ''),
        cidPrincipal: txtOuNull(x['codigo_cid10_principal']),
        cidSecundario: txtOuNull(x['codigo_cid10_secundario']),
        pesoKg: q('peso_kg'),
        alturaCm: q('altura_cm'),
        dosePrescrita: txtOuNull(x['dose_prescrita']),
        quantidades: [q('quantidade_mes_1'), q('quantidade_mes_2'), q('quantidade_mes_3')],
        periodoInicio: dataIso(x['periodo_inicio']),
        periodoFim: dataIso(x['periodo_fim']),
      } satisfies LaudoMedicamentoApac;
    }
    case 'odontologia':
      return {
        anomaliaCraniofacial: bool(x['anomalia_craniofacial']),
        descricaoAnomalia: txtOuNull(x['descricao_anomalia']),
        marcas: MARCAS_ODONTOLOGIA.filter((k) => bool(x[k])),
        justificativaTrocaAparelho: txtOuNull(x['justificativa_troca_aparelho']),
        especificacaoDentes: txtOuNull(x['especificacao_dentes']),
        quantidadeImplantes: numOuNull(x['quantidade_implantes']),
        condicaoBucal: txtOuNull(x['condicao_bucal']),
        tratamentoProposto: txtOuNull(x['tratamento_proposto']),
      } satisfies LaudoOdontologiaApac;
  }
}

const SQL_APAC = `
  SELECT la.id, la.versao, la.paciente_id, la.atendimento_id, la.codigo_cid10_principal, la.codigo_cid10_secundario,
         la.codigo_cid10_causa_associada, la.solicitado_procedimento_sigtap_id AS sigtap, ps.codigo_sigtap,
         la.data_laudo, aa.id AS autorizacao_id, aa.situacao, aa.numero_apac, aa.validade_inicio, aa.validade_fim,
         aa.data_encerramento, la.solicitante_profissional_id
    FROM laudo_apac la
    JOIN autorizacao_apac aa ON aa.laudo_apac_id = la.id AND aa.excluido_em IS NULL
    JOIN procedimento_sigtap ps ON ps.id = la.solicitado_procedimento_sigtap_id
   WHERE la.id = ? AND la.estabelecimento_id = ? AND la.excluido_em IS NULL`;

const SQL_SESSOES = `
  SELECT s.id, s.sequencia, s.data_sessao, ps.codigo_sigtap, s.quantidade, s.comparecimento, s.modalidade_dialise,
         s.quantidade_kit, s.versao, a.numero_apac, a.tipo_apac, a.situacao AS situacao_apac, c.competencia,
         (SELECT u.login FROM usuario u WHERE u.id = s.criado_por) AS registrada_por
    FROM apac_sessao s
    JOIN apac a ON a.id = s.apac_id
    JOIN competencia_sus c ON c.id = a.competencia_sus_id
    JOIN procedimento_sigtap ps ON ps.id = s.procedimento_sigtap_id
   WHERE a.autorizacao_apac_id = ? AND a.estabelecimento_id = ? AND s.excluido_em IS NULL AND a.excluido_em IS NULL
   ORDER BY s.data_sessao, s.id`;

export interface SessaoApacLida {
  readonly id: number;
  readonly data: string;
  readonly procedimento: string;
  readonly quantidade: number;
  readonly comparecimento: string;
  readonly modalidade: string | null;
  readonly kits: number | null;
  readonly competencia: string;
  readonly tipoApac: string;
  readonly aberta: boolean;
  readonly registradaPor: string | null;
  readonly versao: number;
}

export interface ComplementosApac {
  readonly id: number;
  readonly versao: number;
  readonly situacao: string;
  readonly procedimento: string;
  readonly familia: string;
  /** O laudo complementar que o procedimento exige (null: nenhum; "nefrologia" fica na tela da APAC). */
  readonly exigido: LaudoEspecificoApac | 'nefrologia' | null;
  readonly pendente: boolean;
  readonly validadeInicio: string | null;
  readonly validadeFim: string | null;
  readonly laudos: { readonly [K in LaudoEspecificoApac]: ComplementoApac['dados'] | null };
  readonly sessoes: readonly SessaoApacLida[];
  /** Os valores das listas SUS que o laudo de oncologia e o de saúde auditiva usam. */
  readonly opcoes: Readonly<Record<string, readonly { id: number; codigo: string; descricao: string }[]>>;
}

const LISTAS_DO_LAUDO = [
  'finalidade_tratamento',
  'local_metastase',
  'medicamento_antineoplasico',
  'associacao_quimioterapia',
  'justificativa_auditiva',
];
const MARCAS_LISTAS = LISTAS_DO_LAUDO.map(() => '?').join(', ');

function conflito(): ErroOperacao {
  return new ErroOperacao(
    409,
    'versao-alterada',
    'Registro alterado',
    'A APAC mudou desde que você abriu a tela. Recarregue.',
  );
}

export class PortaApacComplementosPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'faturamento.apacComplementos');
  }

  private async lerTudo(l: Leitor | TxOperacao, est: number, laudo: number): Promise<ComplementosApac> {
    const a = await l.uma(SQL_APAC, [laudo, est]);
    if (!a) throw naoEncontrado('APAC');
    const familia = familiaLaudoDoProcedimento(String(a['codigo_sigtap']));
    const exigido = laudoEspecificoDaFamilia(familia);
    const laudos = {} as Record<LaudoEspecificoApac, ComplementoApac['dados'] | null>;
    for (const t of LAUDOS_ESPECIFICOS_APAC) {
      const x = await l.uma(SQL_ATUAL[t], [laudo]);
      laudos[t] = x ? dadosDaLinha(t, x) : null;
    }
    const sessoes = (await l.consultar(SQL_SESSOES, [num(a['autorizacao_id']), est])).map(
      (s): SessaoApacLida => ({
        id: num(s['id']),
        data: dataIso(s['data_sessao']) ?? '',
        procedimento: String(s['codigo_sigtap']),
        quantidade: Number(s['quantidade']),
        comparecimento: String(s['comparecimento']),
        modalidade: txtOuNull(s['modalidade_dialise']),
        kits: s['quantidade_kit'] === null ? null : Number(s['quantidade_kit']),
        competencia: String(s['competencia']),
        tipoApac: String(s['tipo_apac']),
        aberta: String(s['situacao_apac']) === 'aberta',
        registradaPor: txtOuNull(s['registrada_por']),
        versao: num(s['versao']),
      }),
    );
    const opcoes: Record<string, { id: number; codigo: string; descricao: string }[]> = {};
    for (const lista of LISTAS_DO_LAUDO) opcoes[lista] = [];
    const valores = await l.consultar(
      `SELECT id, lista, codigo, descricao FROM dominio_sus
        WHERE lista IN (${MARCAS_LISTAS}) AND ativo = TRUE ORDER BY lista, descricao`,
      LISTAS_DO_LAUDO,
    );
    for (const v of valores)
      opcoes[String(v['lista'])]?.push({
        id: num(v['id']),
        codigo: String(v['codigo']),
        descricao: String(v['descricao']),
      });
    return {
      id: laudo,
      versao: num(a['versao']),
      situacao: String(a['situacao']),
      procedimento: String(a['codigo_sigtap']),
      familia,
      exigido,
      pendente: exigido !== null && exigido !== 'nefrologia' && laudos[exigido] === null,
      validadeInicio: dataIso(a['validade_inicio']),
      validadeFim: dataIso(a['validade_fim']),
      laudos,
      sessoes,
      opcoes,
    };
  }

  /**
   * C1-051: o setor do atendimento do laudo (pelo laudo ou pela sessão da APAC dele), para a permissão por usuário e
   * setor; null, registro fora do estabelecimento da sessão.
   */
  setor(
    c: ContextoPortaPropria,
    ref: { readonly laudo: number } | { readonly sessao: number },
  ): Promise<{ setor: number | null } | null> {
    return this.ler(c, 'setor', async (l, est) => {
      const x =
        'laudo' in ref
          ? await l.uma(
              `SELECT at.setor_funcional_id FROM laudo_apac la LEFT JOIN atendimento at ON at.id = la.atendimento_id
                WHERE la.id = ? AND la.estabelecimento_id = ? AND la.excluido_em IS NULL`,
              [ref.laudo, est.id],
            )
          : await l.uma(
              `SELECT at.setor_funcional_id FROM apac_sessao s
                 JOIN apac a ON a.id = s.apac_id
                 JOIN autorizacao_apac aa ON aa.id = a.autorizacao_apac_id
                 JOIN laudo_apac la ON la.id = aa.laudo_apac_id
                 LEFT JOIN atendimento at ON at.id = la.atendimento_id
                WHERE s.id = ? AND a.estabelecimento_id = ?`,
              [ref.sessao, est.id],
            );
      if (!x) return null;
      const v = x['setor_funcional_id'];
      return { setor: v === null || v === undefined ? null : Number(v) };
    });
  }

  /** Os laudos complementares e as sessões da APAC (o laudo é o id da tela). */
  complementos(c: ContextoPortaPropria, laudo: number): Promise<ComplementosApac> {
    return this.ler(c, 'ler', (l, est) => this.lerTudo(l, est.id, laudo));
  }

  private async tipoLaudo(tx: TxOperacao, familia: string): Promise<number> {
    const x = await tx.uma(
      'SELECT id FROM tipo_laudo_apac WHERE grupo_laudo = ? AND ativo = TRUE ORDER BY id LIMIT 1',
      [familia],
    );
    if (!x)
      throw new ErroOperacao(
        422,
        'catalogo-incompleto',
        'Catálogo incompleto',
        `O catálogo de tipos de laudo de APAC não tem o tipo da família "${familia}": nada foi gravado.`,
      );
    return num(x['id']);
  }

  /** Grava (inclui ou corrige) o laudo complementar da APAC, na versão vista do laudo. */
  gravarLaudo(c: ContextoPortaPropria, laudo: number, tipo: LaudoEspecificoApac, entrada: unknown) {
    const e = entradaValida(
      z.object({ versao: z.number().int().positive(), dados: ESQUEMA_DO_LAUDO[tipo] }).strict(),
      entrada,
    );
    const complemento = { laudo: tipo, dados: e.dados } as ComplementoApac;
    return this.gravar(c, 'faturamento.sus.apac.laudo', TABELAS, async (tx, est) => {
      const a = (await tx.consultarParaAtualizar(SQL_APAC, [laudo, est.id]))[0];
      if (!a) throw naoEncontrado('APAC');
      if (num(a['versao']) !== e.versao) throw conflito();
      const problemas = problemasDoComplemento(
        {
          situacao: String(a['situacao']) as never,
          procedimento: String(a['codigo_sigtap']),
          dataSolicitacao: dataIso(a['data_laudo']) ?? '',
        },
        complemento,
        hojeNo(est.fuso),
      );
      if (problemas.length) throw recusaRegra('Laudo complementar recusado', problemas);
      let medicamento: number | null = null;
      if (complemento.laudo === 'medicamento') {
        const m = await tx.uma(
          'SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ? ORDER BY id DESC LIMIT 1',
          [complemento.dados.medicamento.replace(/\D/g, '')],
        );
        if (!m)
          throw recusaRegra('Laudo complementar recusado', [
            { campo: 'medicamento', mensagem: 'Medicamento não encontrado na tabela unificada.' },
          ]);
        medicamento = num(m['id']);
      }
      const tabela = TABELA_DO_LAUDO[tipo];
      const campos = colunas(complemento, medicamento);
      const atual = await tx.uma(SQL_ATUAL[tipo], [laudo]);
      let id: number;
      if (atual) {
        id = num(atual['id']);
        await tx.alterar(tabela, id, num(atual['versao']), campos);
      } else {
        const s = await tx.uma(SQL_PROXIMA[tipo], [laudo]);
        id = await tx.incluir(tabela, { laudo_apac_id: laudo, sequencia: num(s?.['s']), ...campos });
      }
      const familia = familiaDoLaudoEspecifico(
        tipo,
        complemento.laudo === 'oncologia' ? complemento.dados.tipoTratamento : undefined,
      );
      const versao = await tx.alterar('laudo_apac', laudo, e.versao, {
        tipo_laudo_apac_id: await this.tipoLaudo(tx, familia),
      });
      return { tabela, id, laudo, versao };
    });
  }

  /** Retira o laudo complementar (marcado como excluído, nunca apagado); o laudo volta ao tipo "outro". */
  retirarLaudo(c: ContextoPortaPropria, laudo: number, tipo: LaudoEspecificoApac, entrada: unknown) {
    const e = entradaValida(esquemaVersao, entrada);
    return this.gravar(c, 'faturamento.sus.apac.laudo-retirar', TABELAS, async (tx, est, usuario) => {
      const a = (await tx.consultarParaAtualizar(SQL_APAC, [laudo, est.id]))[0];
      if (!a) throw naoEncontrado('APAC');
      if (num(a['versao']) !== e.versao) throw conflito();
      const situacao = String(a['situacao']);
      if (situacao !== 'solicitada' && situacao !== 'autorizada')
        throw recusaRegra('Laudo complementar recusado', [
          { campo: 'situacao', mensagem: 'O laudo complementar só muda na APAC solicitada ou autorizada.' },
        ]);
      const atual = await tx.uma(SQL_ATUAL[tipo], [laudo]);
      if (!atual) throw naoEncontrado('Laudo complementar');
      const tabela = TABELA_DO_LAUDO[tipo];
      await tx.alterar(tabela, num(atual['id']), num(atual['versao']), {
        excluido_em: new Date(),
        excluido_por: usuario,
      });
      const versao = await tx.alterar('laudo_apac', laudo, e.versao, {
        tipo_laudo_apac_id: await this.tipoLaudo(tx, 'outro'),
      });
      return { tabela, id: num(atual['id']), laudo, versao };
    });
  }

  /** A APAC aberta da competência da sessão; sem ela, nasce aberta (inicial ou continuidade da anterior). */
  private async apacDaCompetencia(tx: TxOperacao, est: number, a: Linha, data: string): Promise<number> {
    const comp = data.slice(0, 4) + data.slice(5, 7);
    const aberta = await tx.consultarParaAtualizar<Linha>(
      `SELECT x.id, x.situacao FROM apac x JOIN competencia_sus c ON c.id = x.competencia_sus_id
        WHERE x.autorizacao_apac_id = ? AND x.estabelecimento_id = ? AND c.competencia = ? AND x.excluido_em IS NULL
          AND x.situacao <> 'cancelada'`,
      [num(a['autorizacao_id']), est, comp],
    );
    const existente = aberta[0];
    if (existente) {
      if (String(existente['situacao']) !== 'aberta')
        throw recusaRegra('Sessão recusada', [
          { campo: 'data', mensagem: `A APAC da competência ${comp} já foi fechada ou apresentada.` },
        ]);
      return num(existente['id']);
    }
    const comps = await tx.consultarParaAtualizar<Linha>(
      "SELECT id, situacao FROM competencia_sus WHERE estabelecimento_id = ? AND instrumento = 'apac' AND competencia = ?",
      [est, comp],
    );
    let competencia: number;
    const cx = comps[0];
    if (cx) {
      if (!['aberta', 'reaberta'].includes(String(cx['situacao'])))
        throw recusaRegra('Sessão recusada', [
          { campo: 'data', mensagem: `A competência de APAC ${comp} está fechada.` },
        ]);
      competencia = num(cx['id']);
    } else {
      const ultimo = new Date(Date.UTC(Number(comp.slice(0, 4)), Number(comp.slice(4, 6)), 0))
        .toISOString()
        .slice(0, 10);
      competencia = await tx.incluir('competencia_sus', {
        estabelecimento_id: est,
        instrumento: 'apac',
        competencia: comp,
        periodo_inicio: `${data.slice(0, 7)}-01`,
        periodo_fim: ultimo,
        situacao: 'aberta',
        aberta_em: new Date(),
      });
    }
    const anterior = await tx.uma(
      `SELECT x.id FROM apac x JOIN competencia_sus c ON c.id = x.competencia_sus_id
        WHERE x.autorizacao_apac_id = ? AND x.estabelecimento_id = ? AND x.excluido_em IS NULL
          AND x.situacao <> 'cancelada' AND c.competencia < ? ORDER BY c.competencia DESC, x.id DESC LIMIT 1`,
      [num(a['autorizacao_id']), est, comp],
    );
    const inicioValidade = dataIso(a['validade_inicio']) ?? data;
    const fimValidade = dataIso(a['validade_fim']) ?? data;
    const inicioComp = `${data.slice(0, 7)}-01`;
    const fimComp = new Date(Date.UTC(Number(comp.slice(0, 4)), Number(comp.slice(4, 6)), 0))
      .toISOString()
      .slice(0, 10);
    const primeira = inicioValidade.slice(0, 7) === data.slice(0, 7);
    return tx.incluir('apac', {
      estabelecimento_id: est,
      autorizacao_apac_id: num(a['autorizacao_id']),
      competencia_sus_id: competencia,
      numero_apac: String(a['numero_apac']),
      tipo_apac: primeira ? 'inicial' : 'continuidade',
      anterior_apac_id: primeira ? null : numOuNull(anterior?.['id']),
      atendimento_id: numOuNull(a['atendimento_id']),
      data_inicio: inicioValidade > inicioComp ? inicioValidade : inicioComp,
      data_fim: fimValidade < fimComp ? fimValidade : fimComp,
      principal_procedimento_sigtap_id: num(a['sigtap']),
      codigo_cid10_principal: String(a['codigo_cid10_principal']),
      codigo_cid10_secundario: txtOuNull(a['codigo_cid10_secundario']),
      codigo_cid10_causa_associada: txtOuNull(a['codigo_cid10_causa_associada']),
      responsavel_profissional_id: numOuNull(a['solicitante_profissional_id']),
      situacao: 'aberta',
    });
  }

  /** Registra a sessão (diálise, radioterapia, quimioterapia) na APAC da competência da data. */
  registrarSessao(c: ContextoPortaPropria, laudo: number, entrada: unknown) {
    const e = entradaValida(esquemaSessao, entrada);
    return this.gravar(c, 'faturamento.sus.apac.sessao', TABELAS, async (tx, est) => {
      const a = (await tx.consultarParaAtualizar(SQL_APAC, [laudo, est.id]))[0];
      if (!a) throw naoEncontrado('APAC');
      if (num(a['versao']) !== e.versao) throw conflito();
      // As sessões não excluídas da autorização na data (a linha do laudo está travada: o duplo clique espera e cai
      // na repetição).
      const registradas = (
        await tx.consultar<Linha>(
          `SELECT ps.codigo_sigtap FROM apac_sessao s JOIN apac x ON x.id = s.apac_id
             JOIN procedimento_sigtap ps ON ps.id = s.procedimento_sigtap_id
            WHERE x.autorizacao_apac_id = ? AND x.estabelecimento_id = ? AND s.data_sessao = ?
              AND s.excluido_em IS NULL AND x.excluido_em IS NULL AND x.situacao <> 'cancelada'`,
          [num(a['autorizacao_id']), est.id, e.data],
        )
      ).map((r) => ({ data: e.data, procedimento: String(r['codigo_sigtap']) }));
      const problemas = problemasDaSessao(
        {
          situacao: String(a['situacao']) as never,
          procedimento: String(a['codigo_sigtap']),
          dataSolicitacao: dataIso(a['data_laudo']) ?? '',
          validadeInicio: dataIso(a['validade_inicio']),
          validadeFim: dataIso(a['validade_fim']),
          dataEncerramento: dataIso(a['data_encerramento']),
        },
        e,
        hojeNo(est.fuso),
        registradas,
      );
      if (problemas.length) throw recusaRegra('Sessão recusada', problemas);
      let procedimento = num(a['sigtap']);
      if (e.procedimento) {
        const p = await tx.uma(
          'SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ? ORDER BY id DESC LIMIT 1',
          [e.procedimento.replace(/\D/g, '')],
        );
        if (!p)
          throw recusaRegra('Sessão recusada', [
            { campo: 'procedimento', mensagem: 'Procedimento não encontrado na tabela unificada.' },
          ]);
        procedimento = num(p['id']);
      }
      const apac = await this.apacDaCompetencia(tx, est.id, a, e.data);
      const s = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM apac_sessao WHERE apac_id = ?',
        [apac],
      );
      const id = await tx.incluir('apac_sessao', {
        apac_id: apac,
        sequencia: num(s?.['s']),
        data_sessao: e.data,
        procedimento_sigtap_id: procedimento,
        quantidade: e.quantidade,
        comparecimento: e.comparecimento,
        modalidade_dialise: e.modalidade,
        quantidade_kit: e.kits,
        atendimento_id: numOuNull(a['atendimento_id']),
      });
      return { tabela: 'apac_sessao', id, apac };
    });
  }

  /** Cancela a sessão lançada por engano (marcada como excluída), só na APAC da competência ainda aberta. */
  cancelarSessao(c: ContextoPortaPropria, sessao: number, entrada: unknown) {
    const e = entradaValida(esquemaVersao, entrada);
    return this.gravar(c, 'faturamento.sus.apac.sessao-cancela', TABELAS, async (tx, est, usuario) => {
      const [x] = await tx.consultarParaAtualizar(
        `SELECT s.id, s.versao, a.situacao FROM apac_sessao s JOIN apac a ON a.id = s.apac_id
          WHERE s.id = ? AND a.estabelecimento_id = ? AND s.excluido_em IS NULL`,
        [sessao, est.id],
      );
      if (!x) throw naoEncontrado('Sessão');
      if (String(x['situacao']) !== 'aberta')
        throw recusaRegra('Sessão recusada', [
          { campo: 'situacao', mensagem: 'A APAC desta sessão já foi fechada ou apresentada.' },
        ]);
      await tx.alterar('apac_sessao', sessao, e.versao, { excluido_em: new Date(), excluido_por: usuario });
      return { tabela: 'apac_sessao', id: sessao };
    });
  }
}
