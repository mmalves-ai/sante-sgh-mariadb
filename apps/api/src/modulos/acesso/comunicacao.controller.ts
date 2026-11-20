// Página inicial, central de avisos, mensagens internas, comunicados e dicionário pessoal (M27; ficha, seções 4, 7 e 8):
//   GET    /api/acesso/inicio                        os componentes da página inicial que a sessão vê (permissão do
//                                                    módulo de origem, funcionalidade ligada, fila entregue) e os perfis
//   GET    /api/acesso/avisos                        a central de avisos (o sino)
//   GET    /api/acesso/avisos/eventos                canal de eventos: "mudou" depois de cada COMMIT (o cliente relê)
//   POST   /api/acesso/avisos/:id/lido | resolver    o estado do próprio aviso
//   GET    /api/acesso/mensagens                     recebidas, enviadas, não lidas e ciências pendentes
//   GET    /api/acesso/mensagens/:id                 abre a mensagem (a primeira abertura marca a leitura)
//   POST   /api/acesso/mensagens                     envia (usuários, grupos, setores, unidades; contexto do paciente)
//   POST   /api/acesso/mensagens/:id/ciencia         dá ciência
//   POST   /api/acesso/comunicados                   publica comunicado com vigência (gestor)
//   GET    /api/acesso/comunicados/:id               o comunicado com as ciências e os eventos (W0-09)
//   PUT    /api/acesso/comunicados/:id               corrige o texto não lido, com motivo (lido: 409; W0-09)
//   POST   /api/acesso/comunicados/:id/vigencia      encurta a vigência, com motivo (W0-09)
//   POST   /api/acesso/comunicados/:id/encerramento  encerra com motivo; continua visível com as ciências (W0-09)
//   GET    /api/acesso/mensagens-anteriores          as próprias mensagens do sistema anterior (só consulta)
//   GET    /api/acesso/dicionario                    as palavras do próprio dicionário (o mesmo nos dois sistemas)
//   POST   /api/acesso/dicionario                    inclui (acesso.incluirPalavraDicionario)
//   DELETE /api/acesso/dicionario/:palavra           exclui (acesso.excluirPalavraDicionario)
// Cada componente tem a sua chave de liberação (SGH_CFG_LIBERACAO): desligada, a leitura responde 403
// `recurso-desligado` e a página inicial esconde o componente.
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  type OnModuleDestroy,
  Optional,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import {
  type CaixaMensagens,
  type CentralAvisos,
  CHAVES_INICIO,
  type ComponenteInicio,
  type ComunicadoDetalhe,
  DEFINICOES_COMPONENTES_INICIO,
  type DicionarioPessoal,
  esquemaCorrigirComunicado,
  esquemaEncerrarComunicado,
  esquemaEnviarMensagem,
  esquemaPalavraDicionario,
  esquemaPublicarComunicado,
  esquemaVigenciaComunicado,
  EVENTOS_AUDITAVEIS,
  type MensagemAnterior,
  type MensagemRecebida,
  type PaginaInicio,
  PERMISSOES_ACESSO,
  PERMISSOES_INICIO,
} from '@sgh/contratos';
import type { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  AvisosAtendimento,
  type RequisicaoBrutaAtendimento,
  type RespostaEventosAtendimento,
} from '../atendimento/avisos.js';
import { contextoOperacao, problemaDoCadastro, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { BATIDA_EVENTOS_MS, BATIDA_EVENTOS_PADRAO_MS } from '../internacao/public-api.js';
import { LiberacaoPep } from '../pep/public-api.js';
import { type AutorComunicacao, chaveDoCanal, ServicoComunicacao } from './aplicacao/comunicacao.js';
import { PORTA_COMUNICACAO, type PortaComunicacao } from './comunicacao-porta.js';

export const AVISOS_INICIO = Symbol('AVISOS_INICIO');
export const SERVICO_COMUNICACAO = Symbol('SERVICO_COMUNICACAO');

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,64}$/;

function idDaRota(v: string): number {
  if (!/^\d{1,15}$/.test(v) || Number(v) <= 0)
    throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
  return Number(v);
}

/** O esquema dos contratos; a primeira mensagem vai ao detalhe (a do dado do paciente é a que orienta a tela). */
function validar<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const r = esquema.safeParse(corpo ?? {});
  if (r.success) return r.data;
  throw new ErroProblema(
    'entrada-invalida',
    400,
    'Dados inválidos',
    r.error.issues[0]?.message ?? 'Confira os campos indicados.',
    { campos: [...new Set(r.error.issues.map((i) => i.path.map(String).join('.') || '(entrada)'))] },
  );
}

const traduzir = (e: unknown): never => {
  throw problemaDoCadastro(e);
};

/** Quem abre o paciente de contexto: a permissão de leitura do prontuário (a tela do PEP confere o resto). */
const PERMISSAO_PRONTUARIO = 'pep.prontuario.ler';

/**
 * Revisão do M27 (regra 7): o identificador do paciente do contexto só vai a quem pode abrir o prontuário; os demais
 * veem a mensagem sem o link do paciente.
 */
function semPacienteSemAcesso(s: SessaoCadastro, m: MensagemRecebida): MensagemRecebida {
  return m.contextoPaciente === null || s.pode(PERMISSAO_PRONTUARIO) ? m : { ...m, contextoPaciente: null };
}

@Controller('acesso')
export class ComunicacaoController implements OnModuleDestroy {
  private readonly liberacao: LiberacaoPep;
  readonly servico: ServicoComunicacao;
  private readonly avisos: AvisosAtendimento;

  constructor(
    @Inject(PORTA_COMUNICACAO) porta: PortaComunicacao,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(AVISOS_INICIO) avisos: AvisosAtendimento | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(BATIDA_EVENTOS_MS) private readonly batidaMs: number = BATIDA_EVENTOS_PADRAO_MS,
  ) {
    this.avisos = avisos ?? new AvisosAtendimento(null);
    this.liberacao = new LiberacaoPep(configuracao, cache);
    this.servico = new ServicoComunicacao(porta, this.avisos);
  }

  onModuleDestroy(): void {
    this.avisos.fecharTodos();
  }

  private autor(s: SessaoCadastro, rotulo: string): AutorComunicacao {
    return {
      login: s.login,
      estacao: estacaoDaRequisicao(s.req),
      correlacao: correlacaoDaRequisicao(s.req, rotulo),
    };
  }

  private idempotencia(s: SessaoCadastro): string {
    const bruto = s.req.headers['idempotency-key'];
    const chave = Array.isArray(bruto) ? bruto[0] : bruto;
    if (typeof chave !== 'string' || !IDEMPOTENCIA.test(chave))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido incompleto',
        'Falta a Idempotency-Key do pedido de gravação.',
      );
    return chave;
  }

  // ── Página inicial ─────────────────────────────────────────────────────────────────────────────────

  @Get('inicio')
  @Permissao(PERMISSOES_ACESSO.inicioLer)
  async inicio(@Req() req: RequisicaoAutorizada): Promise<PaginaInicio> {
    const s = sessaoDe(req);
    const visiveis: { id: ComponenteInicio; titulo: string; rota: string; ordem: number }[] = [];
    for (const d of DEFINICOES_COMPONENTES_INICIO) {
      // Regra 1: só o que já foi entregue, com a permissão do módulo de origem e a funcionalidade ligada.
      if (!d.entregue || !s.pode(d.permissao)) continue;
      let ligada = true;
      for (const chave of d.chaves) if (!(await this.liberacao.consultar(s, chave)).ligada) ligada = false;
      if (ligada) visiveis.push({ id: d.id, titulo: d.titulo, rota: d.rota, ordem: d.ordem });
    }
    visiveis.sort((a, b) => a.ordem - b.ordem);
    return {
      perfis: visiveis
        .filter((v) => v.id === 'medico' || v.id === 'recepcao')
        .map((v) => ({ id: v.id, titulo: v.titulo })),
      componentes: visiveis.map((v) => ({
        id: v.id,
        titulo: v.titulo,
        rota: v.rota,
        pendentes: null,
        prioridade: 0,
        prazo: null,
      })),
    };
  }

  // ── Central de avisos ───────────────────────────────────────────────────────────────────────────────

  @Get('avisos')
  @Permissao(PERMISSOES_INICIO.avisoLer)
  async listarAvisos(@Req() req: RequisicaoAutorizada): Promise<CentralAvisos> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.avisos);
    return this.servico.avisos(s.porta, s.login, 0).catch(traduzir);
  }

  @Get('avisos/eventos')
  @Permissao(PERMISSOES_INICIO.avisoLer)
  eventosAvisos(
    @Req() req: RequisicaoAutorizada & RequisicaoBrutaAtendimento,
    @Res() res: RespostaEventosAtendimento,
  ): void {
    const s = sessaoDe(req);
    this.avisos.abrirCanal(
      req,
      res,
      chaveDoCanal(s.hospital, s.login),
      PERMISSOES_INICIO.avisoLer,
      this.resolvedor,
      this.batidaMs,
    );
  }

  @Post('avisos/:id/lido')
  @HttpCode(200)
  @Permissao(PERMISSOES_INICIO.avisoResolver)
  @AuditadoNoHandler('a mudança de estado vai à SGH_TRILHA na mesma transação SGH_')
  async avisoLido(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<{ mudou: boolean }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.avisos);
    const mudou = await this.servico
      .mudarAviso(s.porta, this.autor(s, 'aviso-lido'), idDaRota(id), 'lido')
      .catch(traduzir);
    return { mudou };
  }

  @Post('avisos/:id/resolver')
  @HttpCode(200)
  @Permissao(PERMISSOES_INICIO.avisoResolver)
  @AuditadoNoHandler('a mudança de estado vai à SGH_TRILHA na mesma transação SGH_')
  async avisoResolvido(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ mudou: boolean }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.avisos);
    const mudou = await this.servico
      .mudarAviso(s.porta, this.autor(s, 'aviso-resolvido'), idDaRota(id), 'resolvido')
      .catch(traduzir);
    return { mudou };
  }

  // ── Mensagens e comunicados ─────────────────────────────────────────────────────────────────────────

  @Get('mensagens')
  @Permissao(PERMISSOES_INICIO.mensagemLer)
  async caixa(@Req() req: RequisicaoAutorizada): Promise<CaixaMensagens> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.mensagens);
    const caixa = await this.servico.caixa(s.porta, s.login).catch(traduzir);
    return { ...caixa, recebidas: caixa.recebidas.map((m) => semPacienteSemAcesso(s, m)) };
  }

  @Get('mensagens-anteriores')
  @Permissao(PERMISSOES_INICIO.mensagemAnteriorLer)
  @Auditar(EVENTOS_AUDITAVEIS.mensagemAnteriorLida.codigo)
  async anteriores(
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ mensagens: MensagemAnterior[]; teto: number }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.mensagens);
    const mensagens = await this.servico.anteriores(s.porta, s.login).catch(traduzir);
    req.sghAlvo = { tabelaAlvo: 'TBMENSAG', chaveNaturalAlvo: `n:${mensagens.length}` };
    return { mensagens, teto: 100 };
  }

  @Get('mensagens/:id')
  @Permissao(PERMISSOES_INICIO.mensagemLer)
  async abrir(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<MensagemRecebida> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.mensagens);
    return semPacienteSemAcesso(
      s,
      await this.servico.abrir(s.porta, this.autor(s, 'mensagem-lida'), idDaRota(id)).catch(traduzir),
    );
  }

  @Post('mensagens')
  @HttpCode(201)
  @Permissao(PERMISSOES_INICIO.mensagemEnviar)
  @AuditadoNoHandler('o envio vai à SGH_TRILHA na mesma transação SGH_ (sem o texto)')
  async enviar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number; destinatarios: number; repetida: boolean }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.mensagens);
    const e = validar(esquemaEnviarMensagem, corpo);
    return this.servico
      .enviar(s.porta, this.autor(s, 'mensagem'), e, this.idempotencia(s), {
        podeLerProntuario: s.pode(PERMISSAO_PRONTUARIO),
      })
      .catch(traduzir);
  }

  @Post('mensagens/:id/ciencia')
  @HttpCode(200)
  @Permissao(PERMISSOES_INICIO.mensagemLer)
  @AuditadoNoHandler('a ciência vai à SGH_TRILHA na mesma transação SGH_')
  async ciencia(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<MensagemRecebida> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.mensagens);
    return semPacienteSemAcesso(
      s,
      await this.servico.ciencia(s.porta, this.autor(s, 'ciencia'), idDaRota(id)).catch(traduzir),
    );
  }

  @Post('comunicados')
  @HttpCode(201)
  @Permissao(PERMISSOES_INICIO.comunicadoPublicar)
  @AuditadoNoHandler('a publicação vai à SGH_TRILHA na mesma transação SGH_ (sem o texto)')
  async publicar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number; destinatarios: number; repetida: boolean }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.mensagens);
    const e = validar(esquemaPublicarComunicado, corpo);
    return this.servico
      .publicar(s.porta, this.autor(s, 'comunicado'), e, this.idempotencia(s))
      .catch(traduzir);
  }

  // ── W0-09: o ciclo de vida do comunicado (motivo obrigatório; lido ou com ciência não se edita) ─────────

  @Get('comunicados/:id')
  @Permissao(PERMISSOES_INICIO.comunicadoPublicar)
  async comunicado(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ComunicadoDetalhe> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.mensagens);
    return this.servico.comunicado(s.porta, idDaRota(id)).catch(traduzir);
  }

  @Put('comunicados/:id')
  @Permissao(PERMISSOES_INICIO.comunicadoPublicar)
  @AuditadoNoHandler('a correção vai à SGH_TRILHA na mesma transação SGH_ (sem o texto)')
  async corrigirComunicado(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ComunicadoDetalhe> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.mensagens);
    const e = validar(esquemaCorrigirComunicado, corpo);
    return this.servico
      .corrigirComunicado(s.porta, this.autor(s, 'comunicado-correcao'), idDaRota(id), e)
      .catch(traduzir);
  }

  @Post('comunicados/:id/vigencia')
  @HttpCode(200)
  @Permissao(PERMISSOES_INICIO.comunicadoPublicar)
  @AuditadoNoHandler('o encurtamento vai à SGH_TRILHA na mesma transação SGH_')
  async vigenciaComunicado(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ComunicadoDetalhe> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.mensagens);
    const e = validar(esquemaVigenciaComunicado, corpo);
    return this.servico
      .encurtarVigencia(s.porta, this.autor(s, 'comunicado-vigencia'), idDaRota(id), e)
      .catch(traduzir);
  }

  @Post('comunicados/:id/encerramento')
  @HttpCode(200)
  @Permissao(PERMISSOES_INICIO.comunicadoPublicar)
  @AuditadoNoHandler('o encerramento vai à SGH_TRILHA na mesma transação SGH_')
  async encerrarComunicado(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ComunicadoDetalhe> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.mensagens);
    const e = validar(esquemaEncerrarComunicado, corpo);
    return this.servico
      .encerrarComunicado(s.porta, this.autor(s, 'comunicado-encerramento'), idDaRota(id), e)
      .catch(traduzir);
  }

  // ── Dicionário pessoal ─────────────────────────────────────────────────────────────────────────────

  @Get('dicionario')
  @Permissao(PERMISSOES_INICIO.dicionarioLer)
  async dicionario(@Req() req: RequisicaoAutorizada): Promise<DicionarioPessoal> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.dicionario);
    return this.servico.dicionario(s.porta, s.login).catch(traduzir);
  }

  @Post('dicionario')
  @HttpCode(201)
  @Permissao(PERMISSOES_INICIO.dicionarioEditar)
  @AuditadoNoHandler('o executor grava a palavra e a trilha na mesma transação')
  async incluirPalavra(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ repetida: boolean }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.dicionario);
    const e = validar(esquemaPalavraDicionario, corpo);
    return this.servico
      .gravarPalavra(s.porta, 'incluir', e.palavra, contextoOperacao(s, 'dicionario-incluir'))
      .catch(traduzir);
  }

  @Delete('dicionario/:palavra')
  @HttpCode(200)
  @Permissao(PERMISSOES_INICIO.dicionarioEditar)
  @AuditadoNoHandler('o executor exclui a palavra e grava a trilha na mesma transação')
  async excluirPalavra(
    @Param('palavra') palavra: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ repetida: boolean }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.dicionario);
    const e = validar(esquemaPalavraDicionario, { palavra: decodeURIComponent(palavra) });
    return this.servico
      .gravarPalavra(s.porta, 'excluir', e.palavra, contextoOperacao(s, 'dicionario-excluir'))
      .catch(traduzir);
  }
}
