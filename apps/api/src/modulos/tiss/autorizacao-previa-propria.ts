// Solicitação eletrônica de autorização prévia à operadora (F78.06-2, 06-FAT linhas 25 e 27), no banco do cliente. As
// regras são as puras de @sgh/dominio-faturamento (tiss/autorizacao-previa.ts); aqui ficam a leitura e a gravação.
// Contrato de efeito:
//   - criar: `solicitacao_autorizacao` 'rascunho' com o número da sequência do estabelecimento, a carteira copiada da
//     cobertura (fonte, plano, validade), o solicitante e os itens em `solicitacao_autorizacao_item` (sequência 1..n,
//     OPME com registro na Anvisa ou fabricante); o limite de OPME vigente do procedimento na fonte pagadora
//     (`limite_opme_procedimento`) é conferido antes de gravar;
//   - enviar: no canal webservice, a mensagem SOLICITACAO_PROCEDIMENTOS é montada, validada no XSD 04.03.00 e guardada
//     no disco pela porta de arquivos (imutável, ADR 0004; registro em `arquivo`, ligado em arquivo_id, com a versão do
//     padrão em versao_padrao_tiss_id e o sequencial da transação) e o pedido fica 'pronta_envio', SEM enviada_em: não
//     há transmissão ao webservice da operadora em nenhum ambiente, e nada é dado como enviado sem ter saído. Pelos
//     outros canais (portal, telefone, e-mail, presencial) fica 'enviada' com o canal registrado;
//   - registrarTransmissao: o pedido 'pronta_envio' fica 'enviada' com o canal real usado para levar o XML guardado à
//     operadora e o instante; a rota xml serve os bytes guardados (conferidos pelo SHA-256 do registro), nunca remonta;
//   - transmitirWebservice: pela central de integrações externas (decisão 53); no simulador, o aceite deixa o pedido
//     'enviada' (canal webservice, enviada_em, transmissao_modo e protocolo_transmissao, migração 12_FAT/99zt) e a
//     recusa ou o erro de transporte o mantém 'pronta_envio' com falha_transmissao; o real depende da definição do
//     fornecedor e recusa (503) com a falha registrada na central;
//   - responder: `resposta_autorizacao` + `resposta_autorizacao_item` (quantidade e valor autorizados por item, negativa
//     com motivo); o pedido muda para a situação derivada dos itens, cada item pedido guarda a quantidade autorizada,
//     a senha vai à conta hospitalar ligada que ainda não tem senha e a consulta de andamento aberta fica respondida;
//   - criar também grava as hipóteses diagnósticas em `solicitacao_autorizacao_diagnostico` (CID-10 do catálogo oficial,
//     sequência 1 é a principal; a internação não nasce sem CID) e a mensagem da internação leva os CIDs; a prorrogação
//     da internação sai na guia eletrônica própria (solicitacaoProrrogacao), referenciando a guia da internação pelo
//     número na operadora (ou o do hospital, sem resposta ainda);
//   - ligarConta: cada item autorizado da última resposta cobre os itens da conta ligada do mesmo item faturável, em
//     `conta_hospitalar_item_autorizacao` (sequencial do item na guia e quantidade coberta); refazer não duplica;
//   - consultarAndamento: nova linha em `consulta_situacao_autorizacao` (tentativa seguinte, próxima consulta marcada);
//   - cancelar: o pedido fica 'cancelado' com o motivo na observação; o que não saiu segue sem enviada_em (CHECK da
//     migração 12_FAT/99_autorizacao_envio). Nada se apaga.
import {
  avaliarLimiteOpme,
  casarAutorizacaoComConta,
  conferirDiagnosticosAutorizacao,
  conferirPedidoAutorizacao,
  conferirPedidoDeLiberacao,
  conferirProcedimentoDaOpme,
  type DadosMensagemSolicitacao,
  faltasParaMensagem,
  type ItemPedidoAutorizacao,
  lerRespostaAutorizacao,
  mensagemSolicitacaoAutorizacao,
  cidDoPedido,
  podeMudar,
  proximaConsultaAndamento,
  SITUACOES_EM_ANDAMENTO,
  type SituacaoSolicitacaoAutorizacao,
  TIPOS_SOLICITACAO_AUTORIZACAO,
  type TipoSolicitacaoAutorizacao,
  VERSAO_TISS,
} from '@sgh/dominio-faturamento';
import {
  conferirConferenciaParcial,
  conferirExcecaoUrgencia,
  etapaAutorizacaoCirurgia,
  type GuiaDaCirurgia,
} from '@sgh/dominio-cirurgia';
import { respostaSimulada } from '@sgh/dominio-integracao';
import { ErroOperacao, type Leitor, sha256, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import { modoDaIntegracao } from '../integracao/externas/servico.js';
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
import {
  type ArmazemXmlTiss,
  ErroSobrescritaXml,
  registrarArquivoGuardado,
  retencaoAte,
} from './armazem-xml.js';
import {
  abrirLiberacaoOpme,
  gravarOpmeAutorizada,
  liberacaoQueRetem,
  TABELAS_LIBERACAO_OPME,
  TABELAS_OPME_AUTORIZADA,
} from './opme-guia-propria.js';
import { solicitanteQueRespondeHoje } from '../cadastro/solicitante-vigente.js';
import { diaCivil } from './elegibilidade-propria.js';

export const PORTA_AUTORIZACAO_PREVIA = Symbol('PORTA_AUTORIZACAO_PREVIA');

const TABELAS = [
  ...TABELAS_LIBERACAO_OPME,
  ...TABELAS_OPME_AUTORIZADA,
  'solicitacao_autorizacao',
  'solicitacao_autorizacao_item',
  'solicitacao_autorizacao_diagnostico',
  'conta_hospitalar_item_autorizacao',
  'conta_hospitalar_item',
  'resposta_autorizacao',
  'resposta_autorizacao_item',
  'consulta_situacao_autorizacao',
  'conta_hospitalar',
  'sequencia_negocio',
  'arquivo',
  'agendamento_cirurgico',
];
/** Situações do agendamento em que a cirurgia ainda pode receber a guia (C1-117, 04-CC linha 102). */
const CIRURGIA_EM_ABERTO = "('solicitado','em_analise','agendado','confirmado')";
const SEQUENCIA = 'solicitacao_autorizacao';

const id = z.number().int().positive();
const texto = (n: number) => z.string().trim().max(n).nullable().default(null);
const esquemaItem = z
  .object({
    itemFaturavel: id.nullable().default(null),
    codigoTabela: z.string().trim().max(2),
    codigoProcedimento: z.string().trim().max(20),
    descricao: z.string().trim().max(150),
    quantidade: z.number(),
    valorUnitario: z.number().nullable().default(null),
    opme: z.boolean().default(false),
    registroAnvisa: texto(15),
    fabricante: id.nullable().default(null),
    referenciaFabricante: texto(60),
    opcaoFabricante: z.number().int().min(1).max(3).nullable().default(null),
    justificativa: texto(1000),
  })
  .strict();
const esquemaCriar = z
  .object({
    tipo: z.enum(TIPOS_SOLICITACAO_AUTORIZACAO),
    cobertura: id,
    atendimento: id.nullable().default(null),
    conta: id.nullable().default(null),
    /** A cirurgia agendada que a guia autoriza (04-CC linha 102): a senha da resposta vai ao agendamento. */
    agendamentoCirurgico: id.nullable().default(null),
    principal: id.nullable().default(null),
    solicitanteProfissional: id.nullable().default(null),
    solicitanteExterno: id.nullable().default(null),
    urgencia: z.boolean().default(false),
    regime: z.enum(['hospitalar', 'hospital_dia', 'domiciliar']).nullable().default(null),
    diarias: z.number().int().nullable().default(null),
    dataAdmissao: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    indicacaoClinica: texto(1000),
    acidente: z.enum(['trabalho', 'transito', 'outros', 'nao_acidente']).nullable().default(null),
    canal: z.enum(['webservice', 'portal', 'telefone', 'email', 'presencial']).default('webservice'),
    observacao: texto(1000),
    /** Justificativa de quem pede a OPME acima do limite do procedimento: o pedido nasce retido até a alçada liberar. */
    justificativaLimite: texto(1000),
    itens: z.array(esquemaItem).max(99),
    /** Hipóteses diagnósticas (CID-10); a primeira é a principal. */
    diagnosticos: z
      .array(
        z
          .object({
            cid: z.string().trim().max(10),
            tipoDoenca: z.enum(['aguda', 'cronica']).nullable().default(null),
            tempo: z.number().nullable().default(null),
            unidadeTempo: z.enum(['dia', 'mes', 'ano']).nullable().default(null),
          })
          .strict(),
      )
      .max(10)
      .default([]),
  })
  .strict();
const esquemaUrgencia = z
  .object({ versao: z.number().int().positive(), justificativa: z.string().trim().max(500) })
  .strict();
const INTEGRACAO_TISS_WEBSERVICE = 'operadora-tiss-webservice';
const esquemaVersao = z.object({ versao: z.number().int().positive() }).strict();
const esquemaTransmissao = z
  .object({
    versao: z.number().int().positive(),
    /** O canal real por onde o XML guardado chegou à operadora (não há transmissão ao webservice). */
    canal: z.enum(['portal', 'email', 'telefone', 'presencial']),
  })
  .strict();
const esquemaCancelar = z
  .object({ versao: z.number().int().positive(), motivo: z.string().trim().min(3).max(300) })
  .strict();
const esquemaResposta = z
  .object({
    situacao: z.enum(['em_analise', 'aguardando_documentacao', 'cancelado']).nullable().default(null),
    senha: texto(20),
    numeroGuiaOperadora: texto(20),
    dataAutorizacao: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    senhaValidade: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    canal: z.enum(['webservice', 'portal', 'telefone', 'email', 'presencial']).default('portal'),
    justificativa: texto(1000),
    itens: z
      .array(
        z
          .object({
            sequencia: z.number().int().positive(),
            quantidadeAutorizada: z.number(),
            valorAutorizado: z.number().nullable().default(null),
            motivoNegativa: texto(1000),
            motivoGlosa: id.nullable().default(null),
          })
          .strict(),
      )
      .max(99)
      .default([]),
    versao: z.number().int().positive(),
  })
  .strict();

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : (v instanceof Date ? v : new Date(String(v))).toISOString();
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const horaCivil = (d: Date, fuso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: fuso,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);

type Consulta = Pick<Leitor, 'uma' | 'consultar'>;

export class PortaAutorizacaoPreviaPropria extends PortaEstabelecimentoPropria {
  constructor(
    nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0],
    cliente: string,
    private readonly armazem: ArmazemXmlTiss | null = null,
  ) {
    super(nucleo, cliente, TABELAS, 'tiss.autorizacao');
  }

  /** Visão por paciente: as coberturas ativas e os pedidos, dos mais recentes, com a última resposta. */
  doPaciente(c: ContextoPortaPropria, paciente: number) {
    return this.ler(c, 'paciente', async (l, est) => {
      const coberturas = (
        await l.consultar(
          `SELECT cp.id, cp.numero_carteira, cp.validade, fp.nome AS fonte FROM cobertura_paciente cp
             JOIN fonte_pagadora fp ON fp.id = cp.fonte_pagadora_id
            WHERE cp.paciente_id = ? AND cp.excluido_em IS NULL AND cp.situacao = 'ativa' ORDER BY cp.principal DESC, cp.id`,
          [paciente],
        )
      ).map((x) => ({
        id: num(x['id']),
        fontePagadora: String(x['fonte']),
        carteira: txtOuNull(x['numero_carteira']),
        validade: dataIso(x['validade']),
      }));
      const ids = (
        await l.consultar(
          `SELECT id FROM solicitacao_autorizacao WHERE paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
            ORDER BY solicitada_em DESC, id DESC LIMIT 50`,
          [paciente, est.id],
        )
      ).map((x) => num(x['id']));
      const pedidos = [];
      for (const i of ids) pedidos.push(await this.montarDetalhe(l, est.id, i));
      const cirurgias = [];
      for (const x of await l.consultar(
        `SELECT a.id FROM agendamento_cirurgico a
          WHERE a.paciente_id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.tipo_cobertura = 'convenio'
            AND a.situacao IN ${CIRURGIA_EM_ABERTO}
          ORDER BY a.inicio_previsto_em IS NULL, a.inicio_previsto_em, a.id LIMIT 30`,
        [paciente, est.id],
      ))
        cirurgias.push(await this.montarCirurgia(l, est.id, num(x['id'])));
      return { coberturas, pedidos, cirurgias };
    });
  }

  /** A autorização da cirurgia agendada por etapas: a guia ligada, a senha e a exceção de urgência registrada. */
  daCirurgia(c: ContextoPortaPropria, agendamento: number) {
    return this.ler(c, 'cirurgia', (l, est) => this.montarCirurgia(l, est.id, agendamento));
  }

  /**
   * A exceção de urgência (04-CC linha 102): a cirurgia de urgência de convênio ainda sem senha fica liberada para o
   * bloco com a justificativa, o instante e o usuário gravados no agendamento; a guia é comunicada à operadora depois.
   */
  registrarUrgencia(
    c: ContextoPortaPropria,
    agendamento: number,
    entrada: unknown,
  ): Promise<{ id: number; etapa: string }> {
    const e = entradaValida(esquemaUrgencia, entrada);
    return this.gravar(
      c,
      'tiss.autorizacao.urgencia',
      ['agendamento_cirurgico'],
      async (tx, est, usuario) => {
        const atual = await this.montarCirurgia(tx, est.id, agendamento);
        const a = await tx.uma('SELECT tipo_cobertura, versao FROM agendamento_cirurgico WHERE id = ?', [
          agendamento,
        ]);
        const vigente = atual.guias.find((g) => g.situacao !== 'cancelada') ?? null;
        const problemas = conferirExcecaoUrgencia(
          {
            tipoCobertura: String(a?.['tipo_cobertura']),
            natureza: atual.natureza,
            senha: atual.senha,
            guia: vigente ? { situacao: vigente.situacao, senha: vigente.senha } : null,
          },
          e.justificativa,
        );
        if (atual.autorizacaoPosterior)
          problemas.push({ campo: 'agendamento', mensagem: 'A exceção de urgência já está registrada.' });
        if (!['solicitado', 'em_analise', 'agendado', 'confirmado'].includes(atual.situacao))
          problemas.push({
            campo: 'agendamento',
            mensagem: 'A cirurgia já foi realizada, suspensa ou cancelada.',
          });
        if (problemas.length) throw recusaRegra('Exceção recusada', problemas);
        await tx.alterar('agendamento_cirurgico', agendamento, e.versao, {
          autorizacao_posterior_justificativa: e.justificativa.trim(),
          autorizacao_posterior_em: new Date(),
          autorizacao_posterior_por: usuario,
        });
        return { tabela: 'agendamento_cirurgico', id: agendamento, etapa: atual.etapa };
      },
    );
  }

  /**
   * A conferência da autorização parcial (04-CC linha 102): a operadora autorizou só parte da guia ligada; a cirurgia
   * só é confirmada e só entra no bloco depois que alguém registra o que segue autorizado e o que foi retirado ou
   * complementado, com o instante e o usuário gravados no agendamento.
   */
  registrarConferenciaParcial(
    c: ContextoPortaPropria,
    agendamento: number,
    entrada: unknown,
  ): Promise<{ id: number; etapa: string }> {
    const e = entradaValida(esquemaUrgencia, entrada);
    return this.gravar(c, 'tiss.autorizacao.parcial', ['agendamento_cirurgico'], async (tx, est, usuario) => {
      const atual = await this.montarCirurgia(tx, est.id, agendamento);
      const a = await tx.uma('SELECT tipo_cobertura FROM agendamento_cirurgico WHERE id = ?', [agendamento]);
      const vigente = atual.guias.find((g) => g.situacao !== 'cancelada') ?? null;
      const problemas = conferirConferenciaParcial(
        {
          tipoCobertura: String(a?.['tipo_cobertura']),
          natureza: atual.natureza,
          senha: atual.senha,
          guia: vigente ? { situacao: vigente.situacao, senha: vigente.senha } : null,
          parcialConferida: atual.conferenciaParcial !== null,
        },
        e.justificativa,
      );
      if (!['solicitado', 'em_analise', 'agendado', 'confirmado'].includes(atual.situacao))
        problemas.push({
          campo: 'agendamento',
          mensagem: 'A cirurgia já foi realizada, suspensa ou cancelada.',
        });
      if (problemas.length) throw recusaRegra('Conferência recusada', problemas);
      await tx.alterar('agendamento_cirurgico', agendamento, e.versao, {
        autorizacao_parcial_conferencia: e.justificativa.trim(),
        autorizacao_parcial_conferida_em: new Date(),
        autorizacao_parcial_conferida_por: usuario,
      });
      return { tabela: 'agendamento_cirurgico', id: agendamento, etapa: atual.etapa };
    });
  }

  private async montarCirurgia(l: Consulta, est: number, agendamento: number) {
    const a = await l.uma(
      `SELECT a.id, a.numero, a.situacao, a.tipo_cobertura, a.senha_autorizacao, a.inicio_previsto_em,
              a.autorizacao_posterior_justificativa, a.autorizacao_posterior_em,
              a.autorizacao_parcial_conferencia, a.autorizacao_parcial_conferida_em, a.versao, a.paciente_id, a.cirurgiao_profissional_id,
              cc.natureza, cc.descricao AS carater
         FROM agendamento_cirurgico a JOIN carater_cirurgia cc ON cc.id = a.carater_cirurgia_id
        WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
      [agendamento, est],
    );
    if (!a) throw naoEncontrado('Agendamento cirúrgico');
    const guias = (
      await l.consultar(
        `SELECT sa.id, sa.numero, sa.situacao,
                (SELECT ra.senha FROM resposta_autorizacao ra WHERE ra.solicitacao_autorizacao_id = sa.id AND ra.excluido_em IS NULL
                  ORDER BY ra.recebida_em DESC, ra.id DESC LIMIT 1) AS senha
           FROM solicitacao_autorizacao sa
          WHERE sa.agendamento_cirurgico_id = ? AND sa.estabelecimento_id = ? AND sa.excluido_em IS NULL
          ORDER BY sa.solicitada_em DESC, sa.id DESC`,
        [agendamento, est],
      )
    ).map((x) => ({
      id: num(x['id']),
      numero: String(x['numero']),
      situacao: String(x['situacao']),
      senha: txtOuNull(x['senha']),
    }));
    const vigente = guias.find((g) => g.situacao !== 'cancelada') ?? null;
    const guia: GuiaDaCirurgia | null = vigente ? { situacao: vigente.situacao, senha: vigente.senha } : null;
    return {
      id: num(a['id']),
      numero: String(a['numero']),
      situacao: String(a['situacao']),
      carater: String(a['carater']),
      natureza: String(a['natureza']),
      inicioPrevisto: iso(a['inicio_previsto_em']),
      versao: num(a['versao']),
      paciente: num(a['paciente_id']),
      cirurgiao: num(a['cirurgiao_profissional_id']),
      senha: txtOuNull(a['senha_autorizacao']),
      etapa: etapaAutorizacaoCirurgia({
        tipoCobertura: String(a['tipo_cobertura']),
        natureza: String(a['natureza']),
        senha: txtOuNull(a['senha_autorizacao']),
        guia,
      }),
      conferenciaParcial: a['autorizacao_parcial_conferida_em']
        ? {
            justificativa: txtOuNull(a['autorizacao_parcial_conferencia']),
            em: iso(a['autorizacao_parcial_conferida_em']),
          }
        : null,
      autorizacaoPosterior: a['autorizacao_posterior_em']
        ? {
            justificativa: txtOuNull(a['autorizacao_posterior_justificativa']),
            em: iso(a['autorizacao_posterior_em']),
          }
        : null,
      guias,
    };
  }

  detalhe(c: ContextoPortaPropria, solicitacao: number) {
    return this.ler(c, 'detalhe', (l, est) => this.montarDetalhe(l, est.id, solicitacao));
  }

  private async montarDetalhe(l: Consulta, est: number, solicitacao: number) {
    const s = await l.uma(
      `SELECT sa.*, fp.nome AS fonte FROM solicitacao_autorizacao sa JOIN fonte_pagadora fp ON fp.id = sa.fonte_pagadora_id
        WHERE sa.id = ? AND sa.estabelecimento_id = ? AND sa.excluido_em IS NULL`,
      [solicitacao, est],
    );
    if (!s) throw naoEncontrado('Pedido de autorização');
    const itens = (
      await l.consultar(
        'SELECT * FROM solicitacao_autorizacao_item WHERE solicitacao_autorizacao_id = ? AND excluido_em IS NULL ORDER BY sequencia',
        [solicitacao],
      )
    ).map((x) => ({
      id: num(x['id']),
      sequencia: num(x['sequencia']),
      codigoTabela: String(x['codigo_tabela']),
      codigoProcedimento: String(x['codigo_procedimento']),
      descricao: String(x['descricao']),
      quantidade: Number(x['quantidade_solicitada']),
      quantidadeAutorizada: x['quantidade_autorizada'] === null ? null : Number(x['quantidade_autorizada']),
      valorUnitario: x['valor_unitario'] === null ? null : Number(x['valor_unitario']),
      opme: !!num(x['opme']),
      registroAnvisa: txtOuNull(x['registro_anvisa']),
    }));
    const respostas = [];
    for (const r of await l.consultar(
      'SELECT * FROM resposta_autorizacao WHERE solicitacao_autorizacao_id = ? AND excluido_em IS NULL ORDER BY recebida_em DESC, id DESC',
      [solicitacao],
    ))
      respostas.push({
        id: num(r['id']),
        situacao: String(r['situacao']),
        recebidaEm: iso(r['recebida_em']),
        senha: txtOuNull(r['senha']),
        numeroGuiaOperadora: txtOuNull(r['numero_guia_operadora']),
        senhaValidade: dataIso(r['senha_validade']),
        valorTotalAutorizado:
          r['valor_total_autorizado'] === null ? null : Number(r['valor_total_autorizado']),
        itens: (
          await l.consultar(
            'SELECT * FROM resposta_autorizacao_item WHERE resposta_autorizacao_id = ? ORDER BY sequencia',
            [r['id']],
          )
        ).map((x) => ({
          sequencia: num(x['sequencia']),
          situacao: String(x['situacao']),
          quantidadeAutorizada: Number(x['quantidade_autorizada']),
          valorAutorizado: x['valor_autorizado'] === null ? null : Number(x['valor_autorizado']),
          observacao: txtOuNull(x['observacao']),
        })),
      });
    const consultas = (
      await l.consultar(
        'SELECT tentativa, situacao, consultada_em, proxima_consulta_em FROM consulta_situacao_autorizacao WHERE solicitacao_autorizacao_id = ? ORDER BY tentativa',
        [solicitacao],
      )
    ).map((x) => ({
      tentativa: num(x['tentativa']),
      situacao: String(x['situacao']),
      consultadaEm: iso(x['consultada_em']),
      proximaEm: iso(x['proxima_consulta_em']),
    }));
    const diagnosticos = (
      await l.consultar(
        `SELECT d.sequencia, d.principal, d.tipo_doenca, d.tempo_doenca, d.unidade_tempo_doenca, t.codigo_termo, t.descricao
           FROM solicitacao_autorizacao_diagnostico d JOIN termo_terminologia t ON t.id = d.cid_termo_terminologia_id
          WHERE d.solicitacao_autorizacao_id = ? AND d.excluido_em IS NULL ORDER BY d.sequencia`,
        [solicitacao],
      )
    ).map((x) => ({
      sequencia: num(x['sequencia']),
      principal: !!num(x['principal']),
      cid: String(x['codigo_termo']),
      descricao: String(x['descricao']),
      tipoDoenca: txtOuNull(x['tipo_doenca']),
      tempo: numOuNull(x['tempo_doenca']),
      unidadeTempo: txtOuNull(x['unidade_tempo_doenca']),
    }));
    const ligadosConta = await l.uma(
      `SELECT COUNT(*) AS n, COALESCE(SUM(cia.quantidade_coberta), 0) AS q FROM conta_hospitalar_item_autorizacao cia
         JOIN resposta_autorizacao_item ri ON ri.id = cia.resposta_autorizacao_item_id
         JOIN resposta_autorizacao r ON r.id = ri.resposta_autorizacao_id
        WHERE r.solicitacao_autorizacao_id = ? AND cia.excluido_em IS NULL`,
      [solicitacao],
    );
    return {
      id: num(s['id']),
      numero: String(s['numero']),
      tipo: String(s['tipo']) as TipoSolicitacaoAutorizacao,
      diagnosticos,
      itensDaContaCobertos: num(ligadosConta?.['n'] ?? 0),
      situacao: String(s['situacao']) as SituacaoSolicitacaoAutorizacao,
      canal: String(s['canal']),
      fontePagadora: String(s['fonte']),
      carteira: String(s['numero_carteira']),
      atendimento: numOuNull(s['atendimento_id']),
      conta: numOuNull(s['conta_hospitalar_id']),
      agendamentoCirurgico: numOuNull(s['agendamento_cirurgico_id']),
      solicitadaEm: iso(s['solicitada_em']),
      enviadaEm: iso(s['enviada_em']),
      observacao: txtOuNull(s['observacao']),
      xmlGuardado: s['arquivo_id'] !== null && s['arquivo_id'] !== undefined,
      transmissaoModo: txtOuNull(s['transmissao_modo']),
      protocoloTransmissao: txtOuNull(s['protocolo_transmissao']),
      falhaTransmissao: txtOuNull(s['falha_transmissao']),
      versao: num(s['versao']),
      itens,
      respostas,
      consultas,
    };
  }

  criar(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; numero: string; liberacao: number | null }> {
    const e = entradaValida(esquemaCriar, entrada);
    return this.gravar(
      c,
      'tiss.autorizacao.criar',
      [
        'solicitacao_autorizacao',
        'solicitacao_autorizacao_item',
        'solicitacao_autorizacao_diagnostico',
        'sequencia_negocio',
        ...TABELAS_LIBERACAO_OPME,
      ],
      async (tx, est, usuario) => {
        const cp = await tx.uma(
          `SELECT id, paciente_id, fonte_pagadora_id, plano_fonte_pagadora_id, numero_carteira, validade
             FROM cobertura_paciente WHERE id = ? AND excluido_em IS NULL AND situacao = 'ativa'`,
          [e.cobertura],
        );
        if (!cp) throw naoEncontrado('Cobertura');
        const agora = new Date();
        const itens: ItemPedidoAutorizacao[] = e.itens.map((i) => ({ ...i }));
        const problemas = conferirPedidoAutorizacao({
          tipo: e.tipo,
          canal: e.canal,
          carteira: String(cp['numero_carteira'] ?? ''),
          validadeCarteira: dataIso(cp['validade']),
          hoje: diaCivil(agora, est.fuso),
          ligado: e.principal !== null || e.atendimento !== null,
          temSolicitante: e.solicitanteProfissional !== null || e.solicitanteExterno !== null,
          regimeInternacao: e.regime,
          diarias: e.diarias,
          indicacaoClinica: e.indicacaoClinica,
          itens,
        });
        problemas.push(...conferirDiagnosticosAutorizacao(e.tipo, e.diagnosticos));
        // O CID vem do catálogo oficial carregado (categoria ou subcategoria ativa), nunca digitado solto.
        const cids: number[] = [];
        for (const [n, d] of e.diagnosticos.entries()) {
          const cid = cidDoPedido(d.cid);
          if (!cid) continue;
          const t = await tx.uma(
            `SELECT t.id FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
              WHERE g.codigo = 'cid10' AND t.codigo_termo = ? AND t.ativo = TRUE AND t.nivel IN (3, 4) LIMIT 1`,
            [cid],
          );
          if (t) cids.push(num(t['id']));
          else
            problemas.push({
              campo: `diagnosticos.${n}`,
              mensagem: `Diagnóstico ${n + 1}: o CID ${cid} não está no catálogo da CID-10 carregado.`,
            });
        }
        const paciente = num(cp['paciente_id']);
        const confere = async (sql: string, v: unknown[], campo: string, mensagem: string) => {
          if (!(await tx.uma(sql, v))) problemas.push({ campo, mensagem });
        };
        if (e.atendimento !== null)
          await confere(
            'SELECT id FROM atendimento WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ?',
            [e.atendimento, paciente, est.id],
            'atendimento',
            'O atendimento não é deste paciente neste estabelecimento.',
          );
        if (e.conta !== null)
          await confere(
            'SELECT id FROM conta_hospitalar WHERE id = ? AND paciente_id = ?',
            [e.conta, paciente],
            'conta',
            'A conta não é deste paciente.',
          );
        if (e.agendamentoCirurgico !== null)
          await confere(
            `SELECT id FROM agendamento_cirurgico WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ?
                AND excluido_em IS NULL AND situacao IN ${CIRURGIA_EM_ABERTO}`,
            [e.agendamentoCirurgico, paciente, est.id],
            'agendamentoCirurgico',
            'A cirurgia não é deste paciente neste estabelecimento ou já foi realizada, suspensa ou cancelada.',
          );
        if (e.principal !== null)
          await confere(
            'SELECT id FROM solicitacao_autorizacao WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ?',
            [e.principal, paciente, est.id],
            'principal',
            'A guia principal não é deste paciente.',
          );
        // Base do limite de OPME: os procedimentos do pedido ou, no pedido só de OPME, os da guia principal.
        let faturaveis = e.itens
          .filter((i) => !i.opme)
          .map((i) => i.itemFaturavel)
          .filter((x): x is number => x !== null);
        if (itens.some((i) => i.opme) && !itens.some((i) => !i.opme) && e.principal !== null)
          faturaveis = (
            await tx.consultar(
              'SELECT item_faturavel_id FROM solicitacao_autorizacao_item WHERE solicitacao_autorizacao_id = ? AND opme = FALSE AND item_faturavel_id IS NOT NULL AND excluido_em IS NULL',
              [e.principal],
            )
          ).map((x) => num(x['item_faturavel_id']));
        problemas.push(...conferirProcedimentoDaOpme(itens, faturaveis.length));
        // Passar do limite não é recusa definitiva: com a justificativa, o pedido nasce retido até a alçada liberar.
        let retencao: { avaliacao: ReturnType<typeof avaliarLimiteOpme>; alcada: number | null } | null =
          null;
        if (faturaveis.length && itens.some((i) => i.opme)) {
          const limites = await tx.consultar(
            `SELECT valor_limite, quantidade_limite, alcada_aprovacao_id FROM limite_opme_procedimento
              WHERE fonte_pagadora_id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
                AND (plano_fonte_pagadora_id IS NULL OR plano_fonte_pagadora_id <=> ?)
                AND item_faturavel_id IN (${faturaveis.map(() => '?').join(',')}) AND insumo_id IS NULL
                AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
            [
              cp['fonte_pagadora_id'],
              est.id,
              cp['plano_fonte_pagadora_id'],
              ...faturaveis,
              diaCivil(agora, est.fuso),
              diaCivil(agora, est.fuso),
            ],
          );
          const avaliacao = avaliarLimiteOpme(
            itens,
            limites.map((x) => ({
              valorLimite: x['valor_limite'] === null ? null : Number(x['valor_limite']),
              quantidadeLimite: x['quantidade_limite'] === null ? null : Number(x['quantidade_limite']),
            })),
          );
          const lib = conferirPedidoDeLiberacao(avaliacao, e.justificativaLimite);
          problemas.push(...lib.problemas);
          if (lib.retido)
            retencao = {
              avaliacao,
              alcada:
                limites
                  .map((x) => numOuNull(x['alcada_aprovacao_id']))
                  .find((x): x is number => x !== null) ?? null,
            };
        }
        if (problemas.length) throw recusaRegra('Pedido recusado', problemas);
        const carater = await tx.uma(
          'SELECT id FROM carater_atendimento_tiss WHERE urgencia = ? ORDER BY vigencia_fim IS NULL DESC, id LIMIT 1',
          [e.urgencia],
        );
        if (!carater)
          throw recusaRegra('Pedido recusado', [
            { campo: 'urgencia', mensagem: 'O catálogo de caráter do atendimento não está carregado.' },
          ]);
        const numero = await this.proximoNumero(tx, est.id);
        const novo = await tx.incluir('solicitacao_autorizacao', {
          estabelecimento_id: est.id,
          numero,
          tipo: e.tipo,
          paciente_id: paciente,
          atendimento_id: e.atendimento,
          conta_hospitalar_id: e.conta,
          agendamento_cirurgico_id: e.agendamentoCirurgico,
          principal_solicitacao_autorizacao_id: e.principal,
          fonte_pagadora_id: num(cp['fonte_pagadora_id']),
          plano_fonte_pagadora_id: numOuNull(cp['plano_fonte_pagadora_id']),
          cobertura_paciente_id: e.cobertura,
          numero_carteira: String(cp['numero_carteira']).trim(),
          validade_carteira: dataIso(cp['validade']),
          solicitante_profissional_id: e.solicitanteProfissional,
          // O cadastro unificado em outro não recebe pedido novo: grava o que responde hoje (F3.1, 02-CAD linha 20).
          solicitante_externo_id: await solicitanteQueRespondeHoje(tx, e.solicitanteExterno),
          carater_atendimento_tiss_id: num(carater['id']),
          regime_internacao: e.regime,
          diarias_solicitadas: e.diarias,
          data_provavel_admissao: e.dataAdmissao,
          indicacao_clinica: e.indicacaoClinica,
          indicacao_acidente: e.acidente,
          solicitada_em: agora,
          canal: e.canal,
          situacao: 'rascunho',
          observacao: e.observacao,
        });
        let seq = 0;
        for (const i of e.itens)
          await tx.incluir('solicitacao_autorizacao_item', {
            solicitacao_autorizacao_id: novo,
            sequencia: ++seq,
            item_faturavel_id: i.itemFaturavel,
            codigo_tabela: i.codigoTabela,
            codigo_procedimento: i.codigoProcedimento,
            descricao: i.descricao,
            quantidade_solicitada: i.quantidade,
            valor_unitario: i.valorUnitario,
            opme: i.opme,
            fabricante_id: i.fabricante,
            registro_anvisa: i.registroAnvisa,
            referencia_fabricante: i.referenciaFabricante,
            ordem_opcao: i.opcaoFabricante,
            justificativa: i.justificativa,
          });
        for (const [n, d] of e.diagnosticos.entries())
          await tx.incluir('solicitacao_autorizacao_diagnostico', {
            solicitacao_autorizacao_id: novo,
            sequencia: n + 1,
            cid_termo_terminologia_id: cids[n],
            principal: n === 0,
            tipo_doenca: d.tipoDoenca,
            tempo_doenca: d.tempo,
            unidade_tempo_doenca: d.unidadeTempo,
          });
        const liberacao = retencao
          ? await abrirLiberacaoOpme(tx, {
              est: est.id,
              usuario,
              solicitacao: novo,
              numero,
              avaliacao: retencao.avaliacao,
              justificativa: e.justificativaLimite ?? '',
              alcadaDoLimite: retencao.alcada,
            })
          : null;
        return { tabela: 'solicitacao_autorizacao', id: novo, numero, liberacao };
      },
    );
  }

  /** Número do pedido pela sequência do estabelecimento; a sequência nasce na primeira vez. */
  private async proximoNumero(tx: TxOperacao, est: number): Promise<string> {
    const existe = await tx.uma(
      'SELECT id FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?',
      [SEQUENCIA, est],
    );
    if (!existe)
      await tx.incluir('sequencia_negocio', {
        estabelecimento_id: est,
        tipo: SEQUENCIA,
        prefixo: 'SA',
        proximo_valor: 1,
        incremento: 1,
      });
    return (await tx.proximoNumero(SEQUENCIA)).formatado;
  }

  /** Os dados da mensagem TISS, lidos do pedido, da cobertura, do solicitante e da configuração da fonte pagadora. */
  private async dadosMensagem(
    l: Consulta,
    est: number,
    s: Record<string, unknown>,
    sequencial: string,
    quando: Date,
    fuso: string,
  ): Promise<DadosMensagemSolicitacao> {
    const cfg = await l.uma(
      `SELECT COALESCE(c.registro_ans, fp.registro_ans) AS ans, c.codigo_prestador_operadora, c.razao_social_contratado,
              e.razao_social, e.codigo_cnes
         FROM estabelecimento e JOIN fonte_pagadora fp ON fp.id = ?
         LEFT JOIN configuracao_tiss_fonte_pagadora c ON c.fonte_pagadora_id = fp.id AND c.estabelecimento_id = e.id AND c.ativo = TRUE
        WHERE e.id = ? ORDER BY c.vigencia_inicio DESC LIMIT 1`,
      [s['fonte_pagadora_id'], est],
    );
    const sol = s['solicitante_externo_id']
      ? await l.uma(
          `SELECT se.nome, cc.codigo_tiss AS conselho, se.numero_conselho AS numero, uf.codigo_ibge AS uf, cbo.codigo_cbo AS cbo,
                  se.telefone FROM solicitante_externo se JOIN conselho_classe cc ON cc.id = se.conselho_classe_id
             LEFT JOIN unidade_federativa uf ON uf.id = se.conselho_unidade_federativa_id
             LEFT JOIN ocupacao_cbo cbo ON cbo.id = se.ocupacao_cbo_id WHERE se.id = ?`,
          [s['solicitante_externo_id']],
        )
      : await l.uma(
          `SELECT pf.nome, cc.codigo_tiss AS conselho, ic.numero_inscricao AS numero, uf.codigo_ibge AS uf, cbo.codigo_cbo AS cbo,
                  COALESCE(p.celular, p.telefone_comercial) AS telefone
             FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
             LEFT JOIN inscricao_conselho ic ON ic.profissional_id = p.id AND ic.excluido_em IS NULL AND ic.situacao = 'ativa'
             LEFT JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
             LEFT JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
             LEFT JOIN ocupacao_cbo cbo ON cbo.id = ic.ocupacao_cbo_id
            WHERE p.id = ? ORDER BY ic.principal DESC, ic.sequencia LIMIT 1`,
          [s['solicitante_profissional_id']],
        );
    // O solicitante migrado pode vir sem UF do conselho: a guia TISS exige a UF, então o envio é recusado com o motivo.
    if (s['solicitante_externo_id'] && sol && (sol['uf'] === null || sol['uf'] === undefined))
      throw recusaRegra('Envio recusado', [
        {
          campo: 'solicitante',
          mensagem:
            'Solicitante sem UF do conselho: informe a UF no cadastro do solicitante antes de enviar a guia.',
        },
      ]);
    const carater = await l.uma('SELECT urgencia FROM carater_atendimento_tiss WHERE id = ?', [
      s['carater_atendimento_tiss_id'],
    ]);
    // A guia referenciada: o número que a operadora deu à guia principal; sem resposta ainda, o do hospital.
    const principal = s['principal_solicitacao_autorizacao_id']
      ? await l.uma(
          `SELECT COALESCE((SELECT r.numero_guia_operadora FROM resposta_autorizacao r
                             WHERE r.solicitacao_autorizacao_id = sa.id AND r.excluido_em IS NULL AND r.numero_guia_operadora IS NOT NULL
                             ORDER BY r.recebida_em DESC, r.id DESC LIMIT 1), sa.numero) AS numero
             FROM solicitacao_autorizacao sa WHERE sa.id = ?`,
          [s['principal_solicitacao_autorizacao_id']],
        )
      : null;
    const cids = (
      await l.consultar(
        `SELECT t.codigo_termo FROM solicitacao_autorizacao_diagnostico d JOIN termo_terminologia t ON t.id = d.cid_termo_terminologia_id
          WHERE d.solicitacao_autorizacao_id = ? AND d.excluido_em IS NULL ORDER BY d.sequencia`,
        [s['id']],
      )
    ).map((x) => String(x['codigo_termo']));
    const itens = (
      await l.consultar(
        'SELECT * FROM solicitacao_autorizacao_item WHERE solicitacao_autorizacao_id = ? AND excluido_em IS NULL ORDER BY sequencia',
        [s['id']],
      )
    ).map((x) => ({
      codigoTabela: String(x['codigo_tabela']),
      codigoProcedimento: String(x['codigo_procedimento']),
      descricao: String(x['descricao']),
      quantidade: Number(x['quantidade_solicitada']),
      valorUnitario: x['valor_unitario'] === null ? null : Number(x['valor_unitario']),
      opme: !!num(x['opme']),
      registroAnvisa: txtOuNull(x['registro_anvisa']),
      fabricante: numOuNull(x['fabricante_id']),
      opcaoFabricante: numOuNull(x['ordem_opcao']),
    }));
    // Tipo de internação da TISS: cirúrgica quando há procedimento cirúrgico (grupo 3 da terminologia de procedimentos).
    const cirurgica = itens.some(
      (i) => !i.opme && i.codigoTabela === '22' && i.codigoProcedimento.startsWith('3'),
    );
    const t = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
    return {
      tipo: String(s['tipo']) as TipoSolicitacaoAutorizacao,
      sequencialTransacao: sequencial,
      data: diaCivil(quando, fuso),
      hora: horaCivil(quando, fuso),
      registroAns: t(cfg?.['ans']),
      codigoPrestador: t(cfg?.['codigo_prestador_operadora']),
      nomeContratado: t(cfg?.['razao_social_contratado']) || t(cfg?.['razao_social']),
      cnes: txtOuNull(cfg?.['codigo_cnes']),
      numeroGuia: String(s['numero']),
      numeroGuiaPrincipal: principal ? String(principal['numero']) : null,
      carteira: String(s['numero_carteira']),
      recemNascido: !!num(s['recem_nascido']),
      solicitante: {
        nome: t(sol?.['nome']),
        conselho: t(sol?.['conselho']),
        numeroConselho: t(sol?.['numero']),
        uf: t(sol?.['uf']),
        cbo: t(sol?.['cbo']),
        telefone: txtOuNull(sol?.['telefone']),
      },
      urgencia: !!num(carater?.['urgencia']),
      indicacaoClinica: txtOuNull(s['indicacao_clinica']),
      regime: (txtOuNull(s['regime_internacao']) as DadosMensagemSolicitacao['regime']) ?? null,
      tipoInternacao: s['tipo'] === 'internacao' ? (cirurgica ? '2' : '1') : null,
      diarias: numOuNull(s['diarias_solicitadas']),
      dataAdmissao: dataIso(s['data_provavel_admissao']),
      cids,
      acidente: (txtOuNull(s['indicacao_acidente']) as DadosMensagemSolicitacao['acidente']) ?? null,
      observacao: txtOuNull(s['observacao']),
      itens,
    };
  }

  /**
   * Liga a autorização aos itens da conta: cada item autorizado da última resposta cobre os itens lançados na conta do
   * pedido com o mesmo item faturável, até a quantidade autorizada. Refazer só cobre o que ainda falta.
   */
  ligarConta(
    c: ContextoPortaPropria,
    solicitacao: number,
  ): Promise<{ ligados: number; semCobertura: number }> {
    return this.gravar(
      c,
      'tiss.autorizacao.ligar_conta',
      ['conta_hospitalar_item_autorizacao'],
      async (tx, est) => {
        const s = await this.lerPedido(tx, est.id, solicitacao);
        const situacao = String(s['situacao']);
        const problemas = [];
        if (s['conta_hospitalar_id'] === null || s['conta_hospitalar_id'] === undefined)
          problemas.push({ campo: 'conta', mensagem: 'O pedido não está ligado a uma conta.' });
        if (situacao !== 'autorizada' && situacao !== 'autorizada_parcial')
          problemas.push({
            campo: 'situacao',
            mensagem: 'Só o pedido autorizado (total ou parcial) cobre a conta.',
          });
        if (problemas.length) throw recusaRegra('Ligação recusada', problemas);
        const resposta = await tx.uma(
          `SELECT id FROM resposta_autorizacao WHERE solicitacao_autorizacao_id = ? AND excluido_em IS NULL
            ORDER BY recebida_em DESC, id DESC LIMIT 1`,
          [solicitacao],
        );
        if (!resposta)
          throw recusaRegra('Ligação recusada', [
            { campo: 'resposta', mensagem: 'O pedido não tem resposta.' },
          ]);
        const autorizados = (
          await tx.consultar(
            `SELECT ri.id, ri.sequencia, ri.quantidade_autorizada, si.item_faturavel_id,
                    (SELECT COALESCE(SUM(cia.quantidade_coberta), 0) FROM conta_hospitalar_item_autorizacao cia
                      WHERE cia.resposta_autorizacao_item_id = ri.id AND cia.excluido_em IS NULL) AS coberta
               FROM resposta_autorizacao_item ri
               JOIN solicitacao_autorizacao_item si ON si.solicitacao_autorizacao_id = ? AND si.sequencia = ri.sequencia
                AND si.excluido_em IS NULL
              WHERE ri.resposta_autorizacao_id = ? AND ri.quantidade_autorizada > 0 ORDER BY ri.sequencia`,
            [solicitacao, resposta['id']],
          )
        ).map((x) => ({
          respostaItem: num(x['id']),
          sequencia: num(x['sequencia']),
          itemFaturavel: numOuNull(x['item_faturavel_id']),
          quantidadeAutorizada: Number(x['quantidade_autorizada']),
          jaCoberta: Number(x['coberta']),
        }));
        const conta = (
          await tx.consultar(
            `SELECT ci.id, ci.item_faturavel_id, ci.quantidade,
                    (SELECT COALESCE(SUM(cia.quantidade_coberta), 0) FROM conta_hospitalar_item_autorizacao cia
                      WHERE cia.conta_hospitalar_item_id = ci.id AND cia.excluido_em IS NULL) AS coberta
               FROM conta_hospitalar_item ci
              WHERE ci.conta_hospitalar_id = ? AND ci.excluido_em IS NULL ORDER BY ci.realizado_em, ci.sequencia, ci.id`,
            [s['conta_hospitalar_id']],
          )
        ).map((x) => ({
          contaItem: num(x['id']),
          itemFaturavel: num(x['item_faturavel_id']),
          quantidade: Number(x['quantidade']),
          jaCoberta: Number(x['coberta']),
        }));
        const r = casarAutorizacaoComConta(autorizados, conta);
        for (const g of r.ligacoes)
          await tx.incluir('conta_hospitalar_item_autorizacao', {
            conta_hospitalar_item_id: g.contaItem,
            resposta_autorizacao_item_id: g.respostaItem,
            sequencial_item_guia: g.sequencia,
            quantidade_coberta: g.quantidadeCoberta,
          });
        return {
          tabela: 'solicitacao_autorizacao',
          id: solicitacao,
          ligados: r.ligacoes.length,
          semCobertura: r.semCobertura.length,
        };
      },
    );
  }

  private async lerPedido(l: Consulta, est: number, solicitacao: number) {
    const s = await l.uma(
      'SELECT * FROM solicitacao_autorizacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [solicitacao, est],
    );
    if (!s) throw naoEncontrado('Pedido de autorização');
    return s;
  }

  enviar(
    c: ContextoPortaPropria,
    solicitacao: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: SituacaoSolicitacaoAutorizacao; hash: string | null }> {
    const e = entradaValida(esquemaVersao, entrada);
    const tabelas = ['solicitacao_autorizacao', 'arquivo'];
    return this.gravar(c, 'tiss.autorizacao.enviar', tabelas, async (tx, est) => {
      const s = await this.lerPedido(tx, est.id, solicitacao);
      const de = String(s['situacao']) as SituacaoSolicitacaoAutorizacao;
      const webservice = s['canal'] === 'webservice';
      const para: SituacaoSolicitacaoAutorizacao = webservice ? 'pronta_envio' : 'enviada';
      if (!podeMudar(de, para))
        throw recusaRegra('Envio recusado', [{ campo: 'situacao', mensagem: `O pedido está ${de}.` }]);
      const retido = await liberacaoQueRetem(tx, solicitacao);
      if (retido) throw recusaRegra('Envio recusado', [{ campo: 'liberacao', mensagem: retido }]);
      const agora = new Date();
      if (!webservice) {
        await tx.alterar('solicitacao_autorizacao', solicitacao, e.versao, {
          situacao: 'enviada',
          enviada_em: agora,
        });
        return {
          tabela: 'solicitacao_autorizacao',
          id: solicitacao,
          situacao: 'enviada' as const,
          hash: null,
        };
      }
      {
        const sequencial = String(num(s['id']));
        const d = await this.dadosMensagem(tx, est.id, s, sequencial, agora, est.fuso);
        const faltas = faltasParaMensagem(d);
        if (faltas.length)
          throw recusaRegra(
            'Envio recusado',
            faltas.map((f) => ({ campo: 'mensagem', mensagem: `Falta: ${f}.` })),
          );
        const m = mensagemSolicitacaoAutorizacao(d);
        const { carregarEsquemas, validarNoXsd } = await import('@sgh/dominio-faturamento');
        const v = await validarNoXsd(m.bytes, await carregarEsquemas());
        if (!v.valido)
          throw recusaRegra(
            'Envio recusado',
            v.erros.slice(0, 5).map((x) => ({ campo: 'mensagem', mensagem: x })),
          );
        if (!this.armazem)
          throw new ErroOperacao(
            503,
            'indisponivel',
            'Guarda indisponível',
            'Sem a guarda de arquivos do XML.',
          );
        // O XML validado é guardado como saiu (imutável): é ele que a rota xml serve e que vai à operadora.
        const digest = sha256(m.bytes);
        const chave = `${est.id}/tiss/autorizacoes/${String(s['numero'])}-${digest.slice(0, 16)}.xml`;
        await this.armazem.guardar(chave, m.bytes).catch((x: unknown) => {
          if (x instanceof ErroSobrescritaXml) return;
          throw x;
        });
        const arquivo = await registrarArquivoGuardado(tx, {
          estabelecimento: est.id,
          entidade: 'solicitacao_autorizacao',
          entidadeId: solicitacao,
          finalidade: 'xml_tiss_autorizacao',
          nomeOriginal: chave.slice(chave.lastIndexOf('/') + 1),
          tipoMime: 'application/xml',
          tamanhoBytes: m.bytes.length,
          hash: digest,
          chave,
          retencaoAte: retencaoAte(agora),
        });
        const versaoTiss = await tx.uma(
          "SELECT id FROM versao_padrao_tiss WHERE codigo_tiss = ? AND componente = 'troca' ORDER BY ativo DESC, id LIMIT 1",
          [VERSAO_TISS],
        );
        await tx.alterar('solicitacao_autorizacao', solicitacao, e.versao, {
          situacao: 'pronta_envio',
          sequencial_transacao: sequencial,
          arquivo_id: arquivo.id,
          versao_padrao_tiss_id: versaoTiss ? num(versaoTiss['id']) : null,
        });
        return {
          tabela: 'solicitacao_autorizacao',
          id: solicitacao,
          situacao: 'pronta_envio' as const,
          hash: m.hash,
        };
      }
    });
  }

  /** O XML guardado foi levado à operadora pelo canal real informado: o pedido fica 'enviada' com o instante. */
  registrarTransmissao(
    c: ContextoPortaPropria,
    solicitacao: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: SituacaoSolicitacaoAutorizacao }> {
    const e = entradaValida(esquemaTransmissao, entrada);
    return this.gravar(c, 'tiss.autorizacao.transmitir', ['solicitacao_autorizacao'], async (tx, est) => {
      const s = await this.lerPedido(tx, est.id, solicitacao);
      const de = String(s['situacao']) as SituacaoSolicitacaoAutorizacao;
      if (de !== 'pronta_envio' || !podeMudar(de, 'enviada'))
        throw recusaRegra('Transmissão recusada', [
          { campo: 'situacao', mensagem: `O pedido está ${de}; só o pronto para envio é transmitido.` },
        ]);
      await tx.alterar('solicitacao_autorizacao', solicitacao, e.versao, {
        situacao: 'enviada',
        enviada_em: new Date(),
        canal: e.canal,
      });
      return { tabela: 'solicitacao_autorizacao', id: solicitacao, situacao: 'enviada' as const };
    });
  }

  /**
   * Transmissão automática ao webservice da operadora pela central de integrações externas (decisão 53): o XML
   * guardado (conferido pelo SHA-256) é entregue ao adaptador. No simulador (padrão, e sempre fora de produção) a
   * resposta segue o contrato do serviço: aceite com protocolo leva o pedido a 'enviada' pelo canal webservice com o
   * modo e o protocolo; recusa ou erro de transporte deixa o pedido pronto para envio com a falha registrada. O
   * transporte real depende da definição do fornecedor (WSDL e endereço da operadora): o modo real registra a falha na
   * central e recusa, sem inventar endereço nem formato.
   */
  async transmitirWebservice(
    c: ContextoPortaPropria,
    solicitacao: number,
    entrada: unknown,
  ): Promise<{
    id: number;
    situacao: SituacaoSolicitacaoAutorizacao;
    modo: 'simulador' | 'real';
    protocolo: string | null;
    falha: string | null;
  }> {
    const e = entradaValida(esquemaVersao, entrada);
    await this.xml(c, solicitacao);
    const central = await modoDaIntegracao(INTEGRACAO_TISS_WEBSERVICE);
    if (central.modo === 'real') {
      await central.registrarFalha(
        'Transporte ao webservice depende da definição do fornecedor (WSDL e endereço).',
      );
      throw new ErroOperacao(
        503,
        'depende-definicao-fornecedor',
        'Transmissão indisponível',
        'O transporte real ao webservice da operadora depende da definição do fornecedor: passe a definição à equipe de desenvolvimento (Administração > Integrações externas).',
      );
    }
    return this.gravar(c, 'tiss.autorizacao.transmitir', ['solicitacao_autorizacao'], async (tx, est) => {
      const s = await this.lerPedido(tx, est.id, solicitacao);
      const de = String(s['situacao']) as SituacaoSolicitacaoAutorizacao;
      if (de !== 'pronta_envio' || s['canal'] !== 'webservice' || !podeMudar(de, 'enviada'))
        throw recusaRegra('Transmissão recusada', [
          {
            campo: 'situacao',
            mensagem: `O pedido está ${de}; só o pronto para envio pelo webservice é transmitido.`,
          },
        ]);
      const r = respostaSimulada(INTEGRACAO_TISS_WEBSERVICE, String(s['numero']));
      const agora = new Date();
      if (r.tipo !== 'aceite') {
        const falha = r.mensagem.slice(0, 300);
        await tx.alterar('solicitacao_autorizacao', solicitacao, e.versao, {
          falha_transmissao: falha,
          falha_transmissao_em: agora,
        });
        return {
          tabela: 'solicitacao_autorizacao',
          id: solicitacao,
          situacao: 'pronta_envio' as const,
          modo: 'simulador' as const,
          protocolo: null,
          falha,
        };
      }
      await tx.alterar('solicitacao_autorizacao', solicitacao, e.versao, {
        situacao: 'enviada',
        enviada_em: agora,
        canal: 'webservice',
        transmissao_modo: 'simulador',
        protocolo_transmissao: r.protocolo,
        falha_transmissao: null,
        falha_transmissao_em: null,
      });
      return {
        tabela: 'solicitacao_autorizacao',
        id: solicitacao,
        situacao: 'enviada' as const,
        modo: 'simulador' as const,
        protocolo: r.protocolo,
        falha: null,
      };
    });
  }

  /** O XML guardado no envio, como foi validado (nunca remontado), conferido pelo SHA-256 do registro. */
  xml(c: ContextoPortaPropria, solicitacao: number): Promise<{ nome: string; xml: string; sha256: string }> {
    return this.ler(c, 'xml', async (l, est) => {
      const s = await this.lerPedido(l, est.id, solicitacao);
      const a = s['arquivo_id']
        ? await l.uma('SELECT chave_armazenamento, hash_sha256 FROM arquivo WHERE id = ?', [s['arquivo_id']])
        : null;
      if (!a)
        throw recusaRegra('XML indisponível', [
          { campo: 'situacao', mensagem: 'Só o pedido com a mensagem eletrônica montada tem XML.' },
        ]);
      if (!this.armazem)
        throw new ErroOperacao(
          503,
          'indisponivel',
          'Guarda indisponível',
          'Sem a guarda de arquivos do XML.',
        );
      const bytes = await this.armazem.ler(String(a['chave_armazenamento']));
      if (!bytes || sha256(bytes) !== String(a['hash_sha256']))
        throw new ErroOperacao(
          409,
          'arquivo-divergente',
          'XML guardado indisponível',
          'O XML guardado não confere com o registro.',
        );
      return {
        nome: `autorizacao-${String(s['numero'])}.xml`,
        xml: Buffer.from(bytes).toString('latin1'),
        sha256: String(a['hash_sha256']),
      };
    });
  }

  responder(
    c: ContextoPortaPropria,
    solicitacao: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: SituacaoSolicitacaoAutorizacao; resposta: number }> {
    const e = entradaValida(esquemaResposta, entrada);
    return this.gravar(
      c,
      'tiss.autorizacao.responder',
      [
        'solicitacao_autorizacao',
        'solicitacao_autorizacao_item',
        'resposta_autorizacao',
        'resposta_autorizacao_item',
        'consulta_situacao_autorizacao',
        'conta_hospitalar',
        'agendamento_cirurgico',
        ...TABELAS_OPME_AUTORIZADA,
      ],
      async (tx, est, usuario) => {
        const s = await this.lerPedido(tx, est.id, solicitacao);
        const de = String(s['situacao']) as SituacaoSolicitacaoAutorizacao;
        if (!SITUACOES_EM_ANDAMENTO.includes(de))
          throw recusaRegra('Resposta recusada', [
            {
              campo: 'situacao',
              mensagem: `O pedido está ${de}; só o enviado ou em análise recebe resposta.`,
            },
          ]);
        const pedidos = await tx.consultar(
          'SELECT id, sequencia, quantidade_solicitada, valor_unitario, codigo_tabela, codigo_procedimento, descricao, versao FROM solicitacao_autorizacao_item WHERE solicitacao_autorizacao_id = ? AND excluido_em IS NULL',
          [solicitacao],
        );
        const lida = lerRespostaAutorizacao(
          pedidos.map((p) => ({
            sequencia: num(p['sequencia']),
            quantidade: Number(p['quantidade_solicitada']),
          })),
          e,
        );
        const problemas = [...lida.problemas];
        for (const g of new Set(e.itens.map((i) => i.motivoGlosa).filter((x): x is number => x !== null)))
          if (!(await tx.uma('SELECT id FROM motivo_glosa WHERE id = ?', [g])))
            problemas.push({ campo: 'motivoGlosa', mensagem: 'Motivo de negativa inexistente.' });
        if (problemas.length) throw recusaRegra('Resposta recusada', problemas);
        if (!podeMudar(de, lida.solicitacao))
          throw recusaRegra('Resposta recusada', [
            { campo: 'situacao', mensagem: `O pedido não passa de ${de} a ${lida.solicitacao}.` },
          ]);
        const agora = new Date();
        const porSeq = new Map(pedidos.map((p) => [num(p['sequencia']), p]));
        const total = lida.itens.reduce((t, i) => t + Math.round((i.valorAutorizado ?? 0) * 100), 0) / 100;
        const resposta = await tx.incluir('resposta_autorizacao', {
          estabelecimento_id: est.id,
          solicitacao_autorizacao_id: solicitacao,
          recebida_em: agora,
          situacao: lida.situacao,
          numero_guia_operadora: e.numeroGuiaOperadora,
          senha: e.senha,
          data_autorizacao: e.dataAutorizacao,
          senha_validade: e.senhaValidade,
          valor_total_autorizado: lida.itens.some((i) => i.valorAutorizado !== null) ? total : null,
          justificativa_operadora: e.justificativa,
          canal: e.canal,
          registrado_por_usuario_id: e.canal === 'webservice' ? null : usuario,
        });
        for (const i of lida.itens) {
          const p = porSeq.get(i.sequencia)!;
          const qtd = Number(p['quantidade_solicitada']);
          await tx.incluir('resposta_autorizacao_item', {
            resposta_autorizacao_id: resposta,
            sequencia: i.sequencia,
            solicitacao_autorizacao_item_id: num(p['id']),
            codigo_tabela: String(p['codigo_tabela']),
            codigo_procedimento: String(p['codigo_procedimento']),
            descricao: String(p['descricao']),
            quantidade_solicitada: qtd,
            quantidade_autorizada: i.quantidadeAutorizada,
            valor_solicitado:
              p['valor_unitario'] === null ? null : Math.round(Number(p['valor_unitario']) * qtd * 100) / 100,
            valor_autorizado: i.valorAutorizado,
            situacao: i.situacao,
            motivo_glosa_id: i.motivoGlosa,
            observacao: i.motivoNegativa,
          });
          await tx.alterar('solicitacao_autorizacao_item', num(p['id']), num(p['versao']), {
            quantidade_autorizada: i.quantidadeAutorizada,
          });
        }
        await tx.alterar('solicitacao_autorizacao', solicitacao, e.versao, { situacao: lida.solicitacao });
        // A OPME respondida vai à guia de autorização com o valor autorizado por item (base do valor cobrado).
        await gravarOpmeAutorizada(tx, {
          est: est.id,
          s,
          situacao: lida.solicitacao,
          senha: e.senha,
          numeroGuiaOperadora: e.numeroGuiaOperadora,
          agora,
          itens: lida.itens,
        });
        const aberta = await tx.uma(
          "SELECT id, versao FROM consulta_situacao_autorizacao WHERE solicitacao_autorizacao_id = ? AND situacao IN ('pendente','enviada') ORDER BY tentativa DESC LIMIT 1",
          [solicitacao],
        );
        if (aberta)
          await tx.alterar('consulta_situacao_autorizacao', num(aberta['id']), num(aberta['versao']), {
            situacao: 'respondida',
            respondida_em: agora,
            situacao_retornada:
              lida.solicitacao === 'autorizada_parcial' ? 'autorizada_parcialmente' : lida.solicitacao,
            resposta_autorizacao_id: resposta,
            proxima_consulta_em: null,
          });
        const conta = numOuNull(s['conta_hospitalar_id']);
        if (conta !== null && e.senha && lida.solicitacao.startsWith('autorizada')) {
          const ch = await tx.uma('SELECT versao, senha_autorizacao FROM conta_hospitalar WHERE id = ?', [
            conta,
          ]);
          if (ch && !ch['senha_autorizacao'])
            await tx.alterar('conta_hospitalar', conta, num(ch['versao']), { senha_autorizacao: e.senha });
        }
        // A guia da cirurgia autorizada leva a senha ao agendamento que ainda não tem (04-CC linha 102): é ela que
        // libera a confirmação da cirurgia eletiva de convênio.
        const cirurgia = numOuNull(s['agendamento_cirurgico_id']);
        if (cirurgia !== null && e.senha && lida.solicitacao.startsWith('autorizada')) {
          const ag = await tx.uma(
            'SELECT versao, senha_autorizacao FROM agendamento_cirurgico WHERE id = ? AND estabelecimento_id = ?',
            [cirurgia, est.id],
          );
          if (ag && !ag['senha_autorizacao'])
            await tx.alterar('agendamento_cirurgico', cirurgia, num(ag['versao']), {
              senha_autorizacao: e.senha,
            });
        }
        return { tabela: 'solicitacao_autorizacao', id: solicitacao, situacao: lida.solicitacao, resposta };
      },
    );
  }

  consultarAndamento(
    c: ContextoPortaPropria,
    solicitacao: number,
  ): Promise<{ id: number; tentativa: number; proximaEm: string }> {
    return this.gravar(
      c,
      'tiss.autorizacao.andamento',
      ['consulta_situacao_autorizacao'],
      async (tx, est) => {
        const s = await this.lerPedido(tx, est.id, solicitacao);
        const de = String(s['situacao']) as SituacaoSolicitacaoAutorizacao;
        if (!SITUACOES_EM_ANDAMENTO.includes(de))
          throw recusaRegra('Consulta recusada', [
            { campo: 'situacao', mensagem: `O pedido está ${de}; não há andamento a consultar.` },
          ]);
        const u = await tx.uma(
          'SELECT MAX(tentativa) AS t FROM consulta_situacao_autorizacao WHERE solicitacao_autorizacao_id = ?',
          [solicitacao],
        );
        const tentativa = num(u?.['t']) + 1;
        const agora = new Date();
        const proxima = proximaConsultaAndamento(tentativa, agora);
        const novo = await tx.incluir('consulta_situacao_autorizacao', {
          estabelecimento_id: est.id,
          solicitacao_autorizacao_id: solicitacao,
          fonte_pagadora_id: num(s['fonte_pagadora_id']),
          automatica: false,
          tentativa,
          situacao: 'pendente',
          consultada_em: agora,
          proxima_consulta_em: proxima,
        });
        return {
          tabela: 'consulta_situacao_autorizacao',
          id: novo,
          tentativa,
          proximaEm: proxima.toISOString(),
        };
      },
    );
  }

  cancelar(
    c: ContextoPortaPropria,
    solicitacao: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: SituacaoSolicitacaoAutorizacao }> {
    const e = entradaValida(esquemaCancelar, entrada);
    return this.gravar(c, 'tiss.autorizacao.cancelar', ['solicitacao_autorizacao'], async (tx, est) => {
      const s = await this.lerPedido(tx, est.id, solicitacao);
      const de = String(s['situacao']) as SituacaoSolicitacaoAutorizacao;
      if (!podeMudar(de, 'cancelada'))
        throw recusaRegra('Cancelamento recusado', [{ campo: 'situacao', mensagem: `O pedido está ${de}.` }]);
      const obs = [txtOuNull(s['observacao']), `Cancelado: ${e.motivo}`].filter(Boolean).join(' | ');
      await tx.alterar('solicitacao_autorizacao', solicitacao, e.versao, {
        situacao: 'cancelada',
        observacao: obs.slice(-1000),
      });
      return { tabela: 'solicitacao_autorizacao', id: solicitacao, situacao: 'cancelada' as const };
    });
  }
}
