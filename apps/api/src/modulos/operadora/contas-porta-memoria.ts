// Porta das contas médicas em MEMÓRIA (M56, etapa 6, F5): a sessão sintética de dev/ci (E2E). As operadoras e o
// beneficiário pela carteirinha vêm da porta em memória da F1, os prestadores da porta em memória da F3 e as
// autorizações pela senha e os auditores designados da porta em memória da F4 (os mesmos que as outras telas mostram);
// os motivos de glosa são SINTÉTICOS (os códigos da tabela 38 da TISS que a operadora usa, com descrições próprias). Os
// lotes, as guias, os itens e o histórico ficam em memória com as mesmas recusas das (lote e arquivo repetidos,
// versão vista e situação de partida, item de outro lote, um recurso por guia) e a transação desfeita por inteiro quando
// a função falha. Nada vai ao banco. A trilha da memória é registrada pela API (como na rede).
import { CRITICAS_CONTA, type MotivoGlosaLido } from '@sgh/contratos';
import { problemasDoParecerDoRecurso, rateioDoAcatado, situacaoDoRecurso } from '@sgh/dominio-operadora';
import { ErroOperacao } from '@sgh/nucleo';
import {
  type DadosAuditor,
  type DadosAutorizacaoDaSenha,
  type DadosConta,
  type DadosContaResumo,
  type DadosEventoConta,
  type DadosGuiaConta,
  type DadosItemConta,
  type DadosRecursoItem,
  type FiltroContasPorta,
  type FiltroPagamentosPorta,
  LIMITE_PAGINA_CONTAS,
  type SituacaoContaPorta,
} from './dados-portas.js';
import type {
  ArquivoEnviadoPortal,
  ContextoContas,
  GravadorContas,
  PortaContasOperadora,
} from './contas-porta.js';
import type { PortaOperadora } from './porta.js';
import type { PortaRedeOperadora } from './rede-porta.js';

/** Motivos de glosa SINTÉTICOS: os códigos da tabela 38 das críticas e mais alguns do auditor. */
export const MOTIVOS_GLOSA_SINTETICOS: readonly MotivoGlosaLido[] = [
  ...new Set([...Object.values(CRITICAS_CONTA).map((c) => c.motivo), 1801, 2009, 3052]),
]
  .sort((a, b) => a - b)
  .map((codigo) => ({
    codigo,
    nome: `Motivo ${codigo} (sintético)`,
    tipo: Math.floor(codigo / 100),
    tipoNome: `Grupo ${Math.floor(codigo / 100)} (sintético)`,
    reapresenta: true,
  }));

const p2 = (n: number) => String(n).padStart(2, '0');
function agoraLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

const recusa = (codigo: string, detail: string) => new ErroOperacao(409, codigo, 'Operação recusada', detail);
const c2 = (v: number) => Math.round(v * 100);
const r2 = (c: number) => Math.round(c) / 100;

type Mut<T> = { -readonly [K in keyof T]: T[K] };

/** O objeto sem as chaves (cópia rasa). */
function sem<T extends object, K extends keyof T>(o: T, ...chaves: K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !chaves.includes(k as K))) as Omit<T, K>;
}

interface ContaMem {
  hospital: string;
  id: number;
  operadora: number;
  prestador: number;
  protocolo: string;
  numeroLote: string;
  tipoGuia: DadosContaResumo['tipoGuia'];
  competencia: string;
  guias: number;
  recebidaEm: string;
  prazoPagamento: string;
  situacao: SituacaoContaPorta;
  apresentado: number;
  glosado: number;
  acatado: number;
  pago: number;
  arquivo: DadosConta['arquivo'] & { base64: string };
  auditor: number | null;
  analisadaEm: string | null;
  analisadaPor: string | null;
  observacao: string | null;
  motivoDevolucao: string | null;
  versao: number;
}

interface Estado {
  contas: ContaMem[];
  guias: (Mut<DadosGuiaConta> & { hospital: string; conta: number; prestador: number })[];
  itens: (Mut<DadosItemConta> & { hospital: string; conta: number })[];
  eventos: (DadosEventoConta & { hospital: string; conta: number })[];
  /** W0-10 (M8): o recurso por item (a decisão entra na mesma linha, como a junção da devolve). */
  recursosItens: (DadosRecursoItem & { hospital: string; conta: number })[];
  seq: Record<string, number>;
  /** C2-074: os XML guardados (a porta de arquivos da memória) e o registro do envio pelo portal. */
  arquivos: { hospital: string; id: number; nome: string; bytes: number }[];
  arquivosEnviados: (ArquivoEnviadoPortal & { hospital: string; id: number })[];
}

export class PortaContasOperadoraMemoria implements PortaContasOperadora {
  readonly destino = 'memoria' as const;
  private estado: Estado = {
    contas: [],
    guias: [],
    itens: [],
    eventos: [],
    recursosItens: [],
    seq: {},
    arquivos: [],
    arquivosEnviados: [],
  };

  /** O relógio da memória (os testes o fixam). */
  agora: () => string = agoraLocal;

  constructor(
    private readonly operadora: Pick<PortaOperadora, 'elegibilidade' | 'operadoras'>,
    private readonly rede: Pick<PortaRedeOperadora, 'prestador' | 'prestadores'>,
    private readonly autorizacao: {
      autorizacoesPorSenha(c: ContextoContas, senhas: readonly string[]): Promise<DadosAutorizacaoDaSenha[]>;
      designacoes(c: ContextoContas, login: string): Promise<DadosAuditor[]>;
    },
  ) {}

  async relogio() {
    const agora = this.agora();
    return { hoje: agora.slice(0, 10), agora };
  }

  operadoras(c: ContextoContas) {
    return this.operadora.operadoras(c);
  }

  async prestadores(c: ContextoContas) {
    const r: { id: number; nome: string }[] = [];
    let apos: { nome: string; id: number } | undefined;
    for (let i = 0; i < 20; i++) {
      const p = await this.rede.prestadores(c, apos ? { apos } : {});
      r.push(...p.itens.map((x) => ({ id: x.id, nome: x.nome })));
      if (!p.proxima) break;
      apos = p.proxima;
    }
    return r;
  }

  async prestadorPorDocumento(c: ContextoContas, documento: string) {
    const p = await this.rede.prestadores(c, { busca: documento });
    return p.itens.find((x) => x.documento === documento) ?? null;
  }

  elegibilidade(c: ContextoContas, carteirinha: string) {
    return this.operadora.elegibilidade(c, carteirinha);
  }

  autorizacoesPorSenha(c: ContextoContas, senhas: readonly string[]) {
    return this.autorizacao.autorizacoesPorSenha(c, senhas);
  }

  designacoes(c: ContextoContas, login: string) {
    return this.autorizacao.designacoes(c, login);
  }

  async guiasJaApresentadas(c: ContextoContas, prestador: number, numeros: readonly string[]) {
    const vivas = new Set(
      this.estado.contas
        .filter((x) => x.hospital === c.hospital && x.situacao !== 'devolvida')
        .map((x) => x.id),
    );
    return new Set(
      this.estado.guias
        .filter((g) => g.hospital === c.hospital && g.prestador === prestador && vivas.has(g.conta))
        .map((g) => g.numeroGuiaPrestador)
        .filter((n) => numeros.includes(n)),
    );
  }

  async loteJaRecebido(
    c: ContextoContas,
    x: { operadora: number; prestador: number; numeroLote: string; sha256: string },
  ) {
    return this.estado.contas.some(
      (k) =>
        k.hospital === c.hospital &&
        ((k.prestador === x.prestador && k.numeroLote === x.numeroLote && k.situacao !== 'devolvida') ||
          (k.operadora === x.operadora && k.arquivo.sha256 === x.sha256)),
    );
  }

  async motivos() {
    return [...MOTIVOS_GLOSA_SINTETICOS];
  }

  private readonly nomesPrestador = new Map<
    number,
    { nome: string; documento: string; pessoa: 'F' | 'J'; cnes: string | null }
  >();
  private readonly operadorasMem = new Map<number, { nome: string; registroAns: string; cnpj: string }>();

  private vencida(k: ContaMem): boolean {
    return (
      (k.situacao === 'recebida' || k.situacao === 'analisada') &&
      k.prazoPagamento < this.agora().slice(0, 10)
    );
  }

  private resumo(k: ContaMem): DadosContaResumo {
    return {
      id: k.id,
      operadora: k.operadora,
      prestador: k.prestador,
      prestadorNome: this.nomesPrestador.get(k.prestador)?.nome ?? '',
      protocolo: k.protocolo,
      numeroLote: k.numeroLote,
      tipoGuia: k.tipoGuia,
      competencia: k.competencia,
      guias: k.guias,
      recebidaEm: k.recebidaEm,
      prazoPagamento: k.prazoPagamento,
      vencida: this.vencida(k),
      situacao: k.situacao,
      apresentado: k.apresentado,
      glosado: k.glosado,
      acatado: k.acatado,
      pago: k.pago,
      recursosPendentes: this.estado.guias.filter(
        (g) => g.conta === k.id && g.recurso?.situacao === 'pendente',
      ).length,
      versao: k.versao,
    };
  }

  private pagina(itens: ContaMem[], apos: number | undefined, limite = LIMITE_PAGINA_CONTAS) {
    const ordenadas = itens.filter((k) => apos === undefined || k.id < apos).sort((a, b) => b.id - a.id);
    const r = ordenadas.slice(0, limite).map((k) => this.resumo(k));
    return { itens: r, proxima: ordenadas.length > limite ? (r[r.length - 1]?.id ?? null) : null };
  }

  async contas(c: ContextoContas, f: FiltroContasPorta) {
    const busca = f.busca?.trim() ?? '';
    return this.pagina(
      this.estado.contas.filter(
        (k) =>
          k.hospital === c.hospital &&
          (!busca || k.protocolo === busca || k.numeroLote === busca) &&
          (f.prestador === undefined || k.prestador === f.prestador) &&
          (!f.competencia || k.competencia === f.competencia) &&
          (!f.situacao || k.situacao === f.situacao) &&
          (!f.vencidas || this.vencida(k)) &&
          (!f.recursos || this.resumo(k).recursosPendentes > 0),
      ),
      f.apos,
      f.limite,
    );
  }

  async pagamentos(c: ContextoContas, f: FiltroPagamentosPorta) {
    const situacoes: readonly SituacaoContaPorta[] =
      f.estado === 'a-pagar' ? ['analisada'] : f.estado === 'pagas' ? ['paga'] : ['analisada', 'paga'];
    return this.pagina(
      this.estado.contas.filter(
        (k) =>
          k.hospital === c.hospital &&
          situacoes.includes(k.situacao) &&
          (f.prestador === undefined || k.prestador === f.prestador) &&
          (!f.competencia || k.competencia === f.competencia),
      ),
      f.apos,
      f.limite,
    );
  }

  async totais(c: ContextoContas) {
    const ks = this.estado.contas.filter((k) => k.hospital === c.hospital);
    return {
      emAnalise: ks.filter((k) => k.situacao === 'recebida').length,
      aPagar: ks.filter((k) => k.situacao === 'analisada').length,
      vencidas: ks.filter((k) => this.vencida(k)).length,
      recursosPendentes: this.estado.guias.filter(
        (g) => g.hospital === c.hospital && g.recurso?.situacao === 'pendente',
      ).length,
      valorEmAnalise: r2(
        ks.filter((k) => k.situacao === 'recebida').reduce((s, k) => s + c2(k.apresentado), 0),
      ),
      valorAPagar: r2(
        ks
          .filter((k) => k.situacao === 'analisada')
          .reduce((s, k) => s + c2(k.apresentado) - c2(k.glosado) + c2(k.acatado) - c2(k.pago), 0),
      ),
    };
  }

  async conta(c: ContextoContas, id: number): Promise<DadosConta | null> {
    const k = this.estado.contas.find((x) => x.hospital === c.hospital && x.id === id);
    if (!k) return null;
    const o = this.operadorasMem.get(k.operadora);
    const p = this.nomesPrestador.get(k.prestador);
    const arquivo = sem(k.arquivo, 'base64');
    return {
      ...this.resumo(k),
      operadoraNome: o?.nome ?? '',
      registroAns: o?.registroAns ?? '',
      operadoraCnpj: o?.cnpj ?? '',
      prestadorDocumento: p?.documento ?? '',
      prestadorPessoa: p?.pessoa ?? 'J',
      prestadorCnes: p?.cnes ?? null,
      arquivo,
      auditor: k.auditor,
      analisadaEm: k.analisadaEm,
      analisadaPor: k.analisadaPor,
      observacao: k.observacao,
      motivoDevolucao: k.motivoDevolucao,
    };
  }

  async guias(c: ContextoContas, id: number): Promise<DadosGuiaConta[]> {
    return this.estado.guias
      .filter((g) => g.hospital === c.hospital && g.conta === id)
      .sort((a, b) => a.ordem - b.ordem)
      .map((g) => structuredClone(sem(g, 'hospital', 'conta', 'prestador')));
  }

  async itens(c: ContextoContas, id: number): Promise<DadosItemConta[]> {
    return this.estado.itens
      .filter((i) => i.hospital === c.hospital && i.conta === id)
      .sort((a, b) => a.id - b.id)
      .map((i) => sem(i, 'hospital', 'conta'));
  }

  async eventos(c: ContextoContas, id: number): Promise<DadosEventoConta[]> {
    return this.estado.eventos
      .filter((e) => e.hospital === c.hospital && e.conta === id)
      .sort((a, b) => a.id - b.id)
      .map((e) => sem(e, 'hospital', 'conta'));
  }

  async recursosItens(c: ContextoContas, id: number): Promise<DadosRecursoItem[]> {
    return this.estado.recursosItens
      .filter((r) => r.hospital === c.hospital && r.conta === id)
      .sort((a, b) => a.id - b.id)
      .map((r) => structuredClone(sem(r, 'hospital', 'conta')));
  }

  /** Guarda os nomes da operadora e do prestador do lote (a memória não junta tabelas). */
  private async lembrar(c: ContextoContas, operadora: number, prestador: number): Promise<void> {
    const o = (await this.operadora.operadoras(c)).find((x) => x.id === operadora);
    if (o)
      this.operadorasMem.set(operadora, {
        nome: o.nomeFantasia ?? o.razaoSocial,
        registroAns: o.registroAns,
        cnpj: o.cnpj,
      });
    const p = await this.rede.prestador(c, prestador);
    if (p)
      this.nomesPrestador.set(prestador, {
        nome: p.nome,
        documento: p.documento,
        pessoa: p.pessoa,
        cnes: p.cnes,
      });
  }

  async guardarArquivoLote(c: ContextoContas, x: { conteudo: Uint8Array; nome: string }) {
    const id = (this.estado.seq['arquivo'] = (this.estado.seq['arquivo'] ?? 0) + 1);
    this.estado.arquivos.push({ hospital: c.hospital, id, nome: x.nome, bytes: x.conteudo.length });
    return { id, reaproveitado: false };
  }

  async descartarArquivoLote(c: ContextoContas, id: number): Promise<void> {
    this.estado.arquivos = this.estado.arquivos.filter((x) => !(x.hospital === c.hospital && x.id === id));
  }

  async fixarGuardaArquivoLote(): Promise<void> {}

  /** C2-074 (testes): os arquivos enviados pelo portal e os guardados (de um estabelecimento ou de todos). */
  arquivosDoPortal(hospital?: string) {
    const doH = (x: { hospital: string }) => hospital === undefined || x.hospital === hospital;
    return {
      enviados: this.estado.arquivosEnviados.filter(doH),
      guardados: this.estado.arquivos.filter(doH),
    };
  }

  private gravador(c: ContextoContas, depois: (() => Promise<void>)[]): GravadorContas {
    const e = this.estado;
    const h = c.hospital;
    const prox = (s: string) => (e.seq[s] = (e.seq[s] ?? 0) + 1);
    const agora = () => this.agora();
    const evento = (
      conta: number,
      x: Omit<DadosEventoConta, 'id' | 'em' | 'guia' | 'valor' | 'pagoEm' | 'documento'> &
        Partial<Pick<DadosEventoConta, 'guia' | 'valor' | 'pagoEm' | 'documento'>>,
    ) =>
      e.eventos.push({
        hospital: h,
        conta,
        id: prox('evt'),
        em: agora(),
        guia: x.guia ?? null,
        valor: x.valor ?? null,
        pagoEm: x.pagoEm ?? null,
        documento: x.documento ?? null,
        evento: x.evento,
        situacao: x.situacao,
        texto: x.texto,
        por: x.por,
      });
    const mudar = (id: number, versao: number, de: readonly SituacaoContaPorta[]): ContaMem => {
      const k = e.contas.find((x) => x.hospital === h && x.id === id);
      if (!k || k.versao !== versao || !de.includes(k.situacao))
        throw recusa(
          'conta-desatualizada',
          'O lote mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira antes de gravar.',
        );
      k.versao++;
      return k;
    };
    const recontar = (k: ContaMem) => {
      const gs = e.guias.filter((g) => g.conta === k.id);
      for (const g of gs)
        g.glosado = r2(e.itens.filter((i) => i.guia === g.id).reduce((s, i) => s + c2(i.glosado), 0));
      k.glosado = r2(gs.reduce((s, g) => s + c2(g.glosado), 0));
      k.acatado = r2(gs.reduce((s, g) => s + c2(g.acatado), 0));
    };
    const gv: GravadorContas = {
      proximoProtocolo: async () => prox('protocolo'),
      registrarArquivoEnviado: async (a) => {
        if (e.arquivosEnviados.some((x) => x.prestador === a.prestador && x.sha256 === a.sha256))
          throw recusa('lote-ja-recebido', 'Este arquivo do prestador já foi recebido.');
        if (!e.arquivos.some((x) => x.hospital === h && x.id === a.arquivo))
          throw recusa('arquivo-inexistente', 'O arquivo do lote não está guardado.');
        const id = prox('arquivoEnviado');
        e.arquivosEnviados.push({ ...a, hospital: h, id });
        return { id, versao: 1 };
      },
      receber: async (r) => {
        if (
          e.contas.some(
            (k) =>
              k.hospital === h &&
              ((k.prestador === r.prestador && k.numeroLote === r.numeroLote && k.situacao !== 'devolvida') ||
                (k.operadora === r.operadora && k.arquivo.sha256 === r.arquivo.sha256)),
          )
        )
          throw recusa(
            'lote-ja-recebido',
            'Este lote do prestador já foi recebido (o mesmo número ou o mesmo arquivo).',
          );
        if (e.contas.some((k) => k.protocolo === r.protocolo))
          throw recusa('numero-em-uso', 'O número gerado já existe: tente de novo.');
        const id = prox('conta');
        const k: ContaMem = {
          hospital: h,
          id,
          operadora: r.operadora,
          prestador: r.prestador,
          protocolo: r.protocolo,
          numeroLote: r.numeroLote,
          tipoGuia: r.tipoGuia,
          competencia: r.competencia,
          guias: r.guias.length,
          recebidaEm: agora(),
          prazoPagamento: r.prazoPagamento,
          situacao: 'recebida',
          apresentado: r.apresentado,
          glosado: 0,
          acatado: 0,
          pago: 0,
          arquivo: { ...r.arquivo, versaoTiss: '04.03.00' },
          auditor: null,
          analisadaEm: null,
          analisadaPor: null,
          observacao: null,
          motivoDevolucao: null,
          versao: 1,
        };
        e.contas.push(k);
        for (const g of r.guias) {
          const gid = prox('guia');
          e.guias.push({
            hospital: h,
            conta: id,
            prestador: r.prestador,
            id: gid,
            ordem: g.ordem,
            numeroGuiaPrestador: g.numeroGuiaPrestador,
            numeroGuiaOperadora: g.numeroGuiaOperadora,
            senha: g.senha,
            carteirinha: g.carteirinha,
            beneficiario: null,
            autorizacao: null,
            carater: g.carater,
            inicio: g.inicio,
            fim: g.fim,
            criticas: [...g.criticas],
            apresentado: g.apresentado,
            glosado: 0,
            acatado: 0,
            recurso: null,
          });
          const guiaMem = e.guias[e.guias.length - 1]!;
          if (g.beneficiario !== null) {
            const el = await this.operadora.elegibilidade(c, g.carteirinha);
            guiaMem.beneficiario = el ? { id: el.beneficiario.id, nome: el.beneficiario.nome } : null;
          }
          if (g.autorizacao !== null && g.senha) {
            const [a] = await this.autorizacao.autorizacoesPorSenha(c, [g.senha]);
            guiaMem.autorizacao = a ? { id: a.id, protocolo: a.protocolo } : null;
          }
          for (const i of g.itens) {
            const glosa = c2(i.glosado) > 0;
            e.itens.push({
              hospital: h,
              conta: id,
              id: prox('item'),
              guia: gid,
              ordem: i.ordem,
              sequencial: i.sequencial,
              grupo: i.grupo,
              codigoDespesa: i.grupo === 'despesa' ? i.codigoDespesa : null,
              tabela: i.tabela,
              codigo: i.codigo,
              descricao: i.descricao || '-',
              data: i.data,
              quantidade: i.quantidade,
              fator: i.fator,
              valorUnitario: i.valorUnitario,
              apresentado: i.apresentado,
              glosado: glosa ? i.glosado : 0,
              motivo: glosa ? i.motivo : null,
              justificativa: glosa ? i.justificativa : null,
              origem: glosa ? 'automatica' : null,
              critica: glosa ? i.critica : null,
            });
          }
        }
        recontar(k);
        evento(id, {
          evento: 'recebimento',
          situacao: 'recebida',
          valor: r.apresentado,
          texto: r.texto,
          por: r.usuario,
        });
        depois.push(() => this.lembrar(c, r.operadora, r.prestador));
        return { id, versao: 1 };
      },
      glosar: async (x) => {
        const k = mudar(x.id, x.versao, ['recebida']);
        for (const g of x.itens) {
          const i = e.itens.find((y) => y.hospital === h && y.conta === x.id && y.id === g.item);
          if (!i) throw recusa('item-inexistente', 'Há item que não é deste lote.');
          const glosa = c2(g.valorGlosado) > 0;
          i.glosado = glosa ? g.valorGlosado : 0;
          i.motivo = glosa ? g.motivo : null;
          i.justificativa = glosa ? g.justificativa : null;
          i.origem = glosa ? 'auditor' : null;
          i.critica = null;
        }
        recontar(k);
        evento(x.id, {
          evento: x.desfeita ? 'glosa-desfeita' : 'glosa',
          situacao: 'recebida',
          texto: x.texto,
          por: x.usuario,
        });
        return { id: x.id, versao: k.versao };
      },
      concluir: async (x) => {
        const k = mudar(x.id, x.versao, ['recebida']);
        Object.assign(k, {
          situacao: x.situacao,
          auditor: x.auditor,
          analisadaEm: agora(),
          analisadaPor: x.usuario,
          observacao: x.observacao,
        });
        evento(x.id, { evento: 'analise', situacao: x.situacao, texto: x.texto, por: x.usuario });
        return { id: x.id, versao: k.versao };
      },
      devolver: async (x) => {
        const k = mudar(x.id, x.versao, ['recebida']);
        Object.assign(k, { situacao: 'devolvida', motivoDevolucao: x.motivo });
        evento(x.id, { evento: 'devolucao', situacao: 'devolvida', texto: x.motivo, por: x.usuario });
        return { id: x.id, versao: k.versao };
      },
      registrarRecurso: async (x) => {
        const k = mudar(x.id, x.versao, ['analisada', 'paga']);
        const g = e.guias.find((y) => y.hospital === h && y.conta === x.id && y.id === x.guia);
        if (!g || g.recurso)
          throw recusa('recurso-ja-registrado', 'A guia já tem recurso de glosa (um por guia).');
        g.recurso = {
          situacao: 'pendente',
          valor: x.valor,
          justificativa: x.justificativa,
          registradoEm: agora(),
          registradoPor: x.usuario,
          parecer: null,
          decididoEm: null,
          decididoPor: null,
        };
        evento(x.id, {
          evento: 'recurso',
          situacao: x.situacao,
          guia: x.guia,
          valor: x.valor,
          texto: x.justificativa,
          por: x.usuario,
        });
        return { id: x.id, versao: k.versao };
      },
      decidirRecurso: async (x) => {
        const k = mudar(x.id, x.versao, ['analisada', 'paga']);
        const g = e.guias.find((y) => y.hospital === h && y.conta === x.id && y.id === x.guia);
        if (!g?.recurso || g.recurso.situacao !== 'pendente')
          throw recusa('sem-recurso-pendente', 'A guia não tem recurso pendente.');
        if (g.recurso.registradoPor.trim().toUpperCase() === x.usuario.trim().toUpperCase())
          throw recusa(
            'recurso-do-proprio-auditor',
            'Quem registrou o recurso de glosa não o decide: outro auditor designado da operadora decide.',
          );
        if (problemasDoParecerDoRecurso(x.situacaoRecurso, x.parecer).length > 0)
          throw recusa('parecer-obrigatorio', 'Informe o parecer do recurso mantido ou acatado em parte.');
        // As mesmas regras da porta própria (domínio): a decisão pela guia vale para cada linha ainda pendente do
        // recurso por item, repartida pelo peso do recorrido.
        const linhasPendentes = e.recursosItens.filter(
          (r) => r.hospital === h && r.conta === x.id && r.guia === x.guia && !r.decisao,
        );
        const partes = rateioDoAcatado(
          linhasPendentes.map((r) => r.valor),
          x.situacaoRecurso,
          x.valorAcatado,
        );
        linhasPendentes.forEach((r, i) =>
          Object.assign(r, {
            decisao: {
              decisao: x.situacaoRecurso,
              valorAcatado: partes[i] ?? 0,
              parecer: x.parecer,
              em: agora(),
              por: x.usuario,
            },
          }),
        );
        g.recurso = {
          ...g.recurso,
          situacao: x.situacaoRecurso,
          parecer: x.parecer,
          decididoEm: agora(),
          decididoPor: x.usuario,
        };
        g.acatado = x.valorAcatado;
        k.situacao = x.situacao;
        recontar(k);
        evento(x.id, {
          evento: 'recurso-decidido',
          situacao: x.situacao,
          guia: x.guia,
          valor: x.valorAcatado,
          texto: x.parecer,
          por: x.usuario,
        });
        return { id: x.id, versao: k.versao };
      },
      pagar: async (x) => {
        const k = mudar(x.id, x.versao, ['analisada']);
        k.pago = r2(c2(k.pago) + c2(x.valor));
        k.situacao = x.situacao;
        evento(x.id, {
          evento: 'pagamento',
          situacao: x.situacao,
          valor: x.valor,
          pagoEm: x.data,
          documento: x.documento,
          texto: null,
          por: x.usuario,
        });
        return { id: x.id, versao: k.versao };
      },
      // W0-10 (M8): as mesmas conferências da receita (tudo antes de escrever; a guia pela soma).
      registrarRecursoItens: async (x) => {
        if (x.itens.length === 0 || new Set(x.itens.map((i) => i.item)).size !== x.itens.length)
          throw recusa('recurso-item-incoerente', 'Escolha cada item glosado uma vez.');
        const g = e.guias.find((y) => y.hospital === h && y.conta === x.id && y.id === x.guia);
        if (!g) throw recusa('guia-nao-encontrada', 'A guia não é deste lote.');
        if (g.recurso) throw recusa('recurso-ja-registrado', 'A guia já tem recurso de glosa (um por guia).');
        for (const i of x.itens) {
          const it = e.itens.find(
            (y) => y.hospital === h && y.conta === x.id && y.guia === x.guia && y.id === i.item,
          );
          if (!it) throw recusa('item-nao-encontrado', 'O item não é desta guia.');
          if (c2(it.glosado) <= 0 || c2(i.valor) <= 0 || c2(i.valor) > c2(it.glosado))
            throw recusa(
              'recurso-item-incoerente',
              'O valor recorrido do item vai de um centavo até o valor glosado.',
            );
        }
        const soma = r2(x.itens.reduce((t, i) => t + c2(i.valor), 0));
        const r = await gv.registrarRecurso({ ...x, valor: soma });
        const recursos = x.itens.map((i) => {
          const id = prox('recurso-item');
          e.recursosItens.push({
            hospital: h,
            conta: x.id,
            id,
            guia: x.guia,
            item: i.item,
            valor: i.valor,
            justificativa: i.justificativa,
            em: agora(),
            por: x.usuario,
            decisao: null,
          });
          return id;
        });
        return { ...r, recursos };
      },
      decidirRecursoItens: async (x) => {
        const pendentes = e.recursosItens.filter(
          (r) => r.hospital === h && r.conta === x.id && r.guia === x.guia && !r.decisao,
        );
        if (pendentes.length === 0)
          throw recusa(
            'sem-recurso-por-item',
            'O recurso desta guia não foi feito por item: decida pela guia.',
          );
        const porItem = new Map(x.decisoes.map((d) => [d.item, d]));
        if (porItem.size !== x.decisoes.length || porItem.size !== pendentes.length)
          throw recusa('recurso-item-incoerente', 'Decida cada item recorrido, uma vez cada.');
        const linhas = pendentes.map((r) => {
          const d = porItem.get(r.item);
          if (!d || c2(d.valorAcatado) < 0 || c2(d.valorAcatado) > c2(r.valor))
            throw recusa(
              'recurso-item-incoerente',
              'O valor acatado do item vai de zero até o valor recorrido.',
            );
          const decisao = situacaoDoRecurso(r.valor, d.valorAcatado) as 'acatado' | 'parcial' | 'mantido';
          if (problemasDoParecerDoRecurso(decisao, d.parecer).length > 0)
            throw recusa('parecer-obrigatorio', 'Informe o parecer do item mantido ou acatado em parte.');
          return { r, d, decisao };
        });
        const valorAcatado = r2(linhas.reduce((t, l) => t + c2(l.d.valorAcatado), 0));
        const decisao = linhas.every((l) => l.decisao === 'acatado')
          ? 'acatado'
          : linhas.every((l) => l.decisao === 'mantido')
            ? 'mantido'
            : 'parcial';
        const r = await gv.decidirRecurso({
          id: x.id,
          versao: x.versao,
          guia: x.guia,
          valorAcatado,
          situacaoRecurso: decisao,
          parecer: x.parecer,
          situacao: x.situacao,
          usuario: x.usuario,
        });
        for (const l of linhas)
          Object.assign(l.r, {
            decisao: {
              decisao: l.decisao,
              valorAcatado: l.d.valorAcatado,
              parecer: l.d.parecer,
              em: agora(),
              por: x.usuario,
            },
          });
        return { ...r, decisao, valorAcatado };
      },
    };
    return gv;
  }

  async gravar<T>(c: ContextoContas, _trilha: unknown, fn: (g: GravadorContas) => Promise<T>): Promise<T> {
    const antes = structuredClone(this.estado);
    const depois: (() => Promise<void>)[] = [];
    try {
      const r = await fn(this.gravador(c, depois));
      for (const d of depois) await d();
      return r;
    } catch (x) {
      this.estado = antes;
      throw x;
    }
  }
}
