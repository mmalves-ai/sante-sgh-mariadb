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
//     ou e-mail da central) e o evento registra isso.
// Nada se apaga: cada passo é um evento; a resposta confere a versão lida e grava a trilha pelo executor.
import {
  cargaDevolucaoRegulacao,
  CODIGOS_MOTIVO_RECUSA_REGULACAO,
  conferirRecebimentoRegulacao,
  conferirRespostaRegulacao,
  ordenarRecebidosRegulacao,
  PRIORIDADES_REGULACAO_ENTRADA,
  prioridadeListaEsperaDe,
  TIPOS_REGULACAO_ENTRADA,
} from '@sgh/dominio-internacao';
import { ErroOperacao, FORMATO_PONTO, gravarOutbox, type Leitor } from '@sgh/nucleo';
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
const TABELAS = ['solicitacao_regulacao', 'evento_regulacao', 'lista_espera', 'integracao_mensagem'] as const;
const OPERACAO = {
  receber: 'internacao.regulacao.receber',
  responder: 'internacao.regulacao.responder',
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
                r.resumo_clinico, r.observacao, r.mensagem_central,
                (SELECT MIN(le.id) FROM lista_espera le WHERE le.solicitacao_regulacao_id = r.id
                    AND le.excluido_em IS NULL) AS lista_espera
           FROM solicitacao_regulacao r
           JOIN central_reguladora cr ON cr.id = r.central_reguladora_id
           JOIN paciente p ON p.id = r.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
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
      await tx.alterar(TABELA, alvo, e.versao, {
        situacao: d.situacao,
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
        }),
        ocorrido_em: agora,
        usuario_id: usuario,
      });
      return {
        tabela: TABELA,
        id: alvo,
        situacao: d.situacao,
        listaEspera: lista,
        devolucao: conectada ? 'conector' : 'manual',
      };
    });
  }
}

async function exigirEspecialidade(tx: Leitor, especialidade: number): Promise<void> {
  const x = await tx.uma('SELECT id FROM especialidade_medica WHERE id = ? AND ativo = TRUE', [
    especialidade,
  ]);
  if (!x) throw naoEncontrado('Especialidade');
}
