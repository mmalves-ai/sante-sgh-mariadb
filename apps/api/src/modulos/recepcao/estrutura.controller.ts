// 02-REC linha 33: cadastro da estrutura da recepção pela tela (o hospital novo monta a recepção sem carga prévia).
//   GET  /api/recepcao/estrutura                              recepcao.recepcao.ler
//   GET  /api/recepcao/estrutura/servicos                     recepcao.gerador.ler (a mesma leitura)
//   POST /api/recepcao/estrutura/pontos                       recepcao.recepcao.criar
//   PUT  /api/recepcao/estrutura/pontos/:id                   recepcao.recepcao.editar
//   POST /api/recepcao/estrutura/pontos/:id/situacao          recepcao.recepcao.inativar
//   POST /api/recepcao/estrutura/pontos/:id/guiches           recepcao.recepcao.editar
//   PUT  /api/recepcao/estrutura/guiches/:id                  recepcao.recepcao.editar
//   POST /api/recepcao/estrutura/guiches/:id/situacao         recepcao.recepcao.editar
//   POST /api/recepcao/estrutura/pontos/:id/servicos          recepcao.gerador.criar
//   PUT  /api/recepcao/estrutura/servicos/:id                 recepcao.gerador.editar
//   POST /api/recepcao/estrutura/servicos/:id/situacao        recepcao.gerador.inativar
// As gravações levam a trilha na mesma transação (porta própria); na sessão sintética, a porta em memória.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Put, Req } from '@nestjs/common';
import {
  esquemaAlterarGuicheRecepcao,
  esquemaAlterarPontoRecepcao,
  esquemaAlterarServicoSenha,
  esquemaIncluirGuicheRecepcao,
  esquemaIncluirPontoRecepcao,
  esquemaIncluirServicoSenha,
  esquemaSituacaoEstrutura,
  type EstruturaGravada,
  type EstruturaRecepcao,
} from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import {
  type AutorEstrutura,
  type ItemEstrutura,
  PORTA_ESTRUTURA_RECEPCAO,
  type PortaEstruturaRecepcao,
} from './estrutura-porta.js';
import { corpo } from './recepcao.controller.js';

const TRILHA =
  'estrutura da recepção com a trilha na mesma transação (ponto_recepcao, guiche_recepcao, gerador_senha)';

const autor = (s: SessaoCadastro): AutorEstrutura => ({
  login: s.login,
  correlacao: correlacaoDaRequisicao(s.req, 'recepcao.estrutura.alterada').slice(0, 64),
  estacao: estacaoDaRequisicao(s.req).slice(0, 80),
});

const feito = (id: number, mensagem: string): EstruturaGravada => ({ ok: true, id, mensagem });

@Controller('recepcao/estrutura')
export class EstruturaRecepcaoController {
  constructor(
    @Optional()
    @Inject(PORTA_ESTRUTURA_RECEPCAO)
    private readonly porta: PortaEstruturaRecepcao | null = null,
  ) {}

  private p(): PortaEstruturaRecepcao {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O cadastro da recepção não pode ser lido nem gravado agora.',
      );
    return this.porta;
  }

  @Get()
  @Permissao('recepcao.recepcao.ler')
  ler(@Req() req: RequisicaoAutorizada): Promise<EstruturaRecepcao> {
    return this.p().ler(sessaoDe(req).porta);
  }

  /** A mesma leitura para quem cuida só dos serviços de senha (a tela dos geradores). */
  @Get('servicos')
  @Permissao('recepcao.gerador.ler')
  lerServicos(@Req() req: RequisicaoAutorizada): Promise<EstruturaRecepcao> {
    return this.p().ler(sessaoDe(req).porta);
  }

  @Post('pontos')
  @HttpCode(201)
  @Permissao('recepcao.recepcao.criar')
  @AuditadoNoHandler(TRILHA)
  async incluirPonto(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<EstruturaGravada> {
    const s = sessaoDe(req);
    const id = await this.p().incluirPonto(s.porta, autor(s), corpo(esquemaIncluirPontoRecepcao, b));
    return feito(id, 'Recepção cadastrada. Inclua os guichês e os serviços de senha.');
  }

  @Put('pontos/:id')
  @Permissao('recepcao.recepcao.editar')
  @AuditadoNoHandler(TRILHA)
  async alterarPonto(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EstruturaGravada> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    await this.p().alterarPonto(s.porta, autor(s), n, corpo(esquemaAlterarPontoRecepcao, b));
    return feito(n, 'Recepção alterada.');
  }

  @Post('pontos/:id/situacao')
  @HttpCode(201)
  @Permissao('recepcao.recepcao.inativar')
  @AuditadoNoHandler(TRILHA)
  situacaoPonto(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.situacao('ponto', id, b, req);
  }

  @Post('pontos/:id/guiches')
  @HttpCode(201)
  @Permissao('recepcao.recepcao.editar')
  @AuditadoNoHandler(TRILHA)
  async incluirGuiche(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EstruturaGravada> {
    const s = sessaoDe(req);
    const g = corpo(esquemaIncluirGuicheRecepcao, b);
    const novo = await this.p().incluirGuiche(s.porta, autor(s), idDaRota(id), g);
    return feito(novo, `Guichê ${g.numero} cadastrado.`);
  }

  @Put('guiches/:id')
  @Permissao('recepcao.recepcao.editar')
  @AuditadoNoHandler(TRILHA)
  async alterarGuiche(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EstruturaGravada> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    await this.p().alterarGuiche(s.porta, autor(s), n, corpo(esquemaAlterarGuicheRecepcao, b));
    return feito(n, 'Guichê alterado.');
  }

  @Post('guiches/:id/situacao')
  @HttpCode(201)
  @Permissao('recepcao.recepcao.editar')
  @AuditadoNoHandler(TRILHA)
  situacaoGuiche(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.situacao('guiche', id, b, req);
  }

  @Post('pontos/:id/servicos')
  @HttpCode(201)
  @Permissao('recepcao.gerador.criar')
  @AuditadoNoHandler(TRILHA)
  async incluirServico(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EstruturaGravada> {
    const s = sessaoDe(req);
    const novo = await this.p().incluirServico(
      s.porta,
      autor(s),
      idDaRota(id),
      corpo(esquemaIncluirServicoSenha, b),
    );
    return feito(novo, 'Serviço de senha cadastrado: o botão já aparece no balcão e no totem.');
  }

  @Put('servicos/:id')
  @Permissao('recepcao.gerador.editar')
  @AuditadoNoHandler(TRILHA)
  async alterarServico(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EstruturaGravada> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    await this.p().alterarServico(s.porta, autor(s), n, corpo(esquemaAlterarServicoSenha, b));
    return feito(n, 'Serviço de senha alterado.');
  }

  @Post('servicos/:id/situacao')
  @HttpCode(201)
  @Permissao('recepcao.gerador.inativar')
  @AuditadoNoHandler(TRILHA)
  situacaoServico(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.situacao('servico', id, b, req);
  }

  private async situacao(
    item: ItemEstrutura,
    id: string,
    b: unknown,
    req: RequisicaoAutorizada,
  ): Promise<EstruturaGravada> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const e = corpo(esquemaSituacaoEstrutura, b);
    await this.p().situacao(s.porta, autor(s), item, n, e);
    return feito(n, e.ativo ? 'Reativado.' : 'Desativado: o histórico continua guardado.');
  }
}
