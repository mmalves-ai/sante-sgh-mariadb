// Fonte do CRUD genérico na API (M08): onde as leituras e as gravações dos domínios acontecem.
//   - `FonteDominiosPropria`: o banco MariaDB do cliente. A declaração vem dos metadados (dominios-catalogo.ts); a
//     leitura filtra o estabelecimento da sessão e a exclusão lógica; a gravação passa pelo Executor do @sgh/nucleo
//     (trilha, outbox e idempotência na mesma transação; trava otimista pela versao);
//   - `fonteDominiosMemoria`: a sessão sintética (dev/ci; testes): dois domínios sintéticos com a mesma declaração
//     derivada, em memória. Nada vai a banco;
//   - `fonteDominiosIndisponivel`: fora de dev/ci SEM o núcleo: toda chamada responde 503 (nunca cai na memória).
// Melhoria: a inativação grava a coluna ativo do próprio domínio (sem tabela paralela "só no novo"); a exclusão física
// não é oferecida (regra 4 do M08), e a FK do banco protege as referências.
// Melhoria: a referência gravada é conferida na transação contra o estabelecimento da sessão (a FK sozinha aceitaria
// a linha de outro estabelecimento do mesmo cliente).
import { randomUUID } from 'node:crypto';
import type { ItemDominio } from '@sgh/contratos';
import {
  conferirNome,
  type ContextoOperacao,
  definirOperacao,
  erroConflitoVersao,
  erroRegistroInexistente,
  type Executor,
  FORMATO_CHAVE_IDEMPOTENCIA,
  type Leitor,
  type Linha,
  recusa,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import {
  type CampoDominio,
  type ColunaMeta,
  declararDominio,
  type DominioDeclarado,
  tabelasDeDominio,
  valorParaTela,
} from './dominios-catalogo.js';

export const FONTE_DOMINIOS = Symbol('FONTE_DOMINIOS');

/** Fora de dev/ci sem o núcleo: falha fechada, 503 em toda leitura e gravação. */
export class ErroFonteIndisponivel extends ErroProblema {
  constructor() {
    super(
      'indisponivel',
      503,
      'Banco do estabelecimento indisponível',
      'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
    );
  }
}

/** Teto da lista lida do banco (acima dele a lista vem truncada; a tela filtra no servidor). */
export const TETO_LISTA = 500;
/** Metadados relidos depois deste prazo (mudam só com migração). */
export const RELEITURA_CATALOGO_MS = 10 * 60_000;

export interface ContextoDominio {
  readonly hospital: string;
  /** Id do usuário da sessão (usuario.id), quando a sessão o tem. */
  readonly usuarioId: string | null;
  readonly login: string;
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
}

export interface ReferenciaUso {
  readonly regra: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NO ACTION';
  readonly usos: boolean;
}

export interface OpcaoCampo {
  readonly valor: string;
  readonly rotulo: string;
}

export interface FonteDominios {
  readonly destino: 'banco' | 'memoria';
  catalogo(): Promise<readonly DominioDeclarado[]>;
  listar(
    hospital: string,
    d: DominioDeclarado,
    inativos: boolean,
  ): Promise<{ readonly itens: ItemDominio[]; readonly truncada: boolean }>;
  item(hospital: string, d: DominioDeclarado, codigo: string): Promise<ItemDominio | null>;
  uso(hospital: string, d: DominioDeclarado, codigo: string): Promise<ReferenciaUso[]>;
  opcoes(hospital: string, d: DominioDeclarado, campo: CampoDominio): Promise<OpcaoCampo[]>;
  incluir(c: ContextoDominio, d: DominioDeclarado, valores: Record<string, unknown>): Promise<{ codigo: string }>;
  alterar(
    c: ContextoDominio,
    d: DominioDeclarado,
    codigo: string,
    versao: number,
    valores: Record<string, unknown>,
  ): Promise<{ codigo: string }>;
  mudarSituacao(
    c: ContextoDominio,
    d: DominioDeclarado,
    codigo: string,
    versao: number,
    ativo: boolean,
    motivo: string,
  ): Promise<{ codigo: string }>;
}

/** Item da tela a partir da linha lida (colunas pelo nome da coluna). */
export function itemDaLinha(d: DominioDeclarado, r: Linha): ItemDominio {
  const valores: Record<string, ItemDominio['valores'][string]> = {};
  for (const c of d.campos) valores[c.campo] = valorParaTela(c, r[c.coluna]);
  return {
    codigo: String(r['codigo']),
    ativo: r['ativo'] === true || Number(r['ativo']) === 1,
    valores,
    versao: String(r['versao']),
  };
}

const esquemaGravacao = z.object({
  tabela: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  codigo: z.string().min(1).max(120).nullable(),
  versao: z.number().int().positive().nullable(),
  valores: z.record(z.string(), z.unknown()),
  motivo: z.string().max(200).nullable(),
});
type EntradaGravacao = z.infer<typeof esquemaGravacao>;

/**
 * As referências da gravação apontam para linhas que a sessão enxerga: a FK só garante que a linha existe no cliente;
 * aqui se confere, na mesma transação, que a linha referenciada é do estabelecimento da sessão (ou da rede inteira) e
 * não foi excluída. Senão, 409 `referencia-inexistente` (a mesma resposta para "não existe" e "é de outro
 * estabelecimento": o id de outro estabelecimento não se revela).
 */
async function conferirReferencias(
  tx: Pick<Leitor, 'uma' | 'consultar'>,
  d: DominioDeclarado,
  valores: Record<string, unknown>,
  est: number,
): Promise<void> {
  for (const c of d.campos) {
    const alvo = c.tabelaReferencia;
    const v = valores[c.coluna];
    if (!alvo || v === undefined || v === null) continue;
    const cols = new Set(
      (
        await tx.consultar<{ c: string }>(
          `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            AND COLUMN_NAME IN ('estabelecimento_id', 'excluido_em')`,
          [alvo],
        )
      ).map((x) => x.c),
    );
    const onde = [
      'id = ?',
      ...(cols.has('estabelecimento_id') ? ['(estabelecimento_id = ? OR estabelecimento_id IS NULL)'] : []),
      ...(cols.has('excluido_em') ? ['excluido_em IS NULL'] : []),
    ];
    const achada = await tx.uma(
      `SELECT 1 AS ok FROM ${conferirNome(alvo)} WHERE ${onde.join(' AND ')}`,
      cols.has('estabelecimento_id') ? [v, est] : [v],
    );
    if (!achada)
      throw recusa('referencia-inexistente', `${c.rotulo}: a referência não existe neste estabelecimento.`, {
        campos: [c.campo],
      });
  }
}

/** O que a fonte usa do NucleoProprio (os testes trocam). */
export interface NucleoDominios {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

const REGRAS = new Set(['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION']);

export class FonteDominiosPropria implements FonteDominios {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;
  private cache: { em: number; lista: readonly DominioDeclarado[] } | null = null;

  constructor(
    private readonly nucleo: NucleoDominios,
    /** Código do cliente na plataforma (o banco é cliente_<codigo>). */
    readonly cliente: string,
    executor?: Executor,
    private readonly agora: () => number = () => Date.now(),
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>, correlacao = 'crud-generico'): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao }, fn);
  }

  async catalogo(): Promise<readonly DominioDeclarado[]> {
    if (this.cache && this.agora() - this.cache.em < RELEITURA_CATALOGO_MS) return this.cache.lista;
    const areas = tabelasDeDominio();
    const nomes = [...areas.keys()];
    const marcas = nomes.map(() => '?').join(', ');
    const lista = await this.ler(async (l) => {
      const tabelas = await l.consultar<{ tabela: string; comentario: string }>(
        `SELECT TABLE_NAME AS tabela, TABLE_COMMENT AS comentario FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${marcas})`,
        nomes,
        { teto: nomes.length },
      );
      const colunas = await l.consultar(
        `SELECT TABLE_NAME AS tabela, COLUMN_NAME AS coluna, DATA_TYPE AS tipo, COLUMN_TYPE AS tipo_coluna,
                IS_NULLABLE AS nulo, COLUMN_DEFAULT AS padrao, CHARACTER_MAXIMUM_LENGTH AS tamanho,
                NUMERIC_SCALE AS escala, COLUMN_COMMENT AS comentario, EXTRA AS extra
           FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${marcas})
          ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        nomes,
        { teto: 100_000 },
      );
      const fks = await l.consultar<{ tabela: string; coluna: string; referencia: string }>(
        `SELECT TABLE_NAME AS tabela, COLUMN_NAME AS coluna, REFERENCED_TABLE_NAME AS referencia
           FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_NAME IN (${marcas})`,
        nomes,
        { teto: 100_000 },
      );
      const porTabela = new Map<string, ColunaMeta[]>();
      for (const c of colunas) {
        const t = String(c['tabela']);
        const ref = fks.find((f) => f.tabela === t && f.coluna === c['coluna']);
        const lista = porTabela.get(t) ?? [];
        lista.push({
          coluna: String(c['coluna']),
          tipo: String(c['tipo']).toLowerCase(),
          tipoColuna: String(c['tipo_coluna']).toLowerCase(),
          nulo: c['nulo'] === 'YES',
          temPadrao: c['padrao'] !== null && c['padrao'] !== undefined,
          tamanho: c['tamanho'] === null ? null : Number(c['tamanho']),
          escala: c['escala'] === null ? null : Number(c['escala']),
          comentario: String(c['comentario'] ?? ''),
          gerada: /GENERATED|VIRTUAL|PERSISTENT|STORED/i.test(String(c['extra'] ?? '')),
          referencia: ref ? String(ref.referencia) : null,
        });
        porTabela.set(t, lista);
      }
      return tabelas
        .map((t) =>
          declararDominio(t.tabela, areas.get(t.tabela) ?? '', String(t.comentario ?? ''), porTabela.get(t.tabela) ?? []),
        )
        .filter((d): d is DominioDeclarado => d !== null)
        .sort((a, b) => a.rotulo.plural.localeCompare(b.rotulo.plural, 'pt-BR'));
    });
    this.cache = { em: this.agora(), lista };
    return lista;
  }

  private async estabelecimento(l: Leitor, hospital: string): Promise<number> {
    const e = await l.uma<{ id: number }>(
      'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      [hospital],
    );
    if (!e) throw new ErroProblema('nao-encontrado', 404, 'Estabelecimento não encontrado');
    return Number(e.id);
  }

  /** WHERE comum: estabelecimento da sessão (mais as linhas da rede inteira) e exclusão lógica. */
  private filtro(d: DominioDeclarado, est: number): { sql: string; params: unknown[] } {
    const partes: string[] = [];
    const params: unknown[] = [];
    if (d.porEstabelecimento) {
      // A linha sem estabelecimento vale para a rede inteira (o domínio é compartilhado pelos estabelecimentos).
      partes.push('(estabelecimento_id = ? OR estabelecimento_id IS NULL)');
      params.push(est);
    }
    if (d.exclusaoLogica) partes.push('excluido_em IS NULL');
    return { sql: partes.length ? partes.join(' AND ') : 'TRUE', params };
  }

  private colunas(d: DominioDeclarado): string {
    conferirNome(d.tabela);
    const extras = d.campos.map((c) => conferirNome(c.coluna)).filter((c) => c !== 'codigo');
    return ['id', 'codigo', 'ativo', 'versao', ...extras].join(', ');
  }

  async listar(hospital: string, d: DominioDeclarado, inativos: boolean) {
    return this.ler(async (l) => {
      const est = await this.estabelecimento(l, hospital);
      const f = this.filtro(d, est);
      const linhas = await l.consultar(
        `SELECT ${this.colunas(d)} FROM ${d.tabela} WHERE ${f.sql}${inativos ? '' : ' AND ativo'}
          ORDER BY codigo LIMIT ${TETO_LISTA + 1}`,
        f.params,
        { teto: TETO_LISTA + 1 },
      );
      return {
        itens: linhas.slice(0, TETO_LISTA).map((r) => itemDaLinha(d, r)),
        truncada: linhas.length > TETO_LISTA,
      };
    });
  }

  private async linha(l: Leitor, d: DominioDeclarado, est: number, codigo: string): Promise<Linha | null> {
    const f = this.filtro(d, est);
    return l.uma(`SELECT ${this.colunas(d)} FROM ${d.tabela} WHERE codigo = ? AND ${f.sql}`, [codigo, ...f.params]);
  }

  async item(hospital: string, d: DominioDeclarado, codigo: string) {
    return this.ler(async (l) => {
      const r = await this.linha(l, d, await this.estabelecimento(l, hospital), codigo);
      return r ? itemDaLinha(d, r) : null;
    });
  }

  async uso(hospital: string, d: DominioDeclarado, codigo: string): Promise<ReferenciaUso[]> {
    return this.ler(async (l) => {
      const r = await this.linha(l, d, await this.estabelecimento(l, hospital), codigo);
      if (!r) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
      const refs = await l.consultar<{ tabela: string; coluna: string; regra: string }>(
        `SELECT k.TABLE_NAME AS tabela, k.COLUMN_NAME AS coluna, rc.DELETE_RULE AS regra
           FROM information_schema.KEY_COLUMN_USAGE k
           JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
             ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME
          WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME = ? ORDER BY k.TABLE_NAME, k.COLUMN_NAME`,
        [d.tabela],
        { teto: 200 },
      );
      const usos: ReferenciaUso[] = [];
      for (const ref of refs) {
        const u = await l.uma<{ usado: number }>(
          `SELECT EXISTS(SELECT 1 FROM ${conferirNome(ref.tabela)} WHERE ${conferirNome(ref.coluna)} = ?) AS usado`,
          [r['id']],
        );
        const regra = REGRAS.has(ref.regra) ? (ref.regra as ReferenciaUso['regra']) : 'RESTRICT';
        usos.push({ regra, usos: Number(u?.usado) === 1 });
      }
      return usos;
    });
  }

  async opcoes(hospital: string, d: DominioDeclarado, campo: CampoDominio): Promise<OpcaoCampo[]> {
    const alvo = campo.tabelaReferencia;
    if (!alvo || !d.campos.includes(campo)) return [];
    return this.ler(async (l) => {
      const est = await this.estabelecimento(l, hospital);
      const cols = new Set(
        (
          await l.consultar<{ c: string }>(
            'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
            [alvo],
            { teto: 500 },
          )
        ).map((x) => x.c),
      );
      const rotulo = ['descricao', 'nome', 'codigo'].find((c) => cols.has(c));
      if (!rotulo) return [];
      const onde = [
        ...(cols.has('ativo') ? ['ativo'] : []),
        ...(cols.has('excluido_em') ? ['excluido_em IS NULL'] : []),
        ...(cols.has('estabelecimento_id') ? ['(estabelecimento_id = ? OR estabelecimento_id IS NULL)'] : []),
      ];
      const linhas = await l.consultar(
        `SELECT id, ${rotulo} AS rotulo FROM ${conferirNome(alvo)}${onde.length ? ` WHERE ${onde.join(' AND ')}` : ''}
          ORDER BY ${rotulo} LIMIT ${TETO_LISTA}`,
        cols.has('estabelecimento_id') ? [est] : [],
        { teto: TETO_LISTA },
      );
      return linhas.map((x) => ({ valor: String(x['id']), rotulo: String(x['rotulo'] ?? '') }));
    });
  }

  private async contexto(c: ContextoDominio): Promise<ContextoOperacao> {
    return this.ler(async (l) => {
      const estabelecimento = await this.estabelecimento(l, c.hospital);
      let usuario: number | null = null;
      if (c.usuarioId && /^\d{1,18}$/.test(c.usuarioId)) usuario = Number(c.usuarioId);
      else if (c.login) {
        const u = await l.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [c.login]);
        usuario = u ? Number(u.id) : null;
      }
      return {
        cliente: this.cliente,
        estabelecimento,
        usuario,
        correlacao: (c.correlacao || 'crud-generico').slice(0, 64),
        chaveIdempotencia: FORMATO_CHAVE_IDEMPOTENCIA.test(c.chaveIdempotencia) ? c.chaveIdempotencia : randomUUID(),
        ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
      };
    }, c.correlacao);
  }

  /** Grava pela operação do verbo; a linha do código é relida na transação (estabelecimento e exclusão lógica). */
  private async gravar(
    c: ContextoDominio,
    d: DominioDeclarado,
    verbo: 'incluir' | 'alterar' | 'inativar' | 'reativar',
    entrada: EntradaGravacao,
  ): Promise<{ codigo: string }> {
    const ctx = await this.contexto(c);
    const filtro = (est: number) => this.filtro(d, est);
    const op = definirOperacao({
      nome: `dominio.${verbo}`,
      tabelas: [d.tabela],
      entrada: esquemaGravacao,
      acao: verbo === 'incluir' ? 'inclusao' : 'alteracao',
      async gravar(tx, e, cx) {
        const est = cx.estabelecimento!;
        if (verbo === 'incluir' || verbo === 'alterar') await conferirReferencias(tx, d, e.valores, est);
        if (verbo === 'incluir') {
          const id = await tx.incluir(d.tabela, {
            ...e.valores,
            ativo: true,
            ...(d.porEstabelecimento && d.estabelecimentoObrigatorio ? { estabelecimento_id: est } : {}),
          });
          const r = await tx.uma<{ codigo: string }>(`SELECT codigo FROM ${d.tabela} WHERE id = ?`, [id]);
          return { id, codigo: String(r?.codigo ?? '') };
        }
        const f = filtro(est);
        const atual = await tx.uma<{ id: number }>(
          `SELECT id FROM ${d.tabela} WHERE codigo = ? AND ${f.sql}`,
          [e.codigo, ...f.params],
        );
        if (!atual) throw erroRegistroInexistente();
        const id = Number(atual.id);
        const valores = verbo === 'alterar' ? e.valores : { ativo: verbo === 'reativar' };
        await tx.alterar(d.tabela, id, e.versao!, valores);
        return { id, codigo: e.codigo! };
      },
      alvo: (_e, r) => ({ tabela: d.tabela, id: r.id }),
      trilha: (e) => ({ motivo: e.motivo, dados: { dominio: `${d.modulo}.${d.recurso}` } }),
    });
    const s = await this.executor.executar(op, this.cliente, entrada, ctx);
    return { codigo: s.resultado.codigo };
  }

  incluir(c: ContextoDominio, d: DominioDeclarado, valores: Record<string, unknown>) {
    return this.gravar(c, d, 'incluir', { tabela: d.tabela, codigo: null, versao: null, valores, motivo: null });
  }

  alterar(c: ContextoDominio, d: DominioDeclarado, codigo: string, versao: number, valores: Record<string, unknown>) {
    return this.gravar(c, d, 'alterar', { tabela: d.tabela, codigo, versao, valores, motivo: null });
  }

  mudarSituacao(
    c: ContextoDominio,
    d: DominioDeclarado,
    codigo: string,
    versao: number,
    ativo: boolean,
    motivo: string,
  ) {
    return this.gravar(c, d, ativo ? 'reativar' : 'inativar', {
      tabela: d.tabela,
      codigo,
      versao,
      valores: {},
      motivo,
    });
  }
}

export function fonteDominiosIndisponivel(): FonteDominios {
  const recusar = async (): Promise<never> => {
    throw new ErroFonteIndisponivel();
  };
  return {
    destino: 'banco',
    catalogo: recusar,
    listar: recusar,
    item: recusar,
    uso: recusar,
    opcoes: recusar,
    incluir: recusar,
    alterar: recusar,
    mudarSituacao: recusar,
  };
}

// ── Memória (dev/ci) ──────────────────────────────────────────────────────────────────────────────

const col = (coluna: string, tipo: string, o: Partial<ColunaMeta> = {}): ColunaMeta => ({
  coluna,
  tipo,
  tipoColuna: tipo,
  nulo: false,
  temPadrao: false,
  tamanho: null,
  escala: null,
  comentario: '',
  gerada: false,
  referencia: null,
  ...o,
});
const AUDITORIA = [
  col('criado_em', 'datetime'),
  col('criado_por', 'bigint', { nulo: true, temPadrao: true }),
  col('alterado_em', 'datetime', { nulo: true, temPadrao: true }),
  col('alterado_por', 'bigint', { nulo: true, temPadrao: true }),
  col('versao', 'int', { temPadrao: true }),
];
const BASICAS = [
  col('id', 'bigint'),
  col('codigo', 'varchar', { tamanho: 30 }),
  col('descricao', 'varchar', { tamanho: 150 }),
  col('ativo', 'tinyint', { tipoColuna: 'tinyint(1)', temPadrao: true }),
];

/** Os domínios sintéticos da memória: a mesma forma dos domínios da matriz de priorização do modelo. */
export function dominiosSinteticos(): DominioDeclarado[] {
  const dimensao = declararDominio('dimensao_priorizacao_gut', 'ADM', 'Dimensões da matriz de priorização', [
    ...BASICAS,
    ...AUDITORIA,
  ]);
  const grau = declararDominio(
    'grau_priorizacao_gut',
    'ADM',
    'Graus de cada dimensão da matriz de priorização, com descrição e pontuação',
    [
      ...BASICAS,
      col('dimensao_priorizacao_gut_id', 'bigint', {
        tipoColuna: 'bigint(20) unsigned',
        referencia: 'dimensao_priorizacao_gut',
      }),
      col('pontuacao', 'tinyint', { tipoColuna: 'tinyint(3) unsigned' }),
      ...AUDITORIA,
    ],
  );
  return [dimensao!, grau!];
}

interface LinhaMemoria {
  id: number;
  codigo: string;
  ativo: boolean;
  versao: number;
  valores: Record<string, unknown>;
}

export function fonteDominiosMemoria(): FonteDominios {
  const dominios = dominiosSinteticos();
  const linhas = new Map<string, LinhaMemoria[]>(dominios.map((d) => [d.tabela, []]));
  let proximo = 1;
  linhas.get('dimensao_priorizacao_gut')!.push(
    { id: proximo++, codigo: 'G', ativo: true, versao: 1, valores: { descricao: 'Gravidade (sintética)' } },
    { id: proximo++, codigo: 'U', ativo: true, versao: 1, valores: { descricao: 'Urgência (sintética)' } },
  );
  const deTabela = (d: DominioDeclarado) => linhas.get(d.tabela) ?? [];
  const paraLinha = (l: LinhaMemoria): Linha => ({
    id: l.id,
    codigo: l.codigo,
    ativo: l.ativo,
    versao: l.versao,
    ...l.valores,
  });
  const achar = (d: DominioDeclarado, codigo: string) => deTabela(d).find((l) => l.codigo === codigo);
  const conferirReferencias = (d: DominioDeclarado, valores: Record<string, unknown>) => {
    for (const c of d.campos) {
      const v = valores[c.coluna];
      if (!c.tabelaReferencia || v === undefined || v === null) continue;
      if (!(linhas.get(c.tabelaReferencia) ?? []).some((l) => l.id === v))
        throw recusa('referencia-inexistente', `${c.rotulo}: a referência não existe.`, { campos: [c.campo] });
    }
  };
  return {
    destino: 'memoria',
    catalogo: async () => dominios,
    async listar(_h, d, inativos) {
      const itens = deTabela(d)
        .filter((l) => inativos || l.ativo)
        .sort((a, b) => a.codigo.localeCompare(b.codigo))
        .map((l) => itemDaLinha(d, paraLinha(l)));
      return { itens: itens.slice(0, TETO_LISTA), truncada: itens.length > TETO_LISTA };
    },
    async item(_h, d, codigo) {
      const l = achar(d, codigo);
      return l ? itemDaLinha(d, paraLinha(l)) : null;
    },
    async uso(_h, d, codigo) {
      const l = achar(d, codigo);
      if (!l) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
      const r: ReferenciaUso[] = [];
      for (const outro of dominios)
        for (const c of outro.campos.filter((x) => x.tabelaReferencia === d.tabela))
          r.push({ regra: 'RESTRICT', usos: deTabela(outro).some((x) => x.valores[c.coluna] === l.id) });
      return r;
    },
    async opcoes(_h, d, campo) {
      if (!campo.tabelaReferencia || !d.campos.includes(campo)) return [];
      return (linhas.get(campo.tabelaReferencia) ?? [])
        .filter((l) => l.ativo)
        .map((l) => ({ valor: String(l.id), rotulo: String(l.valores['descricao'] ?? l.codigo) }));
    },
    async incluir(_c, d, valores) {
      const codigo = String(valores['codigo'] ?? '');
      if (achar(d, codigo)) throw recusa('codigo-duplicado', 'Já existe um item com este código.');
      conferirReferencias(d, valores);
      const { codigo: _codigo, ...resto } = valores;
      void _codigo;
      deTabela(d).push({ id: proximo++, codigo, ativo: true, versao: 1, valores: { ...resto } });
      return { codigo };
    },
    async alterar(_c, d, codigo, versao, valores) {
      const l = achar(d, codigo);
      if (!l) throw erroRegistroInexistente();
      if (l.versao !== versao) throw erroConflitoVersao(['versao']);
      conferirReferencias(d, valores);
      l.valores = { ...l.valores, ...valores };
      l.versao++;
      return { codigo };
    },
    async mudarSituacao(_c, d, codigo, versao, ativo) {
      const l = achar(d, codigo);
      if (!l) throw erroRegistroInexistente();
      if (l.versao !== versao) throw erroConflitoVersao(['versao']);
      l.ativo = ativo;
      l.versao++;
      return { codigo };
    },
  };
}
