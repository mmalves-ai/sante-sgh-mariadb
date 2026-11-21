// Porta do atendimento com protocolo e das contas do portal do prestador em MEMÓRIA (M56, etapa 8, F7): a sessão
// sintética de dev/ci (E2E). O beneficiário pela carteirinha e as operadoras vêm da porta em memória da F1, e os
// prestadores da porta em memória da F3; os domínios têm os códigos que o banco do estabelecimento tem (rótulos do
// vocabulário). Os protocolos, o histórico e as contas ficam em memória com as mesmas recusas das (versão vista e
// situação de partida, número único, e-mail único, ativação pendente e dentro da validade) e a transação desfeita por
// inteiro quando a função falha. A sequência do número começa em 500.001 na memória (a da autorização em memória é outra
// e começa em 1: os números não se cruzam na sessão sintética). Nada vai ao banco. A trilha da memória é registrada pela
// API (como na rede).
import {
  FUNCOES_PORTAL_PRESTADOR,
  ORIGENS_ATENDIMENTO_OPERADORA,
  TIPOS_ATENDIMENTO_PORTAL,
} from '@sgh/contratos';
import { acessoBloqueado } from '@sgh/dominio-operadora';
import { ErroOperacao } from '@sgh/nucleo';
import { conferirAnexoResposta } from './aplicacao/regras-portas.js';
import { type DadosAcessoPortalParaEntrada, type DadosAcessoPortalPrestador, type DadosConsultaElegibilidade, type DadosConsultaProtocolo, type DadosEventoProtocolo, type DadosItemDominio, type DadosProtocolo, type DadosProtocoloResumo, type DadosRespostaPrestador, type EntradaRegistroProtocolo, type FiltroProtocolosPorta, LIMITE_PAGINA_PROTOCOLOS, SITUACOES_RESPOSTA_PRESTADOR, type SituacaoProtocoloPorta } from './dados-portas.js';
import type {
  ContextoAtendimento,
  DominiosAtendimento,
  GravadorAtendimento,
  PortaAtendimentoOperadora,
} from './atendimento-porta.js';
import type { PortaAutorizacaoOperadora } from './autorizacao-porta.js';
import type { PortaOperadora } from './porta.js';
import type { PortaRedeOperadora } from './rede-porta.js';

const opcoes = (o: Readonly<Record<number, string>>): DadosItemDominio[] =>
  Object.entries(o).map(([k, v]) => ({ id: Number(k), rotulo: v }));

export const DOMINIOS_ATENDIMENTO_SINTETICOS: DominiosAtendimento = {
  origem: opcoes(ORIGENS_ATENDIMENTO_OPERADORA),
  funcoesPortal: opcoes(FUNCOES_PORTAL_PRESTADOR),
  tiposAtendimento: opcoes(TIPOS_ATENDIMENTO_PORTAL),
};

const p2 = (n: number) => String(n).padStart(2, '0');
function agoraLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

const recusa = (codigo: string, detail: string, campo?: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detail, campo ? { campos: [campo] } : {});
const desatualizado = () =>
  recusa(
    'protocolo-desatualizado',
    'O protocolo mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira antes de gravar.',
  );
const acessoDesatualizado = () =>
  recusa(
    'acesso-desatualizado',
    'O acesso mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira.',
  );

type Mutavel<T> = { -readonly [K in keyof T]: T[K] };
type Protocolo = { hospital: string } & Mutavel<
  Omit<
    DadosProtocolo,
    'vencido' | 'escritaVencida' | 'beneficiarioNome' | 'autorizacao' | 'origemProtocolo'
  >
> & { autorizacaoId: number | null; origemId: number | null; beneficiarioNome: string | null };
type Evento = DadosEventoProtocolo & { hospital: string; protocolo: number };
type Acesso = Mutavel<DadosAcessoPortalParaEntrada> & { hospital: string; ativacaoResumo: string | null };

/** W0-10: a resposta do prestador (protocolo_beneficiario_resposta), com o conteúdo do anexo. */
type Resposta = DadosRespostaPrestador & { hospital: string; protocolo: number; bytes: Uint8Array | null };

interface Estado {
  protocolos: Protocolo[];
  eventos: Evento[];
  acessos: Acesso[];
  respostas: Resposta[];
  /** W0-10 (M7): as consultas de elegibilidade do portal (só inclusão). */
  elegibilidades: (DadosConsultaElegibilidade & { hospital: string; prestador: number })[];
  seq: {
    protocolo: number;
    numero: number;
    evento: number;
    acesso: number;
    resposta: number;
    elegibilidade: number;
  };
}

const clone = (e: Estado): Estado => structuredClone(e);
/** A cópia sem as chaves internas da memória (o hospital, os IDs de ligação e os segredos). */
function sem<T extends object, K extends keyof T>(o: T, ...chaves: K[]): Omit<T, K> {
  const x = { ...o };
  for (const k of chaves) delete x[k];
  return x;
}

export class PortaAtendimentoOperadoraMemoria implements PortaAtendimentoOperadora {
  readonly destino = 'memoria' as const;
  private estado: Estado = {
    protocolos: [],
    eventos: [],
    acessos: [],
    respostas: [],
    elegibilidades: [],
    seq: { protocolo: 0, numero: 500_000, evento: 0, acesso: 0, resposta: 0, elegibilidade: 0 },
  };

  /** O relógio da memória (os testes o fixam). */
  agora: () => string = agoraLocal;

  constructor(
    private readonly operadora: Pick<PortaOperadora, 'elegibilidade' | 'operadoras' | 'vias'>,
    private readonly rede: Pick<PortaRedeOperadora, 'prestador'>,
    private readonly autorizacao: Pick<PortaAutorizacaoOperadora, 'autorizacao' | 'autorizacoes'>,
  ) {}

  async relogio() {
    const agora = this.agora();
    return { hoje: agora.slice(0, 10), agora };
  }

  async dominios() {
    return DOMINIOS_ATENDIMENTO_SINTETICOS;
  }

  operadoras(c: ContextoAtendimento) {
    return this.operadora.operadoras(c);
  }

  elegibilidade(c: ContextoAtendimento, carteirinha: string) {
    return this.operadora.elegibilidade(c, carteirinha);
  }

  async validadeCarteirinha(c: ContextoAtendimento, beneficiario: number): Promise<string | null> {
    const vias = await this.operadora.vias(c, beneficiario);
    return [...vias].sort((a, b) => b.via - a.via)[0]?.validade ?? null;
  }

  async consultasElegibilidade(
    c: ContextoAtendimento,
    prestador: number,
  ): Promise<DadosConsultaElegibilidade[]> {
    return this.estado.elegibilidades
      .filter((x) => x.hospital === c.hospital && x.prestador === prestador)
      .sort((a, b) => b.id - a.id)
      .slice(0, 30)
      .map((x) => sem(x, 'hospital', 'prestador'));
  }

  prestador(c: ContextoAtendimento, id: number) {
    return this.rede.prestador(c, id);
  }

  private vencido(p: Protocolo): boolean {
    return (
      (p.situacao === 'aberto' || p.situacao === 'em-analise') &&
      this.agora() > (p.prorrogadoAte ?? p.prazoEm)
    );
  }

  private escritaVencida(p: Protocolo): boolean {
    return p.escritaPedida && !p.escritaEnviadaEm && !!p.escritaPrazoEm && this.agora() > p.escritaPrazoEm;
  }

  private resumo(p: Protocolo): DadosProtocoloResumo {
    return {
      id: p.id,
      operadora: p.operadora,
      protocolo: p.protocolo,
      instancia: p.instancia,
      natureza: p.natureza,
      classe: p.classe,
      canal: p.canal,
      beneficiario: p.beneficiario,
      beneficiarioNome: p.beneficiarioNome,
      carteirinha: p.carteirinha,
      prestador: p.prestador,
      assunto: p.assunto,
      situacao: p.situacao,
      abertoEm: p.abertoEm,
      prazoEm: p.prazoEm,
      prorrogadoAte: p.prorrogadoAte,
      vencido: this.vencido(p),
      escritaPedida: p.escritaPedida,
      escritaEnviadaEm: p.escritaEnviadaEm,
      escritaVencida: this.escritaVencida(p),
      conclusao: p.conclusao,
      versao: p.versao,
    };
  }

  async protocolos(c: ContextoAtendimento, f: FiltroProtocolosPorta) {
    const limite = Math.min(Math.max(1, f.limite ?? LIMITE_PAGINA_PROTOCOLOS), LIMITE_PAGINA_PROTOCOLOS);
    const d = (f.busca ?? '').replace(/[\s.\-/]/g, '');
    const nome = (f.busca ?? '').trim().toUpperCase();
    const todos = this.estado.protocolos
      .filter((p) => p.hospital === c.hospital)
      .filter((p) => {
        if (!f.busca) return true;
        if (/^\d{20}$/.test(d)) return p.protocolo === d;
        if (/^\d{16}$/.test(d)) return p.carteirinha === d;
        if (/^\d{6,30}$/.test(d)) return p.numeroNip === d;
        return (p.beneficiarioNome ?? '').toUpperCase().startsWith(nome);
      })
      .filter((p) => !f.situacao || p.situacao === f.situacao)
      .filter((p) => !f.instancia || p.instancia === f.instancia)
      .filter((p) => !f.natureza || p.natureza === f.natureza)
      .filter(
        (p) => !f.vencidos || this.vencido(p) || (p.situacao === 'respondido' && this.escritaVencida(p)),
      )
      .filter((p) => f.apos === undefined || p.id < f.apos)
      .sort((a, b) => b.id - a.id);
    const itens = todos.slice(0, limite).map((p) => this.resumo(p));
    return { itens, proxima: todos.length > limite ? (itens[itens.length - 1]?.id ?? null) : null };
  }

  async totais(c: ContextoAtendimento) {
    const doH = this.estado.protocolos.filter((p) => p.hospital === c.hospital);
    const hoje = this.agora().slice(0, 10);
    return {
      abertos: doH.filter((p) => p.situacao === 'aberto').length,
      emAnalise: doH.filter((p) => p.situacao === 'em-analise').length,
      vencidos: doH.filter((p) => this.vencido(p)).length,
      escritaPendente: doH.filter(
        (p) => p.situacao === 'respondido' && p.escritaPedida && !p.escritaEnviadaEm,
      ).length,
      respondidosHoje: doH.filter(
        (p) => p.situacao === 'respondido' && (p.respondidoEm ?? '').startsWith(hoje),
      ).length,
    };
  }

  async protocolo(c: ContextoAtendimento, id: number): Promise<DadosProtocolo | null> {
    const p = this.estado.protocolos.find((x) => x.id === id && x.hospital === c.hospital);
    if (!p) return null;
    const a = p.autorizacaoId === null ? null : await this.autorizacao.autorizacao(c, p.autorizacaoId);
    const o = this.estado.protocolos.find((x) => x.id === p.origemId);
    return {
      ...sem(p, 'hospital', 'autorizacaoId', 'origemId'),
      ...this.resumo(p),
      autorizacao: a ? { id: a.id, protocolo: a.protocolo, situacao: a.situacao } : null,
      origemProtocolo: o ? { id: o.id, protocolo: o.protocolo } : null,
    };
  }

  async reanalises(c: ContextoAtendimento, id: number) {
    return this.estado.protocolos
      .filter((p) => p.hospital === c.hospital && p.origemId === id)
      .sort((a, b) => a.id - b.id)
      .map((p) => ({ id: p.id, protocolo: p.protocolo, situacao: p.situacao }));
  }

  async eventos(c: ContextoAtendimento, id: number) {
    return this.estado.eventos
      .filter((e) => e.hospital === c.hospital && e.protocolo === id)
      .map((e) => sem(e, 'hospital', 'protocolo'));
  }

  async respostasPrestador(c: ContextoAtendimento, id: number): Promise<DadosRespostaPrestador[]> {
    return this.estado.respostas
      .filter((r) => r.hospital === c.hospital && r.protocolo === id)
      .map((r) => sem(r, 'hospital', 'protocolo', 'bytes'));
  }

  async anexoDaResposta(c: ContextoAtendimento, resposta: number, prestador?: number) {
    const r = this.estado.respostas.find(
      (x) =>
        x.hospital === c.hospital &&
        x.id === resposta &&
        x.anexo !== null &&
        x.bytes !== null &&
        (prestador === undefined || x.prestador === prestador),
    );
    if (!r?.anexo || !r.bytes) return null;
    return {
      protocolo: r.protocolo,
      nome: r.anexo.nome,
      tipo: r.anexo.tipo,
      sha256: r.anexo.sha256,
      bytes: Buffer.from(r.bytes),
    };
  }

  async consulta(
    c: ContextoAtendimento,
    numero: string,
    prestador?: number,
  ): Promise<DadosConsultaProtocolo | null> {
    const p = this.estado.protocolos.find(
      (x) =>
        x.hospital === c.hospital &&
        x.protocolo === numero &&
        (prestador === undefined || x.prestador === prestador),
    );
    if (p)
      return {
        tipo: 'atendimento',
        id: p.id,
        protocolo: p.protocolo,
        situacao: p.situacao,
        abertoEm: p.abertoEm,
        prazoEm: p.prorrogadoAte ?? p.prazoEm,
        vencido: this.vencido(p),
        prestador: p.prestador,
      };
    const busca = await this.autorizacao.autorizacoes(c, {
      busca: numero,
      ...(prestador === undefined ? {} : { prestador }),
    });
    const a = busca.itens.find((x) => x.protocolo === numero);
    if (!a) return null;
    return {
      tipo: 'autorizacao',
      id: a.id,
      protocolo: a.protocolo,
      situacao: a.situacao,
      abertoEm: a.solicitadaEm,
      prazoEm: a.prazoEm,
      vencido: a.vencida,
      prestador: a.prestador,
    };
  }

  private semSegredo(a: Acesso): DadosAcessoPortalPrestador {
    return sem(a, 'hospital', 'ativacaoResumo', 'senhaResumo', 'segundoFator');
  }

  async acessos(c: ContextoAtendimento) {
    return this.estado.acessos
      .filter((a) => a.hospital === c.hospital)
      .sort(
        (a, b) =>
          Number(a.situacao === 'encerrado') - Number(b.situacao === 'encerrado') ||
          a.login.localeCompare(b.login) ||
          a.id - b.id,
      )
      .map((a) => this.semSegredo(a));
  }

  async acesso(c: ContextoAtendimento, id: number) {
    const a = this.estado.acessos.find((x) => x.id === id && x.hospital === c.hospital);
    return a ? this.semSegredo(a) : null;
  }

  async acessoParaEntrada(c: ContextoAtendimento, chave: { login: string } | { ativacaoResumo: string }) {
    const a = this.estado.acessos.find(
      (x) =>
        x.hospital === c.hospital &&
        ('login' in chave ? x.login === chave.login : x.ativacaoResumo === chave.ativacaoResumo),
    );
    if (!a) return null;
    return sem(a, 'hospital', 'ativacaoResumo');
  }

  async gravar<T>(c: ContextoAtendimento, _trilha: unknown, fn: (g: GravadorAtendimento) => Promise<T>) {
    const antes = clone(this.estado);
    try {
      return await fn(this.gravador(c));
    } catch (x) {
      this.estado = antes;
      throw x;
    }
  }

  private gravador(c: ContextoAtendimento): GravadorAtendimento {
    const s = this.estado;
    const h = c.hospital;
    const evento = (
      protocolo: number,
      ev: string,
      situacao: SituacaoProtocoloPorta,
      texto: string | null,
      por: string,
    ) =>
      s.eventos.push({
        id: ++s.seq.evento,
        hospital: h,
        protocolo,
        evento: ev,
        situacao,
        texto,
        em: this.agora(),
        por,
      });
    const mudar = (
      a: { id: number; versao: number; usuario: string },
      de: readonly string[],
      f: (p: Protocolo) => void,
    ): number => {
      const p = s.protocolos.find((x) => x.id === a.id && x.hospital === h);
      if (!p || p.versao !== a.versao || !de.includes(p.situacao)) throw desatualizado();
      f(p);
      p.versao += 1;
      return p.versao;
    };
    const registrar = async (r: Omit<EntradaRegistroProtocolo, 'hospital'>) => {
      if (s.protocolos.some((x) => x.protocolo === r.protocolo))
        throw recusa('numero-em-uso', 'O número gerado já existe: tente de novo.');
      const el = r.carteirinha ? await this.operadora.elegibilidade(c, r.carteirinha) : null;
      const id = ++s.seq.protocolo;
      s.protocolos.push({
        hospital: h,
        id,
        operadora: r.operadora,
        protocolo: r.protocolo,
        instancia: r.instancia,
        natureza: r.natureza,
        classe: r.classe,
        canal: r.canal,
        origem: r.origem,
        solicitante: r.solicitante,
        solicitanteNome: r.solicitanteNome,
        beneficiario: r.beneficiario,
        beneficiarioNome: el?.beneficiario.nome ?? null,
        carteirinha: r.carteirinha,
        prestador: r.prestador,
        autorizacaoId: r.autorizacao,
        origemId: r.origemProtocolo,
        numeroNip: r.numeroNip,
        urgente: r.urgente,
        altaComplexidade: r.altaComplexidade,
        assunto: r.assunto,
        relato: r.relato,
        abertoEm: r.abertoEm,
        prazoTipo: r.prazoTipo,
        prazoEm: r.prazoEm,
        prorrogadoAte: null,
        prorrogacaoMotivo: null,
        situacao: 'aberto',
        conclusao: null,
        resposta: null,
        fundamento: null,
        meio: null,
        respondidoEm: null,
        respondidoPor: null,
        escritaPedida: r.escritaPedida,
        escritaPedidaEm: r.escritaPedida ? r.abertoEm : null,
        escritaPrazoEm: null,
        escritaEnviadaEm: null,
        escritaMeio: null,
        encerradoEm: null,
        motivoCancelamento: null,
        versao: 1,
      });
      evento(id, 'registro', 'aberto', `Protocolo ${r.protocolo}`, r.usuario);
      return { id, versao: 1 };
    };
    const mudarAcesso = (
      a: { id: number; versao: number; usuario: string },
      f: (x: Acesso) => void,
    ): number => {
      const x = s.acessos.find((y) => y.id === a.id && y.hospital === h);
      if (!x || x.versao !== a.versao || x.situacao === 'encerrado') throw acessoDesatualizado();
      f(x);
      x.versao += 1;
      return x.versao;
    };
    return {
      proximoProtocolo: async () => ++s.seq.numero,
      registrar,
      analisar: async (a) => {
        const versao = mudar(a, ['aberto'], (p) => (p.situacao = 'em-analise'));
        evento(a.id, 'analise', 'em-analise', null, a.usuario);
        return { id: a.id, versao };
      },
      interagir: async (a) => {
        const versao = mudar(a, [a.situacao], () => undefined);
        evento(a.id, 'interacao', a.situacao as SituacaoProtocoloPorta, a.texto, a.usuario);
        return { id: a.id, versao };
      },
      prorrogar: async (a) => {
        const versao = mudar(a, [a.situacao], (p) => {
          p.prorrogadoAte = a.ate;
          p.prorrogacaoMotivo = a.motivo;
        });
        evento(
          a.id,
          'prorrogacao',
          a.situacao as SituacaoProtocoloPorta,
          `Prazo até ${a.ate.slice(0, 10)}: ${a.motivo}`,
          a.usuario,
        );
        return { id: a.id, versao };
      },
      responder: async (a) => {
        const versao = mudar(a, ['aberto', 'em-analise'], (p) => {
          p.situacao = 'respondido';
          p.conclusao = a.conclusao;
          p.resposta = a.resposta;
          p.fundamento = a.fundamento;
          p.meio = a.meio;
          p.respondidoEm = a.respondidoEm;
          p.respondidoPor = a.usuario;
          p.escritaPrazoEm = a.escritaPrazoEm;
        });
        evento(a.id, 'resposta', 'respondido', `Conclusão: ${a.conclusao}`, a.usuario);
        return { id: a.id, versao };
      },
      pedirEscrita: async (a) => {
        const versao = mudar(a, [a.situacao], (p) => {
          p.escritaPedida = true;
          p.escritaPedidaEm = a.pedidaEm;
          p.escritaPrazoEm = a.escritaPrazoEm;
        });
        evento(a.id, 'escrita-pedida', a.situacao as SituacaoProtocoloPorta, null, a.usuario);
        return { id: a.id, versao };
      },
      enviarEscrita: async (a) => {
        const versao = mudar(a, ['respondido'], (p) => {
          if (!p.escritaPedida) throw desatualizado();
          p.escritaEnviadaEm = this.agora();
          p.escritaMeio = a.meio;
        });
        evento(a.id, 'escrita-enviada', 'respondido', `Meio: ${a.meio}`, a.usuario);
        return { id: a.id, versao };
      },
      encerrar: async (a) => {
        const versao = mudar(a, ['respondido'], (p) => {
          if (p.escritaPedida && !p.escritaEnviadaEm) throw desatualizado();
          p.situacao = 'encerrado';
          p.encerradoEm = this.agora();
        });
        evento(a.id, 'encerramento', 'encerrado', null, a.usuario);
        return { id: a.id, versao };
      },
      cancelar: async (a) => {
        const versao = mudar(a, ['aberto', 'em-analise'], (p) => {
          p.situacao = 'cancelado';
          p.motivoCancelamento = a.motivo;
        });
        evento(a.id, 'cancelamento', 'cancelado', a.motivo, a.usuario);
        return { id: a.id, versao };
      },
      reanalise: async (a) => {
        const versaoOrigem = mudar(a, [a.situacao], () => undefined);
        const novo = await registrar({ ...a.novo, origemProtocolo: a.id });
        evento(
          a.id,
          'reanalise',
          a.situacao as SituacaoProtocoloPorta,
          `Reanálise na ouvidoria: protocolo ${a.novo.protocolo}`,
          a.usuario,
        );
        return { ...novo, origem: { id: a.id, versao: versaoOrigem } };
      },
      criarAcesso: async (x) => {
        if (s.acessos.some((y) => y.hospital === h && y.login === x.login))
          throw recusa('login-em-uso', 'Este e-mail já tem acesso ao portal neste estabelecimento.', 'login');
        const p = await this.rede.prestador(c, x.prestador);
        const id = ++s.seq.acesso;
        s.acessos.push({
          hospital: h,
          id,
          operadora: x.operadora,
          prestador: x.prestador,
          prestadorNome: p?.nome ?? '',
          login: x.login,
          nome: x.nome,
          funcoes: x.funcoes,
          tipoAtendimento: x.tipoAtendimento,
          situacao: 'pendente',
          ativacaoValidaAte: x.ativacaoValidade,
          ativacaoResumo: x.ativacaoResumo,
          senhaResumo: null,
          segundoFator: null,
          tentativas: 0,
          bloqueadoAte: null,
          ultimoAcessoEm: null,
          motivoEncerramento: null,
          versao: 1,
        });
        return { id, versao: 1 };
      },
      alterarAcesso: async (a) => ({
        id: a.id,
        versao: mudarAcesso(a, (x) => {
          x.funcoes = a.funcoes;
          x.tipoAtendimento = a.tipoAtendimento;
        }),
      }),
      reemitirAcesso: async (a) => ({
        id: a.id,
        versao: mudarAcesso(a, (x) => {
          x.situacao = 'pendente';
          x.ativacaoResumo = a.ativacaoResumo;
          x.ativacaoValidaAte = a.ativacaoValidade;
          x.senhaResumo = null;
          x.segundoFator = null;
          x.tentativas = 0;
          x.bloqueadoAte = null;
        }),
      }),
      encerrarAcesso: async (a) => ({
        id: a.id,
        versao: mudarAcesso(a, (x) => {
          x.situacao = 'encerrado';
          x.motivoEncerramento = a.motivo;
          x.ativacaoResumo = null;
          x.ativacaoValidaAte = null;
        }),
      }),
      ativarAcesso: async (a) => {
        const x = s.acessos.find((y) => y.id === a.id && y.hospital === h);
        if (
          !x ||
          x.situacao !== 'pendente' ||
          x.ativacaoResumo !== a.ativacaoResumo ||
          !x.ativacaoValidaAte ||
          x.ativacaoValidaAte <= this.agora()
        )
          throw recusa(
            'ativacao-invalida',
            'Código de ativação inválido ou vencido. Peça outro ao credenciamento da operadora.',
          );
        Object.assign(x, {
          situacao: 'ativo',
          ativacaoResumo: null,
          ativacaoValidaAte: null,
          senhaResumo: a.senhaResumo,
          segundoFator: a.segundoFator,
          tentativas: 0,
          bloqueadoAte: null,
          versao: x.versao + 1,
        });
        return { id: a.id };
      },
      // As mesmas recusas de responderInteracaoPrestadorSgh (o anexo conferido antes de qualquer gravação).
      responderInteracaoPrestador: async (a) => {
        const anexo = a.anexo
          ? { ...conferirAnexoResposta(a.anexo), bytes: Uint8Array.from(a.anexo.bytes) }
          : null;
        const texto = a.texto.trim();
        if (texto.length < 3)
          throw recusa('texto-curto', 'Escreva a resposta (ao menos 3 caracteres).', 'texto');
        const ev = s.eventos.find((x) => x.id === a.interacao && x.protocolo === a.id && x.hospital === h);
        if (!ev || ev.evento !== 'interacao' || s.respostas.some((r) => r.evento === ev.id))
          throw recusa(
            'interacao-inexistente',
            'Esta interação não existe neste protocolo ou não pede resposta. Abra o protocolo de novo.',
          );
        const p = s.protocolos.find((x) => x.id === a.id && x.hospital === h);
        if (!p || p.prestador !== a.prestador)
          throw recusa('protocolo-de-outro-prestador', 'Este protocolo não é do seu credenciamento.');
        if (!(SITUACOES_RESPOSTA_PRESTADOR as readonly string[]).includes(p.situacao))
          throw recusa(
            'protocolo-fechado',
            'O protocolo foi encerrado ou cancelado: a resposta não entra mais. Abra um novo contato, se precisar.',
          );
        const situacao = p.situacao;
        const versao = mudar(a, [situacao], () => undefined);
        evento(
          a.id,
          'interacao',
          situacao,
          `Resposta do prestador: ${texto}${anexo ? ` [anexo: ${anexo.nome}]` : ''}`,
          a.usuario,
        );
        const id = ++s.seq.resposta;
        s.respostas.push({
          id,
          hospital: h,
          protocolo: a.id,
          interacao: a.interacao,
          evento: s.seq.evento,
          prestador: a.prestador,
          acesso: a.acesso,
          texto: texto.slice(0, 1000),
          anexo: anexo
            ? { nome: anexo.nome, tipo: anexo.tipo, tamanho: anexo.tamanho, sha256: anexo.sha256 }
            : null,
          bytes: anexo?.bytes ?? null,
          em: this.agora(),
          por: a.usuario,
        });
        return { id: a.id, versao, resposta: id, evento: s.seq.evento };
      },
      // As mesmas recusas de registrarConsultaElegibilidadeSgh (o CHECK do banco).
      registrarElegibilidade: async (x) => {
        if (x.elegivel ? x.motivos.length > 0 || x.beneficiario === null : x.motivos.length === 0)
          throw recusa(
            'elegibilidade-incoerente',
            'O resultado da elegibilidade não confere com os motivos.',
          );
        const id = ++s.seq.elegibilidade;
        s.elegibilidades.push({
          id,
          hospital: h,
          prestador: x.prestador,
          carteirinha: x.carteirinha,
          data: x.data,
          elegivel: x.elegivel,
          motivos: [...x.motivos],
          beneficiario: x.beneficiario,
          em: this.agora(),
          por: x.usuario,
        });
        return { id };
      },
      // Como o UPDATE do banco: o contador sai do valor gravado agora (não do lido antes da gravação).
      trocarCredencial: async (a) => {
        const x = s.acessos.find((y) => y.id === a.id && y.hospital === h);
        if (!x || x.versao !== a.versao || x.situacao !== 'ativo') throw acessoDesatualizado();
        if (a.senhaResumo) x.senhaResumo = a.senhaResumo;
        if (a.segundoFator) x.segundoFator = a.segundoFator;
        x.versao += 1;
        return { id: a.id, versao: x.versao };
      },
      tentativaPortal: async (t) => {
        const x = s.acessos.find((y) => y.id === t.id && y.hospital === h && y.situacao === 'ativo');
        if (!x) return { id: t.id, alteradas: 0 };
        if (t.acertou) {
          if (acessoBloqueado(x.bloqueadoAte, t.agora)) return { id: t.id, alteradas: 0 };
          Object.assign(x, { tentativas: 0, bloqueadoAte: null, ultimoAcessoEm: this.agora() });
          return { id: t.id, alteradas: 1 };
        }
        const soma = x.tentativas + 1;
        if (soma >= t.limite) Object.assign(x, { tentativas: 0, bloqueadoAte: t.bloqueioAte });
        else x.tentativas = Math.min(99, soma);
        return { id: t.id, alteradas: 1 };
      },
    };
  }
}
