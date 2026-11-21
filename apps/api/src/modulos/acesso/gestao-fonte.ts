// Fonte da gestão de acessos (tela "Perfis e permissões", contas dormentes, recertificação, RH e pedidos de acesso):
// onde as leituras e as gravações acontecem.
//   - `banco`: o banco próprio do cliente pelo @sgh/nucleo (gestao-fonte-propria.ts), com o Executor (trilha, outbox e
//     idempotência na mesma transação).
//   - `memoria`: a sessão sintética (dev/ci; E2E): o estado sintético do acesso, com as mesmas regras e recusas da
//     porta própria; a trilha vai ao registrador da API.
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo (nunca cai calada na memória).
// Melhoria: as operações da conta (bloquear, papéis de segurança) são as mesmas na memória e no banco; as de grupo do
// sistema de origem não existem no modelo próprio (o perfil concede) e são recusadas com o motivo, nas duas fontes.
import type { EstadoOperacao } from '@sgh/contratos';
import { ErroOperacao } from '@sgh/nucleo';
import { ErroProblema } from '../../problema.filter.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { CONTAS_SINTETICAS, estadoAcessoSintetico } from './fonte-sintetica.js';
import type { ValidarResolucaoRhMemoria } from './rh-memoria.js';
import {
  type AlteracaoPerfilConcedido,
  type CatalogoOperacoes,
  type ConcessaoPerfilNova,
  type ConsultaCandidatosMapa,
  type ContaDormencia,
  type ContaRecert,
  type ContextoGestao,
  type DecisaoMapa,
  type DescricaoGrupoLida,
  type DestinoGestao,
  ehOperacaoConta,
  type GestorAcessoLido,
  type LinhaMapaLida,
  NOMES_PAPEL,
  type NovaDescricaoGrupo,
  OPERACOES_CONTA,
  type PapelGestao,
  type PapelUsuario,
  type PerfilConcedidoLido,
  type ResultadoAlteracaoPerfil,
  SEM_GRUPOS,
  type TrilhaGestao,
  type UsuarioGestao,
} from './gestao-tipos.js';
import type {
  AlteracaoPerfilLida,
  CampanhaRecertLida,
  ConferenciaConselhoLida,
  DadosRhLidos,
  DecisaoMapaLida,
  DecisaoPedidoAcessoGravar,
  DecisaoRecertGravar,
  ExcecaoDormenciaLida,
  FechamentoRecertGravar,
  FiltroPedidosAcesso,
  ItemRecertLido,
  NovaCampanhaRecertGravar,
  NovaConferenciaConselho,
  NovaExcecaoDormencia,
  NovaPoliticaSenha,
  NovaResolucaoRh,
  NovoLimiteSessao,
  NovoPedidoAcessoGravar,
  NovoPerfilCargoRh,
  PedidoAcessoGravado,
  RegistroConselhoUsuario,
  RegistroLimiteSessaoLido,
  SituacaoPedidoAcesso,
  ValidarDecisaoRecert,
  ValidarPedidoAcesso,
  VersaoPoliticaSenhaLida,
} from './tipos-gestao-acesso.js';

export * from './gestao-tipos.js';

export const FONTE_GESTAO = Symbol('FONTE_GESTAO');

export interface GrupoGestaoLido {
  readonly nome: string;
  readonly ativo: boolean;
  readonly opcoes: readonly number[];
}

/** A operação desligada neste estabelecimento, com o motivo para a pessoa. */
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
  readonly destino: DestinoGestao;
  buscarUsuarios(rede: string, hospital: string, termo: string): Promise<UsuarioGestao[]>;
  usuario(rede: string, hospital: string, login: string): Promise<UsuarioGestao | null>;
  papeisDoUsuario(rede: string, hospital: string, login: string): Promise<PapelUsuario[]>;
  historicoPerfis(rede: string, hospital: string, login: string): Promise<PerfilConcedidoLido[]>;
  mapa(rede: string, hospital: string): Promise<LinhaMapaLida[]>;
  grupos(rede: string, hospital: string): Promise<GrupoGestaoLido[]>;
  /** Só a memória (dev/ci): os grupos incluídos pela gestão neste processo (revisão W1-01, achado 6). */
  gruposCriadosNaMemoria?(): readonly string[];
  papeis(rede: string, hospital: string): Promise<PapelGestao[]>;
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
  contasDormencia(rede: string, hospital: string): Promise<ContaDormencia[]>;
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
  contasRecert(rede: string, hospital: string): Promise<ContaRecert[]>;
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
  /** Operação da conta (bloquear, papéis de segurança); as de grupo são recusadas (SEM_GRUPOS). */
  executar(nome: string, hospital: string, entrada: unknown, ctx: ContextoGestao): Promise<void>;
  /** W1-01 (parte 3c): gestores de acessos ativos, ao vivo, para a regra do último gestor (ultimo-gestor.ts). */
  gestoresAcesso(rede: string, hospital: string): Promise<GestorAcessoLido[]>;
  receita(nome: string, hospital: string): EstadoReceita;
}

/** Motivo da operação desligada fora de produção (mantido para quem ainda o importa; sai com as receitas). */
export const DESLIGADA_DEV_COPIA =
  'Operação desligada neste ambiente: a gravação só acontece com a operação liberada no catálogo deste estabelecimento.';

export function estadoDaReceita(
  catalogo: CatalogoOperacoes,
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

/** Memória (dev/ci, sessão sintética): o estado sintético com as regras das receitas; trilha no registrador. */
export function fonteGestaoMemoria(
  trilha: RegistradorTrilha,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _catalogo?: CatalogoOperacoes,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _ambiente?: string,
): FonteGestao {
  const e = () => estadoAcessoSintetico();
  const usuarioDe = (login: string): UsuarioGestao | null => {
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
      if (!ehOperacaoConta(nome)) throw new ErroOperacao(409, 'sem-grupos', 'Operação recusada', SEM_GRUPOS);
      const p = OPERACOES_CONTA[nome].safeParse(entrada);
      if (!p.success)
        throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos.');
      e().aplicar(nome, p.data as Record<string, unknown>, c.usuario);
      await trilha.registrar({
        evento: 'acesso.usuario.gravado',
        rede: c.rede,
        hospital,
        usuario: c.usuario,
        estacao: c.estacao ?? '',
        correlacao: c.correlacao,
        recurso: 'acesso.usuario',
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
    receita: (nome) =>
      ehOperacaoConta(nome)
        ? { estado: null, ligada: true, motivo: null }
        : { estado: null, ligada: false, motivo: SEM_GRUPOS },
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
    destino: 'banco',
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
