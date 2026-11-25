// Rotas do custo-padrão por procedimento (07-FIN L140, C2-115; F8) — a tela `Controladoria > Custos hospitalares >
// Custo-padrão por procedimento` (`/custos/custo-padrao`). Ler com custos.apuracao.ler; gravar com custos.apuracao.apurar
// (quem apura o custo mantém o padrão com que ele é comparado):
//   GET  custos/fichas-padrao?termo=&situacao=          fichas do estabelecimento (procedimento, versão, vigência, total)
//   GET  custos/fichas-padrao/procedimentos?termo=      procedimentos para abrir a ficha
//   GET  custos/fichas-padrao/referencias?tipo=&termo=  itens do tipo com o custo unitário de referência vigente
//   GET  custos/fichas-padrao/:id                       a ficha com os itens, o total por tipo e as outras versões
//   GET  custos/fichas-padrao/:id/comparacao?competencia=AAAA-MM  padrão × apurado das contas da competência
//   POST custos/fichas-padrao                           nova ficha em rascunho (opcional: copiar a vigente)
//   POST custos/fichas-padrao/:id/itens                 incluir item (custo de referência quando não informado)
//   POST custos/fichas-padrao/:id/itens/:item/retirada  retirar item do rascunho (fica com a data de exclusão)
//   POST custos/fichas-padrao/:id/ativacao              ativar (a anterior é encerrada na véspera)
//   POST custos/fichas-padrao/:id/inativacao            inativar com motivo (vai à trilha)
// Cada gravação vai pela porta própria (Executor do núcleo), com a trilha_auditoria na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { SITUACOES_FICHA_CUSTO, TIPOS_ITEM_FICHA } from '@sgh/dominio-custos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import {
  idDaRota,
  linhaTrilha,
  problemaDoCadastro,
  type SessaoCadastro,
  sessaoDe,
} from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  type FichaGravada,
  PORTA_FICHA_CUSTO_PADRAO,
  type PortaFichaCustoPadraoPropria,
} from './ficha-custo-padrao-propria.js';

const LER = 'custos.apuracao.ler';
const GRAVAR = 'custos.apuracao.apurar';
const AUD = 'custos.ficha-padrao gravada com a trilha_auditoria na mesma transação (porta própria)';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const versao = z.number().int().positive();

const esquemaNova = z.object({
  procedimento: id,
  descricao: z.string().min(1).max(200),
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
  setorFuncional: id.nullable(),
  copiarVigente: z.boolean(),
});
const esquemaItem = z.object({
  versao,
  tipo: z.enum(TIPOS_ITEM_FICHA),
  referencia: id.nullable(),
  descricao: z.string().max(100).nullable(),
  quantidade: z.number().positive().max(99_999_999_999),
  custoUnitario: z.number().min(0).max(99_999_999_999).nullable(),
});
const esquemaVersao = z.object({ versao });
const esquemaInativar = z.object({ versao, motivo: z.string().min(1).max(500) });
const esquemaLista = z.object({
  termo: z.string().max(100).optional(),
  situacao: z.enum(SITUACOES_FICHA_CUSTO).optional(),
});
const esquemaBusca = z.object({ termo: z.string().max(100).default('') });
const esquemaReferencias = z.object({
  tipo: z.enum(TIPOS_ITEM_FICHA),
  termo: z.string().max(100).default(''),
});
const esquemaComparacao = z.object({
  competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  tolerancia: z.coerce.number().int().min(0).max(10_000).optional(),
});

@Controller()
export class FichaCustoPadraoController {
  constructor(@Inject(PORTA_FICHA_CUSTO_PADRAO) private readonly porta: PortaFichaCustoPadraoPropria) {}

  private trilha(s: SessaoCadastro, evento: string, motivo?: string) {
    return (r: FichaGravada) => ({
      ...linhaTrilha(s, evento, 'custos.ficha-padrao', evento, {
        tabela: 'ficha_custo_padrao',
        id: String(r.id),
      }),
      ...(motivo ? { motivo } : {}),
    });
  }
  private async ok<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  // ---- rotas fixas antes das rotas com :id ----
  @Get('custos/fichas-padrao')
  @Permissao(LER)
  listar(@Query() q: unknown, @Req() req: RequisicaoAutorizada) {
    const f = corpo(esquemaLista, q);
    return this.ok(
      this.porta.listar(sessaoDe(req).porta, { termo: f.termo ?? null, situacao: f.situacao ?? null }),
    );
  }

  @Get('custos/fichas-padrao/procedimentos')
  @Permissao(LER)
  procedimentos(@Query() q: unknown, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.procedimentos(sessaoDe(req).porta, corpo(esquemaBusca, q).termo));
  }

  @Get('custos/fichas-padrao/referencias')
  @Permissao(LER)
  referencias(@Query() q: unknown, @Req() req: RequisicaoAutorizada) {
    const r = corpo(esquemaReferencias, q);
    return this.ok(this.porta.referencias(sessaoDe(req).porta, r.tipo, r.termo));
  }

  @Post('custos/fichas-padrao')
  @HttpCode(201)
  @Permissao(GRAVAR)
  @AuditadoNoHandler(AUD)
  criar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.criar(s.porta, corpo(esquemaNova, b), this.trilha(s, 'custos.ficha-padrao.criada')),
    );
  }

  @Get('custos/fichas-padrao/:id')
  @Permissao(LER)
  detalhar(@Param('id') f: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.detalhar(sessaoDe(req).porta, idDaRota(f)));
  }

  @Get('custos/fichas-padrao/:id/comparacao')
  @Permissao(LER)
  comparar(@Param('id') f: string, @Query() q: unknown, @Req() req: RequisicaoAutorizada) {
    const c = corpo(esquemaComparacao, q);
    return this.ok(this.porta.comparar(sessaoDe(req).porta, idDaRota(f), c.competencia, c.tolerancia));
  }

  @Post('custos/fichas-padrao/:id/itens')
  @HttpCode(201)
  @Permissao(GRAVAR)
  @AuditadoNoHandler(AUD)
  incluirItem(@Param('id') f: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirItem(
        s.porta,
        idDaRota(f),
        corpo(esquemaItem, b),
        this.trilha(s, 'custos.ficha-padrao.item-incluido'),
      ),
    );
  }

  @Post('custos/fichas-padrao/:id/itens/:item/retirada')
  @HttpCode(200)
  @Permissao(GRAVAR)
  @AuditadoNoHandler(AUD)
  retirarItem(
    @Param('id') f: string,
    @Param('item') i: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.retirarItem(
        s.porta,
        idDaRota(f),
        idDaRota(i),
        corpo(esquemaVersao, b).versao,
        this.trilha(s, 'custos.ficha-padrao.item-retirado'),
      ),
    );
  }

  @Post('custos/fichas-padrao/:id/ativacao')
  @HttpCode(200)
  @Permissao(GRAVAR)
  @AuditadoNoHandler(AUD)
  ativar(@Param('id') f: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.ativar(
        s.porta,
        idDaRota(f),
        corpo(esquemaVersao, b).versao,
        this.trilha(s, 'custos.ficha-padrao.ativada'),
      ),
    );
  }

  @Post('custos/fichas-padrao/:id/inativacao')
  @HttpCode(200)
  @Permissao(GRAVAR)
  @AuditadoNoHandler(AUD)
  inativar(@Param('id') f: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaInativar, b);
    return this.ok(
      this.porta.inativar(
        s.porta,
        idDaRota(f),
        e.versao,
        e.motivo,
        this.trilha(s, 'custos.ficha-padrao.inativada', e.motivo),
      ),
    );
  }
}
