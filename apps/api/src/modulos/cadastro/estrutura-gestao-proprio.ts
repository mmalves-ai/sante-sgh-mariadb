// Manutenção da estrutura no banco próprio (F3.1, 02-CAD linhas 26 e 27):
// - estabelecimento da sessão: razão social, documentos (CNPJ com dígito conferido, CNES), tipo, porte, esfera,
//   endereço e contato, com versão (conflito 409) e trilha;
// - unidades assistenciais: incluir, alterar, inativar e reativar (nunca apagar);
// - setores: incluir e alterar numa tela só, com tipo, superior (sem ciclo na árvore), unidade, centro de custo,
//   responsável com vigência, regras de agendamento e de lançamento na conta, e os ramais do setor gravados na mesma
//   transação (o ramal retirado fica com a exclusão lógica; o principal é espelhado em `ramal_principal`);
//   inativar com data só sem filhos ativos, e reativar.
// A regra é a do domínio (@sgh/dominio-organizacao); aqui só leitura, conferência no banco e gravação pelo executor
// (trilha e idempotência na mesma transação).
import { randomUUID } from 'node:crypto';
import {
  errosEstabelecimento,
  errosInativarSetor,
  errosRamais,
  errosSetor,
  errosUnidade,
  formaCiclo,
  ramalPrincipal,
} from '@sgh/dominio-organizacao';
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

export const ESTRUTURA_GESTAO = Symbol('ESTRUTURA_GESTAO');

const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const data = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1';
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const idPos = z.number().int().positive();
const txt = (max: number) => z.string().trim().max(max).nullable();

const MENSAGENS: Record<string, [string, string]> = {
  'razao-social-vazia': ['Informe a razão social.', 'razaoSocial'],
  'nome-fantasia-vazio': ['Informe o nome fantasia.', 'nomeFantasia'],
  'cnpj-invalido': ['O CNPJ não confere (14 dígitos com os verificadores).', 'cnpj'],
  'cnes-invalido': ['O CNES tem 7 dígitos.', 'cnes'],
  'cep-invalido': ['O CEP tem 8 dígitos.', 'cep'],
  'email-invalido': ['E-mail inválido.', 'email'],
  'atividade-invertida': ['O fim da atividade é anterior ao início.', 'fimAtividade'],
  'codigo-invalido': ['O código tem até 30 letras, dígitos, ponto, hífen ou sublinhado, sem espaço.', 'codigo'],
  'nome-vazio': ['Informe o nome.', 'nome'],
  'tipo-unidade-invalido': ['Tipo de unidade inválido.', 'tipo'],
  'tipo-setor-invalido': ['Tipo de setor inválido.', 'tipo'],
  'sigla-longa': ['A sigla tem até 10 letras.', 'sigla'],
  'lancamento-sem-centro-custo': [
    'Setor que lança na conta ou tem produção faturada precisa de centro de custo.',
    'centroCusto',
  ],
  'responsavel-sem-inicio': ['Informe o início da responsabilidade.', 'responsavelInicio'],
  'vigencia-sem-responsavel': ['Vigência informada sem responsável.', 'responsavel'],
  'responsavel-vigencia-invertida': ['O fim da responsabilidade é anterior ao início.', 'responsavelFim'],
  'agendamento-sem-sigla': ['A regra de agendamento precisa da sigla de agendamento.', 'siglaAgendamento'],
  'logistico-solicita-exame': ['Setor logístico não solicita exames.', 'podeSolicitarExames'],
  'setor-com-filhos-ativos': ['Inative antes os setores subordinados a este.', 'situacao'],
  'inativacao-antes-da-criacao': ['A inativação não pode ser anterior à criação do setor.', 'data'],
  'ramal-invalido': ['O ramal tem de 2 a 10 dígitos.', 'ramais'],
  'ramal-repetido': ['Ramal repetido no setor.', 'ramais'],
  'telefone-invalido': ['O telefone externo tem DDD e 8 ou 9 dígitos.', 'ramais'],
  'contato-longo': ['O contato tem até 60 letras.', 'ramais'],
  'mais-de-um-principal': ['Marque um só ramal principal.', 'ramais'],
  'mais-de-um-responsavel': ['Marque um só ramal do responsável.', 'ramais'],
};
function recusarErros(erros: readonly string[]): void {
  if (!erros.length) return;
  throw recusa(erros[0]!, erros.map((e) => MENSAGENS[e]?.[0] ?? e).join(' '), {
    campos: [...new Set(erros.map((e) => MENSAGENS[e]?.[1] ?? e))],
  });
}
const naoAchado = (o: string) =>
  new ErroOperacao(404, `${o.toLowerCase()}-inexistente`, 'Não encontrado', `${o} não encontrado.`);
const recusaCampo = (codigo: string, msg: string, campo: string) => recusa(codigo, msg, { campos: [campo] });

/** Confere que o id existe na tabela de apoio (e no estabelecimento, quando a tabela é dele). */
async function existe(
  tx: TxOperacao,
  tabela: string,
  id: number | null,
  campo: string,
  est: number | null = null,
): Promise<void> {
  if (id === null) return;
  const r = await tx.uma(
    `SELECT id FROM ${tabela} WHERE id = ?${est !== null ? ' AND estabelecimento_id = ?' : ''}`,
    est !== null ? [id, est] : [id],
  );
  if (!r) throw recusaCampo(`${campo}-inexistente`, 'Item escolhido não encontrado.', campo);
}

// ── Estabelecimento ──

const esquemaEstabelecimento = z
  .object({
    estabelecimento: idPos,
    versao: idPos,
    razaoSocial: z.string().trim().min(1).max(150),
    nomeFantasia: z.string().trim().min(1).max(150),
    cnpj: z.string().regex(/^\d{14}$/).nullable(),
    inscricaoEstadual: txt(20),
    inscricaoMunicipal: txt(20),
    cnes: z.string().regex(/^\d{7}$/).nullable(),
    tipo: idPos.nullable(),
    porte: idPos.nullable(),
    esfera: idPos.nullable(),
    hospitalDia: z.boolean(),
    cep: z.string().regex(/^\d{8}$/).nullable(),
    logradouro: txt(150),
    numero: txt(10),
    complemento: txt(100),
    bairro: txt(100),
    telefone: txt(20),
    email: txt(254),
    site: txt(254),
    inicioAtividade: dia.nullable(),
    fimAtividade: dia.nullable(),
  })
  .strict();
export type EntradaEstabelecimento = z.infer<typeof esquemaEstabelecimento>;

const opAlterarEstabelecimento = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.estabelecimento.alterar',
    tabelas: ['estabelecimento'],
    entrada: esquemaEstabelecimento,
    acao: 'alteracao',
    async gravar(tx, e, ctx) {
      if (e.estabelecimento !== ctx.estabelecimento)
        throw new ErroOperacao(403, 'outro-estabelecimento', 'Proibido', 'Só o estabelecimento da sessão.');
      recusarErros(errosEstabelecimento(e));
      await existe(tx, 'tipo_estabelecimento', e.tipo, 'tipo');
      await existe(tx, 'porte_estabelecimento', e.porte, 'porte');
      await existe(tx, 'esfera_administrativa', e.esfera, 'esfera');
      if (e.cnpj) {
        const outro = await tx.uma('SELECT id FROM estabelecimento WHERE cnpj = ? AND id <> ?', [
          e.cnpj,
          e.estabelecimento,
        ]);
        if (outro) throw recusaCampo('cnpj-repetido', 'Outro estabelecimento já usa este CNPJ.', 'cnpj');
      }
      if (e.cnes) {
        const outro = await tx.uma('SELECT id FROM estabelecimento WHERE codigo_cnes = ? AND id <> ?', [
          e.cnes,
          e.estabelecimento,
        ]);
        if (outro) throw recusaCampo('cnes-repetido', 'Outro estabelecimento já usa este CNES.', 'cnes');
      }
      await tx.alterar('estabelecimento', e.estabelecimento, e.versao, {
        razao_social: e.razaoSocial,
        nome_fantasia: e.nomeFantasia,
        cnpj: e.cnpj,
        inscricao_estadual: e.inscricaoEstadual,
        inscricao_municipal: e.inscricaoMunicipal,
        codigo_cnes: e.cnes,
        tipo_estabelecimento_id: e.tipo,
        porte_estabelecimento_id: e.porte,
        esfera_administrativa_id: e.esfera,
        hospital_dia: e.hospitalDia,
        cep: e.cep,
        logradouro: e.logradouro,
        numero: e.numero,
        complemento: e.complemento,
        bairro_nome: e.bairro,
        telefone: e.telefone,
        email: e.email,
        site: e.site,
        inicio_atividade: e.inicioAtividade,
        fim_atividade: e.fimAtividade,
      });
      return { id: e.estabelecimento };
    },
    alvo: (e) => ({ tabela: 'estabelecimento', id: e.estabelecimento }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

// ── Unidade assistencial ──

const esquemaUnidade = z
  .object({
    id: idPos.nullable(),
    versao: idPos.nullable(),
    codigo: z.string().trim().min(1).max(30),
    nome: z.string().trim().min(1).max(150),
    nomeCompleto: txt(150),
    sigla: txt(10),
    tipo: z.string().max(30),
    cnes: z.string().nullable(),
    cnpj: z.string().nullable(),
    cep: z.string().nullable(),
    logradouro: txt(150),
    numero: txt(10),
    complemento: txt(60),
    bairro: txt(100),
    telefone: txt(20),
    orientacaoAcesso: z.string().max(2000).nullable(),
  })
  .strict();
export type EntradaUnidade = z.infer<typeof esquemaUnidade>;

const opGravarUnidade = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.unidade.gravar',
    tabelas: ['unidade_assistencial'],
    entrada: esquemaUnidade,
    async gravar(tx, e, ctx) {
      recusarErros(errosUnidade(e));
      const repetida = await tx.uma(
        `SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND (codigo = ? OR nome = ?)
            AND id <> ? AND excluido_em IS NULL`,
        [ctx.estabelecimento, e.codigo, e.nome, e.id ?? 0],
      );
      if (repetida) throw recusaCampo('unidade-repetida', 'Já existe unidade com este código ou nome.', 'codigo');
      const valores = {
        codigo: e.codigo,
        nome: e.nome,
        nome_completo: e.nomeCompleto,
        sigla: e.sigla,
        tipo_unidade: e.tipo,
        codigo_cnes: e.cnes,
        cnpj: e.cnpj,
        cep: e.cep,
        logradouro: e.logradouro,
        numero_endereco: e.numero,
        complemento: e.complemento,
        bairro: e.bairro,
        telefone: e.telefone,
        orientacao_acesso: e.orientacaoAcesso,
      };
      if (e.id === null)
        return {
          id: await tx.incluir('unidade_assistencial', {
            estabelecimento_id: ctx.estabelecimento,
            ativo: true,
            ...valores,
          }),
        };
      const x = await tx.uma(
        'SELECT id FROM unidade_assistencial WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.id, ctx.estabelecimento],
      );
      if (!x) throw naoAchado('Unidade');
      await tx.alterar('unidade_assistencial', e.id, e.versao ?? 0, valores);
      return { id: e.id };
    },
    alvo: (_e, r) => ({ tabela: 'unidade_assistencial', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaSituacao = z
  .object({ id: idPos, versao: idPos, ativo: z.boolean(), data: dia.nullable(), motivo: z.string().trim().max(200) })
  .strict();
export type EntradaSituacao = z.infer<typeof esquemaSituacao>;

const opSituacaoUnidade = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.unidade.situacao',
    tabelas: ['unidade_assistencial'],
    entrada: esquemaSituacao,
    acao: 'alteracao',
    async gravar(tx, e, ctx) {
      if (e.motivo.length < 10) throw recusaCampo('motivo-curto', 'Escreva o motivo com ao menos 10 letras.', 'motivo');
      const x = await tx.uma(
        `SELECT id, ativo FROM unidade_assistencial WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [e.id, ctx.estabelecimento],
      );
      if (!x) throw naoAchado('Unidade');
      if (bool(x['ativo']) === e.ativo)
        throw recusaCampo('situacao-igual', 'A unidade já está nesta situação.', 'situacao');
      if (!e.ativo) {
        const setores = await tx.uma<{ n: unknown }>(
          'SELECT COUNT(*) AS n FROM setor_funcional WHERE unidade_assistencial_id = ? AND ativo AND excluido_em IS NULL',
          [e.id],
        );
        if (Number(setores?.n ?? 0) > 0)
          throw recusaCampo('unidade-com-setores-ativos', 'Inative antes os setores desta unidade.', 'situacao');
      }
      await tx.alterar('unidade_assistencial', e.id, e.versao, { ativo: e.ativo });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'unidade_assistencial', id: e.id }),
    trilha: (e) => ({ dados: t.dadosDepois ?? null, motivo: e.motivo }),
  });

// ── Setor e ramais ──

const esquemaRamal = z
  .object({
    id: idPos.nullable(),
    ramal: z.string().trim().max(10),
    contato: txt(60),
    principal: z.boolean(),
    responsavel: z.boolean(),
    telefoneExterno: z.string().nullable(),
    observacao: txt(200),
  })
  .strict();

const esquemaSetor = z
  .object({
    id: idPos.nullable(),
    versao: idPos.nullable(),
    codigo: z.string().trim().min(1).max(30),
    nome: z.string().trim().min(1).max(150),
    sigla: z.string().trim().nullable(),
    tipo: z.string().max(30),
    superior: idPos.nullable(),
    unidade: idPos.nullable(),
    centroCusto: idPos.nullable(),
    responsavel: idPos.nullable(),
    responsavelInicio: dia.nullable(),
    responsavelFim: dia.nullable(),
    podeSolicitarExames: z.boolean(),
    aceitaLancamentoConta: z.boolean(),
    producaoFaturada: z.boolean(),
    exigeProfissionalAgendamento: z.boolean(),
    exigeRecursoAgendamento: z.boolean(),
    siglaAgendamento: txt(10),
    observacaoAgendamento: txt(200),
    ramais: z.array(esquemaRamal).max(50),
  })
  .strict();
export type EntradaSetor = z.infer<typeof esquemaSetor>;

const opGravarSetor = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.setor.gravar',
    tabelas: ['setor_funcional', 'ramal_setor'],
    entrada: esquemaSetor,
    async gravar(tx, e, ctx) {
      const est = ctx.estabelecimento;
      recusarErros([...errosSetor(e), ...errosRamais(e.ramais)]);
      await existe(tx, 'unidade_assistencial', e.unidade, 'unidade', est);
      await existe(tx, 'centro_custo', e.centroCusto, 'centroCusto', est);
      await existe(tx, 'profissional', e.responsavel, 'responsavel');
      const arvore = await tx.consultar(
        'SELECT id, setor_superior_id FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL FOR UPDATE',
        [est],
      );
      const superiores = new Map(arvore.map((r) => [Number(r['id']), num(r['setor_superior_id'])]));
      if (e.superior !== null && !superiores.has(e.superior))
        throw recusaCampo('superior-inexistente', 'Setor superior não encontrado.', 'superior');
      if (formaCiclo(e.id, e.superior, superiores))
        throw recusaCampo('superior-em-ciclo', 'O setor superior não pode ser o próprio setor nem um subordinado dele.', 'superior');
      const repetido = await tx.uma(
        'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ? AND id <> ?',
        [est, e.codigo, e.id ?? 0],
      );
      if (repetido) throw recusaCampo('codigo-repetido', 'Já existe setor com este código.', 'codigo');
      const valores = {
        codigo: e.codigo,
        nome: e.nome,
        sigla: e.sigla,
        tipo: e.tipo,
        setor_superior_id: e.superior,
        unidade_assistencial_id: e.unidade,
        centro_custo_id: e.centroCusto,
        responsavel_profissional_id: e.responsavel,
        responsavel_vigencia_inicio: e.responsavelInicio,
        responsavel_vigencia_fim: e.responsavelFim,
        ramal_principal: ramalPrincipal(e.ramais),
        pode_solicitar_exames: e.podeSolicitarExames,
        aceita_lancamento_conta: e.aceitaLancamentoConta,
        producao_faturada: e.producaoFaturada,
        exige_profissional_agendamento: e.exigeProfissionalAgendamento,
        exige_recurso_agendamento: e.exigeRecursoAgendamento,
        sigla_agendamento: e.siglaAgendamento,
        observacao_agendamento: e.observacaoAgendamento,
      };
      let id: number;
      if (e.id === null) {
        id = await tx.incluir('setor_funcional', { estabelecimento_id: est, ativo: true, ...valores });
      } else {
        if (!superiores.has(e.id)) throw naoAchado('Setor');
        await tx.alterar('setor_funcional', e.id, e.versao ?? 0, valores);
        id = e.id;
      }
      // Ramais: os da lista ficam (alterados ou novos); os que saíram, exclusão lógica (a linha fica).
      const atuais = await tx.consultar(
        `SELECT id, sequencia, versao FROM ramal_setor WHERE setor_funcional_id = ? FOR UPDATE`,
        [id],
      );
      const vivos = new Set(e.ramais.map((r) => r.id).filter((x): x is number => x !== null));
      let seq = atuais.reduce((m, r) => Math.max(m, Number(r['sequencia'])), 0);
      for (const r of e.ramais) {
        const v = {
          ramal: r.ramal,
          contato: r.contato,
          principal: r.principal,
          responsavel: r.responsavel,
          telefone_externo: r.telefoneExterno,
          observacao: r.observacao,
        };
        if (r.id === null) {
          seq += 1;
          await tx.incluir('ramal_setor', { setor_funcional_id: id, sequencia: seq, ...v });
        } else {
          const a = atuais.find((x) => Number(x['id']) === r.id);
          if (!a) throw recusaCampo('ramal-inexistente', 'Ramal não pertence ao setor.', 'ramais');
          await tx.alterar('ramal_setor', r.id, Number(a['versao']), { ...v, excluido_em: null, excluido_por: null });
        }
      }
      const vivosNoBanco = await tx.consultar(
        'SELECT id, versao FROM ramal_setor WHERE setor_funcional_id = ? AND excluido_em IS NULL',
        [id],
      );
      for (const a of vivosNoBanco) {
        const rid = Number(a['id']);
        if (vivos.has(rid)) continue;
        if (atuais.some((x) => Number(x['id']) === rid))
          await tx.alterar('ramal_setor', rid, Number(a['versao']), {
            excluido_em: new Date(),
            excluido_por: ctx.usuario,
          });
      }
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'setor_funcional', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const opSituacaoSetor = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.setor.situacao',
    tabelas: ['setor_funcional'],
    entrada: esquemaSituacao,
    acao: 'alteracao',
    async gravar(tx, e, ctx) {
      if (e.motivo.length < 10) throw recusaCampo('motivo-curto', 'Escreva o motivo com ao menos 10 letras.', 'motivo');
      const x = await tx.uma(
        `SELECT id, ativo, criado_em FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [e.id, ctx.estabelecimento],
      );
      if (!x) throw naoAchado('Setor');
      if (bool(x['ativo']) === e.ativo) throw recusaCampo('situacao-igual', 'O setor já está nesta situação.', 'situacao');
      if (!e.ativo) {
        const hoje = data((await tx.uma<{ d: unknown }>('SELECT CURRENT_DATE AS d', []))?.d)!;
        const quando = e.data ?? hoje;
        const filhos = await tx.uma<{ n: unknown }>(
          'SELECT COUNT(*) AS n FROM setor_funcional WHERE setor_superior_id = ? AND ativo AND excluido_em IS NULL',
          [e.id],
        );
        recusarErros(
          errosInativarSetor({ filhosAtivos: Number(filhos?.n ?? 0), data: quando, criadoEm: data(x['criado_em'])! }),
        );
        await tx.alterar('setor_funcional', e.id, e.versao, { ativo: false, data_inativacao: quando });
      } else {
        await tx.alterar('setor_funcional', e.id, e.versao, { ativo: true, data_inativacao: null });
      }
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'setor_funcional', id: e.id }),
    trilha: (e) => ({ dados: t.dadosDepois ?? null, motivo: e.motivo }),
  });

// ── Leitura ──

export interface RamalLido {
  readonly id: number;
  readonly ramal: string;
  readonly contato: string | null;
  readonly principal: boolean;
  readonly responsavel: boolean;
  readonly telefoneExterno: string | null;
  readonly observacao: string | null;
}

export class EstruturaGestaoPropria {
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

  async estabelecimento(c: ContextoPorta): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const r = c.hospital
      ? await this.ler(c, (l) =>
          l.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
            c.hospital,
          ]),
        )
      : null;
    if (!r) throw new ErroOperacao(403, 'sem-estabelecimento', 'Sem estabelecimento', 'A sessão não tem estabelecimento.');
    return Number(r.id);
  }

  private async executar<E>(
    c: ContextoPorta,
    op: Parameters<Executor['executar']>[0],
    entrada: E,
    t: RegistroTrilhaTela,
  ): Promise<number> {
    const est = await this.estabelecimento(c);
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: t.usuario ?? c.usuario,
      correlacao: (t.correlacao ?? c.correlacao).slice(0, 64) || 'cadastro',
      chaveIdempotencia: `direta:${randomUUID()}`,
    };
    const x = await this.executor.executar(op, this.cliente, entrada, ctx);
    return Number((x.resultado as { id: unknown }).id);
  }

  /** Tudo da estrutura do estabelecimento numa leitura: dados, unidades, setores com ramais e as opções. */
  async lerTudo(c: ContextoPorta) {
    const est = await this.estabelecimento(c);
    return this.ler(c, async (l) => {
      const e = await l.uma('SELECT * FROM estabelecimento WHERE id = ?', [est]);
      if (!e) throw naoAchado('Estabelecimento');
      const unidades = await l.consultar(
        `SELECT id, codigo, nome, nome_completo, sigla, tipo_unidade, codigo_cnes, cnpj, cep, logradouro,
                numero_endereco, complemento, bairro, telefone, orientacao_acesso, ativo, versao
           FROM unidade_assistencial WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome`,
        [est],
      );
      const setores = await l.consultar(
        `SELECT s.*, cc.nome AS centro_custo_nome, pf.nome AS responsavel_nome
           FROM setor_funcional s
           LEFT JOIN centro_custo cc ON cc.id = s.centro_custo_id
           LEFT JOIN profissional p ON p.id = s.responsavel_profissional_id
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL ORDER BY s.nome`,
        [est],
      );
      const ramais = setores.length
        ? await l.consultar(
            `SELECT id, setor_funcional_id, ramal, contato, principal, responsavel, telefone_externo, observacao
               FROM ramal_setor WHERE excluido_em IS NULL
                AND setor_funcional_id IN (${setores.map(() => '?').join(',')}) ORDER BY sequencia`,
            setores.map((s) => s['id']),
          )
        : [];
      const opcoes = async (sql: string, p: unknown[] = []) =>
        (await l.consultar(sql, p)).map((r) => ({ id: Number(r['id']), nome: String(r['nome']) }));
      return {
        estabelecimento: {
          id: est,
          versao: Number(e['versao']),
          codigo: texto(e['codigo']),
          razaoSocial: texto(e['razao_social']),
          nomeFantasia: texto(e['nome_fantasia']),
          cnpj: texto(e['cnpj']),
          inscricaoEstadual: texto(e['inscricao_estadual']),
          inscricaoMunicipal: texto(e['inscricao_municipal']),
          cnes: texto(e['codigo_cnes']),
          tipo: num(e['tipo_estabelecimento_id']),
          porte: num(e['porte_estabelecimento_id']),
          esfera: num(e['esfera_administrativa_id']),
          hospitalDia: bool(e['hospital_dia']),
          cep: texto(e['cep']),
          logradouro: texto(e['logradouro']),
          numero: texto(e['numero']),
          complemento: texto(e['complemento']),
          bairro: texto(e['bairro_nome']),
          telefone: texto(e['telefone']),
          email: texto(e['email']),
          site: texto(e['site']),
          inicioAtividade: data(e['inicio_atividade']),
          fimAtividade: data(e['fim_atividade']),
        },
        unidades: unidades.map((u) => ({
          id: Number(u['id']),
          versao: Number(u['versao']),
          codigo: String(u['codigo']),
          nome: String(u['nome']),
          nomeCompleto: texto(u['nome_completo']),
          sigla: texto(u['sigla']),
          tipo: String(u['tipo_unidade']),
          cnes: texto(u['codigo_cnes']),
          cnpj: texto(u['cnpj']),
          cep: texto(u['cep']),
          logradouro: texto(u['logradouro']),
          numero: texto(u['numero_endereco']),
          complemento: texto(u['complemento']),
          bairro: texto(u['bairro']),
          telefone: texto(u['telefone']),
          orientacaoAcesso: texto(u['orientacao_acesso']),
          ativo: bool(u['ativo']),
        })),
        setores: setores.map((s) => ({
          id: Number(s['id']),
          versao: Number(s['versao']),
          codigo: String(s['codigo']),
          nome: String(s['nome']),
          sigla: texto(s['sigla']),
          tipo: String(s['tipo']),
          superior: num(s['setor_superior_id']),
          unidade: num(s['unidade_assistencial_id']),
          centroCusto: num(s['centro_custo_id']),
          centroCustoNome: texto(s['centro_custo_nome']),
          responsavel: num(s['responsavel_profissional_id']),
          responsavelNome: texto(s['responsavel_nome']),
          responsavelInicio: data(s['responsavel_vigencia_inicio']),
          responsavelFim: data(s['responsavel_vigencia_fim']),
          ramalPrincipal: texto(s['ramal_principal']),
          podeSolicitarExames: bool(s['pode_solicitar_exames']),
          aceitaLancamentoConta: bool(s['aceita_lancamento_conta']),
          producaoFaturada: bool(s['producao_faturada']),
          exigeProfissionalAgendamento: bool(s['exige_profissional_agendamento']),
          exigeRecursoAgendamento: bool(s['exige_recurso_agendamento']),
          siglaAgendamento: texto(s['sigla_agendamento']),
          observacaoAgendamento: texto(s['observacao_agendamento']),
          ativo: bool(s['ativo']),
          dataInativacao: data(s['data_inativacao']),
          ramais: ramais
            .filter((r) => Number(r['setor_funcional_id']) === Number(s['id']))
            .map(
              (r): RamalLido => ({
                id: Number(r['id']),
                ramal: String(r['ramal']),
                contato: texto(r['contato']),
                principal: bool(r['principal']),
                responsavel: bool(r['responsavel']),
                telefoneExterno: texto(r['telefone_externo']),
                observacao: texto(r['observacao']),
              }),
            ),
        })),
        opcoes: {
          tipos: await opcoes('SELECT id, descricao AS nome FROM tipo_estabelecimento WHERE ativo ORDER BY descricao'),
          portes: await opcoes('SELECT id, descricao AS nome FROM porte_estabelecimento WHERE ativo ORDER BY descricao'),
          esferas: await opcoes('SELECT id, descricao AS nome FROM esfera_administrativa WHERE ativo ORDER BY descricao'),
          centrosCusto: await opcoes(
            `SELECT id, CONCAT(codigo, ' — ', nome) AS nome FROM centro_custo
              WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL ORDER BY codigo`,
            [est],
          ),
        },
      };
    });
  }

  /** Profissionais pelo nome, para escolher o responsável do setor (até 20). */
  profissionais(c: ContextoPorta, termo: string) {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT p.id, pf.nome FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE p.excluido_em IS NULL AND p.situacao = 'ativo' AND pf.nome LIKE ? ORDER BY pf.nome LIMIT 20`,
          [`%${termo.replace(/[%_]/g, '')}%`],
        )
      ).map((r) => ({ id: Number(r['id']), nome: String(r['nome']) })),
    );
  }

  alterarEstabelecimento(c: ContextoPorta, e: EntradaEstabelecimento, t: RegistroTrilhaTela) {
    return this.executar(c, opAlterarEstabelecimento(t), e, t);
  }
  gravarUnidade(c: ContextoPorta, e: EntradaUnidade, t: RegistroTrilhaTela) {
    return this.executar(c, opGravarUnidade(t), e, t);
  }
  situacaoUnidade(c: ContextoPorta, e: EntradaSituacao, t: RegistroTrilhaTela) {
    return this.executar(c, opSituacaoUnidade(t), e, t);
  }
  gravarSetor(c: ContextoPorta, e: EntradaSetor, t: RegistroTrilhaTela) {
    return this.executar(c, opGravarSetor(t), e, t);
  }
  situacaoSetor(c: ContextoPorta, e: EntradaSituacao, t: RegistroTrilhaTela) {
    return this.executar(c, opSituacaoSetor(t), e, t);
  }
}
