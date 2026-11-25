// Notas e lembretes livres sobre o paciente (03-PEP L102), no banco próprio do cliente. Regras no domínio
// (@sgh/dominio-pep, nota-paciente.ts); aqui ficam a leitura por paciente (só o que quem lê pode ver) e a gravação
// pelo executor (trilha na mesma transação). nota_paciente guarda o autor, o tipo, a visibilidade, a validade e a
// situação; nada é apagado nem tem o texto reescrito: o cancelamento fica com quem, quando e por quê. Os tipos
// (tipo_nota_paciente) e os textos prontos (nota_predefinida) são mantidos no cadastro genérico da configuração.
import {
  ACOES_NOTA,
  APLICACOES_TEXTO_NOTA,
  type FalhaRegra,
  notaAlerta,
  notaVisivel,
  passoNota,
  situacaoExibidaNota,
  TEXTO_NOTA_MAXIMO,
  validarNovaNota,
  VISIBILIDADES_NOTA,
} from '@sgh/dominio-pep';
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

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => Boolean(Number(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const dataDe = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);
const id = z.number().int().positive();
const quando = z.string().datetime({ offset: true });

export const esquemaNota = z.discriminatedUnion('acao', [
  z
    .object({
      acao: z.literal('registrar'),
      paciente: id,
      atendimento: id.nullable().optional(),
      tipo: id,
      predefinida: id.nullable().optional(),
      texto: z.string().max(TEXTO_NOTA_MAXIMO + 100),
      visibilidade: z.enum(VISIBILIDADES_NOTA).default('equipe'),
      validaAte: quando.nullable().optional(),
    })
    .strict(),
  z
    .object({
      acao: z.enum(ACOES_NOTA),
      nota: id,
      versao: z.number().int().positive(),
      motivo: z.string().trim().max(500).nullable().optional(),
      validaAte: quando.nullable().optional(),
    })
    .strict(),
]);
export type EntradaNota = z.infer<typeof esquemaNota>;

export interface NucleoNotas {
  lerSomente<T>(
    contexto: {
      readonly cliente: string;
      readonly correlacao: string;
      readonly estabelecimento?: number | null;
    },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

export interface ContextoNotas {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoNotas = ContextoNotas & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};

export interface NotaLida {
  readonly id: number;
  readonly versao: number;
  readonly tipo: { id: number; descricao: string };
  readonly texto: string;
  readonly visibilidade: string;
  readonly registradaEm: string | null;
  readonly validaAte: string | null;
  /** ativa, vencida (ativa com a validade passada), encerrada ou cancelada. */
  readonly situacao: string;
  readonly alerta: boolean;
  readonly autor: string | null;
  readonly doAutor: boolean;
  readonly estabelecimentoId: number;
  readonly atendimentoId: number | null;
  readonly canceladaEm: string | null;
  readonly motivoCancelamento: string | null;
}

export interface NotasDoPaciente {
  readonly notas: readonly NotaLida[];
  /** As notas em vigor de tipo marcado como alerta: aparecem no topo ao abrir o prontuário. */
  readonly alertas: readonly NotaLida[];
  readonly tipos: readonly { id: number; descricao: string; alerta: boolean }[];
  readonly textosProntos: readonly { id: number; titulo: string; texto: string }[];
  readonly podeEscrever: boolean;
}

const recusar = (f: readonly FalhaRegra[]): never => {
  throw recusa(f[0]!.codigo, f.map((x) => x.mensagem).join(' '));
};
const inexistente = (o: string): ErroOperacao =>
  new ErroOperacao(404, 'registro-inexistente', `${o} não encontrada`, `${o} não existe neste cliente.`);

async function profDe(tx: Pick<TxOperacao, 'uma' | 'contexto'>): Promise<number | null> {
  const p = await tx.uma(
    'SELECT profissional_id FROM usuario_profissional WHERE usuario_id = ? AND excluido_em IS NULL ORDER BY id LIMIT 1',
    [tx.contexto.usuario],
  );
  return p ? num(p['profissional_id']) : null;
}

export class NotasPacientePropria {
  private executorCache: Executor | null = null;
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  private readonly opNota = definirOperacao<EntradaNota, { nota: number; situacao: string }>({
    nome: 'pep.nota_paciente',
    tabelas: ['nota_paciente'],
    entrada: esquemaNota as unknown as z.ZodType<EntradaNota>,
    gravar: (tx, e, ctx) => this.gravar(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'nota_paciente', id: r.nota }),
  });

  constructor(
    private readonly nucleo: NucleoNotas,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  private quem(c: ContextoNotas) {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'pep.notas' }, async (l) => {
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
      const u = await l.uma(
        `SELECT u.id, (SELECT up.profissional_id FROM usuario_profissional up
                      WHERE up.usuario_id = u.id AND up.excluido_em IS NULL ORDER BY up.id LIMIT 1) AS profissional
         FROM usuario u WHERE u.login = ? AND u.excluido_em IS NULL`,
        [c.login],
      );
      return {
        estabelecimento: num(e['id']),
        usuario: u ? num(u['id']) : null,
        profissional: u ? numOuNull(u['profissional']) : null,
      };
    });
  }

  /** O paciente existe no cliente (a leitura de paciente inexistente é 404). */
  pacienteExiste(paciente: number): Promise<boolean> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'pep.notas' }, async (l) =>
      Boolean(await l.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [paciente])),
    );
  }

  /** O paciente dono da nota (o vínculo assistencial é conferido antes de gravar); null quando não existe. */
  pacienteDaNota(nota: number): Promise<number | null> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'pep.notas' }, async (l) => {
      const x = await l.uma('SELECT paciente_id FROM nota_paciente WHERE id = ? AND excluido_em IS NULL', [
        nota,
      ]);
      return x ? num(x['paciente_id']) : null;
    });
  }

  /** As notas que quem lê pode ver (autor, equipe do estabelecimento ou toda a rede), com os alertas em vigor. */
  async doPaciente(c: ContextoNotas, paciente: number): Promise<NotasDoPaciente> {
    const q = await this.quem(c);
    const agora = this.agora();
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'pep.notas', estabelecimento: q.estabelecimento },
      async (l) => {
        const linhas = await l.consultar(
          `SELECT n.id, n.versao, n.tipo_nota_paciente_id, t.descricao AS tipo_desc, t.exibe_como_alerta, n.texto,
                  n.visibilidade, n.registrada_em, n.valida_ate, n.situacao, n.autor_profissional_id,
                  pf.nome AS autor, n.estabelecimento_id, n.atendimento_id, n.cancelada_em, n.motivo_cancelamento
             FROM nota_paciente n
             JOIN tipo_nota_paciente t ON t.id = n.tipo_nota_paciente_id
             LEFT JOIN profissional p ON p.id = n.autor_profissional_id
             LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE n.paciente_id = ? AND n.excluido_em IS NULL
            ORDER BY n.registrada_em DESC, n.id DESC`,
          [paciente],
        );
        const leitor = { profissional: q.profissional, estabelecimento: q.estabelecimento };
        const notas: NotaLida[] = linhas
          .filter((x) =>
            notaVisivel(
              {
                visibilidade: String(x['visibilidade']),
                autorProfissionalId: num(x['autor_profissional_id']),
                estabelecimentoId: num(x['estabelecimento_id']),
              },
              leitor,
            ),
          )
          .map((x) => {
            const validaAte = dataDe(x['valida_ate']);
            const situacao = String(x['situacao']);
            return {
              id: num(x['id']),
              versao: num(x['versao']),
              tipo: { id: num(x['tipo_nota_paciente_id']), descricao: String(x['tipo_desc']) },
              texto: String(x['texto']),
              visibilidade: String(x['visibilidade']),
              registradaEm: iso(x['registrada_em']),
              validaAte: iso(x['valida_ate']),
              situacao: situacaoExibidaNota({ situacao, validaAte }, agora),
              alerta: notaAlerta(
                { situacao, validaAte, exibeComoAlerta: bool(x['exibe_como_alerta']) },
                agora,
              ),
              autor: txt(x['autor']),
              doAutor: q.profissional !== null && q.profissional === num(x['autor_profissional_id']),
              estabelecimentoId: num(x['estabelecimento_id']),
              atendimentoId: numOuNull(x['atendimento_id']),
              canceladaEm: iso(x['cancelada_em']),
              motivoCancelamento: txt(x['motivo_cancelamento']),
            };
          });
        const tipos = await l.consultar(
          'SELECT id, descricao, exibe_como_alerta FROM tipo_nota_paciente WHERE ativo = TRUE ORDER BY descricao, id',
        );
        const prontos = await l.consultar(
          `SELECT id, COALESCE(titulo_exibicao, descricao) AS titulo, texto FROM nota_predefinida
            WHERE ativo = TRUE AND aplicacao IN (${APLICACOES_TEXTO_NOTA.map(() => '?').join(',')})
              AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
              AND (profissional_id IS NULL OR profissional_id = ?)
            ORDER BY titulo, id LIMIT 200`,
          [...APLICACOES_TEXTO_NOTA, q.estabelecimento, q.profissional ?? 0],
        );
        return {
          notas,
          alertas: notas.filter((n) => n.alerta),
          tipos: tipos.map((t) => ({
            id: num(t['id']),
            descricao: String(t['descricao']),
            alerta: bool(t['exibe_como_alerta']),
          })),
          textosProntos: prontos.map((t) => ({
            id: num(t['id']),
            titulo: String(t['titulo']),
            texto: String(t['texto']),
          })),
          podeEscrever: q.profissional !== null,
        };
      },
    );
  }

  async gravarNota(c: ContextoGravacaoNotas, entrada: unknown) {
    const q = await this.quem(c);
    if (q.usuario === null)
      throw recusa('usuario-sem-conta', 'A gravação exige uma conta de usuário do cliente.');
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(this.opNota, this.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida };
  }

  private async gravar(tx: TxOperacao, e: EntradaNota, ctx: ContextoOperacao) {
    const agora = this.agora();
    const prof = await profDe(tx);
    const estabelecimento = Number(ctx.estabelecimento);
    if (e.acao === 'registrar') {
      const p = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [e.paciente]);
      if (!p)
        throw new ErroOperacao(
          404,
          'registro-inexistente',
          'Paciente não encontrado',
          'O paciente não existe.',
        );
      if (e.atendimento) {
        const a = await tx.uma('SELECT paciente_id FROM atendimento WHERE id = ? AND excluido_em IS NULL', [
          e.atendimento,
        ]);
        if (!a || num(a['paciente_id']) !== e.paciente)
          throw recusa('atendimento-de-outro-paciente', 'O atendimento não é deste paciente.');
      }
      const tipo = await tx.uma('SELECT ativo FROM tipo_nota_paciente WHERE id = ?', [e.tipo]);
      const pronto = e.predefinida
        ? await tx.uma(
            'SELECT ativo, aplicacao, estabelecimento_id, profissional_id FROM nota_predefinida WHERE id = ?',
            [e.predefinida],
          )
        : null;
      if (e.predefinida && !pronto)
        throw recusa('texto-pronto-inexistente', 'O texto pronto escolhido não existe.');
      const validaAte = e.validaAte ? new Date(e.validaAte) : null;
      const falhas = validarNovaNota(
        {
          texto: e.texto,
          validaAte,
          tipoAtivo: tipo ? bool(tipo['ativo']) : null,
          predefinida: pronto
            ? {
                ativo: bool(pronto['ativo']),
                aplicacao: String(pronto['aplicacao']),
                estabelecimentoId: numOuNull(pronto['estabelecimento_id']),
                profissionalId: numOuNull(pronto['profissional_id']),
              }
            : null,
          estabelecimento,
          autor: prof,
        },
        agora,
      );
      if (falhas.length) recusar(falhas);
      const nota = await tx.incluir('nota_paciente', {
        estabelecimento_id: estabelecimento,
        paciente_id: e.paciente,
        atendimento_id: e.atendimento ?? null,
        tipo_nota_paciente_id: e.tipo,
        nota_predefinida_id: e.predefinida ?? null,
        autor_profissional_id: prof,
        texto: e.texto.trim(),
        visibilidade: e.visibilidade,
        registrada_em: agora,
        valida_ate: validaAte,
        situacao: 'ativa',
        origem: 'sistema',
      });
      return { nota, situacao: 'ativa' };
    }
    const [n] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao, autor_profissional_id, visibilidade, estabelecimento_id
         FROM nota_paciente WHERE id = ? AND excluido_em IS NULL`,
      [e.nota],
      { teto: 1 },
    );
    if (!n) throw inexistente('A nota');
    // Quem não vê a nota não dá passo nenhum nela (nem fica sabendo que existe).
    const visivel = notaVisivel(
      {
        visibilidade: String(n['visibilidade']),
        autorProfissionalId: num(n['autor_profissional_id']),
        estabelecimentoId: num(n['estabelecimento_id']),
      },
      { profissional: prof, estabelecimento },
    );
    if (!visivel) throw inexistente('A nota');
    const versao = num(n['versao']);
    if (versao !== e.versao)
      throw new ErroOperacao(
        409,
        'conflito-versao',
        'Nota alterada por outra pessoa',
        'Recarregue a nota antes de seguir.',
      );
    const validaAte = e.validaAte ? new Date(e.validaAte) : null;
    const passo = passoNota(
      {
        acao: e.acao,
        situacao: String(n['situacao']),
        ehAutor: prof !== null && prof === num(n['autor_profissional_id']),
        motivo: e.motivo ?? null,
        validaAte,
      },
      agora,
    );
    if (passo.falhas.length) recusar(passo.falhas);
    if (e.acao === 'cancelar')
      await tx.alterar('nota_paciente', e.nota, versao, {
        situacao: 'cancelada',
        cancelada_em: agora,
        cancelada_profissional_id: prof,
        motivo_cancelamento: e.motivo!.trim(),
      } as never);
    else if (e.acao === 'encerrar')
      await tx.alterar('nota_paciente', e.nota, versao, { situacao: 'encerrada' } as never);
    else await tx.alterar('nota_paciente', e.nota, versao, { valida_ate: validaAte } as never);
    return { nota: e.nota, situacao: passo.situacaoNova };
  }
}
