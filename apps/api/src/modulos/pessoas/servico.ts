// Serviço da gestão de pessoas, fatia F1 (M52.1; ficha, seções 4, 5, 7 e 8; regras 1 a 4): colaboradores e admissão,
// a ficha com o lado assistencial, dependentes, mudança funcional, o desligamento ligado ao acesso e a validade do
// conselho. As gravações exigem a chave `pessoas.colaborador` (POL-3; o administrador liga em Funcionalidades) e as
// regras puras de @sgh/dominio-pessoas antes de gravar; o estabelecimento vem da sessão, nunca do pedido (um vínculo
// de outro estabelecimento responde 404). O CPF só como filtro exato e cifrado (D-CPF-52): nunca volta inteiro.
// O desligamento segue a ordem da ficha (seção 5): 1) o bloqueio de cada usuário da pessoa neste estabelecimento pelo
// executor (`acesso.bloquearUsuario`, cenário `desligamento`); 2) o vínculo e o histórico em SGH_; 3) o evento
// PESSOAS_COLABORADOR_DESLIGADO na SGH_OUTBOX, na mesma transação do passo 2. As sessões dos bloqueados caem depois.
// Antes do passo 1, as mesmas travas da tela de usuários (M10 e M43): o perfil de auditoria só consulta, e o login de
// uma TV ou totem só é bloqueado depois da troca do aparelho. O CPF do vínculo precisa decifrar com a chave atual: sem
// ele, os usuários do mesmo CPF ficariam livres (o desligamento é recusado com o motivo).
import { createHash } from 'node:crypto';
import {
  type AdmitirColaboradorEntrada,
  type AlertaConselho,
  type AlterarDependenteEntrada,
  type AlterarVinculoEntrada,
  type ApoioColaboradores,
  CODIGO_CONFERENCIA_PAINEL_INDISPONIVEL,
  type ColaboradorResumo,
  type CorrigirColaboradorEntrada,
  type DescartarEventoEsocialEntrada,
  type EfeitoEsocialSesmt,
  type ExcluirEventoEsocialEntrada,
  type GerarEventoTrabalhadorEntrada,
  type ResultadoGeracaoEsocial,
  cpfValido,
  type DependenteEntrada,
  type DesligarColaboradorEntrada,
  type EncerrarDependenteEntrada,
  EVENTO_COLABORADOR_ADMITIDO,
  EVENTO_COLABORADOR_DESLIGADO,
  EVENTOS_AUDITAVEIS,
  type FichaColaborador,
  type FiltroColaboradoresEntrada,
  type FiltroHabilitacoesEntrada,
  JANELA_ALERTA_CONSELHO_DIAS,
  type LigarCargoColaboradorEntrada,
  type ListaColaboradores,
  type PainelConselho,
  type ParentescoDependente,
  type PreviaAdmissao,
  type RegistrarHabilitacaoEntrada,
  type RegistroConselhoLido,
  type ResultadoDesligamento,
  type ResultadoPessoas,
  type SituacaoHabilitacao,
  type TipoEventoHistorico,
  type TipoVinculo,
  somenteDigitos,
} from '@sgh/contratos';
import { conferirGestao, mensagemRecusaGestao } from '@sgh/dominio-acesso';
import {
  aplicarMudanca,
  alertasDeConselho,
  cpfParaFiltro,
  decidirAdmissao,
  diasEntre,
  legendaSituacaoProfissional,
  limiteCargaSemanal,
  mascararCpf,
  piorSituacao,
  planejarDesligamento,
  situacaoHabilitacao,
  vinculoAtivo,
} from '@sgh/dominio-pessoas';
import type { EventoEsocialSghLido, ProfissionalLido, UsuarioLidoPessoa, VinculoPesLido } from '@sgh/legado';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { ehGrupoDePainel } from '../administracao/login-painel.js';
import type { CacheConfig, FonteConfiguracao } from '../config/public-api.js';
import { ApoioGravacao } from '../exames/public-api.js';
import type { CifraCpf } from './cifra-cpf.js';
import type { CentroCustoPessoas, GravadorPessoas, PortaPessoas } from './porta.js';

const E = EVENTOS_AUDITAVEIS;
export const CHAVE_PESSOAS_COLABORADOR = 'pessoas.colaborador';
export const OPERACAO_BLOQUEIO = 'acesso.bloquearUsuario';
const P = {
  ler: 'pessoas.colaborador.ler',
  admitir: 'pessoas.colaborador.admitir',
  desligar: 'pessoas.colaborador.desligar',
} as const;

const naoEncontrado = () =>
  new ErroProblema(
    'nao-encontrado',
    404,
    'Colaborador não encontrado',
    'O vínculo não existe neste estabelecimento.',
  );

/** Recusa de regra (domínio): 409 com o código e a mensagem em português. */
const recusaRegra = (codigo: string, mensagem: string, campos?: readonly string[]) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, {
    codigo,
    ...(campos ? { campos: [...campos] } : {}),
  });

const conflitoVersao = () =>
  new ErroProblema(
    'conflito-de-versao',
    409,
    'Cadastro alterado',
    'Outra pessoa alterou este colaborador depois que você abriu. Abra de novo.',
  );

const semCifra = () =>
  new ErroProblema(
    'recurso-desligado',
    403,
    'Cadastro de colaboradores em consulta',
    'A chave de proteção do CPF dos colaboradores não está configurada neste ambiente: a admissão e os dependentes ficam desligados até a TI registrá-la no cofre.',
    { codigo: 'chave-cpf-ausente' },
  );

const cpfDe = (cifra: CifraCpf | null, texto: string | null) => (cifra ? cifra.decifrar(texto) : null);

const cpfIlegivel = () =>
  recusaRegra(
    'cpf-ilegivel',
    'O CPF deste colaborador não se lê com a chave de proteção atual: sem ele, os acessos da mesma pessoa ficariam livres. Peça à TI para conferir a chave do CPF antes de desligar.',
  );

/** O que o desligamento faz com as sessões de um login (o controlador derruba no armazém das sessões). */
export type RevogarSessoes = (rede: string, hospital: string, login: string) => Promise<number>;

/**
 * A trava do login de painel (TV ou totem) antes do bloqueio: 409 se o aparelho ainda usa o login, 503 se não se
 * conferiu agora (o controlador liga à mesma conferência da tela de usuários; null: falha fechada).
 */
export type ConferirLoginPainel = (s: SessaoCadastro, login: string) => Promise<void>;

/** Os perfis do operador na sessão (perfil principal e complementares), como na tela de usuários. */
function perfisDe(s: SessaoCadastro): string[] {
  const p = s.req.sgh?.sessao?.perfil;
  return [...(p?.perfil ? [p.perfil] : []), ...(p?.complementares ?? [])];
}

/**
 * A Idempotency-Key do bloqueio de cada usuário, derivada da chave do pedido (até 80 caracteres): o resumo da chave
 * do pedido mais o ID do usuário, nunca cortado (dois usuários nunca dividem a chave; a repetição dá a mesma).
 */
export function chaveDoBloqueio(base: string, usuario: number): string {
  return `${createHash('sha256').update(base).digest('hex').slice(0, 40)}-desl-u${usuario}`;
}

/**
 * Revisão W0-06: o pedaço da fila do eSocial que a correção de matrícula ou admissão usa para o S-2200/S-2300 do
 * vínculo (o ServicoEsocial atende; nulo nos testes e nas montagens sem a folha). Nada sai do dev.
 */
export interface FilaVinculoEsocial {
  eventosVinculo(s: SessaoCadastro, vinculo: number): Promise<EventoEsocialSghLido[]>;
  gerarTrabalhador(s: SessaoCadastro, x: GerarEventoTrabalhadorEntrada): Promise<ResultadoGeracaoEsocial>;
  descartar(s: SessaoCadastro, id: number, x: DescartarEventoEsocialEntrada): Promise<unknown>;
  excluir(s: SessaoCadastro, id: number, x: ExcluirEventoEsocialEntrada): Promise<ResultadoGeracaoEsocial>;
}

/** O S-2200/S-2300 na fila: o que ainda não saiu se descarta; o que está em lote ou enviado espera o retorno. */
const ADMISSAO_NAO_ENVIADA: ReadonlySet<string> = new Set(['gerado', 'invalido', 'validado', 'rejeitado']);
const ADMISSAO_EM_TRANSITO: ReadonlySet<string> = new Set(['em-lote', 'enviado']);

const efeitoEsocial = (
  operacao: EfeitoEsocialSesmt['operacao'],
  r: ResultadoGeracaoEsocial | null,
  anterior: number | null,
): EfeitoEsocialSesmt => {
  const ev = r?.eventos[0];
  return {
    operacao,
    evento: ev?.id ?? null,
    anterior,
    valido: ev ? ev.valido && ev.pendencias.length === 0 : true,
    pendencias: ev ? ev.pendencias.map((p) => ({ codigo: p.codigo, mensagem: p.mensagem })) : [],
  };
};

export class ServicoPessoas {
  readonly apoio: ApoioGravacao<GravadorPessoas>;

  constructor(
    readonly porta: PortaPessoas,
    private readonly trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
    private readonly cifra: CifraCpf | null,
    /** Revisão W0-06: a fila do eSocial do S-2200/S-2300 (a correção de matrícula ou admissão a confere). */
    private readonly esocial: FilaVinculoEsocial | null = null,
  ) {
    this.apoio = new ApoioGravacao<GravadorPessoas>(
      {
        chave: CHAVE_PESSOAS_COLABORADOR,
        nome: 'o cadastro de colaboradores',
        operacoes: { [OPERACAO_BLOQUEIO]: P.desligar },
      },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private async janela(s: SessaoCadastro): Promise<number> {
    const v = await this.apoio.parametro(s, 'pessoas.alertaConselhoDias').catch(() => 0);
    return v > 0 ? v : JANELA_ALERTA_CONSELHO_DIAS;
  }

  private exigirCifra(): CifraCpf {
    if (!this.cifra) throw semCifra();
    return this.cifra;
  }

  private async vinculoOu404(s: SessaoCadastro, id: number): Promise<VinculoPesLido> {
    const v = await this.porta.vinculo(s.porta, id);
    if (!v || v.hospital !== s.hospital) throw naoEncontrado();
    return v;
  }

  // ── Apoio ───────────────────────────────────────────────────────────────────────────────────────────────────

  async apoioTela(s: SessaoCadastro): Promise<ApoioColaboradores> {
    const [hoje, centros, unidades, tipos, janela, gravacao] = await Promise.all([
      this.porta.hoje(s.porta),
      this.porta.centrosDeCusto(s.porta),
      this.porta.unidades(s.porta),
      this.porta.tiposRescisao(s.porta),
      this.janela(s),
      this.apoio.gravacao(s, { admitir: P.admitir }),
    ]);
    const motivoCifra = this.cifra ? null : (semCifra().detalhe ?? null);
    const admitir = (gravacao.operacoes['admitir']?.pode ?? false) && this.cifra !== null;
    const desligar = (gravacao.operacoes[OPERACAO_BLOQUEIO]?.pode ?? false) && this.cifra !== null;
    return {
      hoje,
      centrosCusto: centros.filter((c) => c.ativo).map((c) => ({ codigo: c.codigo, rotulo: c.nome })),
      unidades: unidades.map((u) => ({ codigo: u.codigo, rotulo: u.nome })),
      tiposRescisao: tipos.map((t) => ({ codigo: t.codigo, rotulo: t.nome })),
      janelaAlertaDias: janela,
      gravacao: {
        ligada: gravacao.ligada && this.cifra !== null,
        motivo: gravacao.ligada ? motivoCifra : gravacao.motivo,
      },
      acoes: {
        admitir,
        desligar,
        motivo:
          admitir && desligar
            ? null
            : (gravacao.operacoes['admitir']?.motivo ??
              gravacao.operacoes[OPERACAO_BLOQUEIO]?.motivo ??
              motivoCifra ??
              gravacao.motivo),
      },
    };
  }

  // ── Conselho (situação por registro) ────────────────────────────────────────────────────────────────────────

  private async registrosComValidade(
    s: SessaoCadastro,
    profs: readonly ProfissionalLido[],
    hoje: string,
    janela: number,
    comUnidades = false,
  ): Promise<Map<number, RegistroConselhoLido[]>> {
    const regs = profs.flatMap((p) => p.registros);
    const ids = regs.map((r) => r.id);
    const [hab, unidades] = await Promise.all([
      this.porta.habilitacoes(s.porta, ids),
      comUnidades ? this.porta.unidadesDosRegistros(s.porta, ids) : Promise.resolve(null),
    ]);
    const r = new Map<number, RegistroConselhoLido[]>();
    for (const x of regs) {
      const h = hab.get(x.id);
      // A conferência só vale para o mesmo número e conselho (se o cadastro mudou o registro, conferir de novo).
      const valeConferencia = h && h.numero === x.numero && (h.conselho ?? null) === (x.conselho ?? null);
      const validade = valeConferencia ? h.validade : null;
      const sv = situacaoHabilitacao(validade, hoje, janela);
      r.set(x.profissional, [
        ...(r.get(x.profissional) ?? []),
        {
          registro: x.id,
          conselho: x.conselho,
          numero: x.numero,
          uf: x.uf,
          cbo: x.cbo,
          cboDescricao: x.cboDescricao,
          ativo: x.ativo,
          validade,
          situacao: sv.situacao,
          diasParaVencer: sv.diasParaVencer,
          unidades: (unidades?.get(x.id) ?? []).map((u) => ({
            codigo: u.codigo,
            nome: u.nome,
            ativo: u.ativo,
          })),
        },
      ]);
    }
    return r;
  }

  private piorDoProfissional(regs: readonly RegistroConselhoLido[] | undefined): SituacaoHabilitacao | null {
    return piorSituacao((regs ?? []).filter((r) => r.ativo !== false).map((r) => r.situacao));
  }

  // ── Lista e ficha ───────────────────────────────────────────────────────────────────────────────────────────

  /** O termo que é um CPF válido (com ou sem máscara) vira o filtro exato pelo HMAC; sem a chave, segue como termo. */
  private cpfDoTermo(termo: string | undefined): string | undefined {
    const t = termo?.trim() ?? '';
    if (!this.cifra || !/^[\d.\-\s]+$/.test(t)) return undefined;
    const d = somenteDigitos(t);
    return d.length === 11 && cpfValido(d) ? this.cifra.hmac(d) : undefined;
  }

  async lista(s: SessaoCadastro, f: FiltroColaboradoresEntrada): Promise<ListaColaboradores> {
    const cpfHmac = this.cpfDoTermo(f.termo);
    const [r, centros, unidades, hoje, janela] = await Promise.all([
      this.porta.listarVinculos(s.porta, {
        ...(cpfHmac ? { cpfHmac } : f.termo ? { termo: f.termo } : {}),
        ...(f.centroCusto !== undefined ? { centroCusto: f.centroCusto } : {}),
        ...(f.unidade !== undefined ? { unidade: f.unidade } : {}),
        ...(f.setor ? { setor: f.setor } : {}),
        ...(f.tipo ? { tipo: f.tipo } : {}),
        estado: f.estado,
        ...(f.depois !== undefined ? { depois: f.depois } : {}),
        limite: f.limite,
      }),
      this.porta.centrosDeCusto(s.porta),
      this.porta.unidades(s.porta),
      this.porta.hoje(s.porta),
      this.janela(s),
    ]);
    const ids = [...new Set(r.itens.map((v) => v.profissional).filter((x): x is number => x !== null))];
    const profs = await this.porta.profissionais(s.porta, ids);
    const regs = await this.registrosComValidade(s, profs, hoje, janela);
    const cc = new Map(centros.map((c) => [c.codigo, c]));
    const un = new Map(unidades.map((u) => [u.codigo, u.nome]));
    return {
      itens: r.itens.map((v): ColaboradorResumo => ({
        vinculo: v.id,
        nome: v.nome,
        matricula: v.matricula,
        tipo: v.tipo as TipoVinculo,
        cargo: v.cargo,
        lotacao: lotacao(v, cc, un),
        admissao: v.admissao,
        desligamento: v.desligamento,
        estado: v.desligamento ? 'desligado' : 'ativo',
        conselho: v.profissional !== null ? this.piorDoProfissional(regs.get(v.profissional)) : null,
      })),
      depois: r.depois,
    };
  }

  /**
   * Os usuários da pessoa neste estabelecimento: o ligado ao vínculo e os do mesmo CPF (filtro exato). `estrito` (o
   * desligamento): o CPF que não decifra com a chave atual recusa, em vez de seguir só com o usuário ligado.
   */
  private async usuariosDaPessoa(
    s: SessaoCadastro,
    v: VinculoPesLido,
    estrito = false,
  ): Promise<UsuarioLidoPessoa[]> {
    const porId = new Map<number, UsuarioLidoPessoa>();
    const cpf = cpfDe(this.cifra, v.cpfCifrado);
    if (estrito && v.cpfCifrado && !cpf) throw cpfIlegivel();
    if (cpf)
      for (const u of (await this.porta.pessoaPorCpf(s.porta, cpfParaFiltro(cpf))).usuarios)
        porId.set(u.id, u);
    if (v.usuario !== null && !porId.has(v.usuario)) {
      const u = await this.porta.usuarioPorId(s.porta, v.usuario);
      if (u) porId.set(u.id, u);
    }
    return [...porId.values()].sort((a, b) => a.login.localeCompare(b.login));
  }

  async ficha(s: SessaoCadastro, id: number): Promise<FichaColaborador> {
    const v = await this.vinculoOu404(s, id);
    const [centros, unidades, hoje, janela, outros, historico, dependentes, usuarios, correcoes] =
      await Promise.all([
        this.porta.centrosDeCusto(s.porta),
        this.porta.unidades(s.porta),
        this.porta.hoje(s.porta),
        this.janela(s),
        this.porta.vinculosDaPessoa(s.porta, v.pessoa),
        this.porta.historico(s.porta, v.id),
        this.porta.dependentes(s.porta, v.id),
        this.usuariosDaPessoa(s, v),
        this.porta.correcoes(s.porta, v.id),
      ]);
    const idCargo = v.idCargo ?? null;
    const [profs, quadro] = await Promise.all([
      v.profissional !== null ? this.porta.profissionais(s.porta, [v.profissional]) : Promise.resolve([]),
      idCargo !== null ? this.porta.cargoQuadro(s.porta, idCargo) : Promise.resolve(null),
    ]);
    const prof = profs[0] ?? null;
    const regs = await this.registrosComValidade(s, profs, hoje, janela, true);
    const cc = new Map(centros.map((c) => [c.codigo, c]));
    const un = new Map(unidades.map((u) => [u.codigo, u.nome]));
    return {
      vinculo: v.id,
      versao: v.versao,
      nome: v.nome,
      cpfMascarado: mascararCpf(cpfDe(this.cifra, v.cpfCifrado)),
      matricula: v.matricula,
      tipo: v.tipo as TipoVinculo,
      cargo: v.cargo,
      cargoQuadro: quadro ? { id: quadro.id, nome: quadro.nome, cbo: quadro.cbo, ativo: quadro.ativo } : null,
      funcao: v.funcao,
      cargaSemanalHoras: v.cargaSemanal,
      lotacao: lotacao(v, cc, un),
      admissao: v.admissao,
      desligamento:
        v.desligamento && v.tipoRescisao !== null
          ? { data: v.desligamento, tipoRescisao: v.tipoRescisao, motivo: v.motivoDesligamento ?? '' }
          : null,
      estado: v.desligamento ? 'desligado' : 'ativo',
      outrosVinculos: outros
        .filter((o) => o.id !== v.id)
        .map((o) => ({
          vinculo: o.id,
          tipo: o.tipo as TipoVinculo,
          estado: o.desligamento ? ('desligado' as const) : ('ativo' as const),
          cargo: o.cargo,
        })),
      profissional: prof
        ? {
            id: prof.id,
            situacaoLegado: legendaSituacaoProfissional(prof.situacao)?.codigo ?? null,
            registros: regs.get(prof.id) ?? [],
          }
        : null,
      usuarios: usuarios.map((u) => ({
        hospital: s.hospital,
        login: u.login,
        bloqueado: u.bloqueado,
        ativo: u.ativo,
      })),
      dependentes: dependentes.map((d) => ({
        id: d.id,
        nome: d.nome,
        nascimento: d.nascimento,
        parentesco: d.parentesco as ParentescoDependente,
        cpfMascarado: mascararCpf(cpfDe(this.cifra, d.cpfCifrado)),
        dependenteIr: d.dependenteIr,
        dependenteSalarioFamilia: d.dependenteSalarioFamilia,
        desde: d.desde,
      })),
      correcoes: correcoes.map((c) => ({
        id: c.id,
        operacao: c.operacao,
        tabela: c.tabela,
        registro: c.registro,
        antes: c.antes,
        depois: c.depois,
        motivo: c.motivo,
        por: c.por,
        em: c.em,
      })),
      historico: historico.map((h) => ({
        id: h.id,
        tipo: h.tipo as TipoEventoHistorico,
        vigencia: h.vigencia,
        antes: h.antes,
        depois: h.depois,
        motivo: h.motivo,
        registradoPor: h.registradoPor,
        registradoEm: h.registradoEm,
      })),
    };
  }

  // ── Admissão (regra 1) ──────────────────────────────────────────────────────────────────────────────────────

  async previa(s: SessaoCadastro, cpf: string): Promise<PreviaAdmissao> {
    const cifra = this.exigirCifra();
    const achado = await this.porta.pessoaPorCpf(s.porta, cpfParaFiltro(cpf));
    const vinculos = await this.porta.vinculosPorCpf(s.porta, cifra.hmac(cpf));
    const prof = achado.profissionais[0] ?? null;
    return {
      profissional: prof ? { id: prof.id, nome: prof.nome, registros: prof.registros } : null,
      usuarios: achado.usuarios.map((u) => ({ id: u.id, login: u.login, bloqueado: u.bloqueado })),
      vinculosAtivos: vinculos
        .filter((v) => v.desligamento === null)
        .map((v) => ({ vinculo: v.id, tipo: v.tipo as TipoVinculo, cargo: v.cargo })),
      ambigua: achado.profissionais.length > 1 || achado.usuarios.length > 1,
    };
  }

  private async conferirLotacao(
    s: SessaoCadastro,
    l: { centroCusto: number; unidade: number | null },
  ): Promise<CentroCustoPessoas> {
    const [centros, unidades] = await Promise.all([
      this.porta.centrosDeCusto(s.porta),
      this.porta.unidades(s.porta),
    ]);
    const c = centros.find((x) => x.codigo === l.centroCusto);
    if (!c || !c.ativo)
      throw recusaRegra('centro-custo-inativo', 'O centro de custo não existe ou está inativo.', [
        'lotacao.centroCusto',
      ]);
    if (l.unidade !== null && !unidades.some((u) => u.codigo === l.unidade))
      throw recusaRegra('unidade-inexistente', 'A unidade não existe neste estabelecimento.', [
        'lotacao.unidade',
      ]);
    return c;
  }

  async admitir(s: SessaoCadastro, e: AdmitirColaboradorEntrada): Promise<ResultadoPessoas> {
    await this.apoio.exigirLiberacao(s);
    const cifra = this.exigirCifra();
    const hoje = await this.porta.hoje(s.porta);
    if (diasEntre(hoje, e.admissao) > 60)
      throw recusaRegra(
        'admissao-futura',
        'A admissão pode ser registrada com até 60 dias de antecedência.',
        ['admissao'],
      );
    await this.conferirLotacao(s, e.lotacao);
    const achado = await this.porta.pessoaPorCpf(s.porta, cpfParaFiltro(e.cpf));
    const hmac = cifra.hmac(e.cpf);
    const pedido = {
      tipo: e.tipo,
      admissao: e.admissao,
      centroCusto: e.lotacao.centroCusto,
      cargaSemanalHoras: e.cargaSemanalHoras,
      profissional: e.profissional,
      usuario: e.usuario,
    };
    const paraDominio = (vs: readonly VinculoPesLido[]) =>
      vs.map((v) => ({
        id: v.id,
        tipo: v.tipo as TipoVinculo,
        centroCusto: v.centroCusto,
        cargo: v.cargo,
        admissao: v.admissao,
        desligamento: v.desligamento,
      }));
    const antes = decidirAdmissao(pedido, {
      profissionais: achado.profissionais,
      usuarios: achado.usuarios,
      vinculos: paraDominio(await this.porta.vinculosPorCpf(s.porta, hmac)),
    });
    if (!antes.ok) throw recusaRegra(antes.recusa, antes.mensagem);
    const r = await this.apoio.sgh(
      s,
      E.pessoasColaboradorAdmitido.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      (x: { id: number }) => ({ tabela: 'SGH_PES_VINCULO', id: String(x.id) }),
      async (g) => {
        // Releitura na transação: outra admissão da mesma pessoa entre a prévia e agora.
        const vs = await g.vinculosPorCpf(hmac);
        const d = decidirAdmissao(pedido, {
          profissionais: achado.profissionais,
          usuarios: achado.usuarios,
          vinculos: paraDominio(vs),
        });
        if (!d.ok) throw recusaRegra(d.recusa, d.mensagem);
        const novo = await g.incluirVinculo({
          pessoa: vs[0]?.pessoa ?? null,
          cpfHmac: hmac,
          cpfCifrado: cifra.cifrar(e.cpf),
          nome: e.nome,
          profissional: d.reusarProfissional,
          usuario: d.reusarUsuario,
          tipo: e.tipo,
          matricula: e.matricula,
          cargo: e.cargo,
          funcao: e.funcao,
          cargaSemanal: e.cargaSemanalHoras,
          centroCusto: e.lotacao.centroCusto,
          unidade: e.lotacao.unidade,
          setor: e.lotacao.setor,
          admissao: e.admissao,
          por: s.login,
        });
        await g.outbox({
          tipo: EVENTO_COLABORADOR_ADMITIDO,
          chave: `pessoas:admissao:${s.hospital}:${novo.id}`,
          carga: { vinculo: novo.id, pessoa: novo.pessoa, tipo: e.tipo, admissao: e.admissao },
        });
        return { id: novo.id };
      },
    );
    return { id: r.id, mensagem: 'Colaborador admitido.' };
  }

  // ── Mudança funcional ───────────────────────────────────────────────────────────────────────────────────────

  async mudar(s: SessaoCadastro, e: AlterarVinculoEntrada): Promise<ResultadoPessoas> {
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoOu404(s, e.vinculo);
    if (!vinculoAtivo(v)) throw recusaRegra('desligado', 'O vínculo está desligado: não recebe mudança.');
    if (v.versao !== e.versao)
      throw new ErroProblema(
        'conflito-de-versao',
        409,
        'Cadastro alterado',
        'Outra pessoa alterou este colaborador depois que você abriu. Abra de novo.',
      );
    if (e.lotacao) await this.conferirLotacao(s, e.lotacao);
    if (e.cargaSemanalHoras !== undefined && e.cargaSemanalHoras > limiteCargaSemanal(v.tipo as TipoVinculo))
      throw recusaRegra(
        'carga-acima-do-limite',
        `A carga semanal deste tipo de vínculo vai até ${limiteCargaSemanal(v.tipo as TipoVinculo)} horas.`,
        ['cargaSemanalHoras'],
      );
    await this.apoio.sgh(
      s,
      E.pessoasColaboradorAlterado.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      { tabela: 'SGH_PES_VINCULO', id: String(v.id) },
      async (g) => {
        const atual = await g.vinculo(v.id);
        if (!atual || atual.versao !== e.versao)
          throw recusaRegra(
            'desatualizado',
            'Outra pessoa alterou este colaborador agora há pouco. Abra de novo.',
          );
        const m = aplicarMudanca(
          {
            cargo: atual.cargo,
            funcao: atual.funcao,
            cargaSemanalHoras: atual.cargaSemanal,
            centroCusto: atual.centroCusto,
            unidade: atual.unidade,
            setor: atual.setor,
          },
          {
            vigencia: e.vigencia,
            ...(e.cargo !== undefined ? { cargo: e.cargo } : {}),
            ...(e.funcao !== undefined ? { funcao: e.funcao } : {}),
            ...(e.cargaSemanalHoras !== undefined ? { cargaSemanalHoras: e.cargaSemanalHoras } : {}),
            ...(e.lotacao ? { lotacao: e.lotacao } : {}),
          },
          { admissao: atual.admissao, ultimaVigencia: await g.ultimaVigencia(v.id) },
        );
        if (!m.ok) throw recusaRegra(m.recusa, m.mensagem, ['vigencia']);
        await g.alterarVinculo({
          id: v.id,
          versao: e.versao,
          cargo: m.nova.cargo,
          funcao: m.nova.funcao,
          cargaSemanal: m.nova.cargaSemanalHoras,
          centroCusto: m.nova.centroCusto,
          unidade: m.nova.unidade,
          setor: m.nova.setor,
          por: s.login,
        });
        for (const ev of m.eventos)
          await g.incluirHistorico({ vinculo: v.id, ...ev, motivo: e.motivo, por: s.login });
        return { id: v.id };
      },
    );
    return { id: v.id, mensagem: 'Mudança registrada no histórico.' };
  }

  // ── Correção cadastral (W0-06) ──────────────────────────────────────────────────────────────────────────────

  /**
   * O erro de cadastro (nome, matrícula, tipo de vínculo, admissão), não a mudança funcional: com motivo, pela versão
   * lida, com a linha 'correcao' no histórico e o valor anterior na SGH_PES_CORRECAO. Vale também para o desligado.
   * A admissão corrigida não passa da primeira mudança registrada nem do desligamento, nem vai além de 60 dias.
   */
  async corrigir(s: SessaoCadastro, e: CorrigirColaboradorEntrada): Promise<ResultadoPessoas> {
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoOu404(s, e.vinculo);
    if (v.versao !== e.versao) throw conflitoVersao();
    const antes = { nome: v.nome, matricula: v.matricula, tipo: v.tipo, admissao: v.admissao };
    const depois = {
      nome: e.nome ?? v.nome,
      matricula: e.matricula !== undefined ? e.matricula?.trim() || null : v.matricula,
      tipo: e.tipo ?? v.tipo,
      admissao: e.admissao ?? v.admissao,
    };
    const campos = (Object.keys(antes) as (keyof typeof antes)[]).filter((k) => antes[k] !== depois[k]);
    if (campos.length === 0)
      throw recusaRegra('nada-a-corrigir', 'Os dados informados são iguais aos do cadastro.', ['nome']);
    const [hoje, historico] = await Promise.all([
      this.porta.hoje(s.porta),
      this.porta.historico(s.porta, v.id),
    ]);
    if (campos.includes('admissao')) {
      if (diasEntre(hoje, depois.admissao) > 60)
        throw recusaRegra('admissao-futura', 'A admissão pode ficar com até 60 dias de antecedência.', [
          'admissao',
        ]);
      if (v.desligamento && depois.admissao > v.desligamento)
        throw recusaRegra(
          'admissao-depois-do-desligamento',
          `A admissão não pode ficar depois do desligamento (${v.desligamento}).`,
          ['admissao'],
        );
      const primeira = historico
        .filter((h) => !['admissao', 'correcao', 'desligamento'].includes(h.tipo))
        .map((h) => h.vigencia)
        .sort()[0];
      if (primeira && depois.admissao > primeira)
        throw recusaRegra(
          'admissao-depois-de-mudanca',
          `Há mudança funcional registrada em ${primeira}: a admissão não pode ficar depois dela.`,
          ['admissao'],
        );
    }
    if (campos.includes('tipo') && v.cargaSemanal > limiteCargaSemanal(depois.tipo as TipoVinculo))
      throw recusaRegra(
        'carga-acima-do-limite',
        `A carga semanal atual (${v.cargaSemanal} h) passa do limite deste tipo de vínculo (${limiteCargaSemanal(depois.tipo as TipoVinculo)} h): ajuste a jornada antes.`,
        ['tipo'],
      );
    const texto = (o: Record<string, unknown>) =>
      campos.map((k) => `${k}: ${String(o[k] ?? '—')}`).join(' · ');
    // Revisão W0-06: a matrícula e a admissão estão no S-2200/S-2300. Em lote ou enviado: recusa até o retorno. O
    // aceito com a matrícula corrigida ganha o S-3000 (a matrícula não se retifica; o S-2200 novo sai depois do
    // retorno do S-3000); só a admissão, o retificador (indRetif 2 com o recibo). O não enviado se descarta e sai de
    // novo. A prévia sem pendência vem antes de gravar.
    const { aceito, naoEnviados } = await this.filaAdmissao(s, v.id, campos);
    const exclui = aceito !== null && campos.includes('matricula');
    const motivoFila = `Cadastro corrigido: ${e.motivo}`.slice(0, 200);
    if (aceito) {
      const previa = exclui
        ? await this.esocial!.excluir(s, aceito.id, {
            versao: aceito.versao,
            motivo: motivoFila,
            gravar: false,
          })
        : await this.esocial!.gerarTrabalhador(s, {
            evento: aceito.evento as GerarEventoTrabalhadorEntrada['evento'],
            empresa: aceito.empresa,
            vinculo: v.id,
            referencia: null,
            data: null,
            retificar: aceito.id,
            gravar: false,
          });
      const pend = previa.eventos[0]?.pendencias ?? [];
      if (pend.length)
        throw recusaRegra(
          'esocial-com-pendencia',
          `A correção vai ao eSocial (${aceito.evento} aceito, evento ${aceito.id}) e ainda falta: ${pend.map((p) => p.mensagem).join(' ')}`,
        );
    }
    await this.apoio.sgh(
      s,
      E.pessoasColaboradorCorrigido.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      { tabela: 'SGH_PES_VINCULO', id: String(v.id) },
      async (g) => {
        const atual = await g.vinculo(v.id);
        if (!atual || atual.versao !== e.versao)
          throw recusaRegra(
            'desatualizado',
            'Outra pessoa alterou este colaborador agora há pouco. Abra de novo.',
          );
        await g.corrigirVinculo({ id: v.id, versao: e.versao, ...depois, por: s.login });
        await g.incluirHistorico({
          vinculo: v.id,
          tipo: 'correcao',
          vigencia: hoje,
          antes: texto(antes),
          depois: texto(depois),
          motivo: e.motivo,
          por: s.login,
        });
        await g.registrarCorrecao({
          vinculo: v.id,
          operacao: 'colaborador.corrigido',
          antes: Object.fromEntries(campos.map((k) => [k, antes[k]])),
          depois: Object.fromEntries(campos.map((k) => [k, depois[k]])),
          motivo: e.motivo,
          por: s.login,
        });
        return { id: v.id };
      },
    );
    let esocial: EfeitoEsocialSesmt | null = null;
    const fila = this.esocial;
    if (fila) {
      for (const x of naoEnviados) await fila.descartar(s, x.id, { versao: x.versao, motivo: motivoFila });
      if (aceito && exclui) {
        const g = await fila.excluir(s, aceito.id, {
          versao: aceito.versao,
          motivo: motivoFila,
          gravar: true,
        });
        esocial = efeitoEsocial('exclusao', g, aceito.id);
      } else if (aceito) {
        const g = await fila.gerarTrabalhador(s, {
          evento: aceito.evento as GerarEventoTrabalhadorEntrada['evento'],
          empresa: aceito.empresa,
          vinculo: v.id,
          referencia: null,
          data: null,
          retificar: aceito.id,
          gravar: true,
        });
        esocial = efeitoEsocial('retificacao', g, aceito.id);
      } else if (naoEnviados.length) {
        const n = naoEnviados[0]!;
        const g = await fila.gerarTrabalhador(s, {
          evento: n.evento as GerarEventoTrabalhadorEntrada['evento'],
          empresa: n.empresa,
          vinculo: v.id,
          referencia: null,
          data: null,
          retificar: null,
          gravar: true,
        });
        esocial = efeitoEsocial('original', g, n.id);
      }
    }
    const mensagens: Record<EfeitoEsocialSesmt['operacao'], string> = {
      nenhuma: '',
      original: ` O ${naoEnviados[0]?.evento ?? 'S-2200'} não enviado foi descartado e saiu de novo com os dados corrigidos.`,
      retificacao: ` O ${aceito?.evento ?? 'S-2200'} retificador está na fila do eSocial.`,
      exclusao: ` A matrícula não se retifica no eSocial: o S-3000 do ${aceito?.evento ?? 'S-2200'} aceito está na fila; depois do retorno dele, gere o ${aceito?.evento ?? 'S-2200'} de novo com a matrícula correta.`,
      descarte: '',
    };
    return {
      id: v.id,
      mensagem: `Cadastro corrigido; o valor anterior ficou no histórico.${
        esocial
          ? mensagens[esocial.operacao] +
            (esocial.valido
              ? ''
              : ` O evento ficou com pendência na fila do eSocial: ${esocial.pendencias.map((p) => p.mensagem).join(' ') || 'confira a validação'}.`)
          : !fila && (campos.includes('matricula') || campos.includes('admissao'))
            ? ' A fila do eSocial não está ligada aqui: se a admissão já foi aceita pelo eSocial, gere o evento retificador na fila do eSocial.'
            : ''
      }`,
      ...(esocial ? { esocial } : {}),
    };
  }

  /** Revisão W0-06: o S-2200/S-2300 do vínculo na fila, quando a correção mexe na matrícula ou na admissão. */
  private async filaAdmissao(
    s: SessaoCadastro,
    vinculo: number,
    campos: readonly string[],
  ): Promise<{ aceito: EventoEsocialSghLido | null; naoEnviados: EventoEsocialSghLido[] }> {
    if (!this.esocial || !(campos.includes('matricula') || campos.includes('admissao')))
      return { aceito: null, naoEnviados: [] };
    const fila = await this.esocial.eventosVinculo(s, vinculo);
    const transito = fila.find((x) => ADMISSAO_EM_TRANSITO.has(x.situacao));
    if (transito)
      throw recusaRegra(
        'evento-em-transito',
        `O ${transito.evento} deste colaborador (evento ${transito.id}) está em lote ou enviado ao eSocial: aguarde o retorno para corrigir a matrícula ou a admissão.`,
      );
    return {
      aceito: fila.find((x) => x.situacao === 'aceito') ?? null,
      naoEnviados: fila.filter((x) => ADMISSAO_NAO_ENVIADA.has(x.situacao)),
    };
  }

  // ── Cargo do quadro (W0-06, parte 5d-3a) ───────────────────────────────────────────────────────────────────

  /**
   * Liga ao colaborador o cargo do quadro de cargos e salários (a avaliação de desempenho abre pelas competências dele;
   * a ocupação e a recusa da exclusão do cargo contam por ele), ou desliga (`cargo` null). Com motivo, pela versão
   * lida, com a linha 'correcao' no histórico e o valor anterior na SGH_PES_CORRECAO. Só o cargo ativo do mesmo
   * estabelecimento; o desligado não recebe cargo (pode só perder o que tinha). O texto do cargo da mudança funcional
   * (com vigência, o que a folha e o eSocial leem) não muda aqui.
   */
  async ligarCargo(s: SessaoCadastro, e: LigarCargoColaboradorEntrada): Promise<ResultadoPessoas> {
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoOu404(s, e.vinculo);
    if (v.versao !== e.versao) throw conflitoVersao();
    const anterior = v.idCargo ?? null;
    if (anterior === e.cargo)
      throw recusaRegra(
        'nada-a-corrigir',
        e.cargo === null ? 'O colaborador já está sem cargo do quadro.' : 'Este já é o cargo do colaborador.',
        ['cargo'],
      );
    if (e.cargo !== null && v.desligamento)
      throw recusaRegra('desligado', 'O vínculo está desligado: não recebe cargo do quadro.', ['cargo']);
    const [hoje, cargoAntes, cargoNovo] = await Promise.all([
      this.porta.hoje(s.porta),
      anterior === null ? Promise.resolve(null) : this.porta.cargoQuadro(s.porta, anterior),
      e.cargo === null ? Promise.resolve(null) : this.porta.cargoQuadro(s.porta, e.cargo),
    ]);
    if (e.cargo !== null) {
      if (!cargoNovo)
        throw new ErroProblema(
          'nao-encontrado',
          404,
          'Cargo não encontrado',
          'O cargo não existe no quadro deste estabelecimento.',
          { codigo: 'cargo-nao-encontrado', campos: ['cargo'] },
        );
      if (!cargoNovo.ativo)
        throw recusaRegra('cargo-inativo', `O cargo ${cargoNovo.nome} está inativo: reative-o antes.`, [
          'cargo',
        ]);
    }
    const rotulo = (id: number | null, c: { nome: string; cbo: string } | null) =>
      id === null ? 'sem cargo do quadro' : c ? `${c.nome} (CBO ${c.cbo})` : `cargo ${id}`;
    const textoAntes = `cargo do quadro: ${rotulo(anterior, cargoAntes)}`;
    const textoDepois = `cargo do quadro: ${rotulo(e.cargo, cargoNovo)}`;
    await this.apoio.sgh(
      s,
      E.pessoasColaboradorCargoLigado.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      { tabela: 'SGH_PES_VINCULO', id: String(v.id) },
      async (g) => {
        const atual = await g.vinculo(v.id);
        if (!atual || atual.versao !== e.versao)
          throw recusaRegra(
            'desatualizado',
            'Outra pessoa alterou este colaborador agora há pouco. Abra de novo.',
          );
        if (e.cargo !== null) {
          const c = await g.cargoQuadro(e.cargo);
          if (!c || !c.ativo)
            throw recusaRegra('cargo-inativo', 'O cargo foi inativado agora há pouco. Abra de novo.', [
              'cargo',
            ]);
        }
        await g.ligarCargo({ id: v.id, versao: e.versao, cargo: e.cargo, por: s.login });
        await g.incluirHistorico({
          vinculo: v.id,
          tipo: 'correcao',
          vigencia: hoje,
          antes: textoAntes,
          depois: textoDepois,
          motivo: e.motivo,
          por: s.login,
        });
        await g.registrarCorrecao({
          vinculo: v.id,
          operacao: 'colaborador.cargo_ligado',
          antes: { cargo: anterior, cargoQuadro: anterior === null ? null : rotulo(anterior, cargoAntes) },
          depois: { cargo: e.cargo, cargoQuadro: e.cargo === null ? null : rotulo(e.cargo, cargoNovo) },
          motivo: e.motivo,
          por: s.login,
        });
        return { id: v.id };
      },
    );
    return {
      id: v.id,
      mensagem:
        e.cargo === null
          ? 'Cargo do quadro retirado; o valor anterior ficou no histórico.'
          : 'Cargo do quadro ligado; o valor anterior ficou no histórico.',
    };
  }

  // ── Dependentes ─────────────────────────────────────────────────────────────────────────────────────────────

  async incluirDependente(s: SessaoCadastro, e: DependenteEntrada): Promise<ResultadoPessoas> {
    await this.apoio.exigirLiberacao(s);
    const cifra = this.exigirCifra();
    const v = await this.vinculoOu404(s, e.vinculo);
    if (!vinculoAtivo(v)) throw recusaRegra('desligado', 'O vínculo está desligado: não recebe dependente.');
    const hoje = await this.porta.hoje(s.porta);
    if (diasEntre(hoje, e.nascimento) > 0)
      throw recusaRegra('nascimento-futuro', 'A data de nascimento não pode ser futura.', ['nascimento']);
    const r = await this.apoio.sgh(
      s,
      E.pessoasDependenteIncluido.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      (x: { id: number }) => ({ tabela: 'SGH_PES_DEPENDENTE', id: String(x.id) }),
      async (g) => ({
        id: await g.incluirDependente({
          vinculo: v.id,
          nome: e.nome,
          nascimento: e.nascimento,
          parentesco: e.parentesco,
          cpfHmac: e.cpf ? cifra.hmac(e.cpf) : null,
          cpfCifrado: e.cpf ? cifra.cifrar(e.cpf) : null,
          dependenteIr: e.dependenteIr,
          dependenteSalarioFamilia: e.dependenteSalarioFamilia,
          por: s.login,
        }),
      }),
    );
    return { id: r.id, mensagem: 'Dependente incluído.' };
  }

  /** Fim do dependente (nunca apagado): a data não futura nem antes do nascimento, o motivo e quem registrou. */
  async encerrarDependente(s: SessaoCadastro, e: EncerrarDependenteEntrada): Promise<ResultadoPessoas> {
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoOu404(s, e.vinculo);
    const [hoje, deps] = await Promise.all([this.porta.hoje(s.porta), this.porta.dependentes(s.porta, v.id)]);
    const d = deps.find((x) => x.id === e.dependente);
    if (!d)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Dependente não encontrado',
        'O dependente não está em vigor neste vínculo (já encerrado ou de outro colaborador).',
      );
    if (diasEntre(hoje, e.ate) > 0)
      throw recusaRegra('fim-futuro', 'A data do fim não pode ser futura.', ['ate']);
    if (diasEntre(d.nascimento, e.ate) < 0)
      throw recusaRegra('fim-antes-do-nascimento', 'A data do fim vem antes do nascimento do dependente.', [
        'ate',
      ]);
    await this.apoio.sgh(
      s,
      E.pessoasDependenteEncerrado.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      { tabela: 'SGH_PES_DEPENDENTE', id: String(d.id) },
      async (g) => {
        await g.encerrarDependente({ vinculo: v.id, id: d.id, ate: e.ate, motivo: e.motivo, por: s.login });
        return { id: d.id };
      },
    );
    return { id: d.id, mensagem: 'Dependente encerrado.' };
  }

  /**
   * Alteração do dependente com versão (W0-06): a versão em vigor acaba na véspera de `desde` e a nova vale a partir
   * dele (a folha conta o IR e o salário-família pela data); o valor anterior vai à SGH_PES_CORRECAO sob o vínculo.
   * O CPF só sai mascarado na trilha.
   */
  async alterarDependente(s: SessaoCadastro, e: AlterarDependenteEntrada): Promise<ResultadoPessoas> {
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoOu404(s, e.vinculo);
    if (!vinculoAtivo(v))
      throw recusaRegra('desligado', 'O vínculo está desligado: o dependente não se altera.');
    const [hoje, deps] = await Promise.all([this.porta.hoje(s.porta), this.porta.dependentes(s.porta, v.id)]);
    const d = deps.find((x) => x.id === e.dependente);
    if (!d)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Dependente não encontrado',
        'O dependente não está em vigor neste vínculo (já encerrado, alterado ou de outro colaborador).',
      );
    const cifra = e.cpf ? this.exigirCifra() : null;
    const cpfAntes = mascararCpf(cpfDe(this.cifra, d.cpfCifrado));
    const novo = {
      nome: e.nome ?? d.nome,
      nascimento: e.nascimento ?? d.nascimento,
      parentesco: e.parentesco ?? d.parentesco,
      cpfHmac: e.cpf === undefined ? d.cpfHmac : e.cpf && cifra ? cifra.hmac(e.cpf) : null,
      cpfCifrado: e.cpf === undefined ? d.cpfCifrado : e.cpf && cifra ? cifra.cifrar(e.cpf) : null,
      dependenteIr: e.dependenteIr ?? d.dependenteIr,
      dependenteSalarioFamilia: e.dependenteSalarioFamilia ?? d.dependenteSalarioFamilia,
    };
    const antes: Record<string, unknown> = {
      nome: d.nome,
      nascimento: d.nascimento,
      parentesco: d.parentesco,
      cpf: cpfAntes,
      dependenteIr: d.dependenteIr,
      dependenteSalarioFamilia: d.dependenteSalarioFamilia,
    };
    const depois: Record<string, unknown> = {
      nome: novo.nome,
      nascimento: novo.nascimento,
      parentesco: novo.parentesco,
      cpf: e.cpf === undefined ? cpfAntes : e.cpf ? mascararCpf(e.cpf) : null,
      dependenteIr: novo.dependenteIr,
      dependenteSalarioFamilia: novo.dependenteSalarioFamilia,
    };
    const mudou = Object.keys(antes).filter(
      (k) => antes[k] !== depois[k] || (k === 'cpf' && e.cpf !== undefined && novo.cpfHmac !== d.cpfHmac),
    );
    if (mudou.length === 0)
      throw recusaRegra('nada-a-alterar', 'Os dados informados são iguais aos do dependente.', ['nome']);
    if (diasEntre(hoje, novo.nascimento) > 0)
      throw recusaRegra('nascimento-futuro', 'A data de nascimento não pode ser futura.', ['nascimento']);
    if (diasEntre(hoje, e.desde) > 0)
      throw recusaRegra('desde-futuro', 'A alteração vale a partir de hoje ou de uma data passada.', [
        'desde',
      ]);
    if (diasEntre(novo.nascimento, e.desde) < 0)
      throw recusaRegra('desde-antes-do-nascimento', 'A alteração não pode valer antes do nascimento.', [
        'desde',
      ]);
    if (d.desde && diasEntre(d.desde, e.desde) <= 0)
      throw recusaRegra(
        'desde-antes-da-versao',
        `A versão atual vale desde ${d.desde}: a alteração precisa valer depois dessa data.`,
        ['desde'],
      );
    const r = await this.apoio.sgh(
      s,
      E.pessoasDependenteAlterado.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      (x: { id: number }) => ({ tabela: 'SGH_PES_DEPENDENTE', id: String(x.id) }),
      async (g) => {
        const id = await g.versionarDependente({
          vinculo: v.id,
          anterior: d.id,
          desde: e.desde,
          motivo: e.motivo,
          ...novo,
          por: s.login,
        });
        await g.registrarCorrecao({
          vinculo: v.id,
          operacao: 'dependente.alterado',
          antes: { dependente: d.id, ...Object.fromEntries(mudou.map((k) => [k, antes[k]])) },
          depois: { dependente: id, desde: e.desde, ...Object.fromEntries(mudou.map((k) => [k, depois[k]])) },
          motivo: e.motivo,
          por: s.login,
        });
        return { id };
      },
    );
    return { id: r.id, mensagem: 'Dependente alterado; a versão anterior ficou guardada até a véspera.' };
  }

  // ── Desligamento (regra 2) ──────────────────────────────────────────────────────────────────────────────────

  async desligar(
    s: SessaoCadastro,
    e: DesligarColaboradorEntrada,
    reautenticadoEm: number,
    revogar: RevogarSessoes | null,
    conferirPainel: ConferirLoginPainel | null = null,
  ): Promise<ResultadoDesligamento> {
    await this.apoio.exigirLiberacao(s);
    this.exigirCifra();
    // Segregação (M10, regra 7): o perfil de auditoria só consulta, também no desligamento.
    const gestao = conferirGestao({ login: s.login, perfis: perfisDe(s) }, 'bloquear-usuario', null);
    if (gestao) throw recusaRegra(gestao, mensagemRecusaGestao(gestao, 'bloquear-usuario'));
    const v = await this.vinculoOu404(s, e.vinculo);
    const [hoje, tipos, outros, usuarios] = await Promise.all([
      this.porta.hoje(s.porta),
      this.porta.tiposRescisao(s.porta),
      this.porta.vinculosDaPessoa(s.porta, v.pessoa),
      this.usuariosDaPessoa(s, v, true),
    ]);
    if (!tipos.some((t) => t.codigo === e.tipoRescisao))
      throw recusaRegra('tipo-rescisao-inexistente', 'Escolha um tipo de rescisão da lista.', [
        'tipoRescisao',
      ]);
    const plano = planejarDesligamento({
      vinculo: { id: v.id, hospital: s.hospital, admissao: v.admissao, desligamento: v.desligamento },
      data: e.data,
      hoje,
      usuarios: usuarios.map((u) => ({ hospital: s.hospital, login: u.login, bloqueado: u.bloqueado })),
      outrosVinculosAtivos: outros
        .filter((o) => o.id !== v.id && o.desligamento === null)
        .map((o) => ({ id: o.id, hospital: s.hospital })),
      ator: s.login,
    });
    if (!plano.ok)
      throw recusaRegra(plano.recusa, plano.mensagem, plano.recusa === 'data-futura' ? ['data'] : undefined);
    // As travas da tela de usuários antes de bloquear qualquer um (nada é gravado se uma recusar): o login de painel.
    for (const u of plano.usuarios) {
      if (u.acao !== 'bloquear') continue;
      const lido = usuarios.find((x) => x.login === u.login);
      if (!lido || !ehGrupoDePainel(lido.grupo)) continue;
      if (!conferirPainel)
        throw new ErroProblema(
          'indisponivel',
          503,
          'Bloqueio recusado',
          'Não foi possível conferir agora se este login ainda é o de uma TV ou de um totem: tente de novo em instantes.',
          { codigo: CODIGO_CONFERENCIA_PAINEL_INDISPONIVEL },
        );
      await conferirPainel(s, u.login);
    }
    // Passo 1 (ficha, seção 5): o bloqueio pelo executor, um usuário por vez (cada um com a sua chave de idempotência).
    const base = String(s.req.headers['idempotency-key'] ?? '');
    const feitos = new Map<string, 'bloqueado' | 'jaBloqueado' | 'mantido'>();
    for (const u of plano.usuarios) {
      if (u.acao !== 'bloquear') {
        feitos.set(u.login, u.acao === 'jaBloqueado' ? 'jaBloqueado' : 'mantido');
        continue;
      }
      const id = usuarios.find((x) => x.login === u.login)?.id ?? 0;
      try {
        await this.apoio.executar(s, OPERACAO_BLOQUEIO, { login: u.login }, 'Usuário bloqueado.', {
          reautenticadoEm,
          idempotencyKey: chaveDoBloqueio(base, id),
        });
        feitos.set(u.login, 'bloqueado');
      } catch (x) {
        // Bloqueado por outra pessoa entre a releitura e agora: o lado SGH_ segue (cenário recusa-ja-bloqueado).
        if (x instanceof ErroProblema && x.extras.codigo === 'ja-bloqueado')
          feitos.set(u.login, 'jaBloqueado');
        else throw x;
      }
    }
    // Passos 2 e 3: o vínculo e o histórico, e o evento na outbox, numa transação SGH_ com a trilha.
    await this.apoio.sgh(
      s,
      E.pessoasColaboradorDesligado.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      { tabela: 'SGH_PES_VINCULO', id: String(v.id) },
      async (g) => {
        const atual = await g.vinculo(v.id);
        if (!atual || atual.desligamento !== null)
          throw recusaRegra('ja-desligado', 'Este vínculo já está desligado.');
        await g.desligarVinculo({
          id: v.id,
          versao: atual.versao,
          data: e.data,
          tipoRescisao: e.tipoRescisao,
          motivo: e.motivo,
          por: s.login,
        });
        await g.outbox({
          tipo: EVENTO_COLABORADOR_DESLIGADO,
          chave: `pessoas:desligamento:${s.hospital}:${v.id}`,
          carga: { vinculo: v.id, pessoa: v.pessoa, data: e.data, tipoRescisao: e.tipoRescisao },
        });
        return { id: v.id };
      },
    );
    // Depois do commit: as sessões dos usuários bloqueados no sistema novo caem.
    // A falha no armazém das sessões não desfaz o bloqueio (já gravado): o login volta em `sessoesPendentes`, a tela
    // avisa o RH e a trilha registra a pendência.
    let sessoesEncerradas = 0;
    const sessoesPendentes: string[] = [];
    for (const [login, acao] of feitos) {
      if (acao !== 'bloqueado') continue;
      try {
        if (!revogar) throw new Error('sem armazém de sessões');
        sessoesEncerradas += await revogar(s.rede, s.hospital, login);
      } catch {
        sessoesPendentes.push(login);
      }
    }
    if (sessoesPendentes.length > 0)
      await this.trilha
        .registrar({
          evento: E.pessoasColaboradorDesligado.codigo,
          rede: s.rede,
          hospital: s.hospital,
          usuario: s.login,
          estacao: estacaoDaRequisicao(s.req).slice(0, 80),
          correlacao: correlacaoDaRequisicao(s.req, 'sessoes-pendentes').slice(0, 64),
          recurso: `sessoes-pendentes:${sessoesPendentes.join(',')}`.slice(0, 80),
          resultado: 'falha',
        })
        .catch(() => undefined);
    return {
      vinculo: v.id,
      data: e.data,
      usuarios: plano.usuarios.map((u) => ({
        hospital: u.hospital,
        login: u.login,
        acao: feitos.get(u.login) ?? 'mantido',
        motivo: u.motivo,
      })),
      sessoesEncerradas,
      sessoesPendentes,
    };
  }

  // ── Validade do conselho (regra 3) ──────────────────────────────────────────────────────────────────────────

  async painelConselho(s: SessaoCadastro, f: FiltroHabilitacoesEntrada): Promise<PainelConselho> {
    const [hoje, janela, regs, retrato] = await Promise.all([
      this.porta.hoje(s.porta),
      this.janela(s),
      this.porta.registrosDosColaboradoresAtivos(s.porta),
      this.porta.ultimoRetrato(s.porta),
    ]);
    const hab = await this.porta.habilitacoes(
      s.porta,
      regs.map((r) => r.registro),
    );
    const alertas = alertasDeConselho(
      regs.map((r) => {
        const h = hab.get(r.registro);
        const vale = h && h.numero === r.numero && (h.conselho ?? null) === (r.conselho ?? null);
        return { ...r, validade: vale ? h.validade : null };
      }),
      hoje,
      janela,
    ).filter(
      (a) =>
        (f.situacao === 'todas' || a.situacao === f.situacao) &&
        (!f.conselho || (a.conselho ?? '').toUpperCase() === f.conselho.toUpperCase()),
    );
    // `depois` é a posição na lista ordenada pela urgência (a ordem não é a do ID).
    const inicio = f.depois ?? 0;
    const pagina = alertas.slice(inicio, inicio + f.limite);
    return {
      retrato: retrato
        ? {
            dia: retrato.dia,
            janelaDias: retrato.janelaDias,
            registros: retrato.registros,
            vencidos: retrato.vencidos,
            aVencer: retrato.aVencer,
            semValidade: retrato.semValidade,
          }
        : null,
      itens: pagina.map((a): AlertaConselho => ({
        vinculo: a.vinculo,
        profissional: a.profissional,
        nome: a.nome,
        registro: a.registro,
        conselho: a.conselho,
        validade: a.validade,
        situacao: a.situacao,
        diasParaVencer: a.diasParaVencer,
      })),
      depois: inicio + f.limite < alertas.length ? inicio + f.limite : null,
    };
  }

  async registrarHabilitacao(s: SessaoCadastro, e: RegistrarHabilitacaoEntrada): Promise<ResultadoPessoas> {
    await this.apoio.exigirLiberacao(s);
    const hoje = await this.porta.hoje(s.porta);
    if (diasEntre(hoje, e.conferidoEm) > 0)
      throw recusaRegra('conferencia-futura', 'A data da conferência não pode ser futura.', ['conferidoEm']);
    const reg = await this.porta.registroConselho(s.porta, e.registro);
    const ativos = await this.porta.registrosDosColaboradoresAtivos(s.porta);
    if (!reg || !ativos.some((a) => a.registro === e.registro))
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Registro não encontrado',
        'O registro não é de um colaborador ativo deste estabelecimento.',
      );
    const r = await this.apoio.sgh(
      s,
      E.pessoasHabilitacaoRegistrada.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      (x: { id: number }) => ({
        tabela: 'SGH_PES_HABILITACAO',
        id: String(x.id),
        chave: `TBCBOPRO:${e.registro}`,
      }),
      (g) =>
        g.gravarHabilitacao({
          registro: e.registro,
          numero: reg.numero,
          conselho: reg.conselho,
          validade: e.validade,
          conferidoEm: e.conferidoEm,
          observacao: e.observacao,
          por: s.login,
        }),
    );
    return { id: r.id, mensagem: 'Validade do registro conferida.' };
  }
}

function lotacao(
  v: VinculoPesLido,
  cc: Map<number, CentroCustoPessoas>,
  un: Map<number, string>,
): ColaboradorResumo['lotacao'] {
  return {
    centroCusto: v.centroCusto,
    centroCustoNome: cc.get(v.centroCusto)?.nome ?? null,
    unidade: v.unidade,
    unidadeNome: v.unidade !== null ? (un.get(v.unidade) ?? null) : null,
    setor: v.setor,
  };
}
