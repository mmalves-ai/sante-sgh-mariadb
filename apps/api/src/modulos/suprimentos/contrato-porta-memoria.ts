// Porta dos contratos EM MEMÓRIA (M55, etapa 3): a sessão sintética de dev/ci (E2E) grava contratos, eventos e vínculos
// SINTÉTICOS, com as mesmas regras e recusas da gravação (a chave do pedido, o número único, a versão, o contrato
// vencido só com a exceção aprovada, um contrato por pedido ou parcela). Os pedidos e os títulos são sintéticos dos
// fornecedores 7001 e 7002 (os mesmos do estoque em memória). Nada vai à cópia; nenhum nome é de pessoa real.
import {
  type CandidatoVinculo,
  type ContratoDetalhe,
  type ContratoGravado,
  type EventoContrato,
  type FaixaVigencia,
  type PainelContratos,
  TETO_LISTA_CONTRATOS,
  type VinculoContrato,
} from '@sgh/contratos';
import {
  avaliarFornecedor,
  calcularReajuste,
  conferirEventoContrato,
  conferirVinculoContrato,
  fimVigente,
  montarContrato,
  saldoContrato,
} from '@sgh/dominio-suprimentos';
import { recusa } from '@sgh/legado';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import type { GravadorContrato, PortaContrato } from './contrato-porta.js';

const FORNECEDORES = new Map([
  [7001, 'DISTRIBUIDORA SINTÉTICA ALFA LTDA'],
  [7002, 'COMERCIAL SINTÉTICA BETA LTDA'],
]);
/** Os pedidos sintéticos (o ID do cabeçalho mestre): o fornecedor convidado e o valor dos itens vencedores. */
export const PEDIDOS_CONTRATO_SINTETICOS = [
  { id: 55_001, ano: 2026, doc: 901, fornecedor: 7001, valor: 12_000, data: '2026-10-01' },
  { id: 55_002, ano: 2026, doc: 902, fornecedor: 7001, valor: 4_500.5, data: '2026-10-10' },
  { id: 55_003, ano: 2026, doc: 903, fornecedor: 7002, valor: 800, data: '2026-10-12' },
  { id: 55_004, ano: 2026, doc: 904, fornecedor: 7001, valor: 300, data: '2026-10-15' },
] as const;
/** As parcelas sintéticas de títulos a pagar (o ID da parcela). */
export const TITULOS_CONTRATO_SINTETICOS = [
  { id: 55_101, credor: 7001, doc: 4401, parc: 1, tipo: 'F', serie: '1', valor: 3_000, data: '2026-10-05' },
  { id: 55_102, credor: 7001, doc: 4401, parc: 2, tipo: 'F', serie: '1', valor: 3_000, data: '2026-10-05' },
  { id: 55_103, credor: 7002, doc: 5501, parc: 1, tipo: 'F', serie: '1', valor: 950, data: '2026-10-07' },
  { id: 55_104, credor: 7001, doc: 4402, parc: 1, tipo: 'F', serie: '1', valor: 1_500, data: '2026-10-09' },
] as const;

/** Os usuários sintéticos da sessão de teste (o comprador e a alçada de compras). */
const USUARIOS = [
  { login: 'SINT.CONTRATOS', nome: 'COMPRADOR SINTÉTICO' },
  { login: 'SINT.GERCOMPRAS', nome: 'GERENTE DE COMPRAS SINTÉTICO' },
] as const;

const hojeLocal = (): string => {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const agora = () => new Date().toISOString().slice(0, 19);

interface EventoMem extends EventoContrato {
  contrato: number;
  chave: string;
}
interface VinculoMem {
  id: number;
  contrato: number;
  tipo: 'pedido' | 'titulo';
  legado: number;
  chaveNatural: string;
  pedidoDeOrigem: number | null;
  excecao: number | null;
  usuario: string;
  criadoEm: string;
  chave: string;
}
type Mutavel<T> = { -readonly [K in keyof T]: T[K] };
interface Estado {
  contratos: (Mutavel<ContratoGravado> & { chave: string })[];
  eventos: EventoMem[];
  vinculos: VinculoMem[];
  seq: number;
}

const recusar = (r: { codigo: string; mensagem: string; campos?: readonly string[] } | null) => {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
};

export class PortaContratoMemoria implements PortaContrato {
  readonly destino = 'memoria' as const;
  private readonly porHospital = new Map<string, Estado>();

  constructor(private readonly hoje: () => string = hojeLocal) {}

  private e(c: Pick<ContextoPortaM18, 'hospital'>): Estado {
    let s = this.porHospital.get(c.hospital);
    if (!s) {
      s = { contratos: [], eventos: [], vinculos: [], seq: 55_500 };
      this.porHospital.set(c.hospital, s);
    }
    return s;
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<never> {
    throw new Error('O contrato não grava pelo executor.');
  }

  private vinculosComValor(s: Estado, contrato: ContratoGravado): VinculoContrato[] {
    return s.vinculos
      .filter((v) => v.contrato === contrato.id)
      .map((v) => {
        const valor =
          v.tipo === 'pedido'
            ? (PEDIDOS_CONTRATO_SINTETICOS.find(
                (p) => p.id === v.legado && p.fornecedor === contrato.fornecedor,
              )?.valor ?? 0)
            : (TITULOS_CONTRATO_SINTETICOS.find((t) => t.id === v.legado)?.valor ?? 0);
        return {
          id: v.id,
          tipo: v.tipo,
          legado: v.legado,
          chaveNatural: v.chaveNatural,
          valor,
          pedidoDeOrigem: v.pedidoDeOrigem,
          ativo: true,
          excecao: v.excecao,
          usuario: v.usuario,
          criadoEm: v.criadoEm,
        };
      });
  }

  private eventosDe(s: Estado, id: number): EventoMem[] {
    return s.eventos
      .filter((x) => x.contrato === id)
      .map((x) => ({ ...x, usado: s.vinculos.some((v) => v.excecao === x.id) }));
  }

  private montar(s: Estado, c: ContratoGravado) {
    return montarContrato(
      c,
      FORNECEDORES.get(c.fornecedor) ?? '',
      this.eventosDe(s, c.id),
      this.vinculosComValor(s, c),
      this.hoje(),
    );
  }

  async listar(c: ContextoPortaM18, f: Parameters<PortaContrato['listar']>[1]) {
    const s = this.e(c);
    const t = f.termo?.toUpperCase() ?? null;
    let itens = s.contratos
      .filter((x) => f.situacao === 'todos' || x.situacao === f.situacao)
      .filter((x) => f.fornecedor === null || x.fornecedor === f.fornecedor)
      .filter((x) => !t || x.numero.toUpperCase().includes(t) || x.objeto.toUpperCase().includes(t))
      .map((x) => this.montar(s, x).resumo);
    if (f.faixa) itens = itens.filter((x) => x.faixa === f.faixa);
    itens.sort((a, b) => a.fim.localeCompare(b.fim) || a.id - b.id);
    const pular = (f.pagina - 1) * TETO_LISTA_CONTRATOS;
    return {
      hoje: this.hoje(),
      itens: itens.slice(pular, pular + TETO_LISTA_CONTRATOS),
      pagina: f.pagina,
      cortada: itens.length > pular + TETO_LISTA_CONTRATOS,
    };
  }

  async detalhar(c: ContextoPortaM18, id: number): Promise<ContratoDetalhe | null> {
    const s = this.e(c);
    const x = s.contratos.find((y) => y.id === id);
    if (!x) return null;
    const m = this.montar(s, x);
    return { ...m.resumo, ...m.detalhe, centroCustoNome: x.centroCusto === null ? null : 'SETOR SINTÉTICO' };
  }

  async painel(c: ContextoPortaM18): Promise<PainelContratos> {
    const s = this.e(c);
    const ms = s.contratos.filter((x) => x.situacao === 'ativo').map((x) => this.montar(s, x));
    const faixas: FaixaVigencia[] = [
      'a-iniciar',
      'vigente',
      'vence-90',
      'vence-60',
      'vence-30',
      'vencido',
      'encerrado',
    ];
    return {
      hoje: this.hoje(),
      ativos: ms.length,
      porFaixa: Object.fromEntries(
        faixas.map((f) => [f, ms.filter((m) => m.resumo.faixa === f).length]),
      ) as Record<FaixaVigencia, number>,
      avaliacaoVencida: ms.filter((m) => m.detalhe.avisos.some((a) => a.codigo === 'avaliacao-vencida'))
        .length,
      saldoExcedido: ms.filter((m) => m.resumo.saldo < 0).length,
    };
  }

  async candidatos(c: ContextoPortaM18, id: number): Promise<CandidatoVinculo[] | null> {
    const s = this.e(c);
    const x = s.contratos.find((y) => y.id === id);
    if (!x) return null;
    const ligado = (tipo: 'pedido' | 'titulo', legado: number) =>
      s.vinculos.some((v) => v.tipo === tipo && v.legado === legado);
    const pedidos: CandidatoVinculo[] = PEDIDOS_CONTRATO_SINTETICOS.filter(
      (p) => p.fornecedor === x.fornecedor && !ligado('pedido', p.id),
    ).map((p) => ({
      tipo: 'pedido',
      ids: [p.id],
      chaveNatural: `${p.ano}/${p.doc}`,
      data: p.data,
      valor: p.valor,
      descricao: `Pedido ${p.doc}/${p.ano}`,
    }));
    const docs = new Map<number, (typeof TITULOS_CONTRATO_SINTETICOS)[number][]>();
    for (const t of TITULOS_CONTRATO_SINTETICOS)
      if (t.credor === x.fornecedor && !ligado('titulo', t.id))
        docs.set(t.doc, [...(docs.get(t.doc) ?? []), t]);
    const titulos: CandidatoVinculo[] = [...docs.values()].map((ps) => ({
      tipo: 'titulo',
      ids: ps.map((p) => p.id),
      chaveNatural: `${x.fornecedor}/${ps[0]!.doc}/F/1`,
      data: ps[0]!.data,
      valor: Math.round(ps.reduce((a, p) => a + p.valor, 0) * 100) / 100,
      descricao: `Documento ${ps[0]!.doc} série 1 (${ps.length} parcela(s) em aberto)`,
    }));
    return [...pedidos, ...titulos];
  }

  async fornecedores(_c: ContextoPortaM18, termo: string) {
    const t = termo.trim().toUpperCase();
    const itens = [...FORNECEDORES.entries()]
      .filter(([k, n]) => !t || String(k) === t || n.includes(t))
      .map(([codigo, nome]) => ({ codigo, nome }));
    return { itens, cortada: false };
  }

  async usuarios(_c: ContextoPortaM18, termo: string) {
    const t = termo.trim().toUpperCase();
    return USUARIOS.filter((u) => t.length >= 2 && (u.login.includes(t) || u.nome.includes(t)));
  }

  async centros() {
    return [{ codigo: 9001, nome: 'SETOR SINTÉTICO' }];
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    _trilha: unknown,
    fn: (g: GravadorContrato) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    // A "transação" em memória: falha desfaz tudo (a cópia rasa do estado volta).
    const antes: Estado = {
      contratos: [...s.contratos],
      eventos: [...s.eventos],
      vinculos: [...s.vinculos],
      seq: s.seq,
    };
    try {
      return await fn(this.gravador(s));
    } catch (err) {
      Object.assign(s, antes);
      throw err;
    }
  }

  private gravador(s: Estado): GravadorContrato {
    const proximo = () => (s.seq += 1);
    const contrato = (id: number) => {
      const x = s.contratos.find((y) => y.id === id);
      if (!x) throw recusa('contrato-inexistente', 'O contrato não existe.');
      return x;
    };
    return {
      criar: async ({ entrada: x, usuario }) => {
        const ja = s.contratos.find((y) => y.chave === x.chave);
        if (ja) return { id: ja.id, repetido: true };
        if (s.contratos.some((y) => y.numero === x.numero))
          throw recusa('numero-repetido', 'Já existe contrato com este número no estabelecimento.', {
            campos: ['numero'],
          });
        if (!FORNECEDORES.has(x.fornecedor))
          throw recusa('fornecedor-inexistente', 'O fornecedor não está no cadastro.', {
            campos: ['fornecedor'],
          });
        const id = proximo();
        s.contratos.push({
          id,
          numero: x.numero,
          fornecedor: x.fornecedor,
          tipo: x.tipo,
          objeto: x.objeto,
          critico: x.critico,
          inicio: x.inicio,
          fimOriginal: x.fim,
          valorInicial: x.valor,
          indiceReajuste: x.indiceReajuste,
          dataBase: x.dataBase,
          garantia: x.garantia,
          garantiaValor: x.garantia === 'nenhuma' ? null : x.garantiaValor,
          garantiaValidade: x.garantia === 'nenhuma' ? null : x.garantiaValidade,
          gestor: x.gestor.toUpperCase(),
          fiscal: x.fiscal.toUpperCase(),
          centroCusto: x.centroCusto,
          observacao: x.observacao,
          situacao: 'ativo',
          versao: 1,
          usuario,
          criadoEm: agora(),
          chave: x.chave,
        });
        return { id, repetido: false };
      },
      alterar: async ({ id, entrada: x }) => {
        const c = contrato(id);
        if (c.situacao !== 'ativo')
          throw recusa(
            'contrato-encerrado',
            'O contrato está encerrado ou rescindido: o cadastro não muda mais.',
          );
        if (c.versao !== x.versao)
          throw recusa('conflito-versao', 'O contrato mudou em outra tela: recarregue.');
        Object.assign(c, {
          objeto: x.objeto,
          critico: x.critico,
          indiceReajuste: x.indiceReajuste,
          dataBase: x.dataBase,
          garantia: x.garantia,
          garantiaValor: x.garantia === 'nenhuma' ? null : x.garantiaValor,
          garantiaValidade: x.garantia === 'nenhuma' ? null : x.garantiaValidade,
          gestor: x.gestor.toUpperCase(),
          fiscal: x.fiscal.toUpperCase(),
          centroCusto: x.centroCusto,
          observacao: x.observacao,
          versao: c.versao + 1,
        });
        return { id, versao: c.versao };
      },
      evento: async ({ contrato: id, entrada: x, usuario }) => {
        const ja = s.eventos.find((y) => y.chave === x.chave);
        if (ja)
          return { evento: ja.id, contrato: ja.contrato, tipo: ja.tipo, valor: ja.valor, repetido: true };
        const c = contrato(id);
        if (c.versao !== x.versao)
          throw recusa('conflito-versao', 'O contrato mudou em outra tela: recarregue.');
        const evs = this.eventosDe(s, id);
        const saldo = saldoContrato(c.valorInicial, evs, this.vinculosComValor(s, c));
        const fim = fimVigente(c.fimOriginal, evs);
        const valorInformado = 'valor' in x ? x.valor : null;
        const novoFim = 'novoFim' in x ? x.novoFim : null;
        const data = 'data' in x ? x.data : null;
        recusar(
          conferirEventoContrato({
            tipo: x.tipo,
            situacao: c.situacao,
            inicio: c.inicio,
            fim,
            novoFim,
            valor: valorInformado,
            saldo: saldo.saldo,
            data,
            hoje: this.hoje(),
          }),
        );
        let valor = valorInformado;
        if (x.tipo === 'reajuste') {
          const rs = evs.filter((v) => v.tipo === 'reajuste');
          const r = calcularReajuste({
            indice: c.indiceReajuste,
            dataBase: c.dataBase,
            ultimoReajuste: rs.length ? rs[rs.length - 1]!.data : null,
            data: x.data,
            percentual: x.percentual,
            valorVigente: saldo.valorInicial + saldo.aditivos + saldo.reajustes,
          });
          if ('codigo' in r) recusar(r);
          else valor = r.valor;
        }
        const evento = proximo();
        s.eventos.push({
          id: evento,
          contrato: id,
          tipo: x.tipo,
          data,
          valor,
          percentual: x.tipo === 'reajuste' ? x.percentual : null,
          novoFim,
          numeroTermo: 'numeroTermo' in x ? x.numeroTermo : null,
          notas: x.tipo === 'avaliacao' ? x.notas : null,
          resultado: x.tipo === 'avaliacao' ? avaliarFornecedor(x.notas).resultado : null,
          descricao: x.descricao || null,
          documento: 'documento' in x ? x.documento : null,
          usado: false,
          usuario,
          criadoEm: agora(),
          chave: x.chave,
        });
        c.versao += 1;
        if (x.tipo === 'encerramento') c.situacao = 'encerrado';
        if (x.tipo === 'rescisao') c.situacao = 'rescindido';
        return { evento, contrato: id, tipo: x.tipo, valor, repetido: false };
      },
      vincular: async (v) => {
        const ja = s.vinculos.filter((y) => y.chave.startsWith(`${v.chave}:`));
        if (ja.length)
          return {
            contrato: v.contrato.contrato,
            vinculos: ja.map((y) => y.id),
            saldoAntes: 0,
            saldoDepois: 0,
            repetido: true,
          };
        const c = contrato(v.contrato.contrato);
        const evs = this.eventosDe(s, c.id);
        const saldo = saldoContrato(c.valorInicial, evs, this.vinculosComValor(s, c));
        const pedido =
          v.tipo === 'pedido' ? PEDIDOS_CONTRATO_SINTETICOS.find((p) => p.id === v.ids[0]) : null;
        const titulos =
          v.tipo === 'titulo' ? TITULOS_CONTRATO_SINTETICOS.filter((t) => v.ids.includes(t.id)) : [];
        if (v.tipo === 'pedido' && !pedido)
          throw recusa('pedido-inexistente', 'O pedido não existe.', { campos: ['ids'] });
        if (v.tipo === 'titulo' && titulos.length !== new Set(v.ids).size)
          throw recusa('titulo-inexistente', 'Alguma parcela do título não existe.', { campos: ['ids'] });
        const exc =
          v.contrato.excecao === null
            ? null
            : evs.find((x) => x.id === v.contrato.excecao && x.tipo === 'excecao');
        if (v.contrato.excecao !== null && !exc)
          throw recusa('excecao-inexistente', 'A exceção aprovada não existe.', { campos: ['excecao'] });
        const origem = v.contrato.pedidoDeOrigem;
        recusar(
          conferirVinculoContrato({
            contrato: {
              id: c.id,
              situacao: c.situacao,
              inicio: c.inicio,
              fim: fimVigente(c.fimOriginal, evs),
              fornecedor: c.fornecedor,
            },
            hoje: this.hoje(),
            tipo: v.tipo,
            fornecedores: pedido ? [pedido.fornecedor] : [...new Set(titulos.map((t) => t.credor))],
            valor: v.tipo === 'titulo' && origem === null ? titulos.reduce((a, t) => a + t.valor, 0) : 0,
            saldo: saldo.saldo,
            excecao: exc
              ? {
                  id: exc.id,
                  contrato: c.id,
                  aprovador: exc.usuario,
                  criadoEm: exc.criadoEm,
                  usada: exc.usado,
                }
              : null,
            solicitante: v.usuario,
            jaVinculado: s.vinculos.some((y) => y.tipo === v.tipo && v.ids.includes(y.legado)),
            pedidoDeOrigemValido:
              origem === null
                ? null
                : s.vinculos.some((y) => y.id === origem && y.tipo === 'pedido' && y.contrato === c.id),
          }),
        );
        const ids: number[] = [];
        for (const [i, legado] of v.ids.entries()) {
          const id = proximo();
          const t = titulos.find((x) => x.id === legado);
          s.vinculos.push({
            id,
            contrato: c.id,
            tipo: v.tipo,
            legado,
            chaveNatural: pedido
              ? `${pedido.ano}/${pedido.doc}`
              : `${t!.credor}/${t!.doc}/${t!.parc}/${t!.tipo}/${t!.serie}`,
            pedidoDeOrigem: origem,
            excecao: i === 0 ? v.contrato.excecao : null,
            usuario: v.usuario,
            criadoEm: agora(),
            chave: `${v.chave}:${i + 1}`,
          });
          ids.push(id);
        }
        const depois = saldoContrato(c.valorInicial, evs, this.vinculosComValor(s, c));
        return {
          contrato: c.id,
          vinculos: ids,
          saldoAntes: saldo.saldo,
          saldoDepois: depois.saldo,
          repetido: false,
        };
      },
    };
  }
}
