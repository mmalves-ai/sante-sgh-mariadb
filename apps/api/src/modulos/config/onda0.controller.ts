// Onda 0: consultas ao vivo (ficha do M38):
//   GET /api/onda0/telas                          situação das telas da onda para esta sessão (chave da tela ligada,
//                                                 fora do escopo, desligada ou à espera de pré-requisito) e se as
//                                                 ações de escrita estão recusadas (faixa "só consulta nesta etapa")
//   GET /api/sistema/sonda                        sondas da implantação azul/verde (cap-14 §14.10.1): saúde do banco,
//                                                 versão, login do usuário técnico de sonda (sem acesso a paciente),
//                                                 painel de leitos e a recusa de gravação de negócio (regra 2). Só
//                                                 com o cabeçalho x-sonda-token = SONDA_TOKEN; sem ele, 404. Só
//                                                 contagens e códigos.
// Melhoria: a aba "Vigilância diária" da gravação no sistema de origem saiu (ADR 0003: sem convivência); a sonda
// "recusa-negocio" confere a liberação pelas chaves do produto, sem o catálogo de assinaturas.
// Melhoria: a faixa de escrita usa a pessoa, o grupo e o setor da sessão; falha ao ler a liberação vira 503, não "só
// consulta".
import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, Inject, Optional, Query, Req } from '@nestjs/common';
import {
  esquemaSondasImplantacao,
  esquemaTelasOnda0,
  recursoDesligado,
  type ResultadoSonda,
  type SondaImplantacao,
  type SondasImplantacao,
  TELAS_ONDA_0,
  type TelasOnda0,
} from '@sgh/contratos';
import { implantacaoPronta, situacaoDaTela } from '@sgh/dominio-config';
import { Permissao, Publica } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { logger } from '../../logger.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { VersaoService } from '../../versao.service.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import type { ConfiguracaoM16 } from '../internacao/configuracao.js';
import type { ServicoInternacao } from '../internacao/servico.js';
import { CONFIGURACAO_M16, SERVICO_INTERNACAO } from '../internacao/simbolos.js';
import { CACHE_CONFIG, type CacheConfig, TTL_CONFIG_NOVO_S } from './cache-config.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from './configuracao-fonte.js';
import { PORTA_ONDA0, type PortaOnda0 } from './onda0.js';

/** Operação de negócio que a sonda pergunta ao executor (não grava: só a conferência do passo 0). */
const OPERACAO_SONDA_NEGOCIO = 'cadastro.cadastrarPaciente';

/** Comparação de segredo em tempo constante. */
function mesmoSegredo(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

@Controller()
export class Onda0Controller {
  constructor(
    @Inject(PORTA_ONDA0) private readonly porta: PortaOnda0,
    @Inject(FONTE_CONFIGURACAO) private readonly fonte: FonteConfiguracao,
    @Inject(CACHE_CONFIG) private readonly cache: CacheConfig,
    @Inject(CONFIGURACAO) private readonly cfg: Configuracao,
    private readonly versaoService: VersaoService,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(SERVICO_INTERNACAO) private readonly internacao: ServicoInternacao | null = null,
    @Optional() @Inject(CONFIGURACAO_M16) private readonly m16: ConfiguracaoM16 | null = null,
  ) {}

  private sessao(req: RequisicaoAutorizada) {
    const a = req.sgh;
    if (!a) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    const hospital = a.sessao.estabelecimentoAtivo;
    if (!hospital) throw new ErroProblema('nao-autenticado', 401, 'Escolha o estabelecimento');
    return {
      sessao: a.sessao,
      hospital,
      rede: a.sessao.rede ?? '',
      login: a.sessao.usuario.login ?? a.sessao.usuario.id,
    };
  }

  @Get('onda0/telas')
  @Permissao('acesso.inicio.ler')
  async telas(@Req() req: RequisicaoAutorizada): Promise<TelasOnda0> {
    const { sessao, hospital, rede, login } = this.sessao(req);
    let dados: {
      chaves: Awaited<ReturnType<FonteConfiguracao['chaves']>>;
      prerequisitos: Awaited<ReturnType<FonteConfiguracao['prerequisitos']>>;
    } | null;
    try {
      dados = await this.cache.lerOuCarregar(
        this.cache.chave(rede, hospital, 'liberacao'),
        TTL_CONFIG_NOVO_S,
        async () => ({
          chaves: await this.fonte.chaves(rede, hospital),
          prerequisitos: await this.fonte.prerequisitos(rede, hospital),
        }),
      );
    } catch {
      dados = null;
    }
    const setor = sessao.unidadeAtiva;
    const grupo = sessao.grupoLegado;
    const sujeito = {
      pessoa: login,
      ...(setor !== null && setor !== undefined ? { setor: String(setor) } : {}),
      ...(grupo ? { grupo } : {}),
    };
    const agora = new Date();
    const telas = [];
    for (const t of TELAS_ONDA_0) {
      const entrada =
        t.recurso === null
          ? null
          : {
              chaves: (dados?.chaves ?? [])
                .filter((c) => c.chave === t.recurso && c.tipo === 'recurso' && c.ligada !== null)
                .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true })),
              declarados: recursoDesligado(t.recurso)?.prerequisitos ?? [],
              registrados: (dados?.prerequisitos ?? []).filter((p) => p.recurso === t.recurso),
              sujeito,
              agora,
            };
      telas.push(await situacaoDaTela(t, entrada, (op) => this.podeEscrever(rede, hospital, sujeito, op)));
    }
    return esquemaTelasOnda0.parse({ hospital, telas });
  }

  /**
   * A liberação da operação para o sujeito da sessão (pessoa, grupo e setor). Não conseguir ler as chaves não é "não
   * liberada": a resposta é 503, para a tela não mostrar "só consulta" quando o problema é a leitura.
   */
  private async podeEscrever(
    rede: string,
    hospital: string,
    sujeito: { pessoa: string; grupo?: string; setor?: string },
    op: string,
  ): Promise<boolean> {
    try {
      return await this.porta.podeEscrever(rede, hospital, sujeito, op);
    } catch (e) {
      logger.error(
        { operacao: op, tipoErro: e instanceof Error ? e.name : typeof e },
        'liberação da operação não pôde ser conferida',
      );
      throw new ErroProblema(
        'trilha-indisponivel',
        503,
        'Liberação indisponível',
        'Não foi possível conferir a liberação das operações agora. Tente de novo em instantes.',
      );
    }
  }

  @Get('sistema/sonda')
  @Publica(
    'sonda da implantação azul/verde (cap-14 §14.10.1): só com o segredo do pipeline; só contagens e códigos',
  )
  async sonda(
    @Headers('x-sonda-token') token?: string,
    @Query('hospital') hospitalPedido?: string,
  ): Promise<SondasImplantacao> {
    const segredo = (process.env['SONDA_TOKEN'] ?? '').trim();
    if (segredo.length < 32 || !token || !mesmoSegredo(token, segredo))
      throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
    const estabelecimentos = [...this.porta.estabelecimentos];
    const hospital = hospitalPedido?.trim() || estabelecimentos[0] || '';
    if (!estabelecimentos.includes(hospital))
      throw new ErroProblema('entrada-invalida', 400, 'Estabelecimento inválido');
    const versao = this.versaoService.atual(this.cfg.produtoNome);
    const rede = this.cfg.rede ?? '';
    const sondas: ResultadoSonda[] = [];
    const medir = async (sonda: SondaImplantacao, fn: () => Promise<{ ok: boolean; detalhe: string }>) => {
      const t = Date.now();
      let r: { ok: boolean; detalhe: string };
      try {
        r = await fn();
      } catch (e) {
        // M60.3: com o código do motivo (ex.: ErroSessao: trilha-indisponivel), sem mensagem nem dado.
        const tipo = e instanceof Error && 'tipo' in e && typeof e.tipo === 'string' ? `: ${e.tipo}` : '';
        r = { ok: false, detalhe: e instanceof Error ? `${e.name}${tipo}` : 'erro' };
      }
      sondas.push({ sonda, ok: r.ok, detalhe: r.detalhe.slice(0, 200), ms: Date.now() - t });
    };
    await medir('saude', async () => {
      const ok = await this.porta.bancoResponde(rede, hospital);
      return { ok, detalhe: ok ? 'banco responde' : 'banco não responde' };
    });
    await medir('versao', async () => {
      const esperada = (process.env['SONDA_VERSAO_ESPERADA'] ?? '').trim();
      const ok = !esperada || esperada === versao.identificacao || esperada === versao.versao;
      return {
        ok,
        detalhe: ok ? versao.identificacao : `esperada ${esperada}, no ar ${versao.identificacao}`,
      };
    });
    await medir('login-sonda', () => this.loginSonda(rede, hospital));
    await medir('painel-leitos', async () => {
      if (!this.internacao || !this.m16) return { ok: false, detalhe: 'painel de leitos indisponível' };
      const p = await this.internacao.painel(
        { rede, hospital, traceId: 'sonda-painel' },
        await this.m16.parametros({ rede, hospital }),
      );
      return {
        ok: p.totais.leitos > 0,
        detalhe: `${p.totais.leitos} leito(s), ${p.totais.ocupados} ocupado(s)`,
      };
    });
    await medir('recusa-negocio', async () => {
      const producao = this.cfg.ambiente === 'producao';
      const login = (process.env['SONDA_LOGIN'] ?? '').trim();
      const grava =
        producao && login
          ? await this.porta.podeEscrever(rede, hospital, login, OPERACAO_SONDA_NEGOCIO)
          : false;
      return {
        ok: !grava,
        detalhe: grava
          ? `${OPERACAO_SONDA_NEGOCIO} gravaria`
          : producao
            ? 'gravação de negócio recusada'
            : 'fora de produção: gravação de negócio não conferida',
      };
    });
    return esquemaSondasImplantacao.parse({
      hospital,
      versao: versao.identificacao,
      pronta: implantacaoPronta(sondas),
      sondas,
    });
  }

  /** Login do usuário técnico de sonda (SONDA_LOGIN e SONDA_SENHA): entra, confere que não lê paciente e sai. */
  private async loginSonda(rede: string, hospital: string): Promise<{ ok: boolean; detalhe: string }> {
    const login = (process.env['SONDA_LOGIN'] ?? '').trim();
    const senha = process.env['SONDA_SENHA'] ?? '';
    if (!this.sessoes || !login || !senha) return { ok: false, detalhe: 'usuário de sonda não configurado' };
    const r = await this.sessoes.entrar({ estabelecimento: hospital, login, senha }, rede);
    try {
      const dePaciente = r.sessao.permissoes.filter((p) =>
        /^(pep|cadastro\.paciente|internacao|atendimento|recepcao|enfermagem|sadt|faturamento)\./.test(p),
      );
      return {
        ok: dePaciente.length === 0,
        detalhe:
          dePaciente.length === 0
            ? `entrou; ${r.sessao.permissoes.length} permissão(ões), nenhuma de paciente`
            : `${dePaciente.length} permissão(ões) de paciente: o usuário de sonda não pode ler paciente`,
      };
    } finally {
      await this.sessoes.sair(r.idSessao, rede).catch(() => undefined);
    }
  }
}
