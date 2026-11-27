// Regras dos registros clínicos na API (M22): a representação do modelo (parser DFM do M09, em cache pelo selo),
// a visão do formulário para o renderizador, o pré-preenchimento (MANTERHIST), o rascunho, a montagem do registro
// pelo gravador de @sgh/dominio-pep (linhas, texto formatado, formulário e documento, CONFERIDOS pela conferência
// cruzada antes de ir ao executor), a visualização com a prova e a suspensão. Nada aqui conhece tabela do legado:
// os dados vêm da porta; as regras, do domínio.
import {
  type AtendimentoRegistro,
  type CampoRegistro,
  contagemAgregada,
  type FormularioRegistro,
  type HistoricoPergunta,
  type ModeloAdmin,
  type ModeloAdminDetalhe,
  type ModeloImpressao,
  marcaSuporteTecnico,
  modeloForaDaLiberacao,
  NENHUM_MODELO_FORA,
  type ModelosForaDaLiberacao,
  type ModeloRegistro,
  type RascunhoResumo,
  type RegistrarEvolucaoEntrada,
  type RegistroVisualizado,
  type RespostaRegistro,
  type SalvarRascunhoEntrada,
  type SituacaoModelo,
} from '@sgh/contratos';
import {
  avaliarFormulario,
  bloqueiosDoModelo,
  type CabecalhoDocumento,
  camposParaRegistro,
  camposParaVisualizar,
  comoLidas,
  conferirGravado,
  conferirHorario,
  converterModelo,
  ErroGravacao,
  hashDoConteudo,
  type ItemFormulario,
  linhasDasRespostas,
  MENSAGENS_HORARIO,
  montarRegistro,
  pendenciasParaFinalizar,
  planos,
  preencherPeloHistorico,
  type RepresentacaoFormulario,
  respostasDasLinhas,
  taxaIgualdade,
  TEXTO_SIGILO,
} from '@sgh/dominio-pep';
import type { ContextoOperacao } from '@sgh/nucleo';
import {
  type CabecalhoDocumentoLido,
  type DescarteRascunho,
  type GravacaoEvolucao,
  type GravacaoRascunho,
  type LinhaGravacao,
  MARCADOR_REGISTRO,
  type ModeloDoRegistro,
  modeloPermitido,
  type ProfissionalDoRegistro,
  type RascunhoLido,
  SITUACAO_LANCADO,
  SITUACAO_SUSPENSO,
  type SuspensaoEvolucao,
} from './tipos-pep.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoRegistro, PortaRegistro } from './registro-porta.js';

export const TTL_REPRESENTACAO_REGISTRO_MS = 10 * 60_000;

interface ModeloConvertido {
  readonly representacao: RepresentacaoFormulario;
  readonly selo: string;
  readonly versaoLayout: number | null;
}

class CacheCurto<T> {
  private readonly mapa = new Map<string, { em: number; valor: Promise<T> }>();
  constructor(
    private readonly ttl: number,
    private readonly agora: () => number = Date.now,
  ) {}
  obter(chave: string, carregar: () => Promise<T>): Promise<T> {
    const x = this.mapa.get(chave);
    if (x && this.agora() - x.em < this.ttl) return x.valor;
    const valor = carregar().catch((e: unknown) => {
      this.mapa.delete(chave);
      throw e;
    });
    this.mapa.set(chave, { em: this.agora(), valor });
    if (this.mapa.size > 500) {
      const primeira = this.mapa.keys().next().value;
      if (primeira !== undefined) this.mapa.delete(primeira);
    }
    return valor;
  }
}

export interface OpcoesFormulario {
  readonly liberados: ReadonlySet<string>;
  /** Os modelos fora da liberação do cliente (parâmetro pep.evolucao.modelosForaDaLiberacao). */
  readonly fora?: ModelosForaDaLiberacao;
  readonly toleranciaMin: number;
  readonly login: string;
  readonly rascunho?: number;
  readonly atendimento?: number;
}

const MOTIVOS_SITUACAO: Readonly<Record<Exclude<SituacaoModelo, 'liberado'>, string>> = {
  desligado:
    'Este modelo ainda não está liberado para registro neste estabelecimento; a liberação é feita modelo a modelo pela administração do PEP, depois da conferência dos chave-usuários.',
  'nao-permitido': 'Este modelo não está liberado para a sua especialidade.',
  descontinuado:
    'Modelo aposentado: os registros antigos continuam no prontuário, mas não se registra mais nele.',
  ambiguo:
    'Este modelo tem pergunta com a lista de escolhas a confirmar pela comissão de prontuário (DP-28): fica só em consulta.',
};

const iso = (s: string | null) => s;

function uso(n: number): ModeloRegistro['usoRecente'] {
  return contagemAgregada(n);
}

/** Erro do gravador → Problem Details (422 com o campo). */
function problemaDoGravador(e: unknown): never {
  if (e instanceof ErroGravacao)
    throw new ErroProblema('entrada-invalida', 422, 'Resposta inválida', e.message, {
      codigo: e.codigo,
      ...(e.vinculo !== null ? { campos: [String(e.vinculo)] } : {}),
    });
  throw e;
}

export class ServicoRegistro {
  private readonly modelosCache = new CacheCurto<ModeloConvertido | null>(TTL_REPRESENTACAO_REGISTRO_MS);
  private readonly listaCache = new CacheCurto<ModeloDoRegistro[]>(TTL_REPRESENTACAO_REGISTRO_MS);

  constructor(private readonly porta: PortaRegistro) {}

  get destino(): 'proprio' | 'memoria' {
    return this.porta.destino;
  }

  // ── Passagem à porta (leitura do profissional, passo 0 e gravações pelo executor) ─────────────────

  profissional(c: ContextoRegistro, login: string): Promise<ProfissionalDoRegistro | null> {
    return this.porta.profissional(c, login);
  }

  podeGravar(c: ContextoRegistro, operacao: string, login: string) {
    return this.porta.podeGravar(c, operacao, login);
  }

  salvarRascunho(c: ContextoRegistro, e: GravacaoRascunho, ctx: ContextoOperacao) {
    return this.porta.salvarRascunho(c, e, ctx);
  }

  registrar(c: ContextoRegistro, e: GravacaoEvolucao, ctx: ContextoOperacao) {
    return this.porta.registrar(c, e, ctx);
  }

  descartar(c: ContextoRegistro, e: DescarteRascunho, ctx: ContextoOperacao) {
    return this.porta.descartarRascunho(c, e, ctx);
  }

  suspender(c: ContextoRegistro, e: SuspensaoEvolucao, ctx: ContextoOperacao) {
    return this.porta.suspender(c, e, ctx);
  }

  async impressao(
    c: ContextoRegistro,
  ): Promise<{ fichas: ModeloImpressao[]; relatorios: ModeloImpressao[] }> {
    const r = await this.porta.modelosImpressao(c);
    return {
      fichas: r.fichas.map((f) => ({
        id: f.id,
        nome: f.nome ?? f.componente,
        tipo: f.tipo === null ? null : String(f.tipo),
        ativo: null,
      })),
      relatorios: r.relatorios.map((x) => ({
        id: x.id,
        nome: x.nome,
        tipo: 'modelo de relatório',
        ativo: null,
      })),
    };
  }

  modelos(c: ContextoRegistro): Promise<ModeloDoRegistro[]> {
    return this.listaCache.obter(`${c.rede}:${c.hospital}`, () => this.porta.modelos(c));
  }

  /** Representação do modelo (DFM convertido na hora, em cache pelo selo: o Delphi mudou o modelo, muda o selo). */
  async representacao(c: ContextoRegistro, modelo: number): Promise<ModeloConvertido | null> {
    const selo = await this.porta.selo(c, modelo);
    return this.modelosCache.obter(`${c.rede}:${c.hospital}:${modelo}:${selo}`, async () => {
      const def = await this.porta.definicao(c, modelo);
      if (!def) return null;
      const representacao = await converterModelo(def);
      const versoes = def.versoes.map((v) => v.versao);
      return { representacao, selo, versaoLayout: versoes.length ? Math.max(...versoes) : null };
    });
  }

  private situacao(
    m: ModeloDoRegistro,
    prof: ProfissionalDoRegistro | null,
    liberados: ReadonlySet<string>,
    ambiguo = false,
    fora: string | null = null,
  ): { situacao: SituacaoModelo; motivo: string | null } {
    let s: SituacaoModelo = 'liberado';
    if (m.aposentado) s = 'descontinuado';
    else if (!prof || !modeloPermitido(m, prof)) s = 'nao-permitido';
    // POL-3: o modelo fora da liberação (conferência abaixo da meta ou componente que o novo não grava) fica
    // desligado com o motivo, mesmo que o parâmetro o liste.
    else if (fora) return { situacao: 'desligado', motivo: fora };
    else if (!m.codigo || !liberados.has(m.codigo)) s = 'desligado';
    else if (ambiguo) s = 'ambiguo';
    return { situacao: s, motivo: s === 'liberado' ? null : MOTIVOS_SITUACAO[s] };
  }

  private modeloRegistro(
    m: ModeloDoRegistro,
    prof: ProfissionalDoRegistro | null,
    liberados: ReadonlySet<string>,
    ambiguo = false,
    fora: string | null = null,
  ): ModeloRegistro {
    return {
      id: m.id,
      codigo: m.codigo,
      nome: m.nome,
      ...this.situacao(m, prof, liberados, ambiguo, fora),
      usoRecente: uso(m.usoRecente),
    };
  }

  /** Modelos para o profissional (os liberados primeiro, por uso), com a situação e o motivo. */
  async modelosParaRegistro(
    c: ContextoRegistro,
    prof: ProfissionalDoRegistro | null,
    liberados: ReadonlySet<string>,
    fora: ModelosForaDaLiberacao = NENHUM_MODELO_FORA,
  ): Promise<ModeloRegistro[]> {
    const ordem: Record<SituacaoModelo, number> = {
      liberado: 0,
      ambiguo: 1,
      desligado: 2,
      'nao-permitido': 3,
      descontinuado: 4,
    };
    return (await this.modelos(c))
      .map((m) => ({
        m,
        r: this.modeloRegistro(m, prof, liberados, false, modeloForaDaLiberacao(m.codigo, fora)),
      }))
      .sort(
        (a, b) =>
          ordem[a.r.situacao] - ordem[b.r.situacao] || b.m.usoRecente - a.m.usoRecente || a.m.id - b.m.id,
      )
      .map((x) => x.r);
  }

  private resumoRascunho(r: RascunhoLido, prof: ProfissionalDoRegistro | null): RascunhoResumo {
    // Só leitura: de outro profissional. O rascunho importado (sem a marca de origem desta casa; ADR 0006, importação é
    // continuidade) é um rascunho normal do autor: ele o vê, edita, finaliza ou descarta; outro profissional, não.
    const importado = !r.doNovo;
    return {
      id: r.id,
      paciente: r.paciente,
      pacienteNome: r.pacienteNome,
      modelo: r.modelo,
      modeloCodigo: r.modeloCodigo,
      modeloNome: r.modeloNome,
      atendimento: r.atendimento,
      dataHoraClinica: iso(r.dataHoraClinica),
      atualizadoEm: iso(r.lancadoEm),
      versao: r.versao,
      somenteLeitura: !prof || !prof.cbos.includes(r.cbo),
      importado,
      corrige: r.corrige,
      respostas: r.respostas,
    };
  }

  async rascunhos(c: ContextoRegistro, prof: ProfissionalDoRegistro | null): Promise<RascunhoResumo[]> {
    if (!prof) return [];
    return (await this.porta.rascunhosDoProfissional(c, prof.cbos)).map((r) => this.resumoRascunho(r, prof));
  }

  private async modeloOu404(
    c: ContextoRegistro,
    modelo: number,
  ): Promise<{ m: ModeloDoRegistro; conv: ModeloConvertido }> {
    const m = (await this.modelos(c)).find((x) => x.id === modelo);
    const conv = m ? await this.representacao(c, modelo) : null;
    if (!m || !conv) throw new ErroProblema('nao-encontrado', 404, 'Modelo não encontrado');
    return { m, conv };
  }

  async atendimentos(c: ContextoRegistro, paciente: number): Promise<AtendimentoRegistro[]> {
    // A porta devolve se o atendimento está em curso (situação, saída e alta): sem janela de dias desde a entrada.
    // O contrato da tela ainda distingue só internação × externo (pedido do lote 01-06 para levar o tipo completo).
    return (await this.porta.atendimentos(c, paciente)).map((a) => ({
      id: a.id,
      numero: a.numero,
      tipo: a.tipo === 'internacao' ? ('internacao' as const) : ('externo' as const),
      entrada: a.entrada,
      unidade: a.unidade,
      leito: a.leito,
      aberto: a.aberto,
    }));
  }

  /** O formulário para registrar: a visão, o pré-preenchimento, os rascunhos do paciente e os atendimentos. */
  async formulario(
    c: ContextoRegistro,
    paciente: number,
    modelo: number,
    prof: ProfissionalDoRegistro | null,
    o: OpcoesFormulario,
    gravacao: { pode: boolean; motivo: string | null },
  ): Promise<FormularioRegistro> {
    const { m, conv } = await this.modeloOu404(c, modelo);
    const campos = camposParaRegistro(conv.representacao);
    const bloqueios = bloqueiosDoModelo(campos);
    const fora = motivoDoFormulario(m, campos, o.fora);
    const modeloReg = this.modeloRegistro(m, prof, o.liberados, false, fora);
    const rascunhos = (await this.porta.rascunhosDoPaciente(c, paciente, modelo)).map((r) =>
      this.resumoRascunho(r, prof),
    );
    let rascunho: FormularioRegistro['rascunho'] = null;
    if (o.rascunho !== undefined) {
      const lido = await this.porta.lerRascunho(c, o.rascunho);
      if (!lido || lido.rascunho.paciente !== paciente || lido.rascunho.modelo !== modelo)
        throw new ErroProblema('nao-encontrado', 404, 'Rascunho não encontrado');
      rascunho = {
        resumo: this.resumoRascunho(lido.rascunho, prof),
        respostas: respostasDasLinhas(conv.representacao, lido.linhas, { soAtivos: true }).respostas,
      };
    }
    const ultimo = await this.porta.ultimoRegistro(c, paciente, modelo);
    const daUltima = ultimo
      ? respostasDasLinhas(conv.representacao, ultimo.linhas, { soAtivos: true }).respostas
      : [];
    const jaRespondidas = new Set((rascunho?.respostas ?? []).map((r) => r.vinculo));
    const preenchidos = preencherPeloHistorico(
      campos,
      daUltima.filter((r) => !jaRespondidas.has(r.vinculo)),
    );
    const avisos: string[] = [];
    if (bloqueios.ambiguas > 0)
      avisos.push(
        `${bloqueios.ambiguas} pergunta(s) com a lista de escolhas a confirmar (DP-28): aparecem só para leitura e não são gravadas.`,
      );
    if (planos(campos).some((x) => x.regraPendente))
      avisos.push(
        'Há regra de habilitar ou calcular que não foi convertida: o campo fica sempre habilitado.',
      );
    const deOutro = rascunhos.filter((r) => r.somenteLeitura).length;
    if (deOutro > 0)
      avisos.push(
        `Há ${deOutro} rascunho(s) deste formulário para este paciente feitos por outro profissional (só leitura).`,
      );

    const pode = gravacao.pode && modeloReg.situacao === 'liberado' && prof !== null;
    return {
      modelo: modeloReg,
      impressao: conv.representacao.impressaoLayout,
      campos,
      preenchidos,
      rascunhos,
      rascunho,
      atendimentos: await this.atendimentos(c, paciente),
      toleranciaRetroativoMin: o.toleranciaMin,
      agora: (await this.porta.agora(c)).slice(0, 16),
      gravacao: {
        pode,
        motivo: pode
          ? null
          : !prof
            ? 'Só o profissional com ocupação ativa no cadastro registra no prontuário.'
            : (modeloReg.motivo ?? gravacao.motivo),
      },
      avisos,
    };
  }

  async historico(
    c: ContextoRegistro,
    paciente: number,
    modelo: number,
    vinculo: number,
  ): Promise<HistoricoPergunta> {
    const { conv } = await this.modeloOu404(c, modelo);
    const item = itemDoVinculo(conv.representacao, vinculo);
    if (!item) throw new ErroProblema('nao-encontrado', 404, 'Pergunta não encontrada');
    const lidos = await this.porta.historico(c, paciente, modelo, item['x-legacy'].ordem);
    const so = { itens: [item] };
    const valores: HistoricoPergunta['valores'] = [];
    for (const h of lidos) {
      const r = respostasDasLinhas(so, h.linhas).respostas.find((x) => x.vinculo === vinculo);
      if (r) valores.push({ registro: h.registro, dataHora: h.dataHora, valor: textoDaResposta(r) });
    }
    return { vinculo, valores };
  }

  /** Atendimento do paciente e os retratos vigentes (o Delphi aponta os vigentes ao gravar). */
  private async retratos(c: ContextoRegistro, paciente: number, atendimento: number) {
    const r = await this.porta.retratos(c, atendimento, paciente);
    if (!r || !r.doPaciente)
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Atendimento inválido',
        'Escolha um atendimento deste paciente.',
        {
          codigo: 'atendimento-de-outro-paciente',
        },
      );
    return { htAtendimento: r.htAtendimento, htPaciente: r.htPaciente };
  }

  private exigirProfissional(prof: ProfissionalDoRegistro | null): ProfissionalDoRegistro {
    if (!prof)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem ocupação no cadastro de profissionais',
        'Só o profissional com ocupação ativa no cadastro registra no prontuário.',
        { codigo: 'profissional-sem-cbo' },
      );
    return prof;
  }

  private exigirLiberado(
    m: ModeloDoRegistro,
    prof: ProfissionalDoRegistro,
    liberados: ReadonlySet<string>,
    campos: readonly CampoRegistro[],
    fora: ModelosForaDaLiberacao = NENHUM_MODELO_FORA,
  ): void {
    const s = this.situacao(m, prof, liberados, false, motivoDoFormulario(m, campos, fora));
    if (s.situacao !== 'liberado')
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Modelo não liberado para registro',
        s.motivo ?? undefined,
        {
          codigo: `modelo-${s.situacao}`,
        },
      );
  }

  /** Rascunho → entrada do adaptador (linhas pelo gravador; o rascunho aceita incompleto e sem confirmação). */
  async montarRascunho(
    c: ContextoRegistro,
    e: SalvarRascunhoEntrada,
    prof0: ProfissionalDoRegistro | null,
    liberados: ReadonlySet<string>,
    fora: ModelosForaDaLiberacao = NENHUM_MODELO_FORA,
  ): Promise<GravacaoRascunho> {
    const prof = this.exigirProfissional(prof0);
    const { m, conv } = await this.modeloOu404(c, e.modelo);
    this.exigirLiberado(m, prof, liberados, camposParaRegistro(conv.representacao), fora);
    let linhas: LinhaGravacao[];
    try {
      linhas = linhasDasRespostas(conv.representacao, e.respostas).linhas.map(paraLinhaGravacao);
    } catch (x) {
      problemaDoGravador(x);
    }
    const cbo = e.rascunho ? await this.cboDoRascunho(c, e.rascunho.id, prof, e) : prof.cbo;
    if (e.corrige !== undefined) await this.exigirCorrigivel(c, e.corrige, e, cbo);
    return {
      paciente: e.paciente,
      modelo: e.modelo,
      atendimento: e.atendimento,
      cbo,
      dataHoraClinica: e.dataHoraClinica,
      ...(e.justificativaRetroativo ? { justificativaRetroativo: e.justificativaRetroativo } : {}),
      retratos: await this.retratos(c, e.paciente, e.atendimento),
      linhas,
      ...(e.rascunho ? { rascunho: e.rascunho } : {}),
      ...(e.corrige !== undefined ? { corrige: e.corrige } : {}),
    };
  }

  /**
   * O rascunho de origem pode receber esta gravação? Aberto (o importado também: é rascunho do autor, ADR 0006),
   * de um CBO do profissional, do mesmo paciente, modelo e atendimento. Devolve o CBO DO RASCUNHO (o autor dele é
   * o autor do registro; o profissional com mais de um CBO não troca de CBO no meio). A receita confere de novo.
   */
  private async cboDoRascunho(
    c: ContextoRegistro,
    id: number,
    prof: ProfissionalDoRegistro,
    de: { readonly paciente?: number; readonly modelo?: number; readonly atendimento?: number },
  ): Promise<number> {
    const lido = await this.porta.lerRascunho(c, id);
    if (!lido) throw new ErroProblema('nao-encontrado', 404, 'Rascunho não encontrado');
    const r = lido.rascunho;
    const recusar = (codigo: string, detalhe: string, status = 409): never => {
      throw new ErroProblema('recusa-de-negocio', status, 'Rascunho não disponível', detalhe, { codigo });
    };
    if (lido.substituido)
      recusar(
        'conflito-versao',
        'O rascunho foi salvo de novo em outro terminal ou sistema depois que você o abriu. Abra de novo para continuar.',
      );
    if (!lido.aberto)
      recusar('rascunho-fechado', 'O rascunho já foi finalizado ou descartado em outro terminal ou sistema.');
    if (!prof.cbos.includes(r.cbo))
      recusar('rascunho-de-outro', 'Rascunho de outro profissional: aqui ele é só para leitura.');
    if (
      (de.paciente !== undefined && r.paciente !== de.paciente) ||
      (de.modelo !== undefined && r.modelo !== de.modelo)
    )
      recusar('rascunho-de-outro-formulario', 'O rascunho é de outro paciente ou formulário.');
    if (de.atendimento !== undefined && r.atendimento !== de.atendimento)
      recusar(
        'rascunho-de-outro-atendimento',
        'O rascunho é de outro atendimento deste paciente: continue-o no atendimento dele.',
        422,
      );
    return r.cbo;
  }

  /** CBO para descartar o rascunho (o dele, se for do profissional; o importado também). */
  cboParaDescartar(c: ContextoRegistro, id: number, prof: ProfissionalDoRegistro): Promise<number> {
    return this.cboDoRascunho(c, id, prof, {});
  }

  /**
   * Correção (cap-05b §5.6; 844 de 844 assim no legado): o original é deste paciente e modelo, já está suspenso e
   * é do mesmo autor (o mesmo CBO). A receita confere de novo na transação.
   */
  private async exigirCorrigivel(
    c: ContextoRegistro,
    corrige: number,
    e: { readonly paciente: number; readonly modelo: number },
    cbo: number,
  ): Promise<void> {
    const o = await this.porta.cabecalhoRegistro(c, corrige);
    const recusar = (codigo: string, detalhe: string): never => {
      throw new ErroProblema('entrada-invalida', 422, 'Correção não permitida', detalhe, {
        codigo,
        campos: ['corrige'],
      });
    };
    if (!o || o.paciente !== e.paciente)
      recusar('correcao-de-outro-paciente', 'O registro corrigido não é deste paciente.');
    if (o!.modelo !== e.modelo)
      recusar('correcao-de-outro-modelo', 'A correção é feita no mesmo modelo do registro corrigido.');
    if (o!.suspensoEm === null)
      recusar(
        'correcao-sem-suspensao',
        'Suspenda o registro com a justificativa antes de registrar a correção.',
      );
    if (o!.cbo !== cbo)
      recusar('correcao-por-outro', 'Só o autor do registro suspenso registra a correção dele.');
  }

  /**
   * Finalização → entrada do adaptador: obrigatórios (só os do vínculo, habilitados), pré-preenchidos
   * confirmados, horário (regra 10), linhas, texto formatado, formulário e documento pelo gravador e a
   * CONFERÊNCIA CRUZADA do montado (100%: o que vai ao banco lido pelo leitor do M15 dá o formulário gravado).
   */
  async montarEvolucao(
    c: ContextoRegistro,
    e: RegistrarEvolucaoEntrada,
    prof0: ProfissionalDoRegistro | null,
    opcoes: {
      readonly liberados: ReadonlySet<string>;
      /** Os modelos fora da liberação do cliente (parâmetro pep.evolucao.modelosForaDaLiberacao). */
      readonly fora?: ModelosForaDaLiberacao;
      readonly toleranciaMin: number;
      readonly paciente: { idade: number | null; sexo: 'F' | 'M' | null };
      /** Sessão "como" do suporte técnico (ADR 0021, R1): a marca vai à prova do documento. */
      readonly comoSuporte?: boolean;
      /** M23: o pedido de parecer (vai à fila) ou a resposta a um parecer da fila, na mesma transação. */
      readonly fluxo?: GravacaoEvolucao['fluxo'];
      /** M23 (regra 3): o pedido de coassinatura do preceptor, na mesma transação. */
      readonly supervisao?: GravacaoEvolucao['supervisao'];
    },
  ): Promise<{ gravacao: GravacaoEvolucao; avisos: string[] }> {
    const prof = this.exigirProfissional(prof0);
    const { m, conv } = await this.modeloOu404(c, e.modelo);
    this.exigirLiberado(m, prof, opcoes.liberados, camposParaRegistro(conv.representacao), opcoes.fora);
    const rep = conv.representacao;
    // O autor é o do rascunho (o CBO dele, conferido como do profissional); sem rascunho, o CBO do PEP.
    const cbo = e.rascunho ? await this.cboDoRascunho(c, e.rascunho.id, prof, e) : prof.cbo;
    if (e.corrige !== undefined) await this.exigirCorrigivel(c, e.corrige, e, cbo);
    if (rep.impressaoLayout !== e.impressao)
      throw new ErroProblema(
        'conflito-de-versao',
        409,
        'Formulário alterado',
        'O modelo do formulário mudou depois que você o abriu. Abra de novo (as respostas do rascunho são mantidas).',
        { codigo: 'formulario-mudou' },
      );
    const campos = camposParaRegistro(rep);
    const agora = await this.porta.agora(c);
    const estado = avaliarFormulario(campos, e.respostas, opcoes.paciente, agora.slice(0, 10));
    const pend = pendenciasParaFinalizar(campos, e.respostas, estado);
    if (pend.length > 0)
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Faltam respostas para finalizar',
        pend
          .map((p) =>
            p.motivo === 'obrigatorio' ? `Responda: ${p.titulo}.` : `Confirme o valor trazido: ${p.titulo}.`,
          )
          .join(' '),
        { codigo: 'pendencias', campos: pend.map((p) => String(p.vinculo)) },
      );
    const h = conferirHorario({
      clinica: e.dataHoraClinica,
      agora,
      toleranciaMin: opcoes.toleranciaMin,
      justificativa: e.justificativaRetroativo ?? null,
      permiteRetroativo: prof.permiteRetroativo,
    });
    if (!h.ok && h.recusa)
      throw new ErroProblema('entrada-invalida', 422, 'Horário do registro', MENSAGENS_HORARIO[h.recusa], {
        codigo: h.recusa,
      });
    const retratos = await this.retratos(c, e.paciente, e.atendimento);
    let montado: ReturnType<typeof montarRegistro>;
    try {
      montado = montarRegistro(
        rep,
        e.respostas,
        {
          modelo: rep.modelo.id,
          tipoComposicao: m.tipoComposicao ?? 2,
          nomeTipoComposicao: m.nomeTipoComposicao ?? 'Evolução',
          descricaoModelo: m.nome ?? '',
        },
        { exigirConfirmacao: true },
      );
    } catch (x) {
      problemaDoGravador(x);
    }
    // A prova do gravador antes do banco: as linhas lidas pelo leitor × o formulário montado.
    const conf = conferirGravado(rep, comoLidas(montado.linhas), montado.xml(1));
    if (taxaIgualdade(conf) < 1)
      throw new ErroProblema(
        'erro-interno',
        500,
        'Registro não gravado',
        'O formulário montado não confere com as respostas: nada foi gravado. A equipe de suporte foi avisada.',
        { codigo: 'conferencia-gravador' },
      );
    const cab = await this.porta.cabecalhoDocumento(c, retratos, cbo, SITUACAO_LANCADO);
    const documento = montado.documento(Number.NaN, documentoDe(cab, e.dataHoraClinica, MARCADOR_REGISTRO));
    const hash = await hashDoConteudo({
      estabelecimento: c.hospital,
      registro: 0,
      modelo: e.modelo,
      paciente: e.paciente,
      atendimento: e.atendimento,
      dataHoraClinica: e.dataHoraClinica,
      impressao: rep.impressaoLayout,
      respostas: e.respostas,
    });
    const avisos: string[] = [];
    if (h.retroativo)
      avisos.push(`Registro retroativo (${h.minutos} minutos antes da gravação), com justificativa.`);
    return {
      gravacao: {
        paciente: e.paciente,
        modelo: e.modelo,
        atendimento: e.atendimento,
        cbo,
        dataHoraClinica: e.dataHoraClinica,
        ...(e.justificativaRetroativo ? { justificativaRetroativo: e.justificativaRetroativo } : {}),
        toleranciaMin: opcoes.toleranciaMin,
        retratos,
        linhas: montado.linhas.map(paraLinhaGravacao),
        rtf: montado.rtf,
        xml: montado.xml(Number.NaN).replace('id_prcabevol="NaN"', `id_prcabevol="${MARCADOR_REGISTRO}"`),
        documento: documento.replace(
          '<id_prcabevol>NaN</id_prcabevol>',
          `<id_prcabevol>${MARCADOR_REGISTRO}</id_prcabevol>`,
        ),
        ...(e.rascunho ? { rascunho: e.rascunho } : {}),
        ...(e.corrige !== undefined ? { corrige: e.corrige } : {}),
        ...(opcoes.comoSuporte ? { comoSuporte: true } : {}),
        ...(opcoes.fluxo ? { fluxo: opcoes.fluxo } : {}),
        ...(opcoes.supervisao ? { supervisao: opcoes.supervisao } : {}),
        hashConteudo: hash,
        representacao: {
          impressao: rep.impressaoLayout,
          selo: conv.selo,
          codigo: rep.modelo.codigo,
          versaoLayout: conv.versaoLayout,
          representacao: rep,
        },
      },
      avisos,
    };
  }

  /** O registro gravado em visualização (renderizador) com a prova (regra 11). */
  async visualizar(
    c: ContextoRegistro,
    paciente: number,
    registro: number,
    prof: ProfissionalDoRegistro | null,
    podeSuspender: boolean,
    podeCriar = false,
    podeVerConteudo: (cbo: number) => Promise<boolean> = async () => true,
  ): Promise<RegistroVisualizado> {
    const cab = await this.porta.cabecalhoRegistro(c, registro);
    if (!cab || cab.paciente !== paciente)
      throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
    const { m, conv } = await this.modeloOu404(c, cab.modelo);
    // M23 (regra 15): no registro sigiloso para o leitor, só data, profissional e o aviso (sem campos nem respostas).
    const ve = await podeVerConteudo(cab.cbo);
    const linhas = ve ? await this.porta.respostasRegistro(c, registro) : [];
    const respostas = ve ? respostasDasLinhas(conv.representacao, linhas).respostas : [];
    const prova = await this.porta.prova(c, registro);
    return {
      registro,
      modelo: this.modeloRegistro(m, prof, new Set(m.codigo ? [m.codigo] : [])),
      dataHoraClinica: cab.dataHoraClinica,
      lancadoEm: cab.lancadoEm,
      profissional: cab.profissionalNome,
      suspenso: cab.suspensoEm !== null,
      justificativaSuspensao: cab.justificativaSuspensao,
      campos: ve ? camposParaVisualizar(conv.representacao) : [],
      respostas,
      prova: {
        situacao:
          prova.guardado === null ? 'sem-prova' : prova.guardado === prova.atual ? 'confere' : 'alterado',
        hash: prova.hashConteudo,
      },
      podeSuspender: podeSuspender && cab.suspensoEm === null && prof !== null && prof.cbos.includes(cab.cbo),
      corrige: cab.corrige,
      // Corrige o autor do registro suspenso, no mesmo modelo (844 de 844 assim no legado).
      podeCorrigir: podeCriar && cab.suspensoEm !== null && prof !== null && prof.cbos.includes(cab.cbo),
      marcas: [
        ...(ve ? [] : [TEXTO_SIGILO]),
        ...prova.comoSuporte.map((t) => {
          const marca = marcaSuporteTecnico(cab.profissionalNome ?? 'profissional');
          return t === 'suspenso' ? `Suspensão: ${marca.charAt(0).toLowerCase()}${marca.slice(1)}` : marca;
        }),
      ],
    };
  }

  /** Documento emitido na situação "Suspenso", pelas respostas gravadas (o original continua visível). */
  async montarSuspensao(
    c: ContextoRegistro,
    paciente: number,
    registro: number,
    justificativa: string,
    prof0: ProfissionalDoRegistro | null,
    comoSuporte = false,
  ): Promise<{
    registro: number;
    cbo: number;
    justificativa: string;
    documento: string;
    comoSuporte?: boolean;
  }> {
    const prof = this.exigirProfissional(prof0);
    const cab = await this.porta.cabecalhoRegistro(c, registro);
    // O registro é do paciente da rota (como na visualização): o de outro paciente é 404.
    if (!cab || cab.paciente !== paciente)
      throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
    if (cab.suspensoEm !== null)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Registro já suspenso',
        'O registro já está suspenso.',
        { codigo: 'ja-suspenso' },
      );
    if (!prof.cbos.includes(cab.cbo))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Só o autor suspende',
        'Só o autor suspende o registro (o outro profissional registra a correção).',
        { codigo: 'suspensao-por-outro' },
      );
    const { m, conv } = await this.modeloOu404(c, cab.modelo);
    const respostas = respostasDasLinhas(
      conv.representacao,
      await this.porta.respostasRegistro(c, registro),
    ).respostas;
    const montado = montarRegistro(conv.representacao, respostas, {
      modelo: cab.modelo,
      tipoComposicao: m.tipoComposicao ?? 2,
      nomeTipoComposicao: m.nomeTipoComposicao ?? 'Evolução',
      descricaoModelo: m.nome ?? '',
    });
    // Quem suspende é o autor, pelo CBO do registro (o profissional com mais de um CBO suspende com o do registro).
    const cbo = cab.cbo;
    const doc = await this.porta.cabecalhoDocumento(
      c,
      { htPaciente: cab.idHtPaciente, htAtendimento: cab.idHtAtendimento },
      cbo,
      SITUACAO_SUSPENSO,
    );
    const agora = await this.porta.agora(c);
    return {
      registro,
      cbo,
      justificativa,
      documento: montado.documento(registro, documentoDe(doc, agora.slice(0, 16), String(registro))),
      ...(comoSuporte ? { comoSuporte: true } : {}),
    };
  }

  // ── Administração do PEP (consulta) ──────────────────────────────────────────────────────────────

  private async resumoAdmin(
    c: ContextoRegistro,
    m: ModeloDoRegistro,
    fora: ModelosForaDaLiberacao = NENHUM_MODELO_FORA,
  ): Promise<{ admin: ModeloAdmin; conv: ModeloConvertido | null }> {
    const conv = await this.representacao(c, m.id);
    const rep = conv?.representacao;
    const exps = rep ? todos(rep.itens).flatMap((i) => i.expressoes ?? []) : [];
    const campos = rep ? camposParaRegistro(rep) : [];
    const amb = bloqueiosDoModelo(campos).ambiguas;
    return {
      conv,
      admin: {
        id: m.id,
        codigo: m.codigo,
        nome: m.nome,
        vinculos: rep?.resumo.vinculos ?? 0,
        vinculosAtivos: rep?.resumo.vinculosAtivos ?? 0,
        componentes: rep?.resumo.componentes ?? 0,
        componentesMapeados: rep?.resumo.componentesMapeados ?? 0,
        expressoes: exps.length,
        expressoesConvertidas: exps.filter((x) => x.convertida !== false).length,
        escolhasPendentes: rep?.resumo.escolhasPendentes ?? 0,
        versoesLayout: rep?.versoesLayout.length ?? 0,
        impressao: rep?.impressaoLayout ?? '',
        usoRecente: uso(m.usoRecente),
        ...situacaoAdmin(m, campos, amb, fora),
      },
    };
  }

  async modelosAdmin(
    c: ContextoRegistro,
    fora: ModelosForaDaLiberacao = NENHUM_MODELO_FORA,
  ): Promise<ModeloAdmin[]> {
    const lista = await this.modelos(c);
    const r: ModeloAdmin[] = [];
    for (const m of lista) r.push((await this.resumoAdmin(c, m, fora)).admin);
    return r;
  }

  async modeloAdmin(
    c: ContextoRegistro,
    id: number,
    fora: ModelosForaDaLiberacao = NENHUM_MODELO_FORA,
  ): Promise<ModeloAdminDetalhe> {
    const m = (await this.modelos(c)).find((x) => x.id === id);
    if (!m) throw new ErroProblema('nao-encontrado', 404, 'Modelo não encontrado');
    const { admin, conv } = await this.resumoAdmin(c, m, fora);
    const rep = conv?.representacao;
    return {
      ...admin,
      campos: rep ? camposParaVisualizar(rep) : [],
      pendencias: (rep?.pendencias ?? []).map((p) => ({ campo: p.linkId, tipo: p.tipo, detalhe: p.detalhe })),
      expressoesDetalhe: rep
        ? todos(rep.itens).flatMap((i) =>
            (i.expressoes ?? []).map((x) => ({
              campo: i.linkId,
              tipo: x.tipo,
              padrao: x.padrao,
              convertida: x.convertida !== false,
              motivo: x.motivoConversao ?? null,
            })),
          )
        : [],
      versoes: rep ? [...rep.versoesLayout] : [],
    };
  }
}

/**
 * O modelo fica fora da liberação? Só pela configuração do cliente (parâmetro pep.evolucao.modelosForaDaLiberacao).
 * O componente de alergia não desliga mais o modelo (D-ALE-2): a alergia informada nele é gravada na hora, pela
 * operação pep.registrarAlergia, ligada ao atendimento do registro, e já vale para a prescrição.
 */
export function motivoDoFormulario(
  m: ModeloDoRegistro,
  campos: readonly CampoRegistro[],
  fora: ModelosForaDaLiberacao = NENHUM_MODELO_FORA,
): string | null {
  // Os campos ficam na assinatura para a próxima regra por componente; hoje nenhum componente desliga o modelo.
  void campos;
  return modeloForaDaLiberacao(m.codigo, fora);
}

/** Situação do modelo na administração: o aposentado fica descontinuado; o sem uso recente, não. */
export function situacaoAdmin(
  m: ModeloDoRegistro,
  campos: readonly CampoRegistro[],
  ambiguas: number,
  modelosFora: ModelosForaDaLiberacao = NENHUM_MODELO_FORA,
): { situacao: SituacaoModelo; motivo: string | null } {
  if (m.aposentado) return { situacao: 'descontinuado', motivo: MOTIVOS_SITUACAO.descontinuado };
  const fora = motivoDoFormulario(m, campos, modelosFora);
  if (fora) return { situacao: 'desligado', motivo: fora };
  if (ambiguas > 0) return { situacao: 'ambiguo', motivo: MOTIVOS_SITUACAO.ambiguo };
  return { situacao: 'liberado', motivo: null };
}

function todos(itens: readonly ItemFormulario[]): ItemFormulario[] {
  return itens.flatMap((i) => [i, ...todos(i.itens)]);
}

function itemDoVinculo(rep: RepresentacaoFormulario, vinculo: number): ItemFormulario | null {
  return todos(rep.itens).find((i) => i['x-legacy'].vinculo === vinculo) ?? null;
}

/** Texto curto de uma resposta (histórico "copiar do último"). */
export function textoDaResposta(r: RespostaRegistro): string {
  const v = r.valor;
  switch (v.tipo) {
    case 'texto':
      return v.texto;
    case 'formatado':
      return v.paragrafos.map((p) => p.trechos.map((t) => t.texto).join('')).join('\n');
    case 'numero':
      return String(v.valor).replace('.', ',');
    case 'data':
      return v.data.split('-').reverse().join('/');
    case 'hora':
      return v.hora;
    case 'escolha':
      return `opção ${v.indice}${v.complemento ? ` - ${v.complemento}` : ''}`;
    case 'multipla':
      return v.indices.map((i) => `opção ${i}`).join(', ');
    case 'grade':
      return `${v.linhas.length} linha(s)`;
    case 'cid':
      return v.codigos.join(', ');
  }
}

function paraLinhaGravacao(l: {
  ordem: string;
  seq: number;
  idResposta: number;
  data: string | null;
  hora: string | null;
  indice: string | null;
  valor: number | null;
  alfa: string | null;
  texto: string | null;
  unidade: string;
  cid: string | null;
  autopreenchido: boolean;
}): LinhaGravacao {
  return { ...l };
}

const UTC = (local: string) => `${local.length === 16 ? `${local}:00` : local.slice(0, 19)}.0000-03:00`;

/** Cabeçalho do documento emitido: os blocos lidos e o lançamento (evento = horário clínico, autor). */
function documentoDe(
  cab: CabecalhoDocumentoLido,
  dataHoraEvento: string,
  idTabela: string,
): CabecalhoDocumento {
  return {
    hospital: cab.hospital,
    paciente: cab.paciente,
    atendimento: cab.atendimento,
    lancamento: [
      ['id_tabela_origem', idTabela],
      ['tipo_assinatura', cab.tipoAssinatura],
      ['situacao_documento', cab.situacao],
      ['data_hora_evento', UTC(dataHoraEvento)],
      ['profissional_evento', cab.profissional],
    ],
  };
}

export type { CampoRegistro };
