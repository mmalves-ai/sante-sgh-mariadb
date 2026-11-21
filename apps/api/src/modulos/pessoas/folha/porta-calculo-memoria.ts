// Porta do cálculo mensal da folha em memória (M53.3): a sessão sintética de dev/ci e o E2E. Os registros vivem por
// estabelecimento, numa cópia por transação (o erro no meio desfaz tudo). Nada vai ao banco. Os vínculos e os
// dependentes vêm da gestão de pessoas em memória. As regras de banco que importam ao teste também valem aqui: vigência
// única por início, número único do processamento, situação e versão na troca, linha única por vínculo e papel.
import {
  APURACAO_DO_TIPO,
  esquemaParametrosObrigacoes,
  type ParametrosFolhaLidos,
  type ParametrosObrigacoesLidos,
  type TipoProcessoFolha,
} from '@sgh/contratos';
import { ErroOperacao, type LinhaTrilha } from '@sgh/nucleo';
import {
  type CodigosCatalogosObrigacoes,
  type DependentesDoVinculo,
  type FechamentoDaFolha,
  type FeriasDoVinculo,
  type FeriasNaCompetencia,
  type FiltroFechamentosDaFolha,
  type FiltroFeriasDaFolha,
  type FiltroObrigacoesDaFolha,
  type FiltroProcessosDaFolha,
  type FiltroRescisoesDaFolha,
  type HistoricoDaFolha,
  type ItemRubricaDoProcesso,
  type LinhaCalculoDoVinculo,
  type ObrigacaoDaFolha,
  PAPEIS_HISTORICO_FOLHA,
  type ProcessoDaFolha,
  type RescisaoDaFolha,
  type ResumoVinculoDoProcesso,
  type SalarioDoVinculo,
  type TipoRescisaoDaFolha,
  type VinculoDesligado,
  type VinculoDoCalculo,
} from './tipos-folha.js';
import type { GravacaoFeita } from '../../exames/public-api.js';
import type { PortaPessoas } from '../porta.js';
import type { ContextoCalculoFolha, GravadorCalculoFolha, PortaCalculoFolha } from './porta-calculo.js';

const recusa = (codigo: string, mensagem: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', mensagem);
const desatualizado = () =>
  recusa(
    'desatualizado',
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );

interface Estado {
  seq: number;
  salarios: SalarioDoVinculo[];
  parametros: ParametrosFolhaLidos[];
  processos: ProcessoDaFolha[];
  linhas: (LinhaCalculoDoVinculo & { processo: number })[];
  ferias: FeriasDoVinculo[];
  rescisoes: RescisaoDaFolha[];
  fechamentos: FechamentoDaFolha[];
  parametrosObrigacoes: ParametrosObrigacoesLidos[];
  obrigacoes: (ObrigacaoDaFolha & { conteudo: string })[];
}
const novo = (): Estado => ({
  seq: 5330,
  salarios: [],
  parametros: [],
  processos: [],
  linhas: [],
  ferias: [],
  rescisoes: [],
  fechamentos: [],
  parametrosObrigacoes: [],
  obrigacoes: [],
});
const copiar = (s: Estado): Estado => ({
  seq: s.seq,
  salarios: s.salarios.map((x) => ({ ...x })),
  parametros: s.parametros.map((x) => ({ ...x })),
  processos: s.processos.map((x) => ({ ...x, totais: { ...x.totais } })),
  linhas: s.linhas.map((x) => ({ ...x })),
  ferias: s.ferias.map((x) => ({ ...x })),
  rescisoes: s.rescisoes.map((x) => ({ ...x })),
  fechamentos: s.fechamentos.map((x) => ({ ...x, processos: [...x.processos], totais: { ...x.totais } })),
  parametrosObrigacoes: s.parametrosObrigacoes.map((x) => ({ ...x })),
  obrigacoes: s.obrigacoes.map((x) => ({ ...x, totais: { ...x.totais }, fechamentos: [...x.fechamentos] })),
});

/** Os códigos dos catálogos oficiais da sessão sintética (os do banco do pc: numéricos sem zero à esquerda). */
export const CATALOGOS_OBRIGACOES_SINTETICOS: CodigosCatalogosObrigacoes = {
  categoriasSefip: ['0', '1', '2', '3', '4', '5', '6', '7', '11', '12', '13', '14', '15', '16', '17'],
  movimentacoesSefip: [
    'H',
    'I1',
    'I2',
    'I3',
    'I4',
    'I5',
    'J',
    'K',
    'L',
    'M',
    'N1',
    'N2',
    'N3',
    'S2',
    'S3',
    'U1',
  ],
  desligamentosCaged: ['31', '32', '40', '43', '45', '50', '60', '80', '90'],
  admissoesCaged: ['10', '20', '25', '35', '70'],
  vinculosRais: [
    '0',
    '10',
    '15',
    '20',
    '25',
    '30',
    '35',
    '40',
    '50',
    '55',
    '60',
    '65',
    '70',
    '75',
    '90',
    '95',
  ],
  desligamentosRais: [
    '10',
    '11',
    '12',
    '20',
    '21',
    '27',
    '30',
    '31',
    '40',
    '60',
    '62',
    '70',
    '72',
    '76',
    '80',
    '90',
  ],
  admissoesRais: ['1', '2', '3', '4', '5'],
};

function obrigacaoSemConteudo(o: ObrigacaoDaFolha & { conteudo: string }): ObrigacaoDaFolha {
  const x: Partial<typeof o> = { ...o, totais: { ...o.totais }, fechamentos: [...o.fechamentos] };
  delete x.conteudo;
  return x as ObrigacaoDaFolha;
}

/** O período do processamento está fechado (a mesma conferência da porta do banco). */
const periodoFechado = (s: Estado, empresa: number, tipo: TipoProcessoFolha, competencia: string) => {
  const apuracao = APURACAO_DO_TIPO[tipo];
  const periodo = apuracao === 'anual' ? competencia.slice(0, 4) : competencia;
  return s.fechamentos.some(
    (f) =>
      f.empresa === empresa && f.apuracao === apuracao && f.periodo === periodo && f.situacao === 'fechada',
  );
};
const recusaFechado = () =>
  recusa(
    'competencia-fechada',
    'O período desta folha está fechado: reabra o fechamento (com motivo) antes de calcular, recalcular ou descartar.',
  );

const p2 = (x: number) => String(x).padStart(2, '0');
const local = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;

const PAPEIS_DO_RESUMO = [
  'baseInss',
  'baseIrrf',
  'baseFgts',
  'inss',
  'irrf',
  'fgts',
  'inssPatronal',
  'rat',
  'terceiros',
  'inssFerias',
  'irrfFerias',
  'inssDecimo',
  'irrfDecimo',
  'multaFgts',
] as const;

function resumir(linhas: readonly LinhaCalculoDoVinculo[]): ResumoVinculoDoProcesso[] {
  const por = new Map<number, LinhaCalculoDoVinculo[]>();
  for (const l of linhas) por.set(l.vinculo, [...(por.get(l.vinculo) ?? []), l]);
  return [...por.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([vinculo, ls]) => ({
      vinculo,
      centroCusto: ls[0]!.centroCusto,
      diasPagos: ls[0]!.diasPagos,
      proventos: ls.filter((l) => l.tipo === 'provento').reduce((s, l) => s + l.valor, 0),
      descontos: ls.filter((l) => l.tipo === 'desconto').reduce((s, l) => s + l.valor, 0),
      porPapel: Object.fromEntries(
        PAPEIS_DO_RESUMO.map((p) => [p, ls.filter((l) => l.papel === p).reduce((s, l) => s + l.valor, 0)]),
      ),
    }));
}

const filtra = (p: ProcessoDaFolha, f: FiltroProcessosDaFolha) =>
  (f.empresa === undefined || p.empresa === f.empresa) &&
  (f.competencia === undefined || p.competencia === f.competencia) &&
  (f.situacao === undefined || p.situacao === f.situacao) &&
  (f.tipo === undefined || p.tipo === f.tipo) &&
  (f.semTipo === undefined || p.tipo !== f.semTipo) &&
  !(f.semTipos ?? []).includes(p.tipo) &&
  (f.competenciaDe === undefined || p.competencia >= f.competenciaDe) &&
  (f.competenciaAte === undefined || p.competencia <= f.competenciaAte);

const filtraFerias = (x: FeriasDoVinculo, f: FiltroFeriasDaFolha) =>
  (f.vinculo === undefined || x.vinculo === f.vinculo) &&
  (f.empresa === undefined || x.empresa === f.empresa) &&
  (f.de === undefined || x.fim >= f.de) &&
  (f.ate === undefined || x.inicio <= f.ate) &&
  (f.situacao === undefined || x.situacao === f.situacao);

export class PortaCalculoFolhaMemoria implements PortaCalculoFolha {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();
  /** Testes: o relógio sintético (AAAA-MM-DDTHH:MM:SS) das gravações. */
  agoraFixo: string | null = null;

  constructor(private readonly pessoas: PortaPessoas | null = null) {}

  private e(c: ContextoCalculoFolha): Estado {
    let s = this.estados.get(String(c.estabelecimento));
    if (!s) this.estados.set(String(c.estabelecimento), (s = novo()));
    return s;
  }
  private agora(): string {
    return this.agoraFixo ?? local(new Date());
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }
  async executar(): Promise<GravacaoFeita> {
    throw new ErroOperacao(
      409,
      'operacao-desconhecida',
      'Operação recusada',
      'O cálculo da folha não usa o executor.',
    );
  }

  async gravarSgh<T>(
    c: ContextoCalculoFolha,
    _trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorCalculoFolha) => Promise<T>,
  ): Promise<T> {
    const s = copiar(this.e(c));
    const agora = this.agora();
    const g: GravadorCalculoFolha = {
      salarios: async (vs) => s.salarios.filter((x) => vs.includes(x.vinculo)),
      incluirSalario: async (x) => {
        if (s.salarios.some((y) => y.vinculo === x.vinculo && y.inicio === x.inicio))
          throw recusa(
            'vigencia-repetida',
            'Já existe uma vigência do salário com este início: escolha outra data.',
          );
        const id = ++s.seq;
        s.salarios.push({
          id,
          vinculo: x.vinculo,
          inicio: x.inicio,
          salario: x.salario,
          insalubridade: x.insalubridade,
          periculosidade: x.periculosidade,
          motivo: x.motivo,
          registradoPor: x.por,
          registradoEm: agora,
        });
        return id;
      },
      parametros: async (empresa) => this.ordenar(s.parametros.filter((p) => p.empresa === empresa)),
      incluirParametros: async (x) => {
        if (s.parametros.some((y) => y.empresa === x.empresa && y.inicio === x.inicio))
          throw recusa(
            'vigencia-repetida',
            'Já existem parâmetros da folha com este início para a empresa: escolha outra data.',
          );
        const id = ++s.seq;
        const { por, ...p } = x;
        s.parametros.push({ ...p, id, registradoPor: por, registradoEm: agora });
        return id;
      },
      emVigorComTrava: async (empresa, competencia, tipo = 'mensal', intervalo = null) => {
        const doTipo = s.processos.filter((p) => p.empresa === empresa && p.tipo === tipo);
        const da = doTipo.filter((p) => p.competencia === competencia);
        const de = intervalo?.de ?? competencia;
        const ate = intervalo?.ate ?? competencia;
        return {
          vigente:
            tipo === 'ferias' || tipo === 'rescisao'
              ? null
              : (doTipo.find(
                  (p) => p.situacao === 'calculada' && p.competencia >= de && p.competencia <= ate,
                ) ?? null),
          proximoNumero: da.reduce((m, p) => Math.max(m, p.numero), 0) + 1,
        };
      },
      incluirProcesso: async (x) => {
        if (periodoFechado(s, x.empresa, x.tipo ?? 'mensal', x.competencia)) throw recusaFechado();
        if (
          s.processos.some(
            (p) =>
              p.empresa === x.empresa &&
              p.competencia === x.competencia &&
              p.tipo === (x.tipo ?? 'mensal') &&
              p.numero === x.numero,
          )
        )
          throw recusa(
            'calculo-concorrente',
            'Outra pessoa calculou esta competência ao mesmo tempo: abra de novo e confira.',
          );
        const id = ++s.seq;
        s.processos.push({
          id,
          empresa: x.empresa,
          competencia: x.competencia,
          tipo: x.tipo ?? 'mensal',
          numero: x.numero,
          situacao: 'calculada',
          pagamento: (x.tipo ?? 'mensal') === 'mensal' ? null : (x.pagamento ?? null),
          totais: { ...x.totais },
          foraDaFolha: x.foraDaFolha,
          tabelaLegal: x.tabelaLegal,
          parametros: x.parametros,
          resumo: x.resumo,
          calculadoPor: x.por,
          calculadoEm: agora,
          situacaoPor: null,
          situacaoEm: null,
          motivo: null,
          versao: 0,
        });
        return id;
      },
      incluirLinhas: async (processo, linhas) => {
        for (const l of linhas) {
          if (s.linhas.some((y) => y.processo === processo && y.vinculo === l.vinculo && y.papel === l.papel))
            throw new Error(`linha repetida: ${l.vinculo}/${l.papel}`);
          s.linhas.push({ ...l, processo });
        }
        return linhas.length;
      },
      situacaoProcesso: async (x) => {
        const p = s.processos.find((y) => y.id === x.id);
        if (p && periodoFechado(s, p.empresa, p.tipo, p.competencia)) throw recusaFechado();
        if (!p || p.situacao !== x.de || p.versao !== x.versao) throw desatualizado();
        Object.assign(p, {
          situacao: x.para,
          motivo: x.motivo,
          situacaoPor: x.por,
          situacaoEm: agora,
          versao: p.versao + 1,
        });
      },
      processo: async (id) => s.processos.find((p) => p.id === id) ?? null,
      resumoVinculos: async (processo) => resumir(s.linhas.filter((l) => l.processo === processo)),
      feriasDoVinculoComTrava: async (vinculo) => s.ferias.filter((f) => f.vinculo === vinculo),
      incluirFerias: async (x) => {
        const id = ++s.seq;
        const { por, ...f } = x;
        s.ferias.push({
          ...f,
          id,
          situacao: 'programada',
          processo: null,
          motivo: null,
          registradoPor: por,
          registradoEm: agora,
          situacaoPor: null,
          situacaoEm: null,
          versao: 0,
        });
        return id;
      },
      situacaoFerias: async (x) => {
        const f = s.ferias.find((y) => y.id === x.id);
        if (!f || f.situacao !== x.de || f.versao !== x.versao) throw desatualizado();
        Object.assign(f, {
          situacao: x.para,
          motivo: x.motivo,
          situacaoPor: x.por,
          situacaoEm: agora,
          versao: f.versao + 1,
          ...(x.para === 'calculada' ? { processo: x.processo ?? null } : {}),
        });
      },
      rescisoesDoVinculoComTrava: async (vinculo) => {
        const v = this.pessoas ? await this.pessoas.vinculo(c, vinculo) : null;
        return {
          desligamento: v?.desligamento ?? null,
          tipoRescisao: v?.tipoRescisao ?? null,
          rescisoes: s.rescisoes.filter((r) => r.vinculo === vinculo),
        };
      },
      incluirRescisao: async (x) => {
        const id = ++s.seq;
        const { por, ...r } = x;
        s.rescisoes.push({
          ...r,
          id,
          situacao: 'calculada',
          motivo: null,
          registradoPor: por,
          registradoEm: agora,
          situacaoPor: null,
          situacaoEm: null,
          versao: 0,
        });
        return id;
      },
      situacaoRescisao: async (x) => {
        const r = s.rescisoes.find((y) => y.id === x.id);
        if (!r || r.situacao !== x.de || r.versao !== x.versao) throw desatualizado();
        Object.assign(r, {
          situacao: x.para,
          motivo: x.motivo,
          situacaoPor: x.por,
          situacaoEm: agora,
          versao: r.versao + 1,
        });
      },
      fechamentoEmVigorComTrava: async (empresa, apuracao, periodo) => {
        const doPeriodo = s.fechamentos.filter(
          (f) => f.empresa === empresa && f.apuracao === apuracao && f.periodo === periodo,
        );
        return {
          vigente: doPeriodo.find((f) => f.situacao === 'fechada') ?? null,
          proximoNumero: doPeriodo.reduce((m, f) => Math.max(m, f.numero), 0) + 1,
        };
      },
      processosCalculadosComTrava: async (empresa, de, ate) =>
        s.processos
          .filter(
            (p) =>
              p.empresa === empresa &&
              p.situacao === 'calculada' &&
              p.competencia >= de &&
              p.competencia <= ate,
          )
          .sort((a, b) => a.competencia.localeCompare(b.competencia) || a.id - b.id),
      incluirFechamento: async (x) => {
        if (
          s.fechamentos.some(
            (f) =>
              f.empresa === x.empresa &&
              f.apuracao === x.apuracao &&
              f.periodo === x.periodo &&
              f.numero === x.numero,
          )
        )
          throw recusa(
            'periodo-ja-fechado',
            'Outra pessoa fechou este período ao mesmo tempo: abra de novo e confira.',
          );
        const id = ++s.seq;
        s.fechamentos.push({
          id,
          empresa: x.empresa,
          apuracao: x.apuracao,
          periodo: x.periodo,
          numero: x.numero,
          situacao: 'fechada',
          pagamento: x.apuracao === 'mensal' ? x.pagamento : null,
          processos: [...x.processos],
          totais: { ...x.totais },
          resumo: x.resumo,
          fechadoPor: x.por,
          fechadoEm: agora,
          reabertoPor: null,
          reabertoEm: null,
          motivo: null,
          versao: 0,
        });
        return id;
      },
      reabrirFechamento: async (x) => {
        const f = s.fechamentos.find((y) => y.id === x.id);
        if (!f || f.situacao !== 'fechada' || f.versao !== x.versao) throw desatualizado();
        Object.assign(f, {
          situacao: 'reaberta',
          motivo: x.motivo,
          reabertoPor: x.por,
          reabertoEm: agora,
          versao: f.versao + 1,
        });
      },
      // ── M53.8 (F7) ──
      incluirParametrosObrigacoes: async (x) => {
        if (s.parametrosObrigacoes.some((y) => y.empresa === x.empresa && y.inicio === x.inicio))
          throw recusa(
            'parametros-vigencia-repetida',
            'Já há parâmetros das obrigações com este início: a correção é uma vigência nova.',
          );
        const id = ++s.seq;
        const dados = esquemaParametrosObrigacoes.parse({
          ...(JSON.parse(x.dados) as object),
          empresa: x.empresa,
          inicio: x.inicio,
        });
        s.parametrosObrigacoes.push({ ...dados, id, criadoPor: x.por, criadoEm: agora });
        return id;
      },
      obrigacoesEmVigorComTrava: async (empresa, tipo, periodo) => {
        const doPeriodo = s.obrigacoes.filter(
          (o) => o.empresa === empresa && o.tipo === tipo && o.periodo === periodo,
        );
        return {
          vigentes: doPeriodo
            .filter((o) => o.situacao === 'gerada' || o.situacao === 'entregue')
            .sort((a, b) => b.numero - a.numero)
            .map(obrigacaoSemConteudo),
          proximoNumero: doPeriodo.reduce((m, o) => Math.max(m, o.numero), 0) + 1,
        };
      },
      obrigacaoComTrava: async (id) => {
        const o = s.obrigacoes.find((y) => y.id === id);
        return o ? obrigacaoSemConteudo(o) : null;
      },
      incluirObrigacao: async (x) => {
        if (
          s.obrigacoes.some(
            (o) =>
              o.empresa === x.empresa &&
              o.tipo === x.tipo &&
              o.periodo === x.periodo &&
              o.numero === x.numero,
          )
        )
          throw desatualizado();
        const id = ++s.seq;
        s.obrigacoes.push({
          id,
          empresa: x.empresa,
          tipo: x.tipo,
          periodo: x.periodo,
          numero: x.numero,
          situacao: 'gerada',
          leiaute: x.leiaute,
          leiauteConferido: x.leiauteConferido,
          nomeArquivo: x.nomeArquivo,
          tamanho: x.tamanho,
          resumo: x.resumo,
          totais: { ...x.totais },
          fechamentos: [...x.fechamentos],
          geradoPor: x.por,
          geradoEm: agora,
          protocolo: null,
          entregueEm: null,
          valorGuia: null,
          acrescimos: null,
          entreguePor: null,
          entregaRegistrada: null,
          motivo: null,
          situacaoPor: null,
          situacaoEm: null,
          versao: 0,
          conteudo: x.conteudoCifrado,
        });
        return id;
      },
      substituirObrigacao: async (x) => {
        const o = s.obrigacoes.find((y) => y.id === x.id);
        if (!o || o.situacao !== 'gerada' || o.versao !== x.versao) throw desatualizado();
        Object.assign(o, {
          situacao: 'substituida',
          situacaoPor: x.por,
          situacaoEm: agora,
          versao: o.versao + 1,
        });
      },
      registrarEntregaObrigacao: async (x) => {
        const o = s.obrigacoes.find((y) => y.id === x.id);
        if (!o || o.situacao !== 'gerada' || o.versao !== x.versao) throw desatualizado();
        Object.assign(o, {
          situacao: 'entregue',
          protocolo: x.protocolo,
          entregueEm: x.data,
          valorGuia: x.valorGuia,
          acrescimos: x.acrescimos,
          entreguePor: x.por,
          entregaRegistrada: agora,
          situacaoPor: x.por,
          situacaoEm: agora,
          versao: o.versao + 1,
        });
      },
      cancelarObrigacao: async (x) => {
        const o = s.obrigacoes.find((y) => y.id === x.id);
        if (!o || o.situacao !== 'gerada' || o.versao !== x.versao) throw desatualizado();
        Object.assign(o, {
          situacao: 'cancelada',
          motivo: x.motivo,
          situacaoPor: x.por,
          situacaoEm: agora,
          versao: o.versao + 1,
        });
      },
    };
    const r = await fn(g);
    this.estados.set(String(c.estabelecimento), s);
    return r;
  }

  private ordenar(ps: readonly ParametrosFolhaLidos[]): ParametrosFolhaLidos[] {
    return [...ps].sort((a, b) => b.inicio.localeCompare(a.inicio));
  }

  async vinculos(c: ContextoCalculoFolha, inicio: string, fim: string): Promise<VinculoDoCalculo[]> {
    if (!this.pessoas) return [];
    const r: VinculoDoCalculo[] = [];
    let depois: number | undefined;
    for (;;) {
      const p = await this.pessoas.listarVinculos(c, {
        estado: 'todos',
        limite: 200,
        ...(depois !== undefined ? { depois } : {}),
      });
      for (const v of p.itens)
        if (v.admissao <= fim && (v.desligamento === null || v.desligamento >= inicio))
          r.push({
            id: v.id,
            matricula: v.matricula,
            tipo: v.tipo,
            admissao: v.admissao,
            desligamento: v.desligamento,
            centroCusto: v.centroCusto,
            cargaSemanal: v.cargaSemanal,
          });
      if (p.depois === null) break;
      depois = p.depois;
    }
    return r.sort((a, b) => a.id - b.id);
  }
  async dependentes(
    c: ContextoCalculoFolha,
    vinculos: readonly number[],
  ): Promise<Map<number, DependentesDoVinculo>> {
    const out = new Map<number, DependentesDoVinculo>();
    if (!this.pessoas) return out;
    for (const v of new Set(vinculos)) {
      const ds = await this.pessoas.dependentes(c, v);
      out.set(v, {
        irrf: ds.filter((d) => d.dependenteIr).length,
        salarioFamilia: ds.filter((d) => d.dependenteSalarioFamilia).length,
      });
    }
    return out;
  }
  async salarios(c: ContextoCalculoFolha, vinculos: readonly number[]) {
    const vs = new Set(vinculos);
    return this.e(c).salarios.filter((s) => vs.has(s.vinculo));
  }
  async parametros(c: ContextoCalculoFolha, empresa: number) {
    return this.ordenar(this.e(c).parametros.filter((p) => p.empresa === empresa));
  }
  async processos(c: ContextoCalculoFolha, f: FiltroProcessosDaFolha) {
    return this.e(c)
      .processos.filter((p) => filtra(p, f))
      .sort(
        (a, b) => b.competencia.localeCompare(a.competencia) || a.empresa - b.empresa || b.numero - a.numero,
      );
  }
  async processo(c: ContextoCalculoFolha, id: number) {
    return this.e(c).processos.find((p) => p.id === id) ?? null;
  }
  async resumoVinculos(c: ContextoCalculoFolha, processo: number) {
    return resumir(this.e(c).linhas.filter((l) => l.processo === processo));
  }
  async linhasDoVinculo(c: ContextoCalculoFolha, processo: number, vinculo: number) {
    return this.e(c)
      .linhas.filter((l) => l.processo === processo && l.vinculo === vinculo)
      .map((l): LinhaCalculoDoVinculo => {
        const { processo, ...resto } = l;
        void processo;
        return resto;
      });
  }

  // ── M53.4 (F3) ──────────────────────────────────────────────────────────────────────────────────────────────
  async ferias(c: ContextoCalculoFolha, f: FiltroFeriasDaFolha): Promise<FeriasDoVinculo[]> {
    return this.e(c)
      .ferias.filter((x) => filtraFerias(x, f))
      .sort((a, b) =>
        f.vinculo !== undefined
          ? b.inicio.localeCompare(a.inicio) || b.id - a.id
          : a.inicio.localeCompare(b.inicio) || a.id - b.id,
      );
  }
  async feriasPorId(c: ContextoCalculoFolha, id: number): Promise<FeriasDoVinculo | null> {
    return this.e(c).ferias.find((x) => x.id === id) ?? null;
  }
  async historico(
    c: ContextoCalculoFolha,
    vinculos: readonly number[],
    de: string,
    ate: string,
  ): Promise<HistoricoDaFolha[]> {
    const s = this.e(c);
    const vs = new Set(vinculos);
    const comp = new Map(
      s.processos
        .filter(
          (p) =>
            p.tipo === 'mensal' && p.situacao === 'calculada' && p.competencia >= de && p.competencia <= ate,
        )
        .map((p) => [p.id, p.competencia]),
    );
    const soma = new Map<string, HistoricoDaFolha>();
    for (const l of s.linhas) {
      const competencia = comp.get(l.processo);
      if (!competencia || !vs.has(l.vinculo) || !PAPEIS_HISTORICO_FOLHA.includes(l.papel)) continue;
      const k = `${l.vinculo}|${competencia}|${l.papel}`;
      const a = soma.get(k);
      soma.set(k, {
        vinculo: l.vinculo,
        competencia,
        papel: l.papel,
        quantidade: (a?.quantidade ?? 0) + l.quantidade,
        valor: (a?.valor ?? 0) + l.valor,
      });
    }
    return [...soma.values()];
  }
  async adiantamentosDecimo(
    c: ContextoCalculoFolha,
    empresa: number,
    ano: number,
    origens: readonly ('decimo1' | 'ferias')[] = ['decimo1', 'ferias'],
  ): Promise<Map<number, number>> {
    const s = this.e(c);
    const ids = new Set(
      s.processos
        .filter(
          (p) =>
            p.empresa === empresa &&
            (origens as readonly string[]).includes(p.tipo) &&
            p.situacao === 'calculada' &&
            p.competencia.startsWith(`${ano}-`),
        )
        .map((p) => p.id),
    );
    const out = new Map<number, number>();
    for (const l of s.linhas)
      if (ids.has(l.processo) && (l.papel === 'decimoPrimeira' || l.papel === 'decimoAdiantamento'))
        out.set(l.vinculo, (out.get(l.vinculo) ?? 0) + l.valor);
    return out;
  }
  async feriasNaCompetencia(
    c: ContextoCalculoFolha,
    inicio: string,
    fim: string,
  ): Promise<FeriasNaCompetencia[]> {
    const s = this.e(c);
    const out: FeriasNaCompetencia[] = [];
    for (const f of s.ferias) {
      if (f.situacao !== 'calculada' || f.processo === null || f.inicio > fim || f.fim < inicio) continue;
      const p = s.processos.find((x) => x.id === f.processo && x.situacao === 'calculada');
      if (!p) continue;
      const ls = s.linhas.filter((l) => l.processo === p.id);
      out.push({
        ferias: f.id,
        vinculo: f.vinculo,
        inicio: f.inicio,
        fim: f.fim,
        processo: p.id,
        competencia: p.competencia,
        baseInss: ls.filter((l) => l.papel === 'baseInss').reduce((a, l) => a + l.valor, 0),
        inss: ls.filter((l) => l.papel === 'inssFerias').reduce((a, l) => a + l.valor, 0),
      });
    }
    return out;
  }

  // ── M53.5 (F4) ──────────────────────────────────────────────────────────────────────────────────────────────
  async rescisoes(c: ContextoCalculoFolha, f: FiltroRescisoesDaFolha): Promise<RescisaoDaFolha[]> {
    return this.e(c)
      .rescisoes.filter(
        (r) =>
          (f.vinculo === undefined || r.vinculo === f.vinculo) &&
          (f.empresa === undefined || r.empresa === f.empresa) &&
          (f.de === undefined || r.desligamento >= f.de) &&
          (f.ate === undefined || r.desligamento <= f.ate) &&
          (f.situacao === undefined || r.situacao === f.situacao),
      )
      .sort((a, b) => b.desligamento.localeCompare(a.desligamento) || b.id - a.id);
  }
  async rescisaoPorId(c: ContextoCalculoFolha, id: number): Promise<RescisaoDaFolha | null> {
    return this.e(c).rescisoes.find((r) => r.id === id) ?? null;
  }
  async desligados(c: ContextoCalculoFolha, de: string, ate: string): Promise<VinculoDesligado[]> {
    if (!this.pessoas) return [];
    const s = this.e(c);
    const out: VinculoDesligado[] = [];
    let depois: number | undefined;
    for (;;) {
      const p = await this.pessoas.listarVinculos(c, {
        estado: 'todos',
        limite: 200,
        ...(depois !== undefined ? { depois } : {}),
      });
      for (const v of p.itens) {
        if (v.desligamento === null || v.desligamento < de || v.desligamento > ate) continue;
        const lido = await this.pessoas.vinculo(c, v.id);
        out.push({
          vinculo: v.id,
          matricula: v.matricula,
          tipo: v.tipo,
          admissao: v.admissao,
          desligamento: v.desligamento,
          tipoRescisao: lido?.tipoRescisao ?? null,
          rescisao: s.rescisoes.find((r) => r.vinculo === v.id && r.situacao === 'calculada')?.id ?? null,
        });
      }
      if (p.depois === null) break;
      depois = p.depois;
    }
    return out.sort((a, b) => b.desligamento.localeCompare(a.desligamento) || a.vinculo - b.vinculo);
  }
  async processosDoVinculo(
    c: ContextoCalculoFolha,
    vinculo: number,
    tipo: TipoProcessoFolha,
    de: string,
    ate: string,
  ): Promise<{ processo: number; competencia: string }[]> {
    const s = this.e(c);
    return s.processos
      .filter(
        (p) =>
          p.tipo === tipo &&
          p.situacao === 'calculada' &&
          p.competencia >= de &&
          p.competencia <= ate &&
          s.linhas.some((l) => l.processo === p.id && l.vinculo === vinculo),
      )
      .map((p) => ({ processo: p.id, competencia: p.competencia }))
      .sort((a, b) => a.competencia.localeCompare(b.competencia));
  }
  async fgtsDepositado(c: ContextoCalculoFolha, vinculo: number): Promise<number> {
    const s = this.e(c);
    const ids = new Set(
      s.processos.filter((p) => p.situacao === 'calculada' && p.tipo !== 'rescisao').map((p) => p.id),
    );
    return s.linhas
      .filter((l) => ids.has(l.processo) && l.vinculo === vinculo && l.papel === 'fgts')
      .reduce((a, l) => a + l.valor, 0);
  }
  /** Os tipos de rescisão da sessão sintética (os oito do cadastro do pc, com o saque e a causa). */
  async tiposRescisao(): Promise<TipoRescisaoDaFolha[]> {
    return TIPOS_RESCISAO_SINTETICOS.map((t) => ({ ...t }));
  }
  // ── M53.7 (F6) ──────────────────────────────────────────────────────────────────────────────────────────────
  async fechamentos(c: ContextoCalculoFolha, f: FiltroFechamentosDaFolha): Promise<FechamentoDaFolha[]> {
    return this.e(c)
      .fechamentos.filter(
        (x) =>
          (f.empresa === undefined || x.empresa === f.empresa) &&
          (f.apuracao === undefined || x.apuracao === f.apuracao) &&
          (f.periodo === undefined || x.periodo === f.periodo) &&
          (f.ano === undefined || x.periodo.startsWith(f.ano)) &&
          (f.situacao === undefined || x.situacao === f.situacao),
      )
      .sort(
        (a, b) =>
          b.periodo.localeCompare(a.periodo) || a.apuracao.localeCompare(b.apuracao) || b.numero - a.numero,
      );
  }
  async fechamento(c: ContextoCalculoFolha, id: number): Promise<FechamentoDaFolha | null> {
    return this.e(c).fechamentos.find((x) => x.id === id) ?? null;
  }
  async itensRubricaDoProcesso(c: ContextoCalculoFolha, processo: number): Promise<ItemRubricaDoProcesso[]> {
    const por = new Map<string, ItemRubricaDoProcesso>();
    for (const l of this.e(c).linhas) {
      if (
        l.processo !== processo ||
        l.codigoRubrica === null ||
        (l.tipo !== 'provento' && l.tipo !== 'desconto')
      )
        continue;
      const k = `${l.vinculo}:${l.tipo}:${l.codigoRubrica}`;
      const x = por.get(k);
      por.set(k, {
        vinculo: l.vinculo,
        tipo: l.tipo,
        codigoRubrica: l.codigoRubrica,
        valor: (x?.valor ?? 0) + l.valor,
      });
    }
    return [...por.values()].sort((a, b) => a.vinculo - b.vinculo || a.codigoRubrica - b.codigoRubrica);
  }
  // ── M53.8 (F7) ──────────────────────────────────────────────────────────────────────────────────────────────
  async parametrosObrigacoes(
    c: ContextoCalculoFolha,
    empresa: number | null,
  ): Promise<ParametrosObrigacoesLidos[]> {
    return this.e(c)
      .parametrosObrigacoes.filter((x) => empresa === null || x.empresa === empresa)
      .sort((a, b) => a.empresa - b.empresa || b.inicio.localeCompare(a.inicio));
  }
  async obrigacoes(c: ContextoCalculoFolha, f: FiltroObrigacoesDaFolha): Promise<ObrigacaoDaFolha[]> {
    return this.e(c)
      .obrigacoes.filter(
        (x) =>
          (f.empresa === undefined || x.empresa === f.empresa) &&
          (f.tipo === undefined || x.tipo === f.tipo) &&
          (f.periodo === undefined || x.periodo === f.periodo) &&
          (f.ano === undefined || x.periodo.startsWith(f.ano)) &&
          (!f.situacoes?.length || f.situacoes.includes(x.situacao)),
      )
      .sort(
        (a, b) => b.periodo.localeCompare(a.periodo) || a.tipo.localeCompare(b.tipo) || b.numero - a.numero,
      )
      .map(obrigacaoSemConteudo);
  }
  async obrigacao(c: ContextoCalculoFolha, id: number): Promise<ObrigacaoDaFolha | null> {
    const o = this.e(c).obrigacoes.find((x) => x.id === id);
    return o ? obrigacaoSemConteudo(o) : null;
  }
  async conteudoObrigacao(c: ContextoCalculoFolha, id: number): Promise<string | null> {
    return this.e(c).obrigacoes.find((x) => x.id === id)?.conteudo ?? null;
  }
  async catalogosObrigacoes(): Promise<CodigosCatalogosObrigacoes> {
    return structuredClone(CATALOGOS_OBRIGACOES_SINTETICOS);
  }
}

const TIPOS_RESCISAO_SINTETICOS: readonly TipoRescisaoDaFolha[] = [
  { id: 1, nome: 'Demissão sem justa causa', saque: '01', causa: 3 },
  { id: 2, nome: 'Demissão por justa causa', saque: '00', causa: 1 },
  { id: 3, nome: 'Demissão por término de contrato de trabalho', saque: '04', causa: 3 },
  { id: 4, nome: 'Falecimento', saque: '23', causa: 3 },
  { id: 5, nome: 'Pedido de demissão', saque: '00', causa: 5 },
  { id: 6, nome: 'Pedido de demissão contrato de experiência', saque: '00', causa: 5 },
  { id: 7, nome: 'Termino do contrato a termo', saque: '04', causa: 3 },
  { id: 8, nome: 'Aposentadoria por tempo de serviço, com rescisão contratual', saque: '05', causa: 3 },
];
