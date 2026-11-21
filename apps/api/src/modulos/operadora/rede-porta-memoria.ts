// Porta da rede credenciada em MEMÓRIA (M56, etapa 4, F3): a sessão sintética de dev/ci (E2E). Os domínios com os
// códigos que o banco do estabelecimento tem (rótulos do vocabulário), dois convênios e três prestadores SINTÉTICOS
// (documentos com os dígitos calculados, nenhum de pessoa ou empresa real), as mesmas recusas do banco (documento e
// hospital da Rede únicos, versão vista, substituto credenciado), a mesma paginação por chave e o relógio do processo.
// A trilha da memória é registrada pela API (como nas outras portas em memória).
import {
  CLASSIFICACOES_REDE,
  CONTRATACOES_PRESTADOR,
  DISPONIBILIDADES_SERVICO,
  FORMAS_REAJUSTE,
  ISENCOES_ONUS,
  MODELOS_REMUNERACAO,
  MOVIMENTOS_REDE,
  REGIMES_ATENDIMENTO_OPERADORA,
  TIPOS_PRESTADOR_REDE,
} from '@sgh/contratos';
import { situacaoVigente } from '@sgh/dominio-operadora';
import { ErroProblema } from '../../problema.filter.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  type ContextoRede,
  type ConvenioRede,
  type DominioRede,
  type FiltroMovimentosPorta,
  type FiltroPrestadores,
  type GravacaoRede,
  type GravadorRede,
  type ItemDominioRede,
  LIMITE_PAGINA_MOVIMENTOS,
  LIMITE_PAGINA_PRESTADORES,
  type MovimentoRede,
  nomeBuscaPrestador,
  type PortaRedeOperadora,
  type Prestador,
} from './rede-porta.js';

const opcoes = (o: Readonly<Record<number, string>>): ItemDominioRede[] =>
  Object.entries(o).map(([k, v]) => ({ codigo: Number(k), rotulo: v }));

/** Os domínios como o banco do estabelecimento tem (os códigos; a natureza é a do domínio editável, sintética). */
export const DOMINIOS_REDE_SINTETICOS: Record<DominioRede, ItemDominioRede[]> = {
  tipo: opcoes(TIPOS_PRESTADOR_REDE),
  natureza: opcoes({
    1: 'Rede contratada, referenciada ou credenciada',
    2: 'Rede própria, cooperados',
    3: 'Rede própria, demais prestadores',
    4: 'Reembolso aos beneficiários',
    5: 'Prestador eventual',
  }),
  classificacao: opcoes(CLASSIFICACOES_REDE),
  contratacao: opcoes(CONTRATACOES_PRESTADOR),
  disponibilidade: opcoes(DISPONIBILIDADES_SERVICO),
  isencaoOnus: opcoes(ISENCOES_ONUS),
  regime: opcoes(REGIMES_ATENDIMENTO_OPERADORA),
  remuneracao: opcoes(MODELOS_REMUNERACAO),
  formaReajuste: opcoes(FORMAS_REAJUSTE),
  movimento: opcoes(MOVIMENTOS_REDE),
};

const convenio = (codigo: number, nome: string, registroAns: number | null): ConvenioRede => ({
  codigo,
  nome,
  registroAns,
});

export const CONVENIOS_SINTETICOS: readonly ConvenioRede[] = [
  convenio(990, 'Operadora própria (sintético)', 900001),
  convenio(991, 'Outra operadora (sintético)', 900002),
];

/** CNPJ sintético com os dígitos verificadores calculados. */
export function cnpjSintetico(base12: string): string {
  const dv = (b: string) => {
    let s = 0;
    let p = 2;
    for (let i = b.length - 1; i >= 0; i--) {
      s += (b.charCodeAt(i) - 48) * p;
      p = p === 9 ? 2 : p + 1;
    }
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const a = base12 + String(dv(base12));
  return a + String(dv(a));
}

const AGORA = '2026-10-24T08:00:00';

function semente(id: number, p: Partial<Prestador>): Prestador {
  return {
    id,
    pessoa: 'J',
    documento: cnpjSintetico(`9000000${id}0001`.slice(0, 12)),
    nome: `Prestador sintético ${id}`,
    nomeFantasia: null,
    cnes: String(9_000_000 + id),
    uf: 'SC',
    municipioIbge: 4205407,
    tipo: 4,
    natureza: 1,
    classificacao: 3,
    contratacao: 1,
    operadoraIntermediaria: null,
    disponibilidade: 1,
    isencaoOnus: 1,
    urgencia: false,
    regime: 1,
    remuneracao: 1,
    contrato: { numero: `SINT-${id}`, inicio: '2026-01-01', fim: null, formaReajuste: 1, mesReajuste: 1 },
    ehOHospital: false,
    estabelecimento: null,
    convenio: null,
    situacao: 'credenciado',
    situacaoEm: '2026-01-01',
    saidaEm: null,
    motivoSituacao: null,
    substituto: null,
    avisoBeneficiariosEm: null,
    autorizacaoAns: null,
    versao: 1,
    criadoEm: AGORA,
    criadoPor: 'SINT.ADMIN',
    alteradoEm: AGORA,
    alteradoPor: 'SINT.ADMIN',
    ...p,
  };
}

/** Os três prestadores sintéticos de partida: um laboratório e dois hospitais (um serve de substituto). */
export function prestadoresSinteticos(): Prestador[] {
  return [
    semente(1, { nome: 'Laboratório sintético Alfa', tipo: 4 }),
    semente(2, {
      nome: 'Hospital sintético Beta',
      tipo: 3,
      classificacao: 1,
      regime: 3,
      urgencia: true,
    }),
    semente(3, {
      nome: 'Hospital sintético Gama',
      tipo: 3,
      classificacao: 1,
      regime: 2,
      municipioIbge: 4209102,
    }),
  ];
}

const recusa = (codigo: string, detalhe: string, campos: string[] = []) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', detalhe, { codigo, campos });

const hojeLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const agoraLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${hojeLocal()}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/**
 * A leitura pela situação vigente (como a do banco): o descredenciado com a data efetiva no futuro segue credenciado,
 * com a saída agendada. O estado guarda o que a gravação grava (`saidaEm` sempre null).
 */
const vigente = (p: Prestador): Prestador => ({
  ...p,
  ...situacaoVigente(p.situacao, p.situacaoEm, hojeLocal()),
});

interface Estado {
  prestadores: Prestador[];
  movimentos: (MovimentoRede & { readonly hospital: string })[];
  seq: number;
  seqMov: number;
}

export class PortaRedeOperadoraMemoria implements PortaRedeOperadora {
  readonly destino = 'memoria' as const;
  private readonly porHospital = new Map<string, Estado>();

  private estado(h: string): Estado {
    let e = this.porHospital.get(h);
    if (!e) {
      const prestadores = prestadoresSinteticos();
      e = {
        prestadores,
        movimentos: prestadores.map((p, i) => ({
          hospital: h,
          id: i + 1,
          prestador: p.id,
          prestadorNome: p.nome,
          movimento: 1,
          campos: [],
          motivo: null,
          situacao: 'enviado' as const,
          registradoEm: AGORA,
          registradoPor: 'SINT.ADMIN',
        })),
        seq: 100,
        seqMov: 100,
      };
      this.porHospital.set(h, e);
    }
    return e;
  }

  async hoje(): Promise<string> {
    return hojeLocal();
  }

  async dominios() {
    return DOMINIOS_REDE_SINTETICOS;
  }

  async convenios() {
    return [...CONVENIOS_SINTETICOS];
  }

  async prestadores(c: ContextoRede, f: FiltroPrestadores) {
    const busca = f.busca?.trim() ?? '';
    const doc = busca.replace(/[.\-/\s]/g, '').toUpperCase();
    const porDoc = /^\d{7}$/.test(doc) || (/^[0-9A-Z]{11,14}$/.test(doc) && /\d/.test(doc));
    const termo = nomeBuscaPrestador(busca);
    const lista = this.estado(c.hospital)
      .prestadores.map((p) => ({ p: vigente(p), chave: nomeBuscaPrestador(p.nome) }))
      .filter(
        ({ p, chave }) =>
          (!busca || (porDoc ? p.documento === doc || p.cnes === doc : chave.includes(termo))) &&
          (!f.situacao || p.situacao === f.situacao) &&
          (f.tipo === undefined || p.tipo === f.tipo) &&
          (!f.apos || chave > f.apos.nome || (chave === f.apos.nome && p.id > f.apos.id)),
      )
      .sort((a, b) => (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : a.p.id - b.p.id));
    const itens = lista.slice(0, LIMITE_PAGINA_PRESTADORES);
    const u = itens[itens.length - 1];
    return {
      itens: itens.map((x) => x.p),
      proxima: lista.length > LIMITE_PAGINA_PRESTADORES && u ? { nome: u.chave, id: u.p.id } : null,
    };
  }

  async prestador(c: ContextoRede, id: number) {
    const p = this.estado(c.hospital).prestadores.find((x) => x.id === id);
    return p ? vigente(p) : null;
  }

  async totais(c: ContextoRede) {
    const e = this.estado(c.hospital);
    const lidos = e.prestadores.map(vigente);
    const cred = lidos.filter((p) => p.situacao === 'credenciado');
    return {
      credenciados: cred.length,
      descredenciados: lidos.length - cred.length,
      hospitalares: cred.filter((p) => p.tipo === 3 || p.classificacao === 1).length,
      saidasAgendadas: cred.filter((p) => p.saidaEm !== null).length,
      rpsPendentes: e.movimentos.filter((m) => m.situacao === 'pendente').length,
    };
  }

  async movimentos(c: ContextoRede, f: FiltroMovimentosPorta) {
    const lista = this.estado(c.hospital)
      .movimentos.filter(
        (m) =>
          (!f.situacao || m.situacao === f.situacao) &&
          (f.prestador === undefined || m.prestador === f.prestador) &&
          (f.apos === undefined || m.id < f.apos),
      )
      .sort((a, b) => b.id - a.id);
    const itens = lista.slice(0, LIMITE_PAGINA_MOVIMENTOS).map((m): MovimentoRede => ({
      id: m.id,
      prestador: m.prestador,
      prestadorNome: m.prestadorNome,
      movimento: m.movimento,
      campos: m.campos,
      motivo: m.motivo,
      situacao: m.situacao,
      registradoEm: m.registradoEm,
      registradoPor: m.registradoPor,
    }));
    return {
      itens,
      proxima: lista.length > LIMITE_PAGINA_MOVIMENTOS ? (itens[itens.length - 1]?.id ?? null) : null,
    };
  }

  async gravar<T extends GravacaoRede>(
    c: ContextoRede,
    _trilha: RegistroTrilhaTela | ((r: T) => RegistroTrilhaTela),
    fn: (g: GravadorRede) => Promise<T>,
  ): Promise<T> {
    const e = this.estado(c.hospital);
    // A transação da memória: as mudanças valem só se a função terminar (cópia de trabalho).
    const prestadores = e.prestadores.map((p) => ({ ...p }));
    const movimentos = [...e.movimentos];
    let seq = e.seq;
    let seqMov = e.seqMov;
    const mover = (
      prestador: Prestador,
      movimento: 1 | 2 | 3 | 4,
      campos: readonly string[],
      motivo: string | null,
      usuario: string,
    ) => {
      const id = ++seqMov;
      movimentos.push({
        hospital: c.hospital,
        id,
        prestador: prestador.id,
        prestadorNome: prestador.nome,
        movimento,
        campos: [...campos],
        motivo,
        situacao: 'pendente',
        registradoEm: agoraLocal(),
        registradoPor: usuario,
      });
      return id;
    };
    const unico = (doc: string | null, estab: string | null, exceto: number | null) => {
      if (doc && prestadores.some((p) => p.documento === doc && p.id !== exceto))
        throw recusa('documento-ja-credenciado', 'Este CPF ou CNPJ já está na rede da operadora.', [
          'documento',
        ]);
      if (estab && prestadores.some((p) => p.estabelecimento === estab && p.id !== exceto))
        throw recusa(
          'hospital-ja-na-rede',
          'Este estabelecimento da Rede já está credenciado como prestador da operadora.',
          ['estabelecimento'],
        );
    };
    const versaoVista = (id: number, versao: number, situacao?: Prestador['situacao']) => {
      const i = prestadores.findIndex((p) => p.id === id);
      const p = prestadores[i];
      if (!p || p.versao !== versao || (situacao && p.situacao !== situacao))
        throw recusa(
          'prestador-desatualizado',
          'O prestador mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira antes de gravar.',
        );
      return { i, p };
    };
    const g: GravadorRede = {
      credenciar: async (x) => {
        const estab = x.ehOHospital ? x.estabelecimento : null;
        unico(x.documento, estab, null);
        const id = ++seq;
        const agora = agoraLocal();
        const novo: Prestador = {
          id,
          pessoa: x.pessoa,
          documento: x.documento,
          nome: x.nome,
          nomeFantasia: x.nomeFantasia,
          cnes: x.cnes?.trim() || null,
          uf: x.uf,
          municipioIbge: x.municipioIbge,
          tipo: x.tipo,
          natureza: x.natureza,
          classificacao: x.classificacao,
          contratacao: x.contratacao,
          operadoraIntermediaria: x.operadoraIntermediaria?.trim() || null,
          disponibilidade: x.disponibilidade,
          isencaoOnus: x.isencaoOnus,
          urgencia: x.urgencia,
          regime: x.regime,
          remuneracao: x.remuneracao,
          contrato: { ...x.contrato },
          ehOHospital: x.ehOHospital,
          estabelecimento: estab,
          convenio: x.convenio,
          situacao: 'credenciado',
          situacaoEm: hojeLocal(),
          saidaEm: null,
          motivoSituacao: null,
          substituto: null,
          avisoBeneficiariosEm: null,
          autorizacaoAns: null,
          versao: 1,
          criadoEm: agora,
          criadoPor: x.usuario,
          alteradoEm: agora,
          alteradoPor: x.usuario,
        };
        prestadores.push(novo);
        return { id, versao: 1, movimento: mover(novo, 1, [], null, x.usuario) };
      },
      alterar: async (x) => {
        const { i, p } = versaoVista(x.id, x.versao, 'credenciado');
        const estab = x.ehOHospital ? x.estabelecimento : null;
        unico(null, estab, x.id);
        const { camposRps, usuario } = x;
        const novo: Prestador = {
          ...p,
          nome: x.nome,
          nomeFantasia: x.nomeFantasia,
          cnes: x.cnes?.trim() || null,
          uf: x.uf,
          municipioIbge: x.municipioIbge,
          tipo: x.tipo,
          natureza: x.natureza,
          classificacao: x.classificacao,
          contratacao: x.contratacao,
          operadoraIntermediaria: x.operadoraIntermediaria?.trim() || null,
          disponibilidade: x.disponibilidade,
          isencaoOnus: x.isencaoOnus,
          urgencia: x.urgencia,
          regime: x.regime,
          remuneracao: x.remuneracao,
          contrato: { ...x.contrato },
          ehOHospital: x.ehOHospital,
          convenio: x.convenio,
          estabelecimento: estab,
          versao: p.versao + 1,
          alteradoEm: agoraLocal(),
          alteradoPor: usuario,
        };
        prestadores[i] = novo;
        const movimento = camposRps.length ? mover(novo, 2, camposRps, null, usuario) : null;
        return { id: x.id, versao: novo.versao, movimento };
      },
      descredenciar: async (x) => {
        if (x.substituto !== null) {
          const s = prestadores.find((p) => p.id === x.substituto);
          if (!s || s.situacao !== 'credenciado')
            throw recusa(
              'substituto-descredenciado',
              'O substituto não está mais credenciado. Escolha outro prestador equivalente.',
              ['substituto'],
            );
        }
        const { i, p } = versaoVista(x.id, x.versao, 'credenciado');
        const novo: Prestador = {
          ...p,
          situacao: 'descredenciado',
          situacaoEm: x.efetivoEm,
          motivoSituacao: x.motivo,
          substituto: x.substituto,
          avisoBeneficiariosEm: x.avisoBeneficiariosEm,
          autorizacaoAns: x.autorizacaoAns?.trim() || null,
          versao: p.versao + 1,
          alteradoEm: agoraLocal(),
          alteradoPor: x.usuario,
        };
        prestadores[i] = novo;
        return { id: x.id, versao: novo.versao, movimento: mover(novo, 3, [], x.motivo, x.usuario) };
      },
      reincluir: async (x) => {
        const { i, p } = versaoVista(x.id, x.versao, 'descredenciado');
        const novo: Prestador = {
          ...p,
          situacao: 'credenciado',
          situacaoEm: hojeLocal(),
          motivoSituacao: x.motivo,
          substituto: null,
          avisoBeneficiariosEm: null,
          autorizacaoAns: null,
          contrato: { ...x.contrato },
          versao: p.versao + 1,
          alteradoEm: agoraLocal(),
          alteradoPor: x.usuario,
        };
        prestadores[i] = novo;
        return { id: x.id, versao: novo.versao, movimento: mover(novo, 4, [], x.motivo, x.usuario) };
      },
    };
    const r = await fn(g);
    e.prestadores = prestadores;
    e.movimentos = movimentos;
    e.seq = seq;
    e.seqMov = seqMov;
    return r;
  }
}
