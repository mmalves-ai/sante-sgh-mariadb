// Porta da interface com a folha externa em memória (M53.1): a sessão sintética de dev/ci e o E2E. Os registros vivem
// por estabelecimento, numa cópia por transação (o erro no meio desfaz tudo). Nada vai ao banco. Os vínculos e
// o conselho vêm da gestão de pessoas em memória; os domínios são sintéticos (rótulos de produto). As regras de banco que
// importam ao teste também valem aqui: a situação esperada na troca, a versão na alteração do afastamento, o resumo uma
// vez por colaborador e rubrica.
import { EVENTOS_FOLHA, type TipoEncargoFolha } from '@sgh/contratos';
import { ErroOperacao, type LinhaTrilha } from '@sgh/nucleo';
import {
  type AfastamentoFolha,
  type ConselhoDoProfissional,
  type FiltroAfastamentosFolha,
  type ItemDominioFolha,
  type LoteDaFolha,
  type LoteFolhaCompleto,
  type ResumoDaFolha,
  type RetornoParaTitulos,
  TIPOS_VINCULO_DA_FOLHA,
  type VinculoDaFolha,
} from './tipos-folha.js';
import type { GravacaoFeita } from '../../exames/public-api.js';
import type { PortaPessoas } from '../porta.js';
import type { ContextoFolha, GravadorFolha, PortaFolha } from './porta-folha.js';

const recusa = (codigo: string, mensagem: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', mensagem);
const desatualizado = () =>
  recusa(
    'desatualizado',
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );

/** Empresa e motivos de afastamento sintéticos (o domínio real é lido do banco). */
export const EMPRESA_SINTETICA_FOLHA: ItemDominioFolha = { codigo: 1, rotulo: 'EMPRESA SINTETICA DA FOLHA' };
export const MOTIVOS_AFASTAMENTO_SINTETICOS: readonly ItemDominioFolha[] = [
  { codigo: 1, rotulo: 'Doença (até 15 dias)' },
  { codigo: 3, rotulo: 'Acidente de trabalho' },
  { codigo: 6, rotulo: 'Licença-maternidade' },
];

interface Estado {
  seq: number;
  lotes: LoteFolhaCompleto[];
  resumo: (ResumoDaFolha & { interface: number; vencimento: string | null })[];
  afastamentos: AfastamentoFolha[];
}
const novo = (): Estado => ({ seq: 5300, lotes: [], resumo: [], afastamentos: [] });
const copiar = (s: Estado): Estado => ({
  seq: s.seq,
  lotes: s.lotes.map((x) => ({ ...x })),
  resumo: s.resumo.map((x) => ({ ...x })),
  afastamentos: s.afastamentos.map((x) => ({ ...x })),
});

const p2 = (x: number) => String(x).padStart(2, '0');
const local = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
const semVinculos = (l: LoteFolhaCompleto): LoteDaFolha => ({
  id: l.id,
  empresa: l.empresa,
  competencia: l.competencia,
  sentido: l.sentido,
  loteExportado: l.loteExportado,
  leiaute: l.leiaute,
  situacao: l.situacao,
  colaboradores: l.colaboradores,
  soma: l.soma,
  totais: l.totais,
  divergencias: l.divergencias,
  resumo: l.resumo,
  geradoEm: l.geradoEm,
  geradoPor: l.geradoPor,
  versao: l.versao,
});
const toca = (a: AfastamentoFolha, f: FiltroAfastamentosFolha) =>
  (f.vinculo === undefined || a.vinculo === f.vinculo) &&
  (f.ate === undefined || a.inicio <= f.ate) &&
  (f.de === undefined || a.fim === null || a.fim >= f.de);

export class PortaFolhaMemoria implements PortaFolha {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();
  /** Testes: o relógio sintético (AAAA-MM-DDTHH:MM:SS). */
  agoraFixo: string | null = null;

  constructor(private readonly pessoas: PortaPessoas | null = null) {}

  private e(c: ContextoFolha): Estado {
    let s = this.estados.get(String(c.estabelecimento));
    if (!s) this.estados.set(String(c.estabelecimento), (s = novo()));
    return s;
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }
  async executar(): Promise<GravacaoFeita> {
    throw new ErroOperacao(
      409,
      'operacao-desconhecida',
      'Operação recusada',
      'A interface com a folha não usa o executor.',
    );
  }

  async gravarSgh<T>(
    c: ContextoFolha,
    _trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorFolha) => Promise<T>,
  ): Promise<T> {
    const s = copiar(this.e(c));
    const { agora } = await this.relogio();
    const g: GravadorFolha = {
      proximoIdLote: async () => ++s.seq,
      lote: async (id) => s.lotes.find((x) => x.id === id) ?? null,
      lotesDaCompetencia: async (empresa, competencia) =>
        s.lotes
          .filter((x) => x.empresa === empresa && x.competencia === competencia)
          .sort((a, b) => b.id - a.id)
          .map(semVinculos),
      competenciaLancada: async (empresa, competencia) =>
        s.lotes.some(
          (x) => x.empresa === empresa && x.competencia === competencia && x.situacao === 'lancado',
        ),
      incluirLote: async (x) => {
        s.lotes.push({
          id: x.id,
          empresa: x.empresa,
          competencia: x.competencia,
          sentido: x.sentido,
          loteExportado: x.loteExportado,
          leiaute: x.leiaute,
          situacao: x.situacao,
          colaboradores: x.colaboradores,
          soma: x.soma,
          totais: x.totais,
          divergencias: x.divergencias,
          resumo: x.resumo,
          geradoEm: x.geradoEm.slice(0, 19),
          geradoPor: x.por,
          versao: 0,
          vinculos: x.vinculos,
        });
        return x.id;
      },
      situacaoLote: async (x) => {
        const l = s.lotes.find((y) => y.id === x.id);
        if (!l || !x.de.includes(l.situacao)) throw desatualizado();
        Object.assign(l, { situacao: x.para, versao: l.versao + 1 });
      },
      incluirResumo: async (x) => {
        for (const r of x.linhas) {
          if (
            r.vinculo !== null &&
            s.resumo.some(
              (y) => y.interface === x.interface && y.vinculo === r.vinculo && y.rubrica === r.rubrica,
            )
          )
            throw recusa('resumo-repetido', 'O resumo deste colaborador já foi gravado neste retorno.');
          s.resumo.push({
            interface: x.interface,
            vinculo: r.vinculo,
            centroCusto: r.centroCusto,
            rubrica: r.rubrica,
            valor: r.valor,
            vencimento: r.vencimento ?? null,
          });
        }
        return x.linhas.length;
      },
      resumo: async (id) =>
        s.resumo
          .filter((r) => r.interface === id)
          .map((r) => ({
            vinculo: r.vinculo,
            centroCusto: r.centroCusto,
            rubrica: r.rubrica,
            valor: r.valor,
          })),
      afastamento: async (id) => s.afastamentos.find((a) => a.id === id) ?? null,
      afastamentos: async (f) => s.afastamentos.filter((a) => toca(a, f)),
      incluirAfastamento: async (x) => {
        const id = ++s.seq;
        s.afastamentos.push({
          id,
          vinculo: x.vinculo,
          motivo: x.motivo,
          inicio: x.inicio,
          fim: x.fim,
          observacao: x.observacao,
          situacao: 'ativo',
          motivoCancelamento: null,
          versao: 0,
        });
        return id;
      },
      encerrarAfastamento: async (x) => {
        const a = s.afastamentos.find((y) => y.id === x.id);
        if (!a || a.versao !== x.versao || a.situacao !== 'ativo' || a.fim !== null) throw desatualizado();
        Object.assign(a, { fim: x.fim, versao: a.versao + 1 });
      },
      cancelarAfastamento: async (x) => {
        const a = s.afastamentos.find((y) => y.id === x.id);
        if (!a || a.versao !== x.versao || a.situacao !== 'ativo') throw desatualizado();
        Object.assign(a, { situacao: 'cancelado', motivoCancelamento: x.motivo, versao: a.versao + 1 });
      },
    };
    void agora;
    const r = await fn(g);
    this.estados.set(String(c.estabelecimento), s);
    return r;
  }

  async relogio(): Promise<{ hoje: string; agora: string }> {
    const agora = this.agoraFixo ?? local(new Date());
    return { hoje: agora.slice(0, 10), agora };
  }
  async empresas() {
    return [EMPRESA_SINTETICA_FOLHA];
  }
  async eventosPonto() {
    return Object.entries(EVENTOS_FOLHA).map(([codigo, rotulo]) => ({ codigo: Number(codigo), rotulo }));
  }
  async motivosAfastamento() {
    return [...MOTIVOS_AFASTAMENTO_SINTETICOS];
  }
  async tiposFolha() {
    return [];
  }
  async remessas() {
    return [];
  }
  async lotes(c: ContextoFolha, f: { empresa?: number; competencia?: string }) {
    return this.e(c)
      .lotes.filter(
        (x) =>
          (f.empresa === undefined || x.empresa === f.empresa) &&
          (f.competencia === undefined || x.competencia === f.competencia),
      )
      .sort((a, b) => b.id - a.id)
      .map(semVinculos);
  }
  /**
   * M53.9 (memória): o retorno recebido como a integração da folha o lê (o resumo somado por rubrica, centro e
   * vencimento), como a porta do banco faz; e a marca de lançado que o `incluir-folha` grava.
   */
  retornoParaTitulos(estabelecimento: number | string, id: number): RetornoParaTitulos | null {
    const s = this.e({ estabelecimento: Number(estabelecimento) } as ContextoFolha);
    const l = s.lotes.find((x) => x.id === id);
    if (!l) return null;
    const acc = new Map<
      string,
      { rubrica: string; centro: number | null; venc: string | null; valor: number }
    >();
    for (const r of s.resumo.filter((x) => x.interface === id)) {
      const k = `${r.rubrica}|${r.centroCusto ?? ''}|${r.vencimento ?? ''}`;
      const a = acc.get(k) ?? { rubrica: r.rubrica, centro: r.centroCusto, venc: r.vencimento, valor: 0 };
      a.valor += r.valor;
      acc.set(k, a);
    }
    let liquido = 0;
    let vencimentoLiquido: string | null = null;
    const encargos: { tipo: TipoEncargoFolha; valor: number; vencimento: string | null }[] = [];
    const proventos: { centroCusto: number | null; proventos: number }[] = [];
    for (const a of acc.values()) {
      if (a.rubrica === 'liquido') {
        liquido += a.valor;
        if (a.venc && (!vencimentoLiquido || a.venc < vencimentoLiquido)) vencimentoLiquido = a.venc;
      } else if (a.rubrica === 'proventos') proventos.push({ centroCusto: a.centro, proventos: a.valor });
      else if (a.rubrica !== 'descontos')
        encargos.push({ tipo: a.rubrica as TipoEncargoFolha, valor: a.valor, vencimento: a.venc });
    }
    return {
      id: l.id,
      empresa: l.empresa,
      competencia: l.competencia,
      sentido: l.sentido,
      situacao: l.situacao,
      liquido,
      vencimentoLiquido,
      encargos,
      proventos,
    };
  }
  marcarLancado(estabelecimento: number | string, id: number): void {
    const l = this.e({ estabelecimento: Number(estabelecimento) } as ContextoFolha).lotes.find(
      (x) => x.id === id,
    );
    if (l) Object.assign(l, { situacao: 'lancado', versao: l.versao + 1 });
  }

  async lote(c: ContextoFolha, id: number) {
    return this.e(c).lotes.find((x) => x.id === id) ?? null;
  }
  async competenciaLancada(c: ContextoFolha, empresa: number, competencia: string) {
    return this.e(c).lotes.some(
      (x) => x.empresa === empresa && x.competencia === competencia && x.situacao === 'lancado',
    );
  }
  async vinculosDaFolha(c: ContextoFolha, inicio: string, fim: string): Promise<VinculoDaFolha[]> {
    if (!this.pessoas) return [];
    const r: VinculoDaFolha[] = [];
    let depois: number | undefined;
    for (;;) {
      const p = await this.pessoas.listarVinculos(c, {
        estado: 'todos',
        limite: 200,
        ...(depois !== undefined ? { depois } : {}),
      });
      for (const v of p.itens)
        if (
          (TIPOS_VINCULO_DA_FOLHA as readonly string[]).includes(v.tipo) &&
          v.admissao <= fim &&
          (v.desligamento === null || v.desligamento >= inicio)
        )
          r.push({
            id: v.id,
            cpfCifrado: v.cpfCifrado,
            matricula: v.matricula,
            tipo: v.tipo,
            admissao: v.admissao,
            desligamento: v.desligamento,
            centroCusto: v.centroCusto,
            unidade: v.unidade,
            profissional: v.profissional,
          });
      if (p.depois === null) break;
      depois = p.depois;
    }
    return r.sort((a, b) => a.id - b.id);
  }
  async conselhos(c: ContextoFolha, profissionais: readonly number[]) {
    const out = new Map<number, ConselhoDoProfissional>();
    if (!this.pessoas || profissionais.length === 0) return out;
    for (const p of await this.pessoas.profissionais(c, [...new Set(profissionais)])) {
      const reg = p.registros.find((x) => x.ativo) ?? p.registros[0];
      if (!reg) continue;
      out.set(p.id, {
        profissional: p.id,
        sigla: reg.sigla ?? reg.conselho ?? null,
        numero: reg.numero ?? null,
        uf: reg.uf ?? null,
        validade: null,
        cbo: reg.cbo ?? null,
      });
    }
    return out;
  }
  async afastamentos(c: ContextoFolha, f: FiltroAfastamentosFolha) {
    return this.e(c)
      .afastamentos.filter((a) => toca(a, f))
      .sort((a, b) => a.vinculo - b.vinculo || a.inicio.localeCompare(b.inicio) || a.id - b.id);
  }
  async afastamento(c: ContextoFolha, id: number) {
    return this.e(c).afastamentos.find((a) => a.id === id) ?? null;
  }
}
