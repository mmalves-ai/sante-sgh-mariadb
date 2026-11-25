// F3.8, 07-FIN linha 100: o de-para contábil da sessão SINTÉTICA (dev/ci sem banco do cliente, E2E). Guarda em memória
// a conta externa por evento, lado e natureza e o código externo do centro de custo, do credor e do credor médico, com
// as MESMAS regras da gravação no banco (contabil-fiscal-propria.ts): a regra do domínio (`conferirRegraDePara`), a
// regra nova entra ativa, desligar mantém a linha, a versão lida confere. Os fatos do período saem dos títulos a pagar
// sintéticos pelas mesmas partidas do domínio (`fatosDaApropriacao`, `fatoDoPagamento`). Nada aqui vale como prova do
// que fica no banco: essa é do contrato de efeito `aplicacao/contabil-fiscal.int.spec.ts`.
import {
  conferirRegraDePara,
  EVENTOS_CONTABEIS_FINANCEIRO,
  type FatoContabil,
  fatoDoPagamento,
  fatosDaApropriacao,
  type RegraDeParaConta,
} from '@sgh/dominio-financeiro';
import { erroConflitoVersao, recusa } from '@sgh/nucleo';
import type { DeParaContabilEntrada } from './contabil-fiscal-propria.js';

type RegraVersao = RegraDeParaConta & { versao: number };
interface CodigoExterno {
  codigo: string;
  ativo: boolean;
}

/** O cadastro sintético que o de-para referencia (a porta em memória entrega o dela). */
export interface CadastroDeParaMemoria {
  readonly naturezas: readonly { id: number; codigo: string; descricao: string }[];
  readonly centros: readonly { id: number; codigo: string; nome: string }[];
  readonly fornecedores: Readonly<Record<number, string>>;
  readonly profissionais: Readonly<Record<number, string>>;
}

/** O título a pagar sintético, no que interessa à contabilização. */
export interface TituloContabilMemoria {
  readonly emissao: string;
  readonly valor: number;
  readonly pago: number;
  readonly dataPagamento: string | null;
  readonly documento: number;
  readonly parcela: number;
  readonly natureza: number | null;
  readonly fornecedor: number | null;
  readonly profissional: number | null;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dentro = (d: string | null, de: string, ate: string): d is string =>
  d !== null && DATA.test(d) && d >= de && d <= ate;

/**
 * Os fatos do período pelos títulos sintéticos. Competência: a despesa na emissão e o pagamento ao fornecedor na data
 * paga (baixa o passivo da emissão). Caixa: a despesa paga na data do pagamento.
 */
export function fatosDosTitulosMemoria(
  titulos: readonly TituloContabilMemoria[],
  p: { de: string; ate: string; regua: 'competencia' | 'caixa' },
): FatoContabil[] {
  const fatos: FatoContabil[] = [];
  for (const t of titulos) {
    const base = {
      historico: `TITULO ${t.documento}/${t.parcela}`,
      documento: String(t.documento),
      natureza: t.natureza,
      centro: null,
      credor: t.fornecedor,
      ...(t.profissional !== null ? { profissional: t.profissional } : {}),
    };
    const pago = t.pago > 0 && dentro(t.dataPagamento, p.de, p.ate);
    if (p.regua === 'competencia') {
      if (dentro(t.emissao, p.de, p.ate) && t.valor > 0)
        fatos.push(
          ...fatosDaApropriacao({ ...base, data: t.emissao, valorDespesa: t.valor, retencoes: [] }, p.regua),
        );
      if (pago)
        fatos.push(
          fatoDoPagamento({ ...base, data: t.dataPagamento as string, valor: t.pago, recolhimento: null }),
        );
    } else if (pago)
      fatos.push(
        ...fatosDaApropriacao(
          { ...base, data: t.dataPagamento as string, valorDespesa: t.pago, retencoes: [] },
          p.regua,
        ),
      );
  }
  return fatos;
}

export class DeParaContabilMemoria {
  private seq = 0;
  private readonly contas: RegraVersao[] = [];
  private readonly centros = new Map<number, CodigoExterno>();
  private readonly credores = new Map<number, CodigoExterno>();
  private readonly medicos = new Map<number, CodigoExterno>();

  constructor(private readonly cadastro: CadastroDeParaMemoria) {}

  /** As regras de conta, ativas e desligadas (a mesma leitura de `regrasDePara` no banco). */
  regras(): RegraVersao[] {
    return this.contas.map((r) => ({ ...r }));
  }

  /** O de-para completo para a tela, no formato de `deParaDoEstabelecimento`. */
  completo() {
    const ativos = (m: Map<number, CodigoExterno>, nomes: Readonly<Record<number, string>>) =>
      [...m.entries()]
        .filter(([, v]) => v.ativo)
        .map(([id, v]) => ({ id, nome: nomes[id] ?? String(id), externo: v.codigo }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
    return {
      eventos: Object.entries(EVENTOS_CONTABEIS_FINANCEIRO).map(([codigo, descricao]) => ({
        codigo,
        descricao,
      })),
      regras: this.regras(),
      naturezas: [...this.cadastro.naturezas],
      centros: this.cadastro.centros.map((c) => {
        const d = this.centros.get(c.id);
        return { ...c, externo: d?.ativo ? d.codigo : null };
      }),
      credores: ativos(this.credores, this.cadastro.fornecedores),
      profissionais: ativos(this.medicos, this.cadastro.profissionais),
    };
  }

  /** O que o lote usa: as regras e os códigos externos ativos. */
  paraLote() {
    const mapa = (m: Map<number, CodigoExterno>) =>
      new Map([...m.entries()].filter(([, v]) => v.ativo).map(([id, v]) => [id, v.codigo] as const));
    return {
      regras: this.regras(),
      centros: mapa(this.centros),
      credores: mapa(this.credores),
      profissionais: mapa(this.medicos),
    };
  }

  /** Busca do fornecedor sintético pelo nome ou pelo código (a tela nunca pede o código interno digitado). */
  fornecedores(termo: string): { id: number; nome: string; documento: string | null }[] {
    const t = termo.trim().toUpperCase();
    if (t.length < 2) return [];
    return Object.entries(this.cadastro.fornecedores)
      .filter(([id, nome]) => id === t || nome.toUpperCase().includes(t))
      .map(([id, nome]) => ({ id: Number(id), nome, documento: null }));
  }

  private codigoExterno(m: Map<number, CodigoExterno>, alvo: number, codigo: string, ativo: boolean): void {
    if (!m.has(alvo) && !ativo) throw recusa('sem-mudanca', 'Não há código externo para desligar.');
    m.set(alvo, { codigo: codigo.trim(), ativo });
  }

  /** A gravação, com as recusas da operação `financeiro.manter_depara_contabil`. */
  manter(e: DeParaContabilEntrada): Record<string, unknown> {
    if (e.tipo === 'centro') {
      if (!this.cadastro.centros.some((c) => c.id === e.centro))
        throw recusa('centro-custo-inexistente', 'O centro de custo não é deste estabelecimento.', {
          campos: ['centro'],
        });
      this.codigoExterno(this.centros, e.centro, e.codigo, e.ativo);
      return { tabela: 'depara_centro_custo_externo', linha: e.centro, tipo: 'centro' };
    }
    if (e.tipo === 'credor') {
      if (!(e.fornecedor in this.cadastro.fornecedores))
        throw recusa('credor-inexistente', 'O fornecedor não existe.', { campos: ['fornecedor'] });
      this.codigoExterno(this.credores, e.fornecedor, e.codigo, e.ativo);
      return { tabela: 'depara_participante_externo', linha: e.fornecedor, tipo: 'credor' };
    }
    if (e.tipo === 'profissional') {
      if (!(e.profissional in this.cadastro.profissionais))
        throw recusa('credor-inexistente', 'O profissional não existe.', { campos: ['profissional'] });
      this.codigoExterno(this.medicos, e.profissional, e.codigo, e.ativo);
      return { tabela: 'depara_participante_externo', linha: e.profissional, tipo: 'profissional' };
    }
    if (e.natureza !== null && !this.cadastro.naturezas.some((n) => n.id === e.natureza))
      throw recusa('natureza-inexistente', 'A natureza financeira não existe.', { campos: ['natureza'] });
    const conta = e.conta.trim();
    if (e.ativo) {
      const r = conferirRegraDePara({ ...e, conta }, this.contas);
      if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
    }
    if (e.id !== null) {
      const atual = this.contas.find((r) => r.id === e.id);
      if (!atual)
        throw recusa('nao-encontrado', 'A regra de-para não é deste estabelecimento.', { campos: ['id'] });
      if (e.versao != null && e.versao !== atual.versao) throw erroConflitoVersao(['conta']);
      const antes = atual.conta;
      Object.assign(atual, {
        evento: e.evento,
        lado: e.lado,
        natureza: e.natureza,
        conta,
        ativo: e.ativo,
        versao: atual.versao + 1,
      });
      return { tabela: 'depara_conta_externa', linha: e.id, tipo: 'conta', antes };
    }
    if (!e.ativo) throw recusa('sem-mudanca', 'A regra nova entra ativa.');
    const id = ++this.seq;
    this.contas.push({
      id,
      evento: e.evento,
      lado: e.lado,
      natureza: e.natureza,
      conta,
      ativo: true,
      versao: 1,
    });
    return { tabela: 'depara_conta_externa', linha: id, tipo: 'conta' };
  }
}

/** O que a porta em memória oferece ao controller do contábil-fiscal (sessão sintética, sem núcleo). */
export interface PortaDeParaMemoria {
  deParaContabilMemoria(c: { estabelecimento: number | null }): DeParaContabilMemoria;
}
