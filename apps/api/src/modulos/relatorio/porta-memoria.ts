// Porta do catálogo de relatórios em memória (M34): a sessão sintética de dev/ci (E2E). Linhas SINTÉTICAS por
// relatório (determinísticas pelos parâmetros; nomes de pacientes fictícios), um inventário sintético de relatórios
// de origem (a triagem roda sobre ele pelas mesmas regras), agendamentos, execuções e pedidos em memória. Nada vai à
// cópia. O relatório "lento" sintético estoura o tempo como o driver faria (mensagem em português).
import type { DestinoTriagem } from '@sgh/contratos';
import { erroConflitoVersao } from '@sgh/nucleo';
import { proporTriagem, resumirTriagem } from '@sgh/dominio-relatorio';
import {
  type AgendamentoRelatorio,
  type AlvoEventoRelatorio,
  ErroRelatorio,
  type RegistroEventoRelatorio,
  type ExecucaoRelatorio,
  type LinhaRelatorio,
  type PedidoRelatorio,
  type RelatorioDeOrigem,
  type ItemTriagem,
  type ValoresDoRelatorio,
  type VinculoRelatorio,
} from './tipos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { registrarNaTrilha } from '../../autorizacao/trilha-memoria.js';
import type { ContextoRelatorio, GravadorRelatorio, OpcoesExecucao, PortaRelatorio } from './porta.js';

const PACIENTES = ['Paciente Fictício Um', 'Paciente Fictício Dois', 'Paciente Fictício Três'];

/** Inventário sintético (nomes e módulos como os do editor de origem; nenhum dado de pessoa). */
const INVENTARIO: readonly RelatorioDeOrigem[] = [
  {
    id: 1,
    nome: 'Faturamento mensal anual - valor',
    modulo: 4,
    tipo: 2,
    opcao: 5573,
    parametros: 2,
    acessoRestrito: false,
  },
  {
    id: 2,
    nome: 'Relatório de glosas de contas pagas',
    modulo: 4,
    tipo: 2,
    opcao: 5583,
    parametros: 3,
    acessoRestrito: true,
  },
  {
    id: 3,
    nome: 'Contas não emitidas e não fechadas',
    modulo: 4,
    tipo: 2,
    opcao: 5649,
    parametros: 2,
    acessoRestrito: false,
  },
  {
    id: 4,
    nome: 'Censo diário de pacientes internados',
    modulo: 6,
    tipo: 2,
    opcao: 5415,
    parametros: 1,
    acessoRestrito: false,
  },
  {
    id: 5,
    nome: 'Mapa cirúrgico diário',
    modulo: 8,
    tipo: 2,
    opcao: 2284,
    parametros: 1,
    acessoRestrito: false,
  },
  {
    id: 6,
    nome: 'Conferência eSocial S-1200',
    modulo: 22,
    tipo: 2,
    opcao: null,
    parametros: 2,
    acessoRestrito: true,
  },
  {
    id: 7,
    nome: 'Etiqueta de prontuário',
    modulo: -1,
    tipo: 3,
    opcao: null,
    parametros: 1,
    acessoRestrito: false,
  },
  {
    id: 8,
    nome: 'Teste relatório novo',
    modulo: -1,
    tipo: 2,
    opcao: null,
    parametros: 0,
    acessoRestrito: false,
  },
  {
    id: 9,
    nome: 'Mapa estatístico do laboratório',
    modulo: 9,
    tipo: 2,
    opcao: 2804,
    parametros: 2,
    acessoRestrito: false,
  },
  {
    id: 10,
    nome: 'Posição de estoque por almoxarifado',
    modulo: 12,
    tipo: 2,
    opcao: null,
    parametros: 1,
    acessoRestrito: false,
  },
  {
    id: 11,
    nome: 'Contas a pagar por vencimento',
    modulo: 14,
    tipo: 2,
    opcao: null,
    parametros: 2,
    acessoRestrito: false,
  },
  {
    id: 12,
    nome: 'Atendimentos por convênio',
    modulo: -1,
    tipo: 2,
    opcao: 2324,
    parametros: 2,
    acessoRestrito: false,
  },
];

const dias = (de: string, ate: string): string[] => {
  const r: string[] = [];
  const fim = new Date(`${ate}T00:00:00Z`).getTime();
  for (let t = new Date(`${de}T00:00:00Z`).getTime(); t <= fim && r.length < 400; t += 86_400_000)
    r.push(new Date(t).toISOString().slice(0, 10));
  return r;
};

/** As linhas sintéticas de cada relatório (as colunas da parte pública). */
export function linhasSinteticas(codigo: string, v: ValoresDoRelatorio): LinhaRelatorio[] {
  const s = (k: string) => String(v[k] ?? '');
  switch (codigo) {
    case 'faturamentoPorConvenio':
      return [
        {
          convenio: 1,
          nomeConvenio: 'Convênio Sintético A',
          contas: 12,
          itens: 340,
          cobrado: 15230.5,
          pago: 12100,
        },
        {
          convenio: 2,
          nomeConvenio: 'Convênio Sintético B',
          contas: 7,
          itens: 121,
          cobrado: 8200,
          pago: 8200,
        },
      ].filter((x) => v['convenio'] === undefined || x.convenio === Number(v['convenio']));
    case 'glosasPorConvenio':
      return [
        {
          convenio: 1,
          nomeConvenio: 'Convênio Sintético A',
          itensBaixados: 300,
          cobradoBaixado: 14000,
          pagoBaixado: 12100,
          glosa: 1900,
          percentualGlosa: 13.57,
        },
      ];
    case 'contasNaoFechadas':
      return PACIENTES.map((p, i) => ({
        conta: 9001 + i,
        tipo: i === 1 ? 'E' : 'I',
        competencia: s('inicio').slice(0, 7),
        convenio: 1 + (i % 2),
        alta: `${s('inicio')}T1${i}:00:00`,
        situacao: i === 2 ? 'aberta' : 'não emitida',
        paciente: p,
      })).filter((x) => s('tipo') === 'todas' || s('tipo') === '' || x.tipo === s('tipo'));
    case 'examesPorSetor':
      return [
        { ato: 15, exames: 210, liberados: 190, pendentes: 12 },
        { ato: 24, exames: 31, liberados: 28, pendentes: 3 },
      ];
    case 'mapaCirurgicoDia':
      return [
        {
          sala: 1,
          inicio: '07:30',
          termino: '09:10',
          duracao: '01:40',
          tipo: 'Eletiva',
          convenio: 1,
          atendimento: 7001,
        },
        {
          sala: 2,
          inicio: '10:00',
          termino: '11:15',
          duracao: '01:15',
          tipo: 'Urgência',
          convenio: 2,
          atendimento: 7002,
        },
      ];
    case 'cirurgiasPorPeriodo':
      return dias(s('inicio'), s('fim')).map((d, i) => ({ dia: d, tipo: 'Eletiva', cirurgias: 2 + (i % 3) }));
    case 'internadosNaData':
      return PACIENTES.map((p, i) => ({
        unidade: ['UTI', 'CLINICA', 'PEDIATRIA'][i] ?? 'CLINICA',
        atendimento: 8001 + i,
        entrada: `${s('dia')}T0${i + 6}:00:00`,
        convenio: 1,
        paciente: p,
      }));
    case 'atendimentosPorDia':
      return dias(s('inicio'), s('fim')).flatMap((d, i) => [
        { dia: d, tipo: 'Externo', atendimentos: 40 + (i % 7) },
        { dia: d, tipo: 'Internação', atendimentos: 3 + (i % 2) },
      ]);
    // W0-09 (catálogo A): linhas sintéticas no formato de cada relatório.
    case 'censoDiarioPorUnidade':
      return [
        { unidade: 'CLINICA', internados: 18, admissoes: 3, altas: 2, obitos: 0 },
        { unidade: 'UTI', internados: 9, admissoes: 1, altas: 0, obitos: 1 },
      ];
    case 'altasEObitos':
      return [
        {
          unidade: 'CLINICA',
          motivo: 12,
          nomeMotivo: 'MELHORADO',
          grupo: 'Alta domiciliar',
          saidas: 21,
          obitos: 0,
        },
        { unidade: 'UTI', motivo: 41, nomeMotivo: 'OBITO', grupo: 'Óbito', saidas: 2, obitos: 2 },
      ];
    case 'producaoPorProfissionalSetor':
      return [
        {
          profissional: 1001,
          nomeProfissional: 'Profissional Fictício A',
          setor: 15,
          itens: 40,
          quantidade: 52,
          cobrado: 4100.5,
        },
        { profissional: null, nomeProfissional: null, setor: 24, itens: 12, quantidade: 12, cobrado: 980 },
      ];
    case 'consumoPorCentroCusto':
      return [
        { centroCusto: 10, nomeCentroCusto: 'UTI ADULTO', quantidade: 1200, valor: 7500, participacao: 75 },
        {
          centroCusto: 20,
          nomeCentroCusto: 'CENTRO CIRURGICO',
          quantidade: 300,
          valor: 2500,
          participacao: 25,
        },
      ];
    case 'curvaAbcConsumo':
      return [
        {
          classe: 'A',
          item: 501,
          nomeItem: 'ITEM SINTETICO 1',
          quantidade: 10,
          valor: 800,
          participacao: 80,
          acumulado: 80,
        },
        {
          classe: 'B',
          item: 502,
          nomeItem: 'ITEM SINTETICO 2',
          quantidade: 30,
          valor: 150,
          participacao: 15,
          acumulado: 95,
        },
        {
          classe: 'C',
          item: 503,
          nomeItem: 'ITEM SINTETICO 3',
          quantidade: 90,
          valor: 50,
          participacao: 5,
          acumulado: 100,
        },
      ];
    case 'validadeLote':
      return [
        {
          validade: '2026-10-01',
          diasParaVencer: -17,
          situacao: 'Vencido',
          item: 501,
          nomeItem: 'ITEM SINTETICO 1',
          lote: 'L01',
          local: 1,
          nomeLocal: 'FARMACIA',
          quantidade: 4,
        },
        {
          validade: '2027-01-10',
          diasParaVencer: 53,
          situacao: 'A vencer',
          item: 502,
          nomeItem: 'ITEM SINTETICO 2',
          lote: 'L02',
          local: 1,
          nomeLocal: 'FARMACIA',
          quantidade: 20,
        },
      ];
    case 'dietasServidas':
      return [
        { dia: '2026-10-01', dieta: 1, nomeDieta: 'DIETA ORAL', dietas: 30, pacientes: 23 },
        { dia: '2026-10-01', dieta: 2, nomeDieta: 'DIETA ENTERAL', dietas: 4, pacientes: 4 },
      ];
    case 'prontuariosEmprestados':
      return [
        {
          conta: 9001,
          saidaEm: '2026-10-02T10:30:00',
          operacao: 'Saída',
          destino: 'FATURAMENTO',
          localAtual: 'AUDITORIA',
          diasFora: 47,
          prontuarios: 1,
        },
      ];
    case 'atendimentosPorConvenio':
      return [
        {
          convenio: 306,
          nomeConvenio: 'CONVENIO SINTETICO',
          internacoes: 4,
          externos: 131,
          atendimentos: 135,
          participacao: 100,
        },
      ];
    case 'producaoSus':
      return [
        { instrumento: 'AIH', procedimento: '0303140151', registros: 2, quantidade: 2, valor: 1500.25 },
        { instrumento: 'BPA', procedimento: '0301010072', registros: 10, quantidade: 12, valor: 120.5 },
      ];
    case 'escalaAgendas':
      return [
        {
          agenda: 'AGENDA SINTETICA',
          diaSemana: 'Quarta',
          inicio: '08:30',
          fim: '11:30',
          intervalo: null,
          duracaoMin: 10,
          vagas: 18,
          ativa: 'Sim',
        },
      ];
    default:
      throw new ErroRelatorio('consulta', `Relatório ${codigo} sem consulta no catálogo.`);
  }
}

/** Trava otimista da memória: a mesma recusa da porta própria (a versão começa em 1). */
function conferirVersao(lida: number | undefined, daTela: number | undefined): void {
  if (daTela !== undefined && (lida ?? 1) !== daTela) throw erroConflitoVersao(['versao']);
}

export class PortaRelatorioMemoria implements PortaRelatorio {
  readonly destino = 'memoria' as const;
  /** A trilha da sessão sintética (a gravação em memória registra a linha nela). */
  constructor(private readonly trilha: RegistradorTrilha | null = null) {}
  private readonly triagens = new Map<string, Map<number, ItemTriagem>>();
  private readonly agendas = new Map<string, AgendamentoRelatorio & { hospital: string }>();
  private readonly execs: (ExecucaoRelatorio & { hospital: string; agendamento?: string | null })[] = [];
  private readonly peds = new Map<string, PedidoRelatorio & { hospital: string }>();
  private readonly eventosRel: (RegistroEventoRelatorio & {
    hospital: string;
    alvo: AlvoEventoRelatorio;
    id: string;
  })[] = [];
  private seq = 100;
  /** Testes: força o estouro do tempo (o driver cancelaria a consulta). */
  lento = false;

  private daTriagem(hospital: string): Map<number, ItemTriagem> {
    let t = this.triagens.get(hospital);
    if (!t) {
      t = new Map(
        INVENTARIO.map((r) => {
          const p = proporTriagem(r);
          return [
            r.id,
            {
              id: r.id,
              nome: r.nome,
              modulo: r.modulo,
              destino: p.destino,
              marco: p.marco,
              artefato: p.artefato,
              papelDono: p.papelDono,
              onda: p.onda,
              situacao: 'proposta',
              regra: p.regra,
              motivo: p.motivo,
              decididoPor: null,
              decididoEm: null,
              parametros: r.parametros,
              acessoRestrito: r.acessoRestrito,
            },
          ];
        }),
      );
      this.triagens.set(hospital, t);
    }
    return t;
  }

  async relogio(): Promise<{ agora: Date; hoje: string }> {
    const agora = new Date();
    // O relógio de parede (os campos UTC carregam a hora local, como no banco do estabelecimento).
    const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000);
    return { agora: local, hoje: local.toISOString().slice(0, 10) };
  }

  async executar(
    _c: ContextoRelatorio,
    codigo: string,
    valores: ValoresDoRelatorio,
    o: OpcoesExecucao,
  ): Promise<{ linhas: LinhaRelatorio[]; variante: string }> {
    if (this.lento)
      throw new ErroRelatorio(
        'tempo',
        `O relatório passou do tempo máximo de ${Math.round(o.tempoMaximoMs / 1000)} s e foi cancelado: diminua o período ou use os filtros.`,
      );
    const linhas = linhasSinteticas(codigo, valores);
    if (linhas.length > o.teto)
      throw new ErroRelatorio(
        'teto',
        `O relatório passou do teto de ${o.teto} linhas: diminua o período ou use os filtros.`,
      );
    return { linhas, variante: 'sintetica' };
  }

  async acessoDeOrigem() {
    return { relatorios: 0, restrito: false, permitido: true };
  }

  async inventario(): Promise<RelatorioDeOrigem[]> {
    return [...INVENTARIO];
  }

  async triagem(c: ContextoRelatorio, f: Parameters<PortaRelatorio['triagem']>[1]) {
    const termo = f.termo?.toUpperCase();
    const todos = [...this.daTriagem(c.hospital).values()].filter(
      (t) =>
        (!f.destino || t.destino === f.destino) &&
        (!f.situacao || t.situacao === f.situacao) &&
        (!f.marco || t.marco === f.marco) &&
        (!termo || t.nome.toUpperCase().includes(termo)),
    );
    const tamanho = Math.max(1, Math.min(100, f.tamanho));
    return { itens: todos.slice(f.pagina * tamanho, (f.pagina + 1) * tamanho), total: todos.length };
  }

  async umaTriagem(c: ContextoRelatorio, id: number) {
    return this.daTriagem(c.hospital).get(id) ?? null;
  }

  async resumoTriagem(c: ContextoRelatorio) {
    const l = [...this.daTriagem(c.hospital).values()];
    const r = resumirTriagem(
      l.map((t) => ({ ...t, destino: t.destino as DestinoTriagem, regra: t.regra ?? '' })),
    );
    return {
      total: r.total,
      semDestino: r.semDestino,
      semDono: r.semDono,
      confirmadas: l.filter((t) => t.situacao === 'confirmada').length,
      porDestino: { ...r.porDestino },
      porMarco: { ...r.porMarco },
    };
  }

  async agendamentos(c: ContextoRelatorio) {
    return [...this.agendas.values()].filter((a) => a.hospital === c.hospital);
  }

  async agendamento(c: ContextoRelatorio, id: string) {
    return this.agendas.get(`${c.hospital}:${id}`) ?? null;
  }

  async vencidos(c: ContextoRelatorio, lote: number) {
    const agora = (await this.relogio()).agora.getTime();
    return (await this.agendamentos(c))
      .filter((a) => a.ativo && a.proximoEnvio && a.proximoEnvio.getTime() <= agora)
      .slice(0, lote);
  }

  async historicoOrigem() {
    return {
      agendamentos: 2,
      porAno: [
        { ano: 2020, situacao: 1, quantidade: 169 },
        { ano: 2020, situacao: 4, quantidade: 300 },
        { ano: 2026, situacao: 4, quantidade: 120 },
      ],
      ultimoEnviado: new Date('2020-07-15T08:00:00Z'),
    };
  }

  async execucoes(
    c: ContextoRelatorio,
    f: { readonly relatorio?: string; readonly usuario?: string; readonly limite: number },
  ) {
    return this.execs
      .filter(
        (x) =>
          x.hospital === c.hospital &&
          (!f.relatorio || x.relatorio === f.relatorio) &&
          (!f.usuario || x.usuario === f.usuario),
      )
      .slice(-f.limite)
      .reverse();
  }

  async pedidos(c: ContextoRelatorio, f: { readonly solicitante?: string }) {
    return [...this.peds.values()].filter(
      (p) => p.hospital === c.hospital && (!f.solicitante || p.solicitante === f.solicitante),
    );
  }

  async pedido(c: ContextoRelatorio, id: string) {
    const p = this.peds.get(id);
    return p && p.hospital === c.hospital ? p : null;
  }

  async eventos(c: ContextoRelatorio, alvo: AlvoEventoRelatorio, id: string) {
    return this.eventosRel.filter((e) => e.hospital === c.hospital && e.alvo === alvo && e.id === id);
  }

  /** As mesmas regras do mapa da porta própria, sobre a memória. */
  async dependencias(c: ContextoRelatorio, alvo: 'pedido' | 'agendamento', id: string) {
    const r: VinculoRelatorio[] = [];
    if (alvo === 'agendamento') {
      const n = this.execs.filter((x) => x.hospital === c.hospital && x.agendamento === id).length;
      if (n > 0) r.push({ grupo: 'envios e execuções registrados', quantidade: n, origem: 'fk' });
      if (this.agendas.get(`${c.hospital}:${id}`)?.ultimoEnvio)
        r.push({ grupo: 'envio já feito', quantidade: 1, origem: 'logica' });
    } else {
      const p = await this.pedido(c, id);
      if (p && (p.respondidoEm || p.situacao !== 'aberto'))
        r.push({ grupo: 'resposta do curador', quantidade: 1, origem: 'logica' });
      if (p?.canceladoEm) r.push({ grupo: 'cancelamento registrado', quantidade: 1, origem: 'logica' });
    }
    return r;
  }

  async gravarSgh<T>(
    c: ContextoRelatorio,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorRelatorio) => Promise<T>,
  ) {
    const h = c.hospital;
    const agora = (await this.relogio()).agora;
    const g: GravadorRelatorio = {
      gravarPropostas: async (p) => {
        const t = this.daTriagem(h);
        let incluidas = 0;
        let atualizadas = 0;
        let preservadas = 0;
        for (const x of p) {
          const ja = t.get(x.id);
          if (ja?.situacao === 'confirmada') {
            preservadas++;
            continue;
          }
          if (ja) atualizadas++;
          else incluidas++;
          t.set(x.id, {
            id: x.id,
            nome: x.nome,
            modulo: x.modulo,
            destino: x.destino,
            marco: x.marco,
            artefato: x.artefato,
            papelDono: x.papelDono,
            onda: x.onda,
            situacao: 'proposta',
            regra: x.regra,
            motivo: x.motivo,
            decididoPor: null,
            decididoEm: null,
            parametros: ja?.parametros ?? 0,
            acessoRestrito: ja?.acessoRestrito ?? false,
          });
        }
        return { incluidas, atualizadas, preservadas };
      },
      decidirTriagem: async (id, d, usuario) => {
        const t = this.daTriagem(h);
        const x = t.get(id);
        if (!x) return 0;
        // A área aceita; a decisão só passa a ser dela se mudar o destino (a mesma regra da porta própria).
        const mudou =
          x.decididoEm === null ||
          x.destino !== d.destino ||
          x.marco !== d.marco ||
          x.artefato !== d.artefato;
        t.set(id, {
          ...x,
          ...d,
          situacao: 'confirmada',
          decididoPor: mudou ? usuario : x.decididoPor,
          decididoEm: mudou ? agora.toISOString() : x.decididoEm,
          aceitoPor: usuario,
          aceitoEm: agora.toISOString(),
        });
        return 1;
      },
      criarAgendamento: async (a, usuario, proximo) => {
        const id = String(++this.seq);
        this.agendas.set(`${h}:${id}`, {
          ...a,
          id,
          hospital: h,
          ativo: true,
          dono: usuario,
          proximoEnvio: proximo,
          ultimoEnvio: null,
          ultimaSituacao: null,
          ultimaFalha: null,
          falhasSeguidas: 0,
        });
        return id;
      },
      alterarAgendamento: async (id, a, _u, proximo, versao) => {
        const x = this.agendas.get(`${h}:${id}`);
        if (!x) return 0;
        conferirVersao(x.versao, versao);
        this.agendas.set(`${h}:${id}`, { ...x, ...a, proximoEnvio: proximo, versao: (x.versao ?? 1) + 1 });
        return 1;
      },
      registrarResultadoEnvio: async (id, r) => {
        const x = this.agendas.get(`${h}:${id}`);
        if (!x) return 0;
        this.agendas.set(`${h}:${id}`, {
          ...x,
          ultimoEnvio: agora,
          ultimaSituacao: r.situacao,
          ultimaFalha: r.falha,
          falhasSeguidas: r.falhasSeguidas,
          proximoEnvio: r.proximoEnvio,
        });
        return 1;
      },
      registrarExecucao: async (x) => {
        const id = String(++this.seq);
        this.execs.push({
          id,
          hospital: h,
          relatorio: x.relatorio,
          tipo: x.tipo,
          formato: x.formato,
          usuario: x.usuario,
          linhas: x.linhas,
          duracaoMs: Math.round(x.duracaoMs),
          dadoPessoal: x.dadoPessoal,
          mascarado: x.mascarado,
          temJustificativa: x.justificativa !== null,
          situacao: x.situacao,
          criadoEm: agora,
          agendamento: x.agendamento ?? null,
        });
        return id;
      },
      criarPedido: async (p, usuario) => {
        const id = String(++this.seq);
        this.peds.set(id, {
          ...p,
          id,
          hospital: h,
          solicitante: usuario,
          situacao: 'aberto',
          relatorio: null,
          resposta: null,
          respondidoPor: null,
          respondidoEm: null,
          criadoEm: agora,
          canceladoEm: null,
          canceladoPor: null,
          motivoCancelamento: null,
        });
        return id;
      },
      responderPedido: async (id, r, usuario, versao) => {
        const x = this.peds.get(id);
        if (x && x.hospital === h) conferirVersao(x.versao, versao);
        if (!x || x.hospital !== h || !['aberto', 'em-analise'].includes(x.situacao) || x.canceladoEm)
          return 0;
        this.peds.set(id, {
          ...x,
          ...r,
          respondidoPor: usuario,
          respondidoEm: agora,
          versao: (x.versao ?? 1) + 1,
        });
        return 1;
      },
      lerPedidoTravado: async (id) => {
        const x = this.peds.get(id);
        return x && x.hospital === h ? { ...x } : null;
      },
      lerAgendamentoTravado: async (id) => {
        const x = this.agendas.get(`${h}:${id}`);
        return x ? { ...x } : null;
      },
      alterarPedido: async (id, p, _u, versao) => {
        const x = this.peds.get(id);
        if (x && x.hospital === h) conferirVersao(x.versao, versao);
        if (!x || x.hospital !== h || x.situacao !== 'aberto' || x.respondidoEm || x.canceladoEm) return 0;
        this.peds.set(id, { ...x, ...p, versao: (x.versao ?? 1) + 1 });
        return 1;
      },
      cancelarPedido: async (id, motivo, usuario, versao) => {
        const x = this.peds.get(id);
        if (x && x.hospital === h) conferirVersao(x.versao, versao);
        if (!x || x.hospital !== h || !['aberto', 'em-analise'].includes(x.situacao) || x.canceladoEm)
          return 0;
        this.peds.set(id, {
          ...x,
          canceladoEm: agora,
          canceladoPor: usuario,
          motivoCancelamento: motivo,
          versao: (x.versao ?? 1) + 1,
        });
        return 1;
      },
      excluirPedido: async (id) => {
        const x = this.peds.get(id);
        if (!x || x.hospital !== h || x.situacao !== 'aberto' || x.respondidoEm || x.canceladoEm) return 0;
        this.peds.delete(id);
        return 1;
      },
      excluirAgendamento: async (id) => {
        const x = this.agendas.get(`${h}:${id}`);
        if (!x || x.ultimoEnvio || this.execs.some((e) => e.hospital === h && e.agendamento === id)) return 0;
        this.agendas.delete(`${h}:${id}`);
        return 1;
      },
      registrarEvento: async (ev, usuario) => {
        this.eventosRel.push({
          hospital: h,
          alvo: ev.alvo,
          id: ev.id,
          evento: ev.evento,
          motivo: ev.motivo,
          por: usuario,
          em: agora,
          antes: ev.antes === null || ev.antes === undefined ? null : JSON.stringify(ev.antes),
        });
        return String(++this.seq);
      },
    };
    const r = await fn(g);
    const l = typeof trilha === 'function' ? trilha(r) : trilha;
    const d = (l.dadosDepois ?? {}) as Record<string, unknown>;
    await registrarNaTrilha(
      this.trilha,
      typeof d['evento'] === 'string'
        ? {
            evento: d['evento'],
            rede: c.rede,
            hospital: c.hospital,
            usuario: String(c.usuario ?? ''),
            estacao: typeof d['estacao'] === 'string' ? d['estacao'] : null,
            correlacao: String(d['operacao'] ?? l.correlacao ?? ''),
            recurso: String(d['recurso'] ?? ''),
            tabelaAlvo: l.entidade,
            idAlvo: l.entidadeId === null ? '' : String(l.entidadeId),
          }
        : null,
    );
    return r;
  }
}
