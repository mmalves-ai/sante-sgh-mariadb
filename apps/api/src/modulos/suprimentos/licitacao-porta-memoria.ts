// Porta do processo formal de compra EM MEMÓRIA (M55, etapa 4): a sessão sintética de dev/ci (E2E) grava processos,
// itens, preços, propostas e eventos SINTÉTICOS, com as mesmas regras e recusas da gravação (a chave do pedido, o número
// único, a versão, a etapa, o prazo do aviso, o julgamento, o prazo do recurso, a homologação por outra pessoa, o pedido
// do vencedor). Fornecedores 7001 a 7003 e os pedidos sintéticos do contrato (os mesmos do estoque em memória). Nada vai
// à cópia; nenhum nome é de pessoa real.
import {
  type EtapaLicitacao,
  type EventoLicitacao,
  type ItemLicitacao,
  type ItemLicitacaoEntrada,
  type LicitacaoGravada,
  type PainelLicitacoes,
  type PedidoMarcadoLicitacao,
  type PrecoPesquisado,
  type PropostaLicitacao,
  TETO_LISTA_LICITACOES,
} from '@sgh/contratos';
import {
  estimarLicitacao,
  type EstadoLicitacao,
  etapaDepoisDoEvento,
  etapaFinal,
  julgarLicitacao,
  montarLicitacao,
  podeAlterarTermo,
  podeAvancar,
  podeEncerrar,
  podeHomologar,
  podeMudarSituacaoProposta,
  podeRegistrarEvento,
  podeRegistrarPreco,
  podeDescartarPreco,
  descricaoDocumentoLicitacao,
  podeRegistrarProposta,
  type RecusaSuprimentos,
  resumoLicitacao,
} from '@sgh/dominio-suprimentos';
import { type LicitacaoGravacao, recusa } from '@sgh/legado';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { PEDIDOS_CONTRATO_SINTETICOS } from './contrato-porta-memoria.js';
import type { GravadorLicitacao, PortaLicitacao } from './licitacao-porta.js';

const FORNECEDORES = new Map([
  [7001, 'DISTRIBUIDORA SINTÉTICA ALFA LTDA'],
  [7002, 'COMERCIAL SINTÉTICA BETA LTDA'],
  [7003, 'SUPRIMENTOS SINTÉTICOS GAMA LTDA'],
]);
/** Os usuários sintéticos da sessão de teste (o agente de contratação e a autoridade que homologa). */
const USUARIOS = [
  { login: 'SINT.LICITACAO', nome: 'AGENTE DE CONTRATAÇÃO SINTÉTICO' },
  { login: 'SINT.AUTORIDADE', nome: 'AUTORIDADE COMPETENTE SINTÉTICA' },
  { login: 'SINT.CONTRATOS', nome: 'COMPRADOR SINTÉTICO' },
] as const;
/** Os pedidos sintéticos marcados como licitação (a consulta da ficha, seção 4). */
const PEDIDOS_MARCADOS: readonly PedidoMarcadoLicitacao[] = [
  {
    pedido: 55_001,
    ano: 2026,
    documento: 901,
    sequencia: 1,
    descricao: 'Serviço sintético de manutenção predial por pregão',
    fornecedor: null,
    data: '2026-10-01',
  },
];

/**
 * O calendário sintético da sessão de dev/ci: os feriados nacionais de data fixa (ano 9999 = todo ano, como o cadastro
 * de feriados grava), para os prazos do aviso e do recurso pularem feriado como no estabelecimento.
 */
export const FERIADOS_SINTETICOS_LICITACAO: readonly string[] = [
  '9999-01-01',
  '9999-04-21',
  '9999-05-01',
  '9999-09-07',
  '9999-10-12',
  '9999-11-02',
  '9999-11-15',
  '9999-11-20',
  '9999-12-25',
];

const hojeLocal = (): string => {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const agora = () => new Date().toISOString();
const lancar = (r: RecusaSuprimentos | null) => {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
};

interface Estado {
  processos: LicitacaoGravada[];
  itens: (ItemLicitacao & { licitacao: number })[];
  precos: PrecoPesquisado[];
  propostas: PropostaLicitacao[];
  eventos: (EventoLicitacao & { licitacao: number })[];
  chaves: Map<string, { licitacao: number; registro: number; tipo: string }>;
  seq: number;
}

export class PortaLicitacaoMemoria implements PortaLicitacao {
  readonly destino = 'memoria' as const;
  private readonly porHospital = new Map<string, Estado>();

  constructor(
    private readonly hoje: () => string = hojeLocal,
    private readonly feriados: readonly string[] = FERIADOS_SINTETICOS_LICITACAO,
  ) {}

  private e(c: Pick<ContextoPortaM18, 'hospital'>): Estado {
    let s = this.porHospital.get(c.hospital);
    if (!s) {
      s = {
        processos: [],
        itens: [],
        precos: [],
        propostas: [],
        eventos: [],
        chaves: new Map(),
        seq: 56_000,
      };
      this.porHospital.set(c.hospital, s);
    }
    return s;
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<never> {
    throw new Error('O processo de compra não grava pelo executor.');
  }

  private estado(s: Estado, p: LicitacaoGravada, parametros: EstadoLicitacao['parametros']) {
    const itens = s.itens.filter((i) => i.licitacao === p.id).sort((a, b) => a.numero - b.numero);
    const ids = new Set(itens.map((i) => i.id));
    const precos = s.precos.filter((x) => ids.has(x.item));
    const eventos = s.eventos.filter((x) => x.licitacao === p.id);
    return {
      processo: p,
      itens,
      precos,
      propostas: s.propostas.filter((x) => ids.has(x.item)),
      eventos,
      hoje: this.hoje(),
      parametros,
      feriados: this.feriados,
      precosDetalhe: precos,
      eventosDetalhe: eventos,
    };
  }

  async listar(c: ContextoPortaM18, f: Parameters<PortaLicitacao['listar']>[1]) {
    const s = this.e(c);
    const t = f.termo?.toUpperCase();
    const todos = s.processos
      .filter(
        (p) =>
          (!f.etapa || p.etapa === f.etapa) &&
          (!f.modalidade || p.modalidade === f.modalidade) &&
          (!t || p.numero.toUpperCase().includes(t) || p.objeto.toUpperCase().includes(t)),
      )
      .sort((a, b) => b.id - a.id);
    const pag = todos.slice((f.pagina - 1) * TETO_LISTA_LICITACOES, f.pagina * TETO_LISTA_LICITACOES + 1);
    return {
      hoje: this.hoje(),
      itens: pag.slice(0, TETO_LISTA_LICITACOES).map((p) => {
        const r = resumoLicitacao(p, s.itens.filter((i) => i.licitacao === p.id).length);
        return p.sigiloso && !p.dataJulgamento ? { ...r, valorEstimado: null } : r;
      }),
      pagina: f.pagina,
      cortada: pag.length > TETO_LISTA_LICITACOES,
    };
  }

  async detalhar(c: ContextoPortaM18, id: number, o: Parameters<PortaLicitacao['detalhar']>[2]) {
    const s = this.e(c);
    const p = s.processos.find((x) => x.id === id);
    return p ? montarLicitacao(this.estado(s, p, o.parametros), o.usuario, o.conduz) : null;
  }

  async painel(c: ContextoPortaM18): Promise<PainelLicitacoes> {
    const s = this.e(c);
    const porEtapa: Partial<Record<EtapaLicitacao, number>> = {};
    for (const p of s.processos) porEtapa[p.etapa] = (porEtapa[p.etapa] ?? 0) + 1;
    const hoje = this.hoje();
    const limite = new Date(`${hoje}T00:00:00Z`);
    limite.setUTCDate(limite.getUTCDate() + 7);
    const ate = limite.toISOString().slice(0, 10);
    return {
      porEtapa,
      emAndamento: s.processos.filter((p) => !etapaFinal(p.etapa)).length,
      sessoesProximas: s.processos.filter(
        (p) =>
          p.etapa === 'publicado' &&
          p.dataAbertura !== null &&
          p.dataAbertura >= hoje &&
          p.dataAbertura <= ate,
      ).length,
    };
  }

  async pedidosMarcados(): Promise<PedidoMarcadoLicitacao[]> {
    return [...PEDIDOS_MARCADOS];
  }

  async fornecedores(_c: ContextoPortaM18, termo: string) {
    const t = termo.toUpperCase();
    return {
      itens: [...FORNECEDORES]
        .filter(([cod, nome]) => String(cod) === t || nome.includes(t))
        .map(([codigo, nome]) => ({ codigo, nome })),
      cortada: false,
    };
  }

  async usuarios(_c: ContextoPortaM18, termo: string) {
    const t = termo.toUpperCase();
    return USUARIOS.filter((u) => u.login.includes(t) || u.nome.includes(t)).map((u) => ({ ...u }));
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    _trilha: unknown,
    fn: (g: GravadorLicitacao) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    // A "transação" em memória: falha desfaz tudo (as cópias do estado voltam).
    const antes: Estado = {
      processos: s.processos.map((p) => ({ ...p })),
      itens: s.itens.map((i) => ({ ...i })),
      precos: [...s.precos],
      propostas: s.propostas.map((p) => ({ ...p })),
      eventos: [...s.eventos],
      chaves: new Map(s.chaves),
      seq: s.seq,
    };
    try {
      return await fn(this.gravador(s));
    } catch (err) {
      Object.assign(s, antes);
      throw err;
    }
  }

  private gravador(s: Estado): GravadorLicitacao {
    const proximo = () => (s.seq += 1);
    const hoje = () => this.hoje();
    const processo = (id: number) => s.processos.find((p) => p.id === id);
    const travar = (id: number, versao: number): LicitacaoGravada => {
      const p = processo(id);
      if (!p) throw recusa('licitacao-inexistente', 'O processo não existe neste estabelecimento.');
      if (p.versao !== versao) throw recusa('conflito-versao', 'O processo mudou em outra tela: recarregue.');
      const i = s.processos.indexOf(p);
      const novo = { ...p, versao: p.versao + 1 };
      s.processos[i] = novo;
      return novo;
    };
    const mudar = (id: number, x: Partial<LicitacaoGravada>) => {
      const i = s.processos.findIndex((p) => p.id === id);
      s.processos[i] = { ...s.processos[i]!, ...x };
    };
    const repetido = (chave: string, licitacao: number | null): LicitacaoGravacao | null => {
      const ja = s.chaves.get(chave);
      if (!ja) return null;
      if (licitacao !== null && ja.licitacao !== licitacao)
        throw recusa('chave-de-outro-processo', 'A chave do pedido já foi usada em outro processo.');
      return {
        licitacao: ja.licitacao,
        registro: ja.registro,
        etapa: processo(ja.licitacao)!.etapa,
        repetido: true,
      };
    };
    const conferirFornecedor = (cod: number) => {
      if (!FORNECEDORES.has(cod))
        throw recusa('fornecedor-inexistente', 'O fornecedor não está no cadastro.', {
          campos: ['fornecedor'],
        });
    };
    const conferirAgente = (login: string) => {
      if (!USUARIOS.some((u) => u.login === login.toUpperCase()))
        throw recusa('agente-inexistente', 'O agente de contratação não é usuário do sistema.', {
          campos: ['agente'],
        });
    };
    const gravarItens = (licitacao: number, itens: readonly ItemLicitacaoEntrada[]) => {
      s.itens = s.itens.filter((i) => i.licitacao !== licitacao);
      itens.forEach((i, n) =>
        s.itens.push({
          id: proximo(),
          licitacao,
          numero: n + 1,
          descricao: i.descricao,
          itemEstoque: i.itemEstoque,
          unidade: i.unidade,
          quantidade: i.quantidade,
          valorEstimado: null,
          resultado: null,
          vencedor: null,
          valorAdjudicado: null,
        }),
      );
    };
    const evento = (
      licitacao: number,
      chave: string,
      usuario: string,
      x: Partial<EventoLicitacao> & Pick<EventoLicitacao, 'tipo'>,
    ): number => {
      const id = proximo();
      s.eventos.push({
        id,
        licitacao,
        de: null,
        para: null,
        data: null,
        veiculo: null,
        referencia: null,
        fornecedor: null,
        resultado: null,
        pedido: null,
        documento: null,
        descricao: '',
        usuario: usuario.slice(0, 31),
        criadoEm: agora(),
        ...x,
      });
      s.chaves.set(chave, { licitacao, registro: id, tipo: x.tipo });
      return id;
    };
    const item = (id: number) => s.itens.find((i) => i.id === id)!;
    return {
      criar: async ({ entrada: x, usuario, parametros }) => {
        const ja = s.chaves.get(x.chave);
        if (ja) {
          const p = processo(ja.licitacao)!;
          if (p.numero !== x.numero)
            throw recusa('chave-de-outro-processo', 'A chave do pedido já foi usada em outro processo.');
          return { licitacao: p.id, registro: p.id, etapa: p.etapa, repetido: true };
        }
        if (s.processos.some((p) => p.numero === x.numero))
          throw recusa('numero-repetido', 'Já existe processo com este número no estabelecimento.', {
            campos: ['numero'],
          });
        conferirAgente(x.agente);
        const id = proximo();
        s.processos.push({
          id,
          numero: x.numero,
          regime: x.regime,
          modalidade: x.modalidade,
          criterio: x.criterio,
          natureza: x.natureza,
          objeto: x.objeto,
          justificativa: x.justificativa,
          fundamento: x.fundamento,
          pesoTecnica: x.criterio === 'tecnica-preco' ? x.pesoTecnica : null,
          sigiloso: x.sigiloso,
          metodoEstimativa: parametros.metodoEstimativa,
          valorEstimado: null,
          agente: x.agente.toUpperCase(),
          centroCusto: x.centroCusto,
          etapa: 'planejamento',
          dataPublicacao: null,
          dataAbertura: null,
          dataJulgamento: null,
          julgadoPor: null,
          homologadoPor: null,
          homologadoEm: null,
          versao: 1,
          usuario: usuario.slice(0, 31),
          criadoEm: agora(),
        });
        gravarItens(id, x.itens);
        s.chaves.set(x.chave, { licitacao: id, registro: id, tipo: 'processo' });
        return { licitacao: id, registro: id, etapa: 'planejamento', repetido: false };
      },
      alterar: async ({ id, entrada: x }) => {
        const p = travar(id, x.versao);
        lancar(podeAlterarTermo(p));
        conferirAgente(x.agente);
        mudar(id, {
          regime: x.regime,
          modalidade: x.modalidade,
          criterio: x.criterio,
          natureza: x.natureza,
          objeto: x.objeto,
          justificativa: x.justificativa,
          fundamento: x.fundamento,
          pesoTecnica: x.criterio === 'tecnica-preco' ? x.pesoTecnica : null,
          sigiloso: x.sigiloso,
          agente: x.agente.toUpperCase(),
          centroCusto: x.centroCusto,
        });
        gravarItens(id, x.itens);
        return { licitacao: id, registro: id, etapa: p.etapa, repetido: false };
      },
      preco: async ({ licitacao, entrada: x, usuario, parametros }) => {
        const rep = repetido(x.chave, licitacao);
        if (rep) return rep;
        const p = travar(licitacao, x.versao);
        const est = this.estado(s, p, parametros);
        lancar(podeRegistrarPreco(est, x.item));
        if (x.data > est.hoje)
          throw recusa('licitacao-data-futura', 'A data não pode ser futura.', { campos: ['data'] });
        if (x.fornecedor !== null) conferirFornecedor(x.fornecedor);
        const id = proximo();
        s.precos.push({
          id,
          item: x.item,
          fonte: x.fonte,
          referencia: x.referencia,
          valor: x.valor,
          data: x.data,
          fornecedor: x.fornecedor,
          usuario: usuario.slice(0, 31),
          descarte: null,
        });
        s.chaves.set(x.chave, { licitacao, registro: id, tipo: 'preco' });
        return { licitacao, registro: id, etapa: p.etapa, repetido: false };
      },
      descartarPreco: async ({ licitacao, preco, entrada: x, usuario, parametros }) => {
        const rep = repetido(x.chave, licitacao);
        if (rep) return rep;
        const p = travar(licitacao, x.versao);
        lancar(podeDescartarPreco(this.estado(s, p, parametros), preco));
        const i = s.precos.findIndex((y) => y.id === preco);
        s.precos[i] = {
          ...s.precos[i]!,
          descarte: { justificativa: x.justificativa, usuario: usuario.slice(0, 31), em: agora() },
        };
        s.chaves.set(x.chave, { licitacao, registro: preco, tipo: 'descarte' });
        return { licitacao, registro: preco, etapa: p.etapa, repetido: false };
      },
      documento: async ({ licitacao, documento: d, usuario }) => {
        const chave = `doc:${d.emissao}`;
        const rep = repetido(chave, licitacao);
        if (rep) return rep;
        const p = processo(licitacao);
        if (!p) throw recusa('licitacao-inexistente', 'O processo não existe neste estabelecimento.');
        const ev = evento(licitacao, chave, usuario, {
          tipo: 'documento',
          referencia: d.emissao,
          descricao: descricaoDocumentoLicitacao(d),
        });
        return { licitacao, registro: ev, etapa: p.etapa, repetido: false };
      },
      proposta: async ({ licitacao, entrada: x, parametros }) => {
        const rep = repetido(x.chave, licitacao);
        if (rep) return rep;
        const p = travar(licitacao, x.versao);
        lancar(podeRegistrarProposta(this.estado(s, p, parametros), x));
        conferirFornecedor(x.fornecedor);
        const id = proximo();
        s.propostas.push({
          id,
          item: x.item,
          fornecedor: x.fornecedor,
          fornecedorNome: FORNECEDORES.get(x.fornecedor) ?? `Fornecedor ${x.fornecedor}`,
          valor: x.valor,
          lance: x.lance,
          notaTecnica: x.notaTecnica,
          marca: x.marca,
          situacao: 'valida',
          motivo: null,
        });
        s.chaves.set(x.chave, { licitacao, registro: id, tipo: 'proposta' });
        return { licitacao, registro: id, etapa: p.etapa, repetido: false };
      },
      situacaoProposta: async ({ licitacao, proposta, entrada: x }) => {
        const p = travar(licitacao, x.versao);
        lancar(podeMudarSituacaoProposta(p));
        const i = s.propostas.findIndex((q) => q.id === proposta);
        const pr = s.propostas[i];
        if (!pr || item(pr.item).licitacao !== licitacao)
          throw recusa('licitacao-proposta-inexistente', 'A proposta não é deste processo.');
        s.propostas[i] = { ...pr, situacao: x.situacao, motivo: x.situacao === 'valida' ? null : x.motivo };
        return { licitacao, registro: proposta, etapa: p.etapa, repetido: false };
      },
      avancar: async ({ licitacao, entrada: x, usuario, parametros }) => {
        const rep = repetido(x.chave, licitacao);
        if (rep) return rep;
        const p = travar(licitacao, x.versao);
        const est = this.estado(s, p, parametros);
        const de = p.etapa;
        let descricao = '';
        switch (x.para) {
          case 'pesquisa':
            lancar(podeAvancar(est, { para: 'pesquisa' }));
            break;
          case 'edital':
          case 'sessao':
            lancar(podeAvancar(est, { para: x.para, justificativaPesquisa: x.justificativaPesquisa }));
            if (de === 'pesquisa') {
              const es = estimarLicitacao(est.itens, est.precos, p.metodoEstimativa, parametros.minimoPrecos);
              for (const e of es.itens) Object.assign(item(e.item), { valorEstimado: e.valorUnitario });
              mudar(licitacao, { valorEstimado: es.valorTotal });
              descricao = [x.justificativaPesquisa, ...es.itens.map((i) => i.conta), `total: ${es.conta}`]
                .filter(Boolean)
                .join(' | ');
            }
            break;
          case 'publicado':
            lancar(podeAvancar(est, x));
            mudar(licitacao, { dataPublicacao: x.dataPublicacao, dataAbertura: x.dataAbertura });
            evento(licitacao, `${x.chave}:pub`, usuario, {
              tipo: 'publicacao',
              data: x.dataPublicacao,
              veiculo: x.veiculo,
              referencia: x.referencia,
              descricao: `Abertura em ${x.dataAbertura}.`,
            });
            break;
          case 'julgado': {
            lancar(podeAvancar(est, x));
            const j = julgarLicitacao(est.itens, est.propostas, p, x.desempates);
            for (const r of j.itens)
              Object.assign(item(r.item), {
                resultado: r.resultado,
                vencedor: r.vencedor,
                valorAdjudicado: r.valorUnitario,
              });
            mudar(licitacao, { dataJulgamento: est.hoje, julgadoPor: usuario.slice(0, 31).toUpperCase() });
            descricao = [x.justificativaDesempate, j.conta].filter(Boolean).join(' | ');
            break;
          }
          case 'fracassado':
          case 'deserto':
            lancar(podeAvancar(est, { para: x.para }));
            for (const i of est.itens)
              Object.assign(item(i.id), { resultado: x.para, vencedor: null, valorAdjudicado: null });
            descricao = x.justificativa;
            break;
        }
        mudar(licitacao, { etapa: x.para });
        const ev = evento(licitacao, x.chave, usuario, {
          tipo: 'etapa',
          de,
          para: x.para,
          data: est.hoje,
          descricao,
        });
        return { licitacao, registro: ev, etapa: x.para, repetido: false };
      },
      homologar: async ({ licitacao, entrada: x, usuario, parametros }) => {
        const rep = repetido(x.chave, licitacao);
        if (rep) return rep;
        const p = travar(licitacao, x.versao);
        lancar(podeHomologar(this.estado(s, p, parametros), usuario));
        mudar(licitacao, {
          etapa: 'homologado',
          homologadoPor: usuario.toUpperCase(),
          homologadoEm: agora(),
        });
        const ev = evento(licitacao, x.chave, usuario, {
          tipo: 'etapa',
          de: p.etapa,
          para: 'homologado',
          data: hoje(),
          descricao: x.observacao ?? '',
        });
        return { licitacao, registro: ev, etapa: 'homologado', repetido: false };
      },
      encerrar: async ({ licitacao, entrada: x, usuario }) => {
        const rep = repetido(x.chave, licitacao);
        if (rep) return rep;
        const p = travar(licitacao, x.versao);
        lancar(podeEncerrar(p, x.para));
        mudar(licitacao, { etapa: x.para });
        const ev = evento(licitacao, x.chave, usuario, {
          tipo: 'etapa',
          de: p.etapa,
          para: x.para,
          descricao: x.justificativa,
        });
        return { licitacao, registro: ev, etapa: x.para, repetido: false };
      },
      evento: async ({ licitacao, entrada: x, usuario, parametros }) => {
        const rep = repetido(x.chave, licitacao);
        if (rep) return rep;
        const p = travar(licitacao, x.versao);
        const est = this.estado(s, p, parametros);
        let fornecedorPedido: number | null = null;
        let pedidoJaLigado = false;
        if (x.tipo === 'pedido') {
          const ped = PEDIDOS_CONTRATO_SINTETICOS.find((q) => q.id === x.pedido);
          fornecedorPedido = ped ? ped.fornecedor : null;
          pedidoJaLigado = est.eventos.some((e) => e.tipo === 'pedido' && e.pedido === x.pedido);
        }
        lancar(
          podeRegistrarEvento(est, {
            tipo: x.tipo,
            data: 'data' in x ? x.data : null,
            fornecedor: 'fornecedor' in x ? x.fornecedor : null,
            fornecedorPedido,
            pedidoJaLigado,
          }),
        );
        const resultado = 'resultado' in x ? x.resultado : null;
        const ev = evento(licitacao, x.chave, usuario, {
          tipo: x.tipo,
          data: 'data' in x ? x.data : est.hoje,
          referencia: 'referencia' in x ? x.referencia : null,
          fornecedor: 'fornecedor' in x ? x.fornecedor : x.tipo === 'pedido' ? fornecedorPedido : null,
          resultado,
          pedido: x.tipo === 'pedido' ? x.pedido : null,
          documento: 'documento' in x ? x.documento : null,
          descricao:
            x.tipo === 'ata' && x.validade
              ? `${x.descricao} (validade até ${x.validade})`.trim()
              : x.descricao,
        });
        const para = etapaDepoisDoEvento(p.etapa, x.tipo, resultado);
        if (para !== p.etapa) {
          if (para === 'sessao') {
            for (const i of est.itens)
              Object.assign(item(i.id), { resultado: null, vencedor: null, valorAdjudicado: null });
            mudar(licitacao, { dataJulgamento: null, julgadoPor: null });
          }
          mudar(licitacao, { etapa: para });
        }
        return { licitacao, registro: ev, etapa: para, repetido: false };
      },
    };
  }
}
