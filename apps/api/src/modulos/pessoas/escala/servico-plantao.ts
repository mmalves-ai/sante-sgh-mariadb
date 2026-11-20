// Serviço da fatia F3 da gestão de pessoas (M52.3; ficha do M52, seções 4, 6, 7 e 8; regras 8 a 10): a troca de
// plantão entre colegas (pedido → aceite do colega → aprovação da coordenação), "quem está de plantão agora" com o
// sobreaviso e o acionamento, e o dimensionamento de enfermagem pela COFEN 543/2017. A troca e o acionamento são parte
// da escala e exigem a chave `pessoas.escala`; o registro do dimensionamento exige `pessoas.dimensionamento` (a prévia
// do cálculo não grava). O estabelecimento vem da sessão (escala, plantão, troca ou acionamento de outro: 404). Na
// aprovação da troca, cada plantão é conferido de novo com o novo colaborador pela montagem da F2 (conselho no dia,
// interjornada, limite do contrato, sobreposição local e na Rede), com as duas pessoas travadas na transação; os
// plantões mudam de vínculo com o motivo na trilha da escala e o evento de mudança na SGH_OUTBOX (regra 8).
import {
  type AcionamentoLido,
  CATEGORIAS_SCP,
  type AcionarSobreavisoEntrada,
  type ApoioDimensionamento,
  type ApoioTrocas,
  type CalcularDimensionamentoEntrada,
  type CancelarAcionamentoEntrada,
  type CancelarTrocaEntrada,
  type CategoriaScp,
  CODIGOS_CATEGORIA_SCP,
  type DecidirTrocaEntrada,
  type DimensionamentoLido,
  type EstadoEscala,
  type EstadoTroca,
  EVENTO_SOBREAVISO_ACIONADO,
  EVENTO_TROCA_APROVADA,
  EVENTO_TROCA_PEDIDA,
  EVENTOS_AUDITAVEIS,
  type FiltroDimensionamentosEntrada,
  type FiltroPlantaoAgoraEntrada,
  type FiltroTrocasEntrada,
  type FonteDimensionamento,
  type LadoTroca,
  type ListaDimensionamentos,
  type ListaTrocas,
  MINIMO_ENFERMEIROS_MINIMO_INTERMEDIARIO,
  type PedirTrocaEntrada,
  type PlantaoAgora,
  type PlantaoAgoraLinha,
  type PlantoesParaTroca,
  type RegistrarChegadaSobreavisoEntrada,
  type ResponderTrocaEntrada,
  type ResultadoEscala,
  TETO_PLANTAO_AGORA,
  type TipoEscala,
  type TipoPlantao,
  type TipoTroca,
  TURNO_CLASSIFICACAO_DA_ESCALA,
  type TurnoEscala,
} from '@sgh/contratos';
import {
  atrasado,
  calcularDimensionamento,
  comecouAntesDoDia,
  conferirAcionamento,
  conferirChegada,
  conferirPassoDaTroca,
  conferirPedidoDeTroca,
  conferirPlantaoNaAprovacao,
  estadoDepois,
  instanteEmBrasilia,
  janelaDoInstante,
  minutoLocal,
  pacientesDaClassificacao,
  type PapelNaTroca,
  type PassoDaTroca,
  plantoesNoInstante,
} from '@sgh/dominio-pessoas';
import type {
  AcionamentoPesLido,
  EscalaPesLida,
  PlantaoPesLido,
  TrocaPesLida,
  VinculoPesLido,
} from '@sgh/legado';
import { TETO_LEITURA_INSTANTE } from '@sgh/legado';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { PortaPessoas } from '../porta.js';
import type { GravadorEscala, PortaEscala } from './porta-escala.js';
import { CHAVE_PESSOAS_ESCALA, descricaoPlantao, ServicoEscala } from './servico-escala.js';

const E = EVENTOS_AUDITAVEIS;
export const CHAVE_PESSOAS_DIMENSIONAMENTO = 'pessoas.dimensionamento';
const P = {
  pedir: 'pessoas.troca.pedir',
  aprovar: 'pessoas.troca.aprovar',
  montar: 'pessoas.escala.montar',
  escalaLer: 'pessoas.escala.ler',
  acionar: 'pessoas.sobreaviso.acionar',
  dimCalcular: 'pessoas.dimensionamento.calcular',
} as const;

const naoEncontrado = (o: string, detalhe: string) =>
  new ErroProblema('nao-encontrado', 404, `${o} não encontrado`, detalhe);
const recusaRegra = (codigo: string, mensagem: string, campos?: readonly string[]) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, {
    codigo,
    ...(campos ? { campos: [...campos] } : {}),
  });
const semPermissao = (detalhe: string) =>
  new ErroProblema('sem-permissao', 403, 'Ação não permitida', detalhe, { codigo: 'sem-permissao' });

const HORA = (i: string) => `${i.slice(8, 10)}/${i.slice(5, 7)} ${i.slice(11, 16)}`;
const competenciaDe = (i: string) => i.slice(0, 7);

export class ServicoPlantao {
  private readonly apoio: ApoioGravacao<GravadorEscala>;
  private readonly apoioDim: ApoioGravacao<GravadorEscala>;

  constructor(
    private readonly escala: ServicoEscala,
    private readonly porta: PortaEscala,
    private readonly pessoas: PortaPessoas,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
    /** O relógio (testes passam um fixo); o instante vai a Brasília pelo domínio. */
    private readonly relogio: () => Date = () => new Date(),
  ) {
    this.apoio = escala.apoio;
    this.apoioDim = new ApoioGravacao<GravadorEscala>(
      { chave: CHAVE_PESSOAS_DIMENSIONAMENTO, nome: 'o dimensionamento de enfermagem', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  agora(): string {
    return instanteEmBrasilia(this.relogio());
  }

  // ── Quem é a pessoa da sessão ───────────────────────────────────────────────────────────────────────────────

  /** O vínculo é da pessoa da sessão: o usuário ligado ao vínculo é o da sessão (pelo ID; senão, pelo login). */
  private async ehMeu(
    s: SessaoCadastro,
    v: VinculoPesLido | null,
    memo: Map<number, boolean>,
  ): Promise<boolean> {
    if (!v || v.usuario === null) return false;
    const m = memo.get(v.usuario);
    if (m !== undefined) return m;
    const id = s.req.sgh?.sessao.usuario.id;
    let r = id !== undefined && String(v.usuario) === String(id);
    if (!r) {
      const u = await this.pessoas.usuarioPorId(s.porta, v.usuario).catch(() => null);
      r = !!u && u.login.toUpperCase() === s.login.toUpperCase();
    }
    memo.set(v.usuario, r);
    return r;
  }

  private async vinculos(s: SessaoCadastro, ids: readonly number[]): Promise<Map<number, VinculoPesLido>> {
    const lidos = await Promise.all([...new Set(ids)].map((id) => this.pessoas.vinculo(s.porta, id)));
    return new Map(lidos.filter((v): v is VinculoPesLido => v !== null).map((v) => [v.id, v]));
  }

  private async escalaOu404(s: SessaoCadastro, id: number): Promise<EscalaPesLida> {
    const x = await this.porta.escala(s.porta, id);
    if (!x || x.hospital !== s.hospital)
      throw naoEncontrado('Escala', 'A escala não existe neste estabelecimento.');
    return x;
  }

  private async plantaoOu404(s: SessaoCadastro, id: number): Promise<PlantaoPesLido> {
    const p = await this.porta.plantao(s.porta, id);
    if (!p) throw naoEncontrado('Plantão', 'O plantão não existe neste estabelecimento.');
    return p;
  }

  private async trocaOu404(s: SessaoCadastro, id: number): Promise<TrocaPesLida> {
    const t = await this.porta.troca(s.porta, id);
    if (!t || t.hospital !== s.hospital)
      throw naoEncontrado('Troca', 'O pedido de troca não existe neste estabelecimento.');
    return t;
  }

  // ── Trocas de plantão (regra 8) ─────────────────────────────────────────────────────────────────────────────

  async apoioTrocas(s: SessaoCadastro): Promise<ApoioTrocas> {
    const agora = this.agora();
    const [publicadas, unidades, liberacao] = await Promise.all([
      this.porta.escalas(s.porta, { estado: 'publicada' }),
      this.pessoas.unidades(s.porta),
      this.apoio.liberacao(s),
    ]);
    const nomes = new Map(unidades.map((u) => [u.codigo, u.nome]));
    const pedir = s.pode(P.pedir) && liberacao.ligada;
    const aprovar = s.pode(P.aprovar) && liberacao.ligada;
    const emNomeDe = s.pode(P.montar) && liberacao.ligada;
    return {
      agora,
      escalas: publicadas
        .filter((x) => x.competencia >= competenciaDe(agora))
        .map((x) => ({
          id: x.id,
          tipo: x.tipo as TipoEscala,
          rotulo: `${x.competencia} · ${nomes.get(x.unidade) ?? x.unidade}${x.setor ? ` · ${x.setor}` : ''}`,
        })),
      gravacao: liberacao,
      acoes: {
        pedir,
        emNomeDe,
        aprovar,
        motivo:
          pedir || aprovar ? null : liberacao.ligada ? 'Seu perfil não permite esta ação.' : liberacao.motivo,
      },
    };
  }

  /** Os plantões da escala publicada que ainda não começaram, com os da pessoa da sessão e os já em troca. */
  async plantoesParaTroca(s: SessaoCadastro, escala: number): Promise<PlantoesParaTroca> {
    const x = await this.escalaOu404(s, escala);
    if (x.estado !== 'publicada')
      throw recusaRegra(
        'escala-em-rascunho',
        'A escala ainda está em rascunho: a troca é só da escala publicada.',
      );
    const agora = minutoLocal(this.agora());
    const todos = await this.porta.plantoesDaEscala(s.porta, x.id);
    const futuros = todos.filter((p) => p.situacao === 'previsto' && minutoLocal(p.inicio) > agora);
    const [vs, emTroca] = await Promise.all([
      this.vinculos(
        s,
        futuros.map((p) => p.vinculo),
      ),
      this.porta.plantoesEmTrocaAberta(
        s.porta,
        futuros.map((p) => p.id),
      ),
    ]);
    const memo = new Map<number, boolean>();
    const meus = new Set<number>();
    for (const v of vs.values()) if (await this.ehMeu(s, v, memo)) meus.add(v.id);
    const nome = (id: number) => vs.get(id)?.nome ?? `Vínculo ${id}`;
    return {
      escala: x.id,
      plantoes: futuros
        .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.id - b.id)
        .map((p) => ({
          plantao: p.id,
          vinculo: p.vinculo,
          nome: nome(p.vinculo),
          tipo: p.tipo as TipoPlantao,
          inicio: p.inicio,
          fim: p.fim,
          versao: p.versao,
          meu: meus.has(p.vinculo),
          emTroca: emTroca.has(p.id),
        })),
      colegas: [...vs.values()]
        .filter((v) => v.desligamento === null)
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.id - b.id)
        .map((v) => ({ vinculo: v.id, nome: v.nome })),
    };
  }

  private lado(p: PlantaoPesLido | null, v: VinculoPesLido | undefined, vinculo: number): LadoTroca | null {
    if (!p) return null;
    return {
      plantao: p.id,
      escala: p.escala,
      vinculo,
      nome: v?.nome ?? `Vínculo ${vinculo}`,
      tipo: p.tipo as TipoPlantao,
      inicio: p.inicio,
      fim: p.fim,
    };
  }

  private async papel(
    s: SessaoCadastro,
    t: TrocaPesLida,
    vs: ReadonlyMap<number, VinculoPesLido>,
    memo: Map<number, boolean>,
  ): Promise<PapelNaTroca> {
    if (await this.ehMeu(s, vs.get(t.vinculo) ?? null, memo)) return 'quemPediu';
    if (await this.ehMeu(s, vs.get(t.vinculoColega) ?? null, memo)) return 'colega';
    return 'outro';
  }

  async trocas(s: SessaoCadastro, f: FiltroTrocasEntrada): Promise<ListaTrocas> {
    const lidas = await this.porta.trocas(s.porta, {
      ...(f.estado ? { estado: f.estado } : {}),
      ...(f.escala !== undefined ? { escala: f.escala } : {}),
    });
    const vs = await this.vinculos(
      s,
      lidas.flatMap((t) => [t.vinculo, t.vinculoColega]),
    );
    const memo = new Map<number, boolean>();
    // Quem não acompanha a escala (só pede) vê só as trocas de que é parte.
    const soAsMinhas = f.minhas || !(s.pode(P.escalaLer) || s.pode(P.aprovar));
    const plantoes = new Map<number, PlantaoPesLido>();
    const ids = [
      ...new Set(lidas.flatMap((t) => [t.plantao, ...(t.plantaoColega ? [t.plantaoColega] : [])])),
    ];
    for (const p of await Promise.all(ids.map((id) => this.porta.plantao(s.porta, id))))
      if (p) plantoes.set(p.id, p);
    const liberada = (await this.apoio.liberacao(s)).ligada;
    const itens = [];
    for (const t of lidas) {
      const papel = await this.papel(s, t, vs, memo);
      if (soAsMinhas && papel === 'outro') continue;
      const colega = vs.get(t.vinculoColega);
      const situacao = {
        estado: t.estado as EstadoTroca,
        papel,
        emNomeDe: s.pode(P.montar),
        aprova: s.pode(P.aprovar),
        colegaTemAcesso: (colega?.usuario ?? null) !== null,
        registrouAlgumPasso: registrou(s, t),
      };
      const pode = (passo: PassoDaTroca) => liberada && conferirPassoDaTroca(passo, situacao).ok;
      itens.push({
        id: t.id,
        tipo: t.tipo as TipoTroca,
        estado: t.estado as EstadoTroca,
        pedido: this.lado(plantoes.get(t.plantao) ?? null, vs.get(t.vinculo), t.vinculo)!,
        colega: { vinculo: t.vinculoColega, nome: colega?.nome ?? `Vínculo ${t.vinculoColega}` },
        plantaoColega: t.plantaoColega
          ? this.lado(plantoes.get(t.plantaoColega) ?? null, colega, t.vinculoColega)
          : null,
        motivo: t.motivo,
        pedidoPor: t.pedidoPor,
        pedidoEm: t.pedidoEm,
        respostaPor: t.respostaPor,
        respostaEm: t.respostaEm,
        confirmacao: t.confirmacao,
        decisaoPor: t.decisaoPor,
        decisaoEm: t.decisaoEm,
        motivoDecisao: t.motivoDecisao,
        versao: t.versao,
        acoes: {
          responder: pode('responder') && papel === 'colega',
          registrarResposta: pode('responder') && papel === 'outro',
          decidir: pode('decidir'),
          cancelar: pode('cancelar'),
        },
      });
    }
    return { itens: itens.filter((i) => i.pedido !== null) };
  }

  async pedirTroca(s: SessaoCadastro, e: PedirTrocaEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const a = await this.plantaoOu404(s, e.plantao);
    const xa = await this.escalaOu404(s, a.escala);
    const b = e.plantaoColega !== null ? await this.plantaoOu404(s, e.plantaoColega) : null;
    const xb = b ? await this.escalaOu404(s, b.escala) : null;
    const vs = await this.vinculos(s, [a.vinculo, e.colega]);
    const va = vs.get(a.vinculo);
    const vc = vs.get(e.colega);
    if (!va || !vc) throw naoEncontrado('Colaborador', 'O colaborador não existe neste estabelecimento.');
    // Só o próprio plantão; a coordenação registra em nome de quem não tem acesso (D-ACEITE-52.3, D-QUATRO-OLHOS-52.3).
    const memo = new Map<number, boolean>();
    if (!(await this.ehMeu(s, va, memo))) {
      if (!s.pode(P.montar)) throw semPermissao('Você só pede a troca do seu próprio plantão.');
      if (va.usuario !== null)
        throw recusaRegra(
          'colaborador-com-acesso',
          `${va.nome} tem acesso ao sistema: o pedido de troca é dele(a).`,
          ['plantao'],
        );
    }
    // D-COLEGA-52.3: o colega é da mesma escala (tem plantão previsto nela).
    const daEscala = await this.porta.plantoesDaEscala(s.porta, xa.id);
    if (!daEscala.some((p) => p.vinculo === vc.id && p.situacao === 'previsto'))
      throw recusaRegra('colega-fora-da-escala', 'Escolha um colega desta escala.', ['colega']);
    const conferir = async (emTroca: ReadonlySet<number>, pa: PlantaoPesLido, pb: PlantaoPesLido | null) =>
      conferirPedidoDeTroca({
        tipo: e.tipo,
        plantao: pa,
        estadoEscala: xa.estado as EstadoEscala,
        versaoInformada: e.versao,
        colega: { vinculo: vc.id, pessoa: vc.pessoa, ativo: vc.desligamento === null },
        plantaoColega: pb,
        estadoEscalaColega: xb ? (xb.estado as EstadoEscala) : null,
        versaoColegaInformada: e.versaoColega,
        emTrocaAberta: emTroca,
        agora: this.agora(),
      });
    const ids = [a.id, ...(b ? [b.id] : [])];
    const antes = await conferir(await this.porta.plantoesEmTrocaAberta(s.porta, ids), a, b);
    if (!antes.ok) throw recusaRegra(antes.codigo, antes.mensagem);
    // O pedido já confere as regras da montagem com o novo colaborador (não se pede troca impossível); a aprovação
    // confere de novo, com as pessoas travadas.
    await this.conferirMovimentos(s, e.motivo, [
      { p: a, x: xa, para: vc },
      ...(b && xb ? [{ p: b, x: xb, para: va }] : []),
    ]);
    const id = await this.apoio.sgh(
      s,
      E.pessoasTrocaPedida.codigo,
      CHAVE_PESSOAS_ESCALA,
      (x: number) => ({ tabela: 'SGH_PES_TROCA', id: String(x), chave: `SGH_PES_PLANTAO:${a.id}` }),
      async (g) => {
        // As duas pessoas travadas (na ordem do ID): dois pedidos ao mesmo tempo com o mesmo plantão não passam juntos.
        for (const pessoa of [...new Set([va.pessoa, vc.pessoa])].sort((x, y) => x - y))
          await g.travarPessoa(pessoa);
        const pa = await g.plantao(a.id);
        const pb = b ? await g.plantao(b.id) : null;
        if (!pa || (b && !pb)) throw naoEncontrado('Plantão', 'O plantão não existe neste estabelecimento.');
        const c = await conferir(await g.plantoesEmTrocaAberta(ids), pa, pb);
        if (!c.ok) throw recusaRegra(c.codigo, c.mensagem);
        const t = await g.incluirTroca({
          tipo: e.tipo,
          plantao: pa.id,
          versaoPlantao: pa.versao,
          vinculo: va.id,
          vinculoColega: vc.id,
          plantaoColega: pb?.id ?? null,
          versaoColega: pb?.versao ?? null,
          motivo: e.motivo,
          por: s.login,
        });
        await g.outbox({
          tipo: EVENTO_TROCA_PEDIDA,
          chave: `${s.hospital}:troca:${t}:pedida`,
          carga: { troca: t, plantao: pa.id, colega: vc.id },
        });
        return t;
      },
    );
    return {
      id,
      mensagem: `Pedido de ${e.tipo === 'troca' ? 'troca' : 'cessão'} enviado a ${vc.nome}: aguarda o aceite.`,
      alertas: [],
    };
  }

  /** As regras da montagem para cada plantão com o novo colaborador, fora da transação (resposta rápida). */
  private async conferirMovimentos(
    s: SessaoCadastro,
    motivo: string,
    movimentos: readonly { p: PlantaoPesLido; x: EscalaPesLida; para: VinculoPesLido }[],
  ) {
    const fora = new Set(movimentos.map((m) => m.p.id));
    const preparados = [];
    for (const m of movimentos) {
      const prep = await this.escala.conferenciaComOutroVinculo(s, m.x, m.para, m.p, motivo);
      const c = prep.conferir(
        m.x.estado as EstadoEscala,
        await this.porta.plantoesDaPessoa(s.porta, m.para.pessoa, prep.janela),
        fora,
      );
      if (!c.ok) throw recusaRegra(c.codigo, `${m.para.nome}: ${c.mensagem}`);
      preparados.push({ ...m, prep });
    }
    return { fora, preparados };
  }

  /** Confere um passo da troca para a pessoa da sessão (ou recusa com a mensagem do domínio). */
  private async passo(s: SessaoCadastro, t: TrocaPesLida, passo: PassoDaTroca) {
    const vs = await this.vinculos(s, [t.vinculo, t.vinculoColega]);
    const papel = await this.papel(s, t, vs, new Map());
    const colega = vs.get(t.vinculoColega);
    const c = conferirPassoDaTroca(passo, {
      estado: t.estado as EstadoTroca,
      papel,
      emNomeDe: s.pode(P.montar),
      aprova: s.pode(P.aprovar),
      colegaTemAcesso: (colega?.usuario ?? null) !== null,
      registrouAlgumPasso: registrou(s, t),
    });
    if (!c.ok)
      throw c.codigo === 'sem-permissao' || c.codigo.startsWith('so-')
        ? semPermissao(c.mensagem)
        : recusaRegra(c.codigo, c.mensagem);
    return { vs, papel };
  }

  async responderTroca(s: SessaoCadastro, e: ResponderTrocaEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const t = await this.trocaOu404(s, e.troca);
    const { papel } = await this.passo(s, t, 'responder');
    if (papel === 'outro' && e.confirmacao === null)
      throw recusaRegra('sem-confirmacao', 'Diga como o colega confirmou a resposta.', ['confirmacao']);
    const estado = estadoDepois('responder', e.aceite) as 'aceita' | 'recusada';
    await this.apoio.sgh(
      s,
      E.pessoasTrocaRespondida.codigo,
      CHAVE_PESSOAS_ESCALA,
      { tabela: 'SGH_PES_TROCA', id: String(t.id) },
      (g) =>
        g.responderTroca({
          id: t.id,
          versao: e.versao,
          estado,
          confirmacao: papel === 'outro' ? e.confirmacao : null,
          por: s.login,
        }),
    );
    return {
      id: t.id,
      mensagem: e.aceite ? 'Troca aceita: aguarda a aprovação da coordenação.' : 'Troca recusada.',
      alertas: [],
    };
  }

  async cancelarTroca(s: SessaoCadastro, e: CancelarTrocaEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const t = await this.trocaOu404(s, e.troca);
    await this.passo(s, t, 'cancelar');
    await this.apoio.sgh(
      s,
      E.pessoasTrocaPedida.codigo,
      CHAVE_PESSOAS_ESCALA,
      { tabela: 'SGH_PES_TROCA', id: String(t.id) },
      (g) => g.cancelarTroca({ id: t.id, versao: e.versao, motivo: e.motivo, por: s.login }),
    );
    return { id: t.id, mensagem: 'Pedido de troca cancelado.', alertas: [] };
  }

  async decidirTroca(s: SessaoCadastro, e: DecidirTrocaEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const t = await this.trocaOu404(s, e.troca);
    const { vs } = await this.passo(s, t, 'decidir');
    if (!e.aprovar) {
      await this.apoio.sgh(
        s,
        E.pessoasTrocaDecidida.codigo,
        CHAVE_PESSOAS_ESCALA,
        { tabela: 'SGH_PES_TROCA', id: String(t.id) },
        (g) =>
          g.decidirTroca({ id: t.id, versao: e.versao, estado: 'reprovada', motivo: e.motivo, por: s.login }),
      );
      return { id: t.id, mensagem: 'Troca reprovada.', alertas: [] };
    }
    return this.aprovar(s, t, e, vs);
  }

  /** A aprovação: os plantões mudam de colaborador, conferidos de novo com as duas pessoas travadas (regra 8). */
  private async aprovar(
    s: SessaoCadastro,
    t: TrocaPesLida,
    e: DecidirTrocaEntrada,
    vs: ReadonlyMap<number, VinculoPesLido>,
  ): Promise<ResultadoEscala> {
    const va = vs.get(t.vinculo);
    const vc = vs.get(t.vinculoColega);
    if (!va || !vc) throw naoEncontrado('Colaborador', 'O colaborador não existe neste estabelecimento.');
    const agora = this.agora();
    const a = await this.porta.plantao(s.porta, t.plantao);
    const b = t.plantaoColega !== null ? await this.porta.plantao(s.porta, t.plantaoColega) : null;
    const ca = conferirPlantaoNaAprovacao(a, t.versaoPlantao, t.vinculo, agora);
    if (!ca.ok) throw recusaRegra(ca.codigo, ca.mensagem);
    if (t.plantaoColega !== null) {
      const cb = conferirPlantaoNaAprovacao(b, t.versaoColega ?? -1, t.vinculoColega, agora);
      if (!cb.ok) throw recusaRegra(cb.codigo, cb.mensagem);
    }
    const xa = await this.escalaOu404(s, a!.escala);
    const xb = b ? await this.escalaOu404(s, b.escala) : null;
    const motivo = `Troca ${t.id} aprovada: ${t.motivo}`.slice(0, 400);
    // A vai para o colega; na troca, B volta para quem pediu.
    const { fora, preparados } = await this.conferirMovimentos(s, motivo, [
      { p: a!, x: xa, para: vc },
      ...(b && xb ? [{ p: b, x: xb, para: va }] : []),
    ]);
    const movimentos = preparados.map((m) => ({ ...m, de: m.para.id === vc.id ? va : vc }));
    const alertas = new Set<string>();
    await this.apoio.sgh(
      s,
      E.pessoasTrocaDecidida.codigo,
      CHAVE_PESSOAS_ESCALA,
      { tabela: 'SGH_PES_TROCA', id: String(t.id), chave: `SGH_PES_PLANTAO:${t.plantao}` },
      async (g) => {
        for (const pessoa of [...new Set([va.pessoa, vc.pessoa])].sort((x, y) => x - y))
          await g.travarPessoa(pessoa);
        const tr = await g.troca(t.id);
        if (!tr || tr.estado !== 'aceita' || tr.versao !== e.versao)
          throw recusaRegra('desatualizado', 'O pedido de troca mudou depois que você abriu. Abra de novo.');
        const tocadas = new Map<number, EscalaPesLida>();
        for (const m of movimentos) {
          const p = await g.plantao(m.p.id);
          const ok = conferirPlantaoNaAprovacao(p, m.p.versao, m.de.id, this.agora());
          if (!ok.ok) throw recusaRegra(ok.codigo, ok.mensagem);
          const esc = await g.escala(m.x.id);
          if (!esc) throw naoEncontrado('Escala', 'A escala não existe neste estabelecimento.');
          const c = m.prep.conferir(
            esc.estado as EstadoEscala,
            await g.plantoesDaPessoa(m.para.pessoa, m.prep.janela),
            fora,
          );
          if (!c.ok) throw recusaRegra(c.codigo, `${m.para.nome}: ${c.mensagem}`);
          await g.transferirPlantao({
            id: m.p.id,
            versao: m.p.versao,
            vinculo: m.para.id,
            pessoa: m.para.pessoa,
            profissional: m.para.profissional,
            registro: c.registro,
            alertaConselho: c.alertaConselho,
            redeNaoConferida: c.redeNaoConferida,
            motivo,
            por: s.login,
          });
          if (c.alertaConselho) alertas.add(ServicoEscala.ALERTAS[c.alertaConselho]);
          if (c.redeNaoConferida) alertas.add(ServicoEscala.ALERTAS.rede);
          if (!tocadas.has(esc.id)) {
            await g.tocarEscala({ id: esc.id, estado: esc.estado, por: s.login });
            tocadas.set(esc.id, esc);
          }
          const ev = await g.evento({
            escala: esc.id,
            plantao: m.p.id,
            acao: 'alterado',
            descricao: `Troca ${t.id}: ${descricaoPlantao(m.para.nome, m.p)} (antes ${m.de.nome})`,
            motivo,
            por: s.login,
          });
          await this.escala.outboxDaMudanca(g, s, esc, 'alterado', ev);
        }
        await g.decidirTroca({
          id: t.id,
          versao: e.versao,
          estado: 'aprovada',
          motivo: e.motivo,
          por: s.login,
        });
        await g.outbox({
          tipo: EVENTO_TROCA_APROVADA,
          chave: `${s.hospital}:troca:${t.id}:aprovada`,
          carga: { troca: t.id, plantao: t.plantao, colega: t.vinculoColega },
        });
      },
    );
    return { id: t.id, mensagem: 'Troca aprovada: a escala foi atualizada.', alertas: [...alertas] };
  }

  // ── Quem está de plantão agora (regra 10) ───────────────────────────────────────────────────────────────────

  private acionamentoLido(a: AcionamentoPesLido, agora: string): AcionamentoLido {
    const situacao = a.situacao === 'chegou' || a.situacao === 'cancelado' ? a.situacao : 'acionado';
    return {
      id: a.id,
      plantao: a.plantao,
      situacao,
      acionadoEm: a.acionadoEm,
      acionadoPor: a.acionadoPor,
      motivo: a.motivo,
      atendimento: a.atendimento,
      prazoChegada: a.prazoChegada,
      chegouEm: a.chegouEm,
      atrasado: atrasado({ situacao, prazoChegada: a.prazoChegada, chegouEm: a.chegouEm }, agora),
      versao: a.versao,
    };
  }

  async plantaoAgora(s: SessaoCadastro, f: FiltroPlantaoAgoraEntrada): Promise<PlantaoAgora> {
    const agora = this.agora();
    const instante = f.instante ?? agora;
    const janela = janelaDoInstante(instante);
    const [lidos, unidades, liberacao] = await Promise.all([
      this.porta.plantoesNoInstante(s.porta, instante, janela.inicioDesde, {
        ...(f.unidade !== undefined ? { unidade: f.unidade } : {}),
        ...(f.setor ? { setor: f.setor } : {}),
        ...(f.tipo ? { tipo: f.tipo } : {}),
      }),
      this.pessoas.unidades(s.porta),
      this.apoio.liberacao(s),
    ]);
    const emCurso = plantoesNoInstante(lidos, instante);
    // O registro conferido no plantão (conselho, número e especialidade pelo CBO).
    const profs = await this.pessoas.profissionais(s.porta, [
      ...new Set(emCurso.map((p) => p.profissional).filter((x): x is number => x !== null)),
    ]);
    const registros = new Map(profs.flatMap((p) => p.registros).map((r) => [r.id, r]));
    const comRegistro = emCurso.map((p) => ({
      p,
      r: p.registro !== null ? registros.get(p.registro) : undefined,
    }));
    const especialidades = new Map<string, string>();
    for (const { r } of comRegistro) if (r?.cbo) especialidades.set(r.cbo, r.cboDescricao ?? r.cbo);
    const filtrados = comRegistro.filter(({ r }) => !f.especialidade || r?.cbo === f.especialidade);
    const corte = filtrados.slice(0, TETO_PLANTAO_AGORA);
    const sobreavisos = corte.filter(({ p }) => p.tipo === 'sobreaviso').map(({ p }) => p.id);
    const acion = await this.porta.acionamentos(s.porta, sobreavisos);
    const ultimo = new Map<number, AcionamentoPesLido>();
    for (const a of acion) {
      const atual = ultimo.get(a.plantao);
      // O acionamento em aberto vence; senão, o mais novo.
      if (
        !atual ||
        (a.situacao === 'acionado' && atual.situacao !== 'acionado') ||
        (a.situacao === atual.situacao && a.id > atual.id)
      )
        ultimo.set(a.plantao, a);
    }
    const nomes = new Map(unidades.map((u) => [u.codigo, u.nome]));
    const linhas: PlantaoAgoraLinha[] = corte.map(({ p, r }) => {
      const a = ultimo.get(p.id);
      return {
        plantao: p.id,
        escala: p.escala,
        unidade: p.unidade,
        unidadeNome: nomes.get(p.unidade) ?? null,
        setor: p.setor,
        tipoEscala: p.tipoEscala as TipoEscala,
        tipo: p.tipo as TipoPlantao,
        inicio: p.inicio,
        fim: p.fim,
        desdeOntem: comecouAntesDoDia(p, instante),
        chegadaMin: p.chegadaMin,
        vinculo: p.vinculo,
        nome: p.nome,
        conselho: r
          ? `${r.sigla ?? r.conselho ?? ''} ${r.numero ?? ''}${r.uf ? `/${r.uf}` : ''}`.trim() || null
          : null,
        especialidade: r?.cboDescricao ?? null,
        especialidadeCodigo: r?.cbo ?? null,
        acionamento: a ? this.acionamentoLido(a, agora) : null,
      };
    });
    const acionar = s.pode(P.acionar) && liberacao.ligada;
    return {
      instante,
      linhas,
      // Cortado também quando a leitura bateu no teto (antes do filtro de especialidade, que é em memória).
      truncado: filtrados.length > TETO_PLANTAO_AGORA || lidos.length >= TETO_LEITURA_INSTANTE,
      especialidades: [...especialidades]
        .sort(([, a], [, b]) => a.localeCompare(b, 'pt-BR'))
        .map(([codigo, rotulo]) => ({ codigo: Number(codigo), rotulo })),
      unidades: unidades.map((u) => ({ codigo: u.codigo, rotulo: u.nome })),
      acoes: {
        acionar,
        motivo: acionar
          ? null
          : !s.pode(P.acionar)
            ? 'Seu perfil não aciona o sobreaviso.'
            : (liberacao.motivo ?? 'A escala de plantão está em consulta.'),
      },
    };
  }

  async acionar(s: SessaoCadastro, e: AcionarSobreavisoEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const p = await this.plantaoOu404(s, e.plantao);
    const x = await this.escalaOu404(s, p.escala);
    const v = await this.pessoas.vinculo(s.porta, p.vinculo);
    const agora = this.agora();
    const conferir = (pl: PlantaoPesLido, estado: string, abertos: number) =>
      conferirAcionamento({ ...pl, estadoEscala: estado }, agora, abertos);
    const abertos = async (ids: AcionamentoPesLido[]) => ids.filter((a) => a.situacao === 'acionado').length;
    const antes = conferir(p, x.estado, await abertos(await this.porta.acionamentos(s.porta, [p.id])));
    if (!antes.ok) throw recusaRegra(antes.codigo, antes.mensagem);
    const r = await this.apoio.sgh(
      s,
      E.pessoasSobreavisoAcionado.codigo,
      CHAVE_PESSOAS_ESCALA,
      (y: { id: number }) => ({
        tabela: 'SGH_PES_ACIONAMENTO',
        id: String(y.id),
        chave: `SGH_PES_PLANTAO:${p.id}`,
      }),
      async (g) => {
        await g.travarPessoa(p.pessoa);
        const pl = await g.plantao(p.id);
        const esc = await g.escala(x.id);
        if (!pl || !esc) throw naoEncontrado('Plantão', 'O plantão não existe neste estabelecimento.');
        const c = conferir(pl, esc.estado, await abertos(await g.acionamentosDosPlantoes([p.id])));
        if (!c.ok) throw recusaRegra(c.codigo, c.mensagem);
        const prazo = (c as { prazoChegada: string }).prazoChegada;
        const id = await g.incluirAcionamento({
          plantao: p.id,
          acionadoEm: agora,
          prazoChegada: prazo,
          motivo: e.motivo,
          atendimento: e.atendimento,
          por: s.login,
        });
        await g.outbox({
          tipo: EVENTO_SOBREAVISO_ACIONADO,
          chave: `${s.hospital}:acionamento:${id}`,
          carga: { acionamento: id, plantao: p.id, vinculo: p.vinculo, prazo },
        });
        return { id, prazo };
      },
    );
    return {
      id: r.id,
      mensagem: `${v?.nome ?? 'Profissional'} acionado(a): chegada prevista até ${HORA(r.prazo)}.`,
      alertas: [],
    };
  }

  private async acionamentoOu404(s: SessaoCadastro, id: number): Promise<AcionamentoPesLido> {
    const a = await this.porta.acionamento(s.porta, id);
    if (!a) throw naoEncontrado('Acionamento', 'O acionamento não existe neste estabelecimento.');
    return a;
  }

  async registrarChegada(s: SessaoCadastro, e: RegistrarChegadaSobreavisoEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const a = await this.acionamentoOu404(s, e.acionamento);
    const agora = this.agora();
    const c = conferirChegada(a, e.chegouEm, agora);
    if (!c.ok) throw recusaRegra(c.codigo, c.mensagem, ['chegouEm']);
    await this.apoio.sgh(
      s,
      E.pessoasSobreavisoAcionado.codigo,
      CHAVE_PESSOAS_ESCALA,
      { tabela: 'SGH_PES_ACIONAMENTO', id: String(a.id) },
      (g) => g.registrarChegada({ id: a.id, versao: e.versao, chegouEm: e.chegouEm, por: s.login }),
    );
    const tarde = atrasado({ situacao: 'chegou', prazoChegada: a.prazoChegada, chegouEm: e.chegouEm }, agora);
    return {
      id: a.id,
      mensagem: 'Chegada registrada.',
      alertas: tarde ? [`A chegada passou do prazo (${HORA(a.prazoChegada)}).`] : [],
    };
  }

  async cancelarAcionamento(s: SessaoCadastro, e: CancelarAcionamentoEntrada): Promise<ResultadoEscala> {
    await this.apoio.exigirLiberacao(s);
    const a = await this.acionamentoOu404(s, e.acionamento);
    if (a.situacao !== 'acionado')
      throw recusaRegra(
        'acionamento-encerrado',
        'O acionamento já foi encerrado (chegada registrada ou cancelado).',
      );
    await this.apoio.sgh(
      s,
      E.pessoasSobreavisoAcionado.codigo,
      CHAVE_PESSOAS_ESCALA,
      { tabela: 'SGH_PES_ACIONAMENTO', id: String(a.id) },
      (g) => g.cancelarAcionamento({ id: a.id, versao: e.versao, motivo: e.motivo, por: s.login }),
    );
    return { id: a.id, mensagem: 'Acionamento cancelado.', alertas: [] };
  }

  // ── Dimensionamento de enfermagem (regra 9) ─────────────────────────────────────────────────────────────────

  private async minimoEnfermeiros(s: SessaoCadastro): Promise<number> {
    const v = await this.apoioDim
      .parametroValor(s, 'pessoas.dimensionamento.minimoEnfermeiros')
      .catch(() => null);
    return typeof v === 'number' && v >= 0 ? v : MINIMO_ENFERMEIROS_MINIMO_INTERMEDIARIO;
  }

  async apoioDimensionamento(s: SessaoCadastro): Promise<ApoioDimensionamento> {
    const [hoje, unidades, internacao, minimo, liberacao, escala] = await Promise.all([
      this.pessoas.hoje(s.porta),
      this.pessoas.unidades(s.porta),
      this.porta.unidadesInternacao(s.porta).catch(() => []),
      this.minimoEnfermeiros(s),
      this.apoioDim.liberacao(s),
      this.apoio.liberacao(s),
    ]);
    const calcular = s.pode(P.dimCalcular) && liberacao.ligada;
    return {
      hoje,
      unidades: unidades.map((u) => ({ codigo: u.codigo, rotulo: u.nome })),
      unidadesInternacao: internacao.map((u) => ({
        codigo: u.unidade,
        rotulo: u.nome,
        internados: u.internados,
      })),
      minimoEnfermeiros: minimo,
      gravacao: liberacao,
      acoes: {
        calcular,
        aplicarNaEscala: s.pode(P.montar) && escala.ligada,
        motivo: calcular
          ? null
          : !s.pode(P.dimCalcular)
            ? 'Seu perfil não registra o dimensionamento.'
            : (liberacao.motivo ?? 'O dimensionamento está em consulta.'),
      },
    };
  }

  /** O cálculo (prévia) com as parcelas; da classificação do turno, quando a fonte é a classificação de pacientes. */
  async calcular(s: SessaoCadastro, e: CalcularDimensionamentoEntrada): Promise<DimensionamentoLido> {
    return (await this.calcularComNas(s, e)).d;
  }

  private async calcularComNas(
    s: SessaoCadastro,
    e: CalcularDimensionamentoEntrada,
  ): Promise<{ d: DimensionamentoLido; nasPacientes: number }> {
    const unidades = await this.pessoas.unidades(s.porta);
    const u = unidades.find((x) => x.codigo === e.unidade);
    if (!u)
      throw recusaRegra('unidade-desconhecida', 'A unidade não existe neste estabelecimento.', ['unidade']);
    let pacientes: Record<CategoriaScp, number>;
    let nasSoma = 0;
    let nasPacientes = 0;
    let naoClassificados: number | null = null;
    let comOsDois = 0;
    if (e.fonte === 'classificacao') {
      const ui = e.unidadeInternacao!;
      const [lidas, internacao] = await Promise.all([
        this.porta.classificacoesDoTurno(s.porta, ui, e.data, TURNO_CLASSIFICACAO_DA_ESCALA[e.turno]),
        this.porta.unidadesInternacao(s.porta).catch(() => []),
      ]);
      const r = pacientesDaClassificacao(lidas);
      pacientes = r.pacientes;
      nasSoma = r.nasSoma;
      nasPacientes = r.nasPacientes;
      comOsDois = r.comOsDois;
      const internados = internacao.find((x) => x.unidade === ui)?.internados;
      const classificados = new Set(lidas.map((x) => x.paciente)).size;
      naoClassificados = internados !== undefined ? Math.max(0, internados - classificados) : null;
    } else pacientes = { ...e.pacientes! };
    const bruto = calcularDimensionamento({
      pacientes,
      nasSoma,
      nasPacientes,
      jornadaSemanalHoras: e.jornadaSemanalHoras,
      ist: e.ist,
      minimoEnfermeiros: await this.minimoEnfermeiros(s),
    });
    const calculo =
      comOsDois > 0
        ? {
            ...bruto,
            parcelas: [
              ...bruto.parcelas,
              `Pacientes com Fugulin e NAS no mesmo turno: ${comOsDois} (contados uma vez só, pelo NAS)`,
            ],
          }
        : bruto;
    const d: DimensionamentoLido = {
      id: null,
      unidade: u.codigo,
      unidadeNome: u.nome,
      setor: e.setor.trim(),
      data: e.data,
      turno: e.turno,
      fonte: e.fonte,
      unidadeInternacao: e.fonte === 'classificacao' ? e.unidadeInternacao : null,
      jornadaSemanalHoras: e.jornadaSemanalHoras,
      ist: e.ist,
      calculo,
      naoClassificados,
      calculadoPor: null,
      calculadoEm: null,
    };
    return { d, nasPacientes };
  }

  async registrarDimensionamento(
    s: SessaoCadastro,
    e: CalcularDimensionamentoEntrada,
  ): Promise<ResultadoEscala> {
    await this.apoioDim.exigirLiberacao(s);
    const { d, nasPacientes } = await this.calcularComNas(s, e);
    const k = d.calculo;
    const parcelas = [
      ...k.parcelas,
      ...(d.naoClassificados
        ? [`Pacientes internados sem classificação no turno: ${d.naoClassificados}`]
        : []),
    ];
    const id = await this.apoioDim.sgh(
      s,
      E.pessoasDimensionamentoCalculado.codigo,
      CHAVE_PESSOAS_DIMENSIONAMENTO,
      (x: number) => ({ tabela: 'SGH_PES_DIMENSIONAMENTO', id: String(x) }),
      (g) =>
        g.incluirDimensionamento({
          unidade: d.unidade,
          setor: d.setor,
          data: d.data,
          turno: d.turno,
          fonte: d.fonte,
          unidadeInternacao: d.unidadeInternacao,
          pacientes: k.pacientes,
          nasSoma: k.nasSoma,
          nasPacientes,
          naoClassificados: d.naoClassificados,
          jornadaSemanalHoras: d.jornadaSemanalHoras,
          ist: d.ist,
          totalHoras: k.totalHoras,
          km: k.km,
          quantitativo: k.quantitativo,
          totalProfissionais: k.totalProfissionais,
          enfermeiros: k.enfermeiros,
          tecnicos: k.tecnicos,
          percentualEnfermeiros: k.percentualEnfermeiros,
          categoriaPrevalente: k.categoriaPrevalente,
          coberturaSugerida: k.coberturaSugerida,
          parcelas,
          por: s.login,
        }),
    );
    const alertas =
      d.naoClassificados && d.naoClassificados > 0
        ? [
            `${d.naoClassificados} paciente(s) internado(s) sem classificação no turno: o cálculo pode estar abaixo do real.`,
          ]
        : [];
    return {
      id,
      mensagem: `Dimensionamento registrado: ${k.totalProfissionais} profissional(is), ${k.enfermeiros} enfermeiro(s); cobertura sugerida ${k.coberturaSugerida} por turno.`,
      alertas,
    };
  }

  async dimensionamentos(
    s: SessaoCadastro,
    f: FiltroDimensionamentosEntrada,
  ): Promise<ListaDimensionamentos> {
    const [lidos, unidades] = await Promise.all([
      this.porta.dimensionamentos(s.porta, f.unidade !== undefined ? { unidade: f.unidade } : {}),
      this.pessoas.unidades(s.porta),
    ]);
    const nomes = new Map(unidades.map((u) => [u.codigo, u.nome]));
    return {
      itens: lidos.map((d) => {
        const pacientes = Object.fromEntries(CODIGOS_CATEGORIA_SCP.map((c) => [c, d.pacientes[c]])) as Record<
          CategoriaScp,
          number
        >;
        return {
          id: d.id,
          unidade: d.unidade,
          unidadeNome: nomes.get(d.unidade) ?? null,
          setor: d.setor,
          data: d.data,
          turno: d.turno as TurnoEscala,
          fonte: d.fonte as FonteDimensionamento,
          unidadeInternacao: d.unidadeInternacao,
          jornadaSemanalHoras: d.jornadaSemanalHoras,
          ist: d.ist,
          naoClassificados: d.naoClassificados,
          calculadoPor: d.calculadoPor,
          calculadoEm: d.calculadoEm,
          calculo: {
            pacientes,
            horasPorCategoria: Object.fromEntries(
              CODIGOS_CATEGORIA_SCP.map((c) => [c, d.pacientes[c] * CATEGORIAS_SCP[c].horas]),
            ) as Record<CategoriaScp, number>,
            nasSoma: d.nasSoma,
            nasHoras: Math.round(((d.nasSoma * 24) / 100) * 100) / 100,
            totalHoras: d.totalHoras,
            km: d.km,
            quantitativo: d.quantitativo,
            totalProfissionais: d.totalProfissionais,
            categoriaPrevalente: (d.categoriaPrevalente as CategoriaScp | null) ?? null,
            percentualEnfermeiros: d.percentualEnfermeiros,
            enfermeiros: d.enfermeiros,
            tecnicos: d.tecnicos,
            coberturaSugerida: d.coberturaSugerida,
            parcelas: d.parcelas,
          },
        };
      }),
    };
  }
}

/** A pessoa da sessão registrou o pedido ou a resposta da troca (D-QUATRO-OLHOS-52.3: então não a aprova). */
function registrou(s: SessaoCadastro, t: TrocaPesLida): boolean {
  const eu = s.login.toUpperCase();
  return t.pedidoPor.toUpperCase() === eu || (t.respostaPor ?? '').toUpperCase() === eu;
}
