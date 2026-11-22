// Porta das obrigações da operadora própria com a ANS (M56, etapa 7, F6): o que a tela dos envios lê e grava,
// independente de onde (a API não escreve SQL):
//   - `banco`: a porta própria sobre o banco do cliente (envio_ans, envio_ans_item, envio_ans_retorno, operadora_saude,
//     beneficiario_plano), pelo @sgh/nucleo; gravação pelo Executor, com a trilha_auditoria e o outbox na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E), sobre as portas em memória da F1, da F2 e da F5;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Melhoria: o contexto é o do @sgh/nucleo (cliente, estabelecimento e usuário por id) e o estabelecimento de cada
// gravação vem da sessão, nunca da entrada.
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  type DadosAtivos,
  type DadosBeneficiarioDaOperadora,
  type DadosBeneficiarioRessarcimento,
  type DadosBeneficiarioSib,
  type DadosCobrancaDiops,
  type DadosComplementoSib,
  type DadosEnvioAns,
  type DadosEnvioAnsResumo,
  type DadosEnvioExistente,
  type DadosEventoEnvioAns,
  type DadosGuiaMonitoramento,
  type DadosItemEnvioAns,
  type DadosItemSip,
  type DadosObrigacao,
  type DadosOperadora,
  type DadosVigenciaSip,
  type EntradaComplementoSib,
  type EntradaGeracaoEnvio,
  type EntradaResultadoItem,
  type FiltroEnviosPorta,
  type TotaisEnvios,
} from './dados-portas.js';

export const PORTA_ANS_OPERADORA = Symbol('PORTA_ANS_OPERADORA');

/** O contexto da sessão: o do núcleo (ids) mais a rede e o código do estabelecimento (exibição). */
export type ContextoAns = ContextoPorta;

type SemHospital<T> = Omit<T, 'hospital'>;
type Feito = Promise<{ id: number; versao: number }>;

interface AcaoEnvio {
  readonly id: number;
  readonly versao: number;
  readonly usuario: string;
}

export interface ArquivoGravado {
  readonly nome: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly base64: string;
}

/** O que a gravação dos envios faz dentro da transação (com a trilha junto). */
export interface GravadorAns {
  gerar(g: SemHospital<EntradaGeracaoEnvio>): Feito;
  transmitir(a: AcaoEnvio & { recibo: string | null; arquivo?: ArquivoGravado | null; texto: string }): Feito;
  retorno(
    a: AcaoEnvio & {
      situacao: 'aceito' | 'aceitoParcial' | 'rejeitado';
      resumo: string | null;
      itens: readonly EntradaResultadoItem[];
      sib: boolean;
      texto: string;
    },
  ): Feito;
  pagar(a: AcaoEnvio & { gru: string; valor: number; data: string }): Feito;
  decidir(
    a: AcaoEnvio & {
      item: number;
      decisao: 'impugnar' | 'aceitar';
      motivo: string | null;
      justificativa: string | null;
      texto: string;
    },
  ): Feito;
  complemento(c: SemHospital<EntradaComplementoSib>): Feito;
}

export interface PortaAnsOperadora {
  readonly destino: 'banco' | 'memoria';
  /** O relógio do banco: hoje (AAAA-MM-DD) e agora (AAAA-MM-DDTHH:MM:SS). */
  relogio(c: ContextoAns): Promise<{ hoje: string; agora: string }>;
  operadoras(c: ContextoAns): Promise<DadosOperadora[]>;
  motivosSib(c: ContextoAns): Promise<{ codigo: number; nome: string; grupo: number }[]>;
  camposSib(c: ContextoAns): Promise<{ codigo: number; nome: string }[]>;
  valoresTps(c: ContextoAns): Promise<{ vigencia: string; valorAnual: number; valorTrimestral: number }[]>;
  gruposSip(c: ContextoAns): Promise<{ id: number; nome: string }[]>;
  envios(
    c: ContextoAns,
    f: FiltroEnviosPorta,
  ): Promise<{ itens: DadosEnvioAnsResumo[]; proxima: number | null }>;
  totais(c: ContextoAns): Promise<TotaisEnvios>;
  envio(c: ContextoAns, id: number): Promise<DadosEnvioAns | null>;
  arquivo(c: ContextoAns, id: number): Promise<{ nome: string; base64: string; sha256: string } | null>;
  itens(c: ContextoAns, id: number): Promise<DadosItemEnvioAns[]>;
  eventos(c: ContextoAns, id: number): Promise<DadosEventoEnvioAns[]>;
  existentes(
    c: ContextoAns,
    operadora: number,
    obrigacao: DadosObrigacao,
    competencia: string,
  ): Promise<DadosEnvioExistente[]>;
  beneficiariosSib(
    c: ContextoAns,
    operadora: number,
    apos: number,
  ): Promise<{ itens: DadosBeneficiarioSib[]; proxima: number | null }>;
  complementoSib(c: ContextoAns, beneficiario: number): Promise<DadosComplementoSib | null>;
  beneficiarioDaOperadora(c: ContextoAns, beneficiario: number): Promise<DadosBeneficiarioDaOperadora | null>;
  ativosNaData(c: ContextoAns, operadora: number, data: string): Promise<DadosAtivos[]>;
  planos(
    c: ContextoAns,
    operadora: number,
  ): Promise<{ produto: number; nome: string; registroAns: string | null }[]>;
  itensSip(
    c: ContextoAns,
    operadora: number,
    inicio: string,
    fim: string,
    apos: number,
  ): Promise<{ itens: DadosItemSip[]; proxima: number | null }>;
  vigenciasSip(c: ContextoAns, procedimentos: readonly number[]): Promise<DadosVigenciaSip[]>;
  cobrancasDiops(
    c: ContextoAns,
    operadora: number,
    meses: readonly string[],
    inicio: string,
    fim: string,
  ): Promise<DadosCobrancaDiops[]>;
  contasDiops(
    c: ContextoAns,
    operadora: number,
    inicio: string,
    fim: string,
  ): Promise<{
    contas: {
      recebidaEm: string;
      apresentado: number;
      glosado: number;
      situacao: 'recebida' | 'analisada' | 'paga' | 'devolvida';
    }[];
    pagamentos: { pagoEm: string; valor: number }[];
  }>;
  guiasMonitoramento(
    c: ContextoAns,
    operadora: number,
    inicio: string,
    fim: string,
    teto: number,
  ): Promise<DadosGuiaMonitoramento[]>;
  beneficiariosRessarcimento(
    c: ContextoAns,
    operadora: number,
    identificacoes: readonly string[],
  ): Promise<DadosBeneficiarioRessarcimento[]>;
  atendimentosJaCobrados(
    c: ContextoAns,
    atendimentos: readonly { tipo: string; numero: string }[],
  ): Promise<Set<string>>;
  gravar<T>(
    c: ContextoAns,
    trilha: RegistroTrilhaTela | ((r: T) => RegistroTrilhaTela),
    fn: (g: GravadorAns) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_ANS: ReadonlySet<string> = new Set([
  'relogio',
  'operadoras',
  'motivosSib',
  'camposSib',
  'valoresTps',
  'gruposSip',
  'envios',
  'totais',
  'envio',
  'arquivo',
  'itens',
  'eventos',
  'existentes',
  'beneficiariosSib',
  'complementoSib',
  'beneficiarioDaOperadora',
  'ativosNaData',
  'planos',
  'itensSip',
  'vigenciasSip',
  'cobrancasDiops',
  'contasDiops',
  'guiasMonitoramento',
  'beneficiariosRessarcimento',
  'atendimentosJaCobrados',
  'gravar',
]);
