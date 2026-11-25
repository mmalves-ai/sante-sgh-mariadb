// C1-112 (09-AREA linha 74): destino do corpo após o óbito no banco do cliente (porta própria; sem banco, 503).
//   GET  /api/internacao/destino-corpo/apoio                     funerárias e cartórios em uso, tipos de parentesco
//   GET  /api/internacao/destino-corpo/funerarias?todas=1        funerárias do estabelecimento
//   POST /api/internacao/destino-corpo/funerarias                inclui a funerária
//   POST /api/internacao/destino-corpo/funerarias/:id            altera (com a versão)
//   POST /api/internacao/destino-corpo/funerarias/:id/uso        tira de uso ou volta (nada se apaga)
//   GET  /api/internacao/destino-corpo/obitos?todos=1            óbitos com o destino em aberto (ou todos)
//   GET  /api/internacao/destino-corpo/pacientes/:p              visão por paciente
//   POST /api/internacao/destino-corpo/declaracoes/:id/destino   funerária e cartório da declaração de óbito
//   POST /api/internacao/destino-corpo/guardas                   guarda do corpo no necrotério
//   POST /api/internacao/destino-corpo/guardas/:id/acao          liberar, retirar, encaminhar ou cancelar
// Níveis de acesso: a escolha na declaração é do médico que emite a declaração; o cadastro das funerárias e a guarda e
// a liberação do corpo são de quem registra a alta da internação (a alta por óbito); a leitura, de quem lê a internação.
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
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_DESTINO_CORPO, type PortaDestinoCorpoPropria } from './destino-corpo-propria.js';

export const PERMISSOES_DESTINO_CORPO = {
  ler: 'internacao.internacao.ler',
  declaracao: 'pep.declaracaoObito.emitir',
  guarda: 'internacao.alta.registrar',
} as const;
const P = PERMISSOES_DESTINO_CORPO;
const TRILHA = 'executor: trilha na mesma transação do destino do corpo';

@Controller('internacao/destino-corpo')
export class DestinoCorpoController {
  constructor(
    @Optional()
    @Inject(PORTA_DESTINO_CORPO)
    private readonly porta: PortaDestinoCorpoPropria | null = null,
  ) {}

  private com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaDestinoCorpoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('apoio')
  @Permissao(P.ler)
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.apoio(c));
  }

  @Get('funerarias')
  @Permissao(P.ler)
  funerarias(@Req() req: RequisicaoAutorizada, @Query('todas') todas?: string) {
    return this.com(req, (p, c) => p.funerarias(c, todas === '1'));
  }

  @Post('funerarias')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(201)
  @Permissao(P.guarda)
  incluirFuneraria(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirFuneraria(c, corpo));
  }

  @Post('funerarias/:id')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(200)
  @Permissao(P.guarda)
  alterarFuneraria(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.alterarFuneraria(c, id, corpo));
  }

  @Post('funerarias/:id/uso')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(200)
  @Permissao(P.guarda)
  usoFuneraria(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.usoFuneraria(c, id, corpo));
  }

  @Get('obitos')
  @Permissao(P.ler)
  obitos(@Req() req: RequisicaoAutorizada, @Query('todos') todos?: string) {
    return this.com(req, (p, c) => p.obitos(c, todos === '1'));
  }

  @Get('pacientes/:paciente')
  @Permissao(P.ler)
  doPaciente(@Req() req: RequisicaoAutorizada, @Param('paciente', ParseIntPipe) paciente: number) {
    return this.com(req, (p, c) => p.obitoDoPaciente(c, paciente));
  }

  @Post('declaracoes/:id/destino')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(200)
  @Permissao(P.declaracao)
  definirDestino(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, async (p, c) => {
      await p.definirDestino(c, id, corpo);
      return p.destino(c, id);
    });
  }

  @Post('guardas')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(201)
  @Permissao(P.guarda)
  abrirGuarda(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.abrirGuarda(c, corpo));
  }

  @Post('guardas/:id/acao')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(200)
  @Permissao(P.guarda)
  acaoGuarda(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.acaoGuarda(c, id, corpo));
  }
}
