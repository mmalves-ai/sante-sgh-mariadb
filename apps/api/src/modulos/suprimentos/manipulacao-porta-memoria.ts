// Porta da manipulação EM MEMÓRIA (M46, etapa 4): a sessão sintética de dev/ci (E2E) tem itens prescritos SINTÉTICOS já
// validados pela farmácia (um pela regra automática, um pelo farmacêutico) e um ainda pendente, duas capelas (uma em
// funcionamento, com dois grupos, e uma parada) e grava as ordens, as conferências e a baixa SINTÉTICAS, com as mesmas
// regras e recusas da gravação (a chave do pedido, a ordem em curso, a versão vista, a dupla conferência). A baixa do
// insumo é a saída do estoque simulada (o documento e o lançamento sintéticos). Nada vai à cópia; nenhum nome é de
// pessoa real (só o leito e as iniciais sintéticas).
import {
  type CapelaManipulacao,
  esquemaRegistrarSaida,
  type ItemAManipular,
  type OrdemManipulacao,
} from '@sgh/contratos';
import { conferirBaixaManipulacao } from '@sgh/dominio-suprimentos';
import { type ContextoOperacao, ErroOperacao, recusa } from '@sgh/legado';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import type { AvaliacaoDoItem, GravadorManipulacao, PortaManipulacao } from './manipulacao-porta.js';

/** Os itens prescritos sintéticos (atendimentos sintéticos 77101 a 77103) e a avaliação de cada um. */
const ITENS_SINTETICOS: readonly (Omit<ItemAManipular, 'ordem' | 'validadoEm'> & {
  estado: string;
  decisao: string | null;
})[] = [
  {
    itemPrescrito: 9_464_001,
    avaliacao: 4_640_001,
    atendimento: 77101,
    leito: 'UTI-03',
    iniciais: 'S.I.',
    produto: 5005,
    produtoNome: 'CEFTRIAXONA 1 G FRASCO-AMPOLA',
    validadoPor: null,
    estado: 'automatico',
    decisao: null,
  },
  {
    itemPrescrito: 9_464_002,
    avaliacao: 4_640_002,
    atendimento: 77102,
    leito: 'ENF1-12',
    iniciais: 'T.E.',
    produto: 5003,
    produtoNome: 'DIPIRONA SÓDICA 500 MG/ML AMPOLA 2 ML',
    validadoPor: 'SINT.FARMACEUTICO',
    estado: 'decidido',
    decisao: 'valido',
  },
  {
    itemPrescrito: 9_464_003,
    avaliacao: 4_640_003,
    atendimento: 77103,
    leito: 'ENF2-04',
    iniciais: 'C.O.',
    produto: 5005,
    produtoNome: 'CEFTRIAXONA 1 G FRASCO-AMPOLA',
    validadoPor: null,
    estado: 'pendente',
    decisao: null,
  },
];
const CAPELAS: readonly CapelaManipulacao[] = [
  {
    id: 1,
    nome: 'CAPELA DE FLUXO LAMINAR 1',
    funcionando: true,
    manipulando: false,
    grupos: [
      { id: 1, nome: 'ANTIMICROBIANOS' },
      { id: 2, nome: 'ANALGÉSICOS' },
    ],
  },
  { id: 2, nome: 'CAPELA DE FLUXO LAMINAR 2', funcionando: false, manipulando: false, grupos: [] },
];
const NOMES_INSUMO = new Map([
  [5003, 'DIPIRONA SÓDICA 500 MG/ML AMPOLA 2 ML'],
  [5005, 'CEFTRIAXONA 1 G FRASCO-AMPOLA'],
]);
const agora = () => new Date().toISOString().slice(0, 16);
/** A ordem sem os campos internos da memória (a chave do pedido e a criação). */
function publica(o: OrdemManipulacao & { chave: string; criadaEm: string }): OrdemManipulacao {
  const y: Partial<typeof o> = { ...o };
  delete y.chave;
  delete y.criadaEm;
  return y as OrdemManipulacao;
}

interface Estado {
  ordens: (OrdemManipulacao & { chave: string; criadaEm: string })[];
  chaves: Map<string, number>;
  seq: number;
  doc: number;
}

export class PortaManipulacaoMemoria implements PortaManipulacao {
  readonly destino = 'memoria' as const;
  private readonly porHospital = new Map<string, Estado>();

  private e(c: ContextoPortaM18): Estado {
    let s = this.porHospital.get(c.hospital);
    if (!s) {
      s = { ordens: [], chaves: new Map(), seq: 46_480, doc: 4_680 };
      this.porHospital.set(c.hospital, s);
    }
    return s;
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  /** A baixa do insumo: a saída do estoque simulada com a ordem ligada (as recusas do registro próprio). */
  async executar(c: ContextoPortaM18, op: string, entradaBruta: unknown, ctx: ContextoOperacao) {
    if (op !== 'suprimentos.registrarSaida')
      throw new Error(`Operação ${op} fora da manipulação em memória.`);
    const s = this.e(c);
    const chave = `${op}:${ctx.idempotencyKey}`;
    const ja = s.chaves.get(chave);
    if (ja !== undefined) return { resultado: { id: ja }, repetida: true, trilha: null };
    const a = esquemaRegistrarSaida.safeParse(entradaBruta);
    if (!a.success || !a.data.manipulacao)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.');
    const m = a.data.manipulacao;
    const it = a.data.itens[0]!;
    const o = s.ordens.find((x) => x.id === m.ordem);
    if (!o) throw recusa('ordem-inexistente', 'A ordem de manipulação não existe.');
    if (o.versao !== m.versaoVista)
      throw recusa('manipulacao-mudou', 'A ordem de manipulação mudou em outra tela: recarregue e confira.');
    const r = conferirBaixaManipulacao({
      situacao: o.situacao,
      insumo: o.insumo,
      quantidade: o.quantidade,
      itemSaida: it.item,
      quantidadeSaida: it.quantidade,
      loteInsumo: o.loteInsumo,
      validadeInsumo: o.validadeInsumo,
      lotesSaida: it.lotes,
    })[0];
    if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
    if ((a.data.atendimento ?? 0) !== o.atendimento || a.data.local !== o.local)
      throw recusa(
        'saida-diferente-da-ordem',
        'A saída do estoque não é do atendimento e do local da ordem.',
      );
    const hoje = new Date();
    const saida = { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1, doc: (s.doc += 1) };
    const id = (s.seq += 1);
    Object.assign(o, { situacao: 'baixada', versao: o.versao + 1, saida, lancamento: id + 900_000 });
    s.chaves.set(chave, id);
    return { resultado: { id, ...saida }, repetida: false, trilha: null };
  }

  private avaliacaoDe(item: number): AvaliacaoDoItem | null {
    const x = ITENS_SINTETICOS.find((i) => i.itemPrescrito === item);
    return x
      ? { id: x.avaliacao, estado: x.estado, decisao: x.decisao, reg: x.atendimento, produto: x.produto }
      : null;
  }

  private gravador(s: Estado): GravadorManipulacao {
    return {
      ordem: async (id) => s.ordens.find((o) => o.id === id) ?? null,
      ordemPelaChave: async (chave) => s.ordens.find((o) => o.chave === chave) ?? null,
      avaliacao: async (item) => this.avaliacaoDe(item),
      ordemEmCurso: async (item) =>
        s.ordens.some(
          (o) => o.itemPrescrito === item && (o.situacao === 'aberta' || o.situacao === 'conferida'),
        ),
      abrir: async (o) => {
        const ja = s.ordens.find((x) => x.chave === o.chave);
        if (ja) {
          if (ja.itemPrescrito !== o.itemPrescrito)
            throw recusa(
              'chave-de-outra-ordem',
              'A chave do pedido já foi usada em outra ordem de manipulação.',
            );
          return { id: ja.id, versao: ja.versao, repetida: true };
        }
        if (
          s.ordens.some(
            (x) => x.itemPrescrito === o.itemPrescrito && ['aberta', 'conferida'].includes(x.situacao),
          )
        )
          throw recusa('ordem-em-curso', 'Já há uma ordem de manipulação em curso para este item prescrito.');
        const id = (s.seq += 1);
        s.ordens.unshift({
          id,
          versao: 1,
          situacao: 'aberta',
          itemPrescrito: o.itemPrescrito,
          avaliacao: o.avaliacao,
          atendimento: o.reg,
          produto: o.produto,
          capela: o.capela,
          capelaNome: CAPELAS.find((x) => x.id === o.capela)?.nome ?? null,
          grupo: o.grupo,
          insumo: o.insumo,
          insumoNome: NOMES_INSUMO.get(o.insumo) ?? null,
          local: o.local,
          loteInsumo: o.loteInsumo,
          validadeInsumo: o.validadeInsumo,
          quantidade: o.quantidade,
          dose: o.dose,
          validadeSobra: o.validadeSobra,
          preparadoPor: o.usuario,
          preparadoEm: o.em,
          conferidoPor: null,
          conferidoEm: null,
          observacao: null,
          saida: null,
          lancamento: null,
          chave: o.chave,
          criadaEm: agora(),
        });
        return { id, versao: 1, repetida: false };
      },
      conferir: async (c) => {
        const o = s.ordens.find((x) => x.id === c.ordem);
        if (!o || o.versao !== c.versaoVista || o.situacao !== 'aberta')
          throw recusa(
            'manipulacao-mudou',
            'A ordem de manipulação mudou em outra tela: recarregue e confira.',
          );
        Object.assign(o, {
          situacao: c.situacao,
          conferidoPor: c.usuario,
          conferidoEm: c.em,
          observacao: c.observacao,
          versao: o.versao + 1,
        });
        return { versao: o.versao };
      },
    };
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    _trilha: unknown,
    fn: (g: GravadorManipulacao) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const antes = structuredClone(s.ordens);
    try {
      return await fn(this.gravador(s));
    } catch (x) {
      s.ordens = antes;
      throw x;
    }
  }

  async itensAManipular(c: ContextoPortaM18) {
    const s = this.e(c);
    const hoje = agora();
    return {
      itens: ITENS_SINTETICOS.filter((x) => x.estado === 'automatico' || x.decisao === 'valido').map((x) => ({
        itemPrescrito: x.itemPrescrito,
        avaliacao: x.avaliacao,
        atendimento: x.atendimento,
        leito: x.leito,
        iniciais: x.iniciais,
        produto: x.produto,
        produtoNome: x.produtoNome,
        validadoPor: x.validadoPor,
        validadoEm: hoje,
        ordem:
          s.ordens.find(
            (o) =>
              o.itemPrescrito === x.itemPrescrito && (o.situacao === 'aberta' || o.situacao === 'conferida'),
          )?.id ?? null,
      })),
      cortada: false,
    };
  }

  async avaliacao(_c: ContextoPortaM18, item: number) {
    return this.avaliacaoDe(item);
  }

  async ordens(c: ContextoPortaM18) {
    return { itens: this.e(c).ordens.map(publica), cortada: false };
  }

  async ordem(c: ContextoPortaM18, id: number) {
    const o = this.e(c).ordens.find((x) => x.id === id);
    return o ? publica(o) : null;
  }

  async capelas() {
    return CAPELAS.map((x) => ({ ...x, grupos: [...x.grupos] }));
  }

  /** Os farmacêuticos sintéticos da manipulação (CBO 2234-05); os outros logins, sem vínculo de farmacêutico. */
  async vinculos(_c: ContextoPortaM18, login: string) {
    return /^SINT\.MANIPULACAO/i.test(login) ? [{ vinculo: 7_464, cbo: '223405', ativo: true }] : [];
  }
}
