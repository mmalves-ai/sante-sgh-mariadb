// Mapa de leitos operacional, transferência e histórico de ocupação (M21; ficha, seções 4, 5 e 7):
//   GET  /api/leitos/mapa?abertura=1          o painel do M16 com os estados só do novo, a limpeza e o conflito
//   GET  /api/leitos/eventos                  canal de eventos (text/event-stream): só avisa que mudou
//   POST /api/leitos/transferencias           internacao.transferirLeito (trava origem e destino em ordem fixa)
//   POST /api/leitos/estados                  bloqueio, precaução ou leito extra (SGH_; não impede o outro sistema)
//   POST /api/leitos/estados/encerrar         desbloqueia, tira a precaução, retira o leito extra
//   POST /api/leitos/atributos                sexo, faixa de idade, criticidade, andar e ramal do leito (SGH_)
//   POST /api/leitos/estados/alterar          W0-07: motivo, precaução, previsão e observação sem encerrar (justificativa)
//   POST /api/leitos/atributos/limpar         W0-07: tira os atributos próprios (volta ao padrão; justificativa)
//   POST /api/leitos/etiqueta                 a etiqueta do leito com o QR code da solicitação de limpeza (ZPL)
//   GET  /api/leitos/historico?inicio&fim&bloco&pagina   os períodos (trechos de leito) paginados
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  type OnModuleDestroy,
  Optional,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  esquemaAlterarEstadoLeito,
  esquemaAtributoLeito,
  esquemaLimparAtributosLeito,
  esquemaEmitirEtiquetaLeito,
  type ImpressoGerado,
  esquemaBloquearLeito,
  esquemaEncerrarEstadoLeito,
  esquemaTransferirLeito,
  EVENTOS_AUDITAVEIS,
  type ApoioInternacaoTela,
  type HistoricoOcupacao,
  type MapaOperacional,
  type ResultadoInternacao,
  chaveTextoLeito,
} from '@sgh/contratos';
import { enfileirarZpl, ErroZpl, zplEtiquetaLeito } from '@sgh/dominio-documento';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, pagina, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { FONTE_DOCUMENTO, type FonteDocumento } from '../documento/public-api.js';
import { corpo, dataDaConsulta } from '../exames/public-api.js';
import {
  BATIDA_EVENTOS_MS,
  BATIDA_EVENTOS_PADRAO_MS,
  CONFIGURACAO_M16,
  type ConfiguracaoM16,
} from '../internacao/public-api.js';
import {
  AVISOS_ATENDIMENTO,
  type AvisosAtendimento,
  type RequisicaoBrutaAtendimento,
  type RespostaEventosAtendimento,
} from '../atendimento/public-api.js';
import { ApoiosAdt, ctxAdt, janelaOutroSistema } from './apoios.js';
import { avisandoAdt, intensivasDe } from './internacao.controller.js';
import { PORTA_ADT, type PortaAdt } from './porta.js';
import { ServicoAdt } from './servico.js';
import { AVISOS_ADT } from './simbolos.js';

@Controller('leitos')
export class MapaLeitosController implements OnModuleDestroy {
  readonly apoios: ApoiosAdt;
  private readonly servico: ServicoAdt;
  private readonly log = new Logger('MapaLeitos');
  constructor(
    @Inject(PORTA_ADT) private readonly porta: PortaAdt,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(CONFIGURACAO_M16) private readonly cfg16: ConfiguracaoM16 | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(AVISOS_ADT) private readonly avisos: AvisosAtendimento | null = null,
    @Optional()
    @Inject(AVISOS_ATENDIMENTO)
    private readonly avisosAtendimento: AvisosAtendimento | null = null,
    @Optional() @Inject(BATIDA_EVENTOS_MS) private readonly batidaMs: number = BATIDA_EVENTOS_PADRAO_MS,
    @Optional() @Inject(FONTE_DOCUMENTO) private readonly documento: FonteDocumento | null = null,
  ) {
    this.apoios = new ApoiosAdt(porta, trilha, configuracao, cache);
    this.servico = new ServicoAdt(porta, janelaOutroSistema(configuracao));
  }

  onModuleDestroy(): void {
    this.avisos?.fecharTodos();
  }

  private avisar<T>(s: SessaoCadastro, p: Promise<T>): Promise<T> {
    return avisandoAdt([this.avisos, this.avisosAtendimento], s, p);
  }

  @Get('gravacao')
  @Permissao('leitos.mapa.ler')
  gravacao(@Req() req: RequisicaoAutorizada) {
    return this.apoios.gravacao(sessaoDe(req));
  }

  @Get('apoio')
  @Permissao('leitos.mapa.ler')
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioInternacaoTela> {
    return this.porta.apoio(ctxAdt(sessaoDe(req)));
  }

  @Get('mapa')
  @Permissao('leitos.mapa.ler')
  async mapa(
    @Req() req: RequisicaoAutorizada,
    @Query('abertura') abertura?: string,
    @Query('paciente') paciente?: string,
    @Query('internacao') internacao?: string,
    @Query('solicitacao') solicitacao?: string,
  ): Promise<MapaOperacional> {
    const s = sessaoDe(req);
    const intensivas = await intensivasDe(this.cfg16, s);
    // M44: a admissão ou a transferência vinda do NIR vê o leito reservado para a solicitação como admissível.
    const sol = solicitacao ? idDaRota(solicitacao) : null;
    // Com o paciente da admissão (ou a internação da transferência), cada leito diz se aceita pelos atributos do novo.
    const m =
      paciente || internacao
        ? await this.servico.mapaPara(
            ctxAdt(s),
            intensivas,
            paciente ? { paciente: idDaRota(paciente) } : { reg: idDaRota(internacao ?? '') },
            sol,
          )
        : await this.servico.mapa(ctxAdt(s), intensivas, { solicitacao: sol });
    // A abertura da tela vai à trilha (o mapa leva só as iniciais; as releituras do canal de eventos, não).
    if (abertura === '1')
      await this.trilha.registrar({
        evento: EVENTOS_AUDITAVEIS.leitosConsultados.codigo,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, 'mapa-leitos').slice(0, 64),
        recurso: 'leitos.mapa',
        resultado: 'sucesso',
      });
    // Regra 8: o conflito visto pela primeira vez (o outro sistema ocupou o leito bloqueado ou em higienização aqui)
    // fica registrado e vai à trilha, para a coordenação; o outro sistema nunca é impedido. O já registrado não grava
    // de novo (o mapa relê a cada aviso e a cada 15 s): a leitura só abre a gravação quando há conflito novo.
    for (const l of m.leitos)
      if (l.situacao === 'conflito' && l.conflito && !l.conflito.registrado && l.conflito.reserva) {
        // M44, regra 12: o leito reservado pelo NIR ocupado pelo outro sistema (o NIR vê na fila e é avisado).
        try {
          await this.apoios.mapa.sgh(
            s,
            EVENTOS_AUDITAVEIS.nirReservaConflito.codigo,
            'leitos.mapa.ler',
            { tabela: 'SGH_INT_RESERVA_LEITO', id: String(l.conflito.reserva), chave: l.chave },
            (g) => g.registrarConflitoReserva({ leito: l.leito, reg: l.conflito?.internacao ?? 0 }),
          );
          l.conflito.registrado = true;
        } catch (x) {
          this.log.warn(
            `Conflito da reserva do leito ${l.chave} não registrado: ${x instanceof Error ? x.message : String(x)}`,
          );
        }
      } else if (l.situacao === 'conflito' && l.conflito && !l.conflito.registrado && l.estados.length > 0) {
        try {
          await this.apoios.mapa.sgh(
            s,
            EVENTOS_AUDITAVEIS.leitosConflito.codigo,
            'leitos.mapa.ler',
            { tabela: 'SGH_INT_LEITO_ESTADO', chave: l.chave },
            (g) => g.registrarConflito({ leito: l.leito, reg: l.conflito?.internacao ?? 0 }),
          );
          l.conflito.registrado = true;
        } catch (x) {
          // O mapa continua (mostra o conflito); a falha do registro fica no log do servidor para a coordenação.
          this.log.warn(
            `Conflito do leito ${l.chave} não registrado: ${x instanceof Error ? x.message : String(x)}`,
          );
        }
      }
    return m;
  }

  @Get('eventos')
  @Permissao('leitos.mapa.ler')
  eventos(
    @Req() req: RequisicaoAutorizada & RequisicaoBrutaAtendimento,
    @Res() res: RespostaEventosAtendimento,
  ): void {
    if (!this.avisos) throw new ErroProblema('indisponivel', 503, 'Avisos de mudança indisponíveis');
    this.avisos.abrirCanal(
      req,
      res,
      sessaoDe(req).hospital,
      'leitos.mapa.ler',
      this.resolvedor,
      this.batidaMs,
    );
  }

  @Post('transferencias')
  @HttpCode(200)
  @Permissao('leitos.transferencia.criar')
  @AuditadoNoHandler('internacao.transferirLeito pelo executor (trilha na mesma transação)')
  async transferir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoInternacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaTransferirLeito, b);
    const l = await this.servico.leitoNoMapa(
      ctxAdt(s),
      e.destino,
      await intensivasDe(this.cfg16, s),
      e.solicitacaoNir ?? null,
    );
    if (!l.admissivel)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Leito indisponível',
        l.motivo ?? 'Escolha outro leito.',
        {
          codigo: l.situacao === 'ocupado' ? 'leito-ocupado' : 'leito-indisponivel',
          campos: ['destino'],
        },
      );
    await this.servico.exigirCompativel(ctxAdt(s), l, { reg: e.internacao }, 'destino');
    return this.avisar(
      s,
      this.apoios.mapa.executar(
        s,
        'internacao.transferirLeito',
        e,
        'Paciente transferido de leito.',
      ) as Promise<ResultadoInternacao>,
    );
  }

  @Post('estados')
  @HttpCode(201)
  @Permissao('leitos.bloqueio.criar')
  @AuditadoNoHandler('estado do leito (SGH_INT_LEITO_ESTADO) com a SGH_TRILHA na mesma transação')
  async bloquear(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoInternacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaBloquearLeito, b);
    const l = await this.servico.leitoNoMapa(ctxAdt(s), e.leito, await intensivasDe(this.cfg16, s));
    // O bloqueio e o leito extra pedem o leito livre; a precaução vale para o leito ocupado (o paciente em isolamento).
    if (e.estado !== 'precaucao' && l.situacao !== 'livre')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Leito indisponível',
        'Só o leito livre é bloqueado ou vira extra.',
        {
          codigo: 'leito-nao-livre',
          campos: ['leito'],
        },
      );
    const id = await this.apoios.mapa.sgh(
      s,
      EVENTOS_AUDITAVEIS.leitosLeitoBloqueado.codigo,
      'leitos.bloqueio.criar',
      (x: number) => ({ tabela: 'SGH_INT_LEITO_ESTADO', id: String(x), chave: chaveTextoLeito(e.leito) }),
      (g) =>
        g.abrirEstadoLeito({
          leito: e.leito,
          estado: e.estado,
          motivo: e.motivo ?? null,
          precaucao: e.precaucao ?? null,
          previsaoFim: e.previsaoFim ?? null,
          observacao: e.observacao ?? null,
          usuario: s.login,
        }),
    );
    this.avisos?.avisar(s.hospital);
    const msg =
      e.estado === 'bloqueio'
        ? 'Leito bloqueado no novo.'
        : e.estado === 'precaucao'
          ? 'Precaução registrada.'
          : 'Leito extra registrado.';
    return { ok: true, resultado: { estado: id }, repetida: false, mensagem: msg };
  }

  @Post('estados/encerrar')
  @HttpCode(200)
  @Permissao('leitos.bloqueio.criar')
  @AuditadoNoHandler('fim do estado do leito (SGH_INT_LEITO_ESTADO) com a SGH_TRILHA na mesma transação')
  async encerrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoInternacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEncerrarEstadoLeito, b);
    const n = await this.apoios.mapa.sgh(
      s,
      EVENTOS_AUDITAVEIS.leitosLeitoBloqueado.codigo,
      'leitos.bloqueio.criar',
      { tabela: 'SGH_INT_LEITO_ESTADO', chave: chaveTextoLeito(e.leito) },
      (g) => g.encerrarEstadoLeito({ leito: e.leito, estado: e.estado, usuario: s.login }),
    );
    if (n === 0)
      throw new ErroProblema('recusa-de-negocio', 409, 'Nada a encerrar', 'O leito não está nesse estado.', {
        codigo: 'estado-inexistente',
      });
    this.avisos?.avisar(s.hospital);
    return {
      ok: true,
      resultado: { encerrados: n },
      repetida: false,
      mensagem: 'Estado do leito encerrado.',
    };
  }

  @Post('estados/alterar')
  @HttpCode(200)
  @Permissao('leitos.bloqueio.criar')
  @AuditadoNoHandler(
    'alteração do estado do leito (SGH_INT_LEITO_ESTADO) com a SGH_TRILHA na mesma transação',
  )
  async alterarEstado(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoInternacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlterarEstadoLeito, b);
    const id = await this.apoios.mapa.sgh(
      s,
      EVENTOS_AUDITAVEIS.leitosLeitoBloqueado.codigo,
      'leitos.bloqueio.criar',
      { tabela: 'SGH_INT_LEITO_ESTADO', chave: `${chaveTextoLeito(e.leito)}:alterar` },
      (g) =>
        g.alterarEstadoLeito({
          leito: e.leito,
          estado: e.estado,
          ...(e.motivo !== undefined ? { motivo: e.motivo } : {}),
          ...(e.precaucao !== undefined ? { precaucao: e.precaucao } : {}),
          ...(e.previsaoFim !== undefined ? { previsaoFim: e.previsaoFim } : {}),
          ...(e.observacao !== undefined ? { observacao: e.observacao } : {}),
          justificativa: e.justificativa,
          usuario: s.login,
        }),
    );
    this.avisos?.avisar(s.hospital);
    return { ok: true, resultado: { estado: id }, repetida: false, mensagem: 'Estado do leito alterado.' };
  }

  @Post('atributos/limpar')
  @HttpCode(200)
  @Permissao('leitos.bloqueio.criar')
  @AuditadoNoHandler(
    'limpeza dos atributos do leito (SGH_INT_LEITO_ATRIBUTO) com a SGH_TRILHA na mesma transação',
  )
  async limparAtributos(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoInternacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaLimparAtributosLeito, b);
    const chave = chaveTextoLeito(e.leito);
    await this.apoios.mapa.sgh(
      s,
      EVENTOS_AUDITAVEIS.leitosAtributoAlterado.codigo,
      'leitos.bloqueio.criar',
      { tabela: 'SGH_INT_LEITO_ATRIBUTO', chave: `${chave}:limpar` },
      (g) => g.limparAtributos({ escopo: 'leito', chave, justificativa: e.justificativa, usuario: s.login }),
    );
    this.avisos?.avisar(s.hospital);
    return {
      ok: true,
      resultado: { leito: chave },
      repetida: false,
      mensagem: 'Atributos do leito limpos: vale o padrão.',
    };
  }

  @Post('atributos')
  @HttpCode(200)
  @Permissao('leitos.bloqueio.criar')
  @AuditadoNoHandler('atributos do leito (SGH_INT_LEITO_ATRIBUTO) com a SGH_TRILHA na mesma transação')
  async atributos(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoInternacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAtributoLeito, b);
    if (e.idadeMinima !== undefined && e.idadeMaxima !== undefined && e.idadeMinima > e.idadeMaxima)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Faixa de idade inválida',
        'A idade mínima passa da máxima.',
        {
          campos: ['idadeMinima', 'idadeMaxima'],
        },
      );
    const chave = chaveTextoLeito(e.leito);
    await this.apoios.mapa.sgh(
      s,
      EVENTOS_AUDITAVEIS.leitosAtributoAlterado.codigo,
      'leitos.bloqueio.criar',
      { tabela: 'SGH_INT_LEITO_ATRIBUTO', chave },
      (g) =>
        g.gravarAtributo({
          escopo: 'leito',
          chave,
          andar: e.andar ?? null,
          sexo: e.sexo,
          idadeMinima: e.idadeMinima ?? null,
          idadeMaxima: e.idadeMaxima ?? null,
          criticidade: e.criticidade ?? null,
          ramal: e.ramal ?? null,
          motivo: e.motivo ?? null,
          usuario: s.login,
        }),
    );
    this.avisos?.avisar(s.hospital);
    return {
      ok: true,
      resultado: { leito: chave },
      repetida: false,
      mensagem: 'Atributos do leito gravados.',
    };
  }

  @Post('etiqueta')
  @HttpCode(201)
  @Permissao('leitos.bloqueio.criar')
  @AuditadoNoHandler('etiqueta do leito (QR code da limpeza) com a linha na trilha')
  async etiqueta(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ImpressoGerado> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEmitirEtiquetaLeito, b);
    const l = await this.servico.leitoNoMapa(ctxAdt(s), e.leito, await intensivasDe(this.cfg16, s));
    // O endereço da tela de solicitação de limpeza com o leito (a câmera do celular abre já com ele): a origem da
    // própria aplicação que pediu (o mesmo endereço em que a equipe entra); nada do paciente.
    const url = `${origemDaAplicacao(s.req.headers)}/higienizacao/solicitacoes?leito=${encodeURIComponent(l.chave)}&origem=qrcode`;
    let um: string;
    try {
      um = zplEtiquetaLeito({ rotulo: `${l.leito.bloco} ${l.leito.acomodacao} ${l.leito.leito}`, url });
    } catch (x) {
      if (x instanceof ErroZpl)
        throw new ErroProblema('recusa-de-negocio', 409, 'Etiqueta indisponível', x.message, {
          codigo: 'impresso-indisponivel',
        });
      throw x;
    }
    const conteudo = um.replace('^PQ1', `^PQ${e.copias}`);
    const nomeArquivo = `leito-${l.chave.replace(/[^A-Za-z0-9-]/g, '-')}.zpl`;
    let fila: ImpressoGerado['fila'] = null;
    const fonte = this.documento;
    if (fonte) {
      const chave = s.req.headers['idempotency-key'];
      const k = Array.isArray(chave) ? chave[0] : chave;
      if (typeof k !== 'string' || k.length < 8)
        throw new ErroProblema(
          'entrada-invalida',
          400,
          'Pedido incompleto',
          'Falta a Idempotency-Key do pedido de impressão.',
        );
      try {
        fila = await enfileirarZpl(
          {
            chaveIdempotencia: k,
            rede: s.rede || 'rede',
            estabelecimento: s.hospital,
            estacao: estacaoDaRequisicao(s.req)
              .replace(/[^A-Za-z0-9._-]/g, '-')
              .slice(0, 64),
            modelo: 'etiqueta-leito',
            zpl: conteudo,
          },
          fonte.armazem,
          fonte.destino,
          fonte.novoId,
        );
      } catch {
        throw new ErroProblema(
          'indisponivel',
          503,
          'Fila de impressão indisponível',
          'Não foi possível mandar à impressora da estação agora: tente de novo.',
        );
      }
    }
    await this.trilha.registrar({
      evento: EVENTOS_AUDITAVEIS.internacaoImpressoEmitido.codigo,
      rede: s.rede,
      hospital: s.hospital,
      usuario: s.login,
      estacao: estacaoDaRequisicao(s.req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(s.req, 'etiqueta-leito').slice(0, 64),
      recurso: 'leitos.etiqueta',
      resultado: 'sucesso',
      tabelaAlvo: 'RILEITOS',
      idAlvo: l.chave,
      chaveNaturalAlvo: `etiqueta-leito:${e.copias}:${createHash('sha256').update(conteudo).digest('hex').slice(0, 16)}`,
    });
    return { impresso: 'etiqueta-leito', formato: 'zpl', conteudo, nomeArquivo, fila };
  }

  @Get('historico')
  @Permissao('leitos.mapa.ler')
  @Auditar(EVENTOS_AUDITAVEIS.leitosConsultados.codigo)
  async historico(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<HistoricoOcupacao> {
    const s = sessaoDe(req);
    const { hoje } = await this.porta.relogio(ctxAdt(s));
    const fim = dataDaConsulta(q['fim']) ?? hoje;
    const ini =
      dataDaConsulta(q['inicio']) ??
      new Date(Date.parse(`${fim}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
    if (ini > fim || Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${ini}T00:00:00Z`) > 366 * 86_400_000)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Período inválido',
        'Escolha um período de até 366 dias.',
        {
          campos: ['inicio', 'fim'],
        },
      );
    return this.porta.historico(ctxAdt(s), {
      inicio: ini,
      fim,
      ...(q['bloco']?.trim() ? { bloco: q['bloco'].trim().slice(0, 5) } : {}),
      pagina: pagina(q['pagina']),
      porPagina: 50,
    });
  }
}

/**
 * A origem da aplicação que pediu a etiqueta (o cabeçalho Origin do navegador; sem ele, o Host da requisição), para o QR
 * levar o endereço em que a equipe já entra. Só esquema http(s) e host com letras, números, ponto, hífen e porta.
 */
export function origemDaAplicacao(h: Record<string, string | string[] | undefined>): string {
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const origem = um(h['origin']).trim();
  if (/^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(origem)) return origem;
  const host = um(h['x-forwarded-host']) || um(h['host']);
  const proto = um(h['x-forwarded-proto']) === 'http' ? 'http' : 'https';
  if (/^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(host.trim())) return `${proto}://${host.trim()}`;
  throw new ErroProblema(
    'entrada-invalida',
    400,
    'Endereço da aplicação desconhecido',
    'Não foi possível montar o endereço do QR code: abra o mapa pelo endereço da aplicação.',
  );
}
