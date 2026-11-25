// Prontuário de uso diário (M23; ficha, seção 7) — `PEP > Meus pacientes`, o prontuário do paciente com o cabeçalho
// fixo e as abas (linha do tempo, alergias, problemas, exames, resultados, receitas, atestados, TCLE, alta, anexos e
// tempos), a fila de pareceres e as pendências de assinatura:
//   GET  /api/pep/painel                                          painel "Meus pacientes"
//   GET  /api/pep/paciente/:p/cabecalho                           cabeçalho fixo, atendimentos e alertas
//   GET  /api/pep/paciente/:p/linha-do-tempo                      linha do tempo (sigilo da categoria)
//   GET  /api/pep/paciente/:p/documentos/:tipo/:id                documento aberto (auditado)
//   POST /api/pep/paciente/:p/documentos/:tipo/:id/imprimir       PDF/A (1ª via; 2ª via com motivo)
//   POST /api/pep/paciente/:p/exportar                            prontuário completo (crítica, justificativa)
//   GET|POST /api/pep/paciente/:p/alergias[/:id/inativar]         alergias (executor)
//   GET  /api/pep/paciente/:p/alergias/:id/historico               linha do tempo e manifestações da alergia
//   POST /api/pep/paciente/:p/alergias/:id/reativar|alterar        reativação (motivo) e alteração da alergia
//   GET|POST /api/pep/paciente/:p/problemas[/:id/situacao]        lista de problemas (só do novo)
//   GET|POST /api/pep/paciente/:p/exames                          pedidos de exame (executor), avisos
//   GET  /api/pep/paciente/:p/resultados                          resultados, tendência, críticos
//   POST /api/pep/paciente/:p/resultados/:exame/ciencia           ciência de valor crítico
//   POST /api/pep/paciente/:p/resultados/externo                  exame externo (executor)
//   GET|POST /api/pep/paciente/:p/receitas[/:id/suspender]        receituário (executor)
//   GET|POST /api/pep/paciente/:p/atestados[/:id/suspender]       atestados e declarações (executor)
//   GET|POST /api/pep/paciente/:p/tcle[/:id/situacao]             termo de consentimento (só do novo)
//   GET  /api/pep/paciente/:p/alta                                sumário, transferência e óbito
//   POST /api/pep/paciente/:p/alta/rascunho|finalizar|transferencia|obito|obito/cancelar
//   GET|POST /api/pep/paciente/:p/anexos[/:id/arquivo]            anexos (executor)
//   GET  /api/pep/paciente/:p/tempos                              registro de tempo
//   GET  /api/pep/interconsultas, POST /:id/aceitar|cancelar       fila do parecer
//   GET  /api/pep/assinaturas[/:id/previa], POST /api/pep/assinaturas   pendências e assinatura em lote
// Toda leitura de dado do paciente passa pelo vínculo assistencial (AcessoPacientePep) e vai à trilha; as gravações
// vão à trilha na mesma transação (executor ou transação SGH_). Cada ação depende da sua chave de liberação (POL-3).
import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type AcaoLiberada,
  type AlergiasPaciente,
  type HistoricoAlergia,
  type AltaPaciente,
  type AnexosPaciente,
  type CabecalhoPep,
  type DocumentoAberto,
  type DocumentoGravado,
  type DocumentosPaciente,
  esquemaAnexarDocumento,
  esquemaAssinarLote,
  esquemaCancelarParecer,
  esquemaCoassinar,
  esquemaCienciaCritico,
  esquemaCancelamentoObito,
  esquemaDeclaracaoObito,
  esquemaEmitirAtestado,
  esquemaEmitirReceita,
  esquemaEmitirTcle,
  esquemaExameExterno,
  esquemaExportarProntuario,
  esquemaFiltrosLinhaTempo,
  esquemaFiltrosPainel,
  esquemaFiltrosParecer,
  esquemaGravarProblema,
  esquemaAlterarAlergia,
  esquemaInativarAlergia,
  esquemaReativarAlergia,
  esquemaRegistrarAlergia,
  esquemaRelatorioTransferencia,
  esquemaSalvarSumario,
  esquemaImprimirDocumentoProntuario,
  type ViasDocumentoProntuario,
  esquemaSituacaoProblema,
  esquemaSituacaoTcle,
  esquemaSolicitarExames,
  esquemaSuspenderDocumento,
  type FilaPareceres,
  type LinhaTempo,
  marcaSuporteTecnico,
  type PainelPacientes,
  type PedidosExame,
  type PendenciasAssinatura,
  type PreviaAssinatura,
  type ProblemaPep,
  RECURSOS_M23,
  type ResultadoAssinatura,
  type ResultadoSolicitacao,
  type ResultadosPaciente,
  type EstudosDoPaciente,
  EVENTOS_AUDITAVEIS,
  type TclesPaciente,
  type TempoEvento,
  TIPOS_DOCUMENTO_ABERTO,
  type TipoDocumentoAberto,
} from '@sgh/contratos';
import { regraJustificativaImpressao } from '@sgh/dominio-pep';
import { VinculoSintetico, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import {
  camposDoDocumentoPep,
  COMPLEMENTO_MINIMO_REIMPRESSAO,
  MENSAGEM_NOVA_VIA,
  modeloDoTipo,
  planoNovaViaProntuario,
  TITULOS_PEP,
} from '@sgh/dominio-documento';
import { type ContextoGravacaoPep, ErroProntuario } from './tipos-pep.js';
import { AuditadoNoHandler, Auditar, Permissao, PermissaoOu } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { ALERTA_AUDITOR, type AlertaAuditor } from '../acesso/alerta.js';
import {
  REGISTRO_EMERGENCIA,
  type RegistroEmergencia,
  VINCULO_ASSISTENCIAL,
} from '../acesso/emergencia.controller.js';
import {
  contextoOperacao,
  idDaRota,
  problemaDoCadastro,
  sessaoDe,
  type SessaoCadastro,
} from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { FONTE_DOCUMENTO, type FonteDocumento } from '../documento/fonte.js';
import { AcessoPacientePep, chaveSessaoPep } from './acesso-paciente.js';
import type { ContextoDocs, ProfissionalPep } from './documentos-porta.js';
import { categoriaDe, type ServicoDocumentos } from './documentos-servico.js';
import { LiberacaoPep } from './liberacao-pep.js';
import { ESTADO_PRONTUARIO } from './prontuario.controller.js';
import type { EstadoProntuario } from './sessao-prontuario.js';
import { PORTA_SUMARIO_SECOES, type PortaSumarioSecoesPropria } from './sumario-alta-secoes-propria.js';
import { PORTA_GRUPOS_RESULTADO, type PortaGruposResultadoPropria } from './resultados-grupos-propria.js';

export const SERVICO_DOCUMENTOS = Symbol('SERVICO_DOCUMENTOS');
/** M47 (etapa 3): quem lê os estudos de imagem do paciente (a lista de trabalho DICOM do SADT). */
export const ESTUDOS_IMAGEM_PEP = Symbol('ESTUDOS_IMAGEM_PEP');
export interface FonteEstudosImagem {
  estudosDoPaciente(s: SessaoCadastro, paciente: number): Promise<EstudosDoPaciente>;
}

function entradaInvalida(issues: readonly { path: readonly PropertyKey[]; message: string }[]): ErroProblema {
  const campos = [...new Set(issues.map((i) => i.path.map(String).join('.') || '(entrada)'))].slice(0, 20);
  return new ErroProblema(
    'entrada-invalida',
    400,
    'Dados inválidos',
    issues
      .slice(0, 3)
      .map((i) => i.message)
      .join(' '),
    { codigo: 'entrada-invalida', campos },
  );
}

function validar<T>(
  esquema: {
    safeParse(
      x: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  },
  x: unknown,
): T {
  const r = esquema.safeParse(x ?? {});
  if (!r.success) throw entradaInvalida(r.error.issues);
  return r.data;
}

/** Erro da gravação → Problem Details (recusa da transação SGH_ com o código; o resto, como o cadastro). */
function traduzir(e: unknown): never {
  if (e instanceof ErroProntuario)
    throw new ErroProblema(
      e.status === 404
        ? 'nao-encontrado'
        : e.codigo === 'conflito-versao'
          ? 'conflito-de-versao'
          : 'recusa-de-negocio',
      e.status,
      'Operação recusada',
      e.message,
      { codigo: e.codigo },
    );
  throw problemaDoCadastro(e);
}

/**
 * 04-INT L74 (CFM Res. 1.779/2005): a sessão tem a permissão do responsável técnico ou diretor clínico para cancelar a
 * declaração de óbito de outro médico (concedida ao perfil diretoria-clinica). Exportada para o teste do controller.
 */
const CANCELAR_OBITO_DE_OUTRO = 'pep.declaracaoObito.cancelarOutro';
export function podeCancelarObitoDeOutro(req: RequisicaoAutorizada): boolean {
  return (req.sgh?.sessao.permissoes ?? []).includes(CANCELAR_OBITO_DE_OUTRO);
}

/**
 * A permissão com que a sessão entra na rota de `PermissaoOu`: a primeira da lista que ela tem (a guarda já garantiu
 * uma). O diretor clínico pode não emitir nem ler o sumário pelo seu grupo e ainda assim abrir a declaração de outro
 * médico para cancelá-la (04-INT L74).
 */
export function permissaoDaSessao(req: RequisicaoAutorizada, ...codigos: string[]): string {
  const tem = req.sgh?.sessao.permissoes ?? [];
  return codigos.find((c) => tem.includes(c)) ?? codigos[0]!;
}

const TABELA_DO_TIPO: Readonly<Record<TipoDocumentoAberto, string>> = {
  registro: 'registro_assistencial',
  receita: 'receita_medica',
  atestado: 'documento_emitido',
  'pedido-exame': 'requisicao_exame',
  'exame-externo': 'exame_lancado_prontuario',
  anexo: 'anexo_prontuario',
  tcle: 'termo_consentimento_paciente',
  'sumario-alta': 'documento_emitido',
  'rel-transferencia': 'relatorio_transferencia',
  'declaracao-obito': 'declaracao_obito',
};

@Controller('pep')
export class DocumentosPepController {
  private readonly acesso: AcessoPacientePep;
  // F3.3 (L124): seções configuradas do sumário de alta; as obrigatórias sem conteúdo recusam a finalização.
  @Optional() @Inject(PORTA_SUMARIO_SECOES) private readonly secoesSumario: PortaSumarioSecoesPropria | null =
    null;
  // F3.3 (L128): grupos comparativos e filtro salvo; o comparativo do paciente passa pelo vínculo e pela leitura.
  @Optional()
  @Inject(PORTA_GRUPOS_RESULTADO)
  private readonly gruposResultado: PortaGruposResultadoPropria | null = null;
  private readonly liberacao: LiberacaoPep;

  constructor(
    @Inject(SERVICO_DOCUMENTOS) private readonly servico: ServicoDocumentos,
    @Inject(ESTADO_PRONTUARIO) private readonly estado: EstadoProntuario,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional() @Inject(VINCULO_ASSISTENCIAL) vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
    @Optional() @Inject(FONTE_DOCUMENTO) private readonly documento: FonteDocumento | null = null,
    @Optional() @Inject(ESTUDOS_IMAGEM_PEP) private readonly imagens: FonteEstudosImagem | null = null,
  ) {
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
    this.liberacao = new LiberacaoPep(configuracao, cache);
  }

  // ── Comuns ───────────────────────────────────────────────────────────────────────────────────────

  private c(s: SessaoCadastro): ContextoDocs {
    return s.porta;
  }

  private sgh(s: SessaoCadastro, rotulo: string): ContextoGravacaoPep {
    return {
      ...s.porta,
      usuarioLogin: s.login,
      traceId: correlacaoDaRequisicao(s.req, rotulo).slice(0, 64),
      estacao: estacaoDaRequisicao(s.req).slice(0, 80),
    };
  }

  /** Paciente deste estabelecimento + vínculo assistencial + (na leitura) a primeira leitura na trilha dupla. */
  private async paciente(s: SessaoCadastro, p: string, permissao: string, leitura: boolean): Promise<number> {
    const paciente = idDaRota(p);
    await this.servico.exigirPaciente(this.c(s), paciente);
    await this.acesso.exigirVinculo(s, paciente, permissao, 'pep.prontuario');
    if (leitura) {
      const motivo = this.estado.motivo(chaveSessaoPep(s), paciente) ?? 'assistencia';
      if (!this.estado.motivo(chaveSessaoPep(s), paciente))
        this.estado.registrarMotivo(chaveSessaoPep(s), paciente, motivo);
      await this.acesso.registrarLeitura(s, paciente, 'lista', motivo, 'pep.prontuario');
    }
    return paciente;
  }

  /** A ação grava agora? A permissão da tela, a chave de liberação e o passo 0 do executor (quando há). */
  private async acao(
    s: SessaoCadastro,
    permissao: string,
    chave: string,
    operacao: string | null,
  ): Promise<AcaoLiberada> {
    if (!s.pode(permissao)) return { pode: false, motivo: 'Seu perfil não permite esta ação.' };
    const l = await this.liberacao.consultar(s, chave);
    if (!l.ligada) return { pode: false, motivo: l.motivo };
    if (operacao) return this.servico.podeGravar(this.c(s), operacao, s.login);
    return { pode: true, motivo: null };
  }

  private async prof(s: SessaoCadastro): Promise<ProfissionalPep | null> {
    return this.servico.profissional(this.c(s), s.login);
  }

  private async reautenticado(req: RequisicaoAutorizada, senha: string | undefined): Promise<number> {
    return this.servico.destino === 'memoria' && !req.sgh?.real
      ? Date.now()
      : reautenticar(this.sessoes, this.resolvedor, req, senha);
  }

  private async executar(
    s: SessaoCadastro,
    operacao: string,
    entrada: unknown,
    rotulo: string,
    extra: { reautenticadoEm?: number } = {},
  ): Promise<Record<string, unknown>> {
    try {
      return await this.servico.executar(this.c(s), operacao, entrada, {
        ...contextoOperacao(s, rotulo),
        ...extra,
      });
    } catch (x) {
      traduzir(x);
    }
  }

  private async gravarSgh<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (x) {
      traduzir(x);
    }
  }

  // ── Painel ───────────────────────────────────────────────────────────────────────────────────────

  @Get('painel')
  @Permissao('pep.painel.ler')
  @Auditar('pep.painel.lido')
  async painel(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PainelPacientes> {
    const s = sessaoDe(req);
    const f = validar(esquemaFiltrosPainel, q);
    const favs =
      typeof q['ids'] === 'string'
        ? q['ids']
            .split(',')
            .map(Number)
            .filter((n) => Number.isInteger(n) && n > 0)
        : null;
    const vinculo = f.vinculo ?? 'todos';
    // Recortes do filtro salvo (F3.3, L90): só entram os informados.
    const recortes =
      (f.setor ?? f.acomodacao ?? f.leito ?? f.especialidade ?? f.tipo ?? f.situacao)
        ? {
            setor: f.setor ?? null,
            acomodacao: f.acomodacao ?? null,
            leito: f.leito ?? null,
            especialidade: f.especialidade ?? null,
            tipoAtendimento: f.tipo ?? null,
            situacao: f.situacao ?? null,
          }
        : null;
    const r = await this.servico.painel(this.c(s), s.login, {
      unidade: f.unidade ?? null,
      busca: f.busca?.trim() || null,
      favoritos: f.favoritos === 'sim' ? (favs ?? []) : null,
      vinculo,
      profissional: vinculo === 'todos' ? null : await this.prof(s),
      ...(recortes ? { filtro: recortes } : {}),
    });
    req.sghAlvo = {
      tabelaAlvo: 'atendimento',
      chaveNaturalAlvo: `painel;unidade:${f.unidade ?? '*'};vinculo:${vinculo};n:${r.total}`,
    };
    return {
      unidades: r.unidades,
      preferencias: {
        colunas: ['leito', 'paciente', 'idade', 'dias', 'convenio', 'medico', 'alergias', 'alertas'],
        unidade: r.preferenciaUnidade,
        soFavoritos: false,
      },
      pacientes: r.pacientes,
      total: r.total,
      teto: 300,
      configurar: s.pode('pep.painel.configurar'),
      limitado: r.limitado,
    };
  }

  // ── Cabeçalho, linha do tempo e documento ──────────────────────────────────────────────────────

  @Get('paciente/:p/cabecalho')
  @Permissao('pep.prontuario.ler')
  @Auditar('pep.cabecalho.lido')
  async cabecalho(@Param('p') p: string, @Req() req: RequisicaoAutorizada): Promise<CabecalhoPep> {
    const s = sessaoDe(req);
    const paciente = await this.paciente(s, p, 'pep.prontuario.ler', true);
    const r = await this.servico.cabecalho(this.c(s), paciente, await this.prof(s), s.login);
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'paciente',
      idAlvo: String(paciente),
      chaveNaturalAlvo: 'parte:cabecalho',
    };
    return r;
  }

  @Get('paciente/:p/linha-do-tempo')
  @Permissao('pep.prontuario.ler')
  @Auditar('pep.linhaTempo.lida')
  async linhaTempo(
    @Param('p') p: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<LinhaTempo> {
    const s = sessaoDe(req);
    const f = validar(esquemaFiltrosLinhaTempo, q);
    const paciente = await this.paciente(s, p, 'pep.prontuario.ler', true);
    const r = await this.servico.linhaTempo(this.c(s), paciente, f, await this.prof(s));
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'registro_assistencial',
      chaveNaturalAlvo: `parte:linha-do-tempo;pagina:${r.pagina};n:${r.eventos.length}`,
    };
    return r;
  }

  @Get('paciente/:p/documentos/:tipo/:id')
  @Permissao('pep.prontuario.ler')
  @Auditar('pep.documento.lido')
  async documentoAberto(
    @Param('p') p: string,
    @Param('tipo') t: string,
    @Param('id') i: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DocumentoAberto> {
    const s = sessaoDe(req);
    if (!(TIPOS_DOCUMENTO_ABERTO as readonly string[]).includes(t))
      throw new ErroProblema('nao-encontrado', 404, 'Documento não encontrado');
    const tipo = t as TipoDocumentoAberto;
    const id = idDaRota(i);
    const paciente = await this.paciente(s, p, 'pep.prontuario.ler', true);
    const r = await this.servico.abrir(this.c(s), paciente, tipo, id, await this.prof(s));
    req.sghAlvo = {
      paciente,
      tabelaAlvo: TABELA_DO_TIPO[tipo],
      idAlvo: String(id),
      chaveNaturalAlvo: `documento:${tipo}`,
    };
    return r;
  }

  /**
   * As vias do documento (01-ADM L79): se a 1ª via já saiu (a próxima é nova via, com motivo do catálogo) e os
   * motivos ativos de reimpressão, para a tela pedir o motivo certo antes de imprimir.
   */
  @Get('paciente/:p/documentos/:tipo/:id/vias')
  @Permissao('pep.prontuario.ler')
  @Auditar('pep.documento.lido')
  async viasDocumento(
    @Param('p') p: string,
    @Param('tipo') t: string,
    @Param('id') i: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ViasDocumentoProntuario> {
    const s = sessaoDe(req);
    if (!(TIPOS_DOCUMENTO_ABERTO as readonly string[]).includes(t))
      throw new ErroProblema('nao-encontrado', 404, 'Documento não encontrado');
    const tipo = t as TipoDocumentoAberto;
    const id = idDaRota(i);
    const paciente = await this.paciente(s, p, 'pep.prontuario.ler', true);
    const modelo = modeloDoTipo(tipo === 'receita' ? 'receita' : tipo);
    const original = this.documento
      ? await this.documento.emissao
          .originalDaOrigem(s.hospital, modelo, { tipo, idLegado: id })
          .catch(() => null)
      : null;
    req.sghAlvo = {
      paciente,
      tabelaAlvo: TABELA_DO_TIPO[tipo],
      idAlvo: String(id),
      chaveNaturalAlvo: `vias:${tipo}`,
    };
    return {
      impresso: original !== null,
      motivos: await this.servico.porta.motivosReimpressao(this.c(s)),
      complementoMinimo: COMPLEMENTO_MINIMO_REIMPRESSAO,
    };
  }

  @Post('paciente/:p/documentos/:tipo/:id/imprimir')
  @HttpCode(200)
  @Permissao('pep.prontuario.ler')
  @Auditar('pep.documento.lido')
  @Header('content-type', 'application/pdf')
  async imprimir(
    @Param('p') p: string,
    @Param('tipo') t: string,
    @Param('id') i: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: { header(n: string, v: string): unknown },
  ): Promise<Buffer> {
    const s = sessaoDe(req);
    if (!(TIPOS_DOCUMENTO_ABERTO as readonly string[]).includes(t))
      throw new ErroProblema('nao-encontrado', 404, 'Documento não encontrado');
    const tipo = t as TipoDocumentoAberto;
    const id = idDaRota(i);
    const paciente = await this.paciente(s, p, 'pep.prontuario.ler', true);
    const d = await this.servico.abrir(this.c(s), paciente, tipo, id, await this.prof(s));
    if (!d.pdf)
      throw new ErroProblema('recusa-de-negocio', 409, 'Sem impressão', 'Este documento não tem impressão.');
    const fonte = this.documento;
    if (!fonte)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Emissão indisponível',
        'O serviço de emissão de documentos não está configurado.',
      );
    const pac = await this.servico.exigirPaciente(this.c(s), paciente);
    const modelo = modeloDoTipo(tipo === 'receita' ? 'receita' : tipo);
    const campos = camposDoDocumentoPep({
      modelo,
      identificacao: {
        paciente: pac.nomeSocial ?? pac.nome,
        prontuario: String(pac.prontuario),
        nascimento: pac.nascimento ? pac.nascimento.slice(0, 10) : null,
        atendimento: null,
        profissional: d.profissional ?? s.login,
        conselho: null,
        dataHora: (d.emitidoEm ?? '').slice(0, 16).replace('T', ' '),
      },
      corpo: d.paragrafos,
    });
    const marca = req.sghComo ? marcaSuporteTecnico(req.sghComo.alvoNome) : null;
    // 01-ADM L82: toda impressão do prontuário diz por quê (1ª via: justificativa; nova via: motivo). A 1ª via vem
    // do registro das emissões (vale depois de reiniciar a API e entre instâncias), nunca de estado do processo.
    const pedido = validar(esquemaImprimirDocumentoProntuario, corpo ?? {});
    const original = await fonte.emissao
      .originalDaOrigem(s.hospital, modelo, { tipo, idLegado: id })
      .catch(() => null);
    const anterior = original?.id ?? null;
    // 01-ADM L79: um só caminho de motivo. A nova via leva o motivo do catálogo de reimpressão (e o complemento
    // quando o motivo pede), conferido pela regra do domínio antes de emitir, e entra no registro de reimpressões.
    if (anterior) {
      const motivo =
        pedido.motivoReimpressao === undefined
          ? null
          : await this.servico.porta.motivoReimpressao(this.c(s), pedido.motivoReimpressao);
      const plano = planoNovaViaProntuario({
        viasAnteriores: original?.via ?? 1,
        motivoInformado: pedido.motivoReimpressao !== undefined,
        motivo,
        complemento: pedido.complemento ?? null,
      });
      if ('recusa' in plano)
        throw new ErroProblema(
          'entrada-invalida',
          400,
          'Motivo da reimpressão',
          MENSAGEM_NOVA_VIA[plano.recusa],
          {
            campos: [plano.recusa === 'complemento-obrigatorio' ? 'complemento' : 'motivoReimpressao'],
            codigo: plano.recusa,
          },
        );
      // A via é registrada ANTES de emitir (motivo, complemento, via, evento e registro único na mesma transação):
      // se a gravação recusar (motivo desativado no meio, documento sumido, disputa de versão, banco fora), nenhum
      // PDF sai e nenhuma via da emissão é gasta. Nunca existe via emitida sem a linha em registro_reimpressao.
      const proprio = await this.servico.porta.documentoSghDaOrigem(this.c(s), TABELA_DO_TIPO[tipo], id);
      const g = await this.gravarSgh(() =>
        this.servico.porta.registrarNovaVia(this.sgh(s, 'pep.documento.impresso'), {
          documento: proprio?.id ?? null,
          origem: { tabela: TABELA_DO_TIPO[tipo], id },
          motivo: pedido.motivoReimpressao!,
          complemento: pedido.complemento ?? null,
          viaMinima: (original?.via ?? 1) + 1,
        }),
      );
      let via: { emissao: { via: number }; pdf: Uint8Array };
      try {
        via = await fonte.emissao.segundaVia(anterior, g.texto, {
          titulo: TITULOS_PEP[modelo],
          campos,
          autor: s.login,
          marcaSuporte: marca,
        });
      } catch {
        // O pedido fica no registro, marcado como não emitido (nunca apagado).
        await this.servico.porta
          .fecharNovaVia(this.sgh(s, 'pep.documento.impresso'), g.registro, {
            emitida: false,
            viaEmitida: null,
          })
          .catch(() => undefined);
        throw new ErroProblema(
          'indisponivel',
          503,
          'Emissão indisponível',
          'Não foi possível gerar o PDF agora. O documento continua gravado no prontuário e o pedido de reimpressão ficou registrado como não emitido.',
        );
      }
      // Fecha o registro com a via que o PDF levou (o registro já existe; uma falha aqui não desfaz a via).
      await this.servico.porta
        .fecharNovaVia(this.sgh(s, 'pep.documento.impresso'), g.registro, {
          emitida: true,
          viaEmitida: via.emissao.via,
        })
        .catch(() => undefined);
      req.sghAlvo = {
        paciente,
        tabelaAlvo: TABELA_DO_TIPO[tipo],
        idAlvo: String(id),
        chaveNaturalAlvo: `impresso:${tipo};via:${via.emissao.via};motivo:catalogo;registro:${g.registro}`,
      };
      res.header('content-disposition', `inline; filename="${tipo}-${id}-via${via.emissao.via}.pdf"`);
      return Buffer.from(via.pdf);
    }
    const just = regraJustificativaImpressao({
      viaAnterior: false,
      justificativa: pedido.justificativa ?? null,
      motivo: null,
    });
    if (!just.ok)
      throw new ErroProblema('entrada-invalida', 400, 'Justificativa obrigatória', just.mensagem, {
        campos: ['justificativa'],
        codigo: just.codigo,
      });
    try {
      // A justificativa da 1ª via fica na própria emissão, haja ou não espelho no prontuário.
      const r = await fonte.emissao.emitir({
        rede: s.rede,
        estabelecimento: s.hospital,
        modelo,
        versaoModelo: '1',
        titulo: TITULOS_PEP[modelo],
        origem: { tipo, idLegado: id },
        campos,
        autor: s.login,
        marcaSuporte: marca,
        justificativa: just.justificativa,
      });
      // Com espelho no prontuário, também o evento do documento (tipo, justificativa, quem, quando), nunca apagado.
      const proprio = await this.servico.porta.documentoSghDaOrigem(this.c(s), TABELA_DO_TIPO[tipo], id);
      if (proprio)
        await this.servico.porta.registrarEventoDocumento(this.sgh(s, 'pep.documento.impresso'), {
          documento: proprio.id,
          tipo: just.tipo,
          justificativa: just.justificativa,
        });
      req.sghAlvo = {
        paciente,
        tabelaAlvo: TABELA_DO_TIPO[tipo],
        idAlvo: String(id),
        chaveNaturalAlvo: `impresso:${tipo};via:${r.emissao.via};justificativa:emissao${proprio ? '+evento' : ''}`,
      };
      res.header('content-disposition', `inline; filename="${tipo}-${id}-via${r.emissao.via}.pdf"`);
      return Buffer.from(r.pdf);
    } catch (x) {
      if (x instanceof ErroProblema) throw x;
      throw new ErroProblema(
        'indisponivel',
        503,
        'Emissão indisponível',
        'Não foi possível gerar o PDF agora. O documento continua gravado no prontuário.',
      );
    }
  }

  @Post('paciente/:p/exportar')
  @HttpCode(200)
  @Permissao('pep.prontuario.exportar')
  @Auditar('pep.prontuario.exportado')
  @Header('content-type', 'text/plain; charset=utf-8')
  async exportar(
    @Param('p') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: { header(n: string, v: string): unknown },
  ): Promise<string> {
    const s = sessaoDe(req);
    const e = validar(esquemaExportarProntuario, corpo);
    await this.reautenticado(req, e.senha);
    const paciente = await this.paciente(s, p, 'pep.prontuario.exportar', true);
    const pac = await this.servico.exigirPaciente(this.c(s), paciente);
    const linhas: string[] = [
      `Prontuário de ${pac.nomeSocial ?? pac.nome} (prontuário ${pac.prontuario})`,
      '',
    ];
    let pagina = 1;
    for (;;) {
      const t = await this.servico.linhaTempo(
        this.c(s),
        paciente,
        { pagina, de: '1900-01-01' },
        await this.prof(s),
      );
      for (const ev of t.eventos)
        linhas.push(
          `${ev.quando.slice(0, 16).replace('T', ' ')}  ${ev.titulo}${ev.detalhe ? ` - ${ev.detalhe}` : ''}${ev.profissional ? ` (${ev.profissional})` : ''}`,
        );
      if (!t.temMais || pagina >= 20) break;
      pagina++;
    }
    const texto = linhas.join('\r\n');
    // 01-ADM L82: a exportação só sai depois de gravada com a justificativa (texto e tipo) e o resumo do conteúdo.
    const reg = await this.servico.porta.registrarExportacaoProntuario(
      this.sgh(s, 'pep.prontuario.exportado'),
      {
        paciente,
        justificativa: e.justificativa,
        tipoJustificativa: e.tipoJustificativa ?? null,
        linhas: linhas.length,
        hash: createHash('sha256').update(texto, 'utf8').digest('hex'),
      },
    );
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'exportacao_documento',
      idAlvo: String(reg.id),
      chaveNaturalAlvo: `exportado;linhas:${linhas.length};justificativa:${e.tipoJustificativa ?? 'texto'}`,
    };
    res.header('content-disposition', `attachment; filename="prontuario-${paciente}.txt"`);
    return texto;
  }

  // ── Alergias ─────────────────────────────────────────────────────────────────────────────────────

  @Get('paciente/:p/alergias')
  @Permissao('pep.alergia.ler')
  @Auditar('pep.cabecalho.lido')
  async alergias(@Param('p') p: string, @Req() req: RequisicaoAutorizada): Promise<AlergiasPaciente> {
    const s = sessaoDe(req);
    const paciente = await this.paciente(s, p, 'pep.alergia.ler', true);
    const [criar, inativar] = await Promise.all([
      this.acao(s, 'pep.alergia.criar', RECURSOS_M23.alergia, 'pep.registrarAlergia'),
      this.acao(s, 'pep.alergia.inativar', RECURSOS_M23.alergia, 'pep.inativarAlergia'),
    ]);
    const r = await this.servico.alergias(this.c(s), paciente, await this.prof(s), { criar, inativar });
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'alergia_paciente',
      chaveNaturalAlvo: `parte:alergias;n:${r.ativas.length}`,
    };
    return r;
  }

  @Get('paciente/:p/alergias/:id/historico')
  @Permissao('pep.alergia.ler')
  @Auditar('pep.cabecalho.lido')
  async historicoAlergia(
    @Param('p') p: string,
    @Param('id') i: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<HistoricoAlergia> {
    const s = sessaoDe(req);
    const paciente = await this.paciente(s, p, 'pep.alergia.ler', true);
    const alergia = idDaRota(i);
    const r = await this.servico.historicoAlergia(this.c(s), paciente, alergia);
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'alergia_paciente',
      chaveNaturalAlvo: `parte:alergia-historico;id:${alergia};n:${r.passos.length}`,
    };
    return r;
  }

  @Post('paciente/:p/alergias')
  @HttpCode(201)
  @Permissao('pep.alergia.criar')
  @AuditadoNoHandler(
    'pep.registrarAlergia: trilha, SGH_PEP_ALERGIA e SGH_PEP_DOCUMENTO na mesma transação (executor)',
  )
  async registrarAlergia(@Param('p') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.alergia);
    const e = validar(esquemaRegistrarAlergia, corpo);
    const paciente = await this.paciente(s, p, 'pep.alergia.criar', false);
    const prof = this.servico.exigirProfissional(await this.prof(s));
    const entrada = await this.servico.montarAlergia(this.c(s), paciente, e, prof, {
      comoSuporte: req.sghComo !== undefined,
    });
    const r = await this.executar(s, 'pep.registrarAlergia', entrada, 'alergia');
    return { alergia: Number(r['alergia'] ?? 0), documento: Number(r['documento'] ?? 0) };
  }

  @Post('paciente/:p/alergias/:id/inativar')
  @HttpCode(200)
  @Permissao('pep.alergia.inativar')
  @AuditadoNoHandler('pep.inativarAlergia: trilha e SGH_PEP_ALERGIA na mesma transação (executor)')
  async inativarAlergia(
    @Param('p') p: string,
    @Param('id') i: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.alergia);
    const e = validar(esquemaInativarAlergia, corpo);
    const paciente = await this.paciente(s, p, 'pep.alergia.inativar', false);
    await this.executar(
      s,
      'pep.inativarAlergia',
      { paciente, alergia: idDaRota(i), motivo: e.motivo, versao: e.versao },
      'alergia',
    );
    return { ok: true };
  }

  /** Reativação da alergia retirada por engano (motivo); quem pode retirar pode reativar. */
  @Post('paciente/:p/alergias/:id/reativar')
  @HttpCode(200)
  @Permissao('pep.alergia.inativar')
  @AuditadoNoHandler(
    'pep.reativarAlergia: trilha, alergia_paciente e alergia_paciente_evento na mesma transação (executor)',
  )
  async reativarAlergia(
    @Param('p') p: string,
    @Param('id') i: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.alergia);
    const e = validar(esquemaReativarAlergia, corpo);
    const paciente = await this.paciente(s, p, 'pep.alergia.inativar', false);
    await this.executar(
      s,
      'pep.reativarAlergia',
      { paciente, alergia: idDaRota(i), motivo: e.motivo, versao: e.versao },
      'alergia',
    );
    return { ok: true };
  }

  /** Alteração da alergia ativa (gravidade, reação, origem, observação, manifestações); quem registra altera. */
  @Post('paciente/:p/alergias/:id/alterar')
  @HttpCode(200)
  @Permissao('pep.alergia.criar')
  @AuditadoNoHandler(
    'pep.alterarAlergia: trilha, alergia_paciente, manifestações e alergia_paciente_evento na mesma transação (executor)',
  )
  async alterarAlergia(
    @Param('p') p: string,
    @Param('id') i: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.alergia);
    const e = validar(esquemaAlterarAlergia, corpo);
    const paciente = await this.paciente(s, p, 'pep.alergia.criar', false);
    await this.executar(
      s,
      'pep.alterarAlergia',
      {
        paciente,
        alergia: idDaRota(i),
        gravidade: e.gravidade,
        reacao: e.reacao,
        origem: e.origem,
        observacao: e.observacao,
        manifestacoes: e.manifestacoes,
        ...(e.motivo?.trim() ? { motivo: e.motivo.trim() } : {}),
        versao: e.versao,
      },
      'alergia',
    );
    return { ok: true };
  }

  // ── Problemas ────────────────────────────────────────────────────────────────────────────────────

  @Get('paciente/:p/problemas')
  @Permissao('pep.problema.ler')
  @Auditar('pep.cabecalho.lido')
  async problemas(
    @Param('p') p: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ problemas: ProblemaPep[]; criar: AcaoLiberada }> {
    const s = sessaoDe(req);
    const paciente = await this.paciente(s, p, 'pep.problema.ler', true);
    const [problemas, criar] = await Promise.all([
      this.servico.problemas(this.c(s), paciente),
      this.acao(s, 'pep.problema.criar', RECURSOS_M23.problema, null),
    ]);
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'SGH_PEP_PROBLEMA',
      chaveNaturalAlvo: `parte:problemas;n:${problemas.length}`,
    };
    return { problemas, criar };
  }

  @Post('paciente/:p/problemas')
  @HttpCode(201)
  @Permissao('pep.problema.criar')
  @AuditadoNoHandler('SGH_PEP_PROBLEMA e SGH_TRILHA na mesma transação SGH_')
  async incluirProblema(@Param('p') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.problema);
    const e = validar(esquemaGravarProblema, corpo);
    const paciente = await this.paciente(s, p, 'pep.problema.criar', false);
    const id = await this.gravarSgh(() => this.servico.incluirProblema(this.sgh(s, 'problema'), paciente, e));
    return { problema: id };
  }

  @Post('paciente/:p/problemas/:id/situacao')
  @HttpCode(200)
  @Permissao('pep.problema.criar')
  @AuditadoNoHandler('SGH_PEP_PROBLEMA (nova versão) e SGH_TRILHA na mesma transação SGH_')
  async situacaoProblema(
    @Param('p') p: string,
    @Param('id') i: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.problema);
    const e = validar(esquemaSituacaoProblema, corpo);
    const paciente = await this.paciente(s, p, 'pep.problema.criar', false);
    const id = await this.gravarSgh(() =>
      this.servico.mudarProblema(this.sgh(s, 'problema'), paciente, idDaRota(i), e),
    );
    return { problema: id };
  }

  // ── Exames e resultados ──────────────────────────────────────────────────────────────────────────

  @Get('paciente/:p/exames')
  @Permissao('pep.pedidoExame.ler')
  @Auditar('pep.resultado.lido')
  async exames(
    @Param('p') p: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PedidosExame> {
    const s = sessaoDe(req);
    const paciente = await this.paciente(s, p, 'pep.pedidoExame.ler', true);
    const termo =
      typeof q['termo'] === 'string' && q['termo'].trim().length >= 2 ? q['termo'].trim().slice(0, 60) : null;
    const criar = await this.acao(s, 'pep.pedidoExame.criar', RECURSOS_M23.exame, 'pep.solicitarExame');
    const r = await this.servico.pedidos(this.c(s), paciente, termo, criar);
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'exame_item',
      chaveNaturalAlvo: `parte:pedidos;n:${r.pedidos.length}`,
    };
    return r;
  }

  @Post('paciente/:p/exames')
  @HttpCode(201)
  @Permissao('pep.pedidoExame.criar')
  @AuditadoNoHandler('pep.solicitarExame: trilha dupla e SGH_PEP_DOCUMENTO na mesma transação (executor)')
  async solicitar(
    @Param('p') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSolicitacao> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.exame);
    const e = validar(esquemaSolicitarExames, corpo);
    const paciente = await this.paciente(s, p, 'pep.pedidoExame.criar', false);
    const prof = this.servico.exigirProfissional(await this.prof(s));
    const m = await this.servico.montarPedido(this.c(s), paciente, e, prof, {
      comoSuporte: req.sghComo !== undefined,
    });
    if (!m.entrada) return { gravado: false, pedido: null, avisos: m.avisos };
    const r = await this.executar(s, 'pep.solicitarExame', m.entrada, 'exames');
    return { gravado: true, pedido: Number(r['agrupamento'] ?? 0), avisos: m.avisos };
  }

  @Get('paciente/:p/resultados')
  @Permissao('pep.resultado.ler')
  @Auditar('pep.resultado.lido')
  async resultados(@Param('p') p: string, @Req() req: RequisicaoAutorizada): Promise<ResultadosPaciente> {
    const s = sessaoDe(req);
    const paciente = await this.paciente(s, p, 'pep.resultado.ler', true);
    const [ciencia, externo] = await Promise.all([
      this.acao(s, 'pep.resultado.darCiencia', RECURSOS_M23.ciencia, null),
      this.acao(s, 'pep.resultado.lancarExterno', RECURSOS_M23.documentos, 'pep.lancarExameExterno'),
    ]);
    const r = await this.servico.resultados(this.c(s), paciente, { ciencia, externo });
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'resultado_exame',
      chaveNaturalAlvo: `parte:resultados;n:${r.resultados.length}`,
    };
    return r;
  }

  /** F3.3 (L128): resultados do paciente lado a lado pelo grupo comparativo ou pelo filtro salvo (o padrão ao abrir). */
  @Get('paciente/:p/resultados/comparativo')
  @Permissao('pep.resultado.ler')
  @Auditar('pep.resultado.lido')
  async resultadosComparativo(
    @Param('p') p: string,
    @Req() req: RequisicaoAutorizada,
    @Query('grupo') grupo?: string,
    @Query('filtro') filtro?: string,
    @Query('atendimento') atendimento?: string,
    @Query('dias') dias?: string,
  ) {
    if (!this.gruposResultado)
      throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    const paciente = await this.paciente(s, p, 'pep.resultado.ler', true);
    const n = (v: string | undefined) => (v && /^\d{1,12}$/.test(v) && Number(v) > 0 ? Number(v) : null);
    const r = await this.gruposResultado
      .comparativo(this.c(s), paciente, {
        grupo: n(grupo),
        filtro: n(filtro),
        atendimento: n(atendimento),
        dias: n(dias) !== null ? Math.min(n(dias)!, 3650) : null,
      })
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'resultado_exame',
      chaveNaturalAlvo: `parte:resultados-comparativo;n:${r.linhas.length}`,
    };
    return r;
  }

  /**
   * M47 (etapa 3; ficha, regra 8): os estudos de imagem do paciente com o status na modalidade e o link do visualizador
   * (estudo concluído e o endereço configurado). O mesmo acesso dos resultados: o vínculo e a leitura registrada.
   */
  @Get('paciente/:p/imagens')
  @Permissao('pep.resultado.ler')
  @Auditar(EVENTOS_AUDITAVEIS.estudosLidos.codigo)
  async imagensDoPaciente(
    @Param('p') p: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EstudosDoPaciente> {
    const s = sessaoDe(req);
    const paciente = await this.paciente(s, p, 'pep.resultado.ler', true);
    const r = this.imagens
      ? await this.imagens.estudosDoPaciente(s, paciente)
      : { estudos: [], visualizador: { nome: '', configurado: false } };
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'SGH_SADT_PACS_MWL',
      chaveNaturalAlvo: `parte:imagens;n:${r.estudos.length}`,
    };
    return r;
  }

  @Post('paciente/:p/resultados/externo')
  @HttpCode(201)
  @Permissao('pep.resultado.lancarExterno')
  @AuditadoNoHandler('pep.lancarExameExterno: trilha e SGH_PEP_DOCUMENTO na mesma transação (executor)')
  async exameExterno(
    @Param('p') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DocumentoGravado> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.documentos);
    const e = validar(esquemaExameExterno, corpo);
    const paciente = await this.paciente(s, p, 'pep.resultado.lancarExterno', false);
    const prof = this.servico.exigirProfissional(await this.prof(s));
    const entrada = await this.servico.montarExameExterno(this.c(s), paciente, e, prof, {
      comoSuporte: req.sghComo !== undefined,
    });
    const r = await this.executar(s, 'pep.lancarExameExterno', entrada, 'exame-externo');
    return this.servico.gravado(r, entrada.hashConteudo);
  }

  @Post('paciente/:p/resultados/:exame/ciencia')
  @HttpCode(201)
  @Permissao('pep.resultado.darCiencia')
  @AuditadoNoHandler('SGH_PEP_RESULT_CIENCIA e SGH_TRILHA na mesma transação SGH_')
  async ciencia(
    @Param('p') p: string,
    @Param('exame') x: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.ciencia);
    const e = validar(esquemaCienciaCritico, corpo);
    const paciente = await this.paciente(s, p, 'pep.resultado.darCiencia', false);
    const id = await this.gravarSgh(() =>
      this.servico.darCiencia(
        this.sgh(s, 'ciencia'),
        paciente,
        idDaRota(x),
        e.conduta,
        e.escalonarPara ?? null,
      ),
    );
    return { ciencia: id };
  }

  // ── Receitas e atestados ─────────────────────────────────────────────────────────────────────────

  private async listaDocumentos(req: RequisicaoAutorizada, p: string, familia: 'receita' | 'atestado') {
    const s = sessaoDe(req);
    const ler = familia === 'receita' ? 'pep.receita.ler' : 'pep.atestado.ler';
    const paciente = await this.paciente(s, p, ler, true);
    const prof = await this.prof(s);
    const [emitir0, suspender] = await Promise.all([
      this.acao(
        s,
        familia === 'receita' ? 'pep.receita.emitir' : 'pep.atestado.emitir',
        RECURSOS_M23.documentos,
        'pep.emitirDocumento',
      ),
      this.acao(
        s,
        familia === 'receita' ? 'pep.receita.suspender' : 'pep.atestado.suspender',
        RECURSOS_M23.documentos,
        'pep.suspenderDocumento',
      ),
    ]);
    const categoria = this.servico.decidir(
      prof,
      familia === 'receita' ? 'receita' : 'declaracao-comparecimento',
    );
    const emitir = emitir0.pode && !categoria.pode ? categoria : emitir0;
    const r = await this.servico.documentos(this.c(s), paciente, familia, { emitir, suspender });
    req.sghAlvo = {
      paciente,
      tabelaAlvo: familia === 'receita' ? 'receita_medica' : 'documento_emitido',
      chaveNaturalAlvo: `parte:${familia};n:${r.documentos.length}`,
    };
    return r;
  }

  @Get('paciente/:p/receitas')
  @Permissao('pep.receita.ler')
  @Auditar('pep.documento.lido')
  receitas(@Param('p') p: string, @Req() req: RequisicaoAutorizada): Promise<DocumentosPaciente> {
    return this.listaDocumentos(req, p, 'receita');
  }

  @Get('paciente/:p/atestados')
  @Permissao('pep.atestado.ler')
  @Auditar('pep.documento.lido')
  atestados(@Param('p') p: string, @Req() req: RequisicaoAutorizada): Promise<DocumentosPaciente> {
    return this.listaDocumentos(req, p, 'atestado');
  }

  @Post('paciente/:p/receitas')
  @HttpCode(201)
  @Permissao('pep.receita.emitir')
  @AuditadoNoHandler('pep.emitirDocumento: trilha dupla e SGH_PEP_DOCUMENTO na mesma transação (executor)')
  async emitirReceita(
    @Param('p') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DocumentoGravado> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.documentos);
    const e = validar(esquemaEmitirReceita, corpo);
    const paciente = await this.paciente(s, p, 'pep.receita.emitir', false);
    const prof = this.servico.exigirProfissional(await this.prof(s));
    const entrada = await this.servico.montarReceita(this.c(s), paciente, e, prof, {
      comoSuporte: req.sghComo !== undefined,
    });
    const r = await this.executar(s, 'pep.emitirDocumento', entrada, 'receita');
    return { ...this.servico.gravado(r, entrada.hashConteudo), pdf: true };
  }

  @Post('paciente/:p/atestados')
  @HttpCode(201)
  @Permissao('pep.atestado.emitir')
  @AuditadoNoHandler('pep.emitirDocumento: trilha dupla e SGH_PEP_DOCUMENTO na mesma transação (executor)')
  async emitirAtestado(
    @Param('p') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DocumentoGravado> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.documentos);
    const e = validar(esquemaEmitirAtestado, corpo);
    const paciente = await this.paciente(s, p, 'pep.atestado.emitir', false);
    const prof = this.servico.exigirProfissional(await this.prof(s));
    const entrada = await this.servico.montarAtestado(this.c(s), paciente, e, prof, {
      comoSuporte: req.sghComo !== undefined,
    });
    const r = await this.executar(s, 'pep.emitirDocumento', entrada, 'atestado');
    return { ...this.servico.gravado(r, entrada.hashConteudo), pdf: true };
  }

  private async suspender(
    req: RequisicaoAutorizada,
    p: string,
    i: string,
    corpo: unknown,
    familia: 'receita' | 'atestado',
  ) {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.documentos);
    const e = validar(esquemaSuspenderDocumento, corpo);
    const paciente = await this.paciente(
      s,
      p,
      familia === 'receita' ? 'pep.receita.suspender' : 'pep.atestado.suspender',
      false,
    );
    const reautenticadoEm = await this.reautenticado(req, e.senha);
    const prof = this.servico.exigirProfissional(await this.prof(s));
    const entrada = await this.servico.montarSuspensao(
      this.c(s),
      paciente,
      familia,
      idDaRota(i),
      e.justificativa,
      prof,
    );
    await this.executar(s, 'pep.suspenderDocumento', entrada, 'suspensao', { reautenticadoEm });
    return { ok: true as const };
  }

  @Post('paciente/:p/receitas/:id/suspender')
  @HttpCode(200)
  @Permissao('pep.receita.suspender')
  @AuditadoNoHandler(
    'pep.suspenderDocumento: trilha dupla e SGH_PEP_DOCUMENTO_EVENTO na mesma transação (executor)',
  )
  suspenderReceita(
    @Param('p') p: string,
    @Param('id') i: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.suspender(req, p, i, corpo, 'receita');
  }

  @Post('paciente/:p/atestados/:id/suspender')
  @HttpCode(200)
  @Permissao('pep.atestado.suspender')
  @AuditadoNoHandler(
    'pep.suspenderDocumento: trilha dupla e SGH_PEP_DOCUMENTO_EVENTO na mesma transação (executor)',
  )
  suspenderAtestado(
    @Param('p') p: string,
    @Param('id') i: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.suspender(req, p, i, corpo, 'atestado');
  }

  // ── TCLE ─────────────────────────────────────────────────────────────────────────────────────────

  @Get('paciente/:p/tcle')
  @Permissao('pep.tcle.ler')
  @Auditar('pep.documento.lido')
  async tcle(@Param('p') p: string, @Req() req: RequisicaoAutorizada): Promise<TclesPaciente> {
    const s = sessaoDe(req);
    const paciente = await this.paciente(s, p, 'pep.tcle.ler', true);
    const emitir = await this.acao(s, 'pep.tcle.emitir', RECURSOS_M23.documentos, null);
    const r = await this.servico.tcles(this.c(s), paciente, emitir);
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'SGH_PEP_TCLE',
      chaveNaturalAlvo: `parte:tcle;n:${r.termos.length}`,
    };
    return r;
  }

  @Post('paciente/:p/tcle')
  @HttpCode(201)
  @Permissao('pep.tcle.emitir')
  @AuditadoNoHandler('SGH_PEP_TCLE, SGH_PEP_DOCUMENTO e SGH_TRILHA na mesma transação SGH_')
  async emitirTcle(@Param('p') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.documentos);
    const e = validar(esquemaEmitirTcle, corpo);
    const paciente = await this.paciente(s, p, 'pep.tcle.emitir', false);
    const prof = this.servico.exigirProfissional(await this.prof(s));
    return this.gravarSgh(() =>
      this.servico.emitirTcle(this.sgh(s, 'tcle'), paciente, e, prof, req.sghComo !== undefined),
    );
  }

  @Post('paciente/:p/tcle/:id/situacao')
  @HttpCode(200)
  @Permissao('pep.tcle.emitir')
  @AuditadoNoHandler('SGH_PEP_TCLE (nova versão) e SGH_TRILHA na mesma transação SGH_')
  async situacaoTcle(
    @Param('p') p: string,
    @Param('id') i: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.documentos);
    const e = validar(esquemaSituacaoTcle, corpo);
    const paciente = await this.paciente(s, p, 'pep.tcle.emitir', false);
    if (e.versao !== idDaRota(i))
      throw new ErroProblema('conflito-de-versao', 409, 'O termo mudou', 'Releia o termo.', {
        codigo: 'conflito-versao',
      });
    const id = await this.gravarSgh(() =>
      this.servico.porta.mudarSituacaoTcle(this.sgh(s, 'tcle'), {
        paciente,
        versao: e.versao,
        situacao: e.situacao,
        motivo: e.motivo ?? null,
      }),
    );
    return { tcle: id };
  }

  // ── Alta, transferência e óbito ──────────────────────────────────────────────────────────────────

  @Get('paciente/:p/alta')
  @Permissao('pep.sumarioAlta.ler')
  @PermissaoOu('pep.declaracaoObito.cancelarOutro')
  @Auditar('pep.documento.lido')
  async alta(
    @Param('p') p: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AltaPaciente> {
    const s = sessaoDe(req);
    const paciente = await this.paciente(
      s,
      p,
      permissaoDaSessao(req, 'pep.sumarioAlta.ler', CANCELAR_OBITO_DE_OUTRO),
      true,
    );
    const prof = await this.prof(s);
    const [finalizar0, obito0] = await Promise.all([
      this.acao(s, 'pep.sumarioAlta.finalizar', RECURSOS_M23.documentos, 'pep.finalizarSumarioAlta'),
      this.acao(s, 'pep.declaracaoObito.emitir', RECURSOS_M23.documentos, null),
    ]);
    const catSum = this.servico.decidir(prof, 'sumario-alta');
    const catObito = this.servico.decidir(prof, 'declaracao-obito');
    const portaSecoes = this.secoesSumario;
    const r = await this.servico.alta(
      this.c(s),
      paciente,
      q['atendimento'] ? idDaRota(q['atendimento']) : null,
      {
        finalizar: finalizar0.pode && !catSum.pode ? catSum : finalizar0,
        obito: obito0.pode && !catObito.pode ? catObito : obito0,
        // 04-INT L74: quem pode cancelar a declaração, sabido antes do motivo (emissor ou responsável técnico).
        login: s.login,
        cancelarDeOutro: podeCancelarObitoDeOutro(req),
      },
      // F3.3 (L124): a janela de cada seção configurada recorta o episódio que monta o sumário.
      portaSecoes ? (atd: number) => portaSecoes.vigentesDoAtendimento(this.c(s), atd, paciente) : null,
    );
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'SGH_PEP_SUMARIO_ALTA',
      chaveNaturalAlvo: `parte:alta;versoes:${r.versoes.length}`,
    };
    return r;
  }

  @Post('paciente/:p/alta/rascunho')
  @HttpCode(200)
  @Permissao('pep.sumarioAlta.finalizar')
  @AuditadoNoHandler('SGH_PEP_SUMARIO_ALTA (versão) e SGH_TRILHA na mesma transação SGH_')
  async rascunhoSumario(@Param('p') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.documentos);
    const e = validar(esquemaSalvarSumario, corpo);
    const paciente = await this.paciente(s, p, 'pep.sumarioAlta.finalizar', false);
    const versao = await this.gravarSgh(() =>
      this.servico.salvarRascunhoSumario(this.sgh(s, 'sumario'), paciente, e),
    );
    return { versao };
  }

  @Post('paciente/:p/alta/finalizar')
  @HttpCode(201)
  @Permissao('pep.sumarioAlta.finalizar')
  @AuditadoNoHandler(
    'pep.finalizarSumarioAlta: trilha, SGH_PEP_SUMARIO_ALTA e SGH_PEP_DOCUMENTO na mesma transação (executor)',
  )
  async finalizarSumario(
    @Param('p') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DocumentoGravado> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.documentos);
    const e = validar(esquemaSalvarSumario, corpo);
    const paciente = await this.paciente(s, p, 'pep.sumarioAlta.finalizar', false);
    const prof = this.servico.exigirProfissional(await this.prof(s));
    // F3.3 (L124): as seções configuradas do atendimento (já conferido no serviço) decidem as obrigatórias e o texto.
    const porta = this.secoesSumario;
    const secoes = porta ? (atd: number) => porta.vigentesDoAtendimento(this.c(s), atd, paciente) : null;
    const entrada = await this.servico.montarFinalizacao(
      this.c(s),
      paciente,
      e,
      prof,
      s.login,
      { comoSuporte: req.sghComo !== undefined },
      secoes,
    );
    const r = await this.executar(s, 'pep.finalizarSumarioAlta', entrada, 'sumario');
    return { ...this.servico.gravado(r, entrada.hashConteudo), pdf: true };
  }

  @Post('paciente/:p/alta/transferencia')
  @HttpCode(201)
  @Permissao('pep.sumarioAlta.finalizar')
  @AuditadoNoHandler('SGH_PEP_REL_TRANSF, SGH_PEP_DOCUMENTO e SGH_TRILHA na mesma transação SGH_')
  async transferencia(@Param('p') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.documentos);
    const e = validar(esquemaRelatorioTransferencia, corpo);
    const paciente = await this.paciente(s, p, 'pep.sumarioAlta.finalizar', false);
    const prof = this.servico.exigirProfissional(await this.prof(s));
    return this.gravarSgh(() =>
      this.servico.transferencia(this.sgh(s, 'transferencia'), paciente, e, prof, req.sghComo !== undefined),
    );
  }

  @Post('paciente/:p/alta/obito')
  @HttpCode(201)
  @Permissao('pep.declaracaoObito.emitir')
  @AuditadoNoHandler('SGH_PEP_OBITO, SGH_PEP_DOCUMENTO e SGH_TRILHA na mesma transação SGH_ (crítica)')
  async obito(@Param('p') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.documentos);
    const e = validar(esquemaDeclaracaoObito, corpo);
    const paciente = await this.paciente(s, p, 'pep.declaracaoObito.emitir', false);
    await this.reautenticado(req, e.senha);
    const prof = this.servico.exigirProfissional(await this.prof(s));
    return this.gravarSgh(() =>
      this.servico.obito(this.sgh(s, 'obito'), paciente, e, prof, req.sghComo !== undefined),
    );
  }

  @Post('paciente/:p/alta/obito/cancelar')
  @HttpCode(200)
  @Permissao('pep.declaracaoObito.emitir')
  @PermissaoOu('pep.declaracaoObito.cancelarOutro')
  @AuditadoNoHandler('declaracao_obito e declaracao_obito_evento na mesma transação, com a trilha (crítica)')
  async cancelarObito(@Param('p') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.documentos);
    const e = validar(esquemaCancelamentoObito, corpo);
    const paciente = await this.paciente(
      s,
      p,
      permissaoDaSessao(req, 'pep.declaracaoObito.emitir', CANCELAR_OBITO_DE_OUTRO),
      false,
    );
    await this.reautenticado(req, e.senha);
    const prof = this.servico.exigirProfissional(await this.prof(s));
    // 04-INT L74 (CFM Res. 1.779/2005): o responsável técnico ou diretor clínico cancela a declaração de outro médico.
    const deOutro = podeCancelarObitoDeOutro(req);
    return this.gravarSgh(() => this.servico.cancelarObito(this.sgh(s, 'obito'), paciente, e, prof, deOutro));
  }

  // ── Anexos e tempos ──────────────────────────────────────────────────────────────────────────────

  @Get('paciente/:p/anexos')
  @Permissao('pep.anexo.ler')
  @Auditar('pep.documento.lido')
  async anexos(@Param('p') p: string, @Req() req: RequisicaoAutorizada): Promise<AnexosPaciente> {
    const s = sessaoDe(req);
    const paciente = await this.paciente(s, p, 'pep.anexo.ler', true);
    const criar = await this.acao(s, 'pep.anexo.criar', RECURSOS_M23.anexo, 'pep.anexarDocumento');
    const r = await this.servico.anexos(this.c(s), paciente, criar);
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'anexo_prontuario',
      chaveNaturalAlvo: `parte:anexos;n:${r.anexos.length}`,
    };
    return r;
  }

  @Get('paciente/:p/anexos/:id/arquivo')
  @Permissao('pep.anexo.ler')
  @Auditar('pep.documento.lido')
  @Header('content-type', 'application/pdf')
  async arquivo(
    @Param('p') p: string,
    @Param('id') i: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: { header(n: string, v: string): unknown },
  ): Promise<Buffer> {
    const s = sessaoDe(req);
    const paciente = await this.paciente(s, p, 'pep.anexo.ler', true);
    const id = idDaRota(i);
    const a = await this.servico.porta.arquivoAnexo(this.c(s), id);
    if (!a || a.paciente !== paciente) throw new ErroProblema('nao-encontrado', 404, 'Anexo não encontrado');
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'anexo_prontuario',
      idAlvo: String(id),
      chaveNaturalAlvo: 'documento:anexo',
    };
    res.header('content-disposition', `inline; filename="anexo-${id}.pdf"`);
    return a.pdf;
  }

  @Post('paciente/:p/anexos')
  @HttpCode(201)
  @Permissao('pep.anexo.criar')
  @AuditadoNoHandler('pep.anexarDocumento: trilha dupla e SGH_PEP_DOCUMENTO na mesma transação (executor)')
  async anexar(
    @Param('p') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DocumentoGravado> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.anexo);
    const e = validar(esquemaAnexarDocumento, corpo);
    const paciente = await this.paciente(s, p, 'pep.anexo.criar', false);
    const prof = this.servico.exigirProfissional(await this.prof(s));
    const entrada = await this.servico.montarAnexo(this.c(s), paciente, e, prof, estacaoDaRequisicao(req), {
      comoSuporte: req.sghComo !== undefined,
    });
    const r = await this.executar(s, 'pep.anexarDocumento', entrada, 'anexo');
    return this.servico.gravado(r, entrada.hashConteudo);
  }

  @Get('paciente/:p/tempos')
  @Permissao('pep.tempoEvento.ler')
  @Auditar('pep.documento.lido')
  async tempos(@Param('p') p: string, @Req() req: RequisicaoAutorizada): Promise<TempoEvento[]> {
    const s = sessaoDe(req);
    const paciente = await this.paciente(s, p, 'pep.tempoEvento.ler', true);
    const r = await this.servico.tempos(this.c(s), paciente);
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'registro_tempo_evento',
      chaveNaturalAlvo: `parte:tempos;n:${r.length}`,
    };
    return r;
  }

  // ── Parecer ──────────────────────────────────────────────────────────────────────────────────────

  @Get('interconsultas')
  @Permissao('pep.interconsulta.ler')
  @Auditar('pep.parecer.filaLida')
  async interconsultas(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<FilaPareceres> {
    const s = sessaoDe(req);
    const f = validar(esquemaFiltrosParecer, q);
    const [criar, responder] = await Promise.all([
      this.acao(s, 'pep.interconsulta.criar', RECURSOS_M23.parecer, null),
      this.acao(s, 'pep.interconsulta.responder', RECURSOS_M23.parecer, null),
    ]);
    const r = await this.servico.fila(this.c(s), f, { criar, responder });
    req.sghAlvo = { tabelaAlvo: 'SGH_PEP_FLUXO', chaveNaturalAlvo: `fila;n:${r.itens.length}` };
    return r;
  }

  @Post('interconsultas/:id/aceitar')
  @HttpCode(200)
  @Permissao('pep.interconsulta.responder')
  @AuditadoNoHandler('SGH_PEP_FLUXO e SGH_TRILHA na mesma transação SGH_')
  async aceitar(@Param('id') i: string, @Req() req: RequisicaoAutorizada): Promise<{ ok: true }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.parecer);
    const id = idDaRota(i);
    const f = await this.servico.porta.fluxo(this.c(s), id);
    if (!f) throw new ErroProblema('nao-encontrado', 404, 'Parecer não encontrado');
    await this.acesso.exigirVinculo(s, f.paciente, 'pep.interconsulta.responder', 'pep.prontuario');
    await this.gravarSgh(() => this.servico.porta.aceitarParecer(this.sgh(s, 'parecer'), id));
    return { ok: true };
  }

  @Post('interconsultas/:id/cancelar')
  @HttpCode(200)
  @Permissao('pep.interconsulta.criar')
  @AuditadoNoHandler('SGH_PEP_FLUXO e SGH_TRILHA na mesma transação SGH_')
  async cancelar(
    @Param('id') i: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.parecer);
    const e = validar(esquemaCancelarParecer, corpo);
    const id = idDaRota(i);
    const f = await this.servico.porta.fluxo(this.c(s), id);
    if (!f) throw new ErroProblema('nao-encontrado', 404, 'Parecer não encontrado');
    if (f.solicitante !== s.login)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Só quem pediu cancela',
        'O parecer é cancelado por quem o pediu.',
      );
    await this.gravarSgh(() => this.servico.porta.cancelarParecer(this.sgh(s, 'parecer'), id, e.motivo));
    return { ok: true };
  }

  // ── Assinaturas ──────────────────────────────────────────────────────────────────────────────────

  @Get('assinaturas')
  @Permissao('documento.documento.ler')
  @Auditar('documento.pendencias.lidas')
  async pendencias(
    @Req() req: RequisicaoAutorizada,
  ): Promise<PendenciasAssinatura & { assinar: AcaoLiberada; categoria: string | null }> {
    const s = sessaoDe(req);
    const [r, assinar, prof] = await Promise.all([
      this.servico.pendencias(this.c(s), s.login),
      this.acao(s, 'documento.documento.assinar', RECURSOS_M23.assinatura, null),
      this.prof(s),
    ]);
    req.sghAlvo = { tabelaAlvo: 'SGH_PEP_DOCUMENTO', chaveNaturalAlvo: `pendencias;n:${r.total}` };
    return { ...r, assinar, categoria: categoriaDe(prof) };
  }

  @Get('assinaturas/:id/previa')
  @Permissao('documento.documento.ler')
  @Auditar('pep.documento.lido')
  async previa(@Param('id') i: string, @Req() req: RequisicaoAutorizada): Promise<PreviaAssinatura> {
    const s = sessaoDe(req);
    const r = await this.servico.previa(this.c(s), idDaRota(i), s.login);
    req.sghAlvo = {
      tabelaAlvo: 'SGH_PEP_DOCUMENTO',
      idAlvo: String(r.documento),
      chaveNaturalAlvo: 'previa',
    };
    return r;
  }

  @Post('assinaturas')
  @HttpCode(200)
  @Permissao('documento.documento.assinar')
  @AuditadoNoHandler('SGH_PEP_DOCUMENTO_EVENTO (assinado) e SGH_TRILHA na mesma transação SGH_ (crítica)')
  async assinar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAssinatura> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.assinatura);
    const e = validar(esquemaAssinarLote, corpo);
    await this.reautenticado(req, e.senha);
    return this.gravarSgh(() =>
      this.servico.porta.assinar(
        this.sgh(s, 'assinatura'),
        e.documentos.map((documento, i) => ({ documento, hash: e.hashes[i]! })),
        req.sghComo !== undefined,
      ),
    );
  }

  // ── Preceptoria (regra 3) ─────────────────────────────────────────────────────────────────────────

  /**
   * O preceptor indicado coassina (ou recusa com o motivo) o registro do residente (03-PEP L96; CFM, supervisão da
   * residência). A decisão é gravada no próprio registro clínico (registro_assistencial_supervisao), na mesma
   * transação que finaliza o registro quando era o último pedido pendente.
   */
  @Post('supervisao/:id/coassinar')
  @HttpCode(200)
  @Permissao('pep.evolucao.coassinar')
  @AuditadoNoHandler('registro_assistencial_supervisao, registro_assistencial e a trilha na mesma transação')
  async coassinar(
    @Param('id') i: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, RECURSOS_M23.assinatura);
    const e = validar(esquemaCoassinar, corpo);
    const id = idDaRota(i);
    const sup = await this.servico.porta.supervisao(this.c(s), id);
    if (!sup) throw new ErroProblema('nao-encontrado', 404, 'Pedido de coassinatura não encontrado');
    if (sup.preceptor !== s.login)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Só o preceptor indicado',
        'Só o preceptor indicado pelo residente coassina este registro.',
      );
    await this.acesso.exigirVinculo(s, sup.paciente, 'pep.evolucao.coassinar', 'pep.prontuario');
    await this.gravarSgh(() =>
      this.servico.porta.coassinarNoNovo(
        this.sgh(s, 'coassinatura'),
        e.decisao === 'recusado'
          ? { id, decisao: 'recusado', motivo: e.motivo ?? null }
          : { id, decisao: 'coassinado' },
      ),
    );
    return { ok: true };
  }

  /** A trilha da gravação só do novo já sai na transação; o registrador fica para as negações. */
  get registrador(): RegistradorTrilha {
    return this.trilha;
  }
}
