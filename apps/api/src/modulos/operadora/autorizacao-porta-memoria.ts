// Porta da autorização de guias em MEMÓRIA (M56, etapa 5, F4): a sessão sintética de dev/ci (E2E). O beneficiário pela
// carteirinha e as operadoras vêm da porta em memória da F1, e os prestadores da porta em memória da F3 (os mesmos que a
// tela da rede mostra); os domínios têm os códigos que o banco do estabelecimento tem (rótulos do vocabulário), a
// terminologia TUSS e o CID são SINTÉTICOS (nenhum nome oficial). Os pedidos, os itens, o histórico e os auditores ficam
// em memória com as mesmas recusas das (versão vista e situação de partida, protocolo e senha únicos, um auditor
// ativo por operadora) e a transação desfeita por inteiro quando a função falha. Nada vai ao banco. A trilha da memória é
// registrada pela API (como na rede).
import {
  ORIGENS_ATENDIMENTO_OPERADORA,
  SITUACOES_GUIA_OPERADORA,
  TIPOS_GUIA_OPERADORA,
} from '@sgh/contratos';
import { ErroOperacao } from '@sgh/nucleo';
import { conferirAnexoResposta, recusaAuditorComPedidos } from './aplicacao/regras-portas.js';
import {
  ANEXOS_COMPLEMENTO_MAX,
  type DadosAnexoComplemento,
  type DadosAuditor,
  type DadosAutorizacao,
  type DadosAutorizacaoDaSenha,
  type DadosAutorizacaoResumo,
  type DadosEventoAutorizacao,
  type DadosItemAutorizacao,
  type DadosItemDominioAutorizacao,
  type DadosPrestadorParaAutorizacao,
  type DadosProcedimentoTuss,
  type DominioAutorizacao,
  type FiltroAutorizacoesPorta,
  LIMITE_BUSCA_TUSS,
  LIMITE_PAGINA_AUTORIZACOES,
  type SituacaoAutorizacaoPorta,
} from './dados-portas.js';
import type {
  ContextoAutorizacao,
  GravadorAutorizacao,
  PortaAutorizacaoOperadora,
} from './autorizacao-porta.js';
import type { PortaOperadora } from './porta.js';
import type { PortaRedeOperadora } from './rede-porta.js';

const opcoes = (o: Readonly<Record<number, string>>): DadosItemDominioAutorizacao[] =>
  Object.entries(o).map(([k, v]) => ({ codigo: Number(k), rotulo: v }));

/** Os domínios como o banco do estabelecimento tem (as críticas são o domínio editável da operadora, sintético). */
export const DOMINIOS_AUTORIZACAO_SINTETICOS: Record<DominioAutorizacao, DadosItemDominioAutorizacao[]> = {
  tipoGuia: opcoes(TIPOS_GUIA_OPERADORA),
  origem: opcoes(ORIGENS_ATENDIMENTO_OPERADORA),
  critica: [
    { codigo: 1, rotulo: 'Carência (sintético)', extraContrato: true },
    { codigo: 2, rotulo: 'Inadimplência (sintético)', extraContrato: true },
    { codigo: 3, rotulo: 'Inatividade (sintético)', extraContrato: true },
    { codigo: 4, rotulo: 'Cobertura do procedimento (sintético)', extraContrato: true },
    { codigo: 5, rotulo: 'Quantidade excedida (sintético)', extraContrato: true },
    { codigo: 6, rotulo: 'Preexistência (sintético)', extraContrato: true },
    { codigo: 7, rotulo: 'Retorno (sintético)', extraContrato: false },
  ],
  situacaoGuia: opcoes(SITUACOES_GUIA_OPERADORA),
};

/** Terminologia TUSS SINTÉTICA (códigos de 8 dígitos; um fora de vigência). */
export const TUSS_SINTETICA: readonly DadosProcedimentoTuss[] = [
  { codigo: '10101012', nome: 'Consulta em consultório (sintético)', vigente: true },
  { codigo: '40301630', nome: 'Dosagem sintética de laboratório', vigente: true },
  { codigo: '40304361', nome: 'Hemograma sintético', vigente: true },
  { codigo: '41001010', nome: 'Tomografia sintética', vigente: true },
  { codigo: '30101010', nome: 'Procedimento cirúrgico sintético', vigente: true },
  { codigo: '90000001', nome: 'Procedimento sintético fora de vigência', vigente: false },
];

/** CID-10 SINTÉTICO (o código existe; o nome é marcado como sintético). */
const CIDS_SINTETICOS: Readonly<Record<string, string>> = {
  J189: 'Pneumonia (sintético)',
  K359: 'Apendicite (sintético)',
  O800: 'Parto (sintético)',
  I10: 'Hipertensão (sintético)',
};

const p2 = (n: number) => String(n).padStart(2, '0');
function agoraLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

const recusa = (codigo: string, detail: string, campo?: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detail, campo ? { campos: [campo] } : {});
const desatualizada = () =>
  recusa(
    'autorizacao-desatualizada',
    'O pedido mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira antes de gravar.',
  );

interface PedidoMem {
  hospital: string;
  id: number;
  operadora: number;
  beneficiario: number;
  carteirinha: string;
  prestador: number;
  executante: number | null;
  guiaPrincipal: number | null;
  tipoGuia: number;
  carater: 'E' | 'U';
  altaComplexidade: boolean;
  origem: number;
  protocolo: string;
  solicitadaEm: string;
  prazoTipo: 'imediato' | 'padrao' | 'complexo';
  prazoEm: string;
  cid: string | null;
  indicacaoClinica: string;
  profissional: { nome: string; conselho: string; numero: string; uf: string };
  internacao: {
    tipo: number;
    diarias: number;
    diariasAutorizadas: number | null;
    admissaoPrevista: string;
  } | null;
  situacao: SituacaoAutorizacaoPorta;
  complementoPedido: string | null;
  complementoResposta: string | null;
  junta: {
    divergencia: string;
    desempatador: string;
    crm: string;
    uf: string;
    notificadosEm: string;
    parecer: string | null;
  } | null;
  auditor: number | null;
  /** W0-10: o auditor responsável pela análise (auditor_plano: a última linha). */
  responsavel?: number | null;
  decididaEm: string | null;
  decididaPor: string | null;
  critica: number | null;
  fundamento: string | null;
  parecer: string | null;
  senha: string | null;
  senhaValidade: string | null;
  motivoCancelamento: string | null;
  versao: number;
}

type Mut<T> = { -readonly [K in keyof T]: T[K] };
interface Estado {
  pedidos: PedidoMem[];
  itens: (Mut<DadosItemAutorizacao> & { hospital: string; autorizacao: number })[];
  eventos: (DadosEventoAutorizacao & { hospital: string; autorizacao: number })[];
  auditores: (Mut<DadosAuditor> & { hospital: string })[];
  /** W0-10: os anexos das respostas ao complemento pelo portal (pedido_autorizacao_plano_anexo). */
  anexos: (DadosAnexoComplemento & { hospital: string; autorizacao: number; bytes: Uint8Array })[];
  seq: Record<string, number>;
}

/** O objeto sem as chaves (cópia rasa). */
function sem<T extends object, K extends keyof T>(o: T, ...chaves: K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !chaves.includes(k as K))) as Omit<T, K>;
}

const EM_ABERTO = new Set<SituacaoAutorizacaoPorta>(['em-analise', 'pendente', 'em-junta']);

export class PortaAutorizacaoOperadoraMemoria implements PortaAutorizacaoOperadora {
  readonly destino = 'memoria' as const;
  private estado: Estado = { pedidos: [], itens: [], eventos: [], auditores: [], anexos: [], seq: {} };

  /** O relógio da memória (os testes o fixam). */
  agora: () => string = agoraLocal;

  constructor(
    private readonly operadora: Pick<PortaOperadora, 'elegibilidade' | 'operadoras'>,
    private readonly rede: Pick<PortaRedeOperadora, 'prestador' | 'prestadores'>,
  ) {}

  async relogio() {
    const agora = this.agora();
    return { hoje: agora.slice(0, 10), agora };
  }

  async dominios() {
    return DOMINIOS_AUTORIZACAO_SINTETICOS;
  }

  operadoras(c: ContextoAutorizacao) {
    return this.operadora.operadoras(c);
  }

  async prestadores(c: ContextoAutorizacao): Promise<DadosPrestadorParaAutorizacao[]> {
    const r: DadosPrestadorParaAutorizacao[] = [];
    let apos: { nome: string; id: number } | undefined;
    for (let i = 0; i < 20; i++) {
      const p = await this.rede.prestadores(c, { situacao: 'credenciado', ...(apos ? { apos } : {}) });
      r.push(
        ...p.itens.map((x) => ({
          id: x.id,
          nome: x.nome,
          tipo: x.tipo,
          regime: x.regime,
          municipioIbge: x.municipioIbge,
          uf: x.uf,
        })),
      );
      if (!p.proxima) break;
      apos = p.proxima;
    }
    return r;
  }

  prestador(c: ContextoAutorizacao, id: number) {
    return this.rede.prestador(c, id);
  }

  elegibilidade(c: ContextoAutorizacao, carteirinha: string) {
    return this.operadora.elegibilidade(c, carteirinha);
  }

  async procedimentosTuss(_c: unknown, codigos: readonly string[]) {
    return TUSS_SINTETICA.filter((t) => codigos.includes(t.codigo));
  }

  async buscarTuss(_c: unknown, termo: string) {
    const d = termo.replace(/[.\-\s]/g, '');
    const t = termo.trim().toLowerCase();
    return TUSS_SINTETICA.filter(
      (x) => x.vigente && (/^\d{2,8}$/.test(d) ? x.codigo.startsWith(d) : x.nome.toLowerCase().includes(t)),
    ).slice(0, LIMITE_BUSCA_TUSS);
  }

  async nomeDoCid(_c: unknown, codigo: string) {
    return CIDS_SINTETICOS[codigo] ?? null;
  }

  private vencida(p: PedidoMem): boolean {
    return EM_ABERTO.has(p.situacao) && p.prazoEm < this.agora();
  }

  private resumo(p: PedidoMem): DadosAutorizacaoResumo {
    return {
      id: p.id,
      operadora: p.operadora,
      protocolo: p.protocolo,
      beneficiario: p.beneficiario,
      beneficiarioNome: this.nomes.get(p.beneficiario) ?? '',
      carteirinha: p.carteirinha,
      prestador: p.prestador,
      prestadorNome: this.nomesPrestador.get(p.prestador) ?? '',
      tipoGuia: p.tipoGuia,
      carater: p.carater,
      situacao: p.situacao,
      solicitadaEm: p.solicitadaEm,
      prazoEm: p.prazoEm,
      vencida: this.vencida(p),
      senha: p.senha,
      versao: p.versao,
    };
  }

  /** Os nomes guardados no registro (a memória não junta tabelas). */
  private readonly nomes = new Map<number, string>();
  private readonly nomesBusca = new Map<number, string>();
  private readonly nomesPrestador = new Map<number, string>();
  private readonly fichas = new Map<
    number,
    {
      nascimento: string;
      sexo: string;
      produto: string;
      natureza: 'plano' | 'cartaoDesconto';
      segmentacao: string | null;
    }
  >();

  async autorizacoes(c: ContextoAutorizacao, f: FiltroAutorizacoesPorta) {
    const busca = f.busca?.trim() ?? '';
    const d = busca.replace(/[\s.\-/]/g, '');
    const lista = this.estado.pedidos
      .filter(
        (p) =>
          p.hospital === c.hospital &&
          (!busca ||
            (/^\d{20}$/.test(d)
              ? p.protocolo === d
              : /^\d{16}$/.test(d)
                ? p.carteirinha === d || p.senha === d
                : (this.nomesBusca.get(p.beneficiario) ?? '').startsWith(busca))) &&
          (!f.situacao || p.situacao === f.situacao) &&
          (!f.vencidas || this.vencida(p)) &&
          (f.prestador === undefined || p.prestador === f.prestador) &&
          (f.apos === undefined || p.id < f.apos),
      )
      .sort((a, b) => b.id - a.id);
    const itens = lista.slice(0, LIMITE_PAGINA_AUTORIZACOES).map((p) => this.resumo(p));
    return {
      itens,
      proxima: lista.length > LIMITE_PAGINA_AUTORIZACOES ? (itens[itens.length - 1]?.id ?? null) : null,
    };
  }

  async totais(c: ContextoAutorizacao) {
    const doHospital = this.estado.pedidos.filter((p) => p.hospital === c.hospital);
    const hoje = this.agora().slice(0, 10);
    return {
      emAnalise: doHospital.filter((p) => p.situacao === 'em-analise').length,
      pendentes: doHospital.filter((p) => p.situacao === 'pendente').length,
      emJunta: doHospital.filter((p) => p.situacao === 'em-junta').length,
      vencidas: doHospital.filter((p) => this.vencida(p)).length,
      decididasHoje: doHospital.filter(
        (p) =>
          ['autorizada', 'parcial', 'negada'].includes(p.situacao) && (p.decididaEm ?? '').startsWith(hoje),
      ).length,
    };
  }

  async autorizacao(c: ContextoAutorizacao, id: number): Promise<DadosAutorizacao | null> {
    const p = this.estado.pedidos.find((x) => x.hospital === c.hospital && x.id === id);
    if (!p) return null;
    const f = this.fichas.get(p.id);
    const principal = p.guiaPrincipal
      ? (this.estado.pedidos.find((x) => x.id === p.guiaPrincipal)?.protocolo ?? null)
      : null;
    const auditor = p.auditor ? this.estado.auditores.find((a) => a.id === p.auditor) : undefined;
    return {
      ...this.resumo(p),
      beneficiarioNascimento: f?.nascimento ?? '',
      beneficiarioSexo: f?.sexo ?? '',
      produtoNome: f?.produto ?? '',
      produtoNatureza: f?.natureza ?? 'plano',
      segmentacao: f?.segmentacao ?? null,
      executante: p.executante,
      executanteNome: p.executante ? (this.nomesPrestador.get(p.executante) ?? null) : null,
      guiaPrincipal: p.guiaPrincipal,
      guiaPrincipalProtocolo: principal,
      altaComplexidade: p.altaComplexidade,
      origem: p.origem,
      prazoTipo: p.prazoTipo,
      cid: p.cid,
      indicacaoClinica: p.indicacaoClinica,
      profissional: { ...p.profissional },
      internacao: p.internacao ? { ...p.internacao } : null,
      complementoPedido: p.complementoPedido,
      complementoResposta: p.complementoResposta,
      junta: p.junta ? { ...p.junta } : null,
      auditor: p.auditor,
      auditorNome: auditor?.nome ?? null,
      decididaEm: p.decididaEm,
      decididaPor: p.decididaPor,
      critica: p.critica,
      fundamento: p.fundamento,
      parecer: p.parecer,
      senhaValidade: p.senhaValidade,
      motivoCancelamento: p.motivoCancelamento,
    };
  }

  async itens(c: ContextoAutorizacao, id: number) {
    return this.estado.itens
      .filter((i) => i.hospital === c.hospital && i.autorizacao === id)
      .sort((a, b) => a.ordem - b.ordem)
      .map((i) => sem(i, 'hospital', 'autorizacao'));
  }

  async eventos(c: ContextoAutorizacao, id: number) {
    return this.estado.eventos
      .filter((e) => e.hospital === c.hospital && e.autorizacao === id)
      .sort((a, b) => a.id - b.id)
      .map((e) => sem(e, 'hospital', 'autorizacao'));
  }

  async anexosDoComplemento(c: ContextoAutorizacao, id: number): Promise<DadosAnexoComplemento[]> {
    return this.estado.anexos
      .filter((x) => x.hospital === c.hospital && x.autorizacao === id)
      .sort((a, b) => a.id - b.id)
      .map((x) => sem(x, 'hospital', 'autorizacao', 'bytes'));
  }

  async anexoDoComplemento(c: ContextoAutorizacao, anexo: number, prestador?: number) {
    const x = this.estado.anexos.find(
      (y) =>
        y.hospital === c.hospital && y.id === anexo && (prestador === undefined || y.prestador === prestador),
    );
    return x
      ? {
          autorizacao: x.autorizacao,
          nome: x.nome,
          tipo: x.tipo,
          sha256: x.sha256,
          bytes: Buffer.from(x.bytes),
        }
      : null;
  }

  async auditores(c: ContextoAutorizacao) {
    const emAnalise = (a: { id: number; situacao: string }) =>
      a.situacao === 'ativo'
        ? this.estado.pedidos.filter(
            (p) => p.hospital === c.hospital && EM_ABERTO.has(p.situacao) && p.responsavel === a.id,
          ).length
        : 0;
    return this.estado.auditores
      .filter((a) => a.hospital === c.hospital)
      .map((a) => ({ ...a, emAnalise: emAnalise(a) }))
      .sort(
        (a, b) =>
          (a.situacao === 'ativo' ? 0 : 1) - (b.situacao === 'ativo' ? 0 : 1) ||
          a.nome.localeCompare(b.nome) ||
          a.id - b.id,
      )
      .map((a) => sem(a, 'hospital'));
  }

  async auditor(c: ContextoAutorizacao, id: number) {
    return (await this.auditores(c)).find((x) => x.id === id) ?? null;
  }

  async designacoes(c: ContextoAutorizacao, login: string) {
    return (await this.auditores(c)).filter((a) => a.login === login.toUpperCase() && a.situacao === 'ativo');
  }

  /** M56.6 (F5): as autorizações pela senha, com os itens autorizados (a memória das contas médicas lê daqui). */
  async autorizacoesPorSenha(
    c: ContextoAutorizacao,
    senhas: readonly string[],
  ): Promise<DadosAutorizacaoDaSenha[]> {
    return this.estado.pedidos
      .filter((p) => p.hospital === c.hospital && p.senha !== null && senhas.includes(p.senha))
      .map((p) => ({
        id: p.id,
        protocolo: p.protocolo,
        senha: p.senha ?? '',
        situacao: p.situacao,
        beneficiario: p.beneficiario,
        prestadores: [p.prestador, ...(p.executante ? [p.executante] : [])],
        validade: p.senhaValidade,
        itens: this.estado.itens
          .filter((i) => i.hospital === c.hospital && i.autorizacao === p.id)
          .map((i) => ({ tabela: i.tabela, codigo: i.codigo, autorizada: i.quantidadeAutorizada })),
      }));
  }

  /** Guarda os nomes do registro (a ficha da memória não junta tabelas). */
  async lembrar(c: ContextoAutorizacao, id: number, carteirinha: string, prestadores: readonly number[]) {
    const el = await this.operadora.elegibilidade(c, carteirinha);
    if (el) {
      this.nomes.set(el.beneficiario.id, el.beneficiario.nome);
      this.nomesBusca.set(
        el.beneficiario.id,
        el.beneficiario.nome
          .normalize('NFD')
          .replace(/\p{M}/gu, '')
          .toUpperCase()
          .replace(/[^A-Z0-9 ]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      );
      this.fichas.set(id, {
        nascimento: el.beneficiario.nascimento,
        sexo: el.beneficiario.sexo,
        produto: el.produto.nome,
        natureza: el.produto.natureza,
        segmentacao: el.produto.segmentacao,
      });
    }
    for (const p of prestadores) {
      const x = await this.rede.prestador(c, p);
      if (x) this.nomesPrestador.set(p, x.nome);
    }
  }

  private gravador(c: ContextoAutorizacao, depois: (() => Promise<void>)[]): GravadorAutorizacao {
    const e = this.estado;
    const h = c.hospital;
    const prox = (s: string) => (e.seq[s] = (e.seq[s] ?? 0) + 1);
    const evento = (
      autorizacao: number,
      ev: DadosEventoAutorizacao['evento'],
      situacao: SituacaoAutorizacaoPorta,
      texto: string | null,
      por: string,
    ) =>
      e.eventos.push({
        hospital: h,
        autorizacao,
        id: prox('evt'),
        evento: ev,
        situacao,
        texto,
        em: this.agora(),
        por,
      });
    const mudar = (
      a: { id: number; versao: number; usuario: string },
      de: readonly SituacaoAutorizacaoPorta[],
      fn: (p: PedidoMem) => void,
    ) => {
      const p = e.pedidos.find((x) => x.hospital === h && x.id === a.id);
      if (!p || p.versao !== a.versao || !de.includes(p.situacao)) throw desatualizada();
      fn(p);
      p.versao++;
      return { id: p.id, versao: p.versao };
    };
    /** W0-10: quem pede o complemento ou abre a junta assume o pedido (designação ativa na operadora dele). */
    const assumir = (id: number, usuario: string) => {
      const p = e.pedidos.find((x) => x.hospital === h && x.id === id);
      const d = e.auditores.find(
        (x) =>
          x.hospital === h &&
          x.operadora === p?.operadora &&
          x.login === usuario.toUpperCase() &&
          x.situacao === 'ativo',
      );
      if (p && d) p.responsavel = d.id;
    };
    return {
      proximoProtocolo: async () => prox('protocolo'),
      proximaSenha: async () => prox('senha'),
      registrar: async (r) => {
        if (e.pedidos.some((x) => x.protocolo === r.protocolo))
          throw recusa('numero-em-uso', 'O número gerado já existe: tente de novo.');
        const id = prox('autorizacao');
        e.pedidos.push({
          hospital: h,
          id,
          operadora: r.operadora,
          beneficiario: r.beneficiario,
          carteirinha: r.carteirinha,
          prestador: r.prestador,
          executante: r.executante,
          guiaPrincipal: r.guiaPrincipal,
          tipoGuia: r.tipoGuia,
          carater: r.carater,
          altaComplexidade: r.altaComplexidade,
          origem: r.origem,
          protocolo: r.protocolo,
          solicitadaEm: r.solicitadaEm.slice(0, 19),
          prazoTipo: r.prazoTipo,
          prazoEm: r.prazoEm.slice(0, 19),
          cid: r.cid,
          indicacaoClinica: r.indicacaoClinica,
          profissional: { ...r.profissional },
          internacao: r.internacao ? { ...r.internacao, diariasAutorizadas: null } : null,
          situacao: 'em-analise',
          complementoPedido: null,
          complementoResposta: null,
          junta: null,
          auditor: null,
          decididaEm: null,
          decididaPor: null,
          critica: null,
          fundamento: null,
          parecer: null,
          senha: null,
          senhaValidade: null,
          motivoCancelamento: null,
          versao: 1,
        });
        let ordem = 0;
        for (const i of r.itens)
          e.itens.push({
            hospital: h,
            autorizacao: id,
            id: prox('item'),
            ordem: ++ordem,
            tabela: i.tabela,
            codigo: i.codigo,
            descricao: i.descricao || i.codigo,
            quantidadeSolicitada: i.quantidade,
            quantidadeAutorizada: null,
            situacao: 'pendente',
          });
        evento(id, 'registro', 'em-analise', `Protocolo ${r.protocolo}`, r.usuario);
        depois.push(() =>
          this.lembrar(c, id, r.carteirinha, [r.prestador, ...(r.executante ? [r.executante] : [])]),
        );
        return { id, versao: 1 };
      },
      pedirComplemento: async (a) => {
        const r = mudar(a, ['em-analise'], (p) => {
          p.situacao = 'pendente';
          p.complementoPedido = a.pedido;
          p.complementoResposta = null;
        });
        evento(a.id, 'complemento-pedido', 'pendente', a.pedido, a.usuario);
        assumir(a.id, a.usuario);
        return r;
      },
      responderComplemento: async (a) => {
        const r = mudar(a, ['pendente'], (p) => {
          p.situacao = 'em-analise';
          p.complementoResposta = a.resposta;
        });
        evento(a.id, 'complemento-resposta', 'em-analise', a.resposta, a.usuario);
        return r;
      },
      responderComplementoPortal: async (a) => {
        if (a.anexos.length > ANEXOS_COMPLEMENTO_MAX)
          throw recusa(
            'anexos-demais',
            `Envie no máximo ${ANEXOS_COMPLEMENTO_MAX} arquivos por resposta.`,
            'anexos',
          );
        const conferidos = a.anexos.map((x) => ({
          ...conferirAnexoResposta(x),
          bytes: Uint8Array.from(x.bytes),
        }));
        const resposta = a.resposta.trim();
        if (resposta.length < 3)
          throw recusa('texto-curto', 'Escreva a resposta (ao menos 3 caracteres).', 'resposta');
        const p = e.pedidos.find((x) => x.hospital === h && x.id === a.id);
        if (!p || p.prestador !== a.prestador)
          throw recusa('autorizacao-inexistente', 'Esta autorização não existe no seu credenciamento.');
        if (p.situacao !== 'pendente')
          throw recusa(
            'complemento-nao-pedido',
            'Esta autorização não está aguardando complemento: a resposta não entra. Abra o pedido de novo.',
          );
        const texto = conferidos.length
          ? `${resposta} [anexos: ${conferidos.map((y) => y.nome).join(', ')}]`
          : resposta;
        const r = mudar(a, ['pendente'], (q) => {
          q.situacao = 'em-analise';
          q.complementoResposta = texto.slice(0, 1000);
        });
        evento(a.id, 'complemento-resposta', 'em-analise', texto, a.usuario);
        const ev = e.seq['evt'] ?? 0;
        const anexos = conferidos.map((y, i) => {
          const id = prox('anexo');
          e.anexos.push({
            hospital: h,
            autorizacao: a.id,
            id,
            evento: ev,
            prestador: a.prestador,
            acesso: a.acesso,
            ordem: i + 1,
            nome: y.nome,
            tipo: y.tipo,
            tamanho: y.tamanho,
            sha256: y.sha256,
            em: this.agora(),
            por: a.usuario,
            bytes: y.bytes,
          });
          return id;
        });
        return { ...r, evento: ev, anexos };
      },
      abrirJunta: async (a) => {
        const r = mudar(a, ['em-analise'], (p) => {
          p.situacao = 'em-junta';
          p.junta = {
            divergencia: a.divergencia,
            desempatador: a.desempatador.nome,
            crm: a.desempatador.crm,
            uf: a.desempatador.uf,
            notificadosEm: a.notificadosEm,
            parecer: null,
          };
        });
        evento(a.id, 'junta-aberta', 'em-junta', a.divergencia, a.usuario);
        assumir(a.id, a.usuario);
        return r;
      },
      decidir: async (d) => {
        const junta = d.parecerJunta !== undefined && d.parecerJunta !== null;
        if (d.senha && e.pedidos.some((x) => x.senha === d.senha))
          throw recusa('numero-em-uso', 'O número gerado já existe: tente de novo.');
        const r = mudar(d, junta ? ['em-junta'] : ['em-analise'], (p) => {
          p.situacao = d.situacao;
          if (p.internacao) p.internacao.diariasAutorizadas = d.diarias;
          p.auditor = d.auditor;
          p.decididaEm = this.agora();
          p.decididaPor = d.usuario;
          p.critica = d.critica;
          p.fundamento = d.fundamento;
          p.parecer = d.parecer;
          p.senha = d.senha;
          p.senhaValidade = d.senhaValidade;
          if (junta && p.junta) p.junta.parecer = d.parecerJunta ?? null;
        });
        for (const i of d.itens) {
          const it = e.itens.find((x) => x.hospital === h && x.autorizacao === d.id && x.id === i.id);
          if (!it) throw desatualizada();
          it.quantidadeAutorizada = i.quantidade;
          it.situacao = i.situacao as DadosItemAutorizacao['situacao'];
        }
        evento(
          d.id,
          junta ? 'junta-concluida' : 'decisao',
          d.situacao,
          junta ? (d.parecerJunta ?? null) : d.parecer,
          d.usuario,
        );
        return r;
      },
      cancelar: async (a) => {
        const r = mudar(a, ['em-analise', 'pendente', 'em-junta', 'autorizada', 'parcial'], (p) => {
          p.situacao = 'cancelada';
          p.motivoCancelamento = a.motivo;
        });
        evento(a.id, 'cancelamento', 'cancelada', a.motivo, a.usuario);
        return r;
      },
      designar: async (d) => {
        const login = d.login.toUpperCase();
        if (
          e.auditores.some(
            (a) =>
              a.hospital === h && a.operadora === d.operadora && a.login === login && a.situacao === 'ativo',
          )
        )
          throw recusa(
            'auditor-ja-designado',
            'Este usuário já está designado como auditor desta operadora.',
            'login',
          );
        const id = prox('auditor');
        e.auditores.push({
          hospital: h,
          id,
          operadora: d.operadora,
          login,
          nome: d.nome,
          categoria: d.categoria,
          conselho: d.conselho,
          numero: d.numero,
          uf: d.uf,
          inicio: d.inicio,
          fim: null,
          situacao: 'ativo',
          motivoEncerramento: null,
          versao: 1,
          emAnalise: 0,
        });
        return { id };
      },
      encerrar: async (a) => {
        const x = e.auditores.find((y) => y.hospital === h && y.id === a.id);
        if (!x || x.versao !== a.versao || x.situacao !== 'ativo')
          throw recusa(
            'auditor-desatualizado',
            'A designação mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira.',
          );
        const pedidos = e.pedidos.filter(
          (p) => p.hospital === h && EM_ABERTO.has(p.situacao) && p.responsavel === a.id,
        );
        if (pedidos.length) {
          const para = a.redistribuirPara ?? null;
          if (para === null) throw recusaAuditorComPedidos(pedidos.sort((p, q) => p.id - q.id));
          const d = e.auditores.find(
            (y) => y.hospital === h && y.id === para && y.situacao === 'ativo' && y.operadora === x.operadora,
          );
          if (!d || d.id === x.id)
            throw recusa(
              'redistribuicao-invalida',
              'Escolha outro auditor ativo da mesma operadora para assumir os pedidos em análise.',
              'redistribuirPara',
            );
          for (const p of pedidos) p.responsavel = d.id;
        }
        x.situacao = 'encerrado';
        x.fim = this.agora().slice(0, 10);
        x.motivoEncerramento = a.motivo;
        x.versao++;
        return { id: x.id, redistribuidos: pedidos.length };
      },
      alterar: async (a) => {
        const x = e.auditores.find((y) => y.hospital === h && y.id === a.id);
        if (!x || x.versao !== a.versao || x.situacao !== 'ativo')
          throw recusa(
            'auditor-desatualizado',
            'A designação mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira.',
          );
        // O nome é o do cadastro do profissional: a alteração não o troca.
        x.categoria = a.categoria;
        x.conselho = a.conselho;
        x.numero = a.numero;
        x.uf = a.uf;
        x.versao++;
        return { id: x.id, versao: x.versao, nome: x.nome };
      },
    };
  }

  async gravar<T>(
    c: ContextoAutorizacao,
    _trilha: unknown,
    fn: (g: GravadorAutorizacao) => Promise<T>,
  ): Promise<T> {
    const antes = structuredClone(this.estado);
    const depois: (() => Promise<void>)[] = [];
    try {
      const r = await fn(this.gravador(c, depois));
      for (const d of depois) await d();
      return r;
    } catch (x) {
      this.estado = antes;
      throw x;
    }
  }
}
