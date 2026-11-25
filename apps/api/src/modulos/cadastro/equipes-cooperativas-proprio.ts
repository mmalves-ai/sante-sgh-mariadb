// Equipes médicas e cooperativas do profissional no banco próprio (F8, 02-CAD linha 22). A equipe em
// `equipe_profissional` (código único no estabelecimento, tipo, setor e vigência) com os membros em
// `equipe_profissional_membro` (papel e vigência; o responsável em vigor é derivado dos membros pela data, e a cópia na
// equipe é recalculada a cada gravação), e a cooperativa médica em
// `cooperativa_medica` (sobre a pessoa jurídica do CNPJ, com dados bancários e alíquotas de retenção) com os cooperados
// em `membro_cooperativa`. O credenciamento por equipe (precos/cobranca-propria) e o favorecido do repasse
// (repasse/favorecidos-propria) leem estas tabelas. A saída de um membro ou cooperado é o fim da vigência: nada é
// apagado. A regra é a do domínio (@sgh/dominio-cadastro, profissional/equipe); aqui só leitura, conferência no banco e
// gravação pelo executor (trilha e idempotência na mesma transação).
import { randomUUID } from 'node:crypto';
import {
  errosCooperado,
  errosCooperativa,
  errosEncerramento,
  errosEquipe,
  errosFimEquipe,
  errosMembroEquipe,
  errosResponsavelSemVinculo,
  normalizarCodigoEquipe,
  responsavelVigenteEm,
  somenteDigitos,
  type VinculoExistente,
  vinculoVigenteEm,
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
import type { RegistroTrilhaTela } from './tipos.js';

export const EQUIPES_COOPERATIVAS = Symbol('EQUIPES_COOPERATIVAS');

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const data = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const hojeLocal = (): string => data(new Date())!;

const MENSAGENS: Record<string, [string, string]> = {
  'codigo-ausente': ['Informe o código da equipe.', 'codigo'],
  'codigo-longo': ['O código tem no máximo 30 caracteres.', 'codigo'],
  'codigo-repetido': ['Já há uma equipe com este código neste estabelecimento.', 'codigo'],
  'nome-curto': ['Escreva o nome com ao menos 3 letras.', 'nome'],
  'nome-longo': ['O nome tem no máximo 150 letras.', 'nome'],
  'tipo-invalido': ['Escolha o tipo da equipe.', 'tipo'],
  'inicio-invalido': ['Informe uma data de início válida.', 'inicio'],
  'fim-invalido': ['Informe uma data de fim válida.', 'fim'],
  'fim-antes-do-inicio': ['O fim vem depois do início.', 'fim'],
  'membros-apos-fim-equipe': ['Encerre antes os membros que ficam depois do novo fim da equipe.', 'fim'],
  'papel-invalido': ['Escolha o papel do profissional na equipe.', 'papel'],
  'fora-da-vigencia-equipe': ['A vigência do membro tem de caber na vigência da equipe.', 'inicio'],
  'vigencia-sobreposta': ['O profissional já está vinculado num período que se sobrepõe a este.', 'inicio'],
  'responsavel-duplicado': ['A equipe já tem outro responsável neste período.', 'papel'],
  'responsavel-sem-vinculo': [
    'A equipe tem um responsável sem período registrado: inclua-o como membro responsável e encerre o período dele antes.',
    'papel',
  ],
  'encerramento-nao-antecipa': ['O vínculo já termina antes desta data.', 'fim'],
  'profissional-inexistente': ['Profissional não encontrado ou inativo.', 'profissional'],
  'setor-inexistente': ['Setor não encontrado neste estabelecimento.', 'setor'],
  'cnpj-invalido': ['CNPJ inválido: confira os dígitos.', 'cnpj'],
  'razao-curta': ['Escreva a razão social com ao menos 3 letras.', 'razaoSocial'],
  'razao-longa': ['A razão social tem no máximo 250 letras.', 'razaoSocial'],
  'percentual-invalido': ['Percentuais e alíquotas vão de 0 a 100.', 'percentual'],
  'conta-incompleta': ['Informe banco, agência e conta juntos, ou nenhum deles.', 'conta'],
  'tipo-conta-invalido': ['Escolha o tipo da conta.', 'tipoConta'],
  'ir-sem-retencao': ['Alíquota de IR informada, mas a cooperativa não retém IR.', 'aliquotaIr'],
  'banco-inexistente': ['Banco não encontrado.', 'banco'],
  'cooperativa-repetida': ['Já há uma cooperativa com este CNPJ.', 'cnpj'],
};
function recusarErros(erros: readonly string[]): void {
  if (!erros.length) return;
  throw recusa(erros[0]!, erros.map((e) => MENSAGENS[e]?.[0] ?? e).join(' '), {
    campos: [...new Set(erros.map((e) => MENSAGENS[e]?.[1] ?? e))],
  });
}
const naoAchado = (o: string) =>
  new ErroOperacao(
    404,
    `${o}-inexistente`,
    'Não encontrado',
    'Registro não encontrado neste estabelecimento.',
  );

const idPos = z.number().int().positive();
const dataTxt = z.string().max(10);

// ---------------------------------------------------------------- equipe
const esquemaEquipe = z
  .object({
    id: idPos.nullable(),
    versao: idPos.nullable(),
    codigo: z.string().max(60),
    nome: z.string().max(400),
    tipo: z.string().max(30),
    setorId: idPos.nullable(),
    inicio: dataTxt,
    fim: dataTxt.nullable(),
    ativo: z.boolean(),
  })
  .strict();
export type EntradaEquipeTela = z.infer<typeof esquemaEquipe>;

async function lerEquipe(tx: TxOperacao, id: number, est: number) {
  const [x] = await tx.consultarParaAtualizar(
    `SELECT id, versao, vigencia_inicio, vigencia_fim, responsavel_profissional_id FROM equipe_profissional
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  if (!x) throw naoAchado('equipe');
  return {
    id,
    versao: Number(x['versao']),
    inicio: data(x['vigencia_inicio'])!,
    fim: data(x['vigencia_fim']),
    responsavel: num(x['responsavel_profissional_id']),
  };
}

async function membrosDaEquipe(tx: TxOperacao, equipe: number): Promise<VinculoExistente[]> {
  const ls = await tx.consultarParaAtualizar(
    `SELECT id, profissional_id, papel, vigencia_inicio, vigencia_fim FROM equipe_profissional_membro
      WHERE equipe_profissional_id = ? AND excluido_em IS NULL`,
    [equipe],
  );
  return ls.map((l) => ({
    id: Number(l['id']),
    profissionalId: Number(l['profissional_id']),
    papel: String(l['papel']),
    inicio: data(l['vigencia_inicio'])!,
    fim: data(l['vigencia_fim']),
  }));
}

/**
 * Recalcula a cópia do responsável em vigor hoje na equipe a partir dos membros (regra do domínio) e grava só se mudou.
 * A leitura deriva o responsável pela data; a cópia acompanha cada gravação dos membros.
 */
async function recalcularResponsavel(
  tx: TxOperacao,
  eq: { id: number; versao: number; responsavel: number | null },
  hoje: string,
): Promise<void> {
  const membros = await membrosDaEquipe(tx, eq.id);
  const vigente = responsavelVigenteEm(membros, hoje, eq.responsavel);
  if (vigente !== eq.responsavel)
    await tx.alterar('equipe_profissional', eq.id, eq.versao, { responsavel_profissional_id: vigente });
}

async function conferirProfissional(tx: TxOperacao, id: number): Promise<void> {
  const p = await tx.uma(
    "SELECT id FROM profissional WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
    [id],
  );
  if (!p) recusarErros(['profissional-inexistente']);
}

const opSalvarEquipe = (t: RegistroTrilhaTela, est: number) =>
  definirOperacao({
    nome: 'cadastro.equipe-profissional.salvar',
    tabelas: ['equipe_profissional'],
    entrada: esquemaEquipe,
    async gravar(tx, e) {
      const vig = { inicio: e.inicio, fim: e.fim };
      recusarErros(errosEquipe({ codigo: e.codigo, nome: e.nome, tipo: e.tipo, vigencia: vig }));
      const codigo = normalizarCodigoEquipe(e.codigo);
      if (
        e.setorId !== null &&
        !(await tx.uma('SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ?', [
          e.setorId,
          est,
        ]))
      )
        recusarErros(['setor-inexistente']);
      const dup = await tx.uma<{ id: unknown }>(
        'SELECT id FROM equipe_profissional WHERE estabelecimento_id = ? AND codigo = ?',
        [est, codigo],
      );
      if (dup && Number(dup.id) !== e.id) recusarErros(['codigo-repetido']);
      const valores = {
        codigo,
        nome: e.nome.trim().replace(/\s+/g, ' '),
        tipo: e.tipo,
        setor_funcional_id: e.setorId,
        vigencia_inicio: e.inicio,
        vigencia_fim: e.fim,
        ativo: e.ativo,
      };
      if (e.id === null) {
        const id = await tx.incluir('equipe_profissional', {
          ...valores,
          estabelecimento_id: est,
          origem: 'sistema',
        });
        return { id };
      }
      const atual = await lerEquipe(tx, e.id, est);
      const membros = await membrosDaEquipe(tx, e.id);
      recusarErros(errosFimEquipe(vig, membros));
      if (membros.some((m) => m.inicio < e.inicio)) recusarErros(['fora-da-vigencia-equipe']);
      await tx.alterar('equipe_profissional', e.id, e.versao ?? atual.versao, valores);
      return { id: e.id };
    },
    alvo: (_e, r) => ({ tabela: 'equipe_profissional', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaMembro = z
  .object({
    equipeId: idPos,
    profissionalId: idPos,
    papel: z.string().max(30),
    inicio: dataTxt,
    fim: dataTxt.nullable(),
  })
  .strict();
export type EntradaMembroTela = z.infer<typeof esquemaMembro>;

const opIncluirMembro = (t: RegistroTrilhaTela, est: number, hoje: string) =>
  definirOperacao({
    nome: 'cadastro.equipe-profissional.incluir-membro',
    tabelas: ['equipe_profissional_membro', 'equipe_profissional'],
    entrada: esquemaMembro,
    acao: 'inclusao',
    async gravar(tx, e) {
      const eq = await lerEquipe(tx, e.equipeId, est);
      await conferirProfissional(tx, e.profissionalId);
      const existentes = await membrosDaEquipe(tx, e.equipeId);
      const vigencia = { inicio: e.inicio, fim: e.fim };
      const entrada = { profissionalId: e.profissionalId, papel: e.papel, vigencia };
      recusarErros(errosMembroEquipe(entrada, eq, existentes));
      recusarErros(errosResponsavelSemVinculo(entrada, existentes, eq.responsavel));
      const id = await tx.incluir('equipe_profissional_membro', {
        equipe_profissional_id: e.equipeId,
        profissional_id: e.profissionalId,
        papel: e.papel,
        ordem: existentes.length + 1,
        vigencia_inicio: e.inicio,
        vigencia_fim: e.fim,
      });
      await recalcularResponsavel(tx, eq, hoje);
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'equipe_profissional_membro', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaEncerrar = z.object({ id: idPos, versao: idPos, fim: dataTxt }).strict();
export type EntradaEncerrar = z.infer<typeof esquemaEncerrar>;

const opEncerrarMembro = (t: RegistroTrilhaTela, est: number, hoje: string) =>
  definirOperacao({
    nome: 'cadastro.equipe-profissional.encerrar-membro',
    tabelas: ['equipe_profissional_membro', 'equipe_profissional'],
    entrada: esquemaEncerrar,
    acao: 'alteracao',
    async gravar(tx, e) {
      const [m] = await tx.consultarParaAtualizar(
        `SELECT m.equipe_profissional_id, m.profissional_id, m.papel, m.vigencia_inicio, m.vigencia_fim,
                q.responsavel_profissional_id, q.versao AS versao_equipe
           FROM equipe_profissional_membro m JOIN equipe_profissional q ON q.id = m.equipe_profissional_id
          WHERE m.id = ? AND q.estabelecimento_id = ? AND m.excluido_em IS NULL`,
        [e.id, est],
      );
      if (!m) throw naoAchado('membro');
      recusarErros(
        errosEncerramento({ inicio: data(m['vigencia_inicio'])!, fim: data(m['vigencia_fim']) }, e.fim),
      );
      await tx.alterar('equipe_profissional_membro', e.id, e.versao, { vigencia_fim: e.fim });
      // Responsável que sai: a cópia na equipe acompanha os membros em vigor hoje (o fim futuro mantém até lá).
      await recalcularResponsavel(
        tx,
        {
          id: Number(m['equipe_profissional_id']),
          versao: Number(m['versao_equipe']),
          responsavel: num(m['responsavel_profissional_id']),
        },
        hoje,
      );
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'equipe_profissional_membro', id: e.id }),
    trilha: (e) => ({ dados: { ...(t.dadosDepois ?? {}), fim: e.fim }, motivo: null }),
  });

// ---------------------------------------------------------------- cooperativa
const pct = z.number().min(-1000).max(1000).nullable();
const esquemaCooperativa = z
  .object({
    id: idPos.nullable(),
    versao: idPos.nullable(),
    cnpj: z.string().max(20),
    razaoSocial: z.string().max(400),
    nome: z.string().max(400),
    percentualRepasse: pct,
    bancoId: idPos.nullable(),
    agencia: z.string().max(10).nullable(),
    agenciaDigito: z.string().max(2).nullable(),
    conta: z.string().max(20).nullable(),
    contaDigito: z.string().max(2).nullable(),
    tipoConta: z.string().max(30).nullable(),
    retemIr: z.boolean(),
    aliquotaIr: pct,
    aliquotaIss: pct,
    aliquotaPis: pct,
    aliquotaCofins: pct,
    aliquotaCsll: pct,
    optanteSimples: z.boolean(),
    ativo: z.boolean(),
  })
  .strict();
export type EntradaCooperativaTela = z.infer<typeof esquemaCooperativa>;

const opSalvarCooperativa = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.cooperativa-medica.salvar',
    tabelas: ['cooperativa_medica', 'pessoa_juridica'],
    entrada: esquemaCooperativa,
    async gravar(tx, e) {
      const aliquotas = {
        ir: e.aliquotaIr,
        iss: e.aliquotaIss,
        pis: e.aliquotaPis,
        cofins: e.aliquotaCofins,
        csll: e.aliquotaCsll,
      };
      recusarErros(
        errosCooperativa({
          cnpj: e.cnpj,
          razaoSocial: e.razaoSocial,
          nome: e.nome,
          percentualRepasse: e.percentualRepasse,
          bancoId: e.bancoId,
          agencia: e.agencia,
          conta: e.conta,
          tipoConta: e.tipoConta,
          retemIr: e.retemIr,
          aliquotas,
        }),
      );
      if (e.bancoId !== null && !(await tx.uma('SELECT id FROM banco WHERE id = ?', [e.bancoId])))
        recusarErros(['banco-inexistente']);
      const cnpj = somenteDigitos(e.cnpj);
      // A pessoa jurídica é única por CNPJ: reaproveita a que já existe (mantenedora, fonte pagadora, empresa).
      // A razão social digitada vale para a pessoa jurídica (a mesma empresa): gravada com versão e trilha quando muda.
      const razao = e.razaoSocial.trim().replace(/\s+/g, ' ');
      const [pj] = await tx.consultarParaAtualizar(
        'SELECT id, versao, razao_social FROM pessoa_juridica WHERE cnpj = ?',
        [cnpj],
      );
      const pessoa = pj
        ? Number(pj['id'])
        : await tx.incluir('pessoa_juridica', {
            cnpj,
            estrangeira: false,
            razao_social: razao,
            origem: 'sistema',
          });
      const dup = await tx.uma<{ id: unknown }>(
        'SELECT id FROM cooperativa_medica WHERE pessoa_juridica_id = ?',
        [pessoa],
      );
      if (dup && Number(dup.id) !== e.id) recusarErros(['cooperativa-repetida']);
      if (pj && String(pj['razao_social']) !== razao)
        await tx.alterar('pessoa_juridica', pessoa, Number(pj['versao']), { razao_social: razao });
      const valores = {
        pessoa_juridica_id: pessoa,
        nome: e.nome.trim().replace(/\s+/g, ' '),
        percentual_repasse: e.percentualRepasse,
        banco_id: e.bancoId,
        agencia: e.agencia?.trim() || null,
        agencia_digito: e.agenciaDigito?.trim() || null,
        conta: e.conta?.trim() || null,
        conta_digito: e.contaDigito?.trim() || null,
        tipo_conta_bancaria: e.tipoConta,
        retem_ir: e.retemIr,
        aliquota_ir: e.aliquotaIr,
        aliquota_iss: e.aliquotaIss,
        aliquota_pis: e.aliquotaPis,
        aliquota_cofins: e.aliquotaCofins,
        aliquota_csll: e.aliquotaCsll,
        optante_simples: e.optanteSimples,
        ativo: e.ativo,
      };
      if (e.id === null)
        return { id: await tx.incluir('cooperativa_medica', { ...valores, origem: 'sistema' }) };
      const [x] = await tx.consultarParaAtualizar(
        'SELECT versao FROM cooperativa_medica WHERE id = ? AND excluido_em IS NULL',
        [e.id],
      );
      if (!x) throw naoAchado('cooperativa');
      await tx.alterar('cooperativa_medica', e.id, e.versao ?? Number(x['versao']), valores);
      return { id: e.id };
    },
    alvo: (_e, r) => ({ tabela: 'cooperativa_medica', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaCooperado = z
  .object({ cooperativaId: idPos, profissionalId: idPos, inicio: dataTxt, fim: dataTxt.nullable() })
  .strict();
export type EntradaCooperadoTela = z.infer<typeof esquemaCooperado>;

const opIncluirCooperado = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.cooperativa-medica.incluir-cooperado',
    tabelas: ['membro_cooperativa'],
    entrada: esquemaCooperado,
    acao: 'inclusao',
    async gravar(tx, e) {
      const [c] = await tx.consultarParaAtualizar(
        'SELECT id FROM cooperativa_medica WHERE id = ? AND excluido_em IS NULL',
        [e.cooperativaId],
      );
      if (!c) throw naoAchado('cooperativa');
      await conferirProfissional(tx, e.profissionalId);
      const ls = await tx.consultar(
        `SELECT id, profissional_id, vigencia_inicio, vigencia_fim FROM membro_cooperativa
          WHERE cooperativa_medica_id = ? AND profissional_id = ? AND excluido_em IS NULL`,
        [e.cooperativaId, e.profissionalId],
      );
      const existentes = ls.map((l) => ({
        id: Number(l['id']),
        profissionalId: Number(l['profissional_id']),
        inicio: data(l['vigencia_inicio'])!,
        fim: data(l['vigencia_fim']),
      }));
      recusarErros(
        errosCooperado(
          { profissionalId: e.profissionalId, vigencia: { inicio: e.inicio, fim: e.fim } },
          existentes,
        ),
      );
      const id = await tx.incluir('membro_cooperativa', {
        cooperativa_medica_id: e.cooperativaId,
        profissional_id: e.profissionalId,
        vigencia_inicio: e.inicio,
        vigencia_fim: e.fim,
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'membro_cooperativa', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const opEncerrarCooperado = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.cooperativa-medica.encerrar-cooperado',
    tabelas: ['membro_cooperativa'],
    entrada: esquemaEncerrar,
    acao: 'alteracao',
    async gravar(tx, e) {
      const [m] = await tx.consultarParaAtualizar(
        'SELECT vigencia_inicio, vigencia_fim FROM membro_cooperativa WHERE id = ? AND excluido_em IS NULL',
        [e.id],
      );
      if (!m) throw naoAchado('cooperado');
      recusarErros(
        errosEncerramento({ inicio: data(m['vigencia_inicio'])!, fim: data(m['vigencia_fim']) }, e.fim),
      );
      await tx.alterar('membro_cooperativa', e.id, e.versao, { vigencia_fim: e.fim });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'membro_cooperativa', id: e.id }),
    trilha: (e) => ({ dados: { ...(t.dadosDepois ?? {}), fim: e.fim }, motivo: null }),
  });

// ---------------------------------------------------------------- leitura
export interface VinculoVisao {
  id: number;
  versao: number;
  profissionalId: number;
  profissionalNome: string;
  papel: string | null;
  inicio: string;
  fim: string | null;
  vigente: boolean;
}
export interface EquipeVisao {
  id: number;
  versao: number;
  codigo: string;
  nome: string;
  tipo: string;
  setorId: number | null;
  setorNome: string | null;
  responsavelId: number | null;
  inicio: string;
  fim: string | null;
  ativo: boolean;
  membros: VinculoVisao[];
}
export interface CooperativaVisao {
  id: number;
  versao: number;
  cnpj: string;
  razaoSocial: string;
  nome: string;
  percentualRepasse: number | null;
  bancoId: number | null;
  agencia: string | null;
  agenciaDigito: string | null;
  conta: string | null;
  contaDigito: string | null;
  tipoConta: string | null;
  retemIr: boolean;
  aliquotaIr: number | null;
  aliquotaIss: number | null;
  aliquotaPis: number | null;
  aliquotaCofins: number | null;
  aliquotaCsll: number | null;
  optanteSimples: boolean;
  ativo: boolean;
  cooperados: VinculoVisao[];
}
export interface VisaoEquipesCooperativas {
  hoje: string;
  /** Visão por profissional: só as equipes e cooperativas dele (com todos os vínculos). */
  profissional: { id: number; nome: string } | null;
  equipes: EquipeVisao[];
  cooperativas: CooperativaVisao[];
  setores: { id: number; nome: string }[];
  bancos: { id: number; nome: string }[];
}

export class EquipesCooperativasPropria {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCadastro,
    private readonly cliente: string,
    executor?: Executor,
    private readonly hoje: () => string = hojeLocal,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'equipes' }, fn);
  }

  private async estabelecimento(c: ContextoPorta): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const r = c.hospital
      ? await this.ler(c, (l) =>
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
      correlacao: (t.correlacao ?? c.correlacao).slice(0, 64) || 'equipes',
      chaveIdempotencia: `direta:${randomUUID()}`,
    };
    const x = await this.executor.executar(op, this.cliente, entrada, ctx);
    return Number((x.resultado as Record<string, unknown>)['id']);
  }

  /** Equipes do estabelecimento e cooperativas, com os vínculos; com `profissional`, só as dele. */
  async visao(c: ContextoPorta, profissional: number | null): Promise<VisaoEquipesCooperativas> {
    const est = await this.estabelecimento(c);
    const hoje = this.hoje();
    return this.ler(c, async (l) => {
      let prof: { id: number; nome: string } | null = null;
      if (profissional !== null) {
        const p = await l.uma(
          `SELECT pr.id, pf.nome FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
            WHERE pr.id = ? AND pr.excluido_em IS NULL`,
          [profissional],
        );
        if (!p) throw naoAchado('profissional');
        prof = { id: Number(p['id']), nome: String(p['nome']) };
      }
      const vinculo = (x: Record<string, unknown>, papel: boolean): VinculoVisao => {
        const v = { inicio: data(x['vigencia_inicio'])!, fim: data(x['vigencia_fim']) };
        return {
          id: Number(x['id']),
          versao: Number(x['versao']),
          profissionalId: Number(x['profissional_id']),
          profissionalNome: String(x['nome']),
          papel: papel ? String(x['papel']) : null,
          ...v,
          vigente: vinculoVigenteEm(v, hoje),
        };
      };
      const eqs = await l.consultar(
        `SELECT q.id, q.versao, q.codigo, q.nome, q.tipo, q.setor_funcional_id, s.nome AS setor_nome,
                q.responsavel_profissional_id, q.vigencia_inicio, q.vigencia_fim, q.ativo
           FROM equipe_profissional q LEFT JOIN setor_funcional s ON s.id = q.setor_funcional_id
          WHERE q.estabelecimento_id = ? AND q.excluido_em IS NULL
            AND (? IS NULL OR EXISTS (SELECT 1 FROM equipe_profissional_membro x
                  WHERE x.equipe_profissional_id = q.id AND x.profissional_id = ? AND x.excluido_em IS NULL))
          ORDER BY q.ativo DESC, q.nome LIMIT 500`,
        [est, profissional, profissional],
      );
      const marcasEq = eqs.map(() => '?').join(',');
      const membros = eqs.length
        ? await l.consultar(
            `SELECT m.id, m.versao, m.equipe_profissional_id, m.profissional_id, m.papel, m.vigencia_inicio,
                    m.vigencia_fim, pf.nome
               FROM equipe_profissional_membro m
               JOIN profissional pr ON pr.id = m.profissional_id JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
              WHERE m.equipe_profissional_id IN (${marcasEq}) AND m.excluido_em IS NULL
              ORDER BY m.vigencia_fim IS NOT NULL, m.ordem, m.id`,
            eqs.map((q) => q['id']),
          )
        : [];
      const vinculos = new Map(membros.map((x) => [Number(x['id']), vinculo(x, true)]));
      const membrosDe = (equipeId: unknown): VinculoExistente[] =>
        membros
          .filter((x) => Number(x['equipe_profissional_id']) === Number(equipeId))
          .map((x) => {
            const v = vinculos.get(Number(x['id']))!;
            return {
              id: v.id,
              profissionalId: v.profissionalId,
              papel: v.papel ?? '',
              inicio: v.inicio,
              fim: v.fim,
            };
          });
      const coops = await l.consultar(
        `SELECT c.id, c.versao, pj.cnpj, pj.razao_social, c.nome, c.percentual_repasse, c.banco_id, c.agencia,
                c.agencia_digito, c.conta, c.conta_digito, c.tipo_conta_bancaria, c.retem_ir, c.aliquota_ir,
                c.aliquota_iss, c.aliquota_pis, c.aliquota_cofins, c.aliquota_csll, c.optante_simples, c.ativo
           FROM cooperativa_medica c JOIN pessoa_juridica pj ON pj.id = c.pessoa_juridica_id
          WHERE c.excluido_em IS NULL
            AND (? IS NULL OR EXISTS (SELECT 1 FROM membro_cooperativa x
                  WHERE x.cooperativa_medica_id = c.id AND x.profissional_id = ? AND x.excluido_em IS NULL))
          ORDER BY c.ativo DESC, c.nome LIMIT 500`,
        [profissional, profissional],
      );
      const marcasCoop = coops.map(() => '?').join(',');
      const cooperados = coops.length
        ? await l.consultar(
            `SELECT m.id, m.versao, m.cooperativa_medica_id, m.profissional_id, m.vigencia_inicio, m.vigencia_fim,
                    pf.nome
               FROM membro_cooperativa m
               JOIN profissional pr ON pr.id = m.profissional_id JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
              WHERE m.cooperativa_medica_id IN (${marcasCoop}) AND m.excluido_em IS NULL
              ORDER BY m.vigencia_fim IS NOT NULL, pf.nome`,
            coops.map((x) => x['id']),
          )
        : [];
      const setores = await l.consultar(
        'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome LIMIT 500',
        [est],
      );
      const bancos = await l.consultar(
        `SELECT id, COALESCE(nome_curto, descricao) AS nome, codigo_compensacao FROM banco
          WHERE vigencia_fim IS NULL OR vigencia_fim >= ? ORDER BY codigo_compensacao IS NULL, codigo_compensacao LIMIT 600`,
        [hoje],
      );
      return {
        hoje,
        profissional: prof,
        equipes: eqs.map((q) => ({
          id: Number(q['id']),
          versao: Number(q['versao']),
          codigo: String(q['codigo']),
          nome: String(q['nome']),
          tipo: String(q['tipo']),
          setorId: num(q['setor_funcional_id']),
          setorNome: txt(q['setor_nome']),
          // Derivado dos membros pela data de hoje (o de início futuro passa a valer quando a data chega).
          responsavelId: responsavelVigenteEm(
            membrosDe(q['id']),
            hoje,
            num(q['responsavel_profissional_id']),
          ),
          inicio: data(q['vigencia_inicio'])!,
          fim: data(q['vigencia_fim']),
          ativo: bool(q['ativo']),
          membros: membrosDe(q['id']).map((m) => vinculos.get(m.id)!),
        })),
        cooperativas: coops.map((x) => ({
          id: Number(x['id']),
          versao: Number(x['versao']),
          cnpj: String(x['cnpj'] ?? ''),
          razaoSocial: String(x['razao_social']),
          nome: String(x['nome']),
          percentualRepasse: num(x['percentual_repasse']),
          bancoId: num(x['banco_id']),
          agencia: txt(x['agencia']),
          agenciaDigito: txt(x['agencia_digito']),
          conta: txt(x['conta']),
          contaDigito: txt(x['conta_digito']),
          tipoConta: txt(x['tipo_conta_bancaria']),
          retemIr: bool(x['retem_ir']),
          aliquotaIr: num(x['aliquota_ir']),
          aliquotaIss: num(x['aliquota_iss']),
          aliquotaPis: num(x['aliquota_pis']),
          aliquotaCofins: num(x['aliquota_cofins']),
          aliquotaCsll: num(x['aliquota_csll']),
          optanteSimples: bool(x['optante_simples']),
          ativo: bool(x['ativo']),
          cooperados: cooperados
            .filter((m) => Number(m['cooperativa_medica_id']) === Number(x['id']))
            .map((m) => vinculo(m, false)),
        })),
        setores: setores.map((s) => ({ id: Number(s['id']), nome: String(s['nome']) })),
        bancos: bancos.map((b) => ({
          id: Number(b['id']),
          nome: `${txt(b['codigo_compensacao']) ?? '---'} ${String(b['nome'])}`,
        })),
      };
    });
  }

  /** Profissionais ativos pelo nome (para escolher o membro ou o cooperado). */
  async buscarProfissionais(c: ContextoPorta, termo: string): Promise<{ id: number; nome: string }[]> {
    const t = termo.trim().replace(/[%_]/g, '');
    if (t.length < 3) return [];
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT pr.id, pf.nome FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
            WHERE pr.situacao = 'ativo' AND pr.excluido_em IS NULL AND pf.nome LIKE ? ORDER BY pf.nome LIMIT 20`,
          [`%${t}%`],
        )
      ).map((p) => ({ id: Number(p['id']), nome: String(p['nome']) })),
    );
  }

  async salvarEquipe(c: ContextoPorta, e: EntradaEquipeTela, t: RegistroTrilhaTela): Promise<number> {
    const est = await this.estabelecimento(c);
    return this.executar(c, opSalvarEquipe(t, est), e, t, est);
  }
  async incluirMembro(c: ContextoPorta, e: EntradaMembroTela, t: RegistroTrilhaTela): Promise<number> {
    const est = await this.estabelecimento(c);
    return this.executar(c, opIncluirMembro(t, est, this.hoje()), e, t, est);
  }
  async encerrarMembro(c: ContextoPorta, e: EntradaEncerrar, t: RegistroTrilhaTela): Promise<number> {
    const est = await this.estabelecimento(c);
    return this.executar(c, opEncerrarMembro(t, est, this.hoje()), e, t, est);
  }
  async salvarCooperativa(
    c: ContextoPorta,
    e: EntradaCooperativaTela,
    t: RegistroTrilhaTela,
  ): Promise<number> {
    const est = await this.estabelecimento(c);
    return this.executar(c, opSalvarCooperativa(t), e, t, est);
  }
  async incluirCooperado(c: ContextoPorta, e: EntradaCooperadoTela, t: RegistroTrilhaTela): Promise<number> {
    const est = await this.estabelecimento(c);
    return this.executar(c, opIncluirCooperado(t), e, t, est);
  }
  async encerrarCooperado(c: ContextoPorta, e: EntradaEncerrar, t: RegistroTrilhaTela): Promise<number> {
    const est = await this.estabelecimento(c);
    return this.executar(c, opEncerrarCooperado(t), e, t, est);
  }
}
