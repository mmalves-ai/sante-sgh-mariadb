// Porta do consignado EM MEMÓRIA (M46, etapa 4): a sessão sintética de dev/ci (E2E) grava as remessas, as reposições,
// os faturamentos e as devoluções ao fornecedor SINTÉTICOS, com as mesmas recusas da gravação (a chave do pedido, o
// consumo reposto ou faturado uma vez). Os consumos em sala do consignado vêm do OPME em memória (a etapa 3), quando
// ele é dado; a nota da entrada do estoque é a nota sintética 2026/10/55 do fornecedor 7001 com os itens de OPME. Nada
// vai à cópia; nenhum nome é de pessoa real.
import type { ConsumoConsignado, ItemBusca, MovimentoConsignado } from '@sgh/contratos';
import { saldoConsignado } from '@sgh/dominio-suprimentos';
import { recusa } from '@sgh/legado';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import type { GravadorConsignado, PortaConsignado } from './consignado-porta.js';
import { ITENS_OPME_SINTETICOS, type PortaOpmeMemoria } from './opme-porta-memoria.js';

/** Os fornecedores sintéticos do consignado (os mesmos do estoque e do OPME em memória). */
const FORNECEDORES = new Map([
  [7001, 'DISTRIBUIDORA SINTÉTICA ALFA LTDA'],
  [7002, 'COMERCIAL SINTÉTICA BETA LTDA'],
]);
/** A nota sintética da entrada do estoque (ano/mês/documento → fornecedor e itens). */
const NOTAS = new Map([
  [
    '2026/10/55',
    {
      fornecedor: 7001,
      itens: ITENS_OPME_SINTETICOS.map((i) => i.item),
      numero: '000123456',
      serie: '1',
      emissao: '2026-10-20',
    },
  ],
]);
const minuto = () => new Date().toISOString().slice(0, 16);

interface Estado {
  movimentos: (MovimentoConsignado & { chave: string })[];
  seq: number;
}

export class PortaConsignadoMemoria implements PortaConsignado {
  readonly destino = 'memoria' as const;
  private readonly porHospital = new Map<string, Estado>();

  constructor(private readonly opme: PortaOpmeMemoria | null = null) {}

  private e(c: ContextoPortaM18): Estado {
    let s = this.porHospital.get(c.hospital);
    if (!s) {
      s = { movimentos: [], seq: 46_400 };
      this.porHospital.set(c.hospital, s);
    }
    return s;
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<never> {
    throw new Error('O consignado não grava pelo estoque.');
  }

  private async consumosDe(c: ContextoPortaM18): Promise<ConsumoConsignado[]> {
    if (!this.opme) return [];
    const r = await this.opme.consumosDoPeriodo(c, '2000-01-01', '2999-12-31');
    const s = this.e(c);
    return r.itens
      .filter((x) => x.consignado)
      .map((x) => {
        const rep = s.movimentos.find((m) => m.tipo === 'reposicao' && m.consumo === x.id);
        const fat = s.movimentos.find((m) => m.tipo === 'faturamento' && m.consumo === x.id);
        return {
          consumo: x.id,
          agendamento: x.agendamento,
          atendimento: x.atendimento,
          fornecedor: x.fornecedor,
          item: x.item,
          itemNome: x.itemNome,
          quantidade: Math.round((x.quantidade - x.devolvida) * 1000) / 1000,
          lote: x.lote,
          serie: x.serie,
          em: x.em,
          reposicao: rep ? { movimento: rep.id, em: rep.em } : null,
          faturamento: fat ? { movimento: fat.id, em: fat.em, nf: fat.nfEntrada } : null,
        };
      })
      .sort((a, b) => b.consumo - a.consumo);
  }

  private gravador(c: ContextoPortaM18, usuario: string): GravadorConsignado {
    const s = this.e(c);
    return {
      movimentosPelaChave: async (chave) => {
        const xs = s.movimentos.filter((m) => m.chave === chave);
        return xs.length ? xs : null;
      },
      consumos: async (ids) => (await this.consumosDe(c)).filter((x) => ids.includes(x.consumo)),
      saldoTravado: async (fornecedor, item) =>
        (await this.saldos(c, fornecedor)).itens.find((x) => x.item === item)?.saldo ?? 0,
      gravar: async (m) => {
        const ja = s.movimentos.filter((x) => x.chave === m.chave);
        if (ja.length) {
          if (ja.some((x) => x.fornecedor !== m.fornecedor || x.item !== m.item))
            throw recusa(
              'chave-de-outro-movimento',
              'A chave do pedido já foi usada em outro movimento do consignado.',
            );
          return { grupo: ja[0]!.grupo, movimentos: ja.map((x) => x.id), repetido: true };
        }
        for (const l of m.linhas)
          if (l.consumo !== null && s.movimentos.some((x) => x.tipo === l.tipo && x.consumo === l.consumo))
            throw recusa(
              l.tipo === 'faturamento' ? 'consumo-ja-faturado' : 'consumo-ja-reposto',
              l.tipo === 'faturamento'
                ? 'Um dos consumos já foi faturado em outra tela.'
                : 'Um dos consumos já foi reposto em outra tela.',
              { campos: ['consumos'] },
            );
        const ids: number[] = [];
        let grupo = 0;
        for (const [i, l] of m.linhas.entries()) {
          const id = (s.seq += 1);
          if (i === 0) grupo = id;
          s.movimentos.unshift({
            id,
            grupo,
            tipo: l.tipo,
            fornecedor: m.fornecedor,
            fornecedorNome: FORNECEDORES.get(m.fornecedor) ?? null,
            item: m.item,
            itemNome: ITENS_OPME_SINTETICOS.find((x) => x.item === m.item)?.nome ?? null,
            quantidade: l.quantidade,
            consumo: l.consumo,
            nfNumero: l.nfNumero,
            nfSerie: l.nfSerie,
            nfEmissao: l.nfEmissao,
            nfEntrada: l.nfEntrada,
            lote: l.lote,
            serie: l.serie,
            validade: l.validade,
            motivo: l.motivo,
            usuario: m.usuario || usuario,
            em: minuto(),
            chave: m.chave,
          });
          ids.push(id);
        }
        return { grupo, movimentos: ids, repetido: false };
      },
    };
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    _trilha: unknown,
    fn: (g: GravadorConsignado) => Promise<T>,
  ): Promise<T> {
    // A transação em memória: a gravação só fica se a função terminar (cópia do estado para desfazer).
    const s = this.e(c);
    const antes = { movimentos: [...s.movimentos], seq: s.seq };
    try {
      return await fn(this.gravador(c, 'SINT'));
    } catch (x) {
      s.movimentos = antes.movimentos;
      s.seq = antes.seq;
      throw x;
    }
  }

  async movimentos(c: ContextoPortaM18, fornecedor: number | null) {
    const xs = this.e(c).movimentos.filter((m) => fornecedor === null || m.fornecedor === fornecedor);
    return {
      itens: xs.map((m): MovimentoConsignado => {
        const y: Partial<typeof m> = { ...m };
        delete y.chave;
        return y as MovimentoConsignado;
      }),
      cortada: false,
    };
  }

  async consumos(c: ContextoPortaM18, fornecedor: number | null) {
    const xs = (await this.consumosDe(c)).filter((x) => fornecedor === null || x.fornecedor === fornecedor);
    return { itens: xs, cortada: false };
  }

  async saldos(c: ContextoPortaM18, fornecedor: number | null) {
    const ms = (await this.movimentos(c, fornecedor)).itens;
    const cs = (await this.consumos(c, fornecedor)).itens;
    return {
      itens: saldoConsignado(
        ms,
        cs.map((x) => ({
          fornecedor: x.fornecedor,
          item: x.item,
          quantidade: x.quantidade,
          reposto: x.reposicao !== null,
          faturado: x.faturamento !== null,
        })),
      ),
      cortada: false,
    };
  }

  async saldoCadastro() {
    return [{ fornecedor: 7001, item: 950003, quantidade: 1 }];
  }

  async nomes(_c: ContextoPortaM18, fs: readonly number[], is: readonly number[]) {
    return {
      fornecedores: new Map(fs.filter((f) => FORNECEDORES.has(f)).map((f) => [f, FORNECEDORES.get(f)!])),
      itens: new Map(
        is
          .map((i) => [i, ITENS_OPME_SINTETICOS.find((x) => x.item === i)?.nome] as const)
          .filter((x): x is readonly [number, string] => !!x[1]),
      ),
    };
  }

  async notaEntrada(_c: ContextoPortaM18, nf: { ano: number; mes: number; doc: number }, item: number) {
    const n = NOTAS.get(`${nf.ano}/${nf.mes}/${nf.doc}`);
    return n ? { fornecedor: n.fornecedor, temItem: n.itens.includes(item) } : null;
  }

  async notasEntrada(_c: ContextoPortaM18, fornecedor: number, item: number) {
    return [...NOTAS.entries()]
      .filter(([, n]) => n.fornecedor === fornecedor && n.itens.includes(item))
      .map(([k, n]) => {
        const [ano, mes, doc] = k.split('/').map(Number) as [number, number, number];
        return { ano, mes, doc, numero: n.numero, serie: n.serie, emissao: n.emissao };
      });
  }

  async fornecedorExiste(_c: ContextoPortaM18, f: number) {
    return FORNECEDORES.has(f);
  }

  async classeDoItem(_c: ContextoPortaM18, item: number) {
    return ITENS_OPME_SINTETICOS.find((x) => x.item === item)?.classe ?? null;
  }

  async referenciaConsignada(_c: ContextoPortaM18, item: number) {
    return ITENS_OPME_SINTETICOS.find((x) => x.item === item)?.consignado ?? false;
  }

  /** Os itens de OPME sintéticos pelo nome ou código (a busca da remessa). */
  async buscarItens(_c: ContextoPortaM18, termo: string): Promise<ItemBusca[]> {
    const t = termo.trim().toUpperCase();
    return ITENS_OPME_SINTETICOS.filter((i) => i.nome.includes(t) || String(i.item) === t).map((i) => ({
      codigo: i.item,
      nome: i.nome,
      unidade: i.unidade,
      rastreavel: i.rastreavel,
      controlado: false,
      antimicrobiano: false,
      consignado: i.consignado,
      ativo: true,
    }));
  }
}
