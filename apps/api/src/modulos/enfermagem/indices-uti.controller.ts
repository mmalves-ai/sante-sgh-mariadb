// Índices de gravidade da UTI (M45, etapa 2; ficha, seções 4, 5, 7 e 8, regra 5):
//   GET  /api/pep/uti/unidades                       as unidades de internação (a escolha da UTI)
//   GET  /api/pep/uti/pacientes?unidade              os internados da unidade com o último APACHE II e SOFA (auditada)
//   GET  /api/pep/uti/indices/:atendimento           os índices do paciente, a configuração do estabelecimento (cache)
//                                                    e o que a sessão pode fazer (leitura auditada)
//   POST /api/pep/uti/indices                        pep.registrarIndiceUti (a pontuação recalculada no servidor)
//   POST /api/pep/uti/indices/:id/validar            pep.validarIndiceUti (só o médico com conselho ativo; senha)
//   GET  /api/pep/uti/smr?de&ate                     a razão de mortalidade padronizada com as parcelas (auditada)
// Só do novo (SGH_), com a SGH_TRILHA na mesma transação; a liberação é a `enfermagem.escores` (POL-3).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type CalculoIndiceUti,
  type ConfiguracaoIndicesUti,
  esquemaRegistrarIndiceUti,
  esquemaValidarIndiceUti,
  EVENTOS_AUDITAVEIS,
  grupoMotivoAlta,
  type IndicesDoPaciente,
  type IndiceUtiLido,
  PERMISSOES_ESCORES as P,
  type PontoVariavel,
  type SmrDoPeriodo,
  type TipoAdmissaoUti,
} from '@sgh/contratos';
import { calcularApache2, calcularSmr, calcularSofa, comImpressao } from '@sgh/dominio-pep';
import type { IndiceUtiLidoSgh } from '@sgh/legado';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  TTL_CONFIG_NOVO_S,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { ApoioEscores } from './escores.controller.js';
import { PORTA_ESCORES, type PortaEscores } from './escores-porta.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';

const UNIDADE = /^[A-Za-z0-9 ._-]{1,5}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
/** Até 13 meses de SMR por consulta (o relatório anual da RDC 7/2010 cabe). */
const DIAS_SMR = 400;

export const MOTIVO_SAPS3 =
  'SAPS 3 e a exportação ao parceiro externo de indicadores de UTI aguardam a decisão da coordenação da UTI (DP-20): até lá, APACHE II e SOFA são calculados aqui e o parceiro externo continua recebendo pelo caminho atual.';

/** Os vínculos de médico (CBO 225) com o conselho ativo validam (regra 5: só o médico valida). */
export const ehMedico = (cbo: string | null | undefined) => (cbo ?? '').replace(/\D/g, '').startsWith('225');

@Controller('pep/uti')
export class IndicesUtiController {
  private readonly a: ApoioEscores;

  constructor(
    @Inject(PORTA_ESCORES) private readonly porta: PortaEscores,
    @Inject(PORTA_ENFERMAGEM) private readonly enfermagem: PortaEnfermagem,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) private readonly cache: CacheConfig | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
  ) {
    this.a = new ApoioEscores(porta, enfermagem, trilha, configuracao, cache);
  }

  /** A configuração do estabelecimento (cache de 5 minutos no Valkey; consulta simples pela chave primária). */
  private async configuracao(s: SessaoCadastro): Promise<ConfiguracaoIndicesUti> {
    const carregar = async () => comImpressao(await this.porta.configuracaoIndices(s.porta));
    return this.cache
      ? this.cache.lerOuCarregar(
          this.cache.chave(s.rede, s.hospital, 'indices-uti'),
          TTL_CONFIG_NOVO_S,
          carregar,
        )
      : carregar();
  }

  private lido(x: IndiceUtiLidoSgh, impressao: string): IndiceUtiLido {
    const v = (x.variaveis ?? {}) as { parcelas?: PontoVariavel[] };
    return {
      id: x.id,
      paciente: x.paciente,
      reg: x.reg,
      indice: x.indice,
      pontuacao: x.pontuacao,
      mortalidade: x.mortalidade,
      categoria: x.categoria,
      tipoAdmissao: (x.tipoAdmissao as TipoAdmissaoUti | null) ?? null,
      parcelas: Array.isArray(v.parcelas) ? v.parcelas : [],
      coletadoEm: x.coletadoEm,
      registradoPor: x.registradoPor,
      situacao: x.situacao,
      validadoPor: x.validadoPor,
      validadoEm: x.validadoEm,
      configuracaoMudou: x.impressaoConfig !== impressao,
      estorno: x.estorno ?? null,
    };
  }

  private async podeValidar(
    s: SessaoCadastro,
  ): Promise<{ pode: boolean; motivo: string | null; vinculo: number | null }> {
    if (!s.pode(P.indiceUtiValidar))
      return { pode: false, motivo: 'Seu perfil não valida índices de gravidade.', vinculo: null };
    const v = await this.porta.vinculo(s.porta, s.login).catch(() => null);
    if (!v || !ehMedico(v.codigoCbo))
      return { pode: false, motivo: 'A validação do índice de gravidade é do médico.', vinculo: null };
    if (!v.conselhoAtivo)
      return {
        pode: false,
        motivo: 'O conselho profissional não está ativo no cadastro de profissionais.',
        vinculo: null,
      };
    return { pode: true, motivo: null, vinculo: v.vinculo };
  }

  @Get('unidades')
  @Permissao(P.indiceUtiLer)
  unidades(@Req() req: RequisicaoAutorizada) {
    return this.enfermagem.unidades(sessaoDe(req).porta);
  }

  @Get('pacientes')
  @Permissao(P.indiceUtiLer)
  @Auditar(EVENTOS_AUDITAVEIS.indicesUtiLidos.codigo)
  async pacientes(@Query('unidade') u: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const unidade = (u ?? '').trim();
    if (!UNIDADE.test(unidade))
      throw new ErroProblema('entrada-invalida', 400, 'Unidade inválida', 'Escolha a unidade.');
    const internados = await this.enfermagem.internados(s.porta, unidade);
    const r = [];
    for (const i of internados) {
      const xs = await this.porta.indicesDoPaciente(s.porta, i.paciente);
      const ultimo = (ind: 'apache2' | 'sofa') => {
        const x = xs.find((y) => y.indice === ind && y.reg === i.numero);
        return x
          ? {
              id: x.id,
              pontuacao: x.pontuacao,
              mortalidade: x.mortalidade,
              situacao: x.situacao,
              coletadoEm: x.coletadoEm,
            }
          : null;
      };
      r.push({
        paciente: i.paciente,
        atendimento: i.atendimento,
        reg: i.numero,
        nome: i.nome,
        leito: i.leito,
        apache2: ultimo('apache2'),
        sofa: ultimo('sofa'),
      });
    }
    req.sghAlvo = { tabelaAlvo: 'SGH_PEP_INDICE_UTI', chaveNaturalAlvo: `unidade:${unidade};n:${r.length}` };
    return { unidade, pacientes: r };
  }

  @Get('indices/:atendimento')
  @Permissao(P.indiceUtiLer)
  @Auditar(EVENTOS_AUDITAVEIS.indicesUtiLidos.codigo)
  async indices(
    @Param('atendimento') atendimento: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<
    IndicesDoPaciente & { nome: string; leito: string; reg: number; atendimento: number; unidade: string }
  > {
    const s = sessaoDe(req);
    const i = await this.enfermagem.internado(s.porta, idDaRota(atendimento));
    if (!i) throw new ErroProblema('nao-encontrado', 404, 'Paciente não internado');
    const [cfg, xs, l, v] = await Promise.all([
      this.configuracao(s),
      this.porta.indicesDoPaciente(s.porta, i.paciente),
      this.a.apoio.liberacao(s),
      this.podeValidar(s),
    ]);
    req.sghAlvo = { paciente: i.paciente, tabelaAlvo: 'SGH_PEP_INDICE_UTI' };
    return {
      paciente: i.paciente,
      nome: i.nome,
      leito: i.leito,
      reg: i.numero,
      atendimento: i.atendimento,
      unidade: i.unidade,
      indices: xs.map((x) => this.lido(x, cfg.impressao)),
      configuracao: cfg,
      gravacao: {
        ligada: l.ligada,
        motivo: l.motivo,
        registrar: l.ligada && s.pode(P.indiceUtiRegistrar),
        validar: l.ligada && v.pode,
        motivoValidar: l.ligada ? v.motivo : l.motivo,
      },
      saps3: { disponivel: false, motivo: MOTIVO_SAPS3 },
    };
  }

  @Post('indices')
  @HttpCode(201)
  @Permissao(P.indiceUtiRegistrar)
  @AuditadoNoHandler('pep.registrarIndiceUti: SGH_PEP_INDICE_UTI e SGH_TRILHA na mesma transação')
  async registrar(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<CalculoIndiceUti & { id: number; mensagem: string }> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarIndiceUti, b);
    const i = await this.a.internado(s, e.atendimento, e.paciente);
    const agora = (await this.enfermagem.relogio(s.porta)).slice(0, 16);
    if (e.coletadoEm.slice(0, 16) > agora)
      throw new ErroProblema('entrada-invalida', 422, 'Índice', 'A hora da coleta é do futuro.', {
        campos: ['coletadoEm'],
      });
    const cfg = await this.configuracao(s);
    const calc =
      e.indice === 'apache2'
        ? calcularApache2(cfg, { variaveis: e.variaveis, glasgow: e.glasgow, ...e.apache! })
        : calcularSofa(cfg, { variaveis: e.variaveis, glasgow: e.glasgow });
    if (!calc.ok)
      throw new ErroProblema('entrada-invalida', 422, 'Índice', calc.mensagem, { codigo: calc.codigo });
    const id = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.indiceUtiRegistrado.codigo,
      P.indiceUtiRegistrar,
      (x: number) => ({
        tabela: 'SGH_PEP_INDICE_UTI',
        id: String(x),
        paciente: i.paciente,
        chave: `${e.indice}:${calc.pontuacao}`,
      }),
      (g) =>
        g.registrarIndice({
          paciente: i.paciente,
          reg: i.numero,
          atendimento: i.atendimento,
          unidade: i.unidade,
          indice: e.indice,
          variaveis: {
            entrada: { variaveis: e.variaveis, glasgow: e.glasgow, apache: e.apache ?? null },
            parcelas: calc.parcelas,
            equacao: calc.equacao,
            avisos: calc.avisos,
          },
          pontuacao: calc.pontuacao,
          categoria: e.indice === 'apache2' ? e.apache!.categoria : null,
          tipoAdmissao: e.indice === 'apache2' ? e.apache!.tipoAdmissao : null,
          mortalidade: calc.mortalidade,
          impressaoConfig: cfg.impressao,
          coletadoEm: e.coletadoEm.slice(0, 16),
          usuario: s.login,
        }),
    );
    return {
      indice: calc.indice,
      pontuacao: calc.pontuacao,
      parcelas: calc.parcelas,
      mortalidade: calc.mortalidade,
      equacao: calc.equacao,
      avisos: calc.avisos,
      id,
      mensagem:
        e.indice === 'apache2'
          ? `APACHE II ${calc.pontuacao} registrado (mortalidade esperada ${(100 * (calc.mortalidade ?? 0)).toFixed(1).replace('.', ',')}%): aguarda a validação médica.`
          : `SOFA ${calc.pontuacao} registrado: aguarda a validação médica.`,
    };
  }

  /** W0-03: estornar ou invalidar o índice, com o motivo (fica inativo e visível; fora da SMR). */
  @Post('indices/:id/estornar')
  @HttpCode(200)
  @Permissao(P.indiceUtiRegistrar)
  @AuditadoNoHandler('o estorno em SGH_PEP_ESTORNO_REGISTRO com a SGH_TRILHA na mesma transação')
  estornar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.a.estornar(sessaoDe(req), 'indiceUti', idDaRota(id), b, P.indiceUtiRegistrar);
  }

  @Post('indices/:id/validar')
  @HttpCode(200)
  @Permissao(P.indiceUtiValidar)
  @AuditadoNoHandler('pep.validarIndiceUti: SGH_PEP_INDICE_UTI e SGH_TRILHA na mesma transação')
  async validar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number; mensagem: string }> {
    const s = sessaoDe(req);
    const e = corpo(esquemaValidarIndiceUti, b);
    const iid = idDaRota(id);
    const v = await this.podeValidar(s);
    if (!v.pode || v.vinculo === null)
      throw new ErroProblema('sem-permissao', 403, 'Sem permissão', v.motivo ?? 'A validação é do médico.', {
        codigo: 'so-medico-valida',
      });
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário.',
      );
    await reautenticar(this.sessoes, this.resolvedor, req, e.senha);
    const agora = await this.enfermagem.relogio(s.porta);
    await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.indiceUtiValidado.codigo,
      P.indiceUtiValidar,
      (x: { paciente: number }) => ({
        tabela: 'SGH_PEP_INDICE_UTI',
        id: String(iid),
        paciente: x.paciente,
        chave: 'validado',
      }),
      (g) =>
        g.validarIndice({ id: iid, validadoPor: s.login, vinculo: v.vinculo!, quando: agora.slice(0, 19) }),
    );
    return { id: iid, mensagem: 'Índice validado pelo médico.' };
  }

  @Get('smr')
  @Permissao(P.indiceUtiLer)
  @Auditar(EVENTOS_AUDITAVEIS.indicesUtiLidos.codigo)
  async smr(
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<SmrDoPeriodo> {
    const s = sessaoDe(req);
    if (!DATA.test(de ?? '') || !DATA.test(ate ?? '') || de! > ate!)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Período inválido',
        'Informe o início e o fim do período.',
      );
    const dias = (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000;
    if (dias > DIAS_SMR)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Período longo demais',
        'Consulte até 13 meses por vez.',
      );
    const xs = await this.porta.apachesDoPeriodo(s.porta, de!, ate!);
    const internacoes = await this.porta.internacoes(
      s.porta,
      xs.map((x) => x.reg).filter((r): r is number => r !== null),
    );
    const desfecho = (reg: number | null): boolean | null => {
      const i = reg === null ? undefined : internacoes.find((y) => y.reg === reg);
      if (!i || i.alta === null) return null;
      return i.motivoAlta !== null && grupoMotivoAlta(i.motivoAlta) === 'obito';
    };
    const r = calcularSmr(
      xs
        .filter((x) => x.mortalidade !== null)
        .map((x) => ({
          id: x.id,
          reg: x.reg,
          mortalidade: x.mortalidade!,
          obito: desfecho(x.reg),
          coletadoEm: x.coletadoEm,
        })),
    );
    req.sghAlvo = { tabelaAlvo: 'SGH_PEP_INDICE_UTI', chaveNaturalAlvo: `smr:${de}:${ate};n:${r.indices}` };
    return { de: de!, ate: ate!, ...r };
  }
}
