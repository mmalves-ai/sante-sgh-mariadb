// Serviço da autorização de guias e da auditoria médica da operadora própria (M56, etapa 5, F4): monta as respostas da
// tela a partir das leituras da porta e decide no servidor o que a tela só mostra: os rótulos dos domínios (o do
// vocabulário quando o código é fixo; o do banco nas críticas, editáveis pela operadora), a conferência do pedido
// (terminologia TUSS, CID, internação, guia principal), o prazo da resposta pelo relógio do banco, as críticas
// automáticas (elegibilidade, segmentação, carências, rede), quem pode decidir (o auditor designado e vigente da operadora
// do beneficiário; negar e cortar só o médico), a senha e a validade e o comunicado da negativa (@sgh/dominio-operadora).
// As gravações passam pelas recusas das regras antes de chegar ao banco; a versão vista e a situação de partida são do
// banco.
import {
  type AbrirJuntaEntrada,
  type ApoioAutorizacoes,
  type AuditorOperadora,
  type AutorizacaoDetalhe,
  type AutorizacaoResumo,
  type CriticaAutomatica,
  type DecidirAutorizacaoEntrada,
  type DesignarAuditorEntrada,
  MENSAGENS_AUTORIZACAO,
  ORIGENS_ATENDIMENTO_OPERADORA,
  type RegistrarAutorizacaoEntrada,
  SITUACOES_EM_ABERTO,
  SITUACOES_GUIA_OPERADORA,
  TIPO_GUIA,
  TABELA_PROCEDIMENTOS,
  TIPOS_GUIA_OPERADORA,
} from '@sgh/contratos';
import {
  type AcaoAutorizacao,
  acaoPermitida,
  avaliarElegibilidade,
  carteirinhaValida,
  comunicadoDaNegativa,
  conferirDecisao,
  conselhoDoAuditor,
  criticasAutomaticas,
  type PeriodoSuspensao,
  suspensaoNaData,
  criticasDaRegraRol,
  designacaoVigente,
  negativaParaRegistro,
  nomeDeBusca,
  parametrosDosPrazos,
  prazoDaRespostaRegulatorio,
  problemasDaAlcada,
  type Problema,
  problemasDaDesignacao,
  problemasDaJunta,
  problemasDoPedido,
  type ResultadoDecisao,
  situacaoGuiaTiss,
} from '@sgh/dominio-operadora';
import {
  type DadosAuditor,
  type DadosAutorizacao,
  type DadosAutorizacaoResumo,
  type DadosElegibilidadeBeneficiario,
  type DadosItemDominioAutorizacao,
  type DominioAutorizacao,
  type EntradaItemRegistro,
  type EntradaRegistroAutorizacao,
  type FiltroAutorizacoesPorta,
  type NegativaDaDecisao,
} from './dados-portas.js';
import { ErroProblema } from '../../problema.filter.js';

type PrestadorDaCritica = {
  situacao: string;
  regime: number;
  suspensoes?: readonly PeriodoSuspensao[] | undefined;
};
import type { ContextoAutorizacao, PortaAutorizacaoOperadora } from './autorizacao-porta.js';

/** Rótulos do vocabulário dos domínios fixos (o banco tem alguns abreviados, como "Liberação de guias" com a sigla). */
const VOCABULARIO: Partial<Record<DominioAutorizacao, Readonly<Record<number, string>>>> = {
  tipoGuia: TIPOS_GUIA_OPERADORA,
  origem: ORIGENS_ATENDIMENTO_OPERADORA,
  situacaoGuia: SITUACOES_GUIA_OPERADORA,
};

/** Rótulo em maiúsculas vira frase (só a primeira letra maiúscula); o resto fica como o banco tem. */
function frase(t: string): string {
  const s = t.trim();
  return s && s === s.toUpperCase() && /[A-Z]/.test(s) ? s.charAt(0) + s.slice(1).toLowerCase() : s;
}

export function rotulosDaAutorizacao(
  d: Record<DominioAutorizacao, DadosItemDominioAutorizacao[]>,
): ApoioAutorizacoes['dominios'] {
  const r = (k: DominioAutorizacao) =>
    d[k].map((x) => ({
      codigo: x.codigo,
      rotulo: VOCABULARIO[k]?.[x.codigo] ?? (frase(x.rotulo) || String(x.codigo)),
    }));
  return {
    tipoGuia: r('tipoGuia'),
    origem: r('origem'),
    critica: d.critica.map((x) => ({
      codigo: x.codigo,
      rotulo: frase(x.rotulo) || String(x.codigo),
      extraContrato: x.extraContrato === true,
    })),
    situacaoGuia: r('situacaoGuia'),
  };
}

/** Recusa das regras: 409 com o primeiro código, os campos e os textos. */
export function recusaDasRegras(problemas: readonly Problema[]): ErroProblema {
  const [p] = problemas;
  return new ErroProblema(
    'recusa-de-negocio',
    409,
    'Operação recusada',
    [...new Set(problemas.map((x) => MENSAGENS_AUTORIZACAO[x.codigo] ?? x.codigo))].join(' '),
    {
      codigo: p?.codigo ?? 'recusa',
      campos: [...new Set(problemas.map((x) => x.campo).filter((c): c is string => !!c))],
      bloqueios: problemas.map((x) => x.codigo),
    },
  );
}

const naoEncontrada = () =>
  new ErroProblema(
    'nao-encontrado',
    404,
    'Pedido não encontrado',
    'O pedido de autorização não está nesta operadora.',
  );

const dataBr = (d: string) => d.slice(0, 10).split('-').reverse().join('/');
const quando = (d: string) => `${dataBr(d)} ${d.slice(11, 16)}`;

export function resumoDe(a: DadosAutorizacaoResumo): AutorizacaoResumo {
  return {
    id: a.id,
    protocolo: a.protocolo,
    beneficiarioNome: a.beneficiarioNome,
    carteirinha: a.carteirinha,
    prestador: a.prestador,
    prestadorNome: a.prestadorNome,
    tipoGuia: a.tipoGuia,
    carater: a.carater,
    situacao: a.situacao,
    solicitadaEm: a.solicitadaEm,
    prazoEm: a.prazoEm,
    vencida: a.vencida,
    senha: a.senha,
    versao: a.versao,
  };
}

export const auditorDe = (a: DadosAuditor): AuditorOperadora => ({ ...a });

export interface PedidoConferido {
  readonly registro: Omit<EntradaRegistroAutorizacao, 'hospital' | 'protocolo' | 'usuario'>;
  readonly registroAns: string;
  readonly avisos: string[];
}

export class ServicoAutorizacaoOperadora {
  constructor(readonly porta: PortaAutorizacaoOperadora) {}

  /** A designação vigente do usuário na operadora (ou em qualquer uma, sem a operadora). */
  async designacao(
    c: ContextoAutorizacao,
    login: string,
    operadora: number | null,
  ): Promise<DadosAuditor | null> {
    const [ds, { hoje }] = await Promise.all([this.porta.designacoes(c, login), this.porta.relogio(c)]);
    return (
      ds.find((d) => (operadora === null || d.operadora === operadora) && designacaoVigente(d, hoje)) ?? null
    );
  }

  async apoio(
    c: ContextoAutorizacao,
    x: {
      ligada: boolean;
      motivo: string | null;
      podeRegistrar: boolean;
      podeDecidir: boolean;
      podeDesignar: boolean;
      login: string;
    },
  ): Promise<ApoioAutorizacoes> {
    const [dominios, relogio] = await Promise.all([this.porta.dominios(c), this.porta.relogio(c)]);
    // Com a fatia desligada, nada da operadora é lido (só os domínios do estabelecimento; D-LEITURA-56).
    const [operadoras, prestadores, auditor] = x.ligada
      ? await Promise.all([
          this.porta.operadoras(c),
          this.porta.prestadores(c),
          this.designacao(c, x.login, null),
        ])
      : [[], [], null];
    return {
      dominios: rotulosDaAutorizacao(dominios),
      operadoras: operadoras.map((o) => ({
        id: o.id,
        nome: o.nomeFantasia ?? o.razaoSocial,
        registroAns: o.registroAns,
      })),
      // O prestador sem regime (cadastro incompleto) não entra na escolha até o cadastro completar.
      prestadores: prestadores.flatMap((p) => (p.regime === null ? [] : [{ ...p, regime: p.regime }])),
      auditor: auditor ? auditorDe(auditor) : null,
      ligada: x.ligada,
      motivo: x.motivo,
      podeRegistrar: x.podeRegistrar && x.ligada,
      podeDecidir: x.podeDecidir && x.ligada,
      podeDesignar: x.podeDesignar && x.ligada,
      hoje: relogio.hoje,
      // C2-122: os prazos vigentes do cadastro regulatório (RN 395).
      parametros: parametrosDosPrazos(await this.porta.prazosRegulatorios(c), relogio.hoje),
    };
  }

  /** A busca: protocolo, senha ou carteirinha pelos dígitos; o resto pelo início do nome do beneficiário. */
  filtro(f: {
    busca?: string | undefined;
    situacao?: FiltroAutorizacoesPorta['situacao'] | undefined;
    vencidas?: boolean | undefined;
    prestador?: number | undefined;
    apos?: number | undefined;
  }): FiltroAutorizacoesPorta {
    const b = f.busca?.trim() ?? '';
    const d = b.replace(/[\s.\-/]/g, '');
    const busca = b ? (/^\d{16}$|^\d{20}$/.test(d) ? d : nomeDeBusca(b)) : '';
    return {
      ...(busca ? { busca } : {}),
      ...(f.situacao ? { situacao: f.situacao } : {}),
      ...(f.vencidas ? { vencidas: true } : {}),
      ...(f.prestador !== undefined ? { prestador: f.prestador } : {}),
      ...(f.apos !== undefined ? { apos: f.apos } : {}),
    };
  }

  private async elegibilidadeNaData(c: ContextoAutorizacao, carteirinha: string, data: string) {
    const el = await this.porta.elegibilidade(c, carteirinha);
    const avaliada = avaliarElegibilidade(
      carteirinha,
      el
        ? {
            beneficiario: { situacao: el.beneficiario.situacao, inclusao: el.beneficiario.inclusao },
            contrato: {
              situacao: el.contrato.situacao as 'ativo',
              inicio: el.contrato.inicio,
              fim: el.contrato.fim,
            },
            produto: {
              situacao: el.produto.situacao as 'ativo',
              natureza: el.produto.natureza,
              carencias: el.produto.carencias,
            },
          }
        : null,
      data,
    );
    return { el, avaliada };
  }

  /** As críticas automáticas do pedido na data (o beneficiário, o plano e a rede de hoje). */
  async criticas(
    c: ContextoAutorizacao,
    p: {
      carteirinha: string;
      carater: 'E' | 'U';
      tipoGuia: number;
      internacaoTipo: number | null;
      comGuiaPrincipal: boolean;
      prestador: number;
      executante: number | null;
      /** C2-122: os procedimentos do pedido, para as regras de cobertura do rol da operadora. */
      rol?: {
        operadora: number;
        beneficiario: number;
        itens: readonly { codigo: string; quantidade: number }[];
      };
    },
    hoje: string,
  ): Promise<CriticaAutomatica[]> {
    const [{ el, avaliada }, prestador, executante, rol] = await Promise.all([
      this.elegibilidadeNaData(c, p.carteirinha, hoje),
      this.porta.prestador(c, p.prestador),
      p.executante ? this.porta.prestador(c, p.executante) : Promise.resolve(null),
      p.rol
        ? this.porta.regrasDoRol(
            c,
            p.rol.operadora,
            p.rol.beneficiario,
            p.rol.itens.map((i) => i.codigo),
          )
        : Promise.resolve(null),
    ]);
    const doRol =
      rol && p.rol
        ? criticasDaRegraRol(rol.regras, {
            sexo: rol.sexo,
            nascimento: rol.nascimento,
            hoje,
            itens: p.rol.itens,
          })
        : [];
    return [...this.criticasDoPlano(p, el, avaliada, prestador, executante, hoje), ...doRol];
  }

  private criticasDoPlano(
    p: {
      carater: 'E' | 'U';
      tipoGuia: number;
      internacaoTipo: number | null;
      comGuiaPrincipal: boolean;
      executante: number | null;
    },
    el: Awaited<ReturnType<ServicoAutorizacaoOperadora['elegibilidadeNaData']>>['el'],
    avaliada: Awaited<ReturnType<ServicoAutorizacaoOperadora['elegibilidadeNaData']>>['avaliada'],
    prestador: PrestadorDaCritica | null,
    executante: PrestadorDaCritica | null,
    hoje: string,
  ): CriticaAutomatica[] {
    // C2-118: a suspensão do prestador inteiro vigente na data bloqueia (a do local não: o pedido não traz o local).
    const naCritica = (q: PrestadorDaCritica) => ({
      situacao: q.situacao,
      regime: q.regime,
      suspenso: suspensaoNaData(q.suspensoes ?? [], hoje) !== null,
    });
    return criticasAutomaticas({
      elegibilidade: avaliada,
      produto: el
        ? { natureza: el.produto.natureza, segmentacao: el.produto.segmentacao }
        : { natureza: 'plano', segmentacao: null },
      pedido: {
        carater: p.carater,
        tipoGuia: p.tipoGuia,
        internacaoTipo: p.internacaoTipo,
        comGuiaPrincipal: p.comGuiaPrincipal,
      },
      prestador: prestador ? naCritica(prestador) : null,
      temExecutante: p.executante !== null,
      executante: executante ? naCritica(executante) : null,
    });
  }

  /** As regras do pedido; devolve o que a gravação leva (sem o protocolo, dado na transação). */
  async conferirRegistro(
    c: ContextoAutorizacao,
    e: RegistrarAutorizacaoEntrada,
  ): Promise<PedidoConferido & { el: DadosElegibilidadeBeneficiario }> {
    if (!carteirinhaValida(e.carteirinha))
      throw recusaDasRegras([{ codigo: 'carteirinha-invalida', campo: 'carteirinha' }]);
    const codigosTuss = e.itens.filter((i) => i.tabela === TABELA_PROCEDIMENTOS).map((i) => i.codigo);
    const [el, prestador, executante, dominios, tuss, cidNome, principal, relogio] = await Promise.all([
      this.porta.elegibilidade(c, e.carteirinha),
      this.porta.prestador(c, e.prestador),
      e.executante ? this.porta.prestador(c, e.executante) : Promise.resolve(null),
      this.porta.dominios(c),
      this.porta.procedimentosTuss(c, codigosTuss),
      e.cid ? this.porta.nomeDoCid(c, e.cid) : Promise.resolve(null),
      e.guiaPrincipal ? this.porta.autorizacao(c, e.guiaPrincipal) : Promise.resolve(null),
      this.porta.relogio(c),
    ]);
    const existencia: Problema[] = [];
    if (!el) existencia.push({ codigo: 'beneficiario-inexistente', campo: 'carteirinha' });
    if (!prestador) existencia.push({ codigo: 'prestador-inexistente', campo: 'prestador' });
    if (e.executante && !executante)
      existencia.push({ codigo: 'executante-inexistente', campo: 'executante' });
    if (existencia.length || !el) throw recusaDasRegras(existencia);
    const porCodigo = new Map(tuss.map((t) => [t.codigo, t]));
    const problemas = problemasDoPedido(e, {
      tiposGuia: new Set(dominios.tipoGuia.map((x) => x.codigo)),
      origens: new Set(dominios.origem.map((x) => x.codigo)),
      hoje: relogio.hoje,
      procedimentos: porCodigo,
      cidExiste: e.cid ? cidNome !== null : null,
      guiaPrincipal: principal
        ? { beneficiario: principal.beneficiario, tipoGuia: principal.tipoGuia, situacao: principal.situacao }
        : null,
      beneficiario: el.beneficiario.id,
    });
    if (problemas.length) throw recusaDasRegras(problemas);
    const operadora = (await this.porta.operadoras(c)).find((o) => o.id === el.beneficiario.operadora);
    if (!operadora) throw recusaDasRegras([{ codigo: 'operadora-inexistente', campo: 'carteirinha' }]);
    // C2-122: o prazo da resposta pelo cadastro regulatório vigente (prazo_atendimento_regulatorio).
    const prazo = prazoDaRespostaRegulatorio(e, relogio.agora, await this.porta.prazosRegulatorios(c));
    const itens: EntradaItemRegistro[] = e.itens.map((i) => ({
      tabela: i.tabela,
      codigo: i.codigo,
      descricao:
        (i.tabela === TABELA_PROCEDIMENTOS ? porCodigo.get(i.codigo)?.nome : i.descricao) ?? i.codigo,
      quantidade: i.quantidade,
    }));
    const criticas = await this.criticas(
      c,
      {
        carteirinha: e.carteirinha,
        carater: e.carater,
        tipoGuia: e.tipoGuia,
        internacaoTipo: e.internacao?.tipo ?? null,
        comGuiaPrincipal: e.guiaPrincipal !== null,
        prestador: e.prestador,
        executante: e.executante,
        rol: {
          operadora: operadora.id,
          beneficiario: el.beneficiario.id,
          itens: e.itens.map((i) => ({ codigo: i.codigo, quantidade: i.quantidade })),
        },
      },
      relogio.hoje,
    );
    return {
      el,
      registroAns: operadora.registroAns,
      avisos: criticas.map((x) => x.texto),
      registro: {
        operadora: operadora.id,
        beneficiario: el.beneficiario.id,
        carteirinha: e.carteirinha,
        prestador: e.prestador,
        executante: e.executante,
        guiaPrincipal: e.guiaPrincipal,
        tipoGuia: e.tipoGuia,
        carater: e.carater,
        altaComplexidade: e.altaComplexidade,
        origem: e.origem,
        solicitadaEm: relogio.agora,
        prazoTipo: prazo.tipo,
        prazoEm: prazo.prazoEm,
        cid: e.cid,
        indicacaoClinica: e.indicacaoClinica,
        profissional: { ...e.profissional },
        internacao: e.internacao ? { ...e.internacao } : null,
        itens,
        criticas: criticas.map((x) => ({ codigo: x.codigo, texto: x.texto, bloqueia: x.bloqueia })),
      },
    };
  }

  private async pedido(c: ContextoAutorizacao, id: number, acao: AcaoAutorizacao): Promise<DadosAutorizacao> {
    const a = await this.porta.autorizacao(c, id);
    if (!a) throw naoEncontrada();
    if (!acaoPermitida(a.situacao, acao))
      throw recusaDasRegras([{ codigo: 'situacao-nao-permite', campo: 'situacao' }]);
    return a;
  }

  /** W0-10: o anexo de uma resposta do prestador ao complemento (download na ficha; 404 se não é desta autorização). */
  async anexoDoComplemento(
    c: ContextoAutorizacao,
    id: number,
    anexo: number,
  ): Promise<{ nome: string; tipo: string; sha256: string; bytes: Buffer }> {
    const x = await this.porta.anexoDoComplemento(c, anexo);
    if (!x || x.autorizacao !== id) throw naoEncontrada();
    return { nome: x.nome, tipo: x.tipo, sha256: x.sha256, bytes: x.bytes };
  }

  async detalhe(c: ContextoAutorizacao, id: number): Promise<AutorizacaoDetalhe> {
    const a = await this.porta.autorizacao(c, id);
    if (!a) throw naoEncontrada();
    const [itens, eventos, relogio, cidNome, dominios, anexos] = await Promise.all([
      this.porta.itens(c, id),
      this.porta.eventos(c, id),
      this.porta.relogio(c),
      a.cid ? this.porta.nomeDoCid(c, a.cid) : Promise.resolve(null),
      this.porta.dominios(c),
      this.porta.anexosDoComplemento(c, id),
    ]);
    const aberta = SITUACOES_EM_ABERTO.includes(a.situacao);
    const criticas = aberta
      ? await this.criticas(
          c,
          {
            carteirinha: a.carteirinha,
            carater: a.carater,
            tipoGuia: a.tipoGuia,
            internacaoTipo: a.internacao?.tipo ?? null,
            comGuiaPrincipal: a.guiaPrincipal !== null,
            prestador: a.prestador,
            executante: a.executante,
          },
          relogio.hoje,
        )
      : [];
    const rotuloCritica =
      a.critica === null
        ? null
        : (rotulosDaAutorizacao(dominios).critica.find((x) => x.codigo === a.critica)?.rotulo ??
          String(a.critica));
    return {
      id: a.id,
      operadora: a.operadora,
      protocolo: a.protocolo,
      beneficiario: {
        id: a.beneficiario,
        nome: a.beneficiarioNome,
        carteirinha: a.carteirinha,
        nascimento: a.beneficiarioNascimento,
        sexo: a.beneficiarioSexo,
        plano: a.produtoNome,
        segmentacao: a.segmentacao,
      },
      prestador: { id: a.prestador, nome: a.prestadorNome },
      executante: a.executante ? { id: a.executante, nome: a.executanteNome ?? String(a.executante) } : null,
      guiaPrincipal: a.guiaPrincipal
        ? { id: a.guiaPrincipal, protocolo: a.guiaPrincipalProtocolo ?? '' }
        : null,
      tipoGuia: a.tipoGuia,
      carater: a.carater,
      altaComplexidade: a.altaComplexidade,
      origem: a.origem,
      cid: a.cid,
      cidNome: cidNome ? frase(cidNome) : null,
      indicacaoClinica: a.indicacaoClinica,
      profissional: {
        nome: a.profissional.nome,
        conselho: a.profissional.conselho as AutorizacaoDetalhe['profissional']['conselho'],
        numero: a.profissional.numero,
        uf: a.profissional.uf as AutorizacaoDetalhe['profissional']['uf'],
      },
      internacao: a.internacao ? { ...a.internacao } : null,
      situacao: a.situacao,
      situacaoGuia: situacaoGuiaTiss(a.situacao),
      solicitadaEm: a.solicitadaEm,
      prazoTipo: a.prazoTipo,
      prazoEm: a.prazoEm,
      vencida: a.vencida,
      complementoPedido: a.complementoPedido,
      complementoResposta: a.complementoResposta,
      junta: a.junta ? { ...a.junta } : null,
      decisao:
        a.decididaEm && a.parecer
          ? {
              em: a.decididaEm,
              por: a.decididaPor ?? '',
              auditor: a.auditorNome ?? '',
              critica: a.critica,
              fundamento: a.fundamento,
              parecer: a.parecer,
            }
          : null,
      senha: a.senha,
      senhaValidade: a.senhaValidade,
      motivoCancelamento: a.motivoCancelamento,
      itens: itens.map((i) => ({ ...i })),
      eventos: eventos.map((e) => ({ ...e })),
      criticas,
      anexos: anexos.map((x) => ({
        id: x.id,
        evento: x.evento,
        nome: x.nome,
        tipo: x.tipo,
        tamanho: x.tamanho,
        sha256: x.sha256,
      })),
      comunicado: comunicadoDaNegativa({
        situacao: a.situacao,
        protocolo: a.protocolo,
        beneficiario: a.beneficiarioNome,
        decididaEm: a.decididaEm,
        critica: rotuloCritica,
        fundamento: a.fundamento,
        parecer: a.parecer,
        negados: itens
          .filter((i) => i.situacao === 'negado' || i.situacao === 'parcial')
          .map(
            (i) =>
              `${i.codigo} ${i.descricao} (${i.quantidadeAutorizada ?? 0} de ${i.quantidadeSolicitada} autorizados)`,
          ),
      }),
      versao: a.versao,
    };
  }

  /** O auditor designado e vigente na operadora do pedido (ou a recusa). */
  private async auditorDoPedido(
    c: ContextoAutorizacao,
    login: string,
    a: DadosAutorizacao,
  ): Promise<DadosAuditor | null> {
    return this.designacao(c, login, a.operadora);
  }

  async conferirComplemento(c: ContextoAutorizacao, id: number, login: string): Promise<DadosAutorizacao> {
    const a = await this.pedido(c, id, 'pedirComplemento');
    if (!(await this.auditorDoPedido(c, login, a)))
      throw recusaDasRegras([{ codigo: 'auditor-nao-designado', campo: 'auditor' }]);
    return a;
  }

  conferirResposta(c: ContextoAutorizacao, id: number): Promise<DadosAutorizacao> {
    return this.pedido(c, id, 'responderComplemento');
  }

  async conferirJunta(c: ContextoAutorizacao, id: number, e: AbrirJuntaEntrada, login: string) {
    const a = await this.pedido(c, id, 'abrirJunta');
    const [auditor, { hoje }] = await Promise.all([this.auditorDoPedido(c, login, a), this.porta.relogio(c)]);
    const p = problemasDaJunta(e, a.profissional, auditor, hoje);
    if (p.length) throw recusaDasRegras(p);
    return a;
  }

  /** A decisão (ou a conclusão da junta): o auditor vigente, as críticas de hoje e as quantidades. */
  async conferirDecisao(
    c: ContextoAutorizacao,
    id: number,
    e: Pick<DecidirAutorizacaoEntrada, 'decisao' | 'itens' | 'diariasAutorizadas' | 'critica' | 'fundamento'>,
    login: string,
    junta: boolean,
  ): Promise<{
    a: DadosAutorizacao;
    auditor: DadosAuditor;
    resultado: ResultadoDecisao;
    registroAns: string;
    hoje: string;
    negativa: NegativaDaDecisao | null;
  }> {
    const a = await this.pedido(c, id, junta ? 'concluirJunta' : 'decidir');
    const [auditor, itens, dominios, relogio, operadoras] = await Promise.all([
      this.auditorDoPedido(c, login, a),
      this.porta.itens(c, id),
      this.porta.dominios(c),
      this.porta.relogio(c),
      this.porta.operadoras(c),
    ]);
    const criticas = await this.criticas(
      c,
      {
        carteirinha: a.carteirinha,
        carater: a.carater,
        tipoGuia: a.tipoGuia,
        internacaoTipo: a.internacao?.tipo ?? null,
        comGuiaPrincipal: a.guiaPrincipal !== null,
        prestador: a.prestador,
        executante: a.executante,
        rol: {
          operadora: a.operadora,
          beneficiario: a.beneficiario,
          itens: itens.map((i) => ({ codigo: i.codigo, quantidade: i.quantidadeSolicitada })),
        },
      },
      relogio.hoje,
    );
    const resultado = conferirDecisao(
      {
        tipoGuia: a.tipoGuia,
        itens: itens.map((i) => ({ id: i.id, quantidadeSolicitada: i.quantidadeSolicitada })),
        diariasSolicitadas: a.internacao?.diarias ?? null,
      },
      e,
      auditor,
      criticas,
      new Set(dominios.critica.map((x) => x.codigo)),
    );
    if (resultado.problemas.length || !auditor) throw recusaDasRegras(resultado.problemas);
    // C2-122: a alçada do autorizador (alcada_autorizador_plano ligada ao auditor) e o limite de valor do auditor.
    const alcada = await this.porta.alcadaDoAuditor(c, auditor.id);
    const valores = new Map(itens.map((i) => [i.id, i.valorReferencia ?? null]));
    const foraDaAlcada = problemasDaAlcada(
      alcada.alcada,
      alcada.limite,
      {
        situacao: resultado.situacao,
        itens: resultado.itens.map((i) => ({
          quantidade: i.quantidade,
          valorUnitario: valores.get(i.id) ?? null,
        })),
        prorrogacao: a.tipoGuia === TIPO_GUIA.internacao && a.guiaPrincipal !== null,
      },
      relogio.hoje,
    );
    if (foraDaAlcada.length) throw recusaDasRegras(foraDaAlcada);
    const registroAns = operadoras.find((o) => o.id === a.operadora)?.registroAns;
    if (!registroAns) throw recusaDasRegras([{ codigo: 'operadora-inexistente' }]);
    // C2-122: a negativa formal (RN 395) da decisão negada ou parcial, com o comunicado ao beneficiário.
    const decididos = new Map(resultado.itens.map((i) => [i.id, i]));
    const negativa = negativaParaRegistro({
      situacao: resultado.situacao,
      numeroGuia: a.protocolo,
      criticas: criticas.map((x) => x.codigo),
      fundamento: e.fundamento,
      comunicado: comunicadoDaNegativa({
        situacao: resultado.situacao,
        protocolo: a.protocolo,
        beneficiario: a.beneficiarioNome,
        decididaEm: relogio.hoje,
        critica: dominios.critica.find((x) => x.codigo === e.critica)?.rotulo ?? null,
        fundamento: e.fundamento,
        parecer: null,
        negados: itens
          .filter((i) => decididos.get(i.id)?.situacao !== 'autorizado')
          .map(
            (i) =>
              `${i.codigo} ${i.descricao} (${decididos.get(i.id)?.quantidade ?? 0} de ${i.quantidadeSolicitada} autorizados)`,
          ),
      }),
    });
    return { a, auditor, resultado, registroAns, hoje: relogio.hoje, negativa };
  }

  conferirCancelamento(c: ContextoAutorizacao, id: number): Promise<DadosAutorizacao> {
    return this.pedido(c, id, 'cancelar');
  }

  async conferirDesignacao(c: ContextoAutorizacao, e: DesignarAuditorEntrada) {
    const [operadoras, { hoje }] = await Promise.all([this.porta.operadoras(c), this.porta.relogio(c)]);
    const p = problemasDaDesignacao(e, hoje);
    if (!operadoras.some((o) => o.id === e.operadora))
      p.push({ codigo: 'operadora-inexistente', campo: 'operadora' });
    if (p.length) throw recusaDasRegras(p);
    return { conselho: conselhoDoAuditor(e.categoria) };
  }

  /** W0-10: alterar os dados só da designação ativa; o conselho segue a categoria. */
  async conferirAlteracao(c: ContextoAutorizacao, id: number, categoria: 'medico' | 'enfermeiro') {
    const a = await this.conferirEncerramento(c, id);
    return { a, conselho: conselhoDoAuditor(categoria) };
  }

  async conferirEncerramento(c: ContextoAutorizacao, id: number): Promise<DadosAuditor> {
    const a = await this.porta.auditor(c, id);
    if (!a) throw recusaDasRegras([{ codigo: 'auditor-inexistente', campo: 'id' }]);
    if (a.situacao !== 'ativo')
      throw recusaDasRegras([{ codigo: 'auditor-ja-encerrado', campo: 'situacao' }]);
    return a;
  }

  /** A mensagem do registro: o protocolo e o prazo da resposta. */
  static mensagemDoRegistro(protocolo: string, prazoTipo: string, prazoEm: string): string {
    return prazoTipo === 'imediato'
      ? `Pedido registrado com o protocolo ${protocolo}. Urgência ou emergência: a resposta é imediata.`
      : `Pedido registrado com o protocolo ${protocolo}. Resposta ao prestador até ${quando(prazoEm)}.`;
  }
}
