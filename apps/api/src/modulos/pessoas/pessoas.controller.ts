// Tela "Colaboradores e admissão" (M52.1; ficha do M52, seção 7; `Gestão de pessoas > Cadastro de colaboradores`):
//   GET  /api/pessoas/apoio                                  centros de custo, unidades, tipos de rescisão, liberação
//   GET  /api/pessoas/colaboradores                          lista por centro de custo (keyset, sem CPF)
//   GET  /api/pessoas/colaboradores/:vinculo                 ficha (CPF mascarado; leitura auditada de dado pessoal)
//   POST /api/pessoas/admissao/previa                        o que existe com o CPF (POST: o CPF fora da URL e do log)
//   POST /api/pessoas/colaboradores                          admissão (regra 1)
//   POST /api/pessoas/colaboradores/:vinculo/mudanca         mudança funcional (histórico só de inclusão)
//   POST /api/pessoas/colaboradores/:vinculo/cargo           W0-06: cargo do quadro ligado (ou retirado) com motivo
//   POST /api/pessoas/colaboradores/:vinculo/dependentes     dependente
//   POST /api/pessoas/colaboradores/:vinculo/dependentes/:dependente/encerramento   fim do dependente (nunca apagado)
//   POST /api/pessoas/colaboradores/:vinculo/desligamento    desligamento com o bloqueio do acesso (regra 2; crítica)
//   GET  /api/pessoas/habilitacoes                           alertas do conselho (retrato do dia e a lista)
//   POST /api/pessoas/habilitacoes                           validade conferida do registro (regra 3)
// Toda gravação leva a Idempotency-Key; o desligamento pede a senha de novo (SBIS-07). O estabelecimento vem da sessão.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type ApoioColaboradores,
  esquemaAdmitirColaborador,
  esquemaAlterarDependente,
  esquemaAlterarVinculo,
  esquemaCorrigirColaborador,
  esquemaDependente,
  esquemaDesligarColaborador,
  esquemaEncerrarDependente,
  esquemaFiltroColaboradores,
  esquemaFiltroHabilitacoes,
  esquemaLigarCargoColaborador,
  esquemaPreviaAdmissao,
  esquemaRegistrarHabilitacao,
  EVENTOS_AUDITAVEIS,
  type FichaColaborador,
  GRUPO_PAINEIS,
  type ListaColaboradores,
  type PainelConselho,
  type PreviaAdmissao,
  type ResultadoDesligamento,
  type ResultadoPessoas,
} from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { conferirLoginDePainel } from '../administracao/login-painel.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { RAIZ_FIM_COEXISTENCIA } from '../coexistencia/public-api.js';
import { corpo } from '../exames/public-api.js';
import { PORTA_RECEPCAO, type PortaRecepcao } from '../recepcao/public-api.js';
import type { CifraCpf } from './cifra-cpf.js';
import { PORTA_ESOCIAL, type PortaEsocial } from './esocial/porta-esocial.js';
import { ServicoEsocial } from './esocial/servico-esocial.js';
import { PORTA_CALCULO_FOLHA, type PortaCalculoFolha } from './folha/porta-calculo.js';
import { PORTA_FOLHA, type PortaFolha } from './folha/porta-folha.js';
import { PORTA_PESSOAS, type PortaPessoas } from './porta.js';
import { PORTA_RUBRICAS, type PortaRubricas } from './rubricas/porta-rubricas.js';
import { ServicoPessoas } from './servico.js';

export const CIFRA_CPF_PESSOAS = Symbol('CIFRA_CPF_PESSOAS');

const E = EVENTOS_AUDITAVEIS;
const esquemaSenha = z.object({ senha: z.string().max(200).optional() }).passthrough();

/** Tira a senha (reautenticação) do corpo antes do Zod estrito da operação. */
function semSenha(b: unknown): { senha: string | undefined; resto: Record<string, unknown> } {
  const p = esquemaSenha.safeParse(b);
  if (!p.success) return { senha: undefined, resto: {} };
  const { senha, ...resto } = p.data as Record<string, unknown> & { senha?: string };
  return { senha, resto };
}

@Controller('pessoas')
export class PessoasController {
  readonly servico: ServicoPessoas;

  constructor(
    @Inject(PORTA_PESSOAS) private readonly porta: PortaPessoas,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(CIFRA_CPF_PESSOAS) cifra: CifraCpf | null = null,
    /** M43: a conferência do login de painel (TV ou totem) antes do bloqueio, a mesma da tela de usuários. */
    @Optional() @Inject(PORTA_RECEPCAO) private readonly recepcao: PortaRecepcao | null = null,
    @Optional() @Inject(RAIZ_FIM_COEXISTENCIA) private readonly raizFim: string | null = null,
    // Revisão W0-06: a fila do eSocial do S-2200/S-2300 (a correção de matrícula ou admissão a confere).
    @Optional() @Inject(PORTA_ESOCIAL) esocial: PortaEsocial | null = null,
    @Optional() @Inject(PORTA_FOLHA) folha: PortaFolha | null = null,
    @Optional() @Inject(PORTA_CALCULO_FOLHA) calculo: PortaCalculoFolha | null = null,
    @Optional() @Inject(PORTA_RUBRICAS) rubricas: PortaRubricas | null = null,
  ) {
    const fila =
      esocial && folha && calculo && rubricas
        ? new ServicoEsocial(esocial, folha, calculo, rubricas, porta, cifra, trilha, configuracao, cache)
        : null;
    this.servico = new ServicoPessoas(porta, trilha, configuracao, cache, cifra, fila);
  }

  /** A senha conferida de novo (M05); só a porta em memória sem sessão real (dev/ci sem login) dispensa. */
  private async reautenticado(req: RequisicaoAutorizada, senha: string | undefined): Promise<number> {
    return this.porta.destino === 'memoria' && !req.sgh?.real
      ? Date.now()
      : reautenticar(this.sessoes, this.resolvedor, req, senha);
  }

  @Get('apoio')
  @Permissao('pessoas.colaborador.ler')
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioColaboradores> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get('colaboradores')
  @Permissao('pessoas.colaborador.ler')
  lista(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaColaboradores> {
    return this.servico.lista(sessaoDe(req), corpo(esquemaFiltroColaboradores, q));
  }

  @Get('colaboradores/:vinculo')
  @Permissao('pessoas.colaborador.ler')
  @Auditar(E.pessoasColaboradorLido.codigo)
  ficha(@Param('vinculo') vinculo: string, @Req() req: RequisicaoAutorizada): Promise<FichaColaborador> {
    return this.servico.ficha(sessaoDe(req), idDaRota(vinculo));
  }

  @Post('admissao/previa')
  @HttpCode(200)
  @Permissao('pessoas.colaborador.admitir')
  @Auditar(E.pessoasColaboradorLido.codigo)
  previa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<PreviaAdmissao> {
    return this.servico.previa(sessaoDe(req), corpo(esquemaPreviaAdmissao, b).cpf);
  }

  @Post('colaboradores')
  @HttpCode(200)
  @Permissao('pessoas.colaborador.admitir')
  @AuditadoNoHandler('SGH_PES_VINCULO e SGH_PES_HISTORICO com a SGH_TRILHA e a SGH_OUTBOX na mesma transação')
  admitir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoPessoas> {
    return this.servico.admitir(sessaoDe(req), corpo(esquemaAdmitirColaborador, b));
  }

  @Post('colaboradores/:vinculo/mudanca')
  @HttpCode(200)
  @Permissao('pessoas.colaborador.admitir')
  @AuditadoNoHandler('SGH_PES_VINCULO e SGH_PES_HISTORICO com a SGH_TRILHA na mesma transação')
  mudanca(
    @Param('vinculo') vinculo: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoPessoas> {
    return this.servico.mudar(
      sessaoDe(req),
      corpo(esquemaAlterarVinculo, { ...(b as object), vinculo: idDaRota(vinculo) }),
    );
  }

  /** W0-06: correção cadastral (nome, matrícula, tipo, admissão) com motivo e o valor anterior guardado. */
  @Post('colaboradores/:vinculo/correcao')
  @HttpCode(200)
  @Permissao('pessoas.colaborador.admitir')
  @AuditadoNoHandler(
    'SGH_PES_VINCULO, SGH_PES_HISTORICO e SGH_PES_CORRECAO com a SGH_TRILHA na mesma transação',
  )
  corrigir(
    @Param('vinculo') vinculo: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoPessoas> {
    return this.servico.corrigir(
      sessaoDe(req),
      corpo(esquemaCorrigirColaborador, { ...(b as object), vinculo: idDaRota(vinculo) }),
    );
  }

  /** W0-06 (5d-3a): o cargo do quadro de cargos e salários ligado ao colaborador (ou retirado), com motivo e trilha. */
  @Post('colaboradores/:vinculo/cargo')
  @HttpCode(200)
  @Permissao('pessoas.colaborador.admitir')
  @AuditadoNoHandler(
    'SGH_PES_VINCULO, SGH_PES_HISTORICO e SGH_PES_CORRECAO com a SGH_TRILHA na mesma transação',
  )
  ligarCargo(
    @Param('vinculo') vinculo: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoPessoas> {
    return this.servico.ligarCargo(
      sessaoDe(req),
      corpo(esquemaLigarCargoColaborador, { ...(b as object), vinculo: idDaRota(vinculo) }),
    );
  }

  @Post('colaboradores/:vinculo/dependentes')
  @HttpCode(200)
  @Permissao('pessoas.colaborador.admitir')
  @AuditadoNoHandler('SGH_PES_DEPENDENTE com a SGH_TRILHA na mesma transação')
  dependente(
    @Param('vinculo') vinculo: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoPessoas> {
    return this.servico.incluirDependente(
      sessaoDe(req),
      corpo(esquemaDependente, { ...(b as object), vinculo: idDaRota(vinculo) }),
    );
  }

  @Post('colaboradores/:vinculo/dependentes/:dependente/encerramento')
  @HttpCode(200)
  @Permissao('pessoas.colaborador.admitir')
  @AuditadoNoHandler('SGH_PES_DEPENDENTE com a SGH_TRILHA na mesma transação')
  encerrarDependente(
    @Param('vinculo') vinculo: string,
    @Param('dependente') dependente: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoPessoas> {
    return this.servico.encerrarDependente(
      sessaoDe(req),
      corpo(esquemaEncerrarDependente, {
        ...(b as object),
        vinculo: idDaRota(vinculo),
        dependente: idDaRota(dependente),
      }),
    );
  }

  /** W0-06: alteração do dependente com versão a partir de uma data (a anterior fica guardada). */
  @Post('colaboradores/:vinculo/dependentes/:dependente/alteracao')
  @HttpCode(200)
  @Permissao('pessoas.colaborador.admitir')
  @AuditadoNoHandler('SGH_PES_DEPENDENTE e SGH_PES_CORRECAO com a SGH_TRILHA na mesma transação')
  alterarDependente(
    @Param('vinculo') vinculo: string,
    @Param('dependente') dependente: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoPessoas> {
    return this.servico.alterarDependente(
      sessaoDe(req),
      corpo(esquemaAlterarDependente, {
        ...(b as object),
        vinculo: idDaRota(vinculo),
        dependente: idDaRota(dependente),
      }),
    );
  }

  @Post('colaboradores/:vinculo/desligamento')
  @HttpCode(200)
  @Permissao('pessoas.colaborador.desligar')
  @AuditadoNoHandler(
    'executor: acesso.bloquearUsuario (TBCABTRILHA e SGH_TRILHA); SGH_PES_VINCULO, SGH_PES_HISTORICO e SGH_OUTBOX com a SGH_TRILHA',
  )
  async desligamento(
    @Param('vinculo') vinculo: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoDesligamento> {
    const { senha, resto } = semSenha(b);
    const entrada = corpo(esquemaDesligarColaborador, { ...resto, vinculo: idDaRota(vinculo) });
    const reaut = await this.reautenticado(req, senha);
    const sessoes = this.sessoes;
    return this.servico.desligar(
      sessaoDe(req),
      entrada,
      reaut,
      sessoes
        ? async (rede, hospital, login) => {
            // A contagem é só informativa; a queda que falha volta ao serviço (a sessão fica pendente e a tela avisa).
            const vivas = (await sessoes.sessoesDoUsuario(rede, hospital, login).catch(() => [])).length;
            await sessoes.revogarSessoesDoUsuario(rede, hospital, login);
            return vivas;
          }
        : null,
      // O login lido com o grupo de painéis passa pela conferência do aparelho (409 em uso; 503 sem conferir).
      (s, login) =>
        conferirLoginDePainel(
          { recepcao: this.recepcao, raizFim: this.raizFim },
          { rede: s.rede, hospital: s.hospital },
          login,
          async () => GRUPO_PAINEIS,
        ),
    );
  }

  @Get('habilitacoes')
  @Permissao('pessoas.colaborador.ler')
  habilitacoes(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PainelConselho> {
    return this.servico.painelConselho(sessaoDe(req), corpo(esquemaFiltroHabilitacoes, q));
  }

  @Post('habilitacoes')
  @HttpCode(200)
  @Permissao('pessoas.colaborador.admitir')
  @AuditadoNoHandler('SGH_PES_HABILITACAO com a SGH_TRILHA na mesma transação')
  registrarHabilitacao(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoPessoas> {
    return this.servico.registrarHabilitacao(sessaoDe(req), corpo(esquemaRegistrarHabilitacao, b));
  }
}
