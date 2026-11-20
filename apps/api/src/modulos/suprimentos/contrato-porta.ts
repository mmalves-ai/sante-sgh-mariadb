// Porta dos contratos com fornecedores (M55, etapa 3; ficha, seções 4, 5 e 7), independente de onde (a API não
// escreve SQL; fronteira Nx):
//   - `legado`: as leituras READ ONLY (SGH_SUP_CONTRATO*, os pedidos e os títulos ligados pelos IDs, os fornecedores);
//     as gravações numa transação SGH_ com a SGH_TRILHA junto (o contrato travado e o saldo relido na MESMA transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras e recusas, sobre pedidos e títulos sintéticos;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// O pedido e o título com contrato nascem pelas operações de compras e de contas a pagar (o executor), com o vínculo na
// mesma transação; aqui só o contrato, os eventos e o vínculo do que já existe.
import type {
  AlterarContratoEntrada,
  CandidatoVinculo,
  ContratoDetalhe,
  ContratoDoVinculo,
  ContratoResumo,
  CriarContratoEntrada,
  FiltroContratosFornecedor,
  PainelContratos,
  RegistrarEventoContratoEntrada,
  TipoVinculoContrato,
} from '@sgh/contratos';
import type { EventoGravado, VinculoGravado } from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_CONTRATO = Symbol('PORTA_CONTRATO');

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto. */
export interface GravadorContrato {
  criar(m: { entrada: CriarContratoEntrada; usuario: string }): Promise<{ id: number; repetido: boolean }>;
  alterar(m: {
    id: number;
    entrada: AlterarContratoEntrada;
    usuario: string;
  }): Promise<{ id: number; versao: number }>;
  evento(m: {
    contrato: number;
    entrada: RegistrarEventoContratoEntrada;
    usuario: string;
  }): Promise<EventoGravado>;
  vincular(m: {
    contrato: ContratoDoVinculo;
    tipo: TipoVinculoContrato;
    ids: readonly number[];
    usuario: string;
    chave: string;
  }): Promise<VinculoGravado>;
}

export interface FornecedorContrato {
  readonly codigo: number;
  readonly nome: string;
}

export interface PortaContrato extends PortaGravacaoM18<GravadorContrato> {
  listar(
    c: ContextoPortaM18,
    f: FiltroContratosFornecedor,
  ): Promise<{ hoje: string; itens: ContratoResumo[]; pagina: number; cortada: boolean }>;
  detalhar(c: ContextoPortaM18, id: number): Promise<ContratoDetalhe | null>;
  painel(c: ContextoPortaM18): Promise<PainelContratos>;
  /** Os pedidos e os títulos do fornecedor ainda sem contrato (para ligar). */
  candidatos(c: ContextoPortaM18, id: number): Promise<CandidatoVinculo[] | null>;
  /** Os fornecedores do cadastro pelo nome ou código (a busca da tela). */
  fornecedores(
    c: ContextoPortaM18,
    termo: string,
  ): Promise<{ itens: FornecedorContrato[]; cortada: boolean }>;
  /** Os usuários ativos e sem bloqueio pelo login ou nome (o gestor e o fiscal do contrato; teto de 50). */
  usuarios(c: ContextoPortaM18, termo: string): Promise<UsuarioContrato[]>;
  /** Os centros de custo que consomem (o técnico fica de fora). */
  centros(c: ContextoPortaM18): Promise<FornecedorContrato[]>;
}

export interface UsuarioContrato {
  readonly login: string;
  readonly nome: string;
}

export const METODOS_PORTA_CONTRATO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'listar',
  'detalhar',
  'painel',
  'candidatos',
  'fornecedores',
  'usuarios',
  'centros',
]);
