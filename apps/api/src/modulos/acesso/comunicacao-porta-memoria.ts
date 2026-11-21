// Porta da comunicação interna em MEMÓRIA (sessão sintética de dev/ci; E2E): mensagens, comunicados, avisos e o
// dicionário dos usuários SINTÉTICOS, com as mesmas validações (Zod dos contratos e das receitas) e as mesmas recusas
// das gravações do banco. As mensagens anteriores são duas linhas sintéticas do SINT.MEDICO. Nada vai a banco.
// Melhoria: os tipos são os do contrato das telas e a trilha tem a forma da do núcleo (ids, evento nos dados).
import { foneticaDoDicionario, palavraDoDicionario, TETO_DICIONARIO } from '@sgh/contratos';
import type { MensagemAnterior, MensagemEnviada, MensagemRecebida } from '@sgh/contratos';
import { ErroOperacao, erroIdempotenciaDivergente, recusa } from '@sgh/nucleo';
import { ENTRADA_DICIONARIO, OPERACOES_DICIONARIO, operacaoDoDicionario } from './comunicacao-operacoes.js';
import { CONTAS_SINTETICAS } from './fonte-sintetica.js';
import type {
  AvisoRegistrado,
  ComunicadoRegistrado,
  ContextoComunicacao,
  ContextoOperacaoComunicacao,
  GravadorComunicacao,
  LiberacaoComunicacao,
  PedidoGravacao,
  PortaComunicacao,
  TrilhaComunicacao,
} from './comunicacao-porta.js';
import { descricaoVersaoAnterior } from './comunicacao-porta.js';

/** O estado de cada operação no catálogo do estabelecimento (memória de dev/ci). */
export interface CatalogoComunicacao {
  estado(operacao: string, hospital: string): string | null;
}

interface MensagemMem {
  id: number;
  tipo: 'mensagem' | 'comunicado';
  remetente: string;
  assunto: string;
  texto: string;
  ciencia: boolean;
  atendimento: number | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  em: string;
  idempotencia: string;
  /** W0-09: o encerramento e os eventos do comunicado (só inclusão). */
  encerradoEm: string | null;
  encerradoPor: string | null;
  motivoEncerramento: string | null;
  eventos: ComunicadoRegistrado['eventos'][number][];
}
interface DestMem {
  mensagem: number;
  login: string;
  via: string;
  lidaEm: string | null;
  cienciaEm: string | null;
}
interface AvisoMem extends AvisoRegistrado {
  login: string;
  objetoTabela?: string | null;
  objetoChave: string;
}
interface Estado {
  mensagens: MensagemMem[];
  dests: DestMem[];
  avisos: AvisoMem[];
  dicionario: Map<string, Map<string, string>>;
  idem: Map<string, { hash: string; resultado: Record<string, unknown> }>;
  /** Resumo do conteúdo por operação e Idempotency-Key das gravações da comunicação (o reenvio diferente é recusado). */
  pedidos: Map<string, string>;
  trilha: TrilhaComunicacao[];
  seq: number;
}

/** Duas mensagens antigas sintéticas (o sistema anterior) do médico sintético. */
const ANTERIORES: Readonly<Record<string, readonly MensagemAnterior[]>> = {
  'SINT.MEDICO': [
    {
      sequencia: 2,
      origem: 'SINT.ADMIN',
      texto: 'Mensagem sintética do sistema anterior (consulta).',
      enviadaEm: '2024-03-10T09:15:00.000',
      lidaEm: '2024-03-10T10:00:00.000',
    },
    {
      sequencia: 1,
      origem: 'SINT.GESTOR',
      texto: 'Outra mensagem sintética antiga.',
      enviadaEm: '2023-11-02T14:30:00.000',
      lidaEm: '2023-11-03T08:00:00.000',
    },
  ],
};

const agoraLocal = () => new Date().toISOString().slice(0, 23);

/**
 * Dois avisos sintéticos do gestor da comunicação sintético (conta só do E2E do M27, para não interromper as telas dos
 * outros marcos), para a sessão de dev/ci mostrar a higiene de alertas (regra 6): um de risco grave (alergia), que
 * interrompe uma vez, e um informativo, que só vai à central. Na Fase 2 nenhum módulo emite aviso grave ainda (a
 * farmácia, M29, e a checagem à beira do leito, M25, emitem pela `emitir`); no banco, nada é semeado.
 */
const AVISOS_SINTETICOS: readonly Omit<AvisoMem, 'id' | 'criadoEm'>[] = [
  {
    login: 'SINT.COMUNICACAO',
    tipo: 'alergia',
    gravidade: 'grave',
    modulo: 'pep',
    evento: 'pep.alergia.registrada',
    titulo: 'Alergia nova registrada para um paciente acompanhado (aviso sintético de teste).',
    link: '/mensagens',
    estado: 'novo',
    objetoChave: 'sintetico-alergia',
  },
  {
    login: 'SINT.COMUNICACAO',
    tipo: 'resultado-liberado',
    gravidade: 'informacao',
    modulo: 'sadt',
    evento: 'sadt.resultado.liberado',
    titulo: 'Resultado de exame liberado (sintético).',
    link: '/mensagens',
    estado: 'novo',
    objetoChave: 'sintetico-resultado',
  },
];

export class PortaComunicacaoMemoria implements PortaComunicacao {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  constructor(private readonly catalogo: CatalogoComunicacao | null = null) {}

  private e(c: ContextoComunicacao): Estado {
    let s = this.estados.get(c.hospital);
    if (!s) {
      s = {
        mensagens: [],
        dests: [],
        avisos: [],
        dicionario: new Map(),
        idem: new Map(),
        pedidos: new Map(),
        trilha: [],
        seq: 0,
      };
      for (const a of AVISOS_SINTETICOS) s.avisos.push({ ...a, id: ++s.seq, criadoEm: agoraLocal() });
      this.estados.set(c.hospital, s);
    }
    return s;
  }

  /** Trilha gravada em memória (os testes conferem que o texto não vai à trilha). */
  trilhaDe(hospital: string): readonly TrilhaComunicacao[] {
    return this.estados.get(hospital)?.trilha ?? [];
  }

  private recebidaDe(m: MensagemMem, d: DestMem): MensagemRecebida {
    return {
      id: m.id,
      tipo: m.tipo,
      assunto: m.assunto,
      texto: m.texto,
      remetente: m.remetente,
      enviadaEm: m.em,
      cienciaObrigatoria: m.ciencia,
      lidaEm: d.lidaEm,
      cienciaEm: d.cienciaEm,
      contextoAtendimento: m.atendimento,
      // Sessão sintética: o atendimento sintético N0/N1 é do paciente N (a mesma regra das portas do prontuário).
      contextoPaciente: m.atendimento === null ? null : Math.floor(m.atendimento / 10),
      vigenciaInicio: m.vigenciaInicio,
      vigenciaFim: m.vigenciaFim,
      via: d.via,
      encerradoEm: m.encerradoEm,
      motivoEncerramento: m.motivoEncerramento,
    };
  }

  async recebidas(c: ContextoComunicacao, login: string): Promise<MensagemRecebida[]> {
    const s = this.e(c);
    const agora = agoraLocal();
    return s.dests
      .filter((d) => d.login === login)
      .map((d) => ({ d, m: s.mensagens.find((x) => x.id === d.mensagem)! }))
      .filter(
        ({ m, d }) =>
          m.tipo === 'mensagem' ||
          (m.encerradoEm === null &&
            (m.vigenciaInicio ?? '') <= agora &&
            ((m.vigenciaFim ?? '') > agora || (m.ciencia && d.cienciaEm === null))) ||
          (m.encerradoEm !== null && d.lidaEm !== null),
      )
      .sort((a, b) => b.m.em.localeCompare(a.m.em) || b.m.id - a.m.id)
      .slice(0, 100)
      .map(({ m, d }) => this.recebidaDe(m, d));
  }

  /** Sessão sintética: o atendimento N0/N1 é do paciente N (a regra das portas do prontuário); os demais não existem. */
  async atendimentoDoContexto(
    _c: ContextoComunicacao,
    atendimento: number,
  ): Promise<{ paciente: number } | null> {
    return atendimento >= 10 && atendimento % 10 <= 1 ? { paciente: Math.floor(atendimento / 10) } : null;
  }

  async recebida(c: ContextoComunicacao, login: string, id: number): Promise<MensagemRecebida | null> {
    const s = this.e(c);
    const d = s.dests.find((x) => x.login === login && x.mensagem === id);
    const m = s.mensagens.find((x) => x.id === id);
    return d && m ? this.recebidaDe(m, d) : null;
  }

  async enviadas(c: ContextoComunicacao, login: string): Promise<MensagemEnviada[]> {
    const s = this.e(c);
    return s.mensagens
      .filter((m) => m.remetente === login)
      .sort((a, b) => b.em.localeCompare(a.em) || b.id - a.id)
      .map((m) => {
        const ds = s.dests.filter((d) => d.mensagem === m.id);
        return {
          id: m.id,
          tipo: m.tipo,
          assunto: m.assunto,
          enviadaEm: m.em,
          destinatarios: ds.length,
          lidas: ds.filter((d) => d.lidaEm).length,
          ciencias: ds.filter((d) => d.cienciaEm).length,
          cienciaObrigatoria: m.ciencia,
          vigenciaInicio: m.vigenciaInicio,
          vigenciaFim: m.vigenciaFim,
          encerradoEm: m.encerradoEm,
        };
      });
  }

  async comunicado(c: ContextoComunicacao, id: number): Promise<ComunicadoRegistrado | null> {
    const s = this.e(c);
    const m = s.mensagens.find((x) => x.id === id && x.tipo === 'comunicado');
    if (!m) return null;
    return {
      id: m.id,
      remetente: m.remetente,
      assunto: m.assunto,
      texto: m.texto,
      cienciaObrigatoria: m.ciencia,
      publicadoEm: m.em,
      vigenciaInicio: m.vigenciaInicio ?? '',
      vigenciaFim: m.vigenciaFim ?? '',
      encerradoEm: m.encerradoEm,
      encerradoPor: m.encerradoPor,
      motivoEncerramento: m.motivoEncerramento,
      destinatarios: s.dests
        .filter((d) => d.mensagem === id)
        .sort((a, b) => a.login.localeCompare(b.login))
        .map((d) => ({ login: d.login, via: d.via, lidaEm: d.lidaEm, cienciaEm: d.cienciaEm })),
      eventos: [...m.eventos],
    };
  }

  async anteriores(_c: ContextoComunicacao, login: string): Promise<MensagemAnterior[]> {
    return [...(ANTERIORES[login] ?? [])];
  }

  async dicionario(c: ContextoComunicacao, login: string): Promise<{ palavra: string; fonetica: string }[]> {
    return [...(this.e(c).dicionario.get(login) ?? new Map<string, string>())]
      .map(([palavra, fonetica]) => ({ palavra, fonetica }))
      .sort((a, b) => a.palavra.localeCompare(b.palavra));
  }

  async avisos(c: ContextoComunicacao, login: string): Promise<AvisoRegistrado[]> {
    const ordem = { novo: 0, lido: 1, resolvido: 2 } as const;
    return this.e(c)
      .avisos.filter((a) => a.login === login)
      .sort(
        (a, b) => ordem[a.estado] - ordem[b.estado] || b.criadoEm.localeCompare(a.criadoEm) || b.id - a.id,
      )
      .slice(0, 100)
      .map((a) => ({
        id: a.id,
        tipo: a.tipo,
        gravidade: a.gravidade,
        modulo: a.modulo,
        evento: a.evento,
        titulo: a.titulo,
        link: a.link,
        estado: a.estado,
        criadoEm: a.criadoEm,
      }));
  }

  async destinatarios(
    _c: ContextoComunicacao,
    destinos: readonly { tipo: 'usuario' | 'grupo' | 'setor' | 'unidade'; valor: string }[],
    teto: number,
  ) {
    const vistos = new Map<string, string>();
    const desconhecidos: string[] = [];
    const contas = Object.entries(CONTAS_SINTETICAS).filter(([, c]) => c.ativo && !c.bloqueado);
    for (const d of destinos) {
      const logins =
        d.tipo === 'usuario'
          ? contas.filter(([l]) => l === d.valor).map(([l]) => l)
          : d.tipo === 'grupo'
            ? contas.filter(([, c]) => c.concessoes?.grupo === d.valor).map(([l]) => l)
            : d.tipo === 'unidade'
              ? contas
                  .filter(([, c]) => (c.unidades ?? []).some((u) => String(u.codigo) === d.valor))
                  .map(([l]) => l)
              : [];
      if (logins.length === 0) desconhecidos.push(`${d.tipo} ${d.valor}`);
      for (const l of logins)
        if (!vistos.has(l)) vistos.set(l, d.tipo === 'usuario' ? 'usuario' : `${d.tipo} ${d.valor}`);
    }
    return {
      destinatarios: [...vistos].slice(0, teto).map(([login, via]) => ({ login, via })),
      desconhecidos,
      passou: vistos.size > teto,
    };
  }

  async podeGravar(c: ContextoComunicacao, op: string): Promise<LiberacaoComunicacao> {
    const est = this.catalogo?.estado(op, c.hospital) ?? 'verde';
    if (est === null || est === 'bloqueada')
      return { pode: false, codigo: 'operacao-bloqueada', motivo: 'Operação bloqueada no catálogo.' };
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(c: ContextoComunicacao, op: string, entradaBruta: unknown, ctx: ContextoOperacaoComunicacao) {
    const nome = operacaoDoDicionario(op);
    if (!nome) throw new Error(`Operação ${op} fora da comunicação.`);
    const analise = ENTRADA_DICIONARIO.safeParse(entradaBruta);
    if (!analise.success)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(analise.error.issues.map((i) => i.path.join('.') || '(entrada)'))],
      });
    const s = this.e(c);
    const chave = `${op}:${ctx.chaveIdempotencia}`;
    const hash = JSON.stringify(analise.data);
    const anterior = s.idem.get(chave);
    if (anterior) {
      if (anterior.hash !== hash)
        throw new ErroOperacao(
          422,
          'idempotencia-divergente',
          'Pedido repetido diferente',
          'A mesma chave veio com outro conteúdo.',
        );
      return { resultado: anterior.resultado, repetida: true };
    }
    const palavra = palavraDoDicionario((analise.data as { palavra: string }).palavra);
    const meu = s.dicionario.get(ctx.login) ?? new Map<string, string>();
    if (nome === OPERACOES_DICIONARIO.incluir) {
      if (meu.has(palavra))
        throw recusa('palavra-existente', 'A palavra já está no seu dicionário.', { campos: ['palavra'] });
      if (meu.size >= TETO_DICIONARIO)
        throw recusa(
          'dicionario-cheio',
          `O dicionário chegou a ${TETO_DICIONARIO} palavras: exclua alguma antes de incluir outra.`,
        );
      meu.set(palavra, foneticaDoDicionario(palavra));
      s.dicionario.set(ctx.login, meu);
    } else {
      if (!meu.delete(palavra))
        throw recusa('palavra-inexistente', 'A palavra não está no seu dicionário.', { campos: ['palavra'] });
    }
    const resultado = { palavras: 1 };
    s.idem.set(chave, { hash, resultado });
    s.trilha.push({
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      acao: nome === OPERACOES_DICIONARIO.incluir ? 'inclusao' : 'exclusao',
      entidade: 'dicionario_usuario',
      entidadeId: null,
      dadosDepois: { operacao: op },
      correlacao: ctx.correlacao,
    });
    return { resultado, repetida: false };
  }

  async gravarSgh<T>(
    c: ContextoComunicacao,
    trilha: TrilhaComunicacao | ((r: T) => TrilhaComunicacao),
    fn: (g: GravadorComunicacao) => Promise<T>,
    pedido?: PedidoGravacao,
  ): Promise<T> {
    const s = this.e(c);
    if (pedido?.chave) {
      const k = `${pedido.operacao}:${pedido.chave}`;
      const resumo = pedido.resumo ?? '';
      const anterior = s.pedidos.get(k);
      if (anterior !== undefined && anterior !== resumo) throw erroIdempotenciaDivergente();
      s.pedidos.set(k, resumo);
    }
    // Transação em memória: o que a função mudou só fica se ela terminar (o erro desfaz).
    const copia = structuredClone({ mensagens: s.mensagens, dests: s.dests, avisos: s.avisos, seq: s.seq });
    try {
      const r = await fn(this.gravador(s));
      s.trilha.push(typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    } catch (e) {
      Object.assign(s, copia);
      throw e;
    }
  }

  private gravador(s: Estado): GravadorComunicacao {
    return {
      gravarMensagem: async (m) => {
        const ja = s.mensagens.find((x) => x.remetente === m.remetente && x.idempotencia === m.idempotencia);
        if (ja) return { id: ja.id, repetida: true };
        if (m.destinatarios.length === 0)
          throw recusa('sem-destinatario', 'Nenhum destinatário ativo nos destinos escolhidos.');
        const id = ++s.seq;
        s.mensagens.push({
          id,
          tipo: m.tipo,
          remetente: m.remetente,
          assunto: m.assunto,
          texto: m.texto,
          ciencia: m.cienciaObrigatoria,
          atendimento: m.atendimento,
          vigenciaInicio: m.vigenciaInicio ? `${m.vigenciaInicio.slice(0, 16)}:00.000` : null,
          vigenciaFim: m.vigenciaFim ? `${m.vigenciaFim.slice(0, 16)}:00.000` : null,
          em: agoraLocal(),
          idempotencia: m.idempotencia,
          encerradoEm: null,
          encerradoPor: null,
          motivoEncerramento: null,
          eventos: [],
        });
        for (const d of m.destinatarios)
          s.dests.push({ mensagem: id, login: d.login, via: d.via, lidaEm: null, cienciaEm: null });
        return { id, repetida: false };
      },
      marcarLida: async ({ login, id }) => {
        const d = s.dests.find((x) => x.login === login && x.mensagem === id);
        if (!d || d.lidaEm) return false;
        d.lidaEm = agoraLocal();
        return true;
      },
      registrarCiencia: async ({ login, id }) => {
        const d = s.dests.find((x) => x.login === login && x.mensagem === id);
        if (!d) throw recusa('nao-destinatario', 'Esta mensagem não é para você.');
        if (d.cienciaEm) return false;
        if (s.mensagens.find((x) => x.id === id)?.encerradoEm)
          throw recusa('comunicado-encerrado', 'Este comunicado foi encerrado e não pede mais ciência.');
        d.lidaEm ??= agoraLocal();
        d.cienciaEm = agoraLocal();
        return true;
      },
      gravarAviso: async (a) => {
        if (
          s.avisos.some(
            (x) => x.login === a.login && x.evento === a.evento && x.objetoChave === a.objetoChave,
          )
        )
          return null;
        const id = ++s.seq;
        s.avisos.push({
          id,
          login: a.login,
          tipo: a.tipo,
          gravidade: a.gravidade,
          modulo: a.modulo,
          evento: a.evento,
          titulo: a.titulo,
          link: a.link,
          estado: 'novo',
          criadoEm: agoraLocal(),
          objetoTabela: a.objetoTabela,
          objetoChave: a.objetoChave,
        });
        return id;
      },
      resolverAvisosDoObjeto: async ({ login, tabela, id }) => {
        let n = 0;
        for (const a of s.avisos)
          if (a.login === login && a.objetoTabela === tabela && a.objetoChave === String(id) && a.estado !== 'resolvido') {
            Object.assign(a, { estado: 'resolvido' });
            n++;
          }
        return n;
      },
      mudarEstadoAviso: async ({ login, id, estado }) => {
        const a = s.avisos.find((x) => x.login === login && x.id === id);
        if (!a) throw recusa('aviso-inexistente', 'Aviso não encontrado.');
        if (a.estado === 'resolvido' || a.estado === estado) return false;
        Object.assign(a, { estado });
        return true;
      },
      // W0-09: as mesmas recusas das gravações do banco (acesso/gravacao/comunicacao-sgh.ts).
      corrigirComunicado: async (r) => {
        const m = comunicadoParaMudar(s, r.id);
        const ds = s.dests.filter((d) => d.mensagem === r.id);
        const lidas = ds.filter((d) => d.lidaEm).length;
        const ciencias = ds.filter((d) => d.cienciaEm).length;
        if (lidas > 0 || ciencias > 0)
          throw recusa(
            'comunicado-ja-lido',
            `O texto já foi lido por ${lidas} destinatário(s), ${ciencias} com ciência, e não se edita. ` +
              'Para corrigir, encerre o comunicado com o motivo e publique outro.',
          );
        m.eventos.push(evento('correcao', descricaoVersaoAnterior(m.assunto, m.texto), r));
        m.assunto = r.assunto;
        m.texto = r.texto;
      },
      encurtarVigencia: async (r) => {
        const m = comunicadoParaMudar(s, r.id);
        const fim = `${r.vigenciaFim.slice(0, 16)}:00.000`;
        if (fim >= (m.vigenciaFim ?? ''))
          throw recusa(
            'vigencia-invalida',
            'A vigência só pode ser encurtada: o fim novo tem de ser antes do fim atual.',
            { campos: ['vigenciaFim'] },
          );
        if (fim <= (m.vigenciaInicio ?? ''))
          throw recusa('vigencia-invalida', 'O fim novo tem de ser depois do início da vigência.', {
            campos: ['vigenciaFim'],
          });
        if (fim <= agoraLocal())
          throw recusa(
            'vigencia-invalida',
            'O fim novo já passou: para tirar o comunicado do ar agora, encerre-o com o motivo.',
            { campos: ['vigenciaFim'] },
          );
        m.eventos.push(evento('vigencia', (m.vigenciaFim ?? '').slice(0, 19), r));
        m.vigenciaFim = fim;
      },
      encerrarComunicado: async (r) => {
        const m = comunicadoParaMudar(s, r.id);
        m.encerradoEm = agoraLocal();
        m.encerradoPor = r.por;
        m.motivoEncerramento = r.motivo;
        m.eventos.push(evento('encerramento', null, r));
      },
    };
  }
}

function comunicadoParaMudar(s: { mensagens: MensagemMem[] }, id: number): MensagemMem {
  const m = s.mensagens.find((x) => x.id === id && x.tipo === 'comunicado');
  if (!m)
    throw new ErroOperacao(
      404,
      'nao-encontrado',
      'Não encontrado',
      'Comunicado não encontrado neste estabelecimento.',
    );
  if (m.encerradoEm)
    throw recusa('comunicado-encerrado', 'Este comunicado já foi encerrado: publique outro.');
  return m;
}

function evento(
  e: 'correcao' | 'vigencia' | 'encerramento',
  antes: string | null,
  r: { motivo: string; por: string },
): MensagemMem['eventos'][number] {
  return { evento: e, antes, motivo: r.motivo, por: r.por, em: agoraLocal() };
}
