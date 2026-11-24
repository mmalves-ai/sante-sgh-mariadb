// Rotas do painel do profissional, da configuração do prontuário por setor e da equipe assistencial (F3.3, linhas
// 03-PEP L90, L91 e L94). Sem chave de liberação: só a permissão do cargo.
//   GET    /api/pep/painel/acompanhados                 pacientes que o usuário acompanha (vigentes)
//   POST   /api/pep/painel/acompanhados                 marca { paciente, atendimento?, motivo? }
//   POST   /api/pep/painel/acompanhados/:paciente/fim   deixa de acompanhar (grava o fim; nada é apagado)
//   GET    /api/pep/painel/colunas | PUT  { colunas }   colunas do painel do usuário, no banco
//   GET    /api/pep/painel/filtro-padrao | PUT { unidade } filtro salvo padrão (unidade que abre o painel)
//   GET    /api/pep/prontuario-setor                    configurações por setor, setores e a que vale (setor, tipo)
//   PUT    /api/pep/prontuario-setor                    inclui ou altera a configuração do setor e tipo
//   GET    /api/pep/equipe/funcoes                      funções da equipe
//   GET    /api/pep/equipe/atendimento/:atendimento     equipe do atendimento (vigentes e histórico)
//   POST   /api/pep/equipe/atendimento/:atendimento     inclui membro { profissional, funcao, especialidade?, recebeNotificacao }
//   POST   /api/pep/equipe/membro/:membro/saida         encerra a participação { motivo }
import {
  Body,
  Controller,
  Get,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { resolverConfiguracaoProntuario, type TipoAtendimentoProntuario } from '@sgh/dominio-pep';
import { Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_EQUIPE_PAINEL, type PortaEquipePainelPropria } from './equipe-painel-propria.js';

export const PERMISSOES_EQUIPE_PAINEL = {
  painelLer: 'pep.painel.ler',
  painelConfigurar: 'pep.painel.configurar',
  setorLer: 'pep.admin.ler',
  setorEditar: 'pep.admin.editar',
  equipeGerenciar: 'pep.equipe.gerenciar',
} as const;

const TIPOS = new Set([
  'todos',
  'internacao',
  'pronto_atendimento',
  'ambulatorio',
  'hospital_dia',
  'externo',
]);

@Controller('pep')
export class EquipePainelController {
  constructor(
    @Optional() @Inject(PORTA_EQUIPE_PAINEL) private readonly porta: PortaEquipePainelPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaEquipePainelPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('painel/acompanhados')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.painelLer)
  acompanhados(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.acompanhados(c) }));
  }

  @Post('painel/acompanhados')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.painelConfigurar)
  acompanhar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.acompanhar(c, corpo));
  }

  @Post('painel/acompanhados/:paciente/fim')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.painelConfigurar)
  deixar(@Req() req: RequisicaoAutorizada, @Param('paciente', ParseIntPipe) paciente: number) {
    return this.com(req, (p, c) => p.deixarDeAcompanhar(c, paciente));
  }

  @Get('painel/colunas')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.painelLer)
  colunas(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ colunas: await p.colunas(c) }));
  }

  @Put('painel/colunas')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.painelConfigurar)
  gravarColunas(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gravarColunas(c, corpo));
  }

  @Get('painel/filtro-padrao')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.painelLer)
  filtroPadrao(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.filtroPadrao(c));
  }

  @Put('painel/filtro-padrao')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.painelConfigurar)
  gravarFiltroPadrao(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gravarFiltroPadrao(c, corpo));
  }

  @Get('prontuario-setor')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.setorLer)
  configuracoes(
    @Req() req: RequisicaoAutorizada,
    @Query('setor') setor?: string,
    @Query('tipo') tipo?: string,
  ) {
    const t = (tipo && TIPOS.has(tipo) ? tipo : 'todos') as TipoAtendimentoProntuario;
    const s = setor && /^\d+$/.test(setor) ? Number(setor) : null;
    return this.com(req, async (p, c) => {
      const [itens, setores] = await Promise.all([p.configuracoesSetor(c), p.setores(c)]);
      return { itens, setores, vigente: resolverConfiguracaoProntuario(itens, s, t) };
    });
  }

  @Put('prontuario-setor')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.setorEditar)
  gravarConfiguracao(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gravarConfiguracaoSetor(c, corpo));
  }

  @Get('equipe/funcoes')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.painelLer)
  funcoes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.funcoes(c) }));
  }

  @Get('equipe/atendimento/:atendimento')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.painelLer)
  equipe(@Req() req: RequisicaoAutorizada, @Param('atendimento', ParseIntPipe) atendimento: number) {
    return this.com(req, (p, c) => p.equipe(c, atendimento));
  }

  @Post('equipe/atendimento/:atendimento')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.equipeGerenciar)
  incluir(
    @Req() req: RequisicaoAutorizada,
    @Param('atendimento', ParseIntPipe) atendimento: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.incluirMembro(c, atendimento, corpo));
  }

  @Post('equipe/membro/:membro/saida')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.equipeGerenciar)
  saida(
    @Req() req: RequisicaoAutorizada,
    @Param('membro', ParseIntPipe) membro: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.encerrarMembro(c, membro, corpo));
  }
}
