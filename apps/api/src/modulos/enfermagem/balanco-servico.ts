// Serviço do balanço hídrico (M45, etapa 3; regra 6): monta o balanço do paciente numa janela de 24 horas (a hora de
// corte da unidade do paciente; padrão 7 h) com os lançamentos, os ganhos da checagem e a diurese dos sinais ainda não
// lançados (pendentes), os horários sem volume, o cálculo com as parcelas e a impressão, os fechamentos e as janelas
// recentes. As regras são do domínio (@sgh/dominio-enfermagem); aqui só a leitura pela porta e a montagem.
import type {
  BalancoDoPaciente,
  CalculoBalanco,
  DominiosBalanco,
  FechamentoBalancoLido,
  LancamentoBalancoLido,
  PendenteBalanco,
  SemVolumeBalanco,
} from '@sgh/contratos';
import {
  calcularBalanco,
  comImpressao,
  diureseDosSinais,
  ErroHora,
  type FormulaInsensivel,
  ganhosDaChecagem,
  janelaDoInstante,
  janelaQueComecaEm,
  janelasRecentes,
  lancamentosVigentes,
  parcelasDoBalanco,
} from '@sgh/dominio-enfermagem';
import type { Internado } from './tipos.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoBalanco, PortaBalanco } from './balanco-porta.js';

export interface ParametrosBalanco {
  readonly horaCorte: string;
  readonly formula: FormulaInsensivel;
}

export interface BalancoMontado {
  readonly internado: Internado;
  /** A entrada da internação (nula sem a data). */
  readonly desde: string | null;
  readonly agora: string;
  readonly janela: { inicio: string; fim: string };
  readonly ate: string;
  readonly fechadas: Set<string>;
  readonly lancamentos: LancamentoBalancoLido[];
  readonly vigentes: LancamentoBalancoLido[];
  readonly pendentes: PendenteBalanco[];
  readonly semVolume: SemVolumeBalanco[];
  readonly calculo: CalculoBalanco;
  readonly fechamentos: FechamentoBalancoLido[];
  readonly dominios: DominiosBalanco;
  readonly peso: { valor: number; quando: string } | null;
  readonly cortada: boolean;
}

export class ServicoBalanco {
  constructor(private readonly porta: PortaBalanco) {}

  async internado(c: ContextoBalanco, atendimento: number): Promise<Internado> {
    const i = await this.porta.internado(c, atendimento);
    if (!i)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Internação não encontrada',
        'O atendimento não é de um paciente internado neste estabelecimento.',
      );
    return i;
  }

  /** A janela pedida (pelo início, na hora de corte) ou a em curso; a do futuro é recusada. */
  janela(agora: string, horaCorte: string, inicio: string | null): { inicio: string; fim: string } {
    try {
      const j = inicio ? janelaQueComecaEm(inicio, horaCorte) : janelaDoInstante(agora, horaCorte);
      if (j.inicio > agora.slice(0, 16))
        throw new ErroProblema('entrada-invalida', 400, 'Janela do balanço', 'A janela ainda não começou.');
      return j;
    } catch (x) {
      if (x instanceof ErroHora)
        throw new ErroProblema('entrada-invalida', 400, 'Janela do balanço', x.message, {
          campos: ['inicio'],
        });
      throw x;
    }
  }

  /**
   * O balanço do atendimento na janela, calculado até `ate` (o fim da janela ou agora; o parcial que a tela viu) e com
   * o peso informado (ou o último dos sinais vitais).
   */
  async montar(
    c: ContextoBalanco,
    o: {
      readonly internado: Internado;
      readonly desde?: string | null;
      readonly agora: string;
      readonly parametros: ParametrosBalanco;
      readonly inicio: string | null;
      readonly ate?: string | null;
      readonly pesoKg?: number | null;
    },
  ): Promise<BalancoMontado> {
    const agora = o.agora.slice(0, 16);
    const janela = this.janela(agora, o.parametros.horaCorte, o.inicio);
    const limite = agora < janela.fim ? agora : janela.fim;
    const ate = o.ate && o.ate.slice(0, 16) < limite ? o.ate.slice(0, 16) : limite;
    const a = o.internado.atendimento;
    const [fechamentos, dominios, lancs, chks, sinais] = await Promise.all([
      this.porta.fechamentos(c, a),
      this.porta.dominios(c),
      this.porta.lancamentos(c, { atendimento: a, de: janela.inicio, ate: janela.fim }),
      this.porta.checagens(c, { atendimento: a, de: janela.inicio, ate }),
      this.porta.sinais(c, { paciente: o.internado.paciente, de: janela.inicio, ate }),
    ]);
    const fechadas = new Set(fechamentos.filter((f) => f.tipo === 'total').map((f) => f.inicio));
    const fechada = fechadas.has(janela.inicio);
    const origens = await this.porta.origensLancadas(c, {
      horarios: chks.itens.map((x) => x.horario),
      sinais: sinais.diurese.map((x) => x.id),
    });
    // A janela fechada em 24 horas é um retrato: nada mais entra nela.
    const g = fechada
      ? { pendentes: [], semVolume: [] }
      : ganhosDaChecagem(chks.itens, origens.horarios, { inicio: janela.inicio, fim: ate });
    const diurese = fechada
      ? []
      : diureseDosSinais(sinais.diurese, origens.sinais, { inicio: janela.inicio, fim: ate });
    const pendentes = [...g.pendentes, ...diurese].sort(
      (x, y) => x.horaReal.localeCompare(y.horaReal) || x.referencia - y.referencia,
    );
    const vigentes = lancamentosVigentes(lancs.itens);
    const pesoKg = o.pesoKg ?? sinais.peso?.valor ?? null;
    const calculo = await comImpressao(
      calcularBalanco({
        inicio: janela.inicio,
        ate,
        parcelas: parcelasDoBalanco(vigentes, pendentes),
        pesoKg,
        temperaturaMaxima: sinais.temperaturaMaxima,
        formula: o.parametros.formula,
        dominios,
        ateInclusivo: ate < janela.fim,
      }),
    );
    return {
      internado: o.internado,
      desde: o.desde ?? null,
      agora,
      janela,
      ate,
      fechadas,
      lancamentos: lancs.itens,
      vigentes,
      pendentes,
      semVolume: g.semVolume,
      calculo,
      fechamentos,
      dominios,
      peso: sinais.peso,
      cortada: chks.cortada || lancs.cortada,
    };
  }

  /** A resposta da tela. */
  resposta(m: BalancoMontado, horaCorte: string, gravacao: BalancoDoPaciente['gravacao']): BalancoDoPaciente {
    const i = m.internado;
    return {
      atendimento: i.atendimento,
      paciente: i.paciente,
      numero: i.numero,
      nome: i.nome,
      leito: i.leito,
      unidade: i.unidade,
      agora: m.agora,
      horaCorte,
      internadoDesde: m.desde,
      janela: {
        ...m.janela,
        fechada: m.fechadas.has(m.janela.inicio),
        atual: m.janela.inicio === janelaDoInstante(m.agora, horaCorte).inicio,
      },
      janelas: janelasRecentes(m.agora, horaCorte, m.fechadas, 3, m.desde),
      lancamentos: m.lancamentos,
      pendentes: m.pendentes,
      semVolume: m.semVolume,
      calculo: m.calculo,
      fechamentos: m.fechamentos,
      dominios: m.dominios,
      peso: m.peso,
      gravacao,
      cortada: m.cortada,
    };
  }
}
