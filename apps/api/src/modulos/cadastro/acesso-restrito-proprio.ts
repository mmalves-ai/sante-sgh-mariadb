// Paciente com acesso restrito ao prontuário no banco próprio (F8, 02-CAD linha 10). A marca em
// `paciente_acesso_restrito` (tipo, motivo, vigência, exibição do nome e se admite quebra de vidro; estabelecimento nulo
// vale em todos) e a liberação nominal em `liberacao_acesso_restrito` (profissional ou equipe, vigência, justificativa e
// quem autorizou). Encerrar a marca e revogar a liberação registram o fim: nada é apagado. A decisão de acesso é a do
// domínio (@sgh/dominio-cadastro, acesso-restrito); aqui a leitura do que ela precisa (marcas, liberações, profissional da
// conta, equipes em vigor, atendimento em curso e quebra de vidro vigente) e a gravação pelo executor (trilha e
// idempotência na mesma transação). O filtro comum das leituras clínicas (acesso-restrito.interceptor.ts) usa `decidir`.
import { randomUUID } from 'node:crypto';
import {
  type DesfechoAcessoRestrito,
  decidirAcessoRestrito,
  errosLiberacaoRestrita,
  errosMarcaRestrita,
  type LiberacaoRestrita,
  type MarcaRestrita,
  marcaViva,
} from '@sgh/dominio-cadastro';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from './porta.js';
import type { NucleoCadastro } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

export const ACESSO_RESTRITO = Symbol('ACESSO_RESTRITO');

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const doisDig = (n: number) => String(n).padStart(2, '0');
/** Instante local AAAA-MM-DDTHH:MM:SS (o banco guarda a hora local do estabelecimento). */
export function instanteLocal(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date)
    return `${v.getFullYear()}-${doisDig(v.getMonth() + 1)}-${doisDig(v.getDate())}T${doisDig(v.getHours())}:${doisDig(
      v.getMinutes(),
    )}:${doisDig(v.getSeconds())}`;
  return String(v).replace(' ', 'T').slice(0, 19);
}
const agoraLocal = (): string => instanteLocal(new Date())!;
/** Texto da tela (data ou data e hora) → DATETIME do banco. */
const paraBanco = (v: string): string =>
  v.length === 10 ? `${v} 00:00:00` : v.replace('T', ' ').slice(0, 19);

const MENSAGENS: Record<string, [string, string]> = {
  'tipo-invalido': ['Escolha o tipo da marca.', 'tipo'],
  'motivo-curto': ['Escreva o motivo com ao menos 10 letras.', 'motivo'],
  'motivo-longo': ['O motivo tem no máximo 500 letras.', 'motivo'],
  'exibicao-invalida': ['Escolha como o nome aparece.', 'exibicao'],
  'pseudonimo-ausente': ['Informe o pseudônimo (3 letras ou mais).', 'pseudonimo'],
  'pseudonimo-longo': ['O pseudônimo tem no máximo 150 letras.', 'pseudonimo'],
  'inicio-invalido': ['Informe um início válido.', 'inicio'],
  'fim-invalido': ['Informe um fim válido.', 'fim'],
  'fim-antes-do-inicio': ['O fim vem depois do início.', 'fim'],
  'marca-repetida': ['O paciente já tem uma marca deste tipo em vigor nesta abrangência.', 'tipo'],
  'destino-unico': ['Libere um profissional ou uma equipe (um dos dois).', 'profissionalId'],
  'justificativa-curta': ['Escreva a justificativa com ao menos 10 letras.', 'justificativa'],
  'justificativa-longa': ['A justificativa tem no máximo 500 letras.', 'justificativa'],
  'marca-encerrada': ['A marca já foi encerrada: não recebe liberação.', 'marca'],
  'alem-da-marca': ['A liberação termina até o fim da marca.', 'fim'],
  'liberacao-repetida': ['Este destino já está liberado a partir deste início.', 'profissionalId'],
  'profissional-inexistente': ['Profissional não encontrado ou inativo.', 'profissionalId'],
  'equipe-inexistente': ['Equipe não encontrada neste estabelecimento.', 'equipeId'],
  'paciente-inexistente': ['Paciente não encontrado.', 'paciente'],
  'ja-encerrada': ['A marca já está encerrada.', 'marca'],
  'ja-revogada': ['A liberação já terminou.', 'liberacao'],
};
function recusarErros(erros: readonly string[]): void {
  if (!erros.length) return;
  throw recusa(erros[0]!, erros.map((e) => MENSAGENS[e]?.[0] ?? e).join(' '), {
    campos: [...new Set(erros.map((e) => MENSAGENS[e]?.[1] ?? e))],
  });
}
const naoAchado = (o: string) =>
  new ErroOperacao(404, `${o}-inexistente`, 'Não encontrado', 'Registro não encontrado.');

const idPos = z.number().int().positive();
const instanteTxt = z.string().max(19);

// ---------------------------------------------------------------- marca
const esquemaMarca = z
  .object({
    paciente: idPos,
    todosEstabelecimentos: z.boolean(),
    tipo: z.string().max(30),
    motivo: z.string().max(600),
    exibicao: z.string().max(20),
    pseudonimo: z.string().max(200).nullable(),
    exigeQuebraVidro: z.boolean(),
    inicio: instanteTxt,
    fim: instanteTxt.nullable(),
  })
  .strict();
export type EntradaMarcaTela = z.infer<typeof esquemaMarca>;

const opMarcar = (t: RegistroTrilhaTela, est: number, usuario: number) =>
  definirOperacao({
    nome: 'cadastro.acesso-restrito.marcar',
    tabelas: ['paciente_acesso_restrito'],
    entrada: esquemaMarca,
    acao: 'inclusao',
    async gravar(tx, e) {
      recusarErros(errosMarcaRestrita(e));
      if (!(await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [e.paciente])))
        recusarErros(['paciente-inexistente']);
      const abrangencia = e.todosEstabelecimentos ? null : est;
      const ativas = await tx.consultarParaAtualizar(
        `SELECT id, estabelecimento_id, vigencia_inicio, vigencia_fim FROM paciente_acesso_restrito
          WHERE paciente_id = ? AND tipo_marca = ? AND situacao = 'ativa' AND excluido_em IS NULL`,
        [e.paciente, e.tipo],
      );
      const fimNovo = e.fim === null ? null : paraBanco(e.fim);
      const inicioNovo = paraBanco(e.inicio);
      if (
        ativas.some((a) => {
          if (num(a['estabelecimento_id']) !== abrangencia) return false;
          const fimA = instanteLocal(a['vigencia_fim']);
          const iniA = instanteLocal(a['vigencia_inicio'])!;
          return (
            (fimA === null || fimA.replace('T', ' ') > inicioNovo) &&
            (fimNovo === null || fimNovo > iniA.replace('T', ' '))
          );
        })
      )
        recusarErros(['marca-repetida']);
      const pseudonimo =
        e.exibicao === 'pseudonimo' ? (e.pseudonimo ?? '').trim().replace(/\s+/g, ' ') : null;
      const id = await tx.incluir('paciente_acesso_restrito', {
        paciente_id: e.paciente,
        estabelecimento_id: abrangencia,
        tipo_marca: e.tipo,
        motivo: e.motivo.trim(),
        vigencia_inicio: inicioNovo,
        vigencia_fim: fimNovo,
        exibicao_nome: e.exibicao,
        pseudonimo,
        exige_quebra_vidro: e.exigeQuebraVidro,
        solicitante_usuario_id: usuario,
        situacao: 'ativa',
        origem: 'sistema',
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'paciente_acesso_restrito', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaEncerrar = z.object({ id: idPos, versao: idPos, motivo: z.string().max(500) }).strict();
export type EntradaEncerrarMarca = z.infer<typeof esquemaEncerrar>;

const opEncerrar = (t: RegistroTrilhaTela, est: number, agora: string) =>
  definirOperacao({
    nome: 'cadastro.acesso-restrito.encerrar',
    tabelas: ['paciente_acesso_restrito'],
    entrada: esquemaEncerrar,
    acao: 'alteracao',
    async gravar(tx, e) {
      if (e.motivo.trim().length < 10) recusarErros(['motivo-curto']);
      const [m] = await tx.consultarParaAtualizar(
        `SELECT situacao, vigencia_inicio FROM paciente_acesso_restrito
          WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?) AND excluido_em IS NULL`,
        [e.id, est],
      );
      if (!m) throw naoAchado('marca');
      if (String(m['situacao']) !== 'ativa') recusarErros(['ja-encerrada']);
      const ini = instanteLocal(m['vigencia_inicio'])!;
      // Marca futura encerrada antes de começar: o fim é o próprio início (a vigência fica vazia, o registro fica).
      const fim = agora < ini ? ini : agora;
      await tx.alterar('paciente_acesso_restrito', e.id, e.versao, {
        situacao: 'encerrada',
        vigencia_fim: fim.replace('T', ' '),
      });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'paciente_acesso_restrito', id: e.id }),
    trilha: (e) => ({ dados: t.dadosDepois ?? null, motivo: e.motivo.trim() }),
  });

// ---------------------------------------------------------------- liberação nominal
const esquemaLiberacao = z
  .object({
    marca: idPos,
    profissionalId: idPos.nullable(),
    equipeId: idPos.nullable(),
    justificativa: z.string().max(600),
    inicio: instanteTxt,
    fim: instanteTxt.nullable(),
  })
  .strict();
export type EntradaLiberacaoTela = z.infer<typeof esquemaLiberacao>;

const opLiberar = (t: RegistroTrilhaTela, est: number, usuario: number) =>
  definirOperacao({
    nome: 'cadastro.acesso-restrito.liberar',
    tabelas: ['liberacao_acesso_restrito', 'paciente_acesso_restrito'],
    entrada: esquemaLiberacao,
    acao: 'inclusao',
    async gravar(tx, e) {
      const [m] = await tx.consultarParaAtualizar(
        `SELECT situacao, vigencia_inicio, vigencia_fim FROM paciente_acesso_restrito
          WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?) AND excluido_em IS NULL`,
        [e.marca, est],
      );
      if (!m) throw naoAchado('marca');
      recusarErros(
        errosLiberacaoRestrita(e, {
          situacao: String(m['situacao']),
          inicio: instanteLocal(m['vigencia_inicio'])!,
          fim: instanteLocal(m['vigencia_fim']),
        }),
      );
      if (
        e.profissionalId !== null &&
        !(await tx.uma(
          "SELECT id FROM profissional WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
          [e.profissionalId],
        ))
      )
        recusarErros(['profissional-inexistente']);
      if (
        e.equipeId !== null &&
        !(await tx.uma(
          'SELECT id FROM equipe_profissional WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
          [e.equipeId, est],
        ))
      )
        recusarErros(['equipe-inexistente']);
      const inicio = paraBanco(e.inicio);
      const dup = await tx.uma(
        `SELECT id FROM liberacao_acesso_restrito WHERE paciente_acesso_restrito_id = ? AND vigencia_inicio = ?
           AND profissional_id <=> ? AND equipe_profissional_id <=> ?`,
        [e.marca, inicio, e.profissionalId, e.equipeId],
      );
      if (dup) recusarErros(['liberacao-repetida']);
      const id = await tx.incluir('liberacao_acesso_restrito', {
        paciente_acesso_restrito_id: e.marca,
        profissional_id: e.profissionalId,
        equipe_profissional_id: e.equipeId,
        vigencia_inicio: inicio,
        vigencia_fim: e.fim === null ? null : paraBanco(e.fim),
        justificativa: e.justificativa.trim(),
        autorizador_usuario_id: usuario,
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'liberacao_acesso_restrito', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaRevogar = z.object({ id: idPos, versao: idPos }).strict();

const opRevogar = (t: RegistroTrilhaTela, est: number, agora: string) =>
  definirOperacao({
    nome: 'cadastro.acesso-restrito.revogar',
    tabelas: ['liberacao_acesso_restrito'],
    entrada: esquemaRevogar,
    acao: 'alteracao',
    async gravar(tx, e) {
      const [l] = await tx.consultarParaAtualizar(
        `SELECT l.vigencia_inicio, l.vigencia_fim FROM liberacao_acesso_restrito l
           JOIN paciente_acesso_restrito m ON m.id = l.paciente_acesso_restrito_id
          WHERE l.id = ? AND (m.estabelecimento_id IS NULL OR m.estabelecimento_id = ?) AND l.excluido_em IS NULL`,
        [e.id, est],
      );
      if (!l) throw naoAchado('liberacao');
      const fimAtual = instanteLocal(l['vigencia_fim']);
      if (fimAtual !== null && fimAtual <= agora) recusarErros(['ja-revogada']);
      const ini = instanteLocal(l['vigencia_inicio'])!;
      await tx.alterar('liberacao_acesso_restrito', e.id, e.versao, {
        vigencia_fim: (agora < ini ? ini : agora).replace('T', ' '),
      });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'liberacao_acesso_restrito', id: e.id }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

// ---------------------------------------------------------------- visão
export interface LiberacaoVisao {
  id: number;
  versao: number;
  profissionalId: number | null;
  equipeId: number | null;
  destino: string;
  justificativa: string;
  inicio: string;
  fim: string | null;
  vigente: boolean;
}
export interface MarcaVisao {
  id: number;
  versao: number;
  tipo: string;
  motivo: string;
  todosEstabelecimentos: boolean;
  exibicao: string;
  pseudonimo: string | null;
  exigeQuebraVidro: boolean;
  situacao: string;
  inicio: string;
  fim: string | null;
  viva: boolean;
  liberacoes: LiberacaoVisao[];
}
export interface VisaoAcessoRestrito {
  paciente: { id: number; nome: string; prontuario: string | null };
  marcas: MarcaVisao[];
}
export interface PacienteRestritoResumo {
  paciente: number;
  nome: string;
  tipos: string[];
  liberacoes: number;
}
export interface DecisaoRestrito {
  desfecho: DesfechoAcessoRestrito;
  marcas: number[];
}

export class AcessoRestritoProprio {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCadastro,
    private readonly cliente: string,
    executor?: Executor,
    private readonly agora: () => string = agoraLocal,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(correlacao: string, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: correlacao || 'acesso-restrito' }, fn);
  }

  private async estabelecimento(c: ContextoPorta): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const r = c.hospital
      ? await this.ler(c.correlacao, (l) =>
          l.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
            c.hospital,
          ]),
        )
      : null;
    if (!r)
      throw new ErroOperacao(
        403,
        'sem-estabelecimento',
        'Sem estabelecimento',
        'A sessão não tem estabelecimento.',
      );
    return Number(r.id);
  }

  private async executar<E>(
    c: ContextoPorta,
    op: Parameters<Executor['executar']>[0],
    entrada: E,
    t: RegistroTrilhaTela,
    est: number,
  ): Promise<number> {
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: t.estabelecimento ?? est,
      usuario: t.usuario ?? c.usuario,
      correlacao: (t.correlacao ?? c.correlacao).slice(0, 64) || 'acesso-restrito',
      chaveIdempotencia: `direta:${randomUUID()}`,
    };
    const x = await this.executor.executar(op, this.cliente, entrada, ctx);
    return Number((x.resultado as Record<string, unknown>)['id']);
  }

  private usuarioDe(c: ContextoPorta, t: RegistroTrilhaTela): number {
    const u = t.usuario ?? c.usuario;
    if (u === null || u === undefined)
      throw new ErroOperacao(403, 'sessao-sem-conta', 'Sem conta', 'A sessão não tem conta no cliente.');
    return Number(u);
  }

  /** Marcas do paciente (todas, vivas e encerradas) com as liberações, deste estabelecimento ou de todos. */
  async visao(c: ContextoPorta, paciente: number): Promise<VisaoAcessoRestrito> {
    const est = await this.estabelecimento(c);
    const agora = this.agora();
    return this.ler(c.correlacao, async (l) => {
      const p = await l.uma(
        `SELECT p.id, pf.nome, p.numero_prontuario FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE p.id = ? AND p.excluido_em IS NULL`,
        [paciente],
      );
      if (!p) throw naoAchado('paciente');
      const ms = await l.consultar(
        `SELECT id, versao, tipo_marca, motivo, estabelecimento_id, exibicao_nome, pseudonimo, exige_quebra_vidro, situacao,
                vigencia_inicio, vigencia_fim
           FROM paciente_acesso_restrito
          WHERE paciente_id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?) AND excluido_em IS NULL
          ORDER BY situacao = 'ativa' DESC, vigencia_inicio DESC, id DESC LIMIT 200`,
        [paciente, est],
        { teto: 200 },
      );
      const ids = ms.map((m) => Number(m['id']));
      const ls = ids.length
        ? await l.consultar(
            `SELECT l.id, l.versao, l.paciente_acesso_restrito_id, l.profissional_id, l.equipe_profissional_id,
                    l.justificativa, l.vigencia_inicio, l.vigencia_fim,
                    COALESCE(pr.nome_exibicao, pfp.nome, eq.nome) AS destino
               FROM liberacao_acesso_restrito l
               LEFT JOIN profissional pr ON pr.id = l.profissional_id
               LEFT JOIN pessoa_fisica pfp ON pfp.id = pr.pessoa_fisica_id
               LEFT JOIN equipe_profissional eq ON eq.id = l.equipe_profissional_id
              WHERE l.paciente_acesso_restrito_id IN (${ids.map(() => '?').join(',')}) AND l.excluido_em IS NULL
              ORDER BY l.vigencia_inicio DESC, l.id DESC`,
            ids,
            { teto: 2000 },
          )
        : [];
      const marcas: MarcaVisao[] = ms.map((m) => {
        const base: MarcaRestrita = {
          id: Number(m['id']),
          estabelecimentoId: num(m['estabelecimento_id']),
          situacao: String(m['situacao']),
          inicio: instanteLocal(m['vigencia_inicio'])!,
          fim: instanteLocal(m['vigencia_fim']),
          exigeQuebraVidro: bool(m['exige_quebra_vidro']),
        };
        return {
          id: base.id,
          versao: Number(m['versao']),
          tipo: String(m['tipo_marca']),
          motivo: String(m['motivo']),
          todosEstabelecimentos: base.estabelecimentoId === null,
          exibicao: String(m['exibicao_nome']),
          pseudonimo: m['pseudonimo'] === null ? null : String(m['pseudonimo']),
          exigeQuebraVidro: base.exigeQuebraVidro,
          situacao: base.situacao,
          inicio: base.inicio,
          fim: base.fim,
          viva: marcaViva(base, agora, est),
          liberacoes: ls
            .filter((x) => Number(x['paciente_acesso_restrito_id']) === base.id)
            .map((x) => {
              const inicio = instanteLocal(x['vigencia_inicio'])!;
              const fim = instanteLocal(x['vigencia_fim']);
              return {
                id: Number(x['id']),
                versao: Number(x['versao']),
                profissionalId: num(x['profissional_id']),
                equipeId: num(x['equipe_profissional_id']),
                destino: String(x['destino'] ?? ''),
                justificativa: String(x['justificativa']),
                inicio,
                fim,
                vigente: inicio <= agora && (fim === null || fim > agora),
              };
            }),
        };
      });
      return {
        paciente: {
          id: paciente,
          nome: String(p['nome']),
          prontuario: p['numero_prontuario'] === null ? null : String(p['numero_prontuario']),
        },
        marcas,
      };
    });
  }

  /** Pacientes com marca viva neste estabelecimento (painel de quem administra a restrição). */
  async pacientes(c: ContextoPorta): Promise<PacienteRestritoResumo[]> {
    const est = await this.estabelecimento(c);
    return this.ler(c.correlacao, async (l) =>
      (
        await l.consultar(
          `SELECT m.paciente_id, pf.nome, GROUP_CONCAT(DISTINCT m.tipo_marca ORDER BY m.tipo_marca) AS tipos,
                  (SELECT COUNT(*) FROM liberacao_acesso_restrito x
                     JOIN paciente_acesso_restrito y ON y.id = x.paciente_acesso_restrito_id
                    WHERE y.paciente_id = m.paciente_id AND x.excluido_em IS NULL
                      AND x.vigencia_inicio <= NOW(3) AND (x.vigencia_fim IS NULL OR x.vigencia_fim > NOW(3))) AS liberacoes
             FROM paciente_acesso_restrito m
             JOIN paciente p ON p.id = m.paciente_id
             JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE m.situacao = 'ativa' AND m.excluido_em IS NULL AND (m.estabelecimento_id IS NULL OR m.estabelecimento_id = ?)
              AND m.vigencia_inicio <= NOW(3) AND (m.vigencia_fim IS NULL OR m.vigencia_fim > NOW(3))
            GROUP BY m.paciente_id, pf.nome
            ORDER BY pf.nome, m.paciente_id
            LIMIT 500`,
          [est],
          { teto: 500 },
        )
      ).map((x) => ({
        paciente: Number(x['paciente_id']),
        nome: String(x['nome']),
        tipos: String(x['tipos'] ?? '')
          .split(',')
          .filter(Boolean),
        liberacoes: Number(x['liberacoes'] ?? 0),
      })),
    );
  }

  /** Profissionais ativos e equipes do estabelecimento pelo nome (destino da liberação). */
  async destinos(c: ContextoPorta, busca: string) {
    const est = await this.estabelecimento(c);
    const termo = `%${busca.trim().replace(/[%_]/g, '')}%`;
    if (busca.trim().length < 3) return { profissionais: [], equipes: [] };
    return this.ler(c.correlacao, async (l) => ({
      profissionais: (
        await l.consultar(
          `SELECT pr.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome FROM profissional pr
             JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
            WHERE pr.situacao = 'ativo' AND pr.excluido_em IS NULL AND (pf.nome LIKE ? OR pr.nome_exibicao LIKE ?)
            ORDER BY nome LIMIT 20`,
          [termo, termo],
          { teto: 20 },
        )
      ).map((x) => ({ id: Number(x['id']), nome: String(x['nome']) })),
      equipes: (
        await l.consultar(
          `SELECT id, nome FROM equipe_profissional
            WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL AND (nome LIKE ? OR codigo LIKE ?)
            ORDER BY nome LIMIT 20`,
          [est, termo, termo],
          { teto: 20 },
        )
      ).map((x) => ({ id: Number(x['id']), nome: String(x['nome']) })),
    }));
  }

  async marcar(c: ContextoPorta, e: EntradaMarcaTela, t: RegistroTrilhaTela): Promise<number> {
    const est = await this.estabelecimento(c);
    return this.executar(c, opMarcar(t, est, this.usuarioDe(c, t)), e, t, est);
  }

  async encerrar(c: ContextoPorta, e: EntradaEncerrarMarca, t: RegistroTrilhaTela): Promise<number> {
    const est = await this.estabelecimento(c);
    return this.executar(c, opEncerrar(t, est, this.agora()), e, t, est);
  }

  async liberar(c: ContextoPorta, e: EntradaLiberacaoTela, t: RegistroTrilhaTela): Promise<number> {
    const est = await this.estabelecimento(c);
    return this.executar(c, opLiberar(t, est, this.usuarioDe(c, t)), e, t, est);
  }

  async revogar(c: ContextoPorta, e: { id: number; versao: number }, t: RegistroTrilhaTela): Promise<number> {
    const est = await this.estabelecimento(c);
    return this.executar(c, opRevogar(t, est, this.agora()), e, t, est);
  }

  /** Paciente do atendimento (o filtro das rotas por atendimento). */
  async pacienteDoAtendimento(atendimento: number): Promise<number | null> {
    const r = await this.ler('acesso-restrito-atendimento', (l) =>
      l.uma('SELECT paciente_id FROM atendimento WHERE id = ?', [atendimento]),
    );
    return r ? Number(r['paciente_id']) : null;
  }

  /**
   * Paciente de um recurso clínico (o filtro das rotas que trazem o atendimento, a internação, o agendamento ou o ato
   * cirúrgico em vez do paciente). Recurso inexistente: null (a rota segue e responde o seu próprio 404).
   */
  async pacienteDoRecurso(
    tipo: 'atendimento' | 'internacao' | 'agendamento-cirurgico' | 'ato-cirurgico',
    id: number,
  ): Promise<number | null> {
    const r = await this.ler('acesso-restrito-recurso', (l) => {
      switch (tipo) {
        case 'atendimento':
          return l.uma('SELECT paciente_id FROM atendimento WHERE id = ?', [id]);
        case 'internacao':
          return l.uma('SELECT paciente_id FROM internacao WHERE id = ?', [id]);
        case 'agendamento-cirurgico':
          return l.uma('SELECT paciente_id FROM agendamento_cirurgico WHERE id = ?', [id]);
        case 'ato-cirurgico':
          return l.uma('SELECT paciente_id FROM ato_cirurgico WHERE id = ?', [id]);
      }
    });
    return r ? Number(r['paciente_id']) : null;
  }

  /**
   * A decisão do domínio para a conta (pelo login) sobre o paciente, no estabelecimento da sessão (pelo código). Sem
   * marca viva (o caso comum), uma só leitura. `plataforma`: o administrador da plataforma (pode tudo).
   */
  async decidir(a: {
    hospital: string;
    login: string;
    paciente: number;
    plataforma: boolean;
  }): Promise<DecisaoRestrito> {
    const agora = this.agora();
    return this.ler('acesso-restrito-decisao', async (l) => {
      const ms = await l.consultar(
        `SELECT m.id, m.estabelecimento_id, m.situacao, m.vigencia_inicio, m.vigencia_fim, m.exige_quebra_vidro
           FROM paciente_acesso_restrito m
          WHERE m.paciente_id = ? AND m.situacao = 'ativa' AND m.excluido_em IS NULL`,
        [a.paciente],
        { teto: 200 },
      );
      if (!ms.length) return { desfecho: 'livre', marcas: [] };
      const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        a.hospital,
      ]);
      const est = e ? Number(e['id']) : 0;
      const marcas: MarcaRestrita[] = ms.map((m) => ({
        id: Number(m['id']),
        estabelecimentoId: num(m['estabelecimento_id']),
        situacao: String(m['situacao']),
        inicio: instanteLocal(m['vigencia_inicio'])!,
        fim: instanteLocal(m['vigencia_fim']),
        exigeQuebraVidro: bool(m['exige_quebra_vidro']),
      }));
      const vivas = marcas.filter((m) => marcaViva(m, agora, est));
      if (!vivas.length) return { desfecho: 'livre', marcas: [] };
      const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [a.login]);
      const usuario = u ? Number(u['id']) : null;
      const prof = usuario
        ? await l.uma('SELECT profissional_id FROM usuario_profissional WHERE usuario_vigente_id = ?', [
            usuario,
          ])
        : null;
      const profissional = prof ? Number(prof['profissional_id']) : null;
      const ids = vivas.map((m) => m.id);
      const libs = (
        await l.consultar(
          `SELECT paciente_acesso_restrito_id, profissional_id, equipe_profissional_id, vigencia_inicio, vigencia_fim
             FROM liberacao_acesso_restrito
            WHERE paciente_acesso_restrito_id IN (${ids.map(() => '?').join(',')}) AND excluido_em IS NULL`,
          ids,
          { teto: 2000 },
        )
      ).map((x): LiberacaoRestrita => ({
        marcaId: Number(x['paciente_acesso_restrito_id']),
        profissionalId: num(x['profissional_id']),
        equipeId: num(x['equipe_profissional_id']),
        inicio: instanteLocal(x['vigencia_inicio'])!,
        fim: instanteLocal(x['vigencia_fim']),
      }));
      const hoje = agora.slice(0, 10);
      const equipes =
        profissional === null
          ? []
          : (
              await l.consultar(
                `SELECT equipe_profissional_id FROM equipe_profissional_membro
                  WHERE profissional_id = ? AND excluido_em IS NULL AND vigencia_inicio <= ?
                    AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
                [profissional, hoje, hoje],
                { teto: 500 },
              )
            ).map((x) => Number(x['equipe_profissional_id']));
      const atende =
        profissional !== null &&
        !!(await l.uma(
          `SELECT id FROM atendimento WHERE paciente_id = ? AND estabelecimento_id = ?
              AND situacao IN ('aberto','em_atendimento','em_observacao') AND (profissional_id = ? OR alta_profissional_id = ?)
            LIMIT 1`,
          [a.paciente, est, profissional, profissional],
        ));
      const emergencia =
        usuario !== null &&
        !!(await l.uma(
          `SELECT id FROM acesso_emergencial WHERE usuario_id = ? AND paciente_id = ? AND situacao = 'ativo'
              AND excluido_em IS NULL AND fim_em > NOW(3) LIMIT 1`,
          [usuario, a.paciente],
        ));
      return decidirAcessoRestrito(
        marcas,
        libs,
        {
          profissionalId: profissional,
          equipes,
          atendeAgora: atende,
          emergenciaVigente: emergencia,
          plataforma: a.plataforma,
        },
        agora,
        est,
      );
    });
  }
}
