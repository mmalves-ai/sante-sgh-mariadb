// SAME: protocolo de envio em lote entre setores e solicitação/empréstimo de prontuário (F3.9, 04-HOT L127 e L128), no
// banco do cliente. As regras são as puras de @sgh/dominio-hotelaria (same-tramite.ts); aqui ficam a leitura e a gravação.
// Contrato de efeito:
//   - emitir protocolo: `protocolo_tramite` (número do estabelecimento, conteúdo pelos itens, remetente e destinatário,
//     emitido e enviado no mesmo passo, situação 'enviado') e um `protocolo_tramite_item` por item, em sequência;
//   - receber: cada item conferido fica recebido (instante e quem recebeu) ou recusado (motivo); o lote passa a
//     'recebido_parcial', 'recebido' ou 'recusado' pelos itens, com o recebedor e o instante quando fecha;
//   - cancelar: o lote fica 'cancelado' com o instante e o motivo (nada apagado);
//   - solicitar: `solicitacao_prontuario` (número, arquivo, setor de destino, motivo, data desejada) e um
//     `solicitacao_prontuario_item` por volume pedido (ou o paciente inteiro, volume nulo);
//   - emprestar: o movimento de saída da guarda (`movimento_prontuario`, operação de tipo 'emprestimo', destino e
//     previsão de retorno = prazo) e `emprestimo_prontuario` preso a ele (volume, motivo, solicitação, destino,
//     solicitante, entregador, prazo pelo motivo, situação do volume antes da saída); o volume 'emprestado', fora do
//     local; o item da solicitação fica 'emprestado' (com o movimento) e a solicitação recalculada pelos itens;
//   - devolver: o movimento de entrada da guarda (tipo 'devolucao') fecha a saída (`devolvido_em`); o empréstimo
//     'devolvido' com o instante e quem recebeu; o volume volta à situação de antes, no local. Se a guarda já recebeu
//     o volume, só o empréstimo fecha, com o instante da guarda;
//   - cobrar: soma o aviso de atraso (`cobrancas_enviadas`, `ultima_cobranca_em`) só no empréstimo atrasado; a saída
//     por empréstimo feita na guarda, sem documento, ganha o `emprestimo_prontuario` na primeira cobrança;
//   - receber volume no protocolo: o movimento da guarda (tipo 'recebimento', com o protocolo) e a nova posse do
//     volume (no arquivo do destinatário ou com o setor dele);
//   - cancelar solicitação: 'cancelada' com o motivo e quem; os itens pendentes 'cancelado'; não localizado: o item
//     'nao_localizado' com onde se procurou, a solicitação recalculada. Nada se apaga.
// A posse do volume tem uma fonte só, a trilha da guarda (F3.9-4): o que o trâmite move aparece no histórico da guarda,
// e o que a guarda devolve fecha o empréstimo (lido pelo movimento de saída).
import {
  conferirCancelamentoProtocolo,
  conferirCancelamentoSolicitacao,
  conferirEmprestimo,
  conferirNaoLocalizado,
  conferirProtocolo,
  conferirRecebimento,
  conferirSolicitacaoAberta,
  conferirVolumeNoProtocolo,
  conteudoDoProtocolo,
  diasDeAtraso,
  type PontaTramite,
  type PosseVolume,
  posseAoReceber,
  prazoDoEmprestimo,
  type SituacaoItemSolicitacao,
  type SituacaoProtocolo,
  type SituacaoSolicitacao,
  type SituacaoVolumeEmprestimo,
  situacaoAposDevolucao,
  situacaoDaSolicitacaoPelosItens,
  situacaoPelosItens,
  TIPOS_ITEM_PROTOCOLO,
} from '@sgh/dominio-hotelaria';
import type { Leitor, TxOperacao } from '@sgh/nucleo';
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

export const PORTA_SAME_TRAMITE = Symbol('PORTA_SAME_TRAMITE');

const TABELAS = [
  'setor_tramite',
  'protocolo_tramite',
  'protocolo_tramite_item',
  'solicitacao_prontuario',
  'solicitacao_prontuario_item',
  'emprestimo_prontuario',
  'volume_prontuario',
  'movimento_prontuario',
];

/** Prazo padrão de devolução do arquivo, quando o motivo não tem prazo (dias). */
export const PRAZO_PADRAO_EMPRESTIMO_DIAS = 7;

const id = z.number().int().positive();
const textoOuNull = (max: number) => z.string().trim().max(max).nullable().default(null);
const instante = z.string().datetime({ offset: true });

const esquemaSetor = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    tipo: z.enum(['arquivo', 'faturamento', 'auditoria', 'unidade', 'administrativo', 'externo']),
    setorFuncional: id.nullable().default(null),
    localArquivo: id.nullable().default(null),
  })
  .strict();

const esquemaProtocolo = z
  .object({
    remetente: id,
    destinatario: id,
    prioridade: z.enum(['normal', 'urgente']).default('normal'),
    portador: id.nullable().default(null),
    etiqueta: textoOuNull(40),
    lacre: textoOuNull(30),
    observacao: textoOuNull(2000),
    itens: z
      .array(
        z
          .object({
            tipo: z.enum(TIPOS_ITEM_PROTOCOLO),
            alvo: id.nullable().default(null),
            descricao: textoOuNull(200),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

const esquemaRecebimento = z
  .object({
    itens: z.array(z.object({ item: id, aceito: z.boolean(), motivo: textoOuNull(500) }).strict()).max(500),
    versao: z.number().int().positive(),
  })
  .strict();

const esquemaCancelar = z
  .object({ motivo: z.string().trim().max(500), versao: z.number().int().positive() })
  .strict();

const esquemaSolicitacao = z
  .object({
    localArquivo: id,
    destino: id,
    motivo: id,
    desejadaPara: instante.nullable().default(null),
    descricao: textoOuNull(150),
    observacao: textoOuNull(2000),
    itens: z
      .array(
        z
          .object({
            paciente: id,
            volume: id.nullable().default(null),
            atendimento: id.nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

const esquemaEmprestimo = z
  .object({
    volume: id,
    destinoSetor: id,
    motivo: id.nullable().default(null),
    solicitacao: id.nullable().default(null),
    solicitanteProfissional: id.nullable().default(null),
    prazoDias: z.number().int().min(1).max(365).nullable().default(null),
    observacao: textoOuNull(2000),
    versao: z.number().int().positive().optional(),
  })
  .strict();

const esquemaNaoLocalizado = z
  .object({ item: id, motivo: z.string().trim().max(500), versao: z.number().int().positive() })
  .strict();

const esquemaDevolucao = z
  .object({ versao: z.number().int().positive(), observacao: textoOuNull(2000) })
  .strict();

const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString()
      : new Date(String(v)).toISOString();

async function numeroSeguinte(tx: TxOperacao, tabela: string, tipo: string, est: number): Promise<number> {
  try {
    return (await tx.proximoNumero(tipo)).valor;
  } catch {
    // Cliente sem a numeração configurada: o próximo do estabelecimento, com a leitura travada.
    const r = await tx.consultarParaAtualizar<Record<string, unknown>>(
      `SELECT COALESCE(MAX(CAST(numero AS UNSIGNED)), 0) + 1 AS n FROM ${tabela} WHERE estabelecimento_id = ?`,
      [est],
    );
    return num(r[0]?.['n'] ?? 1);
  }
}

export interface ProtocoloLido {
  readonly id: number;
  readonly numero: number;
  readonly conteudo: string;
  readonly remetente: { id: number; descricao: string };
  readonly destinatario: { id: number; descricao: string };
  readonly prioridade: string;
  readonly situacao: SituacaoProtocolo;
  readonly emitidoEm: string;
  readonly recebidoEm: string | null;
  readonly motivoCancelamento: string | null;
  readonly versao: number;
  readonly itens: {
    id: number;
    sequencia: number;
    tipo: string;
    alvo: number | null;
    descricao: string | null;
    recebido: boolean;
    recebidoEm: string | null;
    recusado: boolean;
    motivoRecusa: string | null;
  }[];
}

export interface EmprestimoLido {
  /** Nulo na saída por empréstimo feita na guarda ainda sem o documento (ganha na primeira cobrança). */
  readonly id: number | null;
  /** O movimento de saída da guarda que levou o volume. */
  readonly movimento: number | null;
  readonly origem: 'tramite' | 'guarda';
  readonly numero: string;
  readonly volume: { id: number; matricula: string | null; paciente: number };
  readonly destino: string;
  readonly motivo: string | null;
  readonly solicitacao: number | null;
  readonly emprestadoEm: string;
  readonly prazo: string;
  readonly devolvidoEm: string | null;
  readonly situacao: string;
  readonly diasAtraso: number;
  readonly cobrancas: number;
  readonly versao: number;
}

// ------------------------------------------------------------------- custódia: a trilha da guarda (movimento_prontuario)

type Ler = Pick<Leitor, 'uma'>;

/** A saída da guarda ainda sem retorno (empréstimo ou saída para setor), a mais recente. */
function saidaAberta(l: Ler, volume: number) {
  return l.uma(
    `SELECT m.id, m.versao, m.devolvido_em FROM movimento_prontuario m
       JOIN operacao_movimento_prontuario op ON op.id = m.operacao_movimento_prontuario_id
      WHERE m.volume_prontuario_id = ? AND m.excluido_em IS NULL AND m.devolvido_em IS NULL AND op.sentido = 'saida'
        AND op.encerra_guarda = FALSE ORDER BY m.movimentado_em DESC, m.id DESC LIMIT 1`,
    [volume],
  );
}

/** Onde o volume está, pela situação, pelo último movimento da guarda e pelos protocolos em trânsito. */
async function posseDoVolume(l: Ler, v: Record<string, unknown>): Promise<PosseVolume> {
  const volume = num(v['id']);
  const ultimo = await l.uma(
    `SELECT destino_setor_funcional_id FROM movimento_prontuario WHERE volume_prontuario_id = ? AND excluido_em IS NULL
      ORDER BY movimentado_em DESC, id DESC LIMIT 1`,
    [volume],
  );
  const transito = await l.uma(
    `SELECT i.id FROM protocolo_tramite_item i JOIN protocolo_tramite p ON p.id = i.protocolo_tramite_id
      WHERE i.volume_prontuario_id = ? AND i.excluido_em IS NULL AND NOT i.recebido AND NOT i.recusado
        AND p.situacao IN ('enviado','recebido_parcial') AND p.excluido_em IS NULL LIMIT 1`,
    [volume],
  );
  return {
    situacao: String(v['situacao']) as SituacaoVolumeEmprestimo,
    noLocal: bool(v['no_local']),
    localArquivo: numOuNull(v['local_arquivo_id']),
    setorAtual: numOuNull(ultimo?.['destino_setor_funcional_id']),
    saidaAberta: !!(await saidaAberta(l, volume)),
    emTransito: !!transito,
  };
}

async function pontaTramite(l: Ler, setor: number): Promise<PontaTramite> {
  const s = await l.uma('SELECT setor_funcional_id, local_arquivo_id FROM setor_tramite WHERE id = ?', [
    setor,
  ]);
  return { setor: numOuNull(s?.['setor_funcional_id']), local: numOuNull(s?.['local_arquivo_id']) };
}

/** A operação ativa da guarda do tipo pedido (a de código igual ao tipo primeiro). */
async function operacaoDaGuarda(l: Ler, tipo: 'emprestimo' | 'devolucao' | 'recebimento'): Promise<number> {
  const o = await l.uma(
    'SELECT id FROM operacao_movimento_prontuario WHERE tipo = ? AND ativo = TRUE ORDER BY codigo = ? DESC, id LIMIT 1',
    [tipo, tipo],
  );
  if (!o)
    throw recusaRegra('Operação do arquivo ausente', [
      { campo: 'operacao', mensagem: `O cadastro do arquivo não tem operação ativa do tipo '${tipo}'.` },
    ]);
  return num(o['id']);
}

/** A situação da solicitação recalculada pelos itens, gravada com o fecho quando sai da fila. */
async function recalcularSolicitacao(
  tx: TxOperacao,
  solicitacao: Record<string, unknown>,
  usuario: number,
  agora: Date,
  extra: Record<string, unknown> = {},
): Promise<SituacaoSolicitacao> {
  const itens = await tx.consultar<Record<string, unknown>>(
    'SELECT situacao FROM solicitacao_prontuario_item WHERE solicitacao_prontuario_id = ? AND excluido_em IS NULL',
    [solicitacao['id']],
  );
  const situacao = situacaoDaSolicitacaoPelosItens(
    itens.map((i) => String(i['situacao']) as SituacaoItemSolicitacao),
  );
  const fecha = situacao !== 'pendente' && situacao !== 'em_atendimento';
  await tx.alterar('solicitacao_prontuario', num(solicitacao['id']), num(solicitacao['versao']), {
    situacao,
    ...(fecha ? { finalizada_em: agora, finalizacao_usuario_id: usuario } : {}),
    ...extra,
  });
  return situacao;
}

export class PortaSameTramitePropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'same.tramite');
  }

  /** O que a tela precisa para montar o protocolo e o pedido: setores de trâmite, motivos, portadores, arquivos e setores. */
  apoio(c: ContextoPortaPropria) {
    return this.ler(c, 'apoio', async (l, est) => ({
      setoresTramite: (
        await l.consultar(
          'SELECT id, codigo, descricao, tipo FROM setor_tramite WHERE ativo ORDER BY descricao LIMIT 500',
        )
      ).map((x) => ({
        id: num(x['id']),
        codigo: String(x['codigo']),
        descricao: String(x['descricao']),
        tipo: String(x['tipo']),
      })),
      motivos: (
        await l.consultar(
          'SELECT id, codigo, descricao, finalidade, urgente, prazo_devolucao_dias FROM motivo_solicitacao_prontuario WHERE ativo ORDER BY descricao',
        )
      ).map((x) => ({
        id: num(x['id']),
        descricao: String(x['descricao']),
        finalidade: String(x['finalidade']),
        urgente: bool(x['urgente']),
        prazoDias: numOuNull(x['prazo_devolucao_dias']),
      })),
      portadores: (
        await l.consultar(
          'SELECT id, descricao FROM portador_documento WHERE ativo ORDER BY descricao LIMIT 500',
        )
      ).map((x) => ({ id: num(x['id']), descricao: String(x['descricao']) })),
      setores: (
        await l.consultar(
          'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome LIMIT 1000',
          [est.id],
        )
      ).map((x) => ({ id: num(x['id']), nome: String(x['nome']) })),
      arquivos: (
        await l.consultar(
          `SELECT id, COALESCE(caminho, descricao) AS caminho FROM local_arquivo
            WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL AND local_arquivo_pai_id IS NULL ORDER BY caminho LIMIT 200`,
          [est.id],
        )
      ).map((x) => ({ id: num(x['id']), caminho: String(x['caminho']) })),
      prazoPadraoDias: PRAZO_PADRAO_EMPRESTIMO_DIAS,
    }));
  }

  incluirSetorTramite(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaSetor, entrada);
    return this.gravar(c, 'same.tramite.incluir_setor', ['setor_tramite'], async (tx) => {
      if (e.tipo === 'arquivo' && e.localArquivo === null)
        throw recusaRegra('Setor recusado', [
          { campo: 'localArquivo', mensagem: 'O setor de arquivo aponta o local de guarda.' },
        ]);
      if (await tx.uma('SELECT id FROM setor_tramite WHERE codigo = ?', [e.codigo]))
        throw recusaRegra('Setor recusado', [
          { campo: 'codigo', mensagem: 'Já existe um setor com este código.' },
        ]);
      const novo = await tx.incluir('setor_tramite', {
        codigo: e.codigo,
        descricao: e.descricao,
        tipo: e.tipo,
        setor_funcional_id: e.setorFuncional,
        local_arquivo_id: e.localArquivo,
        registra_movimento: true,
        ativo: true,
      });
      return { tabela: 'setor_tramite', id: novo };
    });
  }

  // ------------------------------------------------------------------------------------------------------ protocolo

  emitirProtocolo(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; numero: number; itens: number }> {
    const e = entradaValida(esquemaProtocolo, entrada);
    return this.gravar(
      c,
      'same.tramite.emitir_protocolo',
      ['protocolo_tramite', 'protocolo_tramite_item'],
      async (tx, est, usuario) => {
        const problemas = conferirProtocolo({
          remetente: e.remetente,
          destinatario: e.destinatario,
          itens: e.itens,
        });
        for (const s of [e.remetente, e.destinatario])
          if (!(await tx.uma('SELECT id FROM setor_tramite WHERE id = ? AND ativo', [s])))
            problemas.push({
              campo: s === e.remetente ? 'remetente' : 'destinatario',
              mensagem: 'Setor de trâmite inexistente ou inativo.',
            });
        const remetente = await pontaTramite(tx, e.remetente);
        const destinatario = await pontaTramite(tx, e.destinatario);
        for (const [n, i] of e.itens.entries()) {
          if (i.tipo === 'documento' || i.alvo === null) continue;
          if (i.tipo === 'volume_prontuario') {
            // O volume tem de estar com o remetente, fora de empréstimo e de outro lote (travado contra a corrida).
            const [v] = await tx.consultarParaAtualizar<Record<string, unknown>>(
              'SELECT id, situacao, no_local, local_arquivo_id FROM volume_prontuario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
              [i.alvo, est.id],
            );
            if (v)
              for (const mensagem of conferirVolumeNoProtocolo(
                await posseDoVolume(tx, v),
                remetente,
                destinatario,
              ))
                problemas.push({ campo: `itens.${n}.alvo`, mensagem });
          }
          const [tabela, filtro] =
            i.tipo === 'volume_prontuario'
              ? ['volume_prontuario', "situacao NOT IN ('eliminado','extraviado') AND excluido_em IS NULL"]
              : i.tipo === 'atendimento'
                ? ['atendimento', 'excluido_em IS NULL']
                : ['conta_hospitalar', 'excluido_em IS NULL'];
          if (
            !(await tx.uma(`SELECT id FROM ${tabela} WHERE id = ? AND estabelecimento_id = ? AND ${filtro}`, [
              i.alvo,
              est.id,
            ]))
          )
            problemas.push({
              campo: `itens.${n}.alvo`,
              mensagem: 'O item não existe neste estabelecimento (ou o volume foi eliminado ou extraviado).',
            });
        }
        if (problemas.length) throw recusaRegra('Protocolo recusado', problemas);
        const agora = new Date();
        const numero = await numeroSeguinte(tx, 'protocolo_tramite', 'protocolo_tramite', est.id);
        const protocolo = await tx.incluir('protocolo_tramite', {
          estabelecimento_id: est.id,
          numero,
          tipo_conteudo: conteudoDoProtocolo(e.itens),
          remetente_setor_tramite_id: e.remetente,
          destinatario_setor_tramite_id: e.destinatario,
          prioridade: e.prioridade,
          emissor_usuario_id: usuario,
          emitido_em: agora,
          enviado_em: agora,
          portador_documento_id: e.portador,
          codigo_etiqueta: e.etiqueta,
          lacre_primario: e.lacre,
          situacao: 'enviado',
          observacao: e.observacao,
        });
        for (const [n, i] of e.itens.entries())
          await tx.incluir('protocolo_tramite_item', {
            protocolo_tramite_id: protocolo,
            sequencia: n + 1,
            tipo_item: i.tipo,
            volume_prontuario_id: i.tipo === 'volume_prontuario' ? i.alvo : null,
            atendimento_id: i.tipo === 'atendimento' ? i.alvo : null,
            conta_hospitalar_id: i.tipo === 'conta' ? i.alvo : null,
            descricao_documento: i.tipo === 'documento' ? i.descricao : null,
          });
        return { tabela: 'protocolo_tramite', id: protocolo, numero, itens: e.itens.length };
      },
    );
  }

  /** Os protocolos que chegam ao setor (a fila de recebimento) ou que saíram dele, dos mais recentes. */
  protocolos(
    c: ContextoPortaPropria,
    f: { setor: number | null; sentido: 'entrada' | 'saida'; abertos: boolean },
  ) {
    return this.ler(c, 'protocolos', async (l, est) => {
      const col = f.sentido === 'entrada' ? 'destinatario_setor_tramite_id' : 'remetente_setor_tramite_id';
      const ids = await l.consultar(
        `SELECT id FROM protocolo_tramite WHERE estabelecimento_id = ? AND excluido_em IS NULL
            ${f.setor === null ? '' : `AND ${col} = ?`}
            ${f.abertos ? "AND situacao IN ('enviado','recebido_parcial')" : ''}
          ORDER BY emitido_em DESC, id DESC LIMIT 100`,
        f.setor === null ? [est.id] : [est.id, f.setor],
      );
      const r: ProtocoloLido[] = [];
      for (const x of ids) r.push((await this.lerProtocolo(l, est.id, num(x['id'])))!);
      return r;
    });
  }

  protocolo(c: ContextoPortaPropria, protocolo: number): Promise<ProtocoloLido> {
    return this.ler(c, 'protocolo', async (l, est) => {
      const p = await this.lerProtocolo(l, est.id, protocolo);
      if (!p) throw naoEncontrado('Protocolo');
      return p;
    });
  }

  private async lerProtocolo(
    l: Pick<Leitor, 'uma' | 'consultar'>,
    est: number,
    protocolo: number,
  ): Promise<ProtocoloLido | null> {
    const p = await l.uma(
      `SELECT p.*, r.descricao AS r_desc, d.descricao AS d_desc FROM protocolo_tramite p
         JOIN setor_tramite r ON r.id = p.remetente_setor_tramite_id JOIN setor_tramite d ON d.id = p.destinatario_setor_tramite_id
        WHERE p.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`,
      [protocolo, est],
    );
    if (!p) return null;
    const itens = await l.consultar(
      'SELECT * FROM protocolo_tramite_item WHERE protocolo_tramite_id = ? AND excluido_em IS NULL ORDER BY sequencia',
      [protocolo],
    );
    return {
      id: num(p['id']),
      numero: num(p['numero']),
      conteudo: String(p['tipo_conteudo']),
      remetente: { id: num(p['remetente_setor_tramite_id']), descricao: String(p['r_desc']) },
      destinatario: { id: num(p['destinatario_setor_tramite_id']), descricao: String(p['d_desc']) },
      prioridade: String(p['prioridade']),
      situacao: String(p['situacao']) as SituacaoProtocolo,
      emitidoEm: iso(p['emitido_em'])!,
      recebidoEm: iso(p['recebido_em']),
      motivoCancelamento: txtOuNull(p['motivo_cancelamento']),
      versao: num(p['versao']),
      itens: itens.map((i) => ({
        id: num(i['id']),
        sequencia: num(i['sequencia']),
        tipo: String(i['tipo_item']),
        alvo: numOuNull(i['volume_prontuario_id'] ?? i['atendimento_id'] ?? i['conta_hospitalar_id']),
        descricao: txtOuNull(i['descricao_documento']),
        recebido: bool(i['recebido']),
        recebidoEm: iso(i['recebido_em']),
        recusado: bool(i['recusado']),
        motivoRecusa: txtOuNull(i['motivo_recusa']),
      })),
    };
  }

  /** O recebimento item a item (recebe ou recusa com motivo); a situação do lote sai dos itens. */
  receber(
    c: ContextoPortaPropria,
    protocolo: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: SituacaoProtocolo }> {
    const e = entradaValida(esquemaRecebimento, entrada);
    return this.gravar(
      c,
      'same.tramite.receber_protocolo',
      ['protocolo_tramite', 'protocolo_tramite_item', 'movimento_prontuario', 'volume_prontuario'],
      async (tx, est, usuario) => {
        const [p] = await tx.consultarParaAtualizar<Record<string, unknown>>(
          `SELECT id, situacao, versao, remetente_setor_tramite_id, destinatario_setor_tramite_id
             FROM protocolo_tramite WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [protocolo, est.id],
        );
        if (!p) throw naoEncontrado('Protocolo');
        const itens = await tx.consultarParaAtualizar<Record<string, unknown>>(
          'SELECT id, recebido, recusado, versao, tipo_item, volume_prontuario_id FROM protocolo_tramite_item WHERE protocolo_tramite_id = ? AND excluido_em IS NULL',
          [protocolo],
        );
        const lidos = itens.map((i) => ({
          id: num(i['id']),
          recebido: bool(i['recebido']),
          recusado: bool(i['recusado']),
          versao: num(i['versao']),
          volume:
            String(i['tipo_item']) === 'volume_prontuario' ? numOuNull(i['volume_prontuario_id']) : null,
        }));
        const problemas = conferirRecebimento(String(p['situacao']) as SituacaoProtocolo, lidos, e.itens);
        if (num(p['versao']) !== e.versao)
          problemas.push({ campo: 'versao', mensagem: 'O protocolo mudou desde a leitura: recarregue.' });
        if (problemas.length) throw recusaRegra('Recebimento recusado', problemas);
        const agora = new Date();
        for (const ci of e.itens) {
          const i = lidos.find((x) => x.id === ci.item)!;
          await tx.alterar(
            'protocolo_tramite_item',
            i.id,
            i.versao,
            ci.aceito
              ? { recebido: true, recebido_em: agora, recebedor_usuario_id: usuario }
              : { recusado: true, motivo_recusa: ci.motivo, recebedor_usuario_id: usuario },
          );
          Object.assign(i, ci.aceito ? { recebido: true } : { recusado: true });
          if (ci.aceito && i.volume !== null)
            await this.registrarPosse(tx, est.id, usuario, p, i.volume, agora);
        }
        const situacao = situacaoPelosItens(lidos);
        const fechou = situacao === 'recebido' || situacao === 'recusado';
        await tx.alterar('protocolo_tramite', protocolo, e.versao, {
          situacao,
          ...(fechou ? { recebido_em: agora, recebedor_usuario_id: usuario } : {}),
        });
        return { tabela: 'protocolo_tramite', id: protocolo, situacao };
      },
    );
  }

  /** O volume recebido no protocolo: o movimento da guarda (recebimento, com o protocolo) e a nova posse. */
  private async registrarPosse(
    tx: TxOperacao,
    est: number,
    usuario: number,
    p: Record<string, unknown>,
    volume: number,
    agora: Date,
  ): Promise<void> {
    const [v] = await tx.consultarParaAtualizar<Record<string, unknown>>(
      'SELECT id, paciente_id, atendimento_id, situacao, no_local, local_arquivo_id, versao FROM volume_prontuario WHERE id = ? AND estabelecimento_id = ?',
      [volume, est],
    );
    if (!v) return;
    const remetente = await pontaTramite(tx, num(p['remetente_setor_tramite_id']));
    const destinatario = await pontaTramite(tx, num(p['destinatario_setor_tramite_id']));
    const antes = await posseDoVolume(tx, v);
    const efeito = posseAoReceber(antes, destinatario);
    const origem = antes.noLocal ? remetente.setor : (antes.setorAtual ?? remetente.setor);
    await tx.incluir('movimento_prontuario', {
      estabelecimento_id: est,
      volume_prontuario_id: volume,
      paciente_id: num(v['paciente_id']),
      atendimento_id: numOuNull(v['atendimento_id']),
      operacao_movimento_prontuario_id: await operacaoDaGuarda(tx, 'recebimento'),
      movimentado_em: agora,
      movimentado_por_usuario_id: usuario,
      saida_setor_funcional_id: origem,
      destino_setor_funcional_id:
        origem !== null && origem === destinatario.setor ? null : destinatario.setor,
      saida_local_arquivo_id: antes.noLocal ? antes.localArquivo : null,
      destino_local_arquivo_id: efeito.noLocal ? efeito.localArquivo : null,
      protocolo_tramite_id: num(p['id']),
      observacao: `Recebido pelo protocolo de trâmite ${num(p['id'])}`,
    });
    await tx.alterar('volume_prontuario', volume, num(v['versao']), {
      situacao: efeito.situacao,
      no_local: efeito.noLocal,
      local_arquivo_id: efeito.localArquivo,
    });
  }

  cancelarProtocolo(c: ContextoPortaPropria, protocolo: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaCancelar, entrada);
    return this.gravar(c, 'same.tramite.cancelar_protocolo', ['protocolo_tramite'], async (tx, est) => {
      const p = await tx.uma(
        'SELECT situacao FROM protocolo_tramite WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [protocolo, est.id],
      );
      if (!p) throw naoEncontrado('Protocolo');
      const problemas = conferirCancelamentoProtocolo(String(p['situacao']) as SituacaoProtocolo, e.motivo);
      if (problemas.length) throw recusaRegra('Cancelamento recusado', problemas);
      await tx.alterar('protocolo_tramite', protocolo, e.versao, {
        situacao: 'cancelado',
        cancelado_em: new Date(),
        motivo_cancelamento: e.motivo,
      });
      return { tabela: 'protocolo_tramite', id: protocolo };
    });
  }

  // --------------------------------------------------------------------------------------- solicitação e empréstimo

  solicitar(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number; numero: number }> {
    const e = entradaValida(esquemaSolicitacao, entrada);
    return this.gravar(
      c,
      'same.tramite.solicitar',
      ['solicitacao_prontuario', 'solicitacao_prontuario_item'],
      async (tx, est, usuario) => {
        const problemas: { campo: string; mensagem: string }[] = [];
        if (
          !(await tx.uma(
            'SELECT id FROM local_arquivo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [e.localArquivo, est.id],
          ))
        )
          problemas.push({ campo: 'localArquivo', mensagem: 'Arquivo inexistente neste estabelecimento.' });
        if (!(await tx.uma('SELECT id FROM setor_tramite WHERE id = ? AND ativo', [e.destino])))
          problemas.push({ campo: 'destino', mensagem: 'Setor de destino inexistente ou inativo.' });
        if (
          !(await tx.uma('SELECT id FROM motivo_solicitacao_prontuario WHERE id = ? AND ativo', [e.motivo]))
        )
          problemas.push({ campo: 'motivo', mensagem: 'Motivo inexistente ou inativo.' });
        const vistos = new Set<string>();
        for (const [n, i] of e.itens.entries()) {
          const chave = `${i.paciente}:${i.volume}`;
          if (vistos.has(chave))
            problemas.push({ campo: `itens.${n}`, mensagem: 'O volume já está no pedido.' });
          vistos.add(chave);
          if (
            i.volume !== null &&
            !(await tx.uma(
              'SELECT id FROM volume_prontuario WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ?',
              [i.volume, i.paciente, est.id],
            ))
          )
            problemas.push({
              campo: `itens.${n}.volume`,
              mensagem: 'O volume não é deste paciente neste estabelecimento.',
            });
        }
        if (problemas.length) throw recusaRegra('Solicitação recusada', problemas);
        const numero = await numeroSeguinte(tx, 'solicitacao_prontuario', 'solicitacao_prontuario', est.id);
        const s = await tx.incluir('solicitacao_prontuario', {
          estabelecimento_id: est.id,
          numero,
          local_arquivo_id: e.localArquivo,
          destino_setor_tramite_id: e.destino,
          motivo_solicitacao_prontuario_id: e.motivo,
          solicitante_usuario_id: usuario,
          solicitada_em: new Date(),
          desejada_para: e.desejadaPara ? new Date(e.desejadaPara) : null,
          descricao: e.descricao,
          situacao: 'pendente',
          observacao: e.observacao,
        });
        for (const [n, i] of e.itens.entries())
          await tx.incluir('solicitacao_prontuario_item', {
            solicitacao_prontuario_id: s,
            sequencia: n + 1,
            paciente_id: i.paciente,
            volume_prontuario_id: i.volume,
            atendimento_id: i.atendimento,
            situacao: 'pendente',
          });
        return { tabela: 'solicitacao_prontuario', id: s, numero };
      },
    );
  }

  /** As solicitações abertas (a fila do arquivo), das mais urgentes e antigas. */
  solicitacoesAbertas(c: ContextoPortaPropria) {
    return this.ler(c, 'solicitacoes', async (l, est) =>
      (
        await l.consultar(
          `SELECT s.id, s.numero, s.situacao, s.solicitada_em, s.desejada_para, s.versao, m.descricao AS motivo, m.urgente,
                  d.descricao AS destino, (SELECT COUNT(*) FROM solicitacao_prontuario_item i WHERE i.solicitacao_prontuario_id = s.id) AS itens
             FROM solicitacao_prontuario s JOIN motivo_solicitacao_prontuario m ON m.id = s.motivo_solicitacao_prontuario_id
             LEFT JOIN setor_tramite d ON d.id = s.destino_setor_tramite_id
            WHERE s.estabelecimento_id = ? AND s.situacao IN ('pendente','em_atendimento') AND s.excluido_em IS NULL
            ORDER BY m.urgente DESC, COALESCE(s.desejada_para, s.solicitada_em), s.id LIMIT 200`,
          [est.id],
        )
      ).map((x) => ({
        id: num(x['id']),
        numero: num(x['numero']),
        situacao: String(x['situacao']),
        motivo: String(x['motivo']),
        urgente: bool(x['urgente']),
        destino: txtOuNull(x['destino']),
        solicitadaEm: iso(x['solicitada_em']),
        desejadaPara: iso(x['desejada_para']),
        itens: num(x['itens']),
        versao: num(x['versao']),
      })),
    );
  }

  /** Os itens da solicitação, com a situação e a observação (a fila do arquivo trata item a item). */
  itensDaSolicitacao(c: ContextoPortaPropria, solicitacao: number) {
    return this.ler(c, 'solicitacao', async (l, est) => {
      if (
        !(await l.uma('SELECT id FROM solicitacao_prontuario WHERE id = ? AND estabelecimento_id = ?', [
          solicitacao,
          est.id,
        ]))
      )
        throw naoEncontrado('Solicitação');
      return (
        await l.consultar(
          `SELECT i.id, i.sequencia, i.paciente_id, i.volume_prontuario_id, i.situacao, i.observacao, i.atendido_em,
                  v.numero_matricula
             FROM solicitacao_prontuario_item i LEFT JOIN volume_prontuario v ON v.id = i.volume_prontuario_id
            WHERE i.solicitacao_prontuario_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
          [solicitacao],
        )
      ).map((x) => ({
        id: num(x['id']),
        sequencia: num(x['sequencia']),
        paciente: num(x['paciente_id']),
        volume: numOuNull(x['volume_prontuario_id']),
        matricula: txtOuNull(x['numero_matricula']),
        situacao: String(x['situacao']),
        observacao: txtOuNull(x['observacao']),
        atendidoEm: iso(x['atendido_em']),
      }));
    });
  }

  emprestar(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; prazo: string; solicitacao: SituacaoSolicitacao | null }> {
    const e = entradaValida(esquemaEmprestimo, entrada);
    return this.gravar(
      c,
      'same.tramite.emprestar',
      [
        'emprestimo_prontuario',
        'movimento_prontuario',
        'volume_prontuario',
        'solicitacao_prontuario',
        'solicitacao_prontuario_item',
      ],
      async (tx, est, usuario) => {
        const [v] = await tx.consultarParaAtualizar<Record<string, unknown>>(
          'SELECT id, paciente_id, atendimento_id, situacao, no_local, local_arquivo_id, versao FROM volume_prontuario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.volume, est.id],
        );
        if (!v) throw naoEncontrado('Volume');
        // Aberto: o empréstimo cujo movimento de saída a guarda ainda não fechou, ou qualquer saída sem retorno.
        const aberto = await tx.uma(
          `SELECT e.id FROM emprestimo_prontuario e LEFT JOIN movimento_prontuario mv ON mv.id = e.movimento_prontuario_id
            WHERE e.volume_prontuario_id = ? AND e.situacao = 'emprestado' AND e.excluido_em IS NULL
              AND (mv.id IS NULL OR mv.devolvido_em IS NULL)`,
          [e.volume],
        );
        const posse = await posseDoVolume(tx, v);
        const problemas = conferirEmprestimo({
          situacao: posse.situacao,
          noLocal: posse.noLocal,
          emprestimoAberto: !!aberto || posse.saidaAberta,
          emTransito: posse.emTransito,
        });
        if (e.versao !== undefined && num(v['versao']) !== e.versao)
          problemas.push({ campo: 'versao', mensagem: 'O volume mudou desde a leitura: recarregue.' });
        if (
          !(await tx.uma('SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ?', [
            e.destinoSetor,
            est.id,
          ]))
        )
          problemas.push({
            campo: 'destinoSetor',
            mensagem: 'Setor de destino inexistente neste estabelecimento.',
          });
        let motivo = e.motivo;
        let item: Record<string, unknown> | null = null;
        let solicitacao: Record<string, unknown> | null = null;
        if (e.solicitacao !== null) {
          [solicitacao = null] = await tx.consultarParaAtualizar<Record<string, unknown>>(
            'SELECT id, situacao, versao, motivo_solicitacao_prontuario_id FROM solicitacao_prontuario WHERE id = ? AND estabelecimento_id = ?',
            [e.solicitacao, est.id],
          );
          if (!solicitacao) throw naoEncontrado('Solicitação');
          problemas.push(
            ...conferirSolicitacaoAberta(String(solicitacao['situacao']) as SituacaoSolicitacao),
          );
          motivo = motivo ?? num(solicitacao['motivo_solicitacao_prontuario_id']);
          item = await tx.uma(
            `SELECT id, versao FROM solicitacao_prontuario_item WHERE solicitacao_prontuario_id = ? AND paciente_id = ?
                AND (volume_prontuario_id = ? OR volume_prontuario_id IS NULL) AND situacao = 'pendente'
              ORDER BY volume_prontuario_id IS NULL, sequencia LIMIT 1`,
            [e.solicitacao, v['paciente_id'], e.volume],
          );
          if (!item)
            problemas.push({
              campo: 'solicitacao',
              mensagem: 'O volume não está pendente nesta solicitação.',
            });
        }
        if (motivo === null) problemas.push({ campo: 'motivo', mensagem: 'Informe o motivo do empréstimo.' });
        const m =
          motivo === null
            ? null
            : await tx.uma(
                'SELECT prazo_devolucao_dias FROM motivo_solicitacao_prontuario WHERE id = ? AND ativo',
                [motivo],
              );
        if (motivo !== null && !m)
          problemas.push({ campo: 'motivo', mensagem: 'Motivo inexistente ou inativo.' });
        if (problemas.length) throw recusaRegra('Empréstimo recusado', problemas);
        const agora = new Date();
        const prazo = prazoDoEmprestimo(agora, {
          informado: e.prazoDias,
          doMotivo: numOuNull(m?.['prazo_devolucao_dias']),
          padrao: PRAZO_PADRAO_EMPRESTIMO_DIAS,
        });
        // A saída vai para a trilha da guarda (o histórico do volume mostra o empréstimo); o empréstimo prende-se a ela.
        const movimento = await tx.incluir('movimento_prontuario', {
          estabelecimento_id: est.id,
          volume_prontuario_id: e.volume,
          paciente_id: num(v['paciente_id']),
          atendimento_id: numOuNull(v['atendimento_id']),
          operacao_movimento_prontuario_id: await operacaoDaGuarda(tx, 'emprestimo'),
          movimentado_em: agora,
          movimentado_por_usuario_id: usuario,
          saida_setor_funcional_id: null,
          destino_setor_funcional_id: e.destinoSetor,
          saida_local_arquivo_id: posse.localArquivo,
          destino_local_arquivo_id: null,
          solicitacao_prontuario_id: e.solicitacao,
          responsavel_profissional_id: e.solicitanteProfissional,
          previsao_retorno: prazo,
          observacao: e.observacao,
        });
        const numero = await numeroSeguinte(tx, 'emprestimo_prontuario', 'emprestimo_prontuario', est.id);
        const emp = await tx.incluir('emprestimo_prontuario', {
          estabelecimento_id: est.id,
          numero: String(numero),
          volume_prontuario_id: e.volume,
          motivo_solicitacao_prontuario_id: motivo,
          solicitacao_prontuario_id: e.solicitacao,
          movimento_prontuario_id: movimento,
          situacao_anterior_volume: ['aberto', 'encerrado', 'arquivado'].includes(posse.situacao)
            ? posse.situacao
            : null,
          destino_setor_funcional_id: e.destinoSetor,
          solicitante_usuario_id: e.solicitanteProfissional === null ? usuario : null,
          solicitante_profissional_id: e.solicitanteProfissional,
          entregador_usuario_id: usuario,
          emprestado_em: agora,
          prazo_devolucao: prazo,
          situacao: 'emprestado',
          observacao: e.observacao,
        });
        await tx.alterar('volume_prontuario', e.volume, num(v['versao']), {
          situacao: 'emprestado',
          no_local: false,
        });
        let situacaoSolicitacao: SituacaoSolicitacao | null = null;
        if (solicitacao && item) {
          await tx.alterar('solicitacao_prontuario_item', num(item['id']), num(item['versao']), {
            situacao: 'emprestado',
            atendido_em: agora,
            movimento_prontuario_id: movimento,
          });
          situacaoSolicitacao = await recalcularSolicitacao(tx, solicitacao, usuario, agora);
        }
        return {
          tabela: 'emprestimo_prontuario',
          id: emp,
          prazo: prazo.toISOString(),
          solicitacao: situacaoSolicitacao,
        };
      },
    );
  }

  devolver(
    c: ContextoPortaPropria,
    emprestimo: number,
    entrada: unknown,
  ): Promise<{ id: number; diasAtraso: number }> {
    const e = entradaValida(esquemaDevolucao, entrada);
    return this.gravar(
      c,
      'same.tramite.devolver',
      ['emprestimo_prontuario', 'movimento_prontuario', 'volume_prontuario'],
      async (tx, est, usuario) => {
        const [p] = await tx.consultarParaAtualizar<Record<string, unknown>>(
          `SELECT id, volume_prontuario_id, situacao, prazo_devolucao, observacao, movimento_prontuario_id,
                  situacao_anterior_volume, destino_setor_funcional_id
             FROM emprestimo_prontuario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [emprestimo, est.id],
        );
        if (!p) throw naoEncontrado('Empréstimo');
        if (String(p['situacao']) !== 'emprestado')
          throw recusaRegra('Devolução recusada', [
            { campo: 'emprestimo', mensagem: 'O empréstimo não está em aberto.' },
          ]);
        const agora = new Date();
        const volume = num(p['volume_prontuario_id']);
        const [v] = await tx.consultarParaAtualizar<Record<string, unknown>>(
          'SELECT id, paciente_id, atendimento_id, situacao, local_arquivo_id, versao FROM volume_prontuario WHERE id = ?',
          [volume],
        );
        // A saída do empréstimo na guarda: a presa a ele, ou (empréstimo antigo) a saída aberta do volume.
        const saida = p['movimento_prontuario_id']
          ? await tx.uma('SELECT id, versao, devolvido_em FROM movimento_prontuario WHERE id = ?', [
              p['movimento_prontuario_id'],
            ])
          : await saidaAberta(tx, volume);
        const jaVoltou = saida?.['devolvido_em'] ? new Date(saida['devolvido_em'] as Date) : null;
        const devolvidoEm = jaVoltou ?? agora;
        if (!jaVoltou && v) {
          // A volta pela trilha da guarda: entrada no arquivo, a saída fechada e a situação de antes restaurada.
          await tx.incluir('movimento_prontuario', {
            estabelecimento_id: est.id,
            volume_prontuario_id: volume,
            paciente_id: num(v['paciente_id']),
            atendimento_id: numOuNull(v['atendimento_id']),
            operacao_movimento_prontuario_id: await operacaoDaGuarda(tx, 'devolucao'),
            movimentado_em: agora,
            movimentado_por_usuario_id: usuario,
            saida_setor_funcional_id: numOuNull(p['destino_setor_funcional_id']),
            destino_setor_funcional_id: null,
            saida_local_arquivo_id: null,
            destino_local_arquivo_id: numOuNull(v['local_arquivo_id']),
            observacao: `Devolução do empréstimo ${emprestimo}`,
          });
          if (saida)
            await tx.alterar('movimento_prontuario', num(saida['id']), num(saida['versao']), {
              devolvido_em: agora,
            });
          if (String(v['situacao']) === 'emprestado')
            await tx.alterar('volume_prontuario', volume, num(v['versao']), {
              situacao: situacaoAposDevolucao(txtOuNull(p['situacao_anterior_volume'])),
              no_local: true,
            });
        }
        const atraso = diasDeAtraso(new Date(p['prazo_devolucao'] as Date), null, devolvidoEm);
        await tx.alterar('emprestimo_prontuario', emprestimo, e.versao, {
          situacao: 'devolvido',
          devolvido_em: devolvidoEm,
          recebedor_usuario_id: usuario,
          ...(e.observacao
            ? {
                observacao: [txtOuNull(p['observacao']), e.observacao]
                  .filter(Boolean)
                  .join(' | ')
                  .slice(0, 2000),
              }
            : {}),
        });
        return { tabela: 'emprestimo_prontuario', id: emprestimo, diasAtraso: atraso };
      },
    );
  }

  cobrar(
    c: ContextoPortaPropria,
    emprestimo: number,
    versao: number,
  ): Promise<{ id: number; cobrancas: number }> {
    return this.gravar(c, 'same.tramite.cobrar', ['emprestimo_prontuario'], async (tx, est) => {
      const p = await tx.uma(
        `SELECT e.situacao, e.prazo_devolucao, e.cobrancas_enviadas, mv.devolvido_em AS voltou_em
           FROM emprestimo_prontuario e LEFT JOIN movimento_prontuario mv ON mv.id = e.movimento_prontuario_id
          WHERE e.id = ? AND e.estabelecimento_id = ? AND e.excluido_em IS NULL`,
        [emprestimo, est.id],
      );
      if (!p) throw naoEncontrado('Empréstimo');
      const agora = new Date();
      if (
        String(p['situacao']) !== 'emprestado' ||
        p['voltou_em'] ||
        diasDeAtraso(new Date(p['prazo_devolucao'] as Date), null, agora) === 0
      )
        throw recusaRegra('Cobrança recusada', [
          { campo: 'emprestimo', mensagem: 'Só se cobra o empréstimo em aberto além do prazo.' },
        ]);
      const cobrancas = num(p['cobrancas_enviadas']) + 1;
      await tx.alterar('emprestimo_prontuario', emprestimo, versao, {
        cobrancas_enviadas: cobrancas,
        ultima_cobranca_em: agora,
      });
      return { tabela: 'emprestimo_prontuario', id: emprestimo, cobrancas };
    });
  }

  /** A saída por empréstimo feita na guarda, sem documento, vencida: ganha o empréstimo já com a primeira cobrança. */
  cobrarSaidaGuarda(c: ContextoPortaPropria, movimento: number): Promise<{ id: number; cobrancas: number }> {
    return this.gravar(
      c,
      'same.tramite.cobrar_saida_guarda',
      ['emprestimo_prontuario', 'movimento_prontuario'],
      async (tx, est) => {
        const [m] = await tx.consultarParaAtualizar<Record<string, unknown>>(
          `SELECT m.*, op.tipo FROM movimento_prontuario m
             JOIN operacao_movimento_prontuario op ON op.id = m.operacao_movimento_prontuario_id
            WHERE m.id = ? AND m.estabelecimento_id = ? AND m.excluido_em IS NULL`,
          [movimento, est.id],
        );
        if (!m) throw naoEncontrado('Movimento');
        const agora = new Date();
        const previsao = m['previsao_retorno'] ? new Date(m['previsao_retorno'] as Date) : null;
        const problemas: { campo: string; mensagem: string }[] = [];
        if (String(m['tipo']) !== 'emprestimo' || m['devolvido_em'])
          problemas.push({
            campo: 'movimento',
            mensagem: 'Só se cobra a saída por empréstimo ainda não devolvida.',
          });
        if (previsao === null || diasDeAtraso(previsao, null, agora) === 0)
          problemas.push({ campo: 'movimento', mensagem: 'A saída ainda está no prazo de retorno.' });
        if (m['destino_setor_funcional_id'] === null)
          problemas.push({ campo: 'movimento', mensagem: 'A saída não tem o setor de destino a cobrar.' });
        if (
          await tx.uma(
            'SELECT id FROM emprestimo_prontuario WHERE movimento_prontuario_id = ? AND excluido_em IS NULL',
            [movimento],
          )
        )
          problemas.push({ campo: 'movimento', mensagem: 'A saída já tem o empréstimo: cobre por ele.' });
        if (problemas.length) throw recusaRegra('Cobrança recusada', problemas);
        const saiu = new Date(m['movimentado_em'] as Date);
        const numero = await numeroSeguinte(tx, 'emprestimo_prontuario', 'emprestimo_prontuario', est.id);
        const emp = await tx.incluir('emprestimo_prontuario', {
          estabelecimento_id: est.id,
          numero: String(numero),
          volume_prontuario_id: num(m['volume_prontuario_id']),
          motivo_solicitacao_prontuario_id: null,
          solicitacao_prontuario_id: numOuNull(m['solicitacao_prontuario_id']),
          movimento_prontuario_id: movimento,
          situacao_anterior_volume: null,
          destino_setor_funcional_id: num(m['destino_setor_funcional_id']),
          solicitante_usuario_id:
            numOuNull(m['responsavel_profissional_id']) === null
              ? num(m['movimentado_por_usuario_id'])
              : null,
          solicitante_profissional_id: numOuNull(m['responsavel_profissional_id']),
          entregador_usuario_id: num(m['movimentado_por_usuario_id']),
          emprestado_em: saiu,
          prazo_devolucao: previsao! > saiu ? previsao : new Date(saiu.getTime() + 60_000),
          situacao: 'emprestado',
          cobrancas_enviadas: 1,
          ultima_cobranca_em: agora,
          observacao: 'Empréstimo registrado na guarda; documento aberto na primeira cobrança.',
        });
        return { tabela: 'emprestimo_prontuario', id: emp, cobrancas: 1 };
      },
    );
  }

  /** Os empréstimos (do paciente, ou os em aberto do estabelecimento), com os dias de atraso calculados pelo domínio.
   * Uma fonte de custódia: o empréstimo fecha também quando a guarda devolve o volume, e a saída por empréstimo feita
   * na guarda (sem documento) entra na lista. Os atrasados saem filtrados no banco, do prazo mais antigo. */
  emprestimos(
    c: ContextoPortaPropria,
    f: { paciente: number | null; atrasados: boolean },
  ): Promise<EmprestimoLido[]> {
    return this.ler(c, 'emprestimos', async (l, est) => {
      const agora = new Date();
      const filtro =
        f.paciente === null
          ? "AND e.situacao = 'emprestado' AND (mv.id IS NULL OR mv.devolvido_em IS NULL)"
          : 'AND v.paciente_id = ?';
      const params = (extra: unknown[]) =>
        [est.id, ...(f.paciente === null ? [] : [f.paciente]), ...extra] as unknown[];
      const rs = await l.consultar(
        `SELECT e.*, mv.devolvido_em AS voltou_em, v.numero_matricula, v.paciente_id, sf.nome AS destino,
                m.descricao AS motivo
           FROM emprestimo_prontuario e JOIN volume_prontuario v ON v.id = e.volume_prontuario_id
           JOIN setor_funcional sf ON sf.id = e.destino_setor_funcional_id
           LEFT JOIN movimento_prontuario mv ON mv.id = e.movimento_prontuario_id
           LEFT JOIN motivo_solicitacao_prontuario m ON m.id = e.motivo_solicitacao_prontuario_id
          WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL ${filtro}
            ${f.atrasados ? "AND e.situacao = 'emprestado' AND (mv.id IS NULL OR mv.devolvido_em IS NULL) AND e.prazo_devolucao < ?" : ''}
          ORDER BY ${f.atrasados ? 'e.prazo_devolucao, e.id' : 'e.emprestado_em DESC, e.id DESC'} LIMIT 300`,
        params(f.atrasados ? [agora] : []),
      );
      const guarda = await l.consultar(
        `SELECT mv.*, v.numero_matricula, sf.nome AS destino, op.descricao AS motivo
           FROM movimento_prontuario mv JOIN volume_prontuario v ON v.id = mv.volume_prontuario_id
           JOIN operacao_movimento_prontuario op ON op.id = mv.operacao_movimento_prontuario_id AND op.tipo = 'emprestimo'
           LEFT JOIN setor_funcional sf ON sf.id = mv.destino_setor_funcional_id
          WHERE mv.estabelecimento_id = ? AND mv.excluido_em IS NULL
            ${f.paciente === null ? 'AND mv.devolvido_em IS NULL' : 'AND v.paciente_id = ?'}
            ${f.atrasados ? 'AND mv.devolvido_em IS NULL AND mv.previsao_retorno < ?' : ''}
            AND NOT EXISTS (SELECT 1 FROM emprestimo_prontuario e WHERE e.movimento_prontuario_id = mv.id)
          ORDER BY ${f.atrasados ? 'mv.previsao_retorno, mv.id' : 'mv.movimentado_em DESC, mv.id DESC'} LIMIT 300`,
        params(f.atrasados ? [agora] : []),
      );
      const daGuarda: EmprestimoLido[] = guarda.map((x) => {
        const devolvido = x['devolvido_em'] ? new Date(x['devolvido_em'] as Date) : null;
        const prazo = x['previsao_retorno'] ? new Date(x['previsao_retorno'] as Date) : null;
        return {
          id: null,
          movimento: num(x['id']),
          origem: 'guarda',
          numero: `G${num(x['id'])}`,
          volume: {
            id: num(x['volume_prontuario_id']),
            matricula: txtOuNull(x['numero_matricula']),
            paciente: num(x['paciente_id']),
          },
          destino: txtOuNull(x['destino']) ?? '',
          motivo: txtOuNull(x['motivo']),
          solicitacao: numOuNull(x['solicitacao_prontuario_id']),
          emprestadoEm: iso(x['movimentado_em'])!,
          prazo: iso(prazo) ?? iso(x['movimentado_em'])!,
          devolvidoEm: iso(devolvido),
          situacao: devolvido ? 'devolvido' : 'emprestado',
          diasAtraso: prazo ? diasDeAtraso(prazo, devolvido, agora) : 0,
          cobrancas: 0,
          versao: num(x['versao']),
        };
      });
      const doTramite: EmprestimoLido[] = rs.map((x) => {
        // A guarda pode ter recebido o volume de volta: o empréstimo conta como devolvido no instante dela.
        const voltou = String(x['situacao']) === 'emprestado' && x['voltou_em'];
        const devolvido = x['devolvido_em']
          ? new Date(x['devolvido_em'] as Date)
          : voltou
            ? new Date(x['voltou_em'] as Date)
            : null;
        return {
          id: num(x['id']),
          movimento: numOuNull(x['movimento_prontuario_id']),
          origem: 'tramite',
          numero: String(x['numero']),
          volume: {
            id: num(x['volume_prontuario_id']),
            matricula: txtOuNull(x['numero_matricula']),
            paciente: num(x['paciente_id']),
          },
          destino: String(x['destino']),
          motivo: txtOuNull(x['motivo']),
          solicitacao: numOuNull(x['solicitacao_prontuario_id']),
          emprestadoEm: iso(x['emprestado_em'])!,
          prazo: iso(x['prazo_devolucao'])!,
          devolvidoEm: iso(devolvido),
          situacao: voltou ? 'devolvido' : String(x['situacao']),
          diasAtraso: diasDeAtraso(new Date(x['prazo_devolucao'] as Date), devolvido, agora),
          cobrancas: num(x['cobrancas_enviadas']),
          versao: num(x['versao']),
        };
      });
      const todos = [...doTramite, ...daGuarda];
      return f.atrasados
        ? todos.sort((a, b) => a.prazo.localeCompare(b.prazo)).slice(0, 300)
        : todos.sort((a, b) => b.emprestadoEm.localeCompare(a.emprestadoEm)).slice(0, 300);
    });
  }

  /** Tira a solicitação da fila sem entrega: cancelada com o motivo; os itens pendentes ficam cancelados. */
  cancelarSolicitacao(
    c: ContextoPortaPropria,
    solicitacao: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: SituacaoSolicitacao }> {
    const e = entradaValida(esquemaCancelar, entrada);
    return this.gravar(
      c,
      'same.tramite.cancelar_solicitacao',
      ['solicitacao_prontuario', 'solicitacao_prontuario_item'],
      async (tx, est, usuario) => {
        const [s] = await tx.consultarParaAtualizar<Record<string, unknown>>(
          'SELECT id, situacao, versao FROM solicitacao_prontuario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [solicitacao, est.id],
        );
        if (!s) throw naoEncontrado('Solicitação');
        const problemas = conferirCancelamentoSolicitacao(
          String(s['situacao']) as SituacaoSolicitacao,
          e.motivo,
        );
        if (num(s['versao']) !== e.versao)
          problemas.push({ campo: 'versao', mensagem: 'A solicitação mudou desde a leitura: recarregue.' });
        if (problemas.length) throw recusaRegra('Cancelamento recusado', problemas);
        const pendentes = await tx.consultarParaAtualizar<Record<string, unknown>>(
          "SELECT id, versao FROM solicitacao_prontuario_item WHERE solicitacao_prontuario_id = ? AND situacao = 'pendente' AND excluido_em IS NULL",
          [solicitacao],
        );
        for (const i of pendentes)
          await tx.alterar('solicitacao_prontuario_item', num(i['id']), num(i['versao']), {
            situacao: 'cancelado',
            observacao: `Solicitação cancelada: ${e.motivo}`.slice(0, 500),
          });
        const agora = new Date();
        // Com volume já entregue, a solicitação fecha atendida (em parte); sem nenhum, cancelada. O motivo fica.
        const situacao = await recalcularSolicitacao(tx, s, usuario, agora, {
          justificativa_finalizacao: e.motivo.slice(0, 200),
        });
        return { tabela: 'solicitacao_prontuario', id: solicitacao, situacao };
      },
    );
  }

  /** O volume pedido que o arquivo não achou: o item sai da fila com onde se procurou; a solicitação é recalculada. */
  naoLocalizado(
    c: ContextoPortaPropria,
    solicitacao: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: SituacaoSolicitacao }> {
    const e = entradaValida(esquemaNaoLocalizado, entrada);
    return this.gravar(
      c,
      'same.tramite.nao_localizado',
      ['solicitacao_prontuario', 'solicitacao_prontuario_item'],
      async (tx, est, usuario) => {
        const [s] = await tx.consultarParaAtualizar<Record<string, unknown>>(
          'SELECT id, situacao, versao FROM solicitacao_prontuario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [solicitacao, est.id],
        );
        if (!s) throw naoEncontrado('Solicitação');
        const [i] = await tx.consultarParaAtualizar<Record<string, unknown>>(
          'SELECT id, situacao, versao FROM solicitacao_prontuario_item WHERE id = ? AND solicitacao_prontuario_id = ? AND excluido_em IS NULL',
          [e.item, solicitacao],
        );
        if (!i) throw naoEncontrado('Item da solicitação');
        const problemas = conferirNaoLocalizado(
          String(s['situacao']) as SituacaoSolicitacao,
          String(i['situacao']) as SituacaoItemSolicitacao,
          e.motivo,
        );
        if (num(s['versao']) !== e.versao)
          problemas.push({ campo: 'versao', mensagem: 'A solicitação mudou desde a leitura: recarregue.' });
        if (problemas.length) throw recusaRegra('Item recusado', problemas);
        await tx.alterar('solicitacao_prontuario_item', e.item, num(i['versao']), {
          situacao: 'nao_localizado',
          observacao: e.motivo,
        });
        const situacao = await recalcularSolicitacao(tx, s, usuario, new Date());
        return { tabela: 'solicitacao_prontuario', id: solicitacao, situacao };
      },
    );
  }
}
