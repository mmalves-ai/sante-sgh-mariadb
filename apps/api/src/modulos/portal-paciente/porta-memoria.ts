// Porta do portal do paciente em memória (M50, etapa 1): a sessão sintética de dev/ci (E2E) e os testes da API, com as
// MESMAS recusas do banco (e-mail e convite únicos por estabelecimento, versão e situação conferidas, quem pediu o
// vínculo não decide). Pacientes SINTÉTICOS (os do prontuário em memória e um menor de idade), nenhum dado de pessoa.
// Os documentos vêm do prontuário em memória (M23/M49), quando ligado; a trilha das leituras, da trilha em memória.
import { recusa } from '@sgh/nucleo';
import {
  type ConsentimentoPortal,
  type ContaPortal,
  type DocumentoPortal,
  ErroPedido,
  ErroPortal,
  type FiltroFilaVinculosPortal,
  type LeituraTitular,
  type PacientePortal,
  type PedidoPortal,
  type TrocaEmailPortal,
  resumoSemEmail,
  TETO_FILA_VINCULOS,
  type VinculoPortal,
  type AtoCopia,
  type CopiaNaFila,
} from './tipos.js';
import type {
  ContextoPortal,
  ContextoPortalNucleo,
  DominiosConsentimento,
  GravadorPortal,
  ManifestacaoPortalLida,
  ManifestacaoPortalParaGravar,
  PortaPortalPaciente,
  TrilhaDaGravacao,
} from './porta.js';

const M = 'SINTETICO';

/** Pacientes sintéticos do portal (os dois adultos do prontuário em memória, um menor e um adulto com óbito). */
export const PACIENTES_PORTAL_SINTETICOS: Readonly<
  Record<number, { nome: string; nascimento: string; prontuario: number; obito?: boolean }>
> = {
  1001: { nome: `JOSÉ DA SILVA ${M}`, nascimento: '1958-03-12', prontuario: 501001 },
  1003: { nome: `CINTHYA GABRIELLA VIANNA ${M}`, nascimento: '1990-07-01', prontuario: 501003 },
  1005: { nome: `ENZO VIANNA ${M}`, nascimento: '2016-05-10', prontuario: 501005 },
  1007: { nome: `ANTONIO PEREIRA ${M}`, nascimento: '1940-01-20', prontuario: 501007, obito: true },
};

/** Documento do prontuário em memória (o mínimo que o portal precisa). */
export interface DocumentoMemoriaPortal {
  readonly id: number;
  readonly tipo: string;
  readonly paciente: number;
  readonly usuario: string;
  readonly nivel: string;
  readonly criadoEm: string | null;
  readonly assinadoEm: string | null;
  readonly suspenso: boolean;
}

interface Estado {
  contas: ContaPortal[];
  vinculos: VinculoPortal[];
  consentimentos: (ConsentimentoPortal & { paciente: number; conta: number | null })[];
  pedidos: (PedidoPortal & { paciente: number; conta: number })[];
  leituras: (LeituraTitular & { paciente: number })[];
  /** W0-10: os pedidos da troca do e-mail (com o resumo do token). */
  trocas: (TrocaEmailPortal & { tokenResumo: string })[];
  /** W0-10 (M1): as manifestações à ouvidoria feitas pelo portal (a ouvidoria interna em memória é outra porta). */
  manifestacoes?: (ManifestacaoPortalLida & { paciente: number })[];
  /** W0-10 (M2): os atos da cópia do prontuário (só inclusão), pelo ID do pedido. */
  atosCopia?: (AtoCopia & { idPedido: string })[];
  /** W0-10 (M2): o canal de cada pedido (o portal por padrão). */
  canais?: Record<string, string>;
  seq: number;
}

const DOMINIOS: DominiosConsentimento = {
  signatarios: [
    { id: 1, descricao: 'Paciente', ativo: true },
    { id: 2, descricao: 'Representante Legal', ativo: true },
  ],
  situacoes: [
    { id: 1, descricao: 'Lançado', ativo: true },
    { id: 3, descricao: 'Consentimento Autorizado', ativo: true },
    { id: 4, descricao: 'Não autorizado', ativo: true },
  ],
  revogacoes: [{ id: 2, descricao: 'Revogação', ativo: true }],
};

const semToken = (t: TrocaEmailPortal & { tokenResumo: string }): TrocaEmailPortal => {
  const x: Partial<typeof t> = { ...t };
  delete x.tokenResumo;
  return x as TrocaEmailPortal;
};

const versaoVelha = (o: string) =>
  new ErroPortal('versao-desatualizada', `A conta foi alterada por outra pessoa (${o}); recarregue.`);

/** W0-10 (M1): a ouvidoria interna em memória vista pelo portal (a mesma linha nas duas telas). */
export interface OuvidoriaInternaMemoria {
  /** `hospital`: o estabelecimento da sessão do portal (a coluna HOSPITAL da SGH_QUA_OUVIDORIA). */
  registrar(m: ManifestacaoPortalParaGravar, hospital: string): Promise<{ id: number; protocolo: string }>;
  doPaciente(paciente: number, hospital: string): Promise<ManifestacaoPortalLida[]>;
}

export class PortaPortalMemoria implements PortaPortalPaciente {
  readonly destino = 'memoria' as const;
  /** Na memória, o estabelecimento sintético 1 (as portas de memória dos outros módulos não usam o id). */
  async contexto(c: ContextoPortal): Promise<ContextoPortalNucleo> {
    return {
      cliente: c.rede,
      estabelecimento: 1,
      usuario: null,
      correlacao: 'portal-paciente',
      rede: c.rede,
      hospital: c.hospital,
    };
  }
  private readonly estados = new Map<string, Estado>();

  /**
   * W0-10 (M1): a ouvidoria interna em memória (a da gestão da qualidade), quando a aplicação a liga: a manifestação
   * do portal vai para ela e a resposta dada lá volta ao portal. Sem ela (testes da porta), a lista local.
   */
  ouvidoriaInterna: OuvidoriaInternaMemoria | null = null;

  constructor(
    private readonly documentosDoProntuario:
      ((hospital: string) => readonly DocumentoMemoriaPortal[]) | null = null,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  private e(c: ContextoPortal): Estado {
    let s = this.estados.get(c.hospital);
    if (!s) {
      s = { contas: [], vinculos: [], consentimentos: [], pedidos: [], leituras: [], trocas: [], seq: 100 };
      this.estados.set(c.hospital, s);
    }
    return s;
  }

  /**
   * Revisão do W0-10 (M3): os pedidos do titular abertos pelo portal, vistos e tratados pela área de privacidade em
   * memória (fonte-memoria da administração), como a SGH_AUD_PEDIDO_TITULAR única na cópia: o hospital atende a
   * portabilidade na tela interna e o portal passa a oferecer o pacote IPS.
   */
  pedidosParaPrivacidade() {
    return {
      listar: (hospital: string) =>
        (this.estados.get(hospital)?.pedidos ?? []).map((p) => ({
          ...p,
          prontuario: PACIENTES_PORTAL_SINTETICOS[p.paciente]?.prontuario ?? null,
        })),
      decidir: (
        hospital: string,
        id: string,
        situacao: 'identidade-verificada' | 'atendido' | 'negado',
        fundamento: string | null,
      ) => {
        const k = this.estados.get(hospital)?.pedidos.find((x) => x.id === id);
        if (!k) throw new ErroPedido('pedido-inexistente', 'Pedido não encontrado.');
        Object.assign(
          k,
          situacao === 'identidade-verificada'
            ? { situacao }
            : { situacao, fundamento, decididoEm: this.agora().toISOString() },
        );
      },
    };
  }

  /** Para os testes e o E2E: a ouvidoria interna responde a manifestação do portal (W0-10, M1). */
  responderManifestacao(c: ContextoPortal, protocolo: string, resposta: string): void {
    const m = this.e(c).manifestacoes?.find((x) => x.protocolo === protocolo);
    if (!m) throw new Error(`Manifestação ${protocolo} inexistente.`);
    Object.assign(m, {
      situacao: 'respondida',
      resposta,
      respondidaEm: this.agora().toISOString().slice(0, 19),
    });
  }

  /** Para os testes e o E2E: uma leitura do prontuário na trilha (o relatório de acessos). */
  registrarLeitura(c: ContextoPortal, l: LeituraTitular & { paciente: number }): void {
    this.e(c).leituras.unshift(l);
  }

  async gravar<T>(
    c: ContextoPortal,
    fn: (g: GravadorPortal) => Promise<T>,
    trilha: TrilhaDaGravacao<T>,
  ): Promise<T> {
    const s = this.e(c);
    // Transação: o estado é copiado e só volta se a função terminar sem erro (o erro sai sem tocar no estado).
    const copia = structuredClone(s);
    const r = await fn(this.gravador(c, copia));
    const linha = typeof trilha === 'function' ? trilha(r) : trilha;
    if (linha && linha.idPaciente && /^(portal\.documento\.visto|pep\.)/.test(linha.evento))
      copia.leituras.unshift({
        em: this.agora().toISOString(),
        usuario: linha.usuario,
        evento: linha.evento,
        idAlvo: linha.idAlvo,
        paciente: linha.idPaciente,
      });
    this.estados.set(c.hospital, copia);
    return r;
  }

  private gravador(c: ContextoPortal, s: Estado): GravadorPortal {
    const agora = () => this.agora();
    const conta = (id: number) => {
      const x = s.contas.find((k) => k.id === id);
      return x;
    };
    const trocar = (id: number, m: Partial<ContaPortal>) => {
      const i = s.contas.findIndex((k) => k.id === id);
      const atual = s.contas[i]!;
      s.contas[i] = { ...atual, ...m, versao: atual.versao + (m.versao === undefined ? 1 : 0) };
    };
    const trocarV = (id: number, m: Partial<VinculoPortal>) => {
      const i = s.vinculos.findIndex((k) => k.id === id);
      const atual = s.vinculos[i]!;
      s.vinculos[i] = { ...atual, ...m, versao: atual.versao + 1 };
    };
    const conviteUnico = (resumo: string, exceto: number) => {
      if (s.contas.some((k) => k.conviteResumo === resumo && k.id !== exceto))
        throw new ErroPortal('convite-repetido', 'Código de convite repetido.');
    };
    return {
      criarConta: async (x) => {
        const id = ++s.seq;
        conviteUnico(x.conviteResumo, id);
        s.contas.push({
          id,
          hospital: c.hospital,
          tipo: x.tipo,
          paciente: x.paciente,
          prontuario: x.prontuario,
          nome: x.nome,
          nascimento: x.nascimento,
          situacao: 'convidada',
          email: null,
          emailResumo: null,
          senhaResumo: null,
          segundoFator: null,
          segundoFatorEm: null,
          termosEm: null,
          conviteResumo: x.conviteResumo,
          conviteValidoAte: x.conviteValidoAte,
          conviteUsadoEm: null,
          conviteErradas: 0,
          conviteOrigem: x.origem,
          convidadoPor: x.por,
          tentativas: 0,
          bloqueadoAte: null,
          motivoBloqueio: null,
          motivoEncerramento: null,
          ativadaEm: null,
          ultimoAcessoEm: null,
          encerradaEm: null,
          criadaEm: agora(),
          versao: 1,
        });
        return { id };
      },
      reemitirConvite: async (id, versao, x) => {
        const k = conta(id);
        const ok = x.refazer ? ['ativa', 'bloqueada'] : ['convidada'];
        if (!k || k.versao !== versao || !ok.includes(k.situacao)) throw versaoVelha('convite');
        conviteUnico(x.conviteResumo, id);
        trocar(id, {
          situacao: 'convidada',
          conviteResumo: x.conviteResumo,
          conviteValidoAte: x.conviteValidoAte,
          conviteUsadoEm: null,
          conviteErradas: 0,
          conviteOrigem: x.origem,
          convidadoPor: x.por,
          tentativas: 0,
          bloqueadoAte: null,
          motivoBloqueio: null,
          ...(x.refazer
            ? {
                senhaResumo: null,
                segundoFator: null,
                segundoFatorEm: null,
                termosEm: null,
                email: null,
                emailResumo: null,
              }
            : {}),
        });
      },
      registrarErroConvite: async (id) => {
        const k = conta(id);
        if (k?.situacao === 'convidada')
          trocar(id, { conviteErradas: k.conviteErradas + 1, versao: k.versao });
      },
      ativar: async (id, versao, a) => {
        const k = conta(id);
        if (!k || k.versao !== versao || k.situacao !== 'convidada' || k.conviteUsadoEm)
          throw versaoVelha('ativação');
        if (
          s.contas.some(
            (o) => o.id !== id && o.emailResumo === a.emailResumo && o.emailResumo !== resumoSemEmail(o.id),
          )
        )
          throw new ErroPortal('email-em-uso', 'E-mail já usado em outra conta.');
        const t = agora();
        trocar(id, {
          situacao: 'ativa',
          email: a.email,
          emailResumo: a.emailResumo,
          senhaResumo: a.senhaResumo,
          segundoFator: a.segundoFator,
          segundoFatorEm: t,
          termosEm: t,
          conviteUsadoEm: t,
          ativadaEm: k.ativadaEm ?? t,
          ultimoAcessoEm: t,
          tentativas: 0,
          bloqueadoAte: null,
        });
      },
      registrarEntrada: async (id, r) => {
        const k = conta(id);
        if (k?.situacao !== 'ativa') return;
        if (r.acertou)
          trocar(id, { tentativas: 0, bloqueadoAte: null, ultimoAcessoEm: agora(), versao: k.versao });
        else
          trocar(id, {
            tentativas: Math.min(r.tentativas, 999),
            bloqueadoAte: r.bloqueadoAte,
            ...(r.bloqueadoAte ? { motivoBloqueio: 'tentativas' } : {}),
            versao: k.versao,
          });
      },
      trocarSenha: async (id, versao, senha) => {
        const k = conta(id);
        if (!k || k.versao !== versao || k.situacao !== 'ativa') throw versaoVelha('senha');
        trocar(id, { senhaResumo: senha });
      },
      trocarSegundoFator: async (id, versao, envelope) => {
        const k = conta(id);
        if (!k || k.versao !== versao || k.situacao !== 'ativa') throw versaoVelha('autenticador');
        trocar(id, { segundoFator: envelope, segundoFatorEm: agora() });
      },
      pedirTrocaEmail: async (t) => {
        const quando = agora().toISOString();
        for (const x of s.trocas)
          if (x.conta === t.conta && x.situacao === 'pendente')
            Object.assign(x, { situacao: 'cancelada', decididoEm: quando });
        if (s.trocas.some((x) => x.tokenResumo === t.tokenResumo))
          throw new ErroPortal('convite-repetido', 'Token repetido.');
        const id = ++s.seq;
        s.trocas.push({
          id,
          conta: t.conta,
          emailNovo: t.emailNovo,
          emailNovoResumo: t.emailNovoResumo,
          tokenResumo: t.tokenResumo,
          validoAte: t.validoAte,
          origem: t.origem,
          motivo: t.motivo,
          pedidoPor: t.pedidoPor,
          envio: t.envio,
          situacao: 'pendente',
          criadoEm: quando,
          decididoEm: null,
        });
        return { id };
      },
      confirmarTrocaEmail: async (troca, id, versao, x) => {
        const k = conta(id);
        if (!k || k.versao !== versao || !['ativa', 'bloqueada'].includes(k.situacao))
          throw versaoVelha('e-mail');
        if (s.contas.some((o) => o.id !== id && o.emailResumo === x.resumo && o.email !== null))
          throw new ErroPortal('email-em-uso', 'E-mail já usado em outra conta.');
        const t = s.trocas.find((y) => y.id === troca && y.conta === id && y.situacao === 'pendente');
        if (!t) throw new ErroPortal('situacao', 'O pedido de troca do e-mail não está mais pendente.');
        trocar(id, { email: x.email, emailResumo: x.resumo });
        Object.assign(t, { situacao: 'confirmada', decididoEm: agora().toISOString() });
      },
      cancelarTrocaEmail: async (troca) => {
        const t = s.trocas.find((y) => y.id === troca && y.situacao === 'pendente');
        if (!t) throw new ErroPortal('situacao', 'O pedido de troca do e-mail não está mais pendente.');
        Object.assign(t, { situacao: 'cancelada', decididoEm: agora().toISOString() });
      },
      bloquear: async (id, versao, d) => {
        const k = conta(id);
        if (!k || k.versao !== versao || !['ativa', 'bloqueada'].includes(k.situacao))
          throw versaoVelha('bloqueio');
        trocar(id, { situacao: 'bloqueada', motivoBloqueio: d.motivo, bloqueadoAte: null });
      },
      desbloquear: async (id, versao) => {
        const k = conta(id);
        if (!k || k.versao !== versao || !['ativa', 'bloqueada'].includes(k.situacao))
          throw versaoVelha('desbloqueio');
        trocar(id, { situacao: 'ativa', motivoBloqueio: null, bloqueadoAte: null, tentativas: 0 });
      },
      encerrar: async (id, versao, d) => {
        const k = conta(id);
        if (!k || k.situacao === 'encerrada' || (versao !== null && k.versao !== versao))
          throw versaoVelha('encerramento');
        trocar(id, { situacao: 'encerrada', motivoEncerramento: d.motivo, encerradaEm: agora() });
      },
      pedirVinculo: async (v) => {
        const id = ++s.seq;
        const ativo = v.decididoPor !== null;
        s.vinculos.push({
          id,
          hospital: c.hospital,
          conta: v.conta,
          titular: v.titular,
          prontuarioTitular: v.prontuarioTitular,
          tipo: v.tipo,
          prova: v.prova,
          arquivoChave: v.arquivoChave,
          arquivoHash: v.arquivoHash,
          validade: v.validade,
          escopos: [...v.escopos],
          situacao: ativo ? 'ativo' : 'pendente',
          canal: v.canal,
          pedidoEm: agora(),
          pedidoPor: v.por,
          decididoPor: v.decididoPor,
          decididoEm: ativo ? agora() : null,
          motivoRecusa: null,
          motivoFim: null,
          encerradoEm: null,
          versao: 1,
        });
        return { id };
      },
      decidirVinculo: async (id, versao, d) => {
        const v = s.vinculos.find((k) => k.id === id);
        if (!v || v.versao !== versao || v.situacao !== 'pendente')
          throw new ErroPortal('versao-desatualizada', 'O pedido foi alterado por outra pessoa; recarregue.');
        if (d.por === v.pedidoPor) throw new Error('CHECK SGH_CK_POR_RESP_SEGREGACAO');
        if (d.aprovar)
          trocarV(id, {
            situacao: 'ativo',
            escopos: [...d.escopos],
            validade: d.validade,
            decididoPor: d.por,
            decididoEm: agora(),
          });
        else
          trocarV(id, {
            situacao: 'recusado',
            motivoRecusa: d.motivo,
            decididoPor: d.por,
            decididoEm: agora(),
          });
      },
      encerrarVinculo: async (id, versao, d) => {
        const v = s.vinculos.find((k) => k.id === id);
        if (!v || !['pendente', 'ativo'].includes(v.situacao) || (versao !== null && v.versao !== versao))
          throw new ErroPortal('versao-desatualizada', 'O pedido foi alterado por outra pessoa; recarregue.');
        // Como o UPDATE do banco: o pedido nunca decidido recebe a decisão no mesmo instante do fim.
        const t = agora();
        trocarV(id, {
          situacao: 'encerrado',
          motivoFim: d.motivo,
          encerradoEm: t,
          decididoPor: v.decididoPor ?? d.por,
          decididoEm: v.decididoEm ?? t,
        });
      },
      registrarConsentimento: async (x) => {
        if (!DOMINIOS.situacoes.some((d) => d.id === x.situacao && d.ativo))
          throw recusa('situacao-invalida', 'Situação do termo desconhecida.', { campos: ['situacao'] });
        if (!DOMINIOS.signatarios.some((d) => d.id === x.signatario && d.ativo))
          throw recusa('signatario-invalido', 'Signatário desconhecido.', { campos: ['signatario'] });
        const id = ++s.seq;
        s.consentimentos.unshift({
          id,
          paciente: x.idPaciente,
          conta: x.conta,
          finalidade: x.finalidade,
          versao: x.versao,
          situacao: x.situacao,
          signatario: x.signatario,
          registradoEm: agora().toISOString(),
          revogadoEm: null,
          canal: 'portal',
        });
        return { id };
      },
      revogarConsentimento: async (r) => {
        const k = s.consentimentos.find(
          (x) => x.id === r.id && x.paciente === r.idPaciente && x.revogadoEm === null,
        );
        if (!k) throw recusa('consentimento-revogado', 'O consentimento não existe ou já foi revogado.');
        if (!DOMINIOS.revogacoes.some((d) => d.id === r.motivo))
          throw recusa('motivo-invalido', 'Tipo de revogação desconhecido.', { campos: ['motivo'] });
        Object.assign(k, { revogadoEm: agora().toISOString() });
      },
      registrarPedido: async (p) => {
        if (!PACIENTES_PORTAL_SINTETICOS[p.idPaciente]) throw new Error('Paciente não encontrado.');
        const id = String(++s.seq);
        const t = agora();
        const protocolo = `${t.getUTCFullYear()}-${id.padStart(6, '0')}`;
        s.pedidos.unshift({
          id,
          protocolo,
          tipo: p.tipo,
          situacao: p.identidadeVerificada ? 'identidade-verificada' : 'aberto',
          abertoEm: t.toISOString(),
          prazo: new Date(t.getTime() + p.prazoDias * 86_400_000).toISOString(),
          decididoEm: null,
          fundamento: null,
          resposta: null,
          motivoCancelamento: null,
          paciente: p.idPaciente,
          conta: p.conta,
        });
        return { id, protocolo };
      },
      cancelarPedido: async (p) => {
        const k = s.pedidos.find(
          (x) => x.protocolo === p.protocolo && x.paciente === p.idPaciente && x.conta === p.conta,
        );
        if (!k) throw new ErroPedido('pedido-inexistente', 'Pedido não encontrado.');
        const recusa = p.conferir(k.situacao);
        if (recusa) throw new ErroPedido('transicao', recusa);
        Object.assign(k, {
          situacao: 'cancelado',
          motivoCancelamento: p.motivo,
          decididoEm: agora().toISOString(),
        });
      },
      pedirCopia: async (p) => {
        if (!PACIENTES_PORTAL_SINTETICOS[p.idPaciente]) throw new Error('Paciente não encontrado.');
        const id = String(++s.seq);
        const t = agora();
        const protocolo = `${t.getUTCFullYear()}-${id.padStart(6, '0')}`;
        s.pedidos.unshift({
          id,
          protocolo,
          tipo: 'acesso',
          situacao: p.identidadeVerificada ? 'identidade-verificada' : 'aberto',
          abertoEm: t.toISOString(),
          prazo: new Date(t.getTime() + p.prazoDias * 86_400_000).toISOString(),
          decididoEm: null,
          fundamento: null,
          resposta: null,
          motivoCancelamento: null,
          paciente: p.idPaciente,
          conta: p.conta ?? 0,
        });
        (s.canais ??= {})[id] = p.canal;
        (s.atosCopia ??= []).push(atoMemoria(++s.seq, id, 'solicitacao', p.por, t, p));
        return { id, protocolo };
      },
      registrarAtoCopia: async (d) => {
        const k = s.pedidos.find(
          (x) => x.protocolo === d.protocolo && (d.idPaciente === null || x.paciente === d.idPaciente),
        );
        if (!k) throw new ErroPedido('pedido-inexistente', 'Pedido não encontrado.');
        if (k.tipo !== 'acesso')
          throw new ErroPedido('transicao', 'A cópia do prontuário é um pedido de acesso aos dados.');
        const atos = (s.atosCopia ??= []).filter((a) => a.idPedido === k.id);
        const r = d.conferir(k.situacao, atos);
        if (r) throw new ErroPedido('transicao', r);
        const id = ++s.seq;
        s.atosCopia.push(atoMemoria(id, k.id, d.ato, d.por, agora(), d));
        if (d.ato === 'legitimidade' && k.situacao === 'aberto')
          Object.assign(k, { situacao: 'identidade-verificada' });
        if (d.ato === 'entrega')
          Object.assign(k, { situacao: 'atendido', decididoEm: agora().toISOString() });
        return { id: String(id), idPedido: k.id, protocolo: k.protocolo, situacao: k.situacao };
      },
      registrarManifestacao: async (m) => {
        if (this.ouvidoriaInterna) return this.ouvidoriaInterna.registrar(m, c.hospital);
        const id = ++s.seq;
        const protocolo = m.protocoloDe(id);
        (s.manifestacoes ??= []).unshift({
          id,
          protocolo,
          tipo: m.tipo,
          area: m.area,
          relato: m.relato,
          recebidaEm: m.recebidaEm,
          prazoEm: m.prazoEm,
          situacao: 'aberta',
          resposta: null,
          respondidaEm: null,
          canceladaEm: null,
          paciente: m.paciente,
        });
        return { id, protocolo };
      },
    };
  }

  private lido(id: number): PacientePortal | null {
    const p = PACIENTES_PORTAL_SINTETICOS[id];
    if (!p) return null;
    return {
      id,
      prontuario: p.prontuario,
      nascimento: p.nascimento,
      ativo: true,
      obito: p.obito === true,
      unificadoEm: null,
      primeiroNome:
        (p.nome.split(' ')[0] ?? '').charAt(0) + (p.nome.split(' ')[0] ?? '').slice(1).toLowerCase(),
      capacidadeCivil: null,
      temGuardiao: false,
    };
  }

  async paciente(_c: ContextoPortal, id: number) {
    return this.lido(id);
  }
  async pacientesPorProntuario(_c: ContextoPortal, prontuario: number) {
    return Object.entries(PACIENTES_PORTAL_SINTETICOS)
      .filter(([, p]) => p.prontuario === prontuario)
      .map(([id]) => this.lido(Number(id))!)
      .slice(0, 2);
  }
  async capacidadesCivis() {
    return [
      { id: 1, descricao: 'Incapaz' },
      { id: 2, descricao: 'Relativamente Incapaz' },
      { id: 3, descricao: 'Capaz' },
    ];
  }
  async conta(c: ContextoPortal, id: number) {
    return this.e(c).contas.find((k) => k.id === id) ?? null;
  }
  async contaPorEmail(c: ContextoPortal, r: string) {
    return this.e(c).contas.find((k) => k.emailResumo === r && k.email !== null) ?? null;
  }
  async contaPorConvite(c: ContextoPortal, r: string) {
    return this.e(c).contas.find((k) => k.conviteResumo === r) ?? null;
  }
  async trocaEmailPorToken(c: ContextoPortal, r: string) {
    const t = this.e(c).trocas.find((x) => x.tokenResumo === r);
    return t ? semToken(t) : null;
  }
  async trocaEmailPendente(c: ContextoPortal, conta: number) {
    const t = this.e(c)
      .trocas.filter((x) => x.conta === conta && x.situacao === 'pendente')
      .at(-1);
    return t ? semToken(t) : null;
  }
  async contaDoPaciente(c: ContextoPortal, p: number) {
    const todas = this.e(c)
      .contas.filter((k) => k.paciente === p)
      .sort((a, b) => b.id - a.id);
    return todas.find((k) => k.situacao !== 'encerrada') ?? todas[0] ?? null;
  }
  async contasAbertas(c: ContextoPortal) {
    return this.e(c)
      .contas.filter((k) => k.tipo === 'paciente' && k.situacao !== 'encerrada' && k.paciente !== null)
      .map((k) => ({ conta: k.id, paciente: k.paciente as number, versao: k.versao }));
  }
  async vinculosDaConta(c: ContextoPortal, conta: number) {
    return this.e(c)
      .vinculos.filter((v) => v.conta === conta)
      .sort((a, b) => b.id - a.id);
  }
  async vinculosDoTitular(c: ContextoPortal, p: number) {
    return this.e(c)
      .vinculos.filter((v) => v.titular === p)
      .sort((a, b) => b.id - a.id);
  }
  async vinculo(c: ContextoPortal, id: number) {
    return this.e(c).vinculos.find((v) => v.id === id) ?? null;
  }
  /** A mesma página do banco: ordem de chegada (ID), filtro do titular, cursor e o teto (TETO_FILA_VINCULOS). */
  async filaVinculos(c: ContextoPortal, f: FiltroFilaVinculosPortal) {
    if (f.titulares && f.titulares.length === 0) return { itens: [], haMais: false };
    const r = this.e(c)
      .vinculos.filter(
        (v) =>
          (f.situacao === null || v.situacao === f.situacao) &&
          (!f.titulares || f.titulares.includes(v.titular)) &&
          (f.depoisDe === null || f.depoisDe === undefined || v.id > f.depoisDe),
      )
      .sort((a, b) => a.id - b.id);
    return { itens: r.slice(0, TETO_FILA_VINCULOS), haMais: r.length > TETO_FILA_VINCULOS };
  }
  async vinculosAtivos(c: ContextoPortal) {
    return this.e(c).vinculos.filter((v) => v.situacao === 'ativo');
  }
  async guardiaoConfere() {
    return false;
  }
  async dominiosConsentimento() {
    return DOMINIOS;
  }
  async consentimentos(c: ContextoPortal, p: number) {
    return this.e(c).consentimentos.filter((k) => k.paciente === p);
  }
  async pedidos(c: ContextoPortal, conta: number, p: number) {
    return this.e(c).pedidos.filter((k) => k.conta === conta && k.paciente === p);
  }
  async documentos(
    c: ContextoPortal,
    p: number,
    tipos: readonly string[],
    pagina: number,
    apenas: number | null = null,
  ) {
    const todos = (this.documentosDoProntuario?.(c.hospital) ?? [])
      .filter((d) => d.paciente === p && tipos.includes(d.tipo) && (apenas === null || d.id === apenas))
      .map((d): DocumentoPortal => ({
        id: d.id,
        tipo: d.tipo,
        paciente: d.paciente,
        criadoEm: d.criadoEm ?? '',
        usuario: d.usuario,
        nivelAssinatura: d.nivel,
        eventos: [...(d.assinadoEm ? ['assinado'] : []), ...(d.suspenso ? ['suspenso'] : [])],
        assinaturaIcp: d.nivel === 'icp-brasil' ? d.id : null,
        codigoVerificacao: null,
      }))
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
    const de = (Math.max(1, pagina) - 1) * 100;
    return { itens: todos.slice(de, de + 100), haMais: todos.length > de + 100 };
  }
  async leituras(c: ContextoPortal, p: number, eventos: readonly string[], de: string, ate: string) {
    const itens = this.e(c).leituras.filter(
      (l) =>
        l.paciente === p && eventos.includes(l.evento) && l.em.slice(0, 10) >= de && l.em.slice(0, 10) <= ate,
    );
    return { itens, haMais: false };
  }
  async manifestacoes(c: ContextoPortal, paciente: number): Promise<ManifestacaoPortalLida[]> {
    if (this.ouvidoriaInterna) return this.ouvidoriaInterna.doPaciente(paciente, c.hospital);
    return (this.e(c).manifestacoes ?? []).filter((m) => m.paciente === paciente).map((m) => ({ ...m }));
  }
  async filaCopias(
    c: ContextoPortal,
    f: { readonly pendentes: boolean; readonly idPaciente?: number },
  ): Promise<CopiaNaFila[]> {
    const s = this.e(c);
    const atos = s.atosCopia ?? [];
    const pend = (x: string) => x === 'aberto' || x === 'identidade-verificada';
    return s.pedidos
      .filter((p) => atos.some((a) => a.idPedido === p.id && a.ato === 'solicitacao'))
      .filter(
        (p) =>
          (!f.pendentes || pend(p.situacao)) && (f.idPaciente === undefined || p.paciente === f.idPaciente),
      )
      .map((p) => {
        const meus = atos.filter((a) => a.idPedido === p.id);
        const sol = meus.find((a) => a.ato === 'solicitacao')!;
        return {
          idPedido: p.id,
          protocolo: p.protocolo,
          situacao: p.situacao,
          canal: s.canais?.[p.id] ?? 'portal',
          idPaciente: p.paciente,
          prontuario: PACIENTES_PORTAL_SINTETICOS[p.paciente]?.prontuario ?? null,
          abertoEm: new Date(p.abertoEm),
          prazo: new Date(p.prazo),
          solicitante: sol.solicitante ?? 'titular',
          vinculo: sol.vinculo,
          legitimidade: meus.some((a) => a.ato === 'legitimidade'),
          geracoes: meus.filter((a) => a.ato === 'geracao').length,
          entregue: meus.some((a) => a.ato === 'entrega'),
        };
      })
      .sort((a, b) => Number(!pend(a.situacao)) - Number(!pend(b.situacao)) || +a.prazo - +b.prazo);
  }
  async atosCopia(c: ContextoPortal, idPedido: string): Promise<AtoCopia[]> {
    return (this.e(c).atosCopia ?? [])
      .filter((a) => a.idPedido === idPedido)
      .map((a): AtoCopia => {
        const { idPedido: id, ...resto } = a;
        void id;
        return resto;
      });
  }
  async feriados(): Promise<readonly { data: string; nome: string }[]> {
    return [];
  }
  async nomes(_c: ContextoPortal, logins: readonly string[]) {
    return new Map(
      logins.filter((l) => /^SINT\./.test(l)).map((l) => [l, `PROFISSIONAL ${l.slice(5)} ${M}`]),
    );
  }
}

function atoMemoria(
  id: number,
  idPedido: string,
  ato: AtoCopia['ato'],
  por: string,
  em: Date,
  d: {
    solicitante?: string;
    vinculo?: string | null;
    prova?: string | null;
    hash?: string;
    paginas?: number;
    meio?: string;
    recebedor?: string | null;
  },
): AtoCopia & { idPedido: string } {
  return {
    id: String(id),
    idPedido,
    ato,
    solicitante: d.solicitante ?? null,
    vinculo: d.vinculo ?? null,
    prova: d.prova ?? null,
    hash: d.hash ?? null,
    paginas: d.paginas ?? null,
    meio: d.meio ?? null,
    recebedor: d.recebedor ?? null,
    usuario: por.slice(0, 31),
    em,
  };
}
