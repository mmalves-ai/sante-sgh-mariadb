// Porta da rouparia EM MEMÓRIA (M55, fatia F2): a sessão sintética de dev/ci (E2E) tem setores, uma lavanderia
// terceirizada e um enxoval SINTÉTICOS (peças e um kit) e grava as peças, as cotas e os movimentos SINTÉTICOS com as
// mesmas regras e recusas da gravação (a versão vista, o retorno que só acha o envio ainda registrado, a chave única do
// pedido, o cancelamento que devolve o envio). Nada vai à cópia; nenhum nome é de pessoa real.
import type { CotaRoupa, KgSetorDia, MovimentoRoupa, PecaRoupa } from '@sgh/contratos';
import { recusa } from '@sgh/legado';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import type { FiltroMovimentosPorta, GravadorRouparia, PortaRouparia, SetorRouparia } from './porta.js';

export const SETORES_SINTETICOS_ROUPARIA: readonly SetorRouparia[] = [
  { codigo: 9101, nome: 'Clínica médica (sintético)', ativo: true },
  { codigo: 9102, nome: 'UTI adulto (sintético)', ativo: true },
  { codigo: 9103, nome: 'Centro cirúrgico (sintético)', ativo: true },
  { codigo: 9104, nome: 'Setor desativado (sintético)', ativo: false },
];
export const FORNECEDORES_SINTETICOS_ROUPARIA = [{ codigo: 7101, nome: 'Lavanderia Sintética' }] as const;
/** Pacientes-dia sintéticos por dia fechado (o censo em memória). */
export const PACIENTES_DIA_SINTETICOS = 30;

const ENXOVAL: readonly PecaRoupa[] = [
  {
    id: 1,
    nome: 'Lençol de solteiro',
    categoria: 'lencol',
    pesoGramas: 600,
    custoReposicaoCentavos: 3500,
    composicao: [],
    ativa: true,
    versao: 1,
  },
  {
    id: 2,
    nome: 'Fronha',
    categoria: 'fronha',
    pesoGramas: 150,
    custoReposicaoCentavos: 900,
    composicao: [],
    ativa: true,
    versao: 1,
  },
  {
    id: 3,
    nome: 'Camisola de paciente',
    categoria: 'camisola',
    pesoGramas: 300,
    custoReposicaoCentavos: 2500,
    composicao: [],
    ativa: true,
    versao: 1,
  },
  {
    id: 4,
    nome: 'Toalha de banho',
    categoria: 'toalha',
    pesoGramas: 500,
    custoReposicaoCentavos: 2800,
    composicao: [],
    ativa: true,
    versao: 1,
  },
  {
    id: 5,
    nome: 'Campo cirúrgico',
    categoria: 'campo-cirurgico',
    pesoGramas: 400,
    custoReposicaoCentavos: 4000,
    composicao: [],
    ativa: true,
    versao: 1,
  },
  {
    id: 6,
    nome: 'Kit leito',
    categoria: 'kit',
    pesoGramas: 1350,
    custoReposicaoCentavos: null,
    composicao: [
      { peca: 1, quantidade: 2 },
      { peca: 2, quantidade: 1 },
    ],
    ativa: true,
    versao: 1,
  },
];

type Mutavel<T> = { -readonly [K in keyof T]: T[K] };

interface Estado {
  pecas: PecaRoupa[];
  cotas: Mutavel<CotaRoupa & { id: number }>[];
  movimentos: Mutavel<MovimentoRoupa & { chave: string }>[];
  seq: number;
}

const p2 = (n: number) => String(n).padStart(2, '0');
function agoraLocal(): { hoje: string; agora: string } {
  const d = new Date();
  const agora = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  return { hoje: agora.slice(0, 10), agora };
}
function semChave(m: MovimentoRoupa & { chave: string }): MovimentoRoupa {
  const r: Partial<MovimentoRoupa & { chave: string }> = { ...m };
  delete r.chave;
  return r as MovimentoRoupa;
}

export class PortaRoupariaMemoria implements PortaRouparia {
  readonly destino = 'memoria' as const;
  private readonly porHospital = new Map<string, Estado>();

  constructor(private readonly relogioFn: () => { hoje: string; agora: string } = agoraLocal) {}

  private e(c: ContextoPortaM18): Estado {
    let s = this.porHospital.get(c.hospital);
    if (!s) {
      s = { pecas: ENXOVAL.map((p) => ({ ...p })), cotas: [], movimentos: [], seq: 55_200 };
      this.porHospital.set(c.hospital, s);
    }
    return s;
  }

  async podeGravar() {
    return { pode: false, codigo: 'sem-operacao', motivo: 'A rouparia não usa operação do executor.' };
  }

  async executar(): Promise<never> {
    throw new Error('A rouparia não usa operação do executor.');
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    _trilha: unknown,
    fn: (g: GravadorRouparia) => Promise<T>,
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

  private gravador(s: Estado): GravadorRouparia {
    return {
      relogio: async () => this.relogioFn(),
      pecas: async () => s.pecas.map((p) => ({ ...p })),
      movimento: async (id) => {
        const m = s.movimentos.find((x) => x.id === id);
        return m ? semChave(m) : null;
      },
      movimentoPelaChave: async (chave) => {
        const m = s.movimentos.find((x) => x.chave === chave);
        return m ? semChave(m) : null;
      },
      incluirPeca: async (p) => {
        const id = ++s.seq;
        s.pecas.push({
          id,
          nome: p.nome,
          categoria: p.categoria,
          pesoGramas: p.pesoGramas,
          custoReposicaoCentavos: p.custoReposicaoCentavos,
          composicao: p.categoria === 'kit' ? [...p.composicao] : [],
          ativa: p.ativa,
          versao: 1,
        });
        return { id, versao: 1 };
      },
      alterarPeca: async (p) => {
        const i = s.pecas.findIndex((x) => x.id === p.id);
        const atual = s.pecas[i];
        if (!atual || atual.versao !== p.versaoVista)
          throw recusa('versao-desatualizada', 'O registro mudou desde que foi aberto: atualize a tela.');
        s.pecas[i] = {
          id: p.id,
          nome: p.nome,
          categoria: p.categoria,
          pesoGramas: p.pesoGramas,
          custoReposicaoCentavos: p.custoReposicaoCentavos,
          composicao: p.categoria === 'kit' ? [...p.composicao] : [],
          ativa: p.ativa,
          versao: atual.versao + 1,
        };
        return { id: p.id, versao: atual.versao + 1 };
      },
      gravarCotas: async (c) => {
        let alteradas = 0;
        for (const q of c.cotas) {
          const atual = s.cotas.find((x) => x.centroCusto === c.centroCusto && x.peca === q.peca);
          if (atual && atual.quantidade === q.quantidade) continue;
          if (atual) {
            atual.quantidade = q.quantidade;
            atual.versao += 1;
          } else {
            if (q.quantidade === 0) continue;
            s.cotas.push({
              id: ++s.seq,
              centroCusto: c.centroCusto,
              peca: q.peca,
              quantidade: q.quantidade,
              versao: 1,
            });
          }
          alteradas++;
        }
        return { alteradas };
      },
      registrarMovimento: async (m) => {
        if (s.movimentos.some((x) => x.chave === m.chave))
          throw recusa('chave-de-outro-movimento', 'A chave do pedido já foi usada em outro movimento.');
        if (m.tipo === 'retorno') {
          const envio = s.movimentos.find(
            (x) => x.id === m.remessa && x.tipo === 'envio' && x.situacao === 'registrado',
          );
          if (!envio)
            throw recusa('remessa-ja-retornada', 'Este envio já tem o retorno registrado ou não existe.');
          envio.situacao = 'retornado';
          envio.versao += 1;
        }
        const id = ++s.seq;
        s.movimentos.push({
          id,
          chave: m.chave,
          tipo: m.tipo,
          data: m.data,
          em: this.relogioFn().agora,
          centroCusto: m.centroCusto,
          remessa: m.remessa,
          pesoKg: m.pesoKg,
          pecas: m.itens.reduce((t, i) => t + i.quantidade, 0),
          itens: [...m.itens],
          lavanderia: m.lavanderia,
          fornecedor: m.fornecedor,
          motivoPerda: m.motivoPerda,
          diferencaKg: m.diferencaKg,
          diferencaPct: m.diferencaPct,
          ocorrencia: m.ocorrencia,
          observacao: m.observacao,
          situacao: 'registrado',
          por: m.usuario,
          canceladoPor: null,
          canceladoEm: null,
          motivoCancelamento: null,
          versao: 1,
        });
        return { id, versao: 1 };
      },
      cancelarMovimento: async (c) => {
        const m = s.movimentos.find((x) => x.id === c.id);
        if (!m || m.versao !== c.versaoVista || m.situacao !== 'registrado')
          throw recusa(
            'versao-desatualizada',
            'O movimento mudou desde que foi aberto ou já tem o retorno: atualize a tela.',
          );
        m.situacao = 'cancelado';
        m.canceladoPor = c.usuario;
        m.canceladoEm = this.relogioFn().agora;
        m.motivoCancelamento = c.motivo;
        m.versao += 1;
        if (c.remessa !== null) {
          const envio = s.movimentos.find((x) => x.id === c.remessa && x.situacao === 'retornado');
          if (!envio)
            throw recusa('remessa-inexistente', 'O envio deste retorno não está mais como retornado.');
          envio.situacao = 'registrado';
          envio.versao += 1;
        }
        return { id: c.id, versao: m.versao };
      },
    };
  }

  private filtrar(s: Estado, f: FiltroMovimentosPorta): MovimentoRoupa[] {
    return s.movimentos
      .filter(
        (m) =>
          m.data >= f.de &&
          m.data <= f.ate &&
          (!f.tipo || m.tipo === f.tipo) &&
          (f.centroCusto === null || f.centroCusto === undefined || m.centroCusto === f.centroCusto) &&
          (!f.antesDe || m.id < f.antesDe),
      )
      .sort((a, b) => b.id - a.id)
      .map(semChave);
  }

  async relogio() {
    return this.relogioFn();
  }
  async pecas(c: ContextoPortaM18) {
    return this.e(c)
      .pecas.map((p) => ({ ...p }))
      .sort((a, b) => Number(b.ativa) - Number(a.ativa) || a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  async cotas(c: ContextoPortaM18, centro?: number | null) {
    return this.e(c)
      .cotas.filter(
        (x) => x.quantidade > 0 && (centro === null || centro === undefined || x.centroCusto === centro),
      )
      .map((x) => ({ centroCusto: x.centroCusto, peca: x.peca, quantidade: x.quantidade, versao: x.versao }))
      .sort((a, b) => a.centroCusto - b.centroCusto || a.peca - b.peca);
  }
  async movimentos(c: ContextoPortaM18, f: FiltroMovimentosPorta) {
    const teto = f.teto ?? 200;
    const todos = this.filtrar(this.e(c), f);
    return { itens: todos.slice(0, teto), cortada: todos.length > teto };
  }
  async movimento(c: ContextoPortaM18, id: number) {
    const m = this.e(c).movimentos.find((x) => x.id === id);
    return m ? semChave(m) : null;
  }
  async enviosAbertos(c: ContextoPortaM18) {
    return this.e(c)
      .movimentos.filter((m) => m.tipo === 'envio' && m.situacao === 'registrado')
      .sort((a, b) => a.id - b.id)
      .map(semChave);
  }
  async kgPorSetorDia(c: ContextoPortaM18, de: string, ate: string): Promise<KgSetorDia[]> {
    const m = new Map<string, KgSetorDia>();
    for (const x of this.e(c).movimentos) {
      if (
        x.tipo !== 'coleta' ||
        x.situacao === 'cancelado' ||
        x.data < de ||
        x.data > ate ||
        x.centroCusto === null
      )
        continue;
      const k = `${x.data}|${x.centroCusto}`;
      const a = m.get(k) ?? { data: x.data, centroCusto: x.centroCusto, kg: 0, coletas: 0 };
      m.set(k, { ...a, kg: Math.round((a.kg + (x.pesoKg ?? 0)) * 1000) / 1000, coletas: a.coletas + 1 });
    }
    return [...m.values()].sort((a, b) => a.data.localeCompare(b.data) || a.centroCusto - b.centroCusto);
  }
  async totais(c: ContextoPortaM18, de: string, ate: string) {
    const vivos = this.e(c).movimentos.filter(
      (m) => m.situacao !== 'cancelado' && m.data >= de && m.data <= ate,
    );
    const kg = (t: string) =>
      Math.round(vivos.filter((m) => m.tipo === t).reduce((s, m) => s + (m.pesoKg ?? 0), 0) * 1000) / 1000;
    const ret = vivos.filter((m) => m.tipo === 'retorno');
    return {
      kgColetados: kg('coleta'),
      kgEnviados: kg('envio'),
      kgRetornados: kg('retorno'),
      pecasPerdidas: vivos.filter((m) => m.tipo === 'perda').reduce((s, m) => s + m.pecas, 0),
      retornos: ret.length,
      ocorrencias: ret.filter((m) => m.ocorrencia).length,
    };
  }
  async inventarios(c: ContextoPortaM18, ate: string) {
    return this.filtrar(this.e(c), { de: '0000-01-01', ate, tipo: 'inventario' });
  }
  async setores() {
    return [...SETORES_SINTETICOS_ROUPARIA];
  }
  async fornecedores(_c: ContextoPortaM18, termo: string) {
    const t = termo.trim().toUpperCase();
    return FORNECEDORES_SINTETICOS_ROUPARIA.filter(
      (f) => String(f.codigo) === t || f.nome.toUpperCase().includes(t),
    ).map((f) => ({ ...f }));
  }
  async fornecedorExiste(_c: ContextoPortaM18, codigo: number) {
    return FORNECEDORES_SINTETICOS_ROUPARIA.some((f) => f.codigo === codigo);
  }
  async pacientesDia(_c: ContextoPortaM18, de: string, ate: string) {
    const dias =
      Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000) + 1;
    return Math.max(0, dias) * PACIENTES_DIA_SINTETICOS;
  }
}
