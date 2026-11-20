// W0-06, parte 4 (programa CRUD completo, M1 de mercado): cargos e salários. Cadastro de cargo (CBO, descrição,
// requisitos, conselho exigido), tabela salarial por faixa e nível e quadro de vagas aprovado por centro de custo, com
// inclusão, alteração (o cargo com motivo e o valor anterior; a faixa e a vaga por versão a partir de uma data),
// inativação com motivo e exclusão só do nunca usado (o referenciado recusa e oferece a inativação). O mesmo Zod vale
// na tela e no servidor. A tabela salarial nasce vazia: os valores são dados do dono. O reajuste coletivo com
// diferenças retroativas na folha fica no W1-10.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import type { OpcaoPessoas } from './respostas.js';
import type { CorrecaoResposta } from './treinamento-respostas.js';

const id = z.number().int().positive();
const versao = z.number().int().min(0);
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');
const motivo = textoCp1252(400).pipe(z.string().trim().min(10, 'Explique com pelo menos 10 caracteres.'));
const opcional = (n: number) =>
  textoCp1252(n)
    .transform((s) => s.trim() || null)
    .nullable()
    .default(null);

/** A operação de I/A/E de cargos e salários (a tela e o servidor usam os mesmos nomes). */
export const ALVOS_CARGOS = ['cargo', 'faixa', 'vaga'] as const;
export type AlvoCargos = (typeof ALVOS_CARGOS)[number];

const dadosCargo = {
  nome: textoCp1252(60).pipe(z.string().trim().min(2, 'Informe o nome do cargo.')),
  cbo: z.string().regex(/^\d{6}$/, 'O CBO tem 6 dígitos.'),
  descricao: opcional(2000),
  requisitos: opcional(2000),
  conselho: opcional(20),
};

export const esquemaIncluirCargo = z.object(dadosCargo).strict();
export type IncluirCargoEntrada = z.infer<typeof esquemaIncluirCargo>;

export const esquemaAlterarCargo = z.object({ ...dadosCargo, cargo: id, versao, motivo }).strict();
export type AlterarCargoEntrada = z.infer<typeof esquemaAlterarCargo>;

/** Inativar (ativo false) ou reativar o cargo, a faixa salarial ou a vaga, com motivo. */
export const esquemaSituacaoCargos = z
  .object({ alvo: z.enum(ALVOS_CARGOS), id, versao, ativo: z.boolean(), motivo })
  .strict();
export type SituacaoCargosEntrada = z.infer<typeof esquemaSituacaoCargos>;

/** Excluir o lançado por engano (só sem vínculo; com vínculo, 409 com a contagem e a oferta da inativação). */
export const esquemaExcluirCargos = z.object({ alvo: z.enum(ALVOS_CARGOS), id, versao, motivo }).strict();
export type ExcluirCargosEntrada = z.infer<typeof esquemaExcluirCargos>;

/** Valor em centavos (até R$ 999.999,99). */
const valor = z.number().int().positive('Informe o valor.').max(99_999_999);

export const esquemaIncluirFaixaSalarial = z
  .object({
    cargo: id,
    faixa: textoCp1252(10).pipe(z.string().trim().min(1, 'Informe a faixa.')),
    nivel: textoCp1252(10).pipe(z.string().trim().min(1, 'Informe o nível.')),
    valor,
    desde: data,
  })
  .strict();
export type IncluirFaixaSalarialEntrada = z.infer<typeof esquemaIncluirFaixaSalarial>;

/** Alteração do valor: versão nova a partir de `desde` (a anterior acaba na véspera). */
export const esquemaVersaoFaixaSalarial = z
  .object({ faixa: id, versao, valor, desde: data, motivo })
  .strict();
export type VersaoFaixaSalarialEntrada = z.infer<typeof esquemaVersaoFaixaSalarial>;

const quantidade = z.number().int().min(1, 'O quadro aprovado tem ao menos 1 vaga.').max(9999);

export const esquemaIncluirVaga = z
  .object({ cargo: id, centroCusto: z.number().int().positive(), quantidade, desde: data })
  .strict();
export type IncluirVagaEntrada = z.infer<typeof esquemaIncluirVaga>;

/** Alteração do quadro: versão nova a partir de `desde` (a anterior acaba na véspera). */
export const esquemaVersaoVaga = z.object({ vaga: id, versao, quantidade, desde: data, motivo }).strict();
export type VersaoVagaEntrada = z.infer<typeof esquemaVersaoVaga>;

export const esquemaBuscaCbo = z.object({ termo: z.string().trim().min(2).max(60) }).strict();

// ── Respostas ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface CargoResposta {
  readonly id: number;
  readonly nome: string;
  readonly cbo: string;
  /** A descrição do CBO no cadastro oficial (null: o código não está mais no cadastro). */
  readonly cboDescricao: string | null;
  readonly descricao: string | null;
  readonly requisitos: string | null;
  readonly conselho: string | null;
  readonly ativo: boolean;
  readonly motivoSituacao: string | null;
  readonly versao: number;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
  /** Vagas aprovadas em vigor (ativas, sem fim), somadas dos centros de custo. */
  readonly vagasAprovadas: number;
  /** Colaboradores não desligados ligados ao cargo. */
  readonly ocupadas: number;
  /** Faixas salariais em vigor (ativas, sem fim). */
  readonly faixasVigentes: number;
}

interface VersionadaResposta {
  readonly id: number;
  readonly cargo: number;
  readonly desde: string;
  readonly ate: string | null;
  readonly anterior: number | null;
  readonly motivo: string | null;
  readonly ativo: boolean;
  readonly motivoSituacao: string | null;
  readonly versao: number;
  readonly criadoPor: string;
  readonly criadoEm: string;
  /** Em vigor: ativa e sem fim. */
  readonly vigente: boolean;
}

export interface FaixaSalarialResposta extends VersionadaResposta {
  readonly faixa: string;
  readonly nivel: string;
  /** Centavos. */
  readonly valor: number;
}

export interface VagaResposta extends VersionadaResposta {
  readonly centroCusto: number;
  readonly centroCustoNome: string;
  readonly quantidade: number;
  /** Colaboradores não desligados do cargo neste centro de custo (só na vigente; 0 nas demais). */
  readonly ocupadas: number;
}

export interface FichaCargo {
  readonly cargo: CargoResposta;
  readonly faixas: readonly FaixaSalarialResposta[];
  readonly vagas: readonly VagaResposta[];
  /** O histórico das alterações do cargo (o valor anterior e o novo, o motivo, quem e quando). */
  readonly correcoes: readonly CorrecaoResposta[];
}

export interface ApoioCargos {
  readonly hoje: string;
  readonly centrosCusto: readonly OpcaoPessoas[];
  readonly conselhos: readonly { readonly codigo: string; readonly rotulo: string }[];
  /** Liberação da chave `pessoas.colaborador` no estabelecimento e o motivo, se desligada. */
  readonly gravacao: { readonly ligada: boolean; readonly motivo: string | null };
  readonly acoes: { readonly gerir: boolean; readonly motivo: string | null };
}

export interface ListaCargos {
  readonly cargos: readonly CargoResposta[];
}

export interface ResultadoCargos {
  readonly id: number;
  readonly mensagem: string;
}
