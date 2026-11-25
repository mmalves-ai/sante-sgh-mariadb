// Regulação de entrada (C1-080, 02-REC linha 38): o pedido que a central de regulação manda para este hospital, no
// banco do cliente. As regras são as puras de @sgh/dominio-internacao (nir/regulacao-entrada.ts); aqui ficam a leitura
// e a gravação. Contrato de efeito:
//   - receber: `solicitacao_regulacao` com sentido 'entrada', situação 'solicitada', o número e a central, o tipo, a
//     prioridade, o paciente, o resumo clínico e quando a central pediu; o evento 'contato_central' em
//     `evento_regulacao` (o recebimento);
//   - responder: a solicitação na situação nova ('autorizada' ou 'negada', com regulado_em e, na recusa,
//     encerrado_em) e a mensagem à central; o evento 'resposta' com a situação anterior e a nova, o motivo
//     padronizado e o texto; no aceite de consulta, exame ou cirurgia, a entrada em `lista_espera` ligada ao pedido
//     (solicitacao_regulacao_id); com a central ligada por webservice, a devolução pela outbox
//     (`integracao_mensagem`, só IDs e códigos) na mesma transação; sem ela, a devolução é manual (telefone, portal
//     ou e-mail da central) e o evento registra isso; no aceite de internação ou transferência, o pedido de leito do
//     NIR (`pedido_leito`, origem 'regulacao', situação de estado 'solicitado', solicitante = o profissional vinculado
//     ao usuário) ligado nos dois sentidos (pedido_leito_id e solicitacao_regulacao_id);
//   - cancelar (a central cancelou, outro destino, não compareceu): a solicitação 'cancelada' com encerrado_em e a
//     mensagem; o evento 'cancelamento' com o motivo padronizado; a lista de espera aberta ligada 'cancelado' com o
//     motivo; o pedido de leito ligado ainda sem reserva cancelado com o motivo (com reserva, recusa: o NIR libera);
//   - concluir (o paciente chegou): a solicitação 'concluida' com encerrado_em na chegada e, na internação e na
//     transferência, a internação ligada (internacao_id, do mesmo paciente e estabelecimento); o evento
//     'mudanca_situacao' de 'autorizada' para 'concluida'.
// Nada se apaga: cada passo é um evento; a resposta confere a versão lida e grava a trilha pelo executor.
import {
  cargaDevolucaoRegulacao,
  CODIGOS_MOTIVO_CANCELAMENTO_REGULACAO,
  CODIGOS_MOTIVO_RECUSA_REGULACAO,
  conferirCancelamentoRegulacao,
  conferirConclusaoRegulacao,
  conferirRecebimentoRegulacao,
  conferirRespostaRegulacao,
  ordenarRecebidosRegulacao,
  PRIORIDADES_REGULACAO_ENTRADA,
  prioridadeListaEsperaDe,
  prioridadePedidoLeitoDe,
  TIPOS_REGULACAO_ENTRADA,
} from '@sgh/dominio-internacao';
import { ErroOperacao, FORMATO_PONTO, gravarOutbox, type Leitor, type TxOperacao } from '@sgh/nucleo';
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

export const PORTA_REGULACAO_ENTRADA = Symbol('PORTA_REGULACAO_ENTRADA');

const TABELA = 'solicitacao_regulacao';
const TABELAS = [
  'solicitacao_regulacao',
  'evento_regulacao',
  'lista_espera',
  'integracao_mensagem',
  'pedido_leito',
] as const;
const OPERACAO = {
  receber: 'internacao.regulacao.receber',
  responder: 'internacao.regulacao.responder',
  cancelar: 'internacao.regulacao.cancelar',
  concluir: 'internacao.regulacao.concluir',
} as const;
/** Ponto da devolução à central quando o cadastro da central não traz o seu. */
const PONTO_DEVOLUCAO = 'internacao.regulacao.responder';
const TETO = 500;

const id = z.number().int().positive();
const texto = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((s) => (s ? s : null));

const esquemaRecebimento = z
  .object({
    central: id,
    numero: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .transform((s) => s.toUpperCase()),
    tipo: z.enum(TIPOS_REGULACAO_ENTRADA),
    prioridade: z.enum(PRIORIDADES_REGULACAO_ENTRADA),
    paciente: id,
    solicitadoEm: z.string().datetime({ offset: true }).nullable().default(null),
    resumoClinico: texto(4000),
    observacao: texto(300),
  })
  .strict();

const esquemaResposta = z
  .object({
    decisao: z.enum(['aceitar', 'recusar']),
    motivo: z.enum(CODIGOS_MOTIVO_RECUSA_REGULACAO).nullable().default(null),
    complemento: texto(600),
    especialidade: id.nullable().default(null),
    versao: z.number().int().positive(),
  })
  .strict();

const esquemaCancelamento = z
  .object({
    motivo: z.enum(CODIGOS_MOTIVO_CANCELAMENTO_REGULACAO),
    complemento: texto(600),
    versao: z.number().int().positive(),
  })
  .strict();

const esquemaConclusao = z
  .object({
    chegadaEm: z.string().datetime({ offset: true }).nullable().default(null),
    internacao: id.nullable().default(null),
    versao: z.number().int().positive(),
  })
  .strict();

const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString()
      : new Date(String(v)).toISOString();

function dadosJson(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  try {
    return (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export interface RegulacaoRecebida {
  readonly id: number;
  readonly versao: number;
  readonly central: { id: number; sigla: string; nome: string; conexao: string };
  readonly numero: string;
  readonly tipo: string;
  readonly prioridade: string | null;
  readonly situacao: string;
  readonly paciente: { id: number; prontuario: number; nome: string };
  readonly solicitadoEm: string;
  readonly reguladoEm: string | null;
  readonly encerradoEm: string | null;
  readonly resumoClinico: string | null;
  readonly observacao: string | null;
  readonly mensagemCentral: string | null;
  readonly listaEspera: number | null;
  /** O pedido de leito do NIR aberto pelo aceite (internação e transferência). */
  readonly pedidoLeito: { id: number; numero: string; estado: string } | null;
  /** A internação a que o pedido concluído se ligou. */
  readonly internacao: number | null;
  /** A internação ativa do paciente neste estabelecimento (a que a chegada se liga). */
  readonly internacaoAtiva: number | null;
  readonly eventos: readonly {
    id: number;
    tipo: string;
    anterior: string | null;
    nova: string | null;
    observacao: string | null;
    motivo: string | null;
    devolucao: string | null;
    por: string | null;
    em: string;
  }[];
}

export class PortaRegulacaoEntradaPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'internacao.regulacao.entrada');
  }

  /** Centrais ativas (com a forma de conexão e o contato para a devolução manual) e especialidades ativas. */
  opcoes(c: ContextoPortaPropria) {
    return this.ler(c, 'opcoes', async (l) => ({
      centrais: (
        await l.consultar(
          `SELECT id, sigla, nome, forma_conexao, telefone, email FROM central_reguladora
            WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY sigla LIMIT 200`,
        )
      ).map((x) => ({
        id: num(x['id']),
        sigla: String(x['sigla']),
        nome: String(x['nome']),
        conexao: String(x['forma_conexao']),
        telefone: txtOuNull(x['telefone']),
        email: txtOuNull(x['email']),
      })),
      especialidades: (
        await l.consultar(
          'SELECT id, descricao FROM especialidade_medica WHERE ativo = TRUE ORDER BY descricao LIMIT 500',
        )
      ).map((x) => ({ id: num(x['id']), nome: String(x['descricao']) })),
    }));
  }

  /** Os pedidos recebidos do estabelecimento: os que pedem resposta primeiro; `todos` traz os respondidos. */
  recebidos(c: ContextoPortaPropria, filtro: { todos?: unknown; paciente?: unknown }) {
    const todos = filtro.todos === 'sim' || filtro.todos === true;
    const paciente = Number(filtro.paciente ?? 0);
    return this.ler(c, 'recebidos', async (l, est) => {
      const ls = await l.consultar(
        `SELECT r.id, r.versao, r.central_reguladora_id, cr.sigla, cr.nome AS central_nome, cr.forma_conexao,
                r.numero, r.tipo_solicitacao, r.prioridade, r.situacao, r.paciente_id, p.numero_prontuario,
                COALESCE(p.nome_social, pf.nome) AS nome, r.solicitado_em, r.regulado_em, r.encerrado_em,
                r.resumo_clinico, r.observacao, r.mensagem_central, r.internacao_id, r.pedido_leito_id,
                pl.numero AS pedido_leito_numero, sp.estado AS pedido_leito_estado,
                (SELECT MAX(i.id) FROM internacao i WHERE i.paciente_id = r.paciente_id
                    AND i.estabelecimento_id = r.estabelecimento_id AND i.situacao = 'ativa'
                    AND i.excluido_em IS NULL) AS internacao_ativa,
                (SELECT MIN(le.id) FROM lista_espera le WHERE le.solicitacao_regulacao_id = r.id
                    AND le.excluido_em IS NULL) AS lista_espera
           FROM solicitacao_regulacao r
           JOIN central_reguladora cr ON cr.id = r.central_reguladora_id
           JOIN paciente p ON p.id = r.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN pedido_leito pl ON pl.id = r.pedido_leito_id
           LEFT JOIN situacao_pedido_leito sp ON sp.id = pl.situacao_pedido_leito_id
          WHERE r.estabelecimento_id = ? AND r.sentido = 'entrada' AND r.excluido_em IS NULL
            ${todos ? '' : "AND r.situacao IN ('solicitada', 'em_analise')"}
            ${Number.isSafeInteger(paciente) && paciente > 0 ? 'AND r.paciente_id = ?' : ''}
          ORDER BY r.solicitado_em DESC, r.id DESC LIMIT ${TETO}`,
        Number.isSafeInteger(paciente) && paciente > 0 ? [est.id, paciente] : [est.id],
      );
      const ids = ls.map((x) => num(x['id']));
      const evs = ids.length
        ? await l.consultar(
            `SELECT e.id, e.solicitacao_regulacao_id, e.tipo_evento, e.situacao_anterior, e.situacao_nova,
                    e.observacao, e.dados, e.ocorrido_em, u.login
               FROM evento_regulacao e LEFT JOIN usuario u ON u.id = e.usuario_id
              WHERE e.solicitacao_regulacao_id IN (${ids.map(() => '?').join(', ')})
              ORDER BY e.ocorrido_em, e.id`,
            ids,
          )
        : [];
      const itens: RegulacaoRecebida[] = ls.map((x) => ({
        id: num(x['id']),
        versao: num(x['versao']),
        central: {
          id: num(x['central_reguladora_id']),
          sigla: String(x['sigla']),
          nome: String(x['central_nome']),
          conexao: String(x['forma_conexao']),
        },
        numero: String(x['numero'] ?? ''),
        tipo: String(x['tipo_solicitacao']),
        prioridade: txtOuNull(x['prioridade']),
        situacao: String(x['situacao']),
        paciente: {
          id: num(x['paciente_id']),
          prontuario: num(x['numero_prontuario']),
          nome: String(x['nome']),
        },
        solicitadoEm: iso(x['solicitado_em']) ?? '',
        reguladoEm: iso(x['regulado_em']),
        encerradoEm: iso(x['encerrado_em']),
        resumoClinico: txtOuNull(x['resumo_clinico']),
        observacao: txtOuNull(x['observacao']),
        mensagemCentral: txtOuNull(x['mensagem_central']),
        listaEspera: numOuNull(x['lista_espera']),
        pedidoLeito:
          x['pedido_leito_id'] === null || x['pedido_leito_id'] === undefined
            ? null
            : {
                id: num(x['pedido_leito_id']),
                numero: String(x['pedido_leito_numero'] ?? ''),
                estado: String(x['pedido_leito_estado'] ?? ''),
              },
        internacao: numOuNull(x['internacao_id']),
        internacaoAtiva: numOuNull(x['internacao_ativa']),
        eventos: evs
          .filter((e) => num(e['solicitacao_regulacao_id']) === num(x['id']))
          .map((e) => {
            const d = dadosJson(e['dados']);
            return {
              id: num(e['id']),
              tipo: String(e['tipo_evento']),
              anterior: txtOuNull(e['situacao_anterior']),
              nova: txtOuNull(e['situacao_nova']),
              observacao: txtOuNull(e['observacao']),
              motivo: txtOuNull(d['motivo']),
              devolucao: txtOuNull(d['devolucao']),
              por: txtOuNull(e['login']),
              em: iso(e['ocorrido_em']) ?? '',
            };
          }),
      }));
      return ordenarRecebidosRegulacao(itens);
    });
  }

  /** Registra o pedido que a central mandou (número da central à mão), na situação 'solicitada'. */
  receber(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaRecebimento, entrada);
    return this.gravar(c, OPERACAO.receber, TABELAS, async (tx, est, usuario) => {
      const agora = new Date();
      const solicitadoEm = e.solicitadoEm ? new Date(e.solicitadoEm) : agora;
      const problemas = conferirRecebimentoRegulacao({
        numero: e.numero,
        tipo: e.tipo,
        prioridade: e.prioridade,
        solicitadoEm,
        agora,
        resumoClinico: e.resumoClinico,
      });
      if (problemas.length) throw recusaRegra('Pedido da central recusado', problemas);
      const central = await tx.uma(
        'SELECT id FROM central_reguladora WHERE id = ? AND ativo = TRUE AND excluido_em IS NULL',
        [e.central],
      );
      if (!central) throw naoEncontrado('Central de regulação');
      const pac = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [e.paciente]);
      if (!pac) throw naoEncontrado('Paciente');
      const repetido = await tx.uma(
        'SELECT id FROM solicitacao_regulacao WHERE central_reguladora_id = ? AND numero = ?',
        [e.central, e.numero],
      );
      if (repetido)
        throw new ErroOperacao(
          409,
          'numero-repetido',
          'Pedido já registrado',
          'Esta central já tem um pedido com este número: abra o pedido registrado.',
        );
      const novo = await tx.incluir(TABELA, {
        estabelecimento_id: est.id,
        central_reguladora_id: e.central,
        numero: e.numero,
        sentido: 'entrada',
        tipo_solicitacao: e.tipo,
        prioridade: e.prioridade,
        situacao: 'solicitada',
        solicitado_em: solicitadoEm,
        paciente_id: e.paciente,
        resumo_clinico: e.resumoClinico,
        observacao: e.observacao,
        origem: 'sistema',
      });
      await tx.incluir('evento_regulacao', {
        solicitacao_regulacao_id: novo,
        central_reguladora_id: e.central,
        tipo_evento: 'contato_central',
        situacao_anterior: null,
        situacao_nova: 'solicitada',
        observacao: e.observacao,
        operacao: 'inclusao',
        dados: JSON.stringify({ acao: 'recebimento', tipo: e.tipo, prioridade: e.prioridade }),
        ocorrido_em: agora,
        usuario_id: usuario,
      });
      return { tabela: TABELA, id: novo, situacao: 'solicitada' };
    });
  }

  /** Aceita ou recusa o pedido recebido (regra do domínio, versão lida) e devolve a resposta à central. */
  responder(c: ContextoPortaPropria, alvo: number, entrada: unknown) {
    const e = entradaValida(esquemaResposta, entrada);
    return this.gravar(c, OPERACAO.responder, TABELAS, async (tx, est, usuario) => {
      const [r] = await tx.consultarParaAtualizar(
        `SELECT r.id, r.versao, r.situacao, r.tipo_solicitacao, r.prioridade, r.numero, r.paciente_id,
                r.central_reguladora_id, cr.forma_conexao, cr.ponto_integracao
           FROM solicitacao_regulacao r JOIN central_reguladora cr ON cr.id = r.central_reguladora_id
          WHERE r.id = ? AND r.estabelecimento_id = ? AND r.sentido = 'entrada' AND r.excluido_em IS NULL`,
        [alvo, est.id],
      );
      if (!r) throw naoEncontrado('Pedido da central');
      if (num(r['versao']) !== e.versao)
        throw new ErroOperacao(
          409,
          'versao-divergente',
          'Pedido mudou',
          'O pedido mudou depois que você abriu (outra pessoa respondeu). Abra de novo.',
        );
      const d = conferirRespostaRegulacao({
        situacao: String(r['situacao']),
        tipo: String(r['tipo_solicitacao']),
        decisao: e.decisao,
        motivo: e.motivo,
        complemento: e.complemento,
        especialidade: e.especialidade,
      });
      if (!d.ok) throw recusaRegra('Resposta recusada', d.problemas);
      const agora = new Date();
      let lista: number | null = null;
      if (d.listaEspera) {
        await exigirEspecialidade(tx, e.especialidade!);
        lista = await tx.incluir('lista_espera', {
          estabelecimento_id: est.id,
          paciente_id: num(r['paciente_id']),
          especialidade_medica_id: e.especialidade,
          prioridade: prioridadeListaEsperaDe(txtOuNull(r['prioridade'])),
          solicitacao_regulacao_id: alvo,
          situacao: 'aguardando',
          entrada_em: agora,
          observacao: `Regulado pela central, pedido ${String(r['numero'])}`.slice(0, 600),
          responsavel_usuario_id: usuario,
          origem: 'sistema',
        });
      }
      let pedidoLeito: number | null = null;
      if (d.pedidoLeito) {
        if (e.especialidade !== null) await exigirEspecialidade(tx, e.especialidade);
        const solicitante = await profissionalDoUsuario(tx, usuario, est.id);
        if (solicitante === null)
          throw recusaRegra('Resposta recusada', [
            {
              campo: 'profissional',
              mensagem:
                'O aceite de internação ou transferência abre o pedido de leito no NIR e exige um profissional vinculado ao seu usuário neste estabelecimento.',
            },
          ]);
        const situacaoLeito = await situacaoPedidoLeitoDo(tx, 'solicitado');
        const numero = await tx.proximoNumero('pedido_leito');
        pedidoLeito = await tx.incluir('pedido_leito', {
          estabelecimento_id: est.id,
          numero: numero.formatado,
          paciente_id: num(r['paciente_id']),
          setor_origem: 'regulacao',
          solicitante_profissional_id: solicitante,
          especialidade_medica_id: e.especialidade,
          nivel_cuidado: 'intermediario',
          prioridade: prioridadePedidoLeitoDe(txtOuNull(r['prioridade'])),
          justificativa: `Regulado pela central, pedido ${String(r['numero'])}`,
          data_hora_pedido: agora,
          situacao_pedido_leito_id: situacaoLeito,
          estado_situacao: 'solicitado',
          solicitacao_regulacao_id: alvo,
          origem: 'sistema',
        });
      }
      await tx.alterar(TABELA, alvo, e.versao, {
        situacao: d.situacao,
        ...(pedidoLeito !== null ? { pedido_leito_id: pedidoLeito } : {}),
        regulado_em: agora,
        ...(d.encerra ? { encerrado_em: agora } : {}),
        mensagem_central: d.texto.slice(0, 1000),
      });
      const ponto = txtOuNull(r['ponto_integracao']);
      const conectada = String(r['forma_conexao']) === 'webservice';
      let mensagem: number | null = null;
      if (conectada)
        mensagem = await gravarOutbox(tx, {
          estabelecimento: est.id,
          ponto: ponto && FORMATO_PONTO.test(ponto) ? ponto : PONTO_DEVOLUCAO,
          entidade: TABELA,
          entidadeId: alvo,
          chave: `${PONTO_DEVOLUCAO}:${alvo}:${d.situacao}`,
          carga: cargaDevolucaoRegulacao({
            solicitacao: alvo,
            numero: String(r['numero']),
            situacao: d.situacao,
            motivo: e.motivo,
          }),
          usuario,
          agora,
        });
      await tx.incluir('evento_regulacao', {
        solicitacao_regulacao_id: alvo,
        central_reguladora_id: num(r['central_reguladora_id']),
        tipo_evento: 'resposta',
        situacao_anterior: String(r['situacao']),
        situacao_nova: d.situacao,
        integracao_mensagem_id: mensagem,
        observacao: d.texto.slice(0, 2000),
        operacao: 'inclusao',
        dados: JSON.stringify({
          decisao: e.decisao,
          motivo: e.motivo,
          devolucao: conectada ? 'conector' : 'manual',
          listaEspera: lista,
          pedidoLeito,
        }),
        ocorrido_em: agora,
        usuario_id: usuario,
      });
      return {
        tabela: TABELA,
        id: alvo,
        situacao: d.situacao,
        listaEspera: lista,
        pedidoLeito,
        devolucao: conectada ? 'conector' : 'manual',
      };
    });
  }

  /** A solicitação de entrada travada para o encerramento, com o pedido de leito ligado. */
  private async travada(tx: TxOperacao, alvo: number, est: number, versao: number) {
    const [r] = await tx.consultarParaAtualizar(
      `SELECT r.id, r.versao, r.situacao, r.tipo_solicitacao, r.paciente_id, r.central_reguladora_id,
              r.regulado_em, r.pedido_leito_id, pl.versao AS pedido_leito_versao, sp.estado AS pedido_leito_estado
         FROM solicitacao_regulacao r
         LEFT JOIN pedido_leito pl ON pl.id = r.pedido_leito_id AND pl.excluido_em IS NULL
         LEFT JOIN situacao_pedido_leito sp ON sp.id = pl.situacao_pedido_leito_id
        WHERE r.id = ? AND r.estabelecimento_id = ? AND r.sentido = 'entrada' AND r.excluido_em IS NULL`,
      [alvo, est],
    );
    if (!r) throw naoEncontrado('Pedido da central');
    if (num(r['versao']) !== versao)
      throw new ErroOperacao(
        409,
        'versao-divergente',
        'Pedido mudou',
        'O pedido mudou depois que você abriu (outra pessoa o alterou). Abra de novo.',
      );
    return r;
  }

  /** Cancela o pedido recebido (a central cancelou, outro destino, não comparecimento): encerra sem apagar nada. */
  cancelar(c: ContextoPortaPropria, alvo: number, entrada: unknown) {
    const e = entradaValida(esquemaCancelamento, entrada);
    return this.gravar(c, OPERACAO.cancelar, TABELAS, async (tx, est, usuario) => {
      const r = await this.travada(tx, alvo, est.id, e.versao);
      const d = conferirCancelamentoRegulacao({
        situacao: String(r['situacao']),
        motivo: e.motivo,
        complemento: e.complemento,
        estadoPedidoLeito: txtOuNull(r['pedido_leito_estado']),
      });
      if (!d.ok) throw recusaRegra('Cancelamento recusado', d.problemas);
      const agora = new Date();
      const motivo = `Regulação cancelada: ${d.texto}`.slice(0, 300);
      const listas = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM lista_espera WHERE solicitacao_regulacao_id = ?
            AND situacao IN ('aguardando', 'ofertado') AND excluido_em IS NULL`,
        [alvo],
      );
      for (const le of listas)
        await tx.alterar('lista_espera', num(le['id']), num(le['versao']), {
          situacao: 'cancelado',
          encerrada_em: agora,
          motivo_encerramento: motivo,
        });
      let pedidoLeito: number | null = null;
      if (d.cancelaPedidoLeito) {
        pedidoLeito = num(r['pedido_leito_id']);
        await tx.alterar('pedido_leito', pedidoLeito, num(r['pedido_leito_versao']), {
          situacao_pedido_leito_id: await situacaoPedidoLeitoDo(tx, 'cancelado'),
          estado_situacao: 'cancelado',
          data_hora_cancelamento: agora,
          motivo_cancelamento: motivo.slice(0, 500),
          cancelado_por_usuario_id: usuario,
        });
      }
      await tx.alterar(TABELA, alvo, e.versao, {
        situacao: 'cancelada',
        encerrado_em: agora,
        mensagem_central: d.texto.slice(0, 1000),
      });
      await tx.incluir('evento_regulacao', {
        solicitacao_regulacao_id: alvo,
        central_reguladora_id: num(r['central_reguladora_id']),
        tipo_evento: 'cancelamento',
        situacao_anterior: String(r['situacao']),
        situacao_nova: 'cancelada',
        observacao: d.texto.slice(0, 2000),
        operacao: 'inclusao',
        dados: JSON.stringify({
          acao: 'cancelamento',
          motivo: e.motivo,
          listasEspera: listas.map((x) => num(x['id'])),
          pedidoLeito,
        }),
        ocorrido_em: agora,
        usuario_id: usuario,
      });
      return {
        tabela: TABELA,
        id: alvo,
        situacao: 'cancelada',
        listasEspera: listas.length,
        pedidoLeito,
      };
    });
  }

  /** Conclui o pedido aceito na chegada do paciente (na internação e na transferência, ligado à internação). */
  concluir(c: ContextoPortaPropria, alvo: number, entrada: unknown) {
    const e = entradaValida(esquemaConclusao, entrada);
    return this.gravar(c, OPERACAO.concluir, TABELAS, async (tx, est, usuario) => {
      const r = await this.travada(tx, alvo, est.id, e.versao);
      const agora = new Date();
      const chegadaEm = e.chegadaEm ? new Date(e.chegadaEm) : agora;
      const regulado = r['regulado_em'] ? new Date(r['regulado_em'] as string | Date) : null;
      const d = conferirConclusaoRegulacao({
        situacao: String(r['situacao']),
        tipo: String(r['tipo_solicitacao']),
        chegadaEm,
        reguladoEm: regulado,
        agora,
        internacao: e.internacao,
      });
      if (!d.ok) throw recusaRegra('Conclusão recusada', d.problemas);
      if (e.internacao !== null) {
        const i = await tx.uma(
          `SELECT id FROM internacao WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ?
              AND situacao <> 'cancelada' AND excluido_em IS NULL`,
          [e.internacao, num(r['paciente_id']), est.id],
        );
        if (!i)
          throw recusaRegra('Conclusão recusada', [
            {
              campo: 'internacao',
              mensagem: 'A internação não é deste paciente neste estabelecimento ou foi cancelada.',
            },
          ]);
      }
      const encerrado = regulado && chegadaEm < regulado ? regulado : chegadaEm;
      await tx.alterar(TABELA, alvo, e.versao, {
        situacao: 'concluida',
        encerrado_em: encerrado,
        ...(e.internacao !== null ? { internacao_id: e.internacao } : {}),
      });
      await tx.incluir('evento_regulacao', {
        solicitacao_regulacao_id: alvo,
        central_reguladora_id: num(r['central_reguladora_id']),
        tipo_evento: 'mudanca_situacao',
        situacao_anterior: 'autorizada',
        situacao_nova: 'concluida',
        observacao: d.texto,
        operacao: 'inclusao',
        dados: JSON.stringify({
          acao: 'conclusao',
          chegadaEm: chegadaEm.toISOString(),
          internacao: e.internacao,
          pedidoLeito: numOuNull(r['pedido_leito_id']),
        }),
        ocorrido_em: agora,
        usuario_id: usuario,
      });
      return { tabela: TABELA, id: alvo, situacao: 'concluida', internacao: e.internacao };
    });
  }
}

/** O profissional de saúde vinculado ao usuário no estabelecimento (vínculo vigente), ou null. */
async function profissionalDoUsuario(
  tx: Leitor,
  usuario: number | null,
  est: number,
): Promise<number | null> {
  if (usuario === null) return null;
  const v = await tx.uma(
    `SELECT MIN(profissional_id) AS id FROM usuario_vinculo_profissional
      WHERE usuario_id = ? AND estabelecimento_id = ? AND profissional_id IS NOT NULL AND excluido_em IS NULL
        AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`,
    [usuario, est],
  );
  return numOuNull(v?.['id']);
}

/** A situação ativa do pedido de leito para o estado do fluxo do NIR. */
async function situacaoPedidoLeitoDo(tx: Leitor, estado: 'solicitado' | 'cancelado'): Promise<number> {
  const s = await tx.uma(
    'SELECT id FROM situacao_pedido_leito WHERE estado = ? AND ativo = TRUE ORDER BY ordem_exibicao, id LIMIT 1',
    [estado],
  );
  if (!s)
    throw new ErroOperacao(
      422,
      'cadastro-incompleto',
      'Cadastro do NIR incompleto',
      `Cadastre uma situação de pedido de leito com o estado "${estado}" no NIR.`,
    );
  return num(s['id']);
}

async function exigirEspecialidade(tx: Leitor, especialidade: number): Promise<void> {
  const x = await tx.uma('SELECT id FROM especialidade_medica WHERE id = ? AND ativo = TRUE', [
    especialidade,
  ]);
  if (!x) throw naoEncontrado('Especialidade');
}
