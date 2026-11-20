// Agência transfusional, etapa 2 (M47; ficha, seções 4, 5, 7 e 8; construída e DESLIGADA pela chave `agencia.completa`
// até a DP-21): imuno-hematologia, prova cruzada e estoque de bolsas.
//   GET  /api/sadt/agencia/estado                      a liberação e as ações da sessão (a tela mostra a faixa)
//   GET  /api/sadt/agencia/requisicoes                 as requisições abertas (com a amostra), para a imuno e a reserva
//   GET  /api/sadt/agencia/requisicoes/:id             a requisição com a tipagem do receptor (a da agência prevalece),
//                                                      os resultados, as provas, os exames já lançados e as bolsas
//   GET  /api/sadt/agencia/imuno                       a fila da imuno-hematologia (estado, tipo, requisição, paciente)
//   POST /api/sadt/agencia/imuno                       sadt.registrarImunoHematologia (digitado; DP-17)
//   POST /api/sadt/agencia/imuno/:id/liberar           a liberação por outro profissional (dupla conferência)
//   POST /api/sadt/agencia/imuno/:id/invalidar         a invalidação com o motivo
//   GET  /api/sadt/agencia/bolsas                      o estoque (filtro) com o painel por tipo e as ações de cada bolsa
//   GET  /api/sadt/agencia/bolsas/:id                  a bolsa com o histórico (a transfusão no fim)
//   POST /api/sadt/agencia/bolsas                      sadt.receberBolsa (quarentena ou liberada na entrada)
//   POST /api/sadt/agencia/bolsas/:id/movimentos       sadt.movimentarBolsa (a reserva confere a compatibilidade)
//   POST /api/sadt/agencia/bolsas/:id/corrigir         W0-03: etiqueta, validade e volume antes do uso (a versão
//                                                      anterior legível; 409 depois do uso)
// Toda escrita pela chave `agencia.completa` (POL-3), só em tabelas SGH_ com a SGH_TRILHA na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type BolsaEstoqueLida,
  classeDoHemocomponente,
  esquemaCorrigirBolsa,
  esquemaFiltroEstoque,
  esquemaFiltroImuno,
  esquemaInvalidarImunoHematologia,
  esquemaLiberarImunoHematologia,
  esquemaMovimentarBolsa,
  esquemaReceberBolsa,
  esquemaRegistrarImunoHematologia,
  EVENTOS_AUDITAVEIS,
  PERMISSOES_TRANSFUSAO_CODIGOS as P,
  type RequisicaoTransfusionalLida,
} from '@sgh/contratos';
import {
  acoesPossiveis,
  CHAVE_AGENCIA_COMPLETA,
  conferirBolsa,
  conferirCompatibilidadeDaAgencia,
  conferirLiberacaoImuno,
  conferirProvaCruzada,
  interpretarAboRh,
  MENSAGENS_BOLSA,
  MENSAGENS_ESTOQUE,
  MENSAGENS_IMUNO,
  resumoEstoque,
  situacaoNoRecebimento,
  tipagemDoReceptor,
} from '@sgh/dominio-sadt';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { type GravadorAgencia, PORTA_AGENCIA, type PortaAgencia } from './agencia-porta.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';
import { chaveDoPedido } from './sae.controller.js';
import { PORTA_TRANSFUSAO, type PortaTransfusao } from './transfusao-porta.js';

const E = EVENTOS_AUDITAVEIS;
const MENSAGENS: Readonly<Record<string, string>> = {
  ...MENSAGENS_BOLSA,
  ...MENSAGENS_IMUNO,
  ...MENSAGENS_ESTOQUE,
};
const recusa = (titulo: string, codigos: readonly string[]) =>
  new ErroProblema('recusa-de-negocio', 409, titulo, codigos.map((c) => MENSAGENS[c] ?? c).join(' '), {
    codigo: codigos[0] ?? 'recusa',
    bloqueios: codigos,
  });
const ABERTAS = ['requisitada', 'amostraColetada', 'emAtendimento'];

@Controller('sadt/agencia')
export class AgenciaController {
  private readonly apoio: ApoioGravacao<GravadorAgencia>;

  constructor(
    @Inject(PORTA_AGENCIA) private readonly porta: PortaAgencia,
    @Inject(PORTA_TRANSFUSAO) private readonly transfusao: PortaTransfusao,
    @Inject(PORTA_ENFERMAGEM) private readonly enfermagem: PortaEnfermagem,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      {
        chave: CHAVE_AGENCIA_COMPLETA,
        nome: 'a agência transfusional completa (imuno-hematologia, prova cruzada e estoque de bolsas)',
        operacoes: {},
      },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private async agora(s: SessaoCadastro): Promise<string> {
    return (await this.enfermagem.relogio(s.porta)).slice(0, 16);
  }

  /** O estado da gravação para a tela: a chave da agência completa e as ações por permissão. */
  private async gravacao(s: SessaoCadastro) {
    const l = await this.apoio.liberacao(s);
    const pode = (perm: string) => l.ligada && s.pode(perm);
    return {
      ligada: l.ligada,
      motivo: l.motivo,
      acoes: {
        registrar: pode(P.imunoRegistrar),
        liberar: pode(P.imunoLiberar),
        receber: pode(P.bolsaReceber),
        movimentar: pode(P.bolsaMovimentar),
        corrigir: pode(P.bolsaReceber),
      },
    };
  }

  private async requisicaoOu404(
    s: SessaoCadastro,
    id: number,
    agora: string,
  ): Promise<RequisicaoTransfusionalLida> {
    const r = await this.transfusao.requisicao(s.porta, id, agora);
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Requisição não encontrada');
    return r;
  }

  private async receptor(s: SessaoCadastro, paciente: number) {
    const [resultados, cadastro] = await Promise.all([
      this.porta.resultadosDoPaciente(s.porta, paciente),
      this.transfusao.tipagem(s.porta, paciente),
    ]);
    return tipagemDoReceptor(resultados, cadastro);
  }

  /** As requisições abertas (com a amostra), as mais recentes primeiro. */
  private async abertas(s: SessaoCadastro) {
    const agora = await this.agora(s);
    const r = await this.transfusao.requisicoes(s.porta, { agora: `${agora}:00` });
    return { itens: r.itens.filter((x) => ABERTAS.includes(x.estado)), cortada: r.cortada, agora };
  }

  // ── Leituras ────────────────────────────────────────────────────────────────────────────────────

  @Get('estado')
  @Permissao(P.imunoLer)
  async estado(@Req() req: RequisicaoAutorizada) {
    return { gravacao: await this.gravacao(sessaoDe(req)) };
  }

  @Get('requisicoes')
  @Permissao(P.imunoLer)
  @Auditar(E.sadtAgenciaLida.codigo)
  async requisicoes(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const r = await this.abertas(s);
    req.sghAlvo = { tabelaAlvo: 'SGH_SADT_HEMO_REQ', chaveNaturalAlvo: `abertas:${String(r.itens.length)}` };
    return { ...r, gravacao: await this.gravacao(s) };
  }

  @Get('estoque/requisicoes')
  @Permissao(P.bolsaLer)
  @Auditar(E.sadtAgenciaLida.codigo)
  async requisicoesDoEstoque(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const r = await this.abertas(s);
    req.sghAlvo = { tabelaAlvo: 'SGH_SADT_HEMO_REQ', chaveNaturalAlvo: `abertas:${String(r.itens.length)}` };
    return r;
  }

  @Get('requisicoes/:id')
  @Permissao(P.imunoLer)
  @Auditar(E.sadtAgenciaLida.codigo)
  async requisicao(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const agora = await this.agora(s);
    const r = await this.requisicaoOu404(s, idDaRota(id), `${agora}:00`);
    req.sghAlvo = { paciente: r.paciente.id, tabelaAlvo: 'SGH_SADT_HEMO_REQ', idAlvo: String(r.id) };
    const [receptor, resultados, provas, exames, estoque, gravacao] = await Promise.all([
      this.receptor(s, r.paciente.id),
      this.porta.imunos(s.porta, { paciente: r.paciente.id }),
      this.porta.provas(s.porta, r.id),
      r.paciente.prontuario !== null
        ? this.porta.examesLancados(s.porta, r.paciente.prontuario, agora).catch(() => [])
        : Promise.resolve([]),
      this.porta.estoque(s.porta, { agora, hemocomponente: r.hemocomponente.codigo }),
      this.gravacao(s),
    ]);
    const classe = classeDoHemocomponente(r.hemocomponente.codigo);
    const extrema = r.urgencia === 'extremaUrgencia';
    /** As bolsas do estoque para a requisição: as reservadas para ela e as liberadas compatíveis (regra 3). */
    const candidata = (b: BolsaEstoqueLida) => {
      if (!b.tipagem.abo || !b.tipagem.rh) return { bloqueios: ['abo-incompativel'], alertas: [] };
      const k = conferirBolsa({
        classe,
        hemocomponenteRequisitado: r.hemocomponente.codigo,
        hemocomponenteDaBolsa: b.hemocomponente.codigo,
        bolsa: { abo: b.tipagem.abo, rh: b.tipagem.rh },
        receptor: receptor.tipagem,
        validade: b.validade,
        agora,
        situacao: b.situacao,
        extremaUrgencia: extrema,
        justificativaRh: null,
      });
      return k;
    };
    const reservadas = estoque.itens.filter(
      (b) => b.situacao === 'reservada' && b.reservadaPara?.requisicao === r.id,
    );
    // Todas as liberadas do hemocomponente (a prova cruzada é que confirma): cada uma com a conferência contra a tipagem
    // que vale agora (com a tipagem ainda só do cadastro, a incompatibilidade aparece como aviso, não esconde a bolsa).
    const liberadas = estoque.itens
      .filter((b) => b.situacao === 'liberada' && !b.vencida)
      .map((b) => ({ bolsa: b, conferencia: candidata(b) }))
      .map((x) => ({
        ...x.bolsa,
        compativel: x.conferencia.bloqueios.length === 0,
        alertas: [...x.conferencia.bloqueios, ...x.conferencia.alertas].map((a) => MENSAGENS[a] ?? a),
      }));
    return {
      requisicao: r,
      receptor,
      resultados: resultados.itens.filter((x) => x.tipo !== 'provaCruzada'),
      provas: (await this.porta.imunos(s.porta, { requisicao: r.id, tipo: 'provaCruzada' })).itens,
      provasResumo: provas,
      exames,
      reservadas,
      candidatas: liberadas,
      agora,
      gravacao,
    };
  }

  @Get('imuno')
  @Permissao(P.imunoLer)
  @Auditar(E.sadtAgenciaLida.codigo)
  async imunos(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroImuno, Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '')));
    const r = await this.porta.imunos(s.porta, f);
    // A consulta dirigida a um paciente (pelo filtro, ou pela requisição com os itens todos do mesmo paciente) vai à
    // trilha com o paciente consultado (LGPD: quem viu o resultado imuno-hematológico de quem).
    const pacientes = new Set(r.itens.map((x) => x.paciente));
    const paciente =
      f.paciente ?? (f.requisicao !== undefined && pacientes.size === 1 ? [...pacientes][0] : undefined);
    req.sghAlvo = {
      ...(paciente !== undefined ? { paciente } : {}),
      tabelaAlvo: 'SGH_SADT_HEMO_IMUNO',
      ...(f.requisicao !== undefined
        ? { idAlvo: String(f.requisicao) }
        : { chaveNaturalAlvo: `lista:${String(r.itens.length)}` }),
    };
    return { ...r, agora: await this.agora(s), gravacao: await this.gravacao(s) };
  }

  @Get('bolsas')
  @Permissao(P.bolsaLer)
  @Auditar(E.sadtAgenciaLida.codigo)
  async bolsas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroEstoque, Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '')));
    const agora = await this.agora(s);
    const [r, todas, gravacao] = await Promise.all([
      this.porta.estoque(s.porta, { ...f, agora }),
      this.porta.estoque(s.porta, { agora }),
      this.gravacao(s),
    ]);
    req.sghAlvo = { tabelaAlvo: 'SGH_SADT_HEMO_BOLSA', chaveNaturalAlvo: `lista:${String(r.itens.length)}` };
    return {
      itens: r.itens.map((b) => ({ ...b, acoes: acoesPossiveis(b.situacao, b.vencida) })),
      cortada: r.cortada,
      resumo: resumoEstoque(
        todas.itens.map((b) => ({
          hemocomponente: b.hemocomponente.codigo,
          abo: b.tipagem.abo,
          rh: b.tipagem.rh,
          situacao: b.situacao,
          validade: b.validade,
        })),
        agora,
      ),
      agora,
      gravacao,
    };
  }

  /** Os combos do recebimento (local de armazenagem) e dos movimentos (motivo de devolução ou perda). */
  @Get('estoque/cadastros')
  @Permissao(P.bolsaLer)
  async cadastrosDoEstoque(@Req() req: RequisicaoAutorizada) {
    return this.porta.cadastrosDoEstoque(sessaoDe(req).porta);
  }

  @Get('bolsas/:id')
  @Permissao(P.bolsaLer)
  @Auditar(E.sadtAgenciaLida.codigo)
  async bolsa(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const agora = await this.agora(s);
    const b = await this.porta.bolsa(s.porta, { id: idDaRota(id) }, agora);
    if (!b) throw new ErroProblema('nao-encontrado', 404, 'Bolsa não encontrada');
    // A bolsa reservada mostra o paciente a que se destina: o acesso vai à trilha com ele.
    req.sghAlvo = {
      ...(b.reservadaPara ? { paciente: b.reservadaPara.paciente } : {}),
      tabelaAlvo: 'SGH_SADT_HEMO_BOLSA',
      idAlvo: String(b.id),
    };
    return {
      bolsa: { ...b, acoes: acoesPossiveis(b.situacao, b.vencida) },
      movimentos: await this.porta.movimentos(s.porta, b.id),
      // W0-03: as versões anteriores da bolsa corrigida (a do recebimento primeiro).
      versoes: await this.porta.versoesBolsa(s.porta, b.id),
      agora,
    };
  }

  /**
   * W0-03 (matriz, linha "Hemoterapia"; RDC 34/2014 art. 15 §1º): corrigir a bolsa recebida (número da etiqueta,
   * tipagem, validade, volume) só antes do uso — sem ato com o número, fora da reserva e da baixa —, com o motivo; a
   * versão anterior fica legível em SGH_SADT_HEMO_BOLSA_VERSAO. Depois do uso, 409. O motivo não vai à trilha.
   */
  @Post('bolsas/:id/corrigir')
  @HttpCode(200)
  @Permissao(P.bolsaReceber)
  @AuditadoNoHandler(
    'a correção da bolsa em SGH_SADT_HEMO_BOLSA e SGH_SADT_HEMO_BOLSA_VERSAO com a SGH_TRILHA',
  )
  async corrigir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCorrigirBolsa, b);
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    const bolsa = await this.porta.bolsa(s.porta, { id: idDaRota(id) }, agora);
    if (!bolsa) throw new ErroProblema('nao-encontrado', 404, 'Bolsa não encontrada');
    const x = await this.apoio.sgh(
      s,
      E.sadtBolsaCorrigida.codigo,
      P.bolsaReceber,
      { tabela: 'SGH_SADT_HEMO_BOLSA', id: String(bolsa.id), paciente: null, chave: 'corrigida' },
      (g) =>
        g.corrigirBolsa({
          bolsa: bolsa.id,
          numero: e.numero,
          tipagem: e.tipagem,
          validade: e.validade,
          volumeMl: e.volumeMl,
          versao: e.versao,
          motivo: e.motivo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id: x.id,
      numero: x.numero,
      versao: x.versao,
      mensagem: 'Bolsa corrigida; a versão anterior ficou guardada.',
    };
  }

  // ── Imuno-hematologia ───────────────────────────────────────────────────────────────────────────

  @Post('imuno')
  @HttpCode(201)
  @Permissao(P.imunoRegistrar)
  @AuditadoNoHandler(
    'sadt.registrarImunoHematologia: SGH_SADT_HEMO_IMUNO com a SGH_TRILHA na mesma transação',
  )
  async registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarImunoHematologia, b);
    const chave = chaveDoPedido(s);
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    let tipagem = null;
    let problemas: readonly string[] = [];
    if (e.tipo === 'aboRh') {
      const i = interpretarAboRh(e.direta, e.reversa);
      tipagem = i.tipagem;
      problemas = i.problemas;
    }
    if (e.tipo === 'provaCruzada') {
      const r = await this.requisicaoOu404(s, e.requisicao, `${agora}:00`);
      if (r.paciente.id !== e.paciente) throw recusa('Prova cruzada', ['paciente-diferente']);
      const [bolsa, receptor] = await Promise.all([
        this.porta.bolsa(s.porta, { numero: e.bolsa }, agora),
        this.receptor(s, e.paciente),
      ]);
      const k = conferirProvaCruzada({
        classe: classeDoHemocomponente(r.hemocomponente.codigo),
        amostraValidaAte: r.amostra?.validaAte.slice(0, 16) ?? null,
        agora,
        bolsaNoEstoque: bolsa !== null,
        hemocomponenteDaBolsa: bolsa?.hemocomponente.codigo ?? null,
        hemocomponenteRequisitado: r.hemocomponente.codigo,
        estadoRequisicao: r.estado,
        pai: receptor.pai,
        faseAntiglobulina: e.faseAntiglobulina,
      });
      if (k.length > 0) throw recusa('Prova cruzada', k);
    }
    const x = await this.apoio.sgh(
      s,
      E.sadtImunoRegistrado.codigo,
      P.imunoRegistrar,
      (r: { id: number }) => ({
        tabela: 'SGH_SADT_HEMO_IMUNO',
        id: String(r.id),
        paciente: e.paciente,
        chave: e.tipo,
      }),
      (g) => g.registrarImuno({ ...e, tipagem, usuario: s.login, chave }),
    );
    return {
      ok: true,
      id: x.id,
      repetida: x.repetida,
      tipagem,
      problemas: problemas.map((p) => MENSAGENS[p] ?? p),
      mensagem:
        problemas.length > 0
          ? 'Resultado registrado sem tipagem conclusiva: repita antes de liberar.'
          : 'Resultado registrado: falta a liberação por outro profissional.',
    };
  }

  private async imunoOu404(s: SessaoCadastro, id: number) {
    const [i] = (await this.porta.imunos(s.porta, { id })).itens;
    if (!i) throw new ErroProblema('nao-encontrado', 404, 'Resultado não encontrado');
    return i;
  }

  @Post('imuno/:id/liberar')
  @HttpCode(200)
  @Permissao(P.imunoLiberar)
  @AuditadoNoHandler('liberação do resultado imuno-hematológico: SGH_SADT_HEMO_IMUNO com a SGH_TRILHA')
  async liberar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    corpo(esquemaLiberarImunoHematologia, b);
    await this.apoio.exigirLiberacao(s);
    const i = await this.imunoOu404(s, idDaRota(id));
    const k = conferirLiberacaoImuno({
      estado: i.estado,
      tipo: i.tipo,
      registradoPor: i.registradoPor,
      liberador: s.login,
      tipagem: i.tipagem,
    });
    if (k.length > 0) throw recusa('Liberação', k);
    await this.apoio.sgh(
      s,
      E.sadtImunoLiberado.codigo,
      P.imunoLiberar,
      { tabela: 'SGH_SADT_HEMO_IMUNO', id: String(i.id), paciente: i.paciente, chave: i.tipo },
      (g) => g.liberarImuno({ id: i.id, usuario: s.login }),
    );
    return { ok: true, id: i.id, mensagem: 'Resultado liberado.' };
  }

  @Post('imuno/:id/invalidar')
  @HttpCode(200)
  @Permissao(P.imunoLiberar)
  @AuditadoNoHandler('invalidação do resultado imuno-hematológico: SGH_SADT_HEMO_IMUNO com a SGH_TRILHA')
  async invalidar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaInvalidarImunoHematologia, b);
    await this.apoio.exigirLiberacao(s);
    const i = await this.imunoOu404(s, idDaRota(id));
    if (i.estado === 'invalidado') throw recusa('Invalidação', ['invalidado']);
    await this.apoio.sgh(
      s,
      E.sadtImunoInvalidado.codigo,
      P.imunoLiberar,
      { tabela: 'SGH_SADT_HEMO_IMUNO', id: String(i.id), paciente: i.paciente, chave: i.tipo },
      (g) => g.invalidarImuno({ id: i.id, usuario: s.login, motivo: e.motivo }),
    );
    return { ok: true, id: i.id, mensagem: 'Resultado invalidado: colete nova amostra se for preciso.' };
  }

  // ── Estoque ─────────────────────────────────────────────────────────────────────────────────────

  @Post('bolsas')
  @HttpCode(201)
  @Permissao(P.bolsaReceber)
  @AuditadoNoHandler('sadt.receberBolsa: SGH_SADT_HEMO_BOLSA e _MOV com a SGH_TRILHA na mesma transação')
  async receber(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaReceberBolsa, b);
    const chave = chaveDoPedido(s);
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    const k = situacaoNoRecebimento({
      classe: classeDoHemocomponente(e.hemocomponente),
      temperaturaC: e.temperaturaC,
      inspecaoOk: e.inspecaoOk,
      liberarNaEntrada: e.liberarNaEntrada,
      validade: e.validade,
      agora,
    });
    if (!k.situacao) throw recusa('Recebimento', k.bloqueios);
    const situacao = k.situacao === 'liberada' ? 'liberada' : 'quarentena';
    const x = await this.apoio.sgh(
      s,
      E.sadtBolsaRecebida.codigo,
      P.bolsaReceber,
      (r: { id: number }) => ({ tabela: 'SGH_SADT_HEMO_BOLSA', id: String(r.id), chave: e.numero }),
      (g) =>
        g.receberBolsa({
          numero: e.numero,
          hemocomponente: e.hemocomponente,
          tipagem: e.tipagem,
          volumeMl: e.volumeMl,
          validade: e.validade,
          origem: e.origem,
          local: e.local,
          irradiada: e.irradiada,
          leucorreduzida: e.leucorreduzida,
          temperaturaC: e.temperaturaC,
          inspecaoOk: e.inspecaoOk,
          situacao,
          usuario: s.login,
          chave,
        }),
    );
    return {
      ok: true,
      id: x.id,
      repetida: x.repetida,
      situacao,
      alertas: k.alertas.map((a) => MENSAGENS[a] ?? a),
      mensagem: situacao === 'liberada' ? 'Bolsa recebida e liberada.' : 'Bolsa recebida em quarentena.',
    };
  }

  @Post('bolsas/:id/movimentos')
  @HttpCode(200)
  @Permissao(P.bolsaMovimentar)
  @AuditadoNoHandler(
    'sadt.movimentarBolsa: SGH_SADT_HEMO_BOLSA e _MOV com a SGH_TRILHA; descarte e devolução como BOLSA_DESCARTADA',
  )
  async movimentar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaMovimentarBolsa, b);
    const chave = chaveDoPedido(s);
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    const bolsa = await this.porta.bolsa(s.porta, { id: idDaRota(id) }, agora);
    if (!bolsa) throw new ErroProblema('nao-encontrado', 404, 'Bolsa não encontrada');
    let alertas: readonly string[] = [];
    let paciente: number | null = null;
    if (e.acao === 'reservar' && e.requisicao !== null) {
      // A reserva confere a bolsa contra o paciente da requisição (regra 3) e a compatibilidade da agência (a tipagem da
      // agência, a prova cruzada das hemácias).
      const r = await this.requisicaoOu404(s, e.requisicao, `${agora}:00`);
      paciente = r.paciente.id;
      const classe = classeDoHemocomponente(r.hemocomponente.codigo);
      const extrema = r.urgencia === 'extremaUrgencia';
      const [receptor, provas] = await Promise.all([
        this.receptor(s, r.paciente.id),
        this.porta.provas(s.porta, r.id),
      ]);
      const k1 =
        bolsa.tipagem.abo && bolsa.tipagem.rh
          ? conferirBolsa({
              classe,
              hemocomponenteRequisitado: r.hemocomponente.codigo,
              hemocomponenteDaBolsa: bolsa.hemocomponente.codigo,
              bolsa: { abo: bolsa.tipagem.abo, rh: bolsa.tipagem.rh },
              receptor: receptor.tipagem,
              validade: bolsa.validade,
              agora,
              situacao: bolsa.situacao,
              extremaUrgencia: extrema,
              justificativaRh: null,
            })
          : { bloqueios: ['abo-incompativel' as const], alertas: [] };
      const k2 = conferirCompatibilidadeDaAgencia({
        classe,
        numeroBolsa: bolsa.numero,
        requisicao: r.id,
        extremaUrgencia: extrema,
        receptor,
        provas,
      });
      const bloqueios = [...k1.bloqueios, ...k2.bloqueios];
      if (bloqueios.length > 0) throw recusa('Reserva', bloqueios);
      alertas = [...k1.alertas, ...k2.alertas];
    }
    const descarte = e.acao === 'descartar' || e.acao === 'devolver';
    const x = await this.apoio.sgh(
      s,
      descarte ? E.sadtBolsaDescartada.codigo : E.sadtBolsaMovimentada.codigo,
      P.bolsaMovimentar,
      {
        tabela: 'SGH_SADT_HEMO_BOLSA',
        id: String(bolsa.id),
        paciente,
        chave: `${e.acao}:${bolsa.numero}`.slice(0, 80),
      },
      (g) =>
        g.movimentarBolsa({
          bolsa: bolsa.id,
          acao: e.acao,
          requisicao: e.requisicao,
          motivoCadastro: e.motivoCadastro,
          motivo: e.motivo,
          inspecaoConferida: e.inspecaoConferida,
          versao: e.versao,
          agora,
          usuario: s.login,
          chave,
        }),
    );
    return {
      ok: true,
      id: x.id,
      situacao: x.situacao,
      repetida: x.repetida,
      alertas: alertas.map((a) => MENSAGENS[a] ?? a),
      mensagem: 'Movimento registrado.',
    };
  }
}
