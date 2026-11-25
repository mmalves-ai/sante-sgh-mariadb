// Vínculos do paciente no banco próprio (F3.1): cobertura permanente (02-CAD linha 9), pré-cadastro de quem marca sem
// prontuário (02-CAD linha 6) e origem e indicação (02-CAD linha 12). Desenho próprio, por paciente:
//   - Cobertura: as carteiras do paciente (`cobertura_paciente`), com a situação no dia (vigente, a vencer, vencida,
//     encerrada) e a carteira que o atendimento propõe. Incluir, alterar (validade, vigência, plano, titular, principal)
//     e encerrar; nunca apagar. Uma só principal por paciente: marcar outra desmarca a anterior na mesma transação.
//   - Pré-cadastro (`pre_cadastro`): a central de marcação grava o mínimo; na chegada, "converter" liga o pré-cadastro ao
//     paciente (o escolhido, ou o único do mesmo CPF e nascimento), passa ao paciente as marcações e as captações do
//     pré-cadastro e, se veio com fonte pagadora, a carteira vira cobertura do paciente. Sem paciente pelo CPF, recusa
//     `paciente-a-cadastrar` com os dados para a ficha nova já preenchida. Nada é apagado.
//   - Captação (`captacao_paciente`): a regra de quem indicou vem do tipo de indicação do hospital (domínio); o
//     indicador por origem conta por canal e por tipo de indicação no período.
// Regras no @sgh/dominio-cadastro; gravações pelo Executor (trilha e idempotência na mesma transação). Datas AAAA-MM-DD.
import { randomUUID } from 'node:crypto';
import {
  CANAIS_CAPTACAO,
  conferirCaptacao,
  conferirCobertura,
  conferirPreCadastro,
  conferirSemelhanca,
  coberturaProposta,
  decidirConversao,
  fimAoEncerrar,
  type PacienteEscolhido,
  situacaoDaCarteira,
  somenteDigitos,
  totaisPorCanal,
  type SituacaoCarteira,
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
import { semIndefinidos } from '../../entrada-exata.js';

type Linha = Record<string, unknown>;
const n = (v: unknown): number => Number(v);
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const tx_ = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 1n;
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ID = z.number().int().positive();
const texto = (max: number) => z.string().trim().max(max);

/** Primeira recusa do domínio vira a recusa do executor (422), com o campo da tela. */
function recusar(rs: readonly { codigo: string; campo: string; mensagem: string }[]): void {
  const [r] = rs;
  if (r) throw recusa(r.codigo, r.mensagem, { campos: rs.map((x) => x.campo) });
}

async function hojeDo(tx: Leitor | TxOperacao): Promise<string> {
  const r = await tx.uma("SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') AS hoje");
  return String(r?.['hoje']);
}

async function pacienteExiste(tx: Leitor | TxOperacao, id: number): Promise<void> {
  const p = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [id]);
  if (!p) throw recusa('paciente-inexistente', 'O paciente não existe.', { campos: ['paciente'] });
}

// ───────────────────────────── Cobertura ─────────────────────────────

export interface CoberturaDoPaciente {
  readonly id: number;
  readonly fontePagadora: { id: number; nome: string };
  readonly plano: { id: number; nome: string } | null;
  readonly numeroCarteira: string | null;
  readonly validade: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly titular: boolean;
  readonly titularPaciente: number | null;
  readonly titularNome: string | null;
  readonly parentesco: number | null;
  readonly principal: boolean;
  readonly situacao: string;
  readonly situacaoNoDia: SituacaoCarteira;
  readonly versao: number;
}

export interface CoberturasDoPaciente {
  readonly hoje: string;
  readonly itens: CoberturaDoPaciente[];
  /** A carteira que o atendimento propõe (principal utilizável primeiro); null sem nenhuma utilizável. */
  readonly proposta: number | null;
  /** Avisos da tela: carteira vencida ou a vencer. */
  readonly avisos: { id: number; codigo: 'carteira-vencida' | 'carteira-a-vencer'; mensagem: string }[];
}

const camposCobertura = {
  plano: ID.nullable().optional(),
  numeroCarteira: texto(30).nullable().optional(),
  validade: DATA.nullable().optional(),
  vigenciaInicio: DATA.optional(),
  vigenciaFim: DATA.nullable().optional(),
  titular: z.boolean().optional(),
  titularPaciente: ID.nullable().optional(),
  titularNome: texto(150).nullable().optional(),
  matriculaTitular: texto(30).nullable().optional(),
  parentesco: ID.nullable().optional(),
  principal: z.boolean().optional(),
  observacao: texto(500).nullable().optional(),
};
export const esquemaIncluirCobertura = z
  .object({ paciente: ID, fontePagadora: ID, ...camposCobertura })
  .strict();
export const esquemaAlterarCobertura = z
  .object({ paciente: ID, id: ID, versao: z.number().int().positive(), ...camposCobertura })
  .strict();
export const esquemaEncerrarCobertura = z
  .object({
    paciente: ID,
    id: ID,
    versao: z.number().int().positive(),
    motivo: texto(400).min(3),
  })
  .strict();

async function regraFonte(tx: TxOperacao, id: number) {
  const f = await tx.uma(
    'SELECT id, situacao, tipo, exige_validade_carteira FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL',
    [id],
  );
  return f
    ? {
        id: n(f['id']),
        ativa: f['situacao'] === 'ativa',
        particular: f['tipo'] === 'particular',
        exigeValidadeCarteira: bool(f['exige_validade_carteira']),
      }
    : null;
}
async function regraPlano(tx: TxOperacao, id: number | null | undefined) {
  if (!id) return null;
  const p = await tx.uma(
    'SELECT id, fonte_pagadora_id, situacao FROM plano_fonte_pagadora WHERE id = ? AND excluido_em IS NULL',
    [id],
  );
  return p
    ? { id: n(p['id']), fontePagadora: n(p['fonte_pagadora_id']), ativo: p['situacao'] === 'ativo' }
    : null;
}

/** Desmarca as outras principais do paciente (uma só principal por paciente). */
async function unicaPrincipal(tx: TxOperacao, paciente: number, manter: number): Promise<void> {
  const outras = await tx.consultarParaAtualizar(
    `SELECT id, versao FROM cobertura_paciente
      WHERE paciente_id = ? AND principal AND id <> ? AND excluido_em IS NULL`,
    [paciente, manter],
    { teto: 100 },
  );
  for (const o of outras)
    await tx.alterar('cobertura_paciente', n(o['id']), n(o['versao']), { principal: false });
}

type EntradaInclusao = z.infer<typeof esquemaIncluirCobertura>;
type EntradaAlteracao = z.infer<typeof esquemaAlterarCobertura>;

async function conferirEGravarDuplicata(
  tx: TxOperacao,
  paciente: number,
  fonte: number,
  carteira: string | null,
  id: number | null,
): Promise<void> {
  if (!carteira) return;
  const d = await tx.uma(
    `SELECT id FROM cobertura_paciente WHERE paciente_id = ? AND fonte_pagadora_id = ? AND numero_carteira = ?
        AND situacao <> 'cancelada' AND excluido_em IS NULL AND id <> ?`,
    [paciente, fonte, carteira, id ?? 0],
  );
  if (d)
    throw recusa(
      'carteira-repetida',
      'O paciente já tem esta carteira, não encerrada, nesta fonte pagadora.',
      {
        campos: ['numeroCarteira'],
      },
    );
}

const operacaoIncluirCobertura = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.incluir-cobertura-paciente',
    tabelas: ['cobertura_paciente'],
    entrada: esquemaIncluirCobertura,
    acao: 'inclusao',
    async gravar(tx, e: EntradaInclusao) {
      await pacienteExiste(tx, e.paciente);
      const hoje = await hojeDo(tx);
      const titular = e.titular ?? true;
      const carteira = e.numeroCarteira?.trim() || null;
      recusar(
        conferirCobertura({
          paciente: e.paciente,
          fontePagadora: await regraFonte(tx, e.fontePagadora),
          plano: await regraPlano(tx, e.plano),
          planoInformado: !!e.plano,
          numeroCarteira: carteira,
          validade: e.validade ?? null,
          vigenciaInicio: e.vigenciaInicio ?? hoje,
          vigenciaFim: e.vigenciaFim ?? null,
          titular,
          titularPaciente: e.titularPaciente ?? null,
          titularNome: e.titularNome ?? null,
          parentesco: e.parentesco ?? null,
        }),
      );
      await conferirEGravarDuplicata(tx, e.paciente, e.fontePagadora, carteira, null);
      const outras = await tx.uma(
        'SELECT COUNT(*) AS q FROM cobertura_paciente WHERE paciente_id = ? AND principal AND excluido_em IS NULL',
        [e.paciente],
      );
      // A primeira carteira do paciente já nasce principal (menos um clique na recepção).
      const principal = e.principal ?? n(outras?.['q']) === 0;
      const id = await tx.incluir('cobertura_paciente', {
        paciente_id: e.paciente,
        fonte_pagadora_id: e.fontePagadora,
        plano_fonte_pagadora_id: e.plano ?? null,
        numero_carteira: carteira,
        validade: e.validade ?? null,
        vigencia_inicio: e.vigenciaInicio ?? hoje,
        vigencia_fim: e.vigenciaFim ?? null,
        titular,
        titular_paciente_id: titular ? null : (e.titularPaciente ?? null),
        titular_nome: titular ? null : e.titularNome?.trim() || null,
        matricula_titular: titular ? null : e.matriculaTitular?.trim() || null,
        tipo_parentesco_id: titular ? null : (e.parentesco ?? null),
        principal,
        situacao: 'ativa',
        observacao: e.observacao?.trim() || null,
      });
      if (principal) await unicaPrincipal(tx, e.paciente, id);
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'cobertura_paciente', id: n(r.id) }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

const operacaoAlterarCobertura = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.alterar-cobertura-paciente',
    tabelas: ['cobertura_paciente'],
    entrada: esquemaAlterarCobertura,
    acao: 'alteracao',
    async gravar(tx, e: EntradaAlteracao) {
      const [k] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, fonte_pagadora_id, plano_fonte_pagadora_id, numero_carteira,
                DATE_FORMAT(validade, '%Y-%m-%d') AS validade, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS inicio,
                DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, titular, titular_paciente_id, titular_nome,
                matricula_titular, tipo_parentesco_id, principal, observacao
           FROM cobertura_paciente WHERE id = ? AND paciente_id = ? AND excluido_em IS NULL`,
        [e.id, e.paciente],
        { teto: 1 },
      );
      if (!k) throw recusa('cobertura-inexistente', 'A carteira não existe para este paciente.');
      if (n(k['versao']) !== e.versao)
        throw new ErroOperacao(
          409,
          'colisao',
          'Alterada por outra pessoa',
          'Recarregue a carteira e refaça.',
        );
      if (k['situacao'] === 'cancelada')
        throw recusa('cobertura-encerrada', 'A carteira está encerrada: inclua uma nova.');
      const pega = <T>(v: T | undefined, atual: T): T => (v === undefined ? atual : v);
      const novo = {
        plano: pega(e.plano, nn(k['plano_fonte_pagadora_id'])),
        numeroCarteira: pega(e.numeroCarteira, tx_(k['numero_carteira']))?.trim() || null,
        validade: pega(e.validade, tx_(k['validade'])),
        vigenciaInicio: e.vigenciaInicio ?? String(k['inicio']),
        vigenciaFim: pega(e.vigenciaFim, tx_(k['fim'])),
        titular: e.titular ?? bool(k['titular']),
        titularPaciente: pega(e.titularPaciente, nn(k['titular_paciente_id'])),
        titularNome: pega(e.titularNome, tx_(k['titular_nome'])),
        matriculaTitular: pega(e.matriculaTitular, tx_(k['matricula_titular'])),
        parentesco: pega(e.parentesco, nn(k['tipo_parentesco_id'])),
        principal: e.principal ?? bool(k['principal']),
        observacao: pega(e.observacao, tx_(k['observacao'])),
      };
      const fonte = n(k['fonte_pagadora_id']);
      recusar(
        conferirCobertura({
          ...novo,
          paciente: e.paciente,
          fontePagadora: await regraFonte(tx, fonte),
          plano: await regraPlano(tx, novo.plano),
          planoInformado: !!novo.plano,
        }),
      );
      await conferirEGravarDuplicata(tx, e.paciente, fonte, novo.numeroCarteira, e.id);
      const hoje = await hojeDo(tx);
      // Validade nova no futuro reabre a carteira marcada vencida (renovação).
      const situacao =
        k['situacao'] === 'vencida' && novo.validade && novo.validade >= hoje
          ? 'ativa'
          : String(k['situacao']);
      await tx.alterar('cobertura_paciente', e.id, e.versao, {
        plano_fonte_pagadora_id: novo.plano,
        numero_carteira: novo.numeroCarteira,
        validade: novo.validade,
        vigencia_inicio: novo.vigenciaInicio,
        vigencia_fim: novo.vigenciaFim,
        titular: novo.titular,
        titular_paciente_id: novo.titular ? null : novo.titularPaciente,
        titular_nome: novo.titular ? null : novo.titularNome?.trim() || null,
        matricula_titular: novo.titular ? null : novo.matriculaTitular?.trim() || null,
        tipo_parentesco_id: novo.titular ? null : novo.parentesco,
        principal: novo.principal,
        situacao,
        observacao: novo.observacao?.trim() || null,
      });
      if (novo.principal) await unicaPrincipal(tx, e.paciente, e.id);
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'cobertura_paciente', id: e.id }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

const operacaoEncerrarCobertura = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.encerrar-cobertura-paciente',
    tabelas: ['cobertura_paciente'],
    entrada: esquemaEncerrarCobertura,
    acao: 'alteracao',
    async gravar(tx, e) {
      const [k] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS inicio,
                DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, observacao
           FROM cobertura_paciente WHERE id = ? AND paciente_id = ? AND excluido_em IS NULL`,
        [e.id, e.paciente],
        { teto: 1 },
      );
      if (!k) throw recusa('cobertura-inexistente', 'A carteira não existe para este paciente.');
      if (n(k['versao']) !== e.versao)
        throw new ErroOperacao(
          409,
          'colisao',
          'Alterada por outra pessoa',
          'Recarregue a carteira e refaça.',
        );
      if (k['situacao'] === 'cancelada') throw recusa('cobertura-encerrada', 'A carteira já está encerrada.');
      const hoje = await hojeDo(tx);
      const obs = [tx_(k['observacao']), `Encerrada em ${hoje}: ${e.motivo}`].filter(Boolean).join(' | ');
      await tx.alterar('cobertura_paciente', e.id, e.versao, {
        situacao: 'cancelada',
        vigencia_fim: fimAoEncerrar(
          { vigenciaInicio: String(k['inicio']), vigenciaFim: tx_(k['fim']) },
          hoje,
        ),
        principal: false,
        observacao: obs.slice(-500),
      });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'cobertura_paciente', id: e.id }),
    trilha: (e) => ({ dados: trilha.dadosDepois ?? null, motivo: e.motivo }),
  });

// ───────────────────────────── Pré-cadastro ─────────────────────────────

export const esquemaPreCadastro = z
  .object({
    estabelecimento: ID,
    nome: texto(150).min(1),
    nascimento: DATA,
    telefone: texto(20).nullable().optional(),
    celular: texto(20).nullable().optional(),
    cpf: texto(14).nullable().optional(),
    email: texto(254).email().nullable().optional(),
    fontePagadora: ID.nullable().optional(),
    plano: ID.nullable().optional(),
    numeroCarteira: texto(30).nullable().optional(),
    validadeCarteira: DATA.nullable().optional(),
    observacao: texto(2000).nullable().optional(),
    /** Quem marca confirma que é outra pessoa quando um paciente tem o mesmo nome e nascimento (homônimo). */
    confirmadoOutraPessoa: z.boolean().optional(),
  })
  .strict();
export const esquemaConverterPreCadastro = z
  .object({
    estabelecimento: ID,
    id: ID,
    paciente: ID.nullable().optional(),
    /** Confirmação da recepção quando o paciente escolhido diverge do pré-cadastro (vai para a trilha). */
    motivoDivergencia: texto(400).nullable().optional(),
  })
  .strict();
export const esquemaCancelarPreCadastro = z
  .object({ estabelecimento: ID, id: ID, motivo: texto(400).min(3) })
  .strict();

export interface PreCadastroResumo {
  readonly id: number;
  readonly nome: string;
  readonly nascimento: string;
  readonly celular: string | null;
  readonly telefone: string | null;
  readonly situacao: string;
  readonly paciente: number | null;
  readonly fontePagadora: number | null;
  readonly marcacoes: number;
  readonly criadoEm: string;
}

const operacaoRegistrarPreCadastro = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.registrar-pre-cadastro',
    tabelas: ['pre_cadastro'],
    entrada: esquemaPreCadastro,
    acao: 'inclusao',
    async gravar(tx, e) {
      const hoje = await hojeDo(tx);
      recusar(conferirPreCadastro(semIndefinidos(e), hoje));
      if (e.fontePagadora) {
        const f = await regraFonte(tx, e.fontePagadora);
        if (!f?.ativa)
          throw recusa('fonte-pagadora-invalida', 'Escolha uma fonte pagadora ativa.', {
            campos: ['fontePagadora'],
          });
        const p = await regraPlano(tx, e.plano);
        if (e.plano && (!p?.ativo || p.fontePagadora !== f.id))
          throw recusa('plano-invalido', 'Escolha um plano ativo da fonte pagadora.', { campos: ['plano'] });
      }
      const dig = (v: string | null | undefined) => somenteDigitos(v ?? '') || null;
      // Quem já é paciente é marcado no paciente: o pré-cadastro só existe para quem não tem prontuário.
      const semelhante = conferirSemelhanca(
        {
          porCpf: (await pacientesDoCpf(tx, dig(e.cpf))).map((p) => p.id),
          porNomeNascimento: await pacientesDoNomeNascimento(tx, e.nome, e.nascimento),
        },
        e.confirmadoOutraPessoa === true,
      );
      if (semelhante) throw recusa(semelhante.codigo, semelhante.mensagem, { campos: [semelhante.campo] });
      const id = await tx.incluir('pre_cadastro', {
        estabelecimento_id: e.estabelecimento,
        nome: e.nome.trim().toUpperCase(),
        data_nascimento: e.nascimento,
        cpf: dig(e.cpf),
        telefone: dig(e.telefone),
        celular: dig(e.celular),
        email: e.email?.trim() || null,
        fonte_pagadora_id: e.fontePagadora ?? null,
        plano_fonte_pagadora_id: e.fontePagadora ? (e.plano ?? null) : null,
        numero_carteira: e.fontePagadora ? e.numeroCarteira?.trim() || null : null,
        validade_carteira: e.fontePagadora ? (e.validadeCarteira ?? null) : null,
        observacao: e.observacao?.trim() || null,
        situacao: 'pendente',
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'pre_cadastro', id: n(r.id) }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

/** Pacientes com o mesmo nome (sem caixa) e nascimento: o pré-cadastro que repete um paciente. */
async function pacientesDoNomeNascimento(
  l: Leitor | TxOperacao,
  nome: string,
  nascimento: string,
): Promise<number[]> {
  const r = await l.consultar(
    `SELECT p.id FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
      WHERE pf.nome = ? AND pf.data_nascimento = ? AND p.excluido_em IS NULL AND pf.excluido_em IS NULL
      ORDER BY p.id LIMIT 5`,
    [nome.trim().replace(/\s+/g, ' ').toUpperCase(), nascimento],
  );
  return r.map((x) => n(x['id']));
}

/** O paciente escolhido na chegada, com o que a conversão confere (nome, nascimento e CPF). */
async function pacienteEscolhido(l: Leitor | TxOperacao, id: number): Promise<PacienteEscolhido> {
  const p = await l.uma(
    `SELECT p.id, pf.nome, DATE_FORMAT(pf.data_nascimento, '%Y-%m-%d') AS nascimento, pf.cpf
       FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
      WHERE p.id = ? AND p.excluido_em IS NULL`,
    [id],
  );
  if (!p) throw recusa('paciente-inexistente', 'O paciente não existe.', { campos: ['paciente'] });
  return { id: n(p['id']), nome: String(p['nome']), nascimento: tx_(p['nascimento']), cpf: tx_(p['cpf']) };
}

/** Pacientes com o CPF (para o reaproveitamento na chegada). */
async function pacientesDoCpf(l: Leitor | TxOperacao, cpf: string | null) {
  if (!cpf) return [];
  const r = await l.consultar(
    `SELECT p.id, DATE_FORMAT(pf.data_nascimento, '%Y-%m-%d') AS nascimento
       FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
      WHERE pf.cpf = ? AND p.excluido_em IS NULL AND pf.excluido_em IS NULL ORDER BY p.id LIMIT 5`,
    [cpf],
  );
  return r.map((x) => ({ id: n(x['id']), nascimento: tx_(x['nascimento']) }));
}

const operacaoConverterPreCadastro = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.converter-pre-cadastro',
    tabelas: ['pre_cadastro', 'marcacao_horario', 'captacao_paciente', 'cobertura_paciente'],
    entrada: esquemaConverterPreCadastro,
    acao: 'alteracao',
    async gravar(tx, e) {
      const [k] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, nome, cpf, DATE_FORMAT(data_nascimento, '%Y-%m-%d') AS nascimento,
                fonte_pagadora_id, plano_fonte_pagadora_id, numero_carteira,
                DATE_FORMAT(validade_carteira, '%Y-%m-%d') AS validade
           FROM pre_cadastro WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [e.id, e.estabelecimento],
        { teto: 1 },
      );
      if (!k) throw recusa('pre-cadastro-inexistente', 'O pré-cadastro não existe neste estabelecimento.');
      if (k['situacao'] !== 'pendente')
        throw recusa('pre-cadastro-fechado', 'O pré-cadastro já foi convertido ou cancelado.');
      const d = decidirConversao(
        { nascimento: String(k['nascimento']), nome: String(k['nome']), cpf: tx_(k['cpf']) },
        await pacientesDoCpf(tx, tx_(k['cpf'])),
        e.paciente ? await pacienteEscolhido(tx, e.paciente) : null,
        e.motivoDivergencia ?? null,
      );
      if (d.acao === 'recusar')
        throw recusa(d.codigo, d.mensagem, {
          campos: d.codigo === 'dados-divergentes' ? ['motivoDivergencia'] : ['paciente'],
        });
      if (d.acao === 'cadastrar')
        throw recusa(
          'paciente-a-cadastrar',
          'Nenhum paciente com este CPF: cadastre o paciente com os dados do pré-cadastro e converta.',
          { campos: ['paciente'] },
        );
      await pacienteExiste(tx, d.paciente);
      const agora = new Date();
      await tx.alterar('pre_cadastro', e.id, n(k['versao']), {
        situacao: 'convertido',
        paciente_id: d.paciente,
        convertido_em: agora,
      });
      // As marcações e as captações do pré-cadastro passam a ser do paciente (o pré-cadastro continua ligado).
      const marcacoes = await tx.consultarParaAtualizar(
        'SELECT id, versao FROM marcacao_horario WHERE pre_cadastro_id = ? AND paciente_id IS NULL',
        [e.id],
        { teto: 500 },
      );
      for (const m of marcacoes)
        await tx.alterar('marcacao_horario', n(m['id']), n(m['versao']), { paciente_id: d.paciente });
      const captacoes = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM captacao_paciente
          WHERE pre_cadastro_id = ? AND estabelecimento_id = ? AND paciente_id IS NULL AND excluido_em IS NULL`,
        [e.id, e.estabelecimento],
        { teto: 100 },
      );
      for (const c of captacoes)
        await tx.alterar('captacao_paciente', n(c['id']), n(c['versao']), { paciente_id: d.paciente });
      // A carteira informada na marcação vira cobertura do paciente, se ele ainda não a tem.
      let cobertura: number | null = null;
      const fonte = nn(k['fonte_pagadora_id']);
      if (fonte) {
        const carteira = tx_(k['numero_carteira']);
        const ja = await tx.uma(
          `SELECT id FROM cobertura_paciente WHERE paciente_id = ? AND fonte_pagadora_id = ?
              AND (numero_carteira <=> ?) AND situacao <> 'cancelada' AND excluido_em IS NULL`,
          [d.paciente, fonte, carteira],
        );
        const f = await regraFonte(tx, fonte);
        if (!ja && f && (f.particular || carteira)) {
          const temPrincipal = await tx.uma(
            'SELECT id FROM cobertura_paciente WHERE paciente_id = ? AND principal AND excluido_em IS NULL',
            [d.paciente],
          );
          cobertura = await tx.incluir('cobertura_paciente', {
            paciente_id: d.paciente,
            fonte_pagadora_id: fonte,
            plano_fonte_pagadora_id: nn(k['plano_fonte_pagadora_id']),
            numero_carteira: carteira,
            validade: tx_(k['validade']),
            vigencia_inicio: await hojeDo(tx),
            titular: true,
            principal: !temPrincipal,
            situacao: 'ativa',
          });
        }
      }
      return { id: e.id, paciente: d.paciente, marcacoes: marcacoes.length, cobertura };
    },
    alvo: (e) => ({ tabela: 'pre_cadastro', id: e.id }),
    trilha: (e) => ({
      dados: trilha.dadosDepois ?? null,
      motivo: e.motivoDivergencia?.trim()
        ? `Dados divergentes confirmados: ${e.motivoDivergencia.trim()}`
        : null,
    }),
  });

/** Cancela o pré-cadastro pendente (desistência, marcação desfeita): nada é apagado, o motivo fica na observação e na
 * trilha. As marcações seguem ligadas ao pré-cadastro, como histórico. */
const operacaoCancelarPreCadastro = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.cancelar-pre-cadastro',
    tabelas: ['pre_cadastro'],
    entrada: esquemaCancelarPreCadastro,
    acao: 'alteracao',
    async gravar(tx, e) {
      const [k] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, observacao FROM pre_cadastro
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [e.id, e.estabelecimento],
        { teto: 1 },
      );
      if (!k) throw recusa('pre-cadastro-inexistente', 'O pré-cadastro não existe neste estabelecimento.');
      if (k['situacao'] !== 'pendente')
        throw recusa('pre-cadastro-fechado', 'O pré-cadastro já foi convertido ou cancelado.');
      const hoje = await hojeDo(tx);
      await tx.alterar('pre_cadastro', e.id, n(k['versao']), {
        situacao: 'cancelado',
        observacao: [tx_(k['observacao']), `Cancelado em ${hoje}: ${e.motivo.trim()}`]
          .filter(Boolean)
          .join(' | '),
      });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'pre_cadastro', id: e.id }),
    trilha: (e) => ({ dados: trilha.dadosDepois ?? null, motivo: e.motivo }),
  });

// ───────────────────────────── Captação ─────────────────────────────

export const esquemaCaptacao = z
  .object({
    estabelecimento: ID,
    usuario: ID,
    canal: z.enum(CANAIS_CAPTACAO),
    tipoIndicacao: ID,
    paciente: ID.nullable().optional(),
    preCadastro: ID.nullable().optional(),
    contatoNome: texto(150).nullable().optional(),
    contatoTelefone: texto(20).nullable().optional(),
    indicadorProfissional: ID.nullable().optional(),
    indicadorPaciente: ID.nullable().optional(),
    parceiro: ID.nullable().optional(),
    indicadorNome: texto(150).nullable().optional(),
    campanha: texto(100).nullable().optional(),
    observacao: texto(2000).nullable().optional(),
  })
  .strict();

const operacaoRegistrarCaptacao = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.registrar-captacao',
    tabelas: ['captacao_paciente'],
    entrada: esquemaCaptacao,
    acao: 'inclusao',
    async gravar(tx, e) {
      const t = await tx.uma(
        'SELECT id, ativo, categoria, exige_profissional, exige_complemento FROM tipo_indicacao WHERE id = ?',
        [e.tipoIndicacao],
      );
      recusar(
        conferirCaptacao({
          ...semIndefinidos(e),
          tipoIndicacao: t
            ? {
                id: n(t['id']),
                ativo: bool(t['ativo']),
                categoria: String(t['categoria']),
                exigeProfissional: bool(t['exige_profissional']),
                exigeComplemento: bool(t['exige_complemento']),
              }
            : null,
        }),
      );
      if (e.paciente) await pacienteExiste(tx, e.paciente);
      if (e.preCadastro) {
        // O pré-cadastro tem de ser deste estabelecimento; com o paciente junto, só o pré-cadastro já ligado a ele.
        const pc = await tx.uma(
          'SELECT situacao, paciente_id FROM pre_cadastro WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.preCadastro, e.estabelecimento],
        );
        if (!pc)
          throw recusa('pre-cadastro-inexistente', 'O pré-cadastro não existe neste estabelecimento.', {
            campos: ['preCadastro'],
          });
        const ligadoAoPaciente =
          pc['situacao'] === 'convertido' && !!e.paciente && nn(pc['paciente_id']) === e.paciente;
        if (pc['situacao'] !== 'pendente' && !ligadoAoPaciente)
          throw recusa(
            'pre-cadastro-de-outro-paciente',
            'O pré-cadastro já foi fechado ou é de outro paciente: registre a captação no paciente.',
            { campos: ['preCadastro'] },
          );
      }
      const id = await tx.incluir('captacao_paciente', {
        estabelecimento_id: e.estabelecimento,
        paciente_id: e.paciente ?? null,
        pre_cadastro_id: e.preCadastro ?? null,
        contato_nome: e.contatoNome?.trim() || null,
        contato_telefone: somenteDigitos(e.contatoTelefone ?? '') || null,
        captado_em: new Date(),
        tipo_indicacao_id: e.tipoIndicacao,
        canal: e.canal,
        indicador_profissional_id: e.indicadorProfissional ?? null,
        indicador_paciente_id: e.indicadorPaciente ?? null,
        parceiro_pessoa_juridica_id: e.parceiro ?? null,
        indicador_nome: e.indicadorNome?.trim() || null,
        campanha: e.campanha?.trim() || null,
        observacao: e.observacao?.trim() || null,
        situacao: 'registrada',
        registrado_usuario_id: e.usuario,
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'captacao_paciente', id: n(r.id) }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

export interface CaptacaoDoPaciente {
  readonly id: number;
  readonly captadoEm: string;
  readonly canal: string;
  readonly tipoIndicacao: { id: number; descricao: string };
  readonly indicador: string | null;
  readonly campanha: string | null;
  readonly situacao: string;
}

export interface IndicadorOrigem {
  readonly de: string;
  readonly ate: string;
  readonly total: number;
  readonly porCanal: { canal: string; total: number }[];
  readonly porTipo: { id: number; descricao: string; total: number }[];
}

export interface OpcoesVinculos {
  readonly fontes: { id: number; nome: string; particular: boolean; exigeValidade: boolean }[];
  readonly planos: { id: number; fontePagadora: number; descricao: string }[];
  readonly tiposIndicacao: {
    id: number;
    descricao: string;
    exigeProfissional: boolean;
    exigeComplemento: boolean;
  }[];
  readonly parentescos: { id: number; descricao: string }[];
  readonly canais: string[];
}

// ───────────────────────────── Serviço ─────────────────────────────

export class CadastroVinculosProprio {
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

  private estabelecimento(c: ContextoPorta): number {
    if (c.estabelecimento === null)
      throw new ErroOperacao(
        403,
        'sem-estabelecimento',
        'Sem estabelecimento',
        'A sessão não tem estabelecimento.',
      );
    return c.estabelecimento;
  }

  private contexto(c: ContextoPorta, trilha: RegistroTrilhaTela, chave?: string): ContextoOperacao {
    return {
      cliente: this.cliente,
      estabelecimento: trilha.estabelecimento ?? this.estabelecimento(c),
      usuario: trilha.usuario ?? c.usuario,
      correlacao: (trilha.correlacao ?? c.correlacao).slice(0, 64) || 'cadastro',
      chaveIdempotencia: chave ?? `direta:${randomUUID()}`,
    };
  }

  async coberturas(c: ContextoPorta, paciente: number): Promise<CoberturasDoPaciente> {
    return this.ler(c, async (l) => {
      const hoje = await hojeDo(l);
      const linhas = await l.consultar(
        `SELECT cp.id, cp.fonte_pagadora_id, fp.nome AS fonte, cp.plano_fonte_pagadora_id, pl.descricao AS plano,
                cp.numero_carteira, DATE_FORMAT(cp.validade, '%Y-%m-%d') AS validade,
                DATE_FORMAT(cp.vigencia_inicio, '%Y-%m-%d') AS inicio, DATE_FORMAT(cp.vigencia_fim, '%Y-%m-%d') AS fim,
                cp.titular, cp.titular_paciente_id, cp.titular_nome, cp.tipo_parentesco_id, cp.principal, cp.situacao,
                cp.versao
           FROM cobertura_paciente cp
           JOIN fonte_pagadora fp ON fp.id = cp.fonte_pagadora_id
           LEFT JOIN plano_fonte_pagadora pl ON pl.id = cp.plano_fonte_pagadora_id
          WHERE cp.paciente_id = ? AND cp.excluido_em IS NULL
          ORDER BY cp.principal DESC, cp.vigencia_inicio DESC, cp.id DESC LIMIT 200`,
        [paciente],
      );
      const itens: CoberturaDoPaciente[] = linhas.map((x: Linha) => {
        const base = {
          situacao: String(x['situacao']),
          validade: tx_(x['validade']),
          vigenciaInicio: String(x['inicio']),
          vigenciaFim: tx_(x['fim']),
        };
        return {
          id: n(x['id']),
          fontePagadora: { id: n(x['fonte_pagadora_id']), nome: String(x['fonte']) },
          plano: x['plano_fonte_pagadora_id']
            ? { id: n(x['plano_fonte_pagadora_id']), nome: String(x['plano']) }
            : null,
          numeroCarteira: tx_(x['numero_carteira']),
          ...base,
          titular: bool(x['titular']),
          titularPaciente: nn(x['titular_paciente_id']),
          titularNome: tx_(x['titular_nome']),
          parentesco: nn(x['tipo_parentesco_id']),
          principal: bool(x['principal']),
          situacaoNoDia: situacaoDaCarteira(base, hoje),
          versao: n(x['versao']),
        };
      });
      const avisos: CoberturasDoPaciente['avisos'] = [];
      for (const i of itens) {
        if (i.situacaoNoDia === 'vencida')
          avisos.push({
            id: i.id,
            codigo: 'carteira-vencida',
            mensagem: `Carteira ${i.fontePagadora.nome} vencida em ${i.validade}: peça a carteira nova.`,
          });
        else if (i.situacaoNoDia === 'a_vencer')
          avisos.push({
            id: i.id,
            codigo: 'carteira-a-vencer',
            mensagem: `Carteira ${i.fontePagadora.nome} vence em ${i.validade}.`,
          });
      }
      return { hoje, itens, proposta: coberturaProposta(itens, hoje)?.id ?? null, avisos };
    });
  }

  async incluirCobertura(
    c: ContextoPorta,
    e: z.infer<typeof esquemaIncluirCobertura>,
    trilha: RegistroTrilhaTela,
    chave?: string,
  ): Promise<number> {
    const x = await this.executor.executar(
      operacaoIncluirCobertura(trilha),
      this.cliente,
      e,
      this.contexto(c, trilha, chave),
    );
    return n(x.resultado.id);
  }

  async alterarCobertura(
    c: ContextoPorta,
    e: z.infer<typeof esquemaAlterarCobertura>,
    trilha: RegistroTrilhaTela,
    chave?: string,
  ): Promise<void> {
    await this.executor.executar(
      operacaoAlterarCobertura(trilha),
      this.cliente,
      e,
      this.contexto(c, trilha, chave),
    );
  }

  async encerrarCobertura(
    c: ContextoPorta,
    e: z.infer<typeof esquemaEncerrarCobertura>,
    trilha: RegistroTrilhaTela,
    chave?: string,
  ): Promise<void> {
    await this.executor.executar(
      operacaoEncerrarCobertura(trilha),
      this.cliente,
      e,
      this.contexto(c, trilha, chave),
    );
  }

  async registrarPreCadastro(
    c: ContextoPorta,
    e: Omit<z.infer<typeof esquemaPreCadastro>, 'estabelecimento'>,
    trilha: RegistroTrilhaTela,
    chave?: string,
  ): Promise<number> {
    const x = await this.executor.executar(
      operacaoRegistrarPreCadastro(trilha),
      this.cliente,
      { ...e, estabelecimento: this.estabelecimento(c) },
      this.contexto(c, trilha, chave),
    );
    return n(x.resultado.id);
  }

  /** Pré-cadastros do estabelecimento (pendentes primeiro), com o número de marcações de cada um. */
  async preCadastros(
    c: ContextoPorta,
    filtro: { situacao?: string; termo?: string },
  ): Promise<PreCadastroResumo[]> {
    const est = this.estabelecimento(c);
    return this.ler(c, async (l) => {
      const p: unknown[] = [est];
      let onde = 'pc.estabelecimento_id = ? AND pc.excluido_em IS NULL';
      if (filtro.situacao) {
        onde += ' AND pc.situacao = ?';
        p.push(filtro.situacao);
      }
      const termo = (filtro.termo ?? '').trim().toUpperCase();
      if (termo.length >= 2) {
        onde += ' AND pc.nome LIKE ?';
        p.push(`${termo.replace(/[%_\\]/g, '')}%`);
      }
      const r = await l.consultar(
        `SELECT pc.id, pc.nome, DATE_FORMAT(pc.data_nascimento, '%Y-%m-%d') AS nascimento, pc.celular, pc.telefone,
                pc.situacao, pc.paciente_id, pc.fonte_pagadora_id, pc.criado_em,
                (SELECT COUNT(*) FROM marcacao_horario m WHERE m.pre_cadastro_id = pc.id) AS marcacoes
           FROM pre_cadastro pc WHERE ${onde}
          ORDER BY pc.situacao = 'pendente' DESC, pc.criado_em DESC, pc.id DESC LIMIT 200`,
        p,
      );
      return r.map((x: Linha) => ({
        id: n(x['id']),
        nome: String(x['nome']),
        nascimento: String(x['nascimento']),
        celular: tx_(x['celular']),
        telefone: tx_(x['telefone']),
        situacao: String(x['situacao']),
        paciente: nn(x['paciente_id']),
        fontePagadora: nn(x['fonte_pagadora_id']),
        marcacoes: n(x['marcacoes']),
        criadoEm: x['criado_em'] instanceof Date ? x['criado_em'].toISOString() : String(x['criado_em']),
      }));
    });
  }

  /**
   * O que a conversão faria agora (prévia da tela de chegada): reaproveitar, cadastrar ou conferir. Com `paciente` (o
   * escolhido na busca), mostra antes de ligar o que diverge entre ele e o pré-cadastro.
   */
  async previaConversao(
    c: ContextoPorta,
    id: number,
    paciente?: number | null,
  ): Promise<{
    acao: string;
    paciente: number | null;
    codigo: string | null;
    mensagem: string | null;
    divergencias: string[];
    rascunho: Linha | null;
  }> {
    const est = this.estabelecimento(c);
    return this.ler(c, async (l) => {
      const k = await l.uma(
        `SELECT nome, DATE_FORMAT(data_nascimento, '%Y-%m-%d') AS nascimento, cpf, celular, telefone, email
           FROM pre_cadastro WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [id, est],
      );
      if (!k)
        throw new ErroOperacao(
          404,
          'nao-encontrado',
          'Pré-cadastro não encontrado',
          'Confira o pré-cadastro.',
        );
      const d = decidirConversao(
        { nascimento: String(k['nascimento']), nome: String(k['nome']), cpf: tx_(k['cpf']) },
        await pacientesDoCpf(l, tx_(k['cpf'])),
        paciente ? await pacienteEscolhido(l, paciente) : null,
      );
      return {
        acao: d.acao,
        paciente: d.acao === 'vincular' ? d.paciente : null,
        codigo: d.acao === 'recusar' ? d.codigo : null,
        mensagem: d.acao === 'recusar' ? d.mensagem : null,
        divergencias: d.acao === 'cadastrar' ? [] : [...(d.divergencias ?? [])],
        // Os dados que a ficha nova já recebe preenchidos (menos digitação na chegada).
        rascunho:
          d.acao === 'cadastrar'
            ? {
                nome: k['nome'],
                nascimento: k['nascimento'],
                cpf: k['cpf'],
                celular: k['celular'],
                telefone: k['telefone'],
                email: k['email'],
              }
            : null,
      };
    });
  }

  async converterPreCadastro(
    c: ContextoPorta,
    e: { id: number; paciente?: number | null; motivoDivergencia?: string | null },
    trilha: RegistroTrilhaTela,
    chave?: string,
  ): Promise<{ paciente: number; marcacoes: number; cobertura: number | null }> {
    const x = await this.executor.executar(
      operacaoConverterPreCadastro(trilha),
      this.cliente,
      { ...e, estabelecimento: this.estabelecimento(c) },
      this.contexto(c, trilha, chave),
    );
    const r = x.resultado as { paciente: number; marcacoes: number; cobertura: number | null };
    return { paciente: n(r.paciente), marcacoes: n(r.marcacoes), cobertura: nn(r.cobertura) };
  }

  async cancelarPreCadastro(
    c: ContextoPorta,
    e: { id: number; motivo: string },
    trilha: RegistroTrilhaTela,
    chave?: string,
  ): Promise<void> {
    await this.executor.executar(
      operacaoCancelarPreCadastro(trilha),
      this.cliente,
      { ...e, estabelecimento: this.estabelecimento(c) },
      this.contexto(c, trilha, chave),
    );
  }

  async registrarCaptacao(
    c: ContextoPorta,
    e: Omit<z.infer<typeof esquemaCaptacao>, 'estabelecimento' | 'usuario'>,
    trilha: RegistroTrilhaTela,
    chave?: string,
  ): Promise<number> {
    if (c.usuario === null)
      throw new ErroOperacao(403, 'sem-usuario', 'Sem usuário', 'A sessão não tem usuário do cliente.');
    const x = await this.executor.executar(
      operacaoRegistrarCaptacao(trilha),
      this.cliente,
      { ...e, estabelecimento: this.estabelecimento(c), usuario: c.usuario },
      this.contexto(c, trilha, chave),
    );
    return n(x.resultado.id);
  }

  async captacoesDoPaciente(c: ContextoPorta, paciente: number): Promise<CaptacaoDoPaciente[]> {
    return this.ler(c, async (l) => {
      const r = await l.consultar(
        `SELECT cp.id, cp.captado_em, cp.canal, cp.tipo_indicacao_id, ti.descricao, cp.campanha, cp.situacao,
                COALESCE(cp.indicador_nome, pr.nome_exibicao, pfp.nome, pfi.nome, pj.razao_social) AS indicador
           FROM captacao_paciente cp
           JOIN tipo_indicacao ti ON ti.id = cp.tipo_indicacao_id
           LEFT JOIN profissional pr ON pr.id = cp.indicador_profissional_id
           LEFT JOIN pessoa_fisica pfp ON pfp.id = pr.pessoa_fisica_id
           LEFT JOIN paciente pi ON pi.id = cp.indicador_paciente_id
           LEFT JOIN pessoa_fisica pfi ON pfi.id = pi.pessoa_fisica_id
           LEFT JOIN pessoa_juridica pj ON pj.id = cp.parceiro_pessoa_juridica_id
          WHERE cp.paciente_id = ? AND cp.excluido_em IS NULL
          ORDER BY cp.captado_em DESC, cp.id DESC LIMIT 100`,
        [paciente],
      );
      return r.map((x: Linha) => ({
        id: n(x['id']),
        captadoEm: x['captado_em'] instanceof Date ? x['captado_em'].toISOString() : String(x['captado_em']),
        canal: String(x['canal']),
        tipoIndicacao: { id: n(x['tipo_indicacao_id']), descricao: String(x['descricao']) },
        indicador: tx_(x['indicador']),
        campanha: tx_(x['campanha']),
        situacao: String(x['situacao']),
      }));
    });
  }

  /** Indicador por origem do estabelecimento no período [de, ate] (datas inclusivas). */
  async indicadorOrigem(c: ContextoPorta, de: string, ate: string): Promise<IndicadorOrigem> {
    const est = this.estabelecimento(c);
    return this.ler(c, async (l) => {
      const filtro = (a: string) =>
        `${a}.estabelecimento_id = ? AND ${a}.excluido_em IS NULL AND ${a}.situacao <> 'cancelada'
         AND ${a}.captado_em >= ? AND ${a}.captado_em < DATE_ADD(?, INTERVAL 1 DAY)`;
      const p = [est, de, ate];
      const canais = await l.consultar(
        `SELECT cp.canal, COUNT(*) AS total FROM captacao_paciente cp WHERE ${filtro('cp')} GROUP BY cp.canal`,
        p,
      );
      const tipos = await l.consultar(
        `SELECT ti.id, ti.descricao, COUNT(*) AS total FROM captacao_paciente cp
           JOIN tipo_indicacao ti ON ti.id = cp.tipo_indicacao_id
          WHERE ${filtro('cp')}
          GROUP BY ti.id, ti.descricao ORDER BY total DESC, ti.descricao`,
        p,
      );
      const porCanal = totaisPorCanal(
        canais.map((x: Linha) => ({ canal: String(x['canal']), total: n(x['total']) })),
      );
      return {
        de,
        ate,
        total: porCanal.reduce((s, x) => s + x.total, 0),
        porCanal,
        porTipo: tipos.map((x: Linha) => ({
          id: n(x['id']),
          descricao: String(x['descricao']),
          total: n(x['total']),
        })),
      };
    });
  }

  /** Opções dos formulários (uma chamada): fontes e planos ativos, tipos de indicação ativos, parentescos e canais. */
  async opcoes(c: ContextoPorta): Promise<OpcoesVinculos> {
    return this.ler(c, async (l) => {
      const fontes = await l.consultar(
        `SELECT id, nome, tipo, exige_validade_carteira FROM fonte_pagadora
          WHERE situacao = 'ativa' AND excluido_em IS NULL ORDER BY nome LIMIT 1000`,
      );
      const planos = await l.consultar(
        `SELECT id, fonte_pagadora_id, descricao FROM plano_fonte_pagadora
          WHERE situacao = 'ativo' AND excluido_em IS NULL ORDER BY descricao LIMIT 5000`,
      );
      const tipos = await l.consultar(
        'SELECT id, descricao, exige_profissional, exige_complemento FROM tipo_indicacao WHERE ativo ORDER BY descricao LIMIT 500',
      );
      const parentescos = await l.consultar(
        'SELECT id, descricao FROM tipo_parentesco WHERE ativo AND usado_em_dependente ORDER BY descricao LIMIT 200',
      );
      return {
        fontes: fontes.map((x: Linha) => ({
          id: n(x['id']),
          nome: String(x['nome']),
          particular: x['tipo'] === 'particular',
          exigeValidade: bool(x['exige_validade_carteira']),
        })),
        planos: planos.map((x: Linha) => ({
          id: n(x['id']),
          fontePagadora: n(x['fonte_pagadora_id']),
          descricao: String(x['descricao']),
        })),
        tiposIndicacao: tipos.map((x: Linha) => ({
          id: n(x['id']),
          descricao: String(x['descricao']),
          exigeProfissional: bool(x['exige_profissional']),
          exigeComplemento: bool(x['exige_complemento']),
        })),
        parentescos: parentescos.map((x: Linha) => ({ id: n(x['id']), descricao: String(x['descricao']) })),
        canais: [...CANAIS_CAPTACAO],
      };
    });
  }
}
