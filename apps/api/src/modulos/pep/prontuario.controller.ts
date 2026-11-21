// Prontuário ao vivo (M15; ficha, seção 7) — `PEP > Prontuário ao vivo: consulta`:
//   GET  /api/pep/pacientes?termo&tipo                          busca do paciente (a mesma do cadastro, mascarada)
//   GET  /api/pep/prontuario/:paciente/motivo                    o motivo desta sessão (sem dado clínico)
//   POST /api/pep/prontuario/:paciente/motivo                    informa o motivo (lista fechada; trilha)
//   GET  /api/pep/prontuario/:paciente?filtros                   lista dos registros (Consulta do RES: trilha dupla)
//   GET  /api/pep/prontuario/:paciente/registros/:registro        abertura do registro (marcas e abas)
//   GET  /api/pep/prontuario/:paciente/registros/:registro/:aba   uma aba (como emitido, layout, texto, respostas,
//                                                                 contexto)
//   GET  /api/pep/prontuario/:paciente/busca?termo&de&ate         busca de palavra nos registros do paciente
//   GET  /api/pep/liberacao                                      a chave de liberação vale para esta sessão?
//   GET  /api/pep/excecoes                                       exceções do estabelecimento (só contagens)
// Só leitura (regra 1): nenhuma rota grava em tabela clínica ou de cadastro. Toda leitura vai à trilha (regra
// 10) com o paciente, o registro, a parte e o motivo, nunca o conteúdo, o nome ou o termo da busca. A primeira
// abertura de cada paciente na sessão pede o motivo (regra 11: sem motivo, 422); com o parâmetro do
// estabelecimento que restringe o acesso a paciente fora do atendimento, vale a decisão do M06 (vínculo ou quebra
// de vidro vigente; sem a porta de vínculo real, ninguém tem vínculo: falha fechada). A primeira leitura de cada
// paciente na sessão é a Consulta do RES na trilha dupla (uma vez, como o Delphi; regra 13); as demais, só na
// trilha própria. Cada sessão lê o banco do seu estabelecimento (regra 14). Muitos prontuários em pouco tempo ou
// fora do horário habitual geram alerta ao Auditor (regra 12), contados em toda rota de leitura. Tudo depende da
// chave `pep.prontuario.consulta` (ficha, seção 12), por estabelecimento e setor: desligada, 403
// `recurso-desligado` com o motivo, e o menu e a paleta escondem o destino.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  ABAS_REGISTRO,
  type AbaRegistro,
  type AbaRegistroConteudo,
  CHAVE_LIBERACAO_PRONTUARIO,
  MOTIVO_FORA_DO_ESCOPO_ONDA_0,
  chaveLeitura,
  esquemaConsultaBuscaPaciente,
  esquemaConsultaPalavra,
  esquemaFiltrosRegistros,
  esquemaPedidoMotivo,
  EVENTOS_AUDITAVEIS,
  type LiberacaoProntuario,
  type ListaRegistros,
  type MotivoAberto,
  type MotivoAcessoProntuario,
  type ParteProntuario,
  recursoDesligado,
  type RegistroAberto,
  type RelatorioExcecoes,
  type ResultadoBuscaPaciente,
  type ResultadoPalavra,
} from '@sgh/contratos';
import { VinculoSintetico, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import { situacaoDaChave } from '@sgh/dominio-config';
import { Auditar, Permissao } from '../../autorizacao/decoradores.js';
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
import { idDaRota, problemaDoCadastro, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import { PORTA_CADASTRO, type PortaCadastro } from '../cadastro/porta.js';
import { buscarPacientes } from '../cadastro/servico.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  TTL_CONFIG_NOVO_S,
} from '../config/public-api.js';
import { AcessoPacientePep, chaveSessaoPep } from './acesso-paciente.js';
import { PORTA_DOCUMENTOS, type PortaDocumentos } from './documentos-porta.js';
import { categoriaDe } from './documentos-servico.js';
import { EstadoProntuario } from './sessao-prontuario.js';
import { ServicoProntuario } from './servico.js';

export const SERVICO_PRONTUARIO = Symbol('SERVICO_PRONTUARIO');
export const ESTADO_PRONTUARIO = Symbol('ESTADO_PRONTUARIO');

const PERMISSAO = 'pep.prontuario.ler';

/** Sem a fonte da configuração não há como saber se a chave vale: desligado (falha fechada). */
const MOTIVO_SEM_CONFIGURACAO =
  'A configuração das funcionalidades do estabelecimento não está disponível: o prontuário ao vivo fica desligado.';
const MOTIVO_DESLIGADO =
  'O prontuário ao vivo ainda não foi liberado para este estabelecimento ou setor. A liberação é feita pelo administrador em Funcionalidades por estabelecimento.';
const MOTIVO_PREREQUISITO = 'O prontuário ao vivo tem pré-requisito pendente neste estabelecimento.';

const chaveSessao = chaveSessaoPep;

@Controller('pep')
export class ProntuarioController {
  constructor(
    @Inject(SERVICO_PRONTUARIO) private readonly servico: ServicoProntuario,
    @Inject(ESTADO_PRONTUARIO) private readonly estado: EstadoProntuario,
    @Inject(PORTA_CADASTRO) private readonly cadastro: PortaCadastro,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) private readonly cache: CacheConfig | null = null,
    @Optional()
    @Inject(VINCULO_ASSISTENCIAL)
    vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
    @Optional()
    @Inject(PORTA_DOCUMENTOS)
    private readonly documentos: Pick<PortaDocumentos, 'profissional'> | null = null,
  ) {
    this.acesso = new AcessoPacientePep({
      estado,
      trilha,
      alerta,
      configuracao,
      vinculo,
      emergencia,
    });
  }

  /** Vínculo, primeira leitura e alertas: o mesmo serviço dos registros clínicos (M22). */
  private readonly acesso: AcessoPacientePep;

  /**
   * M23 (regra 15): a categoria assistencial de quem lê (pelo CBO em uso), para o sigilo da psicologia. Sem a porta
   * do prontuário de uso diário ou sem ocupação, nenhuma categoria: o conteúdo sigiloso fica oculto (falha fechada).
   */
  private async categoriaDoLeitor(s: SessaoCadastro) {
    if (!this.documentos) return null;
    const p = await this.documentos.profissional(s.porta, s.login).catch(() => null);
    return categoriaDe(p);
  }

  /** Chaves e pré-requisitos do estabelecimento (o mesmo cache do painel, invalidado depois do commit). */
  private async dadosLiberacao(s: SessaoCadastro) {
    const fonte = this.configuracao;
    if (!fonte) return null;
    const carregar = async () => ({
      chaves: await fonte.chaves(s.rede, s.hospital),
      prerequisitos: await fonte.prerequisitos(s.rede, s.hospital),
    });
    return this.cache
      ? this.cache.lerOuCarregar(
          this.cache.chave(s.rede, s.hospital, 'liberacao'),
          TTL_CONFIG_NOVO_S,
          carregar,
        )
      : carregar();
  }

  /** A chave `pep.prontuario.consulta` vale para esta pessoa e o setor ativo (ficha, seção 12)? */
  private async liberacao(s: SessaoCadastro): Promise<LiberacaoProntuario> {
    let dados: Awaited<ReturnType<ProntuarioController['dadosLiberacao']>>;
    try {
      dados = await this.dadosLiberacao(s);
    } catch {
      throw new ErroProblema(
        'indisponivel',
        503,
        'Configuração indisponível',
        'Não foi possível conferir a liberação do prontuário ao vivo. Tente de novo em instantes.',
      );
    }
    if (!dados) return { ligada: false, motivo: MOTIVO_SEM_CONFIGURACAO };
    const chaves = dados.chaves
      .filter((c) => c.chave === CHAVE_LIBERACAO_PRONTUARIO && c.tipo === 'recurso' && c.ligada !== null)
      .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
    const declarados = recursoDesligado(CHAVE_LIBERACAO_PRONTUARIO)?.prerequisitos ?? [];
    const registrados = dados.prerequisitos.filter((p) => p.recurso === CHAVE_LIBERACAO_PRONTUARIO);
    const setor = s.req.sgh?.sessao.unidadeAtiva;
    const grupo = s.req.sgh?.sessao.grupoLegado;
    const sujeito = {
      pessoa: s.login,
      ...(setor !== null && setor !== undefined ? { setor: String(setor) } : {}),
      ...(grupo ? { grupo } : {}),
    };
    // M38 (regra 3): ligada só para outros (grupo, setor ou pessoa) = fora do escopo da onda, com o aviso próprio.
    const situacao = situacaoDaChave({ chaves, declarados, registrados, sujeito, agora: new Date() });
    if (situacao === 'ligada') return { ligada: true, motivo: null };
    return {
      ligada: false,
      motivo:
        situacao === 'prerequisito'
          ? MOTIVO_PREREQUISITO
          : situacao === 'fora-do-escopo'
            ? MOTIVO_FORA_DO_ESCOPO_ONDA_0
            : MOTIVO_DESLIGADO,
    };
  }

  /** Desligada: 403 `recurso-desligado` com o motivo (nada é lido). */
  private async exigirLiberacao(s: SessaoCadastro): Promise<void> {
    const l = await this.liberacao(s);
    if (!l.ligada)
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Prontuário ao vivo desligado',
        l.motivo ?? MOTIVO_DESLIGADO,
        {
          codigo: 'recurso-desligado',
        },
      );
  }

  /**
   * Regra 11: com o parâmetro do estabelecimento que restringe o acesso a paciente fora do atendimento, a mesma
   * decisão do M06 (vínculo assistencial, ou quebra de vidro vigente). Sem vínculo: 403 `sem-vinculo`, com a
   * quebra de vidro quando o perfil pode pedi-la; a tentativa vai à trilha.
   */
  private exigirVinculo(s: SessaoCadastro, paciente: number): Promise<void> {
    return this.acesso.exigirVinculo(s, paciente, PERMISSAO, 'pep.prontuario');
  }

  /**
   * Toda rota de leitura do paciente: a liberação, o motivo (422), o vínculo; a primeira leitura do paciente
   * na sessão vai à trilha dupla como a Consulta do RES (uma vez; sem trilha, sem dado), e toda leitura conta
   * para os alertas ao Auditor (regra 12), qualquer que seja a rota.
   */
  private async abrirLeitura(
    s: SessaoCadastro,
    paciente: number,
    parte: ParteProntuario,
  ): Promise<MotivoAcessoProntuario> {
    await this.exigirLiberacao(s);
    const motivo = this.motivoOuErro(s, paciente);
    await this.exigirVinculo(s, paciente);
    await this.acesso.registrarLeitura(s, paciente, parte, motivo, 'pep.prontuario');
    return motivo;
  }

  @Get('liberacao')
  @Permissao(PERMISSAO)
  async liberacaoDaSessao(@Req() req: RequisicaoAutorizada): Promise<LiberacaoProntuario> {
    return this.liberacao(sessaoDe(req));
  }

  @Get('excecoes')
  @Permissao(PERMISSAO)
  @Auditar(EVENTOS_AUDITAVEIS.excecoesConsultadas.codigo)
  async excecoes(@Req() req: RequisicaoAutorizada): Promise<RelatorioExcecoes> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const r = await this.servico.excecoes(s.porta);
    req.sghAlvo = {
      tabelaAlvo: 'registro_assistencial',
      chaveNaturalAlvo: `excecoes;estratos:${r.linhas.length}`,
    };
    return r;
  }

  /** O motivo desta sessão para o paciente; sem ele, 422 (regra 11). */
  private motivoOuErro(s: SessaoCadastro, paciente: number): MotivoAcessoProntuario {
    const m = this.estado.motivo(chaveSessao(s), paciente);
    if (!m)
      throw new ErroProblema(
        'motivo-necessario',
        422,
        'Informe o motivo do acesso ao prontuário',
        'A primeira abertura do prontuário deste paciente na sessão pede o motivo (lista fechada).',
        { codigo: 'motivo-necessario' },
      );
    return m;
  }

  @Get('pacientes')
  @Permissao(PERMISSAO)
  @Auditar('cadastro.paciente.buscado')
  async pacientes(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoBuscaPaciente> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const c = esquemaConsultaBuscaPaciente.safeParse(q);
    if (!c.success)
      throw new ErroProblema('entrada-invalida', 400, 'Consulta inválida', 'Informe o termo da busca.');
    const r = await buscarPacientes(this.cadastro, s.porta, c.data).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    // Na trilha, só o tipo e a quantidade (nunca o termo).
    req.sghAlvo = { tabelaAlvo: 'paciente', chaveNaturalAlvo: `busca:${r.tipo};n:${r.itens.length};pep` };
    return r;
  }

  @Get('prontuario/:paciente/motivo')
  @Permissao(PERMISSAO)
  async motivo(@Param('paciente') p: string, @Req() req: RequisicaoAutorizada): Promise<MotivoAberto> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const paciente = idDaRota(p);
    return {
      paciente,
      motivo: this.estado.motivo(chaveSessao(s), paciente),
      restricaoAtendimento: req.sgh?.sessao.restricaoVinculo === true,
    };
  }

  @Post('prontuario/:paciente/motivo')
  @HttpCode(200)
  @Permissao(PERMISSAO)
  @Auditar('pep.motivo.informado')
  async informarMotivo(
    @Param('paciente') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<MotivoAberto> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const paciente = idDaRota(p);
    const m = esquemaPedidoMotivo.safeParse(corpo ?? {});
    if (!m.success)
      throw new ErroProblema('motivo-necessario', 422, 'Motivo inválido', 'Escolha um motivo da lista.', {
        codigo: 'motivo-necessario',
        campos: ['motivo'],
      });
    // O paciente existe neste estabelecimento (404 igual para inexistente e de outro banco).
    await this.servico.cabecalho(s.porta, paciente);
    await this.exigirVinculo(s, paciente);
    this.estado.registrarMotivo(chaveSessao(s), paciente, m.data.motivo);
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'paciente',
      idAlvo: String(paciente),
      chaveNaturalAlvo: chaveLeitura('lista', m.data.motivo, 'motivo-informado'),
    };
    return {
      paciente,
      motivo: m.data.motivo,
      restricaoAtendimento: req.sgh?.sessao.restricaoVinculo === true,
    };
  }

  @Get('prontuario/:paciente')
  @Permissao(PERMISSAO)
  @Auditar(EVENTOS_AUDITAVEIS.registrosListados.codigo)
  async lista(
    @Param('paciente') p: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaRegistros> {
    const s = sessaoDe(req);
    const paciente = idDaRota(p);
    const f = esquemaFiltrosRegistros.safeParse(q);
    if (!f.success)
      throw new ErroProblema('entrada-invalida', 400, 'Filtro inválido', 'Confira os filtros da lista.');
    const motivo = await this.abrirLeitura(s, paciente, 'lista');
    const r = await this.servico.lista(s.porta, paciente, f.data);
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'paciente',
      idAlvo: String(paciente),
      chaveNaturalAlvo: chaveLeitura('lista', motivo, `p:${f.data.pagina};n:${r.itens.length}`),
    };
    return r;
  }

  @Get('prontuario/:paciente/busca')
  @Permissao(PERMISSAO)
  @Auditar('pep.prontuario.buscado')
  async busca(
    @Param('paciente') p: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoPalavra> {
    const s = sessaoDe(req);
    const paciente = idDaRota(p);
    const c = esquemaConsultaPalavra.safeParse(q);
    if (!c.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Busca inválida',
        'Informe uma palavra de 3 letras ou mais.',
      );
    const motivo = await this.abrirLeitura(s, paciente, 'busca');
    const r = await this.servico.buscar(s.porta, paciente, c.data, await this.categoriaDoLeitor(s));
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'registro_assistencial',
      chaveNaturalAlvo: chaveLeitura('busca', motivo, `lidos:${r.lidos};n:${r.itens.length}`),
    };
    return r;
  }

  @Get('prontuario/:paciente/registros/:registro')
  @Permissao(PERMISSAO)
  @Auditar('pep.registro.lido')
  async registro(
    @Param('paciente') p: string,
    @Param('registro') x: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RegistroAberto> {
    const s = sessaoDe(req);
    const paciente = idDaRota(p);
    const id = idDaRota(x);
    const motivo = await this.abrirLeitura(s, paciente, 'registro');
    const r = await this.servico.abrir(s.porta, paciente, id, await this.categoriaDoLeitor(s));
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'registro_assistencial',
      idAlvo: String(id),
      chaveNaturalAlvo: chaveLeitura('registro', motivo),
    };
    return r;
  }

  @Get('prontuario/:paciente/registros/:registro/:aba')
  @Permissao(PERMISSAO)
  @Auditar('pep.registro.lido')
  async aba(
    @Param('paciente') p: string,
    @Param('registro') x: string,
    @Param('aba') a: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AbaRegistroConteudo> {
    const s = sessaoDe(req);
    const paciente = idDaRota(p);
    const id = idDaRota(x);
    if (!(ABAS_REGISTRO as readonly string[]).includes(a))
      throw new ErroProblema('nao-encontrado', 404, 'Parte do registro não encontrada');
    const aba = a as AbaRegistro;
    const motivo = await this.abrirLeitura(s, paciente, aba);
    const r = await this.servico.aba(s.porta, paciente, id, aba, {
      mostrarDocumentos: s.pode('cadastro.paciente.verDocumento'),
      leitor: await this.categoriaDoLeitor(s),
    });
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'registro_assistencial',
      idAlvo: String(id),
      chaveNaturalAlvo: chaveLeitura(aba, motivo),
    };
    return r;
  }
}
