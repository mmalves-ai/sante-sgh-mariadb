// Pesquisa clínica (03-PEP L144; Res. CNS 466/2012, RDC ANVISA 9/2015; LGPD art. 11, II, c). Rotas (porta própria;
// sem banco do cliente, 503):
//   GET  /api/pep/pesquisa                                 estudos do estabelecimento e se a triagem automática está ligada
//   GET  /api/pep/pesquisa/profissionais?termo=            investigador, equipe e avaliador, pela busca
//   GET  /api/pep/pesquisa/pacientes?termo=                pacientes do estabelecimento (indicação manual), pela busca
//   GET  /api/pep/pesquisa/pacientes/:id/anexos            anexos do prontuário (o TCLE assinado)
//   GET  /api/pep/pesquisa/:id                             estudo com equipe, critérios, candidatos e participantes
//   POST /api/pep/pesquisa                                 cadastra o estudo (em aprovação)
//   POST /api/pep/pesquisa/:id/situacao                    passa a situação (aprovação ética, recrutamento, ...)
//   POST /api/pep/pesquisa/:id/equipe                      inclui membro da equipe
//   POST /api/pep/pesquisa/:id/criterios                   inclui critério; .../criterios/:c/desativar o desativa
//   POST /api/pep/pesquisa/:id/triagem                     triagem (automática só com o parâmetro ligado)
//   POST /api/pep/pesquisa/triagens/:id/avaliar            avaliação do candidato; inclusão com o TCLE
//   POST /api/pep/pesquisa/participantes/:id/situacao      acompanhamento: mudança de situação ou saída
//   POST /api/pep/pesquisa/participantes/:id/visita        visita do participante
// A triagem só sugere à equipe do estudo, fica restrita ao estabelecimento da sessão e vai à trilha (registro do
// acesso aos prontuários). A automática sobre todos os pacientes só com pep.pesquisa.triagemAutomatica ligado
// (desligado por padrão); sem ele, a equipe indica os pacientes.
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
import {
  definicaoParametro,
  PARAMETRO_TRIAGEM_PESQUISA,
  PERMISSOES_PESQUISA,
  type ValorParametro,
} from '@sgh/contratos';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/public-api.js';
import { PORTA_PESQUISA_CLINICA, type PesquisaClinicaPropria } from './pesquisa-clinica-propria.js';

@Controller('pep/pesquisa')
export class PesquisaClinicaController {
  constructor(
    @Optional() @Inject(PORTA_PESQUISA_CLINICA) private readonly porta: PesquisaClinicaPropria | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly configuracao: FonteConfiguracao | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PesquisaClinicaPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  /** O parâmetro da triagem automática no estabelecimento da sessão (desligado na falta ou no erro). */
  private async triagemLigada(req: RequisicaoAutorizada): Promise<boolean> {
    const s = sessaoDe(req);
    const def = definicaoParametro(PARAMETRO_TRIAGEM_PESQUISA);
    if (!def || !this.configuracao) return false;
    let valores: ValorParametro[];
    try {
      valores = await this.configuracao.valoresParametro(s.rede, s.hospital);
    } catch {
      return false;
    }
    const sujeito = {
      rede: s.rede,
      empresa: null,
      estabelecimento: s.hospital,
      unidade: null,
      perfis: [],
      usuario: s.login,
    };
    return valorTipado(def, resolverParametro(def, valores, sujeito, new Date()).valor) === true;
  }

  @Get()
  @Permissao(PERMISSOES_PESQUISA.ler)
  async painel(@Req() req: RequisicaoAutorizada) {
    const r = await this.com(req, (p, c) => p.painel(c));
    return { ...r, triagemAutomatica: await this.triagemLigada(req) };
  }

  @Get('profissionais')
  @Permissao(PERMISSOES_PESQUISA.ler)
  profissionais(@Req() req: RequisicaoAutorizada, @Query('termo') termo = '') {
    return this.com(req, (p, c) => p.profissionais(c, String(termo)));
  }

  @Get('pacientes')
  @Permissao(PERMISSOES_PESQUISA.triar)
  pacientes(@Req() req: RequisicaoAutorizada, @Query('termo') termo = '') {
    return this.com(req, (p, c) => p.pacientes(c, String(termo)));
  }

  @Get('pacientes/:id/anexos')
  @Permissao(PERMISSOES_PESQUISA.triar)
  anexos(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.anexos(c, id));
  }

  @Get(':id')
  @Permissao(PERMISSOES_PESQUISA.ler)
  estudo(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.estudo(c, id));
  }

  @Post()
  @HttpCode(201)
  @Permissao(PERMISSOES_PESQUISA.gerir)
  @AuditadoNoHandler('cadastro do estudo clínico pelo executor (trilha na mesma transação)')
  cadastrar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.cadastrarEstudo(c, corpo));
  }

  @Post(':id/situacao')
  @HttpCode(200)
  @Permissao(PERMISSOES_PESQUISA.gerir)
  @AuditadoNoHandler('situação do estudo clínico pelo executor (trilha na mesma transação)')
  situacao(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.mudarSituacao(c, id, corpo));
  }

  @Post(':id/equipe')
  @HttpCode(201)
  @Permissao(PERMISSOES_PESQUISA.gerir)
  @AuditadoNoHandler('equipe do estudo clínico pelo executor (trilha na mesma transação)')
  equipe(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirMembro(c, id, corpo));
  }

  @Post(':id/criterios')
  @HttpCode(201)
  @Permissao(PERMISSOES_PESQUISA.gerir)
  @AuditadoNoHandler('critério do estudo clínico pelo executor (trilha na mesma transação)')
  criterio(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirCriterio(c, id, corpo));
  }

  @Post(':id/criterios/:criterio/desativar')
  @HttpCode(200)
  @Permissao(PERMISSOES_PESQUISA.gerir)
  @AuditadoNoHandler('desativação do critério do estudo pelo executor (trilha na mesma transação)')
  desativar(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Param('criterio', ParseIntPipe) criterio: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.desativarCriterio(c, id, criterio, corpo));
  }

  @Post(':id/triagem')
  @HttpCode(200)
  @Permissao(PERMISSOES_PESQUISA.triar)
  @AuditadoNoHandler('triagem de elegibilidade nos prontuários pelo executor (trilha na mesma transação)')
  async triar(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    const ligada = await this.triagemLigada(req);
    return this.com(req, (p, c) => p.triar(c, id, corpo, ligada));
  }

  @Post('triagens/:id/avaliar')
  @HttpCode(200)
  @Permissao(PERMISSOES_PESQUISA.triar)
  @AuditadoNoHandler('avaliação do candidato do estudo pelo executor (trilha na mesma transação)')
  avaliar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.avaliar(c, id, corpo));
  }

  @Post('participantes/:id/situacao')
  @HttpCode(200)
  @Permissao(PERMISSOES_PESQUISA.triar)
  @AuditadoNoHandler('acompanhamento do participante do estudo pelo executor (trilha na mesma transação)')
  participante(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.mudarParticipante(c, id, corpo));
  }

  @Post('participantes/:id/visita')
  @HttpCode(201)
  @Permissao(PERMISSOES_PESQUISA.triar)
  @AuditadoNoHandler('visita do participante do estudo pelo executor (trilha na mesma transação)')
  visita(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.registrarVisita(c, id, corpo));
  }
}
