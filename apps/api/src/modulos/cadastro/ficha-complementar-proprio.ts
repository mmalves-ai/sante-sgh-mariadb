// Ficha complementar do paciente no banco próprio (F3.1, 02-CAD linhas 2, 3 e 4):
//   - regras de campo do cadastro (`regra_campo_cadastro`): manter e aplicar no cadastrar/alterar paciente e na
//     conferência para a abertura do atendimento (campos pendentes por módulo, tipo de atendimento e fonte pagadora);
//   - contatos da pessoa (`endereco_pessoa`, `telefone_pessoa`, `email_pessoa`): vários por tipo, um principal por
//     espécie, vigência do endereço, aceite de comunicação (LGPD);
//   - responsáveis do paciente (`responsavel_paciente`): pessoa única pelo CPF, parentesco, papel, poderes, vigência,
//     comprovante e as pendências de representação (menor e incapaz).
// A regra é a do domínio (@sgh/dominio-cadastro); aqui só leitura, gravação e trilha. Toda gravação é uma operação do
// executor (trilha e idempotência na transação). Nada se apaga: o endereço e o vínculo encerram a vigência; o
// telefone e o e-mail saem de uso com a marca de exclusão lógica; a regra de campo é inativada.
import { randomUUID } from 'node:crypto';
import {
  camposRecusados,
  cpfValido,
  errosDaRegra,
  errosEmail,
  errosEndereco,
  errosResponsavel,
  errosTelefone,
  EXIGENCIAS_CAMPO,
  pendenciasRepresentacao,
  principalDepois,
  recusaEncerramento,
  type RegraCampo,
  sucessorDoPrincipal,
  TIPOS_ATENDIMENTO_REGRA,
  type TipoAtendimentoRegra,
  vigenteEm,
  PAPEIS_RESPONSAVEL,
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

export const FICHA_COMPLEMENTAR = Symbol('FICHA_COMPLEMENTAR');

const TETO = 500;
const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const data = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1';

const ontemDe = (hoje: string): string =>
  data(new Date(new Date(`${hoje}T12:00:00`).getTime() - 86_400_000))!;

/** Data civil de hoje no relógio do banco. */
async function hojeDe(x: Leitor | TxOperacao): Promise<string> {
  const r = await x.uma<{ d: unknown }>('SELECT CURRENT_DATE AS d', []);
  return data(r?.d) ?? new Date().toISOString().slice(0, 10);
}

function recusaCampos(codigo: string, detalhe: string, campos: readonly string[]): ErroOperacao {
  return recusa(codigo, detalhe, { campos: [...campos] });
}

async function pacienteDe(
  tx: Leitor | TxOperacao,
  paciente: number,
): Promise<{ pessoa: number; nascimento: string | null }> {
  const p = await tx.uma(
    `SELECT p.pessoa_fisica_id, pf.data_nascimento FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
      WHERE p.id = ? AND p.excluido_em IS NULL`,
    [paciente],
  );
  if (!p) throw recusa('paciente-inexistente', 'O paciente não existe.', { campos: ['idPaciente'] });
  return { pessoa: Number(p['pessoa_fisica_id']), nascimento: data(p['data_nascimento']) };
}

async function proximaSequencia(tx: TxOperacao, tabela: string, pessoa: number): Promise<number> {
  const x = await tx.uma<{ n: unknown }>(
    `SELECT COALESCE(MAX(sequencia), 0) + 1 AS n FROM ${tabela} WHERE pessoa_fisica_id = ?`,
    [pessoa],
  );
  return Number(x?.n ?? 1);
}

/** Ajusta o principal da espécie de contato depois de incluir ou escolher (um só por pessoa). */
async function ajustarPrincipal(
  tx: TxOperacao,
  tabela: 'endereco_pessoa' | 'telefone_pessoa' | 'email_pessoa',
  pessoa: number,
  novo: { id: number; principal: boolean },
): Promise<void> {
  const vig =
    tabela === 'endereco_pessoa' ? ' AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)' : '';
  const ativos = await tx.consultar(
    `SELECT id, principal, versao FROM ${tabela} WHERE pessoa_fisica_id = ? AND excluido_em IS NULL${vig}`,
    [pessoa],
  );
  const lista = ativos.map((a) => ({
    id: Number(a['id']),
    principal: bool(a['principal']),
    versao: Number(a['versao']),
  }));
  const d = principalDepois(lista, novo);
  for (const id of d.desmarcar) {
    const a = lista.find((x) => x.id === id)!;
    await tx.alterar(tabela, id, a.versao, { principal: false });
  }
  const alvo = lista.find((x) => x.id === d.principal);
  if (alvo && !alvo.principal) await tx.alterar(tabela, alvo.id, alvo.versao, { principal: true });
}

// ── Regras de campo ──

const esquemaRegra = z
  .object({
    estabelecimento: z.number().int().positive().nullable(),
    campo: z.string().min(1).max(64),
    modulo: z.number().int().positive().nullable(),
    tipoAtendimento: z.enum(TIPOS_ATENDIMENTO_REGRA),
    fontePagadora: z.number().int().positive().nullable(),
    exigencia: z.enum(EXIGENCIAS_CAMPO),
    rotulo: z.string().trim().max(150).nullable(),
  })
  .strict();
export type EntradaRegraCampo = z.infer<typeof esquemaRegra>;

const operacaoGravarRegra = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.gravar-regra-campo',
    tabelas: ['regra_campo_cadastro'],
    entrada: esquemaRegra,
    acao: 'inclusao',
    async gravar(tx, e) {
      const erros = errosDaRegra(e);
      if (erros.length)
        throw recusaCampos(
          'regra-invalida',
          erros.includes('campo-fixo')
            ? 'Este campo é sempre exigido pelo cadastro: só pode ser obrigatório ou somente leitura.'
            : 'Confira o campo, a exigência e o tipo de atendimento da regra.',
          ['campo', 'exigencia', 'tipoAtendimento'],
        );
      if (e.modulo !== null && !(await tx.uma('SELECT id FROM modulo_recepcao WHERE id = ?', [e.modulo])))
        throw recusaCampos('modulo-inexistente', 'O módulo de recepção não existe.', ['modulo']);
      if (
        e.fontePagadora !== null &&
        !(await tx.uma('SELECT id FROM fonte_pagadora WHERE id = ?', [e.fontePagadora]))
      )
        throw recusaCampos('fonte-inexistente', 'A fonte pagadora não existe.', ['fontePagadora']);
      const ja = await tx.uma(
        `SELECT id, versao FROM regra_campo_cadastro
          WHERE estabelecimento_id <=> ? AND entidade = 'paciente' AND campo = ? AND modulo_recepcao_id <=> ?
            AND tipo_atendimento = ? AND fonte_pagadora_id <=> ?`,
        [e.estabelecimento, e.campo, e.modulo, e.tipoAtendimento, e.fontePagadora],
      );
      const valores = { exigencia: e.exigencia, rotulo: e.rotulo || null, ativo: true };
      if (ja) {
        await tx.alterar('regra_campo_cadastro', Number(ja['id']), Number(ja['versao']), valores);
        return { id: Number(ja['id']) };
      }
      const id = await tx.incluir('regra_campo_cadastro', {
        estabelecimento_id: e.estabelecimento,
        entidade: 'paciente',
        campo: e.campo,
        modulo_recepcao_id: e.modulo,
        tipo_atendimento: e.tipoAtendimento,
        fonte_pagadora_id: e.fontePagadora,
        ...valores,
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'regra_campo_cadastro', id: Number(r.id) }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

const esquemaId = z.object({ id: z.number().int().positive(), versao: z.number().int().positive() }).strict();

const operacaoInativarRegra = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.inativar-regra-campo',
    tabelas: ['regra_campo_cadastro'],
    entrada: esquemaId,
    acao: 'alteracao',
    async gravar(tx, e) {
      await tx.alterar('regra_campo_cadastro', e.id, e.versao, { ativo: false });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'regra_campo_cadastro', id: e.id }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

// ── Contatos ──

const esquemaEndereco = z
  .object({
    paciente: z.number().int().positive(),
    tipo: z.number().int().positive(),
    cep: z.string().regex(/^\d{8}$/),
    logradouro: z.string().trim().max(150).nullable(),
    numero: z.string().trim().max(10).nullable(),
    semNumero: z.boolean(),
    complemento: z.string().trim().max(100).nullable(),
    bairro: z.string().trim().max(100).nullable(),
    pontoReferencia: z.string().trim().max(150).nullable(),
    principal: z.boolean(),
    vigenciaInicio: z.string().nullable(),
    vigenciaFim: z.string().nullable(),
  })
  .strict();
export type EntradaEndereco = z.infer<typeof esquemaEndereco>;

const operacaoIncluirEndereco = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.incluir-endereco-pessoa',
    tabelas: ['endereco_pessoa'],
    entrada: esquemaEndereco,
    acao: 'inclusao',
    async gravar(tx, e) {
      const erros = errosEndereco(e);
      if (erros.length) throw recusaCampos('endereco-invalido', 'Confira os campos do endereço.', erros);
      const { pessoa } = await pacienteDe(tx, e.paciente);
      if (!(await tx.uma('SELECT id FROM tipo_endereco WHERE id = ? AND ativo', [e.tipo])))
        throw recusaCampos('tipo-inexistente', 'Tipo de endereço inexistente ou inativo.', ['tipo']);
      const c = await tx.uma(
        `SELECT lc.id, lc.logradouro, lc.especie_logradouro_id, lc.bairro_id, lc.municipio_ibge_id
           FROM logradouro_cep lc WHERE lc.codigo_cep = ? AND lc.ativo`,
        [e.cep],
      );
      if (!c)
        throw recusaCampos('cep-inexistente', 'CEP não encontrado no cadastro de CEPs. Confira o CEP.', [
          'cep',
        ]);
      const logradouro = e.logradouro || texto(c['logradouro']);
      if (!logradouro) throw recusaCampos('endereco-invalido', 'Informe o logradouro.', ['logradouro']);
      const id = await tx.incluir('endereco_pessoa', {
        pessoa_fisica_id: pessoa,
        sequencia: await proximaSequencia(tx, 'endereco_pessoa', pessoa),
        tipo_endereco_id: e.tipo,
        cep: e.cep,
        logradouro_cep_id: Number(c['id']),
        especie_logradouro_id: num(c['especie_logradouro_id']),
        logradouro,
        numero: e.semNumero ? null : e.numero,
        sem_numero: e.semNumero,
        complemento: e.complemento || null,
        bairro_id: e.bairro ? null : num(c['bairro_id']),
        bairro_nome: e.bairro || null,
        municipio_ibge_id: Number(c['municipio_ibge_id']),
        ponto_referencia: e.pontoReferencia || null,
        principal: false,
        vigencia_inicio: e.vigenciaInicio ?? (await hojeDe(tx)),
        vigencia_fim: e.vigenciaFim,
      });
      await ajustarPrincipal(tx, 'endereco_pessoa', pessoa, { id, principal: e.principal });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'endereco_pessoa', id: Number(r.id) }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

const esquemaTelefone = z
  .object({
    paciente: z.number().int().positive(),
    tipo: z.number().int().positive(),
    ddi: z.string().regex(/^\d{1,4}$/),
    ddd: z.string().nullable(),
    numero: z.string(),
    ramal: z.string().trim().max(10).nullable(),
    nomeContato: z.string().trim().max(150).nullable(),
    principal: z.boolean(),
    aceitaMensagem: z.boolean(),
    usaAplicativoMensagem: z.boolean(),
  })
  .strict();
export type EntradaTelefone = z.infer<typeof esquemaTelefone>;

const operacaoIncluirTelefone = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.incluir-telefone-pessoa',
    tabelas: ['telefone_pessoa'],
    entrada: esquemaTelefone,
    acao: 'inclusao',
    async gravar(tx, e) {
      const { pessoa } = await pacienteDe(tx, e.paciente);
      const t = await tx.uma('SELECT permite_mensagem, recado FROM tipo_telefone WHERE id = ? AND ativo', [
        e.tipo,
      ]);
      if (!t) throw recusaCampos('tipo-inexistente', 'Tipo de telefone inexistente ou inativo.', ['tipo']);
      const erros = errosTelefone({
        ...e,
        tipoPermiteMensagem: bool(t['permite_mensagem']),
        tipoRecado: bool(t['recado']),
      });
      if (erros.length) throw recusaCampos('telefone-invalido', 'Confira os campos do telefone.', erros);
      const id = await tx.incluir('telefone_pessoa', {
        pessoa_fisica_id: pessoa,
        sequencia: await proximaSequencia(tx, 'telefone_pessoa', pessoa),
        tipo_telefone_id: e.tipo,
        ddi: e.ddi,
        ddd: e.ddd,
        numero: e.numero,
        ramal: e.ramal || null,
        nome_contato: e.nomeContato || null,
        principal: false,
        aceita_mensagem: e.aceitaMensagem,
        aceita_mensagem_em: e.aceitaMensagem ? new Date() : null,
        usa_aplicativo_mensagem: e.usaAplicativoMensagem,
      });
      await ajustarPrincipal(tx, 'telefone_pessoa', pessoa, { id, principal: e.principal });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'telefone_pessoa', id: Number(r.id) }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

const esquemaEmail = z
  .object({
    paciente: z.number().int().positive(),
    email: z.string().trim().toLowerCase().max(254),
    finalidade: z.string(),
    principal: z.boolean(),
    aceitaComunicacao: z.boolean(),
    aceiteDeclarado: z.boolean(),
  })
  .strict();
export type EntradaEmail = z.infer<typeof esquemaEmail>;

const operacaoIncluirEmail = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.incluir-email-pessoa',
    tabelas: ['email_pessoa'],
    entrada: esquemaEmail,
    acao: 'inclusao',
    async gravar(tx, e) {
      const erros = errosEmail(e);
      if (erros.length)
        throw recusaCampos('email-invalido', 'Confira o e-mail, a finalidade e o aceite.', erros);
      const { pessoa } = await pacienteDe(tx, e.paciente);
      const ja = await tx.uma(
        'SELECT id, excluido_em FROM email_pessoa WHERE pessoa_fisica_id = ? AND email = ?',
        [pessoa, e.email],
      );
      if (ja)
        throw recusaCampos(
          'email-repetido',
          ja['excluido_em'] ? 'Este e-mail já foi da pessoa e saiu de uso.' : 'A pessoa já tem este e-mail.',
          ['email'],
        );
      const id = await tx.incluir('email_pessoa', {
        pessoa_fisica_id: pessoa,
        sequencia: await proximaSequencia(tx, 'email_pessoa', pessoa),
        email: e.email,
        finalidade: e.finalidade,
        principal: false,
        aceita_comunicacao: e.aceitaComunicacao,
        observacao: e.aceitaComunicacao ? 'Aceite de comunicação declarado pelo titular no cadastro' : null,
      });
      await ajustarPrincipal(tx, 'email_pessoa', pessoa, { id, principal: e.principal });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'email_pessoa', id: Number(r.id) }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

const ESPECIES = { endereco: 'endereco_pessoa', telefone: 'telefone_pessoa', email: 'email_pessoa' } as const;
export type EspecieContato = keyof typeof ESPECIES;

const esquemaAcaoContato = z
  .object({
    paciente: z.number().int().positive(),
    especie: z.enum(['endereco', 'telefone', 'email']),
    id: z.number().int().positive(),
    acao: z.enum(['principal', 'encerrar']),
  })
  .strict();

const operacaoAcaoContato = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.ajustar-contato-pessoa',
    tabelas: ['endereco_pessoa', 'telefone_pessoa', 'email_pessoa'],
    entrada: esquemaAcaoContato,
    acao: 'alteracao',
    async gravar(tx, e) {
      const tabela = ESPECIES[e.especie];
      const { pessoa } = await pacienteDe(tx, e.paciente);
      const vig =
        e.especie === 'endereco' ? ' AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)' : '';
      const alvo = await tx.uma(
        `SELECT id, versao, principal FROM ${tabela} WHERE id = ? AND pessoa_fisica_id = ? AND excluido_em IS NULL${vig}`,
        [e.id, pessoa],
      );
      if (!alvo) throw recusaCampos('contato-inexistente', 'O contato não existe ou já saiu de uso.', ['id']);
      if (e.acao === 'principal') {
        await ajustarPrincipal(tx, tabela, pessoa, { id: e.id, principal: true });
        return { id: e.id };
      }
      const ativos = await tx.consultar(
        `SELECT id, principal, versao FROM ${tabela} WHERE pessoa_fisica_id = ? AND excluido_em IS NULL${vig}`,
        [pessoa],
      );
      const lista = ativos.map((a) => ({
        id: Number(a['id']),
        principal: bool(a['principal']),
        versao: Number(a['versao']),
      }));
      const sucessor = sucessorDoPrincipal(lista, e.id);
      if (e.especie === 'endereco') {
        // Encerra a vigência ontem (o endereço deixa de valer hoje); a linha fica.
        const hoje = await hojeDe(tx);
        const ontem = ontemDe(hoje);
        const ini = await tx.uma('SELECT vigencia_inicio FROM endereco_pessoa WHERE id = ?', [e.id]);
        const inicio = data(ini?.['vigencia_inicio']);
        await tx.alterar(tabela, e.id, Number(alvo['versao']), {
          principal: false,
          vigencia_fim: inicio && inicio > ontem ? inicio : ontem,
        });
      } else {
        await tx.alterar(tabela, e.id, Number(alvo['versao']), {
          principal: false,
          excluido_em: new Date(),
          excluido_por: tx.contexto.usuario,
        });
      }
      if (sucessor !== null) {
        const s = lista.find((x) => x.id === sucessor)!;
        await tx.alterar(tabela, s.id, s.versao, { principal: true });
      }
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: ESPECIES[e.especie], id: e.id }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

// ── Responsáveis ──

const esquemaResponsavel = z
  .object({
    paciente: z.number().int().positive(),
    cpf: z.string().regex(/^\d{11}$/),
    nome: z.string().trim().min(3).max(150).nullable(),
    nascimento: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    papel: z.enum(PAPEIS_RESPONSAVEL),
    parentesco: z.number().int().positive().nullable(),
    autorizarProcedimento: z.boolean(),
    receberInformacao: z.boolean(),
    retirarDocumento: z.boolean(),
    contatoPrincipal: z.boolean(),
    prioridadeContato: z.number().int().min(1).max(99).nullable(),
    vigenciaInicio: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    vigenciaFim: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    comprovante: z.number().int().positive().nullable(),
    observacao: z.string().trim().max(500).nullable(),
  })
  .strict();
export type EntradaResponsavel = z.infer<typeof esquemaResponsavel>;

const PAPEIS_SQL = PAPEIS_RESPONSAVEL.map(() => '?').join(', ');

async function vigentesDe(tx: Leitor | TxOperacao, paciente: number) {
  const v = await tx.consultar(
    `SELECT id, papel, versao, comprovante_arquivo_id, vigencia_inicio FROM responsavel_paciente
      WHERE paciente_id = ? AND excluido_em IS NULL AND papel IN (${PAPEIS_SQL})
        AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`,
    [paciente, ...PAPEIS_RESPONSAVEL],
    { teto: TETO },
  );
  return v.map((x) => ({
    id: Number(x['id']),
    papel: String(x['papel']),
    versao: Number(x['versao']),
    temComprovante: x['comprovante_arquivo_id'] !== null && x['comprovante_arquivo_id'] !== undefined,
    inicio: data(x['vigencia_inicio']),
  }));
}

const operacaoIncluirResponsavel = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.incluir-responsavel-paciente',
    tabelas: ['responsavel_paciente', 'pessoa_fisica'],
    entrada: esquemaResponsavel,
    acao: 'inclusao',
    async gravar(tx, e) {
      if (!cpfValido(e.cpf)) throw recusaCampos('cpf-invalido', 'CPF do responsável inválido.', ['cpf']);
      const p = await pacienteDe(tx, e.paciente);
      const hoje = await hojeDe(tx);
      // Pessoa única pelo CPF: reaproveita a já cadastrada; sem ela, cria com nome e nascimento.
      const ja = await tx.uma(
        'SELECT id, data_nascimento FROM pessoa_fisica WHERE cpf = ? AND excluido_em IS NULL',
        [e.cpf],
      );
      if (!ja && !e.nome)
        throw recusaCampos(
          'pessoa-nova-sem-nome',
          'CPF ainda não cadastrado: informe o nome do responsável.',
          ['nome'],
        );
      const nascimento = ja ? data(ja['data_nascimento']) : e.nascimento;
      const inicio = e.vigenciaInicio ?? hoje;
      const erros = errosResponsavel(
        {
          papel: e.papel,
          poderes: e,
          vigenciaInicio: inicio,
          vigenciaFim: e.vigenciaFim,
          nascimentoResponsavel: nascimento,
          mesmaPessoaDoPaciente: ja !== null && Number(ja['id']) === p.pessoa,
        },
        hoje,
      );
      if (erros.length)
        throw recusaCampos(
          'responsavel-invalido',
          erros.includes('mesma-pessoa')
            ? 'O responsável não pode ser o próprio paciente.'
            : erros.includes('representante-menor')
              ? 'Quem representa o paciente precisa ser maior de idade.'
              : erros.includes('autorizarProcedimento')
                ? 'Só o representante legal (responsável legal, guardião, tutor ou curador) autoriza procedimento.'
                : 'Confira o papel e a vigência do responsável.',
          erros,
        );
      if (
        e.parentesco !== null &&
        !(await tx.uma('SELECT id FROM tipo_parentesco WHERE id = ? AND ativo', [e.parentesco]))
      )
        throw recusaCampos('parentesco-inexistente', 'Parentesco inexistente ou inativo.', ['parentesco']);
      const pessoa = ja
        ? Number(ja['id'])
        : await tx.incluir('pessoa_fisica', { nome: e.nome, cpf: e.cpf, data_nascimento: e.nascimento });
      const repetido = await tx.uma(
        `SELECT id FROM responsavel_paciente WHERE paciente_id = ? AND pessoa_fisica_id = ? AND papel = ?
            AND excluido_em IS NULL AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
        [e.paciente, pessoa, e.papel, inicio],
      );
      if (repetido)
        throw recusaCampos('responsavel-repetido', 'Esta pessoa já tem este papel vigente para o paciente.', [
          'papel',
        ]);
      const id = await tx.incluir('responsavel_paciente', {
        paciente_id: e.paciente,
        pessoa_fisica_id: pessoa,
        papel: e.papel,
        tipo_parentesco_id: e.parentesco,
        pode_autorizar_procedimento: e.autorizarProcedimento,
        pode_receber_informacao: e.receberInformacao,
        pode_retirar_documento: e.retirarDocumento,
        contato_principal: e.contatoPrincipal,
        prioridade_contato: e.prioridadeContato,
        vigencia_inicio: inicio,
        vigencia_fim: e.vigenciaFim,
        comprovante_arquivo_id: e.comprovante,
        observacao: e.observacao || null,
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'responsavel_paciente', id: Number(r.id) }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

const esquemaEncerrar = z
  .object({
    paciente: z.number().int().positive(),
    id: z.number().int().positive(),
    levantamentoCuratela: z.boolean(),
    motivo: z.string().trim().min(3).max(300),
  })
  .strict();

const operacaoEncerrarResponsavel = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.encerrar-responsavel-paciente',
    tabelas: ['responsavel_paciente'],
    entrada: esquemaEncerrar,
    acao: 'alteracao',
    async gravar(tx, e) {
      const p = await pacienteDe(tx, e.paciente);
      const hoje = await hojeDe(tx);
      const vigentes = await vigentesDe(tx, e.paciente);
      const alvo = vigentes.find((v) => v.id === e.id);
      if (!alvo)
        throw recusaCampos('vinculo-inexistente', 'O vínculo não existe ou já foi encerrado.', ['id']);
      const r = recusaEncerramento(p.nascimento, vigentes, e.id, hoje, e.levantamentoCuratela);
      if (r === 'menor-sem-representante')
        throw recusaCampos(
          r,
          'Paciente menor de idade não fica sem representante: inclua o novo responsável antes de encerrar este.',
          ['id'],
        );
      if (r === 'incapaz-sem-curador')
        throw recusaCampos(
          r,
          'Paciente sob curatela não fica sem curador: inclua o novo curador ou declare o levantamento da curatela.',
          ['levantamentoCuratela'],
        );
      const atual = await tx.uma('SELECT observacao FROM responsavel_paciente WHERE id = ?', [e.id]);
      const obs = [texto(atual?.['observacao']), `Encerrado: ${e.motivo}`]
        .filter(Boolean)
        .join(' | ')
        .slice(0, 500);
      await tx.alterar('responsavel_paciente', e.id, alvo.versao, {
        // Deixa de valer hoje (fim ontem); o vínculo começado hoje fica com o fim no próprio início.
        vigencia_fim: alvo.inicio && alvo.inicio >= ontemDe(hoje) ? alvo.inicio : ontemDe(hoje),
        observacao: obs,
      });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'responsavel_paciente', id: e.id }),
    trilha: (e) => ({ dados: trilha.dadosDepois ?? null, motivo: e.motivo }),
  });

// ── Leituras ──

export interface RegraCampoLida extends RegraCampo {
  readonly id: number;
  readonly versao: number;
  readonly ativo: boolean;
}

export interface ContatosPessoa {
  enderecos: {
    id: number;
    tipo: string;
    cep: string | null;
    logradouro: string;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    principal: boolean;
    vigenciaInicio: string | null;
    vigenciaFim: string | null;
    vigente: boolean;
  }[];
  telefones: {
    id: number;
    tipo: string;
    ddi: string;
    ddd: string | null;
    numero: string;
    nomeContato: string | null;
    principal: boolean;
    aceitaMensagem: boolean;
    ativo: boolean;
  }[];
  emails: {
    id: number;
    email: string;
    finalidade: string;
    principal: boolean;
    aceitaComunicacao: boolean;
    ativo: boolean;
  }[];
}

export interface ResponsaveisPaciente {
  itens: {
    id: number;
    nome: string;
    cpfFinal: string | null;
    papel: string;
    parentesco: string | null;
    autorizarProcedimento: boolean;
    receberInformacao: boolean;
    retirarDocumento: boolean;
    contatoPrincipal: boolean;
    vigenciaInicio: string | null;
    vigenciaFim: string | null;
    vigente: boolean;
    temComprovante: boolean;
  }[];
  pendencias: { pendencia: string; vinculo: number | null }[];
}

export class FichaComplementarPropria {
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
    trilha: RegistroTrilhaTela,
  ): Promise<number> {
    const est = await this.estabelecimento(c);
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: trilha.estabelecimento ?? est,
      usuario: trilha.usuario ?? c.usuario,
      correlacao: (trilha.correlacao ?? c.correlacao).slice(0, 64) || 'cadastro',
      chaveIdempotencia: `direta:${randomUUID()}`,
    };
    const x = await this.executor.executar(op, this.cliente, entrada, ctx);
    return Number((x.resultado as { id: unknown }).id);
  }

  // Regras de campo
  async regrasCampo(c: ContextoPorta, inativas = false): Promise<RegraCampoLida[]> {
    const est = await this.estabelecimento(c);
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT id, estabelecimento_id, campo, modulo_recepcao_id, tipo_atendimento, fonte_pagadora_id, exigencia, rotulo,
                ativo, versao
           FROM regra_campo_cadastro
          WHERE entidade = 'paciente' AND (estabelecimento_id IS NULL OR estabelecimento_id = ?) ${inativas ? '' : 'AND ativo'}
          ORDER BY campo, id`,
        [est],
        { teto: TETO },
      );
      return linhas.map((x) => ({
        id: Number(x['id']),
        versao: Number(x['versao']),
        campo: String(x['campo']),
        estabelecimento: num(x['estabelecimento_id']),
        modulo: num(x['modulo_recepcao_id']),
        tipoAtendimento: String(x['tipo_atendimento']) as TipoAtendimentoRegra,
        fontePagadora: num(x['fonte_pagadora_id']),
        exigencia: String(x['exigencia']) as RegraCampo['exigencia'],
        rotulo: texto(x['rotulo']),
        ativo: bool(x['ativo']),
      }));
    });
  }

  gravarRegraCampo(c: ContextoPorta, e: EntradaRegraCampo, trilha: RegistroTrilhaTela): Promise<number> {
    return this.executar(c, operacaoGravarRegra(trilha) as never, e, trilha);
  }

  inativarRegraCampo(
    c: ContextoPorta,
    id: number,
    versao: number,
    trilha: RegistroTrilhaTela,
  ): Promise<number> {
    return this.executar(c, operacaoInativarRegra(trilha) as never, { id, versao }, trilha);
  }

  /** Recusa (422, com os campos) quando a gravação do cadastro fere a regra de campo do escopo. */
  async conferirCampos(
    c: ContextoPorta,
    dados: Readonly<Record<string, unknown>>,
    modo: 'cadastro' | 'alteracao',
    escopo: {
      modulo?: number | null;
      tipoAtendimento?: TipoAtendimentoRegra | null;
      fontePagadora?: number | null;
    } = {},
  ): Promise<void> {
    const est = await this.estabelecimento(c);
    const fora = camposRecusados(await this.regrasCampo(c), { estabelecimento: est, ...escopo }, dados, modo);
    if (fora.length === 0) return;
    const obrig = fora.filter((f) => f.motivo === 'obrigatorio').map((f) => f.rotulo);
    const leitura = fora.filter((f) => f.motivo === 'somente_leitura').map((f) => f.rotulo);
    throw recusaCampos(
      'campos-exigidos',
      [
        obrig.length ? `Preencha: ${obrig.join(', ')}.` : '',
        leitura.length ? `Não podem ser alterados: ${leitura.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      fora.map((f) => f.campo),
    );
  }

  /** Os dados atuais do cadastro nos nomes dos campos da regra (para a conferência da abertura do atendimento). */
  async dadosDoCadastro(c: ContextoPorta, paciente: number): Promise<Record<string, unknown>> {
    return this.ler(c, async (l) => {
      const p = await l.uma(
        `SELECT pf.id, pf.nome, pf.data_nascimento, pf.sexo_id, pf.cpf, pf.nome_mae, pf.naturalidade_municipio_ibge_id
           FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE p.id = ? AND p.excluido_em IS NULL`,
        [paciente],
      );
      if (!p) throw recusa('paciente-inexistente', 'O paciente não existe.', { campos: ['idPaciente'] });
      const pessoa = Number(p['id']);
      const en = await l.uma(
        `SELECT cep, logradouro, numero, sem_numero, complemento, COALESCE(bairro_nome, CAST(bairro_id AS CHAR)) AS bairro
           FROM endereco_pessoa WHERE pessoa_fisica_id = ? AND excluido_em IS NULL
            AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE) ORDER BY principal DESC, id LIMIT 1`,
        [pessoa],
      );
      const tel = await l.consultar(
        `SELECT tt.movel, tt.recado, t.numero, t.nome_contato FROM telefone_pessoa t JOIN tipo_telefone tt ON tt.id = t.tipo_telefone_id
          WHERE t.pessoa_fisica_id = ? AND t.excluido_em IS NULL`,
        [pessoa],
        { teto: TETO },
      );
      const em = await l.uma(
        'SELECT email FROM email_pessoa WHERE pessoa_fisica_id = ? AND excluido_em IS NULL LIMIT 1',
        [pessoa],
      );
      const recado = tel.find((t) => bool(t['recado']));
      return {
        nome: texto(p['nome']),
        nascimento: data(p['data_nascimento']),
        sexo: num(p['sexo_id']),
        cpf: texto(p['cpf']),
        nomeMae: texto(p['nome_mae']),
        naturalidade: num(p['naturalidade_municipio_ibge_id']),
        cep: texto(en?.['cep']),
        logradouro: texto(en?.['logradouro']),
        numero: en && bool(en['sem_numero']) ? 'SN' : texto(en?.['numero']),
        complemento: texto(en?.['complemento']),
        bairro: texto(en?.['bairro']),
        celular: texto(tel.find((t) => bool(t['movel']) && !bool(t['recado']))?.['numero']),
        telefone: texto(tel.find((t) => !bool(t['movel']) && !bool(t['recado']))?.['numero']),
        email: texto(em?.['email']),
        contatoNome: texto(recado?.['nome_contato']),
        contatoTelefone: texto(recado?.['numero']),
      };
    });
  }

  /** Campos que faltam no cadastro do paciente para abrir o atendimento no escopo (lista vazia: pode abrir). */
  async camposPendentes(
    c: ContextoPorta,
    paciente: number,
    escopo: {
      modulo: number | null;
      tipoAtendimento: TipoAtendimentoRegra | null;
      fontePagadora: number | null;
    },
  ): Promise<{ campo: string; rotulo: string }[]> {
    const est = await this.estabelecimento(c);
    const dados = await this.dadosDoCadastro(c, paciente);
    return camposRecusados(
      await this.regrasCampo(c),
      { estabelecimento: est, ...escopo },
      dados,
      'cadastro',
    ).map(({ campo, rotulo }) => ({ campo, rotulo }));
  }

  // Contatos
  async contatos(c: ContextoPorta, paciente: number): Promise<ContatosPessoa> {
    return this.ler(c, async (l) => {
      const { pessoa } = await pacienteDe(l, paciente);
      const hoje = await hojeDe(l);
      const en = await l.consultar(
        `SELECT e.id, te.descricao AS tipo, e.cep, e.logradouro, e.numero, e.complemento,
                COALESCE(e.bairro_nome, b.descricao) AS bairro, e.principal, e.vigencia_inicio, e.vigencia_fim
           FROM endereco_pessoa e JOIN tipo_endereco te ON te.id = e.tipo_endereco_id LEFT JOIN bairro b ON b.id = e.bairro_id
          WHERE e.pessoa_fisica_id = ? AND e.excluido_em IS NULL ORDER BY e.principal DESC, e.id DESC`,
        [pessoa],
        { teto: TETO },
      );
      const te = await l.consultar(
        `SELECT t.id, tt.descricao AS tipo, t.ddi, t.ddd, t.numero, t.nome_contato, t.principal, t.aceita_mensagem, t.excluido_em
           FROM telefone_pessoa t JOIN tipo_telefone tt ON tt.id = t.tipo_telefone_id
          WHERE t.pessoa_fisica_id = ? ORDER BY t.excluido_em IS NOT NULL, t.principal DESC, t.id DESC`,
        [pessoa],
        { teto: TETO },
      );
      const em = await l.consultar(
        `SELECT id, email, finalidade, principal, aceita_comunicacao, excluido_em FROM email_pessoa
          WHERE pessoa_fisica_id = ? ORDER BY excluido_em IS NOT NULL, principal DESC, id DESC`,
        [pessoa],
        { teto: TETO },
      );
      return {
        enderecos: en.map((x) => {
          const vigenciaInicio = data(x['vigencia_inicio']);
          const vigenciaFim = data(x['vigencia_fim']);
          return {
            id: Number(x['id']),
            tipo: String(x['tipo']),
            cep: texto(x['cep']),
            logradouro: String(x['logradouro']),
            numero: texto(x['numero']),
            complemento: texto(x['complemento']),
            bairro: texto(x['bairro']),
            principal: bool(x['principal']),
            vigenciaInicio,
            vigenciaFim,
            vigente: vigenteEm({ vigenciaInicio, vigenciaFim }, hoje),
          };
        }),
        telefones: te.map((x) => ({
          id: Number(x['id']),
          tipo: String(x['tipo']),
          ddi: String(x['ddi']),
          ddd: texto(x['ddd']),
          numero: String(x['numero']),
          nomeContato: texto(x['nome_contato']),
          principal: bool(x['principal']),
          aceitaMensagem: bool(x['aceita_mensagem']),
          ativo: x['excluido_em'] === null || x['excluido_em'] === undefined,
        })),
        emails: em.map((x) => ({
          id: Number(x['id']),
          email: String(x['email']),
          finalidade: String(x['finalidade']),
          principal: bool(x['principal']),
          aceitaComunicacao: bool(x['aceita_comunicacao']),
          ativo: x['excluido_em'] === null || x['excluido_em'] === undefined,
        })),
      };
    });
  }

  /** Os tipos de endereço, de telefone e de parentesco ativos (listas da tela). */
  async tipos(
    c: ContextoPorta,
  ): Promise<Record<'endereco' | 'telefone' | 'parentesco', { id: number; descricao: string }[]>> {
    return this.ler(c, async (l) => {
      const lista = async (t: string, extra = '') =>
        (
          await l.consultar(`SELECT id, descricao FROM ${t} WHERE ativo ${extra} ORDER BY descricao`, [], {
            teto: TETO,
          })
        ).map((x) => ({ id: Number(x['id']), descricao: String(x['descricao']) }));
      return {
        endereco: await lista('tipo_endereco'),
        telefone: await lista('tipo_telefone'),
        parentesco: await lista('tipo_parentesco', 'AND usado_em_responsavel'),
      };
    });
  }

  incluirEndereco(c: ContextoPorta, e: EntradaEndereco, t: RegistroTrilhaTela): Promise<number> {
    return this.executar(c, operacaoIncluirEndereco(t) as never, e, t);
  }
  incluirTelefone(c: ContextoPorta, e: EntradaTelefone, t: RegistroTrilhaTela): Promise<number> {
    return this.executar(c, operacaoIncluirTelefone(t) as never, e, t);
  }
  incluirEmail(c: ContextoPorta, e: EntradaEmail, t: RegistroTrilhaTela): Promise<number> {
    return this.executar(c, operacaoIncluirEmail(t) as never, e, t);
  }
  ajustarContato(
    c: ContextoPorta,
    e: { paciente: number; especie: EspecieContato; id: number; acao: 'principal' | 'encerrar' },
    t: RegistroTrilhaTela,
  ): Promise<number> {
    return this.executar(c, operacaoAcaoContato(t) as never, e, t);
  }

  // Responsáveis
  async responsaveis(c: ContextoPorta, paciente: number): Promise<ResponsaveisPaciente> {
    return this.ler(c, async (l) => {
      const p = await pacienteDe(l, paciente);
      const hoje = await hojeDe(l);
      const linhas = await l.consultar(
        `SELECT r.id, pf.nome, RIGHT(pf.cpf, 2) AS cpf_final, r.papel, tp.descricao AS parentesco,
                r.pode_autorizar_procedimento, r.pode_receber_informacao, r.pode_retirar_documento, r.contato_principal,
                r.vigencia_inicio, r.vigencia_fim, r.comprovante_arquivo_id
           FROM responsavel_paciente r
           JOIN pessoa_fisica pf ON pf.id = r.pessoa_fisica_id
           LEFT JOIN tipo_parentesco tp ON tp.id = r.tipo_parentesco_id
          WHERE r.paciente_id = ? AND r.excluido_em IS NULL
          ORDER BY (r.vigencia_fim IS NULL OR r.vigencia_fim >= CURRENT_DATE) DESC, r.contato_principal DESC,
                   r.prioridade_contato IS NULL, r.prioridade_contato, r.id DESC`,
        [paciente],
        { teto: TETO },
      );
      const itens = linhas.map((x) => {
        const vigenciaInicio = data(x['vigencia_inicio']);
        const vigenciaFim = data(x['vigencia_fim']);
        return {
          id: Number(x['id']),
          nome: String(x['nome']),
          cpfFinal: texto(x['cpf_final']),
          papel: String(x['papel']),
          parentesco: texto(x['parentesco']),
          autorizarProcedimento: bool(x['pode_autorizar_procedimento']),
          receberInformacao: bool(x['pode_receber_informacao']),
          retirarDocumento: bool(x['pode_retirar_documento']),
          contatoPrincipal: bool(x['contato_principal']),
          vigenciaInicio,
          vigenciaFim,
          vigente: vigenteEm({ vigenciaInicio, vigenciaFim }, hoje),
          temComprovante: x['comprovante_arquivo_id'] !== null && x['comprovante_arquivo_id'] !== undefined,
        };
      });
      const vigentes = itens.filter((i) => i.vigente);
      return { itens, pendencias: pendenciasRepresentacao(p.nascimento, vigentes, hoje) };
    });
  }

  incluirResponsavel(c: ContextoPorta, e: EntradaResponsavel, t: RegistroTrilhaTela): Promise<number> {
    return this.executar(c, operacaoIncluirResponsavel(t) as never, e, t);
  }
  encerrarResponsavel(
    c: ContextoPorta,
    e: { paciente: number; id: number; levantamentoCuratela: boolean; motivo: string },
    t: RegistroTrilhaTela,
  ): Promise<number> {
    return this.executar(c, operacaoEncerrarResponsavel(t) as never, e, t);
  }
}
