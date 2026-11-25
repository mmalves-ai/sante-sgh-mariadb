// Profissional provisório (F8, 02-CAD linha 21), sobre ProfissionalProvisorioProprio:
//   GET  /api/cadastros/profissionais-provisorios?filtro=abertos|vencidos|todos   lista com o alerta do prazo
//   GET  /api/cadastros/profissionais-provisorios/:id                             registros ligados e candidatos
//   GET  /api/cadastros/profissionais-provisorios/:id/registros?tipo=&busca=      registros a ligar (número/paciente)
//   POST /api/cadastros/profissionais-provisorios                                 cadastro mínimo (conselho+UF, motivo)
//   POST /api/cadastros/profissionais-provisorios/:id/usos                        liga um registro ao provisório
//   POST /api/cadastros/profissionais-provisorios/:id/prazo                       prorroga o prazo (com motivo)
//   POST /api/cadastros/profissionais-provisorios/:id/regularizar                 liga ao definitivo e transfere
//        (registro fechado, faturado ou com outro profissional só com { confirmar: true })
//   POST /api/cadastros/profissionais-provisorios/:id/cancelar                    cancela (sem registro pendente)
// Consulta com cadastro.profissional.ler; cadastro mínimo, registro ligado e prazo com cadastro.profissional.criar;
// regularizar e cancelar com cadastro.profissional.editar. Gravações pelo executor, com a trilha na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from './comum.js';
import {
  type EntradaProvisorioTela,
  type EntradaUso,
  PROFISSIONAL_PROVISORIO,
  type ProfissionalProvisorioProprio,
} from './profissional-provisorio-proprio.js';

export const PERMISSAO_PROVISORIO_LER = 'cadastro.profissional.ler';
export const PERMISSAO_PROVISORIO_CRIAR = 'cadastro.profissional.criar';
export const PERMISSAO_PROVISORIO_EDITAR = 'cadastro.profissional.editar';

const TIPOS_USO = ['atendimento', 'paciente', 'agendamento_cirurgico', 'agendamento_internacao'] as const;

type Corpo = Record<string, unknown>;
const corpoDe = (c: unknown): Corpo => (c && typeof c === 'object' && !Array.isArray(c) ? (c as Corpo) : {});
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const id = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

function entradaDe(corpo: unknown): EntradaProvisorioTela {
  const b = corpoDe(corpo);
  return {
    nome: typeof b['nome'] === 'string' ? b['nome'] : '',
    cpf: txt(b['cpf']),
    conselhoId: id(b['conselhoId']),
    numeroConselho: txt(b['numeroConselho']),
    ufConselhoId: id(b['ufConselhoId']),
    ocupacaoId: id(b['ocupacaoId']),
    especialidadeId: id(b['especialidadeId']),
    telefone: txt(b['telefone']),
    motivo: typeof b['motivo'] === 'string' ? b['motivo'] : '',
    dataInicio: txt(b['dataInicio']) ?? '',
    prazo: txt(b['prazo']),
    observacao: txt(b['observacao']),
  };
}

@Controller('cadastros/profissionais-provisorios')
export class ProfissionalProvisorioController {
  constructor(
    @Optional()
    @Inject(PROFISSIONAL_PROVISORIO)
    private readonly porta: ProfissionalProvisorioProprio | null = null,
  ) {}

  private servico(): ProfissionalProvisorioProprio {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'O profissional provisório precisa do banco do cliente.',
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

  private trilha(s: SessaoCadastro, op: string, alvo: number | null) {
    return linhaTrilha(s, 'cadastro.profissional-provisorio.gravado', 'cadastro.profissional', op, {
      tabela: 'profissional_provisorio',
      id: alvo === null ? null : String(alvo),
    });
  }

  @Get()
  @Permissao(PERMISSAO_PROVISORIO_LER)
  visao(@Query('filtro') filtro: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = filtro === 'vencidos' || filtro === 'todos' ? filtro : 'abertos';
    return this.rodar(() => this.servico().visao(s.porta, f));
  }

  @Get(':id')
  @Permissao(PERMISSAO_PROVISORIO_LER)
  detalhe(@Param('id') p: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    return this.rodar(() => this.servico().detalhe(s.porta, n));
  }

  @Get(':id/registros')
  @Permissao(PERMISSAO_PROVISORIO_LER)
  registros(
    @Param('id') p: string,
    @Query('tipo') tipo: string | undefined,
    @Query('busca') busca: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    idDaRota(p);
    const tp = TIPOS_USO.find((x) => x === tipo) ?? 'atendimento';
    return this.rodar(() =>
      this.servico().buscarRegistros(s.porta, tp, typeof busca === 'string' ? busca : ''),
    );
  }

  @Post()
  @HttpCode(201)
  @Permissao(PERMISSAO_PROVISORIO_CRIAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async criar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const t = this.trilha(s, 'criar', null);
    return { id: await this.rodar(() => this.servico().criar(s.porta, entradaDe(corpo), t)) };
  }

  @Post(':id/usos')
  @HttpCode(201)
  @Permissao(PERMISSAO_PROVISORIO_CRIAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async ligar(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e: EntradaUso = {
      id: n,
      tipo: String(b['tipo'] ?? '') as EntradaUso['tipo'],
      registroId: id(b['registroId']) ?? 0,
    };
    const t = this.trilha(s, 'ligar', n);
    return { id: await this.rodar(() => this.servico().ligar(s.porta, e, t)) };
  }

  @Post(':id/prazo')
  @HttpCode(200)
  @Permissao(PERMISSAO_PROVISORIO_CRIAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async prorrogar(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = {
      id: n,
      versao: id(b['versao']) ?? 0,
      prazo: txt(b['prazo']) ?? '',
      motivo: txt(b['motivo']) ?? '',
    };
    const t = this.trilha(s, 'prorrogar', n);
    return { id: await this.rodar(() => this.servico().prorrogar(s.porta, e, t)) };
  }

  @Post(':id/regularizar')
  @HttpCode(200)
  @Permissao(PERMISSAO_PROVISORIO_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async regularizar(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = {
      id: n,
      versao: id(b['versao']) ?? 0,
      profissional: id(b['profissional']) ?? 0,
      confirmar: b['confirmar'] === true,
    };
    const t = this.trilha(s, 'regularizar', n);
    return this.rodar(() => this.servico().regularizar(s.porta, e, t));
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Permissao(PERMISSAO_PROVISORIO_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async cancelar(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = { id: n, versao: id(b['versao']) ?? 0, motivo: txt(b['motivo']) ?? '' };
    const t = this.trilha(s, 'cancelar', n);
    return { id: await this.rodar(() => this.servico().cancelar(s.porta, e, t)) };
  }
}
