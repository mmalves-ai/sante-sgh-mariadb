// Internação e leitos (M16; ficha, seção 7):
//   GET /api/internacao/liberacao                          as chaves do M16 valem para esta sessão? (o menu esconde)
//   GET /api/internacao/leitos/painel[?abertura=1]         painel de leitos ao vivo; a trilha é decidida no servidor:
//                                                          a primeira leitura de cada sessão e estação numa janela de
//                                                          10 min vai à trilha (e a abertura da tela, sempre)
//   GET /api/internacao/leitos/eventos                     canal de eventos do vigia (text/event-stream): só avisa
//                                                          que mudou; a tela relê. A cada batida, a sessão e a
//                                                          permissão são reconferidas (encerrada ou retirada: fecha)
//   GET /api/internacao/leitos/painel/:internacao/paciente o nome do paciente do cartão (cadastro.paciente.ler; trilha)
//   GET /api/internacao/leitos/divergencias                cadastro de leitos × registro de conferência (regra 2)
//   GET /api/internacao/censo[?data]                       o dia em aberto, um dia fechado ou calculado
//   GET /api/internacao/censo/serie?de&ate&agrupamento     série por dia ou mês
//   GET /api/internacao/censo/exportar[?data|de&ate]       planilha (internacao.censo.exportar; trilha)
//   GET /api/internacao/censo/marcadas[/exportar]          internações marcadas no cálculo, para o arquivo médico
//                                                          corrigir (regra 5): número e marca; trilha
//   GET /api/integracao/vigia/saude                        saúde do vigia (cartão da tela de conexões)
// Só leitura: nada é gravado por estas rotas. Cada sessão lê o banco do seu estabelecimento (regra 18).
import {
  Controller,
  Get,
  Inject,
  type OnModuleDestroy,
  Optional,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type CensoDia,
  type DivergenciasLeitos,
  type InternacoesMarcadas,
  esquemaConsultaSerieCenso,
  EVENTOS_AUDITAVEIS,
  type LiberacaoM16,
  type PacienteDoLeito,
  type PainelLeitos,
  PERMISSOES_M16_CODIGOS,
  type SaudeVigia,
  type SerieCenso,
} from '@sgh/contratos';
import { createHash } from 'node:crypto';
import { criarAbility, pode, regrasDeAcesso } from '@sgh/dominio-acesso';
import { z } from 'zod';
import { Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { exigir, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import { BATIDA_EVENTOS_MS, BATIDA_EVENTOS_PADRAO_MS, CONFIGURACAO_M16 } from './simbolos.js';
import type { ConfiguracaoM16, SujeitoM16 } from './configuracao.js';
import {
  planilhaDaSerieCenso,
  planilhaDasMarcadas,
  planilhaDoCenso,
  type ServicoInternacao,
} from './servico.js';
import { SERVICO_INTERNACAO } from './simbolos.js';
import { MOTOR_VIGIA, type MotorVigia } from './vigia.js';

const C = PERMISSOES_M16_CODIGOS;
/** Rótulo de cada marca do cálculo na planilha do arquivo médico (os mesmos da tela do censo). */
const ROTULO_MARCA_CALCULO: Readonly<Record<string, string>> = {
  'alta-anterior-a-entrada': 'Alta anterior à entrada',
  'trecho-sem-internacao': 'Trecho de leito sem internação',
  'internacao-sem-trecho': 'Internação sem trecho de leito',
  'trecho-invertido': 'Trecho com saída anterior à entrada',
  'trecho-aberto-com-alta': 'Trecho em aberto com a alta dada',
  'trecho-alem-da-alta': 'Trecho que passa da alta',
  'entrada-no-futuro': 'Entrada no futuro',
};
const DATA = z.iso.date();
/** Janela da trilha do painel: a primeira leitura de cada sessão e estação nela vai à trilha (D-PRIV-1). */
export const JANELA_TRILHA_PAINEL_MS = 10 * 60_000;
/** Teto de entradas da janela na memória do processo (as vencidas saem primeiro). */
const TETO_JANELA_PAINEL = 5_000;

interface RespostaArquivo {
  header(nome: string, valor: string): RespostaArquivo;
}

interface RespostaEventos {
  hijack(): void;
  readonly raw: {
    writeHead(status: number, cabecalhos: Record<string, string>): void;
    write(texto: string): boolean;
    end(): void;
  };
}

interface RequisicaoBruta {
  readonly raw?: { on(evento: 'close', fn: () => void): void };
}

export function sujeitoDe(s: SessaoCadastro): SujeitoM16 {
  const setor = s.req.sgh?.sessao.unidadeAtiva;
  return {
    rede: s.rede,
    hospital: s.hospital,
    login: s.login,
    setor: setor ?? null,
    grupo: s.req.sgh?.sessao.grupoLegado ?? null,
  };
}

export const ctxM16 = (s: SessaoCadastro, origem: string) => ({
  rede: s.rede,
  hospital: s.hospital,
  traceId: correlacaoDaRequisicao(s.req, origem),
  porta: s.porta,
});

@Controller()
export class LeitosController implements OnModuleDestroy {
  /** Canais de eventos abertos (encerrados no desligamento, para o servidor fechar sem esperar). */
  private readonly abertos = new Set<{ end(): void }>();
  /** Última leitura do painel que foi à trilha, por sessão e estação (resumo da chave; nada de pessoa). */
  private readonly vistosPainel = new Map<string, number>();

  constructor(
    @Inject(SERVICO_INTERNACAO) private readonly servico: ServicoInternacao,
    @Inject(CONFIGURACAO_M16) private readonly cfg: ConfiguracaoM16,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(MOTOR_VIGIA) private readonly vigia: MotorVigia | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(BATIDA_EVENTOS_MS) private readonly batidaMs: number = BATIDA_EVENTOS_PADRAO_MS,
  ) {}

  /** Chave da janela da trilha do painel: sessão (pelo cookie, resumido) e estação. */
  private chaveJanela(s: SessaoCadastro): string {
    const id = this.resolvedor?.idSessao(s.req) ?? 'sem-cookie';
    const bruto = `${s.rede}|${s.hospital}|${s.login}|${estacaoDaRequisicao(s.req)}|${id}`;
    return createHash('sha256').update(bruto).digest('hex').slice(0, 32);
  }

  /** A leitura do painel vai à trilha? Sempre na abertura da tela; senão, a primeira da sessão na janela. */
  private marcarNaJanela(chave: string, abertura: boolean): boolean {
    const agora = Date.now();
    const ultima = this.vistosPainel.get(chave);
    if (!abertura && ultima !== undefined && agora - ultima < JANELA_TRILHA_PAINEL_MS) return false;
    if (this.vistosPainel.size >= TETO_JANELA_PAINEL)
      for (const [k, t] of this.vistosPainel)
        if (agora - t >= JANELA_TRILHA_PAINEL_MS || this.vistosPainel.size >= TETO_JANELA_PAINEL)
          this.vistosPainel.delete(k);
        else break;
    this.vistosPainel.delete(chave);
    this.vistosPainel.set(chave, agora);
    return true;
  }

  /** A sessão do canal de eventos ainda vale, com a permissão do painel? (Serviço fora do ar: segue até a próxima.) */
  private async sessaoDoCanalVale(req: RequisicaoAutorizada): Promise<boolean> {
    if (!this.resolvedor) return true;
    let r: Awaited<ReturnType<ResolvedorSessao['resolver']>>;
    try {
      r = await this.resolvedor.resolver(req);
    } catch {
      return true;
    }
    if (!r || r.sessao.bloqueada) return false;
    return pode(criarAbility(regrasDeAcesso(r.sessao.permissoes, r.sessao.escopos)), C.leitosLer);
  }

  private async registrar(
    s: SessaoCadastro,
    evento: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.trilha.registrar({
        evento,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req),
        correlacao: correlacaoDaRequisicao(s.req, evento.slice(0, 40)),
        recurso: 'internacao.leitos',
        resultado: 'sucesso',
        ...extra,
      });
    } catch {
      throw new ErroProblema(
        'trilha-indisponivel',
        503,
        'Trilha de auditoria indisponível',
        'A consulta não foi registrada; nada foi mostrado. Tente de novo em instantes.',
      );
    }
  }

  @Get('internacao/liberacao')
  @Permissao('acesso.inicio.ler')
  liberacao(@Req() req: RequisicaoAutorizada): Promise<LiberacaoM16> {
    return this.cfg.liberacao(sujeitoDe(sessaoDe(req)));
  }

  @Get('internacao/leitos/painel')
  @Permissao(C.leitosLer)
  async painel(
    @Req() req: RequisicaoAutorizada,
    @Query('abertura') abertura?: string,
  ): Promise<PainelLeitos> {
    const s = sessaoDe(req);
    await this.cfg.exigir(sujeitoDe(s), 'painel');
    const p = await this.servico.painel(ctxM16(s, 'painel-leitos'), await this.cfg.parametros(s));
    // Quem decide a trilha é o servidor (D-PRIV-1): a abertura da tela e a primeira leitura de cada sessão e
    // estação na janela vão à trilha; as releituras seguintes, disparadas pelo vigia, não (seriam uma linha a
    // cada mudança). Sem a trilha, nada é mostrado.
    const chave = this.chaveJanela(s);
    if (this.marcarNaJanela(chave, abertura === '1'))
      try {
        await this.registrar(s, EVENTOS_AUDITAVEIS.leitosConsultados.codigo);
      } catch (e) {
        this.vistosPainel.delete(chave);
        throw e;
      }
    return p;
  }

  @Get('internacao/leitos/eventos')
  @Permissao(C.leitosLer)
  async eventos(
    @Req() req: RequisicaoAutorizada & RequisicaoBruta,
    @Res() res: RespostaEventos,
  ): Promise<void> {
    const s = sessaoDe(req);
    await this.cfg.exigir(sujeitoDe(s), 'painel');
    if (!this.vigia) throw new ErroProblema('indisponivel', 503, 'Avisos de mudança indisponíveis');
    if (s.porta.estabelecimento === null)
      throw new ErroProblema('nao-autenticado', 401, 'Escolha o estabelecimento', 'A sessão não tem estabelecimento.');
    res.hijack();
    res.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    });
    res.raw.write('retry: 3000\n\n');
    const cancelar = this.vigia.assinar(s.porta, 'leitos', (e) =>
      res.raw.write(`event: mudanca\ndata: ${JSON.stringify(e)}\n\n`),
    );
    let fechado = false;
    const encerrar = () => {
      if (fechado) return;
      fechado = true;
      clearInterval(batida);
      cancelar();
      this.abertos.delete(res.raw);
    };
    // A batida mantém o caminho aberto nos proxies e reconfere a sessão e a permissão: sessão encerrada, vencida,
    // bloqueada ou sem a permissão do painel fecha o canal (o navegador reconecta e passa pela guarda de novo).
    const batida = setInterval(() => {
      void this.sessaoDoCanalVale(req).then((vale) => {
        if (fechado) return;
        if (vale) {
          res.raw.write(': batida\n\n');
          return;
        }
        encerrar();
        res.raw.end();
      });
    }, this.batidaMs);
    batida.unref?.();
    this.abertos.add(res.raw);
    req.raw?.on('close', encerrar);
  }

  onModuleDestroy(): void {
    for (const r of this.abertos) r.end();
    this.abertos.clear();
  }

  @Get('internacao/leitos/painel/:internacao/paciente')
  @Permissao(C.leitosLer)
  async paciente(
    @Req() req: RequisicaoAutorizada,
    @Param('internacao') bruto: string,
  ): Promise<PacienteDoLeito> {
    const s = sessaoDe(req);
    await this.cfg.exigir(sujeitoDe(s), 'painel');
    // Regra 16: o nome só com a permissão do cadastro de pacientes (a negação vai à trilha).
    await exigir(s, 'cadastro.paciente.ler', this.trilha);
    const reg = Number(bruto);
    if (!Number.isInteger(reg) || reg <= 0)
      throw new ErroProblema('entrada-invalida', 400, 'Internação inválida');
    const p = await this.servico.pacienteDaInternacao(ctxM16(s, 'painel-paciente'), reg);
    if (!p) throw new ErroProblema('nao-encontrado', 404, 'Internação em aberto não encontrada');
    await this.registrar(s, EVENTOS_AUDITAVEIS.pacienteDoLeitoAberto.codigo, {
      tabelaAlvo: 'RICADINT',
      idAlvo: String(reg),
    });
    return p;
  }

  @Get('internacao/leitos/divergencias')
  @Permissao(C.leitosLer)
  @Auditar(EVENTOS_AUDITAVEIS.leitosConsultados.codigo)
  async divergencias(@Req() req: RequisicaoAutorizada): Promise<DivergenciasLeitos> {
    const s = sessaoDe(req);
    await this.cfg.exigir(sujeitoDe(s), 'painel');
    return this.servico.divergencias(ctxM16(s, 'divergencias'));
  }

  @Get('internacao/censo')
  @Permissao(C.censoLer)
  @Auditar(EVENTOS_AUDITAVEIS.censoConsultado.codigo)
  async censo(@Req() req: RequisicaoAutorizada, @Query('data') data?: string): Promise<CensoDia> {
    const s = sessaoDe(req);
    await this.cfg.exigir(sujeitoDe(s), 'painel');
    if (data !== undefined && !DATA.safeParse(data).success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Data inválida',
        'Informe a data no formato AAAA-MM-DD.',
      );
    return this.servico.censo(ctxM16(s, 'censo'), await this.cfg.parametros(s), data);
  }

  @Get('internacao/censo/serie')
  @Permissao(C.censoLer)
  @Auditar(EVENTOS_AUDITAVEIS.censoConsultado.codigo)
  async serie(@Req() req: RequisicaoAutorizada, @Query() q: Record<string, string>): Promise<SerieCenso> {
    const s = sessaoDe(req);
    await this.cfg.exigir(sujeitoDe(s), 'painel');
    const r = esquemaConsultaSerieCenso.safeParse(q);
    if (!r.success)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'Informe de e até (AAAA-MM-DD).');
    return this.servico.serieCenso(
      ctxM16(s, 'censo-serie'),
      await this.cfg.parametros(s),
      r.data.de,
      r.data.ate,
      r.data.agrupamento,
    );
  }

  @Get('internacao/censo/exportar')
  @Permissao(C.censoExportar)
  @Auditar(EVENTOS_AUDITAVEIS.censoExportado.codigo)
  async exportar(
    @Req() req: RequisicaoAutorizada,
    @Query() q: Record<string, string>,
    @Res({ passthrough: true }) res: RespostaArquivo,
  ): Promise<string> {
    const s = sessaoDe(req);
    await this.cfg.exigir(sujeitoDe(s), 'painel');
    const p = await this.cfg.parametros(s);
    let corpo: string;
    let nome: string;
    if (q['de'] || q['ate']) {
      const r = esquemaConsultaSerieCenso.safeParse(q);
      if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Período inválido');
      corpo = planilhaDaSerieCenso(
        await this.servico.serieCenso(
          ctxM16(s, 'censo-exportar'),
          p,
          r.data.de,
          r.data.ate,
          r.data.agrupamento,
        ),
      );
      nome = `censo-${r.data.de}-${r.data.ate}.csv`;
    } else {
      if (q['data'] !== undefined && !DATA.safeParse(q['data']).success)
        throw new ErroProblema('entrada-invalida', 400, 'Data inválida');
      const c = await this.servico.censo(ctxM16(s, 'censo-exportar'), p, q['data']);
      corpo = planilhaDoCenso(c);
      nome = `censo-${c.data}.csv`;
    }
    res.header('content-type', 'text/csv; charset=utf-8');
    res.header('content-disposition', `attachment; filename="${nome}"`);
    return `\uFEFF${corpo}`;
  }

  @Get('internacao/censo/marcadas')
  @Permissao(C.censoLer)
  @Auditar(EVENTOS_AUDITAVEIS.censoMarcadasConsultadas.codigo)
  async marcadas(@Req() req: RequisicaoAutorizada): Promise<InternacoesMarcadas> {
    const s = sessaoDe(req);
    await this.cfg.exigir(sujeitoDe(s), 'painel');
    const m = await this.servico.internacoesMarcadas(
      ctxM16(s, 'censo-marcadas'),
      await this.cfg.parametros(s),
    );
    req.sghAlvo = { chaveNaturalAlvo: `casos:${m.casos.length}` };
    return m;
  }

  @Get('internacao/censo/marcadas/exportar')
  @Permissao(C.censoExportar)
  @Auditar(EVENTOS_AUDITAVEIS.censoMarcadasConsultadas.codigo)
  async exportarMarcadas(
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: RespostaArquivo,
  ): Promise<string> {
    const s = sessaoDe(req);
    await this.cfg.exigir(sujeitoDe(s), 'painel');
    const m = await this.servico.internacoesMarcadas(
      ctxM16(s, 'censo-marcadas-exportar'),
      await this.cfg.parametros(s),
    );
    req.sghAlvo = { chaveNaturalAlvo: `exportadas:${m.casos.length}` };
    res.header('content-type', 'text/csv; charset=utf-8');
    res.header('content-disposition', 'attachment; filename="internacoes-marcadas.csv"');
    return `\uFEFF${planilhaDasMarcadas(m, (x) => ROTULO_MARCA_CALCULO[x] ?? x)}`;
  }

  @Get('integracao/vigia/saude')
  @Permissao('config.conexao.ler')
  saude(): SaudeVigia {
    return this.vigia?.saude() ?? { canais: [], marcaDagua: 'memoria' };
  }
}
