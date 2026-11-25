// Central de material esterilizado (CME; F7, 05-SUP linha 29; RDC 15/2012). Rotas (porta própria; sem banco do
// cliente, 503):
//   GET  /api/cirurgia/cme                                  painel: caixas, equipamentos, métodos, pacotes, ciclos e
//                                                           solicitações em aberto
//   GET  /api/cirurgia/cme/produtos?busca=                 produtos do estoque para as peças da caixa (3 letras)
//   GET  /api/cirurgia/cme/rastreio?etiqueta=               do pacote ao ciclo, à cirurgia e ao paciente
//   GET  /api/cirurgia/cme/cirurgias/:agendamento           os pacotes entregues e usados na cirurgia
//   (a caixa se cadastra só em POST /api/cirurgia/cme/cadastro/caixas, com composição, fases e foto)
//   POST /api/cirurgia/cme/equipamentos                     cadastra o equipamento de esterilização
//   POST /api/cirurgia/cme/solicitacoes                     o setor ou a cirurgia pede material estéril
//   POST /api/cirurgia/cme/pacotes                          prepara o pacote da caixa (etiqueta)
//   POST /api/cirurgia/cme/ciclos                           abre a carga no equipamento
//   POST /api/cirurgia/cme/ciclos/:id/concluir              indicadores e desfecho (liberado, reprovado, aguardando)
//   POST /api/cirurgia/cme/ciclos/:id/liberar               leitura do biológico da carga com implante
//   POST /api/cirurgia/cme/pacotes/:id/entregar             o pacote estéril sai para a cirurgia
//   POST /api/cirurgia/cme/pacotes/:id/usar                 o pacote é aberto na cirurgia (rastreio ao paciente)
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { PERMISSOES_CME } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_CME, type PortaCmePropria } from './cme-propria.js';

@Controller('cirurgia/cme')
export class CmeController {
  constructor(
    @Optional()
    @Inject(PORTA_CME)
    private readonly porta: PortaCmePropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaCmePropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_CME.ler)
  painel(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.painel(c));
  }

  @Get('produtos')
  @Permissao(PERMISSOES_CME.ler)
  produtos(@Req() req: RequisicaoAutorizada, @Query('busca') busca?: string) {
    return this.com(req, (p, c) => p.produtos(c, busca ?? '').then((itens) => ({ itens })));
  }

  @Get('rastreio')
  @Permissao(PERMISSOES_CME.ler)
  rastreio(@Req() req: RequisicaoAutorizada, @Query('etiqueta') etiqueta?: string) {
    if (!etiqueta?.trim()) throw new ErroProblema('entrada-invalida', 400, 'Informe o código da etiqueta');
    return this.com(req, (p, c) => p.rastreio(c, etiqueta));
  }

  @Get('cirurgias/:agendamento')
  @Permissao(PERMISSOES_CME.ler)
  daCirurgia(@Req() req: RequisicaoAutorizada, @Param('agendamento', ParseIntPipe) agendamento: number) {
    return this.com(req, (p, c) => p.pacotesDaCirurgia(c, agendamento));
  }

  // A caixa (com a composição, as fases e a foto) se inclui só pelo cadastro da CME, com as regras de cme/cadastro:
  // POST /api/cirurgia/cme/cadastro/caixas (CmeCadastroController). Não há segundo caminho de cadastro de caixa.

  @Post('equipamentos')
  @HttpCode(201)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('equipamento de esterilização pelo executor (trilha na mesma transação)')
  equipamento(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.criarEquipamento(c, corpo));
  }

  @Post('solicitacoes')
  @HttpCode(201)
  @Permissao(PERMISSOES_CME.solicitar)
  @AuditadoNoHandler('solicitação de material estéril pelo executor (trilha na mesma transação)')
  solicitar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.solicitar(c, corpo));
  }

  @Post('pacotes')
  @HttpCode(201)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('pacote estéril preparado pelo executor (trilha na mesma transação)')
  pacote(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.prepararPacote(c, corpo));
  }

  @Post('ciclos')
  @HttpCode(201)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('ciclo de esterilização aberto pelo executor (trilha na mesma transação)')
  ciclo(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.abrirCiclo(c, corpo));
  }

  @Post('ciclos/:id/concluir')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('ciclo de esterilização concluído pelo executor (trilha na mesma transação)')
  concluir(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.concluirCiclo(c, id, corpo));
  }

  @Post('ciclos/:id/liberar')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('ciclo de esterilização liberado pelo executor (trilha na mesma transação)')
  liberar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.liberarCiclo(c, id, corpo));
  }

  @Post('pacotes/:id/entregar')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('pacote estéril entregue à cirurgia pelo executor (trilha na mesma transação)')
  entregar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.entregar(c, id, corpo));
  }

  @Post('pacotes/:id/usar')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME.usar)
  @AuditadoNoHandler('pacote estéril usado na cirurgia pelo executor (trilha na mesma transação)')
  usar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.usar(c, id, corpo));
  }
}
