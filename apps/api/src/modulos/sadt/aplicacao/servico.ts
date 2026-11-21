// Os fluxos do SADT (ficha do M26, seções 5 a 8) sobre a porta: recebimento, lançamento, digitação, liberação,
// retificação, coleta e rastreio da amostra, valor crítico, laudo (PDF/A com código e QR), orçamento e requisição. As
// regras de quem pode vêm do domínio e da sessão (o vínculo nunca vem da tela); as gravações vão pelo executor do
// núcleo (apoio do setor, com a liberação da funcionalidade) ou pelo gravador da porta, com a trilha na mesma transação.
// Melhoria: a trilha cita as tabelas do modelo próprio (amostra_biologica, aviso_valor_critico, emissao_laudo...); a
// emissão do laudo tem um caminho só (a 1ª e a 2ª via gravam a emissão com código, via, hash e exames), sem a
// gravação condicionada a uma conferência externa nem o aviso de conferência pendente.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  type AbrirRequisicaoEntrada,
  type AmostraDetalhe,
  type ColetaRegistrada,
  type ComunicarAvisoEntrada,
  type ConverterOrcamentoEntrada,
  type CriarOrcamentoEntrada,
  EVENTOS_AUDITAVEIS,
  type ExameSadt,
  type IndicadoresSadt,
  type LaudoEmitido,
  type MudarEstadoAmostraEntrada,
  type PainelCriticos,
  type ParametrosSadt,
  podeLaudar,
  type ReceberSolicitacaoEntrada,
  type ResultadoSadt,
  type SetorSadt,
  setorDoAto,
  type ValorCriticoEntrada,
} from '@sgh/contratos';
import { enfileirarZpl, ErroZpl } from '@sgh/dominio-documento';
import { etiquetaDaAmostra } from '../infra/etiqueta-amostra.js';
import {
  codigoDaAmostra,
  codigoDeAutenticacao,
  codigoProtocolo,
  conferirColeta,
  indicadoresCriticos,
  podeMudar,
  podeNoEstado,
  rotuloDaVia,
} from '@sgh/dominio-sadt';
import { createHash } from 'node:crypto';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../../autorizacao/estacao.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { FonteDocumento } from '../../documento/public-api.js';
import type { ContextoSadt, PortaSadt, VinculoDaSessao } from '../porta.js';
import type { ApoiosSadt } from './apoios.js';
import { avisarCriticoNaCentral, type CentralDeAvisos } from './central-critico.js';

const ctx = (s: SessaoCadastro): ContextoSadt => s.porta;
const recusa = (titulo: string, detalhe: string, codigo: string): never => {
  throw new ErroProblema('recusa-de-negocio', 409, titulo, detalhe, { codigo });
};
const naoEncontrado = (detalhe: string): never => {
  throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', detalhe);
};
const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');

/** Tabelas do modelo próprio citadas na trilha (entidade da linha de auditoria). */
export const TABELA_EXAME = 'exame_item';
export const TABELA_AMOSTRA = 'amostra_biologica';
export const TABELA_AVISO = 'aviso_valor_critico';
export const TABELA_VALOR_CRITICO = 'regra_valor_critico';
export const TABELA_PORTAL = 'acesso_resultado_portal';
export const TABELA_CONTA_MEDICO_PORTAL = 'conta_portal_profissional_externo';
export const TABELA_ORCAMENTO = 'orcamento_particular';
export const TABELA_LAUDO = 'emissao_laudo';

/** O resultado de uma gravação do executor para a tela (mensagem, repetida, ids e avisos). */
function resultado(
  r: { resultado: Record<string, unknown>; repetida: boolean; mensagem: string },
  avisos: string[] = [],
): ResultadoSadt {
  const ids: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(r.resultado))
    if (typeof v === 'number' || typeof v === 'string') ids[k] = v;
  return { mensagem: r.mensagem, repetida: r.repetida, ids, avisos };
}

export interface Notificador {
  /** Os painéis de valor crítico e as listas do setor releem (canal de eventos). */
  avisar(hospital: string): void;
}

/**
 * O carimbo que a tela leu vai como veio: nulo ou ausente não vira o carimbo atual (isso pularia a conferência
 * otimista); o gravador recusa com 409 quando um lado é nulo e o outro não.
 */
const versaoDaTela = (b: Record<string, unknown>): string | null =>
  typeof b['versao'] === 'string' ? b['versao'] : null;

export class ServicoSadt {
  constructor(
    private readonly porta: PortaSadt,
    private readonly apoios: ApoiosSadt,
    private readonly documento: FonteDocumento | null,
    private readonly notificador: Notificador | null,
    private readonly central: CentralDeAvisos | null = null,
  ) {}

  /** Depois do COMMIT: o aviso do valor crítico vai também à central de avisos do médico do atendimento. */
  private async criticoNaCentral(
    s: SessaoCadastro,
    e: ExameSadt,
    r: { resultado: Record<string, unknown> },
  ): Promise<void> {
    await avisarCriticoNaCentral(
      this.central,
      this.porta,
      ctx(s),
      {
        login: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, 'sadt.avisoCritico'),
      },
      {
        exame: e.id,
        liberacao: Number(r.resultado['liberacao']) || null,
        paciente: e.paciente.id,
        atendimento: Number(e.atendimento.cabecalho) || null,
      },
    );
  }

  private async vinculos(s: SessaoCadastro): Promise<VinculoDaSessao[]> {
    return this.porta.vinculos(ctx(s), s.login).catch(() => []);
  }

  private async exame(s: SessaoCadastro, id: number): Promise<ExameSadt> {
    const e = await this.porta.exame(ctx(s), id);
    return e ?? naoEncontrado('O exame não existe mais.');
  }

  private exigirEstado(e: ExameSadt, acao: Parameters<typeof podeNoEstado>[0]) {
    const p = podeNoEstado(acao, e.estado);
    if (!p.pode) recusa('Ação não permitida', p.motivo ?? 'O exame não está na situação.', `estado-${acao}`);
  }

  // ── Recebimento e lançamento ─────────────────────────────────────────────────────────────────────

  async receber(s: SessaoCadastro, e: ReceberSolicitacaoEntrada): Promise<ResultadoSadt> {
    const atos = new Set(e.exames.map((x) => x.chave.ato));
    if (atos.size !== 1)
      recusa('Setores diferentes', 'Receba os pedidos de um setor por vez.', 'atos-diferentes');
    const ato = [...atos][0]!;
    const r = await this.apoios
      .doAto(ato)
      .executar(
        s,
        'sadt.receberSolicitacao',
        e,
        e.exames.length === 1
          ? 'Pedido recebido no setor.'
          : `${e.exames.length} pedidos recebidos no setor.`,
      );
    this.notificador?.avisar(s.hospital);
    return resultado(r);
  }

  /** O lançamento no setor: os retratos vigentes do atendimento e o intervalo de repetição do parâmetro. */
  async lancar(s: SessaoCadastro, bruto: Record<string, unknown>): Promise<ResultadoSadt> {
    const atendimento = Number(bruto['atendimento']);
    const a = Number.isSafeInteger(atendimento) ? await this.porta.atendimento(ctx(s), atendimento) : null;
    if (!a) return naoEncontrado('O atendimento não existe.');
    if (!a.conta)
      recusa(
        'Requisição não aberta',
        'O atendimento ainda não tem a requisição de exames aberta: abra a requisição antes de lançar.',
        'sem-conta-de-exames',
      );
    if (!a.retratos)
      recusa('Atendimento incompleto', 'O atendimento não tem o retrato vigente do paciente.', 'sem-retrato');
    const ato = Number(bruto['ato']);
    const apoio = this.apoios.doAto(ato);
    const repeticao = await apoio.parametro(s, 'sadt.repeticaoMinimaHoras');
    const entrada = {
      ...bruto,
      atend: a.atend,
      retratos: a.retratos,
      repeticaoMinimaHoras: repeticao || 24,
    };
    const r = await apoio.executar(s, 'sadt.lancarExame', entrada, 'Exames lançados no setor.');
    this.notificador?.avisar(s.hospital);
    return resultado(r);
  }

  // ── Digitação, liberação e retificação ───────────────────────────────────────────────────────────

  async digitar(s: SessaoCadastro, id: number, bruto: Record<string, unknown>): Promise<ResultadoSadt> {
    const e = await this.exame(s, id);
    this.exigirEstado(e, bruto['laudo'] ? 'laudar' : 'digitar');
    const entrada: Record<string, unknown> = {
      ...bruto,
      exame: { id: e.id, chave: e.chave, versao: versaoDaTela(bruto) },
    };
    delete entrada['versao'];
    delete entrada['emissor'];
    if (bruto['laudo']) {
      // O laudador é o médico da sessão (regra 8): nunca o que a tela mandar.
      const vs = await this.vinculos(s);
      const medico = vs.find((v) => podeLaudar(e.ato, { cbo: v.codigoCbo, conselhoAtivo: v.ativo }).pode);
      if (!medico)
        throw new ErroProblema(
          'sem-permissao',
          403,
          'Laudo privativo de médico',
          'O laudo deste exame é privativo de médico (Lei 12.842/2013): a sessão não tem vínculo de médico ativo.',
          { codigo: 'laudo-privativo-de-medico' },
        );
      entrada['emissor'] = medico.vinculo;
    }
    const r = await this.apoios
      .doAto(e.ato)
      .executar(
        s,
        bruto['laudo'] ? 'sadt.registrarLaudo' : 'sadt.registrarResultado',
        entrada,
        bruto['laudo'] ? 'Laudo gravado.' : 'Resultado digitado.',
      );
    this.notificador?.avisar(s.hospital);
    return resultado(r);
  }

  /** A liberação de um exame pelo responsável habilitado da sessão; o aviso crítico sai na mesma transação. */
  async liberar(
    s: SessaoCadastro,
    id: number,
    b: { versao: string | null; confirmarCritico: boolean },
  ): Promise<ResultadoSadt> {
    const e = await this.exame(s, id);
    this.exigirEstado(e, 'liberar');
    const h = this.apoios.habilitado(await this.vinculos(s), e.ato);
    if (!h.vinculo)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem habilitação',
        h.motivo ?? 'A sessão não é habilitada para liberar.',
        {
          codigo: 'sem-habilitacao',
        },
      );
    const conf = await this.porta.conferencia(ctx(s), id);
    if (conf?.critico && !b.confirmarCritico)
      recusa(
        'Valor crítico',
        'O resultado tem valor crítico: confirme que viu o valor para liberar (o aviso sai ao responsável).',
        'confirmar-critico',
      );
    const r = await this.apoios.doAto(e.ato).executar(
      s,
      'sadt.liberarExame',
      {
        exames: [{ id: e.id, chave: e.chave, versao: b.versao }],
        responsavel: h.vinculo.vinculo,
        confirmarCritico: b.confirmarCritico,
      },
      conf?.critico
        ? 'Resultado liberado; o aviso do valor crítico foi ao responsável.'
        : 'Resultado liberado.',
    );
    this.notificador?.avisar(s.hospital);
    if (conf?.critico || Number(r.resultado['criticos']) > 0) await this.criticoNaCentral(s, e, r);
    return resultado(r, conf?.critico ? ['Valor crítico avisado ao responsável.'] : []);
  }

  async retificar(s: SessaoCadastro, id: number, bruto: Record<string, unknown>): Promise<ResultadoSadt> {
    const e = await this.exame(s, id);
    this.exigirEstado(e, 'retificar');
    const h = this.apoios.habilitado(await this.vinculos(s), e.ato);
    if (!h.vinculo)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem habilitação',
        h.motivo ?? 'A sessão não é habilitada para retificar.',
        {
          codigo: 'sem-habilitacao',
        },
      );
    const entrada: Record<string, unknown> = {
      ...bruto,
      exame: { id: e.id, chave: e.chave, versao: versaoDaTela(bruto) },
      responsavel: h.vinculo.vinculo,
    };
    delete entrada['versao'];
    const r = await this.apoios
      .doAto(e.ato)
      .executar(
        s,
        'sadt.retificarResultado',
        entrada,
        'Resultado retificado: a versão anterior ficou guardada e quem já tinha visto é avisado.',
      );
    this.notificador?.avisar(s.hospital);
    if (
      Number(r.resultado['criticos']) > 0 ||
      (this.central && (await this.porta.conferencia(ctx(s), id).catch(() => null))?.critico)
    )
      await this.criticoNaCentral(s, e, r);
    return resultado(r);
  }

  // ── Coleta e rastreio da amostra (só no novo) ────────────────────────────────────────────────────

  async coletar(
    s: SessaoCadastro,
    e: {
      exames: readonly number[];
      pulseira?: string | undefined;
      identificadoresConferidos: true;
      recipiente?: number | undefined;
      estacao?: string | undefined;
    },
  ): Promise<ColetaRegistrada> {
    const exames = await this.porta.examesPorId(ctx(s), e.exames);
    if (exames.length !== e.exames.length) return naoEncontrado('Algum exame da coleta não existe mais.');
    for (const x of exames) {
      if (x.setor !== 'laboratorio')
        recusa('Fora do laboratório', 'Só exames do laboratório têm coleta de amostra.', 'setor-invalido');
      this.exigirEstado(x, 'coletar');
    }
    const at = await this.porta.atendimentoDosExames(ctx(s), e.exames);
    if (!at || !at.mesmos)
      recusa(
        'Atendimentos diferentes',
        'Colete numa amostra só exames do mesmo atendimento.',
        'atendimentos-diferentes',
      );
    const a = at!;
    const internado = a.atend === 'I';
    const c = conferirColeta({
      internado,
      pulseiraLida: e.pulseira,
      pulseiraEsperada: null,
      identificadoresConferidos: e.identificadoresConferidos,
    });
    if (!c.pode) recusa('Coleta não conferida', c.motivo ?? 'Confira o paciente.', 'coleta-nao-conferida');
    if (internado) {
      const lida = (e.pulseira ?? '').trim().toUpperCase();
      const ok =
        lida.startsWith(`P${a.paciente}|`) || lida === `P${a.paciente}` || lida === String(a.prontuario);
      if (!ok)
        recusa(
          'Pulseira de outro paciente',
          'A pulseira lida não é do paciente deste exame.',
          'pulseira-divergente',
        );
    }
    const primeiro = exames[0]!;
    const prefixo = s.hospital.toUpperCase();
    const estacao = (e.estacao ?? estacaoDaRequisicao(s.req)).slice(0, 64);
    const r = await this.apoios.rastreio.sgh(
      s,
      EVENTOS_AUDITAVEIS.sadtAmostraColetada.codigo,
      'sadt.amostra.coletar',
      (x: { id: number }) => ({ tabela: TABELA_AMOSTRA, id: String(x.id), paciente: a.paciente }),
      (g) =>
        g.registrarColeta({
          codigo: (id) => codigoDaAmostra(prefixo, id),
          paciente: a.paciente,
          atendimento: a.atendimento,
          reg: a.reg,
          atend: a.atend,
          recipiente: e.recipiente ?? primeiro.recipiente?.codigo ?? null,
          exames: exames.map((x) => ({ id: x.id, chave: chaveTexto(x) })),
          pulseiraConferida: internado,
          estacao,
          usuario: s.login,
        }),
    );
    const fila = await this.etiqueta(s, r.codigo, primeiro, exames);
    this.notificador?.avisar(s.hospital);
    return {
      amostra: r.id,
      codigo: r.codigo,
      etiquetaNaFila: fila,
      mensagem: fila
        ? `Amostra ${r.codigo} coletada; a etiqueta foi para a impressora da estação.`
        : `Amostra ${r.codigo} coletada; imprima a etiqueta pela tela.`,
    };
  }

  /** A etiqueta ZPL da amostra na fila da impressora da estação (sem a fila: a tela oferece o arquivo). */
  private async etiqueta(
    s: SessaoCadastro,
    codigo: string,
    e: ExameSadt,
    exames: readonly ExameSadt[],
  ): Promise<boolean> {
    const fonte = this.documento;
    if (!fonte) return false;
    let zpl: string;
    try {
      zpl = etiquetaDaAmostra(codigo, e, exames);
    } catch (x) {
      if (x instanceof ErroZpl) return false;
      throw x;
    }
    try {
      await enfileirarZpl(
        {
          chaveIdempotencia: `amostra-${codigo}`,
          rede: s.rede || 'rede',
          estabelecimento: s.hospital,
          estacao: estacaoDaRequisicao(s.req)
            .replace(/[^A-Za-z0-9._-]/g, '-')
            .slice(0, 64),
          modelo: 'etiqueta-amostra',
          zpl,
        },
        fonte.armazem,
        fonte.destino,
        fonte.novoId,
      );
      return true;
    } catch {
      return false;
    }
  }

  async mudarEstado(s: SessaoCadastro, id: number, e: MudarEstadoAmostraEntrada): Promise<AmostraDetalhe> {
    const a = await this.porta.amostraPorId(ctx(s), id);
    if (!a) return naoEncontrado('A amostra não existe.');
    const p = podeMudar(a.estado, e.estado);
    if (!p.pode)
      recusa('Passagem não permitida', p.motivo ?? 'Passagem de estado não permitida.', 'amostra-transicao');
    const rejeicao = e.estado === 'rejeitada' || e.estado === 'recoleta';
    const permissao = rejeicao ? 'sadt.amostra.rejeitar' : 'sadt.amostra.receber';
    if (!s.pode(permissao))
      throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Seu perfil não permite esta ação.', {
        codigo: 'sem-permissao',
      });
    await this.apoios.rastreio.sgh(
      s,
      EVENTOS_AUDITAVEIS.sadtAmostraMovimentada.codigo,
      permissao,
      { tabela: TABELA_AMOSTRA, id: String(id), paciente: a.paciente.id },
      (g) =>
        g.mudarEstadoAmostra({
          amostra: id,
          de: a.estado,
          para: e.estado,
          motivo: e.motivo ?? null,
          detalhe: e.detalhe ?? null,
          usuario: s.login,
          estacao: estacaoDaRequisicao(s.req).slice(0, 64),
        }),
    );
    this.notificador?.avisar(s.hospital);
    return (await this.porta.amostraPorId(ctx(s), id)) ?? a;
  }

  // ── Valor crítico ────────────────────────────────────────────────────────────────────────────────

  async gravarValorCritico(s: SessaoCadastro, e: ValorCriticoEntrada): Promise<ResultadoSadt> {
    const id = await this.apoios.critico.sgh(
      s,
      EVENTOS_AUDITAVEIS.sadtValorCriticoAlterado.codigo,
      'sadt.valorCritico.editar',
      (x: number) => ({ tabela: TABELA_VALOR_CRITICO, id: String(x) }),
      (g) =>
        g.gravarValorCritico({
          ato: e.ato,
          exame: e.exame,
          elemento: e.elemento,
          abaixoDe: e.abaixoDe,
          acimaDe: e.acimaDe,
          prazoMinutos: e.prazoMinutos,
          aprovacao: e.aprovacao,
          ativo: e.ativo,
          usuario: s.login,
        }),
    );
    return { mensagem: 'Faixa crítica gravada.', repetida: false, ids: { valorCritico: id }, avisos: [] };
  }

  async comunicar(s: SessaoCadastro, aviso: number, e: ComunicarAvisoEntrada): Promise<ResultadoSadt> {
    await this.apoios.critico.sgh(
      s,
      EVENTOS_AUDITAVEIS.sadtAvisoCriticoComunicado.codigo,
      'sadt.avisoCritico.comunicar',
      { tabela: TABELA_AVISO, id: String(aviso) },
      (g) =>
        g.comunicarAviso({
          aviso,
          canal: e.canal,
          destinatario: e.destinatario,
          observacao: e.observacao ?? null,
          usuario: s.login,
        }),
    );
    this.notificador?.avisar(s.hospital);
    return { mensagem: 'Comunicação registrada.', repetida: false, ids: { aviso }, avisos: [] };
  }

  async painelCriticos(s: SessaoCadastro, o: { inicio: string; fim: string }): Promise<PainelCriticos> {
    const avisos = await this.porta.avisos(ctx(s), o);
    const ind = indicadoresCriticos(
      avisos.map((a) => ({
        emitidoEm: `${a.emitidoEm}Z`,
        prazoMinutos: Math.max(
          1,
          Math.round((Date.parse(`${a.prazoEm}Z`) - Date.parse(`${a.emitidoEm}Z`)) / 60_000),
        ),
        cienciaEm: a.ciencia?.em ? `${a.ciencia.em}Z` : null,
      })),
    );
    return { avisos, noPrazo: ind.noPrazo, total: ind.total, mediaMinutosCiencia: ind.mediaMinutos };
  }

  // ── Laudo ────────────────────────────────────────────────────────────────────────────────────────

  /**
   * A emissão do laudo (regra 11): o PDF/A com o código de autenticação e o QR da validação pública; a emissão (1ª
   * via, ou 2ª via com o motivo) grava o código, a via, o hash e os exames, com a trilha na mesma transação.
   */
  async emitirLaudo(
    s: SessaoCadastro,
    e: { exames: readonly number[]; segundaVia: boolean; motivoSegundaVia?: string | undefined },
  ): Promise<LaudoEmitido> {
    const fonte = this.documento;
    if (!fonte)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Emissão indisponível',
        'O serviço de emissão de documentos não está configurado.',
      );
    // A mesma trava que a tela lê em /sadt/gravacao (podeGravar): operação desligada no banco não gera PDF nem grava.
    const liberada = await this.porta.podeGravar(ctx(s), 'sadt.emitirLaudo');
    if (!liberada.pode)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Emissão desligada',
        liberada.motivo ?? 'A emissão do laudo não está liberada neste estabelecimento.',
        { codigo: liberada.codigo ?? 'operacao-nao-liberada' },
      );
    const exames = await this.porta.examesPorId(ctx(s), e.exames);
    if (exames.length !== e.exames.length) return naoEncontrado('Algum exame do laudo não existe mais.');
    for (const x of exames) this.exigirEstado(x, 'emitir');
    const at = await this.porta.atendimentoDosExames(ctx(s), e.exames);
    if (!at?.mesmos)
      recusa(
        'Atendimentos diferentes',
        'Um laudo junta exames do mesmo atendimento.',
        'atendimentos-diferentes',
      );
    const apoio = this.apoios.doAto(exames[0]!.ato);
    await apoio.exigirLiberacao(s);
    const conteudo = await this.porta.laudoParaEmitir(ctx(s), e.exames);
    if (!conteudo) return naoEncontrado('O conteúdo do laudo não foi lido.');
    const anterior = await this.porta.impressaoDosExames(ctx(s), e.exames);
    if (e.segundaVia && !anterior)
      recusa('Sem 1ª via', 'A 2ª via é de um laudo já emitido: emita a 1ª via.', 'sem-primeira-via');
    if (!e.segundaVia && anterior)
      recusa('Laudo já emitido', 'Este laudo já foi emitido: peça a 2ª via, com o motivo.', 'laudo-emitido');
    const codigo = anterior?.codigo ?? codigoDeAutenticacao(randomUUID());
    const origem = { tipo: 'sadt-laudo', idLegado: Math.trunc(e.exames[0]!) };
    const campos = camposDoLaudo(conteudo, codigo, rotuloDaVia(e.segundaVia, e.segundaVia ? 1 : 0));
    let emitido: Awaited<ReturnType<FonteDocumento['emissao']['emitir']>>;
    try {
      const original = e.segundaVia
        ? await fonte.emissao.originalDaOrigem(s.hospital, 'sadt-laudo', origem)
        : null;
      emitido = original
        ? await fonte.emissao.segundaVia(original.id, e.motivoSegundaVia ?? '', {
            titulo: 'Laudo de exames',
            campos,
            autor: s.login,
          })
        : await fonte.emissao.emitir({
            rede: s.rede,
            estabelecimento: s.hospital,
            modelo: 'sadt-laudo',
            versaoModelo: '1',
            titulo: 'Laudo de exames',
            origem,
            campos,
            autor: s.login,
          });
    } catch {
      throw new ErroProblema(
        'indisponivel',
        503,
        'Emissão indisponível',
        'Não foi possível gerar o PDF do laudo agora: tente de novo.',
      );
    }
    const hash = emitido.emissao.sha256;
    const impressao = anterior?.impressao ?? 0;
    await apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.sadtLaudoEmitido.codigo,
      'sadt.laudo.imprimir',
      { tabela: TABELA_LAUDO, id: codigo, paciente: at!.paciente },
      (g) =>
        g.registrarLaudoEmitido({
          impressao,
          codigo,
          via: emitido.emissao.via,
          exames: e.exames.length,
          hashPdf: hash,
          motivo: e.segundaVia ? (e.motivoSegundaVia ?? null) : null,
          usuario: s.login,
          idsExames: e.exames,
        }),
    );
    this.notificador?.avisar(s.hospital);
    return {
      impressao,
      codigo,
      exames: e.exames.length,
      segundaVia: e.segundaVia,
      pdf: Buffer.from(emitido.pdf).toString('base64'),
      hash,
      mensagem: e.segundaVia ? `2ª via do laudo emitida (${codigo}).` : `Laudo emitido (${codigo}).`,
    };
  }

  // ── Orçamento e requisição ───────────────────────────────────────────────────────────────────────

  async criarOrcamento(s: SessaoCadastro, e: CriarOrcamentoEntrada): Promise<ResultadoSadt> {
    const validade = await this.apoios.orcamento.parametro(s, 'sadt.validadeOrcamentoDias');
    const r = await this.apoios.orcamento.executar(
      s,
      'sadt.criarOrcamento',
      { ...e, validadeDias: e.validadeDias || validade || 30 },
      'Orçamento gravado.',
    );
    return resultado(r);
  }

  /** A conversão do orçamento: os mesmos exames e valores lançados no atendimento (regra 13). */
  async converterOrcamento(
    s: SessaoCadastro,
    id: number,
    e: Omit<ConverterOrcamentoEntrada, 'orcamento'>,
  ): Promise<ResultadoSadt> {
    if (!s.pode('sadt.orcamento.converter'))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão',
        'Seu perfil não permite converter o orçamento.',
        { codigo: 'sem-permissao' },
      );
    const { hoje } = await this.porta.relogio(ctx(s));
    const validadeDias = (await this.apoios.orcamento.parametro(s, 'sadt.validadeOrcamentoDias')) || 30;
    const o = await this.porta.orcamento(ctx(s), id, { hoje, validadeDias });
    if (!o) return naoEncontrado('O orçamento não existe.');
    if (o.situacao === 'convertido')
      recusa('Já convertido', 'O orçamento já foi convertido.', 'orcamento-convertido');
    if (o.situacao === 'vencido')
      recusa(
        'Orçamento vencido',
        'A validade do orçamento passou: faça um novo orçamento.',
        'orcamento-vencido',
      );
    await this.apoios.orcamento.exigirLiberacao(s);
    const apoio = await this.porta.apoio(ctx(s), setorDoAto(o.ato) ?? undefined);
    const itens = o.itens.map((i) => {
      const x = apoio.exames.find((y: { ato: number; codigo: string }) => y.ato === o.ato && y.codigo === i.exame);
      if (!x)
        return recusa(
          'Exame inativo',
          `O exame ${i.exame} do orçamento não está mais ativo.`,
          'exame-inativo',
        );
      return { exame: x.id, urgente: false };
    });
    const r = await this.lancar(s, {
      atendimento: e.atendimento,
      ato: o.ato,
      itens,
      executante: e.executante,
      prestador: e.prestador,
      local: e.local,
      confirmarAlertas: true,
    });
    await this.apoios.orcamento.sgh(
      s,
      EVENTOS_AUDITAVEIS.sadtOrcamentoConvertido.codigo,
      'sadt.orcamento.converter',
      { tabela: TABELA_ORCAMENTO, id: String(id) },
      (g) => g.marcarOrcamentoConvertido({ orcamento: id, atendimento: e.atendimento, usuario: s.login }),
    );
    return {
      ...r,
      mensagem: 'Orçamento convertido: os exames foram lançados no atendimento com os mesmos valores.',
    };
  }

  async abrirRequisicao(s: SessaoCadastro, e: AbrirRequisicaoEntrada): Promise<ResultadoSadt> {
    const r = await this.apoios.requisicao.executar(
      s,
      'sadt.abrirRequisicao',
      e,
      'Requisição de exames aberta.',
    );
    return resultado(r);
  }

  /** O protocolo do portal do paciente para o atendimento (o código sai uma vez, para imprimir; guarda-se o resumo). */
  async protocolo(s: SessaoCadastro, reg: number): Promise<{ protocolo: string; mensagem: string }> {
    if (!s.pode('sadt.requisicao.criar'))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão',
        'Seu perfil não permite emitir o protocolo.',
        { codigo: 'sem-permissao' },
      );
    const p = await this.porta.pacienteDoAtendimento(ctx(s), reg);
    if (!p) return naoEncontrado('O atendimento não existe.');
    const codigo = codigoProtocolo(randomBytes(10));
    await this.apoios.portal.sgh(
      s,
      EVENTOS_AUDITAVEIS.sadtPortalAcesso.codigo,
      'sadt.requisicao.criar',
      (x: number) => ({ tabela: TABELA_PORTAL, id: String(x), paciente: p.paciente }),
      (g) =>
        g.criarProtocoloPortal({
          paciente: p.paciente,
          reg,
          protocoloResumo: sha256(codigo),
          usuario: s.login,
        }),
    );
    return {
      protocolo: codigo,
      mensagem: 'Protocolo do portal emitido: entregue ao paciente com a data de nascimento.',
    };
  }

  async decidirAutocadastro(
    s: SessaoCadastro,
    id: number,
    e: { decisao: 'aprovar' | 'recusar'; solicitante?: number | undefined; motivo?: string | undefined },
  ): Promise<ResultadoSadt> {
    await this.apoios.portal.sgh(
      s,
      EVENTOS_AUDITAVEIS.sadtAutocadastroDecidido.codigo,
      'sadt.solicitanteWeb.aprovar',
      { tabela: TABELA_PORTAL, id: String(id) },
      (g) =>
        g.decidirAutocadastro({
          id,
          aprovar: e.decisao === 'aprovar',
          solicitante: e.solicitante ?? null,
          motivo: e.motivo ?? null,
          usuario: s.login,
        }),
    );
    return {
      mensagem:
        e.decisao === 'aprovar'
          ? 'Autocadastro aprovado: o médico já entra no portal.'
          : 'Autocadastro recusado.',
      repetida: false,
      ids: { autocadastro: id },
      avisos: [],
    };
  }

  async cadastrarSolicitante(s: SessaoCadastro, bruto: unknown): Promise<ResultadoSadt> {
    const r = await this.apoios.portal.executar(
      s,
      'cadastro.cadastrarSolicitante',
      bruto,
      'Médico solicitante cadastrado.',
    );
    return resultado(r);
  }

  async parametros(s: SessaoCadastro, setor: SetorSadt): Promise<ParametrosSadt> {
    const p = await this.porta.parametros(ctx(s), setor, s.login);
    return { setor, usuario: s.login, campos: p.campos, ocultos: p.ocultos };
  }

  async indicadores(
    s: SessaoCadastro,
    o: { inicio: string; fim: string; setor?: SetorSadt | undefined },
  ): Promise<IndicadoresSadt> {
    const r = await this.porta.indicadores(ctx(s), { ...o, agora: new Date() });
    return { inicio: o.inicio, fim: o.fim, ...r };
  }
}

export function chaveTexto(e: Pick<ExameSadt, 'chave'>): string {
  const k = e.chave;
  return [k.data, k.reg, k.conta, k.atend, k.ato, k.exame.trim(), k.sequencia].join('|');
}

/** Os campos do PDF do laudo (os valores, a referência, o texto, quem liberou e o código de autenticação). */
export function camposDoLaudo(
  c: {
    paciente: { nome: string; prontuario: number };
    atendimento: string;
    convenio: string;
    exames: readonly {
      nome: string;
      setor: string;
      data: string;
      liberadoEm: string | null;
      liberadoPor: string;
      valores: readonly {
        elemento: string;
        valor: string;
        unidade: string | null;
        referencia: string | null;
      }[];
      texto: readonly string[];
      emissor: string;
    }[];
  },
  codigo: string,
  via: string,
): { rotulo: string; valor: string }[] {
  const data = (iso: string | null) =>
    iso ? iso.slice(0, 10).split('-').reverse().join('/') : 'Não informado';
  const campos = [
    { rotulo: 'Paciente', valor: c.paciente.nome || 'Não informado' },
    { rotulo: 'Prontuário', valor: String(c.paciente.prontuario) },
    { rotulo: 'Atendimento', valor: c.atendimento || 'Não informado' },
    { rotulo: 'Convênio', valor: c.convenio || 'Não informado' },
  ];
  for (const x of c.exames) {
    campos.push({
      rotulo: `${x.nome} (${x.setor})`,
      valor: `Exame de ${data(x.data)}; liberado em ${data(x.liberadoEm)}`,
    });
    for (const v of x.valores)
      campos.push({
        rotulo: `  ${v.elemento}`,
        valor: `${v.valor}${v.unidade ? ` ${v.unidade}` : ''}${v.referencia ? ` (referência ${v.referencia})` : ''}`,
      });
    for (const t of x.texto) campos.push({ rotulo: '  Laudo', valor: t.slice(0, 4000) });
    if (x.emissor) campos.push({ rotulo: '  Médico laudador', valor: x.emissor });
    if (x.liberadoPor) campos.push({ rotulo: '  Liberado por', valor: x.liberadoPor });
  }
  campos.push({ rotulo: 'Código de autenticação', valor: codigo });
  campos.push({ rotulo: 'Via', valor: via });
  return campos;
}
