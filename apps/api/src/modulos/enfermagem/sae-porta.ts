// Porta do processo de enfermagem, da prescrição de enfermagem, da receita do enfermeiro e da vacina aplicada (M45,
// etapa 4; ficha, seções 4, 5 e 7), independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: leituras READ ONLY (os domínios da escala e das metas, a terminologia carregada, o processo, as
//     atividades e as checagens, a consulta de enfermagem, o cabeçalho da receita, as receitas e as vacinas) e as
//     gravações só do novo numa transação SGH_ com a SGH_TRILHA junto (a vacina com o evento na fila de saída);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas recusas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Os internados, o relógio, os vínculos de enfermagem e a grade de horários vêm da porta da enfermagem (M25).
import type {
  ConsultaDeEnfermagem,
  AtividadeSaeNova,
  AtividadeVigente,
  CabecalhoReceita,
  ChecagemCuidadoNova,
  DiagnosticoSaeNovo,
  ReceitaEnfermeiroNova,
  ReceitaDoEnfermeiro,
  RetificacaoVacina,
  SaeDoAtendimento,
  TermoTerminologiaSae,
  VacinaAplicada,
  RecusaEnvioVacina,
  VacinaNova,
} from './sae-tipos.js';
import type { ChecagemCuidadoLida, SituacaoEvolucaoSae } from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_SAE = Symbol('PORTA_SAE');

export type ContextoSae = ContextoPortaM18;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto. */
export interface GravadorSae {
  registrarSae(p: {
    readonly paciente: number;
    readonly atendimento: number;
    readonly versaoVista: number;
    readonly sistema: 'SINT' | 'NNN' | 'CIPE';
    readonly versaoTerminologia: string;
    readonly avaliacao: string;
    readonly diagnosticos: readonly DiagnosticoSaeNovo[];
    readonly vinculo: number;
    readonly usuario: string;
    readonly chave: string | null;
  }): Promise<{ id: number; versao: number; itens: number; repetida: boolean }>;
  evoluir(x: {
    readonly sae: number;
    readonly paciente: number;
    readonly atendimento: number;
    readonly nota: string;
    readonly resultados: readonly {
      readonly resultado: number;
      readonly descricao: string;
      readonly escala: number;
      readonly situacao: SituacaoEvolucaoSae;
    }[];
    readonly vinculo: number;
    readonly usuario: string;
    readonly chave: string;
  }): Promise<{ ids: number[]; repetida: boolean }>;
  prescrever(x: {
    readonly sae: number;
    readonly paciente: number;
    readonly atendimento: number;
    readonly atividades: readonly AtividadeSaeNova[];
    readonly vinculo: number;
    readonly usuario: string;
    readonly chave: string;
  }): Promise<{ ids: number[]; repetida: boolean }>;
  suspender(x: {
    readonly atividade: number;
    readonly atendimento: number;
    readonly motivo: string;
    readonly vinculo: number;
    readonly usuario: string;
  }): Promise<number>;
  checar(c: ChecagemCuidadoNova): Promise<{ id: number; repetida: boolean }>;
  estornar(x: {
    readonly checagem: number;
    readonly atendimento: number;
    readonly motivo: string;
    readonly categoria: 'enfermeiro' | 'tecnico';
    readonly vinculo: number;
    readonly usuario: string;
  }): Promise<number>;
  carregarTerminologia(t: {
    readonly sistema: 'NNN' | 'CIPE';
    readonly versao: string;
    readonly licenca: string;
    readonly termos: readonly {
      readonly tipo: string;
      readonly codigo: string;
      readonly pai: string | null;
      readonly descricao: string;
      readonly risco: boolean;
    }[];
    readonly usuario: string;
  }): Promise<{ termos: number }>;
  prescreverMedicamento(r: ReceitaEnfermeiroNova): Promise<{ id: number; repetida: boolean }>;
  registrarVacina(
    v: VacinaNova,
  ): Promise<{ id: number; evento: string; repetida: boolean }>;
  /** W0-03: suspender ou cancelar a receita (fato novo; a original fica legível e inativa). */
  inativarReceita(r: {
    readonly id: number;
    readonly atendimento: number;
    readonly tipo: 'suspensao' | 'cancelamento';
    readonly motivo: string;
    readonly usuario: string;
  }): Promise<{ id: number; evento: number }>;
  /** W0-03: estornar ou retificar a vacina, com o evento RIA de cancelamento ou substituição na fila de saída. */
  corrigirVacina(v: {
    readonly id: number;
    readonly paciente: number;
    readonly tipo: 'estorno' | 'retificacao';
    readonly motivo: string;
    readonly dados: RetificacaoVacina | null;
    readonly usuario: string;
    /** A chave do pedido: o reenvio da mesma correção é reconhecido (sem segunda retificação nem segundo evento). */
    readonly chave?: string | null | undefined;
  }): Promise<{ id: number; versao: number; evento: string; outbox: string }>;
}

export interface PortaSae extends PortaGravacaoM18<GravadorSae> {
  dominios(
    c: ContextoSae,
  ): Promise<{ escala: { codigo: number; rotulo: string }[]; metas: { codigo: number; rotulo: string }[] }>;
  terminologia(c: ContextoSae): Promise<TermoTerminologiaSae[]>;
  sae(c: ContextoSae, atendimento: number): Promise<SaeDoAtendimento>;
  atividadesVigentes(c: ContextoSae, atendimentos: readonly number[]): Promise<AtividadeVigente[]>;
  atividade(
    c: ContextoSae,
    id: number,
  ): Promise<
    (AtividadeVigente & { readonly paciente: number; readonly revisadoEm: string | null }) | null
  >;
  checagens(
    c: ContextoSae,
    o: { readonly atividades: readonly number[]; readonly de: string; readonly ate: string },
  ): Promise<{ itens: (ChecagemCuidadoLida & { atendimento: number })[]; cortada: boolean }>;
  checagem(c: ContextoSae, id: number): Promise<(ChecagemCuidadoLida & { atendimento: number }) | null>;
  consulta(c: ContextoSae, atendimento: number): Promise<ConsultaDeEnfermagem | null>;
  consultasDoProfissional(
    c: ContextoSae,
    o: { readonly vinculos: readonly number[]; readonly dia: string },
  ): Promise<
    { atendimento: number; paciente: number; numero: number; nome: string; entrada: string | null }[]
  >;
  /** Os atendimentos externos ativos do dia (a escolha da sala de vacina), os mais recentes primeiro, até o teto. */
  externosDoDia(
    c: ContextoSae,
    dia: string,
  ): Promise<{
    itens: { atendimento: number; paciente: number; numero: number; nome: string; entrada: string | null }[];
    cortada: boolean;
  }>;
  cabecalhoReceita(
    c: ContextoSae,
    o: { readonly paciente: number; readonly vinculo: number },
  ): Promise<CabecalhoReceita>;
  receitas(c: ContextoSae, atendimento: number): Promise<ReceitaDoEnfermeiro[]>;
  vacinas(c: ContextoSae, paciente: number): Promise<VacinaAplicada[]>;
  /** W0-03 (M6): o monitor de recusas do RIA (os envios que a RNDS recusou ou que não chegaram). */
  recusasRia(c: ContextoSae): Promise<RecusaEnvioVacina[]>;
}

export const METODOS_PORTA_SAE: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'dominios',
  'terminologia',
  'sae',
  'atividadesVigentes',
  'atividade',
  'checagens',
  'checagem',
  'consulta',
  'consultasDoProfissional',
  'externosDoDia',
  'cabecalhoReceita',
  'receitas',
  'vacinas',
  'recusasRia',
]);
