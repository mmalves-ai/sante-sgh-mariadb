// Impressão da identificação do paciente (pulseira e etiqueta) e as leituras da impressão por estação no banco
// próprio (01-ADM L79). Regras em `@sgh/dominio-documento` (impressao/estacao.ts e impressao/identificacao.ts).
//
// - catalogo: estações, finalidades, impressoras, motivos de reimpressão ativos, unidades, os padrões do
//   estabelecimento e da unidade e os vínculos das estações (o que as telas de cadastro mostram);
// - situacao: para um atendimento, o que já saiu de cada identificação (vias, quando) e por onde a próxima vai sair
//   (estação reconhecida pelo endereço, impressora resolvida pela regra usuário > estação > unidade > estabelecimento);
// - conferir: a mesma decisão da gravação, só de leitura (a emissão confere antes de mandar à fila da estação);
// - impressao.identificacao_imprimir (Executor: trilha e idempotência na mesma transação): a 1ª impressão grava a
//   linha da identificação (via 1); as seguintes são reimpressão: sobem a via na linha e gravam o registro da
//   reimpressão com o motivo do catálogo, o complemento, a estação e a impressora. Nada é apagado;
// - historico: as reimpressões de um documento (motivo, via, quem, quando, por onde).
import {
  escolherImpressora,
  finalidadeDaIdentificacao,
  MENSAGEM_IDENTIFICACAO,
  planoImpressaoIdentificacao,
  type RecusaIdentificacao,
  TIPOS_IDENTIFICACAO,
  type TipoIdentificacao,
  viasAnterioresDaReimpressao,
} from '@sgh/dominio-documento';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { candidatasDeImpressora } from './operacoes-impressao-propria.js';

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const recusar = (r: RecusaIdentificacao) => recusa(r, MENSAGEM_IDENTIFICACAO[r]);
const TETO = 2000;
const ENTIDADE = 'impressao_identificacao';

const id = z.number().int().positive();
export const esquemaImprimirIdentificacao = z
  .object({
    /** O atendimento (ou, com `internacao`, a internação, de onde sai o atendimento). */
    atendimento: id.optional(),
    internacao: id.optional(),
    tipo: z.enum(TIPOS_IDENTIFICACAO),
    motivo: id.optional(),
    complemento: z.string().max(500).optional(),
    /** A estação escolhida na tela; sem ela, vale a estação reconhecida pelo endereço do pedido. */
    estacao: id.optional(),
    quantidade: z.number().int().min(1).max(99).default(1),
    destino: z.enum(['impressora', 'pdf']).default('impressora'),
  })
  .strict()
  .refine((e) => (e.atendimento === undefined) !== (e.internacao === undefined), {
    message: 'Informe o atendimento ou a internação.',
  });
export type ImprimirIdentificacaoEntrada = z.input<typeof esquemaImprimirIdentificacao>;

export interface NucleoImpressao {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

export interface ContextoImpressao {
  readonly hospital: string;
  readonly login: string;
  /** Endereço da estação que fez o pedido (reconhece a estação cadastrada). */
  readonly enderecoIp?: string;
}
export interface ContextoGravacaoImpressao extends ContextoImpressao {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
}

export interface ImpressoraResolvida {
  readonly id: number;
  readonly nome: string;
  readonly nivel: 'usuario' | 'estacao' | 'unidade' | 'estabelecimento' | 'escolhida';
}
export interface DecisaoIdentificacao {
  readonly via: number;
  readonly reimpressao: boolean;
  readonly estacao: number | null;
  readonly impressora: ImpressoraResolvida | null;
}
export interface IdentificacaoRegistrada extends DecisaoIdentificacao {
  readonly id: number;
  readonly registro: number | null;
}
export interface SituacaoIdentificacao {
  readonly tipo: TipoIdentificacao;
  readonly vias: number;
  readonly ultimaEm: string | null;
  readonly finalidade: number | null;
  readonly impressora: ImpressoraResolvida | null;
}

type Consulta = Pick<Leitor, 'uma' | 'consultar'> | TxOperacao;

/** O atendimento do pedido (direto ou pela internação), sempre do estabelecimento. */
async function atendimentoDoPedido(
  l: Consulta,
  est: number,
  e: { atendimento?: number | undefined; internacao?: number | undefined },
): Promise<number | null> {
  const r =
    e.internacao !== undefined
      ? await l.uma(
          'SELECT atendimento_id AS id FROM internacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.internacao, est],
        )
      : await l.uma('SELECT id FROM atendimento WHERE id = ? AND estabelecimento_id = ?', [
          e.atendimento,
          est,
        ]);
  return r ? num(r['id']) : null;
}

/** A estação do pedido: a escolhida (tem de ser do estabelecimento e ativa) ou a reconhecida pelo endereço. */
async function estacaoDoPedido(
  l: Consulta,
  est: number,
  escolhida: number | undefined,
  ip: string | undefined,
): Promise<{ id: number; unidade: number | null } | null | 'inexistente'> {
  if (escolhida !== undefined) {
    const e = await l.uma(
      `SELECT id, unidade_assistencial_id FROM estacao_trabalho
        WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL`,
      [escolhida, est],
    );
    return e ? { id: num(e['id']), unidade: numOuNull(e['unidade_assistencial_id']) } : 'inexistente';
  }
  if (!ip) return null;
  const e = await l.uma(
    `SELECT id, unidade_assistencial_id FROM estacao_trabalho
      WHERE estabelecimento_id = ? AND endereco_ip = ? AND ativo AND excluido_em IS NULL ORDER BY id LIMIT 1`,
    [est, ip],
  );
  return e ? { id: num(e['id']), unidade: numOuNull(e['unidade_assistencial_id']) } : null;
}

async function finalidadeDoTipo(l: Consulta, tipo: TipoIdentificacao): Promise<number | null> {
  const fs = await l.consultar(
    'SELECT id, codigo, tipo_midia, ativo FROM finalidade_impressao WHERE tipo_midia = ?',
    [tipo],
  );
  return finalidadeDaIdentificacao(
    tipo,
    fs.map((f) => ({
      id: num(f['id']),
      codigo: txt(f['codigo']),
      midia: txt(f['tipo_midia']),
      ativa: bool(f['ativo']),
    })),
  );
}

/** A decisão inteira (via, reimpressão, estação e impressora), igual na conferência e na gravação. */
async function decidir(
  l: Consulta,
  est: number,
  usuario: number | null,
  ip: string | undefined,
  e: z.output<typeof esquemaImprimirIdentificacao>,
): Promise<
  DecisaoIdentificacao & {
    atendimento: number;
    linha: { id: number; versao: number } | null;
    finalidade: number | null;
    complemento: string | null;
  }
> {
  const atendimento = await atendimentoDoPedido(l, est, e);
  if (atendimento === null) throw recusar('atendimento-inexistente');
  const atual = await l.uma(
    'SELECT id, versao, vias FROM impressao_identificacao WHERE atendimento_id = ? AND tipo = ?',
    [atendimento, e.tipo],
  );
  const ultima = atual
    ? await l.uma(
        `SELECT MAX(via) AS via FROM registro_reimpressao
          WHERE entidade = ? AND entidade_id = ? AND estabelecimento_id = ?`,
        [ENTIDADE, num(atual['id']), est],
      )
    : null;
  const m =
    e.motivo !== undefined
      ? await l.uma('SELECT ativo, exige_complemento FROM motivo_reimpressao WHERE id = ?', [e.motivo])
      : null;
  const p = planoImpressaoIdentificacao({
    viasAnteriores: viasAnterioresDaReimpressao({
      ultimaViaRegistrada: ultima && ultima['via'] !== null ? num(ultima['via']) : null,
      viasDoDocumento: atual ? num(atual['vias']) : 0,
    }),
    motivoInformado: e.motivo !== undefined,
    motivo: m ? { ativo: bool(m['ativo']), exigeComplemento: bool(m['exige_complemento']) } : null,
    complemento: e.complemento ?? null,
  });
  if ('recusa' in p) throw recusar(p.recusa);
  const estacao = await estacaoDoPedido(l, est, e.estacao, ip);
  if (estacao === 'inexistente') throw recusar('estacao-inexistente');
  const finalidade = await finalidadeDoTipo(l, e.tipo);
  let impressora: ImpressoraResolvida | null = null;
  if (finalidade !== null && e.destino === 'impressora') {
    const c = escolherImpressora(await candidatasDeImpressora(l, estacao?.id ?? null, finalidade, est), {
      usuario,
      unidade: estacao?.unidade ?? null,
    });
    if (c) {
      const i = await l.uma('SELECT nome FROM impressora WHERE id = ?', [c.impressora]);
      impressora = { id: c.impressora, nome: txt(i?.['nome']), nivel: c.nivel };
    }
  }
  return {
    atendimento,
    linha: atual ? { id: num(atual['id']), versao: num(atual['versao']) } : null,
    via: p.via,
    reimpressao: p.reimpressao,
    complemento: p.complemento,
    estacao: estacao?.id ?? null,
    finalidade,
    impressora,
  };
}

const operacaoImprimirIdentificacao = definirOperacao({
  nome: 'impressao.identificacao_imprimir',
  tabelas: ['impressao_identificacao', 'registro_reimpressao'],
  entrada: esquemaImprimirIdentificacao,
  async gravar(tx, e, ctx) {
    const ip = (ctx as ContextoOperacao & { enderecoIp?: string }).enderecoIp;
    const est = ctx.estabelecimento;
    if (est === null || est === undefined)
      throw recusa(
        'estabelecimento-obrigatorio',
        'A impressão da identificação é sempre de um estabelecimento.',
      );
    // A linha da identificação fica travada até o fim: duas estações não tiram a mesma via.
    const atendimento = await atendimentoDoPedido(tx, est, e);
    if (atendimento !== null)
      await tx.consultarParaAtualizar(
        'SELECT id FROM impressao_identificacao WHERE atendimento_id = ? AND tipo = ?',
        [atendimento, e.tipo],
      );
    const d = await decidir(tx, est, ctx.usuario ?? null, ip, e);
    const agora = new Date();
    if (!d.linha) {
      const novo = await tx.incluir('impressao_identificacao', {
        estabelecimento_id: est,
        atendimento_id: d.atendimento,
        tipo: e.tipo,
        vias: 1,
        primeira_impressao_em: agora,
        ultima_impressao_em: agora,
        finalidade_impressao_id: d.finalidade,
        estacao_trabalho_id: d.estacao,
        impressora_id: d.impressora?.id ?? null,
      });
      return { ...plano(d), id: novo, registro: null };
    }
    await tx.alterar('impressao_identificacao', d.linha.id, d.linha.versao, {
      vias: d.via,
      ultima_impressao_em: agora,
    });
    const registro = await tx.incluir('registro_reimpressao', {
      estabelecimento_id: est,
      documento_emitido_id: null,
      entidade: ENTIDADE,
      entidade_id: d.linha.id,
      motivo_reimpressao_id: e.motivo,
      motivo_texto: d.complemento,
      via: d.via,
      quantidade: e.quantidade,
      destino: e.destino,
      estacao_trabalho_id: d.estacao,
      impressora_id: d.impressora?.id ?? null,
      operacao: 'inclusao',
      dados: JSON.stringify({ finalidade: d.finalidade, tipo: e.tipo, atendimento: d.atendimento }),
      ocorrido_em: agora,
      usuario_id: ctx.usuario,
    });
    return { ...plano(d), id: d.linha.id, registro };
  },
  alvo: (_e, r) => ({ tabela: 'impressao_identificacao', id: r.id }),
  eventos: (e, r) => [
    {
      tipo: r.reimpressao ? 'impressao.identificacao.reimpressa' : 'impressao.identificacao.impressa',
      carga: { id: r.id, tipo: e.tipo, via: r.via },
    },
  ],
  trilha: (e, r) => ({
    motivo: e.complemento ?? null,
    dados: { tipo: e.tipo, via: r.via, reimpressao: r.reimpressao, estacao: r.estacao },
  }),
});

/** O resultado da operação em valores simples (é o que a idempotência guarda e devolve na repetição). */
function plano(d: Awaited<ReturnType<typeof decidir>>) {
  return {
    via: d.via,
    reimpressao: d.reimpressao,
    estacao: d.estacao,
    impressora: d.impressora?.id ?? null,
    impressoraNome: d.impressora?.nome ?? null,
    impressoraNivel: d.impressora?.nivel ?? null,
  };
}

function semLinha(d: Awaited<ReturnType<typeof decidir>>): DecisaoIdentificacao {
  return { via: d.via, reimpressao: d.reimpressao, estacao: d.estacao, impressora: d.impressora };
}

export class ImpressaoIdentificacaoPropria {
  private executorCache: Executor | null = null;

  constructor(
    private readonly nucleo: NucleoImpressao,
    private readonly cliente: string,
  ) {}

  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  private ler<T>(c: ContextoImpressao, fn: (l: Leitor, est: number, usuario: number | null) => Promise<T>) {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'administracao.impressao' },
      async (l) => {
        const q = await this.quem(l, c);
        return fn(l, q.estabelecimento, q.usuario);
      },
    );
  }

  private async quem(l: Leitor, c: ContextoImpressao) {
    const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
      c.hospital,
    ]);
    if (!e)
      throw new ErroOperacao(
        403,
        'estabelecimento-desconhecido',
        'Estabelecimento',
        'O estabelecimento da sessão não existe no cliente.',
      );
    const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
    return { estabelecimento: num(e['id']), usuario: u ? num(u['id']) : null };
  }

  /** O que as telas de cadastro e o botão Reimprimir precisam, numa leitura só. */
  catalogo(c: ContextoImpressao) {
    return this.ler(c, async (l, est, usuario) => {
      const q = (sql: string, p: unknown[]) => l.consultar(sql, p, { teto: TETO });
      const [estacoes, finalidades, impressoras, motivos, unidades, padroes, vinculos] = await Promise.all([
        q(
          `SELECT id, codigo, nome, tipo_estacao, unidade_assistencial_id, endereco_ip FROM estacao_trabalho
            WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL ORDER BY nome`,
          [est],
        ),
        q(
          'SELECT id, codigo, descricao, tipo_midia FROM finalidade_impressao WHERE ativo ORDER BY descricao',
          [],
        ),
        q(
          `SELECT id, codigo, nome, tipo, ativo FROM impressora
            WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome`,
          [est],
        ),
        q(
          'SELECT id, codigo, descricao, exige_complemento FROM motivo_reimpressao WHERE ativo ORDER BY descricao',
          [],
        ),
        q(
          `SELECT id, nome FROM unidade_assistencial
            WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome`,
          [est],
        ),
        q(
          `SELECT id, finalidade_impressao_id, unidade_assistencial_id, impressora_id, copias, ativo
             FROM impressora_finalidade_estabelecimento WHERE estabelecimento_id = ?`,
          [est],
        ),
        q(
          `SELECT ei.id, ei.estacao_trabalho_id, ei.finalidade_impressao_id, ei.impressora_id, ei.usuario_id, ei.padrao
             FROM estacao_impressora ei JOIN estacao_trabalho et ON et.id = ei.estacao_trabalho_id
            WHERE et.estabelecimento_id = ? AND ei.excluido_em IS NULL`,
          [est],
        ),
      ]);
      const ip = c.enderecoIp ?? null;
      return {
        eu: usuario,
        /** A estação reconhecida pelo endereço deste pedido (a tela já abre nela). */
        estacaoAtual: ip ? (estacoes.find((e) => txt(e['endereco_ip']) === ip)?.['id'] ?? null) : null,
        estacoes: estacoes.map((e) => ({
          id: num(e['id']),
          codigo: txt(e['codigo']),
          nome: txt(e['nome']),
          tipo: txt(e['tipo_estacao']),
          unidade: numOuNull(e['unidade_assistencial_id']),
        })),
        finalidades: finalidades.map((f) => ({
          id: num(f['id']),
          codigo: txt(f['codigo']),
          descricao: txt(f['descricao']),
          midia: txt(f['tipo_midia']),
        })),
        impressoras: impressoras.map((i) => ({
          id: num(i['id']),
          codigo: txt(i['codigo']),
          nome: txt(i['nome']),
          tipo: txt(i['tipo']),
          ativa: bool(i['ativo']),
        })),
        motivos: motivos.map((m) => ({
          id: num(m['id']),
          codigo: txt(m['codigo']),
          descricao: txt(m['descricao']),
          exigeComplemento: bool(m['exige_complemento']),
        })),
        unidades: unidades.map((u) => ({ id: num(u['id']), nome: txt(u['nome']) })),
        padroes: padroes.map((p) => ({
          id: num(p['id']),
          finalidade: num(p['finalidade_impressao_id']),
          unidade: numOuNull(p['unidade_assistencial_id']),
          impressora: num(p['impressora_id']),
          copias: num(p['copias']),
          ativo: bool(p['ativo']),
        })),
        vinculos: vinculos.map((v) => ({
          id: num(v['id']),
          estacao: num(v['estacao_trabalho_id']),
          finalidade: num(v['finalidade_impressao_id']),
          impressora: num(v['impressora_id']),
          usuario: numOuNull(v['usuario_id']),
          padrao: bool(v['padrao']),
        })),
      };
    });
  }

  /** Os motivos de reimpressão ativos (o que a tela de impressos oferece ao reimprimir). */
  motivos(c: ContextoImpressao) {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          'SELECT id, codigo, descricao, exige_complemento FROM motivo_reimpressao WHERE ativo ORDER BY descricao',
          [],
          { teto: TETO },
        )
      ).map((m) => ({
        id: num(m['id']),
        codigo: txt(m['codigo']),
        descricao: txt(m['descricao']),
        exigeComplemento: bool(m['exige_complemento']),
      })),
    );
  }

  /** O que já saiu de cada identificação do atendimento e por onde a próxima vai sair. */
  situacao(
    c: ContextoImpressao,
    alvo: { atendimento?: number; internacao?: number },
  ): Promise<{ atendimento: number; estacao: number | null; identificacoes: SituacaoIdentificacao[] }> {
    return this.ler(c, async (l, est, usuario) => {
      const atendimento = await atendimentoDoPedido(l, est, alvo);
      if (atendimento === null) throw recusar('atendimento-inexistente');
      const estacao = await estacaoDoPedido(l, est, undefined, c.enderecoIp);
      const e = estacao === 'inexistente' ? null : estacao;
      const linhas = await l.consultar(
        'SELECT tipo, vias, ultima_impressao_em FROM impressao_identificacao WHERE atendimento_id = ?',
        [atendimento],
      );
      const identificacoes: SituacaoIdentificacao[] = [];
      for (const tipo of TIPOS_IDENTIFICACAO) {
        const x = linhas.find((y) => txt(y['tipo']) === tipo);
        const finalidade = await finalidadeDoTipo(l, tipo);
        let impressora: ImpressoraResolvida | null = null;
        if (finalidade !== null) {
          const esc = escolherImpressora(await candidatasDeImpressora(l, e?.id ?? null, finalidade, est), {
            usuario,
            unidade: e?.unidade ?? null,
          });
          if (esc) {
            const i = await l.uma('SELECT nome FROM impressora WHERE id = ?', [esc.impressora]);
            impressora = { id: esc.impressora, nome: txt(i?.['nome']), nivel: esc.nivel };
          }
        }
        identificacoes.push({
          tipo,
          vias: x ? num(x['vias']) : 0,
          ultimaEm: x ? iso(x['ultima_impressao_em']) : null,
          finalidade,
          impressora,
        });
      }
      return { atendimento, estacao: e?.id ?? null, identificacoes };
    });
  }

  /** A decisão da gravação, só de leitura: a emissão confere antes de mandar à fila (recusa igual à da gravação). */
  conferir(c: ContextoImpressao, entrada: ImprimirIdentificacaoEntrada): Promise<DecisaoIdentificacao> {
    const e = esquemaImprimirIdentificacao.parse(entrada);
    return this.ler(c, async (l, est, usuario) => semLinha(await decidir(l, est, usuario, c.enderecoIp, e)));
  }

  /** Registra a impressão (1ª via) ou a reimpressão (motivo do catálogo) pelo Executor. */
  async registrar(
    c: ContextoGravacaoImpressao,
    entrada: ImprimirIdentificacaoEntrada,
  ): Promise<IdentificacaoRegistrada & { repetida: boolean }> {
    const q = await this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'administracao.impressao' },
      (l) => this.quem(l, c),
    );
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(
      operacaoImprimirIdentificacao as never,
      this.cliente,
      entrada,
      ctx,
    );
    const x = r.resultado as Record<string, string | number | boolean | null>;
    return {
      id: num(x['id']),
      registro: numOuNull(x['registro']),
      via: num(x['via']),
      reimpressao: bool(x['reimpressao']),
      estacao: numOuNull(x['estacao']),
      impressora:
        x['impressora'] === null || x['impressora'] === undefined
          ? null
          : {
              id: num(x['impressora']),
              nome: txt(x['impressoraNome']),
              nivel: txt(x['impressoraNivel']) as ImpressoraResolvida['nivel'],
            },
      repetida: r.repetida,
    };
  }

  /** As reimpressões de uma identificação do atendimento, da mais recente para a mais antiga. */
  historico(c: ContextoImpressao, alvo: { atendimento?: number; internacao?: number }) {
    return this.ler(c, async (l, est) => {
      const atendimento = await atendimentoDoPedido(l, est, alvo);
      if (atendimento === null) throw recusar('atendimento-inexistente');
      const ls = await l.consultar(
        `SELECT r.id, ii.tipo, r.via, r.quantidade, r.destino, r.ocorrido_em, r.motivo_texto,
                m.descricao AS motivo, u.login, i.nome AS impressora, et.nome AS estacao
           FROM registro_reimpressao r
           JOIN impressao_identificacao ii ON ii.id = r.entidade_id
           JOIN motivo_reimpressao m ON m.id = r.motivo_reimpressao_id
           LEFT JOIN usuario u ON u.id = r.usuario_id
           LEFT JOIN impressora i ON i.id = r.impressora_id
           LEFT JOIN estacao_trabalho et ON et.id = r.estacao_trabalho_id
          WHERE r.entidade = ? AND r.estabelecimento_id = ? AND ii.atendimento_id = ?
          ORDER BY r.ocorrido_em DESC, r.id DESC`,
        [ENTIDADE, est, atendimento],
        { teto: TETO },
      );
      return ls.map((x) => ({
        id: num(x['id']),
        tipo: txt(x['tipo']) as TipoIdentificacao,
        via: num(x['via']),
        quantidade: num(x['quantidade']),
        destino: txt(x['destino']),
        em: iso(x['ocorrido_em']),
        motivo: txt(x['motivo']),
        complemento: x['motivo_texto'] === null ? null : txt(x['motivo_texto']),
        usuario: x['login'] === null ? null : txt(x['login']),
        impressora: x['impressora'] === null ? null : txt(x['impressora']),
        estacao: x['estacao'] === null ? null : txt(x['estacao']),
      }));
    });
  }
}
