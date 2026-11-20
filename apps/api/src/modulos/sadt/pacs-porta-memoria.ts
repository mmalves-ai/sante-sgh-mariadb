// Porta da lista de trabalho DICOM em MEMÓRIA (M47, etapa 3): a sessão sintética de dev/ci e o E2E. Os exames de imagem
// vêm da porta em memória do SADT (exames sintéticos: os pedidos do prontuário e os lançados no setor); o item, o
// reenvio e o status ficam aqui, com as mesmas regras da gravação do legado (um item por exame, o mesmo número de acesso
// no reenvio, a conferência do envio visto, a mensagem repetida devolvendo a primeira). O PACS é o simulador de
// modalidade: a entrega é imediata e o item chega ao simulador pelo mesmo conteúdo DICOM que o worker monta. Nada vai
// à cópia; todo dado é SINTÉTICO.
import { recusa } from '@sgh/legado';
import type { ExameImagemPendente, ItemMwlBanco, ModalidadeLida, StatusEstudoBanco } from '@sgh/legado';
import { itemMwlDicom, SimuladorModalidade } from '@sgh/dominio-sadt';
import { SETORES_SADT } from '@sgh/contratos';
import type { PortaSadt } from './porta.js';
import type { ContextoPacs, GravadorPacs, PortaPacs } from './pacs-porta.js';

/** O cadastro de modalidades sintético (as siglas do padrão DICOM usadas pelo parâmetro). */
export const MODALIDADES_SINTETICAS: readonly ModalidadeLida[] = [
  { id: 6, sigla: 'CR', ativa: true },
  { id: 8, sigla: 'CT', ativa: true },
  { id: 24, sigla: 'MR', ativa: true },
  { id: 27, sigla: 'OT', ativa: true },
  { id: 80, sigla: 'US', ativa: false },
];
export const PARCEIRO_SIMULADO = {
  codigo: 'pacs-simulador',
  nome: 'Simulador de modalidade e PACS',
} as const;

interface EstadoPacs {
  itens: Map<number, ItemMwlBanco>;
  estudos: StatusEstudoBanco[];
  seq: number;
  seqEstudo: number;
  outbox: number;
  simulador: SimuladorModalidade;
}

const agoraLocal = () => {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export class PortaPacsMemoria implements PortaPacs {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, EstadoPacs>();

  constructor(private readonly sadt: PortaSadt) {}

  private e(c: ContextoPacs): EstadoPacs {
    let s = this.estados.get(c.hospital);
    if (!s) {
      s = {
        itens: new Map(),
        estudos: [],
        seq: 0,
        seqEstudo: 0,
        outbox: 9000,
        simulador: new SimuladorModalidade(),
      };
      this.estados.set(c.hospital, s);
    }
    return s;
  }

  /** O simulador do estabelecimento (os testes conferem o que chegou). */
  simulador(hospital: string): SimuladorModalidade {
    return this.e({ rede: '', hospital }).simulador;
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }
  executar(): never {
    throw new Error('A lista de trabalho DICOM não usa receita do legado (operações só SGH_).');
  }

  relogio(c: ContextoPacs) {
    return this.sadt.relogio(c);
  }

  async examesDoDia(
    c: ContextoPacs,
    data: string,
    f?: { readonly ato?: number | undefined; readonly termo?: string | undefined },
  ) {
    const r = await this.sadt.examesDoSetor(c, {
      setor: 'imagem',
      inicio: data,
      fim: data,
      ...(f?.ato ? { ato: f.ato } : {}),
      ...(f?.termo ? { termo: f.termo } : {}),
    });
    return { itens: r.itens, cortada: r.cortada };
  }

  examesPorId(c: ContextoPacs, ids: readonly number[]) {
    return this.sadt.examesPorId(c, ids);
  }

  async examesSemItem(
    c: ContextoPacs,
    f: { desde: string; ate: string; atos: readonly number[]; teto: number },
  ): Promise<{ itens: ExameImagemPendente[]; cortada: boolean }> {
    const s = this.e(c);
    const r = await this.sadt.examesDoSetor(c, { setor: 'imagem', inicio: f.desde, fim: f.ate });
    const com = new Set([...s.itens.values()].map((i) => i.exame));
    const todos = r.itens
      .filter((x) => f.atos.includes(x.ato) && !com.has(x.id))
      .map((x) => ({ exame: x.id, ato: x.ato, data: x.chave.data.slice(0, 10) }));
    return { itens: todos.slice(0, f.teto), cortada: todos.length > f.teto };
  }

  async modalidades() {
    return [...MODALIDADES_SINTETICAS];
  }
  async modalidadeDoCadastro() {
    return new Map<number, { id: number; sigla: string }>();
  }
  async visualizadores() {
    return [
      { id: 1, nome: 'OVIYAM' },
      { id: 2, nome: 'WEASIS' },
    ];
  }

  async itens(c: ContextoPacs, exames: readonly number[]) {
    const s = this.e(c);
    return [...s.itens.values()].filter((i) => exames.includes(i.exame));
  }
  async item(c: ContextoPacs, chave: { id: number } | { accession: string }) {
    const s = this.e(c);
    if ('id' in chave) return s.itens.get(chave.id) ?? null;
    return [...s.itens.values()].find((i) => i.accession === chave.accession) ?? null;
  }
  async itensDoPaciente(c: ContextoPacs, paciente: number) {
    const s = this.e(c);
    return [...s.itens.values()].filter((i) => i.paciente === paciente).sort((a, b) => b.id - a.id);
  }
  async status(c: ContextoPacs, exames: readonly number[]) {
    return this.e(c).estudos.filter((x) => exames.includes(x.exame));
  }
  async parceiroDaWorklist() {
    return { ...PARCEIRO_SIMULADO };
  }

  /** A entrega ao simulador: o mesmo conteúdo DICOM que o worker monta (os dados do exame sintético). */
  private async entregar(c: ContextoPacs, i: ItemMwlBanco): Promise<ItemMwlBanco> {
    const [x] = await this.sadt.examesPorId(c, [i.exame]);
    if (!x) return { ...i, entrega: { situacao: 'morto', tentativas: 1, resposta: 'exame não encontrado' } };
    const r = this.e(c).simulador.receber(
      itemMwlDicom({
        accession: i.accession,
        hospital: c.hospital,
        modalidade: i.modalidade,
        estacao: i.modalidade,
        paciente: {
          id: x.paciente.prontuario,
          nome: x.paciente.nome,
          nascimento: x.paciente.nascimento,
          sexo: x.paciente.sexo,
        },
        exame: { codigo: x.exame.codigo, nome: x.exame.nome },
        agendadoPara: x.pedidoEm ?? `${x.chave.data.slice(0, 10)}T00:00`,
        urgente: x.urgente,
        solicitante: x.solicitante || null,
      }),
    );
    return { ...i, entrega: { situacao: 'enviado', tentativas: 0, resposta: `simulador: ${r.situacao}` } };
  }

  async gravarSgh<T>(c: ContextoPacs, _trilha: unknown, fn: (g: GravadorPacs) => Promise<T>): Promise<T> {
    const s = this.e(c);
    // Transação em memória: o que falhar no meio desfaz o estado.
    const copia = {
      itens: new Map(s.itens),
      estudos: [...s.estudos],
      seq: s.seq,
      seqEstudo: s.seqEstudo,
      outbox: s.outbox,
    };
    const g: GravadorPacs = {
      registrarItem: async (r) => {
        if ([...s.itens.values()].some((i) => i.exame === r.exame))
          throw recusa(
            'ja-na-worklist',
            'Este exame já está na lista de trabalho: use o reenvio (o mesmo número de acesso).',
          );
        const id = ++s.seq;
        const outbox = String(++s.outbox);
        const agora = agoraLocal();
        const item: ItemMwlBanco = {
          id,
          exame: r.exame,
          paciente: r.paciente,
          chaveNatural: r.chaveNatural,
          ato: r.ato,
          idModalidade: r.modalidade.id,
          modalidade: r.modalidade.sigla,
          accession: r.accession(id),
          envios: 1,
          idOutbox: outbox,
          ultimoEnvioEm: agora,
          ultimoEnvioPor: r.por,
          origem: r.origem,
          criadoEm: agora,
          entrega: null,
        };
        s.itens.set(id, await this.entregar(c, item));
        return { id, accession: item.accession, outbox };
      },
      reenviar: async (r) => {
        const i = s.itens.get(r.id);
        if (!i || i.envios !== r.envios)
          throw recusa(
            'mwl-desatualizado',
            'O item mudou depois que você abriu (outra pessoa reenviou). Abra a lista de novo.',
          );
        if (r.envios + 1 > 999)
          throw recusa('reenvios-esgotados', 'Este item já foi reenviado 999 vezes: confira o PACS.');
        const outbox = String(++s.outbox);
        const novo = {
          ...i,
          envios: r.envios + 1,
          idOutbox: outbox,
          ultimoEnvioEm: agoraLocal(),
          ultimoEnvioPor: r.por,
        };
        s.itens.set(r.id, await this.entregar(c, novo));
        return { id: r.id, envios: novo.envios, outbox };
      },
      registrarStatus: async (r) => {
        const ja = s.estudos.find((x) => x.chaveMensagem === r.chaveMensagem);
        if (ja) return { estudo: ja, repetida: true };
        const estudo: StatusEstudoBanco = {
          id: ++s.seqEstudo,
          mwl: r.mwl,
          exame: r.exame,
          accession: r.accession,
          status: r.status,
          uidEstudo: r.uidEstudo,
          uidMpps: r.uidMpps,
          ocorridoEm: r.ocorridoEm.length === 16 ? `${r.ocorridoEm}:00` : r.ocorridoEm.slice(0, 19),
          visualizador: r.visualizador,
          chaveMensagem: r.chaveMensagem,
          origem: r.origem,
          recebidoEm: agoraLocal(),
        };
        s.estudos.push(estudo);
        return { estudo, repetida: false };
      },
    };
    try {
      return await fn(g);
    } catch (x) {
      Object.assign(s, copia);
      throw x;
    }
  }
}

/** Os atos do setor de imagem (para a geração automática e a tela). */
export const ATOS_IMAGEM: readonly number[] = SETORES_SADT.find((s) => s.codigo === 'imagem')!.atos;
