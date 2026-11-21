// Porta da cobrança da operadora em memória (M56, etapa 3, F2): a sessão sintética de dev/ci (E2E). O contrato, o
// produto e os beneficiários vêm da porta da F1 em memória (os mesmos que a tela de beneficiários cadastra); as
// cobranças, os itens e os reajustes ficam aqui, com as mesmas recusas do banco (a mensalidade única por contrato e
// competência, o reajuste vigente único, a versão vista e a situação) e a transação desfeita por inteiro quando a
// função falha. Nada vai ao banco.
import { ErroOperacao } from '@sgh/nucleo';
import { type DadosBaseMensalidade, type DadosBeneficiarioBase, type DadosCobranca, type DadosContratoCobranca, type DadosItemCobranca, type DadosOperadora, type DadosReajuste, type EntradaCobranca, type EntradaItemCobranca, type EntradaReajuste, type FiltroCobrancasPorta, LIMITE_CONTRATOS_GERACAO, LIMITE_PAGINA_COBRANCA, type TotaisCobranca } from './dados-portas.js';
import { hojeLocal } from './aplicacao/beneficiarios.js';
import type {
  ContextoCobranca,
  FiltroBaseMensalidades,
  GravadorCobranca,
  PortaCobrancaOperadora,
} from './cobranca-porta.js';
import type { PortaOperadora } from './porta.js';

// Os tipos da operadora, do produto, do contrato e do beneficiário são os da porta da F1 (derivados dela).
type DadosContrato = NonNullable<Awaited<ReturnType<PortaOperadora['contrato']>>>;

type Situacao = DadosCobranca['situacao'];
interface CobrancaMem {
  id: number;
  hospital: string;
  operadora: number;
  contrato: number;
  beneficiario: number | null;
  tipo: number;
  competencia: string;
  descricao: string;
  valor: number;
  vencimento: string;
  situacao: Situacao;
  situacaoEm: string;
  pagoEm: string | null;
  valorPago: number | null;
  multa: number | null;
  juros: number | null;
  dispensaMotivo: string | null;
  motivo: string | null;
  acordoOrigem: number | null;
  parcela: number | null;
  parcelas: number | null;
  acordoDestino: number | null;
  notificadoEm: string | null;
  notificacaoMeio: string | null;
  notificacaoReferencia: string | null;
  versao: number;
  emitidaEm: string;
  criadoEm: string;
  criadoPor: string;
  alteradoEm: string;
  alteradoPor: string;
  itens: EntradaItemCobranca[];
}
interface ReajusteMem extends EntradaReajuste {
  id: number;
  hospital: string;
  situacao: 'vigente' | 'cancelado';
  canceladoMotivo: string | null;
  registradoEm: string;
  registradoPor: string;
}
interface Estado {
  cobrancas: CobrancaMem[];
  reajustes: ReajusteMem[];
  seq: Record<string, number>;
}

const agora = () => new Date().toISOString().slice(0, 19);
const recusa = (codigo: string, detail: string) => new ErroOperacao(409, codigo, 'Operação recusada', detail);
const desatualizada = () =>
  recusa(
    'cobranca-desatualizada',
    'A cobrança mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira antes de gravar.',
  );

export class PortaCobrancaOperadoraMemoria implements PortaCobrancaOperadora {
  readonly destino = 'memoria' as const;
  private estado: Estado = { cobrancas: [], reajustes: [], seq: {} };

  constructor(
    private readonly f1: PortaOperadora,
    private readonly relogio: () => string = () => hojeLocal(),
  ) {}

  private proximo(nome: string): number {
    this.estado.seq[nome] = (this.estado.seq[nome] ?? 0) + 1;
    return this.estado.seq[nome];
  }

  async hoje(): Promise<string> {
    return this.relogio();
  }

  operadoras(c: ContextoCobranca): Promise<DadosOperadora[]> {
    return this.f1.operadoras(c);
  }

  /** Todos os contratos da operadora (pelas páginas da F1). */
  private async contratosDa(c: ContextoCobranca, operadora: number): Promise<DadosContrato[]> {
    const todos: DadosContrato[] = [];
    let apos: number | undefined;
    for (;;) {
      const p = await this.f1.contratos(c, { operadora, ...(apos !== undefined ? { apos } : {}) });
      todos.push(...p.itens);
      if (p.proxima === null) return todos;
      apos = p.proxima;
    }
  }

  private async beneficiariosDo(
    c: ContextoCobranca,
    operadora: number,
    contrato: number,
  ): Promise<(DadosBeneficiarioBase & { contrato: number; cpf: string | null })[]> {
    const todos: (DadosBeneficiarioBase & { contrato: number; cpf: string | null })[] = [];
    let apos: number | undefined;
    for (;;) {
      const p = await this.f1.beneficiarios(c, {
        operadora,
        contrato,
        ...(apos !== undefined ? { apos } : {}),
      });
      todos.push(
        ...p.itens.map((b) => ({
          id: b.id,
          contrato: b.contrato,
          titular: b.titular,
          nome: b.nome,
          cpf: b.cpf,
          nascimento: b.nascimento,
          inclusao: b.inclusao,
          situacao: b.situacao,
          exclusao: b.exclusao,
        })),
      );
      if (p.proxima === null) return todos;
      apos = p.proxima;
    }
  }

  private async contratoDe(c: ContextoCobranca, k: DadosContrato): Promise<DadosContratoCobranca> {
    const p = await this.f1.produto(c, k.produto);
    return {
      id: k.id,
      operadora: k.operadora,
      numero: k.numero,
      tipo: k.tipo,
      tipoContratacao: k.tipoContratacao,
      situacao: k.situacao,
      inicio: k.inicio,
      fim: k.fim,
      diaVencimento: k.diaVencimento,
      mesReajuste: k.mesReajuste,
      contratanteNome: k.contratanteNome,
      contratanteDocumento: k.contratanteDocumento,
      produto: k.produto,
      produtoNome: p?.nome ?? '',
      natureza: p?.natureza ?? 'plano',
      coparticipacao: p?.coparticipacao ?? { tipo: 1, valor: null },
      precos: p?.precos && p.precos.length === 10 ? [...p.precos] : null,
    };
  }

  async baseMensalidades(
    c: ContextoCobranca,
    f: FiltroBaseMensalidades,
  ): Promise<{ itens: DadosBaseMensalidade[]; proxima: number | null }> {
    const lista = (await this.contratosDa(c, f.operadora)).filter(
      (k) =>
        k.situacao !== 'encerrado' &&
        k.inicio <= f.ultimoDia &&
        (k.fim === null || k.fim >= f.primeiroDia) &&
        (!f.contrato || k.id === f.contrato) &&
        (!f.apos || k.id > f.apos),
    );
    const pagina = lista.slice(0, LIMITE_CONTRATOS_GERACAO);
    const itens: DadosBaseMensalidade[] = [];
    for (const k of pagina) {
      const base = await this.contratoDe(c, k);
      const bens = (await this.beneficiariosDo(c, f.operadora, k.id)).filter(
        (b) => b.inclusao <= f.ultimoDia && (b.exclusao === null || b.exclusao > f.primeiroDia),
      );
      itens.push({
        ...base,
        beneficiarios: bens.map((b) => ({
          id: b.id,
          titular: b.titular,
          nome: b.nome,
          nascimento: b.nascimento,
          inclusao: b.inclusao,
          situacao: b.situacao,
          exclusao: b.exclusao,
        })),
        reajustes: this.estado.reajustes
          .filter((r) => r.hospital === c.hospital && r.contrato === k.id && r.situacao === 'vigente')
          .filter((r) => r.competencia <= f.competencia)
          .map((r) => ({ competencia: r.competencia, percentual: r.percentual })),
        jaGerada: this.estado.cobrancas.some(
          (x) =>
            x.hospital === c.hospital &&
            x.contrato === k.id &&
            x.tipo === 1 &&
            x.competencia === f.competencia &&
            x.situacao !== 'cancelada',
        ),
      });
    }
    return {
      itens,
      proxima: lista.length > LIMITE_CONTRATOS_GERACAO ? (pagina[pagina.length - 1]?.id ?? null) : null,
    };
  }

  async contrato(c: ContextoCobranca, id: number): Promise<DadosContratoCobranca | null> {
    const k = await this.f1.contrato(c, id);
    return k ? this.contratoDe(c, k) : null;
  }

  async beneficiario(c: ContextoCobranca, id: number) {
    const b = await this.f1.beneficiario(c, id);
    return b
      ? {
          id: b.id,
          contrato: b.contrato,
          titular: b.titular,
          nome: b.nome,
          nascimento: b.nascimento,
          inclusao: b.inclusao,
          situacao: b.situacao,
          exclusao: b.exclusao,
        }
      : null;
  }

  async titular(c: ContextoCobranca, contrato: number) {
    const k = await this.f1.contrato(c, contrato);
    if (!k) return null;
    const ts = (await this.beneficiariosDo(c, k.operadora, contrato))
      .filter((b) => b.titular === null)
      .sort(
        (a, b) => (a.situacao === 'excluido' ? 1 : 0) - (b.situacao === 'excluido' ? 1 : 0) || b.id - a.id,
      );
    const t = ts[0];
    return t ? { id: t.id, nome: t.nome, cpf: t.cpf } : null;
  }

  private async lida(c: ContextoCobranca, x: CobrancaMem): Promise<DadosCobranca> {
    const k = await this.f1.contrato(c, x.contrato);
    const b = x.beneficiario !== null ? await this.f1.beneficiario(c, x.beneficiario) : null;
    return {
      id: x.id,
      operadora: x.operadora,
      contrato: x.contrato,
      beneficiario: x.beneficiario,
      tipo: x.tipo,
      competencia: x.competencia,
      descricao: x.descricao,
      valor: x.valor,
      vencimento: x.vencimento,
      situacao: x.situacao,
      situacaoEm: x.situacaoEm,
      pagoEm: x.pagoEm,
      valorPago: x.valorPago,
      multa: x.multa,
      juros: x.juros,
      dispensaMotivo: x.dispensaMotivo,
      motivo: x.motivo,
      acordoOrigem: x.acordoOrigem,
      parcela: x.parcela,
      parcelas: x.parcelas,
      acordoDestino: x.acordoDestino,
      notificadoEm: x.notificadoEm,
      notificacaoMeio: x.notificacaoMeio,
      notificacaoReferencia: x.notificacaoReferencia,
      versao: x.versao,
      emitidaEm: x.emitidaEm,
      criadoEm: x.criadoEm,
      criadoPor: x.criadoPor,
      alteradoEm: x.alteradoEm,
      alteradoPor: x.alteradoPor,
      contratoNumero: k?.numero ?? '',
      tipoContrato: k?.tipo ?? 1,
      tipoContratacao: k?.tipoContratacao ?? 1,
      pagadorNome: b?.nome ?? k?.contratanteNome ?? '',
      pagadorDocumento: b?.cpf ?? k?.contratanteDocumento ?? '',
    };
  }

  private daqui(c: ContextoCobranca) {
    return this.estado.cobrancas.filter((x) => x.hospital === c.hospital);
  }

  async cobrancas(c: ContextoCobranca, f: FiltroCobrancasPorta) {
    const numeros = new Map<number, string>();
    if (f.numero) for (const k of await this.contratosDa(c, f.operadora)) numeros.set(k.id, k.numero);
    const lista = this.daqui(c)
      .filter(
        (x) =>
          x.operadora === f.operadora &&
          (!f.competencia || x.competencia === f.competencia) &&
          (!f.situacao || x.situacao === f.situacao) &&
          (!f.tipo || x.tipo === f.tipo) &&
          (!f.contrato || x.contrato === f.contrato) &&
          (!f.vencidasAntesDe || (x.situacao === 'aberta' && x.vencimento < f.vencidasAntesDe)) &&
          (!f.numero || (numeros.get(x.contrato) ?? '').startsWith(f.numero)) &&
          (!f.apos || x.id < f.apos),
      )
      .sort((a, b) => b.id - a.id);
    const pagina = lista.slice(0, LIMITE_PAGINA_COBRANCA);
    const itens = await Promise.all(pagina.map((x) => this.lida(c, x)));
    return {
      itens,
      proxima: lista.length > LIMITE_PAGINA_COBRANCA ? (itens[itens.length - 1]?.id ?? null) : null,
    };
  }

  async cobranca(c: ContextoCobranca, id: number): Promise<DadosCobranca | null> {
    const x = this.daqui(c).find((y) => y.id === id);
    return x ? this.lida(c, x) : null;
  }

  async itens(c: ContextoCobranca, cobranca: number): Promise<DadosItemCobranca[]> {
    const x = this.daqui(c).find((y) => y.id === cobranca);
    if (!x) return [];
    const r: DadosItemCobranca[] = [];
    for (const i of x.itens) {
      const b = i.beneficiario !== null ? await this.f1.beneficiario(c, i.beneficiario) : null;
      r.push({ ...i, beneficiarioNome: b?.nome ?? null });
    }
    return r;
  }

  async renegociadas(c: ContextoCobranca, acordo: number): Promise<DadosCobranca[]> {
    const ls = this.daqui(c)
      .filter((x) => x.acordoDestino === acordo)
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.id - b.id);
    return Promise.all(ls.map((x) => this.lida(c, x)));
  }

  async doContrato(
    c: ContextoCobranca,
    contratos: readonly number[],
    desde: string,
  ): Promise<DadosCobranca[]> {
    const ls = this.daqui(c)
      .filter((x) => contratos.includes(x.contrato) && (x.vencimento >= desde || x.situacao === 'aberta'))
      .sort((a, b) => a.contrato - b.contrato || a.vencimento.localeCompare(b.vencimento) || a.id - b.id);
    return Promise.all(ls.map((x) => this.lida(c, x)));
  }

  async totais(c: ContextoCobranca, operadora: number, hoje: string): Promise<TotaisCobranca> {
    const da = this.daqui(c).filter((x) => x.operadora === operadora);
    const abertas = da.filter((x) => x.situacao === 'aberta');
    const vencidas = abertas.filter((x) => x.vencimento < hoje);
    const pagas = da.filter(
      (x) =>
        x.situacao === 'paga' &&
        x.pagoEm !== null &&
        x.pagoEm >= `${hoje.slice(0, 7)}-01` &&
        x.pagoEm <= hoje,
    );
    const soma = (l: CobrancaMem[], f: (x: CobrancaMem) => number) =>
      Math.round(l.reduce((s, x) => s + f(x), 0) * 100) / 100;
    return {
      abertas: abertas.length,
      valorAberto: soma(abertas, (x) => x.valor),
      vencidas: vencidas.length,
      valorVencido: soma(vencidas, (x) => x.valor),
      pagasNoMes: pagas.length,
      valorPagoNoMes: soma(pagas, (x) => x.valorPago ?? 0),
    };
  }

  async inadimplentes(c: ContextoCobranca, f: { operadora: number; hoje: string; apos?: number }) {
    const grupos = new Map<number, CobrancaMem[]>();
    for (const x of this.daqui(c))
      if (
        x.operadora === f.operadora &&
        x.situacao === 'aberta' &&
        x.vencimento < f.hoje &&
        (!f.apos || x.contrato > f.apos)
      )
        grupos.set(x.contrato, [...(grupos.get(x.contrato) ?? []), x]);
    const todos = [...grupos.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([contrato, l]) => ({
        contrato,
        vencidas: l.length,
        valorVencido: Math.round(l.reduce((s, x) => s + x.valor, 0) * 100) / 100,
        maisAntigo: l.map((x) => x.vencimento).sort()[0]!,
      }));
    const itens = todos.slice(0, LIMITE_PAGINA_COBRANCA);
    return {
      itens,
      proxima: todos.length > LIMITE_PAGINA_COBRANCA ? (itens[itens.length - 1]?.contrato ?? null) : null,
    };
  }

  private async reajusteLido(c: ContextoCobranca, r: ReajusteMem): Promise<DadosReajuste> {
    const k = await this.f1.contrato(c, r.contrato);
    return {
      id: r.id,
      operadora: r.operadora,
      contrato: r.contrato,
      competencia: r.competencia,
      percentual: r.percentual,
      tetoAns: r.tetoAns,
      oficioAns: r.oficioAns,
      vidas: r.vidas,
      motivo: r.motivo,
      situacao: r.situacao,
      canceladoMotivo: r.canceladoMotivo,
      registradoEm: r.registradoEm,
      registradoPor: r.registradoPor,
      contratoNumero: k?.numero ?? '',
      tipoContratacao: k?.tipoContratacao ?? 1,
    };
  }

  async reajustes(c: ContextoCobranca, f: { operadora: number; contrato?: number; apos?: number }) {
    const lista = this.estado.reajustes
      .filter(
        (r) =>
          r.hospital === c.hospital &&
          r.operadora === f.operadora &&
          (!f.contrato || r.contrato === f.contrato) &&
          (!f.apos || r.id < f.apos),
      )
      .sort((a, b) => b.id - a.id);
    const pagina = lista.slice(0, LIMITE_PAGINA_COBRANCA);
    const itens = await Promise.all(pagina.map((r) => this.reajusteLido(c, r)));
    return {
      itens,
      proxima: lista.length > LIMITE_PAGINA_COBRANCA ? (itens[itens.length - 1]?.id ?? null) : null,
    };
  }

  async reajuste(c: ContextoCobranca, id: number): Promise<DadosReajuste | null> {
    const r = this.estado.reajustes.find((x) => x.hospital === c.hospital && x.id === id);
    return r ? this.reajusteLido(c, r) : null;
  }

  async situacaoReajuste(c: ContextoCobranca, contrato: number) {
    const k = await this.f1.contrato(c, contrato);
    const vidas = k
      ? (await this.beneficiariosDo(c, k.operadora, contrato)).filter((b) => b.situacao !== 'excluido').length
      : 0;
    const mensalidades = this.daqui(c)
      .filter((x) => x.contrato === contrato && x.tipo === 1 && x.situacao !== 'cancelada')
      .map((x) => x.competencia)
      .sort();
    return {
      vigentes: this.estado.reajustes
        .filter((r) => r.hospital === c.hospital && r.contrato === contrato && r.situacao === 'vigente')
        .map((r) => r.competencia)
        .sort(),
      ultimaMensalidade: mensalidades.at(-1) ?? null,
      vidas,
    };
  }

  async gravar<T>(
    c: ContextoCobranca,
    _trilha: unknown,
    fn: (g: GravadorCobranca) => Promise<T>,
  ): Promise<T> {
    const antes = structuredClone(this.estado);
    const hoje = this.relogio();
    const achar = (id: number, versao: number, situacao: Situacao) => {
      const x = this.daqui(c).find((y) => y.id === id);
      if (!x || x.versao !== versao || x.situacao !== situacao) throw desatualizada();
      return x;
    };
    const tocar = (x: CobrancaMem, por: string) => {
      x.versao++;
      x.alteradoPor = por;
      x.alteradoEm = agora();
    };
    const g: GravadorCobranca = {
      incluir: async (d: EntradaCobranca & { por: string }) => {
        if (
          d.tipo === 1 &&
          this.daqui(c).some(
            (x) =>
              x.contrato === d.contrato &&
              x.tipo === 1 &&
              x.competencia === d.competencia &&
              x.situacao !== 'cancelada',
          )
        )
          throw recusa(
            'mensalidade-ja-gerada',
            'A mensalidade desta competência já foi gerada para o contrato (outra pessoa gerou agora).',
          );
        if (d.tipo === 1 && d.reajustes) {
          // Como o banco: os reajustes vigentes de agora têm de ser os da conta (D-REAJUSTE-56).
          const chave = (r: { competencia: string; percentual: number }) =>
            `${r.competencia}:${Math.round(r.percentual * 10_000)}`;
          const agora = this.estado.reajustes
            .filter(
              (r) =>
                r.hospital === c.hospital &&
                r.contrato === d.contrato &&
                r.situacao === 'vigente' &&
                r.competencia <= d.competencia,
            )
            .map(chave)
            .sort();
          const antes = d.reajustes.map(chave).sort();
          if (agora.join('|') !== antes.join('|'))
            throw recusa(
              'reajuste-mudou',
              'Os reajustes do contrato mudaram durante a geração (outra pessoa registrou ou cancelou). Gere de novo.',
            );
        }
        const id = this.proximo('cobranca');
        this.estado.cobrancas.push({
          id,
          hospital: c.hospital,
          operadora: d.operadora,
          contrato: d.contrato,
          beneficiario: d.beneficiario,
          tipo: d.tipo,
          competencia: d.competencia,
          descricao: d.descricao,
          valor: Math.round(d.valor * 100) / 100,
          vencimento: d.vencimento,
          situacao: 'aberta',
          situacaoEm: hoje,
          pagoEm: null,
          valorPago: null,
          multa: null,
          juros: null,
          dispensaMotivo: null,
          motivo: null,
          acordoOrigem: d.acordoOrigem,
          parcela: d.parcela,
          parcelas: d.parcelas,
          acordoDestino: null,
          notificadoEm: null,
          notificacaoMeio: null,
          notificacaoReferencia: null,
          versao: 0,
          emitidaEm: hoje,
          criadoEm: agora(),
          criadoPor: d.por,
          alteradoEm: agora(),
          alteradoPor: d.por,
          itens: d.itens.map((i) => ({ ...i, valor: Math.round(i.valor * 100) / 100 })),
        });
        return { id, versao: 0 };
      },
      baixar: async (b) => {
        const x = achar(b.id, b.versao, 'aberta');
        Object.assign(x, {
          situacao: 'paga',
          situacaoEm: b.pagoEm,
          pagoEm: b.pagoEm,
          valorPago: b.valorPago,
          multa: b.multa,
          juros: b.juros,
          dispensaMotivo: b.dispensaMotivo,
        });
        tocar(x, b.por);
        return { id: x.id, versao: x.versao };
      },
      cancelar: async (k) => {
        const x = achar(k.id, k.versao, 'aberta');
        Object.assign(x, { situacao: 'cancelada', situacaoEm: hoje, motivo: k.motivo });
        tocar(x, k.por);
        return { id: x.id, versao: x.versao };
      },
      estornar: async (k) => {
        const x = achar(k.id, k.versao, 'paga');
        Object.assign(x, {
          situacao: 'aberta',
          situacaoEm: hoje,
          pagoEm: null,
          valorPago: null,
          multa: null,
          juros: null,
          dispensaMotivo: null,
          motivo: k.motivo,
        });
        tocar(x, k.por);
        return { id: x.id, versao: x.versao };
      },
      proximoAcordo: async () => this.proximo('acordo'),
      renegociar: async (k) => {
        const x = achar(k.id, k.versao, 'aberta');
        if (x.contrato !== k.contrato) throw desatualizada();
        Object.assign(x, { situacao: 'renegociada', situacaoEm: hoje, acordoDestino: k.acordo });
        tocar(x, k.por);
      },
      notificar: async (k) => {
        const alvo = this.daqui(c).filter(
          (x) =>
            x.contrato === k.contrato &&
            x.situacao === 'aberta' &&
            x.vencimento < k.hoje &&
            x.notificadoEm === null,
        );
        if (alvo.length === 0)
          throw recusa(
            'notificacao-sem-atraso',
            'O contrato não tem cobrança vencida em aberto sem notificação (outra pessoa registrou agora).',
          );
        for (const x of alvo) {
          Object.assign(x, {
            notificadoEm: k.em,
            notificacaoMeio: k.meio,
            notificacaoReferencia: k.referencia,
          });
          tocar(x, k.por);
        }
        return { cobrancas: alvo.length };
      },
      registrarReajuste: async (r) => {
        if (
          this.estado.reajustes.some(
            (x) =>
              x.hospital === c.hospital &&
              x.contrato === r.contrato &&
              x.competencia === r.competencia &&
              x.situacao === 'vigente',
          )
        )
          throw recusa('reajuste-ja-registrado', 'Já existe reajuste vigente nesta competência do contrato.');
        const id = this.proximo('reajuste');
        const { por, ...dados } = r;
        this.estado.reajustes.push({
          ...dados,
          id,
          hospital: c.hospital,
          situacao: 'vigente',
          canceladoMotivo: null,
          registradoEm: agora(),
          registradoPor: por,
        });
        return { id };
      },
      cancelarReajuste: async (k) => {
        const r = this.estado.reajustes.find(
          (x) => x.hospital === c.hospital && x.id === k.id && x.situacao === 'vigente',
        );
        if (!r) throw recusa('reajuste-cancelado', 'O reajuste já está cancelado.');
        if (
          this.estado.cobrancas.some(
            (x) =>
              x.hospital === c.hospital &&
              x.contrato === r.contrato &&
              x.tipo === 1 &&
              x.situacao !== 'cancelada' &&
              x.competencia >= r.competencia,
          )
        )
          throw recusa(
            'reajuste-ja-cobrado',
            'A mensalidade com este reajuste já foi gerada: cancele-a antes de cancelar o reajuste.',
          );
        r.situacao = 'cancelado';
        r.canceladoMotivo = k.motivo;
        return { id: r.id };
      },
    };
    try {
      return await fn(g);
    } catch (e) {
      this.estado = antes;
      throw e;
    }
  }
}
