// Cadastro editável dos protocolos de prescrição, dos kits de medicamentos e de soluções e das receitas padrão no
// banco próprio (03-PEP L107): protocolo_prescricao com protocolo_prescricao_item, kit_prescricao com
// kit_prescricao_item e modelo_receita com modelo_receita_item. A regra é do domínio (cadastro-protocolo.ts); aqui só
// a leitura e a gravação pelo executor (trilha na mesma transação). Cabeçalho e itens se gravam juntos, com a versão
// lida; os itens se acertam pela sequência (planoDosItens): o que sai da lista fica retirado (protocolo e receita:
// ativo = false; kit: excluido_em/excluido_por), nunca apagado, e a prescrição que usou o item continua ligada.
// A receita padrão pessoal é do profissional da sessão (nunca de outro); a geral e a da especialidade pedem quem
// cuida dos protocolos da instituição (a rota confere).
import { esquemaDetalheItem } from '@sgh/contratos';
import {
  ABRANGENCIAS_RECEITA,
  aplicacaoDoKit,
  MENSAGENS_APLICACAO_KIT,
  FORMATOS_RECEITA,
  MENSAGENS_CADASTRO_PROTOCOLO,
  PAPEIS_ITEM_KIT,
  planoDosItens,
  type ProblemaProtocolo,
  problemasDaReceitaPadrao,
  problemasDoKit,
  problemasDoProtocolo,
  SEXOS_PROTOCOLO,
  TIPOS_ITEM_PROTOCOLO,
  TIPOS_KIT,
} from '@sgh/dominio-pep';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type {
  ContextoCadastroCatalogo,
  ContextoGravacaoCatalogo,
  Gravado,
  NucleoCadastroCatalogo,
} from './prescricao-propria-cadastro.js';

export const CADASTRO_PROTOCOLOS_PRESCRICAO = Symbol('CADASTRO_PROTOCOLOS_PRESCRICAO');

const TABELAS = [
  'protocolo_prescricao',
  'protocolo_prescricao_item',
  'kit_prescricao',
  'kit_prescricao_item',
  'modelo_receita',
  'modelo_receita_item',
] as const;

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => v === true || Boolean(Number(v));
const id = z.number().int().positive();
const versao = z.number().int().positive();
const nulo = <T extends z.ZodTypeAny>(t: T) => t.nullable().default(null);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const seq = z.number().int().min(1).max(999);

const esquemaProtocolo = z
  .object({
    id: id.optional(),
    versao: versao.optional(),
    codigo: z.string().trim().max(30),
    nome: z.string().trim().max(150),
    todosEstabelecimentos: z.boolean().default(false),
    indicacao: nulo(z.string().trim().max(4000)),
    sexo: z.enum(SEXOS_PROTOCOLO).default('todos'),
    idadeMin: nulo(z.number().int().min(0).max(150)),
    idadeMax: nulo(z.number().int().min(0).max(150)),
    pesoMin: nulo(z.number().max(9999)),
    pesoMax: nulo(z.number().max(9999)),
    vigenciaInicio: nulo(data),
    vigenciaFim: nulo(data),
    ativo: z.boolean().default(true),
    itens: z
      .array(
        z
          .object({
            sequencia: seq,
            tipoItem: z.enum(TIPOS_ITEM_PROTOCOLO),
            item: nulo(id),
            descricao: nulo(z.string().trim().max(2000)),
            dose: nulo(z.number()),
            unidade: nulo(id),
            quantidade: nulo(z.number()),
            frequencia: nulo(id),
            via: nulo(id),
            seNecessario: z.boolean().default(false),
            preSelecionado: z.boolean().default(true),
            observacao: nulo(z.string().trim().max(2000)),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
const esquemaKit = z
  .object({
    id: id.optional(),
    versao: versao.optional(),
    codigo: z.string().trim().max(30),
    nome: z.string().trim().max(150),
    tipoKit: z.enum(TIPOS_KIT),
    item: nulo(id),
    via: nulo(id),
    frequencia: nulo(id),
    doseInicial: nulo(z.number()),
    doseFinal: nulo(z.number()),
    velocidade: nulo(z.number()),
    unidadeInfusao: nulo(id),
    ativo: z.boolean().default(true),
    itens: z
      .array(
        z
          .object({
            sequencia: seq,
            item: nulo(id),
            papel: z.enum(PAPEIS_ITEM_KIT).default('componente'),
            quantidade: z.number(),
            unidade: nulo(id),
            via: nulo(id),
            frequencia: nulo(id),
            faturavel: z.boolean().default(true),
            observacao: nulo(z.string().trim().max(2000)),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
const esquemaReceita = z
  .object({
    id: id.optional(),
    versao: versao.optional(),
    nome: z.string().trim().max(100),
    abrangencia: z.enum(ABRANGENCIAS_RECEITA).default('profissional'),
    especialidade: nulo(id),
    formato: z.enum(FORMATOS_RECEITA).default('estruturada'),
    texto: nulo(z.string().trim().max(20000)),
    vigenciaInicio: data,
    vigenciaFim: nulo(data),
    ativo: z.boolean().default(true),
    itens: z
      .array(
        z
          .object({
            sequencia: seq,
            item: nulo(id),
            descricaoLivre: nulo(z.string().trim().max(500)),
            dose: nulo(z.number()),
            unidade: nulo(id),
            quantidade: nulo(z.number()),
            frequencia: nulo(id),
            via: nulo(id),
            duracao: nulo(z.number().int().min(1).max(9999)),
            unidadeDuracao: nulo(id),
            usoContinuo: z.boolean().default(false),
            posologia: nulo(z.string().trim().max(2000)),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export type EntradaProtocoloApi = z.infer<typeof esquemaProtocolo>;
export type EntradaKitApi = z.infer<typeof esquemaKit>;
export type EntradaReceitaApi = z.infer<typeof esquemaReceita>;

export interface ProtocoloCadastroLido {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly nome: string;
  readonly todosEstabelecimentos: boolean;
  readonly indicacao: string | null;
  readonly sexo: string;
  readonly idadeMin: number | null;
  readonly idadeMax: number | null;
  readonly pesoMin: number | null;
  readonly pesoMax: number | null;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
  readonly itens: readonly Record<string, unknown>[];
}

const recusar = (ps: readonly ProblemaProtocolo[], status = 422): never => {
  const p = ps[0]!;
  throw new ErroOperacao(
    status,
    p.codigo,
    'Cadastro recusado',
    ps.map((x) => MENSAGENS_CADASTRO_PROTOCOLO[x.codigo] ?? x.codigo).join(' '),
    { campos: [p.campo] },
  );
};
const inexistente = (o: string): ErroOperacao =>
  new ErroOperacao(404, 'registro-inexistente', `${o} não encontrado`, `${o} não existe neste cliente.`);

/** Todos os ids existem (e ativos, quando a tabela tem ativo)? Lista vazia passa. */
async function conferirIds(
  tx: TxOperacao,
  tabela: 'item_prescritivel' | 'unidade_prescricao',
  ids: number[],
  o: string,
) {
  const u = [...new Set(ids)];
  if (u.length === 0) return;
  const sql =
    tabela === 'item_prescritivel'
      ? `SELECT COUNT(*) AS n FROM item_prescritivel WHERE id IN (${u.map(() => '?').join(',')})`
      : `SELECT COUNT(*) AS n FROM unidade_prescricao WHERE id IN (${u.map(() => '?').join(',')})`;
  const r = await tx.consultar(sql, u);
  if (num(r[0]?.['n']) !== u.length) throw inexistente(o);
}

export class CadastroProtocolosPrescricaoPropria {
  private executorCache: Executor | null = null;
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  constructor(
    private readonly nucleo: NucleoCadastroCatalogo,
    private readonly cliente: string,
  ) {}

  private ler<T>(
    c: ContextoCadastroCatalogo,
    fn: (l: Leitor, est: number, usuario: number | null) => Promise<T>,
  ) {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'pep.protocolos.cadastro' },
      async (l) => {
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
        return fn(l, num(e['id']), u ? num(u['id']) : null);
      },
    );
  }

  // ── leitura ───────────────────────────────────────────────────────────────────────────────────

  /** Protocolos do estabelecimento (e os de todos), com os itens vivos na ordem da sequência. */
  protocolos(c: ContextoCadastroCatalogo): Promise<ProtocoloCadastroLido[]> {
    return this.ler(c, async (l, est) => {
      const ps = await l.consultar(
        `SELECT id, versao, codigo, nome, estabelecimento_id, indicacao, sexo, idade_minima_anos, idade_maxima_anos,
                peso_minimo_kg, peso_maximo_kg, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS ini,
                DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, ativo
           FROM protocolo_prescricao
          WHERE tipo = 'protocolo' AND excluido_em IS NULL AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
          ORDER BY nome, id`,
        [est],
        { teto: 5000 },
      );
      const ids = ps.map((p) => num(p['id']));
      const its = ids.length
        ? await l.consultar(
            `SELECT i.protocolo_prescricao_id AS p, i.sequencia, i.tipo_item, i.item_prescritivel_id, i.descricao,
                    i.dose_padrao, i.unidade_prescricao_id, i.quantidade, i.frequencia_administracao_id,
                    i.via_de_uso_id, i.se_necessario, i.pre_selecionado, i.observacao, ip.descricao AS item_nome
               FROM protocolo_prescricao_item i
               LEFT JOIN item_prescritivel ip ON ip.id = i.item_prescritivel_id
              WHERE i.protocolo_prescricao_id IN (${ids.map(() => '?').join(',')}) AND i.ativo
                AND i.excluido_em IS NULL AND i.componente_de_protocolo_prescricao_item_id IS NULL
              ORDER BY i.protocolo_prescricao_id, i.sequencia`,
            ids,
            { teto: 100_000 },
          )
        : [];
      return ps.map((p) => ({
        id: num(p['id']),
        versao: num(p['versao']),
        codigo: String(p['codigo']),
        nome: String(p['nome']),
        todosEstabelecimentos: p['estabelecimento_id'] === null,
        indicacao: txt(p['indicacao']),
        sexo: String(p['sexo']),
        idadeMin: numOuNull(p['idade_minima_anos']),
        idadeMax: numOuNull(p['idade_maxima_anos']),
        pesoMin: numOuNull(p['peso_minimo_kg']),
        pesoMax: numOuNull(p['peso_maximo_kg']),
        vigenciaInicio: txt(p['ini']),
        vigenciaFim: txt(p['fim']),
        ativo: bool(p['ativo']),
        itens: its
          .filter((i) => num(i['p']) === num(p['id']))
          .map((i) => ({
            sequencia: num(i['sequencia']),
            tipoItem: String(i['tipo_item']),
            item: numOuNull(i['item_prescritivel_id']),
            itemNome: txt(i['item_nome']),
            descricao: txt(i['descricao']),
            dose: numOuNull(i['dose_padrao']),
            unidade: numOuNull(i['unidade_prescricao_id']),
            quantidade: numOuNull(i['quantidade']),
            frequencia: numOuNull(i['frequencia_administracao_id']),
            via: numOuNull(i['via_de_uso_id']),
            seNecessario: bool(i['se_necessario']),
            preSelecionado: bool(i['pre_selecionado']),
            observacao: txt(i['observacao']),
          })),
      }));
    });
  }

  /** Kits de medicamentos e de soluções com os itens vivos. */
  kits(c: ContextoCadastroCatalogo) {
    return this.ler(c, async (l) => {
      const ks = await l.consultar(
        `SELECT id, versao, codigo, nome, tipo_kit, item_prescritivel_id, via_de_uso_id, frequencia_administracao_id,
                intervalo_dose_inicial, intervalo_dose_final, velocidade_infusao, unidade_infusao_id, ativo
           FROM kit_prescricao WHERE excluido_em IS NULL ORDER BY nome, id`,
        [],
        { teto: 5000 },
      );
      const ids = ks.map((k) => num(k['id']));
      const its = ids.length
        ? await l.consultar(
            `SELECT i.kit_prescricao_id AS k, i.sequencia, i.item_prescritivel_id, i.papel, i.quantidade,
                    i.unidade_prescricao_id, i.via_de_uso_id, i.frequencia_administracao_id, i.faturavel,
                    i.observacao, ip.descricao AS item_nome
               FROM kit_prescricao_item i LEFT JOIN item_prescritivel ip ON ip.id = i.item_prescritivel_id
              WHERE i.kit_prescricao_id IN (${ids.map(() => '?').join(',')}) AND i.excluido_em IS NULL
              ORDER BY i.kit_prescricao_id, i.sequencia`,
            ids,
            { teto: 100_000 },
          )
        : [];
      return ks.map((k) => ({
        id: num(k['id']),
        versao: num(k['versao']),
        codigo: String(k['codigo']),
        nome: String(k['nome']),
        tipoKit: String(k['tipo_kit']),
        item: numOuNull(k['item_prescritivel_id']),
        via: numOuNull(k['via_de_uso_id']),
        frequencia: numOuNull(k['frequencia_administracao_id']),
        doseInicial: numOuNull(k['intervalo_dose_inicial']),
        doseFinal: numOuNull(k['intervalo_dose_final']),
        velocidade: numOuNull(k['velocidade_infusao']),
        unidadeInfusao: numOuNull(k['unidade_infusao_id']),
        ativo: bool(k['ativo']),
        itens: its
          .filter((i) => num(i['k']) === num(k['id']))
          .map((i) => ({
            sequencia: num(i['sequencia']),
            item: numOuNull(i['item_prescritivel_id']),
            itemNome: txt(i['item_nome']),
            papel: String(i['papel']),
            quantidade: num(i['quantidade']),
            unidade: numOuNull(i['unidade_prescricao_id']),
            via: numOuNull(i['via_de_uso_id']),
            frequencia: numOuNull(i['frequencia_administracao_id']),
            faturavel: bool(i['faturavel']),
            observacao: txt(i['observacao']),
          })),
      }));
    });
  }

  /** Receitas padrão que a sessão pode usar: as gerais, as das especialidades e as pessoais do próprio profissional. */
  receitas(c: ContextoCadastroCatalogo) {
    return this.ler(c, async (l, _est, usuario) => {
      const prof = usuario ? await this.profissionalDe(l, usuario) : null;
      const rs = await l.consultar(
        `SELECT id, versao, nome, abrangencia, profissional_id, especialidade_medica_id, formato, texto,
                DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS ini, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, ativo
           FROM modelo_receita
          WHERE abrangencia <> 'profissional' OR profissional_id = ?
          ORDER BY nome, id`,
        [prof ?? 0],
        { teto: 5000 },
      );
      const ids = rs.map((r) => num(r['id']));
      const its = ids.length
        ? await l.consultar(
            `SELECT i.modelo_receita_id AS r, i.sequencia, i.item_prescritivel_id, i.descricao_livre, i.dose,
                    i.unidade_prescricao_id, i.quantidade, i.frequencia_administracao_id, i.via_de_uso_id, i.duracao,
                    i.unidade_duracao_tratamento_id, i.uso_continuo, i.posologia, ip.descricao AS item_nome
               FROM modelo_receita_item i LEFT JOIN item_prescritivel ip ON ip.id = i.item_prescritivel_id
              WHERE i.modelo_receita_id IN (${ids.map(() => '?').join(',')}) AND i.ativo AND i.excluido_em IS NULL
              ORDER BY i.modelo_receita_id, i.sequencia`,
            ids,
            { teto: 100_000 },
          )
        : [];
      return rs.map((r) => ({
        id: num(r['id']),
        versao: num(r['versao']),
        nome: String(r['nome']),
        abrangencia: String(r['abrangencia']),
        propria: numOuNull(r['profissional_id']) !== null && numOuNull(r['profissional_id']) === prof,
        especialidade: numOuNull(r['especialidade_medica_id']),
        formato: String(r['formato']),
        texto: txt(r['texto']),
        vigenciaInicio: String(r['ini']),
        vigenciaFim: txt(r['fim']),
        ativo: bool(r['ativo']),
        itens: its
          .filter((i) => num(i['r']) === num(r['id']))
          .map((i) => ({
            sequencia: num(i['sequencia']),
            item: numOuNull(i['item_prescritivel_id']),
            itemNome: txt(i['item_nome']),
            descricaoLivre: txt(i['descricao_livre']),
            dose: numOuNull(i['dose']),
            unidade: numOuNull(i['unidade_prescricao_id']),
            quantidade: numOuNull(i['quantidade']),
            frequencia: numOuNull(i['frequencia_administracao_id']),
            via: numOuNull(i['via_de_uso_id']),
            duracao: numOuNull(i['duracao']),
            unidadeDuracao: numOuNull(i['unidade_duracao_tratamento_id']),
            usoContinuo: bool(i['uso_continuo']),
            posologia: txt(i['posologia']),
          })),
      }));
    });
  }

  /** Tipo gravado do kit (para a rota conferir a permissão pelo tipo que está no banco); null se não existe. */
  tipoDoKit(c: ContextoCadastroCatalogo, kit: number): Promise<string | null> {
    return this.ler(c, async (l) => {
      const k = await l.uma('SELECT tipo_kit FROM kit_prescricao WHERE id = ? AND excluido_em IS NULL', [
        kit,
      ]);
      return k ? String(k['tipo_kit']) : null;
    });
  }

  /**
   * O kit pronto para entrar na prescrição (regra aplicacaoDoKit do domínio): o kit de medicamento vira um item por
   * linha; o de solução, uma solução com os componentes. Cada linha volta com o detalhe sugerido (null quando falta
   * dado para a prescrição, e o prescritor completa).
   */
  kitParaAplicar(c: ContextoCadastroCatalogo, kit: number) {
    return this.ler(c, async (l) => {
      const k = await l.uma(
        `SELECT k.id, k.nome, k.tipo_kit, k.ativo, k.via_de_uso_id, k.frequencia_administracao_id,
                k.velocidade_infusao, k.unidade_infusao_id, COALESCE(v.sigla, v.descricao) AS via_sigla
           FROM kit_prescricao k LEFT JOIN via_de_uso v ON v.id = k.via_de_uso_id
          WHERE k.id = ? AND k.excluido_em IS NULL`,
        [kit],
      );
      if (!k) throw inexistente('O kit');
      const its = await l.consultar(
        `SELECT i.sequencia, i.item_prescritivel_id, i.papel, i.quantidade, i.unidade_prescricao_id,
                i.via_de_uso_id, i.frequencia_administracao_id, up.sigla AS unidade_sigla,
                COALESCE(v.sigla, v.descricao) AS via_sigla, ip.descricao AS item_nome
           FROM kit_prescricao_item i
           LEFT JOIN item_prescritivel ip ON ip.id = i.item_prescritivel_id AND ip.excluido_em IS NULL
           LEFT JOIN unidade_prescricao up ON up.id = i.unidade_prescricao_id
           LEFT JOIN via_de_uso v ON v.id = i.via_de_uso_id
          WHERE i.kit_prescricao_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia, i.id`,
        [kit],
        { teto: 200 },
      );
      const porSeq = new Map(its.map((i) => [num(i['sequencia']), i]));
      const a = aplicacaoDoKit({
        id: kit,
        tipoKit: String(k['tipo_kit']) as (typeof TIPOS_KIT)[number],
        ativo: bool(k['ativo']),
        via: numOuNull(k['via_de_uso_id']),
        frequencia: numOuNull(k['frequencia_administracao_id']),
        velocidade: numOuNull(k['velocidade_infusao']),
        unidadeInfusao: numOuNull(k['unidade_infusao_id']),
        itens: its.map((i) => ({
          sequencia: num(i['sequencia']),
          // O item fora do cadastro vivo não entra (fica para revisar).
          item: i['item_nome'] === null ? null : numOuNull(i['item_prescritivel_id']),
          papel: String(i['papel']) as (typeof PAPEIS_ITEM_KIT)[number],
          quantidade: num(i['quantidade']),
          unidade: numOuNull(i['unidade_prescricao_id']),
          via: numOuNull(i['via_de_uso_id']),
          frequencia: numOuNull(i['frequencia_administracao_id']),
        })),
      });
      const viaSigla = (seq: number) =>
        a.forma === 'solucao'
          ? txt(k['via_sigla'])
          : (txt(porSeq.get(seq)?.['via_sigla']) ?? txt(k['via_sigla']));
      const detalhe = (bruto: unknown) => {
        const r = esquemaDetalheItem.safeParse(bruto);
        return r.success ? r.data : null;
      };
      const linhas = a.linhas.map((x) => ({
        sequencia: x.sequencia,
        papel: x.papel,
        produto: x.item,
        produtoNome: txt(porSeq.get(x.sequencia)?.['item_nome']),
        dose: x.quantidade,
        unidade: txt(porSeq.get(x.sequencia)?.['unidade_sigla']),
        principal: x.principal,
      }));
      const sugestoes =
        a.problema !== null
          ? []
          : a.forma === 'solucao'
            ? [
                detalhe({
                  tipo: 'solucao',
                  via: viaSigla(0),
                  frequencia: numOuNull(k['frequencia_administracao_id']),
                  componentes: linhas.map((x) => ({
                    produto: x.produto,
                    dose: x.dose,
                    unidade: x.unidade,
                    principal: x.principal,
                    etapa: 1,
                  })),
                  etapas: [
                    {
                      etapa: 1,
                      velocidade: numOuNull(k['velocidade_infusao']),
                      unidadeInfusao: numOuNull(k['unidade_infusao_id']),
                    },
                  ],
                }),
              ]
            : a.linhas.map((x) =>
                detalhe({
                  tipo: 'medicamento',
                  item: { produto: x.item },
                  dose: x.quantidade,
                  unidade: txt(porSeq.get(x.sequencia)?.['unidade_sigla']),
                  via: viaSigla(x.sequencia),
                  frequencia: x.frequencia,
                }),
              );
      return {
        kit,
        nome: String(k['nome']),
        tipoKit: String(k['tipo_kit']),
        forma: a.forma,
        problema: a.problema,
        mensagem: a.problema ? MENSAGENS_APLICACAO_KIT[a.problema] : null,
        revisar: a.revisar,
        linhas,
        sugestoes,
      };
    });
  }

  private async profissionalDe(l: Leitor | TxOperacao, usuario: number): Promise<number | null> {
    const p = await l.uma(
      `SELECT profissional_id FROM usuario_profissional
        WHERE usuario_id = ? AND excluido_em IS NULL AND vigencia_fim IS NULL ORDER BY id LIMIT 1`,
      [usuario],
    );
    return p ? num(p['profissional_id']) : null;
  }

  // ── gravação ──────────────────────────────────────────────────────────────────────────────────

  private async contexto(c: ContextoGravacaoCatalogo): Promise<ContextoOperacao> {
    const q = await this.ler(c, async (_l, est, usuario) => ({ est, usuario }));
    if (q.usuario === null)
      throw new ErroOperacao(
        422,
        'usuario-sem-conta',
        'Cadastro recusado',
        'A gravação exige uma conta do cliente.',
      );
    return {
      cliente: this.cliente,
      estabelecimento: q.est,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
  }

  private async executar<E>(
    c: ContextoGravacaoCatalogo,
    nome: string,
    tabela: string,
    esquema: z.ZodType<E>,
    entrada: unknown,
    fn: (tx: TxOperacao, e: E, est: number) => Promise<Gravado>,
  ): Promise<Gravado> {
    const ctx = await this.contexto(c);
    const op = definirOperacao<E, Gravado>({
      nome,
      tabelas: TABELAS,
      entrada: esquema,
      gravar: (tx, e) => fn(tx, e, Number(ctx.estabelecimento)),
      alvo: (_e, r) => ({ tabela, id: r.id }),
    });
    return (await this.executor.executar(op, this.cliente, entrada, ctx)).resultado;
  }

  /** Cabeçalho: inclui ou altera com a versão lida (a linha de outro estabelecimento não se altera daqui). */
  private static async cabecalho(
    tx: TxOperacao,
    tabela: 'protocolo_prescricao' | 'kit_prescricao' | 'modelo_receita',
    e: { id?: number | undefined; versao?: number | undefined },
    valores: Record<string, unknown>,
    oque: string,
    dono?: string,
  ): Promise<Gravado> {
    if (!e.id) return { id: await tx.incluir(tabela, valores), versao: 1 };
    if (!e.versao) recusar([{ codigo: 'versao-obrigatoria', campo: 'versao' }], 400);
    const sql =
      tabela === 'protocolo_prescricao'
        ? `SELECT id FROM protocolo_prescricao WHERE id = ? AND excluido_em IS NULL ${dono ?? ''}`
        : tabela === 'kit_prescricao'
          ? 'SELECT id FROM kit_prescricao WHERE id = ? AND excluido_em IS NULL'
          : `SELECT id FROM modelo_receita WHERE id = ? ${dono ?? ''}`;
    if (!(await tx.uma(sql, [e.id]))) throw inexistente(oque);
    return { id: e.id, versao: await tx.alterar(tabela, e.id, e.versao!, valores) };
  }

  /**
   * Acerta os itens pela sequência: inclui, altera (revivendo) e retira o que saiu. `retirada` é o que marca a linha
   * que saiu (ativo = false ou excluido_em); `revive` o que a faz valer de novo.
   */
  private static async itens<I extends { sequencia: number }>(
    tx: TxOperacao,
    tabela: 'protocolo_prescricao_item' | 'kit_prescricao_item' | 'modelo_receita_item',
    pai: number,
    itens: readonly I[],
    valores: (i: I) => Record<string, unknown>,
    retirada: (tx: TxOperacao) => Record<string, unknown>,
    revive: Record<string, unknown>,
  ): Promise<void> {
    const sql =
      tabela === 'protocolo_prescricao_item'
        ? `SELECT id, versao, sequencia, (ativo AND excluido_em IS NULL) AS vivo FROM protocolo_prescricao_item
            WHERE protocolo_prescricao_id = ? AND componente_de_protocolo_prescricao_item_id IS NULL`
        : tabela === 'kit_prescricao_item'
          ? `SELECT id, versao, sequencia, (excluido_em IS NULL) AS vivo FROM kit_prescricao_item WHERE kit_prescricao_id = ?`
          : `SELECT id, versao, sequencia, (ativo AND excluido_em IS NULL) AS vivo FROM modelo_receita_item
              WHERE modelo_receita_id = ?`;
    const linhas = await tx.consultar(sql, [pai]);
    const versaoDe = new Map(linhas.map((x) => [num(x['id']), num(x['versao'])]));
    const plano = planoDosItens(
      linhas.map((x) => ({ id: num(x['id']), sequencia: num(x['sequencia']), vivo: bool(x['vivo']) })),
      itens.map((i) => i.sequencia),
    );
    const porSeq = new Map(itens.map((i) => [i.sequencia, i]));
    const colunaPai =
      tabela === 'protocolo_prescricao_item'
        ? 'protocolo_prescricao_id'
        : tabela === 'kit_prescricao_item'
          ? 'kit_prescricao_id'
          : 'modelo_receita_id';
    for (const r of plano.retirar) await tx.alterar(tabela, r, versaoDe.get(r)!, retirada(tx));
    for (const a of plano.alterar)
      await tx.alterar(tabela, a.id, versaoDe.get(a.id)!, {
        ...valores(porSeq.get(a.sequencia)!),
        ...revive,
      });
    for (const s of plano.incluir)
      await tx.incluir(tabela, { [colunaPai]: pai, sequencia: s, ...valores(porSeq.get(s)!) });
  }

  /** Protocolo de prescrição com os itens. Código único no cliente; o de outro estabelecimento não se altera. */
  gravarProtocolo(c: ContextoGravacaoCatalogo, entrada: unknown): Promise<Gravado> {
    return this.executar(
      c,
      'pep.protocolos.protocolo_prescricao',
      'protocolo_prescricao',
      esquemaProtocolo as unknown as z.ZodType<EntradaProtocoloApi>,
      entrada,
      async (tx, e, est) => {
        const ps = problemasDoProtocolo(e);
        if (ps.length) recusar(ps);
        const codigo = e.codigo.toUpperCase();
        if (
          await tx.uma('SELECT id FROM protocolo_prescricao WHERE codigo = ? AND id <> ?', [
            codigo,
            e.id ?? 0,
          ])
        )
          recusar([{ codigo: 'codigo-repetido', campo: 'codigo' }], 409);
        await conferirIds(
          tx,
          'item_prescritivel',
          e.itens.flatMap((i) => (i.item ? [i.item] : [])),
          'O item',
        );
        await conferirIds(
          tx,
          'unidade_prescricao',
          e.itens.flatMap((i) => (i.unidade ? [i.unidade] : [])),
          'A unidade',
        );
        // Na alteração o dono não muda: o protocolo geral continua geral (visível em todos os estabelecimentos) e o
        // do estabelecimento continua dele; trocar a abrangência de um protocolo existente é recusado.
        if (e.id) {
          const atual = await tx.uma(
            `SELECT estabelecimento_id FROM protocolo_prescricao
              WHERE id = ? AND excluido_em IS NULL AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
            [e.id, est],
          );
          if (!atual) throw inexistente('O protocolo');
          if ((atual['estabelecimento_id'] === null) !== e.todosEstabelecimentos)
            throw new ErroOperacao(
              422,
              'abrangencia-imutavel',
              'Cadastro recusado',
              'A abrangência do protocolo (todos os estabelecimentos ou só este) não muda depois de criado: crie outro protocolo.',
              { campos: ['todosEstabelecimentos'] },
            );
        }
        const g = await CadastroProtocolosPrescricaoPropria.cabecalho(
          tx,
          'protocolo_prescricao',
          e,
          {
            ...(e.id ? {} : { estabelecimento_id: e.todosEstabelecimentos ? null : est }),
            codigo,
            nome: e.nome,
            tipo: 'protocolo',
            indicacao: e.indicacao,
            sexo: e.sexo,
            idade_minima_anos: e.idadeMin,
            idade_maxima_anos: e.idadeMax,
            peso_minimo_kg: e.pesoMin,
            peso_maximo_kg: e.pesoMax,
            vigencia_inicio: e.vigenciaInicio,
            vigencia_fim: e.vigenciaFim,
            ativo: e.ativo,
          },
          'O protocolo',
          `AND (estabelecimento_id IS NULL OR estabelecimento_id = ${Number(est)})`,
        );
        await CadastroProtocolosPrescricaoPropria.itens(
          tx,
          'protocolo_prescricao_item',
          g.id,
          e.itens,
          (i) => ({
            tipo_item: i.tipoItem,
            item_prescritivel_id: i.item,
            descricao: i.descricao,
            dose_padrao: i.dose,
            unidade_prescricao_id: i.unidade,
            quantidade: i.quantidade,
            frequencia_administracao_id: i.frequencia,
            via_de_uso_id: i.via,
            se_necessario: i.seNecessario,
            pre_selecionado: i.preSelecionado,
            observacao: i.observacao,
          }),
          () => ({ ativo: false }),
          { ativo: true },
        );
        return g;
      },
    );
  }

  /** Kit de medicamentos ou de soluções com os itens. O item que sai fica excluído (autor e hora), não apagado. */
  gravarKit(c: ContextoGravacaoCatalogo, entrada: unknown): Promise<Gravado> {
    return this.executar(
      c,
      'pep.protocolos.kit_prescricao',
      'kit_prescricao',
      esquemaKit as unknown as z.ZodType<EntradaKitApi>,
      entrada,
      async (tx, e) => {
        const ps = problemasDoKit(e);
        if (ps.length) recusar(ps);
        const codigo = e.codigo.toUpperCase();
        if (await tx.uma('SELECT id FROM kit_prescricao WHERE codigo = ? AND id <> ?', [codigo, e.id ?? 0]))
          recusar([{ codigo: 'codigo-repetido', campo: 'codigo' }], 409);
        await conferirIds(
          tx,
          'item_prescritivel',
          [...(e.item ? [e.item] : []), ...e.itens.flatMap((i) => (i.item ? [i.item] : []))],
          'O item',
        );
        await conferirIds(
          tx,
          'unidade_prescricao',
          e.itens.flatMap((i) => (i.unidade ? [i.unidade] : [])),
          'A unidade',
        );
        // O tipo do kit não muda na alteração: a permissão de quem grava é conferida pelo tipo (medicamento ou
        // solução), e trocar o tipo passaria por cima da permissão do outro.
        if (e.id) {
          const atual = await tx.uma(
            'SELECT tipo_kit FROM kit_prescricao WHERE id = ? AND excluido_em IS NULL',
            [e.id],
          );
          if (!atual) throw inexistente('O kit');
          if (String(atual['tipo_kit']) !== e.tipoKit)
            throw new ErroOperacao(
              422,
              'tipo-kit-imutavel',
              'Cadastro recusado',
              'O tipo do kit não muda depois de criado: crie outro kit.',
              { campos: ['tipoKit'] },
            );
        }
        const g = await CadastroProtocolosPrescricaoPropria.cabecalho(
          tx,
          'kit_prescricao',
          e,
          {
            codigo,
            nome: e.nome,
            tipo_kit: e.tipoKit,
            item_prescritivel_id: e.item,
            via_de_uso_id: e.via,
            frequencia_administracao_id: e.frequencia,
            intervalo_dose_inicial: e.doseInicial,
            intervalo_dose_final: e.doseFinal,
            velocidade_infusao: e.velocidade,
            unidade_infusao_id: e.unidadeInfusao,
            ativo: e.ativo,
          },
          'O kit',
        );
        await CadastroProtocolosPrescricaoPropria.itens(
          tx,
          'kit_prescricao_item',
          g.id,
          e.itens,
          (i) => ({
            item_prescritivel_id: i.item,
            papel: i.papel,
            quantidade: i.quantidade,
            unidade_prescricao_id: i.unidade,
            via_de_uso_id: i.via,
            frequencia_administracao_id: i.frequencia,
            faturavel: i.faturavel,
            observacao: i.observacao,
          }),
          (t) => ({ excluido_em: new Date(), excluido_por: t.contexto.usuario }),
          { excluido_em: null, excluido_por: null },
        );
        return g;
      },
    );
  }

  /**
   * Receita padrão com os itens. A pessoal é sempre do profissional da sessão (e só ele a altera); a geral e a da
   * especialidade, de quem cuida dos protocolos (a rota confere a permissão).
   */
  gravarReceita(c: ContextoGravacaoCatalogo, entrada: unknown): Promise<Gravado> {
    return this.executar(
      c,
      'pep.protocolos.modelo_receita',
      'modelo_receita',
      esquemaReceita as unknown as z.ZodType<EntradaReceitaApi>,
      entrada,
      async (tx, e) => {
        const prof = await this.profissionalDe(tx, Number(tx.contexto.usuario));
        const profissional = e.abrangencia === 'profissional' ? prof : null;
        const ps = problemasDaReceitaPadrao({ ...e, profissional });
        if (ps.length) recusar(ps);
        await conferirIds(
          tx,
          'item_prescritivel',
          e.itens.flatMap((i) => (i.item ? [i.item] : [])),
          'O item',
        );
        await conferirIds(
          tx,
          'unidade_prescricao',
          e.itens.flatMap((i) => (i.unidade ? [i.unidade] : [])),
          'A unidade',
        );
        // A receita pessoal de outro profissional não se altera daqui (nem vira geral).
        const dono = `AND (abrangencia <> 'profissional' OR profissional_id = ${Number(prof ?? 0)})`;
        const g = await CadastroProtocolosPrescricaoPropria.cabecalho(
          tx,
          'modelo_receita',
          e,
          {
            nome: e.nome,
            abrangencia: e.abrangencia,
            profissional_id: profissional,
            especialidade_medica_id: e.abrangencia === 'especialidade' ? e.especialidade : null,
            formato: e.formato,
            texto: e.texto,
            vigencia_inicio: `${e.vigenciaInicio} 00:00:00`,
            vigencia_fim: e.vigenciaFim ? `${e.vigenciaFim} 23:59:59` : null,
            ativo: e.ativo,
          },
          'A receita padrão',
          dono,
        );
        await CadastroProtocolosPrescricaoPropria.itens(
          tx,
          'modelo_receita_item',
          g.id,
          e.formato === 'estruturada' ? e.itens : [],
          (i) => ({
            item_prescritivel_id: i.item,
            descricao_livre: i.descricaoLivre,
            dose: i.dose,
            unidade_prescricao_id: i.unidade,
            quantidade: i.quantidade,
            frequencia_administracao_id: i.frequencia,
            via_de_uso_id: i.via,
            duracao: i.duracao,
            unidade_duracao_tratamento_id: i.unidadeDuracao,
            uso_continuo: i.usoContinuo,
            posologia: i.posologia,
          }),
          () => ({ ativo: false }),
          { ativo: true },
        );
        return g;
      },
    );
  }
}
