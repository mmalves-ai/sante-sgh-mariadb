// Respostas e textos padrão do catálogo do diagnóstico no MariaDB do cliente (F3.5, análise 05-SADT linha 3):
//   - o grupo de respostas fechadas (rede) com as respostas dele numa gravação só: inclui, altera só o enviado (com a
//     versão vista do grupo), muda a ordem das respostas sem esbarrar na unicidade, e a resposta sai por inativação,
//     nunca apagada (o resultado antigo continua apontando para ela). Grupo em uso por analito de exame não inativa;
//   - o texto padrão do resultado do exame (observação pronta com atalho): inclui, altera só o enviado, inativa.
// A regra é do domínio (validarGrupoResposta, validarTextoPadrao); a trilha vai na mesma transação (Executor).
import { validarGrupoResposta, validarTextoPadrao } from '@sgh/dominio-sadt';
import {
  definirOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  camel,
  colunas,
  type ContextoCatalogo,
  inexistente,
  recusar,
  soEnviados,
} from './catalogo-porta-propria.js';

export const RESPOSTAS_SADT = Symbol('RESPOSTAS_SADT');

const id = z.number().int().positive();
const versao = z.number().int().positive().optional();
const atalho = z
  .string()
  .trim()
  .max(40)
  .nullable()
  .default(null)
  .transform((v) => v || null);

export const esquemaRespostaPadrao = z
  .object({
    id: id.optional(),
    sequencia: z.number().int(),
    codigo: z.string().trim().max(60),
    descricao: z.string().trim().max(600),
    mnemonico: atalho,
    anormal: z.boolean().default(false),
    critico: z.boolean().default(false),
    contagioso: z.boolean().default(false),
    exigeConfirmacao: z.boolean().default(false),
    padrao: z.boolean().default(false),
    ativo: z.boolean().default(true),
  })
  .strict();

export const esquemaGrupoResposta = z
  .object({
    versao,
    codigo: z.string().trim().max(60),
    descricao: z.string().trim().max(150),
    tipo: z.string().trim().max(30).default('qualitativo'),
    permiteTextoLivre: z.boolean().default(false),
    ativo: z.boolean().default(true),
    /** As respostas enviadas: com id altera a existente; sem id inclui. A que não veio continua como está. */
    respostas: z.array(esquemaRespostaPadrao).max(200).default([]),
  })
  .strict();

export const esquemaTextoPadrao = z
  .object({
    id: id.optional(),
    versao,
    exameId: id,
    codigo: z.string().trim().max(60),
    descricao: z.string().trim().max(300),
    texto: z.string().trim().max(8000),
    mnemonico: atalho,
    aplicacao: z.string().trim().max(20).default('resultado'),
    materialBiologicoId: id.nullable().default(null),
    ativo: z.boolean().default(true),
  })
  .strict();

const TABELAS = ['grupo_resposta', 'resposta_padrao', 'texto_padrao_resultado'];
const CAMPOS_RESPOSTA = [
  'sequencia',
  'codigo',
  'descricao',
  'mnemonico',
  'anormal',
  'critico',
  'contagioso',
  'exigeConfirmacao',
  'padrao',
  'ativo',
] as const;
/** Ordem provisória das respostas que trocam de lugar (a unicidade da ordem no grupo vale a cada linha gravada). */
const ORDEM_PROVISORIA = 50_000;

type Resposta = z.infer<typeof esquemaRespostaPadrao>;

export class PortaRespostasSadtPropria {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoCatalogo, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: c.cliente, correlacao: (c.correlacao || 'sadt.catalogo').slice(0, 64) },
      fn,
    );
  }

  private async gravar<T extends { id: number }>(
    c: ContextoCatalogo,
    evento: string,
    tabela: string,
    fn: (tx: TxOperacao) => Promise<T>,
  ): Promise<T> {
    let saida: T | null = null;
    const op = definirOperacao({
      nome: `sadt.catalogo.${evento}`,
      tabelas: TABELAS,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = await fn(tx);
        return { resultado: JSON.stringify(saida) };
      },
      alvo: () => ({ tabela, id: saida?.id ?? null }),
      trilha: () => ({ dados: { evento: `sadt.catalogo.${evento}` } }),
    });
    const chave = `sadt.catalogo:${c.chaveIdempotencia ?? randomUUID()}`;
    const r = await this.executor.executar(op, c.cliente, { chave }, { ...c, chaveIdempotencia: chave });
    if (saida) return saida;
    return JSON.parse(String(r.resultado['resultado'] ?? 'null')) as T;
  }

  /** Os grupos de respostas da rede (ativos e inativos), com as respostas na ordem e em quantos analitos de exame estão. */
  grupos(c: ContextoCatalogo, termo: string) {
    const t = `%${termo.trim()}%`;
    return this.ler(c, async (l) => {
      const grupos = await l.consultar(
        `SELECT g.*, (SELECT COUNT(*) FROM exame_analito ea
                       WHERE ea.grupo_resposta_id = g.id AND ea.ativo = TRUE AND ea.excluido_em IS NULL) AS em_uso
           FROM grupo_resposta g WHERE g.codigo LIKE ? OR g.descricao LIKE ?
          ORDER BY g.ativo DESC, g.descricao, g.id LIMIT 300`,
        [t, t],
      );
      const ids = grupos.map((g) => Number(g['id']));
      const respostas = ids.length
        ? await l.consultar(
            `SELECT * FROM resposta_padrao WHERE grupo_resposta_id IN (${ids.map(() => '?').join(',')})
                AND excluido_em IS NULL ORDER BY grupo_resposta_id, sequencia`,
            ids,
          )
        : [];
      return grupos.map(
        (g): Record<string, unknown> & { emUso: number; respostas: Record<string, unknown>[] } => ({
          ...camel(g),
          emUso: Number(g['em_uso']),
          respostas: respostas.filter((r) => Number(r['grupo_resposta_id']) === Number(g['id'])).map(camel),
        }),
      );
    });
  }

  /**
   * Inclui (sem id) ou altera (com id e a versão vista) o grupo e as respostas dele. A regra do domínio é conferida
   * sobre o grupo como fica (o do banco com o que mudou). Nada é apagado.
   */
  salvarGrupo(c: ContextoCatalogo, grupoId: number | null, entrada: unknown) {
    const enviado = grupoId
      ? soEnviados(esquemaGrupoResposta, entrada)
      : (esquemaGrupoResposta.parse(entrada) as Record<string, unknown>);
    const enviadas = (enviado['respostas'] as Resposta[] | undefined) ?? [];
    return this.gravar(
      c,
      grupoId ? 'grupo-resposta-alterado' : 'grupo-resposta-incluido',
      'grupo_resposta',
      async (tx) => {
        const [atual] = grupoId
          ? await tx.consultarParaAtualizar(`SELECT * FROM grupo_resposta WHERE id = ?`, [grupoId])
          : [null];
        if (grupoId && !atual) throw inexistente('O grupo de respostas');
        const gravadas = grupoId
          ? await tx.consultarParaAtualizar(
              `SELECT * FROM resposta_padrao WHERE grupo_resposta_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
              [grupoId],
            )
          : [];
        const antes = new Map(gravadas.map((r) => [Number(r['id']), camel(r)]));
        for (const r of enviadas) if (r.id !== undefined && !antes.has(r.id)) throw inexistente('A resposta');
        const { respostas: _r, ...doGrupo } = enviado;
        void _r;
        const fica = { ...(atual ? camel(atual) : {}), ...doGrupo } as Record<string, unknown>;
        const comoFicam = [
          ...[...antes.entries()].map(([rid, r]) => ({
            ...r,
            ...(enviadas.find((x) => x.id === rid) ?? {}),
          })),
          ...enviadas.filter((r) => r.id === undefined),
        ] as Record<string, unknown>[];
        const falhas = validarGrupoResposta({
          codigo: String(fica['codigo'] ?? ''),
          descricao: String(fica['descricao'] ?? ''),
          tipo: String(fica['tipo'] ?? ''),
          ativo: Boolean(fica['ativo']),
          respostas: comoFicam.map((r) => ({
            sequencia: Number(r['sequencia']),
            codigo: String(r['codigo'] ?? ''),
            descricao: String(r['descricao'] ?? ''),
            mnemonico: (r['mnemonico'] as string | null) ?? null,
            anormal: Boolean(r['anormal']),
            critico: Boolean(r['critico']),
            padrao: Boolean(r['padrao']),
            ativo: Boolean(r['ativo']),
          })),
        });
        if (falhas.length) recusar(falhas);
        const duplicado = await tx.consultar(
          `SELECT id FROM grupo_resposta WHERE codigo = ? AND id <> ? LIMIT 1`,
          [fica['codigo'], grupoId ?? 0],
        );
        if (duplicado.length) recusar([{ campo: 'codigo', mensagem: 'Já existe grupo com este código.' }]);
        if (grupoId && atual && !fica['ativo'] && camel(atual)['ativo']) {
          const [uso] = await tx.consultar(
            `SELECT COUNT(*) AS q FROM exame_analito WHERE grupo_resposta_id = ? AND ativo = TRUE AND excluido_em IS NULL`,
            [grupoId],
          );
          if (Number(uso?.['q']) > 0)
            recusar([
              {
                campo: 'ativo',
                mensagem: `O grupo está em ${Number(uso?.['q'])} analito(s) de exame: troque o grupo neles antes de inativar.`,
              },
            ]);
        }
        let alvo: number;
        let versaoNova = 1;
        if (grupoId) {
          // A versão do grupo sobe a cada gravação, mesmo quando só as respostas mudam (é a trava do conjunto).
          versaoNova = await tx.alterar('grupo_resposta', grupoId, Number(enviado['versao'] ?? 0), {
            descricao: fica['descricao'],
            ...colunas(doGrupo),
          });
          alvo = grupoId;
        } else alvo = await tx.incluir('grupo_resposta', colunas(doGrupo));
        // Respostas existentes que mudam: as que trocam de ordem saem primeiro para uma ordem provisória.
        const mudam = enviadas.filter((r) => {
          const a = r.id === undefined ? null : antes.get(r.id);
          return a && CAMPOS_RESPOSTA.some((k) => (a[k] ?? null) !== (r[k] ?? null));
        });
        const versoes = new Map(gravadas.map((r) => [Number(r['id']), Number(r['versao'])]));
        let i = 0;
        for (const r of mudam) {
          const rid = r.id as number;
          if (Number(antes.get(rid)?.['sequencia']) === r.sequencia) continue;
          versoes.set(
            rid,
            await tx.alterar('resposta_padrao', rid, versoes.get(rid) ?? 0, {
              sequencia: ORDEM_PROVISORIA + ++i,
            }),
          );
        }
        for (const r of mudam) {
          const rid = r.id as number;
          await tx.alterar('resposta_padrao', rid, versoes.get(rid) ?? 0, colunas(r));
        }
        for (const r of enviadas.filter((x) => x.id === undefined))
          await tx.incluir('resposta_padrao', { ...colunas(r), grupo_resposta_id: alvo });
        return { id: alvo, versao: versaoNova };
      },
    );
  }

  /** Os textos padrão do exame (ativos e inativos). */
  textos(c: ContextoCatalogo, exameId: number) {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT * FROM texto_padrao_resultado WHERE exame_id = ? ORDER BY ativo DESC, descricao, id LIMIT 500`,
          [exameId],
        )
      ).map(camel),
    );
  }

  /** Inclui ou altera (só o enviado, com a versão vista) o texto padrão do exame; sair é inativar. */
  salvarTexto(c: ContextoCatalogo, entrada: unknown) {
    const bruto = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
    const alteracao = bruto['id'] !== undefined && bruto['id'] !== null;
    const enviado = alteracao
      ? soEnviados(esquemaTextoPadrao, bruto)
      : (esquemaTextoPadrao.parse(bruto) as Record<string, unknown>);
    const tid = alteracao ? Number(enviado['id']) : null;
    return this.gravar(
      c,
      tid ? 'texto-padrao-alterado' : 'texto-padrao-incluido',
      'texto_padrao_resultado',
      async (tx) => {
        const [atual] = tid
          ? await tx.consultarParaAtualizar(`SELECT * FROM texto_padrao_resultado WHERE id = ?`, [tid])
          : [null];
        if (tid && !atual) throw inexistente('O texto padrão');
        const fica = { ...(atual ? camel(atual) : {}), ...enviado } as Record<string, unknown>;
        if (atual && Number(atual['exame_id']) !== Number(fica['exameId']))
          throw inexistente('O texto padrão');
        const [ex] = await tx.consultar(`SELECT id FROM exame WHERE id = ? AND excluido_em IS NULL`, [
          fica['exameId'],
        ]);
        if (!ex) throw inexistente('O exame');
        const falhas = validarTextoPadrao({
          codigo: String(fica['codigo'] ?? ''),
          descricao: String(fica['descricao'] ?? ''),
          texto: String(fica['texto'] ?? ''),
          mnemonico: (fica['mnemonico'] as string | null) ?? null,
          aplicacao: String(fica['aplicacao'] ?? ''),
        });
        if (falhas.length) recusar(falhas);
        const duplicado = await tx.consultar(
          `SELECT id FROM texto_padrao_resultado WHERE codigo = ? AND id <> ? LIMIT 1`,
          [fica['codigo'], tid ?? 0],
        );
        if (duplicado.length)
          recusar([{ campo: 'codigo', mensagem: 'Já existe texto padrão com este código.' }]);
        if (fica['ativo'] && fica['mnemonico']) {
          const mesmo = await tx.consultar(
            `SELECT id FROM texto_padrao_resultado WHERE exame_id = ? AND mnemonico = ? AND ativo = TRUE AND id <> ? LIMIT 1`,
            [fica['exameId'], fica['mnemonico'], tid ?? 0],
          );
          if (mesmo.length)
            recusar([{ campo: 'mnemonico', mensagem: 'Outro texto ativo deste exame já usa este atalho.' }]);
        }
        const valores = colunas(enviado);
        if (!tid) return { id: await tx.incluir('texto_padrao_resultado', valores), versao: 1 };
        return {
          id: tid,
          versao: await tx.alterar('texto_padrao_resultado', tid, Number(enviado['versao'] ?? 0), valores),
        };
      },
    );
  }
}
