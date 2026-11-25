// Paciente com acesso restrito ao prontuário (F8, 02-CAD linha 10):
//   GET  /api/cadastros/acesso-restrito                          pacientes com marca viva neste estabelecimento
//   GET  /api/cadastros/acesso-restrito/destinos?busca=          profissionais e equipes para liberar
//   GET  /api/cadastros/pacientes/:id/acesso-restrito            marcas do paciente com as liberações
//   POST /api/cadastros/pacientes/:id/acesso-restrito            marcar (tipo, motivo, vigência, exibição do nome)
//   POST /api/cadastros/acesso-restrito/:marca/encerrar          encerrar a marca com motivo (nunca apagar)
//   POST /api/cadastros/acesso-restrito/:marca/liberacoes        liberar profissional ou equipe (justificativa)
//   POST /api/cadastros/acesso-restrito/liberacoes/:id/revogar   revogar a liberação (fim agora)
// Gravações pelo executor, com a trilha na mesma transação; a decisão nas leituras clínicas é o interceptador.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  ACESSO_RESTRITO,
  type AcessoRestritoProprio,
  type EntradaLiberacaoTela,
  type EntradaMarcaTela,
} from './acesso-restrito-proprio.js';
import { idDaRota, linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from './comum.js';

export const PERMISSAO_RESTRITO_LER = 'cadastro.acessoRestrito.ler';
export const PERMISSAO_RESTRITO_EDITAR = 'cadastro.acessoRestrito.editar';

type Corpo = Record<string, unknown>;
const corpoDe = (c: unknown): Corpo => (c && typeof c === 'object' && !Array.isArray(c) ? (c as Corpo) : {});
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const id = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

@Controller('cadastros')
export class AcessoRestritoController {
  constructor(
    @Optional()
    @Inject(ACESSO_RESTRITO)
    private readonly porta: AcessoRestritoProprio | null = null,
  ) {}

  private servico(): AcessoRestritoProprio {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'O acesso restrito ao prontuário precisa do banco do cliente.',
      );
    return this.porta;
  }

  private async rodar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  private trilha(
    s: SessaoCadastro,
    op: string,
    tabela: string,
    alvo: number | null,
    paciente: number | null,
  ) {
    return linhaTrilha(s, 'cadastro.acesso-restrito.gravado', 'cadastro.acessoRestrito', op, {
      tabela,
      id: alvo === null ? null : String(alvo),
      paciente,
    });
  }

  @Get('acesso-restrito')
  @Permissao(PERMISSAO_RESTRITO_LER)
  pacientes(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().pacientes(s.porta));
  }

  @Get('acesso-restrito/destinos')
  @Permissao(PERMISSAO_RESTRITO_EDITAR)
  destinos(@Query('busca') busca: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().destinos(s.porta, String(busca ?? '').slice(0, 100)));
  }

  @Get('pacientes/:id/acesso-restrito')
  @Permissao(PERMISSAO_RESTRITO_LER)
  visao(@Param('id') p: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().visao(s.porta, idDaRota(p)));
  }

  @Post('pacientes/:id/acesso-restrito')
  @HttpCode(201)
  @Permissao(PERMISSAO_RESTRITO_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async marcar(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const paciente = idDaRota(p);
    const b = corpoDe(corpo);
    const e: EntradaMarcaTela = {
      paciente,
      todosEstabelecimentos: b['todosEstabelecimentos'] === true,
      tipo: typeof b['tipo'] === 'string' ? b['tipo'] : '',
      motivo: typeof b['motivo'] === 'string' ? b['motivo'] : '',
      exibicao: typeof b['exibicao'] === 'string' ? b['exibicao'] : 'normal',
      pseudonimo: txt(b['pseudonimo']),
      exigeQuebraVidro: b['exigeQuebraVidro'] !== false,
      inicio: txt(b['inicio']) ?? '',
      fim: txt(b['fim']),
    };
    const t = this.trilha(s, 'marcar', 'paciente_acesso_restrito', null, paciente);
    return { id: await this.rodar(() => this.servico().marcar(s.porta, e, t)) };
  }

  @Post('acesso-restrito/:marca/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSAO_RESTRITO_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async encerrar(@Param('marca') m: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const marca = idDaRota(m);
    const b = corpoDe(corpo);
    const versao = id(b['versao']);
    if (versao === null)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Falta a versão.');
    const t = this.trilha(s, 'encerrar', 'paciente_acesso_restrito', marca, null);
    return {
      id: await this.rodar(() =>
        this.servico().encerrar(
          s.porta,
          { id: marca, versao, motivo: typeof b['motivo'] === 'string' ? b['motivo'] : '' },
          t,
        ),
      ),
    };
  }

  @Post('acesso-restrito/:marca/liberacoes')
  @HttpCode(201)
  @Permissao(PERMISSAO_RESTRITO_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async liberar(@Param('marca') m: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const b = corpoDe(corpo);
    const e: EntradaLiberacaoTela = {
      marca: idDaRota(m),
      profissionalId: id(b['profissionalId']),
      equipeId: id(b['equipeId']),
      justificativa: typeof b['justificativa'] === 'string' ? b['justificativa'] : '',
      inicio: txt(b['inicio']) ?? '',
      fim: txt(b['fim']),
    };
    const t = this.trilha(s, 'liberar', 'liberacao_acesso_restrito', null, null);
    return { id: await this.rodar(() => this.servico().liberar(s.porta, e, t)) };
  }

  @Post('acesso-restrito/liberacoes/:id/revogar')
  @HttpCode(200)
  @Permissao(PERMISSAO_RESTRITO_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async revogar(@Param('id') l: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const lib = idDaRota(l);
    const versao = id(corpoDe(corpo)['versao']);
    if (versao === null)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Falta a versão.');
    const t = this.trilha(s, 'revogar', 'liberacao_acesso_restrito', lib, null);
    return { id: await this.rodar(() => this.servico().revogar(s.porta, { id: lib, versao }, t)) };
  }
}
