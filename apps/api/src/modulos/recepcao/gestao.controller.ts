// Gestão da recepção (M19; ficha, seção 7): painel do supervisor, indicadores, a fila de cada gerador (só do novo),
// os dispositivos do perfil Painel/Totem (o token sai uma vez) e a lista dos painéis de TV de setores:
//   GET  /api/recepcao/supervisor[?recepcao]               recepcao.supervisor.ler
//   GET  /api/recepcao/indicadores?de&ate[&recepcao]        recepcao.indicador.ler (366 dias no máximo)
//   PUT  /api/recepcao/filas/:gerador                       recepcao.gerador.editar (gerador_senha)
//   GET  /api/recepcao/dispositivos                         recepcao.dispositivo.ler (sem token)
//   POST /api/recepcao/dispositivos                         recepcao.dispositivo.editar (o token sai uma vez)
//   PUT  /api/recepcao/dispositivos/:id                     recepcao.dispositivo.editar (W1-04: nome, conteúdo,
//                                                           locais, recepção; o token NÃO é reemitido)
//   POST /api/recepcao/dispositivos/:id/renovar|revogar     recepcao.dispositivo.editar
//   POST /api/recepcao/dispositivos/:id/conferir            recepcao.dispositivo.editar (M43: login substituído e
//                                                           conferência no setor; regra 4)
//   GET  /api/recepcao/usuarios-tecnicos                    recepcao.dispositivo.editar (o usuário técnico do totem)
//   GET  /api/recepcao/paineis-tv                           relatorio.painel.ler (os painéis de setor do outro sistema)
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  definicaoParametro,
  type DispositivoCriado,
  type DispositivoLido,
  esquemaConsultaIndicadoresRecepcao,
  esquemaAlterarDispositivoRecepcao,
  esquemaDispositivo,
  esquemaConferirDispositivo,
  esquemaFilaConfig,
  EVENTOS_AUDITAVEIS,
  type IndicadoresRecepcao,
  type PainelSupervisor,
  type PainelTvLido,
  recusaCamposDispositivo,
} from '@sgh/contratos';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import type { DispositivoRecepcao } from './tipos.js';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioRecepcao } from './apoio.js';
import { PORTA_RECEPCAO, type PortaRecepcao } from './porta.js';
import { corpo, inteiroDaConsulta } from './recepcao.controller.js';
import { ServicoRecepcao } from './servico.js';

/** Máximo de dias dos indicadores por consulta (ficha, seção 4). */
export const DIAS_INDICADORES = 366;

const esquemaValidade = z.object({ validadeDias: z.number().int().min(1).max(730) }).strict();

/** O conteúdo do painel de TV de setor pelo nome do painel do outro sistema (só para sugerir). */
function conteudoDoNome(nome: string): PainelTvLido['conteudo'] {
  const n = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (/HIGIENIZ/.test(n)) return 'higienizacao';
  if (/CIRURG|BLOCO/.test(n)) return 'bloco';
  if (/UTI|ANDAR|LEITO|INTERNA/.test(n)) return 'leitos';
  return 'outro';
}

export function dispositivoParaTela(d: DispositivoRecepcao): DispositivoLido {
  return {
    id: d.id,
    tipo: d.tipo,
    nome: d.nome,
    recepcao: d.recepcao,
    locais: d.locais,
    geradores: d.geradores,
    conteudo: d.conteudo,
    portalOrdem: d.portalOrdem,
    usuarioLegado: d.usuarioTecnico,
    voz: d.voz,
    criadoEm: d.criadoEm,
    criadoPor: d.criadoPor,
    validoAte: d.validoAte,
    revogadoEm: d.revogadoEm,
    ultimoUso: d.ultimoUso,
    prefixo: d.prefixo,
    loginSubstituido: d.loginSubstituido ?? null,
    conferidoEm: d.conferidoEm ?? null,
    conferidoPor: d.conferidoPor ?? null,
  };
}

/** Endereço da tela do aparelho (o token vai no fragmento #token=, que não chega ao servidor). */
export const enderecoDoAparelho = (tipo: string, id: number, conteudo?: string | null): string =>
  // M46 (etapa 2): a TV do bloco para familiares abre o painel próprio (código, etapa e horário).
  tipo === 'paineltv' && conteudo === 'bloco'
    ? `/paineis/bloco-familia/${id}`
    : `/${tipo === 'totem' ? 'totem' : tipo === 'paineltv' ? 'paineis' : 'painel'}/${id}`;

@Controller('recepcao')
export class GestaoRecepcaoController {
  private readonly apoio: ApoioRecepcao;
  private readonly servico: ServicoRecepcao;
  constructor(
    @Inject(PORTA_RECEPCAO) private readonly porta: PortaRecepcao,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioRecepcao(porta, trilha, configuracao, cache);
    this.servico = new ServicoRecepcao(porta);
  }

  /** Parâmetro do novo resolvido para a sessão (unidade, estabelecimento, rede). */
  private async parametro(s: SessaoCadastro, chave: string): Promise<number> {
    const def = definicaoParametro(chave);
    if (!def) return 0;
    let valores: Awaited<ReturnType<FonteConfiguracao['valoresParametro']>>;
    try {
      valores = this.configuracao ? await this.configuracao.valoresParametro(s.rede, s.hospital) : [];
    } catch {
      valores = [];
    }
    const setor = s.req.sgh?.sessao.unidadeAtiva;
    const v = valorTipado(
      def,
      resolverParametro(
        def,
        valores,
        {
          rede: s.rede,
          empresa: null,
          estabelecimento: s.hospital,
          unidade: setor === null || setor === undefined ? null : String(setor),
          perfis: [],
          usuario: s.login,
        },
        new Date(),
      ).valor,
    );
    return typeof v === 'number' ? v : Number(v ?? 0) || 0;
  }

  @Get('supervisor')
  @Permissao('recepcao.supervisor.ler')
  async supervisor(
    @Req() req: RequisicaoAutorizada,
    @Query('recepcao') rec?: string,
  ): Promise<PainelSupervisor> {
    const s = sessaoDe(req);
    const alvo = await this.parametro(s, 'recepcao.tempoAlvoEsperaMinutos');
    return this.servico.supervisor(s.porta, inteiroDaConsulta(rec), alvo);
  }

  @Get('indicadores')
  @Permissao('recepcao.indicador.ler')
  @Auditar(EVENTOS_AUDITAVEIS.indicadoresConsultados.codigo)
  indicadores(
    @Req() req: RequisicaoAutorizada,
    @Query() q: Record<string, string>,
  ): Promise<IndicadoresRecepcao> {
    const r = esquemaConsultaIndicadoresRecepcao.safeParse(q);
    if (!r.success)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'Informe de e até (AAAA-MM-DD).');
    const dias = (Date.parse(r.data.ate) - Date.parse(r.data.de)) / 86_400_000;
    if (!(dias >= 0) || dias >= DIAS_INDICADORES)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Período inválido',
        `O período vai de 1 a ${DIAS_INDICADORES} dias.`,
      );
    return this.servico.indicadores(sessaoDe(req).porta, r.data.de, r.data.ate, r.data.recepcao || null);
  }

  @Put('filas/:gerador')
  @Permissao('recepcao.gerador.editar')
  @AuditadoNoHandler('configuração da fila (gerador_senha) com a trilha na mesma transação')
  async fila(@Param('gerador') g: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaFilaConfig, { ...((b ?? {}) as object), gerador: idDaRota(g) });
    const recepcoes = await this.porta.recepcoes(s.porta);
    const ger = recepcoes.flatMap((r) => r.geradores).find((x) => x.id === e.gerador);
    if (!ger) throw new ErroProblema('nao-encontrado', 404, 'Gerador não encontrado');
    await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.recepcaoFilaConfigurada.codigo,
      'recepcao.gerador',
      { tabela: 'gerador_senha', id: String(e.gerador) },
      (gr) =>
        gr.gravarFilaCfg({
          gerador: e.gerador,
          recepcao: ger.recepcao,
          ordem: e.ordem,
          intercalar: e.intercalar,
          tempoAlvoMinutos: e.tempoAlvoMinutos,
          rotuloTotem: e.rotuloTotem,
          noTotem: e.noTotem,
          usuario: s.login,
        }),
    );
    return { ok: true as const, mensagem: 'Fila do serviço gravada.' };
  }

  @Get('dispositivos')
  @Permissao('recepcao.dispositivo.ler')
  async dispositivos(@Req() req: RequisicaoAutorizada): Promise<DispositivoLido[]> {
    return (await this.porta.dispositivos(sessaoDe(req).porta)).map(dispositivoParaTela);
  }

  @Get('usuarios-tecnicos')
  @Permissao('recepcao.dispositivo.editar')
  async usuariosTecnicos(@Req() req: RequisicaoAutorizada): Promise<string[]> {
    return this.porta.usuariosTecnicos(sessaoDe(req).porta);
  }

  @Post('dispositivos')
  @HttpCode(201)
  @Permissao('recepcao.dispositivo.editar')
  @AuditadoNoHandler('dispositivo do perfil Painel/Totem com a trilha na mesma transação')
  async criar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<DispositivoCriado> {
    const s = sessaoDe(req);
    const e = corpo(esquemaDispositivo, b);
    if (e.tipo === 'totem' && e.usuarioLegado) {
      const tecnicos = await this.porta.usuariosTecnicos(s.porta);
      if (!tecnicos.includes(e.usuarioLegado))
        throw new ErroProblema(
          'entrada-invalida',
          400,
          'Usuário técnico inválido',
          'Escolha um usuário técnico do grupo dos painéis e totens.',
          { campos: ['usuarioLegado'] },
        );
    }
    const r = await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.recepcaoDispositivoAlterado.codigo,
      'recepcao.dispositivo',
      (x: { id: number }) => ({
        tabela: 'dispositivo_recepcao',
        id: String(x.id),
        chave: `criado:${e.tipo}`,
      }),
      (g) =>
        g.criarDispositivo({
          tipo: e.tipo,
          nome: e.nome,
          recepcao: e.recepcao,
          locais: e.locais,
          geradores: e.geradores,
          conteudo: e.conteudo,
          portalOrdem: e.portalOrdem,
          usuarioTecnico: e.tipo === 'totem' ? e.usuarioLegado : null,
          voz: e.voz,
          validadeDias: e.validadeDias,
          usuario: s.login,
        }),
    );
    const d = (await this.porta.dispositivos(s.porta)).find((x) => x.id === r.id);
    if (!d) throw new ErroProblema('erro-interno', 500, 'Dispositivo não relido');
    return {
      ...dispositivoParaTela(d),
      token: r.token,
      endereco: enderecoDoAparelho(e.tipo, r.id, e.conteudo),
    };
  }

  @Put('dispositivos/:id')
  @Permissao('recepcao.dispositivo.editar')
  @AuditadoNoHandler('dispositivo do perfil Painel/Totem com a trilha na mesma transação')
  async alterar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DispositivoLido> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const e = corpo(esquemaAlterarDispositivoRecepcao, b);
    const atual = (await this.porta.dispositivos(s.porta)).find((x) => x.id === n);
    if (!atual) throw new ErroProblema('nao-encontrado', 404, 'Dispositivo não encontrado');
    const problema = recusaCamposDispositivo(atual.tipo, e);
    if (problema)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', problema[1], {
        campos: [problema[0]],
      });
    await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.recepcaoDispositivoAlterado.codigo,
      'recepcao.dispositivo',
      { tabela: 'dispositivo_recepcao', id: String(n), chave: 'alterado' },
      (g) =>
        g.alterarDispositivo({
          id: n,
          nome: e.nome,
          recepcao: e.recepcao,
          locais: e.locais,
          geradores: atual.tipo === 'totem' ? e.geradores : [],
          conteudo: atual.tipo === 'paineltv' ? e.conteudo : null,
          voz: e.voz,
        }),
    );
    const d = (await this.porta.dispositivos(s.porta)).find((x) => x.id === n);
    if (!d) throw new ErroProblema('nao-encontrado', 404, 'Dispositivo não encontrado');
    return dispositivoParaTela(d);
  }

  @Post('dispositivos/:id/renovar')
  @HttpCode(201)
  @Permissao('recepcao.dispositivo.editar')
  @AuditadoNoHandler('dispositivo do perfil Painel/Totem com a trilha na mesma transação')
  async renovar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DispositivoCriado> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const e = corpo(esquemaValidade, b);
    const token = await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.recepcaoDispositivoAlterado.codigo,
      'recepcao.dispositivo',
      { tabela: 'dispositivo_recepcao', id: String(n), chave: 'renovado' },
      (g) => g.renovarDispositivo({ id: n, validadeDias: e.validadeDias }),
    );
    const d = (await this.porta.dispositivos(s.porta)).find((x) => x.id === n);
    if (!d) throw new ErroProblema('nao-encontrado', 404, 'Dispositivo não encontrado');
    return { ...dispositivoParaTela(d), token, endereco: enderecoDoAparelho(d.tipo, n, d.conteudo) };
  }

  @Post('dispositivos/:id/revogar')
  @HttpCode(201)
  @Permissao('recepcao.dispositivo.editar')
  @AuditadoNoHandler('dispositivo do perfil Painel/Totem com a trilha na mesma transação')
  async revogar(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.recepcaoDispositivoAlterado.codigo,
      'recepcao.dispositivo',
      { tabela: 'dispositivo_recepcao', id: String(n), chave: 'revogado' },
      (g) => g.revogarDispositivo({ id: n, usuario: s.login }),
    );
    return { ok: true as const, mensagem: 'Dispositivo revogado: o token deixou de valer.' };
  }

  /**
   * M43 (regra 4; cap-08 §8.3): a TI conferiu no setor que o aparelho mostra a tela com o token e registra o login de
   * TV ou de totem que ele substitui (um login livre do grupo de painéis). Só depois o login pode ser bloqueado.
   */
  @Post('dispositivos/:id/conferir')
  @HttpCode(201)
  @Permissao('recepcao.dispositivo.editar')
  @AuditadoNoHandler('dispositivo do perfil Painel/Totem com a trilha na mesma transação')
  async conferir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const e = corpo(esquemaConferirDispositivo, b);
    const paineis = await this.porta.usuariosTecnicos(s.porta);
    const login = paineis.find((x) => x.toUpperCase() === e.loginSubstituido.toUpperCase());
    if (!login)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Login inválido',
        'Escolha um login livre do grupo dos painéis e totens.',
        { campos: ['loginSubstituido'] },
      );
    await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.recepcaoDispositivoAlterado.codigo,
      'recepcao.dispositivo',
      { tabela: 'dispositivo_recepcao', id: String(n), chave: `conferido:${login}` },
      (g) => g.conferirDispositivo({ id: n, loginSubstituido: login, usuario: s.login }),
    );
    const d = (await this.porta.dispositivos(s.porta)).find((x) => x.id === n);
    if (!d) throw new ErroProblema('nao-encontrado', 404, 'Dispositivo não encontrado');
    return dispositivoParaTela(d);
  }

  @Get('paineis-tv')
  @Permissao('relatorio.painel.ler')
  async paineisTv(@Req() req: RequisicaoAutorizada): Promise<PainelTvLido[]> {
    return (await this.porta.paineisTv(sessaoDe(req).porta)).map((p) => ({
      id: p.config,
      ordem: p.ordem,
      nome: p.nome,
      conteudo: conteudoDoNome(p.nome),
    }));
  }
}
