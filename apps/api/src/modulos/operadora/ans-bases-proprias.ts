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
type DadosContrato = NonNullable<Awaited<ReturnType<PortaOperadora['contrato']>>>;

/** As portas próprias irmãs de que as bases da ANS dependem. */
export interface FontesAnsProprias {
  readonly operadora: PortaOperadora;
  readonly cobranca: PortaCobrancaOperadora | null;
  readonly contas: PortaContasOperadora | null;
}

type LerComplemento = (c: ContextoAns, beneficiario: number) => Promise<DadosComplementoSib | null>;

/** Memória de uma chamada: cada contrato, produto, beneficiário e complemento é lido uma vez só. */
class LeiturasDaChamada {
  private readonly contratos = new Map<number, Promise<DadosContrato | null>>();
  private readonly produtos = new Map<number, Promise<DadosProduto | null>>();
  private readonly beneficiarios = new Map<number, Promise<DadosBeneficiario | null>>();
  private readonly complementos = new Map<number, Promise<DadosComplementoSib | null>>();

  constructor(
    private readonly c: ContextoAns,
    private readonly operadora: PortaOperadora,
    private readonly complementoDe: LerComplemento,
  ) {}

  private static uma<T>(m: Map<number, Promise<T>>, id: number, ler: () => Promise<T>): Promise<T> {
    let p = m.get(id);
    if (!p) {
      p = ler();
      m.set(id, p);
    }
    return p;
  }

  /** Guarda um beneficiário já lido (numa página) para não relê-lo pelo id. */
  conhecido(b: DadosBeneficiario): void {
    if (!this.beneficiarios.has(b.id)) this.beneficiarios.set(b.id, Promise.resolve(b));
  }

  beneficiario(id: number): Promise<DadosBeneficiario | null> {
    return LeiturasDaChamada.uma(this.beneficiarios, id, () => this.operadora.beneficiario(this.c, id));
  }

  complemento(id: number): Promise<DadosComplementoSib | null> {
    return LeiturasDaChamada.uma(this.complementos, id, () => this.complementoDe(this.c, id));
  }

  async contratoEProduto(
    contrato: number,
  ): Promise<{ contrato: DadosContrato | null; produto: DadosProduto | null }> {
    const k = await LeiturasDaChamada.uma(this.contratos, contrato, () =>
      this.operadora.contrato(this.c, contrato),
    );
    const produto = k
      ? await LeiturasDaChamada.uma(this.produtos, k.produto, () => this.operadora.produto(this.c, k.produto))
      : null;
    return { contrato: k, produto };
  }
}

export class BasesAnsProprias {
  constructor(
    private readonly f: FontesAnsProprias,
    private readonly complementoDe: LerComplemento,
  ) {}

  private leituras(c: ContextoAns): LeiturasDaChamada {
    return new LeiturasDaChamada(c, this.f.operadora, this.complementoDe);
  }

  /** Percorre os beneficiários da operadora em páginas reais do banco (pelo id, a partir de `apos`). */
  private async *paginasBeneficiarios(
    c: ContextoAns,
    operadora: number,
    apos?: number,
  ): AsyncGenerator<readonly DadosBeneficiario[]> {
    let cursor = apos;
    for (;;) {
      const p = await this.f.operadora.beneficiarios(c, {
        operadora,
        ...(cursor === undefined ? {} : { apos: cursor }),
      });
      yield p.itens;
      if (p.proxima === null) return;
      cursor = p.proxima;
    }
  }

  async beneficiariosSib(
    c: ContextoAns,
    operadora: number,
    apos: number,
  ): Promise<{ itens: DadosBeneficiarioSib[]; proxima: number | null }> {
    // Só a página pedida (mais um, para saber se há próxima), lida do banco a partir de `apos`.
    const lidos: DadosBeneficiario[] = [];
    for await (const p of this.paginasBeneficiarios(c, operadora, apos)) {
      lidos.push(...p);
      if (lidos.length > LIMITE_PAGINA_SIB) break;
    }
    const pagina = lidos.slice(0, LIMITE_PAGINA_SIB);
    const ler = this.leituras(c);
    for (const b of lidos) ler.conhecido(b);
    const itens: DadosBeneficiarioSib[] = [];
    for (const b of pagina) {
      const x = await ler.contratoEProduto(b.contrato);
      // O titular é lido pelo id quando não está na página (ex.: titular de id menor que `apos`).
      const t = b.titular === null ? null : await ler.beneficiario(b.titular);
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
            : {
                id: b.titular,
                carteirinha: t?.carteirinha ?? '',
                cco: (await ler.complemento(b.titular))?.cco ?? null,
              },
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
        complemento: await ler.complemento(b.id),
      });
    }
    return {
      itens,
      proxima: lidos.length > LIMITE_PAGINA_SIB ? (itens[itens.length - 1]?.id ?? null) : null,
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
    const ler = this.leituras(c);
    const r: DadosItemSip[] = [];
    for (const k of (await this.contasDa(c, operadora)).filter((x) => x.situacao !== 'devolvida')) {
      const guias = new Map((await contas.guias(c, k.id)).map((g) => [g.id, g]));
      for (const i of await contas.itens(c, k.id)) {
        if (i.data < inicio || i.data > fim || i.id <= apos) continue;
        const g = guias.get(i.guia);
        const b = g?.beneficiario ? await ler.beneficiario(g.beneficiario.id) : null;
        const p = b ? (await ler.contratoEProduto(b.contrato)).produto : null;
        r.push({
          id: i.id,
          beneficiario: b?.id ?? null,
          segmentacao: p?.segmentacao ?? null,
          municipio: b ? ((await ler.complemento(b.id))?.municipio ?? null) : null,
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
    const ler = this.leituras(c);
    const r: DadosGuiaMonitoramento[] = [];
    for (const k of await this.contasDa(c, operadora)) {
      if (k.situacao !== 'analisada' && k.situacao !== 'paga') continue;
      const ficha = await contas.conta(c, k.id);
      const dia = (ficha?.analisadaEm ?? '').slice(0, 10);
      if (!dia || dia < inicio || dia > fim) continue;
      const itens = await contas.itens(c, k.id);
      for (const g of await contas.guias(c, k.id)) {
        if (r.length > teto) return r;
        const b = g.beneficiario ? await ler.beneficiario(g.beneficiario.id) : null;
        const x = b ? await ler.complemento(b.id) : null;
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
    const ler = this.leituras(c);
    // Mesma regra da memória (a carteirinha vale antes do CNS; cada beneficiário uma vez, na ordem do id), sem
    // percorrer a operadora inteira quando todas as identificações são carteirinhas: primeiro a busca indexada pela
    // carteirinha; só as identificações que sobrarem (CNS) pedem a varredura, em páginas reais do banco.
    const achados = new Map<number, { b: DadosBeneficiario; ident: string }>();
    const sobra = new Set(ids);
    for (const ident of ids) {
      const p = await this.f.operadora.beneficiarios(c, { operadora, carteirinha: ident });
      for (const b of p.itens)
        if (b.carteirinha === ident) {
          achados.set(b.id, { b, ident });
          sobra.delete(ident);
        }
    }
    if (sobra.size > 0)
      for await (const p of this.paginasBeneficiarios(c, operadora))
        for (const b of p)
          if (!achados.has(b.id) && b.cns && sobra.has(b.cns)) achados.set(b.id, { b, ident: b.cns });
    const r: DadosBeneficiarioRessarcimento[] = [];
    for (const { b, ident } of [...achados.values()].sort((x, y) => x.b.id - y.b.id)) {
      const x = await ler.contratoEProduto(b.contrato);
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
        coberturaParcial: (await ler.complemento(b.id))?.coberturaParcial ?? false,
      });
    }
    return r;
  }
}
