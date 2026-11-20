// Porta das obrigações com a ANS em MEMÓRIA (M56, etapa 7, F6): a sessão sintética de dev/ci (E2E). As operadoras, os
// produtos, os contratos e os beneficiários vêm da porta em memória da F1, as cobranças da porta da F2 e as contas
// médicas da porta da F5 (as mesmas que as outras telas mostram); os grupos e os procedimentos do SIP são os SINTÉTICOS
// da F1; os motivos e os campos do SIB e os valores da TPS são os da norma (domínio público, sem dado de pessoa). Os
// envios, os itens, o histórico e o complemento do SIB ficam em memória com as mesmas recusas das SGH_ (enviado sem
// retorno, substituído que mudou, sequencial e aviso repetidos, versão vista e situação de partida, CCO em uso) e a
// transação desfeita por inteiro quando a função falha. Nada vai à cópia. A trilha da memória é registrada pela API.
import {
  type AtivosLidos,
  type BeneficiarioOpeLido,
  type BeneficiarioSibLido,
  type ComplementoSibLido,
  type EnvioAnsLido,
  type EnvioExistenteLido,
  type EventoEnvioAnsLido,
  ErroOperacao,
  type FiltroEnviosLido,
  type GuiaMonitoramentoLida,
  type ItemEnvioAnsLido,
  type ItemSipLido,
  LIMITE_PAGINA_ENVIOS,
  LIMITE_PAGINA_SIB,
  type ObrigacaoLida,
  type ProdutoOpeLido,
  type SituacaoEnvioLida,
} from '@sgh/legado';
import type { ContextoAns, GravadorAns, PortaAnsOperadora } from './ans-porta.js';
import type { PortaCobrancaOperadora } from './cobranca-porta.js';
import type { PortaContasOperadora } from './contas-porta.js';
import type { PortaOperadora } from './porta.js';

/** Motivos de movimentação cadastral do SIB (o grupo: 1 inclusão, 2 alteração, 3 cancelamento, 4 reativação). */
export const MOTIVOS_SIB_MEMORIA = [
  { codigo: 1, nome: 'Inclusão de beneficiário', grupo: 1 },
  { codigo: 2, nome: 'Inclusão por transferência de código', grupo: 1 },
  { codigo: 3, nome: 'Alteração de dados contratuais', grupo: 2 },
  { codigo: 4, nome: 'Mudança de plano ou faixa', grupo: 2 },
  { codigo: 5, nome: 'Rompimento do contrato por iniciativa do contratante ou do beneficiário', grupo: 3 },
  { codigo: 6, nome: 'Fim do vínculo com o titular', grupo: 3 },
  { codigo: 7, nome: 'Desligamento da empresa (plano coletivo)', grupo: 3 },
  { codigo: 8, nome: 'Inadimplência', grupo: 3 },
  { codigo: 9, nome: 'Óbito', grupo: 3 },
  { codigo: 10, nome: 'Alteração individual do código do beneficiário', grupo: 3 },
  { codigo: 11, nome: 'Reativação', grupo: 4 },
  { codigo: 12, nome: 'Reativação por renegociação do contrato', grupo: 4 },
] as const;

const CAMPOS_SIB_MEMORIA = [
  'Carteirinha',
  'Nome',
  'Data de nascimento',
  'Sexo',
  'CPF',
  'Nome da mãe',
  'Declaração de nascido vivo',
  'Cartão Nacional de Saúde',
  'Titular',
  'Logradouro',
  'Número',
  'Complemento',
  'Bairro',
  'Município',
  'CEP',
  'Reside no exterior',
  'Data de adesão',
  'Relação de dependência',
  'CAEPF',
].map((nome, k) => ({ codigo: k + 1, nome }));

/** Valores da TPS por beneficiário (Lei 9.961/2000, art. 20, I, e a atualização de 2015). */
export const VALORES_TPS_MEMORIA = [
  { vigencia: '2000-01-01', valorAnual: 2, valorTrimestral: 0.5 },
  { vigencia: '2015-09-01', valorAnual: 5.39, valorTrimestral: 1.3475 },
] as const;

const p2 = (n: number) => String(n).padStart(2, '0');
function agoraLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
const recusa = (codigo: string, detail: string) => new ErroOperacao(409, codigo, 'Operação recusada', detail);
const DESATUALIZADO = () =>
  recusa(
    'envio-desatualizado',
    'O envio mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira.',
  );

type Mut<T> = { -readonly [K in keyof T]: T[K] };

/** O objeto sem as chaves (cópia rasa). */
function sem<T extends object, K extends keyof T>(o: T, ...chaves: K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !chaves.includes(k as K))) as Omit<T, K>;
}
interface EnvioMem extends Mut<EnvioAnsLido> {
  hospital: string;
  arquivoBase64: string | null;
}
interface ItemMem extends Mut<ItemEnvioAnsLido> {
  envio: number;
}
interface EventoMem extends EventoEnvioAnsLido {
  envio: number;
}
type ComplementoMem = Mut<ComplementoSibLido> & { hospital: string };

interface Estado {
  envios: EnvioMem[];
  itens: ItemMem[];
  eventos: EventoMem[];
  complementos: Map<number, ComplementoMem>;
  seq: number;
}

const copia = (e: Estado): Estado => ({
  envios: e.envios.map((x) => ({ ...x })),
  itens: e.itens.map((x) => ({ ...x })),
  eventos: [...e.eventos],
  complementos: new Map([...e.complementos].map(([k, v]) => [k, { ...v }])),
  seq: e.seq,
});

export class PortaAnsOperadoraMemoria implements PortaAnsOperadora {
  readonly destino = 'memoria' as const;
  private estado: Estado = { envios: [], itens: [], eventos: [], complementos: new Map(), seq: 0 };
  /** O relógio (os testes fixam). */
  agora: () => string = agoraLocal;

  constructor(
    private readonly operadora: PortaOperadora,
    private readonly cobranca: PortaCobrancaOperadora | null = null,
    private readonly contas: PortaContasOperadora | null = null,
  ) {}

  async relogio() {
    const agora = this.agora();
    return { hoje: agora.slice(0, 10), agora };
  }

  operadoras(c: ContextoAns) {
    return this.operadora.operadoras(c);
  }

  async motivosSib() {
    return MOTIVOS_SIB_MEMORIA.map((m) => ({ ...m }));
  }

  async camposSib() {
    return CAMPOS_SIB_MEMORIA.map((m) => ({ ...m }));
  }

  async valoresTps() {
    return VALORES_TPS_MEMORIA.map((v) => ({ ...v }));
  }

  gruposSip(c: ContextoAns) {
    return this.operadora.gruposSip(c);
  }

  // ── Envios ────────────────────────────────────────────────────────────────────────────────────

  private daqui(c: ContextoAns) {
    return this.estado.envios.filter((e) => e.hospital === c.hospital);
  }

  private semInterno(e: EnvioMem): EnvioAnsLido {
    return sem(e, 'hospital', 'arquivoBase64');
  }

  async envios(c: ContextoAns, f: FiltroEnviosLido) {
    const limite = Math.min(Math.max(1, f.limite ?? LIMITE_PAGINA_ENVIOS), LIMITE_PAGINA_ENVIOS);
    const lista = this.daqui(c)
      .filter(
        (e) =>
          (f.operadora === undefined || e.operadora.id === f.operadora) &&
          (!f.obrigacao || e.obrigacao === f.obrigacao) &&
          (!f.competencia ||
            (/^\d{4}$/.test(f.competencia)
              ? e.competencia.startsWith(f.competencia)
              : e.competencia === f.competencia)) &&
          (!f.situacao || e.situacao === f.situacao) &&
          (f.apos === undefined || e.id < f.apos),
      )
      .sort((a, b) => b.id - a.id);
    const itens = lista.slice(0, limite).map((e) => this.semInterno(e));
    return { itens, proxima: lista.length > limite ? (itens[itens.length - 1]?.id ?? null) : null };
  }

  async totais(c: ContextoAns) {
    const hoje = (await this.relogio()).hoje;
    const d = this.daqui(c);
    return {
      gerados: d.filter((e) => e.situacao === 'gerado').length,
      aguardandoRetorno: d.filter((e) => e.situacao === 'enviado').length,
      rejeitados: d.filter((e) => e.situacao === 'rejeitado').length,
      ressarcimentosEmPrazo: d.filter(
        (e) => e.obrigacao === 'RESSARCIMENTO_SUS' && e.situacao === 'gerado' && (e.prazo ?? '') >= hoje,
      ).length,
    };
  }

  async envio(c: ContextoAns, id: number) {
    const e = this.daqui(c).find((x) => x.id === id);
    return e ? this.semInterno(e) : null;
  }

  async arquivo(c: ContextoAns, id: number) {
    const e = this.daqui(c).find((x) => x.id === id);
    return e?.arquivoBase64 && e.arquivoNome && e.hash
      ? { nome: e.arquivoNome, base64: e.arquivoBase64, sha256: e.hash }
      : null;
  }

  async itens(c: ContextoAns, id: number): Promise<ItemEnvioAnsLido[]> {
    if (!(await this.envio(c, id))) return [];
    return this.estado.itens
      .filter((i) => i.envio === id)
      .sort((a, b) => a.ordem - b.ordem)
      .map((i) => sem(i, 'envio'));
  }

  async eventos(c: ContextoAns, id: number): Promise<EventoEnvioAnsLido[]> {
    if (!(await this.envio(c, id))) return [];
    return this.estado.eventos.filter((v) => v.envio === id).map((v) => sem(v, 'envio'));
  }

  async existentes(c: ContextoAns, operadora: number, obrigacao: ObrigacaoLida, competencia: string) {
    return this.daqui(c)
      .filter(
        (e) =>
          e.operadora.id === operadora &&
          e.obrigacao === obrigacao &&
          (e.competencia === competencia || e.situacao === 'gerado' || e.situacao === 'enviado'),
      )
      .map((e): EnvioExistenteLido => ({
        id: e.id,
        obrigacao: e.obrigacao,
        competencia: e.competencia,
        sequencial: e.sequencial,
        situacao: e.situacao,
      }));
  }

  // ── Fontes (F1, F2, F5) ───────────────────────────────────────────────────────────────────────

  private async todosBeneficiarios(c: ContextoAns, operadora: number): Promise<BeneficiarioOpeLido[]> {
    const r: BeneficiarioOpeLido[] = [];
    let apos: number | undefined;
    for (;;) {
      const p = await this.operadora.beneficiarios(c, { operadora, ...(apos === undefined ? {} : { apos }) });
      r.push(...p.itens);
      if (p.proxima === null) return r;
      apos = p.proxima;
    }
  }

  private async produtosPorContrato(c: ContextoAns, contratos: readonly number[]) {
    const m = new Map<
      number,
      { contrato: Awaited<ReturnType<PortaOperadora['contrato']>>; produto: ProdutoOpeLido | null }
    >();
    for (const id of new Set(contratos)) {
      const contrato = await this.operadora.contrato(c, id);
      m.set(id, { contrato, produto: contrato ? await this.operadora.produto(c, contrato.produto) : null });
    }
    return m;
  }

  async beneficiariosSib(c: ContextoAns, operadora: number, apos: number) {
    const todos = (await this.todosBeneficiarios(c, operadora)).filter((b) => b.id > apos);
    const pagina = todos.slice(0, LIMITE_PAGINA_SIB);
    const porId = new Map(todos.map((b) => [b.id, b]));
    const pc = await this.produtosPorContrato(
      c,
      pagina.map((b) => b.contrato),
    );
    const itens = pagina.map((b): BeneficiarioSibLido => {
      const x = pc.get(b.contrato);
      const t = b.titular === null ? null : (porId.get(b.titular) ?? null);
      return {
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
                cco: this.estado.complementos.get(b.titular)?.cco ?? null,
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
        complemento: this.complementoDe(c, b.id),
      };
    });
    return {
      itens,
      proxima: todos.length > LIMITE_PAGINA_SIB ? (itens[itens.length - 1]?.id ?? null) : null,
    };
  }

  private complementoDe(c: ContextoAns, beneficiario: number): ComplementoSibLido | null {
    const x = this.estado.complementos.get(beneficiario);
    if (!x || x.hospital !== c.hospital) return null;
    return sem(x, 'hospital');
  }

  async complementoSib(c: ContextoAns, beneficiario: number) {
    return this.complementoDe(c, beneficiario);
  }

  async beneficiarioDaOperadora(c: ContextoAns, beneficiario: number) {
    const b = await this.operadora.beneficiario(c, beneficiario);
    return b ? { id: b.id, operadora: b.operadora, carteirinha: b.carteirinha, nome: b.nome } : null;
  }

  async ativosNaData(c: ContextoAns, operadora: number, data: string): Promise<AtivosLidos[]> {
    const bs = (await this.todosBeneficiarios(c, operadora)).filter(
      (b) => b.inclusao <= data && (b.exclusao === null || b.exclusao > data),
    );
    const pc = await this.produtosPorContrato(
      c,
      bs.map((b) => b.contrato),
    );
    const m = new Map<number, Mut<AtivosLidos>>();
    for (const b of bs) {
      const p = pc.get(b.contrato)?.produto;
      if (!p || p.natureza !== 'plano') continue;
      const x = m.get(p.id) ?? {
        produto: p.id,
        nome: p.nome,
        registroAns: p.registroAns,
        segmentacao: p.segmentacao,
        tipoContratacao: p.tipoContratacao,
        quantidade: 0,
      };
      x.quantidade += 1;
      m.set(p.id, x);
    }
    return [...m.values()].sort((a, b) => a.produto - b.produto);
  }

  async planos(c: ContextoAns, operadora: number) {
    return (await this.operadora.produtos(c, operadora))
      .filter((p) => p.natureza === 'plano')
      .map((p) => ({ produto: p.id, nome: p.nome, registroAns: p.registroAns }));
  }

  /** As contas da F5 da operadora (todas as páginas). */
  private async contasDa(c: ContextoAns, operadora: number) {
    if (!this.contas) return [];
    const r: Awaited<ReturnType<PortaContasOperadora['contas']>>['itens'] = [];
    let apos: number | undefined;
    for (;;) {
      const p = await this.contas.contas(c, apos === undefined ? {} : { apos });
      r.push(...p.itens);
      if (p.proxima === null) break;
      apos = p.proxima;
    }
    return r.filter((k) => k.operadora === operadora);
  }

  async itensSip(c: ContextoAns, operadora: number, inicio: string, fim: string, apos: number) {
    const contas = this.contas;
    if (!contas) return { itens: [], proxima: null };
    const r: ItemSipLido[] = [];
    for (const k of (await this.contasDa(c, operadora)).filter((x) => x.situacao !== 'devolvida')) {
      const guias = new Map((await contas.guias(c, k.id)).map((g) => [g.id, g]));
      for (const i of await contas.itens(c, k.id)) {
        if (i.data < inicio || i.data > fim || i.id <= apos) continue;
        const g = guias.get(i.guia);
        const b = g?.beneficiario ? await this.operadora.beneficiario(c, g.beneficiario.id) : null;
        const p = b ? (await this.produtosPorContrato(c, [b.contrato])).get(b.contrato)?.produto : null;
        r.push({
          id: i.id,
          beneficiario: b?.id ?? null,
          segmentacao: p?.segmentacao ?? null,
          municipio: b ? (this.estado.complementos.get(b.id)?.municipio ?? null) : null,
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

  async vigenciasSip(c: ContextoAns, procedimentos: readonly number[]) {
    const r = [];
    for (const p of new Set(procedimentos)) {
      const x = await this.operadora.procedimentosSip(c, { procedimento: p });
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
  ) {
    if (!this.cobranca) return [];
    const r = [];
    let apos: number | undefined;
    for (;;) {
      const p = await this.cobranca.cobrancas(c, { operadora, ...(apos === undefined ? {} : { apos }) });
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

  async contasDiops(c: ContextoAns, operadora: number, inicio: string, fim: string) {
    const contas = [];
    const pagamentos = [];
    for (const k of await this.contasDa(c, operadora)) {
      const dia = k.recebidaEm.slice(0, 10);
      if (dia >= inicio && dia <= fim)
        contas.push({
          recebidaEm: dia,
          apresentado: k.apresentado,
          glosado: k.glosado,
          situacao: k.situacao,
        });
      for (const v of (await this.contas?.eventos(c, k.id)) ?? [])
        if (v.evento === 'pagamento' && v.pagoEm && v.pagoEm >= inicio && v.pagoEm <= fim)
          pagamentos.push({ pagoEm: v.pagoEm, valor: v.valor ?? 0 });
    }
    return { contas, pagamentos };
  }

  async guiasMonitoramento(c: ContextoAns, operadora: number, inicio: string, fim: string, teto: number) {
    const contas = this.contas;
    if (!contas) return [];
    const r: GuiaMonitoramentoLida[] = [];
    for (const k of await this.contasDa(c, operadora)) {
      if (k.situacao !== 'analisada' && k.situacao !== 'paga') continue;
      const ficha = await contas.conta(c, k.id);
      const dia = (ficha?.analisadaEm ?? '').slice(0, 10);
      if (!dia || dia < inicio || dia > fim) continue;
      const itens = await contas.itens(c, k.id);
      for (const g of await contas.guias(c, k.id)) {
        if (r.length > teto) return r;
        const b = g.beneficiario ? await this.operadora.beneficiario(c, g.beneficiario.id) : null;
        const comp = b ? this.estado.complementos.get(b.id) : undefined;
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
                municipio: comp?.municipio ?? null,
                cco: comp?.cco ?? null,
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

  async beneficiariosRessarcimento(c: ContextoAns, operadora: number, identificacoes: readonly string[]) {
    const ids = new Set(identificacoes);
    const r = [];
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
        coberturaParcial: this.estado.complementos.get(b.id)?.coberturaParcial ?? false,
      });
    }
    return r;
  }

  async atendimentosJaCobrados(c: ContextoAns, atendimentos: readonly { tipo: string; numero: string }[]) {
    const meus = new Set(this.daqui(c).map((e) => e.id));
    const ja = new Set(
      this.estado.itens.filter((i) => meus.has(i.envio)).map((i) => `${i.tipo}${i.referencia}`),
    );
    return new Set(atendimentos.map((a) => `${a.tipo}${a.numero}`).filter((k) => ja.has(k)));
  }

  // ── Gravações ─────────────────────────────────────────────────────────────────────────────────

  async gravarSgh<T>(c: ContextoAns, _trilha: unknown, fn: (g: GravadorAns) => Promise<T>): Promise<T> {
    const antes = copia(this.estado);
    try {
      return await fn(this.gravador(c));
    } catch (x) {
      this.estado = antes;
      throw x;
    }
  }

  private evento(
    envio: number,
    evento: string,
    situacao: SituacaoEnvioLida,
    texto: string | null,
    por: string,
  ) {
    this.estado.eventos.push({ envio, evento, situacao, texto, por, em: this.agora() });
  }

  private mudar(c: ContextoAns, id: number, versao: number, de: readonly SituacaoEnvioLida[]): EnvioMem {
    const e = this.estado.envios.find((x) => x.id === id && x.hospital === c.hospital);
    if (!e || e.versao !== versao || !de.includes(e.situacao)) throw DESATUALIZADO();
    e.versao += 1;
    return e;
  }

  private gravador(c: ContextoAns): GravadorAns {
    return {
      gerar: async (g) => {
        const mesmos = this.daqui(c).filter(
          (e) => e.operadora.id === g.operadora && e.obrigacao === g.obrigacao,
        );
        if (
          mesmos.some(
            (e) => e.situacao === 'enviado' && (g.obrigacao === 'SIB' || e.competencia === g.competencia),
          )
        )
          throw recusa('aguardando-retorno', 'Há arquivo desta obrigação enviado e sem o retorno da ANS.');
        for (const s of g.substituir) {
          const e = mesmos.find((x) => x.id === s && x.situacao === 'gerado');
          if (!e) throw DESATUALIZADO();
          e.situacao = 'substituido';
          e.versao += 1;
          this.evento(
            s,
            'substituicao',
            'substituido',
            `Substituído pelo arquivo ${g.sequencial}.`,
            g.usuario,
          );
        }
        if (mesmos.some((e) => e.competencia === g.competencia && e.sequencial === g.sequencial))
          throw recusa('numero-em-uso', 'Outro arquivo desta competência acabou de ser gerado.');
        if (g.aviso && mesmos.some((e) => e.aviso === g.aviso?.numero))
          throw recusa('aviso-repetido', 'Este aviso de ressarcimento já foi registrado.');
        const o = (await this.operadora.operadoras(c)).find((x) => x.id === g.operadora);
        const id = ++this.estado.seq;
        const agora = this.agora();
        this.estado.envios.push({
          hospital: c.hospital,
          id,
          versao: 1,
          operadora: {
            id: g.operadora,
            nome: o?.nomeFantasia ?? o?.razaoSocial ?? '',
            registroAns: o?.registroAns ?? '',
          },
          obrigacao: g.obrigacao as ObrigacaoLida,
          competencia: g.competencia,
          sequencial: g.sequencial,
          retificador: g.retificador,
          destino: g.destino,
          leiaute: g.leiaute,
          situacao: 'gerado',
          registros: g.registros,
          valorTotal: g.valorTotal,
          arquivoNome: g.arquivo?.nome ?? null,
          arquivoBytes: g.arquivo?.bytes ?? null,
          hash: g.arquivo?.sha256 ?? null,
          arquivoBase64: g.arquivo?.base64 ?? null,
          recibo: null,
          criadoEm: agora,
          criadoPor: g.usuario,
          enviadoEm: null,
          retornoEm: null,
          aviso: g.aviso?.numero ?? null,
          recebidoEm: g.aviso?.recebidoEm ?? null,
          prazo: g.aviso?.prazo ?? null,
          gru: null,
          pagoEm: null,
          valorPago: null,
          quadros: g.quadros,
          retornoResumo: null,
        });
        for (const i of g.itens)
          this.estado.itens.push({
            envio: id,
            id: ++this.estado.seq,
            ordem: i.ordem,
            tipo: i.tipo,
            referencia: i.referencia,
            descricao: i.descricao,
            beneficiario: i.beneficiario,
            valor: i.valor,
            dados: i.dados,
            resultado: 'enviado',
            erro: null,
            cco: null,
            sugestao: i.sugestao ?? null,
            decisao: i.decisao ?? null,
            motivo: null,
            justificativa: null,
            decididoEm: null,
            decididoPor: null,
          });
        this.evento(id, 'geracao', 'gerado', `${g.registros} registro(s).`, g.usuario);
        return { id, versao: 1 };
      },
      transmitir: async (x) => {
        const e = this.mudar(c, x.id, x.versao, ['gerado']);
        e.situacao = 'enviado';
        e.recibo = x.recibo;
        e.enviadoEm = this.agora();
        if (x.arquivo) {
          e.arquivoNome = x.arquivo.nome;
          e.arquivoBytes = x.arquivo.bytes;
          e.hash = x.arquivo.sha256;
          e.arquivoBase64 = x.arquivo.base64;
        }
        this.evento(x.id, x.arquivo ? 'protocolo' : 'envio', 'enviado', x.texto, x.usuario);
        return { id: x.id, versao: e.versao };
      },
      retorno: async (x) => {
        const e = this.mudar(c, x.id, x.versao, ['enviado']);
        e.situacao = x.situacao;
        e.retornoEm = this.agora();
        e.retornoResumo = x.resumo;
        for (const r of x.itens) {
          const i = this.estado.itens.find((y) => y.id === r.id && y.envio === x.id);
          if (!i)
            throw recusa(
              'item-de-outro-envio',
              'O resultado informado é de um item que não está neste envio.',
            );
          i.resultado = r.aceito ? 'aceito' : 'rejeitado';
          i.erro = r.erro;
          i.cco = r.cco;
          if (!x.sib || !r.aceito || i.beneficiario === null) continue;
          if (
            r.cco &&
            [...this.estado.complementos].some(([k, v]) => k !== i.beneficiario && v.cco === r.cco)
          )
            throw recusa('cco-em-uso', 'Este CCO já é de outro beneficiário da operadora.');
          const atual = this.estado.complementos.get(i.beneficiario);
          this.estado.complementos.set(i.beneficiario, {
            ...(atual ?? vazio(c.hospital, i.beneficiario)),
            cco: r.cco ?? atual?.cco ?? null,
            aceito: i.dados,
            aceitoEm: this.agora(),
            versao: (atual?.versao ?? 0) + 1,
          });
        }
        this.evento(x.id, 'retorno', x.situacao, x.texto, x.usuario);
        return { id: x.id, versao: e.versao };
      },
      pagar: async (x) => {
        const e = this.mudar(c, x.id, x.versao, ['aceito', 'aceitoParcial']);
        e.gru = x.gru;
        e.valorPago = x.valor;
        e.pagoEm = x.data;
        this.evento(x.id, 'pagamento', e.situacao, `GRU ${x.gru}.`, x.usuario);
        return { id: x.id, versao: e.versao };
      },
      decidir: async (x) => {
        const e = this.mudar(c, x.id, x.versao, ['gerado']);
        const i = this.estado.itens.find((y) => y.id === x.item && y.envio === x.id && y.decisao !== null);
        if (!i) throw recusa('item-de-outro-envio', 'O atendimento não está neste aviso.');
        i.decisao = x.decisao;
        i.motivo = x.decisao === 'impugnar' ? x.motivo : null;
        i.justificativa = x.justificativa;
        i.decididoEm = this.agora();
        i.decididoPor = x.usuario;
        this.evento(x.id, 'decisao', 'gerado', x.texto, x.usuario);
        return { id: x.id, versao: e.versao };
      },
      complemento: async (x) => {
        const atual = this.estado.complementos.get(x.beneficiario);
        if ((atual?.versao ?? 0) !== x.versao) throw DESATUALIZADO();
        if (x.cco && [...this.estado.complementos].some(([k, v]) => k !== x.beneficiario && v.cco === x.cco))
          throw recusa('cco-em-uso', 'Este CCO já é de outro beneficiário da operadora.');
        const campos = sem(x, 'usuario', 'versao');
        this.estado.complementos.set(x.beneficiario, {
          ...(atual ?? vazio(c.hospital, x.beneficiario)),
          ...campos,
          hospital: c.hospital,
          versao: x.versao + 1,
        });
        return { id: x.beneficiario, versao: x.versao + 1 };
      },
    };
  }
}

function vazio(hospital: string, beneficiario: number): ComplementoMem {
  return {
    hospital,
    beneficiario,
    versao: 0,
    logradouro: null,
    numero: null,
    complemento: null,
    bairro: null,
    municipio: null,
    cep: null,
    resideExterior: false,
    dnv: null,
    coberturaParcial: false,
    itensExcluidos: false,
    cco: null,
    motivoCancelamento: null,
    aceito: null,
    aceitoEm: null,
  };
}
