// F7, 08-INTG linha 131: rotas da troca por serviço web com o SUS (rastreamento de câncer e cadastro de prestador).
//   GET  /api/sus/servicos-web?servico&situacao&paciente     os envios com as respostas (e o modo: simulador ou produção)
//   GET  /api/sus/servicos-web/rastreamento?prontuario       visão por paciente: os exames pedidos e o envio de cada um
//   GET  /api/sus/servicos-web/prestadores?termo             profissionais com cartão e ocupação
//   POST /api/sus/servicos-web                               registrar o envio (rastreamento ou cadastro de prestador)
//   POST /api/sus/servicos-web/:id/envio                     enviar (simulador fora de produção) e gravar a resposta
//   POST /api/sus/servicos-web/:id/cancelamento              { versao, motivo } (nada é apagado)
// A gravação vai pelo executor do núcleo (trilha e idempotência na mesma transação); sem núcleo: 503.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { conferirEnvioWebSus } from '@sgh/dominio-faturamento';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { ENVIADOR_SERVICO_WEB_SUS, type EnviadorServicoWebSus } from './servico-web-enviador.js';
import {
  candidatosPrestador,
  candidatosRastreamento,
  envioParaTransmitir,
  esquemaFiltroServicoWebSus,
  OPERACOES_SERVICO_WEB_SUS,
  painelServicoWebSus,
} from './servico-web-propria.js';

export const NUCLEO_SERVICO_WEB_SUS = Symbol('NUCLEO_SERVICO_WEB_SUS');

const idDe = (v: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, 'Envio inválido');
  return n;
};

@Controller('sus/servicos-web')
export class ServicoWebSusController {
  private readonly executor: Executor | null;

  constructor(
    @Inject(ENVIADOR_SERVICO_WEB_SUS) private readonly enviador: EnviadorServicoWebSus,
    @Optional() @Inject(NUCLEO_SERVICO_WEB_SUS) private readonly nucleo: NucleoProprio | null = null,
  ) {
    this.executor = nucleo ? nucleo.criarExecutor() : null;
  }

  private ler<T>(req: RequisicaoAutorizada, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const s = sessaoDe(req);
    const est = s.porta.estabelecimento;
    if (!this.nucleo) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    if (est === null) throw new ErroProblema('entrada-invalida', 409, 'Escolha o estabelecimento da sessão');
    return this.nucleo.lerSomente(
      { ...s.porta, correlacao: (s.porta.correlacao || 'sus-servico-web').slice(0, 64) },
      (l) => fn(l, est),
    );
  }

  private async gravar(
    req: RequisicaoAutorizada,
    op: keyof typeof OPERACOES_SERVICO_WEB_SUS,
    entrada: unknown,
  ): Promise<Record<string, unknown>> {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const s = sessaoDe(req);
    const r = await this.executor
      .executar(OPERACOES_SERVICO_WEB_SUS[op] as never, s.porta.cliente, entrada, contextoOperacao(s, op))
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    return { ...(r.resultado as Record<string, unknown>), repetida: r.repetida };
  }

  @Get()
  @Permissao('faturamento.susServicoWeb.ler')
  async painel(@Query() q: Record<string, string | undefined>, @Req() req: RequisicaoAutorizada) {
    const f = esquemaFiltroServicoWebSus.safeParse({
      ...(q['servico'] ? { servico: q['servico'] } : {}),
      ...(q['situacao'] ? { situacao: q['situacao'] } : {}),
      ...(q['paciente'] ? { paciente: Number(q['paciente']) } : {}),
    });
    if (!f.success) throw new ErroProblema('entrada-invalida', 400, 'Filtro inválido');
    const r = await this.ler(req, (l, est) => painelServicoWebSus(l, est, f.data));
    return { ...r, modo: this.enviador.modo };
  }

  @Get('rastreamento')
  @Permissao('faturamento.susServicoWeb.ler')
  rastreamento(@Query('prontuario') prontuario: string | undefined, @Req() req: RequisicaoAutorizada) {
    const p = (prontuario ?? '').trim();
    if (!/^\d{1,20}$/.test(p)) throw new ErroProblema('entrada-invalida', 400, 'Prontuário inválido');
    return this.ler(req, (l, est) => candidatosRastreamento(l, est, p));
  }

  @Get('prestadores')
  @Permissao('faturamento.susServicoWeb.ler')
  async prestadores(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    const t = (termo ?? '').trim();
    if (t.length < 3) throw new ErroProblema('entrada-invalida', 400, 'Digite ao menos 3 letras do nome');
    return { itens: await this.ler(req, (l) => candidatosPrestador(l, t)) };
  }

  @Post()
  @HttpCode(200)
  @Permissao('faturamento.susServicoWeb.enviar')
  @AuditadoNoHandler('envio ao serviço web do SUS registrado pelo executor, com a trilha na mesma transação')
  registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar(req, 'faturamento.susServicoWebRegistrar', b);
  }

  @Post(':id/envio')
  @HttpCode(200)
  @Permissao('faturamento.susServicoWeb.enviar')
  @AuditadoNoHandler('resposta do serviço web do SUS gravada pelo executor, com a trilha na mesma transação')
  async enviar(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const envio = idDe(id);
    const atual = await this.ler(req, (l, est) => envioParaTransmitir(l, est, envio));
    if (!atual) throw new ErroProblema('nao-encontrado', 404, 'Envio não encontrado');
    // Nada vai ao serviço sem passar pela regra (o aceito, o cancelado e o esgotado não são reenviados).
    const antes = conferirEnvioWebSus(atual.situacao, atual.tentativas);
    if (antes)
      throw new ErroProblema('recusa-de-negocio', 409, antes.mensagem, undefined, {
        codigo: antes.codigo,
        campos: antes.campos ? [...antes.campos] : [],
      });
    // O transporte fica fora da transação; a operação confere de novo a situação, as tentativas e a versão.
    const resposta = await this.enviador.enviar(atual.servico, atual.conteudo);
    const r = await this.gravar(req, 'faturamento.susServicoWebResposta', {
      envio,
      versao: atual.versao,
      resposta,
    });
    return { ...r, modo: this.enviador.modo };
  }

  @Post(':id/cancelamento')
  @HttpCode(200)
  @Permissao('faturamento.susServicoWeb.enviar')
  @AuditadoNoHandler('envio ao serviço web do SUS cancelado com motivo, sem apagar, com a trilha')
  cancelar(
    @Param('id') id: string,
    @Body() b: Record<string, unknown> | null,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.gravar(req, 'faturamento.susServicoWebCancelar', { ...(b ?? {}), envio: idDe(id) });
  }
}
