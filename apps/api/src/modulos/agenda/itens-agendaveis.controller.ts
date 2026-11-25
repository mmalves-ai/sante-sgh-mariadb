// Rotas dos itens agendáveis (02-AGE linha 45). Ler o cadastro: quem lê a agenda. Manter o item e as regras: a
// permissão de manutenção da agenda (agenda.cobertura.editar), como os perfis de marcação. Na marcação: a crítica e os
// itens lançados com o preparo, por quem lê marcações; lançar os itens, por quem agenda. Sem banco próprio, 503: o
// cadastro é do banco do cliente.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import { corpo } from './agendas.controller.js';
import { contextoGravacao } from './apoio.js';
import {
  esquemaLancarItens,
  esquemaSalvarItem,
  type ItemLido,
  type ItemResumo,
  type ItensAgendaveisPropria,
  type ItensDaMarcacao,
  type OpcoesItem,
  type ResultadoCriticaLida,
} from './itens-agendaveis.js';

export const ITENS_AGENDAVEIS = Symbol('ITENS_AGENDAVEIS');

/** Lista de ids na consulta ("1,2,3"); inválido vira 400 pelo esquema da gravação. */
const listaDeIds = (v: string | undefined): number[] =>
  (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '')
    .map((x) => idDaRota(x));

@Controller('agenda/itens-agendaveis')
export class ItensAgendaveisController {
  constructor(
    @Optional() @Inject(ITENS_AGENDAVEIS) private readonly itens: ItensAgendaveisPropria | null = null,
  ) {}

  private exigirBanco(): ItensAgendaveisPropria {
    if (!this.itens)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'Os itens agendáveis ficam no banco do estabelecimento, que não está configurado.',
      );
    return this.itens;
  }

  private gravacao(s: SessaoCadastro, rotulo: string) {
    const g = contextoGravacao(s, rotulo, true);
    return {
      hospital: s.hospital,
      login: s.login,
      correlacao: g.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
    };
  }

  private leitura(req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return { hospital: s.hospital, login: s.login };
  }

  @Get()
  @Permissao('agenda.agenda.ler')
  listar(@Query('busca') busca: string | undefined, @Req() req: RequisicaoAutorizada): Promise<ItemResumo[]> {
    return this.exigirBanco().listar(this.leitura(req), busca ?? null);
  }

  @Get('opcoes')
  @Permissao('agenda.agenda.ler')
  opcoes(@Req() req: RequisicaoAutorizada): Promise<OpcoesItem> {
    return this.exigirBanco().opcoes(this.leitura(req));
  }

  @Get('marcacao/:id')
  @Permissao('agenda.marcacao.ler')
  daMarcacao(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ItensDaMarcacao> {
    return this.exigirBanco().itensDaMarcacao(this.leitura(req), idDaRota(id));
  }

  @Get('marcacao/:id/critica')
  @Permissao('agenda.marcacao.ler')
  critica(
    @Param('id') id: string,
    @Query('itens') itens: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoCriticaLida> {
    const e = corpo(esquemaLancarItens, { marcacao: idDaRota(id), itens: listaDeIds(itens) });
    return this.exigirBanco().criticar(this.leitura(req), e.marcacao, e.itens);
  }

  @Post('marcacao/:id/itens')
  @HttpCode(200)
  @Permissao('agenda.marcacao.agendar')
  @AuditadoNoHandler('agenda.marcacao_itens_lancar pelo executor (trilha na mesma transação)')
  async lancar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaLancarItens, { ...(b as object), marcacao: idDaRota(id) });
    const r = await this.exigirBanco().lancar(this.gravacao(sessaoDe(req), 'agenda.itensMarcacao'), e);
    return { ok: true, ...r, mensagem: 'Itens lançados na marcação, com o preparo do paciente.' };
  }

  @Get(':id')
  @Permissao('agenda.agenda.ler')
  ler(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ItemLido> {
    return this.exigirBanco().lerItem(this.leitura(req), idDaRota(id));
  }

  @Post()
  @HttpCode(200)
  @Permissao('agenda.cobertura.editar')
  @AuditadoNoHandler('agenda.item_agendavel_salvar pelo executor (trilha na mesma transação)')
  async incluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSalvarItem, { ...(b as object), id: undefined });
    const r = await this.exigirBanco().salvar(this.gravacao(sessaoDe(req), 'agenda.itemAgendavel'), e);
    return { ok: true, ...r, mensagem: 'Item agendável criado.' };
  }

  @Post(':id')
  @HttpCode(200)
  @Permissao('agenda.cobertura.editar')
  @AuditadoNoHandler('agenda.item_agendavel_salvar pelo executor (trilha na mesma transação)')
  async alterar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSalvarItem, { ...(b as object), id: idDaRota(id) });
    const r = await this.exigirBanco().salvar(this.gravacao(sessaoDe(req), 'agenda.itemAgendavel'), e);
    return { ok: true, ...r, mensagem: 'Item agendável gravado.' };
  }
}
