// Classificação de risco no pronto atendimento (M44, etapa 1; ficha, seções 4, 5, 7 e 8):
//   GET  /api/pa/classificacao/fila                 chegou e não classificou (e os estourados a reclassificar)
//   GET  /api/pa/classificacao/indicadores          porta → classificação, porta → médico, dentro do alvo por cor e
//                                                   reclassificações, cada um com numerador e denominador (regra 5)
//   GET  /api/pa/classificacao/:reg                 a tela de classificar: protocolo vigente, vigente, risco, histórico
//                                                   (leitura de prontuário auditada), sinais recentes e as ações
//   POST /api/pa/classificacao/:reg                 recepcao.classificarRisco (enfermeiro com COREN ativo; regra 1)
//   POST /api/pa/classificacao/:reg/reclassificar   recepcao.reclassificarRisco (estouro ou mudança do quadro)
//   POST /api/pa/classificacao/:reg/sinais          os sinais do técnico de enfermagem, sem concluir (regra 1)
//   GET  /api/pa/protocolos                         as versões publicadas (a primeira é a vigente)
//   GET  /api/pa/protocolos/:id                     uma versão com o conteúdo (conferido pela impressão digital)
//   POST /api/pa/protocolos/simular                 o simulador do editor (puro: a mesma proposta do motor)
//   POST /api/pa/protocolos                         recepcao.publicarProtocoloClassificacao (crítica: reautenticação)
//   GET  /api/pa/cores-legado                       a tabela de cores antiga (consulta)
// A classificação grava no banco do produto ou, com o formulário de classificação do prontuário liberado, pelo
// registro clínico do M22 na mesma transação. Toda gravação é auditada (trilha na mesma transação) e avisa o quadro.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  CHAVE_LIBERACAO_CLASSIFICACAO,
  type CorLegadoConsulta,
  CORES_RISCO,
  esquemaClassificarRisco,
  esquemaPublicarProtocoloClassificacao,
  esquemaReclassificarRisco,
  esquemaRegistrarSinaisTriagem,
  esquemaSimularProtocolo,
  EVENTOS_AUDITAVEIS,
  type FilaClassificacao,
  type IndicadoresClassificacaoPa,
  type ProtocoloComConteudo,
  type ResultadoClassificacao,
  type ResultadoSimulacaoProtocolo,
  type TelaClassificacao,
  type VersaoProtocoloResumo,
} from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { ErroSessao, type ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import {
  AVISOS_ATENDIMENTO,
  type AvisosAtendimento,
  PORTA_ATENDIMENTO,
  type PortaAtendimento,
} from '../atendimento/public-api.js';
import { idDaRota, problemaDoCadastro, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo, dataDaConsulta } from '../exames/public-api.js';
import { ApoioClassificacao, trilhaDaSessao } from './apoio.js';
import { portaDeModuloAusente } from './indisponivel.js';
import { LiberacaoPep, SERVICO_REGISTRO, type ServicoRegistro } from '../pep/public-api.js';
import { formularioDaSessao } from './classificacao-formulario.js';
import {
  type ContextoClassificacao,
  type GravadorClassificacao,
  PORTA_CLASSIFICACAO,
  type PortaClassificacao,
} from './classificacao-porta.js';
import { PORTA_RECEPCAO, type PortaRecepcao } from './porta.js';
import { ServicoProtocoloGerenciado } from './protocolo-gerenciado-servico.js';
import {
  encerradoNoPa,
  type FonteAtendimentosPa,
  resumoDe,
  ServicoClassificacao,
  type SessaoClassificacao,
} from './classificacao-servico.js';

const TABELA = 'classificacao_risco';
const ROTULO_COR = new Map<string, string>(CORES_RISCO.map((c) => [c.codigo, c.rotulo]));

/** A fonte dos atendimentos do PA pela porta do atendimento (M20). */
export function fonteAtendimentosPa(
  porta: PortaAtendimento,
  recepcao: Pick<PortaRecepcao, 'sigilosos'> | null = null,
): FonteAtendimentosPa {
  // O contexto vem da sessão (sessaoDe: o ContextoPorta completo, com cliente, estabelecimento e usuário); a porta da
  // recepção só lê o código do estabelecimento dele.
  const doAtendimento = (c: ContextoClassificacao) => c as Parameters<PortaAtendimento['relogio']>[0];
  return {
    ...(recepcao ? { sigilosos: (c, ps) => recepcao.sigilosos(c, ps) } : {}),
    paAbertos: (c, o) => porta.paAbertos(doAtendimento(c), o),
    async pacienteDoAtendimento(c, reg) {
      const d = await porta.detalhe(doAtendimento(c), reg);
      if (!d?.paciente.id) return null;
      const { hoje } = await porta.relogio(doAtendimento(c));
      const a = (await porta.paAbertos(doAtendimento(c), { hoje })).itens.find((x) => x.reg === reg);
      return { id: d.paciente.id, nascimento: a?.nascimento ?? null };
    },
  };
}

@Controller('pa')
export class ClassificacaoController {
  private readonly apoio: ApoioClassificacao<GravadorClassificacao>;
  private readonly atendimento: PortaAtendimento;
  private readonly liberacaoPep: LiberacaoPep;

  constructor(
    @Inject(PORTA_CLASSIFICACAO) private readonly porta: PortaClassificacao,
    // Sem o módulo do atendimento montado, as leituras do PA respondem 503 (porta ausente), sem derrubar a API.
    @Optional() @Inject(PORTA_ATENDIMENTO) atendimento: PortaAtendimento | null,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(AVISOS_ATENDIMENTO) private readonly avisos: AvisosAtendimento | null = null,
    @Optional() @Inject(SERVICO_REGISTRO) private readonly registro: ServicoRegistro | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(PORTA_RECEPCAO) private readonly recepcao: PortaRecepcao | null = null,
  ) {
    this.atendimento = atendimento ?? portaDeModuloAusente<PortaAtendimento>();
    this.apoio = new ApoioClassificacao(
      {
        chave: CHAVE_LIBERACAO_CLASSIFICACAO,
        nome: 'a classificação de risco',
        operacoes: {},
      },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.liberacaoPep = new LiberacaoPep(configuracao, cache);
  }

  private servico(s: SessaoCadastro): ServicoClassificacao {
    const formulario = this.registro
      ? formularioDaSessao(s, {
          registro: this.registro,
          configuracao: this.configuracao,
          liberacaoRegistro: (x) => this.liberacaoPep.consultar(x, 'pep.evolucao.registro'),
          porta: this.porta,
        })
      : null;
    return new ServicoClassificacao(
      this.porta,
      fonteAtendimentosPa(this.atendimento, this.recepcao),
      formulario,
    );
  }

  private sessao(s: SessaoCadastro): SessaoClassificacao {
    return { c: s.porta, login: s.login, pode: (p) => s.pode(p) };
  }

  // ── Fila, tela e indicadores ───────────────────────────────────────────────────────────────────

  @Get('classificacao/fila')
  @Permissao('recepcao.classificacao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.atendimentoFilaLida.codigo)
  async fila(@Req() req: RequisicaoAutorizada): Promise<FilaClassificacao> {
    const s = sessaoDe(req);
    const r = await this.servico(s).fila(s.porta);
    req.sghAlvo = { tabelaAlvo: TABELA, chaveNaturalAlvo: `parte:fila;n:${r.itens.length}` };
    return r;
  }

  @Get('classificacao/indicadores')
  @Permissao('recepcao.classificacao.ler')
  async indicadores(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IndicadoresClassificacaoPa> {
    const s = sessaoDe(req);
    const { hoje, agora } = await this.porta.relogio(s.porta);
    const inicio = dataDaConsulta(q['inicio']) ?? hoje;
    const fim = dataDaConsulta(q['fim']) ?? hoje;
    if (fim < inicio)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O fim vem depois do início.');
    if (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`) > 366 * 86_400_000)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O período vai até 366 dias.');
    // Os atendimentos do PA do período, abertos ou encerrados, com as marcas reais (etapas do atendimento) lidas pelo período.
    const { marcasPa } = await this.atendimento.indicadores(s.porta, { inicio, fim });
    return this.servico(s).indicadores(s.porta, inicio, fim, marcasPa, agora);
  }

  @Get('classificacao/:reg')
  @Permissao('recepcao.classificacao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.registroLido.codigo)
  async tela(@Param('reg') reg: string, @Req() req: RequisicaoAutorizada): Promise<TelaClassificacao> {
    const s = sessaoDe(req);
    const sv = this.servico(s);
    const r = await sv.tela(this.sessao(s), idDaRota(reg), await this.apoio.liberacao(s));
    const pac = await fonteAtendimentosPa(this.atendimento).pacienteDoAtendimento(s.porta, r.atendimento.reg);
    // Leitura de prontuário (o histórico da classificação): parte e quantidade, nunca o conteúdo.
    req.sghAlvo = {
      ...(pac ? { paciente: pac.id } : {}),
      tabelaAlvo: TABELA,
      chaveNaturalAlvo: `parte:classificacao;historico:${r.historico.length}`,
    };
    return r;
  }

  // ── Classificar, reclassificar e os sinais do técnico ───────────────────────────────────────────

  private async gravarClassificacao(
    s: SessaoCadastro,
    req: RequisicaoAutorizada,
    e: ReturnType<typeof esquemaClassificarRisco.parse> | ReturnType<typeof esquemaReclassificarRisco.parse>,
    reclassificacao: boolean,
  ): Promise<ResultadoClassificacao> {
    await this.apoio.exigirLiberacao(s);
    const sv = this.servico(s);
    const p = await sv.preparar(this.sessao(s), e, reclassificacao);
    const evento = reclassificacao
      ? EVENTOS_AUDITAVEIS.classificacaoReclassificada.codigo
      : EVENTOS_AUDITAVEIS.classificacaoConcluida.codigo;
    const chave = `${p.linha.reg}:${p.linha.motivo}:${p.linha.corFinal}`;
    const avisos: string[] = [];
    let id: number | null = null;
    const form = await sv.formularioLigado();
    // Regra 3: a cor diferente da proposta gera o evento próprio (sem dado clínico: atendimento, cores e versão), na
    // MESMA transação da classificação (sem trilha, sem dado): se a trilha falhar, nada fica gravado.
    const eventoSobreposta = EVENTOS_AUDITAVEIS.classificacaoCorSobreposta.codigo;
    const chaveSobreposta = `${p.linha.reg}:${p.linha.corProposta}>${p.linha.corFinal}`;
    if (form.ligado && sv.gravadorFormulario) {
      // O formulário do prontuário e a classificação na MESMA transação (receita do M22, trilha dupla do executor);
      // os eventos próprios da classificação vão à trilha dentro dela.
      const eventos = [
        { evento, chave },
        ...(p.sobreposta ? [{ evento: eventoSobreposta, chave: chaveSobreposta }] : []),
      ];
      const g = await sv.gravadorFormulario
        .gravar({
          paciente: p.pac.id,
          cabecalho: p.linha.cabecalho,
          reg: p.linha.reg,
          cor: p.linha.corFinal,
          conteudo: p.conteudo,
          sinais: e.sinais,
          queixa: e.queixa,
          observacoes: e.observacoes ?? null,
          alergia: e.alergia ?? null,
          comorbidades: e.comorbidades ?? [],
          classificacao: {
            versaoProtocolo: p.linha.versaoProtocolo,
            fluxograma: p.linha.fluxograma,
            discriminadores: p.linha.discriminadores,
            automaticos: p.linha.automaticos,
            corProposta: p.linha.corProposta,
            corFinal: p.linha.corFinal,
            justificativa: p.linha.justificativa,
            motivo: p.linha.motivo,
            descricaoMudanca: p.linha.descricaoMudanca,
            anterior: p.linha.anterior,
            tempoAlvoMin: p.linha.tempoAlvoMin,
            eventos,
          },
        })
        .catch((x: unknown) => {
          throw problemaDoCadastro(x);
        });
      if (!g.comPrioridade)
        avisos.push(
          'A cor não tem opção equivalente de "Prioridade clínica" no formulário do prontuário: lá o registro aparece sem prioridade.',
        );
    } else {
      const r = await this.apoio.gravar(
        s,
        evento,
        reclassificacao ? 'recepcao.classificacao.reclassificar' : 'recepcao.classificacao.criar',
        (x: { id: number }) => ({ tabela: TABELA, id: String(x.id), paciente: p.pac.id, chave }),
        async (g) => {
          const x = await g.classificar({ ...p.linha, e08: { situacao: 'desligado' } });
          if (p.sobreposta)
            await g.registrarEvento(
              trilhaDaSessao(s, eventoSobreposta, 'recepcao.classificacao', {
                tabela: TABELA,
                id: x.id,
                paciente: p.pac.id,
                chave: chaveSobreposta,
              }),
            );
          return x;
        },
      );
      id = r.id;
      avisos.push(form.motivo ?? 'A classificação fica só neste sistema.');
    }
    this.avisos?.avisar(s.hospital);
    const l = await sv.classificacaoGravada(s.porta, p.linha.cabecalho, id);
    const cl = resumoDe(l, p.conteudo);
    void req;
    return {
      classificacao: cl,
      mensagem: `${reclassificacao ? 'Reclassificado' : 'Classificado'}: ${ROTULO_COR.get(cl.cor) ?? cl.cor} (${cl.nomeCor}), atendimento médico em até ${cl.tempoAlvoMin} min.`,
      avisos,
    };
  }

  @Post('classificacao/:reg')
  @HttpCode(201)
  @Permissao('recepcao.classificacao.criar')
  @AuditadoNoHandler(
    'recepcao.classificarRisco: classificacao_risco e trilha_auditoria na mesma transação (ou o E08)',
  )
  classificar(
    @Param('reg') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoClassificacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaClassificarRisco, { ...(b as object), atendimento: idDaRota(reg) });
    return this.gravarClassificacao(s, req, e, false);
  }

  @Post('classificacao/:reg/reclassificar')
  @HttpCode(201)
  @Permissao('recepcao.classificacao.reclassificar')
  @AuditadoNoHandler('recepcao.reclassificarRisco: classificacao_risco e trilha_auditoria na mesma transação')
  reclassificar(
    @Param('reg') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoClassificacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaReclassificarRisco, { ...(b as object), atendimento: idDaRota(reg) });
    return this.gravarClassificacao(s, req, e, true);
  }

  @Post('classificacao/:reg/sinais')
  @HttpCode(201)
  @Permissao('recepcao.classificacao.registrarSinais')
  @AuditadoNoHandler('sinais da classificação (afericao) e trilha_auditoria na mesma transação')
  async sinais(
    @Param('reg') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ registrados: number; mensagem: string }> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarSinaisTriagem, { ...(b as object), atendimento: idDaRota(reg) });
    await this.apoio.exigirLiberacao(s);
    const sv = this.servico(s);
    const { a, pac } = await sv.prepararSinais(this.sessao(s), e.atendimento);
    if (Object.values(e.sinais).every((v) => v === null))
      throw new ErroProblema('entrada-invalida', 400, 'Sem sinais', 'Registre ao menos um sinal vital.', {
        campos: ['sinais'],
      });
    const n = await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.enfermagemSinalRegistrado.codigo,
      'recepcao.classificacao.registrarSinais',
      { tabela: 'afericao', paciente: pac.id, chave: `${a.x.reg}:triagem` },
      (g) =>
        g.registrarSinais({
          cabecalho: a.x.cabecalho,
          paciente: pac.id,
          sinais: { ...e.sinais },
          horaSinais: a.agora,
          autor: s.login,
        }),
    );
    this.avisos?.avisar(s.hospital);
    return {
      registrados: n,
      mensagem: `Sinais vitais registrados (${n}). A classificação continua pendente.`,
    };
  }

  // ── Protocolos ─────────────────────────────────────────────────────────────────────────────────

  @Get('protocolos')
  @Permissao('recepcao.protocolo.ler')
  versoes(@Req() req: RequisicaoAutorizada): Promise<VersaoProtocoloResumo[]> {
    const s = sessaoDe(req);
    return this.servico(s).versoes(s.porta);
  }

  @Get('protocolos/:id')
  @Permissao('recepcao.protocolo.ler')
  versao(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ProtocoloComConteudo> {
    const s = sessaoDe(req);
    return this.servico(s).versao(s.porta, idDaRota(id));
  }

  @Post('protocolos/simular')
  @HttpCode(200)
  @Permissao('recepcao.protocolo.ler')
  @AuditadoNoHandler('o simulador não grava nem lê paciente: a proposta do motor sobre o conteúdo enviado')
  async simular(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSimulacaoProtocolo> {
    const s = sessaoDe(req);
    const e = corpo(esquemaSimularProtocolo, b);
    const { hoje } = await this.porta.relogio(s.porta);
    return this.servico(s).simular(e, { hoje, autor: s.login });
  }

  @Post('protocolos')
  @HttpCode(201)
  @Permissao('recepcao.protocolo.publicar')
  @AuditadoNoHandler(
    'recepcao.publicarProtocoloClassificacao: protocolo_classificacao_risco_versao e trilha_auditoria na mesma transação',
  )
  async publicar(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number; protocolo: number; versao: number; mensagem: string }> {
    const s = sessaoDe(req);
    const e = corpo(esquemaPublicarProtocoloClassificacao, b);
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário.',
      );
    await reautenticar(this.sessoes, this.resolvedor, req, e.senha);
    const autor = await this.conferirAutor(s, e.autor);
    const r = await this.servico(s).publicar(this.sessao(s), { ...e, autor }, (fn) =>
      this.apoio.gravar(
        s,
        EVENTOS_AUDITAVEIS.classificacaoProtocoloPublicado.codigo,
        'recepcao.protocolo.publicar',
        (x: { id: number; protocolo: number; versao: number }) => ({
          tabela: 'protocolo_classificacao_risco_versao',
          id: String(x.id),
          chave: `${x.protocolo}:v${x.versao}`,
        }),
        fn,
      ),
    );
    return { ...r, mensagem: `Versão ${r.versao} publicada: vale para as classificações novas.` };
  }

  /** Regra 2 (autor ≠ aprovador) de verdade: o autor conferido no servidor (ver `conferirAutorDoProtocolo`). */
  private conferirAutor(s: SessaoCadastro, digitado: string): Promise<string> {
    return conferirAutorDoProtocolo(this.sessoes, s, digitado);
  }

  @Get('cores-legado')
  @Permissao('recepcao.protocolo.ler')
  async coresAnteriores(@Req() req: RequisicaoAutorizada): Promise<CorLegadoConsulta[]> {
    const s = sessaoDe(req);
    const cores = await this.porta.coresAnteriores(s.porta);
    return cores.map((c) => ({
      ...c,
      corEquivalente:
        c.codigoProtocolo >= 1 && c.codigoProtocolo <= 5 ? CORES_RISCO[c.codigoProtocolo - 1]!.codigo : null,
    }));
  }
}

/**
 * Regra 2 (autor ≠ aprovador) de verdade: o autor é um usuário existente, ativo, não bloqueado e de grupo ativo
 * deste estabelecimento (a mesma conferência da conta-alvo do suporte) e que lê protocolos
 * (`recepcao.protocolo.ler` pelas permissões efetivas dele). Devolve o login como o cadastro guarda.
 */
export async function conferirAutorDoProtocolo(
  sessoes: ServicoSessao | null,
  s: SessaoCadastro,
  digitado: string,
): Promise<string> {
  const recusa = (codigo: string, detalhe: string) =>
    new ErroProblema('recusa-de-negocio', 422, 'Versão não publicada', detalhe, {
      codigo,
      campos: ['autor'],
    });
  const autorizacao = sessoes?.servicoAutorizacao;
  if (!sessoes || !autorizacao)
    throw new ErroProblema(
      'indisponivel',
      503,
      'Conferência do autor indisponível',
      'Não foi possível conferir o autor da versão agora. Tente de novo em instantes.',
    );
  let login: string;
  try {
    login = (await sessoes.conferirAlvoComo(s.hospital, digitado.trim().toUpperCase(), s.rede)).login;
  } catch (erro) {
    if (erro instanceof ErroSessao && erro.tipo === 'indisponivel')
      throw new ErroProblema(
        'indisponivel',
        503,
        'Conferência do autor indisponível',
        'Não foi possível conferir o autor da versão agora. Tente de novo em instantes.',
      );
    throw recusa(
      'autor-invalido',
      'O autor tem de ser um usuário ativo deste estabelecimento, diferente de quem publica.',
    );
  }
  const a = await autorizacao.obter(s.rede, s.hospital, login);
  if (!a.permissoes.includes('recepcao.protocolo.ler'))
    throw recusa('autor-sem-permissao', 'O autor tem de ter acesso aos protocolos de classificação.');
  return login;
}

/** O risco do quadro do PA (M20) pela classificação (FONTE_RISCO_PA). */
export function fonteRiscoPa(porta: PortaClassificacao, atendimento: PortaAtendimento) {
  const sv = new ServicoClassificacao(porta, fonteAtendimentosPa(atendimento));
  const gerenciados = new ServicoProtocoloGerenciado(porta, fonteAtendimentosPa(atendimento));
  return {
    async riscos(
      c: { rede: string; hospital: string },
      itens: Parameters<ServicoClassificacao['riscosDoQuadro']>[1],
      opcoes: { readonly protocolos: boolean } = { protocolos: false },
    ) {
      // M44 (etapa 3): o relógio dos protocolos gerenciados no cartão (indisponível: o quadro segue só com a cor). Só
      // para a sessão com `recepcao.protocoloPaciente.ler` (revisão do M44.3); sem ela, nem lê.
      const [r, protocolos] = await Promise.all([
        sv.riscosDoQuadro(c, itens),
        opcoes.protocolos
          ? gerenciados.noQuadro(c, itens).catch(() => undefined)
          : Promise.resolve(undefined),
      ]);
      return { ...r, ...(protocolos ? { protocolos } : {}) };
    },
  };
}

export { encerradoNoPa };
