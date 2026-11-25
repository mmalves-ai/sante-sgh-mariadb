// Porta da lista de trabalho DICOM sobre o banco do cliente (M47, etapa 3), pelo @sgh/nucleo: leituras somente leitura
// (item_lista_trabalho_imagem, modalidade_imagem, visualizador_imagem, parceiro_dados, estudo_imagem e as mensagens da
// fila de integração) e gravações pelo Executor, numa operação por gravação, com a trilha na mesma transação:
//   - o item novo (um por exame pedido; o número de acesso pelo id do item, regra do domínio) e a mensagem ao PACS na
//     fila de integração (integracao_mensagem, saída, ponto imagem.mwl), ligada ao item;
//   - o reenvio com o mesmo número de acesso (a quantidade de envios vista pela tela é conferida: 409 se mudou);
//   - o status do estudo como mensagem de entrada (integracao_mensagem, entrada, ponto sadt.estudo.status), idempotente
//     pela chave da mensagem; o item guarda o status vigente e o estudo arquivado vai a estudo_imagem (com o UID).
// Os exames de imagem vêm da porta própria do SADT (exame_item do setor de imagem). Toda leitura filtra o
// estabelecimento da sessão e os registros excluídos; a modalidade DICOM é catálogo da rede inteira.
// Melhoria: a modalidade do item vem do cadastro do exame (exame.modalidade_imagem_id); a entrega é a da própria
// mensagem da fila (sem cópia da situação); o status vigente não regride (concluído não volta a em andamento).
import { EVENTO_OUTBOX_MWL } from '@sgh/contratos';
import {
  type ContextoNucleo,
  definirOperacao,
  erroConflitoVersao,
  type Executor,
  gravarOutbox,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type LiberacaoGravacao, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import { FUSO_PADRAO, relogioNoFuso } from '../exames/relogio.js';
import type { PortaSadt } from './porta.js';
import { nomeDaGravacao, resultadoDe, valorDe } from './porta-propria.js';
import {
  type ContextoPacs,
  type GravadorPacs,
  type ItemMwlBanco,
  METODOS_PORTA_PACS,
  type ModalidadeLida,
  type NovoItemMwl,
  type NovoStatusEstudo,
  type PortaPacs,
  type StatusEstudoBanco,
  type StatusEstudoCodigo,
} from './pacs-porta.js';
import { atoDoExame, entregaDaMensagem, SITUACAO_DO_STATUS } from './vocabulario-banco.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoPacs = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** Ponto da mensagem de entrada com o status do estudo. */
export const PONTO_STATUS_ESTUDO = 'sadt.estudo.status';
const TABELAS_GRAVACAO = ['item_lista_trabalho_imagem', 'estudo_imagem', 'integracao_mensagem'] as const;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
/** DATETIME do banco → "AAAA-MM-DDTHH:MM:SS" (o driver devolve a hora civil gravada). */
const instante = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 19) : v ? String(v).replace(' ', 'T').slice(0, 19) : '';
const json = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  try {
    return JSON.parse(texto(v)) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const SQL_ITEM = `
  SELECT i.id, i.exame_item_id, r.paciente_id, r.numero AS requisicao, ei.sequencia, sd.tipo AS tipo_setor,
         i.modalidade_imagem_id, COALESCE(m.sigla_padrao, '') AS sigla, i.numero_acesso, i.quantidade_envios,
         i.integracao_mensagem_id, i.enviado_em, i.forma_envio, i.criado_em, i.versao,
         COALESCE(ua.login, uc.login, '') AS por, o.situacao AS situacao_mensagem, o.tentativas, o.erro
    FROM item_lista_trabalho_imagem i
    JOIN exame_item ei ON ei.id = i.exame_item_id
    JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
    JOIN setor_diagnostico sd ON sd.id = i.setor_diagnostico_id
    LEFT JOIN modalidade_imagem m ON m.id = i.modalidade_imagem_id
    LEFT JOIN integracao_mensagem o ON o.id = i.integracao_mensagem_id
    LEFT JOIN usuario ua ON ua.id = i.alterado_por
    LEFT JOIN usuario uc ON uc.id = i.criado_por
   WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL`;

function itemDe(r: Linha): ItemMwlBanco {
  const sigla = texto(r['sigla']);
  return {
    id: n(r['id']),
    exame: n(r['exame_item_id']),
    paciente: nn(r['paciente_id']),
    chaveNatural: `${texto(r['requisicao'])}:${n(r['sequencia'])}`,
    ato: atoDoExame(texto(r['tipo_setor']), sigla),
    idModalidade: nn(r['modalidade_imagem_id']),
    modalidade: sigla,
    accession: texto(r['numero_acesso']),
    envios: n(r['quantidade_envios']),
    idOutbox: r['integracao_mensagem_id'] === null ? null : texto(r['integracao_mensagem_id']),
    ultimoEnvioEm: instante(r['enviado_em'] ?? r['criado_em']),
    ultimoEnvioPor: texto(r['por']),
    origem: texto(r['forma_envio']) === 'automatico' ? 'automatico' : 'manual',
    criadoEm: instante(r['criado_em']),
    entrega:
      r['situacao_mensagem'] === null || r['situacao_mensagem'] === undefined
        ? null
        : {
            situacao: entregaDaMensagem(texto(r['situacao_mensagem'])),
            tentativas: n(r['tentativas']),
            resposta: r['erro'] === null ? null : texto(r['erro']).slice(0, 500),
          },
  };
}

function statusDe(r: Linha): StatusEstudoBanco {
  const c = json(r['conteudo']);
  return {
    id: n(r['id']),
    mwl: n(r['entidade_id']),
    exame: n(c['exame']),
    accession: texto(c['accession']),
    status: (texto(c['status']) || 'em-andamento') as StatusEstudoCodigo,
    uidEstudo: c['uidEstudo'] ? texto(c['uidEstudo']) : null,
    uidMpps: c['uidMpps'] ? texto(c['uidMpps']) : null,
    ocorridoEm: texto(c['ocorridoEm']),
    visualizador: c['visualizador'] === null || c['visualizador'] === undefined ? null : n(c['visualizador']),
    chaveMensagem: texto(r['referencia_externa']),
    origem: texto(c['origem']) === 'simulador' ? 'simulador' : 'pacs',
    recebidoEm: instante(r['criado_em']),
  };
}

const ORDEM_STATUS: Readonly<Record<string, number>> = { em_andamento: 1, concluido: 2, descontinuado: 2 };

export class PortaPacsPropria implements PortaPacs {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoPacs,
    private readonly sadt: PortaSadt,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPacs, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(): Promise<LiberacaoGravacao> {
    return { pode: true, codigo: null, motivo: null };
  }

  executar(): Promise<never> {
    return Promise.reject(
      recusa(
        'operacao-desconhecida',
        'A lista de trabalho DICOM grava pelas ações próprias (enviar, reenviar e status).',
      ),
    );
  }

  async gravarSgh<T>(
    c: ContextoPacs,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorPacs) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: { valor: T } | null = null;
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const op = definirOperacao({
      nome: nomeDaGravacao('sadt.pacs', trilha),
      tabelas: TABELAS_GRAVACAO,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(gravadorSobre(tx, est)) };
        return resultadoDe(saida.valor);
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'item_lista_trabalho_imagem', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = c.chaveIdempotencia ? `pacs:${c.chaveIdempotencia}` : `pacs:${randomUUID()}`;
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...contextoDe(c), chaveIdempotencia: chave },
    );
    if (!saida) return valorDe<T>(r.resultado);
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoPacs) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<{ fuso_horario: string | null }>(
        'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
        [est],
      );
      const x = relogioNoFuso(r?.fuso_horario || FUSO_PADRAO);
      return { hoje: x.hoje, agora: `${x.hoje}T${x.hora}:00` };
    });
  }

  async examesDoDia(
    c: ContextoPacs,
    data: string,
    f?: { readonly ato?: number | undefined; readonly termo?: string | undefined },
  ) {
    const r = await this.sadt.examesDoSetor(c, {
      setor: 'imagem',
      inicio: data,
      fim: data,
      ...(f?.ato ? { ato: f.ato } : {}),
      ...(f?.termo ? { termo: f.termo } : {}),
    });
    return { itens: r.itens, cortada: r.cortada };
  }

  examesPorId(c: ContextoPacs, ids: readonly number[]) {
    return this.sadt.examesPorId(c, ids);
  }

  modalidades(c: ContextoPacs): Promise<ModalidadeLida[]> {
    // Catálogo DICOM da rede inteira (modalidade_imagem não tem estabelecimento).
    return this.ler(c, async (l) =>
      (
        await l.consultar('SELECT id, sigla_padrao, ativo FROM modalidade_imagem ORDER BY sigla_padrao, id')
      ).map((r) => ({ id: n(r['id']), sigla: texto(r['sigla_padrao']), ativa: Boolean(n(r['ativo'])) })),
    );
  }

  modalidadeDoCadastro(c: ContextoPacs, exames: readonly number[]) {
    return this.ler(c, async (l, est) => {
      const m = new Map<number, { id: number; sigla: string }>();
      if (exames.length === 0) return m;
      const ls = await l.consultar(
        `SELECT ei.id, mi.id AS modalidade, mi.sigla_padrao
           FROM exame_item ei
           JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
           JOIN exame e ON e.id = ei.exame_id
           JOIN modalidade_imagem mi ON mi.id = e.modalidade_imagem_id
          WHERE r.estabelecimento_id = ? AND ei.excluido_em IS NULL AND ei.id IN (${lista(exames.length)})`,
        [est, ...exames],
      );
      for (const r of ls) m.set(n(r['id']), { id: n(r['modalidade']), sigla: texto(r['sigla_padrao']) });
      return m;
    });
  }

  visualizadores(c: ContextoPacs) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          'SELECT id, nome FROM visualizador_imagem WHERE estabelecimento_id = ? AND ativo = TRUE ORDER BY padrao DESC, nome, id',
          [est],
        )
      ).map((r) => ({ id: n(r['id']), nome: texto(r['nome']) })),
    );
  }

  itens(c: ContextoPacs, exames: readonly number[]) {
    if (exames.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(`${SQL_ITEM} AND i.exame_item_id IN (${lista(exames.length)}) ORDER BY i.id`, [
          est,
          ...exames,
        ])
      ).map(itemDe),
    );
  }

  item(c: ContextoPacs, chave: { id: number } | { accession: string }) {
    return this.ler(c, async (l, est) => {
      const r =
        'id' in chave
          ? await l.uma(`${SQL_ITEM} AND i.id = ?`, [est, chave.id])
          : await l.uma(`${SQL_ITEM} AND i.numero_acesso = ?`, [est, chave.accession]);
      return r ? itemDe(r) : null;
    });
  }

  itensDoPaciente(c: ContextoPacs, paciente: number) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(`${SQL_ITEM} AND r.paciente_id = ? ORDER BY i.id DESC`, [est, paciente], {
          teto: 500,
        })
      ).map(itemDe),
    );
  }

  status(c: ContextoPacs, exames: readonly number[]) {
    if (exames.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT m.id, m.entidade_id, m.referencia_externa, m.conteudo, m.criado_em
             FROM integracao_mensagem m
             JOIN item_lista_trabalho_imagem i ON i.id = m.entidade_id
            WHERE m.direcao = 'entrada' AND m.ponto = ? AND m.entidade = 'item_lista_trabalho_imagem'
              AND i.estabelecimento_id = ? AND i.exame_item_id IN (${lista(exames.length)})
            ORDER BY m.id`,
          [PONTO_STATUS_ESTUDO, est, ...exames],
        )
      ).map(statusDe),
    );
  }

  parceiroDaWorklist(c: ContextoPacs, codigo: string) {
    // O parceiro é do cliente inteiro; o destino é o do parâmetro do estabelecimento (o código vem dele): só esse
    // parceiro, ativo e com o evento da lista, serve. Nenhum outro parceiro do cliente vira destino por acaso.
    return this.ler(c, async (l) => {
      const r = await l.uma(
        `SELECT codigo, nome FROM parceiro_dados
          WHERE codigo = ? AND ativo = TRUE AND excluido_em IS NULL AND JSON_VALID(eventos)
            AND JSON_CONTAINS(eventos, JSON_QUOTE(?))`,
        [codigo, EVENTO_OUTBOX_MWL],
      );
      return r ? { codigo: texto(r['codigo']), nome: texto(r['nome']) } : null;
    });
  }
}

/** O gravador sobre a transação da operação (o estabelecimento do contexto). */
function gravadorSobre(tx: TxOperacao, est: number): GravadorPacs {
  const agora = () => new Date();
  const usuario = tx.contexto.usuario;
  const travarItem = async (id: number) => {
    const [i] = await tx.consultarParaAtualizar(
      `SELECT i.id, i.versao, i.quantidade_envios, i.numero_acesso, i.exame_item_id, i.situacao_estudo, i.estudo_imagem_id,
              i.modalidade_imagem_id, r.paciente_id
         FROM item_lista_trabalho_imagem i
         JOIN exame_item ei ON ei.id = i.exame_item_id
         JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
        WHERE i.id = ? AND i.estabelecimento_id = ? AND i.excluido_em IS NULL`,
      [id, est],
      { teto: 1 },
    );
    if (!i) throw recusa('item-inexistente', 'O item da lista de trabalho não existe neste estabelecimento.');
    return i;
  };
  return {
    async registrarItem(r: NovoItemMwl) {
      const ei = await tx.uma(
        `SELECT ei.id, COALESCE(ei.setor_diagnostico_id, rq.setor_diagnostico_id) AS setor, ei.urgente
           FROM exame_item ei JOIN requisicao_exame rq ON rq.id = ei.requisicao_exame_id
          WHERE ei.id = ? AND rq.estabelecimento_id = ? AND ei.excluido_em IS NULL`,
        [r.exame, est],
      );
      if (!ei) throw recusa('exame-inexistente', 'O exame não existe neste estabelecimento.');
      const [ja] = await tx.consultarParaAtualizar(
        'SELECT id FROM item_lista_trabalho_imagem WHERE exame_item_id = ? AND excluido_em IS NULL',
        [r.exame],
        { teto: 1 },
      );
      if (ja)
        throw recusa(
          'ja-na-worklist',
          'Este exame já está na lista de trabalho: use o reenvio (o mesmo número de acesso).',
        );
      // O número de acesso é do id do item: entra provisório e é trocado na mesma transação.
      const provisorio = `P${randomUUID().replace(/-/g, '').slice(0, 15).toUpperCase()}`;
      const id = await tx.incluir('item_lista_trabalho_imagem', {
        estabelecimento_id: est,
        exame_item_id: r.exame,
        modalidade_imagem_id: r.modalidade.id,
        setor_diagnostico_id: n(ei['setor']),
        numero_acesso: provisorio,
        situacao: 'na_fila',
        situacao_entrega: 'pendente',
        forma_envio: r.origem,
        quantidade_envios: 1,
        enviado_em: agora(),
        urgente: Boolean(n(ei['urgente'])),
        permite_excluir: false,
        origem: 'sistema',
      });
      const accession = r.accession(id);
      const outbox = await gravarOutbox(tx, {
        estabelecimento: est,
        ponto: EVENTO_OUTBOX_MWL,
        entidade: 'item_lista_trabalho_imagem',
        entidadeId: id,
        chave: `${r.chaveIdempotencia}:1`,
        carga: { item: id, exame: r.exame, accession, modalidade: r.modalidade.sigla, envio: 1 },
        usuario,
        agora: agora(),
      });
      await tx.alterar('item_lista_trabalho_imagem', id, 1, {
        numero_acesso: accession,
        integracao_mensagem_id: outbox,
      });
      return { id, accession, outbox: String(outbox) };
    },

    async reenviar(r) {
      const i = await travarItem(r.id);
      if (n(i['quantidade_envios']) !== r.envios) throw erroConflitoVersao(['quantidade_envios']);
      const envios = r.envios + 1;
      const outbox = await gravarOutbox(tx, {
        estabelecimento: est,
        ponto: EVENTO_OUTBOX_MWL,
        entidade: 'item_lista_trabalho_imagem',
        entidadeId: r.id,
        chave: `mwl:${est}:${r.exame}:${envios}`,
        carga: {
          item: r.id,
          exame: r.exame,
          accession: texto(i['numero_acesso']),
          modalidade: r.modalidade,
          envio: envios,
        },
        usuario,
        agora: agora(),
      });
      await tx.alterar('item_lista_trabalho_imagem', r.id, n(i['versao']), {
        quantidade_envios: envios,
        enviado_em: agora(),
        integracao_mensagem_id: outbox,
        situacao: 'na_fila',
        situacao_entrega: 'pendente',
      });
      return { id: r.id, envios, outbox: String(outbox) };
    },

    async registrarStatus(r: NovoStatusEstudo) {
      const [repetida] = await tx.consultarParaAtualizar(
        `SELECT id, entidade_id, referencia_externa, conteudo, criado_em FROM integracao_mensagem
          WHERE direcao = 'entrada' AND ponto = ? AND estabelecimento_id = ? AND referencia_externa = ?`,
        [PONTO_STATUS_ESTUDO, est, r.chaveMensagem],
        { teto: 1 },
      );
      if (repetida) return { estudo: statusDe(repetida), repetida: true };
      const i = await travarItem(r.mwl);
      if (texto(i['numero_acesso']) !== r.accession)
        throw recusa('accession-divergente', 'O número de acesso não é o do item da lista de trabalho.');
      const conteudo = {
        exame: r.exame,
        accession: r.accession,
        status: r.status,
        uidEstudo: r.uidEstudo,
        uidMpps: r.uidMpps,
        ocorridoEm: r.ocorridoEm,
        visualizador: r.visualizador,
        origem: r.origem,
      };
      const recebido = agora();
      const id = await tx.incluir('integracao_mensagem', {
        estabelecimento_id: est,
        ponto: PONTO_STATUS_ESTUDO,
        direcao: 'entrada',
        situacao: 'processada',
        tentativas: 0,
        entidade: 'item_lista_trabalho_imagem',
        entidade_id: r.mwl,
        referencia_externa: r.chaveMensagem.slice(0, 120),
        conteudo: JSON.stringify(conteudo),
        processada_em: recebido,
      });
      // O status vigente do item não regride; o estudo arquivado (com UID) vai a estudo_imagem.
      const novo = SITUACAO_DO_STATUS[r.status];
      const atual = i['situacao_estudo'] === null ? null : texto(i['situacao_estudo']);
      const valores: Record<string, unknown> = {};
      if (!atual || (ORDEM_STATUS[novo] ?? 0) >= (ORDEM_STATUS[atual] ?? 0)) {
        valores['situacao_estudo'] = novo;
        valores['situacao_estudo_em'] = recebido;
        valores['situacao'] = novo;
      }
      if (r.uidEstudo) {
        valores['uid_estudo'] = r.uidEstudo;
        const estudo = i['estudo_imagem_id'] === null ? null : n(i['estudo_imagem_id']);
        const dadosEstudo = {
          situacao: (valores['situacao_estudo'] as string | undefined) ?? atual ?? novo,
          ...(r.visualizador ? { visualizador_imagem_id: r.visualizador } : {}),
          ...(novo === 'concluido' ? { arquivado_em: recebido } : {}),
        };
        if (estudo === null) {
          valores['estudo_imagem_id'] = await tx.incluir('estudo_imagem', {
            estabelecimento_id: est,
            exame_item_id: n(i['exame_item_id']),
            paciente_id: n(i['paciente_id']),
            modalidade_imagem_id: nn(i['modalidade_imagem_id']),
            numero_acesso: r.accession,
            uid_estudo: r.uidEstudo,
            origem: 'integracao',
            ...dadosEstudo,
          });
        } else {
          const e = await tx.uma('SELECT versao FROM estudo_imagem WHERE id = ?', [estudo]);
          await tx.alterar('estudo_imagem', estudo, n(e?.['versao']), dadosEstudo);
        }
      }
      if (Object.keys(valores).length > 0)
        await tx.alterar('item_lista_trabalho_imagem', r.mwl, n(i['versao']), valores);
      return {
        estudo: {
          id,
          mwl: r.mwl,
          exame: r.exame,
          accession: r.accession,
          status: r.status,
          uidEstudo: r.uidEstudo,
          uidMpps: r.uidMpps,
          ocorridoEm: r.ocorridoEm,
          visualizador: r.visualizador,
          chaveMensagem: r.chaveMensagem,
          origem: r.origem,
          recebidoEm: instante(recebido),
        },
        repetida: false,
      };
    },
  };
}

function contextoDe(c: ContextoNucleo): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || 'sadt.pacs').slice(0, 64),
  };
}

/** Fora de dev/ci sem o núcleo: 503 em tudo (falha fechada). */
export function portaPacsIndisponivel(): PortaPacs {
  return portaIndisponivel<PortaPacs>(METODOS_PORTA_PACS);
}
