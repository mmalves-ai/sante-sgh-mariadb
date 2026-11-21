// A fachada da API de integração da Hal-AI (M58-F4; ficha, seção 7 e regras 8 e 9):
//   ALL  /api/fachada/sante-api/:hospital/<caminho da API original>   o serviço com o contrato da API original
//   GET  /api/administracao/integracoes/fachada                        painel de estado (integracao.fachada.ler)
//   POST /api/administracao/integracoes/fachada/configuracao           um parâmetro da fachada (crítico: senha de novo)
// O serviço é público para a sessão (a Hal-AI não tem sessão): o token da superfície é conferido no handler, em tempo
// constante, e toda resposta sai no contrato de erro da API original (nunca o Problem Details da API do Sante SGH).
// A configuração grava pelos parâmetros do estabelecimento com a trilha na mesma transação.
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import {
  All,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  EVENTOS_AUDITAVEIS,
  esquemaConfigurarFachada,
  definicaoParametro,
  PERMISSOES_M58_CODIGOS as P,
  type PainelFachada,
  PREFIXO_FACHADA,
  type ResultadoConfigurarFachada,
} from '@sgh/contratos';
import { ehRecusa, planejarDefinicao } from '@sgh/dominio-config';
import { lerConfiguracaoFachada, validarValorFachada } from '@sgh/dominio-integracao';
import { AuditadoNoHandler, Permissao, Publica } from '../../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { reautenticar } from '../../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../../autorizacao/resolvedor-sessao.js';
import { CONFIGURACAO, type Configuracao } from '../../../configuracao.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { ServicoSessao } from '../../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../../acesso/acesso.controller.js';
import { sessaoDe } from '../../cadastro/comum.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../../config/public-api.js';
import { falhaDaConfiguracao } from '../../config/falha-configuracao.js';
import { ESTABELECIMENTOS_ENTRADA } from '../integracao.controller.js';
import type { PortaFachada } from './porta.js';
import { ServicoFachada, tokensDoAmbiente } from './servico.js';

/** O serviço da fachada (um por processo: o motor de propostas e o uso medido vivem nele). */
export const SERVICO_FACHADA = Symbol('SERVICO_FACHADA');

export function criarServicoFachada(
  porta: PortaFachada,
  fonte: FonteConfiguracao | null,
  env: NodeJS.ProcessEnv,
): ServicoFachada {
  const log = new Logger('Fachada');
  return new ServicoFachada({
    porta,
    tokens: tokensDoAmbiente(env),
    valores: fonte ? (rede, hospital) => fonte.valoresParametro(rede, hospital) : null,
    raizEnsaios: resolve(process.cwd(), env['SGH_M58_ENSAIOS'] ?? 'docs/marcos/M58'),
    // O erro real vai só para o log (nome e código; nunca o corpo do pedido nem o token).
    registrarErro: (id, e) =>
      log.error(
        `${id}: ${e instanceof Error ? `${e.name} ${(e as { code?: string }).code ?? ''}` : 'falha'}`,
      ),
  });
}

interface RespostaFastify {
  status(n: number): RespostaFastify;
  header(n: string, v: string): RespostaFastify;
  send(corpo: unknown): unknown;
}

const BASE = 'administracao/integracoes/fachada';

@Controller()
export class FachadaController {
  constructor(
    @Inject(SERVICO_FACHADA) private readonly servico: ServicoFachada,
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(ESTABELECIMENTOS_ENTRADA) private readonly estabelecimentos: readonly string[] = [],
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly fonte: FonteConfiguracao | null = null,
  ) {}

  @All(`${PREFIXO_FACHADA}/:hospital/*`)
  @Publica(
    'fachada da API de integração: o token da superfície é conferido no handler (tempo constante, por escopo)',
  )
  @AuditadoNoHandler('escritas pelo Executor (trilha e autoria na mesma transação), assinadas por hal-ai')
  async atender(
    @Param('hospital') hospital: string,
    @Req() req: RequisicaoAutorizada,
    @Res() res: RespostaFastify,
  ): Promise<void> {
    const url = String((req as { url?: string }).url ?? '');
    const prefixo = `/api/${PREFIXO_FACHADA}/${hospital}`;
    const [semConsulta, ...resto] = url.split('?');
    const caminho = (semConsulta ?? '').startsWith(prefixo)
      ? (semConsulta ?? '').slice(prefixo.length) || '/'
      : '/';
    const pedido = req as unknown as {
      method: string;
      query?: Record<string, unknown>;
      body?: unknown;
      headers: Record<string, unknown>;
    };
    const valido =
      /^[a-z0-9]{1,10}$/.test(hospital) &&
      (this.estabelecimentos.length === 0 || this.estabelecimentos.includes(hospital));
    const r = valido
      ? await this.servico.atender({
          rede: this.configuracao.rede ?? 'rede-sintetica',
          hospital,
          metodo: pedido.method,
          caminho,
          consulta: resto.join('?'),
          query: pedido.query ?? {},
          corpo: pedido.body,
          cabecalhos: pedido.headers,
        })
      : {
          status: 404,
          corpo: {
            status: 'error',
            codigo: 'rota_nao_encontrada',
            message: 'Estabelecimento não encontrado.',
          },
        };
    res
      .status(r.status)
      .header('cache-control', 'no-store')
      .header('x-robots-tag', 'noindex')
      .header('referrer-policy', 'no-referrer')
      .send(r.corpo);
  }

  @Get(BASE)
  @Permissao(P.fachadaLer)
  painel(@Req() req: RequisicaoAutorizada): Promise<PainelFachada> {
    const s = sessaoDe(req);
    return this.servico.painel(s.rede, s.hospital, s.pode(P.fachadaConfigurar));
  }

  @Post(`${BASE}/configuracao`)
  @HttpCode(200)
  @Permissao(P.fachadaConfigurar)
  @AuditadoNoHandler('parâmetro do estabelecimento e trilha na mesma transação (reautenticação)')
  async configurar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoConfigurarFachada> {
    const p = esquemaConfigurarFachada.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Escolha o parâmetro da fachada, o valor e justifique (10 caracteres ou mais).',
      );
    const v = validarValorFachada(p.data.chave, p.data.valor);
    if ('recusa' in v) throw new ErroProblema('entrada-invalida', 422, 'Valor recusado', v.recusa);
    if (!this.fonte) throw new ErroProblema('indisponivel', 503, 'Configuração indisponível');
    const { rede, hospital, login } = sessaoDe(req);
    await reautenticar(this.sessoes, this.resolvedor, req, p.data.senha);
    const def = definicaoParametro(p.data.chave);
    const existentes = await this.fonte.valoresParametro(rede, hospital);
    const agora = await this.fonte.relogio(rede, hospital);
    const plano = planejarDefinicao(
      def,
      { nivel: 'estabelecimento', alvo: hospital, valor: v.valor, justificativa: p.data.justificativa },
      existentes,
      login,
      agora,
    );
    if (ehRecusa(plano))
      throw new ErroProblema(
        plano.status === 404
          ? 'nao-encontrado'
          : plano.status === 422
            ? 'entrada-invalida'
            : 'recusa-de-negocio',
        plano.status,
        'Parâmetro não definido',
        plano.mensagem,
        { codigo: plano.codigo },
      );
    await this.fonte
      .definirParametro(
        { rede, hospital, fechar: plano.fechar, nova: plano.nova },
        {
          rede,
          hospital,
          usuario: login,
          evento: EVENTOS_AUDITAVEIS.parametroDefinido.codigo,
          recurso: 'integracao.fachada',
          operacao: 'config.definirParametro',
          chaveNaturalAlvo: `${p.data.chave}:estabelecimento:${hospital}`.slice(0, 120),
          resultado: 'sucesso',
          estacao: estacaoDaRequisicao(req).slice(0, 80),
          correlacao: correlacaoDaRequisicao(req, 'fachada').slice(0, 64),
        },
      )
      .catch((e: unknown) => {
        throw falhaDaConfiguracao(
          e,
          'config.definirParametro',
          'A configuração não foi gravada (nem registrada). Tente de novo.',
        );
      });
    this.servico.esquecer(rede, hospital);
    const valores = await this.servico.valores(rede, hospital);
    return {
      chave: p.data.chave,
      valor: v.valor,
      configuracao: lerConfiguracaoFachada(valores),
      mensagem: 'Configuração da fachada gravada.',
    };
  }
}
