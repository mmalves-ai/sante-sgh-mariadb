// Porta da rouparia e lavanderia (M55, fatia F2; ficha, seções 4 a 7), independente de onde (a API não escreve SQL;
// fronteira Nx):
//   - `legado`: as leituras READ ONLY (o enxoval, as cotas, os movimentos, os envios abertos, os kg por setor e dia, os
//     totais, os inventários, os setores, o fornecedor e os pacientes-dia do censo) e as gravações só do novo numa
//     transação SGH_ com a SGH_TRILHA junto (o movimento e o envio relidos e travados na MESMA transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras e recusas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Recurso só do novo: nenhuma operação do executor (o legado não tem rouparia).
import type { CotaRoupa, KgSetorDia, MovimentoRoupa, PecaRoupa, TipoMovimentoRoupa } from '@sgh/contratos';
import type { MovimentoRoupaSgh, PecaRoupaSgh, TotaisRoupariaLidos } from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_ROUPARIA = Symbol('PORTA_ROUPARIA');

type SemHospital<T> = Omit<T, 'hospital'>;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto; as leituras aqui são da mesma transação. */
export interface GravadorRouparia {
  relogio(): Promise<{ hoje: string; agora: string }>;
  pecas(): Promise<PecaRoupa[]>;
  /** O movimento relido na transação (travado até o fim), ou null. */
  movimento(id: number): Promise<MovimentoRoupa | null>;
  movimentoPelaChave(chave: string): Promise<MovimentoRoupa | null>;
  incluirPeca(p: SemHospital<PecaRoupaSgh>): Promise<{ id: number; versao: number }>;
  alterarPeca(
    p: SemHospital<PecaRoupaSgh> & { id: number; versaoVista: number },
  ): Promise<{ id: number; versao: number }>;
  gravarCotas(c: {
    centroCusto: number;
    cotas: readonly { peca: number; quantidade: number }[];
    usuario: string;
  }): Promise<{ alteradas: number }>;
  registrarMovimento(m: SemHospital<MovimentoRoupaSgh>): Promise<{ id: number; versao: number }>;
  cancelarMovimento(c: {
    id: number;
    versaoVista: number;
    motivo: string;
    usuario: string;
    remessa: number | null;
  }): Promise<{ id: number; versao: number }>;
}

export interface FiltroMovimentosPorta {
  readonly de: string;
  readonly ate: string;
  readonly tipo?: TipoMovimentoRoupa | null;
  readonly centroCusto?: number | null;
  readonly antesDe?: number | null;
  readonly teto?: number;
}

export interface SetorRouparia {
  readonly codigo: number;
  readonly nome: string;
  readonly ativo: boolean;
}

export interface PortaRouparia extends PortaGravacaoM18<GravadorRouparia> {
  relogio(c: ContextoPortaM18): Promise<{ hoje: string; agora: string }>;
  pecas(c: ContextoPortaM18): Promise<PecaRoupa[]>;
  cotas(c: ContextoPortaM18, centroCusto?: number | null): Promise<CotaRoupa[]>;
  movimentos(
    c: ContextoPortaM18,
    f: FiltroMovimentosPorta,
  ): Promise<{ itens: MovimentoRoupa[]; cortada: boolean }>;
  movimento(c: ContextoPortaM18, id: number): Promise<MovimentoRoupa | null>;
  enviosAbertos(c: ContextoPortaM18): Promise<MovimentoRoupa[]>;
  kgPorSetorDia(c: ContextoPortaM18, de: string, ate: string): Promise<KgSetorDia[]>;
  totais(c: ContextoPortaM18, de: string, ate: string): Promise<TotaisRoupariaLidos>;
  inventarios(c: ContextoPortaM18, ate: string): Promise<MovimentoRoupa[]>;
  /** Os setores (centros de custo) do estabelecimento, com os inativos marcados. */
  setores(c: ContextoPortaM18): Promise<SetorRouparia[]>;
  /** Os fornecedores pelo nome ou código (a lavanderia terceirizada), sem documento nem dado bancário. */
  fornecedores(c: ContextoPortaM18, termo: string): Promise<{ codigo: number; nome: string }[]>;
  fornecedorExiste(c: ContextoPortaM18, codigo: number): Promise<boolean>;
  /** Pacientes-dia do período (o censo diário fechado). */
  pacientesDia(c: ContextoPortaM18, de: string, ate: string): Promise<number>;
}

export const METODOS_PORTA_ROUPARIA: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'pecas',
  'cotas',
  'movimentos',
  'movimento',
  'enviosAbertos',
  'kgPorSetorDia',
  'totais',
  'inventarios',
  'setores',
  'fornecedores',
  'fornecedorExiste',
  'pacientesDia',
]);
