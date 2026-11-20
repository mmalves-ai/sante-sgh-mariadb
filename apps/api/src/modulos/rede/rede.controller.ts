// MPI da Rede (M57, etapa 1; ficha, seção 7) — `Cadastros > Pacientes (cadastro único) > MPI da Rede`:
//   GET  /api/rede/mpi/fila?situacao&faixa&outroEstabelecimento&prontuario&pagina&porPagina   fila (mascarada; auditada)
//   GET  /api/rede/mpi/candidatos/:chave                       um par, os dois lados lidos ao vivo (auditado)
//   POST /api/rede/mpi/candidatos/:chave/decisao               "é a mesma pessoa" / "é outra pessoa"
//   POST /api/rede/mpi/vinculos/:chave/desfazer                desfazer (só a ligação do índice; regra 1)
//   GET  /api/rede/mpi/cadastros/:estabelecimento/:id/vinculos  vínculos de um cadastro
//   POST /api/rede/mpi/pareamento                              um ciclo de pareamento (incremental, em lote)
//   GET  /api/rede/mpi/divergencias                            relatório de divergência entre os índices
//   POST /api/rede/mpi/divergencias/reparo                     "completar o que faltou" (idempotente)
//   GET  /api/rede/mpi/pacientes/:id/aviso                     etapa 2: "tem atendimentos em outro estabelecimento"
//                                                              (só contagens e datas; o cabeçalho do paciente)
// A chave `rede.mpi` (SGH_CFG_LIBERACAO) por estabelecimento: desligada no da sessão, 403 `recurso-desligado` com o
// motivo; nos outros, conferida estabelecimento a estabelecimento (escopo do estabelecimento inteiro e os
// pré-requisitos dele): o desligado fica fora da fila, do par e do ciclo. Numa sessão "como", o MPI só consulta. Toda
// gravação vai, banco a banco, numa transação SGH_ com a SGH_TRILHA junto (no banco em que a linha mora); com a porta
// em memória (sessão sintética), o registrador da API registra.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type AvisoRedePaciente,
  type CandidatoRede,
  type CicloPareamentoRede,
  CHAVE_LIBERACAO_ACESSO_CRUZADO_REDE,
  CHAVE_LIBERACAO_MPI_REDE,
  type DivergenciasRede,
  esquemaConsultaFilaRede,
  esquemaDecisaoCandidatoRede,
  esquemaDesfazerVinculoRede,
  EVENTOS_AUDITAVEIS,
  type FilaRede,
  type ResultadoGravacaoRede,
  type VinculosCadastroRede,
} from '@sgh/contratos';
import { VinculoSintetico, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  REGISTRO_EMERGENCIA,
  type RegistroEmergencia,
  VINCULO_ASSISTENCIAL,
} from '../acesso/emergencia.controller.js';
import { idDaRota, linhaTrilha, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { AcessoPacientePep } from '../pep/acesso-paciente.js';
import { LiberacaoPep } from '../pep/liberacao-pep.js';
import { EstadoProntuario } from '../pep/sessao-prontuario.js';
import { LOTE_PADRAO_CICLO_REDE, ServicoMpiRede, type SessaoRede } from './aplicacao/servico.js';
import { PORTA_REDE, type PortaRede } from './porta.js';

const CHAVE_PAR = /^[a-z][a-z0-9]{1,9}:[1-9]\d{0,9}\|[a-z][a-z0-9]{1,9}:[1-9]\d{0,9}$/;
const CODIGO_EST = /^[a-z][a-z0-9]{1,9}$/;

function chaveDaRota(v: string): string {
  const k = decodeURIComponent(v);
  if (!CHAVE_PAR.test(k)) throw new ErroProblema('nao-encontrado', 404, 'Par não encontrado');
  return k;
}

function invalido(campos: string[], detalhe: string): ErroProblema {
  return new ErroProblema('entrada-invalida', 400, 'Dados inválidos', detalhe, { campos });
}

@Controller('rede/mpi')
export class RedeMpiController {
  readonly servico: ServicoMpiRede;
  private readonly liberacao: LiberacaoPep;
  /** Correção do M57.2: o aviso passa pelo mesmo portão de vínculo assistencial do PEP (M15). */
  private readonly acessoPaciente: AcessoPacientePep;

  constructor(
    @Inject(PORTA_REDE) private readonly porta: PortaRede,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(VINCULO_ASSISTENCIAL) vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
  ) {
    this.servico = new ServicoMpiRede(porta, { aviso: (m) => console.warn(m) });
    this.liberacao = new LiberacaoPep(configuracao, cache);
    // Só o vínculo (exigirVinculo): o estado da sessão do prontuário e os alertas não entram no aviso.
    this.acessoPaciente = new AcessoPacientePep({
      estado: new EstadoProntuario(),
      trilha,
      alerta: null,
      configuracao,
      vinculo,
      emergencia,
    });
  }

  private sessao(s: SessaoCadastro, liberados: ReadonlySet<string>): SessaoRede {
    return {
      rede: s.rede,
      hospital: s.hospital,
      login: s.login,
      liberados,
      como: s.req.sghComo !== undefined,
      trilha: (evento, operacao, alvo) =>
        linhaTrilha(s, evento, 'rede.mpi', operacao, {
          tabela: 'SGH_REDE_VINCULO',
          id: alvo.id ?? null,
          chave: alvo.chave,
        }),
    };
  }

  private async entrar(req: RequisicaoAutorizada): Promise<{ s: SessaoCadastro; r: SessaoRede }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVE_LIBERACAO_MPI_REDE);
    return { s, r: this.sessao(s, await this.liberadosAlemDaSessao(s)) };
  }

  /** O da sessão e os outros estabelecimentos com a chave `rede.mpi` do estabelecimento inteiro (D-LIB-EST-57). */
  private async liberadosAlemDaSessao(s: SessaoCadastro): Promise<Set<string>> {
    const liberados = new Set<string>([s.hospital]);
    for (const e of this.porta.estabelecimentos())
      if (
        e.codigo !== s.hospital &&
        (await this.liberacao.ligadaNoEstabelecimento(s.rede, e.codigo, CHAVE_LIBERACAO_MPI_REDE))
      )
        liberados.add(e.codigo);
    return liberados;
  }

  /** Com a porta em memória, a trilha da gravação é a do registrador da API (no núcleo, vai em cada transação). */
  private async trilhaMemoria(s: SessaoCadastro, evento: string, idAlvo: string): Promise<void> {
    if (this.porta.destino !== 'memoria') return;
    await this.trilha.registrar({
      evento,
      rede: s.rede,
      hospital: s.hospital,
      usuario: s.login,
      estacao: estacaoDaRequisicao(s.req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(s.req, `rede-${idAlvo}`).slice(0, 64),
      recurso: 'rede.mpi',
      resultado: 'sucesso',
      tabelaAlvo: 'MEMORIA',
      idAlvo: idAlvo.slice(0, 80),
    });
  }

  @Get('fila')
  @Permissao('rede.mpi.ler')
  @Auditar(EVENTOS_AUDITAVEIS.redeFilaLida.codigo)
  async fila(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<FilaRede> {
    const { r } = await this.entrar(req);
    const c = esquemaConsultaFilaRede.safeParse(q);
    if (!c.success)
      throw invalido(
        [...new Set(c.error.issues.map((i) => i.path.join('.')))],
        'Confira os filtros da fila (situação, faixa, estabelecimento, prontuário e página).',
      );
    return this.servico.fila(r, c.data);
  }

  @Get('candidatos/:chave')
  @Permissao('rede.mpi.ler')
  @Auditar(EVENTOS_AUDITAVEIS.redeParLido.codigo)
  async candidato(@Param('chave') chave: string, @Req() req: RequisicaoAutorizada): Promise<CandidatoRede> {
    const { r } = await this.entrar(req);
    const k = chaveDaRota(chave);
    const x = await this.servico.candidato(r, k);
    if (!x) throw new ErroProblema('nao-encontrado', 404, 'Par não encontrado');
    req.sghAlvo = { paciente: x.local.id, tabelaAlvo: 'SGH_REDE_CANDIDATO', idAlvo: k };
    return x;
  }

  @Post('candidatos/:chave/decisao')
  @HttpCode(200)
  @Permissao('rede.mpi.vincular')
  @AuditadoNoHandler(
    'SGH_TRILHA em cada transação SGH_ do índice, banco a banco (memória: registrador da API)',
  )
  async decidir(
    @Param('chave') chave: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGravacaoRede> {
    const { s, r } = await this.entrar(req);
    const k = chaveDaRota(chave);
    const d = esquemaDecisaoCandidatoRede.safeParse(corpo);
    if (!d.success)
      throw invalido(['justificativa'], 'Para "é outra pessoa", escreva a justificativa (5 a 200 letras).');
    const res = await this.servico.decidir(r, k, d.data);
    await this.trilhaMemoria(
      s,
      d.data.decisao === 'outra_pessoa'
        ? EVENTOS_AUDITAVEIS.redeParOutraPessoa.codigo
        : EVENTOS_AUDITAVEIS.redeVinculoCriado.codigo,
      k,
    );
    return res;
  }

  @Post('vinculos/:chave/desfazer')
  @HttpCode(200)
  @Permissao('rede.mpi.desfazer')
  @AuditadoNoHandler(
    'SGH_TRILHA em cada transação SGH_ do índice, banco a banco (memória: registrador da API)',
  )
  async desfazer(
    @Param('chave') chave: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGravacaoRede> {
    const { s, r } = await this.entrar(req);
    const k = chaveDaRota(chave);
    const d = esquemaDesfazerVinculoRede.safeParse(corpo);
    if (!d.success)
      throw invalido(['justificativa'], 'Escreva por que o vínculo está sendo desfeito (5 a 200 letras).');
    const res = await this.servico.desfazer(r, k, d.data);
    await this.trilhaMemoria(s, EVENTOS_AUDITAVEIS.redeVinculoDesfeito.codigo, k);
    return res;
  }

  @Get('cadastros/:estabelecimento/:id/vinculos')
  @Permissao('rede.mpi.ler')
  @Auditar(EVENTOS_AUDITAVEIS.redeVinculosLidos.codigo)
  async vinculos(
    @Param('estabelecimento') estabelecimento: string,
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<VinculosCadastroRede> {
    const { r } = await this.entrar(req);
    if (!CODIGO_EST.test(estabelecimento))
      throw new ErroProblema('nao-encontrado', 404, 'Cadastro não encontrado');
    const n = idDaRota(id);
    if (estabelecimento === r.hospital)
      req.sghAlvo = { paciente: n, tabelaAlvo: 'SGH_REDE_VINCULO', idAlvo: String(n) };
    return this.servico.vinculosDoCadastro(r, estabelecimento, n);
  }

  @Post('pareamento')
  @HttpCode(200)
  @Permissao('rede.mpi.vincular')
  @AuditadoNoHandler('SGH_TRILHA em cada transação SGH_ do ciclo, banco a banco (só contagens)')
  async parear(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<CicloPareamentoRede> {
    const { s, r } = await this.entrar(req);
    const bruto = (corpo as { lote?: unknown } | null)?.lote;
    const lote = bruto === undefined ? LOTE_PADRAO_CICLO_REDE : Number(bruto);
    if (!Number.isInteger(lote) || lote < 1 || lote > 2000)
      throw invalido(['lote'], 'O lote vai de 1 a 2.000 cadastros.');
    const res = await this.servico.ciclo(r, lote);
    await this.trilhaMemoria(s, EVENTOS_AUDITAVEIS.redeFilaAtualizada.codigo, `lidos=${res.lidos}`);
    return res;
  }

  /**
   * Etapa 2 — o aviso do cabeçalho do paciente: com o MPI desligado no estabelecimento da sessão, `desligado` (o cabeçalho
   * não mostra nada; não é erro). O acesso cruzado ao registro (DP-42) só com a permissão e a chave
   * `rede.acessoCruzado` ligada aqui e no estabelecimento do registro; senão, o motivo. Com a restrição por vínculo do
   * estabelecimento, só para quem tem vínculo assistencial com o paciente (correção do M57.2).
   */
  @Get('pacientes/:id/aviso')
  @Permissao('rede.mpiAviso.ler')
  @Auditar(EVENTOS_AUDITAVEIS.redeAvisoLido.codigo)
  async aviso(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<AvisoRedePaciente> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    req.sghAlvo = {
      paciente: n,
      tabelaAlvo: 'SGH_REDE_VINCULO',
      idAlvo: String(n),
      chaveNaturalAlvo: 'aviso',
    };
    // O mesmo portão das leituras do paciente no PEP (vínculo assistencial do M15, ou quebra de vidro vigente), antes
    // de ler qualquer vínculo ou contagem: sem ele, 403 `sem-vinculo` com a negação na trilha.
    await this.acessoPaciente.exigirVinculo(s, n, 'rede.mpiAviso.ler', 'pep.prontuario');
    const mpi = await this.liberacao.consultar(s, CHAVE_LIBERACAO_MPI_REDE);
    if (!mpi.ligada)
      return { situacao: 'desligado', estabelecimentos: [], acessoCruzado: { pode: false, motivo: null } };
    const r = this.sessao(s, await this.liberadosAlemDaSessao(s));
    const podeLer = s.pode('pep.prontuario.lerRede');
    const aqui = podeLer ? await this.liberacao.consultar(s, CHAVE_LIBERACAO_ACESSO_CRUZADO_REDE) : null;
    const nomes = new Map(this.porta.estabelecimentos().map((e) => [e.codigo, e.nome]));
    const x = await this.servico.avisoDoPaciente(r, n, async (est) => {
      if (!podeLer)
        return { pode: false, motivo: 'Seu perfil não permite abrir o registro de outro estabelecimento.' };
      if (!aqui?.ligada) return { pode: false, motivo: aqui?.motivo ?? null };
      if (!(await this.liberacao.ligadaNoEstabelecimento(s.rede, est, CHAVE_LIBERACAO_ACESSO_CRUZADO_REDE)))
        return {
          pode: false,
          motivo: `O acesso ao prontuário entre os estabelecimentos ainda não foi liberado em ${nomes.get(est) ?? est}.`,
        };
      return { pode: true, motivo: null };
    });
    req.sghAlvo = {
      paciente: n,
      tabelaAlvo: 'SGH_REDE_VINCULO',
      idAlvo: String(n),
      chaveNaturalAlvo: `aviso:${x.situacao};n:${x.estabelecimentos.length}`,
    };
    return x;
  }

  @Get('divergencias')
  @Permissao('rede.mpi.ler')
  @Auditar(EVENTOS_AUDITAVEIS.redeDivergenciaLida.codigo)
  async divergencias(@Req() req: RequisicaoAutorizada): Promise<DivergenciasRede> {
    const { r } = await this.entrar(req);
    return this.servico.divergencias(r);
  }

  @Post('divergencias/reparo')
  @HttpCode(200)
  @Permissao('rede.mpi.vincular')
  @AuditadoNoHandler('SGH_TRILHA em cada transação SGH_ do reparo, no banco completado')
  async reparar(
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ reparados: number; pendentes: number; manuais: string[] }> {
    const { s, r } = await this.entrar(req);
    const res = await this.servico.reparar(r);
    await this.trilhaMemoria(s, EVENTOS_AUDITAVEIS.redeIndiceReparado.codigo, `reparados=${res.reparados}`);
    return res;
  }
}
