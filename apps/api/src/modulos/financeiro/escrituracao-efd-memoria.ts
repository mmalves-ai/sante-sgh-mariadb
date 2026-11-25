// F3.8, 07-FIN linha 108: a escrituração das entradas e a EFD-Contribuições em MEMÓRIA, só para a fonte sintética (o
// E2E e o desenvolvimento sem banco). As regras são as mesmas do domínio (escrituracao-entrada.ts); a função coberta
// grava no MariaDB pela porta própria (escrituracao-efd-propria.ts). Massa sintética: nenhum documento real.
import {
  conferirClassificacaoItem,
  conferirEntregaEfd,
  conferirGeracaoEfd,
  conferirSomasEfd,
  creditoDoItem,
  cstDaCredito,
  type DeclaranteEfd,
  montarEfdContribuicoes,
  NATUREZAS_BASE_CREDITO,
  pendenciasDoItem,
  type RecusaFinanceiro,
  type RegimeEfd,
  totaisDoDocumento,
} from '@sgh/dominio-financeiro';
import { recusa } from '@sgh/nucleo';
import {
  type ArquivoEfdTela,
  type ClassificarEntrada,
  type EntradaEscrituracaoTela,
  type EntregaEfd,
  type GerarEfd,
  hashDoArquivoEfd,
  type ItemEscrituracaoTela,
  type PainelEscrituracao,
} from './escrituracao-efd-propria.js';

type Mutavel<T> = { -readonly [K in keyof T]: T[K] };
interface ArquivoMemoria extends Mutavel<Omit<ArquivoEfdTela, 'confere'>> {
  periodo: string;
  conteudo: string;
}

const DECLARANTE: DeclaranteEfd = {
  cnpj: '92070000000199',
  nome: 'HOSPITAL SINTETICO',
  uf: 'SP',
  codigoMunicipio: '3550308',
  inscricaoEstadual: null,
  inscricaoMunicipal: null,
};
const CFOPS = [
  { codigo: '1556', descricao: 'Compra de material para uso ou consumo' },
  { codigo: '1933', descricao: 'Aquisição de serviço tributado pelo imposto sobre serviços' },
  { codigo: '2556', descricao: 'Compra de material para uso ou consumo, de outro estado' },
];

function recusar(r: RecusaFinanceiro | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
}

export class EscrituracaoMemoria {
  private readonly entradas = new Map<string, Mutavel<EntradaEscrituracaoTela>[]>();
  private readonly arquivos: ArquivoMemoria[] = [];
  private proximo = 9000;

  private item(sequencia: number, valor: number, cfop: string): ItemEscrituracaoTela {
    const i = {
      sequencia,
      cfop,
      codigoItem: `SINT-${sequencia}`,
      descricao: 'ITEM SINTETICO',
      quantidade: 1,
      unidade: 'UN',
      valorItem: valor,
      valorDesconto: 0,
      cstPis: null,
      basePis: 0,
      aliquotaPis: null,
      valorPis: 0,
      cstCofins: null,
      baseCofins: 0,
      aliquotaCofins: null,
      valorCofins: 0,
      naturezaCredito: null,
    };
    return { ...i, pendencias: pendenciasDoItem(i) };
  }

  /** A competência pedida nasce com duas entradas sintéticas ainda por classificar. */
  private daCompetencia(periodo: string): Mutavel<EntradaEscrituracaoTela>[] {
    let xs = this.entradas.get(periodo);
    if (!xs) {
      const doc = (n: number, servico: boolean, itens: ItemEscrituracaoTela[]) => ({
        id: ++this.proximo,
        versao: 1,
        servico,
        participanteDocumento: '92070000000107',
        participanteNome: 'FORNECEDOR SINTETICO',
        modelo: servico ? '99' : '55',
        serie: '1',
        numero: String(n),
        chave: null,
        dataEmissao: `${periodo}-05`,
        dataEntrada: `${periodo}-06`,
        situacaoDocumento: '00',
        situacao: 'pendente',
        valorDocumento: itens.reduce((s, i) => s + i.valorItem, 0),
        valorDesconto: 0,
        valorPis: 0,
        valorCofins: 0,
        cfop: itens[0]!.cfop,
        arquivo: null,
        itens,
        pendencias: itens.reduce((s, i) => s + i.pendencias.length, 0),
      });
      xs = [
        doc(1001, false, [this.item(1, 1000, '5102')]),
        doc(1002, true, [this.item(1, 300, '1933'), this.item(2, 200, '1933')]),
      ];
      this.entradas.set(periodo, xs);
    }
    return xs;
  }

  private texto(periodo: string, regime: RegimeEfd, reciboAnterior: string | null) {
    const documentos = this.daCompetencia(periodo);
    const pedido = { declarante: DECLARANTE, periodo, regime, reciboAnterior, documentos };
    return { pedido, conferencia: conferirSomasEfd(documentos) };
  }

  painel(periodo: string): PainelEscrituracao {
    const entradas = this.daCompetencia(periodo);
    const conferencia = conferirSomasEfd(entradas);
    return {
      periodo,
      entradas,
      conferencia,
      arquivos: this.arquivos
        .filter((a) => a.periodo === periodo)
        .sort((a, b) => b.sequencia - a.sequencia)
        .map((a) => ({
          id: a.id,
          sequencia: a.sequencia,
          finalidade: a.finalidade,
          regime: a.regime,
          situacao: a.situacao,
          hash: a.hash,
          recibo: a.recibo,
          reciboAnterior: a.reciboAnterior,
          geradoEm: a.geradoEm,
          entregueEm: a.entregueEm,
          resumo: a.resumo,
          confere:
            conferencia.liberado &&
            hashDoArquivoEfd(
              montarEfdContribuicoes(this.texto(periodo, a.regime, a.reciboAnterior).pedido).conteudo,
            ) === a.hash,
        })),
      cfops: CFOPS,
      naturezas: NATUREZAS_BASE_CREDITO,
    };
  }

  classificar(e: ClassificarEntrada): Record<string, unknown> {
    const doc = [...this.entradas.values()].flat().find((x) => x.id === e.entrada);
    if (!doc) throw recusa('entrada-nao-encontrada', 'Entrada escriturada não encontrada.');
    if (doc.versao !== e.versao)
      throw recusa('conflito-versao', 'A entrada foi alterada por outra pessoa: recarregue.');
    const novos = doc.itens.map((atual) => {
      const i = e.itens.find((x) => x.sequencia === atual.sequencia);
      if (!i) return atual;
      recusar(conferirClassificacaoItem(i, atual.valorItem, atual.valorDesconto));
      if (!CFOPS.some((c) => c.codigo === i.cfop))
        throw recusa(
          'cfop-desconhecido',
          `Item ${i.sequencia}: o CFOP ${i.cfop} não está na tabela oficial.`,
          {
            campos: ['cfop'],
          },
        );
      const pis = cstDaCredito(i.cstPis);
      const cofins = cstDaCredito(i.cstCofins);
      const novo = {
        ...atual,
        ...i,
        basePis: pis ? i.basePis : 0,
        aliquotaPis: pis ? i.aliquotaPis : null,
        valorPis: pis ? creditoDoItem(i.basePis, i.aliquotaPis) : 0,
        baseCofins: cofins ? i.baseCofins : 0,
        aliquotaCofins: cofins ? i.aliquotaCofins : null,
        valorCofins: cofins ? creditoDoItem(i.baseCofins, i.aliquotaCofins) : 0,
      };
      return { ...novo, pendencias: pendenciasDoItem(novo) };
    });
    if (e.itens.some((i) => !doc.itens.some((x) => x.sequencia === i.sequencia)))
      throw recusa('item-nao-encontrado', 'Há item que não é desta entrada.');
    const totais = totaisDoDocumento(novos);
    const pendencias = novos.reduce((s, i) => s + i.pendencias.length, 0);
    const entregue = this.arquivos.some((a) => a.id === doc.arquivo && a.situacao === 'transmitido');
    doc.itens = novos;
    doc.pendencias = pendencias;
    doc.valorPis = totais.valorPis;
    doc.valorCofins = totais.valorCofins;
    doc.cfop = novos[0]?.cfop ?? null;
    doc.situacao = pendencias > 0 ? 'pendente' : entregue ? 'retificada' : 'escriturada';
    doc.versao += 1;
    return {
      entrada: doc.id,
      itens: e.itens.length,
      pendencias,
      valorPis: totais.valorPis,
      valorCofins: totais.valorCofins,
      situacao: doc.situacao,
    };
  }

  gerar(e: GerarEfd): Record<string, unknown> {
    const anteriores = this.arquivos.filter((a) => a.periodo === e.periodo);
    const entregue = [...anteriores].reverse().find((a) => a.situacao === 'transmitido') ?? null;
    const { pedido, conferencia } = this.texto(e.periodo, e.regime, entregue?.recibo ?? null);
    recusar(conferirGeracaoEfd(pedido, conferencia));
    const arquivo = montarEfdContribuicoes(pedido);
    const hash = hashDoArquivoEfd(arquivo.conteudo);
    const base = {
      periodo: e.periodo,
      hash,
      linhas: arquivo.linhas,
      documentos: conferencia.documentos,
      itens: conferencia.itens,
      creditoPis: conferencia.totalCreditoPis,
      creditoCofins: conferencia.totalCreditoCofins,
    };
    const aberto = anteriores.filter((a) => a.situacao === 'gerado');
    const igual = aberto.find((a) => a.hash === hash);
    if (igual)
      return {
        ...base,
        arquivo: igual.id,
        sequencia: igual.sequencia,
        finalidade: igual.finalidade,
        igual: true,
      };
    if (
      entregue &&
      entregue.regime === e.regime &&
      hashDoArquivoEfd(
        montarEfdContribuicoes({ ...pedido, reciboAnterior: entregue.reciboAnterior }).conteudo,
      ) === entregue.hash
    )
      throw recusa(
        'nada-a-retificar',
        'A escrituração é a mesma do arquivo já entregue: não há o que retificar.',
      );
    for (const a of aberto) a.situacao = 'cancelado';
    const novo: ArquivoMemoria = {
      id: ++this.proximo,
      periodo: e.periodo,
      conteudo: arquivo.conteudo,
      sequencia: anteriores.reduce((m, a) => Math.max(m, a.sequencia), 0) + 1,
      finalidade: entregue ? 'retificadora' : 'original',
      regime: e.regime,
      situacao: 'gerado',
      hash,
      recibo: null,
      reciboAnterior: entregue?.recibo ?? null,
      geradoEm: new Date().toISOString(),
      entregueEm: null,
      resumo: `documentos=${conferencia.documentos}; itens=${conferencia.itens}; linhas=${arquivo.linhas}`,
    };
    this.arquivos.push(novo);
    for (const d of this.daCompetencia(e.periodo)) {
      d.arquivo = novo.id;
      d.situacao = 'escriturada';
      d.versao += 1;
    }
    return {
      ...base,
      arquivo: novo.id,
      sequencia: novo.sequencia,
      finalidade: novo.finalidade,
      igual: false,
    };
  }

  entregar(e: EntregaEfd): Record<string, unknown> {
    const a = this.arquivos.find((x) => x.id === e.arquivo);
    if (!a) throw recusa('arquivo-nao-encontrado', 'Arquivo da EFD-Contribuições não encontrado.');
    const recibo = e.recibo.trim();
    recusar(conferirEntregaEfd(a.situacao, recibo));
    const { pedido, conferencia } = this.texto(a.periodo, a.regime, a.reciboAnterior);
    if (!conferencia.liberado || hashDoArquivoEfd(montarEfdContribuicoes(pedido).conteudo) !== a.hash)
      throw recusa(
        'arquivo-desatualizado',
        'A escrituração mudou depois deste arquivo: gere o arquivo de novo antes de registrar a entrega.',
      );
    a.situacao = 'transmitido';
    a.recibo = recibo;
    a.entregueEm = new Date().toISOString();
    return { arquivo: a.id, periodo: a.periodo, situacao: 'transmitido' };
  }

  textoDoArquivo(id: number): { nome: string; conteudo: string } | null {
    const a = this.arquivos.find((x) => x.id === id);
    return a
      ? {
          nome: `efd-contribuicoes-${a.periodo}-${String(a.sequencia).padStart(2, '0')}.txt`,
          conteudo: a.conteudo,
        }
      : null;
  }
}
