// Cadastro do antibiograma no banco do cliente (F7, 05-SADT linha 12): os painéis de antimicrobianos (com a ordem do
// laudo, a cascata e o marcador de multirresistência) e os pontos de corte por norma e versão, que a cultura usa para
// interpretar a CIM e o halo. A regra mora em @sgh/dominio-sadt (microbiologia/cadastro-antibiograma.ts).
// Nada se apaga: o item que sai do painel recebe exclusão lógica (volta se for informado de novo); o painel encerrado
// fica inativo; o ponto de corte já usado numa interpretação não muda (encerra-se e cria-se a versão nova, que encerra a
// anterior na véspera sozinha). Toda alteração exige a versão lida. Cada gravação vai à trilha na mesma transação.
import {
  conferirPainel,
  conferirPontoCorte,
  normaDoCadastro,
  pontosAEncerrar,
  RecusaMicrobiologia,
} from '@sgh/dominio-sadt';
import { type ContextoNucleo, definirOperacao, type Executor, recusa, type TxOperacao } from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { NucleoSadt } from '../porta-propria.js';
import type { ContextoSadt } from '../porta.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const sim = (v: unknown) => Boolean(Number(v ?? 0));
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);

export const TABELAS_CADASTRO_MICROBIOLOGIA = [
  'painel_antibiograma',
  'painel_antibiograma_item',
  'ponto_corte_antimicrobiano',
  'microrganismo',
] as const;

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const esquemaPainel = z.object({
  codigo: z.string().trim().min(1).max(30),
  descricao: z.string().trim().min(3).max(150),
  microrganismo: id.nullable().default(null),
  material: id.nullable().default(null),
  metodo: z.enum(['disco_difusao', 'concentracao_inibitoria', 'gradiente', 'automatizado']),
  norma: z.string().trim().min(1).max(30),
  ativo: z.boolean().default(true),
  /** Torna o painel o padrão do microrganismo do painel (a cultura o usa quando o isolado não escolhe outro). */
  padraoDoMicrorganismo: z.boolean().default(false),
  /** Versão lida: obrigatória para alterar. */
  versao: z.number().int().min(1).nullable().default(null),
  itens: z
    .array(
      z.object({
        antimicrobiano: id,
        exibeNoLaudo: z.boolean().default(true),
        liberacaoRestrita: z.boolean().default(false),
        indicaMultirresistencia: z.boolean().default(false),
      }),
    )
    .max(80),
});

export const esquemaPonto = z.object({
  microrganismo: id,
  antimicrobiano: id,
  material: id.nullable().default(null),
  metodo: z.enum(['concentracao_inibitoria', 'disco_difusao']),
  norma: z.string().trim().min(1).max(30),
  versaoNorma: z.string().trim().min(1).max(30),
  sensivelAte: z.number().min(0).max(100_000_000).nullable().default(null),
  resistenteAcima: z.number().min(0).max(100_000_000).nullable().default(null),
  haloSensivelMinimo: z.number().min(0).max(9999).nullable().default(null),
  haloResistenteMaximo: z.number().min(0).max(9999).nullable().default(null),
  vigenciaInicio: data,
  vigenciaFim: data.nullable().default(null),
});

export const esquemaEncerrarPonto = z.object({
  versao: z.number().int().min(1),
  vigenciaFim: data,
});

const daRegra = <T>(f: () => T): T => {
  try {
    return f();
  } catch (e) {
    if (e instanceof RecusaMicrobiologia) throw recusa(e.codigo, e.message);
    throw e;
  }
};

const pontoLido = (r: Linha) => ({
  id: n(r['id']),
  microrganismo: n(r['microrganismo_id']),
  microrganismoNome: String(r['microrganismo_nome'] ?? ''),
  antimicrobiano: n(r['antimicrobiano_id']),
  antimicrobianoNome: String(r['antimicrobiano_nome'] ?? ''),
  material: nn(r['material_biologico_id']),
  metodo: String(r['metodo']) as 'concentracao_inibitoria' | 'disco_difusao',
  norma: String(r['norma'] ?? ''),
  versaoNorma: String(r['versao_norma'] ?? ''),
  sensivelAte: nn(r['sensivel_ate']),
  resistenteAcima: nn(r['resistente_acima']),
  haloSensivelMinimo: nn(r['halo_sensivel_minimo_mm']),
  haloResistenteMaximo: nn(r['halo_resistente_maximo_mm']),
  vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
  vigenciaFim: dataIso(r['vigencia_fim']),
  ativo: sim(r['ativo']),
  versao: n(r['versao']),
  emUso: n(r['em_uso']) > 0,
});

export class ServicoCadastroMicrobiologia {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoSadt,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ctxNucleo(c: ContextoSadt): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: (c.correlacao || 'sadt-micro-cad').slice(0, 64),
    };
  }

  private est(c: ContextoSadt): number {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return c.estabelecimento;
  }

  private async gravar<T extends Record<string, unknown>>(
    c: ContextoSadt,
    nome: string,
    tabela: string,
    fn: (tx: TxOperacao) => Promise<T & { id: number }>,
  ): Promise<T & { id: number }> {
    this.est(c);
    let feito: (T & { id: number }) | null = null;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS_CADASTRO_MICROBIOLOGIA,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        feito = await fn(tx);
        return { id: feito.id };
      },
      alvo: () => ({ tabela, id: feito?.id ?? null }),
      trilha: () => ({ dados: { evento: nome, ...(feito ?? {}) }, motivo: null }),
    });
    const chave = `sadt-micro-cad:${c.chaveIdempotencia ?? randomUUID()}`;
    await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...this.ctxNucleo(c), chaveIdempotencia: chave },
    );
    return feito!;
  }

  /** Os pontos de corte (do microrganismo, quando informado), com a marca de uso numa interpretação. */
  pontos(c: ContextoSadt, filtro: { microrganismo?: number | null }) {
    this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const rs = await l.consultar(
        `SELECT pc.*, mo.descricao AS microrganismo_nome, am.descricao AS antimicrobiano_nome,
                (SELECT COUNT(*) FROM resultado_sensibilidade rs WHERE rs.ponto_corte_antimicrobiano_id = pc.id) AS em_uso
           FROM ponto_corte_antimicrobiano pc
           JOIN microrganismo mo ON mo.id = pc.microrganismo_id
           JOIN antimicrobiano am ON am.id = pc.antimicrobiano_id
          WHERE (? IS NULL OR pc.microrganismo_id = ?)
          ORDER BY mo.descricao, am.descricao, pc.norma, pc.vigencia_inicio DESC LIMIT 2000`,
        [filtro.microrganismo ?? null, filtro.microrganismo ?? null],
      );
      return rs.map(pontoLido);
    });
  }

  /** Cria (id nulo) ou altera o painel com os itens na ordem do laudo. */
  async gravarPainel(c: ContextoSadt, painelId: number | null, entrada: unknown) {
    const e = esquemaPainel.parse(entrada);
    const norma = daRegra(() => normaDoCadastro(e.norma));
    const itens = daRegra(() => conferirPainel(e.itens));
    if (e.padraoDoMicrorganismo && e.microrganismo === null)
      throw recusa('painel-sem-microrganismo', 'Só o painel de um microrganismo vira o padrão dele.');
    if (e.padraoDoMicrorganismo && !e.ativo)
      throw recusa('painel-inativo-padrao', 'O painel inativo não pode ser o padrão do microrganismo.');
    return this.gravar(
      c,
      painelId === null ? 'sadt.microbiologia.painel.criado' : 'sadt.microbiologia.painel.alterado',
      'painel_antibiograma',
      async (tx) => {
        const repetido = await tx.uma('SELECT id FROM painel_antibiograma WHERE codigo = ? AND id <> ?', [
          e.codigo,
          painelId ?? 0,
        ]);
        if (repetido) throw recusa('codigo-repetido', 'Já existe painel com este código.');
        const amIds = itens.map((i) => i.antimicrobiano);
        const ams = await tx.consultar(
          `SELECT id FROM antimicrobiano WHERE id IN (${amIds.map(() => '?').join(', ')})`,
          amIds,
        );
        if (ams.length !== amIds.length)
          throw recusa('antimicrobiano-inexistente', 'Antimicrobiano não cadastrado.');
        const cab = {
          codigo: e.codigo,
          descricao: e.descricao,
          microrganismo_id: e.microrganismo,
          material_biologico_id: e.material,
          metodo: e.metodo,
          norma_referencia: norma,
          ativo: e.ativo,
        };
        let pid: number;
        if (painelId === null) pid = await tx.incluir('painel_antibiograma', cab);
        else {
          const atual = await tx.uma('SELECT id, versao FROM painel_antibiograma WHERE id = ?', [painelId]);
          if (!atual) throw recusa('nao-encontrado', 'O painel não existe.');
          if (e.versao === null || e.versao !== n(atual['versao']))
            throw recusa('conflito-versao', 'O painel mudou desde a leitura; abra de novo.');
          await tx.alterar('painel_antibiograma', painelId, n(atual['versao']), cab);
          pid = painelId;
        }
        // Itens: primeiro todos saem para sequências provisórias (evita colisão na chave única da ordem); depois os
        // informados ficam 1..n e os que saíram recebem exclusão lógica (o histórico do painel fica).
        const antigos = await tx.consultar(
          'SELECT id, versao, antimicrobiano_id, excluido_em FROM painel_antibiograma_item WHERE painel_antibiograma_id = ? ORDER BY id',
          [pid],
        );
        const versoes = new Map<number, number>();
        for (const [k, a] of antigos.entries()) {
          await tx.alterar('painel_antibiograma_item', n(a['id']), n(a['versao']), { sequencia: 30000 + k });
          versoes.set(n(a['id']), n(a['versao']) + 1);
        }
        const porAm = new Map(antigos.map((a) => [n(a['antimicrobiano_id']), a]));
        const agora = new Date();
        for (const i of itens) {
          const v = {
            sequencia: i.sequencia,
            exibe_no_laudo: i.exibeNoLaudo,
            liberacao_restrita: i.liberacaoRestrita,
            indica_multirresistencia: i.indicaMultirresistencia,
            excluido_em: null,
            excluido_por: null,
          };
          const a = porAm.get(i.antimicrobiano);
          porAm.delete(i.antimicrobiano);
          if (a) await tx.alterar('painel_antibiograma_item', n(a['id']), versoes.get(n(a['id']))!, v);
          else
            await tx.incluir('painel_antibiograma_item', {
              painel_antibiograma_id: pid,
              antimicrobiano_id: i.antimicrobiano,
              ...v,
            });
        }
        let retirados = 0;
        for (const a of porAm.values())
          if (a['excluido_em'] === null) {
            await tx.alterar('painel_antibiograma_item', n(a['id']), versoes.get(n(a['id']))!, {
              excluido_em: agora,
              excluido_por: tx.contexto.usuario,
            });
            retirados++;
          }
        if (e.padraoDoMicrorganismo) {
          const mo = await tx.uma('SELECT id, versao FROM microrganismo WHERE id = ?', [e.microrganismo]);
          if (!mo) throw recusa('microrganismo-inexistente', 'Microrganismo não cadastrado.');
          await tx.alterar('microrganismo', n(mo['id']), n(mo['versao']), { painel_antibiograma_id: pid });
        }
        // O painel desativado deixa de ser o padrão dos microrganismos: a cultura não acharia um painel inativo.
        let padroesLimpos = 0;
        if (!e.ativo)
          for (const mo of await tx.consultar(
            'SELECT id, versao FROM microrganismo WHERE painel_antibiograma_id = ? ORDER BY id',
            [pid],
          )) {
            await tx.alterar('microrganismo', n(mo['id']), n(mo['versao']), { painel_antibiograma_id: null });
            padroesLimpos++;
          }
        return { id: pid, itens: itens.length, retirados, padrao: e.padraoDoMicrorganismo, padroesLimpos };
      },
    );
  }

  /** Cria o ponto de corte; o da mesma norma e par que ainda vale é encerrado na véspera do novo. */
  async criarPonto(c: ContextoSadt, entrada: unknown) {
    const e = esquemaPonto.parse(entrada);
    const p = daRegra(() => conferirPontoCorte(e));
    return this.gravar(
      c,
      'sadt.microbiologia.ponto-corte.criado',
      'ponto_corte_antimicrobiano',
      async (tx) => {
        const mo = await tx.uma('SELECT id FROM microrganismo WHERE id = ?', [p.microrganismo]);
        const am = await tx.uma('SELECT id FROM antimicrobiano WHERE id = ?', [p.antimicrobiano]);
        if (!mo || !am)
          throw recusa('cadastro-inexistente', 'Microrganismo ou antimicrobiano não cadastrado.');
        if (
          p.material !== null &&
          !(await tx.uma('SELECT id FROM material_biologico WHERE id = ?', [p.material]))
        )
          throw recusa('material-inexistente', 'O material biológico não existe.');
        const existentes = (
          await tx.consultar(
            'SELECT * FROM ponto_corte_antimicrobiano WHERE microrganismo_id = ? AND antimicrobiano_id = ?',
            [p.microrganismo, p.antimicrobiano],
          )
        ).map(pontoLido);
        if (
          existentes.some(
            (x) =>
              x.material === p.material &&
              x.metodo === p.metodo &&
              x.norma.toLowerCase() === p.norma.toLowerCase() &&
              x.versaoNorma.toLowerCase() === p.versaoNorma.toLowerCase(),
          )
        )
          throw recusa(
            'versao-norma-repetida',
            'Esta versão da norma já tem ponto para o par: crie outra versão.',
          );
        const fecha = daRegra(() => pontosAEncerrar(existentes, p));
        for (const f of fecha) {
          const x = existentes.find((y) => y.id === f.id)!;
          await tx.alterar('ponto_corte_antimicrobiano', x.id, x.versao, { vigencia_fim: f.vigenciaFim });
        }
        const novo = await tx.incluir('ponto_corte_antimicrobiano', {
          microrganismo_id: p.microrganismo,
          antimicrobiano_id: p.antimicrobiano,
          material_biologico_id: p.material,
          metodo: p.metodo,
          norma: p.norma,
          versao_norma: p.versaoNorma,
          sensivel_ate: p.sensivelAte,
          resistente_acima: p.resistenteAcima,
          halo_sensivel_minimo_mm: p.haloSensivelMinimo,
          halo_resistente_maximo_mm: p.haloResistenteMaximo,
          vigencia_inicio: p.vigenciaInicio,
          vigencia_fim: p.vigenciaFim,
          ativo: true,
        });
        return { id: novo, encerrados: fecha.map((f) => f.id) };
      },
    );
  }

  /** Corrige o ponto de corte ainda não usado em nenhuma interpretação; o usado recusa (encerre e crie outro). */
  async alterarPonto(c: ContextoSadt, pontoId: number, entrada: unknown) {
    const e = esquemaPonto.extend({ versao: z.number().int().min(1) }).parse(entrada);
    const p = daRegra(() => conferirPontoCorte(e));
    return this.gravar(
      c,
      'sadt.microbiologia.ponto-corte.alterado',
      'ponto_corte_antimicrobiano',
      async (tx) => {
        const atual = await this.pontoParaMudar(tx, pontoId, e.versao);
        if (atual.emUso)
          throw recusa(
            'ponto-em-uso',
            'O ponto já interpretou antibiograma: encerre a vigência e crie a versão nova.',
          );
        if (atual.microrganismo !== p.microrganismo || atual.antimicrobiano !== p.antimicrobiano)
          throw recusa('ponto-outro-par', 'O par do ponto não muda: crie outro ponto.');
        await tx.alterar('ponto_corte_antimicrobiano', pontoId, e.versao, {
          material_biologico_id: p.material,
          metodo: p.metodo,
          norma: p.norma,
          versao_norma: p.versaoNorma,
          sensivel_ate: p.sensivelAte,
          resistente_acima: p.resistenteAcima,
          halo_sensivel_minimo_mm: p.haloSensivelMinimo,
          halo_resistente_maximo_mm: p.haloResistenteMaximo,
          vigencia_inicio: p.vigenciaInicio,
          vigencia_fim: p.vigenciaFim,
        });
        return { id: pontoId };
      },
    );
  }

  /** Encerra a vigência do ponto de corte (a interpretação já feita fica com ele). */
  async encerrarPonto(c: ContextoSadt, pontoId: number, entrada: unknown) {
    const e = esquemaEncerrarPonto.parse(entrada);
    return this.gravar(
      c,
      'sadt.microbiologia.ponto-corte.encerrado',
      'ponto_corte_antimicrobiano',
      async (tx) => {
        const atual = await this.pontoParaMudar(tx, pontoId, e.versao);
        if (e.vigenciaFim < atual.vigenciaInicio)
          throw recusa('vigencia-invertida', 'O fim da vigência não pode vir antes do início.');
        await tx.alterar('ponto_corte_antimicrobiano', pontoId, e.versao, { vigencia_fim: e.vigenciaFim });
        return { id: pontoId, vigenciaFim: e.vigenciaFim };
      },
    );
  }

  private async pontoParaMudar(tx: TxOperacao, pontoId: number, versao: number) {
    const r = await tx.uma(
      `SELECT pc.*, (SELECT COUNT(*) FROM resultado_sensibilidade rs WHERE rs.ponto_corte_antimicrobiano_id = pc.id) AS em_uso
         FROM ponto_corte_antimicrobiano pc WHERE pc.id = ?`,
      [pontoId],
    );
    if (!r) throw recusa('nao-encontrado', 'O ponto de corte não existe.');
    const p = pontoLido(r);
    if (p.versao !== versao) throw recusa('conflito-versao', 'O ponto mudou desde a leitura; abra de novo.');
    return p;
  }
}
