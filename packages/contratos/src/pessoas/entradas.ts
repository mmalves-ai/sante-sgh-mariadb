// Entradas das telas e das operações da gestão de pessoas, fatia F1 (M52; ficha, seções 5, 7 e 8): admissão,
// dependentes, mudança funcional, desligamento ligado ao acesso e validade do conselho. O mesmo Zod vale na tela e no
// servidor. A tela nunca manda ID de usuário nem login para bloquear: o servidor resolve a pessoa pelo vínculo e
// relê o estado de cada hospital (regra 2). CPF vai só como filtro exato (ficha, seção 4) e nunca volta inteiro.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { cpfValido, somenteDigitos } from '../validacao/cpf.js';
import { CODIGOS_TIPO_VINCULO, PARENTESCOS_DEPENDENTE, type TipoVinculo } from './vocabulario.js';

const id = z.number().int().positive();
const smallint = z.number().int().min(0).max(32_767);
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');
const motivo = textoCp1252(400).pipe(z.string().min(10, 'Explique com pelo menos 10 caracteres.'));

/** CPF digitado com ou sem máscara: vira 11 dígitos e precisa ter os verificadores válidos. */
export const esquemaCpf = z
  .string()
  .transform((v) => somenteDigitos(v))
  .refine((v) => cpfValido(v), 'CPF inválido.');

const tiposVinculo = z.enum(CODIGOS_TIPO_VINCULO as [TipoVinculo, ...TipoVinculo[]]);

/** Lotação: centro de custo (TBCENCUS.COD) e, se houver, a unidade (TBUNIDAD.COD) e o setor de trabalho. */
export const esquemaLotacao = z
  .object({
    centroCusto: z.number().int().positive(),
    unidade: smallint.nullable().default(null),
    setor: textoCp1252(60).nullable().default(null),
  })
  .strict();
export type LotacaoEntrada = z.infer<typeof esquemaLotacao>;

/**
 * Admissão (regra 1): a pessoa é achada pelo CPF; se já houver profissional ou usuário com o CPF, eles são
 * reusados (o servidor confere de novo, dentro da transação). `profissional` e `usuario` vêm da prévia que a tela
 * mostrou; o servidor recusa se a prévia mudou.
 */
export const esquemaAdmitirColaborador = z
  .object({
    cpf: esquemaCpf,
    nome: textoCp1252(70).pipe(z.string().min(3, 'Informe o nome completo.')),
    tipo: tiposVinculo,
    admissao: data,
    cargo: textoCp1252(60).pipe(z.string().min(2, 'Informe o cargo.')),
    funcao: textoCp1252(60).nullable().default(null),
    /** Carga semanal do contrato, em horas (1 a 60: o teto por tipo de vínculo é do domínio, `limiteCargaSemanal`). */
    cargaSemanalHoras: z.number().int().min(1).max(60),
    lotacao: esquemaLotacao,
    /** Matrícula do RH (texto livre, única por estabelecimento). */
    matricula: textoCp1252(20).nullable().default(null),
    /** Profissional (TBPROFIS.ID) a reusar, da prévia; null: a pessoa não é profissional cadastrado. */
    profissional: id.nullable().default(null),
    /** Usuário (TBUSERS.ID_TBUSERS) a reusar, da prévia; null: sem login no estabelecimento. */
    usuario: id.nullable().default(null),
  })
  .strict();
export type AdmitirColaboradorEntrada = z.infer<typeof esquemaAdmitirColaborador>;

/** Prévia da admissão: só o CPF, que o servidor usa como filtro exato (nunca devolve o CPF inteiro). */
export const esquemaPreviaAdmissao = z.object({ cpf: esquemaCpf }).strict();
export type PreviaAdmissaoEntrada = z.infer<typeof esquemaPreviaAdmissao>;

/** Mudança funcional (cargo, função, lotação ou carga): cada mudança vira linha nova do histórico. */
export const esquemaAlterarVinculo = z
  .object({
    vinculo: id,
    /** A versão do vínculo lida na ficha (outra pessoa gravou antes: 409). */
    versao: z.number().int().min(0),
    vigencia: data,
    cargo: textoCp1252(60).optional(),
    funcao: textoCp1252(60).nullable().optional(),
    cargaSemanalHoras: z.number().int().min(1).max(60).optional(),
    lotacao: esquemaLotacao.optional(),
    motivo,
  })
  .strict()
  .refine(
    (e) =>
      e.cargo !== undefined ||
      e.funcao !== undefined ||
      e.cargaSemanalHoras !== undefined ||
      e.lotacao !== undefined,
    { message: 'Nada para alterar.', path: ['cargo'] },
  );
export type AlterarVinculoEntrada = z.infer<typeof esquemaAlterarVinculo>;

/**
 * Desligamento (regra 2): data, motivo do domínio de tipos de rescisão do ramo (FPTIPORESC.ID, 8 linhas no pc) e o
 * texto. O bloqueio do acesso no mesmo dia é consequência, não escolha da tela.
 */
export const esquemaDesligarColaborador = z
  .object({
    vinculo: id,
    data,
    tipoRescisao: z.number().int().min(0).max(9),
    motivo,
  })
  .strict();
export type DesligarColaboradorEntrada = z.infer<typeof esquemaDesligarColaborador>;

/** Dependente do colaborador (SGH_PES_DEPENDENTE). CPF opcional (filho recém-nascido ainda sem CPF). */
export const esquemaDependente = z
  .object({
    vinculo: id,
    nome: textoCp1252(70).pipe(z.string().min(3, 'Informe o nome completo.')),
    nascimento: data,
    parentesco: z.enum(Object.keys(PARENTESCOS_DEPENDENTE) as [string, ...string[]]),
    cpf: esquemaCpf.nullable().default(null),
    dependenteIr: z.boolean().default(false),
    dependenteSalarioFamilia: z.boolean().default(false),
  })
  .strict();
export type DependenteEntrada = z.infer<typeof esquemaDependente>;

/**
 * Fim do dependente (SGH_PES_DEPENDENTE.ATE; nunca apagado): o que deixou de ser dependente ou foi incluído por engano.
 * A data não pode ser futura (a regra fica no servidor, com o relógio do banco) e o motivo vai com o registro.
 */
export const esquemaEncerrarDependente = z
  .object({
    vinculo: id,
    dependente: id,
    ate: data,
    motivo: textoCp1252(200).pipe(z.string().min(10, 'Explique com pelo menos 10 caracteres.')),
  })
  .strict();
export type EncerrarDependenteEntrada = z.infer<typeof esquemaEncerrarDependente>;

/**
 * W0-06: correção cadastral do colaborador (o erro de digitação ou de registro, não a mudança funcional): nome,
 * matrícula, tipo de vínculo e admissão, com motivo; o valor anterior fica guardado. Vale também para o desligado.
 */
export const esquemaCorrigirColaborador = z
  .object({
    vinculo: id,
    versao: z.number().int().min(0),
    nome: textoCp1252(70).pipe(z.string().min(3, 'Informe o nome completo.')).optional(),
    matricula: textoCp1252(20).nullable().optional(),
    tipo: tiposVinculo.optional(),
    admissao: data.optional(),
    motivo,
  })
  .strict()
  .refine(
    (e) =>
      e.nome !== undefined || e.matricula !== undefined || e.tipo !== undefined || e.admissao !== undefined,
    { message: 'Nada para corrigir.', path: ['nome'] },
  );
export type CorrigirColaboradorEntrada = z.infer<typeof esquemaCorrigirColaborador>;

/**
 * W0-06 (parte 5d-3a): o cargo do quadro de cargos e salários ligado ao colaborador (a avaliação de desempenho abre
 * pelas competências dele), pela versão lida e com motivo; o valor anterior fica guardado. `cargo` null desliga.
 */
export const esquemaLigarCargoColaborador = z
  .object({
    vinculo: id,
    versao: z.number().int().min(0),
    cargo: id.nullable(),
    motivo,
  })
  .strict();
export type LigarCargoColaboradorEntrada = z.infer<typeof esquemaLigarCargoColaborador>;

/**
 * W0-06: alteração do dependente com versão (IR e salário-família contam por data na folha): a versão em vigor acaba
 * na véspera de `desde` e a nova vale a partir dele. `cpf` ausente mantém o atual; null retira.
 */
export const esquemaAlterarDependente = z
  .object({
    vinculo: id,
    dependente: id,
    desde: data,
    nome: textoCp1252(70).pipe(z.string().min(3, 'Informe o nome completo.')).optional(),
    nascimento: data.optional(),
    parentesco: z.enum(Object.keys(PARENTESCOS_DEPENDENTE) as [string, ...string[]]).optional(),
    cpf: esquemaCpf.nullable().optional(),
    dependenteIr: z.boolean().optional(),
    dependenteSalarioFamilia: z.boolean().optional(),
    motivo: textoCp1252(180).pipe(z.string().min(10, 'Explique com pelo menos 10 caracteres.')),
  })
  .strict()
  .refine(
    (e) =>
      e.nome !== undefined ||
      e.nascimento !== undefined ||
      e.parentesco !== undefined ||
      e.cpf !== undefined ||
      e.dependenteIr !== undefined ||
      e.dependenteSalarioFamilia !== undefined,
    { message: 'Nada para alterar.', path: ['nome'] },
  );
export type AlterarDependenteEntrada = z.infer<typeof esquemaAlterarDependente>;

/**
 * Validade do conselho acompanhada pelo RH (SGH_PES_HABILITACAO; regra 3). O registro (número, UF, conselho) é o do
 * cadastro de profissionais (TBCBOPRO): aqui só a validade e o documento conferido.
 */
export const esquemaRegistrarHabilitacao = z
  .object({
    registro: id,
    validade: data.nullable(),
    conferidoEm: data,
    observacao: textoCp1252(200).nullable().default(null),
  })
  .strict();
export type RegistrarHabilitacaoEntrada = z.infer<typeof esquemaRegistrarHabilitacao>;

/**
 * Filtro da lista de colaboradores (ficha, seção 4: estabelecimento + setor, paginado 200). O termo procura no nome e na
 * matrícula; um CPF válido no termo vira o filtro exato pelo HMAC (o CPF nunca volta na lista).
 */
export const esquemaFiltroColaboradores = z
  .object({
    termo: textoCp1252(70).optional(),
    centroCusto: z.coerce.number().int().positive().optional(),
    /** A unidade do estabelecimento (TBUNIDAD.COD) da lotação. */
    unidade: z.coerce.number().int().positive().max(32_767).optional(),
    /** O setor de trabalho da lotação (contém o texto, sem diferença de maiúsculas). */
    setor: textoCp1252(60).optional(),
    tipo: tiposVinculo.optional(),
    estado: z.enum(['ativo', 'desligado', 'todos']).default('ativo'),
    /** Keyset: o último ID da página anterior. */
    depois: z.coerce.number().int().positive().optional(),
    limite: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type FiltroColaboradoresEntrada = z.infer<typeof esquemaFiltroColaboradores>;

/** Filtro dos alertas de conselho (vencido ou a vencer na janela). */
export const esquemaFiltroHabilitacoes = z
  .object({
    situacao: z.enum(['vencida', 'aVencer', 'semValidade', 'todas']).default('todas'),
    conselho: z.string().max(7).optional(),
    depois: z.coerce.number().int().positive().optional(),
    limite: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type FiltroHabilitacoesEntrada = z.infer<typeof esquemaFiltroHabilitacoes>;
