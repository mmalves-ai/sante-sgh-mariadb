// Porta da contratualização SUS EM MEMÓRIA (M55, fatia F5): a sessão sintética de dev/ci (E2E) tem os domínios da
// contratualização com os códigos da tela, alguns procedimentos SIGTAP e uma produção SUS SINTÉTICA das
// contas (12 competências até a atual) e grava contratos, metas e apurações SINTÉTICOS com as mesmas regras e recusas
// da gravação (a versão vista, a chave única do pedido, uma apuração por meta e período, o contrato encerrado que não
// muda). Nada vai a banco; nenhum nome é de pessoa real.
import type { ApuracaoSus, ContratoSus, MetaSus, ProducaoSigtapSus } from '@sgh/contratos';
import {
  AFERICOES_SUS,
  COMPLEXIDADES_SUS,
  ESCORES_SUS,
  ESFERAS_CONTRATO_SUS,
  FORMATOS_INDICADOR_SUS,
  PERIODICIDADES_META_SUS,
  REDES_ASSISTENCIA_SUS,
  TIPOS_INDICADOR_SUS,
  TIPOS_ORCAMENTO_SUS,
} from '@sgh/contratos';
import { recusa } from '@sgh/nucleo';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import type { DominiosContratualizacao, GravadorContratualizacao, PortaContratualizacao } from './porta.js';

const p2 = (n: number) => String(n).padStart(2, '0');
function hojeLocal(): { hoje: string; competencia: string } {
  const d = new Date();
  const hoje = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return { hoje, competencia: `${hoje.slice(0, 4)}${hoje.slice(5, 7)}` };
}
const menosMeses = (competencia: string, n: number) => {
  const t = Number(competencia.slice(0, 4)) * 12 + Number(competencia.slice(4, 6)) - 1 - n;
  return `${Math.floor(t / 12)}${p2((t % 12) + 1)}`;
};

const item = (codigo: number, nome: string, sigla: string | null = null) => ({ codigo, nome, sigla });
const DOMINIOS: DominiosContratualizacao = {
  periodicidade: [
    ...PERIODICIDADES_META_SUS.map((p) => item(p.codigo, p.rotulo)),
    item(4, 'Diária'),
    item(7, 'Quinzenal'),
    item(8, 'Semanal'),
  ].sort((a, b) => a.codigo - b.codigo),
  tipo_indicador: [item(0, 'Não informado'), ...TIPOS_INDICADOR_SUS.map((t) => item(t.codigo, t.rotulo))],
  complexidade: COMPLEXIDADES_SUS.map((c) => item(c.codigo, c.rotulo)),
  tipo_item_indicador: [
    item(1, 'Título'),
    ...FORMATOS_INDICADOR_SUS.map((f) => item(f.codigo, f.rotulo)),
    item(3, 'Texto'),
    item(4, 'Texto fixo'),
    item(5, 'Respostas'),
  ].sort((a, b) => a.codigo - b.codigo),
  rede_assistencial: REDES_ASSISTENCIA_SUS.map((r) => item(r.codigo, r.rotulo)),
  escore: [...ESCORES_SUS].reverse().map((e) => item(e.codigo, e.rotulo)),
  tipo_afericao: AFERICOES_SUS.map((a) => item(a.codigo, a.rotulo)),
  esfera: ESFERAS_CONTRATO_SUS.map((e) => item(e.codigo, e.rotulo)),
  tipo_dado: [item(1, 'Contratado'), item(2, 'Contratante'), item(3, 'Interventor')],
  componente_orcamento: TIPOS_ORCAMENTO_SUS.map((t) => item(t.codigo, t.rotulo)),
  incentivo: [item(0, 'Não informado')],
};

/** Procedimentos SIGTAP sintéticos (códigos reais da tabela pública; nenhum dado de pessoa). */
export const SIGTAP_SINTETICA_CONTRATUALIZACAO = [
  { codigo: '0301010072', nome: 'Consulta médica em atenção especializada' },
  { codigo: '0301060029', nome: 'Atendimento de urgência com observação até 24 horas' },
  { codigo: '0303060212', nome: 'Tratamento de insuficiência cardíaca' },
  { codigo: '0406010935', nome: 'Implante de marcapasso cardíaco' },
] as const;

/** A produção sintética das contas SUS: cada competência dos últimos 12 meses com quantidades fixas por procedimento. */
export function producaoSinteticaContratualizacao(atual: string): ProducaoSigtapSus[] {
  const out: ProducaoSigtapSus[] = [];
  for (let i = 0; i < 12; i++) {
    const competencia = menosMeses(atual, i);
    out.push(
      { competencia, modalidade: 'ambulatorial', codigo: '0301010072', quantidade: 90 + (i % 3) * 10 },
      { competencia, modalidade: 'ambulatorial', codigo: '0301060029', quantidade: 40 },
      { competencia, modalidade: 'hospitalar', codigo: '0303060212', quantidade: 12 },
      { competencia, modalidade: 'hospitalar', codigo: '0406010935', quantidade: 3 },
    );
  }
  return out;
}

type Mutavel<T> = { -readonly [K in keyof T]: T[K] };
interface Estado {
  contratos: (Mutavel<ContratoSus> & { chave: string })[];
  metas: (Mutavel<MetaSus> & { chave: string })[];
  apuracoes: (Mutavel<ApuracaoSus> & { chave: string })[];
  seq: number;
}

function sem<T extends { chave: string }>(x: T): Omit<T, 'chave'> {
  const r: Partial<T> = { ...x };
  delete r.chave;
  return r as Omit<T, 'chave'>;
}
const agora = () => new Date().toISOString().slice(0, 19);
const versaoVencida = () =>
  recusa('versao-desatualizada', 'O registro mudou desde que foi aberto: atualize a tela e confira.');

export class PortaContratualizacaoMemoria implements PortaContratualizacao {
  readonly destino = 'memoria' as const;
  private readonly porHospital = new Map<string, Estado>();

  constructor(private readonly relogioFn: () => { hoje: string; competencia: string } = hojeLocal) {}

  private e(c: ContextoPortaM18): Estado {
    const k = String(c.estabelecimento ?? (c as ContextoPortaM18 & { hospital?: string }).hospital ?? '');
    let s = this.porHospital.get(k);
    if (!s) {
      s = { contratos: [], metas: [], apuracoes: [], seq: 55_500 };
      this.porHospital.set(k, s);
    }
    return s;
  }

  async podeGravar() {
    return {
      pode: false,
      codigo: 'sem-operacao',
      motivo: 'A contratualização SUS não usa operação do executor.',
    };
  }

  async executar(): Promise<never> {
    throw new Error('A contratualização SUS não usa operação do executor.');
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    _trilha: unknown,
    fn: (g: GravadorContratualizacao) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const antes = structuredClone(s);
    try {
      return await fn(this.gravador(s));
    } catch (x) {
      Object.assign(s, antes);
      throw x;
    }
  }

  private gravador(s: Estado): GravadorContratualizacao {
    const contrato = (id: number) => s.contratos.find((x) => x.id === id);
    const meta = (id: number) => s.metas.find((x) => x.id === id);
    return {
      relogio: async () => this.relogioFn(),
      contrato: async (id) => {
        const x = contrato(id);
        return x ? sem(x) : null;
      },
      contratoPelaChave: async (chave) => {
        const x = s.contratos.find((y) => y.chave === chave);
        return x ? sem(x) : null;
      },
      numeroEmUso: async (numero, excetoId) =>
        s.contratos.some((x) => x.numero === numero && x.id !== excetoId),
      metas: async (id) => s.metas.filter((x) => x.contrato === id).map(sem),
      meta: async (id) => {
        const x = meta(id);
        return x ? sem(x) : null;
      },
      metaPelaChave: async (chave) => {
        const x = s.metas.find((y) => y.chave === chave);
        return x ? sem(x) : null;
      },
      apuracao: async (m, competencia) => {
        const x = s.apuracoes.find((y) => y.meta === m && y.competencia === competencia);
        return x ? sem(x) : null;
      },
      apuracaoPelaChave: async (chave) => {
        const x = s.apuracoes.find((y) => y.chave === chave);
        return x ? sem(x) : null;
      },
      incluirContrato: async (c) => {
        if (s.contratos.some((x) => x.chave === c.chave))
          throw recusa('chave-de-outro-registro', 'Chave repetida.');
        const id = ++s.seq;
        s.contratos.push({
          ...c.entrada,
          incentivos: c.entrada.incentivos.map((i) => ({ ...i })),
          id,
          situacao: 'ativo',
          motivoEncerramento: null,
          encerradoPor: null,
          encerradoEm: null,
          criadoPor: c.usuario,
          criadoEm: agora(),
          alteradoPor: null,
          alteradoEm: null,
          versao: 1,
          chave: c.chave,
        } as Mutavel<ContratoSus> & { chave: string });
        return { id, versao: 1 };
      },
      alterarContrato: async (c) => {
        const x = contrato(c.id);
        if (!x || x.versao !== c.versaoVista || x.situacao !== 'ativo') throw versaoVencida();
        Object.assign(x, {
          ...c.entrada,
          incentivos: c.entrada.incentivos.map((i) => ({ ...i })),
          alteradoPor: c.usuario,
          alteradoEm: agora(),
          versao: x.versao + 1,
        });
        return { id: x.id, versao: x.versao };
      },
      encerrarContrato: async (c) => {
        const x = contrato(c.id);
        if (!x || x.versao !== c.versaoVista || x.situacao !== 'ativo') throw versaoVencida();
        Object.assign(x, {
          situacao: 'encerrado',
          motivoEncerramento: c.motivo,
          encerradoPor: c.usuario,
          encerradoEm: agora(),
          versao: x.versao + 1,
        });
        return { id: x.id, versao: x.versao };
      },
      incluirMeta: async (m) => {
        if (s.metas.some((x) => x.chave === m.chave))
          throw recusa('chave-de-outro-registro', 'Chave repetida.');
        const id = ++s.seq;
        s.metas.push({
          ...m.entrada,
          id,
          contrato: m.contrato,
          por: m.usuario,
          em: agora(),
          versao: 1,
          chave: m.chave,
        } as Mutavel<MetaSus> & { chave: string });
        return { id, versao: 1 };
      },
      alterarMeta: async (m) => {
        const x = meta(m.id);
        if (!x || x.versao !== m.versaoVista || x.tipo !== m.entrada.tipo) throw versaoVencida();
        Object.assign(x, { ...m.entrada, por: m.usuario, em: agora(), versao: x.versao + 1 });
        return { id: x.id, versao: x.versao };
      },
      registrarApuracao: async (a) => {
        if (
          s.apuracoes.some(
            (x) => x.chave === a.chave || (x.meta === a.meta && x.competencia === a.competencia),
          )
        )
          throw recusa('apuracao-repetida', 'Este período já tem apuração registrada.');
        const id = ++s.seq;
        const { usuario, chave, ...resto } = a;
        s.apuracoes.push({ ...resto, id, por: usuario, em: agora(), versao: 1, chave });
        return { id, versao: 1 };
      },
      corrigirApuracao: async (a) => {
        const x = s.apuracoes.find((y) => y.id === a.id);
        if (!x || x.versao !== a.versaoVista || x.meta !== a.meta || x.competencia !== a.competencia)
          throw versaoVencida();
        Object.assign(x, {
          inicioPeriodo: a.inicioPeriodo,
          metaPeriodo: a.metaPeriodo,
          realizado: a.realizado,
          cumprimentoPct: a.cumprimentoPct,
          escore: a.escore,
          origem: a.origem,
          observacao: a.observacao,
          por: a.usuario,
          em: agora(),
          versao: x.versao + 1,
        });
        return { id: x.id, versao: x.versao };
      },
    };
  }

  async relogio() {
    return this.relogioFn();
  }

  async dominios() {
    return structuredClone(DOMINIOS);
  }

  async contratos(c: ContextoPortaM18) {
    const itens = [...this.e(c).contratos]
      .sort((a, b) => a.situacao.localeCompare(b.situacao) || b.fim.localeCompare(a.fim) || b.id - a.id)
      .map(sem);
    return { itens: itens.slice(0, 200), cortada: itens.length > 200 };
  }

  async contrato(c: ContextoPortaM18, id: number) {
    const x = this.e(c).contratos.find((y) => y.id === id);
    return x ? sem(x) : null;
  }

  async metas(c: ContextoPortaM18, contrato: number) {
    return this.e(c)
      .metas.filter((m) => m.contrato === contrato)
      .sort((a, b) => Number(b.ativa) - Number(a.ativa) || a.tipo.localeCompare(b.tipo) || a.id - b.id)
      .map(sem);
  }

  async meta(c: ContextoPortaM18, id: number) {
    const x = this.e(c).metas.find((y) => y.id === id);
    return x ? sem(x) : null;
  }

  async apuracoes(c: ContextoPortaM18, metas: readonly number[]) {
    return this.e(c)
      .apuracoes.filter((a) => metas.includes(a.meta))
      .sort((a, b) => a.meta - b.meta || b.competencia.localeCompare(a.competencia))
      .map(sem);
  }

  async sigtapExiste(_c: ContextoPortaM18, prefixo: string) {
    return prefixo.length >= 2 && SIGTAP_SINTETICA_CONTRATUALIZACAO.some((p) => p.codigo.startsWith(prefixo));
  }

  async buscarSigtap(_c: ContextoPortaM18, termo: string) {
    const t = termo.trim().toLowerCase();
    const d = t.replace(/\D/g, '');
    return SIGTAP_SINTETICA_CONTRATUALIZACAO.filter((p) =>
      d.length >= 2 ? p.codigo.startsWith(d) : p.nome.toLowerCase().includes(t),
    ).map((p) => ({ ...p }));
  }

  async producaoFaturamentoSus(): Promise<ProducaoSigtapSus[]> {
    return [];
  }

  async producaoContasSus(_c: ContextoPortaM18, competencia: string, convenios: readonly number[]) {
    if (convenios.length === 0) return [];
    return producaoSinteticaContratualizacao(this.relogioFn().competencia).filter(
      (p) => p.competencia === competencia,
    );
  }
}
