// Porta de cargos e salários (W0-06, parte 4; M1 de mercado): o que a tela "Cargos e salários" lê e grava,
// independente de onde (a API não escreve SQL; fronteira Nx). Só tabelas SGH_ (D-W006-CARGO-SGH); do sistema anterior
// só se LÊ o CBO do cadastro oficial e os conselhos. Os centros de custo vêm da porta da gestão de pessoas.
//   - `legado`: leituras de @sgh/legado em transação READ ONLY; gravações numa transação só SGH_ com a SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E); nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type {
  CargoLido,
  CorrecaoPesLida,
  DadosCargoSgh,
  FaixaSalarialLida,
  NovaFaixaSalarialSgh,
  NovaVagaQuadroSgh,
  OcupacaoCargoLida,
  VagaQuadroLida,
  VinculoPessoasContado,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_CARGOS = Symbol('PORTA_CARGOS');

export type ContextoCargos = ContextoPortaM18;
export type TabelaCargos = 'SGH_PES_CARGO' | 'SGH_PES_CARGO_FAIXA' | 'SGH_PES_VAGA';
export type AlvoDependenciaCargos = 'cargo' | 'salario-faixa' | 'vaga';
type SemHospital<T> = Omit<T, 'hospital'>;

/** As gravações SGH_ de cargos e salários numa transação só SGH_, com as releituras dentro dela. */
export interface GravadorCargos {
  cargo(id: number): Promise<CargoLido | null>;
  faixa(id: number): Promise<FaixaSalarialLida | null>;
  vaga(id: number): Promise<VagaQuadroLida | null>;
  incluirCargo(x: DadosCargoSgh & { por: string }): Promise<number>;
  alterarCargo(x: DadosCargoSgh & { id: number; versao: number; por: string }): Promise<void>;
  situacao(x: {
    tabela: TabelaCargos;
    id: number;
    versao: number;
    ativo: boolean;
    motivo: string;
    por: string;
  }): Promise<void>;
  /** Exclusão física com a recontagem na transação e o retrato (com vínculo: 409, nada apagado). */
  excluir(x: {
    tabela: TabelaCargos;
    id: number;
    versao: number;
    motivo: string;
    por: string;
  }): Promise<void>;
  incluirFaixa(x: SemHospital<NovaFaixaSalarialSgh>): Promise<number>;
  versionarFaixa(x: {
    anterior: FaixaSalarialLida;
    valor: number;
    desde: string;
    motivo: string;
    por: string;
  }): Promise<number>;
  incluirVaga(x: SemHospital<NovaVagaQuadroSgh>): Promise<number>;
  versionarVaga(x: {
    anterior: VagaQuadroLida;
    quantidade: number;
    desde: string;
    motivo: string;
    por: string;
  }): Promise<number>;
  registrarCorrecao(x: {
    tabela: string;
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
  cargos(c: ContextoCargos): Promise<CargoLido[]>;
  cargo(c: ContextoCargos, id: number): Promise<CargoLido | null>;
  faixas(c: ContextoCargos, cargo: number | null): Promise<FaixaSalarialLida[]>;
  faixa(c: ContextoCargos, id: number): Promise<FaixaSalarialLida | null>;
  vagas(c: ContextoCargos, cargo: number | null): Promise<VagaQuadroLida[]>;
  vaga(c: ContextoCargos, id: number): Promise<VagaQuadroLida | null>;
  ocupacao(c: ContextoCargos): Promise<OcupacaoCargoLida[]>;
  /** O que barra a exclusão física (o mapa de dependências de packages/legado). */
  dependencias(c: ContextoCargos, alvo: AlvoDependenciaCargos, id: number): Promise<VinculoPessoasContado[]>;
  buscarCbo(c: ContextoCargos, termo: string): Promise<{ codigo: string; rotulo: string }[]>;
  cboPorCodigo(c: ContextoCargos, codigos: readonly string[]): Promise<Map<string, string>>;
  conselhos(c: ContextoCargos): Promise<{ codigo: string; rotulo: string }[]>;
  correcoes(c: ContextoCargos, tabela: string, registros: readonly number[]): Promise<CorrecaoPesLida[]>;
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
