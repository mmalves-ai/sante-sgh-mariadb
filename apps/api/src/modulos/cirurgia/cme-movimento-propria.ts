// Fluxo do material esterilizado entre a CME e os setores (F7, 04-CME linha 117; RDC 15/2012) no banco do cliente,
// sempre no estabelecimento da sessão. Regras em @sgh/dominio-cirurgia (cme/fluxo-material). Contrato de efeito:
//   - receber: a CME recebe a solicitação aberta (situação "recebida_cme", com quem e quando);
//   - cancelar: a solicitação ainda não atendida fica "cancelada" com o motivo, e os itens "cancelado" (nada apagado);
//   - entregar ao setor: movimento_material_esteril "entrega" ligado à solicitação, um item por pacote; o pacote fica
//     "distribuido"; o item da solicitação recebe o pacote e a quantidade atendida (e "entregue" quando completa); a
//     solicitação vai a "parcial" ou "entregue";
//   - recolher: movimento "recolhimento" do setor para a CME, um item por pacote; o pacote íntegro e válido volta ao
//     arsenal ("esteril"), o devolvido sem uso e sem integridade fica "descartado" e o usado continua "usado" (a caixa
//     vai ao expurgo);
//   - conferir: o setor confere o movimento ("conferido", com quem e quando; itens conferidos);
//   - permissões: grava as permissões do colaborador da CME por setor (permissao_setor_cme, uma linha por usuário e
//     setor; ninguém grava as próprias); a entrega e o recolhimento conferem essas permissões do usuário da sessão.
// Recusa da regra: 422, sem escrita. Outro estabelecimento: 404.
import {
  alocarPacotesNaSolicitacao,
  conferirCancelamentoDaSolicitacao,
  conferirConferenciaDoMovimento,
  conferirEntrega,
  conferirGravacaoDaPermissao,
  conferirPermissaoDoSetor,
  conferirRecebimentoDaSolicitacao,
  desfechoDoRecolhimento,
  type PermissaoSetorCme,
  type ProblemaCme,
  situacaoDaSolicitacaoNoFluxo,
  type TipoMovimentoMaterial,
} from '@sgh/dominio-cirurgia';
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
import { hojeNo } from './cme-propria.js';

export const PORTA_CME_MOVIMENTO = Symbol('PORTA_CME_MOVIMENTO');

export const TABELAS_CME_MOVIMENTO = [
  'solicitacao_material_esteril',
  'solicitacao_material_esteril_item',
  'movimento_material_esteril',
  'movimento_material_esteril_item',
  'pacote_esteril',
  'permissao_setor_cme',
  'sequencia_negocio',
  'setor_funcional',
  'usuario',
] as const;

type Linha = Record<string, unknown>;
type Fonte = Pick<Leitor, 'consultar' | 'uma'>;

const id = z.number().int().positive();
const esquemaCancelar = z.object({ motivo: z.string().trim().min(1).max(500) }).strict();
const esquemaEntregaSetor = z
  .object({
    solicitacao: id,
    cme: id,
    setor: id,
    recebedor: id.nullable().default(null),
    pacotes: z.array(id).min(1).max(100),
  })
  .strict();
const esquemaRecolher = z
  .object({
    cme: id,
    setor: id,
    recebedor: id.nullable().default(null),
    observacao: z.string().trim().max(500).nullable().default(null),
    pacotes: z
      .array(z.object({ pacote: id, integro: z.boolean().default(true) }).strict())
      .min(1)
      .max(100),
  })
  .strict();
const marca = z.boolean().default(false);
const esquemaPermissao = z
  .object({
    usuario: id,
    setor: id,
    expurgo: marca,
    lavagem: marca,
    desinfeccao: marca,
    preparo: marca,
    esterilizacao: marca,
    entradaArsenal: marca,
    saidaArsenal: marca,
    devolucaoArsenal: marca,
    transferenciaArsenal: marca,
    terceirizacao: marca,
  })
  .strict();

const COLUNA: Readonly<Record<keyof Omit<PermissaoSetorCme, 'setor'>, string>> = {
  expurgo: 'pode_expurgo',
  lavagem: 'pode_lavagem',
  desinfeccao: 'pode_desinfeccao',
  preparo: 'pode_preparo',
  esterilizacao: 'pode_esterilizacao',
  entradaArsenal: 'pode_entrada_arsenal',
  saidaArsenal: 'pode_saida_arsenal',
  devolucaoArsenal: 'pode_devolucao_arsenal',
  transferenciaArsenal: 'pode_transferencia_arsenal',
  terceirizacao: 'pode_terceirizacao',
};
const CHAVES = Object.keys(COLUNA) as (keyof typeof COLUNA)[];

const recusa = (titulo: string, p: readonly ProblemaCme[]) => {
  if (p.length) throw recusaRegra(titulo, p);
};
const instante = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 19) : v ? String(v).replace(' ', 'T').slice(0, 19) : null;
const dia = (v: unknown): string | null => (v ? (instante(v) ?? '').slice(0, 10) || null : null);
const lista = (n: number) => Array.from({ length: n }, () => '?').join(', ');

export interface SolicitacaoNaFila {
  id: number;
  numero: string;
  tipo: string;
  situacao: string;
  urgente: boolean;
  setor: string | null;
  solicitadoEm: string | null;
  necessarioAte: string | null;
  versao: number;
  itens: { id: number; caixa: string | null; quantidade: number; atendida: number; situacao: string }[];
}

export interface PacoteNoFluxo {
  id: number;
  etiqueta: string | null;
  caixa: string | null;
  situacao: string;
  validade: string | null;
  setor: number | null;
}

export interface MovimentoLido {
  id: number;
  numero: number;
  tipo: string;
  situacao: string;
  setor: string | null;
  ocorridoEm: string | null;
  itens: number;
  versao: number;
}

export interface PermissaoLida extends PermissaoSetorCme {
  id: number;
  usuario: number;
  usuarioNome: string | null;
  setorNome: string | null;
}

export interface PainelFluxoCme {
  solicitacoes: SolicitacaoNaFila[];
  arsenal: PacoteNoFluxo[];
  foraDaCme: PacoteNoFluxo[];
  movimentos: MovimentoLido[];
  permissoes: PermissaoLida[];
  setores: { id: number; nome: string }[];
}

export class PortaCmeMovimentoPropria extends PortaEstabelecimentoPropria {
  constructor(
    nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0],
    cliente: string,
    tabelas: readonly string[] = TABELAS_CME_MOVIMENTO,
  ) {
    super(nucleo, cliente, tabelas, 'cirurgia.cme');
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────────

  painel(c: ContextoPortaPropria): Promise<PainelFluxoCme> {
    return this.ler(c, 'fluxo', async (l, est) => {
      const sols = await l.consultar(
        `SELECT s.id, s.numero, s.tipo, s.situacao, s.urgente, s.solicitado_em, s.necessario_ate, s.versao,
                u.nome AS setor
           FROM solicitacao_material_esteril s
           LEFT JOIN unidade_assistencial u ON u.id = s.solicitante_unidade_assistencial_id
          WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL
            AND s.situacao IN ('aberta', 'recebida_cme', 'em_processamento', 'pronta', 'parcial')
          ORDER BY s.urgente DESC, COALESCE(s.necessario_ate, s.solicitado_em), s.id LIMIT 100`,
        [est.id],
      );
      const itens = sols.length
        ? await l.consultar(
            `SELECT i.id, i.solicitacao_material_esteril_id AS sol, i.quantidade, i.quantidade_atendida, i.situacao,
                    c.descricao AS caixa
               FROM solicitacao_material_esteril_item i
               LEFT JOIN caixa_instrumental c ON c.id = i.caixa_instrumental_id
              WHERE i.excluido_em IS NULL AND i.solicitacao_material_esteril_id IN (${lista(sols.length)})
              ORDER BY i.sequencia`,
            sols.map((s) => s['id']),
          )
        : [];
      const pacotes = await l.consultar(
        `SELECT p.id, p.codigo_etiqueta, p.situacao, p.validade, c.descricao AS caixa,
                (SELECT m.setor_funcional_id FROM movimento_material_esteril_item mi
                   JOIN movimento_material_esteril m ON m.id = mi.movimento_material_esteril_id
                  WHERE mi.pacote_esteril_id = p.id AND m.tipo = 'entrega' AND m.situacao <> 'cancelado'
                  ORDER BY m.ocorrido_em DESC, m.id DESC LIMIT 1) AS setor
           FROM pacote_esteril p LEFT JOIN caixa_instrumental c ON c.id = p.caixa_instrumental_id
          WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.situacao IN ('esteril', 'distribuido', 'usado')
          ORDER BY p.id DESC LIMIT 300`,
        [est.id],
      );
      const movs = await l.consultar(
        `SELECT m.id, m.numero, m.tipo, m.situacao, m.ocorrido_em, m.versao, s.nome AS setor,
                (SELECT COUNT(*) FROM movimento_material_esteril_item i
                  WHERE i.movimento_material_esteril_id = m.id AND i.excluido_em IS NULL) AS itens
           FROM movimento_material_esteril m LEFT JOIN setor_funcional s ON s.id = m.setor_funcional_id
          WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL
          ORDER BY m.ocorrido_em DESC, m.id DESC LIMIT 50`,
        [est.id],
      );
      const setores = await l.consultar(
        'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY nome',
        [est.id],
      );
      const pacote = (p: Linha): PacoteNoFluxo => ({
        id: num(p['id']),
        etiqueta: txtOuNull(p['codigo_etiqueta']),
        caixa: txtOuNull(p['caixa']),
        situacao: String(p['situacao']),
        validade: dia(p['validade']),
        setor: numOuNull(p['setor']),
      });
      return {
        solicitacoes: sols.map((s) => ({
          id: num(s['id']),
          numero: String(s['numero']),
          tipo: String(s['tipo']),
          situacao: String(s['situacao']),
          urgente: bool(s['urgente']),
          setor: txtOuNull(s['setor']),
          solicitadoEm: instante(s['solicitado_em']),
          necessarioAte: instante(s['necessario_ate']),
          versao: num(s['versao']),
          itens: itens
            .filter((i) => num(i['sol']) === num(s['id']))
            .map((i) => ({
              id: num(i['id']),
              caixa: txtOuNull(i['caixa']),
              quantidade: num(i['quantidade']),
              atendida: num(i['quantidade_atendida']),
              situacao: String(i['situacao']),
            })),
        })),
        arsenal: pacotes.filter((p) => p['situacao'] === 'esteril').map(pacote),
        foraDaCme: pacotes.filter((p) => p['situacao'] !== 'esteril').map(pacote),
        movimentos: movs.map((m) => ({
          id: num(m['id']),
          numero: num(m['numero']),
          tipo: String(m['tipo']),
          situacao: String(m['situacao']),
          setor: txtOuNull(m['setor']),
          ocorridoEm: instante(m['ocorrido_em']),
          itens: num(m['itens']),
          versao: num(m['versao']),
        })),
        permissoes: await this.permissoesLidas(l, est.id, null),
        setores: setores.map((s) => ({ id: num(s['id']), nome: String(s['nome']) })),
      };
    });
  }

  /** Usuários ativos para o cadastro de permissões (busca remota, a partir de 3 letras). */
  usuarios(c: ContextoPortaPropria, busca: string) {
    const termo = busca.trim();
    if (termo.length < 3) return Promise.resolve([]);
    return this.ler(c, 'usuarios', async (l) =>
      (
        await l.consultar(
          `SELECT id, nome, login FROM usuario
            WHERE excluido_em IS NULL AND situacao = 'ativo' AND (nome LIKE ? OR login LIKE ?)
            ORDER BY nome LIMIT 30`,
          [`%${termo}%`, `${termo}%`],
        )
      ).map((u) => ({ id: num(u['id']), nome: `${String(u['nome'])} (${String(u['login'])})` })),
    );
  }

  private async permissoesLidas(l: Fonte, est: number, usuario: number | null): Promise<PermissaoLida[]> {
    const linhas = await l.consultar(
      `SELECT p.*, u.nome AS usuario_nome, s.nome AS setor_nome
         FROM permissao_setor_cme p
         JOIN setor_funcional s ON s.id = p.setor_funcional_id AND s.estabelecimento_id = ?
         LEFT JOIN usuario u ON u.id = p.usuario_id
        WHERE p.excluido_em IS NULL ${usuario ? 'AND p.usuario_id = ?' : ''}
        ORDER BY u.nome, s.nome LIMIT 500`,
      usuario ? [est, usuario] : [est],
    );
    return linhas.map((p) => {
      const marcas = Object.fromEntries(CHAVES.map((k) => [k, bool(p[COLUNA[k]])])) as Omit<
        PermissaoSetorCme,
        'setor'
      >;
      return {
        id: num(p['id']),
        usuario: num(p['usuario_id']),
        usuarioNome: txtOuNull(p['usuario_nome']),
        setor: num(p['setor_funcional_id']),
        setorNome: txtOuNull(p['setor_nome']),
        ...marcas,
      };
    });
  }

  private async setorDoEstabelecimento(tx: TxOperacao, est: number, setor: number, oQue: string) {
    const s = await tx.uma('SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ?', [
      setor,
      est,
    ]);
    if (!s) throw naoEncontrado(oQue);
  }

  private async conferirPermissao(
    tx: TxOperacao,
    est: number,
    usuario: number,
    setor: number,
    tipo: TipoMovimentoMaterial,
  ) {
    recusa(
      'Movimento recusado',
      conferirPermissaoDoSetor(await this.permissoesLidas(tx, est, usuario), setor, tipo),
    );
  }

  private async numeroMovimento(tx: TxOperacao, est: number): Promise<number> {
    const tipo = 'movimento_material_esteril';
    const seq = await tx.uma('SELECT id FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?', [
      tipo,
      est,
    ]);
    if (!seq)
      await tx.incluir('sequencia_negocio', {
        estabelecimento_id: est,
        tipo,
        prefixo: '',
        proximo_valor: 1,
        incremento: 1,
        ativo: true,
      });
    return (await tx.proximoNumero(tipo)).valor;
  }

  private async solicitacaoTravada(tx: TxOperacao, est: number, sol: number): Promise<Linha> {
    const s =
      (
        await tx.consultarParaAtualizar<Linha>(
          `SELECT id, versao, situacao, tipo, agendamento_cirurgico_id, atendimento_id
             FROM solicitacao_material_esteril WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [sol, est],
        )
      )[0] ?? null;
    if (!s) throw naoEncontrado('Solicitação de material estéril');
    return s;
  }

  private itensTravados(tx: TxOperacao, sol: number) {
    return tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, caixa_instrumental_id, situacao, quantidade, quantidade_atendida, pacote_esteril_id
         FROM solicitacao_material_esteril_item
        WHERE solicitacao_material_esteril_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
      [sol],
    );
  }

  // ── Gravações ─────────────────────────────────────────────────────────────────────────────────────────────────

  receber(c: ContextoPortaPropria, sol: number) {
    return this.gravar(
      c,
      'cirurgia.cme.solicitacao.receber',
      ['solicitacao_material_esteril'],
      async (tx, est, usuario) => {
        const s = await this.solicitacaoTravada(tx, est.id, sol);
        recusa('Recebimento recusado', conferirRecebimentoDaSolicitacao(String(s['situacao'])));
        await tx.alterar('solicitacao_material_esteril', sol, num(s['versao']), {
          situacao: 'recebida_cme',
          recebido_cme_em: new Date(),
          recebido_cme_usuario_id: usuario,
        });
        return {
          tabela: 'solicitacao_material_esteril',
          id: sol,
          solicitacao: sol,
          situacao: 'recebida_cme',
        };
      },
    );
  }

  cancelar(c: ContextoPortaPropria, sol: number, entrada: unknown) {
    const e = entradaValida(esquemaCancelar, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.solicitacao.cancelar',
      ['solicitacao_material_esteril', 'solicitacao_material_esteril_item'],
      async (tx, est, usuario) => {
        const s = await this.solicitacaoTravada(tx, est.id, sol);
        const itens = await this.itensTravados(tx, sol);
        recusa(
          'Cancelamento recusado',
          conferirCancelamentoDaSolicitacao(
            String(s['situacao']),
            itens.map((i) => ({ situacao: String(i['situacao']) })),
            e.motivo,
          ),
        );
        for (const i of itens)
          if (i['situacao'] !== 'cancelado')
            await tx.alterar('solicitacao_material_esteril_item', num(i['id']), num(i['versao']), {
              situacao: 'cancelado',
            });
        await tx.alterar('solicitacao_material_esteril', sol, num(s['versao']), {
          situacao: 'cancelada',
          cancelado_em: new Date(),
          cancelado_usuario_id: usuario,
          motivo_cancelamento: e.motivo,
        });
        return { tabela: 'solicitacao_material_esteril', id: sol, solicitacao: sol, situacao: 'cancelada' };
      },
    );
  }

  entregarAoSetor(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaEntregaSetor, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.entrega.setor',
      [
        'movimento_material_esteril',
        'movimento_material_esteril_item',
        'pacote_esteril',
        'solicitacao_material_esteril_item',
        'solicitacao_material_esteril',
        'sequencia_negocio',
      ],
      async (tx, est, usuario) => {
        await this.setorDoEstabelecimento(tx, est.id, e.cme, 'Setor da CME');
        await this.setorDoEstabelecimento(tx, est.id, e.setor, 'Setor de destino');
        await this.conferirPermissao(tx, est.id, usuario, e.setor, 'entrega');
        const s = await this.solicitacaoTravada(tx, est.id, e.solicitacao);
        if (['cancelada', 'entregue'].includes(String(s['situacao'])))
          throw recusaRegra('Entrega recusada', [
            { campo: 'solicitacao', mensagem: 'A solicitação já foi entregue ou cancelada.' },
          ]);
        const itens = await this.itensTravados(tx, e.solicitacao);
        const pacotes = await tx.consultarParaAtualizar<Linha>(
          `SELECT p.id, p.versao, p.situacao, p.validade, p.caixa_instrumental_id, c.situacao AS ciclo_situacao
             FROM pacote_esteril p LEFT JOIN ciclo_esterilizacao c ON c.id = p.ciclo_esterilizacao_id
            WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.id IN (${lista(e.pacotes.length)})`,
          [est.id, ...e.pacotes],
        );
        const hoje = hojeNo(est.fuso);
        const problemas: ProblemaCme[] = [];
        for (const pid of e.pacotes) {
          const p = pacotes.find((x) => num(x['id']) === pid);
          if (!p) {
            problemas.push({
              campo: 'pacotes',
              mensagem: `O pacote ${pid} não existe neste estabelecimento.`,
            });
            continue;
          }
          for (const x of conferirEntrega(
            {
              situacao: String(p['situacao']),
              validade: dia(p['validade']),
              cicloSituacao: txtOuNull(p['ciclo_situacao']),
              agendamentoEntregue: null,
            },
            hoje,
          ))
            problemas.push({ campo: 'pacotes', mensagem: `Pacote ${pid}: ${x.mensagem}` });
        }
        recusa('Entrega recusada', problemas);
        const { alocacoes, problemas: semItem } = alocarPacotesNaSolicitacao(
          itens.map((i) => ({
            id: num(i['id']),
            caixa: numOuNull(i['caixa_instrumental_id']),
            situacao: String(i['situacao']),
            quantidade: num(i['quantidade']),
            atendida: num(i['quantidade_atendida']),
            pacote: numOuNull(i['pacote_esteril_id']),
          })),
          e.pacotes.map((pid) => ({
            id: pid,
            caixa: numOuNull(pacotes.find((x) => num(x['id']) === pid)!['caixa_instrumental_id']),
          })),
        );
        recusa('Entrega recusada', semItem);
        const agora = new Date();
        const mov = await tx.incluir('movimento_material_esteril', {
          estabelecimento_id: est.id,
          numero: await this.numeroMovimento(tx, est.id),
          tipo: 'entrega',
          cme_setor_funcional_id: e.cme,
          setor_funcional_id: e.setor,
          atendimento_id: numOuNull(s['atendimento_id']),
          agendamento_cirurgico_id: numOuNull(s['agendamento_cirurgico_id']),
          solicitacao_material_esteril_id: e.solicitacao,
          ocorrido_em: agora,
          responsavel_usuario_id: usuario,
          recebedor_usuario_id: e.recebedor,
          situacao: 'aberto',
        });
        const versaoItem = new Map(itens.map((i) => [num(i['id']), num(i['versao'])]));
        const situacaoItem = new Map(itens.map((i) => [num(i['id']), String(i['situacao'])]));
        const atendidaItem = new Map(itens.map((i) => [num(i['id']), num(i['quantidade_atendida'])]));
        let seq = 0;
        for (const a of alocacoes) {
          const p = pacotes.find((x) => num(x['id']) === a.pacote)!;
          await tx.incluir('movimento_material_esteril_item', {
            movimento_material_esteril_id: mov,
            sequencia: ++seq,
            pacote_esteril_id: a.pacote,
            caixa_instrumental_id: numOuNull(p['caixa_instrumental_id']),
            quantidade: 1,
            validade_esterilizacao: dia(p['validade']),
          });
          await tx.alterar('pacote_esteril', a.pacote, num(p['versao']), { situacao: 'distribuido' });
          const novaSituacao = a.entregue ? 'entregue' : situacaoItem.get(a.item)!;
          await tx.alterar('solicitacao_material_esteril_item', a.item, versaoItem.get(a.item)!, {
            quantidade_atendida: a.atendida,
            situacao: novaSituacao,
            pacote_esteril_id: a.pacote,
            validade_esterilizacao: dia(p['validade']),
          });
          versaoItem.set(a.item, versaoItem.get(a.item)! + 1);
          situacaoItem.set(a.item, novaSituacao);
          atendidaItem.set(a.item, a.atendida);
        }
        const nova = situacaoDaSolicitacaoNoFluxo(
          String(s['situacao']),
          itens.map((i) => ({
            situacao: situacaoItem.get(num(i['id']))!,
            atendida: atendidaItem.get(num(i['id']))!,
          })),
        );
        await tx.alterar('solicitacao_material_esteril', e.solicitacao, num(s['versao']), {
          situacao: nova,
          ...(nova === 'entregue' ? { entregue_em: agora, entregue_usuario_id: usuario } : {}),
        });
        return { tabela: 'movimento_material_esteril', id: mov, movimento: mov, solicitacao: nova };
      },
    );
  }

  recolher(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaRecolher, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.recolhimento',
      [
        'movimento_material_esteril',
        'movimento_material_esteril_item',
        'pacote_esteril',
        'sequencia_negocio',
      ],
      async (tx, est, usuario) => {
        await this.setorDoEstabelecimento(tx, est.id, e.cme, 'Setor da CME');
        await this.setorDoEstabelecimento(tx, est.id, e.setor, 'Setor de origem');
        await this.conferirPermissao(tx, est.id, usuario, e.setor, 'recolhimento');
        const ids = e.pacotes.map((p) => p.pacote);
        const pacotes = await tx.consultarParaAtualizar<Linha>(
          `SELECT p.id, p.versao, p.situacao, p.validade, p.caixa_instrumental_id,
                  (SELECT m.setor_funcional_id FROM movimento_material_esteril_item mi
                     JOIN movimento_material_esteril m ON m.id = mi.movimento_material_esteril_id
                    WHERE mi.pacote_esteril_id = p.id AND m.tipo = 'entrega' AND m.situacao <> 'cancelado'
                    ORDER BY m.ocorrido_em DESC, m.id DESC LIMIT 1) AS setor
             FROM pacote_esteril p
            WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.id IN (${lista(ids.length)})`,
          [est.id, ...ids],
        );
        const { desfechos, problemas } = desfechoDoRecolhimento(
          e.setor,
          pacotes.map((p) => ({
            id: num(p['id']),
            situacao: String(p['situacao']),
            validade: dia(p['validade']),
            setorEntregue: numOuNull(p['setor']),
          })),
          e.pacotes,
          hojeNo(est.fuso),
        );
        recusa('Recolhimento recusado', problemas);
        const mov = await tx.incluir('movimento_material_esteril', {
          estabelecimento_id: est.id,
          numero: await this.numeroMovimento(tx, est.id),
          tipo: 'recolhimento',
          cme_setor_funcional_id: e.cme,
          setor_funcional_id: e.setor,
          ocorrido_em: new Date(),
          responsavel_usuario_id: usuario,
          recebedor_usuario_id: e.recebedor,
          situacao: 'aberto',
          observacao: e.observacao,
        });
        let seq = 0;
        for (const d of desfechos) {
          const p = pacotes.find((x) => num(x['id']) === d.pacote)!;
          await tx.incluir('movimento_material_esteril_item', {
            movimento_material_esteril_id: mov,
            sequencia: ++seq,
            pacote_esteril_id: d.pacote,
            caixa_instrumental_id: numOuNull(p['caixa_instrumental_id']),
            quantidade: 1,
            validade_esterilizacao: dia(p['validade']),
          });
          if (d.situacao !== String(p['situacao']))
            await tx.alterar('pacote_esteril', d.pacote, num(p['versao']), { situacao: d.situacao });
        }
        return {
          tabela: 'movimento_material_esteril',
          id: mov,
          movimento: mov,
          arsenal: desfechos.filter((d) => d.destino === 'arsenal').length,
          expurgo: desfechos.filter((d) => d.destino === 'expurgo').length,
        };
      },
    );
  }

  conferir(c: ContextoPortaPropria, movimento: number) {
    return this.gravar(
      c,
      'cirurgia.cme.movimento.conferir',
      ['movimento_material_esteril', 'movimento_material_esteril_item'],
      async (tx, est, usuario) => {
        const m =
          (
            await tx.consultarParaAtualizar<Linha>(
              'SELECT id, versao, situacao FROM movimento_material_esteril WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
              [movimento, est.id],
            )
          )[0] ?? null;
        if (!m) throw naoEncontrado('Movimento de material estéril');
        recusa('Conferência recusada', conferirConferenciaDoMovimento(String(m['situacao'])));
        const agora = new Date();
        const itens = await tx.consultarParaAtualizar<Linha>(
          'SELECT id, versao FROM movimento_material_esteril_item WHERE movimento_material_esteril_id = ? AND excluido_em IS NULL',
          [movimento],
        );
        for (const i of itens)
          await tx.alterar('movimento_material_esteril_item', num(i['id']), num(i['versao']), {
            conferido: true,
            conferido_em: agora,
          });
        await tx.alterar('movimento_material_esteril', movimento, num(m['versao']), {
          situacao: 'conferido',
          conferido_em: agora,
          conferido_por_usuario_id: usuario,
        });
        return { tabela: 'movimento_material_esteril', id: movimento, movimento, situacao: 'conferido' };
      },
    );
  }

  gravarPermissao(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaPermissao, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.permissao.gravar',
      ['permissao_setor_cme'],
      async (tx, est, usuario) => {
        recusa('Permissão recusada', conferirGravacaoDaPermissao(usuario, e.usuario));
        await this.setorDoEstabelecimento(tx, est.id, e.setor, 'Setor');
        const u = await tx.uma('SELECT id FROM usuario WHERE id = ? AND excluido_em IS NULL', [e.usuario]);
        if (!u) throw naoEncontrado('Usuário');
        const valores = Object.fromEntries(CHAVES.map((k) => [COLUNA[k], e[k]]));
        const atual =
          (
            await tx.consultarParaAtualizar<Linha>(
              'SELECT id, versao, excluido_em FROM permissao_setor_cme WHERE usuario_id = ? AND setor_funcional_id = ?',
              [e.usuario, e.setor],
            )
          )[0] ?? null;
        if (atual) {
          await tx.alterar('permissao_setor_cme', num(atual['id']), num(atual['versao']), {
            ...valores,
            excluido_em: null,
            excluido_por: null,
          });
          return { tabela: 'permissao_setor_cme', id: num(atual['id']), permissao: num(atual['id']) };
        }
        const nova = await tx.incluir('permissao_setor_cme', {
          usuario_id: e.usuario,
          setor_funcional_id: e.setor,
          ...valores,
        });
        return { tabela: 'permissao_setor_cme', id: nova, permissao: nova };
      },
    );
  }
}
