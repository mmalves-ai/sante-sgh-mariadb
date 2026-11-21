// Sondas da implantação azul/verde (cap-14 §14.10.1):
//   GET /api/sistema/sonda?hospital=     saúde do banco, versão, login do usuário técnico de sonda (sem acesso a
//                                        paciente), painel de leitos e a recusa de gravação de negócio (regra 2). Só
//                                        com o cabeçalho x-sonda-token = SONDA_TOKEN (32+ caracteres); sem ele, 404.
//                                        Só contagens e códigos. Usada por `pnpm implantacao:verificar` (ROTA_SONDAS).
// Lote 02-07 (ADR 0003, itens 5 e 9): saiu do controller antigo da virada gradual (apagado) para a implantação.
// Melhoria: a "recusa-negocio" confere a liberação pelas chaves de operação do produto (operacaoLiberada), sem a etapa
// de implantação; o hospital é validado contra os estabelecimentos do banco do cliente.
import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, Inject, Optional, Query } from '@nestjs/common';
import {
  esquemaSondasImplantacao,
  type ResultadoSonda,
  type SondaImplantacao,
  type SondasImplantacao,
} from '@sgh/contratos';
import { implantacaoPronta } from '@sgh/dominio-config';
import { Publica } from '../../autorizacao/decoradores.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { VersaoService } from '../../versao.service.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { CATALOGO_OPERACOES, type CatalogoOperacoesLiberacao } from '../config/catalogo-operacoes.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao, operacaoLiberada } from '../config/public-api.js';
import type { ConfiguracaoM16 } from '../internacao/configuracao.js';
import type { ServicoInternacao } from '../internacao/servico.js';
import { CONFIGURACAO_M16, SERVICO_INTERNACAO } from '../internacao/simbolos.js';
import { PORTA_SONDA, type PortaSonda } from './sonda.js';

/** Operação de negócio que a sonda pergunta à liberação (não grava). */
export const OPERACAO_SONDA_NEGOCIO = 'cadastro.cadastrarPaciente';

/** Permissões que indicam leitura de paciente (o usuário técnico de sonda não pode ter nenhuma). */
const PERMISSAO_DE_PACIENTE =
  /^(pep|cadastro\.paciente|internacao|atendimento|recepcao|enfermagem|sadt|faturamento)\./;

/** Comparação de segredo em tempo constante. */
function mesmoSegredo(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type Resultado = { ok: boolean; detalhe: string };

@Controller()
export class SondaImplantacaoController {
  constructor(
    @Inject(PORTA_SONDA) private readonly porta: PortaSonda,
    @Inject(FONTE_CONFIGURACAO) private readonly fonte: FonteConfiguracao,
    @Inject(CATALOGO_OPERACOES) private readonly catalogo: CatalogoOperacoesLiberacao,
    @Inject(CONFIGURACAO) private readonly cfg: Configuracao,
    private readonly versaoService: VersaoService,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(SERVICO_INTERNACAO) private readonly internacao: ServicoInternacao | null = null,
    @Optional() @Inject(CONFIGURACAO_M16) private readonly m16: ConfiguracaoM16 | null = null,
  ) {}

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
    // Falha ao ler o cadastro: nenhum estabelecimento vale (400, falha fechada).
    const estabelecimentos = await this.porta.estabelecimentos().catch((): readonly string[] => []);
    const hospital = hospitalPedido?.trim() || estabelecimentos[0] || '';
    if (!estabelecimentos.includes(hospital))
      throw new ErroProblema('entrada-invalida', 400, 'Estabelecimento inválido');
    const versao = this.versaoService.atual(this.cfg.produtoNome);
    const rede = this.cfg.rede ?? '';
    const sondas: ResultadoSonda[] = [];
    const medir = async (sonda: SondaImplantacao, fn: () => Promise<Resultado>) => {
      const t = Date.now();
      let r: Resultado;
      try {
        r = await fn();
      } catch (e) {
        // Com o código do motivo (ex.: ErroSessao: trilha-indisponivel), sem mensagem nem dado.
        const tipo = e instanceof Error && 'tipo' in e && typeof e.tipo === 'string' ? `: ${e.tipo}` : '';
        r = { ok: false, detalhe: e instanceof Error ? `${e.name}${tipo}` : 'erro' };
      }
      sondas.push({ sonda, ok: r.ok, detalhe: r.detalhe.slice(0, 200), ms: Date.now() - t });
    };
    await medir('saude', async () => {
      const ok = await this.porta.bancoResponde();
      return { ok, detalhe: ok ? 'banco responde' : 'banco não responde' };
    });
    await medir('versao', async () => {
      const esperada = (process.env['SONDA_VERSAO_ESPERADA'] ?? '').trim();
      const ok = !esperada || esperada === versao.identificacao || esperada === versao.versao;
      return { ok, detalhe: ok ? versao.identificacao : `esperada ${esperada}, no ar ${versao.identificacao}` };
    });
    await medir('login-sonda', () => this.loginSonda(rede, hospital));
    await medir('painel-leitos', async () => {
      if (!this.internacao || !this.m16) return { ok: false, detalhe: 'painel de leitos indisponível' };
      const p = await this.internacao.painel(
        { rede, hospital, traceId: 'sonda-painel' },
        await this.m16.parametros({ rede, hospital }),
      );
      return { ok: p.totais.leitos > 0, detalhe: `${p.totais.leitos} leito(s), ${p.totais.ocupados} ocupado(s)` };
    });
    await medir('recusa-negocio', async () => {
      const producao = this.cfg.ambiente === 'producao';
      const login = (process.env['SONDA_LOGIN'] ?? '').trim();
      const grava =
        producao && login
          ? await operacaoLiberada(this.fonte, this.catalogo, rede, hospital, { pessoa: login }, OPERACAO_SONDA_NEGOCIO)
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
  private async loginSonda(rede: string, hospital: string): Promise<Resultado> {
    const login = (process.env['SONDA_LOGIN'] ?? '').trim();
    const senha = process.env['SONDA_SENHA'] ?? '';
    if (!this.sessoes || !login || !senha) return { ok: false, detalhe: 'usuário de sonda não configurado' };
    const r = await this.sessoes.entrar({ estabelecimento: hospital, login, senha }, rede);
    try {
      const dePaciente = r.sessao.permissoes.filter((p) => PERMISSAO_DE_PACIENTE.test(p));
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
