// Ligações do cadastro (F3.1, 02-CAD linhas 17, 18 e 20), sobre CadastroLigacoesProprio:
//   GET  /api/cadastros/especialidades/:id/ligacoes                       procedimentos com vigência e ocupações (CBO)
//   POST /api/cadastros/especialidades/:id/procedimentos-permitidos       inclui o procedimento com a vigência
//   POST /api/cadastros/especialidades/:id/procedimentos-permitidos/:rid/encerrar   encerra a vigência (a linha fica)
//   POST /api/cadastros/especialidades/:id/ocupacoes                      liga a ocupação (uma principal)
//   POST /api/cadastros/especialidades/:id/ocupacoes/:rid/retirar         retira (exclusão lógica)
//   GET  /api/cadastros/profissionais/:id/lotacoes                        lotações por estabelecimento e unidade
//   POST /api/cadastros/profissionais/:id/lotacoes                        inclui (CBO, carga semanal, vínculo, vigência)
//   POST /api/cadastros/profissionais/:id/lotacoes/:rid/encerrar          encerra a vigência (a linha fica)
//   GET  /api/cadastros/ligacoes/opcoes?termo=                            estabelecimentos, unidades, vínculos, CBO, procedimentos
//   GET  /api/cadastros/solicitantes/parecidos?nome=&conselho=&uf=&numero= parecidos antes de incluir (aviso na hora)
//   GET  /api/cadastros/solicitantes/:id/ficha                            ficha, campos da guia, parecidos e códigos
//   PUT  /api/cadastros/solicitantes/:id                                  altera os dados e corrige o registro (colisão recusada)
//   POST /api/cadastros/solicitantes/:id/situacao                         inativa ou reativa, com o motivo (nunca apaga)
//   POST /api/cadastros/solicitantes/:id/codigos                          código na fonte pagadora (inclui, troca, inativa)
// Acesso só pelos níveis de cada cargo (cadastro.especialidade.editar, cadastro.profissional.editar,
// cadastro.solicitante.editar). Gravações pelo executor, com a trilha na mesma transação.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { type CadastroLigacoesProprio, LIGACOES_CADASTRO } from './cadastro-ligacoes-proprio.js';
import { idDaRota, linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from './comum.js';

export const PERMISSAO_ESPECIALIDADE_EDITAR = 'cadastro.especialidade.editar';
export const PERMISSAO_SOLICITANTE_EDITAR = 'cadastro.solicitante.editar';

type Corpo = Record<string, unknown>;
const corpoDe = (c: unknown): Corpo => (c && typeof c === 'object' && !Array.isArray(c) ? (c as Corpo) : {});
const txt = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null;
const digitos = (v: unknown): string | null => {
  const d = typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\D+/g, '') : '';
  return d === '' ? null : d;
};
const id = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const inteiro = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const sim = (v: unknown): boolean => v === true;
/** Acesso total: o administrador da plataforma (ADR 0022) lota em qualquer estabelecimento; os demais, só no da sessão. */
const acessoTotal = (req: RequisicaoAutorizada): boolean => req.sgh?.sessao.usuario.ator === 'plataforma';

@Controller('cadastros')
export class CadastroLigacoesController {
  constructor(
    @Optional()
    @Inject(LIGACOES_CADASTRO)
    private readonly porta: CadastroLigacoesProprio | null = null,
  ) {}

  private servico(): CadastroLigacoesProprio {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'Esta gravação precisa do banco do cliente.',
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

  private trilha(s: SessaoCadastro, evento: string, op: string, tabela: string, dono: number) {
    return linhaTrilha(s, evento, 'cadastro.ligacoes', op, { tabela, id: String(dono) });
  }

  private encerrar(corpo: unknown, dono: number, rid: string) {
    const b = corpoDe(corpo);
    return { dono, id: idDaRota(rid), versao: id(b['versao']) ?? 0, fim: txt(b['fim']) };
  }

  // ── Especialidade ──

  @Get('especialidades/:id/ligacoes')
  @Permissao('cadastro.profissional.ler')
  ligacoes(@Param('id') p: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().ligacoesEspecialidade(s.porta, idDaRota(p)));
  }

  @Post('especialidades/:id/procedimentos-permitidos')
  @HttpCode(201)
  @Permissao(PERMISSAO_ESPECIALIDADE_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async incluirProcedimento(
    @Param('id') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = {
      especialidade: n,
      procedimento: id(b['procedimento']) ?? 0,
      vigenciaInicio: txt(b['vigenciaInicio']) ?? '',
      vigenciaFim: txt(b['vigenciaFim']),
    };
    const t = this.trilha(
      s,
      'cadastro.especialidade.gravada',
      'incluirProcedimento',
      'especialidade_procedimento',
      n,
    );
    return { id: await this.rodar(() => this.servico().incluirProcedimento(s.porta, e, t)) };
  }

  @Post('especialidades/:id/procedimentos-permitidos/:rid/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSAO_ESPECIALIDADE_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async encerrarProcedimento(
    @Param('id') p: string,
    @Param('rid') rid: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const t = this.trilha(
      s,
      'cadastro.especialidade.gravada',
      'encerrarProcedimento',
      'especialidade_procedimento',
      n,
    );
    return {
      id: await this.rodar(() =>
        this.servico().encerrarProcedimento(s.porta, this.encerrar(corpo, n, rid), t),
      ),
    };
  }

  @Post('especialidades/:id/ocupacoes')
  @HttpCode(201)
  @Permissao(PERMISSAO_ESPECIALIDADE_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async gravarOcupacao(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = { especialidade: n, ocupacao: id(b['ocupacao']) ?? 0, principal: sim(b['principal']) };
    const t = this.trilha(s, 'cadastro.especialidade.gravada', 'gravarOcupacao', 'especialidade_ocupacao', n);
    return { id: await this.rodar(() => this.servico().gravarOcupacao(s.porta, e, t)) };
  }

  @Post('especialidades/:id/ocupacoes/:rid/retirar')
  @HttpCode(200)
  @Permissao(PERMISSAO_ESPECIALIDADE_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async retirarOcupacao(
    @Param('id') p: string,
    @Param('rid') rid: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const { dono, id: r, versao } = this.encerrar(corpo, n, rid);
    const t = this.trilha(
      s,
      'cadastro.especialidade.gravada',
      'retirarOcupacao',
      'especialidade_ocupacao',
      n,
    );
    return {
      id: await this.rodar(() => this.servico().retirarOcupacao(s.porta, { dono, id: r, versao }, t)),
    };
  }

  // ── Lotação ──

  @Get('profissionais/:id/lotacoes')
  @Permissao('cadastro.profissional.ler')
  lotacoes(@Param('id') p: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().lotacoes(s.porta, idDaRota(p), acessoTotal(req)));
  }

  @Get('ligacoes/opcoes')
  @Permissao('cadastro.profissional.ler')
  opcoes(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().opcoes(s.porta, txt(termo), acessoTotal(req)));
  }

  @Post('profissionais/:id/lotacoes')
  @HttpCode(201)
  @Permissao('cadastro.profissional.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async incluirLotacao(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = {
      profissional: n,
      estabelecimento: id(b['estabelecimento']) ?? 0,
      unidade: id(b['unidade']),
      ocupacao: id(b['ocupacao']) ?? 0,
      inscricao: id(b['inscricao']),
      tipoVinculo: id(b['tipoVinculo']),
      cargaAmbulatorial: inteiro(b['cargaAmbulatorial']),
      cargaHospitalar: inteiro(b['cargaHospitalar']),
      cargaOutros: inteiro(b['cargaOutros']),
      ocupacaoPadrao: sim(b['ocupacaoPadrao']),
      atendeSus: sim(b['atendeSus']),
      geraRepasse: sim(b['geraRepasse']),
      vigenciaInicio: txt(b['vigenciaInicio']) ?? '',
      vigenciaFim: txt(b['vigenciaFim']),
    };
    const t = this.trilha(s, 'cadastro.profissional.gravado', 'incluirLotacao', 'lotacao_profissional', n);
    return { id: await this.rodar(() => this.servico().incluirLotacao(s.porta, e, t, acessoTotal(req))) };
  }

  @Post('profissionais/:id/lotacoes/:rid/encerrar')
  @HttpCode(200)
  @Permissao('cadastro.profissional.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async encerrarLotacao(
    @Param('id') p: string,
    @Param('rid') rid: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const t = this.trilha(s, 'cadastro.profissional.gravado', 'encerrarLotacao', 'lotacao_profissional', n);
    return {
      id: await this.rodar(() =>
        this.servico().encerrarLotacao(s.porta, this.encerrar(corpo, n, rid), t, acessoTotal(req)),
      ),
    };
  }

  // ── Solicitante externo ──

  @Get('solicitantes/parecidos')
  @Permissao('cadastro.solicitante.ler')
  parecidos(
    @Query('nome') nome: string | undefined,
    @Query('conselho') conselho: string | undefined,
    @Query('uf') uf: string | undefined,
    @Query('numero') numero: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const n = digitos(numero);
    return this.rodar(() =>
      this.servico().parecidosCom(s.porta, {
        nome: txt(nome) ?? '',
        conselho: txt(conselho)?.toUpperCase() ?? null,
        uf: txt(uf)?.toUpperCase() ?? null,
        numero: n ? Number(n) : null,
      }),
    );
  }

  @Get('solicitantes/:id/ficha')
  @Permissao('cadastro.solicitante.ler')
  ficha(@Param('id') p: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().fichaSolicitante(s.porta, idDaRota(p)));
  }

  @Put('solicitantes/:id')
  @HttpCode(200)
  @Permissao(PERMISSAO_SOLICITANTE_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async alterar(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = {
      id: n,
      versao: id(b['versao']) ?? 0,
      nome: txt(b['nome']) ?? '',
      ...(txt(b['conselho']) ? { conselho: txt(b['conselho'])! } : {}),
      ...(txt(b['uf']) ? { uf: txt(b['uf'])! } : {}),
      ...(digitos(b['numero']) ? { numero: digitos(b['numero'])! } : {}),
      cpf: digitos(b['cpf']),
      cns: digitos(b['cns']),
      ocupacao: id(b['ocupacao']),
      especialidade: id(b['especialidade']),
      instituicaoNome: txt(b['instituicaoNome']),
      instituicaoCnpj: digitos(b['instituicaoCnpj']),
      instituicaoCnes: digitos(b['instituicaoCnes']),
      telefone: txt(b['telefone']),
      email: txt(b['email']),
      observacao: txt(b['observacao']),
    };
    const t = this.trilha(s, 'cadastro.solicitante.alterado', 'alterarSolicitante', 'solicitante_externo', n);
    return { id: await this.rodar(() => this.servico().alterarSolicitante(s.porta, e, t)) };
  }

  @Post('solicitantes/:id/situacao')
  @HttpCode(200)
  @Permissao(PERMISSAO_SOLICITANTE_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async situacao(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = {
      id: n,
      versao: id(b['versao']) ?? 0,
      ativo: sim(b['ativo']),
      motivo: txt(b['motivo']) ?? '',
      data: txt(b['data']),
    };
    const t = this.trilha(
      s,
      'cadastro.solicitante.alterado',
      'situacaoSolicitante',
      'solicitante_externo',
      n,
    );
    return { id: await this.rodar(() => this.servico().mudarSituacaoSolicitante(s.porta, e, t)) };
  }

  @Post('solicitantes/:id/codigos')
  @HttpCode(200)
  @Permissao(PERMISSAO_SOLICITANTE_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async codigo(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = {
      solicitante: n,
      fonte: id(b['fonte']) ?? 0,
      codigo: txt(b['codigo']) ?? '',
      ativo: b['ativo'] !== false,
    };
    const t = this.trilha(
      s,
      'cadastro.solicitante.alterado',
      'codigoNaFonte',
      'solicitante_externo_fonte_pagadora',
      n,
    );
    return { id: await this.rodar(() => this.servico().gravarCodigoFonte(s.porta, e, t)) };
  }
}
