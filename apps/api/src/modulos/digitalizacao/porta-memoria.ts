// Porta da digitalização certificada em memória (M50, etapa 6): a sessão sintética de dev/ci (E2E e testes da API), com
// os pacientes do cadastro sintético (o prontuário dá o paciente) e uma internação sintética por paciente. As mesmas
// recusas do adaptador (o arquivo repetido, a versão, a situação e a segregação), sem banco; a assinatura do M49 fica
// numerada aqui (o certificado e a validação são os do serviço de assinatura em memória).
import type { DigitalizacaoSghLida, LinhaTrilha, SituacaoDigitalizacaoSgh } from '@sgh/legado';
import { recusa } from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type {
  ContextoDigitalizacao,
  GravadorDigitalizacao,
  PacienteDoProntuario,
  PortaDigitalizacao,
} from './porta.js';

export type LerPacientesDoProntuario = (
  c: ContextoDigitalizacao,
  pront: number,
) => Promise<{ id: number; prontuario: number; nome: string; nomeSocial: string | null } | null>;

const doisDigitos = (n: number) => String(n).padStart(2, '0');
function agoraLocal(relogio: () => Date = () => new Date()): { agora: string; hoje: string } {
  const d = new Date(relogio().getTime() - 3 * 3_600_000);
  const hoje = `${d.getUTCFullYear()}-${doisDigitos(d.getUTCMonth() + 1)}-${doisDigitos(d.getUTCDate())}`;
  return { agora: `${hoje}T${doisDigitos(d.getUTCHours())}:${doisDigitos(d.getUTCMinutes())}`, hoje };
}
const mesma = (a: string | null, b: string) => (a ?? '').trim().toUpperCase() === b.trim().toUpperCase();

export class PortaDigitalizacaoMemoria implements PortaDigitalizacao {
  readonly destino = 'memoria' as const;
  private readonly docs = new Map<string, DigitalizacaoSghLida[]>();
  private seq = 500;
  private seqLote = 50;
  private seqAssinatura = 9100;
  /** As assinaturas do M49 gravadas aqui (para os testes conferirem a origem e a validação). */
  readonly assinaturas: { id: number; origem: string; hash: string; estado: string; resultado: string }[] =
    [];

  constructor(
    private readonly lerPaciente: LerPacientesDoProntuario | null = null,
    /** O relógio (os testes fixam o dia). */
    private readonly agoraDe: () => Date = () => new Date(),
  ) {}

  private doHospital(c: ContextoDigitalizacao) {
    let d = this.docs.get(c.hospital);
    if (!d) {
      d = [];
      this.docs.set(c.hospital, d);
    }
    return d;
  }

  async podeGravar() {
    return { pode: false, codigo: 'sem-operacao', motivo: 'A digitalização grava só no novo.' };
  }

  executar(): Promise<never> {
    return Promise.reject(
      new ErroProblema(
        'operacao-bloqueada',
        409,
        'Sem gravação no outro sistema',
        'A digitalização certificada grava só no novo.',
      ),
    );
  }

  async gravarSgh<T>(
    c: ContextoDigitalizacao,
    _trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorDigitalizacao) => Promise<T>,
  ): Promise<T> {
    const lista = this.doHospital(c);
    const copia = lista.map((x) => ({ ...x }));
    const assinaturas = [...this.assinaturas];
    const { agora } = agoraLocal(this.agoraDe);
    const troca = (i: number, x: Partial<DigitalizacaoSghLida>) => {
      copia[i] = { ...copia[i]!, ...x, versao: copia[i]!.versao + 1 };
    };
    const g: GravadorDigitalizacao = {
      capturar: async (x) => {
        if (copia.some((d) => d.hash === x.hash))
          throw recusa('ja-digitalizado', 'Este mesmo arquivo já foi digitalizado neste estabelecimento.');
        const lote = x.lote ?? ++this.seqLote;
        const ordem = copia.filter((d) => d.lote === lote).reduce((m, d) => Math.max(m, d.ordem), 0) + 1;
        const id = ++this.seq;
        copia.push({
          id,
          lote,
          ordem,
          prontuario: x.prontuario,
          internacao: x.internacao,
          paciente: x.paciente,
          tipoDocumento: x.tipoDocumento,
          descricao: x.descricao,
          dataDocumento: x.dataDocumento,
          paginas: x.paginas,
          resolucaoDpi: x.resolucaoDpi,
          cor: x.cor,
          arquivoChave: x.arquivoChave,
          hash: x.hash,
          tamanho: x.tamanho,
          situacao: 'capturado',
          capturadoPor: x.usuario,
          capturadoEm: agora,
          conferidoPor: null,
          conferidoEm: null,
          motivo: null,
          assinatura: null,
          assinadoPor: null,
          assinadoEm: null,
          carimboEm: null,
          guardaAte: x.guardaAte,
          versao: 1,
        });
        return { id, lote, ordem };
      },
      conferir: async (x) => {
        const i = copia.findIndex((d) => d.id === x.id);
        const d = copia[i];
        if (!d || d.versao !== x.versao || d.situacao !== 'capturado' || mesma(d.capturadoPor, x.usuario))
          throw recusa(
            'versao-desatualizada',
            'O documento foi alterado por outra pessoa, já foi conferido ou foi capturado por você: atualize a fila.',
          );
        troca(i, { situacao: x.situacao, motivo: x.motivo, conferidoPor: x.usuario, conferidoEm: agora });
      },
      assinar: async (x) => {
        const i = copia.findIndex((d) => d.id === x.id);
        const d = copia[i];
        if (!d || d.situacao !== 'conferido' || !mesma(d.conferidoPor, x.usuario))
          throw recusa(
            'versao-desatualizada',
            'O documento já foi assinado, deixou de estar conferido ou foi conferido por outra pessoa.',
          );
        const id = ++this.seqAssinatura;
        assinaturas.push({
          id,
          origem: x.assinatura.origem,
          hash: x.assinatura.hash,
          estado: x.assinatura.estado,
          resultado: x.validacao.resultado,
        });
        const carimbo = x.assinatura.carimboEm?.toISOString().slice(0, 16) ?? null;
        troca(i, {
          situacao: 'assinado',
          assinatura: id,
          assinadoPor: x.usuario,
          assinadoEm: agora,
          carimboEm: carimbo,
        });
        return id;
      },
      registrarFalha: async (x) => {
        const id = ++this.seqAssinatura;
        assinaturas.push({
          id,
          origem: x.assinatura.origem,
          hash: x.assinatura.hash,
          estado: x.assinatura.estado,
          resultado: x.validacao.resultado,
        });
        return id;
      },
      registrarEvento: async () => undefined,
    };
    const r = await fn(g);
    lista.splice(0, lista.length, ...copia);
    this.assinaturas.splice(0, this.assinaturas.length, ...assinaturas);
    return r;
  }

  async relogio() {
    return agoraLocal(this.agoraDe);
  }

  async fila(c: ContextoDigitalizacao, situacao: SituacaoDigitalizacaoSgh | null) {
    const todos = this.doHospital(c);
    const itens = todos
      .filter((d) => situacao === null || d.situacao === situacao)
      .sort((a, b) => b.capturadoEm.localeCompare(a.capturadoEm) || b.id - a.id);
    const contagens: Record<SituacaoDigitalizacaoSgh, number> = {
      capturado: 0,
      conferido: 0,
      recusado: 0,
      assinado: 0,
    };
    for (const d of todos) contagens[d.situacao]++;
    return { itens: itens.slice(0, 200), cortada: itens.length > 200, contagens };
  }

  async documento(c: ContextoDigitalizacao, id: number) {
    return this.doHospital(c).find((d) => d.id === id) ?? null;
  }

  async porIds(c: ContextoDigitalizacao, ids: readonly number[]) {
    return this.doHospital(c).filter((d) => ids.includes(d.id));
  }

  async doProntuario(c: ContextoDigitalizacao, pront: number) {
    return this.doHospital(c).filter((d) => d.prontuario === pront);
  }

  async loteExiste(c: ContextoDigitalizacao, lote: number) {
    return this.doHospital(c).some((d) => d.lote === lote);
  }

  async hashExiste(c: ContextoDigitalizacao, hash: string) {
    return this.doHospital(c).some((d) => d.hash === hash);
  }

  async paciente(c: ContextoDigitalizacao, pront: number): Promise<PacienteDoProntuario | null> {
    const p = this.lerPaciente ? await this.lerPaciente(c, pront) : null;
    if (!p) return null;
    // Uma internação sintética por paciente (REG = prontuário + 500000), para a indexação.
    return {
      prontuario: p.prontuario,
      paciente: p.id,
      nome: p.nomeSocial ?? p.nome,
      internacoes: [{ reg: p.prontuario + 500_000, entrada: '2019-04-01', saida: '2019-04-05' }],
    };
  }

  async prontuarioDaInternacao(_c: ContextoDigitalizacao, reg: number) {
    return reg > 500_000 ? reg - 500_000 : null;
  }

  async nomes(c: ContextoDigitalizacao, ids: readonly number[]) {
    const m = new Map<number, string>();
    if (!this.lerPaciente) return m;
    const prontuarios = new Map<number, number>();
    for (const d of this.doHospital(c))
      if (ids.includes(d.paciente)) prontuarios.set(d.paciente, d.prontuario);
    for (const [paciente, pront] of prontuarios) {
      const p = await this.lerPaciente(c, pront);
      if (p) m.set(paciente, p.nomeSocial ?? p.nome);
    }
    return m;
  }
}
