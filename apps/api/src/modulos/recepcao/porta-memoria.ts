// Porta da recepção EM MEMÓRIA (M19): a sessão sintética de dev/ci (E2E) lê e grava recepções, geradores, senhas,
// guichês, eventos e chegadas SINTÉTICOS, sem tocar a cópia. As gravações aplicam o mesmo Zod das receitas
// (operacao(op).entrada) e as mesmas regras (o contador do dia por gerador, a máquina de estados sobre as letras, a
// ordem da fila, o guichê de uma pessoa, o encaminhamento só aos locais permitidos, as recusas com os mesmos códigos).
// O relógio é o do estabelecimento (America/Sao_Paulo). A "chamada pelo outro sistema" do E2E chega pelo arquivo
// RECEPCAO_SINTETICA_POR_FORA (só dev/ci), aplicado na leitura do canal "senhas" do vigia. Nenhum nome aqui é de
// pessoa real (marca "SINTETICO").
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  CONFIG_FILA_PADRAO,
  decidirEvento,
  eventoSenha,
  MOTIVO_LIBERACAO_DIVERSOS,
  ordenarFila,
  prioritariasSeguidas,
  textoDoMotivoSuspensao,
  textoSenha,
} from '@sgh/contratos';
import {
  type AgendadoLidoLegado,
  type ContextoOperacao,
  type DispositivoLidoLegado,
  ErroOperacao,
  type FonteCatalogo,
  type GuicheEmUsoLegado,
  type IndicadoresRecepcaoLegado,
  type LeituraCanal,
  type LiberacaoConsultada,
  type MarcaVigia,
  operacao,
  type PacienteDaSenha,
  type PainelTvLegado,
  type RecepcaoLidaLegado,
  recusa,
  type ResultadoOperacao,
  type SenhaLidaLegado,
} from '@sgh/legado';
import type { ContextoRecepcao, GravadorSghRecepcao, PortaRecepcao } from './porta.js';
import { TermosMemoria } from './termos-memoria.js';

/** Foto sintética (silhueta em SVG): nenhuma imagem de paciente real no banco em memória. */
const FOTO_SINTETICA =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#d9dee5"/>' +
      '<circle cx="24" cy="18" r="9" fill="#8a96a6"/><path d="M8 46c2-10 9-15 16-15s14 5 16 15z" fill="#8a96a6"/></svg>',
  ).toString('base64');
const M = 'SINTETICO';

/** Relógio civil do estabelecimento (o banco do legado roda na hora local). */
export function relogioDoEstabelecimento(agora = new Date()): { hoje: string; agora: string } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  const hoje = `${v('year')}-${v('month')}-${v('day')}`;
  return { hoje, agora: `${hoje}T${v('hour')}:${v('minute')}:${v('second')}` };
}

interface SenhaM {
  id: number;
  numero: number;
  gerador: number;
  data: string;
  prioridade: string;
  situacao: string;
  guiche: number;
  usuario: string;
  motivo: string;
  emitidaEm: string;
  atendida: boolean;
  agendamento: { tipo: 'consulta' | 'exame'; marcacao: number } | null;
  // extensão do novo
  origem: string | null;
  grupo: number | null;
  chamadas: number;
  chamadaEm: string | null;
  primeiraChamadaEm: string | null;
  concluidaEm: string | null;
  localChamada: number | null;
  /** O guichê da primeira chamada (os tempos por guichê). */
  guichePrimeira: number | null;
  naoLocalizado: number;
}
interface FluxoM {
  id: number;
  senha: number;
  local: number;
  acao: string;
  usuario: string;
  em: string;
}
interface EventoM {
  senha: number;
  evento: string;
  guiche: number | null;
  local: number | null;
}
interface DispositivoM extends DispositivoLidoLegado {
  resumo: string;
}

type Mut<T> = { -readonly [K in keyof T]: T[K] };

/** A cópia sem o campo (o CPF do agendado e o resumo do token não saem da porta). */
function semCampo<T extends object, K extends keyof T>(x: T, campo: K): Omit<T, K> {
  const r = { ...x };
  delete r[campo];
  return r;
}

interface Estado {
  recepcoes: RecepcaoLidaLegado[];
  guiches: GuicheEmUsoLegado[];
  senhas: SenhaM[];
  fluxo: FluxoM[];
  eventos: EventoM[];
  contador: Map<string, number>;
  agendados: (Mut<AgendadoLidoLegado> & { cpf: string })[];
  dispositivos: DispositivoM[];
  seq: number;
  idem: Map<string, { hash: string; resultado: ResultadoOperacao }>;
  aplicadosPorFora: Set<string>;
}

/** Recepções, locais e geradores sintéticos (os mesmos identificadores de estrutura da cópia, nomes de produto). */
function estrutura(): RecepcaoLidaLegado[] {
  const g = (
    id: number,
    recepcao: number,
    letra: string,
    nome: string,
    tipo: string,
    prioritaria = false,
    ativo = true,
  ) => ({
    id,
    recepcao,
    letra,
    nome,
    tipo,
    ativo,
    prioritaria,
    limiteDia: 0,
    ordem: 'prioridade',
    intercalar: 2,
    tempoAlvoMinutos: 20,
    rotuloTotem: null,
    noTotem: true,
  });
  return [
    {
      id: 2,
      descricao: `AMBULATORIO ${M}`,
      locais: [
        { id: 2, recepcao: 2, cod: 2, descricao: 'RECEPCAO DO AMBULATORIO', ativo: true, encaminha: [] },
        { id: 3, recepcao: 2, cod: 3, descricao: 'CONSULTORIO 01', ativo: true, encaminha: [] },
        { id: 12, recepcao: 2, cod: 12, descricao: 'CONSULTORIO 02', ativo: true, encaminha: [13] },
        { id: 13, recepcao: 2, cod: 13, descricao: 'OBSERVACAO', ativo: true, encaminha: [12] },
      ],
      geradores: [
        g(1, 2, 'BL', 'AMBULATORIO', '0'),
        g(23, 2, 'EX', 'EXAMES', '5'),
        g(24, 2, 'MC', 'MARCACAO DE CONSULTA', '5'),
        g(29, 2, 'CP', 'CONSULTA AMBULATORIAL PRIORIDADE', '5', true),
        g(7, 2, 'PR', 'AMBULATORIO PRIORIDADE ANTIGO', '0', false, false),
      ],
      guiches: [1, 2, 3, 4, 5, 6],
    },
    {
      id: 10,
      descricao: `ATENDIMENTO ${M}`,
      locais: [{ id: 24, recepcao: 10, cod: 24, descricao: 'ATENDIMENTO', ativo: true, encaminha: [] }],
      geradores: [g(27, 10, 'HEX', 'EXAMES', '5', true)],
      guiches: [1, 2],
    },
  ];
}

export class PortaRecepcaoMemoria implements PortaRecepcao {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();
  /** W1-04: os termos de consentimento sintéticos (por estabelecimento). */
  readonly termos = new TermosMemoria();

  constructor(
    private readonly catalogo: FonteCatalogo,
    private readonly opcoes: { readonly agora?: () => Date; readonly arquivoPorFora?: string | null } = {},
  ) {}

  private relogioAtual() {
    return relogioDoEstabelecimento(this.opcoes.agora?.() ?? new Date());
  }

  private e(c: ContextoRecepcao): Estado {
    // Por estabelecimento (o totem e as TVs não têm sessão: chegam só com o estabelecimento do dispositivo).
    const k = c.hospital;
    let s = this.estados.get(k);
    if (!s) {
      s = this.semente();
      this.estados.set(k, s);
    }
    return s;
  }

  /** O dia sintético de partida: três senhas aguardando, uma em atendimento no consultório e os agendados. */
  private semente(): Estado {
    const r = this.relogioAtual();
    const s: Estado = {
      recepcoes: estrutura(),
      guiches: [{ recepcao: 2, local: 2, guiche: 1, usuario: 'GUICHE.OUTRO.SISTEMA' }],
      senhas: [],
      fluxo: [],
      eventos: [],
      contador: new Map(),
      agendados: [
        {
          tipo: 'consulta',
          marcacao: 7001,
          hora: '08:00',
          agenda: 'CONSULTA - CARDIOLOGIA',
          paciente: `ANA ${M} DE SOUZA`,
          nomeSocial: null,
          prontuario: 900001,
          senha: null,
          cpf: '11144477735',
        },
        {
          tipo: 'consulta',
          marcacao: 7002,
          hora: '08:30',
          agenda: 'CONSULTA - CLINICA MEDICA',
          paciente: `BRUNO ${M} LIMA`,
          nomeSocial: 'BRUNA LIMA',
          prontuario: 900002,
          senha: null,
          cpf: '22255588846',
        },
        {
          tipo: 'exame',
          marcacao: 8001,
          hora: '09:00',
          agenda: 'ULTRASSONOGRAFIA',
          paciente: `CARLA ${M} ROCHA`,
          nomeSocial: null,
          prontuario: 900003,
          senha: null,
          cpf: '33366699957',
        },
      ],
      dispositivos: [],
      seq: 100,
      idem: new Map(),
      aplicadosPorFora: new Set(),
    };
    const minutos = (m: number) => {
      const d = new Date(`${r.agora}Z`);
      d.setUTCMinutes(d.getUTCMinutes() - m);
      return d.toISOString().slice(0, 19);
    };
    for (const [gerador, prio, atras] of [
      [23, '2', 25],
      [24, '2', 18],
      [23, '2', 9],
    ] as const)
      this.novaSenha(s, gerador, prio, 'TOTEM.SINTETICO', minutos(atras), 'totem', null);
    const emAtendimento = this.novaSenha(s, 1, '2', 'TOTEM.SINTETICO', minutos(40), 'totem', null);
    emAtendimento.situacao = 'A';
    emAtendimento.atendida = true;
    emAtendimento.guiche = 2;
    s.fluxo.push({
      id: ++s.seq,
      senha: emAtendimento.id,
      local: 12,
      acao: 'A',
      usuario: 'GUICHE.OUTRO.SISTEMA',
      em: minutos(30),
    });
    return s;
  }

  private novaSenha(
    s: Estado,
    gerador: number,
    prioridade: string,
    usuario: string,
    em: string,
    origem: string | null,
    grupo: number | null,
  ): SenhaM {
    const hoje = em.slice(0, 10);
    const k = `${hoje}:${gerador}`;
    const numero = (s.contador.get(k) ?? 0) + 1;
    s.contador.set(k, numero);
    const x: SenhaM = {
      id: ++s.seq,
      numero,
      gerador,
      data: hoje,
      prioridade,
      situacao: 'G',
      guiche: 0,
      usuario,
      motivo: '',
      emitidaEm: em,
      atendida: false,
      agendamento: null,
      origem,
      grupo,
      chamadas: 0,
      chamadaEm: null,
      primeiraChamadaEm: null,
      concluidaEm: null,
      localChamada: null,
      guichePrimeira: null,
      naoLocalizado: 0,
    };
    s.senhas.push(x);
    return x;
  }

  private gerador(s: Estado, id: number) {
    for (const r of s.recepcoes) for (const g of r.geradores) if (g.id === id) return g;
    return null;
  }

  private ler(s: Estado, x: SenhaM): SenhaLidaLegado {
    const g = this.gerador(s, x.gerador);
    const cs = s.fluxo.filter((f) => f.senha === x.id && f.acao === 'C');
    const todos = s.fluxo.filter((f) => f.senha === x.id);
    return {
      id: x.id,
      numero: x.numero,
      texto: textoSenha(g?.letra ?? '', x.numero),
      gerador: x.gerador,
      recepcao: g?.recepcao ?? 0,
      servico: g?.nome ?? '',
      tipoGerador: g?.tipo ?? '5',
      prioridade: x.prioridade,
      grupo: x.grupo,
      situacao: x.situacao,
      guiche: x.guiche,
      usuario: x.usuario,
      emitidaEm: x.emitidaEm,
      origem: x.origem,
      chamadas: x.chamadas,
      chamadaEm: x.chamadaEm,
      primeiraChamadaEm: x.primeiraChamadaEm,
      concluidaEm: x.concluidaEm,
      localChamada: x.localChamada,
      atendida: x.atendida,
      agendamento: x.agendamento !== null,
      chamadasNoFluxo: cs.length,
      ultimoLocalChamada: cs.at(-1)?.local ?? null,
      ultimoLocal: todos.at(-1)?.local ?? null,
    };
  }

  // ── "Por fora": o outro sistema chama (E2E) ─────────────────────────────────────────────────────

  private aplicarPorFora(c: ContextoRecepcao): string {
    const arq = this.opcoes.arquivoPorFora;
    if (!arq || !existsSync(arq)) return '';
    try {
      const bruto = readFileSync(arq, 'utf8');
      const j = JSON.parse(bruto) as { chamadas?: { id: string; guiche: number; recepcao?: number }[] };
      const s = this.e(c);
      for (const ch of j.chamadas ?? []) {
        if (s.aplicadosPorFora.has(ch.id)) continue;
        s.aplicadosPorFora.add(ch.id);
        const r = ch.recepcao ?? 2;
        // Só a senha de hoje (a fila só mostra as do dia): logo depois da meia-noite, a semente mais antiga é de ontem.
        const hoje = this.relogioAtual().hoje;
        const candidata = s.senhas
          .filter(
            (x) =>
              x.data === hoje &&
              x.situacao === 'G' &&
              x.guiche === 0 &&
              !x.atendida &&
              this.gerador(s, x.gerador)?.recepcao === r,
          )
          .sort((a, b) => a.emitidaEm.localeCompare(b.emitidaEm))[0];
        if (candidata) {
          candidata.guiche = ch.guiche;
          candidata.usuario = 'GUICHE.OUTRO.SISTEMA';
        }
      }
      return bruto;
    } catch {
      return '';
    }
  }

  async canalSenhas(c: ContextoRecepcao, marca: MarcaVigia): Promise<LeituraCanal> {
    const fora = this.aplicarPorFora(c);
    const s = this.e(c);
    const selo = createHash('sha256')
      .update(
        `${fora}|${s.senhas.map((x) => `${x.id}:${x.situacao}:${x.guiche}`).join(',')}|${s.fluxo.length}`,
      )
      .digest('hex')
      .slice(0, 16);
    return { selo, marca: { maiorId: marca.maiorId || 1, maiorId2: 0, janela: 1 }, consultas: 1 };
  }

  // ── Gravações ───────────────────────────────────────────────────────────────────────────────────

  async podeGravar(_c: ContextoRecepcao, op: string): Promise<LiberacaoConsultada> {
    const est = this.catalogo.estado(op, _c.hospital);
    if (est === null || est === 'bloqueada')
      return { pode: false, codigo: 'operacao-bloqueada', motivo: 'Operação bloqueada no catálogo.' };
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(c: ContextoRecepcao, op: string, entradaBruta: unknown, ctx: ContextoOperacao) {
    const o = operacao(op);
    const analise = o.entrada.safeParse(entradaBruta);
    if (!analise.success)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(analise.error.issues.map((i) => i.path.join('.') || '(entrada)'))],
      });
    const s = this.e(c);
    const chave = `${op}:${ctx.idempotencyKey}`;
    const hash = JSON.stringify(analise.data);
    const anterior = s.idem.get(chave);
    if (anterior) {
      if (anterior.hash !== hash)
        throw new ErroOperacao(
          422,
          'idempotencia-divergente',
          'Pedido repetido diferente',
          'A mesma chave de pedido veio com outro conteúdo.',
        );
      return { resultado: anterior.resultado, repetida: true, trilha: null };
    }
    const resultado = this.aplicar(s, op, analise.data as Record<string, any>, ctx.usuarioLegado); // eslint-disable-line @typescript-eslint/no-explicit-any
    s.idem.set(chave, { hash, resultado });
    return { resultado, repetida: false, trilha: null };
  }

  /** Como o legado: o número do guichê é único na recepção (qualquer local). */
  private exigirMeuGuiche(s: Estado, g: { recepcao: number; local: number; guiche: number }, login: string) {
    const ocupacao = s.guiches.filter((y) => y.recepcao === g.recepcao && y.guiche === g.guiche);
    if (ocupacao.some((y) => y.usuario !== login))
      throw recusa('guiche-de-outro', 'Este guichê está aberto por outra pessoa (aqui ou no outro sistema).');
    const meu = ocupacao.find((y) => y.usuario === login);
    if (!meu) throw recusa('guiche-fechado', 'Abra o guichê antes de chamar ou conduzir senhas.');
    if (meu.local !== g.local)
      throw recusa('guiche-de-outro-local', 'Este guichê está aberto em outro local da recepção.');
  }

  private exigirLocal(s: Estado, local: number, recepcao: number) {
    const r = s.recepcoes.find((x) => x.id === recepcao);
    const l = s.recepcoes.flatMap((x) => x.locais).find((x) => x.id === local);
    if (!l) throw recusa('local-inexistente', 'O local de atendimento não existe.');
    if (!r || l.recepcao !== recepcao)
      throw recusa('local-de-outra-recepcao', 'O local escolhido não pertence a esta recepção.');
    if (!l.ativo) throw recusa('local-inativo', 'O local de atendimento está inativo.');
  }

  private senhaM(s: Estado, id: number): SenhaM {
    const x = s.senhas.find((y) => y.id === id);
    if (!x)
      throw new ErroOperacao(404, 'registro-inexistente', 'Senha não encontrada', 'A senha não existe mais.');
    return x;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private aplicar(s: Estado, op: string, e: Record<string, any>, login: string): ResultadoOperacao {
    const r = this.relogioAtual();
    switch (op) {
      case 'recepcao.emitirSenha': {
        const g = this.gerador(s, e['gerador']);
        if (!g)
          throw new ErroOperacao(
            404,
            'registro-inexistente',
            'Serviço não encontrado',
            'O gerador de senha não existe mais.',
          );
        if (!g.ativo) throw recusa('gerador-inativo', 'O serviço está inativo: escolha outro.');
        if (g.tipo !== '0' && g.tipo !== '5')
          throw recusa('gerador-nao-usado', 'Este tipo de serviço não é usado nas filas do estabelecimento.');
        if (e['prioridade'] !== '2' && !g.prioritaria)
          throw recusa(
            'prioridade-nao-oferecida',
            'Este serviço não emite senha prioritária: escolha o serviço de prioridade da recepção.',
          );
        const proximo = (s.contador.get(`${r.hoje}:${g.id}`) ?? 0) + 1;
        if (g.limiteDia > 0 && proximo > g.limiteDia && !e['forcarLimite'])
          throw recusa('limite-do-dia', `O serviço chegou ao limite de ${g.limiteDia} senhas do dia.`);
        const x = this.novaSenha(s, g.id, e['prioridade'], login, r.agora, e['origem'], e['grupo'] ?? null);
        s.eventos.push({ senha: x.id, evento: 'emitir', guiche: null, local: null });
        return { senha: x.id, numero: x.numero, gerador: g.id };
      }
      case 'recepcao.chamarSenha': {
        this.exigirLocal(s, e['local'], e['recepcao']);
        this.exigirMeuGuiche(s, e as { recepcao: number; local: number; guiche: number }, login);
        for (const id of e['geradores'] as number[])
          if (this.gerador(s, id)?.recepcao !== e['recepcao'])
            throw recusa('gerador-de-outra-recepcao', 'Um dos serviços escolhidos não é desta recepção.');
        const livre = (x: SenhaM) =>
          x.data === r.hoje &&
          x.situacao === 'G' &&
          x.guiche === 0 &&
          !x.atendida &&
          (e['geradores'] as number[]).includes(x.gerador);
        let alvo: SenhaM | undefined;
        if (e['senha']) {
          const x = this.senhaM(s, e['senha']);
          if (x.atendida) throw recusa('senha-em-atendimento', 'A senha já tem atendimento aberto.');
          if (x.data !== r.hoje) throw recusa('senha-de-outro-dia', 'A senha não é de hoje.');
          if (!livre(x)) throw recusa('senha-ja-chamada', 'A senha já foi chamada, suspensa ou concluída.');
          alvo = x;
        } else {
          const recentes = s.eventos
            .filter((v) => v.evento === 'chamar' && v.guiche === e['guiche'] && v.local === e['local'])
            .reverse()
            .map((v) => ({ prioridade: s.senhas.find((x) => x.id === v.senha)?.prioridade ?? '2' }));
          const g = this.gerador(s, (e['geradores'] as number[])[0] as number);
          const cfg = g
            ? { ordem: g.ordem as typeof CONFIG_FILA_PADRAO.ordem, intercalar: g.intercalar }
            : CONFIG_FILA_PADRAO;
          const fila = ordenarFila(
            s.senhas.filter(livre).map((x) => ({ ...x, emitidaEm: x.emitidaEm })),
            cfg,
            prioritariasSeguidas(recentes),
          );
          alvo = fila[0] ? this.senhaM(s, fila[0].id) : undefined;
          if (!alvo) throw recusa('fila-vazia', 'Não há senha aguardando nos serviços deste guichê.');
        }
        alvo.guiche = e['guiche'];
        alvo.usuario = login;
        alvo.chamadas++;
        alvo.chamadaEm = r.agora;
        alvo.primeiraChamadaEm ??= r.agora;
        alvo.guichePrimeira ??= e['guiche'];
        alvo.localChamada = e['local'];
        s.eventos.push({ senha: alvo.id, evento: 'chamar', guiche: e['guiche'], local: e['local'] });
        return { senha: alvo.id, numero: alvo.numero, guiche: e['guiche'] };
      }
      case 'recepcao.registrarEventoSenha': {
        if (e['evento'] === 'chamarNoLocal' || e['evento'] === 'liberarDoLocal')
          throw recusa(
            'evento-do-fluxo-do-local',
            'Este evento é registrado pela tela do fluxo do paciente por local de atendimento.',
          );
        const x = this.senhaM(s, e['senha']);
        if (x.data !== r.hoje) throw recusa('senha-de-outro-dia', 'A senha não é de hoje.');
        const g = this.gerador(s, x.gerador);
        const noGuiche = ['rechamar', 'retomar', 'liberar', 'suspender', 'naoLocalizado'].includes(
          e['evento'],
        );
        if (noGuiche)
          this.exigirMeuGuiche(
            s,
            { recepcao: g?.recepcao ?? 0, local: e['local'], guiche: e['guiche'] },
            login,
          );
        const d = decidirEvento(
          { situacao: x.situacao, guiche: x.guiche, atendida: x.atendida, tipoGerador: g?.tipo ?? '5' },
          e['evento'],
          noGuiche ? e['guiche'] : 0,
        );
        if (!d.ok) throw recusa(d.codigo, d.motivo);
        if (e['evento'] === 'encaminhar') {
          const l = s.recepcoes.flatMap((y) => y.locais).find((y) => y.id === e['local']);
          if (!l?.encaminha.includes(e['destino']))
            throw recusa('destino-nao-permitido', 'Este local não encaminha para o destino escolhido.');
        }
        const ef = d.efeito;
        if (ef.situacao) x.situacao = ef.situacao;
        if (ef.guiche) x.guiche = ef.guiche === 'zero' ? 0 : e['guiche'];
        if (ef.motivo)
          x.motivo =
            ef.motivo === 'diversos'
              ? MOTIVO_LIBERACAO_DIVERSOS
              : ef.motivo === 'nao-localizado'
                ? textoDoMotivoSuspensao('NAO-LOCALIZADO')
                : textoDoMotivoSuspensao(e['motivo'] ?? 'OUTRO', e['complemento']);
        if (ef.usuario) x.usuario = login;
        const local = e['evento'] === 'encaminhar' ? e['destino'] : e['local'];
        const f: FluxoM = {
          id: ++s.seq,
          senha: x.id,
          local,
          acao: ef.letraFluxo ?? eventoSenha(e['evento'])?.letra ?? 'C',
          usuario: login,
          em: r.agora,
        };
        s.fluxo.push(f);
        if (e['evento'] === 'rechamar' || e['evento'] === 'retomar') {
          x.chamadas++;
          x.chamadaEm = r.agora;
          x.localChamada = e['local'];
        }
        if (e['evento'] === 'liberar') x.concluidaEm = r.agora;
        if (e['evento'] === 'naoLocalizado' || e['evento'] === 'naoLocalizadoNoLocal') x.naoLocalizado++;
        s.eventos.push({ senha: x.id, evento: e['evento'], guiche: e['guiche'] || null, local: e['local'] });
        return { senha: x.id, fluxo: f.id };
      }
      case 'recepcao.registrarChegada': {
        const x = this.senhaM(s, e['senha']);
        if (x.data !== r.hoje) throw recusa('senha-de-outro-dia', 'A senha não é de hoje.');
        if (x.atendida) throw recusa('senha-em-atendimento', 'A senha já tem atendimento aberto.');
        if (x.agendamento) throw recusa('senha-ja-ligada', 'A senha já está ligada a um agendamento.');
        if (x.situacao === 'L') throw recusa('senha-concluida', 'A senha já foi concluída.');
        if (this.gerador(s, x.gerador)?.tipo !== '0')
          throw recusa(
            'senha-de-servico-diverso',
            'A chegada do agendado é registrada numa senha de recepção, não de serviços diversos: emita a senha da recepção.',
          );
        const a = s.agendados.find((y) => y.tipo === e['tipo'] && y.marcacao === e['marcacao']);
        if (!a) throw recusa('marcacao-inexistente', 'O agendamento não existe mais.');
        if (a.senha !== null)
          throw recusa('marcacao-ja-chegou', 'A chegada deste agendamento já foi registrada.');
        a.senha = x.id;
        x.agendamento = { tipo: e['tipo'], marcacao: e['marcacao'] };
        s.eventos.push({ senha: x.id, evento: `chegada-${e['tipo']}`, guiche: null, local: null });
        return { senha: x.id, marcacao: e['marcacao'] };
      }
      case 'recepcao.desfazerChegada': {
        const x = this.senhaM(s, e['senha']);
        if (x.atendida)
          throw recusa(
            'chegada-com-ficha',
            'A chegada já tem ficha de atendimento: exclua a ficha no Atendimento (a marcação volta ao estado anterior) e então desfaça a chegada.',
          );
        if (!x.agendamento) throw recusa('sem-chegada', 'Esta senha não tem chegada registrada.');
        const ag = x.agendamento;
        const a = s.agendados.find((y) => y.tipo === ag.tipo && y.marcacao === ag.marcacao);
        if (a) a.senha = null;
        x.agendamento = null;
        s.eventos.push({ senha: x.id, evento: `chegada-desfeita-${ag.tipo}`, guiche: null, local: null });
        return { senha: x.id, marcacao: ag.marcacao, tipo: ag.tipo };
      }
      case 'recepcao.abrirGuiche': {
        this.exigirLocal(s, e['local'], e['recepcao']);
        if (!s.recepcoes.find((y) => y.id === e['recepcao'])?.guiches.includes(e['guiche']))
          throw recusa(
            'guiche-nao-cadastrado',
            'Este número de guichê não está cadastrado nesta recepção: escolha um dos guichês da recepção.',
          );
        const ocupacao = s.guiches.filter((y) => y.recepcao === e['recepcao'] && y.guiche === e['guiche']);
        if (ocupacao.some((y) => y.usuario !== login))
          throw recusa(
            'guiche-ocupado',
            'Este guichê está em uso por outra pessoa (aqui ou no outro sistema). Escolha outro número ou peça a liberação ao supervisor.',
          );
        if (ocupacao.some((y) => y.local === e['local']))
          throw recusa('guiche-ja-aberto', 'Você já está neste guichê.');
        s.guiches = s.guiches.filter((y) => y.usuario !== login);
        s.guiches.push({ recepcao: e['recepcao'], local: e['local'], guiche: e['guiche'], usuario: login });
        return { guiche: e['guiche'], local: e['local'], recepcao: e['recepcao'] };
      }
      case 'recepcao.fecharGuiche': {
        const atual = s.guiches.find(
          (y) => y.recepcao === e['recepcao'] && y.local === e['local'] && y.guiche === e['guiche'],
        );
        if (!atual) throw recusa('guiche-fechado', 'O guichê já está fechado.');
        if (atual.usuario !== login && !e['justificativa'])
          throw recusa(
            'guiche-de-outro',
            'O guichê é de outra pessoa: a liberação pelo supervisor pede a justificativa.',
          );
        s.guiches = s.guiches.filter((y) => y !== atual);
        return { guiche: e['guiche'], local: e['local'], recepcao: e['recepcao'] };
      }
      default:
        throw recusa('operacao-especificada', `Operação ${op} sem simulação na sessão sintética.`);
    }
  }

  async gravarSgh<T>(
    c: ContextoRecepcao,
    _trilha: unknown,
    fn: (g: GravadorSghRecepcao) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const r = this.relogioAtual();
    return fn({
      ...this.termos.gravador(c.hospital, r.agora, (p) => s.agendados.some((a) => a.prontuario === p)),
      gravarFilaCfg: async (x) => {
        const g = this.gerador(s, x.gerador);
        if (!g) throw recusa('registro-inexistente', 'O gerador de senha não existe mais.');
        const m = g as Mut<typeof g>;
        m.ordem = x.ordem;
        m.intercalar = x.intercalar;
        m.tempoAlvoMinutos = x.tempoAlvoMinutos;
        m.rotuloTotem = x.rotuloTotem;
        m.noTotem = x.noTotem;
      },
      criarDispositivo: async (x) => {
        const token = randomBytes(32).toString('base64url');
        const id = ++s.seq;
        const validoAte = new Date(Date.parse(`${r.agora}Z`) + x.validadeDias * 86_400_000)
          .toISOString()
          .slice(0, 19);
        s.dispositivos.push({
          id,
          hospital: c.hospital,
          tipo: x.tipo,
          nome: x.nome,
          recepcao: x.recepcao,
          locais: [...x.locais],
          geradores: [...x.geradores],
          conteudo: x.conteudo,
          portalOrdem: x.portalOrdem,
          usuarioLegado: x.usuarioLegado,
          voz: x.voz,
          criadoEm: r.agora,
          criadoPor: x.usuario,
          validoAte,
          revogadoEm: null,
          ultimoUso: null,
          prefixo: token.slice(0, 8),
          valido: true,
          loginSubstituido: null,
          conferidoEm: null,
          conferidoPor: null,
          resumo: createHash('sha256').update(token).digest('hex'),
        });
        return { id, token };
      },
      renovarDispositivo: async (x) => {
        const d = s.dispositivos.find((y) => y.id === x.id && !y.revogadoEm);
        if (!d) throw recusa('dispositivo-revogado', 'O dispositivo não existe ou já foi revogado.');
        const token = randomBytes(32).toString('base64url');
        const m = d as Mut<DispositivoM>;
        m.resumo = createHash('sha256').update(token).digest('hex');
        m.prefixo = token.slice(0, 8);
        m.validoAte = new Date(Date.parse(`${r.agora}Z`) + x.validadeDias * 86_400_000)
          .toISOString()
          .slice(0, 19);
        return token;
      },
      alterarDispositivo: async (x) => {
        const d = s.dispositivos.find((y) => y.id === x.id && !y.revogadoEm);
        if (!d) throw recusa('dispositivo-revogado', 'O dispositivo não existe ou já foi revogado.');
        // Token (resumo, prefixo) e validade ficam como estão.
        const m = d as Mut<DispositivoM>;
        m.nome = x.nome;
        m.recepcao = x.recepcao;
        m.locais = [...x.locais];
        m.geradores = [...x.geradores];
        m.conteudo = x.conteudo;
        m.voz = x.voz;
      },
      revogarDispositivo: async (x) => {
        const d = s.dispositivos.find((y) => y.id === x.id && !y.revogadoEm);
        if (!d) throw recusa('dispositivo-revogado', 'O dispositivo não existe ou já foi revogado.');
        const m = d as Mut<DispositivoM>;
        m.revogadoEm = r.agora;
        m.valido = false;
      },
      conferirDispositivo: async (x) => {
        const login = x.loginSubstituido.trim();
        if (
          s.dispositivos.some(
            (y) =>
              y.id !== x.id &&
              !y.revogadoEm &&
              (y.loginSubstituido ?? '').toUpperCase() === login.toUpperCase(),
          )
        )
          throw recusa(
            'login-ja-substituido',
            'Este login já está ligado a outro aparelho válido: revogue aquele antes.',
          );
        const d = s.dispositivos.find((y) => y.id === x.id && !y.revogadoEm && y.validoAte > r.agora);
        if (!d)
          throw recusa(
            'dispositivo-revogado',
            'O dispositivo não existe, foi revogado ou está fora da validade.',
          );
        const m = d as Mut<DispositivoM>;
        m.loginSubstituido = login;
        m.conferidoEm = r.agora;
        m.conferidoPor = x.usuario;
      },
    });
  }

  async registrarChamadasDeFora(
    c: ContextoRecepcao,
    chamadas: readonly { senha: number; guiche: number; local: number | null }[],
  ): Promise<number> {
    const agora = this.relogioAtual().agora;
    let n = 0;
    for (const x of chamadas) {
      const s = this.e(c).senhas.find((y) => y.id === x.senha);
      if (!s || s.primeiraChamadaEm) continue;
      s.primeiraChamadaEm = agora;
      s.guichePrimeira = x.guiche;
      n++;
    }
    return n;
  }

  async marcarUsoDispositivo(c: ContextoRecepcao, id: number): Promise<void> {
    const d = this.e(c).dispositivos.find((y) => y.id === id);
    if (d) (d as Mut<DispositivoM>).ultimoUso = this.relogioAtual().agora;
  }

  // ── M20: o atendimento externo na sessão sintética (a abertura e o consultório mexem na mesma senha) ──────

  /** A senha como a abertura do atendimento a confere (situação, dia, prioridade, emissão). */
  senhaParaAtendimento(
    c: ContextoRecepcao,
    id: number,
  ): {
    id: number;
    texto: string;
    situacao: string;
    hoje: boolean;
    prioridade: string;
    emitidaEm: string;
    atendida: boolean;
    recepcao: number;
  } | null {
    const s = this.e(c);
    const x = s.senhas.find((y) => y.id === id);
    if (!x) return null;
    const g = this.gerador(s, x.gerador);
    return {
      id: x.id,
      texto: textoSenha(g?.letra ?? '', x.numero),
      situacao: x.situacao,
      hoje: x.data === this.relogioAtual().hoje,
      prioridade: x.prioridade,
      emitidaEm: x.emitidaEm,
      atendida: x.atendida,
      recepcao: g?.recepcao ?? 0,
    };
  }

  /** A abertura liga a senha ao atendimento: a senha em A e a letra A no local da recepção (como no legado). */
  atenderSenha(c: ContextoRecepcao, id: number, local: number, login: string): void {
    const s = this.e(c);
    const x = this.senhaM(s, id);
    if (x.atendida) throw recusa('senha-ja-atendida', 'A senha já tem atendimento aberto.');
    x.atendida = true;
    x.situacao = 'A';
    s.fluxo.push({
      id: ++s.seq,
      senha: x.id,
      local,
      acao: 'A',
      usuario: login,
      em: this.relogioAtual().agora,
    });
  }

  /** O consultório chama (C), atende (A) ou libera (L) a senha no local; a situação muda só em C e A. */
  eventoDoConsultorio(
    c: ContextoRecepcao,
    id: number,
    letra: 'C' | 'A' | 'L',
    local: number,
    login: string,
  ): void {
    const s = this.e(c);
    const x = this.senhaM(s, id);
    if (letra !== 'L') x.situacao = letra;
    if (letra === 'C') {
      x.chamadas++;
      x.chamadaEm = this.relogioAtual().agora;
      x.localChamada = local;
    }
    x.usuario = login;
    s.fluxo.push({
      id: ++s.seq,
      senha: x.id,
      local,
      acao: letra,
      usuario: login,
      em: this.relogioAtual().agora,
    });
  }

  /** A exclusão do atendimento desfaz a ligação e devolve a senha a S (o gatilho do legado faz o mesmo). */
  desfazerAtendimentoDaSenha(c: ContextoRecepcao, id: number): void {
    const s = this.e(c);
    const x = this.senhaM(s, id);
    const ultimo = [...s.fluxo].reverse().find((f) => f.senha === id);
    x.atendida = false;
    x.situacao = 'S';
    s.fluxo.push({
      id: ++s.seq,
      senha: x.id,
      local: ultimo?.local ?? 0,
      acao: 'S',
      usuario: 'SYSDBA',
      em: this.relogioAtual().agora,
    });
  }

  /** O último evento do fluxo da senha (local e letra), para a fila do consultório. */
  ultimoFluxo(c: ContextoRecepcao, id: number): { local: number; acao: string; chamadas: number } | null {
    const s = this.e(c);
    const fs = s.fluxo.filter((f) => f.senha === id);
    const u = fs.at(-1);
    return u ? { local: u.local, acao: u.acao, chamadas: fs.filter((f) => f.acao === 'C').length } : null;
  }

  // ── Leituras ────────────────────────────────────────────────────────────────────────────────────

  async relogio(): Promise<{ hoje: string; agora: string }> {
    return this.relogioAtual();
  }

  async recepcoes(c: ContextoRecepcao): Promise<RecepcaoLidaLegado[]> {
    return this.e(c).recepcoes;
  }

  async guichesEmUso(c: ContextoRecepcao): Promise<GuicheEmUsoLegado[]> {
    return [...this.e(c).guiches];
  }

  async senhasDoDia(
    c: ContextoRecepcao,
    f: { recepcao?: number | null; geradores?: readonly number[] },
  ): Promise<{ senhas: SenhaLidaLegado[]; cortada: boolean }> {
    const s = this.e(c);
    const hoje = this.relogioAtual().hoje;
    const senhas = s.senhas
      .filter((x) => x.data === hoje)
      .map((x) => this.ler(s, x))
      .filter(
        (x) =>
          (!f.recepcao || x.recepcao === f.recepcao) &&
          (!f.geradores?.length || f.geradores.includes(x.gerador)),
      )
      .sort((a, b) => a.emitidaEm.localeCompare(b.emitidaEm) || a.numero - b.numero);
    return { senhas, cortada: false };
  }

  async senha(c: ContextoRecepcao, id: number): Promise<SenhaLidaLegado | null> {
    const s = this.e(c);
    const x = s.senhas.find((y) => y.id === id);
    return x ? this.ler(s, x) : null;
  }

  async aFrente(c: ContextoRecepcao, id: number): Promise<number> {
    const s = this.e(c);
    const x = s.senhas.find((y) => y.id === id);
    if (!x) return 0;
    return s.senhas.filter(
      (y) =>
        y.id !== x.id &&
        y.gerador === x.gerador &&
        y.data === x.data &&
        y.situacao === 'G' &&
        y.guiche === 0 &&
        y.emitidaEm <= x.emitidaEm,
    ).length;
  }

  async agendados(
    c: ContextoRecepcao,
    f: {
      cpf?: string | null;
      marcacao?: { tipo: 'consulta' | 'exame'; id: number } | null;
      prontuario?: number | null;
      agenda?: string | null;
    },
  ): Promise<{ itens: AgendadoLidoLegado[]; cortada: boolean }> {
    const itens = this.e(c)
      .agendados.filter(
        (a) =>
          (!f.cpf || a.cpf === f.cpf) &&
          (!f.prontuario || a.prontuario === f.prontuario) &&
          (!f.agenda || a.agenda.toUpperCase().includes(f.agenda.toUpperCase())) &&
          (!f.marcacao || (a.tipo === f.marcacao.tipo && a.marcacao === f.marcacao.id)),
      )
      .map((a) => semCampo(a, 'cpf'));
    return { itens, cortada: false };
  }

  async pacientesDasSenhas(
    c: ContextoRecepcao,
    ids: readonly number[],
  ): Promise<Map<number, PacienteDaSenha>> {
    const r = new Map<number, PacienteDaSenha>();
    for (const a of this.e(c).agendados)
      if (a.senha !== null && ids.includes(a.senha))
        r.set(a.senha, { nome: a.paciente, nomeSocial: a.nomeSocial, prontuario: a.prontuario });
    return r;
  }

  /**
   * Prontuários marcados "sigiloso" (os testes marcam aqui; no legado vem do cadastro do paciente, W1-02). A semente
   * marca a CARLA sintética (exame 8001) para a tela do guichê mostrar a marca.
   */
  readonly prontuariosSigilosos = new Set<number>([900003]);

  async sigilosos(_c: ContextoRecepcao, prontuarios: readonly number[]): Promise<ReadonlySet<number>> {
    return new Set(prontuarios.filter((p) => this.prontuariosSigilosos.has(p)));
  }

  /** Fotos dos pacientes por prontuário (os testes põem aqui; no legado vêm do cadastro, W1-02). A semente dá à ANA
   * sintética (consulta 7001) uma imagem sintética, para a tela do guichê mostrar a foto. */
  readonly fotosDosPacientes = new Map<number, string>([[900001, FOTO_SINTETICA]]);

  async fotos(_c: ContextoRecepcao, prontuarios: readonly number[]): Promise<ReadonlyMap<number, string>> {
    const r = new Map<number, string>();
    for (const p of prontuarios) {
      const f = this.fotosDosPacientes.get(p);
      if (f) r.set(p, f);
    }
    return r;
  }

  async parametros(): Promise<Record<string, string | number | null>> {
    return {
      DIG_SEG: 'T',
      DIG_CRM: 'T',
      DIG_CDC: 'T',
      DIG_ATE: 'T',
      ['DIG_SENHA']: 'F',
      PAINEL: 'F',
      PAINELTCPIP: '',
    };
  }

  async paineisTv(): Promise<PainelTvLegado[]> {
    return [
      { config: 1, ordem: 3, nome: `PAINEL 2 ANDAR ${M}` },
      { config: 1, ordem: 10, nome: `HIGIENIZACAO ${M}` },
      { config: 1, ordem: 12, nome: `MAPA CIRURGICO ${M}` },
    ];
  }

  async usuariosTecnicos(): Promise<string[]> {
    // M43: os logins de TV sintéticos do grupo de painéis (o login substituído pelo aparelho, regra 4).
    return ['TOTEM.SINTETICO', 'SINT.PAINELTV1', 'SINT.PAINELTV2'];
  }

  async indicadores(
    c: ContextoRecepcao,
    de: string,
    ate: string,
    recepcao: number | null,
  ): Promise<IndicadoresRecepcaoLegado> {
    const s = this.e(c);
    const xs = s.senhas
      .filter((x) => x.data >= de && x.data <= ate)
      .filter((x) => !recepcao || this.gerador(s, x.gerador)?.recepcao === recepcao);
    const contar = <K extends string>(f: (x: SenhaM) => K) => {
      const m = new Map<K, number>();
      for (const x of xs) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
      return m;
    };
    const dias = [...new Set(xs.map((x) => x.data))].sort();
    return {
      porHora: [...contar((x) => x.emitidaEm.slice(11, 13)).entries()]
        .map(([h, n]) => ({ hora: Number(h), emitidas: n }))
        .sort((a, b) => a.hora - b.hora),
      porDia: dias.map((d) => {
        const ds = xs.filter((x) => x.data === d);
        return {
          data: d,
          emitidas: ds.length,
          liberadas: ds.filter((x) => x.situacao === 'L').length,
          suspensas: ds.filter((x) => x.situacao === 'S').length,
          atendidas: ds.filter((x) => x.situacao === 'A' || x.situacao === 'C').length,
        };
      }),
      porSituacao: [...contar((x) => x.situacao).entries()].map(([situacao, senhas]) => ({
        situacao,
        senhas,
      })),
      prioridade: [...contar((x) => x.prioridade).entries()].map(([prioridade, senhas]) => ({
        prioridade,
        senhas,
      })),
      porServico: [...contar((x) => String(x.gerador)).entries()].map(([g, senhas]) => ({
        gerador: Number(g),
        servico: this.gerador(s, Number(g))?.nome ?? '',
        senhas,
      })),
      tempos: xs.map((x) => ({
        prioridade: x.prioridade,
        emitidaEm: x.emitidaEm,
        chamadaEm: x.primeiraChamadaEm,
        concluidaEm: x.concluidaEm,
        recepcao: this.gerador(s, x.gerador)?.recepcao ?? 0,
        guiche: x.guichePrimeira,
      })),
      naoLocalizado: xs.reduce((a, x) => a + x.naoLocalizado, 0),
      total: xs.length,
    };
  }

  async dispositivos(c: ContextoRecepcao): Promise<DispositivoLidoLegado[]> {
    return this.e(c).dispositivos.map((d) => ({
      ...semCampo(d, 'resumo'),
      valido: !d.revogadoEm && d.validoAte > this.relogioAtual().agora,
    }));
  }

  async modelosTermo(c: ContextoRecepcao) {
    return this.termos.modelos(c.hospital);
  }

  async termosDoPaciente(c: ContextoRecepcao, prontuario: number) {
    return this.termos.assinaturas(c.hospital, prontuario);
  }

  /** Os signatários sintéticos (como no domínio do cadastro: 1 paciente, 2 representante legal). */
  async signatariosTermo() {
    return [
      { codigo: 1, rotulo: 'Paciente' },
      { codigo: 2, rotulo: 'Representante legal' },
    ];
  }

  async dispositivoDoToken(token: string): Promise<DispositivoLidoLegado | null> {
    const resumo = createHash('sha256').update(token).digest('hex');
    for (const s of this.estados.values()) {
      const d = s.dispositivos.find((y) => y.resumo === resumo);
      if (d) {
        return { ...semCampo(d, 'resumo'), valido: !d.revogadoEm && d.validoAte > this.relogioAtual().agora };
      }
    }
    return null;
  }
}
