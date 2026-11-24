// Rotas da F3.9-6 (sem chave de liberação: só a permissão do cargo):
// Comunicação com o paciente pela Hal-AI (L133):
//   GET  /api/integracoes/mensagens/modelos              modelos do cliente e do estabelecimento
//   PUT  /api/integracoes/mensagens/modelos              inclui ou altera (com a versão lida); ativo=false tira de uso
//   GET  /api/integracoes/mensagens/regras               regras de envio por tipo de aviso
//   PUT  /api/integracoes/mensagens/regras               inclui ou altera a regra (com a versão lida)
//   POST /api/integracoes/mensagens/pedidos              registra o pedido de envio pela regra (momento pelo domínio)
//   POST /api/integracoes/mensagens/pedidos/:id/cancelar cancela o pendente (com o motivo)
//   POST /api/integracoes/mensagens/pedidos/:id/enviado  a Hal-AI aceitou (identificador dela)
//   POST /api/integracoes/mensagens/pedidos/:id/retornos entrega, leitura, resposta, falha, descadastro
//   GET  /api/integracoes/mensagens/paciente/:p          visão por paciente: pedidos com retornos
// Pacotes de parceiros e entregas agendadas (L134):
//   GET  /api/integracoes/pacotes                        pacotes com campos, última entrega e a próxima devida
//   PUT  /api/integracoes/pacotes                        inclui ou altera o pacote e os campos (com a versão lida)
//   GET  /api/integracoes/pacotes/:id/entregas           entregas do pacote
//   POST /api/integracoes/pacotes/:id/entregas           registra a entrega devida (ou a do período, sob demanda)
//   POST /api/integracoes/entregas/:id/situacao          enviada, confirmada, rejeitada ou falhou
// Classificação de risco externa (L140):
//   GET  /api/integracoes/classificacao-externa/perfis         perfis de prioridade
//   PUT  /api/integracoes/classificacao-externa/perfis         inclui ou altera o perfil (com a versão lida)
//   GET  /api/integracoes/classificacao-externa/perfis/envio   o que vai ao sistema de triagem (?sistema=)
//   POST /api/integracoes/classificacao-externa/recebidas      recebe a classificação do atendimento (idempotente)
//   POST /api/integracoes/classificacao-externa/recebidas/:id/aplicacao  gera a classificação interna da recebida
//   GET  /api/integracoes/classificacao-externa/atendimento/:a as recebidas do atendimento, com o prazo
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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { PERMISSOES_CLASSIFICACAO_CODIGOS as PC, PERMISSOES_M34_CODIGOS as P } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  PORTA_CLASSIFICACAO_EXTERNA,
  type PortaClassificacaoExternaPropria,
} from './classificacao-externa-propria.js';
import type { ContextoComunicacao } from './comunicacao-base-propria.js';
import {
  PORTA_MENSAGENS_PACIENTE,
  type PortaMensagensPacientePropria,
} from './mensagens-paciente-propria.js';
import { PORTA_PACOTES_PARCEIRO, type PortaPacotesParceiroPropria } from './pacotes-parceiro-propria.js';

function com<P, T>(
  porta: P | null,
  req: RequisicaoAutorizada,
  fn: (p: P, c: ContextoComunicacao) => Promise<T>,
): Promise<T> {
  if (!porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
  const s = sessaoDe(req);
  return fn(porta, s.porta as ContextoComunicacao).catch((e: unknown) => {
    throw problemaDoCadastro(e);
  });
}

const texto = (corpo: unknown, campo: string): string => {
  const v = (corpo as Record<string, unknown> | null)?.[campo];
  return typeof v === 'string' ? v : '';
};

@Controller('integracoes')
export class ComunicacaoController {
  constructor(
    @Optional()
    @Inject(PORTA_MENSAGENS_PACIENTE)
    private readonly mensagens: PortaMensagensPacientePropria | null = null,
    @Optional()
    @Inject(PORTA_PACOTES_PARCEIRO)
    private readonly pacotes: PortaPacotesParceiroPropria | null = null,
    @Optional()
    @Inject(PORTA_CLASSIFICACAO_EXTERNA)
    private readonly classificacao: PortaClassificacaoExternaPropria | null = null,
  ) {}

  // ── Mensagens ao paciente (L133) ──
  @Get('mensagens/modelos')
  @Permissao(P.mensagemLer)
  modelos(@Req() req: RequisicaoAutorizada) {
    return com(this.mensagens, req, async (p, c) => ({ itens: await p.modelos(c) }));
  }

  @Put('mensagens/modelos')
  @AuditadoNoHandler('executor: trilha na mesma transação da comunicação')
  @Permissao(P.mensagemConfigurar)
  gravarModelo(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return com(this.mensagens, req, (p, c) => p.gravarModelo(c, corpo));
  }

  /** O modelo do cliente inteiro (todos os estabelecimentos): permissão de alcance do cliente. */
  @Put('mensagens/modelos/cliente')
  @AuditadoNoHandler('executor: trilha na mesma transação da comunicação')
  @Permissao(P.mensagemConfigurarCliente)
  gravarModeloCliente(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return com(this.mensagens, req, (p, c) =>
      p.gravarModelo(c, { ...((corpo as Record<string, unknown>) ?? {}), doCliente: true }, true),
    );
  }

  @Get('mensagens/regras')
  @Permissao(P.mensagemLer)
  regras(@Req() req: RequisicaoAutorizada) {
    return com(this.mensagens, req, async (p, c) => ({ itens: await p.regras(c) }));
  }

  @Put('mensagens/regras')
  @AuditadoNoHandler('executor: trilha na mesma transação da comunicação')
  @Permissao(P.mensagemConfigurar)
  gravarRegra(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return com(this.mensagens, req, (p, c) => p.gravarRegra(c, corpo));
  }

  @Post('mensagens/pedidos')
  @AuditadoNoHandler('executor: trilha na mesma transação da comunicação')
  @HttpCode(201)
  @Permissao(P.mensagemEnviar)
  pedir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return com(this.mensagens, req, (p, c) => p.pedir(c, corpo));
  }

  @Post('mensagens/pedidos/:id/cancelar')
  @AuditadoNoHandler('executor: trilha na mesma transação da comunicação')
  @HttpCode(200)
  @Permissao(P.mensagemEnviar)
  cancelar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return com(this.mensagens, req, (p, c) => p.cancelar(c, id, texto(corpo, 'motivo')));
  }

  @Post('mensagens/pedidos/:id/enviado')
  @AuditadoNoHandler('executor: trilha na mesma transação da comunicação')
  @HttpCode(200)
  @Permissao(P.mensagemEnviar)
  enviado(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return com(this.mensagens, req, (p, c) => p.marcarEnviado(c, id, texto(corpo, 'identificadorExterno')));
  }

  @Post('mensagens/pedidos/:id/retornos')
  @AuditadoNoHandler('executor: trilha na mesma transação da comunicação')
  @HttpCode(201)
  @Permissao(P.mensagemEnviar)
  retorno(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return com(this.mensagens, req, (p, c) => p.registrarRetorno(c, id, corpo));
  }

  @Get('mensagens/paciente/:p')
  @Permissao(P.mensagemLer)
  doPaciente(@Req() req: RequisicaoAutorizada, @Param('p', ParseIntPipe) paciente: number) {
    return com(this.mensagens, req, async (p, c) => ({ itens: await p.doPaciente(c, paciente) }));
  }

  // ── Pacotes de parceiros e entregas (L134) ──
  @Get('pacotes')
  @Permissao(P.parceiroLer)
  listarPacotes(@Req() req: RequisicaoAutorizada) {
    return com(this.pacotes, req, async (p, c) => ({ itens: await p.pacotes(c) }));
  }

  @Put('pacotes')
  @AuditadoNoHandler('executor: trilha na mesma transação da comunicação')
  @Permissao(P.parceiroEditar)
  gravarPacote(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return com(this.pacotes, req, (p, c) => p.gravarPacote(c, corpo));
  }

  @Post('pacotes/:id/revisao')
  @AuditadoNoHandler('executor: trilha na mesma transação da comunicação')
  @HttpCode(200)
  @Permissao(P.parceiroRevisarMinimizacao)
  revisarPacote(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    const versao = Number((corpo as Record<string, unknown> | null)?.['versao']);
    return com(this.pacotes, req, (p, c) => p.revisarPacote(c, id, versao));
  }

  @Get('pacotes/:id/entregas')
  @Permissao(P.parceiroLer)
  entregas(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return com(this.pacotes, req, async (p, c) => ({ itens: await p.entregas(c, id) }));
  }

  @Post('pacotes/:id/entregas')
  @AuditadoNoHandler('executor: trilha na mesma transação da comunicação')
  @HttpCode(201)
  @Permissao(P.parceiroEditar)
  registrarEntrega(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return com(this.pacotes, req, (p, c) => p.registrarEntrega(c, id, corpo));
  }

  @Post('entregas/:id/situacao')
  @AuditadoNoHandler('executor: trilha na mesma transação da comunicação')
  @HttpCode(200)
  @Permissao(P.parceiroEditar)
  situacaoEntrega(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return com(this.pacotes, req, (p, c) => p.mudarEntrega(c, id, corpo));
  }

  // ── Classificação de risco externa (L140) ──
  @Get('classificacao-externa/perfis')
  @Permissao(P.hl7Ler)
  perfis(@Req() req: RequisicaoAutorizada) {
    return com(this.classificacao, req, async (p, c) => ({ itens: await p.perfis(c) }));
  }

  @Put('classificacao-externa/perfis')
  @AuditadoNoHandler('executor: trilha na mesma transação da comunicação')
  @Permissao(P.classificacaoExternaConfigurar)
  gravarPerfil(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return com(this.classificacao, req, (p, c) => p.gravarPerfil(c, corpo));
  }

  @Get('classificacao-externa/perfis/envio')
  @Permissao(P.hl7Ler)
  perfisEnvio(@Req() req: RequisicaoAutorizada, @Query('sistema') sistema?: string) {
    return com(this.classificacao, req, async (p, c) => ({
      sistema: sistema ?? null,
      perfis: await p.perfisParaSistema(c, sistema ?? ''),
    }));
  }

  @Post('classificacao-externa/recebidas')
  @AuditadoNoHandler('executor: trilha na mesma transação da comunicação')
  @HttpCode(201)
  @Permissao(PC.classificacaoCriar)
  receber(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return com(this.classificacao, req, (p, c) => p.receber(c, corpo));
  }

  @Post('classificacao-externa/recebidas/:id/aplicacao')
  @AuditadoNoHandler('executor: trilha na mesma transação da comunicação')
  @HttpCode(201)
  @Permissao(PC.classificacaoCriar)
  aplicar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return com(this.classificacao, req, (p, c) => p.aplicar(c, id));
  }

  @Get('classificacao-externa/atendimento/:a')
  @Permissao(PC.classificacaoLer)
  doAtendimento(@Req() req: RequisicaoAutorizada, @Param('a', ParseIntPipe) a: number) {
    return com(this.classificacao, req, async (p, c) => ({ itens: await p.doAtendimento(c, a) }));
  }
}
