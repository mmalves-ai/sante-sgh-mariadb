// Porta do construtor de formulários novos (M45, etapa 1; ficha, seções 4, 5 e 7), independente de onde (a API não
// escreve SQL; fronteira Nx):
//   - `legado`: leituras READ ONLY (SGH_PEP_FORMNOVO e a definição dos modelos do prontuário: códigos em uso, banco de
//     perguntas, especialidades) e as gravações só do novo numa transação SGH_ com a SGH_TRILHA junto; a publicação como
//     modelo do prontuário pelo executor (`pep.publicarFormularioNovo`, desligada até o cenário do M36);
//   - `memoria`: a sessão sintética de dev/ci (E2E): versões SINTÉTICAS em memória, com as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type { EspecialidadeLida, EventoFormularioNovoLido, FormularioNovoLido, MudancaFormularioNovo, PerguntaDoBancoLida, RespostaCadastradaLida, SalvarFormularioNovo } from './tipos-pep.js';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_FORMULARIO_NOVO = Symbol('PORTA_FORMULARIO_NOVO');

export type ContextoFormularioNovo = ContextoPortaM18;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto. */
export interface GravadorFormularioNovo {
  salvar(
    p: Omit<SalvarFormularioNovo, 'hospital'>,
  ): Promise<{ id: number; versao: number; versaoLinha: string }>;
  mudar(m: Omit<MudancaFormularioNovo, 'hospital'>): Promise<{ versaoLinha: string }>;
}

export interface PortaFormularioNovo extends PortaGravacaoM18<GravadorFormularioNovo> {
  versoes(c: ContextoFormularioNovo): Promise<FormularioNovoLido[]>;
  versao(c: ContextoFormularioNovo, id: number): Promise<FormularioNovoLido | null>;
  eventos(c: ContextoFormularioNovo, id: number): Promise<EventoFormularioNovoLido[]>;
  /** Códigos de modelo do prontuário em uso e os do construtor (nunca reaproveitados). */
  codigosEmUso(c: ContextoFormularioNovo): Promise<Set<string>>;
  buscarPerguntas(
    c: ContextoFormularioNovo,
    termo: string,
    tiposperg: readonly string[],
  ): Promise<PerguntaDoBancoLida[]>;
  especialidades(c: ContextoFormularioNovo): Promise<EspecialidadeLida[]>;
  /** Hoje no relógio do banco (AAAA-MM-DD), para as regras com data. */
  hoje(c: ContextoFormularioNovo): Promise<string>;
  /**
   * O que o plano da publicação como modelo do prontuário precisa ler (relido depois na transação da receita): os
   * códigos em uso (os do prontuário e os dos outros formulários novos), as perguntas reaproveitadas e as respostas
   * cadastradas com os textos das opções.
   */
  dadosDoPlano(
    c: ContextoFormularioNovo,
    codigo: string,
    reusos: readonly number[],
    textos: readonly string[],
  ): Promise<{
    codigosExistentes: Set<string>;
    banco: PerguntaDoBancoLida[];
    respostasCadastradas: RespostaCadastradaLida[];
  }>;
}

export const METODOS_PORTA_FORMULARIO_NOVO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'versoes',
  'versao',
  'eventos',
  'codigosEmUso',
  'buscarPerguntas',
  'especialidades',
  'hoje',
  'dadosDoPlano',
]);
