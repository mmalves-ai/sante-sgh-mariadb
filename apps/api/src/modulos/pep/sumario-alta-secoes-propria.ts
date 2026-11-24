// Porta PRÓPRIA das seções configuráveis do sumário de alta (F3.3, linha 03-PEP L124), sobre o banco do cliente:
//   - seções (`componente_sumario_alta`): do cliente inteiro (estabelecimento nulo) ou do estabelecimento da sessão,
//     por tipo de atendimento, com ordem, obrigatoriedade e recorte de tempo; inclui ou altera com a versão lida;
//     tirar de uso é `ativo = FALSE` (nada é apagado: os sumários já gravados seguem com o que tinham);
//   - períodos de consulta (`periodo_consulta_sumario_alta`): janelas próprias do cliente (atendimento inteiro ou
//     horas antes da alta), com a mesma regra de versão;
//   - a seção pode apontar um período próprio (`periodo_consulta_id`), que vale no lugar do recorte fixo; a janela
//     (desde/até) de cada seção sai pelo atendimento (entrada e alta) para quem monta o sumário;
//   - a linha do cliente inteiro é única no banco pela coluna gerada `estabelecimento_chave` (migração 99_sumario_secoes);
//   - as seções que valem para o estabelecimento e o tipo de atendimento (regra do domínio), usadas pela tela da
//     alta e pela finalização (as obrigatórias sem conteúdo recusam).
// Toda gravação pelo executor (trilha da operação), SQL parametrizado.
import { randomUUID } from 'node:crypto';
import type { SumarioAltaEstruturado } from '@sgh/contratos';
import {
  type ComponenteSumario,
  type ErroSecao,
  janelaDaSecao,
  pendenciasDoSumario,
  type PeriodoProprio,
  PERIODOS_SECAO,
  resolverSecoesSumario,
  type SecaoVigente,
  TIPOS_ATENDIMENTO_SECAO,
  TIPOS_COM_PERIODO,
  TIPOS_CONTEUDO_SECAO,
  type TipoAtendimentoSecao,
  validarComponenteSumario,
  validarPeriodoConsulta,
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
import type { ContextoDocs } from './documentos-porta.js';
import type { NucleoEquipePainel } from './equipe-painel-propria.js';

export const PORTA_SUMARIO_SECOES = Symbol('PORTA_SUMARIO_SECOES');

export interface ComponenteLido extends ComponenteSumario {
  readonly id: number;
  readonly versao: number;
}

export interface PeriodoLido {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly atendimentoInteiro: boolean;
  readonly horasRetroativas: number | null;
  readonly ordem: number;
  readonly ativo: boolean;
  readonly versao: number;
}

export const esquemaComponente = z
  .object({
    id: z.number().int().positive().nullable().default(null),
    /** true: vale para todos os estabelecimentos do cliente; false: só para o da sessão. */
    doCliente: z.boolean().default(false),
    codigo: z.string().min(1).max(30),
    descricao: z.string().min(1).max(150),
    tipoConteudo: z.enum(TIPOS_CONTEUDO_SECAO),
    tipoAtendimento: z.enum(TIPOS_ATENDIMENTO_SECAO).default('todos'),
    ordem: z.number().int().default(0),
    obrigatorio: z.boolean().default(false),
    periodo: z.enum(PERIODOS_SECAO).nullable().default(null),
    periodoConsulta: z.number().int().positive().nullable().default(null),
    ativo: z.boolean().default(true),
    versao: z.number().int().positive().nullable().default(null),
  })
  .strict();

export const esquemaPeriodo = z
  .object({
    id: z.number().int().positive().nullable().default(null),
    codigo: z.string().min(1).max(30),
    descricao: z.string().min(1).max(150),
    atendimentoInteiro: z.boolean(),
    horasRetroativas: z.number().int().nullable().default(null),
    ordem: z.number().int().min(0).max(9999).default(0),
    ativo: z.boolean().default(true),
    versao: z.number().int().positive().nullable().default(null),
  })
  .strict();

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => Boolean(Number(v));

function entradaValida<T>(esq: z.ZodType<T>, entrada: unknown): T {
  const r = esq.safeParse(entrada);
  if (!r.success)
    throw new ErroOperacao(400, 'entrada-invalida', 'Entrada inválida', 'Confira os campos indicados.', {
      campos: r.error.issues.map((i) => i.path.map(String).join('.')),
    });
  return r.data;
}

function recusa(erros: readonly ErroSecao[]): ErroOperacao {
  return new ErroOperacao(
    422,
    erros[0]!.codigo,
    'Cadastro recusado',
    erros.map((e) => e.mensagem).join(' '),
    {
      campos: erros.map((e) => e.campo),
    },
  );
}

const conflito = () =>
  new ErroOperacao(
    409,
    'conflito-versao',
    'Gravado por outra pessoa',
    'O cadastro foi alterado por outra pessoa enquanto você editava. Releia e grave de novo.',
  );

function componenteLido(x: Record<string, unknown>): ComponenteLido {
  return {
    id: num(x['id']),
    estabelecimento: numOuNull(x['estabelecimento_id']),
    codigo: String(x['codigo']),
    descricao: String(x['descricao']),
    tipoConteudo: String(x['tipo_conteudo']) as ComponenteSumario['tipoConteudo'],
    tipoAtendimento: String(x['tipo_atendimento']) as TipoAtendimentoSecao,
    ordem: num(x['ordem']),
    obrigatorio: bool(x['obrigatorio']),
    periodo: (x['periodo'] === null ? null : String(x['periodo'])) as ComponenteSumario['periodo'],
    periodoConsulta: numOuNull(x['periodo_consulta_id']),
    ativo: bool(x['ativo']),
    versao: num(x['versao']),
  };
}

/**
 * Violação de chave única ou impasse de trava (a outra transação incluiu o mesmo código ao mesmo tempo): para quem
 * grava, é o mesmo conflito de "gravado por outra pessoa".
 */
const duplicada = (e: unknown): boolean => {
  const o = e as { errno?: number; code?: string; message?: string; cause?: unknown } | null;
  if (!o) return false;
  if (
    o.errno === 1062 ||
    o.errno === 1213 ||
    o.code === 'ER_DUP_ENTRY' ||
    o.code === 'ER_LOCK_DEADLOCK' ||
    /Duplicate entry|Deadlock found/.test(String(o.message ?? ''))
  )
    return true;
  return o.cause !== undefined && o.cause !== e ? duplicada(o.cause) : false;
};

/** A seção que vale, com a janela de tempo dos dados do episódio (só nos tipos que trazem dados). */
export interface SecaoDoAtendimento extends SecaoVigente {
  readonly janela: { readonly desde: string; readonly ate: string; readonly ultimo: boolean } | null;
}

/**
 * O tipo de atendimento da seção a partir do fluxo da categoria do atendimento; a internação numa clínica assistencial
 * de hospital-dia é hospital-dia (o dado real do atendimento).
 */
export function tipoDoFluxo(fluxo: string | null, hospitalDia = false): TipoAtendimentoSecao {
  if (fluxo === 'internacao' && hospitalDia) return 'hospital_dia';
  if (fluxo === 'internacao' || fluxo === 'pronto_atendimento' || fluxo === 'ambulatorio') return fluxo;
  return fluxo === 'externo' || fluxo === 'telessaude' ? 'ambulatorio' : 'todos';
}

export class PortaSumarioSecoesPropria {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoEquipePainel,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private banco(c: ContextoDocs): string {
    return c.cliente || this.cliente;
  }

  private ler<T>(c: ContextoDocs, rotulo: string, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.banco(c), correlacao: `pep.sumarioSecoes.${rotulo}` },
      async (l) => {
        const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
          c.hospital,
        ]);
        if (!e)
          throw new ErroOperacao(
            404,
            'estabelecimento-inexistente',
            'Não encontrado',
            'Estabelecimento não encontrado.',
          );
        return fn(l, num(e['id']));
      },
    );
  }

  private async gravar(
    c: ContextoDocs,
    nome: string,
    tabela: string,
    fn: (tx: TxOperacao, est: number) => Promise<number>,
  ): Promise<{ id: number }> {
    if (c.usuario === null)
      throw new ErroOperacao(
        403,
        'usuario-inexistente',
        'Operação recusada',
        'A sessão não tem usuário neste cliente.',
      );
    const est = await this.ler(c, 'identidade', async (_l, e) => e);
    const contexto: ContextoOperacao = {
      cliente: this.banco(c),
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: (c.correlacao || nome).slice(0, 64),
      chaveIdempotencia: `${nome}:${randomUUID()}`,
    };
    let feito: number | null = null;
    const op = definirOperacao({
      nome,
      tabelas: [tabela],
      entrada: z.object({}).strict(),
      gravar: async (tx: TxOperacao) => {
        feito = await fn(tx, est);
        return { tabela, id: feito };
      },
      alvo: (_e, s) => ({ tabela: String(s['tabela']), id: Number(s['id']) }),
    });
    await this.executor.executar(op, this.banco(c), {}, contexto);
    if (feito === null) throw new Error(`A operação ${nome} terminou sem resultado.`);
    return { id: feito };
  }

  /** As seções do cliente e do estabelecimento da sessão (ativas e inativas), para o cadastro. */
  componentes(c: ContextoDocs): Promise<ComponenteLido[]> {
    return this.ler(c, 'componentes', async (l, est) =>
      (
        await l.consultar(
          `SELECT id, estabelecimento_id, codigo, descricao, tipo_conteudo, tipo_atendimento, ordem, obrigatorio,
                  periodo, periodo_consulta_id, ativo, versao
             FROM componente_sumario_alta
            WHERE estabelecimento_id IS NULL OR estabelecimento_id = ?
            ORDER BY tipo_atendimento, ordem, descricao LIMIT 500`,
          [est],
        )
      ).map(componenteLido),
    );
  }

  /** Os períodos próprios do cliente, pelo id (para a resolução das seções). */
  private async periodosPorId(c: ContextoDocs): Promise<Map<number, PeriodoProprio>> {
    return new Map((await this.periodos(c)).map((p) => [p.id, p]));
  }

  /** As seções que valem para o estabelecimento da sessão e o tipo de atendimento. */
  async vigentes(c: ContextoDocs, tipo: TipoAtendimentoSecao): Promise<SecaoVigente[]> {
    const est = await this.ler(c, 'identidade', async (_l, e) => e);
    const [componentes, periodos] = await Promise.all([this.componentes(c), this.periodosPorId(c)]);
    return resolverSecoesSumario(componentes, est, tipo, periodos);
  }

  /**
   * As seções que valem para o atendimento do estabelecimento da sessão (e do paciente, quando informado): tipo pelo
   * fluxo da categoria (externo e telessaúde como ambulatório; internação em clínica de hospital-dia como hospital-dia)
   * e a janela de cada seção pela entrada e pela alta (sem alta, agora). Atendimento de fora é recusado (404), nunca
   * cai em "todos".
   */
  async vigentesDoAtendimento(
    c: ContextoDocs,
    atendimento: number,
    paciente: number | null = null,
  ): Promise<SecaoDoAtendimento[]> {
    const a = await this.ler(c, 'tipo-atendimento', async (l, est) =>
      l.uma(
        `SELECT k.tipo_base, COALESCE(ca.natureza = 'hospital_dia', FALSE) AS hospital_dia, a.entrada_em,
                COALESCE(a.alta_medica_em, a.saida_em) AS alta_em
           FROM atendimento a
           JOIN categoria_atendimento k ON k.id = a.categoria_atendimento_id
           LEFT JOIN clinica_assistencial ca ON ca.id = a.clinica_assistencial_id
          WHERE a.id = ? AND a.estabelecimento_id = ? AND (? IS NULL OR a.paciente_id = ?)`,
        [atendimento, est, paciente, paciente],
      ),
    );
    if (!a)
      throw new ErroOperacao(
        404,
        'atendimento-inexistente',
        'Não encontrado',
        'Atendimento não encontrado neste estabelecimento.',
      );
    const secoes = await this.vigentes(c, tipoDoFluxo(String(a['tipo_base']), bool(a['hospital_dia'])));
    const entrada = new Date(a['entrada_em'] as string | Date);
    const alta = a['alta_em'] ? new Date(a['alta_em'] as string | Date) : new Date();
    return secoes.map((x) => {
      if (!TIPOS_COM_PERIODO.has(x.tipoConteudo)) return { ...x, janela: null };
      const j = janelaDaSecao(x.periodo, entrada, alta, x.horasRetroativas ?? null);
      return { ...x, janela: { desde: j.desde.toISOString(), ate: j.ate.toISOString(), ultimo: j.ultimo } };
    });
  }

  /** O que falta no sumário que vai ser finalizado: as seções do atendimento e o piso legal (regra do domínio). */
  async pendencias(
    c: ContextoDocs,
    atendimento: number,
    sumario: SumarioAltaEstruturado,
    paciente: number | null = null,
  ) {
    return pendenciasDoSumario(sumario, await this.vigentesDoAtendimento(c, atendimento, paciente));
  }

  /** Inclui ou altera (com a versão lida) a seção; a linha do cliente só é alterada pelo cadastro do cliente. */
  async gravarComponente(c: ContextoDocs, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaComponente, entrada);
    const erros = validarComponenteSumario({ ...x, estabelecimento: null });
    if (erros.length) throw recusa(erros);
    return this.gravarSecao(c, x);
  }

  private async gravarSecao(c: ContextoDocs, x: z.infer<typeof esquemaComponente>): Promise<{ id: number }> {
    try {
      return await this.gravarSecaoNaTx(c, x);
    } catch (e) {
      if (duplicada(e)) throw conflito();
      throw e;
    }
  }

  private gravarSecaoNaTx(c: ContextoDocs, x: z.infer<typeof esquemaComponente>): Promise<{ id: number }> {
    return this.gravar(c, 'pep.sumario_alta.configurar_secao', 'componente_sumario_alta', async (tx, est) => {
      if (x.periodoConsulta !== null) {
        const p = await tx.uma('SELECT ativo FROM periodo_consulta_sumario_alta WHERE id = ?', [
          x.periodoConsulta,
        ]);
        if (!p || !bool(p['ativo']))
          throw recusa([
            {
              campo: 'periodo',
              codigo: 'periodo-inexistente',
              mensagem: 'O período escolhido não existe ou foi retirado de uso.',
            },
          ]);
      }
      const alvoEst = x.doCliente ? null : est;
      const valores = {
        descricao: x.descricao.trim(),
        tipo_conteudo: x.tipoConteudo,
        ordem: x.ordem,
        obrigatorio: x.obrigatorio,
        periodo: x.periodo,
        periodo_consulta_id: x.periodoConsulta,
        ativo: x.ativo,
      };
      const [a] = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM componente_sumario_alta
          WHERE estabelecimento_chave = COALESCE(?, 0) AND tipo_atendimento = ? AND codigo = ?`,
        [alvoEst, x.tipoAtendimento, x.codigo],
        { teto: 1 },
      );
      if (a) {
        if (x.versao === null || x.versao !== num(a['versao']) || (x.id !== null && x.id !== num(a['id'])))
          throw conflito();
        await tx.alterar('componente_sumario_alta', num(a['id']), x.versao, valores);
        return num(a['id']);
      }
      if (x.id !== null) throw conflito();
      try {
        return await tx.incluir('componente_sumario_alta', {
          estabelecimento_id: alvoEst,
          codigo: x.codigo,
          tipo_atendimento: x.tipoAtendimento,
          ...valores,
        });
      } catch (e) {
        // Duas inclusões simultâneas do mesmo código: a chave única (estabelecimento_chave) recusa a segunda.
        if (duplicada(e)) throw conflito();
        throw e;
      }
    });
  }

  periodos(c: ContextoDocs): Promise<PeriodoLido[]> {
    return this.ler(c, 'periodos', async (l) =>
      (
        await l.consultar(
          `SELECT id, codigo, descricao, atendimento_inteiro, horas_retroativas, ordem, ativo, versao
             FROM periodo_consulta_sumario_alta ORDER BY ordem, descricao LIMIT 200`,
        )
      ).map((x) => ({
        id: num(x['id']),
        codigo: String(x['codigo']),
        descricao: String(x['descricao']),
        atendimentoInteiro: bool(x['atendimento_inteiro']),
        horasRetroativas: numOuNull(x['horas_retroativas']),
        ordem: num(x['ordem']),
        ativo: bool(x['ativo']),
        versao: num(x['versao']),
      })),
    );
  }

  async gravarPeriodo(c: ContextoDocs, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaPeriodo, entrada);
    const erros = validarPeriodoConsulta(x);
    if (erros.length) throw recusa(erros);
    return this.gravar(
      c,
      'pep.sumario_alta.configurar_periodo',
      'periodo_consulta_sumario_alta',
      async (tx) => {
        const valores = {
          descricao: x.descricao.trim(),
          atendimento_inteiro: x.atendimentoInteiro,
          horas_retroativas: x.atendimentoInteiro ? null : x.horasRetroativas,
          ordem: x.ordem,
          ativo: x.ativo,
        };
        const [a] = await tx.consultarParaAtualizar(
          'SELECT id, versao FROM periodo_consulta_sumario_alta WHERE codigo = ?',
          [x.codigo],
          { teto: 1 },
        );
        if (a) {
          if (x.versao === null || x.versao !== num(a['versao'])) throw conflito();
          await tx.alterar('periodo_consulta_sumario_alta', num(a['id']), x.versao, valores);
          return num(a['id']);
        }
        if (x.id !== null) throw conflito();
        return tx.incluir('periodo_consulta_sumario_alta', { codigo: x.codigo, ...valores });
      },
    );
  }
}
