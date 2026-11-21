// Porta de cargos e salários (W0-06, parte 4; M1 de mercado): o que a tela "Cargos e salários" lê e grava,
// independente de onde (a API não escreve SQL). O cargo é da rede inteira (tabela `cargo`, com o CBO do cadastro
// oficial e o conselho de classe); a faixa salarial e o quadro de vagas aprovado são do estabelecimento.
//   - `banco`: PortaCargosPropria (MariaDB pelo @sgh/nucleo; gravações pelo Executor, trilha na mesma transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E);
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Melhoria: tipos de negócio próprios (booleano, data ISO, id, centavos), sem nome de tabela do sistema de origem.
import { type ContextoPortaM18, type PortaGravacaoM18, portaIndisponivel } from '../../exames/public-api.js';

export const PORTA_CARGOS = Symbol('PORTA_CARGOS');

export type ContextoCargos = ContextoPortaM18;
/** Tabelas do modelo que a tela de cargos e salários grava (o histórico das correções é lido por elas). */
export type TabelaCargos = 'cargo' | 'faixa_salarial' | 'quadro_vaga';
export type AlvoDependenciaCargos = 'cargo' | 'salario-faixa' | 'vaga';

/** O cargo como a tela o lê. */
export interface CargoRegistrado {
  readonly id: number;
  readonly nome: string;
  /** Código CBO (6 dígitos). */
  readonly cbo: string;
  readonly descricao: string | null;
  readonly requisitos: string | null;
  /** Sigla do conselho de classe exigido (null: nenhum). */
  readonly conselho: string | null;
  readonly ativo: boolean;
  readonly motivoSituacao: string | null;
  readonly versao: number;
  readonly criadoPor: string;
  readonly criadoEm: string;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
}

interface Versionada {
  readonly id: number;
  readonly cargo: number;
  /** AAAA-MM-DD */
  readonly desde: string;
  readonly ate: string | null;
  readonly anterior: number | null;
  readonly motivo: string | null;
  readonly ativo: boolean;
  readonly motivoSituacao: string | null;
  readonly versao: number;
  readonly criadoPor: string;
  readonly criadoEm: string;
}

export interface FaixaSalarialRegistrada extends Versionada {
  readonly faixa: string;
  readonly nivel: string;
  /** Centavos. */
  readonly valor: number;
}

export interface VagaQuadroRegistrada extends Versionada {
  /** Id do centro de custo. */
  readonly centroCusto: number;
  readonly quantidade: number;
}

/** Colaboradores não desligados por cargo e centro de custo. */
export interface OcupacaoCargo {
  readonly cargo: number;
  readonly centroCusto: number | null;
  readonly ocupadas: number;
}

/** Registros ligados que barram a exclusão (grupo para a tela; tabela e coluna do modelo). */
export interface DependenciaContada {
  readonly grupo: string;
  readonly tabela: string;
  readonly coluna: string;
  readonly quantidade: number;
}

/** Uma correção do histórico (o valor anterior e o novo, o motivo, quem e quando). */
export interface CorrecaoRegistrada {
  readonly id: number;
  readonly tabela: string;
  readonly registro: number;
  readonly operacao: string;
  readonly antes: Record<string, unknown>;
  readonly depois: Record<string, unknown>;
  readonly motivo: string;
  readonly por: string;
  readonly em: string;
}

export interface DadosCargo {
  readonly nome: string;
  readonly cbo: string;
  readonly descricao: string | null;
  readonly requisitos: string | null;
  readonly conselho: string | null;
}

export interface NovaFaixaSalarial {
  readonly cargo: number;
  readonly faixa: string;
  readonly nivel: string;
  readonly valor: number;
  readonly desde: string;
  readonly por: string;
}

export interface NovaVagaQuadro {
  readonly cargo: number;
  readonly centroCusto: number;
  readonly quantidade: number;
  readonly desde: string;
  readonly por: string;
}

/** As gravações de cargos e salários numa transação só, com as releituras dentro dela. */
export interface GravadorCargos {
  cargo(id: number): Promise<CargoRegistrado | null>;
  faixa(id: number): Promise<FaixaSalarialRegistrada | null>;
  vaga(id: number): Promise<VagaQuadroRegistrada | null>;
  incluirCargo(x: DadosCargo & { por: string }): Promise<number>;
  alterarCargo(x: DadosCargo & { id: number; versao: number; por: string }): Promise<void>;
  situacao(x: {
    tabela: TabelaCargos;
    id: number;
    versao: number;
    ativo: boolean;
    motivo: string;
    por: string;
  }): Promise<void>;
  /** Exclusão do lançado por engano, com a recontagem na transação e o retrato (com vínculo: 409, nada muda). */
  excluir(x: {
    tabela: TabelaCargos;
    id: number;
    versao: number;
    motivo: string;
    por: string;
  }): Promise<void>;
  incluirFaixa(x: NovaFaixaSalarial): Promise<number>;
  versionarFaixa(x: {
    anterior: FaixaSalarialRegistrada;
    valor: number;
    desde: string;
    motivo: string;
    por: string;
  }): Promise<number>;
  incluirVaga(x: NovaVagaQuadro): Promise<number>;
  versionarVaga(x: {
    anterior: VagaQuadroRegistrada;
    quantidade: number;
    desde: string;
    motivo: string;
    por: string;
  }): Promise<number>;
  registrarCorrecao(x: {
    tabela: TabelaCargos;
    registro: number;
    operacao: string;
    antes: Record<string, unknown>;
    depois: Record<string, unknown>;
    motivo: string;
    por: string;
  }): Promise<void>;
}

export interface PortaCargos extends PortaGravacaoM18<GravadorCargos> {
  hoje(c: ContextoCargos): Promise<string>;
  cargos(c: ContextoCargos): Promise<CargoRegistrado[]>;
  cargo(c: ContextoCargos, id: number): Promise<CargoRegistrado | null>;
  faixas(c: ContextoCargos, cargo: number | null): Promise<FaixaSalarialRegistrada[]>;
  faixa(c: ContextoCargos, id: number): Promise<FaixaSalarialRegistrada | null>;
  vagas(c: ContextoCargos, cargo: number | null): Promise<VagaQuadroRegistrada[]>;
  vaga(c: ContextoCargos, id: number): Promise<VagaQuadroRegistrada | null>;
  ocupacao(c: ContextoCargos): Promise<OcupacaoCargo[]>;
  /** O que barra a exclusão (registros ligados no modelo). */
  dependencias(c: ContextoCargos, alvo: AlvoDependenciaCargos, id: number): Promise<DependenciaContada[]>;
  buscarCbo(c: ContextoCargos, termo: string): Promise<{ codigo: string; rotulo: string }[]>;
  cboPorCodigo(c: ContextoCargos, codigos: readonly string[]): Promise<Map<string, string>>;
  conselhos(c: ContextoCargos): Promise<{ codigo: string; rotulo: string }[]>;
  correcoes(
    c: ContextoCargos,
    tabela: TabelaCargos,
    registros: readonly number[],
  ): Promise<CorrecaoRegistrada[]>;
}

export const METODOS_PORTA_CARGOS: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'hoje',
  'cargos',
  'cargo',
  'faixas',
  'faixa',
  'vagas',
  'vaga',
  'ocupacao',
  'dependencias',
  'buscarCbo',
  'cboPorCodigo',
  'conselhos',
  'correcoes',
]);

/** Fora de dev/ci sem o núcleo: 503 em tudo (falha fechada). */
export function portaCargosIndisponivel(): PortaCargos {
  return portaIndisponivel<PortaCargos>(METODOS_PORTA_CARGOS);
}
