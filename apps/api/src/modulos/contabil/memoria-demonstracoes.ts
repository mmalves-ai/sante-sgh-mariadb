// Demonstrações, apuração e SPED da porta em MEMÓRIA (M54-F3): a sessão sintética de dev/ci (E2E). As somas, o diário
// e os lançamentos do exercício saem dos lançamentos sintéticos da etapa 2 (`LancamentosMemoria`), como as leituras
// SGH_ os somam; o arquivo do SPED tem as mesmas recusas (número seguinte, substituição do gerado, recibo e
// cancelamento só do gerado). A empresa é SINTÉTICA; nada vai à cópia.
import type {
  ArquivoSpedLido,
  DiarioLido,
  EmpresaSpedLida,
  FiltroSomasSgh,
  LancamentoDiarioLido,
  NovoArquivoSpedSgh,
  SituacaoArquivoSpedSgh,
  SomaContaLida,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { LancamentosMemoria } from './memoria-lancamentos.js';

type SemHospital<T> = Omit<T, 'hospital'>;
type ArquivoMem = ArquivoSpedLido & { conteudoCifrado: string };

const recusa = (codigo: string, detalhe: string) =>
  new ErroProblema('recusa-de-negocio', 409, 'Não foi possível gravar', detalhe, { codigo });
const agora = () => new Date().toISOString().slice(0, 19);
const semConteudo = (a: ArquivoMem): ArquivoSpedLido => {
  const r: Partial<ArquivoMem> = { ...a };
  delete r.conteudoCifrado;
  return r as ArquivoSpedLido;
};

/** A empresa sintética da sessão de dev/ci (CNPJ de teste). */
export const EMPRESA_SINTETICA: EmpresaSpedLida = {
  codigo: 1,
  nome: 'Hospital Sintético',
  cnpj: '00000000000191',
  uf: 'SP',
  inscricaoEstadual: null,
  codigoMunicipio: '3550308',
  municipio: 'São Paulo',
  inscricaoMunicipal: null,
  nire: null,
  dataNire: null,
  endereco: 'Rua Sintética',
  numero: '1',
  complemento: null,
  bairro: 'Centro',
  cep: '01000000',
  telefone: null,
  email: null,
  cnae: '8610101',
};

export class DemonstracoesMemoria {
  constructor(
    private readonly f2: () => LancamentosMemoria,
    readonly arquivos: ArquivoMem[] = [],
    private seq = 0,
  ) {}

  clonar(f2: () => LancamentosMemoria): DemonstracoesMemoria {
    return new DemonstracoesMemoria(
      f2,
      this.arquivos.map((a) => ({ ...a })),
      this.seq,
    );
  }

  substituir(o: DemonstracoesMemoria): void {
    this.arquivos.splice(0, this.arquivos.length, ...o.arquivos);
    this.seq = o.seq;
  }

  private tipoDe(id: number | null) {
    return id === null ? null : (this.f2().lancs.find((l) => l.id === id)?.tipo ?? null);
  }

  private encerramento(l: { tipo: string; estornaId: number | null }) {
    return l.tipo === 'apuracao' || (l.tipo === 'estorno' && this.tipoDe(l.estornaId) === 'apuracao');
  }

  somas(f: FiltroSomasSgh, teto: number): { itens: SomaContaLida[]; parcial: boolean } {
    const m = new Map<
      string,
      { conta: string; centroCusto: number | null; debitos: number; creditos: number }
    >();
    for (const l of this.f2().lancs) {
      if (l.empresa !== f.empresa || l.data > f.ate || (f.de !== null && l.data < f.de)) continue;
      if (f.semApuracao && this.encerramento(l)) continue;
      for (const p of l.partidas) {
        if (f.centroCusto !== undefined && f.centroCusto !== null && p.centroCusto !== f.centroCusto)
          continue;
        const centro = f.porCentro ? p.centroCusto : null;
        const k = `${p.conta}|${centro ?? ''}`;
        const x = m.get(k) ?? { conta: p.conta, centroCusto: centro, debitos: 0, creditos: 0 };
        if (p.lado === 'D') x.debitos += p.valorCentavos;
        else x.creditos += p.valorCentavos;
        m.set(k, x);
      }
    }
    const itens = [...m.values()];
    return { itens: itens.slice(0, teto), parcial: itens.length > teto };
  }

  apuracoes(empresa: number, exercicio: number): { ativa: number | null; quantidade: number } {
    const lancs = this.f2().lancs;
    const todas = lancs.filter(
      (l) => l.empresa === empresa && l.tipo === 'apuracao' && l.competencia === `${exercicio}-12`,
    );
    const ativas = todas.filter((l) => !lancs.some((e) => e.estornaId === l.id));
    return {
      ativa: ativas.length > 0 ? Math.max(...ativas.map((l) => l.id)) : null,
      quantidade: todas.length,
    };
  }

  private doIntervalo(empresa: number, de: string, ate: string): LancamentoDiarioLido[] {
    return this.f2()
      .lancs.filter((l) => l.empresa === empresa && l.data >= de && l.data <= ate)
      .sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id)
      .map((l) => ({
        id: l.id,
        data: l.data,
        tipo: l.tipo,
        historico: l.historico,
        debitos: l.debitos,
        creditos: l.creditos,
        estornaId: l.estornaId,
        encerramento: this.encerramento(l),
        partidas: [...l.partidas]
          .sort((a, b) => a.ordem - b.ordem)
          .map((p) => ({
            lancamento: l.id,
            lado: p.lado,
            conta: p.conta,
            valorCentavos: p.valorCentavos,
            centroCusto: p.centroCusto,
            historico: p.historico,
          })),
      }));
  }

  diario(empresa: number, de: string, ate: string, teto: number, pagina: number): DiarioLido {
    const todos = this.doIntervalo(empresa, de, ate);
    const pular = (Math.max(1, pagina) - 1) * teto;
    const porTipo = new Map<
      string,
      { tipo: LancamentoDiarioLido['tipo']; lancamentos: number; debitos: number; creditos: number }
    >();
    for (const l of todos) {
      const x = porTipo.get(l.tipo) ?? { tipo: l.tipo, lancamentos: 0, debitos: 0, creditos: 0 };
      x.lancamentos += 1;
      x.debitos += l.debitos;
      x.creditos += l.creditos;
      porTipo.set(l.tipo, x);
    }
    return {
      lancamentos: todos.slice(pular, pular + teto),
      porTipo: [...porTipo.values()].sort((a, b) => a.tipo.localeCompare(b.tipo)),
      parcial: todos.length > pular + teto,
    };
  }

  lancamentosDoExercicio(empresa: number, exercicio: number, teto: number) {
    const todos = this.doIntervalo(empresa, `${exercicio}-01-01`, `${exercicio}-12-31`);
    const partidas = todos.reduce((s, l) => s + l.partidas.length, 0);
    return { lancamentos: partidas > teto ? [] : todos, parcial: partidas > teto };
  }

  lista(empresa: number, teto: number): ArquivoSpedLido[] {
    return this.arquivos
      .filter((a) => a.empresa === empresa)
      .sort((a, b) => b.exercicio - a.exercicio || a.tipo.localeCompare(b.tipo) || b.numero - a.numero)
      .slice(0, teto)
      .map(semConteudo);
  }

  conteudo(empresa: number, id: number): ArquivoMem | null {
    const a = this.arquivos.find((x) => x.empresa === empresa && x.id === id);
    return a ? { ...a } : null;
  }

  gravar(x: SemHospital<NovoArquivoSpedSgh>): { id: number; numero: number; substituidos: number } {
    if (x.parametros.length > 400)
      throw recusa('parametros-longos', 'Os parâmetros da geração não cabem no registro.');
    const mesmo = this.arquivos.filter(
      (a) => a.empresa === x.empresa && a.tipo === x.tipo && a.exercicio === x.exercicio,
    );
    const numero = mesmo.reduce((m, a) => Math.max(m, a.numero), 0) + 1;
    let substituidos = 0;
    for (const a of mesmo)
      if (a.situacao === 'gerado') {
        Object.assign(a, { situacao: 'substituido' });
        substituidos += 1;
      }
    this.seq += 1;
    this.arquivos.push({
      id: this.seq,
      empresa: x.empresa,
      tipo: x.tipo,
      exercicio: x.exercicio,
      numero,
      situacao: 'gerado',
      leiaute: x.leiaute,
      leiauteConferido: false,
      substituta: x.substituta,
      nomeArquivo: x.nomeArquivo,
      tamanho: x.tamanho,
      linhas: x.linhas,
      hash: x.hash,
      parametros: x.parametros,
      geradoPor: x.usuario,
      geradoEm: agora(),
      recibo: null,
      transmitidoEm: null,
      motivo: null,
      conteudoCifrado: x.conteudoCifrado,
    });
    return { id: this.seq, numero, substituidos };
  }

  situacao(x: SemHospital<SituacaoArquivoSpedSgh>): ArquivoSpedLido {
    const a = this.arquivos.find((y) => y.empresa === x.empresa && y.id === x.id);
    if (!a) throw recusa('sped-inexistente', 'O arquivo não existe nesta empresa.');
    if (a.situacao !== 'gerado')
      throw recusa(
        'sped-situacao',
        a.situacao === 'transmitido'
          ? 'O arquivo já foi transmitido: a correção é uma escrituração substituta.'
          : 'Só o arquivo gerado recebe o recibo ou é cancelado.',
      );
    if (x.acao === 'recibo')
      Object.assign(a, { situacao: 'transmitido', recibo: x.recibo, transmitidoEm: x.transmitidoEm });
    else Object.assign(a, { situacao: 'cancelado', motivo: x.motivo });
    return semConteudo(a);
  }
}
