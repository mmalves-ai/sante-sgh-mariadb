// 02-REC linha 33 (C2-005): cadastro dos locais de atendimento de cada recepção e dos encaminhamentos entre locais.
//   GET  /api/recepcao/locais                          recepcao.recepcao.ler
//   POST /api/recepcao/locais/pontos/:id               recepcao.recepcao.editar   (inclui o local na recepção)
//   PUT  /api/recepcao/locais/:id                      recepcao.recepcao.editar
//   PUT  /api/recepcao/locais/:id/destinos             recepcao.recepcao.editar   (a lista inteira de destinos)
//   POST /api/recepcao/locais/:id/situacao             recepcao.recepcao.inativar (desativar com motivo; reativar)
// As gravações levam a trilha na mesma transação (porta própria); na sessão sintética, a porta em memória.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Put, Req } from '@nestjs/common';
import {
  esquemaAlterarLocalAtendimento,
  esquemaDestinosEncaminhamento,
  esquemaIncluirLocalAtendimento,
  esquemaSituacaoEstrutura,
  type EstruturaGravada,
  type LocaisDaRecepcao,
} from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import type { AutorEstrutura } from './estrutura-porta.js';
import { PORTA_LOCAIS_ATENDIMENTO, type PortaLocaisAtendimento } from './locais-atendimento-porta.js';
import { corpo } from './recepcao.controller.js';

const TRILHA =
  'locais de atendimento e encaminhamentos com a trilha na mesma transação (local_atendimento, local_atendimento_encaminhamento)';

const autor = (s: SessaoCadastro): AutorEstrutura => ({
  login: s.login,
  correlacao: correlacaoDaRequisicao(s.req, 'recepcao.estrutura.alterada').slice(0, 64),
  estacao: estacaoDaRequisicao(s.req).slice(0, 80),
});

const feito = (id: number, mensagem: string): EstruturaGravada => ({ ok: true, id, mensagem });

@Controller('recepcao/locais')
export class LocaisAtendimentoController {
  constructor(
    @Optional()
    @Inject(PORTA_LOCAIS_ATENDIMENTO)
    private readonly porta: PortaLocaisAtendimento | null = null,
  ) {}

  private p(): PortaLocaisAtendimento {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'Os locais de atendimento não podem ser lidos nem gravados agora.',
      );
    return this.porta;
  }

  @Get()
  @Permissao('recepcao.recepcao.ler')
  ler(@Req() req: RequisicaoAutorizada): Promise<LocaisDaRecepcao> {
    return this.p().ler(sessaoDe(req).porta);
  }

  @Post('pontos/:id')
  @HttpCode(201)
  @Permissao('recepcao.recepcao.editar')
  @AuditadoNoHandler(TRILHA)
  async incluir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EstruturaGravada> {
    const s = sessaoDe(req);
    const novo = await this.p().incluir(
      s.porta,
      autor(s),
      idDaRota(id),
      corpo(esquemaIncluirLocalAtendimento, b),
    );
    return feito(novo, 'Local de atendimento cadastrado.');
  }

  @Put(':id')
  @Permissao('recepcao.recepcao.editar')
  @AuditadoNoHandler(TRILHA)
  async alterar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EstruturaGravada> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    await this.p().alterar(s.porta, autor(s), n, corpo(esquemaAlterarLocalAtendimento, b));
    return feito(n, 'Local de atendimento alterado.');
  }

  @Put(':id/destinos')
  @Permissao('recepcao.recepcao.editar')
  @AuditadoNoHandler(TRILHA)
  async destinos(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EstruturaGravada> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    await this.p().destinos(s.porta, autor(s), n, corpo(esquemaDestinosEncaminhamento, b));
    return feito(n, 'Encaminhamentos gravados: o guichê já oferece estes destinos.');
  }

  @Post(':id/situacao')
  @HttpCode(201)
  @Permissao('recepcao.recepcao.inativar')
  @AuditadoNoHandler(TRILHA)
  async situacao(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EstruturaGravada> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const e = corpo(esquemaSituacaoEstrutura, b);
    await this.p().situacao(s.porta, autor(s), n, e);
    return feito(n, e.ativo ? 'Reativado.' : 'Desativado: o histórico continua guardado.');
  }
}
