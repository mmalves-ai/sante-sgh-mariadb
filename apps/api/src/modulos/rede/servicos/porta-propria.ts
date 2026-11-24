// Porta PRÓPRIA do registro de serviços compartilhados da Rede (M57, etapa 3) sobre o banco do cliente, pelo @sgh/nucleo.
// As tabelas do registro (oportunidades de serviço compartilhado entre os estabelecimentos; não é o rateio
// `regra_servico_compartilhado` do financeiro) entraram no modelo na integração da onda 2 (02_ADM/06):
// `servico_compartilhado_rede` (o registro, do estabelecimento de quem registrou) e
// `servico_compartilhado_rede_estabelecimento` (os estabelecimentos envolvidos, um por linha).
// Um banco por cliente: o "banco do estabelecimento" do contrato é o recorte `estabelecimento_id` do registro; a porta lê
// ou grava SÓ os registros do estabelecimento do contexto (a junção da Rede continua no serviço).
// Leituras: somente leitura (lerSomente), com o teto do contrato. Gravações: sempre pelo Executor, uma operação por
// chamada (a linha da trilha e a idempotência na mesma transação). SQL parametrizado; nomes literais.
// Melhoria: os envolvidos numa tabela filha (um por linha, com a chave única do par), no lugar de uma lista de códigos
// separada por vírgula; tirar um envolvido é exclusão lógica (a linha fica, com excluido_em) e devolvê-lo reativa a
// mesma linha; situação, área e título com CHECK; quem registrou e quem alterou são o usuário (id), não um login em texto.
// Melhoria: alterar sem mudança nenhuma não grava (nem versão, nem trilha), como a porta em memória.
import { randomUUID } from 'node:crypto';
import type { AreaServicoCompartilhado, SituacaoServicoCompartilhado } from '@sgh/contratos';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { TrilhaRede } from '../tipos-indice.js';
import type { ContextoServicosRede, PortaServicosRede } from './porta.js';
import type {
  FiltroServicosRede,
  MudancaServicoParaGravar,
  NovoServicoParaGravar,
  ServicoCompartilhadoLido,
} from './tipos.js';
import { TETO_SERVICOS_POR_BANCO } from './tipos.js';

/** Recusa da porta montada sem o núcleo (montagem antiga, até a ligação no módulo). */
export function recusaServicosPendente(operacao: string): ErroOperacao {
  return new ErroOperacao(
    501,
    'pendente-modelo-proprio',
    'Ainda não disponível no banco próprio',
    `O registro de serviços compartilhados da Rede (${operacao}) aguarda a tabela no modelo do cliente.`,
  );
}

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoServicosRede {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

const TABELA = 'servico_compartilhado_rede';
const TABELA_ENV = 'servico_compartilhado_rede_estabelecimento';

const numero = (v: unknown): number => Number(v);
const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
/** DATETIME(3) do banco (Date em UTC ou texto) → ISO sem fuso, com milissegundos (o formato da porta em memória). */
function instante(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 23);
  const s = String(v).replace(' ', 'T');
  return /\.\d{3}$/.test(s) ? s : `${s.slice(0, 19)}.000`;
}
const instanteOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : instante(v));
/** LIKE literal: escapa os curingas da busca. */
const semCuringa = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

function recusaEntrada(titulo: string, detalhe: string, campos: string[]): ErroOperacao {
  return new ErroOperacao(400, 'entrada-invalida', titulo, detalhe, { campos });
}

const SELECT_REGISTRO = `
  SELECT s.id, s.area, s.titulo, s.descricao, s.situacao, s.registrado_em, s.alterado_em, s.versao,
         ur.login AS registrado_por, ua.login AS alterado_por
    FROM ${TABELA} s
    LEFT JOIN usuario ur ON ur.id = s.registrado_por_usuario_id
    LEFT JOIN usuario ua ON ua.id = s.alterado_por`;

interface RegistroLinha {
  readonly lido: ServicoCompartilhadoLido;
  readonly versao: number;
}

/** Linhas do registro + envolvidos (códigos) → negócio. */
function paraLido(est: string, x: Linha, envolvidos: readonly string[]): RegistroLinha {
  return {
    versao: numero(x['versao']),
    lido: {
      estabelecimento: est,
      id: numero(x['id']),
      area: String(x['area']) as AreaServicoCompartilhado,
      titulo: String(x['titulo']),
      descricao: textoOuNulo(x['descricao']),
      estabelecimentos: envolvidos,
      situacao: String(x['situacao']) as SituacaoServicoCompartilhado,
      registradoPor: (textoOuNulo(x['registrado_por']) ?? '').slice(0, 31),
      registradoEm: instante(x['registrado_em']),
      atualizadoPor: x['alterado_em'] == null ? null : (textoOuNulo(x['alterado_por']) ?? '').slice(0, 31),
      atualizadoEm: instanteOuNulo(x['alterado_em']),
    },
  };
}

/** Consulta de leitura (Leitor) ou dentro da transação (TxOperacao): as duas têm `consultar`. */
type Consulta = Pick<Leitor, 'consultar'>;

async function envolvidosDe(q: Consulta, ids: readonly number[]): Promise<Map<number, string[]>> {
  const m = new Map<number, string[]>();
  if (ids.length === 0) return m;
  const linhas = await q.consultar(
    `SELECT v.servico_compartilhado_rede_id AS servico, e.codigo
       FROM ${TABELA_ENV} v JOIN estabelecimento e ON e.id = v.estabelecimento_id
      WHERE v.servico_compartilhado_rede_id IN (${ids.map(() => '?').join(', ')}) AND v.excluido_em IS NULL
      ORDER BY v.servico_compartilhado_rede_id, e.codigo`,
    ids,
    { teto: ids.length * 20 },
  );
  for (const x of linhas) {
    const k = numero(x['servico']);
    const l = m.get(k) ?? [];
    l.push(String(x['codigo']));
    m.set(k, l);
  }
  return m;
}

async function lerUm(
  q: Consulta,
  est: { id: number; codigo: string },
  id: number,
): Promise<RegistroLinha | null> {
  const [x] = await q.consultar(
    `${SELECT_REGISTRO} WHERE s.id = ? AND s.estabelecimento_id = ? AND s.excluido_em IS NULL`,
    [id, est.id],
    { teto: 1 },
  );
  if (!x) return null;
  const env = await envolvidosDe(q, [id]);
  return paraLido(est.codigo, x, env.get(id) ?? []);
}

const esquemaRegistro = z.object({
  estabelecimento: z.number().int().positive(),
  area: z.string(),
  titulo: z.string(),
  descricao: z.string().nullable(),
  envolvidos: z.array(z.number().int().positive()),
  por: z.string(),
});
const esquemaAlteracao = z.object({
  id: z.number().int().positive(),
  estabelecimento: z.number().int().positive(),
  versao: z.number().int().positive(),
  valores: z.record(z.string(), z.unknown()),
  envolvidos: z.array(z.number().int().positive()).nullable(),
});

export class PortaServicosRedePropria implements PortaServicosRede {
  readonly destino = 'proprio' as const;
  private readonly executor: Executor | null;
  private readonly nucleo: NucleoServicosRede | null;
  private readonly cliente: string;

  /** Sem o núcleo e o cliente (montagem antiga), toda chamada recusa com 501 `pendente-modelo-proprio`. */
  constructor(
    nucleo?: NucleoServicosRede,
    cliente?: string,
    executor?: Executor,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.nucleo = nucleo && cliente ? nucleo : null;
    this.cliente = cliente ?? '';
    this.executor = this.nucleo ? (executor ?? this.nucleo.criarExecutor()) : null;
  }

  private montada(operacao: string): { nucleo: NucleoServicosRede; executor: Executor } {
    if (!this.nucleo || !this.executor) throw recusaServicosPendente(operacao);
    return { nucleo: this.nucleo, executor: this.executor };
  }

  private leitura<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.montada('leitura').nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'rede-servicos' },
      fn,
    );
  }

  /** Estabelecimento do contexto (código → id); fora do cliente: 403. */
  private async estabelecimento(l: Consulta, codigo: string): Promise<{ id: number; codigo: string }> {
    const [x] = await l.consultar(
      'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      [codigo],
      { teto: 1 },
    );
    if (!x)
      throw new ErroOperacao(403, 'fora-da-rede', 'Fora da rede', 'O estabelecimento não é deste cliente.');
    return { id: numero(x['id']), codigo };
  }

  /** Códigos dos envolvidos → ids (código desconhecido no cliente: 400, nada gravado). */
  private async idsEnvolvidos(l: Consulta, codigos: readonly string[]): Promise<number[]> {
    const unicos = [...new Set(codigos)];
    if (unicos.length === 0)
      throw recusaEntrada('Sem estabelecimento', 'Escolha ao menos um estabelecimento.', [
        'estabelecimentos',
      ]);
    const linhas = await l.consultar(
      `SELECT id, codigo FROM estabelecimento WHERE excluido_em IS NULL AND codigo IN (${unicos.map(() => '?').join(', ')})`,
      unicos,
      { teto: unicos.length },
    );
    const por = new Map(linhas.map((x) => [String(x['codigo']), numero(x['id'])]));
    const faltam = unicos.filter((k) => !por.has(k));
    if (faltam.length > 0)
      throw recusaEntrada(
        'Estabelecimento fora da rede',
        'Os estabelecimentos envolvidos têm de ser deste cliente.',
        ['estabelecimentos'],
      );
    return unicos.map((k) => por.get(k)!);
  }

  async listar(
    c: ContextoServicosRede,
    f: FiltroServicosRede,
  ): Promise<{ itens: ServicoCompartilhadoLido[]; total: number }> {
    return this.leitura(async (l) => {
      const est = await this.estabelecimento(l, c.hospital);
      const onde = ['s.estabelecimento_id = ?', 's.excluido_em IS NULL'];
      const p: unknown[] = [est.id];
      if (f.area) {
        onde.push('s.area = ?');
        p.push(f.area);
      }
      if (f.situacao) {
        onde.push('s.situacao = ?');
        p.push(f.situacao);
      }
      const busca = f.busca?.trim();
      if (busca) {
        // Sem diferença de maiúsculas: LOWER dos dois lados (independe da colação da coluna).
        onde.push(
          "(LOWER(s.titulo) LIKE ? ESCAPE '\\\\' OR LOWER(COALESCE(s.descricao, '')) LIKE ? ESCAPE '\\\\')",
        );
        const termo = `%${semCuringa(busca.toLocaleLowerCase('pt-BR'))}%`;
        p.push(termo, termo);
      }
      const where = onde.join(' AND ');
      const [t] = await l.consultar(`SELECT COUNT(*) AS n FROM ${TABELA} s WHERE ${where}`, p, { teto: 1 });
      const ate = Math.max(0, Math.min(Math.trunc(f.ate), TETO_SERVICOS_POR_BANCO));
      const linhas =
        ate === 0
          ? []
          : await l.consultar(
              `${SELECT_REGISTRO} WHERE ${where} ORDER BY s.registrado_em DESC, s.id DESC LIMIT ${ate}`,
              p,
              { teto: ate },
            );
      const env = await envolvidosDe(
        l,
        linhas.map((x) => numero(x['id'])),
      );
      return {
        itens: linhas.map((x) => paraLido(est.codigo, x, env.get(numero(x['id'])) ?? []).lido),
        total: numero(t?.['n'] ?? 0),
      };
    });
  }

  async ler(c: ContextoServicosRede, id: number): Promise<ServicoCompartilhadoLido | null> {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return this.leitura(
      async (l) => (await lerUm(l, await this.estabelecimento(l, c.hospital), id))?.lido ?? null,
    );
  }

  private contexto(estId: number, trilha: TrilhaRede): ContextoOperacao {
    return {
      cliente: this.cliente,
      estabelecimento: trilha.estabelecimento ?? estId,
      usuario: trilha.usuario ?? null,
      correlacao: (trilha.correlacao ?? 'rede-servicos').slice(0, 64) || 'rede-servicos',
      chaveIdempotencia: `rede-servico:${randomUUID()}`,
    };
  }

  /** Quem grava: o usuário do contexto; sem ele (processo), o login informado. Sem nenhum: 403, nada gravado. */
  private static async usuario(tx: TxOperacao, login: string): Promise<number> {
    if (tx.contexto.usuario !== null) return tx.contexto.usuario;
    const [x] = await tx.consultar(
      'SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL',
      [login],
      {
        teto: 1,
      },
    );
    if (!x)
      throw new ErroOperacao(
        403,
        'usuario-desconhecido',
        'Usuário desconhecido',
        'Quem registra precisa ser um usuário do cliente.',
      );
    return numero(x['id']);
  }

  async registrar(
    c: ContextoServicosRede,
    novo: NovoServicoParaGravar,
    por: string,
    trilha: TrilhaRede,
  ): Promise<ServicoCompartilhadoLido> {
    const { est, envolvidos } = await this.leitura(async (l) => {
      const e = await this.estabelecimento(l, c.hospital);
      return { est: e, envolvidos: await this.idsEnvolvidos(l, novo.estabelecimentos) };
    });
    const agora = this.agora();
    const op = definirOperacao({
      nome: 'rede.registrar-servico-compartilhado',
      tabelas: [TABELA, TABELA_ENV],
      entrada: esquemaRegistro,
      acao: 'inclusao',
      async gravar(tx, e) {
        const usuario = await PortaServicosRedePropria.usuario(tx, e.por);
        const id = await tx.incluir(TABELA, {
          estabelecimento_id: e.estabelecimento,
          area: e.area,
          titulo: e.titulo,
          descricao: e.descricao,
          situacao: 'registrada',
          registrado_por_usuario_id: usuario,
          registrado_em: agora,
        });
        for (const v of e.envolvidos)
          await tx.incluir(TABELA_ENV, { servico_compartilhado_rede_id: id, estabelecimento_id: v });
        return { id };
      },
      alvo: (_e, r) => ({ tabela: TABELA, id: Number(r.id) }),
      trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: trilha.motivo ?? null }),
    });
    const r = await this.montada('gravacao').executor.executar(
      op,
      this.cliente,
      {
        estabelecimento: est.id,
        area: novo.area,
        titulo: novo.titulo,
        descricao: novo.descricao,
        envolvidos,
        por,
      },
      this.contexto(est.id, trilha),
    );
    const lido = await this.ler(c, Number(r.resultado.id));
    if (!lido) throw new Error('Registro do serviço compartilhado não relido depois da gravação.');
    return lido;
  }

  async alterar(
    c: ContextoServicosRede,
    id: number,
    m: MudancaServicoParaGravar,
    por: string,
    trilha: TrilhaRede,
  ): Promise<{ antes: ServicoCompartilhadoLido; depois: ServicoCompartilhadoLido; mudou: boolean } | null> {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const lido = await this.leitura(async (l) => {
      const est = await this.estabelecimento(l, c.hospital);
      const atual = await lerUm(l, est, id);
      const envolvidos =
        atual && m.estabelecimentos !== undefined ? await this.idsEnvolvidos(l, m.estabelecimentos) : null;
      return { est, atual, envolvidos };
    });
    if (!lido.atual) return null;
    const antes = lido.atual.lido;
    const valores: Record<string, unknown> = {};
    if (m.area !== undefined && m.area !== antes.area) valores['area'] = m.area;
    if (m.titulo !== undefined && m.titulo !== antes.titulo) valores['titulo'] = m.titulo;
    if (m.descricao !== undefined && m.descricao !== antes.descricao) valores['descricao'] = m.descricao;
    if (m.situacao !== undefined && m.situacao !== antes.situacao) valores['situacao'] = m.situacao;
    const mesmosEnvolvidos =
      m.estabelecimentos === undefined ||
      (new Set(m.estabelecimentos).size === antes.estabelecimentos.length &&
        m.estabelecimentos.every((k) => antes.estabelecimentos.includes(k)));
    if (Object.keys(valores).length === 0 && mesmosEnvolvidos) return { antes, depois: antes, mudou: false };
    // Só a lista de envolvidos mudou: a linha do registro ainda ganha alterado_em/por e a versão nova.
    if (Object.keys(valores).length === 0) valores['situacao'] = antes.situacao;
    const agora = this.agora();
    const op = definirOperacao({
      nome: 'rede.alterar-servico-compartilhado',
      tabelas: [TABELA, TABELA_ENV],
      entrada: esquemaAlteracao,
      acao: 'alteracao',
      travar: (e) => ({ tabela: TABELA, id: e.id, versaoEsperada: e.versao }),
      async gravar(tx, e) {
        await tx.alterar(TABELA, e.id, e.versao, e.valores);
        if (e.envolvidos) {
          const usuario = await PortaServicosRedePropria.usuario(tx, por);
          const linhas = await tx.consultarParaAtualizar(
            `SELECT id, estabelecimento_id, versao, excluido_em FROM ${TABELA_ENV} WHERE servico_compartilhado_rede_id = ?`,
            [e.id],
            { teto: 1_000 },
          );
          const querer = new Set(e.envolvidos);
          const tem = new Set<number>();
          for (const x of linhas) {
            const est = numero(x['estabelecimento_id']);
            tem.add(est);
            const ativo = x['excluido_em'] === null || x['excluido_em'] === undefined;
            if (ativo && !querer.has(est))
              await tx.alterar(TABELA_ENV, numero(x['id']), numero(x['versao']), {
                excluido_em: agora,
                excluido_por: usuario,
              });
            else if (!ativo && querer.has(est))
              await tx.alterar(TABELA_ENV, numero(x['id']), numero(x['versao']), {
                excluido_em: null,
                excluido_por: null,
              });
          }
          for (const v of e.envolvidos)
            if (!tem.has(v))
              await tx.incluir(TABELA_ENV, { servico_compartilhado_rede_id: e.id, estabelecimento_id: v });
        }
        return { id: e.id };
      },
      alvo: (e) => ({ tabela: TABELA, id: e.id }),
      trilha: () => ({
        dados: {
          ...((trilha.dadosDepois as object | null | undefined) ?? {}),
          antes: { versao: lido.atual!.versao },
        },
        motivo: trilha.motivo ?? null,
      }),
    });
    await this.montada('gravacao').executor.executar(
      op,
      this.cliente,
      {
        id,
        estabelecimento: lido.est.id,
        versao: lido.atual.versao,
        valores,
        envolvidos: lido.envolvidos,
      },
      this.contexto(lido.est.id, trilha),
    );
    const depois = await this.ler(c, id);
    if (!depois) throw new Error('Registro do serviço compartilhado não relido depois da alteração.');
    return { antes, depois, mudou: true };
  }
}
