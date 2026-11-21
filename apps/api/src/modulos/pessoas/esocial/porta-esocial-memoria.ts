// Porta do eSocial em memória (M53.6; F2.2 lote 03-05: tipos próprios, contexto do núcleo): a sessão sintética de dev/ci, o E2E e os testes do serviço. Os registros vivem
// por estabelecimento, numa cópia por transação (o erro no meio desfaz tudo). Nada vai à cópia do banco. Os catálogos e
// as pendências migradas são sintéticos (formato dos reais, nenhum dado de pessoa). As regras de banco que
// importam ao teste também valem aqui: vigência única por início, ficha única por vínculo com versão, identificador do
// eSocial único e versão na troca de situação.
import { CATALOGO_EVENTOS_ESOCIAL, NUMERO_GRUPO_ESOCIAL } from '@sgh/contratos';
import { ErroOperacao } from '@sgh/nucleo';
import type { GravacaoFeita, TrilhaDaGravacao } from '../../exames/public-api.js';
import type {
  ContextoEsocial,
  EventoDoCatalogoEsocial,
  FichaEsocialCifrada,
  FiltroRegistrosEventoEsocial,
  GravadorEsocial,
  ItemDoCatalogoEsocial,
  LeiauteDoCatalogoEsocial,
  PendenciaMigradaEsocial,
  PortaEsocial,
  RegistroConciliacaoEsocial,
  RegistroEventoEsocial,
  RegistroLoteEsocial,
  VigenciaEmpregadorEsocial,
} from './porta-esocial.js';

const recusa = (codigo: string, mensagem: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', mensagem);
const desatualizado = () =>
  recusa(
    'desatualizado',
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );

interface Estado {
  seq: number;
  empregadores: VigenciaEmpregadorEsocial[];
  fichas: FichaEsocialCifrada[];
  eventos: { evento: RegistroEventoEsocial; xml: string }[];
  lotes: RegistroLoteEsocial[];
  conciliacoes: RegistroConciliacaoEsocial[];
}

const novo = (): Estado => ({
  seq: 0,
  empregadores: [],
  fichas: [],
  eventos: [],
  lotes: [],
  conciliacoes: [],
});
const copiar = (s: Estado): Estado => ({
  seq: s.seq,
  empregadores: s.empregadores.map((x) => ({ ...x })),
  fichas: s.fichas.map((x) => ({ ...x })),
  eventos: s.eventos.map((x) => ({ evento: { ...x.evento }, xml: x.xml })),
  lotes: s.lotes.map((x) => ({ ...x })),
  conciliacoes: s.conciliacoes.map((x) => ({ ...x })),
});

/** O estado é por cliente e estabelecimento da sessão. */
const chave = (c: ContextoEsocial) => `${c.cliente}|${c.estabelecimento}`;

const p2 = (x: number) => String(x).padStart(2, '0');
const local = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;

/** Empresa sintética com CNPJ de exemplo (dígitos válidos; não é de empresa real conhecida). */
export const CNPJ_SINTETICO_ESOCIAL = '11222333000181';

const filtra = (x: RegistroEventoEsocial, f: FiltroRegistrosEventoEsocial) =>
  (f.empresa === undefined || x.empresa === f.empresa) &&
  (f.evento === undefined || x.evento === f.evento) &&
  (f.eventos === undefined || f.eventos.length === 0 || f.eventos.includes(x.evento)) &&
  (f.situacao === undefined || x.situacao === f.situacao) &&
  (f.situacoes === undefined || f.situacoes.length === 0 || f.situacoes.includes(x.situacao)) &&
  (f.vinculo === undefined || x.vinculo === f.vinculo) &&
  (f.lote === undefined || x.lote === f.lote) &&
  (f.origem === undefined || x.origem === f.origem) &&
  (f.referencia === undefined || x.referencia === f.referencia) &&
  (f.de === undefined || x.dataReferencia >= f.de) &&
  (f.ate === undefined || x.dataReferencia <= f.ate);

export class PortaEsocialMemoria implements PortaEsocial {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();
  /** Testes: o relógio sintético das gravações. */
  agoraFixo: string | null = null;
  /** Catálogos e dados sintéticos (os testes trocam). */
  cnpjsSinteticos = new Map<number, string | null>([[1, CNPJ_SINTETICO_ESOCIAL]]);
  pendenciasSinteticas: PendenciaMigradaEsocial[] = [
    { evento: 'S-1010', ano: 2020, quantidade: 12 },
    { evento: 'S-1200', ano: 2021, quantidade: 40 },
    { evento: 'S-1200', ano: 2022, quantidade: 35 },
  ];
  recibosSinteticos = 3;

  private e(c: ContextoEsocial): Estado {
    let s = this.estados.get(chave(c));
    if (!s) this.estados.set(chave(c), (s = novo()));
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
      'O eSocial não usa o executor.',
    );
  }

  async gravarSgh<T>(
    c: ContextoEsocial,
    _trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorEsocial) => Promise<T>,
  ): Promise<T> {
    const s = copiar(this.e(c));
    const agora = this.agora();
    const g: GravadorEsocial = {
      empregadores: async (empresa) => this.listaEmpregadores(s, empresa),
      incluirEmpregador: async (x) => {
        if (s.empregadores.some((y) => y.empresa === x.empresa && y.inicio === x.inicio))
          throw recusa(
            'vigencia-repetida',
            'Já há parâmetros do eSocial com este início para a empresa: use um mês novo.',
          );
        const id = ++s.seq;
        s.empregadores.push({
          id,
          empresa: x.empresa,
          inicio: x.inicio,
          transmissor: x.transmissor,
          leiaute: x.leiaute,
          parametros: x.parametros,
          criadoPor: x.por,
          criadoEm: agora,
        });
        return id;
      },
      gravarFicha: async (x) => {
        const atual = s.fichas.find((f) => f.vinculo === x.vinculo);
        if (x.versao === null) {
          if (atual) throw desatualizado();
          const id = ++s.seq;
          s.fichas.push({
            id,
            vinculo: x.vinculo,
            dadosCifrados: x.dadosCifrados,
            versao: 0,
            alteradoPor: x.por,
            alteradoEm: agora,
          });
          return { id, versao: 0 };
        }
        if (!atual || atual.versao !== x.versao) throw desatualizado();
        Object.assign(atual, {
          dadosCifrados: x.dadosCifrados,
          versao: atual.versao + 1,
          alteradoPor: x.por,
          alteradoEm: agora,
        });
        return { id: atual.id, versao: atual.versao };
      },
      eventos: async (f) =>
        s.eventos
          .map((x) => x.evento)
          .filter((x) => filtra(x, f))
          .sort((a, b) => b.id - a.id),
      eventosComTrava: async (ids) => s.eventos.map((x) => x.evento).filter((x) => ids.includes(x.id)),
      // O sequencial do identificador acompanha o próximo id da memória (no banco, é a sequencia_negocio).
      proximoSequencialEvento: async () => s.seq + 1,
      incluirEvento: async (x) => {
        if (s.eventos.some((y) => y.evento.idEsocial === x.idEsocial))
          throw recusa('evento-repetido', 'O identificador do evento já existe.');
        const id = ++s.seq;
        s.eventos.push({
          xml: x.xml,
          evento: {
            id,
            empresa: x.empresa,
            evento: x.evento,
            grupo: x.grupo,
            operacao: x.operacao,
            idEsocial: x.idEsocial,
            vinculo: x.vinculo,
            origem: x.origem,
            referencia: x.referencia,
            dataReferencia: x.dataReferencia,
            leiaute: x.leiaute,
            xmlCifrado: x.xmlCifrado,
            hashXml: x.hashXml,
            errosXsd: [...x.errosXsd],
            situacao: x.situacao,
            eventoAnterior: x.eventoAnterior,
            lote: null,
            recibo: null,
            retornoCodigo: null,
            retornoDescricao: null,
            motivo: null,
            criadoPor: x.por,
            criadoEm: agora,
            situacaoPor: null,
            situacaoEm: null,
            versao: 0,
          },
        });
        return id;
      },
      mudarSituacaoEvento: async (x) => {
        const r = s.eventos.find((y) => y.evento.id === x.id);
        if (!r || r.evento.versao !== x.versao) throw desatualizado();
        r.evento = {
          ...r.evento,
          situacao: x.situacao,
          ...(x.lote !== undefined ? { lote: x.lote } : {}),
          ...(x.recibo !== undefined ? { recibo: x.recibo } : {}),
          ...(x.retorno !== undefined
            ? { retornoCodigo: x.retorno?.codigo ?? null, retornoDescricao: x.retorno?.descricao ?? null }
            : {}),
          ...(x.motivo !== undefined ? { motivo: x.motivo } : {}),
          situacaoPor: x.por,
          situacaoEm: agora,
          versao: r.evento.versao + 1,
        };
      },
      loteComTrava: async (id) => s.lotes.find((l) => l.id === id) ?? null,
      incluirLote: async (x) => {
        const id = ++s.seq;
        s.lotes.push({
          id,
          empresa: x.empresa,
          grupo: x.grupo,
          ambiente: x.ambiente,
          situacao: 'montado',
          quantidade: x.quantidade,
          protocolo: null,
          motivo: null,
          enviadoPor: null,
          enviadoEm: null,
          criadoPor: x.por,
          criadoEm: agora,
          versao: 0,
        });
        return id;
      },
      mudarSituacaoLote: async (x) => {
        const l = s.lotes.find((y) => y.id === x.id);
        if (!l || l.versao !== x.versao) throw desatualizado();
        Object.assign(l, {
          situacao: x.situacao,
          ...(x.protocolo !== undefined ? { protocolo: x.protocolo } : {}),
          ...(x.motivo !== undefined ? { motivo: x.motivo } : {}),
          ...(x.enviado ? { enviadoPor: x.por, enviadoEm: agora } : {}),
          versao: l.versao + 1,
        });
      },
      incluirConciliacao: async (x) => {
        const id = ++s.seq;
        s.conciliacoes.push({
          id,
          empresa: x.empresa,
          competencia: x.competencia,
          transmissor: x.transmissor,
          situacao: x.situacao,
          linhas: x.linhas,
          observacao: x.observacao,
          conferidoPor: x.por,
          conferidoEm: agora,
        });
        return id;
      },
    };
    const r = await fn(g);
    this.estados.set(chave(c), s);
    return r;
  }

  private listaEmpregadores(s: Estado, empresa: number | null): VigenciaEmpregadorEsocial[] {
    return s.empregadores
      .filter((x) => empresa === null || x.empresa === empresa)
      .sort((a, b) => a.empresa - b.empresa || b.inicio.localeCompare(a.inicio));
  }

  // ── Catálogos e pendências migradas (sintéticos) ─────────────────────────────────────────────────────────

  async eventosCatalogo(): Promise<EventoDoCatalogoEsocial[]> {
    return CATALOGO_EVENTOS_ESOCIAL.map((e, i) => ({
      id: i + 1,
      codigo: e.codigo,
      nome: e.rotulo,
      grupo: NUMERO_GRUPO_ESOCIAL[e.grupo],
    }));
  }
  async leiauteCatalogo(): Promise<LeiauteDoCatalogoEsocial[]> {
    return CATALOGO_EVENTOS_ESOCIAL.map((e) => ({
      evento: e.codigo,
      versao: 'v_S_01_03_00',
      inicio: '2024-12-02',
    }));
  }
  async motivosAfastamento(): Promise<ItemDoCatalogoEsocial[]> {
    return [
      { codigo: '01', rotulo: 'Acidente ou doença do trabalho' },
      { codigo: '03', rotulo: 'Acidente ou doença não relacionada ao trabalho' },
      { codigo: '15', rotulo: 'Gozo de férias ou recesso' },
      { codigo: '17', rotulo: 'Licença maternidade' },
    ];
  }
  async categorias(): Promise<ItemDoCatalogoEsocial[]> {
    return [
      { codigo: '101', rotulo: 'Empregado - Geral' },
      { codigo: '731', rotulo: 'Contribuinte individual - Cooperado' },
      { codigo: '901', rotulo: 'Estagiário' },
      { codigo: '902', rotulo: 'Médico residente' },
    ];
  }
  async cnpjs(): Promise<Map<number, string | null>> {
    return new Map(this.cnpjsSinteticos);
  }
  async pendenciasMigradas(_c: ContextoEsocial, empresa: number | null): Promise<PendenciaMigradaEsocial[]> {
    return empresa === null || empresa === 1 ? [...this.pendenciasSinteticas] : [];
  }
  async recibosAutonomo(): Promise<number> {
    return this.recibosSinteticos;
  }

  // ── Registros ────────────────────────────────────────────────────────────────────────────────────────────────────

  async empregadores(c: ContextoEsocial, empresa: number | null) {
    return this.listaEmpregadores(this.e(c), empresa);
  }
  async ficha(c: ContextoEsocial, vinculo: number) {
    const f = this.e(c).fichas.find((x) => x.vinculo === vinculo);
    return f ? { ...f } : null;
  }
  async eventos(c: ContextoEsocial, f: FiltroRegistrosEventoEsocial) {
    return this.e(c)
      .eventos.map((x) => x.evento)
      .filter((x) => filtra(x, f))
      .sort((a, b) => b.id - a.id)
      .slice(0, 1_001);
  }
  async evento(c: ContextoEsocial, id: number) {
    const x = this.e(c).eventos.find((y) => y.evento.id === id);
    return x ? { evento: { ...x.evento }, xml: x.xml } : null;
  }
  async contagemEventos(
    c: ContextoEsocial,
    empresas: readonly number[],
    de: string,
    ate: string,
    situacoes: readonly string[],
  ) {
    const r: Record<string, number> = {};
    for (const { evento: x } of this.e(c).eventos)
      if (
        empresas.includes(x.empresa) &&
        situacoes.includes(x.situacao) &&
        x.dataReferencia >= de &&
        x.dataReferencia <= ate
      )
        r[x.evento] = (r[x.evento] ?? 0) + 1;
    return r;
  }
  async lotes(c: ContextoEsocial, f: { readonly empresa?: number; readonly situacao?: string }) {
    return this.e(c)
      .lotes.filter(
        (l) =>
          (f.empresa === undefined || l.empresa === f.empresa) &&
          (f.situacao === undefined || l.situacao === f.situacao),
      )
      .sort((a, b) => b.id - a.id)
      .map((l) => ({ ...l }));
  }
  async lote(c: ContextoEsocial, id: number) {
    const l = this.e(c).lotes.find((x) => x.id === id);
    return l ? { ...l } : null;
  }
  async ultimaConciliacao(c: ContextoEsocial, empresa: number, competencia: string) {
    const xs = this.e(c).conciliacoes.filter((x) => x.empresa === empresa && x.competencia === competencia);
    return xs.length ? { ...xs[xs.length - 1]! } : null;
  }
}
