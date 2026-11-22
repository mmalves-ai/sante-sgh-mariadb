// Serviço da contabilidade, etapa 3 (M54-F3): monta o balancete, o diário, a DRE e o balanço a partir das somas lidas,
// a prévia e o plano da apuração do resultado do exercício, e a prévia e a geração do SPED (ECD e ECF) com as regras
// puras de @sgh/dominio-contabil. Aqui nada grava: a gravação (na transação do Executor, com a trilha) é do controlador.
import { createHash } from 'node:crypto';
import {
  type ApoioDemonstracoes,
  type ApoioSped,
  type ArquivoSpedListado,
  type Balancete,
  type Balanco,
  type ContaPlano,
  type Diario,
  type Dre,
  type FiltroBalancete,
  type FiltroBalanco,
  type FiltroDiario,
  type FiltroDre,
  FORMAS_ECF_GERADAS,
  FORMAS_TRIBUTACAO_ECF,
  type FormaTributacaoEcf,
  type GerarSped,
  type LancamentoDiario,
  LEIAUTE_ECD,
  LEIAUTE_ECF,
  type PreviaApuracao,
  type PreviaSped,
  QUALIFICACOES_SIGNATARIO,
  type QualificacaoSignatario,
  type SignatarioSped,
  TETO_CONTAS_BALANCETE,
  TETO_DIARIO_LANCAMENTOS,
  TIPOS_DEMONSTRACAO,
  TIPOS_LANCAMENTO,
  type TipoArquivoSped,
  type TipoDemonstracao,
} from '@sgh/contratos';
import {
  type ArquivoGerado,
  chaveApuracao,
  conferenciaDoDiario,
  dataDaApuracao,
  type EntradaSped,
  gerarEcd,
  gerarEcf,
  montarBalancete,
  montarBalanco,
  montarDre,
  nivelDoCodigo,
  planoDaApuracao,
  type PlanoApuracao,
} from '@sgh/dominio-contabil';
import type {
  ArquivoSpedRegistrado,
  ContaPlanoVersionada,
  FiltroSomasPorta,
  LancamentoParaGravar,
} from './tipos.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoContabil, PortaContabil } from './porta.js';

const recusa = (codigo: string, detalhe: string, extra: Record<string, unknown> = {}) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', detalhe, { codigo, ...extra });

/** Partidas lidas de uma vez para o SPED (um exercício de hospital cabe; acima disso, recusa em vez de cortar). */
export const TETO_PARTIDAS_SPED = 1_500_000;

const semCampos = (c: ContaPlanoVersionada): ContaPlano => ({
  empresa: c.empresa,
  codigo: c.codigo,
  nome: c.nome,
  grupo: c.grupo,
  tipo: c.tipo,
  natureza: c.natureza,
  referencialTipo: c.referencialTipo,
  referencialConta: c.referencialConta,
  contaExportacao: c.contaExportacao,
  exigeCentroCusto: c.exigeCentroCusto,
  ativa: c.ativa,
});

/** Último dia da competência (AAAA-MM → AAAA-MM-DD). */
export const ultimoDiaDa = (comp: string): string => {
  const [a, m] = comp.split('-').map(Number) as [number, number];
  return `${comp}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
/** A véspera da data (o saldo anterior soma até ela). */
export const vespera = (d: string): string => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};
const competenciasEntre = (de: string, ate: string) => {
  const r: string[] = [];
  let [a, m] = de.split('-').map(Number) as [number, number];
  const fim = ate;
  for (;;) {
    const c = `${a}-${String(m).padStart(2, '0')}`;
    if (c > fim) break;
    r.push(c);
    m += 1;
    if (m > 12) {
      m = 1;
      a += 1;
    }
  }
  return r;
};

export interface FlagsDemonstracoes {
  readonly ligada: boolean;
  readonly motivo: string | null;
  readonly podeApurar: boolean;
  readonly podeVerSped: boolean;
}

export interface FlagsSped {
  readonly ligada: boolean;
  readonly motivo: string | null;
  readonly podeGerar: boolean;
  readonly cifraDisponivel: boolean;
}

/** O que a geração devolve ao controlador para gravar (o texto em claro só para cifrar). */
export interface SpedParaGravar {
  readonly gerado: ArquivoGerado;
  readonly hash: string;
  readonly tamanho: number;
  readonly parametros: string;
  readonly leiaute: string;
}

export class ServicoDemonstracoes {
  constructor(private readonly porta: PortaContabil) {}

  private async plano(c: ContextoContabil, empresa: number): Promise<ContaPlano[]> {
    return (await this.porta.plano(c, empresa)).map(semCampos);
  }

  private async somar(c: ContextoContabil, f: FiltroSomasPorta) {
    const r = await this.porta.somas(c, f, TETO_CONTAS_BALANCETE);
    if (r.parcial)
      throw recusa(
        'contas-demais',
        `O período tem mais de ${TETO_CONTAS_BALANCETE} contas com movimento: filtre por centro de custo ou por um intervalo menor.`,
      );
    return r.itens;
  }

  async apoio(c: ContextoContabil, flags: FlagsDemonstracoes, empresa: number): Promise<ApoioDemonstracoes> {
    const [empresas, hoje, plano, centros] = await Promise.all([
      this.porta.empresas(c),
      this.porta.hoje(c),
      flags.ligada ? this.porta.plano(c, empresa) : Promise.resolve([]),
      flags.ligada ? this.porta.centrosCusto(c) : Promise.resolve([]),
    ]);
    return {
      ...flags,
      empresas: empresas.length ? empresas : [1],
      hoje,
      niveis: plano.reduce((m, x) => Math.max(m, nivelDoCodigo(x.codigo)), 1),
      centros,
      tipos: (Object.keys(TIPOS_DEMONSTRACAO) as TipoDemonstracao[]).map((codigo) => ({
        codigo,
        rotulo: TIPOS_DEMONSTRACAO[codigo],
      })),
    };
  }

  async balancete(c: ContextoContabil, f: FiltroBalancete): Promise<Balancete> {
    const de = `${f.de}-01`;
    const ate = ultimoDiaDa(f.ate);
    const base = { empresa: f.empresa, centroCusto: f.centroCusto };
    const [plano, anteriores, movimento, periodos] = await Promise.all([
      this.plano(c, f.empresa),
      this.somar(c, { ...base, de: null, ate: vespera(de) }),
      this.somar(c, { ...base, de, ate }),
      this.porta.periodos(c, f.empresa),
    ]);
    const b = montarBalancete(plano, anteriores, movimento, {
      nivel: f.nivel,
      incluirZeradas: f.incluirZeradas,
      filtrado: f.centroCusto !== null,
    });
    const encerradas = new Set(periodos.filter((p) => p.situacao === 'encerrado').map((p) => p.competencia));
    return {
      empresa: f.empresa,
      de: f.de,
      ate: f.ate,
      nivel: f.nivel,
      centroCusto: f.centroCusto,
      ...b,
      competenciasAbertas: competenciasEntre(f.de, f.ate).filter((x) => !encerradas.has(x)),
    };
  }

  async diario(c: ContextoContabil, f: FiltroDiario): Promise<Diario> {
    const [plano, lido] = await Promise.all([
      this.plano(c, f.empresa),
      this.porta.diario(c, f.empresa, f.de, f.ate, TETO_DIARIO_LANCAMENTOS, f.pagina),
    ]);
    const nomes = new Map(plano.map((x) => [x.codigo, x.nome]));
    const lancamentos: LancamentoDiario[] = lido.lancamentos.map((l) => ({
      id: l.id,
      data: l.data,
      tipo: l.tipo,
      tipoRotulo: TIPOS_LANCAMENTO[l.tipo],
      historico: l.historico,
      debitosCentavos: l.debitos,
      creditosCentavos: l.creditos,
      estornaId: l.estornaId,
      partidas: l.partidas.map((p) => ({
        lado: p.lado,
        conta: p.conta,
        contaNome: nomes.get(p.conta) ?? 'Conta fora do plano',
        valorCentavos: p.valorCentavos,
        centroCusto: p.centroCusto,
        historico: p.historico,
      })),
    }));
    const totais = lido.porTipo.reduce(
      (t, x) => ({
        lancamentos: t.lancamentos + x.lancamentos,
        debitosCentavos: t.debitosCentavos + x.debitos,
        creditosCentavos: t.creditosCentavos + x.creditos,
      }),
      { lancamentos: 0, debitosCentavos: 0, creditosCentavos: 0 },
    );
    const parcelas = lido.porTipo.map((x) => ({
      tipo: x.tipo,
      lancamentos: x.lancamentos,
      debitosCentavos: x.debitos,
    }));
    return {
      empresa: f.empresa,
      de: f.de,
      ate: f.ate,
      lancamentos,
      totais,
      parcelas,
      conferencia: conferenciaDoDiario(
        parcelas.map((p) => ({ ...p, tipo: TIPOS_LANCAMENTO[p.tipo] })),
        totais,
      ),
      pagina: f.pagina,
      parcial: lido.parcial,
    };
  }

  async dre(c: ContextoContabil, f: FiltroDre): Promise<Dre> {
    const [plano, movimento] = await Promise.all([
      this.plano(c, f.empresa),
      this.somar(c, { empresa: f.empresa, de: `${f.de}-01`, ate: ultimoDiaDa(f.ate), semApuracao: true }),
    ]);
    return { empresa: f.empresa, de: f.de, ate: f.ate, ...montarDre(plano, movimento) };
  }

  async balanco(c: ContextoContabil, f: FiltroBalanco): Promise<Balanco> {
    const data = ultimoDiaDa(f.competencia);
    const [plano, acumulado, doExercicio] = await Promise.all([
      this.plano(c, f.empresa),
      this.somar(c, { empresa: f.empresa, de: null, ate: data }),
      this.somar(c, { empresa: f.empresa, de: `${f.competencia.slice(0, 4)}-01-01`, ate: data }),
    ]);
    return {
      empresa: f.empresa,
      competencia: f.competencia,
      data,
      ...montarBalanco(plano, acumulado, doExercicio),
    };
  }

  // ── Apuração ──

  private async apuracao(c: ContextoContabil, empresa: number, exercicio: number, destino: string | null) {
    const [plano, saldos, hoje, periodos, ap] = await Promise.all([
      this.plano(c, empresa),
      this.somar(c, {
        empresa,
        de: `${exercicio}-01-01`,
        ate: dataDaApuracao(exercicio),
        porCentro: true,
      }),
      this.porta.hoje(c),
      this.porta.periodos(c, empresa),
      this.porta.apuracoes(c, empresa, exercicio),
    ]);
    const dezembro = periodos.find((p) => p.competencia === `${exercicio}-12`);
    const p = planoDaApuracao({
      exercicio,
      plano,
      saldos,
      contaDestino: destino,
      hoje,
      dezembroEncerrado: dezembro?.situacao === 'encerrado',
      apuracaoAtiva: ap.ativa,
    });
    return { plano, p, ap };
  }

  async previaApuracao(c: ContextoContabil, empresa: number, exercicio: number): Promise<PreviaApuracao> {
    const { plano, p, ap } = await this.apuracao(c, empresa, exercicio, null);
    return {
      empresa,
      exercicio: String(exercicio),
      data: dataDaApuracao(exercicio),
      receitasCentavos: p.receitas,
      custosCentavos: p.custos,
      despesasCentavos: p.despesas,
      resultadoCentavos: p.resultado,
      conferencia: p.conferencia,
      partidas: p.partidas.length + (p.resultado !== 0 ? 1 : 0),
      apuracaoAtiva: ap.ativa,
      impedimentos: p.impedimentos,
      podeApurar: p.impedimentos.length === 0,
      contasDestino: plano
        .filter((x) => x.grupo === 'patrimonioLiquido' && x.tipo === 'analitica' && x.ativa)
        .map((x) => ({ codigo: x.codigo, nome: x.nome })),
    };
  }

  /** O lançamento da apuração (ou a recusa com o primeiro impedimento e a lista). */
  async planoApurar(
    c: ContextoContabil,
    x: { empresa: number; exercicio: number; contaDestino: string; observacao: string | null },
  ): Promise<{ lancamento: LancamentoParaGravar; plano: PlanoApuracao }> {
    const { p, ap } = await this.apuracao(c, x.empresa, x.exercicio, x.contaDestino);
    const primeiro = p.impedimentos[0];
    if (primeiro) throw recusa(primeiro.codigo, primeiro.mensagem, { impedimentos: p.impedimentos });
    return {
      plano: p,
      lancamento: {
        chave: chaveApuracao(x.empresa, x.exercicio, ap.quantidade + 1),
        tipo: 'apuracao',
        empresa: x.empresa,
        data: dataDaApuracao(x.exercicio),
        competencia: `${x.exercicio}-12`,
        historico: `Apuração do resultado do exercício de ${x.exercicio}`,
        partidas: p.partidas,
        fatoId: null,
        regraId: null,
        regra: null,
        estornaId: null,
        justificativa: x.observacao,
      },
    };
  }

  // ── SPED ──

  async apoioSped(c: ContextoContabil, flags: FlagsSped): Promise<ApoioSped> {
    const [empresas, hoje] = await Promise.all([this.porta.empresas(c), this.porta.hoje(c)]);
    return {
      ...flags,
      empresas: empresas.length ? empresas : [1],
      hoje,
      leiautes: { ecd: LEIAUTE_ECD, ecf: LEIAUTE_ECF },
      formasTributacao: (Object.keys(FORMAS_TRIBUTACAO_ECF) as FormaTributacaoEcf[]).map((codigo) => ({
        codigo,
        rotulo: FORMAS_TRIBUTACAO_ECF[codigo],
        gerada: FORMAS_ECF_GERADAS.includes(codigo),
      })),
      qualificacoes: (Object.keys(QUALIFICACOES_SIGNATARIO) as QualificacaoSignatario[]).map((codigo) => ({
        codigo,
        rotulo: QUALIFICACOES_SIGNATARIO[codigo],
      })),
    };
  }

  /** A entrada do gerador: empresa, plano, saldos iniciais, lançamentos e os meses encerrados. */
  private async entradaSped(
    c: ContextoContabil,
    empresa: number,
    exercicio: number,
    resto: Pick<EntradaSped, 'signatarios' | 'numeroOrdem' | 'substituta' | 'hashAnterior'>,
  ): Promise<EntradaSped> {
    const [plano, empresaLida, iniciais, doExercicio, periodos, refs] = await Promise.all([
      this.plano(c, empresa),
      this.porta.empresaSped(c, empresa),
      this.somar(c, { empresa, de: null, ate: `${exercicio - 1}-12-31` }),
      this.porta.lancamentosDoExercicio(c, empresa, exercicio, TETO_PARTIDAS_SPED),
      this.porta.periodos(c, empresa),
      this.porta.referencias(c),
    ]);
    if (!empresaLida)
      throw recusa('empresa-inexistente', `A empresa ${empresa} não está no cadastro de empresas.`);
    // O plano referencial: o tipo mais usado nos vínculos das contas analíticas.
    const usos = new Map<number, number>();
    for (const x of plano)
      if (x.tipo === 'analitica' && x.referencialTipo !== null)
        usos.set(x.referencialTipo, (usos.get(x.referencialTipo) ?? 0) + 1);
    const tipoRef = [...usos].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const codigoRef = refs.tiposPlanoReferencial.find((t) => t.id === tipoRef)?.codigo ?? null;
    return {
      exercicio,
      empresa: { ...empresaLida, planoReferencial: codigoRef, naturezaJuridica: null },
      plano,
      saldosIniciais: iniciais,
      lancamentos: doExercicio.lancamentos.map((l) => ({
        id: l.id,
        data: l.data,
        tipo: l.tipo,
        historico: l.historico,
        encerramento: l.encerramento,
        partidas: l.partidas.map((p) => ({
          lado: p.lado,
          conta: p.conta,
          valorCentavos: p.valorCentavos,
          historico: p.historico,
        })),
      })),
      encerradas: new Set(periodos.filter((p) => p.situacao === 'encerrado').map((p) => p.competencia)),
      parcial: doExercicio.parcial,
      ...resto,
    };
  }

  private gerar(
    tipo: TipoArquivoSped,
    e: EntradaSped,
    forma: FormaTributacaoEcf | null,
    tipoEntidade: string | null,
  ): ArquivoGerado {
    return tipo === 'ecd'
      ? gerarEcd(e)
      : gerarEcf({ ...e, formaTributacao: forma ?? '9', tipoEntidade: tipoEntidade ?? '00' });
  }

  /** A prévia: impedimentos, avisos e a contagem dos registros, sem o conteúdo (os signatários vêm na geração). */
  async previaSped(
    c: ContextoContabil,
    f: { empresa: number; tipo: TipoArquivoSped; exercicio: number },
  ): Promise<PreviaSped> {
    const provisorios: SignatarioSped[] = [
      { nome: 'Contador', cpf: '00000000000', qualificacao: '900', crc: '0', email: null, telefone: null },
      {
        nome: 'Responsável',
        cpf: '00000000000',
        qualificacao: '203',
        crc: null,
        email: null,
        telefone: null,
      },
    ];
    const e = await this.entradaSped(c, f.empresa, f.exercicio, {
      signatarios: provisorios,
      numeroOrdem: 1,
      substituta: false,
      hashAnterior: null,
    });
    const g = this.gerar(f.tipo, e, null, null);
    return {
      empresa: f.empresa,
      tipo: f.tipo,
      exercicio: f.exercicio,
      leiaute: f.tipo === 'ecd' ? LEIAUTE_ECD : LEIAUTE_ECF,
      impedimentos: g.impedimentos,
      avisos: g.avisos,
      podeGerar: g.impedimentos.length === 0,
      registros: g.registros.filter((r) => !['9900', '9990', '9999', '9001'].includes(r.registro)),
      linhas: g.linhas,
    };
  }

  /** Gera o arquivo (em claro) com o hash; recusa com os impedimentos. */
  async gerarSped(c: ContextoContabil, g: GerarSped): Promise<SpedParaGravar> {
    const e = await this.entradaSped(c, g.empresa, g.exercicio, {
      signatarios: g.signatarios,
      numeroOrdem: g.numeroOrdem,
      substituta: g.substituta,
      hashAnterior: g.hashAnterior,
    });
    const gerado = this.gerar(g.tipo, e, g.formaTributacao, g.tipoEntidadeEcf);
    const primeiro = gerado.impedimentos[0];
    if (primeiro) throw recusa(primeiro.codigo, primeiro.mensagem, { impedimentos: gerado.impedimentos });
    const parametros = JSON.stringify({
      numeroOrdem: g.numeroOrdem,
      substituta: g.substituta,
      formaTributacao: g.formaTributacao,
      tipoEntidadeEcf: g.tipoEntidadeEcf,
      // Só as qualificações: o nome e o CPF dos signatários ficam no arquivo cifrado.
      signatarios: g.signatarios.map((s) => s.qualificacao),
    });
    return {
      gerado,
      hash: createHash('sha256').update(gerado.conteudo, 'utf8').digest('hex'),
      tamanho: Buffer.byteLength(gerado.conteudo, 'utf8'),
      parametros,
      leiaute: g.tipo === 'ecd' ? LEIAUTE_ECD : LEIAUTE_ECF,
    };
  }

  async arquivos(c: ContextoContabil, empresa: number): Promise<ArquivoSpedListado[]> {
    return (await this.porta.arquivosSped(c, empresa, 200)).map(arquivoListado);
  }
}

export const arquivoListado = (a: ArquivoSpedRegistrado): ArquivoSpedListado => ({
  id: a.id,
  empresa: a.empresa,
  tipo: a.tipo,
  exercicio: a.exercicio,
  numero: a.numero,
  situacao: a.situacao,
  leiaute: a.leiaute,
  leiauteConferido: a.leiauteConferido,
  nomeArquivo: a.nomeArquivo,
  linhas: a.linhas,
  tamanho: a.tamanho,
  hash: a.hash,
  substituta: a.substituta,
  geradoPor: a.geradoPor,
  geradoEm: a.geradoEm,
  recibo: a.recibo,
  transmitidoEm: a.transmitidoEm,
  motivo: a.motivo,
});
