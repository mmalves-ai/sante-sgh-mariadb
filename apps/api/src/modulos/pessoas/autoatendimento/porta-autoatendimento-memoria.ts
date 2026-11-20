// Porta das solicitações do autoatendimento em memória (W0-06, parte 6b-2): a sessão sintética de dev/ci (E2E) e os
// testes. A gravação abre, aninhadas, as transações em memória do ponto, das férias e do colaborador, e só confirma
// tudo se a função terminar: o erro no meio desfaz a decisão e o efeito juntos, como a transação SGH_ do legado. O
// banco confere a decisão por outra pessoa e a desistência só pelo solicitante (CHECK `SGH_CK_PES_SOLIC_QUEM`): aqui,
// as mesmas recusas. Nada vai à cópia do banco.
import type {
  AcessoAtestadoLido,
  AjusteDaSolicitacaoLido,
  AtestadoPesLido,
  DadosAtestadoSgh,
  SolicitacaoPesLida,
} from '@sgh/legado';
import { ErroOperacao, type LinhaTrilha } from '@sgh/legado';
import type { GravacaoFeita } from '../../exames/public-api.js';
import type { PortaCalculoFolhaMemoria } from '../folha/porta-calculo-memoria.js';
import type { PortaPessoasMemoria } from '../porta-memoria.js';
import type { PortaPontoMemoria } from '../ponto/porta-ponto-memoria.js';
import type {
  ContextoAutoatendimento,
  FiltroSolicitacoesPorta,
  GravadorAutoatendimento,
  PortaAutoatendimento,
} from './porta-autoatendimento.js';

const recusa = (codigo: string, detalhe: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detalhe);
const desatualizado = () =>
  recusa(
    'desatualizado',
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );
const mesmo = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

interface AtestadoMem extends DadosAtestadoSgh {
  readonly id: number;
  readonly solicitacao: number;
  readonly criadoPor: string;
  readonly criadoEm: string;
}
interface AcessoMem extends AcessoAtestadoLido {
  readonly atestado: number;
}
type Mut<T> = { -readonly [K in keyof T]: T[K] };
interface Estado {
  seq: number;
  solicitacoes: Mut<SolicitacaoPesLida>[];
  /** ID_SOLICITACAO de SGH_PES_PONTO_AJUSTE (o ajuste mora na porta do ponto). */
  ajustes: { ajuste: number; solicitacao: number }[];
  atestados: AtestadoMem[];
  acessos: AcessoMem[];
}
const novo = (): Estado => ({ seq: 0, solicitacoes: [], ajustes: [], atestados: [], acessos: [] });
const copiar = (s: Estado): Estado => ({
  seq: s.seq,
  solicitacoes: s.solicitacoes.map((x) => ({ ...x })),
  ajustes: [...s.ajustes],
  atestados: [...s.atestados],
  acessos: [...s.acessos],
});

export class PortaAutoatendimentoMemoria implements PortaAutoatendimento {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  constructor(
    private readonly ponto: PortaPontoMemoria,
    private readonly folha: PortaCalculoFolhaMemoria,
    private readonly pessoas: PortaPessoasMemoria,
  ) {}

  private e(c: { hospital: string }): Estado {
    let s = this.estados.get(c.hospital);
    if (!s) this.estados.set(c.hospital, (s = novo()));
    return s;
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }
  async executar(): Promise<GravacaoFeita> {
    throw recusa('operacao-desconhecida', 'O autoatendimento não usa o executor.');
  }

  async hoje(): Promise<string> {
    return (await this.ponto.relogio()).hoje;
  }

  async solicitacoes(c: ContextoAutoatendimento, f: FiltroSolicitacoesPorta): Promise<SolicitacaoPesLida[]> {
    const vs = f.vinculos ?? null;
    return this.e(c)
      .solicitacoes.filter(
        (x) => (vs === null || vs.includes(x.vinculo)) && (!f.situacao || x.situacao === f.situacao),
      )
      .sort((a, b) => b.pedidoEm.localeCompare(a.pedidoEm) || b.id - a.id)
      .map((x) => ({ ...x }));
  }

  async solicitacao(c: ContextoAutoatendimento, id: number): Promise<SolicitacaoPesLida | null> {
    const x = this.e(c).solicitacoes.find((y) => y.id === id);
    return x ? { ...x } : null;
  }

  private async ajustesDe(
    s: Estado,
    solicitacao: number,
    ler: (id: number) => Promise<{ id: number; dia: string; situacao: string; versao: number } | null>,
  ): Promise<AjusteDaSolicitacaoLido[]> {
    const ids = s.ajustes.filter((l) => l.solicitacao === solicitacao).map((l) => l.ajuste);
    const as = await Promise.all(ids.map(ler));
    return as
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .map((a) => ({ id: a.id, dia: a.dia, situacao: a.situacao, versao: a.versao }))
      .sort((a, b) => a.dia.localeCompare(b.dia) || a.id - b.id);
  }

  async ajustesDaSolicitacao(c: ContextoAutoatendimento, solicitacao: number) {
    return this.ajustesDe(this.e(c), solicitacao, (id) => this.ponto.ajuste(c, id));
  }

  async acessosAtestado(c: ContextoAutoatendimento, solicitacao: number): Promise<AcessoAtestadoLido[]> {
    const s = this.e(c);
    const a = s.atestados.find((x) => x.solicitacao === solicitacao);
    if (!a) return [];
    return s.acessos
      .filter((x) => x.atestado === a.id)
      .sort((x, y) => y.acessadoEm.localeCompare(x.acessadoEm) || y.id - x.id)
      .map((x) => ({
        id: x.id,
        acessadoPor: x.acessadoPor,
        acessadoEm: x.acessadoEm,
        viuCid: x.viuCid,
        finalidade: x.finalidade,
      }));
  }

  async gravarSgh<T>(
    c: ContextoAutoatendimento,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorAutoatendimento) => Promise<T>,
  ): Promise<T> {
    return this.ponto.gravarSgh(c, trilha, (gp) =>
      this.folha.gravarSgh(c, trilha, (gf) =>
        this.pessoas.gravarSgh(c, trilha, async (gv) => {
          const s = copiar(this.e(c));
          const { agora } = await this.ponto.relogio();
          const id = () => ++s.seq;
          const achar = (i: number) => s.solicitacoes.find((x) => x.id === i);
          const g: GravadorAutoatendimento = {
            solicitacao: async (i) => {
              const x = achar(i);
              return x ? { ...x } : null;
            },
            incluirSolicitacao: async (x) => {
              const n = id();
              s.solicitacoes.push({
                id: n,
                vinculo: x.vinculo,
                tipo: x.tipo,
                inicio: x.inicio,
                fim: x.fim,
                diasGozo: x.diasGozo,
                diasAbono: x.diasAbono,
                adiantaDecimo: x.adiantaDecimo,
                movimento: x.movimento,
                justificativa: x.justificativa,
                campo: x.campo,
                valorAnterior: x.valorAnterior,
                valorNovo: x.valorNovo,
                observacao: x.observacao,
                situacao: 'pendente',
                pedidoPor: x.por,
                pedidoEm: agora,
                decididoPor: null,
                decididoEm: null,
                motivoDecisao: null,
                ferias: null,
                temAtestado: false,
                versao: 0,
              });
              return n;
            },
            incluirAtestado: async (x) => {
              const sol = achar(x.solicitacao);
              if (!sol) throw desatualizado();
              if (s.atestados.some((a) => a.solicitacao === x.solicitacao))
                throw recusa('atestado-repetido', 'A solicitação já tem um atestado.');
              const n = id();
              const { por, ...dados } = x;
              s.atestados.push({
                ...dados,
                cid: dados.cid === null ? null : dados.cid.toUpperCase(),
                id: n,
                criadoPor: por,
                criadoEm: agora,
              });
              sol.temAtestado = true;
              return n;
            },
            decidirSolicitacao: async (d) => {
              const x = achar(d.id);
              if (!x || x.versao !== d.versao || x.situacao !== 'pendente') throw desatualizado();
              if (mesmo(x.pedidoPor, d.por))
                throw recusa(
                  'solicitacao-decisao-pelo-solicitante',
                  'Quem pediu não decide a própria solicitação.',
                );
              if (x.tipo === 'ferias' && d.situacao === 'aprovada' && d.ferias === null)
                throw recusa('ferias-obrigatoria', 'A aprovação das férias exige a programação.');
              Object.assign(x, {
                situacao: d.situacao,
                decididoPor: d.por,
                decididoEm: agora,
                motivoDecisao: d.motivo,
                ferias: d.ferias,
                versao: x.versao + 1,
              });
            },
            desistirSolicitacao: async (d) => {
              const x = achar(d.id);
              if (x && !mesmo(x.pedidoPor, d.por))
                throw recusa(
                  'solicitacao-desistencia-so-do-solicitante',
                  'Só quem pediu pode desistir da solicitação. O gestor aprova ou recusa, com o motivo.',
                );
              if (!x || x.versao !== d.versao || x.situacao !== 'pendente') throw desatualizado();
              Object.assign(x, {
                situacao: 'desistida',
                decididoPor: d.por,
                decididoEm: agora,
                motivoDecisao: d.motivo,
                versao: x.versao + 1,
              });
            },
            ligarAjuste: async (x) => {
              if (s.ajustes.some((l) => l.ajuste === x.ajuste) || !(await gp.ajuste(x.ajuste)))
                throw desatualizado();
              s.ajustes.push({ ajuste: x.ajuste, solicitacao: x.solicitacao });
            },
            ajustesDaSolicitacao: (i) => this.ajustesDe(s, i, (a) => gp.ajuste(a)),
            atestado: async (x): Promise<AtestadoPesLido | null> => {
              const a = s.atestados.find((y) => y.solicitacao === x.solicitacao);
              if (!a) return null;
              s.acessos.push({
                id: id(),
                atestado: a.id,
                acessadoPor: x.por,
                acessadoEm: agora,
                viuCid: x.verCid,
                finalidade: x.finalidade.slice(0, 200),
              });
              return {
                id: a.id,
                solicitacao: a.solicitacao,
                emitidoEm: a.emitidoEm,
                dias: a.dias,
                cid: x.verCid ? a.cid : null,
                temCid: a.cid !== null,
                emitente: a.emitente,
                registroConselho: a.registroConselho,
                arquivo: a.arquivo,
                criadoPor: a.criadoPor,
                criadoEm: a.criadoEm,
              };
            },
            ponto: gp,
            folha: gf,
            pessoas: gv,
          };
          const r = await fn(g);
          this.estados.set(c.hospital, s);
          return r;
        }),
      ),
    );
  }
}
