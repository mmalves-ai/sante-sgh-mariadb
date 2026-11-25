// Registros clínicos nos modelos do formulário (M22; ficha, seção 7) — `PEP > Registros clínicos (anamnese,
// evolução, escalas, rascunhos)` e `PEP > Administração do PEP` (consulta):
//   GET  /api/pep/registro/liberacao                                    a funcionalidade vale para esta sessão?
//   GET  /api/pep/registro/:paciente/modelos                            modelos com a situação (liberado, desligado…)
//   GET  /api/pep/registro/:paciente/formulario/:modelo?rascunho=        visão do formulário, pré-preenchimento,
//                                                                       rascunhos do paciente, atendimentos
//   GET  /api/pep/registro/:paciente/historico/:modelo/:vinculo          "copiar do último" (últimas 20 respostas)
//   POST /api/pep/registro/:paciente/rascunho                            pep.salvarRascunho (Idempotency-Key)
//   POST /api/pep/registro/:paciente/finalizar                           pep.registrarEvolucao (Idempotency-Key)
//   GET  /api/pep/rascunhos                                              meus rascunhos
//   POST /api/pep/rascunhos/:id/descartar                                pep.descartarRascunho
//   POST /api/pep/registro/:paciente/motivo                              motivo da leitura (o mesmo do M15)
//   GET  /api/pep/registro/:paciente/registros/:registro                 visualização (auditada) com a prova
//   POST /api/pep/registro/:paciente/registros/:registro/suspender       pep.suspenderEvolucao (crítica)
//   GET  /api/pep/admin/modelos[/:id] e /api/pep/admin/impressao         administração do PEP (consulta)
// Toda leitura de dado do paciente vai à trilha (@Auditar, nunca o conteúdo); a abertura do formulário registra o
// motivo "assistência" (o ato de registrar é assistência; D-MOT-M22). Leitura e gravação no paciente passam pelo
// mesmo controle do prontuário ao vivo (AcessoPacientePep): vínculo assistencial com a restrição do
// estabelecimento (quebra de vidro), a primeira leitura na trilha dupla e os alertas ao Auditor. Tudo depende da chave pep.evolucao.registro
// (POL-3; ficha, seção 12) e dos modelos liberados (parâmetro pep.evolucao.modelosLiberados).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  CHAVE_LIBERACAO_REGISTRO,
  chaveLeitura,
  definicaoParametro,
  esquemaConsultaBuscaPaciente,
  esquemaDescartarRascunho,
  esquemaPedidoMotivo,
  esquemaRegistrarEvolucao,
  esquemaSalvarRascunho,
  esquemaSuspenderEvolucao,
  type FormularioRegistro,
  type HistoricoPergunta,
  type LiberacaoProntuario,
  type ModeloAdmin,
  type ModeloAdminDetalhe,
  type ModeloImpressao,
  type ModeloRegistro,
  type MotivoAberto,
  type MotivoAcessoProntuario,
  PARAMETRO_MODELOS_LIBERADOS,
  type ParteProntuario,
  RECURSOS_M23,
  type RascunhoGravado,
  type RascunhoResumo,
  recursoDesligado,
  type RegistroGravado,
  type RegistrarEvolucaoEntrada,
  type RegistroVisualizado,
  type ResultadoBuscaPaciente,
  type ValorParametro,
} from '@sgh/contratos';
import { VinculoSintetico, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import { recursoLigado, resolverParametro, type SujeitoParametro, valorTipado } from '@sgh/dominio-config';
import type { GravacaoEvolucao, ProfissionalDoRegistro } from './tipos-pep.js';
import { categoriaDoCbo, podeVerConteudo, prazoDoParecer } from '@sgh/dominio-pep';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { ALERTA_AUDITOR, type AlertaAuditor } from '../acesso/alerta.js';
import {
  REGISTRO_EMERGENCIA,
  type RegistroEmergencia,
  VINCULO_ASSISTENCIAL,
} from '../acesso/emergencia.controller.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import {
  contextoOperacao,
  exigir,
  idDaRota,
  problemaDoCadastro,
  sessaoDe,
  type SessaoCadastro,
} from '../cadastro/comum.js';
import { PORTA_CADASTRO, type PortaCadastro } from '../cadastro/porta.js';
import { buscarPacientes } from '../cadastro/servico.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  TTL_CONFIG_NOVO_S,
} from '../config/public-api.js';
import { AcessoPacientePep, chaveSessaoPep } from './acesso-paciente.js';
import { PORTA_DOCUMENTOS, type PortaDocumentos } from './documentos-porta.js';
import { categoriaDe } from './documentos-servico.js';
import { LiberacaoPep } from './liberacao-pep.js';
import { ESTADO_PRONTUARIO } from './prontuario.controller.js';
import type { EstadoProntuario } from './sessao-prontuario.js';
import type { ServicoRegistro } from './registro-servico.js';

export const SERVICO_REGISTRO = Symbol('SERVICO_REGISTRO');

const MOTIVO_SEM_CONFIGURACAO =
  'A configuração das funcionalidades do estabelecimento não está disponível: o registro clínico fica desligado.';
const MOTIVO_DESLIGADO =
  'O registro clínico nos modelos do formulário ainda não foi liberado para este estabelecimento ou setor. A liberação é feita pelo administrador em Funcionalidades por estabelecimento.';
const MOTIVO_PREREQUISITO =
  'O registro clínico tem pré-requisito pendente neste estabelecimento: a conferência modelo a modelo pelos chave-usuários.';

const TOLERANCIA = 'pep.evolucao.toleranciaRetroativoMinutos';
const PARAMETRO_ASSINATURA = 'pep.prontuario.assinaturaExigida';

const chaveSessao = chaveSessaoPep;

function idadeDe(nascimento: string | null): number | null {
  if (!nascimento) return null;
  const n = new Date(`${nascimento.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(n.getTime())) return null;
  const h = new Date();
  let i = h.getUTCFullYear() - n.getUTCFullYear();
  if (
    h.getUTCMonth() < n.getUTCMonth() ||
    (h.getUTCMonth() === n.getUTCMonth() && h.getUTCDate() < n.getUTCDate())
  )
    i--;
  return i;
}

@Controller('pep')
export class RegistroClinicoController {
  constructor(
    @Inject(SERVICO_REGISTRO) private readonly servico: ServicoRegistro,
    @Inject(ESTADO_PRONTUARIO) private readonly estado: EstadoProntuario,
    @Inject(PORTA_CADASTRO) private readonly cadastro: PortaCadastro,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) private readonly cache: CacheConfig | null = null,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional()
    @Inject(VINCULO_ASSISTENCIAL)
    vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
    /** M23: a fila do parecer (resposta do mesmo paciente) e a categoria do leitor e do autor (sigilo). */
    @Optional()
    @Inject(PORTA_DOCUMENTOS)
    private readonly fluxos: Pick<PortaDocumentos, 'fluxo' | 'profissional' | 'ocupacaoDoCbo'> | null = null,
  ) {
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
    this.liberacaoPep = new LiberacaoPep(configuracao, cache);
  }

  private readonly liberacaoPep: LiberacaoPep;

  /**
   * M23 (regra 3): o preceptor indicado pelo residente é um médico com conselho ativo, outro que não quem registra
   * (422 com o motivo, sem gravar).
   */
  private async preceptorDe(
    s: SessaoCadastro,
    login: string,
  ): Promise<{ preceptor: string; idProfissional: number }> {
    const recusa = (detalhe: string) =>
      new ErroProblema('entrada-invalida', 422, 'Preceptor inválido', detalhe, {
        codigo: 'preceptor-invalido',
        campos: ['preceptor'],
      });
    if (login.toUpperCase() === s.login.toUpperCase())
      throw recusa('O preceptor é outro profissional, não quem registra.');
    if (!this.fluxos)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Cadastro indisponível',
        'Não foi possível conferir o preceptor.',
      );
    const p = await this.fluxos.profissional(s.porta, login.toUpperCase());
    const o = p ? (p.ocupacoes.find((x) => x.cbo === p.cbo) ?? p.ocupacoes[0]) : undefined;
    if (!p || categoriaDe(p) !== 'medico' || !o?.conselhoAtivo)
      throw recusa('O preceptor tem de ser um médico com conselho ativo no cadastro de profissionais.');
    return { preceptor: login.toUpperCase(), idProfissional: p.idProfissional };
  }

  /**
   * M23 (regra 15): o leitor vê o conteúdo do registro do autor (CBO)? Sigilo da psicologia: só a mesma categoria.
   * Sem a porta ou sem a ocupação de quem lê, nenhuma categoria (o conteúdo sigiloso fica oculto).
   */
  private async podeVerConteudoDe(s: SessaoCadastro, cbo: number): Promise<boolean> {
    if (!this.fluxos) return true;
    const c = s.porta;
    const [autor, leitor] = await Promise.all([
      this.fluxos.ocupacaoDoCbo(c, cbo).catch(() => null),
      this.fluxos.profissional(c, s.login).catch(() => null),
    ]);
    return podeVerConteudo(categoriaDoCbo(autor), categoriaDe(leitor));
  }

  /**
   * M23 (regra 10): o parecer que viaja com o registro exige a permissão do parecer (criar para o pedido, responder
   * para a resposta) e a chave da fila ligada; a resposta só vale para um parecer aberto DESTE paciente (senão 404,
   * sem revelar o de outro paciente). A gravação confere de novo o paciente dentro da transação.
   */
  private async exigirParecer(
    s: SessaoCadastro,
    paciente: number,
    p: NonNullable<RegistrarEvolucaoEntrada['parecer']>,
  ): Promise<void> {
    await exigir(
      s,
      p.tipo === 'resposta' ? 'pep.interconsulta.responder' : 'pep.interconsulta.criar',
      this.trilha,
    );
    await this.liberacaoPep.exigir(s, RECURSOS_M23.parecer);
    if (p.tipo !== 'resposta') return;
    if (!this.fluxos)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Fila do parecer indisponível',
        'Não foi possível conferir o parecer respondido.',
      );
    const f = await this.fluxos.fluxo(s.porta, p.parecer);
    if (!f || f.paciente !== paciente)
      throw new ErroProblema('nao-encontrado', 404, 'Parecer não encontrado');
    if (f.situacao !== 'solicitado' && f.situacao !== 'aceito')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Parecer encerrado',
        'O parecer já foi respondido ou cancelado.',
        { codigo: 'parecer-encerrado' },
      );
  }

  /** Vínculo assistencial, primeira leitura e alertas ao Auditor: o mesmo serviço do prontuário ao vivo (M15). */
  private readonly acesso: AcessoPacientePep;

  /**
   * Dado do paciente (leitura ou gravação): o vínculo assistencial pela restrição do estabelecimento (403
   * `sem-vinculo` com a quebra de vidro; a tentativa na trilha). Na leitura de conteúdo clínico, a primeira
   * leitura do paciente na sessão vai à trilha dupla e toda leitura conta para os alertas ao Auditor.
   */
  private async exigirAcesso(
    s: SessaoCadastro,
    paciente: number,
    permissao: string,
    leitura: { parte: ParteProntuario; motivo: MotivoAcessoProntuario } | null,
  ): Promise<void> {
    await this.acesso.exigirVinculo(s, paciente, permissao, 'pep.evolucao');
    if (leitura)
      await this.acesso.registrarLeitura(s, paciente, leitura.parte, leitura.motivo, 'pep.evolucao');
  }

  // ── Liberação e parâmetros ──────────────────────────────────────────────────────────────────────

  private async dadosLiberacao(s: SessaoCadastro) {
    const fonte = this.configuracao;
    if (!fonte) return null;
    const carregar = async () => ({
      chaves: await fonte.chaves(s.rede, s.hospital),
      prerequisitos: await fonte.prerequisitos(s.rede, s.hospital),
    });
    return this.cache
      ? this.cache.lerOuCarregar(
          this.cache.chave(s.rede, s.hospital, 'liberacao'),
          TTL_CONFIG_NOVO_S,
          carregar,
        )
      : carregar();
  }

  private async liberacao(s: SessaoCadastro): Promise<LiberacaoProntuario> {
    let dados: Awaited<ReturnType<RegistroClinicoController['dadosLiberacao']>>;
    try {
      dados = await this.dadosLiberacao(s);
    } catch {
      throw new ErroProblema(
        'indisponivel',
        503,
        'Configuração indisponível',
        'Não foi possível conferir a liberação do registro clínico.',
      );
    }
    if (!dados) return { ligada: false, motivo: MOTIVO_SEM_CONFIGURACAO };
    const chaves = dados.chaves
      .filter((c) => c.chave === CHAVE_LIBERACAO_REGISTRO && c.tipo === 'recurso' && c.ligada !== null)
      .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
    const declarados = recursoDesligado(CHAVE_LIBERACAO_REGISTRO)?.prerequisitos ?? [];
    const registrados = dados.prerequisitos.filter((p) => p.recurso === CHAVE_LIBERACAO_REGISTRO);
    const setor = s.req.sgh?.sessao.unidadeAtiva;
    const sujeito = {
      pessoa: s.login,
      ...(setor !== null && setor !== undefined ? { setor: String(setor) } : {}),
    };
    if (recursoLigado(chaves, declarados, registrados, sujeito, new Date()))
      return { ligada: true, motivo: null };
    const soPrerequisito = recursoLigado(chaves, [], [], sujeito, new Date());
    return { ligada: false, motivo: soPrerequisito ? MOTIVO_PREREQUISITO : MOTIVO_DESLIGADO };
  }

  private async exigirLiberacao(s: SessaoCadastro): Promise<void> {
    const l = await this.liberacao(s);
    if (!l.ligada)
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Registro clínico desligado',
        l.motivo ?? MOTIVO_DESLIGADO,
        {
          codigo: 'recurso-desligado',
        },
      );
  }

  private async parametros(s: SessaoCadastro): Promise<{
    liberados: Set<string>;
    toleranciaMin: number;
    assinatura: 'nenhuma' | 'eletronica' | 'digital_icp' | undefined;
  }> {
    let valores: ValorParametro[] = [];
    try {
      valores = this.configuracao ? await this.configuracao.valoresParametro(s.rede, s.hospital) : [];
    } catch {
      valores = [];
    }
    const setor = s.req.sgh?.sessao.unidadeAtiva;
    const sujeito: SujeitoParametro = {
      rede: s.rede,
      empresa: null,
      estabelecimento: s.hospital,
      unidade: setor === null || setor === undefined ? null : String(setor),
      perfis: [],
      usuario: s.login,
    };
    const ler = (chave: string) => {
      const def = definicaoParametro(chave);
      return def ? valorTipado(def, resolverParametro(def, valores, sujeito, new Date()).valor) : null;
    };
    const lista = ler(PARAMETRO_MODELOS_LIBERADOS);
    const tol = ler(TOLERANCIA);
    const ass = String(ler(PARAMETRO_ASSINATURA) ?? '');
    return {
      liberados: new Set(
        String(lista ?? '')
          .split(',')
          .map((x) => x.trim().toUpperCase())
          .filter(Boolean),
      ),
      toleranciaMin: typeof tol === 'number' && Number.isFinite(tol) ? tol : 15,
      // 03-PEP L91: a assinatura exigida do estabelecimento (o setor sobrepõe na gravação).
      assinatura: ass === 'nenhuma' || ass === 'eletronica' || ass === 'digital_icp' ? ass : undefined,
    };
  }

  private profissional(s: SessaoCadastro): Promise<ProfissionalDoRegistro | null> {
    return this.servico.profissional(s.porta, s.login);
  }

  /** Paciente deste estabelecimento (404 igual para inexistente e de outro banco), com idade e sexo das regras. */
  private async paciente(
    s: SessaoCadastro,
    paciente: number,
  ): Promise<{ idade: number | null; sexo: 'F' | 'M' | null }> {
    const [p] = await this.cadastro.lerPacientes(s.porta, [paciente]);
    if (!p) throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado');
    return { idade: idadeDe(p.nascimento), sexo: p.sexo };
  }

  // ── Rotas ───────────────────────────────────────────────────────────────────────────────────────

  @Get('registro/liberacao')
  @Permissao('pep.evolucao.ler')
  async liberacaoDaSessao(@Req() req: RequisicaoAutorizada): Promise<LiberacaoProntuario> {
    return this.liberacao(sessaoDe(req));
  }

  @Get('registro/pacientes')
  @Permissao('pep.evolucao.criar')
  @Auditar('cadastro.paciente.buscado')
  async pacientes(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoBuscaPaciente> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const c = esquemaConsultaBuscaPaciente.safeParse(q);
    if (!c.success)
      throw new ErroProblema('entrada-invalida', 400, 'Consulta inválida', 'Informe o termo da busca.');
    const r = await buscarPacientes(this.cadastro, s.porta, c.data).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    // Na trilha, só o tipo e a quantidade (nunca o termo).
    req.sghAlvo = {
      tabelaAlvo: 'paciente',
      chaveNaturalAlvo: `busca:${r.tipo};n:${r.itens.length};registro`,
    };
    return r;
  }

  @Get('registro/:paciente/modelos')
  @Permissao('pep.evolucao.criar')
  @Auditar('pep.formulario.aberto')
  async modelos(@Param('paciente') p: string, @Req() req: RequisicaoAutorizada): Promise<ModeloRegistro[]> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const paciente = idDaRota(p);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.evolucao.criar', null);
    const par = await this.parametros(s);
    const r = await this.servico.modelosParaRegistro(s.porta, await this.profissional(s), par.liberados);
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'modelo_documento_clinico',
      chaveNaturalAlvo: `parte:modelos;n:${r.length}`,
    };
    return r;
  }

  @Get('registro/:paciente/formulario/:modelo')
  @Permissao('pep.evolucao.criar')
  @Auditar('pep.formulario.aberto')
  async formulario(
    @Param('paciente') p: string,
    @Param('modelo') mo: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<FormularioRegistro> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const paciente = idDaRota(p);
    const modelo = idDaRota(mo);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.evolucao.criar', null);
    // O ato de registrar é assistência: o motivo da leitura do prontuário fica "assistência" na sessão.
    if (!this.estado.motivo(chaveSessao(s), paciente))
      this.estado.registrarMotivo(chaveSessao(s), paciente, 'assistencia');
    await this.acesso.registrarLeitura(
      s,
      paciente,
      'registro',
      this.estado.motivo(chaveSessao(s), paciente) ?? 'assistencia',
      'pep.evolucao',
    );
    const par = await this.parametros(s);
    const prof = await this.profissional(s);
    const gravacao = await this.servico.podeGravar(s.porta, 'pep.registrarEvolucao', s.login);
    const r = await this.servico.formulario(
      s.porta,
      paciente,
      modelo,
      prof,
      {
        liberados: par.liberados,
        toleranciaMin: par.toleranciaMin,
        login: s.login,
        ...(q['rascunho'] ? { rascunho: idDaRota(q['rascunho']) } : {}),
      },
      { pode: gravacao.pode, motivo: gravacao.motivo },
    );
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'modelo_documento_clinico',
      idAlvo: String(modelo),
      chaveNaturalAlvo: chaveLeitura(
        'registro',
        'assistencia',
        `rascunhos:${r.rascunhos.length};preenchidos:${r.preenchidos.length}`,
      ),
    };
    return r;
  }

  @Get('registro/:paciente/historico/:modelo/:vinculo')
  @Permissao('pep.evolucao.criar')
  @Auditar('pep.historico.lido')
  async historico(
    @Param('paciente') p: string,
    @Param('modelo') mo: string,
    @Param('vinculo') v: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<HistoricoPergunta> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const paciente = idDaRota(p);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.evolucao.criar', {
      parte: 'respostas',
      motivo: this.estado.motivo(chaveSessao(s), paciente) ?? 'assistencia',
    });
    const r = await this.servico.historico(s.porta, paciente, idDaRota(mo), idDaRota(v));
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'registro_assistencial_resposta',
      chaveNaturalAlvo: `parte:historico;n:${r.valores.length}`,
    };
    return r;
  }

  @Post('registro/:paciente/rascunho')
  @HttpCode(200)
  @Permissao('pep.evolucao.criar')
  @AuditadoNoHandler('pep.salvarRascunho: SGH_TRILHA e SGH_IDEMPOTENCIA na mesma transação (executor)')
  async salvarRascunho(
    @Param('paciente') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RascunhoGravado> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const paciente = idDaRota(p);
    const e = esquemaSalvarRascunho.safeParse({ ...(corpo as object), paciente });
    if (!e.success) throw entradaInvalida(e.error.issues);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.evolucao.criar', null);
    const par = await this.parametros(s);
    const gravacao = await this.servico.montarRascunho(
      s.porta,
      e.data,
      await this.profissional(s),
      par.liberados,
    );
    try {
      const r = await this.servico.salvarRascunho(s.porta, gravacao, contextoOperacao(s, 'rascunho'));
      return { rascunho: r.rascunho, versao: r.versao };
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }

  @Post('registro/:paciente/finalizar')
  @HttpCode(201)
  @Permissao('pep.evolucao.criar')
  @AuditadoNoHandler(
    'pep.registrarEvolucao: trilha dupla, SGH_ da prova e SGH_IDEMPOTENCIA na mesma transação (executor)',
  )
  async finalizar(
    @Param('paciente') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RegistroGravado> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const paciente = idDaRota(p);
    const e = esquemaRegistrarEvolucao.safeParse({ ...(corpo as object), paciente });
    if (!e.success) throw entradaInvalida(e.error.issues);
    const par = await this.parametros(s);
    const pac = await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.evolucao.criar', null);
    if (e.data.parecer) await this.exigirParecer(s, paciente, e.data.parecer);
    const supervisao = e.data.preceptor ? await this.preceptorDe(s, e.data.preceptor) : null;
    const m = await this.servico.montarEvolucao(s.porta, e.data, await this.profissional(s), {
      liberados: par.liberados,
      toleranciaMin: par.toleranciaMin,
      paciente: pac,
      // ADR 0021 (R1): registrado numa sessão "como", a marca do suporte técnico vai à prova do documento.
      comoSuporte: req.sghComo !== undefined,
      // M23 (regra 10): pedido de parecer (entra na fila) ou resposta (encerra o parecer da fila).
      ...(e.data.parecer ? { fluxo: fluxoDoParecer(e.data.parecer) } : {}),
      // M23 (regra 3): o pedido de coassinatura do preceptor, na mesma transação.
      ...(supervisao ? { supervisao } : {}),
    });
    try {
      const r = await this.servico.registrar(
        s.porta,
        { ...m.gravacao, ...(par.assinatura ? { assinaturaEstabelecimento: par.assinatura } : {}) },
        contextoOperacao(s, 'evolucao'),
      );
      return { registro: r.registro, hash: m.gravacao.hashConteudo, avisos: m.avisos };
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }

  @Get('rascunhos')
  @Permissao('pep.evolucao.criar')
  @Auditar('pep.formulario.aberto')
  async rascunhos(@Req() req: RequisicaoAutorizada): Promise<RascunhoResumo[]> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const r = await this.servico.rascunhos(s.porta, await this.profissional(s));
    req.sghAlvo = {
      tabelaAlvo: 'registro_assistencial_rascunho',
      chaveNaturalAlvo: `parte:rascunhos;n:${r.length}`,
    };
    return r;
  }

  @Post('rascunhos/:id/descartar')
  @HttpCode(200)
  @Permissao('pep.evolucao.criar')
  @AuditadoNoHandler('pep.descartarRascunho: SGH_TRILHA e SGH_IDEMPOTENCIA na mesma transação (executor)')
  async descartar(
    @Param('id') i: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true }> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const e = esquemaDescartarRascunho.safeParse({ ...(corpo as object), rascunho: idDaRota(i) });
    if (!e.success) throw entradaInvalida(e.error.issues);
    const prof = await this.profissional(s);
    if (!prof) throw new ErroProblema('sem-permissao', 403, 'Sem ocupação no cadastro de profissionais');
    // O CBO do rascunho (um dos do profissional), e só o rascunho criado pelo novo.
    const cbo = await this.servico.cboParaDescartar(s.porta, e.data.rascunho, prof);
    try {
      await this.servico.descartar(s.porta, { ...e.data, cbo }, contextoOperacao(s, 'descarte'));
    } catch (x) {
      throw problemaDoCadastro(x);
    }
    return { ok: true };
  }

  @Post('registro/:paciente/motivo')
  @HttpCode(200)
  @Permissao('pep.evolucao.ler')
  @Auditar('pep.motivo.informado')
  async motivo(
    @Param('paciente') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<MotivoAberto> {
    const s = sessaoDe(req);
    const paciente = idDaRota(p);
    const m = esquemaPedidoMotivo.safeParse(corpo ?? {});
    if (!m.success)
      throw new ErroProblema('motivo-necessario', 422, 'Motivo inválido', 'Escolha um motivo da lista.', {
        codigo: 'motivo-necessario',
        campos: ['motivo'],
      });
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.evolucao.ler', null);
    this.estado.registrarMotivo(chaveSessao(s), paciente, m.data.motivo);
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'paciente',
      idAlvo: String(paciente),
      chaveNaturalAlvo: chaveLeitura('registro', m.data.motivo, 'motivo-informado'),
    };
    return {
      paciente,
      motivo: m.data.motivo,
      restricaoAtendimento: req.sgh?.sessao.restricaoVinculo === true,
    };
  }

  @Get('registro/:paciente/registros/:registro')
  @Permissao('pep.evolucao.ler')
  @Auditar('pep.evolucao.visualizada')
  async visualizar(
    @Param('paciente') p: string,
    @Param('registro') x: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RegistroVisualizado> {
    const s = sessaoDe(req);
    const paciente = idDaRota(p);
    const registro = idDaRota(x);
    const motivo = this.estado.motivo(chaveSessao(s), paciente);
    if (!motivo)
      throw new ErroProblema(
        'motivo-necessario',
        422,
        'Informe o motivo do acesso ao prontuário',
        'A primeira abertura do prontuário deste paciente na sessão pede o motivo (lista fechada).',
        { codigo: 'motivo-necessario' },
      );
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.evolucao.ler', { parte: 'registro', motivo });
    const r = await this.servico.visualizar(
      s.porta,
      paciente,
      registro,
      await this.profissional(s),
      s.pode('pep.evolucao.suspender'),
      s.pode('pep.evolucao.criar'),
      (cbo) => this.podeVerConteudoDe(s, cbo),
    );
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'registro_assistencial',
      idAlvo: String(registro),
      chaveNaturalAlvo: chaveLeitura('registro', motivo),
    };
    return r;
  }

  @Post('registro/:paciente/registros/:registro/suspender')
  @HttpCode(200)
  @Permissao('pep.evolucao.suspender')
  @AuditadoNoHandler(
    'pep.suspenderEvolucao: trilha dupla, SGH_PEP_DOC_EVENTO e SGH_IDEMPOTENCIA na mesma transação (executor)',
  )
  async suspender(
    @Param('paciente') p: string,
    @Param('registro') x: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true }> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const paciente = idDaRota(p);
    const e = esquemaSuspenderEvolucao.safeParse({ ...(corpo as object), registro: idDaRota(x) });
    if (!e.success) throw entradaInvalida(e.error.issues);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.evolucao.suspender', null);
    const reautenticadoEm =
      this.servico.destino === 'memoria' && !req.sgh?.real
        ? Date.now()
        : await reautenticar(this.sessoes, this.resolvedor, req, e.data.senha);
    const gravacao = await this.servico.montarSuspensao(
      s.porta,
      paciente,
      e.data.registro,
      e.data.justificativa,
      await this.profissional(s),
      req.sghComo !== undefined,
    );
    try {
      await this.servico.suspender(s.porta, gravacao, {
        ...contextoOperacao(s, 'suspensao'),
        reautenticadoEm,
      });
    } catch (x) {
      throw problemaDoCadastro(x);
    }
    return { ok: true };
  }

  // ── Administração do PEP (consulta; sem dado de paciente) ─────────────────────────────────────────

  @Get('admin/modelos')
  @Permissao('pep.admin.ler')
  @Auditar('pep.admin.consultado')
  async modelosAdmin(@Req() req: RequisicaoAutorizada): Promise<ModeloAdmin[]> {
    const s = sessaoDe(req);
    const r = await this.servico.modelosAdmin(s.porta);
    req.sghAlvo = { tabelaAlvo: 'modelo_documento_clinico', chaveNaturalAlvo: `parte:modelos;n:${r.length}` };
    return r;
  }

  @Get('admin/modelos/:id')
  @Permissao('pep.admin.ler')
  @Auditar('pep.admin.consultado')
  async modeloAdmin(@Param('id') i: string, @Req() req: RequisicaoAutorizada): Promise<ModeloAdminDetalhe> {
    const s = sessaoDe(req);
    const id = idDaRota(i);
    const r = await this.servico.modeloAdmin(s.porta, id);
    req.sghAlvo = {
      tabelaAlvo: 'modelo_documento_clinico',
      idAlvo: String(id),
      chaveNaturalAlvo: 'parte:modelo',
    };
    return r;
  }

  @Get('admin/impressao')
  @Permissao('pep.admin.ler')
  @Auditar('pep.admin.consultado')
  async impressao(
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ fichas: ModeloImpressao[]; relatorios: ModeloImpressao[] }> {
    const s = sessaoDe(req);
    const r = await this.servico.impressao(s.porta);
    req.sghAlvo = {
      tabelaAlvo: 'modelo_impressao_clinica',
      chaveNaturalAlvo: `parte:impressao;n:${r.fichas.length}`,
    };
    return r;
  }
}

/** O fluxo do parecer que viaja com o registro: o prazo pela prioridade (ou as horas pedidas). */
function fluxoDoParecer(
  p: NonNullable<RegistrarEvolucaoEntrada['parecer']>,
): NonNullable<GravacaoEvolucao['fluxo']> {
  if (p.tipo === 'resposta') return { tipo: 'resposta', parecer: p.parecer };
  return {
    tipo: 'pedido',
    especialidade: p.especialidade ?? null,
    categoria: p.categoria ?? null,
    prioridade: p.prioridade,
    prazo: prazoDoParecer(new Date(), p.prioridade, p.prazoHoras).toISOString(),
  };
}

function entradaInvalida(issues: readonly { path: readonly PropertyKey[]; message: string }[]): ErroProblema {
  const campos = [...new Set(issues.map((i) => i.path.map(String).join('.') || '(entrada)'))].slice(0, 20);
  return new ErroProblema(
    'entrada-invalida',
    400,
    'Dados inválidos',
    issues
      .slice(0, 3)
      .map((i) => i.message)
      .join(' '),
    { codigo: 'entrada-invalida', campos },
  );
}
