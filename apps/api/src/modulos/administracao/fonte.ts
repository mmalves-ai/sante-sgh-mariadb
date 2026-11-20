// Fonte das telas do M10 (Administração › Acesso, Organização e parâmetros, Auditoria e privacidade; Cadastros ›
// Estrutura): onde as leituras e as gravações acontecem.
//   - `legado`: o núcleo do legado. Leituras READ ONLY; gravações no banco só pelas receitas do EXECUTOR do M04
//     (com a trilha dupla e, no "como" e no acesso total, a imagem antes/depois para o Corrigir); as SGH_ (escopo
//     de setor, pedidos do titular, revisão da quebra de vidro) pela transação SGH_ com a SGH_TRILHA. Em dev sobre
//     a cópia compartilhada (ACESSO_FONTE_DEV=copia), as receitas do banco ficam desligadas (POL-3, motivo
//     visível): o COMMIT na cópia só acontece sob a trava, nos testes (ADR 0021, decisão 20).
//   - `memoria`: a sessão sintética (dev/ci; E2E), com as mesmas regras e recusas (fonte-memoria.ts).
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo (nunca cai calada na memória).
import {
  type AcessoProntuarioLido,
  type ConexaoLida,
  type ContextoOperacao,
  concederSetor,
  type FiltroRegistros,
  lerConexoes,
  lerRegistrosExclusao,
  pacientesDoProntuario,
  type RegistroAuditoria,
  type RegistroExclusaoLido,
  type ConfigLogin,
  type DecisaoPedido,
  type EspelhoLegado,
  type EstruturaLegado,
  type Executor,
  type FichaUsuarioLegado,
  type FiltroTrilha,
  type FiltroUsuarios,
  type FonteCatalogo,
  gravarRevisaoQuebraVidro,
  hojeDoBancoCivil,
  type ItemEscopoLegado,
  type LeitosLegado,
  type LinhaTrilhaLida,
  type LocaisComplementos,
  lerLeiturasProntuarioTrilha,
  lerAlertas,
  lerBackup,
  lerConfigLogin,
  lerDadosFiscais,
  lerEspelhoLeitos,
  lerEstrutura,
  lerExclusoes,
  lerFichaUsuario,
  type ContaCpfLegado,
  type ContaRedeLegado,
  lerContasCpfRepetido,
  lerContasDoCpf,
  lerContasSemCpf,
  lerGruposLegado,
  lerLeitos,
  lerLocaisComplementos,
  lerModulosLegado,
  lerOpcoesEscopo,
  lerOpcoesLegado,
  lerParametrosBanco,
  lerPermissoesGrupos,
  lerPermissoesPapeis,
  lerPapeisLegado,
  lerQuebrasVidro,
  lerServidorEmail,
  lerSetoresDoUsuario,
  lerTiposAcao,
  lerTiposAcessoProntuario,
  lerTrilhaLegado,
  lerTrilhaPropria,
  lerTermoAceito,
  lerTermoVigente,
  lerVersaoTermo,
  lerVersoesTermo,
  type VersaoTermoDetalhe,
  type VersaoTermoLida,
  lerUsuariosPorPapel,
  listarPedidosTitular,
  listarUsuarios,
  type ModuloLegado,
  type NovoPedido,
  type NucleoLegado,
  type OpcaoLegado,
  operacao,
  type TabelaParametrosLida,
  type PedidoSetor,
  type PedidoTitularLido,
  type QuebraVidroLida,
  registrarPedidoTitular,
  retirarSetor,
  type AlertaLegado,
  type DadosFiscaisLegado,
  type ServidorEmailLegado,
  TABELAS_PARAMETROS_BANCO,
  type TrilhaGestao,
  tratarPedidoTitular,
  type UsuarioLinhaLegado,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { DESLIGADA_DEV_COPIA, estadoDaReceita, type EstadoReceita } from '../acesso/gestao-fonte.js';

export const FONTE_ADMINISTRACAO = Symbol('FONTE_ADMINISTRACAO');

export interface Ctx {
  readonly rede: string;
  readonly hospital: string;
  readonly traceId: string;
}

export interface GrupoLido {
  readonly nome: string;
  readonly ativo: boolean;
  readonly usuariosAtivos: number;
}

export interface FonteAdministracao {
  readonly destino: 'legado' | 'memoria';
  // ── Acesso ───────────────────────────────────────────────────────────────────────────────────
  listarUsuarios(c: Ctx, f: FiltroUsuarios): Promise<{ itens: UsuarioLinhaLegado[]; total: number }>;
  /** W1-01 (parte 3c): contas ativas sem CPF e logins com CPF repetido (o número do CPF nunca sai). */
  painelCpf(
    c: Ctx,
  ): Promise<{ semCpf: ContaCpfLegado[]; duplicadas: (ContaCpfLegado & { chave: string })[] }>;
  /** W1-01 (parte 11c): a rede desta hospedagem e os seus estabelecimentos configurados (ARQ-1). */
  redeDoAcesso(c: Ctx): { rede: string | null; estabelecimentos: { codigo: string; nome: string }[] };
  /** W1-01 (parte 11c): as contas com o CPF no banco de `c.hospital` (uma leitura por banco), com os perfis SGH_. */
  contasDoCpf(c: Ctx, cpf: string): Promise<ContaRedeLegado[]>;
  /** `opcoes.cpf`: lê também o número do CPF (só a ficha aberta pela conta da plataforma pede). */
  fichaUsuario(
    c: Ctx,
    login: string,
    auditor: boolean,
    opcoes?: { readonly cpf?: boolean },
  ): Promise<FichaUsuarioLegado | null>;
  opcoesEscopo(c: Ctx): Promise<Record<string, ItemEscopoLegado[]>>;
  setores(c: Ctx, login: string): Promise<ItemEscopoLegado[]>;
  grupos(c: Ctx): Promise<GrupoLido[]>;
  /** Receita do banco pelo executor (ou, em memória, as mesmas regras); devolve o resultado da receita. */
  executar(nome: string, entrada: unknown, ctx: ContextoOperacao): Promise<Record<string, unknown>>;
  receita(nome: string, hospital: string): EstadoReceita;
  setor(c: Ctx, p: PedidoSetor, acao: 'conceder' | 'retirar', t: TrilhaGestao): Promise<void>;
  arvore(c: Ctx): Promise<{ opcoes: OpcaoLegado[]; modulos: ModuloLegado[] }>;
  opcoesDoGrupo(c: Ctx, grupo: string): Promise<number[]>;
  opcoesDoPapel(c: Ctx, papel: number): Promise<number[]>;
  papeis(c: Ctx): Promise<{ papel: number; nome: string; usuariosAtivos: number; opcoes: number }[]>;
  politica(c: Ctx): Promise<ConfigLogin>;
  tiposAcessoProntuario(c: Ctx): Promise<{ id: number; descricao: string }[]>;
  termoVigente(c: Ctx): Promise<{
    id: number;
    texto: string;
    desde: string;
    aceites: number;
    ultimos: { login: string; em: string }[];
  } | null>;
  termoAceito(c: Ctx, login: string, termo: number): Promise<boolean>;
  /** W1-01 (parte 6b): as versões do termo (PRTERMOCAD), a mais nova primeiro, com a contagem de aceites. */
  versoesTermo(c: Ctx): Promise<VersaoTermoLida[]>;
  /** W1-01 (parte 6b): uma versão com o texto e uma página dos aceites (os da anterior seguem consultáveis). */
  versaoTermo(c: Ctx, id: number, pagina: number): Promise<VersaoTermoDetalhe | null>;
  quebras(c: Ctx): Promise<QuebraVidroLida[]>;
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
  estrutura(c: Ctx): Promise<EstruturaLegado>;
  leitos(c: Ctx): Promise<LeitosLegado>;
  espelho(c: Ctx): Promise<EspelhoLegado>;
  locaisComplementos(c: Ctx): Promise<LocaisComplementos>;
  // ── Consultas ────────────────────────────────────────────────────────────────────────────────
  alertas(c: Ctx): Promise<AlertaLegado[]>;
  email(c: Ctx): Promise<ServidorEmailLegado>;
  fiscais(c: Ctx): Promise<DadosFiscaisLegado | null>;
  backup(c: Ctx): Promise<{
    situacoes: { id: number; descricao: string }[];
    procedimentos: { id: number; descricao: string }[];
  }>;
  parametrosBanco(c: Ctx, chave: string, login: string): Promise<TabelaParametrosLida | null>;
  // ── Auditoria ────────────────────────────────────────────────────────────────────────────────
  trilhaLegado(c: Ctx, f: FiltroTrilha): Promise<LinhaTrilhaLida[]>;
  trilhaPropria(c: Ctx, f: FiltroTrilha): Promise<LinhaTrilhaLida[]>;
  acessosProntuario(c: Ctx, f: FiltroTrilha): Promise<AcessoProntuarioLido[]>;
  /** IDs dos pacientes do prontuário digitado (até 2: o segundo aponta o prontuário repetido). */
  pacientesDoProntuario(c: Ctx, prontuario: number): Promise<number[]>;
  tiposAcao(c: Ctx): Promise<{ id: number; nome: string }[]>;
  exclusoes(c: Ctx, inicio: string, fimExclusivo: string): ReturnType<typeof lerExclusoes>;
  /** Linhas de um tipo de exclusão no período (uma a mais que a página, para o "tem mais"). */
  registrosExclusao(c: Ctx, r: RegistroAuditoria, f: FiltroRegistros): Promise<RegistroExclusaoLido[]>;
  conexoes(c: Ctx, f: FiltroRegistros): Promise<ConexaoLida[]>;
  pedidos(c: Ctx): Promise<PedidoTitularLido[]>;
  registrarPedido(c: Ctx, p: NovoPedido, t: TrilhaGestao): Promise<{ id: string; protocolo: string }>;
  tratarPedido(c: Ctx, d: DecisaoPedido, t: TrilhaGestao): Promise<{ id: string; situacao: string }>;
  /** Data civil (AAAA-MM-DD) do banco do estabelecimento. */
  hoje(c: Ctx): Promise<string>;
}

export function fonteAdministracaoLegado(
  nucleo: NucleoLegado,
  executor: Executor,
  catalogo: FonteCatalogo,
  ambiente: string,
  opcoes: { receitasDesligadas?: boolean } = {},
): FonteAdministracao {
  const ler = <T>(c: Ctx, fn: Parameters<NucleoLegado['lerSomente']>[1]) =>
    nucleo.lerSomente(c, fn) as Promise<T>;
  const receita = (nome: string, hospital: string): EstadoReceita =>
    opcoes.receitasDesligadas
      ? { estado: catalogo.estado(nome, hospital), ligada: false, motivo: DESLIGADA_DEV_COPIA }
      : estadoDaReceita(catalogo, nome, hospital, ambiente);
  return {
    destino: 'legado',
    listarUsuarios: (c, f) => ler(c, (l) => listarUsuarios(l, f)),
    painelCpf: (c) =>
      ler(c, async (l) => ({ semCpf: await lerContasSemCpf(l), duplicadas: await lerContasCpfRepetido(l) })),
    redeDoAcesso: () => ({
      rede: nucleo.rede,
      estabelecimentos: nucleo.estabelecimentos.map((e) => ({ codigo: e.codigo, nome: e.nome })),
    }),
    contasDoCpf: (c, cpf) => ler(c, (l) => lerContasDoCpf(l, cpf)),
    fichaUsuario: (c, login, auditor, opcoes) =>
      ler(c, (l) => lerFichaUsuario(l, login, { auditor, cpf: opcoes?.cpf === true })),
    opcoesEscopo: (c) => ler(c, (l) => lerOpcoesEscopo(l)),
    setores: (c, login) => ler(c, (l) => lerSetoresDoUsuario(l, c.hospital, login)),
    grupos: (c) => ler(c, (l) => lerGruposLegado(l)),
    async executar(nome, entrada, ctx) {
      const r = receita(nome, ctx.hospital);
      if (!r.ligada)
        throw new ErroProblema('operacao-bloqueada', 409, 'Operação desligada', r.motivo ?? undefined, {
          codigo: 'operacao-desligada',
        });
      const x = await executor.executar(operacao(nome), ctx.hospital, entrada, ctx);
      return (x as { resultado?: Record<string, unknown> }).resultado ?? {};
    },
    receita,
    async setor(c, p, acao, t) {
      await nucleo.gravarSgh(c, (e) =>
        acao === 'conceder' ? concederSetor(e, p, t) : retirarSetor(e, p, t),
      );
    },
    arvore: (c) =>
      ler(c, async (l) => ({ opcoes: await lerOpcoesLegado(l), modulos: await lerModulosLegado(l) })),
    opcoesDoGrupo: (c, grupo) =>
      ler(c, async (l) =>
        (await lerPermissoesGrupos(l)).filter((p) => p.grupo === grupo).map((p) => p.opcao),
      ),
    opcoesDoPapel: (c, papel) =>
      ler(c, async (l) =>
        (await lerPermissoesPapeis(l)).filter((p) => p.papel === papel).map((p) => p.opcao),
      ),
    papeis: (c) =>
      ler(c, async (l) => {
        const [ps, n] = [await lerPapeisLegado(l), await lerUsuariosPorPapel(l)];
        return ps.map((p) => ({
          papel: p.papel,
          nome: p.nome,
          opcoes: p.opcoes.length,
          usuariosAtivos: n.get(p.papel) ?? 0,
        }));
      }),
    politica: (c) => ler(c, (l) => lerConfigLogin(l)),
    tiposAcessoProntuario: (c) => ler(c, (l) => lerTiposAcessoProntuario(l)),
    termoVigente: (c) => ler(c, (l) => lerTermoVigente(l, true)),
    termoAceito: (c, login, termo) => ler(c, (l) => lerTermoAceito(l, login, termo)),
    versoesTermo: (c) => ler(c, (l) => lerVersoesTermo(l)),
    versaoTermo: (c, id, pagina) => ler(c, (l) => lerVersaoTermo(l, id, pagina)),
    quebras: (c) => ler(c, (l) => lerQuebrasVidro(l, c.hospital)),
    revisarQuebra: (c, r, t) =>
      nucleo.gravarSgh(c, (e) =>
        gravarRevisaoQuebraVidro(e, { rede: c.rede, hospital: c.hospital, ...r }, t),
      ),
    estrutura: (c) => ler(c, (l) => lerEstrutura(l)),
    leitos: (c) => ler(c, (l) => lerLeitos(l)),
    espelho: (c) => ler(c, (l) => lerEspelhoLeitos(l)),
    locaisComplementos: (c) => ler(c, (l) => lerLocaisComplementos(l)),
    alertas: (c) => ler(c, (l) => lerAlertas(l)),
    email: (c) => ler(c, (l) => lerServidorEmail(l)),
    fiscais: (c) => ler(c, (l) => lerDadosFiscais(l)),
    backup: (c) => ler(c, (l) => lerBackup(l)),
    parametrosBanco: (c, chave, login) => {
      const t = TABELAS_PARAMETROS_BANCO.find((x) => x.chave === chave);
      return t ? ler(c, (l) => lerParametrosBanco(l, t, login)) : Promise.resolve(null);
    },
    trilhaLegado: (c, f) => ler(c, (l) => lerTrilhaLegado(l, f)),
    trilhaPropria: (c, f) => ler(c, (l) => lerTrilhaPropria(l, f)),
    acessosProntuario: (c, f) => ler(c, (l) => lerLeiturasProntuarioTrilha(l, f)),
    pacientesDoProntuario: (c, prontuario) => ler(c, (l) => pacientesDoProntuario(l, prontuario)),
    tiposAcao: (c) => ler(c, (l) => lerTiposAcao(l)),
    exclusoes: (c, inicio, fim) => ler(c, (l) => lerExclusoes(l, inicio, fim)),
    registrosExclusao: (c, r, f) => ler(c, (l) => lerRegistrosExclusao(l, r, f)),
    conexoes: (c, f) => ler(c, (l) => lerConexoes(l, f)),
    pedidos: (c) => ler(c, (l) => listarPedidosTitular(l, c.hospital)),
    registrarPedido: (c, p, t) => nucleo.gravarSgh(c, (e) => registrarPedidoTitular(e, p, t)),
    tratarPedido: (c, d, t) => nucleo.gravarSgh(c, (e) => tratarPedidoTitular(e, c.hospital, d, t)),
    hoje: (c) => ler(c, (l) => hojeDoBancoCivil(l)),
  };
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
      if (p === 'destino') return 'legado';
      if (p === 'redeDoAcesso') return () => ({ rede: null, estabelecimentos: [] });
      if (p === 'receita')
        return () => ({ estado: null, ligada: false, motivo: 'Banco do estabelecimento não configurado.' });
      return r;
    },
  });
}
