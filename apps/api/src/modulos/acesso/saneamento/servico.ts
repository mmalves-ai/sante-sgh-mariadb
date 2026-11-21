// Saneamento dos grupos de acesso amplo (M59-F4; ficha do M59, seções 5, 7 e 8, regra 8; cap-08 §8.7, §8.15): o painel
// dos grupos genéricos, os usuários de cada um com a sugestão de destino pelo uso, o simulador (antes e depois), o plano
// (decidir, aprovar pela área, descartar) e a aplicação pelas operações do executor do núcleo, uma transação por
// usuário (ou por lote de ações na dissolução do perfil vazio). As regras são as puras de @sgh/dominio-acesso; aqui só
// a orquestração sobre a porta (leituras somente leitura; o plano pelo executor, com a trilha na mesma transação).
// "Grupo" é o perfil de acesso (perfil_acesso.codigo) e "opção" é a ação do catálogo (acao_sistema).
// Melhoria: a conta sem perfil no estabelecimento fica fora do alcance (sem o grupo "sentinela" para o nulo); o bloqueio
// de quem tem perfil em outro estabelecimento é recusado; a chave de cada lote da dissolução deriva das ações do lote.
// Melhoria: o contexto da aplicação é neutro (chave de idempotência, reautenticação); quem executa resolve o cliente,
// o estabelecimento e o usuário por id, sem o login como chave de gravação.
import {
  DIAS_USO_SANEAMENTO,
  EVENTOS_AUDITAVEIS,
  GRUPO_ADMINISTRADORES,
  GRUPOS_GENERICOS,
  LISTA_SIMULACAO,
  LOTE_OPCOES_DISSOLUCAO,
  type AprovarItemSaneamento,
  type ItemSaneamento,
  type NovoItemSaneamento,
  type PainelSaneamento,
  type RecusaSaneamento,
  type ResultadoAplicacaoSaneamento,
  type SimulacaoSaneamento,
  type UsuariosSaneamento,
} from '@sgh/contratos';
import {
  chaveGrupo,
  destinoValido,
  diasSemAcesso,
  ehGrupoGenerico,
  emLotes,
  type GrupoCandidato,
  itemVivo,
  simularTroca,
  sugerirDestino,
  validarAplicacao,
  validarAprovacao,
  validarDecisao,
  validarDescarte,
  validarDissolucao,
  validarEntradaNoMaster,
} from '@sgh/dominio-acesso';
import { createHash } from 'node:crypto';
import { ErroOperacao } from '@sgh/nucleo';
import type { GrupoComOpcoes, PortaSaneamento, TrilhaSaneamento, UsuarioDoGrupo } from './porta.js';

export interface AtorSaneamento {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly estacao: string | null;
  readonly correlacao: string;
}

/** As operações da aplicação (nomes no formato do executor do núcleo). */
export const OPERACOES_SANEAMENTO = {
  trocarGrupo: 'acesso.saneamento.trocar-perfil',
  bloquear: 'acesso.saneamento.bloquear-usuario',
  retirarOpcoes: 'acesso.saneamento.retirar-acoes',
} as const;

/** O que a tela entrega para gravar: a Idempotency-Key e o instante da reautenticação. */
export interface ContextoAplicacao {
  readonly chaveIdempotencia: string;
  readonly reautenticadoEm?: number;
}

/** O contexto de cada execução: o ator (estabelecimento e login), a correlação e a chave da operação. */
export interface ContextoExecucaoSaneamento extends ContextoAplicacao {
  readonly hospital: string;
  readonly login: string;
  readonly correlacao: string;
  readonly estacao: string | null;
}

/** A execução das operações da aplicação (executor do núcleo; a liberação é conferida na execução). */
export interface ExecutorSaneamento {
  receita(nome: string, hospital: string): { readonly ligada: boolean; readonly motivo: string | null };
  executar(nome: string, hospital: string, entrada: unknown, ctx: ContextoExecucaoSaneamento): Promise<void>;
}

export interface DependenciasSaneamento {
  readonly porta: PortaSaneamento;
  readonly executor: ExecutorSaneamento | null;
  /** acesso.saneamento.administradoresMaximo do estabelecimento. */
  readonly administradoresMaximo: (rede: string, hospital: string) => Promise<number>;
  /** Invalida o cache de autorização (login) ou do estabelecimento inteiro (null). */
  readonly invalidar?: (rede: string, hospital: string, login: string | null) => Promise<void>;
  readonly agora?: () => number;
  /** Validade do uso lido por grupo (padrão 30 min: a leitura da trilha leva segundos). */
  readonly validadeUsoMs?: number;
}

export class ErroSaneamento extends Error {
  constructor(
    readonly codigo:
      | RecusaSaneamento
      | 'indisponivel'
      | 'usuario-inexistente'
      | 'item-inexistente'
      | 'operacao-desligada'
      | 'conta-em-outro-estabelecimento'
      | 'alterado',
    readonly detalhe: string,
    readonly status = 409,
  ) {
    super(codigo);
    this.name = 'ErroSaneamento';
  }
}

/** Textos das recusas (sem dado de pessoa). */
export const TEXTOS_RECUSA: Readonly<Record<RecusaSaneamento, string>> = {
  'grupo-nao-generico': 'O grupo não é de acesso amplo: o saneamento não se aplica.',
  'usuario-fora-do-grupo': 'O usuário já não está no grupo de origem (alguém o mudou); decida de novo.',
  'usuario-inativo': 'O usuário está inativo ou bloqueado: só fica como administrador quem está ativo.',
  'a-si-mesmo': 'Ninguém decide nem aplica o saneamento sobre si.',
  'destino-invalido': 'Escolha um grupo de trabalho ativo, com opções e diferente do atual.',
  'destino-generico': 'O destino não pode ser outro grupo de acesso amplo.',
  'administrador-so-no-master': 'Só quem está no grupo de acesso total pode ficar como administrador.',
  'administradores-no-limite':
    'O número de administradores configurado para o estabelecimento já foi alcançado.',
  'bloqueio-com-uso-recente':
    'O usuário entrou nos últimos 180 dias: o bloqueio pelo saneamento não se aplica.',
  'ja-bloqueado': 'O usuário já está bloqueado.',
  'aprovacao-desnecessaria': 'Esta decisão não tira opção usada: não precisa da aprovação da área.',
  'aprovacao-pelo-proponente': 'A aprovação da área tem de ser de outra pessoa, não de quem propôs.',
  'aprovacao-pelo-proprio': 'O próprio usuário não aprova a mudança do seu acesso.',
  'situacao-nao-permite': 'A situação da decisão não permite esta ação.',
  'exige-aprovacao': 'O usuário perde opção usada nos últimos 180 dias: falta a aprovação do dono da área.',
  'perdas-aumentaram': 'O usuário perderia mais opções usadas do que as aprovadas: decida de novo.',
  'grupo-com-ativos': 'Ainda há usuários ativos no grupo: decida por cada um antes de retirar as opções.',
  'master-nao-dissolve':
    'O grupo de acesso total fica com os administradores configurados: não é dissolvido.',
  'grupo-sem-opcoes': 'O grupo já não tem opções.',
};

const DIA_MS = 86_400_000;
const FUSO = 'America/Sao_Paulo';

function exigir(r: RecusaSaneamento | null, status = 409): void {
  if (r) throw new ErroSaneamento(r, TEXTOS_RECUSA[r], status);
}

/** O grupo amplo da conta; sem perfil no estabelecimento (null), a conta está fora do alcance do saneamento. */
function grupoAmplo(u: UsuarioDoGrupo): string {
  if (u.grupo === null || !ehGrupoGenerico(u.grupo)) exigir('grupo-nao-generico');
  return u.grupo as string;
}

/** Chave de um lote da dissolução: a do pedido mais o resumo das ações do lote (repetir o pedido retira o resto). */
export function chaveDoLote(chave: string, lote: readonly number[]): string {
  const resumo = createHash('sha256').update(lote.join(',')).digest('hex').slice(0, 16);
  return `${chave.slice(0, 63)}.${resumo}`;
}

/** A decisão que vale para cada login: a mais recente que não foi descartada. */
function ultimaPorLogin(plano: readonly ItemSaneamento[]): Map<string, ItemSaneamento> {
  const r = new Map<string, ItemSaneamento>();
  for (const i of [...plano].sort((a, b) => Number(a.id) - Number(b.id)))
    if (i.login !== null && i.situacao !== 'descartado') r.set(i.login, i);
  return r;
}

export class ServicoSaneamento {
  private readonly cacheUso = new Map<string, { em: number; uso: Map<string, Map<number, number>> }>();
  constructor(private readonly d: DependenciasSaneamento) {}

  private agora(): number {
    return this.d.agora ? this.d.agora() : Date.now();
  }

  hoje(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date(this.agora()));
  }

  private trilha(a: AtorSaneamento, evento: string, operacao: string): TrilhaSaneamento {
    return {
      rede: a.rede,
      hospital: a.hospital,
      usuario: a.login,
      evento,
      recurso: 'acesso.saneamento',
      operacao,
      resultado: 'sucesso',
      estacao: a.estacao,
      correlacao: a.correlacao,
    };
  }

  private async pronto(h: string): Promise<void> {
    const ok = await this.d.porta.pronto(h).catch(() => false);
    if (!ok)
      throw new ErroSaneamento(
        'indisponivel',
        'O saneamento dos grupos ainda não está instalado neste estabelecimento.',
        503,
      );
  }

  /** Uso das opções do grupo na janela (lido uma vez por validade); sem resposta da trilha, lido = false. */
  private async usoDoGrupo(
    h: string,
    grupo: string,
  ): Promise<{ uso: Map<string, Map<number, number>>; lido: boolean }> {
    const chave = `${h}|${grupo}`;
    const c = this.cacheUso.get(chave);
    const validade = this.d.validadeUsoMs ?? 30 * 60_000;
    if (c && this.agora() - c.em < validade) return { uso: c.uso, lido: true };
    try {
      const uso = await this.d.porta.uso(h, grupo, new Date(this.agora() - DIAS_USO_SANEAMENTO * DIA_MS));
      this.cacheUso.set(chave, { em: this.agora(), uso });
      return { uso, lido: true };
    } catch {
      return { uso: new Map(), lido: false };
    }
  }

  private candidatos(com: readonly GrupoComOpcoes[]): GrupoCandidato[] {
    return com.map((g) => ({ grupo: g.grupo, ativo: g.ativo, opcoes: new Set(g.opcoes) }));
  }

  private async maximo(a: AtorSaneamento): Promise<number> {
    return this.d.administradoresMaximo(a.rede, a.hospital);
  }

  private administradoresMantidos(plano: readonly ItemSaneamento[], excetoLogin?: string): number {
    let n = 0;
    for (const [login, i] of ultimaPorLogin(plano))
      if (login !== excetoLogin && i.decisao === 'manter-administrador' && i.situacao !== 'falhou') n++;
    return n;
  }

  // ── leituras ─────────────────────────────────────────────────────────────────────────────────

  async painel(a: AtorSaneamento): Promise<PainelSaneamento> {
    await this.pronto(a.hospital);
    const [grupos, plano, com, maximo] = await Promise.all([
      this.d.porta.grupos(a.hospital, GRUPOS_GENERICOS),
      this.d.porta.plano(a.hospital),
      this.d.porta.gruposComOpcoes(a.hospital),
      this.maximo(a),
    ]);
    const ultimas = [...ultimaPorLogin(plano).values()];
    const ativosNoMaster = grupos.find((g) => g.grupo === GRUPO_ADMINISTRADORES)?.ativos ?? 0;
    return {
      grupos: grupos.map((g) => {
        const doGrupo = plano.filter((i) => i.grupoOrigem === g.grupo);
        const vivosUsuarios = ultimas.filter(
          (i) => i.grupoOrigem === g.grupo && (itemVivo(i.situacao) || i.decisao === 'manter-administrador'),
        ).length;
        return {
          grupo: g.grupo,
          existe: g.existe,
          ativo: g.ativo,
          usuarios: g.usuarios,
          ativos: g.ativos,
          opcoes: g.opcoes,
          propostos: doGrupo.filter((i) => i.situacao === 'proposto').length,
          aprovados: doGrupo.filter((i) => i.situacao === 'aprovado').length,
          aplicados: doGrupo.filter((i) => i.situacao === 'aplicado').length,
          semDecisao: Math.max(0, g.ativos - vivosUsuarios),
          inativosNoGrupo: Math.max(0, g.usuarios - g.ativos),
          dissolvivel: g.existe && validarDissolucao(g.grupo, g.ativos, g.opcoes) === null,
        };
      }),
      administradores: {
        maximo,
        mantidos: this.administradoresMantidos(plano),
        ativosNoMaster,
        excedido: ativosNoMaster > maximo,
      },
      destinos: this.candidatos(com)
        .filter(destinoValido)
        .map((c) => ({ grupo: c.grupo, opcoes: c.opcoes.size }))
        .sort((x, y) => x.grupo.localeCompare(y.grupo)),
      janelaDias: DIAS_USO_SANEAMENTO,
    };
  }

  async usuarios(a: AtorSaneamento, grupo: string): Promise<UsuariosSaneamento> {
    if (!ehGrupoGenerico(grupo)) exigir('grupo-nao-generico', 400);
    await this.pronto(a.hospital);
    const [lista, com, plano, uso] = await Promise.all([
      this.d.porta.usuarios(a.hospital, grupo),
      this.d.porta.gruposComOpcoes(a.hospital),
      this.d.porta.plano(a.hospital, grupo),
      this.usoDoGrupo(a.hospital, grupo),
    ]);
    const candidatos = this.candidatos(com);
    const ultimas = ultimaPorLogin(plano);
    const hoje = this.hoje();
    return {
      grupo,
      usoLido: uso.lido,
      usuarios: lista.map((u) => ({
        login: u.login,
        idUsuario: u.idUsuario,
        nome: u.nome,
        ativo: u.ativo,
        bloqueado: u.bloqueado,
        ultimoAcesso: u.ultimoAcesso,
        diasSemAcesso: diasSemAcesso(u.ultimoAcesso, hoje),
        sugestao: sugerirDestino(uso.uso.get(u.login) ?? new Map(), candidatos),
        item: ultimas.get(u.login) ?? null,
      })),
    };
  }

  private async conta(h: string, login: string): Promise<UsuarioDoGrupo> {
    const u = await this.d.porta.usuario(h, login);
    if (!u) throw new ErroSaneamento('usuario-inexistente', 'Usuário não encontrado.', 404);
    return u;
  }

  /** Simulação crua (as contagens e os IDs) da troca de grupo de um usuário. */
  private async simularCru(h: string, u: UsuarioDoGrupo, destino: string) {
    const grupo = grupoAmplo(u);
    const [com, uso] = await Promise.all([this.d.porta.gruposComOpcoes(h), this.usoDoGrupo(h, grupo)]);
    const cands = this.candidatos(com);
    const origem = cands.find((c) => c.grupo === grupo);
    const dest = cands.find((c) => c.grupo === destino) ?? null;
    const usoUsuario = uso.uso.get(u.login) ?? new Map<number, number>();
    const r = simularTroca(origem?.opcoes ?? new Set(), dest?.opcoes ?? new Set(), usoUsuario);
    return { r, dest, usoUsuario, lido: uso.lido };
  }

  async simular(a: AtorSaneamento, login: string, destino: string): Promise<SimulacaoSaneamento> {
    await this.pronto(a.hospital);
    const u = await this.conta(a.hospital, login);
    const grupoOrigem = grupoAmplo(u);
    const { r, dest, usoUsuario, lido } = await this.simularCru(a.hospital, u, destino);
    if (!dest || ehGrupoGenerico(dest.grupo)) exigir(dest ? 'destino-generico' : 'destino-invalido');
    const ganhas = r.ganhas.slice(0, LISTA_SIMULACAO);
    const perdidas = r.perdidas.slice(0, LISTA_SIMULACAO);
    const titulos = await this.d.porta.titulos(a.hospital, [...ganhas, ...perdidas]);
    const opcao = (id: number) => ({
      id,
      titulo: titulos.get(id) ?? `Opção ${id}`,
      usos: usoUsuario.get(id) ?? 0,
    });
    return {
      login: u.login,
      grupoOrigem,
      grupoDestino: destino,
      antes: r.antes,
      depois: r.depois,
      mantidas: r.mantidas,
      ganhas: ganhas.map(opcao),
      ganhasTotal: r.ganhas.length,
      perdidas: perdidas.map(opcao),
      perdidasTotal: r.perdidas.length,
      perdidasUsadas: r.perdidasUsadas,
      exigeAprovacao: r.exigeAprovacao,
      usoLido: lido,
      janelaDias: DIAS_USO_SANEAMENTO,
    };
  }

  async plano(a: AtorSaneamento, grupo?: string): Promise<ItemSaneamento[]> {
    await this.pronto(a.hospital);
    return this.d.porta.plano(a.hospital, grupo);
  }

  /**
   * Guarda do limite de administradores fora do saneamento (achado 1 da revisão do M59.4): a tela de Usuários chama
   * antes de pôr alguém no grupo de acesso total (criar ou trocar de grupo, `grupoNovo`) ou de desbloquear (`grupoNovo`
   * null). Recusa com administradores-no-limite quando os ativos do MASTER passariam do máximo do estabelecimento. Não
   * depende da tabela do plano: conta as contas com o perfil na hora.
   */
  async conferirEntradaNoMaster(
    a: { readonly rede: string; readonly hospital: string },
    login: string,
    grupoNovo: string | null,
  ): Promise<void> {
    const master = (g: string | null) => g !== null && chaveGrupo(g) === GRUPO_ADMINISTRADORES;
    if (grupoNovo !== null && !master(grupoNovo)) return;
    const u = await this.d.porta.usuario(a.hospital, login);
    const contaHoje = !!u && master(u.grupo) && u.ativo && !u.bloqueado;
    const entra =
      grupoNovo !== null
        ? !contaHoje && (!u || (u.ativo && !u.bloqueado))
        : !!u && master(u.grupo) && u.ativo && u.bloqueado;
    if (!entra) return;
    const [[g], maximo] = await Promise.all([
      this.d.porta.grupos(a.hospital, [GRUPO_ADMINISTRADORES]),
      this.d.administradoresMaximo(a.rede, a.hospital),
    ]);
    exigir(validarEntradaNoMaster(entra, g?.ativos ?? 0, maximo));
  }

  // ── plano ────────────────────────────────────────────────────────────────────────────────────

  async incluir(a: AtorSaneamento, n: NovoItemSaneamento): Promise<ItemSaneamento> {
    await this.pronto(a.hospital);
    const u = await this.conta(a.hospital, n.login);
    const grupoOrigem = grupoAmplo(u);
    if (n.decisao === 'bloquear' && u.emOutroEstabelecimento)
      throw new ErroSaneamento(
        'conta-em-outro-estabelecimento',
        'A conta tem perfil vigente em outro estabelecimento: o bloqueio vale na rede toda; troque o perfil aqui.',
      );
    const [plano, maximo] = await Promise.all([this.d.porta.plano(a.hospital), this.maximo(a)]);
    let perdasTotal = 0;
    let perdasUsadas = 0;
    let destino: GrupoCandidato | null = null;
    let lido = true;
    if (n.decisao === 'trocar-grupo' && n.grupoDestino) {
      const s = await this.simularCru(a.hospital, u, n.grupoDestino);
      destino = s.dest;
      perdasTotal = s.r.perdidas.length;
      perdasUsadas = s.r.perdidasUsadas;
      lido = s.lido;
    }
    exigir(
      validarDecisao(
        {
          login: u.login,
          grupo: grupoOrigem,
          ativo: u.ativo,
          bloqueado: u.bloqueado,
          diasSemAcesso: diasSemAcesso(u.ultimoAcesso, this.hoje()),
        },
        n.decisao,
        {
          ator: a.login,
          destino,
          administradoresMaximo: maximo,
          administradoresMantidos: this.administradoresMantidos(plano, u.login),
        },
      ),
    );
    // Sem o uso lido, ninguém sabe se perde opção usada: a decisão exige a aprovação da área (falha fechada).
    const exigeAprovacao = n.decisao === 'trocar-grupo' && (perdasUsadas > 0 || (!lido && perdasTotal > 0));
    const { id } = await this.d.porta.incluir(
      a.hospital,
      {
        hospital: a.hospital,
        grupoOrigem,
        idUsuario: u.idUsuario,
        login: u.login,
        decisao: n.decisao,
        grupoDestino: n.decisao === 'trocar-grupo' ? n.grupoDestino : null,
        perdasTotal,
        perdasUsadas,
        exigeAprovacao,
        motivo: n.motivo,
        criadoPor: a.login,
      },
      this.trilha(a, EVENTOS_AUDITAVEIS.saneamentoItemIncluido.codigo, 'incluir'),
    );
    return this.itemOu404(a.hospital, id);
  }

  private async itemOu404(h: string, id: string): Promise<ItemSaneamento> {
    const i = await this.d.porta.item(h, id);
    if (!i) throw new ErroSaneamento('item-inexistente', 'Decisão não encontrada.', 404);
    return i;
  }

  async aprovar(a: AtorSaneamento, id: string, p: AprovarItemSaneamento): Promise<ItemSaneamento> {
    await this.pronto(a.hospital);
    const i = await this.itemOu404(a.hospital, id);
    exigir(validarAprovacao(i, a.login));
    const ok = await this.d.porta.aprovar(
      a.hospital,
      { id, area: p.area, aprovadoPor: a.login, motivo: p.motivo },
      this.trilha(a, EVENTOS_AUDITAVEIS.saneamentoItemAprovado.codigo, 'aprovar'),
    );
    if (!ok) throw new ErroSaneamento('alterado', 'A decisão foi alterada por outra pessoa; recarregue.');
    return this.itemOu404(a.hospital, id);
  }

  async descartar(a: AtorSaneamento, id: string): Promise<ItemSaneamento> {
    await this.pronto(a.hospital);
    const i = await this.itemOu404(a.hospital, id);
    exigir(validarDescarte(i));
    const ok = await this.d.porta.descartar(
      a.hospital,
      { id, por: a.login },
      this.trilha(a, EVENTOS_AUDITAVEIS.saneamentoItemDescartado.codigo, 'descartar'),
    );
    if (!ok) throw new ErroSaneamento('alterado', 'A decisão foi alterada por outra pessoa; recarregue.');
    return this.itemOu404(a.hospital, id);
  }

  // ── aplicação (operações do executor do núcleo) ────────────────────────────────────────────

  private executor(nome: string, h: string): ExecutorSaneamento {
    const x = this.d.executor;
    if (!x) throw new ErroSaneamento('indisponivel', 'Gravação indisponível.', 503);
    const r = x.receita(nome, h);
    if (!r.ligada)
      throw new ErroSaneamento('operacao-desligada', r.motivo ?? 'Operação desligada neste estabelecimento.');
    return x;
  }

  private async falhou(a: AtorSaneamento, id: string, e: unknown): Promise<void> {
    const codigo =
      e instanceof ErroOperacao ? (e.problema.codigo ?? `erro-${e.problema.status}`) : 'erro-inesperado';
    await this.d.porta
      .concluir(
        a.hospital,
        { id, por: a.login, resultado: 'falhou', erro: codigo },
        {
          ...this.trilha(a, EVENTOS_AUDITAVEIS.saneamentoItemAplicado.codigo, 'aplicar'),
          resultado: 'falha',
        },
      )
      .catch(() => undefined);
  }

  private nomeDa(decisao: 'trocar-grupo' | 'bloquear'): string {
    return decisao === 'trocar-grupo' ? OPERACOES_SANEAMENTO.trocarGrupo : OPERACOES_SANEAMENTO.bloquear;
  }

  private async reservar(a: AtorSaneamento, id: string): Promise<void> {
    const ok = await this.d.porta.reservar(
      a.hospital,
      { id, por: a.login },
      this.trilha(a, EVENTOS_AUDITAVEIS.saneamentoItemAplicado.codigo, 'reservar'),
    );
    if (!ok)
      throw new ErroSaneamento(
        'alterado',
        'A decisão está sendo aplicada ou foi alterada por outra pessoa; recarregue.',
      );
  }

  async aplicar(
    a: AtorSaneamento,
    id: string,
    ctx: ContextoAplicacao,
  ): Promise<ResultadoAplicacaoSaneamento> {
    await this.pronto(a.hospital);
    const i = await this.itemOu404(a.hospital, id);
    if (i.decisao === 'dissolver-grupo' || i.login === null)
      throw new ErroSaneamento('situacao-nao-permite', TEXTOS_RECUSA['situacao-nao-permite']);
    const u = await this.conta(a.hospital, i.login);
    if (u.grupo !== i.grupoOrigem) exigir('usuario-fora-do-grupo');
    let perdasAgora = 0;
    if (i.decisao === 'trocar-grupo' && i.grupoDestino) {
      const s = await this.simularCru(a.hospital, u, i.grupoDestino);
      perdasAgora = s.lido ? s.r.perdidasUsadas : i.perdasUsadas;
    }
    exigir(validarAplicacao(i, a.login, perdasAgora));
    if (u.grupo !== i.grupoOrigem) exigir('usuario-fora-do-grupo');
    const nome = i.decisao === 'manter-administrador' ? null : this.nomeDa(i.decisao);
    const x = nome ? this.executor(nome, a.hospital) : null;
    // Reserva ANTES de gravar no banco (achado 3 da revisão do M59.4): sem ela, um descarte ou um segundo pedido entre
    // a operação e a conclusão deixaria o plano dizendo o contrário do banco. Quem não reserva não grava nada.
    await this.reservar(a, id);
    if (nome && x) {
      const entrada =
        i.decisao === 'trocar-grupo'
          ? { login: i.login, grupoOrigem: i.grupoOrigem, grupo: i.grupoDestino }
          : { login: i.login, motivo: i.motivo };
      try {
        await x.executar(nome, a.hospital, entrada, {
          ...ctx,
          hospital: a.hospital,
          login: a.login,
          correlacao: a.correlacao,
          estacao: a.estacao,
        });
      } catch (e) {
        await this.falhou(a, id, e);
        throw e;
      }
    }
    const ok = await this.d.porta.concluir(
      a.hospital,
      { id, por: a.login, resultado: 'aplicado', erro: null },
      this.trilha(a, EVENTOS_AUDITAVEIS.saneamentoItemAplicado.codigo, 'aplicar'),
    );
    if (!ok) throw new ErroSaneamento('alterado', 'A reserva da decisão se perdeu; recarregue e confira.');
    this.cacheUso.delete(`${a.hospital}|${i.grupoOrigem}`);
    await this.d.invalidar?.(a.rede, a.hospital, i.login).catch(() => undefined);
    return { item: await this.itemOu404(a.hospital, id), operacao: nome, lotes: nome ? 1 : 0 };
  }

  /**
   * Dissolução do grupo vazio: registra a decisão e retira as opções em lotes (uma transação por lote, pela receita
   * de retirada). Um lote que falha deixa a decisão como "não aplicada"; os lotes já retirados ficam. Repetir o pedido com a
   * mesma Idempotency-Key retira o resto: a chave de cada lote deriva das ações dele (chaveDoLote), e o lote já retirado
   * não volta a aparecer, porque as ações são relidas do perfil.
   */
  async dissolver(
    a: AtorSaneamento,
    grupo: string,
    motivo: string,
    ctx: ContextoAplicacao,
  ): Promise<ResultadoAplicacaoSaneamento> {
    await this.pronto(a.hospital);
    if (!ehGrupoGenerico(grupo)) exigir('grupo-nao-generico', 400);
    const [g] = await this.d.porta.grupos(a.hospital, [grupo]);
    exigir(validarDissolucao(grupo, g?.ativos ?? 0, g?.existe ? g.opcoes : 0));
    const nome = OPERACOES_SANEAMENTO.retirarOpcoes;
    const x = this.executor(nome, a.hospital);
    const com = await this.d.porta.gruposComOpcoes(a.hospital);
    const opcoes = [...(com.find((c) => c.grupo === grupo)?.opcoes ?? [])].sort((p, q) => p - q);
    const { id } = await this.d.porta.incluir(
      a.hospital,
      {
        hospital: a.hospital,
        grupoOrigem: grupo,
        idUsuario: null,
        login: null,
        decisao: 'dissolver-grupo',
        grupoDestino: null,
        perdasTotal: opcoes.length,
        perdasUsadas: 0,
        exigeAprovacao: false,
        motivo,
        criadoPor: a.login,
      },
      this.trilha(a, EVENTOS_AUDITAVEIS.saneamentoItemIncluido.codigo, 'incluir'),
    );
    await this.reservar(a, id);
    const lotes = emLotes(opcoes, LOTE_OPCOES_DISSOLUCAO);
    for (const lote of lotes) {
      try {
        await x.executar(
          nome,
          a.hospital,
          { grupo, opcoes: lote },
          {
            ...ctx,
            chaveIdempotencia: chaveDoLote(ctx.chaveIdempotencia, lote),
            hospital: a.hospital,
            login: a.login,
            correlacao: a.correlacao,
            estacao: a.estacao,
          },
        );
      } catch (e) {
        await this.falhou(a, id, e);
        throw e;
      }
    }
    const ok = await this.d.porta.concluir(
      a.hospital,
      { id, por: a.login, resultado: 'aplicado', erro: null },
      this.trilha(a, EVENTOS_AUDITAVEIS.saneamentoItemAplicado.codigo, 'aplicar'),
    );
    // As opções já saíram (cada lote confirmou): o cache cai mesmo assim, e a resposta não diz "aplicado" sem a linha.
    await this.d.invalidar?.(a.rede, a.hospital, null).catch(() => undefined);
    if (!ok) throw new ErroSaneamento('alterado', 'A reserva da decisão se perdeu; recarregue e confira.');
    return { item: await this.itemOu404(a.hospital, id), operacao: nome, lotes: lotes.length };
  }
}
