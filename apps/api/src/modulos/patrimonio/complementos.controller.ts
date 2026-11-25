// Complementos do patrimônio (F8, 07-FIN linha 149; CPC 27 / NBC TG 27):
//   GET  /api/patrimonio/complementos/apoio                 grupos, contas analíticas, seguradoras, origens e centros
//   GET  /api/patrimonio/bens/:id/agregacoes                agregações do bem, com o custo e o agregado vigente
//   POST /api/patrimonio/bens/:id/agregacoes                agregar (componente, melhoria, serviço, outro)
//   POST /api/patrimonio/agregacoes/:id/retirada            retirar o componente (data e motivo; nada se apaga)
//   GET  /api/patrimonio/obras?situacao=                    imobilizado em andamento, com o orçamento consumido
//   GET  /api/patrimonio/obras/:id                          a obra com as apropriações
//   POST /api/patrimonio/obras                              abrir a obra (número da sequência do estabelecimento)
//   POST /api/patrimonio/obras/:id/apropriacoes             apropriar o custo do título ou da nota
//   POST /api/patrimonio/obras/:id/ativacao                 ativar: gera o bem pelo custo acumulado
//   POST /api/patrimonio/obras/:id/cancelamento             cancelar a obra sem custo, com motivo
//   GET  /api/patrimonio/apolices                           apólices com a situação vista e o total segurado
//   GET  /api/patrimonio/apolices/:id                       a apólice com os bens, a cobertura e o subseguro
//   POST /api/patrimonio/apolices                           incluir (ou renovar, com a anterior)
//   POST /api/patrimonio/apolices/:id/bens                  segurar o bem
//   POST /api/patrimonio/apolices/:id/cancelamento          cancelar a apólice (os bens saem da cobertura)
//   POST /api/patrimonio/bens-segurados/:id/retirada        retirar o bem da apólice
// Leitura pela permissão de ver os bens; gravação pela de cadastrar bens. Gravações pelo executor, com a trilha na
// mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { PERMISSOES_PATRIMONIO_CODIGOS as P } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  idDaRota,
  linhaTrilha,
  problemaDoCadastro,
  type SessaoCadastro,
  sessaoDe,
} from '../cadastro/comum.js';
import { PORTA_COMPLEMENTOS_PATRIMONIO, type PortaComplementosPatrimonio } from './complementos-propria.js';

type Corpo = Record<string, unknown>;
const corpoDe = (c: unknown): Corpo => (c && typeof c === 'object' && !Array.isArray(c) ? (c as Corpo) : {});
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const id = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const int = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d{1,15}$/.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n))
    throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Valor inválido.');
  return n;
};
const intOuNulo = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : int(v));
const versao = (v: unknown): number => {
  const n = int(v);
  if (n < 0) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Falta a versão.');
  return n;
};

@Controller('patrimonio')
export class ComplementosPatrimonioController {
  constructor(
    @Optional()
    @Inject(PORTA_COMPLEMENTOS_PATRIMONIO)
    private readonly porta: PortaComplementosPatrimonio | null = null,
  ) {}

  private servico(): PortaComplementosPatrimonio {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'Agregação, obras em andamento e seguro dos bens precisam do banco do cliente.',
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
    return linhaTrilha(s, 'patrimonio.complemento.gravado', 'patrimonio', op, {
      tabela,
      id: alvo === null ? null : String(alvo),
    });
  }

  @Get('complementos/apoio')
  @Permissao(P.bemLer)
  apoio(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().apoio(s.porta));
  }

  // ── Agregação ──

  @Get('bens/:id/agregacoes')
  @Permissao(P.bemLer)
  agregacoes(@Param('id') b: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().agregacoes(s.porta, idDaRota(b)));
  }

  @Post('bens/:id/agregacoes')
  @HttpCode(201)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  agregar(@Param('id') b: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const bem = idDaRota(b);
    const x = corpoDe(corpo);
    return this.rodar(() =>
      this.servico().agregar(
        s.porta,
        {
          bem,
          versao: versao(x['versao']),
          tipo: str(x['tipo']),
          bemAgregado: id(x['bemAgregado']),
          nota: id(x['nota']),
          numeroDocumento: txt(x['numeroDocumento']),
          descricao: str(x['descricao']),
          data: str(x['data']),
          valorCent: int(x['valorCent']),
          agregaValor: x['agregaValor'] !== false,
          conta: id(x['conta']),
          observacao: txt(x['observacao']),
        },
        this.trilha(s, 'agregar', 'agregacao_bem', bem),
      ),
    );
  }

  @Post('agregacoes/:id/retirada')
  @HttpCode(200)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  retirarAgregacao(@Param('id') a: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(a);
    const x = corpoDe(corpo);
    return this.rodar(() =>
      this.servico().retirarAgregacao(
        s.porta,
        { id: n, versao: versao(x['versao']), data: str(x['data']), motivo: str(x['motivo']) },
        this.trilha(s, 'retirar-agregacao', 'agregacao_bem', n),
      ),
    );
  }

  // ── Imobilizado em andamento ──

  @Get('obras')
  @Permissao(P.bemLer)
  obras(@Query('situacao') situacao: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = ['em_andamento', 'ativado', 'cancelado'].includes(String(situacao)) ? String(situacao) : null;
    return this.rodar(() => this.servico().obras(s.porta, f));
  }

  @Get('obras/:id')
  @Permissao(P.bemLer)
  obra(@Param('id') o: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().obra(s.porta, idDaRota(o)));
  }

  @Post('obras')
  @HttpCode(201)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  abrirObra(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const x = corpoDe(corpo);
    const grupo = id(x['grupo']);
    if (grupo === null)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Escolha o grupo do bem.');
    return this.rodar(() =>
      this.servico().abrirObra(
        s.porta,
        {
          descricao: str(x['descricao']),
          grupo,
          conta: id(x['conta']),
          centro: id(x['centro']),
          dataInicio: str(x['dataInicio']),
          dataPrevista: txt(x['dataPrevista']),
          orcadoCent: intOuNulo(x['orcadoCent']),
          observacao: txt(x['observacao']),
        },
        this.trilha(s, 'abrir-obra', 'imobilizado_andamento', null),
      ),
    );
  }

  @Post('obras/:id/apropriacoes')
  @HttpCode(201)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  apropriar(@Param('id') o: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const obra = idDaRota(o);
    const x = corpoDe(corpo);
    return this.rodar(() =>
      this.servico().apropriar(
        s.porta,
        {
          obra,
          versao: versao(x['versao']),
          data: str(x['data']),
          titulo: id(x['titulo']),
          nota: id(x['nota']),
          conta: id(x['conta']),
          descricao: txt(x['descricao']),
          valorCent: int(x['valorCent']),
        },
        this.trilha(s, 'apropriar', 'apropriacao_imobilizado_andamento', obra),
      ),
    );
  }

  @Post('obras/:id/ativacao')
  @HttpCode(200)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  ativar(@Param('id') o: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const obra = idDaRota(o);
    const x = corpoDe(corpo);
    const origem = id(x['origem']);
    if (origem === null)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Escolha a origem do bem.');
    return this.rodar(() =>
      this.servico().ativar(
        s.porta,
        {
          obra,
          versao: versao(x['versao']),
          data: str(x['data']),
          vidaUtilMeses: int(x['vidaUtilMeses']),
          plaqueta: str(x['plaqueta']).toUpperCase(),
          origem,
          centro: id(x['centro']),
          residualCent: Math.max(0, intOuNulo(x['residualCent']) ?? 0),
        },
        this.trilha(s, 'ativar-obra', 'imobilizado_andamento', obra),
      ),
    );
  }

  @Post('obras/:id/cancelamento')
  @HttpCode(200)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  cancelarObra(@Param('id') o: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const obra = idDaRota(o);
    const x = corpoDe(corpo);
    return this.rodar(() =>
      this.servico().cancelarObra(
        s.porta,
        { obra, versao: versao(x['versao']), motivo: str(x['motivo']) },
        this.trilha(s, 'cancelar-obra', 'imobilizado_andamento', obra),
      ),
    );
  }

  // ── Seguro ──

  @Get('apolices')
  @Permissao(P.bemLer)
  apolices(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().apolices(s.porta));
  }

  @Get('apolices/:id')
  @Permissao(P.bemLer)
  apolice(@Param('id') a: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().apolice(s.porta, idDaRota(a)));
  }

  @Post('apolices')
  @HttpCode(201)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  incluirApolice(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const x = corpoDe(corpo);
    return this.rodar(() =>
      this.servico().incluirApolice(
        s.porta,
        {
          numero: str(x['numero']),
          tipo: str(x['tipo']),
          seguradora: id(x['seguradora']),
          corretorNome: txt(x['corretorNome']),
          corretorTelefone: txt(x['corretorTelefone']),
          corretorEmail: txt(x['corretorEmail']),
          cobertura: txt(x['cobertura']),
          inicio: str(x['inicio']),
          fim: str(x['fim']),
          premioCent: int(x['premioCent'] ?? 0),
          franquiaCent: intOuNulo(x['franquiaCent']),
          titulo: id(x['titulo']),
          anterior: id(x['anterior']),
        },
        this.trilha(s, 'incluir-apolice', 'apolice_seguro', null),
      ),
    );
  }

  @Post('apolices/:id/bens')
  @HttpCode(201)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  segurarBem(@Param('id') a: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const apolice = idDaRota(a);
    const x = corpoDe(corpo);
    const bem = id(x['bem']);
    if (bem === null) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Escolha o bem.');
    return this.rodar(() =>
      this.servico().segurarBem(
        s.porta,
        {
          apolice,
          versao: versao(x['versao']),
          bem,
          valorSeguradoCent: int(x['valorSeguradoCent']),
          inicio: str(x['inicio']),
        },
        this.trilha(s, 'segurar-bem', 'bem_segurado', apolice),
      ),
    );
  }

  @Post('apolices/:id/cancelamento')
  @HttpCode(200)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  cancelarApolice(@Param('id') a: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(a);
    const x = corpoDe(corpo);
    return this.rodar(() =>
      this.servico().cancelarApolice(
        s.porta,
        { id: n, versao: versao(x['versao']), motivo: str(x['motivo']) },
        this.trilha(s, 'cancelar-apolice', 'apolice_seguro', n),
      ),
    );
  }

  @Post('bens-segurados/:id/retirada')
  @HttpCode(200)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  retirarBem(@Param('id') b: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(b);
    const x = corpoDe(corpo);
    return this.rodar(() =>
      this.servico().retirarBem(
        s.porta,
        { id: n, data: str(x['data']), motivo: str(x['motivo']) },
        this.trilha(s, 'retirar-bem', 'bem_segurado', n),
      ),
    );
  }
}
