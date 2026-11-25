// F3.8, 07-FIN linha 111: a EFD-REINF por evento no banco próprio, pelo executor do @sgh/nucleo (trilha, outbox e
// idempotência na mesma transação). As regras são do @sgh/dominio-financeiro (reinf-eventos.ts): um evento por
// estabelecimento e beneficiário, o processo que suspende a retenção (o do beneficiário vence o geral, só na
// vigência), o retificador com o recibo do original, o R-9000 do aceito que saiu da competência, a transmissão e o
// retorno. Aqui ficam a leitura sob a trava e a gravação nas tabelas do modelo:
//   processo_tributario + suspensao_processo_tributario (tributo e beneficiário, migração 14_FIN/98; o encerramento
//   e a anulação da suspensão, com o motivo, migração 14_FIN/90: a linha nunca é apagada);
//   evento_reinf (o retificador e o R-9000 apontam o original em retificado_evento_reinf_id);
//   evento_reinf_item (sequência 1: o beneficiário, com os valores e o conteúdo conferível; seguintes: os processos);
//   lote_reinf (transmissão ao simulador: nenhum envio externo fora de produção) e retorno_reinf.
// Nada é apagado: o gerado, validado ou rejeitado trocado (ou cujo beneficiário saiu da competência) fica "cancelado".
import { createHash } from 'node:crypto';
import { centavos } from '@sgh/contratos/regras-financeiro';
import {
  conferirAlteracaoProcesso,
  conferirEncerramentoSuspensao,
  conferirProcessoSuspensao,
  conferirRetornoReinf,
  conferirTransmissaoReinf,
  type EventoReinfGravado,
  type EventoReinfPlanejado,
  fimDaSuspensao,
  montarEventosReinf,
  planejarEnvioReinf,
  type ProcessoSuspensao,
  type RecusaFinanceiro,
  type RetencaoServico,
  type SituacaoEventoReinf,
  TRIBUTOS_PROCESSO_REINF,
  xmlEventoReinf,
  xmlExclusaoReinf,
} from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  garantirSequencia,
  type Leitor,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { dataIso, instanteIso, numero, texto } from './vocabulario.js';

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;
const id = z.number().int().positive();
const so = (s: string) => s.replace(/\D/g, '');

function recusar(r: RecusaFinanceiro | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
}
function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
/** Lista de ids ou documentos no resultado da operação (a trilha guarda só escalares). */
const lista = (xs: readonly (number | string)[]): string => xs.join(',');
/** O conteúdo conferível do evento: o igual ao vigente não é reenviado. */
export const hashEventoReinf = (e: EventoReinfPlanejado): string =>
  createHash('sha256').update(JSON.stringify(e)).digest('hex');

// ── Leituras ────────────────────────────────────────────────────────────────────────────────────────────────────

const sim = (v: unknown): boolean => v === true || Number(v) === 1;

/**
 * Os processos com suspensão do estabelecimento (um por suspensão: tributo e, quando houver, beneficiário). O fim da
 * vigência é o que vale para a suspensão (o do processo ou o encerramento dela, o que vier antes); a anulada segue
 * na lista, marcada, e não entra na apuração.
 */
export async function processosSuspensao(
  l: Leitor,
  est: number,
): Promise<
  (ProcessoSuspensao & {
    processo: number;
    situacao: string;
    vara: string | null;
    codigo: string;
    dataDecisao: string | null;
    suspensao: number;
    vigenciaFimProcesso: string | null;
    encerradaEm: string | null;
    anulada: boolean;
    motivoEncerramento: string | null;
  })[]
> {
  const linhas = await l.consultar(
    `SELECT s.id, p.id AS processo, p.tipo, p.numero_processo, p.codigo_vara, p.vigencia_inicio, p.vigencia_fim,
            p.situacao, s.codigo_suspensao, s.indicativo_suspensao, s.tributo, s.beneficiario_documento, s.data_decisao,
            s.id AS suspensao, s.encerrada_em, s.anulada, s.motivo_encerramento
       FROM processo_tributario p JOIN suspensao_processo_tributario s ON s.processo_tributario_id = p.id
      WHERE p.estabelecimento_id = ? AND p.tipo IN ('judicial','administrativo') AND p.excluido_em IS NULL
        AND s.excluido_em IS NULL
      ORDER BY p.numero_processo, s.sequencia`,
    [est],
  );
  return linhas.map((r) => ({
    id: numero(r['processo']),
    processo: numero(r['processo']),
    tipo: texto(r['tipo']) as 'judicial' | 'administrativo',
    numero: texto(r['numero_processo']),
    indicativo: texto(r['indicativo_suspensao']),
    tributo: texto(r['tributo']) as ProcessoSuspensao['tributo'],
    beneficiario: r['beneficiario_documento'] ? texto(r['beneficiario_documento']) : null,
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
    vigenciaFim: fimDaSuspensao(dataIso(r['vigencia_fim']), dataIso(r['encerrada_em'])),
    situacao: texto(r['situacao']),
    vara: r['codigo_vara'] ? texto(r['codigo_vara']) : null,
    codigo: texto(r['codigo_suspensao']),
    dataDecisao: dataIso(r['data_decisao']),
    suspensao: numero(r['suspensao']),
    vigenciaFimProcesso: dataIso(r['vigencia_fim']),
    encerradaEm: dataIso(r['encerrada_em']),
    anulada: sim(r['anulada']),
    motivoEncerramento: r['motivo_encerramento'] ? texto(r['motivo_encerramento']) : null,
  }));
}

/**
 * As retenções da competência por título, com o documento do beneficiário (o CNPJ ou CPF do fornecedor, o CPF do
 * profissional de saúde ou o do colaborador, conforme o credor do título) e o fornecedor. O título cujo credor não
 * tem CPF nem CNPJ no cadastro não cabe em evento nenhum: ele é devolvido em `semDocumento`, para a geração e o
 * painel avisarem (o tributo retido não pode sumir da declaração sem o fiscal saber).
 */
async function retencoesDaCompetencia(
  l: Leitor,
  est: number,
  periodo: string,
): Promise<{ retencoes: RetencaoServico[]; fornecedor: Map<string, number>; semDocumento: number[] }> {
  const linhas = await l.consultar(
    `SELECT t.id, COALESCE(ef.cnpj, ef.cpf, pp.cpf, co.cpf) AS documento, ef.id AS fornecedor, t.numero_documento, t.valor_bruto,
            LOWER(tr.codigo) AS tributo, SUM(r.valor_retido) AS valor
       FROM retencao_titulo r JOIN parcela_pagar p ON p.id = r.parcela_pagar_id
       JOIN titulo_pagar t ON t.id = p.titulo_pagar_id JOIN tributo tr ON tr.id = r.tributo_id
       LEFT JOIN empresa_fornecedora ef ON ef.id = t.empresa_fornecedora_id
       LEFT JOIN profissional pr ON pr.id = t.profissional_id
       LEFT JOIN pessoa_fisica pp ON pp.id = pr.pessoa_fisica_id
       LEFT JOIN colaborador co ON co.id = t.colaborador_id
      WHERE t.estabelecimento_id = ? AND r.competencia = ? AND r.excluido_em IS NULL AND t.excluido_em IS NULL
        AND t.situacao <> 'cancelado' AND r.retencao_dispensada = FALSE
      GROUP BY t.id, documento, fornecedor, t.numero_documento, t.valor_bruto, tributo
      ORDER BY t.id`,
    [est, `${periodo}-01`],
  );
  const porTitulo = new Map<number, { -readonly [K in keyof RetencaoServico]: RetencaoServico[K] }>();
  const fornecedor = new Map<string, number>();
  const semDocumento = new Set<number>();
  for (const r of linhas) {
    const doc = so(r['documento'] == null ? '' : texto(r['documento']));
    if (doc.length !== 11 && doc.length !== 14) {
      semDocumento.add(numero(r['id']));
      continue;
    }
    if (r['fornecedor'] != null) fornecedor.set(doc, numero(r['fornecedor']));
    const tid = numero(r['id']);
    // A apuração é a competência da retenção (o fato gerador do pagamento), não a emissão do documento.
    const x = porTitulo.get(tid) ?? {
      cnpjPrestador: doc,
      documento: tid,
      dataEmissao: `${periodo}-01`,
      valorBruto: numero(r['valor_bruto']),
      inss: 0,
      ir: 0,
      csll: 0,
      pis: 0,
      cofins: 0,
    };
    const t = texto(r['tributo']);
    const v = numero(r['valor']);
    if (t.includes('inss')) x.inss = centavos(x.inss + v);
    else if (t.includes('csll')) x.csll = centavos(x.csll + v);
    else if (t.includes('cofins')) x.cofins = centavos(x.cofins + v);
    else if (t.includes('pis')) x.pis = centavos(x.pis + v);
    else if (t.startsWith('ir')) x.ir = centavos(x.ir + v);
    porTitulo.set(tid, x);
  }
  return {
    retencoes: [...porTitulo.values()],
    fornecedor,
    semDocumento: [...semDocumento].sort((a, b) => a - b),
  };
}

/** Os eventos gravados da competência e do estabelecimento, com o conteúdo conferível do beneficiário. */
async function eventosGravados(
  l: Leitor,
  est: number,
  periodo: string,
  codigos: readonly string[],
): Promise<(EventoReinfGravado & { versao: number })[]> {
  const linhas = await l.consultar(
    `SELECT e.id, e.codigo_evento, e.situacao, e.numero_recibo, e.retificado_evento_reinf_id, e.versao,
            i.beneficiario_documento, JSON_UNQUOTE(JSON_EXTRACT(i.detalhes, '$.hash')) AS hash
       FROM evento_reinf e LEFT JOIN evento_reinf_item i ON i.evento_reinf_id = e.id AND i.sequencia = 1
      WHERE e.estabelecimento_id = ? AND e.competencia = ? AND e.excluido_em IS NULL
        AND e.codigo_evento IN (${codigos.map(() => '?').join(', ')})
      ORDER BY e.id`,
    [est, `${periodo}-01`, ...codigos],
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    evento: texto(r['codigo_evento']),
    beneficiario: texto(r['beneficiario_documento']),
    situacao: texto(r['situacao']) as SituacaoEventoReinf,
    recibo: r['numero_recibo'] ? texto(r['numero_recibo']) : null,
    hash: texto(r['hash']),
    retificadoId: r['retificado_evento_reinf_id'] == null ? null : numero(r['retificado_evento_reinf_id']),
    versao: numero(r['versao']),
  }));
}

/** O painel da competência: eventos com valores, processos, retornos, o lote e os títulos que ficaram de fora. */
export async function painelReinf(l: Leitor, est: number, periodo: string) {
  const eventos = await l.consultar(
    `SELECT e.id, e.codigo_evento, e.acao, e.situacao, e.numero_recibo, e.retificado_evento_reinf_id, e.enviado_em,
            e.processado_em, e.mensagem_retorno, lr.numero AS lote, lr.protocolo,
            i.beneficiario_documento, i.valor_bruto, i.valor_irrf, i.valor_csrf, i.valor_inss, i.valor_suspenso,
            JSON_EXTRACT(i.detalhes, '$.evento.documentos') AS documentos,
            (SELECT COUNT(*) FROM evento_reinf_item x WHERE x.evento_reinf_id = e.id AND x.tipo_item = 'processo_judicial') AS processos,
            (SELECT COUNT(*) FROM retorno_reinf rr WHERE rr.evento_reinf_id = e.id) AS retornos
       FROM evento_reinf e LEFT JOIN evento_reinf_item i ON i.evento_reinf_id = e.id AND i.sequencia = 1
       LEFT JOIN lote_reinf lr ON lr.id = e.lote_reinf_id
      WHERE e.estabelecimento_id = ? AND e.competencia = ? AND e.excluido_em IS NULL
      ORDER BY i.beneficiario_documento, e.id`,
    [est, `${periodo}-01`],
  );
  return {
    periodo,
    eventos: eventos.map((r) => ({
      id: numero(r['id']),
      evento: texto(r['codigo_evento']),
      acao: texto(r['acao']),
      situacao: texto(r['situacao']),
      recibo: r['numero_recibo'] ? texto(r['numero_recibo']) : null,
      retifica: r['retificado_evento_reinf_id'] == null ? null : numero(r['retificado_evento_reinf_id']),
      beneficiario: texto(r['beneficiario_documento']),
      valorBruto: numero(r['valor_bruto']),
      valorRetido: centavos(numero(r['valor_irrf']) + numero(r['valor_csrf']) + numero(r['valor_inss'])),
      valorSuspenso: numero(r['valor_suspenso']),
      documentos: numero(r['documentos']),
      processos: numero(r['processos']),
      retornos: numero(r['retornos']),
      lote: r['lote'] == null ? null : numero(r['lote']),
      protocolo: r['protocolo'] ? texto(r['protocolo']) : null,
      enviadoEm: instanteIso(r['enviado_em']),
      processadoEm: instanteIso(r['processado_em']),
      mensagem: r['mensagem_retorno'] ? texto(r['mensagem_retorno']) : null,
    })),
    processos: await processosSuspensao(l, est),
    // Títulos com retenção na competência cujo credor não tem CPF nem CNPJ: fora de qualquer evento até o cadastro.
    titulosSemDocumento: (await retencoesDaCompetencia(l, est, periodo)).semDocumento,
  };
}

/** O XML do evento gravado (o retificador com o recibo do original; o R-9000 com o recibo do excluído). */
export async function xmlDoEventoReinf(l: Leitor, est: number, evento: number): Promise<string | null> {
  const r = await l.uma(
    `SELECT e.codigo_evento, e.competencia, o.numero_recibo AS recibo_original, o.codigo_evento AS evento_original,
            i.detalhes
       FROM evento_reinf e LEFT JOIN evento_reinf o ON o.id = e.retificado_evento_reinf_id
       LEFT JOIN evento_reinf_item i ON i.evento_reinf_id = e.id AND i.sequencia = 1
      WHERE e.id = ? AND e.estabelecimento_id = ?`,
    [evento, est],
  );
  if (!r) return null;
  const periodo = (dataIso(r['competencia']) ?? '').slice(0, 7);
  if (texto(r['codigo_evento']) === 'R-9000')
    return xmlExclusaoReinf(texto(r['evento_original']), periodo, texto(r['recibo_original']));
  const det = (typeof r['detalhes'] === 'string' ? JSON.parse(r['detalhes']) : r['detalhes']) as {
    evento: EventoReinfPlanejado;
  } | null;
  if (!det?.evento) return null;
  return xmlEventoReinf(det.evento, r['recibo_original'] ? texto(r['recibo_original']) : null);
}

// ── Processo com suspensão ─────────────────────────────────────────────────────────────────────────────────────

export const esquemaProcessoReinf = z
  .object({
    tipo: z.enum(['judicial', 'administrativo']),
    numero: z.string().trim().min(1).max(25),
    vara: z.string().trim().max(4).nullable().optional(),
    indicativo: z.string().trim().length(2),
    tributo: z.enum(TRIBUTOS_PROCESSO_REINF),
    beneficiario: z.string().trim().max(18).nullable(),
    vigenciaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    vigenciaFim: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    dataDecisao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export type ProcessoReinfEntrada = z.infer<typeof esquemaProcessoReinf>;

const manterProcessoReinf = definirOperacao<ProcessoReinfEntrada, ResultadoOperacao>({
  nome: 'financeiro.reinf_manter_processo',
  tabelas: ['processo_tributario', 'suspensao_processo_tributario'],
  entrada: esquemaProcessoReinf as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const benef = e.beneficiario ? so(e.beneficiario) : null;
    recusar(conferirProcessoSuspensao({ ...e, beneficiario: benef }));
    const vara = e.vara?.trim() || null;
    if (e.tipo === 'judicial' && !vara)
      throw recusa('vara-obrigatoria', 'Informe a vara do processo judicial.', { campos: ['vara'] });
    const num = so(e.numero);
    // O mesmo processo ganha outra suspensão (outro tributo ou beneficiário). A vigência e a vara são do processo e
    // valem para todas as suspensões dele: incluir outra suspensão não as muda (isso é financeiro.reinf_alterar_processo).
    const ja = await tx.consultarParaAtualizar(
      `SELECT id, codigo_vara, vigencia_inicio, vigencia_fim, situacao FROM processo_tributario
        WHERE estabelecimento_id = ? AND tipo = ? AND numero_processo = ? AND excluido_em IS NULL`,
      [est, e.tipo, num],
    );
    let processo: number;
    if (ja[0]) {
      processo = numero(ja[0]['id']);
      if (texto(ja[0]['situacao']) !== 'ativo')
        throw recusa('processo-inativo', 'O processo não está ativo: não recebe outra suspensão.', {
          campos: ['numero'],
        });
      const campos = [
        ...(dataIso(ja[0]['vigencia_inicio']) === e.vigenciaInicio ? [] : ['vigenciaInicio']),
        ...(dataIso(ja[0]['vigencia_fim']) === e.vigenciaFim ? [] : ['vigenciaFim']),
        ...((ja[0]['codigo_vara'] ? texto(ja[0]['codigo_vara']) : null) === vara ? [] : ['vara']),
      ];
      if (campos.length > 0)
        throw recusa(
          'processo-dados-divergentes',
          'O processo já está cadastrado com outra vigência ou vara. Altere os dados do processo antes de incluir a suspensão.',
          { campos },
        );
    } else
      processo = await tx.incluir('processo_tributario', {
        estabelecimento_id: est,
        tipo: e.tipo,
        numero_processo: num,
        codigo_vara: vara,
        codigo_indicativo_suspensao: e.indicativo,
        data_decisao: e.dataDecisao,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
      });
    const sus = await tx.consultar(
      'SELECT id, tributo, beneficiario_documento, sequencia, encerrada_em, anulada FROM suspensao_processo_tributario WHERE processo_tributario_id = ?',
      [processo],
    );
    // A encerrada ou anulada não impede a nova suspensão do mesmo tributo (a decisão pode voltar a valer).
    if (
      sus.some(
        (s) =>
          texto(s['tributo']) === e.tributo &&
          (s['beneficiario_documento'] ?? null) === benef &&
          s['encerrada_em'] == null &&
          !sim(s['anulada']),
      )
    )
      throw recusa('suspensao-repetida', 'O processo já suspende este tributo para este beneficiário.', {
        campos: ['tributo', 'beneficiario'],
      });
    const seq = sus.reduce((m, s) => Math.max(m, numero(s['sequencia'])), 0) + 1;
    const suspensao = await tx.incluir('suspensao_processo_tributario', {
      processo_tributario_id: processo,
      sequencia: seq,
      codigo_suspensao: `${e.tributo}-${seq}`.slice(0, 14),
      indicativo_suspensao: e.indicativo,
      tributo: e.tributo,
      beneficiario_documento: benef,
      data_decisao: e.dataDecisao,
    });
    return { processo, suspensao };
  },
  alvo: (_e, r) => ({ tabela: 'processo_tributario', id: numero(r['processo']) || null }),
});

const DATA = /^\d{4}-\d{2}-\d{2}$/;
export const esquemaEncerrarSuspensaoReinf = z
  .object({
    suspensao: id,
    /** Último dia em que a suspensão vale; nulo anula a lançada por engano (nunca valeu). */
    fim: z.string().regex(DATA).nullable(),
    motivo: z.string().trim().min(1).max(200),
  })
  .strict();
export type EncerrarSuspensaoReinfEntrada = z.infer<typeof esquemaEncerrarSuspensaoReinf>;

const encerrarSuspensaoReinf = definirOperacao<EncerrarSuspensaoReinfEntrada, ResultadoOperacao>({
  nome: 'financeiro.reinf_encerrar_suspensao',
  tabelas: ['suspensao_processo_tributario'],
  entrada: esquemaEncerrarSuspensaoReinf as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [s] = await tx.consultarParaAtualizar(
      `SELECT s.id, s.versao, s.encerrada_em, s.anulada, p.id AS processo, p.vigencia_inicio
         FROM suspensao_processo_tributario s JOIN processo_tributario p ON p.id = s.processo_tributario_id
        WHERE s.id = ? AND p.estabelecimento_id = ? AND s.excluido_em IS NULL AND p.excluido_em IS NULL`,
      [e.suspensao, est],
    );
    if (!s) throw recusa('suspensao-inexistente', 'Suspensão não encontrada.', { campos: ['suspensao'] });
    recusar(
      conferirEncerramentoSuspensao(
        {
          vigenciaInicio: dataIso(s['vigencia_inicio']) ?? '',
          encerradaEm: dataIso(s['encerrada_em']),
          anulada: sim(s['anulada']),
        },
        e,
      ),
    );
    // Nada é apagado: a linha fica, com o fim (ou a anulação) e o motivo; a trilha guarda quem e quando.
    await tx.alterar('suspensao_processo_tributario', e.suspensao, numero(s['versao']), {
      encerrada_em: e.fim,
      anulada: e.fim === null,
      motivo_encerramento: e.motivo,
    });
    return {
      suspensao: e.suspensao,
      processo: numero(s['processo']),
      situacao: e.fim === null ? 'anulada' : 'encerrada',
    };
  },
  alvo: (_e, r) => ({ tabela: 'suspensao_processo_tributario', id: numero(r['suspensao']) || null }),
});

export const esquemaAlterarProcessoReinf = z
  .object({
    processo: id,
    vara: z.string().trim().max(4).nullable(),
    vigenciaInicio: z.string().regex(DATA),
    vigenciaFim: z.string().regex(DATA).nullable(),
  })
  .strict();
export type AlterarProcessoReinfEntrada = z.infer<typeof esquemaAlterarProcessoReinf>;

const alterarProcessoReinf = definirOperacao<AlterarProcessoReinfEntrada, ResultadoOperacao>({
  nome: 'financeiro.reinf_alterar_processo',
  tabelas: ['processo_tributario'],
  entrada: esquemaAlterarProcessoReinf as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [p] = await tx.consultarParaAtualizar(
      `SELECT id, versao, tipo FROM processo_tributario
        WHERE id = ? AND estabelecimento_id = ? AND tipo IN ('judicial','administrativo') AND excluido_em IS NULL`,
      [e.processo, est],
    );
    if (!p) throw recusa('processo-inexistente', 'Processo não encontrado.', { campos: ['processo'] });
    const vara = e.vara?.trim() || null;
    recusar(conferirAlteracaoProcesso({ ...e, tipo: texto(p['tipo']), vara }));
    await tx.alterar('processo_tributario', e.processo, numero(p['versao']), {
      codigo_vara: vara,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
    });
    const n = await tx.uma(
      `SELECT COUNT(*) AS n FROM suspensao_processo_tributario
        WHERE processo_tributario_id = ? AND excluido_em IS NULL AND encerrada_em IS NULL AND anulada = FALSE`,
      [e.processo],
    );
    return { processo: e.processo, suspensoes: numero(n?.['n']) };
  },
  alvo: (_e, r) => ({ tabela: 'processo_tributario', id: numero(r['processo']) || null }),
});

// ── Geração dos eventos da competência ─────────────────────────────────────────────────────────────────────────

export const esquemaGerarReinf = z
  .object({ serie: z.enum(['R-2000', 'R-4000']), periodo: z.string().regex(PERIODO) })
  .strict();
export type GerarReinfEntrada = z.infer<typeof esquemaGerarReinf>;

const CODIGOS = { 'R-2000': ['R-2010'], 'R-4000': ['R-4010', 'R-4020'] } as const;

async function incluirEvento(
  tx: TxOperacao,
  est: number,
  periodo: string,
  ev: EventoReinfPlanejado,
  hash: string,
  retifica: number | null,
  fornecedor: number | null,
): Promise<number> {
  const evento = await tx.incluir('evento_reinf', {
    estabelecimento_id: est,
    competencia: `${periodo}-01`,
    codigo_evento: ev.evento,
    acao: retifica ? 'retificacao' : 'inclusao',
    ambiente: 'homologacao',
    versao_leiaute: '2.1.2',
    retificado_evento_reinf_id: retifica,
    situacao: 'gerado',
  });
  const ir = ev.evento === 'R-2010' ? 0 : ev.valorRetido;
  await tx.incluir('evento_reinf_item', {
    evento_reinf_id: evento,
    sequencia: 1,
    tipo_item: ev.evento === 'R-2010' ? 'servico_tomado' : 'beneficiario',
    empresa_fornecedora_id: fornecedor || null,
    beneficiario_documento: ev.beneficiario,
    valor_bruto: ev.valorBruto,
    base_retencao: ev.valorBruto,
    valor_inss: ev.evento === 'R-2010' ? ev.valorRetido : 0,
    valor_irrf: ir,
    valor_suspenso: ev.valorSuspenso,
    detalhes: JSON.stringify({ hash, evento: ev }),
  });
  let seq = 1;
  for (const p of ev.processos)
    await tx.incluir('evento_reinf_item', {
      evento_reinf_id: evento,
      sequencia: ++seq,
      tipo_item: 'processo_judicial',
      beneficiario_documento: ev.beneficiario,
      processo_tributario_id: p.id,
      valor_suspenso: p.valor,
      observacao: `Indicativo ${p.indicativo}`,
    });
  return evento;
}

const gerarEventosReinf = definirOperacao<GerarReinfEntrada, ResultadoOperacao>({
  nome: 'financeiro.reinf_gerar_eventos',
  tabelas: ['evento_reinf', 'evento_reinf_item'],
  entrada: esquemaGerarReinf as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const estab = await tx.uma('SELECT cnpj FROM estabelecimento WHERE id = ?', [est]);
    const cnpj = so(texto(estab?.['cnpj']));
    if (cnpj.length !== 14)
      throw recusa('estabelecimento-sem-cnpj', 'O estabelecimento precisa do CNPJ para a EFD-REINF.');
    // A trava da competência: duas gerações ao mesmo tempo não criam dois eventos do mesmo beneficiário.
    await tx.consultarParaAtualizar('SELECT id FROM estabelecimento WHERE id = ?', [est]);
    const { retencoes, fornecedor, semDocumento } = await retencoesDaCompetencia(tx, est, e.periodo);
    const processos = (await processosSuspensao(tx, est)).filter((p) => p.situacao === 'ativo' && !p.anulada);
    const planejados = montarEventosReinf(e.serie, e.periodo, cnpj, retencoes, processos).map((ev) => ({
      evento: ev,
      hash: hashEventoReinf(ev),
    }));
    const codigos = CODIGOS[e.serie];
    const gravados = await eventosGravados(tx, est, e.periodo, [...codigos, 'R-9000']);
    // O R-9000 entra no plano só pelo que ele exclui desta série.
    const daSerie = gravados.filter(
      (g) =>
        (codigos as readonly string[]).includes(g.evento) ||
        (g.evento === 'R-9000' &&
          gravados.some((o) => o.id === g.retificadoId && (codigos as readonly string[]).includes(o.evento))),
    );
    const plano = planejarEnvioReinf(planejados, daSerie);
    const versao = new Map(gravados.map((g) => [g.id, g.versao]));
    const cancelar = async (g: EventoReinfGravado) =>
      tx.alterar('evento_reinf', g.id, versao.get(g.id) ?? 1, { situacao: 'cancelado' });
    const criados: number[] = [];
    for (const n of plano.novos) {
      if (n.substitui) await cancelar(n.substitui);
      criados.push(
        await incluirEvento(
          tx,
          est,
          e.periodo,
          n.evento,
          n.hash,
          n.retifica?.id ?? null,
          fornecedor.get(n.evento.beneficiario) ?? null,
        ),
      );
    }
    // O gerado, validado ou rejeitado de beneficiário que saiu da competência: cancelado (nada é apagado).
    const chaves = new Set(planejados.map((p) => `${p.evento.evento}|${p.evento.beneficiario}`));
    let cancelados = plano.novos.filter((n) => n.substitui).length;
    for (const g of daSerie)
      if (
        g.evento !== 'R-9000' &&
        !chaves.has(`${g.evento}|${g.beneficiario}`) &&
        ['gerado', 'validado', 'rejeitado'].includes(g.situacao)
      ) {
        await cancelar(g);
        cancelados += 1;
      }
    // O aceito que saiu da competência: R-9000 ligado a ele, pelo recibo.
    const exclusoes: number[] = [];
    for (const x of plano.exclusoes) {
      const ev = await tx.incluir('evento_reinf', {
        estabelecimento_id: est,
        competencia: `${e.periodo}-01`,
        codigo_evento: 'R-9000',
        acao: 'exclusao',
        ambiente: 'homologacao',
        versao_leiaute: '2.1.2',
        retificado_evento_reinf_id: x.id,
        situacao: 'gerado',
      });
      await tx.incluir('evento_reinf_item', {
        evento_reinf_id: ev,
        sequencia: 1,
        tipo_item: 'outro',
        beneficiario_documento: x.beneficiario,
        detalhes: JSON.stringify({ hash: '', exclui: x.id }),
      });
      exclusoes.push(ev);
    }
    return {
      gerados: lista(criados),
      quantidadeGerados: criados.length,
      retificadores: plano.novos.filter((n) => n.retifica).length,
      exclusoes: lista(exclusoes),
      quantidadeExclusoes: exclusoes.length,
      cancelados,
      iguais: plano.iguais,
      aguardando: lista([...plano.aguardando].sort()),
      rejeitadosSemCorrecao: lista(plano.rejeitadosSemCorrecao.map((g) => g.id)),
      // Títulos com retenção na competência que ficaram fora por falta do CPF ou CNPJ do credor.
      semDocumento: semDocumento.length,
      titulosSemDocumento: lista(semDocumento),
    };
  },
  alvo: (_e, r) => ({
    tabela: 'evento_reinf',
    id: Number(`${String(r['gerados'])},${String(r['exclusoes'])}`.split(',').find(Boolean) ?? 0) || null,
  }),
});

// ── Transmissão (simulador) e retorno ──────────────────────────────────────────────────────────────────────────

export const esquemaTransmitirReinf = z
  .object({ periodo: z.string().regex(PERIODO), eventos: z.array(id).min(1).max(50) })
  .strict();
export type TransmitirReinfEntrada = z.infer<typeof esquemaTransmitirReinf>;

const transmitirReinf = definirOperacao<TransmitirReinfEntrada, ResultadoOperacao>({
  nome: 'financeiro.reinf_transmitir',
  tabelas: ['lote_reinf', 'evento_reinf', 'sequencia_negocio'],
  entrada: esquemaTransmitirReinf as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const ids = [...new Set(e.eventos)];
    const linhas = await tx.consultarParaAtualizar(
      `SELECT id, situacao, versao, competencia FROM evento_reinf
        WHERE estabelecimento_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
      [est, ...ids],
    );
    if (linhas.length !== ids.length)
      throw recusa('evento-inexistente', 'Há evento que não é deste estabelecimento.', {
        campos: ['eventos'],
      });
    for (const r of linhas) {
      if ((dataIso(r['competencia']) ?? '').slice(0, 7) !== e.periodo)
        throw recusa('evento-outra-competencia', 'Todos os eventos do lote são da mesma competência.', {
          campos: ['eventos'],
        });
      recusar(conferirTransmissaoReinf(texto(r['situacao'])));
    }
    await garantirSequencia(
      tx,
      { tipo: 'lote_reinf', estabelecimento: est, prefixo: null },
      { usuario: ctx.usuario, agora: new Date() },
    );
    const num = await tx.proximoNumero('lote_reinf');
    const agora = new Date();
    // Fora de produção o envio vai ao simulador (nenhuma mensagem externa): o protocolo é local.
    const protocolo = `SIM-${est}-${num.valor}`;
    const lote = await tx.incluir('lote_reinf', {
      estabelecimento_id: est,
      numero: num.valor,
      competencia: `${e.periodo}-01`,
      ambiente: 'producao_restrita',
      quantidade_eventos: ids.length,
      protocolo,
      situacao: 'enviado',
      enviado_em: agora,
    });
    for (const r of linhas)
      await tx.alterar('evento_reinf', numero(r['id']), numero(r['versao']), {
        lote_reinf_id: lote,
        situacao: 'enviado',
        enviado_em: agora,
      });
    return { lote, numero: num.valor, protocolo, eventos: ids.length };
  },
  alvo: (_e, r) => ({ tabela: 'lote_reinf', id: numero(r['lote']) || null }),
});

export const esquemaRetornoReinf = z
  .object({
    evento: id,
    aceito: z.boolean(),
    recibo: z.string().trim().max(52).nullable(),
    ocorrencias: z.string().trim().max(1000).nullable(),
    codigo: z.string().trim().max(10).nullable().optional(),
  })
  .strict();
export type RetornoReinfEntrada = z.infer<typeof esquemaRetornoReinf>;

const registrarRetornoReinf = definirOperacao<RetornoReinfEntrada, ResultadoOperacao>({
  nome: 'financeiro.reinf_registrar_retorno',
  tabelas: ['retorno_reinf', 'evento_reinf', 'lote_reinf'],
  entrada: esquemaRetornoReinf as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [ev] = await tx.consultarParaAtualizar(
      `SELECT e.id, e.situacao, e.versao, e.enviado_em, e.lote_reinf_id, l.protocolo
         FROM evento_reinf e LEFT JOIN lote_reinf l ON l.id = e.lote_reinf_id
        WHERE e.id = ? AND e.estabelecimento_id = ?`,
      [e.evento, est],
    );
    if (!ev) throw recusa('evento-inexistente', 'Evento não encontrado.', { campos: ['evento'] });
    recusar(conferirRetornoReinf(texto(ev['situacao']), e));
    const agora = new Date();
    const seq = await tx.uma(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM retorno_reinf WHERE evento_reinf_id = ?',
      [e.evento],
    );
    const retorno = await tx.incluir('retorno_reinf', {
      evento_reinf_id: e.evento,
      sequencia: numero(seq?.['s']) || 1,
      enviado_em: ev['enviado_em'] ?? null,
      recebido_em: agora,
      situacao: e.aceito ? 'sucesso' : 'erro',
      protocolo: ev['protocolo'] ?? null,
      numero_recibo: e.aceito ? e.recibo : null,
      codigo_resposta: e.codigo ?? null,
      tipo_ocorrencia: e.aceito ? null : 'erro',
      mensagem: e.aceito ? null : e.ocorrencias,
    });
    await tx.alterar('evento_reinf', e.evento, numero(ev['versao']), {
      situacao: e.aceito ? 'aceito' : 'rejeitado',
      numero_recibo: e.aceito ? e.recibo : null,
      processado_em: agora,
      mensagem_retorno: e.aceito ? null : e.ocorrencias,
    });
    // O lote fica processado quando nenhum evento dele espera retorno (com erro se algum foi rejeitado).
    const lote = ev['lote_reinf_id'] == null ? null : numero(ev['lote_reinf_id']);
    if (lote) {
      const c = await tx.uma(
        `SELECT SUM(situacao = 'enviado') AS espera, SUM(situacao = 'rejeitado') AS rejeitados FROM evento_reinf
          WHERE lote_reinf_id = ?`,
        [lote],
      );
      if (numero(c?.['espera']) === 0) {
        const l = await tx.consultarParaAtualizar('SELECT versao FROM lote_reinf WHERE id = ?', [lote]);
        await tx.alterar('lote_reinf', lote, numero(l[0]?.['versao']), {
          situacao: numero(c?.['rejeitados']) > 0 ? 'processado_com_erro' : 'processado',
          retorno_em: agora,
        });
      }
    }
    return { retorno, evento: e.evento, situacao: e.aceito ? 'aceito' : 'rejeitado' };
  },
  alvo: (_e, r) => ({ tabela: 'evento_reinf', id: numero(r['evento']) || null }),
});

export const OPERACOES_REINF = {
  'financeiro.reinfManterProcesso': manterProcessoReinf,
  'financeiro.reinfEncerrarSuspensao': encerrarSuspensaoReinf,
  'financeiro.reinfAlterarProcesso': alterarProcessoReinf,
  'financeiro.reinfGerarEventos': gerarEventosReinf,
  'financeiro.reinfTransmitir': transmitirReinf,
  'financeiro.reinfRegistrarRetorno': registrarRetornoReinf,
} as const;
