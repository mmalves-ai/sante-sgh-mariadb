// Porta da farmácia em MEMÓRIA (M29): a sessão sintética de dev/ci (E2E). Unidade, internados, horários prescritos,
// itens, lotes, dispensações, doses, controle de entrega, avaliações, intervenções e controlados SINTÉTICOS (nomes
// claramente fictícios). As gravações aplicam o mesmo Zod das receitas (o Zod de operacoes.ts) e as mesmas regras do
// domínio (fila disputada, política, saldo e lote, controlado com prescritor, aceite, devolução até a dose, decisão,
// intervenção, dupla conferência, livro, SNGPC) e simulam o que os gatilhos fazem no banco (número do documento, saldo).
// A dispensação e a devolução da dose ficam DESLIGADAS no banco real (D-MOTOR-28): aqui a tela percorre o fluxo inteiro.
import { createHash } from 'node:crypto';
import {
  type ConfirmarEntregaEntrada,
  type DevolverDoseEntrada,
  type DispensarHorarioEntrada,
  type EstadoOperacao,
  type RegistrarPerdaControladoEntrada,
} from '@sgh/contratos';
import {
  codigoEtiquetaDose,
  conferirAceiteEntrega,
  conferirDecisaoAvaliacao,
  conferirDevolucaoDose,
  conferirDispensacaoAmbulatorial,
  conferirDuplaConferencia,
  conferirFechamentoLivro,
  conferirPerdaControlado,
  conferirPrescritorControlado,
  conferirRespostaIntervencao,
  etiquetasAceitas,
  guardaAte,
  listaDoItem,
  montarEnvioSngpc,
  type RecusaSuprimentos,
} from '@sgh/contratos/regras-suprimentos';
import { type ContextoOperacao, ErroOperacao } from '@sgh/nucleo';
import type { LiberacaoGravacao } from '../exames/public-api.js';
import type {
  GravarHorariosPadraoEntrada,
  GravarRegraIntegracaoEntrada,
  ParametrosIntegracaoEditaveis,
  RegraIntegracaoLida,
} from '@sgh/contratos';
import {
  chaveRegraIntegracao,
  conferirHorariosPadrao,
  conferirRegraIntegracao,
} from '@sgh/contratos/regras-suprimentos';
import { ENTRADAS_FARMACIA } from './operacoes.js';
import type { ContextoFarmacia, GravadorSghFarmacia, PortaFarmacia } from './porta.js';
import type {
  AvaliacaoRegistrada,
  DoseDaFila,
  DoseDispensada,
  HorarioDaFila,
  IntervencaoRegistrada,
} from './tipos.js';

/** Chave do estado em memória: o cliente e o estabelecimento da sessão. */
const chaveDe = (c: ContextoFarmacia) => `${c.cliente}:${c.estabelecimento ?? 0}`;
/** O autor exibido da gravação em memória: o login da sessão (o contexto da gravação o leva), senão o id. */
const autorDe = (ctx: ContextoOperacao & { readonly login?: string }) =>
  ctx.login ?? (ctx.usuario === null ? 'SINT.FARMA' : `USUARIO.${ctx.usuario}`);
const recusaOp = (codigo: string, mensagem: string, campos?: readonly string[]) =>
  new ErroOperacao(409, codigo, 'Operação recusada', mensagem, campos ? { campos } : {});
function recusar(r: RecusaSuprimentos | null | undefined): void {
  if (r) throw recusaOp(r.codigo, r.mensagem, r.campos);
}
const p2 = (n: number) => String(n).padStart(2, '0');
const minuto = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

/** Prescritor sintético (o login responde às intervenções). */
export const PRESCRITOR_SINTETICO = {
  login: 'SINT.MEDICO.FARM',
  vinculo: 77,
  conselho: 'CRM',
  registro: 99999,
  uf: 'RJ',
};
export const UNIDADE_SINTETICA = 'UTI-SINT';
export const LOCAL_FARMACIA_SINTETICO = 10;
export const CENTRO_SINTETICO = 300100;

interface ItemM {
  codigo: number;
  nome: string;
  tipo: 'medicamento' | 'material';
  portaria: string | null;
  antimicrobiano: boolean;
  altaVigilancia: boolean;
  rastreavel: boolean;
  barras: string | null;
  saldo: number;
  lotes: { lote: string; validade: string; saldo: number }[];
  dose: number;
  unidade: string;
  via: string;
  envioAvaliacao: number;
}

interface HorarioM {
  id: number;
  lancamento: number;
  prescricao: number;
  atendimento: number;
  cabecalho: number;
  item: number;
  previsto: Date;
  situacao: string;
  urgente: boolean;
  ocupado: boolean;
  situacaoFarmacia: number | null;
}

interface InternadoM {
  atendimento: number;
  paciente: number;
  cabecalho: number;
  leito: string;
  iniciais: string;
  alergia: boolean;
}

type Mutavel<T> = { -readonly [K in keyof T]: T[K] };
interface DoseM extends Mutavel<DoseDispensada> {
  atendimento: number;
  usuario: string;
}

interface ControleM {
  id: number;
  saida: number;
  situacao: number;
  em: Date;
  usuario: string;
  atendimento: number;
  motivo: string | null;
}

interface Estado {
  seq: number;
  /** F3.6: as regras de integração e as grades de horário padrão (chave frequência|setor). */
  regras?: RegraIntegracaoLida[];
  grades?: Map<
    string,
    { frequencia: number; setor: number | null; horarios: { hora: string; dias: number[] }[] }
  >;
  internados: InternadoM[];
  itens: Map<number, ItemM>;
  horarios: HorarioM[];
  doses: DoseM[];
  controles: ControleM[];
  aceites: Map<number, { autor: string; em: string; modo: string }>;
  devolucoes: { dose: number; quantidade: number; doc: number; em: string }[];
  avaliacoes: Map<number, AvaliacaoRegistrada & { decisaoTexto: string | null }>;
  intervencoes: IntervencaoRegistrada[];
  conferencias: { item: number; docTipo: string; docId: number; tipo: string; em: Date }[];
  movimentos: {
    item: number;
    data: string;
    tipo: 'entrada' | 'saida' | 'devolucao' | 'perda';
    quantidade: number;
    documento: string;
    documentoId: number;
    prescritor: number | null;
  }[];
  livros: {
    livro: number;
    inicio: string;
    modo: string;
    em: string;
    por: string;
    guardaAte: string;
    hash: string;
    conteudo: string;
  }[];
  ambulatoriais: {
    id: number;
    paciente: number;
    item: number;
    lote: string;
    quantidade: number;
    em: string;
    escriturada: boolean;
  }[];
  idem: Map<string, { hash: string; resultado: Record<string, number | string> }>;
}

function estadoInicial(): Estado {
  const agora = new Date();
  const hora = (h: number) => {
    const d = new Date(agora.getTime() + h * 3_600_000);
    d.setSeconds(0, 0);
    d.setMinutes(0);
    return d;
  };
  const validade = iso(new Date(agora.getFullYear() + 1, 2, 31));
  const itens: ItemM[] = [
    {
      codigo: 7001,
      nome: 'DIPIRONA SINTETICA 1 G',
      tipo: 'medicamento',
      portaria: null,
      antimicrobiano: false,
      altaVigilancia: false,
      rastreavel: false,
      barras: '7891234567895',
      saldo: 200,
      lotes: [],
      dose: 1,
      unidade: 'G',
      via: 'EV',
      envioAvaliacao: 1,
    },
    {
      codigo: 7002,
      nome: 'CEFAZOLINA SINTETICA 1 G',
      tipo: 'medicamento',
      portaria: null,
      antimicrobiano: true,
      altaVigilancia: false,
      rastreavel: true,
      barras: null,
      saldo: 80,
      lotes: [
        { lote: 'CFZ-01', validade, saldo: 40 },
        { lote: 'CFZ-02', validade: iso(new Date(agora.getFullYear() + 2, 0, 31)), saldo: 40 },
      ],
      dose: 1,
      unidade: 'G',
      via: 'EV',
      envioAvaliacao: 2,
    },
    {
      codigo: 7003,
      nome: 'MORFINA SINTETICA 10 MG',
      tipo: 'medicamento',
      portaria: 'A1',
      antimicrobiano: false,
      altaVigilancia: true,
      rastreavel: true,
      barras: null,
      saldo: 30,
      lotes: [{ lote: 'MRF-77', validade, saldo: 30 }],
      dose: 1,
      unidade: 'AMP',
      via: 'EV',
      envioAvaliacao: 1,
    },
    {
      codigo: 7004,
      nome: 'SERINGA SINTETICA 10 ML',
      tipo: 'material',
      portaria: null,
      antimicrobiano: false,
      altaVigilancia: false,
      rastreavel: false,
      barras: null,
      saldo: 500,
      lotes: [],
      dose: 1,
      unidade: 'UN',
      via: '',
      envioAvaliacao: 1,
    },
    {
      codigo: 7005,
      nome: 'CLONAZEPAM SINTETICO 2 MG',
      tipo: 'medicamento',
      portaria: 'B1',
      antimicrobiano: false,
      altaVigilancia: false,
      rastreavel: true,
      barras: null,
      saldo: 60,
      lotes: [{ lote: 'CLZ-05', validade, saldo: 60 }],
      dose: 1,
      unidade: 'CP',
      via: 'VO',
      envioAvaliacao: 1,
    },
  ];
  const internados: InternadoM[] = [
    {
      atendimento: 9001,
      paciente: 8001,
      cabecalho: 6001,
      leito: '201-A',
      iniciais: 'P.S.U.',
      alergia: false,
    },
    { atendimento: 9002, paciente: 8002, cabecalho: 6002, leito: '202-A', iniciais: 'P.S.D.', alergia: true },
    {
      atendimento: 9003,
      paciente: 8003,
      cabecalho: 6003,
      leito: '203-B',
      iniciais: 'P.S.T.',
      alergia: false,
    },
  ];
  let id = 50_000;
  const horarios: HorarioM[] = [];
  const plano: [number, number, number[]][] = [
    [9001, 7001, [1, 7]],
    [9001, 7002, [1, 9]],
    [9002, 7003, [2, 6]],
    [9002, 7004, [2]],
    [9003, 7005, [3]],
    [9003, 7001, [4]],
  ];
  let lanc = 40_000;
  for (const [atendimento, item, horas] of plano) {
    const i = internados.find((x) => x.atendimento === atendimento)!;
    lanc += 1;
    for (const h of horas)
      horarios.push({
        id: (id += 1),
        lancamento: lanc,
        prescricao: 30_000 + atendimento,
        atendimento,
        cabecalho: i.cabecalho,
        item,
        previsto: hora(h),
        situacao: 'P',
        urgente: false,
        ocupado: false,
        situacaoFarmacia: 5,
      });
  }
  return {
    seq: 100,
    internados,
    itens: new Map(itens.map((i) => [i.codigo, i])),
    horarios,
    doses: [],
    controles: [],
    aceites: new Map(),
    devolucoes: [],
    avaliacoes: new Map(),
    intervencoes: [],
    conferencias: [],
    movimentos: [],
    livros: [],
    ambulatoriais: [],
    idem: new Map(),
  };
}

export class PortaFarmaciaMemoria implements PortaFarmacia {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();
  constructor(
    private readonly catalogo: {
      estado(operacao: string, estabelecimento: string): EstadoOperacao | null;
    } | null = null,
  ) {}

  e(c: ContextoFarmacia): Estado {
    let s = this.estados.get(chaveDe(c));
    if (!s) {
      s = estadoInicial();
      this.estados.set(chaveDe(c), s);
    }
    return s;
  }

  /** Testes e E2E: marca o horário como ocupado (outro terminal) ou como checado pela enfermagem. */
  marcarHorario(c: ContextoFarmacia, id: number, m: { ocupado?: boolean; situacao?: string }): void {
    const h = this.e(c).horarios.find((x) => x.id === id);
    if (!h) return;
    if (m.ocupado !== undefined) h.ocupado = m.ocupado;
    if (m.situacao !== undefined) h.situacao = m.situacao;
  }

  /** Testes: uma prescrição nova (o tempo real a mostra na fila). */
  novaPrescricao(c: ContextoFarmacia, atendimento: number, item: number, horas: number): number {
    const s = this.e(c);
    const i = s.internados.find((x) => x.atendimento === atendimento)!;
    const d = new Date(Date.now() + horas * 3_600_000);
    d.setSeconds(0, 0);
    const id = (s.seq += 1) + 60_000;
    s.horarios.push({
      id,
      lancamento: id,
      prescricao: 30_000 + atendimento,
      atendimento,
      cabecalho: i.cabecalho,
      item,
      previsto: d,
      situacao: 'P',
      urgente: false,
      ocupado: false,
      situacaoFarmacia: 5,
    });
    return id;
  }

  private estadoOp(op: string, hospital: string): EstadoOperacao | null {
    return this.catalogo?.estado(op, hospital) ?? 'verde';
  }

  async podeGravar(c: ContextoFarmacia, op: string): Promise<LiberacaoGravacao> {
    const e = this.estadoOp(op, chaveDe(c));
    if (e === null || e === 'bloqueada')
      return {
        pode: false,
        codigo: 'operacao-bloqueada',
        motivo: 'A gravação está bloqueada neste estabelecimento (catálogo de operações).',
      };
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(c: ContextoFarmacia, op: string, entradaBruta: unknown, ctx: ContextoOperacao) {
    const entrada = ENTRADAS_FARMACIA[op];
    if (!entrada)
      throw new ErroOperacao(
        400,
        'operacao-desconhecida',
        'Operação desconhecida',
        `A operação ${op} não existe.`,
      );
    const a = entrada.safeParse(entradaBruta);
    if (!a.success)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(a.error.issues.map((i) => i.path.join('.') || '(entrada)'))],
      });
    const s = this.e(c);
    const chave = `${op}:${ctx.chaveIdempotencia}`;
    const hash = JSON.stringify(a.data);
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
    const resultado = this.aplicar(s, op, a.data as never, ctx);
    s.idem.set(chave, { hash, resultado });
    return { resultado, repetida: false, trilha: null };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private aplicar(s: Estado, op: string, e: any, ctx: ContextoOperacao): Record<string, number | string> {
    switch (op) {
      case 'suprimentos.gravarRegraIntegracao':
        return this.gravarRegra(s, e as GravarRegraIntegracaoEntrada);
      case 'suprimentos.gravarHorariosPadrao':
        return this.gravarGrade(s, e as GravarHorariosPadraoEntrada);
      case 'suprimentos.dispensarHorario':
        return this.dispensar(s, e as DispensarHorarioEntrada, autorDe(ctx));
      case 'suprimentos.confirmarEntrega':
        return this.confirmar(s, e as ConfirmarEntregaEntrada, autorDe(ctx));
      case 'suprimentos.devolverDose':
        return this.devolver(s, e as DevolverDoseEntrada);
      case 'suprimentos.cancelarDispensacao': {
        const d = s.doses.find((x) => x.dose === e.dose);
        if (!d) throw recusaOp('dose-inexistente', 'A dose não existe.', ['dose']);
        const ctl = this.ultimoControle(s, d.saida?.id ?? 0);
        if (ctl?.situacao === 8)
          throw recusaOp('ja-entregue', 'A dose já foi entregue ao setor: registre a devolução.', ['dose']);
        if (ctl?.situacao !== 7)
          throw recusaOp('nao-dispensada', 'A dose não está dispensada (ou já foi estornada).', ['dose']);
        const r = this.devolver(s, {
          dose: d.dose,
          local: LOCAL_FARMACIA_SINTETICO,
          quantidade: d.quantidade - d.devolvido,
          lote: d.lote ?? undefined,
          motivo: 'suspenso',
        } as DevolverDoseEntrada);
        s.controles.push({
          ...ctl,
          id: (s.seq += 1),
          situacao: 9,
          em: new Date(),
          usuario: autorDe(ctx),
          motivo: e.motivo,
        });
        return { ...r, saida: d.saida?.id ?? 0 };
      }
      case 'suprimentos.registrarPerdaControlado': {
        const p = e as RegistrarPerdaControladoEntrada;
        const i = s.itens.get(p.item);
        if (!i || !i.portaria)
          throw recusaOp('nao-controlado', 'O item não é controlado: registre a saída comum.', ['item']);
        const l = i.lotes.find((x) => x.lote === p.lote);
        recusar(
          conferirPerdaControlado({
            responsavel: autorDe(ctx),
            testemunha: p.testemunha,
            motivo: p.motivo,
            quantidade: p.quantidade,
            saldoLote: l?.saldo ?? 0,
            reautenticadoEm: ctx.reautenticadoEm ?? null,
            agora: Date.now(),
          }),
        );
        l!.saldo -= p.quantidade;
        i.saldo -= p.quantidade;
        const id = (s.seq += 1);
        s.movimentos.push({
          item: p.item,
          data: iso(new Date()),
          tipo: 'perda',
          quantidade: p.quantidade,
          documento: `S ${id}`,
          documentoId: id,
          prescritor: null,
        });
        s.conferencias.push({ item: p.item, docTipo: 'perda', docId: id, tipo: 'perda', em: new Date() });
        return { id, doc: id, ano: new Date().getFullYear(), mes: new Date().getMonth() + 1, itens: 1 };
      }
      case 'suprimentos.avaliarPrescricao': {
        const h = s.horarios.find((x) => x.id === e.horario);
        if (!h) throw recusaOp('horario-inexistente', 'O horário prescrito não existe.', ['horario']);
        h.situacaoFarmacia =
          { valido: 2, 'nao-aprovado': 3, 'pendencia-revisao-medica': 4 }[e.decisao as 'valido'] ?? 2;
        return { id: (s.seq += 1), situacao: h.situacaoFarmacia };
      }
      default:
        throw new ErroOperacao(
          501,
          'operacao-sem-memoria',
          'Indisponível',
          `A operação ${op} não tem porta em memória.`,
        );
    }
  }

  private ultimoControle(s: Estado, saida: number): ControleM | undefined {
    return s.controles.filter((x) => x.saida === saida).sort((a, b) => b.id - a.id)[0];
  }

  private dispensar(s: Estado, e: DispensarHorarioEntrada, usuario: string) {
    const livres: {
      h: HorarioM;
      q: number;
      lotes: { lote: string; validade: string; quantidade: number }[];
    }[] = [];
    let ocupadas = 0;
    let ja = 0;
    let susp = 0;
    for (const d of e.doses) {
      const h = s.horarios.find((x) => x.id === d.horario);
      if (!h || h.atendimento !== e.atendimento)
        throw recusaOp('horario-de-outro-paciente', 'Um dos horários não é deste atendimento.', ['doses']);
      if (h.ocupado) {
        ocupadas += 1;
        continue;
      }
      if (['S', 'C', 'X', 'O'].includes(h.situacao)) {
        susp += 1;
        continue;
      }
      if (s.doses.some((x) => x.horario === h.id)) {
        ja += 1;
        continue;
      }
      livres.push({ h, q: d.quantidade ?? s.itens.get(h.item)!.dose, lotes: d.lotes });
    }
    if (livres.length === 0) {
      if (susp > 0 && ja === 0 && ocupadas === 0)
        throw recusaOp('item-suspenso', 'O item foi suspenso na prescrição: não há dose a dispensar.', [
          'doses',
        ]);
      if (ja > 0 && ocupadas === 0)
        throw recusaOp('dose-ja-dispensada', 'As doses já foram dispensadas (por outro terminal).', [
          'doses',
        ]);
      throw recusaOp(
        'doses-ocupadas',
        'As doses estão sendo dispensadas em outro terminal agora: atualize a fila.',
        ['doses'],
      );
    }
    for (const x of livres) {
      const i = s.itens.get(x.h.item)!;
      if (x.q > i.saldo)
        throw recusaOp('saldo-insuficiente', `Saldo insuficiente: há ${i.saldo} e a saída pede ${x.q}.`, [
          'itens',
        ]);
      if (i.rastreavel) {
        const soma = x.lotes.reduce((t, l) => t + l.quantidade, 0);
        if (soma !== x.q)
          throw recusaOp('lotes-soma', 'A soma dos lotes tem de ser igual à quantidade.', ['lotes']);
        for (const l of x.lotes)
          if (!i.lotes.some((y) => y.lote === l.lote && y.saldo >= l.quantidade))
            throw recusaOp('lote-inexistente', `O lote ${l.lote} não tem saldo neste local.`, ['lotes']);
      }
      if (i.portaria)
        recusar(
          conferirPrescritorControlado({
            lista: listaDoItem(i.portaria),
            internado: true,
            prescritor: PRESCRITOR_SINTETICO,
            daPrescricao: true,
          }),
        );
    }
    const dispensacao = (s.seq += 1);
    const saida = (s.seq += 1);
    const agora = new Date();
    const ids: number[] = [];
    for (const x of livres) {
      const i = s.itens.get(x.h.item)!;
      i.saldo -= x.q;
      for (const l of x.lotes) i.lotes.find((y) => y.lote === l.lote)!.saldo -= l.quantidade;
      const dose = (s.seq += 1);
      ids.push(dose);
      s.doses.push({
        dose,
        horario: x.h.id,
        item: i.codigo,
        descricao: i.nome,
        quantidade: x.q,
        dispensadaEm: minuto(agora),
        etiquetaEmitida: true,
        saida: { id: saida, ano: agora.getFullYear(), mes: agora.getMonth() + 1, doc: saida },
        itemSaida: dose + 1_000_000,
        lote: x.lotes[0]?.lote ?? null,
        validade: x.lotes[0]?.validade ?? null,
        loteSaida: x.lotes[0] ? dose + 2_000_000 : null,
        situacaoEntrega: 7,
        barras: i.barras,
        devolvido: 0,
        atendimento: e.atendimento,
        usuario,
      });
      if (i.portaria)
        s.movimentos.push({
          item: i.codigo,
          data: iso(agora),
          tipo: 'saida',
          quantidade: x.q,
          documento: `S ${saida}`,
          documentoId: saida,
          prescritor: PRESCRITOR_SINTETICO.vinculo,
        });
    }
    const controle = (s.seq += 1);
    s.controles.push({
      id: controle,
      saida,
      situacao: 7,
      em: agora,
      usuario,
      atendimento: e.atendimento,
      motivo: null,
    });
    return {
      dispensacao,
      doc: dispensacao,
      saida,
      ano: agora.getFullYear(),
      mes: agora.getMonth() + 1,
      docSaida: saida,
      doses: ids.length,
      ocupadas: ocupadas + ja + susp,
      controle,
      idsDoses: ids.join(','),
    };
  }

  private confirmar(s: Estado, e: ConfirmarEntregaEntrada, usuario: string) {
    const c = s.controles.find((x) => x.id === e.controle);
    if (!c) throw recusaOp('controle-inexistente', 'A entrega não existe.', ['controle']);
    const ultimo = this.ultimoControle(s, c.saida);
    const etiquetas = s.doses
      .filter((d) => d.saida?.id === c.saida)
      .flatMap((d) =>
        etiquetasAceitas(
          codigoEtiquetaDose({
            dose: d.dose,
            item: d.item,
            barras: d.barras,
            lote: d.lote,
            validade: d.validade,
          }),
        ),
      );
    recusar(
      conferirAceiteEntrega({
        situacao: ultimo?.situacao ?? null,
        modo: e.modo,
        leitura: e.leitura ?? null,
        etiquetas,
        autor: usuario,
        dispensador: c.usuario,
        podeAceitar: true,
      }),
    );
    const id = (s.seq += 1);
    s.controles.push({ ...c, id, situacao: 8, em: new Date(), usuario });
    s.aceites.set(c.id, { autor: usuario, em: minuto(new Date()), modo: e.modo });
    s.aceites.set(id, { autor: usuario, em: minuto(new Date()), modo: e.modo });
    for (const d of s.doses) if (d.saida?.id === c.saida) d.situacaoEntrega = 8;
    return { controle: id, anterior: c.id, saida: c.saida };
  }

  private devolver(s: Estado, e: DevolverDoseEntrada) {
    const d = s.doses.find((x) => x.dose === e.dose);
    if (!d)
      throw recusaOp('dose-inexistente', 'A dose não existe ou a saída dela não foi consolidada.', ['dose']);
    recusar(
      conferirDevolucaoDose({
        quantidade: e.quantidade,
        dispensada: d.quantidade,
        jaDevolvida: d.devolvido,
        lote: d.lote,
        loteInformado: e.lote ?? null,
      }),
    );
    const i = s.itens.get(d.item)!;
    i.saldo += e.quantidade;
    if (d.lote) i.lotes.find((l) => l.lote === d.lote)!.saldo += e.quantidade;
    d.devolvido += e.quantidade;
    const doc = (s.seq += 1);
    s.devolucoes.push({ dose: d.dose, quantidade: e.quantidade, doc, em: minuto(new Date()) });
    if (i.portaria)
      s.movimentos.push({
        item: i.codigo,
        data: iso(new Date()),
        tipo: 'devolucao',
        quantidade: e.quantidade,
        documento: `D ${doc}`,
        documentoId: doc,
        prescritor: null,
      });
    const agora = new Date();
    return { id: doc, ano: agora.getFullYear(), mes: agora.getMonth() + 1, doc, itens: 1, dose: d.dose };
  }

  async gravarSgh<T>(
    c: ContextoFarmacia,
    _trilha: unknown,
    fn: (g: GravadorSghFarmacia) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const g: GravadorSghFarmacia = {
      triar: async (t) => {
        let novos = 0;
        for (const i of t.itens) {
          if (s.avaliacoes.has(i.item)) continue;
          s.avaliacoes.set(i.item, {
            id: (s.seq += 1),
            item: i.item,
            estado: i.destino === 'automatica' ? 'automatico' : 'pendente',
            decisao: null,
            destino: i.destino,
            prioridade: i.prioridade,
            achados: [...i.achados],
            desde: minuto(new Date()),
            farmaceutico: null,
            decisaoTexto: null,
          });
          novos += 1;
        }
        return { novos };
      },
      decidir: async (d) => {
        if (!s.avaliacoes.has(d.item)) await g.triar({ itens: [d.triagem] });
        const a = s.avaliacoes.get(d.item)!;
        recusar(
          conferirDecisaoAvaliacao({ decisao: d.decisao, justificativa: d.justificativa, estado: a.estado }),
        );
        s.avaliacoes.set(d.item, {
          ...a,
          estado: 'decidido',
          decisao: d.decisao,
          farmaceutico: d.farmaceutico,
          decisaoTexto: d.justificativa,
        });
        return { id: a.id };
      },
      intervir: async (i) => {
        const h = s.horarios.find((x) => x.lancamento === i.item);
        if (!h) throw recusaOp('item-inexistente', 'O item da prescrição não existe.', ['item']);
        const id = (s.seq += 1);
        s.intervencoes.push({
          id,
          avaliacao: s.avaliacoes.get(i.item)?.id ?? null,
          item: i.item,
          tipo: i.tipo,
          texto: i.texto,
          autor: i.autor,
          prescritor: PRESCRITOR_SINTETICO.login,
          criadaEm: minuto(new Date()),
          estado: 'aberta',
          resposta: null,
          justificativa: null,
          respondente: null,
          respondidaEm: null,
          atendimento: h.atendimento,
        });
        return { id, prescritor: PRESCRITOR_SINTETICO.login };
      },
      responder: async (r) => {
        const k = s.intervencoes.findIndex((x) => x.id === r.id);
        if (k < 0) throw recusaOp('intervencao-inexistente', 'A intervenção não existe.', ['intervencao']);
        const x = s.intervencoes[k]!;
        if (!x.prescritor || x.prescritor.toUpperCase() !== r.respondente.toUpperCase())
          throw recusaOp(
            'nao-e-o-prescritor',
            x.prescritor
              ? 'Só o prescritor do item responde à intervenção.'
              : 'A intervenção não tem prescritor com usuário: responda pelo contato da unidade.',
            ['intervencao'],
          );
        recusar(
          conferirRespostaIntervencao({
            estado: x.estado,
            resposta: r.resposta,
            justificativa: r.justificativa,
            respondente: r.respondente,
            autorIntervencao: x.autor,
          }),
        );
        s.intervencoes[k] = {
          ...x,
          estado: 'respondida',
          resposta: r.resposta,
          justificativa: r.justificativa || null,
          respondente: r.respondente,
          respondidaEm: minuto(new Date()),
        };
      },
      conferirControlado: async (cc) => {
        const doc =
          cc.documento.tipo === 'devolucao'
            ? s.devolucoes.find((x) => x.doc === cc.documento.id) && { usuario: 'SINT.FARMACEUTICO' }
            : (s.doses.find((x) => x.saida?.id === cc.documento.id) ??
              (cc.documento.tipo === 'perda' ? { usuario: 'SINT.FARMACEUTICO' } : undefined));
        if (!doc) throw recusaOp('documento-inexistente', 'O documento conferido não existe.', ['documento']);
        recusar(
          conferirDuplaConferencia({
            responsavel: doc.usuario,
            conferente: cc.conferente,
            reautenticadoEm: cc.reautenticadoEm,
            agora: cc.agora,
            quantidadeDocumento: cc.quantidadeDocumento,
            quantidadeContada: cc.quantidadeContada,
            justificativa: cc.justificativa,
          }),
        );
        if (
          s.conferencias.some(
            (x) =>
              x.tipo === 'conferencia' &&
              x.docTipo === cc.documento.tipo &&
              x.docId === cc.documento.id &&
              x.item === cc.item,
          )
        )
          throw recusaOp('ja-conferido', 'Este controlado já tem a segunda conferência registrada.', [
            'item',
          ]);
        s.conferencias.push({
          item: cc.item,
          docTipo: cc.documento.tipo,
          docId: cc.documento.id,
          tipo: 'conferencia',
          em: new Date(),
        });
        return { id: (s.seq += 1) };
      },
      fecharLivro: async (f) => {
        recusar(
          conferirFechamentoLivro({
            responsavelTecnico: f.responsavelTecnico,
            inicio: f.livro.inicio,
            fim: f.livro.fim,
            oficial: f.livro.modo === 'oficial',
            chaveOficialLigada: f.chaveOficialLigada,
            jaFechado: s.livros.some(
              (x) => x.livro === f.livro.livro && x.inicio === f.livro.inicio && x.modo === f.livro.modo,
            ),
          }),
        );
        const conteudo = JSON.stringify(f.livro);
        const hash = createHash('sha256').update(conteudo, 'utf8').digest('hex');
        const guarda = guardaAte(f.livro.fim);
        s.livros.push({
          livro: f.livro.livro,
          inicio: f.livro.inicio,
          modo: f.livro.modo,
          em: minuto(new Date()),
          por: f.usuario,
          guardaAte: guarda,
          hash,
          conteudo,
        });
        return { id: (s.seq += 1), hash, guardaAte: guarda };
      },
      dispensarAmbulatorial: async (d) => {
        const i = s.itens.get(d.item);
        if (!i) throw recusaOp('item-inexistente', 'O item não existe no cadastro.', ['item']);
        recusar(
          conferirDispensacaoAmbulatorial({
            portaria: i.portaria,
            receitaNumero: d.receitaNumero,
            receitaData: d.receitaData,
            hoje: d.hoje,
            lote: d.lote,
            quantidade: d.quantidade,
          }),
        );
        const id = (s.seq += 1);
        s.ambulatoriais.push({
          id,
          paciente: d.paciente,
          item: d.item,
          lote: d.lote,
          quantidade: d.quantidade,
          em: minuto(new Date()),
          escriturada: false,
        });
        return { id };
      },
      escriturarSngpc: async () => {
        const env = montarEnvioSngpc(s.ambulatoriais);
        if (env.dispensacoes.length === 0)
          throw recusaOp('nada-a-escriturar', 'Não há dispensação ambulatorial a escriturar no período.');
        for (const a of s.ambulatoriais) if (env.dispensacoes.includes(a.id)) a.escriturada = true;
        return { lote: (s.seq += 1), dispensacoes: env.dispensacoes.length };
      },
    };
    return fn(g);
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────

  async relogio() {
    const agora = new Date();
    return { agora, hoje: iso(agora) };
  }
  async unidades(c: ContextoFarmacia) {
    return [{ unidade: UNIDADE_SINTETICA, nome: 'UTI sintética', internados: this.e(c).internados.length }];
  }
  async filaDaUnidade(c: ContextoFarmacia, o: { unidade: string; inicio: Date; fim: Date }) {
    const s = this.e(c);
    if (o.unidade !== UNIDADE_SINTETICA) return { doses: [], cortada: false };
    const doses: DoseDaFila[] = s.horarios
      .filter((h) => h.previsto >= o.inicio && h.previsto < o.fim)
      .map((h) => {
        const i = s.itens.get(h.item)!;
        const n = s.internados.find((x) => x.atendimento === h.atendimento)!;
        const horario: HorarioDaFila = {
          id: h.id,
          item: h.lancamento,
          prescricao: h.prescricao,
          atendimento: h.atendimento,
          previsto: minuto(h.previsto),
          suspenso: ['S', 'C', 'X', 'O'].includes(h.situacao),
          tipo: i.tipo,
          descricao: i.nome,
          dose: i.dose,
          unidadeDose: i.unidade,
          via: i.via || null,
          produto: i.codigo,
          altaVigilancia: i.altaVigilancia,
          antimicrobiano: i.antimicrobiano,
        };
        return {
          horario,
          atendimento: h.atendimento,
          paciente: n.paciente,
          leito: n.leito,
          iniciais: n.iniciais,
          alergia: n.alergia,
          dispensada: s.doses.some((d) => d.horario === h.id),
          validadaAntes: h.situacaoFarmacia === 5 || h.situacaoFarmacia === 2,
          urgente: h.urgente,
        };
      });
    return { doses, cortada: false };
  }
  async itens(c: ContextoFarmacia, codigos: readonly number[]) {
    const s = this.e(c);
    return new Map(
      codigos.flatMap((k) => {
        const i = s.itens.get(k);
        return i
          ? [
              [
                k,
                {
                  codigo: k,
                  rastreavel: i.rastreavel,
                  portaria: i.portaria,
                  psico: !!i.portaria,
                  antimicrobiano: i.antimicrobiano,
                  barras: i.barras,
                  envioAvaliacao: i.envioAvaliacao,
                },
              ] as const,
            ]
          : [];
      }),
    );
  }
  async avaliacoes(c: ContextoFarmacia, itens: readonly number[]) {
    const s = this.e(c);
    return new Map(itens.flatMap((k) => (s.avaliacoes.has(k) ? [[k, s.avaliacoes.get(k)!] as const] : [])));
  }
  async itensPrescritos(_c: ContextoFarmacia, lancamentos: readonly number[]) {
    return new Map(lancamentos.map((l) => [l, { alergiaJustificada: false, produto: null }]));
  }
  async dosesDoAtendimento(c: ContextoFarmacia, atendimento: number) {
    return this.e(c)
      .doses.filter((d) => d.atendimento === atendimento)
      .map((d) => ({ ...d }));
  }
  async situacoes(c: ContextoFarmacia, horarios: readonly number[]) {
    const s = this.e(c);
    return new Map(
      horarios.flatMap((id) => {
        const h = s.horarios.find((x) => x.id === id);
        return h ? [[id, { situacao: h.situacao, em: null }] as const] : [];
      }),
    );
  }
  async entregas(c: ContextoFarmacia, o: { situacao: number; centroCusto?: number }) {
    const s = this.e(c);
    const ultimos = new Map<number, ControleM>();
    for (const x of s.controles) if ((ultimos.get(x.saida)?.id ?? 0) < x.id) ultimos.set(x.saida, x);
    return [...ultimos.values()]
      .filter((x) => x.situacao === o.situacao)
      .map((x) => ({
        controle: x.id,
        situacao: x.situacao,
        desde: minuto(x.em),
        saida: { id: x.saida, ano: x.em.getFullYear(), mes: x.em.getMonth() + 1, doc: x.saida },
        atendimento: x.atendimento,
        centroCusto: CENTRO_SINTETICO,
        usuario: x.usuario,
        itens: s.doses.filter((d) => d.saida?.id === x.saida).length,
      }));
  }
  async dosesDaSaida(c: ContextoFarmacia, saida: number) {
    return this.e(c)
      .doses.filter((d) => d.saida?.id === saida)
      .map((d) => ({
        dose: d.dose,
        item: d.item,
        descricao: d.descricao,
        quantidade: d.quantidade,
        barras: d.barras,
        lote: d.lote,
        validade: d.validade,
      }));
  }
  async leitos(c: ContextoFarmacia, regs: readonly number[]) {
    const s = this.e(c);
    return new Map(
      regs.flatMap((r) => {
        const i = s.internados.find((x) => x.atendimento === r);
        return i ? [[r, { leito: i.leito, iniciais: i.iniciais }] as const] : [];
      }),
    );
  }
  async aceites(c: ContextoFarmacia, controles: readonly number[]) {
    const s = this.e(c);
    return new Map(controles.flatMap((k) => (s.aceites.has(k) ? [[k, s.aceites.get(k)!] as const] : [])));
  }
  async intervencoesDosItens(c: ContextoFarmacia, itens: readonly number[]) {
    return this.e(c).intervencoes.filter((x) => itens.includes(x.item));
  }
  async intervencoesDoPrescritor(c: ContextoFarmacia, login: string) {
    return this.e(c).intervencoes.filter((x) => x.prescritor === login && x.estado === 'aberta');
  }
  async intervencao(c: ContextoFarmacia, id: number) {
    return this.e(c).intervencoes.find((x) => x.id === id) ?? null;
  }
  async totaisIntervencoes(c: ContextoFarmacia) {
    const l = this.e(c).intervencoes;
    return {
      abertas: l.filter((x) => x.estado === 'aberta').length,
      aceitas: l.filter((x) => x.resposta === 'aceita').length,
      recusadas: l.filter((x) => x.resposta === 'recusada').length,
    };
  }
  async substituicoes() {
    return [];
  }
  async controlados(c: ContextoFarmacia) {
    return [...this.e(c).itens.values()]
      .filter((i) => i.portaria)
      .map((i) => ({ item: i.codigo, nome: i.nome, portaria: i.portaria!, estoque: i.saldo }));
  }
  async movimentos(c: ContextoFarmacia, o: { itens: readonly number[]; inicio: Date; fim: Date }) {
    const ini = iso(o.inicio);
    const fim = iso(o.fim);
    return this.e(c).movimentos.filter((m) => o.itens.includes(m.item) && m.data >= ini && m.data <= fim);
  }
  async conferencias(c: ContextoFarmacia) {
    return this.e(c).conferencias.map((x) => ({
      item: x.item,
      docTipo: x.docTipo,
      docId: x.docId,
      tipo: x.tipo,
    }));
  }
  async livroFechado(c: ContextoFarmacia, livro: number, inicio: Date) {
    const x = this.e(c)
      .livros.filter((l) => l.livro === livro && l.inicio === iso(inicio))
      .at(-1);
    return x
      ? { em: x.em, por: x.por, guardaAte: x.guardaAte, hash: x.hash, conteudo: x.conteudo, modo: x.modo }
      : null;
  }
  async locais() {
    return [{ codigo: LOCAL_FARMACIA_SINTETICO, nome: 'FARMACIA SINTETICA' }];
  }
  async lotes(c: ContextoFarmacia, item: number, local: number) {
    if (local !== LOCAL_FARMACIA_SINTETICO) return [];
    return (this.e(c).itens.get(item)?.lotes ?? [])
      .filter((l) => l.saldo > 0)
      .sort((a, b) => a.validade.localeCompare(b.validade))
      .map((l, k) => ({ id: item * 100 + k + 1, lote: l.lote, validade: l.validade, quantidade: l.saldo }));
  }
  async janelaEntregas(c: ContextoFarmacia) {
    const primeiro = this.e(c).controles[0];
    return { desde: primeiro ? minuto(primeiro.em) : null };
  }
  /** F3.6: as regras e as grades gravadas nesta memória, com as opções sintéticas. */
  async parametrosEditaveis(c: ContextoFarmacia): Promise<ParametrosIntegracaoEditaveis> {
    const s = this.e(c);
    return {
      regras: s.regras ?? [],
      grades: [...(s.grades ?? new Map()).values()].map((g) => ({
        ...g,
        frequenciaNome: `Frequência ${g.frequencia}`,
        dosesPorDia: null,
        setorNome: g.setor === null ? null : `Setor ${g.setor}`,
      })),
      opcoes: {
        centros: [{ id: CENTRO_SINTETICO, nome: 'UTI SINTETICA' }],
        setores: [],
        unidades: [],
        locais: [{ id: LOCAL_FARMACIA_SINTETICO, nome: 'FARMACIA SINTETICA' }],
        tiposItem: [],
        grupos: [],
        frequencias: [{ id: 1, nome: '8/8H SINTETICA', dosesPorDia: 3 }],
      },
    };
  }

  private gravarRegra(s: Estado, e: GravarRegraIntegracaoEntrada): Record<string, number> {
    const rs = conferirRegraIntegracao(e);
    if (rs[0])
      throw recusaOp(
        rs[0].codigo,
        rs.map((r) => r.mensagem).join(' '),
        rs.flatMap((r) => r.campos ?? []),
      );
    const regras = (s.regras ??= []);
    const chave = chaveRegraIntegracao(e);
    const igual = regras.find((r) => r.ativo && r.regra !== e.regra && chaveRegraIntegracao(r) === chave);
    if (e.ativo && igual)
      throw recusaOp(
        'regra-duplicada',
        `Já existe a regra ${igual.regra} ativa com o mesmo escopo e a mesma prioridade.`,
        ['prioridade'],
      );
    const atual = e.regra === undefined ? undefined : regras.find((r) => r.regra === e.regra);
    if (e.regra !== undefined && !atual)
      throw recusaOp('regra-inexistente', 'A regra não existe.', ['regra']);
    if (atual && atual.versao !== e.versao)
      throw new ErroOperacao(
        409,
        'versao-divergente',
        'Registro alterado',
        'Outro usuário alterou a regra: recarregue.',
      );
    const dados = { ...e };
    delete dados.regra;
    delete dados.versao;
    const nova: RegraIntegracaoLida = {
      ...dados,
      regra: atual?.regra ?? (s.seq += 1),
      versao: (atual?.versao ?? 0) + 1,
      escopoNome: '',
      localNome: '',
    };
    if (atual) regras.splice(regras.indexOf(atual), 1, nova);
    else regras.push(nova);
    return { regra: nova.regra };
  }

  private gravarGrade(s: Estado, e: GravarHorariosPadraoEntrada): Record<string, number> {
    const rs = conferirHorariosPadrao(e.horarios, e.frequencia === 1 ? 3 : null);
    if (rs[0])
      throw recusaOp(
        rs[0].codigo,
        rs.map((r) => r.mensagem).join(' '),
        rs.flatMap((r) => r.campos ?? []),
      );
    (s.grades ??= new Map()).set(`${e.frequencia}|${e.setor ?? ''}`, {
      frequencia: e.frequencia,
      setor: e.setor,
      horarios: e.horarios.map((h) => ({ hora: h.hora, dias: [...h.dias] })),
    });
    return { frequencia: e.frequencia };
  }

  async parametrosIntegracao() {
    return {
      centros: [
        {
          centroCusto: CENTRO_SINTETICO,
          nome: 'UTI SINTETICA',
          tipoPrescricao: 1,
          tipoIntegracao: 1,
          momento: 1,
          tipoEnvio: 1,
        },
      ],
      horarios: [
        { codigo: 'H11', valor: 8 },
        { codigo: 'H21', valor: 8 },
        { codigo: 'H22', valor: 20 },
      ],
      validacaoFarmaceutica: false,
      tipos: [
        { id: 1, nome: 'Não', ativo: true },
        { id: 2, nome: 'Sim', ativo: true },
        { id: 3, nome: 'Somente urgência', ativo: true },
      ],
    };
  }
  async ambulatoriais(c: ContextoFarmacia) {
    return this.e(c).ambulatoriais.map((x) => ({ ...x }));
  }
}
