// Rotas da contabilidade, etapa 3 (M54-F3; ficha, seções 2, 4, 7 e regra 5):
//   GET  /api/contabil/demonstracoes/apoio?empresa=                 chave, permissões, hoje, níveis do plano e os tipos
//   GET  /api/contabil/demonstracoes/balancete?empresa=&de=&ate=&nivel=&incluirZeradas=&centroCusto=
//   GET  /api/contabil/demonstracoes/diario?empresa=&de=&ate=&pagina=
//   GET  /api/contabil/demonstracoes/dre?empresa=&de=&ate=
//   GET  /api/contabil/demonstracoes/balanco?empresa=&competencia=
//   GET  /api/contabil/demonstracoes/exportar?tipo=&formato=pdf|xlsx&(o filtro do tipo)   PDF/A ou XLSX, auditado
//   GET  /api/contabil/demonstracoes/apuracao?empresa=&exercicio=   a prévia da apuração do resultado do exercício
//   POST /api/contabil/demonstracoes/apuracao/apurar                 contabil.apurarResultado (crítica: senha de novo)
//   GET  /api/contabil/sped/apoio?empresa=                           chave `contabil.sped` (desligada por padrão), cifra
//   GET  /api/contabil/sped?empresa=                                 os arquivos gerados (sem o conteúdo)
//   GET  /api/contabil/sped/previa?empresa=&tipo=&exercicio=         impedimentos, avisos e a contagem dos registros
//   POST /api/contabil/sped/gerar                                    contabil.gerarSped (arquivo cifrado, hash)
//   GET  /api/contabil/sped/arquivo?empresa=&id=                     o arquivo decifrado (leitura auditada)
//   POST /api/contabil/sped/situacao                                 recibo da transmissão ou cancelamento
// As demonstrações e a apuração exigem a chave `contabil`; o SPED, também a `contabil.sped`. Cada gravação vai com a
// trilha_auditoria na mesma transação; nenhuma tabela do banco anterior é escrita (regra 1).
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Optional,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type ApoioDemonstracoes,
  type ApoioSped,
  type ArquivoSpedBaixado,
  type ArquivosSped,
  type SignatariosSped,
  type Balancete,
  type Balanco,
  CHAVE_CONTABIL,
  type Diario,
  type Dre,
  esquemaApurarResultado,
  esquemaArquivoSped,
  esquemaFiltroApuracao,
  esquemaFiltroBalancete,
  esquemaFiltroBalanco,
  esquemaFiltroDiario,
  esquemaFiltroDre,
  esquemaFiltroSped,
  esquemaGerarSped,
  esquemaSenhaReautenticacao,
  esquemaSituacaoSped,
  EVENTOS_AUDITAVEIS,
  type PreviaApuracao,
  type PreviaSped,
  recursoDesligado,
  type ResultadoApuracao,
  type ResultadoSped,
  ROTAS_CONTABIL_F3 as R,
  SITUACOES_ARQUIVO_SPED,
  TIPOS_ARQUIVO_SPED,
} from '@sgh/contratos';
import { reaisBr } from '@sgh/dominio-contabil';
import type { TrilhaDaGravacao as LinhaTrilha } from '../exames/public-api.js';
import { z } from 'zod';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import { Auditar, AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import { gravacaoDaTela } from './gravacao.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  chaveDeRecursoNaSessao,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { CIFRA_CPF_PESSOAS, type CifraCpf } from '../pessoas/public-api.js';
import { motivoContabilDesligada } from './contabil.controller.js';
import { type GravadorContabil, PORTA_CONTABIL, type PortaContabil } from './porta.js';
import {
  FORMATOS_EXPORTACAO_DEMONSTRACAO,
  htmlDaDemonstracao,
  type DadoDemonstracao,
  TETO_LANCAMENTOS_EXPORTACAO_DIARIO,
  tabelaDaDemonstracao,
  xlsxDaDemonstracao,
} from './exportar-demonstracoes.js';
import { arquivoListado, ServicoDemonstracoes } from './servico-demonstracoes.js';

const E = EVENTOS_AUDITAVEIS;
/** O conversor de PDF/A do M09 (Gotenberg); sem ele (testes), a exportação em PDF responde 503. */
export const GERADOR_PDF_CONTABIL = Symbol('GERADOR_PDF_CONTABIL');
export type GeradorPdfContabil = (html: string, titulo: string) => Promise<Uint8Array>;
type RespostaArquivo = { header(n: string, v: string): unknown };
/** A chave da parte SPED (liberação do recurso; nasce desligada, POL-3). */
export const CHAVE_CONTABIL_SPED = 'contabil.sped' as const;

function filtro<T>(esquema: z.ZodType<T>, q: unknown): T {
  const r = esquema.safeParse(q ?? {});
  if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', 'Filtro inválido.');
  return r.data;
}

const inteiro = z.coerce.number().int();
const esquemaEmpresa = z.object({ empresa: inteiro.positive().default(1) });
const esquemaConsultaBalancete = z.object({
  empresa: inteiro.positive().default(1),
  de: z.string(),
  ate: z.string(),
  nivel: inteiro.optional(),
  incluirZeradas: z.enum(['true', 'false']).optional(),
  centroCusto: inteiro.positive().optional(),
});
const esquemaConsultaDiario = z.object({
  empresa: inteiro.positive().default(1),
  de: z.string(),
  ate: z.string(),
  pagina: inteiro.optional(),
});
const esquemaConsultaIntervalo = z.object({
  empresa: inteiro.positive().default(1),
  de: z.string(),
  ate: z.string(),
});
const esquemaConsultaBalanco = z.object({ empresa: inteiro.positive().default(1), competencia: z.string() });
const esquemaConsultaExportar = z.object({
  tipo: z.enum(['balancete', 'diario', 'dre', 'balanco']),
  formato: z.enum(FORMATOS_EXPORTACAO_DEMONSTRACAO),
});
const esquemaConsultaExercicio = z.object({ empresa: inteiro.positive().default(1), exercicio: inteiro });
const esquemaConsultaSped = z.object({
  empresa: inteiro.positive().default(1),
  tipo: z.string(),
  exercicio: inteiro,
});
const esquemaConsultaArquivo = z.object({ empresa: inteiro.positive().default(1), id: inteiro.positive() });
const esquemaApurarComSenha = esquemaApurarResultado.extend(esquemaSenhaReautenticacao.shape);

/** O motivo da parte SPED desligada (POL-3; ficha, seção 2: a controladoria liga quando trouxer a escrituração). */
export function motivoSpedDesligado(): string {
  const r = recursoDesligado(CHAVE_CONTABIL_SPED);
  const pre = (r?.prerequisitos ?? []).map((p) => p.descricao).join(' ');
  return `O SPED contábil está desligado neste estabelecimento: a escrituração continua com o escritório contábil pela exportação ao contador.${pre ? ` Pré-requisito: ${pre}` : ''} O administrador liga em Funcionalidades por estabelecimento.`;
}

@Controller()
export class DemonstracoesContabilController {
  readonly servico: ServicoDemonstracoes;

  constructor(
    @Inject(PORTA_CONTABIL) private readonly porta: PortaContabil,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) private readonly cache: CacheConfig | null = null,
    @Optional() @Inject(CIFRA_CPF_PESSOAS) private readonly cifra: CifraCpf | null = null,
    @Optional() @Inject(GERADOR_PDF_CONTABIL) private readonly pdf: GeradorPdfContabil | null = null,
  ) {
    this.servico = new ServicoDemonstracoes(porta);
  }

  private async ligada(req: RequisicaoAutorizada, chave: string): Promise<boolean> {
    return (await chaveDeRecursoNaSessao(this.fonte, this.cache, req, chave)).ligada;
  }

  private async exigirChave(req: RequisicaoAutorizada): Promise<SessaoCadastro> {
    const s = sessaoDe(req);
    if (!(await this.ligada(req, CHAVE_CONTABIL)))
      throw new ErroProblema('recurso-desligado', 403, 'Contabilidade desligada', motivoContabilDesligada(), {
        codigo: 'recurso-desligado',
      });
    return s;
  }

  private async exigirSped(req: RequisicaoAutorizada): Promise<SessaoCadastro> {
    const s = await this.exigirChave(req);
    if (!(await this.ligada(req, CHAVE_CONTABIL_SPED)))
      throw new ErroProblema('recurso-desligado', 403, 'SPED contábil desligado', motivoSpedDesligado(), {
        codigo: 'recurso-desligado',
      });
    return s;
  }

  private exigirCifra(): CifraCpf {
    if (!this.cifra)
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Cifra indisponível',
        'A chave de cifra não está configurada: o arquivo do SPED traz o CPF dos signatários e só é guardado cifrado.',
        { codigo: 'sem-cifra' },
      );
    return this.cifra;
  }

  private async reautenticar(req: RequisicaoAutorizada, senha: string | undefined): Promise<void> {
    if (this.porta.destino === 'memoria' && !req.sgh?.real) return;
    await reautenticar(this.sessoes, this.resolvedor, req, senha);
  }

  /** Gravação pelo Executor, com a trilha na mesma transação (na memória, a trilha pelo registrador da API). */
  private async gravar<T>(
    s: SessaoCadastro,
    evento: string,
    operacao: string,
    alvo: (r: T) => { tabela: string; id?: string | null; chave?: string | null; diferenca?: string | null },
    fn: (g: GravadorContabil) => Promise<T>,
  ): Promise<T> {
    const linha = (r: T): LinhaTrilha => {
      const a = alvo(r);
      return {
        ...linhaTrilha(s, evento, 'contabil', operacao, a),
        ...(a.diferenca ? { diferenca: a.diferenca.slice(0, 400) } : {}),
      };
    };
    const g = gravacaoDaTela(s, operacao);
    const r = await this.porta.gravar(g.contexto, g.pedido, linha, fn).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    if (this.porta.destino === 'memoria') {
      const a = alvo(r);
      await this.trilha.registrar({
        evento,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, evento).slice(0, 64),
        recurso: 'contabil',
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: a.id ?? a.chave ?? '',
      });
    }
    return r;
  }

  // ── Demonstrações ──────────────────────────────────────────────────────────────────────────────

  @Get(R.apoio.caminho)
  @Permissao(R.apoio.permissao)
  async apoio(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ApoioDemonstracoes> {
    const { empresa } = filtro(esquemaEmpresa, q);
    const s = sessaoDe(req);
    const ligada = await this.ligada(req, CHAVE_CONTABIL);
    return this.servico.apoio(
      s.porta,
      {
        ligada,
        motivo: ligada ? null : motivoContabilDesligada(),
        podeApurar: s.pode(R.apurar.permissao),
        podeVerSped: s.pode(R.spedArquivos.permissao),
      },
      empresa,
    );
  }

  @Get(R.balancete.caminho)
  @Permissao(R.balancete.permissao)
  async balancete(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Balancete> {
    const b = filtro(esquemaConsultaBalancete, q);
    const f = corpo(esquemaFiltroBalancete, {
      empresa: b.empresa,
      de: b.de,
      ate: b.ate,
      nivel: b.nivel ?? null,
      incluirZeradas: b.incluirZeradas === 'true',
      centroCusto: b.centroCusto ?? null,
    });
    const s = await this.exigirChave(req);
    return this.servico.balancete(s.porta, f);
  }

  @Get(R.diario.caminho)
  @Permissao(R.diario.permissao)
  async diario(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Diario> {
    const b = filtro(esquemaConsultaDiario, q);
    const f = corpo(esquemaFiltroDiario, b);
    const s = await this.exigirChave(req);
    return this.servico.diario(s.porta, f);
  }

  @Get(R.dre.caminho)
  @Permissao(R.dre.permissao)
  async dre(@Query() q: Record<string, string | undefined>, @Req() req: RequisicaoAutorizada): Promise<Dre> {
    const f = corpo(esquemaFiltroDre, filtro(esquemaConsultaIntervalo, q));
    const s = await this.exigirChave(req);
    return this.servico.dre(s.porta, f);
  }

  @Get(R.balanco.caminho)
  @Permissao(R.balanco.permissao)
  async balanco(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Balanco> {
    const f = corpo(esquemaFiltroBalanco, filtro(esquemaConsultaBalanco, q));
    const s = await this.exigirChave(req);
    return this.servico.balanco(s.porta, f);
  }

  @Get(R.exportar.caminho)
  @Permissao(R.exportar.permissao)
  @Auditar(E.contabilDemonstracaoExportada.codigo)
  async exportar(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: RespostaArquivo,
  ): Promise<Buffer> {
    const { tipo, formato } = filtro(esquemaConsultaExportar, q);
    const s = await this.exigirChave(req);
    const dado = await this.dadoParaExportar(s, tipo, q);
    const t = tabelaDaDemonstracao(dado);
    req.sghAlvo = {
      tabelaAlvo: 'lancamento_contabil',
      idAlvo: t.arquivo,
      chaveNaturalAlvo: `${tipo}:${formato}`,
    };
    let conteudo: Uint8Array;
    if (formato === 'xlsx') {
      conteudo = xlsxDaDemonstracao(t);
      res.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else {
      const indisponivel = () =>
        new ErroProblema(
          'indisponivel',
          503,
          'Conversor de PDF indisponível',
          'O PDF não pôde ser gerado agora: exporte em planilha ou tente de novo em instantes.',
        );
      if (!this.pdf) throw indisponivel();
      const html = htmlDaDemonstracao(t, { emitidoPor: s.login, emitidoEm: new Date() });
      conteudo = await this.pdf(html, t.titulo).catch(() => {
        throw indisponivel();
      });
      res.header('content-type', 'application/pdf');
    }
    res.header('content-disposition', `attachment; filename="${t.arquivo}.${formato}"`);
    res.header('cache-control', 'no-store');
    return Buffer.from(conteudo);
  }

  /** O mesmo filtro e o mesmo cálculo da tela; o diário soma as páginas e não sai incompleto. */
  private async dadoParaExportar(
    s: SessaoCadastro,
    tipo: DadoDemonstracao['tipo'],
    q: Record<string, string | undefined>,
  ): Promise<DadoDemonstracao> {
    if (tipo === 'balancete') {
      const b = filtro(esquemaConsultaBalancete, q);
      const f = corpo(esquemaFiltroBalancete, {
        empresa: b.empresa,
        de: b.de,
        ate: b.ate,
        nivel: b.nivel ?? null,
        incluirZeradas: b.incluirZeradas === 'true',
        centroCusto: b.centroCusto ?? null,
      });
      return { tipo, dado: await this.servico.balancete(s.porta, f) };
    }
    if (tipo === 'dre')
      return {
        tipo,
        dado: await this.servico.dre(s.porta, corpo(esquemaFiltroDre, filtro(esquemaConsultaIntervalo, q))),
      };
    if (tipo === 'balanco')
      return {
        tipo,
        dado: await this.servico.balanco(
          s.porta,
          corpo(esquemaFiltroBalanco, filtro(esquemaConsultaBalanco, q)),
        ),
      };
    const b = filtro(esquemaConsultaDiario, q);
    const f = corpo(esquemaFiltroDiario, { ...b, pagina: 1 });
    const primeira = await this.servico.diario(s.porta, f);
    if (primeira.totais.lancamentos > TETO_LANCAMENTOS_EXPORTACAO_DIARIO)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Diário grande demais para um arquivo',
        `O intervalo tem ${primeira.totais.lancamentos} lançamentos; o arquivo leva até ${TETO_LANCAMENTOS_EXPORTACAO_DIARIO}. Exporte um intervalo menor (por exemplo, um mês).`,
        { codigo: 'diario-grande' },
      );
    const lancamentos = [...primeira.lancamentos];
    for (let p = primeira; p.parcial && p.lancamentos.length > 0;) {
      p = await this.servico.diario(s.porta, { ...f, pagina: p.pagina + 1 });
      lancamentos.push(...p.lancamentos);
    }
    return { tipo, dado: { ...primeira, lancamentos, parcial: false } };
  }

  @Get(R.apuracao.caminho)
  @Permissao(R.apuracao.permissao)
  async apuracao(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PreviaApuracao> {
    const f = corpo(esquemaFiltroApuracao, filtro(esquemaConsultaExercicio, q));
    const s = await this.exigirChave(req);
    return this.servico.previaApuracao(s.porta, f.empresa, f.exercicio);
  }

  @Post(R.apurar.caminho)
  @HttpCode(200)
  @Permissao(R.apurar.permissao)
  @AuditadoNoHandler(
    'contabil.apurarResultado (lancamento_contabil e partida_contabil, tipo apuracao) com a trilha_auditoria na mesma transação',
  )
  async apurar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoApuracao> {
    const e = corpo(esquemaApurarComSenha, b);
    const s = await this.exigirChave(req);
    await this.reautenticar(req, e.senha);
    const { lancamento, plano } = await this.servico.planoApurar(s.porta, e);
    const r = await this.gravar(
      s,
      E.contabilResultadoApurado.codigo,
      'contabil.apurarResultado',
      (x: { id: number }) => ({
        tabela: 'lancamento_contabil',
        id: String(x.id),
        diferenca: `exercicio=${e.exercicio};resultado=${plano.resultado};partidas=${plano.partidas.length}`,
      }),
      (g) => g.gravarLancamento(lancamento, s.login),
    );
    return {
      ok: true,
      id: r.id,
      resultadoCentavos: plano.resultado,
      mensagem: `Resultado de ${e.exercicio} apurado: ${plano.resultado < 0 ? 'déficit' : 'superávit'} de ${reaisBr(Math.abs(plano.resultado))} levado à conta ${e.contaDestino}.`,
    };
  }

  // ── SPED ───────────────────────────────────────────────────────────────────────────────────────

  @Get(R.spedApoio.caminho)
  @Permissao(R.spedApoio.permissao)
  async spedApoio(@Req() req: RequisicaoAutorizada): Promise<ApoioSped> {
    const s = sessaoDe(req);
    const contabil = await this.ligada(req, CHAVE_CONTABIL);
    const sped = contabil && (await this.ligada(req, CHAVE_CONTABIL_SPED));
    return this.servico.apoioSped(s.porta, {
      ligada: sped,
      motivo: !contabil ? motivoContabilDesligada() : sped ? null : motivoSpedDesligado(),
      podeGerar: s.pode(R.spedGerar.permissao) && this.cifra !== null,
      cifraDisponivel: this.cifra !== null,
    });
  }

  @Get(R.spedArquivos.caminho)
  @Permissao(R.spedArquivos.permissao)
  async spedArquivos(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ArquivosSped> {
    const { empresa } = filtro(esquemaEmpresa, q);
    const s = await this.exigirSped(req);
    return { empresa, itens: await this.servico.arquivos(s.porta, empresa) };
  }

  @Get(R.spedSignatarios.caminho)
  @Permissao(R.spedSignatarios.permissao)
  async spedSignatarios(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<SignatariosSped> {
    const { empresa } = filtro(esquemaEmpresa, q);
    const s = await this.exigirSped(req);
    return this.servico.signatarios(s.porta, empresa);
  }

  @Get(R.spedPrevia.caminho)
  @Permissao(R.spedPrevia.permissao)
  async spedPrevia(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PreviaSped> {
    const f = corpo(esquemaFiltroSped, filtro(esquemaConsultaSped, q));
    const s = await this.exigirSped(req);
    return this.servico.previaSped(s.porta, f);
  }

  @Post(R.spedGerar.caminho)
  @HttpCode(200)
  @Permissao(R.spedGerar.permissao)
  @AuditadoNoHandler(
    'contabil.gerarSped (arquivo_sped_contabil, arquivo cifrado) com a trilha_auditoria na mesma transação',
  )
  async spedGerar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSped> {
    const g = corpo(esquemaGerarSped, b);
    const s = await this.exigirSped(req);
    const cifra = this.exigirCifra();
    const p = await this.servico.gerarSped(s.porta, g);
    const r = await this.gravar(
      s,
      E.contabilSpedGerado.codigo,
      'contabil.gerarSped',
      (x: { id: number; numero: number }) => ({
        tabela: 'arquivo_sped_contabil',
        id: String(x.id),
        diferenca: `tipo=${g.tipo};exercicio=${g.exercicio};numero=${x.numero};linhas=${p.gerado.linhas};hash=${p.hash}`,
      }),
      async (w) => {
        const arquivo = await w.gravarArquivoSped({
          empresa: g.empresa,
          tipo: g.tipo,
          exercicio: g.exercicio,
          leiaute: p.leiaute,
          substituta: g.substituta,
          nomeArquivo: p.gerado.nomeArquivo,
          conteudoCifrado: cifra.cifrarTexto(p.gerado.conteudo),
          tamanho: p.tamanho,
          linhas: p.gerado.linhas,
          hash: p.hash,
          parametros: p.parametros,
          usuario: s.login,
        });
        // Os signatários vão ao cadastro da empresa na mesma transação (a próxima geração já os traz).
        let semCadastro = 0;
        if (g.guardarSignatarios)
          for (const signatario of g.signatarios)
            if ((await w.guardarSignatarioSped({ empresa: g.empresa, signatario })).id === null)
              semCadastro++;
        return { ...arquivo, semCadastro };
      },
    );
    return {
      ok: true,
      id: r.id,
      numero: r.numero,
      hash: p.hash,
      linhas: p.gerado.linhas,
      mensagem: `${TIPOS_ARQUIVO_SPED[g.tipo]} de ${g.exercicio} gerada (arquivo ${r.numero}, ${p.gerado.linhas} linhas)${r.substituidos > 0 ? '; a anterior não transmitida ficou substituída' : ''}${r.semCadastro > 0 ? `; ${r.semCadastro} signatário(s) sem cadastro de pessoa pelo CPF não ficaram guardados` : ''}. Valide e transmita no programa oficial e registre o recibo aqui.`,
    };
  }

  @Get(R.spedBaixar.caminho)
  @Permissao(R.spedBaixar.permissao)
  @Auditar(E.contabilSpedBaixado.codigo)
  @Header('Cache-Control', 'no-store')
  async spedBaixar(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ArquivoSpedBaixado> {
    const f = corpo(esquemaArquivoSped, filtro(esquemaConsultaArquivo, q));
    req.sghAlvo = { tabelaAlvo: 'arquivo_sped_contabil', idAlvo: String(f.id), chaveNaturalAlvo: 'arquivo' };
    const s = await this.exigirSped(req);
    const cifra = this.exigirCifra();
    const a = await this.porta.conteudoSped(s.porta, f.empresa, f.id);
    if (!a)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Arquivo não encontrado',
        'O arquivo não existe nesta empresa.',
      );
    const conteudo = cifra.decifrarTexto(a.conteudoCifrado);
    if (conteudo === null)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Arquivo ilegível',
        'O arquivo foi cifrado com outra chave: gere de novo.',
        { codigo: 'cifra-diferente' },
      );
    return { id: a.id, nomeArquivo: a.nomeArquivo, hash: a.hash, conteudo };
  }

  @Post(R.spedSituacao.caminho)
  @HttpCode(200)
  @Permissao(R.spedSituacao.permissao)
  @AuditadoNoHandler(
    'contabil.situacaoSped (arquivo_sped_contabil: recibo ou cancelamento) com a trilha_auditoria na mesma transação',
  )
  async spedSituacao(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true; mensagem: string; arquivo: ReturnType<typeof arquivoListado> }> {
    const x = corpo(esquemaSituacaoSped, b);
    const s = await this.exigirSped(req);
    const a = await this.gravar(
      s,
      E.contabilSpedSituacao.codigo,
      'contabil.situacaoSped',
      () => ({ tabela: 'arquivo_sped_contabil', id: String(x.id), diferenca: `acao=${x.acao}` }),
      (g) =>
        g.situacaoArquivoSped({
          empresa: x.empresa,
          id: x.id,
          acao: x.acao,
          recibo: x.acao === 'recibo' ? x.recibo : null,
          transmitidoEm: x.acao === 'recibo' ? x.transmitidoEm : null,
          motivo: x.acao === 'cancelar' ? x.motivo : null,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      mensagem: `Arquivo ${SITUACOES_ARQUIVO_SPED[a.situacao].toLowerCase()}.`,
      arquivo: arquivoListado(a),
    };
  }
}
