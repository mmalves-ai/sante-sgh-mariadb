// SAME pelo volume (F3.9, 04-HOT L126). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/same/guarda/operacoes                      operações ativas com tipo, sentido e exigências
//   GET  /api/same/guarda/apoio                          locais de guarda (caminho, capacidade, ocupação), setores e tipos
//   POST /api/same/guarda/locais                         inclui um local na árvore (sala, armário, prateleira, caixa)
//   GET  /api/same/guarda/busca?prontuario=|etiqueta=    o paciente (e o volume, pela etiqueta lida)
//   GET  /api/same/guarda/pacientes/:paciente/volumes    visão por paciente: volumes, onde está cada um e a linha do tempo
//   POST /api/same/guarda/volumes                        abre o volume com o local e a posição (já registrado no arquivo)
//   POST /api/same/guarda/volumes/:id/movimentos         movimenta pela operação do cadastro (decide pelo tipo e sentido)
//   GET  /api/same/guarda/deliberacoes                   deliberações da comissão de revisão de prontuários (descarte)
//   POST /api/same/guarda/volumes/:id/descarte           elimina o volume: prazo de guarda cumprido e deliberação
//   POST /api/same/guarda/volumes/:id/desfazer           desfaz o último movimento (exclusão lógica com motivo)
//   POST /api/same/guarda/volumes/:id/extravio           registra o extravio com o motivo
//   POST /api/same/guarda/volumes/:id/guarda-externa     envia o volume do arquivo à empresa de guarda externa (caixa)
//   POST /api/same/guarda/volumes/:id/guarda-externa/retorno   o retorno da guarda externa ao local de guarda
// Níveis de acesso: os do SAME (same.movimento.ler/criar/excluir), para todo cargo que os tiver. A eliminação do volume
// (irreversível) fica no nível de excluir, não no de movimentar.
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
import { PORTA_SAME_GUARDA, type PortaSameGuardaPropria } from './same-guarda-propria.js';

export const PERMISSOES_SAME_GUARDA = {
  ler: 'same.movimento.ler',
  movimentar: 'same.movimento.criar',
  desfazer: 'same.movimento.excluir',
  descartar: 'same.movimento.excluir',
} as const;

@Controller('same/guarda')
export class SameGuardaController {
  constructor(
    @Optional() @Inject(PORTA_SAME_GUARDA) private readonly porta: PortaSameGuardaPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaSameGuardaPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('operacoes')
  @Permissao(PERMISSOES_SAME_GUARDA.ler)
  operacoes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.operacoes(c) }));
  }

  @Get('apoio')
  @Permissao(PERMISSOES_SAME_GUARDA.ler)
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.apoio(c));
  }

  @Post('locais')
  @AuditadoNoHandler('executor: trilha na mesma transação da guarda do prontuário')
  @HttpCode(201)
  @Permissao(PERMISSOES_SAME_GUARDA.movimentar)
  incluirLocal(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirLocal(c, corpo));
  }

  @Get('busca')
  @Permissao(PERMISSOES_SAME_GUARDA.ler)
  busca(
    @Req() req: RequisicaoAutorizada,
    @Query('prontuario') prontuario?: string,
    @Query('etiqueta') etiqueta?: string,
  ) {
    return this.com(req, async (p, c) => {
      if (etiqueta?.trim()) {
        const r = await p.volumePorEtiqueta(c, etiqueta);
        if (!r) throw new ErroProblema('nao-encontrado', 404, 'Volume não encontrado', 'Confira a etiqueta.');
        return r;
      }
      const n = Number(prontuario);
      const paciente = Number.isSafeInteger(n) && n > 0 ? await p.pacientePorProntuario(c, n) : null;
      if (!paciente)
        throw new ErroProblema(
          'nao-encontrado',
          404,
          'Paciente não encontrado',
          'Confira o número do prontuário.',
        );
      return { paciente, volume: null };
    });
  }

  @Get('pacientes/:paciente/volumes')
  @Permissao(PERMISSOES_SAME_GUARDA.ler)
  volumes(@Req() req: RequisicaoAutorizada, @Param('paciente', ParseIntPipe) paciente: number) {
    return this.com(req, async (p, c) => ({ itens: await p.volumesDoPaciente(c, paciente) }));
  }

  @Post('volumes')
  @AuditadoNoHandler('executor: trilha na mesma transação da guarda do prontuário')
  @HttpCode(201)
  @Permissao(PERMISSOES_SAME_GUARDA.movimentar)
  abrir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.abrirVolume(c, corpo));
  }

  @Post('volumes/:id/movimentos')
  @AuditadoNoHandler('executor: trilha na mesma transação da guarda do prontuário')
  @HttpCode(201)
  @Permissao(PERMISSOES_SAME_GUARDA.movimentar)
  movimentar(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.movimentar(c, id, corpo));
  }

  @Get('deliberacoes')
  @Permissao(PERMISSOES_SAME_GUARDA.ler)
  deliberacoes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.deliberacoesDescarte(c) }));
  }

  @Post('volumes/:id/descarte')
  @AuditadoNoHandler('executor: trilha na mesma transação da guarda do prontuário')
  @HttpCode(201)
  @Permissao(PERMISSOES_SAME_GUARDA.descartar)
  descartar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.descartar(c, id, corpo));
  }

  @Post('volumes/:id/desfazer')
  @AuditadoNoHandler('executor: trilha na mesma transação da guarda do prontuário')
  @HttpCode(200)
  @Permissao(PERMISSOES_SAME_GUARDA.desfazer)
  desfazer(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.desfazerUltimo(c, id, corpo));
  }

  @Post('volumes/:id/extravio')
  @AuditadoNoHandler('executor: trilha na mesma transação da guarda do prontuário')
  @HttpCode(200)
  @Permissao(PERMISSOES_SAME_GUARDA.movimentar)
  extravio(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.registrarExtravio(c, id, corpo));
  }

  @Post('volumes/:id/guarda-externa')
  @AuditadoNoHandler('executor: trilha na mesma transação da guarda do prontuário')
  @HttpCode(200)
  @Permissao(PERMISSOES_SAME_GUARDA.movimentar)
  enviarGuardaExterna(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.guardaExterna(c, id, 'envio', corpo));
  }

  @Post('volumes/:id/guarda-externa/retorno')
  @AuditadoNoHandler('executor: trilha na mesma transação da guarda do prontuário')
  @HttpCode(200)
  @Permissao(PERMISSOES_SAME_GUARDA.movimentar)
  retornarGuardaExterna(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.guardaExterna(c, id, 'retorno', corpo));
  }
}
