// Solicitação eletrônica de autorização prévia à operadora (F78.06-2, 06-FAT linhas 25 e 27), no banco do cliente. As
// regras são as puras de @sgh/dominio-faturamento (tiss/autorizacao-previa.ts); aqui ficam a leitura e a gravação.
// Contrato de efeito:
//   - criar: `solicitacao_autorizacao` 'rascunho' com o número da sequência do estabelecimento, a carteira copiada da
//     cobertura (fonte, plano, validade), o solicitante e os itens em `solicitacao_autorizacao_item` (sequência 1..n,
//     OPME com registro na Anvisa ou fabricante); o limite de OPME vigente do procedimento na fonte pagadora
//     (`limite_opme_procedimento`) é conferido antes de gravar;
//   - enviar: a mensagem SOLICITACAO_PROCEDIMENTOS é montada e validada no XSD 04.03.00 (canal webservice) e o pedido
//     fica 'enviada' com o instante e o sequencial da transação; pelos outros canais (portal, telefone, e-mail) fica
//     'enviada' com o canal registrado. O XML é remontado igual a qualquer momento (rota xml);
//   - responder: `resposta_autorizacao` + `resposta_autorizacao_item` (quantidade e valor autorizados por item, negativa
//     com motivo); o pedido muda para a situação derivada dos itens, cada item pedido guarda a quantidade autorizada,
//     a senha vai à conta hospitalar ligada que ainda não tem senha e a consulta de andamento aberta fica respondida;
//   - consultarAndamento: nova linha em `consulta_situacao_autorizacao` (tentativa seguinte, próxima consulta marcada);
//   - cancelar: o pedido fica 'cancelado' com o motivo na observação. Nada se apaga.
import {
  conferirLimiteOpme,
  conferirPedidoAutorizacao,
  type DadosMensagemSolicitacao,
  faltasParaMensagem,
  type ItemPedidoAutorizacao,
  lerRespostaAutorizacao,
  mensagemSolicitacaoAutorizacao,
  podeMudar,
  proximaConsultaAndamento,
  SITUACOES_EM_ANDAMENTO,
  type SituacaoSolicitacaoAutorizacao,
  TIPOS_SOLICITACAO_AUTORIZACAO,
  type TipoSolicitacaoAutorizacao,
} from '@sgh/dominio-faturamento';
import type { Leitor, TxOperacao } from '@sgh/nucleo';
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
import { diaCivil } from './elegibilidade-propria.js';

export const PORTA_AUTORIZACAO_PREVIA = Symbol('PORTA_AUTORIZACAO_PREVIA');

const TABELAS = [
  'solicitacao_autorizacao',
  'solicitacao_autorizacao_item',
  'resposta_autorizacao',
  'resposta_autorizacao_item',
  'consulta_situacao_autorizacao',
  'conta_hospitalar',
  'sequencia_negocio',
];
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
    itens: z.array(esquemaItem).max(99),
  })
  .strict();
const esquemaVersao = z.object({ versao: z.number().int().positive() }).strict();
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
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
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
      return { coberturas, pedidos };
    });
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
    return {
      id: num(s['id']),
      numero: String(s['numero']),
      tipo: String(s['tipo']) as TipoSolicitacaoAutorizacao,
      situacao: String(s['situacao']) as SituacaoSolicitacaoAutorizacao,
      canal: String(s['canal']),
      fontePagadora: String(s['fonte']),
      carteira: String(s['numero_carteira']),
      atendimento: numOuNull(s['atendimento_id']),
      conta: numOuNull(s['conta_hospitalar_id']),
      solicitadaEm: iso(s['solicitada_em']),
      enviadaEm: iso(s['enviada_em']),
      observacao: txtOuNull(s['observacao']),
      versao: num(s['versao']),
      itens,
      respostas,
      consultas,
    };
  }

  criar(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number; numero: string }> {
    const e = entradaValida(esquemaCriar, entrada);
    return this.gravar(
      c,
      'tiss.autorizacao.criar',
      ['solicitacao_autorizacao', 'solicitacao_autorizacao_item', 'sequencia_negocio'],
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
        if (e.principal !== null)
          await confere(
            'SELECT id FROM solicitacao_autorizacao WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ?',
            [e.principal, paciente, est.id],
            'principal',
            'A guia principal não é deste paciente.',
          );
        const faturaveis = e.itens.map((i) => i.itemFaturavel).filter((x): x is number => x !== null);
        if (faturaveis.length && itens.some((i) => i.opme)) {
          const limites = await tx.consultar(
            `SELECT valor_limite, quantidade_limite FROM limite_opme_procedimento
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
          problemas.push(
            ...conferirLimiteOpme(
              itens,
              limites.map((x) => ({
                valorLimite: x['valor_limite'] === null ? null : Number(x['valor_limite']),
                quantidadeLimite: x['quantidade_limite'] === null ? null : Number(x['quantidade_limite']),
              })),
            ),
          );
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
          principal_solicitacao_autorizacao_id: e.principal,
          fonte_pagadora_id: num(cp['fonte_pagadora_id']),
          plano_fonte_pagadora_id: numOuNull(cp['plano_fonte_pagadora_id']),
          cobertura_paciente_id: e.cobertura,
          numero_carteira: String(cp['numero_carteira']).trim(),
          validade_carteira: dataIso(cp['validade']),
          solicitante_profissional_id: e.solicitanteProfissional,
          solicitante_externo_id: e.solicitanteExterno,
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
        void usuario;
        return { tabela: 'solicitacao_autorizacao', id: novo, numero };
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
             JOIN unidade_federativa uf ON uf.id = se.conselho_unidade_federativa_id
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
    const carater = await l.uma('SELECT urgencia FROM carater_atendimento_tiss WHERE id = ?', [
      s['carater_atendimento_tiss_id'],
    ]);
    const principal = s['principal_solicitacao_autorizacao_id']
      ? await l.uma('SELECT numero FROM solicitacao_autorizacao WHERE id = ?', [
          s['principal_solicitacao_autorizacao_id'],
        ])
      : null;
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
      cids: [],
      acidente: (txtOuNull(s['indicacao_acidente']) as DadosMensagemSolicitacao['acidente']) ?? null,
      observacao: txtOuNull(s['observacao']),
      itens,
    };
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
    return this.gravar(c, 'tiss.autorizacao.enviar', ['solicitacao_autorizacao'], async (tx, est) => {
      const s = await this.lerPedido(tx, est.id, solicitacao);
      const de = String(s['situacao']) as SituacaoSolicitacaoAutorizacao;
      if (!podeMudar(de, 'enviada'))
        throw recusaRegra('Envio recusado', [{ campo: 'situacao', mensagem: `O pedido está ${de}.` }]);
      const agora = new Date();
      let hash: string | null = null;
      let sequencial: string | null = null;
      if (s['canal'] === 'webservice') {
        sequencial = String(num(s['id']));
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
        hash = m.hash;
      }
      await tx.alterar('solicitacao_autorizacao', solicitacao, e.versao, {
        situacao: 'enviada',
        enviada_em: agora,
        sequencial_transacao: sequencial,
      });
      return { tabela: 'solicitacao_autorizacao', id: solicitacao, situacao: 'enviada' as const, hash };
    });
  }

  /** O XML do pedido enviado pelo webservice, remontado com o instante e o sequencial gravados no envio. */
  xml(c: ContextoPortaPropria, solicitacao: number): Promise<{ nome: string; xml: string }> {
    return this.ler(c, 'xml', async (l, est) => {
      const s = await this.lerPedido(l, est.id, solicitacao);
      if (s['canal'] !== 'webservice' || !s['enviada_em'] || !s['sequencial_transacao'])
        throw recusaRegra('XML indisponível', [
          { campo: 'situacao', mensagem: 'Só o pedido enviado pelo webservice tem XML.' },
        ]);
      const quando = s['enviada_em'] instanceof Date ? s['enviada_em'] : new Date(String(s['enviada_em']));
      const d = await this.dadosMensagem(l, est.id, s, String(s['sequencial_transacao']), quando, est.fuso);
      return { nome: `autorizacao-${String(s['numero'])}.xml`, xml: mensagemSolicitacaoAutorizacao(d).xml };
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
        // O pedido cancelado antes de sair fica com o instante do cancelamento (CHECK do envio pelo webservice).
        ...(s['enviada_em'] ? {} : { enviada_em: new Date() }),
      });
      return { tabela: 'solicitacao_autorizacao', id: solicitacao, situacao: 'cancelada' as const };
    });
  }
}
