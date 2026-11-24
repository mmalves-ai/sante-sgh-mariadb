// Porta PRÓPRIA das seções configuráveis do sumário de alta (F3.3, linha 03-PEP L124), sobre o banco do cliente:
//   - seções (`componente_sumario_alta`): do cliente inteiro (estabelecimento nulo) ou do estabelecimento da sessão,
//     por tipo de atendimento, com ordem, obrigatoriedade e recorte de tempo; inclui ou altera com a versão lida;
//     tirar de uso é `ativo = FALSE` (nada é apagado: os sumários já gravados seguem com o que tinham);
//   - períodos de consulta (`periodo_consulta_sumario_alta`): janelas próprias do cliente (atendimento inteiro ou
//     horas antes da alta), com a mesma regra de versão;
//   - as seções que valem para o estabelecimento e o tipo de atendimento (regra do domínio), usadas pela tela da
//     alta e pela finalização (as obrigatórias sem conteúdo recusam).
// Toda gravação pelo executor (trilha da operação), SQL parametrizado.
import { randomUUID } from 'node:crypto';
import type { SumarioAltaEstruturado } from '@sgh/contratos';
import {
  type ComponenteSumario,
  type ErroSecao,
  pendenciasDasSecoes,
  PERIODOS_SECAO,
  resolverSecoesSumario,
  type SecaoVigente,
  TIPOS_ATENDIMENTO_SECAO,
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
    ativo: bool(x['ativo']),
    versao: num(x['versao']),
  };
}

/** O tipo de atendimento da seção a partir do fluxo da categoria do atendimento. */
export function tipoDoFluxo(fluxo: string | null): TipoAtendimentoSecao {
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
                  periodo, ativo, versao
             FROM componente_sumario_alta
            WHERE estabelecimento_id IS NULL OR estabelecimento_id = ?
            ORDER BY tipo_atendimento, ordem, descricao LIMIT 500`,
          [est],
        )
      ).map(componenteLido),
    );
  }

  /** As seções que valem para o estabelecimento da sessão e o tipo de atendimento. */
  async vigentes(c: ContextoDocs, tipo: TipoAtendimentoSecao): Promise<SecaoVigente[]> {
    const est = await this.ler(c, 'identidade', async (_l, e) => e);
    return resolverSecoesSumario(await this.componentes(c), est, tipo);
  }

  /** As seções que valem para o atendimento (tipo pelo fluxo da categoria; externo e telessaúde como ambulatório). */
  async vigentesDoAtendimento(c: ContextoDocs, atendimento: number): Promise<SecaoVigente[]> {
    const tipo = await this.ler(c, 'tipo-atendimento', async (l, est) => {
      const a = await l.uma(
        `SELECT k.tipo_base FROM atendimento a JOIN categoria_atendimento k ON k.id = a.categoria_atendimento_id
          WHERE a.id = ? AND a.estabelecimento_id = ?`,
        [atendimento, est],
      );
      return tipoDoFluxo(a ? String(a['tipo_base']) : null);
    });
    return this.vigentes(c, tipo);
  }

  /** As obrigatórias sem conteúdo no sumário que vai ser finalizado (regra do domínio). */
  async pendencias(c: ContextoDocs, atendimento: number, sumario: SumarioAltaEstruturado) {
    return pendenciasDasSecoes(await this.vigentesDoAtendimento(c, atendimento), sumario);
  }

  /** Inclui ou altera (com a versão lida) a seção; a linha do cliente só é alterada pelo cadastro do cliente. */
  gravarComponente(c: ContextoDocs, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaComponente, entrada);
    const erros = validarComponenteSumario({ ...x, estabelecimento: null });
    if (erros.length) throw recusa(erros);
    return this.gravar(c, 'pep.sumarioAlta.configurarSecao', 'componente_sumario_alta', async (tx, est) => {
      const alvoEst = x.doCliente ? null : est;
      const valores = {
        descricao: x.descricao.trim(),
        tipo_conteudo: x.tipoConteudo,
        ordem: x.ordem,
        obrigatorio: x.obrigatorio,
        periodo: x.periodo,
        ativo: x.ativo,
      };
      const a = await tx.uma(
        `SELECT id, versao FROM componente_sumario_alta
          WHERE codigo = ? AND tipo_atendimento = ? AND estabelecimento_id <=> ? FOR UPDATE`,
        [x.codigo, x.tipoAtendimento, alvoEst],
      );
      if (a) {
        if (x.versao === null || x.versao !== num(a['versao']) || (x.id !== null && x.id !== num(a['id'])))
          throw conflito();
        await tx.alterar('componente_sumario_alta', num(a['id']), x.versao, valores);
        return num(a['id']);
      }
      if (x.id !== null) throw conflito();
      return tx.incluir('componente_sumario_alta', {
        estabelecimento_id: alvoEst,
        codigo: x.codigo,
        tipo_atendimento: x.tipoAtendimento,
        ...valores,
      });
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

  gravarPeriodo(c: ContextoDocs, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaPeriodo, entrada);
    const erros = validarPeriodoConsulta(x);
    if (erros.length) throw recusa(erros);
    return this.gravar(
      c,
      'pep.sumarioAlta.configurarPeriodo',
      'periodo_consulta_sumario_alta',
      async (tx) => {
        const valores = {
          descricao: x.descricao.trim(),
          atendimento_inteiro: x.atendimentoInteiro,
          horas_retroativas: x.atendimentoInteiro ? null : x.horasRetroativas,
          ordem: x.ordem,
          ativo: x.ativo,
        };
        const a = await tx.uma(
          'SELECT id, versao FROM periodo_consulta_sumario_alta WHERE codigo = ? FOR UPDATE',
          [x.codigo],
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
