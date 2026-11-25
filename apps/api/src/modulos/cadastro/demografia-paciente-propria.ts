// Dados demográficos do paciente no banco próprio (F3.1, 02-CAD linha 15): nome social e o uso dele, identidade de
// gênero, raça/cor e povo indígena, escolaridade, ocupação, religião, nacionalidade, país de nascimento, capacidade
// civil e as condições de vulnerabilidade (declaradas com data e informante; encerradas com data, nunca apagadas).
//   - os dados são da pessoa (`pessoa_fisica`) e o cadastro do paciente (`paciente`) guarda a mesma escolha, na mesma
//     transação: o prontuário lê o nome de tratamento pelo paciente, e o cadastro, pela pessoa;
//   - a capacidade civil é só do paciente;
//   - cada opção é conferida no vocabulário (existe e está ativa; a que já estava gravada continua aceita);
//   - a regra é do domínio (`@sgh/dominio-cadastro`, paciente/demografia.ts): nome social exigido quando usado, povo
//     indígena sempre e só com a raça/cor que exige etnia, capacidade que exige responsável legal só com representante
//     vigente no cadastro.
// Gravação pelo executor (trilha e idempotência na transação). Sem gatilho.
import { randomUUID } from 'node:crypto';
import {
  CAMPO_DO_ERRO_DEMOGRAFIA,
  type ErroDemografia,
  errosDemografia,
  errosVulnerabilidade,
  INFORMANTES_VULNERABILIDADE,
  PAPEIS_REPRESENTANTE,
  type PapelResponsavel,
  recusaFimVulnerabilidade,
} from '@sgh/dominio-cadastro';
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
import type { ContextoPorta } from './porta.js';
import type { NucleoCadastro } from './porta-propria.js';
import { situacaoRepresentacao } from './representacao-paciente-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

export const DEMOGRAFIA_PACIENTE = Symbol('DEMOGRAFIA_PACIENTE');

const TETO = 500;
const TETO_BUSCA = 20;
const data = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);
const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const numero = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const sim = (v: unknown): boolean => v === true || v === 1 || v === '1' || Number(v) === 1;
const recusaCampos = (codigo: string, detalhe: string, campos: readonly string[]): ErroOperacao =>
  recusa(codigo, detalhe, { campos: [...campos] });

// ── Vocabulários: o campo da tela, a tabela, a coluna da pessoa e a do paciente ──

interface Vocabulario {
  readonly campo: CampoVocabulario;
  readonly tabela: string;
  readonly pessoa: string | null;
  readonly paciente: string;
  /** Expressão da linha em uso (o vocabulário sem a coluna `ativo` usa a vigência, ou vale sempre). */
  readonly emUso: string;
  /** Coluna a mais que a regra usa (a raça/cor que exige etnia, a capacidade que exige responsável). */
  readonly marca?: string;
  readonly ordem: string;
}

type CampoVocabulario =
  | 'identidadeGenero'
  | 'racaCor'
  | 'povoIndigena'
  | 'escolaridade'
  | 'religiao'
  | 'nacionalidade'
  | 'paisNascimento'
  | 'capacidadeCivil'
  | 'ocupacao';

const VIGENTE = '(vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)';
const VOCABULARIOS: readonly Vocabulario[] = [
  {
    campo: 'identidadeGenero',
    tabela: 'identidade_de_genero',
    pessoa: 'identidade_de_genero_id',
    paciente: 'identidade_de_genero_id',
    emUso: 'ativo',
    marca: 'pede_nome_social',
    ordem: 'descricao',
  },
  {
    campo: 'racaCor',
    tabela: 'classificacao_raca_cor',
    pessoa: 'classificacao_raca_cor_id',
    paciente: 'classificacao_raca_cor_id',
    emUso: `ativo AND ${VIGENTE}`,
    marca: 'exige_etnia',
    ordem: 'codigo_ibge',
  },
  {
    campo: 'povoIndigena',
    tabela: 'povo_indigena',
    pessoa: 'povo_indigena_id',
    paciente: 'povo_indigena_id',
    emUso: VIGENTE,
    ordem: 'descricao',
  },
  {
    campo: 'escolaridade',
    tabela: 'nivel_escolaridade',
    pessoa: 'nivel_escolaridade_id',
    paciente: 'nivel_escolaridade_id',
    emUso: 'ativo',
    ordem: 'ordem, descricao',
  },
  {
    campo: 'religiao',
    tabela: 'crenca_religiosa',
    pessoa: 'crenca_religiosa_id',
    paciente: 'crenca_religiosa_id',
    emUso: 'ativo',
    ordem: 'descricao',
  },
  {
    campo: 'nacionalidade',
    tabela: 'nacionalidade',
    pessoa: 'nacionalidade_id',
    paciente: 'nacionalidade_id',
    emUso: `ativo AND ${VIGENTE}`,
    ordem: 'brasileira DESC, descricao',
  },
  {
    campo: 'paisNascimento',
    tabela: 'pais_referencia',
    pessoa: 'pais_nascimento_id',
    paciente: 'nascimento_pais_referencia_id',
    emUso: VIGENTE,
    ordem: 'descricao',
  },
  {
    campo: 'capacidadeCivil',
    tabela: 'capacidade_civil',
    pessoa: null,
    paciente: 'capacidade_civil_id',
    emUso: 'ativo',
    marca: 'exige_responsavel_legal',
    ordem: 'descricao',
  },
  {
    campo: 'ocupacao',
    tabela: 'ocupacao_cbo',
    pessoa: 'ocupacao_cbo_id',
    paciente: 'ocupacao_cbo_id',
    emUso: `ativo AND ${VIGENTE}`,
    ordem: 'descricao',
  },
];
const vocabulario = (campo: CampoVocabulario): Vocabulario => VOCABULARIOS.find((v) => v.campo === campo)!;
/** Os vocabulários curtos, que a tela recebe inteiros; a ocupação (milhares de linhas) é por busca. */
const LISTADOS = VOCABULARIOS.filter((v) => v.campo !== 'ocupacao');

export interface OpcaoDemografia {
  id: number;
  descricao: string;
  /** A marca que a regra usa: a raça/cor exige etnia, a capacidade exige responsável, a identidade pede nome social. */
  marca: boolean;
}

export interface VulnerabilidadePaciente {
  id: number;
  condicao: { id: number; descricao: string };
  declaradaEm: string;
  informanteTipo: string;
  informanteNome: string | null;
  fim: string | null;
  vigente: boolean;
  observacao: string | null;
  versao: number;
}

export interface DemografiaPaciente {
  paciente: number;
  hoje: string;
  nome: string;
  usaNomeSocial: boolean;
  nomeSocial: string | null;
  identidadeGenero: number | null;
  racaCor: number | null;
  povoIndigena: number | null;
  escolaridade: number | null;
  religiao: number | null;
  nacionalidade: number | null;
  paisNascimento: number | null;
  capacidadeCivil: number | null;
  ocupacao: { id: number; descricao: string } | null;
  /** Há representante legal vigente hoje (a capacidade que exige responsável só grava com ele). */
  temRepresentanteVigente: boolean;
  opcoes: Record<Exclude<CampoVocabulario, 'ocupacao'>, OpcaoDemografia[]> & {
    condicoesVulnerabilidade: OpcaoDemografia[];
    informantes: readonly string[];
  };
  vulnerabilidades: VulnerabilidadePaciente[];
}

// ── Leitura do que está gravado (na transação de quem usa) ──

interface Gravado {
  readonly pessoa: number;
  readonly versaoPessoa: number;
  readonly versaoPaciente: number;
  readonly nome: string;
  readonly nascimento: string | null;
  readonly hoje: string;
  readonly usaNomeSocial: boolean;
  readonly nomeSocial: string | null;
  readonly ids: Record<CampoVocabulario, number | null>;
}

async function gravado(tx: Leitor | TxOperacao, paciente: number): Promise<Gravado> {
  const colunas = VOCABULARIOS.map(
    (v) => `${v.pessoa ? `COALESCE(pf.${v.pessoa}, p.${v.paciente})` : `p.${v.paciente}`} AS ${v.tabela}`,
  ).join(', ');
  const l = await tx.uma(
    `SELECT pf.id AS pessoa, pf.versao AS versao_pessoa, p.versao AS versao_paciente, pf.nome, pf.data_nascimento,
            CURRENT_DATE AS hoje, (pf.usa_nome_social OR p.usa_nome_social) AS usa_nome_social,
            COALESCE(pf.nome_social, p.nome_social) AS nome_social, ${colunas}
       FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
      WHERE p.id = ? AND p.excluido_em IS NULL`,
    [paciente],
  );
  if (!l) throw recusa('paciente-inexistente', 'O paciente não existe.', { campos: ['idPaciente'] });
  const ids = {} as Record<CampoVocabulario, number | null>;
  for (const v of VOCABULARIOS) ids[v.campo] = numero(l[v.tabela]);
  return {
    pessoa: Number(l['pessoa']),
    versaoPessoa: Number(l['versao_pessoa']),
    versaoPaciente: Number(l['versao_paciente']),
    nome: String(l['nome']),
    nascimento: data(l['data_nascimento']),
    hoje: data(l['hoje']) ?? new Date().toISOString().slice(0, 10),
    usaNomeSocial: sim(l['usa_nome_social']),
    nomeSocial: texto(l['nome_social']),
    ids,
  };
}

async function temRepresentante(tx: Leitor | TxOperacao, paciente: number): Promise<boolean> {
  const s = await situacaoRepresentacao(tx, paciente);
  return s.vigentes.some((v) => PAPEIS_REPRESENTANTE.includes(v.papel as PapelResponsavel));
}

/**
 * A opção escolhida no vocabulário: existe e está em uso (a que já estava gravada continua aceita, mesmo desativada
 * depois). Devolve a marca que a regra usa; opção inválida recusa com o campo.
 */
async function conferirOpcao(
  tx: TxOperacao,
  v: Vocabulario,
  id: number | null,
  anterior: number | null,
): Promise<boolean | null> {
  if (id === null) return null;
  const l = await tx.uma(
    `SELECT id, ${v.marca ?? '0'} AS marca, (${v.emUso}) AS em_uso FROM ${v.tabela} WHERE id = ?`,
    [id],
  );
  if (!l || (!sim(l['em_uso']) && id !== anterior))
    throw recusaCampos('opcao-invalida', 'A opção escolhida não existe ou não está mais em uso.', [v.campo]);
  return sim(l['marca']);
}

const MENSAGEM: Record<ErroDemografia, string> = {
  'nome-social-exigido': 'Informe o nome social, ou desmarque o uso dele.',
  'nome-social-igual-ao-nome': 'O nome social é igual ao nome civil: deixe-o em branco.',
  'povo-indigena-exigido': 'Para a raça/cor indígena, informe o povo indígena (etnia).',
  'povo-indigena-indevido': 'O povo indígena só é informado com a raça/cor indígena.',
  'capacidade-sem-responsavel':
    'Esta capacidade civil exige responsável legal: inclua antes o responsável vigente na ficha do paciente.',
};

// ── Operações ──

const idOpcional = z.number().int().positive().nullable();
const esquemaDemografia = z
  .object({
    paciente: z.number().int().positive(),
    usaNomeSocial: z.boolean(),
    nomeSocial: z.string().trim().max(150).nullable(),
    identidadeGenero: idOpcional,
    racaCor: idOpcional,
    povoIndigena: idOpcional,
    escolaridade: idOpcional,
    religiao: idOpcional,
    nacionalidade: idOpcional,
    paisNascimento: idOpcional,
    capacidadeCivil: idOpcional,
    ocupacao: idOpcional,
  })
  .strict();
export type EntradaDemografia = z.infer<typeof esquemaDemografia>;

const operacaoGravarDemografia = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.gravar-demografia-paciente',
    tabelas: ['pessoa_fisica', 'paciente'],
    entrada: esquemaDemografia,
    acao: 'alteracao',
    async gravar(tx, e) {
      const g = await gravado(tx, e.paciente);
      const marcas = {} as Record<CampoVocabulario, boolean | null>;
      for (const v of VOCABULARIOS) marcas[v.campo] = await conferirOpcao(tx, v, e[v.campo], g.ids[v.campo]);
      const nomeSocial = (e.nomeSocial ?? '').trim().replace(/\s+/g, ' ') || null;
      const erros = errosDemografia({
        nome: g.nome,
        usaNomeSocial: e.usaNomeSocial,
        nomeSocial,
        racaCorExigeEtnia: marcas.racaCor,
        temPovoIndigena: e.povoIndigena !== null,
        capacidadeExigeResponsavel: marcas.capacidadeCivil,
        // A capacidade que já estava gravada não é conferida de novo (o responsável pode ter saído depois: a pendência
        // é da representação, e a ficha continua editável).
        temRepresentanteVigente:
          marcas.capacidadeCivil !== true ||
          e.capacidadeCivil === g.ids.capacidadeCivil ||
          (await temRepresentante(tx, e.paciente)),
      });
      if (erros.length > 0)
        throw recusaCampos(erros[0]!, MENSAGEM[erros[0]!], [
          ...new Set(erros.map((x) => CAMPO_DO_ERRO_DEMOGRAFIA[x])),
        ]);
      const pessoa: Record<string, unknown> = { usa_nome_social: e.usaNomeSocial, nome_social: nomeSocial };
      const paciente: Record<string, unknown> = { usa_nome_social: e.usaNomeSocial, nome_social: nomeSocial };
      for (const v of VOCABULARIOS) {
        if (v.pessoa) pessoa[v.pessoa] = e[v.campo];
        paciente[v.paciente] = e[v.campo];
      }
      await tx.alterar('pessoa_fisica', g.pessoa, g.versaoPessoa, pessoa);
      await tx.alterar('paciente', e.paciente, g.versaoPaciente, paciente);
      return { id: e.paciente };
    },
    alvo: (e) => ({ tabela: 'paciente', id: e.paciente }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

const esquemaVulnerabilidade = z
  .object({
    paciente: z.number().int().positive(),
    condicao: z.number().int().positive(),
    declaradaEm: z.string().trim().max(10),
    informanteTipo: z.string().trim().max(30),
    informanteNome: z.string().trim().max(150).nullable(),
    observacao: z.string().trim().max(500).nullable(),
  })
  .strict();
export type EntradaVulnerabilidade = z.infer<typeof esquemaVulnerabilidade>;

const MENSAGEM_VULNERABILIDADE: Record<string, string> = {
  'ja-vigente': 'O paciente já tem esta condição vigente: encerre-a antes de declarar de novo.',
  declaradaEm: 'A data da declaração não pode ser futura nem anterior ao nascimento do paciente.',
  informanteTipo: 'Escolha quem informou a condição.',
  informanteNome: 'Informe o nome de quem declarou a condição.',
};

const operacaoDeclararVulnerabilidade = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.declarar-vulnerabilidade-paciente',
    tabelas: ['paciente_vulnerabilidade'],
    entrada: esquemaVulnerabilidade,
    acao: 'inclusao',
    async gravar(tx, e) {
      const g = await gravado(tx, e.paciente);
      const c = await tx.uma('SELECT id, ativo FROM condicao_vulnerabilidade WHERE id = ?', [e.condicao]);
      if (!c || !sim(c['ativo']))
        throw recusaCampos('opcao-invalida', 'A condição escolhida não existe ou não está mais em uso.', [
          'condicao',
        ]);
      const vigente = await tx.uma(
        `SELECT id FROM paciente_vulnerabilidade
          WHERE paciente_id = ? AND condicao_vulnerabilidade_id = ? AND excluido_em IS NULL
            AND (vigencia_fim IS NULL OR declarada_em = ?)`,
        [e.paciente, e.condicao, e.declaradaEm],
      );
      const erros = errosVulnerabilidade(
        { declaradaEm: e.declaradaEm, informanteTipo: e.informanteTipo, informanteNome: e.informanteNome },
        g.nascimento,
        g.hoje,
        vigente !== null && vigente !== undefined,
      );
      if (erros.length > 0)
        throw recusaCampos(
          erros[0] === 'ja-vigente' ? 'vulnerabilidade-ja-vigente' : 'vulnerabilidade-invalida',
          MENSAGEM_VULNERABILIDADE[erros[0]!] ?? 'Confira os dados da condição.',
          erros.filter((x) => x !== 'ja-vigente'),
        );
      const id = await tx.incluir('paciente_vulnerabilidade', {
        paciente_id: e.paciente,
        condicao_vulnerabilidade_id: e.condicao,
        declarada_em: e.declaradaEm,
        informante_tipo: e.informanteTipo,
        informante_nome: (e.informanteNome ?? '').trim() || null,
        observacao: (e.observacao ?? '').trim() || null,
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'paciente_vulnerabilidade', id: Number(r.id) }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

const esquemaFimVulnerabilidade = z
  .object({
    paciente: z.number().int().positive(),
    id: z.number().int().positive(),
    fim: z.string().trim().max(10),
  })
  .strict();
export type EntradaFimVulnerabilidade = z.infer<typeof esquemaFimVulnerabilidade>;

const operacaoEncerrarVulnerabilidade = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.encerrar-vulnerabilidade-paciente',
    tabelas: ['paciente_vulnerabilidade'],
    entrada: esquemaFimVulnerabilidade,
    acao: 'alteracao',
    async gravar(tx, e) {
      const g = await gravado(tx, e.paciente);
      const v = await tx.uma(
        `SELECT id, versao, declarada_em FROM paciente_vulnerabilidade
          WHERE id = ? AND paciente_id = ? AND vigencia_fim IS NULL AND excluido_em IS NULL`,
        [e.id, e.paciente],
      );
      if (!v)
        throw recusaCampos('vulnerabilidade-inexistente', 'A condição não existe ou já foi encerrada.', [
          'id',
        ]);
      if (recusaFimVulnerabilidade(data(v['declarada_em']) ?? '', e.fim, g.hoje))
        throw recusaCampos(
          'fim-invalido',
          'A data do fim não pode ser futura nem anterior à declaração da condição.',
          ['fim'],
        );
      await tx.alterar('paciente_vulnerabilidade', e.id, Number(v['versao']), { vigencia_fim: e.fim });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'paciente_vulnerabilidade', id: e.id }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

// ── Porta ──

export class DemografiaPacientePropria {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCadastro,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'cadastro' }, fn);
  }

  private async executar<E>(
    c: ContextoPorta,
    op: Parameters<Executor['executar']>[0],
    entrada: E,
    trilha: RegistroTrilhaTela,
  ): Promise<number> {
    let est = trilha.estabelecimento ?? c.estabelecimento;
    if (est === null && c.hospital) {
      const r = await this.ler(c, (l) =>
        l.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
          c.hospital,
        ]),
      );
      est = r ? Number(r.id) : null;
    }
    if (est === null)
      throw new ErroOperacao(
        403,
        'sem-estabelecimento',
        'Sem estabelecimento',
        'A sessão não tem estabelecimento.',
      );
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: trilha.usuario ?? c.usuario,
      correlacao: (trilha.correlacao ?? c.correlacao).slice(0, 64) || 'cadastro',
      chaveIdempotencia: `direta:${randomUUID()}`,
    };
    const x = await this.executor.executar(op, this.cliente, entrada, ctx);
    return Number((x.resultado as { id: unknown }).id);
  }

  /** O que está gravado, os vocabulários em uso (com a opção gravada, mesmo desativada) e as vulnerabilidades. */
  async demografia(c: ContextoPorta, paciente: number): Promise<DemografiaPaciente> {
    return this.ler(c, async (l) => {
      const g = await gravado(l, paciente);
      const opcoes = {} as DemografiaPaciente['opcoes'];
      for (const v of LISTADOS) {
        const linhas = await l.consultar(
          `SELECT id, descricao, ${v.marca ?? '0'} AS marca FROM ${v.tabela}
            WHERE (${v.emUso}) OR id = ? ORDER BY ${v.ordem}`,
          [g.ids[v.campo] ?? 0],
          { teto: TETO },
        );
        opcoes[v.campo as Exclude<CampoVocabulario, 'ocupacao'>] = linhas.map((x) => ({
          id: Number(x['id']),
          descricao: String(x['descricao']),
          marca: sim(x['marca']),
        }));
      }
      const condicoes = await l.consultar(
        'SELECT id, descricao FROM condicao_vulnerabilidade WHERE ativo ORDER BY descricao',
        [],
        { teto: TETO },
      );
      opcoes.condicoesVulnerabilidade = condicoes.map((x) => ({
        id: Number(x['id']),
        descricao: String(x['descricao']),
        marca: false,
      }));
      opcoes.informantes = INFORMANTES_VULNERABILIDADE;
      const ocupacao =
        g.ids.ocupacao === null
          ? null
          : await l.uma(
              'SELECT id, COALESCE(descricao_hospital, descricao) AS d FROM ocupacao_cbo WHERE id = ?',
              [g.ids.ocupacao],
            );
      const vul = await l.consultar(
        `SELECT v.id, v.versao, v.condicao_vulnerabilidade_id, cv.descricao, v.declarada_em, v.informante_tipo,
                v.informante_nome, v.vigencia_fim, v.observacao
           FROM paciente_vulnerabilidade v
           JOIN condicao_vulnerabilidade cv ON cv.id = v.condicao_vulnerabilidade_id
          WHERE v.paciente_id = ? AND v.excluido_em IS NULL
          ORDER BY v.vigencia_fim IS NULL DESC, v.declarada_em DESC, v.id DESC`,
        [paciente],
        { teto: TETO },
      );
      return {
        paciente,
        hoje: g.hoje,
        nome: g.nome,
        usaNomeSocial: g.usaNomeSocial,
        nomeSocial: g.nomeSocial,
        identidadeGenero: g.ids.identidadeGenero,
        racaCor: g.ids.racaCor,
        povoIndigena: g.ids.povoIndigena,
        escolaridade: g.ids.escolaridade,
        religiao: g.ids.religiao,
        nacionalidade: g.ids.nacionalidade,
        paisNascimento: g.ids.paisNascimento,
        capacidadeCivil: g.ids.capacidadeCivil,
        ocupacao: ocupacao ? { id: Number(ocupacao['id']), descricao: String(ocupacao['d']) } : null,
        temRepresentanteVigente: await temRepresentante(l, paciente),
        opcoes,
        vulnerabilidades: vul.map((x) => ({
          id: Number(x['id']),
          condicao: { id: Number(x['condicao_vulnerabilidade_id']), descricao: String(x['descricao']) },
          declaradaEm: data(x['declarada_em']) ?? '',
          informanteTipo: String(x['informante_tipo']),
          informanteNome: texto(x['informante_nome']),
          fim: data(x['vigencia_fim']),
          vigente: x['vigencia_fim'] === null || x['vigencia_fim'] === undefined,
          observacao: texto(x['observacao']),
          versao: Number(x['versao']),
        })),
      };
    });
  }

  /** Ocupações em uso pelo código ou por um trecho da descrição (até 20; menos de 3 caracteres: nenhuma). */
  async ocupacoes(c: ContextoPorta, termo: string): Promise<{ itens: { id: number; descricao: string }[] }> {
    const t = termo.trim();
    if (t.length < 3) return { itens: [] };
    const codigo = /^\d{4,6}$/.test(t);
    const linhas = await this.ler(c, (l) =>
      l.consultar(
        `SELECT id, codigo_cbo, COALESCE(descricao_hospital, descricao) AS d FROM ocupacao_cbo
          WHERE ${vocabulario('ocupacao').emUso} AND ${codigo ? 'codigo_cbo LIKE ?' : 'COALESCE(descricao_hospital, descricao) LIKE ?'}
          ORDER BY d LIMIT ${TETO_BUSCA}`,
        [codigo ? `${t}%` : `%${t.replace(/[\\%_]/g, '\\$&')}%`],
        { teto: TETO_BUSCA },
      ),
    );
    return {
      itens: linhas.map((x) => ({
        id: Number(x['id']),
        descricao: `${String(x['codigo_cbo'])} ${String(x['d'])}`,
      })),
    };
  }

  gravar(c: ContextoPorta, e: EntradaDemografia, t: RegistroTrilhaTela): Promise<number> {
    return this.executar(c, operacaoGravarDemografia(t) as never, e, t);
  }

  declararVulnerabilidade(
    c: ContextoPorta,
    e: EntradaVulnerabilidade,
    t: RegistroTrilhaTela,
  ): Promise<number> {
    return this.executar(c, operacaoDeclararVulnerabilidade(t) as never, e, t);
  }

  encerrarVulnerabilidade(
    c: ContextoPorta,
    e: EntradaFimVulnerabilidade,
    t: RegistroTrilhaTela,
  ): Promise<number> {
    return this.executar(c, operacaoEncerrarVulnerabilidade(t) as never, e, t);
  }
}
