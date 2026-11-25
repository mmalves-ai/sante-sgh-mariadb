// Módulo do cadastro na API migrada (F2.2): pacientes, profissionais, solicitantes, pessoas e especialidades. A porta é
// a própria sobre o banco do cliente quando o núcleo existe; sem núcleo, a memória sintética só em dev/ci; fora disso,
// a indisponível (503, falha fechada). Os testes passam a porta pelas opções.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import type { ContextoModulo } from '../registro.js';
import { ligarMapaEstabelecimentos } from './contexto-nucleo.js';
import { CadastroLigacoesController } from './cadastro-ligacoes.controller.js';
import { CadastroLigacoesProprio, LIGACOES_CADASTRO } from './cadastro-ligacoes-proprio.js';
import { CalendarioController } from './calendario.controller.js';
import { CALENDARIO_CADASTRO, CalendarioProprio } from './calendario-proprio.js';
import { EstruturaGestaoController } from './estrutura-gestao.controller.js';
import { ESTRUTURA_GESTAO, EstruturaGestaoPropria } from './estrutura-gestao-proprio.js';
import { IdentidadeEstabelecimentoController } from './identidade-estabelecimento.controller.js';
import {
  IDENTIDADE_ESTABELECIMENTO,
  IdentidadeEstabelecimentoPropria,
} from './identidade-estabelecimento-propria.js';
import { LinhasCuidadoController } from './linhas-cuidado.controller.js';
import { LINHAS_CUIDADO, LinhasCuidadoPropria } from './linhas-cuidado-proprio.js';
import { FichaComplementarController } from './ficha-complementar.controller.js';
import { FICHA_COMPLEMENTAR, FichaComplementarPropria } from './ficha-complementar-proprio.js';
import { DemografiaPacienteController } from './demografia-paciente.controller.js';
import { DEMOGRAFIA_PACIENTE, DemografiaPacientePropria } from './demografia-paciente-propria.js';
import { RepresentacaoPacienteController } from './representacao-paciente.controller.js';
import { REPRESENTACAO_PACIENTE, RepresentacaoPacientePropria } from './representacao-paciente-propria.js';
import { CadastroVinculosProprio } from './paciente-vinculos-proprio.js';
import { PacienteVinculosController, VINCULOS_CADASTRO } from './paciente-vinculos.controller.js';
import { PacientesController } from './pacientes.controller.js';
import { PORTA_CADASTRO, type PortaCadastro, portaCadastroIndisponivel } from './porta.js';
import { lembrarCadastroMemoria, PortaCadastroMemoria } from './porta-memoria.js';
import { PortaCadastroPropria } from './porta-propria.js';
import { TISS_CONFIGURACAO, TissConfiguracaoPropria } from './tiss-configuracao-proprio.js';
import { ProfissionaisController } from './profissionais.controller.js';
import { ProfissionalComplementoController } from './profissional-complemento.controller.js';
import {
  COMPLEMENTO_PROFISSIONAL,
  ProfissionalComplementoProprio,
} from './profissional-complemento-proprio.js';

export interface OpcoesModuloCadastro {
  /** Porta pronta (testes). */
  readonly porta?: PortaCadastro;
  /** Identidade do estabelecimento pronta (teste das rotas sobre o banco do cliente de teste). */
  readonly identidade?: IdentidadeEstabelecimentoPropria;
}

/** A porta do cadastro pela regra do módulo (sem as opções de teste). */
export async function portaDoCadastro(ctx: ContextoModulo): Promise<PortaCadastro> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaCadastroPropria(ctx.nucleo, cliente);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return lembrarCadastroMemoria(new PortaCadastroMemoria());
  return portaCadastroIndisponivel();
}

@Module({})
export class ModuloCadastro {}

export async function modulo(ctx: ContextoModulo, opcoes: OpcoesModuloCadastro = {}): Promise<DynamicModule> {
  const porta = opcoes.porta ?? (await portaDoCadastro(ctx));
  // Coberturas, pré-cadastro e captação (F3.1): só sobre o banco do cliente; sem ele, 503 nas rotas.
  const cliente = ctx.configuracao.clientePadrao;
  const vinculos = ctx.nucleo && cliente ? new CadastroVinculosProprio(ctx.nucleo, cliente) : null;
  // F3.1: ficha complementar (regras de campo, contatos e responsáveis), também só no banco do cliente.
  const ficha = ctx.nucleo && cliente ? new FichaComplementarPropria(ctx.nucleo, cliente) : null;
  // F3.1 (02-CAD linha 4): incapacidade do paciente e comprovante da representação, só no banco do cliente.
  const representacao = ctx.nucleo && cliente ? new RepresentacaoPacientePropria(ctx.nucleo, cliente) : null;
  // F3.1 (02-CAD linha 15): dados demográficos e vulnerabilidades do paciente, só no banco do cliente.
  const demografia = ctx.nucleo && cliente ? new DemografiaPacientePropria(ctx.nucleo, cliente) : null;
  // F3.1 (02-CAD linha 16): complemento do profissional (fiscal, conta, RQE e assinatura), só no banco do cliente.
  const complemento = ctx.nucleo && cliente ? new ProfissionalComplementoProprio(ctx.nucleo, cliente) : null;
  // F3.1 (02-CAD linhas 17, 18 e 20): especialidade, lotação e solicitante, só no banco do cliente.
  const ligacoes = ctx.nucleo && cliente ? new CadastroLigacoesProprio(ctx.nucleo, cliente) : null;
  // F3.1 (02-CAD linha 28): calendário de feriados e dias não úteis, só no banco do cliente.
  const calendario = ctx.nucleo && cliente ? new CalendarioProprio(ctx.nucleo, cliente) : null;
  // F3.1 (02-CAD linhas 25, 26 e 27): estrutura (estabelecimento, unidades, setores e ramais) e configuração TISS.
  const estrutura = ctx.nucleo && cliente ? new EstruturaGestaoPropria(ctx.nucleo, cliente) : null;
  const tiss = ctx.nucleo && cliente ? new TissConfiguracaoPropria(ctx.nucleo, cliente) : null;
  // F3.1 (02-CAD linha 26): logotipos e mantenedora do estabelecimento, só no banco do cliente.
  const identidade =
    opcoes.identidade ??
    (ctx.nucleo && cliente ? new IdentidadeEstabelecimentoPropria(ctx.nucleo, cliente) : null);
  // F8 (02-CAD linha 11): programas de saúde e linhas de cuidado do paciente, só no banco do cliente.
  const linhasCuidado = ctx.nucleo && cliente ? new LinhasCuidadoPropria(ctx.nucleo, cliente) : null;
  return {
    module: ModuloCadastro,
    controllers: [
      PacientesController,
      ProfissionaisController,
      PacienteVinculosController,
      FichaComplementarController,
      RepresentacaoPacienteController,
      DemografiaPacienteController,
      ProfissionalComplementoController,
      CadastroLigacoesController,
      EstruturaGestaoController,
      IdentidadeEstabelecimentoController,
      CalendarioController,
      LinhasCuidadoController,
    ],
    providers: [
      { provide: PORTA_CADASTRO, useValue: porta },
      { provide: VINCULOS_CADASTRO, useValue: vinculos },
      { provide: FICHA_COMPLEMENTAR, useValue: ficha },
      { provide: REPRESENTACAO_PACIENTE, useValue: representacao },
      { provide: DEMOGRAFIA_PACIENTE, useValue: demografia },
      { provide: COMPLEMENTO_PROFISSIONAL, useValue: complemento },
      { provide: LIGACOES_CADASTRO, useValue: ligacoes },
      { provide: CALENDARIO_CADASTRO, useValue: calendario },
      { provide: ESTRUTURA_GESTAO, useValue: estrutura },
      { provide: TISS_CONFIGURACAO, useValue: tiss },
      { provide: IDENTIDADE_ESTABELECIMENTO, useValue: identidade },
      { provide: LINHAS_CUIDADO, useValue: linhasCuidado },
    ],
    exports: [PORTA_CADASTRO],
  };
}
