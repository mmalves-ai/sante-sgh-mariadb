// Fonte das telas do M10 (Administração › Acesso, Organização e parâmetros, Auditoria e privacidade; Cadastros ›
// Estrutura): onde as leituras e as gravações acontecem.
//   - `banco`: o banco próprio do cliente (fonte-propria.ts): leituras pelo Leitor do @sgh/nucleo e gravações pelo
//     Executor (trilha, saída e idempotência na mesma transação).
//   - `memoria`: a sessão sintética (dev/ci; E2E), com as mesmas regras e recusas (fonte-memoria.ts).
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo (nunca cai calada na memória).
// Melhoria: o "espelho" das tabelas de origem, a segunda trilha e o visor cru de tabelas de parâmetros saíram
// (ADR 0003); a trilha é uma só e os parâmetros são os da configuração do produto.
import { ErroProblema } from '../../problema.filter.js';
import type {
  AcaoMenu,
  AcessoProntuarioLido,
  AlertaLido,
  BackupLido,
  ConexaoLida,
  ContaCpf,
  ContaRede,
  ContextoGestao,
  Ctx,
  DadosFiscaisLidos,
  DecisaoPedido,
  EstadoOperacaoGestao,
  EstruturaLida,
  ExclusoesLidas,
  FichaUsuario,
  FiltroRegistros,
  FiltroTrilha,
  FiltroUsuarios,
  GrupoLido,
  ItemEscopo,
  LeitosLidos,
  LinhaTrilhaLida,
  LocaisComplementos,
  ModuloSistema,
  NovoPedido,
  PedidoSetor,
  PedidoTitularLido,
  PoliticaLogin,
  QuebraVidro,
  RegistroAuditoria,
  RegistroExclusaoLido,
  ServidoresEmail,
  TermoVigenteLido,
  TrilhaGestao,
  UsuarioLinha,
  VersaoTermoDetalhe,
  VersaoTermoLida,
} from './tipos.js';

export type { Ctx, GrupoLido } from './tipos.js';

export const FONTE_ADMINISTRACAO = Symbol('FONTE_ADMINISTRACAO');

export interface FonteAdministracao {
  readonly destino: 'banco' | 'memoria';
  // ── Acesso ───────────────────────────────────────────────────────────────────────────────────
  listarUsuarios(c: Ctx, f: FiltroUsuarios): Promise<{ itens: UsuarioLinha[]; total: number }>;
  /** Contas ativas sem CPF e logins com CPF repetido (o número do CPF nunca sai). */
  painelCpf(c: Ctx): Promise<{ semCpf: ContaCpf[]; duplicadas: (ContaCpf & { chave: string })[] }>;
  /** A rede desta hospedagem e os seus estabelecimentos (ARQ-1). */
  redeDoAcesso(c: Ctx): { rede: string | null; estabelecimentos: { codigo: string; nome: string }[] };
  /** As contas com o CPF no estabelecimento `c.hospital`, com os perfis. */
  contasDoCpf(c: Ctx, cpf: string): Promise<ContaRede[]>;
  /** `opcoes.cpf`: lê também o número do CPF (só a ficha aberta pela conta da plataforma pede). */
  fichaUsuario(
    c: Ctx,
    login: string,
    auditor: boolean,
    opcoes?: { readonly cpf?: boolean },
  ): Promise<FichaUsuario | null>;
  opcoesEscopo(c: Ctx): Promise<Record<string, ItemEscopo[]>>;
  setores(c: Ctx, login: string): Promise<ItemEscopo[]>;
  grupos(c: Ctx): Promise<GrupoLido[]>;
  /** Operação de gravação da gestão pelo Executor (ou, em memória, as mesmas regras); devolve o resultado. */
  executar(nome: string, entrada: unknown, ctx: ContextoGestao): Promise<Record<string, unknown>>;
  /** A operação existe neste destino? (desligada: sem implementação ainda, com o motivo visível). */
  receita(nome: string, hospital: string): EstadoOperacaoGestao;
  setor(c: Ctx, p: PedidoSetor, acao: 'conceder' | 'retirar', t: TrilhaGestao): Promise<void>;
  arvore(c: Ctx): Promise<{ opcoes: AcaoMenu[]; modulos: ModuloSistema[] }>;
  opcoesDoGrupo(c: Ctx, grupo: string): Promise<number[]>;
  opcoesDoPapel(c: Ctx, papel: number): Promise<number[]>;
  papeis(c: Ctx): Promise<{ papel: number; nome: string; usuariosAtivos: number; opcoes: number }[]>;
  politica(c: Ctx): Promise<PoliticaLogin>;
  tiposAcessoProntuario(c: Ctx): Promise<{ id: number; descricao: string }[]>;
  termoVigente(c: Ctx): Promise<TermoVigenteLido | null>;
  termoAceito(c: Ctx, login: string, termo: number): Promise<boolean>;
  /** As versões do termo, a mais nova primeiro, com a contagem de aceites. */
  versoesTermo(c: Ctx): Promise<VersaoTermoLida[]>;
  /** Uma versão com o texto e uma página dos aceites. */
  versaoTermo(c: Ctx, id: number, pagina: number): Promise<VersaoTermoDetalhe | null>;
  quebras(c: Ctx): Promise<QuebraVidro[]>;
  revisarQuebra(
    c: Ctx,
    r: {
      idEmergencia: string;
      idUsuario: number;
      login: string;
      classificacao: 'justificado' | 'nao-justificado';
    },
    t: TrilhaGestao,
  ): Promise<string>;
  // ── Estrutura ────────────────────────────────────────────────────────────────────────────────
  estrutura(c: Ctx): Promise<EstruturaLida>;
  leitos(c: Ctx): Promise<LeitosLidos>;
  locaisComplementos(c: Ctx): Promise<LocaisComplementos>;
  // ── Consultas ────────────────────────────────────────────────────────────────────────────────
  alertas(c: Ctx): Promise<AlertaLido[]>;
  email(c: Ctx): Promise<ServidoresEmail>;
  fiscais(c: Ctx): Promise<DadosFiscaisLidos | null>;
  backup(c: Ctx): Promise<BackupLido>;
  // ── Auditoria ────────────────────────────────────────────────────────────────────────────────
  trilha(c: Ctx, f: FiltroTrilha): Promise<LinhaTrilhaLida[]>;
  acessosProntuario(c: Ctx, f: FiltroTrilha): Promise<AcessoProntuarioLido[]>;
  /** IDs dos pacientes do prontuário digitado (até 2: o segundo aponta o prontuário repetido). */
  pacientesDoProntuario(c: Ctx, prontuario: number): Promise<number[]>;
  exclusoes(c: Ctx, inicio: string, fimExclusivo: string): Promise<ExclusoesLidas>;
  /** Linhas de um tipo de exclusão no período (uma a mais que a página, para o "tem mais"). */
  registrosExclusao(c: Ctx, r: RegistroAuditoria, f: FiltroRegistros): Promise<RegistroExclusaoLido[]>;
  conexoes(c: Ctx, f: FiltroRegistros): Promise<ConexaoLida[]>;
  pedidos(c: Ctx): Promise<PedidoTitularLido[]>;
  registrarPedido(c: Ctx, p: NovoPedido, t: TrilhaGestao): Promise<{ id: string; protocolo: string }>;
  tratarPedido(c: Ctx, d: DecisaoPedido, t: TrilhaGestao): Promise<{ id: string; situacao: string }>;
  /** Data civil (AAAA-MM-DD) do estabelecimento. */
  hoje(c: Ctx): Promise<string>;
}

export function fonteAdministracaoIndisponivel(): FonteAdministracao {
  const recusar = async (): Promise<never> => {
    throw new ErroProblema(
      'indisponivel',
      503,
      'Banco do estabelecimento indisponível',
      'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
    );
  };
  const r = recusar as never;
  return new Proxy({} as FonteAdministracao, {
    get(_t, p) {
      // Nada de Promise nem ganchos do Nest (onModuleInit, beforeApplicationShutdown…): só os métodos da fonte.
      if (typeof p === 'symbol' || p === 'then' || /^(on|before)[A-Z]/.test(p) || p === 'constructor')
        return undefined;
      if (p === 'destino') return 'banco';
      if (p === 'redeDoAcesso') return () => ({ rede: null, estabelecimentos: [] });
      if (p === 'receita')
        return () => ({ estado: null, ligada: false, motivo: 'Banco do estabelecimento não configurado.' });
      return r;
    },
  });
}
