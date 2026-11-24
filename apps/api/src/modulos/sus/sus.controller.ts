// Faturamento SUS próprio, etapas 1 a 3 (M51; ficha, seções 5, 7, 8 e 12) — `Faturamento > Faturamento SUS`:
//   GET  /api/sus/competencias?instrumento                 as competências (e os instrumentos liberados)
//   POST /api/sus/competencias                             abrir (faturamento.abrirCompetenciaSus)
//   POST /api/sus/competencias/critica                     rodar a crítica (faturamento.criticarSus)
//   POST /api/sus/competencias/fechamento                  fechar (supervisor; faturamento.fecharCompetenciaSus)
//   POST /api/sus/competencias/reabertura                  reabrir com justificativa (supervisor)
//   GET  /api/sus/criticas?instrumento&competencia&…       a página das críticas (escopo por convênio; auditada)
//   POST /api/sus/criticas/justificativa                   justificar um aviso
//   POST /api/sus/ciha/arquivo                             gerar o arquivo CIHA (faturamento.gerarCiha)
//   GET  /api/sus/arquivos?instrumento&competencia         os arquivos gerados (metadados e hash; auditada)
//   GET  /api/sus/arquivos/:id/conteudo                    baixar o arquivo (auditado; conferido pelo hash)
//   GET  /api/sus/equivalencias?termo&procedimento&…       a página das equivalências SIGTAP do hospital (com os nomes)
//   POST /api/sus/equivalencias                            registrar (ou trocar, com a versão) a equivalência
//   POST /api/sus/equivalencias/desativacao                desativar a equivalência (com a versão; nada é apagado)
//   GET  /api/sus/sigtap?termo&competencia                 busca na SIGTAP (código ou nome; a vigência na competência)
//   GET  /api/sus/procedimentos-hospital?termo | ?ids      busca no cadastro de procedimentos do hospital
// Etapa 2 (BPA e solicitantes; o BPA desligado por estabelecimento até haver contrato SUS, DP-35):
//   POST /api/sus/bpa/arquivo                              gerar o BPA-C e o BPA-I (faturamento.gerarBpa)
//   GET  /api/sus/bpa/linhas?arquivo&tipo&procedimento     as linhas do arquivo (sem dado pessoal; auditada)
//   GET  /api/sus/bpa/arquivos/:id/conteudo                baixar o BPA (auditado; conferido pelo hash)
//   GET  /api/sus/solicitantes/cadastro-geral?termo        busca no cadastro geral de médicos solicitantes
//   GET  /api/sus/parametros-ambulatoriais                        os parâmetros do faturamento ambulatorial (consulta)
// Etapa 3 (APAC; desligada por estabelecimento até haver contrato SUS, DP-35):
//   GET  /api/sus/apac?situacao&numero&prontuario&…        as APACs (o paciente pelo prontuário; auditada)
//   GET  /api/sus/apac/atendimento/:registro               o atendimento do laudo conferido (sem documento)
//   GET  /api/sus/apac/dominios                            os domínios do laudo de nefrologia (consulta)
//   GET  /api/sus/apac/solicitantes?termo                  os médicos solicitantes SUS para o laudo
//   POST /api/sus/apac                                     laudo, autorizar, negar, continuar, encerrar, cancelar
//   POST /api/sus/apac/arquivo                             gerar o APAC-Mag da competência (faturamento.gerarApac)
//   GET  /api/sus/apac/linhas?arquivo                      as linhas de procedimento do arquivo (sem dado pessoal)
//   GET  /api/sus/apac/arquivos/:id/conteudo               baixar o APAC-Mag (auditado; conferido pelo hash)
// A permissão é conferida aqui (catálogo do M06) e de novo no serviço (liberação do instrumento, escopo e versão).
// A CIHA é gerada e mostrada sempre (regra 8: "até lá, o novo só gera e mostra"); a chave `faturamento.susCiha` diz se
// o arquivo daqui já é a fonte do envio. BPA, APAC e AIH ficam desligados por estabelecimento (DP-35).
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type ApacLida,
  type AtendimentoLaudoApac,
  type DominiosApac,
  esquemaFiltroApacs,
  esquemaFiltroLinhasApac,
  esquemaGerarApac,
  esquemaRegistrarApac,
  type PaginaApacs,
  type PaginaLinhasApac,
  type SolicitanteApac,
  type ArquivoSusGerado,
  type ArquivoSusLido,
  type CompetenciaSusResumo,
  type CriticaSusLida,
  definicaoParametro,
  type EquivalenciaSusLida,
  esquemaAbrirCompetenciaSus,
  esquemaBuscaProcedimentoSus,
  esquemaCompetenciaSus,
  esquemaCriticarSus,
  esquemaDesativarEquivalenciaSus,
  esquemaFecharCompetenciaSus,
  esquemaFiltroCriticasSus,
  esquemaFiltroEquivalenciasSus,
  esquemaBuscaMedicoSolicitante,
  esquemaFiltroLinhasBpa,
  esquemaGerarBpa,
  esquemaGerarCiha,
  type MedicoSolicitanteAchado,
  type PaginaLinhasBpa,
  esquemaJustificarCriticaSus,
  esquemaReabrirCompetenciaSus,
  esquemaRegistrarEquivalenciaSus,
  EVENTOS_AUDITAVEIS,
  type FonteRemuneracaoCiha,
  FONTES_REMUNERACAO_CIHA,
  INSTRUMENTOS_SUS,
  type InstrumentoSus,
  type PaginaCriticasSus,
  type PaginaEquivalenciasSus,
  type ProcedimentoHospitalSus,
  type ResultadoCriticaSus,
  type SigtapAchado,
} from '@sgh/contratos';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import type { z } from 'zod';
import {
  chaveLiberacaoDoInstrumento,
  conveniosDoParametro,
  fontesDoParametro,
  habilitacoesDoParametro,
} from '@sgh/dominio-faturamento';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, linhaTrilha, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { escopoConvenios } from '../faturamento/servico.js';
import { LiberacaoPep } from '../pep/liberacao-pep.js';
import { armazemSusMemoria } from './armazem.js';
import type { ParametrosSus } from './montagem.js';
import { PORTA_SUS, type PortaSus } from './porta.js';
import { PortaSusMemoria } from './porta-memoria.js';
import { chaveMestraDoAmbiente, SeloSolicitanteApac } from './selo-solicitante.js';
import { type ArmazemArquivoSus, ServicoSus, type SessaoSus } from './servico.js';
import { PARAMETROS_AIH_VAZIOS } from './montagem-aih.js';
import { ServicoSusAih } from './servico-aih.js';

export const ARMAZEM_ARQUIVO_SUS = Symbol('ARMAZEM_ARQUIVO_SUS');

interface Resposta {
  header(n: string, v: string): unknown;
  send(c: unknown): unknown;
}

const E = EVENTOS_AUDITAVEIS;

function invalido(erro: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): ErroProblema {
  return new ErroProblema(
    'entrada-invalida',
    400,
    'Dados inválidos',
    erro.issues[0]?.message ?? 'Confira os campos.',
    { campos: [...new Set(erro.issues.map((i) => i.path.map(String).join('.')))] },
  );
}

function validar<T>(esquema: z.ZodType<T>, v: unknown): T {
  const r = esquema.safeParse(v);
  if (!r.success) throw invalido(r.error);
  return r.data;
}

const instrumentoDe = (v: string | undefined): InstrumentoSus | null =>
  (INSTRUMENTOS_SUS as readonly string[]).includes(v ?? '') ? (v as InstrumentoSus) : null;

/** O dia de hoje no fuso do hospital (a competência futura é recusada pelo dia local). */
function hojeLocal(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

@Controller('sus')
export class SusController {
  readonly servico: ServicoSus;
  /** Etapa 4: a AIH e o retorno do gestor (as rotas em sus-aih.controller.ts; a crítica da AIH entra aqui). */
  readonly aih: ServicoSusAih;
  private readonly liberacao: LiberacaoPep;

  constructor(
    @Inject(PORTA_SUS) porta: PortaSus,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(ARMAZEM_ARQUIVO_SUS) armazem: ArmazemArquivoSus | null = null,
  ) {
    this.liberacao = new LiberacaoPep(configuracao, cache);
    const log = new Logger('SusController');
    // A chave opaca do solicitante da APAC deriva da chave mestra da plataforma (estável entre reinícios e instâncias);
    // sem ela (dev/ci), de uma aleatória do processo (D-SOLICITANTE-513).
    const selo = new SeloSolicitanteApac(chaveMestraDoAmbiente(process.env));
    const guarda = armazem ?? armazemSusMemoria();
    this.servico = new ServicoSus(porta, guarda, (m) => log.warn(m), selo);
    this.aih = new ServicoSusAih(
      porta,
      this.servico,
      guarda,
      async (s) => s.parametros.aih ?? PARAMETROS_AIH_VAZIOS,
      (m) => log.warn(m),
    );
    this.servico.registrarMontagem('aih', this.aih.montadorCritica());
    // Com a porta em memória, a trilha das gravações vai ao registrador da API (no núcleo, vai na transação).
    if (porta instanceof PortaSusMemoria)
      porta.aoRegistrarTrilha = async (l) => {
        await trilha.registrar({
          evento: l.evento,
          rede: l.rede,
          hospital: l.hospital,
          usuario: l.usuario,
          estacao: l.estacao ?? '',
          correlacao: l.correlacao,
          recurso: l.recurso,
          resultado: 'sucesso',
          tabelaAlvo: l.tabelaAlvo ?? 'MEMORIA',
          idAlvo: l.idAlvo ?? '',
        });
      };
  }

  /** Os parâmetros do faturamento SUS resolvidos para o estabelecimento da sessão. */
  private async parametros(s: SessaoCadastro): Promise<ParametrosSus> {
    let valores: Awaited<ReturnType<FonteConfiguracao['valoresParametro']>> = [];
    try {
      valores = this.configuracao ? await this.configuracao.valoresParametro(s.rede, s.hospital) : [];
    } catch {
      valores = [];
    }
    const texto = (chave: string): string => {
      const def = definicaoParametro(chave);
      if (!def) return '';
      const v = valorTipado(
        def,
        resolverParametro(
          def,
          valores,
          {
            rede: s.rede,
            empresa: null,
            estabelecimento: s.hospital,
            unidade: null,
            perfis: [],
            usuario: s.login,
          },
          new Date(),
        ).valor,
      );
      return typeof v === 'string' ? v : String(v ?? '');
    };
    const fonte = texto('faturamento.sus.ciha.fontePadrao');
    return {
      cnes: texto('faturamento.sus.cnes').trim(),
      conveniosSus: conveniosDoParametro(texto('faturamento.sus.conveniosSus')),
      conveniosParticular: conveniosDoParametro(texto('faturamento.sus.conveniosParticular')),
      fontePadrao: (FONTES_REMUNERACAO_CIHA as readonly string[]).includes(fonte)
        ? (fonte as FonteRemuneracaoCiha)
        : null,
      fontePorConvenio: fontesDoParametro(texto('faturamento.sus.ciha.fontePorConvenio')),
      habilitacoes: habilitacoesDoParametro(texto('faturamento.sus.habilitacoes')),
      apac: { uf: texto('faturamento.sus.apac.uf').trim() },
      bpa: {
        orgaoOrigem: texto('faturamento.sus.bpa.orgaoOrigem').trim(),
        siglaOrigem: texto('faturamento.sus.bpa.siglaOrigem').trim(),
        cnpj: texto('faturamento.sus.bpa.cnpjPrestador').trim(),
        orgaoDestino: texto('faturamento.sus.bpa.orgaoDestino').trim(),
        indicadorDestino: texto('faturamento.sus.bpa.indicadorDestino').trim() === 'E' ? 'E' : 'M',
      },
      aih: {
        utiPorAcomodacao: texto('faturamento.sus.aih.utiPorAcomodacao').trim(),
        diretorClinicoCns: texto('faturamento.sus.aih.diretorClinicoCns').trim(),
      },
    };
  }

  /** A sessão do faturamento SUS (também a das rotas da AIH, em sus-aih.controller.ts). */
  async sessao(req: RequisicaoAutorizada): Promise<SessaoSus> {
    const s = sessaoDe(req);
    const escopo = escopoConvenios(s);
    return {
      rede: s.rede,
      hospital: s.hospital,
      login: s.login,
      estabelecimento: s.porta.estabelecimento,
      usuario: s.porta.usuario,
      correlacao: s.porta.correlacao,
      hoje: hojeLocal(),
      convenios: escopo.length === 0 ? null : escopo.map(Number).filter(Number.isFinite),
      parametros: await this.parametros(s),
      pode: (acao) => s.pode(acao),
      trilha: (evento, operacao, alvo) => {
        const base = linhaTrilha(s, evento, 'faturamento.sus', operacao, {
          tabela: alvo.tabela,
          id: alvo.id,
        });
        const estacao = (base.dadosDepois as { estacao?: unknown } | undefined)?.estacao;
        return {
          rede: s.rede,
          hospital: s.hospital,
          usuario: s.login,
          evento,
          recurso: 'faturamento.sus',
          operacao,
          tabelaAlvo: alvo.tabela,
          idAlvo: alvo.id,
          chaveNaturalAlvo: null,
          resultado: 'sucesso',
          estacao: typeof estacao === 'string' ? estacao : null,
          correlacao: base.correlacao ?? '',
          estabelecimento: base.estabelecimento,
          usuarioId: base.usuario,
          ...(alvo.diferenca ? { diferenca: alvo.diferenca.slice(0, 1000) } : {}),
        };
      },
    };
  }

  // ── Competências ─────────────────────────────────────────────────────────────────────────────────────

  @Get('competencias')
  @Permissao('faturamento.sus.ler')
  async competencias(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{
    competencias: CompetenciaSusResumo[];
    instrumentos: { instrumento: InstrumentoSus; liberado: boolean }[];
    cihaFonteDoEnvio: boolean;
    escopoParcial: boolean;
    hoje: string;
  }> {
    const s = await this.sessao(req);
    const instrumentos: { instrumento: InstrumentoSus; liberado: boolean }[] = [];
    // Tudo ligado para todos (F3.7): nenhuma chave de liberação por instrumento; o acesso é o do cargo.
    for (const i of INSTRUMENTOS_SUS) instrumentos.push({ instrumento: i, liberado: true });
    const fonte = await this.liberacao.consultar(sessaoDe(req), chaveLiberacaoDoInstrumento('ciha'));
    return {
      competencias: await this.servico.listarCompetencias(s, instrumentoDe(q['instrumento'])),
      instrumentos,
      cihaFonteDoEnvio: fonte.ligada,
      escopoParcial: s.convenios !== null,
      hoje: s.hoje,
    };
  }

  @Post('competencias')
  @HttpCode(201)
  @Permissao('faturamento.sus.abrirCompetencia')
  @AuditadoNoHandler(
    'faturamento.abrirCompetenciaSus: competencia_sus com a trilha_auditoria na mesma transação',
  )
  async abrir(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<CompetenciaSusResumo> {
    return this.servico.abrir(await this.sessao(req), validar(esquemaAbrirCompetenciaSus, corpo));
  }

  @Post('competencias/critica')
  @HttpCode(200)
  @Permissao('faturamento.sus.abrirCompetencia')
  @AuditadoNoHandler(
    'faturamento.criticarSus: critica_sus e a competência com a trilha_auditoria (contagens por regra)',
  )
  async criticar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoCriticaSus> {
    return this.servico.criticar(await this.sessao(req), validar(esquemaCriticarSus, corpo));
  }

  @Post('competencias/fechamento')
  @HttpCode(200)
  @Permissao('faturamento.sus.fecharCompetencia')
  @AuditadoNoHandler(
    'faturamento.fecharCompetenciaSus: competencia_sus com a trilha_auditoria na mesma transação',
  )
  async fechar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<CompetenciaSusResumo> {
    return this.servico.fechar(await this.sessao(req), validar(esquemaFecharCompetenciaSus, corpo));
  }

  @Post('competencias/reabertura')
  @HttpCode(200)
  @Permissao('faturamento.sus.reabrirCompetencia')
  @AuditadoNoHandler(
    'faturamento.reabrirCompetenciaSus: competencia_sus com a trilha_auditoria na mesma transação',
  )
  async reabrir(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<CompetenciaSusResumo> {
    return this.servico.reabrir(await this.sessao(req), validar(esquemaReabrirCompetenciaSus, corpo));
  }

  // ── Críticas ─────────────────────────────────────────────────────────────────────────────────────────

  @Get('criticas')
  @Permissao('faturamento.sus.ler')
  @Auditar(E.faturamentoSusLido.codigo)
  async criticas(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaCriticasSus> {
    const f = validar(esquemaFiltroCriticasSus, q);
    req.sghAlvo = { tabelaAlvo: 'critica_sus', idAlvo: `${f.instrumento} ${f.competencia}` };
    return this.servico.listarCriticas(await this.sessao(req), f);
  }

  @Post('criticas/justificativa')
  @HttpCode(200)
  @Permissao('faturamento.sus.justificarCritica')
  @AuditadoNoHandler(
    'faturamento.justificarCriticaSus: critica_sus com a trilha_auditoria na mesma transação',
  )
  async justificar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<CriticaSusLida> {
    return this.servico.justificar(await this.sessao(req), validar(esquemaJustificarCriticaSus, corpo));
  }

  // ── CIHA e arquivos ──────────────────────────────────────────────────────────────────────────────────

  @Post('ciha/arquivo')
  @HttpCode(201)
  @Permissao('faturamento.susCiha.gerar')
  @AuditadoNoHandler(
    'faturamento.gerarCiha: arquivo e registro_ciha com a trilha_auditoria (hash e contagens)',
  )
  async gerarCiha(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<ArquivoSusGerado> {
    return this.servico.gerarCiha(await this.sessao(req), validar(esquemaGerarCiha, corpo));
  }

  @Get('arquivos')
  @Permissao('faturamento.sus.ler')
  @Auditar(E.faturamentoSusLido.codigo)
  async arquivos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ArquivoSusLido[]> {
    const instrumento = instrumentoDe(q['instrumento'] ?? 'ciha');
    if (!instrumento)
      throw new ErroProblema('entrada-invalida', 400, 'Instrumento inválido', '', {
        campos: ['instrumento'],
      });
    const competencia = q['competencia'] ? validar(esquemaCompetenciaSus, q['competencia']) : null;
    req.sghAlvo = { tabelaAlvo: 'arquivo', idAlvo: `${instrumento} ${competencia ?? ''}`.trim() };
    return this.servico.listarArquivos(await this.sessao(req), instrumento, competencia);
  }

  @Get('arquivos/:id/conteudo')
  @Permissao('faturamento.susCiha.gerar')
  @AuditadoNoHandler(
    'faturamento.arquivoSus.baixado: a trilha_auditoria com o hash, gravada antes do envio do conteúdo',
  )
  async baixar(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: false }) res: Resposta,
  ): Promise<void> {
    await this.enviar(res, await this.servico.baixar(await this.sessao(req), idDaRota(id), 'ciha'));
  }

  private async enviar(
    res: Resposta,
    r: { nome: string; conteudo: Uint8Array; arquivo: ArquivoSusLido },
  ): Promise<void> {
    res.header('content-type', 'text/plain; charset=us-ascii');
    res.header('content-disposition', `attachment; filename="${r.nome.replace(/[^A-Za-z0-9_.-]/g, '_')}"`);
    res.header('x-sgh-sha256', r.arquivo.hash);
    res.header('cache-control', 'no-store');
    res.send(Buffer.from(r.conteudo));
  }

  // ── Equivalência SIGTAP do hospital ─────────────────────────────────────────────────────────────────────

  @Get('equivalencias')
  @Permissao('faturamento.sus.ler')
  async equivalencias(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaEquivalenciasSus> {
    return this.servico.listarEquivalencias(
      await this.sessao(req),
      validar(esquemaFiltroEquivalenciasSus, q),
    );
  }

  @Get('sigtap')
  @Permissao('faturamento.sus.ler')
  async sigtap(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<SigtapAchado[]> {
    const f = validar(esquemaBuscaProcedimentoSus, q);
    return this.servico.buscarSigtap(await this.sessao(req), f.termo, f.competencia ?? null);
  }

  @Get('procedimentos-hospital')
  @Permissao('faturamento.sus.ler')
  async procedimentosHospital(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ProcedimentoHospitalSus[]> {
    if (q['ids'] !== undefined) {
      const ids = String(q['ids'])
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isInteger(x) && x > 0 && x <= Number.MAX_SAFE_INTEGER);
      if (ids.length === 0 || ids.length > 100)
        throw new ErroProblema('entrada-invalida', 400, 'Procedimentos inválidos', 'De 1 a 100 IDs.', {
          campos: ['ids'],
        });
      return this.servico.buscarProcedimentosHospital(await this.sessao(req), { ids });
    }
    const f = validar(esquemaBuscaProcedimentoSus.pick({ termo: true }), q);
    return this.servico.buscarProcedimentosHospital(await this.sessao(req), { termo: f.termo });
  }

  @Post('equivalencias')
  @HttpCode(200)
  @Permissao('faturamento.susEquivalencia.editar')
  @AuditadoNoHandler(
    'faturamento.registrarEquivalenciaSus: equivalencia_sigtap_item com a trilha_auditoria (antes e depois)',
  )
  async registrarEquivalencia(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ equivalencia: EquivalenciaSusLida; mudou: boolean }> {
    return this.servico.registrarEquivalencia(
      await this.sessao(req),
      validar(esquemaRegistrarEquivalenciaSus, corpo),
    );
  }

  @Post('equivalencias/desativacao')
  @HttpCode(200)
  @Permissao('faturamento.susEquivalencia.editar')
  @AuditadoNoHandler(
    'faturamento.desativarEquivalenciaSus: equivalencia_sigtap_item com a trilha_auditoria (antes e depois)',
  )
  async desativarEquivalencia(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EquivalenciaSusLida> {
    return this.servico.desativarEquivalencia(
      await this.sessao(req),
      validar(esquemaDesativarEquivalenciaSus, corpo),
    );
  }

  // ── BPA e solicitantes (etapa 2) ─────────────────────────────────────────────────────────────────────

  @Post('bpa/arquivo')
  @HttpCode(201)
  @Permissao('faturamento.susBpa.gerar')
  @AuditadoNoHandler(
    'faturamento.gerarBpa: arquivo e producao_ambulatorial_sus_item com a trilha_auditoria (hash, folhas, controle e contagens)',
  )
  async gerarBpa(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<ArquivoSusGerado> {
    return this.servico.gerarBpa(await this.sessao(req), validar(esquemaGerarBpa, corpo));
  }

  @Get('bpa/linhas')
  @Permissao('faturamento.sus.ler')
  @Auditar(E.faturamentoSusLido.codigo)
  async linhasBpa(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaLinhasBpa> {
    const f = validar(esquemaFiltroLinhasBpa, q);
    req.sghAlvo = { tabelaAlvo: 'producao_ambulatorial_sus_item', idAlvo: String(f.arquivo) };
    return this.servico.listarLinhasBpa(await this.sessao(req), f);
  }

  @Get('bpa/arquivos/:id/conteudo')
  @Permissao('faturamento.susBpa.gerar')
  @AuditadoNoHandler(
    'faturamento.arquivoSus.baixado: a trilha_auditoria com o hash, gravada antes do envio do conteúdo',
  )
  async baixarBpa(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: false }) res: Resposta,
  ): Promise<void> {
    await this.enviar(res, await this.servico.baixar(await this.sessao(req), idDaRota(id), 'bpa'));
  }

  @Get('solicitantes/cadastro-geral')
  @Permissao('faturamento.susSolicitante.ler')
  async solicitantesCadastroGeral(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<MedicoSolicitanteAchado[]> {
    const f = validar(esquemaBuscaMedicoSolicitante, q);
    return this.servico.buscarSolicitantes(await this.sessao(req), f.termo);
  }

  @Get('parametros-ambulatoriais')
  @Permissao('faturamento.sus.ler')
  async parametrosCadastro(
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ competenciaAmbulatorio: string | null; versao: string | null; orgao: string | null }> {
    return this.servico.parametrosCadastro(await this.sessao(req));
  }

  // ── APAC (etapa 3) ───────────────────────────────────────────────────────────────────────────────────

  @Get('apac')
  @Permissao('faturamento.sus.ler')
  @Auditar(E.faturamentoSusLido.codigo)
  async apacs(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<PaginaApacs> {
    const f = validar(esquemaFiltroApacs, q);
    req.sghAlvo = { tabelaAlvo: 'apac', idAlvo: f.competencia ?? f.situacao ?? 'lista' };
    return this.servico.listarApacs(await this.sessao(req), f);
  }

  @Get('apac/atendimento/:registro')
  @Permissao('faturamento.susApac.registrar')
  @Auditar(E.faturamentoSusLido.codigo)
  async atendimentoLaudoApac(
    @Param('registro') registro: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AtendimentoLaudoApac> {
    const reg = idDaRota(registro);
    // Lê CID e prontuário de um atendimento: auditado, com o registro consultado (D-ATEND-513).
    req.sghAlvo = { tabelaAlvo: 'atendimento', idAlvo: String(reg) };
    return this.servico.atendimentoLaudoApac(await this.sessao(req), reg);
  }

  @Get('apac/dominios')
  @Permissao('faturamento.sus.ler')
  async dominiosApac(@Req() req: RequisicaoAutorizada): Promise<DominiosApac> {
    return this.servico.dominiosApac(await this.sessao(req));
  }

  @Get('apac/solicitantes')
  @Permissao('faturamento.susApac.registrar')
  @Auditar(E.faturamentoSusLido.codigo)
  async solicitantesApac(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<SolicitanteApac[]> {
    const f = validar(esquemaBuscaMedicoSolicitante, q);
    // A busca no cadastro de solicitantes (dado pessoal do profissional) é auditada; o termo não vai à trilha.
    req.sghAlvo = { tabelaAlvo: 'solicitante_externo', idAlvo: 'busca' };
    return this.servico.buscarSolicitantesApac(await this.sessao(req), f.termo);
  }

  @Post('apac')
  @HttpCode(200)
  @Permissao('faturamento.susApac.registrar')
  @AuditadoNoHandler(
    'faturamento.registrarApac: apac com a trilha_auditoria na mesma transação (ação, procedimento e validade)',
  )
  async registrarApac(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<ApacLida> {
    return this.servico.registrarApac(await this.sessao(req), validar(esquemaRegistrarApac, corpo));
  }

  @Post('apac/arquivo')
  @HttpCode(201)
  @Permissao('faturamento.susApac.registrar')
  @AuditadoNoHandler(
    'faturamento.gerarApac: arquivo e apac_procedimento com a trilha_auditoria (hash, controle e contagens)',
  )
  async gerarApac(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<ArquivoSusGerado> {
    return this.servico.gerarApac(await this.sessao(req), validar(esquemaGerarApac, corpo));
  }

  @Get('apac/linhas')
  @Permissao('faturamento.sus.ler')
  @Auditar(E.faturamentoSusLido.codigo)
  async linhasApac(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaLinhasApac> {
    const f = validar(esquemaFiltroLinhasApac, q);
    req.sghAlvo = { tabelaAlvo: 'apac_procedimento', idAlvo: String(f.arquivo) };
    return this.servico.listarLinhasApac(await this.sessao(req), f);
  }

  @Get('apac/arquivos/:id/conteudo')
  @Permissao('faturamento.susApac.registrar')
  @AuditadoNoHandler(
    'faturamento.arquivoSus.baixado: a trilha_auditoria com o hash, gravada antes do envio do conteúdo',
  )
  async baixarApac(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: false }) res: Resposta,
  ): Promise<void> {
    await this.enviar(res, await this.servico.baixar(await this.sessao(req), idDaRota(id), 'apac'));
  }
}
