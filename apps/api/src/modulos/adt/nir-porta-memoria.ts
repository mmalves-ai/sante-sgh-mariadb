// Porta do NIR em MEMÓRIA (M44, etapa 2): a sessão sintética de dev/ci (E2E), sobre o estado compartilhado com a
// internação em memória (EstadoNirMemoria) e as internações sintéticas da porta do M21. Mesmas recusas das SGH_. Sem o
// `worker`, a reserva vencida expira na leitura, com o evento na trilha (a mesma regra do `worker`). A calibragem usa um
// histograma SINTÉTICO fixo (sem banco); as cirurgias que pedem UTI são UMA sintética, amanhã às 8h, do paciente
// sintético 1006 do cadastro em memória (para o atalho "Pedir o leito" da fila).
import { DEPARA_SITUACAO_REGULACAO, EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import type {
  ConfiguracaoRegulacaoLida,
  HistogramasLidos,
  InternadoQuadroLido,
  LiberacaoConsultada,
  PacienteLido,
  RegulacaoLida,
} from '@sgh/legado';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoAdt, PortaAdt } from './porta.js';
import type { EstadoNirMemoria } from './nir-memoria.js';
import type { ContextoNir, GravadorNir, PortaNir } from './nir-porta.js';

/** A cópia sem os campos internos do estado em memória (marca de aberta, vigência, sucessão). */
function sem<T extends object, K extends keyof T>(o: T, ...ks: K[]): Omit<T, K> {
  const r = { ...o };
  for (const k of ks) delete r[k];
  return r;
}

/** A cirurgia sintética que pede leito de UTI (agendamento fora da faixa do bloco sintético). */
export const CIRURGIA_UTI_SINTETICA = { agendamento: 990_446, paciente: 1006, sala: 1 } as const;

/** A configuração de regulação do fornecedor anterior como a cópia pc tem (só a forma; descrições sintéticas). */
const CONFIGURACAO_REGULACAO_SINTETICA: ConfiguracaoRegulacaoLida = {
  sistemas: [
    { id: 1, sigla: 'SISTEMA A', ativo: true, servicos: 21, servicosAtivos: 21 },
    { id: 2, sigla: 'SISTEMA B', ativo: false, servicos: 21, servicosAtivos: 0 },
  ],
  endpoints: [
    { id: 1, servico: null, descricao: 'Autenticação', metodo: 'POST' },
    { id: 2, servico: null, descricao: 'Envio de solicitação', metodo: 'POST' },
    { id: 3, servico: null, descricao: 'Consulta de situação', metodo: 'GET' },
  ],
  tabelas: [
    { id: 1, descricao: 'Tipo de leito', ativo: true, referencia: null, valores: 18 },
    { id: 2, descricao: 'Especialidade', ativo: true, referencia: null, valores: 40 },
  ],
};

export class PortaNirMemoria implements PortaNir {
  readonly destino = 'memoria' as const;
  /** M44 (etapa 3): os registros de regulação por estabelecimento (só inclusão, com a sucessão única). */
  private readonly regs = new Map<string, (RegulacaoLida & { sucede: string })[]>();
  private seqRegulacao = 880_000;

  constructor(
    private readonly estado: EstadoNirMemoria,
    private readonly adt: PortaAdt,
    private readonly trilha: Pick<RegistradorTrilha, 'registrar'> | null = null,
    private readonly lerPacientes:
      ((c: ContextoNir, ids: readonly number[]) => Promise<PacienteLido[]>) | null = null,
  ) {}

  private expirar(c: ContextoNir): void {
    for (const r of this.estado.expirarVencidas(c.hospital))
      void this.trilha
        ?.registrar({
          evento: EVENTOS_AUDITAVEIS.nirReservaExpirada.codigo,
          rede: c.rede,
          hospital: c.hospital,
          usuario: 'SGH.NIR',
          estacao: 'SGH-MEMORIA:nir',
          correlacao: `nir.reserva.expira:${c.hospital}:${r.id}`.slice(0, 64),
          recurso: 'internacao.reservaLeito',
          resultado: 'sucesso',
          tabelaAlvo: 'MEMORIA',
          idAlvo: String(r.id),
        })
        .catch(() => undefined);
  }

  async podeGravar(): Promise<LiberacaoConsultada> {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<never> {
    throw new Error(
      'O NIR não grava pelo executor: a admissão e a transferência vão pela porta da internação.',
    );
  }

  async gravarSgh<T>(c: ContextoNir, _trilha: unknown, fn: (g: GravadorNir) => Promise<T>): Promise<T> {
    const e = this.estado;
    const h = c.hospital;
    const paciente = async (id: number) => {
      const [p] = (await this.lerPacientes?.(c, [id])) ?? [];
      return {
        nome: p?.nomeSocial ?? p?.nome ?? `PACIENTE SINTETICO ${id}`,
        sexo: p?.sexo ?? null,
        nascimento: p?.nascimento ?? null,
        prontuario: p?.prontuario ?? null,
      };
    };
    return fn({
      solicitar: async (x) => e.solicitar(h, { ...x, ...(await paciente(x.paciente)) }),
      transicionar: async (x) => e.transicionar(h, x),
      reservar: async (x) => e.reservar(h, x),
      confirmarReserva: async (x) => e.confirmar(h, x),
      encerrarReserva: async (x) => e.encerrar(h, x),
      registrarDpa: async (x) => e.registrarDpa(h, x),
      registrarBarreira: async (x) => e.registrarBarreira(h, x),
      resolverBarreira: async (x) => e.resolverBarreira(h, x),
      gravarLimite: async (x) => e.gravarLimite(h, x),
      aprovarDepara: async (x) => e.aprovarDepara(h, x),
      registrarEvento: async () => undefined,
      corrigirSolicitacao: async (x) => e.corrigir(h, x),
      excluirSolicitacao: async (x) =>
        e.excluirSolicitacao(
          h,
          x,
          (this.regs.get(h) ?? []).filter((r) => r.solicitacao === x.solicitacao).length,
        ),
      alterarReserva: async (x) => e.alterarReserva(h, x),
      excluirReserva: async (x) => e.excluirReserva(h, x),
      retirarDpa: async (x) => e.retirarDpa(h, x),
      alterarBarreira: async (x) => e.alterarBarreira(h, x),
      removerLimite: async (x) => e.removerLimite(h, x),
      registrarRegulacao: async (x) => {
        const lista = this.regs.get(h) ?? [];
        if (!e.h(h).solicitacoes.has(x.solicitacao))
          throw recusaMemoria('solicitacao-inexistente', 'A solicitação de leito não existe.');
        if (
          lista.some(
            (r) => r.central === x.central && r.numero === x.numero && r.solicitacao !== x.solicitacao,
          )
        )
          throw recusaMemoria(
            'numero-em-uso',
            'Este número de regulação já está ligado a outra solicitação de leito.',
          );
        const sucede = x.anterior === null ? `inicial:${x.solicitacao}` : `apos:${x.anterior}`;
        if (lista.some((r) => r.sucede === sucede))
          throw recusaMemoria(
            'regulacao-desatualizada',
            'A regulação desta solicitação mudou depois que você abriu (outra pessoa registrou). Abra de novo.',
          );
        const id = ++this.seqRegulacao;
        lista.push({
          id,
          solicitacao: x.solicitacao,
          central: x.central,
          sentido: x.sentido,
          numero: x.numero,
          situacao: x.situacao,
          origem: x.origem,
          observacao: x.observacao,
          anterior: x.anterior,
          mensagemHash: x.mensagemHash,
          por: x.por,
          em: e.agora(),
          sucede,
        });
        this.regs.set(h, lista);
        return { id, outbox: x.outbox ? `memoria:${id}` : null };
      },
    });
  }

  async relogio(): Promise<{ agora: string; hoje: string }> {
    const agora = this.estado.agora();
    return { agora, hoje: agora.slice(0, 10) };
  }

  async abertas(c: ContextoNir) {
    this.expirar(c);
    const s = this.estado.h(c.hospital);
    const itens = [...s.solicitacoes.values()].filter((x) => x.ativa !== null).map((x) => sem(x, 'ativa'));
    return { itens, cortada: false };
  }

  async solicitacao(c: ContextoNir, id: number) {
    this.expirar(c);
    const x = this.estado.h(c.hospital).solicitacoes.get(id);
    if (!x) return null;
    return sem(x, 'ativa');
  }

  async eventos(c: ContextoNir, ids: readonly number[]) {
    const quer = new Set(ids);
    return this.estado
      .h(c.hospital)
      .eventos.filter((x) => quer.has(x.solicitacao))
      .map((x) => sem(x, 'id'));
  }

  async concluidas(c: ContextoNir, desde: string) {
    return [...this.estado.h(c.hospital).solicitacoes.values()]
      .filter((x) => x.estado === 'internado' && x.concluidoEm && x.solicitadoEm.slice(0, 10) >= desde)
      .map((x) => ({
        solicitadoEm: x.solicitadoEm,
        internadoEm: x.concluidoEm as string,
        prazoEm: x.prazoEm,
      }));
  }

  async reservasVigentes(c: ContextoNir) {
    this.expirar(c);
    return [...this.estado.h(c.hospital).reservas.values()]
      .filter((x) => x.vigente !== null)
      .map((x) => sem(x, 'vigente', 'regConsumo'));
  }

  async reservasEncerradas(c: ContextoNir) {
    return [...this.estado.h(c.hospital).reservas.values()]
      .filter((x) => x.vigente === null)
      .reverse()
      .slice(0, 50)
      .map((x) => sem(x, 'vigente', 'regConsumo'));
  }

  async cirurgiasUti(c: ContextoNir) {
    const [p] = (await this.lerPacientes?.(c, [CIRURGIA_UTI_SINTETICA.paciente])) ?? [];
    if (!p) return [];
    const amanha = new Date(Date.parse(`${this.estado.agora().slice(0, 10)}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    return [
      {
        agendamento: CIRURGIA_UTI_SINTETICA.agendamento,
        paciente: p.id,
        nome: p.nome,
        dataHora: `${amanha}T08:00:00`,
        sala: CIRURGIA_UTI_SINTETICA.sala,
      },
    ];
  }

  async cirurgiasComSolicitacao(c: ContextoNir, ids: readonly number[]) {
    const quer = new Set(ids);
    return new Set(
      [...this.estado.h(c.hospital).solicitacoes.values()]
        .filter((x) => x.ativa !== null && x.cirurgia !== null && quer.has(x.cirurgia))
        .map((x) => x.cirurgia as number),
    );
  }

  async internados(c: ContextoNir): Promise<{ itens: InternadoQuadroLido[]; cortada: boolean }> {
    const lista = await this.adt.internacoes(c as ContextoAdt, { intensivas: [], situacao: 'internados' });
    const itens: InternadoQuadroLido[] = [];
    for (const i of lista.itens) {
      const d = await this.adt.detalhe(c as ContextoAdt, i.reg, []);
      itens.push({
        reg: i.reg,
        pront: i.prontuario,
        paciente: i.paciente,
        nome: i.nome,
        bloco: i.leito.bloco,
        acomodacao: i.leito.acomodacao,
        leito: i.leito.leito,
        clinica: i.clinica,
        entrada: i.entrada,
        procedimento: d ? String(d.procedimento) : null,
        cid: d?.cid ?? null,
        trechos: (d?.trechos ?? []).map((t) => ({ tipo: t.tipo.codigo, entrada: t.entrada, saida: t.saida })),
      });
    }
    return { itens, cortada: lista.cortada };
  }

  async internacao(c: ContextoNir, reg: number) {
    const d = await this.adt.detalhe(c as ContextoAdt, reg, []).catch(() => null);
    return d ? { reg, pront: d.resumo.prontuario, internado: d.resumo.alta === null } : null;
  }

  async dpas(c: ContextoNir, regs: readonly number[]) {
    const quer = new Set(regs);
    return this.estado
      .h(c.hospital)
      .dpas.filter((x) => quer.has(x.reg))
      .map((x) => sem(x, 'sucede'));
  }

  async barreiras(c: ContextoNir, regs: readonly number[]) {
    const quer = new Set(regs);
    return [...this.estado.h(c.hospital).barreiras.values()].filter((x) => quer.has(x.reg));
  }

  async barreira(c: ContextoNir, id: number) {
    const x = this.estado.h(c.hospital).barreiras.get(id);
    return x ? { id, reg: x.reg, situacao: x.situacao } : null;
  }

  async limites(c: ContextoNir) {
    return [...this.estado.h(c.hospital).limites.values()];
  }

  async depara(c: ContextoNir) {
    return [...this.estado.h(c.hospital).depara.values()];
  }

  async situacoes() {
    return new Map(DEPARA_SITUACAO_REGULACAO.map((x) => [x.situacao, x.rotulo.toUpperCase()]));
  }

  /** Histograma SINTÉTICO fixo por clínica (a tela e o E2E mostram as duas réguas sem banco). */
  async histogramas(): Promise<HistogramasLidos> {
    const linhas = (ch: string, base: number) =>
      Array.from({ length: 10 }, (_, i) => ({ chave: ch, dias: i + 1, n: base + ((i * 7) % 5) }));
    const p312 = [...linhas('M', 6), ...linhas('C', 3)];
    return {
      portaria312: p312,
      diariasFaturaveis: p312.map((x) => ({ ...x, dias: x.dias + 1 })),
      uti: [
        { chave: 'M', dias: 0, n: 50 },
        { chave: 'M', dias: 2, n: 14 },
        { chave: 'C', dias: 0, n: 30 },
        { chave: 'C', dias: 1, n: 7 },
      ],
      nomes: new Map(),
    };
  }

  async regulacoes(c: ContextoNir, ids: readonly number[]) {
    const quer = new Set(ids);
    return (this.regs.get(c.hospital) ?? [])
      .filter((r) => quer.has(r.solicitacao))
      .map((r) => sem(r, 'sucede'));
  }

  async configuracaoRegulacao() {
    return CONFIGURACAO_REGULACAO_SINTETICA;
  }
}

function recusaMemoria(codigo: string, detalhe: string) {
  return new ErroProblema('recusa-de-negocio', 409, 'Não gravado', detalhe, { codigo });
}
