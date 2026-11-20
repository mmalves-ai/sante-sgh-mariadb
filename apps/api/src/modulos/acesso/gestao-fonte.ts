// Fonte da tela "Perfis e permissões" (ADR 0022): onde as leituras e as gravações acontecem.
//   - `legado`: o núcleo do legado. Leituras READ ONLY; perfis e mapa pela transação SGH_ (gravarSgh, com a
//     SGH_TRILHA na mesma transação); permissões do PRÓPRIO legado só pelas receitas do EXECUTOR do M04 (com a
//     trilha dupla e, no "como" e no acesso total, a imagem antes/depois para o Corrigir). Em dev sobre a cópia
//     compartilhada (ACESSO_FONTE_DEV=copia), as receitas do legado ficam desligadas (POL-3, motivo visível): o
//     COMMIT no SPDATA da cópia só acontece sob a trava, pelos testes (ADR 0021, decisão 20).
//   - `memoria`: a sessão sintética (dev/ci; E2E): o estado sintético do acesso, com as mesmas regras e recusas
//     das receitas; a trilha vai ao registrador da API. Nada vai à cópia.
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo (nunca cai calada na memória).
import type { EstadoOperacao } from '@sgh/contratos';
import {
  type AlteracaoPerfilConcedido,
  type AlteracaoPerfilLida,
  alterarConcessaoPerfil,
  buscarUsuariosGestao,
  type ConsultaCandidatosMapa,
  type ContextoOperacao,
  type DecisaoMapaLida,
  decidirMapaOpcao,
  type DecisaoMapa,
  cancelarPoliticaSenha,
  type DescricaoGrupoLida,
  gravarDescricaoGrupo,
  lerVersoesPoliticaSenha,
  definirLimiteSessao,
  lerHistoricoLimitesSessao,
  type ContaDormenciaLegado,
  type ConferenciaConselhoLida,
  lerConferenciasConselho,
  lerRegistrosConselhoDoUsuario,
  type NovaConferenciaConselho,
  type RegistroConselhoUsuario,
  registrarConferenciaConselho,
  type ExcecaoDormenciaLida,
  lerContasParaDormencia,
  lerHistoricoExcecoesDormencia,
  type NovaExcecaoDormencia,
  registrarExcecaoDormencia,
  abrirCampanhaRecert,
  type CampanhaRecertLida,
  type ContaRecertLegado,
  type DecisaoRecertGravar,
  type FechamentoRecertGravar,
  fecharCampanhaRecert,
  type ItemRecertLido,
  lerCampanhaRecert,
  lerCampanhasRecert,
  lerContasParaRecert,
  type NovaCampanhaRecertGravar,
  registrarDecisaoRecert,
  type ValidarDecisaoRecert,
  cancelarPedidoAcesso,
  type DadosRhLidos,
  definirPerfilCargoRh,
  lerDadosRh,
  type NovaResolucaoRh,
  type NovoPerfilCargoRh,
  registrarResolucaoRh,
  decidirEConcederPedidoAcesso,
  concederPedidoAprovado,
  type DecisaoPedidoAcessoGravar,
  type FiltroPedidosAcesso,
  lerPedidoAcesso,
  lerPedidosAcesso,
  type NovoPedidoAcessoGravar,
  type PedidoAcessoGravado,
  registrarConcessaoPedido,
  registrarPedidoAcesso,
  type SituacaoPedidoAcesso,
  type ValidarPedidoAcesso,
  type NovoLimiteSessao,
  type RegistroLimiteSessaoLido,
  type NovaPoliticaSenha,
  publicarPoliticaSenha,
  type VersaoPoliticaSenhaLida,
  ErroOperacao,
  type Executor,
  type FonteCatalogo,
  gravarConcessaoPerfil,
  type ConcessaoPerfilNova,
  type GestorAcessoLido,
  lerGestoresAcesso,
  lerGruposLegado,
  lerAlteracoesPerfil,
  lerCandidatosMapa,
  lerDecisoesMapa,
  lerHistoricoPerfis,
  lerMapaOpcao,
  lerPapeisDoUsuario,
  lerPapeisLegado,
  lerPermissoesGrupos,
  lerUsuarioGestao,
  lerVersoesDescricaoGrupo,
  type LinhaMapaLida,
  type NovaDescricaoGrupo,
  type NucleoLegado,
  operacao,
  type PapelLegado,
  type PapelUsuarioLegado,
  type PerfilConcedidoLido,
  type ResultadoAlteracaoPerfil,
  revogarConcessaoPerfil,
  type TrilhaGestao,
  type UsuarioGestaoLegado,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { CONTAS_SINTETICAS, estadoAcessoSintetico } from './fonte-sintetica.js';
import type { ValidarResolucaoRhMemoria } from './rh-memoria.js';

export const FONTE_GESTAO = Symbol('FONTE_GESTAO');

export interface GrupoGestaoLido {
  readonly nome: string;
  readonly ativo: boolean;
  readonly opcoes: readonly number[];
}

/** POL-3: a receita do legado desligada neste estabelecimento, com o motivo para a pessoa. */
export interface EstadoReceita {
  readonly estado: EstadoOperacao | null;
  readonly ligada: boolean;
  readonly motivo: string | null;
}

/** A concessão do perfil que acompanha a aprovação do 2º nível (achado 2 da revisão). */
export interface ConcessaoDoPedidoGravar {
  readonly concessao: ConcessaoPerfilNova;
  readonly trilhaConcessao: TrilhaGestao;
  readonly trilhaAnotacao: TrilhaGestao;
}

export interface FonteGestao {
  readonly destino: 'legado' | 'memoria';
  buscarUsuarios(rede: string, hospital: string, termo: string): Promise<UsuarioGestaoLegado[]>;
  usuario(rede: string, hospital: string, login: string): Promise<UsuarioGestaoLegado | null>;
  papeisDoUsuario(rede: string, hospital: string, login: string): Promise<PapelUsuarioLegado[]>;
  historicoPerfis(rede: string, hospital: string, login: string): Promise<PerfilConcedidoLido[]>;
  mapa(rede: string, hospital: string): Promise<LinhaMapaLida[]>;
  grupos(rede: string, hospital: string): Promise<GrupoGestaoLido[]>;
  /** Só a memória (dev/ci): os grupos incluídos pela gestão neste processo (revisão W1-01, achado 6). */
  gruposCriadosNaMemoria?(): readonly string[];
  papeis(rede: string, hospital: string): Promise<PapelLegado[]>;
  concederPerfil(
    rede: string,
    hospital: string,
    c: ConcessaoPerfilNova,
    t: TrilhaGestao,
  ): Promise<{ id: string }>;
  revogarPerfil(
    rede: string,
    hospital: string,
    id: string,
    por: string,
    t: TrilhaGestao,
    motivo: string,
  ): Promise<{ login: string; perfil: string } | null>;
  /** W0-09: vigência e motivo da concessão não revogada (o anterior vai à alteração, só inclusão). */
  alterarPerfil(
    rede: string,
    hospital: string,
    a: AlteracaoPerfilConcedido,
    t: TrilhaGestao,
  ): Promise<ResultadoAlteracaoPerfil>;
  alteracoesPerfil(rede: string, hospital: string, id: string): Promise<AlteracaoPerfilLida[]>;
  decidirMapa(rede: string, hospital: string, d: DecisaoMapa, t: TrilhaGestao): Promise<{ id: string }>;
  /** W1-01 (parte 4c): as versões da descrição do grupo (SGH_ACESSO_GRUPO_DESCR), a mais nova primeiro. */
  versoesDescricaoGrupo(rede: string, hospital: string, grupo: string): Promise<DescricaoGrupoLida[]>;
  /** W1-01 (parte 4c): versão nova da descrição, com a trilha na mesma transação SGH_. */
  descreverGrupo(
    rede: string,
    hospital: string,
    d: NovaDescricaoGrupo,
    t: TrilhaGestao,
  ): Promise<{ id: string; versao: number; anterior: number | null }>;
  /** W1-01 (parte 5): as versões da política de senha do Sante (SGH_ACESSO_POLITICA_SENHA), a mais nova primeiro. */
  versoesPoliticaSenha(rede: string, hospital: string): Promise<VersaoPoliticaSenhaLida[]>;
  /** W1-01 (parte 5): publica a versão nova (vigência agora ou no futuro), com a trilha na mesma transação SGH_. */
  publicarPoliticaSenha(
    rede: string,
    hospital: string,
    p: NovaPoliticaSenha,
    agora: Date,
    t: TrilhaGestao,
  ): Promise<{ id: string; versao: number; anterior: number | null; diferenca: string[] }>;
  /** W1-01 (parte 5): cancela a versão agendada (a que já está em vigor é recusada). */
  cancelarPoliticaSenha(
    rede: string,
    hospital: string,
    c: { versao: number; motivo: string; por: string },
    agora: Date,
    t: TrilhaGestao,
  ): Promise<{ id: string; versao: number }>;
  /** W1-01 (parte 8): o histórico dos limites de sessões por perfil (SGH_ACESSO_LIMITE_SESSAO), mais novo primeiro. */
  historicoLimitesSessao(rede: string, hospital: string): Promise<RegistroLimiteSessaoLido[]>;
  /** W1-01 (parte 8): inclui, altera ou retira o limite de um perfil (linha nova), com a trilha na transação SGH_. */
  definirLimiteSessao(
    rede: string,
    hospital: string,
    p: NovoLimiteSessao,
    t: TrilhaGestao,
  ): Promise<{ id: string; anterior: number | null; limite: number | null }>;
  /** W1-01 (parte 9b): contas ativas e livres com a última conexão (rotina das contas dormentes). */
  contasDormencia(rede: string, hospital: string): Promise<ContaDormenciaLegado[]>;
  /** W1-01 (parte 9b): histórico das exceções das contas dormentes (SGH_ACESSO_DORMENCIA_EXCECAO), mais novo primeiro. */
  historicoExcecoesDormencia(rede: string, hospital: string): Promise<ExcecaoDormenciaLida[]>;
  /** W1-01 (parte 9b): inclui, troca o prazo ou retira a exceção (linha nova), com a trilha na transação SGH_. */
  registrarExcecaoDormencia(
    rede: string,
    hospital: string,
    p: NovaExcecaoDormencia,
    t: TrilhaGestao,
  ): Promise<{ id: string; anterior: string | null; atual: string | null }>;
  /** W1-01 (parte 11d): registros de conselho do papel ativo do usuário (TBUSERS_TBPAPEL → TBCBOPRO). */
  registrosConselho(rede: string, hospital: string, login: string): Promise<RegistroConselhoUsuario[]>;
  /** W1-01 (parte 11d): conferências do conselho do usuário (SGH_ACESSO_CONSELHO_CONFER), mais nova primeiro. */
  conferenciasConselho(rede: string, hospital: string, login: string): Promise<ConferenciaConselhoLida[]>;
  /** W1-01 (parte 11d): conferência nova (linha nova), com a trilha na transação SGH_. */
  registrarConferenciaConselho(
    rede: string,
    hospital: string,
    p: NovaConferenciaConselho,
    t: TrilhaGestao,
  ): Promise<{ id: string; anterior: string | null; atual: string }>;
  /** W1-01 (parte 9c2): contas ativas e livres com grupo, setores e perfis vigentes (retrato da recertificação). */
  contasRecert(rede: string, hospital: string): Promise<ContaRecertLegado[]>;
  /** W1-01 (parte 9c2): campanhas de recertificação, a mais nova primeiro. */
  campanhasRecert(rede: string, hospital: string): Promise<CampanhaRecertLida[]>;
  campanhaRecert(
    rede: string,
    hospital: string,
    id: string,
  ): Promise<{ campanha: CampanhaRecertLida; itens: ItemRecertLido[] } | null>;
  abrirCampanhaRecert(
    rede: string,
    hospital: string,
    p: NovaCampanhaRecertGravar,
    t: TrilhaGestao,
  ): Promise<{ id: string; itens: number }>;
  decidirRecert(
    rede: string,
    hospital: string,
    p: DecisaoRecertGravar,
    t: TrilhaGestao,
    validar: ValidarDecisaoRecert,
  ): Promise<{ item: string }>;
  fecharCampanhaRecert(
    rede: string,
    hospital: string,
    p: FechamentoRecertGravar,
    t: TrilhaGestao,
  ): Promise<{ id: string; situacao: 'encerrada' | 'cancelada'; pendentes: number }>;
  /** W1-01 (parte 10b): pedidos de acesso do estabelecimento, o mais novo primeiro. */
  pedidosAcesso(rede: string, hospital: string, filtro?: FiltroPedidosAcesso): Promise<PedidoAcessoGravado[]>;
  pedidoAcesso(rede: string, hospital: string, id: string): Promise<PedidoAcessoGravado | null>;
  pedirAcesso(
    rede: string,
    hospital: string,
    p: NovoPedidoAcessoGravar,
    t: TrilhaGestao,
  ): Promise<{ id: string }>;
  /**
   * Revisão (achado 2): com `conceder`, a aprovação do 2º nível, a concessão do perfil e a anotação no pedido correm
   * numa ÚNICA transação SGH_ (situacao 'concedido'); qualquer falha desfaz as três e o pedido segue 'aprovado-setor'.
   */
  decidirPedidoAcesso(
    rede: string,
    hospital: string,
    p: DecisaoPedidoAcessoGravar,
    t: TrilhaGestao,
    validar: ValidarPedidoAcesso,
    conceder?: ConcessaoDoPedidoGravar,
  ): Promise<{
    id: string;
    anterior: SituacaoPedidoAcesso;
    situacao: SituacaoPedidoAcesso;
    concessao: string | null;
  }>;
  /** Revisão: o pedido 'aprovado' sem concessão recebe a concessão e a anotação numa só transação SGH_. */
  concederPedidoAprovado(
    rede: string,
    hospital: string,
    pedido: string,
    conceder: ConcessaoDoPedidoGravar,
  ): Promise<{ id: string; concessao: string }>;
  concessaoPedidoAcesso(
    rede: string,
    hospital: string,
    pedido: string,
    concessao: string,
    t: TrilhaGestao,
  ): Promise<{ id: string; concessao: string }>;
  cancelarPedidoAcesso(
    rede: string,
    hospital: string,
    pedido: string,
    motivo: string,
    por: string,
    t: TrilhaGestao,
  ): Promise<{ id: string; anterior: SituacaoPedidoAcesso }>;
  /** W1-01 (parte 11a2): vínculos, mudanças, afastamentos em curso, resoluções e mapa cargo -> perfil (RH). */
  dadosRh(rede: string, hospital: string): Promise<DadosRhLidos>;
  definirPerfilCargoRh(
    rede: string,
    hospital: string,
    p: NovoPerfilCargoRh,
    t: TrilhaGestao,
  ): Promise<{ id: string; anterior: string | null; perfil: string | null }>;
  /** Resolução imutável; `validar` recebe os dados relidos NA transação da gravação. */
  resolverTarefaRh(
    rede: string,
    hospital: string,
    p: NovaResolucaoRh,
    t: TrilhaGestao,
    validar: ValidarResolucaoRhMemoria,
  ): Promise<{ id: string }>;
  /** W0-09: quem pode perder a permissão se a aprovação sair (a API confere usuário a usuário). */
  candidatosMapa(
    rede: string,
    hospital: string,
    c: ConsultaCandidatosMapa,
  ): Promise<{ logins: string[]; limitado: boolean }>;
  /** W0-09: histórico das decisões de uma linha do mapa. */
  decisoesMapa(rede: string, hospital: string, idMapa: string): Promise<DecisaoMapaLida[]>;
  /** Receita do legado pelo executor (ou, em memória, as mesmas regras sobre o estado sintético). */
  executar(nome: string, hospital: string, entrada: unknown, ctx: ContextoOperacao): Promise<void>;
  /** W1-01 (parte 3c): gestores de acessos ativos, ao vivo, para a regra do último gestor (ultimo-gestor.ts). */
  gestoresAcesso(rede: string, hospital: string): Promise<GestorAcessoLido[]>;
  receita(nome: string, hospital: string): EstadoReceita;
}

export const DESLIGADA_DEV_COPIA =
  'Desligada em dev sobre a cópia compartilhada: a gravação na cópia do banco só acontece sob a trava, nos testes (ADR 0021, decisão 20). Em homologação e treino, liga pelo catálogo; em dev, só com ACESSO_GESTAO_LEGADO_DEV=sim (decisão do dono).';

export function estadoDaReceita(
  catalogo: FonteCatalogo,
  nome: string,
  hospital: string,
  ambiente: string,
): EstadoReceita {
  const estado = catalogo.estado(nome, hospital);
  if (estado === null || estado === 'bloqueada')
    return {
      estado,
      ligada: false,
      motivo: 'Operação bloqueada no catálogo de operações deste estabelecimento.',
    };
  const dev = ambiente === 'dev' || ambiente === 'ci';
  if (!dev && !['verde', 'conferida', 'liberada'].includes(estado))
    return {
      estado,
      ligada: false,
      motivo:
        'O teste de assinatura de dados desta operação ainda não está verde neste estabelecimento: a receita fica desligada (POL-3).',
    };
  if (ambiente === 'producao' && estado !== 'liberada')
    return {
      estado,
      ligada: false,
      motivo: 'Em produção, só a operação liberada pelo dono (conferência manual e autorização).',
    };
  return { estado, ligada: true, motivo: null };
}

export function fonteGestaoLegado(
  nucleo: NucleoLegado,
  executor: Executor,
  catalogo: FonteCatalogo,
  ambiente: string,
  opcoes: { receitasDesligadas?: boolean } = {},
): FonteGestao {
  const ctx = (rede: string, hospital: string, traceId = 'acesso-gestao') => ({ rede, hospital, traceId });
  const ler = <T>(rede: string, hospital: string, fn: Parameters<NucleoLegado['lerSomente']>[1]) =>
    nucleo.lerSomente(ctx(rede, hospital), fn) as Promise<T>;
  const receita = (nome: string, hospital: string): EstadoReceita =>
    opcoes.receitasDesligadas
      ? { estado: catalogo.estado(nome, hospital), ligada: false, motivo: DESLIGADA_DEV_COPIA }
      : estadoDaReceita(catalogo, nome, hospital, ambiente);
  return {
    destino: 'legado',
    buscarUsuarios: (rede, h, termo) => ler(rede, h, (l) => buscarUsuariosGestao(l, termo)),
    usuario: (rede, h, login) => ler(rede, h, (l) => lerUsuarioGestao(l, login)),
    papeisDoUsuario: (rede, h, login) => ler(rede, h, (l) => lerPapeisDoUsuario(l, login)),
    historicoPerfis: (rede, h, login) => ler(rede, h, (l) => lerHistoricoPerfis(l, login)),
    mapa: (rede, h) => ler(rede, h, (l) => lerMapaOpcao(l)),
    grupos: (rede, h) =>
      ler(rede, h, async (l) => {
        const [grupos, perm] = [await lerGruposLegado(l), await lerPermissoesGrupos(l)];
        return grupos.map((g) => ({
          nome: g.nome,
          ativo: g.ativo,
          opcoes: perm.filter((p) => p.grupo === g.nome).map((p) => p.opcao),
        }));
      }),
    papeis: (rede, h) => ler(rede, h, (l) => lerPapeisLegado(l)),
    concederPerfil: (rede, h, c, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => gravarConcessaoPerfil(e, c, t)),
    revogarPerfil: (rede, h, id, por, t, motivo) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => revogarConcessaoPerfil(e, id, por, t, motivo)),
    alterarPerfil: (rede, h, a, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => alterarConcessaoPerfil(e, a, t)),
    alteracoesPerfil: (rede, h, id) => ler(rede, h, (l) => lerAlteracoesPerfil(l, id)),
    decidirMapa: (rede, h, d, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => decidirMapaOpcao(e, d, t)),
    versoesDescricaoGrupo: (rede, h, grupo) => ler(rede, h, (l) => lerVersoesDescricaoGrupo(l, grupo)),
    descreverGrupo: (rede, h, d, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => gravarDescricaoGrupo(e, d, t)),
    versoesPoliticaSenha: (rede, h) => ler(rede, h, (l) => lerVersoesPoliticaSenha(l, h)),
    publicarPoliticaSenha: (rede, h, p, agora, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => publicarPoliticaSenha(e, p, agora, t)),
    cancelarPoliticaSenha: (rede, h, c, agora, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) =>
        cancelarPoliticaSenha(e, { ...c, hospital: h }, agora, t),
      ),
    historicoLimitesSessao: (rede, h) => ler(rede, h, (l) => lerHistoricoLimitesSessao(l, h)),
    definirLimiteSessao: (rede, h, p, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => definirLimiteSessao(e, p, t)),
    contasDormencia: (rede, h) => ler(rede, h, (l) => lerContasParaDormencia(l)),
    historicoExcecoesDormencia: (rede, h) => ler(rede, h, (l) => lerHistoricoExcecoesDormencia(l, h)),
    registrarExcecaoDormencia: (rede, h, p, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => registrarExcecaoDormencia(e, p, t)),
    registrosConselho: (rede, h, login) => ler(rede, h, (l) => lerRegistrosConselhoDoUsuario(l, login)),
    conferenciasConselho: (rede, h, login) => ler(rede, h, (l) => lerConferenciasConselho(l, h, login)),
    registrarConferenciaConselho: (rede, h, p, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => registrarConferenciaConselho(e, p, t)),
    contasRecert: (rede, h) => ler(rede, h, (l) => lerContasParaRecert(l, h)),
    campanhasRecert: (rede, h) => ler(rede, h, (l) => lerCampanhasRecert(l, h)),
    campanhaRecert: (rede, h, id) => ler(rede, h, (l) => lerCampanhaRecert(l, h, id)),
    abrirCampanhaRecert: (rede, h, p, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => abrirCampanhaRecert(e, p, t)),
    decidirRecert: (rede, h, p, t, validar) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => registrarDecisaoRecert(e, p, t, validar)),
    fecharCampanhaRecert: (rede, h, p, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => fecharCampanhaRecert(e, p, t)),
    pedidosAcesso: (rede, h, filtro) => ler(rede, h, (l) => lerPedidosAcesso(l, h, filtro)),
    pedidoAcesso: (rede, h, id) => ler(rede, h, (l) => lerPedidoAcesso(l, h, id)),
    pedirAcesso: (rede, h, p, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => registrarPedidoAcesso(e, p, t)),
    decidirPedidoAcesso: (rede, h, p, t, validar, conceder) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) =>
        decidirEConcederPedidoAcesso(e, p, t, validar, conceder),
      ),
    concederPedidoAprovado: (rede, h, pedido, conceder) =>
      nucleo.gravarSgh(ctx(rede, h, conceder.trilhaAnotacao.correlacao), (e) =>
        concederPedidoAprovado(e, { hospital: h, pedido }, conceder),
      ),
    concessaoPedidoAcesso: (rede, h, pedido, concessao, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) =>
        registrarConcessaoPedido(e, { hospital: h, pedido, concessao }, t),
      ),
    cancelarPedidoAcesso: (rede, h, pedido, motivo, por, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) =>
        cancelarPedidoAcesso(e, { hospital: h, pedido, motivo, por }, t),
      ),
    dadosRh: (rede, h) => ler(rede, h, (l) => lerDadosRh(l, h)),
    definirPerfilCargoRh: (rede, h, p, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => definirPerfilCargoRh(e, p, t)),
    resolverTarefaRh: (rede, h, p, t, validar) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) =>
        registrarResolucaoRh(e, p, async (tx) => validar(await lerDadosRh(tx, h)), t),
      ),
    candidatosMapa: (rede, h, c) => ler(rede, h, (l) => lerCandidatosMapa(l, c)),
    decisoesMapa: (rede, h, id) => ler(rede, h, (l) => lerDecisoesMapa(l, id)),
    async executar(nome, hospital, entrada, c) {
      const r = receita(nome, hospital);
      if (!r.ligada)
        throw new ErroProblema('operacao-bloqueada', 409, 'Operação desligada', r.motivo ?? undefined, {
          codigo: 'operacao-desligada',
        });
      await executor.executar(operacao(nome), hospital, entrada, c);
    },
    gestoresAcesso: (rede, h) => ler(rede, h, (l) => lerGestoresAcesso(l)),
    receita,
  };
}

/** Memória (dev/ci, sessão sintética): o estado sintético com as regras das receitas; trilha no registrador. */
export function fonteGestaoMemoria(
  trilha: RegistradorTrilha,
  catalogo: FonteCatalogo,
  ambiente: string,
): FonteGestao {
  const e = () => estadoAcessoSintetico();
  const usuarioDe = (login: string): UsuarioGestaoLegado | null => {
    const c = e().contas.get(login);
    return c
      ? {
          login,
          nome: 'Usuário sintético (desenvolvimento)',
          grupo: c.grupo,
          ativo: true,
          bloqueado: false,
          id: c.id,
        }
      : null;
  };
  const registrar = async (t: TrilhaGestao, tabela: string, id: string) => {
    await trilha.registrar({
      evento: t.evento,
      rede: t.rede,
      hospital: t.hospital,
      usuario: t.usuario,
      estacao: t.estacao ?? '',
      correlacao: t.correlacao,
      recurso: t.recurso,
      resultado: 'sucesso',
      tabelaAlvo: tabela,
      idAlvo: id,
    });
  };
  return {
    destino: 'memoria',
    buscarUsuarios: (_r, _h, termo) =>
      Promise.resolve(
        [...e().contas.keys()]
          .filter((l) => l.toUpperCase().includes(termo.trim().toUpperCase()))
          .sort()
          .slice(0, 50)
          .flatMap((l) => usuarioDe(l) ?? []),
      ),
    usuario: (_r, _h, login) => Promise.resolve(usuarioDe(login)),
    papeisDoUsuario: (_r, _h, login) =>
      Promise.resolve(
        [...(e().contas.get(login)?.papeis ?? new Map<number, boolean>())]
          .sort((a, b) => a[0] - b[0])
          .map(([papel, ativo]) => ({ papel, nome: NOMES_PAPEL[papel] ?? `Papel ${papel}`, ativo })),
      ),
    historicoPerfis: (_r, _h, login) =>
      Promise.resolve(
        e()
          .concessoes.filter((c) => c.login === login)
          .map((c) => ({
            ...c,
            alteracoes: e().alteracoesPerfil.filter((x) => x.idConcessao === c.id).length,
          }))
          .reverse(),
      ),
    mapa: () => Promise.resolve(e().mapa.map((m) => ({ ...m }))),
    grupos: () =>
      Promise.resolve(
        [...e().grupos]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([nome, ativo]) => ({
            nome,
            ativo,
            opcoes: [...(e().opcoesGrupo.get(nome) ?? [])].sort((a, b) => a - b),
          })),
      ),
    papeis: () =>
      Promise.resolve(
        [...e().opcoesPapel]
          .sort((a, b) => a[0] - b[0])
          .map(([papel, ops]) => ({
            papel,
            nome: NOMES_PAPEL[papel] ?? `Papel ${papel}`,
            opcoes: [...ops].sort((a, b) => a - b),
          })),
      ),
    async concederPerfil(_r, _h, c, t) {
      const r = e().concederPerfil({
        login: c.login,
        perfil: c.perfil,
        inicio: c.inicio ?? new Date(),
        fim: c.fim,
        motivo: c.motivo,
        concedidoPor: c.concedidoPor,
      });
      await registrar(t, 'MEMORIA', r.id);
      return r;
    },
    async revogarPerfil(_r, _h, id, por, t, motivo) {
      const r = e().revogarPerfil(id, por, motivo);
      if (r) await registrar(t, 'MEMORIA', id);
      return r;
    },
    async alterarPerfil(_r, _h, a, t) {
      const r = e().alterarPerfil(a);
      if (r.situacao === 'ok') await registrar(t, 'MEMORIA', a.id);
      return r;
    },
    alteracoesPerfil: (_r, _h, id) =>
      Promise.resolve(
        e()
          .alteracoesPerfil.filter((x) => x.idConcessao === id)
          .map((x): AlteracaoPerfilLida => ({ ...x })),
      ),
    async decidirMapa(_r, _h, d, t) {
      const r = e().decidirMapa(d);
      await registrar(t, 'MEMORIA', r.id);
      return r;
    },
    gruposCriadosNaMemoria: () => [...e().gruposCriados],
    versoesDescricaoGrupo: (_r, _h, grupo) =>
      Promise.resolve(
        e()
          .descricoesGrupo.filter((d) => d.grupo === grupo)
          .sort((a, b) => b.versao - a.versao)
          .map((d) => ({ ...d })),
      ),
    async descreverGrupo(_r, _h, d, t) {
      const r = e().descreverGrupo(d);
      await registrar(t, 'MEMORIA', r.id);
      return r;
    },
    versoesPoliticaSenha: () =>
      Promise.resolve([...e().politicasSenha].sort((a, b) => b.versao - a.versao).map((v) => ({ ...v }))),
    async publicarPoliticaSenha(_r, _h, p, agora, t) {
      const r = e().publicarPoliticaSenha(p, agora);
      await registrar(t, 'MEMORIA', r.id);
      return r;
    },
    async cancelarPoliticaSenha(_r, _h, c, agora, t) {
      const r = e().cancelarPoliticaSenha(c, agora);
      await registrar(t, 'MEMORIA', r.id);
      return r;
    },
    historicoLimitesSessao: () => Promise.resolve([...e().limitesSessao].reverse().map((x) => ({ ...x }))),
    async definirLimiteSessao(_r, _h, p, t) {
      const r = e().definirLimiteSessao(p);
      await registrar(t, 'MEMORIA', r.id);
      return r;
    },
    contasDormencia() {
      const est = e();
      return Promise.resolve(
        [...est.contas.keys()]
          .filter(
            (login) =>
              CONTAS_SINTETICAS[login]?.ativo !== false &&
              !(est.bloqueio.get(login) ?? CONTAS_SINTETICAS[login]?.bloqueado ?? false),
          )
          .sort()
          .map((login) => ({
            login,
            grupo: est.contas.get(login)?.grupo ?? null,
            ativo: true,
            bloqueado: false,
            ultimoAcesso: est.ultimoAcesso.get(login) ?? null,
          })),
      );
    },
    historicoExcecoesDormencia: () => Promise.resolve(e().excecoesDormencia.map((x) => ({ ...x }))),
    async registrarExcecaoDormencia(_r, _h, p, t) {
      const est = e();
      const r = est.registrarExcecaoDormencia(p, (login) => est.contas.has(login));
      await registrar(t, 'MEMORIA', r.id);
      return r;
    },
    registrosConselho: (_r, _h, login) => Promise.resolve(e().registrosConselho(login)),
    conferenciasConselho: (_r, _h, login) =>
      Promise.resolve(
        e()
          .conferenciasConselho.filter((x) => x.login === login)
          .map((x) => ({ ...x })),
      ),
    async registrarConferenciaConselho(_r, _h, p, t) {
      const r = e().registrarConferenciaConselho(p);
      await registrar(t, 'MEMORIA', r.id);
      return r;
    },
    contasRecert() {
      const est = e();
      const agora = Date.now();
      return Promise.resolve(
        [...est.contas.entries()]
          .filter(
            ([login]) =>
              CONTAS_SINTETICAS[login]?.ativo !== false &&
              !(est.bloqueio.get(login) ?? CONTAS_SINTETICAS[login]?.bloqueado ?? false),
          )
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([login, c]) => ({
            login,
            grupo: c.grupo,
            ativo: true,
            bloqueado: false,
            setores: [],
            perfis: [
              ...new Set(
                est.concessoes
                  .filter(
                    (x) =>
                      x.login === login &&
                      !x.revogadoEm &&
                      x.inicio.getTime() <= agora &&
                      (!x.fim || x.fim.getTime() > agora),
                  )
                  .map((x) => x.perfil),
              ),
            ].sort(),
          })),
      );
    },
    campanhasRecert: () => Promise.resolve(e().recert.lerCampanhas()),
    campanhaRecert: (_r, _h, id) => Promise.resolve(e().recert.lerCampanha(id)),
    async abrirCampanhaRecert(_r, _h, p, t) {
      const r = e().recert.abrir(p);
      await registrar(t, 'MEMORIA', r.id);
      return r;
    },
    async decidirRecert(_r, _h, p, t, validar) {
      const r = e().recert.decidir(p, validar);
      await registrar(t, 'MEMORIA', r.item);
      return r;
    },
    async fecharCampanhaRecert(_r, _h, p, t) {
      const r = e().recert.fechar(p);
      await registrar(t, 'MEMORIA', r.id);
      return r;
    },
    pedidosAcesso: (_r, _h, filtro) => Promise.resolve(e().pedidos.ler(filtro)),
    pedidoAcesso: (_r, _h, id) => Promise.resolve(e().pedidos.lerUm(id)),
    async pedirAcesso(_r, _h, p, t) {
      const r = e().pedidos.pedir(p);
      await registrar(t, 'MEMORIA', r.id);
      return r;
    },
    async decidirPedidoAcesso(_r, _h, p, t, validar, conceder) {
      let concessao: string | null = null;
      const r = e().pedidos.decidir(
        p,
        validar,
        conceder
          ? () => {
              const c = conceder.concessao;
              concessao = e().concederPerfil({
                login: c.login,
                perfil: c.perfil,
                inicio: c.inicio ?? new Date(),
                fim: c.fim,
                motivo: c.motivo,
                concedidoPor: c.concedidoPor,
              }).id;
              return concessao;
            }
          : undefined,
      );
      await registrar(t, 'MEMORIA', r.id);
      if (conceder && concessao) {
        await registrar(conceder.trilhaConcessao, 'MEMORIA', concessao);
        await registrar(conceder.trilhaAnotacao, 'MEMORIA', r.id);
      }
      return { ...r, concessao };
    },
    async concederPedidoAprovado(_r, _h, pedido, conceder) {
      const x = e().pedidos.lerUm(pedido);
      if (!x || x.situacao !== 'aprovado' || x.concessao)
        throw new ErroOperacao(
          409,
          'pedido-nao-aprovado',
          'Operação recusada',
          'Só o pedido aprovado nos dois níveis e ainda sem concessão recebe a concessão.',
        );
      const c = conceder.concessao;
      const concessao = e().concederPerfil({
        login: c.login,
        perfil: c.perfil,
        inicio: c.inicio ?? new Date(),
        fim: c.fim,
        motivo: c.motivo,
        concedidoPor: c.concedidoPor,
      }).id;
      const r = e().pedidos.anotarConcessao(pedido, concessao);
      await registrar(conceder.trilhaConcessao, 'MEMORIA', concessao);
      await registrar(conceder.trilhaAnotacao, 'MEMORIA', r.id);
      return r;
    },
    async concessaoPedidoAcesso(_r, _h, pedido, concessao, t) {
      const r = e().pedidos.anotarConcessao(pedido, concessao);
      await registrar(t, 'MEMORIA', r.id);
      return r;
    },
    async cancelarPedidoAcesso(_r, _h, pedido, motivo, por, t) {
      const r = e().pedidos.cancelar(pedido, por, motivo);
      await registrar(t, 'MEMORIA', r.id);
      return r;
    },
    dadosRh: () => Promise.resolve(e().rh.dados()),
    async definirPerfilCargoRh(_r, _h, p, t) {
      const r = e().rh.definirPerfilCargo(p);
      await registrar(t, 'MEMORIA', r.id);
      return r;
    },
    async resolverTarefaRh(_r, _h, p, t, validar) {
      const r = e().rh.resolver(p, validar);
      await registrar(t, 'MEMORIA', r.id);
      return r;
    },
    // A sessão sintética tem poucas contas: todas são candidatas (a API confere pelas origens efetivas).
    candidatosMapa: () => Promise.resolve({ logins: [...e().contas.keys()].sort(), limitado: false }),
    decisoesMapa: (_r, _h, id) =>
      Promise.resolve(
        e()
          .decisoesMapa.filter((x) => x.idMapa === id)
          .map((x): DecisaoMapaLida => ({ ...x }))
          .reverse(),
      ),
    async executar(nome, hospital, entrada, c) {
      const est = estadoDaReceita(catalogo, nome, hospital, ambiente);
      if (!est.ligada)
        throw new ErroProblema('operacao-bloqueada', 409, 'Operação desligada', est.motivo ?? undefined, {
          codigo: 'operacao-desligada',
        });
      const op = operacao(nome);
      const p = op.entrada.safeParse(entrada);
      if (!p.success)
        throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos.');
      e().aplicar(nome, p.data as Record<string, unknown>, c.usuarioLegado);
      await trilha.registrar({
        evento: op.receita.evento,
        rede: c.rede,
        hospital,
        usuario: c.usuarioLegado,
        estacao: c.estacao ?? '',
        correlacao: c.traceId,
        recurso: op.receita.recurso,
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: nome,
      });
    },
    gestoresAcesso() {
      const est = e();
      const agora = Date.now();
      const ativa = (login: string) =>
        CONTAS_SINTETICAS[login]?.ativo !== false &&
        !(est.bloqueio.get(login) ?? CONTAS_SINTETICAS[login]?.bloqueado ?? false);
      return Promise.resolve(
        [...est.contas]
          .filter(([login]) => ativa(login))
          .map(([login, c]) => ({
            login,
            grupo: c.grupo,
            papelGestor: c.papeis.get(0) === true,
            concessoes: est.concessoes
              .filter(
                (x) =>
                  x.login === login &&
                  x.perfil === 'gestor-acessos' &&
                  !x.revogadoEm &&
                  x.inicio.getTime() <= agora &&
                  (!x.fim || x.fim.getTime() > agora),
              )
              .map((x) => x.id),
          }))
          .filter(
            (g) => g.papelGestor || g.concessoes.length > 0 || g.grupo?.toUpperCase().includes('MASTER'),
          )
          .sort((a, b) => a.login.localeCompare(b.login)),
      );
    },
    receita: (nome, hospital) => estadoDaReceita(catalogo, nome, hospital, ambiente),
  };
}

export function fonteGestaoIndisponivel(): FonteGestao {
  const recusar = async (): Promise<never> => {
    throw new ErroProblema(
      'indisponivel',
      503,
      'Banco do estabelecimento indisponível',
      'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
    );
  };
  return {
    destino: 'legado',
    buscarUsuarios: recusar,
    usuario: recusar,
    papeisDoUsuario: recusar,
    historicoPerfis: recusar,
    mapa: recusar,
    grupos: recusar,
    papeis: recusar,
    concederPerfil: recusar,
    revogarPerfil: recusar,
    alterarPerfil: recusar,
    alteracoesPerfil: recusar,
    decidirMapa: recusar,
    versoesDescricaoGrupo: recusar,
    descreverGrupo: recusar,
    versoesPoliticaSenha: recusar,
    publicarPoliticaSenha: recusar,
    cancelarPoliticaSenha: recusar,
    historicoLimitesSessao: recusar,
    definirLimiteSessao: recusar,
    contasDormencia: recusar,
    historicoExcecoesDormencia: recusar,
    registrarExcecaoDormencia: recusar,
    registrosConselho: recusar,
    conferenciasConselho: recusar,
    registrarConferenciaConselho: recusar,
    contasRecert: recusar,
    campanhasRecert: recusar,
    campanhaRecert: recusar,
    abrirCampanhaRecert: recusar,
    decidirRecert: recusar,
    fecharCampanhaRecert: recusar,
    pedidosAcesso: recusar,
    pedidoAcesso: recusar,
    pedirAcesso: recusar,
    decidirPedidoAcesso: recusar,
    concederPedidoAprovado: recusar,
    concessaoPedidoAcesso: recusar,
    cancelarPedidoAcesso: recusar,
    dadosRh: recusar,
    definirPerfilCargoRh: recusar,
    resolverTarefaRh: recusar,
    candidatosMapa: recusar,
    decisoesMapa: recusar,
    executar: recusar,
    gestoresAcesso: recusar,
    receita: () => ({ estado: null, ligada: false, motivo: 'Banco do estabelecimento não configurado.' }),
  };
}

/** TBPAPEL.NOME do pc (os cinco papéis SBIS), para a fonte sintética. */
export const NOMES_PAPEL: Readonly<Record<number, string>> = {
  0: 'Gestor de acessos',
  1: 'Administrador do sistema',
  2: 'Auditor',
  3: 'Operador de backup',
  4: 'Operador de sistema',
};
