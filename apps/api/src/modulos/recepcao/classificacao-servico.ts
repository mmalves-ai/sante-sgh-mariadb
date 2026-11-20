// Serviço da classificação de risco no PA (M44, etapa 1; ficha, seções 4, 5, 7 e 8): monta as respostas das telas e
// decide no servidor o que a tela só mostra — a fila (chegou e não classificou), o protocolo vigente (conferido pela
// impressão digital), a cor proposta e a final (regra 3), quem pode concluir (regra 1), o tempo-alvo, o estouro e a
// reclassificação obrigatória (regra 4), o risco no quadro do M20 e a contagem por cor, o painel de TV sem nome, os
// indicadores com numerador e denominador (regra 5) e a publicação do protocolo (regra 2). Nenhuma regra mora na
// tela: o motor (@sgh/dominio-recepcao) roda aqui e lá, e o servidor reconfere tudo antes de gravar.
import { createHash } from 'node:crypto';
import {
  type ClassificacaoHistorico,
  type ClassificacaoResumo,
  type ClassificarRiscoEntrada,
  type ConteudoProtocolo,
  type CorRisco,
  CORES_RISCO,
  esquemaConteudoProtocolo,
  type FilaClassificacao,
  type IndicadoresClassificacaoPa,
  type ProtocoloComConteudo,
  type PublicarProtocoloClassificacaoEntrada,
  type ReclassificarRiscoEntrada,
  type ResultadoSimulacaoProtocolo,
  type RiscoNoQuadro,
  type SimularProtocoloEntrada,
  type SinaisClassificacao,
  type VersaoProtocoloResumo,
} from '@sgh/contratos';
import {
  type AcaoClassificacao,
  acoesPermitidas,
  type AtendimentoClassificado,
  type AtorClassificacao,
  type CategoriaVinculo,
  cartaoDoPainel,
  chaveAvisoEstouro,
  type ClassificacaoVigente,
  classificacaoVigente,
  contagemPorCor,
  conteudoCanonico,
  corDoTextoDaOpcao,
  decidirCorFinal,
  discriminadoresDoFluxograma,
  iniciaisDaChamada,
  indicadoresClassificacao,
  linhasDaVersao,
  NOME_SIGILOSO,
  nomeDeTratamento,
  problemaDaReclassificacao,
  problemasDaPublicacao,
  proporCor,
  reclassificacaoObrigatoria,
  recusaDaAcao,
  riscoDoAtendimento,
  tempoAlvoDaCor,
  valoresDaClassificacao,
} from '@sgh/dominio-recepcao';
import type { AtendimentoPaLegado, ClassificacaoLida, SinaisSgh } from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type {
  ContextoClassificacao,
  GravadorClassificacao,
  PortaClassificacao,
  VinculoDaSessao,
} from './classificacao-porta.js';

/** O que o serviço lê do atendimento do PA (M20; pela public-api do atendimento). */
export interface FonteAtendimentosPa {
  /**
   * W1-04: os prontuários marcados "sigiloso" (a porta da recepção; ausente = nenhum). O painel de TV do PA e a fila
   * da classificação usam o nome social e mascaram o sigiloso.
   */
  sigilosos?(c: ContextoClassificacao, prontuarios: readonly number[]): Promise<ReadonlySet<number>>;
  paAbertos(
    c: ContextoClassificacao,
    o: { hoje: string },
  ): Promise<{ itens: AtendimentoPaLegado[]; cortada: boolean }>;
  /** O paciente (ID do cadastro) e a idade do atendimento. */
  pacienteDoAtendimento(
    c: ContextoClassificacao,
    reg: number,
  ): Promise<{ id: number; nascimento: string | null } | null>;
}

/** O formulário de classificação do prontuário (E08) pelo registro clínico do M22 (ligado ou desligado). */
export interface FormularioClassificacao {
  estado(): Promise<{ ligado: boolean; motivo: string | null }>;
  /**
   * Grava o formulário e, na MESMA transação (receita do M22), a classificação estruturada e os sinais. Devolve o
   * registro do formulário e se a cor tinha opção de "Prioridade clínica".
   */
  gravar(d: {
    paciente: number;
    cabecalho: string;
    reg: number;
    cor: CorRisco;
    conteudo: ConteudoProtocolo;
    sinais: SinaisClassificacao;
    queixa: string;
    observacoes: string | null;
    alergia: 'sim' | 'nao' | null;
    comorbidades: readonly string[];
    classificacao: {
      versaoProtocolo: number;
      fluxograma: string;
      discriminadores: string[];
      automaticos: string[];
      corProposta: CorRisco;
      corFinal: CorRisco;
      justificativa: string | null;
      motivo: 'inicial' | 'estouro' | 'mudanca_quadro';
      descricaoMudanca: string | null;
      anterior: number | null;
      tempoAlvoMin: number;
      /** Os eventos próprios da classificação, gravados na SGH_TRILHA dentro da mesma transação. */
      eventos: { evento: string; chave: string }[];
    };
  }): Promise<{ registro: number; comPrioridade: boolean }>;
}

const NOME_COR: ReadonlyMap<string, string> = new Map(CORES_RISCO.map((c) => [c.codigo, c.nome]));
const MOTIVO_DESLIGADO_E08 =
  'O registro no formulário de classificação do prontuário ainda não está liberado: a classificação fica só neste sistema.';
const MS_MIN = 60_000;
/** AAAA-MM-DD do dia seguinte (o fim do período é exclusivo). */
function diaSeguinte(dia: string): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
const ms = (iso: string) => Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);

export function impressaoDoConteudo(c: ConteudoProtocolo): string {
  return createHash('sha256').update(conteudoCanonico(c)).digest('hex');
}

/** Categoria do vínculo pela ocupação (CBO 2002): enfermeiro 2235, técnico/auxiliar 3222, médico 225. */
export function categoriaPeloCbo(cbo: string | null | undefined): CategoriaVinculo {
  const c = (cbo ?? '').replace(/\D/g, '');
  if (c.startsWith('2235')) return 'enfermeiro';
  if (c.startsWith('3222')) return 'tecnico-enfermagem';
  if (c.startsWith('225')) return 'medico';
  return c ? 'outra' : 'administrativo';
}

export function atorDoVinculo(v: VinculoDaSessao | null): AtorClassificacao {
  return {
    categoria: categoriaPeloCbo(v?.codigoCbo),
    conselhoAtivo: v?.conselhoAtivo ?? false,
    vinculoAssistencial: v !== null,
  };
}

export const MENSAGENS_RECUSA_ATOR: Readonly<Record<string, string>> = {
  'sem-vinculo-assistencial':
    'Seu usuário não tem ocupação assistencial ativa no cadastro de profissionais: a classificação fica em consulta.',
  'privativo-enfermeiro':
    'A classificação de risco é privativa do enfermeiro: você pode registrar os sinais vitais.',
  'conselho-inativo': 'O conselho profissional (COREN) não está ativo no cadastro de profissionais.',
  'categoria-nao-registra': 'Sua categoria não registra sinais vitais nesta tela.',
};

function problema(status: number, codigo: string, titulo: string, detalhe: string, campos?: string[]) {
  return new ErroProblema(
    status === 409 ? 'recusa-de-negocio' : 'entrada-invalida',
    status,
    titulo,
    detalhe,
    {
      codigo,
      ...(campos ? { campos } : {}),
    },
  );
}

/** A linha lida → a vigente do motor (cor e tempo-alvo). */
function vigenteDe(l: ClassificacaoLida): ClassificacaoVigente {
  return {
    id: l.id,
    cor: l.corFinal as CorRisco,
    classificadoEm: l.em,
    tempoAlvoMin: l.tempoAlvoMin,
    motivo: l.motivo,
  };
}

const marca = (a: Pick<AtendimentoPaLegado, 'marcas'>, etapa: string) =>
  a.marcas.find((m) => m.etapa === etapa)?.em ?? null;

/** O atendimento do PA encerrado (decisão ou saída registrada no quadro, ou a saída pela outra ponta). */
export function encerradoNoPa(a: Pick<AtendimentoPaLegado, 'marcas' | 'saida'>): boolean {
  return a.saida !== null || a.marcas.some((m) => m.etapa === 'decisao' || m.etapa === 'saida');
}

export function resumoDe(l: ClassificacaoLida, conteudo: ConteudoProtocolo | null): ClassificacaoResumo {
  const cor = l.corFinal as CorRisco;
  return {
    id: l.id,
    atendimento: l.reg,
    cor,
    nomeCor: conteudo?.cores.find((c) => c.cor === cor)?.nome ?? NOME_COR.get(cor) ?? cor,
    prioridade: CORES_RISCO.find((c) => c.codigo === cor)?.prioridade ?? 5,
    corProposta: l.corProposta as CorRisco,
    sobreposta: l.corProposta !== l.corFinal,
    motivo: l.motivo,
    tempoAlvoMin: l.tempoAlvoMin,
    classificadoEm: l.em,
    prazoEm: new Date(ms(l.em) + l.tempoAlvoMin * MS_MIN).toISOString().slice(0, 19),
    versaoProtocolo: l.versaoProtocolo,
    fluxograma: l.fluxograma,
    autor: l.autor,
    prontuario:
      l.e08 === 'desligado' || l.registroE08 === null
        ? { situacao: 'desligado' }
        : l.e08 === 'gravado'
          ? { situacao: 'gravado', registro: l.registroE08 }
          : { situacao: 'semPrioridade' },
  };
}

const sinaisSgh = (s: SinaisClassificacao): SinaisSgh => ({
  pas: s.pas,
  pad: s.pad,
  fc: s.fc,
  fr: s.fr,
  temperatura: s.temperatura,
  saturacao: s.saturacao,
  glicemia: s.glicemia,
  dor: s.dor,
  glasgow: s.glasgow,
});

function idade(nascimento: string | null, hoje: string): number | null {
  if (!nascimento || !/^\d{4}-\d{2}-\d{2}/.test(nascimento)) return null;
  const [a, m, d] = nascimento.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [ha, hm, hd] = hoje.slice(0, 10).split('-').map(Number) as [number, number, number];
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
}

export interface SessaoClassificacao {
  readonly c: ContextoClassificacao;
  readonly login: string;
  pode(permissao: string): boolean;
}

export class ServicoClassificacao {
  constructor(
    readonly porta: PortaClassificacao,
    private readonly atendimentos: FonteAtendimentosPa,
    private readonly formulario: FormularioClassificacao | null = null,
  ) {}

  // ── Protocolo ──────────────────────────────────────────────────────────────────────────────────

  private resumoVersao(
    v: Awaited<ReturnType<PortaClassificacao['versoes']>>[number],
    vigente: boolean,
  ): VersaoProtocoloResumo {
    return {
      id: v.id,
      protocolo: v.protocolo,
      versao: v.versao,
      situacao: vigente ? 'publicado' : 'substituido',
      tipo: v.tipo as VersaoProtocoloResumo['tipo'],
      nome: v.nome,
      autor: v.autor,
      aprovador: v.aprovador,
      publicadoEm: v.publicadoEm,
      licencaValidaAte: v.licencaValidaAte,
      impressao: v.impressao,
    };
  }

  async versoes(c: ContextoClassificacao): Promise<VersaoProtocoloResumo[]> {
    const vs = await this.porta.versoes(c);
    return vs.map((v, i) => this.resumoVersao(v, i === 0));
  }

  /** Uma versão com o conteúdo, conferida pela impressão digital (a publicada não muda). */
  async versao(c: ContextoClassificacao, id: number): Promise<ProtocoloComConteudo> {
    const [vs, v] = await Promise.all([this.porta.versoes(c), this.porta.versao(c, id)]);
    if (!v) throw new ErroProblema('nao-encontrado', 404, 'Versão do protocolo não encontrada');
    const conteudo = esquemaConteudoProtocolo.parse(v.conteudo);
    if (impressaoDoConteudo(conteudo) !== v.impressao)
      throw new ErroProblema(
        'erro-interno',
        500,
        'Versão do protocolo alterada',
        'O conteúdo da versão não confere com a impressão digital da publicação: a classificação fica suspensa e a equipe de suporte foi avisada.',
        { codigo: 'protocolo-adulterado' },
      );
    return { versao: this.resumoVersao(v, vs[0]?.id === v.id), conteudo, notas: v.notas };
  }

  /** A versão vigente (a publicada mais recente), ou null. */
  async vigente(c: ContextoClassificacao): Promise<ProtocoloComConteudo | null> {
    const [v] = await this.porta.versoes(c);
    return v ? this.versao(c, v.id) : null;
  }

  simular(e: SimularProtocoloEntrada, ctx: { hoje: string; autor: string }): ResultadoSimulacaoProtocolo {
    const p = proporCor(
      e.conteudo,
      e.fluxograma,
      valoresDaClassificacao(e.sinais, e.idadeAnos),
      e.discriminadores,
    );
    return {
      cor: p.cor,
      nomeCor: e.conteudo.cores.find((x) => x.cor === p.cor)?.nome ?? NOME_COR.get(p.cor) ?? p.cor,
      tempoAlvoMin: tempoAlvoDaCor(e.conteudo, p.cor),
      presentes: p.presentes.map((d) => ({ codigo: d.codigo, titulo: d.titulo, cor: d.cor })),
      automaticos: [...p.automaticos],
      semDiscriminador: p.semDiscriminador,
      desconhecidos: [...p.desconhecidos],
      problemas: problemasDaPublicacao(e.conteudo, { hoje: ctx.hoje, autor: ctx.autor, aprovador: '' })
        .filter((x) => x.codigo !== 'autoaprovacao')
        .map((x) => ({ codigo: x.codigo, mensagem: x.mensagem, onde: x.onde ?? null })),
    };
  }

  /** Regra 2: publica a versão (autor ≠ aprovador, licença no Manchester, regras válidas), imutável. */
  async publicar(
    s: SessaoClassificacao,
    e: PublicarProtocoloClassificacaoEntrada,
    gravar: (
      fn: (g: GravadorClassificacao) => Promise<{ id: number; protocolo: number; versao: number }>,
    ) => Promise<{ id: number; protocolo: number; versao: number }>,
  ): Promise<{ id: number; protocolo: number; versao: number }> {
    const { hoje } = await this.porta.relogio(s.c);
    const ps = problemasDaPublicacao(e.conteudo, {
      hoje,
      autor: e.autor.trim().toUpperCase(),
      aprovador: s.login.trim().toUpperCase(),
    });
    if (ps.length > 0)
      throw problema(
        422,
        ps[0]!.codigo,
        'Versão não publicada',
        ps.map((p) => p.mensagem).join(' '),
        ps.map((p) => p.onde ?? 'conteudo'),
      );
    const l = linhasDaVersao(e.conteudo);
    return gravar((g) =>
      g.publicarProtocolo({
        protocolo: e.protocolo ?? null,
        tipo: e.conteudo.tipo,
        nome: e.conteudo.nome,
        conteudo: e.conteudo,
        impressao: impressaoDoConteudo(e.conteudo),
        notas: e.notas,
        autor: e.autor.trim().toUpperCase(),
        aprovador: s.login,
        licenca: e.conteudo.licenca,
        cores: l.cores,
        discriminadores: l.discriminadores,
      }),
    );
  }

  // ── Atendimentos ───────────────────────────────────────────────────────────────────────────────

  private async abertos(c: ContextoClassificacao) {
    const { hoje, agora } = await this.porta.relogio(c);
    const r = await this.atendimentos.paAbertos(c, { hoje });
    const itens = r.itens.filter((a) => a.saida === null);
    const linhas = await this.porta.classificacoes(
      c,
      itens.map((a) => a.cabecalho),
    );
    const porCab = new Map<string, ClassificacaoLida[]>();
    for (const l of linhas)
      (porCab.get(l.cabecalho) ?? porCab.set(l.cabecalho, []).get(l.cabecalho)!).push(l);
    return { hoje, agora, itens, cortada: r.cortada, porCab };
  }

  /** O risco de cada atendimento do quadro (M20), pelo cabeçalho; e a contagem por cor. */
  async riscosDoQuadro(
    c: ContextoClassificacao,
    itens: readonly Pick<AtendimentoPaLegado, 'cabecalho' | 'reg' | 'marcas'>[],
  ): Promise<{ porReg: Map<number, RiscoNoQuadro | null>; porCor: ReturnType<typeof contagemPorCor> }> {
    const { agora } = await this.porta.relogio(c);
    const linhas = await this.porta.classificacoes(
      c,
      itens.map((a) => a.cabecalho),
    );
    const porReg = new Map<number, RiscoNoQuadro | null>();
    for (const a of itens) {
      const ls = linhas.filter((l) => l.cabecalho === a.cabecalho).map(vigenteDe);
      porReg.set(a.reg, riscoDoAtendimento(ls, agora, marca(a, 'atendimentoMedico')));
    }
    return { porReg, porCor: contagemPorCor([...porReg.values()]) };
  }

  /** W1-04: a identidade exibida de cada atendimento (nome civil, nome social e a marca "sigiloso"), por REG. */
  private async identidades(c: ContextoClassificacao, itens: readonly AtendimentoPaLegado[]) {
    const pronts = [...new Set(itens.map((x) => x.prontuario ?? 0).filter((p) => p > 0))];
    const sig =
      pronts.length && this.atendimentos.sigilosos
        ? await this.atendimentos.sigilosos(c, pronts)
        : new Set<number>();
    return new Map(
      itens.map((x) => [
        x.reg,
        { nome: x.paciente, nomeSocial: x.nomeSocial ?? null, sigiloso: sig.has(x.prontuario ?? 0) },
      ]),
    );
  }

  async fila(c: ContextoClassificacao): Promise<FilaClassificacao> {
    const a = await this.abertos(c);
    const ids = await this.identidades(c, a.itens);
    // A fila mostra o nome de tratamento (o social quando houver); o sigiloso sai mascarado.
    const nomeDe = (x: AtendimentoPaLegado) => {
      const i = ids.get(x.reg);
      return i?.sigiloso ? NOME_SIGILOSO : (nomeDeTratamento(i ?? { nome: x.paciente }) ?? x.paciente);
    };
    const fila: FilaClassificacao['itens'] = [];
    const reclassificarAgora: FilaClassificacao['reclassificarAgora'] = [];
    // Os sinais dos que esperam a classificação numa leitura por lote (não uma por paciente a cada releitura).
    const comSinais = await this.porta.sinaisRecentesDosAtendimentos(
      c,
      a.itens
        .filter((x) => !encerradoNoPa(x) && (a.porCab.get(x.cabecalho) ?? []).length === 0)
        .map((x) => ({ cabecalho: x.cabecalho, desde: x.chegada || a.hoje })),
    );
    for (const x of a.itens) {
      if (encerradoNoPa(x)) continue;
      const ls = a.porCab.get(x.cabecalho) ?? [];
      if (ls.length === 0) {
        const sinais = comSinais.get(x.cabecalho) ?? null;
        fila.push({
          reg: x.reg,
          paciente: nomeDe(x),
          idade: idade(x.nascimento, a.hoje),
          senha: x.senha,
          prioridadeLegal: x.prioridade,
          chegada: x.chegada,
          minutosEspera: Math.max(0, Math.floor((ms(a.agora) - ms(x.chegada || a.agora)) / MS_MIN)),
          comSinais: sinais !== null,
        });
        continue;
      }
      const v = classificacaoVigente(ls.map(vigenteDe))!;
      const medico = marca(x, 'atendimentoMedico');
      if (reclassificacaoObrigatoria(v, a.agora, medico))
        reclassificarAgora.push({
          reg: x.reg,
          paciente: nomeDe(x),
          cor: v.cor,
          minutosPassados: Math.floor(
            (ms(a.agora) - ms(v.classificadoEm) - v.tempoAlvoMin * MS_MIN) / MS_MIN,
          ),
        });
    }
    // Ordem da chegada, com a prioridade legal primeiro (a mesma do quadro do M20 sem cor).
    fila.sort(
      (p, q) =>
        p.prioridadeLegal.localeCompare(q.prioridadeLegal) || ms(p.chegada) - ms(q.chegada) || p.reg - q.reg,
    );
    const [v] = await this.porta.versoes(c);
    return {
      itens: fila.slice(0, 200),
      cortada: a.cortada || fila.length > 200,
      atualizadoEm: a.agora,
      reclassificarAgora,
      protocoloVigente: v ? this.resumoVersao(v, true) : null,
    };
  }

  // ── Classificar e reclassificar ────────────────────────────────────────────────────────────────

  private async atendimentoAberto(c: ContextoClassificacao, reg: number) {
    const a = await this.abertos(c);
    const x = a.itens.find((i) => i.reg === reg);
    if (!x)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Atendimento não encontrado',
        'O atendimento não está aberto no pronto atendimento.',
      );
    return { ...a, x, linhas: a.porCab.get(x.cabecalho) ?? [] };
  }

  /** As ações da tela para o ator (regra 1) com as permissões e a liberação. */
  acoes(
    s: SessaoClassificacao,
    ator: AtorClassificacao,
    liberada: boolean,
    vigente: boolean,
    encerrado: boolean,
  ): { acoes: AcaoClassificacao[]; motivo: string | null } {
    const permissao: Record<AcaoClassificacao, string> = {
      registrarSinais: 'recepcao.classificacao.registrarSinais',
      concluir: 'recepcao.classificacao.criar',
      reclassificar: 'recepcao.classificacao.reclassificar',
    };
    const pelo = acoesPermitidas(ator).filter((a) => s.pode(permissao[a]));
    const acoes =
      !liberada || encerrado
        ? []
        : pelo.filter((a) => (a === 'concluir' ? !vigente : a === 'reclassificar' ? vigente : true));
    const principal: AcaoClassificacao = vigente ? 'reclassificar' : 'concluir';
    let motivo: string | null = null;
    if (!acoes.includes(principal)) {
      const r = recusaDaAcao(ator, principal);
      motivo = encerrado
        ? 'O atendimento já tem a decisão ou a saída registrada: a classificação fica em consulta.'
        : r
          ? (MENSAGENS_RECUSA_ATOR[r] ?? null)
          : !s.pode(permissao[principal])
            ? 'Seu perfil não permite esta ação.'
            : null;
    }
    return { acoes, motivo };
  }

  async tela(s: SessaoClassificacao, reg: number, liberacao: { ligada: boolean; motivo: string | null }) {
    const a = await this.atendimentoAberto(s.c, reg);
    const protocolo = await this.vigente(s.c);
    const idVigente = classificacaoVigente(a.linhas.map(vigenteDe))?.id ?? null;
    const vigente = a.linhas.find((l) => l.id === idVigente) ?? null;
    const medico = marca(a.x, 'atendimentoMedico');
    const risco = riscoDoAtendimento(a.linhas.map(vigenteDe), a.agora, medico);
    const pac = await this.atendimentos.pacienteDoAtendimento(s.c, reg);
    const historico = pac ? await this.historico(s.c, pac.id) : [];
    const ator = atorDoVinculo(await this.porta.vinculo(s.c, s.login));
    const encerrado = encerradoNoPa(a.x);
    const { acoes, motivo } = this.acoes(
      s,
      ator,
      liberacao.ligada && protocolo !== null,
      vigente !== null,
      encerrado,
    );
    const formulario = this.formulario
      ? await this.formulario.estado()
      : { ligado: false, motivo: MOTIVO_DESLIGADO_E08 };
    return {
      atendimento: {
        reg,
        paciente: a.x.paciente,
        idade: idade(a.x.nascimento, a.hoje),
        senha: a.x.senha,
        chegada: a.x.chegada,
        prioridadeLegal: a.x.prioridade,
        encerrado,
        atendimentoMedicoEm: medico,
      },
      protocolo,
      vigente: vigente ? resumoDe(vigente, protocolo?.conteudo ?? null) : null,
      risco,
      historico,
      sinaisRecentes: await this.porta.sinaisRecentes(s.c, a.x.cabecalho, a.x.chegada || a.hoje),
      acoes,
      motivoSemAcao: liberacao.ligada
        ? protocolo === null
          ? 'Nenhum protocolo de classificação publicado neste estabelecimento: a diretoria clínica publica em Protocolos de classificação.'
          : motivo
        : liberacao.motivo,
      prontuario: { ligado: formulario.ligado, motivo: formulario.ligado ? null : formulario.motivo },
      liberada: liberacao.ligada,
      motivoLiberacao: liberacao.ligada ? null : liberacao.motivo,
    };
  }

  /** O histórico do paciente: o do novo e o do formulário do prontuário, do mais novo para o mais antigo (50). */
  async historico(c: ContextoClassificacao, paciente: number): Promise<ClassificacaoHistorico[]> {
    const [novo, pront] = await Promise.all([
      this.porta.classificacoesDoPaciente(c, paciente),
      this.porta.historicoProntuario(c, paciente),
    ]);
    const doNovo = new Set(novo.map((n) => n.registroE08).filter((x): x is number => x !== null));
    return [
      ...novo.map((n) => ({
        registro: n.id,
        dataHora: n.em,
        cor: n.corFinal as CorRisco,
        opcao: NOME_COR.get(n.corFinal) ?? null,
        origem: 'sante' as const,
      })),
      ...pront
        .filter((p) => !doNovo.has(p.registro))
        .map((p) => ({
          registro: p.registro,
          dataHora: p.dataHora,
          cor: p.opcao ? corDoTextoDaOpcao(p.opcao) : null,
          opcao: p.opcao,
          origem: 'prontuario' as const,
        })),
    ]
      .sort((p, q) => ms(q.dataHora) - ms(p.dataHora))
      .slice(0, 50);
  }

  /**
   * Confere e monta a classificação (inicial ou reclassificação) a partir da entrada, sobre o estado relido: o
   * atendimento aberto, o ator (regra 1), a versão vigente, o fluxograma e os discriminadores, a cor (regra 3) e, na
   * reclassificação, a vigente e o motivo (regra 4).
   */
  async preparar(
    s: SessaoClassificacao,
    e: ClassificarRiscoEntrada | ReclassificarRiscoEntrada,
    reclassificacao: boolean,
  ) {
    const a = await this.atendimentoAberto(s.c, e.atendimento);
    const ator = atorDoVinculo(await this.porta.vinculo(s.c, s.login));
    const r = recusaDaAcao(ator, reclassificacao ? 'reclassificar' : 'concluir');
    if (r)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Classificação não permitida',
        MENSAGENS_RECUSA_ATOR[r] ?? '',
        {
          codigo: r,
        },
      );
    if (encerradoNoPa(a.x))
      throw problema(
        409,
        'atendimento-encerrado',
        'Atendimento encerrado',
        'O atendimento já tem a decisão ou a saída registrada: não se classifica depois disso.',
      );
    const protocolo = await this.vigente(s.c);
    if (!protocolo || protocolo.versao.id !== e.versaoProtocolo)
      throw problema(
        409,
        'protocolo-substituido',
        'Protocolo atualizado',
        'Uma versão nova do protocolo foi publicada depois que você abriu a tela. Abra de novo (os sinais são mantidos).',
        ['versaoProtocolo'],
      );
    const conteudo = protocolo.conteudo;
    if (!conteudo.fluxogramas.some((f) => f.codigo === e.fluxograma))
      throw problema(
        422,
        'fluxograma-inexistente',
        'Fluxograma desconhecido',
        'Escolha um fluxograma do protocolo.',
        ['fluxograma'],
      );
    const pac = await this.atendimentos.pacienteDoAtendimento(s.c, e.atendimento);
    if (!pac) throw new ErroProblema('nao-encontrado', 404, 'Paciente do atendimento não encontrado');
    const prop = proporCor(
      conteudo,
      e.fluxograma,
      valoresDaClassificacao(e.sinais, idade(pac.nascimento, a.hoje)),
      e.discriminadores,
    );
    if (prop.desconhecidos.length > 0)
      throw problema(
        422,
        'discriminador-desconhecido',
        'Discriminador desconhecido',
        'Há discriminadores que não são deste fluxograma. Abra de novo.',
        ['discriminadores'],
      );
    const d = decidirCorFinal(prop.cor, e.corFinal, e.justificativaSobreposicao);
    if (!d.ok)
      throw problema(
        422,
        'justificativa-obrigatoria',
        'Justifique a cor',
        'A cor escolhida é diferente da proposta pelo protocolo: escreva a justificativa.',
        ['justificativaSobreposicao'],
      );
    const vigentes = a.linhas.map(vigenteDe);
    const vigente = classificacaoVigente(vigentes);
    let motivo: 'inicial' | 'estouro' | 'mudanca_quadro' = 'inicial';
    let anterior: number | null = null;
    let descricaoMudanca: string | null = null;
    if (reclassificacao) {
      const rr = e as ReclassificarRiscoEntrada;
      const p = problemaDaReclassificacao({
        vigente,
        anterior: rr.anterior,
        motivo: rr.motivo,
        agora: a.agora,
        atendimentoMedicoEm: marca(a.x, 'atendimentoMedico'),
        encerrado: false,
      });
      if (p) {
        const msg: Record<string, string> = {
          'sem-classificacao': 'O atendimento ainda não foi classificado: faça a classificação inicial.',
          'anterior-desatualizada':
            'A classificação mudou depois que você abriu. Abra de novo antes de reclassificar.',
          'sem-estouro':
            'O tempo-alvo ainda não estourou: para reclassificar antes, escolha "mudança do quadro" e descreva o que mudou.',
          'atendimento-encerrado': 'O atendimento já tem a decisão registrada.',
        };
        throw problema(409, p, 'Reclassificação não gravada', msg[p] ?? '');
      }
      motivo = rr.motivo;
      anterior = rr.anterior;
      descricaoMudanca = rr.descricaoMudanca ?? null;
    } else if (vigente)
      throw problema(
        409,
        'ja-classificado',
        'Já classificado',
        'Este atendimento já foi classificado: para mudar a cor, use Reclassificar.',
      );
    const tempoAlvoMin = tempoAlvoDaCor(conteudo, e.corFinal);
    const automaticos = new Set(prop.automaticos);
    return {
      a,
      pac,
      conteudo,
      protocolo,
      sobreposta: d.sobreposta,
      linha: {
        cabecalho: a.x.cabecalho,
        reg: a.x.reg,
        paciente: pac.id,
        versaoProtocolo: protocolo.versao.id,
        fluxograma: e.fluxograma,
        discriminadores: prop.presentes.map((x) => x.codigo),
        automaticos: prop.presentes.map((x) => x.codigo).filter((x) => automaticos.has(x)),
        sinais: sinaisSgh(e.sinais),
        corProposta: prop.cor,
        corFinal: e.corFinal,
        justificativa: d.sobreposta ? (e.justificativaSobreposicao ?? null) : null,
        motivo,
        descricaoMudanca,
        anterior,
        tempoAlvoMin,
        horaSinais: a.agora,
        autor: s.login,
      },
    };
  }

  /** O formulário do prontuário ligado? (a tela avisa quando fica só neste sistema) */
  async formularioLigado(): Promise<{ ligado: boolean; motivo: string | null }> {
    return this.formulario ? this.formulario.estado() : { ligado: false, motivo: MOTIVO_DESLIGADO_E08 };
  }

  get gravadorFormulario(): FormularioClassificacao | null {
    return this.formulario;
  }

  /** A linha gravada (relida), para a resposta. */
  async classificacaoGravada(c: ContextoClassificacao, cabecalho: string, id: number | null) {
    const ls = await this.porta.classificacoes(c, [cabecalho]);
    const l = id === null ? ls.at(-1) : ls.find((x) => x.id === id);
    if (!l) throw new ErroProblema('erro-interno', 500, 'Classificação não relida depois da gravação');
    return l;
  }

  // ── Sinais do técnico ───────────────────────────────────────────────────────────────────────────

  async prepararSinais(s: SessaoClassificacao, atendimento: number) {
    const a = await this.atendimentoAberto(s.c, atendimento);
    const ator = atorDoVinculo(await this.porta.vinculo(s.c, s.login));
    const r = recusaDaAcao(ator, 'registrarSinais');
    if (r)
      throw new ErroProblema('sem-permissao', 403, 'Registro não permitido', MENSAGENS_RECUSA_ATOR[r] ?? '', {
        codigo: r,
      });
    if (encerradoNoPa(a.x))
      throw problema(
        409,
        'atendimento-encerrado',
        'Atendimento encerrado',
        'O atendimento já foi encerrado.',
      );
    const pac = await this.atendimentos.pacienteDoAtendimento(s.c, atendimento);
    if (!pac) throw new ErroProblema('nao-encontrado', 404, 'Paciente do atendimento não encontrado');
    return { a, pac };
  }

  // ── Painel de TV e estouro ─────────────────────────────────────────────────────────────────────

  /** O painel de TV do PA: senha ou iniciais, cor com o nome e a espera; nunca nome nem diagnóstico. */
  async painel(c: ContextoClassificacao) {
    const a = await this.abertos(c);
    const abertos = a.itens.filter((x) => !encerradoNoPa(x));
    const [{ porReg, porCor }, ids] = await Promise.all([
      this.riscosDoQuadro(c, abertos),
      this.identidades(c, abertos),
    ]);
    const linhas = abertos
      .map((x) => {
        const risco = porReg.get(x.reg) ?? null;
        return {
          x,
          risco,
          cartao: cartaoDoPainel({
            senha: x.senha,
            // Nome social quando houver; o sigiloso não tem iniciais (só a senha).
            iniciais: iniciaisDaChamada(ids.get(x.reg) ?? { nome: x.paciente }) ?? '',
            risco,
            minutosTotal: Math.max(0, Math.floor((ms(a.agora) - ms(x.chegada || a.agora)) / MS_MIN)),
          }),
        };
      })
      .sort(
        (p, q) =>
          (p.risco?.prioridade ?? 9) - (q.risco?.prioridade ?? 9) ||
          ms(p.risco?.prazoEm ?? p.x.chegada) - ms(q.risco?.prazoEm ?? q.x.chegada),
      );
    return { agora: a.agora, linhas: linhas.map((l) => l.cartao), porCor };
  }

  /** Os estourados sem atendimento médico que ainda não foram avisados (o `worker` grava o aviso). */
  async estourados(c: ContextoClassificacao) {
    const a = await this.abertos(c);
    const r: { chave: string; classificacao: number; reg: number; prazoEm: string; cor: CorRisco }[] = [];
    for (const x of a.itens) {
      if (encerradoNoPa(x)) continue;
      const v = classificacaoVigente((a.porCab.get(x.cabecalho) ?? []).map(vigenteDe));
      if (!v || !reclassificacaoObrigatoria(v, a.agora, marca(x, 'atendimentoMedico'))) continue;
      r.push({
        chave: chaveAvisoEstouro(c.hospital, v.id),
        classificacao: v.id,
        reg: x.reg,
        prazoEm: new Date(ms(v.classificadoEm) + v.tempoAlvoMin * MS_MIN).toISOString(),
        cor: v.cor,
      });
    }
    const ja = await this.porta.avisosGravados(
      c,
      r.map((x) => x.chave),
    );
    return r.filter((x) => !ja.has(x.chave));
  }

  // ── Indicadores (regra 5) ──────────────────────────────────────────────────────────────────────

  /**
   * Os indicadores do período pelo motor do domínio (`indicadoresClassificacao`), num único universo: os atendimentos
   * do PA do período (as marcas de SGH_PA_ETAPA, abertos ou já encerrados) somados aos classificados no período
   * (SGH_PA_CLASSIFICACAO). De cada um: a chegada, a primeira classificação (a cor inicial e o tempo-alvo dela), o
   * atendimento médico e o número de reclassificações. `agora` é o fim da conta (o prazo vencido sem médico conta
   * como fora do tempo-alvo; o prazo ainda correndo fica fora do denominador).
   */
  async indicadores(
    c: ContextoClassificacao,
    inicio: string,
    fim: string,
    marcasPa: readonly { cabecalho: string; etapa: string; em: string }[],
    agora: string,
  ): Promise<IndicadoresClassificacaoPa> {
    const doPeriodo = await this.porta.classificacoesDoPeriodo(
      c,
      `${inicio}T00:00:00`,
      `${diaSeguinte(fim)}T00:00:00`,
    );
    const marcasPorCab = new Map<string, { etapa: string; em: string }[]>();
    for (const m of marcasPa)
      (marcasPorCab.get(m.cabecalho) ?? marcasPorCab.set(m.cabecalho, []).get(m.cabecalho)!).push(m);
    const cabs = [...new Set([...marcasPorCab.keys(), ...doPeriodo.map((l) => l.cabecalho)])];
    const porCab = new Map<string, ClassificacaoLida[]>();
    for (const l of await this.porta.classificacoes(c, cabs))
      (porCab.get(l.cabecalho) ?? porCab.set(l.cabecalho, []).get(l.cabecalho)!).push(l);
    const primeiraMarca = (ms: readonly { etapa: string; em: string }[], etapa: string) =>
      ms
        .filter((m) => m.etapa === etapa && m.em)
        .map((m) => m.em)
        .sort()[0] ?? null;
    const itens: AtendimentoClassificado[] = cabs.map((cab) => {
      const ms = marcasPorCab.get(cab) ?? [];
      const ls = [...(porCab.get(cab) ?? [])].sort((p, q) => p.em.localeCompare(q.em) || p.id - q.id);
      const primeira = ls[0] ?? null;
      return {
        chegada: primeiraMarca(ms, 'chegada') ?? primeiraMarca(ms, 'abertura'),
        classificadoEm: primeira?.em ?? null,
        corInicial: primeira && NOME_COR.has(primeira.corFinal) ? (primeira.corFinal as CorRisco) : null,
        tempoAlvoMin: primeira?.tempoAlvoMin ?? null,
        atendimentoMedicoEm: primeiraMarca(ms, 'atendimentoMedico'),
        reclassificacoes: ls.filter((l) => l.motivo !== 'inicial').length,
      };
    });
    const fimDoPeriodo = `${diaSeguinte(fim)}T00:00:00`;
    const r = indicadoresClassificacao(itens, agora < fimDoPeriodo ? agora : fimDoPeriodo);
    return {
      inicio,
      fim,
      portaClassificacao: {
        medianaMin: r.portaClassificacao.medianaMin,
        atendimentos: r.atendimentos,
        comMarca: r.portaClassificacao.amostra,
      },
      portaMedico: {
        medianaMin: r.portaMedico.medianaMin,
        atendimentos: r.atendimentos,
        comMarca: r.portaMedico.amostra,
      },
      dentroDoAlvo: r.dentroDoTempoAlvo.map((x) => ({
        cor: x.cor,
        numerador: x.numerador,
        denominador: x.denominador,
        percentual: x.percentual,
      })),
      reclassificacoes: { ...r.reclassificados },
    };
  }

  /** Os discriminadores do fluxograma (tela). */
  discriminadores(conteudo: ConteudoProtocolo, fluxograma: string) {
    return discriminadoresDoFluxograma(conteudo, fluxograma);
  }
}

/** Iniciais do nome (painel de TV sem senha): "MARIA APARECIDA" → "M. A." */
export function iniciais(nome: string): string {
  return nome
    .split(/\s+/)
    .filter((p) => p.length > 2)
    .slice(0, 3)
    .map((p) => `${p.charAt(0).toUpperCase()}.`)
    .join(' ');
}
