// Protocolos gerenciados no pronto atendimento (M44, etapa 3; ficha, seções 4, 5, 7 e 8, regra 8):
//   GET  /api/pa/protocolos-gerenciados/relogio            o relógio: protocolos abertos com as metas e os prazos, os
//                                                          encerrados do dia, as sugestões da classificação e a adesão
//                                                          (lista com nomes: leitura auditada)
//   GET  /api/pa/protocolos-gerenciados/definicoes         as versões publicadas das definições (a vigente marcada)
//   POST /api/pa/protocolos-gerenciados/definicoes         recepcao.publicarProtocoloGerenciado (diretoria clínica,
//                                                          crítica: reautenticação; autor ≠ aprovador)
//   POST /api/pa/protocolos-gerenciados                    recepcao.iniciarProtocoloGerenciado (enfermeiro ou médico)
//   POST /api/pa/protocolos-gerenciados/:id/metas          recepcao.registrarMetaProtocolo (perdida com o motivo)
//   POST /api/pa/protocolos-gerenciados/:id/encerrar       recepcao.encerrarProtocoloGerenciado
// Com a trilha na mesma transação; a liberação é a da classificação (`pa.classificacao`).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import {
  CHAVE_LIBERACAO_CLASSIFICACAO,
  esquemaEncerrarProtocoloGerenciado,
  esquemaIniciarProtocoloGerenciado,
  esquemaPublicarProtocoloGerenciado,
  esquemaRegistrarMetaProtocolo,
  EVENTOS_AUDITAVEIS,
  type GerenciadoComConteudo,
  PERMISSOES_PROTOCOLO_GERENCIADO_CODIGOS as P,
  type RelogioProtocolos,
  type ResultadoProtocoloGerenciado,
} from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import {
  AVISOS_ATENDIMENTO,
  type AvisosAtendimento,
  PORTA_ATENDIMENTO,
  type PortaAtendimento,
} from '../atendimento/public-api.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { ApoioClassificacao } from './apoio.js';
import { portaDeModuloAusente } from './indisponivel.js';
import { conferirAutorDoProtocolo, fonteAtendimentosPa } from './classificacao.controller.js';
import {
  type GravadorClassificacao,
  PORTA_CLASSIFICACAO,
  type PortaClassificacao,
} from './classificacao-porta.js';
import { ServicoProtocoloGerenciado, type SessaoGerenciado } from './protocolo-gerenciado-servico.js';

const TABELA_PAC = 'inclusao_protocolo_paciente';
const TABELA_EVT = 'inclusao_protocolo_evento';

@Controller('pa/protocolos-gerenciados')
export class ProtocoloGerenciadoController {
  private readonly apoio: ApoioClassificacao<GravadorClassificacao>;
  private readonly atendimento: PortaAtendimento;

  constructor(
    @Inject(PORTA_CLASSIFICACAO) private readonly porta: PortaClassificacao,
    // Sem o módulo do atendimento montado, as leituras do PA respondem 503 (porta ausente), sem derrubar a API.
    @Optional() @Inject(PORTA_ATENDIMENTO) atendimento: PortaAtendimento | null,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(AVISOS_ATENDIMENTO) private readonly avisos: AvisosAtendimento | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
  ) {
    this.atendimento = atendimento ?? portaDeModuloAusente<PortaAtendimento>();
    this.apoio = new ApoioClassificacao(
      { chave: CHAVE_LIBERACAO_CLASSIFICACAO, nome: 'o relógio dos protocolos gerenciados', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private servico(): ServicoProtocoloGerenciado {
    return new ServicoProtocoloGerenciado(this.porta, fonteAtendimentosPa(this.atendimento));
  }

  private sessao(s: SessaoCadastro): SessaoGerenciado {
    return { c: s.porta, login: s.login, pode: (p) => s.pode(p) };
  }

  private exigir(s: SessaoCadastro, permissao: string): void {
    if (!s.pode(permissao))
      throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Seu perfil não permite esta ação.', {
        codigo: 'sem-permissao',
      });
  }

  @Get('relogio')
  @Permissao(P.protocoloPacienteLer)
  @Auditar(EVENTOS_AUDITAVEIS.protocoloPacienteLido.codigo)
  async relogio(@Req() req: RequisicaoAutorizada): Promise<RelogioProtocolos> {
    const s = sessaoDe(req);
    const r = await this.servico().relogio(this.sessao(s), await this.apoio.liberacao(s));
    req.sghAlvo = { tabelaAlvo: TABELA_PAC, chaveNaturalAlvo: `parte:relogio;n:${r.ativos.length}` };
    return r;
  }

  @Get('definicoes')
  @Permissao('recepcao.protocolo.ler')
  definicoes(@Req() req: RequisicaoAutorizada): Promise<GerenciadoComConteudo[]> {
    return this.servico().definicoes(sessaoDe(req).porta);
  }

  @Post('definicoes')
  @HttpCode(201)
  @Permissao('recepcao.protocolo.publicar')
  @AuditadoNoHandler(
    'recepcao.publicarProtocoloGerenciado: protocolo_gerenciado_versao e trilha_auditoria na mesma transação',
  )
  async publicar(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number; versao: number; mensagem: string }> {
    const s = sessaoDe(req);
    const e = corpo(esquemaPublicarProtocoloGerenciado, b);
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário.',
      );
    await reautenticar(this.sessoes, this.resolvedor, req, e.senha);
    const autor = await conferirAutorDoProtocolo(this.sessoes, s, e.autor);
    const linha = await this.servico().prepararPublicacao(this.sessao(s), { ...e, autor });
    const r = await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.protocoloGerenciadoPublicado.codigo,
      'recepcao.protocolo.publicar',
      (x: { id: number; versao: number }) => ({
        tabela: 'protocolo_gerenciado_versao',
        id: String(x.id),
        chave: `${linha.tipo}:v${x.versao}`,
      }),
      (g) => g.publicarGerenciado(linha),
    );
    return { ...r, mensagem: `Versão ${r.versao} publicada: vale para as inclusões novas.` };
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.protocoloPacienteIniciar)
  @AuditadoNoHandler(
    'recepcao.iniciarProtocoloGerenciado: inclusao_protocolo_paciente e trilha_auditoria na mesma transação',
  )
  async iniciar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoProtocoloGerenciado> {
    const s = sessaoDe(req);
    const e = corpo(esquemaIniciarProtocoloGerenciado, b);
    const p = await this.servico().prepararInclusao(this.sessao(s), e);
    const id = await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.protocoloPacienteIniciado.codigo,
      'recepcao.protocoloPaciente.iniciar',
      (x: number) => ({
        tabela: TABELA_PAC,
        id: String(x),
        paciente: p.pac.id,
        chave: `${p.linha.reg}:${e.tipo}`,
      }),
      (g) => g.incluirProtocolo(p.linha),
    );
    this.avisos?.avisar(s.hospital);
    return { id, mensagem: 'Paciente incluído no protocolo: o relógio começou.', avisos: [] };
  }

  @Post(':id/metas')
  @HttpCode(201)
  @Permissao(P.protocoloPacienteRegistrar)
  @AuditadoNoHandler(
    'recepcao.registrarMetaProtocolo: inclusao_protocolo_evento e trilha_auditoria na mesma transação',
  )
  async meta(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoProtocoloGerenciado> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarMetaProtocolo, b);
    const m = await this.servico().prepararMeta(this.sessao(s), idDaRota(id), e);
    const ev = await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.protocoloPacienteMetaRegistrada.codigo,
      'recepcao.protocoloPaciente.registrar',
      (x: number) => ({
        tabela: TABELA_EVT,
        id: String(x),
        paciente: m.p.paciente,
        chave: `${m.p.id}:${e.tipo}:${e.item}:${m.situacao}`,
      }),
      (g) => g.registrarEventoProtocolo(m.linha),
    );
    this.avisos?.avisar(s.hospital);
    return {
      id: ev,
      mensagem:
        m.situacao === 'cumprida'
          ? 'Registrado: cumprida no prazo.'
          : 'Registrado como perdida, com o motivo.',
      avisos: [],
    };
  }

  @Post(':id/encerrar')
  @HttpCode(201)
  @Permissao(P.protocoloPacienteRegistrar)
  @AuditadoNoHandler(
    'recepcao.encerrarProtocoloGerenciado: inclusao_protocolo_evento e trilha_auditoria na mesma transação',
  )
  async encerrar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoProtocoloGerenciado> {
    const s = sessaoDe(req);
    this.exigir(s, P.protocoloPacienteRegistrar);
    const e = corpo(esquemaEncerrarProtocoloGerenciado, b);
    const m = await this.servico().prepararEncerramento(this.sessao(s), idDaRota(id), e);
    const ev = await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.protocoloPacienteEncerrado.codigo,
      'recepcao.protocoloPaciente.registrar',
      (x: number) => ({
        tabela: TABELA_EVT,
        id: String(x),
        paciente: m.p.paciente,
        chave: `${m.p.id}:${e.desfecho}`,
      }),
      (g) => g.registrarEventoProtocolo(m.linha),
    );
    this.avisos?.avisar(s.hospital);
    return { id: ev, mensagem: 'Protocolo encerrado: o relógio parou.', avisos: [] };
  }
}
