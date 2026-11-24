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
//   POST   /api/pep/equipe/atendimento/:atendimento/encerramento  encerra a equipe no fim do atendimento { motivo }
//   GET    /api/pep/equipe/profissional/:profissional/especialidades  especialidades do profissional (para a tela)
// A equipe é dado do paciente: ler, incluir e encerrar passam pela mesma guarda de vínculo assistencial do prontuário
// (AcessoPacientePep), e a leitura vai à trilha de acesso ao prontuário.
// A configuração que vale usa o padrão do ESTABELECIMENTO (parâmetro pep.evolucao.toleranciaRetroativoMinutos) quando o
// setor não tem a sua.
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
import { definicaoParametro, type ValorParametro } from '@sgh/contratos';
import { VinculoSintetico, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import { resolverParametro, type SujeitoParametro, valorTipado } from '@sgh/dominio-config';
import {
  configuracaoPadraoDoEstabelecimento,
  resolverConfiguracaoProntuario,
  type TipoAtendimentoProntuario,
} from '@sgh/dominio-pep';
import { Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { ALERTA_AUDITOR, type AlertaAuditor } from '../acesso/alerta.js';
import {
  REGISTRO_EMERGENCIA,
  type RegistroEmergencia,
  VINCULO_ASSISTENCIAL,
} from '../acesso/emergencia.controller.js';
import { problemaDoCadastro, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/public-api.js';
import { AcessoPacientePep } from './acesso-paciente.js';
import { PORTA_EQUIPE_PAINEL, type PortaEquipePainelPropria } from './equipe-painel-propria.js';
import { ESTADO_PRONTUARIO } from './prontuario.controller.js';
import type { EstadoProntuario } from './sessao-prontuario.js';

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
  private readonly acesso: AcessoPacientePep;

  constructor(
    @Inject(ESTADO_PRONTUARIO) estado: EstadoProntuario,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(PORTA_EQUIPE_PAINEL) private readonly porta: PortaEquipePainelPropria | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional() @Inject(VINCULO_ASSISTENCIAL) vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
  ) {
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
  }

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaEquipePainelPropria, c: SessaoCadastro['porta'], s: SessaoCadastro) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta, s).catch((e: unknown) => {
      if (e instanceof ErroProblema) throw e;
      throw problemaDoCadastro(e);
    });
  }

  /** Guarda do paciente do atendimento: vínculo assistencial (ou quebra de vidro), como no prontuário. */
  private async pacienteGuardado(
    p: PortaEquipePainelPropria,
    c: SessaoCadastro['porta'],
    s: SessaoCadastro,
    atendimento: number,
    permissao: string,
  ): Promise<number> {
    const paciente = await p.pacienteDoAtendimento(c, atendimento);
    await this.acesso.exigirVinculo(s, paciente, permissao, 'pep.prontuario');
    return paciente;
  }

  /** O padrão do estabelecimento (tolerância do retroativo em minutos, parâmetro por estabelecimento). */
  private async padraoEstabelecimento(s: SessaoCadastro) {
    const valores: ValorParametro[] = this.configuracao
      ? await this.configuracao.valoresParametro(s.rede, s.hospital).catch(() => [])
      : [];
    const def = definicaoParametro('pep.evolucao.toleranciaRetroativoMinutos');
    if (!def || !valores.length) return configuracaoPadraoDoEstabelecimento(null);
    const sujeito: SujeitoParametro = {
      rede: s.rede,
      empresa: null,
      estabelecimento: s.hospital,
      unidade: null,
      perfis: [],
      usuario: s.login,
    };
    const v = valorTipado(def, resolverParametro(def, valores, sujeito, new Date()).valor);
    return configuracaoPadraoDoEstabelecimento(typeof v === 'number' ? v : null);
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
    return this.com(req, async (p, c, sessao) => {
      const [itens, setores, padrao] = await Promise.all([
        p.configuracoesSetor(c),
        p.setores(c),
        this.padraoEstabelecimento(sessao),
      ]);
      return { itens, setores, padrao, vigente: resolverConfiguracaoProntuario(itens, s, t, padrao) };
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
    return this.com(req, async (p, c, s) => {
      const paciente = await this.pacienteGuardado(p, c, s, atendimento, PERMISSOES_EQUIPE_PAINEL.painelLer);
      const equipe = await p.equipe(c, atendimento);
      await this.acesso.registrarLeitura(s, paciente, 'lista', 'assistencia', 'pep.prontuario');
      return equipe;
    });
  }

  @Get('equipe/profissional/:profissional/especialidades')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.equipeGerenciar)
  especialidades(
    @Req() req: RequisicaoAutorizada,
    @Param('profissional', ParseIntPipe) profissional: number,
  ) {
    return this.com(req, async (p, c) => ({ itens: await p.especialidadesDoProfissional(c, profissional) }));
  }

  @Post('equipe/atendimento/:atendimento/encerramento')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.equipeGerenciar)
  encerrar(
    @Req() req: RequisicaoAutorizada,
    @Param('atendimento', ParseIntPipe) atendimento: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, async (p, c, s) => {
      await this.pacienteGuardado(p, c, s, atendimento, PERMISSOES_EQUIPE_PAINEL.equipeGerenciar);
      return p.encerrarEquipe(c, atendimento, corpo);
    });
  }

  @Post('equipe/atendimento/:atendimento')
  @Permissao(PERMISSOES_EQUIPE_PAINEL.equipeGerenciar)
  incluir(
    @Req() req: RequisicaoAutorizada,
    @Param('atendimento', ParseIntPipe) atendimento: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, async (p, c, s) => {
      await this.pacienteGuardado(p, c, s, atendimento, PERMISSOES_EQUIPE_PAINEL.equipeGerenciar);
      return p.incluirMembro(c, atendimento, corpo);
    });
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
