// Higienização do pedido à liberação do leito (M21; ficha, seções 5 e 7; regra 9):
//   GET  /api/higienizacao/painel                  as solicitações abertas com o prazo, o cronômetro e o histórico
//   GET  /api/higienizacao/fila?profissional       a fila do profissional (atrasadas primeiro, pelo prazo)
//   GET  /api/higienizacao/eventos                 canal de eventos (text/event-stream): só avisa que mudou
//   POST /api/higienizacao/solicitacoes            hotelaria.solicitarLimpeza (manual ou QR code do leito)
//   POST /api/higienizacao/solicitacoes/:id/etapas a etapa no novo (atribuir, iniciar, pausar, concluir, inspecionar,
//                                                  reprovar, liberar), numa gravação só; a liberação encerra o
//                                                  período de higienização do leito na mesma transação
//   POST /api/higienizacao/fotos                   a foto da limpeza ao armazenamento de objetos local
//   GET  /api/higienizacao/fotos?chave             a foto (a inspeção confere)
//   GET  /api/higienizacao/indicadores?de&ate      W0-07 (M3): giro do leito, no prazo e execução, com numerador e
//                                                  denominador, no total e por tipo, área e profissional
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  chaveTextoLeito,
  definicaoParametro,
  esquemaEtapaLimpeza,
  esquemaFotoHigienizacao,
  esquemaSolicitarLimpeza,
  EVENTOS_AUDITAVEIS,
  type ApoioInternacaoTela,
  type PainelHigienizacao,
  type Precaucao,
  type ResultadoInternacao,
} from '@sgh/contratos';
import { conferirEtapa, prazoMinutos } from '@sgh/dominio-hotelaria';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { exigir, idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo, inteiroOuNulo } from '../exames/public-api.js';
import { BATIDA_EVENTOS_MS, BATIDA_EVENTOS_PADRAO_MS } from '../internacao/public-api.js';
import type {
  AvisosAtendimento,
  RequisicaoBrutaAtendimento,
  RespostaEventosAtendimento,
} from '../atendimento/public-api.js';
import { ApoiosAdt, ctxAdt, janelaOutroSistema } from './apoios.js';
import { indicadoresGiroLeito, type IndicadoresGiroLeito, periodoGiro } from './indicadores-giro.js';
import { ARMAZEM_FOTOS, type ArmazemFotos, CHAVE_FOTO } from './fotos.js';
import { PORTA_ADT, type PortaAdt } from './porta.js';
import { ServicoAdt } from './servico.js';
import { AVISOS_ADT } from './simbolos.js';

const ETAPAS_DA_INSPECAO = new Set(['inspecionado', 'reprovado', 'liberado']);

const padrao = (chave: string) => Number(definicaoParametro(chave)?.padrao ?? 0);

@Controller('higienizacao')
export class HigienizacaoController {
  readonly apoios: ApoiosAdt;
  private readonly servico: ServicoAdt;
  constructor(
    @Inject(PORTA_ADT) private readonly porta: PortaAdt,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(ARMAZEM_FOTOS) private readonly fotos: ArmazemFotos | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(AVISOS_ADT) private readonly avisos: AvisosAtendimento | null = null,
    @Optional() @Inject(BATIDA_EVENTOS_MS) private readonly batidaMs: number = BATIDA_EVENTOS_PADRAO_MS,
  ) {
    this.apoios = new ApoiosAdt(porta, trilha, configuracao, cache);
    this.servico = new ServicoAdt(porta, janelaOutroSistema(configuracao));
  }

  /** O prazo (SLA) por tipo × criticidade, pelos parâmetros do estabelecimento (sem valor: o padrão do registro). */
  private async parametrosPrazo(s: SessaoCadastro) {
    const v = async (k: string) => (await this.apoios.limpeza.parametro(s, k)) || padrao(k);
    return {
      terminalMinutos: await v('hotelaria.slaTerminalMinutos'),
      concorrenteMinutos: await v('hotelaria.slaConcorrenteMinutos'),
      fatorCritica: await v('hotelaria.slaCriticaFator'),
    };
  }

  @Get('gravacao')
  @Permissao('hotelaria.limpeza.ler')
  gravacao(@Req() req: RequisicaoAutorizada) {
    return this.apoios.gravacao(sessaoDe(req));
  }

  @Get('apoio')
  @Permissao('hotelaria.limpeza.ler')
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioInternacaoTela> {
    return this.porta.apoio(ctxAdt(sessaoDe(req)));
  }

  @Get('painel')
  @Permissao('hotelaria.limpeza.ler')
  async painel(@Req() req: RequisicaoAutorizada): Promise<PainelHigienizacao> {
    const s = sessaoDe(req);
    return this.servico.painelHigienizacao(ctxAdt(s), await this.parametrosPrazo(s));
  }

  /**
   * Quem só executa (sem liberar nem supervisionar) age em nome do profissional ligado ao próprio login
   * (CHPROFISLIMP.USUARIO_SISTEMA): o número dele; null para o supervisor, que escolhe o profissional. Sem ligação, 403.
   */
  private async profissionalDoExecutor(s: SessaoCadastro): Promise<number | null> {
    if (s.pode('hotelaria.limpeza.liberar')) return null;
    const meu = await this.porta.profissionalLimpeza(ctxAdt(s), s.login);
    if (meu === null)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Profissional não ligado',
        'O seu usuário não está ligado a um profissional da higienização: peça ao supervisor para ligar no cadastro.',
        { codigo: 'profissional-da-sessao' },
      );
    return meu;
  }

  private recusaOutroProfissional(): ErroProblema {
    return new ErroProblema(
      'sem-permissao',
      403,
      'Outro profissional',
      'Você registra e consulta só as limpezas em seu nome.',
      { codigo: 'profissional-da-sessao', campos: ['profissional'] },
    );
  }

  /** W0-07 (M3): os indicadores de higienização e giro de leito do período (só leitura, sem dado de pessoa). */
  @Get('indicadores')
  @Permissao('hotelaria.limpeza.ler')
  indicadores(
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IndicadoresGiroLeito> {
    const p = periodoGiro(de, ate);
    return indicadoresGiroLeito(this.porta, ctxAdt(sessaoDe(req)), p.de, p.ate);
  }

  @Get('fila')
  @Permissao('hotelaria.limpeza.executar')
  async fila(
    @Query('profissional') profissional: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PainelHigienizacao> {
    const s = sessaoDe(req);
    const meu = await this.profissionalDoExecutor(s);
    const pedido = inteiroOuNulo(profissional);
    if (meu !== null && pedido !== null && pedido !== meu) throw this.recusaOutroProfissional();
    const painel = await this.servico.painelHigienizacao(ctxAdt(s), await this.parametrosPrazo(s), {
      profissional: meu ?? pedido,
    });
    return meu === null ? painel : { ...painel, profissionalDaSessao: meu };
  }

  @Get('eventos')
  @Permissao('hotelaria.limpeza.ler')
  eventos(
    @Req() req: RequisicaoAutorizada & RequisicaoBrutaAtendimento,
    @Res() res: RespostaEventosAtendimento,
  ): void {
    if (!this.avisos) throw new ErroProblema('indisponivel', 503, 'Avisos de mudança indisponíveis');
    this.avisos.abrirCanal(
      req,
      res,
      sessaoDe(req).hospital,
      'hotelaria.limpeza.ler',
      this.resolvedor,
      this.batidaMs,
    );
  }

  @Post('solicitacoes')
  @HttpCode(201)
  @Permissao('hotelaria.limpeza.solicitar')
  @AuditadoNoHandler('hotelaria.solicitarLimpeza pelo executor (trilha na mesma transação)')
  async solicitar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoInternacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaSolicitarLimpeza, b);
    const r = (await this.apoios.limpeza.executar(
      s,
      'hotelaria.solicitarLimpeza',
      e,
      'Limpeza solicitada.',
    )) as ResultadoInternacao;
    this.avisos?.avisar(s.hospital);
    return r;
  }

  @Post('solicitacoes/:id/etapas')
  @HttpCode(200)
  @Permissao('hotelaria.limpeza.ler')
  @AuditadoNoHandler('etapa da higienização (solicitacao_limpeza) com a trilha de auditoria na mesma transação')
  async etapa(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoInternacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEtapaLimpeza, { ...(b as object), solicitacao: idDaRota(id) });
    const permissao = ETAPAS_DA_INSPECAO.has(e.etapa)
      ? 'hotelaria.limpeza.liberar'
      : 'hotelaria.limpeza.executar';
    await exigir(s, permissao, this.trilha);
    const c = ctxAdt(s);
    const sol = await this.porta.leitoDaSolicitacao(c, e.solicitacao);
    if (!sol)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Solicitação não encontrada',
        'A solicitação de limpeza não existe.',
      );
    const etapas = await this.porta.etapas(c, e.solicitacao);
    const atual = this.servico.etapaAtual(etapas);
    const ultima = <K extends 'tipoLimpeza' | 'profissional' | 'precaucao' | 'prazo'>(k: K) =>
      [...etapas].reverse().find((x) => x[k] !== null)?.[k] ?? null;
    const tipoLimpeza = ultima('tipoLimpeza') as number | null;
    // Quem só executa age em seu nome: assume para si e não registra etapa da limpeza atribuída a outra pessoa.
    const meu = permissao === 'hotelaria.limpeza.executar' ? await this.profissionalDoExecutor(s) : null;
    const atribuido = ultima('profissional') as number | null;
    if (meu !== null) {
      if (e.profissional !== undefined && e.profissional !== meu) throw this.recusaOutroProfissional();
      if (e.etapa !== 'atribuido' && atribuido !== null && atribuido !== meu)
        throw this.recusaOutroProfissional();
    }
    const profissional = e.profissional ?? (meu !== null && e.etapa === 'atribuido' ? meu : atribuido);
    const precaucao = ultima('precaucao') as Precaucao | null;
    const checklist = e.checklist ?? [];
    const problema = conferirEtapa({
      atual,
      pedida: e.etapa,
      tipoLimpeza,
      precaucao,
      checklist,
      profissional,
    });
    if (problema)
      throw new ErroProblema('recusa-de-negocio', 409, 'Etapa recusada', problema, {
        codigo: 'etapa-recusada',
      });
    if (e.foto && !CHAVE_FOTO.test(e.foto))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Foto inválida',
        'Envie a foto antes de registrar a etapa.',
        { campos: ['foto'] },
      );
    const prazo =
      e.etapa === 'atribuido' && ultima('prazo') === null
        ? prazoMinutos(tipoLimpeza, sol.criticidade, await this.parametrosPrazo(s))
        : null;
    const evento =
      e.etapa === 'liberado'
        ? EVENTOS_AUDITAVEIS.hotelariaLeitoLiberado.codigo
        : EVENTOS_AUDITAVEIS.hotelariaLimpezaEtapa.codigo;
    const etapaId = await this.apoios.limpeza.sgh(
      s,
      evento,
      permissao,
      (x: number) => ({
        // A inspeção grava a linha da inspeção; as demais etapas, a própria solicitação.
        tabela: e.etapa === 'inspecionado' || e.etapa === 'reprovado' ? 'inspecao_limpeza' : 'solicitacao_limpeza',
        id: String(x),
        chave: chaveTextoLeito(sol.leito),
      }),
      (g) =>
        g.gravarEtapaLimpeza({
          solicitacao: e.solicitacao,
          leitoEspelho: sol.espelho,
          leito: sol.leito,
          etapa: e.etapa,
          tipoLimpeza,
          profissional,
          precaucao,
          prazoMinutos: prazo,
          checklist,
          foto: e.foto ?? null,
          observacao: e.observacao ?? null,
          aparelho: estacaoDaRequisicao(s.req).slice(0, 80),
          usuario: s.login,
        }),
    );
    this.avisos?.avisar(s.hospital);
    const mensagens: Record<string, string> = {
      atribuido: 'Limpeza atribuída.',
      emExecucao: 'Limpeza em execução.',
      pausado: 'Limpeza pausada.',
      concluido: 'Limpeza concluída: aguardando a inspeção.',
      reprovado: 'Inspeção reprovada: a limpeza volta para a execução.',
      inspecionado: 'Inspeção aprovada.',
      liberado: 'Leito liberado para a admissão.',
      cancelado: 'Solicitação cancelada.',
    };
    return {
      ok: true,
      resultado: { etapa: etapaId, solicitacao: e.solicitacao },
      repetida: false,
      mensagem: mensagens[e.etapa] ?? 'Etapa registrada.',
    };
  }

  @Post('fotos')
  @HttpCode(201)
  @Permissao('hotelaria.limpeza.executar')
  @Auditar(EVENTOS_AUDITAVEIS.hotelariaLimpezaEtapa.codigo)
  async foto(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<{ chave: string }> {
    const s = sessaoDe(req);
    const e = corpo(esquemaFotoHigienizacao, b);
    if (!this.fotos)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Fotos indisponíveis',
        'O armazenamento de fotos não está configurado.',
      );
    await this.apoios.limpeza.exigirLiberacao(s);
    const bytes = Buffer.from(e.conteudo, 'base64');
    if (bytes.length < 16 || bytes.length > 1_500_000)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Foto inválida',
        'A foto passa de 1,5 MB ou está vazia.',
        { campos: ['conteudo'] },
      );
    const assinaturas: Record<string, number[]> = {
      'image/jpeg': [0xff, 0xd8],
      'image/png': [0x89, 0x50],
      'image/webp': [0x52, 0x49],
    };
    const esperado = assinaturas[e.tipo] ?? [];
    if (!esperado.every((v, i) => bytes[i] === v))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Foto inválida',
        'O arquivo não é uma imagem do tipo informado.',
        { campos: ['conteudo'] },
      );
    const chave = await this.fotos.guardar(s.hospital, e.tipo, bytes);
    req.sghAlvo = { tabelaAlvo: 'solicitacao_limpeza', idAlvo: String(e.solicitacao) };
    return { chave };
  }

  @Get('fotos')
  @Permissao('hotelaria.limpeza.ler')
  async lerFoto(
    @Query('chave') chave: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ tipo: string; conteudo: string }> {
    const s = sessaoDe(req);
    if (!chave || !CHAVE_FOTO.test(chave) || !this.fotos)
      throw new ErroProblema('nao-encontrado', 404, 'Foto não encontrada');
    const f = await this.fotos.ler(s.hospital, chave);
    if (!f) throw new ErroProblema('nao-encontrado', 404, 'Foto não encontrada');
    return { tipo: f.tipo, conteudo: Buffer.from(f.bytes).toString('base64') };
  }
}
