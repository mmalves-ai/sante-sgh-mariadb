// Cópia do prontuário pedida e entregue no balcão (F3, 03-PEP L131; CFM 1.821/2007 e LGPD art. 18 II e art. 19), no
// banco do cliente (`solicitacao_copia_prontuario`, `entrega_copia_prontuario`). O portal do paciente segue com a fila
// de atos dele; aqui é o balcão do arquivo médico. Contrato de efeito:
//   - pedidos: a fila do estabelecimento (em aberto primeiro, com o prazo e o atraso) ou a visão por paciente (todos
//     os pedidos dele, com a entrega), mais as opções da tela (tipos de documento de identidade ativos);
//   - pedir: validado pela regra do domínio (quem pede, CPF pelo dígito, parentesco, procuração do procurador,
//     período, motivo, prazo de até 15 dias), grava o pedido numerado (sequência do estabelecimento) com o prazo;
//   - acao: pela versão lida (conflito: 409), aplica a transição do domínio (análise, autorização, que exige o
//     documento de autorização quando quem pede não é o paciente, produção, pronta, negativa e cancelamento com
//     motivo); a autorização grava quem autorizou e quando; a pronta, quando foi impressa; nada se apaga;
//   - entregar: pela versão lida, confere no domínio quem recebeu (nome, vínculo com direito a receber, documento de
//     identidade conferido, procuração do procurador, folhas entregues, endereço do correio) e grava a entrega com
//     quem entregou e quando; o pedido passa a entregue na mesma transação. Uma entrega por pedido.
// Regra de negócio no domínio (@sgh/dominio-documento), nenhuma em gatilho. SQL parametrizado, no estabelecimento da
// sessão; o paciente e os arquivos são conferidos no banco.
import {
  ACOES_COPIA_BALCAO,
  copiaAtrasada,
  exigeAutorizacao,
  FORMAS_ENTREGA_COPIA,
  FORMATOS_COPIA,
  prazoDaCopia,
  PRAZO_PADRAO_COPIA_DIAS,
  SOLICITANTES_COPIA_BALCAO,
  type SituacaoCopiaBalcao,
  type SolicitanteCopiaBalcao,
  transicaoCopia,
  validarEntregaCopia,
  validarPedidoCopiaBalcao,
  VINCULOS_RECEBEDOR_COPIA,
} from '@sgh/dominio-documento';
import { ErroOperacao, garantirSequencia, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  type ContextoPortaPropria,
  entradaValida,
  type EstabelecimentoDaSessao,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_COPIA_PRONTUARIO_BALCAO = Symbol('PORTA_COPIA_PRONTUARIO_BALCAO');

const SOLICITACAO = 'solicitacao_copia_prontuario';
const ENTREGA = 'entrega_copia_prontuario';
const SEQUENCIA = 'sequencia_negocio';
const TIPO_SEQUENCIA = 'solicitacao_copia_prontuario';
/** Teto da fila do balcão de uma vez. */
export const TETO_FILA_COPIAS = 300;

type Linha = Record<string, unknown>;

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const texto = (max: number) => z.string().trim().max(max);
const esquemaPedido = z
  .object({
    paciente: id,
    atendimento: id.nullable().default(null),
    solicitanteTipo: z.enum(SOLICITANTES_COPIA_BALCAO),
    solicitanteNome: texto(150),
    solicitanteCpf: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .nullable()
      .default(null)
      .transform((v) => (v ? v : null)),
    solicitanteParentesco: texto(60).nullable().default(null),
    motivo: texto(150),
    detalhamento: texto(4000).nullable().default(null),
    periodoInicio: data.nullable().default(null),
    periodoFim: data.nullable().default(null),
    prazoDias: z.number().int().default(PRAZO_PADRAO_COPIA_DIAS),
    formato: z.enum(FORMATOS_COPIA).default('impresso'),
    incluirCancelados: z.boolean().default(false),
    procuracaoArquivo: id.nullable().default(null),
    autorizacaoArquivo: id.nullable().default(null),
    valorCusto: z.number().min(0).max(100000).default(0),
    observacao: texto(2000).nullable().default(null),
  })
  .strict();
const esquemaAcao = z
  .object({
    versao: id,
    acao: z.enum(ACOES_COPIA_BALCAO),
    motivo: texto(500).nullable().default(null),
    autorizacaoArquivo: id.nullable().default(null),
  })
  .strict();
const esquemaEntrega = z
  .object({
    versao: id,
    forma: z.enum(FORMAS_ENTREGA_COPIA).default('presencial'),
    recebedorNome: texto(150),
    vinculo: z.enum(VINCULOS_RECEBEDOR_COPIA),
    tipoDocumento: id,
    numeroDocumento: texto(30),
    documentoExpedidoEm: data.nullable().default(null),
    telefone: texto(20).nullable().default(null),
    endereco: texto(300).nullable().default(null),
    quantidadeFolhas: z.number().int().nullable().default(null),
    procuracaoArquivo: id.nullable().default(null),
    observacao: texto(2000).nullable().default(null),
  })
  .strict();
const esquemaFiltro = z
  .object({
    paciente: z.coerce.number().int().positive().optional(),
    situacao: z.enum(['abertas', 'todas']).optional(),
  })
  .strict();

export interface EntregaLida {
  readonly id: number;
  readonly forma: string;
  readonly entregueEm: string | null;
  readonly entregador: string | null;
  readonly recebedorNome: string;
  readonly vinculo: string;
  readonly tipoDocumento: string | null;
  readonly quantidadeFolhas: number | null;
}

export interface PedidoCopiaLido {
  readonly id: number;
  readonly versao: number;
  readonly numero: number;
  readonly paciente: number;
  readonly pacienteNome: string;
  readonly prontuario: string | null;
  readonly atendimento: number | null;
  readonly solicitanteTipo: string;
  readonly solicitanteNome: string;
  readonly solicitanteParentesco: string | null;
  readonly motivo: string;
  readonly periodoInicio: string | null;
  readonly periodoFim: string | null;
  readonly solicitadaEm: string | null;
  readonly prazo: string;
  readonly atrasada: boolean;
  readonly formato: string;
  readonly situacao: SituacaoCopiaBalcao;
  readonly temAutorizacao: boolean;
  readonly temProcuracao: boolean;
  readonly autorizadaEm: string | null;
  readonly motivoNegativa: string | null;
  readonly portal: boolean;
  readonly entrega: EntregaLida | null;
}

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : (v instanceof Date ? v : new Date(String(v))).toISOString();
const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date)
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
};
/** Hoje no fuso do estabelecimento (AAAA-MM-DD). */
const hojeNoFuso = (agora: Date, fuso: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);

const SQL_PEDIDOS = `
  SELECT s.id, s.versao, s.numero, s.paciente_id, pf.nome AS paciente_nome, pc.numero_prontuario, s.atendimento_id,
         s.solicitante_tipo, s.solicitante_nome, s.solicitante_parentesco, s.motivo, s.periodo_inicio, s.periodo_fim,
         s.solicitada_em, s.prazo_entrega, s.formato_entrega, s.situacao, s.autorizacao_arquivo_id,
         s.procuracao_arquivo_id, s.autorizada_em, s.motivo_negativa, s.pedido_titular_id,
         e.id AS entrega_id, e.forma_entrega, e.entregue_em AS entrega_em, ue.nome AS entregador, e.recebedor_nome,
         e.vinculo_com_paciente, td.descricao AS tipo_documento, e.quantidade_folhas
    FROM solicitacao_copia_prontuario s
    JOIN paciente pc ON pc.id = s.paciente_id
    JOIN pessoa_fisica pf ON pf.id = pc.pessoa_fisica_id
    LEFT JOIN entrega_copia_prontuario e ON e.solicitacao_copia_prontuario_id = s.id AND e.excluido_em IS NULL
    LEFT JOIN usuario ue ON ue.id = e.entregador_usuario_id
    LEFT JOIN tipo_documento_identificacao td ON td.id = e.tipo_documento_identificacao_id
   WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL`;

function pedidoLido(r: Linha, hoje: string): PedidoCopiaLido {
  const situacao = String(r['situacao']) as SituacaoCopiaBalcao;
  const prazo = dataIso(r['prazo_entrega']) ?? hoje;
  return {
    id: num(r['id']),
    versao: num(r['versao']),
    numero: num(r['numero']),
    paciente: num(r['paciente_id']),
    pacienteNome: String(r['paciente_nome'] ?? ''),
    prontuario: txtOuNull(r['numero_prontuario']),
    atendimento: numOuNull(r['atendimento_id']),
    solicitanteTipo: String(r['solicitante_tipo']),
    solicitanteNome: String(r['solicitante_nome']),
    solicitanteParentesco: txtOuNull(r['solicitante_parentesco']),
    motivo: String(r['motivo']),
    periodoInicio: dataIso(r['periodo_inicio']),
    periodoFim: dataIso(r['periodo_fim']),
    solicitadaEm: iso(r['solicitada_em']),
    prazo,
    atrasada: copiaAtrasada(situacao, prazo, hoje),
    formato: String(r['formato_entrega']),
    situacao,
    temAutorizacao: r['autorizacao_arquivo_id'] !== null && r['autorizacao_arquivo_id'] !== undefined,
    temProcuracao: r['procuracao_arquivo_id'] !== null && r['procuracao_arquivo_id'] !== undefined,
    autorizadaEm: iso(r['autorizada_em']),
    motivoNegativa: txtOuNull(r['motivo_negativa']),
    portal: r['pedido_titular_id'] !== null && r['pedido_titular_id'] !== undefined,
    entrega:
      r['entrega_id'] === null || r['entrega_id'] === undefined
        ? null
        : {
            id: num(r['entrega_id']),
            forma: String(r['forma_entrega']),
            entregueEm: iso(r['entrega_em']),
            entregador: txtOuNull(r['entregador']),
            recebedorNome: String(r['recebedor_nome']),
            vinculo: String(r['vinculo_com_paciente']),
            tipoDocumento: txtOuNull(r['tipo_documento']),
            quantidadeFolhas: numOuNull(r['quantidade_folhas']),
          },
  };
}

const conflito = () =>
  new ErroOperacao(
    409,
    'conflito-versao',
    'O pedido mudou',
    'Outra pessoa alterou o pedido de cópia: recarregue e confira.',
  );

export class PortaCopiaProntuarioBalcaoPropria extends PortaEstabelecimentoPropria {
  constructor(
    nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0],
    cliente: string,
    private readonly relogio: () => Date = () => new Date(),
  ) {
    super(nucleo, cliente, [SOLICITACAO, ENTREGA, SEQUENCIA], 'pep.copia-balcao');
  }

  /** A fila do balcão (ou a visão por paciente) e as opções da tela. */
  pedidos(c: ContextoPortaPropria, consulta: unknown) {
    const f = entradaValida(esquemaFiltro, consulta ?? {});
    return this.ler(c, 'pedidos', async (l, est) => {
      const hoje = hojeNoFuso(this.relogio(), est.fuso);
      const params: unknown[] = [est.id];
      let filtro = '';
      if (f.paciente) {
        filtro += ' AND s.paciente_id = ?';
        params.push(f.paciente);
      }
      if (f.situacao !== 'todas' && !f.paciente)
        filtro += " AND s.situacao NOT IN ('entregue','negada','cancelada')";
      const linhas = await l.consultar<Linha>(
        `${SQL_PEDIDOS}${filtro} ORDER BY s.situacao IN ('entregue','negada','cancelada'), s.prazo_entrega, s.id
          LIMIT ${TETO_FILA_COPIAS}`,
        params,
      );
      return {
        hoje,
        pedidos: linhas.map((r) => pedidoLido(r, hoje)),
        opcoes: { tiposDocumento: await this.tiposDocumento(l) },
      };
    });
  }

  private async tiposDocumento(l: Leitor) {
    return (
      await l.consultar<Linha>(
        `SELECT id, descricao AS rotulo FROM tipo_documento_identificacao
          WHERE ativo AND aplica_a = 'pessoa_fisica' ORDER BY descricao LIMIT 200`,
      )
    ).map((r) => ({ id: num(r['id']), rotulo: String(r['rotulo']) }));
  }

  private async exigirArquivo(tx: TxOperacao, arquivo: number | null, nome: string): Promise<void> {
    if (arquivo === null) return;
    if (!(await tx.uma('SELECT id FROM arquivo WHERE id = ? AND excluido_em IS NULL', [arquivo])))
      throw naoEncontrado(nome);
  }

  /** Grava o pedido feito no balcão. */
  async pedir(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaPedido, entrada);
    return this.gravar(c, 'pep.copia-balcao.pedir', [SOLICITACAO, SEQUENCIA], async (tx, est, usuario) => {
      const agora = this.relogio();
      const hoje = hojeNoFuso(agora, est.fuso);
      const falhas = validarPedidoCopiaBalcao({
        solicitanteTipo: e.solicitanteTipo,
        solicitanteNome: e.solicitanteNome,
        solicitanteCpf: e.solicitanteCpf,
        solicitanteParentesco: e.solicitanteParentesco,
        motivo: e.motivo,
        periodoInicio: e.periodoInicio,
        periodoFim: e.periodoFim,
        prazoDias: e.prazoDias,
        formato: e.formato,
        temProcuracao: e.procuracaoArquivo !== null,
        hoje,
      });
      if (falhas.length) throw recusaRegra('Pedido de cópia recusado', falhas);
      if (!(await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [e.paciente])))
        throw naoEncontrado('Paciente');
      if (
        e.atendimento !== null &&
        !(await tx.uma(
          'SELECT id FROM atendimento WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.atendimento, e.paciente, est.id],
        ))
      )
        throw naoEncontrado('Atendimento do paciente');
      await this.exigirArquivo(tx, e.procuracaoArquivo, 'Procuração digitalizada');
      await this.exigirArquivo(tx, e.autorizacaoArquivo, 'Autorização digitalizada');
      await garantirSequencia(
        tx,
        { tipo: TIPO_SEQUENCIA, estabelecimento: est.id, prefixo: '' },
        { usuario, agora },
      );
      const numero = await tx.proximoNumero(TIPO_SEQUENCIA);
      const pedido = await tx.incluir(SOLICITACAO, {
        estabelecimento_id: est.id,
        numero: numero.valor,
        paciente_id: e.paciente,
        atendimento_id: e.atendimento,
        periodo_inicio: e.periodoInicio,
        periodo_fim: e.periodoFim,
        solicitante_tipo: e.solicitanteTipo,
        solicitante_nome: e.solicitanteNome,
        solicitante_cpf: e.solicitanteCpf,
        solicitante_parentesco: e.solicitanteParentesco,
        motivo: e.motivo,
        detalhamento: e.detalhamento,
        solicitada_em: agora,
        prazo_entrega: prazoDaCopia(hoje, e.prazoDias),
        formato_entrega: e.formato,
        incluir_cancelados: e.incluirCancelados,
        procuracao_arquivo_id: e.procuracaoArquivo,
        autorizacao_arquivo_id: e.autorizacaoArquivo,
        valor_custo: e.valorCusto,
        situacao: 'solicitada',
        observacao: e.observacao,
      });
      return { tabela: SOLICITACAO, id: pedido, numero: numero.valor };
    });
  }

  private async travar(tx: TxOperacao, est: EstabelecimentoDaSessao, pedido: number, versao: number) {
    const [s] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, situacao, solicitante_tipo, autorizacao_arquivo_id, procuracao_arquivo_id
         FROM solicitacao_copia_prontuario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [pedido, est.id],
    );
    if (!s) throw naoEncontrado('Pedido de cópia');
    if (num(s['versao']) !== versao) throw conflito();
    return s;
  }

  /** Análise, autorização, produção, pronta, negativa e cancelamento, pela regra do domínio. */
  async acao(c: ContextoPortaPropria, pedido: number, entrada: unknown) {
    const e = entradaValida(esquemaAcao, entrada);
    return this.gravar(c, 'pep.copia-balcao.acao', [SOLICITACAO], async (tx, est, usuario) => {
      const s = await this.travar(tx, est, pedido, e.versao);
      await this.exigirArquivo(tx, e.autorizacaoArquivo, 'Autorização digitalizada');
      const solicitante = String(s['solicitante_tipo']) as SolicitanteCopiaBalcao;
      const autorizacao = e.autorizacaoArquivo ?? numOuNull(s['autorizacao_arquivo_id']);
      const t = transicaoCopia(String(s['situacao']) as SituacaoCopiaBalcao, {
        acao: e.acao,
        solicitanteTipo: solicitante,
        temAutorizacao: autorizacao !== null,
        motivo: e.motivo,
      });
      if ('recusa' in t) throw recusaRegra('Ação recusada', [t.recusa]);
      const agora = this.relogio();
      const valores: Record<string, unknown> = { situacao: t.situacao };
      if (e.acao === 'autorizar') {
        valores['autorizador_usuario_id'] = usuario;
        valores['autorizada_em'] = agora;
        if (exigeAutorizacao(solicitante)) valores['autorizacao_arquivo_id'] = autorizacao;
      }
      if (e.acao === 'pronta') valores['impressa_em'] = agora;
      if (e.acao === 'negar') valores['motivo_negativa'] = e.motivo;
      if (e.acao === 'cancelar') valores['observacao'] = `Cancelado: ${e.motivo ?? ''}`.slice(0, 2000);
      await tx.alterar(SOLICITACAO, pedido, e.versao, valores);
      return { tabela: SOLICITACAO, id: pedido, situacao: t.situacao };
    });
  }

  /** A entrega no balcão: quem recebeu, com a identidade conferida; o pedido passa a entregue. */
  async entregar(c: ContextoPortaPropria, pedido: number, entrada: unknown) {
    const e = entradaValida(esquemaEntrega, entrada);
    return this.gravar(c, 'pep.copia-balcao.entregar', [SOLICITACAO, ENTREGA], async (tx, est, usuario) => {
      const s = await this.travar(tx, est, pedido, e.versao);
      const tipo = await tx.uma('SELECT id FROM tipo_documento_identificacao WHERE id = ? AND ativo', [
        e.tipoDocumento,
      ]);
      await this.exigirArquivo(tx, e.procuracaoArquivo, 'Procuração digitalizada');
      const procuracao = e.procuracaoArquivo ?? numOuNull(s['procuracao_arquivo_id']);
      const falhas = validarEntregaCopia({
        situacao: String(s['situacao']) as SituacaoCopiaBalcao,
        solicitanteTipo: String(s['solicitante_tipo']) as SolicitanteCopiaBalcao,
        forma: e.forma,
        recebedorNome: e.recebedorNome,
        vinculo: e.vinculo,
        temTipoDocumento: tipo !== null && tipo !== undefined,
        numeroDocumento: e.numeroDocumento,
        temProcuracao: procuracao !== null,
        quantidadeFolhas: e.quantidadeFolhas,
        endereco: e.endereco,
      });
      if (falhas.length) throw recusaRegra('Entrega recusada', falhas);
      if (
        await tx.uma(
          'SELECT id FROM entrega_copia_prontuario WHERE solicitacao_copia_prontuario_id = ? AND excluido_em IS NULL',
          [pedido],
        )
      )
        throw recusaRegra('Entrega recusada', [
          { campo: 'situacao', mensagem: 'A cópia já foi entregue: uma nova cópia é um pedido novo.' },
        ]);
      const agora = this.relogio();
      const entrega = await tx.incluir(ENTREGA, {
        estabelecimento_id: est.id,
        solicitacao_copia_prontuario_id: pedido,
        forma_entrega: e.forma,
        entregue_em: agora,
        entregador_usuario_id: usuario,
        recebedor_nome: e.recebedorNome,
        vinculo_com_paciente: e.vinculo,
        tipo_documento_identificacao_id: e.tipoDocumento,
        numero_documento: e.numeroDocumento,
        documento_expedido_em: e.documentoExpedidoEm,
        telefone: e.telefone,
        endereco: e.endereco,
        quantidade_folhas: e.quantidadeFolhas,
        procuracao_arquivo_id: e.vinculo === 'procurador' ? procuracao : null,
        observacao: e.observacao,
      });
      await tx.alterar(SOLICITACAO, pedido, e.versao, { situacao: 'entregue', entregue_em: agora });
      return { tabela: ENTREGA, id: entrega, pedido };
    });
  }
}
