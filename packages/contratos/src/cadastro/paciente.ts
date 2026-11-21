// Entrada de `cadastro.cadastrarPaciente` (ficha do M04, item 5): o mesmo validador na tela e no servidor.
// Obrigatórios: os da sante-api (nome, nascimento, sexo, CPF) e o que o perfil mostra que o Delphi sempre
// preenche (naturalidade e CEP existente no cadastro de CEPs: 4.222 de 4.222 na janela; desvio da
// sante-api, que grava sem CEP, registrado no M04). Texto pelo validador CP1252 (ADR 0008), com o tamanho
// da coluna legada; maiúsculas como o legado grava (4.222 de 4.222 nomes em maiúsculas).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { cpfValido, somenteDigitos } from '../validacao/cpf.js';

// Maiúsculas antes de validar o charset e o tamanho: 'µ' (CP1252) vira 'Μ' (fora dele) e 'ß' vira 'SS' (mais longo).
const maiusculas = (max: number) =>
  textoCp1252(max)
    .overwrite((t) => t.trim().toLocaleUpperCase('pt-BR'))
    .pipe(textoCp1252(max));
const obrigatorio = (max: number) => maiusculas(max).refine((t) => t !== '', 'Campo obrigatório.');

/** Data de calendário AAAA-MM-DD. */
const dataCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD.')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'Data inválida.');

export const esquemaCadastrarPaciente = z
  .object({
    nome: obrigatorio(70),
    /** Não futura (conferida contra o relógio do banco na transação). */
    nascimento: dataCivil,
    sexo: z.enum(['M', 'F']),
    cpf: z
      .string()
      .transform(somenteDigitos)
      .refine(cpfValido, 'CPF inválido: confira os dígitos (sequência repetida não é CPF).'),
    nomeMae: maiusculas(70).optional(),
    naturalidade: obrigatorio(30),
    ufNaturalidade: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .transform((u) => u.toUpperCase())
      .optional(),
    /** CEP de 8 dígitos que exista no cadastro de CEPs do legado; o endereço é completado por ele. */
    cep: z
      .string()
      .transform(somenteDigitos)
      .pipe(z.string().regex(/^\d{8}$/, 'CEP com 8 dígitos.')),
    logradouro: maiusculas(40).optional(),
    numero: z.number().int().min(0).max(999_999).optional(),
    complemento: maiusculas(15).optional(),
    bairro: maiusculas(30).optional(),
    celular: z.string().transform(somenteDigitos).pipe(z.string().min(10).max(15)).optional(),
    telefone: z.string().transform(somenteDigitos).pipe(z.string().min(10).max(15)).optional(),
    email: textoCp1252(50)
      .overwrite((t) => t.trim().toLowerCase())
      .pipe(z.email())
      .optional(),
    /** M11: responsável/contato (contato e telefone do contato; o trigger retrata o telefone do contato). */
    contatoNome: maiusculas(40).optional(),
    contatoTelefone: z.string().transform(somenteDigitos).pipe(z.string().min(10).max(15)).optional(),
  })
  .strict();

export type CadastrarPacienteEntrada = z.infer<typeof esquemaCadastrarPaciente>;

export const esquemaCadastrarPacienteResultado = z.object({
  idPaciente: z.number().int().positive(),
  prontuario: z.number().int().positive(),
});
export type CadastrarPacienteResultado = z.infer<typeof esquemaCadastrarPacienteResultado>;

// ── M11: alteração do cadastro (cadastro.alterarPaciente) ─────────────────────────────────────────────

/** Telefone opcional que pode ser apagado (null = apagar; o legado grava texto em branco). */
const telefoneOuApagar = z
  .union([z.string().transform(somenteDigitos).pipe(z.string().min(10).max(15)), z.null()])
  .optional();
const textoOuApagar = (max: number) => z.union([maiusculas(max), z.null()]).optional();

/**
 * Campos que a ficha altera: só os que o perfil das alterações recentes confirma (cadastro × versões do paciente,
 * 20.521 pares de versão de 2025-10 a 2026-09: nome 181, nascimento 37, sexo 21, mãe 37, CPF 17, CEP 100,
 * logradouro 272, número 119, complemento 360, bairro 188, e-mail 8, naturalidade 4, estado civil 27,
 * identidade 45; telefones pelo retrato). CNS, raça/cor, religião e nome social não mudaram em nenhum par
 * (0, 6, 0 e 2): ficam em consulta neste marco.
 */
export const esquemaAlteracoesPaciente = z
  .object({
    nome: obrigatorio(70).optional(),
    nascimento: dataCivil.optional(),
    sexo: z.enum(['M', 'F']).optional(),
    nomeMae: textoOuApagar(70),
    naturalidade: obrigatorio(30).optional(),
    ufNaturalidade: z
      .union([
        z
          .string()
          .regex(/^[A-Za-z]{2}$/)
          .transform((u) => u.toUpperCase()),
        z.null(),
      ])
      .optional(),
    cpf: z
      .string()
      .transform(somenteDigitos)
      .refine(cpfValido, 'CPF inválido: confira os dígitos (sequência repetida não é CPF).')
      .optional(),
    identidade: textoOuApagar(15),
    /** Estado civil (só os valores já vistos no cadastro do paciente). */
    estadoCivil: z.union([z.number().int().min(1).max(99), z.null()]).optional(),
    /** CEP de 8 dígitos existente em TBCEP (a FK do legado; o endereço é completado por ele). */
    cep: z
      .string()
      .transform(somenteDigitos)
      .pipe(z.string().regex(/^\d{8}$/, 'CEP com 8 dígitos.'))
      .optional(),
    logradouro: maiusculas(40).optional(),
    numero: z.union([z.number().int().min(0).max(999_999), z.null()]).optional(),
    complemento: textoOuApagar(15),
    bairro: maiusculas(30).optional(),
    telefone: telefoneOuApagar,
    celular: telefoneOuApagar,
    email: z
      .union([
        textoCp1252(50)
          .overwrite((t) => t.trim().toLowerCase())
          .pipe(z.email()),
        z.null(),
      ])
      .optional(),
    contatoNome: textoOuApagar(40),
    contatoTelefone: telefoneOuApagar,
  })
  .strict()
  .refine((a) => Object.values(a).some((v) => v !== undefined), 'Nenhum campo alterado.');
export type AlteracoesPaciente = z.infer<typeof esquemaAlteracoesPaciente>;

export const CAMPOS_ALTERAVEIS_PACIENTE = [
  'nome',
  'nascimento',
  'sexo',
  'nomeMae',
  'naturalidade',
  'ufNaturalidade',
  'cpf',
  'identidade',
  'estadoCivil',
  'cep',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'telefone',
  'celular',
  'email',
  'contatoNome',
  'contatoTelefone',
] as const satisfies readonly (keyof AlteracoesPaciente)[];
export type CampoAlteravelPaciente = (typeof CAMPOS_ALTERAVEIS_PACIENTE)[number];

export const esquemaAlterarPaciente = z
  .object({
    idPaciente: z.number().int().positive(),
    /**
     * Versão que a tela leu (controle otimista; cap-10 §10.5): o carimbo DATA_HORA_ULTIMA_ATUALIZACAO do
     * legado e as colunas mostradas, opaca para a tela.
     */
    versao: z.string().min(2).max(8000),
    alteracoes: esquemaAlteracoesPaciente,
  })
  .strict();
export type AlterarPacienteEntrada = z.infer<typeof esquemaAlterarPaciente>;

export const esquemaAlterarPacienteResultado = z.object({ idPaciente: z.number().int().positive() });
export type AlterarPacienteResultado = z.infer<typeof esquemaAlterarPacienteResultado>;

// ── Unificação de prontuários duplicados no mesmo estabelecimento (cadastro.unificarPaciente; ficha do M57, seção 5) ──

/** Entrada da operação: o prontuário absorvido (fica inativo) e o que fica (sobrevivente), do MESMO banco. */
export const esquemaUnificarPaciente = z
  .object({
    idAbsorvido: z.number().int().positive(),
    idSobrevivente: z.number().int().positive(),
    /** O par da fila de duplicidades que a tela decidiu (a fila registra a unificação junto, na tabela própria). */
    par: z.number().int().positive().optional(),
    justificativa: z.string().trim().min(5).max(200).optional(),
  })
  .strict()
  .refine((e) => e.idAbsorvido !== e.idSobrevivente, {
    message: 'O prontuário que fica e o absorvido têm de ser diferentes.',
    path: ['idSobrevivente'],
  });
export type UnificarPacienteEntrada = z.infer<typeof esquemaUnificarPaciente>;

/** Pedido da tela para um par da fila de duplicidades: qual lado fica, a justificativa e a senha (ação crítica). */
export const esquemaPedidoUnificacao = z
  .object({
    fica: z.enum(['a', 'b']),
    justificativa: z.string().trim().min(5).max(200),
    senha: z.string().min(1).max(64).optional(),
  })
  .strict();
export type PedidoUnificacao = z.infer<typeof esquemaPedidoUnificacao>;
