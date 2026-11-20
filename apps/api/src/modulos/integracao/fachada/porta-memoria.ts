// M58-F4: a porta da fachada em memória (testes de unidade e ambiente sintético): convênios sintéticos, a situação
// gravada no próprio objeto (com a mesma prova: relida depois de gravar) e o estado das operações por mapa.
import type {
  DiariaAcompanhante,
  ImpactoConvenio,
  LinhaConvenioFachada,
  RetratoConvenio,
} from '@sgh/dominio-integracao';
import type { ContextoFachada, GravacaoSituacaoFachada, PortaFachada, SaudeBancoFachada } from './porta.js';

interface ConvenioMemoria extends LinhaConvenioFachada {
  situacao: string | null;
  diaria?: DiariaAcompanhante;
}

export class PortaFachadaMemoria implements PortaFachada {
  readonly destino = 'memoria' as const;
  readonly gravacoes: GravacaoSituacaoFachada[] = [];
  /** Falha a injetar na próxima gravação (teste do contrato de erro). */
  falhaNaGravacao: Error | null = null;
  private readonly convs: ConvenioMemoria[];

  constructor(
    convenios: readonly LinhaConvenioFachada[] = [
      { cod: 10, nome: 'PARTICULAR', situacao: 'A', permiteAtend: 1 },
      { cod: 20, nome: 'CONVENIO SINTETICO UM', situacao: 'A', permiteAtend: 1 },
      { cod: 30, nome: 'CONVENIO SINTETICO DOIS', situacao: 'I', permiteAtend: 0 },
    ],
    private readonly estados: Readonly<Record<string, string>> = { 'convenio.alterarSituacao': 'verde' },
    private readonly saude: SaudeBancoFachada = { banco: 'NONE', colunaObs: 'NONE', efetivo: 'CP1252' },
  ) {
    this.convs = convenios.map((c) => ({ ...c }));
  }

  estado(operacao: string): string | null {
    return this.estados[operacao] ?? null;
  }

  async convenios(): Promise<LinhaConvenioFachada[]> {
    return [...this.convs].sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '')).map((c) => ({ ...c }));
  }

  async convenio(_c: ContextoFachada, cod: number): Promise<LinhaConvenioFachada | null> {
    const c = this.convs.find((x) => x.cod === cod);
    return c ? { cod: c.cod, nome: c.nome, situacao: c.situacao, permiteAtend: c.permiteAtend } : null;
  }

  async saudeBanco(): Promise<SaudeBancoFachada> {
    return this.saude;
  }

  async retratoConvenio(_c: ContextoFachada, cod: number): Promise<RetratoConvenio> {
    const c = this.convs.find((x) => x.cod === cod);
    if (!c) return { existe: false, cod };
    return {
      existe: true,
      cod,
      situacao: c.situacao,
      nome: c.nome,
      permiteAtend: typeof c.permiteAtend === 'number' ? c.permiteAtend : null,
      classifC: 1,
      thm: 1,
      thmE: 1,
      idDth: null,
      agendasConsulta: 2,
      agendasExame: 1,
    };
  }

  async diariaConvenio(_c: ContextoFachada, cod: number): Promise<DiariaAcompanhante> {
    return this.convs.find((x) => x.cod === cod)?.diaria ?? null;
  }

  async impactoConvenio(): Promise<ImpactoConvenio> {
    return { consulta: 1, exame: 0, contasAbertas: 0, carteira: 3, profissionais: 2 };
  }

  /** Muda a situação por fora (teste da proposta desatualizada). */
  mudarPorFora(cod: number, situacao: string) {
    const c = this.convs.find((x) => x.cod === cod);
    if (c) c.situacao = situacao;
  }

  async gravarSituacaoConvenio(_c: ContextoFachada, g: GravacaoSituacaoFachada): Promise<string | null> {
    if (this.falhaNaGravacao) {
      const e = this.falhaNaGravacao;
      this.falhaNaGravacao = null;
      throw e;
    }
    const c = this.convs.find((x) => x.cod === g.cod);
    if (!c) return null;
    c.situacao = g.operacao === 'suspender' ? 'I' : 'A';
    this.gravacoes.push(g);
    return c.situacao;
  }
}
