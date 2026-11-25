// Laudo de internação SUS (F7, 06-SUS linha 57), no banco do cliente. As regras são as puras de
// @sgh/dominio-faturamento (sus/laudo-internacao.ts); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - o laudo da solicitação da AIH: uma linha em `laudo_internacao_sus` (número da sequência do estabelecimento, CID-10
//     do catálogo oficial, caráter, solicitante e justificativa clínica), situação "emitido", apontada pela autorização
//     (emitirLaudoDaAutorizacao, chamada pela gravação da AIH na mesma transação); autorizar, negar e cancelar a AIH
//     levam a situação ao laudo (sincronizarLaudo);
//   - devolver: a autorização "solicitada" fica "devolvida" (devolvida_em e o motivo do gestor) e o laudo "devolvido"
//     (devolvido_em, motivo_devolucao), sem apagar nada;
//   - reenviar: a autorização devolvida volta a "solicitada" com a justificativa (e o procedimento ou o CID) corrigidos;
//     o laudo volta a "emitido" com as correções e sai do lote anterior (fica livre para outro lote);
//   - laudo especial: um laudo tipo "especial" com o número da AIH autorizada e uma linha por procedimento especial em
//     `laudo_internacao_sus_especial` (OPM, sangue, diárias de acompanhante e de UTI);
//   - imprimir: impresso_em do laudo (a primeira impressão fica; a reimpressão não muda a data);
//   - lote: `lote_laudo_sus` "fechado" com os laudos emitidos (lote_laudo_sus_id e a quantidade); enviar marca o lote
//     "enviado" e os laudos "enviado" (enviado_em); retornar marca o recebimento da lista do gestor; cancelar (antes
//     do envio) solta os laudos.
// A trilha de cada gravação vai pelo executor (mesma transação).
import {
  acaoLotePermitida,
  conferirDevolucaoLaudo,
  conferirLaudoEspecial,
  conferirLoteLaudos,
  conferirReenvioLaudo,
  MAXIMO_ITENS_LAUDO_ESPECIAL,
  MAXIMO_LAUDOS_POR_LOTE,
  type SituacaoLaudoInternacaoSus,
  type SituacaoLoteLaudoSus,
  situacaoDoLaudoPelaAutorizacao,
  TIPOS_ITEM_LAUDO_ESPECIAL,
} from '@sgh/dominio-faturamento';
import type { SituacaoAih } from '@sgh/contratos';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_LAUDO_INTERNACAO_SUS = Symbol('PORTA_LAUDO_INTERNACAO_SUS');

/** As tabelas que o laudo grava (a gravação da AIH as soma às dela). */
export const TABELAS_LAUDO_SUS = [
  'laudo_internacao_sus',
  'laudo_internacao_sus_especial',
  'lote_laudo_sus',
  'sequencia_negocio',
] as const;
const TABELAS = [...TABELAS_LAUDO_SUS, 'autorizacao_internacao_sus'];
const SEQ_LAUDO = 'laudo_internacao_sus';
const SEQ_LOTE = 'lote_laudo_sus';

const id = z.number().int().positive();
const versao = z.number().int().positive();
const motivo = z.string().trim().min(1).max(500);
const sigtap = z.string().regex(/^\d{10}$/);
const cid = z
  .string()
  .trim()
  .transform((v) => v.replace('.', '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z]\d{2}[0-9A-Z]{0,2}$/));

const esquemaDevolver = z.object({ versao, motivo }).strict();
const esquemaReenviar = z
  .object({
    versao,
    justificativa: z.string().trim().min(1).max(2000),
    procedimentoSolicitado: sigtap.nullable().default(null),
    cidPrincipal: cid.nullable().default(null),
  })
  .strict();
const esquemaEspecial = z
  .object({
    versao,
    justificativa: z.string().trim().min(1).max(800),
    itens: z
      .array(
        z
          .object({
            tipo: z.enum(TIPOS_ITEM_LAUDO_ESPECIAL),
            procedimento: z.string().trim(),
            quantidade: z.number().positive().max(9999),
            justificativa: z.string().trim().max(800).nullable().default(null),
          })
          .strict(),
      )
      .max(MAXIMO_ITENS_LAUDO_ESPECIAL),
  })
  .strict();
const esquemaLote = z.object({ laudos: z.array(id).max(MAXIMO_LAUDOS_POR_LOTE + 1) }).strict();
const esquemaAcaoLote = z
  .object({ versao, observacao: z.string().trim().max(500).nullable().default(null) })
  .strict();
const esquemaFiltro = z
  .object({
    autorizacao: id.optional(),
    semLote: z.boolean().optional(),
    situacao: z.string().max(20).optional(),
  })
  .strict();

export interface ItemLaudoEspecialLido {
  readonly sequencia: number;
  readonly tipo: string;
  readonly procedimento: string;
  readonly quantidade: number;
  readonly justificativa: string | null;
}

export interface LaudoInternacaoSusLido {
  readonly id: number;
  readonly numero: string;
  readonly tipo: string;
  readonly situacao: SituacaoLaudoInternacaoSus;
  readonly autorizacao: number | null;
  readonly numeroAih: string | null;
  readonly prontuario: number | null;
  readonly dataLaudo: string;
  readonly procedimentoSolicitado: string;
  readonly cidPrincipal: string;
  readonly justificativa: string;
  readonly emitidoEm: string | null;
  readonly impressoEm: string | null;
  readonly enviadoEm: string | null;
  readonly devolvidoEm: string | null;
  readonly motivoDevolucao: string | null;
  readonly lote: { readonly id: number; readonly numero: string } | null;
  readonly especiais: readonly ItemLaudoEspecialLido[];
  readonly versao: number;
}

export interface LoteLaudoSusLido {
  readonly id: number;
  readonly numero: string;
  readonly situacao: SituacaoLoteLaudoSus;
  readonly quantidadeLaudos: number;
  readonly geradoEm: string;
  readonly enviadoEm: string | null;
  readonly retornadoEm: string | null;
  readonly observacao: string | null;
  readonly versao: number;
}

const instante = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);
const dia = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);

async function proximoNumeroDe(tx: TxOperacao, est: number, tipo: string, prefixo: string): Promise<string> {
  const seq = await tx.uma('SELECT id FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?', [
    tipo,
    est,
  ]);
  if (!seq)
    await tx.incluir('sequencia_negocio', {
      estabelecimento_id: est,
      tipo,
      prefixo,
      proximo_valor: 1,
      incremento: 1,
      ativo: true,
    });
  return (await tx.proximoNumero(tipo)).formatado;
}

/** O termo CID-10 do catálogo oficial pelo código sem ponto. */
async function cidTermo(l: Leitor, codigo: string): Promise<number> {
  const t = await l.uma(
    `SELECT t.id FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
      WHERE g.codigo = 'cid10' AND t.codigo_termo = ? ORDER BY t.ativo DESC, t.id DESC LIMIT 1`,
    [codigo.replace('.', '').toUpperCase()],
  );
  if (!t)
    throw new ErroOperacao(
      422,
      'regra-violada',
      'CID-10 inexistente',
      'O CID-10 do laudo não está no catálogo oficial carregado.',
      { campos: ['cidPrincipal'] },
    );
  return num(t['id']);
}

/**
 * O laudo da solicitação da AIH (chamado pela gravação da AIH na mesma transação): número da sequência do
 * estabelecimento, CID-10 pelo catálogo oficial, situação "emitido". Devolve o id para a autorização apontar.
 */
export async function emitirLaudoDaAutorizacao(
  tx: TxOperacao,
  est: number,
  p: {
    paciente: number;
    atendimento: number | null;
    internacao: number;
    dataLaudo: string;
    solicitanteProfissional: number | null;
    solicitanteExterno: number | null;
    procedimento: number;
    cidPrincipal: string;
    cidSecundario: string | null;
    carater: number;
    justificativa: string;
  },
): Promise<number> {
  const principal = await cidTermo(tx, p.cidPrincipal);
  const secundario = p.cidSecundario ? await cidTermo(tx, p.cidSecundario) : null;
  return tx.incluir('laudo_internacao_sus', {
    estabelecimento_id: est,
    numero: await proximoNumeroDe(tx, est, SEQ_LAUDO, 'LI-'),
    tipo_laudo: 'inicial',
    paciente_id: p.paciente,
    atendimento_id: p.atendimento,
    internacao_id: p.internacao,
    data_laudo: p.dataLaudo,
    solicitante_profissional_id: p.solicitanteProfissional,
    solicitante_externo_id: p.solicitanteExterno,
    solicitado_procedimento_sigtap_id: p.procedimento,
    cid_principal_termo_terminologia_id: principal,
    cid_secundario_termo_terminologia_id: secundario,
    carater_dominio_sus_id: p.carater,
    sinais_sintomas: p.justificativa.slice(0, 2000),
    situacao: 'emitido',
    emitido_em: new Date(),
    origem: 'sistema',
  });
}

/** Leva ao laudo a situação nova da autorização (autorizar, negar, cancelar, devolver). Sem laudo, nada. */
export async function sincronizarLaudo(
  tx: TxOperacao,
  autorizacao: number,
  situacao: 'autorizada' | 'negada' | 'cancelada' | 'devolvida',
  p: { motivo?: string | null; numeroAih?: string | null; autorizador?: number | null } = {},
): Promise<void> {
  const [l] = await tx.consultarParaAtualizar(
    `SELECT l.id, l.versao, l.solicitado_procedimento_sigtap_id FROM laudo_internacao_sus l
       JOIN autorizacao_internacao_sus a ON a.laudo_internacao_sus_id = l.id
      WHERE a.id = ? AND l.excluido_em IS NULL`,
    [autorizacao],
  );
  if (!l) return;
  const nova = situacaoDoLaudoPelaAutorizacao(situacao, false);
  const motivoCurto = p.motivo ? p.motivo.slice(0, 500) : null;
  const campos: Record<string, unknown> = { situacao: nova };
  if (situacao === 'autorizada') {
    campos['autorizado_em'] = new Date();
    campos['numero_aih'] = p.numeroAih ?? null;
    campos['autorizado_procedimento_sigtap_id'] = num(l['solicitado_procedimento_sigtap_id']);
    campos['autorizador_sus_id'] = p.autorizador ?? null;
  } else if (situacao === 'negada') campos['motivo_negativa'] = motivoCurto;
  else if (situacao === 'cancelada') {
    campos['cancelado_em'] = new Date();
    campos['motivo_cancelamento'] = motivoCurto;
  } else {
    campos['devolvido_em'] = new Date();
    campos['motivo_devolucao'] = motivoCurto;
  }
  await tx.alterar('laudo_internacao_sus', num(l['id']), num(l['versao']), campos);
}

const SQL_LAUDOS = `
  SELECT l.id, l.numero, l.tipo_laudo, l.situacao, l.numero_aih, l.data_laudo, l.sinais_sintomas, l.justificativa_mudanca,
         l.emitido_em, l.impresso_em, l.enviado_em, l.devolvido_em, l.motivo_devolucao, l.versao,
         COALESCE(a.id, ae.id) AS autorizacao_id, p.numero_prontuario, s.codigo_sigtap, t.codigo_termo AS cid,
         lt.id AS lote_id, lt.numero AS lote_numero
    FROM laudo_internacao_sus l
    LEFT JOIN autorizacao_internacao_sus a ON a.laudo_internacao_sus_id = l.id
    LEFT JOIN autorizacao_internacao_sus ae ON a.id IS NULL AND l.tipo_laudo = 'especial'
         AND ae.estabelecimento_id = l.estabelecimento_id AND ae.numero_aih = l.numero_aih
    LEFT JOIN paciente p ON p.id = l.paciente_id
    LEFT JOIN procedimento_sigtap s ON s.id = l.solicitado_procedimento_sigtap_id
    LEFT JOIN termo_terminologia t ON t.id = l.cid_principal_termo_terminologia_id
    LEFT JOIN lote_laudo_sus lt ON lt.id = l.lote_laudo_sus_id
   WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL`;

const SQL_LOTES = `SELECT id, numero, situacao, quantidade_laudos, gerado_em, exportado_em, recebido_autorizacao_em,
       observacao, versao FROM lote_laudo_sus WHERE estabelecimento_id = ? AND excluido_em IS NULL`;

function loteDaLinha(r: Record<string, unknown>): LoteLaudoSusLido {
  return {
    id: num(r['id']),
    numero: String(r['numero']),
    situacao: String(r['situacao']) as SituacaoLoteLaudoSus,
    quantidadeLaudos: num(r['quantidade_laudos']),
    geradoEm: instante(r['gerado_em']) ?? '',
    enviadoEm: instante(r['exportado_em']),
    retornadoEm: instante(r['recebido_autorizacao_em']),
    observacao: txtOuNull(r['observacao']),
    versao: num(r['versao']),
  };
}

/** A situação da AIH como a tela a vê (a autorização e a última conta). */
async function situacaoDaAih(
  tx: TxOperacao,
  est: number,
  aih: number,
): Promise<{ situacao: SituacaoAih; versao: number; linha: Record<string, unknown> }> {
  const [a] = await tx.consultarParaAtualizar(
    `SELECT a.*, (SELECT c.situacao FROM conta_aih c WHERE c.autorizacao_internacao_sus_id = a.id AND c.excluido_em IS NULL
                   ORDER BY c.numero_fechamento DESC LIMIT 1) AS situacao_conta
       FROM autorizacao_internacao_sus a WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
    [aih, est],
  );
  if (!a) throw naoEncontrado('AIH');
  const sa = String(a['situacao']);
  const conta = txtOuNull(a['situacao_conta']);
  const situacao = (sa === 'autorizada' && conta && conta !== 'reaberta' ? conta : sa) as SituacaoAih;
  return { situacao, versao: num(a['versao']), linha: a };
}

function versaoDiferente(): never {
  throw new ErroOperacao(
    409,
    'versao-alterada',
    'Registro alterado',
    'O registro mudou desde que a tela foi aberta.',
  );
}

export class PortaLaudoInternacaoSusPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'faturamento.susLaudo');
  }

  /** Os laudos do estabelecimento (da AIH, os sem lote ou por situação), mais recentes primeiro, com os especiais. */
  listar(c: ContextoPortaPropria, filtro: unknown = {}): Promise<LaudoInternacaoSusLido[]> {
    const f = entradaValida(esquemaFiltro, filtro);
    return this.ler(c, 'listar', async (l, est) => {
      const cond: string[] = [];
      const par: unknown[] = [est.id];
      if (f.autorizacao) {
        cond.push('COALESCE(a.id, ae.id) = ?');
        par.push(f.autorizacao);
      }
      if (f.semLote) cond.push("l.lote_laudo_sus_id IS NULL AND l.situacao = 'emitido'");
      if (f.situacao) {
        cond.push('l.situacao = ?');
        par.push(f.situacao);
      }
      const linhas = await l.consultar(
        `${SQL_LAUDOS}${cond.map((x) => ` AND ${x}`).join('')} ORDER BY l.id DESC LIMIT 500`,
        par,
      );
      const ids = linhas.map((r) => num(r['id']));
      const especiais = ids.length
        ? await l.consultar(
            `SELECT e.laudo_internacao_sus_id, e.sequencia, e.tipo_especial, s.codigo_sigtap, e.quantidade, e.justificativa
               FROM laudo_internacao_sus_especial e JOIN procedimento_sigtap s ON s.id = e.procedimento_sigtap_id
              WHERE e.excluido_em IS NULL AND e.laudo_internacao_sus_id IN (${ids.map(() => '?').join(',')})
              ORDER BY e.sequencia`,
            ids,
          )
        : [];
      return linhas.map((r) => ({
        id: num(r['id']),
        numero: String(r['numero']),
        tipo: String(r['tipo_laudo']),
        situacao: String(r['situacao']) as SituacaoLaudoInternacaoSus,
        autorizacao: numOuNull(r['autorizacao_id']),
        numeroAih: txtOuNull(r['numero_aih']),
        prontuario: numOuNull(r['numero_prontuario']),
        dataLaudo: dia(r['data_laudo']),
        procedimentoSolicitado: String(r['codigo_sigtap'] ?? ''),
        cidPrincipal: String(r['cid'] ?? ''),
        justificativa: String(r['justificativa_mudanca'] ?? r['sinais_sintomas'] ?? ''),
        emitidoEm: instante(r['emitido_em']),
        impressoEm: instante(r['impresso_em']),
        enviadoEm: instante(r['enviado_em']),
        devolvidoEm: instante(r['devolvido_em']),
        motivoDevolucao: txtOuNull(r['motivo_devolucao']),
        lote: r['lote_id'] ? { id: num(r['lote_id']), numero: String(r['lote_numero']) } : null,
        especiais: especiais
          .filter((e) => num(e['laudo_internacao_sus_id']) === num(r['id']))
          .map((e) => ({
            sequencia: num(e['sequencia']),
            tipo: String(e['tipo_especial']),
            procedimento: String(e['codigo_sigtap']),
            quantidade: Number(e['quantidade']),
            justificativa: txtOuNull(e['justificativa']),
          })),
        versao: num(r['versao']),
      }));
    });
  }

  listarLotes(c: ContextoPortaPropria): Promise<LoteLaudoSusLido[]> {
    return this.ler(c, 'lotes', async (l, est) =>
      (await l.consultar(`${SQL_LOTES} ORDER BY id DESC LIMIT 200`, [est.id])).map(loteDaLinha),
    );
  }

  /** O gestor devolve o laudo da AIH solicitada para correção. */
  devolver(c: ContextoPortaPropria, aih: number, entrada: unknown) {
    const e = entradaValida(esquemaDevolver, entrada);
    return this.gravar(c, 'faturamento.sus.laudo.devolver', TABELAS, async (tx, est) => {
      const a = await situacaoDaAih(tx, est.id, aih);
      if (a.versao !== e.versao) versaoDiferente();
      const p = conferirDevolucaoLaudo(a.situacao, e.motivo);
      if (p.length) throw recusaRegra('Devolução recusada', p);
      await tx.alterar('autorizacao_internacao_sus', aih, a.versao, {
        situacao: 'devolvida',
        devolvida_em: new Date(),
        motivo_situacao: e.motivo,
      });
      await sincronizarLaudo(tx, aih, 'devolvida', { motivo: e.motivo });
      return { tabela: 'autorizacao_internacao_sus', id: aih };
    });
  }

  /** O hospital corrige e reenvia o laudo devolvido: a AIH volta a solicitada e o laudo a emitido. */
  reenviar(c: ContextoPortaPropria, aih: number, entrada: unknown) {
    const e = entradaValida(esquemaReenviar, entrada);
    return this.gravar(c, 'faturamento.sus.laudo.reenviar', TABELAS, async (tx, est) => {
      const a = await situacaoDaAih(tx, est.id, aih);
      if (a.versao !== e.versao) versaoDiferente();
      let sigtap: number | null = null;
      if (e.procedimentoSolicitado) {
        const s = await tx.uma(
          'SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ? ORDER BY id DESC LIMIT 1',
          [e.procedimentoSolicitado],
        );
        if (!s)
          throw recusaRegra('Reenvio recusado', [
            { campo: 'procedimentoSolicitado', mensagem: 'O procedimento não existe na tabela unificada.' },
          ]);
        sigtap = num(s['id']);
      }
      const atual = a.linha;
      const mudouAlgo =
        e.justificativa !== String(atual['justificativa_laudo'] ?? '').trim() ||
        (sigtap !== null && sigtap !== num(atual['solicitado_procedimento_sigtap_id'])) ||
        (e.cidPrincipal !== null && e.cidPrincipal !== String(atual['codigo_cid10_principal']));
      const p = conferirReenvioLaudo(a.situacao, { justificativa: e.justificativa, mudouAlgo });
      if (p.length) throw recusaRegra('Reenvio recusado', p);
      await tx.alterar('autorizacao_internacao_sus', aih, a.versao, {
        situacao: 'solicitada',
        justificativa_laudo: e.justificativa,
        ...(sigtap !== null ? { solicitado_procedimento_sigtap_id: sigtap } : {}),
        ...(e.cidPrincipal ? { codigo_cid10_principal: e.cidPrincipal } : {}),
        data_solicitacao: new Date().toISOString().slice(0, 10),
      });
      const laudo = numOuNull(atual['laudo_internacao_sus_id']);
      if (laudo) {
        const [l] = await tx.consultarParaAtualizar('SELECT versao FROM laudo_internacao_sus WHERE id = ?', [
          laudo,
        ]);
        await tx.alterar('laudo_internacao_sus', laudo, num(l?.['versao']), {
          situacao: 'emitido',
          sinais_sintomas: e.justificativa,
          ...(sigtap !== null ? { solicitado_procedimento_sigtap_id: sigtap } : {}),
          ...(e.cidPrincipal
            ? { cid_principal_termo_terminologia_id: await cidTermo(tx, e.cidPrincipal) }
            : {}),
          emitido_em: new Date(),
          impresso_em: null,
          enviado_em: null,
          lote_laudo_sus_id: null,
        });
      }
      return { tabela: 'autorizacao_internacao_sus', id: aih };
    });
  }

  /** O laudo especial da AIH autorizada: OPM, sangue e diárias pedidos ao gestor depois da autorização. */
  especial(c: ContextoPortaPropria, aih: number, entrada: unknown) {
    const e = entradaValida(esquemaEspecial, entrada);
    return this.gravar(c, 'faturamento.sus.laudo.especial', TABELAS, async (tx, est) => {
      const a = await situacaoDaAih(tx, est.id, aih);
      if (a.versao !== e.versao) versaoDiferente();
      const p = conferirLaudoEspecial(a.situacao, e.itens, e.justificativa);
      if (p.length) throw recusaRegra('Laudo especial recusado', p);
      const codigos = [...new Set(e.itens.map((x) => x.procedimento))];
      const achados = await tx.consultar(
        `SELECT codigo_sigtap, MAX(id) AS id FROM procedimento_sigtap
          WHERE codigo_sigtap IN (${codigos.map(() => '?').join(',')}) GROUP BY codigo_sigtap`,
        codigos,
      );
      const porCodigo = new Map(achados.map((r) => [String(r['codigo_sigtap']), num(r['id'])]));
      const faltam = e.itens.flatMap((x, i) =>
        porCodigo.has(x.procedimento)
          ? []
          : [
              {
                campo: `itens.${i}.procedimento`,
                mensagem: `O procedimento ${x.procedimento} não existe na tabela unificada.`,
              },
            ],
      );
      if (faltam.length) throw recusaRegra('Laudo especial recusado', faltam);
      const x = a.linha;
      const cidPrincipal = await cidTermo(tx, String(x['codigo_cid10_principal']));
      const laudo = await tx.incluir('laudo_internacao_sus', {
        estabelecimento_id: est.id,
        numero: await proximoNumeroDe(tx, est.id, SEQ_LAUDO, 'LI-'),
        numero_aih: txtOuNull(x['numero_aih']),
        tipo_laudo: 'especial',
        paciente_id: num(x['paciente_id']),
        atendimento_id: numOuNull(x['atendimento_id']),
        internacao_id: numOuNull(x['internacao_id']),
        data_laudo: new Date().toISOString().slice(0, 10),
        solicitante_profissional_id: numOuNull(x['solicitante_profissional_id']),
        solicitante_externo_id: numOuNull(x['solicitante_externo_id']),
        solicitado_procedimento_sigtap_id: num(x['solicitado_procedimento_sigtap_id']),
        cid_principal_termo_terminologia_id: cidPrincipal,
        carater_dominio_sus_id: num(x['carater_dominio_sus_id']),
        sinais_sintomas: e.justificativa,
        justificativa_mudanca: e.justificativa,
        situacao: 'emitido',
        emitido_em: new Date(),
        origem: 'sistema',
      });
      let sequencia = 0;
      for (const item of e.itens) {
        sequencia += 1;
        await tx.incluir('laudo_internacao_sus_especial', {
          laudo_internacao_sus_id: laudo,
          sequencia,
          tipo_especial: item.tipo,
          procedimento_sigtap_id: porCodigo.get(item.procedimento),
          quantidade: item.quantidade,
          justificativa: item.justificativa,
          origem: 'sistema',
        });
      }
      return { tabela: 'laudo_internacao_sus', id: laudo };
    });
  }

  /** Marca a impressão do laudo (a primeira data fica). */
  imprimir(c: ContextoPortaPropria, laudo: number) {
    return this.gravar(c, 'faturamento.sus.laudo.imprimir', TABELAS, async (tx, est) => {
      const [l] = await tx.consultarParaAtualizar(
        'SELECT id, versao, impresso_em, situacao FROM laudo_internacao_sus WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [laudo, est.id],
      );
      if (!l) throw naoEncontrado('Laudo');
      if (String(l['situacao']) === 'cancelado')
        throw recusaRegra('Impressão recusada', [
          { campo: 'situacao', mensagem: 'O laudo cancelado não é impresso.' },
        ]);
      if (l['impresso_em'] === null)
        await tx.alterar('laudo_internacao_sus', laudo, num(l['versao']), { impresso_em: new Date() });
      return { tabela: 'laudo_internacao_sus', id: laudo };
    });
  }

  /** Gera o lote "fechado" com os laudos emitidos escolhidos. */
  gerarLote(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaLote, entrada);
    return this.gravar(c, 'faturamento.sus.laudo.lote.gerar', TABELAS, async (tx, est, usuario) => {
      const achados = e.laudos.length
        ? await tx.consultarParaAtualizar(
            `SELECT id, situacao, lote_laudo_sus_id, versao FROM laudo_internacao_sus
              WHERE estabelecimento_id = ? AND excluido_em IS NULL AND id IN (${e.laudos.map(() => '?').join(',')})`,
            [est.id, ...e.laudos],
          )
        : [];
      const p = conferirLoteLaudos(
        e.laudos,
        achados.map((r) => ({
          id: num(r['id']),
          situacao: String(r['situacao']) as SituacaoLaudoInternacaoSus,
          lote: numOuNull(r['lote_laudo_sus_id']),
        })),
      );
      if (p.length) throw recusaRegra('Lote recusado', p);
      const lote = await tx.incluir('lote_laudo_sus', {
        estabelecimento_id: est.id,
        numero: await proximoNumeroDe(tx, est.id, SEQ_LOTE, 'LL-'),
        tipo_laudo: 'internacao',
        gerado_em: new Date(),
        gerado_por_usuario_id: usuario,
        quantidade_laudos: achados.length,
        situacao: 'fechado',
        origem: 'sistema',
      });
      for (const r of achados)
        await tx.alterar('laudo_internacao_sus', num(r['id']), num(r['versao']), { lote_laudo_sus_id: lote });
      return { tabela: 'lote_laudo_sus', id: lote };
    });
  }

  private acaoLote(
    c: ContextoPortaPropria,
    lote: number,
    entrada: unknown,
    acao: 'enviar' | 'retornar' | 'cancelar',
  ) {
    const e = entradaValida(esquemaAcaoLote, entrada);
    return this.gravar(c, `faturamento.sus.laudo.lote.${acao}`, TABELAS, async (tx, est, usuario) => {
      const [l] = await tx.consultarParaAtualizar(
        'SELECT id, situacao, versao FROM lote_laudo_sus WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [lote, est.id],
      );
      if (!l) throw naoEncontrado('Lote de laudos');
      if (num(l['versao']) !== e.versao) versaoDiferente();
      const situacao = String(l['situacao']) as SituacaoLoteLaudoSus;
      if (!acaoLotePermitida(acao, situacao))
        throw recusaRegra('Ação recusada', [
          { campo: 'situacao', mensagem: `O lote ${situacao} não permite ${acao}.` },
        ]);
      const laudos = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao FROM laudo_internacao_sus WHERE lote_laudo_sus_id = ? AND excluido_em IS NULL',
        [lote],
      );
      const agora = new Date();
      if (acao === 'enviar') {
        await tx.alterar('lote_laudo_sus', lote, e.versao, {
          situacao: 'enviado',
          exportado_em: agora,
          exportado_por_usuario_id: usuario,
          ...(e.observacao ? { observacao: e.observacao } : {}),
        });
        for (const x of laudos)
          if (String(x['situacao']) === 'emitido')
            await tx.alterar('laudo_internacao_sus', num(x['id']), num(x['versao']), {
              situacao: 'enviado',
              enviado_em: agora,
            });
      } else if (acao === 'retornar') {
        await tx.alterar('lote_laudo_sus', lote, e.versao, {
          situacao: 'retornado',
          recebido_autorizacao_em: agora,
          ...(e.observacao ? { observacao: e.observacao } : {}),
        });
      } else {
        await tx.alterar('lote_laudo_sus', lote, e.versao, {
          situacao: 'cancelado',
          ...(e.observacao ? { observacao: e.observacao } : {}),
        });
        for (const x of laudos)
          await tx.alterar('laudo_internacao_sus', num(x['id']), num(x['versao']), {
            lote_laudo_sus_id: null,
          });
      }
      return { tabela: 'lote_laudo_sus', id: lote };
    });
  }

  enviarLote(c: ContextoPortaPropria, lote: number, entrada: unknown) {
    return this.acaoLote(c, lote, entrada, 'enviar');
  }
  retornarLote(c: ContextoPortaPropria, lote: number, entrada: unknown) {
    return this.acaoLote(c, lote, entrada, 'retornar');
  }
  cancelarLote(c: ContextoPortaPropria, lote: number, entrada: unknown) {
    return this.acaoLote(c, lote, entrada, 'cancelar');
  }
}
