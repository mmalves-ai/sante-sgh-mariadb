// Equipes médicas e cooperativas do profissional (F8, 02-CAD linha 22), sobre EquipesCooperativasPropria:
//   GET  /api/cadastros/equipes-cooperativas?profissional=:id     equipes e cooperativas (todas, ou só as do profissional)
//   GET  /api/cadastros/equipes-cooperativas/profissionais?busca=  profissionais ativos pelo nome (até 20)
//   POST /api/cadastros/equipes-cooperativas/equipes               cria ou altera a equipe (id e versão para alterar)
//   POST /api/cadastros/equipes-cooperativas/equipes/:id/membros   inclui o membro com papel e vigência
//   POST /api/cadastros/equipes-cooperativas/membros/:id/encerrar  encerra o membro (fim da vigência; nada apagado)
//   POST /api/cadastros/equipes-cooperativas/cooperativas          cria ou altera a cooperativa médica
//   POST /api/cadastros/equipes-cooperativas/cooperativas/:id/cooperados   inclui o cooperado com vigência
//   POST /api/cadastros/equipes-cooperativas/cooperados/:id/encerrar       encerra o cooperado
// Consulta com cadastro.profissional.ler; gravações com cadastro.profissional.editar, pelo executor, com a trilha na
// mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from './comum.js';
import {
  type EntradaCooperativaTela,
  type EntradaEquipeTela,
  EQUIPES_COOPERATIVAS,
  type EquipesCooperativasPropria,
} from './equipes-cooperativas-proprio.js';

export const PERMISSAO_EQUIPES_LER = 'cadastro.profissional.ler';
export const PERMISSAO_EQUIPES_EDITAR = 'cadastro.profissional.editar';

type Corpo = Record<string, unknown>;
const corpoDe = (c: unknown): Corpo => (c && typeof c === 'object' && !Array.isArray(c) ? (c as Corpo) : {});
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const id = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const dec = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function equipeDe(corpo: unknown): EntradaEquipeTela {
  const b = corpoDe(corpo);
  return {
    id: id(b['id']),
    versao: id(b['versao']),
    codigo: typeof b['codigo'] === 'string' ? b['codigo'] : '',
    nome: typeof b['nome'] === 'string' ? b['nome'] : '',
    tipo: typeof b['tipo'] === 'string' ? b['tipo'] : '',
    setorId: id(b['setorId']),
    inicio: txt(b['inicio']) ?? '',
    fim: txt(b['fim']),
    ativo: b['ativo'] !== false,
  };
}

function cooperativaDe(corpo: unknown): EntradaCooperativaTela {
  const b = corpoDe(corpo);
  return {
    id: id(b['id']),
    versao: id(b['versao']),
    cnpj: typeof b['cnpj'] === 'string' ? b['cnpj'] : '',
    razaoSocial: typeof b['razaoSocial'] === 'string' ? b['razaoSocial'] : '',
    nome: typeof b['nome'] === 'string' ? b['nome'] : '',
    percentualRepasse: dec(b['percentualRepasse']),
    bancoId: id(b['bancoId']),
    agencia: txt(b['agencia']),
    agenciaDigito: txt(b['agenciaDigito']),
    conta: txt(b['conta']),
    contaDigito: txt(b['contaDigito']),
    tipoConta: txt(b['tipoConta']),
    retemIr: b['retemIr'] !== false,
    aliquotaIr: dec(b['aliquotaIr']),
    aliquotaIss: dec(b['aliquotaIss']),
    aliquotaPis: dec(b['aliquotaPis']),
    aliquotaCofins: dec(b['aliquotaCofins']),
    aliquotaCsll: dec(b['aliquotaCsll']),
    optanteSimples: b['optanteSimples'] === true,
    ativo: b['ativo'] !== false,
  };
}

@Controller('cadastros/equipes-cooperativas')
export class EquipesCooperativasController {
  constructor(
    @Optional()
    @Inject(EQUIPES_COOPERATIVAS)
    private readonly porta: EquipesCooperativasPropria | null = null,
  ) {}

  private servico(): EquipesCooperativasPropria {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'As equipes e cooperativas precisam do banco do cliente.',
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

  private trilha(s: SessaoCadastro, op: string, tabela: string, alvo: number | null) {
    return linhaTrilha(s, 'cadastro.equipe-cooperativa.gravado', 'cadastro.profissional', op, {
      tabela,
      id: alvo === null ? null : String(alvo),
    });
  }

  @Get()
  @Permissao(PERMISSAO_EQUIPES_LER)
  visao(@Query('profissional') p: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const prof = p ? idDaRota(p) : null;
    return this.rodar(() => this.servico().visao(s.porta, prof));
  }

  @Get('profissionais')
  @Permissao(PERMISSAO_EQUIPES_LER)
  profissionais(@Query('busca') busca: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().buscarProfissionais(s.porta, String(busca ?? '').slice(0, 100)));
  }

  @Post('equipes')
  @HttpCode(200)
  @Permissao(PERMISSAO_EQUIPES_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async salvarEquipe(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = equipeDe(corpo);
    const t = this.trilha(s, e.id === null ? 'criar' : 'alterar', 'equipe_profissional', e.id);
    return { id: await this.rodar(() => this.servico().salvarEquipe(s.porta, e, t)) };
  }

  @Post('equipes/:id/membros')
  @HttpCode(201)
  @Permissao(PERMISSAO_EQUIPES_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async incluirMembro(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = {
      equipeId: n,
      profissionalId: id(b['profissionalId']) ?? 0,
      papel: typeof b['papel'] === 'string' ? b['papel'] : '',
      inicio: txt(b['inicio']) ?? '',
      fim: txt(b['fim']),
    };
    const t = this.trilha(s, 'incluir-membro', 'equipe_profissional_membro', null);
    return { id: await this.rodar(() => this.servico().incluirMembro(s.porta, e, t)) };
  }

  @Post('membros/:id/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSAO_EQUIPES_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async encerrarMembro(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = { id: n, versao: id(b['versao']) ?? 0, fim: txt(b['fim']) ?? '' };
    const t = this.trilha(s, 'encerrar-membro', 'equipe_profissional_membro', n);
    return { id: await this.rodar(() => this.servico().encerrarMembro(s.porta, e, t)) };
  }

  @Post('cooperativas')
  @HttpCode(200)
  @Permissao(PERMISSAO_EQUIPES_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async salvarCooperativa(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = cooperativaDe(corpo);
    const t = this.trilha(s, e.id === null ? 'criar' : 'alterar', 'cooperativa_medica', e.id);
    return { id: await this.rodar(() => this.servico().salvarCooperativa(s.porta, e, t)) };
  }

  @Post('cooperativas/:id/cooperados')
  @HttpCode(201)
  @Permissao(PERMISSAO_EQUIPES_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async incluirCooperado(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = {
      cooperativaId: n,
      profissionalId: id(b['profissionalId']) ?? 0,
      inicio: txt(b['inicio']) ?? '',
      fim: txt(b['fim']),
    };
    const t = this.trilha(s, 'incluir-cooperado', 'membro_cooperativa', null);
    return { id: await this.rodar(() => this.servico().incluirCooperado(s.porta, e, t)) };
  }

  @Post('cooperados/:id/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSAO_EQUIPES_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async encerrarCooperado(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = { id: n, versao: id(b['versao']) ?? 0, fim: txt(b['fim']) ?? '' };
    const t = this.trilha(s, 'encerrar-cooperado', 'membro_cooperativa', n);
    return { id: await this.rodar(() => this.servico().encerrarCooperado(s.porta, e, t)) };
  }
}
