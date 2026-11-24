// Calendário de feriados e dias não úteis (F3.1, 02-CAD linha 28), sobre CalendarioProprio:
//   GET  /api/cadastros/calendario?ano=                 o ano: cadastro (ativos e inativos), o que vale aqui e o que a
//                                                       agenda pula, com os nacionais calculados
//   GET  /api/cadastros/calendario/municipios?termo=    municípios pelo nome (feriado municipal de outro município)
//   POST /api/cadastros/calendario                      inclui (abrangência, recorrência, facultativo, faixa do dia)
//   PUT  /api/cadastros/calendario/:id                  altera (versão lida pela tela)
//   POST /api/cadastros/calendario/:id/situacao         inativa (com motivo) ou reativa; nunca apaga
//   POST /api/cadastros/calendario/moveis               gera a data móvel de cada ano (Páscoa), sem duplicar
// Acesso só pelos níveis de cada cargo: consulta com organizacao.estrutura.ler, gravação com cadastro.calendario.editar.
// Gravações pelo executor, com a trilha na mesma transação.
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
import {
  CALENDARIO_CADASTRO,
  type CalendarioProprio,
  type EntradaCalendario,
  type EntradaMoveis,
} from './calendario-proprio.js';
import { idDaRota, linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from './comum.js';

export const PERMISSAO_CALENDARIO_EDITAR = 'cadastro.calendario.editar';
export const PERMISSAO_CALENDARIO_LER = 'organizacao.estrutura.ler';

type Corpo = Record<string, unknown>;
const corpoDe = (c: unknown): Corpo => (c && typeof c === 'object' && !Array.isArray(c) ? (c as Corpo) : {});
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const id = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const inteiro = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) ? n : -1;
};

function entradaDe(corpo: unknown): EntradaCalendario {
  const b = corpoDe(corpo);
  const abr = String(b['abrangencia'] ?? '');
  const rec = String(b['recorrencia'] ?? '');
  return {
    descricao: typeof b['descricao'] === 'string' ? b['descricao'] : '',
    abrangencia: abr as EntradaCalendario['abrangencia'],
    ufId: id(b['ufId']),
    municipio: id(b['municipio']),
    estabelecimento: id(b['estabelecimento']),
    recorrencia: rec as EntradaCalendario['recorrencia'],
    dia: inteiro(b['dia']),
    mes: inteiro(b['mes']),
    data: txt(b['data']),
    facultativo: b['facultativo'] === true,
    horaInicio: txt(b['horaInicio']),
    horaFim: txt(b['horaFim']),
  };
}

@Controller('cadastros/calendario')
export class CalendarioController {
  constructor(
    @Optional()
    @Inject(CALENDARIO_CADASTRO)
    private readonly porta: CalendarioProprio | null = null,
  ) {}

  private servico(): CalendarioProprio {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'O calendário precisa do banco do cliente.',
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
    return linhaTrilha(s, 'cadastro.calendario.gravado', 'cadastro.calendario', op, {
      tabela: 'dia_nao_util',
      id: alvo === null ? null : String(alvo),
    });
  }

  @Get()
  @Permissao(PERMISSAO_CALENDARIO_LER)
  visao(@Query('ano') ano: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const a = ano && /^\d{4}$/.test(ano) ? Number(ano) : new Date().getFullYear();
    return this.rodar(() => this.servico().visao(s.porta, a));
  }

  @Get('municipios')
  @Permissao(PERMISSAO_CALENDARIO_LER)
  municipios(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().municipios(s.porta, String(termo ?? '').slice(0, 80)));
  }

  @Post()
  @HttpCode(201)
  @Permissao(PERMISSAO_CALENDARIO_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async incluir(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const t = this.trilha(s, 'incluir', null);
    return { id: await this.rodar(() => this.servico().incluir(s.porta, entradaDe(corpo), t)) };
  }

  @Post('moveis')
  @HttpCode(201)
  @Permissao(PERMISSAO_CALENDARIO_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async moveis(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const b = corpoDe(corpo);
    const base = entradaDe(corpo);
    const e: EntradaMoveis = {
      base: String(b['base'] ?? '') as EntradaMoveis['base'],
      anoInicio: inteiro(b['anoInicio']) ?? 0,
      anoFim: inteiro(b['anoFim']) ?? 0,
      descricao: txt(b['descricao']),
      abrangencia: base.abrangencia,
      ufId: base.ufId,
      municipio: base.municipio,
      estabelecimento: base.estabelecimento,
      facultativo: base.facultativo,
    };
    const t = this.trilha(s, 'gerarMoveis', null);
    return this.rodar(() => this.servico().gerarMoveis(s.porta, e, t));
  }

  @Put(':id')
  @HttpCode(200)
  @Permissao(PERMISSAO_CALENDARIO_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async alterar(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const v = id(corpoDe(corpo)['versao']) ?? 0;
    const t = this.trilha(s, 'alterar', n);
    return { id: await this.rodar(() => this.servico().alterar(s.porta, n, v, entradaDe(corpo), t)) };
  }

  @Post(':id/situacao')
  @HttpCode(200)
  @Permissao(PERMISSAO_CALENDARIO_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async situacao(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = {
      id: n,
      versao: id(b['versao']) ?? 0,
      ativo: b['ativo'] === true,
      motivo: txt(b['motivo']) ?? '',
    };
    const t = this.trilha(s, 'situacao', n);
    return { id: await this.rodar(() => this.servico().situacao(s.porta, e, t)) };
  }
}
