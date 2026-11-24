// Bases das obrigações da ANS (Agência Nacional de Saúde Suplementar) no banco próprio: pendências do SIB (sistema de
// informações de beneficiários), itens e vigências do SIP (sistema de informações de produtos), contraprestações do
// DIOPS (documento de informações periódicas), guias do monitoramento TISS e identificação dos beneficiários do aviso
// de ressarcimento ao SUS.
// Mesma regra da porta de memória (a especificação): cada base é montada a partir das portas PRÓPRIAS irmãs do módulo
// (beneficiários, contratos e produtos da F1; contas médicas da F5; cobrança da F2), que já leem o banco do cliente
// filtrando pelo estabelecimento da sessão. O complemento do beneficiário (CCO, município do endereço do cadastro,
// cobertura parcial temporária) é o do próprio banco (o mesmo da leitura `complementoSib` da porta própria).
// Sem a porta de contas ou de cobrança (montagem parcial), a base correspondente sai vazia, como na memória.
import type { ContextoAns } from './ans-porta.js';
import type { PortaCobrancaOperadora } from './cobranca-porta.js';
import type { PortaContasOperadora } from './contas-porta.js';
import {
  type DadosBeneficiarioRessarcimento,
  type DadosBeneficiarioSib,
  type DadosCobrancaDiops,
  type DadosComplementoSib,
  type DadosGuiaMonitoramento,
  type DadosItemSip,
  type DadosVigenciaSip,
  LIMITE_PAGINA_SIB,
} from './dados-portas.js';
import type { PortaOperadora } from './porta.js';

type DadosBeneficiario = NonNullable<Awaited<ReturnType<PortaOperadora['beneficiario']>>>;
type DadosProduto = NonNullable<Awaited<ReturnType<PortaOperadora['produto']>>>;

/** As portas próprias irmãs de que as bases da ANS dependem. */
export interface FontesAnsProprias {
  readonly operadora: PortaOperadora;
  readonly cobranca: PortaCobrancaOperadora | null;
  readonly contas: PortaContasOperadora | null;
}

type LerComplemento = (c: ContextoAns, beneficiario: number) => Promise<DadosComplementoSib | null>;

export class BasesAnsProprias {
  constructor(
    private readonly f: FontesAnsProprias,
    private readonly complementoDe: LerComplemento,
  ) {}

  private async todosBeneficiarios(c: ContextoAns, operadora: number): Promise<DadosBeneficiario[]> {
    const r: DadosBeneficiario[] = [];
    let apos: number | undefined;
    for (;;) {
      const p = await this.f.operadora.beneficiarios(c, {
        operadora,
        ...(apos === undefined ? {} : { apos }),
      });
      r.push(...p.itens);
      if (p.proxima === null) return r;
      apos = p.proxima;
    }
  }

  private async produtosPorContrato(c: ContextoAns, contratos: readonly number[]) {
    const m = new Map<
      number,
      { contrato: Awaited<ReturnType<PortaOperadora['contrato']>>; produto: DadosProduto | null }
    >();
    for (const id of new Set(contratos)) {
      const contrato = await this.f.operadora.contrato(c, id);
      m.set(id, { contrato, produto: contrato ? await this.f.operadora.produto(c, contrato.produto) : null });
    }
    return m;
  }

  /** O complemento de cada beneficiário, lido uma vez por chamada. */
  private complementos(c: ContextoAns) {
    const m = new Map<number, Promise<DadosComplementoSib | null>>();
    return (id: number) => {
      let p = m.get(id);
      if (!p) {
        p = this.complementoDe(c, id);
        m.set(id, p);
      }
      return p;
    };
  }

  async beneficiariosSib(
    c: ContextoAns,
    operadora: number,
    apos: number,
  ): Promise<{ itens: DadosBeneficiarioSib[]; proxima: number | null }> {
    const todos = (await this.todosBeneficiarios(c, operadora)).filter((b) => b.id > apos);
    const pagina = todos.slice(0, LIMITE_PAGINA_SIB);
    const porId = new Map(todos.map((b) => [b.id, b]));
    const pc = await this.produtosPorContrato(
      c,
      pagina.map((b) => b.contrato),
    );
    const comp = this.complementos(c);
    const itens: DadosBeneficiarioSib[] = [];
    for (const b of pagina) {
      const x = pc.get(b.contrato);
      const t = b.titular === null ? null : (porId.get(b.titular) ?? null);
      itens.push({
        id: b.id,
        operadora: b.operadora,
        carteirinha: b.carteirinha,
        nome: b.nome,
        nascimento: b.nascimento,
        sexo: b.sexo === 'M' || b.sexo === 'I' ? b.sexo : 'F',
        cpf: b.cpf,
        cns: b.cns,
        nomeMae: b.nomeMae,
        vinculo: b.vinculo,
        titular:
          b.titular === null
            ? null
            : { id: b.titular, carteirinha: t?.carteirinha ?? '', cco: (await comp(b.titular))?.cco ?? null },
        inclusao: b.inclusao,
        situacao: b.situacao,
        exclusao: b.exclusao,
        produto: {
          id: x?.produto?.id ?? 0,
          natureza: x?.produto?.natureza ?? 'plano',
          registroAns: x?.produto?.registroAns ?? null,
          segmentacao: x?.produto?.segmentacao ?? null,
        },
        contrato: {
          id: b.contrato,
          numero: b.contratoNumero,
          tipo: x?.contrato?.tipo ?? 1,
          contratanteDoc: x?.contrato?.contratanteDocumento ?? '',
        },
        complemento: await comp(b.id),
      });
    }
    return {
      itens,
      proxima: todos.length > LIMITE_PAGINA_SIB ? (itens[itens.length - 1]?.id ?? null) : null,
    };
  }

  /** As contas médicas da operadora (todas as páginas). */
  private async contasDa(c: ContextoAns, operadora: number) {
    const contas = this.f.contas;
    if (!contas) return [];
    const r: Awaited<ReturnType<PortaContasOperadora['contas']>>['itens'] = [];
    let apos: number | undefined;
    for (;;) {
      const p = await contas.contas(c, apos === undefined ? {} : { apos });
      r.push(...p.itens);
      if (p.proxima === null) break;
      apos = p.proxima;
    }
    return r.filter((k) => k.operadora === operadora);
  }

  async itensSip(
    c: ContextoAns,
    operadora: number,
    inicio: string,
    fim: string,
    apos: number,
  ): Promise<{ itens: DadosItemSip[]; proxima: number | null }> {
    const contas = this.f.contas;
    if (!contas) return { itens: [], proxima: null };
    const comp = this.complementos(c);
    const r: DadosItemSip[] = [];
    for (const k of (await this.contasDa(c, operadora)).filter((x) => x.situacao !== 'devolvida')) {
      const guias = new Map((await contas.guias(c, k.id)).map((g) => [g.id, g]));
      for (const i of await contas.itens(c, k.id)) {
        if (i.data < inicio || i.data > fim || i.id <= apos) continue;
        const g = guias.get(i.guia);
        const b = g?.beneficiario ? await this.f.operadora.beneficiario(c, g.beneficiario.id) : null;
        const p = b ? (await this.produtosPorContrato(c, [b.contrato])).get(b.contrato)?.produto : null;
        r.push({
          id: i.id,
          beneficiario: b?.id ?? null,
          segmentacao: p?.segmentacao ?? null,
          municipio: b ? ((await comp(b.id))?.municipio ?? null) : null,
          dataExecucao: i.data,
          tabela: i.tabela,
          codigo: i.codigo,
          quantidade: i.quantidade,
          apresentado: i.apresentado,
          glosado: i.glosado,
        });
      }
    }
    return { itens: r.sort((a, b) => a.id - b.id), proxima: null };
  }

  async vigenciasSip(c: ContextoAns, procedimentos: readonly number[]): Promise<DadosVigenciaSip[]> {
    const r: DadosVigenciaSip[] = [];
    for (const p of new Set(procedimentos)) {
      const x = await this.f.operadora.procedimentosSip(c, { procedimento: p });
      for (const v of x.itens)
        r.push({
          procedimento: v.procedimento,
          grupo: v.grupo,
          inicio: v.vigenciaInicial ?? '1900-01-01',
          fim: v.vigenciaFinal,
        });
    }
    return r;
  }

  async cobrancasDiops(
    c: ContextoAns,
    operadora: number,
    meses: readonly string[],
    inicio: string,
    fim: string,
  ): Promise<DadosCobrancaDiops[]> {
    const cobranca = this.f.cobranca;
    if (!cobranca) return [];
    const r: DadosCobrancaDiops[] = [];
    let apos: number | undefined;
    for (;;) {
      const p = await cobranca.cobrancas(c, { operadora, ...(apos === undefined ? {} : { apos }) });
      for (const x of p.itens) {
        const entra =
          meses.includes(x.competencia) ||
          (x.pagoEm !== null && x.pagoEm >= inicio && x.pagoEm <= fim) ||
          (x.vencimento < fim &&
            (x.situacao === 'aberta' || (x.situacao === 'paga' && (x.pagoEm ?? '') > fim)));
        if (entra)
          r.push({
            tipo: x.tipo,
            competencia: x.competencia,
            valor: x.valor,
            situacao: x.situacao,
            vencimento: x.vencimento,
            pagoEm: x.pagoEm,
            valorPago: x.valorPago,
          });
      }
      if (p.proxima === null) return r;
      apos = p.proxima;
    }
  }

  async guiasMonitoramento(
    c: ContextoAns,
    operadora: number,
    inicio: string,
    fim: string,
    teto: number,
  ): Promise<DadosGuiaMonitoramento[]> {
    const contas = this.f.contas;
    if (!contas) return [];
    const comp = this.complementos(c);
    const r: DadosGuiaMonitoramento[] = [];
    for (const k of await this.contasDa(c, operadora)) {
      if (k.situacao !== 'analisada' && k.situacao !== 'paga') continue;
      const ficha = await contas.conta(c, k.id);
      const dia = (ficha?.analisadaEm ?? '').slice(0, 10);
      if (!dia || dia < inicio || dia > fim) continue;
      const itens = await contas.itens(c, k.id);
      for (const g of await contas.guias(c, k.id)) {
        if (r.length > teto) return r;
        const b = g.beneficiario ? await this.f.operadora.beneficiario(c, g.beneficiario.id) : null;
        const x = b ? await comp(b.id) : null;
        r.push({
          id: g.id,
          protocolo: k.protocolo,
          prestadorDocumento: ficha?.prestadorDocumento ?? '',
          prestadorCnes: ficha?.prestadorCnes ?? null,
          numeroGuiaPrestador: g.numeroGuiaPrestador,
          numeroGuiaOperadora: g.numeroGuiaOperadora,
          tipoGuia: k.tipoGuia,
          carater: g.carater,
          inicio: g.inicio,
          fim: g.fim,
          carteirinhaApresentada: g.carteirinha,
          beneficiario: b
            ? {
                id: b.id,
                carteirinha: b.carteirinha,
                cns: b.cns,
                sexo: b.sexo,
                nascimento: b.nascimento,
                municipio: x?.municipio ?? null,
                cco: x?.cco ?? null,
              }
            : null,
          itens: itens
            .filter((i) => i.guia === g.id)
            .map((i) => ({
              tabela: i.tabela,
              codigo: i.codigo,
              quantidade: i.quantidade,
              informado: i.apresentado,
              glosado: i.glosado,
            })),
        });
      }
    }
    return r;
  }

  async beneficiariosRessarcimento(
    c: ContextoAns,
    operadora: number,
    identificacoes: readonly string[],
  ): Promise<DadosBeneficiarioRessarcimento[]> {
    const ids = new Set(identificacoes);
    const r: DadosBeneficiarioRessarcimento[] = [];
    for (const b of await this.todosBeneficiarios(c, operadora)) {
      const ident = ids.has(b.carteirinha) ? b.carteirinha : b.cns && ids.has(b.cns) ? b.cns : null;
      if (!ident) continue;
      const x = (await this.produtosPorContrato(c, [b.contrato])).get(b.contrato);
      r.push({
        identificacao: ident,
        id: b.id,
        carteirinha: b.carteirinha,
        situacao: b.situacao,
        inclusao: b.inclusao,
        contrato: {
          situacao: x?.contrato?.situacao ?? 'ativo',
          inicio: x?.contrato?.inicio ?? b.inclusao,
          fim: x?.contrato?.fim ?? null,
        },
        produto: {
          situacao: x?.produto?.situacao ?? 'ativo',
          natureza: x?.produto?.natureza ?? 'plano',
          carencias: JSON.stringify(x?.produto?.carencias ?? { urgencia: 0, partos: 0, demais: 0, cpt: 0 }),
          segmentacao: x?.produto?.segmentacao ?? null,
        },
        coberturaParcial: (await this.complementoDe(c, b.id))?.coberturaParcial ?? false,
      });
    }
    return r;
  }
}
