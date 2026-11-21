// A porta do M59-F5 em memória: unitários e a fonte sintética do dev/ci (nada no banco). Repete as condições das
// gravações da porta própria (situação anterior, um ciclo aberto por tipo, verificação por outra pessoa).
import type { ItemCicloSbis, Restauracao } from '@sgh/contratos';
import type {
  CicloCertificacao,
  ConcessaoRegistrada,
  ConfigSeguranca,
  IdentificacaoEstabelecimento,
  PortaSbis,
  RecursoSbis,
  VerificacaoDiaTrilha,
} from './porta.js';

export class PortaSbisMemoria implements PortaSbis {
  readonly destino = 'memoria' as const;
  readonly concessoesPorHospital = new Map<string, ConcessaoRegistrada[]>();
  readonly ciclosLidos: (CicloCertificacao & { hospital: string })[] = [];
  readonly itensPorCiclo = new Map<string, ItemCicloSbis[]>();
  readonly restauracoesLidas: (Restauracao & { hospital: string })[] = [];
  readonly trilhas: string[] = [];
  identificacaoFixa: IdentificacaoEstabelecimento = {
    nome: 'Hospital de teste',
    cnes: '0000000',
    cnpj: '00000000000000',
  };
  config: ConfigSeguranca = { limiteTentativas: 5, inatividadeSegundos: 900 };
  dias = new Map<string, VerificacaoDiaTrilha>();
  /** Tabelas que faltam, por recurso (testes da recusa "recurso ainda não instalado"). */
  falta: Partial<Record<RecursoSbis, string[]>> = {};
  private seq = 0;
  private agora = () => new Date().toISOString();

  async faltando(_h: string, recurso: RecursoSbis) {
    return [...(this.falta[recurso] ?? [])];
  }

  async concessoes(h: string) {
    return [...(this.concessoesPorHospital.get(h) ?? [])];
  }

  private concessao(h: string, codigo: ConcessaoRegistrada['codigo']): ConcessaoRegistrada {
    const lista = this.concessoesPorHospital.get(h) ?? [];
    this.concessoesPorHospital.set(h, lista);
    let c = lista.find((x) => x.codigo === codigo);
    if (!c) {
      c = {
        codigo,
        situacao: 'vigente',
        fimPrevisto: null,
        evidencia: null,
        encerradaPor: null,
        encerradaEm: null,
        reabertaPor: null,
        reabertaEm: null,
        motivoReabertura: null,
      };
      lista.push(c);
    }
    return c;
  }

  private trocar(h: string, novo: ConcessaoRegistrada) {
    const lista = this.concessoesPorHospital.get(h) ?? [];
    this.concessoesPorHospital.set(
      h,
      lista.map((x) => (x.codigo === novo.codigo ? novo : x)),
    );
  }

  async encerrar(h: string, c: { codigo: ConcessaoRegistrada['codigo']; evidencia: string; por: string }) {
    const atual = this.concessao(h, c.codigo);
    if (atual.situacao !== 'vigente') return false;
    this.trocar(h, {
      ...atual,
      situacao: 'encerrada',
      evidencia: c.evidencia,
      encerradaPor: c.por,
      encerradaEm: this.agora(),
    });
    this.trilhas.push(`concessao:${c.codigo}:encerrada`);
    return true;
  }

  async reabrir(h: string, c: { codigo: ConcessaoRegistrada['codigo']; motivo: string; por: string }) {
    const atual = this.concessao(h, c.codigo);
    if (atual.situacao !== 'encerrada') return false;
    this.trocar(h, {
      ...atual,
      situacao: 'vigente',
      reabertaPor: c.por,
      reabertaEm: this.agora(),
      motivoReabertura: c.motivo,
    });
    this.trilhas.push(`concessao:${c.codigo}:reaberta`);
    return true;
  }

  async prever(h: string, c: { codigo: ConcessaoRegistrada['codigo']; fimPrevisto: string | null }) {
    this.trocar(h, { ...this.concessao(h, c.codigo), fimPrevisto: c.fimPrevisto });
    this.trilhas.push(`concessao:${c.codigo}:fim-previsto`);
    return true;
  }

  async ciclos(h: string) {
    return this.ciclosLidos.filter((c) => c.hospital === h).sort((a, b) => Number(b.id) - Number(a.id));
  }

  async ciclo(h: string, id: string) {
    return this.ciclosLidos.find((c) => c.hospital === h && c.id === id) ?? null;
  }

  async itens(_h: string, id: string) {
    return [...(this.itensPorCiclo.get(id) ?? [])];
  }

  async abrir(h: string, n: Parameters<PortaSbis['abrir']>[1]) {
    if (this.ciclosLidos.some((c) => c.hospital === h && c.tipo === n.tipo && c.situacao === 'aberto'))
      return null;
    const id = String(++this.seq);
    this.ciclosLidos.push({
      hospital: h,
      id,
      tipo: n.tipo as CicloCertificacao['tipo'],
      competencia: n.competencia,
      versao: n.versao,
      referencia: n.referencia,
      avaliador: n.avaliador,
      situacao: 'aberto',
      parecer: null,
      parecerTexto: null,
      certificado: null,
      abertoPor: n.por,
      abertoEm: this.agora(),
      concluidoPor: null,
      concluidoEm: null,
    });
    this.itensPorCiclo.set(
      id,
      n.requisitos.map((requisito) => ({
        requisito,
        nivel: 'NGS1',
        titulo: requisito,
        resultado: 'pendente',
        severidade: null,
        origem: null,
        evidencia: null,
        observacao: null,
        avaliadoPor: null,
        avaliadoEm: null,
        correcao: null,
        correcaoDescricao: null,
        corrigidoPor: null,
        corrigidoEm: null,
        verificadoPor: null,
        verificadoEm: null,
      })),
    );
    this.trilhas.push(`ciclo:${id}:aberto`);
    return { id };
  }

  private aberto(h: string, id: string) {
    return this.ciclosLidos.some((c) => c.hospital === h && c.id === id && c.situacao === 'aberto');
  }

  private mudarItem(id: string, requisito: string, f: (i: ItemCicloSbis) => ItemCicloSbis | null): boolean {
    const lista = this.itensPorCiclo.get(id) ?? [];
    const i = lista.findIndex((x) => x.requisito === requisito);
    const atual = lista[i];
    if (!atual) return false;
    const novo = f(atual);
    if (!novo) return false;
    lista[i] = novo;
    return true;
  }

  async avaliar(h: string, a: Parameters<PortaSbis['avaliar']>[1]) {
    if (!this.aberto(h, a.idCiclo)) return false;
    const p = a.pedido;
    const nc = p.resultado === 'nao-conforme';
    // A condição do UPDATE: a NC sem correção verificada não se reavalia.
    const ok = this.mudarItem(a.idCiclo, a.requisito, (i) =>
      i.resultado === 'nao-conforme' && i.correcao !== 'verificada'
        ? null
        : {
            ...i,
            resultado: p.resultado,
            severidade: nc ? (p.severidade ?? null) : null,
            origem: nc ? (p.origem ?? null) : p.resultado === 'concessao' ? 'concessao' : null,
            evidencia: p.evidencia?.trim() || null,
            observacao: p.observacao?.trim() || null,
            avaliadoPor: a.por,
            avaliadoEm: this.agora(),
            correcao: nc ? 'aberta' : null,
            correcaoDescricao: null,
            corrigidoPor: null,
            corrigidoEm: null,
            verificadoPor: null,
            verificadoEm: null,
          },
    );
    if (ok) this.trilhas.push(`item:${a.requisito}:${p.resultado}`);
    return ok;
  }

  async corrigir(h: string, a: Parameters<PortaSbis['corrigir']>[1]) {
    if (!this.aberto(h, a.idCiclo)) return false;
    return this.mudarItem(a.idCiclo, a.requisito, (i) =>
      i.resultado === 'nao-conforme' && i.correcao === 'aberta'
        ? {
            ...i,
            correcao: 'corrigida',
            correcaoDescricao: a.descricao,
            corrigidoPor: a.por,
            corrigidoEm: this.agora(),
          }
        : null,
    );
  }

  async verificar(h: string, a: Parameters<PortaSbis['verificar']>[1]) {
    if (!this.aberto(h, a.idCiclo)) return false;
    return this.mudarItem(a.idCiclo, a.requisito, (i) =>
      i.correcao === 'corrigida' && i.corrigidoPor !== a.por
        ? { ...i, correcao: 'verificada', verificadoPor: a.por, verificadoEm: this.agora() }
        : null,
    );
  }

  async concluir(h: string, c: Parameters<PortaSbis['concluir']>[1]) {
    const i = this.ciclosLidos.findIndex((x) => x.hospital === h && x.id === c.id && x.situacao === 'aberto');
    const atual = this.ciclosLidos[i];
    const itens = this.itensPorCiclo.get(c.id) ?? [];
    if (!atual || itens.some((x) => x.resultado === 'pendente')) return false;
    // A condição do UPDATE no parecer apto: nenhuma bloqueante sem correção verificada (gravada agora por outro).
    if (
      c.parecer === 'apto' &&
      itens.some(
        (x) => x.resultado === 'nao-conforme' && x.severidade === 'bloqueante' && x.correcao !== 'verificada',
      )
    )
      return false;
    this.ciclosLidos[i] = {
      ...atual,
      situacao: 'concluido',
      parecer: c.parecer,
      parecerTexto: c.parecerTexto,
      certificado: c.certificado,
      concluidoPor: c.por,
      concluidoEm: this.agora(),
    };
    this.trilhas.push(`ciclo:${c.id}:concluido`);
    return true;
  }

  async cancelar(h: string, c: Parameters<PortaSbis['cancelar']>[1]) {
    const i = this.ciclosLidos.findIndex((x) => x.hospital === h && x.id === c.id && x.situacao === 'aberto');
    const atual = this.ciclosLidos[i];
    if (!atual) return false;
    this.ciclosLidos[i] = { ...atual, situacao: 'cancelado', concluidoPor: c.por, concluidoEm: this.agora() };
    return true;
  }

  async restauracoes(h: string) {
    return this.restauracoesLidas
      .filter((r) => r.hospital === h)
      .sort((a, b) => b.fim.localeCompare(a.fim))
      .map((r) => {
        const { hospital, ...resto } = r;
        void hospital;
        return resto;
      });
  }

  async registrarRestauracao(h: string, r: Parameters<PortaSbis['registrarRestauracao']>[1]) {
    const id = String(++this.seq);
    const p = r.pedido;
    const inicio = new Date(p.inicio).toISOString();
    const fim = new Date(p.fim).toISOString();
    this.restauracoesLidas.push({
      hospital: h,
      id,
      tipo: p.tipo,
      inicio,
      fim,
      duracaoMinutos: Math.round((Date.parse(fim) - Date.parse(inicio)) / 60_000),
      resultado: p.resultado,
      integridade: p.integridade,
      tamanhoMb: p.tamanhoMb ?? null,
      ambiente: p.ambiente,
      observacao: p.observacao?.trim() || null,
      registradoPor: r.por,
      registradoEm: this.agora(),
    });
    this.trilhas.push(`restauracao:${id}`);
    return { id };
  }

  async identificacao() {
    return this.identificacaoFixa;
  }

  async configSeguranca() {
    return this.config;
  }

  async verificarDias(_h: string, dias: readonly string[]) {
    return dias.map((dia) => this.dias.get(dia) ?? { dia, linhas: 0, ok: true, quebraEm: null });
  }
}
