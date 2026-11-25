// F7 (08-SGO linha 113, C2-074): a porta própria do portal do prestador para o pedido de credenciamento e de alteração
// do próprio cadastro (pedido_web_prestador), os avisos à rede (aviso_portal_prestador) e as regras de arquivo por tipo
// de prestador (regra_arquivo_prestador), no MariaDB do cliente. Cada gravação é uma operação do Executor com a trilha
// na mesma transação. O pedido nunca altera o cadastro do prestador: fica guardado com a decisão (aprovado, recusado com
// motivo, cancelado pelo próprio prestador). Nada é apagado: o aviso e a regra saem do ar por inativação. As regras de
// negócio ficam no domínio (`@sgh/dominio-operadora`); aqui só a leitura, a trava de versão e a gravação.
import {
  type AcaoPedidoWebPrestador,
  type AvisoPortalEntrada,
  type AvisoPortalLido,
  type PedidoWebPrestadorEntrada,
  proximaSituacaoPedidoWeb,
  problemasDoAvisoPortal,
  problemasDoPedidoWeb,
  type RegraArquivoPrestador,
  type SituacaoPedidoWebPrestador,
} from '@sgh/dominio-operadora';
import { definirOperacao, type Executor, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  booleano,
  contextoDireto,
  estabelecimentoDaSessao,
  inteiro,
  instanteIso,
  type NucleoOperadora,
  semEstabelecimento,
  texto,
  textoObrigatorio,
} from './apoio-banco.js';

export const PORTA_PORTAL_PRESTADOR_PEDIDOS = Symbol('PORTA_PORTAL_PRESTADOR_PEDIDOS');

export const TABELAS_PORTAL_PRESTADOR_PEDIDOS = [
  'pedido_web_prestador',
  'aviso_portal_prestador',
  'regra_arquivo_prestador',
] as const;

export type Gravado = { readonly id: number; readonly versao: number };
type Trilha = (r: Gravado) => RegistroTrilhaTela;
const esquemaEntrada = z.record(z.string(), z.unknown());

export interface PedidoWebPrestadorLido {
  readonly id: number;
  readonly numero: string;
  readonly tipo: string;
  readonly prestador: number | null;
  readonly prestadorNome: string | null;
  readonly conta: number | null;
  readonly pessoa: string;
  readonly nome: string;
  readonly situacao: SituacaoPedidoWebPrestador;
  readonly recebidoEm: string;
  readonly analisadoEm: string | null;
  readonly motivoRecusa: string | null;
  readonly detalhes: unknown;
  readonly versao: number;
}

export interface AvisoPortalGravado extends AvisoPortalLido {
  readonly tipo: string;
  readonly titulo: string;
  readonly conteudo: string;
  readonly link: string | null;
  readonly documento: number | null;
  readonly versao: number;
}

export interface RegraArquivoLida extends RegraArquivoPrestador {
  readonly operadora: number;
  readonly versao: number;
}

/** O prestador da rede como o portal precisa (tipo e natureza para avisos e regras). */
export interface PrestadorDoPortal {
  readonly id: number;
  readonly nome: string;
  readonly pessoa: 'fisica' | 'juridica';
  readonly tipoPrestador: number | null;
  /** O documento do cadastro (o pedido de alteração repete o do prestador quando a tela não manda outro). */
  readonly cpf: string | null;
  readonly cnpj: string | null;
}

const PEDIDO_SQL = `SELECT p.id, p.numero, p.tipo_pedido, p.prestador_rede_id, pr.nome AS prestador_nome,
       p.conta_portal_prestador_id, p.pessoa, p.nome, p.situacao, p.recebido_em, p.analisado_em, p.motivo_recusa,
       p.detalhes, p.versao
  FROM pedido_web_prestador p
  LEFT JOIN prestador_rede pr ON pr.id = p.prestador_rede_id
 WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL`;

const pedidoDe = (x: Record<string, unknown>): PedidoWebPrestadorLido => {
  let detalhes: unknown = x['detalhes'] ?? null;
  if (typeof detalhes === 'string') {
    try {
      detalhes = JSON.parse(detalhes);
    } catch {
      detalhes = null;
    }
  }
  return {
    id: inteiro(x['id']) ?? 0,
    numero: textoObrigatorio(x['numero']),
    tipo: textoObrigatorio(x['tipo_pedido']),
    prestador: inteiro(x['prestador_rede_id']),
    prestadorNome: texto(x['prestador_nome']),
    conta: inteiro(x['conta_portal_prestador_id']),
    pessoa: textoObrigatorio(x['pessoa']),
    nome: textoObrigatorio(x['nome']),
    situacao: textoObrigatorio(x['situacao']) as SituacaoPedidoWebPrestador,
    recebidoEm: instanteIso(x['recebido_em']) ?? '',
    analisadoEm: instanteIso(x['analisado_em']),
    motivoRecusa: texto(x['motivo_recusa']),
    detalhes,
    versao: inteiro(x['versao']) ?? 1,
  };
};

const avisoDe = (x: Record<string, unknown>): AvisoPortalGravado => ({
  id: inteiro(x['id']) ?? 0,
  tipo: textoObrigatorio(x['tipo']),
  titulo: textoObrigatorio(x['titulo']),
  conteudo: textoObrigatorio(x['conteudo']),
  link: texto(x['endereco_link']),
  documento: inteiro(x['documento_arquivo_id']),
  ativo: booleano(x['ativo']),
  publico: textoObrigatorio(x['publico']),
  tipoPrestador: inteiro(x['tipo_prestador_rede_id']),
  prestador: inteiro(x['prestador_rede_id']),
  exibirDe: instanteIso(x['exibir_de']) ?? '',
  exibirAte: instanteIso(x['exibir_ate']),
  destaque: booleano(x['destaque']),
  versao: inteiro(x['versao']) ?? 1,
});

const regraDe = (x: Record<string, unknown>): RegraArquivoLida => ({
  id: inteiro(x['id']) ?? 0,
  operadora: inteiro(x['operadora_saude_id']) ?? 0,
  descricao: textoObrigatorio(x['descricao_documento']),
  tipoPrestador: inteiro(x['tipo_prestador_rede_id']),
  natureza: (texto(x['natureza_pessoa']) as 'fisica' | 'juridica' | null) ?? null,
  obrigatorio: booleano(x['obrigatorio']),
  extensoes: texto(x['extensoes_aceitas']),
  tamanhoMaximoKb: inteiro(x['tamanho_maximo_kb']),
  ativo: booleano(x['ativo']),
  versao: inteiro(x['versao']) ?? 1,
});

const recusaDe = (problemas: readonly { codigo: string; campo: string }[]) => {
  const p = problemas[0];
  return recusa(
    p?.codigo ?? 'recusa',
    `Pedido recusado: ${problemas.map((x) => x.codigo).join(', ')}.`,
    p?.campo ? { campos: [p.campo] } : {},
  );
};
const so = (v: string | null) => (v ? v.replace(/\D/g, '') : null);
/** Instante ISO da tela para o DATETIME do banco. */
const paraBanco = (v: string) => v.replace('T', ' ').replace(/Z$/, '').slice(0, 23);

export class PortaPortalPrestadorPedidosPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-portal-pedidos' },
      async (l) => {
        const est = await estabelecimentoDaSessao(c, l);
        if (est === null) throw semEstabelecimento();
        return fn(l, est);
      },
    );
  }

  private async gravar<T extends Gravado>(
    c: ContextoPorta,
    nome: string,
    tabela: string,
    trilha: Trilha,
    fn: (tx: TxOperacao, est: number) => Promise<T>,
  ): Promise<T> {
    const est = await this.ler(c, async (_l, e) => e);
    const operacao = definirOperacao<Record<string, unknown>, T>({
      nome,
      tabelas: TABELAS_PORTAL_PRESTADOR_PEDIDOS,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: (tx) => fn(tx, est),
      alvo: (_e, r) => ({ tabela, id: r.id }),
      trilha: (_e, r) => {
        const l = trilha(r);
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const r = await this.executor.executar(
      operacao,
      this.cliente,
      {},
      contextoDireto(this.cliente, est, c, null),
    );
    return r.resultado;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────

  /** O prestador da rede (tipo e natureza), do estabelecimento da sessão. */
  prestador(c: ContextoPorta, id: number): Promise<PrestadorDoPortal | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma(
        `SELECT id, nome, pessoa, tipo_prestador_rede_id, cpf, cnpj FROM prestador_rede
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [id, est],
      );
      return x
        ? {
            id,
            nome: textoObrigatorio(x['nome']),
            pessoa: textoObrigatorio(x['pessoa']) === 'fisica' ? 'fisica' : 'juridica',
            tipoPrestador: inteiro(x['tipo_prestador_rede_id']),
            cpf: texto(x['cpf']),
            cnpj: texto(x['cnpj']),
          }
        : null;
    });
  }

  /** Os pedidos do estabelecimento (fila da operadora) ou só os de um prestador (portal), do mais novo; 100 no máximo. */
  pedidos(
    c: ContextoPorta,
    f: { readonly prestador?: number; readonly situacao?: SituacaoPedidoWebPrestador },
  ): Promise<PedidoWebPrestadorLido[]> {
    return this.ler(c, async (l, est) => {
      const p: unknown[] = [est];
      let filtro = '';
      if (f.prestador !== undefined) {
        filtro += ' AND p.prestador_rede_id = ?';
        p.push(f.prestador);
      }
      if (f.situacao) {
        filtro += ' AND p.situacao = ?';
        p.push(f.situacao);
      }
      const r = await l.consultar(
        `${PEDIDO_SQL}${filtro} ORDER BY p.recebido_em DESC, p.id DESC LIMIT 100`,
        p,
      );
      return r.map(pedidoDe);
    });
  }

  pedido(c: ContextoPorta, id: number): Promise<PedidoWebPrestadorLido | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma(`${PEDIDO_SQL} AND p.id = ?`, [est, id]);
      return x ? pedidoDe(x) : null;
    });
  }

  /** Os avisos do estabelecimento (a tela da operadora vê todos, inclusive os inativos), do mais novo. */
  avisos(c: ContextoPorta): Promise<AvisoPortalGravado[]> {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `SELECT id, tipo, publico, tipo_prestador_rede_id, prestador_rede_id, titulo, conteudo, documento_arquivo_id,
                endereco_link, exibir_de, exibir_ate, destaque, ativo, versao
           FROM aviso_portal_prestador
          WHERE estabelecimento_id = ? AND excluido_em IS NULL
          ORDER BY exibir_de DESC, id DESC LIMIT 200`,
        [est],
      );
      return r.map(avisoDe);
    });
  }

  /** O instante do servidor (o recorte do período dos avisos não confia no relógio da tela). */
  agora(c: ContextoPorta): Promise<string> {
    return this.ler(c, async (l) => instanteIso((await l.uma('SELECT NOW(3) AS agora'))?.['agora']) ?? '');
  }

  /** As regras de arquivo da operadora (ativas e inativas). */
  regras(c: ContextoPorta, operadora: number): Promise<RegraArquivoLida[]> {
    return this.ler(c, async (l) => {
      const r = await l.consultar(
        `SELECT id, operadora_saude_id, tipo_prestador_rede_id, natureza_pessoa, descricao_documento, obrigatorio,
                extensoes_aceitas, tamanho_maximo_kb, ativo, versao
           FROM regra_arquivo_prestador WHERE operadora_saude_id = ? ORDER BY descricao_documento, id`,
        [operadora],
      );
      return r.map(regraDe);
    });
  }

  // ── Gravações ─────────────────────────────────────────────────────────────────────────────────

  /**
   * O pedido do prestador (do portal: a conta e o prestador da sessão). Conferido pelo domínio de novo no servidor; o
   * número sai do id (PW + 8 dígitos), único no estabelecimento.
   */
  registrarPedido(
    c: ContextoPorta,
    e: PedidoWebPrestadorEntrada & {
      readonly conta: number | null;
      readonly tipoPrestador: number | null;
      readonly nomeFantasia: string | null;
      readonly telefone: string | null;
    },
    trilha: Trilha,
  ): Promise<Gravado & { numero: string }> {
    const problemas = problemasDoPedidoWeb(e);
    if (problemas.length) return Promise.reject(recusaDe(problemas));
    return this.gravar(
      c,
      'operadora.portal-prestador.pedido.registrar',
      'pedido_web_prestador',
      trilha,
      async (tx, est) => {
        const provisorio = `PW-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.slice(
          0,
          30,
        );
        const id = await tx.incluir('pedido_web_prestador', {
          estabelecimento_id: est,
          numero: provisorio,
          tipo_pedido: e.tipo,
          prestador_rede_id: e.prestador,
          conta_portal_prestador_id: e.conta,
          tipo_prestador_rede_id: e.tipoPrestador,
          pessoa: e.pessoa,
          nome: e.nome.trim().slice(0, 150),
          nome_fantasia: e.nomeFantasia?.trim().slice(0, 150) || null,
          cpf: e.pessoa === 'fisica' ? so(e.cpf) : null,
          cnpj: e.pessoa === 'juridica' ? so(e.cnpj) : null,
          conselho_classe_id: e.conselho.classe,
          numero_conselho: e.conselho.numero,
          conselho_unidade_federativa_id: e.conselho.uf,
          codigo_cnes: e.cnes,
          banco_id: e.banco.banco,
          agencia: e.banco.agencia,
          conta: e.banco.conta,
          telefone: e.telefone,
          email: e.email,
          cep: e.cep,
          detalhes: e.detalhes ? JSON.stringify(e.detalhes) : null,
          situacao: 'recebido',
          recebido_em: new Date(),
        });
        const numero = `PW${String(id).padStart(8, '0')}`;
        const versao = await tx.alterar('pedido_web_prestador', id, 1, { numero });
        return { id, versao, numero };
      },
    );
  }

  /**
   * A decisão da operadora (analisar, aprovar, recusar com motivo) ou o cancelamento pelo próprio prestador (`dono`:
   * o pedido tem de ser dele). A versão lida trava a corrida; decidido não volta (domínio).
   */
  decidirPedido(
    c: ContextoPorta,
    a: {
      readonly id: number;
      readonly versao: number;
      readonly acao: AcaoPedidoWebPrestador;
      readonly motivo: string | null;
      readonly analista: number | null;
      readonly dono?: number;
    },
    trilha: Trilha,
  ): Promise<Gravado & { situacao: SituacaoPedidoWebPrestador }> {
    return this.gravar(
      c,
      'operadora.portal-prestador.pedido.decidir',
      'pedido_web_prestador',
      trilha,
      async (tx, est) => {
        const [x] = await tx.consultarParaAtualizar(
          'SELECT id, situacao, prestador_rede_id FROM pedido_web_prestador WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [a.id, est],
        );
        if (!x || (a.dono !== undefined && inteiro(x['prestador_rede_id']) !== a.dono))
          throw recusa('pedido-inexistente', 'Pedido não encontrado.');
        const r = proximaSituacaoPedidoWeb(
          textoObrigatorio(x['situacao']) as SituacaoPedidoWebPrestador,
          a.acao,
          a.motivo,
        );
        if ('problema' in r) throw recusaDe([r.problema]);
        const decide = a.acao === 'aprovar' || a.acao === 'recusar';
        const versao = await tx.alterar('pedido_web_prestador', a.id, a.versao, {
          situacao: r.situacao,
          ...(decide || a.acao === 'analisar'
            ? { analisado_em: new Date(), analisado_por_usuario_id: a.analista }
            : {}),
          ...(a.acao === 'recusar' ? { motivo_recusa: (a.motivo ?? '').trim().slice(0, 500) } : {}),
        });
        return { id: a.id, versao, situacao: r.situacao };
      },
    );
  }

  /** O aviso publicado à rede (público prestadores), conferido pelo domínio. */
  publicarAviso(
    c: ContextoPorta,
    a: AvisoPortalEntrada & { readonly destaque: boolean },
    trilha: Trilha,
  ): Promise<Gravado> {
    const problemas = problemasDoAvisoPortal(a);
    if (problemas.length) return Promise.reject(recusaDe(problemas));
    return this.gravar(
      c,
      'operadora.portal-prestador.aviso.publicar',
      'aviso_portal_prestador',
      trilha,
      async (tx, est) => ({
        id: await tx.incluir('aviso_portal_prestador', {
          estabelecimento_id: est,
          tipo: a.tipo,
          publico: 'prestadores',
          tipo_prestador_rede_id: a.tipoPrestador,
          prestador_rede_id: a.prestador,
          titulo: a.titulo.trim().slice(0, 200),
          conteudo: a.conteudo.trim(),
          documento_arquivo_id: a.documento,
          endereco_link: a.link,
          exibir_de: paraBanco(a.exibirDe),
          exibir_ate: a.exibirAte ? paraBanco(a.exibirAte) : null,
          destaque: a.destaque,
          ativo: true,
        }),
        versao: 1,
      }),
    );
  }

  /** O aviso sai do ar (inativado, nunca apagado). */
  retirarAviso(
    c: ContextoPorta,
    a: { readonly id: number; readonly versao: number },
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.portal-prestador.aviso.retirar',
      'aviso_portal_prestador',
      trilha,
      async (tx, est) => {
        const [x] = await tx.consultarParaAtualizar(
          'SELECT id, ativo FROM aviso_portal_prestador WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [a.id, est],
        );
        if (!x) throw recusa('aviso-inexistente', 'Aviso não encontrado.');
        if (!booleano(x['ativo'])) throw recusa('aviso-retirado', 'O aviso já saiu do ar.');
        return {
          id: a.id,
          versao: await tx.alterar('aviso_portal_prestador', a.id, a.versao, { ativo: false }),
        };
      },
    );
  }

  /** A regra de arquivo da operadora (o documento exigido por tipo e natureza do prestador). */
  incluirRegra(
    c: ContextoPorta,
    r: Omit<RegraArquivoPrestador, 'id' | 'ativo'> & { readonly operadora: number },
    trilha: Trilha,
  ): Promise<Gravado> {
    if (!r.descricao.trim())
      return Promise.reject(
        recusa('descricao-obrigatoria', 'Descreva o documento.', { campos: ['descricao'] }),
      );
    return this.gravar(
      c,
      'operadora.portal-prestador.regra.incluir',
      'regra_arquivo_prestador',
      trilha,
      async (tx) => ({
        id: await tx.incluir('regra_arquivo_prestador', {
          operadora_saude_id: r.operadora,
          tipo_prestador_rede_id: r.tipoPrestador,
          natureza_pessoa: r.natureza,
          descricao_documento: r.descricao.trim().slice(0, 150),
          obrigatorio: r.obrigatorio,
          extensoes_aceitas: r.extensoes,
          tamanho_maximo_kb: r.tamanhoMaximoKb,
          ativo: true,
        }),
        versao: 1,
      }),
    );
  }

  /** A regra deixa de valer (inativada com a data, nunca apagada). */
  inativarRegra(
    c: ContextoPorta,
    a: { readonly id: number; readonly versao: number },
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.portal-prestador.regra.inativar',
      'regra_arquivo_prestador',
      trilha,
      async (tx) => ({
        id: a.id,
        versao: await tx.alterar('regra_arquivo_prestador', a.id, a.versao, {
          ativo: false,
          inativado_em: new Date(),
        }),
      }),
    );
  }
}

export const METODOS_PORTAL_PRESTADOR_PEDIDOS: ReadonlySet<string> = new Set([
  'prestador',
  'pedidos',
  'pedido',
  'avisos',
  'agora',
  'regras',
  'registrarPedido',
  'decidirPedido',
  'publicarAviso',
  'retirarAviso',
  'incluirRegra',
  'inativarRegra',
]);
