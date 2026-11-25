// Cancelamento de guia enviada e envio de documentos anexos à operadora pelo TISS 04.03.00 (06-FAT linha 28), no banco
// do cliente. As regras e a montagem das mensagens são as puras de @sgh/dominio-faturamento
// (tiss/cancelamento-documentos.ts); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - solicitar o cancelamento: `cancelamento_guia` em rascunho (estabelecimento, fonte pagadora das guias, motivo,
//     quem e quando pediu) e um `cancelamento_guia_item` pendente por guia, na ordem escolhida. Só guia enviada, aceita
//     ou glosada, de uma operadora, fora de outro pedido vivo;
//   - enviar: a mensagem CANCELA_GUIA é montada dos dados gravados (registro ANS e código do prestador da guia) e o
//     pedido fica 'enviado' com enviado_em; o XML volta para a transmissão. Descartar: só o rascunho, com quem e quando
//     (nada é apagado);
//   - recibo do cancelamento: cada item recebe a situação pelo status do padrão (1 cancelada; 4 em análise; os demais
//     não cancelada) e o código; o pedido fica 'processado' (ou 'recusado' com o erro da operadora), com o protocolo,
//     o retorno e a observação. A guia cancelada pela operadora fica 'cancelada'. As guias em análise recebem depois o
//     retorno complementar;
//   - envio de documentos: os arquivos vão à porta de arquivos (disco local, ADR 0004) e o `envio_documento_tiss`
//     nasce em rascunho com o número de negócio, a guia, o lote e os números da guia, com um
//     `envio_documento_tiss_item` pendente por documento (arquivo, tipo e formato no padrão);
//   - enviar os documentos: uma ENVIO_DOCUMENTO por documento, montada do arquivo guardado; o envio fica 'enviado' e os
//     itens 'enviado'. Cancelar: só o rascunho, que fica 'cancelado';
//   - recibo dos documentos: cada documento recebe o protocolo (aceito) ou o motivo (rejeitado); o envio fica
//     'recebido', 'rejeitado' ou segue 'enviado' enquanto falta resposta, com o protocolo do retorno.
import {
  type Cabecalho,
  conferirEnvioDocumentos,
  conferirPedidoCancelamento,
  conferirReciboCancelamento,
  conferirReciboDocumentos,
  DESCRICAO_STATUS_CANCELAMENTO,
  ErroLoteTiss,
  formatoDocumentoTiss,
  type GuiaParaCancelar,
  mensagemCancelaGuia,
  mensagemEnvioDocumento,
  SITUACAO_DO_STATUS_CANCELAMENTO,
  type SituacaoItemCancelamento,
  type SituacaoItemDocumento,
} from '@sgh/dominio-faturamento';
import { ErroOperacao, type Leitor, type NucleoArmazem } from '@sgh/nucleo';
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
import { type ArquivosDoModulo, arquivosDoAmbiente } from '../arquivos-locais.js';

export const PORTA_CANCELAMENTO_DOCUMENTOS_TISS = Symbol('PORTA_CANCELAMENTO_DOCUMENTOS_TISS');

const TABELAS = [
  'cancelamento_guia',
  'cancelamento_guia_item',
  'envio_documento_tiss',
  'envio_documento_tiss_item',
  'guia_tiss',
  'arquivo',
];

const id = z.number().int().positive();
const versao = z.object({ versao: z.number().int().positive() }).strict();
const esquemaPedido = z
  .object({ guias: z.array(id).min(1).max(100), motivo: z.string().trim().max(1000) })
  .strict();
const esquemaReciboCancelamento = z
  .object({
    versao: z.number().int().positive(),
    protocolo: z.string().trim().max(40).nullable().default(null),
    observacao: z.string().trim().max(2000).nullable().default(null),
    erro: z
      .object({
        codigo: z.string().trim().max(10),
        descricao: z.string().trim().max(500).nullable().default(null),
      })
      .strict()
      .nullable()
      .default(null),
    guias: z
      .array(z.object({ item: id, status: z.string().trim().max(1) }).strict())
      .max(100)
      .default([]),
  })
  .strict();
const esquemaEnvio = z
  .object({
    guia: id,
    observacao: z.string().trim().max(500).nullable().default(null),
    documentos: z
      .array(
        z
          .object({
            nome: z.string().trim().min(1).max(255),
            tipoMime: z.string().trim().max(127),
            conteudoBase64: z.string().max(14_000_000),
            tipoDocumento: z.string().trim().max(2),
            observacao: z.string().trim().max(500).nullable().default(null),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
const esquemaReciboDocumentos = z
  .object({
    versao: z.number().int().positive(),
    protocolo: z.string().trim().max(20).nullable().default(null),
    documentos: z
      .array(
        z
          .object({
            item: id,
            protocolo: z.string().trim().max(20).nullable().default(null),
            erro: z.string().trim().max(500).nullable().default(null),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : (v instanceof Date ? v : new Date(String(v))).toISOString();

function cabecalho(sequencial: number, registroAns: unknown, codigoPrestador: unknown): Cabecalho {
  const agora = new Date().toISOString();
  return {
    sequencialTransacao: String(sequencial),
    data: agora.slice(0, 10),
    hora: agora.slice(11, 19),
    codigoPrestadorNaOperadora: String(codigoPrestador ?? '').trim(),
    registroANS: String(registroAns ?? '').trim(),
  };
}

/** A guia sem registro ANS ou sem o código do hospital na operadora não monta mensagem. */
function faltaDoCabecalho(numero: string, registroAns: unknown, codigo: unknown): string | null {
  if (!/^\d{6}$/.test(String(registroAns ?? '').trim()))
    return `A guia ${numero} não tem o registro ANS da operadora.`;
  if (!String(codigo ?? '').trim()) return `A guia ${numero} não tem o código do hospital na operadora.`;
  return null;
}

export class PortaCancelamentoDocumentosTissPropria extends PortaEstabelecimentoPropria {
  constructor(
    nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0],
    cliente: string,
    /** Porta de arquivos (disco local, ADR 0004) dos documentos; sem ela, o envio de documentos dá 503. */
    private arquivos?: ArquivosDoModulo | null,
  ) {
    super(nucleo, cliente, TABELAS, 'tiss.cancelamento-documentos');
  }

  private arquivosDe(c: ContextoPortaPropria): ArquivosDoModulo {
    if (this.arquivos === undefined)
      this.arquivos = arquivosDoAmbiente(this.nucleo as unknown as NucleoArmazem, this.cliente);
    if (!this.arquivos || !c.hospital)
      throw new ErroOperacao(
        503,
        'indisponivel',
        'Armazenamento de arquivos indisponível',
        'O armazenamento de arquivos não está configurado.',
      );
    return this.arquivos;
  }

  /** A visão da guia: os pedidos de cancelamento e os envios de documentos dela, dos mais recentes. */
  daGuia(c: ContextoPortaPropria, guia: number) {
    return this.ler(c, 'guia', async (l, est) => {
      const g = await l.uma(
        `SELECT id, numero_guia_prestador, numero_guia_operadora, situacao, tipo_guia FROM guia_tiss
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [guia, est.id],
      );
      if (!g) throw naoEncontrado('Guia');
      const cancelamentos = await Promise.all(
        (
          await l.consultar(
            `SELECT cg.id, cg.situacao, cg.motivo, cg.solicitado_em, cg.enviado_em, cg.retorno_em, cg.protocolo_operadora,
                    cg.retorno_observacao, cg.versao, ci.id AS item, ci.situacao AS situacao_item, ci.retorno_codigo
               FROM cancelamento_guia cg JOIN cancelamento_guia_item ci ON ci.cancelamento_guia_id = cg.id
              WHERE ci.guia_tiss_id = ? AND cg.estabelecimento_id = ? AND cg.excluido_em IS NULL AND ci.excluido_em IS NULL
              ORDER BY cg.solicitado_em DESC, cg.id DESC LIMIT 50`,
            [guia, est.id],
          )
        ).map(async (x) => ({
          id: num(x['id']),
          situacao: String(x['situacao']),
          motivo: String(x['motivo']),
          solicitadoEm: iso(x['solicitado_em']),
          enviadoEm: iso(x['enviado_em']),
          retornoEm: iso(x['retorno_em']),
          protocolo: txtOuNull(x['protocolo_operadora']),
          observacao: txtOuNull(x['retorno_observacao']),
          versao: num(x['versao']),
          item: num(x['item']),
          situacaoGuia: String(x['situacao_item']),
          status: txtOuNull(x['retorno_codigo']),
          statusDescricao: DESCRICAO_STATUS_CANCELAMENTO[String(x['retorno_codigo'] ?? '')] ?? null,
          guias: num(
            (
              await l.uma(
                'SELECT COUNT(*) AS n FROM cancelamento_guia_item WHERE cancelamento_guia_id = ? AND excluido_em IS NULL',
                [x['id']],
              )
            )?.['n'],
          ),
        })),
      );
      const envios = await Promise.all(
        (
          await l.consultar(
            `SELECT id, numero_envio, situacao, enviado_em, retorno_em, numero_protocolo_retorno, observacao, versao
               FROM envio_documento_tiss WHERE guia_tiss_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
              ORDER BY id DESC LIMIT 50`,
            [guia, est.id],
          )
        ).map(async (x) => ({
          id: num(x['id']),
          numero: String(x['numero_envio']),
          situacao: String(x['situacao']),
          enviadoEm: iso(x['enviado_em']),
          retornoEm: iso(x['retorno_em']),
          protocolo: txtOuNull(x['numero_protocolo_retorno']),
          observacao: txtOuNull(x['observacao']),
          versao: num(x['versao']),
          documentos: (
            await l.consultar(
              `SELECT i.id, i.sequencia, i.tipo_documento_tiss, i.formato_documento_tiss, i.situacao,
                      i.numero_protocolo_documento, i.observacao, a.nome_original, a.tamanho_bytes
                 FROM envio_documento_tiss_item i JOIN arquivo a ON a.id = i.arquivo_id
                WHERE i.envio_documento_tiss_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
              [x['id']],
            )
          ).map((d) => ({
            item: num(d['id']),
            sequencia: num(d['sequencia']),
            tipoDocumento: txtOuNull(d['tipo_documento_tiss']),
            formato: txtOuNull(d['formato_documento_tiss']),
            situacao: String(d['situacao']),
            protocolo: txtOuNull(d['numero_protocolo_documento']),
            observacao: txtOuNull(d['observacao']),
            nome: String(d['nome_original']),
            tamanho: num(d['tamanho_bytes']),
          })),
        })),
      );
      return {
        guia: {
          id: num(g['id']),
          numeroGuiaPrestador: String(g['numero_guia_prestador']),
          numeroGuiaOperadora: txtOuNull(g['numero_guia_operadora']),
          situacao: String(g['situacao']),
          tipo: String(g['tipo_guia']),
        },
        cancelamentos,
        envios,
      };
    });
  }

  // ------------------------------------------------------------------ cancelamento

  solicitarCancelamento(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number; guias: number }> {
    const e = entradaValida(esquemaPedido, entrada);
    return this.gravar(
      c,
      'tiss.cancelamento-guia.solicitar',
      ['cancelamento_guia', 'cancelamento_guia_item'],
      async (tx, est, usuario) => {
        const guias: GuiaParaCancelar[] = [];
        const contas = new Set<number>();
        for (const g of e.guias) {
          const r = await tx.uma(
            `SELECT gt.id, gt.numero_guia_prestador, gt.situacao, gt.fonte_pagadora_id, gt.conta_hospitalar_id,
                    (SELECT COUNT(*) FROM cancelamento_guia_item ci JOIN cancelamento_guia cg ON cg.id = ci.cancelamento_guia_id
                      WHERE ci.guia_tiss_id = gt.id AND ci.excluido_em IS NULL AND cg.excluido_em IS NULL
                        AND cg.situacao IN ('rascunho','enviado','processado') AND ci.situacao IN ('pendente','em_analise','cancelada')
                    ) AS vivos
               FROM guia_tiss gt WHERE gt.id = ? AND gt.estabelecimento_id = ? AND gt.excluido_em IS NULL`,
            [g, est.id],
          );
          if (!r) throw naoEncontrado('Guia');
          contas.add(num(r['conta_hospitalar_id']));
          guias.push({
            id: g,
            numeroGuiaPrestador: String(r['numero_guia_prestador']),
            situacao: String(r['situacao']),
            fontePagadora: num(r['fonte_pagadora_id']),
            emPedidoVivo: num(r['vivos']) > 0,
          });
        }
        const problemas = conferirPedidoCancelamento({ guias, motivo: e.motivo });
        if (problemas.length) throw recusaRegra('Pedido de cancelamento recusado', problemas);
        const novo = await tx.incluir('cancelamento_guia', {
          estabelecimento_id: est.id,
          fonte_pagadora_id: guias[0]!.fontePagadora,
          conta_hospitalar_id: contas.size === 1 ? [...contas][0]! : null,
          motivo: e.motivo,
          situacao: 'rascunho',
          solicitado_em: new Date(),
          solicitado_por_usuario_id: usuario,
        });
        let sequencia = 0;
        for (const g of guias)
          await tx.incluir('cancelamento_guia_item', {
            cancelamento_guia_id: novo,
            sequencia: ++sequencia,
            guia_tiss_id: g.id,
            situacao: 'pendente',
          });
        return { tabela: 'cancelamento_guia', id: novo, guias: guias.length };
      },
    );
  }

  /** Monta a CANCELA_GUIA dos dados gravados (a mesma na prévia e no envio). */
  private async montarCancelamento(l: Leitor, cancelamento: number) {
    const guias = await l.consultar(
      `SELECT gt.numero_guia_prestador, gt.numero_guia_operadora, gt.registro_ans, gt.codigo_prestador_operadora,
              lt.numero_protocolo
         FROM cancelamento_guia_item ci JOIN guia_tiss gt ON gt.id = ci.guia_tiss_id
         LEFT JOIN lote_tiss lt ON lt.id = gt.lote_tiss_id
        WHERE ci.cancelamento_guia_id = ? AND ci.excluido_em IS NULL ORDER BY ci.sequencia`,
      [cancelamento],
    );
    const primeira = guias[0];
    const falta = primeira
      ? faltaDoCabecalho(
          String(primeira['numero_guia_prestador']),
          primeira['registro_ans'],
          primeira['codigo_prestador_operadora'],
        )
      : 'O pedido não tem guias.';
    if (falta) return { xml: null, problemas: [{ campo: 'guia', mensagem: falta }] };
    try {
      const m = mensagemCancelaGuia(
        cabecalho(cancelamento, primeira!['registro_ans'], primeira!['codigo_prestador_operadora']),
        guias.map((g) => ({
          numeroGuiaPrestador: String(g['numero_guia_prestador']),
          numeroGuiaOperadora: txtOuNull(g['numero_guia_operadora']),
          numeroProtocolo: txtOuNull(g['numero_protocolo'])?.slice(0, 12) ?? null,
        })),
      );
      return { xml: m.xml, problemas: [] };
    } catch (erro) {
      if (erro instanceof ErroLoteTiss)
        return { xml: null, problemas: [{ campo: 'mensagem', mensagem: erro.message }] };
      throw erro;
    }
  }

  mensagemCancelamento(c: ContextoPortaPropria, cancelamento: number) {
    return this.ler(c, 'cancelamento.mensagem', async (l, est) => {
      if (
        !(await l.uma(
          'SELECT id FROM cancelamento_guia WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [cancelamento, est.id],
        ))
      )
        throw naoEncontrado('Pedido de cancelamento');
      return this.montarCancelamento(l, cancelamento);
    });
  }

  enviarCancelamento(
    c: ContextoPortaPropria,
    cancelamento: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: string; xml: string }> {
    const e = entradaValida(versao, entrada);
    return this.gravar(c, 'tiss.cancelamento-guia.enviar', ['cancelamento_guia'], async (tx, est) => {
      const r = await tx.uma(
        'SELECT situacao FROM cancelamento_guia WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [cancelamento, est.id],
      );
      if (!r) throw naoEncontrado('Pedido de cancelamento');
      if (r['situacao'] !== 'rascunho')
        throw recusaRegra('Envio recusado', [{ campo: 'situacao', mensagem: 'Só o rascunho é enviado.' }]);
      const m = await this.montarCancelamento(tx, cancelamento);
      if (!m.xml) throw recusaRegra('Envio recusado', m.problemas);
      await tx.alterar('cancelamento_guia', cancelamento, e.versao, {
        situacao: 'enviado',
        enviado_em: new Date(),
      });
      return { tabela: 'cancelamento_guia', id: cancelamento, situacao: 'enviado', xml: m.xml };
    });
  }

  descartarCancelamento(c: ContextoPortaPropria, cancelamento: number, entrada: unknown) {
    const e = entradaValida(versao, entrada);
    return this.gravar(
      c,
      'tiss.cancelamento-guia.descartar',
      ['cancelamento_guia'],
      async (tx, est, usuario) => {
        const r = await tx.uma(
          'SELECT situacao FROM cancelamento_guia WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [cancelamento, est.id],
        );
        if (!r) throw naoEncontrado('Pedido de cancelamento');
        if (r['situacao'] !== 'rascunho')
          throw recusaRegra('Descarte recusado', [
            { campo: 'situacao', mensagem: 'Só o rascunho é descartado: o pedido enviado aguarda o recibo.' },
          ]);
        await tx.alterar('cancelamento_guia', cancelamento, e.versao, {
          situacao: 'descartado',
          descartado_em: new Date(),
          descartado_por_usuario_id: usuario,
        });
        return { tabela: 'cancelamento_guia', id: cancelamento, situacao: 'descartado' };
      },
    );
  }

  reciboCancelamento(
    c: ContextoPortaPropria,
    cancelamento: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: string; canceladas: number }> {
    const e = entradaValida(esquemaReciboCancelamento, entrada);
    return this.gravar(
      c,
      'tiss.cancelamento-guia.recibo',
      ['cancelamento_guia', 'cancelamento_guia_item', 'guia_tiss'],
      async (tx, est) => {
        const r = await tx.uma(
          'SELECT situacao FROM cancelamento_guia WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [cancelamento, est.id],
        );
        if (!r) throw naoEncontrado('Pedido de cancelamento');
        const itens = await tx.consultar(
          `SELECT ci.id, ci.situacao, ci.versao, ci.guia_tiss_id, gt.versao AS versao_guia
             FROM cancelamento_guia_item ci JOIN guia_tiss gt ON gt.id = ci.guia_tiss_id
            WHERE ci.cancelamento_guia_id = ? AND ci.excluido_em IS NULL`,
          [cancelamento],
        );
        const conferido = conferirReciboCancelamento(
          String(r['situacao']),
          itens.map((i) => ({
            id: num(i['id']),
            situacao: String(i['situacao']) as SituacaoItemCancelamento,
          })),
          { erro: e.erro, guias: e.guias },
        );
        if (!conferido.situacao) throw recusaRegra('Recibo recusado', conferido.problemas);
        let canceladas = 0;
        for (const g of e.guias) {
          const i = itens.find((x) => num(x['id']) === g.item)!;
          const situacao = SITUACAO_DO_STATUS_CANCELAMENTO[g.status]!;
          await tx.alterar('cancelamento_guia_item', g.item, num(i['versao']), {
            situacao,
            retorno_codigo: g.status,
            retorno_observacao: DESCRICAO_STATUS_CANCELAMENTO[g.status] ?? null,
          });
          if (situacao === 'cancelada') {
            canceladas++;
            await tx.alterar('guia_tiss', num(i['guia_tiss_id']), num(i['versao_guia']), {
              situacao: 'cancelada',
            });
          }
        }
        const observacao = e.erro
          ? `Erro ${e.erro.codigo}${e.erro.descricao ? `: ${e.erro.descricao}` : ''}`
          : e.observacao;
        await tx.alterar('cancelamento_guia', cancelamento, e.versao, {
          situacao: conferido.situacao,
          retorno_em: new Date(),
          ...(e.protocolo ? { protocolo_operadora: e.protocolo } : {}),
          ...(observacao ? { retorno_observacao: observacao } : {}),
        });
        return { tabela: 'cancelamento_guia', id: cancelamento, situacao: conferido.situacao, canceladas };
      },
    );
  }

  // ------------------------------------------------------------------ documentos anexos

  async registrarEnvio(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; numero: string; documentos: number }> {
    const e = entradaValida(esquemaEnvio, entrada);
    const conteudos = e.documentos.map((d) => Buffer.from(d.conteudoBase64, 'base64'));
    const situacaoGuia = await this.ler(c, 'envio.guia', async (l, est) => {
      const g = await l.uma(
        'SELECT situacao FROM guia_tiss WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.guia, est.id],
      );
      if (!g) throw naoEncontrado('Guia');
      return String(g['situacao']);
    });
    const problemas = conferirEnvioDocumentos({
      situacaoGuia,
      documentos: e.documentos.map((d, i) => ({
        tipoMime: d.tipoMime,
        tamanho: conteudos[i]!.length,
        tipoDocumento: d.tipoDocumento,
      })),
    });
    if (problemas.length) throw recusaRegra('Envio de documentos recusado', problemas);
    // O arquivo vai ao disco antes do registro (o mesmo conteúdo reaproveita o arquivo, pelo hash).
    const arquivos: number[] = [];
    for (const [i, d] of e.documentos.entries())
      arquivos.push(
        (
          await this.arquivosDe(c).guardar(c.hospital, {
            conteudo: conteudos[i]!,
            nomeOriginal: d.nome,
            tipoMime: d.tipoMime.toLowerCase(),
            finalidade: 'anexo_tiss',
            entidade: 'envio_documento_tiss',
          })
        ).id,
      );
    return this.gravar(
      c,
      'tiss.documentos.registrar',
      ['envio_documento_tiss', 'envio_documento_tiss_item'],
      async (tx, est) => {
        const g = await tx.uma(
          `SELECT gt.id, gt.fonte_pagadora_id, gt.conta_hospitalar_id, gt.lote_tiss_id, gt.tipo_guia, gt.numero_guia_prestador,
                  gt.numero_guia_operadora, ch.atendimento_id, lt.numero_protocolo
             FROM guia_tiss gt JOIN conta_hospitalar ch ON ch.id = gt.conta_hospitalar_id
             LEFT JOIN lote_tiss lt ON lt.id = gt.lote_tiss_id
            WHERE gt.id = ? AND gt.estabelecimento_id = ? AND gt.excluido_em IS NULL`,
          [e.guia, est.id],
        );
        if (!g) throw naoEncontrado('Guia');
        const n = num(
          (
            await tx.uma('SELECT COUNT(*) AS n FROM envio_documento_tiss WHERE estabelecimento_id = ?', [
              est.id,
            ])
          )?.['n'],
        );
        const numero = `D${String(n + 1).padStart(7, '0')}`;
        const tipo = String(g['tipo_guia']).replace('resumo_internacao', 'internacao').replace('-', '_');
        const novo = await tx.incluir('envio_documento_tiss', {
          estabelecimento_id: est.id,
          fonte_pagadora_id: num(g['fonte_pagadora_id']),
          atendimento_id: numOuNull(g['atendimento_id']),
          conta_hospitalar_id: num(g['conta_hospitalar_id']),
          guia_tiss_id: e.guia,
          lote_tiss_id: numOuNull(g['lote_tiss_id']),
          numero_envio: numero,
          tipo_guia: [
            'consulta',
            'sp_sadt',
            'internacao',
            'honorario',
            'odontologia',
            'outras_despesas',
          ].includes(tipo)
            ? tipo
            : null,
          numero_guia_prestador: String(g['numero_guia_prestador']),
          numero_guia_operadora: txtOuNull(g['numero_guia_operadora']),
          numero_protocolo_lote: txtOuNull(g['numero_protocolo']),
          situacao: 'rascunho',
          observacao: e.observacao,
        });
        for (const [i, d] of e.documentos.entries())
          await tx.incluir('envio_documento_tiss_item', {
            envio_documento_tiss_id: novo,
            sequencia: i + 1,
            arquivo_id: arquivos[i]!,
            tipo_documento_tiss: d.tipoDocumento,
            formato_documento_tiss: formatoDocumentoTiss(d.tipoMime),
            numero_documento: `${numero}-${i + 1}`,
            situacao: 'pendente',
            observacao: d.observacao,
          });
        return { tabela: 'envio_documento_tiss', id: novo, numero, documentos: e.documentos.length };
      },
    );
  }

  /** As ENVIO_DOCUMENTO do envio, uma por documento, montadas do arquivo guardado. */
  private async montarDocumentos(c: ContextoPortaPropria, l: Leitor, envio: number) {
    const cab = await l.uma(
      `SELECT e.id, e.numero_guia_prestador, e.numero_guia_operadora, e.numero_protocolo_lote, lt.numero_lote,
              gt.registro_ans, gt.codigo_prestador_operadora
         FROM envio_documento_tiss e LEFT JOIN guia_tiss gt ON gt.id = e.guia_tiss_id
         LEFT JOIN lote_tiss lt ON lt.id = e.lote_tiss_id WHERE e.id = ?`,
      [envio],
    );
    const numeroGuia = String(cab?.['numero_guia_prestador'] ?? '');
    const falta = faltaDoCabecalho(numeroGuia, cab?.['registro_ans'], cab?.['codigo_prestador_operadora']);
    if (falta) return { mensagens: [], problemas: [{ campo: 'guia', mensagem: falta }] };
    const itens = await l.consultar(
      `SELECT id, arquivo_id, numero_documento, tipo_documento_tiss, formato_documento_tiss, observacao
         FROM envio_documento_tiss_item WHERE envio_documento_tiss_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
      [envio],
    );
    const mensagens: { item: number; xml: string }[] = [];
    try {
      for (const i of itens) {
        const a = await this.arquivosDe(c).ler(c.hospital, num(i['arquivo_id']));
        if (!a) throw naoEncontrado('Documento');
        const m = mensagemEnvioDocumento(
          cabecalho(num(i['id']), cab!['registro_ans'], cab!['codigo_prestador_operadora']),
          {
            numeroLote: txtOuNull(cab!['numero_lote'])?.slice(0, 12) ?? null,
            numeroProtocolo: txtOuNull(cab!['numero_protocolo_lote'])?.slice(0, 12) ?? null,
            numeroGuiaPrestador: numeroGuia,
            numeroGuiaOperadora: txtOuNull(cab!['numero_guia_operadora']),
            numeroDocumento: String(i['numero_documento']),
            naturezaGuia: '2',
            formatoDocumento: String(i['formato_documento_tiss'] ?? ''),
            conteudo: a.conteudo,
            tipoDocumento: String(i['tipo_documento_tiss'] ?? ''),
            observacao: txtOuNull(i['observacao']),
          },
        );
        mensagens.push({ item: num(i['id']), xml: m.xml });
      }
    } catch (erro) {
      if (erro instanceof ErroLoteTiss)
        return { mensagens: [], problemas: [{ campo: 'mensagem', mensagem: erro.message }] };
      throw erro;
    }
    return { mensagens, problemas: [] };
  }

  mensagensEnvio(c: ContextoPortaPropria, envio: number) {
    return this.ler(c, 'documentos.mensagem', async (l, est) => {
      if (
        !(await l.uma(
          'SELECT id FROM envio_documento_tiss WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [envio, est.id],
        ))
      )
        throw naoEncontrado('Envio de documentos');
      return this.montarDocumentos(c, l, envio);
    });
  }

  async enviarDocumentos(
    c: ContextoPortaPropria,
    envio: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: string; mensagens: { item: number; xml: string }[] }> {
    const e = entradaValida(versao, entrada);
    const montadas = await this.mensagensEnvio(c, envio);
    if (montadas.problemas.length) throw recusaRegra('Envio recusado', montadas.problemas);
    return this.gravar(
      c,
      'tiss.documentos.enviar',
      ['envio_documento_tiss', 'envio_documento_tiss_item'],
      async (tx, est) => {
        const r = await tx.uma(
          'SELECT situacao FROM envio_documento_tiss WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [envio, est.id],
        );
        if (!r) throw naoEncontrado('Envio de documentos');
        if (r['situacao'] !== 'rascunho')
          throw recusaRegra('Envio recusado', [{ campo: 'situacao', mensagem: 'Só o rascunho é enviado.' }]);
        for (const i of await tx.consultar(
          'SELECT id, versao FROM envio_documento_tiss_item WHERE envio_documento_tiss_id = ? AND excluido_em IS NULL',
          [envio],
        ))
          await tx.alterar('envio_documento_tiss_item', num(i['id']), num(i['versao']), {
            situacao: 'enviado',
          });
        await tx.alterar('envio_documento_tiss', envio, e.versao, {
          situacao: 'enviado',
          enviado_em: new Date(),
        });
        return {
          tabela: 'envio_documento_tiss',
          id: envio,
          situacao: 'enviado',
          mensagens: montadas.mensagens,
        };
      },
    );
  }

  cancelarEnvio(c: ContextoPortaPropria, envio: number, entrada: unknown) {
    const e = entradaValida(versao, entrada);
    return this.gravar(c, 'tiss.documentos.cancelar', ['envio_documento_tiss'], async (tx, est) => {
      const r = await tx.uma(
        'SELECT situacao FROM envio_documento_tiss WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [envio, est.id],
      );
      if (!r) throw naoEncontrado('Envio de documentos');
      if (r['situacao'] !== 'rascunho')
        throw recusaRegra('Cancelamento recusado', [
          { campo: 'situacao', mensagem: 'Só o rascunho é cancelado: o envio já saiu.' },
        ]);
      await tx.alterar('envio_documento_tiss', envio, e.versao, { situacao: 'cancelado' });
      return { tabela: 'envio_documento_tiss', id: envio, situacao: 'cancelado' };
    });
  }

  reciboDocumentos(
    c: ContextoPortaPropria,
    envio: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: string }> {
    const e = entradaValida(esquemaReciboDocumentos, entrada);
    return this.gravar(
      c,
      'tiss.documentos.recibo',
      ['envio_documento_tiss', 'envio_documento_tiss_item'],
      async (tx, est) => {
        const r = await tx.uma(
          'SELECT situacao FROM envio_documento_tiss WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [envio, est.id],
        );
        if (!r) throw naoEncontrado('Envio de documentos');
        const itens = await tx.consultar(
          'SELECT id, situacao, versao FROM envio_documento_tiss_item WHERE envio_documento_tiss_id = ? AND excluido_em IS NULL',
          [envio],
        );
        const conferido = conferirReciboDocumentos(
          String(r['situacao']),
          itens.map((i) => ({ id: num(i['id']), situacao: String(i['situacao']) as SituacaoItemDocumento })),
          e.documentos,
        );
        if (!conferido.situacao) throw recusaRegra('Recibo recusado', conferido.problemas);
        for (const d of e.documentos) {
          const i = itens.find((x) => num(x['id']) === d.item)!;
          await tx.alterar(
            'envio_documento_tiss_item',
            d.item,
            num(i['versao']),
            d.protocolo
              ? { situacao: 'aceito', numero_protocolo_documento: d.protocolo }
              : { situacao: 'rejeitado', observacao: d.erro },
          );
        }
        await tx.alterar('envio_documento_tiss', envio, e.versao, {
          situacao: conferido.situacao,
          ...(conferido.situacao !== 'enviado' ? { retorno_em: new Date() } : {}),
          ...(e.protocolo ? { numero_protocolo_retorno: e.protocolo } : {}),
        });
        return { tabela: 'envio_documento_tiss', id: envio, situacao: conferido.situacao };
      },
    );
  }
}
