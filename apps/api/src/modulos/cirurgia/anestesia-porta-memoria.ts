// Porta da anestesia EM MEMÓRIA (M46, etapa 1): a sessão sintética de dev/ci (E2E) lê o agendamento da porta do centro
// cirúrgico em memória (M18) e grava a APA, a ficha anestésica e a SRPA SINTÉTICAS, com as mesmas recusas das receitas
// (a versão vista, a ficha que mudou, a chave do pedido de outro registro, a admissão e a alta uma vez só, o fim só do
// que fica aberto, o adendo só na ficha assinada). Nada vai à cópia. Os domínios são os de um estabelecimento
// sintético (a função "Anestesista" pelo nome, como no banco). Nenhum nome aqui é de pessoa real.
import type {
  AberturaFicha,
  AvaliacaoPreAnestesica,
  AvaliacaoRecuperacao,
  ContextoAnestesia,
  DominiosFicha,
  FichaAnestesica,
  LancamentoDaFicha,
  LancamentoFicha,
  LoteFicha,
  RegistroApa,
  RegistroSrpa,
} from './tipos.js';
import { recusa } from '@sgh/nucleo';
import type { MarcoFicha, SituacaoFicha } from '@sgh/contratos';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import type { GravadorAnestesia, PortaAnestesia, ProfissionalDaSessao } from './anestesia-porta.js';
import type { PortaCirurgia } from './porta.js';

const M = 'SINTETICO';
const d = (id: number, rotulo: string, sigla: string | null = null) => ({ id, rotulo, sigla, ativo: true });

export const DOMINIOS_ANESTESIA_SINTETICOS: DominiosFicha = {
  tiposAnestesia: [d(1, 'Geral'), d(2, 'Raquidiana'), d(3, 'Local'), d(4, 'Sedação')],
  posicoes: [d(1, 'Decúbito dorsal'), d(2, 'Decúbito ventral'), d(3, 'Litotomia')],
  modosRespiratorios: [d(1, 'Espontânea', 'E'), d(2, 'Assistida', 'A'), d(3, 'Controlada', 'C')],
  funcoesEquipe: [d(1, 'Cirurgião'), d(2, 'Auxiliar'), d(6, 'Anestesista'), d(7, 'Circulante')],
  tiposSinal: [
    d(1, 'Frequência cardíaca', 'FC'),
    d(2, 'Pressão sistólica', 'PAS'),
    d(3, 'Pressão diastólica', 'PAD'),
  ],
  utilizacoes: [d(1, 'Bomba de infusão'), d(2, 'Medicamentos'), d(3, 'Ambos')],
};

/**
 * Os registros profissionais dos logins sintéticos do bloco: o anestesista do agendamento sintético (5002),
 * um segundo anestesista para a passagem (5006) e o cirurgião (5001), que tem a opção da ficha e não é anestesista.
 */
export const PROFISSIONAIS_ANESTESIA_SINTETICOS: Readonly<Record<string, ProfissionalDaSessao>> = {
  'SINT.ANESTESISTA': { nome: `ANESTESISTA ${M} B`, registros: [5002] },
  'SINT.ANESTESISTA2': { nome: `ANESTESISTA ${M} F`, registros: [5006] },
  'SINT.CIRURGIAO': { nome: `CIRURGIAO ${M} A`, registros: [5001] },
  'SINT.ENF.BLOCO': { nome: `ENFERMEIRA ${M} BLOCO`, registros: [5007] },
  /** Revisão do M46.1 (regra 3): o instrumentador (5004, não médico) com a opção de assinar no perfil. */
  'SINT.INSTRUMENTADOR': { nome: `INSTRUMENTADOR ${M} D`, registros: [5004] },
};

type Mut<T> = { -readonly [K in keyof T]: T[K] };
interface Estado {
  apas: (AvaliacaoPreAnestesica & { chave: string | null })[];
  fichas: (Mut<Omit<FichaAnestesica, 'lancamentos' | 'passagens' | 'lacunas' | 'adendos'>> & {
    lancamentos: (Mut<LancamentoDaFicha> & { chave: string | null })[];
    passagens: (FichaAnestesica['passagens'][number] & { chave: string | null })[];
    lacunas: (FichaAnestesica['lacunas'][number] & { chave: string | null })[];
    adendos: (FichaAnestesica['adendos'][number] & { chave: string | null })[];
  })[];
  srpa: (AvaliacaoRecuperacao & { chave: string | null; chaveMomento: string | null })[];
  seq: number;
}

const agoraLocal = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 16);

function dadosDe(l: LancamentoFicha): Record<string, string | number | null> {
  const r: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(l)) {
    if (k === 'parte' || k === 'momento' || k === 'fim' || k === 'balanco') continue;
    r[k] = typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null);
  }
  return r;
}

export class PortaAnestesiaMemoria implements PortaAnestesia {
  readonly destino = 'memoria' as const;
  private readonly porHospital = new Map<string, Estado>();

  constructor(private readonly cirurgia: PortaCirurgia) {}

  private e(c: ContextoPortaM18): Estado {
    let s = this.porHospital.get(String(c.estabelecimento ?? 0));
    if (!s) {
      s = { apas: [], fichas: [], srpa: [], seq: 46_000 };
      this.porHospital.set(String(c.estabelecimento ?? 0), s);
    }
    return s;
  }

  /**
   * Só para teste (revisão do M46.1, regra 3): uma passagem já gravada para quem não é médico, como uma linha antiga ou
   * de outro caminho, sem as conferências da API.
   */
  semearPassagem(agendamento: number, de: number, para: number, momento: string): void {
    for (const e of this.porHospital.values())
      for (const f of e.fichas)
        if (f.agendamento === agendamento)
          f.passagens.push({
            id: ++e.seq,
            momento,
            de,
            para,
            resumo: 'Passagem semeada.',
            usuario: 'TESTE',
            chave: null,
          });
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  executar(): never {
    throw new Error('A anestesia grava só no novo (sem receita do executor).');
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    _trilha: unknown,
    fn: (g: GravadorAnestesia) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    // Transação em memória: a cópia do estado é a "transação"; a recusa no meio não deixa nada gravado.
    const copia: Estado = structuredClone(s);
    const r = await fn(this.gravador(copia, c));
    Object.assign(s, copia);
    return r;
  }

  private gravador(s: Estado, c: ContextoPortaM18): GravadorAnestesia {
    const prox = () => ++s.seq;
    const ficha = (id: number) => {
      const f = s.fichas.find((x) => x.id === id);
      if (!f) throw recusa('ficha-sem-ficha', 'A ficha não existe.');
      return f;
    };
    const ler = (agendamento: number): FichaAnestesica | null => {
      const f = s.fichas.find((x) => x.agendamento === agendamento);
      return f ? structuredClone(f) : null;
    };
    return {
      agendamentoNaTransacao: async (agendamento) => {
        const a = await this.cirurgia.agendamento(c, agendamento);
        const e = (await this.cirurgia.estadosDosAgendamentos(c, [agendamento])).get(agendamento);
        return { existe: a !== null && a !== undefined, estado: e?.estado ?? null };
      },
      registrarApa: async (a: Omit<RegistroApa, 'hospital'>) => {
        const ja = a.chave ? s.apas.find((x) => x.chave === a.chave) : undefined;
        if (ja) {
          if (ja.agendamento !== a.agendamento)
            throw recusa('chave-reutilizada', 'A chave do pedido já foi usada em outro agendamento.');
          return { id: ja.id, versao: ja.versao, repetida: true, pendencias: [] };
        }
        const vigente = Math.max(
          0,
          ...s.apas.filter((x) => x.agendamento === a.agendamento).map((x) => x.versao),
        );
        if (vigente !== a.versaoVista)
          throw recusa('apa-mudou', 'Outra avaliação pré-anestésica foi registrada depois que a tela abriu.');
        const id = prox();
        s.apas.push({
          id,
          agendamento: a.agendamento,
          versao: vigente + 1,
          avaliadoEm: a.avaliadoEm.slice(0, 16),
          profissional: a.profissional,
          asa: a.asa,
          emergencia: a.emergencia,
          pesoKg: a.pesoKg,
          alturaCm: a.alturaCm,
          viaAerea: a.viaAerea as Record<string, unknown>,
          jejum: a.jejum as Record<string, string | null>,
          criteriosLee: [...a.criteriosLee],
          leePontos: a.leePontos,
          alergiasConferidas: a.alergiasConferidas,
          comorbidades: a.comorbidades,
          medicacoes: a.medicacoes,
          exames: a.exames,
          anestesiasAnteriores: a.anestesiasAnteriores,
          plano: a.plano as Record<string, unknown>,
          tipoAnestesia: a.tipoAnestesia,
          conclusao: a.conclusao,
          ressalvas: a.ressalvas,
          registroProntuario: null,
          usuario: a.usuario,
          criadoEm: agoraLocal(),
          chave: a.chave,
        });
        return { id, versao: vigente + 1, repetida: false, pendencias: [...a.pendencias] };
      },
      ficha: async (agendamento) => ler(agendamento),
      abrirFicha: async (f: Omit<AberturaFicha, 'hospital'>) => {
        const ja = s.fichas.find((x) => x.agendamento === f.agendamento);
        if (ja) return { id: ja.id, versao: ja.versao, nova: false };
        const id = prox();
        s.fichas.push({
          id,
          agendamento: f.agendamento,
          sala: f.sala,
          dataHora: f.dataHora,
          reg: f.reg,
          paciente: f.paciente,
          situacao: 'aberta',
          versao: 1,
          abertura: f.abertura,
          abertaEm: f.abertaEm.slice(0, 16),
          marcos: {},
          assinadaPor: null,
          assinadaUsuario: null,
          assinadaEm: null,
          hash: null,
          registroProntuario: null,
          lancamentos: [],
          passagens: [],
          lacunas: [],
          adendos: [],
          truncado: false,
        });
        return { id, versao: 1, nova: true };
      },
      subirVersao: async (v: {
        ficha: number;
        versaoVista: number;
        marco?: { marco: MarcoFicha; momento: string };
        situacao?: SituacaoFicha;
      }) => {
        const f = ficha(v.ficha);
        if (f.versao !== v.versaoVista || f.situacao === 'assinada')
          throw recusa('ficha-mudou', 'A ficha mudou em outro aparelho depois que você a abriu.');
        f.versao++;
        if (v.marco) f.marcos = { ...f.marcos, [v.marco.marco]: v.marco.momento.slice(0, 16) };
        if (v.situacao) f.situacao = v.situacao;
        return f.versao;
      },
      lancar: async (l: Omit<LoteFicha, 'hospital'>) => {
        const f = ficha(l.ficha);
        const ids: number[] = [];
        let repetida = false;
        let noBalanco = 0;
        for (const [i, x] of l.lancamentos.entries()) {
          const chave = l.chave ? `${l.chave}:${i}` : null;
          const ja = chave
            ? s.fichas.flatMap((y) => y.lancamentos.map((z) => ({ y, z }))).find((p) => p.z.chave === chave)
            : undefined;
          if (ja) {
            if (ja.y.id !== f.id)
              throw recusa('chave-reutilizada', 'A chave do pedido já foi usada em outra ficha.');
            ids.push(ja.z.id);
            repetida = true;
            continue;
          }
          const id = prox();
          const vai = (x.parte === 'fluido' || x.parte === 'perda') && x.balanco !== null;
          if (vai) noBalanco++;
          f.lancamentos.push({
            id,
            parte: x.parte,
            momento: x.momento.slice(0, 16),
            fim: 'fim' in x && x.fim ? x.fim.slice(0, 16) : null,
            dados: dadosDe(x),
            profissional: l.profissional,
            usuario: l.usuario,
            registradoEm: agoraLocal(),
            balanco: vai ? { id: prox(), em: agoraLocal() } : null,
            chave,
          });
          ids.push(id);
        }
        return { ids, repetida, noBalanco };
      },
      encerrar: async (x) => {
        const f = ficha(x.ficha);
        const l = f.lancamentos.find((y) => y.id === x.lancamento);
        const pode =
          l &&
          !l.fim &&
          l.momento <= x.fim.slice(0, 16) &&
          (['gas', 'fluido', 'evento', 'bi', 'procedimento'].includes(l.parte) ||
            (l.parte === 'medicamento' && l.dados['continua'] === 1));
        if (!pode)
          throw recusa(
            'ficha-lancamento-sem-fim',
            'O lançamento não existe nesta ficha, já tem o fim, ou o fim é anterior.',
          );
        l.fim = x.fim.slice(0, 16);
        return { tabela: 'MEMORIA' };
      },
      passar: async (p) => {
        const f = ficha(p.ficha);
        const ja = p.chave ? f.passagens.find((y) => y.chave === p.chave) : undefined;
        if (ja) return { id: ja.id, repetida: true };
        const id = prox();
        f.passagens.push({
          id,
          momento: p.momento.slice(0, 16),
          de: p.de,
          para: p.para,
          resumo: p.resumo,
          usuario: p.usuario,
          chave: p.chave,
        });
        return { id, repetida: false };
      },
      justificar: async (j) => {
        const f = ficha(j.ficha);
        const ja = j.chave ? f.lacunas.find((y) => y.chave === j.chave) : undefined;
        if (ja) return { id: ja.id, repetida: true };
        const id = prox();
        f.lacunas.push({
          id,
          inicio: j.inicio.slice(0, 16),
          fim: j.fim.slice(0, 16),
          motivo: j.motivo,
          usuario: j.usuario,
          chave: j.chave,
        });
        return { id, repetida: false };
      },
      assinar: async (a) => {
        const f = ficha(a.ficha);
        if (f.versao !== a.versaoVista || f.situacao !== 'encerrada')
          throw recusa(
            'ficha-mudou',
            'A ficha mudou (ou não está aguardando assinatura) depois que você a conferiu.',
          );
        f.situacao = 'assinada';
        f.assinadaPor = a.profissional;
        f.assinadaUsuario = a.usuario;
        f.assinadaEm = agoraLocal();
        f.hash = a.hash;
        f.versao++;
        return { versao: f.versao };
      },
      adendo: async (a) => {
        const f = ficha(a.ficha);
        if (f.situacao !== 'assinada')
          throw recusa('ficha-nao-assinada', 'O adendo vale só para a ficha já assinada.');
        const ja = a.chave ? f.adendos.find((y) => y.chave === a.chave) : undefined;
        if (ja) return { id: ja.id, repetida: true };
        const id = prox();
        f.adendos.push({
          id,
          texto: a.texto,
          profissional: a.profissional,
          usuario: a.usuario,
          em: agoraLocal(),
          chave: a.chave,
        });
        return { id, repetida: false };
      },
      srpa: async (agendamento) => structuredClone(s.srpa.filter((x) => x.agendamento === agendamento)),
      registrarSrpa: async (x: Omit<RegistroSrpa, 'hospital'>) => {
        const ja = x.chave ? s.srpa.find((y) => y.chave === x.chave) : undefined;
        if (ja) {
          if (ja.agendamento !== x.agendamento)
            throw recusa('chave-reutilizada', 'A chave do pedido já foi usada.');
          return { id: ja.id, repetida: true };
        }
        const doPaciente = s.srpa.filter((y) => y.agendamento === x.agendamento);
        if (Math.max(0, ...doPaciente.map((y) => y.id)) !== x.ultimaVista)
          throw recusa('srpa-mudou', 'Outra avaliação foi registrada depois que a tela abriu.');
        const chaveMomento = x.momento === 'avaliacao' ? null : `${x.agendamento}:${x.momento}`;
        if (chaveMomento && s.srpa.some((y) => y.chaveMomento === chaveMomento))
          throw recusa(x.momento === 'alta' ? 'srpa-ja-com-alta' : 'srpa-fora-de-ordem', 'Já registrado.');
        const id = prox();
        const a = x.aldrete;
        s.srpa.push({
          id,
          agendamento: x.agendamento,
          sala: x.sala,
          momento: x.momento,
          em: x.em.slice(0, 16),
          aldrete: { ...a },
          total: a.atividade + a.respiracao + a.circulacao + a.consciencia + a.saturacao,
          dor: x.dor,
          nvpo: x.nvpo,
          destino: x.momento === 'alta' ? x.destino : null,
          regraVersao: x.momento === 'alta' ? x.regraVersao : null,
          profissional: x.profissional,
          usuario: x.usuario,
          chave: x.chave,
          chaveMomento,
        });
        return { id, repetida: false };
      },
    };
  }

  async dominios() {
    return structuredClone(DOMINIOS_ANESTESIA_SINTETICOS);
  }

  async contexto(c: ContextoPortaM18, agendamento: number): Promise<ContextoAnestesia | null> {
    const a = await this.cirurgia.agendamento(c, agendamento);
    if (!a) return null;
    const p = await this.cirurgia.pacientePorProntuario(c, a.prontuario);
    const anest = a.pares['ID_ANEST'] ?? null;
    return {
      agendamento: a.id,
      reg: a.reg,
      atendimento: a.reg > 0 ? 80_000 + a.reg : null,
      paciente: p?.id ?? null,
      sala: a.sala,
      inicio: a.inicio,
      procedimento: a.procedimento,
      tipoAnestesiaAgendado: a.anestesia > 0 ? a.anestesia : null,
      anestesistaAgendado: anest !== null && anest !== 1 && anest !== 488 ? anest : null,
      alergias: [{ alergia: 1, nome: `DIPIRONA ${M}` }],
      pesoKg: 72,
      alturaCm: 168,
      creatinina: 1.1,
      exames: [{ id: 1, exame: `HEMOGRAMA ${M}`, data: a.inicio.slice(0, 10), liberado: true }],
      examesTruncado: false,
      medicacoes: [`LOSARTANA ${M}`],
      medicacoesTruncado: false,
    };
  }

  async profissional(_c: ContextoPortaM18, login: string): Promise<ProfissionalDaSessao | null> {
    return PROFISSIONAIS_ANESTESIA_SINTETICOS[login.toUpperCase()] ?? null;
  }

  async apas(c: ContextoPortaM18, agendamento: number) {
    return structuredClone(this.e(c).apas.filter((x) => x.agendamento === agendamento)).sort(
      (a, b) => b.versao - a.versao,
    );
  }

  async ficha(c: ContextoPortaM18, agendamento: number) {
    const f = this.e(c).fichas.find((x) => x.agendamento === agendamento);
    return f ? (structuredClone(f) as FichaAnestesica) : null;
  }

  async srpa(c: ContextoPortaM18, agendamento: number) {
    return structuredClone(this.e(c).srpa.filter((x) => x.agendamento === agendamento));
  }

  async quadroSrpa(c: ContextoPortaM18, desde: string) {
    const s = this.e(c);
    const agendas = s.srpa
      .filter((x) => x.momento === 'admissao' && x.em.slice(0, 10) >= desde)
      .map((x) => x.agendamento)
      .filter((a) => !s.srpa.some((y) => y.agendamento === a && y.momento === 'alta'));
    return {
      series: agendas.map((a) => structuredClone(s.srpa.filter((x) => x.agendamento === a))),
      truncado: false,
    };
  }

  async situacoes(c: ContextoPortaM18, agendamentos: readonly number[]) {
    const s = this.e(c);
    return new Map(
      agendamentos.map((a) => {
        const apa = s.apas.filter((x) => x.agendamento === a).sort((x, y) => y.versao - x.versao)[0];
        const f = s.fichas.find((x) => x.agendamento === a);
        const sr = s.srpa.filter((x) => x.agendamento === a).at(-1);
        return [a, { apa: apa?.conclusao ?? null, ficha: f?.situacao ?? null, srpa: sr?.momento ?? null }];
      }),
    );
  }
}
