// Porta PRÓPRIA do painel do profissional, da configuração do prontuário por setor e da equipe assistencial (F3.3,
// linhas 03-PEP L90, L91 e L94 da análise), sobre o banco do cliente pelo @sgh/nucleo:
//   - pacientes acompanhados (`paciente_acompanhado`): marcar abre um período; desmarcar grava o fim (nova versão da
//     linha), nunca apaga — a troca de computador não perde o painel, e o histórico de quem acompanhou fica;
//   - colunas do painel (`painel_coluna_usuario`, sem filtro = valem para todos os filtros): exibir e ordem por coluna;
//   - configuração do prontuário por setor e tipo de atendimento (`configuracao_setor_prontuario`): leitura, gravação
//     (inclui ou altera com a versão lida) e a resolução da que vale (regra do domínio);
//   - equipe assistencial do atendimento (`equipe_assistencial_paciente` e `equipe_assistencial_membro`, funções em
//     `funcao_equipe_assistencial`): inclusão de membro com as regras do domínio (lotação vigente no estabelecimento,
//     categoria do CBO que combina com a da função, especialidade do profissional), saída com fim e motivo e
//     encerramento da equipe no fim do atendimento (o vínculo pela equipe só vale com o atendimento aberto).
// Toda leitura e gravação fica no estabelecimento da sessão; SQL parametrizado; as gravações pelo executor (trilha).
import { randomUUID } from 'node:crypto';
import {
  atendimentoAberto,
  categoriaDoCbo,
  filaDePendenciasDaEquipe,
  padroesDoAtendimento,
  planoEquipePadrao,
  validarEquipePadrao,
  type ConfiguracaoProntuario,
  type ConfiguracaoSetor,
  type ErroRegraPainel,
  type FuncaoEquipe,
  type MembroEquipe,
  planoEncerramentoEquipe,
  resolverConfiguracaoProntuario,
  temVinculoPelaEquipe,
  type TipoAtendimentoProntuario,
  validarAcompanhar,
  validarColunasPainel,
  validarConfiguracaoSetor,
  validarInclusaoMembro,
  validarSaidaMembro,
} from '@sgh/dominio-pep';
import { COLUNAS_PAINEL } from '@sgh/contratos';
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
import { dataHora, fusoValido } from './registro-porta-propria.js';

export interface NucleoEquipePainel {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

export const PORTA_EQUIPE_PAINEL = Symbol('PORTA_EQUIPE_PAINEL');

export interface AcompanhadoLido {
  readonly id: number;
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly inicio: string | null;
  readonly motivo: string | null;
  readonly versao: number;
}

export interface ConfiguracaoSetorLida extends ConfiguracaoSetor {
  readonly id: number;
  readonly setorNome: string;
  readonly versao: number;
}

export interface MembroLido extends MembroEquipe {
  readonly profissionalNome: string;
  readonly funcaoDescricao: string;
  readonly especialidade: number | null;
  readonly motivoSaida: string | null;
  readonly versao: number;
}

export interface EquipeLida {
  readonly equipe: number | null;
  readonly atendimento: number;
  readonly paciente: number;
  readonly membros: MembroLido[];
}

export const esquemaAcompanhar = z
  .object({
    paciente: z.number().int().positive(),
    atendimento: z.number().int().positive().nullable().default(null),
    motivo: z.string().max(500).nullable().default(null),
  })
  .strict();
export const esquemaColunas = z.object({ colunas: z.array(z.string().max(60)).max(30) }).strict();
export const esquemaConfiguracaoSetor = z
  .object({
    setor: z.number().int().positive(),
    tipoAtendimento: z.enum([
      'todos',
      'internacao',
      'pronto_atendimento',
      'ambulatorio',
      'hospital_dia',
      'externo',
    ]),
    permiteRetroativo: z.boolean(),
    toleranciaRetroativoHoras: z.number().int().nullable(),
    assinaturaExigida: z.enum(['nenhuma', 'eletronica', 'digital_icp']),
    exigeEvolucaoMedica: z.boolean(),
    exigeEvolucaoEnfermagem: z.boolean(),
    ativo: z.boolean().default(true),
    versao: z.number().int().positive().nullable().default(null),
  })
  .strict();
export const esquemaMembro = z
  .object({
    profissional: z.number().int().positive(),
    funcao: z.number().int().positive(),
    especialidade: z.number().int().positive().nullable().default(null),
    recebeNotificacao: z.boolean().default(false),
  })
  .strict();
export const esquemaEquipePadrao = z
  .object({
    nome: z.string().min(1).max(100),
    setor: z.number().int().positive().nullable().default(null),
    especialidade: z.number().int().positive().nullable().default(null),
    sugerirAutomaticamente: z.boolean().default(true),
    membros: z
      .array(
        z
          .object({
            funcao: z.number().int().positive(),
            profissional: z.number().int().positive().nullable().default(null),
            responsavel: z.boolean().default(false),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export const esquemaVersao = z.object({ versao: z.number().int().positive() }).strict();

export interface EquipePadraoLida {
  readonly id: number;
  readonly nome: string;
  readonly setor: number | null;
  readonly setorNome: string | null;
  readonly especialidade: number | null;
  readonly sugerir: boolean;
  readonly ativo: boolean;
  readonly versao: number;
  readonly membros: {
    readonly sequencia: number;
    readonly funcao: number;
    readonly funcaoDescricao: string;
    readonly profissional: number | null;
    readonly profissionalNome: string | null;
    readonly responsavel: boolean;
  }[];
}

export interface ItemFilaEquipe {
  readonly equipe: number;
  readonly atendimento: number;
  readonly numero: string;
  readonly paciente: number;
  readonly pacienteNome: string;
  readonly responsavel: boolean;
}

/** Profissionais da conta no estabelecimento (vínculo vigente da conta com o cadastro do profissional). */
const SQL_PROFISSIONAIS_DO_USUARIO = `
  SELECT DISTINCT profissional_id FROM usuario_vinculo_profissional
   WHERE usuario_id = ? AND estabelecimento_id = ? AND profissional_id IS NOT NULL AND excluido_em IS NULL
     AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`;

export const esquemaSaida = z.object({ motivo: z.string().min(1).max(500) }).strict();

/** Violação de chave única (a outra transação gravou primeiro). */
const duplicada = (e: unknown): boolean => {
  const o = e as { errno?: number; code?: string; message?: string; cause?: unknown } | null;
  if (!o) return false;
  if (o.errno === 1062 || o.code === 'ER_DUP_ENTRY' || /Duplicate entry/.test(String(o.message ?? '')))
    return true;
  return o.cause !== undefined && o.cause !== e ? duplicada(o.cause) : false;
};
const conflito = (codigo: string, detalhe: string) => new ErroOperacao(409, codigo, 'Conflito', detalhe);

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => Boolean(Number(v));

function recusaRegra(erros: readonly ErroRegraPainel[]): ErroOperacao {
  return new ErroOperacao(
    422,
    erros[0]!.codigo,
    'Operação recusada',
    erros.map((e) => e.mensagem).join(' '),
    {
      campos: erros.map((e) => e.campo),
    },
  );
}
const naoEncontrado = (o: string) =>
  new ErroOperacao(404, `${o}-inexistente`, 'Não encontrado', `${o} não encontrado neste estabelecimento.`);

export function entradaValida<T>(esq: z.ZodType<T>, entrada: unknown): T {
  const r = esq.safeParse(entrada);
  if (!r.success)
    throw new ErroOperacao(400, 'entrada-invalida', 'Entrada inválida', 'Confira os campos indicados.', {
      campos: r.error.issues.map((i) => i.path.map(String).join('.')),
    });
  return r.data;
}

interface Est {
  readonly id: number;
  readonly fuso: string;
}

const TABELAS = [
  'painel_filtro_usuario',
  'paciente_acompanhado',
  'painel_coluna_usuario',
  'configuracao_setor_prontuario',
  'equipe_assistencial_paciente',
  'equipe_assistencial_membro',
  'equipe_assistencial_padrao',
  'equipe_assistencial_padrao_membro',
];

const SQL_MEMBROS = `
  SELECT m.id, m.profissional_id, m.funcao_equipe_assistencial_id, m.especialidade_medica_id, m.responsavel_principal,
         m.recebe_notificacao, m.inicio_em, m.fim_em, m.motivo_saida, m.versao,
         COALESCE(pf.nome, CONCAT('Profissional ', m.profissional_id)) AS nome, f.descricao
    FROM equipe_assistencial_membro m
    JOIN funcao_equipe_assistencial f ON f.id = m.funcao_equipe_assistencial_id
    LEFT JOIN profissional p ON p.id = m.profissional_id
    LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
   WHERE m.equipe_assistencial_paciente_id = ? AND m.excluido_em IS NULL
   ORDER BY m.fim_em IS NOT NULL, m.responsavel_principal DESC, m.sequencia`;

function membroLido(x: Record<string, unknown>, fuso: string): MembroLido {
  return {
    id: num(x['id']),
    profissional: num(x['profissional_id']),
    funcao: num(x['funcao_equipe_assistencial_id']),
    especialidade: numOuNull(x['especialidade_medica_id']),
    responsavelPrincipal: bool(x['responsavel_principal']),
    recebeNotificacao: bool(x['recebe_notificacao']),
    inicio: dataHora(x['inicio_em'] as Date, fuso) ?? '',
    fim: x['fim_em'] ? dataHora(x['fim_em'] as Date, fuso) : null,
    motivoSaida: txt(x['motivo_saida']),
    versao: num(x['versao']),
    profissionalNome: String(x['nome'] ?? ''),
    funcaoDescricao: String(x['descricao'] ?? ''),
  };
}

function configuracaoLida(x: Record<string, unknown>): ConfiguracaoSetorLida {
  return {
    id: num(x['id']),
    setor: num(x['setor_funcional_id']),
    setorNome: String(x['setor_nome'] ?? ''),
    tipoAtendimento: String(x['tipo_atendimento']) as TipoAtendimentoProntuario,
    permiteRetroativo: bool(x['permite_retroativo']),
    toleranciaRetroativoHoras: numOuNull(x['tolerancia_retroativo_horas']),
    assinaturaExigida: String(x['assinatura_exigida']) as ConfiguracaoSetor['assinaturaExigida'],
    exigeEvolucaoMedica: bool(x['exige_evolucao_medica']),
    exigeEvolucaoEnfermagem: bool(x['exige_evolucao_enfermagem']),
    ativo: bool(x['ativo']),
    versao: num(x['versao']),
  };
}

/** SELECT travado (FOR UPDATE pelo caminho próprio do Escritor): a primeira linha ou null. */
async function umaTravada(
  tx: TxOperacao,
  sql: string,
  p: readonly unknown[],
): Promise<Record<string, unknown> | null> {
  return (await tx.consultarParaAtualizar(sql, p))[0] ?? null;
}

export class PortaEquipePainelPropria {
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

  private ler<T>(c: ContextoDocs, rotulo: string, fn: (l: Leitor, est: Est) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.banco(c), correlacao: `pep.equipe.${rotulo}` },
      async (l) => {
        const e = await l.uma(
          'SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
          [c.hospital],
        );
        if (!e) throw naoEncontrado('Estabelecimento');
        return fn(l, { id: num(e['id']), fuso: fusoValido(e['fuso_horario']) });
      },
    );
  }

  /** Grava pelo executor (trilha da operação), no estabelecimento da sessão, com o usuário da sessão. */
  private async gravar<T extends Record<string, unknown>>(
    c: ContextoDocs,
    nome: string,
    tabelas: readonly string[],
    fn: (tx: TxOperacao, est: Est, usuario: number) => Promise<T & { tabela: string; id: number | null }>,
  ): Promise<T> {
    if (c.usuario === null)
      throw new ErroOperacao(
        403,
        'usuario-inexistente',
        'Operação recusada',
        'A sessão não tem usuário neste cliente.',
      );
    const usuario = c.usuario;
    const est = await this.ler(c, 'identidade', async (_l, e) => e);
    const contexto: ContextoOperacao = {
      cliente: this.banco(c),
      estabelecimento: est.id,
      usuario,
      correlacao: (c.correlacao || nome).slice(0, 64),
      chaveIdempotencia: `${nome}:${randomUUID()}`,
    };
    let feito: T | null = null;
    const op = definirOperacao({
      nome,
      tabelas: tabelas.filter((t) => TABELAS.includes(t)),
      entrada: z.object({}).strict(),
      gravar: async (tx: TxOperacao) => {
        const r = await fn(tx, est, usuario);
        feito = r;
        return { tabela: r.tabela, id: r.id };
      },
      alvo: (_e, s) => ({ tabela: String(s['tabela']), id: s['id'] === null ? null : Number(s['id']) }),
    });
    await this.executor.executar(op, this.banco(c), {}, contexto);
    if (!feito) throw new Error(`A operação ${nome} terminou sem resultado.`);
    return feito;
  }

  // ── Pacientes acompanhados e colunas ───────────────────────────────────────────────────────────

  acompanhados(c: ContextoDocs): Promise<AcompanhadoLido[]> {
    return this.ler(c, 'acompanhados', async (l, est) => {
      const r = await l.consultar(
        `SELECT id, paciente_id, atendimento_id, inicio_em, motivo, versao FROM paciente_acompanhado
          WHERE estabelecimento_id = ? AND usuario_id = ? AND fim_em IS NULL AND excluido_em IS NULL
          ORDER BY inicio_em DESC, id DESC LIMIT 500`,
        [est.id, c.usuario ?? 0],
      );
      return r.map((x) => ({
        id: num(x['id']),
        paciente: num(x['paciente_id']),
        atendimento: numOuNull(x['atendimento_id']),
        inicio: dataHora(x['inicio_em'] as Date, est.fuso),
        motivo: txt(x['motivo']),
        versao: num(x['versao']),
      }));
    });
  }

  async acompanhar(c: ContextoDocs, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaAcompanhar, entrada);
    return this.gravar(c, 'pep.painel.acompanhar', ['paciente_acompanhado'], async (tx, est, usuario) => {
      const pac = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [x.paciente]);
      if (!pac) throw naoEncontrado('Paciente');
      if (x.atendimento !== null) {
        const a = await tx.uma(
          'SELECT id FROM atendimento WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [x.atendimento, x.paciente, est.id],
        );
        if (!a) throw naoEncontrado('Atendimento');
      }
      const vig = await tx.consultarParaAtualizar(
        `SELECT paciente_id FROM paciente_acompanhado
          WHERE estabelecimento_id = ? AND usuario_id = ? AND paciente_id = ? AND fim_em IS NULL AND excluido_em IS NULL`,
        [est.id, usuario, x.paciente],
      );
      const erros = validarAcompanhar(
        vig.map((v) => ({ paciente: num(v['paciente_id']), fim: null })),
        x.paciente,
        x.motivo,
      );
      if (erros.length) throw recusaRegra(erros);
      const id = await tx.incluir('paciente_acompanhado', {
        estabelecimento_id: est.id,
        usuario_id: usuario,
        paciente_id: x.paciente,
        atendimento_id: x.atendimento,
        inicio_em: new Date(),
        motivo: x.motivo?.trim() || null,
      });
      return { tabela: 'paciente_acompanhado', id };
    });
  }

  /** Deixa de acompanhar: grava o fim do período (a linha fica, com quem e quando). */
  async deixarDeAcompanhar(c: ContextoDocs, paciente: number): Promise<{ id: number }> {
    return this.gravar(
      c,
      'pep.painel.deixar_acompanhar',
      ['paciente_acompanhado'],
      async (tx, est, usuario) => {
        const v = await tx.uma(
          `SELECT id, versao FROM paciente_acompanhado
          WHERE estabelecimento_id = ? AND usuario_id = ? AND paciente_id = ? AND fim_em IS NULL AND excluido_em IS NULL
          ORDER BY id DESC LIMIT 1`,
          [est.id, usuario, paciente],
        );
        if (!v) throw naoEncontrado('Acompanhamento');
        await tx.alterar('paciente_acompanhado', num(v['id']), num(v['versao']), { fim_em: new Date() });
        return { tabela: 'paciente_acompanhado', id: num(v['id']) };
      },
    );
  }

  colunas(c: ContextoDocs): Promise<string[]> {
    return this.ler(c, 'colunas', async (l) => {
      const r = await l.consultar(
        `SELECT coluna FROM painel_coluna_usuario
          WHERE usuario_id = ? AND painel_filtro_usuario_id IS NULL AND exibir = TRUE ORDER BY ordem, id`,
        [c.usuario ?? 0],
      );
      return r.map((x) => String(x['coluna']));
    });
  }

  /** Grava as colunas do usuário: as escolhidas com exibir e ordem; as demais do catálogo, ocultas. */
  async gravarColunas(c: ContextoDocs, entrada: unknown): Promise<{ colunas: string[] }> {
    const x = entradaValida(esquemaColunas, entrada);
    const erros = validarColunasPainel(x.colunas, COLUNAS_PAINEL);
    if (erros.length) throw recusaRegra(erros);
    return this.gravar(c, 'pep.painel.colunas', ['painel_coluna_usuario'], async (tx, _est, usuario) => {
      const atuais = await tx.consultarParaAtualizar(
        `SELECT id, coluna, versao FROM painel_coluna_usuario
          WHERE usuario_id = ? AND painel_filtro_usuario_id IS NULL`,
        [usuario],
      );
      const porColuna = new Map(atuais.map((a) => [String(a['coluna']), a]));
      const todas = [...x.colunas, ...COLUNAS_PAINEL.filter((k) => !x.colunas.includes(k))];
      for (const [i, coluna] of todas.entries()) {
        const valores = { exibir: x.colunas.includes(coluna), ordem: i + 1 };
        const a = porColuna.get(coluna);
        if (a) await tx.alterar('painel_coluna_usuario', num(a['id']), num(a['versao']), valores);
        else await tx.incluir('painel_coluna_usuario', { usuario_id: usuario, coluna, ...valores });
      }
      return { tabela: 'painel_coluna_usuario', id: null, colunas: [...x.colunas] };
    });
  }

  /** Filtro salvo padrão do painel (a unidade que abre o painel), no banco por usuário e estabelecimento. */
  async gravarFiltroPadrao(c: ContextoDocs, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(z.object({ unidade: z.number().int().positive().nullable() }).strict(), entrada);
    return this.gravar(c, 'pep.painel.filtro_padrao', ['painel_filtro_usuario'], async (tx, est, usuario) => {
      if (x.unidade !== null) {
        const u = await tx.uma(
          `SELECT id FROM unidade_assistencial
            WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL`,
          [x.unidade, est.id],
        );
        if (!u) throw naoEncontrado('Unidade');
      }
      const a = await umaTravada(
        tx,
        `SELECT id, versao FROM painel_filtro_usuario
          WHERE usuario_id = ? AND estabelecimento_id = ? ORDER BY padrao DESC, id LIMIT 1`,
        [usuario, est.id],
      );
      if (a) {
        await tx.alterar('painel_filtro_usuario', num(a['id']), num(a['versao']), {
          unidade_assistencial_id: x.unidade,
          padrao: true,
        });
        return { tabela: 'painel_filtro_usuario', id: num(a['id']) };
      }
      const id = await tx.incluir('painel_filtro_usuario', {
        estabelecimento_id: est.id,
        usuario_id: usuario,
        nome: 'Padrão',
        padrao: true,
        unidade_assistencial_id: x.unidade,
      });
      return { tabela: 'painel_filtro_usuario', id };
    });
  }

  filtroPadrao(c: ContextoDocs): Promise<{ unidade: number | null }> {
    return this.ler(c, 'filtro-padrao', async (l, est) => {
      const f = await l.uma(
        `SELECT unidade_assistencial_id FROM painel_filtro_usuario
          WHERE usuario_id = ? AND estabelecimento_id = ? ORDER BY padrao DESC, id LIMIT 1`,
        [c.usuario ?? 0, est.id],
      );
      return { unidade: f ? numOuNull(f['unidade_assistencial_id']) : null };
    });
  }

  // ── Configuração do prontuário por setor ───────────────────────────────────────────────────────

  configuracoesSetor(c: ContextoDocs): Promise<ConfiguracaoSetorLida[]> {
    return this.ler(c, 'config-setor', async (l, est) => {
      const r = await l.consultar(
        `SELECT c.*, s.nome AS setor_nome FROM configuracao_setor_prontuario c
           JOIN setor_funcional s
             ON s.id = c.setor_funcional_id AND s.estabelecimento_id = c.estabelecimento_id AND s.excluido_em IS NULL
          WHERE c.estabelecimento_id = ? ORDER BY s.nome, c.tipo_atendimento LIMIT 1000`,
        [est.id],
      );
      return r.map(configuracaoLida);
    });
  }

  /** A configuração que vale para o setor e o tipo de atendimento (regra do domínio), e de onde veio. */
  async configuracaoVigente(
    c: ContextoDocs,
    setor: number | null,
    tipo: TipoAtendimentoProntuario,
    padraoEstabelecimento?: ConfiguracaoProntuario,
  ) {
    const linhas = await this.configuracoesSetor(c);
    return resolverConfiguracaoProntuario(linhas, setor, tipo, padraoEstabelecimento);
  }

  setores(c: ContextoDocs): Promise<{ id: number; nome: string }[]> {
    return this.ler(c, 'setores', async (l, est) =>
      (
        await l.consultar(
          'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome LIMIT 1000',
          [est.id],
        )
      ).map((x) => ({ id: num(x['id']), nome: String(x['nome']) })),
    );
  }

  /** Inclui ou altera (com a versão lida) a configuração do setor e tipo de atendimento. */
  async gravarConfiguracaoSetor(c: ContextoDocs, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaConfiguracaoSetor, entrada);
    const erros = validarConfiguracaoSetor(x);
    if (erros.length) throw recusaRegra(erros);
    return this.gravar(
      c,
      'pep.prontuario.configurar_setor',
      ['configuracao_setor_prontuario'],
      async (tx, est) => {
        const s = await tx.uma(
          'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [x.setor, est.id],
        );
        if (!s) throw naoEncontrado('Setor');
        const valores = {
          permite_retroativo: x.permiteRetroativo,
          tolerancia_retroativo_horas: x.toleranciaRetroativoHoras,
          assinatura_exigida: x.assinaturaExigida,
          exige_evolucao_medica: x.exigeEvolucaoMedica,
          exige_evolucao_enfermagem: x.exigeEvolucaoEnfermagem,
          ativo: x.ativo,
        };
        const a = await umaTravada(
          tx,
          `SELECT id, versao FROM configuracao_setor_prontuario
            WHERE estabelecimento_id = ? AND setor_funcional_id = ? AND tipo_atendimento = ?`,
          [est.id, x.setor, x.tipoAtendimento],
        );
        if (a) {
          // Alterar exige a versão lida: sem ela, a linha foi gravada por outro depois que a tela abriu.
          if (x.versao === null)
            throw conflito(
              'configuracao-existente',
              'Este setor e tipo já têm configuração gravada; recarregue e altere a partir dela.',
            );
          await tx.alterar('configuracao_setor_prontuario', num(a['id']), x.versao, valores);
          return { tabela: 'configuracao_setor_prontuario', id: num(a['id']) };
        }
        const id = await tx
          .incluir('configuracao_setor_prontuario', {
            estabelecimento_id: est.id,
            setor_funcional_id: x.setor,
            tipo_atendimento: x.tipoAtendimento,
            ...valores,
          })
          .catch((e: unknown) => {
            if (duplicada(e))
              throw conflito(
                'configuracao-existente',
                'Outro usuário acabou de gravar este setor e tipo; recarregue.',
              );
            throw e;
          });
        return { tabela: 'configuracao_setor_prontuario', id };
      },
    );
  }

  // ── Equipe assistencial ────────────────────────────────────────────────────────────────────────

  funcoes(c: ContextoDocs): Promise<(FuncaoEquipe & { descricao: string })[]> {
    return this.ler(c, 'funcoes', async (l) =>
      (
        await l.consultar(
          `SELECT id, descricao, categoria, responsavel_principal, ativo FROM funcao_equipe_assistencial
            WHERE ativo = TRUE ORDER BY ordem, descricao`,
        )
      ).map((x) => ({
        id: num(x['id']),
        descricao: String(x['descricao']),
        categoria: String(x['categoria']) as FuncaoEquipe['categoria'],
        responsavelPrincipal: bool(x['responsavel_principal']),
        ativo: bool(x['ativo']),
      })),
    );
  }

  equipe(c: ContextoDocs, atendimento: number): Promise<EquipeLida> {
    return this.ler(c, 'equipe', async (l, est) => {
      const a = await l.uma(
        'SELECT id, paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [atendimento, est.id],
      );
      if (!a) throw naoEncontrado('Atendimento');
      const e = await l.uma(
        'SELECT id FROM equipe_assistencial_paciente WHERE atendimento_id = ? AND excluido_em IS NULL',
        [atendimento],
      );
      const membros = e
        ? (await l.consultar(SQL_MEMBROS, [e['id']])).map((x) => membroLido(x, est.fuso))
        : [];
      return { equipe: e ? num(e['id']) : null, atendimento, paciente: num(a['paciente_id']), membros };
    });
  }

  /** O profissional está na equipe vigente de algum atendimento do paciente neste estabelecimento? */
  vinculoPelaEquipe(c: ContextoDocs, paciente: number, profissional: number): Promise<boolean> {
    return this.ler(c, 'vinculo-equipe', async (l, est) => {
      const r = await l.consultar(
        `SELECT m.id, m.profissional_id, m.funcao_equipe_assistencial_id, m.responsavel_principal,
                m.recebe_notificacao, m.inicio_em, m.fim_em, a.situacao AS atd_situacao, a.saida_em AS atd_saida
           FROM equipe_assistencial_membro m
           JOIN equipe_assistencial_paciente e ON e.id = m.equipe_assistencial_paciente_id
           JOIN atendimento a ON a.id = e.atendimento_id AND a.excluido_em IS NULL
          WHERE e.paciente_id = ? AND e.estabelecimento_id = ? AND e.situacao = 'ativa' AND e.excluido_em IS NULL
            AND m.excluido_em IS NULL AND m.profissional_id = ?`,
        [paciente, est.id, profissional],
      );
      // Só a equipe de atendimento aberto: a de uma internação antiga não dá vínculo para sempre.
      const abertos = r.filter((x) =>
        atendimentoAberto(String(x['atd_situacao']), (x['atd_saida'] as Date | null) ?? null),
      );
      return temVinculoPelaEquipe(
        abertos.map((x) => membroLido({ ...x, nome: '', descricao: '' }, est.fuso)),
        profissional,
      );
    });
  }

  /** Inclui o profissional na equipe do atendimento (abre a equipe na primeira inclusão), pelas regras do domínio. */
  async incluirMembro(
    c: ContextoDocs,
    atendimento: number,
    entrada: unknown,
  ): Promise<{ id: number; equipe: number }> {
    const x = entradaValida(esquemaMembro, entrada);
    return this.gravar(
      c,
      'pep.equipe.incluir_membro',
      ['equipe_assistencial_paciente', 'equipe_assistencial_membro'],
      async (tx, est) => {
        const a = await tx.uma(
          `SELECT id, paciente_id, situacao, saida_em FROM atendimento
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [atendimento, est.id],
        );
        if (!a) throw naoEncontrado('Atendimento');
        if (!atendimentoAberto(String(a['situacao']), (a['saida_em'] as Date | null) ?? null))
          throw recusaRegra([
            { campo: 'atendimento', codigo: 'atendimento-encerrado', mensagem: 'O atendimento já terminou.' },
          ]);
        const f = await tx.uma(
          'SELECT id, categoria, responsavel_principal, ativo FROM funcao_equipe_assistencial WHERE id = ?',
          [x.funcao],
        );
        if (!f) throw naoEncontrado('Função');
        const p = await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [
          x.profissional,
        ]);
        if (!p) throw naoEncontrado('Profissional');
        // Lotação vigente no estabelecimento da sessão (a categoria vem do CBO) e especialidades do cadastro.
        const lotacoes = await tx.consultar(
          `SELECT o.codigo_cbo FROM lotacao_profissional lp JOIN ocupacao_cbo o ON o.id = lp.ocupacao_cbo_id
            WHERE lp.profissional_id = ? AND lp.estabelecimento_id = ? AND lp.ativo = TRUE AND lp.excluido_em IS NULL
              AND lp.vigencia_inicio <= CURRENT_DATE AND (lp.vigencia_fim IS NULL OR lp.vigencia_fim >= CURRENT_DATE)`,
          [x.profissional, est.id],
        );
        const especialidades = await tx.consultar(
          `SELECT especialidade_medica_id FROM profissional_especialidade
            WHERE profissional_id = ? AND ativo = TRUE AND excluido_em IS NULL`,
          [x.profissional],
        );
        const agora = new Date();
        const e = await umaTravada(
          tx,
          'SELECT id, situacao FROM equipe_assistencial_paciente WHERE atendimento_id = ? AND excluido_em IS NULL',
          [atendimento],
        );
        if (e && String(e['situacao']) === 'encerrada')
          throw recusaRegra([
            {
              campo: 'equipe',
              codigo: 'equipe-encerrada',
              mensagem: 'A equipe deste atendimento foi encerrada.',
            },
          ]);
        // Duas primeiras inclusões ao mesmo tempo: a segunda bate na chave única do atendimento e vira conflito.
        const equipe = e
          ? num(e['id'])
          : await tx
              .incluir('equipe_assistencial_paciente', {
                estabelecimento_id: est.id,
                atendimento_id: atendimento,
                paciente_id: num(a['paciente_id']),
                inicio_em: agora,
                situacao: 'ativa',
              })
              .catch((err: unknown) => {
                if (duplicada(err))
                  throw conflito(
                    'equipe-concorrente',
                    'Outra pessoa abriu a equipe agora; recarregue e inclua de novo.',
                  );
                throw err;
              });
        const atuais = (await tx.consultarParaAtualizar(SQL_MEMBROS, [equipe])).map((m) =>
          membroLido(m, est.fuso),
        );
        const funcao: FuncaoEquipe = {
          id: num(f['id']),
          categoria: String(f['categoria']) as FuncaoEquipe['categoria'],
          responsavelPrincipal: bool(f['responsavel_principal']),
          ativo: bool(f['ativo']),
        };
        const erros = validarInclusaoMembro(atuais, {
          profissional: x.profissional,
          funcao,
          recebeNotificacao: x.recebeNotificacao,
          categoriasNoEstabelecimento: lotacoes.map((l) => categoriaDoCbo(txt(l['codigo_cbo']))),
          especialidade: x.especialidade,
          especialidadesDoProfissional: especialidades.map((l) => num(l['especialidade_medica_id'])),
        });
        if (erros.length) throw recusaRegra(erros);
        const seq = await tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM equipe_assistencial_membro WHERE equipe_assistencial_paciente_id = ?',
          [equipe],
        );
        const id = await tx.incluir('equipe_assistencial_membro', {
          equipe_assistencial_paciente_id: equipe,
          sequencia: num(seq?.['s'] ?? 1),
          profissional_id: x.profissional,
          funcao_equipe_assistencial_id: funcao.id,
          especialidade_medica_id: x.especialidade,
          responsavel_principal: funcao.responsavelPrincipal,
          recebe_notificacao: x.recebeNotificacao,
          inicio_em: agora,
        });
        return { tabela: 'equipe_assistencial_membro', id, equipe };
      },
    );
  }

  /** O paciente do atendimento do estabelecimento (para a guarda de vínculo antes de ler ou mexer na equipe). */
  pacienteDoAtendimento(c: ContextoDocs, atendimento: number): Promise<number> {
    return this.ler(c, 'paciente-atendimento', async (l, est) => {
      const a = await l.uma(
        'SELECT paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [atendimento, est.id],
      );
      if (!a) throw naoEncontrado('Atendimento');
      return num(a['paciente_id']);
    });
  }

  /** Especialidades ativas do profissional (a tela só oferece as dele). */
  especialidadesDoProfissional(
    c: ContextoDocs,
    profissional: number,
  ): Promise<{ id: number; descricao: string }[]> {
    return this.ler(c, 'especialidades', async (l) =>
      (
        await l.consultar(
          `SELECT e.id, e.descricao FROM profissional_especialidade pe
             JOIN especialidade_medica e ON e.id = pe.especialidade_medica_id
            WHERE pe.profissional_id = ? AND pe.ativo = TRUE AND pe.excluido_em IS NULL
            ORDER BY pe.principal DESC, e.descricao LIMIT 100`,
          [profissional],
        )
      ).map((x) => ({ id: num(x['id']), descricao: String(x['descricao']) })),
    );
  }

  /**
   * Fim do atendimento: encerra a equipe (situação e fim) e fecha os membros vigentes com o motivo (nova versão das
   * linhas; nada apagado). Daí em diante, a equipe não dá vínculo nem recebe inclusão.
   */
  async encerrarEquipe(
    c: ContextoDocs,
    atendimento: number,
    entrada: unknown,
  ): Promise<{ id: number; membros: number }> {
    const x = entradaValida(esquemaSaida, entrada);
    return this.gravar(
      c,
      'pep.equipe.encerrar_equipe',
      ['equipe_assistencial_paciente', 'equipe_assistencial_membro'],
      async (tx, est) => {
        const e = await umaTravada(
          tx,
          `SELECT id, situacao, versao FROM equipe_assistencial_paciente
            WHERE atendimento_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [atendimento, est.id],
        );
        if (!e) throw naoEncontrado('Equipe');
        const membros = (await tx.consultarParaAtualizar(SQL_MEMBROS, [e['id']])).map((m) =>
          membroLido(m, est.fuso),
        );
        const plano = planoEncerramentoEquipe(String(e['situacao']), membros);
        if (plano.erros.length) throw recusaRegra(plano.erros);
        const motivo = x.motivo.trim();
        if (motivo.length < 3)
          throw recusaRegra([
            { campo: 'motivo', codigo: 'motivo-invalido', mensagem: 'Informe o motivo (3 a 500).' },
          ]);
        const agora = new Date();
        for (const id of plano.membrosAEncerrar) {
          const mb = membros.find((m) => m.id === id)!;
          await tx.alterar('equipe_assistencial_membro', id, mb.versao, {
            fim_em: agora,
            motivo_saida: motivo,
          });
        }
        await tx.alterar('equipe_assistencial_paciente', num(e['id']), num(e['versao']), {
          situacao: 'encerrada',
          fim_em: agora,
        });
        return {
          tabela: 'equipe_assistencial_paciente',
          id: num(e['id']),
          membros: plano.membrosAEncerrar.length,
        };
      },
    );
  }

  /** Saída do membro: grava o fim e o motivo (nova versão da linha); a participação fica no histórico. */
  async encerrarMembro(c: ContextoDocs, membro: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaSaida, entrada);
    return this.gravar(c, 'pep.equipe.encerrar_membro', ['equipe_assistencial_membro'], async (tx, est) => {
      const r = await umaTravada(
        tx,
        `SELECT m.id, m.profissional_id, m.funcao_equipe_assistencial_id, m.responsavel_principal, m.recebe_notificacao,
                m.inicio_em, m.fim_em, m.versao
           FROM equipe_assistencial_membro m
           JOIN equipe_assistencial_paciente e ON e.id = m.equipe_assistencial_paciente_id
          WHERE m.id = ? AND e.estabelecimento_id = ? AND m.excluido_em IS NULL`,
        [membro, est.id],
      );
      const lido = r ? membroLido({ ...r, nome: '', descricao: '' }, est.fuso) : undefined;
      const erros = validarSaidaMembro(lido, x.motivo);
      if (erros.length) throw recusaRegra(erros);
      await tx.alterar('equipe_assistencial_membro', membro, lido!.versao, {
        fim_em: new Date(),
        motivo_saida: x.motivo.trim(),
      });
      return { tabela: 'equipe_assistencial_membro', id: membro };
    });
  }

  // ── Vínculo pela equipe, fila de pendências e equipe padrão (03-PEP L94, C2-064) ─────────────────

  private async profissionaisDoUsuario(l: Pick<Leitor, 'consultar'>, est: Est, usuario: number | null) {
    if (usuario === null) return [];
    return (await l.consultar(SQL_PROFISSIONAIS_DO_USUARIO, [usuario, est.id])).map((x) =>
      num(x['profissional_id']),
    );
  }

  /**
   * Vínculo assistencial pela equipe para a CONTA da sessão: algum profissional ligado à conta no estabelecimento está
   * na equipe vigente de um atendimento ABERTO do paciente. É a fonte real da forma "equipe" da guarda do prontuário.
   */
  vinculoDoUsuario(c: ContextoDocs, paciente: number): Promise<boolean> {
    return this.ler(c, 'vinculo-usuario', async (l, est) => {
      const profs = await this.profissionaisDoUsuario(l, est, c.usuario);
      if (!profs.length) return false;
      const r = await l.consultar(
        `SELECT m.id, m.profissional_id, m.funcao_equipe_assistencial_id, m.responsavel_principal,
                m.recebe_notificacao, m.inicio_em, m.fim_em, a.situacao AS atd_situacao, a.saida_em AS atd_saida
           FROM equipe_assistencial_membro m
           JOIN equipe_assistencial_paciente e ON e.id = m.equipe_assistencial_paciente_id
           JOIN atendimento a ON a.id = e.atendimento_id AND a.excluido_em IS NULL
          WHERE e.paciente_id = ? AND e.estabelecimento_id = ? AND e.situacao = 'ativa' AND e.excluido_em IS NULL
            AND m.excluido_em IS NULL AND m.fim_em IS NULL AND m.profissional_id IN (${profs.map(() => '?').join(', ')})`,
        [paciente, est.id, ...profs],
      );
      const abertos = r
        .filter((x) => atendimentoAberto(String(x['atd_situacao']), (x['atd_saida'] as Date | null) ?? null))
        .map((x) => membroLido({ ...x, nome: '', descricao: '' }, est.fuso));
      return profs.some((p) => temVinculoPelaEquipe(abertos, p));
    });
  }

  /** A fila de pendências pela equipe: os pacientes de atendimento aberto cujas pendências chegam à conta da sessão. */
  filaDaEquipe(c: ContextoDocs): Promise<ItemFilaEquipe[]> {
    return this.ler(c, 'fila-equipe', async (l, est) => {
      const profs = await this.profissionaisDoUsuario(l, est, c.usuario);
      if (!profs.length) return [];
      const equipes = await l.consultar(
        `SELECT e.id, e.atendimento_id, e.paciente_id, a.numero, a.situacao, a.saida_em, pf.nome
           FROM equipe_assistencial_paciente e
           JOIN atendimento a ON a.id = e.atendimento_id AND a.excluido_em IS NULL
           LEFT JOIN paciente p ON p.id = e.paciente_id
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE e.estabelecimento_id = ? AND e.situacao = 'ativa' AND e.excluido_em IS NULL
            AND EXISTS (SELECT 1 FROM equipe_assistencial_membro m
                         WHERE m.equipe_assistencial_paciente_id = e.id AND m.fim_em IS NULL AND m.excluido_em IS NULL
                           AND m.profissional_id IN (${profs.map(() => '?').join(', ')}))
          ORDER BY e.inicio_em LIMIT 200`,
        [est.id, ...profs],
      );
      const abertas = [];
      for (const e of equipes) {
        if (!atendimentoAberto(String(e['situacao']), (e['saida_em'] as Date | null) ?? null)) continue;
        abertas.push({
          equipe: num(e['id']),
          atendimento: num(e['atendimento_id']),
          numero: String(e['numero'] ?? ''),
          paciente: num(e['paciente_id']),
          pacienteNome: String(e['nome'] ?? `Paciente ${num(e['paciente_id'])}`),
          membros: (await l.consultar(SQL_MEMBROS, [e['id']])).map((x) => membroLido(x, est.fuso)),
        });
      }
      return filaDePendenciasDaEquipe(abertas, profs).map((x) => ({
        equipe: x.equipe,
        atendimento: x.atendimento,
        numero: x.numero,
        paciente: x.paciente,
        pacienteNome: x.pacienteNome,
        responsavel: x.responsavel,
      }));
    });
  }

  /** As equipes padrão do estabelecimento; com o atendimento, as que servem a ele (setor, depois especialidade). */
  padroes(
    c: ContextoDocs,
    atendimento: number | null,
  ): Promise<{ itens: EquipePadraoLida[]; sugeridos: number[] }> {
    return this.ler(c, 'padroes', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT q.id, q.nome, q.setor_funcional_id, s.nome AS setor_nome, q.especialidade_medica_id,
                q.sugerir_automaticamente, q.ativo, q.versao
           FROM equipe_assistencial_padrao q LEFT JOIN setor_funcional s ON s.id = q.setor_funcional_id
          WHERE q.estabelecimento_id = ? ORDER BY q.ativo DESC, q.nome LIMIT 200`,
        [est.id],
      );
      const itens: EquipePadraoLida[] = [];
      for (const x of linhas) {
        const membros = await l.consultar(
          `SELECT pm.sequencia, pm.funcao_equipe_assistencial_id, f.descricao, pm.profissional_id, pm.responsavel,
                  pf.nome
             FROM equipe_assistencial_padrao_membro pm
             JOIN funcao_equipe_assistencial f ON f.id = pm.funcao_equipe_assistencial_id
             LEFT JOIN profissional p ON p.id = pm.profissional_id
             LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE pm.equipe_assistencial_padrao_id = ? AND pm.excluido_em IS NULL ORDER BY pm.sequencia`,
          [x['id']],
        );
        itens.push({
          id: num(x['id']),
          nome: String(x['nome']),
          setor: numOuNull(x['setor_funcional_id']),
          setorNome: txt(x['setor_nome']),
          especialidade: numOuNull(x['especialidade_medica_id']),
          sugerir: bool(x['sugerir_automaticamente']),
          ativo: bool(x['ativo']),
          versao: num(x['versao']),
          membros: membros.map((m) => ({
            sequencia: num(m['sequencia']),
            funcao: num(m['funcao_equipe_assistencial_id']),
            funcaoDescricao: String(m['descricao'] ?? ''),
            profissional: numOuNull(m['profissional_id']),
            profissionalNome: txt(m['nome']),
            responsavel: bool(m['responsavel']),
          })),
        });
      }
      let sugeridos: number[] = [];
      if (atendimento !== null) {
        const a = await l.uma(
          `SELECT setor_funcional_id, especialidade_medica_id FROM atendimento
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [atendimento, est.id],
        );
        if (!a) throw naoEncontrado('Atendimento');
        sugeridos = padroesDoAtendimento(
          itens.filter((p) => p.sugerir),
          numOuNull(a['setor_funcional_id']),
          numOuNull(a['especialidade_medica_id']),
        ).map((p) => p.id);
      }
      return { itens, sugeridos };
    });
  }

  /** Grava a equipe padrão do setor ou serviço (pelas regras do domínio), com os membros na ordem dada. */
  async gravarPadrao(c: ContextoDocs, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaEquipePadrao, entrada);
    return this.gravar(
      c,
      'pep.equipe.gravar_padrao',
      ['equipe_assistencial_padrao', 'equipe_assistencial_padrao_membro'],
      async (tx, est) => {
        if (x.setor !== null) {
          const s = await tx.uma('SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ?', [
            x.setor,
            est.id,
          ]);
          if (!s) throw naoEncontrado('Setor');
        }
        const funcoes = new Map<number, FuncaoEquipe>();
        for (const m of x.membros) {
          if (funcoes.has(m.funcao)) continue;
          const f = await tx.uma(
            'SELECT id, categoria, responsavel_principal, ativo FROM funcao_equipe_assistencial WHERE id = ?',
            [m.funcao],
          );
          if (!f) throw naoEncontrado('Função');
          funcoes.set(m.funcao, {
            id: num(f['id']),
            categoria: String(f['categoria']) as FuncaoEquipe['categoria'],
            responsavelPrincipal: bool(f['responsavel_principal']),
            ativo: bool(f['ativo']),
          });
        }
        const erros = validarEquipePadrao({
          nome: x.nome,
          setor: x.setor,
          especialidade: x.especialidade,
          membros: x.membros.map((m) => ({
            funcao: funcoes.get(m.funcao)!,
            profissional: m.profissional,
            responsavel: m.responsavel,
          })),
        });
        if (erros.length) throw recusaRegra(erros);
        const id = await tx
          .incluir('equipe_assistencial_padrao', {
            estabelecimento_id: est.id,
            nome: x.nome.trim(),
            setor_funcional_id: x.setor,
            especialidade_medica_id: x.especialidade,
            sugerir_automaticamente: x.sugerirAutomaticamente,
          })
          .catch((err: unknown) => {
            if (duplicada(err)) throw conflito('nome-repetido', 'Já existe equipe padrão com este nome.');
            throw err;
          });
        let sequencia = 0;
        for (const m of x.membros)
          await tx.incluir('equipe_assistencial_padrao_membro', {
            equipe_assistencial_padrao_id: id,
            sequencia: ++sequencia,
            funcao_equipe_assistencial_id: m.funcao,
            profissional_id: m.profissional,
            responsavel: m.responsavel,
          });
        return { tabela: 'equipe_assistencial_padrao', id };
      },
    );
  }

  /** Desativa a equipe padrão (deixa de ser sugerida; o histórico de quem a usou fica). */
  async desativarPadrao(c: ContextoDocs, padrao: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaVersao, entrada);
    return this.gravar(c, 'pep.equipe.desativar_padrao', ['equipe_assistencial_padrao'], async (tx, est) => {
      const p = await tx.uma(
        'SELECT id FROM equipe_assistencial_padrao WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE',
        [padrao, est.id],
      );
      if (!p) throw naoEncontrado('Equipe padrão');
      await tx.alterar('equipe_assistencial_padrao', padrao, x.versao, { ativo: false });
      return { tabela: 'equipe_assistencial_padrao', id: padrao };
    });
  }

  /**
   * Aplica a equipe padrão ao atendimento numa transação só: abre a equipe se preciso (marcando o padrão de partida),
   * inclui os membros nomeados que faltam com as mesmas regras da inclusão manual e devolve os ignorados com o motivo.
   */
  async aplicarPadrao(
    c: ContextoDocs,
    atendimento: number,
    padrao: number,
  ): Promise<{
    id: number;
    equipe: number;
    incluidos: number;
    ignorados: { sequencia: number; codigo: string }[];
  }> {
    return this.gravar(
      c,
      'pep.equipe.aplicar_padrao',
      ['equipe_assistencial_paciente', 'equipe_assistencial_membro'],
      async (tx, est) => {
        const a = await tx.uma(
          `SELECT id, paciente_id, situacao, saida_em FROM atendimento
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [atendimento, est.id],
        );
        if (!a) throw naoEncontrado('Atendimento');
        if (!atendimentoAberto(String(a['situacao']), (a['saida_em'] as Date | null) ?? null))
          throw recusaRegra([
            { campo: 'atendimento', codigo: 'atendimento-encerrado', mensagem: 'O atendimento já terminou.' },
          ]);
        const q = await tx.uma(
          'SELECT id FROM equipe_assistencial_padrao WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE',
          [padrao, est.id],
        );
        if (!q) throw naoEncontrado('Equipe padrão');
        const modelo = (
          await tx.consultar(
            `SELECT pm.sequencia, pm.funcao_equipe_assistencial_id, pm.profissional_id, pm.responsavel
               FROM equipe_assistencial_padrao_membro pm
              WHERE pm.equipe_assistencial_padrao_id = ? AND pm.excluido_em IS NULL`,
            [padrao],
          )
        ).map((m) => ({
          sequencia: num(m['sequencia']),
          funcao: num(m['funcao_equipe_assistencial_id']),
          profissional: numOuNull(m['profissional_id']),
          responsavel: bool(m['responsavel']),
        }));
        const agora = new Date();
        const e = await umaTravada(
          tx,
          `SELECT id, situacao, equipe_assistencial_padrao_id, versao FROM equipe_assistencial_paciente
            WHERE atendimento_id = ? AND excluido_em IS NULL`,
          [atendimento],
        );
        if (e && String(e['situacao']) === 'encerrada')
          throw recusaRegra([
            {
              campo: 'equipe',
              codigo: 'equipe-encerrada',
              mensagem: 'A equipe deste atendimento foi encerrada.',
            },
          ]);
        let equipe: number;
        if (e) {
          equipe = num(e['id']);
          if (e['equipe_assistencial_padrao_id'] === null)
            await tx.alterar('equipe_assistencial_paciente', equipe, num(e['versao']), {
              equipe_assistencial_padrao_id: padrao,
            });
        } else
          equipe = await tx
            .incluir('equipe_assistencial_paciente', {
              estabelecimento_id: est.id,
              atendimento_id: atendimento,
              paciente_id: num(a['paciente_id']),
              equipe_assistencial_padrao_id: padrao,
              inicio_em: agora,
              situacao: 'ativa',
            })
            .catch((err: unknown) => {
              if (duplicada(err))
                throw conflito(
                  'equipe-concorrente',
                  'Outra pessoa abriu a equipe agora; recarregue e aplique de novo.',
                );
              throw err;
            });
        const atuais = (await tx.consultarParaAtualizar(SQL_MEMBROS, [equipe])).map((m) =>
          membroLido(m, est.fuso),
        );
        const plano = planoEquipePadrao(atuais, modelo);
        const ignorados = [...plano.ignorados];
        const seq = await tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) AS s FROM equipe_assistencial_membro WHERE equipe_assistencial_paciente_id = ?',
          [equipe],
        );
        let sequencia = num(seq?.['s'] ?? 0);
        let incluidos = 0;
        const ja: MembroEquipe[] = [...atuais];
        for (const m of plano.incluir) {
          const f = await tx.uma(
            'SELECT id, categoria, responsavel_principal, ativo FROM funcao_equipe_assistencial WHERE id = ?',
            [m.funcao],
          );
          const lotacoes = await tx.consultar(
            `SELECT o.codigo_cbo FROM lotacao_profissional lp JOIN ocupacao_cbo o ON o.id = lp.ocupacao_cbo_id
              WHERE lp.profissional_id = ? AND lp.estabelecimento_id = ? AND lp.ativo = TRUE AND lp.excluido_em IS NULL
                AND lp.vigencia_inicio <= CURRENT_DATE AND (lp.vigencia_fim IS NULL OR lp.vigencia_fim >= CURRENT_DATE)`,
            [m.profissional, est.id],
          );
          const funcao: FuncaoEquipe | null = f
            ? {
                id: num(f['id']),
                categoria: String(f['categoria']) as FuncaoEquipe['categoria'],
                responsavelPrincipal: bool(f['responsavel_principal']),
                ativo: bool(f['ativo']),
              }
            : null;
          const erros = funcao
            ? validarInclusaoMembro(ja, {
                profissional: m.profissional!,
                funcao,
                recebeNotificacao: m.responsavel,
                categoriasNoEstabelecimento: lotacoes.map((x) => categoriaDoCbo(txt(x['codigo_cbo']))),
                especialidade: null,
                especialidadesDoProfissional: [],
              })
            : [{ campo: 'funcao', codigo: 'funcao-inexistente', mensagem: 'Função não encontrada.' }];
          if (erros.length) {
            ignorados.push({ sequencia: m.sequencia, codigo: erros[0]!.codigo });
            continue;
          }
          const id = await tx.incluir('equipe_assistencial_membro', {
            equipe_assistencial_paciente_id: equipe,
            sequencia: ++sequencia,
            profissional_id: m.profissional,
            funcao_equipe_assistencial_id: funcao!.id,
            responsavel_principal: funcao!.responsavelPrincipal,
            recebe_notificacao: m.responsavel || funcao!.responsavelPrincipal,
            inicio_em: agora,
          });
          ja.push({
            id,
            profissional: m.profissional!,
            funcao: funcao!.id,
            responsavelPrincipal: funcao!.responsavelPrincipal,
            recebeNotificacao: true,
            inicio: '',
            fim: null,
          });
          incluidos += 1;
        }
        ignorados.sort((x, y) => x.sequencia - y.sequencia);
        return { tabela: 'equipe_assistencial_paciente', id: equipe, equipe, incluidos, ignorados };
      },
    );
  }
}
